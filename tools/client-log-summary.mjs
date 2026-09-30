#!/usr/bin/env node
// Resume um content log do cliente Bedrock (ContentLog*.txt) agrupando por categoria e mensagem.
// O BDS não carrega o resource pack nem valida tudo; o log do cliente pega o resto.
//
// Uso: node tools/client-log-summary.mjs <arquivo> [--all | --session N] [--all-levels] [--level error,warning]
//        [--category Animation,Molang] [--examples N] [--json] [--no-ui]
//  Sessões (frente fix3): o mesmo arquivo pode ter vários mundos/versões do pack. Cada sessão começa num bloco de
//  "Plugin Discovered [<pack>] PackId [<uuid>_<versão>]"; por padrão só a ÚLTIMA é resumida (o cabeçalho lista todas
//  com a versão de cada pack).
//  --all        todas as sessões juntas
//  --session N  só a sessão N (1 = a primeira)
//  --all-levels inclui níveis verbose/inform (por padrão só error e warning; antes era `--all`)
//  --no-ui      esconde a categoria [UI] (frente de JSON UI separada)
//  --examples N quantos arquivos/objetos de exemplo mostrar por grupo (padrão 6)
//  --json       saída em JSON (para comparar execuções)
//  Regras extras (opcionais): cada `tools/client-log-rules/*.mjs` (ou a pasta de COBBLEMON_LOG_RULES_DIR) exporta
//  `title` e `rules` — lista `[rótulo, (entrada) => boolean]` ou função `({ root }) => lista` — e ganha uma seção própria
//  com a contagem e exemplos. Serve para pacotes opcionais que não ficam neste repositório; sem a pasta, nada muda.
//  A entrada tem `category`, `level`, `raw` (sem o caminho do pack), `full` (com o caminho) e `extra` (linhas seguintes).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const valued = new Set(["--level", "--category", "--examples", "--session"]);
const file = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
function opt(name, fallback) {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
if (!file) {
	console.error("uso: node tools/client-log-summary.mjs <ContentLog.txt> [--all | --session N] [--all-levels] [--level error,warning] [--category X,Y] [--examples N] [--json] [--no-ui]");
	process.exit(2);
}
const levels = args.includes("--all-levels") ? null : new Set(opt("--level", "error,warning").split(","));
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
const allEntries = [];
let cur = null;
// Frente fix3: sessões. Um bloco de linhas "Plugin Discovered" seguidas abre uma sessão nova.
const PLUGIN = /Plugin Discovered \[([^\]]+)\] PackId \[([0-9a-f-]{36})_([^\]]+)\]/i;
const sessions = [];
let lastWasPlugin = false;
let lineNo = 0;
for (const line of text.split("\n")) {
	lineNo++;
	const m = /^(\d\d:\d\d:\d\d)?\[([A-Za-z]+)\]\[([a-z]+)\]-(.*)$/.exec(line);
	if (m) {
		const plugin = PLUGIN.exec(m[4]);
		if (plugin) {
			if (!lastWasPlugin) sessions.push({ index: sessions.length + 1, line: lineNo, time: m[1] ?? "", packs: [] });
			const packs = sessions[sessions.length - 1].packs;
			if (!packs.some((p) => p.name === plugin[1] && p.version === plugin[3])) packs.push({ name: plugin[1], uuid: plugin[2], version: plugin[3] });
		}
		lastWasPlugin = !!plugin;
		cur = { category: m[2], level: m[3], raw: stripPackPath(m[4]), full: m[4], extra: [], session: sessions.length };
		allEntries.push(cur);
	} else if (cur && line.trim() && !/^-+$/.test(line.trim())) {
		cur.extra.push(line.trim());
	}
}
const wanted = args.includes("--all") ? null : opt("--session", "") ? Number(opt("--session", "")) : sessions.length;
const entries = wanted === null ? allEntries : allEntries.filter((e) => e.session === wanted);
const sessionLabel = (s) => `sessão ${s.index} (linha ${s.line}${s.time ? `, ${s.time}` : ""}): ${s.packs.map((p) => `${p.name} v${p.version}`).join("; ")}`;

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

// Regras extras (pacotes opcionais): carregadas da pasta, cada módulo vira uma seção.
const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rulesDir = process.env.COBBLEMON_LOG_RULES_DIR ?? join(toolRoot, "tools", "client-log-rules");
const extraSections = [];
if (existsSync(rulesDir)) {
	for (const name of readdirSync(rulesDir).filter((f) => f.endsWith(".mjs")).sort()) {
		try {
			const mod = await import(pathToFileURL(join(rulesDir, name)).href);
			const list = typeof mod.rules === "function" ? await mod.rules({ root: toolRoot }) : mod.rules;
			if (!Array.isArray(list)) continue;
			const rules = list.map(([label, match]) => {
				const hit = entries.filter((e) => { try { return match(e); } catch { return false; } });
				const subjects = new Map();
				for (const e of hit) {
					const subject = e.raw.split(" | ").slice(0, -1).join(" | ") || e.raw;
					subjects.set(subject, (subjects.get(subject) ?? 0) + 1);
				}
				return { label, count: hit.length, subjects: [...subjects].sort((a, b) => b[1] - a[1]) };
			});
			extraSections.push({ file: name, title: String(mod.title ?? name), rules });
		} catch (e) {
			extraSections.push({ file: name, title: `${name}: não carregou (${e instanceof Error ? e.message : e})`, rules: [] });
		}
	}
}

