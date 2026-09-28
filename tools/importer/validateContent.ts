// Validação estática de itens, blocos, receitas, loot e worldgen (gerados + escritos à mão, como o build
// junta). Chamado por validate.ts. Confere: ids duplicados; ícones e texturas do terreno existentes;
// geometrias e bones de bone_visibility; estados usados nas condições; loot tables e seus itens;
// ingredientes/resultados de receitas; blocos e features referenciados pelo worldgen; custom components
// registrados em scripts/custom_components/index.ts ou listados em generated/scripts/{blockBehaviours,items}.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registeredComponents } from "./blocks.ts";
import { HAND_BP, HAND_RP, OUT_BP, OUT_RP, OUT_SCRIPTS, parseLenient, rel, walk } from "./util.ts";
import { VANILLA_BLOCKS, VANILLA_ITEMS } from "./vanilla.ts";
import { VANILLA_LOOT_DIR } from "./lootInjection.ts";
import { checkBlockGeometry, checkScatterFeatureMolang } from "./clientRules.ts";

/** Tags de item nativas do Bedrock aceitas em receitas. */
const VANILLA_ITEM_TAGS = new Set(["minecraft:planks", "minecraft:wool", "minecraft:wooden_slabs", "minecraft:logs", "minecraft:coals", "minecraft:stone_tool_materials", "minecraft:is_fish", "minecraft:transform_templates"]);

function load(file: string, err: (m: string) => void): any {
	try {
		return parseLenient(readFileSync(file, "utf8"));
	} catch (e) {
		err(`JSON inválido: ${rel(file)}: ${(e as Error).message}`);
		return undefined;
	}
}

