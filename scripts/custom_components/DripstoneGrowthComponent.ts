import { Block, BlockComponentRandomTickEvent, BlockCustomComponent, BlockPermutation } from "@minecraft/server";

/**
 * Espeleotema crescendo sob o minério de pedra da lua do espeleotema (PointedDripstoneBlockMixin + tag
 * `dripstone_growable` do Cobblemon 1.8.2): o minério conta como bloco de espeleotema na regra do
 * PointedDripstoneBlock.growStalactiteOrStalagmiteIfPossible — com água parada em cima e uma estalactite presa em
 * baixo, cada random tick tem 0,011377778 de chance de alongar a estalactite (até 7) ou, se ela não pode crescer,
 * de fazer crescer a estalagmite embaixo (até 10 blocos de distância). O Bedrock só faz isso sob o bloco de
 * espeleotema vanilla, por isso o crescimento sai daqui.
 */
export const GROWTH_CHANCE = 0.011377778;
export const MAX_GROWTH_LENGTH = 7;
export const MAX_STALAGMITE_SEARCH = 10;

const POINTED = "minecraft:pointed_dripstone";

function isPointed(block: Block | undefined, hanging: boolean): boolean {
  return !!block && block.typeId === POINTED && block.permutation.getState("hanging" as never) === hanging;
}

function isWaterSource(block: Block | undefined): boolean {
  if (!block || block.typeId !== "minecraft:water") return false;
  try { return block.permutation.getState("liquid_depth" as never) === 0; }
  catch { return true; }
}

function pointed(hanging: boolean, thickness: string): BlockPermutation {
  return BlockPermutation.resolve(POINTED, { hanging, dripstone_thickness: thickness } as never);
}

/**
 * Espessuras de uma coluna (do bloco preso até a ponta), como PointedDripstoneBlock.calculateDripstoneThickness:
 * ponta = tip, logo antes da ponta = frustum, o primeiro (preso) = base, o resto = middle.
 */
export function columnThickness(length: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    if (i === length - 1) out.push("tip");
    else if (i === length - 2) out.push("frustum");
    else if (i === 0) out.push("base");
    else out.push("middle");
  }
  return out;
}

function step(block: Block, hanging: boolean): Block | undefined {
  return hanging ? block.below() : block.above();
}

/** Blocos da coluna a partir do preso (inclusive) na direção da ponta. */
function column(start: Block, hanging: boolean): Block[] {
  const out: Block[] = [];
  let cur: Block | undefined = start;
  while (cur && isPointed(cur, hanging) && out.length <= MAX_GROWTH_LENGTH) {
    out.push(cur);
    cur = step(cur, hanging);
  }
  return out;
}

function grow(col: Block[], hanging: boolean): boolean {
  const tip = col[col.length - 1];
  const next = step(tip, hanging);
  if (!next?.isAir || col.length >= MAX_GROWTH_LENGTH) return false;
  const thick = columnThickness(col.length + 1);
  next.setPermutation(pointed(hanging, thick[thick.length - 1]));
  col.forEach((b, i) => b.setPermutation(pointed(hanging, thick[i])));
  return true;
}

/** maybeGrowStalagmiteBelow: acha o chão embaixo da ponta e cresce/planta a estalagmite. */
function growStalagmiteBelow(tip: Block) {
  let cur: Block | undefined = tip.below();
  for (let i = 0; i < MAX_STALAGMITE_SEARCH && cur; i++) {
    if (!cur.isAir) break;
    cur = cur.below();
  }
  if (!cur || cur.isAir) return;
  if (isPointed(cur, false)) {
    // Sobe até a raiz da estalagmite e cresce a coluna para cima.
    let root = cur;
    while (isPointed(root.below(), false)) root = root.below()!;
    grow(column(root, false), false);
    return;
  }
  const above = cur.above();
  if (above?.isAir && !cur.isLiquid) above.setPermutation(pointed(false, "tip"));
}

export default class DripstoneGrowthComponent implements BlockCustomComponent {
  constructor(private chance = GROWTH_CHANCE, private random: () => number = Math.random) { }

  onRandomTick(arg: BlockComponentRandomTickEvent) {
    if (this.random() >= this.chance) return;
    const ore = arg.block;
    if (!isWaterSource(ore.above())) return;
    const start = ore.below();
    if (!start || !isPointed(start, true)) return;
    const col = column(start, true);
    if (!col.length) return;
    const tip = col[col.length - 1];
    if (tip.permutation.getState("dripstone_thickness" as never) !== "tip") return;
    if (!grow(col, true)) growStalagmiteBelow(tip);
  }
}
