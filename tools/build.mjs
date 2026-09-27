// Monta os packs em dist/: junta generated/ (saída do importador) com behavior_packs/ e
// resource_packs/ escritos à mão, empacota scripts/main.ts com esbuild e, com --release, gera os .mcaddon.
// Com --no-scripts, não empacota os scripts e remove o módulo de script (e as dependências @minecraft/*) do
// manifest do BP em dist/, para testar só o conteúdo no BDS.
//
// Mega Showdown (licença v2.1: uso privado, proibido redistribuir derivados). Três modos:
// - Desenvolvimento (`npm run build`): se o import gerou o pack MSD (generated/*/CobblemonMegaShowdown), ele vai para
//   dist/ (BP + RP sem script, manifests dependentes do base por UUID e versão) e o main.js leva a extensão e as tabelas
//   do MSD (generated/scripts/msd.ts e megaShowdownContent.ts), dormentes sem o pack no mundo.
// - Público (`npm run build:release`, `npm run build:public`, `--public` ou COBBLEMON_MSD=0): nada do MSD. Sem o pack
//   MSD em dist/, e o main.js troca a extensão e as tabelas por stubs (tools/cleanBuild.mjs). O build FALHA se sobrar
//   string do MSD no main.js, entrada do MSD no bundle ou arquivo "mega_showdown" nos packs. Com --release, gera só
//   dist/Cobblemon.mcaddon: é o único pacote que pode ser publicado.
// - Privado (`npm run build:release -- --private`): base com as tabelas + pack MSD, para uso entre amigos. Gera
//   dist/Cobblemon-private.mcaddon e dist/CobblemonMegaShowdown.mcaddon. NUNCA publicar nenhum dos dois.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublicDist, cleanBuildPlugin, forbiddenInBundle, leakedInputs } from "./cleanBuild.mjs";
import { selfTestManifestPlugin } from "./selftest/manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const noScripts = process.argv.includes("--no-scripts");
const privateBuild = process.argv.includes("--private");
// Público = sem nada do MSD: padrão do --release; --public ou COBBLEMON_MSD=0 também valem sem --release.
const clean = process.argv.includes("--public") || process.env.COBBLEMON_MSD === "0" || (release && !privateBuild);
if (privateBuild && clean) {
	console.error("--private não combina com --public nem com COBBLEMON_MSD=0");
	process.exit(1);
}
const PACK = "CobblemonBedrock";
const MSD_PACK = "CobblemonMegaShowdown";
/** UUIDs fixos do pack MSD (header e módulo). A versão acompanha a do base. */
const MSD_UUID = {
	bp: "5ee3685f-7aed-42e2-a365-f51824f0410d", bpData: "f21a2f0e-6a1a-4a5c-ba0a-a9ba0e6c6a40",
	rp: "752874ff-580d-49e5-af9c-06ae4aaec7ed", rpResources: "7bf7c6e1-feb6-468d-9427-d6f82daeae69",
};
// COBBLEMON_DIST permite builds paralelos em pastas separadas (ex.: dist-batalhas).
const dist = join(root, process.env.COBBLEMON_DIST ?? "dist");
const bpOut = join(dist, "behavior_packs", PACK);
const rpOut = join(dist, "resource_packs", PACK);

