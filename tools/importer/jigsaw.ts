// Estruturas jigsaw do Cobblemon 1.8.2 (worldgen/structure, 67).
//
// Frente motor: viram jigsaw DATA-DRIVEN do Bedrock (estável sem experimentos desde a 1.21.120) — ver
// buildJigsawStructures no fim do arquivo. O montador abaixo (JigsawPlacement.addPieces + Placer.tryPlacingChildren
// com semente fixa) ficou como referência/teste da semântica do Java e não gera mais arquivos:
// - peça inicial sorteada no start_pool com rotação aleatória; filhos por jigsaw (canAttach: frentes opostas,
//   `target` do pai = `name` do filho, joint rollable/aligned), pools com fallback, prioridade de colocação/seleção,
//   profundidade `size`, caixa livre de `max_distance_from_center` e peças "dentro" do pai (innerFree).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nbt, readJavaNbt } from "./nbt.ts";
import type { NbtTyped } from "./nbt.ts";
import type { BiomeResolver } from "./worldgen.ts";
import { biomeFilter } from "./vanilla.ts";
import {
	applyProcessors, convertBlocks, parseStateKey, seededRandom, templateBlocks, writeMcstructure,
} from "./structures.ts";
import type { BlockMapper, ConvertedStructure, PlacedBlock } from "./structures.ts";
import { DATA, OUT_BP, OUT_SCRIPTS, count, readJson, splitId, walk, warn, writeJson, writeText } from "./util.ts";
import { villageStructures } from "./villages.ts"; // frente vilas

const HORIZONTAL = ["north", "east", "south", "west"];
const STEP: Record<string, [number, number, number]> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPPOSITE: Record<string, string> = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };

export type V3 = [number, number, number];
export interface Box { min: V3; max: V3 }

interface JavaTemplate { size: V3; palette: Array<{ Name: string; Properties?: Record<string, string> }>; blocks: Array<{ pos: V3; state: number; nbt?: Record<string, any> }>; entities?: unknown[] }

// ---------------------------------------------------------------------------------------------
// Rotação (Rotation.CLOCKWISE_90 × k, pivô na origem do molde)

/** StructureTemplate.transform com pivô (0,0,0): k passos de 90° no sentido horário. */
export function rotatePos(p: V3, k: number): V3 {
	const [x, y, z] = p;
	switch (((k % 4) + 4) % 4) {
		case 1: return [-z, y, x];
		case 2: return [-x, y, -z];
		case 3: return [z, y, -x];
		default: return [x, y, z];
	}
}

export function rotateDir(d: string, k: number): string {
	const i = HORIZONTAL.indexOf(d);
	return i < 0 ? d : HORIZONTAL[(i + k) % 4];
}

const RAIL_CURVES = ["south_east", "south_west", "north_west", "north_east"];

/** BlockState.rotate para as propriedades comuns (facing, axis, rotation, lados, orientation, trilhos). */
export function rotateProps(props: Record<string, string>, k: number): Record<string, string> {
	k = ((k % 4) + 4) % 4;
	if (!k) return props;
	const out: Record<string, string> = { ...props };
	for (const key of ["facing", "horizontal_facing"]) if (props[key]) out[key] = rotateDir(props[key], k);
	if (props.axis && k % 2 === 1) out.axis = props.axis === "x" ? "z" : props.axis === "z" ? "x" : props.axis;
	if (props.rotation !== undefined && /^\d+$/.test(props.rotation)) out.rotation = String((Number(props.rotation) + 4 * k) % 16);
	if (props.orientation) out.orientation = props.orientation.split("_").map((d) => rotateDir(d, k)).join("_");
	if (HORIZONTAL.some((d) => props[d] !== undefined)) for (const d of HORIZONTAL) if (props[d] !== undefined) out[rotateDir(d, k)] = props[d];
	if (props.shape && /_/.test(props.shape) && !/^(straight|inner_|outer_)/.test(props.shape)) {
		const s = props.shape;
		if (s === "north_south" || s === "east_west") out.shape = k % 2 ? (s === "north_south" ? "east_west" : "north_south") : s;
		else if (s.startsWith("ascending_")) out.shape = `ascending_${rotateDir(s.slice(10), k)}`;
		else {
			const parts = s.split("_").map((d) => rotateDir(d, k));
			out.shape = RAIL_CURVES.find((c) => parts.every((p) => c.includes(p))) ?? s;
		}
	}
	return out;
}

/** Caixa de um molde rotacionado e deslocado (StructureTemplate.getBoundingBox). */
export function templateBox(size: V3, k: number, at: V3): Box {
	const a = rotatePos([0, 0, 0], k), b = rotatePos([size[0] - 1, size[1] - 1, size[2] - 1], k);
	return {
		min: [Math.min(a[0], b[0]) + at[0], Math.min(a[1], b[1]) + at[1], Math.min(a[2], b[2]) + at[2]],
		max: [Math.max(a[0], b[0]) + at[0], Math.max(a[1], b[1]) + at[1], Math.max(a[2], b[2]) + at[2]],
	};
}

