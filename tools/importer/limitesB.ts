// Frente "limites-b" (aproximações da pesquisa 8, docs/pesquisa/8-limites-bedrock.md):
//
//   - #146 Livro de receitas agrupado: o livro do Bedrock usa a lista do catálogo criativo. Os itens cujas receitas
//     Java têm o mesmo `group` (red_mints, basic_balls, gilded_chest...) viram subgrupos recolhíveis do catálogo,
//     logo depois do grupo da aba do Cobblemon (tab + grupo; grupos de 1 item ficam na aba).
//   - #30 Pinturas do Cobblemon (data/cobblemon/painting_variant + tag minecraft:painting_variant/placeable): entidade
//     `cobblemon:painting` (BP), client entity, geometria por variante e eixo, render controller e texturas.
//   - #99/#113 Enfermeira (CobblemonVillagerProfessions/CobblemonTradeOffers): tabela de trocas do Bedrock gerada das
//     ofertas Kotlin, texturas de profissão (nurse, nurse_joy) e nomes da Enfermeira Joy.
//   - #136 Fazendeiro: tag data/minecraft/tags/item/villager_plantable_seeds.json.
//   → generated/scripts/limitesB.ts (variantes de pintura, sementes, nomes da Joy, grupos de receita).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadKotlinItems } from "./kotlin.ts";
import { ASSETS, DATA, OUT_BP, OUT_RP, OUT_SCRIPTS, copyFile, count, readJson, tryReadJson, walk, warn, writeJson, writeText } from "./util.ts";

const KOTLIN = join(ASSETS, "..", "..", "..", "kotlin", "com", "cobblemon", "mod", "common");
const CATALOG = () => `${OUT_BP}/item_catalog/crafting_item_catalog.json`;

// ---------------------------------------------------------------------------------------------
// #146: grupos de receita no catálogo

/** group do Java → ids dos resultados (com namespace), na ordem dos arquivos. */
export function javaRecipeGroups(recipeDir = join(DATA, "cobblemon", "recipe")): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const file of walk(recipeDir, (n) => n.endsWith(".json"))) {
		const j = tryReadJson(file);
		const group = typeof j?.group === "string" ? j.group : undefined;
		const r = j?.result;
		const id = typeof r === "string" ? r : r?.id ?? r?.item;
		if (!group || typeof id !== "string") continue;
		const list = out.get(group) ?? [];
		if (!list.includes(id)) list.push(id);
		out.set(group, list);
	}
	return out;
}

/**
 * Escolhe um grupo por item: o de mais itens distintos (desempate: nome). Ex.: a fire_stone está em `fire_stone`
 * (receitas repetidas, 1 item) e em `evolution_stone_from_block` (10 itens) → fica no segundo.
 */
export function groupOfItem(groups: Map<string, string[]>): Map<string, string> {
	const byItem = new Map<string, string[]>();
	for (const [g, ids] of groups) for (const id of ids) byItem.set(id, [...(byItem.get(id) ?? []), g]);
	const out = new Map<string, string>();
	for (const [id, gs] of byItem) {
		gs.sort((a, b) => (groups.get(b)!.length - groups.get(a)!.length) || (a < b ? -1 : a > b ? 1 : 0));
		out.set(id, gs[0]);
	}
	return out;
}

interface CatalogGroup { group_identifier?: { icon: string; name: string }; items: string[] }
interface Catalog { format_version: string; "minecraft:crafting_items_catalog": { categories: Array<{ category_name: string; groups: CatalogGroup[] }> } }

export const RECIPE_GROUP_PREFIX = "cobblemon:recipe_group.";

/**
 * Divide cada grupo de aba do Cobblemon: os itens de um mesmo `group` Java (≥ 2 itens na mesma aba) saem para um
 * subgrupo `cobblemon:recipe_group.<group>` logo depois da aba, na ordem do primeiro item. Nada é criado nem perdido:
 * cada item continua no catálogo uma única vez.
 */
