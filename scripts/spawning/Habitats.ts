/**
 * Blocos de habitat do Cobblemon 1.8.2 (block/habitat/HabitatBlockEntity.kt + api/habitats/*).
 *
 * Um bloco de habitat tem um pool (data/cobblemon/habitat_pools, em generated/scripts/habitats.ts) e um de dois
 * estilos:
 * - **natural** (NaturalHabitatSpawning): num raio `rangeOfInfluence` do bloco, as spawns do pool são
 *   INJETADAS no spawn natural (SpawningInfluence.injectSpawns) do bucket sorteado; com `replaceSpawns` o
 *   spawn natural ali só aceita as spawns do próprio bloco (affectSpawnable). Vale para o spawner do mundo
 *   (e Poké Snack) quando o pool tem spawns fora de `fishing`, e para a pesca quando tem spawns `fishing`.
 * - **ativado** (ActivatedHabitatSpawning): o bloco é um spawner de área fixa (raio `spawnRange`, buckets
 *   `activatedHabitatBuckets`, até 16 Pokémon por chunk) disparado por redstone (borda de subida), a cada tick
 *   ou por random tick, com `chance`, `maxSpawns` (vivos do bloco) e `maxSpawnsPerActivation`; num raio
 *   `cancelledNaturalSpawningRange` nenhum outro spawner gera Pokémon. `modifiers` do bloco (PokemonProperties)
 *   valem para o que ele spawna.
 * Fases: cada spawn do pool vale só nas fases listadas; a fase muda a cada dia de jogo (24000 ticks) na ordem
 * SIMPLE / FIXED_RANDOM / FULL_RANDOM (HabitatBlockEntity.calculatePhase). Nível do bloco restringe/intersecta a
 * faixa de cada spawn (HabitatSpawn.createSpawnDetail).
 *
 * No Bedrock não há block entity: as configurações ficam numa dynamic property do mundo (MachineStore "habitat");
 * blocos colocados pelas estruturas convertidas trazem o pool no estado `cobblemon:habitat_pool(_hi)` e usam a
 * configuração das estruturas do Cobblemon (natural, replaceSpawns, FULL_RANDOM). A detecção (HabitatBlockDetector,
 * raio 128) usa um registro em memória alimentado pelas configurações salvas.
 *
 * Frente habitat-mimic: no Java o bloco é invisível (RenderShape.INVISIBLE) e o renderer desenha o bloco imitado
 * (`mimicId`, padrão minecraft:stone); só quem segura o item de habitat vê o próprio bloco. Aqui o bloco técnico
 * vira o PRÓPRIO bloco imitado no 1º tick/colocação (scripts/machines/habitat.ts) e o habitat passa a existir só
 * pelo registro por posição (dynamic property). Um habitat vale enquanto a posição tiver o bloco imitado (ou o bloco
 * técnico ainda não convertido, ou a forma em que o imitado vira sozinho: grama → terra etc.).
 */
import { Block, Dimension, Entity, Vector3, system, world } from "@minecraft/server";
import { BEST_SPAWNER_CONFIG, SpawnEntry } from "../../generated/scripts/spawns";
import { HABITAT_ANCHOR_MIMICS, HABITAT_ANCHOR_RANGES, HABITAT_POOLS, HabitatMimicBlock, HabitatSpawnEntry } from "../../generated/scripts/habitats";
import { PokemonProperties } from "../PokemonProperties";
import { MachineStore, blockKey, parseBlockKey } from "../machines/store";
import type { SpawnContext } from "./SpawnConditions";
import type { SpawnInfluence } from "./SpawnSelector";

export const HABITAT_BLOCK = "cobblemon:habitat_block";
/** Pool padrão do HabitatBlockEntity (vazio, "Custom"). */
export const DEFAULT_POOL = "cobblemon:custom__default_pool";
/** HabitatBlockDetector.RANGE. */
export const DETECTOR_RANGE = 128;
/** ActivatedHabitatSpawning: FixedAreaSpawner com maxPokemonPerChunk = 16. */
export const ACTIVATED_MAX_PER_CHUNK = 16;

export type PhaseOrder = "SIMPLE" | "FIXED_RANDOM" | "FULL_RANDOM";
export type HabitatTrigger = "REDSTONE" | "TICK" | "RANDOM_TICK";
export type HabitatStyle = "natural" | "activated";
/** Quem está spawnando: spawner do mundo, pesca, Poké Snack ou o spawner de um bloco ativado (`habitat:<chave>`). */
export type SpawnerId = "world" | "fishing" | "snack" | `habitat:${string}`;

