/**
 * Condições de spawn do Cobblemon 1.8.2 (api/spawning/condition/*.kt) sobre um ponto já calculado
 * (SpawnContext). Tudo aqui é barato: as leituras do mundo (biomas, luz, blocos) são feitas uma vez por
 * posição em Spawner.ts; só `neededNearbyBlocks` consulta o mundo, com cache por posição.
 */
import { BlockVolume, Dimension, Vector3, world } from "@minecraft/server";
import type { SpawnCondition, SpawnEntry } from "../../generated/scripts/spawns";
import { moonPhaseInRange, timeInRange } from "./TimeRange";
import type { SpawnInfluence } from "./SpawnSelector";

/** Tipos de posição (SpawnablePositionType do Cobblemon). */
export type PositionType = "grounded" | "surface" | "submerged" | "seafloor" | "fishing";

/** Dados de pesca (FishingSpawnablePosition): vara, isca e nível de Lure. */
export interface FishingInfo {
  /** Id da Poké Rod (pokerods/*.json), ex.: "cobblemon:poke_rod". */
  rodType?: string;
  /** Id da isca presa na vara, ex.: "cobblemon:love_sweet". */
  bait?: string;
  /** Nível do encantamento Lure da vara. */
  lureLevel?: number;
  /** Nível de Luck of the Sea (usado na normalização de buckets). */
  luckOfTheSeaLevel?: number;
  /**
   * Tier da normalização de buckets; se presente, substitui lureLevel + luckOfTheSeaLevel. No Cobblemon
   * (PokeRodFishingBobberEntity.planSpawn) é rarity_bucket da isca + Luck of the Sea.
   */
  bucketTier?: number;
}

export interface SpawnContext {
  dimension: Dimension;
  /** Posição onde a entidade aparece (centro do bloco, pés do Pokémon). */
  location: Vector3;
  /**
   * Y do bloco da posição (chão em grounded/seafloor, fluido em surface/submerged), usado em minY/maxY
   * como no Cobblemon, que põe a entidade 1 bloco acima. Ausente: usa `location.y`.
   */
  blockY?: number;
  positionType: PositionType | string;
  /** Id do bioma sem namespace (ex.: "plains"). */
  biome: string;
  /** Bloco de apoio (grounded/seafloor) ou o fluido (surface/submerged). */
  baseBlock: string;
  skyLight: number;
  light: number;
  canSeeSky: boolean;
  isRaining: boolean;
  isThundering: boolean;
  /** Fluido da posição (surface/submerged/seafloor/fishing). */
  fluid?: "water" | "lava";
  /** Espaço livre (blocos) acima da posição, limitado à zona de spawn. */
  height?: number;
  /** Profundidade do fluido na posição. */
  depth?: number;
  /** Spawn causado por Poké Snack (condição `isPokeSnack`). */
  isPokeSnack?: boolean;
  /** Presente só em posições `fishing`. */
  fishing?: FishingInfo;
  /** Influências extras desta posição (isca, incenso, mel...). */
  influences?: SpawnInfluence[];
  /** Blocos por perto já conhecidos (evita consultar o mundo). Se ausente, consulta sob demanda. */
  nearbyBlocks?: Set<string>;
  /**
   * Pré-filtro compartilhado pelas posições de uma zona: falso se nenhum dos blocos existe na zona
   * inteira (+ raio), o que dispensa a consulta por posição. Uma consulta por lista por passe.
   */
  zoneHasAny?: (blocks: string[]) => boolean;
  /**
   * AreaSpawnablePosition.hasSpace(width, height): caixa livre em volta da posição pela largura e altura do
   * hitbox (blocos). Montado pelo spawner com cache de blocos da zona; ausente = só a coluna (`height`).
   */
  hasSpace?: (width: number, height: number) => boolean;
  /** hasSpace em fatias (passe fatiado do spawner): cede o tick entre leituras de bloco; mesma memória de hasSpace. */
  hasSpaceJob?: (width: number, height: number, firstMs?: number) => Generator<string, boolean, void>;
  /**
   * Relógio do mundo lido uma vez no passe (frente cliente-log: timeRange/moonPhase em centenas de condições por
   * posição eram uma chamada nativa cada). Ausente: consulta `worldClock` a cada condição.
   */
  clock?: { timeOfDay: number; moonPhase: number };
}

/** Raio de busca de `neededNearbyBlocks` (config maxNearbyBlocksHorizontalRange/VerticalRange). */
export const nearbyRange = { horizontal: 4, vertical: 2 };

/**
 * Frente cliente-teste4 (docs/pendencias/cliente-teste4.md): consultas ao mundo das condições (containsBlock de blocos
 * por perto, estruturas) — chamadas nativas indivisíveis — contadas para o aviso/sonda do passe de spawn. O Spawner zera
 * no começo de cada passe (passes de jogadores diferentes podem se intercalar: é só diagnóstico).
 */
