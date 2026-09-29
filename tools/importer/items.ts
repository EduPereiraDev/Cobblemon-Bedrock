// Itens do Cobblemon (CobblemonItems.kt + modelos de item + tags + dados) → itens do Bedrock, atlas de
// ícones (item_texture.json) e o módulo de dados generated/scripts/items.ts para os scripts.
//
// Itens de bloco com modelo 3D usam o item automático do bloco (sem JSON); ícones 2D de blocos com o
// mesmo id usam minecraft:block_placer.replace_block_item. Uso em Pokémon (remédios, vitaminas, mints,
// doces, berries, pedras de evolução...) fica marcado pelo custom component "cobblemon:use_on_pokemon".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BlockOut } from "./blocks.ts";
import { itemIconTexture } from "./javaModels.ts";
import { loadKotlinItems, statPath } from "./kotlin.ts";
import type { KtItem } from "./kotlin.ts";
import { decodePng, encodePng, firstFrame } from "./png.ts";
import { compostChance } from "./mundoDetalhes.ts"; // frente mundo-detalhes
import { legacyBallGuiIcons, legacyBallIcons } from "./legacyBallIcons.ts";
import { ASSETS, DATA, OUT_BP, OUT_RP, OUT_SCRIPTS, copyFile, count, parseLenient, readJson, splitId, tryReadJson, walk, warn, writeJson, writeText } from "./util.ts";

export const ITEM_FORMAT = "1.21.90";

/** Entidades de projétil de poké ball existentes no BP escrito à mão (behavior_packs/.../entities/pokeballs). */
export function pokeballEntities(handBp: string): Set<string> {
	const out = new Set<string>();
	for (const f of walk(`${handBp}/entities/pokeballs`, (n) => n.endsWith(".json") && !n.endsWith("_dummy.json"))) {
		try {
			const id = parseLenient(readFileSync(f, "utf8"))?.["minecraft:entity"]?.description?.identifier;
			if (id) out.add(id);
		} catch {
			// Entidade inválida: ignora.
		}
	}
	return out;
}

export interface ItemComponentDef {
	items: string[];
	description: string;
}

export const ITEM_COMPONENTS = new Map<string, ItemComponentDef>();

function itemComponent(name: string, itemId: string, description: string): void {
	const def = ITEM_COMPONENTS.get(name) ?? { items: [], description };
	def.items.push(itemId);
	ITEM_COMPONENTS.set(name, def);
}

/** Tags de item do Cobblemon, resolvidas (incluindo tags aninhadas) por item. */
function loadItemTags(): Map<string, Set<string>> {
	const base = `${DATA}/cobblemon/tags/item/`;
	const tagFiles = new Map<string, string>();
	for (const f of walk(base, (n) => n.endsWith(".json"))) tagFiles.set(`cobblemon:${f.slice(base.length, -5)}`, f);
	const cache = new Map<string, string[]>();
	const resolve = (tag: string, stack: string[] = []): string[] => {
		if (cache.has(tag)) return cache.get(tag)!;
		const file = tagFiles.get(tag);
		if (!file || stack.includes(tag)) return [];
		const out = (readJson(file).values ?? []).flatMap((v: any) => {
			const id = typeof v === "string" ? v : v?.id;
			if (typeof id !== "string") return [];
			return id.startsWith("#") ? resolve(id.slice(1), [...stack, tag]) : [id];
		});
		cache.set(tag, out);
		return out;
	};
	const byItem = new Map<string, Set<string>>();
	for (const tag of tagFiles.keys()) {
		for (const id of resolve(tag)) {
			const set = byItem.get(id) ?? new Set<string>();
			set.add(bedrockTagName(tag));
			byItem.set(id, set);
		}
	}
	return byItem;
}

/**
 * Frente limites-a (#31): tags vanilla que o Cobblemon estende (data/minecraft/tags/item) e que o Bedrock também tem
 * como tag de item com o mesmo efeito. `bookshelf_books` = o que cabe na estante entalhada (a Pokédex, no Java).
 */
export const BEDROCK_VANILLA_ITEM_TAGS = ["bookshelf_books"] as const;

