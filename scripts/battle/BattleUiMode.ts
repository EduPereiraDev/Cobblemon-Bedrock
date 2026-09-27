/**
 * Frente batalha-minimizavel: a tela da batalha "minimizável" do Cobblemon 1.8.2 (andar enquanto a batalha acontece).
 * Pesquisa, evidências e decisões em `docs/pesquisa/7-batalha-minimizavel.md` e `docs/pendencias/batalha-minimizavel.md`.
 *
 * Modos (preferência por jogador em `cobblemon:battle_ui_mode`; `/cobblemon:battleui`):
 *   - `java` (PADRÃO): o estado `minimised` do Cobblemon (ClientBattle.kt:28).
 *       · A tela abre sozinha no começo da batalha (BattleInitializeHandler.kt:48) e a cada request enquanto a batalha
 *         estiver "aberta" (no Java a GUI fica aberta entre os turnos; aqui o form é refeito a cada request).
 *       · Fechar a tela (ESC/X) ou escolher "Fugir" MINIMIZA (BattleGUI.onClose, BattleGeneralActionSelection.kt:68).
 *         Minimizada, nenhum request abre a tela — nem a troca obrigatória depois de um desmaio: no Java o
 *         BattleMakeChoiceHandler só liga `mustChoose`; quem monta a troca é a GUI, se estiver aberta. O HUD esmaece as
 *         caixas (0,5) e pisca `cobblemon.battle.ui.actions_label` ("Você precisa escolher uma ação. Pressione %1$s.",
 *         BattleOverlay.kt:143-153). Sem timer (PokemonBattle.kt:514-522).
 *       · A "tecla R" do port (agachado + pular; no celular também duplo toque em Pular) alterna
 *         (PartySendBinding.toggleBattleScreen): minimizada → abre a tela; aberta esperando o turno → minimiza.
 *         Esperando com a batalha aberta, o HUD mostra `cobblemon.battle.ui.hide_label` (BattleGUI.kt:123-132).
 *       · Os caminhos antigos do port (interagir com o oponente/NPC, nova tentativa) sempre abrem a tela.
 *   - `hud` (opcional, não existe no Java): `java` + atalho. Minimizada, os 4 golpes aparecem acima da hotbar; o espaço
 *     selecionado da hotbar é o cursor (teclas 1–4, roda, LB/RB, toque no espaço) e a "tecla R" confirma. Espaços 5–9 =
 *     menu completo. Só singles sem troca obrigatória; o resto cai no aviso do `java`.
 *     Frente msd-fase1: com gimmick no request (item-chave), o espaço 5 alterna o gimmick (desligado → cada gimmick
 *     oferecido → desligado; o título diz qual está ligado) e os tiles passam a mostrar os golpes Z/Max; o golpe
 *     confirmado vai com o sufixo. Espaços 6–9 = menu completo.
 *   - `classic` (opcional): o comportamento antigo do port — a tela abre a cada turno; fechada, a dica vai para o chat.
 *
 * O desenho é o HUD do port (`ui/cobblemon_hud.json`, canal `B`): este módulo só calcula a visão
 * (`ui/BattleUiView.ts`); `ui/BattleHud.ts` manda.
 */
import {
  ButtonState, CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, CustomCommandSource, CustomCommandStatus, InputButton,
  InputMode, Player, RawMessage, ScriptEventSource, StartupEvent, system, world,
} from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import type { BattleActor } from "./BattleActor";
import type { RequestData, RequestMove } from "./Request";
import { MoveActionResponse } from "./ActionResponse";
import { GIMMICK_CHOICE, Gimmick, getGimmicks, gimmickLabelKey, hasActiveGimmick, moveTileInfo } from "./Gimmicks";
import { battleMap } from "./PokemonBattle";
import { PromptSource, setBattlePromptHooks } from "./BattlePromptHooks";
import { Dex } from "../showdown";
import { BATTLE_PROMPT, BattleMoveView } from "../ui/hudProtocol";
import { BattleUiView, setBattleUiViewProvider } from "../ui/BattleUiView";

export type { PromptSource } from "./BattlePromptHooks";