const inside = (b: Box, p: V3) => p.every((v, i) => v >= b.min[i] && v <= b.max[i]);
/** Interseção com a caixa encolhida 0,25 (AABB.deflate) = sobreposição de pelo menos um bloco. */
const overlaps = (a: Box, b: Box) => a.min.every((v, i) => v <= b.max[i] && a.max[i] >= b.min[i]);
const within = (a: Box, outer: Box) => a.min.every((v, i) => v >= outer.min[i] && a.max[i] <= outer.max[i]);

// ---------------------------------------------------------------------------------------------
// Pools e moldes

interface PoolElement { type: string; location?: string; processors?: any; projection?: string; elements?: PoolElement[] }
interface Pool { elements: Array<{ weight: number; element: PoolElement }>; fallback?: string }

export class JigsawSource {
	private pools = new Map<string, Pool | undefined>();
	private templates = new Map<string, JavaTemplate | undefined>();
	private processorLists = new Map<string, any[]>();

	/** Frente vilas: pool sintético (não vem de arquivo), ex.: as peças de vila que viram estruturas próprias. */
	addPool(id: string, pool: Pool): void {
		this.pools.set(id, pool);
	}

	/** Frente vilas: lista de processadores sintética (ex.: crop_to_berry traduzido em regras, um par por lista). */
	addProcessorList(id: string, processors: any[]): void {
		this.processorLists.set(id, processors);
	}

	pool(id: string): Pool | undefined {
		if (this.pools.has(id)) return this.pools.get(id);
		const { ns, path } = splitId(id, "minecraft");
		const file = `${DATA}/${ns}/worldgen/template_pool/${path}.json`;
		const pool = ns === "cobblemon" && existsSync(file) ? (readJson(file) as Pool) : undefined;
		this.pools.set(id, pool);
		return pool;
	}

	template(id: string): JavaTemplate | undefined {
		if (this.templates.has(id)) return this.templates.get(id);
		const { ns, path } = splitId(id, "minecraft");
		const file = `${DATA}/${ns}/structure/${path}.nbt`;
		const t = existsSync(file) ? (readJavaNbt(readFileSync(file)) as unknown as JavaTemplate) : undefined;
		if (!t) warn("molde de estrutura jigsaw ausente", id);
		this.templates.set(id, t);
		return t;
	}

	processors(ref: any): any[] {
		if (!ref) return [];
		if (typeof ref === "object") return ref.processors ?? [];
		const id = String(ref);
		let list = this.processorLists.get(id);
		if (!list) {
			const { ns, path } = splitId(id, "minecraft");
			const file = `${DATA}/${ns}/worldgen/processor_list/${path}.json`;
			list = existsSync(file) ? readJson(file).processors ?? [] : [];
			this.processorLists.set(id, list!);
		}
		return list!;
	}
}

