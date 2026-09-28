// Batalha selvagem: interagir com um Pokémon selvagem abre os forms de batalha; "Lutar" → golpe
// até a batalha acabar com vitória.
import { arena, killAround, setupWithPokemon, spawnWild, waitForFormOrText } from "../lib/flows.mjs";

// O título leva marcadores de layout do JSON UI (ex.: "§0§2§r"): reconhece pelos botões.
const isActionForm = (f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.battle.ui.bag}"));
const isMoveForm = (f) => f.kind === "action" && f.title.includes("{cobblemon.battle.ui.fight}") && f.buttons.some((b) => b.includes("{cobblemon.move."));

export default {
	name: "batalha selvagem: interagir → Lutar → golpes até vencer",
	timeout: 300_000,
	async run(t) {
		const bot = await t.bot("Battle");
		await setupWithPokemon(bot, "mewtwo level=100");
		await arena(bot, { dx: 40, dz: 24 });
		const wild = await spawnWild(bot, "rattata", { level: 2, offset: "~2 ~ ~" });
		t.step(`rattata selvagem rid=${wild.runtimeId}`);

		const start = bot.mark();
		bot.interact(wild);
		let turns = 0;
		let form = await bot.waitForForm(isActionForm, { timeout: 30_000 });
		t.step(`form de ação: ${form.buttons.join(" | ")}`);
		t.assert(form.buttons[0].includes("{cobblemon.battle.ui.fight}"), "1º botão é Lutar");
		t.assert(form.buttons.some((b) => b.includes("{cobblemon.battle.ui.run}")), "tem Fugir (selvagem)");

		while (true) {
			turns++;
			if (turns > 12) throw new Error("a batalha não acabou em 12 turnos");
			bot.answerForm(form, "{cobblemon.battle.ui.fight}");
			const moves = await bot.waitForForm(isMoveForm, { timeout: 20_000 });
			const usable = moves.buttons.findIndex((b) => !b.includes("{gui.back}") && !b.startsWith("§8"));
			// Frente ui-layout: o tile tem 3 linhas (PP, dica, nome); o nome é a última.
			t.step(`turno ${turns}: golpe ${moves.buttons[usable]?.split("\n").pop()}`);
			bot.answerForm(moves, usable);
			const next = await waitForFormOrText(bot, { form: isActionForm, text: "{cobblemon.battle.win}", since: start, timeout: 60_000 });
			if (next.text) { t.step(`fim: ${next.text.text}`); break; }
			form = next.form;
		}
		t.assert(bot.texts.slice(start.text).some((x) => x.text.includes("{cobblemon.battle.win}")), "mensagem de vitória");
		// O selvagem desmaiado some.
		await bot.waitForEntityGone(wild, { timeout: 20_000 }).catch(() => t.warn("o Rattata derrotado não sumiu em 20 s"));
		await killAround(bot, "cobblemon:rattata");
	},
};
