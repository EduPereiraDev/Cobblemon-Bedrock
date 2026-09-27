/**
 * Bloco de habitat no mundo (HabitatBlock.kt + HabitatBlockEntity.TICKER + tela HabitatEditGUI).
 *
 * - Tick do bloco (a cada 10 ticks, `minecraft:tick` gerado pelo importador): registra/renova o bloco para o
 *   detector do spawner, limpa os ids de entidades mortas (a cada 20 ticks) e põe o gatilho TICK na fila.
 * - Laço global (1 tick): REDSTONE pela borda de subida do sinal dos vizinhos (a cada 2 ticks) e no máximo uma
 *   ativação por tick (watchdog).
 * - Interação em criativo (operador): tela de edição (ModalFormData) com os campos do HabitatEditGUI.
 * - Quebra: sai do registro, apaga a configuração e dropa o bloco imitado fora do criativo (getDrops).
 * A lógica de spawn fica em scripts/spawning/Habitats.ts e Spawner.runHabitatSpawner.
 */
import { Block, Dimension, GameMode, ItemStack, Player, RawMessage, system, Vector3, world } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { HABITAT_POOLS } from "../../generated/scripts/habitats";
import { getConfig } from "../Config";
import {
  activationBudget, defaultSettings, DEFAULT_POOL, habitatByKey, habitatClock, habitatStates, habitatStore, HabitatSettings, HabitatState,
  HabitatTrigger, PhaseOrder, pruneSpawned, registerHabitat, settingsForBlock, touchHabitat, unregisterHabitat,
} from "../spawning/Habitats";
import { runHabitatSpawner } from "../spawning/Spawner";
import { blockKey } from "./store";

const PHASE_ORDERS: PhaseOrder[] = ["SIMPLE", "FIXED_RANDOM", "FULL_RANDOM"];
const TRIGGERS: HabitatTrigger[] = ["REDSTONE", "TICK", "RANDOM_TICK"];

function maxLevel(): number {
  try { return getConfig().maxPokemonLevel ?? 100; }
  catch { return 100; }
}

/** Estados visuais do bloco (HabitatBlock.ACTIVATED_STYLE / CANCELS_REGULAR_SPAWNS). */
export function visualStates(s: HabitatSettings): { activated: boolean; cancels: boolean } {
  return s.style === "activated"
    ? { activated: true, cancels: s.cancelledNaturalSpawningRange > 0 }
    : { activated: false, cancels: s.replaceSpawns };
}

function applyVisualStates(block: Block, s: HabitatSettings) {
  const { activated, cancels } = visualStates(s);
  try {
    block.setPermutation(block.permutation
      .withState("cobblemon:activated_style" as never, activated as never)
      .withState("cobblemon:cancels_regular_spawns" as never, cancels as never));
  }
  catch { /* bloco sem os estados */ }
}

/** Dispara o estilo ativado uma vez (ActivatedHabitatSpawning.activate). */
export function activateHabitat(state: HabitatState, dimension: Dimension, random: () => number = Math.random): number {
  const budget = activationBudget(state, random);
  if (budget <= 0) return 0;
  return runHabitatSpawner(state, dimension, budget).length;
}

