import { ActionFormData, ActionFormResponse, MessageFormData, MessageFormResponse } from "@minecraft/server-ui";
import { Player, RawMessage, system } from "@minecraft/server";
import { RequestData, RequestPokemon, requestPokemonUUID } from "../battle/Request";
import { renderHealthBar, typeColorCodes, typeSymbols, message, getMoveTranslation } from "../language";
import type { BattleActor } from "../battle/BattleActor";
import type { PokemonBattle } from "../battle/PokemonBattle";
import {
  ActionResponse, BagItemActionResponse, FleeAttemptActionResponse, ForcePassActionResponse, ForfeitActionResponse,
  MoveActionResponse, PassActionResponse, SwitchActionResponse
} from "../battle/ActionResponse";
import { Dex, simPokemonUUID, toID } from "../showdown";
import type { SimPokemon } from "../showdown";
import { getSimActive, getSimBattle, getSimPokemon, getOpposingActive, getTargetOptions, typeMultiplier, TargetOption } from "../battle/SimQueries";
import { BagEntry, BagItemDef, hasPokeBall, listBagItems } from "../battle/BagItems";
import { PokemonData, ElementalType } from "../Pokemon";
import { PCLocation, PCPlace, findPokemonLocation, getPokemonFromPCLocation, setPokemonToPCLocation } from "../pokemonStorage";
import { BattleTypes } from "../battle/BattleFormat";
import { ActorType } from "../battle/BattleActor";
import { CATEGORY_GLYPHS, typeGlyph } from "../ui/glyphs";
import { SCREEN } from "../ui/screens";
import {
  BATTLE_MOVES, BATTLE_SWITCH, BATTLE_TARGET, BLANK, CellForm, GIMMICK_ON_MARKER, SUB, barTexture, battleMenuTexture, layoutTitle, typeKeyTexture,
} from "./layout";
import {
  GIMMICK_CHOICE, Gimmick, MoveTileInfo, availableGimmicks, gimmickLabelKey, gimmickTexture, moveTileInfo,
} from "../battle/Gimmicks";
import { getPokemonSpriteTexture } from "./common";
import { effectiveType, moveData } from "../battle/ai/StrongBattleAI";

/**
 * Telas da batalha (BattleGUI do Cobblemon, com forms do @minecraft/server-ui):
 * - menu principal (marcador SCREEN.BATTLE no título usa o layout de `ui/battle.json`): Lutar / Mochila / Pokémon / Fugir|Desistir;
 * - frente telas: cada submenu tem o sub-marcador do seu layout (`layoutSpec.ts`): tiles do menu com as texturas
 *   `battle_menu_*`, tiles de golpe pintados com a cor do tipo (ícone = chave do tipo) com PP e efetividade, alvos
 *   com retrato, troca com retrato + barra de HP (ícone `hp_h_NN`) e mochila em grade;
 * - golpes com tipo, PP e efetividade; escolha de alvo em duplas/triplas;
 * - troca (e troca obrigatória após desmaio);
 * - mochila: itens do inventário usáveis em batalha → Pokémon alvo → (golpe, para Ether).
 * Fechar a tela não perde a vez: interagir com o oponente reabre (BattleActor.promptPlayerForRequest).
 */

/** Resultado interno de um submenu: escolha feita, voltar ao menu anterior ou tela fechada. */
const BACK = Symbol("back");
const CLOSED = Symbol("closed");
type MenuResult<T> = T | typeof BACK | typeof CLOSED;

/** Glifos das categorias (página E2 do port, scripts/ui/glyphs.ts). */
const categorySymbols: Record<string, string> = CATEGORY_GLYPHS;

const statusLabels: Record<string, string> = {
  brn: "§6BRN", par: "§ePAR", slp: "§7SLP", frz: "§bFRZ", psn: "§5PSN", tox: "§5TOX", fnt: "§cFNT"
};

interface MenuContext {
  actor: BattleActor;
  battle: PokemonBattle;
  player: Player;
  request: RequestData;
  requestId: number;
  slot: number;
  /** Índices do time já escolhidos para entrar neste turno (duplas). */
  chosenSwitches: Set<number>;
  /** Frente msd-fase1: gimmicks já escolhidos por outra posição neste turno (pendingGimmickUsedThisTurn). */
  usedGimmicks: Set<Gimmick>;
}

