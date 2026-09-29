// Frente otimizacao: utilidades da etapa de otimização do build (tools/optimize/index.mjs).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Arquivos (caminho relativo com "/") de uma pasta, em ordem. */
export function listFiles(dir) {
	const out = [];
	const walk = (d) => {
		if (!existsSync(d)) return;
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.isFile()) out.push(relative(dir, p).split(sep).join("/"));
		}
	};
	walk(dir);
	return out.sort();
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Remove comentários fora de strings e vírgulas antes de } ou ] (mesma regra do tools/build.mjs). */
export function stripJsonComments(text) {
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

/** JSON de um arquivo do pack (BOM, comentários e vírgulas sobrando aceitos); undefined se inválido. */
export function readJsonLoose(file) {
	try {
		const text = readFileSync(file, "utf8").replace(/^﻿/, "");
		try { return JSON.parse(text); } catch { return JSON.parse(stripJsonComments(text)); }
	} catch {
		return undefined;
	}
}

/** Chama `fn(valor, dono, chave)` para cada string (valores e também chaves de objeto, com `isKey`). */
export function forEachString(value, fn, owner = undefined, key = undefined) {
	if (typeof value === "string") { fn(value, owner, key, false); return; }
	if (Array.isArray(value)) { value.forEach((v, i) => forEachString(v, fn, value, i)); return; }
	if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			fn(k, value, k, true);
			forEachString(v, fn, value, k);
		}
	}
}

/** JSON canônico (chaves em ordem): igualdade de conteúdo independente da ordem das chaves. */
export function canonical(v) {
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
	if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
	return JSON.stringify(v);
}

export const fileSize = (f) => statSync(f).size;

/**
 * Tokens (trechos [A-Za-z0-9_./:-]) de textos que NÃO são reescritos pela otimização (código dos scripts, JSON UI...):
 * um caminho, nome de arquivo ou id que aparece aqui pode ser usado por nome e não pode sumir nem mudar.
 */
export class TokenIndex {
	constructor() {
		this.tokens = new Set();
		this.byRoot = new Map();
	}
	addText(text) {
		for (const m of text.matchAll(/[A-Za-z0-9_.\/:\-]+/g)) this.tokens.add(m[0]);
		this.byRoot.clear();
	}
	has(token) {
		return this.tokens.has(token);
	}
	/** Algum token que começa com `root` é prefixo próprio de `path` (caminho montado por concatenação)? */
	prefixOf(path, root) {
		let list = this.byRoot.get(root);
		if (!list) {
			list = [...this.tokens].filter((t) => t.startsWith(root) && t !== root);
			this.byRoot.set(root, list);
		}
		for (const t of list) if (t.length < path.length && path.startsWith(t)) return t;
		return undefined;
	}
}
