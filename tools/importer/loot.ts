// Loot tables de bloco do Java → loot tables do Bedrock.
//
// O Bedrock não tem condição de estado de bloco nem "alternatives": as condições block_state_property são
// avaliadas estaticamente para cada combinação dos estados envolvidos (uma tabela por combinação distinta,
// ligada ao bloco por permutation), match_tool (silk touch/tesoura) é tratado como falso (drop normal),
// survives_explosion como verdadeiro, e bônus de fortuna/explosion_decay são descartados.
import { existsSync } from "node:fs";
import { ASSETS, DATA, OUT_BP, readJson, splitId, tryReadJson, warn, writeJson } from "./util.ts";

export type Assignment = Record<string, string>;

export interface BedrockLoot {
	pools: Array<Record<string, unknown>>;
}

type Tri = true | false | Record<string, unknown>;

/** Converte ids de item do Java para o Bedrock (vanilla renomeados; Cobblemon via mapa de ids). */
export type ItemIdMapper = (javaId: string) => string | undefined;

export function javaBlockLoot(blockId: string): any | undefined {
	const { path } = splitId(blockId);
	const file = `${DATA}/cobblemon/loot_table/blocks/${path}.json`;
	return existsSync(file) ? readJson(file) : undefined;
}

/** Propriedades de estado referenciadas pela tabela (block_state_property). */
export function lootStateProps(table: any): string[] {
	const props = new Set<string>();
	const walk = (v: any) => {
		if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") {
			if (String(v.condition ?? "").endsWith("block_state_property")) for (const k of Object.keys(v.properties ?? {})) props.add(k);
			Object.values(v).forEach(walk);
		}
	};
	walk(table);
	return [...props].sort();
}

function evalCondition(c: any, state: Assignment): Tri {
	const type = String(c?.condition ?? "").replace(/^minecraft:/, "");
	switch (type) {
		case "survives_explosion":
		case "location_check":
		case "entity_properties":
		case "weather_check":
		case "time_check":
			return true;
		case "block_state_property": {
			for (const [k, v] of Object.entries<any>(c.properties ?? {})) {
				const cur = state[k];
				if (cur === undefined) continue;
				if (typeof v === "object") {
					const n = Number(cur);
					if (v.min !== undefined && n < Number(v.min)) return false;
					if (v.max !== undefined && n > Number(v.max)) return false;
				} else if (String(v) !== cur) return false;
			}
			return true;
		}
		case "match_tool":
			return false;
		case "inverted": {
			const r = evalCondition(c.term, state);
			return r === true ? false : r === false ? true : true;
		}
		case "any_of":
		case "alternative": {
			let keep: Record<string, unknown> | undefined;
			for (const t of c.terms ?? []) {
				const r = evalCondition(t, state);
				if (r === true) return true;
				if (r !== false) keep ??= r;
			}
			return keep ?? false;
		}
		case "all_of": {
			const keeps: Record<string, unknown>[] = [];
			for (const t of c.terms ?? []) {
				const r = evalCondition(t, state);
				if (r === false) return false;
				if (r !== true) keeps.push(r);
			}
			return keeps.length ? keeps[0] : true;
		}
		case "random_chance":
			return { condition: "random_chance", chance: Number(c.chance) };
		case "table_bonus":
			return { condition: "random_chance", chance: Number(c.chances?.[0] ?? 1) };
		default:
			warn("condição de loot sem equivalente (considerada verdadeira)", type);
			return true;
	}
}

function evalConditions(list: any[] | undefined, state: Assignment): { ok: boolean; keep: Record<string, unknown>[] } {
	const keep: Record<string, unknown>[] = [];
	for (const c of list ?? []) {
		const r = evalCondition(c, state);
		if (r === false) return { ok: false, keep };
		if (r !== true) keep.push(r);
	}
	return { ok: true, keep };
}

function countOf(v: any): number | { min: number; max: number } | undefined {
	if (typeof v === "number") return v;
	if (!v || typeof v !== "object") return undefined;
	const type = String(v.type ?? "").replace(/^minecraft:/, "");
	if (type === "uniform") return { min: Number(v.min), max: Number(v.max) };
	if (type === "constant") return Number(v.value);
	if (type === "binomial") return { min: 0, max: Number(v.n) };
	// Formato antigo sem "type" ({ "min": 1, "max": 2 }) = uniform.
	if (!type && v.min !== undefined && v.max !== undefined) return { min: Number(v.min), max: Number(v.max) };
	return undefined;
}

function convertFunctions(fns: any[] | undefined, state: Assignment): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	for (const f of fns ?? []) {
		const type = String(f.function ?? "").replace(/^minecraft:/, "");
		const cond = evalConditions(f.conditions, state);
		if (!cond.ok) continue;
		if (type === "set_count") {
			const c = countOf(f.count);
			if (c === undefined) continue;
			// "add": soma ao valor anterior (só usado para valores constantes nas tabelas do Cobblemon).
			const prev = out.findIndex((x) => x.function === "set_count");
			if (f.add && prev >= 0 && typeof c === "number" && typeof out[prev].count === "number") {
				out[prev].count = (out[prev].count as number) + c;
				continue;
			}
			if (prev >= 0) out.splice(prev, 1);
			out.push({ function: "set_count", count: c, ...(cond.keep.length ? { conditions: cond.keep } : {}) });
		}
		else if (type === "set_components" && f.components?.["cobblemon:tm_move"]?.move) {
			// TM com golpe (componente cobblemon:tm_move): o port guarda o golpe na lore (scripts/items/tm.ts
			// parseTMMove aceita o nome do golpe em texto).
			out.push({ function: "set_lore", lore: [`§7${moveName(String(f.components["cobblemon:tm_move"].move))}`] });
		}
		// apply_bonus (fortuna), explosion_decay, copy_components etc.: sem equivalente útil, descartados.
	}
	return out;
}

