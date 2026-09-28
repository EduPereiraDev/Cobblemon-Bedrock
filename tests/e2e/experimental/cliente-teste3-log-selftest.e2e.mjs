// Frente cliente-teste3-log (docs/pendencias/cliente-teste3-log.md): `/cobblemon:selftest movement` (todas as
// montarias) e `/cobblemon:selftest quick` com um bot. Confere que o motor não derruba mais o jogador das montarias
// aquáticas de superfície (garchomp/drampa LIQUID no 3º teste em cliente), que o quick termina com 0 falhas e área limpa
// e que não aparece nenhum ERROR/WARN de script (LocationInUnloadedChunkError, spawner lento) no log do servidor.
//
//   COBBLEMON_BDS=log3 COBBLEMON_BDS_PORT=19180 COBBLEMON_DIST=dist-log3 COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/cliente-teste3-log-selftest.e2e.mjs
import { sleep } from "../lib/bot.mjs";
import { dismissForms, setupWithPokemon } from "../lib/flows.mjs";
import { logSince } from "../lib/server.mjs";

const VERIFY = /\[selftest\] verificação: área (\d+) bloco\(s\) não-ar[^,]*, (\d+) entidade\(s\)/;
const FAILURES = /\[selftest\] fim \([^)]*\) em .*; (\d+) falha\(s\)/;
const MOVEMENT = /\[selftest\] movimento: .*montarias (\d+)\/(\d+), (\d+) derrubada/;
const EJECTED = /o motor tirou o jogador da montaria: ([^;]*)/;
const SCRIPT_PROBLEM = /LocationInUnloadedChunkError|\[spawn\] passe lento|unknown variable/;

const selftestLines = (since) => logSince(since).split("\n").filter((l) => l.includes("[selftest]"));

function answerServerCloses(bot) {
	bot.client.on("clientbound_close_form", () => {
		for (const f of bot.forms) {
			if (!f.closedByServer || f.cancelSent) continue;
			f.cancelSent = true;
			bot.client.queue("modal_form_response", { form_id: f.id, has_response_data: false, has_cancel_reason: true, cancel_reason: "closed" });
		}
	});
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

async function runMode(t, bot, mode, timeout) {
	const since = new Date().toISOString();
	const mark = bot.mark();
	const t0 = Date.now();
	bot.command(`cobblemon:selftest ${mode}`).catch(() => {});
	await bot.waitForText("{cobblemon.selftest.started}", { since: mark.text, timeout: 60_000 });
	const end = await bot.waitForText(/cobblemon\.selftest\.(finished|interrupted)/, { since: mark.text, timeout });
	const verify = await waitForLog(since, VERIFY, 60_000);
	const [, blocks, entities] = verify.match(VERIFY);
	t.step(`${mode}: ${end.text.replace(/§./g, "")} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	for (const line of selftestLines(since)) t.step(`  log: ${line.replace(/^.*\[selftest\]/, "[selftest]").slice(0, 400)}`);
	t.assert(end.text.includes("{cobblemon.selftest.finished}"), `${mode} terminou`);
	t.assert(Number(blocks) === 0 && Number(entities) === 0, `${mode}: área limpa (${blocks} blocos, ${entities} entidades)`);
	const failures = selftestLines(since).map((l) => l.match(FAILURES)).find(Boolean);
	t.assert(failures && Number(failures[1]) === 0, `${mode}: 0 falhas (${failures?.[1] ?? "?"})`);
	await dismissForms(bot, 500);
	return since;
}

export default {
	name: "cliente-teste3-log: selftest movement (montarias aquáticas) e quick sem erro de script",
	timeout: 2_400_000,
	async run(t) {
		const bot = await t.bot("Log3st");
		answerServerCloses(bot);
		await setupWithPokemon(bot, "pikachu level=20");
		const start = new Date().toISOString();

		const movement = await runMode(t, bot, "movement", 1_500_000);
		const line = selftestLines(movement).find((l) => MOVEMENT.test(l)) ?? "";
		const [, ridden, rides, ejectedCount] = (line.match(MOVEMENT) ?? []).map(Number);
		const ejected = line.match(EJECTED)?.[1] ?? "";
		t.step(`movement: montarias ${ridden}/${rides}, ${ejectedCount} derrubada(s)${ejected ? `: ${ejected}` : ""}`);
		t.assert(rides > 0, "movement: montarias rodaram");
		t.assert(!/garchomp|drampa/.test(ejected), `movement: Garchomp e Drampa seguram o jogador na água (${ejected || "nenhuma derrubada"})`);

		await runMode(t, bot, "quick", 1_200_000);

		const problems = logSince(start).split("\n").filter((l) => SCRIPT_PROBLEM.test(l));
		for (const p of problems.slice(0, 10)) t.step(`problema: ${p.slice(0, 300)}`);
		t.assert(problems.length === 0, `nenhum LocationInUnloadedChunkError / spawner lento no log (${problems.length})`);
		await bot.close();
	},
};
