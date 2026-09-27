// Spawn pools do Cobblemon (data/cobblemon/spawn_pool_world) → SPAWNS de generated/scripts/spawns.ts,
// com presets mesclados e tags de bioma/bloco expandidas para ids do Bedrock.
//
// Tipos importados: `pokemon` (PokemonSpawnDetail.kt) e `pokemon-herd` (PokemonHerdSpawnDetail.kt).
// Semântica dos presets (SpawnDetailPreset.apply): a condição do preset é mesclada na condição da entrada
// (listas concatenam, escalares da entrada vencem); a anticondição do preset vira uma anticondição
// SEPARADA (basta uma delas valer para bloquear o spawn).
import { basename } from "node:path";
import type { FeatureDefs } from "./variants.ts";
import type { BiomeResolver, BlockResolver } from "./worldgen.ts";
import { DATA, OUT_SCRIPTS, count, readJson, walk, warn, writeText } from "./util.ts";

const SCALAR_KEYS = [
	"minSkyLight", "maxSkyLight", "minLight", "maxLight", "canSeeSky", "isRaining", "isThundering", "timeRange", "moonPhase",
	"minY", "maxY", "minX", "maxX", "minZ", "maxZ", "isPokeSnack", "isSlimeChunk", "minLureLevel", "maxLureLevel", "rodType", "bait",
	"minHeight", "maxHeight", "minDepth", "maxDepth", "fluidIsSource",
];

/** Mescla condições: listas concatenam, escalares do lado de cima (entrada) vencem. */
function mergeRaw(base: any, top: any): any {
	const out: any = { ...(base ?? {}) };
	for (const [k, v] of Object.entries<any>(top ?? {})) {
		out[k] = Array.isArray(v) && Array.isArray(out[k]) ? [...out[k], ...v] : v;
	}
	return out;
}

const IMPOSSIBLE = Symbol("impossible");

/** Espécie + aspects + propriedades que o spawner usa, a partir de uma string de PokemonProperties. */
export interface ParsedPokemon {
	species: string;
	aspects: string[];
	alpha?: boolean;
	heldItem?: string;
	shiny?: boolean;
}

export class SpawnBuilder {
	private presets = new Map<string, any>();

	private biomes: BiomeResolver;
	private blocks: BlockResolver;
	private features: FeatureDefs;

	constructor(biomes: BiomeResolver, blocks: BlockResolver, features: FeatureDefs) {
		this.biomes = biomes;
		this.blocks = blocks;
		this.features = features;
		for (const file of walk(`${DATA}/cobblemon/spawn_detail_presets`, (n) => n.endsWith(".json"))) {
			this.presets.set(basename(file, ".json"), readJson(file));
		}
	}

