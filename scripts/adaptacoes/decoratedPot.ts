/**
 * Vaso decorado do Cobblemon (`cobblemon:decorated_pot`): o vaso vanilla do MC 1.21.1 com os sherds do Cobblemon.
 *
 * O vaso vanilla do Bedrock não aceita padrões de add-on, então um vaso feito com ao menos um sherd do Cobblemon é
 * este bloco: corpo liso do vaso vanilla (mesmas texturas) + entidade `cobblemon:decorated_pot_display` no bloco, que
 * desenha os lados com sherd (propriedade `cobblemon:face_<lado>` = índice em POT_PATTERNS) e guarda o item
 * (1 espaço, como o DecoratedPotBlockEntity). Registro por posição: MachineStore("adapt_pot") = decorações + direção.
 *
 * - Receita (DecoratedPotRecipe): a grade de criação do Bedrock não tem evento para scripts; usar uma mesa de
 *   trabalho segurando um sherd do Cobblemon abre a tela do vaso (os 4 lados: fundo, esquerda, direita, frente).
 * - Colocar: a direção é a do jogador (getHorizontalDirection); a frente fica virada para ele.
 * - Usar com item: guarda 1 (mesma pilha até o máximo), som `insert` com tom 0,7 + 0,5 × cheio e `dust_plume`;
 *   sem poder guardar: som `insert_fail`.
 * - Quebrar: ferramenta de #breaks_decorated_pots sem Toque Suave → racha e solta os 4 lados (tijolo no vazio);
 *   senão solta o vaso com as decorações. O conteúdo sempre cai (também no criativo). Projétil de impacto (com
 *   mobGriefing) racha; explosão solta o vaso.
 * - Funil (pelos lados/cima põe, embaixo tira) e comparador (sinal do contêiner de 1 espaço) no laço de 8 ticks. O
 *   laço é repartido: a cada tick só 1/8 dos vasos (cada um continua a cada 8 ticks); a entidade vem de
 *   `world.getEntity` pelo id guardado em memória; os vizinhos só são lidos se houver funil/comparador no 3×3×3.
 * - Bloco que some sem evento (/setblock ou /fill destroy, Wither): solta o vaso com as decorações e o conteúdo.
 *   Entidade de exibição sem vaso embaixo (carregada ou criada): solta o item e some.
 */
import {
  Block, BlockComponentOnPlaceEvent, BlockVolume, BlockComponentPlayerInteractEvent, BlockComponentPlayerPlaceBeforeEvent, BlockCustomComponent, Container, Dimension,
  Entity, GameMode, ItemStack, Player, RawMessage, system, Vector3, world,
} from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { blockKey, MachineStore, parseBlockKey } from "../machines/store";
import { giveOrDrop, itemNameOf } from "../machines/itemUtil";
import {
  breakDrops, canInsert, cracksWith, Dir4, EMPTY_DECORATIONS, faceProperties, facingFromYaw, IMPACT_PROJECTILES, ingredientCounts, insertPitch,
  isEmptyDecorations, needsCobblemonPot, normalizeDecorations, PotDecorations, tooltipOrder,
} from "./decoratedPotLogic";
import { BRICK, DECORATED_POT, DECORATED_POT_DISPLAY, isCobblemonSherd, POT_PATTERNS } from "./sherds";
import { containerSignal, Face, FACE_OFFSET, touchedFace } from "./containerLogic";
import { applyComparatorStates, comparatorMask, hopperInfo } from "./potHoppers";

export interface PotRecord {
  /** Decorações (fundo, esquerda, direita, frente). */
  d: PotDecorations;
  /** Direção do bloco (HORIZONTAL_FACING). */
  f: Dir4;
}

export const potStore = new MachineStore<PotRecord>("adapt_pot");
/** Dynamic property do item com as decorações (DataComponents.POT_DECORATIONS). */
export const DECORATIONS_PROPERTY = "cobblemon:pot_decorations";

