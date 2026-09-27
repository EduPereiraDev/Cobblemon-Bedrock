// Tabelas Java → Bedrock para biomas e blocos, e expansão das tags (#ns:tag) usadas pelo Cobblemon.
import { existsSync } from "node:fs";
import { DATA, readJson, splitId, walk, warn } from "./util.ts";

/** Bioma do Java → ids do Bedrock (sem namespace). Inclui variantes legadas do Bedrock equivalentes. */
export const BIOME_MAP: Record<string, string[]> = {
	plains: ["plains"],
	sunflower_plains: ["sunflower_plains"],
	snowy_plains: ["ice_plains", "ice_mountains"],
	ice_spikes: ["ice_plains_spikes"],
	desert: ["desert", "desert_hills", "desert_mutated"],
	swamp: ["swampland", "swampland_mutated"],
	mangrove_swamp: ["mangrove_swamp"],
	forest: ["forest", "forest_hills"],
	flower_forest: ["flower_forest"],
	birch_forest: ["birch_forest", "birch_forest_hills"],
	dark_forest: ["roofed_forest", "roofed_forest_mutated"],
	old_growth_birch_forest: ["birch_forest_mutated", "birch_forest_hills_mutated"],
	old_growth_pine_taiga: ["mega_taiga", "mega_taiga_hills"],
	old_growth_spruce_taiga: ["redwood_taiga_mutated", "redwood_taiga_hills_mutated"],
	taiga: ["taiga", "taiga_hills", "taiga_mutated"],
	snowy_taiga: ["cold_taiga", "cold_taiga_hills", "cold_taiga_mutated"],
	savanna: ["savanna"],
	savanna_plateau: ["savanna_plateau", "savanna_plateau_mutated"],
	windswept_hills: ["extreme_hills", "extreme_hills_edge"],
	windswept_gravelly_hills: ["extreme_hills_mutated"],
	windswept_forest: ["extreme_hills_plus_trees", "extreme_hills_plus_trees_mutated"],
	windswept_savanna: ["savanna_mutated"],
	jungle: ["jungle", "jungle_hills", "jungle_mutated"],
	sparse_jungle: ["jungle_edge", "jungle_edge_mutated"],
	bamboo_jungle: ["bamboo_jungle", "bamboo_jungle_hills"],
	badlands: ["mesa", "mesa_plateau", "mesa_plateau_mutated"],
	eroded_badlands: ["mesa_bryce"],
	wooded_badlands: ["mesa_plateau_stone", "mesa_plateau_stone_mutated"],
	meadow: ["meadow"],
	cherry_grove: ["cherry_grove"],
	pale_garden: ["pale_garden"],
	grove: ["grove"],
	snowy_slopes: ["snowy_slopes"],
	frozen_peaks: ["frozen_peaks"],
	jagged_peaks: ["jagged_peaks"],
	stony_peaks: ["stony_peaks"],
	river: ["river"],
	frozen_river: ["frozen_river"],
	beach: ["beach"],
	snowy_beach: ["cold_beach"],
	stony_shore: ["stone_beach"],
	warm_ocean: ["warm_ocean", "deep_warm_ocean"],
	lukewarm_ocean: ["lukewarm_ocean"],
	deep_lukewarm_ocean: ["deep_lukewarm_ocean"],
	ocean: ["ocean"],
	deep_ocean: ["deep_ocean"],
	cold_ocean: ["cold_ocean"],
	deep_cold_ocean: ["deep_cold_ocean"],
	frozen_ocean: ["frozen_ocean", "legacy_frozen_ocean"],
	deep_frozen_ocean: ["deep_frozen_ocean"],
	mushroom_fields: ["mushroom_island", "mushroom_island_shore"],
	dripstone_caves: ["dripstone_caves"],
	lush_caves: ["lush_caves"],
	deep_dark: ["deep_dark"],
	nether_wastes: ["hell"],
	warped_forest: ["warped_forest"],
	crimson_forest: ["crimson_forest"],
	soul_sand_valley: ["soulsand_valley"],
	basalt_deltas: ["basalt_deltas"],
	the_end: ["the_end"],
	end_highlands: ["the_end"],
	end_midlands: ["the_end"],
	small_end_islands: ["the_end"],
	end_barrens: ["the_end"],
	the_void: [],
};

