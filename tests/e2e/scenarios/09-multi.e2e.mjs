// Frente multi: 4 bots formam 2 equipes pelo menu de interação de jogador (interagir → "Formar grupo", o outro
// interage de volta e aceita), uma equipe desafia a outra para Batalha Multi com "Nível 50 para todos", um membro
// da equipe desafiada aceita pelo menu, a batalha 2×2 roda até o fim e depois todos abandonam a equipe.
import { arena, setupWithPokemon } from "../lib/flows.mjs";

const isInteractMenu = (target) => (f) => f.kind === "action" && !f.answered && f.title.includes(target.name)
	&& f.buttons.some((b) => b.includes("{cobblemon.ui.interact.trade}"));
const isBattleAction = (f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.battle.ui.bag}"));
const isMoveForm = (f) => f.kind === "action" && f.title.includes("{cobblemon.battle.ui.fight}") && f.buttons.some((b) => b.includes("{cobblemon.move."));

/** `bot` interage com `target` (jogador) e clica no botão do menu de interação. */
async function interactAndClick(t, bot, target, button) {
	const player = await bot.waitForEntity((e) => e.type === "minecraft:player" && e.name === target.name, { timeout: 15_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		bot.interact(player);
		try {
			const menu = await bot.waitForForm(isInteractMenu(target), { timeout: 8_000 });
			t.step(`${bot.name} → ${target.name}: [${menu.buttons.join(" | ")}]`);
			bot.answerForm(menu, button);
			return menu;
		}
		catch (e) {
			if (attempt === 2) throw e;
			t.warn(`${bot.name}: o menu de interação não abriu, tentando de novo`);
		}
	}
}

export default {
	name: "equipes Multi: formar grupo pelo menu, desafio 2×2 nível 50, batalha até o fim, abandonar, /pokebattle nível 100",
	timeout: 480_000,
	async run(t) {
		const a = await t.bot("MultiA");
		const b = await t.bot("MultiB");
		const c = await t.bot("MultiC");
		const d = await t.bot("MultiD");
		// Equipe A+B forte (nível real 70); C+D fraca. Com a regra de nível todos lutam no 50.
		await setupWithPokemon(a, "mewtwo level=70");
		await setupWithPokemon(b, "mewtwo level=70");
		await setupWithPokemon(c, "magikarp level=10");
		await setupWithPokemon(d, "magikarp level=10");
		const center = await arena(a, { dx: -40, dz: 24 });
		// Quadrado de 3 blocos (≤ 12 para formar grupo, ≤ 15 do centro para a batalha), com a linha de visão livre
		// nas interações: A→B e C→D (colunas), A→C e D→B (linhas).
		const spots = [[a, 0, 0], [b, 0, 3], [c, 3, 0], [d, 3, 3]];
		for (const [bot, dx, dz] of spots) {
			await bot.teleport(center.x + dx, center.y, center.z + dz);
			await bot.queryPosition();
		}
		await t.sleep(1500);

		// 1. Equipes pelo menu: A convida B; B aceita pelo mesmo botão. C convida D; D aceita.
		for (const [inviter, invitee] of [[a, b], [c, d]]) {
			const markI = invitee.mark();
			await interactAndClick(t, inviter, invitee, "{cobblemon.ui.interact.team_request}");
			await invitee.waitForText("{cobblemon.team.received}", { since: markI.text, timeout: 15_000 });
			const markJ = inviter.mark();
			const menu = await interactAndClick(t, invitee, inviter, "{cobblemon.ui.interact.team_request}");
			t.assert(menu.buttons.some((x) => x.includes("{cobblemon.ui.interact.decline}")), "com convite pendente aparece Recusar");
			await inviter.waitForText("{cobblemon.team.accept.sender}", { since: markJ.text, timeout: 15_000 });
			t.step(`equipe ${inviter.name} + ${invitee.name}`);
		}

		// 2. Mesma equipe mostra "Abandonar grupo"; outra equipe mostra "Batalha Multi". A desafia C com nível 50.
		const markD = d.mark();
		const menu = await interactAndClick(t, a, c, "{cobblemon.battle.types.multi}");
		t.assert(!menu.buttons.some((x) => x.includes("{cobblemon.ui.interact.team_request}")), "em equipe: sem Formar grupo");
		const rules = await a.waitForForm((f) => f.kind === "action" && !f.answered && f.title.includes("{cobblemon.battle.types.multi}"), { timeout: 10_000 });
		t.step(`regras: [${rules.buttons.join(" | ")}]`);
		t.assert(rules.buttons[0].includes("{cobblemon.challenge.rule.anything_goes}"), "1ª regra = Luta Livre");
		a.answerForm(rules, "(50)");
		await d.waitForText("{cobblemon.challenge.multi.received}", { since: markD.text, timeout: 15_000 });
		await d.waitForText("{cobblemon.challenge.rule.level}(50)", { since: markD.text, timeout: 5_000 });

		// 3. D (não o alvo C) aceita interagindo com B → "Batalha Multi".
		const start = [a, b, c, d].map((x) => x.mark());
		await interactAndClick(t, d, b, "{cobblemon.battle.types.multi}");
		await a.waitForText("{cobblemon.challenge.multi.accept.sender}", { since: start[0].text, timeout: 15_000 });
		for (const bot of [a, b, c, d]) {
			const form = await bot.waitForForm(isBattleAction, { timeout: 30_000 });
			t.step(`${bot.name}: form de batalha [${form.buttons.join(" | ")}]`);
		}
		t.assert([a, b, c, d].every((bot) => !bot.forms.some((f) => !f.answered && isBattleAction(f) && f.buttons.some((x) => x.includes("{cobblemon.battle.ui.run}")))), "PvP: sem Fugir");
		// Nível ajustado: o corpo do form de batalha lista os Pokémon em campo com "Lv.N" (reais: 70 e 10).
		const firstForms = [a, b, c, d].map((bot, i) => bot.forms.slice(start[i].form).find(isBattleAction));
		t.step(`corpo do form de A: ${firstForms[0].body.replace(/§./g, "").replace(/\s+/g, " ").slice(0, 120)}`);
		t.assert(firstForms.every((f) => /Lv\.50\b/.test(f.body) && !/Lv\.(70|10)\b/.test(f.body)), "todos os Pokémon em campo no nível 50");
		// 4. Cada bot luta (golpe mais à esquerda; alvo = primeiro botão) até alguém ver a vitória.
		const won = () => [a, b, c, d].some((bot, i) => bot.texts.slice(start[i].text).some((x) => x.text.includes("{cobblemon.battle.win}")));
		for (let round = 0; round < 400 && !won(); round++) {
			for (const bot of [a, b, c, d]) {
				const open = bot.forms.filter((f) => !f.answered && f.kind === "action");
				const form = open[open.length - 1];
				if (!form) continue;
				for (const old of open.slice(0, -1)) old.answered = true;
				if (isBattleAction(form)) bot.answerForm(form, "{cobblemon.battle.ui.fight}");
				else if (isMoveForm(form)) bot.answerForm(form, Math.max(0, form.buttons.findIndex((x) => !x.includes("{gui.back}") && !x.startsWith("§8"))));
				else if (form.buttons.length > 0 && !isInteractMenu(a)(form)) bot.answerForm(form, 0);
			}
			await t.sleep(500);
		}
		t.assert(won(), "a batalha Multi terminou com vitória");
		const winText = [a, b, c, d].flatMap((bot, i) => bot.texts.slice(start[i].text)).find((x) => x.text.includes("{cobblemon.battle.win}"));
		t.step(`fim: ${winText?.text}`);
		await t.sleep(3000);
		for (const bot of [a, b, c, d]) for (const f of bot.forms) f.answered = true;

		// 5. Abandonar: A pelo comando (a equipe A+B se desfaz); D pelo alias; o comando sem equipe avisa.
		const markB = b.mark();
		await a.command("cobblemon:abandonmultiteam");
		await a.waitForText("{cobblemon.team.left.self}", { timeout: 10_000 });
		await b.waitForText("{cobblemon.team.disband}", { since: markB.text, timeout: 10_000 });
		await d.command("cobblemon:abandonmultibattleteam");
		await d.waitForText("{cobblemon.team.left.self}", { timeout: 10_000 });
		const markA = a.mark();
		await a.command("cobblemon:abandonmultiteam");
		await a.waitForText("{cobblemon.port.multi.not_in_team}", { since: markA.text, timeout: 10_000 });
		t.step("equipes desfeitas");

		// 6. /pokebattle com nível fixo (1×1): A desafia B em simples nível 100; B aceita pelo mesmo comando.
		const pvp = [a, b].map((x) => x.mark());
		await a.command(`cobblemon:pokebattle ${b.name} singles 100`);
		await b.waitForText("{cobblemon.challenge.rule.level}(100)", { since: pvp[1].text, timeout: 10_000 });
		await b.command(`cobblemon:pokebattle ${a.name}`);
		await a.waitForText("{cobblemon.challenge.accept.sender}", { since: pvp[0].text, timeout: 10_000 });
		const form100 = await a.waitForForm((f) => a.forms.indexOf(f) >= pvp[0].form && isBattleAction(f), { timeout: 20_000 });
		t.step(`1×1: ${form100.body.replace(/§./g, "").replace(/\s+/g, " ").slice(0, 80)}`);
		t.assert(/Lv\.100\b/.test(form100.body) && !/Lv\.70\b/.test(form100.body), "1×1 no nível 100");
		await t.console(`cobblemon:stopbattle ${a.name}`);
		await t.sleep(2000);
		for (const bot of [a, b]) for (const f of bot.forms) f.answered = true;
	},
};