export const POT_TEXT = {
  title: "cobblemon.adaptacoes.pot.title",
  back: "cobblemon.adaptacoes.pot.back",
  left: "cobblemon.adaptacoes.pot.left",
  right: "cobblemon.adaptacoes.pot.right",
  front: "cobblemon.adaptacoes.pot.front",
  craft: "cobblemon.adaptacoes.pot.craft",
  needCobblemon: "cobblemon.adaptacoes.pot.need_cobblemon",
  missing: "cobblemon.adaptacoes.pot.missing",
} as const;

// ---------------------------------------------------------------------------------------------
// Item

/** Item do vaso com as decorações (dynamic property + dica na ordem do Java). */
export function createPotItem(d: PotDecorations): ItemStack {
  const stack = new ItemStack(DECORATED_POT, 1);
  if (!isEmptyDecorations(d)) {
    stack.setDynamicProperty(DECORATIONS_PROPERTY, JSON.stringify(d));
    stack.setLore(tooltipOrder(d).map(id => ({ rawtext: [{ text: "§7" }, itemNameOf(id)] })));
  }
  return stack;
}

export function decorationsOf(stack: ItemStack | undefined): PotDecorations {
  if (stack?.typeId !== DECORATED_POT) return [...EMPTY_DECORATIONS];
  try {
    const raw = stack.getDynamicProperty(DECORATIONS_PROPERTY);
    return typeof raw === "string" ? normalizeDecorations(JSON.parse(raw)) : [...EMPTY_DECORATIONS];
  }
  catch { return [...EMPTY_DECORATIONS]; }
}

// ---------------------------------------------------------------------------------------------
// Entidade de exibição/armazenamento

function center(location: Vector3, dy = 0): Vector3 {
  return { x: Math.floor(location.x) + 0.5, y: Math.floor(location.y) + dy, z: Math.floor(location.z) + 0.5 };
}

export function findDisplay(dimension: Dimension, location: Vector3): Entity | undefined {
  return findDisplays(dimension, location)[0];
}

export function findDisplays(dimension: Dimension, location: Vector3): Entity[] {
  try { return dimension.getEntities({ type: DECORATED_POT_DISPLAY, location: center(location, 0.5), maxDistance: 0.9 }); }
  catch { return []; }
}

/**
 * Junta entidades duplicadas do mesmo vaso (a do conteúdo fica; o item das outras vai para ela ou cai no chão).
 * Devolve a que ficou.
 */
export function mergeDisplays(dimension: Dimension, location: Vector3, list: Entity[]): Entity | undefined {
  if (list.length <= 1) return list[0];
  const keep = list.find(e => !!containerOf(e)?.getItem(0)) ?? list[0];
  const target = containerOf(keep);
  for (const other of list) {
    if (other === keep) continue;
    const c = containerOf(other);
    const item = c?.getItem(0);
    if (item) {
      c!.setItem(0, undefined);
      const current = target?.getItem(0);
      if (target && !current) target.setItem(0, item);
      else if (target && current && current.isStackableWith(item) && current.amount + item.amount <= current.maxAmount) {
        current.amount += item.amount;
        target.setItem(0, current);
      }
      else spawnDrop(dimension, location, item);
    }
    appliedFaces.delete(other.id);
    try { other.remove(); }
    catch { /* já removida */ }
  }
  if (keep) displayIds.set(blockKey(dimension.id, location), keep.id);
  return keep;
}

/** Id da entidade de cada vaso (em memória): `world.getEntity` é bem mais barato que `getEntities` por posição. */
const displayIds = new Map<string, string>();
/** Direção + decorações já gravadas em cada entidade (id → assinatura): o laço não relê as propriedades. */
const appliedFaces = new Map<string, string>();

function faceSignature(rec: PotRecord): string {
  return `${rec.f}|${rec.d.join(",")}`;
}

