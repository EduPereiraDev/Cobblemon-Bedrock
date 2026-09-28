// Frente ui-layout: dados reais das telas roteadas para a prévia (tools/ui/preview.mjs) e para a checagem de layout
// (tests/ui-layout.test.ts). Cada tela é montada pelo MESMO código do jogo (Summary, StarterGUI, PC, PokedexUI e o menu
// da batalha rodando uma batalha de verdade no mundo falso dos testes) com a API do Minecraft trocada pelos mocks
// (tests/mocks/). O form mostrado é gravado (título, corpo, botões) e os textos são traduzidos com o .lang.
//
// Só roda empacotado com os mocks (esbuild com alias de @minecraft/server e @minecraft/server-ui).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawMessage } from "@minecraft/server";
import { formHooks, formRecording } from "../../tests/mocks/minecraft-server-ui";
import type { RecordedForm } from "../../tests/mocks/minecraft-server-ui";
import { advance, advanceUntil, createPlayer, spawnWild } from "../../tests/batalhas-harness";
import { PokemonData } from "../../scripts/Pokemon";
import { Dex, toID } from "../../scripts/showdown";
import { buildSummaryForm } from "../../scripts/GUI/Summary";
import { buildStarterForm, getStarterCategories } from "../../scripts/GUI/StarterGUI";
import { openPCGui } from "../../scripts/GUI/PC";
import { openDexPage, openEntry } from "../../scripts/pokedex/PokedexUI";
import { getNationalEntry } from "../../scripts/pokedex/DexData";
import { markCaught, markSeen } from "../../scripts/pokedex/PokedexStorage";
import { startWildBattle } from "../../scripts/battle";
import { PCPlace, setPokemonToPCLocation } from "../../scripts/pokemonStorage";
import { BATTLE_SWITCH, BATTLE_TARGET, CellForm, SUB, layoutTitle } from "../../scripts/GUI/layout";
import { SCREEN } from "../../scripts/ui/screens";
import { getPokemonSpriteTexture } from "../../scripts/GUI/common";

export interface Fixture {
	/** Nome do arquivo da prévia. */
	name: string;
	/** Raiz roteada (o form passa por ui/cobblemon_forms.json como no cliente). */
	root: string;
	title: string;
	body: string;
	buttons: { text: string; icon?: string }[];
}

type Lang = Record<string, string>;

/** Lê os .lang do port (importado + próprio). */
export function loadLang(root: string, locale = "pt_BR"): Lang {
	const lang: Lang = {};
	for (const file of [
		join(root, "generated", "resource_packs", "CobblemonBedrock", "texts", `${locale}.lang`),
		join(root, "generated", "resource_packs", "CobblemonMegaShowdown", "texts", `${locale}.lang`),
		join(root, "resource_packs", "CobblemonBedrock", "texts", `${locale}.lang`),
	]) {
		if (!existsSync(file)) continue;
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq < 0) continue;
			lang[line.slice(0, eq)] = line.slice(eq + 1).replace(/\t#.*$/, "");
		}
	}
	return lang;
}

/** Texto final de um RawMessage (como o cliente mostra). */
export function resolveText(msg: unknown, lang: Lang): string {
	if (msg === undefined || msg === null) return "";
	if (typeof msg === "string") return msg;
	if (typeof msg !== "object") return String(msg);
	const m = msg as RawMessage;
	if (m.rawtext) return m.rawtext.map(x => resolveText(x, lang)).join("");
	if (m.text !== undefined) return m.text;
	if (m.translate) {
		const template = lang[m.translate] ?? m.translate;
		const withArgs = m.with;
		const args = Array.isArray(withArgs) ? withArgs.map(String) : withArgs && typeof withArgs === "object" && "rawtext" in withArgs
			? (withArgs.rawtext ?? []).map(x => resolveText(x, lang)) : [];
		let next = 0;
		return template.replace(/%(?:(\d+)\$)?([sd])|%%/g, (all, pos) => all === "%%" ? "%" : (pos ? args[Number(pos) - 1] : args[next++]) ?? "");
	}
	return "";
}

