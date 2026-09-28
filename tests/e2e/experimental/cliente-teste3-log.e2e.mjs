// Frente cliente-teste3-log (docs/pendencias/cliente-teste3-log.md): o que dá para conferir no BDS do 3º teste em cliente.
//  1. Teleporte longe (chunk ainda sem carregar/ticar, como o jogador que volta ao lugar dele no fim do selftest): nenhum
//     "LocationInUnloadedChunkError" de script no log (cliente: 54× em main.js:597 logo depois do selftest full).
//  2. Montaria aquática de superfície (Garchomp, liquid/boat, não respira na água): o bot monta na água, empurra por 15 s
//     e continua montado (cliente: "o motor tirou o jogador da montaria: garchomp LIQUID").
//
//   COBBLEMON_BDS=log3 COBBLEMON_BDS_PORT=19180 COBBLEMON_DIST=dist-log3 COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/cliente-teste3-log.e2e.mjs --deploy
import { sleep } from "../lib/bot.mjs";
import { arena, dismissForms, openParty, setupWithPokemon } from "../lib/flows.mjs";
import { logSince } from "../lib/server.mjs";

const UNLOADED = /LocationInUnloadedChunkError/;

function lines(since, re) {
	return logSince(since).split("\n").filter((l) => re.test(l));
}

export default {
	name: "cliente-teste3-log: teleporte para chunk descarregado sem erro de script; Garchomp segura o jogador na água",
	timeout: 600_000,
	async run(t) {
		t.console("scriptevent cobblemon:debug_probes on");
		const bot = await t.bot("Log3");
		await setupWithPokemon(bot, "garchomp level=60");
		await dismissForms(bot, 1500);

		// ------------------------------------------------------------------ 1. chunks descarregados
		{
			const since = new Date().toISOString();
			const start = bot.anchor ?? await bot.queryPosition();
			for (let i = 0; i < 6; i++) {
				// Longe o bastante para o destino não estar carregado; o spawner e os scripts por jogador rodam na hora.
				await bot.command(`tp @s ${Math.floor(start.x) + 2000 + i * 700} 110 ${Math.floor(start.z) + 1500 + i * 600}`);
				await sleep(6000);
			}
			await bot.teleport(start.x, start.y, start.z);
			await sleep(4000);
			const hits = lines(since, UNLOADED);
			for (const l of hits.slice(0, 8)) t.step(`descarregado: ${l.slice(0, 300)}`);
			t.assert(hits.length === 0, `nenhum LocationInUnloadedChunkError depois de teleportes longos (${hits.length})`);
		}

		// ------------------------------------------------------------------ 2. Garchomp na água (liquid/boat)
		{
			const base = await arena(bot);
			const x = Math.floor(base.x), y = base.y, z = Math.floor(base.z);
			// Piscina 13×13, 7 de fundo, com vidro em volta; o bot boia no meio.
			await bot.command(`fill ${x - 7} ${y - 8} ${z - 7} ${x + 7} ${y + 2} ${z + 7} glass`);
			await bot.command(`fill ${x - 6} ${y - 7} ${z - 6} ${x + 6} ${y - 1} ${z + 6} water`);
			await bot.command(`fill ${x - 6} ${y} ${z - 6} ${x + 6} ${y + 2} ${z + 6} air`);
			await bot.teleport(x + 0.5, y, z + 0.5);
			await sleep(1500);
			let party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes("garchomp"));
			let menu = await bot.waitForForm((f) => !f.answered && f.title.includes("garchomp"));
			bot.answerForm(menu, 0); // mandar para fora
			await bot.waitForEntity("cobblemon:garchomp", { timeout: 20_000 });
			await sleep(2500);
			// Montaria afundada (como a do selftest, que nasce no fundo da piscina): o motor derrubava o jogador na hora.
			await bot.command(`tp @e[type=cobblemon:garchomp,r=16] ${x + 0.5} ${y - 7} ${z + 0.5}`);
			await sleep(1000);
			party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes("garchomp"));
			menu = await bot.waitForForm((f) => !f.answered && f.title.includes("garchomp"));
			const rideIdx = menu.buttons.findIndex((b) => b.includes("{cobblemon.ui.interact.ride}"));
			t.assert(rideIdx >= 0, `botão de montar no menu do Garchomp (${menu.buttons.join(" | ")})`);
			if (rideIdx < 0) return;
			bot.answerForm(menu, rideIdx);
			await sleep(2500);
			const since = new Date().toISOString();
			t.console("scriptevent cblimits:input_probe on");
			// Para frente e para os lados por 15 s (a piscina segura a montaria).
			for (let i = 0; i < 6; i++) {
				bot.moveVector = { x: i % 2 ? 1 : -1, z: i % 3 ? 1 : -1 };
				bot.inputData = ["up"];
				await sleep(2500);
			}
			bot.moveVector = { x: 0, z: 0 };
			bot.inputData = [];
			t.console("scriptevent cblimits:input_probe off");
			await sleep(1000);
			const probe = lines(since, /\[limites\] input Log3/);
			for (const l of probe.filter((_, i) => i % 6 === 0).slice(0, 12)) t.step(`montaria: ${l.replace(/^.*\[limites\]/, "[limites]").slice(0, 220)}`);
			// A sonda só escreve com o jogador montado (a cada 5 ticks): 15 s montado ≈ 60 amostras; derrubado, para.
			const mounted = probe.filter((l) => l.includes("montado=cobblemon:garchomp"));
			const liquid = mounted.filter((l) => l.includes("estilo=LIQUID"));
			t.assert(mounted.length >= 40, `bot montado no Garchomp os 15 s na água (${mounted.length} amostras de ~60)`);
			t.assert(liquid.length > 0, `estilo LIQUID na água (${liquid.length} amostras)`);
			await bot.command("ride @s stop_riding").catch(() => {});
		}
	},
};