function sameBlock(a: Vector3, b: Vector3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

/** Entidades do vaso: a do id guardado, se ainda é válida e está no bloco; senão a busca por posição. */
export function displaysAt(dimension: Dimension, location: Vector3): Entity[] {
  const key = blockKey(dimension.id, location);
  const id = displayIds.get(key);
  if (id !== undefined) {
    let e: Entity | undefined;
    try { e = world.getEntity(id); }
    catch { e = undefined; }
    try { if (e?.isValid && e.typeId === DECORATED_POT_DISPLAY && e.dimension.id === dimension.id && sameBlock(e.location, location)) return [e]; }
    catch { /* saindo */ }
    displayIds.delete(key);
  }
  const found = findDisplays(dimension, location);
  if (found.length === 1) displayIds.set(key, found[0].id);
  return found;
}

function applyFaces(entity: Entity, rec: PotRecord, force = false) {
  try {
    const sig = faceSignature(rec);
    if (!force && appliedFaces.get(entity.id) === sig) return;
    // Modelo virado para o norte (yaw 180): cada bone fica no lado do mundo com o mesmo nome. Só grava se mudou.
    const r = entity.getRotation();
    if (r.x !== 0 || Math.abs(Math.abs(r.y) - 180) > 0.01) entity.setRotation({ x: 0, y: 180 });
    const props = faceProperties(rec.f, rec.d);
    for (const [side, value] of Object.entries(props)) {
      if (entity.getProperty(`cobblemon:face_${side}`) !== value) entity.setProperty(`cobblemon:face_${side}`, value);
    }
    appliedFaces.set(entity.id, sig);
  }
  catch { /* entidade saindo */ }
}

/** Entidade do vaso, criando se faltar (propriedades regravadas no tick seguinte: as do tick do spawn se perdem). */
export function ensureDisplay(dimension: Dimension, location: Vector3, rec: PotRecord, existing?: Entity): Entity | undefined {
  let display = existing ?? displaysAt(dimension, location)[0];
  if (!display) {
    try { display = dimension.spawnEntity(DECORATED_POT_DISPLAY as never, center(location), { initialRotation: 180 }); }
    catch { return undefined; }
    const spawned = display;
    displayIds.set(blockKey(dimension.id, location), spawned.id);
    system.runTimeout(() => { if (spawned.isValid) applyFaces(spawned, rec, true); }, 2);
  }
  applyFaces(display, rec);
  return display;
}

function containerOf(entity: Entity | undefined): Container | undefined {
  try { return entity?.getComponent("minecraft:inventory")?.container; }
  catch { return undefined; }
}

/** Solta o item guardado na entidade e a remove. */
function dropDisplay(dimension: Dimension, location: Vector3, display: Entity) {
  const container = containerOf(display);
  const item = container?.getItem(0);
  if (item) {
    container!.setItem(0, undefined);
    try { dimension.spawnItem(item, center(location, 0.5)); }
    catch (e) { console.warn(`[adaptacoes] vaso: não foi possível soltar ${item.typeId}: ${e}`); }
  }
  appliedFaces.delete(display.id);
  try { display.remove(); }
  catch { /* já removida */ }
}

/** Solta o conteúdo e remove as entidades do bloco, inclusive duplicatas (Containers.dropContentsOnDestroy). */
function dropContents(dimension: Dimension, location: Vector3) {
  for (const display of findDisplays(dimension, location)) dropDisplay(dimension, location, display);
  displayIds.delete(blockKey(dimension.id, location));
}

/**
 * Entidade de exibição sem o vaso embaixo (bloco trocado com o chunk descarregado, /summon...): solta o item e some.
 * Chunk descarregado ou bloco ilegível = não sabe, não mexe. Devolve se removeu.
 */
export function removeOrphanDisplay(entity: Entity): boolean {
  if (!entity.isValid || entity.typeId !== DECORATED_POT_DISPLAY) return false;
  const dimension = entity.dimension;
  const l = entity.location;
  const location = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
  const block = loadedBlock(dimension, location);
  if (!block || block.typeId === DECORATED_POT) return false;
  const key = blockKey(dimension.id, location);
  if (displayIds.get(key) === entity.id) displayIds.delete(key);
  dropDisplay(dimension, location, entity);
  return true;
}

function spawnDrop(dimension: Dimension, location: Vector3, stack: ItemStack) {
  try { dimension.spawnItem(stack, center(location, 0.5)); }
  catch (e) { console.warn(`[adaptacoes] vaso: não foi possível soltar ${stack.typeId}: ${e}`); }
}

function playAt(dimension: Dimension, sound: string, location: Vector3, pitch = 1) {
  try { dimension.playSound(sound, center(location, 0.5), { pitch }); }
  catch { /* som é cosmético */ }
}

// ---------------------------------------------------------------------------------------------
// Colocar, usar, quebrar

/** Decorações e direção do item que o jogador está pondo (lidas no beforeOnPlayerPlace). */
const pending = new Map<string, PotRecord & { tick: number }>();

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

function heldItem(player: Player): ItemStack | undefined {
  try { return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex); }
  catch { return undefined; }
}

