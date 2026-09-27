// Gera retratos fora do `npm run import` (inspeção e folha de contato), sem tocar em generated/.
//   node --experimental-strip-types --no-warnings tools/importer/portraits/cli.ts <saída> [espécies...] [--all] [--workers=N] [--no-cache]
// Lê as combinações do generated/scripts/variants.ts atual e escreve em <saída>/{textures,scripts}.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationIndex } from "../animations.ts";
import { ModelIndex } from "../models.ts";
import { emitPortraits } from "../portraits.ts";
import type { VariantsEntry } from "../scriptsOut.ts";
import { OUT, OUT_RP, OUT_SCRIPTS, ROOT } from "../util.ts";

const args = process.argv.slice(2);
const out = resolve(args[0] ?? "portraits-out");
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const { VARIANTS } = await import(resolve(ROOT, "generated/scripts/variants.ts"));
let species = args.slice(1).filter((a) => !a.startsWith("--"));
if (args.includes("--all") || !species.length) species = args.includes("--all") ? Object.keys(VARIANTS) : ["pikachu", "charizard", "gyarados", "eevee", "bulbasaur"];
const variants = new Map<string, VariantsEntry>(species.filter((s) => VARIANTS[s]).map((s) => [s, VARIANTS[s] as VariantsEntry]));

const t0 = Date.now();
const stats = await emitPortraits({
	variants,
	models: new ModelIndex(),
	anims: new AnimationIndex(new Set()),
	workers: opt("workers") !== undefined ? Number(opt("workers")) : undefined,
	noCache: args.includes("--no-cache"),
});
mkdirSync(out, { recursive: true });
if (existsSync(`${OUT_RP}/textures`)) cpSync(`${OUT_RP}/textures`, `${out}/textures`, { recursive: true });
if (existsSync(OUT_SCRIPTS)) cpSync(OUT_SCRIPTS, `${out}/scripts`, { recursive: true });
rmSync(OUT, { recursive: true, force: true });
console.log(JSON.stringify({ ...stats, wallMs: Date.now() - t0 }, null, 2));
