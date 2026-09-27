/**
 * Dispenser nos blocos do Cobblemon 1.8.2:
 * - Tesoura (ShearsDispenserBehaviorMixin → ShearableBlock.attemptShear): berry madura (idade 5) é colhida, apricorn
 *   maduro (idade 3) é colhido, big root vira hanging roots + linha e energy root vira big root + energy root. Deu
 *   certo → a tesoura perde 1 de durabilidade (Inquebrável reduz a chance).
 * - Garrafa de mel (DispenserBehaviorRegistry): tora de saccharine → tora com mel (FACING norte, honey_type 0);
 *   folha de saccharine com idade < 2 → idade + 2 (máx. 2). A garrafa vai para o dispenser como garrafa vazia.
 * - Poção (o Java registra pelo Item.POTION, então qualquer poção bebível): tora com mel → tora comum; folha com
 *   idade > 0 → idade − 2 (mín. 0). Também devolve a garrafa vazia.
 * Sem efeito o dispenser segue com o comportamento vanilla (mel/poção saem como item; tesoura não faz nada).
 *
 * Como o Bedrock faz: medido no BDS, o dispenser liga `triggered_bit` 1 tick depois do sinal e dispara 4 ticks depois
 * (como o scheduleTick(4) do Java). Mel e poção são ejetados como item (`entitySpawn` com causa Spawned dentro da
 * célula do dispenser): o item é removido e o comportamento do Java é aplicado, com o sorteio de espaço do próprio
 * Bedrock. A tesoura não ejeta nada, então os dispensers virados para blocos do Cobblemon ficam registrados e o
 * `triggered_bit` é lido a cada tick; na subida, sorteia-se um espaço como o Java (getRandomSlot) e, se for a tesoura,
 * a tosquia acontece 4 ticks depois. Se o Bedrock ejetar outro item nesse disparo, ele volta para o dispenser.
 * Registro: dispenser posto/aberto por jogador, bloco do Cobblemon posto/usado ao lado de um dispenser, ou disparo de
 * mel/poção detectado.
 */
import { Block, BlockPermutation, Container, Dimension, Entity, ItemStack, system, Vector3, world } from "@minecraft/server";
import { blockKey, MachineStore, parseBlockKey } from "../machines/store";
import { FRUIT_AGE, harvest, isBerryBush, loadBush, saveBush } from "../custom_components/plants/berry";
import { SHEAR_RESULT } from "../custom_components/plants/roots";
import { dropItems } from "../custom_components/plants/common";
import { Face, FACE_OFFSET, FACING_DIRECTION, OPPOSITE_FACE } from "./containerLogic";

export const DISPENSER = "minecraft:dispenser";
/** Atraso do disparo (DispenserBlock.scheduleTick(4)). */
export const DISPENSE_DELAY = 4;
/** Janela em que um item ejetado pelo Bedrock volta para o dispenser (a tosquia já gastou o disparo). */
const CATCH_TICKS = 8;

const APRICORN = /^cobblemon:(red|yellow|green|blue|pink|black|white)_apricorn_block(_generated)?$/;
const APRICORN_MAX_AGE = 3;
export const SACCHARINE_LOG = "cobblemon:saccharine_log";
export const SACCHARINE_LOG_SLATHERED = "cobblemon:saccharine_log_slathered";
export const SACCHARINE_LEAVES = "cobblemon:saccharine_leaves";
const LEAF_MAX_AGE = 2;

export const dispenserStore = new MachineStore<number>("adapt_dispenser");
const lastTriggered = new Map<string, boolean>();
/** Disparos de tesoura: até quando devolver o item que o Bedrock ejetar e o conteúdo no disparo. */
const catchWindows = new Map<string, { until: number; before: Map<string, number> }>();

/** rng trocável nos testes. */
export const dispenserRng = { next: (): number => Math.random() };

// ---------------------------------------------------------------------------------------------
// Regras puras

export type ShearKind = "berry" | "apricorn" | "root";