/** Pede ao jogador as ações de todas as posições do request. undefined = tela fechada. */
export async function handleMoveRequest(request: RequestData, actor: BattleActor, battle: PokemonBattle): Promise<ActionResponse[] | undefined> {
  let player = actor.Player;
  if (!player) throw new Error("Couldn't handle request: actor is not a player");
  let output: ActionResponse[] = [];
  let chosenSwitches = new Set<number>();
  let usedGimmicks = new Set<Gimmick>();
  let forcedLeft = request.forceSwitch ? 0 : actor.expectingPassActions.length;
  for (let slot = 0; slot < actor.slotCount; slot++) {
    if (!actor.slotNeedsChoice(slot, request)) {
      output.push(new PassActionResponse());
      continue;
    }
    // Posições ocupadas por ações forçadas (ex.: Poké Bola arremessada) não perguntam nada.
    if (forcedLeft > 0) {
      forcedLeft--;
      output.push(new ForcePassActionResponse());
      continue;
    }
    let context: MenuContext = { actor, battle, player, request, requestId: actor.requestId, slot, chosenSwitches, usedGimmicks };
    let response = request.forceSwitch
      ? await showSwitchMenu(context, true)
      : await showActionMenu(context);
    if (response === CLOSED || response === BACK || response === undefined)
      return undefined;
    // Desistir/fugir valem para o turno inteiro.
    if (response instanceof ForfeitActionResponse || response instanceof FleeAttemptActionResponse)
      return [response];
    output.push(response);
  }
  return output;
}

// ---------------------------------------------------------------------------------------------
// Exibição segura dos forms
// ---------------------------------------------------------------------------------------------

function wait(ticks: number) {
  return new Promise<void>(resolve => system.runTimeout(() => resolve(), ticks));
}

function isStale(context: MenuContext) {
  return context.battle.ended || context.actor.requestId !== context.requestId || !context.player.isValid;
}

/** Mostra o form; se o jogador estiver ocupado (chat, inventário), tenta de novo a cada meio segundo. */
async function show<T extends ActionFormResponse | MessageFormResponse>(context: MenuContext, form: { show(player: Player): Promise<T> }): Promise<T | undefined> {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (isStale(context)) return undefined;
    let response: T;
    // Jogador saiu no meio do menu (FormRejectError): a tela conta como fechada, sem erro no log.
    try { response = await form.show(context.player); } catch { return undefined; }
    if (response.canceled && String(response.cancelationReason) === "UserBusy") {
      await wait(10);
      continue;
    }
    if (isStale(context)) return undefined;
    // Clique nos tiles da batalha (BattleGeneralActionSelection/MoveSelection/...: GUI_CLICK).
    if (!response.canceled) {
      try { context.player.playSound("cobblemon.gui.click"); } catch { }
    }
    return response;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Menu principal
// ---------------------------------------------------------------------------------------------

async function showActionMenu(context: MenuContext): Promise<MenuResult<ActionResponse>> {
  let { actor, battle, request, slot } = context;
  let moveset = request.active?.[slot];
  while (true) {
    let options: { label: RawMessage; icon: string; action: () => Promise<MenuResult<ActionResponse>> }[] = [];
    options.push({ label: { translate: "cobblemon.battle.ui.fight" }, icon: battleMenuTexture("fight"), action: () => showMoveMenu(context) });
    options.push({ label: { translate: "cobblemon.port.battle.ui.bag" }, icon: battleMenuTexture("bag"), action: () => showBagMenu(context) });
    options.push({
      label: { translate: "cobblemon.battle.ui.switch" },
      icon: battleMenuTexture("switch"),
      action: async () => {
        if (moveset?.trapped) {
          context.player.sendMessage(message.error(message.With("cobblemon.port.battle.ui.trapped", [pokemonNameAt(context, slot)])));
          return BACK;
        }
        return showSwitchMenu(context, false);
      }
    });
    if (battle.isPvW)
      options.push({ label: { translate: "cobblemon.battle.ui.run" }, icon: battleMenuTexture("run"), action: async () => new FleeAttemptActionResponse() });
    else
      options.push({ label: { translate: "cobblemon.battle.ui.forfeit" }, icon: battleMenuTexture("forfeit"), action: () => confirmForfeit(context) });

    let form = new ActionFormData()
      .title(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_ACTION, actor.slotCount > 1 ? pokemonNameAt(context, slot) : { translate: "cobblemon.battle.choose_actions" }))
      .body(renderBattleStatus(context));
    options.forEach(x => form.button(x.label, x.icon));
    let response = await show(context, form);
    if (!response || response.selection === undefined)
      return CLOSED;
    let result = await options[response.selection].action();
    if (result === BACK)
      continue;
    // CLOSED também vem da dica de Poké Bola na mochila: fecha o menu sem gastar a vez.
    return result;
  }
}

async function confirmForfeit(context: MenuContext): Promise<MenuResult<ActionResponse>> {
  let form = new MessageFormData()
    .title({ translate: "cobblemon.battle.ui.forfeit" })
    .body({ translate: "cobblemon.battle.ui.forfeit_confirmation" })
    .button1({ translate: "cobblemon.battle.ui.forfeit" })
    .button2({ translate: "gui.back" });
  let response = await show(context, form);
  if (!response || response.canceled)
    return BACK;
  return response.selection === 0 ? new ForfeitActionResponse() : BACK;
}