	/** Converte uma condição; IMPOSSIBLE quando depende só de biomas/blocos que não existem no Bedrock. */
	private convert(raw: any, where: string): any {
		if (!raw || typeof raw !== "object") return undefined;
		const out: any = {};
		for (const [k, v] of Object.entries<any>(raw)) {
			if (SCALAR_KEYS.includes(k)) out[k] = v;
			else if (k === "biomes") {
				const list = this.biomes.resolveList((v as any[]).map((b) => (typeof b === "string" ? b : b?.id)).filter(Boolean));
				if (list.length) out.biomes = list;
				else if ((v as any[]).length) return IMPOSSIBLE;
			} else if (k === "neededNearbyBlocks" || k === "neededBaseBlocks") {
				const list = this.blocks.resolveList(v as string[]);
				if (list.length) out[k] = list;
				else if ((v as any[]).length) return IMPOSSIBLE;
			} else if (k === "structures" || k === "dimensions") {
				out[k] = (v as any[]).map((x) => (typeof x === "string" ? x : x?.id)).filter((x) => typeof x === "string");
			} else if (k === "fluid") {
				// "#minecraft:water" / "minecraft:lava" → "water" / "lava" (fluidos do Bedrock).
				const id = String(v).replace(/^#/, "").replace(/^minecraft:/, "");
				if (id === "water" || id === "lava") out.fluid = id;
				else return IMPOSSIBLE;
			} else warn("campo de condição de spawn descartado", `${k} (${where})`);
		}
		return out;
	}

	/** "vulpix alolan region_bias=alola" → espécie + aspects; "rhyperior held_item=cobblemon:ground_gem alpha=true" → alpha + item. */
	parsePokemon(text: string, speciesData: Map<string, any>): ParsedPokemon {
		const [first, ...rest] = text.trim().split(/\s+/);
		const species = first.toLowerCase().replace(/^cobblemon:/, "");
		const forms: any[] = speciesData.get(species)?.forms ?? [];
		const aspects: string[] = [];
		const out: ParsedPokemon = { species, aspects };
		for (const tok of rest) {
			const eq = tok.indexOf("=");
			if (eq < 0) {
				if (tok.toLowerCase() === "alpha") {
					out.alpha = true;
					continue;
				}
				const form = forms.find((f) => String(f.name).toLowerCase() === tok.toLowerCase());
				aspects.push(...(form?.aspects?.length ? form.aspects : [tok]));
				continue;
			}
			const key = tok.slice(0, eq).toLowerCase();
			const value = tok.slice(eq + 1);
			if (key === "shiny") {
				if (value === "true") {
					aspects.push("shiny");
					out.shiny = true;
				}
			} else if (key === "alpha" || key === "is_alpha") {
				// PokemonProperties.isAlpha (Pokemon.isAlpha → aspect "alpha" + marca mark_alpha).
				if (value.toLowerCase() !== "false") out.alpha = true;
			} else if (key === "held_item" || key === "helditem") {
				out.heldItem = value.includes(":") ? value : `minecraft:${value}`;
			} else if (key === "gender") {
				aspects.push(value.toLowerCase());
			} else if (key === "form") {
				const form = forms.find((f) => String(f.name).toLowerCase() === value.toLowerCase());
				if (form?.aspects) aspects.push(...form.aspects);
				else warn("forma desconhecida em spawn", `${text}`);
			} else {
				const def = this.features.byKey.get(key);
				if (def?.type === "flag") {
					if (value !== "false") aspects.push(def.keys?.[0] ?? key);
				} else if (def && Array.isArray(def.choices)) {
					aspects.push(String(def.aspectFormat ?? "{{choice}}").replace("{{choice}}", value));
				} else warn("propriedade de spawn ignorada", `${tok} (${text})`);
			}
		}
		out.aspects = [...new Set(aspects)];
		if (!out.alpha) delete out.alpha;
		if (!out.heldItem) delete out.heldItem;
		if (!out.shiny) delete out.shiny;
		return out;
	}

	build(included: Set<string>, speciesData: Map<string, any>): any[] {
		const out: any[] = [];
		for (const file of walk(`${DATA}/cobblemon/spawn_pool_world`, (n) => n.endsWith(".json"))) {
			const pool = readJson(file);
			if (pool.enabled === false) continue;
			for (const s of pool.spawns ?? []) {
				if (s.type !== "pokemon" && s.type !== "pokemon-herd") {
					count(`spawns ignoradas (tipo ${s.type})`);
					continue;
				}
				const entry = s.type === "pokemon" ? this.buildPokemon(s, included, speciesData) : this.buildHerd(s, included, speciesData);
				if (!entry) continue;
				if (!this.applyConditions(entry, s)) {
					count("spawns sem bioma/bloco equivalente no Bedrock");
					continue;
				}
				count(`spawns importadas (${s.type})`);
				if (entry.alpha || entry.herd?.members.some((m: any) => m.alpha)) count("spawns com Alfa");
				out.push(entry);
			}
		}
		return out;
	}

	private buildPokemon(s: any, included: Set<string>, speciesData: Map<string, any>): any | undefined {
		const p = this.parsePokemon(String(s.pokemon ?? ""), speciesData);
		if (!included.has(p.species)) return undefined;
		const [minLevel, maxLevel] = parseRange(String(s.level ?? s.levelRange ?? "1-100")) ?? [1, 100];
		const entry: any = this.base(s, p.species, minLevel, maxLevel);
		entry.aspects = p.aspects;
		if (p.alpha) entry.alpha = true;
		if (p.heldItem) entry.heldItem = p.heldItem;
		if (s.drops && typeof s.drops === "object") entry.drops = s.drops;
		// PossibleHeldItem (PokemonSpawnDetail.heldItems): item + percentage.
		if (Array.isArray(s.heldItems) && s.heldItems.length) {
			entry.heldItems = s.heldItems
				.map((h: any) => ({ item: String(h.item ?? ""), percentage: Number(h.percentage ?? 100) }))
				.filter((h: any) => h.item);
		}
		return entry;
	}

	private buildHerd(s: any, included: Set<string>, speciesData: Map<string, any>): any | undefined {
		const members: any[] = [];
		for (const h of s.herdablePokemon ?? []) {
			const p = this.parsePokemon(String(h.pokemon ?? ""), speciesData);
			if (!included.has(p.species)) {
				count("membros de herd sem espécie importada (descartados)");
				continue;
			}
			// Padrões omitidos para encolher o módulo: aspects [], isLeader false, isFollower true.
			const m: any = { species: p.species, weight: Number(h.weight ?? 1), maxTimes: Number(h.maxTimes ?? 10) };
			if (p.aspects.length) m.aspects = p.aspects;
			if (h.isLeader === true) m.isLeader = true;
			if (h.isFollower === false) m.isFollower = false;
			if (p.alpha) m.alpha = true;
			const held = h.heldItem ? String(h.heldItem) : p.heldItem;
			if (held) m.heldItem = held.includes(":") ? held : `minecraft:${held}`;
			const lr = h.levelRange !== undefined ? parseRange(String(h.levelRange)) : undefined;
			const off = h.levelRangeOffset !== undefined ? parseRange(String(h.levelRangeOffset)) : undefined;
			const hlr = h.herdLevelRange !== undefined ? parseRange(String(h.herdLevelRange)) : undefined;
			if (lr) m.levelRange = lr;
			if (off) m.levelRangeOffset = off;
			if (hlr) m.herdLevelRange = hlr;
			if (!(m.weight > 0) || !(m.maxTimes > 0)) continue; // PokemonHerdSpawnDetail.isValid
			members.push(m);
		}
		if (!members.length) return undefined;
		const [minLevel, maxLevel] = parseRange(String(s.levelRange ?? s.level ?? "1-100")) ?? [1, 100];
		const leader = members.find((m) => m.isLeader) ?? members[0];
		const entry: any = this.base(s, leader.species, minLevel, maxLevel);
		entry.aspects = [];
		entry.herd = { maxHerdSize: Number(s.maxHerdSize ?? 10), members };
		if (s.minDistanceBetweenSpawns !== undefined && Number(s.minDistanceBetweenSpawns) !== 1)
			entry.herd.minDistanceBetweenSpawns = Number(s.minDistanceBetweenSpawns);
		return entry;
	}

	private base(s: any, species: string, minLevel: number, maxLevel: number): any {
		return {
			id: String(s.id),
			type: String(s.type),
			species,
			aspects: [] as string[],
			positionType: String(s.spawnablePositionType ?? s.context ?? "grounded"),
			bucket: String(s.bucket ?? "common"),
			minLevel,
			maxLevel,
			weight: Number(s.weight ?? 1),
			weightMultipliers: [] as any[],
			condition: {},
		};
	}

	/** Presets + condição/anticondições/multiplicadores. Falso se a condição é impossível no Bedrock. */
	private applyConditions(entry: any, s: any): boolean {
		let condRaw: any = {};
		const antiRaws: any[] = [];
		const presetMultipliers: any[] = [];
		for (const presetName of s.presets ?? []) {
			const preset = this.presets.get(presetName);
			if (!preset) {
				warn("preset de spawn desconhecido", presetName);
				continue;
			}
			condRaw = mergeRaw(condRaw, preset.condition);
			if (preset.anticondition) antiRaws.push(preset.anticondition);
			if (Array.isArray(preset.weightMultipliers)) presetMultipliers.push(...preset.weightMultipliers);
		}
		condRaw = mergeRaw(condRaw, s.condition);
		if (s.anticondition) antiRaws.push(s.anticondition);
		for (const a of s.anticonditions ?? []) antiRaws.push(a);
		const condition = this.convert(condRaw, s.id);
		if (condition === IMPOSSIBLE) return false;
		entry.condition = condition ?? {};
		const antis: any[] = [];
		for (const raw of antiRaws) {
			const a = this.convert(raw, s.id);
			// Anticondição impossível nunca bloqueia; vazia bloquearia tudo (não existe nos dados).
			// Com `structures` ela também nunca vale (o Bedrock não detecta estruturas): descartada.
			if (a && a !== IMPOSSIBLE && Object.keys(a).length && !a.structures?.length) antis.push(a);
		}
		if (antis.length) entry.anticonditions = antis;
		const multipliers: any[] = [];
		for (const m of [...presetMultipliers, ...(s.weightMultipliers ?? []), ...(s.weightMultiplier ? [s.weightMultiplier] : [])]) {
			const c = m.condition ? this.convert(m.condition, s.id) : undefined;
			const a = m.anticondition ? this.convert(m.anticondition, s.id) : undefined;
			if (c === IMPOSSIBLE || c?.structures?.length) continue;
			const w: any = { multiplier: Number(m.multiplier ?? 1) };
			if (c && Object.keys(c).length) w.condition = c;
			if (a && a !== IMPOSSIBLE && Object.keys(a).length) w.anticondition = a;
			multipliers.push(w);
		}
		entry.weightMultipliers = multipliers;
		return true;
	}
}

/** "13-32" → [13, 32]; "-3-3" → [-3, 3]; "5" → [5, 5]. */
export function parseRange(s: string): [number, number] | undefined {
	const m = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(s);
	if (!m) return undefined;
	const a = Number(m[1]);
	const b = m[2] !== undefined ? Number(m[2]) : a;
	return [Math.min(a, b), Math.max(a, b)];
}

/** data/cobblemon/spawning/best-spawner-config.json (buckets e pesos por tipo de posição). */
export function loadBestSpawnerConfig(): any {
	try {
		return readJson(`${DATA}/cobblemon/spawning/best-spawner-config.json`);
	} catch {
		warn("best-spawner-config.json não encontrado", "usando padrão do BestSpawnerConfig.kt");
		return {};
	}
}

/**
 * Listas longas e repetidas (biomas/blocos) viram constantes compartilhadas: o tipo continua o mesmo,
 * mas o arquivo encolhe muito (as tags de bioma expandidas se repetem em centenas de entradas).
 */
function shareLists(spawns: any[]): { consts: string[]; body: string } {
	const ids = new Map<string, string>();
	const consts: string[] = [];
	// 1ª passada: quantas vezes cada objeto/lista aparece (membros de herd, condições repetidas...).
	const seen = new Map<string, number>();
	const scan = (v: any) => {
		if (v && typeof v === "object") {
			const key = JSON.stringify(v);
			if (key.length >= 24) seen.set(key, (seen.get(key) ?? 0) + 1);
			for (const x of Array.isArray(v) ? v : Object.values(v)) scan(x);
		}
	};
	for (const s of spawns) for (const x of Object.values(s)) scan(x);
	const replace = (v: any): any => {
		if (!v || typeof v !== "object") return v;
		const key = JSON.stringify(v);
		const stringList = Array.isArray(v) && v.length >= 4 && v.every((x) => typeof x === "string");
		if (stringList || (seen.get(key) ?? 0) >= 2) {
			let id = ids.get(key);
			if (!id) {
				// Filhos primeiro: constantes podem referenciar constantes anteriores.
				const inner = Array.isArray(v) ? v.map(replace) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
				id = `L${ids.size}`;
				ids.set(key, id);
				const type = stringList ? "string[]" : "any";
				consts.push(`const ${id}: ${type} = ${JSON.stringify(inner).replace(/"@@(L\d+)@@"/g, "$1")};`);
			}
			return `@@${id}@@`;
		}
		if (Array.isArray(v)) return v.map(replace);
		return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x)]));
	};
	// Blocos de até 200 entradas: um literal único gigante estoura o limite de união do tsc (TS2590).
	const chunks: string[] = [];
	for (let i = 0; i < spawns.length; i += 200) {
		const lines = spawns.slice(i, i + 200).map((s) => `\t${JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, x]) => [k, replace(x)]))).replace(/"@@(L\d+)@@"/g, "$1")},`);
		chunks.push(`const S${chunks.length}: SpawnEntry[] = [\n${lines.join("\n")}\n];`);
	}
	const body = `${chunks.join("\n")}\n\nexport const SPAWNS: SpawnEntry[] = [${chunks.map((_, i) => `...S${i}`).join(", ")}];`;
	return { consts, body };
}