/** Tags `minecraft:*` do item a partir das tags vanilla do Cobblemon (`#cobblemon:x` resolvido pelas tags próprias). */
const vanillaTagCache = new Map<string, any>();
function readVanillaItemTag(tag: string): any {
	if (!vanillaTagCache.has(tag)) vanillaTagCache.set(tag, tryReadJson(`${DATA}/minecraft/tags/item/${tag}.json`));
	return vanillaTagCache.get(tag);
}

export function vanillaItemTagsFor(id: string, ownTags: ReadonlySet<string> | readonly string[], read: (tag: string) => any = readVanillaItemTag): string[] {
	const own = new Set(ownTags);
	const out: string[] = [];
	for (const tag of BEDROCK_VANILLA_ITEM_TAGS) {
		const values: unknown[] = read(tag)?.values ?? [];
		const hit = values.some((v: any) => {
			const ref = typeof v === "string" ? v : v?.id;
			if (typeof ref !== "string") return false;
			return ref.startsWith("#") ? own.has(bedrockTagName(ref.slice(1))) : ref === id;
		});
		if (hit) out.push(`minecraft:${tag}`);
	}
	return out;
}

/** "cobblemon:held/consumed_in_wild_battle" → "cobblemon:consumed_in_wild_battle" (compat); "/" → "_". */
export function bedrockTagName(tag: string): string {
	const { ns, path } = splitId(tag);
	const p = path.startsWith("held/") ? path.slice(5) : path;
	return `${ns}:${p.replace(/\//g, "_")}`;
}

/** Membros (ids Java) de uma tag de item do Cobblemon. */
export function cobblemonItemTagMembers(tag: string): string[] {
	const { ns, path } = splitId(tag);
	const file = `${DATA}/${ns}/tags/item/${path}.json`;
	if (!existsSync(file)) return [];
	return (readJson(file).values ?? []).flatMap((v: any) => {
		const id = typeof v === "string" ? v : v?.id;
		if (typeof id !== "string") return [];
		return id.startsWith("#") ? cobblemonItemTagMembers(id.slice(1)) : [id];
	});
}

const STATUS_NAMES: Record<string, string> = { POISON: "poison", POISON_BADLY: "poisonbadly", PARALYSIS: "paralysis", SLEEP: "sleep", FROZEN: "frozen", BURN: "burn", CONFUSE: "confusion", ATTRACT: "attract" };

function statuses(body: string): string[] {
	const out: string[] = [];
	if (/getPersistentStatuses/.test(body)) out.push("poison", "poisonbadly", "paralysis", "sleep", "frozen", "burn");
	for (const m of body.matchAll(/Statuses\.([A-Z_]+)/g)) {
		const s = STATUS_NAMES[m[1]];
		if (s && !out.includes(s)) out.push(s);
	}
	return out;
}

export interface ItemsResult {
	/** Ids (com namespace) de todos os itens existentes no Bedrock (custom + itens de bloco). */
	ids: Set<string>;
	/** Id do Java → id do Bedrock (normalmente igual). */
	javaToBedrock: Map<string, string>;
	/** Itens com JSON próprio (podem receber tags de item). */
	withJson: Set<string>;
	json: number;
	icons: number;
}

/** Itens de bloco sem JSON próprio que são compostáveis (id → chance 0..1); preenchido por buildItems. */
export const COMPOST_BLOCK_ITEMS: Record<string, number> = {};

