// Conquistas (advancements) do Cobblemon 1.8.2 → generated/scripts/advancements.ts (frente ui-base).
//
// O Bedrock não deixa add-ons criarem conquistas nativas; o port rastreia por script (scripts/ui/achievements) os 61
// advancements que não são de receita (data/cobblemon/advancement/{root,catching,agriculture,geological,battle}).
// Aqui cada critério do Java é normalizado num formato pequeno que o script sabe avaliar:
//   inventory (inventory_changed, tags expandidas), pokemon_interact, aspects, catch, evolve, party, trade,
//   battles_won, level_up, started_riding, riding_stat_boost, placed_block, item_used_on_block, block_use,
//   entity_interact, learn_tm, learn_all_tm, resurrect, pick_starter, pasture_use, reel_in, plant_tumblestone,
//   plant_type_gem.
// Os 743 advancements de receita (desbloqueio do livro de receitas) ficam de fora.
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { DATA, HAND_RP, OUT_BP, OUT_RP, OUT_SCRIPTS, count, readJson, tryReadJson, walk, warn, writeText } from "./util.ts";
import { bedrockVanillaItem } from "./vanilla.ts";

type Criterion = { t: string; [key: string]: unknown };

export interface AdvancementOut {
	id: string;
	tab: string;
	parent?: string;
	icon: string;
	frame: "task" | "goal" | "challenge";
	hidden: boolean;
	toast: boolean;
	announce: boolean;
	title: string;
	description: string;
	criteria: Record<string, Criterion>;
	requirements: string[][];
}

const ADV_DIR = `${DATA}/cobblemon/advancement`;

/** Blocos do Java cujo id muda no Bedrock (só os que aparecem nos critérios). */
const BLOCK_RENAMES: Record<string, string> = { "minecraft:note_block": "minecraft:noteblock" };
/** Ícones de itens vanilla (caminho no pack vanilla do Bedrock). */
const VANILLA_ICONS: Record<string, string> = {
	"minecraft:shears": "items/shears",
	"minecraft:note_block": "blocks/noteblock",
	// Frente msd-beta: ícones vanilla de conquistas de pacotes de extensão (antes caíam na Poké Ball).
	"minecraft:glowstone_dust": "items/glowstone_dust",
	"minecraft:iron_pickaxe": "items/iron_pickaxe",
	"minecraft:spyglass": "items/spyglass",
};

const stripNs = (id: string) => (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);
const withNs = (id: string, ns = "cobblemon") => (id.includes(":") ? id : `${ns}:${id}`);

/** Expande tags de item (#ns:path) recursivamente a partir de data/<ns>/tags/item/<path>.json. */
class ItemTags {
	private cache = new Map<string, string[]>();
	expand(value: string, seen = new Set<string>()): string[] {
		if (!value.startsWith("#")) return [withNs(value, "minecraft")];
		const tag = withNs(value.slice(1), "minecraft");
		const cached = this.cache.get(tag);
		if (cached) return cached;
		if (seen.has(tag)) return [];
		seen.add(tag);
		const [ns, path] = tag.split(":");
		const file = [`${DATA}/${ns}/tags/item/${path}.json`, `${DATA}/${ns}/tags/items/${path}.json`].find(existsSync);
		if (!file) {
			warn("tag de item de advancement não encontrada", tag);
			return [];
		}
		const out: string[] = [];
		for (const raw of readJson(file).values ?? []) {
			const entry = typeof raw === "string" ? raw : raw?.id;
			if (typeof entry === "string") out.push(...this.expand(entry, seen));
		}
		const unique = [...new Set(out)];
		this.cache.set(tag, unique);
		return unique;
	}
}

/** Id Java de item → id Bedrock (itens do Cobblemon mantêm o id). */
function bedrockItem(id: string): string {
	if (id.startsWith("cobblemon:")) return id;
	return bedrockVanillaItem(id) ?? id;
}

function asList(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
	return [];
}