const HEADER = "// Arquivo gerado por tools/importer (npm run import). Não edite à mão.\n/* eslint-disable */\n";

export function emitSpawnsModule(spawns: any[]): void {
	const { consts, body } = shareLists(spawns);
	const config = loadBestSpawnerConfig();
	const spawnerConfig = {
		spawnablePositionTypeWeights: config.spawnablePositionTypeWeights ?? config.contextWeights ?? { grounded: 1, submerged: 0.99, surface: 0.01, seafloor: 1 },
		worldBuckets: config.worldBuckets ?? { common: 94.05, uncommon: 5, rare: 0.5, "ultra-rare": 0.2, boss: 0.25 },
		fishingBuckets: config.fishingBuckets ?? { common: 83.25, uncommon: 11.25, rare: 4.125, "ultra-rare": 1.375 },
		pokeSnackBuckets: config.pokeSnackBuckets ?? { common: 83.25, uncommon: 11.25, rare: 4.125, "ultra-rare": 1.375 },
		activatedHabitatBuckets: config.activatedHabitatBuckets ?? { common: 83.25, uncommon: 11.25, rare: 4.125, "ultra-rare": 1.375 },
	};
	writeText(
		`${OUT_SCRIPTS}/spawns.ts`,
		`${HEADER}
export interface SpawnCondition {
	biomes?: string[];
	minSkyLight?: number;
	maxSkyLight?: number;
	minLight?: number;
	maxLight?: number;
	canSeeSky?: boolean;
	isRaining?: boolean;
	isThundering?: boolean;
	timeRange?: string;
	/** Fase(s) da lua: número, "0-2,5" ou nome (full, new, crescent, gibbous, quarter, waxing, waning). */
	moonPhase?: string | number;
	minY?: number;
	maxY?: number;
	minX?: number;
	maxX?: number;
	minZ?: number;
	maxZ?: number;
	neededNearbyBlocks?: string[];
	neededBaseBlocks?: string[];
	structures?: string[];
	isPokeSnack?: boolean;
	isSlimeChunk?: boolean;
	minLureLevel?: number;
	maxLureLevel?: number;
	/** Id da Poké Rod (ex.: "cobblemon:love_rod"). */
	rodType?: string;
	/** Id da isca na vara (ex.: "cobblemon:love_sweet"). */
	bait?: string;
	dimensions?: string[];
	/** Fluido exigido (presets "water"/"lava"). */
	fluid?: "water" | "lava";
	fluidIsSource?: boolean;
	/** Espaço livre acima da posição (blocos). */
	minHeight?: number;
	maxHeight?: number;
	/** Profundidade do fluido (submerged/seafloor). */
	minDepth?: number;
	maxDepth?: number;
}

export interface SpawnWeightMultiplier {
	multiplier: number;
	condition?: SpawnCondition;
	anticondition?: SpawnCondition;
}

/** Tabela de drops do Cobblemon (DropTable): "amount" sorteios entre "entries". */
export interface SpawnDrops {
	amount?: number;
	entries?: { item: string; percentage?: number; quantityRange?: string }[];
}

/** PokemonHerdSpawnDetail.Herdable. Faixas são [mín, máx]. */
export interface HerdMember {
	species: string;
	/** Ausente = nenhum. */
	aspects?: string[];
	alpha?: boolean;
	heldItem?: string;
	weight: number;
	/** Limita (clamp) o nível do herd para este membro. */
	levelRange?: [number, number];
	/** Faixa relativa ao nível (já limitado) do herd; sem ela o membro usa exatamente esse nível. */
	levelRangeOffset?: [number, number];
	/** Só entra no herd se o nível do herd estiver nesta faixa. */
	herdLevelRange?: [number, number];
	maxTimes: number;
	/** Pode ser o líder (padrão false). */
	isLeader?: boolean;
	/** Pode ser seguidor (padrão true). */
	isFollower?: boolean;
}

export interface HerdData {
	maxHerdSize: number;
	/** Padrão 1. */
	minDistanceBetweenSpawns?: number;
	members: HerdMember[];
}

export interface SpawnEntry {
	id: string;
	/** "pokemon" (PokemonSpawnDetail) ou "pokemon-herd" (PokemonHerdSpawnDetail). */
	type: string;
	/** Espécie; num herd, a do líder (ou do primeiro membro). */
	species: string;
	aspects: string[];
	/** PokemonProperties "alpha=true". */
	alpha?: boolean;
	/** PokemonProperties "held_item=...". */
	heldItem?: string;
	/** PokemonSpawnDetail.heldItems (chance em %). */
	heldItems?: { item: string; percentage: number }[];
	/** grounded, submerged, surface, seafloor ou fishing. */
	positionType: string;
	bucket: string;
	/** Faixa de nível; num herd, a faixa sorteada uma vez para o grupo. */
	minLevel: number;
	maxLevel: number;
	weight: number;
	weightMultipliers: SpawnWeightMultiplier[];
	condition: SpawnCondition;
	/** Basta UMA valer para bloquear o spawn (anticondições do preset ficam separadas). */
	anticonditions?: SpawnCondition[];
	drops?: SpawnDrops;
	herd?: HerdData;
}

/** data/cobblemon/spawning/best-spawner-config.json do Cobblemon 1.8.2. */
export const BEST_SPAWNER_CONFIG: {
	spawnablePositionTypeWeights: Record<string, number>;
	worldBuckets: Record<string, number>;
	fishingBuckets: Record<string, number>;
	pokeSnackBuckets: Record<string, number>;
	activatedHabitatBuckets: Record<string, number>;
} = ${JSON.stringify(spawnerConfig)};

${consts.join("\n")}

${body}
`,
	);
}