/** StructureTemplatePool.getShuffledTemplates: cada elemento repetido pelo peso, embaralhado. */
function shuffled<T>(items: T[], random: () => number): T[] {
	const out = items.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function weightedList(pool: Pool): PoolElement[] {
	return pool.elements.flatMap((e) => Array.from({ length: Math.max(0, Number(e.weight ?? 1)) }, () => e.element));
}

// ---------------------------------------------------------------------------------------------
// Montagem

interface JigsawInfo { pos: V3; front: string; top: string; name: string; target: string; pool: string; joint: string; selection: number; placement: number }

interface Piece {
	element: PoolElement;
	/** Moldes da peça (list_pool_element tem vários). */
	parts: Array<{ template: JavaTemplate; processors: any[]; legacy: boolean }>;
	rot: number;
	pos: V3;
	box: Box;
	depth: number;
}

function elementParts(el: PoolElement, src: JigsawSource): Piece["parts"] | undefined {
	const type = String(el.type ?? el["element_type" as keyof PoolElement] ?? "");
	const t = type.replace(/^minecraft:/, "");
	if (t === "single_pool_element" || t === "legacy_single_pool_element") {
		const template = el.location ? src.template(el.location) : undefined;
		if (!template) return undefined;
		return [{ template, processors: src.processors(el.processors), legacy: t.startsWith("legacy") }];
	}
	if (t === "list_pool_element") {
		const parts = (el.elements ?? []).flatMap((x) => elementParts(x, src) ?? []);
		return parts.length ? parts : undefined;
	}
	return undefined; // empty_pool_element / feature_pool_element
}

function elementType(el: PoolElement): string {
	return String((el as any).element_type ?? el.type ?? "").replace(/^minecraft:/, "");
}

/** Jigsaws de uma peça na rotação/posição dadas, embaralhados e ordenados pela prioridade de seleção. */
function jigsawsOf(parts: Piece["parts"], rot: number, at: V3, random: () => number): JigsawInfo[] {
	const out: JigsawInfo[] = [];
	for (const { template } of parts.slice(0, 1)) {
		for (const b of template.blocks) {
			const p = template.palette[b.state];
			if (p?.Name !== "minecraft:jigsaw" || !b.nbt) continue;
			const [front, top] = String(rotateProps(p.Properties ?? {}, rot).orientation ?? "north_up").split("_");
			const r = rotatePos(b.pos, rot);
			out.push({
				pos: [r[0] + at[0], r[1] + at[1], r[2] + at[2]], front, top,
				name: String(b.nbt.name ?? ""), target: String(b.nbt.target ?? ""), pool: String(b.nbt.pool ?? "minecraft:empty"),
				joint: String(b.nbt.joint ?? (HORIZONTAL.includes(front) ? "aligned" : "rollable")),
				selection: Number(b.nbt.selection_priority ?? 0), placement: Number(b.nbt.placement_priority ?? 0),
			});
		}
	}
	return shuffled(out, random).sort((a, b) => b.selection - a.selection);
}

/** JigsawBlock.canAttach. */
export function canAttach(parent: JigsawInfo, child: JigsawInfo): boolean {
	const rollable = parent.joint === "rollable";
	return parent.front === OPPOSITE[child.front] && (rollable || parent.top === child.top) && parent.target === child.name;
}

export interface Assembly { pieces: Piece[]; box: Box; startBox: Box; /** Fração do start_pool que não é elemento vazio (vazio = a estrutura não nasce). */ startShare: number }

/** JigsawPlacement.addPieces com semente fixa (sem relevo: toda projeção é rígida). */
export function assemble(structure: any, src: JigsawSource, random: () => number): Assembly | undefined {
	const startPool = src.pool(String(structure.start_pool ?? ""));
	if (!startPool?.elements?.length) return undefined;
	// getRandomTemplate: sorteio pelo peso.
	const all = weightedList(startPool);
	// Elemento vazio sorteado = a estrutura não é gerada: aqui entra como fator na chance (startShare).
	const list = all.filter((e) => elementType(e) !== "empty_pool_element");
	if (!list.length) return undefined;
	const startEl = list[Math.floor(random() * list.length)];
	const startParts = startEl ? elementParts(startEl, src) : undefined;
	if (!startParts) return undefined;
	const rot0 = Math.floor(random() * 4);
	const startBox = templateBox(startParts[0].template.size, rot0, [0, 0, 0]);
	const start: Piece = { element: startEl, parts: startParts, rot: rot0, pos: [0, 0, 0], box: startBox, depth: 0 };
	const pieces: Piece[] = [start];
	const maxDepth = Number(structure.size ?? 0);
	const maxDist = Number(structure.max_distance_from_center ?? 80);
	const cx = Math.floor((startBox.min[0] + startBox.max[0]) / 2), cy = Math.floor((startBox.min[1] + startBox.max[1]) / 2), cz = Math.floor((startBox.min[2] + startBox.max[2]) / 2);
	const outer: Box = { min: [cx - maxDist, cy - maxDist, cz - maxDist], max: [cx + maxDist, cy + maxDist, cz + maxDist] };
	// Espaço livre = caixa externa − caixas ocupadas; peças "dentro" do pai usam o espaço interno do pai.
	type Free = { bound: Box; taken: Box[] };
	const outerFree: Free = { bound: outer, taken: [startBox] };
	const queue: Array<{ piece: Piece; free: Free; priority: number; order: number }> = [];
	let order = 0;
	if (maxDepth > 0) queue.push({ piece: start, free: outerFree, priority: 0, order: order++ });
	let guard = 0;
	while (queue.length && guard++ < 2000) {
		queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
		const { piece, free } = queue.shift()!;
		let innerFree: Free | undefined;
		for (const j of jigsawsOf(piece.parts, piece.rot, piece.pos, random)) {
			const step = STEP[j.front] ?? [0, 0, 0];
			const target: V3 = [j.pos[0] + step[0], j.pos[1] + step[1], j.pos[2] + step[2]];
			const pool = src.pool(j.pool);
			if (!pool) continue;
			const fallback = pool.fallback ? src.pool(pool.fallback) : undefined;
			const isInside = inside(piece.box, target);
			const space: Free = isInside ? (innerFree ??= { bound: piece.box, taken: [] }) : free;
			const candidates: PoolElement[] = [];
			if (piece.depth !== maxDepth) candidates.push(...shuffled(weightedList(pool), random));
			if (fallback) candidates.push(...shuffled(weightedList(fallback), random));
			let placed = false;
			for (const cand of candidates) {
				if (elementType(cand) === "empty_pool_element") break;
				const parts = elementParts(cand, src);
				if (!parts) continue;
				for (const rot of shuffled([0, 1, 2, 3], random)) {
					const box0 = templateBox(parts[0].template.size, rot, [0, 0, 0]);
					for (const cj of jigsawsOf(parts, rot, [0, 0, 0], random)) {
						if (!canAttach(j, cj)) continue;
						const offset: V3 = [target[0] - cj.pos[0], target[1] - cj.pos[1], target[2] - cj.pos[2]];
						const box: Box = { min: [box0.min[0] + offset[0], box0.min[1] + offset[1], box0.min[2] + offset[2]], max: [box0.max[0] + offset[0], box0.max[1] + offset[1], box0.max[2] + offset[2]] };
						if (!within(box, space.bound) || space.taken.some((t) => overlaps(t, box))) continue;
						space.taken.push(box);
						const child: Piece = { element: cand, parts, rot, pos: offset, box, depth: piece.depth + 1 };
						pieces.push(child);
						if (child.depth <= maxDepth) queue.push({ piece: child, free: space, priority: j.placement, order: order++ });
						placed = true;
						break;
					}
					if (placed) break;
				}
				if (placed) break;
			}
		}
	}
	const box: Box = {
		min: [0, 1, 2].map((i) => Math.min(...pieces.map((p) => p.box.min[i]))) as V3,
		max: [0, 1, 2].map((i) => Math.max(...pieces.map((p) => p.box.max[i]))) as V3,
	};
	return { pieces, box, startBox, startShare: list.length / all.length };
}

/** Blocos (estado Java) da montagem, na ordem das peças (a de depois sobrescreve), já com processadores. */
export function assemblyBlocks(a: Assembly, random: () => number): { size: V3; blocks: PlacedBlock[] } {
	const size: V3 = [a.box.max[0] - a.box.min[0] + 1, a.box.max[1] - a.box.min[1] + 1, a.box.max[2] - a.box.min[2] + 1];
	const at = new Map<string, PlacedBlock>();
	for (const piece of a.pieces) {
		for (const part of piece.parts) {
			// Processadores e final_state do jigsaw no espaço do molde (como no Java); a rotação vem depois.
			const processed = applyProcessors(templateBlocks(part.template as any), part.processors, random).map((b): PlacedBlock => {
				if (b.name !== "minecraft:jigsaw") return b;
				const final = parseStateKey(String(b.nbt?.final_state ?? "minecraft:structure_void"));
				return { pos: b.pos, name: final.name, props: final.props };
			});
			for (const b of processed) {
				if (b.name === "minecraft:structure_void" || b.name === "minecraft:structure_block") continue;
				if (part.legacy && b.name === "minecraft:air") continue;
				const r = rotatePos(b.pos, piece.rot);
				const placed: PlacedBlock = { ...b, pos: [r[0] + piece.pos[0] - a.box.min[0], r[1] + piece.pos[1] - a.box.min[1], r[2] + piece.pos[2] - a.box.min[2]], props: rotateProps(b.props, piece.rot) };
				at.set(placed.pos.join(","), placed);
			}
		}
	}
	return { size, blocks: [...at.values()] };
}

// ---------------------------------------------------------------------------------------------
// Jigsaw data-driven do Bedrock (frente motor)
//
// Estável sem experimentos desde a 1.21.120 (docs/pesquisa/3-motor.md, T2/T3/T5): worldgen/structures (minecraft:jigsaw),
// worldgen/template_pools (minecraft:template_pool) e worldgen/structure_sets (minecraft:structure_set), com as peças
// em structures/**.mcstructure mantendo os blocos jigsaw. Tradução quase 1:1 do Java:
// - ids sem "/" (o /locate recusa "/", T1): cobblemon:ruins/x → cobblemon:ruins_x (estruturas, pools e conjuntos);
// - `location` do elemento = caminho da peça dentro de structures/ (T3; o id do .mcstructure gera caixa vazia);
// - peça = molde + lista de processadores assada na conversão (semente fixa; rule/capped como em structures.ts);
//   legacy_single_pool_element não troca terreno por ar;
// - bloco jigsaw: orientation Java (frente_topo) → facing_direction + rotation; pool/name/target/final_state/joint e
//   prioridades no block entity JigsawBlock (T5);
// - cada peça leva uma entidade cobblemon:structure_marker (T8: nasce com o worldgen e dispara entityLoad com as tags)
//   com os índices de STRUCTURE_IDS que alcançam a peça e o raio da peça: scripts/world/StructureRegistry.ts registra os
//   chunks cobertos (a granularidade do Java é o chunk: startsForStructure/allReferences) e remove o marcador.

/** Formato dos arquivos de worldgen (estável sem toggle a partir da 1.21.120; testado com 1.21.130). */
export const WORLDGEN_FORMAT = "1.21.130";
/** Entidade marcadora de peça (behavior_packs/CobblemonBedrock/entities/world/structure_marker.json). */
export const STRUCTURE_MARKER = "cobblemon:structure_marker";
/** Pasta das peças dentro de structures/. */
const PIECE_DIR = "cobblemon/jigsaw";
/** Bedrock: facing_direction 0 baixo, 1 cima, 2 norte, 3 sul, 4 oeste, 5 leste. */
const FACING_INDEX: Record<string, number> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
/**
 * `rotation` do jigsaw virado para cima/baixo = direção do "topo" (sul 0, oeste 1, norte 2, leste 3, a ordem de
 * direção 2D do Bedrock). Só importa para joint "aligned" (221 dos 3 695 jigsaws do Cobblemon).
 */
const TOP_ROTATION: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 };

