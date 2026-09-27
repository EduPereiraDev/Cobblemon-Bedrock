// Frente "give": quais itens do BP os comandos (/give, /clear, /replaceitem...) enxergam.
//
// Regra medida no BDS 1.26.52 (docs/pendencias/give.md). Um ITEM data-driven só entra no enum de itens dos
// comandos se estiver no crafting_items_catalog OU tiver menu_category com category diferente de "none"; e nunca
// com is_hidden_in_commands: true. Sem menu_category e fora do catálogo, ou com category "none" (mesmo com
// is_hidden_in_commands: false), o item existe (loot e scripts funcionam), mas o comando responde
// `Syntax error: Unexpected "<id>"` e o content log fica vazio. BLOCOS aparecem mesmo sem menu_category ou com
// "none". Um item com o mesmo id de um bloco (replace_block_item) substitui o item do bloco: vale a regra do item.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLenient, walk } from "./util.ts";

export interface MenuCategory {
	category?: string;
	group?: string;
	is_hidden_in_commands?: boolean;
}

/**
 * Motivo de o item ficar fora dos comandos por acidente, ou undefined se o /give o aceita.
 * `is_hidden_in_commands: true` explícito é escolha consciente e não conta como problema.
 */
export function itemCommandProblem(menu: MenuCategory | undefined, inCatalog: boolean): string | undefined {
	if (menu?.is_hidden_in_commands === true) return undefined;
	if (inCatalog) return undefined;
	if (!menu?.category) return "sem menu_category e fora do crafting_items_catalog";
	if (menu.category === "none") return "menu_category \"none\" e fora do crafting_items_catalog (is_hidden_in_commands: false não basta em item)";
	return undefined;
}

/** Ids de item listados nos catálogos (strings ou { name }). */
export function catalogItemIds(catalog: any): Set<string> {
	const ids = new Set<string>();
	for (const cat of catalog?.["minecraft:crafting_items_catalog"]?.categories ?? []) {
		for (const group of cat.groups ?? []) {
			for (const it of group.items ?? []) {
				const id = typeof it === "string" ? it : it?.name;
				if (typeof id === "string") ids.add(id);
			}
		}
	}
	return ids;
}

/** Mesma fusão de tools/build.mjs: objetos mesclados, arrays concatenados, o escrito à mão vence. */
export function deepMerge(a: any, b: any): any {
	if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
	if (a && b && typeof a === "object" && typeof b === "object") {
		const out = { ...a };
		for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : v;
		return out;
	}
	return b;
}

/**
 * Documentos gerados já mesclados com o escrito à mão do mesmo caminho relativo (`handFor` devolve esse arquivo ou
 * undefined), como o build faz em dist/. O validador checa o resultado: um overlay não esconde um array dobrado.
 */
export function mergedDocs(generated: Map<string, any>, handFor: (file: string) => string | undefined, read: (file: string) => any): Map<string, any> {
	const out = new Map<string, any>();
	for (const [f, j] of generated) {
		const hand = handFor(f);
		const h = hand !== undefined && j !== undefined ? read(hand) : undefined;
		out.set(f, h !== undefined ? deepMerge(j, h) : j);
	}
	return out;
}

/** JSON de `sub/` como o build monta em dist/ (gerado + escrito à mão no mesmo caminho relativo). */
export function mergedPackJson(genBp: string, handBp: string, sub: string): Map<string, { file: string; json: any }> {
	const out = new Map<string, { file: string; json: any }>();
	for (const root of [genBp, handBp]) {
		for (const file of walk(join(root, sub), (n) => n.endsWith(".json"))) {
			const key = file.slice(root.length);
			let json: any;
			try {
				json = parseLenient(readFileSync(file, "utf8"));
			} catch {
				continue; // JSON inválido já é erro do validador.
			}
			const prev = out.get(key);
			out.set(key, prev ? { file, json: deepMerge(prev.json, json) } : { file, json });
		}
	}
	return out;
}

export interface CommandProblem {
	id: string;
	file: string;
	reason: string;
}

/** Itens do pack montado que o /give não aceita por acidente. */
export function itemsHiddenFromCommands(genBp: string, handBp: string): CommandProblem[] {
	const catalog = new Set<string>();
	for (const { json } of mergedPackJson(genBp, handBp, "item_catalog").values()) for (const id of catalogItemIds(json)) catalog.add(id);
	const problems: CommandProblem[] = [];
	for (const { file, json } of mergedPackJson(genBp, handBp, "items").values()) {
		const desc = json?.["minecraft:item"]?.description;
		const id: unknown = desc?.identifier;
		if (typeof id !== "string") continue;
		const reason = itemCommandProblem(desc.menu_category, catalog.has(id));
		if (reason) problems.push({ id, file, reason });
	}
	return problems;
}
