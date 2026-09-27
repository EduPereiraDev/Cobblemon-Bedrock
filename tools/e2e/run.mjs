#!/usr/bin/env node
// Suíte E2E: bots de protocolo entram no BDS de teste (container cobblemon-bds-e2e) e exercitam o
// add-on pela rede. Veja docs/E2E.md.
//
//   npm run test:e2e                       usa o servidor E2E já de pé (sobe/faz deploy se não estiver)
//   npm run test:e2e -- --deploy           build em dist-e2e + deploy antes de rodar
//   npm run test:e2e -- --only starter     só os cenários cujo nome contém "starter"
//   npm run test:e2e -- --list             lista os cenários
//   npm run test:e2e -- --keep             deixa o servidor de pé no fim (padrão: docker stop)
//   npm run test:e2e -- --rm               remove o container no fim (docker rm -f)
//   npm run test:e2e -- --scenario x.mjs  roda um cenário avulso (mesmo formato de tests/e2e/scenarios)
//   npm run test:e2e -- --verbose          mostra o log de eventos dos bots também nos cenários que passam
import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// bedrock-protocol 3.60 exige Node ≥ 24. Se o Node atual for mais velho, reexecuta com o fnm.
if (Number(process.versions.node.split(".")[0]) < 24) {
	const r = spawnSync("fnm", ["exec", "--using", "24", "--", "node", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
	if (r.error) {
		console.error("A suíte E2E precisa de Node ≥ 24 (bedrock-protocol). Instale com `fnm install 24` ou rode com Node 24.");
		process.exit(1);
	}
	process.exit(r.status ?? 1);
}

if (!existsSync(join(root, "tools", "e2e", "node_modules", "bedrock-protocol"))) {
	console.log("instalando dependências do E2E (tools/e2e)…");
	const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: join(root, "tools", "e2e"), stdio: "inherit" });
	if (r.status !== 0) process.exit(1);
}

const { Bot, E2EError, sleep } = await import(pathToFileURL(join(root, "tests", "e2e", "lib", "bot.mjs")).href);
const server = await import(pathToFileURL(join(root, "tests", "e2e", "lib", "server.mjs")).href);

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const only = opt("--only");
const verbose = flag("--verbose");

const scenarioDir = join(root, "tests", "e2e", "scenarios");
const files = readdirSync(scenarioDir).filter((f) => f.endsWith(".e2e.mjs")).sort();
const scenarios = [];
for (const f of files) {
	const mod = await import(pathToFileURL(join(scenarioDir, f)).href);
	scenarios.push({ file: f, ...mod.default });
}
let selected = scenarios.filter((s) => !only || only.split(",").some((o) => s.name.includes(o) || s.file.includes(o)));
// --scenario <arquivo>: roda um cenário avulso (útil para depurar um fluxo novo).
if (opt("--scenario")) {
	const file = resolve(opt("--scenario"));
	selected = [{ file, ...(await import(pathToFileURL(file).href)).default }];
}

