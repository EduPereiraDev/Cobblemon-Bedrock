/**
 * Itens cosméticos (Cobblemon 1.8.2: data/cobblemon/cosmetic_items, CobblemonCosmeticItems, COSMETIC_SLOT_ASPECT,
 * Pokemon.swapCosmeticItem e PokemonEntity.offerCosmeticItem).
 *
 * Cada definição diz quais Pokémon aceitam e, por item, os aspects que o item dá enquanto está "vestido"
 * (`cosmetic_item-big_malasada`, `color-red`, `tree-oak`...). O visual vem das variações do resolver
 * (generated/scripts/variants.ts já tem essas combinações): trocar o item troca os aspects e o `cobblemon:variant`.
 * Os 29 arquivos são pequenos e estáticos, então ficam aqui (o importador não os exporta).
 */

export interface CosmeticItemEntry {
  /** Id do item (`minecraft:bundle`) ou tag (`#minecraft:oak_logs`). */
  consumedItem: string;
  aspects: string[];
}

export interface CosmeticItemAssignment {
  /** PokemonProperties de quem aceita (`"electrode hisuian=false"`). */
  pokemon: string[];
  cosmeticItems: CosmeticItemEntry[];
}

const PIKA = ["pikachu", "raichu", "pichu"];
const single = (pokemon: string[], item: string, aspect: string): CosmeticItemAssignment =>
  ({ pokemon, cosmeticItems: [{ consumedItem: item, aspects: [aspect] }] });
const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const colored = (suffix: string): CosmeticItemEntry[] =>
  COLORS.map(color => ({ consumedItem: `minecraft:${color}_${suffix}`, aspects: [`color-${color}`, `colour-${color}`] }));

