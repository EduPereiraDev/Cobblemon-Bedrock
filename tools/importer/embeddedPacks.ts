// Resource packs embutidos do Cobblemon 1.8.2 (`resources/resourcepacks/*`, registrados em Cobblemon.builtinPacks):
//   gyaradosjump      Gyarados com os padrões do Magikarp Jump          DEFAULT_ENABLED → entra no import
//   regionbiasforms   formas "viés regional" (iniciais Hisui, Cubone...)  DEFAULT_ENABLED → entra no import
//   uniqueshinyforms  shiny próprios dos padrões do Magikarp Jump         NORMAL (desligado) → só com COBBLEMON_PACKS
//   adorncompatibility modelos para o mod Adorn                           precisa do mod → nunca
//
// O Bedrock não troca pacote de recurso de cliente em tempo de jogo, então os ligados por padrão são "assados" no
// import: este módulo monta uma cópia da pasta `resources` do upstream (hardlinks, sem copiar bytes) com os `assets/`
// dos packs por cima, na ordem de prioridade do Minecraft (o pack vence o mod; `sounds.json` é mesclado por evento,
// como o SoundManager faz), e roda o importador apontando `COBBLEMON_UPSTREAM` para ela.
//
//   node --experimental-strip-types tools/importer/embeddedPacks.ts [argumentos do import]
//   COBBLEMON_PACKS=gyaradosjump,regionbiasforms,uniqueshinyforms   escolhe os packs (vazio = nenhum)
//
// Frente dados-ui (docs/pendencias/dados-ui.md).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BASE_RESOURCES = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources");
export const PACKS_DIR = join(BASE_RESOURCES, "resourcepacks");

/** Cobblemon.builtinPacks (id, ativação). `neededMods` = nunca no Bedrock. */
export const BUILTIN_PACKS: { id: string; activation: "DEFAULT_ENABLED" | "NORMAL" | "ALWAYS_ENABLED"; neededMods?: string[] }[] = [
	{ id: "adorncompatibility", activation: "ALWAYS_ENABLED", neededMods: ["adorn"] },
	{ id: "gyaradosjump", activation: "DEFAULT_ENABLED" },
	{ id: "regionbiasforms", activation: "DEFAULT_ENABLED" },
	{ id: "uniqueshinyforms", activation: "NORMAL" },
];

/** Packs ligados: `COBBLEMON_PACKS` (lista separada por vírgula) ou os DEFAULT/ALWAYS sem mod exigido. */
export function enabledPacks(env: string | undefined = process.env.COBBLEMON_PACKS): string[] {
	const known = BUILTIN_PACKS.filter((p) => !p.neededMods?.length);
	if (env !== undefined) {
		const wanted = env.split(",").map((s) => s.trim()).filter(Boolean);
		return known.filter((p) => wanted.includes(p.id)).map((p) => p.id);
	}
	return known.filter((p) => p.activation !== "NORMAL").map((p) => p.id);
}

function listFiles(dir: string, base = dir): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(p, base));
		else if (entry.isFile()) out.push(relative(base, p));
	}
	return out;
}

/** SoundManager: cada evento do pack substitui (`replace: true`) ou soma os sons ao do mod. */
export function mergeSounds(base: Record<string, any>, pack: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = { ...base };
	for (const [event, value] of Object.entries(pack)) {
		const current = out[event];
		if (!current || value?.replace === true) { out[event] = value; continue; }
		out[event] = { ...current, ...value, sounds: [...(current.sounds ?? []), ...(value.sounds ?? [])] };
	}
	return out;
}

function readJson(path: string): any {
	try { return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")); }
	catch { return {}; }
}

export interface OverlayResult { target: string; packs: string[]; overridden: string[]; added: string[] }

/**
 * Monta `target` = resources do upstream + `assets/` dos packs (na ordem dada: o último vence). Só as pastas que um
 * pack toca viram pastas de verdade; o resto são links simbólicos para o upstream (`walk` do importador segue links).
 * `resourcepacks/` não entra.
 */
export function buildOverlay(packs: string[], target: string): OverlayResult {
	rmSync(target, { recursive: true, force: true });
	const real = new Set<string>();
	/** Pasta `rel` como pasta de verdade, com links para o conteúdo do upstream. */
	const materialize = (rel: string) => {
		if (real.has(rel)) return;
		if (rel !== "") materialize(dirname(rel) === "." ? "" : dirname(rel));
		const dest = join(target, rel);
		if (existsSync(dest) || isLink(dest)) rmSync(dest, { recursive: true, force: true });
		mkdirSync(dest, { recursive: true });
		const base = join(BASE_RESOURCES, rel);
		if (existsSync(base)) {
			for (const entry of readdirSync(base, { withFileTypes: true })) {
				if (rel === "" && entry.name === "resourcepacks") continue;
				symlinkSync(join(base, entry.name), join(dest, entry.name), entry.isDirectory() ? "dir" : "file");
			}
		}
		real.add(rel);
	};
	materialize("");
	const overridden: string[] = [];
	const added: string[] = [];
	for (const pack of packs) {
		const assets = join(PACKS_DIR, pack, "assets");
		for (const relFile of listFiles(assets)) {
			const rel = join("assets", relFile);
			const parent = dirname(rel);
			materialize(parent === "." ? "" : parent);
			const dest = join(target, rel);
			const src = join(assets, relFile);
			const exists = existsSync(dest);
			if (relFile.replace(/\\/g, "/").endsWith("sounds.json") && exists) {
				const merged = mergeSounds(readJson(dest), readJson(src));
				rmSync(dest);
				writeFileSync(dest, JSON.stringify(merged, null, 2));
				overridden.push(`${pack}:${relFile}`);
				continue;
			}
			(exists ? overridden : added).push(`${pack}:${relFile}`);
			if (exists || isLink(dest)) rmSync(dest, { force: true });
			try { symlinkSync(src, dest, "file"); } catch { copyFileSync(src, dest); }
		}
	}
	return { target, packs, overridden, added };
}

function isLink(path: string): boolean {
	try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

// CLI: monta a cópia e roda o importador nela.
// Só como CLI (não quando empacotado nos testes, onde import.meta.url é o bundle).
if (import.meta.url.endsWith("/embeddedPacks.ts") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const packs = enabledPacks();
	const started = Date.now();
	if (packs.length) {
		// <tmp>/main/resources + <tmp>/main/kotlin (link): quem sobe de UPSTREAM para o kotlin (structures.ts) continua achando.
		const main = join(tmpdir(), `cobblemon-upstream-${process.pid}`, "main");
		const target = join(main, "resources");
		const result = buildOverlay(packs, target);
		try { symlinkSync(join(BASE_RESOURCES, "..", "kotlin"), join(main, "kotlin"), "dir"); } catch { }
		console.log(`packs embutidos: ${packs.join(", ")} (${result.added.length} arquivos novos, ${result.overridden.length} substituídos) em ${Date.now() - started}ms`);
		process.env.COBBLEMON_UPSTREAM = target;
		const cleanup = () => { try { rmSync(dirname(main), { recursive: true, force: true }); } catch { } };
		process.on("exit", cleanup);
	}
	else console.log("packs embutidos: nenhum");
	// URL montada: o esbuild dos testes não tenta empacotar o importador inteiro.
	await import(new URL("./index.ts", import.meta.url).href);
}