const OVERWORLD = Object.keys(BIOME_MAP).filter(
	(b) => !["nether_wastes", "warped_forest", "crimson_forest", "soul_sand_valley", "basalt_deltas", "the_end", "end_highlands", "end_midlands", "small_end_islands", "end_barrens", "the_void"].includes(b),
);

/** Tags de bioma vanilla do Java (1.21.1), que não vêm no código do Cobblemon. */
const VANILLA_BIOME_TAGS: Record<string, string[]> = {
	is_ocean: ["deep_frozen_ocean", "deep_cold_ocean", "deep_ocean", "deep_lukewarm_ocean", "frozen_ocean", "ocean", "cold_ocean", "lukewarm_ocean", "warm_ocean"],
	is_deep_ocean: ["deep_frozen_ocean", "deep_cold_ocean", "deep_ocean", "deep_lukewarm_ocean"],
	is_beach: ["beach", "snowy_beach"],
	is_river: ["river", "frozen_river"],
	is_mountain: ["meadow", "frozen_peaks", "jagged_peaks", "stony_peaks", "snowy_slopes", "cherry_grove"],
	is_badlands: ["badlands", "eroded_badlands", "wooded_badlands"],
	is_hill: ["windswept_hills", "windswept_forest", "windswept_gravelly_hills"],
	is_taiga: ["taiga", "snowy_taiga", "old_growth_pine_taiga", "old_growth_spruce_taiga"],
	is_jungle: ["bamboo_jungle", "jungle", "sparse_jungle"],
	is_forest: ["forest", "flower_forest", "birch_forest", "old_growth_birch_forest", "dark_forest", "grove", "pale_garden"],
	is_savanna: ["savanna", "savanna_plateau", "windswept_savanna"],
	// Frente vilas: biomas das variantes de vila (peças de vila viram estruturas próprias, tools/importer/villages.ts).
	"has_structure/village_plains": ["plains", "meadow"],
	"has_structure/village_desert": ["desert"],
	"has_structure/village_savanna": ["savanna"],
	"has_structure/village_snowy": ["snowy_plains"],
	"has_structure/village_taiga": ["taiga"],
	is_overworld: OVERWORLD,
	is_nether: ["nether_wastes", "soul_sand_valley", "crimson_forest", "warped_forest", "basalt_deltas"],
	is_end: ["the_end", "end_highlands", "end_midlands", "small_end_islands", "end_barrens"],
};

/** Tags convencionais (c:*) que o Fabric/NeoForge fornecem e o Cobblemon usa sem trazer o arquivo. */
const CONVENTION_BIOME_TAGS: Record<string, string[]> = {
	is_snowy_plains: ["snowy_plains"],
	is_snowy: ["snowy_plains", "ice_spikes", "snowy_taiga", "snowy_beach", "grove", "snowy_slopes", "jagged_peaks", "frozen_peaks", "frozen_river", "frozen_ocean", "deep_frozen_ocean"],
};

/** Expande tags de bioma (Cobblemon via arquivos; minecraft via tabela) para ids do Bedrock. */
export class BiomeResolver {
	private cache = new Map<string, string[]>();
	unmapped = new Set<string>();

	/** Todas as tags de bioma do Cobblemon (id sem "#"). */
	allCobblemonTags(): string[] {
		const base = `${DATA}/cobblemon/tags/worldgen/biome/`;
		return walk(base, (n) => n.endsWith(".json")).map((f) => `cobblemon:${f.slice(base.length, -5)}`);
	}

	/** "#cobblemon:is_forest" ou "minecraft:plains" → ids do Bedrock (ordenados, sem repetição). */
	resolve(entry: string, stack: string[] = []): string[] {
		if (!entry.startsWith("#")) {
			const { ns, path } = splitId(entry, "minecraft");
			if (ns !== "minecraft") return [];
			const mapped = BIOME_MAP[path];
			if (!mapped) {
				this.unmapped.add(entry);
				return [];
			}
			return mapped;
		}
		const tag = entry.slice(1);
		const cached = this.cache.get(tag);
		if (cached) return cached;
		if (stack.includes(tag)) return [];
		const { ns, path } = splitId(tag, "minecraft");
		let out: string[] = [];
		if (ns === "minecraft" && VANILLA_BIOME_TAGS[path]) {
			out = VANILLA_BIOME_TAGS[path].flatMap((b) => BIOME_MAP[b] ?? []);
		} else if (ns === "c" && CONVENTION_BIOME_TAGS[path] && !existsSync(`${DATA}/c/tags/worldgen/biome/${path}.json`)) {
			out = CONVENTION_BIOME_TAGS[path].flatMap((b) => BIOME_MAP[b] ?? []);
		} else {
			const file = `${DATA}/${ns}/tags/worldgen/biome/${path}.json`;
			if (existsSync(file)) {
				for (const v of readJson(file).values ?? []) {
					const id = typeof v === "string" ? v : v?.id;
					if (typeof id === "string") out.push(...this.resolve(id, [...stack, tag]));
				}
			} else if (ns === "minecraft" || ns === "cobblemon") {
				this.unmapped.add(entry);
			}
		}
		out = [...new Set(out)].sort();
		this.cache.set(tag, out);
		return out;
	}

