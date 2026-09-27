// Gera generated/scripts/machines.ts (fósseis, materiais orgânicos, temperos, TMs, tags de item e limiares de
// Aprijuice) a partir dos dados do Cobblemon 1.8.2 em upstream/cobblemon. Chamado pelo importador (index.ts);
// scripts/machines/data.ts só reexporta o módulo gerado, para os dados do Cobblemon não serem versionados.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bedrockVanillaItem, ITEM_TAGS as VANILLA_TAGS } from "./vanilla.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data");
const COBBLEMON = join(DATA, "cobblemon");
// O importador escreve numa pasta temporária (troca atômica no fim); ela chega por variável de ambiente.
const GEN = process.env.COBBLEMON_IMPORT_OUT ?? join(ROOT, "generated");
const OUT = join(GEN, "scripts", "machines.ts");

const warnings = new Set();
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? walk(full) : name.endsWith(".json") ? [full] : [];
	});
}

// Ids vanilla que a tabela do importador não cobre (Java → Bedrock); null = não existe no Bedrock.
const EXTRA_RENAMES = {
	"minecraft:dead_bush": "minecraft:deadbush",
	"minecraft:glistening_melon_slice": "minecraft:glistering_melon_slice",
	"minecraft:tall_fern": "minecraft:large_fern",
	"minecraft:dripleaf": "minecraft:big_dripleaf",
	"minecraft:big_dripleaf": "minecraft:big_dripleaf",
	"minecraft:small_dripleaf": "minecraft:small_dripleaf_block",
	"minecraft:rabbits_foot": "minecraft:rabbit_foot",
	"minecraft:frogspawn": "minecraft:frog_spawn",
	"minecraft:flowering_azalea_leaves": "minecraft:azalea_leaves_flowered",
	"minecraft:tall_seagrass": null,
};

/** Id Java → Bedrock (itens do Cobblemon mantêm o id; vanilla passa pela tabela do importador). */
function item(id) {
	if (!id.includes(":")) id = `minecraft:${id}`;
	if (id.startsWith("cobblemon:")) return id;
	if (id in EXTRA_RENAMES) return EXTRA_RENAMES[id] ?? undefined;
	const bedrock = bedrockVanillaItem(id);
	if (!bedrock) warnings.add(`item sem equivalente no Bedrock: ${id}`);
	return bedrock;
}

// Tags vanilla que o importador não lista (Java 1.21.1).
const EXTRA_VANILLA_TAGS = {
	"minecraft:tall_flowers": ["minecraft:sunflower", "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony"],
	"minecraft:flowers": ["#minecraft:small_flowers", "#minecraft:tall_flowers", "minecraft:flowering_azalea_leaves", "minecraft:flowering_azalea", "minecraft:mangrove_propagule", "minecraft:cherry_leaves", "minecraft:pink_petals", "minecraft:chorus_flower", "minecraft:spore_blossom"],
	"minecraft:mushrooms": ["minecraft:red_mushroom", "minecraft:brown_mushroom"],
	"minecraft:wart_blocks": ["minecraft:nether_wart_block", "minecraft:warped_wart_block"],
	"c:dyes": ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"].map((c) => `minecraft:${c}_dye`),
	"c:foods/cooked_fish": ["minecraft:cooked_cod", "minecraft:cooked_salmon"],
	"c:foods/raw_fish": ["minecraft:cod", "minecraft:salmon", "minecraft:tropical_fish", "minecraft:pufferfish"],
	"c:foods/cooked_meat": ["minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:cooked_chicken", "minecraft:cooked_mutton", "minecraft:cooked_rabbit"],
	"minecraft:chicken_food": ["minecraft:wheat_seeds", "minecraft:melon_seeds", "minecraft:pumpkin_seeds", "minecraft:beetroot_seeds", "minecraft:torchflower_seeds", "minecraft:pitcher_pod"],
};