export interface HabitatSettings {
  style: HabitatStyle;
  poolId: string;
  phaseOrder: PhaseOrder;
  /** Faixa de nível do bloco (padrão 1..maxPokemonLevel). */
  levelRange: [number, number];
  /** PokemonProperties aplicadas ao que o bloco ativado spawna. */
  modifiers: string;
  /** Bloco que ele imita (drop fora do criativo). No Bedrock é o bloco que fica no mundo no lugar do habitat. */
  mimicId: string;
  /** Estados do bloco imitado no Bedrock (folhas persistentes, eixo de toras). Ausente = permutação padrão. */
  mimicStates?: Record<string, string | number | boolean>;
  /** Registro compacto de estrutura: o resto vem de structureSettings(poolId) (expandSettings). */
  preset?: "structure";
  // NaturalHabitatSpawning
  replaceSpawns: boolean;
  rangeOfInfluence: number;
  // ActivatedHabitatSpawning
  trigger: HabitatTrigger;
  chance: number;
  cancelledNaturalSpawningRange: number;
  spawnRange: number;
  maxSpawns: number;
  maxSpawnsPerActivation: number;
}

/** Padrões do HabitatBlockEntity (estilo ativado, pool vazio) e dos dois estilos. */
export function defaultSettings(maxLevel = 100): HabitatSettings {
  return {
    style: "activated", poolId: DEFAULT_POOL, phaseOrder: "SIMPLE", levelRange: [1, maxLevel], modifiers: "", mimicId: "minecraft:stone",
    replaceSpawns: false, rangeOfInfluence: 16,
    trigger: "REDSTONE", chance: 1, cancelledNaturalSpawningRange: -1, spawnRange: 16, maxSpawns: -1, maxSpawnsPerActivation: 1,
  };
}

/** Configuração dos blocos de habitat das estruturas do Cobblemon (NBT dos moldes de habitats/*). */
export function structureSettings(poolId: string, maxLevel = 100): HabitatSettings {
  return {
    ...defaultSettings(maxLevel), style: "natural", poolId, phaseOrder: "FULL_RANDOM", replaceSpawns: true,
    rangeOfInfluence: HABITAT_ANCHOR_RANGES[poolId] ?? 16,
  };
}

/** Registro salvo (completo ou compacto de estrutura) → configuração completa. */
export function expandSettings(saved: Partial<HabitatSettings>, maxLevel = 100): HabitatSettings {
  if (saved.preset === "structure" && saved.poolId) return { ...structureSettings(saved.poolId, maxLevel), ...saved };
  return { ...defaultSettings(maxLevel), ...saved };
}

/** Bloco imitado da âncora de estrutura (estado cobblemon:habitat_mimic → HABITAT_ANCHOR_MIMICS[pool]). */
export function anchorMimic(poolId: string, index: number): HabitatMimicBlock {
  const list = HABITAT_ANCHOR_MIMICS[poolId] ?? [];
  return list[index] ?? list[0] ?? { name: "minecraft:stone", states: {} };
}

/**
 * Formas em que o bloco imitado vira sozinho no mundo (o bloco de habitat do Java não muda; aqui o imitado é um bloco
 * vanilla de verdade): grama/micélio/podzol sem luz → terra, terra → grama/micélio, nylium coberto → netherrack.
 */
const MIMIC_DRIFT: Record<string, readonly string[]> = {
  "minecraft:grass_block": ["minecraft:dirt"],
  "minecraft:mycelium": ["minecraft:dirt"],
  "minecraft:podzol": ["minecraft:dirt"],
  "minecraft:dirt": ["minecraft:grass_block", "minecraft:mycelium"],
  "minecraft:crimson_nylium": ["minecraft:netherrack"],
  "minecraft:warped_nylium": ["minecraft:netherrack"],
  "minecraft:mud": ["minecraft:clay"],
};

/** O bloco nesta posição ainda é o habitat (técnico não convertido, imitado ou forma derivada do imitado). */
export function isHabitatBlockType(settings: Pick<HabitatSettings, "mimicId">, typeId: string): boolean {
  if (typeId === HABITAT_BLOCK) return true;
  const mimic = normalizeBlockId(settings.mimicId);
  return typeId === mimic || (MIMIC_DRIFT[mimic]?.includes(typeId) ?? false);
}