function entityExists(id: string): boolean {
  try { return world.getEntity(id)?.isValid === true; }
  catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Laço global: gatilho REDSTONE (borda de subida) e fila de ativações (no máximo uma por tick, porque cada
// ativação varre a zona do bloco; várias no mesmo tick estourariam o watchdog).

const activationQueue: string[] = [];
const queued = new Set<string>();
let loopStarted = false;
let lastSlowWarning = -Infinity;
/** Blocos sem tick há mais que isso (chunk parado) não são lidos pelo laço. */
const ACTIVE_TICKS = 40;

export function enqueueActivation(state: HabitatState) {
  if (queued.has(state.key)) return;
  queued.add(state.key);
  activationQueue.push(state.key);
}

/** HabitatBlockEntity.TICKER (REDSTONE): world.getDirectSignalTo(pos) ≈ maior sinal dos 6 vizinhos (e do próprio bloco). */
export function redstoneSignalAt(dimension: Dimension, pos: Vector3): number {
  let best = 0;
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    try {
      const power = dimension.getBlock({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz })?.getRedstonePower();
      if (typeof power === "number" && power > best) best = power;
    }
    catch { /* fora do mundo carregado */ }
  }
  return best;
}

/** Borda de subida do sinal: ativa uma vez por pulso. Retorna se ativou. */
export function updateRedstone(state: HabitatState, signal: number): boolean {
  if (state.receivingSignal && signal <= 0) state.receivingSignal = false;
  else if (!state.receivingSignal && signal > 0) {
    state.receivingSignal = true;
    enqueueActivation(state);
    return true;
  }
  return false;
}

/** Um passo do laço (a cada tick): redstone a cada 2 ticks e uma ativação da fila. */
export function habitatLoop() {
  const now = habitatClock.tick();
  if (now % 2 === 0) {
    for (const state of habitatStates()) {
      if (state.settings.style !== "activated" || state.settings.trigger !== "REDSTONE" || now - state.lastSeen > ACTIVE_TICKS) continue;
      let dimension: Dimension;
      try { dimension = world.getDimension(state.dimensionId); }
      catch { continue; }
      updateRedstone(state, redstoneSignalAt(dimension, state.pos));
    }
  }
  const key = activationQueue.shift();
  if (key === undefined) return;
  queued.delete(key);
  const state = habitatByKey(key);
  if (!state || state.settings.style !== "activated") return;
  const t0 = Date.now();
  try { activateHabitat(state, world.getDimension(state.dimensionId)); }
  catch (e) { console.warn(`[habitat] ativação: ${e}`); }
  const spent = Date.now() - t0;
  if (spent > 20 && t0 - lastSlowWarning > 10000) {
    lastSlowWarning = t0;
    console.warn(`[habitat] ativação lenta: ${spent} ms (raio ${state.settings.spawnRange})`);
  }
}

function ensureLoop() {
  if (loopStarted) return;
  loopStarted = true;
  try {
    system.runInterval(() => {
      try { habitatLoop(); }
      catch (e) { console.warn(`[habitat] laço: ${e}`); }
    }, 1);
  }
  catch { loopStarted = false; }
}

/** onTick do componente (a cada 10 ticks). */
export function onHabitatTick(block: Block) {
  ensureLoop();
  const state = touchHabitat(block, maxLevel());
  const now = habitatClock.tick();
  if (now % 20 < 10 && state.spawned.size) pruneSpawned(state, entityExists);
  // TICK: no Java tenta todo tick; aqui entra na fila a cada tick do bloco (10 ticks).
  if (state.settings.style === "activated" && state.settings.trigger === "TICK") enqueueActivation(state);
}

/**
 * onRandomTick do componente: só renova o registro. O gatilho RANDOM_TICK existe no enum do 1.8.2, mas o
 * HabitatBlock não recebe random ticks (sem `randomTicks()` nem `randomTick`), então lá ele nunca dispara.
 */
export function onHabitatRandomTick(block: Block) {
  touchHabitat(block, maxLevel());
}

export function onHabitatPlaced(block: Block) {
  ensureLoop();
  const state = touchHabitat(block, maxLevel());
  applyVisualStates(block, state.settings);
}

// Quebra: onBreak e onPlayerBreak chegam juntos para a mesma quebra; junta os dois e decide o drop uma vez.
const pendingRemovals = new Map<string, { dimension: Dimension; location: Vector3; mimic: string; player?: Player }>();

/** Quebra: remove registro e configuração; fora do criativo dropa o bloco imitado (HabitatBlock.getDrops). */
export function onHabitatRemoved(dimension: Dimension, location: Vector3, player?: Player) {
  const key = blockKey(dimension.id, location);
  let entry = pendingRemovals.get(key);
  if (!entry) {
    entry = { dimension, location: { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) }, mimic: habitatStore.get(key)?.mimicId ?? "minecraft:stone" };
    pendingRemovals.set(key, entry);
    unregisterHabitat(dimension.id, location);
    habitatStore.delete(key);
    try { system.run(() => finishHabitatRemoval(key)); }
    catch { finishHabitatRemoval(key); }
  }
  if (player) entry.player = player;
}

/** Drop da quebra (uma vez por posição). Exportado para os testes. */
export function finishHabitatRemoval(key: string): boolean {
  const entry = pendingRemovals.get(key);
  pendingRemovals.delete(key);
  if (!entry) return false;
  let creative = false;
  try { creative = entry.player?.getGameMode() === GameMode.Creative; }
  catch { creative = false; }
  if (creative) return false;
  try { entry.dimension.spawnItem(new ItemStack(entry.mimic, 1), { x: entry.location.x + 0.5, y: entry.location.y + 0.5, z: entry.location.z + 0.5 }); }
  catch { return false; }
  return true;
}

/** player.canUseGameMasterBlocks() + criativo (HabitatBlock.useWithoutItem / HabitatBlockEntity.onUse). */
function canEdit(player: Player): boolean {
  try {
    if (player.getGameMode() !== GameMode.Creative) return false;
    return Number(player.commandPermissionLevel ?? 0) >= 1;
  }
  catch { return false; }
}

const t = (key: string, ...with_: string[]): RawMessage => (with_.length ? { translate: key, with: with_ } : { translate: key });

/** Faixa "min-max" do editor. */
export function parseLevelRange(text: string, max: number): [number, number] | undefined {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(text) ?? /^\s*(\d+)\s*$/.exec(text);
  if (!m) return undefined;
  const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
  if (lo < 1 || hi > max || lo > hi) return undefined;
  return [lo, hi];
}

