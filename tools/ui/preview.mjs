// Frente ui-layout: prévia visual das telas (sem cliente). Empacota tools/ui/preview.ts com os mocks da API do
// Minecraft (como tools/run-tests.mjs) e roda. Saída: docs/ui-preview/<tela>.png (+ .json com os textos do form).
//
//   node tools/ui/preview.mjs                 todas as telas (inclui uma batalha de verdade no mundo falso)
//   node tools/ui/preview.mjs summary pc      só as telas cujo nome contém "summary" ou "pc"
//   node tools/ui/preview.mjs --outline       contorna os rótulos (ver a caixa de cada texto)
//   node tools/ui/preview.mjs --no-battle     sem a batalha (mais rápido)
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, ".test-out", `preview-${process.pid}`);
mkdirSync(out, { recursive: true });
const outfile = join(out, "preview.mjs");
await build({
	entryPoints: [join(root, "tools", "ui", "preview.ts")], outfile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "error",
	alias: {
		"@minecraft/server": join(root, "tests", "mocks", "minecraft-server.ts"),
		"@minecraft/server-ui": join(root, "tests", "mocks", "minecraft-server-ui.ts"),
	},
});
const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit", cwd: root, env: { ...process.env, UI_PREVIEW_ROOT: root } });
process.exit(run.status ?? 1);