/** Id Java → id Bedrock sem "/" (mesmo namespace). */
export function bedrockWorldgenId(javaId: string): string {
	const { ns, path } = splitId(javaId, "minecraft");
	return `${ns}:${path.replace(/[^a-z0-9_]/g, "_")}`;
}

/** Orientation Java (ex.: "up_north", "west_up") → estados do jigsaw no Bedrock. */
export function jigsawStates(orientation: string): { facing_direction: number; rotation: number } {
	const [front, top] = String(orientation || "north_up").split("_");
	const vertical = front === "up" || front === "down";
	return { facing_direction: FACING_INDEX[front] ?? 2, rotation: vertical ? TOP_ROTATION[top] ?? 0 : 0 };
}

/** start_height do Java (HeightProvider/VerticalAnchor) → start_height do Bedrock. */
export function startHeightOf(h: any): unknown {
	const abs = (a: any) => ({ absolute: Number(a?.absolute ?? 0) });
	if (!h || typeof h !== "object") return { type: "constant", value: { absolute: 0 } };
	const type = String(h.type ?? "").replace(/^minecraft:/, "");
	if (type === "uniform" || h.min_inclusive !== undefined) return { type: "uniform", min: abs(h.min_inclusive), max: abs(h.max_inclusive ?? h.min_inclusive) };
	if (type === "constant") return { type: "constant", value: abs(h.value) };
	return { type: "constant", value: abs(h) };
}

