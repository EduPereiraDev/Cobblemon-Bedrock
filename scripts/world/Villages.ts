/**
 * Vilas vanilla (frente motor): detector para `#minecraft:village` e Pokécenter junto de vilas novas.
 *
 * As vilas do Bedrock são jigsaw legado (não dá para injetar peças nos pools como o Cobblemon faz no Java com
 * CobblemonStructures.addPokecenters). Detecção pela pesquisa 3-motor (T13/T14):
 * - vila recém-gerada: aldeões/golem/gatos nascem com `entitySpawn.cause = "Event"` → 2 s depois procura um sino
 *   em volta (containsBlock, ~1 ms) e registra os chunks da caixa sinos+camas+blocos de trabalho (+16 blocos);
 * - mundo antigo/chunk sem registro: consulta preguiçosa no primeiro `isInStructure` do chunk (sino num raio de
 *   48 blocos), com cache por chunk de 10 min (positivo e negativo).
 * Pokécenter por script (DESLIGADO por padrão desde a frente vilas): o Pokécenter e os mini-habitats das vilas do Java
 * agora são estruturas jigsaw próprias do mod (`cobblemon:village_pokecenters/<bioma>` e
 * `cobblemon:village_habitats/<bioma>`, tools/importer/villages.ts), com a frequência equivalente à do Java; este
 * caminho ficaria duplicado. Ligado (`/scriptevent cobblemon:village_pokecenters on`), em vila NOVA ele procura em
 * anel de 18–40 blocos do sino um terreno plano e natural do tamanho do molde (village/<bioma>_pokecenter) e coloca
 * com a entrada virada para o sino; uma vez por vila. O detector de vilas (`#minecraft:village`) continua sempre ativo.
 */
import { Block, BlockVolume, Dimension, Entity, StructureRotation, system, Vector3, world } from "@minecraft/server";
import { POKECENTERS } from "../../generated/scripts/structures";
import { chunkOf, chunksInBox, setLazyStructureCheck, structureRegistry, VILLAGE_ID } from "./StructureRegistry";
import { startVillagesProbe } from "./villagesProbe"; // frente vilas: sonda de depuração (só com scriptevent)

const TRIGGERS = new Set(["minecraft:villager_v2", "minecraft:villager", "minecraft:iron_golem", "minecraft:cat"]);
export const VILLAGE_BLOCKS = [
  "minecraft:bell", "minecraft:bed", "minecraft:composter", "minecraft:lectern", "minecraft:barrel", "minecraft:smoker",
  "minecraft:blast_furnace", "minecraft:cartography_table", "minecraft:fletching_table", "minecraft:grindstone",
  "minecraft:smithing_table", "minecraft:stonecutter_block", "minecraft:loom", "minecraft:cauldron", "minecraft:brewing_stand",
];
const SEARCH_RADIUS = 48;
const SEARCH_HEIGHT = 32;
const MARGIN = 16;
const LAZY_TTL = 12000;
const POKECENTER_PROPERTY = "cobblemon:village_pokecenters";
const DONE_PREFIX = "cobblemon:pc_village:";

// ---------------------------------------------------------------------------------------------
// Lógica pura

export interface Box2 { minX: number; minZ: number; maxX: number; maxZ: number }

/** Caixa envolvente dos blocos da vila + margem. */
export function villageBox(points: readonly Vector3[], margin = MARGIN): Box2 | undefined {
  if (!points.length) return undefined;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX: minX - margin, minZ: minZ - margin, maxX: maxX + margin, maxZ: maxZ + margin };
}

/** Variante de vila pelo bioma (village_<tipo> do Java). */
export function villageTypeOf(biomeId: string): string {
  const b = biomeId.replace(/^minecraft:/, "");
  if (/desert/.test(b)) return "desert";
  if (/savanna/.test(b)) return "savanna";
  if (/(snow|ice|frozen|cold_taiga|grove)/.test(b)) return "snowy";
  if (/taiga/.test(b)) return "taiga";
  return "plains";
}

const FACING_STEP: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const ROTATIONS = ["None", "Rotate90", "Rotate180", "Rotate270"] as const;

/** Direção após girar k × 90° no sentido horário (StructureRotation). */
export function rotateFacing(facing: string, k: number): string {
  const order = ["north", "east", "south", "west"];
  const i = order.indexOf(facing);
  return i < 0 ? facing : order[(i + k) % 4];
}

