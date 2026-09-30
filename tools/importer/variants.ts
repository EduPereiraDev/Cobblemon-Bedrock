// Resolvers do Cobblemon (bedrock/pokemon/resolvers) → variações ordenadas e combinações
// modelo+textura+camadas, com a mesma semântica do VaryingRenderableResolver do Cobblemon:
//  - arquivos da mesma espécie são ordenados por `order` (sort estável sobre a ordem por caminho);
//  - poser/modelo/textura: vale a ÚLTIMA variação compatível que define o campo;
//  - camadas: mescladas por nome na ordem das variações (a posterior substitui a anterior, mantendo a posição).
import { basename } from "node:path";
import { BEDROCK_POKEMON, DATA, readJson, splitId, walk, warn } from "./util.ts";

export interface Layer {
	name: string;
	texture?: string;
	emissive?: boolean;
	translucent?: boolean;
	/** Frente dados-ia: camada que rola a textura (ModelLayer.scrolling, 1.8.0: {speedU, speedV} por segundo). */
	scrolling?: { speedU: number; speedV: number };
}

export interface Variation {
	aspects: string[];
	poser?: string;
	model?: string;
	texture?: string;
	layers?: Layer[];
}

export interface Combo {
	poser: string;
	model: string;
	texture: string;
	layers: Layer[];
}

/** Carrega todos os resolvers, agrupados por id de espécie (sem namespace). */
export function loadResolvers(): Map<string, Variation[]> {
	const sets = new Map<string, Array<{ order: number; variations: Variation[] }>>();
	for (const file of walk(`${BEDROCK_POKEMON}/resolvers`, (n) => n.endsWith(".json"))) {
		const json = readJson(file);
		const name = splitId(json.species ?? json.name ?? json.pokeball ?? "cobblemon:thing").path;
		const list = sets.get(name) ?? [];
		list.push({ order: json.order ?? 0, variations: (json.variations ?? []).map((v: any) => normalizeVariation(v, file)) });
		sets.set(name, list);
	}
	const out = new Map<string, Variation[]>();
	for (const [name, list] of sets) {
		// Array.prototype.sort é estável: empates mantêm a ordem por caminho, como o sortedBy do Kotlin.
		out.set(name, list.sort((a, b) => a.order - b.order).flatMap((s) => s.variations));
	}
	return out;
}

function textureOf(t: any, where: string): string | undefined {
	if (t === undefined || t === null) return undefined;
	if (typeof t === "string") {
		if (t === "variable") {
			warn("textura 'variable' ignorada", where);
			return undefined;
		}
		return t;
	}
	if (typeof t === "object" && Array.isArray(t.frames) && t.frames.length) {
		warn("textura animada reduzida ao primeiro quadro", where);
		return t.frames[0];
	}
	return undefined;
}

function normalizeVariation(v: any, file: string): Variation {
	const where = basename(file);
	if (v.condition !== undefined) warn("condição Molang em variação ignorada", where);
	const out: Variation = { aspects: [...new Set<string>(v.aspects ?? [])] };
	if (v.poser) out.poser = v.poser;
	if (v.model) out.model = v.model;
	const tex = textureOf(v.texture, where);
	if (tex) out.texture = tex;
	if (Array.isArray(v.layers)) {
		out.layers = v.layers
			.filter((l: any) => l.enabled !== false)
			.map((l: any) => {
				const layer: Layer = { name: l.name ?? "" };
				const lt = textureOf(l.texture, where);
				if (lt) layer.texture = lt;
				if (l.emissive) layer.emissive = true;
				if (l.translucent || l.translucent_cull) layer.translucent = true;
				if (l.scrolling && typeof l.scrolling === "object") {
					const speedU = Number(l.scrolling.speedU ?? 0) || 0;
					const speedV = Number(l.scrolling.speedV ?? 0) || 0;
					if (speedU || speedV) layer.scrolling = { speedU, speedV };
				}
				return layer;
			});
	}
	return out;
}

/** Aplica a semântica do Cobblemon para um conjunto de aspects. */
export function resolveCombo(variations: Variation[], aspects: Iterable<string>): Partial<Combo> & { layers: Layer[] } {
	const set = new Set(aspects);
	let poser: string | undefined;
	let model: string | undefined;
	let texture: string | undefined;
	const layers = new Map<string, Layer>();
	for (const v of variations) {
		if (!v.aspects.every((a) => set.has(a))) continue;
		if (v.poser) poser = v.poser;
		if (v.model) model = v.model;
		if (v.texture) texture = v.texture;
		if (v.layers) for (const l of v.layers) layers.set(l.name, l);
	}
	return { poser, model, texture, layers: [...layers.values()].filter((l) => l.texture) };
}

