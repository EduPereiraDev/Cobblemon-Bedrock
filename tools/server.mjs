// Servidor Bedrock (BDS) local em Docker para testar os packs.
//   node tools/server.mjs deploy       copia dist/ para o servidor e reinicia
//   node tools/server.mjs deploy --msd copia também o pack Mega Showdown (acima do base) e liga no mundo
//   node tools/server.mjs packs        mostra quais packs o deploy ligaria, na ordem (topo primeiro)
//   node tools/server.mjs start|stop   liga/desliga o container
//   node tools/server.mjs logs [n]     últimas n linhas do log (padrão 200)
//   node tools/server.mjs cmd "<cmd>"  envia um comando ao console do servidor
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { OPTIONAL_PACKS, distPacks, manifestRef, selectPacks } from "./packStack.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Variáveis para servidores paralelos (uma frente por servidor):
//   COBBLEMON_BDS=<nome>  → container cobblemon-bds-<nome>, dados em .bds-<nome>
//   COBBLEMON_BDS_PORT=<porta UDP no host> (padrão 19132)   COBBLEMON_DIST=<pasta do build> (padrão dist)
const SUFFIX = process.env.COBBLEMON_BDS ? `-${process.env.COBBLEMON_BDS}` : "";
const data = join(root, `.bds${SUFFIX}`);
const CONTAINER = `cobblemon-bds${SUFFIX}`;
const HOST_PORT = process.env.COBBLEMON_BDS_PORT ?? "19132";
const DIST = join(root, process.env.COBBLEMON_DIST ?? "dist");
const LEVEL = "cobblemon";
// Packs no mundo (frente msd-infra, docs/pendencias/msd.md; lógica em tools/packStack.mjs): o deploy liga todos os
// packs de DIST, exceto as extensões opcionais, que só entram quando pedidas (--msd ou COBBLEMON_MSD=1).
// COBBLEMON_BDS_PACKS=<a,b,...> fixa a lista e a ordem à mão (topo da pilha primeiro). Sem a lista, quem depende de
// outro pack (por UUID no manifest) fica ACIMA dele: o pack mais alto vence (entidades substituídas do MSD).
// COBBLEMON_BDS_ONLINE_MODE=false → online-mode=false (bots de protocolo do E2E entram sem conta Xbox).
// Sem a variável, o padrão do BDS (online-mode=true) fica como está.
const ONLINE_MODE = process.env.COBBLEMON_BDS_ONLINE_MODE;
// Transporte: "nethernet" (padrão do BDS 26.x e o único que clientes oficiais usam; handshake HTTP em TCP na
// porta do servidor + UDP negociado) ou "raknet" (UDP clássico; o que os bots de protocolo do E2E falam).
const TRANSPORT = process.env.COBBLEMON_BDS_TRANSPORT ?? "nethernet";
// Faixa UDP fixa do NetherNet, publicada no Docker e anunciada aos clientes com o IP do Mac na rede local.
const UDP_RANGE = process.env.COBBLEMON_BDS_UDP_RANGE ?? "19200-19209";
// Box64 (frente estabilidade, docs/pendencias/estabilidade.md): no Mac (arm64) a imagem roda o BDS x86-64 pelo box64.
// Sem ordem de memória forte, corridas entre as threads do BDS travam o carregamento de chunks (bot/jogador sem spawn,
// y = 32769, e chunks "fora do mundo") e às vezes corrompem o heap (quedas nativas). STRONGMEM=1 resolve, sem custo
// medido. COBBLEMON_BDS_BOX64_STRONGMEM=0 desliga (só para comparar). Em host x86-64 o box64 não é usado.
const BOX64_ENV = [`BOX64_DYNAREC_STRONGMEM=${process.env.COBBLEMON_BDS_BOX64_STRONGMEM ?? "1"}`];
function lanAddress() {
	for (const iface of ["en0", "en1"]) {
		const r = spawnSync("ipconfig", ["getifaddr", iface], { encoding: "utf8" });
		if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
	}
	return undefined;
}

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" });
const running = () => spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" }).stdout.trim() === "true";

