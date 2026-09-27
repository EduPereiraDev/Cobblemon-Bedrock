// Empacota cada tests/*.test.ts com esbuild (para resolver imports sem extensão) e roda no Node.
import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Pasta própria por processo: testes de frentes paralelas não se sobrescrevem nem são apagados pelo build.
const out = join(root, ".test-out", String(process.pid));
mkdirSync(out, { recursive: true });
let failed = 0;
for (const file of readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.ts"))) {
	const outfile = join(out, file.replace(/\.ts$/, ".mjs"));
	await build({
		entryPoints: [join(root, "tests", file)], outfile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "error",
		// A API do Minecraft só existe dentro do jogo; nos testes ela é trocada por mocks.
		alias: {
			"@minecraft/server": join(root, "tests", "mocks", "minecraft-server.ts"),
			"@minecraft/server-ui": join(root, "tests", "mocks", "minecraft-server-ui.ts"),
		},
	});
	const run = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
	if (run.status !== 0) { failed++; console.error(`FALHOU: ${file}`); }
}
process.exit(failed ? 1 : 0);