/** Registra um vaso no lugar (se ainda não houver) e cria a entidade. */
export function registerPot(block: Block, rec?: PotRecord) {
  const key = blockKey(block.dimension.id, block.location);
  const current = potStore.get(key);
  const use = current ?? rec ?? { d: [...EMPTY_DECORATIONS] as PotDecorations, f: "north" as Dir4 };
  if (!current) potStore.set(key, use);
  ensureDisplay(block.dimension, block.location, use);
}

/** Tentativas (a cada INTERACT_RETRY_TICKS) de achar a entidade de um vaso registrado antes de criar outra. */
export const INTERACT_RETRIES = 3;
export const INTERACT_RETRY_TICKS = 5;

/** DecoratedPotBlock.useItemOn / useWithoutItem. */
export function interactWithPot(player: Player, block: Block, attempt = 0) {
  const key = blockKey(block.dimension.id, block.location);
  const registered = potStore.get(key);
  const rec = registered ?? { d: [...EMPTY_DECORATIONS] as PotDecorations, f: "north" as Dir4 };
  if (!registered) potStore.set(key, rec);
  const found = displaysAt(block.dimension, block.location);
  if (!found.length && registered && attempt < INTERACT_RETRIES) {
    // As entidades do chunk carregam alguns ticks depois dos blocos: espera a do vaso em vez de criar uma segunda
    // (vazia) ao lado da que guarda o item.
    system.runTimeout(() => {
      try { if (player.isValid && block.isValid && block.typeId === DECORATED_POT) interactWithPot(player, block, attempt + 1); }
      catch (e) { console.warn(`[adaptacoes] vaso: ${e}`); }
    }, INTERACT_RETRY_TICKS);
    return;
  }
  const kept = found.length > 1 ? mergeDisplays(block.dimension, block.location, found) : found[0];
  const display = ensureDisplay(block.dimension, block.location, rec, kept);
  const container = containerOf(display);
  const held = heldItem(player);
  const stored = container?.getItem(0);
  if (container && held && canInsert(stored ? { n: stored.amount, max: stored.maxAmount } : undefined, !!stored && stored.isStackableWith(held))) {
    let after: ItemStack;
    if (stored) { stored.amount += 1; after = stored; }
    else { after = held.clone(); after.amount = 1; }
    container.setItem(0, after);
    if (!isCreative(player)) {
      const inv = player.getComponent("minecraft:inventory")?.container;
      if (held.amount <= 1) inv?.setItem(player.selectedSlotIndex, undefined);
      else { held.amount -= 1; inv?.setItem(player.selectedSlotIndex, held); }
    }
    playAt(block.dimension, "block.decorated_pot.insert", block.location, insertPitch({ n: after.amount, max: after.maxAmount }));
    for (let i = 0; i < 7; i++) {
      try { block.dimension.spawnParticle("minecraft:dust_plume", center(block.location, 1.2)); }
      catch { break; }
    }
    return;
  }
  playAt(block.dimension, "block.decorated_pot.insert_fail", block.location);
}

function toolTags(stack: ItemStack | undefined): string[] {
  try { return stack?.getTags() ?? []; }
  catch { return []; }
}

function hasSilkTouch(stack: ItemStack | undefined): boolean {
  try { return !!stack?.getComponent("minecraft:enchantable")?.getEnchantment("silk_touch"); }
  catch { return false; }
}

/** Solta os lados (rachado) ou o vaso. */
function dropLoot(dimension: Dimension, location: Vector3, d: PotDecorations, cracked: boolean) {
  const drops = breakDrops(d, cracked);
  for (const id of drops.items) spawnDrop(dimension, location, new ItemStack(id, 1));
  if (drops.pot) spawnDrop(dimension, location, createPotItem(d));
}