/** Ordem do menu e do comando (o padrão primeiro). */
export const BATTLE_UI_MODES = ["java", "hud", "classic"] as const;
export type BattleUiMode = (typeof BATTLE_UI_MODES)[number];
export const DEFAULT_BATTLE_UI_MODE: BattleUiMode = "java";

export const MODE_PROPERTY = "cobblemon:battle_ui_mode";
/** Compatibilidade com o protótipo: `scriptevent cobblemon:battle_ui_mode <modo>` (do console = padrão do mundo). */
export const SCRIPT_EVENT_ID = "cobblemon:battle_ui_mode";
export const COMMAND_NAME = "cobblemon:battleui";
const COMMAND_ENUM = "cobblemon:battleuimode";
/** Espaços da hotbar que viram golpes (1–4); os demais abrem o menu completo. */
export const MOVE_SLOTS = 4;
/** Intervalo do laço de limpeza do estado (ticks). */
export const CLEANUP_TICKS = 10;
/** Janela do duplo toque em Pular no celular (ticks). */
export const DOUBLE_JUMP_TICKS = 10;

/** Tipos com fundo no HUD (`pokedex/platform_base_<tipo>`). */
const HUD_TYPES = new Set(["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic",
  "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"]);

export function isBattleUiMode(value: unknown): value is BattleUiMode {
  return typeof value === "string" && (BATTLE_UI_MODES as readonly string[]).includes(value);
}

type PropertyHolder = Pick<Player, "getDynamicProperty" | "setDynamicProperty">;

/** Padrão do mundo (definido pelo console) → `java`. */
export function getWorldBattleUiMode(): BattleUiMode {
  try {
    const global = world.getDynamicProperty(MODE_PROPERTY);
    if (isBattleUiMode(global)) return global;
  }
  catch { }
  return DEFAULT_BATTLE_UI_MODE;
}

/** Modo do jogador → padrão do mundo → `java`. */
export function getBattleUiMode(player: PropertyHolder | undefined): BattleUiMode {
  try {
    const own = player?.getDynamicProperty(MODE_PROPERTY);
    if (isBattleUiMode(own)) return own;
  }
  catch { }
  return getWorldBattleUiMode();
}

/** Grava a preferência. `undefined` apaga (volta ao padrão do mundo). */
export function setBattleUiMode(player: PropertyHolder, mode: BattleUiMode | undefined) {
  player.setDynamicProperty(MODE_PROPERTY, mode);
}

// ---------------------------------------------------------------------------------------------
// Lógica pura (testada em tests/batalha-minimizavel.test.ts)
// ---------------------------------------------------------------------------------------------

/** Estado da batalha para um jogador (espelha ClientBattle.minimised). */
export interface UiState {
  /** Batalha a que o estado pertence (outra batalha começa do zero). */
  battleId: string;
  /** Começa false: a GUI abre sozinha no início da batalha. */
  minimised: boolean;
  /** Último request para o qual a tela foi aberta. */
  shownRequestId?: number;
  /** Modo HUD: request cuja escolha está no HUD. */
  hudRequestId?: number;
  /** Tick da última ação feita pelo gesto (um aperto não é tratado duas vezes). */
  lastGestureTick?: number;
  /** `classic`: request para o qual a dica do chat já foi mandada. */
  hintRequestId?: number;
  /** Frente msd-fase1: gimmick ligado no menu do HUD e o request a que ele vale. */
  hudGimmick?: Gimmick;
  hudGimmickRequestId?: number;
}

export interface PromptInput {
  mode: BattleUiMode;
  source: PromptSource;
  minimised: boolean;
  requestId: number;
  shownRequestId?: number;
  hudRequestId?: number;
  /** O request cabe no menu do HUD (singles, sem troca obrigatória). */
  hudEligible: boolean;
}

/**
 * - `open`: abre a tela (form);
 * - `prompt`: fica minimizado, com o aviso do Java no HUD;
 * - `hud`: fica minimizado, com o menu de golpes no HUD;
 * - `confirm`: confirma o item do HUD sob o cursor;
 * - `minimise`: tecla R com a "GUI aberta" esperando o turno → minimiza.
 */
