/**
 * Panela na fogueira (CampfireBlockEntity / CampfireBlock do Cobblemon 1.8.2): funil e comparador.
 *
 * O bloco custom não tem inventário, então os funis vanilla não o enxergam. A cada 8 ticks (o cooldown do funil
 * vanilla depois de mover um item) cada panela registrada e carregada:
 * - recebe 1 item de cada funil encostado que aponta para ela (cima e laterais), nos espaços certos
 *   (`potInsertSlots`: tempero pela face de cima vai para os temperos, o resto para a grade);
 * - entrega 1 item do resultado para o funil logo abaixo (qualquer direção; `canTakeItemThroughFace` = só resultado);
 * - atualiza o sinal do comparador (`getAnalogOutputSignal` = getRedstoneSignalFromContainer dos 13 espaços) nos
 *   estados `cobblemon:comparator` (0..15) e `cobblemon:comparator_faces` (máscara N=1, L=2, S=4, O=8 das faces com
 *   comparador encostado e com a entrada virada para o bloco). As permutações do bloco (tools/importer/adaptacoes.ts)
 *   ligam `minecraft:redstone_producer` com essa força só nessas faces. Na fogueira depende de CAMPFIRE_COMPARATOR
 *   (flags.ts) e de a fogueira não ter `minecraft:redstone_consumer` (a tampa lê os vizinhos em potRedstone.ts); o
 *   mesmo código serve o vaso decorado.
 * Funil com `toggle_bit` (energizado) fica travado, como no Java.
 */
import { Block, Container, Dimension, ItemStack, system, world } from "@minecraft/server";
import { cookingStore, CAMPFIRES, CookingPotState } from "../machines/cooking";
import { isSeasoning } from "../machines/cookingLogic";
import { isPlainStack, maxStackOf, sameStack, SlotItem, toItemStack, toSlotItem } from "../machines/itemUtil";
import { parseBlockKey } from "../machines/store";
import {
  COMPARATOR_FACE_BITS, comparatorStates, containerSignal, Face, FACE_OFFSET, FACING_DIRECTION, pickHopperPull, pickHopperPush, POT_SIZE,
  potExtractSlots, potInsertSlots, StackLike, touchedFace,
} from "./containerLogic";
import { CAMPFIRE_COMPARATOR } from "./flags";
import { replaceBlock } from "../comparadores/replace";

export const HOPPER_INTERVAL = 8;
export const COMPARATOR_STATE = "cobblemon:comparator";
export const COMPARATOR_FACES_STATE = "cobblemon:comparator_faces";
const COMPARATORS = new Set(["minecraft:unpowered_comparator", "minecraft:powered_comparator"]);

// ---------------------------------------------------------------------------------------------
// Conversões

/** Chave de igualdade de um SlotItem (lore e nome). */
export function slotKey(slot: SlotItem): string {
  return JSON.stringify([slot.lore ?? [], slot.name ?? ""]);
}

export function slotToStack(slot: SlotItem | null | undefined, max = slot ? maxStackOf(slot.id) : 64): StackLike | null {
  return slot ? { id: slot.id, n: slot.n, max, key: slotKey(slot) } : null;
}

/** Pilha do funil → StackLike (itens com dados que o SlotItem não guarda não empilham com nada). */
export function itemToStack(item: ItemStack | undefined, index: number): StackLike | null {
  if (!item) return null;
  const plain = isPlainStack(item);
  return { id: item.typeId, n: item.amount, max: item.maxAmount, key: plain ? slotKey(toSlotItem(item, 1)) : `unique:${index}` };
}

/** Os 13 espaços da panela na ordem do Java (0 resultado, 1..9 grade, 10..12 temperos). */
export function potSlots(state: CookingPotState): (SlotItem | null)[] {
  return [state.result, ...state.grid, ...state.seasonings];
}

export function setPotSlot(state: CookingPotState, index: number, value: SlotItem | null) {
  if (index === 0) state.result = value;
  else if (index <= 9) state.grid[index - 1] = value;
  else state.seasonings[index - 10] = value;
}

