// Tabelas Java → Bedrock para itens vanilla (ids que mudam de nome) e tags de item usadas pelas receitas
// e loot do Cobblemon, validadas contra a lista oficial de itens do Bedrock (@minecraft/vanilla-data).
import { MinecraftBlockTypes, MinecraftItemTypes } from "@minecraft/vanilla-data";
import { splitId } from "./util.ts";

export const VANILLA_ITEMS = new Set<string>(Object.values(MinecraftItemTypes) as string[]);
export const VANILLA_BLOCKS = new Set<string>(Object.values(MinecraftBlockTypes) as string[]);

/** Itens cujo id difere entre Java 1.21.1 e Bedrock. */
const ITEM_RENAMES: Record<string, string> = {
	chain: "iron_chain",
	scute: "turtle_scute",
	cobweb: "web",
	lily_pad: "waterlily",
	slime_block: "slime",
	magma_block: "magma",
	melon: "melon_block",
	snow_block: "snow",
	snow: "snow_layer",
	bricks: "brick_block",
	terracotta: "hardened_clay",
	nether_brick: "netherbrick",
	nether_bricks: "nether_brick",
	red_nether_bricks: "red_nether_brick",
	end_stone_bricks: "end_bricks",
	dirt_path: "grass_path",
	jack_o_lantern: "lit_pumpkin",
	note_block: "noteblock",
	spawner: "mob_spawner",
	powered_rail: "golden_rail",
	nether_quartz_ore: "quartz_ore",
	map: "empty_map",
	oak_button: "wooden_button",
	oak_pressure_plate: "wooden_pressure_plate",
	oak_door: "wooden_door",
	oak_trapdoor: "trapdoor",
	oak_fence_gate: "fence_gate",
	grass: "short_grass",
	sugar_cane: "sugar_cane",
	water_bottle: "potion",
};

/** Id de item do Java → Bedrock; undefined se o item não existe no Bedrock. */
export function bedrockVanillaItem(javaId: string): string | undefined {
	const { ns, path } = splitId(javaId, "minecraft");
	if (ns !== "minecraft") return undefined;
	const id = `minecraft:${ITEM_RENAMES[path] ?? path}`;
	return VANILLA_ITEMS.has(id) ? id : undefined;
}

const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "pale_oak", "bamboo", "crimson", "warped"];

/**
 * Tags de item convencionais (c:*) e vanilla (minecraft:*) usadas nas receitas → itens Java.
 * "bedrockTag" indica uma tag de item nativa do Bedrock equivalente (usada direto como ingrediente).
 */
