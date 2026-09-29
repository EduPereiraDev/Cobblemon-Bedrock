/**
 * Bloco de habitat no mundo (HabitatBlock.kt + HabitatBlockEntity.TICKER + HabitatBlockRenderer + tela HabitatEditGUI).
 *
 * Frente habitat-mimic — regra do Java: o bloco tem RenderShape.INVISIBLE e o HabitatBlockRenderer desenha o bloco
 * imitado (`mimicId`, padrão minecraft:stone); só quem SEGURA o item de habitat vê o próprio bloco. `useWithoutItem`
 * só abre o editor com player.canUseGameMasterBlocks() (operador + criativo) e o onUse ainda exige criativo;
 * getDrops: criativo não solta nada, senão solta o item do bloco imitado; colisão de cubo cheio.
 * No Bedrock não dá para desenhar um bloco diferente por jogador, então:
 * - o bloco técnico vira o PRÓPRIO bloco imitado no 1º tick (âncoras das estruturas, blocos antigos de mundos já
 *   existentes) ou ao ser colocado (item de habitat); o habitat passa a viver só no registro por posição
 *   (MachineStore "habitat", dynamic property do mundo) que o spawner já lia;
 * - quem segura o item de habitat vê um contorno de partículas (só para ele) em volta dos habitats próximos;
 * - interagir no bloco imitado de um habitat abre o editor só para operador em criativo (como no Java);
 * - quebrar: criativo não solta nada; fora do criativo solta o item do bloco imitado (e não o drop vanilla);
 *   nos dois casos o registro some.
 * - Laço global (1 tick): REDSTONE pela borda de subida do sinal dos vizinhos (a cada 2 ticks), gatilho TICK e limpeza
 *   dos ids spawnados (a cada 10 ticks, nos habitats ativados de chunk carregado) e no máximo uma ativação por tick.
 * A lógica de spawn fica em scripts/spawning/Habitats.ts e Spawner.runHabitatSpawner.
 */
import {
  Block, BlockPermutation, BlockVolume, Dimension, EntityComponentTypes, EquipmentSlot, GameMode, ItemStack, Player, RawMessage, ScriptEventSource, system, Vector3, world,
} from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { HABITAT_POOLS } from "../../generated/scripts/habitats";
import { debugProbesEnabled, getConfig } from "../Config";
import {
  activationBudget, applyHabitats, checkHabitatInWorld, defaultSettings, DEFAULT_POOL, ensureSavedHabitats, forgetHabitat, HABITAT_BLOCK, habitatAt,
  habitatByKey, habitatClock, habitatStates, habitatStore, HabitatSettings, HabitatState, HabitatTrigger, isHabitatBlockType, normalizeBlockId,
  PhaseOrder, pruneSpawned, registerHabitat, settingsForBlock, unregisterHabitat,
} from "../spawning/Habitats";
import { positionsAround, runHabitatSpawner, selectFromPool, spawnActionEntity } from "../spawning/Spawner";
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

/**
 * HabitatBlockEntity.TICKER dos habitats ativados (o bloco imitado não tem tick próprio): confere se o bloco ainda
 * está lá (chunk carregado), renova o registro, limpa os ids mortos (a cada 20 ticks) e põe o gatilho TICK na fila.
 */
export function refreshActivatedHabitats(now = habitatClock.tick()) {
  ensureSavedHabitats(maxLevel());
  for (const state of habitatStates()) {
    if (state.settings.style !== "activated") continue;
    if (!checkHabitatInWorld(state, now)) continue;
    if (now % 20 < 10 && state.spawned.size) pruneSpawned(state, entityExists);
    // TICK: no Java tenta todo tick; aqui entra na fila a cada 10 ticks (uma ativação por tick, watchdog).
    if (state.settings.trigger === "TICK") enqueueActivation(state);
  }
}