/** O bloco é tosquiável no Java (ShearableBlock)? */
export function shearKind(typeId: string): ShearKind | undefined {
  if (isBerryBush(typeId)) return "berry";
  if (APRICORN.test(typeId)) return "apricorn";
  if (SHEAR_RESULT[typeId]) return "root";
  return undefined;
}

/** Bloco que um dispenser pode afetar (vale registrar o dispenser virado para ele). */
export function isDispenserTarget(typeId: string): boolean {
  return !!shearKind(typeId) || typeId === SACCHARINE_LOG || typeId === SACCHARINE_LOG_SLATHERED || typeId === SACCHARINE_LEAVES;
}

/** DispenserBlockEntity.getRandomSlot: sorteio uniforme entre os espaços com item (−1 = vazio). */
export function randomSlot(filled: readonly boolean[], rnd: () => number = dispenserRng.next): number {
  let chosen = -1;
  let seen = 1;
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i]) continue;
    if (Math.floor(rnd() * seen++) === 0) chosen = i;
  }
  return chosen;
}

export type SaccharineChange =
  | { kind: "slather" }
  | { kind: "wash" }
  | { kind: "leaf"; age: number };

/**
 * Efeito de mel (`honey`) ou poção (`potion`) no bloco da frente (SaccharineLogBlock / SaccharineLogSlatheredBlock /
 * SaccharineLeafBlock.createBehavior). `vertical` = tora em pé (a tora com mel do port só existe em pé).
 */
export function saccharineChange(item: "honey" | "potion", typeId: string, age: number, vertical: boolean): SaccharineChange | undefined {
  if (item === "honey" && typeId === SACCHARINE_LOG && vertical) return { kind: "slather" };
  if (item === "potion" && typeId === SACCHARINE_LOG_SLATHERED) return { kind: "wash" };
  if (typeId !== SACCHARINE_LEAVES) return undefined;
  if (item === "honey" && age < LEAF_MAX_AGE) return { kind: "leaf", age: Math.min(LEAF_MAX_AGE, age + 2) };
  if (item === "potion" && age > 0) return { kind: "leaf", age: Math.max(0, age - 2) };
  return undefined;
}

/**
 * Onde a garrafa vazia entra (changeLogTypeDispenser): primeiro espaço vazio ou com garrafa vazia abaixo de 16, na
 * ordem; −1 = cai no chão.
 */
export function bottleSlot(slots: readonly ({ id: string; n: number } | null)[]): number {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s) return i;
    if (s.id === "minecraft:glass_bottle" && s.n < 16) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Mundo

function facingOf(dispenser: Block): Face {
  try { return FACING_DIRECTION[Number(dispenser.permutation.getState("facing_direction" as never) ?? 0)] ?? "down"; }
  catch { return "down"; }
}

function offsetBlock(block: Block, face: Face): Block | undefined {
  const o = FACE_OFFSET[face];
  try { return block.dimension.getBlock({ x: block.location.x + o.x, y: block.location.y + o.y, z: block.location.z + o.z }); }
  catch { return undefined; }
}

export function frontOf(dispenser: Block): Block | undefined {
  return offsetBlock(dispenser, facingOf(dispenser));
}

function containerOf(block: Block): Container | undefined {
  try { return block.getComponent("minecraft:inventory")?.container; }
  catch { return undefined; }
}

function playAt(dimension: Dimension, sound: string, location: Vector3) {
  try { dimension.playSound(sound, { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }); }
  catch { /* som é cosmético */ }
}

/** Registra o dispenser se ele estiver virado para um bloco do Cobblemon. */
export function registerIfRelevant(dispenser: Block | undefined): boolean {
  if (dispenser?.typeId !== DISPENSER) return false;
  const front = frontOf(dispenser);
  if (!front || !isDispenserTarget(front.typeId)) return false;
  const key = blockKey(dispenser.dimension.id, dispenser.location);
  if (!dispenserStore.has(key)) dispenserStore.set(key, 1);
  return true;
}

