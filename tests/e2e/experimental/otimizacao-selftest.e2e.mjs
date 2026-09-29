// Frente otimizacao (docs/pendencias/otimizacao.md): `/cobblemon:selftest quick` com um bot de protocolo sobre o pack
// otimizado (build com a etapa tools/optimize). Confere 0 falhas, a área limpa (sem blocos e sem entidades) e o bot de
// volta ao lugar. Mesmo formato do tests/e2e/experimental/selftest.e2e.mjs, só o modo quick.
//
//   COBBLEMON_BDS=opt COBBLEMON_BDS_PORT=19192 COBBLEMON_DIST=dist-opt COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false COBBLEMON_MSD=0 node tools/e2e/run.mjs --scenario tests/e2e/experimental/otimizacao-selftest.e2e.mjs
import { sleep } from "../lib/bot.mjs";
import { dismissForms, setupWithPokemon } from "../lib/flows.mjs";
import { logSince } from "../lib/server.mjs";

const VERIFY = /\[selftest\] verificação: área (\d+) bloco\(s\) não-ar[^,]*, (\d+) entidade\(s\)/;
const FAILURES = /\[selftest\] fim \([^)]*\) em .*; (\d+) falha\(s\)/;

const selftestLines = (since) => logSince(since).split("\n").filter((l) => l.includes("[selftest]"));

async function waitForLog(since, re, timeout) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const line = selftestLines(since).find((l) => re.test(l));
		if (line) return line;
		await sleep(2000);
	}
	throw new Error(`log ${re} não apareceu em ${timeout / 1000} s`);
}

export default {
	name: "otimizacao: selftest quick no pack otimizado (0 falhas)",
	timeout: 1_500_000,
	async run(t) {
		const bot = await t.bot("Otim");
		// O cliente de verdade responde ao closeAllForms com "cancelado"; o bot faz o mesmo (ver selftest.e2e.mjs).
		bot.client.on("clientbound_close_form", () => {
			for (const f of bot.forms) {
				if (!f.closedByServer || f.cancelSent) continue;
				f.cancelSent = true;
				bot.client.queue("modal_form_response", { form_id: f.id, has_response_data: false, has_cancel_reason: true, cancel_reason: "closed" });
			}
		});
		await setupWithPokemon(bot, "pikachu level=20");
		const home = await bot.queryPosition();
		const since = new Date().toISOString();
		const mark = bot.mark();
		const t0 = Date.now();
		bot.command("cobblemon:selftest quick").catch(() => {});
		await bot.waitForText("{cobblemon.selftest.started}", { since: mark.text, timeout: 60_000 });
		const end = await bot.waitForText(/cobblemon\.selftest\.(finished|interrupted)/, { since: mark.text, timeout: 1_200_000 });
		t.step(`quick: ${end.text.replace(/§./g, "")} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
		const verify = await waitForLog(since, VERIFY, 60_000);
		const [, blocks, entities] = verify.match(VERIFY);
		for (const line of selftestLines(since)) t.step(`  log: ${line.replace(/^.*\[selftest\]/, "[selftest]").slice(0, 400)}`);
		t.assert(end.text.includes("{cobblemon.selftest.finished}"), "quick terminou");
		t.assert(Number(blocks) === 0 && Number(entities) === 0, `área limpa (${blocks} blocos, ${entities} entidades)`);
		const failures = selftestLines(since).map((l) => l.match(FAILURES)).find(Boolean);
		t.assert(failures && Number(failures[1]) === 0, `0 falhas (${failures?.[1] ?? "?"})`);
		const pos = await bot.queryPosition();
		t.assert(Math.abs(pos.x - home.x) < 1.5 && Math.abs(pos.z - home.z) < 1.5, "bot voltou para o lugar");
		await dismissForms(bot, 500);
	},
};