/** Um passo do laço (a cada tick): redstone a cada 2 ticks, ativados a cada 10 e uma ativação da fila. */
export function habitatLoop() {
  const now = habitatClock.tick();
  if (now % 10 === 0) refreshActivatedHabitats(now);
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

// ---------------------------------------------------------------------------------------------
// Bloco técnico → bloco imitado + registro por posição (frente habitat-mimic)

/** Conversões feitas nesta sessão (sonda). */
export const habitatMimicStats = { conversions: 0, failures: 0 };

/** Permutação do bloco imitado; undefined se o id não existir no Bedrock. */
export function mimicPermutation(settings: Pick<HabitatSettings, "mimicId" | "mimicStates">): BlockPermutation | undefined {
  const id = normalizeBlockId(settings.mimicId);
  try {
    const perm = BlockPermutation.resolve(id, (settings.mimicStates ?? {}) as never);
    if (perm) return perm;
  }
  catch { /* estados que não existem nesta versão: tenta sem */ }
  try { return BlockPermutation.resolve(id) ?? undefined; }
  catch { return undefined; }
}

/** O que fica salvo: habitat de estrutura sem edição vai compacto (pool + bloco imitado); o resto, completo. */
export function storedSettings(s: HabitatSettings): Partial<HabitatSettings> {
  if (s.preset === "structure") {
    const out: Partial<HabitatSettings> = { preset: "structure", poolId: s.poolId, mimicId: s.mimicId };
    if (s.mimicStates && Object.keys(s.mimicStates).length) out.mimicStates = s.mimicStates;
    return out;
  }
  const { preset: _preset, ...full } = s;
  return full;
}

/**
 * Troca o bloco técnico pelo bloco imitado e passa o habitat para o registro por posição. Configuração: a salva
 * (editor), senão a da estrutura (pool + bloco imitado no estado), senão a padrão (imita minecraft:stone).
 * Undefined se o bloco não for o técnico.
 */
export function convertHabitatBlock(block: Block): HabitatState | undefined {
  if (block.typeId !== HABITAT_BLOCK) return undefined;
  const settings = settingsForBlock(block, maxLevel());
  let perm = mimicPermutation(settings);
  if (!perm) {
    // Id de bloco que não existe no Bedrock: imita o padrão do HabitatBlockEntity.
    settings.mimicId = "minecraft:stone";
    delete settings.mimicStates;
    perm = mimicPermutation(settings);
  }
  const key = blockKey(block.dimension.id, block.location);
  habitatStore.set(key, storedSettings(settings));
  const state = registerHabitat(block.dimension.id, block.location, settings);
  try {
    if (perm) block.setPermutation(perm);
    habitatMimicStats.conversions++;
  }
  catch (e) {
    // O registro salvo aceita o bloco técnico: o próximo tick tenta de novo.
    habitatMimicStats.failures++;
    console.warn(`[habitat] conversão para ${settings.mimicId}: ${e}`);
  }
  return state;
}

/** onTick do componente: só blocos técnicos têm tick (âncoras de estrutura e blocos antigos) → convertem. */
export function onHabitatTick(block: Block) {
  ensureLoop();
  convertHabitatBlock(block);
}

/**
 * onRandomTick do componente: mesmo caminho (garante a migração se o tick agendado não vier). O gatilho RANDOM_TICK
 * existe no enum do 1.8.2, mas o HabitatBlock não recebe random ticks, então lá ele nunca dispara.
 */
export function onHabitatRandomTick(block: Block) {
  convertHabitatBlock(block);
}

/** Colocado pelo item de habitat: vira o bloco imitado (minecraft:stone por padrão) e cria o registro. */
export function onHabitatPlaced(block: Block) {
  ensureLoop();
  convertHabitatBlock(block);
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

/**
 * player.canUseGameMasterBlocks() (criativo + nível de permissão ≥ 2 do Java = operador) + criativo do onUse
 * (HabitatBlock.useWithoutItem / HabitatBlockEntity.onUse). No Bedrock: criativo e operador (permissão de jogador
 * Operator ou nível de comando ≥ GameDirectors).
 */
export function canEdit(player: Player): boolean {
  try {
    if (player.getGameMode() !== GameMode.Creative) return false;
    return Number(player.commandPermissionLevel ?? 0) >= 1 || Number(player.playerPermissionLevel ?? 0) >= 2;
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

/**
 * Grava a configuração, atualiza o registro e o bloco (HabitatBlockEntity.applySettings): bloco técnico converte;
 * bloco imitado troca se o "Mimic Block ID" mudou.
 */
export function saveHabitatSettings(block: Block, settings: HabitatSettings) {
  const full: HabitatSettings = { ...settings };
  delete full.preset; // editado: grava completo
  const mimicChanged = normalizeBlockId(full.mimicId) !== normalizeBlockId(settingsForBlock(block, maxLevel()).mimicId);
  if (mimicChanged) delete full.mimicStates;
  habitatStore.set(blockKey(block.dimension.id, block.location), full);
  registerHabitat(block.dimension.id, block.location, full);
  if (block.typeId === HABITAT_BLOCK) {
    applyVisualStates(block, full);
    convertHabitatBlock(block);
    return;
  }
  if (!isHabitatBlockType(full, block.typeId) || mimicChanged) {
    const perm = mimicPermutation(full);
    try { if (perm) block.setPermutation(perm); }
    catch (e) { console.warn(`[habitat] troca do bloco imitado: ${e}`); }
  }
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
  if (!block.isValid || (block.typeId !== HABITAT_BLOCK && !habitatAt(block.dimension.id, block.location))) return;
  const next = settingsFromForm(response.formValues as (string | number | boolean | undefined)[], current, max);
  if (!next) {
    player.sendMessage(t("cobblemon.ui.edit.habitat.validation.level_range"));
    return;
  }
  if (!mimicPermutation(next)) {
    // Bloco imitado que não existe no Bedrock: mantém o atual.
    player.sendMessage({ rawtext: [t("cobblemon.ui.edit.habitat.mimic_id"), { text: `: ${next.mimicId} ✗` }] });
    next.mimicId = current.mimicId;
    next.mimicStates = current.mimicStates;
  }
  saveHabitatSettings(block, next);
}

// ---------------------------------------------------------------------------------------------
// Habitat como bloco imitado: interação, quebra e contorno para quem segura o item (frente habitat-mimic)

/** Item de habitat na mão principal ou secundária (HabitatBlockRenderer: mainHandItem ?: offhandItem). */
export function holdsHabitatItem(player: Player): boolean {
  try {
    const eq = player.getComponent(EntityComponentTypes.Equippable);
    return eq?.getEquipment(EquipmentSlot.Mainhand)?.typeId === HABITAT_BLOCK || eq?.getEquipment(EquipmentSlot.Offhand)?.typeId === HABITAT_BLOCK;
  }
  catch { return false; }
}

/** Pontos do contorno de um bloco (8 cantos + meio das 12 arestas), um pouco para fora das faces. */
export function markerPoints(pos: Vector3): Vector3[] {
  const lo = -0.04, hi = 1.04, mid = 0.5;
  const out: Vector3[] = [];
  for (const x of [lo, hi]) for (const y of [lo, hi]) for (const z of [lo, hi]) out.push({ x: pos.x + x, y: pos.y + y, z: pos.z + z });
  for (const a of [lo, hi]) for (const b of [lo, hi]) {
    out.push({ x: pos.x + mid, y: pos.y + a, z: pos.z + b });
    out.push({ x: pos.x + a, y: pos.y + mid, z: pos.z + b });
    out.push({ x: pos.x + a, y: pos.y + b, z: pos.z + mid });
  }
  return out;
}

/** Habitats a mostrar para um jogador: mesma dimensão, até `range` blocos, os `max` mais perto. */
export function habitatsNear(dimensionId: string, at: Vector3, range = MARKER_RANGE, max = MARKER_MAX): HabitatState[] {
  const near: { state: HabitatState; d: number }[] = [];
  for (const state of habitatStates()) {
    if (state.dimensionId !== dimensionId) continue;
    const dx = state.pos.x + 0.5 - at.x, dy = state.pos.y + 0.5 - at.y, dz = state.pos.z + 0.5 - at.z;
    if (Math.abs(dx) > range || Math.abs(dy) > range || Math.abs(dz) > range) continue;
    near.push({ state, d: dx * dx + dy * dy + dz * dz });
  }
  return near.sort((a, b) => a.d - b.d).slice(0, max).map(n => n.state);
}

const MARKER_TICKS = 10;
const MARKER_RANGE = 48;
const MARKER_MAX = 24;
const MARKER_PARTICLE = "minecraft:basic_flame_particle";
const MARKER_SMOKE = "minecraft:basic_smoke_particle";

/** Contorno (partículas só para o jogador) dos habitats perto de quem segura o item de habitat. */
function showHabitatMarkers() {
  let players: Player[];
  try { players = world.getAllPlayers(); }
  catch { return; }
  for (const player of players) {
    if (!holdsHabitatItem(player)) continue;
    ensureSavedHabitats(maxLevel());
    for (const state of habitatsNear(player.dimension.id, player.location)) {
      try {
        for (const p of markerPoints(state.pos)) player.spawnParticle(MARKER_PARTICLE, p);
        player.spawnParticle(MARKER_SMOKE, { x: state.pos.x + 0.5, y: state.pos.y + 1.1, z: state.pos.z + 0.5 });
      }
      catch { /* fora do mundo carregado */ }
    }
  }
}

/** Som de quebra pelo tipo do bloco imitado (o evento vanilla foi cancelado). */
export function breakSoundFor(mimicId: string): string {
  const id = normalizeBlockId(mimicId);
  if (/log|wood|roots|planks|stem|hyphae/.test(id)) return "dig.wood";
  if (/leaves|grass_block|mycelium|nylium|moss|azalea/.test(id)) return "dig.grass";
  if (/sand/.test(id) && !/sandstone/.test(id)) return "dig.sand";
  if (/gravel|dirt|mud|clay|podzol/.test(id)) return "dig.gravel";
  if (/snow/.test(id)) return "dig.snow";
  return "dig.stone";
}

/** Item que o habitat solta fora do criativo (HabitatBlock.getDrops: ItemStack(bloco imitado)). */
export function mimicDrop(settings: Pick<HabitatSettings, "mimicId" | "mimicStates">): ItemStack | undefined {
  try {
    const fromBlock = mimicPermutation(settings)?.getItemStack(1);
    if (fromBlock) return fromBlock;
  }
  catch { /* sem item de bloco */ }
  try { return new ItemStack(normalizeBlockId(settings.mimicId), 1); }
  catch { return undefined; }
}

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

/** Quebra fora do criativo (evento vanilla cancelado): tira o bloco, solta o item do imitado e apaga o registro. */
export function breakMimicHabitat(dimension: Dimension, location: Vector3, state: HabitatState): boolean {
  forgetHabitat(state.key);
  let block: Block | undefined;
  try { block = dimension.getBlock(location); }
  catch { return false; }
  if (!block || !isHabitatBlockType(state.settings, block.typeId)) return false;
  try { block.setType("minecraft:air"); }
  catch { return false; }
  const center = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
  try { dimension.playSound(breakSoundFor(state.settings.mimicId), center); }
  catch { /* sem som */ }
  const item = mimicDrop(state.settings);
  if (!item) return false;
  try { dimension.spawnItem(item, center); }
  catch { return false; }
  return true;
}

/** beforeEvents.playerBreakBlock num habitat imitado. Exportado para os testes. */
export function onMimicHabitatBreak(event: { block: Block; player: Player; cancel: boolean }): void {
  const { block, player } = event;
  const state = habitatAt(block.dimension.id, block.location);
  if (!state || block.typeId === HABITAT_BLOCK) return; // bloco técnico: o custom component cuida
  const dimension = block.dimension;
  const location = { x: block.location.x, y: block.location.y, z: block.location.z };
  if (isCreative(player)) {
    // Criativo: a quebra vanilla segue (sem drop) e o registro some.
    system.run(() => forgetHabitat(state.key));
    return;
  }
  event.cancel = true;
  system.run(() => { breakMimicHabitat(dimension, location, state); });
}

/** beforeEvents.playerInteractWithBlock num habitat imitado: editor só para operador em criativo. Exportado para os testes. */
export function onMimicHabitatInteract(event: { block: Block; player: Player; itemStack?: ItemStack; isFirstEvent: boolean; cancel: boolean }, open = openHabitatEditor): boolean {
  const { block, player } = event;
  const state = habitatAt(block.dimension.id, block.location);
  if (!state || block.typeId === HABITAT_BLOCK) return false;
  if (!canEdit(player)) return false; // não-op / fora do criativo: interação vanilla normal
  // Agachado com item na mão: o Java usa o item (colocar bloco etc.) em vez do bloco.
  if (player.isSneaking && event.itemStack) return false;
  event.cancel = true;
  if (event.isFirstEvent) {
    system.run(() => {
      if (!player.isValid || !block.isValid) return;
      void Promise.resolve(open(player, block)).catch(e => console.warn(`[habitat] editor: ${e}`));
    });
  }
  return true;
}

let habitatsStarted = false;

/** Liga eventos e laços dos habitats imitados. Chamado por startMachines (scripts/machines/index.ts). */
export function startHabitats() {
  if (habitatsStarted) return;
  habitatsStarted = true;
  ensureLoop();
  world.beforeEvents.playerBreakBlock.subscribe(event => {
    try { onMimicHabitatBreak(event); }
    catch (e) { console.warn(`[habitat] quebra: ${e}`); }
  });
  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    try { onMimicHabitatInteract(event); }
    catch (e) { console.warn(`[habitat] interação: ${e}`); }
  });
  system.runInterval(() => {
    try { showHabitatMarkers(); }
    catch (e) { console.warn(`[habitat] contorno: ${e}`); }
  }, MARKER_TICKS);
  registerHabitatProbe();
}

// ---------------------------------------------------------------------------------------------
// Sonda de console (config enableDebugProbes; só do console do servidor)
//   scriptevent cobblemon:hab_list [x y z [raio]]   habitats registrados (perto do ponto): pool, estilo, bloco no mundo
//   scriptevent cobblemon:hab_spawn <x> <y> <z> [n]  escolhe (e cria, se n > 0) spawns naturais perto do ponto e diz
//                                                    quantas vieram das spawns do habitat
//   scriptevent cobblemon:hab_scan <x> <y> <z> [r]   blocos técnicos (cobblemon:habitat_block) e habitats no cubo (r ≤ 24)

function probeLog(msg: string) {
  console.warn(`[habitat-mimic] ${msg}`);
}

function registerHabitatProbe() {
  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (!event.id.startsWith("cobblemon:hab_") || event.sourceEntity || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    try { runProbe(event.id.slice("cobblemon:hab_".length), event.message.trim().split(/\s+/).filter(Boolean)); }
    catch (e) { probeLog(`erro: ${e}`); }
  });
}

function runProbe(cmd: string, args: string[]) {
  ensureSavedHabitats(maxLevel());
  const dim = world.getDimension("overworld");
  const n = args.map(Number);
  const at = n.length >= 3 && n.slice(0, 3).every(Number.isFinite) ? { x: n[0], y: n[1], z: n[2] } : undefined;
  if (cmd === "list") {
    const list = at ? habitatsNear(dim.id, at, n[3] || 256, 50) : habitatStates().slice(0, 50);
    probeLog(`registrados=${habitatStates().length} salvos=${habitatStore.keys().length} conversões=${habitatMimicStats.conversions} falhas=${habitatMimicStats.failures}`);
    for (const s of list) {
      let type: string | undefined;
      try { type = dim.getBlock(s.pos)?.typeId; }
      catch { type = undefined; }
      probeLog(`  ${s.pos.x} ${s.pos.y} ${s.pos.z} pool=${s.settings.poolId} estilo=${s.settings.style} imita=${s.settings.mimicId} bloco=${type ?? "?"} alcance=${s.settings.rangeOfInfluence}`);
    }
    return;
  }
  if (cmd === "spawn" && at) {
    const positions = positionsAround(dim, at, 32, 16);
    applyHabitats(dim, positions, at, 32, 16, "world");
    const influenced = positions.filter(p => p.influences?.length).length;
    const actions = selectFromPool({ positions: positions.filter(p => p.influences?.length), maxSpawns: 8 });
    const fromHabitat = actions.filter(a => a.entry.id.startsWith("habitat_")).length;
    probeLog(`posições=${positions.length} sob habitat=${influenced} escolhidas=${actions.length} do habitat=${fromHabitat}: ${actions.map(a => a.species).join(", ")}`);
    const create = Math.max(0, Math.floor(n[3] || 0));
    let created = 0;
    for (const action of actions.slice(0, create)) if (spawnActionEntity(action)) created++;
    if (create) probeLog(`criados=${created}`);
    return;
  }
  if (cmd === "scan" && at) {
    const r = Math.max(1, Math.min(24, Math.floor(n[3] || 8)));
    const from = { x: at.x - r, y: at.y - r, z: at.z - r }, to = { x: at.x + r, y: at.y + r, z: at.z + r };
    const technical: string[] = [];
    for (const loc of dim.getBlocks(new BlockVolume(from, to), { includeTypes: [HABITAT_BLOCK] }, true).getBlockLocationIterator()) technical.push(`${loc.x} ${loc.y} ${loc.z}`);
    const inside = habitatStates().filter(s => s.dimensionId === dim.id && Math.abs(s.pos.x - at.x) <= r && Math.abs(s.pos.y - at.y) <= r && Math.abs(s.pos.z - at.z) <= r);
    probeLog(`scan r=${r}: técnicos=${technical.length}${technical.length ? ` [${technical.slice(0, 8).join("; ")}]` : ""} habitats=${inside.length} ${inside.map(s => `${s.pos.x} ${s.pos.y} ${s.pos.z}=${dim.getBlock(s.pos)?.typeId}`).join("; ")}`);
    return;
  }
  probeLog(`comando desconhecido: ${cmd}`);
}

export { defaultSettings };