const HEIGHTMAP: Record<string, string> = { WORLD_SURFACE_WG: "world_surface", WORLD_SURFACE: "world_surface", OCEAN_FLOOR_WG: "ocean_floor", OCEAN_FLOOR: "ocean_floor" };

/** Estrutura Java (worldgen/structure, type jigsaw) → minecraft:jigsaw do Bedrock. */
export function bedrockJigsawStructure(javaId: string, def: any, biomeFilters: unknown): Record<string, unknown> {
	const dist = def.max_distance_from_center;
	const horizontal = Math.min(128, Number(typeof dist === "object" ? dist?.horizontal ?? 80 : dist ?? 80));
	const body: Record<string, unknown> = {
		description: { identifier: bedrockWorldgenId(javaId) },
		step: String(def.step ?? "surface_structures"),
		start_pool: bedrockWorldgenId(String(def.start_pool)),
		max_depth: Math.max(0, Math.min(20, Number(def.size ?? 0))),
		start_height: startHeightOf(def.start_height),
		max_distance_from_center: { horizontal },
		terrain_adaptation: String(def.terrain_adaptation ?? "none"),
	};
	if (biomeFilters) body.biome_filters = [biomeFilters];
	const hm = HEIGHTMAP[String(def.project_start_to_heightmap ?? "")];
	if (hm) body.heightmap_projection = hm;
	if (def.start_jigsaw_name) body.start_jigsaw_name = String(def.start_jigsaw_name);
	if (def.liquid_settings) body.liquid_settings = String(def.liquid_settings);
	if (def.dimension_padding !== undefined) body.dimension_padding = typeof def.dimension_padding === "number" ? def.dimension_padding : Number(def.dimension_padding?.bottom ?? 0);
	return { format_version: WORLDGEN_FORMAT, "minecraft:jigsaw": body };
}

/** structure_set do Java (random_spread) → minecraft:structure_set do Bedrock (só as estruturas emitidas). */
export function bedrockStructureSet(setId: string, set: any, emitted: Set<string>): Record<string, unknown> | undefined {
	const structures = (set.structures ?? []).filter((e: any) => emitted.has(String(e.structure))).map((e: any) => ({ structure: bedrockWorldgenId(String(e.structure)), weight: Number(e.weight ?? 1) }));
	if (!structures.length) return undefined;
	const p = set.placement ?? {};
	const spacing = Number(p.spacing ?? 32);
	// O Bedrock exige separation < spacing / 2 (o Java só exige < spacing): 100/50 das enseadas vira 100/49.
	const separation = Math.max(0, Math.min(Number(p.separation ?? 8), Math.ceil(spacing / 2) - 1));
	return {
		format_version: WORLDGEN_FORMAT,
		"minecraft:structure_set": {
			description: { identifier: bedrockWorldgenId(setId) },
			placement: {
				type: "minecraft:random_spread",
				salt: Number(p.salt ?? 0),
				separation,
				spacing,
				// O Bedrock aceita os mesmos nomes do Java ("linear" | "triangular"; conferido no log do BDS 1.26.52).
				spread_type: String(p.spread_type ?? "linear") === "triangular" ? "triangular" : "linear",
			},
			structures,
		},
	};
}

/** Nome da peça (molde + processadores) e caminho dentro de structures/. */
function pieceKey(location: string, processors: any): string {
	const { path } = splitId(location, "minecraft");
	const proc = typeof processors === "string" ? splitId(processors, "minecraft").path : processors && typeof processors === "object" ? `inline${JSON.stringify(processors).length}` : "empty";
	const suffix = proc === "empty" ? "" : `__${proc.replace(/[^a-z0-9_]/g, "_")}`;
	return `${PIECE_DIR}/${path.replace(/[^a-z0-9_/]/g, "_")}${suffix}`;
}

/** Hash estável (UniqueID dos marcadores). */
function hash64(text: string): bigint {
	let h = 1469598103934665603n;
	for (let i = 0; i < text.length; i++) h = ((h ^ BigInt(text.charCodeAt(i))) * 1099511628211n) & 0xffffffffffffffffn;
	return BigInt.asIntN(64, h | 1n);
}