export type PromptDecision = "open" | "prompt" | "hud" | "confirm" | "minimise";

export function decidePrompt(input: PromptInput): PromptDecision {
  if (input.mode === "classic") return "open";
  const hud = input.mode === "hud" && input.hudEligible;
  switch (input.source) {
    case "turn":
      if (!input.minimised) return "open";
      return hud ? "hud" : "prompt";
    case "reopen":
      return "open";
    case "toggle":
      if (hud && input.hudRequestId === input.requestId) return "confirm";
      if (input.minimised) return "open";
      // "GUI aberta", mas a tela deste request ainda não apareceu (animações do turno): a tecla R minimiza.
      if (input.shownRequestId !== input.requestId) return "minimise";
      return "open";
  }
}

export type HudChoice = { kind: "move"; index: number; move: RequestMove } | { kind: "gimmick" } | { kind: "menu" } | { kind: "none" };

/** Frente msd-fase1: espaço da hotbar que alterna o gimmick no menu do HUD (o 5º). */
export const GIMMICK_SLOT = MOVE_SLOTS;

/** Gimmicks do request no menu do HUD (singles: posição 0). */
export function hudGimmicks(request: RequestData | undefined): Gimmick[] {
  return getGimmicks(request?.active?.[0]);
}

/** Próximo estado do espaço 5: desligado → cada gimmick oferecido → desligado. */
export function nextHudGimmick(available: readonly Gimmick[], current: Gimmick | undefined): Gimmick | undefined {
  if (!available.length) return undefined;
  if (current === undefined) return available[0];
  const i = available.indexOf(current);
  return i < 0 || i + 1 >= available.length ? undefined : available[i + 1];
}

/** Golpe usável agora (mesma regra do BattleMoveset: PP > 0 e não desabilitado; Struggle sempre). */
export function isMoveUsable(move: RequestMove): boolean {
  if (move.id === "struggle") return true;
  return !move.disabled && (move.pp === undefined || move.pp > 0);
}

/**
 * O request cabe no HUD: singles (um Pokémon a comandar e um ator por lado), sem troca obrigatória, com golpes.
 * Multi também tem 1 posição por ator, mas o golpe pede alvo (2 inimigos) e o HUD não escolhe alvo.
 */
export function hudEligible(request: RequestData | undefined, slotCount: number, actorsPerSide = 1): boolean {
  if (!request || request.wait || request.forceSwitch?.some(x => x)) return false;
  if (slotCount !== 1 || actorsPerSide !== 1) return false;
  const moves = request.active?.[0]?.moves;
  return !!moves && moves.length > 0;
}

/** O que o espaço da hotbar `slot` (0..8) escolhe no menu do HUD. */
export function hudChoiceAt(request: RequestData | undefined, slot: number): HudChoice {
  if (slot === GIMMICK_SLOT && hudGimmicks(request).length) return { kind: "gimmick" };
  if (slot >= MOVE_SLOTS) return { kind: "menu" };
  const move = request?.active?.[0]?.moves?.[slot];
  if (!move) return { kind: "none" };
  return { kind: "move", index: slot, move };
}

/** Rótulo do gesto da "tecla R" conforme o último tipo de entrada usado (no toque: duplo toque em Pular). */
export function gestureKey(mode: InputMode | string | undefined): string {
  switch (mode) {
    case InputMode.KeyboardAndMouse: return "cobblemon.port.battle_ui.key.keyboard";
    case InputMode.Gamepad: return "cobblemon.port.battle_ui.key.gamepad";
    case InputMode.Touch: return "cobblemon.port.battle_ui.key.touch";
    default: return "cobblemon.port.battle_ui.key.generic";
  }
}

/**
 * Frente msd-fase1: linha do gimmick no título do menu do HUD ("Espaço 5: Megaevolução (ligado)"). Undefined sem
 * gimmick no request.
 */