export const worldQueryStats = { calls: 0, maxMs: 0 };
export function timedWorldQuery<T>(query: () => T): T {
  const t = Date.now();
  try { return query(); }
  finally {
    const ms = Date.now() - t;
    worldQueryStats.calls++;
    if (ms > worldQueryStats.maxMs) worldQueryStats.maxMs = ms;
  }
}

const nearbyCache = new WeakMap<SpawnContext, Map<string, boolean>>();

function hasNearbyBlock(ctx: SpawnContext, blocks: string[]): boolean {
  if (ctx.nearbyBlocks) return blocks.some(b => ctx.nearbyBlocks!.has(b));
  let cache = nearbyCache.get(ctx);
  if (!cache) nearbyCache.set(ctx, cache = new Map());
  const key = blocks.join(",");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (ctx.zoneHasAny && !ctx.zoneHasAny(blocks)) {
    cache.set(key, false);
    return false;
  }
  const { x, y, z } = ctx.location;
  // Pesca: caixa 10×10×10 em volta da boia (FishingSpawnablePosition.nearbyBlocks).
  const h = ctx.positionType === "fishing" ? 5 : nearbyRange.horizontal;
  const v = ctx.positionType === "fishing" ? 5 : nearbyRange.vertical;
  let found = false;
  try {
    found = timedWorldQuery(() => ctx.dimension.containsBlock(
      new BlockVolume(
        { x: Math.floor(x) - h, y: Math.floor(y) - v, z: Math.floor(z) - h },
        { x: Math.floor(x) + h, y: Math.floor(y) + v, z: Math.floor(z) + h },
      ),
      { includeTypes: blocks },
      false,
    ));
  }
  catch { found = false; }
  cache.set(key, found);
  return found;
}

/** Mesmo item com ou sem namespace ("cobblemon:love_rod" == "love_rod" só se o namespace faltar). */
function sameId(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const norm = (s: string) => (s.includes(":") ? s : `cobblemon:${s}`).toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Chunk de slime do Bedrock (o Cobblemon usa o do Java; aqui vale o algoritmo que o próprio Bedrock usa
 * para slimes): primeiro número do MT19937 com semente `chunkX * 0x1f1f1f1f ^ chunkZ`, módulo 10 == 0.
 */
export function isSlimeChunk(chunkX: number, chunkZ: number): boolean {
  const seed = (Math.imul(chunkX | 0, 0x1f1f1f1f) ^ (chunkZ | 0)) >>> 0;
  const mt = new Uint32Array(398);
  mt[0] = seed;
  for (let i = 1; i < 398; i++) {
    const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
    mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
  }
  let y = (mt[0] & 0x80000000) | (mt[1] & 0x7fffffff);
  y = (mt[397] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0)) >>> 0;
  y ^= y >>> 11;
  y ^= (y << 7) & 0x9d2c5680;
  y ^= (y << 15) & 0xefc60000;
  y ^= y >>> 18;
  return ((y >>> 0) % 10) === 0;
}

/** Fluido da posição; sem `fluid` explícito, deduz do bloco base ("minecraft:water" → água). */
function fluidOf(ctx: SpawnContext): "water" | "lava" | undefined {
  if (ctx.fluid) return ctx.fluid;
  if (ctx.baseBlock.includes("water")) return "water";
  if (ctx.baseBlock.includes("lava")) return "lava";
  return undefined;
}

/** Relógio do mundo, isolado para os testes poderem trocar. */
export const worldClock = {
  timeOfDay: (): number => world.getTimeOfDay(),
  moonPhase: (): number => Number(world.getMoonPhase()),
};

/**
 * Verdadeiro se TODAS as exigências da condição são atendidas (SpawningCondition.fits e subclasses).
 * Campos de pesca (vara, isca, Lure) só existem em FishingSpawningCondition: fora de posições `fishing`
 * são ignorados, como no Cobblemon.
 */