/** Coleta, dentro de condições de loot (all_of/any_of), os itens de match_tool e os blocos de block_state_property. */
function collectLocation(terms: unknown, out: { items: string[]; blocks: string[]; state?: Record<string, string>; below?: string; above?: string }) {
	for (const term of Array.isArray(terms) ? terms : [terms]) {
		if (!term || typeof term !== "object") continue;
		const t = term as Record<string, any>;
		switch (t.condition) {
			case "minecraft:all_of":
			case "minecraft:any_of":
				collectLocation(t.terms, out);
				break;
			case "minecraft:match_tool":
				out.items.push(...asList(t.predicate?.items));
				break;
			case "minecraft:block_state_property":
				if (typeof t.block === "string") out.blocks.push(t.block);
				break;
			case "minecraft:location_check": {
				const blocks = asList(t.predicate?.block?.blocks);
				if (t.offsetY === -1) out.below = blocks[0];
				else if (t.offsetY === 1) out.above = blocks[0];
				else {
					out.blocks.push(...blocks);
					if (t.predicate?.block?.state) out.state = t.predicate.block.state;
				}
				break;
			}
		}
	}
}

function normalize(id: string, name: string, raw: any, tags: ItemTags): Criterion | undefined {
	const trigger = String(raw?.trigger ?? "");
	const c = raw?.conditions ?? {};
	switch (trigger) {
		case "minecraft:inventory_changed": {
			const items: string[] = [];
			let tm: string | undefined;
			for (const pred of c.items ?? []) {
				for (const item of asList(pred?.items)) items.push(...tags.expand(item).map(bedrockItem));
				const move = pred?.components?.["cobblemon:tm_move"]?.move;
				if (typeof move === "string") tm = move;
			}
			return tm ? { t: "inventory", items: [...new Set(items)], tm } : { t: "inventory", items: [...new Set(items)] };
		}
		case "cobblemon:pokemon_interact":
			return { t: "pokemon_interact", item: withNs(String(c.item ?? "any")), species: c.species ? stripNs(String(c.species)) : "any" };
		case "cobblemon:aspects_collected":
			return { t: "aspects", species: stripNs(String(c.species ?? "")), aspects: asList(c.aspects) };
		case "cobblemon:catch_pokemon":
			return { t: "catch", kind: "any", type: String(c.type ?? "any"), count: Number(c.count ?? 0) };
		case "cobblemon:catch_shiny_pokemon":
			return { t: "catch", kind: "shiny", count: Number(c.count ?? 0) };
		case "cobblemon:catch_alpha_pokemon":
			return { t: "catch", kind: "alpha", count: Number(c.count ?? 0) };
		case "cobblemon:pokemon_evolved":
			return {
				t: "evolve", species: c.species === "any" || !c.species ? "any" : stripNs(String(c.species)),
				evolution: c.evolution === "any" || !c.evolution ? "any" : stripNs(String(c.evolution)), count: Number(c.times ?? c.count ?? 0),
			};
		case "cobblemon:party":
			return { t: "party", party: asList(c.party).map(stripNs) };
		case "cobblemon:trade_pokemon":
			return {
				t: "trade", traded: c.traded && c.traded !== "any" ? stripNs(String(c.traded)) : "any",
				received: c.received && c.received !== "any" ? stripNs(String(c.received)) : "any",
			};
		case "cobblemon:battles_won":
			return { t: "battles_won", types: asList(c.battle_types), count: Number(c.count ?? 0) };
		case "cobblemon:level_up":
			return { t: "level_up", level: Number(c.level ?? 0), evolved: c.has_evolved !== false };
		case "minecraft:started_riding":
			return { t: "started_riding" };
		case "cobblemon:riding_stat_boost":
			return { t: "riding_stat_boost", stat: String(c.ride_stat ?? "any"), isMax: c.is_max === true, requiresOwner: c.requires_owner !== false };
		case "minecraft:placed_block": {
			const loc = { items: [] as string[], blocks: [] as string[] } as Parameters<typeof collectLocation>[1];
			collectLocation(c.location, loc);
			const out: Criterion = { t: "placed_block", blocks: loc.blocks.map(b => BLOCK_RENAMES[b] ?? b) };
			if (loc.below) out.below = BLOCK_RENAMES[loc.below] ?? loc.below;
			if (loc.above) out.above = BLOCK_RENAMES[loc.above] ?? loc.above;
			return out;
		}
		case "minecraft:item_used_on_block": {
			const loc = { items: [] as string[], blocks: [] as string[] } as Parameters<typeof collectLocation>[1];
			collectLocation(c.location, loc);
			return { t: "item_used_on_block", items: loc.items.flatMap(i => tags.expand(i)).map(bedrockItem), blocks: loc.blocks.map(b => BLOCK_RENAMES[b] ?? b) };
		}
		case "minecraft:any_block_use": {
			const loc = { items: [] as string[], blocks: [] as string[] } as Parameters<typeof collectLocation>[1];
			collectLocation(c.location, loc);
			return loc.state ? { t: "block_use", blocks: loc.blocks, state: loc.state } : { t: "block_use", blocks: loc.blocks };
		}
		case "minecraft:player_interacted_with_entity":
			return { t: "entity_interact", items: asList(c.item?.items).flatMap(i => tags.expand(i)).map(bedrockItem), pokemon: true };
		case "cobblemon:has_learn_specific_tm":
			return { t: "learn_tm", tm: stripNs(String(c.tm ?? "any")) };
		case "cobblemon:has_learn_all_tm":
			return { t: "learn_all_tm" };
		case "cobblemon:resurrect_pokemon":
			return { t: "resurrect", species: c.species && c.species !== "any" ? stripNs(String(c.species)) : "any" };
		case "cobblemon:pick_starter":
			return { t: "pick_starter" };
		case "cobblemon:pasture_use":
			return { t: "pasture_use" };
		case "cobblemon:reel_in_pokemon":
			return { t: "reel_in", bait: withNs(String(c.baitId ?? "any")), species: c.species && c.species !== "any" ? stripNs(String(c.species)) : "any" };
		case "cobblemon:plant_tumblestone":
			return { t: "plant_tumblestone" };
		case "cobblemon:plant_type_gem":
			return { t: "plant_type_gem" };
	}
	warn("critério de advancement sem conversão", `${id}#${name}: ${trigger}`);
	return undefined;
}

