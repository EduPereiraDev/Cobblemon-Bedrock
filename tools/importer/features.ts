// Worldgen simples do Cobblemon → features + feature_rules do Bedrock (sem APIs experimentais):
//   minérios de pedra evolutiva (inclusive nether e dripstone), núcleo de gemas de tipo, árvores de apricorn
//   (estruturas .mcstructure existentes no BP), árvore de saccharine (tree_feature), mints, ervas e cultivos
//   (revival herb, medicinal leek, big root, hearty grains, galarica) e bosques de berries.
// Os biomas vêm das tags do Cobblemon (has_ore/*, has_feature/*, is_*) resolvidas pelo BiomeResolver e
// viram filtros por tags de bioma do Bedrock (biomeFilter). Estruturas jigsaw, fósseis, ruínas e habitats
// ficam de fora (exigem conversão de NBT/jigsaw).
import { existsSync } from "node:fs";
import type { BiomeResolver, BlockResolver } from "./worldgen.ts";
import { DATA, HAND_BP, OUT_BP, count, readJson, splitId, walk, warn, writeJson } from "./util.ts";
import { biomeFilter } from "./vanilla.ts";

const FEATURE_FORMAT = "1.13.0";

const OVERWORLD_SOIL = ["minecraft:grass_block", "minecraft:dirt", "minecraft:podzol", "minecraft:coarse_dirt", "minecraft:dirt_with_roots", "minecraft:moss_block"];

export interface FeatureStats {
	features: number;
	rules: number;
	skipped: string[];
}

interface Rule {
	id: string;
	feature: string;
	pass: string;
	biomes?: string[];
	iterations: number;
	chance?: number;
	y: unknown;
}

export class FeatureBuilder {
	private stats: FeatureStats = { features: 0, rules: 0, skipped: [] };
	private biomes: BiomeResolver;
	private blocks: BlockResolver;
	/** Blocos do Bedrock gerados (para não referenciar blocos inexistentes). */
	private known: Set<string>;

	constructor(biomes: BiomeResolver, blocks: BlockResolver, known: Set<string>) {
		this.biomes = biomes;
		this.blocks = blocks;
		this.known = known;
	}

	private feature(id: string, type: string, body: Record<string, unknown>): string {
		const full = `cobblemon:${id}`;
		writeJson(`${OUT_BP}/features/cobblemon/${id}.json`, { format_version: FEATURE_FORMAT, [type]: { description: { identifier: full }, ...body } });
		this.stats.features++;
		return full;
	}

	private rule(r: Rule): void {
		const conditions: Record<string, unknown> = { placement_pass: r.pass };
		if (r.biomes) {
			const filter = biomeFilter(r.biomes);
			if (!filter) {
				this.stats.skipped.push(`${r.id}: nenhum bioma do Bedrock`);
				return;
			}
			conditions["minecraft:biome_filter"] = filter;
		}
		const distribution: Record<string, unknown> = {
			iterations: r.iterations,
			coordinate_eval_order: "zyx",
			x: { distribution: "uniform", extent: [0, 16] },
			y: r.y,
			z: { distribution: "uniform", extent: [0, 16] },
		};
		if (r.chance !== undefined && r.chance < 1) distribution.scatter_chance = { numerator: 1, denominator: Math.max(1, Math.round(1 / r.chance)) };
		writeJson(`${OUT_BP}/feature_rules/cobblemon/${r.id}.json`, {
			format_version: FEATURE_FORMAT,
			"minecraft:feature_rules": { description: { identifier: `cobblemon:${r.id}`, places_feature: r.feature }, conditions, distribution },
		});
		this.stats.rules++;
	}

	private tagBiomes(tag: string): string[] {
		return this.biomes.resolve(`#${tag}`);
	}

	private has(id: string): boolean {
		if (!this.known.has(id)) {
			warn("feature usa bloco inexistente (pulada)", id);
			return false;
		}
		return true;
	}

	buildAll(): FeatureStats {
		this.ores();
		this.typeGems();
		this.apricornTrees();
		this.saccharineTree();
		this.plants();
		this.berryGroves();
		count("features", this.stats.features);
		count("feature_rules", this.stats.rules);
		return this.stats;
	}

	// -----------------------------------------------------------------------------------------

