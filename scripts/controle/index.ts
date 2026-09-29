/**
 * Frente controle: runtime do item de controle "Poké Ball do time" (`cobblemon:party_control`).
 *
 * Substitui as teclas do Cobblemon Java (R, setas do overlay, M), que o Bedrock não deixa um add-on criar. Regras
 * (a lógica pura está em ./logic.ts):
 * - usar em pé (no ar ou num bloco sem interação)  → menu do time (sem time: a escolha do inicial, como o emote);
 * - agachado + usar (no ar ou num bloco)           → envio rápido (a "tecla R" de PartySelection.quickSend): solta/
 *   recolhe o selecionado onde o jogador olha; mirando um selvagem, batalha com o selecionado na frente; mirando um
 *   jogador, o menu de batalha/troca; em batalha, minimiza/reabre a tela;
 * - agachado + atacar (no ar, num bloco ou numa entidade) → próximo Pokémon do time (do 1º ao último e volta ao topo),
 *   sem quebrar o bloco nem dar dano; atacar um selvagem agachado começa a batalha com o selecionado;
 * - usar num Pokémon seu: em pé = menu do Pokémon; agachado = montar/ombro (sem montaria possível: menu do Pokémon).
 *   Com o item na mão, o resto da interação com Pokémon é a de mão vazia (main.ts chama handleControlPokemonInteract).
 *
 * O item nunca sai do inventário: `lockMode = inventory` (não pode ser dropado, posto em contêiner nem usado em
 * receita) e `keepOnDeath`. Rede de segurança: um laço a cada ENSURE_INTERVAL_TICKS garante exatamente 1 no
 * inventário de cada jogador (repõe, remove cópias, regrava a trava); itens no chão com esse tipo somem; contêineres
 * que o jogador abre perdem as cópias. Todo jogador recebe o item ao entrar (com ou sem time).
 */
import {
  Block, CommandPermissionLevel, Container, CustomCommandOrigin, CustomCommandStatus, Entity, EntityDamageCause, EntityHitEntityAfterEvent,
  EntityHurtBeforeEvent, HeldItemOption, ItemLockMode, ItemStack, ItemUseAfterEvent, Player, PlayerBreakBlockBeforeEvent,
  PlayerInteractWithBlockBeforeEvent, PlayerInteractWithEntityBeforeEvent, PlayerSwingStartAfterEvent, StartupEvent, system,
  world,
} from "@minecraft/server";
import {
  CONTROL_ITEM_ID, ENSURE_INTERVAL_TICKS, HINT_MAX_USES, HINT_SHOWS_PROPERTY, SlotInfo, USES_PROPERTY, counterValue, hintKey,
  isControlItem, isLeftClickSwing, isRepeat, planInventory, resolveBlockUseAction, resolvePokemonUseAction, resolveUseAction,
  shouldShowHint, swingFromUse, takesHeldItem,
} from "./logic";
import { QuickSendResult, cycleSelection, getSelectedSlot, quickSend } from "../pokemon/PartySelection";
import { FORBIDDEN_HELD_ITEMS } from "../pokemon/HeldItems";
import { isInteractiveBlock } from "../limitesB/paintingLogic";
import { PokemonData } from "../Pokemon";
import { canRidePokemon, canShoulderMount, isOnShoulder, startRiding, toggleShoulder } from "../entity";
import { isRidingPokemon } from "../entity/Riding";
import { openPCGui, showPokemonGUI } from "../GUI";
import { handlePokemonInteract } from "../events/ScriptEvents";

export * from "./logic";

// ---------------------------------------------------------------------------------------------
// Ações externas (injetadas em startControlItem; os testes trocam por fakes)

export interface ControlActions {
  inBattle(player: Player): boolean;
  hasTeam(player: Player): boolean;
  /** Menu do time (com time). */
  openParty(player: Player): void;
  /** Escolha do inicial (sem time). */
  offerStarter(player: Player): void;
  /** Já escolheu o inicial (time vazio com Pokémon só no PC ou soltos). */
  hasSelectedStarter(player: Player): boolean;
  /** PC (time vazio depois do inicial). */
  openPc(player: Player): void;
  quickSend(player: Player, aimed?: Entity): QuickSendResult;
  cycle(player: Player): void;
  /** Agachado + usar no próprio Pokémon: montar/ombro, ou o menu do Pokémon. */
  mountOrMenu(player: Player, target: Entity): void;
}

