// lang/*.json do Cobblemon → texts/*.lang do Bedrock (chave=valor), mais os nomes de entidade
// (entity.cobblemon:<id>.name) exigidos pelo Bedrock.
import { existsSync } from "node:fs";
import { ASSETS, OUT_RP, readJson, writeJson, writeText } from "./util.ts";

const LANGS: Array<{ bedrock: string; cobblemon: string }> = [
	{ bedrock: "en_US", cobblemon: "en_us" },
	{ bedrock: "pt_BR", cobblemon: "pt_br" },
];

/** Textos extras usados pelas entidades geradas. */
const EXTRA: Record<string, Record<string, string>> = {
	en_US: { "cobblemon.ui.interact": "Interact" },
	pt_BR: { "cobblemon.ui.interact": "Interagir" },
};

function clean(value: string): string {
	// .lang é uma linha por chave; quebras viram "\n" literal e tabulações viram espaço.
	return String(value).replace(/\r?\n/g, "\\n").replace(/\t/g, " ");
}

export function emitLang(species: Array<{ id: string; name: string }>): Record<string, number> {
	const counts: Record<string, number> = {};
	const english: Record<string, string> = readJson(`${ASSETS}/lang/en_us.json`);
	for (const { bedrock, cobblemon } of LANGS) {
		const file = `${ASSETS}/lang/${cobblemon}.json`;
		const data: Record<string, string> = existsSync(file) ? readJson(file) : {};
		const lines: string[] = [];
		for (const [key, value] of Object.entries(data)) {
			if (typeof value === "string") lines.push(`${key}=${clean(value)}`);
		}
		for (const [key, value] of Object.entries(EXTRA[bedrock] ?? {})) {
			if (!(key in data)) lines.push(`${key}=${value}`);
		}
		for (const s of species) {
			const name = data[`cobblemon.species.${s.id}.name`] ?? english[`cobblemon.species.${s.id}.name`] ?? s.name;
			lines.push(`entity.cobblemon:${s.id}.name=${clean(name)}`);
		}
		writeText(`${OUT_RP}/texts/${bedrock}.lang`, `${lines.join("\n")}\n`);
		counts[bedrock] = lines.length;
	}
	writeJson(`${OUT_RP}/texts/languages.json`, LANGS.map((l) => l.bedrock));
	return counts;
}