	private replaceables(target: any): string[] {
		if (target?.predicate_type?.endsWith("block_match")) return this.blocks.resolve(target.block);
		const tag = String(target?.tag ?? "");
		if (tag === "minecraft:stone_ore_replaceables") return ["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite"];
		if (tag === "minecraft:deepslate_ore_replaceables") return ["minecraft:deepslate", "minecraft:tuff"];
		return this.blocks.resolve(`#${tag}`);
	}

	private ores(): void {
		const placed = `${DATA}/cobblemon/worldgen/placed_feature/ore/`;
		const configured = new Map<string, string>();
		for (const f of walk(placed, (n) => n.endsWith(".json"))) {
			const name = f.slice(placed.length, -5);
			const p = readJson(f);
			const featureRef = splitId(p.feature).path;
			let feature = configured.get(featureRef);
			if (!feature) {
				const cfgFile = `${DATA}/cobblemon/worldgen/configured_feature/${featureRef}.json`;
				if (!existsSync(cfgFile)) continue;
				const cfg = readJson(cfgFile).config;
				const rules = (cfg.targets ?? []).map((t: any) => ({ places_block: String(t.state?.Name), may_replace: this.replaceables(t.target) })).filter((r: any) => this.has(r.places_block) && r.may_replace.length);
				if (!rules.length) continue;
				feature = this.feature(`ore_${featureRef.replace("ore/", "")}`, "minecraft:ore_feature", { count: Number(cfg.size ?? 3), replace_rules: rules });
				configured.set(featureRef, feature);
			}
			// Tag de bioma: <pedra>_<upper|lower>[_rare] → has_ore/ore_<pedra>_<normal|rare>; *_nether / *_dripstone.
			const m = /^(.+)_(upper|lower|nether|dripstone)(_rare)?$/.exec(name);
			if (!m) continue;
			const kind = m[2] === "nether" || m[2] === "dripstone" ? m[2] : m[3] ? "rare" : "normal";
			const biomes = this.tagBiomes(`cobblemon:has_ore/ore_${m[1]}_${kind}`);
			const { iterations, chance, y } = placement(p.placement ?? [], m[2] === "nether" ? "nether" : "overworld");
			this.rule({ id: `ore_${name}`, feature, pass: "underground_pass", biomes, iterations, chance, y });
		}
	}

	private typeGems(): void {
		if (!this.has("cobblemon:deepslate_crystal_core")) return;
		const f = this.feature("type_gem_core", "minecraft:ore_feature", { count: 1, replace_rules: [{ places_block: "cobblemon:deepslate_crystal_core", may_replace: ["minecraft:deepslate", "minecraft:tuff"] }] });
		this.rule({ id: "type_gems", feature: f, pass: "underground_pass", biomes: this.tagBiomes("minecraft:is_overworld"), iterations: 2, chance: 1 / 3, y: { distribution: "triangle", extent: [-64, 0] } });
	}

	private apricornTrees(): void {
		const colors = ["black", "blue", "green", "pink", "red", "white", "yellow"];
		const members: Array<[string, number]> = [];
		for (const c of colors) {
			if (!existsSync(`${HAND_BP}/structures/cobblemon/${c}_apricorn_tree.mcstructure`)) {
				warn("estrutura de árvore de apricorn ausente", c);
				continue;
			}
			members.push([
				this.feature(`${c}_apricorn_tree`, "minecraft:structure_template_feature", {
					structure_name: `cobblemon:${c}_apricorn_tree`,
					adjustment_radius: 4,
					facing_direction: "random",
					constraints: { grounded: {}, unburied: {}, block_intersection: { block_allowlist: ["minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern"] } },
				}),
				1,
			]);
		}
		if (!members.length) return;
		const f = this.feature("apricorn_trees", "minecraft:weighted_random_feature", { features: members });
		// Cobblemon: raridade 1/8 × multiplicador da densidade (0.1 esparso, 1 normal, 10 denso) × 0.1.
		for (const [density, chance] of [["dense", 1 / 8], ["normal", 1 / 80], ["sparse", 1 / 800]] as const) {
			const biomes = this.tagBiomes(`cobblemon:has_feature/apricorns_${density}`);
			this.rule({ id: `apricorn_trees_${density}`, feature: f, pass: "surface_pass", biomes, iterations: 1, chance, y: "q.heightmap(v.worldx, v.worldz)" });
		}
	}