const noop = () => { };
let actions: ControlActions = {
  inBattle: () => false,
  hasTeam: () => false,
  openParty: noop,
  offerStarter: noop,
  hasSelectedStarter: () => false,
  openPc: player => { void openPCGui(player, 0); },
  quickSend: (player, aimed) => quickSend(player, getSelectedSlot(player), aimed),
  cycle: player => cycleSelection(player, 1),
  mountOrMenu: (player, target) => defaultMountOrMenu(player, target),
};

/**
 * Agachado + usar no próprio Pokémon com o item: ombro/montaria como a mão vazia (mesmo com item segurado no Pokémon);
 * sem montaria possível, o menu do Pokémon (nunca a troca de item segurado, que tiraria o item de controle da mão).
 */
function defaultMountOrMenu(player: Player, target: Entity) {
  if (isRidingPokemon(player, target)) return;
  if (actions.inBattle(player) || target.getProperty("cobblemon:in_battle") === true) {
    // Em batalha, o fluxo de mão vazia só avisa (a troca de item fica depois desse aviso).
    handlePokemonInteract(player, target, undefined);
    return;
  }
  const data = PokemonData.tryGetFromEntity(target);
  if ((isOnShoulder(target) || canShoulderMount(player, target, data)) && toggleShoulder(player, target)) return;
  if (canRidePokemon(player, target, data) && startRiding(player, target)) return;
  if (target.getProperty("cobblemon:busy") === true) return;
  void showPokemonGUI(target, player);
}

export function setControlActions(overrides: Partial<ControlActions>) {
  actions = { ...actions, ...overrides };
}

// ---------------------------------------------------------------------------------------------
// Item

/** Pilha nova do item: travada no inventário, mantida na morte, com a lore dos controles. */
export function createControlStack(): ItemStack {
  const stack = new ItemStack(CONTROL_ITEM_ID, 1);
  stack.lockMode = ItemLockMode.inventory;
  stack.keepOnDeath = true;
  try { stack.setLore([{ translate: "cobblemon.port.controle.lore1" }, { translate: "cobblemon.port.controle.lore2" }]); }
  catch { /* lore é só enfeite */ }
  return stack;
}

function inventoryOf(entity: Entity): Container | undefined {
  try { return entity.getComponent("minecraft:inventory")?.container; }
  catch { return undefined; }
}

function readControlSlots(container: Container): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item || !isControlItem(item.typeId)) continue;
    out.push({ slot, typeId: item.typeId, locked: item.lockMode !== ItemLockMode.none, keepOnDeath: item.keepOnDeath });
  }
  return out;
}

function cursorHasControl(player: Player): boolean {
  try { return isControlItem(player.getComponent("minecraft:cursor_inventory")?.item?.typeId); }
  catch { return false; }
}

export type EnsureResult = "ok" | "given" | "full" | "fixed" | "removed" | "invalid";

/** Já recebeu o item alguma vez: as reposições (drop, /clear) são silenciosas. */
export const RECEIVED_PROPERTY = "cobblemon:controle_received";

const fullWarned = new Map<string, number>();
const FULL_WARN_TICKS = 60 * 20;

/**
 * Garante exatamente 1 item no jogador (cursor + inventário): remove cópias, regrava trava/keepOnDeath e entrega
 * um se faltar. A mensagem de "recebeu" vai na primeira entrega (ou sempre, com `announce`).
 */
export function ensureControlItem(player: Player, announce?: boolean): EnsureResult {
  if (!player.isValid) return "invalid";
  const container = inventoryOf(player);
  if (!container) return "invalid";
  const plan = planInventory(readControlSlots(container), cursorHasControl(player));
  let result: EnsureResult = "ok";
  for (const slot of plan.remove) {
    container.setItem(slot, undefined);
    result = "removed";
  }
  if (plan.fix && plan.keep !== undefined) {
    const slot = container.getSlot(plan.keep);
    slot.lockMode = ItemLockMode.inventory;
    slot.keepOnDeath = true;
    result = "fixed";
  }
  if (!plan.give) return result;
  const empty = container.firstEmptySlot();
  if (empty === undefined) {
    // Inventário cheio: avisa de vez em quando e tenta de novo no próximo laço.
    const last = fullWarned.get(player.id);
    if (last === undefined || system.currentTick - last >= FULL_WARN_TICKS) {
      fullWarned.set(player.id, system.currentTick);
      player.sendMessage({ translate: "cobblemon.port.controle.full" });
    }
    return "full";
  }
  container.setItem(empty, createControlStack());
  fullWarned.delete(player.id);
  const first = player.getDynamicProperty(RECEIVED_PROPERTY) !== true;
  if (announce ?? first) player.sendMessage({ translate: "cobblemon.port.controle.received" });
  if (first) player.setDynamicProperty(RECEIVED_PROPERTY, true);
  return "given";
}