export function layerKey(l: Layer): string {
	return `${l.name}=${l.texture}${l.scrolling ? `~${l.scrolling.speedU},${l.scrolling.speedV}` : ""}`;
}

export function comboKey(c: { poser?: string; model?: string; texture?: string; layers: Layer[] }): string {
	return `${c.poser}|${c.model}|${c.texture}|${c.layers.map(layerKey).join(",")}`;
}

// ---------------------------------------------------------------------------------------------
// Grupos de aspects mutuamente exclusivos, para enumerar as combinações possíveis sem explosão.

export interface FeatureDefs {
	/** aspect → grupo exclusivo (ex.: "cosmetic_item-stick" → "feature:cosmetic_item"). */
	aspectGroup: Map<string, string>;
	/** Definições cruas das species features (para interpretar "chave=valor" das spawns). */
	byKey: Map<string, any>;
}

export function loadFeatureDefs(): FeatureDefs {
	const aspectGroup = new Map<string, string>();
	const byKey = new Map<string, any>();
	for (const file of walk(`${DATA}/cobblemon/species_features`, (n) => n.endsWith(".json"))) {
		const def = readJson(file);
		const name = basename(file, ".json");
		for (const k of def.keys ?? [name]) byKey.set(k, def);
		if (def.isAspect === false) continue;
		if (def.type === "flag") {
			aspectGroup.set(def.keys?.[0] ?? name, `flag:${def.keys?.[0] ?? name}`);
		} else if (Array.isArray(def.choices)) {
			const fmt: string = def.aspectFormat ?? "{{choice}}";
			for (const c of def.choices) {
				const choice = typeof c === "string" ? c : c.value ?? c.aspect ?? "";
				aspectGroup.set(fmt.replace("{{choice}}", choice), `feature:${name}`);
			}
		}
	}
	aspectGroup.set("shiny", "shiny");
	aspectGroup.set("male", "gender");
	aspectGroup.set("female", "gender");
	return { aspectGroup, byKey };
}

const MAX_ENUMERATION = 20000;

/**
 * Enumera combinações de aspects relevantes (só os que aparecem nas variações da espécie) e devolve as
 * combinações distintas de poser+modelo+textura+camadas. A combinação 0 é sempre a padrão (sem aspects).
 */
export function enumerateCombos(variations: Variation[], speciesData: any, defs: FeatureDefs): { combos: Combo[]; incomplete: string[] } {
	const formAspects = new Map<string, string[]>();
	for (const form of speciesData?.forms ?? []) {
		const a: string[] = form.aspects ?? [];
		if (a.length) formAspects.set(a.join("+"), a);
	}
	const aspectToForm = new Map<string, string>();
	for (const [key, list] of formAspects) for (const a of list) aspectToForm.set(a, key);

	// Opções por grupo: cada opção é uma lista de aspects.
	const groups = new Map<string, string[][]>();
	const addOption = (group: string, option: string[]) => {
		const opts = groups.get(group) ?? [];
		if (!opts.some((o) => o.join("+") === option.join("+"))) opts.push(option);
		groups.set(group, opts);
	};
	for (const v of variations) {
		for (const a of v.aspects) {
			const form = aspectToForm.get(a);
			if (form) addOption("form", formAspects.get(form)!);
			else addOption(defs.aspectGroup.get(a) ?? `own:${a}`, [a]);
		}
	}

	const groupList = [...groups.values()];
	const total = groupList.reduce((n, g) => n * (g.length + 1), 1);
	const aspectSets: string[][] = [];
	const incomplete: string[] = [];
	if (total <= MAX_ENUMERATION) {
		const rec = (i: number, acc: string[]) => {
			if (i === groupList.length) {
				aspectSets.push(acc);
				return;
			}
			rec(i + 1, acc);
			for (const opt of groupList[i]) rec(i + 1, [...acc, ...opt]);
		};
		rec(0, []);
	} else {
		// Muitas combinações: usa só a base, cada variação e pares de variações.
		incomplete.push(`enumeração limitada (${total} combinações possíveis)`);
		aspectSets.push([]);
		for (const v of variations) aspectSets.push(v.aspects);
		for (let i = 0; i < variations.length; i++) {
			for (let j = i + 1; j < variations.length; j++) aspectSets.push([...variations[i].aspects, ...variations[j].aspects]);
		}
	}

	const seen = new Map<string, Combo>();
	for (const set of aspectSets) {
		const r = resolveCombo(variations, set);
		if (!r.poser || !r.model || !r.texture) continue;
		const combo: Combo = { poser: r.poser, model: r.model, texture: r.texture, layers: r.layers };
		const key = comboKey(combo);
		if (!seen.has(key)) seen.set(key, combo);
	}
	return { combos: [...seen.values()], incomplete };
}

