// Estruturas do Cobblemon 1.8.2 → .mcstructure + features do Bedrock (sem APIs experimentais).
//
// Convertidas: as 43 features `cobblemon:structure` (CobblemonFeature.kt: um molde .nbt sorteado, rotação aleatória,
// processadores) — 23 sítios de fósseis, 17 habitats de molde único e 3 ruínas —, com a colocação do placed_feature
// (count, rarity_filter, heightmap/height_range, random_offset) e os biomas de CobblemonPlacedFeatures.kt.
// Cada molde vira structures/cobblemon/<categoria>_<nome>.mcstructure e uma structure_template_feature.
//
// Conversão de um molde:
// - Blocos vanilla: tabela Java → Bedrock (tools/importer/data/java_bedrock_blocks.json); `waterlogged=true` vira
//   água na 2ª camada. Blocos do Cobblemon: estados do BlockBuilder (bedrockStateFor).
// - `structure_void` e posições ausentes não mexem no terreno; `jigsaw` vira o `final_state`.
// - Processadores "rule" (random_block_match, random_blockstate_match, block_match) e "capped" são aplicados na
//   conversão com semente fixa (o Java sorteia a cada colocação); `append_loot` vira a loot table do block entity
//   (areia/cascalho suspeitos, baús). "gravity" e "cobblemon:height_range" não têm equivalente (ignorados).
// - Bloco de habitat: no Java ele é invisível e imita outro bloco (MimicId); aqui cada um vira o bloco imitado e
//   um único bloco de habitat "âncora" (o mais enterrado) guarda o pool no estado cobblemon:habitat_pool(_hi),
//   com alcance que cobre todos os blocos de habitat do molde (HABITAT_ANCHOR_RANGES).
// As 67 estruturas jigsaw (worldgen/structure) viram jigsaw data-driven do Bedrock em jigsaw.ts (frente motor), que
// usa convertBlocks com `keepJigsaw` (blocos jigsaw preservados nas peças) e marcadores de estrutura (`entities`).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { convertLoot, emitLoot, takeNestedLootRefs, VANILLA_LOOT_RENAMES } from "./loot.ts";
import type { ItemIdMapper } from "./loot.ts";
import { nbt, readJavaNbt, writeBedrockNbt } from "./nbt.ts";
import type { NbtTyped } from "./nbt.ts";
import type { BiomeResolver } from "./worldgen.ts";
import { biomeFilter, VANILLA_BLOCKS } from "./vanilla.ts";
import { DATA, OUT_BP, ROOT, UPSTREAM, count, readJson, splitId, walk, warn, writeJson } from "./util.ts";

/** Versão de bloco gravada na paleta (mesma dos .mcstructure escritos à mão do pack). */
export const BLOCK_VERSION = 18153475;
const FEATURE_FORMAT = "1.13.0";
const KOTLIN = join(UPSTREAM, "..", "kotlin", "com", "cobblemon", "mod", "common");

export type StateValue = string | number | boolean;
export interface BedrockBlock { name: string; states: Record<string, StateValue> }

interface JavaBlock { pos: [number, number, number]; state: number; nbt?: Record<string, any> }
interface JavaTemplate { size: [number, number, number]; palette: Array<{ Name: string; Properties?: Record<string, string> }>; blocks: JavaBlock[]; entities?: unknown[] }

/** Bloco já processado (estado Java) de um molde. */
export interface PlacedBlock {
	pos: [number, number, number];
	name: string;
	props: Record<string, string>;
	nbt?: Record<string, any>;
	/** Loot table (id do Java) gravada no block entity por append_loot ou já presente no molde. */
	loot?: string;
}

// ---------------------------------------------------------------------------------------------
// Aleatório determinístico