/** Sinal do comparador da panela. */
export function potSignal(state: CookingPotState, maxOf: (id: string) => number = maxStackOf): number {
  return containerSignal(potSlots(state).map(s => (s ? { n: s.n, max: maxOf(s.id) } : null)), POT_SIZE);
}

// ---------------------------------------------------------------------------------------------
// Funil

function neighborOf(block: Block, face: Face): Block | undefined {
  const o = FACE_OFFSET[face];
  try { return block.dimension.getBlock({ x: block.location.x + o.x, y: block.location.y + o.y, z: block.location.z + o.z }); }
  catch { return undefined; }
}

/** Funil destravado e o contêiner dele. */
export function hopperInfo(block: Block | undefined): { facing: Face; container: Container } | undefined {
  if (block?.typeId !== "minecraft:hopper") return undefined;
  try {
    if (block.permutation.getState("toggle_bit" as never) === true) return undefined;
    const facing = FACING_DIRECTION[Number(block.permutation.getState("facing_direction" as never) ?? 0)] ?? "down";
    const container = block.getComponent("minecraft:inventory")?.container;
    return container ? { facing, container } : undefined;
  }
  catch { return undefined; }
}

function readContainer(container: Container): (StackLike | null)[] {
  const out: (StackLike | null)[] = [];
  for (let i = 0; i < container.size; i++) out.push(itemToStack(container.getItem(i), i));
  return out;
}

/** Tira 1 item do espaço do funil. */
function takeOne(container: Container, slot: number): ItemStack | undefined {
  const item = container.getItem(slot);
  if (!item) return undefined;
  const one = item.clone();
  one.amount = 1;
  if (item.amount <= 1) container.setItem(slot, undefined);
  else { item.amount -= 1; container.setItem(slot, item); }
  return one;
}

/** Põe 1 item do SlotItem no espaço do funil. */
function putOne(container: Container, slot: number, from: SlotItem) {
  const current = container.getItem(slot);
  if (current) { current.amount += 1; container.setItem(slot, current); }
  else container.setItem(slot, toItemStack(from, 1));
}

/** Um funil empurrando para a panela pela face `face`. Devolve se moveu. */
export function pushIntoPot(state: CookingPotState, container: Container, face: Face): boolean {
  const slots = potSlots(state).map(s => slotToStack(s));
  const hopper = readContainer(container);
  const pick = pickHopperPush(hopper, slots, item => potInsertSlots(face, isSeasoning(item.id)), item => !item.key?.startsWith("unique:"));
  if (!pick) return false;
  const moved = takeOne(container, pick.from);
  if (!moved) return false;
  const incoming = toSlotItem(moved, 1);
  const current = potSlots(state)[pick.to];
  setPotSlot(state, pick.to, current && sameStack(current, incoming) ? { ...current, n: current.n + 1 } : incoming);
  return true;
}