// ---------------------------------------------------------------------------------------------
// Golpes e alvos
// ---------------------------------------------------------------------------------------------

/** Célula do menu de golpes: um golpe ou um botão de gimmick (frente msd-fase1). */
type MoveCell = { kind: "move"; index: number } | { kind: "gimmick"; gimmick: Gimmick };

/**
 * Menu de golpes (BattleMoveSelection). Frente msd-fase1: os botões de gimmick (BattleGimmickButton) aparecem ao lado
 * do voltar quando o request oferece o gimmick (depois do sanitize por item-chave); ligar um troca os tiles (Z/Max
 * mostram o golpe Z/Max, com o alvo dele) e o golpe escolhido vai com o sufixo (`move N [alvo] mega|zmove|...`).
 * Pokémon já em Dynamax: os tiles normais já são os golpes Max.
 */
async function showMoveMenu(context: MenuContext): Promise<MenuResult<ActionResponse>> {
  let { request, slot, actor } = context;
  let moveset = request.active?.[slot];
  if (!moveset)
    return BACK;
  let self = getSimActive(actor, slot);
  let foes = getOpposingActive(actor);
  let gimmicks = availableGimmicks(moveset, context.usedGimmicks).slice(0, BATTLE_MOVES.GIMMICK_SLOTS);
  let toggled: Gimmick | undefined;
  while (true) {
    let form = moveForm<MoveCell>({ translate: "cobblemon.battle.ui.fight" }, withTeraType(pokemonNameAt(context, slot), self));
    moveset.moves.slice(0, 4).forEach((_, i) => {
      let tile = moveTileInfo(moveset!, i, toggled);
      form.cell(BATTLE_MOVES.MOVES + i, renderMoveTile(tile, self, foes), tileTypeKey(tile, self), { kind: "move", index: i });
    });
    gimmicks.forEach((gimmick, i) => form.cell(BATTLE_MOVES.GIMMICKS + i, gimmickButtonText(gimmick, toggled === gimmick), gimmickTexture(gimmick), { kind: "gimmick", gimmick }));
    let response = await show(context, form.build());
    if (!response || response.selection === undefined)
      return CLOSED;
    let cell = form.actionAt(response.selection);
    if (cell === undefined)
      return BACK;
    if (cell.kind === "gimmick") {
      // BattleGimmickButton.toggle: um só ligado por vez (os outros desligam), com o som da bigorna.
      toggled = toggled === cell.gimmick ? undefined : cell.gimmick;
      try { context.player.playSound("random.anvil_land", { volume: 0.5 }); } catch { }
      continue;
    }
    let move = moveset.moves[cell.index];
    let tile = moveTileInfo(moveset, cell.index, toggled);
    if (!tile.selectable) {
      if (toggled === "zmove" || toggled === "max")
        context.player.sendMessage(message.error(message.With("cobblemon.port.battle.ui.gimmick_unusable", [getMoveTranslation(move.id), { translate: gimmickLabelKey(toggled) }])));
      else
        context.player.sendMessage(message.error(message.battleMsg("cant.nopp", [pokemonNameAt(context, slot), getMoveTranslation(move.id)])));
      continue;
    }
    let suffix = toggled ? GIMMICK_CHOICE[toggled] : undefined;
    // Alvo pelo golpe Z/Max (GimmickTile.targetList), senão pelo golpe.
    let targets = getTargetOptions(actor, slot, tile.target);
    let chosen: MoveActionResponse;
    if (!targets || targets.length === 0)
      chosen = new MoveActionResponse(move.id, undefined, suffix);
    else if (targets.length === 1)
      chosen = new MoveActionResponse(move.id, targets[0].loc, suffix);
    else {
      let target = await showTargetMenu(context, tile.displayId, targets, tileName(tile));
      if (target === BACK)
        continue;
      if (target === CLOSED)
        return CLOSED;
      chosen = new MoveActionResponse(move.id, target.loc, suffix);
    }
    if (toggled)
      context.usedGimmicks.add(toggled);
    return chosen;
  }
}

/**
 * Frente msd-fase3: Pokémon terastalizado mostra o tipo Tera no menu de golpes (o Cobblemon mostra o ícone do tipo
 * Tera no BattleOverlay). Sem Tera (sempre, no mundo sem o Mega Showdown), o texto é o de antes.
 */