export const ITEM_TAGS: Record<string, { items: string[]; bedrockTag?: string }> = {
	"c:ingots/iron": { items: ["minecraft:iron_ingot"] },
	"c:ingots/copper": { items: ["minecraft:copper_ingot"] },
	"c:ingots/gold": { items: ["minecraft:gold_ingot"] },
	"c:ingots/netherite": { items: ["minecraft:netherite_ingot"] },
	"c:nuggets/iron": { items: ["minecraft:iron_nugget"] },
	"c:nuggets/gold": { items: ["minecraft:gold_nugget"] },
	"c:chains": { items: ["minecraft:chain"] },
	"c:gems/amethyst": { items: ["minecraft:amethyst_shard"] },
	"c:gems/diamond": { items: ["minecraft:diamond"] },
	"c:gems/quartz": { items: ["minecraft:quartz"] },
	"c:gems/lapis": { items: ["minecraft:lapis_lazuli"] },
	"c:gems/prismarine": { items: ["minecraft:prismarine_crystals"] },
	"c:gems/emerald": { items: ["minecraft:emerald"] },
	"c:drinks/milk": { items: ["minecraft:milk_bucket"] },
	"c:strings": { items: ["minecraft:string"] },
	"c:dusts/redstone": { items: ["minecraft:redstone"] },
	"c:dusts/glowstone": { items: ["minecraft:glowstone_dust"] },
	"c:chests/wooden": { items: ["minecraft:chest", "minecraft:trapped_chest"] },
	"c:chests": { items: ["minecraft:chest", "minecraft:trapped_chest"] },
	"c:concretes": { items: COLORS.map((c) => `minecraft:${c}_concrete`) },
	"c:leathers": { items: ["minecraft:leather"] },
	"c:fertilizers": { items: ["minecraft:bone_meal"] },
	"c:slime_balls": { items: ["minecraft:slime_ball"] },
	"c:rods/blaze": { items: ["minecraft:blaze_rod"] },
	"c:rods/wooden": { items: ["minecraft:stick"] },
	"c:tools/shield": { items: ["minecraft:shield"] },
	"c:seeds": { items: ["minecraft:wheat_seeds", "minecraft:beetroot_seeds", "minecraft:melon_seeds", "minecraft:pumpkin_seeds", "minecraft:torchflower_seeds", "minecraft:pitcher_pod"] },
	"c:storage_blocks/iron": { items: ["minecraft:iron_block"] },
	"c:buckets/empty": { items: ["minecraft:bucket"] },
	"c:bones": { items: ["minecraft:bone"] },
	"c:crops/wheat": { items: ["minecraft:wheat"] },
	"c:bricks/normal": { items: ["minecraft:brick"] },
	"c:raw_materials/gold": { items: ["minecraft:raw_gold"] },
	"c:foods/raw_meat": { items: ["minecraft:beef", "minecraft:porkchop", "minecraft:chicken", "minecraft:mutton", "minecraft:rabbit"] },
	"c:mushrooms": { items: ["minecraft:red_mushroom", "minecraft:brown_mushroom"] },
	"c:foods/bread": { items: ["minecraft:bread"] },
	"c:eggs": { items: ["minecraft:egg"] },
	"c:feathers": { items: ["minecraft:feather"] },
	"minecraft:enchantable/fishing": { items: ["minecraft:fishing_rod"] },
	"minecraft:wool": { items: COLORS.map((c) => `minecraft:${c}_wool`), bedrockTag: "minecraft:wool" },
	"minecraft:planks": { items: WOODS.map((w) => `minecraft:${w}_planks`), bedrockTag: "minecraft:planks" },
	"minecraft:wooden_slabs": { items: WOODS.map((w) => `minecraft:${w}_slab`), bedrockTag: "minecraft:wooden_slabs" },
	"minecraft:logs": { items: WOODS.filter((w) => w !== "bamboo").map((w) => `minecraft:${w}_log`), bedrockTag: "minecraft:logs" },
	"minecraft:buttons": { items: ["minecraft:stone_button", "minecraft:polished_blackstone_button", ...WOODS.map((w) => `minecraft:${w}_button`)] },
	"minecraft:small_flowers": { items: ["minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:red_tulip", "minecraft:orange_tulip", "minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley"] },
	"minecraft:saplings": { items: WOODS.filter((w) => !["bamboo", "crimson", "warped", "mangrove"].includes(w)).map((w) => `minecraft:${w}_sapling`) },
	"minecraft:leaves": { items: WOODS.filter((w) => !["bamboo", "crimson", "warped"].includes(w)).map((w) => `minecraft:${w}_leaves`) },
	"minecraft:coals": { items: ["minecraft:coal", "minecraft:charcoal"], bedrockTag: "minecraft:coals" },
};
for (const c of COLORS) ITEM_TAGS[`c:dyes/${c}`] = { items: [`minecraft:${c}_dye`] };

