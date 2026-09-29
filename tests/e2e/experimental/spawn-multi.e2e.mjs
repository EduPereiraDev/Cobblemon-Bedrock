// Frente spawn-multi (docs/pendencias/spawn-multi.md): a taxa de spawn POR JOGADOR não pode cair com mais jogadores no
// mundo (no CobbleDrock caía muito com > 2 jogadores). Com a sonda ligada (`cobblemon:debug_probes on`) o spawner escreve
// a cada 1200 ticks uma linha `[spawn] multi: …` com passes/spawns por jogador, custo do spawner por tick e TPS.
//
// Rodadas (cada uma SM_MINUTES, padrão 3):
//   longe  — N bots a 400 blocos uns dos outros (spawners independentes), selvagens removidos a cada 15 s para medir a
//            TAXA (sem o cap por chunk no caminho). Esperado: passes e spawns por jogador iguais com 1, 2, 4 e 6 bots.
//   juntos — N bots no mesmo ponto, sem remover selvagens. Esperado: densidade local (selvagens perto do grupo) no cap
//            local do Java (3×3 chunks, pokemonPerChunk), igual com 1 ou 6 jogadores.
//
//   COBBLEMON_BDS=smulti COBBLEMON_BDS_PORT=19190 COBBLEMON_DIST=dist-smulti COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/spawn-multi.e2e.mjs
//
// SM_COUNTS (padrão "1,2,4,6"), SM_MODES (padrão "longe,juntos"), SM_MINUTES (padrão 3), SM_TAG (rótulo no resumo),
// SM_BASE (padrão 1: faixa de terreno; use um valor diferente a cada rodada no mesmo mundo).
import { sleep } from "../lib/bot.mjs";
import { dismissForms } from "../lib/flows.mjs";
import { consoleCommand, logSince } from "../lib/server.mjs";

const MULTI = /\[spawn\] multi: ticks (\d+) em ([\d.]+) s \(([\d.]+) TPS\), spawner\/tick média ([\d.]+) ms p99 (\d+) ms máx (\d+) ms, tick médio ([\d.]+) ms máx (\d+) ms \| (.*)$/;
const PLAYER = /^(\S+): passes (\d+) \(ok (\d+), zona (\d+), cap (\d+), teto (\d+)\), spawns (\d+), duração máx (\d+) ticks, atrasados (\d+)(?:, selvagens perto (\d+))?/;
const SLOW = /\[spawn\] passe lento|Watchdog|watchdog/;

function parse(log) {
	const out = [];
	for (const line of log) {
		const m = line.match(MULTI);
		if (!m) continue;
		const players = m[9].split(" | ").map((p) => p.match(PLAYER)).filter(Boolean).map((p) => ({
			name: p[1], passes: +p[2], ok: +p[3], zona: +p[4], cap: +p[5], teto: +p[6], spawns: +p[7], maxTicks: +p[8], late: +p[9], near: p[10] === undefined ? undefined : +p[10],
		}));
		out.push({ ticks: +m[1], seconds: +m[2], tps: +m[3], avg: +m[4], p99: +m[5], max: +m[6], tickAvg: +m[7], tickMax: +m[8], players });
	}
	return out;
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);