/** Tabelas vanilla com nome diferente no Bedrock. */
export const VANILLA_LOOT_RENAMES: Record<string, string> = {
	"chests/shipwreck_supply": "chests/shipwrecksupply",
	"chests/shipwreck_treasure": "chests/shipwrecktreasure",
	"chests/shipwreck_map": "chests/shipwreck",
	"chests/buried_treasure": "chests/buriedtreasure",
};

const nestedRefs = new Set<string>();

/** Tabelas do Cobblemon citadas como `loot_table` nas conversões desde a última chamada (e esvazia a lista). */
export function takeNestedLootRefs(): string[] {
	const out = [...nestedRefs];
	nestedRefs.clear();
	return out;
}

let langCache: Record<string, string> | undefined;

/** Nome do golpe pela lang do Cobblemon (cobblemon.move.<id>), ou o próprio id. */
export function moveName(id: string): string {
	langCache ??= tryReadJson(`${ASSETS}/lang/en_us.json`) ?? {};
	return langCache![`cobblemon.move.${id.toLowerCase()}`] ?? id;
}

function convertEntries(entries: any[], state: Assignment, mapId: ItemIdMapper): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	for (const e of entries ?? []) {
		const type = String(e.type ?? "").replace(/^minecraft:/, "");
		const cond = evalConditions(e.conditions, state);
		if (!cond.ok) continue;
		if (type === "item") {
			const name = mapId(e.name);
			if (!name) {
				warn("item de loot sem equivalente", e.name);
				continue;
			}
			const entry: Record<string, unknown> = { type: "item", name, weight: e.weight ?? 1 };
			const fns = convertFunctions(e.functions, state);
			if (fns.length) entry.functions = fns;
			if (cond.keep.length) entry.conditions = cond.keep;
			out.push(entry);
		} else if (type === "alternatives") {
			// Primeiro filho cujas condições passam (estaticamente).
			for (const child of e.children ?? []) {
				const c = convertEntries([child], state, mapId);
				if (c.length) {
					out.push(...c);
					break;
				}
			}
		} else if (type === "group" || type === "sequence") {
			out.push(...convertEntries(e.children ?? [], state, mapId));
		} else if (type === "loot_table") {
			// Tabela aninhada: as do Cobblemon vão para loot_tables/cobblemon/<caminho> (convertidas por quem pediu,
			// via takeNestedLootRefs); as vanilla, para o caminho do Bedrock.
			const { ns, path } = splitId(String(e.value ?? e.name ?? ""), "minecraft");
			if (!path) continue;
			if (ns === "cobblemon") nestedRefs.add(path);
			const name = ns === "cobblemon" ? `loot_tables/cobblemon/${path}.json` : `loot_tables/${VANILLA_LOOT_RENAMES[path] ?? path}.json`;
			const entry: Record<string, unknown> = { type: "loot_table", name, weight: e.weight ?? 1 };
			if (cond.keep.length) entry.conditions = cond.keep;
			out.push(entry);
		} else if (type === "empty") {
			out.push({ type: "empty", weight: e.weight ?? 1 });
		} else {
			warn("tipo de entrada de loot sem equivalente", type);
		}
	}
	return out;
}

export function convertLoot(table: any, state: Assignment, mapId: ItemIdMapper): BedrockLoot {
	const pools: Array<Record<string, unknown>> = [];
	for (const p of table?.pools ?? []) {
		const cond = evalConditions(p.conditions, state);
		if (!cond.ok) continue;
		const entries = convertEntries(p.entries ?? [], state, mapId).filter((x) => x.type !== "empty" || true);
		if (!entries.some((x) => x.type === "item" || x.type === "loot_table")) continue;
		const rolls = countOf(p.rolls) ?? 1;
		const pool: Record<string, unknown> = { rolls, entries };
		if (cond.keep.length) pool.conditions = cond.keep;
		pools.push(pool);
	}
	return { pools };
}

const written = new Map<string, string>();

/** Grava a tabela (deduplicando conteúdo idêntico) e devolve o caminho relativo ao BP. */
export function emitLoot(path: string, loot: BedrockLoot, fixedPath = false): string {
	if (!loot.pools.length && !fixedPath) return EMPTY_LOOT;
	const key = JSON.stringify(loot);
	const prev = written.get(key);
	if (prev && !fixedPath) return prev;
	if (fixedPath) {
		const rel = `loot_tables/${path}.json`;
		writeJson(`${OUT_BP}/${rel}`, loot);
		if (!prev) written.set(key, rel);
		return rel;
	}
	const rel = `loot_tables/${path}.json`;
	writeJson(`${OUT_BP}/${rel}`, loot);
	written.set(key, rel);
	return rel;
}

export const EMPTY_LOOT = "loot_tables/empty.json";

export function emitEmptyLoot(): void {
	writeJson(`${OUT_BP}/${EMPTY_LOOT}`, { pools: [] });
}

export function lootCount(): number {
	return written.size;
}