export function hudGimmickLine(available: readonly Gimmick[], on: Gimmick | undefined): RawMessage | undefined {
  if (!available.length) return undefined;
  const shown = on ?? available[0];
  return {
    translate: "cobblemon.port.battle_ui.hud_gimmick",
    with: { rawtext: [{ translate: gimmickLabelKey(shown) }, { translate: on ? "cobblemon.port.battle_ui.gimmick_on" : "cobblemon.port.battle_ui.gimmick_off" }] },
  };
}

/** Aviso do Java minimizado (texto na cauda do título; o HUD pulsa). */
export function promptMessage(gesture: string): RawMessage {
  return { translate: "cobblemon.battle.ui.actions_label", with: { rawtext: [{ translate: gesture }] } };
}

/** Texto da GUI aberta esperando o turno (BattleGUI.kt:123-132). */
export function hideMessage(gesture: string): RawMessage {
  return { translate: "cobblemon.battle.ui.hide_label", with: { rawtext: [{ translate: gesture }] } };
}

/** Título do menu de golpes do modo HUD (com a linha do gimmick, quando há). */
export function hudTitleMessage(gesture: string, gimmickLine?: RawMessage): RawMessage {
  const title: RawMessage = { translate: "cobblemon.port.battle_ui.hud_title", with: { rawtext: [{ translate: gesture }] } };
  return gimmickLine ? { rawtext: [title, { text: "\n" }, gimmickLine] } : title;
}

/** Tipo do golpe para o fundo do tile (tipos sem textura caem em `normal`). */
function moveType(id: string): string {
  let type = "normal";
  try { type = Dex.moves.get(id).type.toLowerCase(); } catch { }
  return HUD_TYPES.has(type) ? type : "normal";
}

/**
 * Golpes do request para o menu do HUD (BattleMoveSelection). Frente msd-fase1: com Z/Max ligado (ou já em Dynamax),
 * o tile mostra o golpe Z/Max (id e tipo dele; golpe Z de status mostra o golpe base) e só é usável se houver.
 */
export function hudMoves(request: RequestData, gimmick?: Gimmick): BattleMoveView[] {
  const moveset = request.active?.[0];
  const gimmickTiles = !!moveset && (gimmick === "zmove" || gimmick === "max" || hasActiveGimmick(moveset));
  return (moveset?.moves ?? []).slice(0, MOVE_SLOTS).map((move, i) => {
    const pp = move.id !== "struggle" && move.maxpp ? `${move.pp}/${move.maxpp}` : "";
    if (!gimmickTiles) return { id: move.id, type: moveType(move.id), pp, usable: isMoveUsable(move) };
    const tile = moveTileInfo(moveset!, i, gimmick);
    const type = tile.type.toLowerCase();
    return { id: tile.zStatus ? tile.baseId : tile.displayId, type: HUD_TYPES.has(type) ? type : "normal", pp, usable: tile.selectable };
  });
}

// ---------------------------------------------------------------------------------------------
// Estado por jogador
// ---------------------------------------------------------------------------------------------

const states = new Map<string, UiState>();

/** Gimmick ligado no HUD para este request (o de outro request não vale). */
function hudGimmickOf(state: UiState | undefined, requestId: number): Gimmick | undefined {
  return state && state.hudGimmickRequestId === requestId ? state.hudGimmick : undefined;
}

/** hudEligible com o formato da batalha do ator. */
function actorHudEligible(actor: BattleActor): boolean {
  let actorsPerSide = 1;
  try { actorsPerSide = actor.battle.format.battleType.actorsPerSide; } catch { }
  return hudEligible(actor.request, actor.slotCount, actorsPerSide);
}
/** Ator de cada jogador com estado (limpeza e HUD). */
const actors = new Map<string, BattleActor>();

function stateOf(actor: BattleActor): UiState | undefined {
  const player = actor.Player;
  if (!player) return undefined;
  let state = states.get(player.id);
  if (!state || state.battleId !== actor.battle.battleId) {
    state = { battleId: actor.battle.battleId, minimised: false };
    states.set(player.id, state);
  }
  actors.set(player.id, actor);
  ensureLoop();
  return state;
}

/** Para os testes e a depuração: estado atual do jogador. */
export function getUiState(playerId: string): UiState | undefined {
  return states.get(playerId);
}