/** Tags de bioma do Bedrock (1.26) por bioma, extraídas das definições vanilla do BDS. */
export const BEDROCK_BIOME_TAGS: Record<string, string[]> = {
	bamboo_jungle: ["animal", "bamboo", "jungle", "monster", "overworld"],
	bamboo_jungle_hills: ["animal", "bamboo", "hills", "jungle", "monster", "overworld"],
	beach: ["beach", "monster", "overworld", "warm"],
	birch_forest: ["animal", "birch", "forest", "monster", "overworld"],
	birch_forest_hills: ["animal", "birch", "forest", "hills", "monster", "overworld"],
	birch_forest_hills_mutated: ["animal", "birch", "forest", "hills", "monster", "mutated", "overworld_generation"],
	birch_forest_mutated: ["animal", "birch", "forest", "monster", "mutated", "overworld_generation"],
	cold_beach: ["beach", "cold", "monster", "overworld"],
	cold_ocean: ["cold", "monster", "ocean", "overworld"],
	cold_taiga: ["animal", "cold", "forest", "monster", "overworld", "taiga"],
	cold_taiga_hills: ["animal", "cold", "forest", "hills", "monster", "overworld", "taiga"],
	cold_taiga_mutated: ["animal", "cold", "forest", "monster", "mutated", "taiga", "overworld_generation"],
	deep_cold_ocean: ["cold", "deep", "monster", "ocean", "overworld"],
	deep_frozen_ocean: ["deep", "frozen", "monster", "ocean", "overworld"],
	deep_lukewarm_ocean: ["deep", "lukewarm", "monster", "ocean", "overworld"],
	deep_ocean: ["deep", "monster", "ocean", "overworld"],
	deep_warm_ocean: ["deep", "monster", "ocean", "overworld", "warm"],
	desert: ["desert", "monster", "overworld"],
	desert_hills: ["desert", "hills", "monster", "overworld"],
	desert_mutated: ["desert", "monster", "mutated", "overworld_generation"],
	extreme_hills: ["animal", "extreme_hills", "monster", "overworld"],
	extreme_hills_edge: ["animal", "edge", "extreme_hills", "monster", "mountain", "overworld"],
	extreme_hills_mutated: ["animal", "extreme_hills", "monster", "mutated", "overworld"],
	extreme_hills_plus_trees: ["animal", "extreme_hills", "forest", "monster", "mountain", "overworld"],
	extreme_hills_plus_trees_mutated: ["animal", "extreme_hills", "forest", "monster", "mutated", "overworld"],
	flower_forest: ["animal", "flower_forest", "monster", "mutated", "overworld"],
	forest: ["animal", "forest", "monster", "overworld"],
	forest_hills: ["animal", "hills", "monster", "overworld", "forest"],
	frozen_ocean: ["frozen", "monster", "ocean", "overworld"],
	frozen_river: ["frozen", "overworld", "river"],
	hell: ["nether", "nether_wastes"],
	ice_mountains: ["frozen", "ice", "mountain", "overworld"],
	ice_plains: ["frozen", "ice", "ice_plains", "overworld"],
	ice_plains_spikes: ["frozen", "ice_plains", "monster", "mutated", "overworld"],
	jungle: ["animal", "jungle", "monster", "overworld", "rare"],
	jungle_edge: ["animal", "edge", "jungle", "monster", "overworld"],
	jungle_edge_mutated: ["animal", "edge", "jungle", "monster", "mutated", "overworld_generation"],
	jungle_hills: ["animal", "hills", "jungle", "monster", "overworld"],
	jungle_mutated: ["animal", "jungle", "monster", "mutated", "overworld_generation"],
	legacy_frozen_ocean: ["legacy", "frozen", "ocean", "overworld"],
	lukewarm_ocean: ["lukewarm", "monster", "ocean", "overworld"],
	mega_taiga: ["animal", "forest", "mega", "monster", "overworld", "rare", "taiga"],
	mega_taiga_hills: ["animal", "forest", "hills", "mega", "monster", "overworld", "taiga"],
	mesa: ["animal", "mesa", "monster", "overworld"],
	mesa_bryce: ["animal", "mesa", "monster", "mutated", "overworld"],
	mesa_plateau: ["animal", "mesa", "monster", "overworld", "plateau", "rare"],
	mesa_plateau_mutated: ["animal", "mesa", "monster", "mutated", "overworld", "plateau", "stone"],
	mesa_plateau_stone: ["animal", "mesa", "monster", "overworld", "plateau", "rare", "stone"],
	mesa_plateau_stone_mutated: ["animal", "mesa", "monster", "mutated", "overworld", "plateau"],
	mushroom_island: ["mooshroom_island", "overworld"],
	mushroom_island_shore: ["mooshroom_island", "overworld", "shore"],
	ocean: ["monster", "ocean", "overworld"],
	plains: ["animal", "monster", "overworld", "plains"],
	redwood_taiga_hills_mutated: ["animal", "forest", "hills", "mega", "monster", "mutated", "taiga", "overworld_generation"],
	redwood_taiga_mutated: ["animal", "forest", "mega", "monster", "mutated", "overworld", "taiga"],
	river: ["overworld", "river"],
	roofed_forest: ["animal", "forest", "monster", "overworld", "roofed"],
	roofed_forest_mutated: ["animal", "forest", "monster", "mutated", "roofed", "overworld_generation"],
	savanna: ["animal", "monster", "overworld", "savanna"],
	savanna_mutated: ["animal", "monster", "mutated", "overworld", "savanna"],
	savanna_plateau: ["animal", "monster", "overworld", "plateau", "savanna"],
	savanna_plateau_mutated: ["animal", "monster", "mutated", "overworld", "plateau", "savanna"],
	stone_beach: ["beach", "monster", "overworld", "stone"],
	sunflower_plains: ["animal", "monster", "mutated", "overworld", "plains"],
	swampland: ["animal", "monster", "overworld", "swamp"],
	swampland_mutated: ["animal", "monster", "mutated", "swamp", "overworld_generation"],
	taiga: ["animal", "forest", "monster", "overworld", "taiga"],
	taiga_hills: ["animal", "forest", "hills", "monster", "overworld", "taiga"],
	taiga_mutated: ["animal", "forest", "monster", "mutated", "taiga", "overworld_generation"],
	the_end: ["the_end"],
	warm_ocean: ["monster", "ocean", "overworld", "warm"],
	crimson_forest: ["nether", "netherwart_forest", "crimson_forest"],
	warped_forest: ["nether", "netherwart_forest", "warped_forest"],
	soulsand_valley: ["nether", "soulsand_valley"],
	basalt_deltas: ["nether", "basalt_deltas"],
	meadow: ["mountains", "monster", "overworld", "meadow"],
	grove: ["mountains", "cold", "monster", "overworld", "grove"],
	dripstone_caves: ["caves", "overworld", "dripstone_caves", "monster"],
	lush_caves: ["caves", "lush_caves", "overworld", "monster"],
	stony_peaks: ["mountains", "monster", "overworld"],
	jagged_peaks: ["mountains", "monster", "overworld", "frozen", "jagged_peaks"],
	frozen_peaks: ["mountains", "monster", "overworld", "frozen", "frozen_peaks"],
	snowy_slopes: ["frozen", "mountains", "monster", "overworld", "snowy_slopes"],
	deep_dark: ["caves", "deep_dark", "overworld"],
	mangrove_swamp: ["mangrove_swamp", "overworld", "monster"],
	cherry_grove: ["mountains", "monster", "overworld", "cherry_grove"],
	pale_garden: ["monster", "overworld", "pale_garden"],
};