export function buildItems(blocks: Map<string, BlockOut>, projectiles: Set<string>, registered: Set<string>): ItemsResult {
	const items = loadKotlinItems();
	const tags = loadItemTags();
	const lang = new Set(Object.keys(readJson(`${ASSETS}/lang/en_us.json`)));
	const potions = tryData("mechanics/potions.json");
	const remedies = tryData("mechanics/remedies.json")?.remedies ?? {};
	const berryMech = tryData("mechanics/berries.json") ?? {};
	const aprijuices = tryData("mechanics/aprijuices.json");
	const fossils = new Map<string, string[]>();
	for (const f of walk(`${DATA}/cobblemon/fossils`, (n) => n.endsWith(".json"))) {
		const j = readJson(f);
		for (const fossil of j.fossils ?? []) fossils.set(fossil, [...(fossils.get(fossil) ?? []), j.result]);
	}
	const heldTag = new Set(cobblemonItemTagMembers("cobblemon:held/is_held_item"));
	const evoTag = new Set(cobblemonItemTagMembers("cobblemon:evolution_items"));
	const iconData: Record<string, { textures: string }> = {};
	const scriptItems: Record<string, Record<string, unknown>> = {};
	const ids = new Set<string>();
	const javaToBedrock = new Map<string, string>();
	const withJson = new Set<string>();
	let json = 0;

	for (const it of items) {
		const id = `cobblemon:${it.id}`;
		javaToBedrock.set(id, id);
		const icon = itemIconTexture(it.id);
		const block = it.block ? blocks.get(it.block) : undefined;
		const data = classify(it, { potions, remedies, berryMech, aprijuices, fossils, heldTag, evoTag });
		const itemTags = [...(tags.get(id) ?? [])].sort();
		// Frente limites-a (#31): Pokédex na estante entalhada (data/minecraft/tags/item/bookshelf_books = #cobblemon:pokedex).
		itemTags.push(...vanillaItemTagsFor(id, itemTags));
		scriptItems[it.id] = data;

		// Frente mundo-detalhes: compostagem (registerCompostable), em porcentagem no Bedrock.
		const compost = compostChance(it);
		// Item de bloco 3D com o mesmo id: usa o item automático do bloco.
		if (block && block.placeBlock === id && block.hasOwnItem) {
			// Sem JSON próprio para receber minecraft:compostable: a composteira aceita pelo script.
			if (compost !== undefined) COMPOST_BLOCK_ITEMS[id] = compost;
			ids.add(id);
			continue;
		}
		if (it.block && !block) warn("item de bloco sem bloco gerado (vira item simples)", it.id);
		const components: Record<string, unknown> = {};
		const displayKey = lang.has(`item.cobblemon.${it.id}`) ? `item.cobblemon.${it.id}` : lang.has(`block.cobblemon.${it.id}`) ? `block.cobblemon.${it.id}` : `item.cobblemon.${it.id}`;
		components["minecraft:display_name"] = { value: displayKey };
		if (icon.texture) {
			const key = iconKey(it.id, icon.texture, iconData);
			if (key) components["minecraft:icon"] = key;
		}
		if (!components["minecraft:icon"]) warn("item sem ícone 2D", it.id);
		const stack = it.stack ?? (data.category === "poke_rod" || data.category === "pokedex" ? 1 : 64);
		components["minecraft:max_stack_size"] = stack;
		if (it.rarity && it.rarity !== "common") components["minecraft:rarity"] = it.rarity;
		if (itemTags.length) components["minecraft:tags"] = { tags: itemTags };
		if (block) {
			const placer: Record<string, unknown> = { block: block.placeBlock };
			if (block.placeBlock === id) placer.replace_block_item = true;
			if (block.cls === "ApricornBlock") placer.use_on = ["cobblemon:apricorn_leaves"];
			components["minecraft:block_placer"] = placer;
		}
		// Comida. Itens que o Kotlin come por código (finishUsingItem) recebem os valores equivalentes.
		const scriptedFood = SCRIPTED_FOOD[it.id.startsWith("aprijuice_") ? "aprijuice" : it.id];
		if (!it.food && scriptedFood) {
			components["minecraft:food"] = {
				nutrition: scriptedFood.nutrition,
				saturation_modifier: scriptedFood.saturation,
				...(scriptedFood.alwaysEdible ? { can_always_eat: true } : {}),
				...(scriptedFood.convertsTo ? { using_converts_to: scriptedFood.convertsTo } : {}),
			};
			components["minecraft:use_animation"] = scriptedFood.drink ? "drink" : "eat";
			components["minecraft:use_modifiers"] = { use_duration: scriptedFood.seconds, movement_modifier: 0.35 };
			if (scriptedFood.stack) components["minecraft:max_stack_size"] = scriptedFood.stack;
		}
		if (it.food) {
			const drink = /aprijuice|tea|milk|juice/.test(it.id);
			components["minecraft:food"] = {
				nutrition: it.food.nutrition,
				saturation_modifier: it.food.saturation,
				...(it.food.alwaysEdible ? { can_always_eat: true } : {}),
				...(it.food.convertsTo ? { using_converts_to: it.food.convertsTo } : {}),
			};
			components["minecraft:use_animation"] = drink ? "drink" : "eat";
			components["minecraft:use_modifiers"] = { use_duration: it.food.fast ? 0.8 : 1.6, movement_modifier: 0.35 };
		}
		// Poké balls: arremessáveis, com a entidade de projétil existente (ancient usam a da poké ball).
		if (data.category === "poke_ball") {
			const entity = projectiles.has(id) ? id : "cobblemon:poke_ball";
			if (entity !== id) warn("poké ball sem entidade de projétil própria (usa cobblemon:poke_ball)", it.id);
			data.projectile = entity;
			components["minecraft:throwable"] = { do_swing_animation: true, launch_power_scale: 1.0, max_launch_power: 1.0 };
			components["minecraft:projectile"] = { projectile_entity: entity };
		}
		if (data.category === "poke_rod") {
			components["minecraft:durability"] = { max_durability: it.durability ?? 256 };
			components["minecraft:hand_equipped"] = true;
			// Lure, Luck of the Sea e Unbreaking são lidos pela pesca (scripts/fishing).
			components["minecraft:enchantable"] = { slot: "fishing_rod", value: 1 };
		}
		if (it.id === "pokerod_smithing_template") {
			const t = (components["minecraft:tags"] ??= { tags: [] }) as { tags: string[] };
			t.tags.push("minecraft:transform_templates");
		}
		if (compost !== undefined) components["minecraft:compostable"] = { composting_chance: Math.max(1, Math.round(compost * 100)) };
		// Vestíveis (WearableHatItem/WearableBlockItem): vão no slot da cabeça. O Bedrock força pilha de 1 em slot de
		// armadura (no Java a pilha é 64). O modelo 3D é o attachable gerado por mundoDetalhes.ts.
		if (data.wearable) {
			components["minecraft:wearable"] = { slot: "slot.armor.head", protection: 0 };
			components["minecraft:max_stack_size"] = 1;
		}
		// Iscas de pesca (data/cobblemon/spawn_bait_effects) podem ir na mão secundária da vara.
		if (baitItems().has(id)) components["minecraft:allow_off_hand"] = true;
		// Uso por script: listado em items.ts; só entra no JSON quando registrado (senão o Bedrock rejeita o item).
		for (const comp of scriptComponents(data)) {
			itemComponent(comp, id, COMPONENT_DESCRIPTIONS[comp] ?? comp);
			if (registered.has(comp)) components[comp] = {};
		}
		const item = {
			format_version: ITEM_FORMAT,
			"minecraft:item": {
				description: { identifier: id, menu_category: { category: menuCategory(data.category as string) } },
				components,
			},
		};
		writeJson(`${OUT_BP}/items/cobblemon/${it.id}.json`, item);
		ids.add(id);
		withJson.add(id);
		json++;
	}
	// Blocos cujos itens automáticos existem (menu do criativo) contam como itens para receitas/loot.
	for (const b of blocks.values()) if (b.hasOwnItem) ids.add(b.placeBlock);
	// Poké Balls só do port (itens à mão, ex.: strange_ball): ícone gerado a partir do modelo da bola.
	count("ícones de Poké Balls à mão", legacyBallIcons(iconData));
	count("ícones de tela de Poké Balls à mão", legacyBallGuiIcons());
	writeJson(`${OUT_RP}/textures/item_texture.json`, { resource_pack_name: "CobblemonBedrock", texture_name: "atlas.items", texture_data: iconData });
	emitScriptItems(scriptItems);
	count("itens (JSON)", json);
	count("ícones de item", Object.keys(iconData).length);
	return { ids, javaToBedrock, withJson, json, icons: Object.keys(iconData).length };
}

