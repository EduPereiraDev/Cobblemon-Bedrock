// Frente "adaptacoes": conteúdo gerado para as adaptações de comportamento do Cobblemon 1.8.2.
//
// 1. Comparador da panela na fogueira (CampfireBlock.getAnalogOutputSignal; chave CAMPFIRE_COMPARATOR em
//    scripts/adaptacoes/flags.ts; exige a fogueira sem `minecraft:redstone_consumer`): estados `cobblemon:comparator` (0..15) e
//    `cobblemon:comparator_faces` (máscara N=1, L=2, S=4, O=8) nas fogueiras do Cobblemon, com uma permutação
//    `minecraft:redstone_producer` por (força, máscara) ligada só nas faces com comparador encostado. O script
//    (scripts/adaptacoes/potHoppers.ts) calcula o sinal do Java e grava os estados.
// 2. Vaso decorado do Cobblemon (`cobblemon:decorated_pot`): bloco (corpo liso do vaso vanilla, mesmas texturas),
//    item (block_placer, pilha de 1), entidade de exibição/armazenamento `cobblemon:decorated_pot_display` (os 4 lados
//    com o padrão de cada sherd por propriedade; 1 espaço de inventário, como o DecoratedPotBlockEntity) e as texturas
//    dos padrões do Cobblemon (textures/entity/decorated_pot/*_pottery_pattern.png).
// Texturas vanilla (decorated_pot_base/side, *_pottery_pattern) são referenciadas pelo caminho do RP vanilla.
import { existsSync } from "node:fs";
import { ASSETS, OUT_BP, OUT_RP, copyFile, count, tryReadJson, warn, writeJson } from "./util.ts";
import { COBBLEMON_SHERDS, DECORATED_POT, DECORATED_POT_DISPLAY, POT_PATTERNS } from "../../scripts/adaptacoes/sherds.ts";
import { CAMPFIRE_COMPARATOR } from "../../scripts/adaptacoes/flags.ts";
import { BASE_PRODUCER } from "./comparadores.ts";

export const COMPARATOR_STATE = "cobblemon:comparator";
export const COMPARATOR_FACES_STATE = "cobblemon:comparator_faces";
const FACE_BITS: Array<[string, number]> = [["north", 1], ["east", 2], ["south", 4], ["west", 8]];
/** Formato mínimo do minecraft:redstone_producer. */
const PRODUCER_FORMAT = "1.21.120";

function versionAtLeast(v: string | undefined, min: string): boolean {
	const a = String(v ?? "0").split(".").map(Number);
	const b = min.split(".").map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d !== 0) return d > 0;
	}
	return true;
}

/** Permutações do comparador (força 1..15 × máscara 1..15). */
export function comparatorPermutations(): Array<{ condition: string; components: Record<string, unknown> }> {
	const out: Array<{ condition: string; components: Record<string, unknown> }> = [];
	for (let power = 1; power <= 15; power++) {
		for (let mask = 1; mask <= 15; mask++) {
			out.push({
				condition: `q.block_state('${COMPARATOR_STATE}') == ${power} && q.block_state('${COMPARATOR_FACES_STATE}') == ${mask}`,
				components: {
					"minecraft:redstone_producer": { power, connected_faces: FACE_BITS.filter(([, bit]) => (mask & bit) !== 0).map(([f]) => f) },
				},
			});
		}
	}
	return out;
}

/** Acrescenta os estados/permutações do comparador a um bloco já gerado. */
function addComparator(block: any): void {
	block.description.states = { ...(block.description.states ?? {}), [COMPARATOR_STATE]: range(16), [COMPARATOR_FACES_STATE]: range(16) };
	// Produtor base de força 0: sem ele, esvaziar (estados 0 = permutação sem produtor) deixa o último sinal preso no
	// circuito (medido no BDS: panela 7 → 0 e vaso 8 → 0, comparador continuou em 7 e 1). Ver comparadores.ts.
	block.components = { ...(block.components ?? {}), "minecraft:redstone_producer": { ...BASE_PRODUCER } };
	block.permutations = [...(block.permutations ?? []), ...comparatorPermutations()];
}