export function withTeraType(name: RawMessage, self: SimPokemon | undefined): RawMessage {
  let tera = self?.terastallized;
  if (!tera)
    return name;
  let id = toID(tera);
  return { rawtext: [name, { text: "\n" }, { translate: "cobblemon.port.battle.ui.tera_type", with: { rawtext: [{ text: `${typeGlyph(id)} ` }, { translate: `cobblemon.type.${id}` }] } }] };
}

/** Texto do botão de gimmick (não aparece: só deixa a célula visível e marca o estado ligado). */
function gimmickButtonText(gimmick: Gimmick, on: boolean): RawMessage {
  return { rawtext: [{ text: on ? GIMMICK_ON_MARKER : "" }, { translate: gimmickLabelKey(gimmick) }] };
}

/** Nome do golpe do tile ("Z-" + golpe base para os golpes Z de status). */
function tileName(tile: MoveTileInfo): RawMessage {
  return tile.zStatus ? { rawtext: [{ text: "Z-" }, getMoveTranslation(tile.baseId)] } : getMoveTranslation(tile.displayId);
}

/** Tile de golpe com gimmick: tipo/nome do golpe Z/Max, categoria e PP do golpe base (MoveTile do Cobblemon). */
function renderMoveTile(tile: MoveTileInfo, self: SimPokemon | undefined, foes: SimPokemon[]): RawMessage {
  if (tile.displayId === tile.baseId && !tile.zStatus)
    return renderMoveButton(tile.baseId, tile.pp, tile.maxpp, tile.disabled, self, foes);
  return renderMoveButton(tile.baseId, tile.pp, tile.maxpp, tile.disabled, self, foes, { name: tileName(tile), type: tile.type, category: tile.category });
}

function tileTypeKey(tile: MoveTileInfo, self?: SimPokemon): string {
  return tile.displayId === tile.baseId && !tile.zStatus ? moveTypeKey(tile.baseId, self) : typeKeyTexture(toID(tile.type));
}

/** Form dos golpes (layout BATTLE_MOVES): 4 tiles + voltar (+ botões de gimmick, acrescentados por quem chama). */
function moveForm<T = number>(title: RawMessage, body: RawMessage): CellForm<T> {
  let form = new CellForm<T>(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_MOVES, title), BATTLE_MOVES.COUNT).body(body);
  form.cell(BATTLE_MOVES.BACK, { translate: "gui.back" });
  return form;
}

/**
 * Tipo mostrado do golpe (MoveTemplate.getEffectiveElementalType, 1.6.0): Hidden Power pelo tipo do Pokémon,
 * golpes Normal com Pixilate/Aerilate/Refrigerate/Galvanize e qualquer golpe com Normalize.
 */
export function displayedMoveType(moveId: string, self: SimPokemon | undefined): string {
  return effectiveType(moveData(moveId), self);
}

/** Ícone do tile de golpe: a chave do tipo efetivo (o JSON UI pinta o tile com a cor do tipo). */
function moveTypeKey(moveId: string, self?: SimPokemon): string {
  return typeKeyTexture(toID(displayedMoveType(moveId, self)));
}

/**
 * Tile de golpe (BattleMoveSelection.MoveTile): 1ª linha = ícone do tipo + nome; 2ª = categoria, PP (dourado na
 * metade, vermelho em 0, como o Cobblemon) e a dica de efetividade. Golpe indisponível começa com §8.
 */
export function renderMoveButton(
  moveId: string, pp: number | undefined, maxpp: number | undefined, disabled: boolean, self: SimPokemon | undefined, foes: SimPokemon[],
  /** Frente msd-fase1: golpe Z/Max no lugar do golpe (nome, tipo e categoria mostrados). */
  shown?: { name: RawMessage; type: string; category: string },
): RawMessage {
  let move = Dex.moves.get(moveId);
  let shownType = shown?.type ?? displayedMoveType(moveId, self);
  let category = shown?.category ?? move.category;
  let type = toID(shownType) as ElementalType;
  let empty = pp !== undefined && pp <= 0 && move.id !== "struggle";
  let ppColor = pp === undefined || maxpp === undefined ? "§f" : pp === 0 ? "§c" : pp <= Math.floor(maxpp / 2) ? "§6" : "§f";
  let ppText = (pp !== undefined && maxpp !== undefined) ? ` §fPP ${ppColor}§l${pp}/${maxpp}§r` : "";
  let hint = effectivenessHint(move.id, category, shownType, foes);
  // Com o gimmick, "vazio" é decidido pelo golpe Z/Max (`disabled`), não pelo PP do golpe base.
  if (shown) empty = false;
  let rawtext: RawMessage[] = [
    { text: `${disabled || empty ? "§8" : "§f"}${typeGlyph(type) || typeSymbols[type] || ""} ` },
    shown?.name ?? getMoveTranslation(move.id),
    { text: `§r\n${categorySymbols[category] ?? ""}${ppText}` },
  ];
  if (hint)
    rawtext.push({ text: " " }, hint);
  return { rawtext };
}