/** "stone" → "minecraft:stone". */
export function normalizeBlockId(id: string): string {
  const t = id.trim();
  return t.includes(":") ? t : `minecraft:${t}`;
}

// ---------------------------------------------------------------------------------------------
// Pools, fases e entradas

/** Pool por índice do estado do bloco (1..N). */
export function poolByIndex(index: number): string | undefined {
  if (index <= 0) return undefined;
  for (const pool of Object.values(HABITAT_POOLS)) if (pool.index === index) return pool.id;
  return undefined;
}

export function poolSpawns(poolId: string): HabitatSpawnEntry[] {
  return HABITAT_POOLS[poolId]?.spawns ?? [];
}

/** HabitatPool.getPhaseCount: nº de fases distintas citadas nas spawns (mínimo 1). */
export function phaseCount(spawns: readonly HabitatSpawnEntry[]): number {
  const set = new Set<number>();
  for (const s of spawns) for (const [a, b] of s.phases ?? []) for (let i = a; i <= b; i++) set.add(i);
  return Math.max(1, set.size);
}

export function phaseMatches(entry: HabitatSpawnEntry, phase: number): boolean {
  return !entry.phases || entry.phases.some(([a, b]) => phase >= a && phase <= b);
}

/** BlockPos.asLong do Java (x 26 bits, z 26 bits, y 12 bits) como BigInt. */
export function blockPosAsLong(x: number, y: number, z: number): bigint {
  return ((BigInt(x) & 0x3FFFFFFn) << 38n) | ((BigInt(z) & 0x3FFFFFFn) << 12n) | (BigInt(y) & 0xFFFn);
}