/** Dispensers encostados que apontam para o bloco. */
function dispensersFacing(block: Block): Block[] {
  const out: Block[] = [];
  for (const face of Object.keys(FACE_OFFSET) as Face[]) {
    const other = offsetBlock(block, face);
    if (other?.typeId === DISPENSER && facingOf(other) === OPPOSITE_FACE[face]) out.push(other);
  }
  return out;
}

/** Depois de pôr/usar um bloco: registra os dispensers envolvidos. */
export function scanAround(block: Block) {
  if (block.typeId === DISPENSER) { registerIfRelevant(block); return; }
  if (isDispenserTarget(block.typeId)) { for (const d of dispensersFacing(block)) registerIfRelevant(d); return; }
  // Semente de apricorn na folha: o apricorn nasce num vizinho da folha.
  if (block.typeId === "cobblemon:apricorn_leaves") {
    for (const face of Object.keys(FACE_OFFSET) as Face[]) {
      const n = offsetBlock(block, face);
      if (n && isDispenserTarget(n.typeId)) for (const d of dispensersFacing(n)) registerIfRelevant(d);
    }
  }
}

// Tosquia ----------------------------------------------------------------------------------------

/** ShearableBlock.attemptShear no bloco (true = tosquiou). */
export function attemptShear(block: Block): boolean {
  const kind = shearKind(block.typeId);
  if (kind === "berry") {
    const ctx = loadBush(block);
    if (!ctx || ctx.age !== FRUIT_AGE) return false;
    const counts = harvest(ctx);
    saveBush(block, ctx);
    for (const [id, n] of counts) dropItems(block.dimension, block.location, id, n);
    // BerryBlock.harvestBerry sem jogador: som de tosquia.
    playAt(block.dimension, "mob.sheep.shear", block.location);
    return true;
  }
  if (kind === "apricorn") {
    const color = APRICORN.exec(block.typeId)![1];
    if (block.permutation.getState("cobblemon:growth_state" as never) !== APRICORN_MAX_AGE) return false;
    playAt(block.dimension, "mob.sheep.shear", block.location);
    // ApricornBlock.harvest: loot do apricorn e idade 0 mantendo a direção.
    block.setPermutation(block.permutation.withState("cobblemon:growth_state" as never, 0 as never));
    const { x, y, z } = block.location;
    block.dimension.runCommand(`loot spawn ${x + 0.5} ${y + 0.5} ${z + 0.5} loot "blocks/apricorns/${color}_apricorn"`);
    return true;
  }
  if (kind === "root") {
    const result = SHEAR_RESULT[block.typeId];
    playAt(block.dimension, "mob.sheep.shear", block.location);
    const loc = { ...block.location };
    const dim = block.dimension;
    block.setType(result.becomes);
    dropItems(dim, loc, result.drop, 1);
    return true;
  }
  return false;
}

/** hurtAndBreak(1) sem jogador: Inquebrável reduz a chance; quebrou → some. */
export function damageShears(container: Container, slot: number) {
  const item = container.getItem(slot);
  const durability = item?.getComponent("minecraft:durability");
  if (!item || !durability) return;
  let unbreaking = 0;
  try { unbreaking = item.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0; }
  catch { unbreaking = 0; }
  if (dispenserRng.next() > durability.getDamageChance(unbreaking)) return;
  if (durability.damage + 1 >= durability.maxDurability) { container.setItem(slot, undefined); return; }
  durability.damage += 1;
  container.setItem(slot, item);
}