/** Dica de efetividade contra os inimigos em campo (não considera habilidades). */
function effectivenessHint(moveId: string, category: string, type: string, foes: SimPokemon[]): RawMessage | undefined {
  if (category === "Status" || foes.length === 0)
    return undefined;
  let multipliers = foes.map(foe => typeMultiplier(type, foe));
  if (foes.length === 1)
    return effectivenessLabel(multipliers[0]);
  // Duplas/triplas: um multiplicador por inimigo (ex.: "×2 / ×0.5").
  return { text: "§7" + multipliers.map(x => `×${x}`).join(" / ") };
}

function effectivenessLabel(multiplier: number): RawMessage | undefined {
  if (multiplier === 0) return { rawtext: [{ text: "§8" }, { translate: "cobblemon.port.battle.ui.effect.none" }] };
  if (multiplier > 1) return { rawtext: [{ text: "§a" }, { translate: "cobblemon.port.battle.ui.effect.super" }] };
  if (multiplier < 1) return { rawtext: [{ text: "§6" }, { translate: "cobblemon.port.battle.ui.effect.weak" }] };
  return undefined;
}

async function showTargetMenu(context: MenuContext, moveId: string, targets: TargetOption[], moveName?: RawMessage): Promise<MenuResult<TargetOption>> {
  let form = new CellForm<TargetOption>(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_TARGET, { translate: "cobblemon.battle.select_target" }), BATTLE_TARGET.COUNT)
    .body(moveName ?? getMoveTranslation(moveId));
  // BattleTargetSelection: inimigos na fileira de cima, aliados embaixo (até 3 cada).
  let foes = 0, allies = 0;
  targets.forEach(target => {
    let data = safeData(context.battle, target.uuid);
    // Illusion: o oponente aparece com o disfarce (nome e retrato).
    let active = context.battle.activePokemon.find(x => x?.data.uuid === target.uuid);
    if (active && data) data = active.displayData(target.ally);
    let index = target.ally ? BATTLE_TARGET.ALLIES + allies++ : BATTLE_TARGET.FOES + foes++;
    if (target.ally ? allies > 3 : foes > 3) return;
    form.cell(index, {
      rawtext: [
        { text: target.ally ? "§9" : "§c" },
        { translate: target.ally ? "cobblemon.port.battle.ui.ally" : "cobblemon.port.battle.ui.foe" },
        { text: "§r\n" },
        data ? data.getTranslatedName() : { text: target.uuid },
        { text: `\n§7${Math.ceil(100 * target.pokemon.hp / target.pokemon.maxhp)}%` },
      ]
    }, data ? getPokemonSpriteTexture(data) : undefined, target);
  });
  form.cell(BATTLE_TARGET.BACK, { translate: "gui.back" });
  let response = await show(context, form.build());
  if (!response || response.selection === undefined)
    return CLOSED;
  return form.actionAt(response.selection) ?? BACK;
}

// ---------------------------------------------------------------------------------------------
// Troca
// ---------------------------------------------------------------------------------------------

async function showSwitchMenu(context: MenuContext, forced: boolean): Promise<MenuResult<ActionResponse>> {
  let { request, battle } = context;
  while (true) {
    let entries = request.side.pokemon.slice(0, 6).map((pokemon, index) => ({ pokemon, index }));
    let form = switchForm({ translate: forced ? "cobblemon.port.battle.ui.forced_switch" : "cobblemon.battle.ui.switch" }, !forced)
      .body(renderBattleStatus(context));
    entries.forEach(({ pokemon, index }, i) => {
      let tile = partyTile(context, pokemon, index);
      form.cell(BATTLE_SWITCH.SLOTS + i, tile.text, tile.icon, i).cell(BATTLE_SWITCH.BARS + i, BLANK, tile.bar);
    });
    let response = await show(context, form.build());
    if (!response || response.selection === undefined)
      return CLOSED;
    let chosen = form.actionAt(response.selection);
    if (chosen === undefined)
      return forced ? CLOSED : BACK;
    let { pokemon, index } = entries[chosen];
    let uuid = requestPokemonUUID(pokemon);
    let data = safeData(battle, uuid);
    let name = data?.getTranslatedName() ?? { text: uuid };
    if (isFainted(pokemon)) {
      context.player.sendMessage(message.error(message.With("cobblemon.battle.pokemon_already_fainted", [name])));
      continue;
    }
    if (pokemon.active || context.chosenSwitches.has(index)) {
      context.player.sendMessage(message.error(message.With("cobblemon.battle.already_out", [name])));
      continue;
    }
    context.chosenSwitches.add(index);
    return new SwitchActionResponse(uuid);
  }
}

