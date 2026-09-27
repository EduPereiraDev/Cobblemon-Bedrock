// Modelos de bloco/item do Java: carga com herança (parent), resolução de variáveis de textura (#x) e
// os modelos-pai vanilla usados pelo Cobblemon (que não vêm no código do mod), escritos aqui à mão.
import { existsSync } from "node:fs";
import { ASSETS, readJson, splitId } from "./util.ts";

export type V3 = [number, number, number];
export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
export const FACES: FaceName[] = ["north", "south", "east", "west", "up", "down"];

export interface JFace {
	uv?: [number, number, number, number];
	texture: string;
	rotation?: number;
	tintindex?: number;
	cullface?: string;
}

export interface JElement {
	from: V3;
	to: V3;
	rotation?: { origin: V3; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
	shade?: boolean;
	faces: Partial<Record<FaceName, JFace>>;
}

export interface JModel {
	parent?: string;
	textures?: Record<string, string>;
	elements?: JElement[];
	ambientocclusion?: boolean;
}

export interface ResolvedModel {
	/** Id normalizado ("cobblemon:block/x" ou "minecraft:block/x"). */
	id: string;
	/** Modelo (na cadeia de herança) que define os elements: a geometria é compartilhada por ele. */
	elementsOwner?: string;
	elements: JElement[];
	/** Variáveis de textura já resolvidas até um id de textura ("cobblemon:block/..."), sem '#'. */
	textures: Record<string, string>;
	ambientOcclusion: boolean;
	/** Cadeia de pais (do próprio modelo até a raiz). */
	chain: string[];
}

const full = (faces: Record<string, string>, extra: Partial<JElement> = {}): JElement => ({
	from: [0, 0, 0],
	to: [16, 16, 16],
	faces: Object.fromEntries(Object.entries(faces).map(([f, t]) => [f, { texture: t, cullface: f }])),
	...extra,
});
const box = (from: V3, to: V3, texture: string, faces: FaceName[] = FACES, uvs: Partial<Record<FaceName, [number, number, number, number]>> = {}): JElement => ({
	from,
	to,
	faces: Object.fromEntries(faces.map((f) => [f, { texture, ...(uvs[f] ? { uv: uvs[f] } : {}) }])),
});
const SIDES6 = { down: "#down", up: "#up", north: "#north", south: "#south", west: "#west", east: "#east" };

/** Modelos-pai vanilla (1.21) usados pelos modelos do Cobblemon — geometria aproximada onde é detalhe. */
const VANILLA: Record<string, JModel> = {
	"block/block": {},
	"block/thin_block": { parent: "block/block" },
	"block/cube": { parent: "block/block", elements: [full(SIDES6)] },
	"block/cube_all": { parent: "block/cube", textures: { particle: "#all", down: "#all", up: "#all", north: "#all", east: "#all", south: "#all", west: "#all" } },
	"block/cube_column": { parent: "block/cube", textures: { particle: "#side", down: "#end", up: "#end", north: "#side", east: "#side", south: "#side", west: "#side" } },
	"block/cube_bottom_top": { parent: "block/cube", textures: { particle: "#side", down: "#bottom", up: "#top", north: "#side", east: "#side", south: "#side", west: "#side" } },
	"block/cube_column_horizontal": {
		parent: "block/block",
		textures: { particle: "#side" },
		elements: [{
			from: [0, 0, 0],
			to: [16, 16, 16],
			faces: {
				down: { texture: "#side", rotation: 180 },
				up: { texture: "#side" },
				north: { texture: "#end" },
				south: { texture: "#end" },
				west: { texture: "#side", rotation: 270 },
				east: { texture: "#side", rotation: 90 },
			},
		}],
	},
	"block/orientable_with_bottom": { parent: "block/cube", textures: { particle: "#front", down: "#bottom", up: "#top", north: "#front", east: "#side", south: "#side", west: "#side" } },
	"block/orientable": { parent: "block/orientable_with_bottom", textures: { bottom: "#top" } },
	"block/leaves": { parent: "block/cube_all" },
	"block/cross": {
		ambientocclusion: false,
		textures: { particle: "#cross" },
		elements: [
			{ from: [0.8, 0, 8], to: [15.2, 16, 8], rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true }, shade: false, faces: { north: { uv: [0, 0, 16, 16], texture: "#cross" }, south: { uv: [0, 0, 16, 16], texture: "#cross" } } },
			{ from: [8, 0, 0.8], to: [8, 16, 15.2], rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true }, shade: false, faces: { west: { uv: [0, 0, 16, 16], texture: "#cross" }, east: { uv: [0, 0, 16, 16], texture: "#cross" } } },
		],
	},
	"block/crop": {
		ambientocclusion: false,
		textures: { particle: "#crop" },
		elements: [
			{ from: [4, -1, 0], to: [4, 15, 16], shade: false, faces: { west: { uv: [0, 0, 16, 16], texture: "#crop" }, east: { uv: [0, 0, 16, 16], texture: "#crop" } } },
			{ from: [12, -1, 0], to: [12, 15, 16], shade: false, faces: { west: { uv: [0, 0, 16, 16], texture: "#crop" }, east: { uv: [0, 0, 16, 16], texture: "#crop" } } },
			{ from: [0, -1, 4], to: [16, 15, 4], shade: false, faces: { north: { uv: [0, 0, 16, 16], texture: "#crop" }, south: { uv: [0, 0, 16, 16], texture: "#crop" } } },
			{ from: [0, -1, 12], to: [16, 15, 12], shade: false, faces: { north: { uv: [0, 0, 16, 16], texture: "#crop" }, south: { uv: [0, 0, 16, 16], texture: "#crop" } } },
		],
	},
	"block/flower_pot_cross": {
		ambientocclusion: false,
		textures: { particle: "minecraft:block/flower_pot", flowerpot: "minecraft:block/flower_pot", dirt: "minecraft:block/dirt" },
		elements: [
			box([5, 0, 5], [6, 6, 11], "#flowerpot", ["down", "up", "north", "south", "west", "east"], { down: [5, 5, 6, 11], up: [5, 5, 6, 11], north: [10, 10, 11, 16], south: [5, 10, 6, 16], west: [5, 10, 11, 16], east: [5, 10, 11, 16] }),
			box([10, 0, 5], [11, 6, 11], "#flowerpot", ["down", "up", "north", "south", "west", "east"], { down: [10, 5, 11, 11], up: [10, 5, 11, 11], north: [5, 10, 6, 16], south: [10, 10, 11, 16], west: [5, 10, 11, 16], east: [5, 10, 11, 16] }),
			box([6, 0, 5], [10, 6, 6], "#flowerpot", ["down", "up", "north", "south"], { down: [6, 10, 10, 11], up: [6, 5, 10, 6], north: [6, 10, 10, 16], south: [6, 10, 10, 16] }),
			box([6, 0, 10], [10, 6, 11], "#flowerpot", ["down", "up", "north", "south"], { down: [6, 5, 10, 6], up: [6, 10, 10, 11], north: [6, 10, 10, 16], south: [6, 10, 10, 16] }),
			box([6, 0, 6], [10, 4, 10], "#flowerpot", ["down"], { down: [6, 12, 10, 16] }),
			box([6, 0, 6], [10, 4, 10], "#dirt", ["up"], { up: [6, 6, 10, 10] }),
			{ from: [2.6, 4, 8], to: [13.4, 16, 8], rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true }, shade: false, faces: { north: { uv: [0, 4, 16, 16], texture: "#plant" }, south: { uv: [0, 4, 16, 16], texture: "#plant" } } },
			{ from: [8, 4, 2.6], to: [8, 16, 13.4], rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true }, shade: false, faces: { west: { uv: [0, 4, 16, 16], texture: "#plant" }, east: { uv: [0, 4, 16, 16], texture: "#plant" } } },
		],
	},
	"block/slab": {
		textures: { particle: "#side" },
		elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { down: { uv: [0, 0, 16, 16], texture: "#bottom" }, up: { uv: [0, 0, 16, 16], texture: "#top" }, north: { uv: [0, 8, 16, 16], texture: "#side" }, south: { uv: [0, 8, 16, 16], texture: "#side" }, west: { uv: [0, 8, 16, 16], texture: "#side" }, east: { uv: [0, 8, 16, 16], texture: "#side" } } }],
	},
	"block/slab_top": {
		textures: { particle: "#side" },
		elements: [{ from: [0, 8, 0], to: [16, 16, 16], faces: { down: { uv: [0, 0, 16, 16], texture: "#bottom" }, up: { uv: [0, 0, 16, 16], texture: "#top" }, north: { uv: [0, 0, 16, 8], texture: "#side" }, south: { uv: [0, 0, 16, 8], texture: "#side" }, west: { uv: [0, 0, 16, 8], texture: "#side" }, east: { uv: [0, 0, 16, 8], texture: "#side" } } }],
	},
	"block/stairs": {
		textures: { particle: "#side" },
		elements: [
			{ from: [0, 0, 0], to: [16, 8, 16], faces: { down: { texture: "#bottom" }, up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" }, east: { texture: "#side" } } },
			{ from: [8, 8, 0], to: [16, 16, 16], faces: { up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" }, east: { texture: "#side" } } },
		],
	},
	"block/inner_stairs": {
		textures: { particle: "#side" },
		elements: [
			{ from: [0, 0, 0], to: [16, 8, 16], faces: { down: { texture: "#bottom" }, up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" }, east: { texture: "#side" } } },
			{ from: [8, 8, 0], to: [16, 16, 16], faces: { up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" }, east: { texture: "#side" } } },
			{ from: [0, 8, 8], to: [8, 16, 16], faces: { up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" } } },
		],
	},
	"block/outer_stairs": {
		textures: { particle: "#side" },
		elements: [
			{ from: [0, 0, 0], to: [16, 8, 16], faces: { down: { texture: "#bottom" }, up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" }, east: { texture: "#side" } } },
			{ from: [8, 8, 8], to: [16, 16, 16], faces: { up: { texture: "#top" }, north: { texture: "#side" }, south: { texture: "#side" }, west: { texture: "#side" }, east: { texture: "#side" } } },
		],
	},
	"block/template_wall_post": { textures: { particle: "#wall" }, elements: [box([4, 0, 4], [12, 16, 12], "#wall")] },
	"block/template_wall_side": { textures: { particle: "#wall" }, elements: [box([5, 0, 0], [11, 14, 8], "#wall", ["down", "up", "north", "west", "east"])] },
	"block/template_wall_side_tall": { textures: { particle: "#wall" }, elements: [box([5, 0, 0], [11, 16, 8], "#wall", ["down", "up", "north", "west", "east"])] },
	"block/wall_inventory": { textures: { particle: "#wall" }, elements: [box([4, 0, 4], [12, 16, 12], "#wall"), box([5, 0, 0], [11, 13, 16], "#wall")] },
	"block/fence_post": { textures: { particle: "#texture" }, elements: [box([6, 0, 6], [10, 16, 10], "#texture")] },
	"block/fence_side": { textures: { particle: "#texture" }, elements: [box([7, 12, 0], [9, 15, 9], "#texture", ["down", "up", "north", "west", "east"]), box([7, 6, 0], [9, 9, 9], "#texture", ["down", "up", "north", "west", "east"])] },
	"block/fence_inventory": { textures: { particle: "#texture" }, elements: [box([6, 0, 0], [10, 16, 4], "#texture"), box([6, 0, 12], [10, 16, 16], "#texture"), box([7, 13, -2], [9, 15, 18], "#texture"), box([7, 5, -2], [9, 7, 18], "#texture")] },
	"block/template_fence_gate": {
		textures: { particle: "#texture" },
		elements: [box([0, 5, 7], [2, 16, 9], "#texture"), box([14, 5, 7], [16, 16, 9], "#texture"), box([6, 6, 7], [8, 15, 9], "#texture"), box([8, 6, 7], [10, 15, 9], "#texture"), box([2, 6, 7], [6, 9, 9], "#texture"), box([2, 12, 7], [6, 15, 9], "#texture"), box([10, 6, 7], [14, 9, 9], "#texture"), box([10, 12, 7], [14, 15, 9], "#texture")],
	},
	"block/template_fence_gate_open": {
		textures: { particle: "#texture" },
		elements: [box([0, 5, 7], [2, 16, 9], "#texture"), box([14, 5, 7], [16, 16, 9], "#texture"), box([0, 6, 13], [2, 15, 15], "#texture"), box([14, 6, 13], [16, 15, 15], "#texture"), box([0, 6, 9], [2, 9, 13], "#texture"), box([0, 12, 9], [2, 15, 13], "#texture"), box([14, 6, 9], [16, 9, 13], "#texture"), box([14, 12, 9], [16, 15, 13], "#texture")],
	},
	"block/template_fence_gate_wall": {
		textures: { particle: "#texture" },
		elements: [box([0, 2, 7], [2, 13, 9], "#texture"), box([14, 2, 7], [16, 13, 9], "#texture"), box([6, 3, 7], [8, 12, 9], "#texture"), box([8, 3, 7], [10, 12, 9], "#texture"), box([2, 3, 7], [6, 6, 9], "#texture"), box([2, 9, 7], [6, 12, 9], "#texture"), box([10, 3, 7], [14, 6, 9], "#texture"), box([10, 9, 7], [14, 12, 9], "#texture")],
	},
	"block/template_fence_gate_wall_open": {
		textures: { particle: "#texture" },
		elements: [box([0, 2, 7], [2, 13, 9], "#texture"), box([14, 2, 7], [16, 13, 9], "#texture"), box([0, 3, 13], [2, 12, 15], "#texture"), box([14, 3, 13], [16, 12, 15], "#texture"), box([0, 3, 9], [2, 6, 13], "#texture"), box([0, 9, 9], [2, 12, 13], "#texture"), box([14, 3, 9], [16, 6, 13], "#texture"), box([14, 9, 9], [16, 12, 13], "#texture")],
	},
	"block/button": { textures: { particle: "#texture" }, elements: [box([5, 0, 6], [11, 2, 10], "#texture", FACES, { down: [5, 6, 11, 10], up: [5, 10, 11, 6], north: [5, 14, 11, 16], south: [5, 14, 11, 16], west: [6, 14, 10, 16], east: [6, 14, 10, 16] })] },
	"block/button_pressed": { textures: { particle: "#texture" }, elements: [box([5, 0, 6], [11, 1, 10], "#texture", FACES, { down: [5, 6, 11, 10], up: [5, 10, 11, 6], north: [5, 15, 11, 16], south: [5, 15, 11, 16], west: [6, 15, 10, 16], east: [6, 15, 10, 16] })] },
	"block/button_inventory": { textures: { particle: "#texture" }, elements: [box([5, 6, 6], [11, 10, 10], "#texture")] },
	"block/pressure_plate_up": { textures: { particle: "#texture" }, elements: [box([1, 0, 1], [15, 1, 15], "#texture", FACES, { north: [1, 15, 15, 16], south: [1, 15, 15, 16], west: [1, 15, 15, 16], east: [1, 15, 15, 16] })] },
	"block/pressure_plate_down": { textures: { particle: "#texture" }, elements: [box([1, 0, 1], [15, 0.5, 15], "#texture", FACES, { north: [1, 15.5, 15, 16], south: [1, 15.5, 15, 16], west: [1, 15.5, 15, 16], east: [1, 15.5, 15, 16] })] },
	"block/template_trapdoor_bottom": { textures: { particle: "#texture" }, elements: [box([0, 0, 0], [16, 3, 16], "#texture", FACES, { north: [0, 16, 16, 13], south: [0, 16, 16, 13], west: [0, 16, 16, 13], east: [0, 16, 16, 13] })] },
	"block/template_trapdoor_top": { textures: { particle: "#texture" }, elements: [box([0, 13, 0], [16, 16, 16], "#texture", FACES, { north: [0, 16, 16, 13], south: [0, 16, 16, 13], west: [0, 16, 16, 13], east: [0, 16, 16, 13] })] },
	"block/template_trapdoor_open": { textures: { particle: "#texture" }, elements: [box([0, 0, 13], [16, 16, 16], "#texture", FACES, { down: [0, 13, 16, 16], up: [0, 16, 16, 13], west: [16, 0, 13, 16], east: [13, 0, 16, 16] })] },
	"block/template_orientable_trapdoor_bottom": { parent: "block/template_trapdoor_bottom" },
	"block/template_orientable_trapdoor_top": { parent: "block/template_trapdoor_top" },
	"block/template_orientable_trapdoor_open": { parent: "block/template_trapdoor_open" },
	"block/door_bottom_left": { ambientocclusion: false, textures: { particle: "#bottom" }, elements: [box([0, 0, 0], [3, 16, 16], "#bottom", ["down", "north", "south", "west", "east"], { down: [13, 0, 16, 16], north: [3, 0, 0, 16], south: [0, 0, 3, 16], west: [0, 0, 16, 16], east: [16, 0, 0, 16] })] },
	"block/door_bottom_right": { ambientocclusion: false, textures: { particle: "#bottom" }, elements: [box([0, 0, 0], [3, 16, 16], "#bottom", ["down", "north", "south", "west", "east"], { down: [13, 0, 16, 16], north: [3, 0, 0, 16], south: [0, 0, 3, 16], west: [16, 0, 0, 16], east: [0, 0, 16, 16] })] },
	"block/door_bottom_left_open": { parent: "block/door_bottom_right" },
	"block/door_bottom_right_open": { parent: "block/door_bottom_left" },
	"block/door_top_left": { ambientocclusion: false, textures: { particle: "#top" }, elements: [box([0, 0, 0], [3, 16, 16], "#top", ["up", "north", "south", "west", "east"], { up: [13, 0, 16, 16], north: [3, 0, 0, 16], south: [0, 0, 3, 16], west: [0, 0, 16, 16], east: [16, 0, 0, 16] })] },
	"block/door_top_right": { ambientocclusion: false, textures: { particle: "#top" }, elements: [box([0, 0, 0], [3, 16, 16], "#top", ["up", "north", "south", "west", "east"], { up: [13, 0, 16, 16], north: [3, 0, 0, 16], south: [0, 0, 3, 16], west: [16, 0, 0, 16], east: [0, 0, 16, 16] })] },
	"block/door_top_left_open": { parent: "block/door_top_right" },
	"block/door_top_right_open": { parent: "block/door_top_left" },
	"block/template_campfire": {
		textures: { particle: "#log" },
		elements: [
			box([1, 0, 0], [5, 4, 16], "#log", FACES, { north: [0, 4, 4, 8], south: [0, 4, 4, 8], west: [16, 0, 0, 4], east: [0, 1, 16, 5], up: [0, 0, 16, 4], down: [0, 0, 16, 4] }),
			box([11, 0, 0], [15, 4, 16], "#log", FACES, { north: [0, 4, 4, 8], south: [0, 4, 4, 8], west: [16, 0, 0, 4], east: [0, 1, 16, 5], up: [0, 0, 16, 4], down: [0, 0, 16, 4] }),
			box([0, 3, 11], [16, 7, 15], "#log", FACES, { north: [16, 0, 0, 4], south: [0, 0, 16, 4], west: [0, 4, 4, 8], east: [0, 4, 4, 8], up: [0, 0, 16, 4], down: [0, 0, 16, 4] }),
			box([0, 3, 1], [16, 7, 5], "#log", FACES, { north: [16, 0, 0, 4], south: [0, 0, 16, 4], west: [0, 4, 4, 8], east: [0, 4, 4, 8], up: [0, 0, 16, 4], down: [0, 0, 16, 4] }),
			box([5, 0, 0], [11, 1, 16], "#lit_log", ["up", "north", "south"], { up: [0, 8, 16, 14], north: [0, 15, 6, 16], south: [10, 15, 16, 16] }),
			{ from: [0.8, 1, 8], to: [15.2, 17, 8], rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true }, shade: false, faces: { north: { uv: [0, 0, 16, 16], texture: "#fire" }, south: { uv: [0, 0, 16, 16], texture: "#fire" } } },
			{ from: [8, 1, 0.8], to: [8, 17, 15.2], rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true }, shade: false, faces: { west: { uv: [0, 0, 16, 16], texture: "#fire" }, east: { uv: [0, 0, 16, 16], texture: "#fire" } } },
		],
	},
	"block/lectern": {
		textures: { particle: "minecraft:block/lectern_sides", bottom: "minecraft:block/oak_planks", base: "minecraft:block/lectern_base", front: "minecraft:block/lectern_front", sides: "minecraft:block/lectern_sides", top: "minecraft:block/lectern_top" },
		elements: [
			{ from: [0, 0, 0], to: [16, 2, 16], faces: { north: { uv: [0, 14, 16, 16], texture: "#base" }, east: { uv: [0, 14, 16, 16], texture: "#base" }, south: { uv: [0, 14, 16, 16], texture: "#base" }, west: { uv: [0, 14, 16, 16], texture: "#base" }, up: { uv: [0, 0, 16, 16], texture: "#base" }, down: { uv: [0, 0, 16, 16], texture: "#bottom" } } },
			{ from: [4, 2, 4], to: [12, 15, 12], faces: { north: { uv: [0, 0, 8, 13], texture: "#front" }, east: { uv: [2, 16, 15, 8], rotation: 90, texture: "#sides" }, south: { uv: [8, 0, 16, 13], texture: "#front" }, west: { uv: [2, 8, 15, 16], rotation: 90, texture: "#sides" } } },
			{ from: [0.0125, 12, 3], to: [15.9875, 16, 16], rotation: { angle: -22.5, axis: "x", origin: [8, 12, 3] }, faces: { north: { uv: [0, 0, 16, 4], texture: "#sides" }, east: { uv: [0, 4, 13, 8], texture: "#sides" }, south: { uv: [0, 4, 16, 8], texture: "#sides" }, west: { uv: [0, 4, 13, 8], texture: "#sides" }, up: { uv: [0, 1, 16, 14], rotation: 180, texture: "#top" }, down: { uv: [0, 0, 16, 13], texture: "#bottom" } } },
		],
	},
};

/** Normaliza "block/x", "minecraft:block/x", "cobblemon:block/x". */
export function normModelId(id: string): string {
	const { ns, path } = splitId(id, "minecraft");
	return `${ns}:${path}`;
}

const rawCache = new Map<string, JModel | null>();

export function loadRawModel(id: string): JModel | undefined {
	const norm = normModelId(id);
	if (rawCache.has(norm)) return rawCache.get(norm) ?? undefined;
	const { ns, path } = splitId(norm);
	let model: JModel | undefined;
	if (ns === "minecraft") model = VANILLA[path];
	else if (ns === "cobblemon") {
		const file = `${ASSETS}/models/${path}.json`;
		if (existsSync(file)) model = readJson(file);
	}
	rawCache.set(norm, model ?? null);
	return model;
}

const resolvedCache = new Map<string, ResolvedModel | null>();

/** Resolve herança e texturas. Retorna undefined se o modelo (ou um pai) não existir. */
export function resolveModel(id: string): ResolvedModel | undefined {
	const norm = normModelId(id);
	if (resolvedCache.has(norm)) return resolvedCache.get(norm) ?? undefined;
	const chain: string[] = [];
	const layers: JModel[] = [];
	let cur: string | undefined = norm;
	while (cur) {
		if (chain.includes(cur)) break;
		const raw = loadRawModel(cur);
		if (!raw) {
			resolvedCache.set(norm, null);
			return undefined;
		}
		chain.push(cur);
		layers.push(raw);
		cur = raw.parent ? normModelId(raw.parent) : undefined;
	}
	// Texturas: filhos sobrescrevem pais.
	const vars: Record<string, string> = {};
	for (let i = layers.length - 1; i >= 0; i--) Object.assign(vars, layers[i].textures ?? {});
	const textures: Record<string, string> = {};
	for (const k of Object.keys(vars)) {
		let v: string | undefined = vars[k];
		const seen = new Set<string>();
		while (v && v.startsWith("#") && !seen.has(v)) {
			seen.add(v);
			v = vars[v.slice(1)];
		}
		if (v && !v.startsWith("#")) textures[k] = normTextureId(v);
	}
	const ownerIdx = layers.findIndex((l) => Array.isArray(l.elements));
	const ao = layers.find((l) => l.ambientocclusion !== undefined)?.ambientocclusion ?? true;
	const resolved: ResolvedModel = {
		id: norm,
		elementsOwner: ownerIdx >= 0 ? chain[ownerIdx] : undefined,
		elements: ownerIdx >= 0 ? layers[ownerIdx].elements! : [],
		textures,
		ambientOcclusion: ao,
		chain,
	};
	resolvedCache.set(norm, resolved);
	return resolved;
}

export function normTextureId(id: string): string {
	const { ns, path } = splitId(id, "minecraft");
	return `${ns}:${path}`;
}

/** Variável de textura de uma face (sem '#'), ou o id literal quando a face usa um caminho direto. */
export function faceVar(face: JFace): string {
	return face.texture.startsWith("#") ? face.texture.slice(1) : face.texture;
}

/** UV padrão do Java quando a face não define "uv" (derivado da posição do elemento). */
export function autoUV(face: FaceName, from: V3, to: V3): [number, number, number, number] {
	const [x1, y1, z1] = from;
	const [x2, y2, z2] = to;
	switch (face) {
		case "down":
			return [x1, 16 - z2, x2, 16 - z1];
		case "up":
			return [x1, z1, x2, z2];
		case "north":
			return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
		case "south":
			return [x1, 16 - y2, x2, 16 - y1];
		case "west":
			return [z1, 16 - y2, z2, 16 - y1];
		case "east":
			return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
	}
}

/** Modelo de item: textura "layer0" quando é um ícone 2D (item/generated, handheld...). */
export function itemIconTexture(itemId: string): { texture?: string; parent?: string; blockModel?: string } {
	const raw = loadRawModel(`cobblemon:item/${itemId}`);
	if (!raw) return {};
	const chain = resolveModel(`cobblemon:item/${itemId}`);
	const parent = raw.parent ? normModelId(raw.parent) : undefined;
	// Ícone: layer0 do Cobblemon (ou a primeira camada do Cobblemon quando layer0 é vanilla, ex.: tigela).
	const layers = Object.keys(chain?.textures ?? {}).filter((k) => /^layer\d+$/.test(k)).sort();
	const layer0 = layers.map((k) => chain!.textures[k]).find((t) => t.startsWith("cobblemon:")) ?? chain?.textures.layer0;
	if (layer0) return { texture: layer0, parent };
	if (parent?.startsWith("cobblemon:block/") || parent?.startsWith("minecraft:block/")) return { blockModel: parent, parent };
	return { parent };
}

// Pais de item vanilla/Cobblemon sem elementos (ícones 2D).
for (const p of ["item/generated", "item/handheld", "item/handheld_rod", "item/amethyst_bud", "builtin/entity"]) VANILLA[p] ??= {};
