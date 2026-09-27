// Primeiro login: a tela de iniciais abre sozinha; escolher Kanto → Bulbasaur → confirmar
// deixa exatamente 1 Pokémon no time (conferido pelo menu /cobblemon:party).
import { chooseStarter, openParty, partyMembers } from "../lib/flows.mjs";

export default {
	name: "starter: escolha no primeiro login → time com 1 Pokémon",
	timeout: 240_000,
	async run(t) {
		const bot = await t.bot("Starter");
		// Sem comando: a tela tem que abrir sozinha no primeiro login.
		const forms = await chooseStarter(bot, { category: "{cobblemon.starterselection.category.kanto}", species: "bulbasaur" });
		t.step(`telas: ${forms.map((f) => `${f.kind}[${f.buttons.length}]`).join(" → ")}`);
		const first = forms[0];
		t.assert(first.buttons.some((b) => b.includes("{cobblemon.starterselection.category.kanto}")), "a 1ª tela tem a categoria Kanto");
		t.assert(first.buttons.filter((b) => b.includes("{cobblemon.starterselection.category.")).length >= 2, "a 1ª tela tem várias categorias");
		const confirm = forms[forms.length - 1];
		t.assert(confirm.kind === "message" && confirm.buttons[1].includes("{cobblemon.ui.starter.choosebutton}"), `confirmação com "escolher" no botão 2 (${confirm.buttons})`);

		const party = await openParty(bot);
		const members = partyMembers(party);
		t.step(`time: ${JSON.stringify(members)}`);
		t.assert(members.length === 1, `time com 1 Pokémon (veio ${members.length})`);
		t.assert(members[0].species === "bulbasaur", `o inicial é bulbasaur (veio ${members[0].species})`);
		bot.closeForm(party);

		// De novo não pode: já escolheu.
		const mark = bot.mark();
		await bot.command("cobblemon:starter");
		await bot.waitForText("{cobblemon.ui.starter.alreadyselected}", { since: mark.text });
	},
};