/** Form da troca/alvo de item (layout BATTLE_SWITCH): 6 tiles com retrato e barra, voltar opcional. */
function switchForm(title: RawMessage, withBack: boolean): CellForm<number> {
  let form = new CellForm<number>(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_SWITCH, title), BATTLE_SWITCH.COUNT);
  if (withBack) form.cell(BATTLE_SWITCH.BACK, { translate: "gui.back" });
  return form;
}

/** Tile da troca (BattleSwitchPokemonSelection.SwitchTile): nome, nível e status; HP em número e na barra. */
function tileText(name: RawMessage, color: string, level: number | string, status: string, hp: number, maxhp: number): RawMessage {
  return {
    rawtext: [
      { text: color },
      name,
      { text: ` §7Lv.${level}${status ? ` ${statusLabels[status] ?? ""}` : ""}§r\n${color || "§f"}${hp}/${maxhp}` },
    ]
  };
}

function partyTile(context: MenuContext, pokemon: RequestPokemon, index: number): { text: RawMessage; icon?: string; bar: string } {
  let uuid = requestPokemonUUID(pokemon);
  let data = safeData(context.battle, uuid);
  let sim = getSimPokemon(context.battle, uuid);
  let hp = sim?.hp ?? data?.currentHealth ?? 0;
  let maxhp = sim?.maxhp ?? data?.maxHealth ?? 1;
  let status = isFainted(pokemon) ? "fnt" : (sim?.status || data?.status || "");
  let color = isFainted(pokemon) ? "§8" : (pokemon.active || context.chosenSwitches.has(index)) ? "§7" : "";
  return {
    text: tileText(data ? data.getTranslatedName() : { text: uuid }, color, data?.level ?? "?", status, hp, maxhp),
    icon: data ? getPokemonSpriteTexture(data) : undefined,
    bar: barTexture(isFainted(pokemon) ? 0 : hp, maxhp),
  };
}

function isFainted(pokemon: RequestPokemon) {
  return pokemon.condition.endsWith(" fnt") || pokemon.condition.startsWith("0");
}

// ---------------------------------------------------------------------------------------------
// Mochila
// ---------------------------------------------------------------------------------------------

async function showBagMenu(context: MenuContext): Promise<MenuResult<ActionResponse>> {
  let { player, battle } = context;
  while (true) {
    let entries = listBagItems(player);
    let showBallHint = battle.isPvW && battle.format.battleType === BattleTypes.SINGLES && hasPokeBall(player);
    if (entries.length === 0 && !showBallHint) {
      player.sendMessage(message.color("Gray", { translate: "cobblemon.port.battle.ui.no_items" }));
      return BACK;
    }
    let form = new ActionFormData()
      .title(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_LIST, { translate: "cobblemon.port.battle.ui.bag" }));
    entries.forEach(entry => form.button({ rawtext: [{ translate: entry.def.itemName }, { text: ` §7x${entry.amount}` }] }));
    if (showBallHint)
      form.button({ translate: "cobblemon.port.battle.ui.throw_ball" });
    form.button({ translate: "gui.back" });
    let response = await show(context, form);
    if (!response || response.selection === undefined)
      return CLOSED;
    if (response.selection < entries.length) {
      let result = await useBagItem(context, entries[response.selection]);
      if (result === BACK)
        continue;
      return result;
    }
    if (showBallHint && response.selection === entries.length) {
      // No Cobblemon a Poké Bola é arremessada, não usada pela mochila.
      player.sendMessage({ translate: "cobblemon.battle.throw_pokeball_prompt" });
      return CLOSED;
    }
    return BACK;
  }
}

async function useBagItem(context: MenuContext, entry: BagEntry): Promise<MenuResult<ActionResponse>> {
  let { request, battle, player } = context;
  let def = entry.def;
  let candidates = request.side.pokemon
    .map(pokemon => ({ pokemon, uuid: requestPokemonUUID(pokemon) }))
    .map(x => ({ ...x, data: safeData(battle, x.uuid), sim: getSimPokemon(battle, x.uuid) }))
    .filter(x => x.data && x.sim);
  let usable = candidates.filter(x => def.canUse(x.sim!, x.data!));
  if (usable.length === 0) {
    player.sendMessage(message.color("Red", message.battleMsg("bagitem.invalid")));
    return BACK;
  }
  while (true) {
    let form = switchForm(message.With("cobblemon.port.battle.ui.use_on", [{ translate: def.itemName }]), true);
    usable.slice(0, 6).forEach(({ pokemon, data, sim }, i) => {
      let status = sim!.status || (isFainted(pokemon) ? "fnt" : "");
      form.cell(BATTLE_SWITCH.SLOTS + i, tileText(data!.getTranslatedName(), "", data!.level, status, sim!.hp, sim!.maxhp), getPokemonSpriteTexture(data!), i)
        .cell(BATTLE_SWITCH.BARS + i, BLANK, barTexture(sim!.hp, sim!.maxhp));
    });
    let response = await show(context, form.build());
    if (!response || response.selection === undefined)
      return CLOSED;
    let chosen = form.actionAt(response.selection);
    if (chosen === undefined)
      return BACK;
    let target = usable[chosen];
    if (!def.selectsMove)
      return new BagItemActionResponse(def, target.uuid);
    let move = await chooseMoveForItem(context, def, target.sim!);
    if (move === BACK)
      continue;
    if (move === CLOSED)
      return CLOSED;
    return new BagItemActionResponse(def, target.uuid, move);
  }
}