/** Gerador determinístico a partir de uma semente de 64 bits (substitui kotlin.random.Random(seed)). */
export function seededRandom(seed: bigint): () => number {
  let s = Number(BigInt.asUintN(32, seed ^ (seed >> 32n))) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** HabitatBlockEntity.calculatePhaseOrder: permutação fixa de 1..n pela posição do bloco. */
export function phaseOrderFor(pos: Vector3, n: number): number[] {
  const list = Array.from({ length: n }, (_, i) => i + 1);
  const random = seededRandom(blockPosAsLong(pos.x, pos.y, pos.z));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** HabitatBlockEntity.calculatePhase(gameTime). */
export function calculatePhase(order: PhaseOrder, pos: Vector3, gameTime: number, n: number): number {
  if (n <= 1) return 1;
  const day = Math.floor(gameTime / 24000);
  const base = (day % n) + 1;
  switch (order) {
    case "FULL_RANDOM": return Math.floor(seededRandom(BigInt(day) + blockPosAsLong(pos.x, pos.y, pos.z))() * n) + 1;
    case "FIXED_RANDOM": return phaseOrderFor(pos, n)[base - 1];
    default: return base;
  }
}

/**
 * HabitatPool.createSpawnDetails: spawns cuja faixa de nível cruza a do bloco, com a faixa intersectada.
 * As fases continuam na entrada (PhaseAppendageCondition).
 */
export function createSpawnEntries(spawns: readonly HabitatSpawnEntry[], levelRange: [number, number]): HabitatSpawnEntry[] {
  const out: HabitatSpawnEntry[] = [];
  for (const s of spawns) {
    const lo = Math.max(s.minLevel, levelRange[0]);
    const hi = Math.min(s.maxLevel, levelRange[1]);
    if (lo > hi) continue;
    out.push({ ...s, minLevel: lo, maxLevel: hi });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Registro dos blocos

export interface HabitatState {
  key: string;
  dimensionId: string;
  pos: Vector3;
  settings: HabitatSettings;
  entries: HabitatSpawnEntry[];
  entrySet: Set<SpawnEntry>;
  phases: number;
  /** Tick (system.currentTick) do último sinal de vida do bloco (tick do componente / verificação). */
  lastSeen: number;
  receivingSignal: boolean;
  /** Ids das entidades vivas spawnadas por este bloco (maxSpawns). */
  spawned: Set<string>;
  /** Pool tem spawns fora de pesca / de pesca (NaturalHabitatSpawning.affectsOverworld/affectsFishing). */
  affectsOverworld: boolean;
  affectsFishing: boolean;
}

export const habitatStore = new MachineStore<Partial<HabitatSettings>>("habitat");
const registry = new Map<string, HabitatState>();
/** Os registros salvos já entraram no registro em memória (uma vez por carregamento). */
let savedLoaded = false;

/** Relógio isolado para os testes. */
export const habitatClock = {
  tick: (): number => (typeof system.currentTick === "number" ? system.currentTick : 0),
  gameTime: (): number => {
    try {
      const t = world.getAbsoluteTime();
      if (typeof t === "number") return t;
    }
    catch { /* sem mundo */ }
    return 0;
  },
};

export function habitatStates(): HabitatState[] {
  return [...registry.values()];
}

export function habitatByKey(key: string): HabitatState | undefined {
  return registry.get(key);
}

export function clearHabitats() {
  registry.clear();
  savedLoaded = true;
}

/** Habitats salvos (imitados já convertidos) entram no registro uma vez por carregamento do mundo. */
export function ensureSavedHabitats(maxLevel = 100) {
  if (savedLoaded) return;
  savedLoaded = true;
  try { loadSavedHabitats(maxLevel); }
  catch { /* sem mundo */ }
}

/** Habitat registrado nesta posição (carrega os salvos na 1ª consulta). */
export function habitatAt(dimensionId: string, pos: Vector3): HabitatState | undefined {
  ensureSavedHabitats();
  return registry.get(blockKey(dimensionId, pos));
}

/** Remove o habitat do registro e o registro salvo (quebra ou bloco trocado). */
export function forgetHabitat(key: string) {
  registry.delete(key);
  try { habitatStore.delete(key); }
  catch {
    // Contexto só de leitura (before event): apaga no próximo tick.
    try { system.run(() => habitatStore.delete(key)); }
    catch { /* sem mundo */ }
  }
}

/** Monta/atualiza o estado de um bloco com as configurações dadas. */
export function registerHabitat(dimensionId: string, pos: Vector3, settings: HabitatSettings): HabitatState {
  const key = blockKey(dimensionId, pos);
  const old = registry.get(key);
  const entries = createSpawnEntries(poolSpawns(settings.poolId), settings.levelRange);
  const state: HabitatState = {
    key, dimensionId, pos: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }, settings, entries,
    entrySet: new Set(entries),
    // HabitatPool.getPhaseCount: sobre o pool inteiro (antes do filtro de nível do bloco).
    phases: phaseCount(poolSpawns(settings.poolId)),
    lastSeen: habitatClock.tick(),
    receivingSignal: old?.receivingSignal ?? false,
    spawned: old?.spawned ?? new Set(),
    affectsOverworld: entries.some(e => e.positionType !== "fishing"),
    affectsFishing: entries.some(e => e.positionType === "fishing"),
  };
  registry.set(key, state);
  return state;
}

export function unregisterHabitat(dimensionId: string, pos: Vector3) {
  registry.delete(blockKey(dimensionId, pos));
}

/** Índice do pool gravado no estado do bloco (estruturas). */
export function poolIndexOf(block: Block): number {
  try {
    const lo = Number(block.permutation.getState("cobblemon:habitat_pool" as never) ?? 0);
    const hi = Number(block.permutation.getState("cobblemon:habitat_pool_hi" as never) ?? 0);
    return hi * 16 + lo;
  }
  catch { return 0; }
}

/** Índice do bloco imitado gravado no estado da âncora (0 em blocos de antes da frente habitat-mimic). */
export function mimicIndexOf(block: Block): number {
  try { return Number(block.permutation.getState("cobblemon:habitat_mimic" as never) ?? 0) || 0; }
  catch { return 0; }
}

/**
 * Configuração efetiva de um bloco: salva por script, senão a da estrutura (pool e bloco imitado no estado), senão
 * padrão (HabitatBlockEntity: estilo ativado, pool vazio, imita minecraft:stone).
 */
export function settingsForBlock(block: Block, maxLevel = 100): HabitatSettings {
  const saved = habitatStore.get(blockKey(block.dimension.id, block.location));
  if (saved) return expandSettings(saved, maxLevel);
  const pool = poolByIndex(poolIndexOf(block));
  if (!pool) return defaultSettings(maxLevel);
  const mimic = anchorMimic(pool, mimicIndexOf(block));
  return { ...structureSettings(pool, maxLevel), preset: "structure", mimicId: mimic.name, mimicStates: mimic.states };
}

/** Registra/renova um bloco que existe no mundo. */
export function touchHabitat(block: Block, maxLevel = 100): HabitatState {
  const key = blockKey(block.dimension.id, block.location);
  const known = registry.get(key);
  if (known) {
    known.lastSeen = habitatClock.tick();
    return known;
  }
  return registerHabitat(block.dimension.id, block.location, settingsForBlock(block, maxLevel));
}

/** Blocos configurados por script entram no registro no carregamento (são verificados antes de valer). */
export function loadSavedHabitats(maxLevel = 100) {
  for (const key of habitatStore.keys()) {
    if (registry.has(key)) continue;
    const saved = habitatStore.get(key);
    if (!saved) continue;
    const { dimension, location } = parseBlockKey(key);
    registerHabitat(dimension, location, expandSettings(saved, maxLevel)).lastSeen = -Infinity;
  }
}

/** Fase atual do bloco (recalculada pelo tempo do mundo, como o ticker faz a cada 40 ticks). */
export function currentPhase(state: HabitatState, gameTime = habitatClock.gameTime()): number {
  return calculatePhase(state.settings.phaseOrder, state.pos, gameTime, state.phases);
}

/** HabitatBlockEntity.getInfluentialRange(spawner). */
export function influentialRange(state: HabitatState, spawner: SpawnerId): number {
  const s = state.settings;
  if (s.style === "activated") return s.cancelledNaturalSpawningRange;
  if (spawner === "fishing") return state.affectsFishing ? s.rangeOfInfluence : 0;
  return state.affectsOverworld ? s.rangeOfInfluence : 0;
}

/** Spawner próprio de um bloco ativado. */
export function habitatSpawnerId(state: HabitatState): SpawnerId {
  return `habitat:${state.key}`;
}

/** Spawns injetadas no bucket, na fase atual e do tipo da posição (HabitatBlockEntity.injectSpawns). */
export function injectedEntries(state: HabitatState, bucket: string, ctx: SpawnContext, phase = currentPhase(state)): HabitatSpawnEntry[] {
  if (state.settings.style !== "natural") return [];
  return state.entries.filter(e => e.bucket === bucket && e.positionType === ctx.positionType && phaseMatches(e, phase));
}

/** O bloco como SpawningInfluence para as posições de um spawner (affectSpawnable + injectSpawns). */
export function habitatInfluence(state: HabitatState, spawner: SpawnerId): SpawnInfluence {
  let phase: number | undefined;
  const phaseNow = () => (phase ??= currentPhase(state));
  return {
    affectSpawnable(entry) {
      const s = state.settings;
      // Natural com substituição: só as spawns do próprio bloco; ativado: só o próprio spawner.
      if (s.style === "natural") return s.replaceSpawns ? state.entrySet.has(entry) : true;
      return spawner === habitatSpawnerId(state);
    },
    injectSpawns(bucket, ctx) {
      return injectedEntries(state, bucket, ctx, phaseNow());
    },
  };
}

/** Verdadeiro se o bloco ainda está lá (chunk carregado). Remove do registro se foi trocado. */
type BlockLookup = (dimensionId: string, pos: Vector3) => string | undefined | null;
const worldLookup: BlockLookup = (dimensionId, pos) => {
  try { return world.getDimension(dimensionId).getBlock(pos)?.typeId ?? null; }
  catch { return null; }
};
export const habitatWorld: { lookup: BlockLookup } = { lookup: worldLookup };

/** Blocos com o tick parado há mais que isso são conferidos no mundo antes de valer. */
const STALE_TICKS = 100;

function alive(state: HabitatState, now: number): boolean {
  if (now - state.lastSeen <= STALE_TICKS) return true;
  return checkHabitatInWorld(state, now);
}

/**
 * Confere no mundo se o habitat ainda está lá (bloco imitado, técnico ou forma derivada). Bloco trocado (explosão,
 * pistão, /setblock): sai do registro e do registro salvo, como o block entity que some com o bloco no Java.
 */
export function checkHabitatInWorld(state: HabitatState, now = habitatClock.tick()): boolean {
  const type = habitatWorld.lookup(state.dimensionId, state.pos);
  if (type === null || type === undefined) return false; // chunk descarregado: fica no registro, sem valer
  if (!isHabitatBlockType(state.settings, type)) {
    forgetHabitat(state.key);
    return false;
  }
  state.lastSeen = now;
  return true;
}

export interface DetectedHabitat {
  state: HabitatState;
  range: number;
  influence: SpawnInfluence;
}

/**
 * HabitatBlockDetector.detectFromInput: blocos a até max(128, 2 × tamanho da zona) do centro da zona com alcance
 * de influência > 0 para este spawner.
 */

export function detectHabitats(dimensionId: string, center: Vector3, zoneLength: number, zoneHeight: number, spawner: SpawnerId): DetectedHabitat[] {
  // Habitats salvos voltam ao registro na 1ª detecção depois de carregar o mundo.
  ensureSavedHabitats();
  if (registry.size === 0) return [];
  const search = Math.max(DETECTOR_RANGE, zoneLength * 2, zoneHeight * 2);
  const now = habitatClock.tick();
  const out: DetectedHabitat[] = [];
  for (const state of [...registry.values()]) {
    if (state.dimensionId !== dimensionId) continue;
    const dx = state.pos.x - center.x, dy = state.pos.y - center.y, dz = state.pos.z - center.z;
    // PoiManager.findAll: distância horizontal (caixa quadrada) no raio.
    if (Math.abs(dx) > search || Math.abs(dz) > search || Math.abs(dy) > search) continue;
    const range = influentialRange(state, spawner);
    if (range <= 0 || !alive(state, now)) continue;
    out.push({ state, range, influence: habitatInfluence(state, spawner) });
  }
  return out;
}

/** ConditionalSpawningZoneInfluence.appliesTo: distSqr(posição, bloco) ≤ alcance². */
export function attachHabitatInfluences(positions: SpawnContext[], detected: DetectedHabitat[]): void {
  if (detected.length === 0) return;
  for (const ctx of positions) {
    const px = Math.floor(ctx.location.x), py = ctx.blockY ?? Math.floor(ctx.location.y) - 1, pz = Math.floor(ctx.location.z);
    let extra: SpawnInfluence[] | undefined;
    for (const d of detected) {
      const dx = px - d.state.pos.x, dy = py - d.state.pos.y, dz = pz - d.state.pos.z;
      if (dx * dx + dy * dy + dz * dz <= d.range * d.range) (extra ??= []).push(d.influence);
    }
    if (extra) ctx.influences = [...(ctx.influences ?? []), ...extra];
  }
}

/** Atalho do spawner: detecta e prende as influências nas posições. */
export function applyHabitats(dimension: Dimension, positions: SpawnContext[], center: Vector3, zoneLength: number, zoneHeight: number, spawner: SpawnerId): void {
  if (positions.length === 0) return;
  attachHabitatInfluences(positions, detectHabitats(dimension.id, center, zoneLength, zoneHeight, spawner));
}

// ---------------------------------------------------------------------------------------------
// Estilo ativado

/** ActivatedHabitatSpawningInfluence: aplica as modifiers do bloco e guarda o id do que spawnou. */
export function activatedInfluence(state: HabitatState): SpawnInfluence {
  const modifiers = state.settings.modifiers.trim() ? PokemonProperties.parse(state.settings.modifiers) : undefined;
  return {
    affectPokemon(_action, pokemon) { modifiers?.apply(pokemon); },
    affectEntity(_action, entity: Entity) { state.spawned.add(entity.id); },
  };
}

/** Quantos spawns esta ativação pode fazer (ActivatedHabitatSpawning.activate), ou 0 para não tentar. */
export function activationBudget(state: HabitatState, random: () => number = Math.random): number {
  const s = state.settings;
  if (s.chance < 1 && random() >= s.chance) return 0;
  if (state.entries.length === 0) return 0;
  const existing = state.spawned.size;
  if (s.maxSpawns !== -1 && existing >= s.maxSpawns) return 0;
  const remaining = s.maxSpawns === -1 ? Number.MAX_SAFE_INTEGER : s.maxSpawns - existing;
  const perActivation = s.maxSpawnsPerActivation === -1 ? Number.MAX_SAFE_INTEGER : s.maxSpawnsPerActivation;
  return Math.min(remaining, perActivation);
}

/** Buckets do spawner ativado (activatedHabitatBuckets). */
export function activatedBuckets(): Record<string, number> {
  return BEST_SPAWNER_CONFIG.activatedHabitatBuckets;
}

/** Limpa ids de entidades que já não existem (ticker a cada 20 ticks). */
export function pruneSpawned(state: HabitatState, exists: (id: string) => boolean) {
  for (const id of [...state.spawned]) if (!exists(id)) state.spawned.delete(id);
}
