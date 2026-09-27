// Frente dados-ia: dados do importador para
//   - q.has_aspect nos posers (aspects sincronizados ao cliente numa propriedade int, um bit por aspect);
//   - species_feature_assignments + species_features (todas as 87 atribuições → features por espécie);
//   - informações de IA por espécie lidas pelos scripts (point_to_spawn).
// Saída: generated/scripts/dadosIa.ts.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { PoserOutput } from "./posers.ts";
import { aspectVar } from "./posers.ts";
import { DATA, OUT_SCRIPTS, count, tryReadJson, walk, warn, writeText } from "./util.ts";

// ---------------------------------------------------------------------------------------------
// Aspects no cliente (q.has_aspect)

/** Propriedade int sincronizada com os aspects que os posers da espécie leem (bit i = aspectBits[i]). */
export const ASPECTS_PROPERTY = "cobblemon:aspects";

/** Limite de bits (int de 32 bits do Bedrock, sem o sinal). */
export const MAX_ASPECT_BITS = 30;

/** Aspects distintos lidos pelos posers de uma espécie, em ordem estável. */
export function speciesAspectBits(posers: Array<Pick<PoserOutput, "aspects">>): string[] {
	const all = [...new Set(posers.flatMap((p) => p.aspects ?? []))].sort();
	if (all.length > MAX_ASPECT_BITS) {
		warn("aspects de poser acima do limite da propriedade (excedentes ignorados)", all.slice(MAX_ASPECT_BITS).join(","));
		return all.slice(0, MAX_ASPECT_BITS);
	}
	return all;
}

/** Faixa da propriedade int (mínimo [0, 1]: o Bedrock recusa faixa vazia). */
export function aspectsPropertyRange(bits: number): [number, number] {
	return [0, Math.max(1, 2 ** Math.min(bits, MAX_ASPECT_BITS) - 1)];
}

/** Linhas do pre_animation: v.cobblemon_aspect_<nome> = bit i de cobblemon:aspects. */
export function aspectBitLines(bits: string[]): string[] {
	return bits.map((aspect, i) => `${aspectVar(aspect)} = math.mod(math.floor(q.property('${ASPECTS_PROPERTY}') / ${2 ** i}), 2);`);
}

const ASPECT_BITS = new Map<string, string[]>();
export function recordAspectBits(species: string, bits: string[]): void {
	if (bits.length) ASPECT_BITS.set(species, bits);
}

// ---------------------------------------------------------------------------------------------
// IA por espécie usada por scripts

export interface SpeciesAiOut {
	pointToSpawn: boolean;
}
const SPECIES_AI = new Map<string, SpeciesAiOut>();
export function recordSpeciesAi(species: string, info: SpeciesAiOut): void {
	if (info.pointToSpawn) SPECIES_AI.set(species, info);
}

// ---------------------------------------------------------------------------------------------
// species_features + species_feature_assignments

export interface FeatureDefOut {
	type: "choice" | "weighted_choice" | "flag" | "integer";
	keys: string[];
	/** Valor padrão como no JSON ("random", "none", uma escolha, true/false, número). */
	default?: string | number | boolean;
	/** Escolhas (choice) ou pesos (weighted_choice). */
	choices?: string[];
	weights?: Record<string, number>;
	isAspect: boolean;
	aspectFormat: string;
	min?: number;
	max?: number;
}

/** Features registradas em código no Cobblemon (Cobblemon.kt): `sheared` (flag). A cauda do Slowpoke é por script. */
const CODE_FEATURES: Record<string, FeatureDefOut> = {
	sheared: { type: "flag", keys: ["sheared"], default: false, isAspect: true, aspectFormat: "{{choice}}" },
	// SlowpokeTailRegrowthSpeciesFeatureProvider: segundos até a cauda crescer; os aspects vêm de SpeciesFeatures.ts.
	slowpoke_tail_regrowth: { type: "integer", keys: ["slowpoke_tail_regrowth"], default: 0, isAspect: false, aspectFormat: "{{choice}}", min: 0, max: 1200 },
};

export interface SpeciesFeatureData {
	defs: Record<string, FeatureDefOut>;
	/** espécie → nomes de feature (species.features que existem + atribuições), sem repetição. */
	species: Record<string, string[]>;
	/** Features globais (global_species_features): todas as espécies. */
	global: string[];
}

