/**
 * Fortuna nos blocos do Cobblemon (função `apply_bonus` das loot tables: minérios de pedra evolutiva, blocos de gema,
 * cachos de tumblestone, medicinal leek...). O loot do Bedrock não tem apply_bonus: a loot table dá a quantidade
 * base e aqui soltamos só o extra, com as fórmulas do ApplyBonusCount do Minecraft Java:
 *   ore_drops                  n × (max(0, rand(nível + 2) − 1) + 1)
 *   uniform_bonus_count        n + rand(multiplicador × nível + 1)
 *   binomial_with_bonus_count  n + Binomial(nível + extra, p)
 * e o `limit_count` que vem depois. Com Toque Suave não há bônus (o bloco cai inteiro).
 */
import { BlockPermutation, ItemStack, system, Vector3, world } from "@minecraft/server";
import { FORTUNE } from "../../generated/scripts/mundoDetalhes";

type FortuneEntry = (typeof FORTUNE)[string][number];

const randInt = (bound: number, random: () => number) => Math.floor(random() * bound);

/** Quantidade depois do bônus (ApplyBonusCount + limit_count). */
export function applyBonus(entry: FortuneEntry, base: number, level: number, random: () => number = Math.random): number {
  let n = base;
  if (level > 0) {
    if (entry.formula === "ore_drops") {
      const i = Math.max(0, randInt(level + 2, random) - 1);
      n = base * (i + 1);
    }
    else if (entry.formula === "uniform_bonus_count") n = base + randInt((entry.bonusMultiplier ?? 1) * level + 1, random);
    else if (entry.formula === "binomial_with_bonus_count") {
      for (let i = 0; i < level + (entry.extra ?? 0); i++) if (random() < (entry.probability ?? 0.5)) n++;
    }
  }
  if (entry.limitMax !== undefined) n = Math.min(n, entry.limitMax);
  return n;
}

/** Itens extras (além do que a loot table já soltou) para o bloco quebrado com Fortuna `level`. */
export function fortuneExtras(blockId: string, states: Record<string, unknown>, level: number, random: () => number = Math.random): Array<{ item: string; amount: number }> {
  const entries = FORTUNE[blockId];
  if (!entries || level <= 0) return [];
  const out: Array<{ item: string; amount: number }> = [];
  for (const entry of entries) {
    if (entry.states && Object.entries(entry.states).some(([k, v]) => states[k] !== v)) continue;
    const base = entry.min + randInt(entry.max - entry.min + 1, random);
    const extra = applyBonus(entry, base, level, random) - base;
    if (extra > 0) out.push({ item: entry.item, amount: extra });
  }
  return out;
}

function enchantLevel(item: ItemStack | undefined, id: string): number {
  try { return item?.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0; }
  catch { return 0; }
}

function statesOf(permutation: BlockPermutation): Record<string, unknown> {
  try { return permutation.getAllStates() as Record<string, unknown>; }
  catch { return {}; }
}

let started = false;

export function startFortune() {
  if (started) return;
  started = true;
  world.afterEvents.playerBreakBlock.subscribe(({ brokenBlockPermutation, itemStackBeforeBreak, block, dimension }) => {
    const id = brokenBlockPermutation.type.id;
    if (!FORTUNE[id]) return;
    const level = enchantLevel(itemStackBeforeBreak, "fortune");
    if (level <= 0 || enchantLevel(itemStackBeforeBreak, "silk_touch") > 0) return;
    const at: Vector3 = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
    for (const { item, amount } of fortuneExtras(id, statesOf(brokenBlockPermutation), level)) {
      system.run(() => {
        try { dimension.spawnItem(new ItemStack(item, amount), at); }
        catch (e) { console.warn(`[mundo-detalhes] Fortuna ${item}: ${e}`); }
      });
    }
  });
}