export function regroupCatalog(catalog: Catalog, itemGroup: Map<string, string>): { catalog: Catalog; groups: string[] } {
	const names: string[] = [];
	for (const category of catalog["minecraft:crafting_items_catalog"].categories) {
		const groups: CatalogGroup[] = [];
		for (const g of category.groups) {
			if (!g.group_identifier?.name.startsWith("cobblemon:itemGroup.")) { groups.push(g); continue; }
			const buckets = new Map<string, string[]>();
			for (const id of g.items) {
				const rg = itemGroup.get(id);
				if (rg) buckets.set(rg, [...(buckets.get(rg) ?? []), id]);
			}
			const split = new Set([...buckets].filter(([, ids]) => ids.length >= 2).map(([rg]) => rg));
			const keep = g.items.filter((id) => !split.has(itemGroup.get(id) ?? ""));
			if (keep.length) groups.push({ group_identifier: { icon: keep.includes(g.group_identifier.icon) ? g.group_identifier.icon : keep[0], name: g.group_identifier.name }, items: keep });
			const done = new Set<string>();
			for (const id of g.items) {
				const rg = itemGroup.get(id);
				if (!rg || !split.has(rg) || done.has(rg)) continue;
				done.add(rg);
				const ids = buckets.get(rg)!;
				const name = `${RECIPE_GROUP_PREFIX}${rg}`;
				names.push(name);
				groups.push({ group_identifier: { icon: ids[0], name }, items: ids });
			}
		}
		category.groups = groups;
	}
	return { catalog, groups: names };
}

function emitRecipeGroups(): string[] {
	const file = CATALOG();
	if (!existsSync(file)) return [];
	const { catalog, groups } = regroupCatalog(readJson(file) as Catalog, groupOfItem(javaRecipeGroups()));
	writeJson(file, catalog);
	// Blocos levam a mesma categoria/grupo do catálogo no menu_category (sem isso o Bedrock avisa que o catálogo
	// mudou o grupo definido no bloco); itens do catálogo não têm menu_category.
	const groupOf = new Map<string, string>();
	for (const c of catalog["minecraft:crafting_items_catalog"].categories) for (const g of c.groups) {
		if (g.group_identifier?.name.startsWith(RECIPE_GROUP_PREFIX)) for (const id of g.items) groupOf.set(id, g.group_identifier.name);
	}
	let patched = 0;
	for (const f of walk(`${OUT_BP}/blocks`, (n) => n.endsWith(".json"))) {
		const j = tryReadJson(f);
		const d = j?.["minecraft:block"]?.description;
		const group = d && groupOf.get(d.identifier);
		if (!group || !d.menu_category?.group || d.menu_category.group === group) continue;
		d.menu_category.group = group;
		writeJson(f, j);
		patched++;
	}
	count("grupos de receita no catálogo (limites-b)", groups.length);
	count("blocos com o grupo de receita no menu_category (limites-b)", patched);
	return groups;
}

// ---------------------------------------------------------------------------------------------
// #30: pinturas

export interface PaintingOut { id: string; name: string; width: number; height: number }

/** Variantes do Cobblemon na ordem da tag placeable (a mesma do sorteio do Java). */
export function loadPaintings(): PaintingOut[] {
	const tag = tryReadJson(join(DATA, "minecraft", "tags", "painting_variant", "placeable.json"))?.values ?? [];
	const out: PaintingOut[] = [];
	for (const id of tag as string[]) {
		if (!id.startsWith("cobblemon:")) continue;
		const name = id.slice(10);
		const j = tryReadJson(join(DATA, "cobblemon", "painting_variant", `${name}.json`));
		if (!j) { warn("pintura sem painting_variant", id); continue; }
		out.push({ id, name, width: j.width, height: j.height });
	}
	return out;
}

const PAINTING_TEX = "textures/entity/cobblemon_painting";

/** Geometria de uma variante num eixo: placa de 1 px, imagem nas duas faces largas (a de trás fica na parede). */
export function paintingGeometry(p: PaintingOut, axis: "ns" | "ew") {
	const w = p.width * 16;
	const h = p.height * 16;
	const full = { uv: [0, 0], uv_size: [w, h] };
	const edgeV = { uv: [0, 0], uv_size: [1, h] };
	const edgeH = { uv: [0, 0], uv_size: [w, 1] };
	const cube = axis === "ns"
		? { origin: [-w / 2, 0, -0.5], size: [w, h, 1], uv: { north: full, south: full, east: edgeV, west: edgeV, up: edgeH, down: edgeH } }
		: { origin: [-0.5, 0, -w / 2], size: [1, h, w], uv: { east: full, west: full, north: edgeV, south: edgeV, up: edgeH, down: edgeH } };
	return {
		description: {
			identifier: `geometry.cobblemon.painting.${p.name}_${axis}`,
			texture_width: w, texture_height: h,
			visible_bounds_width: Math.max(p.width, p.height) + 1, visible_bounds_height: p.height + 1, visible_bounds_offset: [0, p.height / 2, 0],
		},
		bones: [{ name: "painting", pivot: [0, 0, 0], cubes: [cube] }],
	};
}