function forget(playerId: string) {
  states.delete(playerId);
  actors.delete(playerId);
  lastJump.delete(playerId);
}

function gestureOf(player: Player): string {
  try { return gestureKey(player.inputInfo.lastInputModeUsed); }
  catch { return gestureKey(undefined); }
}

/** Ator do jogador na batalha em que ele está (ou undefined). */
function actorOf(player: Player): BattleActor | undefined {
  const known = actors.get(player.id);
  if (known && !known.battle.ended) return known;
  let id: unknown;
  try { id = player.getDynamicProperty("in_battle"); } catch { return undefined; }
  return typeof id === "string" ? battleMap.get(id)?.getActorFromID(player.id) : undefined;
}

/**
 * Visão do HUD para o jogador agora (undefined = modo `classic`, espectador ou fora de batalha). Chamada pelo
 * `ui/BattleHud.ts` a cada atualização (2 ticks): o cursor acompanha a hotbar sem evento próprio.
 */
export function battleUiView(player: Player): BattleUiView | undefined {
  const mode = getBattleUiMode(player);
  if (mode === "classic") return undefined;
  const actor = actorOf(player);
  if (!actor || actor.battle.ended || actor.Player?.id !== player.id) return undefined;
  const state = states.get(player.id);
  const current = state && state.battleId === actor.battle.battleId ? state : undefined;
  const minimised = current?.minimised ?? false;
  // Tela aberta agora: nada no HUD além das caixas.
  if (actor.prompting) return { minimised: false, prompt: BATTLE_PROMPT.NONE };
  const gesture = gestureOf(player);
  if (actor.mustChoose && actor.request) {
    // Modo HUD minimizado: o menu aparece assim que o request chega (sem esperar as animações), como o aviso do Java.
    if (current && mode === "hud" && minimised && actorHudEligible(actor))
      current.hudRequestId = actor.requestId;
    // Só no modo `hud`: trocar de modo no meio da batalha não deixa o menu preso na tela.
    if (mode === "hud" && current?.hudRequestId === actor.requestId) {
      let cursor = 0;
      try { cursor = player.selectedSlotIndex; } catch { }
      const gimmick = hudGimmickOf(current, actor.requestId);
      const line = hudGimmickLine(hudGimmicks(actor.request), gimmick);
      return { minimised: true, prompt: BATTLE_PROMPT.MENU, cursor, moves: hudMoves(actor.request, gimmick), text: hudTitleMessage(gesture, line) };
    }
    if (minimised) return { minimised: true, prompt: BATTLE_PROMPT.ACTIONS, text: promptMessage(gesture) };
    if (current?.shownRequestId !== actor.requestId) return { minimised: false, prompt: BATTLE_PROMPT.HIDE, text: hideMessage(gesture) };
    return { minimised: false, prompt: BATTLE_PROMPT.NONE };
  }
  // Sem escolha pendente (animações do turno, PvP esperando o oponente).
  return minimised ? { minimised: true, prompt: BATTLE_PROMPT.NONE } : { minimised: false, prompt: BATTLE_PROMPT.HIDE, text: hideMessage(gesture) };
}

// ---------------------------------------------------------------------------------------------
// Ganchos
// ---------------------------------------------------------------------------------------------

