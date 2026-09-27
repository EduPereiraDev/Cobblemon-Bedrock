// Build público (tools/cleanBuild.mjs + tools/build.mjs): o main.js que pode ser publicado não leva nada do Mega Showdown
// (licença v2.1: uso privado). Roda também num clone público, sem a extensão: as partes que dependem dos arquivos
// privados só rodam quando eles existem.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkPublicDist, cleanBuildPlugin, forbiddenInBundle, leakedInputs, stubModule } from "../tools/cleanBuild.mjs";

const ROOT = process.cwd();
assert.ok(existsSync(join(ROOT, "scripts", "main.ts")), "rode os testes na raiz do projeto (npm test)");
const EXTENSION = join(ROOT, "scripts", "extensions", "megaShowdown", "index.ts");
const hasExtension = existsSync(EXTENSION);
const hasMsdData = existsSync(join(ROOT, "generated", "scripts", "msd.ts"))
	&& /MSD_VARIANTS[^=]*=\s*\{\s*"/.test(readFileSync(join(ROOT, "generated", "scripts", "msd.ts"), "utf8"));

// esbuild pelo node_modules em tempo de execução (não dá para empacotar o esbuild dentro do bundle do teste).
const esbuildId = "esbuild";
const { build } = (await import(esbuildId)) as typeof import("esbuild");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
	await fn();
	passed++;
}

/** Mesmas opções do tools/build.mjs (sem o slim-showdown, que só corta tamanho). */
function mainOptions(minify: boolean, plugins: any[]) {
	return {
		entryPoints: [join(ROOT, "scripts", "main.ts")], bundle: true, write: false, format: "esm" as const, platform: "neutral" as const,
		target: "es2022", minify, metafile: true, loader: { ".ts": "ts" as const }, external: ["@minecraft/server", "@minecraft/server-ui"],
		mainFields: ["module", "main"], logLevel: "error" as const, plugins,
	};
}

await test("stub genérico: mesmos exports, dados vazios, funções no-op; export * é erro", async () => {
	const source = [
		"// comentário: export const NAO = 1",
		"export const A: Record<string, string> = {", '\t"venusaur": "{}",', "};",
		'export const B: string = "{\\"effects\\":{}}";',
		"export const C = [1, 2];",
		"export const N = 3;",
		"export type T = { a: 1 };",
		"export interface I { a: number }",
		"export function f(x: number): number { return x; }",
		"export async function g(): Promise<void> {}",
		"export class K {}",
		"const h = 1;",
		"export { h as H };",
	].join("\n");
	const stub = stubModule(source, "fake.ts");
	assert.ok(!stub.includes("venusaur") && !stub.includes("effects"), stub);
	const mod = await import(`data:text/javascript,${encodeURIComponent(stub)}`);
	assert.deepEqual(Object.keys(mod).sort(), ["A", "B", "C", "H", "K", "N", "f", "g"]);
	assert.deepEqual(mod.A, {});
	assert.equal(mod.B, "");
	assert.deepEqual(mod.C, []);
	assert.equal(mod.N, 0);
	assert.equal(mod.f(1), undefined);
	assert.equal(mod.H, undefined);
	assert.throws(() => stubModule('export * from "./x";', "x.ts"), /não entende/);
});

await test("guarda dos packs: nome ou texto mega_showdown em dist/ é erro", () => {
	const dist = mkdtempSync(join(tmpdir(), "cobblemon-clean-"));
	try {
		const rp = join(dist, "resource_packs", "CobblemonBedrock", "texts");
		mkdirSync(rp, { recursive: true });
		writeFileSync(join(rp, "en_US.lang"), "item.cobblemon.poke_ball=Poké Ball\n");
		assert.deepEqual(checkPublicDist(dist), []);
		writeFileSync(join(rp, "pt_BR.lang"), "x=/scriptevent mega_showdown:key_item\n");
		mkdirSync(join(dist, "behavior_packs", "CobblemonBedrock", "items", "mega_showdown"), { recursive: true });
		writeFileSync(join(dist, "CobblemonMegaShowdown.mcaddon"), "");
		const problems = checkPublicDist(dist);
		assert.equal(problems.length, 3, problems.join("\n"));
	} finally {
		rmSync(dist, { recursive: true, force: true });
	}
});

await test("RP base escrito à mão sem nada do MSD (as chaves do comando de itens-chave ficam no RP do MSD)", () => {
	for (const lang of ["en_US", "pt_BR"]) {
		const text = readFileSync(join(ROOT, "resource_packs", "CobblemonBedrock", "texts", `${lang}.lang`), "utf8");
		assert.ok(!text.includes("mega_showdown"), lang);
	}
});