/** Entidade marcadora no centro da peça: tags com os índices das estruturas e o raio (blocos) da peça. */
export function markerEntity(size: V3, structureIndices: number[], key: string): NbtTyped {
	const radius = Math.ceil(Math.hypot(size[0], size[2]) / 2);
	return nbt.compound({
		identifier: nbt.string(STRUCTURE_MARKER),
		definitions: nbt.list("string", [nbt.string(`+${STRUCTURE_MARKER}`)]),
		Pos: nbt.list("float", [nbt.float(size[0] / 2), nbt.float(Math.min(size[1] - 1, 1) + 0.05), nbt.float(size[2] / 2)]),
		Rotation: nbt.list("float", [nbt.float(0), nbt.float(0)]),
		Motion: nbt.list("float", [nbt.float(0), nbt.float(0), nbt.float(0)]),
		UniqueID: nbt.long(hash64(key)),
		Persistent: nbt.byte(1),
		Tags: nbt.list("string", [nbt.string(`cobblemon:st=${structureIndices.join(",")}`), nbt.string(`cobblemon:sr=${radius}`)]),
	});
}

export interface JigsawStats { structures: number; variants: number; skipped: string[]; anchorRanges: Map<string, number> }

interface PieceRef { key: string; location: string; processors: any; legacy: boolean }

