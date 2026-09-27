/**
 * Spawn de Pokémon selvagens por script, seguindo o BestSpawner do Cobblemon 1.8.2
 * (PlayerSpawner + Spawner.calculateSpawnActionsForArea + FlatSpawnablePositionWeightedSelector).
 *
 * Por jogador, a cada `ticksBetweenSpawnAttempts` (1º passe após 100 ticks):
 * 1. Zona de `spawningZoneDiameter` × `spawningZoneHeight` × `spawningZoneDiameter` a
 *    `minimum..maximumSpawningZoneDistanceFromPlayer` blocos do jogador, puxada para a direção em que
 *    ele anda, com correção vertical de até `maxVerticalCorrectionBlocks` (Spawner.constrainArea).
 * 2. Cap: Pokémon numa caixa de 3×3 chunks em volta da zona / 9 ≥ `pokemonPerChunk` → nada.
 * 3. Posições (grounded/surface/submerged/seafloor) amostradas em algumas colunas da zona.
 * 4. Seleção (SpawnSelector.ts): buckets, pesos, herds, até `maximumSpawnsPerPass` ações com
 *    `minimumDistanceBetweenEntities` entre elas.
 * 5. Criação: nível sorteado na faixa, shiny por `shinyRate`, Alfa (aspect + marca + moveset "alpha"),
 *    item segurado, dados do herd.
 *
 * Os passes andam em rodízio (no máximo SPAWN_TUNING.maxPassesPerRun por execução) e o despawn por
 * idade roda a cada segundo sobre um lote de entidades. Passes acima de SPAWN_TUNING.slowPassMs geram
 * um aviso no log.
 *
 * API para outras frentes (pesca, Poké Snack, comandos): ver docs/pendencias/spawn.md.
 */
import { spawnRulesInfluence } from "./SpawnRules";
import { Block, BlockVolume, Dimension, Entity, ItemStack, Player, system, Vector3, WeatherType, world } from "@minecraft/server";
import { BEST_SPAWNER_CONFIG, SpawnEntry } from "../../generated/scripts/spawns";
import { getConfig, getGameRule } from "../Config";
import { attachHoneyInfluences } from "./HoneyLog";
import { PokemonData } from "../Pokemon";
import { toID } from "../showdown";
import { getSpeciesData, toSpeciesId } from "../speciesData";
import { getSafeTeam } from "../pokemonStorage";
import { getWeather } from "../utils";
import { BIOME_TAGS } from "../../generated/scripts/biomeTags";
import { addPotentialMarks, giveMark, spawnGivenMarks, spawnPotentialMarks, VANILLA_MARK_BIOME_TAGS } from "../pokemon/Marks";
import { DespawnSettings, evaluateDespawn, SPAWN_TIME_PROPERTY } from "./Despawner";
import {
  ACTIVATED_MAX_PER_CHUNK, activatedBuckets, activatedInfluence, applyHabitats, currentPhase, habitatSpawnerId, HabitatState, phaseMatches,
} from "./Habitats";
import { baseWeight, entryAllowed, FishingInfo, nearbyRange, PositionType, SpawnContext } from "./SpawnConditions";
import {
  alphaTargetLevel, bucketNormalizingInfluence, entriesForBiome, hasSpaceBox, playerLevelRangeInfluence, rollLevel, selectSpawnActions,
  SelectOptions, SpawnAction, SpawnInfluence,
} from "./SpawnSelector";

export type { SpawnContext, FishingInfo, PositionType } from "./SpawnConditions";
export type { SpawnAction, SpawnInfluence } from "./SpawnSelector";
export { conditionMatches, isSlimeChunk } from "./SpawnConditions";
export { bucketNormalizingInfluence, selectSpawnActions } from "./SpawnSelector";

/** Ajustes só do port (não existem na config do Cobblemon). */
export const SPAWN_TUNING = {
  /** Intervalo do laço de spawn (ticks). Cada execução roda no máximo maxPassesPerRun passes. */
  runIntervalTicks: 2,
  maxPassesPerRun: 1,
  /** Colunas da zona examinadas por passe (a zona 8×8 tem 64). */
  zoneColumns: 12,
  /** Blocos extras acima da zona lidos para medir o espaço livre das posições. */
  clearanceScan: 6,
  /**
   * hasSpace pela largura do hitbox: leituras de bloco novas (fora das colunas já lidas) por passe. Acabou,
   * as posições restantes checam só a coluna.
   */
  hasSpaceReadBudget: 1200,
  /** Aviso no log quando um passe passa disso (ms). */
  slowPassMs: 20,
  /** Salvaguarda por jogador: selvagens num raio de maximumSpawningZoneDistanceFromPlayer + 16. */
  maxWildPerPlayer: 64,
  /**
   * Nível pelo time do jogador (PlayerLevelRangeInfluence). No Cobblemon 1.8.2 não tem efeito
   * nos spawns naturais (o nível é sobrescrito); desligado por paridade.
   */
  playerLevelScaling: false,
  /** Despawn: intervalo (ticks) e entidades avaliadas por rodada. */
  despawnIntervalTicks: 20,
  despawnBatch: 32,
  /** AlphaLevelMatchingSensor: raio (blocos). */
  alphaMatchRadius: 32,
};

/** Tag das entidades Alfa (consulta barata no laço de nível de Alfa). */
export const ALPHA_TAG = "cobblemon_alpha";
/** Dynamic properties gravadas nas entidades criadas pelo spawner. */
export const HERD_GROUP_PROPERTY = "cobblemon:herd_group";
export const HERD_LEADER_PROPERTY = "cobblemon:herd_leader";
export const SPAWN_DROPS_PROPERTY = "cobblemon:spawn_drops";
export const SPAWN_BUCKET_PROPERTY = "cobblemon:spawn_bucket";

const ALPHA_MARK = "cobblemon:mark_alpha";
/** Aspects do Alfa: ALPHA_ASPECT + os da marca mark_alpha (olhos brilhando). */
const ALPHA_ASPECTS = ["alpha", "alpha_eyes"];

// ---------------------------------------------------------------------------------------------
// Configuração