const generated = join(root, "generated");
if (!existsSync(join(generated, "resource_packs", PACK))) {
	console.error("generated/ não existe: rode `npm run import` antes do build");
	process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
// Primeiro o conteúdo gerado pelo importador, depois o escrito à mão por cima.
for (const kind of ["behavior_packs", "resource_packs"]) {
	const out = join(dist, kind, PACK);
	mergeTree(join(generated, kind, PACK), out);
	mergeTree(join(root, kind, PACK), out);
}
const withMsd = !clean && existsSync(join(generated, "behavior_packs", MSD_PACK));
if (privateBuild && (!withMsd || !existsSync(join(root, "scripts", "extensions", "megaShowdown", "index.ts")))) {
	console.error("--private precisa do pack MSD em generated/ (`npm run import` com upstream/mega-showdown) e da extensão em scripts/extensions/megaShowdown/");
	process.exit(1);
}
console.log(clean ? "build público: sem nada do Mega Showdown" : privateBuild ? "build privado: com o Mega Showdown (uso entre amigos; NÃO publicar)" : "build de desenvolvimento");
if (withMsd) buildMsdPacks();
else if (!clean) console.log("Mega Showdown: generated/ sem o pack (rode `npm run import` com upstream/mega-showdown no commit fixado)");

/**
 * Pack Mega Showdown: conteúdo gerado (+ escrito à mão em behavior_packs|resource_packs/CobblemonMegaShowdown, se
 * houver) e manifests. Ordem que vale no mundo (prova c, docs/pendencias/msd.md): o RP do MSD depende do BP do MSD e
 * fica ACIMA do RP base; o BDS deriva dali a ordem dos BPs.
 */
function buildMsdPacks() {
	const base = { bp: readJson(join(bpOut, "manifest.json")), rp: readJson(join(rpOut, "manifest.json")) };
	for (const kind of ["behavior_packs", "resource_packs"]) {
		const out = join(dist, kind, MSD_PACK);
		mergeTree(join(generated, kind, MSD_PACK), out);
		mergeTree(join(root, kind, MSD_PACK), out);
	}
	const version = base.bp.header.version;
	const common = {
		format_version: 2,
		metadata: { authors: ["Yajat Kaul e colaboradores (Cobblemon: Mega Showdown)", ...(base.bp.metadata?.authors ?? [])], license: "Mega Showdown License v2.1 (uso privado; ver credits.txt)" },
	};
	const description = "§6Extensão Mega Showdown do Cobblemon Bedrock. Uso privado, não redistribuir (credits.txt). Fique ACIMA do Cobblemon Bedrock.";
	writeFileSync(join(dist, "behavior_packs", MSD_PACK, "manifest.json"), JSON.stringify({
		...common,
		header: { name: "Cobblemon: Mega Showdown (BP)", description, uuid: MSD_UUID.bp, version, min_engine_version: base.bp.header.min_engine_version },
		modules: [{ type: "data", uuid: MSD_UUID.bpData, version }],
		dependencies: [{ uuid: base.bp.header.uuid, version: base.bp.header.version }, { uuid: MSD_UUID.rp, version }],
	}, null, "\t"));
	writeFileSync(join(dist, "resource_packs", MSD_PACK, "manifest.json"), JSON.stringify({
		...common,
		header: { name: "Cobblemon: Mega Showdown (RP)", description, uuid: MSD_UUID.rp, version, min_engine_version: base.rp.header.min_engine_version },
		modules: [{ type: "resources", uuid: MSD_UUID.rpResources, version }],
		dependencies: [{ uuid: MSD_UUID.bp, version }, { uuid: base.rp.header.uuid, version: base.rp.header.version }],
	}, null, "\t"));
	console.log(`Mega Showdown: ${MSD_PACK} (BP + RP) em ${dist}`);
}

/** Copia `src` sobre `dest`. JSON presente nos dois lados é mesclado; .lang é concatenado. */
function mergeTree(src, dest) {
	if (!existsSync(src)) return;
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const from = join(src, entry.name);
		const to = join(dest, entry.name);
		if (entry.isDirectory()) {
			mergeTree(from, to);
			continue;
		}
		mkdirSync(dest, { recursive: true });
		if (existsSync(to) && entry.name.endsWith(".json")) {
			writeFileSync(to, JSON.stringify(deepMerge(readJson(to), readJson(from)), null, "\t"));
		} else if (existsSync(to) && entry.name.endsWith(".lang")) {
			writeFileSync(to, readFileSync(to, "utf8").trimEnd() + "\n" + readFileSync(from, "utf8"));
		} else {
			copyFileSync(from, to);
		}
	}
}

