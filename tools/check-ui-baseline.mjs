// Guarda do JSON UI do port contra mudanças da vanilla (e erros que o BDS não mostra: o servidor não carrega UI).
//
//   node tools/check-ui-baseline.mjs [--tag v1.26.50.4]
//
// Fonte da vanilla: $BEDROCK_SAMPLES (pasta do repositório Mojang/bedrock-samples ou a sua resource_pack/ui) ou um
// clone raso em node_modules/.cache/bedrock-samples/<tag> (baixado com git na primeira vez).
//
// Confere:
//  1. todos os resource_packs/CobblemonBedrock/ui/*.json são JSON válidos (comentários permitidos), com namespace;
//  2. arquivos no mesmo caminho da vanilla (hud_screen.json, server_form.json) só tocam elementos que existem nela e
//     só com `modifications`/propriedades (sem redeclarar `controls`), e os pontos de ancoragem usados existem;
//  3. toda referência `@namespace.elemento` (herança e control_ids) resolve na vanilla ou no próprio pack;
//  4. bindings `view` dos arquivos do HUD/roteador leem alguma #propriedade e os `source_control_name` existem;
//  5. texturas estáticas `textures/gui/cobblemon/**` e `textures/ui/cobblemon/**` existem (generated/ + pack) e as
//     famílias dinâmicas do HUD estão completas (barras por passo, status, bolas);
//  6. o cobblemon_hud.json versionado bate com tools/ui/gen-hud.ts.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tagArg = process.argv.indexOf("--tag");
const TAG = tagArg >= 0 ? process.argv[tagArg + 1] : process.env.BEDROCK_SAMPLES_TAG ?? "v1.26.50.4";
const RP = join(root, "resource_packs", "CobblemonBedrock");
const GEN_RP = join(root, "generated", "resource_packs", "CobblemonBedrock");
const UI = join(RP, "ui");

/** Arquivos do port que esta frente mantém (regras mais estritas). */
const STRICT = new Set(["cobblemon_hud.json", "cobblemon_forms.json", "hud_screen.json", "server_form.json"]);
/** Pontos de ancoragem da vanilla dos quais o port depende (docs/pesquisa/1-interface.md, P0-4). */
const ANCHORS = {
	"hud_screen.json": ["root_panel", "hud_title_text", "hud_actionbar_text"],
	"server_form.json": ["third_party_server_screen", "main_screen_content", "long_form", "custom_form"],
	"npc_interact_screen.json": [],
};

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

/** Remove comentários // e /* *\/ fora de strings (JSON UI da vanilla tem comentários no fim da linha). */
function stripComments(text) {
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			out += ch;
			if (ch === "\\") { out += text[++i] ?? ""; continue; }
			if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") { inString = true; out += ch; continue; }
		if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
		if (ch === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
		out += ch;
	}
	return out;
}

function parseJsonc(file) {
	const text = readFileSync(file, "utf8").replace(/^﻿/, "");
	return JSON.parse(stripComments(text).replace(/,(\s*[}\]])/g, "$1"));
}

/** "nome@ns.base" → { name, base } */
function splitKey(key) {
	const at = key.indexOf("@");
	return at < 0 ? { name: key, base: undefined } : { name: key.slice(0, at), base: key.slice(at + 1) };
}

// ---------------------------------------------------------------------------------------------------------------
// Vanilla