/** Aplica as respostas do formulário (ordem dos campos de openHabitatEditor). Undefined = inválido. */
export function settingsFromForm(values: (string | number | boolean | undefined)[], current: HabitatSettings, max: number): HabitatSettings | undefined {
  const pools = [DEFAULT_POOL, ...Object.keys(HABITAT_POOLS)];
  const levelRange = parseLevelRange(String(values[3] ?? ""), max);
  const chance = Number(values[9]);
  const maxSpawns = Number(values[12]);
  const perActivation = Number(values[13]);
  if (!levelRange || !(chance >= 0 && chance <= 1) || !(maxSpawns >= -1) || !(perActivation >= -1)) return undefined;
  const mimic = String(values[5] ?? "").trim() || current.mimicId;
  return {
    ...current,
    style: values[0] === 1 ? "natural" : "activated",
    poolId: pools[Number(values[1] ?? 0)] ?? DEFAULT_POOL,
    phaseOrder: PHASE_ORDERS[Number(values[2] ?? 0)] ?? "SIMPLE",
    levelRange,
    modifiers: String(values[4] ?? "").trim(),
    mimicId: mimic.includes(":") ? mimic : `minecraft:${mimic}`,
    replaceSpawns: values[6] === true,
    rangeOfInfluence: Math.max(0, Math.floor(Number(values[7] ?? current.rangeOfInfluence))),
    trigger: TRIGGERS[Number(values[8] ?? 0)] ?? "REDSTONE",
    chance,
    cancelledNaturalSpawningRange: Math.floor(Number(values[10] ?? -1)),
    spawnRange: Math.max(0, Math.floor(Number(values[11] ?? 16))),
    maxSpawns: Math.floor(maxSpawns),
    maxSpawnsPerActivation: Math.floor(perActivation),
  };
}

/** Grava a configuração, atualiza o registro e o visual do bloco (HabitatBlockEntity.applySettings). */
export function saveHabitatSettings(block: Block, settings: HabitatSettings) {
  habitatStore.set(blockKey(block.dimension.id, block.location), settings);
  registerHabitat(block.dimension.id, block.location, settings);
  applyVisualStates(block, settings);
}

/** Tela de edição (criativo + operador). */
export async function openHabitatEditor(player: Player, block: Block) {
  if (!canEdit(player)) return;
  const max = maxLevel();
  const current = settingsForBlock(block, max);
  const poolIds = [DEFAULT_POOL, ...Object.keys(HABITAT_POOLS)];
  const poolNames: RawMessage[] = [t("cobblemon.ui.edit.habitat.pool.custom"), ...Object.values(HABITAT_POOLS).map(p => t(p.name))];
  const form = new ModalFormData()
    .title(t("cobblemon.ui.edit.habitat"))
    .dropdown(t("cobblemon.ui.edit.habitat.mode", ""), [t("cobblemon.ui.edit.habitat.mode.activated"), t("cobblemon.ui.edit.habitat.mode.natural")], { defaultValueIndex: current.style === "natural" ? 1 : 0 })
    .dropdown(t("cobblemon.ui.edit.habitat.pool", ""), poolNames, { defaultValueIndex: Math.max(0, poolIds.indexOf(current.poolId)) })
    .dropdown(t("cobblemon.ui.edit.habitat.phase_order", ""), PHASE_ORDERS, { defaultValueIndex: Math.max(0, PHASE_ORDERS.indexOf(current.phaseOrder)) })
    .textField(t("cobblemon.ui.edit.habitat.level_range"), "1-100", { defaultValue: `${current.levelRange[0]}-${current.levelRange[1]}` })
    .textField(t("cobblemon.ui.edit.habitat.spawn.modifiers"), "shiny gender=male", { defaultValue: current.modifiers })
    .textField(t("cobblemon.ui.edit.habitat.mimic_id"), "minecraft:stone", { defaultValue: current.mimicId })
    .toggle(t("cobblemon.ui.edit.habitat.replace_spawns", ""), { defaultValue: current.replaceSpawns })
    .slider(t("cobblemon.ui.edit.habitat.influence_range"), 0, 64, { valueStep: 1, defaultValue: Math.min(64, current.rangeOfInfluence) })
    .dropdown(t("cobblemon.ui.edit.habitat.trigger", ""), TRIGGERS, { defaultValueIndex: Math.max(0, TRIGGERS.indexOf(current.trigger)) })
    .textField("Chance (0-1)", "1", { defaultValue: String(current.chance) })
    .slider(t("cobblemon.ui.edit.habitat.cancelled_range"), -1, 64, { valueStep: 1, defaultValue: Math.max(-1, Math.min(64, current.cancelledNaturalSpawningRange)) })
    .slider(t("cobblemon.ui.edit.habitat.spawn_range"), 0, 64, { valueStep: 1, defaultValue: Math.min(64, current.spawnRange) })
    .textField(t("cobblemon.ui.edit.habitat.max_spawns"), "-1", { defaultValue: String(current.maxSpawns) })
    .textField("Max Spawns Per Activation (-1 = ∞)", "1", { defaultValue: String(current.maxSpawnsPerActivation) });
  const response = await form.show(player);
  if (response.canceled || !response.formValues) return;
  if (!block.isValid || block.typeId !== "cobblemon:habitat_block") return;
  const next = settingsFromForm(response.formValues as (string | number | boolean | undefined)[], current, max);
  if (!next) {
    player.sendMessage(t("cobblemon.ui.edit.habitat.validation.level_range"));
    return;
  }
  saveHabitatSettings(block, next);
}

export { defaultSettings };
