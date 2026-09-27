/**
 * Itens que um Pokémon não pode segurar (Cobblemon 1.7.0+: tags `held/blacklisted_items_to_hold` →
 * `held/container_held_items` e `held/whitelisted_items_to_hold` vazia; PokemonEntity.offerHeldItem).
 *
 * O Cobblemon bloqueia contêineres (caixas de shulker e mochilas de mods) porque o item segurado não leva o conteúdo
 * junto com segurança. No Bedrock o port guarda o item segurado só pelo id (`PokemonData.minecraftItem`), então
 * qualquer contêiner perderia o que tem dentro: além das 17 caixas de shulker da tag, o port bloqueia também as
 * bolsas (`minecraft:bundle` e as tingidas), que no Java 1.21.1 do Cobblemon não existiam como item de sobrevivência.
 */
const SHULKER_COLORS = ["", "black_", "blue_", "brown_", "cyan_", "gray_", "green_", "light_blue_", "light_gray_", "lime_",
  "magenta_", "orange_", "pink_", "purple_", "red_", "white_", "yellow_"];
const BUNDLE_COLORS = ["", ...SHULKER_COLORS.filter(Boolean)];

/** Tag `held/container_held_items` (itens vanilla) + bolsas do Bedrock. */
export const FORBIDDEN_HELD_ITEMS = new Set<string>([
  ...SHULKER_COLORS.map(color => `minecraft:${color}shulker_box`),
  "minecraft:undyed_shulker_box",
  ...BUNDLE_COLORS.map(color => `minecraft:${color}bundle`),
]);

/** Whitelist (`held/whitelisted_items_to_hold`): vazia no Cobblemon 1.8.2 = tudo liberado. */
export const WHITELISTED_HELD_ITEMS = new Set<string>();

/** isBlacklisted(stack) || !isWhitelisted(stack). */
export function isForbiddenHeldItem(typeId: string): boolean {
  if (FORBIDDEN_HELD_ITEMS.has(typeId)) return true;
  return WHITELISTED_HELD_ITEMS.size > 0 && !WHITELISTED_HELD_ITEMS.has(typeId);
}

/** Chave da mensagem "Você não pode dar %1$s para %2$s." */
export const FORBIDDEN_HELD_ITEM_LANG = "cobblemon.held_item.forbidden";
