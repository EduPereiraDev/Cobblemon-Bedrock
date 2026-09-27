// /cobblemon:selftest com um bot de protocolo (sem renderização: confere o lado do servidor).
// Roda `movement` (completo), `ui` e `quick` até o fim, `full` e `movement` com `stop` no meio (o de movimento durante
// uma montaria, com a piscina cheia) e `entities` e `movement` com o jogador saindo no meio (o de movimento montado); em
// cada um confere no log do servidor que a área voltou a ser só ar e sem entidades (água inclusive), 0 falhas e que o
// bot voltou para onde estava. Na fase de movimento confere também que o bot montou todas as montarias e que cada zona
// teve Pokémon andando, nadando e voando.
//
//   COBBLEMON_BDS=selft2 COBBLEMON_BDS_PORT=19176 COBBLEMON_DIST=dist-selft2 COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/selftest.e2e.mjs --deploy
import { Bot, sleep } from "../lib/bot.mjs";
import { dismissForms, setupWithPokemon } from "../lib/flows.mjs";
import { logSince } from "../lib/server.mjs";

const VERIFY = /\[selftest\] verificação: área (\d+) bloco\(s\) não-ar[^,]*, (\d+) entidade\(s\)/;
const FAILURES = /\[selftest\] fim \([^)]*\) em .*; (\d+) falha\(s\)/;
const MOVEMENT = /\[selftest\] movimento: cercado (\d+)\/(\d+) andaram, piscina (\d+)\/(\d+) nadaram, ar (\d+)\/(\d+) voaram; montarias (\d+)\/(\d+), (\d+) derrubada/;

function selftestLines(since) {
	return logSince(since).split("\n").filter((l) => l.includes("[selftest]"));
}

async function waitForLog(t, since, re, timeout) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const line = selftestLines(since).find((l) => re.test(l));
		if (line) return line;
		await sleep(2000);
	}
	throw new Error(`log ${re} não apareceu em ${timeout / 1000} s`);
}

function near(a, b, d = 1.5) {
	return Math.abs(a.x - b.x) < d && Math.abs(a.y - b.y) < d + 1 && Math.abs(a.z - b.z) < d;
}

/**
 * O cliente de verdade responde ao `uiManager.closeAllForms` com um "cancelado" para cada form aberto; o bot só marca o
 * form como respondido. Sem a resposta, a promessa do form fica pendente no servidor até o bot sair (FormRejectError).
 */
function answerServerCloses(bot) {
	bot.client.on("clientbound_close_form", () => {
		for (const f of bot.forms) {
			if (!f.closedByServer || f.cancelSent) continue;
			f.cancelSent = true;
			bot.client.queue("modal_form_response", { form_id: f.id, has_response_data: false, has_cancel_reason: true, cancel_reason: "closed" });
		}
	});
}

async function runMode(t, bot, mode, { timeout, stopAfter } = {}) {
	const since = new Date().toISOString();
	const mark = bot.mark();
	const t0 = Date.now();
	bot.command(`cobblemon:selftest ${mode}`).catch(() => {});
	await bot.waitForText("{cobblemon.selftest.started}", { since: mark.text, timeout: 60_000 });
	if (stopAfter) {
		await sleep(stopAfter);
		bot.command("cobblemon:selftest stop").catch(() => {});
	}
	const end = await bot.waitForText(/cobblemon\.selftest\.(finished|interrupted)/, { since: mark.text, timeout });
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	const verify = await waitForLog(t, since, VERIFY, 60_000);
	const [, blocks, entities] = verify.match(VERIFY);
	t.step(`${mode}: ${end.text.replace(/§./g, "")} em ${secs} s`);
	for (const line of selftestLines(since)) t.step(`  log: ${line.replace(/^.*\[selftest\]/, "[selftest]").slice(0, 400)}`);
	t.assert(Number(blocks) === 0, `${mode}: área sem blocos (${blocks})`);
	t.assert(Number(entities) === 0, `${mode}: área sem entidades (${entities})`);
	const failures = selftestLines(since).map((l) => l.match(FAILURES)).find(Boolean);
	t.assert(failures && Number(failures[1]) === 0, `${mode}: 0 falhas (${failures?.[1] ?? "?"})`);
	await dismissForms(bot, 500);
	return { secs, end: end.text, since };
}

/**
 * Linha de resumo da fase de movimento: movimento de verdade nas três zonas e cada montaria chegou ao estilo dela ou
 * aparece na lista das que o motor derrubou (achado de conteúdo, ex. montaria que não respira na água afundando).
 * `allRidden`: nenhuma derrubada (a amostra do quick: terra, água e ar).
 */