/** data/cobblemon/cosmetic_items/*.json do Cobblemon 1.8.2 (mesma ordem alfabética dos arquivos). */
export const COSMETIC_ITEMS: readonly CosmeticItemAssignment[] = [
  single(PIKA, "cobblemon:big_malasada", "cosmetic_item-big_malasada"),
  single(["squirtle", "wartortle", "blastoise", "sandile", "krokorok", "krookodile", "pancham", "pangoro"], "cobblemon:black_glasses", "cosmetic_item-black_glasses"),
  single(["dragonite"], "minecraft:bundle", "cosmetic_item-bundle"),
  single(PIKA, "cobblemon:casteliacone", "cosmetic_item-casteliacone"),
  single(["dragonite"], "minecraft:chest", "cosmetic_item-chest"),
  single(PIKA, "minecraft:cocoa_beans", "cosmetic_item-cocoa_beans"),
  single(PIKA, "minecraft:compass", "cosmetic_item-compass"),
  single(["sneasler"], "minecraft:composter", "cosmetic_item-composter"),
  { pokemon: ["conkeldurr"], cosmeticItems: [...colored("concrete"), ...colored("concrete_powder")] },
  { pokemon: ["electrode hisuian=false", "furfrou", "alakazam", "gengar", "jigglypuff", "smeargle"], cosmeticItems: colored("dye") },
  single(["spoink"], "minecraft:ender_pearl", "cosmetic_item-ender_pearl"),
  {
    pokemon: ["gimmighoul roaming=false", "gholdengo"], cosmeticItems: [
      { consumedItem: "cobblemon:gilded_chest", aspects: ["red-gilded-chest"] },
      { consumedItem: "cobblemon:yellow_gilded_chest", aspects: ["yellow-gilded-chest"] },
      { consumedItem: "cobblemon:green_gilded_chest", aspects: ["green-gilded-chest"] },
      { consumedItem: "cobblemon:blue_gilded_chest", aspects: ["blue-gilded-chest"] },
      { consumedItem: "cobblemon:pink_gilded_chest", aspects: ["pink-gilded-chest"] },
      { consumedItem: "cobblemon:black_gilded_chest", aspects: ["black-gilded-chest"] },
      { consumedItem: "cobblemon:white_gilded_chest", aspects: ["white-gilded-chest"] },
    ],
  },
  {
    pokemon: ["sudowoodo"], cosmeticItems: ["helmet", "chestplate", "leggings", "boots"]
      .map(piece => ({ consumedItem: `minecraft:golden_${piece}`, aspects: ["cosmetic_item-gold_armor"] })),
  },
  {
    pokemon: ["gurdurr"], cosmeticItems: ["copper", "iron", "gold", "netherite"]
      .map(metal => ({ consumedItem: `minecraft:${metal}_ingot`, aspects: [`metals-${metal}`] })),
  },
  single(PIKA, "cobblemon:lava_cookie", "cosmetic_item-lava_cookie"),
  single(PIKA, "minecraft:leather_helmet", "cosmetic_item-leather_helmet"),
  {
    pokemon: ["hawlucha"], cosmeticItems: [
      "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves", "minecraft:jungle_leaves",
      "minecraft:acacia_leaves", "minecraft:dark_oak_leaves", "minecraft:mangrove_leaves", "minecraft:azalea_leaves",
      "minecraft:flowering_azalea_leaves", "minecraft:cherry_leaves", "cobblemon:apricorn_leaves", "cobblemon:saccharine_leaves",
    ].map(item => ({ consumedItem: item, aspects: ["cosmetic_item-leaves"] })),
  },
  {
    pokemon: ["timburr", "komala"], cosmeticItems: [
      { consumedItem: "#cobblemon:apricorn_logs", aspects: ["tree-apricorn"] },
      { consumedItem: "#cobblemon:saccharine_logs", aspects: ["tree-saccharine"] },
      { consumedItem: "#minecraft:oak_logs", aspects: ["tree-oak"] },
      { consumedItem: "#minecraft:spruce_logs", aspects: ["tree-spruce"] },
      { consumedItem: "#minecraft:birch_logs", aspects: ["tree-birch"] },
      { consumedItem: "#minecraft:jungle_logs", aspects: ["tree-jungle"] },
      { consumedItem: "#minecraft:acacia_logs", aspects: ["tree-acacia"] },
      { consumedItem: "#minecraft:dark_oak_logs", aspects: ["tree-darkoak"] },
      { consumedItem: "#minecraft:mangrove_logs", aspects: ["tree-mangrove"] },
      { consumedItem: "#minecraft:crimson_stems", aspects: ["tree-crimson"] },
      { consumedItem: "#minecraft:warped_stems", aspects: ["tree-warped"] },
      { consumedItem: "#minecraft:cherry_logs", aspects: ["tree-cherry"] },
    ],
  },
  single(PIKA, "cobblemon:lumiose_galette", "cosmetic_item-lumiose_galette"),
  {
    pokemon: ["pichu", "tinkatink", "tinkatuff", "tinkaton"], cosmeticItems: [
      { consumedItem: "minecraft:jukebox", aspects: ["cosmetic_item-music"] },
      { consumedItem: "minecraft:note_block", aspects: ["cosmetic_item-music"] },
    ],
  },
  single(PIKA, "cobblemon:old_gateau", "cosmetic_item-old_gateau"),
  single(PIKA, "cobblemon:pewter_crunchies", "cosmetic_item-pewter_crunchies"),
  single(PIKA, "cobblemon:rage_candy_bar", "cosmetic_item-rage_candy_bar"),
  single(PIKA, "minecraft:shears", "cosmetic_item-shears"),
  single(["braixen", "delphox"], "cobblemon:silk_scarf", "cosmetic_item-silk_scarf"),
  single(PIKA, "cobblemon:sinister_tea", "cosmetic_item-sinister_tea"),
  single(PIKA, "cobblemon:smoked_tail_curry", "cosmetic_item-smoked_tail_curry"),
  single(["treecko", "grovyle", "sceptile"], "minecraft:stick", "cosmetic_item-stick"),
  single(["squirtle", "wartortle", "blastoise"], "cobblemon:wise_glasses", "cosmetic_item-wise_glasses"),
];

/**
 * Tags de tronco (`#minecraft:oak_logs`, `#minecraft:crimson_stems`, `#cobblemon:apricorn_logs`) → ids do Bedrock:
 * tronco, madeira e as versões descascadas (`stripped_` no vanilla, `stripped_`/`strip_` no Cobblemon).
 */