function confirmHud(actor: BattleActor, state: UiState, player: Player): boolean {
  const choice = hudChoiceAt(actor.request, player.selectedSlotIndex);
  if (choice.kind === "menu") {
    // Menu completo: a tela abre; fechá-la volta ao HUD (onMenuClosed).
    state.hudRequestId = undefined;
    state.shownRequestId = actor.requestId;
    return false;
  }
  if (choice.kind === "gimmick") {
    // Frente msd-fase1: o espaço 5 alterna o gimmick (BattleGimmickButton.toggle, som da bigorna).
    state.hudGimmick = nextHudGimmick(hudGimmicks(actor.request), hudGimmickOf(state, actor.requestId));
    state.hudGimmickRequestId = actor.requestId;
    try { player.playSound("random.anvil_land", { volume: 0.5 }); } catch { }
    return true;
  }
  const gimmick = hudGimmickOf(state, actor.requestId);
  const usable = choice.kind === "move" && (gimmick === "zmove" || gimmick === "max" || hasActiveGimmick(actor.request!.active![0])
    ? moveTileInfo(actor.request!.active![0], choice.index, gimmick).selectable
    : isMoveUsable(choice.move));
  if (choice.kind === "none" || !usable) {
    try { player.playSound("note.bass"); } catch { }
    return true;
  }
  try { player.playSound("cobblemon.gui.click"); } catch { }
  state.hudRequestId = undefined;
  if (!actor.submitResponses([new MoveActionResponse(choice.move.id, undefined, gimmick ? GIMMICK_CHOICE[gimmick] : undefined)])) {
    // Escolha recusada pela validação: a tela resolve.
    state.shownRequestId = actor.requestId;
    return false;
  }
  return true;
}

function beforePrompt(actor: BattleActor, source: PromptSource): boolean {
  const player = actor.Player;
  const mode = getBattleUiMode(player);
  if (!player || mode === "classic") return false;
  const state = stateOf(actor);
  if (!state) return false;
  if (source === "toggle") state.lastGestureTick = system.currentTick;
  const decision = decidePrompt({
    mode, source, minimised: state.minimised, requestId: actor.requestId, shownRequestId: state.shownRequestId,
    hudRequestId: state.hudRequestId, hudEligible: actorHudEligible(actor),
  });
  switch (decision) {
    case "open":
      state.minimised = false;
      state.hudRequestId = undefined;
      state.shownRequestId = actor.requestId;
      return false;
    case "confirm":
      return confirmHud(actor, state, player);
    case "minimise":
      state.minimised = true;
      return true;
    case "hud":
      state.hudRequestId = actor.requestId;
      return true;
    case "prompt":
      return true;
  }
}

/** Dica no chat do modo `classic` (a antiga, agora citando a "tecla R" do port). */
function sendClassicHint(actor: BattleActor, player: Player, requestId: number) {
  const state = stateOf(actor);
  if (!state || state.hintRequestId === requestId) return;
  state.hintRequestId = requestId;
  try { player.sendMessage({ rawtext: [{ text: "§7" }, { translate: "cobblemon.port.battle_ui.reopen_hint", with: { rawtext: [{ translate: gestureOf(player) }] } }] }); } catch { }
}

function onMenuClosed(actor: BattleActor, requestId: number): boolean {
  const player = actor.Player;
  if (!player) return false;
  const mode = getBattleUiMode(player);
  if (mode === "classic") {
    sendClassicHint(actor, player, requestId);
    return true;
  }
  const state = stateOf(actor);
  if (!state) return false;
  state.minimised = true;
  if (mode === "hud" && requestId === actor.requestId && actorHudEligible(actor))
    state.hudRequestId = requestId;
  return true;
}

function onChoiceSent(actor: BattleActor) {
  const player = actor.Player;
  const state = player ? states.get(player.id) : undefined;
  if (state) state.hudRequestId = undefined;
}

/**
 * Tecla R sem escolha pendente (esperando o oponente, PartySendBinding.toggleBattleScreen): alterna minimizado/aberto.
 * Com escolha pendente quem cuida é o `beforePrompt` (a tecla R do port chama `promptPlayerForRequest("toggle")`).
 * @returns o novo `minimised`, ou undefined se não se aplica.
 */
export function toggleMinimised(player: Player): boolean | undefined {
  if (getBattleUiMode(player) === "classic") return undefined;
  const actor = actorOf(player);
  if (!actor || actor.battle.ended || actor.mustChoose || actor.prompting) return undefined;
  const state = stateOf(actor);
  if (!state || state.lastGestureTick === system.currentTick) return undefined;
  state.lastGestureTick = system.currentTick;
  state.minimised = !state.minimised;
  return state.minimised;
}

// ---------------------------------------------------------------------------------------------
// Celular: duplo toque em Pular
// ---------------------------------------------------------------------------------------------

const lastJump = new Map<string, number>();