/** Converte as estruturas jigsaw em jigsaw data-driven (estruturas, pools, conjuntos, peças) + tabela para os scripts. */
export function buildJigsawStructures(opts: { mapper: BlockMapper; biomes: BiomeResolver; poolIndex: Map<string, number>; lootPath: (id: string) => string | undefined }): JigsawStats {
	const stats: JigsawStats = { structures: 0, variants: 0, skipped: [], anchorRanges: new Map() };
	const src = new JigsawSource();
	const base = `${DATA}/cobblemon/worldgen/structure/`;
	const defs = new Map<string, any>();
	for (const file of walk(base, (n) => n.endsWith(".json"))) defs.set(`cobblemon:${file.slice(base.length, -5)}`, readJson(file));
	// Frente vilas: Pokécenter e mini-habitats das vilas do Java como estruturas próprias (tools/importer/villages.ts).
	const villagePieces = villageStructures();
	for (const v of villagePieces) {
		defs.set(v.id, v.def);
		src.addPool(v.poolId, v.pool as unknown as Pool);
		for (const [listId, list] of Object.entries(v.processorLists ?? {})) src.addProcessorList(listId, list);
	}
	// Estruturas de vila que entraram depois vão para o fim de STRUCTURE_IDS (índices de marcadores já gravados valem).
	const late = new Set(villagePieces.filter((v) => v.late).map((v) => v.id));
	const biomesOf = (id: string): string[] => {
		const b = defs.get(id)?.biomes;
		const list: string[] = Array.isArray(b) ? b : b ? [b] : [];
		return [...new Set(list.flatMap((x) => opts.biomes.resolve(x)))];
	};

	// 1. Estruturas com bioma no Bedrock e os pools/peças que cada uma alcança.
	const structureIds: string[] = [];
	const emitted = new Set<string>();
	const pools = new Map<string, Pool>();
	const pieces = new Map<string, PieceRef>();
	const pieceStructures = new Map<string, Set<number>>();
	const pending: Array<{ id: string; def: any; filter: unknown }> = [];
	for (const [id, def] of [...defs].sort(([a], [b]) => Number(late.has(a)) - Number(late.has(b)) || a.localeCompare(b))) {
		if (def.type !== "minecraft:jigsaw") continue;
		const startPool = String(def.start_pool ?? "");
		const filter = biomeFilter(biomesOf(id));
		if (!filter) { stats.skipped.push(`${id}: sem bioma no Bedrock`); continue; }
		if (!src.pool(startPool)) { stats.skipped.push(`${id}: start_pool ${startPool} ausente`); continue; }
		const index = structureIds.length;
		structureIds.push(id);
		emitted.add(id);
		const queue = [startPool];
		const seen = new Set<string>();
		while (queue.length) {
			const poolId = queue.shift()!;
			if (seen.has(poolId)) continue;
			seen.add(poolId);
			const pool = src.pool(poolId);
			if (!pool) continue;
			pools.set(poolId, pool);
			if (pool.fallback && pool.fallback !== "minecraft:empty") queue.push(pool.fallback);
			for (const { element } of pool.elements ?? []) {
				const type = elementType(element);
				if (type !== "single_pool_element" && type !== "legacy_single_pool_element") continue;
				const location = String(element.location ?? "");
				const template = src.template(location);
				if (!template) continue;
				const key = pieceKey(location, element.processors);
				if (!pieces.has(key)) pieces.set(key, { key, location, processors: element.processors, legacy: type.startsWith("legacy") });
				const owners = pieceStructures.get(key) ?? new Set<number>();
				owners.add(index);
				pieceStructures.set(key, owners);
				for (const b of template.blocks) {
					if (template.palette[b.state]?.Name !== "minecraft:jigsaw") continue;
					const target = String(b.nbt?.pool ?? "minecraft:empty");
					if (target !== "minecraft:empty" && splitId(target, "minecraft").ns === "cobblemon") queue.push(target);
				}
			}
		}
		pending.push({ id, def, filter });
	}

	// Pools só com elemento vazio (ex.: cobblemon:dead_coral dos barcos de pesca) derrubam o BDS 1.26.52 (crash nativo
	// no /locate e na geração): no Bedrock viram "minecraft:empty" (mesmo efeito: nada é colocado).
	const placeable = new Set<string>();
	for (const [id, pool] of pools) {
		const ok = (pool.elements ?? []).some(({ element }) => {
			const type = elementType(element);
			return (type === "single_pool_element" || type === "legacy_single_pool_element") && pieces.has(pieceKey(String(element.location ?? ""), element.processors));
		});
		if (ok) placeable.add(id);
		else warn("pool jigsaw sem peça colocável (vira minecraft:empty)", id);
	}

	for (const { id, def, filter } of pending) {
		if (!placeable.has(String(def.start_pool))) {
			stats.skipped.push(`${id}: start_pool sem peça colocável`);
			emitted.delete(id);
			continue;
		}
		writeJson(`${OUT_BP}/worldgen/structures/${splitId(bedrockWorldgenId(id)).path}.json`, bedrockJigsawStructure(id, def, filter));
		stats.structures++;
	}

	// 2. Peças (.mcstructure com jigsaws e marcador).
	const jigsawBlock = (b: PlacedBlock) => {
		const target = String(b.nbt?.pool ?? "minecraft:empty");
		const targetPool = placeable.has(target) ? bedrockWorldgenId(target) : "minecraft:empty";
		const finalJava = parseStateKey(String(b.nbt?.final_state ?? "minecraft:structure_void"));
		const mapped = finalJava.name === "minecraft:structure_void" || finalJava.name === "minecraft:air" ? { name: finalJava.name } : opts.mapper.map(finalJava.name, finalJava.props);
		const finalState = mapped?.name ?? "minecraft:structure_void";
		return {
			block: { name: "minecraft:jigsaw", states: jigsawStates(String(b.props.orientation ?? "north_up")) },
			entity: {
				id: nbt.string("JigsawBlock"),
				isMovable: nbt.byte(1),
				name: nbt.string(String(b.nbt?.name ?? "minecraft:empty")),
				target: nbt.string(String(b.nbt?.target ?? "minecraft:empty")),
				target_pool: nbt.string(targetPool),
				final_state: nbt.string(finalState),
				joint: nbt.string(String(b.nbt?.joint ?? (/^(up|down)_/.test(String(b.props.orientation ?? "")) ? "rollable" : "aligned"))),
				placement_priority: nbt.int(Number(b.nbt?.placement_priority ?? 0)),
				selection_priority: nbt.int(Number(b.nbt?.selection_priority ?? 0)),
			} as Record<string, NbtTyped>,
		};
	};
	for (const piece of [...pieces.values()].sort((a, b) => a.key.localeCompare(b.key))) {
		const template = src.template(piece.location)!;
		const random = seededRandom(piece.key);
		const blocks = applyProcessors(templateBlocks(template as any), src.processors(piece.processors), random);
		const s: ConvertedStructure = convertBlocks(template.size, blocks, { mapper: opts.mapper, poolIndex: opts.poolIndex, lootPath: opts.lootPath, keepJigsaw: jigsawBlock, skipAir: piece.legacy });
		s.entities = [markerEntity(template.size, [...(pieceStructures.get(piece.key) ?? [])].sort((a, b) => a - b), piece.key)];
		if (s.habitat?.poolId) stats.anchorRanges.set(s.habitat.poolId, Math.max(stats.anchorRanges.get(s.habitat.poolId) ?? 0, s.habitat.range));
		const out = join(OUT_BP, "structures", `${piece.key}.mcstructure`);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, writeMcstructure(s));
		stats.variants++;
	}

	// 3. Pools.
	for (const [id, pool] of pools) {
		if (!placeable.has(id)) continue;
		const elements: unknown[] = [];
		for (const { weight, element } of pool.elements ?? []) {
			const type = elementType(element);
			if (type === "empty_pool_element") {
				elements.push({ element: { element_type: "minecraft:empty_pool_element" }, weight: Number(weight ?? 1) });
				continue;
			}
			if (type !== "single_pool_element" && type !== "legacy_single_pool_element") {
				warn("elemento de pool jigsaw sem equivalente", `${id}: ${type}`);
				continue;
			}
			const key = pieceKey(String(element.location ?? ""), element.processors);
			if (!pieces.has(key)) continue;
			elements.push({ element: { element_type: "minecraft:single_pool_element", location: key, projection: String(element.projection ?? "rigid") }, weight: Number(weight ?? 1) });
		}
		const body: Record<string, unknown> = { description: { identifier: bedrockWorldgenId(id) }, elements };
		if (pool.fallback && placeable.has(pool.fallback)) body.fallback = bedrockWorldgenId(pool.fallback);
		writeJson(`${OUT_BP}/worldgen/template_pools/${splitId(bedrockWorldgenId(id)).path}.json`, { format_version: WORLDGEN_FORMAT, "minecraft:template_pool": body });
	}

	// 4. Conjuntos (random_spread).
	let sets = 0;
	const setBase = `${DATA}/cobblemon/worldgen/structure_set/`;
	for (const file of walk(setBase, (n) => n.endsWith(".json"))) {
		const setId = `cobblemon:${file.slice(setBase.length, -5)}`;
		const set = bedrockStructureSet(setId, readJson(file), emitted);
		if (!set) continue;
		writeJson(`${OUT_BP}/worldgen/structure_sets/${splitId(bedrockWorldgenId(setId)).path}.json`, set);
		sets++;
	}
	for (const v of villagePieces) {
		const set = bedrockStructureSet(v.setId, v.set, emitted);
		if (!set) {
			warn("peça de vila sem structure_set (estrutura não emitida)", v.id);
			continue;
		}
		writeJson(`${OUT_BP}/worldgen/structure_sets/${splitId(bedrockWorldgenId(v.setId)).path}.json`, set);
		sets++;
	}
	count("peças de vila como estruturas próprias", villagePieces.filter((v) => emitted.has(v.id)).length);
	const pokecenters = buildVillagePokecenters(opts);
	emitStructuresModule(structureIds, pokecenters);
	count("estruturas jigsaw data-driven", stats.structures);
	count("peças jigsaw (.mcstructure)", stats.variants);
	count("template pools jigsaw", placeable.size);
	count("structure sets jigsaw", sets);
	return stats;
}

