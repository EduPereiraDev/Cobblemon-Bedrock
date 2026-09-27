// PC: navegar entre caixas (<< >>), "ir para caixa" (ModalForm com slider), guardar um Pokémon pelo
// menu do time e tirar de volta pelo PC.
import { boxMembers, givePokemon, openParty, partyMembers, setupWithPokemon } from "../lib/flows.mjs";

const pcBox = (n) => (f) => f.kind === "action" && f.title.includes("PC - ") && f.title.includes(`{cobblemon.ui.pc.box.title}(${n})`);
const pcSprite = (form, species) => boxMembers(form).find((m) => m.species === species)?.index ?? -1;

export default {
	name: "PC: navegação entre caixas, ir para caixa, guardar e retirar",
	timeout: 240_000,
	async run(t) {
		const bot = await t.bot("PC");
		await setupWithPokemon(bot, "pikachu level=10");
		await givePokemon(bot, "eevee level=10");

		await bot.command("cobblemon:pc");
		let box = await bot.waitForForm(pcBox(1));
		t.assert(box.buttons[0] === "<<" && box.buttons[2] === ">>", `navegação << >> (${box.buttons.slice(0, 3)})`);
		t.assert(box.buttons.length >= 36, `6 botões de navegação + 30 espaços (veio ${box.buttons.length})`);
		bot.answerForm(box, (b) => b === ">>");
		box = await bot.waitForForm(pcBox(2));
		bot.answerForm(box, (b) => b === "<<");
		box = await bot.waitForForm(pcBox(1));
		t.step("caixa 1 → 2 → 1");

		// Menu da caixa (botão com o nome da caixa) → ir para caixa 3 (slider)
		bot.answerForm(box, (b) => b === "{cobblemon.ui.pc.box.title}(1)");
		const menu = await bot.waitForForm((f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.pc.goto}")));
		bot.answerForm(menu, "{cobblemon.port.pc.goto}");
		const goto = await bot.waitForForm((f) => f.kind === "modal");
		t.assert(goto.elements[0]?.type === "slider", `ir para caixa é um slider (${JSON.stringify(goto.elements)})`);
		bot.answerForm(goto, [3]);
		box = await bot.waitForForm(pcBox(3));
		t.step("ir para caixa 3 ok");
		bot.closeForm(box);

		// Guardar o Eevee pelo menu do time
		let party = await openParty(bot);
		const eevee = partyMembers(party).find((m) => m.species === "eevee");
		bot.answerForm(party, eevee.index);
		const eeveeMenu = await bot.waitForForm((f) => f.title.includes("{cobblemon.species.eevee.name}"));
		bot.answerForm(eeveeMenu, "{cobblemon.port.party.to_pc}");
		party = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.party}") && !f.answered);
		t.assert(partyMembers(party).map((m) => m.species).join() === "pikachu", `time só com pikachu (${partyMembers(party).map((m) => m.species)})`);

		// Botão PC do menu do time: reabre na última caixa vista (lastPcBoxViewed = 3, como no Cobblemon);
		// volta para a caixa 1, que tem o Eevee → retirar
		bot.answerForm(party, "PC");
		box = await bot.waitForForm(pcBox(3));
		t.step("PC reabriu na última caixa vista (3)");
		bot.answerForm(box, (b) => b === "<<");
		box = await bot.waitForForm(pcBox(2));
		bot.answerForm(box, (b) => b === "<<");
		box = await bot.waitForForm(pcBox(1));
		const idx = pcSprite(box, "eevee");
		t.assert(idx >= 6, `eevee está na caixa 1 (${boxMembers(box).map((m) => m.species)})`);
		t.step(`eevee no espaço ${idx - 6} da caixa 1`);
		bot.answerForm(box, idx);
		const slotMenu = await bot.waitForForm((f) => f.title.includes("{cobblemon.species.eevee.name}") && f.buttons.some((b) => b.includes("{cobblemon.port.pc.withdraw}")));
		bot.answerForm(slotMenu, "{cobblemon.port.pc.withdraw}");
		box = await bot.waitForForm((f) => pcBox(1)(f) && !f.answered);
		t.assert(pcSprite(box, "eevee") < 0, "eevee saiu da caixa");
		bot.closeForm(box);
		// Fechar o PC volta ao menu do time (que abriu o PC).
		party = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.party}") && !f.answered);
		t.assert(partyMembers(party).map((m) => m.species).join() === "pikachu,eevee", `eevee voltou ao time (${partyMembers(party).map((m) => m.species)})`);
		bot.closeForm(party);
	},
};