/** Rotação que deixa a entrada do molde virada para `toward` (vetor do molde até o sino). */
export function rotationToward(entranceFacing: string, dx: number, dz: number): number {
  const want = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? "east" : "west") : (dz >= 0 ? "south" : "north");
  for (let k = 0; k < 4; k++) if (rotateFacing(entranceFacing, k) === want) return k;
  return 0;
}

/** Terreno "plano o bastante": variação de altura ≤ 1 e nenhum bloco proibido. */
export function isFlatNatural(heights: readonly number[], surfaceOk: readonly boolean[]): boolean {
  if (!heights.length || surfaceOk.some(ok => !ok)) return false;
  return Math.max(...heights) - Math.min(...heights) <= 1;
}

const NATURAL_SURFACE = /^minecraft:(grass_block|dirt|coarse_dirt|podzol|sand|red_sand|sandstone|snow|snow_layer|powder_snow|gravel|stone|moss_block|mycelium|short_grass|tall_grass|fern|large_fern|dandelion|poppy|\w+_tulip|oxeye_daisy|cornflower|azure_bluet|allium|dead_bush|deadbush|sweet_berry_bush|bush|short_dry_grass|tall_dry_grass|leaf_litter|wildflowers|pink_petals)$/;

// ---------------------------------------------------------------------------------------------
// Runtime

const lazyCache = new Map<string, number>();
const pendingChecks = new Set<string>();

function isLoaded(dimension: Dimension, location: Vector3): boolean {
  try { return dimension.isChunkLoaded(location); }
  catch { return false; }
}

function searchVolume(center: Vector3, radius = SEARCH_RADIUS, height = SEARCH_HEIGHT) {
  const y = Math.floor(center.y);
  return new BlockVolume(
    { x: Math.floor(center.x) - radius, y: Math.max(-64, y - height), z: Math.floor(center.z) - radius },
    { x: Math.floor(center.x) + radius, y: Math.min(319, y + height), z: Math.floor(center.z) + radius },
  );
}

/** Procura a vila em volta do ponto. @returns os sinos achados (vazio = não é vila). */
export function detectVillage(dimension: Dimension, center: Vector3): Vector3[] {
  if (!isLoaded(dimension, center)) return [];
  const volume = searchVolume(center);
  if (!dimension.containsBlock(volume, { includeTypes: ["minecraft:bell"] }, true)) return [];
  const found = dimension.getBlocks(volume, { includeTypes: VILLAGE_BLOCKS }, true);
  const points: Vector3[] = [];
  const bells: Vector3[] = [];
  for (const loc of found.getBlockLocationIterator()) {
    points.push(loc);
    try { if (dimension.getBlock(loc)?.typeId === "minecraft:bell") bells.push(loc); }
    catch { /* chunk descarregou */ }
  }
  const box = villageBox(points);
  if (box) structureRegistry.register(dimension.id, chunksInBox(box.minX, box.minZ, box.maxX, box.maxZ), VILLAGE_ID);
  return bells;
}

/** Consulta preguiçosa (chunk sem registro): um containsBlock por chunk a cada 10 min. */
function lazyVillageCheck(dimension: Dimension, location: Vector3) {
  const key = `${dimension.id}:${chunkOf(location.x)}:${chunkOf(location.z)}`;
  const now = system.currentTick;
  const until = lazyCache.get(key);
  if (until !== undefined && until > now) return;
  lazyCache.set(key, now + LAZY_TTL);
  if (lazyCache.size > 4096) for (const [k, t] of lazyCache) if (t <= now) lazyCache.delete(k);
  if (structureRegistry.structuresInChunk(dimension.id, chunkOf(location.x), chunkOf(location.z)).includes(VILLAGE_ID)) return;
  detectVillage(dimension, location);
}

/** Pokécenter por script junto de vilas novas: só com a chave ligada explicitamente (padrão: desligado). */
export function pokecentersEnabled(): boolean {
  try { return world.getDynamicProperty(POKECENTER_PROPERTY) === true; }
  catch { return false; }
}

