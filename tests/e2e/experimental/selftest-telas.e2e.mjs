// /cobblemon:selftest telas (docs/pendencias/cliente-teste3.md) com um bot de protocolo:
//  1. `telas 3`, o bot FECHA cada tela assim que ela chega → cada form avança na hora (outcome `closed`), as de HUD
//     avançam pelo tempo; todas as telas do roteiro passam, com o aviso "Tela N/total" antes de cada uma, a lista da
//     ordem no chat no fim, a área limpa, 0 falhas e o bot de volta ao lugar;
//  2. `screens 3` (alias), o bot NÃO fecha nada → as telas avançam sozinhas pelo tempo; `stop` no meio interrompe e
//     restaura tudo do mesmo jeito.
//
//   COBBLEMON_BDS=scr COBBLEMON_BDS_PORT=19179 COBBLEMON_DIST=dist-scr COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/selftest-telas.e2e.mjs --deploy
import { sleep } from "../lib/bot.mjs";
import { dismissForms, setupWithPokemon } from "../lib/flows.mjs";
import { logSince } from "../lib/server.mjs";

const VERIFY = /\[selftest\] verificação: área (\d+) bloco\(s\) não-ar[^,]*, (\d+) entidade\(s\)/;
const FAILURES = /\[selftest\] fim \([^)]*\) em .*; (\d+) falha\(s\)/;
const SCREEN = /\[selftest\] tela (\d+)\/(\d+) ([a-z0-9_]+): (closed|timeout|stopped) em ([\d.]+) s/;
const SUMMARY = /\[selftest\] telas: (\d+)\/(\d+) \((\d+) fechada\(s\) pelo jogador, (\d+) pelo tempo/;
/** Paradas sem form (HUD/actionbar): só o tempo as encerra. */
const HUD_ONLY = new Set(["starter_reminder", "party_hud", "battle_hud", "battle_hud_doubles", "battle_minimised", "battle_minimised_moves", "toast_capture", "toast_advancement"]);

function selftestLines(since) {
	return logSince(since).split("\n").filter((l) => l.includes("[selftest]"));
}

async function waitForLog(since, re, timeout) {
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

/** Responde "cancelado" aos forms que o servidor fechou (o cliente real faz isso; ver selftest.e2e.mjs). */
function answerServerCloses(bot) {
	bot.client.on("clientbound_close_form", () => {
		for (const f of bot.forms) {
			if (!f.closedByServer || f.cancelSent) continue;
			f.cancelSent = true;
			bot.client.queue("modal_form_response", { form_id: f.id, has_response_data: false, has_cancel_reason: true, cancel_reason: "closed" });
		}
	});
}

/** O "jogador" fecha cada tela `delay` ms depois de ela abrir (como apertar Esc depois do print). */
function autoClose(bot, delay = 700) {
	const seen = new Map();
	const id = setInterval(() => {
		for (const f of bot.forms) {
			if (f.answered) continue;
			if (!seen.has(f)) seen.set(f, Date.now());
			if (Date.now() - seen.get(f) >= delay) bot.closeForm(f);
		}
	}, 150);
	return () => clearInterval(id);
}

async function checkRestored(t, bot, since, home, label) {
	const verify = await waitForLog(since, VERIFY, 90_000);
	const [, blocks, entities] = verify.match(VERIFY);
	t.assert(Number(blocks) === 0 && Number(entities) === 0, `${label}: área limpa (${blocks} blocos, ${entities} entidades)`);
	const failures = selftestLines(since).map((l) => l.match(FAILURES)).find(Boolean);
	t.assert(failures && Number(failures[1]) === 0, `${label}: 0 falhas (${failures?.[1] ?? "?"})`);
	t.assert(near(await bot.queryPosition(), home), `${label}: bot de volta ao lugar`);
	const restored = selftestLines(since).find((l) => l.includes("] fim ("));
	t.step(`${label}: ${restored?.replace(/^.*\[selftest\]/, "[selftest]").slice(0, 300)}`);
	t.step(`${label}: ${verify.replace(/^.*\[selftest\]/, "[selftest]").slice(0, 200)}`);
}

export default {
	name: "selftest telas: percorre todas as telas (fechar avança; tempo avança; stop), lista a ordem e restaura",
	timeout: 900_000,
	async run(t) {
		const bot = await t.bot("Telas");
		answerServerCloses(bot);
		await setupWithPokemon(bot, "pikachu level=20");
		const home = await bot.queryPosition();

		// 1. O bot fecha cada tela.
		let since = new Date().toISOString();
		let mark = bot.mark();
		const stopClosing = autoClose(bot);
		const t0 = Date.now();
		bot.command("cobblemon:selftest telas 3").catch(() => {});
		await bot.waitForText("{cobblemon.selftest.started}", { since: mark.text, timeout: 60_000 });
		let end = await bot.waitForText(/cobblemon\.selftest\.(finished|interrupted)/, { since: mark.text, timeout: 600_000 });
		stopClosing();
		t.step(`telas 3 (fechando): ${end.text.replace(/§./g, "")} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
		t.assert(end.text.includes("{cobblemon.selftest.finished}"), "terminou");
		const summary = (await waitForLog(since, SUMMARY, 30_000)).match(SUMMARY);
		const screens = selftestLines(since).map((l) => l.match(SCREEN)).filter(Boolean);
		const total = Number(summary[2]);
		t.step(`resumo: ${summary[0].replace(/^.*\[selftest\]/, "[selftest]")}`);
		t.step(`telas: ${screens.map((m) => `${m[1]}.${m[3]}=${m[4]}(${m[5]}s)`).join(" ")}`);
		t.assert(total >= 30, `roteiro com ${total} telas`);
		t.assert(Number(summary[1]) === total && screens.length === total, `todas as ${total} telas passaram (${screens.length})`);
		t.assert(screens.every((m, i) => Number(m[1]) === i + 1 && Number(m[2]) === total), "em ordem, 1..total");
		for (const m of screens) {
			if (HUD_ONLY.has(m[3])) t.assert(m[4] === "timeout", `${m[3]}: HUD avança pelo tempo (${m[4]})`);
		}
		const closedForms = screens.filter((m) => m[4] === "closed");
		t.assert(closedForms.length >= total - HUD_ONLY.size - 1, `fechar a tela avança na hora (${closedForms.length} fechadas)`);
		t.assert(closedForms.every((m) => Number(m[5]) < 3), "as fechadas não esperaram o tempo todo");
		// Aviso antes de cada tela (actionbar) e a ordem no chat no fim.
		const announces = bot.titles.slice(mark.title).filter((x) => x.text.includes("cobblemon.selftest.screens.announce"));
		t.assert(announces.length >= total, `aviso "Tela N/total" antes de cada tela (${announces.length})`);
		const texts = bot.texts.slice(mark.text).map((x) => x.text);
		const orderAt = texts.findIndex((x) => x.includes("{cobblemon.selftest.screens.order}"));
		t.assert(orderAt >= 0, "lista da ordem no chat");
		const order = texts.slice(orderAt + 1).filter((x) => x.includes("{cobblemon.selftest.screen.")).map((x) => /\{cobblemon\.selftest\.screen\.([a-z0-9_]+)\}/.exec(x)[1]);
		t.step(`ordem no chat: ${order.join(", ")}`);
		t.assert(order.join(",") === screens.map((m) => m[3]).join(","), "a ordem do chat é a das telas");
		t.assert(texts.some((x) => x.includes("{cobblemon.selftest.screens.intro}")), "instrução do print no começo");
		await checkRestored(t, bot, since, home, "telas (fechando)");
		await dismissForms(bot, 500);

		// 2. Alias `screens`, ninguém fecha: avança pelo tempo; stop no meio.
		since = new Date().toISOString();
		mark = bot.mark();
		bot.command("cobblemon:selftest screens 3").catch(() => {});
		await bot.waitForText("{cobblemon.selftest.started}", { since: mark.text, timeout: 60_000 });
		await sleep(30_000);
		bot.command("cobblemon:selftest stop").catch(() => {});
		end = await bot.waitForText(/cobblemon\.selftest\.(finished|interrupted)/, { since: mark.text, timeout: 120_000 });
		t.assert(end.text.includes("{cobblemon.selftest.interrupted}"), "stop interrompe o roteiro");
		const timed = selftestLines(since).map((l) => l.match(SCREEN)).filter(Boolean);
		t.step(`screens 3 (sem fechar, stop em 30 s): ${timed.map((m) => `${m[1]}.${m[3]}=${m[4]}(${m[5]}s)`).join(" ")}`);
		const formByTime = timed.filter((m) => !HUD_ONLY.has(m[3]) && m[4] === "timeout");
		t.assert(formByTime.length >= 3, `telas com form avançaram sozinhas pelo tempo (${formByTime.length})`);
		t.assert(formByTime.every((m) => Number(m[5]) >= 2.9 && Number(m[5]) < 4.5), "cada uma ficou ~3 s aberta");
		t.assert(timed.at(-1)?.[4] === "stopped", "a tela aberta no stop terminou como stopped");
		await checkRestored(t, bot, since, home, "screens (stop)");
		await dismissForms(bot, 500);
	},
};