function range(n: number): number[] {
	return Array.from({ length: n }, (_, i) => i);
}

function patchCampfires(): void {
	for (const name of ["campfire", "soul_campfire"]) {
		const file = `${OUT_BP}/blocks/cobblemon/${name}.json`;
		const j = tryReadJson(file);
		const b = j?.["minecraft:block"];
		if (!b?.description) {
			warn("adaptacoes: fogueira do Cobblemon não gerada", name);
			continue;
		}
		addComparator(b);
		if (!versionAtLeast(j.format_version, PRODUCER_FORMAT)) j.format_version = PRODUCER_FORMAT;
		writeJson(file, j);
		count("fogueiras com comparador (adaptacoes)");
	}
}

// ---------------------------------------------------------------------------------------------
// Vaso decorado

const PX = 1;
const TERRAIN_BASE = "cobblemon_decorated_pot_base";
const TERRAIN_SIDE = "cobblemon_decorated_pot_side";
const ICON = "cobblemon_decorated_pot";

/** Geometria do bloco: corpo 14×16×14 (DecoratedPotBlock.BOUNDING_BOX), gargalo e borda do DecoratedPotRenderer. */
function blockGeometry() {
	// Unidades de UV em 32 (decorated_pot_base é 32×32); o lado (16×16) usa o dobro das coordenadas.
	const side = { uv: [2, 0], uv_size: [28, 32], material_instance: "side" };
	return {
		format_version: "1.16.0",
		"minecraft:geometry": [{
			description: { identifier: "geometry.cobblemon.decorated_pot", texture_width: 32, texture_height: 32, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0, 0.5, 0] },
			bones: [{
				name: "pot",
				pivot: [0, 0, 0],
				cubes: [
					// Corpo: lados com o tijolo liso, tampo e fundo da textura base (texOffs(-14, 13), 14×0×14).
					{ origin: [-7, 0, -7], size: [14, 16, 14], uv: { north: side, south: side, east: side, west: side, up: { uv: [0, 13], uv_size: [14, 14] }, down: { uv: [14, 13], uv_size: [14, 14] } } },
					// Gargalo 6×1×6 (texOffs(0, 5), +0,2) e borda 8×3×8 (texOffs(0, 0), −0,1), já virados como no Java.
					{ origin: [-3, 16, -3], size: [6, 1, 6], uv: [0, 5], inflate: 0.2 * PX },
					{ origin: [-4, 17, -4], size: [8, 3, 8], uv: [0, 0], inflate: -0.1 * PX },
				],
			}],
		}],
	};
}

/** Bones dos lados na geometria da entidade (modelo virado para o norte; o eixo X do modelo é espelhado). */
export const SIDE_BONES: Record<"north" | "east" | "south" | "west", { origin: number[]; size: number[]; faces: string[] }> = {
	north: { origin: [-7, 0, -7.05], size: [14, 16, 0], faces: ["north", "south"] },
	south: { origin: [-7, 0, 7.05], size: [14, 16, 0], faces: ["north", "south"] },
	// Com a entidade virada para o norte, X− do modelo fica a leste no mundo.
	east: { origin: [-7.05, 0, -7], size: [0, 16, 14], faces: ["east", "west"] },
	west: { origin: [7.05, 0, -7], size: [0, 16, 14], faces: ["east", "west"] },
};

function entityGeometry() {
	const bones = Object.entries(SIDE_BONES).map(([name, b]) => {
		const uv: Record<string, unknown> = {};
		for (const f of b.faces) uv[f] = { uv: [1, 0], uv_size: [14, 16] };
		return { name: `side_${name}`, pivot: [0, 0, 0], cubes: [{ origin: b.origin, size: b.size, uv }] };
	});
	return {
		format_version: "1.16.0",
		"minecraft:geometry": [{
			description: { identifier: "geometry.cobblemon.decorated_pot_sides", texture_width: 16, texture_height: 16, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0, 0.5, 0] },
			bones,
		}],
	};
}