function onVillagerSpawn(entity: Entity) {
  let dimension: Dimension, loc: Vector3;
  try {
    dimension = entity.dimension;
    loc = entity.location;
  }
  catch { return; }
  // Uma checagem por célula de 64 blocos (a vila nasce com vários aldeões de uma vez).
  const cell = `${dimension.id}:${Math.floor(loc.x / 64)}:${Math.floor(loc.z / 64)}`;
  if (pendingChecks.has(cell)) return;
  pendingChecks.add(cell);
  system.runTimeout(() => {
    pendingChecks.delete(cell);
    try {
      const bells = detectVillage(dimension, loc);
      if (bells.length && pokecentersEnabled()) system.runJob(placePokecenterJob(dimension, bells[0]));
    }
    catch (e) { console.warn(`[vilas] ${e}`); }
  }, 40);
}

function topSolid(dimension: Dimension, x: number, z: number, y: number): Block | undefined {
  try { return dimension.getTopmostBlock({ x, z }, y - 24); }
  catch { return undefined; }
}

/**
 * Procura terreno e coloca o Pokécenter (gerador: roda aos poucos com system.runJob).
 * Seguro = footprint inteiro carregado, plano (±1), superfície natural e sem blocos da vila por cima.
 */
export function* placePokecenterJob(dimension: Dimension, bell: Vector3): Generator<void, void, void> {
  const doneKey = `${DONE_PREFIX}${dimension.id}:${Math.floor(bell.x / 8)}:${Math.floor(bell.z / 8)}`;
  try { if (world.getDynamicProperty(doneKey)) return; }
  catch { return; }
  let type = "plains";
  try { type = villageTypeOf(dimension.getBiome(bell).id); }
  catch { /* bioma indisponível: planície */ }
  const info = POKECENTERS[type] ?? POKECENTERS.plains;
  if (!info) return;
  const [sx, , sz] = info.size;
  for (let ring = 18; ring <= 40; ring += 4) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const cx = Math.floor(bell.x + Math.cos(ang) * ring), cz = Math.floor(bell.z + Math.sin(ang) * ring);
      const k = rotationToward(info.entranceFacing, bell.x - cx, bell.z - cz);
      const w = k % 2 ? sz : sx, d = k % 2 ? sx : sz;
      const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2);
      yield;
      if (!isLoaded(dimension, { x: x0, y: bell.y, z: z0 }) || !isLoaded(dimension, { x: x0 + w, y: bell.y, z: z0 + d })) continue;
      const heights: number[] = [];
      const ok: boolean[] = [];
      for (let dx = 0; dx < w; dx += 2) for (let dz = 0; dz < d; dz += 2) {
        const top = topSolid(dimension, x0 + dx, z0 + dz, Math.floor(bell.y) + 16);
        heights.push(top?.location.y ?? -999);
        ok.push(!!top && NATURAL_SURFACE.test(top.typeId) && !top.isLiquid);
      }
      if (!isFlatNatural(heights, ok)) continue;
      const ground = Math.min(...heights);
      const volume = new BlockVolume({ x: x0 - 1, y: ground, z: z0 - 1 }, { x: x0 + w, y: ground + info.size[1], z: z0 + d });
      yield;
      let occupied = true;
      // Duas consultas: tipos e tags separados (a combinação dos filtros não é documentada).
      try { occupied = dimension.containsBlock(volume, { includeTypes: VILLAGE_BLOCKS }, false) || dimension.containsBlock(volume, { includeTags: ["log", "wood", "plank"] }, false); }
      catch { continue; }
      if (occupied) continue;
      try {
        world.structureManager.place(info.structure, dimension, { x: x0, y: ground, z: z0 }, { rotation: ROTATIONS[k] as StructureRotation });
        world.setDynamicProperty(doneKey, true);
        const box = { minX: x0, minZ: z0, maxX: x0 + w, maxZ: z0 + d };
        structureRegistry.register(dimension.id, chunksInBox(box.minX, box.minZ, box.maxX, box.maxZ), VILLAGE_ID);
      }
      catch (e) { console.warn(`[vilas] Pokécenter não colocado: ${e}`); }
      return;
    }
  }
  try { world.setDynamicProperty(doneKey, "skipped"); }
  catch { /* sem espaço para gravar */ }
}

let started = false;

export function startVillageDetector() {
  if (started) return;
  started = true;
  setLazyStructureCheck(VILLAGE_ID, lazyVillageCheck);
  startVillagesProbe();
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (String(cause) !== "Event") return;
    try { if (!TRIGGERS.has(entity.typeId)) return; }
    catch { return; }
    onVillagerSpawn(entity);
  });
  system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== POKECENTER_PROPERTY) return;
    world.setDynamicProperty(POKECENTER_PROPERTY, !/^(off|false|0)$/i.test(message.trim()));
  });
}