/** Ícone: textura do item no RP gerado (via minecraft:icon do item do BP), sprite da espécie ou ícone vanilla. */
export class IconResolver {
	private itemIcons = new Map<string, string>();
	private itemTextures: Record<string, any> = {};
	private terrain: Record<string, any> = {};
	constructor() {
		this.itemTextures = tryReadJson(`${OUT_RP}/textures/item_texture.json`)?.texture_data ?? {};
		this.terrain = tryReadJson(`${OUT_RP}/textures/terrain_texture.json`)?.texture_data ?? {};
		for (const file of walk(`${OUT_BP}/items`, n => n.endsWith(".json"))) {
			const item = tryReadJson(file)?.["minecraft:item"];
			const identifier = item?.description?.identifier;
			const icon = item?.components?.["minecraft:icon"];
			const key = typeof icon === "string" ? icon : icon?.textures?.default ?? icon?.texture;
			if (typeof identifier === "string" && typeof key === "string") this.itemIcons.set(identifier, key);
		}
	}
	private textureOf(key: string): string | undefined {
		const entry = this.itemTextures[key]?.textures;
		const path = Array.isArray(entry) ? entry[0] : entry;
		return typeof path === "string" ? path : undefined;
	}
	private fileExists(path: string): boolean {
		return [OUT_RP, HAND_RP].some(root => existsSync(`${root}/${path}.png`));
	}
	resolve(icon: any): string {
		const id = String(icon?.id ?? icon?.item ?? "");
		if (id === "cobblemon:pokemon_model") {
			const species = stripNs(String(icon?.components?.["cobblemon:pokemon_item"]?.species ?? "rattata"));
			return `textures/sprites/${species}`;
		}
		if (VANILLA_ICONS[id]) return `textures/${VANILLA_ICONS[id]}`;
		const key = this.itemIcons.get(id) ?? stripNs(id);
		const texture = this.textureOf(key);
		if (texture) return texture;
		for (const candidate of [`textures/item/${stripNs(id)}`, `textures/items/${stripNs(id)}`, `textures/block/${stripNs(id)}`]) {
			if (this.fileExists(candidate)) return candidate;
		}
		// Bloco simples (textura de face, não de modelo): frente ou a própria textura fora de "functional".
		const path = stripNs(id);
		const terrainKey = Object.keys(this.terrain).find(k => k.endsWith(`_${path}_front`))
			?? Object.keys(this.terrain).find(k => k.endsWith(`_${path}`) && !k.includes("_functional_"));
		const terrainTexture = terrainKey ? this.terrain[terrainKey]?.textures : undefined;
		if (typeof terrainTexture === "string") return terrainTexture;
		warn("ícone de advancement sem textura (usando a Poké Ball)", id);
		return this.textureOf("poke_ball") ?? "textures/item/poke_balls/poke_ball";
	}
}

