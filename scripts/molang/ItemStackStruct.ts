/**
 * Struct MoLang de um ItemStack (ItemStackMoLangFunctions do Cobblemon 1.8.2): `q.item`, `q.player.main_held_item`,
 * `q.pokemon.held_item`, `q.create_itemstack(...)` e os itens de `q.world.spawn_loot_table_items(...)`.
 *
 * Diferenças do Java:
 * - `is_in('#tag')` usa as tags do item no Bedrock (ItemStack.hasTag), que não são as tags do Java;
 * - `is_food()` olha o componente `minecraft:food`;
 * - `is_enchanted()` é "tem encantamento" (no Java é `hasFoil`, que também vale para itens com brilho próprio);
 * - `shrink`/`grow` mudam o stack e chamam `onChange` (quem criou o struct devolve o stack ao inventário).
 */
import type { ItemStack } from "@minecraft/server";
import { MoStruct, asNumber, asString } from "../npc/molang/MoLang";

export const AIR = "minecraft:air";

/** Id com namespace padrão `minecraft` (Holder.is com asIdentifierDefaultingNamespace). */
export function normalizeItemId(id: string): string {
  const clean = id.trim().toLowerCase().replace(/^#/, "");
  return clean.includes(":") ? clean : `minecraft:${clean}`;
}

/** O id pedido bate com o do item? Sem namespace aceita `minecraft:` e `cobblemon:` (o Kotlin assume `cobblemon:`). */
export function itemIdMatches(wanted: string, actual: string): boolean {
  const clean = wanted.trim().toLowerCase();
  if (clean.includes(":")) return clean === actual.toLowerCase();
  return `minecraft:${clean}` === actual || `cobblemon:${clean}` === actual;
}

/** Tira o namespace `minecraft:` (ids de encantamento do Bedrock vêm sem ele). */
function bareId(id: string): string {
  return id.trim().toLowerCase().replace(/^minecraft:/, "");
}

/** Encantamentos do stack (vazio se o item não é encantável). */
export function enchantmentsOf(stack: ItemStack | undefined): { id: string; level: number }[] {
  if (!stack) return [];
  try {
    const enchantable = stack.getComponent("minecraft:enchantable");
    return (enchantable?.getEnchantments() ?? []).map(e => ({ id: bareId(e.type.id), level: e.level }));
  }
  catch { return []; }
}

/** Holder<Item>.asMoLangValue: `id`, `is_of(id)` e `is_in(#tag)`. */
function itemHolderStruct(id: string, hasTag: (tag: string) => boolean): MoStruct {
  return new MoStruct({ id }, {
    is_of: args => (itemIdMatches(asString(args[0]), id) ? 1 : 0),
    is_in: args => (hasTag(asString(args[0])) ? 1 : 0),
  });
}

/**
 * `ItemStack.asMoLangValue`. Sem stack (mão vazia) é um stack vazio de ar, como o `ItemStack.EMPTY` do Java.
 * @param onChange Chamado depois de `shrink`/`grow` (undefined = o stack acabou).
 */
export function createItemStackStruct(stack: ItemStack | undefined, onChange?: (stack: ItemStack | undefined) => void): MoStruct {
  let current = stack && stack.amount > 0 ? stack : undefined;
  const id = () => current?.typeId ?? AIR;
  const hasTag = (raw: string) => {
    if (!current) return false;
    const tag = raw.trim().toLowerCase().replace(/^#/, "");
    try { return current.hasTag(tag) || current.hasTag(tag.replace(/^minecraft:/, "")); }
    catch { return false; }
  };
  const durability = () => {
    try { return current?.getComponent("minecraft:durability"); }
    catch { return undefined; }
  };
  const resize = (delta: number) => {
    if (!current) return 0;
    const next = current.amount + Math.trunc(delta);
    if (next <= 0) current = undefined;
    else {
      try { current.amount = Math.min(next, current.maxAmount); }
      catch { return 0; }
    }
    onChange?.(current);
    return 1;
  };
  const struct = new MoStruct({ id: id() }, {}, stack);
  struct
    .fn("item", () => itemHolderStruct(id(), hasTag))
    .fn("count", () => current?.amount ?? 0)
    .fn("damage_value", () => durability()?.damage ?? 0)
    .fn("max_damage", () => durability()?.maxDurability ?? 0)
    .fn("is_empty", () => (current ? 0 : 1))
    .fn("shrink", args => resize(-asNumber(args[0])))
    .fn("grow", args => resize(asNumber(args[0])))
    .fn("is_of", args => (itemIdMatches(asString(args[0]), id()) ? 1 : 0))
    .fn("is_in", args => (hasTag(asString(args[0])) ? 1 : 0))
    .fn("is_food", () => {
      try { return current?.getComponent("minecraft:food") ? 1 : 0; }
      catch { return 0; }
    })
    // Cobblemon 1.8.0: q.item.is_enchanted() e q.item.has_enchantment('minecraft:sharpness', 3).
    .fn("is_enchanted", () => (enchantmentsOf(current).length > 0 ? 1 : 0))
    .fn("has_enchantment", args => {
      const wanted = bareId(asString(args[0]));
      const minLevel = args[1] === undefined ? 1 : Math.trunc(asNumber(args[1]));
      const found = enchantmentsOf(current).find(e => e.id === wanted);
      return found && found.level >= minLevel ? 1 : 0;
    });
  return struct;
}

/** ItemStack guardado num struct (ObjectValue<ItemStack>), ou undefined. */
export function itemStackOfStruct(value: unknown): ItemStack | undefined {
  if (!(value instanceof MoStruct)) return undefined;
  const host = value.host as ItemStack | undefined;
  return host && typeof host === "object" && typeof host.typeId === "string" ? host : undefined;
}
