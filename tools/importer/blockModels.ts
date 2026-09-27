// Modelos de bloco do Java → geometrias de bloco do Bedrock (.geo.json) + atlas de texturas do terreno.
//
// Convenções (as mesmas do Blockbench ao converter Java → Bedrock):
//   - origem do cubo = [8 - to.x, from.y, from.z - 8] (eixo X espelhado, bloco centrado);
//   - rotação do elemento: eixo x → [-a,0,0], y → [0,-a,0], z → [0,0,a]; pivô = [8 - o.x, o.y, o.z - 8];
//   - rotação do blockstate (x/y do Java) vira a rotação do bone raiz: [x, y, 0] com pivô [0, 8, 0];
//   - UV por face: uv [u1,v1] + uv_size [u2-u1, v2-v1]; faces up/down têm os dois eixos invertidos;
//     "rotation" da face vira "uv_rotation" (geometria format_version 1.21.0).
// Cada variável de textura do modelo vira uma material instance ("m_<var>"); o bloco mapeia a instância
// para a textura do terreno. Assim a mesma geometria serve a todos os blocos que herdam o mesmo modelo.
import { existsSync, readFileSync } from "node:fs";
import { autoUV, faceVar } from "./javaModels.ts";
import type { FaceName, JElement, ResolvedModel, V3 } from "./javaModels.ts";
import { alphaKind, decodePng } from "./png.ts";
import type { AlphaKind } from "./png.ts";
import { ASSETS, OUT_RP, copyFile, count, safeName, splitId, warn, writeJson } from "./util.ts";
import { BLOCK_GEO_BOUNDS, BLOCK_GEO_MARGIN } from "./clientRules.ts"; // frente fix3

/** Texturas vanilla do Java usadas pelos modelos do Cobblemon → caminho no RP vanilla do Bedrock. */
const VANILLA_TEXTURES: Record<string, string> = {
	"block/dirt": "textures/blocks/dirt",
	"block/flower_pot": "textures/blocks/flower_pot",
	"block/farmland_moist": "textures/blocks/farmland_wet",
	"block/farmland": "textures/blocks/farmland_dry",
	"block/campfire_log_lit": "textures/blocks/campfire_log_lit",
	"block/soul_campfire_log_lit": "textures/blocks/soul_campfire_log_lit",
	"block/campfire_log": "textures/blocks/campfire_log",
	"block/campfire_fire": "textures/blocks/campfire",
	"block/soul_campfire_fire": "textures/blocks/soul_campfire",
	"block/spruce_planks": "textures/blocks/planks_spruce",
	"block/oak_planks": "textures/blocks/planks_oak",
	"block/red_wool": "textures/blocks/wool_colored_red",
	"block/moss_block": "textures/blocks/moss_block",
	"block/stone": "textures/blocks/stone",
	"block/lectern_base": "textures/blocks/lectern_base",
	"block/lectern_front": "textures/blocks/lectern_front",
	"block/lectern_sides": "textures/blocks/lectern_sides",
	"block/lectern_top": "textures/blocks/lectern_top",
	"item/bowl": "textures/items/bowl",
};

export interface TextureInfo {
	key: string;
	alpha: AlphaKind;
	/** Caminho no RP (sem extensão). */
	ref: string;
	vanilla: boolean;
}

/** Atlas do terreno (terrain_texture.json) + flipbooks das texturas animadas. */
export class TerrainTextures {
	private byId = new Map<string, TextureInfo | null>();
	private flipbooks: Array<Record<string, unknown>> = [];