export default {
	name: "spawn-multi: taxa de spawn por jogador com 1, 2, 4 e 6 jogadores (longe e juntos)",
	timeout: 180 * 60_000,
	async run(t) {
		const minutes = Number(process.env.SM_MINUTES ?? 3);
		const counts = (process.env.SM_COUNTS ?? "1,2,4,6").split(",").map(Number);
		const modes = (process.env.SM_MODES ?? "longe,juntos").split(",");
		const tag = process.env.SM_TAG ?? "";
		// Bots imunes (terreno novo pode ser oceano/lava; um bot morto some dos seletores e o /tp falha). O spawner não olha o
		// modo de jogo (nem o PlayerSpawner do Java).
		for (const cmd of ["scriptevent cobblemon:debug_probes on", "cobblemon:cobblemonconfig set enableSpawning true", "gamerule dodaylightcycle false", "time set day",
			"gamerule drowningdamage false", "gamerule falldamage false", "gamerule firedamage false", "gamerule freezedamage false", "kill @e[type=!player]"]) {
			try { consoleCommand(cmd); } catch (e) { t.step(`aviso: ${cmd}: ${e.message}`); }
		}
		const bots = [];
		const first = await t.bot("SpM0");
		await dismissForms(first, 1500);
		bots.push(first);
		const start = first.anchor ?? await first.queryPosition();
		// Terreno novo em cada rodada (SM_BASE) e em cada configuração: os selvagens de uma rodada anterior ficam salvos nos
		// chunks descarregados (o kill não os alcança) e voltariam quando os bots chegassem.
		const smBase = Number(process.env.SM_BASE ?? 1);
		const baseX = Math.floor(start.x) + 1200 + smBase * 6000, baseZ0 = Math.floor(start.z) + 900;
		let cfg = 0;
		let baseZ = baseZ0;
		const rows = [];
		const since0 = new Date().toISOString();
		// Teleporte pelo console (o /tp do próprio bot às vezes se perde com o servidor sob carga) e conferência da posição
		// real (move_player): um bot fora do lugar estragaria a rodada (juntos virando dois grupos, longe dividindo área).
		const place = async (n, mode) => {
			for (let i = 0; i < n; i++) {
				const b = bots[i];
				const x = mode === "longe" ? baseX + i * 400 : baseX + (i % 3) * 2;
				const z = mode === "longe" ? baseZ : baseZ + Math.floor(i / 3) * 2;
				let pos;
				try { consoleCommand(`gamemode creative "${b.name}"`); } catch { await b.command("gamemode creative @s").catch(() => {}); }
				for (let attempt = 1; attempt <= 4; attempt++) {
					// Console e o próprio bot (um dos dois às vezes se perde com o servidor sob carga).
					try { consoleCommand(`tp "${b.name}" ${x} 120 ${z}`); } catch { /* sem console */ }
					if (attempt > 1) await b.command(`tp @s ${x} 120 ${z}`).catch(() => {});
					await sleep(3000);
					try { consoleCommand(`spreadplayers ${x} ${z} 0 1 "${b.name}"`); } catch { await b.command(`spreadplayers ${x} ${z} 0 1 @s`).catch(() => {}); }
					await sleep(1500);
					pos = await b.queryPosition({ timeout: 20_000 }).catch(() => undefined);
					if (pos && Math.abs(pos.x - x) < 6 && Math.abs(pos.z - z) < 6) break;
					t.step(`  ${b.name} fora do lugar (${pos ? `${Math.round(pos.x)}, ${Math.round(pos.z)}` : "?"}; queria ${x}, ${z}); tentativa ${attempt + 1}`);
					pos = undefined;
				}
				t.assert(pos, `${b.name} posicionado em ${x}, ${z}`);
			}
		};
		for (const mode of modes) {
			for (const n of counts) {
				while (bots.length < n) {
					const b = await t.bot(`SpM${bots.length}`);
					await dismissForms(b, 1500);
					bots.push(b);
				}
				// Bots além de N saem do mundo (cada jogador tem o seu spawner).
				while (bots.length > n) await bots.pop().close();
				// Longe: terreno novo por configuração (taxa). Juntos: o MESMO ponto para todos os N (densidade comparável; o
				// bot 0 fica lá entre as configurações, então o kill do começo alcança os selvagens da anterior).
				baseZ = mode === "longe" ? baseZ0 + (cfg++) * 800 : baseZ0 + 4000;
				await place(n, mode);
				await sleep(12_000);
				try { consoleCommand("kill @e[family=pokemon]"); } catch { /* sem console */ }
				// Começa numa fronteira de resumo nova: espera o próximo "[spawn] multi" para alinhar a janela.
				const align = new Date().toISOString();
				const alignEnd = Date.now() + 90_000;
				while (Date.now() < alignEnd && !parse(logSince(align).split("\n")).length) await sleep(2000);
				const since = new Date().toISOString();
				const end = Date.now() + minutes * 60_000 + 5_000;
				while (Date.now() < end) {
					await sleep(15_000);
					if (mode === "longe") { try { consoleCommand("kill @e[family=pokemon]"); } catch { /* sem console */ } }
				}
				const reports = parse(logSince(since).split("\n"));
				const names = new Set(bots.slice(0, n).map((b) => b.name));
				const per = [...names].map((name) => {
					const rs = reports.map((r) => r.players.find((p) => p.name === name)).filter(Boolean);
					return { name, passes: sum(rs.map((p) => p.passes)), spawns: sum(rs.map((p) => p.spawns)), ok: sum(rs.map((p) => p.ok)), cap: sum(rs.map((p) => p.cap)), teto: sum(rs.map((p) => p.teto)), zona: sum(rs.map((p) => p.zona)), late: sum(rs.map((p) => p.late)), maxTicks: Math.max(0, ...rs.map((p) => p.maxTicks)), near: rs.at(-1)?.near };
				});
				const mins = sum(reports.map((r) => r.seconds)) / 60 || 1;
				const ticksMin = sum(reports.map((r) => r.ticks)) / mins;
				const row = {
					tag, mode, n, reports: reports.length, minutes: +mins.toFixed(2),
					tps: +mean(reports.map((r) => r.tps)).toFixed(1),
					passesPerPlayerMin: +(mean(per.map((p) => p.passes)) / mins).toFixed(1),
					passesPer1200Ticks: +(mean(per.map((p) => p.passes)) / (sum(reports.map((r) => r.ticks)) / 1200 || 1)).toFixed(1),
					spawnsPerPlayerMin: +(mean(per.map((p) => p.spawns)) / mins).toFixed(1),
					minPassesPlayerMin: +(Math.min(...per.map((p) => p.passes)) / mins).toFixed(1),
					late: sum(per.map((p) => p.late)), maxTicks: Math.max(0, ...per.map((p) => p.maxTicks)),
					outcomes: `ok ${sum(per.map((p) => p.ok))}/zona ${sum(per.map((p) => p.zona))}/cap ${sum(per.map((p) => p.cap))}/teto ${sum(per.map((p) => p.teto))}`,
					nearAtEnd: per.map((p) => p.near ?? "?").join(","),
					spawnerAvgMs: +mean(reports.map((r) => r.avg)).toFixed(2), spawnerP99Ms: Math.max(0, ...reports.map((r) => r.p99)), spawnerMaxMs: Math.max(0, ...reports.map((r) => r.max)),
					tickAvgMs: +mean(reports.map((r) => r.tickAvg)).toFixed(1), tickMaxMs: Math.max(0, ...reports.map((r) => r.tickMax)), ticksPerMin: Math.round(ticksMin),
				};
				rows.push(row);
				t.step(`SMROW ${JSON.stringify(row)}`);
				for (const p of per) t.step(`  ${mode} N=${n} ${p.name}: passes ${p.passes}, spawns ${p.spawns}, atrasados ${p.late}, duração máx ${p.maxTicks} ticks, selvagens perto ${p.near ?? "?"}`);
			}
		}
		const slow = logSince(since0).split("\n").filter((l) => SLOW.test(l));
		for (const l of slow.slice(0, 8)) t.step(`lento: ${l.slice(0, 300)}`);
		try { consoleCommand("scriptevent cobblemon:debug_probes off"); consoleCommand("cobblemon:cobblemonconfig set enableSpawning false"); } catch { /* sem console */ }
		t.assert(rows.every((r) => r.reports > 0), "a sonda multi escreveu resumos em todas as rodadas");
		t.assert(slow.length === 0, `nenhum "[spawn] passe lento"/watchdog (${slow.length})`);
		if (process.env.SM_ASSERT_RATE === "1") {
			// Taxa por jogador (longe): a de N jogadores ≥ 85% da de 1 jogador, por 1200 ticks (independe do TPS do BDS).
			const far = rows.filter((r) => r.mode === "longe");
			const one = far.find((r) => r.n === 1);
			for (const r of far) t.assert(!one || r.passesPer1200Ticks >= one.passesPer1200Ticks * 0.85, `passes por jogador com N=${r.n} (${r.passesPer1200Ticks}/1200 ticks) ≥ 85% de N=1 (${one?.passesPer1200Ticks})`);
		}
	},
};