if (flag("--list")) {
	for (const s of scenarios) console.log(`${s.file}  ${s.name}${s.description ? ` — ${s.description}` : ""}`);
	process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Servidor

/**
 * O BDS com o add-on usa ~2 GiB. Com vários BDS de outras frentes na mesma VM do Docker, o kernel
 * mata algum por OOM. Antes de (re)ligar o servidor, espera ter memória livre (até 10 min).
 */
async function waitMemory() {
	const end = Date.now() + 10 * 60_000;
	while (true) {
		const mem = server.memoryReport();
		const free = mem.availableGiB;
		if (free >= 2.2 || Date.now() > end) {
			if (free < 2.2) console.log(`  ⚠ só ${free.toFixed(1)} GiB livres no Docker; ligando assim mesmo (risco de OOM)`);
			return;
		}
		console.log(`  … esperando memória no Docker (${free.toFixed(1)} GiB livres; BDS de pé: ${mem.bds.join(", ")})`);
		await sleep(15_000);
	}
}

/** Liga o servidor E2E se estiver parado (esperando memória livre antes). */
async function ensureServer() {
	if (server.state().running) return;
	await waitMemory();
	server.start();
	await server.waitReady();
}

const mem = server.memoryReport();
console.log(`• memória do Docker: ${mem.availableGiB.toFixed(1)} de ${mem.totalGiB.toFixed(1)} GiB disponíveis; BDS de pé: ${mem.bds.join(", ")}`);
if (flag("--deploy") || !server.state().exists || !server.propertiesOk()) {
	console.log(`• build + deploy em ${server.container} (porta ${server.env.COBBLEMON_BDS_PORT}, ${server.env.COBBLEMON_DIST}, transport=${server.env.COBBLEMON_BDS_TRANSPORT}, online-mode=${server.env.COBBLEMON_BDS_ONLINE_MODE})`);
	if (!server.state().running) await waitMemory();
	server.buildAndDeploy();
}
await ensureServer();
const pong = await server.waitReady();
console.log(`• servidor: ${pong.split(";").slice(0, 4).join(";")}`);
// Mundo previsível e leve: sem monstros atacando os bots, sempre de dia, sem spawn natural (nem vanilla nem
// o spawner do add-on) e sem as entidades que sobraram das execuções anteriores. O BDS é emulado (box64) e
// divide a máquina com os servidores das outras frentes: cada entidade a menos ajuda os bots a entrarem.
for (const cmd of [
	"tickingarea remove e2espawn", "difficulty peaceful", "gamerule dodaylightcycle false", "time set day",
	"gamerule doweathercycle false", "weather clear", "gamerule domobspawning false", "gamerule spawnradius 0",
	"cobblemon:cobblemonconfig set enableSpawning false", "kill @e[type=!player]",
]) {
	try { server.consoleCommand(cmd); } catch (e) { console.log(`  aviso: ${cmd}: ${e.message}`); }
}

// ---------------------------------------------------------------------------------------------
// Execução

const runId = Math.random().toString(36).slice(2, 6);
let tickingAreaDone = false;
let spawnAnchor;

function makeContext(scenario) {
	const bots = [];
	const steps = [];
	const warnings = [];
	return {
		bots, steps, warnings,
		runId,
		/** Conecta um bot novo (nome único por execução: dados de jogador limpos). */
		async bot(label = "Bot") {
			const name = `${label}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 10) + runId;
			const t0 = Date.now();
			// Entrar às vezes trava com o servidor sob carga (spawn que não chega, comandos ignorados):
			// tenta de novo com outro nome (jogador novo) antes de falhar o cenário.
			let bot;
			for (let attempt = 1; ; attempt++) {
				const tryName = attempt === 1 ? name : `${name.slice(0, 13)}r${attempt}`;
				try {
					bot = await Bot.connect(tryName, { spawnTimeout: 120_000 });
					// O 1º comando logo após o spawn demora (o servidor ainda está mandando chunks); o tp
					// também informa a posição real (o start_game manda y=32769 antes de achar o chão).
					await bot.queryPosition({ timeout: 45_000 });
					break;
				} catch (e) {
					const failed = bot ?? e.bot;
					if (failed) { await failed.close(); bots.push(failed); }
					bot = undefined;
					if (attempt >= 2) throw e;
					steps.push(`${tryName} não entrou (${e.message}); tentando de novo`);
				}
			}
			bots.push(bot);
			steps.push(`${bot.name} entrou (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
			// Âncora fixa (spawn do mundo) para as plataformas de teste: com spawnradius 0 todos nascem nela.
			spawnAnchor ??= { x: Math.floor(bot.position.x), y: Math.floor(bot.position.y), z: Math.floor(bot.position.z) };
			bot.anchor = spawnAnchor;
			if (!tickingAreaDone) {
				// Mantém os chunks do spawn carregados: as próximas entradas ficam bem mais rápidas.
				tickingAreaDone = true;
				const p = bot.position;
				// Sem "preload": com preload o BDS segura a entrada dos jogadores até carregar a área toda.
				try { server.consoleCommand(`tickingarea add circle ${Math.floor(p.x)} 64 ${Math.floor(p.z)} 4 e2espawn`); } catch { /* já existe */ }
			}
			return bot;
		},
		step(msg) { steps.push(msg); if (verbose) console.log(`    · ${msg}`); },
		warn(msg) { warnings.push(msg); },
		assert(cond, msg) { if (!cond) throw new E2EError(`asserção falhou: ${msg}`); },
		console: server.consoleCommand,
		sleep,
	};
}

function withTimeout(promise, ms, what) {
	let t;
	return Promise.race([
		promise.finally(() => clearTimeout(t)),
		new Promise((_, rej) => { t = setTimeout(() => rej(new E2EError(`timeout do cenário (${ms / 1000} s): ${what}`)), ms); }),
	]);
}

// Erros de conexão/entrada (não de asserção): servidor sob carga ou pacote perdido pelo jsp-raknet.
const INFRA = /sem spawn|não respondeu ao \/tp|desconectado esperando|conexão fechada antes do spawn|Connect timed out|conexão parada/;

const results = [];
for (const scenario of selected) {
	if (!server.state().running) { console.log("• servidor E2E parado; religando"); await ensureServer(); }
	let ctx = makeContext(scenario);
	const since = new Date().toISOString();
	const t0 = Date.now();
	process.stdout.write(`\n▶ ${scenario.name}\n`);
	let error;
	try {
		await withTimeout(scenario.run(ctx), scenario.timeout ?? 240_000, scenario.name);
	} catch (e) {
		error = e;
	}
	// Falha de infraestrutura (o bot não entrou, a conexão parou de receber pacotes ou caiu) com o servidor
	// de pé: repete o cenário uma vez com bots novos e avisa. Asserções do add-on nunca são repetidas.
	if (error && INFRA.test(error.message ?? "") && server.state().running) {
		console.log(`  ⚠ falha de infraestrutura (${error.message}); repetindo o cenário uma vez`);
		for (const bot of ctx.bots) await bot.close();
		ctx = makeContext(scenario);
		ctx.warnings.push(`cenário repetido por falha de infraestrutura na 1ª tentativa: ${error.message}`);
		error = undefined;
		try { await withTimeout(scenario.run(ctx), scenario.timeout ?? 240_000, scenario.name); }
		catch (e) { error = e; }
	}
	// O servidor morreu no meio (OOM do Docker com vários BDS de pé)? Religa e repete o cenário uma vez.
	let st = server.state();
	if (!st.running) {
		const why = st.oomKilled ? "morto por falta de memória (OOMKilled) no Docker" : `parou (exit ${st.exitCode})`;
		console.log(`  ⚠ o servidor E2E ${why} durante o cenário; religando e repetindo uma vez`);
		for (const bot of ctx.bots) await bot.close();
		await ensureServer();
		ctx = makeContext(scenario);
		error = undefined;
		try { await withTimeout(scenario.run(ctx), scenario.timeout ?? 240_000, scenario.name); }
		catch (e) { error = e; }
		st = server.state();
		if (!st.running) error = new E2EError(`BLOCKED_EXTERNAL: o servidor E2E ${st.oomKilled ? "foi morto por OOM" : "parou"} de novo (${error?.message ?? "sem erro do cenário"})`);
	}
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	const logText = server.logSince(since);
	const problems = server.problemLines(logText);
	if (error) {
		console.log(`✗ FALHOU ${scenario.name} (${secs} s)\n  ${error.stack?.split("\n").slice(0, 3).join("\n  ") ?? error}`);
		console.log(`  passos:\n${ctx.steps.map((s) => `    · ${s}`).join("\n")}`);
		for (const bot of ctx.bots) console.log(bot.dump().replace(/^/gm, "  "));
		console.log(`  --- log do servidor durante o cenário (ERROR/WARN):\n${(problems.length ? problems : ["  (nenhum)"]).slice(-40).map((l) => `    ${l}`).join("\n")}`);
		console.log(`  --- últimas linhas do log do servidor:\n${logText.trim().split("\n").slice(-25).map((l) => `    ${l}`).join("\n")}`);
	} else {
		console.log(`✓ ok ${scenario.name} (${secs} s)`);
		if (verbose) {
			console.log(`  passos:\n${ctx.steps.map((s) => `    · ${s}`).join("\n")}`);
			for (const bot of ctx.bots) console.log(bot.dump({ lines: 200 }).replace(/^/gm, "  "));
		}
	}
	if (problems.length && !error) {
		console.log(`  ⚠ ${problems.length} linha(s) ERROR/WARN no log do servidor durante o cenário:`);
		for (const l of problems.slice(-10)) console.log(`    ${l}`);
	}
	for (const w of ctx.warnings) console.log(`  ⚠ ${w}`);
	for (const bot of ctx.bots) await bot.close();
	results.push({ name: scenario.name, ok: !error, secs, problems: problems.length });
	// Dá tempo do servidor processar as saídas antes do próximo cenário.
	await sleep(1000);
}

console.log("\n==== resumo E2E ====");
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name} (${r.secs} s)${r.problems ? ` ⚠ ${r.problems} ERROR/WARN no log` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passaram`);

// A VM do Docker é compartilhada com os BDS das outras frentes: não deixa o servidor E2E ocupando
// memória entre execuções. --keep mantém de pé; --rm apaga o container (o mundo fica em .bds-e2e).
if (flag("--rm")) spawnSync("docker", ["rm", "-f", server.container], { stdio: "inherit" });
else if (!flag("--keep")) spawnSync("docker", ["stop", "-t", "20", server.container], { stdio: "ignore" });
process.exit(failed ? 1 : 0);
