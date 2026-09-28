/**
 * Registro de estruturas por chunk (frente motor).
 *
 * O Cobblemon 1.8.2 testa estruturas com granularidade de chunk: spawn usa
 * `structureManager.startsForStructure(ChunkPos)` (SpawnablePosition.kt) e evolução usa
 * `level.getChunk(pos).allReferences` (StructureRequirement.kt). A Script API estável não diz se um ponto está
 * numa estrutura (`Dimension.getGeneratedStructures` ainda é beta), então:
 * - estruturas do Cobblemon (jigsaw data-driven gerado por tools/importer/jigsaw.ts): cada peça leva uma entidade
 *   `cobblemon:structure_marker` com as tags `cobblemon:st=<índices de STRUCTURE_IDS>` e `cobblemon:sr=<raio>`;
 *   ao carregar (entityLoad/entitySpawn) os chunks cobertos por centro ± raio são registrados e o marcador some;
 * - vilas vanilla: detector em Villages.ts (registra `minecraft:village`).
 * Persistência: uma dynamic property do mundo por região de 32×32 chunks (`cobblemon:st:<dim>:<rx>:<rz>`, JSON
 * `{ "<cx>,<cz>": ["id", ...] }`), gravada em lote a cada poucos segundos.
 * Limite aceito: estruturas geradas antes desta versão não têm marcador.
 */
import { Dimension, Entity, system, Vector3, world } from "@minecraft/server";
import { STRUCTURE_IDS, STRUCTURE_TAGS } from "../../generated/scripts/structures";

export const STRUCTURE_MARKER = "cobblemon:structure_marker";
/** Id registrado para qualquer vila vanilla (village_plains, village_desert... no Java). */
export const VILLAGE_ID = "minecraft:village";
const REGION_BITS = 5;
const PREFIX = "cobblemon:st:";

// ---------------------------------------------------------------------------------------------
// Lógica pura

export function chunkOf(v: number): number {
  return Math.floor(v) >> 4;
}

/** Chunks (cx, cz) cobertos por um quadrado de raio `radius` blocos em volta de (x, z). */
export function chunksCovered(x: number, z: number, radius: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const r = Math.max(0, radius);
  for (let cx = chunkOf(x - r); cx <= chunkOf(x + r); cx++)
    for (let cz = chunkOf(z - r); cz <= chunkOf(z + r); cz++) out.push([cx, cz]);
  return out;
}

/** Chunks cobertos por uma caixa (mín/máx em blocos, inclusivos). */
export function chunksInBox(minX: number, minZ: number, maxX: number, maxZ: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let cx = chunkOf(minX); cx <= chunkOf(maxX); cx++)
    for (let cz = chunkOf(minZ); cz <= chunkOf(maxZ); cz++) out.push([cx, cz]);
  return out;
}

export function regionKey(dimensionId: string, cx: number, cz: number): string {
  return `${PREFIX}${dimensionId.replace(/^minecraft:/, "")}:${cx >> REGION_BITS}:${cz >> REGION_BITS}`;
}

/** Tags do marcador → ids das estruturas e raio. */
export function parseMarkerTags(tags: readonly string[], ids: readonly string[] = STRUCTURE_IDS): { ids: string[]; radius: number } | undefined {
  const st = tags.find(t => t.startsWith("cobblemon:st="));
  if (!st) return undefined;
  const radius = Number(tags.find(t => t.startsWith("cobblemon:sr="))?.slice(13) ?? 16);
  const out = st.slice(13).split(",").map(Number).filter(i => Number.isInteger(i) && ids[i] !== undefined).map(i => ids[i]);
  return out.length ? { ids: out, radius: Number.isFinite(radius) ? radius : 16 } : undefined;
}

/** Vilas do Java (minecraft:village_plains...) e a tag #minecraft:village caem no id único das vilas. */
export function normalizeStructureId(id: string): string {
  const plain = id.includes(":") ? id : `minecraft:${id}`;
  return /^minecraft:village(_|$)/.test(plain) ? VILLAGE_ID : plain;
}

/** Tags vanilla de estrutura que outra frente sabe expandir (frente limites-b: #minecraft:ocean_ruin...). */
const extraStructureTags = new Map<string, readonly string[]>();
export function registerStructureTag(tag: string, ids: readonly string[]) {
  extraStructureTags.set(tag, ids);
}