function fromRecorded(name: string, form: RecordedForm, lang: Lang): Fixture {
	const arg = (call: string) => form.calls.find(([n]) => n === call)?.[1][0];
	return {
		name,
		root: "cobblemon_forms.router",
		title: resolveText(arg("title"), lang),
		body: resolveText(arg("body"), lang),
		buttons: form.calls.filter(([n]) => n === "button").map(([, args]) => ({ text: resolveText(args[0], lang), icon: args[1] as string | undefined })),
	};
}

/** Grava o form que `build()` monta. */
function record(build: () => unknown): RecordedForm {
	formRecording.enabled = true;
	formRecording.forms.length = 0;
	build();
	const form = formRecording.forms[formRecording.forms.length - 1];
	formRecording.enabled = false;
	return form;
}

/** Roda uma tela assíncrona e grava o 1º form mostrado (responde "fechado"). */
async function capture(open: () => Promise<unknown>): Promise<RecordedForm | undefined> {
	formRecording.enabled = true;
	formRecording.forms.length = 0;
	let shown: RecordedForm | undefined;
	formHooks.show = (_kind, form) => { shown ??= form; return { canceled: true, selection: undefined, cancelationReason: "UserClosed" }; };
	try { await open(); } catch { }
	formHooks.show = undefined;
	formRecording.enabled = false;
	return shown;
}

function pokemon(species: string, level: number, extra: Partial<PokemonData> = {}): PokemonData {
	const data = Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false }), extra);
	data.movesInfo = data.moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

/** Pikachu do print do usuário (Nv. 30, fêmea) e um time de 4. */
export function sampleTeam(): PokemonData[] {
	const pikachu = pokemon("pikachu", 30, { gender: "f" });
	pikachu.moves = ["thunderbolt", "quickattack", "irontail", "thunderwave"];
	pikachu.movesInfo = pikachu.moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	pikachu.marks = ["cobblemon:mark_curry", "cobblemon:mark_fishing", "cobblemon:mark_alpha"];
	pikachu.activeMark = "cobblemon:mark_curry";
	const bulbasaur = pokemon("bulbasaur", 9, { gender: "m", shiny: true });
	(bulbasaur as unknown as { status: string }).status = "par";
	return [pikachu, pokemon("charmander", 12, { gender: "m" }), bulbasaur, pokemon("squirtle", 7, { gender: "f" })];
}

export interface FixtureOptions { battle?: boolean; locale?: string }

/** Todas as telas. `battle` roda uma batalha selvagem de verdade no mundo falso (alguns segundos). */
export async function buildFixtures(root: string, options: FixtureOptions = {}): Promise<Fixture[]> {
	const lang = loadLang(root, options.locale);
	const out: Fixture[] = [];
	const team = sampleTeam();
	const [pikachu] = team;

	// Inicial: Kanto, Charmander (o print do usuário).
	const categories = getStarterCategories();
	out.push(fromRecorded("starter", record(() => buildStarterForm(categories, { category: 0, position: 1, page: 0, studio: false, studioToggle: true }).build()), lang));
	out.push(fromRecorded("starter-3d", record(() => buildStarterForm(categories, { category: 0, position: 0, page: 0, studio: true, studioToggle: true }).build()), lang));

	// Resumo: 4 abas com o time; a aba Info também no estúdio e fora do time (Pokémon do PC).
	for (const tab of ["info", "moves", "stats", "marks"] as const) {
		out.push(fromRecorded(`summary-${tab}`, record(() => buildSummaryForm(pikachu, { tab, studio: false, studioToggle: true, party: [...team, null, null] }).build()), lang));
	}
	out.push(fromRecorded("summary-info-3d", record(() => buildSummaryForm(pikachu, { tab: "info", studio: true, studioToggle: true, party: [...team, null, null] }).build()), lang));
	out.push(fromRecorded("summary-pc", record(() => buildSummaryForm(team[2], { tab: "stats", studio: false, studioToggle: false }).build()), lang));

	// PC e Pokédex: jogador do mundo falso com o time.
	const player = createPlayer("Preview", team as never);
	// Caixa 1 com alguns Pokémon (o 3º fora do filtro não se aplica aqui: sem busca).
	["eevee", "magikarp", "gengar"].forEach((species, space) => {
		try { setPokemonToPCLocation(player as never, { location: PCPlace.Box, boxID: 0, space }, pokemon(species, 15 + space * 10)); } catch { }
	});
	const pc = await capture(() => openPCGui(player as never, 0));
	if (pc) out.push(fromRecorded("pc", pc, lang));
	markSeen(player as never, "bulbasaur");
	markCaught(player as never, pikachu);
	markSeen(player as never, "charmander");
	const list = await capture(() => openDexPage(player as never, "national", 0, "all"));
	if (list) out.push(fromRecorded("pokedex-list", list, lang));
	for (const [name, species] of [["pokedex-entry-caught", "pikachu"], ["pokedex-entry-seen", "charmander"], ["pokedex-entry-unknown", "raichu"]] as const) {
		const entry = getNationalEntry(species);
		if (!entry) continue;
		const form = await capture(() => openEntry(player as never, entry, "national"));
		if (form) out.push(fromRecorded(name, form, lang));
	}

	// Alvo (duplas): o mesmo formato de showTargetMenu (Battle.ts), com 2 inimigos e 1 aliado.
	const target = new CellForm(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_TARGET, { translate: "cobblemon.battle.select_target" }), BATTLE_TARGET.COUNT)
		.body({ translate: "cobblemon.move.thunderbolt" });
	[[team[3], false, 0], [team[2], false, 1], [team[1], true, 0]].forEach(([p, ally, i]) => {
		const data = p as PokemonData;
		target.cell((ally ? BATTLE_TARGET.ALLIES : BATTLE_TARGET.FOES) + (i as number), {
			rawtext: [{ text: ally ? "§9" : "§c" }, { translate: ally ? "cobblemon.port.battle.ui.ally" : "cobblemon.port.battle.ui.foe" }, { text: "§r\n" },
				data.getTranslatedName(), { text: "\n§772%" }],
		}, getPokemonSpriteTexture(data));
	});
	target.cell(BATTLE_TARGET.BACK, { translate: "gui.back" });
	out.push(fromRecorded("battle-target", record(() => target.build()), lang));

	if (options.battle) out.push(...await battleFixtures(lang));
	return out;
}

