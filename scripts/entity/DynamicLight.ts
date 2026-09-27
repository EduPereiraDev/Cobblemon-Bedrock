/**
 * Luz dinâmica (lightingData do 1.8.2: LightingData.kt + compat LambDynamicLights, PokemonLuminance/PlayerLuminance).
 *
 * No Java a luz só existe com um mod de luz dinâmica; aqui é nativa: um bloco `minecraft:light_block_<n>` segue a
 * cabeça de cada Pokémon com `lightingData` (espécie ou forma), respeitando o LiquidGlowMode (LAND = fora d'água,
 * UNDERWATER = submerso, BOTH), e o jogador com Pokédex na mão emite 13 (PlayerLuminance). Pokémon no ombro contam
 * (são entidades montadas no jogador).
 *
 * Barato e limpo: uma passada a cada 5 ticks só pelos emissores conhecidos; o bloco só muda quando a célula ou o
 * nível mudam; nunca substitui nada além de ar, água parada ou uma luz nossa; as posições ficam gravadas numa
 * propriedade do mundo e são limpas ao recarregar (queda do servidor) ou quando o chunk volta a carregar.
 * Desligar: `/scriptevent cobblemon:dynamic_lights off`.
 */
import { Block, BlockPermutation, Dimension, Entity, EquipmentSlot, Player, system, Vector3, world } from "@minecraft/server";
import { LIGHTING } from "../../generated/scripts/mundoDetalhes";

export type GlowMode = "LAND" | "UNDERWATER" | "BOTH";

/** Nível de luz da espécie/forma (0 = não emite), como CustomLuminance.extractFormLightLevel. */
export function lightLevelFor(species: string, formName: string | undefined, underwater: boolean): number {
  const entry = LIGHTING[species];
  if (!entry) return 0;
  const form = formName ? entry.forms?.[formName.toLowerCase()] : undefined;
  const data = form ?? entry.species;
  if (!data) return 0;
  const mode = data.mode as GlowMode;
  const ok = underwater ? mode === "UNDERWATER" || mode === "BOTH" : mode === "LAND" || mode === "BOTH";
  return ok ? data.level : 0;
}

/** PlayerLuminance: Pokédex na mão = 13. */
export const POKEDEX_LIGHT = 13;

export function hasLightingData(species: string): boolean {
  return !!LIGHTING[species];
}

interface Cell {
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** A célula era água parada (a luz foi posta alagada e volta a ser água). */
  water: boolean;
  owners: Map<string, number>;
  placed: number;
}

const cells = new Map<string, Cell>();
/** Emissor (id da entidade) → chave da célula que ele ilumina. */
const emitterCell = new Map<string, string>();
/** Pokémon com lightingData carregados: id → [espécie, forma]. */
const emitters = new Map<string, { species: string; form?: string }>();
type StoredLight = [string, number, number, number, boolean];

/** Luzes gravadas que ainda não puderam ser limpas (chunk descarregado). */
let pendingCleanup: StoredLight[] = [];
let dirty = false;
let enabled = true;
/** Já avisou da falha de gravação (evita repetir o aviso a cada tick até voltar a gravar). */
let persistWarned = false;

const STORE = "cobblemon:dyn_lights";
/** Tamanho máximo de cada pedaço gravado (a string da propriedade do mundo tem limite de ~32 KB). */
export const STORE_MAX_CHARS = 30000;
/** Quantos pedaços (propriedades) a lista pode ocupar: STORE, STORE_1, ..., STORE_<n-1>. */
export const STORE_MAX_CHUNKS = 8;
/** Teto de luzes pendentes guardadas (memória e gravação limitadas). */
export const PENDING_CAP = 2000;

const storeKey = (index: number) => index === 0 ? STORE : `${STORE}_${index}`;

/**
 * Divide a lista em textos JSON de no máximo `maxChars` cada (no máximo `maxChunks` pedaços).
 * `dropped` = quantas entradas não couberam.
 */
export function chunkLights(entries: readonly StoredLight[], maxChars = STORE_MAX_CHARS, maxChunks = STORE_MAX_CHUNKS): { chunks: string[]; dropped: number } {
  const chunks: string[] = [];
  let parts: string[] = [];
  let length = 2;
  let used = 0;
  for (const entry of entries) {
    const text = JSON.stringify(entry);
    const next = length + text.length + (parts.length ? 1 : 0);
    if (next > maxChars && parts.length) {
      chunks.push(`[${parts.join(",")}]`);
      parts = [];
      length = 2;
      if (chunks.length >= maxChunks) break;
    }
    if (2 + text.length > maxChars) continue;
    length += text.length + (parts.length ? 1 : 0);
    parts.push(text);
    used++;
  }
  if (parts.length && chunks.length < maxChunks) chunks.push(`[${parts.join(",")}]`);
  else if (parts.length) used -= parts.length;
  return { chunks, dropped: entries.length - used };
}

