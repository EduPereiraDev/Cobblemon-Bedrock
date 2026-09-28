// Frente ui-layout: interpretador do subconjunto de JSON UI que os geradores do port usam (tools/ui/gen-telas.ts),
// para ver e checar o LAYOUT sem cliente. O BDS não carrega UI e os bots não renderizam; o cliente real é a única
// outra prova. Aqui cada tela é montada com os dados de um form (título, corpo e botões já traduzidos) e vira uma
// lista de nós com retângulo absoluto, textura, texto quebrado em linhas e camada.
//
// Usado por:
//  - tools/ui/preview.mjs (desenha os nós em PNG, docs/ui-preview/);
//  - tests/ui-layout.test.ts (regras: nada de texto/ícone por cima de outro texto/ícone, texto cabe na célula, todo
//    rótulo com largura máxima e cada campo do Java com a sua célula na posição do Java).
//
// Métricas medidas nos prints do cliente (3º teste, 26.x): a linha do rótulo tem 10 px × font_scale_factor e a largura
// dos caracteres é a da fonte do Minecraft (6 px a maioria, "i" 2, "l" 3, espaço 4...). Um glifo de página própria
// (U+E2xx/U+E3xx, célula de 32 px) é desenhado com 32 px × font_scale_factor: o ♀ do resumo (escala 0,75) media 24 px.

/** Largura (avanço, com o espaço de 1 px) dos caracteres ASCII na fonte do Minecraft. Os demais têm 6. */
const ADVANCE = {
	" ": 4, "!": 2, "\"": 5, "'": 3, "(": 5, ")": 5, "*": 5, ",": 2, ".": 2, ":": 2, ";": 2, "<": 5, ">": 5, "@": 7,
	"I": 4, "[": 4, "]": 4, "`": 3, "f": 5, "i": 2, "k": 5, "l": 3, "t": 4, "{": 5, "|": 2, "}": 5, "~": 7,
};
export const LINE_HEIGHT = 10;
export const GLYPH_CELL = 32;

/** Glifo de página do port (tipos, categorias, gênero, bolas). */
export const isPageGlyph = (ch) => { const c = ch.codePointAt(0); return c >= 0xe000 && c <= 0xf8ff; };

/** Avanço de um caractere na escala 1. */
export function charAdvance(ch, bold = false) {
	if (isPageGlyph(ch)) return GLYPH_CELL;
	const base = ch.normalize("NFD")[0] ?? ch;
	const w = ch.charCodeAt(0) > 0x2000 ? 9 : (ADVANCE[base] ?? 6);
	return w + (bold ? 1 : 0);
}

/** Separa o texto em trechos com cor/negrito pelos códigos §. `color` = cor base do rótulo ([r,g,b] 0..1). */
export function styledRuns(text, color = [1, 1, 1]) {
	const runs = [];
	let cur = { text: "", color, bold: false };
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "§" && i + 1 < text.length) {
			const code = text[++i].toLowerCase();
			if (cur.text) runs.push(cur);
			const next = { text: "", color: cur.color, bold: cur.bold };
			if (code in MC_COLORS) { next.color = MC_COLORS[code]; next.bold = false; }
			else if (code === "l") next.bold = true;
			else if (code === "r") { next.color = color; next.bold = false; }
			cur = next;
			continue;
		}
		cur.text += ch;
	}
	if (cur.text) runs.push(cur);
	return runs;
}