function tryData(rel: string): any {
	const f = `${DATA}/cobblemon/${rel}`;
	return existsSync(f) ? readJson(f) : undefined;
}

const copiedIcons = new Set<string>();

/** Copia o PNG do ícone (1º quadro se animado) e registra no atlas; devolve a chave. */
function iconKey(itemId: string, texture: string, atlas: Record<string, { textures: string }>): string | undefined {
	const { ns, path } = splitId(texture);
	if (ns !== "cobblemon") return undefined;
	const file = `${ASSETS}/textures/${path}.png`;
	if (!existsSync(file)) {
		warn("textura de ícone ausente", texture);
		return undefined;
	}
	const ref = `textures/${path}`;
	if (!copiedIcons.has(ref)) {
		copiedIcons.add(ref);
		const png = decodePng(file);
		if (png && png.height > png.width && existsSync(`${file}.mcmeta`)) {
			// Ícone animado (tira de quadros): o Bedrock não anima ícones, usa o 1º quadro.
			const out = `${OUT_RP}/${ref}.png`;
			mkdirSync(dirname(out), { recursive: true });
			writeFileSync(out, encodePng(firstFrame(png)));
		} else copyFile(file, `${OUT_RP}/${ref}.png`);
	}
	atlas[itemId] = { textures: ref };
	return itemId;
}

