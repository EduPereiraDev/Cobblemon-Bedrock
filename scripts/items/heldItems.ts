/**
 * Item segurado → id de item do Showdown (CobblemonHeldItemManager / BaseCobblemonHeldItemManager, 1.8.2).
 *
 * Regra do Cobblemon: o id do Showdown é o caminho do item sem "_" (`cobblemon:choice_scarf` → `choicescarf`),
 * valendo só se o Showdown conhece o item; exceções registradas à parte (`heldItem("charcoal_stick",
 * remappedName = "charcoal")`, `heldItem("medicinal_leek", ..., "leek")`) e três itens vanilla
 * (`registerRemap`). Item que o Showdown não conhece (Everstone, Lucky Egg...) entra na batalha sem item.
 */
import { ITEMS } from "../../generated/scripts/items";
import { Dex, toID } from "../showdown";

/** Remapeamentos explícitos do Cobblemon (item Bedrock → id Showdown). */
export const HELD_ITEM_REMAPS: Readonly<Record<string, string>> = {
  "cobblemon:charcoal_stick": "charcoal",
  "cobblemon:medicinal_leek": "leek",
  "minecraft:bone": "thickclub",
  "minecraft:snowball": "snowball",
  "minecraft:gold_block": "bignugget",
};

/**
 * Frente msd-fase1: namespaces de extensão cujos itens valem como item segurado pela regra "caminho sem `_`"
 * (`mega_showdown:charizardite_x` → `charizarditex`, `mega_showdown:firium_z` → `firiumz`: os 121 registros `mega/` e
 * `z_crystal_item/` do MSD seguem a regra e existem no dex do @pkmn/sim). Só entra quando a extensão liga
 * (`registerHeldItemNamespace`, extensions/megaShowdown): sem o pack, o item nem existe e o base segue igual.
 */
const extraNamespaces = new Set<string>();

/** Aceita itens segurados do namespace (idempotente). */
export function registerHeldItemNamespace(namespace: string): void {
  if (namespace && namespace !== "cobblemon") extraNamespaces.add(namespace);
}

/** Só para os testes. */
export function clearHeldItemNamespaces(): void {
  extraNamespaces.clear();
}

/**
 * Id do Showdown para o item segurado (id Bedrock, ex.: "cobblemon:charcoal_stick" → "charcoal").
 * String vazia se não houver item ou se o Showdown não o conhecer.
 */
export function toShowdownItemId(minecraftItem: string | undefined): string {
  if (!minecraftItem) return "";
  const remap = HELD_ITEM_REMAPS[minecraftItem];
  if (remap) return remap;
  const [namespace, path] = minecraftItem.includes(":") ? minecraftItem.split(":", 2) : ["cobblemon", minecraftItem];
  if (extraNamespaces.has(namespace)) {
    const extra = toID(path);
    return Dex.items.get(extra).exists ? extra : "";
  }
  if (namespace !== "cobblemon") return "";
  const data = ITEMS[path];
  const name = typeof data?.heldItem === "string" ? data.heldItem : path;
  const id = toID(name);
  return Dex.items.get(id).exists ? id : "";
}

/**
 * Item para o set do Showdown a partir do Pokémon: usa o item Minecraft quando houver (dados do jogador) e,
 * sem ele, o `item` já em formato Showdown (sets montados por código, ex.: NPCs).
 */
export function showdownItemOf(pokemon: { item?: string; minecraftItem?: string }): string {
  if (pokemon.minecraftItem) return toShowdownItemId(pokemon.minecraftItem);
  const id = toID(pokemon.item ?? "");
  return id && Dex.items.get(id).exists ? id : "";
}