/**
 * Caixas de acerto (custom_hit_test) por variante e eixo: uma por coluna de bloco, centradas na parede. O pivô é o
 * centro da caixa; a caixa não gira com a entidade (a pintura fica sempre em yaw 0 e o eixo escolhe o grupo).
 */
export function paintingHitboxes(p: PaintingOut, axis: "ns" | "ew") {
	const out: Array<{ pivot: number[]; width: number; height: number }> = [];
	for (let i = 0; i < p.width; i++) {
		const along = i - (p.width - 1) / 2;
		out.push({ pivot: axis === "ns" ? [along, p.height / 2, 0] : [0, p.height / 2, along], width: 1, height: p.height });
	}
	return out;
}

function emitPaintings(): PaintingOut[] {
	const paintings = loadPaintings();
	if (!paintings.length) return paintings;
	for (const p of paintings) {
		const png = join(ASSETS, "textures", "painting", `${p.name}.png`);
		if (existsSync(png)) copyFile(png, `${OUT_RP}/${PAINTING_TEX}/${p.name}.png`);
		else warn("textura de pintura ausente", p.id);
	}
	writeJson(`${OUT_RP}/models/entity/limites_b/cobblemon_painting.geo.json`, {
		format_version: "1.12.0",
		"minecraft:geometry": paintings.flatMap((p) => [paintingGeometry(p, "ns"), paintingGeometry(p, "ew")]),
	});
	const geometry: Record<string, string> = {};
	const textures: Record<string, string> = {};
	for (const p of paintings) {
		geometry[`${p.name}_ns`] = `geometry.cobblemon.painting.${p.name}_ns`;
		geometry[`${p.name}_ew`] = `geometry.cobblemon.painting.${p.name}_ew`;
		textures[p.name] = `${PAINTING_TEX}/${p.name}`;
	}
	writeJson(`${OUT_RP}/entity/display/cobblemon_painting.entity.json`, {
		format_version: "1.10.0",
		"minecraft:client_entity": {
			description: {
				identifier: "cobblemon:painting",
				materials: { default: "entity_alphatest" },
				textures, geometry,
				render_controllers: ["controller.render.cobblemon_painting"],
			},
		},
	});
	writeJson(`${OUT_RP}/render_controllers/limites_b/cobblemon_painting.render_controllers.json`, {
		format_version: "1.8.0",
		render_controllers: {
			"controller.render.cobblemon_painting": {
				arrays: {
					geometries: { "Array.geos": paintings.flatMap((p) => [`Geometry.${p.name}_ns`, `Geometry.${p.name}_ew`]) },
					textures: { "Array.skins": paintings.map((p) => `Texture.${p.name}`) },
				},
				geometry: "Array.geos[q.property('cobblemon:variant') * 2 + q.property('cobblemon:axis')]",
				materials: [{ "*": "Material.default" }],
				textures: ["Array.skins[q.property('cobblemon:variant')]"],
			},
		},
	});
	const groups: Record<string, unknown> = {};
	const events: Record<string, unknown> = {};
	paintings.forEach((p, v) => {
		for (const [a, axis] of (["ns", "ew"] as const).entries()) {
			const name = `cobblemon:painting_${p.name}_${axis}`;
			groups[name] = { "minecraft:custom_hit_test": { hitboxes: paintingHitboxes(p, axis) } };
			events[name] = {
				add: { component_groups: [name] },
				set_property: { "cobblemon:variant": v, "cobblemon:axis": a },
			};
		}
	});
	writeJson(`${OUT_BP}/entities/display/cobblemon_painting.json`, {
		format_version: "1.21.90",
		"minecraft:entity": {
			description: {
				identifier: "cobblemon:painting",
				is_spawnable: false,
				is_summonable: true,
				properties: {
					"cobblemon:variant": { type: "int", range: [0, paintings.length - 1], default: 0, client_sync: true },
					"cobblemon:axis": { type: "int", range: [0, 1], default: 0, client_sync: true },
				},
			},
			component_groups: groups,
			components: {
				"minecraft:type_family": { family: ["cobblemon_painting", "inanimate"] },
				"minecraft:collision_box": { width: 0.25, height: 0.25 },
				"minecraft:physics": { has_gravity: false, has_collision: false },
				"minecraft:pushable": { is_pushable: false, is_pushable_by_piston: false },
				"minecraft:knockback_resistance": { value: 1 },
				"minecraft:fire_immune": true,
				"minecraft:breathable": { breathes_air: true, breathes_water: true, suffocate_time: 0, total_supply: 15 },
				// Só golpe, projétil e explosão chegam ao script (HangingEntity.hurt quebra a pintura); o resto é ignorado.
				"minecraft:damage_sensor": {
					triggers: [
						{ cause: "entity_attack", deals_damage: "yes" },
						{ cause: "projectile", deals_damage: "yes" },
						{ cause: "entity_explosion", deals_damage: "yes" },
						{ cause: "block_explosion", deals_damage: "yes" },
						{ cause: "all", deals_damage: "no" },
					],
				},
				"minecraft:health": { value: 1, max: 1 },
				"minecraft:persistent": {},
			},
			events,
		},
	});
	count("pinturas do Cobblemon (limites-b)", paintings.length);
	return paintings;
}