	resolveList(list: string[]): string[] {
		return [...new Set(list.flatMap((b) => this.resolve(b)))].sort();
	}
}

// ---------------------------------------------------------------------------------------------
// Blocos

/** Id de bloco do Java → Bedrock quando diferem (resto: igual). */
const BLOCK_RENAMES: Record<string, string[]> = {
	lily_pad: ["waterlily"],
	sugar_cane: ["reeds"],
	kelp_plant: ["kelp"],
	kelp: ["kelp"],
	magma_block: ["magma"],
	cobweb: ["web"],
	snow_block: ["snow"],
	snow: ["snow_layer"],
	end_stone_bricks: ["end_bricks"],
	nether_bricks: ["nether_brick"],
	red_nether_bricks: ["red_nether_brick"],
	bricks: ["brick_block"],
	terracotta: ["hardened_clay"],
	powered_rail: ["golden_rail"],
	repeater: ["unpowered_repeater", "powered_repeater"],
	comparator: ["unpowered_comparator", "powered_comparator"],
	redstone_lamp: ["redstone_lamp", "lit_redstone_lamp"],
	redstone_torch: ["redstone_torch", "unlit_redstone_torch"],
	redstone_ore: ["redstone_ore", "lit_redstone_ore"],
	deepslate_redstone_ore: ["deepslate_redstone_ore", "lit_deepslate_redstone_ore"],
	daylight_detector: ["daylight_detector", "daylight_detector_inverted"],
	nether_quartz_ore: ["quartz_ore"],
	jack_o_lantern: ["lit_pumpkin"],
	melon: ["melon_block"],
	slime_block: ["slime"],
	spawner: ["mob_spawner"],
	dirt_path: ["grass_path"],
	note_block: ["noteblock"],
	water: ["water", "flowing_water"],
	lava: ["lava", "flowing_lava"],
	tall_seagrass: ["seagrass"],
	double_smooth_stone_slab: ["smooth_stone_double_slab"],
};

const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
const CORALS = ["tube", "brain", "bubble", "fire", "horn"];

