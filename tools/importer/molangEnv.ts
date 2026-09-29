// Frente otimizacao: avaliador Molang pequeno, com variáveis e propriedades, para as PROVAS de equivalência (#6 e #12):
// avalia o texto emitido (depois de passar pelo parser do Bedrock de molangSyntax.ts) para cada valor das entradas e
// compara com a versão antiga. Só o que as expressões comparadas usam; qualquer outra coisa é erro (nunca "0" calado).
import { parseBedrockMolang } from "./molangSyntax.ts";
import type { MolangNode } from "./molangSyntax.ts";

export interface MolangEnv {
	/** v.* (chave "v.nome", minúsculo). Ausente = undefined (o `??` do Molang). */
	vars: Map<string, number>;
	/** t.* (chave "t.nome"), por expressão. */
	temps?: Map<string, number>;
	/** q.property('id'). */
	props: Map<string, number>;
}

const MATH: Record<string, (a: number[]) => number> = {
	mod: ([a, b]) => a % b,
	floor: ([a]) => Math.floor(a),
	abs: ([a]) => Math.abs(a),
	min: ([a, b]) => Math.min(a, b),
	max: ([a, b]) => Math.max(a, b),
	clamp: ([a, lo, hi]) => Math.min(Math.max(a, lo), hi),
};

function varKey(text: string): { kind: "v" | "t"; key: string } | undefined {
	const l = text.toLowerCase();
	const dot = l.indexOf(".");
	const ns = l.slice(0, dot);
	const rest = l.slice(dot + 1);
	if (ns === "v" || ns === "variable") return { kind: "v", key: `v.${rest}` };
	if (ns === "t" || ns === "temp") return { kind: "t", key: `t.${rest}` };
	return undefined;
}

const unquote = (s: string) => s.replace(/^'(.*)'$/, "$1");

/** Valor de um nó; `undefined` só para variável não definida (o `??` decide). */
function value(n: MolangNode, env: MolangEnv): number | undefined {
	switch (n.k) {
		case "num":
			return Number(n.text);
		case "name": {
			const v = varKey(n.text);
			if (v && !n.args) return (v.kind === "v" ? env.vars : (env.temps ??= new Map())).get(v.key);
			const l = n.text.toLowerCase();
			if ((l === "q.property" || l === "query.property") && n.args?.length === 1 && n.args[0].k === "str") {
				const id = unquote(n.args[0].text);
				if (!env.props.has(id)) throw new Error(`propriedade sem valor na prova: ${id}`);
				return env.props.get(id)!;
			}
			if (l.startsWith("math.") && n.args && MATH[l.slice(5)]) return MATH[l.slice(5)](n.args.map((a) => num(a, env)));
			throw new Error(`nome não suportado pela prova: ${n.text}`);
		}
		case "unary": {
			const e = num(n.e, env);
			return n.op === "-" ? -e : n.op === "!" ? (e === 0 ? 1 : 0) : e;
		}
		case "bin": {
			if (n.op === "??") {
				const l = value(n.l, env);
				return l === undefined ? value(n.r, env) : l;
			}
			const a = num(n.l, env);
			if (n.op === "&&") return a !== 0 && num(n.r, env) !== 0 ? 1 : 0;
			if (n.op === "||") return a !== 0 || num(n.r, env) !== 0 ? 1 : 0;
			const b = num(n.r, env);
			switch (n.op) {
				case "+": return a + b;
				case "-": return a - b;
				case "*": return a * b;
				case "/": return a / b;
				case "<": return a < b ? 1 : 0;
				case "<=": return a <= b ? 1 : 0;
				case ">": return a > b ? 1 : 0;
				case ">=": return a >= b ? 1 : 0;
				case "==": return a === b ? 1 : 0;
				case "!=": return a !== b ? 1 : 0;
			}
			throw new Error(`operador não suportado pela prova: ${n.op}`);
		}
		case "tern": {
			const c = num(n.c, env) !== 0;
			if (c) return value(n.a, env);
			return n.b ? value(n.b, env) : 0;
		}
		case "assign": {
			const v = n.l.k === "name" ? varKey(n.l.text) : undefined;
			if (!v) throw new Error("atribuição a algo que não é variável");
			const r = value(n.r, env);
			const map = v.kind === "v" ? env.vars : (env.temps ??= new Map());
			if (r === undefined) map.delete(v.key);
			else map.set(v.key, r);
			return 0;
		}
		case "block":
			for (const s of n.stmts) value(s, env);
			return 0;
		default:
			throw new Error(`nó não suportado pela prova: ${n.k}`);
	}
}

function num(n: MolangNode, env: MolangEnv): number {
	const v = value(n, env);
	// Variável inexistente vale 0 no Molang do Bedrock (o validador do pack exige inicialização; aqui só não quebra).
	return v ?? 0;
}

const cache = new Map<string, MolangNode[]>();

/** Árvore de uma expressão (com cache); erro se o parser do Bedrock recusar. */
export function parseForProof(expr: string): MolangNode[] {
	let stmts = cache.get(expr);
	if (!stmts) {
		const parsed = parseBedrockMolang(expr);
		if (!parsed) throw new Error(`Molang recusado pelo parser: ${expr.slice(0, 120)}`);
		stmts = parsed;
		if (cache.size > 20000) cache.clear();
		cache.set(expr, stmts);
	}
	return stmts;
}

/** Valor de uma expressão simples (uma instrução, sem `;`): o que um filtro/condição devolve. */
export function evaluate(expr: string, env: MolangEnv): number {
	const stmts = parseForProof(expr);
	env.temps = new Map();
	let out = 0;
	for (const s of stmts) out = num(s, env);
	return out;
}

/** Executa uma lista de instruções (pre_animation, on_entry): só os efeitos nas variáveis. */
export function execute(expr: string, env: MolangEnv): void {
	const stmts = parseForProof(expr);
	env.temps = new Map();
	for (const s of stmts) value(s, env);
}