/** Remove as cópias do item de um contêiner fora do jogador (baú aberto, vitrine, carrinho...). */
export function purgeContainer(container: Container | undefined): number {
  if (!container) return 0;
  let removed = 0;
  try {
    for (let slot = 0; slot < container.size; slot++) {
      if (!isControlItem(container.getItem(slot)?.typeId)) continue;
      container.setItem(slot, undefined);
      removed++;
    }
  }
  catch { /* contêiner inválido */ }
  return removed;
}

/** Entidades de armazenamento dos blocos custom (scripts/world/Containers.ts). */
const STORAGE_TYPES = ["cobblemon:display_case_item", "cobblemon:machine_storage", "cobblemon:gilded_chest_storage"];

function purgeBlock(block: Block) {
  try {
    if (!block.isValid) return;
    purgeContainer(block.getComponent("minecraft:inventory")?.container);
    const center = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
    for (const entity of block.dimension.getEntities({ location: center, maxDistance: 1.2 })) {
      if (STORAGE_TYPES.includes(entity.typeId)) purgeContainer(inventoryOf(entity));
    }
  }
  catch { /* bloco descarregado */ }
}

/** Item no chão com o tipo do item de controle: some e quem ficou sem recebe de volta na hora. */
function removeIfControlDrop(entity: Entity) {
  try {
    if (!entity.isValid || entity.typeId !== "minecraft:item") return;
    if (!isControlItem(entity.getComponent("minecraft:item")?.itemStack.typeId)) return;
    entity.remove();
    system.run(() => {
      for (const player of world.getPlayers()) {
        try { ensureControlItem(player); } catch { }
      }
    });
  }
  catch { }
}

// ---------------------------------------------------------------------------------------------
// Dicas e contagem de usos

function isHoldingControl(player: Player): boolean {
  try { return isControlItem(inventoryOf(player)?.getItem(player.selectedSlotIndex)?.typeId); }
  catch { return false; }
}

function counters(player: Player) {
  return { shows: counterValue(player.getDynamicProperty(HINT_SHOWS_PROPERTY)), uses: counterValue(player.getDynamicProperty(USES_PROPERTY)) };
}

/** Mostra a dica dos controles na actionbar, se ainda couber (por jogador). */
export function maybeShowHint(player: Player): boolean {
  const current = counters(player);
  if (!shouldShowHint(current)) return false;
  let mode: string | undefined;
  try { mode = player.inputInfo.lastInputModeUsed; } catch { }
  try { player.onScreenDisplay.setActionBar({ translate: hintKey(mode) }); } catch { return false; }
  player.setDynamicProperty(HINT_SHOWS_PROPERTY, current.shows + 1);
  return true;
}

function countUse(player: Player) {
  try {
    const uses = counterValue(player.getDynamicProperty(USES_PROPERTY));
    if (uses < HINT_MAX_USES) player.setDynamicProperty(USES_PROPERTY, uses + 1);
  }
  catch { }
}

const wasHolding = new Map<string, boolean>();

function trackHolding(player: Player) {
  const holding = isHoldingControl(player);
  const before = wasHolding.get(player.id) ?? false;
  wasHolding.set(player.id, holding);
  if (holding && !before) maybeShowHint(player);
}

// ---------------------------------------------------------------------------------------------
// Entradas

const lastAirUse = new Map<string, number>();
const lastBlockUse = new Map<string, number>();
const lastSwing = new Map<string, number>();
const lastEntityInteract = new Map<string, number>();
const lastWildHit = new Map<string, number>();