// ---------------------------------------------------------------------------------------------
// Pokécenters de vila (colocados por script junto de vilas novas: scripts/world/Villages.ts)

export interface PokecenterInfo { structure: string; size: V3; entrance: V3; entranceFacing: string }

/** Moldes village_<bioma>_pokecenter → structures/cobblemon/village/<bioma>_pokecenter.mcstructure. */
export function buildVillagePokecenters(opts: { mapper: BlockMapper; poolIndex: Map<string, number>; lootPath: (id: string) => string | undefined }): Record<string, PokecenterInfo> {
	const out: Record<string, PokecenterInfo> = {};
	for (const biome of ["plains", "desert", "savanna", "snowy", "taiga"]) {
		const file = `${DATA}/cobblemon/structure/village_${biome}/village_${biome}_pokecenter.nbt`;
		if (!existsSync(file)) continue;
		const template = readJavaNbt(readFileSync(file)) as unknown as JavaTemplate;
		const blocks = templateBlocks(template as any);
		const entrance = blocks.find((b) => b.name === "minecraft:jigsaw" && String(b.nbt?.name ?? "").endsWith("building_entrance"));
		const s = convertBlocks(template.size, blocks, { mapper: opts.mapper, poolIndex: opts.poolIndex, lootPath: opts.lootPath });
		const name = `${biome}_pokecenter`;
		const target = join(OUT_BP, "structures", "cobblemon", "village", `${name}.mcstructure`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, writeMcstructure(s));
		out[biome] = {
			structure: `cobblemon:village/${name}`,
			size: template.size,
			entrance: entrance?.pos ?? [0, 1, Math.floor(template.size[2] / 2)],
			entranceFacing: String(entrance?.props.orientation ?? "west_up").split("_")[0],
		};
	}
	count("pokécenters de vila (.mcstructure)", Object.keys(out).length);
	return out;
}

/** Tags de estrutura do Cobblemon (data/cobblemon/tags/worldgen/structure), já expandidas. */
export function structureTags(): Record<string, string[]> {
	const base = `${DATA}/cobblemon/tags/worldgen/structure/`;
	const raw = new Map<string, string[]>();
	for (const file of walk(base, (n) => n.endsWith(".json"))) {
		raw.set(`cobblemon:${file.slice(base.length, -5)}`, (readJson(file).values ?? []).map((v: any) => String(typeof v === "string" ? v : v?.id ?? "")));
	}
	const expand = (tag: string, stack: string[] = []): string[] => (raw.get(tag) ?? []).flatMap((v) => (v.startsWith("#") ? (stack.includes(v) ? [] : expand(v.slice(1), [...stack, v])) : [v]));
	const out: Record<string, string[]> = {};
	for (const tag of [...raw.keys()].sort()) out[tag] = [...new Set(expand(tag))];
	return out;
}

/** generated/scripts/structures.ts: ids dos marcadores, tags de estrutura e pokécenters. */
function emitStructuresModule(ids: string[], pokecenters: Record<string, PokecenterInfo>): void {
	writeText(`${OUT_SCRIPTS}/structures.ts`, [
		"// Gerado por tools/importer/jigsaw.ts (frente motor). Não editar.",
		"/** Índice do marcador de peça (tag cobblemon:st=<índices>) → id Java da estrutura. */",
		`export const STRUCTURE_IDS: readonly string[] = ${JSON.stringify(ids)};`,
		"/** Tags de estrutura do Cobblemon (data/cobblemon/tags/worldgen/structure), expandidas. */",
		`export const STRUCTURE_TAGS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(structureTags())};`,
		"/** Pokécenter de vila por bioma: molde, tamanho e jigsaw de entrada (lado da rua). */",
		`export const POKECENTERS: Readonly<Record<string, { structure: string; size: [number, number, number]; entrance: [number, number, number]; entranceFacing: string }>> = ${JSON.stringify(pokecenters)};`,
		"",
	].join("\n"));
}