function vanillaUiDir() {
	const candidates = [];
	if (process.env.BEDROCK_SAMPLES) candidates.push(join(process.env.BEDROCK_SAMPLES, "resource_pack", "ui"), process.env.BEDROCK_SAMPLES);
	const cache = join(root, "node_modules", ".cache", "bedrock-samples", TAG);
	candidates.push(join(cache, "resource_pack", "ui"));
	for (const dir of candidates) if (existsSync(join(dir, "hud_screen.json"))) return dir;
	console.log(`baixando Mojang/bedrock-samples ${TAG} (só resource_pack/ui)...`);
	mkdirSync(dirname(cache), { recursive: true });
	const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
	try {
		git("-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", TAG, "--filter=blob:none", "--sparse", "https://github.com/Mojang/bedrock-samples.git", cache);
		git("-C", cache, "sparse-checkout", "set", "resource_pack/ui");
	}
	catch (e) {
		console.error(`não foi possível baixar o bedrock-samples ${TAG}: ${e.message}. Defina BEDROCK_SAMPLES.`);
		process.exit(2);
	}
	return join(cache, "resource_pack", "ui");
}

function loadNamespaces(dir, files, into, origin) {
	for (const rel of files) {
		const file = join(dir, rel);
		if (!existsSync(file)) continue;
		let json;
		try { json = parseJsonc(file); }
		catch (e) { if (origin === "port") fail(`${rel}: JSON inválido (${e.message})`); else warn(`vanilla ${rel}: não parseou (${e.message})`); continue; }
		const ns = json.namespace;
		if (typeof ns !== "string") { if (origin === "port") fail(`${rel}: sem "namespace"`); continue; }
		const map = into.get(ns) ?? new Map();
		for (const key of Object.keys(json)) if (key !== "namespace") map.set(splitKey(key).name, { key, value: json[key], file: rel, origin });
		into.set(ns, map);
	}
}