export function conditionMatches(c: SpawnCondition, ctx: SpawnContext): boolean {
  if (c.isPokeSnack !== undefined && c.isPokeSnack !== (ctx.isPokeSnack === true)) return false;
  const { x, z } = ctx.location;
  const y = ctx.blockY ?? ctx.location.y;
  if (c.minX !== undefined && x < c.minX) return false;
  if (c.maxX !== undefined && x > c.maxX) return false;
  if (c.minY !== undefined && y < c.minY) return false;
  if (c.maxY !== undefined && y > c.maxY) return false;
  if (c.minZ !== undefined && z < c.minZ) return false;
  if (c.maxZ !== undefined && z > c.maxZ) return false;
  if (c.moonPhase !== undefined && !moonPhaseInRange(c.moonPhase, ctx.clock?.moonPhase ?? worldClock.moonPhase())) return false;
  if (c.maxLight !== undefined && ctx.light > c.maxLight) return false;
  if (c.minLight !== undefined && ctx.light < c.minLight) return false;
  if (c.maxSkyLight !== undefined && ctx.skyLight > c.maxSkyLight) return false;
  if (c.minSkyLight !== undefined && ctx.skyLight < c.minSkyLight) return false;
  if (c.timeRange !== undefined && !timeInRange(c.timeRange, (ctx.clock?.timeOfDay ?? worldClock.timeOfDay()) % 24000)) return false;
  if (c.canSeeSky !== undefined && ctx.canSeeSky !== c.canSeeSky) return false;
  if (c.isRaining !== undefined && ctx.isRaining !== c.isRaining) return false;
  if (c.isThundering !== undefined && ctx.isThundering !== c.isThundering) return false;
  if (c.dimensions && c.dimensions.length && !c.dimensions.some(d => d === ctx.dimension.id || `minecraft:${d}` === ctx.dimension.id || d === `minecraft:${ctx.dimension.id}`)) return false;
  if (c.biomes && c.biomes.length && !c.biomes.includes(ctx.biome)) return false;
  // Estruturas: a Script API estável não diz se um ponto está dentro de uma estrutura; a frente "motor" pode registrar
  // uma consulta (`setSpawnStructureLookup`). Sem consulta (ou sem resposta) a condição não é cumprida.
  if (c.structures && c.structures.length && (spawnStructureLookup ? timedWorldQuery(() => spawnStructureLookup!(ctx.dimension, ctx.location, c.structures!)) : undefined) !== true) return false;
  if (c.isSlimeChunk && !isSlimeChunk(Math.floor(x) >> 4, Math.floor(z) >> 4)) return false;

  const fishing = ctx.positionType === "fishing";
  if (!fishing) {
    // AreaSpawningCondition / Grounded / Submerged / Surface / Seafloor.
    if (c.minHeight !== undefined && ctx.height !== undefined && ctx.height < c.minHeight) return false;
    if (c.maxHeight !== undefined && ctx.height !== undefined && ctx.height > c.maxHeight) return false;
    if (c.minDepth !== undefined && ctx.depth !== undefined && ctx.depth < c.minDepth) return false;
    if (c.maxDepth !== undefined && ctx.depth !== undefined && ctx.depth > c.maxDepth) return false;
    if (c.fluid !== undefined && ctx.positionType !== "grounded" && fluidOf(ctx) !== c.fluid) return false;
    if (c.neededBaseBlocks && c.neededBaseBlocks.length && !c.neededBaseBlocks.includes(ctx.baseBlock)) return false;
  }
  else {
    // FishingSpawningCondition: Lure (max só é checado junto com min), isca e tipo de vara.
    const info = ctx.fishing ?? {};
    if (c.minLureLevel !== undefined) {
      const lure = info.lureLevel ?? 0;
      if (lure < c.minLureLevel) return false;
      if (c.maxLureLevel !== undefined && lure > c.maxLureLevel) return false;
    }
    if (c.bait !== undefined && !sameId(info.bait, c.bait)) return false;
    if (c.rodType !== undefined && !sameId(info.rodType, c.rodType)) return false;
  }
  if (c.neededNearbyBlocks && c.neededNearbyBlocks.length && !hasNearbyBlock(ctx, c.neededNearbyBlocks)) return false;
  return true;
}

/** SpawnDetail.isSatisfiedBy: tipo de posição, condição, nenhuma anticondição. */
export function entryAllowed(entry: SpawnEntry, ctx: SpawnContext): boolean {
  if (entry.positionType !== ctx.positionType) return false;
  if (!conditionMatches(entry.condition, ctx)) return false;
  for (const anti of entry.anticonditions ?? []) {
    if (conditionMatches(anti, ctx)) return false;
  }
  return true;
}

/** Peso na posição: peso base × multiplicadores cujas condições valem (WeightMultiplier.affectWeight). */
export function baseWeight(entry: SpawnEntry, ctx: SpawnContext): number {
  let weight = entry.weight;
  for (const m of entry.weightMultipliers ?? []) {
    const meets = (!m.condition || conditionMatches(m.condition, ctx)) && !(m.anticondition && conditionMatches(m.anticondition, ctx));
    if (meets) weight *= m.multiplier;
  }
  return weight;
}

/**
 * Consulta "o ponto está numa destas estruturas?" (ids ou tags, ex.: "#minecraft:village"). Registrada pela frente que
 * sabe responder (motor: `isInStructure`). Undefined = não sabe.
 */
export type SpawnStructureLookup = (dimension: SpawnContext["dimension"], location: { x: number; y: number; z: number }, structures: string[]) => boolean | undefined;
let spawnStructureLookup: SpawnStructureLookup | undefined;
export function setSpawnStructureLookup(lookup: SpawnStructureLookup | undefined) {
  spawnStructureLookup = lookup;
}