/**
 * No toque o botão Agachar dura ≤ 1 tick (InputButton.Sneak, Learn), então "agachado + pular" quase nunca acontece.
 * Duplo toque em Pular vira a tecla R — mas só no toque, com escolha pendente e a batalha minimizada (andar pulando
 * com a batalha aberta ou sem nada a escolher não faz nada). No `classic`, com escolha pendente e a tela fechada.
 * @returns true se o gesto foi usado.
 */
export function handleJumpTap(player: Player, now = system.currentTick): boolean {
  let touch = false;
  try { touch = player.inputInfo.lastInputModeUsed === InputMode.Touch; } catch { }
  if (!touch) return false;
  const last = lastJump.get(player.id);
  lastJump.set(player.id, now);
  if (last === undefined || now - last > DOUBLE_JUMP_TICKS) return false;
  lastJump.delete(player.id);
  const actor = actorOf(player);
  if (!actor || actor.battle.ended || !actor.mustChoose || actor.prompting) return false;
  if (getBattleUiMode(player) !== "classic") {
    const state = states.get(player.id);
    if (!state || state.battleId !== actor.battle.battleId || !state.minimised) return false;
  }
  actor.promptPlayerForRequest("toggle");
  return true;
}

// ---------------------------------------------------------------------------------------------
// Laço de limpeza, entradas, comando e scriptevent
// ---------------------------------------------------------------------------------------------

let loopId: number | undefined;

function tick() {
  for (const [id, actor] of [...actors]) {
    const state = states.get(id);
    const player = actor.Player;
    if (!state || !player?.isValid || actor.battle.ended || actor.battle.battleId !== state.battleId) forget(id);
  }
  if (actors.size === 0 && loopId !== undefined) {
    system.clearRun(loopId);
    loopId = undefined;
  }
}

function ensureLoop() {
  if (loopId === undefined) loopId = system.runInterval(tick, CLEANUP_TICKS);
}

/** Troca de modo: o menu do HUD pendente sai (do jogador, ou de todos quando muda o padrão do mundo). */
function clearHudMenus(player: PropertyHolder | undefined) {
  const id = (player as { id?: unknown } | undefined)?.id;
  for (const [playerId, state] of states)
    if (!player || playerId === id) state.hudRequestId = undefined;
}

/** Aplica um valor do comando/scriptevent (`java`, `hud`, `classic`, `default`, `status`). Devolve a resposta. */
export function applyModeCommand(message: string, player: PropertyHolder | undefined): RawMessage {
  const value = message.trim().toLowerCase();
  const modeName = (mode: BattleUiMode): RawMessage => ({ translate: `cobblemon.port.battle_ui.mode.${mode}` });
  if (value === "" || value === "status") {
    const mode = getBattleUiMode(player);
    return { translate: "cobblemon.port.battle_ui.mode_status", with: { rawtext: [modeName(mode)] } };
  }
  if (value === "default") {
    clearHudMenus(player);
    if (player) setBattleUiMode(player, undefined);
    else world.setDynamicProperty(MODE_PROPERTY, undefined);
    return { translate: "cobblemon.port.battle_ui.mode_set", with: { rawtext: [modeName(getBattleUiMode(player))] } };
  }
  if (!isBattleUiMode(value))
    return { translate: "cobblemon.port.battle_ui.mode_invalid", with: [value, [...BATTLE_UI_MODES, "default"].join(", ")] };
  clearHudMenus(player);
  // O jogador grava a escolha explícita (vale mesmo se o mundo mudar de padrão); o mundo apaga quando volta ao `java`.
  if (player) setBattleUiMode(player, value);
  else world.setDynamicProperty(MODE_PROPERTY, value === DEFAULT_BATTLE_UI_MODE ? undefined : value);
  return { translate: "cobblemon.port.battle_ui.mode_set", with: { rawtext: [modeName(value)] } };
}

