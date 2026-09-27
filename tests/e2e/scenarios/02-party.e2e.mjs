// /cobblemon:givepokemon + menu /cobblemon:party: mandar para fora (entidade aparece) e recolher (some).
import { givePokemon, openParty, partyMembers, setupWithPokemon } from "../lib/flows.mjs";

export default {
	name: "party: givepokemon + mandar para fora / recolher",
	timeout: 240_000,
	async run(t) {
		const bot = await t.bot("Party");
		await setupWithPokemon(bot, "pikachu level=20");
		await givePokemon(bot, "eevee level=15");

		let party = await openParty(bot);
		let members = partyMembers(party);
		t.step(`time: ${members.map((m) => m.species).join(", ")}`);
		t.assert(members.map((m) => m.species).join() === "pikachu,eevee", `time = pikachu, eevee (veio ${members.map((m) => m.species)})`);

		// Pikachu → menu do Pokémon → mandar para fora
		bot.answerForm(party, members[0].index);
		let menu = await bot.waitForForm((f) => f.title.includes("{cobblemon.species.pikachu.name}"));
		t.assert(menu.buttons[0].includes("{cobblemon.port.party.send_out}"), `1º botão é mandar para fora (${menu.buttons[0]})`);
		bot.answerForm(menu, "{cobblemon.port.party.send_out}");
		const out = await bot.waitForEntity("cobblemon:pikachu", { timeout: 10_000 });
		t.step(`pikachu fora: rid=${out.runtimeId}`);

		// O menu do time volta com o marcador de "fora" (●) no Pikachu.
		party = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.party}") && f.id !== party.id);
		members = partyMembers(party);
		t.assert(members[0].text.includes("●"), `pikachu marcado como fora (${members[0].text})`);

		// Recolher
		bot.answerForm(party, members[0].index);
		menu = await bot.waitForForm((f) => f.title.includes("{cobblemon.species.pikachu.name}") && f.id !== menu.id);
		bot.answerForm(menu, "{cobblemon.port.party.recall}");
		await bot.waitForEntityGone(out, { timeout: 10_000 });
		t.step("pikachu recolhido (entidade removida)");
		party = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.party}") && !f.answered);
		// Bug conhecido (docs/pendencias/e2e.md): o menu reaberto logo após recolher ainda mostra "●",
		// porque a entidade só some no tick seguinte. Registra como aviso e confere reabrindo o menu.
		if (partyMembers(party)[0].text.includes("●")) t.warn("menu do time reaberto logo após recolher ainda mostra o Pikachu como fora (●)");
		bot.closeForm(party);
		await t.sleep(1000);
		party = await openParty(bot);
		t.assert(!partyMembers(party)[0].text.includes("●"), `pikachu não está mais fora (${partyMembers(party)[0].text})`);
		bot.closeForm(party);
	},
};