export function itemMatchesTag(tag: string, itemId: string): boolean {
  const [namespace, path] = tag.replace(/^#/, "").split(":");
  const match = /^(.*)_(logs|stems)$/.exec(path ?? "");
  if (!match) return false;
  const wood = match[1];
  const [itemNamespace, itemPath] = itemId.split(":");
  if (itemNamespace !== namespace || !itemPath) return false;
  const names = match[2] === "stems" ? [`${wood}_stem`, `${wood}_hyphae`] : [`${wood}_log`, `${wood}_wood`];
  const prefixes = ["", "stripped_", "strip_"];
  return prefixes.some(prefix => names.some(name => itemPath === prefix + name));
}

/** O item bate com `consumedItem` (id exato ou tag). */
export function itemMatches(consumedItem: string, itemId: string): boolean {
  return consumedItem.startsWith("#") ? itemMatchesTag(consumedItem, itemId) : consumedItem === itemId;
}

/** O que a regra precisa do Pokémon: espécie e aspects (para `hisuian=false`, `roaming=false`). */
export interface CosmeticTarget {
  species: string;
  aspects: readonly string[];
}

/** PokemonProperties simples das definições: espécie + `aspecto=false/true` (hisuian, roaming). */
export function matchesPokemon(properties: string, target: CosmeticTarget): boolean {
  const [species, ...rest] = properties.trim().toLowerCase().split(/\s+/);
  if (species !== target.species.toLowerCase().replace(/[^a-z0-9]/g, "")) return false;
  for (const part of rest) {
    const [key, value] = part.split("=");
    const has = target.aspects.includes(key);
    if (value === "false" ? has : !has) return false;
  }
  return true;
}

/** CobblemonCosmeticItems.findValidForPokemon. */
export function findValidForPokemon(target: CosmeticTarget): CosmeticItemAssignment[] {
  return COSMETIC_ITEMS.filter(assignment => assignment.pokemon.some(p => matchesPokemon(p, target)));
}

/** CobblemonCosmeticItems.findValidCosmeticForPokemonAndItem: a entrada que o item daria a este Pokémon. */
export function findCosmeticFor(target: CosmeticTarget, itemId: string | undefined): CosmeticItemEntry | undefined {
  if (!itemId) return undefined;
  for (const assignment of findValidForPokemon(target))
    for (const entry of assignment.cosmeticItems)
      if (itemMatches(entry.consumedItem, itemId)) return entry;
  return undefined;
}

/** Todos os aspects que algum cosmético pode dar (para limpar os do item anterior). */
export const ALL_COSMETIC_ASPECTS: ReadonlySet<string> = new Set(COSMETIC_ITEMS.flatMap(a => a.cosmeticItems.flatMap(e => e.aspects)));

/** O que o Pokémon precisa ter para vestir cosméticos (subconjunto de PokemonData). */
export interface CosmeticHolder extends CosmeticTarget {
  aspects: string[];
  cosmeticItem?: string;
}

/**
 * Pokemon.swapCosmeticItem + COSMETIC_SLOT_ASPECT: troca o item (undefined = tirar), tira os aspects do item
 * anterior e põe os do novo. Não valida (use `findCosmeticFor` antes). @returns o item anterior.
 */
export function swapCosmeticItem(pokemon: CosmeticHolder, itemId: string | undefined): string | undefined {
  const previous = pokemon.cosmeticItem;
  const oldAspects = findCosmeticFor(pokemon, previous)?.aspects ?? [];
  pokemon.cosmeticItem = itemId || undefined;
  const newAspects = findCosmeticFor(pokemon, pokemon.cosmeticItem)?.aspects ?? [];
  pokemon.aspects = pokemon.aspects.filter(aspect => !oldAspects.includes(aspect) || newAspects.includes(aspect));
  for (const aspect of newAspects) if (!pokemon.aspects.includes(aspect)) pokemon.aspects.push(aspect);
  return previous;
}

/** Interação "dar cosmético" disponível (canGiveCosmetic do InteractWheel): já veste algo ou aceita algum. */
export function canWearCosmetics(target: CosmeticTarget & { cosmeticItem?: string }): boolean {
  return !!target.cosmeticItem || findValidForPokemon(target).length > 0;
}