/** Menu de escolha do modo (o `/cobblemon:battleui` sem argumento). */
export async function showBattleUiMenu(player: Player, attempt = 0): Promise<void> {
  const current = getBattleUiMode(player);
  const form = new ActionFormData()
    .title({ translate: "cobblemon.port.battle_ui.menu_title" })
    .body({ translate: "cobblemon.port.battle_ui.menu_body" });
  for (const mode of BATTLE_UI_MODES) {
    form.button({
      rawtext: [
        { text: mode === current ? "§2✔ " : "" },
        { translate: `cobblemon.port.battle_ui.mode.${mode}` },
        { text: "\n§8" },
        { translate: `cobblemon.port.battle_ui.mode.${mode}.desc` },
      ],
    });
  }
  const response = await form.show(player);
  if (response.canceled) {
    // Chat ainda fechando depois do comando: tenta de novo por ~2 s.
    if (response.cancelationReason === FormCancelationReason.UserBusy && attempt < 20 && player.isValid)
      system.runTimeout(() => { void showBattleUiMenu(player, attempt + 1); }, 2);
    return;
  }
  const mode = BATTLE_UI_MODES[response.selection ?? -1];
  if (mode) player.sendMessage(applyModeCommand(mode, player));
}

/**
 * `/cobblemon:battleui [java|hud|classic|default|status]`: preferência por jogador. Sem argumento abre o menu. Do
 * console/servidor muda o padrão do mundo.
 */
export function registerBattleUiCommand(event: StartupEvent) {
  const registry = event.customCommandRegistry;
  try { registry.registerEnum(COMMAND_ENUM, [...BATTLE_UI_MODES, "default", "status"]); }
  catch (e) { console.warn(`battleui: enum não registrado: ${e}`); return; }
  try {
    registry.registerCommand({
      name: COMMAND_NAME,
      description: "Battle screen mode: java (default) | hud | classic / Modo da tela de batalha: java (padrão) | hud | classic.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      optionalParameters: [{ name: COMMAND_ENUM, type: CustomCommandParamType.Enum }],
    }, (origin: CustomCommandOrigin, value?: string) => {
      const source = origin.initiator ?? origin.sourceEntity;
      const player = source instanceof Player ? source : undefined;
      if (!player && origin.sourceType !== CustomCommandSource.Server)
        return { status: CustomCommandStatus.Failure, message: "Only players or the server console can use this command." };
      system.run(() => {
        try {
          if (player && !value) { void showBattleUiMenu(player); return; }
          const reply = applyModeCommand(value ?? "status", player);
          if (player) player.sendMessage(reply);
          else console.info(`battleui: ${JSON.stringify(reply)}`);
        }
        catch (e) { console.warn(`battleui: ${e}`); }
      });
      return { status: CustomCommandStatus.Success };
    });
  }
  catch (e) { console.warn(`Não foi possível registrar ${COMMAND_NAME}: ${e}`); }
}

let registered = false;

/** Liga os ganchos, a visão do HUD e as entradas (idempotente). */
export function registerBattleUiModes() {
  if (registered) return;
  registered = true;
  setBattlePromptHooks({ beforePrompt, onMenuClosed, onChoiceSent });
  setBattleUiViewProvider(battleUiView);
  try {
    system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id !== SCRIPT_EVENT_ID) return;
      const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
      if (!player && event.sourceType !== ScriptEventSource.Server) return;
      try {
        const reply = applyModeCommand(event.message, player);
        if (player) player.sendMessage(reply);
        else console.info(`battle_ui_mode: ${JSON.stringify(reply)}`);
      }
      catch (e) { console.warn(`battle_ui_mode: ${e}`); }
    });
    world.afterEvents.playerButtonInput.subscribe(({ player }) => {
      try {
        if (player.getComponent("minecraft:riding")?.entityRidingOn) return;
        // Agachado + pular = tecla R do port (pokemon/PartySelection.ts → promptPlayerForRequest("toggle")). Aqui só o
        // caso sem escolha pendente (PvP esperando o oponente).
        if (player.isSneaking) { toggleMinimised(player); return; }
        handleJumpTap(player);
      }
      catch { }
    }, { buttons: [InputButton.Jump], state: ButtonState.Pressed });
    world.afterEvents.playerLeave.subscribe(({ playerId }) => forget(playerId));
  }
  catch { /* fora do jogo */ }
}
