// Frente cliente-teste4 (docs/pendencias/cliente-teste4.md): o spawner natural rodando alguns minutos com um bot, sem
// "[spawn] passe lento" no log. Com a sonda ligada (`cobblemon:debug_probes on`) o spawner escreve uma linha por passe
// fatiado (`[spawn] passe: maior fatia N ms (rótulo) … leituras de bloco R, a maior M ms`); o cenário resume essas
// linhas (quantos passes, distribuição da maior fatia, a maior leitura de bloco) para comparar com o cliente.
//
//   COBBLEMON_BDS=last COBBLEMON_BDS_PORT=19185 COBBLEMON_DIST=dist-last COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/cliente-teste4-spawn.e2e.mjs
//
// CT4_MINUTES (padrão 4): minutos de spawner. CT4_CONSOLE: comando de console extra no começo (ex.: carga paralela).
import { sleep } from "../lib/bot.mjs";
import { dismissForms } from "../lib/flows.mjs";
import { consoleCommand, logSince } from "../lib/server.mjs";

const PASS = /\[spawn\] passe: maior fatia (\d+) ms \(([^)]*)\), relógio (\d+) ms, posições (\d+), leituras de bloco (\d+), a maior (\d+) ms, na maior fatia (\d+) ms, consultas ao mundo (\d+), a maior (\d+) ms, entidades (\d+)/;
const SLOW = /\[spawn\] passe lento/;

export default {
	name: "cliente-teste4: spawner natural por alguns minutos sem passe lento",
	timeout: 30 * 60_000,
	async run(t) {
		const minutes = Number(process.env.CT4_MINUTES ?? 4);
		for (const cmd of ["scriptevent cobblemon:debug_probes on", "cobblemon:cobblemonconfig set enableSpawning true", "kill @e[type=!player]"]) {
			try { consoleCommand(cmd); } catch (e) { t.step(`aviso: ${cmd}: ${e.message}`); }
		}
		const bot = await t.bot("Spawn4");
		await dismissForms(bot, 1500);
		const start = bot.anchor ?? await bot.queryPosition();
		// Longe do ponto de entrada (terreno natural, chunks novos) e andando de tempos em tempos, como um jogador.
		const bx = Math.floor(start.x) + 900, bz = Math.floor(start.z) + 700;
		await bot.command(`tp @s ${bx} 120 ${bz}`);
		await sleep(8000);
		await bot.command(`spreadplayers ${bx} ${bz} 0 1 @s`).catch(() => {});
		await sleep(4000);
		const since = new Date().toISOString();
		if (process.env.CT4_CONSOLE) consoleCommand(process.env.CT4_CONSOLE);
		const end = Date.now() + minutes * 60_000;
		let hop = 0;
		while (Date.now() < end) {
			await sleep(20_000);
			hop++;
			// A cada 20 s, 64 blocos adiante (zonas novas: colunas e caixas de espaço ainda não lidas) e sem os selvagens de
			// antes (o teto por chunk/jogador pararia os passes antes da seleção).
			try { consoleCommand("kill @e[type=!player]"); } catch { /* sem console */ }
			await bot.command(`spreadplayers ${bx + hop * 64} ${bz + (hop % 2) * 64} 0 1 @s`).catch(() => {});
		}
		const log = logSince(since).split("\n");
		const passes = log.map((l) => l.match(PASS)).filter(Boolean).map((m) => ({ worst: +m[1], part: m[2], wall: +m[3], positions: +m[4], reads: +m[5], maxRead: +m[6], sliceRead: +m[7], queries: +m[8], maxQuery: +m[9], spawned: +m[10] }));
		const slow = log.filter((l) => SLOW.test(l));
		const worst = passes.map((p) => p.worst).sort((a, b) => a - b);
		const q = (f) => worst.length ? worst[Math.min(worst.length - 1, Math.floor(worst.length * f))] : 0;
		t.step(`${passes.length} passes em ${minutes} min; maior fatia: mediana ${q(0.5)} ms, p90 ${q(0.9)} ms, p99 ${q(0.99)} ms, máx ${worst.at(-1) ?? 0} ms; spawns ${passes.reduce((a, p) => a + p.spawned, 0)}`);
		const byPart = new Map();
		for (const p of passes) byPart.set(p.part, Math.max(byPart.get(p.part) ?? 0, p.worst));
		t.step(`maior fatia por rótulo: ${[...byPart].map(([k, v]) => `${k} ${v} ms`).join(", ")}`);
		t.step(`leituras de bloco por passe: máx ${Math.max(0, ...passes.map((p) => p.reads))}; a maior leitura isolada ${Math.max(0, ...passes.map((p) => p.maxRead))} ms`);
		for (const p of passes.filter((p) => p.worst >= 15).slice(0, 12)) t.step(`  fatia ${p.worst} ms (${p.part}), maior leitura na fatia ${p.sliceRead} ms (no passe ${p.maxRead} ms), ${p.reads} leituras, ${p.positions} posições, maior consulta ao mundo ${p.maxQuery} ms (${p.queries})`);
		for (const l of slow.slice(0, 8)) t.step(`lento: ${l.slice(0, 300)}`);
		t.assert(passes.length > 0, `o spawner rodou (${passes.length} passes)`);
		t.assert(slow.length === 0, `nenhum "[spawn] passe lento" em ${minutes} min (${slow.length})`);
		try { consoleCommand("scriptevent cobblemon:debug_probes off"); } catch { /* sem console */ }
	},
};