/** Vaso quebrado por jogador (playerWillDestroy + loot table + onRemove). Devolve se rachou. */
export function onPotBrokenByPlayer(creative: boolean, dimension: Dimension, location: Vector3, tool: ItemStack | undefined): boolean {
  const key = blockKey(dimension.id, location);
  const rec = potStore.get(key);
  const d = rec?.d ?? [...EMPTY_DECORATIONS] as PotDecorations;
  const cracked = cracksWith(tool?.typeId, toolTags(tool), hasSilkTouch(tool));
  dropContents(dimension, location);
  if (!creative) dropLoot(dimension, location, d, cracked);
  if (cracked) playAt(dimension, "shatter.decorated_pot", location);
  potStore.delete(key);
  return cracked;
}

/** Explosão / outra remoção com drops: o vaso inteiro. */
export function onPotDestroyed(dimension: Dimension, location: Vector3, cracked: boolean) {
  const key = blockKey(dimension.id, location);
  const rec = potStore.get(key);
  dropContents(dimension, location);
  dropLoot(dimension, location, rec?.d ?? [...EMPTY_DECORATIONS] as PotDecorations, cracked);
  if (cracked) playAt(dimension, "shatter.decorated_pot", location);
  potStore.delete(key);
}

export const decoratedPotComponent: BlockCustomComponent = {
  beforeOnPlayerPlace(arg: BlockComponentPlayerPlaceBeforeEvent) {
    if (!arg.player) return;
    const key = blockKey(arg.block.dimension.id, arg.block.location);
    pending.set(key, { d: decorationsOf(heldItem(arg.player)), f: facingFromYaw(arg.player.getRotation().y), tick: system.currentTick });
  },
  onPlace(arg: BlockComponentOnPlaceEvent) {
    const block = arg.block;
    const key = blockKey(block.dimension.id, block.location);
    const p = pending.get(key);
    pending.delete(key);
    system.run(() => {
      if (!block.isValid || block.typeId !== DECORATED_POT) return;
      registerPot(block, p && system.currentTick - p.tick < 40 ? { d: p.d, f: p.f } : undefined);
    });
  },
  onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
    const player = arg.player;
    if (!player) return;
    const block = arg.block;
    system.run(() => {
      if (!player.isValid || !block.isValid || block.typeId !== DECORATED_POT) return;
      try { interactWithPot(player, block); }
      catch (e) { console.warn(`[adaptacoes] vaso: ${e}`); }
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Receita (tela na mesa de trabalho)

/** Itens do inventário que servem de lado do vaso (id → quantidade). */
export function potIngredientsIn(container: Container | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!container) return out;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && POT_PATTERNS.some(p => p.item === it.typeId)) out.set(it.typeId, (out.get(it.typeId) ?? 0) + it.amount);
  }
  return out;
}

function removeItems(container: Container, id: string, amount: number) {
  let left = amount;
  for (let i = 0; i < container.size && left > 0; i++) {
    const it = container.getItem(i);
    if (it?.typeId !== id) continue;
    const take = Math.min(left, it.amount);
    left -= take;
    if (take >= it.amount) container.setItem(i, undefined);
    else { it.amount -= take; container.setItem(i, it); }
  }
}

/** Tela do vaso: escolhe os 4 lados entre os itens que o jogador tem. */
export async function openPotCrafting(player: Player, preferred?: string) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  const have = potIngredientsIn(inv);
  const options = POT_PATTERNS.map(p => p.item).filter(id => (have.get(id) ?? 0) > 0);
  if (!options.length) return;
  const label = (id: string): RawMessage => ({ rawtext: [itemNameOf(id), { text: ` §7×${have.get(id) ?? 0}` }] });
  const brickIndex = Math.max(0, options.indexOf(BRICK));
  const frontIndex = Math.max(0, options.indexOf(preferred ?? ""));
  const form = new ModalFormData()
    .title({ translate: POT_TEXT.title })
    .dropdown({ translate: POT_TEXT.back }, options.map(label), { defaultValueIndex: brickIndex })
    .dropdown({ translate: POT_TEXT.left }, options.map(label), { defaultValueIndex: brickIndex })
    .dropdown({ translate: POT_TEXT.right }, options.map(label), { defaultValueIndex: brickIndex })
    .dropdown({ translate: POT_TEXT.front }, options.map(label), { defaultValueIndex: frontIndex })
    .submitButton({ translate: POT_TEXT.craft });
  const res = await form.show(player);
  if (res.canceled || !res.formValues || !player.isValid) return;
  craftPot(player, res.formValues.slice(0, 4).map(v => options[Number(v)] ?? BRICK) as PotDecorations);
}