if (args.includes("--json")) {
	console.log(JSON.stringify({
		file,
		sessions: sessions.map((s) => ({ ...s, summarized: wanted === null || wanted === s.index })),
		totals: Object.fromEntries(totals),
		groups: sorted.map((g) => ({ key: g.key, count: g.count, distinct: g.subjects.size, sample: g.sample, subjects: [...g.subjects.keys()], values: [...g.values.keys()] })),
		...(extraSections.length ? {
			extra: extraSections.map((x) => ({ file: x.file, title: x.title, rules: x.rules.map((r) => ({ label: r.label, count: r.count, distinct: r.subjects.length, subjects: r.subjects.map(([k]) => k) })) })),
		} : {}),
	}, null, 2));
} else {
	console.log(`# ${file}`);
	console.log(`\n## Sessões (${sessions.length})${wanted === null ? " — todas resumidas (--all)" : ` — resumida: ${wanted}`}`);
	if (allEntries.some((e) => e.session === 0)) console.log(`  sessão 0: ${allEntries.filter((e) => e.session === 0).length} linha(s) antes do primeiro Plugin Discovered`);
	for (const s of sessions) console.log(`${wanted === null || wanted === s.index ? "→" : " "} ${sessionLabel(s)} — ${allEntries.filter((e) => e.session === s.index).length} entradas`);
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

// Frente fix3 (docs/pendencias/cliente-teste2.md): o que o 2º teste em cliente achou. Deve ficar em 0.
const CLIENTE_TESTE2 = [
	["script: estouro de pilha (Watchdog StackOverflow, o mundo cai)", (e) => e.category === "Scripting" && /StackOverflow|Stack overflow/i.test(e.raw)],
	["locator armor_offset.default_neck (head + body com pivô diferente entre formas)", (e) => e.category === "Geometry" && /armor_offset\.default_neck/.test(e.raw)],
	["spawner: fatia lenta no tick", (e) => e.category === "Scripting" && /\[spawn\] passe lento/.test(e.raw)],
	["render_method de bloco recusado", (e) => /render_method/.test(e.raw) && /(error|warning)/.test(e.level)],
];
if (!args.includes("--json")) {
	console.log("\n## Frente fix3 (2º teste em cliente)");
	for (const [label, match] of CLIENTE_TESTE2) {
		const hit = entries.filter(match);
		console.log(`${String(hit.length).padStart(7)}  ${label}`);
	}
}

// Frente cliente-teste3-log (docs/pendencias/cliente-teste3-log.md): o que o 3º teste em cliente achou. Cada linha tem
// regra no `npm run validate` (tools/importer/validateVariables.ts e validateContent.ts) ou correção no script; deve
// ficar em 0 no próximo teste.
const UNKNOWN_VAR = /unhandled request for unknown variable/;
const CLIENTE_TESTE3 = [
	["partícula: variável lida sem definição (v.x ?? padrão no creation_expression)", (e) => e.category === "Molang" && /^particles\//.test(e.raw) && UNKNOWN_VAR.test(e.raw) && !/variable '\.[a-z]/.test(e.raw)],
	["partícula: struct em variável (variable.color.r)", (e) => e.category === "Molang" && /^particles\//.test(e.raw) && (/unable to find member variable/.test(e.raw) || /unknown variable '\.[a-z]/.test(e.raw))],
	["render controller: variável sem inicializar no pre_animation", (e) => e.category === "Molang" && /^render_controllers\//.test(e.raw) && UNKNOWN_VAR.test(e.raw)],
	["animação: variável sem inicializar (cr_o_* colado etc.)", (e) => e.category === "Molang" && /^animations\//.test(e.raw) && UNKNOWN_VAR.test(e.raw)],
	["animation controller: variável sem inicializar (quirk loops/pick)", (e) => e.category === "Molang" && /^animation_controllers\//.test(e.raw) && UNKNOWN_VAR.test(e.raw)],
	["item data-driven sem ícone", (e) => e.category === "Item" && /Missing icon for data-driven item/.test(e.raw)],
	["script: LocationInUnloadedChunkError", (e) => e.category === "Scripting" && /LocationInUnloadedChunkError/.test(e.raw)],
	["spawner: fatia lenta no tick", (e) => e.category === "Scripting" && /\[spawn\] passe lento/.test(e.raw)],
	["selftest: o motor tirou o jogador da montaria", (e) => e.category === "Scripting" && /o motor tirou o jogador da montaria/.test(e.raw)],
];
if (!args.includes("--json")) {
	console.log("\n## Frente cliente-teste3-log (3º teste em cliente; regras no npm run validate)");
	for (const [label, match] of CLIENTE_TESTE3) {
		const hit = entries.filter(match);
		const subjects = new Set(hit.map((e) => e.raw.split(" | ").slice(0, -1).join(" | ") || e.raw));
		console.log(`${String(hit.length).padStart(7)}  ${label} (${subjects.size} assuntos)`);
	}
}

// Seções das regras extras (tools/client-log-rules/*.mjs), com até 3 exemplos por regra.
if (!args.includes("--json")) {
	for (const section of extraSections) {
		console.log(`\n## ${section.title}`);
		for (const rule of section.rules) {
			console.log(`${String(rule.count).padStart(7)}  ${rule.label} (${rule.subjects.length} assuntos)`);
			for (const [subject, n] of rule.subjects.slice(0, 3)) console.log(`           - ${n}x ${subject.slice(0, 220)}`);
			if (rule.subjects.length > 3) console.log(`           … +${rule.subjects.length - 3} assuntos`);
		}
	}
}