export function seededRandom(seedText: string): () => number {
	let h = 1779033703 ^ seedText.length;
	for (let i = 0; i < seedText.length; i++) {
		h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	let s = h >>> 0;
	return () => {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------------------------------------
// Blocos Java → Bedrock

/** "nome[k=v,...]" (Java ou Bedrock) → nome + propriedades em texto. */
export function parseStateKey(key: string): { name: string; props: Record<string, string> } {
	const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(key.trim());
	const props: Record<string, string> = {};
	if (!m) return { name: key, props };
	for (const kv of (m[2] ?? "").split(",").filter(Boolean)) {
		const eq = kv.indexOf("=");
		props[kv.slice(0, eq)] = kv.slice(eq + 1);
	}
	return { name: m[1], props };
}

export function javaKey(name: string, props: Record<string, string> = {}): string {
	return `${name}[${Object.keys(props).sort().map((k) => `${k}=${props[k]}`).join(",")}]`;
}

/** Valor de estado do Bedrock a partir do texto da tabela (true/false → bool; inteiro → int; resto → string). */
export function typedState(v: string): StateValue {
	if (v === "true") return true;
	if (v === "false") return false;
	if (/^-?\d+$/.test(v)) return Number(v);
	return v;
}

export type CobblemonStateMapper = (javaId: string, props: Record<string, string>) => BedrockBlock | undefined;

export class BlockMapper {
	private table: Record<string, string>;
	private cobblemon: CobblemonStateMapper;
	readonly missing = new Set<string>();

	constructor(cobblemon: CobblemonStateMapper, table?: Record<string, string>) {
		this.cobblemon = cobblemon;
		this.table = table ?? readJson(join(ROOT, "tools", "importer", "data", "java_bedrock_blocks.json")).blocks;
	}

	/** Bloco Bedrock de um estado Java; undefined = sem equivalente (a posição fica sem mudança). */
	map(name: string, props: Record<string, string>): BedrockBlock | undefined {
		if (name.startsWith("cobblemon:")) {
			const b = this.cobblemon(name, props);
			if (!b) this.missing.add(name);
			return b;
		}
		const plain = { ...props };
		delete plain.waterlogged;
		const key = javaKey(name, props);
		const hit = this.table[key] ?? this.table[javaKey(name, { ...plain, waterlogged: "false" })] ?? this.table[javaKey(name, plain)];
		if (hit) {
			const b = parseStateKey(hit);
			return { name: b.name, states: Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, typedState(v)])) };
		}
		// Sem a tabela: o mesmo nome sem estados, se o bloco existe no Bedrock.
		if (VANILLA_BLOCKS.has(name)) return { name, states: {} };
		this.missing.add(key);
		return undefined;
	}
}

// ---------------------------------------------------------------------------------------------
// Processadores (StructureProcessorList)

function stateMatches(b: PlacedBlock, state: { Name: string; Properties?: Record<string, string> }): boolean {
	if (b.name !== state.Name) return false;
	return Object.entries(state.Properties ?? {}).every(([k, v]) => b.props[k] === v);
}

/** Predicado de entrada de uma regra (RuleTest) contra o bloco do molde. Undefined = não suportado. */
function inputMatches(test: any, b: PlacedBlock, random: () => number): boolean | undefined {
	const type = String(test?.predicate_type ?? "").replace(/^minecraft:/, "");
	switch (type) {
		case "always_true": return true;
		case "block_match": return b.name === test.block;
		case "random_block_match": return b.name === test.block && random() < Number(test.probability ?? 1);
		case "blockstate_match": return stateMatches(b, test.block_state);
		case "random_blockstate_match": return stateMatches(b, test.block_state) && random() < Number(test.probability ?? 1);
		default: return undefined;
	}
}

/** RuleProcessor.processBlock: 1ª regra que casa troca o bloco (e grava a loot do append_loot). */
function applyRule(proc: any, b: PlacedBlock, random: () => number): PlacedBlock | undefined {
	for (const rule of proc.rules ?? []) {
		const input = inputMatches(rule.input_predicate, b, random);
		if (input === undefined) {
			warn("predicado de processador sem equivalente (regra ignorada)", String(rule.input_predicate?.predicate_type));
			continue;
		}
		if (!input) continue;
		// Posição no mundo (location_predicate) não existe na conversão: só always_true vale.
		const loc = String(rule.location_predicate?.predicate_type ?? "minecraft:always_true").replace(/^minecraft:/, "");
		if (loc !== "always_true") continue;
		const out = rule.output_state ?? {};
		const next: PlacedBlock = { pos: b.pos, name: String(out.Name ?? b.name), props: { ...(out.Properties ?? {}) } };
		// RuleProcessor.getOutputTag: sem modificador (passthrough) o NBT do bloco original continua.
		if (b.nbt) next.nbt = b.nbt;
		const modifier = rule.block_entity_modifier;
		if (String(modifier?.type ?? "").endsWith("append_loot")) next.loot = String(modifier.loot_table);
		else if (b.loot && next.name === b.name) next.loot = b.loot;
		return next;
	}
	return undefined;
}