	get(id: string): TextureInfo | undefined {
		if (this.byId.has(id)) return this.byId.get(id) ?? undefined;
		const { ns, path } = splitId(id, "minecraft");
		let info: TextureInfo | undefined;
		if (ns === "minecraft") {
			const ref = VANILLA_TEXTURES[path];
			if (ref) info = { key: `cobblemon_mc_${safeName(path.replace(/^block\//, ""))}`, alpha: path.includes("fire") || path.includes("flower_pot") ? "cutout" : "opaque", ref, vanilla: true };
			else warn("textura vanilla sem equivalente no Bedrock", id);
		} else if (ns === "cobblemon") {
			const file = `${ASSETS}/textures/${path}.png`;
			if (existsSync(file)) {
				const png = decodePng(file);
				const ref = `textures/${path}`;
				copyFile(file, `${OUT_RP}/${ref}.png`);
				info = { key: `cobblemon_${safeName(path)}`, alpha: png ? alphaKind(png) : "cutout", ref, vanilla: false };
				const meta = `${file}.mcmeta`;
				if (existsSync(meta) && png && png.height > png.width) {
					let frametime = 1;
					try {
						frametime = JSON.parse(readFileSync(meta, "utf8")).animation?.frametime ?? 1;
					} catch {
						// .mcmeta inválido: usa o padrão.
					}
					this.flipbooks.push({ flipbook_texture: ref, atlas_tile: info.key, ticks_per_frame: frametime, blend_frames: false });
				}
			} else warn("textura de bloco ausente", id);
		}
		this.byId.set(id, info ?? null);
		return info;
	}

	all(): TextureInfo[] {
		return [...this.byId.values()].filter((v): v is TextureInfo => !!v).sort((a, b) => a.key.localeCompare(b.key));
	}

	emit(): number {
		const data: Record<string, { textures: string }> = {};
		for (const t of this.all()) data[t.key] = { textures: t.ref };
		writeJson(`${OUT_RP}/textures/terrain_texture.json`, { resource_pack_name: "CobblemonBedrock", texture_name: "atlas.terrain", padding: 8, num_mip_levels: 4, texture_data: data });
		if (this.flipbooks.length) writeJson(`${OUT_RP}/textures/flipbook_textures.json`, this.flipbooks);
		return Object.keys(data).length;
	}
}

export interface ModelPart {
	model: ResolvedModel;
	/** Rotação do blockstate (graus, múltiplos de 90). */
	x?: number;
	y?: number;
	/** Nome do bone (multipart: um bone por parte, para bone_visibility). */
	bone?: string;
	/** Prefixo das material instances (multipart com modelos diferentes que usam a mesma variável). */
	prefix?: string;
}

export interface GeometryResult {
	/** "minecraft:geometry.full_block" ou "geometry.cobblemon.<nome>". */
	id: string;
	/** Material instance → variável de textura resolvida (id de textura Java). */
	instances: Record<string, { texture: string; shade: boolean; ao: boolean }>;
	/** Caixa envolvente em pixels Java (0..16), já rotacionada; undefined se o modelo não tem elementos. */
	bounds?: { from: V3; to: V3 };
	full: boolean;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

function rotateY(p: V3, deg: number): V3 {
	// Rotação do blockstate do Java (horário visto de cima) em torno do centro do bloco.
	const t = (((deg % 360) + 360) % 360) / 90;
	let [x, y, z] = p;
	for (let i = 0; i < t; i++) [x, z] = [16 - z, x];
	return [x, y, z];
}

function rotateX(p: V3, deg: number): V3 {
	const t = (((deg % 360) + 360) % 360) / 90;
	let [x, y, z] = p;
	// Java x=90: cima → norte, norte → baixo.
	for (let i = 0; i < t; i++) [y, z] = [z, 16 - y];
	return [x, y, z];
}

function boundsOf(elements: JElement[], x: number, y: number): { from: V3; to: V3 } | undefined {
	if (!elements.length) return undefined;
	const min: V3 = [Infinity, Infinity, Infinity];
	const max: V3 = [-Infinity, -Infinity, -Infinity];
	for (const e of elements) {
		for (const cx of [e.from[0], e.to[0]]) for (const cy of [e.from[1], e.to[1]]) for (const cz of [e.from[2], e.to[2]]) {
			const p = rotateY(rotateX([cx, cy, cz], x), y);
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], p[i]);
				max[i] = Math.max(max[i], p[i]);
			}
		}
	}
	return { from: min, to: max };
}

function isFullCube(model: ResolvedModel): boolean {
	if (model.elements.length !== 1) return false;
	const e = model.elements[0];
	if (e.rotation && e.rotation.angle !== 0) return false;
	if (e.from.some((v) => v !== 0) || e.to.some((v) => v !== 16)) return false;
	const faces = Object.keys(e.faces);
	if (faces.length !== 6) return false;
	return Object.entries(e.faces).every(([, f]) => !f!.uv || (f!.uv[0] === 0 && f!.uv[1] === 0 && f!.uv[2] === 16 && f!.uv[3] === 16));
}