export async function validateContent(err: (m: string) => void, warnMsg: (m: string) => void): Promise<string> {
	const packs = (sub: string, ext = ".json") => [...walk(`${OUT_BP}/${sub}`, (n) => n.endsWith(ext)), ...walk(`${HAND_BP}/${sub}`, (n) => n.endsWith(ext))];
	const registered = registeredComponents();
	const blockComps: Record<string, unknown> = existsSync(`${OUT_SCRIPTS}/blockBehaviours.ts`) ? (await import(pathToFileURL(`${OUT_SCRIPTS}/blockBehaviours.ts`).href)).BLOCK_COMPONENTS : {};
	const itemComps: Record<string, unknown> = existsSync(`${OUT_SCRIPTS}/items.ts`) ? (await import(pathToFileURL(`${OUT_SCRIPTS}/items.ts`).href)).ITEM_COMPONENTS : {};
	// No JSON só podem aparecer componentes registrados (o Bedrock rejeita o bloco/item com componente
	// desconhecido); os pendentes ficam listados em blockBehaviours.ts/items.ts.
	const componentOk = (name: string) => registered.has(name);
	for (const [name, def] of Object.entries<any>(blockComps)) if (!def?.blocks?.length || !def.description) err(`blockBehaviours.ts: ${name} sem blocos/descrição`);
	for (const [name, def] of Object.entries<any>(itemComps)) if (!def?.items?.length || !def.description) err(`items.ts: ${name} sem itens/descrição`);

	// Índices do RP.
	const geometries = new Map<string, Set<string>>();
	const geometryBones = new Map<string, any[]>();
	for (const root of [OUT_RP, HAND_RP]) {
		for (const f of walk(`${root}/models/blocks`, (n) => n.endsWith(".json"))) {
			const j = load(f, err);
			for (const g of j?.["minecraft:geometry"] ?? []) {
				geometries.set(g.description?.identifier, new Set((g.bones ?? []).map((b: any) => b.name)));
				geometryBones.set(g.description?.identifier, g.bones ?? []);
			}
		}
	}
	// Frente cliente-log: limites de geometria de bloco que só o cliente confere (clientRules.ts). Fora deles o
	// cliente descarta a geometria e o bloco some ("cannot find geometry ... JSON").
	const boundsChecked = new Set<string>();
	const checkGeometryBounds = (geoId: string, where: string) => {
		if (boundsChecked.has(geoId) || !geometryBones.has(geoId)) return;
		boundsChecked.add(geoId);
		const r = checkBlockGeometry(geometryBones.get(geoId)!);
		for (const p of r.problems) err(`${where}: geometria de bloco ${geoId}: ${p}`);
	};
	const atlas = (file: string) => {
		const out = new Map<string, string[]>();
		for (const root of [OUT_RP, HAND_RP]) {
			const f = `${root}/textures/${file}`;
			if (!existsSync(f)) continue;
			for (const [k, v] of Object.entries<any>(load(f, err)?.texture_data ?? {})) {
				const t = v?.textures;
				out.set(k, Array.isArray(t) ? t.map((x: any) => (typeof x === "string" ? x : x.path)) : [typeof t === "string" ? t : t?.path]);
			}
		}
		return out;
	};
	const terrain = atlas("terrain_texture.json");
	const icons = atlas("item_texture.json");
	const textureFile = (ref: string) => ref.startsWith("textures/blocks/") || ref.startsWith("textures/items/") || [OUT_RP, HAND_RP].some((r) => [".png", ".tga"].some((e) => existsSync(`${r}/${ref}${e}`)));
	for (const [k, refs] of terrain) for (const r of refs) if (r && !textureFile(r)) err(`terrain_texture ${k}: arquivo ${r} não existe`);
	for (const root of [OUT_RP, HAND_RP]) {
		const f = `${root}/textures/flipbook_textures.json`;
		if (!existsSync(f)) continue;
		for (const fb of load(f, err) ?? []) {
			if (!terrain.has(fb.atlas_tile)) err(`flipbook ${fb.flipbook_texture}: atlas_tile ${fb.atlas_tile} fora do terrain_texture`);
			if (!textureFile(fb.flipbook_texture)) err(`flipbook: arquivo ${fb.flipbook_texture} não existe`);
		}
	}
	for (const [k, refs] of icons) for (const r of refs) if (r && !textureFile(r)) err(`item_texture ${k}: arquivo ${r} não existe`);

	// Blocos.
	const blocks = new Map<string, string>();
	const lootRefs: Array<[string, string]> = [];
	let blockCount = 0;
	// Arquivo do BP manual no mesmo caminho de um gerado é um complemento parcial: o tools/build.mjs mescla os dois
	// (deepMerge, listas concatenadas). Valida o resultado mesclado, como vai para o jogo (frente mundo-sons).
	const handOverlay = (f: string) => (f.startsWith(OUT_BP) ? join(HAND_BP, f.slice(OUT_BP.length)) : undefined);
	const overlays = new Set(walk(`${OUT_BP}/blocks`, (n) => n.endsWith(".json")).map(handOverlay).filter((h): h is string => !!h && existsSync(h)));
	const merge = (a: any, b: any): any => {
		if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
		if (a && b && typeof a === "object" && typeof b === "object") {
			const out = { ...a };
			for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
			return out;
		}
		return b;
	};
	for (const f of packs("blocks")) {
		if (overlays.has(f)) continue;
		const overlay = handOverlay(f);
		const base = load(f, err);
		const j = (overlay && overlays.has(overlay) ? merge(base, load(overlay, err)) : base)?.["minecraft:block"];
		if (!j) continue;
		blockCount++;
		const id: string = j.description?.identifier;
		if (blocks.has(id)) err(`bloco duplicado: ${id} (${rel(blocks.get(id)!)} e ${rel(f)})`);
		blocks.set(id, f);
		const states = new Set(Object.keys(j.description?.states ?? {}));
		for (const t of Object.values<any>(j.description?.traits ?? {})) for (const s of t.enabled_states ?? []) states.add(s);
		if (states.has("minecraft:cardinal_connections")) for (const d of ["north", "east", "south", "west"]) states.add(`minecraft:connection_${d}`);
		const check = (comps: Record<string, any>, where: string) => {
			const geo = comps["minecraft:geometry"];
			const geoId = typeof geo === "string" ? geo : geo?.identifier;
			if (geoId && !geoId.startsWith("minecraft:geometry.")) {
				const bones = geometries.get(geoId);
				if (!bones) err(`${where}: geometria ${geoId} não existe`);
				else for (const b of Object.keys(geo?.bone_visibility ?? {})) if (!bones.has(b)) err(`${where}: bone_visibility usa bone inexistente ${b}`);
				checkGeometryBounds(geoId, where);
			}
			for (const [inst, m] of Object.entries<any>(comps["minecraft:material_instances"] ?? {})) {
				if (typeof m === "string") continue;
				if (m?.texture && !terrain.has(m.texture)) err(`${where}: material ${inst} usa textura ${m.texture} fora do terrain_texture`);
			}
			if (typeof comps["minecraft:loot"] === "string") lootRefs.push([where, comps["minecraft:loot"]]);
			for (const k of Object.keys(comps)) if (k.startsWith("cobblemon:") && !componentOk(k)) err(`${where}: custom component ${k} não registrado em scripts/custom_components/index.ts`);
			for (const s of Object.values<any>(geo?.bone_visibility ?? {})) checkStates(String(s), where);
		};
		const checkStates = (expr: string, where: string) => {
			for (const m of expr.matchAll(/q(?:uery)?\.block_state\s*\(\s*'([^']+)'\s*\)/g)) if (!states.has(m[1])) err(`${where}: condição usa estado não declarado ${m[1]}`);
		};
		check(j.components ?? {}, id);
		(j.permutations ?? []).forEach((p: any, i: number) => {
			checkStates(String(p.condition ?? ""), `${id}#${i}`);
			check(p.components ?? {}, `${id}#${i}`);
		});
	}

	// Itens.
	const items = new Map<string, string>();
	const entities = new Set<string>();
	for (const f of packs("entities")) {
		const id = load(f, err)?.["minecraft:entity"]?.description?.identifier;
		if (id) entities.add(id);
	}
	let itemCount = 0;
	for (const f of packs("items")) {
		const j = load(f, err)?.["minecraft:item"];
		if (!j) continue;
		itemCount++;
		const id: string = j.description?.identifier;
		if (items.has(id)) err(`item duplicado: ${id} (${rel(items.get(id)!)} e ${rel(f)})`);
		items.set(id, f);
		const c = j.components ?? {};
		const icon = typeof c["minecraft:icon"] === "string" ? c["minecraft:icon"] : c["minecraft:icon"]?.textures?.default ?? c["minecraft:icon"]?.texture;
		if (icon && !icons.has(icon) && id.startsWith("cobblemon:")) (f.startsWith(OUT_BP) ? err : warnMsg)(`${id}: ícone ${icon} fora do item_texture`);
		// Frente cliente-teste3-log: item data-driven sem minecraft:icon → "[Item][error] Missing icon for data-driven
		// item" no cliente a cada vez que aparece (1.651× o pokemon_model no 3º teste). Todo item precisa de ícone.
		if (!icon && id.startsWith("cobblemon:")) err(`${id}: item sem minecraft:icon (o cliente acusa "Missing icon for data-driven item"): ${rel(f)}`);
		const placer = c["minecraft:block_placer"];
		if (placer?.block && !blocks.has(placer.block) && !VANILLA_BLOCKS.has(placer.block)) err(`${id}: block_placer para bloco inexistente ${placer.block}`);
		if (placer?.replace_block_item && placer.block !== id) err(`${id}: replace_block_item exige o mesmo id do bloco (${placer.block})`);
		const proj = c["minecraft:projectile"]?.projectile_entity;
		if (proj && !entities.has(proj)) err(`${id}: entidade de projétil ${proj} não existe`);
		for (const k of Object.keys(c)) if (k.startsWith("cobblemon:") && !componentOk(k)) err(`${id}: custom component ${k} não registrado em scripts/custom_components/index.ts`);
	}
	const itemExists = (id: string) => items.has(id) || blocks.has(id) || VANILLA_ITEMS.has(id) || VANILLA_BLOCKS.has(id);
	const itemTags = new Map<string, number>();
	for (const f of items.values()) for (const t of load(f, err)?.["minecraft:item"]?.components?.["minecraft:tags"]?.tags ?? []) itemTags.set(t, (itemTags.get(t) ?? 0) + 1);

	// Loot tables.
	const lootFile = (p: string) => [OUT_BP, HAND_BP].map((r) => join(r, p)).find((f) => existsSync(f));
	for (const [where, p] of lootRefs) if (!lootFile(p)) err(`${where}: loot table ${p} não existe`);
	let lootCount = 0;
	for (const f of walk(`${OUT_BP}/loot_tables`, (n) => n.endsWith(".json"))) {
		lootCount++;
		// Cópias das tabelas vanilla (injeções do Cobblemon): os itens são os da Mojang, com aliases antigos
		// (horsearmoriron, record_13...) que a lista de itens não tem; só o pool injetado é conferido.
		const vanillaCopy = existsSync(join(VANILLA_LOOT_DIR, f.slice(`${OUT_BP}/loot_tables/`.length)));
		const walkEntries = (v: any) => {
			if (Array.isArray(v)) v.forEach(walkEntries);
			else if (v && typeof v === "object") {
				if (v.type === "item" && !vanillaCopy && !itemExists(v.name)) err(`${rel(f)}: item ${v.name} não existe`);
				// Tabela aninhada (injeções do Cobblemon): precisa existir no pack (ou ser vanilla).
				if (v.type === "loot_table" && String(v.name).startsWith("loot_tables/cobblemon/") && !lootFile(String(v.name))) err(`${rel(f)}: loot table ${v.name} não existe`);
				Object.values(v).forEach(walkEntries);
			}
		};
		walkEntries(load(f, err)?.pools);
	}

	// Receitas.
	const recipeIds = new Map<string, string>();
	let recipeCount = 0;
	const ingredientOk = (ing: any, where: string) => {
		if (typeof ing === "string") {
			if (!itemExists(ing.replace(/:\d+$/, ""))) err(`${where}: item ${ing} não existe`);
		} else if (ing?.item) {
			if (!itemExists(ing.item)) err(`${where}: item ${ing.item} não existe`);
		} else if (ing?.tag) {
			if (!VANILLA_ITEM_TAGS.has(ing.tag) && !itemTags.has(ing.tag)) err(`${where}: nenhum item com a tag ${ing.tag}`);
		}
	};
	for (const f of packs("recipes")) {
		const j = load(f, err);
		if (!j) continue;
		const type = Object.keys(j).find((k) => k.startsWith("minecraft:recipe_"));
		if (!type) continue;
		recipeCount++;
		const r = j[type];
		const id = r.description?.identifier;
		if (recipeIds.has(id)) err(`receita duplicada: ${id} (${rel(recipeIds.get(id)!)} e ${rel(f)})`);
		recipeIds.set(id, f);
		if (!f.startsWith(OUT_BP)) continue;
		for (const v of Object.values<any>(r.key ?? {})) ingredientOk(v, id);
		for (const v of r.ingredients ?? []) ingredientOk(v, id);
		if (r.input) ingredientOk(r.input, id);
		for (const k of ["template", "base", "addition"]) if (r[k]) ingredientOk(r[k], id);
		const res = r.result ?? r.output;
		if (res) ingredientOk(typeof res === "string" ? res : res.item, id);
	}

	// Worldgen.
	const features = new Set<string>();
	const featureDocs: Array<[string, any]> = [];
	for (const f of packs("features")) {
		const j = load(f, err);
		const type = Object.keys(j ?? {}).find((k) => k.startsWith("minecraft:"));
		if (!type) continue;
		const id = j[type].description?.identifier;
		if (features.has(id)) err(`feature duplicada: ${id}`);
		features.add(id);
		featureDocs.push([id, j[type]]);
		// Frente cliente-log: v.worldx/z fora de ordem (o cliente acusa "unknown variable" a cada chunk).
		if (type === "minecraft:scatter_feature") for (const p of checkScatterFeatureMolang(j[type])) err(`feature ${id}: ${p}`);
	}
	const blockRef = (b: any) => (typeof b === "string" ? b : b?.name);
	// Blocos citados em filtros/regras de worldgen e placement_filter precisam existir (o BDS só acusa
	// quando o descritor é resolvido, na primeira geração/colocação).
	const BLOCK_LIST_KEYS = new Set(["block_filter", "may_replace", "may_attach_to", "may_grow_on", "may_grow_through", "base_block", "block_allowlist", "bottom", "top", "sides", "north", "south", "east", "west", "all"]);
	const checkBlockLists = (v: any, where: string, inList = false) => {
		if (typeof v === "string") {
			if (inList && /^minecraft:/.test(v) && !VANILLA_BLOCKS.has(v)) err(`${where}: bloco vanilla ${v} não existe no Bedrock`);
			if (inList && /^cobblemon:/.test(v) && !blocks.has(v)) err(`${where}: bloco ${v} não existe`);
		} else if (Array.isArray(v)) v.forEach((x) => checkBlockLists(x, where, inList));
		else if (v && typeof v === "object") {
			if (inList && typeof v.name === "string") checkBlockLists(v.name, where, true);
			for (const [k, x] of Object.entries(v)) checkBlockLists(x, where, inList || BLOCK_LIST_KEYS.has(k));
		}
	};
	for (const [id, d] of featureDocs) checkBlockLists(d, `feature ${id}`);
	for (const [id, f] of blocks) {
		const j = load(f, err)?.["minecraft:block"];
		checkBlockLists(j?.components?.["minecraft:placement_filter"], id);
		for (const p of j?.permutations ?? []) checkBlockLists(p.components?.["minecraft:placement_filter"], id);
	}
	for (const [id, d] of featureDocs) {
		const refs: string[] = [];
		if (d.places_block) refs.push(blockRef(d.places_block));
		for (const r of d.replace_rules ?? []) refs.push(blockRef(r.places_block), ...(r.may_replace ?? []).map(blockRef));
		if (d.trunk?.trunk_block) refs.push(blockRef(d.trunk.trunk_block));
		if (d.canopy?.leaf_block) refs.push(blockRef(d.canopy.leaf_block));
		for (const b of refs) if (b && !blocks.has(b) && !VANILLA_BLOCKS.has(b)) err(`feature ${id}: bloco ${b} não existe`);
		const subs = [d.places_feature, ...(d.features ?? []).map((x: any) => (Array.isArray(x) ? x[0] : x))].filter(Boolean);
		for (const s of subs) if (!features.has(s) && !String(s).startsWith("minecraft:")) err(`feature ${id}: feature ${s} não existe`);
		if (d.structure_name) {
			const [ns, name] = String(d.structure_name).split(":");
			if (![OUT_BP, HAND_BP].some((r) => existsSync(`${r}/structures/${ns}/${name}.mcstructure`))) err(`feature ${id}: estrutura ${d.structure_name} não existe`);
		}
	}
	let ruleCount = 0;
	for (const f of packs("feature_rules")) {
		const r = load(f, err)?.["minecraft:feature_rules"];
		if (!r) continue;
		ruleCount++;
		for (const p of checkScatterFeatureMolang(r.distribution)) err(`feature rule ${r.description?.identifier}: ${p}`);
		const pf = r.description?.places_feature;
		if (pf && !features.has(pf) && !String(pf).startsWith("minecraft:")) err(`feature rule ${r.description?.identifier}: feature ${pf} não existe`);
	}
	// Client entities das poké balls geradas (ancient): geometria, textura e animações.
	const entityGeos = new Set<string>();
	const entityAnims = new Set<string>();
	for (const root of [OUT_RP, HAND_RP]) {
		for (const f of walk(`${root}/models/entity`, (n) => n.endsWith(".json"))) for (const g of load(f, err)?.["minecraft:geometry"] ?? []) entityGeos.add(g.description?.identifier);
		for (const f of walk(`${root}/animations`, (n) => n.endsWith(".json"))) if (!f.includes("/pokemon/")) for (const k of Object.keys(load(f, err)?.animations ?? {})) entityAnims.add(k);
	}
	let ballEntities = 0;
	for (const f of walk(`${OUT_RP}/entity/pokeballs`, (n) => n.endsWith(".json"))) {
		const d = load(f, err)?.["minecraft:client_entity"]?.description;
		if (!d) continue;
		ballEntities++;
		if (!entities.has(d.identifier)) err(`${d.identifier}: client entity sem entidade no BP`);
		for (const g of Object.values<string>(d.geometry ?? {})) if (!entityGeos.has(g)) err(`${d.identifier}: geometria ${g} não existe`);
		for (const t of Object.values<string>(d.textures ?? {})) if (!textureFile(t)) err(`${d.identifier}: textura ${t} não existe`);
		for (const a of Object.values<string>(d.animations ?? {})) if (!entityAnims.has(a)) err(`${d.identifier}: animação ${a} não existe`);
	}
	void warnMsg;
	return `${ballEntities} client entities de poké ball, ${blockCount} blocos, ${itemCount} itens, ${recipeCount} receitas, ${lootCount} loot tables geradas, ${features.size} features, ${ruleCount} feature rules, ${geometries.size} geometrias de bloco, ${terrain.size} texturas de terreno, ${icons.size} ícones`;
}