/** O funil de baixo puxando o resultado. Devolve se moveu. */
export function pullFromPot(state: CookingPotState, container: Container): boolean {
  const slots = potSlots(state).map(s => slotToStack(s));
  const pick = pickHopperPull(slots, potExtractSlots(), readContainer(container));
  if (!pick) return false;
  const current = potSlots(state)[pick.from]!;
  putOne(container, pick.to, current);
  setPotSlot(state, pick.from, current.n > 1 ? { ...current, n: current.n - 1 } : null);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Comparador

/** Lado oposto (faces horizontais). */
const OPPOSITE_H: Record<"north" | "east" | "south" | "west", string> = { north: "south", south: "north", east: "west", west: "east" };

/**
 * O comparador encostado na face `face` lê este bloco? No Java o comparador lê o bloco atrás dele (a entrada); um
 * comparador de lado recebe o bloco como entrada lateral, e lá o getSignal da panela/vaso é 0. No Bedrock
 * `minecraft:cardinal_direction` do comparador é o lado da entrada (medido no BDS), então lê quando aponta de volta.
 */
export function comparatorReads(comparator: { typeId: string; cardinal?: unknown }, face: "north" | "east" | "south" | "west"): boolean {
  return COMPARATORS.has(comparator.typeId) && comparator.cardinal === OPPOSITE_H[face];
}

/** Máscara das faces horizontais com comparador encostado lendo este bloco. */
export function comparatorMask(block: Block): number {
  let mask = 0;
  for (const face of ["north", "east", "south", "west"] as const) {
    const n = neighborOf(block, face);
    if (!n || !COMPARATORS.has(n.typeId)) continue;
    let cardinal: unknown;
    try { cardinal = n.permutation.getState("minecraft:cardinal_direction" as never); }
    catch { cardinal = undefined; }
    if (comparatorReads({ typeId: n.typeId, cardinal }, face)) mask |= COMPARATOR_FACE_BITS[face];
  }
  return mask;
}

/**
 * Grava os estados do comparador se mudaram (blocos sem os estados são ignorados). Quando as faces mudam o bloco é
 * recolocado no mesmo tick (replaceBlock): trocar `connected_faces` por permutação não religa o circuito (medido no BDS
 * na panela e no vaso: comparador norte → oeste, o de oeste ficou em 0). A recolocação mantém a água, a entidade e o
 * item do vaso e, na fogueira, o registro da panela (o onBreak consulta replacedInPlace).
 */
export function applyComparatorStates(block: Block, signal: number, mask: number): boolean {
  const want = comparatorStates(signal, mask);
  try {
    const perm = block.permutation;
    const power = perm.getState(COMPARATOR_STATE as never);
    const faces = perm.getState(COMPARATOR_FACES_STATE as never);
    if (power === undefined || faces === undefined) return false;
    if (power === want.power && faces === want.mask) return false;
    const next = perm.withState(COMPARATOR_STATE as never, want.power as never).withState(COMPARATOR_FACES_STATE as never, want.mask as never);
    if (faces !== want.mask) replaceBlock(block, next);
    else block.setPermutation(next);
    return true;
  }
  catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Laço

function loaded(dimension: Dimension, location: { x: number; y: number; z: number }): Block | undefined {
  try { return dimension.isChunkLoaded(location) ? dimension.getBlock(location) : undefined; }
  catch { return undefined; }
}

/** Uma panela: funis e comparador. Devolve quantos itens moveu (para a sonda). */
export function tickPot(key: string): number {
  const { dimension, location } = parseBlockKey(key);
  let dim: Dimension;
  try { dim = world.getDimension(dimension); }
  catch { return 0; }
  const block = loaded(dim, location);
  if (!block || !CAMPFIRES.includes(block.typeId)) return 0;
  const pushers: { face: Face; container: Container }[] = [];
  for (const side of ["up", "north", "south", "west", "east"] as const) {
    const info = hopperInfo(neighborOf(block, side));
    // O funil precisa apontar para a panela: a face tocada é o lado onde ele está.
    if (info && touchedFace(info.facing) === side) pushers.push({ face: side, container: info.container });
  }
  const below = hopperInfo(neighborOf(block, "down"));
  const mask = CAMPFIRE_COMPARATOR ? comparatorMask(block) : 0;
  const hasComparatorState = block.permutation.getState(COMPARATOR_STATE as never) !== undefined;
  const currentPower = hasComparatorState ? Number(block.permutation.getState(COMPARATOR_STATE as never)) : 0;
  if (!pushers.length && !below && mask === 0 && currentPower === 0) return 0;
  const state = cookingStore.get(key);
  if (!state) return 0;
  let moved = 0;
  for (const p of pushers) if (pushIntoPot(state, p.container, p.face)) moved++;
  if (below && pullFromPot(state, below.container)) moved++;
  if (moved) cookingStore.set(key, state);
  if (CAMPFIRE_COMPARATOR) applyComparatorStates(block, potSignal(state), mask);
  return moved;
}

export function tickAllPots() {
  for (const key of cookingStore.keys()) {
    try { tickPot(key); }
    catch (e) { console.warn(`[adaptacoes] panela ${key}: ${e}`); }
  }
}

export function startPotHoppers() {
  system.runInterval(tickAllPots, HOPPER_INTERVAL);
}