function checkMovement(t, since, label, { complete, allRidden = false }) {
	const line = selftestLines(since).find((l) => MOVEMENT.test(l));
	t.assert(!!line, `${label}: resumo do movimento no log`);
	if (!line) return;
	const [walked, ground, swam, water, flew, air, ridden, rides, ejected] = line.match(MOVEMENT).slice(1).map(Number);
	t.step(`${label}: cercado ${walked}/${ground}, piscina ${swam}/${water}, ar ${flew}/${air}, montarias ${ridden}/${rides} (${ejected} derrubada(s) pelo motor)`);
	if (!complete) return;
	t.assert(ground > 0 && water > 0 && air > 0 && rides >= 3, `${label}: as três zonas e as montarias rodaram`);
	t.assert(ridden + ejected === rides, `${label}: toda montaria chegou ao estilo ou foi listada como derrubada (${ridden} + ${ejected} de ${rides})`);
	if (allRidden) t.assert(ridden === rides, `${label}: todas as montarias chegaram ao estilo (${ridden}/${rides})`);
	// Com empurrões + IA quase todos se mexem; a margem cobre espécies presas no próprio tamanho.
	t.assert(walked >= ground * 0.9 && swam >= water * 0.9 && flew >= air * 0.9, `${label}: ≥ 90% andaram/nadaram/voaram`);
}

/** Bot sai `after` ms depois de começar: a área é limpa na hora; ao voltar, o bot é devolvido ao lugar. */
async function leaveMidway(t, bot, mode, after, home) {
	const since = new Date().toISOString();
	const mark = bot.mark();
	bot.command(`cobblemon:selftest ${mode}`).catch(() => {});
	await bot.waitForText("{cobblemon.selftest.started}", { since: mark.text, timeout: 60_000 });
	await sleep(after);
	const name = bot.name;
	await bot.close();
	await waitForLog(t, since, /saiu no meio/, 180_000);
	const verify = await waitForLog(t, since, VERIFY, 120_000);
	const [, blocks, entities] = verify.match(VERIFY);
	t.assert(Number(blocks) === 0 && Number(entities) === 0, `${mode} (saída): área limpa (${blocks} blocos, ${entities} entidades)`);
	const back = await Bot.connect(name, { spawnTimeout: 150_000 });
	answerServerCloses(back);
	t.bots?.push(back);
	const mark2 = back.mark();
	await back.waitForText("{cobblemon.selftest.restored_after_crash}", { since: mark2.text, timeout: 60_000 });
	t.assert(near(await back.queryPosition(), home), `${mode} (saída): bot voltou para o lugar ao entrar`);
	for (const line of selftestLines(since)) t.step(`  log: ${line.replace(/^.*\[selftest\]/, "[selftest]").slice(0, 300)}`);
	return back;
}

export default {
	name: "selftest: movement, ui, quick, stop e saída no meio restauram tudo",
	timeout: 2_700_000,
	async run(t) {
		let bot = await t.bot("Selft");
		answerServerCloses(bot);
		await setupWithPokemon(bot, "pikachu level=20");
		const home = await bot.queryPosition();
		t.step(`posição inicial ${JSON.stringify(home)}`);

		// Movimento completo: todas as montarias e todas as espécies nas três zonas.
		const movement = await runMode(t, bot, "movement", { timeout: 1_200_000 });
		t.assert(movement.end.includes("{cobblemon.selftest.finished}"), "movement terminou");
		t.assert(near(await bot.queryPosition(), home), "movement: bot voltou para o lugar");
		checkMovement(t, movement.since, "movement", { complete: true });

		const ui = await runMode(t, bot, "ui", { timeout: 300_000 });
		t.assert(ui.end.includes("{cobblemon.selftest.finished}"), "ui terminou");
		t.assert(near(await bot.queryPosition(), home), "ui: bot voltou para o lugar");

		const quick = await runMode(t, bot, "quick", { timeout: 1_200_000 });
		t.assert(quick.end.includes("{cobblemon.selftest.finished}"), "quick terminou");
		t.assert(near(await bot.queryPosition(), home), "quick: bot voltou para o lugar");
		checkMovement(t, quick.since, "quick", { complete: true, allRidden: true });

		const stopped = await runMode(t, bot, "full", { timeout: 180_000, stopAfter: 20_000 });
		t.assert(stopped.end.includes("{cobblemon.selftest.interrupted}"), "stop interrompe");
		t.assert(near(await bot.queryPosition(), home), "stop: bot voltou para o lugar");

		// Stop no meio de uma montaria (as montarias vêm primeiro; a piscina já está cheia).
		const stoppedRide = await runMode(t, bot, "movement", { timeout: 180_000, stopAfter: 15_000 });
		t.assert(stoppedRide.end.includes("{cobblemon.selftest.interrupted}"), "stop interrompe o movimento");
		t.assert(near(await bot.queryPosition(), home), "stop no movimento: bot voltou para o lugar (e desmontado)");
		checkMovement(t, stoppedRide.since, "movement (stop)", { complete: false });

		// Saída no meio: a área é limpa na hora; o jogador é restaurado quando volta (entidades e montado no movimento).
		bot = await leaveMidway(t, bot, "entities", 12_000, home);
		bot = await leaveMidway(t, bot, "movement", 12_000, home);
		await bot.close();
	},
};