	private saccharineTree(): void {
		if (!this.has("cobblemon:saccharine_log") || !this.has("cobblemon:saccharine_leaves")) return;
		const f = this.feature("saccharine_tree", "minecraft:tree_feature", {
			trunk: { trunk_height: { range_min: 5, range_max: 7 }, trunk_block: "cobblemon:saccharine_log" },
			canopy: {
				canopy_offset: { min: -3, max: 0 },
				variation_chance: [{ numerator: 1, denominator: 2 }, { numerator: 1, denominator: 2 }, { numerator: 1, denominator: 2 }, { numerator: 1, denominator: 1 }],
				leaf_block: "cobblemon:saccharine_leaves",
			},
			base_block: ["minecraft:dirt"],
			may_grow_on: OVERWORLD_SOIL,
			may_replace: ["minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "cobblemon:saccharine_leaves"],
			may_grow_through: ["minecraft:dirt", "minecraft:grass_block", "minecraft:short_grass"],
		});
		this.rule({ id: "saccharine_tree", feature: f, pass: "surface_pass", biomes: this.tagBiomes("cobblemon:has_feature/saccharine_tree"), iterations: 1, chance: 1 / 51, y: "q.heightmap(v.worldx, v.worldz)" });
	}

	/** Uma planta num bloco; "patch" espalha várias tentativas em volta (random_patch do Java). */
	private plant(id: string, block: string, states: Record<string, unknown>, opts: { attach?: Record<string, string[]>; patch?: number; spread?: number }): string | undefined {
		if (!this.has(block)) return undefined;
		const single = this.feature(`${id}_block`, "minecraft:single_block_feature", {
			places_block: { name: block, states },
			enforce_placement_rules: !opts.attach,
			enforce_survivability_rules: false,
			may_replace: ["minecraft:air", "minecraft:short_grass"],
			...(opts.attach ? { may_attach_to: { min_sides_must_attach: 1, ...opts.attach } } : {}),
		});
		if (!opts.patch) return single;
		const s = opts.spread ?? 4;
		return this.feature(`${id}_patch`, "minecraft:scatter_feature", {
			places_feature: single,
			iterations: opts.patch,
			project_input_to_floor: true,
			coordinate_eval_order: "xzy",
			x: { distribution: "uniform", extent: [-s, s] },
			y: 0,
			z: { distribution: "uniform", extent: [-s, s] },
		});
	}

	private plants(): void {
		const surface = "q.heightmap(v.worldx, v.worldz)";
		const overworldLand = this.tagBiomes("minecraft:is_overworld").filter((b) => !/ocean|river|beach|deep_dark|caves/.test(b));
		// Mints (Java: acima de y=70, mais comuns quanto mais alto; aqui sem filtro de altitude).
		for (const color of ["red", "blue", "cyan", "pink", "green", "white"]) {
			const f = this.plant(`${color}_mint`, `cobblemon:${color}_mint`, { "cobblemon:age": 7 }, {});
			if (f) this.rule({ id: `${color}_mint`, feature: f, pass: "surface_pass", biomes: overworldLand, iterations: 1, chance: 1 / 240, y: surface });
		}
		const revival = this.plant("revival_herb", "cobblemon:revival_herb", { "cobblemon:age": 8 }, { patch: 5 });
		if (revival) this.rule({ id: "revival_herb", feature: revival, pass: "surface_pass", biomes: this.tagBiomes("cobblemon:has_feature/revival_herbs"), iterations: 2, y: surface });
		const noLeek = new Set([...this.tagBiomes("cobblemon:is_freezing"), ...this.tagBiomes("cobblemon:is_coast"), ...this.tagBiomes("cobblemon:is_ocean")]);
		const leek = this.plant("medicinal_leek", "cobblemon:medicinal_leek", { "cobblemon:age": 2 }, { attach: { bottom: ["minecraft:water"] }, patch: 20 });
		if (leek) this.rule({ id: "medicinal_leek", feature: leek, pass: "surface_pass", biomes: this.tagBiomes("minecraft:is_overworld").filter((b) => !noLeek.has(b)), iterations: 2, chance: 1 / 4, y: surface });
		const root = this.plant("big_root", "cobblemon:big_root", {}, { attach: { top: ["minecraft:dirt", "minecraft:grass_block", "minecraft:dirt_with_roots", "minecraft:coarse_dirt", "minecraft:podzol"] } });
		if (root) this.rule({ id: "big_root", feature: root, pass: "underground_pass", biomes: this.tagBiomes("minecraft:is_overworld"), iterations: 16, y: { distribution: "uniform", extent: [40, 120] } });
		const grains = this.plant("hearty_grains", "cobblemon:hearty_grains", { "cobblemon:age": 6, "cobblemon:half": "lower" }, { attach: { bottom: ["minecraft:dirt", "minecraft:grass_block", "minecraft:mud", "minecraft:sand"] }, patch: 20, spread: 3 });
		if (grains) {
			this.rule({ id: "plains_grains", feature: grains, pass: "surface_pass", biomes: this.tagBiomes("cobblemon:is_plains"), iterations: 1, chance: 1 / 7, y: surface });
			this.rule({ id: "swamp_grains", feature: grains, pass: "surface_pass", biomes: this.tagBiomes("cobblemon:is_swamp"), iterations: 1, chance: 1 / 8, y: surface });
		}
		const galarica = this.plant("galarica_nuts", "cobblemon:galarica_nut_bush", { "cobblemon:age": 3 }, { attach: { bottom: ["minecraft:sand", "minecraft:grass_block", "minecraft:dirt"] }, patch: 20, spread: 5 });
		if (galarica) this.rule({ id: "galarica_nuts", feature: galarica, pass: "surface_pass", biomes: this.tagBiomes("cobblemon:is_beach"), iterations: 1, chance: 1 / 6, y: surface });
	}

	private berryGroves(): void {
		const base = `${DATA}/cobblemon/berries/`;
		const berries = walk(base, (n) => n.endsWith(".json")).map((f) => ({ id: f.slice(base.length, -5), data: readJson(f) }));
		const total = berries.reduce((s, b) => s + (b.data.spawnConditions?.length ? Number(b.data.weight ?? 0) : 0), 0) || 1;
		const overworld = this.tagBiomes("minecraft:is_overworld").filter((b) => !/ocean|river|deep_dark|caves/.test(b));
		for (const { id, data } of berries) {
			const cond = data.spawnConditions?.[0];
			if (!cond || !data.weight) continue;
			let biomes: string[];
			if (cond.variant === "cobblemon:all_biome") biomes = overworld;
			else if (cond.variant === "cobblemon:preferred_biome") biomes = [...new Set<string>((data.preferredBiomeTags ?? []).flatMap((t: string) => this.biomes.resolve(t.startsWith("#") ? t : `#${t}`)))];
			else if (cond.variant === "cobblemon:specific_biome") biomes = this.biomes.resolve(String(cond.biome).startsWith("#") ? cond.biome : `#${cond.biome}`);
			else continue;
			if (!biomes.length) {
				this.stats.skipped.push(`bosque de ${id}: sem biomas no Bedrock`);
				continue;
			}
			const f = this.plant(`berry_grove_${id}`, `cobblemon:${id}`, { "cobblemon:age": 5 }, { patch: Number(cond.maxGroveSize ?? 3) * 2, spread: 3 });
			if (!f) continue;
			// Java: 1 bosque a cada 25 chunks, berry escolhida pelo peso entre as possíveis.
			this.rule({ id: `berry_grove_${id}`, feature: f, pass: "surface_pass", biomes, iterations: 1, chance: (1 / 25) * (Number(data.weight) / total) * 10, y: "q.heightmap(v.worldx, v.worldz)" });
		}
	}
}

/** Placement do Java (count, rarity_filter, height_range) → iterações, chance e distribuição de y. */
function placement(list: any[], dim: "overworld" | "nether"): { iterations: number; chance?: number; y: unknown } {
	let iterations = 1;
	let chance: number | undefined;
	let y: unknown = { distribution: "uniform", extent: [-64, 320] };
	const bottom = dim === "nether" ? 0 : -64;
	const top = dim === "nether" ? 128 : 320;
	const anchor = (a: any) => (a?.absolute !== undefined ? Number(a.absolute) : a?.above_bottom !== undefined ? bottom + Number(a.above_bottom) : a?.below_top !== undefined ? top - 1 - Number(a.below_top) : 0);
	for (const p of list) {
		const type = String(p.type ?? "").replace(/^minecraft:/, "");
		if (type === "count") iterations = typeof p.count === "number" ? p.count : Number(p.count?.max_inclusive ?? 1);
		else if (type === "rarity_filter") chance = 1 / Number(p.chance ?? 1);
		else if (type === "height_range") {
			const h = p.height ?? {};
			const min = anchor(h.min_inclusive);
			const max = anchor(h.max_inclusive);
			y = { distribution: String(h.type ?? "").endsWith("trapezoid") ? "triangle" : "uniform", extent: [Math.max(bottom, min), Math.min(top, max)] };
		}
	}
	return { iterations, chance, y };
}
