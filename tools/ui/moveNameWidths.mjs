// Frente msd-beta (prints do 1º teste no cliente: nomes de golpe cortados no tile, "Dança das", "Devastação de"):
// largura de cada nome de golpe nos .lang dos resource packs JÁ MESCLADOS em dist/ (o que vai para o mundo), para o
// script decidir se o nome cabe numa linha do tile (scripts/GUI/moveNameWidths.ts, stub; layoutSpec.ts, MOVE_NAME).
// O plugin do esbuild troca o conteúdo do stub pelos dados. Lê todos os RPs de dist/: o build público só tem o base;
// um build com extensões leva os nomes delas também (sem nenhum nome fixo aqui).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { textWidth } from "./layoutScene.mjs";

/** Só entram os nomes a partir desta largura (px, escala 1): os curtos nunca passam da linha, nem com "Z-". */
export const MIN_TRACKED_WIDTH = 60;

/** `cobblemon.move.<id>` → maior largura entre os .lang de `dist/resource_packs/*` (id sem o prefixo). */
export function readMoveNameWidths(dist) {
	const out = {};
	const rps = join(dist, "resource_packs");
	if (!existsSync(rps)) return out;
	for (const pack of readdirSync(rps, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
		const texts = join(rps, pack, "texts");
		if (!existsSync(texts)) continue;
		for (const file of readdirSync(texts).filter((f) => f.endsWith(".lang")).sort()) {
			for (const line of readFileSync(join(texts, file), "utf8").split(/\r?\n/)) {
				const m = /^cobblemon\.move\.([a-z0-9_]+)=(.*)$/.exec(line);
				if (!m) continue;
				const text = m[2].replace(/\t#.*$/, "");
				const width = Math.ceil(textWidth(text));
				if (width >= MIN_TRACKED_WIDTH && width > (out[m[1]] ?? 0)) out[m[1]] = width;
			}
		}
	}
	return out;
}

export function moveNameWidthsSource(widths) {
	const sorted = Object.fromEntries(Object.entries(widths).sort(([a], [b]) => a.localeCompare(b)));
	return [
		"// Gerado no build por tools/ui/moveNameWidths.mjs (larguras dos nomes de golpe nos .lang de dist/). Não editar.",
		`export const MOVE_NAME_WIDTHS: Readonly<Record<string, number>> = ${JSON.stringify(sorted)};`,
		"export const MOVE_NAME_WIDTHS_BUILT: boolean = true;",
		"",
	].join("\n");
}

export function moveNameWidthsPlugin({ dist }) {
	return {
		name: "move-name-widths",
		setup(b) {
			b.onLoad({ filter: /[\\/]scripts[\\/]GUI[\\/]moveNameWidths\.ts$/ }, () => {
				const widths = readMoveNameWidths(dist);
				if (!Object.keys(widths).length) return undefined;
				return { contents: moveNameWidthsSource(widths), loader: "ts" };
			});
		},
	};
}