function isRiding(player: Player): boolean {
  try { return !!player.getComponent("minecraft:riding")?.entityRidingOn; }
  catch { return false; }
}

function isPokemonEntity(entity: Entity): boolean {
  try { return entity.typeId.startsWith("cobblemon:") && !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon"); }
  catch { return false; }
}

function isWildPokemon(entity: Entity): boolean {
  try { return isPokemonEntity(entity) && entity.getProperty("cobblemon:wild") === true; }
  catch { return false; }
}

function heldControl(player: Player, stack?: ItemStack): boolean {
  return stack ? isControlItem(stack.typeId) : isHoldingControl(player);
}

/** Menu do time; sem time, a escolha do inicial (como o emote); time vazio depois do inicial, o PC. */
function openPartyOrStarter(player: Player) {
  if (actions.hasTeam(player)) actions.openParty(player);
  else if (actions.hasSelectedStarter(player)) actions.openPc(player);
  else actions.offerStarter(player);
}

function runQuickSend(player: Player, aimed?: Entity) {
  const result = actions.quickSend(player, aimed);
  if (result === "fainted") player.onScreenDisplay.setActionBar({ translate: "cobblemon.port.party.selected_fainted" });
  else if (result === "empty") player.onScreenDisplay.setActionBar({ translate: "cobblemon.port.controle.empty_slot" });
  return result;
}

/** Clique direito no ar (itemUse). Adiado um tick para ceder a vez à interação com entidade do mesmo clique. */
export function onItemUse(event: Pick<ItemUseAfterEvent, "source" | "itemStack">) {
  const player = event.source;
  if (!isControlItem(event.itemStack?.typeId)) return;
  const tick = system.currentTick;
  if (isRepeat(lastAirUse, player.id, tick)) return;
  const action = resolveUseAction({ sneaking: player.isSneaking, riding: isRiding(player) });
  system.run(() => {
    if (!player.isValid) return;
    // O mesmo clique numa entidade ou num bloco já foi tratado por lá.
    for (const map of [lastEntityInteract, lastBlockUse]) {
      const at = map.get(player.id);
      if (at !== undefined && at >= tick - 1) return;
    }
    performUse(player, action);
  });
}

function performUse(player: Player, action: "party_menu" | "quick_send" | "none") {
  try {
    if (action === "party_menu") openPartyOrStarter(player);
    else if (action === "quick_send") runQuickSend(player);
    else return;
    countUse(player);
  }
  catch (e) { console.warn(`[controle] usar: ${e}`); }
}

/** Clique direito num bloco (before: dá para cancelar a interação vanilla). */
export function onInteractWithBlock(event: Pick<PlayerInteractWithBlockBeforeEvent, "player" | "block" | "itemStack" | "isFirstEvent" | "cancel">) {
  const { player, block } = event;
  if (!isControlItem(event.itemStack?.typeId)) return;
  const tick = system.currentTick;
  const repeat = isRepeat(lastBlockUse, player.id, tick) || !event.isFirstEvent;
  const action = resolveBlockUseAction(block.typeId, player.isSneaking, isRiding(player), isInteractiveBlock(block.typeId));
  if (action === "vanilla") {
    // Baú/barril aberto com o item na mão: tira dali qualquer cópia (a trava já impede pôr).
    system.run(() => purgeBlock(block));
    return;
  }
  event.cancel = true;
  // Segurar o botão repete o evento (isFirstEvent = false); o itemUse do mesmo clique cede a vez (lastBlockUse).
  if (repeat || action === "blocked") return;
  system.run(() => { if (player.isValid) performUse(player, action); });
}

/** Clique direito numa entidade: registra (para o itemUse ceder a vez) e bloqueia quem tomaria o item. */
export function onInteractWithEntity(event: Pick<PlayerInteractWithEntityBeforeEvent, "player" | "target" | "itemStack" | "cancel">) {
  if (!isControlItem(event.itemStack?.typeId)) return;
  lastEntityInteract.set(event.player.id, system.currentTick);
  if (takesHeldItem(event.target.typeId)) event.cancel = true;
}

/**
 * Chamado por main.ts (beforeEvents.playerInteractWithEntity) quando o alvo é um Pokémon e o jogador segura o item.
 * true = tratado aqui (evento cancelado, ação no próximo tick); false = seguir como mão vazia.
 */
export function handleControlPokemonInteract(event: Pick<PlayerInteractWithEntityBeforeEvent, "player" | "target" | "cancel">): boolean {
  const { player, target } = event;
  lastEntityInteract.set(player.id, system.currentTick);
  let own = false, wild = false;
  try {
    own = target.getDynamicProperty("owner_name") === player.name;
    wild = target.getProperty("cobblemon:wild") === true;
  }
  catch { return false; }
  const action = resolvePokemonUseAction({ sneaking: player.isSneaking, own, wild });
  if (action === "empty_hand") return false;
  event.cancel = true;
  system.run(() => {
    if (!player.isValid || !target.isValid) return;
    try {
      if (action === "wild_battle") runQuickSend(player, target);
      else actions.mountOrMenu(player, target);
      countUse(player);
    }
    catch (e) { console.warn(`[controle] Pokémon: ${e}`); }
  });
  return true;
}

/** Botão esquerdo (balanço do braço): agachado = próximo do time. Adiado para o acerto num selvagem ter a vez. */
export function onSwingStart(event: Pick<PlayerSwingStartAfterEvent, "player" | "heldItemStack" | "swingSource">) {
  const { player } = event;
  if (!isControlItem(event.heldItemStack?.typeId) || !isLeftClickSwing(event.swingSource)) return;
  const tick = system.currentTick;
  // Segurar o botão num bloco repete o balanço: só a primeira batida conta.
  if (isRepeat(lastSwing, player.id, tick)) return;
  const sneaking = player.isSneaking;
  if (!sneaking) return;
  system.runTimeout(() => {
    if (!player.isValid) return;
    const hit = lastWildHit.get(player.id);
    if (hit !== undefined && hit >= tick - 1) return;
    // Balanço do botão direito (usar/interagir no mesmo instante): não é o esquerdo.
    if (swingFromUse(tick, [lastAirUse.get(player.id), lastBlockUse.get(player.id), lastEntityInteract.get(player.id)])) return;
    if (isRiding(player) || actions.inBattle(player)) return;
    try {
      actions.cycle(player);
      countUse(player);
    }
    catch (e) { console.warn(`[controle] próximo: ${e}`); }
  }, 2);
}

/**
 * Agachado + atacar um selvagem com o item: batalha com o selecionado (sem dano: onEntityHurt cancela). Chega pelo
 * entityHitEntity e/ou pelo entityHurt (este pode ser o único quando o dano é cancelado); um por tick.
 */
function startBattleFromHit(player: Player, target: Entity) {
  const tick = system.currentTick;
  if (lastWildHit.get(player.id) === tick) return;
  lastWildHit.set(player.id, tick);
  system.run(() => {
    if (!player.isValid || !target.isValid) return;
    try {
      runQuickSend(player, target);
      countUse(player);
    }
    catch (e) { console.warn(`[controle] batalha: ${e}`); }
  });
}

export function onHitEntity(event: Pick<EntityHitEntityAfterEvent, "damagingEntity" | "hitEntity">) {
  const player = event.damagingEntity;
  if (!(player instanceof Player) || !player.isSneaking || !heldControl(player)) return;
  if (isWildPokemon(event.hitEntity)) startBattleFromHit(player, event.hitEntity);
}

/** Agachado com o item: o golpe não dá dano (e num selvagem começa a batalha). */
export function onEntityHurt(event: Pick<EntityHurtBeforeEvent, "damageSource" | "hurtEntity" | "cancel">) {
  const attacker = event.damageSource.damagingEntity;
  if (!(attacker instanceof Player) || event.damageSource.cause !== EntityDamageCause.entityAttack) return;
  try {
    if (!attacker.isSneaking || !heldControl(attacker)) return;
    event.cancel = true;
    if (event.hurtEntity && isWildPokemon(event.hurtEntity)) startBattleFromHit(attacker, event.hurtEntity);
  }
  catch { }
}

/** Agachado com o item: o bloco não quebra (criativo e sobrevivência). */
export function onBreakBlock(event: Pick<PlayerBreakBlockBeforeEvent, "player" | "itemStack" | "cancel">) {
  if (!isControlItem(event.itemStack?.typeId)) return;
  if (event.player.isSneaking) event.cancel = true;
}

// ---------------------------------------------------------------------------------------------
// Comando e início

/** `/cobblemon:controle`: devolve a Poké Ball do time (sem cheats). */
export function registerControlCommand(event: StartupEvent) {
  try {
    event.customCommandRegistry.registerCommand({
      name: "cobblemon:controle",
      description: "Gives you back the Party Poké Ball (party controls) / Devolve a Poké Ball do time (controles do time).",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    }, (origin: CustomCommandOrigin) => {
      const source = origin.initiator ?? origin.sourceEntity;
      if (!(source instanceof Player)) return { status: CustomCommandStatus.Failure, message: "Only players can use this command." };
      const player = source;
      system.run(() => {
        if (!player.isValid) return;
        try {
          const result = ensureControlItem(player, true);
          if (result === "ok" || result === "fixed" || result === "removed") player.sendMessage({ translate: "cobblemon.port.controle.already" });
          player.setDynamicProperty(USES_PROPERTY, 0);
          player.setDynamicProperty(HINT_SHOWS_PROPERTY, 0);
          maybeShowHint(player);
        }
        catch (e) { console.warn(`[controle] comando: ${e}`); }
      });
      return { status: CustomCommandStatus.Success };
    });
  }
  catch (e) { console.warn(`Não foi possível registrar cobblemon:controle: ${e}`); }
}

let started = false;

/** Liga o item de controle (worldLoad). Idempotente. */
export function startControlItem(externalActions: Partial<ControlActions>) {
  if (started) return;
  started = true;
  setControlActions(externalActions);
  // O item de controle nunca vira item segurado de Pokémon (agachar + usar, menu "Item segurado").
  FORBIDDEN_HELD_ITEMS.add(CONTROL_ITEM_ID);

  const guard = <T>(name: string, fn: (event: T) => void) => (event: T) => {
    try { fn(event); }
    catch (e) { console.warn(`[controle] ${name}: ${e}`); }
  };
  world.afterEvents.itemUse.subscribe(guard("itemUse", onItemUse));
  world.beforeEvents.playerInteractWithBlock.subscribe(guard("interactWithBlock", onInteractWithBlock));
  world.beforeEvents.playerInteractWithEntity.subscribe(guard("interactWithEntity", onInteractWithEntity));
  world.afterEvents.playerSwingStart.subscribe(guard("swing", onSwingStart), { heldItemOption: HeldItemOption.AnyItem });
  world.afterEvents.entityHitEntity.subscribe(guard("hitEntity", onHitEntity));
  world.beforeEvents.entityHurt.subscribe(guard("entityHurt", onEntityHurt));
  world.beforeEvents.playerBreakBlock.subscribe(guard("breakBlock", onBreakBlock));
  world.afterEvents.playerHotbarSelectedSlotChange.subscribe(guard("hotbar", ({ player }: { player: Player }) => trackHolding(player)));
  // Rede de segurança: item no chão some; contêiner de entidade aberto (carrinho, burro) perde as cópias.
  world.afterEvents.entitySpawn.subscribe(guard("entitySpawn", ({ entity }: { entity: Entity }) => removeIfControlDrop(entity)));
  world.afterEvents.entityLoad.subscribe(guard("entityLoad", ({ entity }: { entity: Entity }) => removeIfControlDrop(entity)));
  world.afterEvents.playerInteractWithEntity.subscribe(guard("interactedEntity", ({ target }: { target: Entity }) => {
    if (!(target instanceof Player)) system.run(() => { if (target.isValid) purgeContainer(inventoryOf(target)); });
  }));
  world.afterEvents.playerSpawn.subscribe(guard("playerSpawn", ({ player }: { player: Player }) => {
    system.runTimeout(() => { if (player.isValid) { ensureControlItem(player); trackHolding(player); } }, 5);
  }));
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    for (const map of [lastAirUse, lastBlockUse, lastSwing, lastEntityInteract, lastWildHit, wasHolding, fullWarned]) map.delete(playerId);
  });

  // Laço barato: exatamente 1 no inventário (36 leituras por jogador por segundo).
  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      try {
        ensureControlItem(player);
        trackHolding(player);
      }
      catch (e) { console.warn(`[controle] laço: ${e}`); }
    }
  }, ENSURE_INTERVAL_TICKS);
}