/** Tags de bloco vanilla do Java e convenções "c:" usadas pelas spawns (ids Java). */
const VANILLA_BLOCK_TAGS: Record<string, string[]> = {
	"minecraft:sand": ["sand", "red_sand", "suspicious_sand"],
	"minecraft:leaves": ["oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "cherry_leaves", "pale_oak_leaves", "azalea_leaves", "flowering_azalea_leaves"],
	"minecraft:logs": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log", "crimson_stem", "warped_stem", "oak_wood", "spruce_wood", "birch_wood", "jungle_wood", "acacia_wood", "dark_oak_wood", "mangrove_wood", "cherry_wood"],
	"minecraft:iron_ores": ["iron_ore", "deepslate_iron_ore"],
	"minecraft:coal_ores": ["coal_ore", "deepslate_coal_ore"],
	"minecraft:copper_ores": ["copper_ore", "deepslate_copper_ore"],
	"minecraft:gold_ores": ["gold_ore", "deepslate_gold_ore", "nether_gold_ore"],
	"minecraft:diamond_ores": ["diamond_ore", "deepslate_diamond_ore"],
	"minecraft:emerald_ores": ["emerald_ore", "deepslate_emerald_ore"],
	"minecraft:lapis_ores": ["lapis_ore", "deepslate_lapis_ore"],
	"minecraft:redstone_ores": ["redstone_ore", "deepslate_redstone_ore"],
	"minecraft:beehives": ["bee_nest", "beehive"],
	"minecraft:wool": COLORS.map((c) => `${c}_wool`),
	"minecraft:wool_carpets": COLORS.map((c) => `${c}_carpet`),
	"minecraft:terracotta": ["terracotta", ...COLORS.map((c) => `${c}_terracotta`)],
	"minecraft:lava": ["lava"],
	"minecraft:water": ["water"],
	"minecraft:corals": [...CORALS.map((c) => `${c}_coral`), ...CORALS.map((c) => `${c}_coral_fan`)],
	"minecraft:coral_blocks": CORALS.map((c) => `${c}_coral_block`),
	"minecraft:stone_bricks": ["stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks"],
	"minecraft:dirt": ["dirt", "coarse_dirt", "rooted_dirt", "podzol", "mycelium", "moss_block", "mud", "muddy_mangrove_roots", "grass_block"],
	"minecraft:convertable_to_mud": ["dirt", "coarse_dirt", "rooted_dirt"],
	"minecraft:ice": ["ice", "packed_ice", "blue_ice", "frosted_ice"],
	"minecraft:snow": ["snow", "snow_block", "powder_snow"],
	"minecraft:nylium": ["crimson_nylium", "warped_nylium"],
	"minecraft:base_stone_overworld": ["stone", "granite", "diorite", "andesite", "tuff", "deepslate"],
	"minecraft:base_stone_nether": ["netherrack", "basalt", "blackstone"],
	"minecraft:sculk_replaceable": ["stone", "granite", "diorite", "andesite", "tuff", "deepslate", "calcite", "dirt", "grass_block", "gravel", "sand", "red_sand", "sandstone", "red_sandstone", "netherrack", "soul_sand", "soul_soil", "clay", "mud"],
	"minecraft:trail_ruins_replaceable": ["gravel"],
	"minecraft:animals_spawnable_on": ["grass_block"],
	"minecraft:valid_spawn": ["grass_block", "podzol"],
	"c:sand": ["sand", "red_sand"],
	"c:sands": ["sand", "red_sand"],
	"c:leaves": ["oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "cherry_leaves", "pale_oak_leaves", "azalea_leaves", "flowering_azalea_leaves"],
	"c:logs": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log", "crimson_stem", "warped_stem"],
	"c:redstone_ores": ["redstone_ore", "deepslate_redstone_ore"],
	"c:diamond_ores": ["diamond_ore", "deepslate_diamond_ore"],
	"c:emerald_ores": ["emerald_ore", "deepslate_emerald_ore"],
	"c:coral_blocks": CORALS.map((c) => `${c}_coral_block`),
	"c:dirts": ["dirt", "coarse_dirt", "rooted_dirt", "podzol", "mycelium", "grass_block"],
	"c:end_stones": ["end_stone"],
	"c:gravels": ["gravel"],
	"c:netherracks": ["netherrack"],
	"c:redstone_blocks": ["redstone_block"],
	"c:stones": ["stone", "granite", "diorite", "andesite", "tuff", "deepslate"],
};

/** Namespaces cujos blocos existem no pack (Cobblemon escrito à mão). */
const KEPT_NAMESPACES = new Set(["minecraft", "cobblemon"]);

export class BlockResolver {
	unmapped = new Set<string>();

	/** "#minecraft:leaves" | "minecraft:lily_pad" → ids do Bedrock com namespace. */
	resolve(entry: string, stack: string[] = []): string[] {
		if (entry.startsWith("#")) {
			const tag = entry.slice(1);
			if (stack.includes(tag)) return [];
			const { ns, path } = splitId(tag, "minecraft");
			const table = VANILLA_BLOCK_TAGS[`${ns}:${path}`];
			if (table) return table.flatMap((b) => this.resolve(`minecraft:${b}`));
			for (const dir of ["block", "blocks"]) {
				const file = `${DATA}/${ns}/tags/${dir}/${path}.json`;
				if (existsSync(file)) {
					return (readJson(file).values ?? []).flatMap((v: any) => {
						const id = typeof v === "string" ? v : v?.id;
						return typeof id === "string" ? this.resolve(id, [...stack, tag]) : [];
					});
				}
			}
			this.unmapped.add(entry);
			return [];
		}
		const { ns, path } = splitId(entry, "minecraft");
		if (!KEPT_NAMESPACES.has(ns)) return [];
		if (ns === "minecraft") return (BLOCK_RENAMES[path] ?? [path]).map((b) => `minecraft:${b}`);
		return [`${ns}:${path}`];
	}

	resolveList(list: string[]): string[] {
		const out = [...new Set(list.flatMap((b) => this.resolve(b)))];
		if (list.length && !out.length) warn("lista de blocos ficou vazia após conversão", list.join(","));
		return out;
	}
}