/** Cria o vaso com as decorações escolhidas, gastando os itens do inventário. Devolve se criou. */
export function craftPot(player: Player, d: PotDecorations): boolean {
  if (!needsCobblemonPot(d)) { player.sendMessage({ translate: POT_TEXT.needCobblemon }); return false; }
  const now = player.getComponent("minecraft:inventory")?.container;
  const current = potIngredientsIn(now);
  const need = ingredientCounts(d);
  for (const [id, n] of need) if ((current.get(id) ?? 0) < n) { player.sendMessage({ translate: POT_TEXT.missing }); return false; }
  // A grade de criação gasta os ingredientes também no criativo.
  for (const [id, n] of need) removeItems(now!, id, n);
  giveOrDrop(player, createPotItem(d));
  return true;
}

// ---------------------------------------------------------------------------------------------
// Funil e comparador

function neighborOf(block: Block, face: Face): Block | undefined {
  const o = FACE_OFFSET[face];
  try { return block.dimension.getBlock({ x: block.location.x + o.x, y: block.location.y + o.y, z: block.location.z + o.z }); }
  catch { return undefined; }
}

/** Um funil pondo 1 item no vaso (addItem num contêiner de 1 espaço). */
export function pushIntoPotContainer(pot: Container, hopper: Container): boolean {
  const stored = pot.getItem(0);
  for (let i = 0; i < hopper.size; i++) {
    const item = hopper.getItem(i);
    if (!item) continue;
    if (!canInsert(stored ? { n: stored.amount, max: stored.maxAmount } : undefined, !!stored && stored.isStackableWith(item))) continue;
    if (stored) { stored.amount += 1; pot.setItem(0, stored); }
    else { const one = item.clone(); one.amount = 1; pot.setItem(0, one); }
    if (item.amount <= 1) hopper.setItem(i, undefined);
    else { item.amount -= 1; hopper.setItem(i, item); }
    return true;
  }
  return false;
}

/** O funil de baixo tirando 1 item do vaso. */
export function pullFromPotContainer(pot: Container, hopper: Container): boolean {
  const stored = pot.getItem(0);
  if (!stored) return false;
  for (let i = 0; i < hopper.size; i++) {
    const h = hopper.getItem(i);
    if (h && !(h.isStackableWith(stored) && h.amount < h.maxAmount)) continue;
    if (h) { h.amount += 1; hopper.setItem(i, h); }
    else { const one = stored.clone(); one.amount = 1; hopper.setItem(i, one); }
    if (stored.amount <= 1) pot.setItem(0, undefined);
    else { stored.amount -= 1; pot.setItem(0, stored); }
    return true;
  }
  return false;
}

function loadedBlock(dimension: Dimension, location: Vector3): Block | undefined {
  try { return dimension.isChunkLoaded(location) ? dimension.getBlock(location) : undefined; }
  catch { return undefined; }
}

/** Laços seguidos sem a entidade antes de recriá-la (8 ticks cada). */
export const MISSING_LOOPS = 5;
const missing = new Map<string, number>();
/** Vasos vistos sem o bloco numa visita (confirmação na seguinte). */
const vanished = new Set<string>();
/** Cada vaso é visitado a cada POT_INTERVAL ticks, repartidos entre os ticks. */
export const POT_INTERVAL = 8;
const NEIGHBOR_TYPES = ["minecraft:hopper", "minecraft:unpowered_comparator", "minecraft:powered_comparator"];

