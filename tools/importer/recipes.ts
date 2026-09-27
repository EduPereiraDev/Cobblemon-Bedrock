// Receitas do Cobblemon (data/cobblemon/recipe) → receitas do Bedrock.
//   crafting_shaped/shapeless → recipe_shaped/recipe_shapeless (crafting_table)
//   smelting/blasting/smoking/campfire_cooking → recipe_furnace (furnace/blast_furnace/smoker/campfire)
//   stonecutting → recipe_shapeless (stonecutter)
//   smithing_transform → recipe_shapeless na bancada (a mesa de ferraria do Bedrock só aceita bases com a tag
//     minecraft:transformable_items, que a vara de pesca vanilla não tem)
//   cooking_pot*/brewing_stand → dados em generated/scripts/recipes.ts (não há receita nativa equivalente)
// Tags do Java viram tag do Bedrock quando existe equivalente (planks, wool...) ou quando todos os membros
// são itens do Cobblemon com JSON próprio (que recebem a tag); senão a receita é expandida por item.
import { existsSync } from "node:fs";
import { bedrockTagName } from "./items.ts";
import { DATA, OUT_BP, OUT_SCRIPTS, count, readJson, splitId, walk, warn, writeJson, writeText } from "./util.ts";
import { ITEM_TAGS, bedrockVanillaItem } from "./vanilla.ts";

type Option = { item: string } | { tag: string };

export interface RecipeContext {
	/** Itens do Bedrock existentes (custom + blocos). */
	items: Set<string>;
	/** Itens do Cobblemon que têm JSON próprio (podem receber tags). */
	taggable: Set<string>;
}

const RECIPE_FORMAT = "1.20.10";
const UNLOCK = { context: "AlwaysUnlocked" };
const MAX_EXPANSION = 32;

export interface RecipeStats {
	generated: number;
	sources: number;
	skipped: Array<{ recipe: string; reason: string }>;
	scriptCooking: number;
	scriptBrewing: number;
}

function mapItem(id: string, ctx: RecipeContext): string | undefined {
	const { ns } = splitId(id, "minecraft");
	if (ns === "minecraft") return bedrockVanillaItem(id);
	const full = id.includes(":") ? id : `cobblemon:${id}`;
	return ctx.items.has(full) ? full : undefined;
}

/** Membros (ids Java) de uma tag de item: tabelas conhecidas (c:*, minecraft:*) ou arquivos de tag. */
function tagMembers(tag: string, stack: string[] = []): string[] {
	const t = ITEM_TAGS[tag];
	if (t) return t.items;
	const { ns, path } = splitId(tag);
	const file = `${DATA}/${ns}/tags/item/${path}.json`;
	if (!existsSync(file) || stack.includes(tag)) return [];
	return (readJson(file).values ?? []).flatMap((v: any) => {
		const id = typeof v === "string" ? v : v?.id;
		if (typeof id !== "string") return [];
		return id.startsWith("#") ? tagMembers(id.slice(1), [...stack, tag]) : [id];
	});
}

/** Ingrediente do Java → alternativas do Bedrock (vazio = sem equivalente). */
function options(ing: any, ctx: RecipeContext): Option[] {
	if (ing === undefined || ing === null) return [];
	if (Array.isArray(ing)) return dedupe(ing.flatMap((x) => options(x, ctx)));
	if (typeof ing === "string") return ing.startsWith("#") ? options({ tag: ing.slice(1) }, ctx) : options({ item: ing }, ctx);
	if (ing.item) {
		const id = mapItem(ing.item, ctx);
		return id ? [{ item: id }] : [];
	}
	if (ing.tag) {
		const tag = String(ing.tag);
		const known = ITEM_TAGS[tag];
		if (known?.bedrockTag) return [{ tag: known.bedrockTag }];
		const members = tagMembers(tag);
		// Tag só com itens do Cobblemon que recebem tags: usa a tag direto.
		if (tag.startsWith("cobblemon:") && members.length && members.every((m) => ctx.taggable.has(m))) return [{ tag: bedrockTagName(tag) }];
		return dedupe(members.map((m) => mapItem(m, ctx)).filter((x): x is string => !!x).map((item) => ({ item })));
	}
	return [];
}