/** Guarda uma luz que não pôde ser limpa agora, respeitando o teto. */
function addPending(entry: StoredLight) {
  if (pendingCleanup.length >= PENDING_CAP) {
    console.warn(`[mundo-detalhes] luz dinâmica: ${PENDING_CAP} luzes pendentes; ${entry.slice(0, 4).join(" ")} não será limpa`);
    return;
  }
  pendingCleanup.push(entry);
}
const TOGGLE = "cobblemon:dynamic_lights_off";

const cellKey = (dimension: string, x: number, y: number, z: number) => `${dimension}|${x}|${y}|${z}`;

function isOurLight(block: Block): boolean {
  return block.typeId.startsWith("minecraft:light_block");
}

function lightPermutation(level: number): BlockPermutation | undefined {
  try { return BlockPermutation.resolve(`minecraft:light_block_${level}`); }
  catch {
    try { return BlockPermutation.resolve("minecraft:light_block", { block_light_level: level }); }
    catch { return undefined; }
  }
}

function isStillWater(block: Block): boolean {
  if (block.typeId !== "minecraft:water") return false;
  try { return block.permutation.getState("liquid_depth" as never) === 0; }
  catch { return true; }
}

/** Grava a luz no bloco. false = a célula não aceita luz agora. */
function applyLight(block: Block, level: number, water: boolean): boolean {
  const perm = lightPermutation(level);
  if (!perm) return false;
  block.setPermutation(perm);
  if (water) {
    try { block.setWaterlogged(true); }
    catch { /* luz sem água: melhor que nada */ }
  }
  return true;
}

function restoreBlock(block: Block, water: boolean) {
  if (!isOurLight(block)) return;
  block.setType(water ? "minecraft:water" : "minecraft:air");
}

function blockAt(dimension: Dimension, pos: Vector3): Block | undefined {
  try { return dimension.getBlock(pos); }
  catch { return undefined; }
}

function release(emitterId: string) {
  const key = emitterCell.get(emitterId);
  if (!key) return;
  emitterCell.delete(emitterId);
  const cell = cells.get(key);
  if (!cell) return;
  cell.owners.delete(emitterId);
  const dimension = world.getDimension(cell.dimension);
  const block = blockAt(dimension, cell);
  if (!cell.owners.size) {
    cells.delete(key);
    dirty = true;
    if (block) restoreBlock(block, cell.water);
    else addPending([cell.dimension, cell.x, cell.y, cell.z, cell.water]);
    return;
  }
  const level = Math.max(...cell.owners.values());
  if (level !== cell.placed && block && isOurLight(block) && applyLight(block, level, cell.water)) cell.placed = level;
}

/** Acende (ou mantém) a luz do emissor na posição; level 0 = apaga. */
function light(emitterId: string, dimension: Dimension, pos: Vector3, level: number) {
  if (level <= 0) {
    release(emitterId);
    return;
  }
  const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
  const key = cellKey(dimension.id, x, y, z);
  const current = emitterCell.get(emitterId);
  if (current === key) {
    const cell = cells.get(key)!;
    if (cell.owners.get(emitterId) === level) return;
    cell.owners.set(emitterId, level);
    const want = Math.max(...cell.owners.values());
    const block = blockAt(dimension, cell);
    if (want !== cell.placed && block && isOurLight(block) && applyLight(block, want, cell.water)) cell.placed = want;
    return;
  }
  const existing = cells.get(key);
  if (existing) {
    release(emitterId);
    existing.owners.set(emitterId, level);
    emitterCell.set(emitterId, key);
    const want = Math.max(...existing.owners.values());
    const block = blockAt(dimension, existing);
    if (want !== existing.placed && block && isOurLight(block) && applyLight(block, want, existing.water)) existing.placed = want;
    return;
  }
  const block = blockAt(dimension, { x, y, z });
  if (!block) return;
  const water = isStillWater(block);
  if (!block.isAir && !water) {
    // Célula ocupada (bloco sólido, planta...): mantém a luz anterior até achar uma célula livre.
    return;
  }
  release(emitterId);
  if (!applyLight(block, level, water)) return;
  cells.set(key, { dimension: dimension.id, x, y, z, water, owners: new Map([[emitterId, level]]), placed: level });
  emitterCell.set(emitterId, key);
  dirty = true;
}