// ---------------------------------------------------------------------------------------------
// #99/#113: Enfermeira

export interface NurseTrade { level: number; wants: Array<{ item: string; quantity: number }>; gives: { item: string; quantity: number }; maxUses: number; xp: number }

const KT_VANILLA = (name: string) => `minecraft:${name.toLowerCase()}`;

/** Ofertas da Enfermeira em CobblemonTradeOffers.kt (ItemsForEmeralds e TradeOffer com custo opcional). */
export function parseNurseTrades(src: string, itemId: (constName: string) => string | undefined): NurseTrade[] {
	const start = src.indexOf("CobblemonVillagerProfessions.NURSE ->");
	const end = src.indexOf("VillagerProfession.FISHERMAN ->", start);
	if (start < 0 || end < 0) return [];
	const body = src.slice(start, end);
	const ref = (s: string) => {
		const m = /(CobblemonItems|Items)\.([A-Z0-9_]+)/.exec(s);
		if (!m) return undefined;
		return m[1] === "Items" ? KT_VANILLA(m[2]) : itemId(m[2]);
	};
	const out: NurseTrade[] = [];
	const levels = [...body.matchAll(/VillagerTradeOffer\(CobblemonVillagerProfessions\.NURSE,\s*(\d+),\s*listOf\(/g)];
	levels.forEach((lv, i) => {
		const level = Number(lv[1]);
		const chunk = body.slice(lv.index!, levels[i + 1]?.index ?? body.length);
		for (const line of chunk.split("\n")) {
			const ife = /ItemsForEmeralds\(([^,]+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/.exec(line);
			if (ife) {
				const item = ref(ife[1]);
				if (item) out.push({ level, wants: [{ item: "minecraft:emerald", quantity: Number(ife[2]) }], gives: { item, quantity: Number(ife[3]) }, maxUses: Number(ife[4]), xp: Number(ife[5]) });
				continue;
			}
			const to = /TradeOffer\(ItemCost\(([^,]+),\s*(\d+)\),\s*ItemStack\(([^,)]+)(?:,\s*(\d+))?\),\s*(\d+),\s*(\d+)(?:,\s*Optional\.of<ItemCost>\(ItemCost\(([^)]+)\)\))?/.exec(line);
			if (to) {
				const want = ref(to[1]);
				const give = ref(to[3]);
				const extra = to[7] ? ref(to[7]) : undefined;
				if (!want || !give) continue;
				out.push({
					level,
					wants: [{ item: want, quantity: Number(to[2]) }, ...(extra ? [{ item: extra, quantity: 1 }] : [])],
					gives: { item: give, quantity: to[4] ? Number(to[4]) : 1 },
					maxUses: Number(to[5]), xp: Number(to[6]),
				});
			}
		}
	});
	return out;
}

/** XP de cada nível do aldeão (VillagerData.NEXT_LEVEL_XP_THRESHOLDS: 0, 10, 70, 150, 250). */
export const VILLAGER_LEVEL_XP = [0, 10, 70, 150, 250];

/** Tabela economy_trades do Bedrock: 2 ofertas sorteadas por nível (VillagerTrades.addOffersFromItemListings(…, 2)). */
export function nurseTradeTable(trades: NurseTrade[]) {
	const tiers = [];
	for (let level = 1; level <= 5; level++) {
		const list = trades.filter((t) => t.level === level);
		if (!list.length) continue;
		tiers.push({
			total_exp_required: VILLAGER_LEVEL_XP[level - 1],
			groups: [{
				num_to_select: Math.min(2, list.length),
				trades: list.map((t) => ({
					// Só o primeiro custo sofre o multiplicador de preço (MerchantOffer.getCostA; o custo B é fixo).
					wants: t.wants.map((w, i) => (i === 0 ? { item: w.item, quantity: w.quantity, price_multiplier: 0.05 } : { item: w.item, quantity: w.quantity })),
					gives: [{ item: t.gives.item, quantity: t.gives.quantity }],
					trader_exp: t.xp,
					max_uses: t.maxUses,
					reward_exp: true,
				})),
			}],
		});
	}
	return { format_version: "1.18.10", tiers };
}

/** Nomes que trocam a textura para a Enfermeira Joy (CobblemonVillagerProfessions.getNameTagOverride). */
export function parseNurseJoyNames(src: string): string[] {
	const m = /NURSE\s*->\s*Pair\("nurse_joy",\s*arrayOf\(([^)]*)\)\)/.exec(src);
	return m ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\'/g, "'")) : [];
}

function emitNurse(): { trades: number; joy: string[] } {
	const tradesKt = join(KOTLIN, "CobblemonTradeOffers.kt");
	const profKt = join(KOTLIN, "CobblemonVillagerProfessions.kt");
	if (!existsSync(tradesKt) || !existsSync(profKt)) return { trades: 0, joy: [] };
	const items = new Map(loadKotlinItems().map((i) => [i.name, `cobblemon:${i.id}`]));
	const trades = parseNurseTrades(readFileSync(tradesKt, "utf8"), (n) => items.get(n));
	writeJson(`${OUT_BP}/trading/economy_trades/cobblemon_nurse_trades.json`, nurseTradeTable(trades));
	for (const [from, to] of [["nurse", "cobblemon_nurse"], ["nurse_joy", "cobblemon_nurse_joy"]]) {
		const png = join(ASSETS, "textures", "entity", "villager", "profession", `${from}.png`);
		if (existsSync(png)) copyFile(png, `${OUT_RP}/textures/entity/villager2/professions/${to}.png`);
		else warn("textura da enfermeira ausente", from);
	}
	count("trocas da enfermeira (limites-b)", trades.length);
	return { trades: trades.length, joy: parseNurseJoyNames(readFileSync(profKt, "utf8")) };
}

// ---------------------------------------------------------------------------------------------
// Saída

/** `content` = falso com --only-pokemon: só o módulo de scripts (sem catálogo, entidades e texturas). */
export function emitLimitesB(content = true): void {
	const recipeGroups = content ? emitRecipeGroups() : [];
	const paintings = content ? emitPaintings() : loadPaintings();
	const nurse = content ? emitNurse() : { trades: 0, joy: existsSync(join(KOTLIN, "CobblemonVillagerProfessions.kt")) ? parseNurseJoyNames(readFileSync(join(KOTLIN, "CobblemonVillagerProfessions.kt"), "utf8")) : [] };
	const seeds = (tryReadJson(join(DATA, "minecraft", "tags", "item", "villager_plantable_seeds.json"))?.values ?? []) as string[];
	writeText(`${OUT_SCRIPTS}/limitesB.ts`, [
		"// Arquivo gerado por tools/importer/limitesB.ts (npm run import). Não edite à mão.",
		"/* eslint-disable */",
		"",
		"/** Pinturas do Cobblemon (painting_variant), na ordem da tag placeable; o índice é a propriedade cobblemon:variant. */",
		`export const COBBLEMON_PAINTINGS: ReadonlyArray<{ id: string; name: string; width: number; height: number }> = ${JSON.stringify(paintings)};`,
		"",
		"/** Tag data/minecraft/tags/item/villager_plantable_seeds.json do Cobblemon (replace: false). */",
		`export const COBBLEMON_PLANTABLE_SEEDS: readonly string[] = ${JSON.stringify(seeds)};`,
		"",
		"/** Nomes que mostram a Enfermeira Joy (o nome do aldeão termina com um deles). */",
		`export const NURSE_JOY_NAMES: readonly string[] = ${JSON.stringify(nurse.joy)};`,
		"",
		"/** Subgrupos de receita criados no catálogo (cobblemon:recipe_group.<group do Java>). */",
		`export const RECIPE_GROUPS: readonly string[] = ${JSON.stringify(recipeGroups)};`,
		"",
	].join("\n"));
}