function dedupe(opts: Option[]): Option[] {
	const seen = new Set<string>();
	return opts.filter((o) => {
		const k = JSON.stringify(o);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

function resultOf(r: any, ctx: RecipeContext): { item: string; count: number } | undefined {
	if (!r) return undefined;
	const id = typeof r === "string" ? r : r.id ?? r.item;
	const item = id ? mapItem(id, ctx) : undefined;
	return item ? { item, count: Number(r.count ?? 1) } : undefined;
}

/** Produto cartesiano das alternativas (limitado). */
function combos<T>(lists: T[][]): T[][] {
	let out: T[][] = [[]];
	for (const l of lists) {
		const next: T[][] = [];
		for (const c of out) for (const x of l) next.push([...c, x]);
		out = next;
		if (out.length > MAX_EXPANSION) return out.slice(0, MAX_EXPANSION);
	}
	return out;
}

function optionName(o: Option): string {
	return ("item" in o ? o.item : o.tag).split(":")[1];
}

export function buildRecipes(ctx: RecipeContext): RecipeStats {
	const base = `${DATA}/cobblemon/recipe/`;
	const stats: RecipeStats = { generated: 0, sources: 0, skipped: [], scriptCooking: 0, scriptBrewing: 0 };
	const cooking: unknown[] = [];
	const brewing: unknown[] = [];
	const usedIds = new Set<string>();
	const emit = (name: string, type: string, body: Record<string, unknown>) => {
		let id = `cobblemon:${name}`;
		let n = 1;
		while (usedIds.has(id)) id = `cobblemon:${name}_${++n}`;
		usedIds.add(id);
		writeJson(`${OUT_BP}/recipes/cobblemon/${id.split(":")[1]}.json`, { format_version: RECIPE_FORMAT, [type]: { description: { identifier: id }, ...body } });
		stats.generated++;
	};
	for (const file of walk(base, (n) => n.endsWith(".json"))) {
		const rel = file.slice(base.length, -5);
		if (rel.startsWith("mod_compatibility/")) continue;
		const r = readJson(file);
		const type = String(r.type ?? "").replace(/^minecraft:/, "");
		const name = rel.replace(/[\/]/g, "_");
		stats.sources++;
		const skip = (reason: string) => {
			stats.skipped.push({ recipe: rel, reason });
			warn("receita não convertida", `${rel}: ${reason}`);
		};
		const result = resultOf(r.result, ctx);
		if (type === "crafting_shaped" || type === "cobblemon:cooking_pot") {
			const keys = Object.entries<any>(r.key ?? {});
			const opts = keys.map(([, v]) => options(v, ctx));
			const missing = keys.filter((_, i) => !opts[i].length).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
			if (type === "cobblemon:cooking_pot") {
				if (!result || missing.length) skip(`ingrediente/resultado sem equivalente ${missing.join(",")}`);
				else {
					cooking.push({ id: rel, shaped: true, pattern: r.pattern, key: Object.fromEntries(keys.map(([k], i) => [k, opts[i]])), result, seasoningTag: r.seasoningTag, seasoningProcessors: r.seasoningProcessors ?? [] });
					stats.scriptCooking++;
				}
				continue;
			}
			if (!result) {
				skip(`resultado sem equivalente ${JSON.stringify(r.result)}`);
				continue;
			}
			if (missing.length) {
				skip(`ingrediente sem equivalente ${missing.join(",")}`);
				continue;
			}
			const all = combos(opts);
			all.forEach((choice, i) => {
				const key = Object.fromEntries(keys.map(([k], j) => [k, choice[j]]));
				const suffix = all.length > 1 ? `_${choice.filter((_, j) => opts[j].length > 1).map(optionName).join("_")}` : "";
				emit(`${name}${suffix}${all.length > 1 && !suffix ? `_${i}` : ""}`, "minecraft:recipe_shaped", { tags: ["crafting_table"], pattern: r.pattern, key, unlock: UNLOCK, result });
			});
		} else if (type === "crafting_shapeless" || type === "cobblemon:cooking_pot_shapeless") {
			const ings: any[] = r.ingredients ?? [];
			const opts = ings.map((x) => options(x, ctx));
			const missing = ings.filter((_, i) => !opts[i].length).map((x) => JSON.stringify(x));
			if (type === "cobblemon:cooking_pot_shapeless") {
				if (!result || missing.length) skip(`ingrediente/resultado sem equivalente ${missing.join(",")}`);
				else {
					cooking.push({ id: rel, shaped: false, ingredients: opts, result, seasoningTag: r.seasoningTag, seasoningProcessors: r.seasoningProcessors ?? [] });
					stats.scriptCooking++;
				}
				continue;
			}
			if (!result || missing.length) {
				skip(`ingrediente/resultado sem equivalente ${missing.join(",")} ${result ? "" : JSON.stringify(r.result)}`);
				continue;
			}
			const all = combos(opts);
			all.forEach((choice, i) => emit(`${name}${all.length > 1 ? `_${i}` : ""}`, "minecraft:recipe_shapeless", { tags: ["crafting_table"], ingredients: choice, unlock: UNLOCK, result }));
		} else if (["smelting", "blasting", "smoking", "campfire_cooking"].includes(type)) {
			const opts = options(r.ingredient, ctx).filter((o): o is { item: string } => "item" in o);
			if (!result || !opts.length) {
				skip(`ingrediente/resultado sem equivalente`);
				continue;
			}
			const tags = type === "smelting" ? ["furnace"] : type === "blasting" ? ["blast_furnace"] : type === "smoking" ? ["smoker"] : ["campfire", "soul_campfire"];
			opts.slice(0, MAX_EXPANSION).forEach((o, i) => emit(`${name}${opts.length > 1 ? `_${i}` : ""}`, "minecraft:recipe_furnace", { tags, input: o.item, output: result.item }));
		} else if (type === "stonecutting") {
			const opts = options(r.ingredient, ctx);
			if (!result || !opts.length) {
				skip(`ingrediente/resultado sem equivalente`);
				continue;
			}
			opts.slice(0, MAX_EXPANSION).forEach((o, i) => emit(`${name}${opts.length > 1 ? `_${i}` : ""}`, "minecraft:recipe_shapeless", { tags: ["stonecutter"], ingredients: [o], unlock: UNLOCK, result }));
		} else if (type === "smithing_transform") {
			const parts = [options(r.template, ctx), options(r.base, ctx), options(r.addition, ctx)];
			if (!result || parts.some((p) => !p.length)) {
				skip(`ingrediente/resultado sem equivalente`);
				continue;
			}
			combos(parts).forEach((choice, i, all) => emit(`${name}${all.length > 1 ? `_${i}` : ""}`, "minecraft:recipe_shapeless", { tags: ["crafting_table"], ingredients: choice, unlock: UNLOCK, result }));
		} else if (type === "cobblemon:brewing_stand") {
			const input = options(r.input, ctx);
			const bottle = options(r.bottle, ctx);
			if (!result || !input.length || !bottle.length) skip("ingrediente/resultado sem equivalente");
			else {
				brewing.push({ id: rel, input, bottle, result });
				stats.scriptBrewing++;
			}
		} else if (type === "smithing_trim") {
			skip("padrões de acabamento (trim) custom não existem no Bedrock");
		} else {
			skip(`tipo sem equivalente: ${type}`);
		}
	}
	emitScriptRecipes(cooking, brewing);
	count("receitas (Bedrock)", stats.generated);
	count("receitas do Cobblemon convertidas/lidas", stats.sources);
	return stats;
}

function emitScriptRecipes(cooking: unknown[], brewing: unknown[]): void {
	writeText(
		`${OUT_SCRIPTS}/recipes.ts`,
		`// Arquivo gerado por tools/importer (npm run import). Não edite à mão.
/* eslint-disable */

/** Alternativa de ingrediente: item do Bedrock ou tag de item. */
export type RecipeOption = { item: string } | { tag: string };

export interface CookingPotRecipe {
	id: string;
	shaped: boolean;
	pattern?: string[];
	key?: Record<string, RecipeOption[]>;
	ingredients?: RecipeOption[][];
	result: { item: string; count: number };
	seasoningTag?: string;
	seasoningProcessors: string[];
}

export interface BrewingRecipe {
	id: string;
	input: RecipeOption[];
	bottle: RecipeOption[];
	result: { item: string; count: number };
}

/** Receitas da panela de fogueira (cobblemon:cooking_pot e cooking_pot_shapeless). */
export const COOKING_POT_RECIPES: CookingPotRecipe[] = ${JSON.stringify(cooking)};

/** Receitas do suporte de poções do Cobblemon (cobblemon:brewing_stand). */
export const BREWING_RECIPES: BrewingRecipe[] = ${JSON.stringify(brewing)};
`,
	);
}