function sameBlock(a: PlacedBlock, b: PlacedBlock): boolean {
	return a.name === b.name && a.loot === b.loot && javaKey(a.name, a.props) === javaKey(b.name, b.props);
}

function intOf(v: any, random: () => number): number {
	if (typeof v === "number") return v;
	if (v && typeof v === "object") {
		const type = String(v.type ?? "").replace(/^minecraft:/, "");
		if (type === "constant") return Number(v.value);
		if (type === "uniform") {
			const lo = Number(v.min_inclusive ?? v.value?.min_inclusive ?? 0), hi = Number(v.max_inclusive ?? v.value?.max_inclusive ?? lo);
			return lo + Math.floor(random() * (hi - lo + 1));
		}
	}
	return 0;
}

/** Aplica a lista de processadores (rule e capped) aos blocos, na ordem, como StructureTemplate.processBlockInfos. */
export function applyProcessors(blocks: PlacedBlock[], processors: any[], random: () => number): PlacedBlock[] {
	let list = blocks.slice();
	for (const proc of processors) {
		const type = String(proc.processor_type ?? "").replace(/^minecraft:/, "");
		if (type === "rule") {
			list = list.map((b) => applyRule(proc, b, random) ?? b);
		} else if (type === "capped") {
			// CappedProcessor.finalizeProcessing: ordem embaralhada, delegado até `limit` blocos mudarem.
			const limit = intOf(proc.limit, random);
			const delegate = proc.delegate ?? {};
			if (String(delegate.processor_type ?? "").replace(/^minecraft:/, "") !== "rule") {
				warn("processador capped com delegado sem equivalente", String(delegate.processor_type));
				continue;
			}
			const order = list.map((_, i) => i);
			for (let i = order.length - 1; i > 0; i--) {
				const j = Math.floor(random() * (i + 1));
				[order[i], order[j]] = [order[j], order[i]];
			}
			let changed = 0;
			for (const i of order) {
				if (changed >= limit) break;
				const next = applyRule(delegate, list[i], random);
				if (next && !sameBlock(next, list[i])) {
					list[i] = next;
					changed++;
				}
			}
		} else {
			count(`processadores de estrutura sem equivalente (${type})`);
		}
	}
	return list;
}

// ---------------------------------------------------------------------------------------------
// Molde → .mcstructure

export interface ConvertOptions {
	mapper: BlockMapper;
	/** Índice de cada habitat pool no estado do bloco (HABITAT_POOLS). */
	poolIndex?: Map<string, number>;
	/** Loot table Java → caminho da loot table no BP (ou undefined para não gravar). */
	lootPath?: (javaLoot: string) => string | undefined;
	/**
	 * Frente motor: mantém o bloco jigsaw (peça de jigsaw data-driven). Devolve o bloco Bedrock e o block entity
	 * (JigsawBlock); undefined = usar o final_state como antes.
	 */
	keepJigsaw?: (b: PlacedBlock) => { block: BedrockBlock; entity: Record<string, NbtTyped> } | undefined;
	/** legacy_single_pool_element: ar do molde não substitui o terreno. */
	skipAir?: boolean;
}

export interface ConvertedStructure {
	size: [number, number, number];
	palette: BedrockBlock[];
	layer0: Int32Array;
	layer1: Int32Array;
	/** Índice do bloco (ordem do .mcstructure) → block_entity_data. */
	blockEntities: Map<number, Record<string, NbtTyped>>;
	/** Bloco de habitat âncora: pool e alcance (blocos). */
	habitat?: { poolId: string; range: number; pos: [number, number, number] };
	/** Loot tables do Java referenciadas pelos block entities. */
	lootRefs: Set<string>;
	/** Índice → atraso do 1º tick agendado (blocos com minecraft:tick colocados por feature não recebem tick sozinhos). */
	ticks: Map<number, number>;
	/** Entidades gravadas no molde (NBT do Bedrock), ex.: marcador de estrutura. */
	entities?: NbtTyped[];
}

/** Posição → índice do .mcstructure (x, depois y, depois z; z varia mais rápido). */
export function structureIndex(size: [number, number, number], x: number, y: number, z: number): number {
	return (x * size[1] + y) * size[2] + z;
}