/** Há funil ou comparador no 3×3×3 em volta? (1 chamada nativa no lugar de 10 getBlock.) Erro = "talvez". */
export function hasHopperOrComparatorNear(block: Block): boolean {
  const l = block.location;
  try {
    const volume = new BlockVolume({ x: l.x - 1, y: l.y - 1, z: l.z - 1 }, { x: l.x + 1, y: l.y + 1, z: l.z + 1 });
    return block.dimension.containsBlock(volume, { includeTypes: NEIGHBOR_TYPES }, true);
  }
  catch { return true; }
}

export const potTickStats = { visited: 0, neighborReads: 0, entityQueries: 0 };

export function tickDecoratedPot(key: string) {
  const { dimension, location } = parseBlockKey(key);
  let dim: Dimension;
  try { dim = world.getDimension(dimension); }
  catch { return; }
  const block = loadedBlock(dim, location);
  if (!block) return;
  const rec = potStore.get(key);
  if (!rec) { vanished.delete(key); return; }
  if (block.typeId !== DECORATED_POT) {
    // Bloco sumiu sem passar pelos eventos (/setblock ou /fill destroy, Wither...): como o destroyBlock do Java, cai
    // o vaso com as decorações e o conteúdo. (O Bedrock não diz se foi "destroy" ou "replace"; ver Desvios.)
    // Só na segunda visita seguida: a quebra por jogador/explosão chega por after-event e apaga o registro antes.
    if (!vanished.has(key)) { vanished.add(key); return; }
    vanished.delete(key);
    dropContents(dim, location);
    dropLoot(dim, location, rec.d, false);
    potStore.delete(key);
    missing.delete(key);
    return;
  }
  vanished.delete(key);
  potTickStats.visited++;
  // As entidades do chunk carregam alguns ticks depois dos blocos: só recria a entidade depois de faltar em
  // MISSING_LOOPS laços seguidos (senão nasce uma duplicata vazia ao lado da que guarda o item).
  const cachedBefore = displayIds.has(key);
  const found = displaysAt(dim, location);
  if (!cachedBefore || !displayIds.has(key)) potTickStats.entityQueries++;
  if (!found.length) {
    const n = (missing.get(key) ?? 0) + 1;
    missing.set(key, n);
    if (n < MISSING_LOOPS) return;
  }
  missing.delete(key);
  const kept = found.length > 1 ? mergeDisplays(dim, location, found) : found[0];
  const display = ensureDisplay(dim, location, rec, kept);
  if (!hasHopperOrComparatorNear(block)) {
    // Sem funil nem comparador: só zera o sinal que tenha ficado de um comparador tirado.
    applyComparatorStates(block, 0, 0);
    return;
  }
  const pot = containerOf(display);
  if (!pot) return;
  potTickStats.neighborReads++;
  for (const side of ["up", "north", "south", "west", "east"] as const) {
    const info = hopperInfo(neighborOf(block, side));
    if (info && touchedFace(info.facing) === side) pushIntoPotContainer(pot, info.container);
  }
  const below = hopperInfo(neighborOf(block, "down"));
  if (below) pullFromPotContainer(pot, below.container);
  const stored = pot.getItem(0);
  applyComparatorStates(block, containerSignal([stored ? { n: stored.amount, max: stored.maxAmount } : null], 1), comparatorMask(block));
}

export function tickAllDecoratedPots() {
  for (const key of potStore.keys()) {
    try { tickDecoratedPot(key); }
    catch (e) { console.warn(`[adaptacoes] vaso ${key}: ${e}`); }
  }
}

const buckets = new Map<string, number>();

/** Fatia fixa de cada vaso (hash da chave) no ciclo de POT_INTERVAL ticks. */
export function potBucket(key: string): number {
  let b = buckets.get(key);
  if (b === undefined) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    b = Math.abs(h) % POT_INTERVAL;
    buckets.set(key, b);
  }
  return b;
}