const tagCache = new Map();
/** Membros (ids Bedrock) de uma tag de item, resolvendo tags aninhadas. */
function resolveTag(tag, seen = new Set()) {
	tag = tag.replace(/^#/, "");
	if (tagCache.has(tag)) return tagCache.get(tag);
	if (seen.has(tag)) return [];
	seen.add(tag);
	let values;
	const [ns, path] = tag.split(":");
	if (ns === "cobblemon") {
		try { values = json(join(COBBLEMON, "tags", "item", `${path}.json`)).values; }
		catch { warnings.add(`tag inexistente: ${tag}`); values = []; }
	}
	else if (EXTRA_VANILLA_TAGS[tag]) values = EXTRA_VANILLA_TAGS[tag];
	else if (VANILLA_TAGS[tag]) values = VANILLA_TAGS[tag].items;
	else { warnings.add(`tag vanilla não resolvida: ${tag}`); values = []; }
	const out = new Set();
	for (const v of values) {
		const id = typeof v === "string" ? v : v.id;
		if (!id) continue;
		if (id.startsWith("#")) resolveTag(id, seen).forEach((x) => out.add(x));
		else { const b = item(id); if (b) out.add(b); }
	}
	const list = [...out].sort();
	tagCache.set(tag, list);
	return list;
}

// ---------------------------------------------------------------------------------------------
// Fósseis
const FOSSILS = walk(join(COBBLEMON, "fossils")).map((file) => {
	const data = json(file);
	return { id: `cobblemon:${relative(join(COBBLEMON, "fossils"), file).split(sep).join("/").replace(/\.json$/, "")}`, result: data.result, fossils: data.fossils.map(item).filter(Boolean) };
}).sort((a, b) => a.id.localeCompare(b.id));

// Materiais orgânicos (cobblemon.json e vanilla.json, na ordem do reload do Cobblemon)
const NATURAL_MATERIALS = [];
for (const file of walk(join(COBBLEMON, "natural_materials")).sort()) {
	for (const entry of json(file)) {
		const out = { content: entry.content };
		if (entry.item) { const id = item(entry.item); if (!id) continue; out.item = id; }
		if (entry.tag) out.tag = entry.tag.replace(/^#/, "");
		if (entry.returnItem) { const id = item(entry.returnItem); if (id) out.returnItem = id; }
		NATURAL_MATERIALS.push(out);
	}
}

const bait = (e) => {
	const out = { type: e.type, chance: e.chance ?? 0, value: e.value ?? 0 };
	if (e.subcategory) out.subcategory = e.subcategory;
	return out;
};

// Temperos (as berries entram em tempo de execução a partir de ITEMS[berry].berry.flavours/colour)
const SEASONINGS = {};
for (const file of walk(join(COBBLEMON, "seasonings"))) {
	const data = json(file);
	const ids = data.ingredient.startsWith("#") ? resolveTag(data.ingredient) : [item(data.ingredient)].filter(Boolean);
	const def = { colour: data.colour ?? data.color };
	const flavours = data.flavours ?? data.flavors;
	if (flavours) def.flavours = Object.fromEntries(Object.entries(flavours).map(([k, v]) => [k.toUpperCase(), v]));
	if (data.baitEffects?.length) def.baitEffects = data.baitEffects.map(bait);
	if (data.food) def.food = { hunger: data.food.hunger ?? 0, saturation: data.food.saturation ?? 0 };
	if (data.mobEffects?.length) def.mobEffects = data.mobEffects.map((m) => ({ effect: m.effect.replace(/^minecraft:/, ""), duration: m.duration ?? 0, amplifier: m.amplifier ?? 0 }));
	for (const id of ids) SEASONINGS[id] = def;
}

// TMs
const TECHNICAL_MACHINES = {};
for (const file of walk(join(COBBLEMON, "tms")).sort()) {
	const data = json(file);
	const recipe = (data.recipe ?? []).map((r) => {
		const ref = r.item ?? r.tag;
		if (typeof ref !== "string") return undefined;
		if (r.tag || ref.startsWith("#")) return { tag: ref.replace(/^#/, ""), count: r.count ?? 1 };
		const id = item(ref);
		return id ? { item: id, count: r.count ?? 1 } : undefined;
	});
	if (recipe.some((r) => !r)) warnings.add(`TM com ingrediente sem equivalente: ${data.moveName}`);
	TECHNICAL_MACHINES[data.moveName] = {
		type: data.type,
		default: (data.obtainMethods ?? []).some((m) => m.variant === "cobblemon:default"),
		recipe: recipe.filter(Boolean),
	};
}

// Tags usadas pelas receitas da panela, temperos, materiais orgânicos e TMs
const recipesSrc = readFileSync(join(GEN, "scripts", "recipes.ts"), "utf8");
const usedTags = new Set();
for (const m of recipesSrc.matchAll(/"(?:tag|seasoningTag)":"([^"]+)"/g)) usedTags.add(m[1]);
for (const m of NATURAL_MATERIALS) if (m.tag) usedTags.add(m.tag);
for (const tm of Object.values(TECHNICAL_MACHINES)) for (const r of tm.recipe) if (r.tag) usedTags.add(r.tag);
for (const t of ["cobblemon:fossils", "cobblemon:poke_balls", "cobblemon:recipe_filters/bait_seasoning", "cobblemon:recipe_filters/flavour_seasoning"]) usedTags.add(t);
const ITEM_TAGS = {};
for (const tag of [...usedTags].sort()) ITEM_TAGS[tag] = resolveTag(tag);

const aprijuices = json(join(COBBLEMON, "mechanics", "aprijuices.json"));
const APRIJUICE_FLAVOUR_THRESHOLDS = Object.fromEntries(Object.entries(aprijuices.statPointFlavourThresholds).map(([k, v]) => [Number(k), v]));

const J = (x) => JSON.stringify(x);
const out = `// Arquivo gerado por tools/importer/machinesData.mjs a partir de upstream/cobblemon (Cobblemon 1.8.2). Não edite à mão.
/* eslint-disable */

export interface FossilDef { id: string; result: string; fossils: string[] }
export interface NaturalMaterialDef { content: number; item?: string; tag?: string; returnItem?: string }
export interface BaitEffectDef { type: string; subcategory?: string; chance: number; value: number }
export interface MobEffectDef { effect: string; duration: number; amplifier: number }
export interface SeasoningDef {
	colour: string;
	flavours?: Record<string, number>;
	baitEffects?: BaitEffectDef[];
	food?: { hunger: number; saturation: number };
	mobEffects?: MobEffectDef[];
}
export interface TMIngredientDef { item?: string; tag?: string; count: number }
export interface TMDef { type: string; default: boolean; recipe: TMIngredientDef[] }

/** data/cobblemon/fossils: espécie revivida e itens exigidos. */
export const FOSSILS: FossilDef[] = ${J(FOSSILS)};
/** data/cobblemon/natural_materials: combustível orgânico do restoration tank. */
export const NATURAL_MATERIALS: NaturalMaterialDef[] = ${J(NATURAL_MATERIALS)};
/** data/cobblemon/seasonings (sem as berries, que vêm de ITEMS[berry].berry). */
export const SEASONINGS: Record<string, SeasoningDef> = ${J(SEASONINGS)};
/** data/cobblemon/tms por golpe (id Showdown). */
export const TECHNICAL_MACHINES: Record<string, TMDef> = ${J(TECHNICAL_MACHINES)};
/** Membros (ids Bedrock) das tags de item usadas pelas máquinas. */
export const ITEM_TAGS: Record<string, string[]> = ${J(ITEM_TAGS)};
/** mechanics/aprijuices.json: pontos de atributo de montaria por soma de sabor. */
export const APRIJUICE_FLAVOUR_THRESHOLDS: Record<number, number> = ${J(APRIJUICE_FLAVOUR_THRESHOLDS)};
`;
writeFileSync(OUT, out);
console.log(`generated/scripts/machines.ts: ${FOSSILS.length} fósseis, ${NATURAL_MATERIALS.length} materiais, ${Object.keys(SEASONINGS).length} temperos, ${Object.keys(TECHNICAL_MACHINES).length} TMs, ${Object.keys(ITEM_TAGS).length} tags (${(out.length / 1024).toFixed(1)} KB)`);
for (const w of warnings) console.warn(`aviso: ${w}`);