/** Id ou tag (#ns:path) → ids concretos (tags do Cobblemon expandidas; #minecraft:village → vila). */
export function expandStructureQuery(query: string, tags: Readonly<Record<string, readonly string[]>> = STRUCTURE_TAGS): string[] {
  if (!query.startsWith("#")) return [normalizeStructureId(query)];
  const tag = query.slice(1).includes(":") ? query.slice(1) : `minecraft:${query.slice(1)}`;
  if (tag === "minecraft:village") return [VILLAGE_ID];
  return (tags[tag] ?? extraStructureTags.get(tag) ?? []).map(normalizeStructureId);
}

type Region = Map<string, Set<string>>;

/** Armazenamento das regiões (world dynamic properties no jogo; Map nos testes). */
export interface RegistryStore {
  read(key: string): string | undefined;
  write(key: string, value: string | undefined): void;
}

export class StructureRegistry {
  private regions = new Map<string, Region>();
  private dirty = new Set<string>();

  constructor(private store: RegistryStore) { }

  private region(key: string): Region {
    let r = this.regions.get(key);
    if (r) return r;
    r = new Map();
    const raw = this.store.read(key);
    if (raw) {
      try {
        for (const [chunk, ids] of Object.entries(JSON.parse(raw) as Record<string, string[]>)) r.set(chunk, new Set(ids));
      }
      catch { /* região corrompida: recomeça vazia */ }
    }
    this.regions.set(key, r);
    return r;
  }

  /** Registra `id` nos chunks. @returns quantos chunks ganharam o id. */
  register(dimensionId: string, chunks: ReadonlyArray<[number, number]>, id: string): number {
    let added = 0;
    for (const [cx, cz] of chunks) {
      const key = regionKey(dimensionId, cx, cz);
      const r = this.region(key);
      const chunk = `${cx},${cz}`;
      const set = r.get(chunk) ?? new Set<string>();
      if (set.has(id)) continue;
      set.add(id);
      r.set(chunk, set);
      this.dirty.add(key);
      added++;
    }
    return added;
  }

  structuresInChunk(dimensionId: string, cx: number, cz: number): string[] {
    return [...(this.region(regionKey(dimensionId, cx, cz)).get(`${cx},${cz}`) ?? [])];
  }

  /** Grava as regiões alteradas. */
  flush(): number {
    let n = 0;
    for (const key of this.dirty) {
      const r = this.regions.get(key);
      if (!r) continue;
      const json: Record<string, string[]> = {};
      for (const [chunk, ids] of r) if (ids.size) json[chunk] = [...ids];
      this.store.write(key, Object.keys(json).length ? JSON.stringify(json) : undefined);
      n++;
    }
    this.dirty.clear();
    return n;
  }

  /** Esquece o cache em memória (nova sessão/teste). */
  reset() {
    this.regions.clear();
    this.dirty.clear();
  }
}

// ---------------------------------------------------------------------------------------------
// Runtime

const worldStore: RegistryStore = {
  read: key => {
    try {
      const v = world.getDynamicProperty(key);
      return typeof v === "string" ? v : undefined;
    }
    catch { return undefined; }
  },
  write: (key, value) => {
    try { world.setDynamicProperty(key, value); }
    catch (e) { console.warn(`[estruturas] não foi possível gravar ${key}: ${e}`); }
  },
};

export const structureRegistry = new StructureRegistry(worldStore);

/** Consulta preguiçosa para ids sem marcador (vilas): Villages.ts instala. */
type LazyCheck = (dimension: Dimension, location: Vector3) => void;
const lazyChecks = new Map<string, LazyCheck>();
/** Frente cliente-teste3-log: tempo máximo (ms) de consultas preguiçosas por tick (ver getStructuresAt). */
export const LAZY_CHECK_BUDGET_MS = 4;
let lazyTick = -1;
let lazySpentMs = 0;
export function setLazyStructureCheck(id: string, check: LazyCheck | undefined) {
  if (check) lazyChecks.set(id, check);
  else lazyChecks.delete(id);
}

/**
 * Ids das estruturas que referenciam o chunk do ponto (como `allReferences` do Java). `only`: roda só as consultas
 * preguiçosas desses ids (as de estruturas vanilla da frente limites-b custam um containsBlock cada).
 */