function featureDef(json: any, name: string): FeatureDefOut | undefined {
	const type = String(json?.type ?? "");
	if (!["choice", "weighted_choice", "flag", "integer"].includes(type)) {
		warn("species_feature de tipo desconhecido", `${name}: ${type}`);
		return undefined;
	}
	const out: FeatureDefOut = {
		type: type as FeatureDefOut["type"],
		keys: Array.isArray(json.keys) && json.keys.length ? json.keys.map(String) : [name],
		isAspect: json.isAspect === true,
		aspectFormat: String(json.aspectFormat ?? "{{choice}}"),
	};
	if (json.default !== undefined) out.default = json.default;
	if (type === "choice" && Array.isArray(json.choices)) out.choices = json.choices.map((c: unknown) => String(c).toLowerCase());
	if (type === "weighted_choice" && json.choices && typeof json.choices === "object") {
		out.weights = Object.fromEntries(Object.entries<any>(json.choices).map(([k, v]) => [k.toLowerCase(), Number(v) || 0]));
	}
	if (type === "integer") {
		out.min = Number(json.min ?? 0);
		out.max = Number(json.max ?? 0);
	}
	return out;
}

/** Carrega as definições e as atribuições (mesmo nome de registro do Cobblemon: caminho do arquivo). */
export function loadSpeciesFeatureData(speciesData: Map<string, any>): SpeciesFeatureData {
	const defs: Record<string, FeatureDefOut> = { ...CODE_FEATURES };
	const dir = `${DATA}/cobblemon/species_features`;
	for (const file of existsSync(dir) ? walk(dir, (n) => n.endsWith(".json")) : []) {
		const name = basename(file, ".json");
		if (CODE_FEATURES[name]) continue; // Registro em código substitui o de dados.
		const def = featureDef(tryReadJson(file), name);
		if (def) defs[name] = def;
	}
	const global: string[] = [];
	const gdir = `${DATA}/cobblemon/global_species_features`;
	for (const file of existsSync(gdir) ? walk(gdir, (n) => n.endsWith(".json")) : []) {
		const name = basename(file, ".json");
		const def = featureDef(tryReadJson(file), name);
		if (def) {
			defs[name] ??= def;
			global.push(name);
		}
	}
	const species: Record<string, Set<string>> = {};
	const add = (id: string, feature: string) => {
		if (!defs[feature]) return false;
		(species[id] ??= new Set()).add(feature);
		return true;
	};
	// Species.features: só nomes registrados (getFeature(name)); os outros o Cobblemon ignora.
	for (const [id, data] of speciesData) for (const f of Array.isArray(data?.features) ? data.features : []) add(id, String(f));
	let assignments = 0;
	const adir = `${DATA}/cobblemon/species_feature_assignments`;
	for (const file of existsSync(adir) ? walk(adir, (n) => n.endsWith(".json")) : []) {
		const json = tryReadJson(file);
		assignments++;
		for (const raw of json?.pokemon ?? []) {
			const id = String(raw).replace(/^cobblemon:/, "").toLowerCase();
			if (!speciesData.has(id)) {
				warn("species_feature_assignment cita espécie inexistente", `${basename(file)}: ${raw}`);
				continue;
			}
			for (const f of json.features ?? []) if (!add(id, String(f))) warn("species_feature_assignment cita feature inexistente", `${basename(file)}: ${f}`);
		}
	}
	count("species_feature_assignments", assignments);
	return {
		defs,
		species: Object.fromEntries(Object.entries(species).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()])),
		global,
	};
}

// ---------------------------------------------------------------------------------------------
// Assentos condicionais (1.8.0: Seat.condition, MoLang avaliado no runtime do PokemonEntity)

