/**
 * Itens guardados nas máquinas (sem inventário de bloco no Bedrock): um "SlotItem" serializável com id,
 * quantidade, lore bruta (RawMessage, onde vão os dados de tempero/TM) e nome. Encantamentos e outros
 * componentes não são preservados — por isso as máquinas só aceitam os itens que usam.
 * Frente motor: quem precisa guardar o item inteiro (vitrine, estante de discos, baús dourados) usa a entidade com
 * inventário de scripts/world/Containers.ts (ItemStack real, T11 da pesquisa 3-motor); `isPlainStack` continua como
 * filtro das máquinas que ainda serializam SlotItem (panela, fósseis, TM).
 */
import { Dimension, GameMode, ItemStack, Player, RawMessage, Vector3 } from "@minecraft/server";
import { ITEM_TAGS } from "./data";
import type { RecipeOption } from "../../generated/scripts/recipes";
import { providedItemName } from "../items/itemNames"; // frente msd-fase6: nome de item de outro namespace

export interface SlotItem {
  id: string;
  n: number;
  lore?: RawMessage[];
  name?: string;
}

/** Item → restante ao ser consumido numa receita (Item.craftingRemainingItem). */
export const CRAFTING_REMAINDERS: Record<string, string> = {
  "minecraft:milk_bucket": "minecraft:bucket",
  "minecraft:water_bucket": "minecraft:bucket",
  "minecraft:lava_bucket": "minecraft:bucket",
  "minecraft:honey_bottle": "minecraft:glass_bottle",
  "minecraft:dragon_breath": "minecraft:glass_bottle",
  "minecraft:potion": "minecraft:glass_bottle",
};

