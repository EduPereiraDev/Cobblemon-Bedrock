// Pokédex do Cobblemon (data/cobblemon/{dexes,dex_entries,dex_additions,dex_entry_additions}) →
// generated/scripts/dex.ts (DEXES e DEX_ENTRIES no formato de scripts/pokedex/DexData.ts, com as
// adições já aplicadas).
import { DATA, OUT_SCRIPTS, count, readJson, walk, writeText } from "./util.ts";

interface DexJson {
	id: string;
	type?: string;
	sortOrder?: number;
	entries?: string[];
	subDexIds?: string[];
	squash?: boolean;
}

interface DexEntryJson {
	id: string;
	speciesId: string;
	displayAspects?: string[];
	conditionAspects?: string[];
	forms?: Array<{ displayForm: string; unlockForms?: string[] }>;
	variations?: unknown[];
}

export function emitDex(): { dexes: number; entries: number } {
	const dexes: DexJson[] = walk(`${DATA}/cobblemon/dexes`, (n) => n.endsWith(".json")).map((f) => {
		const j = readJson(f);
		const out: DexJson = { id: j.id, type: j.type, sortOrder: j.sortOrder ?? 0 };
		if (Array.isArray(j.entries)) out.entries = [...j.entries];
		if (Array.isArray(j.subDexIds)) out.subDexIds = [...j.subDexIds];
		if (j.squash !== undefined) out.squash = j.squash;
		return out;
	});
	// dex_additions: entradas (Pokédex simples) ou sub-Pokédex (agregadas).
	for (const f of walk(`${DATA}/cobblemon/dex_additions`, (n) => n.endsWith(".json"))) {
		const add = readJson(f);
		const dex = dexes.find((d) => d.id === add.dexId);
		if (!dex) continue;
		const list = dex.subDexIds ? dex.subDexIds : (dex.entries ??= []);
		for (const e of add.entries ?? []) if (!list.includes(e)) list.push(e);
	}
	const entries = new Map<string, DexEntryJson>();
	for (const f of walk(`${DATA}/cobblemon/dex_entries`, (n) => n.endsWith(".json"))) {
		const j = readJson(f);
		entries.set(j.id, { id: j.id, speciesId: j.speciesId, displayAspects: j.displayAspects ?? [], conditionAspects: j.conditionAspects ?? [], forms: j.forms ?? [], variations: j.variations ?? [] });
	}
	// dex_entry_additions: formas (mesclando unlockForms quando a displayForm já existe) e variações.
	for (const f of walk(`${DATA}/cobblemon/dex_entry_additions`, (n) => n.endsWith(".json"))) {
		const add = readJson(f);
		const entry = entries.get(add.entryId);
		if (!entry) continue;
		for (const form of add.forms ?? []) {
			const existing = entry.forms!.find((x) => x.displayForm === form.displayForm);
			if (existing) existing.unlockForms = [...new Set([...(existing.unlockForms ?? []), ...(form.unlockForms ?? [])])];
			else entry.forms!.push(form);
		}
		entry.variations!.push(...(add.variations ?? []));
	}
	dexes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id));
	const entryList = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
	writeText(
		`${OUT_SCRIPTS}/dex.ts`,
		`// Arquivo gerado por tools/importer (npm run import). Não edite à mão.
/* eslint-disable */

/** Pokédex do Cobblemon (data/cobblemon/dexes + dex_additions). Mesmo formato de CobblemonDexJson. */
export interface DexJson {
	id: string;
	type?: string;
	sortOrder?: number;
	entries?: string[];
	subDexIds?: string[];
	squash?: boolean;
}

/** Entrada de Pokédex (data/cobblemon/dex_entries + dex_entry_additions). Mesmo formato de CobblemonDexEntryJson. */
export interface DexEntryJson {
	id: string;
	speciesId: string;
	displayAspects?: string[];
	conditionAspects?: string[];
	forms?: { displayForm: string; unlockForms?: string[] }[];
	variations?: unknown[];
}

export const DEXES: DexJson[] = ${JSON.stringify(dexes)};

/** Entradas (JSON em string: parse único e rápido na carga do módulo, ~1 100 entradas). */
export const DEX_ENTRIES: DexEntryJson[] = JSON.parse(${JSON.stringify(JSON.stringify(entryList))});
`,
	);
	count("Pokédex", dexes.length);
	count("entradas de Pokédex", entryList.length);
	return { dexes: dexes.length, entries: entryList.length };
}