/** Registra/atualiza um Pokémon carregado (chamado pela passada de 1 s de scripts/entity). */
export function trackLightEmitter(entity: Entity, species: string, form: string | undefined) {
  if (!hasLightingData(species)) return;
  emitters.set(entity.id, { species, form });
}

export function forgetLightEmitter(entityId: string) {
  emitters.delete(entityId);
  release(entityId);
}

function heldPokedex(player: Player): boolean {
  try {
    const eq = player.getComponent("minecraft:equippable");
    return [EquipmentSlot.Mainhand, EquipmentSlot.Offhand].some(slot => eq?.getEquipment(slot)?.typeId.startsWith("cobblemon:pokedex") === true);
  }
  catch { return false; }
}

function tick() {
  if (!enabled) return;
  for (const [id, info] of emitters) {
    const entity = world.getEntity(id);
    if (!entity?.isValid) {
      forgetLightEmitter(id);
      continue;
    }
    try {
      const head = entity.getHeadLocation();
      const level = lightLevelFor(info.species, info.form, entity.isInWater);
      light(id, entity.dimension, head, level);
    }
    catch {
      forgetLightEmitter(id);
    }
  }
  for (const player of world.getAllPlayers()) {
    try {
      light(`player:${player.id}`, player.dimension, player.getHeadLocation(), heldPokedex(player) ? POKEDEX_LIGHT : 0);
    }
    catch { /* jogador saindo */ }
  }
  // Grava já as luzes postas neste tick (barato quando nada mudou): uma queda do servidor não as esquece.
  persist();
}

function persist() {
  if (!dirty) return;
  dirty = false;
  const list: StoredLight[] = [...cells.values()].map(c => [c.dimension, c.x, c.y, c.z, c.water]);
  const { chunks, dropped } = chunkLights([...list, ...pendingCleanup]);
  try {
    for (let i = 0; i < STORE_MAX_CHUNKS; i++) world.setDynamicProperty(storeKey(i), chunks[i]);
    if (dropped > 0 && !persistWarned) console.warn(`[mundo-detalhes] luz dinâmica: ${dropped} luzes não couberam na gravação`);
    persistWarned = dropped > 0;
  }
  catch (e) {
    // Tenta de novo no próximo tick; avisa uma vez só até voltar a gravar.
    dirty = true;
    if (!persistWarned) console.warn(`[mundo-detalhes] luz dinâmica: falha ao gravar as luzes: ${e}`);
    persistWarned = true;
  }
}

/** Limpa luzes que ficaram de uma sessão anterior ou de chunks descarregados. */
function cleanupPending() {
  if (!pendingCleanup.length) return;
  const keep: StoredLight[] = [];
  for (const entry of pendingCleanup) {
    const [dim, x, y, z, water] = entry;
    if (cells.has(cellKey(dim, x, y, z))) continue;
    let dimension: Dimension;
    try { dimension = world.getDimension(dim); }
    catch { continue; }
    const block = blockAt(dimension, { x, y, z });
    if (!block) keep.push(entry);
    else restoreBlock(block, water);
  }
  if (keep.length !== pendingCleanup.length) dirty = true;
  pendingCleanup = keep;
}

function turnOff() {
  for (const id of [...emitterCell.keys()]) release(id);
  persist();
}

let started = false;

export function startDynamicLights() {
  if (started) return;
  started = true;
  enabled = world.getDynamicProperty(TOGGLE) !== true;
  pendingCleanup = [];
  for (let i = 0; i < STORE_MAX_CHUNKS; i++) {
    try {
      const stored = world.getDynamicProperty(storeKey(i));
      if (typeof stored === "string") for (const entry of JSON.parse(stored) as StoredLight[]) addPending(entry);
    }
    catch { /* pedaço corrompido: ignora */ }
  }
  system.runInterval(tick, 5);
  system.runInterval(() => {
    cleanupPending();
    persist();
  }, 40);
  world.afterEvents.playerLeave.subscribe(({ playerId }) => release(`player:${playerId}`));
  system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "cobblemon:dynamic_lights") return;
    const on = !/^(off|false|0|desligar)$/i.test(message.trim());
    enabled = on;
    world.setDynamicProperty(TOGGLE, on ? undefined : true);
    if (!on) turnOff();
  });
}