/** Menu da batalha de verdade: ação → troca (volta) → mochila (volta) → golpes → golpe 1. */
async function battleFixtures(lang: Lang): Promise<Fixture[]> {
	const out: Fixture[] = [];
	const team = sampleTeam();
	team[0].level = 60;
	const player = createPlayer("PreviewBattle", team as never);
	(player as any).container.slots[0] = { typeId: "cobblemon:potion", amount: 3 };
	(player as any).container.slots[1] = { typeId: "cobblemon:super_potion", amount: 2 };
	(player as any).container.slots[2] = { typeId: "cobblemon:full_heal", amount: 1 };
	(player as any).container.slots[3] = { typeId: "cobblemon:poke_ball", amount: 5 };
	const wild = spawnWild(pokemon("magikarp", 5));
	const seen = new Set<string>();
	let actions = 0;
	formRecording.enabled = true;
	formHooks.show = (_kind, form) => {
		const title = JSON.stringify(form?.calls.find(([n]) => n === "title")?.[1][0] ?? "");
		const take = (name: string) => { if (form && !seen.has(name)) { seen.add(name); out.push(fromRecorded(name, form, lang)); } };
		if (title.includes(SUB.BATTLE_ACTION)) {
			take("battle-action");
			const step = actions++;
			return { canceled: false, selection: step === 0 ? 2 : step === 1 ? 1 : 0 };
		}
		if (title.includes(SUB.BATTLE_SWITCH)) { take("battle-switch"); return { canceled: false, selection: BATTLE_SWITCH.BACK }; }
		if (title.includes(SUB.BATTLE_LIST)) {
			take("battle-bag");
			const buttons = form?.calls.filter(([n]) => n === "button").length ?? 1;
			return { canceled: false, selection: buttons - 1 };
		}
		if (title.includes(SUB.BATTLE_MOVES)) { take("battle-moves"); return { canceled: false, selection: 0 }; }
		return { canceled: true, selection: undefined, cancelationReason: "UserClosed" };
	};
	try {
		const battle = startWildBattle(player as never, wild as never);
		if (battle) {
			await advanceUntil(() => battle.ended || seen.has("battle-moves") && actions > 3, 200_000);
			await advance(40);
		}
	}
	finally {
		formHooks.show = undefined;
		formRecording.enabled = false;
	}
	return out;
}

/** Chave de tipo usada pelos tiles (para os testes). */
export const moveTypeOf = (move: string) => toID(Dex.moves.get(move).type);