/** Ether/Leppa: escolhe o golpe que recupera PP (só os que não estão cheios). */
async function chooseMoveForItem(context: MenuContext, def: BagItemDef, target: SimPokemon): Promise<MenuResult<string>> {
  let slots = target.baseMoveSlots.filter(slot => slot.pp < slot.maxpp).slice(0, 4);
  let form = moveForm({ translate: def.itemName }, { translate: "cobblemon.port.battle.ui.restore_pp" });
  slots.forEach((slot, i) => form.cell(BATTLE_MOVES.MOVES + i, renderMoveButton(slot.id, slot.pp, slot.maxpp, false, undefined, []), moveTypeKey(slot.id), i));
  let response = await show(context, form.build());
  if (!response || response.selection === undefined)
    return CLOSED;
  let chosen = form.actionAt(response.selection);
  return chosen === undefined ? BACK : slots[chosen].id;
}

// ---------------------------------------------------------------------------------------------
// Estado da batalha (corpo do menu)
// ---------------------------------------------------------------------------------------------

/** HP em barra, status e clima/terreno. Inimigos em %, os próprios em números (como o HUD do Cobblemon). */
export function renderBattleStatus(context: { actor: BattleActor; battle: PokemonBattle }): RawMessage {
  let { actor, battle } = context;
  let rawtext: RawMessage[] = [];
  let ownSide = actor.getSide();
  let lines: { pokemon: SimPokemon; own: boolean }[] = [];
  for (let side of [ownSide.getOppositeSide(), ownSide]) {
    for (let sideActor of side.actors) {
      for (let slot = 0; slot < sideActor.slotCount; slot++) {
        let sim = getSimActive(sideActor, slot);
        if (sim && !sim.fainted)
          lines.push({ pokemon: sim, own: sideActor === actor });
      }
    }
  }
  for (let { pokemon, own } of lines) {
    let data = safeData(battle, simPokemonUUID(pokemon));
    // Illusion: quem não é aliado vê o nome do disfarce (ActiveBattlePokemonDTO.fromPokemon).
    let active = battle.activePokemon.find(x => x?.data.uuid === data?.uuid);
    if (active && data) data = active.displayData(active.getSide() === ownSide);
    let percent = Math.ceil(100 * pokemon.hp / pokemon.maxhp);
    rawtext.push({ text: own ? "§a" : "§c" });
    rawtext.push(data ? data.getTranslatedName() : { text: pokemon.name });
    rawtext.push({ text: ` §7Lv.${pokemon.level}${pokemon.status ? ` ${statusLabels[pokemon.status] ?? ""}` : ""}§r ${renderHealthBar(pokemon.hp, pokemon.maxhp, 12)} ${own ? `${pokemon.hp}/${pokemon.maxhp}` : `${percent}%`}\n` });
  }
  let field = renderField(battle);
  if (field)
    rawtext.push({ text: `§7${field}` });
  return { rawtext };
}

function renderField(battle: PokemonBattle): string | undefined {
  let sim = getSimBattle(battle);
  if (!sim) return undefined;
  let parts: string[] = [];
  let weather = sim.field.weather;
  if (weather) parts.push(Dex.conditions.get(weather).name);
  if (sim.field.terrain) parts.push(Dex.conditions.get(sim.field.terrain).name);
  for (let id of Object.keys(sim.field.pseudoWeather)) parts.push(Dex.conditions.get(id).name);
  return parts.length ? parts.join(" · ") : undefined;
}

function pokemonNameAt(context: MenuContext, slot: number): RawMessage {
  let pokemon = context.request.side.pokemon[slot];
  let data = pokemon ? safeData(context.battle, requestPokemonUUID(pokemon)) : undefined;
  return data?.getTranslatedName() ?? { text: "?" };
}