interface SpawnSettings extends DespawnSettings {
  enableSpawning: boolean;
  worldSpawningBlocklist: string[];
  ticksBetweenSpawnAttempts: number;
  minimumSpawningZoneDistanceFromPlayer: number;
  maximumSpawningZoneDistanceFromPlayer: number;
  spawningZoneDiameter: number;
  spawningZoneHeight: number;
  maxVerticalCorrectionBlocks: number;
  maximumSpawnsPerPass: number;
  minimumDistanceBetweenEntities: number;
  pokemonPerChunk: number;
  pokeSnackPokemonPerChunk: number;
  shinyRate: number;
  maxPokemonLevel: number;
  minimumLevelRangeMax: number;
  maxNearbyBlocksHorizontalRange: number;
  maxNearbyBlocksVerticalRange: number;
}

function settings(): SpawnSettings {
  const c = getConfig();
  nearbyRange.horizontal = c.maxNearbyBlocksHorizontalRange;
  nearbyRange.vertical = c.maxNearbyBlocksVerticalRange;
  return c;
}

// ---------------------------------------------------------------------------------------------
// Blocos

/** Blocos que não impedem um Pokémon de ficar ali (plantas, tapetes, neve fina...). */
const PASSABLE = /^minecraft:(short_grass|tall_grass|grass|fern|large_fern|dead_bush|deadbush|snow_layer|vine|glow_lichen|sweet_berry_bush|seagrass|kelp|kelp_plant|dandelion|poppy|blue_orchid|allium|azure_bluet|\w+_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|torchflower|pink_petals|wildflowers|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass|\w+_sapling|brown_mushroom|red_mushroom|crimson_roots|warped_roots|nether_sprouts|hanging_roots|moss_carpet|\w+_carpet|cave_vines\w*|twisting_vines\w*|weeping_vines\w*|structure_void|light_block\w*|torch|\w+_torch|\w+_button|\w+_pressure_plate|rail|\w+_rail|redstone_wire|tripwire|lever|\w*_?sign|ladder|red_flower|yellow_flower|double_plant|tallgrass)$/;

export interface CellInfo { kind: "air" | "passable" | "solid" | "water" | "lava"; typeId: string }

function classify(block: Block | undefined): CellInfo {
  if (!block) return { kind: "solid", typeId: "minecraft:bedrock" };
  const id = block.typeId;
  if (block.isAir) return { kind: "air", typeId: id };
  if (block.isLiquid) return { kind: id.includes("lava") ? "lava" : "water", typeId: id };
  if (id.includes("water")) return { kind: "water", typeId: id };
  if (PASSABLE.test(id)) return { kind: block.isWaterlogged ? "water" : "passable", typeId: id };
  return { kind: "solid", typeId: id };
}

const isOpen = (c: CellInfo) => c.kind === "air" || c.kind === "passable";
const isFluid = (c: CellInfo) => c.kind === "water" || c.kind === "lava";

function safeBlock(dimension: Dimension, loc: Vector3): Block | undefined {
  try { return dimension.getBlock(loc); }
  catch { return undefined; }
}

// ---------------------------------------------------------------------------------------------
// Contextos

interface WeatherInfo { isRaining: boolean; isThundering: boolean }

function weatherOf(dimension: Dimension): WeatherInfo {
  const weather = getWeather(dimension);
  return { isRaining: weather === WeatherType.Rain || weather === WeatherType.Thunder, isThundering: weather === WeatherType.Thunder };
}

function biomeAt(dimension: Dimension, location: Vector3): string {
  try { return dimension.getBiome(location).id.replace(/^minecraft:/, ""); }
  catch { return "plains"; }
}

/**
 * Monta um SpawnContext para uma posição qualquer (útil para pesca, Poké Snack, comandos).
 * `location` = onde a entidade aparece; o bloco da posição é o de baixo.
 */