/**
 * Filtro de bioma (feature_rules) que casa exatamente o conjunto de biomas do Bedrock informado:
 * usa tags inteiras quando todos os biomas da tag estão no conjunto e, para os que sobram, as tags do
 * bioma mais exclusões dos biomas "superconjunto".
 */
export function biomeFilter(biomes: string[]): unknown {
	const target = new Set(biomes.filter((b) => BEDROCK_BIOME_TAGS[b]));
	if (!target.size) return undefined;
	const all = Object.keys(BEDROCK_BIOME_TAGS);
	const withTag = (t: string) => all.filter((b) => BEDROCK_BIOME_TAGS[b].includes(t));
	const tags = [...new Set(all.flatMap((b) => BEDROCK_BIOME_TAGS[b]))].sort();
	const covered = new Set<string>();
	const any: unknown[] = [];
	// Tags inteiras contidas no conjunto (gulosamente, as maiores primeiro).
	const candidates = tags.map((t) => ({ t, bs: withTag(t) })).filter((c) => c.bs.every((b) => target.has(b))).sort((a, b) => b.bs.length - a.bs.length || a.t.localeCompare(b.t));
	for (const c of candidates) {
		if (c.bs.every((b) => covered.has(b))) continue;
		any.push({ test: "has_biome_tag", operator: "==", value: c.t });
		c.bs.forEach((b) => covered.add(b));
	}
	for (const b of [...target].sort()) {
		if (covered.has(b)) continue;
		const own = BEDROCK_BIOME_TAGS[b];
		const terms: unknown[] = own.map((t) => ({ test: "has_biome_tag", operator: "==", value: t }));
		for (const other of all) {
			if (other === b || target.has(other)) continue;
			const ot = BEDROCK_BIOME_TAGS[other];
			if (own.every((t) => ot.includes(t))) {
				const extra = ot.find((t) => !own.includes(t));
				if (extra) terms.push({ test: "has_biome_tag", operator: "!=", value: extra });
			}
		}
		any.push({ all_of: terms });
		covered.add(b);
	}
	return any.length === 1 ? any[0] : { any_of: any };
}