function safeData(battle: PokemonBattle, uuid: string): PokemonData | undefined {
  try {
    return battle.getPokemon(uuid);
  }
  catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Aprender golpe depois da batalha
// ---------------------------------------------------------------------------------------------

/**
 * O Pokémon subiu de nível e tem um golpe novo, mas já conhece 4: pergunta qual esquecer.
 * No Cobblemon o golpe fica guardado (benched) e é trocado pelo resumo; aqui, se o jogador recusar ou
 * fechar a tela, o golpe também fica guardado em learnedMoves.
 */
export async function promptMoveReplacement(player: Player, pokemon: PokemonData, move: string): Promise<boolean> {
  move = toID(move);
  if (pokemon.moves.includes(move))
    return false;
  let form = new ActionFormData()
    .title({ translate: "cobblemon.ui.moves.forget" })
    .body(message.With("cobblemon.port.battle.move_learn.body", [pokemon, getMoveTranslation(move)]));
  pokemon.moves.forEach((known, i) => {
    let info = pokemon.movesInfo[i];
    form.button(renderMoveButton(known, info?.pp, info?.maxPp, false, undefined, []));
  });
  form.button(message.With("cobblemon.port.battle.move_learn.skip", [getMoveTranslation(move)]));
  let response: ActionFormResponse | undefined;
  for (let attempt = 0; attempt < 600 && player.isValid; attempt++) {
    response = await form.show(player);
    if (response.canceled && String(response.cancelationReason) === "UserBusy") {
      await wait(10);
      continue;
    }
    break;
  }
  // Relê o Pokémon depois da espera: a cópia recebida (da batalha) pode estar velha (itens, EXP, outra tela).
  // Nunca grava a cópia velha; se ele saiu do time/PC (troca, soltura), não faz nada.
  if (!player.isValid) return false;
  let current = readStoredPokemon(player, pokemon.uuid);
  if (!current || current.pokemon.moves.includes(move)) return false;
  let fresh = current.pokemon;
  let slot = response?.selection;
  let learned = false;
  if (slot !== undefined && slot < pokemon.moves.length) {
    let forgotten = pokemon.moves[slot];
    // O espaço escolhido é o do golpe mostrado na tela; na cópia atual ele pode estar em outro lugar.
    let freshSlot = fresh.moves.indexOf(forgotten);
    if (freshSlot !== -1)
      learned = teachMove(fresh, move, freshSlot);
    if (learned)
      player.sendMessage(message.With("cobblemon.port.battle.move_learn.replaced", [fresh, getMoveTranslation(forgotten), getMoveTranslation(move)]));
  }
  if (!learned) {
    teachMove(fresh, move);
    player.sendMessage(message.With("cobblemon.port.battle.move_learn.stored", [fresh, getMoveTranslation(move)]));
  }
  if (current.location.location === PCPlace.Team)
    fresh.tryUpdatePokemonOut();
  setPokemonToPCLocation(player, current.location, fresh);
  return learned;
}

/** Cópia atual do Pokémon no time (a entidade, se estiver fora da bola) ou no PC do jogador. */
function readStoredPokemon(player: Player, uuid: string): { pokemon: PokemonData; location: PCLocation } | undefined {
  if (!uuid) return undefined;
  let location = findPokemonLocation(player, uuid);
  if (!location) return undefined;
  let stored = getPokemonFromPCLocation(player, location);
  if (!stored || stored.uuid !== uuid) return undefined;
  if (location.location === PCPlace.Team) {
    let entity = stored.tryGetPokemonOut();
    let live = entity ? PokemonData.tryGetFromEntity(entity) : undefined;
    if (live && live.uuid === uuid) return { pokemon: live, location };
  }
  return { pokemon: stored, location };
}

/** PokemonData.teachMove (frente dados) ou troca direta se a API ainda não existir. */
function teachMove(pokemon: PokemonData, move: string, slot?: number): boolean {
  let api = pokemon as unknown as { teachMove?: (move: string, slot?: number) => boolean };
  if (typeof api.teachMove === "function")
    return api.teachMove(move, slot);
  let pp = Dex.moves.get(move).pp;
  if (slot === undefined) {
    if (!pokemon.learnedMoves.includes(move)) pokemon.learnedMoves.push(move);
    return true;
  }
  let old = pokemon.moves[slot];
  if (old && !pokemon.learnedMoves.includes(old)) pokemon.learnedMoves.push(old);
  pokemon.moves[slot] = move;
  pokemon.movesInfo[slot] = { pp, maxPp: pp, extraPp: 0 };
  return true;
}

/** Usado pelo menu de interação: o jogador está numa batalha e pode reabrir a tela? */
export function canReopenBattleMenu(actor: BattleActor) {
  return actor.type === ActorType.PLAYER && actor.mustChoose && !actor.battle.ended;
}