/** Blocos do molde como estados Java (palette + nbt), antes dos processadores. */
export function templateBlocks(t: JavaTemplate): PlacedBlock[] {
	return t.blocks.map((b) => {
		const p = t.palette[b.state] ?? { Name: "minecraft:air" };
		const out: PlacedBlock = { pos: b.pos, name: p.Name, props: { ...(p.Properties ?? {}) } };
		if (b.nbt) out.nbt = b.nbt;
		if (typeof b.nbt?.LootTable === "string") out.loot = b.nbt.LootTable;
		return out;
	});
}

const SOLID_HINT = /stone|dirt|deepslate|sand|gravel|clay|mud|terracotta|ore|netherrack|basalt|tuff|calcite|grass_block|mycelium|podzol|snow_block|ice|end_stone|blackstone/;

/** Converte blocos já processados num .mcstructure. */
export function convertBlocks(size: [number, number, number], blocks: PlacedBlock[], opts: ConvertOptions): ConvertedStructure {
	const total = size[0] * size[1] * size[2];
	const layer0 = new Int32Array(total).fill(-1);
	const layer1 = new Int32Array(total).fill(-1);
	const palette: BedrockBlock[] = [];
	const paletteIndex = new Map<string, number>();
	const blockEntities = new Map<number, Record<string, NbtTyped>>();
	const lootRefs = new Set<string>();
	const ticks = new Map<number, number>();
	const indexOf = (b: BedrockBlock) => {
		const key = `${b.name}|${JSON.stringify(Object.entries(b.states).sort())}`;
		let i = paletteIndex.get(key);
		if (i === undefined) {
			i = palette.length;
			palette.push(b);
			paletteIndex.set(key, i);
		}
		return i;
	};
	// Blocos de habitat: o mais enterrado vira a âncora; os outros, o bloco imitado.
	// Só os naturais com pool de dados (os ativados/"custom" de alguns moldes viram o bloco imitado).
	const habitats = blocks.filter((b) => b.name === "cobblemon:habitat_block" && opts.poolIndex?.has(String(b.nbt?.PoolId ?? "")));
	let anchor: PlacedBlock | undefined;
	let habitat: ConvertedStructure["habitat"];
	if (habitats.length) {
		const at = new Map(blocks.map((b) => [b.pos.join(","), b]));
		const buried = (b: PlacedBlock) => {
			let n = 0;
			for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
				const o = at.get(`${b.pos[0] + dx},${b.pos[1] + dy},${b.pos[2] + dz}`);
				if (o && (o.name === "cobblemon:habitat_block" || SOLID_HINT.test(o.name))) n++;
			}
			return n * 1000 - b.pos[1];
		};
		anchor = habitats.reduce((best, b) => (buried(b) > buried(best) ? b : best));
		const poolId = String(anchor.nbt?.PoolId ?? "");
		let range = 0;
		for (const h of habitats) {
			const d = Math.hypot(h.pos[0] - anchor.pos[0], h.pos[1] - anchor.pos[1], h.pos[2] - anchor.pos[2]);
			range = Math.max(range, Math.ceil(d + Number(h.nbt?.RangeOfInfluence ?? 16)));
		}
		habitat = { poolId, range, pos: anchor.pos };
	}
	const air = { name: "minecraft:air", states: {} };
	const water = opts.mapper.map("minecraft:water", { level: "0" }) ?? { name: "minecraft:water", states: { liquid_depth: 0 } };
	for (const b of blocks) {
		const [x, y, z] = b.pos;
		if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) continue;
		const idx = structureIndex(size, x, y, z);
		let { name, props } = b;
		if (name === "minecraft:jigsaw" && opts.keepJigsaw) {
			const kept = opts.keepJigsaw(b);
			if (kept) {
				layer0[idx] = indexOf(kept.block);
				blockEntities.set(idx, kept.entity);
				continue;
			}
		}
		if (name === "minecraft:jigsaw") {
			const final = parseStateKey(String(b.nbt?.final_state ?? "minecraft:structure_void"));
			name = final.name;
			props = final.props;
		}
		if (name === "minecraft:structure_void") continue;
		let bedrock: BedrockBlock | undefined;
		if (name === "cobblemon:habitat_block") {
			if (b === anchor) {
				bedrock = opts.mapper.map(name, props);
				const index = opts.poolIndex?.get(habitat!.poolId) ?? 0;
				if (bedrock) bedrock = { name: bedrock.name, states: { ...bedrock.states, "cobblemon:habitat_pool": index % 16, "cobblemon:habitat_pool_hi": Math.floor(index / 16) } };
				// O tick do bloco (registro no detector de habitats) precisa ser agendado no molde.
				ticks.set(idx, 10);
			} else {
				const mimic = String(b.nbt?.MimicId ?? "minecraft:stone");
				bedrock = opts.mapper.map(mimic, {});
			}
		} else if (name === "minecraft:air" || name === "minecraft:cave_air" || name === "minecraft:void_air") {
			if (opts.skipAir) continue;
			bedrock = air;
		} else {
			bedrock = opts.mapper.map(name, props);
		}
		if (!bedrock) continue;
		layer0[idx] = indexOf(bedrock);
		if (props.waterlogged === "true") layer1[idx] = indexOf(water);
		const be = blockEntityFor(name, bedrock, b, opts, lootRefs);
		if (be) blockEntities.set(idx, be);
	}
	return { size, palette, layer0, layer1, blockEntities, habitat, lootRefs, ticks };
}