/**
 * Frente msd-fase6: combinações que `enumerateCombos` perde quando um aspect pertence a MAIS de uma forma (ele liga
 * cada aspect a uma forma só: no Ogerpon, `embody-aspect` e cada `*-mask` ficam presos à forma Tera, e somem o
 * Teal-Tera e as máscaras sem Tera). Enumera de novo com o grupo "forma" contendo TODAS as formas de cada aspect e
 * devolve só as combinações que ainda não estão em `combos`, para o chamador acrescentar NO FIM (índices existentes
 * intactos). Não é chamada pelo import do base: o pack base não muda.
 */
export function supplementFormCombos(variations: Variation[], speciesData: any, defs: FeatureDefs, combos: readonly Combo[]): Combo[] {
	const forms: string[][] = [];
	for (const form of speciesData?.forms ?? []) {
		const a: string[] = form.aspects ?? [];
		if (a.length && !forms.some((f) => f.join("+") === a.join("+"))) forms.push(a);
	}
	const groups = new Map<string, string[][]>();
	const addOption = (group: string, option: string[]) => {
		const opts = groups.get(group) ?? [];
		if (!opts.some((o) => o.join("+") === option.join("+"))) opts.push(option);
		groups.set(group, opts);
	};
	let shared = false;
	for (const v of variations) {
		for (const a of v.aspects) {
			const owners = forms.filter((f) => f.includes(a));
			if (owners.length > 1) shared = true;
			if (owners.length) for (const f of owners) addOption("form", f);
			else addOption(defs.aspectGroup.get(a) ?? `own:${a}`, [a]);
		}
	}
	if (!shared) return [];
	const groupList = [...groups.values()];
	if (groupList.reduce((n, g) => n * (g.length + 1), 1) > MAX_ENUMERATION) return [];
	const seen = new Set(combos.map(comboKey));
	const out: Combo[] = [];
	const rec = (i: number, acc: string[]) => {
		if (i < groupList.length) {
			rec(i + 1, acc);
			for (const opt of groupList[i]) rec(i + 1, [...acc, ...opt]);
			return;
		}
		const r = resolveCombo(variations, acc);
		if (!r.poser || !r.model || !r.texture) return;
		const combo: Combo = { poser: r.poser, model: r.model, texture: r.texture, layers: r.layers };
		const key = comboKey(combo);
		if (seen.has(key)) return;
		seen.add(key);
		out.push(combo);
	};
	rec(0, []);
	return out;
}

/** Código TypeScript da resolução em tempo de execução (copiado para generated/scripts/variants.ts). */
export const RUNTIME_RESOLVER_SOURCE = `
const comboIndexCache = new Map<string, Map<string, number>>();

function comboKeyOf(poser: string | undefined, model: string | undefined, texture: string | undefined, layers: VariantLayer[]): string {
	return \`\${poser}|\${model}|\${texture}|\${layers.map((l) => \`\${l.name}=\${l.texture}\`).join(",")}\`;
}

/**
 * Índice de \`cobblemon:variant\` para uma espécie e seus aspects, com a semântica dos resolvers do
 * Cobblemon: vale a última variação compatível (todos os aspects presentes) que define cada campo, e as
 * camadas são mescladas por nome. Se a combinação exata não existir, cai para a mais parecida.
 */
export function resolveVariant(speciesId: string, aspects: readonly string[]): number {
	const entry = VARIANTS[speciesId];
	if (!entry) return 0;
	const set = new Set(aspects);
	let poser: string | undefined;
	let model: string | undefined;
	let texture: string | undefined;
	const layers = new Map<string, VariantLayer>();
	for (const v of entry.variations) {
		if (!v.aspects.every((a) => set.has(a))) continue;
		if (v.poser) poser = v.poser;
		if (v.model) model = v.model;
		if (v.texture) texture = v.texture;
		if (v.layers) for (const l of v.layers) layers.set(l.name, l);
	}
	const resolvedLayers = [...layers.values()].filter((l) => l.texture);
	let index = comboIndexCache.get(speciesId);
	if (!index) {
		index = new Map();
		entry.combos.forEach((c, i) => index!.set(comboKeyOf(c.poser, c.model, c.texture, c.layers.map((k) => {
			const eq = k.indexOf("=");
			return { name: k.slice(0, eq), texture: k.slice(eq + 1) };
		})), i));
		comboIndexCache.set(speciesId, index);
	}
	const exact = index.get(comboKeyOf(poser, model, texture, resolvedLayers));
	if (exact !== undefined) return exact;
	let best = 0;
	let bestScore = -1;
	entry.combos.forEach((c, i) => {
		const score = (c.model === model ? 4 : 0) + (c.texture === texture ? 2 : 0) + (c.poser === poser ? 1 : 0);
		if (score > bestScore) {
			best = i;
			bestScore = score;
		}
	});
	return best;
}
`;