const hex = (v) => [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
export const MC_COLORS = {
	0: hex(0x000000), 1: hex(0x0000aa), 2: hex(0x00aa00), 3: hex(0x00aaaa), 4: hex(0xaa0000), 5: hex(0xaa00aa), 6: hex(0xffaa00),
	7: hex(0xaaaaaa), 8: hex(0x555555), 9: hex(0x5555ff), a: hex(0x55ff55), b: hex(0x55ffff), c: hex(0xff5555), d: hex(0xff55ff),
	e: hex(0xffff55), f: hex(0xffffff), g: hex(0xddd605),
};

/** Texto sem códigos §. */
export const plain = (text) => String(text ?? "").replace(/§./g, "");

/** Largura do texto (uma linha) na escala 1. */
export function textWidth(text, color) {
	let w = 0;
	for (const run of styledRuns(text, color)) for (const ch of run.text) w += charAdvance(ch, run.bold);
	return w;
}

/**
 * Quebra em linhas como o rótulo do Bedrock: `\n` força a quebra; com largura, quebra nas palavras e, se uma palavra
 * sozinha não cabe, ela estoura (a checagem acusa). Devolve linhas com os trechos e a largura (escala 1).
 */
export function wrapText(text, maxWidth, color = [1, 1, 1]) {
	const lines = [];
	for (const raw of String(text ?? "").split("\n")) {
		const runs = styledRuns(raw, color);
		// Palavras preservando o estilo de cada caractere.
		const chars = [];
		for (const run of runs) for (const ch of run.text) chars.push({ ch, color: run.color, bold: run.bold });
		let line = [];
		let width = 0;
		let i = 0;
		const flush = () => { lines.push({ chars: line, width }); line = []; width = 0; };
		while (i < chars.length) {
			let j = i;
			while (j < chars.length && chars[j].ch !== " ") j++;
			const word = chars.slice(i, j);
			const wordWidth = word.reduce((s, c) => s + charAdvance(c.ch, c.bold), 0);
			const space = line.length ? charAdvance(" ") : 0;
			if (maxWidth !== undefined && line.length && width + space + wordWidth > maxWidth + 0.01) flush();
			if (line.length) { line.push({ ch: " ", color: word[0]?.color ?? [1, 1, 1], bold: false }); width += charAdvance(" "); }
			line.push(...word);
			width += wordWidth;
			i = j + 1;
			if (j >= chars.length) break;
		}
		flush();
	}
	return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Arquivos e elementos

/** JSON UI do port: tira as linhas de comentário `//` (o gerador põe um cabeçalho). */
export function parseUiFile(src) {
	return JSON.parse(src.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n"));
}

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function splitKey(key) {
	const at = key.indexOf("@");
	return at < 0 ? { name: key, base: undefined } : { name: key.slice(0, at), base: key.slice(at + 1) };
}

/** Índice "ns.nome" → { key, value, ns }. */
export function indexUi(files) {
	const map = new Map();
	for (const json of files) {
		if (!isObject(json) || typeof json.namespace !== "string") continue;
		for (const [key, value] of Object.entries(json)) {
			if (key === "namespace") continue;
			map.set(`${json.namespace}.${splitKey(key).name}`, { key, value, ns: json.namespace });
		}
	}
	return map;
}

/** Bases da vanilla que as telas usam (não estão nos arquivos do port). */
const VANILLA = {
	"common.button": { type: "panel", $vanilla: "button" },
	"common.close_button": { type: "panel", size: [21, 21], $vanilla: "close" },
	"common.scrolling_panel": { type: "panel", $vanilla: "scroll" },
};

/** Definição efetiva de um controle: base (@) + sobrescritas. */
function resolveDef(key, value, ns, index, depth = 0) {
	const { base } = splitKey(key);
	let def = {};
	if (base && depth < 30) {
		const full = base.includes(".") ? base : `${ns}.${base}`;
		if (VANILLA[full]) def = { ...VANILLA[full] };
		else {
			const target = index.get(full);
			if (target) def = { ...resolveDef(target.key, target.value, target.ns, index, depth + 1), $ns: target.ns };
			else def = { type: "panel", $missing: full };
		}
	}
	return { ...def, ...(isObject(value) ? value : {}), $ns: ns ?? def.$ns };
}

// ---------------------------------------------------------------------------------------------------------------
// Expressões de binding (subconjunto: strings, números, #propriedades, not/and/or, =, -, +)

function tokenize(src) {
	const out = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) { i++; continue; }
		if (c === "'") { let j = i + 1; while (j < src.length && src[j] !== "'") j++; out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue; }
		if (c === "(" || c === ")") { out.push({ t: c }); i++; continue; }
		if ("=+-*%<>".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
		const m = /^[#$]?[A-Za-z_][\w.]*|^\d+(\.\d+)?/.exec(src.slice(i));
		if (!m) throw new Error(`expressão: '${src.slice(i, i + 10)}'`);
		const w = m[0];
		if (w === "not" || w === "and" || w === "or") out.push({ t: w });
		else if (/^\d/.test(w)) out.push({ t: "num", v: Number(w) });
		else out.push({ t: "id", v: w });
		i += w.length;
	}
	return out;
}

/** Avalia a expressão com as propriedades do nó. */
export function evalExpr(src, props) {
	const toks = tokenize(src);
	let p = 0;
	const peek = () => toks[p];
	const or = () => { let l = and(); while (peek()?.t === "or") { p++; const r = and(); l = truthy(l) || truthy(r); } return l; };
	const and = () => { let l = cmp(); while (peek()?.t === "and") { p++; const r = cmp(); l = truthy(l) && truthy(r); } return l; };
	const cmp = () => {
		let l = add();
		while (peek()?.t === "op" && "=<>".includes(peek().v)) {
			const op = toks[p++].v; const r = add();
			l = op === "=" ? String(l) === String(r) : op === "<" ? Number(l) < Number(r) : Number(l) > Number(r);
		}
		return l;
	};
	const add = () => {
		let l = unary();
		while (peek()?.t === "op" && "+-".includes(peek().v)) {
			const op = toks[p++].v; const r = unary();
			if (op === "+") l = typeof l === "number" && typeof r === "number" ? l + r : String(l) + String(r);
			else l = typeof l === "number" && typeof r === "number" ? l - r : String(l).split(String(r)).join("");
		}
		return l;
	};
	const unary = () => {
		const tk = toks[p];
		if (tk?.t === "not") { p++; return !truthy(unary()); }
		if (tk?.t === "(") { p++; const v = or(); p++; return v; }
		p++;
		if (tk?.t === "str" || tk?.t === "num") return tk.v;
		if (tk?.t === "id") return props[tk.v] ?? "";
		throw new Error(`expressão inesperada em "${src}"`);
	};
	return or();
}
const truthy = (v) => v === true || (typeof v === "number" ? v !== 0 : v === "true" || v === 1);

// ---------------------------------------------------------------------------------------------------------------
// Montagem da cena

/**
 * @typedef {{ title: string, body: string, buttons: { text: string, icon?: string }[] }} FormData
 * @typedef {{ id: string, path: string, kind: "image"|"label"|"close"|"panel", rect: number[], layer: number,
 *   order: number, cell?: number, cellPath?: string, texture?: string, bound?: boolean, uv?: number[], uvSize?: number[],
 *   alpha?: number, color?: number[], text?: string, lines?: any[], scale?: number, align?: string, shadow?: boolean,
 *   clip?: number[], labelWidthKind?: string }} SceneNode
 */

const ANCHOR = {
	top_left: [0, 0], top_middle: [0.5, 0], top_right: [1, 0], left_middle: [0, 0.5], center: [0.5, 0.5],
	right_middle: [1, 0.5], bottom_left: [0, 1], bottom_middle: [0.5, 1], bottom_right: [1, 1],
};

/** "100% - 4px", "100%c + 12px", 50, "default" → número (ou undefined para "default"/"100%c" sem conteúdo). */
function dimension(value, parent, content) {
	if (typeof value === "number") return value;
	if (typeof value !== "string") return undefined;
	if (value === "default") return undefined;
	let total = 0;
	const re = /([+-])?\s*(\d+(?:\.\d+)?)\s*(%c|%|px)?/g;
	let m;
	let any = false;
	while ((m = re.exec(value))) {
		if (!m[0].trim()) break;
		any = true;
		const sign = m[1] === "-" ? -1 : 1;
		const n = Number(m[2]);
		if (m[3] === "%") total += sign * n / 100 * parent;
		else if (m[3] === "%c") { if (content === undefined) return undefined; total += sign * n / 100 * content; }
		else total += sign * n;
	}
	return any ? total : undefined;
}

/**
 * Monta a cena de um elemento raiz ("ns.nome") numa tela de `viewport` px com os dados do form.
 * @param {Map} index  indexUi(...)
 * @param {string} root
 * @param {FormData} data
 * @returns {{ nodes: SceneNode[], issues: string[] }}
 */
export function buildScene(index, root, data, viewport = [480, 270]) {
	const nodes = [];
	const issues = [];
	let order = 0;
	const globals = { "#title_text": data.title ?? "", "#form_text": data.body ?? "", "#form_button_length": data.buttons.length };
	const button = (i) => data.buttons[i] ?? { text: "", icon: undefined };

	/** Propriedades do nó a partir dos bindings. */
	function bindProps(def, cellIndex) {
		const props = { ...globals };
		for (const b of def.bindings ?? []) {
			if (b.binding_type === "collection_details") continue;
			if (b.binding_type === "view") {
				try { props[b.target_property_name] = evalExpr(b.source_property_name, props); }
				catch (e) { issues.push(`${def.$path}: ${e.message}`); }
				continue;
			}
			const name = b.binding_name;
			const target = b.binding_name_override ?? name;
			if (b.binding_type === "collection") {
				const btn = cellIndex === undefined ? undefined : button(cellIndex);
				const value = name === "#form_button_text" ? btn?.text ?? ""
					: name === "#form_button_texture" ? btn?.icon ?? ""
						: name === "#form_button_texture_file_system" ? "InternalPath" : "";
				props[target] = value;
			}
			else if (name in globals) props[target] = globals[name];
		}
		return props;
	}

	/**
	 * @param {string} key chave do controle ("nome@base")
	 * @param {object} value sobrescritas
	 * @param {number[]} parent retângulo do pai [x, y, w, h]
	 */
	function place(key, value, ns, parent, ctx) {
		const def = resolveDef(key, value, ns, index);
		const name = splitKey(key).name;
		const path = `${ctx.path}/${name}`;
		def.$path = path;
		if (def.$missing) issues.push(`${path}: base não encontrada (${def.$missing})`);
		const cellIndex = typeof def.collection_index === "number" ? def.collection_index : ctx.cell;
		const cellPath = typeof def.collection_index === "number" ? path : ctx.cellPath;
		const props = bindProps(def, cellIndex);
		if (def.visible === false) return;
		if ("#visible" in props && !truthy(props["#visible"])) return;
		// Tamanho: número, %, "100%c" (conteúdo; calculado depois) ou "default" (texto).
		const [sw, sh] = Array.isArray(def.size) ? def.size : ["100%", "100%"];
		let text;
		let lines;
		const scale = typeof def.font_scale_factor === "number" ? def.font_scale_factor : 1;
		if (def.type === "label") {
			text = typeof def.text === "string" && def.text.startsWith("#") ? String(props[def.text] ?? "") : String(ctx.localize(def.text ?? ""));
		}
		let w = dimension(sw, parent[2]);
		let h = dimension(sh, parent[3]);
		if (def.type === "label") {
			lines = wrapText(text, w === undefined ? undefined : w / scale, def.color);
			if (w === undefined) w = Math.max(0, ...lines.map((l) => l.width)) * scale;
			if (h === undefined) h = lines.length * LINE_HEIGHT * scale;
		}
		const contentSized = [sw, sh].map((s) => typeof s === "string" && s.includes("%c"));
		if (w === undefined) w = contentSized[0] ? 0 : parent[2];
		if (h === undefined) h = contentSized[1] ? 0 : parent[3];
		const [fx, fy] = ANCHOR[def.anchor_from ?? "center"] ?? ANCHOR.center;
		const [tx, ty] = ANCHOR[def.anchor_to ?? "center"] ?? ANCHOR.center;
		const [ox, oy] = Array.isArray(def.offset) ? def.offset : [0, 0];
		const offX = dimension(ox, parent[2]) ?? 0;
		const offY = dimension(oy, parent[3]) ?? 0;
		const rect = [parent[0] + fx * parent[2] - tx * w + offX, parent[1] + fy * parent[3] - ty * h + offY, w, h];
		const layer = ctx.layer + (typeof def.layer === "number" ? def.layer : 0);
		const node = { id: `${path}#${order}`, path, name, kind: "panel", rect, layer, order: order++, cell: cellIndex, cellPath, clip: ctx.clip, clipKind: ctx.clipKind, vanilla: def.$vanilla };
		if (def.type === "image") {
			const bound = typeof props["#texture"] === "string";
			const texture = bound ? props["#texture"] : def.texture;
			Object.assign(node, {
				kind: "image", texture, bound, uv: def.uv, uvSize: def.uv_size, alpha: typeof def.alpha === "number" ? def.alpha : 1,
				color: Array.isArray(def.color) ? def.color : undefined,
			});
			if (!texture || texture === "loading") return;
		}
		else if (def.type === "label") {
			Object.assign(node, {
				kind: "label", text, lines, scale, align: def.text_alignment ?? "left", shadow: def.shadow ?? false,
				color: Array.isArray(def.color) ? def.color : [1, 1, 1], labelWidthKind: typeof sw === "number" ? "fixed" : String(sw),
			});
		}
		else if (def.$vanilla === "close") node.kind = "close";
		nodes.push(node);
		const childCtx = { ...ctx, path, cell: cellIndex, cellPath, layer };
		// Painel que corta: o que passa da borda some (truncamento), como no cliente.
		if (def.clips_children === true) { childCtx.clip = intersect(ctx.clip, rect); childCtx.clipKind = "cut"; }
		// Botão da vanilla: só o estado "default" aparece parado.
		let controls = Array.isArray(def.controls) ? def.controls : [];
		if (def.$vanilla === "button") controls = controls.filter((c) => Object.keys(c)[0] === "default");
		if (def.$vanilla === "scroll" && typeof def.$scrolling_content === "string") {
			const [px, py] = def.$scrolling_pane_offset ?? [0, 0];
			const pane = [rect[0] + px, rect[1] + py, dimension(def.$scrolling_pane_size?.[0] ?? "100%", w) ?? w, dimension(def.$scrolling_pane_size?.[1] ?? "100%", h) ?? h];
			controls = [{ [`content@${def.$scrolling_content}`]: { anchor_from: "top_left", anchor_to: "top_left", size: ["100%", "100%c"] } }];
			for (const c of controls) { const k = Object.keys(c)[0]; place(k, c[k], def.$ns, pane, { ...childCtx, clip: intersect(ctx.clip, pane), clipKind: "scroll" }); }
			return;
		}
		if (def.type === "grid" && def.grid_item_template) {
			const templateDef = resolveDef(`item@${def.grid_item_template}`, {}, def.$ns, index);
			const [iw, ih] = templateDef.size ?? [w, 20];
			const cols = def.grid_dimensions?.[0] ?? 1;
			data.buttons.forEach((_, i) => {
				const cellRect = [rect[0] + (i % cols) * iw, rect[1] + Math.floor(i / cols) * ih, iw, ih];
				place(`item_${i}@${def.grid_item_template}`, { collection_index: i, anchor_from: "top_left", anchor_to: "top_left", offset: [0, 0] }, def.$ns, cellRect, { ...childCtx, cell: i });
			});
			return;
		}
		for (const c of controls) {
			if (!isObject(c)) continue;
			const k = Object.keys(c)[0];
			place(k, c[k], def.$ns, rect, childCtx);
		}
	}

	const rootEntry = index.get(root);
	if (!rootEntry) throw new Error(`elemento ${root} não existe`);
	const screen = [0, 0, viewport[0], viewport[1]];
	place(`${splitKey(rootEntry.key).name}@${root}`, {}, rootEntry.ns, screen, {
		path: "", cell: undefined, cellPath: undefined, layer: 0, clip: undefined,
		localize: (text) => (data.lang?.[text] ?? text),
	});
	nodes.sort((a, b) => a.layer - b.layer || a.order - b.order);
	return { nodes, issues };
}

function intersect(a, b) {
	if (!a) return b;
	if (!b) return a;
	const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
	return [x, y, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y)];
}

// ---------------------------------------------------------------------------------------------------------------
// Regras de layout

/** Retângulo ocupado pela tinta do texto (linhas medidas, alinhamento, glifos altos crescem para cima). */
export function inkRect(node) {
	if (node.kind !== "label") return node.rect;
	const [x, y, w] = node.rect;
	const s = node.scale;
	let left = Infinity, right = -Infinity, top = y, bottom = y;
	node.lines.forEach((line, i) => {
		if (!line.chars.length || !line.chars.some((c) => c.ch.trim())) return;
		const lw = line.width * s;
		const lx = node.align === "center" ? x + (w - lw) / 2 : node.align === "right" ? x + w - lw : x;
		left = Math.min(left, lx);
		right = Math.max(right, lx + lw);
		const tall = line.chars.some((c) => isPageGlyph(c.ch)) ? GLYPH_CELL * s : LINE_HEIGHT * s;
		const base = y + (i + 1) * LINE_HEIGHT * s;
		top = i === 0 ? Math.min(y, base - tall) : top;
		bottom = base;
	});
	if (left === Infinity) return undefined;
	return [left, Math.min(top, y), right - left, bottom - Math.min(top, y)];
}

const overlap = (a, b, eps = 0.25) => a[0] < b[0] + b[2] - eps && b[0] < a[0] + a[2] - eps && a[1] < b[1] + b[3] - eps && b[1] < a[1] + a[3] - eps;
const inside = (a, b, eps = 0.51) => a[0] >= b[0] - eps && a[1] >= b[1] - eps && a[0] + a[2] <= b[0] + b[2] + eps && a[1] + a[3] <= b[1] + b[3] + eps;

/**
 * Checa a cena montada. Conteúdo = rótulos com texto e imagens com textura vinda do botão (ícone). Fundos (imagens
 * de textura fixa) podem ficar por baixo de tudo.
 *  - texto que não cabe no rótulo (mais largo, mais linhas que a altura, glifo mais alto que a linha);
 *  - conteúdo por cima de outro conteúdo (exceto pares listados em `allow`, ex.: modelo sobre a plataforma);
 *  - rótulo sem largura máxima (tamanho "default") fora de uma área rolável.
 * @param {{ allow?: [string, string][] }} opts  pares de trechos de caminho que podem se sobrepor
 */
export function checkScene(scene, opts = {}) {
	const issues = [];
	const content = [];
	for (const n of scene.nodes) {
		if (n.kind === "label") {
			const txt = plain(n.text).trim();
			if (!txt) continue;
			if (n.labelWidthKind === "default" && !n.clip) issues.push(`${n.path}: rótulo sem largura máxima`);
			const ink = inkRect(n);
			if (!ink) continue;
			if (n.clipKind === "scroll") {
				// Área rolável: só a largura importa (a altura rola).
				if (ink[0] < n.clip[0] - 0.51 || ink[0] + ink[2] > n.clip[0] + n.clip[2] + 0.51) issues.push(`${n.path}: texto mais largo que a área rolável: "${txt.slice(0, 40)}"`);
			}
			else if (n.clipKind === "cut" && (n.rect[1] < n.clip[1] - 0.5 || n.clip[3] < 1.5 * LINE_HEIGHT * n.scale)) {
				// Janela de UMA linha (clipLine do gerador): o rótulo sobe k linhas e só a linha k aparece. As linhas antes
				// dela não podem quebrar (senão a janela mostra outra coisa) e a linha k tem de caber na largura.
				const lineH = LINE_HEIGHT * n.scale;
				const k = Math.round((n.clip[1] - n.rect[1]) / lineH);
				const raw = wrapText(n.text, undefined, n.color);
				const wrapped = n.lines;
				const same = raw.slice(0, k + 1).every((line, i) => wrapped[i] && Math.abs(wrapped[i].width - line.width) < 0.01);
				if (!same) issues.push(`${n.path}: linhas antes da ${k + 1}ª quebram e empurram a janela: "${txt.slice(0, 40)}"`);
				else if (raw[k] && raw[k].width * n.scale > n.clip[2] + 0.51) issues.push(`AVISO truncado: ${n.path} (linha ${k + 1} com ${Math.round(raw[k].width * n.scale * 10) / 10} px em ${n.clip[2]}): "${txt.slice(0, 40)}"`);
				const line = raw[k];
				if (line && line.chars.some((c) => c.ch.trim())) {
					const lw = Math.min(line.width * n.scale, n.clip[2]);
					const lx = n.align === "center" ? n.rect[0] + (n.rect[2] - lw) / 2 : n.align === "right" ? n.rect[0] + n.rect[2] - lw : n.rect[0];
					content.push({ n, r: intersect([lx, n.clip[1], lw, lineH], n.clip) });
				}
				continue;
			}
			else if (n.clipKind === "cut") {
				// Cortado de propósito (como o Java trunca): aviso, não erro. O que conta é a parte visível.
				if (!inside(ink, n.clip)) issues.push(`AVISO truncado: ${n.path} (${fmt(ink)} em ${fmt(n.clip)}): "${txt.slice(0, 40)}"`);
			}
			else if (!inside(ink, n.rect)) issues.push(`${n.path}: texto não cabe (${fmt(ink)} em ${fmt(n.rect)}): "${txt.slice(0, 40)}"`);
			const visible = n.clip ? intersect(ink, n.clip) : ink;
			if (visible[2] > 0 && visible[3] > 0) content.push({ n, r: visible });
		}
		else if (n.kind === "image" && (n.bound || /^icon/.test(n.name))) content.push({ n, r: n.clip ? intersect(n.rect, n.clip) : n.rect });
		// O X da vanilla também é conteúdo: não pode cobrir campo nenhum.
		else if (n.kind === "close") content.push({ n, r: n.rect });
	}
	// Dois tipos: o 2º ícone vai 15 px à direita do 1º (TypeIcon.secondaryOffset), 3 px por cima de propósito.
	const typeIcon = (n) => /^icon_[a-z]+$/.test(n.name) && !n.name.startsWith("icon_category");
	const allowed = (a, b) => (typeIcon(a) && typeIcon(b)) || (opts.allow ?? []).some(([x, y]) => (a.path.includes(x) && b.path.includes(y)) || (a.path.includes(y) && b.path.includes(x)));
	for (let i = 0; i < content.length; i++) {
		for (let j = i + 1; j < content.length; j++) {
			const a = content[i], b = content[j];
			if (!overlap(a.r, b.r)) continue;
			if (allowed(a.n, b.n)) continue;
			// Imagem que contém o outro inteiro é o fundo dele (moldura da Pokédex, tile da batalha sob o nome).
			if ((a.n.kind === "image" && inside(b.r, a.r, 0.01)) || (b.n.kind === "image" && inside(a.r, b.r, 0.01))) continue;
			issues.push(`sobreposição: ${a.n.path} ${fmt(a.r)} × ${b.n.path} ${fmt(b.r)}`);
		}
	}
	return issues;
}

const fmt = (r) => `[${r.map((v) => Math.round(v * 10) / 10).join(",")}]`;

/** Nós de conteúdo visíveis de uma célula (índice do botão) — para os testes de paridade de campos. */
export function cellContent(scene, cellIndex, within) {
	return scene.nodes.filter((n) => n.cell === cellIndex && (!within || n.path.includes(within)) && ((n.kind === "label" && plain(n.text).trim()) || (n.kind === "image" && n.bound)));
}

/** Nó por trecho do caminho (o primeiro visível). */
export function findNode(scene, fragment) {
	return scene.nodes.find((n) => n.path.includes(fragment));
}