/** Block entity do Bedrock para baús/barris com loot, blocos suspeitos e spawners. */
function blockEntityFor(javaName: string, bedrock: BedrockBlock, b: PlacedBlock, opts: ConvertOptions, lootRefs: Set<string>): Record<string, NbtTyped> | undefined {
	const lootOf = () => {
		if (!b.loot) return undefined;
		lootRefs.add(b.loot);
		return opts.lootPath?.(b.loot);
	};
	const base = (id: string): Record<string, NbtTyped> => ({ id: nbt.string(id), isMovable: nbt.byte(1) });
	if (/^minecraft:(chest|trapped_chest|barrel)$/.test(javaName)) {
		const loot = lootOf();
		if (!loot) return undefined;
		const id = javaName === "minecraft:barrel" ? "Barrel" : "Chest";
		return { ...base(id), LootTable: nbt.string(loot), LootTableSeed: nbt.int(0), Items: nbt.list("compound", []), Findable: nbt.byte(0) };
	}
	if (/^minecraft:suspicious_(sand|gravel)$/.test(javaName)) {
		const loot = lootOf();
		if (!loot) return undefined;
		return { ...base("BrushableBlock"), LootTable: nbt.string(loot), LootTableSeed: nbt.int(0), type: nbt.string(bedrock.name), brush_count: nbt.int(0), brush_direction: nbt.byte(6) };
	}
	if (javaName === "minecraft:spawner") {
		const entity = String(b.nbt?.SpawnData?.entity?.id ?? "");
		if (!entity.startsWith("minecraft:")) return undefined;
		return { ...base("MobSpawner"), EntityIdentifier: nbt.string(entity), Delay: nbt.short(20), MinSpawnDelay: nbt.short(200), MaxSpawnDelay: nbt.short(800), SpawnCount: nbt.short(4), MaxNearbyEntities: nbt.short(6), RequiredPlayerRange: nbt.short(16), SpawnRange: nbt.short(4) };
	}
	return undefined;
}

/** Monta o arquivo .mcstructure (NBT little-endian do Bedrock). */
export function writeMcstructure(s: ConvertedStructure): Buffer {
	const stateTag = (v: StateValue): NbtTyped => (typeof v === "boolean" ? nbt.byte(v ? 1 : 0) : typeof v === "number" ? nbt.int(v) : nbt.string(v));
	const positionData: Record<string, NbtTyped> = {};
	for (const idx of new Set([...s.blockEntities.keys(), ...s.ticks.keys()])) {
		const entry: Record<string, NbtTyped> = {};
		const data = s.blockEntities.get(idx);
		if (data) entry.block_entity_data = nbt.compound(data);
		const delay = s.ticks.get(idx);
		if (delay !== undefined) entry.tick_queue_data = nbt.list("compound", [nbt.compound({ tick_delay: nbt.int(delay) })]);
		positionData[String(idx)] = nbt.compound(entry);
	}
	const ints = (a: Int32Array) => nbt.list("int", Array.from(a, (v) => nbt.int(v)));
	return writeBedrockNbt({
		format_version: nbt.int(1),
		size: nbt.list("int", s.size.map((v) => nbt.int(v))),
		structure: nbt.compound({
			block_indices: nbt.list("list", [ints(s.layer0), ints(s.layer1)]),
			entities: nbt.list("compound", s.entities ?? []),
			palette: nbt.compound({
				default: nbt.compound({
					block_palette: nbt.list("compound", s.palette.map((b) => nbt.compound({
						name: nbt.string(b.name),
						states: nbt.compound(Object.fromEntries(Object.entries(b.states).map(([k, v]) => [k, stateTag(v)]))),
						version: nbt.int(BLOCK_VERSION),
					}))),
					block_position_data: nbt.compound(positionData),
				}),
			}),
		}),
		structure_world_origin: nbt.list("int", [nbt.int(0), nbt.int(0), nbt.int(0)]),
	});
}

