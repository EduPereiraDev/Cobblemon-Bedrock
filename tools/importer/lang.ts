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

/** Bolas usadas nas varas (item.cobblemon.<bola>_rod), na ordem do registro do Cobblemon. */
const ROD_BALLS = [
	"azure", "beast", "cherish", "citrine", "dive", "dream", "dusk", "fast", "friend", "great", "heal", "heavy", "level",
	"love", "lure", "luxury", "master", "moon", "nest", "net", "park", "premier", "quick", "repeat", "roseate", "safari",
	"slate", "sport", "timer", "ultra", "verdant",
	"ancient_azure", "ancient_citrine", "ancient_feather", "ancient_gigaton", "ancient_great", "ancient_heavy",
	"ancient_ivory", "ancient_jet", "ancient_leaden", "ancient_origin", "ancient_poke", "ancient_roseate", "ancient_slate",
	"ancient_ultra", "ancient_verdant", "ancient_wing",
];
const MINTS = ["red", "blue", "cyan", "pink", "green", "white"];

/**
 * Nomes que o lang do Cobblemon 1.8.2 não traz mas que os itens gerados usam (senão o jogo mostra a chave crua,
 * ex.: "item.cobblemon.great_rod"): varas pelas bolas, sementes de menta pelo bloco (o Java usa o nome do bloco no
 * ItemNameBlockItem) e itens feitos à mão no port. Só preenche o que faltar.
 */
function derivedNames(data: Record<string, string>, english: Record<string, string>, bedrock: string): Record<string, string> {
	const pt = bedrock === "pt_BR";
	const out: Record<string, string> = {};
	const has = (k: string) => k in data;
	for (const ball of ROD_BALLS) {
		const key = `item.cobblemon.${ball}_rod`;
		if (has(key)) continue;
		const ballName = data[`item.cobblemon.${ball}_ball`] ?? english[`item.cobblemon.${ball}_ball`];
		if (!ballName) continue;
		out[key] = pt ? `Vara (${ballName})` : ballName.replace(/\s*Ball$/i, "") + " Rod";
	}
	for (const mint of MINTS) {
		const key = `item.cobblemon.${mint}_mint_seeds`;
		const block = data[`block.cobblemon.${mint}_mint`] ?? english[`block.cobblemon.${mint}_mint`];
		if (!has(key) && block) out[key] = block;
	}
	const manual: Record<string, [string, string]> = {
		"item.cobblemon.strange_ball": ["Strange Ball", "Bola Estranha"],
		"item.cobblemon.pokemon_model": ["Pokémon Model", "Modelo de Pokémon"],
	};
	for (const [key, [en, ptName]] of Object.entries(manual)) if (!has(key)) out[key] = pt ? ptName : en;
	return out;
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
		for (const [key, value] of Object.entries(derivedNames(data, english, bedrock))) lines.push(`${key}=${clean(value)}`);
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
