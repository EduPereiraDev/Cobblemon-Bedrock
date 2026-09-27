// Frente "mundo-detalhes": detalhes de mundo/entidade do Cobblemon 1.8.2 que o importador gera.
//
//   - Item segurado visível (HeldItemRenderer.kt): cada geometria de Pokémon ganha ossos nos locators `item`,
//     `item_hat` e `item_face` — `leftItem`/`rightItem` (o renderizador de item do Bedrock desenha a mão
//     secundária/principal ali) e âncoras `cobblemon_anchor_*` (pivô na origem, levadas ao locator por uma
//     animação gerada) onde os attachables dos vestíveis se prendem.
//   - Vestíveis (WearableHatItem/WearableBlockItem, 17 itens): attachable por item com a geometria convertida
//     do modelo Java `item/wearable/<nome>` — na cabeça do jogador (`.player`, contexto HEAD do CustomHeadLayer)
//     e na âncora `item_hat`/`item_face` do Pokémon (setOriginAndScale do HeldItemRenderer).
//   - Catálogo do criativo (CobblemonItemGroups.kt): item_catalog/crafting_item_catalog.json com um grupo por aba.
//   - Compostagem (registerCompostable), Fortuna (apply_bonus das loot tables), luz dinâmica (lightingData),
//     inflamáveis (CobblemonBlocks.init/setFlammable), atrito do Never-Melt Ice e comportamentos de espécie
//     (pokemon_fox, pokemon_bee, pokemon_picks_up_items, pokemon_gets_mad_at_thrower) → generated/scripts/mundoDetalhes.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRawModel, resolveModel } from "./javaModels.ts";
import type { JElement, V3 } from "./javaModels.ts";
import { loadKotlinItems } from "./kotlin.ts";
import type { KtItem } from "./kotlin.ts";
import { itemIconTexture } from "./javaModels.ts";
import { decodePng } from "./png.ts";
import { ASSETS, DATA, HAND_BP, OUT_BP, OUT_RP, OUT_SCRIPTS, ROOT, copyFile, count, parseLenient, readJson, splitId, tryReadJson, walk, warn, writeJson, writeText } from "./util.ts";

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const KOTLIN = join(ASSETS, "..", "..", "..", "kotlin", "com", "cobblemon", "mod", "common");

// ---------------------------------------------------------------------------------------------
// Item segurado: ossos nos locators

interface Loc {
	/** Osso que contém o locator (a âncora vira filha dele). */
	parent: string;
	pos: V3;
	rot: V3;
}
interface GeoLocators {
	item?: Loc;
	hat?: Loc;
	face?: Loc;
}

/** Locators de item por identificador de geometria (preenchido em models.emit). */
export const GEO_LOCATORS = new Map<string, GeoLocators>();

export const ANCHOR_ITEM = "cobblemon_anchor_item";
export const ANCHOR_HAT = "cobblemon_anchor_hat";
export const ANCHOR_FACE = "cobblemon_anchor_face";

function locOf(bone: any, name: string): Loc | undefined {
	const v = bone?.locators?.[name];
	if (!v) return undefined;
	const pos = Array.isArray(v) ? v : v.offset;
	if (!Array.isArray(pos) || pos.length < 3) return undefined;
	const rot = !Array.isArray(v) && Array.isArray(v.rotation) ? v.rotation : [0, 0, 0];
	return { parent: bone.name, pos: pos.map(Number) as V3, rot: rot.map(Number) as V3 };
}

/**
 * Acrescenta à geometria (já copiada) os ossos do item segurado. Chamado por ModelIndex.emit.
 * `leftItem`/`rightItem` ficam no locator `item` (o Bedrock desenha ali o item da mão secundária/principal);
 * as âncoras ficam com pivô na origem e são posicionadas pela animação de `heldItemAnchorAnimation`.
 */
export function patchHeldItemBones(geo: any, geometryId: string): void {
	const bones: any[] = geo?.bones ?? [];
	const found: GeoLocators = {};
	for (const b of bones) {
		found.item ??= locOf(b, "item");
		found.hat ??= locOf(b, "item_hat");
		found.face ??= locOf(b, "item_face");
	}
	GEO_LOCATORS.set(geometryId, found);
	if (!found.item && !found.hat && !found.face) return;
	const names = new Set(bones.map((b) => String(b.name).toLowerCase()));
	const add = (bone: Record<string, unknown>) => {
		if (names.has(String(bone.name).toLowerCase())) return;
		names.add(String(bone.name).toLowerCase());
		bones.push(bone);
	};
	if (found.item) {
		add({ name: "rightItem", parent: found.item.parent, pivot: found.item.pos });
		add({ name: "leftItem", parent: found.item.parent, pivot: found.item.pos });
		add({ name: ANCHOR_ITEM, parent: found.item.parent, pivot: [0, 0, 0] });
	}
	const hat = found.hat ?? found.item;
	const face = found.face ?? found.item;
	if (hat) add({ name: ANCHOR_HAT, parent: hat.parent, pivot: [0, 0, 0] });
	if (face) add({ name: ANCHOR_FACE, parent: face.parent, pivot: [0, 0, 0] });
	geo.bones = bones;
}

/** Flags por variante (bit 1 = item, 2 = item_hat, 4 = item_face) de cada espécie, para os scripts. */
const HELD_FLAGS = new Map<string, number[]>();

function flagsOf(l: GeoLocators | undefined): number {
	return (l?.item ? 1 : 0) | (l?.hat ? 2 : 0) | (l?.face ? 4 : 0);
}

/**
 * Expressão Molang com um valor por variante. Frente cliente-modelos: busca binária em v.cobblemon_variant (profundidade
 * log2 n). A cadeia "v == 0 ? a : (v == 1 ? b : (...))" com 264 variantes (raichu) estourava a pilha do parser do
 * cliente ("Expression could not be parsed due to stack depth").
 */
export function perVariant(values: number[]): number | string {
	const build = (lo: number, hi: number): string => {
		if (new Set(values.slice(lo, hi)).size === 1) return String(values[lo]);
		const mid = (lo + hi) >> 1;
		return `v.cobblemon_variant < ${mid} ? (${build(lo, mid)}) : (${build(mid, hi)})`;
	};
	if (new Set(values).size === 1) return values[0];
	return build(0, values.length);
}

/**
 * Animação que leva as âncoras (pivô na origem) até os locators de cada variante. Devolve [chave, id] para a
 * client entity, ou undefined se nenhuma geometria da espécie tem locator de item.
 */
export function heldItemAnchorAnimation(species: string, geometryIds: string[]): [string, string] | undefined {
	const locs = geometryIds.map((g) => GEO_LOCATORS.get(g));
	HELD_FLAGS.set(species, locs.map(flagsOf));
	if (!locs.some((l) => l && (l.item || l.hat || l.face))) return undefined;
	const bones: Record<string, unknown> = {};
	const channel = (pick: (l: GeoLocators) => Loc | undefined, bone: string) => {
		const per = locs.map((l) => (l ? pick(l) : undefined));
		if (!per.some(Boolean)) return;
		const pos = [0, 1, 2].map((i) => perVariant(per.map((p) => r4(p?.pos[i] ?? 0))));
		const rot = [0, 1, 2].map((i) => perVariant(per.map((p) => r4(p?.rot[i] ?? 0))));
		const entry: Record<string, unknown> = { position: pos };
		if (rot.some((v) => v !== 0)) entry.rotation = rot;
		bones[bone] = entry;
	};
	channel((l) => l.item, ANCHOR_ITEM);
	channel((l) => l.hat ?? l.item, ANCHOR_HAT);
	channel((l) => l.face ?? l.item, ANCHOR_FACE);
	const id = `animation.cobblemon_gen.${species}.held_item_anchor`;
	writeJson(`${OUT_RP}/animations/pokemon/_generated/${species}_held.animation.json`, { format_version: "1.8.0", animations: { [id]: { loop: true, bones } } });
	count("animações de âncora do item segurado");
	return ["cobblemon_held_item_anchor", id];
}