function emitDecoratedPot(): void {
	// Texturas dos padrões do Cobblemon.
	for (const n of COBBLEMON_SHERDS) {
		const src = `${ASSETS}/textures/entity/decorated_pot/${n}_pottery_pattern.png`;
		if (existsSync(src)) copyFile(src, `${OUT_RP}/textures/entity/decorated_pot/${n}_pottery_pattern.png`);
		else warn("adaptacoes: padrão de vaso ausente", src);
	}

	// Bloco.
	const block = {
		format_version: PRODUCER_FORMAT,
		"minecraft:block": {
			description: { identifier: DECORATED_POT, menu_category: { category: "none", is_hidden_in_commands: false }, states: {} as Record<string, number[]> },
			components: {
				"minecraft:geometry": "geometry.cobblemon.decorated_pot",
				"minecraft:material_instances": {
					"*": { texture: TERRAIN_BASE, render_method: "alpha_test" },
					side: { texture: TERRAIN_SIDE, render_method: "alpha_test" },
				},
				"minecraft:collision_box": { origin: [-7, 0, -7], size: [14, 16, 14] },
				"minecraft:selection_box": { origin: [-7, 0, -7], size: [14, 16, 14] },
				// strength(0.0F, 0.0F): quebra na hora.
				"minecraft:destructible_by_mining": { seconds_to_destroy: 0 },
				"minecraft:destructible_by_explosion": { explosion_resistance: 0 },
				"minecraft:light_dampening": 0,
				"minecraft:map_color": "#8E3C2E",
				"minecraft:movable": { movement_type: "immovable" },
				// Drops pelo script (vaso com os sherds, ou os sherds quando rachado).
				"minecraft:loot": "loot_tables/empty.json",
				"minecraft:display_name": "item.cobblemon.decorated_pot",
				"cobblemon:decorated_pot": {},
			},
			permutations: [] as unknown[],
		},
	};
	addComparator(block["minecraft:block"]);
	writeJson(`${OUT_BP}/blocks/adaptacoes/decorated_pot.json`, block);
	writeJson(`${OUT_RP}/models/blocks/adaptacoes/decorated_pot.geo.json`, blockGeometry());

	// Item (DecoratedPotBlock: pilha de 1 no 1.21.1).
	writeJson(`${OUT_BP}/items/adaptacoes/decorated_pot.json`, {
		format_version: "1.21.90",
		"minecraft:item": {
			// Categoria visível: item com "none" fica fora do /give (medido pela frente give, docs/pendencias/give.md).
			description: { identifier: DECORATED_POT, menu_category: { category: "items" } },
			components: {
				"minecraft:display_name": { value: "item.cobblemon.decorated_pot" },
				"minecraft:icon": ICON,
				"minecraft:max_stack_size": 1,
				"minecraft:block_placer": { block: DECORATED_POT, replace_block_item: true },
			},
		},
	});

	// Entidade de exibição/armazenamento.
	const faceProps: Record<string, unknown> = {};
	for (const f of ["north", "east", "south", "west"]) faceProps[`cobblemon:face_${f}`] = { type: "int", range: [0, POT_PATTERNS.length - 1], default: 0, client_sync: true };
	writeJson(`${OUT_BP}/entities/display/decorated_pot_display.json`, {
		format_version: "1.21.90",
		"minecraft:entity": {
			description: { identifier: DECORATED_POT_DISPLAY, is_spawnable: false, is_summonable: true, properties: faceProps },
			components: {
				"minecraft:type_family": { family: ["cobblemon_display", "inanimate"] },
				"minecraft:collision_box": { width: 0.1, height: 0.1 },
				"minecraft:inventory": { container_type: "inventory", inventory_size: 1 },
				"minecraft:physics": { has_gravity: false, has_collision: false },
				"minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
				"minecraft:damage_sensor": { triggers: [{ cause: "all", deals_damage: "no" }] },
				"minecraft:health": { value: 1, max: 1 },
				"minecraft:knockback_resistance": { value: 1 },
				"minecraft:fire_immune": true,
				"minecraft:breathable": { breathes_air: true, breathes_water: true, suffocate_time: 0, total_supply: 15 },
				"minecraft:persistent": {},
			},
		},
	});

	const textures: Record<string, string> = {};
	POT_PATTERNS.forEach((p, i) => { textures[`p${i}`] = p.texture; });
	const texArray = POT_PATTERNS.map((_, i) => `Texture.p${i}`);
	const rcs: Record<string, unknown> = {};
	const rcList: Array<Record<string, string>> = [];
	for (const f of ["north", "east", "south", "west"]) {
		const id = `controller.render.cobblemon.decorated_pot.${f}`;
		rcs[id] = {
			arrays: { textures: { "Array.patterns": texArray } },
			geometry: "Geometry.default",
			materials: [{ "*": "Material.default" }],
			textures: [`Array.patterns[q.property('cobblemon:face_${f}')]`],
			part_visibility: [{ "*": false }, { [`side_${f}`]: true }],
		};
		// Lado de tijolo (0) já é o do bloco: só desenha os lados com sherd.
		rcList.push({ [id]: `q.property('cobblemon:face_${f}') > 0` });
	}
	writeJson(`${OUT_RP}/render_controllers/adaptacoes/decorated_pot.render_controllers.json`, { format_version: "1.10.0", render_controllers: rcs });
	writeJson(`${OUT_RP}/models/entity/adaptacoes/decorated_pot_sides.geo.json`, entityGeometry());
	writeJson(`${OUT_RP}/entity/display/decorated_pot_display.entity.json`, {
		format_version: "1.10.0",
		"minecraft:client_entity": {
			description: {
				identifier: DECORATED_POT_DISPLAY,
				materials: { default: "entity_alphatest" },
				textures,
				geometry: { default: "geometry.cobblemon.decorated_pot_sides" },
				render_controllers: rcList,
			},
		},
	});

	// Atlas do terreno/ícones e sons do bloco (arquivos gerados compartilhados: só acrescenta chaves).
	const terrainFile = `${OUT_RP}/textures/terrain_texture.json`;
	const terrain = tryReadJson(terrainFile) ?? { resource_pack_name: "cobblemon", texture_name: "atlas.terrain", padding: 8, num_mip_levels: 4, texture_data: {} };
	terrain.texture_data ??= {};
	terrain.texture_data[TERRAIN_BASE] = { textures: "textures/blocks/decorated_pot_base" };
	terrain.texture_data[TERRAIN_SIDE] = { textures: "textures/blocks/decorated_pot_side" };
	writeJson(terrainFile, terrain);
	const itemsFile = `${OUT_RP}/textures/item_texture.json`;
	const items = tryReadJson(itemsFile) ?? { resource_pack_name: "cobblemon", texture_name: "atlas.items", texture_data: {} };
	items.texture_data ??= {};
	items.texture_data[ICON] = { textures: "textures/blocks/decorated_pot_side" };
	writeJson(itemsFile, items);
	const blocksFile = `${OUT_RP}/blocks.json`;
	const blocks = tryReadJson(blocksFile) ?? { format_version: [1, 1, 0] };
	blocks[DECORATED_POT] = { sound: "decorated_pot" };
	writeJson(blocksFile, blocks);
	count("vaso decorado do Cobblemon (adaptacoes)");
}

/** Chamado pelo index.ts depois dos blocos/itens gerados. */
export function emitAdaptacoes(): void {
	// A fogueira não pode ter redstone_consumer (ver scripts/adaptacoes/flags.ts); a tampa lê os vizinhos por script.
	if (CAMPFIRE_COMPARATOR) patchCampfires();
	emitDecoratedPot();
}
