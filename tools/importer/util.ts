// Utilitários compartilhados do importador: caminhos, leitura tolerante de JSON, escrita e relatório.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PACK = "CobblemonBedrock";
// COBBLEMON_UPSTREAM: cópia com os resource packs embutidos por cima (tools/importer/embeddedPacks.ts, frente dados-ui).
export const UPSTREAM = process.env.COBBLEMON_UPSTREAM || join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources");
export const ASSETS = join(UPSTREAM, "assets", "cobblemon");
export const DATA = join(UPSTREAM, "data");
export const BEDROCK_POKEMON = join(ASSETS, "bedrock", "pokemon");
/**
 * Destino final. O import escreve numa pasta temporária e troca no fim (várias frentes rodam em paralelo).
 * COBBLEMON_IMPORT_TARGET (frente msd-infra): pasta própria, sem troca — o import do Mega Showdown
 * (tools/importer/megaShowdown.ts) roda num processo filho com ela, e o validador do MSD lê a árvore efetiva por ela.
 */
export const OUT_FINAL = process.env.COBBLEMON_IMPORT_TARGET || join(ROOT, "generated");
// Só o import (`npm run import` define COBBLEMON_IMPORT_TMP=1) escreve na pasta temporária; validate e
// outras ferramentas leem a pasta final.
export const OUT = process.env.COBBLEMON_IMPORT_TMP === "1" && !process.env.COBBLEMON_IMPORT_TARGET ? join(ROOT, `generated.tmp-${process.pid}`) : OUT_FINAL;
export const OUT_RP = join(OUT, "resource_packs", PACK);
export const OUT_BP = join(OUT, "behavior_packs", PACK);
export const OUT_SCRIPTS = join(OUT, "scripts");
export const HAND_RP = join(ROOT, "resource_packs", PACK);
export const HAND_BP = join(ROOT, "behavior_packs", PACK);

/** Remove BOM, comentários e vírgulas sobrando antes de parsear (o Gson do Cobblemon é leniente). */
export function parseLenient(text: string): any {
	const clean = text.replace(/^﻿/, "");
	try {
		return JSON.parse(clean);
	} catch {
		// Remove comentários fora de strings e vírgulas finais.
		let out = "";
		let inStr = false;
		for (let i = 0; i < clean.length; i++) {
			const ch = clean[i];
			if (inStr) {
				out += ch;
				if (ch === "\\") {
					out += clean[++i] ?? "";
				} else if (ch === "\"") inStr = false;
				continue;
			}
			if (ch === "\"") {
				inStr = true;
				out += ch;
			} else if (ch === "/" && clean[i + 1] === "/") {
				while (i < clean.length && clean[i] !== "\n") i++;
				out += "\n";
			} else if (ch === "/" && clean[i + 1] === "*") {
				i += 2;
				while (i < clean.length && !(clean[i] === "*" && clean[i + 1] === "/")) i++;
				i++;
			} else out += ch;
		}
		return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
	}
}

export function readJson(file: string): any {
	return parseLenient(readFileSync(file, "utf8"));
}

export function tryReadJson(file: string): any {
	try {
		return readJson(file);
	} catch {
		return undefined;
	}
}

/** Lista arquivos recursivamente (caminhos absolutos, ordenados como o ResourceManager do Minecraft). */
export function walk(dir: string, filter: (name: string) => boolean = () => true): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) return out;
	const rec = (d: string) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, entry.name);
			// Pastas por link simbólico (cópia com os packs embutidos, tools/importer/embeddedPacks.ts) também contam.
			if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(p).isDirectory())) rec(p);
			else if (filter(entry.name)) out.push(p);
		}
	};
	rec(dir);
	return out.sort();
}

let bytesWritten = 0;
let filesWritten = 0;

export function writeText(file: string, text: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text);
	bytesWritten += Buffer.byteLength(text);
	filesWritten++;
}

/** JSON minificado (Bedrock aceita) para reduzir o tamanho do pack. */
export function writeJson(file: string, data: unknown): void {
	writeText(file, JSON.stringify(data));
}

export function copyFile(from: string, to: string): void {
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
	bytesWritten += statSync(to).size;
	filesWritten++;
}

export function writeStats(): { files: number; bytes: number } {
	return { files: filesWritten, bytes: bytesWritten };
}

export function rel(p: string): string {
	return relative(ROOT, p);
}

/** Converte "cobblemon:pokemon/x" → { ns: "cobblemon", path: "pokemon/x" }. */
export function splitId(id: string, defaultNs = "cobblemon"): { ns: string; path: string } {
	const i = id.indexOf(":");
	return i < 0 ? { ns: defaultNs, path: id } : { ns: id.slice(0, i), path: id.slice(i + 1) };
}

/** Nome seguro para variáveis Molang e chaves curtas. */
export function safeName(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------------------------
// Relatório de importação

export interface Report {
	startedAt: string;
	durationMs: number;
	filters: { species?: string[]; gens?: string[] };
	counts: Record<string, number>;
	skippedSpecies: Array<{ species: string; reason: string }>;
	unconvertedMolang: Record<string, { count: number; example: string }>;
	animationParseFailures: Array<{ file: string; error: string }>;
	warnings: Record<string, { count: number; examples: string[] }>;
	output: { files: number; bytes: number };
}

export const report: Report = {
	startedAt: new Date().toISOString(),
	durationMs: 0,
	filters: {},
	counts: {},
	skippedSpecies: [],
	unconvertedMolang: {},
	animationParseFailures: [],
	warnings: {},
	output: { files: 0, bytes: 0 },
};

export function count(key: string, n = 1): void {
	report.counts[key] = (report.counts[key] ?? 0) + n;
}

/** Agrupa avisos por categoria, guardando só alguns exemplos. */
export function warn(category: string, example: string): void {
	const w = (report.warnings[category] ??= { count: 0, examples: [] });
	w.count++;
	if (w.examples.length < 12 && !w.examples.includes(example)) w.examples.push(example);
}

export function unconverted(fn: string, example: string): void {
	const u = (report.unconvertedMolang[fn] ??= { count: 0, example });
	u.count++;
}