// ---------------------------------------------------------------------------------------------
// Vestíveis (attachables)

export interface WearableOut {
	id: string;
	/** Tag held/visibility do Java: hat, face ou nenhuma (fica no locator `item`). */
	kind: "hat" | "face" | "item";
}

/** Nomes dos vestíveis em CobblemonItems.kt (wearableItem/wearableBlockItem). */
export function wearableItems(): KtItem[] {
	return loadKotlinItems().filter((it) => /^wearable(Block)?Item$/.test(it.helper ?? ""));
}

function visibilityTag(name: string): string[] {
	const file = `${DATA}/cobblemon/tags/item/held/visibility/${name}.json`;
	if (!existsSync(file)) return [];
	return (readJson(file).values ?? []).map((v: any) => (typeof v === "string" ? v : v?.id)).filter((v: unknown): v is string => typeof v === "string");
}

/** Transformação HEAD (`display.head`) do primeiro modelo da cadeia que a define. */
function headDisplay(chain: string[]): { translation: V3; rotation: V3; scale: V3 } {
	for (const id of chain) {
		const d = (loadRawModel(id) as any)?.display?.head;
		if (d) return { translation: d.translation ?? [0, 0, 0], rotation: d.rotation ?? [0, 0, 0], scale: d.scale ?? [1, 1, 1] };
	}
	return { translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

/**
 * Cubos do modelo Java (0..16 px, com a convenção de eixos do blockModels.ts: x espelhado, y e z mantidos) já na
 * escala final: ponto → anchor + k·(T + S·(p − 8)). UV por face em pixels da textura (largura `texW`).
 */
function wearableCubes(elements: JElement[], texW: number, texH: number, k: number, s: V3, anchor: V3, t: V3): Array<Record<string, unknown>> {
	const f = texW / 16;
	const g = texH / 16;
	const map = (p: V3): V3 => [
		anchor[0] + k * (-t[0] + s[0] * (8 - p[0])),
		anchor[1] + k * (t[1] + s[1] * (p[1] - 8)),
		anchor[2] + k * (t[2] + s[2] * (p[2] - 8)),
	];
	const cubes: Array<Record<string, unknown>> = [];
	for (const e of elements) {
		const a = map(e.from);
		const b = map(e.to);
		const origin: V3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
		const size: V3 = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
		const uv: Record<string, unknown> = {};
		for (const [face, fc] of Object.entries(e.faces ?? {})) {
			if (!fc) continue;
			const [u1, v1, u2, v2] = fc.uv ?? [0, 0, 16, 16];
			const out: Record<string, unknown> = { uv: [r4(u1 * f), r4(v1 * g)], uv_size: [r4((u2 - u1) * f), r4((v2 - v1) * g)] };
			if (face === "up" || face === "down") {
				out.uv = [r4(u2 * f), r4(v2 * g)];
				out.uv_size = [r4((u1 - u2) * f), r4((v1 - v2) * g)];
			}
			if (fc.rotation) out.uv_rotation = fc.rotation;
			uv[face] = out;
		}
		if (!Object.keys(uv).length) continue;
		const cube: Record<string, unknown> = { origin: origin.map(r4), size: size.map(r4), uv };
		const rot = e.rotation;
		if (rot && rot.angle) {
			cube.pivot = map(rot.origin).map(r4);
			cube.rotation = rot.axis === "x" ? [-rot.angle, 0, 0] : rot.axis === "y" ? [0, -rot.angle, 0] : [0, 0, rot.angle];
		}
		cubes.push(cube);
	}
	return cubes;
}

/**
 * Attachables dos vestíveis. Jogador: osso "head" (as mesmas coordenadas do modelo do jogador; centro da cabeça
 * em [0, 28, 0]) com o contexto HEAD do CustomHeadLayer (escala 0,625); na mão, o sprite 2D do ícone com a
 * geometria/animação do arco vanilla. Pokémon: preso à âncora `cobblemon_anchor_hat`/`face` (origem = locator),
 * com o deslocamento e a escala 0,62 do HeldItemRenderer.
 */
export function emitWearables(): WearableOut[] {
	const hat = new Set(visibilityTag("hat"));
	const face = new Set(visibilityTag("face"));
	const out: WearableOut[] = [];
	for (const it of wearableItems()) {
		const id = `cobblemon:${it.id}`;
		const model = resolveModel(`cobblemon:item/wearable/${it.id}`);
		if (!model || !model.elements.length) {
			warn("vestível sem modelo 3D", it.id);
			continue;
		}
		const texVar = Object.keys(model.textures).find((k) => k !== "particle") ?? "particle";
		const texId = model.textures[texVar];
		const { ns, path } = splitId(texId);
		const texFile = `${ASSETS}/textures/${path}.png`;
		if (ns !== "cobblemon" || !existsSync(texFile)) {
			warn("vestível sem textura", it.id);
			continue;
		}
		const png = decodePng(texFile);
		const texW = png?.width ?? 16;
		// Textura animada (tira vertical): usa a altura de um quadro na UV (o Bedrock mostra o 1º quadro).
		const texH = png && png.height > png.width && existsSync(`${texFile}.mcmeta`) ? png.width : png?.height ?? 16;
		const wearRef = `textures/${path}`;
		copyFile(texFile, `${OUT_RP}/${wearRef}.png`);
		const icon = itemIconTexture(it.id).texture;
		const iconRef = icon && splitId(icon).ns === "cobblemon" && existsSync(`${ASSETS}/textures/${splitId(icon).path}.png`) ? `textures/${splitId(icon).path}` : wearRef;
		const d = headDisplay(model.chain);
		const kind: WearableOut["kind"] = face.has(id) ? "face" : hat.has(id) ? "hat" : "item";
		const rotX = Number(d.rotation[0] ?? 0);
		const geoOf = (identifier: string, bone: Record<string, unknown>, cubes: Array<Record<string, unknown>>, pivot: V3) => ({
			description: { identifier, texture_width: texW, texture_height: texH, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 1, 0] },
			bones: [
				bone,
				// Rotação do display.head (só o Cleanse/Spell Tag usam: 10° em X) em volta do centro do item.
				{ name: "wearable", parent: bone.name, pivot, ...(rotX ? { rotation: [-rotX, -Number(d.rotation[1] ?? 0), Number(d.rotation[2] ?? 0)] } : {}), cubes },
			],
		});
		// Jogador: centro da cabeça = pescoço (pivô [0, 24, 0]) + 4 px (translate(0, -0.25, 0) do CustomHeadLayer).
		const playerAnchor: V3 = [0, 28, 0];
		const kPlayer = 0.625;
		const playerCubes = wearableCubes(model.elements, texW, texH, kPlayer, d.scale, playerAnchor, d.translation);
		const playerPivot: V3 = [r4(playerAnchor[0] - kPlayer * d.translation[0]), r4(playerAnchor[1] + kPlayer * d.translation[1]), r4(playerAnchor[2] + kPlayer * d.translation[2])];
		// Pokémon: setOriginAndScale(0, -6.75, 0, .62) no chapéu; (0, 1, 6.75, .62) no rosto (frente do modelo = -z).
		const kPoke = 0.62;
		const pokeAnchor: V3 = kind === "face" ? [0, r4(1 * kPoke), r4(6.75 * kPoke)] : [0, r4(-6.75 * kPoke), 0];
		const pokeCubes = wearableCubes(model.elements, texW, texH, kPoke, d.scale, pokeAnchor, d.translation);
		const pokePivot: V3 = [r4(pokeAnchor[0] - kPoke * d.translation[0]), r4(pokeAnchor[1] + kPoke * d.translation[1]), r4(pokeAnchor[2] + kPoke * d.translation[2])];
		const anchorBone = kind === "face" ? ANCHOR_FACE : kind === "hat" ? ANCHOR_HAT : ANCHOR_ITEM;
		const geoPlayer = `geometry.cobblemon.wearable.${it.id}.player`;
		const geoPokemon = `geometry.cobblemon.wearable.${it.id}.pokemon`;
		const usesUvRotation = model.elements.some((e) => Object.values(e.faces ?? {}).some((fc) => fc?.rotation));
		writeJson(`${OUT_RP}/models/entity/wearables/${it.id}.geo.json`, {
			format_version: usesUvRotation ? "1.21.0" : "1.16.0",
			"minecraft:geometry": [
				geoOf(geoPlayer, { name: "cobblemon_wearable_head", pivot: [0, 24, 0], binding: "'head'" }, playerCubes, playerPivot),
				geoOf(geoPokemon, { name: "cobblemon_wearable_root", pivot: [0, 0, 0], binding: `'${anchorBone}'` }, pokeCubes, pokePivot),
			],
		});
		// Jogador: cabeça (slot de capacete) ou sprite na mão.
		writeJson(`${OUT_RP}/attachables/cobblemon/${it.id}.player.json`, {
			format_version: "1.10.0",
			"minecraft:attachable": {
				description: {
					identifier: `${id}.player`,
					item: { [id]: "q.owner_identifier == 'minecraft:player'" },
					materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
					textures: { default: iconRef, wearable: wearRef, enchanted: "textures/misc/enchanted_item_glint" },
					geometry: { default: "geometry.bow_standby", head: geoPlayer },
					animations: { wield: "animation.bow.wield" },
					scripts: {
						// Na cabeça o modelo é desenhado mesmo com o capacete escondido nas opções do jogador.
						parent_setup: "v.helmet_layer_visible = 0.0;",
						animate: [{ wield: "c.item_slot != 'head'" }],
					},
					render_controllers: ["controller.render.cobblemon.wearable.player"],
				},
			},
		});
		// Pokémon (e qualquer outro dono): âncora do locator.
		writeJson(`${OUT_RP}/attachables/cobblemon/${it.id}.json`, {
			format_version: "1.10.0",
			"minecraft:attachable": {
				description: {
					identifier: id,
					materials: { default: "entity_alphatest", enchanted: "entity_alphatest_glint" },
					textures: { default: wearRef, enchanted: "textures/misc/enchanted_item_glint" },
					geometry: { default: geoPokemon },
					render_controllers: ["controller.render.item_default"],
				},
			},
		});
		out.push({ id, kind });
		count("vestíveis (attachables)");
	}
	writeJson(`${OUT_RP}/render_controllers/cobblemon_wearables.render_controllers.json`, {
		format_version: "1.10.0",
		render_controllers: {
			"controller.render.cobblemon.wearable.player": {
				geometry: "c.item_slot == 'head' ? Geometry.head : Geometry.default",
				materials: [{ "*": "v.is_enchanted ? Material.enchanted : Material.default" }],
				textures: ["c.item_slot == 'head' ? Texture.wearable : Texture.default", "Texture.enchanted"],
			},
		},
	});
	return out;
}

// ---------------------------------------------------------------------------------------------
// Compostagem (Cobblemon.implementation.registerCompostable)

const HELPER_COMPOST: Record<string, number> = { berryItem: 0.65, mintItem: 0.95, apricornItem: 0.65, apricornSeedItem: 0.3, mintSeed: 0.3, mintLeaf: 0.5 };

/** Chance (0..1) de subir o nível da composteira, como no CobblemonItems.kt; undefined se não é compostável. */
export function compostChance(it: KtItem): number | undefined {
	if (it.helper && it.helper in HELPER_COMPOST) return HELPER_COMPOST[it.helper];
	if (/MintItem\(/.test(it.body) && it.helper === "mintItem") return 0.95;
	const defaults: Record<string, number> = { compostableItem: 0.65, compostableHeldItem: 0.65, compostableBlockItem: 0.85, compostableItemNameBlockItem: 0.3 };
	if (it.helper && it.helper in defaults) {
		const m = /,\s*([\d.]+)[fF]\s*\)\s*$/.exec(it.body.trim());
		return m ? Number(m[1]) : defaults[it.helper];
	}
	// Classes que se registram sozinhas no init (MedicinalLeekItem, RevivalHerbItem, HealPowderItem).
	if (/MedicinalLeekItem/.test(it.body)) return 0.65;
	if (/RevivalHerbItem/.test(it.body)) return 0.65;
	if (/HealPowderItem/.test(it.body)) return 0.75;
	return undefined;
}

// ---------------------------------------------------------------------------------------------
// Catálogo do criativo (CobblemonItemGroups.kt)

const GROUP_CATEGORY: Record<string, string> = {
	blocks: "construction",
	utility_item: "equipment",
	agriculture: "nature",
	archaeology: "items",
	consumables: "items",
	held_item: "items",
	evolution_item: "items",
};

/** Abas do Cobblemon em ordem: nome, ícone e itens (ids sem namespace, na ordem do Kotlin). */
export function creativeTabs(): Array<{ name: string; icon: string; items: string[] }> {
	const file = join(KOTLIN, "item", "group", "CobblemonItemGroups.kt");
	if (!existsSync(file)) return [];
	const src = readFileSync(file, "utf8");
	const items = loadKotlinItems();
	const byName = new Map(items.map((i) => [i.name, i.id]));
	const helperIds = (helper: string) => items.filter((i) => i.helper === helper).map((i) => i.id);
	const collections: Record<string, () => string[]> = {
		"berries()": () => helperIds("berryItem"),
		campfire_pots: () => helperIds("campfirePotItem"),
		pokeBalls: () => helperIds("pokeBallItem"),
		pokeRods: () => helperIds("pokerodItem"),
		pokedexes: () => helperIds("pokedexItem"),
	};
	const tabs: Array<{ name: string; icon: string; items: string[] }> = [];
	for (const m of src.matchAll(/val ([A-Z_]+)_KEY = this\.create\("([a-z_]+)", this::([a-zA-Z]+)\)\s*\{\s*ItemStack\(CobblemonItems\.([A-Z0-9_]+)\)/g)) {
		const [, , name, fn, iconConst] = m;
		const start = src.indexOf(`private fun ${fn}(`);
		if (start < 0) continue;
		const bodyStart = src.indexOf("{", start);
		let depth = 0;
		let end = bodyStart;
		for (let i = bodyStart; i < src.length; i++) {
			if (src[i] === "{") depth++;
			else if (src[i] === "}" && --depth === 0) {
				end = i;
				break;
			}
		}
		const body = src.slice(bodyStart, end).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
		const list: string[] = [];
		for (const r of body.matchAll(/CobblemonItems\.([A-Za-z_0-9]+(?:\(\))?)/g)) {
			const ref = r[1];
			if (collections[ref]) list.push(...collections[ref]());
			else {
				const id = byName.get(ref);
				if (id) list.push(id);
			}
		}
		tabs.push({ name, icon: byName.get(iconConst) ?? list[0], items: [...new Set(list)] });
	}
	return tabs;
}

/**
 * Grava item_catalog/crafting_item_catalog.json (um grupo por aba do Cobblemon) e tira o menu_category dos
 * itens/blocos listados (o Bedrock avisa quando o catálogo muda a categoria/grupo definida no item).
 * Devolve as chaves de tradução dos grupos.
 */
export function emitCreativeCatalog(existing: Set<string>): Record<string, string> {
	const tabs = creativeTabs();
	const placed = new Set<string>();
	/** id → [categoria, grupo] do catálogo (os blocos levam o mesmo no menu_category; sem ele o Bedrock avisa). */
	const groupOf = new Map<string, [string, string]>();
	const byCategory = new Map<string, Array<Record<string, unknown>>>();
	const langKeys: Record<string, string> = {};
	for (const tab of tabs) {
		const ids = tab.items.map((i) => `cobblemon:${i}`).filter((i) => existing.has(i) && !placed.has(i));
		if (!ids.length) continue;
		const category = GROUP_CATEGORY[tab.name] ?? "items";
		const name = `cobblemon:itemGroup.cobblemon.${tab.name}`;
		for (const i of ids) {
			placed.add(i);
			groupOf.set(i, [category, name]);
		}
		langKeys[name] = `itemGroup.cobblemon.${tab.name}`;
		const icon = existing.has(`cobblemon:${tab.icon}`) ? `cobblemon:${tab.icon}` : ids[0];
		const list = byCategory.get(category) ?? [];
		list.push({ group_identifier: { icon, name }, items: ids });
		byCategory.set(category, list);
	}
	writeJson(`${OUT_BP}/item_catalog/crafting_item_catalog.json`, {
		format_version: "1.21.60",
		"minecraft:crafting_items_catalog": { categories: [...byCategory].map(([category_name, groups]) => ({ category_name, groups })) },
	});
	// Tira o menu_category dos itens/blocos gerados que entraram no catálogo.
	let stripped = 0;
	for (const dir of ["items", "blocks"]) {
		for (const file of walk(`${OUT_BP}/${dir}`, (n) => n.endsWith(".json"))) {
			const j = tryReadJson(file);
			const root = j?.["minecraft:item"] ?? j?.["minecraft:block"];
			const id = root?.description?.identifier;
			if (!id || !placed.has(id) || !root.description.menu_category) continue;
			// Item: sem menu_category (o catálogo decide). Bloco: sem menu_category o Bedrock assume "none" e avisa
			// ao mudar; com a mesma categoria e grupo do catálogo não há mudança.
			if (dir === "items") delete root.description.menu_category;
			else {
				const [category, group] = groupOf.get(id)!;
				root.description.menu_category = { category, group };
			}
			writeJson(file, j);
			stripped++;
		}
	}
	count("itens no catálogo do criativo", placed.size);
	count("menu_category removidos (catálogo)", stripped);
	return langKeys;
}

// ---------------------------------------------------------------------------------------------
// Fortuna (apply_bonus das loot tables de bloco)

export interface FortuneEntry {
	/** Item que ganha o bônus (Bedrock). */
	item: string;
	formula: "ore_drops" | "uniform_bonus_count" | "binomial_with_bonus_count";
	/** Quantidade base (set_count antes do bônus). */
	min: number;
	max: number;
	bonusMultiplier?: number;
	extra?: number;
	probability?: number;
	/** limit_count depois do bônus. */
	limitMax?: number;
	/** Estados exigidos (block_state_property), já com o prefixo cobblemon:. */
	states?: Record<string, string | number>;
}

function numRange(v: any): { min: number; max: number } {
	if (typeof v === "number") return { min: v, max: v };
	if (v && typeof v === "object") {
		if (v.min !== undefined || v.max !== undefined) return { min: Number(v.min ?? v.max), max: Number(v.max ?? v.min) };
		if (v.value !== undefined) return { min: Number(v.value), max: Number(v.value) };
	}
	return { min: 1, max: 1 };
}

/** Blocos (id Bedrock) → bônus de Fortuna, lidos de data/cobblemon/loot_table/blocks. */
export function fortuneData(): Record<string, FortuneEntry[]> {
	const out: Record<string, FortuneEntry[]> = {};
	for (const file of walk(`${DATA}/cobblemon/loot_table/blocks`, (n) => n.endsWith(".json"))) {
		const text = readFileSync(file, "utf8");
		if (!text.includes("apply_bonus")) continue;
		const j = JSON.parse(text);
		const block = `cobblemon:${file.split("/").pop()!.replace(/\.json$/, "")}`;
		const entries: FortuneEntry[] = [];
		const visit = (node: any, inherited: { fns: any[]; states?: Record<string, string | number> }) => {
			if (!node || typeof node !== "object") return;
			const states = { ...(inherited.states ?? {}) };
			for (const c of node.conditions ?? []) {
				if (String(c.condition).endsWith("block_state_property")) for (const [k, v] of Object.entries<any>(c.properties ?? {})) states[`cobblemon:${k}`] = /^\d+$/.test(String(v)) ? Number(v) : String(v);
			}
			const fns = [...inherited.fns, ...(node.functions ?? [])];
			if (String(node.type ?? "").endsWith("item") && typeof node.name === "string") {
				const bonus = fns.find((f) => String(f.function).endsWith("apply_bonus"));
				if (bonus) {
					const setCount = [...fns].reverse().find((f, i, arr) => String(f.function).endsWith("set_count") && arr.indexOf(bonus) < i);
					const base = setCount ? numRange(setCount.count) : { min: 1, max: 1 };
					const limit = fns.find((f) => String(f.function).endsWith("limit_count"));
					const formula = String(bonus.formula).replace(/^minecraft:/, "") as FortuneEntry["formula"];
					entries.push({
						item: node.name,
						formula,
						min: base.min,
						max: base.max,
						...(bonus.parameters?.bonusMultiplier !== undefined ? { bonusMultiplier: Number(bonus.parameters.bonusMultiplier) } : {}),
						...(bonus.parameters?.extra !== undefined ? { extra: Number(bonus.parameters.extra), probability: Number(bonus.parameters.probability) } : {}),
						...(limit?.limit?.max !== undefined ? { limitMax: Number(limit.limit.max) } : {}),
						...(Object.keys(states).length ? { states } : {}),
					});
				}
			}
			for (const child of node.children ?? []) visit(child, { fns, states });
			for (const entry of node.entries ?? []) visit(entry, { fns, states });
		};
		for (const pool of j.pools ?? []) visit(pool, { fns: [...(j.functions ?? [])] });
		if (entries.length) out[block] = entries;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Blocos: inflamáveis (CobblemonBlocks.init) e atrito

/** [chance de pegar fogo (encouragement), chance de queimar (flammability)] do setFlammable do Kotlin. */
export const FLAMMABLE_BLOCKS: Record<string, [number, number]> = {
	apricorn_log: [5, 5], stripped_apricorn_log: [5, 5], apricorn_wood: [5, 5], stripped_apricorn_wood: [5, 5],
	apricorn_planks: [5, 20], apricorn_leaves: [30, 60], apricorn_fence: [5, 20], apricorn_fence_gate: [5, 20],
	apricorn_slab: [5, 20], apricorn_stairs: [5, 20],
	saccharine_log: [5, 5], saccharine_log_slathered: [5, 5], stripped_saccharine_log: [5, 5], saccharine_wood: [5, 5],
	stripped_saccharine_wood: [5, 5], saccharine_planks: [5, 20], saccharine_leaves: [30, 60], saccharine_fence: [5, 20],
	saccharine_fence_gate: [5, 20], saccharine_slab: [5, 20], saccharine_stairs: [5, 20],
};

/** Escorregamento do Java (BlockBehaviour.Properties.friction) → minecraft:friction do Bedrock (1 − escorregamento). */
const SLIPPERY_BLOCKS: Record<string, number> = { never_melt_ice: 0.989 };

/** Blocos da tag cobblemon:dripstone_growable (sem o dripstone_block vanilla). */
const DRIPSTONE_GROWABLE = new Set(
	((tryReadJson(`${DATA}/cobblemon/tags/block/dripstone_growable.json`)?.values ?? []) as unknown[])
		.map((v) => String(typeof v === "string" ? v : (v as { id?: string })?.id ?? ""))
		.filter((v) => v.startsWith("cobblemon:"))
		.map((v) => v.slice("cobblemon:".length)),
);

/** Ajusta os blocos gerados: minecraft:flammable exatamente nos blocos do setFlammable e atrito do Never-Melt Ice. */
export function patchBlocks(): void {
	let flammable = 0;
	for (const file of walk(`${OUT_BP}/blocks`, (n) => n.endsWith(".json"))) {
		const j = tryReadJson(file);
		const b = j?.["minecraft:block"];
		const id: string | undefined = b?.description?.identifier;
		if (!id?.startsWith("cobblemon:")) continue;
		const name = id.slice("cobblemon:".length);
		let changed = false;
		const fl = FLAMMABLE_BLOCKS[name];
		if (fl) {
			b.components["minecraft:flammable"] = { catch_chance_modifier: fl[0], destroy_chance_modifier: fl[1] };
			changed = true;
			flammable++;
		} else if (b.components?.["minecraft:flammable"]) {
			delete b.components["minecraft:flammable"];
			changed = true;
		}
		// Tag dripstone_growable (PointedDripstoneBlockMixin): o minério faz o espeleotema crescer (scripts/custom_components).
		if (DRIPSTONE_GROWABLE.has(name)) {
			b.components["cobblemon:dripstone_growable"] = {};
			changed = true;
		}
		// Atril do Cobblemon: EMIT_LIGHT (luz 13 enquanto alguém vê a Pokédex; LecternBlockEntity.hasViewer).
		if (name === "lectern") {
			b.description.states = { ...(b.description.states ?? {}), "cobblemon:emit_light": [false, true] };
			b.permutations = [...(b.permutations ?? []), { condition: "q.block_state('cobblemon:emit_light')", components: { "minecraft:light_emission": 13 } }];
			changed = true;
		}
		const slip = SLIPPERY_BLOCKS[name];
		if (slip !== undefined) {
			b.components["minecraft:friction"] = r4(1 - slip);
			changed = true;
		}
		if (changed) writeJson(file, j);
	}
	count("blocos inflamáveis", flammable);
}

// ---------------------------------------------------------------------------------------------
// Espécies: luz, comportamentos

export interface LightOut {
	level: number;
	/** LAND, UNDERWATER ou BOTH (LiquidGlowMode). */
	mode: string;
}

function lightOf(d: any): LightOut | undefined {
	const l = d?.lightingData;
	if (!l || typeof l.lightLevel !== "number") return undefined;
	return { level: Math.max(0, Math.min(15, Math.round(l.lightLevel))), mode: String(l.liquidGlowMode ?? "LAND").toUpperCase() };
}

/** Behaviours aplicados pela espécie (`ai` → apply_behaviours) — o 1.8.2 só usa isso em espécies base. */
function behavioursOf(d: any): string[] {
	const out: string[] = [];
	for (const a of d?.ai ?? []) if (a?.type === "apply_behaviours") for (const b of a.behaviours ?? []) out.push(String(b));
	return out;
}

export interface SpeciesBehaviourOut {
	fox: boolean;
	bee: boolean;
	picksUpItems: boolean;
	getsMadAtThrower: boolean;
}

export function speciesBehaviours(data: any): SpeciesBehaviourOut {
	const b = behavioursOf(data);
	return {
		fox: b.includes("cobblemon:pokemon_fox"),
		bee: b.includes("cobblemon:pokemon_bee"),
		picksUpItems: b.includes("cobblemon:pokemon_fox") || b.includes("cobblemon:pokemon_picks_up_items"),
		getsMadAtThrower: b.includes("cobblemon:pokemon_gets_mad_at_thrower"),
	};
}

// ---------------------------------------------------------------------------------------------
// Estante de discos: discos visíveis (DiscShelfBlockEntityRenderer)

export const DISC_SHELF_DISPLAY = "cobblemon:disc_shelf_display";
export const DISC_SHELF_SLOTS = 14;

/**
 * Entidade de exibição da estante: 14 quadros de 6×2 px na face da frente (posições do renderer do Java: duas
 * colunas, 7 linhas, margens de 1 px), cada um com a textura `textures/block/disc_shelf/<item>.png` escolhida pela
 * propriedade `cobblemon:slot_<i>` (0 = vazio). Um render controller por espaço. Devolve os nomes das texturas
 * (índice 1..n).
 */
export function emitDiscShelfDisplay(): string[] {
	const dir = `${ASSETS}/textures/block/disc_shelf`;
	if (!existsSync(dir)) return [];
	const names = walk(dir, (n) => n.endsWith(".png")).map((f) => f.split("/").pop()!.replace(/\.png$/, "")).sort();
	for (const n of names) copyFile(`${dir}/${n}.png`, `${OUT_RP}/textures/block/disc_shelf/${n}.png`);
	const bones: Array<Record<string, unknown>> = [];
	for (let i = 0; i < DISC_SHELF_SLOTS; i++) {
		const row = Math.floor(i / 2);
		const col = i % 2;
		// Modelo virado para o norte (a entidade é girada para a frente da estante): coluna 0 = lado leste.
		const x0 = col === 0 ? 1 : -7;
		const y0 = 1 + (6 - row) * 2;
		bones.push({ name: `slot_${i}`, pivot: [0, 0, 0], cubes: [{ origin: [x0, y0, -8.02], size: [6, 2, 0], uv: { north: { uv: [0, 0], uv_size: [6, 2] } } }] });
	}
	writeJson(`${OUT_RP}/models/entity/disc_shelf_display.geo.json`, {
		format_version: "1.16.0",
		"minecraft:geometry": [{ description: { identifier: "geometry.cobblemon.disc_shelf_display", texture_width: 16, texture_height: 16, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0, 0.5, 0] }, bones }],
	});
	const textures: Record<string, string> = { none: "textures/blank" };
	names.forEach((n, i) => { textures[`d${i + 1}`] = `textures/block/disc_shelf/${n}`; });
	const texArray = ["Texture.none", ...names.map((_, i) => `Texture.d${i + 1}`)];
	const rcs: Record<string, unknown> = {};
	const rcList: Array<Record<string, string>> = [];
	for (let i = 0; i < DISC_SHELF_SLOTS; i++) {
		const id = `controller.render.cobblemon.disc_shelf.slot${i}`;
		rcs[id] = {
			arrays: { textures: { "Array.discs": texArray } },
			geometry: "Geometry.default",
			materials: [{ "*": "Material.default" }],
			textures: [`Array.discs[q.property('cobblemon:slot_${i}')]`],
			part_visibility: [{ "*": false }, { [`slot_${i}`]: true }],
		};
		rcList.push({ [id]: `q.property('cobblemon:slot_${i}') > 0` });
	}
	writeJson(`${OUT_RP}/render_controllers/disc_shelf_display.render_controllers.json`, { format_version: "1.10.0", render_controllers: rcs });
	writeJson(`${OUT_RP}/entity/display/disc_shelf_display.entity.json`, {
		format_version: "1.10.0",
		"minecraft:client_entity": {
			description: {
				identifier: DISC_SHELF_DISPLAY,
				materials: { default: "entity_alphatest" },
				textures,
				geometry: { default: "geometry.cobblemon.disc_shelf_display" },
				render_controllers: rcList,
			},
		},
	});
	const properties: Record<string, unknown> = {};
	for (let i = 0; i < DISC_SHELF_SLOTS; i++) properties[`cobblemon:slot_${i}`] = { type: "int", range: [0, names.length], default: 0, client_sync: true };
	writeJson(`${OUT_BP}/entities/display/disc_shelf_display.json`, {
		format_version: "1.21.90",
		"minecraft:entity": {
			description: { identifier: DISC_SHELF_DISPLAY, is_spawnable: false, is_summonable: true, properties },
			components: {
				"minecraft:type_family": { family: ["cobblemon_display", "inanimate"] },
				"minecraft:collision_box": { width: 0.1, height: 0.1 },
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
	count("texturas de disco da estante", names.length);
	return names;
}

// ---------------------------------------------------------------------------------------------
// Feto no tanque de restauração (RestorationTankRenderer)

export const FOSSIL_FETUS = "cobblemon:fossil_fetus";

interface FetusPoser {
	name: string;
	maxScale: number;
	yTranslation: number;
	yGrowthPoint: number;
	animations: string[];
	texture: string;
}

/** Renomeia os ossos com prefixo (e envolve os do topo num osso raiz com pivô no ponto de crescimento). */
function prefixedGeometry(geo: any, identifier: string, prefix: string, growthPx: number): any {
	const bones: any[] = (geo.bones ?? []).map((b: any) => ({ ...b, name: `${prefix}_${b.name}`, ...(b.parent ? { parent: `${prefix}_${b.parent}` } : { parent: `${prefix}_root` }) }));
	return { description: { ...geo.description, identifier, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 0.5, 0] }, bones: [{ name: `${prefix}_root`, pivot: [0, growthPx, 0] }, ...bones] };
}

function prefixedAnimation(anim: any, prefix: string): any {
	const bones: Record<string, unknown> = {};
	for (const [k, v] of Object.entries<any>(anim.bones ?? {})) bones[`${prefix}_${k}`] = v;
	return { ...anim, bones };
}

/**
 * Entidade `cobblemon:fossil_fetus`: os 3 embriões + o feto do fóssil (16 modelos de bedrock/fossils), cada um num
 * render controller, com a escala das curvas EMBRYO_CURVE_1..3/FOSSIL_CURVE sobre `cobblemon:progress` (0..1) em
 * volta do yGrowthPoint e a animação "sleep"/"gooping" do poser. Devolve os nomes dos fósseis (índice da propriedade
 * `cobblemon:fetus`; 0 = substitute) e o yTranslation de cada um.
 */
export function emitFossilFetus(): { names: string[]; yTranslation: Record<string, number> } {
	const base = `${ASSETS}/bedrock/fossils`;
	if (!existsSync(`${base}/posers`)) return { names: [], yTranslation: {} };
	const posers = new Map<string, FetusPoser>();
	for (const f of walk(`${base}/posers`, (n) => n.endsWith(".json"))) {
		const name = f.split("/").pop()!.replace(/\.json$/, "");
		const j = readJson(f);
		const variation = tryReadJson(`${base}/variations/${name}.json`)?.variations?.[0];
		const anims = Object.values<any>(j.poses ?? {}).flatMap((p) => (p.animations ?? []).map((a: string) => /q\.bedrock\('[^']+',\s*'([^']+)'\)/.exec(a)?.[1]).filter(Boolean));
		posers.set(name, { name, maxScale: Number(j.maxScale ?? 1), yTranslation: Number(j.yTranslation ?? 0), yGrowthPoint: Number(j.yGrowthPoint ?? 0), animations: anims, texture: String(variation?.texture ?? "") });
	}
	const embryos = ["embryo_stage1", "embryo_stage2", "embryo_stage3"];
	const fetuses = ["substitute_fetus", ...[...posers.keys()].filter((n) => n.endsWith("_fetus") && n !== "substitute_fetus").sort()];
	const geometries: Record<string, string> = {};
	const textures: Record<string, string> = {};
	const animations: Record<string, string> = {};
	const animate: Array<string | Record<string, string>> = [];
	const geoOut: any[] = [];
	const animOut: Record<string, unknown> = {};
	const texRef = (id: string) => {
		const { path } = splitId(id);
		const ref = path.replace(/\.png$/, "");
		if (existsSync(`${ASSETS}/${path}`)) copyFile(`${ASSETS}/${path}`, `${OUT_RP}/${ref}.png`);
		return ref;
	};
	const add = (name: string, prefix: string, key: string) => {
		const p = posers.get(name)!;
		const geo = tryReadJson(`${base}/models/${name}.geo.json`)?.["minecraft:geometry"]?.[0];
		if (!geo) return false;
		geoOut.push(prefixedGeometry(geo, `geometry.cobblemon.fetus.${name}`, prefix, p.yGrowthPoint * 16));
		geometries[key] = `geometry.cobblemon.fetus.${name}`;
		textures[key] = texRef(p.texture);
		const animFile = tryReadJson(`${base}/animations/${name}.animation.json`)?.animations ?? {};
		for (const a of p.animations) {
			const src = animFile[`animation.${name}.${a}`];
			if (!src) continue;
			const id = `animation.cobblemon.fetus.${name}.${a}`;
			animOut[id] = prefixedAnimation(src, prefix);
			animations[`${key}_${a}`] = id;
		}
		return true;
	};
	embryos.forEach((e, i) => add(e, `e${i + 1}`, `e${i + 1}`));
	const fetusKeys: string[] = [];
	fetuses.forEach((f, i) => { if (add(f, "f", `f${i}`)) fetusKeys.push(`f${i}`); });
	// Curvas do renderer: u = progresso × 2,5; parabolaFunction(pico, 1) rerange(min, max); FOSSIL_CURVE.
	const u = "(q.property('cobblemon:progress') * 2.5)";
	const parab = (peak: number, min: number, max: number) => `((${u} >= ${min} && ${u} <= ${max}) ? (-4 * ${peak} * math.pow((${u} - ${min}) / ${max - min} - 0.5, 2) + ${peak}) : 0)`;
	const curves = [parab(0.5, 0, 0.8), parab(0.9, 0.2, 1.2), parab(1, 0.6, 1.4), `(-0.4 * math.pow(${u} - 2.5, 2) + 1)`];
	const pre = [
		`v.cobblemon_s1 = ${curves[0]};`,
		`v.cobblemon_s2 = ${curves[1]};`,
		`v.cobblemon_s3 = ${curves[2]};`,
		`v.cobblemon_sf = ${curves[3]};`,
		// timeRemaining == 0: tamanho máximo.
		"v.cobblemon_done = q.property('cobblemon:progress') >= 1;",
	];
	const growthBones: Record<string, unknown> = {};
	embryos.forEach((e, i) => {
		const p = posers.get(e);
		if (!p) return;
		const s = `(v.cobblemon_s${i + 1} > 0 ? (v.cobblemon_done ? ${p.maxScale} : v.cobblemon_s${i + 1} * ${p.maxScale}) : 0)`;
		growthBones[`e${i + 1}_root`] = { scale: s, position: [0, -r4(p.yGrowthPoint * 16), 0] };
	});
	// Feto: escala e ponto de crescimento do feto ativo (Molang por índice).
	const fetusPer = (pick: (p: FetusPoser) => number) => {
		let expr = "0";
		for (let i = fetuses.length - 1; i >= 0; i--) {
			const p = posers.get(fetuses[i]);
			if (p) expr = `q.property('cobblemon:fetus') == ${i} ? ${pick(p)} : (${expr})`;
		}
		return expr;
	};
	growthBones["f_root"] = {
		scale: `(v.cobblemon_sf > 0 ? (v.cobblemon_done ? 1 : v.cobblemon_sf) * (${fetusPer((p) => p.maxScale)}) : 0)`,
		position: [0, `-(${fetusPer((p) => r4(p.yGrowthPoint * 16))})`, 0],
	};
	animOut["animation.cobblemon.fetus.growth"] = { loop: true, bones: growthBones };
	animations["growth"] = "animation.cobblemon.fetus.growth";
	animate.push("growth");
	for (const [k] of Object.entries(animations)) {
		if (k === "growth") continue;
		const m = /^(e\d|f(\d+))_/.exec(k);
		if (!m) continue;
		if (m[2] !== undefined) animate.push({ [k]: `q.property('cobblemon:fetus') == ${m[2]}` });
		else animate.push({ [k]: `v.cobblemon_s${m[1].slice(1)} > 0 && !v.cobblemon_done` });
	}
	writeJson(`${OUT_RP}/models/entity/fossil_fetus.geo.json`, { format_version: "1.12.0", "minecraft:geometry": geoOut });
	writeJson(`${OUT_RP}/animations/fossil_fetus.animation.json`, { format_version: "1.8.0", animations: animOut });
	const rcs: Record<string, unknown> = {};
	const rcList: Array<Record<string, string>> = [];
	for (const k of ["e1", "e2", "e3"]) {
		if (!geometries[k]) continue;
		const id = `controller.render.cobblemon.fossil_fetus.${k}`;
		rcs[id] = { geometry: `Geometry.${k}`, materials: [{ "*": "Material.default" }], textures: [`Texture.${k}`] };
		rcList.push({ [id]: `v.cobblemon_s${k.slice(1)} > 0 && !v.cobblemon_done` });
	}
	rcs["controller.render.cobblemon.fossil_fetus.fetus"] = {
		arrays: { geometries: { "Array.geo": fetusKeys.map((k) => `Geometry.${k}`) }, textures: { "Array.tex": fetusKeys.map((k) => `Texture.${k}`) } },
		geometry: "Array.geo[q.property('cobblemon:fetus')]",
		materials: [{ "*": "Material.default" }],
		textures: ["Array.tex[q.property('cobblemon:fetus')]"],
	};
	rcList.push({ "controller.render.cobblemon.fossil_fetus.fetus": "v.cobblemon_sf > 0 || v.cobblemon_done" });
	writeJson(`${OUT_RP}/render_controllers/fossil_fetus.render_controllers.json`, { format_version: "1.10.0", render_controllers: rcs });
	writeJson(`${OUT_RP}/entity/display/fossil_fetus.entity.json`, {
		format_version: "1.10.0",
		"minecraft:client_entity": {
			description: {
				identifier: FOSSIL_FETUS,
				materials: { default: "entity_alphatest" },
				textures,
				geometry: geometries,
				animations,
				scripts: { pre_animation: pre, animate },
				render_controllers: rcList,
			},
		},
	});
	writeJson(`${OUT_BP}/entities/display/fossil_fetus.json`, {
		format_version: "1.21.90",
		"minecraft:entity": {
			description: {
				identifier: FOSSIL_FETUS,
				is_spawnable: false,
				is_summonable: true,
				properties: {
					"cobblemon:fetus": { type: "int", range: [0, Math.max(1, fetuses.length - 1)], default: 0, client_sync: true },
					// Faixa com limites não inteiros: o JSON escreveria [0, 1] e o Bedrock exige floats.
					"cobblemon:progress": { type: "float", range: [-0.001, 1.001], default: "0.0", client_sync: true },
				},
			},
			components: {
				"minecraft:type_family": { family: ["cobblemon_display", "inanimate"] },
				"minecraft:collision_box": { width: 0.1, height: 0.1 },
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
	count("fetos de fóssil", fetusKeys.length);
	const yTranslation: Record<string, number> = {};
	fetuses.forEach((f) => { yTranslation[f.replace(/_fetus$/, "")] = posers.get(f)?.yTranslation ?? 0; });
	return { names: fetuses.map((f) => f.replace(/_fetus$/, "")), yTranslation };
}

// ---------------------------------------------------------------------------------------------
// Tags de comida vanilla (data/minecraft/tags/item do Cobblemon): fox_food, chicken_food, parrot_food, horse_food

/** Membros de uma tag vanilla que o Cobblemon estende (resolvendo tags do Cobblemon aninhadas). */
function vanillaTagMembers(tag: string): string[] {
	const file = `${DATA}/minecraft/tags/item/${tag}.json`;
	if (!existsSync(file)) return [];
	const out: string[] = [];
	const visit = (id: string) => {
		if (!id.startsWith("#")) { out.push(id); return; }
		const { ns, path } = splitId(id.slice(1));
		const f = `${DATA}/${ns}/tags/item/${path}.json`;
		if (!existsSync(f)) return;
		for (const v of readJson(f).values ?? []) visit(typeof v === "string" ? v : v?.id);
	};
	for (const v of readJson(file).values ?? []) visit(typeof v === "string" ? v : v?.id);
	return [...new Set(out)].filter((id) => id.startsWith("cobblemon:"));
}

/** Percorre o JSON e devolve [caminho, lista] de toda lista que contém `marker` (string ou { item: marker }). */
function listsWith(node: any, marker: string, path: string[] = []): Array<[string[], any[]]> {
	const out: Array<[string[], any[]]> = [];
	if (Array.isArray(node)) {
		if (node.some((v) => v === marker || v === `minecraft:${marker}` || v?.item === marker || v?.item === `minecraft:${marker}`)) out.push([path, node]);
		return out;
	}
	if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) out.push(...listsWith(v, marker, [...path, k]));
	return out;
}

/**
 * Animais vanilla que aceitam os itens do Cobblemon pelas tags de comida do Java:
 * - chicken_food / parrot_food (sementes de vivichoke e de mint): reproduzir/crescer/atrair galinha, domar papagaio;
 * - horse_food (maçãs do Cobblemon): curar, domar e crescer cavalo, burro e mula como a maçã vanilla;
 * - fox_food (berries): reproduzir/crescer/atrair raposa (fragmento mesclado ao override escrito à mão do fox.json).
 * Os overrides completos saem da cópia v1.26.50.4 do bedrock-samples em tools/importer/data/vanilla_entities.
 */
export function emitVanillaFoodTags(): void {
	const handFoxFile = `${HAND_BP}/entities/vanilla_overrides/fox.json`;
	const handFox = existsSync(handFoxFile) ? parseLenient(readFileSync(handFoxFile, "utf8")) : undefined;
	const dataDir = join(ROOT, "tools", "importer", "data", "vanilla_entities");
	const seeds = [...new Set([...vanillaTagMembers("chicken_food"), ...vanillaTagMembers("parrot_food")])];
	const apples = vanillaTagMembers("horse_food");
	const berries = vanillaTagMembers("fox_food");
	for (const name of ["chicken", "parrot", "horse", "donkey", "mule"]) {
		const file = `${dataDir}/${name}.json`;
		if (!existsSync(file)) {
			warn("cópia vanilla ausente (tags de comida)", name);
			continue;
		}
		const j = parseLenient(readFileSync(file, "utf8"));
		if (name === "chicken" || name === "parrot") {
			for (const [, list] of listsWith(j, "wheat_seeds")) list.push(...seeds.filter((s) => !list.includes(s)));
		} else {
			// Mesmos valores da maçã vanilla (cura 3, temperamento +3, crescimento).
			for (const [, list] of listsWith(j, "apple")) {
				const apple = list.find((v) => v?.item === "apple" || v?.item === "minecraft:apple");
				if (apple && typeof apple === "object") for (const a of apples) if (!list.some((v) => v?.item === a)) list.push({ ...apple, item: a });
			}
		}
		writeJson(`${OUT_BP}/entities/vanilla_overrides/${name}.json`, j);
	}
	// Raposa: o override é escrito à mão (behavior_packs/.../vanilla_overrides/fox.json, com comentários que o build
	// não mescla); as berries (fox_food) ficam listadas lá. Aqui só confere que continuam presentes.
	if (handFox && !listsWith(handFox, "sweet_berries").every(([, list]) => berries.every((b) => list.includes(b)))) warn("fox.json escrito à mão sem as berries do Cobblemon (fox_food)", "fox");
	count("animais vanilla com comida do Cobblemon", 6);
}

// ---------------------------------------------------------------------------------------------
// Módulo para os scripts

export interface MundoDetalhesInput {
	speciesData: Map<string, any>;
	included: Set<string>;
	wearables: WearableOut[];
	compostBlockItems: Record<string, number>;
	fortune: Record<string, FortuneEntry[]>;
	discTextures: string[];
	fetus: { names: string[]; yTranslation: Record<string, number> };
}

export function emitMundoDetalhesModule(input: MundoDetalhesInput): void {
	const lighting: Record<string, { species?: LightOut; forms?: Record<string, LightOut> }> = {};
	const fox: string[] = [];
	const bee: string[] = [];
	const pickup: string[] = [];
	const mad: string[] = [];
	for (const id of [...input.included].sort()) {
		const d = input.speciesData.get(id);
		if (!d) continue;
		const own = lightOf(d);
		const forms: Record<string, LightOut> = {};
		for (const f of d.forms ?? []) {
			const l = lightOf(f);
			if (l && f?.name) forms[String(f.name).toLowerCase()] = l;
		}
		if (own || Object.keys(forms).length) lighting[id] = { ...(own ? { species: own } : {}), ...(Object.keys(forms).length ? { forms } : {}) };
		const b = speciesBehaviours(d);
		if (b.fox) fox.push(id);
		if (b.bee) bee.push(id);
		if (b.picksUpItems) pickup.push(id);
		if (b.getsMadAtThrower) mad.push(id);
	}
	// behaviour.lightningHit.rotateFeatures (Mooshtank): espécie → [{ key, chain }].
	const lightningRotate: Record<string, Array<{ key: string; chain: string[] }>> = {};
	for (const id of input.included) {
		const d = input.speciesData.get(id);
		const rot = [d?.behaviour?.lightningHit?.rotateFeatures, ...(d?.forms ?? []).map((f: any) => f?.behaviour?.lightningHit?.rotateFeatures)].find((r) => Array.isArray(r) && r.length);
		if (rot) lightningRotate[id] = rot.map((r: any) => ({ key: String(r.key), chain: (r.chain ?? []).map(String) }));
	}
	const freezeImmune = [...input.included].filter((id) => {
		const d = input.speciesData.get(id);
		return d?.behaviour?.freezeImmune === true || (d?.forms ?? []).some((f: any) => f?.behaviour?.freezeImmune === true);
	}).sort();
	const flags: Record<string, string> = {};
	for (const [id, f] of [...HELD_FLAGS].sort(([a], [b]) => a.localeCompare(b))) flags[id] = f.join("");
	const hidden = visibilityTag("hidden");
	const j = (v: unknown) => JSON.stringify(v);
	writeText(
		`${OUT_SCRIPTS}/mundoDetalhes.ts`,
		`// Arquivo gerado por tools/importer (npm run import, frente mundo-detalhes). Não edite à mão.
/* eslint-disable */

/** lightingData (LightingData.kt): nível de luz e LiquidGlowMode por espécie e por forma (nome em minúsculas). */
export const LIGHTING: Record<string, { species?: { level: number; mode: string }; forms?: Record<string, { level: number; mode: string }> }> = ${j(lighting)};

/** Locators de item por variante de cada espécie: dígito = bits (1 item, 2 item_hat, 4 item_face). */
export const HELD_ITEM_LOCATORS: Record<string, string> = ${j(flags)};

/** Vestíveis (WearableItem) e a tag de visibilidade held/visibility (hat/face). */
export const WEARABLES: Record<string, "hat" | "face" | "item"> = ${j(Object.fromEntries(input.wearables.map((w) => [w.id, w.kind])))};

/** Tag held/visibility/hat e face completas (inclui banners e itens que não são vestíveis). */
export const VISIBILITY_HAT: string[] = ${j(visibilityTag("hat"))};
export const VISIBILITY_FACE: string[] = ${j(visibilityTag("face"))};

/** Tag held/visibility/hidden: itens que nunca aparecem no modelo. */
export const HIDDEN_HELD_ITEMS: string[] = ${j(hidden)};

/** Itens de bloco (sem JSON próprio) compostáveis: chance de subir o nível (0..1). */
export const COMPOST_BLOCK_ITEMS: Record<string, number> = ${j(input.compostBlockItems)};

/** Bônus de Fortuna (apply_bonus) por bloco. */
export const FORTUNE: Record<string, Array<{ item: string; formula: string; min: number; max: number; bonusMultiplier?: number; extra?: number; probability?: number; limitMax?: number; states?: Record<string, string | number> }>> = ${j(input.fortune)};

/** behaviour.lightningHit.rotateFeatures: feature (aspect "<key>-<valor>") que gira a cada raio (Mooshtank). */
export const LIGHTNING_ROTATE: Record<string, Array<{ key: string; chain: string[] }>> = ${j(lightningRotate)};

/** Espécies com behaviour.freezeImmune (além do tipo Gelo). */
export const FREEZE_IMMUNE_SPECIES: string[] = ${j(freezeImmune)};

/** Texturas de disco da estante (índice 1..n na propriedade cobblemon:slot_<i> da entidade de exibição). */
export const DISC_TEXTURES: string[] = ${j(input.discTextures)};

/** Fetos do tanque de restauração: nome do fóssil (índice da propriedade cobblemon:fetus; 0 = substitute) e yTranslation. */
export const FETUS_NAMES: string[] = ${j(input.fetus.names)};
export const FETUS_Y_TRANSLATION: Record<string, number> = ${j(input.fetus.yTranslation)};

/** Espécies com os behaviours pokemon_fox, pokemon_bee, pokemon_picks_up_items e pokemon_gets_mad_at_thrower. */
export const FOX_SPECIES: string[] = ${j(fox)};
export const BEE_SPECIES: string[] = ${j(bee)};
export const PICKUP_SPECIES: string[] = ${j(pickup)};
export const MAD_AT_THROWER_SPECIES: string[] = ${j(mad)};
`,
	);
	count("espécies com luz dinâmica", Object.keys(lighting).length);
}

/** Linhas de tradução extras (grupos do catálogo) acrescentadas ao fim das .lang geradas. */
export function appendCatalogLang(keys: Record<string, string>): void {
	for (const [bedrock, cobblemon] of [["en_US", "en_us"], ["pt_BR", "pt_br"]]) {
		const file = `${OUT_RP}/texts/${bedrock}.lang`;
		if (!existsSync(file)) continue;
		const src = tryReadJson(`${ASSETS}/lang/${cobblemon}.json`) ?? {};
		const en = tryReadJson(`${ASSETS}/lang/en_us.json`) ?? {};
		const lines = Object.entries(keys).map(([k, source]) => `${k}=${String(src[source] ?? en[source] ?? source).replace(/\n/g, " ")}`);
		writeText(file, `${readFileSync(file, "utf8").trimEnd()}\n${lines.join("\n")}\n`);
	}
}
