// Troca entre 2 bots: A pede (/cobblemon:trade B), B aceita (form), cada um oferece um Pokémon,
// os dois aceitam e os Pokémon trocam de dono.
import { openParty, partyMembers, setupWithPokemon } from "../lib/flows.mjs";

const tradeMenu = (f) => f.kind === "action" && f.title.includes("{cobblemon.ui.trade}") && f.buttons.some((b) => b.includes("{cobblemon.port.trade.choose}"));

/** Espera o menu de troca mais recente (cada atualização fecha e reabre o menu dos dois). */
async function latestMenu(bot, pred = () => true, timeout = 20_000) {
	return bot.waitUntil(() => {
		const open = bot.forms.filter((f) => !f.answered && tradeMenu(f));
		const last = open[open.length - 1];
		// Os menus antigos foram substituídos: marca como respondidos para não confundir.
		for (const f of open.slice(0, -1)) f.answered = true;
		return last && pred(last) ? last : undefined;
	}, timeout, "menu de troca");
}

async function offer(bot, species) {
	const menu = await latestMenu(bot);
	bot.answerForm(menu, "{cobblemon.port.trade.choose}");
	const choose = await bot.waitForForm((f) => f.kind === "action" && !f.answered && f.buttons.some((b) => b.includes(`{cobblemon.species.${species}.name}`)));
	bot.answerForm(choose, `{cobblemon.species.${species}.name}`);
}

export default {
	name: "troca entre 2 jogadores: pedido, aceite, ofertas e conclusão",
	timeout: 300_000,
	async run(t) {
		const a = await t.bot("TradeA");
		const b = await t.bot("TradeB");
		await setupWithPokemon(a, "bulbasaur level=10");
		await setupWithPokemon(b, "charmander level=10");
		// Juntos (a troca exige ≤ 12 blocos).
		await b.commandOk(`tp @s ${a.name}`);
		await b.queryPosition();
		await t.sleep(1000);

		const markA = a.mark();
		const markB = b.mark();
		await a.command(`cobblemon:trade ${b.name}`);
		const request = await b.waitForForm((f) => f.kind === "message" && f.title.includes("{cobblemon.ui.trade}"));
		t.step(`pedido: ${request.body} [${request.buttons.join(" | ")}]`);
		t.assert(request.buttons[0].includes("{cobblemon.ui.interact.accept}"), "botão 1 = aceitar");
		b.answerForm(request, 0);

		await latestMenu(a);
		await latestMenu(b);
		t.step("menus de troca abertos nos dois");
		// Uma oferta por vez: cada atualização fecha e reabre os menus dos dois (inclusive a tela de
		// escolha do outro jogador), então B só escolhe depois de ver a oferta de A.
		await offer(a, "bulbasaur");
		await latestMenu(b, (f) => /bulbasaur/.test(f.body));
		await offer(b, "charmander");
		// Com as duas ofertas aparece "Aceitar". Cada aceite reabre os menus dos dois, então cada bot
		// clica só no menu mais novo e só enquanto ainda não aceitou (o botão vira "Desfazer aceite").
		const both = (f) => /bulbasaur/.test(f.body) && /charmander/.test(f.body);
		await latestMenu(a, both);
		await latestMenu(b, both);
		const done = () => [markA, markB].every((m, i) => [a, b][i].texts.slice(m.text).some((x) => x.text.includes("{cobblemon.port.trade.completed}")));
		for (let round = 0; round < 12 && !done(); round++) {
			for (const bot of [a, b]) {
				const open = bot.forms.filter((f) => !f.answered && tradeMenu(f));
				const menu = open[open.length - 1];
				if (!menu || !both(menu)) continue;
				const i = menu.buttons.findIndex((x) => x.includes("{cobblemon.port.trade.accept}"));
				if (i < 0) continue; // já aceitou
				t.step(`${bot.name} aceita (form #${menu.id})`);
				bot.answerForm(menu, i);
				await t.sleep(1500);
			}
			await t.sleep(500);
		}

		await a.waitForText("{cobblemon.port.trade.completed}", { since: markA.text, timeout: 20_000 });
		await b.waitForText("{cobblemon.port.trade.completed}", { since: markB.text, timeout: 20_000 });
		t.step("troca concluída");
		for (const f of [...a.forms, ...b.forms]) if (!f.answered) f.answered = true;

		const partyA = partyMembers(await openParty(a)).map((m) => m.species);
		const partyB = partyMembers(await openParty(b)).map((m) => m.species);
		t.step(`A: ${partyA}  B: ${partyB}`);
		t.assert(partyA.join() === "charmander", `A ficou com o charmander (${partyA})`);
		t.assert(partyB.join() === "bulbasaur", `B ficou com o bulbasaur (${partyB})`);
	},
};