const vanillaDir = vanillaUiDir();
const vanillaDefs = parseJsonc(join(vanillaDir, "_ui_defs.json")).ui_defs.map((p) => p.replace(/^ui\//, ""));
const vanilla = new Map();
loadNamespaces(vanillaDir, vanillaDefs, vanilla, "vanilla");
const vanillaByFile = new Map();
for (const rel of vanillaDefs) {
	try { vanillaByFile.set(rel, parseJsonc(join(vanillaDir, rel))); } catch { }
}

// ---------------------------------------------------------------------------------------------------------------
// Port

const portFiles = readdirSync(UI).filter((f) => f.endsWith(".json") && f !== "_ui_defs.json");
const portParsed = new Map();
for (const f of portFiles) {
	try { portParsed.set(f, parseJsonc(join(UI, f))); }
	catch (e) { fail(`${f}: JSON inválido (${e.message})`); }
}
const portDefs = parseJsonc(join(UI, "_ui_defs.json")).ui_defs.map((p) => p.replace(/^ui\//, ""));
for (const f of portFiles) {
	if (!vanillaDefs.includes(f) && !portDefs.includes(f)) fail(`${f}: arquivo novo fora do ui/_ui_defs.json`);
}
for (const f of portDefs) if (!portFiles.includes(f)) fail(`_ui_defs.json lista ${f}, que não existe`);

// Namespaces combinados (port por cima da vanilla).
const all = new Map([...vanilla].map(([ns, m]) => [ns, new Map(m)]));
loadNamespaces(UI, portFiles, all, "port");

// 1 + 2. Arquivos no mesmo caminho da vanilla.
for (const [f, json] of portParsed) {
	const vanillaJson = vanillaByFile.get(f);
	if (!vanillaJson) continue;
	if (json.namespace !== vanillaJson.namespace) fail(`${f}: namespace "${json.namespace}" difere da vanilla "${vanillaJson.namespace}"`);
	const vanillaNames = new Map(Object.keys(vanillaJson).map((k) => [splitKey(k).name, k]));
	for (const [key, value] of Object.entries(json)) {
		if (key === "namespace") continue;
		const { name } = splitKey(key);
		const vKey = vanillaNames.get(name);
		if (!vKey) {
			(STRICT.has(f) ? fail : warn)(`${f}: "${name}" não existe na vanilla ${TAG} (elemento novo num arquivo vanilla)`);
			continue;
		}
		if (vKey !== key && key.includes("@")) fail(`${f}: "${key}" não bate com a chave vanilla "${vKey}" (herança diferente redeclara o elemento)`);
		if (STRICT.has(f) && value && typeof value === "object") {
			if ("controls" in value) fail(`${f}: "${name}" redeclara "controls" (use modifications)`);
			for (const mod of value.modifications ?? []) {
				const arr = vanillaJson[vKey]?.[mod.array_name];
				if (mod.array_name === "controls" && !Array.isArray(arr)) fail(`${f}: "${name}" não tem "${mod.array_name}" na vanilla`);
			}
		}
	}
}
for (const [f, anchors] of Object.entries(ANCHORS)) {
	const vanillaJson = vanillaByFile.get(f);
	if (!vanillaJson) { fail(`vanilla ${TAG} sem ${f}`); continue; }
	const names = new Set(Object.keys(vanillaJson).map((k) => splitKey(k).name));
	for (const a of anchors) if (!names.has(a)) fail(`vanilla ${TAG}: ponto de ancoragem ${f}/${a} sumiu`);
}
// Filhos usados por caminho no HUD vanilla.
{
	const title = vanillaByFile.get("hud_screen.json")?.hud_title_text;
	const hasTitle = JSON.stringify(title ?? {}).includes("#hud_title_text_string");
	if (!hasTitle) fail(`vanilla ${TAG}: hud_title_text não usa mais #hud_title_text_string`);
	const factories = JSON.stringify(vanillaByFile.get("hud_screen.json") ?? {});
	if (!factories.includes("hud_title_text_factory")) fail(`vanilla ${TAG}: hud_title_text_factory sumiu`);
	if (!JSON.stringify(vanillaByFile.get("server_form.json") ?? {}).includes("server_form_factory")) fail(`vanilla ${TAG}: server_form_factory sumiu`);
}

// 3. Referências @ns.elemento.
function resolveRef(ref, where) {
	const m = /^@?([a-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(ref);
	if (!m) return;
	const [, ns, name] = m;
	if (!all.get(ns)?.has(name)) fail(`${where}: referência ${ref} não resolve`);
}
function walkRefs(value, where, parentKey) {
	if (Array.isArray(value)) { value.forEach((v) => walkRefs(v, where)); return; }
	if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			const { base } = splitKey(k);
			if (base && /^[a-z0-9_]+\.[A-Za-z0-9_]+$/.test(base)) resolveRef(base, `${where} (${k})`);
			walkRefs(v, where, k);
		}
		return;
	}
	if (typeof value === "string" && value.startsWith("@") && /^@[a-z0-9_]+\.[A-Za-z0-9_]+$/.test(value) && parentKey !== "offset" && parentKey !== "alpha") resolveRef(value, where);
}
for (const [f, json] of portParsed) walkRefs(json, f);

// 4. Bindings dos arquivos estritos.
for (const [f, json] of portParsed) {
	if (!STRICT.has(f)) continue;
	const names = new Set();
	const sources = [];
	const visit = (value) => {
		if (Array.isArray(value)) { value.forEach(visit); return; }
		if (!value || typeof value !== "object") return;
		for (const [k, v] of Object.entries(value)) {
			if (v && typeof v === "object" && !Array.isArray(v) && k !== "property_bag") names.add(splitKey(k).name);
			if (k === "bindings" && Array.isArray(v)) {
				for (const b of v) {
					if (b.binding_type === "view") {
						if (typeof b.source_property_name !== "string" || !b.source_property_name.includes("#"))
							fail(`${f}: binding view sem #propriedade (invalida os bindings do controle): ${JSON.stringify(b)}`);
						if (!b.target_property_name) fail(`${f}: binding view sem target_property_name`);
						const expr = b.source_property_name ?? "";
						if (/\s/.test(expr) && !(expr.startsWith("(") && expr.endsWith(")")))
							fail(`${f}: expressão sem parênteses externos: ${expr}`);
						if (b.source_control_name) sources.push(b.source_control_name);
					}
				}
			}
			visit(v);
		}
	};
	visit(json);
	for (const s of new Set(sources)) if (!names.has(s)) fail(`${f}: source_control_name "${s}" não existe no arquivo`);
}

// 5. Texturas.
const textureExists = (path) => [RP, GEN_RP].some((base) => existsSync(join(base, `${path}.png`)));
const hasGenerated = existsSync(join(GEN_RP, "textures", "gui", "cobblemon"));
if (!hasGenerated) warn("generated/ sem textures/gui/cobblemon: rode `npm run import` para conferir as texturas");
else {
	for (const [f, json] of portParsed) {
		if (!STRICT.has(f)) continue;
		for (const m of JSON.stringify(json).matchAll(/"texture":"(textures\/(?:gui\/cobblemon|ui\/cobblemon)\/[^"]+)"/g))
			if (!textureExists(m[1])) fail(`${f}: textura ${m[1]} não existe`);
	}
	const pad = (n) => String(n).padStart(2, "0");
	const families = [
		...Array.from({ length: 19 }, (_, i) => `textures/ui/cobblemon/hud/hp_v_${pad(i)}`),
		...Array.from({ length: 19 }, (_, i) => `textures/ui/cobblemon/hud/exp_v_${pad(i)}`),
		...Array.from({ length: 98 }, (_, i) => `textures/ui/cobblemon/hud/hp_h_${pad(i)}`),
		...Array.from({ length: 98 }, (_, i) => `textures/ui/cobblemon/hud/hp_hr_${pad(i)}`),
		...["brn", "frz", "par", "psn", "slp", "tox"].map((s) => `textures/gui/cobblemon/party/status_${s}`),
		...["brn", "frz", "par", "psn", "slp", "tox", "fnt"].map((s) => `textures/gui/cobblemon/battle/battle_status_${s}`),
		...["task", "goal", "challenge"].map((s) => `textures/ui/cobblemon/hud/toast_${s}`),
		// Frente batalha-minimizavel: fundo dos golpes do menu do modo `hud` (cor do tipo).
		...["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug",
			"rock", "ghost", "dragon", "dark", "steel", "fairy"].map((t) => `textures/gui/cobblemon/pokedex/platform_base_${t}`),
	];
	for (const path of families) if (!textureExists(path)) fail(`textura dinâmica do HUD ausente: ${path}`);
	const balls = readFileSync(join(root, "scripts", "ui", "glyphs.ts"), "utf8").match(/GLYPH_BALLS = \[([\s\S]*?)\]/)?.[1].match(/"([a-z_]+)"/g) ?? [];
	for (const ball of balls) if (!textureExists(`textures/gui/cobblemon/ball/${ball.replace(/"/g, "")}`)) fail(`ícone de bola ausente: ${ball}`);
	for (const page of ["E2", "E3"]) if (!existsSync(join(GEN_RP, "font", `glyph_${page}.png`))) fail(`font/glyph_${page}.png ausente em generated/`);
	if (existsSync(join(RP, "font", "glyph_E0.png"))) fail("font/glyph_E0.png sobrescreve a página vanilla E0");
}

// 6. Gerador do HUD em dia.
{
	const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(root, "tools", "ui", "gen-hud.ts"), "--check"], { encoding: "utf8" });
	if (run.status !== 0) fail(`cobblemon_hud.json desatualizado: ${run.stderr.trim()}`);
}

for (const w of warnings) console.warn(`AVISO: ${w}`);
if (errors.length) {
	for (const e of errors) console.error(`ERRO: ${e}`);
	console.error(`check-ui-baseline: ${errors.length} erro(s) contra bedrock-samples ${TAG}`);
	process.exit(1);
}
console.log(`check-ui-baseline: ok (bedrock-samples ${TAG}, ${portFiles.length} arquivos de UI do port, ${warnings.length} aviso(s))`);