function readJson(file) {
	// Alguns JSON do Bedrock têm comentários (// e /* */, inclusive no fim da linha) e vírgulas sobrando.
	return JSON.parse(stripJsonComments(readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
}

/** Remove comentários fora de strings e vírgulas antes de } ou ]. */
function stripJsonComments(text) {
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			out += c;
			if (c === "\\") { out += text[++i] ?? ""; continue; }
			if (c === '"') inString = false;
			continue;
		}
		if (c === '"') { inString = true; out += c; continue; }
		if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
		if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
		out += c;
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

function deepMerge(a, b) {
	if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
	if (a && b && typeof a === "object" && typeof b === "object") {
		const out = { ...a };
		for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : v;
		return out;
	}
	return b;
}

// O Cobblemon traz learnsets próprios; os do Showdown (5 MB) e a tabela de legalidade não são
// usados em batalha. Trocá-los por stubs deixa o motor com ~2,8 MB.
const slimShowdown = {
	name: "slim-showdown",
	setup(b) {
		b.onLoad({ filter: /@pkmn[\/\\]sim[\/\\]build[\/\\]esm[\/\\]data[\/\\](mods[\/\\][^\/\\]+[\/\\])?learnsets\.mjs$/ }, () => ({
			contents: "export const Learnsets = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? { learnset: {} } : undefined) });",
			loader: "js",
		}));
		b.onLoad({ filter: /@pkmn[\/\\]sim[\/\\]build[\/\\]esm[\/\\]data[\/\\]legality\.mjs$/ }, () => ({
			contents: "export const Legality = {};",
			loader: "js",
		}));
	},
};

if (noScripts) {
	const manifestFile = join(bpOut, "manifest.json");
	const manifest = readJson(manifestFile);
	manifest.modules = manifest.modules.filter((m) => m.type !== "script");
	manifest.dependencies = (manifest.dependencies ?? []).filter((d) => !d.module_name);
	writeFileSync(manifestFile, JSON.stringify(manifest, null, "\t"));
	rmSync(join(bpOut, "scripts"), { recursive: true, force: true });
	console.log("--no-scripts: módulo de script removido do manifest do BP em dist/");
	if (clean) guardPublicDist();
	process.exit(0);
}

/** Build público: nenhum arquivo "mega_showdown" nem texto "mega_showdown" em dist/ (sai com erro). */
function guardPublicDist() {
	const problems = checkPublicDist(dist);
	if (problems.length) {
		console.error(`build público: dist/ com conteúdo do Mega Showdown (${problems.length}):\n  ${problems.slice(0, 20).join("\n  ")}`);
		process.exit(1);
	}
	console.log("build público: packs sem arquivos nem textos do Mega Showdown");
}

const stubbed = new Set();
const started = Date.now();
const result = await build({
	entryPoints: [join(root, "scripts", "main.ts")],
	outfile: join(bpOut, "scripts", "main.js"),
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: "es2022",
	sourcemap: release ? false : "external",
	minify: release,
	metafile: true,
	loader: { ".ts": "ts" },
	external: ["@minecraft/server", "@minecraft/server-ui"],
	mainFields: ["module", "main"],
	banner: { js: "var global = globalThis;" },
	logLevel: "warning",
	// /cobblemon:selftest: partículas, sons, blocos e entidades lidos dos packs já mesclados em dist/.
	plugins: [slimShowdown, selfTestManifestPlugin({ dist }), ...(clean ? [cleanBuildPlugin({ root, stubbed })] : [])],
});
const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes ?? 0;
console.log(`scripts empacotados em ${Date.now() - started}ms (${(bytes / 1e6).toFixed(2)} MB)`);

if (clean) {
	// Guarda do build público: nenhuma string do MSD no main.js, nenhuma entrada do MSD fora dos stubs, nada nos packs.
	const mainJs = join(bpOut, "scripts", "main.js");
	const hits = existsSync(mainJs) ? forbiddenInBundle(readFileSync(mainJs, "utf8")) : [];
	const leaked = leakedInputs(result.metafile, stubbed);
	if (hits.length || leaked.length) {
		if (hits.length) console.error(`build público: main.js com strings do Mega Showdown: ${hits.map(([k, n]) => `${k}×${n}`).join(", ")}`);
		if (leaked.length) console.error(`build público: módulos do Mega Showdown no bundle: ${leaked.join(", ")}`);
		rmSync(mainJs, { force: true });
		process.exit(1);
	}
	console.log(`build público: main.js sem o Mega Showdown (módulos trocados por stub: ${stubbed.size})`);
	guardPublicDist();
}

if (release) {
	// O base privado leva as tabelas do MSD: nome próprio para nunca ser confundido com o pacote público.
	const tag = withMsd ? "-private" : "";
	const addon = join(dist, `Cobblemon${tag}.mcaddon`);
	const zip = (cwd, out) => execFileSync("zip", ["-qr", "-X", out, "."], { cwd });
	zip(bpOut, join(dist, `CobblemonBedrock${tag}_BP.mcpack`));
	zip(rpOut, join(dist, `CobblemonBedrock${tag}_RP.mcpack`));
	execFileSync("zip", ["-q", "-X", addon, `CobblemonBedrock${tag}_BP.mcpack`, `CobblemonBedrock${tag}_RP.mcpack`], { cwd: dist });
	console.log(`pacote gerado: ${addon}${withMsd ? " (uso privado: NÃO publicar)" : " (público)"}`);
	if (withMsd) {
		// Uso privado (Mega Showdown License v2.1): não publicar este .mcaddon.
		const msdAddon = join(dist, `${MSD_PACK}.mcaddon`);
		zip(join(dist, "behavior_packs", MSD_PACK), join(dist, `${MSD_PACK}_BP.mcpack`));
		zip(join(dist, "resource_packs", MSD_PACK), join(dist, `${MSD_PACK}_RP.mcpack`));
		execFileSync("zip", ["-q", "-X", msdAddon, `${MSD_PACK}_BP.mcpack`, `${MSD_PACK}_RP.mcpack`], { cwd: dist });
		console.log(`pacote gerado: ${msdAddon} (uso privado)`);
	}
}

if (!existsSync(join(bpOut, "scripts", "main.js"))) {
	console.error("main.js não foi gerado");
	process.exit(1);
}