/** Os vasos da fatia deste tick. */
export function tickDecoratedPotSlice(tick: number) {
  const slot = tick % POT_INTERVAL;
  for (const key of potStore.keys()) {
    if (potBucket(key) !== slot) continue;
    try { tickDecoratedPot(key); }
    catch (e) { console.warn(`[adaptacoes] vaso ${key}: ${e}`); }
  }
}

// ---------------------------------------------------------------------------------------------
// Eventos

/**
 * O vaso atingido por um projétil de impacto, ou undefined. Frente cliente-teste3-log: o bloco atingido pode estar num
 * chunk carregado mas que não tica (projétil na borda da distância de simulação, encostado no chunk vizinho): ler
 * `typeId` lança LocationInUnloadedChunkError, sem catch no evento (3º teste em cliente: 54× em main.js:597, blocos
 * (-472, 70|71, 991), z = 991 é a última linha do chunk). Aí não há vaso a quebrar agora.
 */
export function potHitByProjectile(event: { getBlockHit(): { block: Block }; projectile?: { typeId?: string } }): Block | undefined {
  try {
    const block = event.getBlockHit().block;
    if (!block?.isValid || block.typeId !== DECORATED_POT) return undefined;
    return IMPACT_PROJECTILES.has(event.projectile?.typeId ?? "") ? block : undefined;
  }
  catch { return undefined; }
}

export function startDecoratedPots() {
  system.runInterval(() => tickDecoratedPotSlice(system.currentTick), 1);

  // Entidade de exibição carregada ou criada sem o vaso embaixo: solta o item e some (espera os blocos do chunk).
  const checkOrphan = (entity: Entity) => {
    system.runTimeout(() => {
      try { removeOrphanDisplay(entity); }
      catch (e) { console.warn(`[adaptacoes] vaso (entidade órfã): ${e}`); }
    }, 2);
  };
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    try { if (entity.typeId === DECORATED_POT_DISPLAY) checkOrphan(entity); }
    catch { /* saiu */ }
  });
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    try { if (entity.typeId === DECORATED_POT_DISPLAY) checkOrphan(entity); }
    catch { /* saiu */ }
  });

  world.afterEvents.playerBreakBlock.subscribe(({ player, block, brokenBlockPermutation, itemStackBeforeBreak }) => {
    if (brokenBlockPermutation.type.id !== DECORATED_POT) return;
    try { onPotBrokenByPlayer(isCreative(player), block.dimension, block.location, itemStackBeforeBreak); }
    catch (e) { console.warn(`[adaptacoes] vaso quebrado: ${e}`); }
  });

  world.afterEvents.blockExplode.subscribe(({ block, dimension, explodedBlockPermutation }) => {
    if (explodedBlockPermutation.type.id !== DECORATED_POT) return;
    try { onPotDestroyed(dimension, block.location, false); }
    catch (e) { console.warn(`[adaptacoes] vaso explodido: ${e}`); }
  });

  // DecoratedPotBlock.onProjectileHit: projétil de impacto (com mobGriefing) racha o vaso.
  world.afterEvents.projectileHitBlock.subscribe(event => {
    const block = potHitByProjectile(event);
    if (!block) return;
    if (!world.gameRules.mobGriefing) return;
    const { dimension, location } = { dimension: block.dimension, location: { ...block.location } };
    try {
      dimension.runCommand(`setblock ${location.x} ${location.y} ${location.z} air destroy`);
      onPotDestroyed(dimension, location, true);
    }
    catch (e) { console.warn(`[adaptacoes] vaso atingido: ${e}`); }
  });

  // Mesa de trabalho + sherd do Cobblemon na mão: tela do vaso (a grade do Bedrock não chama scripts).
  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    const { block, player, itemStack } = event;
    if (block.typeId !== "minecraft:crafting_table" || !isCobblemonSherd(itemStack?.typeId) || player.isSneaking) return;
    event.cancel = true;
    if (!event.isFirstEvent) return;
    const preferred = itemStack!.typeId;
    // Jogador que sai com a tela aberta rejeita o show(): isso é "fechou", não erro.
    system.run(() => { if (player.isValid) void openPotCrafting(player, preferred).catch(e => { if (player.isValid) console.warn(`[adaptacoes] tela do vaso: ${e}`); }); });
  });
}