export function buildSpawnContext(dimension: Dimension, location: Vector3, positionType: PositionType, extra: Partial<SpawnContext> = {}): SpawnContext {
  const blockPos = { x: Math.floor(location.x), y: Math.floor(location.y) - 1, z: Math.floor(location.z) };
  const base = classify(safeBlock(dimension, blockPos));
  let skyLight = 15, light = 15;
  try { skyLight = dimension.getSkyLightLevel(location); light = dimension.getLightLevel(location); }
  catch { /* fora do mundo carregado */ }
  let canSeeSky = skyLight >= 15;
  try {
    const top = dimension.getTopmostBlock({ x: blockPos.x, z: blockPos.z });
    if (top) canSeeSky = top.y <= blockPos.y;
  }
  catch { /* sem topo */ }
  return {
    dimension,
    location,
    blockY: blockPos.y,
    positionType,
    biome: biomeAt(dimension, location),
    baseBlock: base.typeId,
    skyLight,
    light,
    canSeeSky,
    ...weatherOf(dimension),
    fluid: base.kind === "water" || base.kind === "lava" ? base.kind : undefined,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// Zona de spawn

interface Zone { dimension: Dimension; baseX: number; baseY: number; baseZ: number; diameter: number; height: number }

/** PlayerSpawner.getZoneInput: centro a r blocos, puxado para a direção do movimento. */
function zoneFor(player: Player, s: SpawnSettings): Zone {
  const r = s.minimumSpawningZoneDistanceFromPlayer + Math.random() * (s.maximumSpawningZoneDistanceFromPlayer - s.minimumSpawningZoneDistanceFromPlayer);
  let velocity: Vector3 = { x: 0, y: 0, z: 0 };
  try { velocity = player.getVelocity(); }
  catch { /* jogador sem física */ }
  const horizontal = Math.hypot(velocity.x, velocity.z);
  const thetaTemp = Math.atan(velocity.z / velocity.x) + (Math.random() * Math.PI - Math.PI / 2);
  // Mesma fórmula do Cobblemon (inclusive o espelhamento quando x < 0).
  const theta = horizontal < 0.1 ? Math.random() * 2 * Math.PI : velocity.x < 0 ? Math.PI - thetaTemp : thetaTemp;
  const center = player.location;
  const x = center.x + r * Math.cos(theta);
  const z = center.z + r * Math.sin(theta);
  return {
    dimension: player.dimension,
    baseX: Math.ceil(x - s.spawningZoneDiameter / 2),
    baseY: Math.ceil(center.y - s.spawningZoneHeight / 2),
    baseZ: Math.ceil(z - s.spawningZoneDiameter / 2),
    diameter: s.spawningZoneDiameter,
    height: s.spawningZoneHeight,
  };
}

/** Spawner.isValidStartPoint: bloco não-ar com espaço (não sólido) acima. */
function isValidStartPoint(dimension: Dimension, x: number, y: number, z: number): boolean {
  const mid = safeBlock(dimension, { x, y, z });
  if (!mid || mid.isAir) return false;
  return classify(safeBlock(dimension, { x, y: y + 1, z })).kind !== "solid";
}

/** Spawner.constrainArea: acha o Y válido mais perto (±maxVerticalCorrectionBlocks) e limita ao mundo. */
function constrainZone(zone: Zone, s: SpawnSettings): Zone | undefined {
  const { dimension, baseX, baseZ } = zone;
  const range = dimension.heightRange;
  if (!dimension.isChunkLoaded({ x: baseX, y: zone.baseY, z: baseZ })) return undefined;
  const corner = { x: baseX + zone.diameter, y: zone.baseY, z: baseZ + zone.diameter };
  if (!dimension.isChunkLoaded(corner)) return undefined;
  let y = zone.baseY;
  let valid = y >= range.min && y < range.max && isValidStartPoint(dimension, baseX, y, baseZ);
  for (let offset = 1; !valid && offset <= s.maxVerticalCorrectionBlocks; offset++) {
    const up = zone.baseY + offset, down = zone.baseY - offset;
    if (up >= range.max && down < range.min) break;
    if (up < range.max && isValidStartPoint(dimension, baseX, up, baseZ)) { y = up; valid = true; }
    else if (down >= range.min && isValidStartPoint(dimension, baseX, down, baseZ)) { y = down; valid = true; }
  }
  if (!valid) return undefined;
  const minY = Math.max(range.min, y);
  const maxY = Math.min(range.max - 1, y + zone.height);
  if (maxY <= minY) return undefined;
  return { ...zone, baseY: minY, height: maxY - minY };
}

function zoneCenter(zone: Zone): Vector3 {
  return { x: zone.baseX + zone.diameter / 2, y: zone.baseY + zone.height / 2, z: zone.baseZ + zone.diameter / 2 };
}

/** Pokémon numa caixa de 3×3 chunks (48 blocos) centrada na zona, altura inteira (ENTITY_LIMIT_CHUNK_RANGE). */
function zoneIsFull(zone: Zone, perChunk: number): boolean {
  const cx = zone.baseX + zone.diameter / 2, cz = zone.baseZ + zone.diameter / 2;
  const range = zone.dimension.heightRange;
  const count = zone.dimension.getEntities({
    families: ["pokemon"],
    location: { x: cx - 24, y: range.min, z: cz - 24 },
    volume: { x: 48, y: range.max - range.min, z: 48 },
  }).length;
  return count / 9 >= perChunk;
}

/**
 * Cache de blocos de um passe (as colunas lidas + os vizinhos que hasSpace pedir) com orçamento de leituras
 * novas: acabou o orçamento, hasSpace cai para a checagem só da coluna (sem estourar o tick).
 */
export class ZoneBlockCache {
  private readonly cells = new Map<string, CellInfo>();
  reads = 0;
  constructor(private readonly read: (x: number, y: number, z: number) => CellInfo, readonly budget: number = SPAWN_TUNING.hasSpaceReadBudget) { }
  put(x: number, y: number, z: number, cell: CellInfo) { this.cells.set(`${x},${y},${z}`, cell); }
  /** Célula (cache ou leitura); undefined quando o orçamento acabou. */
  get(x: number, y: number, z: number): CellInfo | undefined {
    const key = `${x},${y},${z}`;
    let cell = this.cells.get(key);
    if (cell) return cell;
    if (this.reads >= this.budget) return undefined;
    this.reads++;
    cell = this.read(x, y, z);
    this.cells.set(key, cell);
    return cell;
  }
}

/** AreaSpawnablePosition.isSafeSpace por tipo de posição (o bloco que o hitbox ocuparia). */
function isSafeSpace(type: PositionType | string, fluid: "water" | "lava" | undefined, cell: CellInfo): boolean {
  if (type === "seafloor") return cell.kind === (fluid ?? "water");
  if (type === "submerged") return cell.kind === fluid;
  return cell.kind !== "solid";
}

export interface ZoneBounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/**
 * AreaSpawnablePosition.hasSpace(width, height) sobre o cache da zona. Fora da zona conta como pedra (como
 * SpawningZone.getBlockState no Kotlin). `columnHeight` (espaço livre na própria coluna, já medido) serve de
 * reserva quando o orçamento de leituras acaba. `bounds`: limites da zona ([min, max) em x/y/z).
 */
export function makeHasSpace(cache: ZoneBlockCache, x: number, blockY: number, z: number, type: PositionType | string, fluid: "water" | "lava" | undefined, columnHeight: number | undefined, bounds?: ZoneBounds): (width: number, height: number) => boolean {
  const memo = new Map<string, boolean>();
  return (width, height) => {
    const key = `${width}x${height}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const box = hasSpaceBox(x, blockY, z, width, height);
    // Orçamento de leituras acabou: só a coluna (comportamento antigo), sem memorizar.
    const fallback = () => columnHeight === undefined || height <= 1 || columnHeight >= height;
    const unsafeAt = (bx: number, by: number, bz: number): boolean | undefined => {
      if (bounds && (bx < bounds.minX || bx >= bounds.maxX || by < bounds.minY || by >= bounds.maxY || bz < bounds.minZ || bz >= bounds.maxZ)) return true;
      const cell = cache.get(bx, by, bz);
      return cell === undefined ? undefined : !isSafeSpace(type, fluid, cell);
    };
    let ok = true;
    // A coluna da própria posição primeiro: já está no cache e rejeita sem ler os vizinhos.
    for (let by = box.minY; ok && by <= box.maxY; by++) {
      const unsafe = unsafeAt(x, by, z);
      if (unsafe === undefined) return fallback();
      if (unsafe) ok = false;
    }
    for (let bx = box.minX; ok && bx < box.maxX; bx++) {
      for (let by = box.minY; ok && by <= box.maxY; by++) {
        for (let bz = box.minZ; ok && bz < box.maxZ; bz++) {
          if (bx === x && bz === z) continue;
          const unsafe = unsafeAt(bx, by, bz);
          if (unsafe === undefined) return fallback();
          if (unsafe) ok = false;
        }
      }
    }
    memo.set(key, ok);
    return ok;
  };
}

/** Amostra colunas da zona e devolve as posições possíveis de cada tipo. */
function resolvePositions(zone: Zone): SpawnContext[] {
  const { dimension } = zone;
  const out: SpawnContext[] = [];
  const weather = weatherOf(dimension);
  const columns = new Set<number>();
  const total = zone.diameter * zone.diameter;
  const wanted = Math.min(total, SPAWN_TUNING.zoneColumns);
  while (columns.size < wanted) columns.add(Math.floor(Math.random() * total));
  const top = zone.baseY + zone.height + SPAWN_TUNING.clearanceScan;
  const maxVertical = Math.max(1, getConfig().maxVerticalSpace || 8);
  const blockCache = new ZoneBlockCache((x, y, z) => classify(safeBlock(dimension, { x, y, z })));
  const bounds: ZoneBounds = { minX: zone.baseX, maxX: zone.baseX + zone.diameter, minY: zone.baseY, maxY: zone.baseY + zone.height, minZ: zone.baseZ, maxZ: zone.baseZ + zone.diameter };
  const zoneCache = new Map<string, boolean>();
  const zoneHasAny = (blocks: string[]): boolean => {
    const key = blocks.join(",");
    let found = zoneCache.get(key);
    if (found === undefined) {
      const h = nearbyRange.horizontal, v = nearbyRange.vertical;
      try {
        found = dimension.containsBlock(
          new BlockVolume({ x: zone.baseX - h, y: zone.baseY - v, z: zone.baseZ - h }, { x: zone.baseX + zone.diameter + h, y: top + v, z: zone.baseZ + zone.diameter + h }),
          { includeTypes: blocks }, false,
        );
      }
      catch { found = true; } // na dúvida, deixa a consulta por posição decidir
      zoneCache.set(key, found);
    }
    return found;
  };
  for (const column of columns) {
    const x = zone.baseX + (column % zone.diameter);
    const z = zone.baseZ + Math.floor(column / zone.diameter);
    // Coluna do fundo da zona (−1) até o topo + folga, lida uma vez.
    const cells: CellInfo[] = [];
    for (let y = zone.baseY - 1; y <= top; y++) {
      const cell = classify(safeBlock(dimension, { x, y, z }));
      cells.push(cell);
      blockCache.put(x, y, z, cell);
    }
    const at = (y: number) => cells[y - (zone.baseY - 1)];
    // Céu aberto: nada sólido/fluido acima do bloco da posição (plantas e tapetes não contam).
    let topY: number | undefined;
    try { topY = dimension.getTopmostBlock({ x, z })?.y; }
    catch { topY = undefined; }
    while (topY !== undefined && at(topY) && isOpen(at(topY))) topY--;
    const biomeCache = new Map<number, string>();
    const make = (blockY: number, type: PositionType, base: CellInfo, extra: Partial<SpawnContext>, freeHeight = extra.height): SpawnContext => {
      const location = { x: x + 0.5, y: blockY + 1, z: z + 0.5 };
      const key = blockY >> 2;
      let biome = biomeCache.get(key);
      if (biome === undefined) biomeCache.set(key, biome = biomeAt(dimension, location));
      let skyLight = 0, light = 0;
      try { skyLight = dimension.getSkyLightLevel(location); light = dimension.getLightLevel(location); }
      catch { /* sem luz */ }
      return {
        dimension, location, blockY, positionType: type, biome, baseBlock: base.typeId, skyLight, light,
        canSeeSky: type === "submerged" || type === "seafloor" ? false : topY === undefined || blockY >= topY,
        ...weather, zoneHasAny, ...extra,
        hasSpace: makeHasSpace(blockCache, x, blockY, z, type, extra.fluid, freeHeight, bounds),
      };
    };
    const submerged: SpawnContext[] = [];
    for (let y = zone.baseY; y < zone.baseY + zone.height; y++) {
      const cell = at(y), above = at(y + 1);
      if (!cell || !above) continue;
      if (cell.kind === "solid" && isOpen(above)) {
        // FlooredSpawnablePositionCalculator.getHeight(..., maxVerticalSpace): altura livre limitada pela config.
        // (a caixa de espaço do hitbox continua usando a coluna livre inteira).
        let free = 0;
        for (let yy = y + 1; yy <= top && at(yy) && isOpen(at(yy)); yy++) free++;
        out.push(make(y, "grounded", cell, { height: Math.min(free, maxVertical) }, free));
      }
      else if (isFluid(cell) && above.kind === "air") {
        let free = 0;
        for (let yy = y + 1; yy <= top && at(yy) && at(yy).kind === "air"; yy++) free++;
        out.push(make(y, "surface", cell, { fluid: cell.kind as "water" | "lava", height: Math.min(free, maxVertical) }, free));
      }
      else if (isFluid(cell) && isFluid(above)) {
        submerged.push(make(y, "submerged", cell, { fluid: cell.kind as "water" | "lava" }));
      }
      else if (cell.kind === "solid" && isFluid(above)) {
        out.push(make(y, "seafloor", cell, { fluid: above.kind as "water" | "lava" }));
      }
    }
    // Uma posição submersa por coluna basta (colunas de água funda teriam dezenas).
    if (submerged.length) out.push(submerged[Math.floor(Math.random() * submerged.length)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Criação das entidades

function validItem(id: string | undefined): string | undefined {
  if (!id) return undefined;
  try {
    new ItemStack(id);
    return id;
  }
  catch { return undefined; }
}

/** Pokémon da ação (sem entidade): nível, shiny pela config, Alfa, item. */
export function createPokemonForAction(action: SpawnAction, influences: SpawnInfluence[] = []): PokemonData {
  const s = settings();
  const aspects = [...action.aspects];
  if (action.alpha) for (const a of ALPHA_ASPECTS) if (!aspects.includes(a)) aspects.push(a);
  const shinyForced = aspects.includes("shiny");
  const data = PokemonData.generateNewWildPokemon(action.species, {
    level: Math.min(s.maxPokemonLevel, rollLevel(action)),
    aspects: aspects.filter(a => a !== "shiny"),
    shiny: shinyForced || (s.shinyRate > 0 && Math.random() * s.shinyRate < 1),
    movesetBuilder: action.alpha ? "alpha" : undefined,
  });
  if (action.alpha) {
    if (!data.marks.includes(ALPHA_MARK)) data.marks.push(ALPHA_MARK);
    data.activeMark = ALPHA_MARK;
  }
  applySpawnMarks(action, data);
  const item = validItem(action.heldItem);
  if (item) {
    data.minecraftItem = item;
    data.item = toID(item.replace(/^[^:]+:/, ""));
  }
  for (const influence of influences.concat(action.ctx.influences ?? [])) influence.affectPokemon?.(action, data);
  return data;
}

/** Ganchos da tora com mel (SaccharineLogSlatheredInfluence): HA (FishingSpawnCause.alterHAAttempt) e Alfa. */
const HONEY_HOOKS = {
  hasHiddenAbility: (pokemon: PokemonData) => { try { return pokemon.hasHiddenAbility(); } catch { return false; } },
  giveHiddenAbility: (pokemon: PokemonData) => { try { pokemon.giveHiddenAbility(); } catch { } },
  makeAlpha: (pokemon: PokemonData) => {
    for (const a of ALPHA_ASPECTS) if (!pokemon.aspects.includes(a)) pokemon.aspects.push(a);
    if (!pokemon.marks.includes(ALPHA_MARK)) pokemon.marks.push(ALPHA_MARK);
    pokemon.activeMark = ALPHA_MARK;
    try { pokemon.initializeMoveset("alpha"); } catch { }
  },
};

/** Toras com mel perto da zona (SaccharineLogSlatheredDetector). */
function applyHoneyLogs(dimension: Dimension, positions: SpawnContext[], center: Vector3, diameter: number) {
  try { attachHoneyInfluences(dimension, positions, center, diameter, diameter, HONEY_HOOKS); }
  catch (e) { console.warn(`Toras com mel: ${e}`); }
}

/** Tag de entidade do líder de herd (filtro do `follow_mob` gerado em tools/importer/entities.ts). */
export const HERD_LEADER_TAG = "cobblemon_herd_leader";

/**
 * Callbacks `pokemon_entity_spawn/apply_marks` (Alfa → Jumbo) e `apply_potential_marks` (clima, hora, raras,
 * personalidade): as potenciais são sorteadas na captura (applyPotentialMarks).
 */
function applySpawnMarks(action: SpawnAction, data: PokemonData) {
  // Mini/Jumbo pela categoria de tamanho (escala intrínseca sorteada em generateNewWildPokemon).
  let size: string | undefined;
  try { size = data.getSizeCategory(); }
  catch { size = undefined; }
  for (const mark of spawnGivenMarks(!!action.alpha, size)) giveMark(data, mark);
  const { ctx } = action;
  let timeOfDay = 0;
  try { timeOfDay = world.getTimeOfDay() % 24000; }
  catch { /* sem mundo (testes) */ }
  const biomeIs = (tag: string) => (BIOME_TAGS[tag] ?? VANILLA_MARK_BIOME_TAGS[tag] ?? []).includes(ctx.biome);
  addPotentialMarks(data, ...spawnPotentialMarks({
    overworld: ctx.dimension?.id === "minecraft:overworld",
    y: ctx.location.y,
    timeOfDay,
    raining: !!ctx.isRaining,
    thundering: !!ctx.isThundering,
    biomeIs,
  }));
}

/** Aplica escala/estado de Alfa na entidade, se o entity JSON declarar (pedido à frente de entidades). */
function markAlphaEntity(entity: Entity) {
  entity.addTag(ALPHA_TAG);
  try {
    if (entity.getProperty("cobblemon:alpha") !== undefined) entity.triggerEvent("cobblemon:set_alpha");
  }
  catch { /* entidade sem suporte a Alfa ainda */ }
}

/** Cria a entidade de uma ação no mundo. Undefined se falhar. */
export function spawnActionEntity(action: SpawnAction, influences: SpawnInfluence[] = []): Entity | undefined {
  let entity: Entity | undefined;
  try {
    const data = createPokemonForAction(action, influences);
    entity = action.ctx.dimension.spawnEntity(data.getEntityId(), action.ctx.location);
    data.applyToCobblemon(entity);
    entity.setProperty("cobblemon:wild", true);
    entity.triggerEvent("cobblemon:set_wild");
    entity.setDynamicProperty(SPAWN_TIME_PROPERTY, absoluteTime());
    entity.setDynamicProperty(SPAWN_BUCKET_PROPERTY, action.bucket);
    // Alfa pela ação ou por influência (tora com mel).
    if (action.alpha || data.aspects.includes("alpha")) markAlphaEntity(entity);
    if (action.herdGroup) {
      entity.setDynamicProperty(HERD_GROUP_PROPERTY, action.herdGroup);
      if (action.herdMember?.isLeader) {
        entity.setDynamicProperty(HERD_LEADER_PROPERTY, true);
        // Seguidores do herd procuram esta tag (follow_mob); o loop de scripts/entity só repõe se faltar.
        entity.addTag(HERD_LEADER_TAG);
      }
    }
    if (action.drops) entity.setDynamicProperty(SPAWN_DROPS_PROPERTY, JSON.stringify(action.drops));
    for (const influence of influences.concat(action.ctx.influences ?? [])) influence.affectEntity?.(action, entity);
    return entity;
  }
  catch (e) {
    console.warn(`Falha ao spawnar ${action.species}: ${e}`);
    try { if (entity?.isValid) entity.remove(); }
    catch { /* já removida */ }
    return undefined;
  }
}

/** Tick absoluto do mundo (sobrevive a reinícios, ao contrário de system.currentTick). */
function absoluteTime(): number {
  try {
    const t = world.getAbsoluteTime();
    if (typeof t === "number") return t;
  }
  catch { /* API indisponível */ }
  return typeof system.currentTick === "number" ? system.currentTick : 0;
}

function partyLevels(player: Player): number[] {
  try { return getSafeTeam(player).filter(p => p != null).map(p => p!.level); }
  catch { return []; }
}

function playerInfluences(player: Player | undefined, s: SpawnSettings): SpawnInfluence[] {
  const out: SpawnInfluence[] = [];
  // PlayerSpawnerFactory/PokeSnackSpawnerFactory: componentes das spawn rules ligadas (frente dados-ui).
  try { const rules = spawnRulesInfluence(); if (rules) out.push(rules); } catch { }
  if (!player || !SPAWN_TUNING.playerLevelScaling) return out;
  out.push(playerLevelRangeInfluence(() => partyLevels(player), { variation: 5, maxPokemonLevel: s.maxPokemonLevel, minimumLevelRangeMax: s.minimumLevelRangeMax }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// API pública

export interface PoolRequest {
  /** Posições candidatas (use buildSpawnContext / positionsAround). */
  positions: SpawnContext[];
  /** Pesos de bucket; padrão worldBuckets. */
  buckets?: Record<string, number>;
  /** Padrão 1. */
  maxSpawns?: number;
  /** Só entradas que passam no filtro. */
  filter?: (entry: SpawnEntry) => boolean;
  influences?: SpawnInfluence[];
  /** Jogador que causou o spawn (nível pelo time, se ligado). */
  player?: Player;
}

function selectOptions(req: PoolRequest, s: SpawnSettings): SelectOptions {
  return {
    buckets: req.buckets ?? BEST_SPAWNER_CONFIG.worldBuckets,
    positionTypeWeights: BEST_SPAWNER_CONFIG.spawnablePositionTypeWeights,
    maxSpawns: req.maxSpawns ?? 1,
    minDistanceBetweenEntities: s.minimumDistanceBetweenEntities,
    influences: [...(req.influences ?? []), ...playerInfluences(req.player, s)],
    filter: req.filter,
  };
}

/** Só escolhe (não cria entidades). */
export function selectFromPool(req: PoolRequest): SpawnAction[] {
  return selectSpawnActions(req.positions, selectOptions(req, settings()));
}

/** Escolhe e cria as entidades. Retorna as entidades criadas. */
export function spawnFromPool(req: PoolRequest): Entity[] {
  const opts = selectOptions(req, settings());
  const out: Entity[] = [];
  for (const action of selectSpawnActions(req.positions, opts)) {
    const entity = spawnActionEntity(action, opts.influences);
    if (entity) out.push(entity);
  }
  return out;
}

/** Posições possíveis numa zona centrada em `center` (mesma varredura do spawner natural). */
export function positionsAround(dimension: Dimension, center: Vector3, diameter?: number, height?: number): SpawnContext[] {
  const s = settings();
  const d = diameter ?? s.spawningZoneDiameter, h = height ?? s.spawningZoneHeight;
  const zone = constrainZone({ dimension, baseX: Math.ceil(center.x - d / 2), baseY: Math.ceil(center.y - h / 2), baseZ: Math.ceil(center.z - d / 2), diameter: d, height: h }, s);
  return zone ? resolvePositions(zone) : [];
}

/**
 * Compatibilidade: escolhe UMA entrada para um ponto (buckets do mundo). Herds devolvem a entrada do herd
 * (a espécie é a do líder). Para spawnar use spawnFromPool / trySpawnNear.
 */
export function chooseSpawn(ctx: SpawnContext): SpawnEntry | undefined {
  return selectSpawnActions([ctx], { buckets: BEST_SPAWNER_CONFIG.worldBuckets, maxSpawns: 1, minDistanceBetweenEntities: 8 })[0]?.entry;
}

/**
 * Pesca (FishingSpawnerFactory): escolhe entre as entradas `fishing` com fishingBuckets, normalizando os
 * buckets pelo nível de Lure + Luck of the Sea e respeitando rodType/bait/minLureLevel.
 * `ctx.positionType` é forçado para "fishing"; monte-o com buildSpawnContext na posição da boia.
 */
export function chooseFishingSpawn(ctx: SpawnContext, fishing: FishingInfo = {}, options: { player?: Player; influences?: SpawnInfluence[] } = {}): SpawnAction | undefined {
  const fishingCtx: SpawnContext = { ...ctx, positionType: "fishing", fishing: { ...(ctx.fishing ?? {}), ...fishing } };
  if (ctx.dimension) applyHabitats(ctx.dimension, [fishingCtx], ctx.location, 1, 1, "fishing");
  const info = fishingCtx.fishing!;
  const tier = info.bucketTier ?? (info.lureLevel ?? 0) + (info.luckOfTheSeaLevel ?? 0);
  const s = settings();
  return selectSpawnActions([fishingCtx], {
    buckets: BEST_SPAWNER_CONFIG.fishingBuckets,
    maxSpawns: 1,
    minDistanceBetweenEntities: s.minimumDistanceBetweenEntities,
    influences: [bucketNormalizingInfluence(tier), ...(options.influences ?? []), ...playerInfluences(options.player, s)],
  })[0];
}

/**
 * Poké Snack / isca de área (PokeSnackSpawnerFactory): uma tentativa numa zona em volta de `center`,
 * com pokeSnackBuckets, `isPokeSnack = true` nas posições e cap de pokeSnackPokemonPerChunk.
 */
export function trySpawnFromBait(dimension: Dimension, center: Vector3, options: { influences?: SpawnInfluence[]; player?: Player; maxSpawns?: number; radius?: number } = {}): Entity[] {
  const s = settings();
  // `radius`: zona fixa (2·raio + 1) em volta do centro, como o Poké Snack do Cobblemon (raio 8 → 17×17×17).
  const diameter = options.radius !== undefined ? options.radius * 2 + 1 : s.spawningZoneDiameter;
  const height = options.radius !== undefined ? options.radius * 2 + 1 : s.spawningZoneHeight;
  const zone = constrainZone({
    dimension, baseX: Math.ceil(center.x - diameter / 2), baseY: Math.ceil(center.y - height / 2),
    baseZ: Math.ceil(center.z - diameter / 2), diameter, height,
  }, s);
  if (!zone || zoneIsFull(zone, Math.max(s.pokemonPerChunk, s.pokeSnackPokemonPerChunk))) return [];
  const positions = resolvePositions(zone).map(p => ({ ...p, isPokeSnack: true }));
  applyHabitats(dimension, positions, zoneCenter(zone), zone.diameter, zone.height, "snack");
  applyHoneyLogs(dimension, positions, zoneCenter(zone), zone.diameter);
  return spawnFromPool({ positions, buckets: BEST_SPAWNER_CONFIG.pokeSnackBuckets, maxSpawns: options.maxSpawns ?? 1, influences: options.influences, player: options.player });
}

/**
 * Spawner de área fixa de um bloco de habitat ativado (ActivatedHabitatSpawning.activate → FixedAreaSpawner.run):
 * zona de raio `spawnRange` em volta do bloco, cap de max(pokemonPerChunk, 16) por chunk, só as spawns do bloco
 * na fase atual, buckets activatedHabitatBuckets, modifiers do bloco e registro do que spawnou.
 */
export function runHabitatSpawner(state: HabitatState, dimension: Dimension, maxSpawns: number): Entity[] {
  if (maxSpawns <= 0) return [];
  const s = settings();
  const r = Math.max(0, Math.floor(state.settings.spawnRange));
  const size = r * 2 + 1;
  const zone = constrainZone({ dimension, baseX: state.pos.x - r, baseY: state.pos.y - r, baseZ: state.pos.z - r, diameter: size, height: size }, s);
  if (!zone || zoneIsFull(zone, Math.max(s.pokemonPerChunk, ACTIVATED_MAX_PER_CHUNK))) return [];
  const positions = resolvePositions(zone);
  applyHabitats(dimension, positions, zoneCenter(zone), zone.diameter, zone.height, habitatSpawnerId(state));
  const phase = currentPhase(state);
  const entries = state.entries.filter(e => phaseMatches(e, phase));
  if (entries.length === 0) return [];
  const influences = [activatedInfluence(state)];
  const out: Entity[] = [];
  for (const action of selectSpawnActions(positions, {
    buckets: activatedBuckets(),
    positionTypeWeights: BEST_SPAWNER_CONFIG.spawnablePositionTypeWeights,
    maxSpawns: Math.min(maxSpawns, 64),
    minDistanceBetweenEntities: s.minimumDistanceBetweenEntities,
    influences,
    entriesFor: () => entries,
    poolBuckets: new Set(state.entries.map(e => e.bucket)),
  })) {
    const entity = spawnActionEntity(action, influences);
    if (entity) out.push(entity);
  }
  return out;
}

/**
 * Chances (%) de cada entrada num ponto (checkspawn): peso do bucket × participação da entrada no bucket.
 */
export function getSpawnProbabilities(ctx: SpawnContext, buckets: Record<string, number> = BEST_SPAWNER_CONFIG.worldBuckets): { entry: SpawnEntry; bucket: string; percent: number }[] {
  const byBucket = new Map<string, { entry: SpawnEntry; weight: number }[]>();
  for (const entry of entriesForBiome(ctx.biome)) {
    if (!(entry.bucket in buckets) || !entryAllowed(entry, ctx)) continue;
    let list = byBucket.get(entry.bucket);
    if (!list) byBucket.set(entry.bucket, list = []);
    list.push({ entry, weight: baseWeight(entry, ctx) });
  }
  const bucketTotal = Object.values(buckets).reduce((a, b) => a + b, 0);
  const out: { entry: SpawnEntry; bucket: string; percent: number }[] = [];
  for (const [bucket, list] of byBucket) {
    const sum = list.reduce((a, b) => a + b.weight, 0);
    if (sum <= 0) continue;
    for (const item of list) out.push({ entry: item.entry, bucket, percent: (buckets[bucket] / bucketTotal) * (item.weight / sum) * 100 });
  }
  return out.sort((a, b) => b.percent - a.percent);
}


// ---------------------------------------------------------------------------------------------
// Laço natural

let spawningEnabled = true;

/** Liga/desliga o spawn natural em tempo de execução (além de config.enableSpawning). */
export function setNaturalSpawning(enabled: boolean) {
  spawningEnabled = enabled;
}

/** Selvagens perto do jogador (salvaguarda do port). */
function wildNear(player: Player, radius: number): number {
  return player.dimension.getEntities({
    families: ["pokemon"], location: player.location, maxDistance: radius,
    propertyOptions: [{ propertyId: "cobblemon:wild", value: { equals: true } }],
  }).length;
}

let lastSlowWarning = -Infinity;

/** Um passe de spawn para o jogador (PlayerSpawner.tick quando o timer zera). Retorna as ações feitas. */
export function trySpawnNear(player: Player): SpawnAction[] {
  const s = settings();
  if (!s.enableSpawning || !spawningEnabled || !getGameRule("doPokemonSpawning")) return [];
  if (s.worldSpawningBlocklist.includes(player.dimension.id)) return [];
  const t0 = Date.now();
  const zone = constrainZone(zoneFor(player, s), s);
  if (!zone) return [];
  if (zoneIsFull(zone, s.pokemonPerChunk)) return [];
  if (wildNear(player, s.maximumSpawningZoneDistanceFromPlayer + 16) >= SPAWN_TUNING.maxWildPerPlayer) return [];
  const t1 = Date.now();
  const positions = resolvePositions(zone);
  // HabitatBlockDetector: blocos de habitat perto da zona injetam/substituem spawns nas posições do raio.
  applyHabitats(zone.dimension, positions, zoneCenter(zone), zone.diameter, zone.height, "world");
  applyHoneyLogs(zone.dimension, positions, zoneCenter(zone), zone.diameter);
  const t2 = Date.now();
  const opts = selectOptions({ positions, player, maxSpawns: s.maximumSpawnsPerPass }, s);
  const actions = selectSpawnActions(positions, opts);
  const t3 = Date.now();
  const done: SpawnAction[] = [];
  for (const action of actions) if (spawnActionEntity(action, opts.influences)) done.push(action);
  const t4 = Date.now();
  if (t4 - t0 > SPAWN_TUNING.slowPassMs && t4 - lastSlowWarning > 10000) {
    lastSlowWarning = t4;
    console.warn(`[spawn] passe lento: ${t4 - t0} ms (zona ${t1 - t0}, posições ${t2 - t1} [${positions.length}], seleção ${t3 - t2}, entidades ${t4 - t3} [${done.length}])`);
  }
  return done;
}

const playerTimers = new Map<string, number>();
let lastRunTick = 0;
let rotation = 0;

function spawnTick() {
  const now = system.currentTick;
  const elapsed = Math.max(1, now - lastRunTick);
  lastRunTick = now;
  const players = world.getAllPlayers();
  if (players.length === 0) return;
  const s = settings();
  const seen = new Set<string>();
  const due: Player[] = [];
  for (const player of players) {
    seen.add(player.id);
    const left = (playerTimers.get(player.id) ?? 100) - elapsed;
    playerTimers.set(player.id, left);
    if (left <= 0) due.push(player);
  }
  for (const id of [...playerTimers.keys()]) if (!seen.has(id)) playerTimers.delete(id);
  if (!s.enableSpawning || !spawningEnabled || !getGameRule("doPokemonSpawning") || due.length === 0) return;
  // Rodízio: no máximo maxPassesPerRun passes por execução; os outros esperam a próxima.
  for (let i = 0; i < Math.min(due.length, SPAWN_TUNING.maxPassesPerRun); i++) {
    const player = due[(rotation++) % due.length];
    playerTimers.set(player.id, s.ticksBetweenSpawnAttempts);
    if (!player.isValid) continue;
    try { trySpawnNear(player); }
    catch (e) { console.warn(`Erro no spawner: ${e}`); }
  }
}

// ---------------------------------------------------------------------------------------------
// Despawn e nível dos Alfas

const despawnCursor = new Map<string, number>();

function despawnTick() {
  const s = settings();
  const now = absoluteTime();
  const players = world.getAllPlayers();
  const byDimension = new Map<string, Vector3[]>();
  for (const p of players) {
    let list = byDimension.get(p.dimension.id);
    if (!list) byDimension.set(p.dimension.id, list = []);
    list.push(p.location);
  }
  for (const dimensionId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    let dimension: Dimension;
    try { dimension = world.getDimension(dimensionId); }
    catch { continue; }
    const wild = dimension.getEntities({ families: ["pokemon"], propertyOptions: [{ propertyId: "cobblemon:wild", value: { equals: true } }] });
    if (wild.length === 0) continue;
    let cursor = despawnCursor.get(dimensionId) ?? 0;
    if (cursor >= wild.length) cursor = 0;
    const batch = Math.min(wild.length, SPAWN_TUNING.despawnBatch);
    const locations = byDimension.get(dimensionId) ?? [];
    for (let i = 0; i < batch; i++) {
      const entity = wild[(cursor + i) % wild.length];
      try {
        if (evaluateDespawn(entity, locations, now, s) === "despawn") entity.triggerEvent("cobblemon:instant_kill");
      }
      catch { /* entidade sumiu no meio */ }
    }
    despawnCursor.set(dimensionId, (cursor + batch) % Math.max(1, wild.length));
  }
  alphaLevelTick(players);
}

/** Menor nível de evolução que leva à forma atual (AlphaLevelMatchingSensor.minimumEvolutionLevel). */
function minimumEvolutionLevel(species: string): number {
  const data = getSpeciesData(species);
  if (!data?.preEvolution) return 1;
  const pre = getSpeciesData(data.preEvolution.split(/\s+/)[0]);
  let floor = Number.MAX_SAFE_INTEGER;
  for (const evo of pre?.evolutions ?? []) {
    if (toSpeciesId(String(evo.result).split(/\s+/)[0]) !== toSpeciesId(species)) continue;
    let min = 1;
    for (const req of evo.requirements ?? []) if (req.variant === "level" && (req.minLevel ?? 0) > min) min = req.minLevel!;
    floor = Math.min(floor, min);
  }
  return floor === Number.MAX_SAFE_INTEGER ? 1 : floor;
}

/** AlphaLevelMatchingSensor: Alfas selvagens a até 32 blocos acompanham o maior nível do time do jogador mais perto. */
function alphaLevelTick(players: Player[]) {
  if (players.length === 0) return;
  const maxLevel = getConfig().maxPokemonLevel;
  for (const player of players) {
    let alphas: Entity[];
    try {
      alphas = player.dimension.getEntities({ tags: [ALPHA_TAG], location: player.location, maxDistance: SPAWN_TUNING.alphaMatchRadius });
    }
    catch { continue; }
    if (alphas.length === 0) continue;
    const levels = partyLevels(player);
    if (levels.length === 0) continue;
    const strongest = Math.max(...levels);
    for (const entity of alphas) {
      try {
        if (entity.getProperty("cobblemon:wild") !== true || entity.getProperty("cobblemon:in_battle") === true || entity.getProperty("cobblemon:busy") === true) continue;
        // Jogador mais perto: se outro jogador está mais perto, ele decide (evita alternar).
        const d = (p: Player) => (p.location.x - entity.location.x) ** 2 + (p.location.y - entity.location.y) ** 2 + (p.location.z - entity.location.z) ** 2;
        if (players.some(other => other !== player && other.dimension.id === player.dimension.id && d(other) < d(player))) continue;
        const json = entity.getDynamicProperty("data");
        if (typeof json !== "string") continue;
        const data = PokemonData.getFromJson(json);
        const target = alphaTargetLevel(strongest, minimumEvolutionLevel(data.species), Math.min(100, maxLevel));
        if (data.level === target) continue;
        data.setLevel(target);
        data.applyToCobblemon(entity);
      }
      catch { /* dados inválidos: ignora */ }
    }
  }
}

/** Liga o laço de spawn e o de despawn. Chamar uma vez no carregamento do mundo. */
export function startSpawner() {
  lastRunTick = system.currentTick;
  system.runInterval(spawnTick, SPAWN_TUNING.runIntervalTicks);
  system.runInterval(() => {
    try { despawnTick(); }
    catch (e) { console.warn(`Erro no despawner: ${e}`); }
  }, SPAWN_TUNING.despawnIntervalTicks);
}