if (existsSync(join(ROOT, "generated", "scripts", "variants.ts"))) {
	for (const minify of [true, false]) {
		await test(`main.js público (${minify ? "release, minificado" : "sem minificar"}): sem MSD_VARIANTS, MSD_CONTENT_JSON, mega_showdown`, async () => {
			const stubbed = new Set<string>();
			const result = await build(mainOptions(minify, [cleanBuildPlugin({ root: ROOT, stubbed })]));
			const text = result.outputFiles[0].text;
			assert.ok(text.length > 1e6, "bundle do base inteiro");
			for (const s of ["MSD_VARIANTS", "MSD_CONTENT_JSON", "MSD_OVERRIDES", "MSD_GIMMICKS_JSON", "mega_showdown", "CobblemonMegaShowdown"]) {
				assert.ok(!text.includes(s), `${s} no main.js público`);
			}
			assert.deepEqual(forbiddenInBundle(text), []);
			assert.deepEqual(leakedInputs(result.metafile, stubbed, ROOT), []);
			// A extensão nem entra no bundle: main.ts cai direto no stub público.
			const inputs = Object.keys(result.metafile.inputs);
			assert.ok(inputs.some((p) => p.endsWith("privateStub.ts")), "stub público no bundle");
			assert.ok(!inputs.some((p) => /megaShowdown[\\/]|generated[\\/]scripts[\\/](msd|megaShowdown)/.test(p)), inputs.filter((p) => /msd|megaShowdown/i.test(p)).join(", "));
		});
	}

	if (hasExtension && hasMsdData) {
		await test("contraprova: o build privado (sem o plugin) leva as tabelas e a extensão", async () => {
			const result = await build(mainOptions(false, []));
			const text = result.outputFiles[0].text;
			assert.ok(text.includes("MSD_VARIANTS") && text.includes("mega_showdown"), "a guarda enxerga o MSD quando ele está no bundle");
			assert.ok(forbiddenInBundle(text).length > 0);
		});
	}
} else console.log("  (pulado) generated/ ausente: rode `npm run import` para testar o bundle público");

if (hasExtension && existsSync(join(ROOT, "generated", "scripts", "msd.ts"))) {
	await test("módulo dormente com as tabelas do MSD vazias: continua funcionando e fica inativo", async () => {
		const out = mkdtempSync(join(tmpdir(), "cobblemon-dormant-"));
		try {
			const outfile = join(out, "dormant.mjs");
			await build({
				stdin: {
					contents: [
						'import { isMegaShowdownActive, startMegaShowdown } from "./scripts/extensions/megaShowdown/index.ts";',
						'import { extendedVariantCount, installExtendedVariants } from "./scripts/extensions/megaShowdown/variants.ts";',
						'import { msdContentData, startMegaShowdownContent } from "./scripts/extensions/megaShowdown/content.ts";',
						"export function run() {",
						"\tconst started = startMegaShowdown(() => undefined);",
						"\treturn { started, active: isMegaShowdownActive(), count: extendedVariantCount(), installed: installExtendedVariants(undefined, {}),",
						"\t\tdata: msdContentData(), content: startMegaShowdownContent(true) };",
						"}",
					].join("\n"),
					resolveDir: ROOT, loader: "ts", sourcefile: "dormant-entry.ts",
				},
				outfile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "error",
				alias: {
					"@minecraft/server": join(ROOT, "tests", "mocks", "minecraft-server.ts"),
					"@minecraft/server-ui": join(ROOT, "tests", "mocks", "minecraft-server-ui.ts"),
				},
				// Só os dados viram stub (extensions: false): o código da extensão é o de verdade.
				plugins: [cleanBuildPlugin({ root: ROOT, extensions: false })],
			});
			const text = readFileSync(outfile, "utf8");
			assert.ok(/MSD_VARIANTS = \{\}/.test(text) && /MSD_CONTENT_JSON = ""/.test(text), "tabelas do MSD vazias no bundle");
			const warn = console.warn;
			console.warn = () => {}; // "pack no mundo, mas o main.js foi gerado sem as tabelas do MSD" é o esperado aqui
			try {
				const { run } = await import(pathToFileURL(outfile).href);
				const r = run();
				assert.equal(r.started, false, "sem o pack no mundo, não liga");
				assert.equal(r.active, false);
				assert.equal(r.count, 0, "sem variantes estendidas");
				assert.equal(r.installed, 0);
				assert.equal(r.data, undefined, "sem tabelas de conteúdo");
				assert.equal(r.content, undefined, "mesmo forçado, não instala nada");
			} finally {
				console.warn = warn;
			}
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
} else console.log("  (pulado) extensão Mega Showdown ausente (repositório público): nada do módulo dormente a testar");

console.log(`build-limpo: ${passed} testes ok`);