function menuCategory(category: string): string {
	if (["poke_ball", "poke_rod", "pokedex"].includes(category)) return "equipment";
	if (["berry", "apricorn", "apricorn_seed", "mint_leaf", "mint_seeds", "plant"].includes(category)) return "nature";
	return "items";
}

// ---------------------------------------------------------------------------------------------
// Classificação e dados para os scripts

interface Ctx {
	potions: any;
	remedies: any;
	berryMech: any;
	aprijuices: any;
	fossils: Map<string, string[]>;
	heldTag: Set<string>;
	evoTag: Set<string>;
}

function classify(it: KtItem, ctx: Ctx): Record<string, unknown> {
	const b = it.body;
	const id = `cobblemon:${it.id}`;
	const d: Record<string, unknown> = { category: "misc" };
	const stat = (re: RegExp) => {
		const m = re.exec(b);
		return m ? statPath(m[1]) : undefined;
	};
	let m: RegExpExecArray | null;
	if (it.helper === "pokeBallItem") Object.assign(d, { category: "poke_ball", ancient: it.id.startsWith("ancient_") });
	else if ((m = /PotionItem\(PotionType\.([A-Z_]+)/.exec(b))) {
		const t = m[1];
		const amount = t === "POTION" ? ctx.potions?.potionRestoreAmount : t === "SUPER_POTION" ? ctx.potions?.superPotionRestoreAmount : t === "HYPER_POTION" ? ctx.potions?.hyperPotionRestoreAmount : "full";
		Object.assign(d, { category: "medicine", effect: "heal", amount, curesStatus: t === "FULL_RESTORE", returnItem: "minecraft:glass_bottle" });
	} else if (/StatusCureItem\(/.test(b)) Object.assign(d, { category: "medicine", effect: "cure_status", statuses: statuses(b) });
	else if ((m = /EtherItem\(max = (true|false)/.exec(b))) Object.assign(d, { category: "medicine", effect: "restore_pp", target: "move", amount: m[1] === "true" ? "full" : 10 });
	else if ((m = /ElixirItem\(max = (true|false)/.exec(b))) Object.assign(d, { category: "medicine", effect: "restore_pp", target: "all_moves", amount: m[1] === "true" ? "full" : 10 });
	else if ((m = /ReviveItem\(max = (true|false)/.exec(b))) Object.assign(d, { category: "medicine", effect: "revive", hpRatio: m[1] === "true" ? 1 : 0.5 });
	else if ((m = /RemedyItem\(RemedyItem\.([A-Z]+)\)/.exec(b))) Object.assign(d, { category: "medicine", effect: "heal", ...remedy(ctx, m[1].toLowerCase()) });
	else if (/HealPowderItem/.test(b)) Object.assign(d, { category: "medicine", effect: "cure_status", statuses: statuses("getPersistentStatuses"), ...remedy(ctx, "heal_powder") });
	else if (/EnergyRootItem/.test(b)) Object.assign(d, { category: "medicine", effect: "heal", ...remedy(ctx, "root"), plant: "cobblemon:energy_root" });
	// RevivalHerbItem: revive com ceil(maxHealth / 4).
	else if (/RevivalHerbItem/.test(b)) Object.assign(d, { ...remedy(ctx, "revival_herb"), category: "medicine", effect: "revive", hpRatio: 0.25 });
	else if (/MoomooMilk/.test(b)) Object.assign(d, { category: "medicine", effect: "clear_boost", returnItem: "minecraft:glass_bottle", bagOnly: BAG_ONLY.has(it.id) || undefined });
	else if (/BerryJuiceItem/.test(b)) Object.assign(d, { category: "medicine", effect: "heal", amount: 20 });
	else if ((m = /AbilityChangeItem\(AbilityChanger\.([A-Z_]+)\)/.exec(b))) Object.assign(d, { category: "medicine", effect: "change_ability", ability: m[1] === "HIDDEN_ABILITY" ? "hidden" : "common" });
	else if ((m = /PPUpItem\((\d+)/.exec(b))) Object.assign(d, { category: "medicine", effect: "pp_up", stages: Number(m[1]) });
	else if (/XStatItem\(/.test(b)) Object.assign(d, { category: "battle_item", effect: "boost", stat: stat(/Stats\.([A-Z_]+)/), stages: 2 });
	else if (/DireHitItem/.test(b)) Object.assign(d, { category: "battle_item", effect: "dire_hit" });
	else if (/GuardSpecItem/.test(b)) Object.assign(d, { category: "battle_item", effect: "guard_spec" });
	else if (/VitaminItem\(/.test(b)) Object.assign(d, { category: "vitamin", stat: stat(/Stats\.([A-Z_]+)/), ev: 10 });
	else if (/FreshStartMochiItem/.test(b)) Object.assign(d, { category: "mochi", effect: "reset_evs" });
	// MochiItem.evIncreaseAmount = 4.
	else if (/MochiItem\(/.test(b)) Object.assign(d, { category: "mochi", stat: stat(/Stats\.([A-Z_]+)/), ev: 4 });
	else if (/FeatherItem\(/.test(b)) Object.assign(d, { category: "feather", stat: stat(/Stats\.([A-Z_]+)/), ev: 1 });
	else if (it.helper === "candyItem") {
		const y = /DEFAULT_([A-Z]+)_CANDY_YIELD/.exec(b)?.[1];
		const yields: Record<string, number> = { XS: 100, S: 800, M: 3000, L: 10000, XL: 30000 };
		Object.assign(d, y ? { category: "candy", effect: "experience", experience: yields[y] } : { category: "candy", effect: "level_up" });
	} else if (it.helper === "hyperTrainingItem") {
		const hm = /hyperTrainingItem\("[a-z_]+",\s*(-?\d+),\s*setOf\(Stats\.([A-Z_]+)\)/.exec(b);
		Object.assign(d, { category: "hyper_training", amount: hm ? Number(hm[1]) : 1, stat: hm ? statPath(hm[2]) : undefined });
	} else if ((m = /MintItem\(Natures\.([A-Z]+)\)/.exec(b))) Object.assign(d, { category: "mint", nature: m[1].toLowerCase() });
	else if (it.helper === "mintLeaf") Object.assign(d, { category: "mint_leaf", color: it.id.replace("_mint_leaf", "") });
	else if (it.helper === "mintSeed") Object.assign(d, { category: "mint_seeds", color: it.id.replace("_mint_seeds", "") });
	else if (it.helper === "berryItem") Object.assign(d, { category: "berry", ...berryEffect(b, ctx), berry: berryData(it.id) });
	else if ((m = /MulchVariant\.([A-Z]+)/.exec(b))) Object.assign(d, { category: "mulch", variant: m[1].toLowerCase() });
	else if (it.helper === "apricornItem") Object.assign(d, { category: "apricorn", color: it.id.replace("_apricorn", "") });
	else if (it.helper === "apricornSeedItem") Object.assign(d, { category: "apricorn_seed", color: it.id.replace("_apricorn_seed", "") });
	else if (it.helper === "pokerodItem") Object.assign(d, { category: "poke_rod", ...pokerodData(it.id) });
	else if (it.helper === "pokedexItem") Object.assign(d, { category: "pokedex", color: it.id.replace("pokedex_", "") });
	else if (it.helper === "campfirePotItem") Object.assign(d, { category: "campfire_pot", color: it.id.replace("campfire_pot_", "") });
	else if (it.helper === "aprijuiceItem") {
		const color = it.id.replace("aprijuice_", "");
		Object.assign(d, { category: "aprijuice", apricorn: color, statEffects: ctx.aprijuices?.apricornStatEffects?.[color.toUpperCase()] ?? {} });
	} else if (/GemItem\(/.test(b)) Object.assign(d, { category: "type_gem", type: it.id.replace("_gem", "") });
	else if (/TechnicalMachineItem/.test(b)) Object.assign(d, { category: "tm" });
	else if (it.id === "blank_tm") Object.assign(d, { category: "tm", blank: true });
	else if (/LinkCableItem/.test(b)) Object.assign(d, { category: "evolution_item", effect: "trade_evolution" });
	else if (ctx.fossils.has(id)) Object.assign(d, { category: "fossil", species: ctx.fossils.get(id) });
	else if (/SinisterTeaItem|PonigiriItem/.test(b) || it.id === "vivichoke_dip") Object.assign(d, { category: "food", effect: it.id });
	else if (it.food) Object.assign(d, { category: "food" });
	// Marcas adicionais.
	if (ctx.heldTag.has(id) || /heldItem|wearable/.test(it.helper ?? "")) {
		if (d.category === "misc") d.category = "held_item";
		d.heldItem = it.remap ?? it.id;
	}
	if (/wearable/.test(it.helper ?? "") || /WearableBlockItem|wearableBlockItem/.test(b)) d.wearable = true;
	if (ctx.evoTag.has(id)) {
		if (d.category === "misc") d.category = "evolution_item";
		d.evolution = true;
	}
	if (it.food) d.food = { nutrition: it.food.nutrition, saturation: it.food.saturation };
	if (it.block) d.placesBlock = `cobblemon:${it.block}`;
	return d;
}

function remedy(ctx: Ctx, key: string): Record<string, unknown> {
	const r = ctx.remedies?.[key];
	return r ? { amount: Number(r.healingAmount), friendshipDrop: Number(r.friendshipDrop) } : {};
}

function berryEffect(b: string, ctx: Ctx): Record<string, unknown> {
	const mech = ctx.berryMech;
	if (/StatusCuringBerryItem/.test(b)) return { effect: "cure_status", statuses: statuses(b) };
	if (/PPRestoringBerryItem/.test(b)) return { effect: "restore_pp", amount: mech.ppRestoreAmount };
	if (/HealingBerryItem\(CobblemonBlocks\.ORAN/.test(b)) return { effect: "heal", amount: mech.oranRestoreAmount };
	if (/HealingBerryItem/.test(b)) return { effect: "heal", amount: mech.sitrusHealAmount };
	if (/PortionHealingBerryItem/.test(b)) return { effect: "heal_ratio", ratio: mech.portionHealRatio };
	if (/FriendshipRaisingBerryItem/.test(b)) {
		const s = /Stats\.([A-Z_]+)/.exec(b);
		return { effect: "lower_ev_raise_friendship", stat: s ? statPath(s[1]) : undefined, ev: mech.evLowerAmount, friendship: mech.friendshipRaiseAmount };
	}
	return {};
}

function berryData(id: string): Record<string, unknown> | undefined {
	const f = `${DATA}/cobblemon/berries/${id}.json`;
	if (!existsSync(f)) return undefined;
	const j = readJson(f);
	const pick = ["baseYield", "preferredBiomeTags", "growthTime", "refreshRate", "favoriteMulches", "growthFactors", "spawnConditions", "mutations", "sproutShape", "matureShape", "weight", "boneMealChance", "colour", "flavours"];
	const out: Record<string, unknown> = Object.fromEntries(pick.filter((k) => k in j).map((k) => [k, j[k]]));
	// Teto do rendimento (BerryBlockEntity: um fruto por growth point).
	if (Array.isArray(j.growthPoints)) out.growthPointCount = j.growthPoints.length;
	return out;
}

function pokerodData(id: string): Record<string, unknown> {
	const f = `${DATA}/cobblemon/pokerods/${id}.json`;
	if (!existsSync(f)) return {};
	const j = readJson(f);
	return { ball: j.pokeBallId, lineColor: j.lineColor };
}

/**
 * Comidas sem FoodProperties no CobblemonItems.kt (o Kotlin chama foodData.eat em finishUsingItem):
 * PonigiriItem (2; 0,55; comer 1,6 s), SinisterTeaItem (0; 0; sempre; tigela; beber; 16) e
 * AprijuiceItem (eat(4, 1.2f); beber 32 ticks; 16).
 */
const SCRIPTED_FOOD: Record<string, { nutrition: number; saturation: number; drink: boolean; seconds: number; alwaysEdible?: boolean; convertsTo?: string; stack?: number }> = {
	ponigiri: { nutrition: 2, saturation: 0.55, drink: false, seconds: 1.6 },
	sinister_tea: { nutrition: 0, saturation: 0, drink: true, seconds: 1.6, alwaysEdible: true, convertsTo: "minecraft:bowl", stack: 16 },
	aprijuice: { nutrition: 4, saturation: 1.2, drink: true, seconds: 1.6, stack: 16 },
};

/** Itens de remédio que só servem na mochila em batalha (SimpleBagItemLike): sem uso fora de batalha. */
const BAG_ONLY = new Set(["moomoo_milk"]);

const USE_ON_POKEMON = new Set(["medicine", "vitamin", "mochi", "feather", "candy", "hyper_training", "mint", "berry"]);

const COMPONENT_DESCRIPTIONS: Record<string, string> = {
	"cobblemon:use_on_pokemon": "Usar o item em um Pokémon (da party ou apontado): cura/status/PP/revive, EVs (vitaminas, mochis, penas), doces de EXP/nível/hyper training, mints (natureza), berries e itens de evolução. Dados em ITEMS[id].",
	"cobblemon:poke_rod": "Vara de pesca de Pokémon: arremessar a isca e pescar pela spawn pool de pesca (ITEMS[id].ball = bola usada).",
	"cobblemon:technical_machine": "TM: ensinar o movimento gravado a um Pokémon.",
	"cobblemon:mulch": "Aplicar mulch em arbusto de berry/solo (cobblemon:mulch no bloco).",
	"cobblemon:food_effect": "Comida com efeito especial (chá sinistro, ponigiri, aprijuice, vivichoke dip).",
};

function scriptComponents(d: Record<string, unknown>): string[] {
	const out: string[] = [];
	const cat = d.category as string;
	if (!d.bagOnly && (USE_ON_POKEMON.has(cat) || (cat === "berry" && d.effect) || d.evolution || cat === "evolution_item")) out.push("cobblemon:use_on_pokemon");
	if (cat === "berry" && !d.effect && out.includes("cobblemon:use_on_pokemon") && !d.evolution) out.splice(out.indexOf("cobblemon:use_on_pokemon"), 1);
	// Pokédex: comportamento por world.afterEvents.itemUse em scripts/pokedex (sem custom component).
	if (cat === "poke_rod") out.push("cobblemon:poke_rod");
	if (cat === "tm" && !d.blank) out.push("cobblemon:technical_machine");
	if (cat === "mulch") out.push("cobblemon:mulch");
	if (cat === "aprijuice" || (cat === "food" && typeof d.effect === "string")) out.push("cobblemon:food_effect");
	return [...new Set(out)];
}

/** Valores numéricos em texto vindos de data/cobblemon/mechanics ("20") viram números; expressões Molang ficam. */
function numeric(v: unknown): unknown {
	return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

function emitScriptItems(items: Record<string, Record<string, unknown>>): void {
	const lines = Object.entries(items)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, d]) => `\t${JSON.stringify(id)}: ${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => [k, numeric(v)])))},`);
	const comps = [...ITEM_COMPONENTS].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify({ description: v.description, items: v.items.sort() })},`);
	writeText(
		`${OUT_SCRIPTS}/items.ts`,
		`// Arquivo gerado por tools/importer (npm run import). Não edite à mão.
/* eslint-disable */

/** Dados de cada item do Cobblemon (id sem namespace): categoria e parâmetros do comportamento. */
export interface ItemData {
	category: string;
	[key: string]: unknown;
}

export const ITEMS: Record<string, ItemData> = {
${lines.join("\n")}
};

/** Custom components de item (V2) usados nos JSON gerados e ainda sem implementação nos scripts. */
export const ITEM_COMPONENTS: Record<string, { description: string; items: string[] }> = {
${comps.join("\n")}
};
`,
	);
}

let baitCache: Set<string> | undefined;
/** Itens que são isca segundo data/cobblemon/spawn_bait_effects. */
function baitItems(): Set<string> {
	if (!baitCache) {
		baitCache = new Set();
		for (const file of walk(join(DATA, "cobblemon", "spawn_bait_effects"), (n) => n.endsWith(".json"))) {
			const item = tryReadJson(file)?.item;
			if (typeof item === "string") baitCache.add(item.includes(":") ? item : `cobblemon:${item}`);
		}
	}
	return baitCache;
}