function start() {
	if (running()) return;
	const exists = spawnSync("docker", ["inspect", CONTAINER]).status === 0;
	// As portas publicadas são fixadas na criação do container: recria se o mapeamento mudou.
	const ports = exists ? spawnSync("docker", ["inspect", "-f", "{{json .HostConfig.PortBindings}}", CONTAINER], { encoding: "utf8" }).stdout : "";
	const wantsUdpRange = TRANSPORT === "nethernet";
	if (exists && (!ports.includes(`"${HOST_PORT}"`) || wantsUdpRange !== ports.includes(UDP_RANGE.split("-")[0]))) docker("rm", "-f", CONTAINER);
	// O ambiente também é fixado na criação: recria o container antigo sem o ajuste do box64 (o mundo fica no volume).
	else if (exists) {
		const env = spawnSync("docker", ["inspect", "-f", "{{json .Config.Env}}", CONTAINER], { encoding: "utf8" }).stdout;
		if (BOX64_ENV.some((e) => !env.includes(`"${e}"`))) docker("rm", "-f", CONTAINER);
	}
	if (spawnSync("docker", ["inspect", CONTAINER]).status === 0) docker("start", CONTAINER);
	else {
		mkdirSync(data, { recursive: true });
		docker("run", "-d", "--name", CONTAINER,
			"-e", "EULA=TRUE", "-e", "VERSION=LATEST", "-e", `LEVEL_NAME=${LEVEL}`,
			"-e", "ALLOW_CHEATS=true", "-e", "ALLOW_LIST=false", "-e", "DEFAULT_PLAYER_PERMISSION_LEVEL=operator",
			"-e", "TEXTUREPACK_REQUIRED=true",
			...BOX64_ENV.flatMap((e) => ["-e", e]),
			...(ONLINE_MODE ? ["-e", `ONLINE_MODE=${ONLINE_MODE}`] : []),
			"-p", `${HOST_PORT}:19132/udp`, "-p", `${HOST_PORT}:19132/tcp`,
			...(wantsUdpRange ? ["-p", `${UDP_RANGE}:${UDP_RANGE}/udp`] : []),
			"-v", `${data}:/data`, "itzg/minecraft-bedrock-server:latest");
	}
	waitFor(/Server started|Stopping server|Quit correctly/);
}

function stop() {
	if (running()) docker("stop", "-t", "30", CONTAINER);
}

function waitFor(pattern, timeoutMs = 300_000) {
	const since = new Date().toISOString();
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		const out = spawnSync("docker", ["logs", "--since", since, CONTAINER], { encoding: "utf8" });
		if (pattern.test(out.stdout + out.stderr)) return;
		spawnSync("sleep", ["2"]);
	}
	throw new Error(`timeout esperando ${pattern}`);
}

function setProperty(key, value) {
	const file = join(data, "server.properties");
	let text = readFileSync(file, "utf8");
	const re = new RegExp(`^${key}=.*$`, "m");
	text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}\n${key}=${value}\n`;
	writeFileSync(file, text);
}

/** Packs que o deploy liga, por tipo, na ordem do mundo (topo primeiro). */
function selectedPacks() {
	const explicit = process.env.COBBLEMON_BDS_PACKS?.split(",").map((x) => x.trim()).filter(Boolean);
	const enabled = new Set(Object.values(OPTIONAL_PACKS).filter((flag) => process.argv.includes(`--${flag}`) || process.env[`COBBLEMON_${flag.toUpperCase()}`] === "1"));
	return selectPacks(DIST, { explicit, enabled });
}

function deploy() {
	const packs = selectedPacks();
	if (!packs.behavior_packs.length) throw new Error("rode `npm run build` antes");
	if (!existsSync(join(data, "server.properties"))) start();
	stop();
	for (const kind of ["behavior_packs", "resource_packs"]) {
		// Packs de DIST fora da seleção saem da pasta do servidor (ex.: o MSD de um deploy anterior).
		for (const p of distPacks(DIST, kind)) rmSync(join(data, kind, p.name), { recursive: true, force: true });
		for (const p of packs[kind]) cpSync(p.dir, join(data, kind, p.name), { recursive: true });
	}
	const world = join(data, "worlds", LEVEL);
	mkdirSync(world, { recursive: true });
	writeFileSync(join(world, "world_behavior_packs.json"), JSON.stringify(packs.behavior_packs.map((p) => manifestRef(p.manifest)), null, 2));
	writeFileSync(join(world, "world_resource_packs.json"), JSON.stringify(packs.resource_packs.map((p) => manifestRef(p.manifest)), null, 2));
	console.log(`packs no mundo (topo primeiro): BP ${packs.behavior_packs.map((p) => p.name).join(" > ")}; RP ${packs.resource_packs.map((p) => p.name).join(" > ")}`);
	setProperty("content-log-file-enabled", "true");
	setProperty("content-log-console-output-enabled", "true");
	setProperty("texturepack-required", "true");
	setProperty("allow-list", "false");
	setProperty("transport", TRANSPORT);
	if (TRANSPORT === "nethernet") {
		const lan = lanAddress();
		setProperty("server-udp-ports", lan ? `${lan}:${UDP_RANGE}:${UDP_RANGE}` : UDP_RANGE);
	}
	if (ONLINE_MODE) setProperty("online-mode", ONLINE_MODE);
	start();
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
	case "start": start(); break;
	case "stop": stop(); break;
	case "deploy": deploy(); console.log("deploy ok"); break;
	case "packs": {
		const packs = selectedPacks();
		for (const kind of ["behavior_packs", "resource_packs"]) console.log(`${kind}: ${packs[kind].map((p) => `${p.name} ${p.manifest.header.version.join(".")}`).join(" > ") || "(nenhum)"}`);
		break;
	}
	case "logs": process.stdout.write(spawnSync("docker", ["logs", "--tail", rest[0] ?? "200", CONTAINER], { encoding: "utf8" }).stdout); break;
	case "cmd": docker("exec", CONTAINER, "send-command", rest.join(" ")); break;
	default: console.log("uso: node tools/server.mjs deploy [--msd]|packs [--msd]|start|stop|logs [n]|cmd \"<comando>\""); process.exit(1);
}