/** O item pertence à tag (tags de item do Cobblemon e vanilla já resolvidas em data.ts). */
export function itemHasTag(id: string, tag: string): boolean {
  const t = tag.replace(/^#/, "");
  if (t === "cobblemon:empty") return false;
  return ITEM_TAGS[t]?.includes(id) ?? false;
}

export function matchesOption(id: string, option: RecipeOption): boolean {
  return "item" in option ? option.item === id : itemHasTag(id, option.tag);
}

export function matchesAny(id: string, options: readonly RecipeOption[]): boolean {
  return options.some(o => matchesOption(id, o));
}

/** Mesma pilha (id, lore e nome iguais) — pode empilhar. */
export function sameStack(a: SlotItem | undefined | null, b: SlotItem | undefined | null): boolean {
  if (!a || !b) return false;
  return a.id === b.id && JSON.stringify(a.lore ?? []) === JSON.stringify(b.lore ?? []) && (a.name ?? "") === (b.name ?? "");
}

export function maxStackOf(id: string): number {
  try {
    const n = new ItemStack(id).maxAmount;
    return typeof n === "number" && n > 0 ? n : 64;
  }
  catch { return 64; }
}

export function toSlotItem(stack: ItemStack, amount = stack.amount): SlotItem {
  const out: SlotItem = { id: stack.typeId, n: amount };
  try {
    const lore = stack.getRawLore();
    if (lore.length) out.lore = lore;
  }
  catch { /* sem lore */ }
  if (stack.nameTag) out.name = stack.nameTag;
  return out;
}

export function toItemStack(slot: SlotItem, amount = slot.n): ItemStack {
  const stack = new ItemStack(slot.id, Math.max(1, amount));
  if (slot.lore?.length) {
    try { stack.setLore(slot.lore); }
    catch { /* item sem lore */ }
  }
  if (slot.name) stack.nameTag = slot.name;
  return stack;
}

/**
 * A pilha cabe num SlotItem sem perder nada (id, quantidade, lore e nome)? Recusa encantamento, desgaste, cor,
 * poção diferente da padrão, livro escrito, conteúdo (bundle/shulker) e dynamic properties. Empilháveis são
 * comparados com a reconstrução (isStackableWith compara todos os dados); na dúvida, não é simples.
 */
export function isPlainStack(stack: ItemStack): boolean {
  try {
    if (stack.getDynamicPropertyIds().length > 0) return false;
    if (stack.maxAmount > 1) return stack.isStackableWith(toItemStack(toSlotItem(stack, 1)));
    if ((stack.getComponent("minecraft:durability")?.damage ?? 0) > 0) return false;
    if ((stack.getComponent("minecraft:enchantable")?.getEnchantments().length ?? 0) > 0) return false;
    if (stack.getComponent("minecraft:dyeable")?.color !== undefined) return false;
    if (stack.getComponent("minecraft:book") || stack.getComponent("minecraft:inventory")) return false;
    if (/shulker_box$/.test(stack.typeId)) return false;
    const potion = stack.getComponent("minecraft:potion");
    if (potion) {
      // Só a poção padrão do item (ex.: garrafa de água), que a reconstrução devolve igual.
      const plain = new ItemStack(stack.typeId, 1).getComponent("minecraft:potion");
      if (!plain || plain.potionEffectType.id !== potion.potionEffectType.id || plain.potionDeliveryType.id !== potion.potionDeliveryType.id) return false;
    }
    return true;
  }
  catch { return false; }
}

/** Soltar no mundo (centro do bloco). */
export function dropAt(dimension: Dimension, location: Vector3, stack: ItemStack) {
  try { dimension.spawnItem(stack, { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }); }
  catch (e) { console.warn(`[máquinas] não foi possível soltar ${stack.typeId}: ${e}`); }
}

/** Dá ao jogador; o que não couber cai no chão. */
export function giveOrDrop(player: Player, stack: ItemStack) {
  const container = player.getComponent("minecraft:inventory")?.container;
  const left = container ? container.addItem(stack) : stack;
  if (left) dropAt(player.dimension, { x: player.location.x - 0.5, y: player.location.y, z: player.location.z - 0.5 }, left);
}

/** Dá uma pilha serializada (em pilhas do tamanho máximo). */
export function giveSlotItem(player: Player, slot: SlotItem) {
  const max = maxStackOf(slot.id);
  for (let left = slot.n; left > 0; left -= max) giveOrDrop(player, toItemStack(slot, Math.min(max, left)));
}

export function dropSlotItem(dimension: Dimension, location: Vector3, slot: SlotItem) {
  const max = maxStackOf(slot.id);
  for (let left = slot.n; left > 0; left -= max) dropAt(dimension, location, toItemStack(slot, Math.min(max, left)));
}

export function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

export function heldItem(player: Player): ItemStack | undefined {
  return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
}

export function setHeldItem(player: Player, stack: ItemStack | undefined) {
  player.getComponent("minecraft:inventory")?.container?.setItem(player.selectedSlotIndex, stack);
}

/** Tira `amount` do item na mão (nada no criativo). */
export function consumeHeld(player: Player, amount = 1) {
  if (isCreative(player)) return;
  const stack = heldItem(player);
  if (!stack) return;
  if (stack.amount <= amount) setHeldItem(player, undefined);
  else {
    stack.amount -= amount;
    setHeldItem(player, stack);
  }
}

/** Quantos itens com este id o jogador tem no inventário. */
export function countInInventory(player: Player, id: string): number {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return 0;
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId === id) total += item.amount;
  }
  return total;
}

/** Remove até `amount` itens com este id do inventário. @returns quantos removeu. */
export function removeFromInventory(player: Player, id: string, amount: number): number {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container || amount <= 0) return 0;
  let removed = 0;
  for (let i = 0; i < container.size && removed < amount; i++) {
    const item = container.getItem(i);
    if (item?.typeId !== id) continue;
    const take = Math.min(item.amount, amount - removed);
    removed += take;
    if (take >= item.amount) container.setItem(i, undefined);
    else {
      item.amount -= take;
      container.setItem(i, item);
    }
  }
  return removed;
}

/** Nome traduzível de um item pelo id (mesma regra de GUI/common.itemName). */
export function itemNameOf(id: string): RawMessage {
  const [ns, path] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
  if (ns === "cobblemon") return { translate: `item.cobblemon.${path}` };
  return providedItemName(ns, path) ?? { translate: `item.${path}.name` };
}
