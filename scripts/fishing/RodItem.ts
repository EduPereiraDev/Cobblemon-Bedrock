/**
 * Dados guardados na Poké Rod (ItemStack): isca presa (RodBaitComponent do Cobblemon), encantamentos (Lure,
 * Luck of the Sea, Unbreaking) e durabilidade. A isca fica numa dynamic property do item — só existe em itens
 * não empilháveis, e as varas têm max_stack_size 1.
 */
import { ItemStack, RawMessage } from "@minecraft/server";
import { BaitEffect, effectsForItem, isFishingBait } from "./BaitEffects";

/** Dynamic property da vara com a isca: JSON RodBait. */
export const ROD_BAIT_PROPERTY = "cobblemon:rod_bait";

/** Isca presa na vara (RodBaitComponent.stack). */
export interface RodBait {
  /** Item da isca, ex.: "cobblemon:oran_berry". */
  item: string;
  count: number;
  /** Máximo empilhável do item da isca. */
  max: number;
  /** Ids de isca do componente BAIT_EFFECTS da pilha (Poké Bait temperada), se houver. */
  components?: string[];
}

/** Lê/valida o JSON da isca (tolerante a lixo). */
export function parseRodBait(raw: unknown): RodBait | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const data = JSON.parse(raw) as Partial<RodBait>;
    if (typeof data.item !== "string" || typeof data.count !== "number" || data.count <= 0) return undefined;
    return {
      item: data.item,
      count: Math.trunc(data.count),
      max: typeof data.max === "number" && data.max > 0 ? Math.trunc(data.max) : 64,
      components: Array.isArray(data.components) ? data.components.filter(c => typeof c === "string") : undefined,
    };
  }
  catch { return undefined; }
}

export function getRodBait(rod: ItemStack): RodBait | undefined {
  try { return parseRodBait(rod.getDynamicProperty(ROD_BAIT_PROPERTY)); }
  catch { return undefined; }
}

/** PokerodItem.setBait (undefined remove) + lore "Bait: X ×N". */
export function setRodBait(rod: ItemStack, bait: RodBait | undefined) {
  try { rod.setDynamicProperty(ROD_BAIT_PROPERTY, bait && bait.count > 0 ? JSON.stringify(bait) : undefined); }
  catch { /* item empilhável: não há onde guardar */ }
  updateRodLore(rod, bait && bait.count > 0 ? bait : undefined);
}

/** Chave de tradução do nome de um item (itens do Cobblemon: item.cobblemon.<id>; vanilla: item.<id>.name). */
export function itemNameKey(itemId: string): string {
  try { return new ItemStack(itemId).localizationKey; }
  catch {
    const [ns, path] = itemId.includes(":") ? itemId.split(":", 2) : ["minecraft", itemId];
    return ns === "minecraft" ? `item.${path}.name` : `item.${ns}.${path}`;
  }
}

export function updateRodLore(rod: ItemStack, bait: RodBait | undefined) {
  const lore: RawMessage[] = [];
  if (bait) lore.push({ translate: "cobblemon.pokerod.bait", with: { rawtext: [{ translate: itemNameKey(bait.item) }, { text: String(bait.count) }] } });
  try { rod.setLore(lore); }
  catch { /* sem lore */ }
}

/** PokerodItem.consumeBait: tira 1 da isca da vara. */
export function consumeRodBait(rod: ItemStack): RodBait | undefined {
  const bait = getRodBait(rod);
  if (!bait) return undefined;
  const next = bait.count > 1 ? { ...bait, count: bait.count - 1 } : undefined;
  setRodBait(rod, next);
  return next;
}

/** Efeitos da isca da vara (SpawnBaitEffects.getEffectsFromRodItemStack). */
export function rodBaitEffects(bait: RodBait | undefined): BaitEffect[] {
  return bait ? effectsForItem(bait.item, bait.components) : [];
}

/** Ids de isca de uma pilha (componente BAIT_EFFECTS simulado por dynamic property, só em itens não empilháveis). */
export const BAIT_EFFECTS_PROPERTY = "cobblemon:bait_effects";

export function stackBaitComponents(stack: ItemStack): string[] | undefined {
  try {
    const raw = stack.getDynamicProperty(BAIT_EFFECTS_PROPERTY);
    if (typeof raw !== "string") return undefined;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(x => typeof x === "string") : undefined;
  }
  catch { return undefined; }
}

export function isBaitStack(stack: ItemStack | undefined): stack is ItemStack {
  return !!stack && isFishingBait(stack.typeId);
}

/** Mesmo item e mesmos componentes de isca (ItemStack.isSameItemSameComponents). */
export function sameBait(bait: RodBait, stack: ItemStack): boolean {
  if (bait.item !== stack.typeId) return false;
  const a = (bait.components ?? []).join(","), b = (stackBaitComponents(stack) ?? []).join(",");
  return a === b;
}

// ---------------------------------------------------------------------------------------------
// Encantamentos

export interface RodEnchantments {
  lure: number;
  luckOfTheSea: number;
  unbreaking: number;
}

export function rodEnchantments(rod: ItemStack): RodEnchantments {
  const out = { lure: 0, luckOfTheSea: 0, unbreaking: 0 };
  try {
    const enchantable = rod.getComponent("minecraft:enchantable");
    if (!enchantable) return out;
    out.lure = enchantable.getEnchantment("lure")?.level ?? 0;
    out.luckOfTheSea = enchantable.getEnchantment("luck_of_the_sea")?.level ?? 0;
    out.unbreaking = enchantable.getEnchantment("unbreaking")?.level ?? 0;
  }
  catch { /* vara sem minecraft:enchantable */ }
  return out;
}

/**
 * Aplica `loss` pontos de dano. @returns true se a vara quebrou (o chamador tira o item da mão).
 */
export function damageRod(rod: ItemStack, loss: number): boolean {
  if (loss <= 0) return false;
  try {
    const durability = rod.getComponent("minecraft:durability");
    if (!durability || durability.unbreakable) return false;
    const next = durability.damage + loss;
    if (next >= durability.maxDurability) return true;
    durability.damage = next;
  }
  catch { /* vara sem durabilidade */ }
  return false;
}