export function emitAdvancements(): AdvancementOut[] {
	const tags = new ItemTags();
	const icons = new IconResolver();
	const out: AdvancementOut[] = [];
	for (const file of walk(ADV_DIR, n => n.endsWith(".json")).sort()) {
		const rel = relative(ADV_DIR, file).split("\\").join("/").replace(/\.json$/, "");
		if (rel.startsWith("recipes/")) continue;
		const raw = readJson(file);
		const display = raw.display ?? {};
		const criteria: Record<string, Criterion> = {};
		for (const [name, crit] of Object.entries<any>(raw.criteria ?? {})) {
			const normalized = normalize(rel, name, crit, tags);
			if (normalized) criteria[name] = normalized;
		}
		const requirements: string[][] = Array.isArray(raw.requirements) && raw.requirements.length
			? raw.requirements.map((group: unknown) => asList(group))
			: Object.keys(raw.criteria ?? {}).map(name => [name]);
		const name = rel.split("/").pop()!;
		out.push({
			id: rel,
			tab: rel.includes("/") ? rel.split("/")[0] : "root",
			parent: typeof raw.parent === "string" ? stripNs(raw.parent) : undefined,
			icon: icons.resolve(display.icon),
			frame: display.frame === "goal" || display.frame === "challenge" ? display.frame : "task",
			hidden: display.hidden === true,
			toast: display.show_toast !== false,
			announce: display.announce_to_chat !== false,
			title: String(display.title?.translate ?? `advancements.cobblemon.${name}`),
			description: String(display.description?.translate ?? `advancements.cobblemon.${name}.description`),
			criteria,
			requirements,
		});
	}
	writeText(
		`${OUT_SCRIPTS}/advancements.ts`,
		`// Arquivo gerado por tools/importer/advancements.ts (npm run import). Não edite à mão.
/* eslint-disable */

/** Critério normalizado (ver tools/importer/advancements.ts). */
export interface AdvancementCriterion {
	t: string;
	[key: string]: unknown;
}

/** Advancement do Cobblemon 1.8.2 (data/cobblemon/advancement, sem os de receita). */
export interface AdvancementDef {
	/** Caminho sem namespace ("catching/first_catch"). */
	id: string;
	/** Pasta (catching, agriculture, geological, battle) ou "root". */
	tab: string;
	parent?: string;
	/** Textura do ícone (com "textures/"). */
	icon: string;
	frame: "task" | "goal" | "challenge";
	hidden: boolean;
	/** display.show_toast */
	toast: boolean;
	/** display.announce_to_chat */
	announce: boolean;
	title: string;
	description: string;
	criteria: Record<string, AdvancementCriterion>;
	/** E de OUs: cada grupo precisa de pelo menos um critério cumprido. */
	requirements: string[][];
}

export const ADVANCEMENTS: AdvancementDef[] = ${JSON.stringify(out, null, "\t")};
`,
	);
	count("advancements (não receita)", out.length);
	return out;
}