/** espécie → forma ("" = espécie) → condição por assento (null = sempre). Só espécies com alguma condição. */
export function seatConditions(speciesData: Map<string, any>): Record<string, Record<string, Array<string | null>>> {
	const out: Record<string, Record<string, Array<string | null>>> = {};
	const of = (riding: any): Array<string | null> | undefined => {
		const seats: any[] = Array.isArray(riding?.seats) ? riding.seats : [];
		const list = seats.map((seat) => (typeof seat?.condition === "string" && seat.condition.trim() ? seat.condition.trim() : null));
		return list.some((c) => c !== null) ? list : undefined;
	};
	for (const [id, data] of speciesData) {
		const forms: Record<string, Array<string | null>> = {};
		const base = of(data?.riding);
		if (base) forms[""] = base;
		for (const f of data?.forms ?? []) {
			const list = f?.name && f.riding !== undefined ? of(f.riding) : undefined;
			if (list) forms[String(f.name)] = list;
		}
		if (Object.keys(forms).length) out[id] = forms;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Módulo gerado

export function emitDadosIaModule(speciesData: Map<string, any>): void {
	const features = loadSpeciesFeatureData(speciesData);
	const bits = Object.fromEntries([...ASPECT_BITS].sort(([a], [b]) => a.localeCompare(b)));
	const ai = Object.fromEntries([...SPECIES_AI].sort(([a], [b]) => a.localeCompare(b)));
	writeText(
		`${OUT_SCRIPTS}/dadosIa.ts`,
		`// Arquivo gerado por tools/importer/dadosIa.ts (npm run import). Não edite à mão.
/* eslint-disable */
export interface FeatureDef {
	type: "choice" | "weighted_choice" | "flag" | "integer";
	keys: string[];
	default?: string | number | boolean;
	choices?: string[];
	weights?: Record<string, number>;
	isAspect: boolean;
	aspectFormat: string;
	min?: number;
	max?: number;
}

/** Propriedade int da entidade com os aspects lidos pelos posers (bit i = ASPECT_BITS[espécie][i]). */
export const ASPECTS_PROPERTY = ${JSON.stringify(ASPECTS_PROPERTY)};

/** Aspects que cada espécie sincroniza ao cliente para q.has_aspect. */
export const ASPECT_BITS: Record<string, string[]> = ${JSON.stringify(bits)};

/** data/cobblemon/species_features (+ global_species_features e as features registradas em código). */
export const FEATURE_DEFS: Record<string, FeatureDef> = ${JSON.stringify(features.defs)};

/** Features por espécie: species.features + species_feature_assignments. */
export const SPECIES_FEATURES: Record<string, string[]> = ${JSON.stringify(features.species)};

/** Features globais (todas as espécies). */
export const GLOBAL_FEATURES: string[] = ${JSON.stringify(features.global)};

/** IA de espécie tratada por script (tarefas sem componente vanilla). */
export const SPECIES_AI: Record<string, { pointToSpawn: boolean }> = ${JSON.stringify(ai)};

/** Assentos condicionais (Seat.condition): espécie → forma ("" = espécie) → condição MoLang por assento. */
export const SEAT_CONDITIONS: Record<string, Record<string, Array<string | null>>> = ${JSON.stringify(seatConditions(speciesData))};
`,
	);
	count("espécies com aspects no cliente (q.has_aspect)", Object.keys(bits).length);
	count("espécies com species features", Object.keys(features.species).length);
}

// ---------------------------------------------------------------------------------------------
// Camadas com "scrolling" (1.8.0: ModelLayer.scrolling {speedU, speedV})

type Scroll = { speedU: number; speedV: number } | undefined;

/**
 * uv_anim do render controller de uma camada, com a velocidade da variante atual (v.cobblemon_variant). O Cobblemon
 * desloca a UV por (tempo em segundos × velocidade) mod 1 (PosableModel.getScrollingLayer). Sem scrolling em
 * nenhuma variante: undefined.
 */
export function scrollingUvAnim(perCombo: Scroll[]): { offset: [string, string]; scale: [number, number] } | undefined {
	if (!perCombo.some((s) => s && (s.speedU || s.speedV))) return undefined;
	const axis = (key: "speedU" | "speedV"): string => {
		const speeds = perCombo.map((s) => s?.[key] ?? 0);
		const expr = (v: number) => (v ? `math.mod(q.life_time * ${v}, 1.0)` : "0.0");
		if (speeds.every((v) => v === speeds[0])) return expr(speeds[0]);
		// Uma condição por velocidade distinta (a mais comum fica no "senão").
		const counts = new Map<number, number>();
		for (const v of speeds) counts.set(v, (counts.get(v) ?? 0) + 1);
		const fallback = [...counts].sort((a, b) => b[1] - a[1])[0][0];
		let out = expr(fallback);
		for (const [v] of counts) {
			if (v === fallback) continue;
			const idx = speeds.flatMap((x, i) => (x === v ? [i] : []));
			out = `(${idx.map((i) => `v.cobblemon_variant == ${i}`).join(" || ")}) ? ${expr(v)} : (${out})`;
		}
		return out;
	};
	return { offset: [axis("speedU"), axis("speedV")], scale: [1, 1] };
}
