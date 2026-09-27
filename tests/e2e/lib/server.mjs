// Acesso ao BDS de teste (container cobblemon-bds-e2e) pelo tools/server.mjs e pelo docker.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import dgram from "node:dgram";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Ambiente do servidor E2E (pode ser sobrescrito por variáveis). */
export const env = {
	COBBLEMON_BDS: process.env.COBBLEMON_BDS ?? "e2e",
	COBBLEMON_BDS_PORT: process.env.COBBLEMON_BDS_PORT ?? "19148",
	COBBLEMON_DIST: process.env.COBBLEMON_DIST ?? "dist-e2e",
	COBBLEMON_BDS_ONLINE_MODE: process.env.COBBLEMON_BDS_ONLINE_MODE ?? "false",
	// O padrão do tools/server.mjs é NetherNet (clientes oficiais); os bots falam RakNet.
	COBBLEMON_BDS_TRANSPORT: process.env.COBBLEMON_BDS_TRANSPORT ?? "raknet",
};
export const container = `cobblemon-bds-${env.COBBLEMON_BDS}`;

function serverTool(args, opts = {}) {
	return spawnSync(process.execPath, [join(root, "tools", "server.mjs"), ...args], {
		cwd: root, encoding: "utf8", env: { ...process.env, ...env }, ...opts,
	});
}

/** Comando no console do servidor (sem saída; útil para setup que não depende do jogador). */
export function consoleCommand(cmd) {
	const r = serverTool(["cmd", cmd]);
	if (r.status !== 0) throw new Error(`server cmd falhou: ${cmd}\n${r.stderr}`);
}

/** Últimas `n` linhas do log do container. */
export function logTail(n = 200) {
	const r = spawnSync("docker", ["logs", "--tail", String(n), container], { encoding: "utf8" });
	return (r.stdout ?? "") + (r.stderr ?? "");
}

/** Log desde um instante (ISO), para anexar só o que aconteceu durante um cenário. */
export function logSince(iso) {
	const r = spawnSync("docker", ["logs", "--since", iso, container], { encoding: "utf8" });
	return (r.stdout ?? "") + (r.stderr ?? "");
}

export function isRunning() {
	const r = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", container], { encoding: "utf8" });
	return r.stdout.trim() === "true";
}

/** Build em dist-e2e + deploy no container E2E (online-mode=false, transport=raknet). */
export function buildAndDeploy({ build = true } = {}) {
	if (build) {
		const b = spawnSync(process.execPath, [join(root, "tools", "build.mjs")], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
		if (b.status !== 0) throw new Error("build falhou");
	}
	const d = serverTool(["deploy"], { stdio: "inherit" });
	if (d.status !== 0) throw new Error("deploy falhou");
}

/** Ping RakNet "unconnected" (não depende do bedrock-protocol). */
export function ping(port = Number(env.COBBLEMON_BDS_PORT), host = "127.0.0.1", timeout = 2000) {
	return new Promise((res) => {
		const s = dgram.createSocket("udp4");
		const magic = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");
		const b = Buffer.alloc(33);
		b[0] = 0x01;
		b.writeBigInt64BE(BigInt(Date.now()), 1);
		magic.copy(b, 9);
		b.writeBigInt64BE(2n, 25);
		const t = setTimeout(() => { s.close(); res(null); }, timeout);
		s.on("message", (m) => { clearTimeout(t); s.close(); res(m.subarray(35).toString()); });
		s.send(b, port, host);
	});
}

/** Espera o servidor responder ao ping. */
export async function waitReady(timeout = 300_000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const pong = await ping();
		if (pong) return pong;
		await new Promise((r) => setTimeout(r, 2000));
	}
	throw new Error("servidor E2E não respondeu ao ping");
}

// Linhas que não são do add-on (avisos do próprio BDS ou do setup do E2E).
const IGNORED = [
	/Content logging to console is disabled/,
	/A ticking area with the name e2espawn already exists/,
	/No ticking areas? (were )?found|no ticking area/i,
];

/** Linhas do log com problema de conteúdo/script (ERROR/WARN), sem o aviso genérico do NetherNet. */
export function problemLines(text) {
	const lines = text.split("\n");
	const out = [];
	let inBanner = false;
	for (const l of lines) {
		if (/=+ TRANSPORT TYPE ERROR/.test(l)) { inBanner = true; continue; }
		if (inBanner) { if (/={20,}/.test(l)) inBanner = false; continue; }
		if (/\b(ERROR|WARN)\]/.test(l) && !IGNORED.some((re) => re.test(l))) out.push(l);
	}
	return out;
}

/** Estado do container (o Docker Desktop com pouca memória mata o BDS por OOM quando há vários de pé). */
export function state() {
	const r = spawnSync("docker", ["inspect", "-f", "{{.State.Running}} {{.State.OOMKilled}} {{.State.ExitCode}}", container], { encoding: "utf8" });
	const [running, oom, code] = r.stdout.trim().split(" ");
	return { exists: r.status === 0, running: running === "true", oomKilled: oom === "true", exitCode: Number(code) };
}

/** Liga o container de novo (sem deploy). */
export function start() {
	const r = serverTool(["start"], { stdio: "inherit" });
	if (r.status !== 0) throw new Error("start falhou");
}

/** Memória usada pelos containers vs. total da VM do Docker (para avisar risco de OOM). */
export function memoryReport() {
	const total = spawnSync("docker", ["info", "--format", "{{.MemTotal}}"], { encoding: "utf8" }).stdout.trim();
	const stats = spawnSync("docker", ["stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}"], { encoding: "utf8" }).stdout.trim().split("\n");
	const toBytes = (s) => { const m = /([\d.]+)\s*([KMG]i?B)/.exec(s); if (!m) return 0; return Number(m[1]) * ({ KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, KB: 1e3, MB: 1e6, GB: 1e9 }[m[2]] ?? 1); };
	const used = stats.reduce((sum, l) => sum + toBytes(l.split(" ")[1] ?? ""), 0);
	const bds = stats.filter((l) => l.startsWith("cobblemon-bds")).map((l) => l.split(" ")[0]);
	// MemAvailable da VM (a soma dos containers não conta o kernel/cache da VM).
	const meminfo = spawnSync("docker", ["run", "--rm", "--entrypoint", "cat", "itzg/minecraft-bedrock-server:latest", "/proc/meminfo"], { encoding: "utf8" }).stdout ?? "";
	const avail = /MemAvailable:\s+(\d+) kB/.exec(meminfo);
	const totalGiB = Number(total) / 1024 ** 3;
	const availableGiB = avail ? Number(avail[1]) / 1024 ** 2 : totalGiB - used / 1024 ** 3;
	return { totalGiB, usedGiB: used / 1024 ** 3, availableGiB, bds };
}

/** O server.properties do container E2E está com RakNet e online-mode=false? (só o deploy grava isso) */
export function propertiesOk() {
	const file = join(root, `.bds-${env.COBBLEMON_BDS}`, "server.properties");
	if (!existsSync(file)) return false;
	const text = readFileSync(file, "utf8");
	return new RegExp(`^transport=${env.COBBLEMON_BDS_TRANSPORT}$`, "m").test(text)
		&& new RegExp(`^online-mode=${env.COBBLEMON_BDS_ONLINE_MODE}$`, "m").test(text);
}