export function getStructuresAt(dimension: Dimension, location: Vector3, only?: readonly string[], now: () => number = Date.now, tick: number = system.currentTick): string[] {
  if (tick !== lazyTick) { lazyTick = tick; lazySpentMs = 0; }
  for (const [id, check] of lazyChecks) {
    if (only && !only.includes(id)) continue;
    // Frente cliente-teste3-log: orçamento por tick. Uma consulta preguiçosa é um containsBlock num volume grande (vila:
    // 97×65×97 blocos); várias num tick só, vindas das condições `structures` do spawner, fecharam uma fatia de 57 ms
    // no cliente ("passe lento … (espaço …)" no 3º teste). Passado o orçamento, as outras ficam para um tick seguinte
    // (nada é gravado como negativo: a consulta simplesmente não rodou) e vale só o registro.
    if (lazySpentMs >= LAZY_CHECK_BUDGET_MS) break;
    const t0 = now();
    try { check(dimension, location); }
    catch { /* chunk descarregado etc. */ }
    lazySpentMs += now() - t0;
  }
  return structureRegistry.structuresInChunk(dimension.id, chunkOf(location.x), chunkOf(location.z));
}

/**
 * O ponto está numa estrutura? `structureIdOrTag` como nas condições do Cobblemon: id (`cobblemon:ruins/x`,
 * `minecraft:village_plains`) ou tag (`#cobblemon:ruin`, `#minecraft:village`).
 */
export function isInStructure(dimension: Dimension, location: Vector3, structureIdOrTag: string): boolean {
  const wanted = expandStructureQuery(structureIdOrTag);
  if (!wanted.length) return false;
  const here = getStructuresAt(dimension, location, wanted);
  return here.some(id => wanted.includes(id));
}

/** Ids que o port sabe detectar: estruturas do Cobblemon (marcador), vilas e as vanilla com consulta preguiçosa. */
export function isDetectableStructure(id: string): boolean {
  return id === VILLAGE_ID || STRUCTURE_IDS.includes(id) || lazyChecks.has(id);
}

/**
 * Para as consultas das frentes de spawn/evolução: true/false quando alguma das estruturas pedidas é detectável;
 * undefined quando nenhuma é (monumento, iglu, cabana da bruxa, end city: sem detector no Bedrock estável).
 */
export function structureQuery(dimension: Dimension, location: Vector3, structures: readonly string[]): boolean | undefined {
  const detectable = structures.filter(q => expandStructureQuery(q).some(isDetectableStructure));
  if (!detectable.length) return undefined;
  return detectable.some(q => isInStructure(dimension, location, q));
}

/** Marcador de peça carregado: registra os chunks e remove a entidade. */
export function onStructureMarker(entity: Entity): boolean {
  if (entity.typeId !== STRUCTURE_MARKER) return false;
  let parsed: ReturnType<typeof parseMarkerTags>;
  let loc: Vector3;
  let dimId: string;
  try {
    parsed = parseMarkerTags(entity.getTags());
    loc = entity.location;
    dimId = entity.dimension.id;
  }
  catch { return false; }
  if (parsed) {
    const chunks = chunksCovered(loc.x, loc.z, parsed.radius);
    for (const id of parsed.ids) structureRegistry.register(dimId, chunks, id);
  }
  system.run(() => {
    try { if (entity.isValid) entity.remove(); }
    catch { /* já removido */ }
  });
  return true;
}

let started = false;

export function startStructureRegistry() {
  if (started) return;
  started = true;
  world.afterEvents.entityLoad.subscribe(({ entity }) => { if (entity.typeId === STRUCTURE_MARKER) onStructureMarker(entity); });
  world.afterEvents.entitySpawn.subscribe(({ entity }) => { if (entity.typeId === STRUCTURE_MARKER) onStructureMarker(entity); });
  // Marcadores já carregados quando o script subiu (reload).
  system.runTimeout(() => {
    for (const dim of ["overworld", "nether", "the_end"]) {
      try {
        for (const e of world.getDimension(dim).getEntities({ type: STRUCTURE_MARKER })) onStructureMarker(e);
      }
      catch { /* dimensão sem jogadores */ }
    }
  }, 40);
  system.runInterval(() => structureRegistry.flush(), 100);
}