// ---------------------------------------------------------------------------------------------
// Features

/** CobblemonPlacedFeatures.kt: placed feature → tag de bioma (#...) e passo de geração. */
export function placedFeatureBiomeTags(): Map<string, { tag: string; step: string }> {
	const out = new Map<string, { tag: string; step: string }>();
	const placedFile = join(KOTLIN, "world", "feature", "CobblemonPlacedFeatures.kt");
	const tagsFile = join(KOTLIN, "api", "tags", "CobblemonBiomeTags.kt");
	if (!existsSync(placedFile) || !existsSync(tagsFile)) return out;
	const placed = readFileSync(placedFile, "utf8");
	const tags = readFileSync(tagsFile, "utf8");
	const tagPaths = new Map<string, string>();
	for (const m of tags.matchAll(/val\s+(\w+)\s*=\s*create\("([^"]+)"\)/g)) tagPaths.set(m[1], `cobblemon:${m[2]}`);
	const ids = new Map<string, string>();
	for (const m of placed.matchAll(/val\s+(\w+)\s*=\s*of\("([^"]+)"\)/g)) ids.set(m[1], m[2]);
	for (const m of placed.matchAll(/addFeatureToWorldGen\((\w+),\s*GenerationStep\.Decoration\.(\w+),\s*([\w.]+)\)/g)) {
		const id = ids.get(m[1]);
		if (!id) continue;
		let tag = "";
		if (m[3].startsWith("BiomeTags.")) tag = `minecraft:${m[3].slice("BiomeTags.".length).toLowerCase()}`;
		else if (m[3].startsWith("CobblemonBiomeTags.")) tag = tagPaths.get(m[3].slice("CobblemonBiomeTags.".length)) ?? "";
		out.set(id, { tag, step: m[2] });
	}
	return out;
}

/** Blocos que as estruturas subterrâneas podem atravessar (block_intersection). */
const UNDERGROUND_ALLOW: Record<string, string[]> = {
	overworld: ["minecraft:air", "minecraft:stone", "minecraft:deepslate", "minecraft:tuff", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:dirt", "minecraft:gravel", "minecraft:clay", "minecraft:water", "minecraft:calcite", "minecraft:dripstone_block", "minecraft:pointed_dripstone", "minecraft:moss_block", "minecraft:sculk", "minecraft:cobbled_deepslate"],
	nether: ["minecraft:air", "minecraft:netherrack", "minecraft:basalt", "minecraft:blackstone", "minecraft:soul_sand", "minecraft:soul_soil", "minecraft:magma", "minecraft:gravel", "minecraft:lava", "minecraft:crimson_nylium", "minecraft:warped_nylium"],
	end: ["minecraft:air", "minecraft:end_stone"],
};

export interface PlacementRule { iterations: number; chance?: number; y: unknown; pass: string; surface: boolean; yOffset: number }

/** placed_feature do Java → distribuição da feature rule do Bedrock. */
export function placementOf(list: any[], dim: "overworld" | "nether" | "end"): PlacementRule {
	let iterations = 1, chance: number | undefined, yOffset = 0;
	let y: unknown;
	let surface = false;
	const bottom = dim === "nether" ? 0 : dim === "end" ? 0 : -64;
	const top = dim === "nether" ? 128 : dim === "end" ? 256 : 320;
	const anchor = (a: any) => (a?.absolute !== undefined ? Number(a.absolute) : a?.above_bottom !== undefined ? bottom + Number(a.above_bottom) : a?.below_top !== undefined ? top - 1 - Number(a.below_top) : 0);
	for (const p of list) {
		const type = String(p.type ?? "").replace(/^minecraft:/, "");
		if (type === "count") iterations = typeof p.count === "number" ? p.count : Number(p.count?.max_inclusive ?? 1);
		else if (type === "rarity_filter") chance = 1 / Number(p.chance ?? 1);
		else if (type === "heightmap") surface = true;
		else if (type === "height_range") {
			const h = p.height ?? {};
			const lo = Math.max(bottom, anchor(h.min_inclusive)), hi = Math.min(top, anchor(h.max_inclusive));
			// O Bedrock recusa extent com mínimo >= máximo: altura fixa vira número.
			y = hi > lo ? { distribution: "uniform", extent: [lo, hi] } : lo;
		} else if (type === "random_offset") yOffset = typeof p.y_spread === "number" ? p.y_spread : 0;
	}
	if (surface) y = yOffset ? `q.heightmap(v.worldx, v.worldz) ${yOffset < 0 ? "-" : "+"} ${Math.abs(yOffset)}` : "q.heightmap(v.worldx, v.worldz)";
	return { iterations, chance, y: y ?? { distribution: "uniform", extent: [bottom, 64] }, pass: surface ? "surface_pass" : "underground_pass", surface, yOffset };
}

export interface StructureStats {
	templates: number;
	features: number;
	rules: number;
	skipped: string[];
	anchorRanges: Map<string, number>;
}

/** Loot tables citadas pelos block entities das estruturas (baús, blocos suspeitos): caminho no BP + conversão. */
export class StructureLoot {
	readonly cobblemon = new Set<string>();

	/** Id do Java → caminho da loot table no BP (as do Cobblemon são convertidas em emit()). */
	readonly path = (id: string): string | undefined => {
		const { ns, path } = splitId(id, "minecraft");
		if (ns === "cobblemon") {
			this.cobblemon.add(path);
			return `loot_tables/cobblemon/${path}.json`;
		}
		return `loot_tables/${VANILLA_LOOT_RENAMES[path] ?? path}.json`;
	};

	/** Converte as tabelas do Cobblemon citadas e as aninhadas nelas. */
	emit(mapItem: ItemIdMapper): number {
		const done = new Set<string>();
		const queue = [...this.cobblemon];
		while (queue.length) {
			const path = queue.shift()!;
			if (done.has(path)) continue;
			done.add(path);
			const file = `${DATA}/cobblemon/loot_table/${path}.json`;
			if (!existsSync(file)) {
				warn("loot table de estrutura ausente", path);
				continue;
			}
			emitLoot(`cobblemon/${path}`, convertLoot(readJson(file), {}, mapItem), true);
			for (const nested of takeNestedLootRefs()) queue.push(nested);
		}
		count("loot tables de estruturas", done.size);
		return done.size;
	}
}

/** Converte as features `cobblemon:structure` (moldes + colocação). */
export function buildStructures(opts: { mapper: BlockMapper; biomes: BiomeResolver; poolIndex: Map<string, number>; loot: StructureLoot }): StructureStats {
	const stats: StructureStats = { templates: 0, features: 0, rules: 0, skipped: [], anchorRanges: new Map() };
	const cfgBase = `${DATA}/cobblemon/worldgen/configured_feature/`;
	const placedBase = `${DATA}/cobblemon/worldgen/placed_feature/`;
	const biomeTags = placedFeatureBiomeTags();
	const lootPath = opts.loot.path;
	const converted = new Map<string, string>();
	for (const file of walk(placedBase, (n) => n.endsWith(".json"))) {
		const placedId = file.slice(placedBase.length, -5);
		const placed = readJson(file);
		const cfgFile = `${cfgBase}${splitId(String(placed.feature)).path}.json`;
		if (!existsSync(cfgFile)) continue;
		const cfg = readJson(cfgFile);
		if (cfg.type !== "cobblemon:structure") continue;
		const category = placedId.split("/")[0];
		const procId = splitId(String(cfg.config?.cobblemon_processors ?? "")).path;
		const procFile = `${DATA}/cobblemon/worldgen/processor_list/${procId}.json`;
		const processors = existsSync(procFile) ? readJson(procFile).processors ?? [] : [];
		const reg = biomeTags.get(placedId);
		const biomes = reg?.tag ? opts.biomes.resolve(`#${reg.tag}`) : [];
		const dim = /nether|wasteland|soul_sand/.test(reg?.tag ?? "") ? "nether" : /is_end/.test(reg?.tag ?? "") ? "end" : "overworld";
		const members: string[] = [];
		for (const templateId of cfg.config?.cobblemon_structures ?? []) {
			const tpath = splitId(String(templateId)).path;
			const nbtFile = `${DATA}/cobblemon/structure/${tpath}.nbt`;
			if (!existsSync(nbtFile)) {
				warn("molde de estrutura ausente", tpath);
				continue;
			}
			const structureName = `${category}_${tpath.split("/").pop()}`.replace(/[^a-z0-9_]/g, "_");
			let feature = converted.get(`${tpath}|${procId}`);
			if (!feature) {
				const template = readJavaNbt(readFileSync(nbtFile)) as unknown as JavaTemplate;
				const random = seededRandom(`${tpath}|${procId}`);
				const blocks = applyProcessors(templateBlocks(template), processors, random);
				const s = convertBlocks(template.size, blocks, { mapper: opts.mapper, poolIndex: opts.poolIndex, lootPath });
				if (s.habitat?.poolId) stats.anchorRanges.set(s.habitat.poolId, Math.max(stats.anchorRanges.get(s.habitat.poolId) ?? 0, s.habitat.range));
				if ((template.entities ?? []).length) count("entidades de molde de estrutura ignoradas", (template.entities ?? []).length);
				const out = join(OUT_BP, "structures", "cobblemon", `${structureName}.mcstructure`);
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, writeMcstructure(s));
				stats.templates++;
				const constraints: Record<string, unknown> = placementOf(placed.placement ?? [], dim).surface
					? { grounded: {} }
					: { block_intersection: { block_allowlist: UNDERGROUND_ALLOW[dim] } };
				feature = `cobblemon:structure_${structureName}`;
				writeJson(`${OUT_BP}/features/cobblemon/structure_${structureName}.json`, {
					format_version: FEATURE_FORMAT,
					"minecraft:structure_template_feature": {
						description: { identifier: feature },
						structure_name: `cobblemon:${structureName}`,
						adjustment_radius: 4,
						facing_direction: "random",
						constraints,
					},
				});
				stats.features++;
				converted.set(`${tpath}|${procId}`, feature);
			}
			members.push(feature);
		}
		if (!members.length) continue;
		const featureName = placedId.replace(/\//g, "_");
		let top = members[0];
		if (members.length > 1) {
			top = `cobblemon:placed_${featureName}`;
			writeJson(`${OUT_BP}/features/cobblemon/placed_${featureName}.json`, {
				format_version: FEATURE_FORMAT,
				"minecraft:weighted_random_feature": { description: { identifier: top }, features: members.map((m) => [m, 1]) },
			});
			stats.features++;
		}
		const filter = biomes.length ? biomeFilter(biomes) : undefined;
		if (!filter) {
			stats.skipped.push(`${placedId}: sem bioma no Bedrock (${reg?.tag ?? "sem registro"})`);
			continue;
		}
		const p = placementOf(placed.placement ?? [], dim);
		const distribution: Record<string, unknown> = {
			iterations: p.iterations,
			coordinate_eval_order: "zyx",
			x: { distribution: "uniform", extent: [0, 16] },
			y: p.y,
			z: { distribution: "uniform", extent: [0, 16] },
		};
		if (p.chance !== undefined && p.chance < 1) distribution.scatter_chance = { numerator: 1, denominator: Math.max(1, Math.round(1 / p.chance)) };
		writeJson(`${OUT_BP}/feature_rules/cobblemon/structure_${featureName}.json`, {
			format_version: FEATURE_FORMAT,
			"minecraft:feature_rules": {
				description: { identifier: `cobblemon:structure_${featureName}`, places_feature: top },
				conditions: { placement_pass: p.pass, "minecraft:biome_filter": filter },
				distribution,
			},
		});
		stats.rules++;
	}
	count("estruturas (.mcstructure)", stats.templates);
	count("features de estrutura", stats.features);
	count("feature_rules de estrutura", stats.rules);
	return stats;
}