/** Gera (e grava uma vez) as geometrias do Bedrock. */
export class GeometryEmitter {
	private emitted = new Map<string, string>();
	private clippedModels = new Set<string>();
	emittedCount = 0;

	/** Uma parte só, sem rotação e cubo inteiro → full_block com instâncias por face. */
	convert(parts: ModelPart[], name?: string): GeometryResult {
		const instances: GeometryResult["instances"] = {};
		// Cubo inteiro: usa a geometria nativa (face = instance). Com rotação do blockstate, as texturas
		// trocam de face (a rotação da textura dentro da face se perde, o que só afeta toras deitadas).
		if (parts.length === 1 && isFullCube(parts[0].model)) {
			const m = parts[0].model;
			const e = m.elements[0];
			for (const [face, f] of Object.entries(e.faces)) {
				const tex = m.textures[faceVar(f!)];
				if (tex) instances[rotateFace(face as FaceName, parts[0].x ?? 0, parts[0].y ?? 0)] = { texture: tex, shade: e.shade !== false, ao: m.ambientOcclusion };
			}
			return { id: "minecraft:geometry.full_block", instances, bounds: { from: [0, 0, 0], to: [16, 16, 16] }, full: true };
		}
		const bones: Array<Record<string, unknown>> = [];
		let usesUvRotation = false;
		let bounds: GeometryResult["bounds"];
		const keyParts: string[] = [];
		parts.forEach((part, pi) => {
			const m = part.model;
			const x = part.x ?? 0;
			const y = part.y ?? 0;
			const prefix = part.prefix ?? "m_";
			keyParts.push(`${m.elementsOwner ?? m.id}@${x},${y}#${part.bone ?? ""}${prefix}`);
			const cubes: Array<Record<string, unknown>> = [];
			for (const e of m.elements) {
				const cube = this.cube(e, m, prefix, instances);
				if (!cube) continue;
				if ((cube as { uses?: boolean }).uses) usesUvRotation = true;
				delete (cube as { uses?: boolean }).uses;
				cubes.push(cube);
			}
			const b = boundsOf(m.elements, x, y);
			if (b) bounds = bounds ? { from: bounds.from.map((v, i) => Math.min(v, b.from[i])) as V3, to: bounds.to.map((v, i) => Math.max(v, b.to[i])) as V3 } : b;
			const bone: Record<string, unknown> = { name: part.bone ?? `part_${pi}`, pivot: [0, 8, 0], cubes };
			if (x || y) bone.rotation = [x, y, 0];
			bones.push(bone);
		});
		const key = keyParts.join("|");
		let id = this.emitted.get(key);
		if (!id) {
			const base = name ?? (parts.length === 1 ? geometryName(parts[0]) : "multipart");
			id = `geometry.cobblemon.${base}`;
			let n = 1;
			while ([...this.emitted.values()].includes(id)) id = `geometry.cobblemon.${base}_${++n}`;
			this.emitted.set(key, id);
			const file = id.replace(/^geometry\.cobblemon\./, "");
			writeJson(`${OUT_RP}/models/blocks/cobblemon/${file}.geo.json`, {
				format_version: usesUvRotation ? "1.21.0" : "1.16.0",
				"minecraft:geometry": [{ description: { identifier: id, texture_width: 16, texture_height: 16, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 0.75, 0] }, bones }],
			});
			this.emittedCount++;
			count("geometrias de bloco");
		} else {
			// Mesmo com a geometria já gravada, as instâncias deste bloco foram preenchidas acima.
		}
		return { id, instances, bounds, full: false };
	}

	private cube(e: JElement, m: ResolvedModel, prefix: string, instances: GeometryResult["instances"]): Record<string, unknown> | undefined {
		let from: V3 = [...e.from];
		let to: V3 = [...e.to];
		const rot = e.rotation;
		if (rot?.rescale && rot.angle) {
			// "rescale" do Java: estica o elemento nos eixos perpendiculares à rotação.
			const s = 1 / Math.cos((Math.abs(rot.angle) * Math.PI) / 180);
			const axes = rot.axis === "x" ? [1, 2] : rot.axis === "y" ? [0, 2] : [0, 1];
			for (const i of axes) {
				from[i] = rot.origin[i] + (from[i] - rot.origin[i]) * s;
				to[i] = rot.origin[i] + (to[i] - rot.origin[i]) * s;
			}
		}
		// Limites da geometria de bloco do Bedrock (x/z em -15..15; y em -14..30, clientRules.BLOCK_GEO_BOUNDS). Frente
		// fix3: o y ia só até 0, e as plantas feitas para a terra arada (15/16: base em y = -1 no Java — berries, mentas,
		// vivichoke, mulch em -0,95) ficavam com o solo, a muda e o mulch achatados no mesmo plano y = 0 → z-fighting
		// (texturas piscando) e 1 px acima da terra arada.
		const clampAxis = (v: number, i: number) => (i === 1 ? Math.min(30, Math.max(BLOCK_GEO_BOUNDS.min[1] + BLOCK_GEO_MARGIN, v)) : Math.min(23, Math.max(-7, v)));
		const clipped = from.some((v, i) => clampAxis(v, i) !== v) || to.some((v, i) => clampAxis(v, i) !== v);
		if (clipped) {
			from = from.map(clampAxis) as V3;
			to = to.map(clampAxis) as V3;
			if (!this.clippedModels.has(m.id)) warn("modelo com elemento fora dos limites do bloco (recortado)", m.id);
			this.clippedModels.add(m.id);
		}
		const uv: Record<string, unknown> = {};
		let uses = false;
		for (const [faceName, f] of Object.entries(e.faces)) {
			if (!f) continue;
			const face = faceName as FaceName;
			const v = faceVar(f);
			const tex = f.texture.startsWith("#") ? m.textures[v] : f.texture.includes(":") ? f.texture : `minecraft:${f.texture}`;
			if (!tex) continue;
			const inst = `${prefix}${safeName(v)}`;
			const prev = instances[inst];
			instances[inst] = { texture: tex, shade: (prev?.shade ?? true) && e.shade !== false, ao: m.ambientOcclusion };
			const [u1, v1, u2, v2] = f.uv ?? autoUV(face, e.from, e.to);
			const out: Record<string, unknown> = { uv: [r4(u1), r4(v1)], uv_size: [r4(u2 - u1), r4(v2 - v1)], material_instance: inst };
			if (face === "up" || face === "down") {
				out.uv = [r4(u2), r4(v2)];
				out.uv_size = [r4(u1 - u2), r4(v1 - v2)];
			}
			if (f.rotation) {
				out.uv_rotation = f.rotation;
				uses = true;
			}
			uv[face] = out;
		}
		if (!Object.keys(uv).length) return undefined;
		const cube: Record<string, unknown> = {
			origin: [r4(8 - to[0]), r4(from[1]), r4(from[2] - 8)],
			size: [r4(to[0] - from[0]), r4(to[1] - from[1]), r4(to[2] - from[2])],
			uv,
		};
		if (rot && rot.angle) {
			cube.pivot = [r4(8 - rot.origin[0]), r4(rot.origin[1]), r4(rot.origin[2] - 8)];
			cube.rotation = rot.axis === "x" ? [-rot.angle, 0, 0] : rot.axis === "y" ? [0, -rot.angle, 0] : [0, 0, rot.angle];
		}
		if (uses) (cube as { uses?: boolean }).uses = true;
		return cube;
	}
}

const X_TURN: Record<FaceName, FaceName> = { up: "north", north: "down", down: "south", south: "up", east: "east", west: "west" };
const Y_TURN: Record<FaceName, FaceName> = { north: "east", east: "south", south: "west", west: "north", up: "up", down: "down" };

/** Face para onde a face original vai com a rotação x (primeiro) e y do blockstate do Java. */
function rotateFace(face: FaceName, x: number, y: number): FaceName {
	let f = face;
	for (let i = 0; i < ((((x % 360) + 360) % 360) / 90); i++) f = X_TURN[f];
	for (let i = 0; i < ((((y % 360) + 360) % 360) / 90); i++) f = Y_TURN[f];
	return f;
}

function geometryName(part: ModelPart): string {
	const owner = part.model.elementsOwner ?? part.model.id;
	const { ns, path } = splitId(owner, "minecraft");
	let name = safeName(path.replace(/^block\//, ""));
	if (ns === "minecraft") name = `mc_${name}`;
	if (part.x) name += `_x${((part.x % 360) + 360) % 360}`;
	if (part.y) name += `_y${((part.y % 360) + 360) % 360}`;
	return name;
}