/** Subida do triggered_bit num dispenser registrado. */
export function onDispenserTriggered(dispenser: Block) {
  const front = frontOf(dispenser);
  if (!front || !shearKind(front.typeId)) return;
  const container = containerOf(dispenser);
  if (!container) return;
  const filled: boolean[] = [];
  for (let i = 0; i < container.size; i++) filled.push(!!container.getItem(i));
  const slot = randomSlot(filled);
  if (slot < 0 || container.getItem(slot)?.typeId !== "minecraft:shears") return;
  const key = blockKey(dispenser.dimension.id, dispenser.location);
  // O disparo é da tesoura: se o Bedrock ejetar outro item agora, ele volta.
  catchWindows.set(key, { until: system.currentTick + CATCH_TICKS, before: contentCounts(container) });
  const dim = dispenser.dimension;
  const loc = { ...dispenser.location };
  system.runTimeout(() => {
    try {
      const d = dim.getBlock(loc);
      if (d?.typeId !== DISPENSER) return;
      const f = frontOf(d);
      const c = containerOf(d);
      if (!f || !c || c.getItem(slot)?.typeId !== "minecraft:shears") return;
      if (attemptShear(f)) damageShears(c, slot);
    }
    catch (e) { console.warn(`[adaptacoes] dispenser: ${e}`); }
  }, DISPENSE_DELAY);
}

export function pollDispensers() {
  const now = system.currentTick;
  for (const [key, w] of catchWindows) if (w.until < now) catchWindows.delete(key);
  for (const key of dispenserStore.keys()) {
    const { dimension, location } = parseBlockKey(key);
    let dim: Dimension;
    try { dim = world.getDimension(dimension); }
    catch { continue; }
    let block: Block | undefined;
    try { block = dim.isChunkLoaded(location) ? dim.getBlock(location) : undefined; }
    catch { block = undefined; }
    if (!block) { lastTriggered.delete(key); continue; }
    if (block.typeId !== DISPENSER) { dispenserStore.delete(key); lastTriggered.delete(key); continue; }
    const triggered = block.permutation.getState("triggered_bit" as never) === true;
    const before = lastTriggered.get(key);
    lastTriggered.set(key, triggered);
    if (triggered && before === false) {
      try { onDispenserTriggered(block); }
      catch (e) { console.warn(`[adaptacoes] dispenser ${key}: ${e}`); }
    }
  }
}

// Mel e poção -----------------------------------------------------------------------------------

function isVertical(block: Block): boolean {
  const f = block.permutation.getState("minecraft:facing_direction" as never);
  return f === "up" || f === "down" || f === undefined;
}

/**
 * O item nasceu na boca do dispenser? Medido no BDS: o item ejetado aparece entre 0,4 e 1,0 bloco à frente do
 * centro (mel a ~0,6, terra a ~0,95). Os drops da colheita também caem ali perto, por isso a devolução confere ainda
 * o tipo e a contagem do conteúdo (ver onItemSpawned).
 */
export const EJECT_RADIUS = 1.5;

export function isEjectPosition(item: Vector3, dispenser: Vector3, facing: Face): boolean {
  const dx = item.x - (dispenser.x + 0.5);
  const dy = item.y - (dispenser.y + 0.5);
  const dz = item.z - (dispenser.z + 0.5);
  const o = FACE_OFFSET[facing];
  return Math.hypot(dx, dy, dz) < EJECT_RADIUS && dx * o.x + dy * o.y + dz * o.z > 0.2;
}

/** Dispenser de onde o item saiu (ele fica dentro da célula do dispenser ou na da frente). */
function sourceDispenser(item: Entity): Block | undefined {
  const l = item.location;
  const cell = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
  let here: Block | undefined;
  try { here = item.dimension.getBlock(cell); }
  catch { return undefined; }
  if (!here) return undefined;
  const candidates = here.typeId === DISPENSER ? [here, ...dispensersFacing(here)] : dispensersFacing(here);
  return candidates.find(d => isEjectPosition(l, d.location, facingOf(d)));
}

/** Contagem por tipo do conteúdo (sem a tesoura). */
function contentCounts(container: Container | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!container) return out;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && it.typeId !== "minecraft:shears") out.set(it.typeId, (out.get(it.typeId) ?? 0) + it.amount);
  }
  return out;
}

