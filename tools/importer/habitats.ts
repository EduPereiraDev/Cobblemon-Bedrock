// Habitat pools do Cobblemon 1.8.2 (data/cobblemon/habitat_pools, 51) → generated/scripts/habitats.ts.
//
// Cada HabitatSpawn (api/habitats/HabitatSpawn.kt) vira uma entrada no formato do spawner (SpawnEntry) com
// as fases (IntRanges) à parte: a condição é só timeRange/minLight/maxLight (createCondition), o id é
// "habitat_<espécie>" e as `modifiers` (PokemonProperties) viram aspects como nas spawn pools.
// O índice de cada pool (1..N, na ordem alfabética do id) é gravado no estado `cobblemon:habitat_pool` /
// `cobblemon:habitat_pool_hi` do bloco de habitat colocado pelas estruturas convertidas (structures.ts).
import { basename } from "node:path";
import type { SpawnBuilder } from "./spawns.ts";
import { parseRange } from "./spawns.ts";
import { DATA, OUT_SCRIPTS, count, readJson, walk, warn, writeText } from "./util.ts";

export interface HabitatSpawnOut {
	id: string;
	type: "pokemon";
	species: string;
	aspects: string[];
	alpha?: boolean;
	heldItem?: string;
	positionType: string;
	bucket: string;
	minLevel: number;
	maxLevel: number;
	weight: number;
	weightMultipliers: never[];
	condition: { timeRange?: string; minLight?: number; maxLight?: number };
	/** Fases em que vale ([mín, máx] inclusivos); ausente = todas. */
	phases?: [number, number][];
}

export interface HabitatPoolOut {
	id: string;
	/** Chave de tradução do nome (cobblemon.habitat.<id>.name). */
	name: string;
	/** Índice no estado do bloco (1..N). */
	index: number;
	spawns: HabitatSpawnOut[];
}

/** "1-7, 9" → [[1, 7], [9, 9]] (IntRangesAdapter.basic). */
export function parsePhases(text: string): [number, number][] {
	const out: [number, number][] = [];
	for (const part of text.split(",")) {
		const r = part.split("-").map((s) => s.trim());
		if (r.length === 2 && /^-?\d+$/.test(r[0]) && /^-?\d+$/.test(r[1])) out.push([Number(r[0]), Number(r[1])]);
		else if (r.length === 1 && /^-?\d+$/.test(r[0])) out.push([Number(r[0]), Number(r[0])]);
	}
	return out;
}

/** Lê e converte os pools. Espécies não importadas são descartadas (como nas spawn pools). */
export function buildHabitatPools(builder: SpawnBuilder, included: Set<string>, speciesData: Map<string, any>): HabitatPoolOut[] {
	const files = walk(`${DATA}/cobblemon/habitat_pools`, (n) => n.endsWith(".json")).sort();
	const pools: HabitatPoolOut[] = [];
	for (const file of files) {
		const path = basename(file, ".json");
		const raw = readJson(file);
		const spawns: HabitatSpawnOut[] = [];
		for (const s of raw.spawns ?? []) {
			const p = builder.parsePokemon(`${s.species} ${s.modifiers ?? ""}`, speciesData);
			if (!included.has(p.species)) {
				count("spawns de habitat sem espécie importada (descartadas)");
				continue;
			}
			const [minLevel, maxLevel] = parseRange(String(s.levelRange ?? "1-100")) ?? [1, 100];
			const entry: HabitatSpawnOut = {
				id: `habitat_${p.species}`,
				type: "pokemon",
				species: p.species,
				aspects: p.aspects,
				positionType: String(s.spawnablePositionType ?? "grounded"),
				bucket: String(s.bucket ?? "common"),
				minLevel,
				maxLevel,
				weight: Number(s.weight ?? 1),
				weightMultipliers: [],
				condition: {},
			};
			if (p.alpha) entry.alpha = true;
			if (p.heldItem) entry.heldItem = p.heldItem;
			if (s.timeRange !== undefined) entry.condition.timeRange = String(s.timeRange);
			if (s.minLight !== undefined) entry.condition.minLight = Number(s.minLight);
			if (s.maxLight !== undefined) entry.condition.maxLight = Number(s.maxLight);
			if (s.phases !== undefined) {
				const phases = parsePhases(String(s.phases));
				if (phases.length) entry.phases = phases;
			}
			spawns.push(entry);
		}
		if (!raw.spawns?.length) warn("habitat pool vazio", path);
		pools.push({ id: `cobblemon:${path}`, name: String(raw.name ?? `cobblemon.habitat.${path}.name`), index: pools.length + 1, spawns });
		count("habitat pools");
		count("spawns de habitat", spawns.length);
	}
	return pools;
}

const HEADER = "// Arquivo gerado por tools/importer (npm run import). Não edite à mão.\n/* eslint-disable */\n";

/**
 * Emite generated/scripts/habitats.ts. `anchorRanges`: alcance (blocos) do bloco de habitat "âncora" das
 * estruturas convertidas por pool (cobre todos os blocos de habitat do molde original + rangeOfInfluence).
 */
export function emitHabitatsModule(pools: HabitatPoolOut[], anchorRanges: Map<string, number>): void {
	const body = pools.map((p) => `\t${JSON.stringify(p.id)}: ${JSON.stringify(p)},`).join("\n");
	writeText(
		`${OUT_SCRIPTS}/habitats.ts`,
		`${HEADER}
import type { SpawnEntry } from "./spawns";

/** HabitatSpawn → entrada do spawner + fases ([mín, máx]; ausente = todas). */
export interface HabitatSpawnEntry extends SpawnEntry {
	phases?: [number, number][];
}

export interface HabitatPoolData {
	id: string;
	/** Chave de tradução do nome. */
	name: string;
	/** Índice no estado cobblemon:habitat_pool(_hi) do bloco (1..N; 0 = configurado por script). */
	index: number;
	spawns: HabitatSpawnEntry[];
}

/** data/cobblemon/habitat_pools do Cobblemon 1.8.2. */
export const HABITAT_POOLS: Record<string, HabitatPoolData> = {
${body}
};

/** Alcance do bloco âncora das estruturas convertidas (por pool), em blocos. */
export const HABITAT_ANCHOR_RANGES: Record<string, number> = ${JSON.stringify(Object.fromEntries([...anchorRanges].sort()))};
`,
	);
}
