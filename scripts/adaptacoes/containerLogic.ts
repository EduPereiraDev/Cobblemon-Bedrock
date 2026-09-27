/**
 * Regras puras de contêiner do Java usadas pelas adaptações (funil e comparador), sem API do Minecraft.
 *
 * - HopperBlockEntity.addItem/tryMoveInItem: o funil move 1 item por vez; num WorldlyContainer percorre
 *   `getSlotsForFace(face)` em ordem e põe no primeiro espaço vazio OU com a mesma pilha abaixo do máximo.
 * - AbstractContainerMenu.getRedstoneSignalFromContainer: soma de (quantidade / máximo da pilha) de cada espaço,
 *   dividida pelo tamanho do contêiner, e `Mth.lerpDiscrete(f, 0, 15)` = floor(f × 14) + (f > 0 ? 1 : 0).
 * - CampfireBlockEntity (panela): 13 espaços — 0 = resultado, 1..9 = grade, 10..12 = temperos;
 *   `canPlaceItemThroughFace`: pela face de CIMA um tempero só entra nos temperos; qualquer outro caso só entra na
 *   grade; `canTakeItemThroughFace`: só o resultado sai.
 */

/** Face do bloco (Direction do Java, em minúsculas). */
export type Face = "down" | "up" | "north" | "south" | "west" | "east";

/** `facing_direction` do funil/dispenser do Bedrock (0 baixo, 1 cima, 2 norte, 3 sul, 4 oeste, 5 leste). */
export const FACING_DIRECTION: readonly Face[] = ["down", "up", "north", "south", "west", "east"];

export const FACE_OFFSET: Record<Face, { x: number; y: number; z: number }> = {
  down: { x: 0, y: -1, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
};

export const OPPOSITE_FACE: Record<Face, Face> = { down: "up", up: "down", north: "south", south: "north", west: "east", east: "west" };

/** Pilha mínima para as regras (id + quantidade + chave de igualdade dos componentes). */
export interface StackLike {
  id: string;
  n: number;
  /** Máximo da pilha do item (ItemStack.getMaxStackSize). */
  max: number;
  /** Igualdade de componentes (lore, nome...): duas pilhas empilham se id e chave forem iguais. */
  key?: string;
}

/** ItemStack.isSameItemSameComponents. */
export function sameItem(a: StackLike | null | undefined, b: StackLike | null | undefined): boolean {
  return !!a && !!b && a.id === b.id && (a.key ?? "") === (b.key ?? "");
}

/**
 * Primeiro espaço (na ordem de `candidates`) que aceita 1 item de `incoming`: vazio ou mesma pilha abaixo do máximo
 * (HopperBlockEntity.tryMoveInItem). -1 = não coube.
 */
export function firstAcceptingSlot(slots: readonly (StackLike | null)[], candidates: readonly number[], incoming: StackLike): number {
  for (const i of candidates) {
    const current = slots[i];
    if (!current) return i;
    if (sameItem(current, incoming) && current.n < Math.min(current.max, incoming.max)) return i;
  }
  return -1;
}

/** Mth.lerpDiscrete(f, 0, 15) do sinal do comparador. */
export function signalFromFraction(fraction: number): number {
  if (fraction <= 0) return 0;
  return Math.min(15, Math.floor(fraction * 14) + 1);
}

/** getRedstoneSignalFromContainer: `size` espaços (os vazios contam no divisor). */
export function containerSignal(slots: readonly ({ n: number; max: number } | null)[], size = slots.length): number {
  if (size <= 0) return 0;
  let f = 0;
  for (const s of slots) if (s && s.n > 0) f += s.n / Math.max(1, s.max);
  return signalFromFraction(f / size);
}

// ---------------------------------------------------------------------------------------------
// Panela (CampfireBlockEntity)

export const POT_RESULT_SLOT = 0;
export const POT_GRID_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const POT_SEASONING_SLOTS = [10, 11, 12] as const;
export const POT_SIZE = 13;

/**
 * Espaços da panela onde um funil pode pôr um item pela face `face` (getSlotsForFace = 0..12, na ordem, filtrado por
 * canPlaceItemThroughFace).
 */
export function potInsertSlots(face: Face, isSeasoning: boolean): number[] {
  if (face === "up" && isSeasoning) return [...POT_SEASONING_SLOTS];
  return [...POT_GRID_SLOTS];
}

/** Espaços de onde um funil (embaixo) pode tirar: só o resultado. */
export function potExtractSlots(): number[] {
  return [POT_RESULT_SLOT];
}

// ---------------------------------------------------------------------------------------------
// Funil

/** Face do alvo tocada pelo funil que aponta para ele (a direção do funil, invertida). */
export function touchedFace(hopperFacing: Face): Face {
  return OPPOSITE_FACE[hopperFacing];
}

/**
 * Ordem em que o funil tenta os próprios espaços ao empurrar (HopperBlockEntity.ejectItems: do 0 ao 4, o primeiro que
 * conseguir entrar no alvo). Devolve o índice do espaço do funil e o espaço do alvo, ou undefined.
 */
export function pickHopperPush(
  hopper: readonly (StackLike | null)[],
  target: readonly (StackLike | null)[],
  candidatesFor: (item: StackLike) => readonly number[],
  accepts: (item: StackLike) => boolean = () => true,
): { from: number; to: number } | undefined {
  for (let from = 0; from < hopper.length; from++) {
    const item = hopper[from];
    if (!item || item.n <= 0 || !accepts(item)) continue;
    const to = firstAcceptingSlot(target, candidatesFor(item), item);
    if (to >= 0) return { from, to };
  }
  return undefined;
}

/**
 * Funil embaixo puxando (HopperBlockEntity.suckInItems): para cada espaço extraível do alvo com item, tenta pôr 1 no
 * funil (primeiro espaço vazio ou com a mesma pilha). Devolve o espaço do alvo e o do funil.
 */
export function pickHopperPull(
  target: readonly (StackLike | null)[],
  extractable: readonly number[],
  hopper: readonly (StackLike | null)[],
): { from: number; to: number } | undefined {
  for (const from of extractable) {
    const item = target[from];
    if (!item || item.n <= 0) continue;
    const to = firstAcceptingSlot(hopper, hopper.map((_, i) => i), item);
    if (to >= 0) return { from, to };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Comparador (estados do bloco)

/** Bits das faces horizontais no estado `cobblemon:comparator_faces`. */
export const COMPARATOR_FACE_BITS: Record<"north" | "east" | "south" | "west", number> = { north: 1, east: 2, south: 4, west: 8 };

/** Máscara → faces ligadas (para `connected_faces` do minecraft:redstone_producer). */
export function facesOfMask(mask: number): ("north" | "east" | "south" | "west")[] {
  return (Object.keys(COMPARATOR_FACE_BITS) as ("north" | "east" | "south" | "west")[]).filter(f => (mask & COMPARATOR_FACE_BITS[f]) !== 0);
}

/**
 * Estados de saída: sinal e faces com comparador encostado. Sem comparador (máscara 0) ou sem sinal, os dois vão a 0,
 * e o bloco não emite nada (o Java só entrega o sinal analógico a comparadores).
 */
export function comparatorStates(signal: number, mask: number): { power: number; mask: number } {
  if (signal <= 0 || mask <= 0) return { power: 0, mask: 0 };
  return { power: Math.min(15, signal), mask: mask & 15 };
}