function giveBottle(dispenser: Block) {
  const container = containerOf(dispenser);
  const slots: ({ id: string; n: number } | null)[] = [];
  if (container) for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    slots.push(it ? { id: it.typeId, n: it.amount } : null);
  }
  const slot = container ? bottleSlot(slots) : -1;
  if (container && slot >= 0) {
    const current = container.getItem(slot);
    if (current) { current.amount += 1; container.setItem(slot, current); }
    else container.setItem(slot, new ItemStack("minecraft:glass_bottle", 1));
    return;
  }
  const l = dispenser.location;
  try { dispenser.dimension.spawnItem(new ItemStack("minecraft:glass_bottle", 1), { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 }); }
  catch { /* sem lugar */ }
}

function applySaccharine(front: Block, change: SaccharineChange) {
  if (change.kind === "slather") {
    front.setPermutation(BlockPermutation.resolve(SACCHARINE_LOG_SLATHERED)
      .withState("minecraft:cardinal_direction" as never, "north" as never)
      .withState("cobblemon:honey_type" as never, 0 as never));
  }
  else if (change.kind === "wash") {
    front.setPermutation(BlockPermutation.resolve(SACCHARINE_LOG).withState("minecraft:facing_direction" as never, "up" as never));
  }
  else front.setPermutation(front.permutation.withState("cobblemon:age" as never, change.age as never));
}

/** Item ejetado por um dispenser: devolve (disparo de tesoura) ou aplica mel/poção. */
export function onItemSpawned(item: Entity) {
  const stack = item.getComponent("minecraft:item")?.itemStack;
  if (!stack) return;
  // Barato para os itens comuns: só mel/poção, ou qualquer item durante um disparo de tesoura.
  if (!catchWindows.size && stack.typeId !== "minecraft:honey_bottle" && stack.typeId !== "minecraft:potion") return;
  const dispenser = sourceDispenser(item);
  if (!dispenser || dispenser.permutation.getState("triggered_bit" as never) !== true) return;
  const key = blockKey(dispenser.dimension.id, dispenser.location);
  const w = catchWindows.get(key);
  if (w && w.until >= system.currentTick) {
    // Só o que saiu do dispenser: o tipo estava lá no disparo e a contagem baixou (os frutos colhidos não batem).
    const container = containerOf(dispenser);
    const had = w.before.get(stack.typeId) ?? 0;
    const now = contentCounts(container).get(stack.typeId) ?? 0;
    if (container && had > 0 && now + stack.amount <= had) {
      const left = container.addItem(stack);
      if (!left) { item.remove(); return; }
    }
  }
  const kind = stack.typeId === "minecraft:honey_bottle" ? "honey" : stack.typeId === "minecraft:potion" ? "potion" : undefined;
  if (!kind) return;
  const front = frontOf(dispenser);
  if (!front) return;
  const age = Number(front.permutation.getState("cobblemon:age" as never) ?? 0);
  const change = saccharineChange(kind, front.typeId, age, isVertical(front));
  registerIfRelevant(dispenser);
  if (!change) return;
  item.remove();
  applySaccharine(front, change);
  // A pilha ejetada (1 item) é a que o Java encolhe; a garrafa vazia volta para o dispenser.
  giveBottle(dispenser);
}

export function startDispensers() {
  system.runInterval(pollDispensers, 1);
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (cause !== "Spawned" || !entity.isValid || entity.typeId !== "minecraft:item") return;
    try { onItemSpawned(entity); }
    catch (e) { console.warn(`[adaptacoes] item do dispenser: ${e}`); }
  });
  world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    try { scanAround(block); }
    catch { /* bloco saiu */ }
  });
  world.afterEvents.playerInteractWithBlock.subscribe(({ block }) => {
    const t = block.typeId;
    if (t !== DISPENSER && t !== "cobblemon:apricorn_leaves" && !isDispenserTarget(t)) return;
    system.run(() => {
      try { if (block.isValid) scanAround(block); }
      catch { /* bloco saiu */ }
    });
  });
}
