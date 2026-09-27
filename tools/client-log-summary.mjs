#!/usr/bin/env node
// Resume um content log do cliente Bedrock (ContentLog*.txt) agrupando por categoria e mensagem.
// O BDS não carrega o resource pack nem valida tudo; o log do cliente pega o resto.
//
// Uso: node tools/client-log-summary.mjs <arquivo> [--all] [--level error,warning] [--category Animation,Molang]
//        [--examples N] [--json] [--no-ui]
//  --all        inclui níveis verbose/inform (por padrão só error e warning)
//  --no-ui      esconde a categoria [UI] (frente de JSON UI separada)
//  --examples N quantos arquivos/objetos de exemplo mostrar por grupo (padrão 6)
//  --json       saída em JSON (para comparar execuções)
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const valued = new Set(["--level", "--category", "--examples"]);
const file = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
function opt(name, fallback) {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
if (!file) {
	console.error("uso: node tools/client-log-summary.mjs <ContentLog.txt> [--all] [--level error,warning] [--category X,Y] [--examples N] [--json] [--no-ui]");
	process.exit(2);
}
const levels = args.includes("--all") ? null : new Set(opt("--level", "error,warning").split(","));
const categories = opt("--category", "") ? new Set(opt("--category", "").split(",")) : null;
const maxExamples = Number(opt("--examples", "6"));
const hideUi = args.includes("--no-ui");

// Normaliza o caminho do pack (tira %APPDATA%/.../resource_packs/<pack>/) para o caminho relativo.
function stripPackPath(s) {
	return s
		.replace(/%APPDATA%[^|]*?\/(?:resource_packs|behavior_packs|development_resource_packs|development_behavior_packs)\/[^/|]+\//g, "")
		.replace(/[A-Z]:[\\/][^|]*?[\\/](?:resource_packs|behavior_packs)[\\/][^\\/|]+[\\/]/g, "");
}

// Molde da mensagem: só o tipo do arquivo/objeto (primeiro trecho) + o texto final do erro, com números,
// strings entre aspas e ids trocados por marcadores. Assim o mesmo erro em 200 arquivos/ossos vira um grupo;
// os trechos do meio (animação, osso, expressão) ficam na lista de "assuntos" do grupo.
function generalize(s) {
	return s
		.replace(/'[^']*'/g, "'…'")
		.replace(/"[^"]*"/g, '"…"')
		.replace(/\([^()]*:[^()]*\)/g, "(…)")
		.replace(/\b(animation|controller\.animation|geometry|ctrl)\.[\w.:-]+/g, "$1.*")
		.replace(/\blocator [\w.]+/g, "locator <nome>")
		.replace(/\b(unknown|unrecognized) token: \S+/g, "$1 token: <expr>")
		.replace(/\b[a-z_]+:[a-z0-9_.]+\b/g, "<id>")
		.replace(/-?\d+(\.\d+)?/g, "<n>");
}
function template(parts) {
	const msg = parts[parts.length - 1];
	const lead = parts.length > 1 ? parts[0] : "";
	const kind = generalize(lead
		.replace(/\/[^/]+\.(json|material|lang)$/, "/*.$1"));
	// Caminhos soltos na mensagem (ex.: "Invalid asset path sounds/pokemon/x/x_cry") viram "sounds/…".
	const body = generalize(msg.replace(/\b([a-z_]+)\/[\w\/.-]+/g, "$1/…"));
	return [kind, body].filter((x) => x !== "").join(" | … | ");
}

const text = readFileSync(file, "utf8").replace(/\r/g, "");
const entries = [];
let cur = null;
for (const line of text.split("\n")) {
	const m = /^(?:\d\d:\d\d:\d\d)?\[([A-Za-z]+)\]\[([a-z]+)\]-(.*)$/.exec(line);
	if (m) {
		cur = { category: m[1], level: m[2], raw: stripPackPath(m[3]), extra: [] };
		entries.push(cur);
	} else if (cur && line.trim() && !/^-+$/.test(line.trim())) {
		cur.extra.push(line.trim());
	}
}

const groups = new Map();
const totals = new Map();
for (const e of entries) {
	if (levels && !levels.has(e.level)) continue;
	if (categories && !categories.has(e.category)) continue;
	if (hideUi && e.category === "UI") continue;
	const parts = e.raw.split(" | ").map((p) => p.trim());
	const key = `[${e.category}][${e.level}] ${template(parts)}`;
	const tk = `[${e.category}][${e.level}]`;
	totals.set(tk, (totals.get(tk) ?? 0) + 1);
	let g = groups.get(key);
	if (!g) { g = { key, category: e.category, level: e.level, count: 0, subjects: new Map(), values: new Map(), sample: e.raw, extra: e.extra.slice(0, 3) }; groups.set(key, g); }
	g.count++;
	// "Assunto" = arquivo + objeto (ex.: animations/pokemon/x.animation.json | animation.x.idle) sem a mensagem final.
	const subject = parts.length > 1 ? parts.slice(0, -1).join(" | ") : (e.raw.match(/\b[a-z_]+\/[\w\/.-]+/g)?.pop() ?? e.raw);
	g.subjects.set(subject, (g.subjects.get(subject) ?? 0) + 1);
}

const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
if (args.includes("--json")) {
	console.log(JSON.stringify({
		file,
		totals: Object.fromEntries(totals),
		groups: sorted.map((g) => ({ key: g.key, count: g.count, distinct: g.subjects.size, sample: g.sample, subjects: [...g.subjects.keys()], values: [...g.values.keys()] })),
	}, null, 2));
} else {
	console.log(`# ${file}`);
	console.log("\n## Totais por categoria/nível");
	for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(7)}  ${k}`);
	console.log(`\n## Grupos (${sorted.length})`);
	for (const g of sorted) {
		console.log(`\n${String(g.count).padStart(7)}x  (${g.subjects.size} distintos)  ${g.key}`);
		console.log(`         ex.: ${g.sample.slice(0, 300)}`);
		for (const x of g.extra) console.log(`              ${x.slice(0, 200)}`);
		const subs = [...g.subjects].sort((a, b) => b[1] - a[1]).slice(0, maxExamples);
		for (const [s, n] of subs) console.log(`         - ${n}x ${s.slice(0, 200)}`);
		if (g.subjects.size > maxExamples) console.log(`         … +${g.subjects.size - maxExamples} assuntos`);
		if (g.values.size > 1) console.log(`         valores (${g.values.size}): ${[...g.values.keys()].slice(0, 12).join(", ")}${g.values.size > 12 ? ", …" : ""}`);
	}
}

// Frente cliente-modelos: categorias do content log cobertas pelas regras de `npm run validate`
// (tools/importer/validateClientModels.ts; docs/pendencias/cliente-modelos.md). Conta ocorrências e assuntos distintos.
const CLIENTE_MODELOS = [
	["catmullrom com Molang (a animação não toca)", (e) => e.category === "Animation" && /Precomputed cubic interpolation/.test(e.raw)],
	["Molang recusado em animação", (e) => e.category === "Molang" && /^animations\//.test(e.raw)],
	["Molang recusado em client entity/controller", (e) => e.category === "Molang" && /^(entity|animation_controllers|render_controllers)\//.test(e.raw)],
	["locator repetido entre geometrias da entidade", (e) => e.category === "Geometry" && /Locator: Error/.test(e.raw)],
	["geometria inválida / não encontrada", (e) => e.category === "Geometry" && /Required child identifier|didn't validate|geometry not found/.test(e.raw)],
	["render controller cita geometria não declarada", (e) => e.category === "Molang" && /friendly name 'geometry\./.test(e.raw)],
	["estado de controller com \"animations\": []", (e) => e.category === "Animation" && /^animation_controllers\/.*Required child\s+not found/.test(e.raw)],
	["chave inválida em bones", (e) => e.category === "Animation" && /^animations\/.*not valid here/.test(e.raw)],
];
if (!args.includes("--json")) {
	console.log("\n## Frente cliente-modelos (regras no npm run validate)");
	for (const [label, match] of CLIENTE_MODELOS) {
		const hit = entries.filter(match);
		const subjects = new Set(hit.map((e) => e.raw.split(" | ").slice(0, -1).join(" | ") || e.raw));
		const files = new Set(hit.map((e) => e.raw.split(" | ")[0]));
		console.log(`${String(hit.length).padStart(7)}  ${label} (${subjects.size} assuntos, ${files.size} arquivos/entidades)`);
	}
}

// Frente cliente-log: categorias cobertas por `npm run validate` (tools/importer/clientRules.ts; docs/pendencias/
// cliente-log.md). Deve ficar tudo em 0 num teste novo; o que sobrar aponta a regra que deixou passar.
const CLIENTE_LOG = [
	["som sem arquivo (sound_definitions mesclado)", (e) => e.category === "Json" && /Invalid asset path sounds\//.test(e.raw)],
	["geometria de bloco fora dos limites (bloco some)", (e) => e.category === "Blocks" && /Total length of parts|outside the error bounds|cannot find geometry/.test(e.raw)],
	["feature: v.worldx/v.worldz fora da ordem de avaliação", (e) => e.category === "Molang" && /unknown variable 'variable\.world[xyz]'/.test(e.raw)],
	["partícula: sound_effect que não é LevelSoundEvent", (e) => e.category === "Sound" && /^particles\/.*not a valid LevelSoundEvent/.test(e.raw)],
	["partícula: componente/colisão/flipbook recusado", (e) => (e.category === "Effects" || e.category === "Json") && /^particles\//.test(e.raw)],
	["partícula: Molang recusado", (e) => e.category === "Molang" && /^particles\//.test(e.raw)],
	["entidade escrita à mão sem geometria (barcos)", (e) => e.category === "Geometry" && /_boat \| .*geometry not found/.test(e.raw)],
	["spawner: fatia lenta no tick", (e) => e.category === "Scripting" && /\[spawn\] passe lento/.test(e.raw)],
];
if (!args.includes("--json")) {
	console.log("\n## Frente cliente-log (regras no npm run validate; spawner: aviso do script)");
	for (const [label, match] of CLIENTE_LOG) {
		const hit = entries.filter(match);
		const subjects = new Set(hit.map((e) => e.raw.split(" | ").slice(0, -1).join(" | ") || e.raw));
		console.log(`${String(hit.length).padStart(7)}  ${label} (${subjects.size} assuntos)`);
	}
}
