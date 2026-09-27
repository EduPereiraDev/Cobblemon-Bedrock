// Frente cliente-modelos: sintaxe Molang em dois dialetos.
//
// 1. Bedrock (estrito): o que o cliente aceita. `checkBedrockMolang` devolve o primeiro erro (o mesmo tipo de erro que o
//    content log do cliente acusa: token desconhecido, "+" unário, operações sem operador entre elas, vírgula fora de
//    argumentos, parênteses desbalanceados, aninhamento fundo demais). O validador roda isso em todo Molang gerado.
// 2. Java (bedrockk molang 1.1.20, o parser do Cobblemon): tolerante. Medido rodando o jar do Cobblemon
//    (upstream/cobblemon/deps/local/com/bedrockk/molang) sobre as expressões do content log:
//    - lê UMA expressão por instrução e para no primeiro token que não continua a expressão (lixo no fim é ignorado:
//      "a)+b" vale "a", "0.532.5-x" vale "0.532", "cond: 1.0 ? 0.0" vale "cond");
//    - nome sem struct conhecido (NaN, sf, speed, o, ath.sin(...), s.sound(...)) vale 0;
//    - "+" unário existe; "--x" é -(-x);
//    - precedência própria: || liga MAIS forte que && ("a && b || c" = a && (b || c)); comparações no mesmo nível.
//    `javaMolangToBedrock` reimprime a árvore do Java em Molang estrito do Bedrock com parênteses explícitos, então o
//    valor no Bedrock é o mesmo que o Cobblemon calcula.
// `evalMolang` avalia a árvore do Java (graus, como o Molang) para pré-calcular curvas (animations.ts).

export type MolangNode =
	| { k: "num"; text: string }
	| { k: "str"; text: string }
	| { k: "name"; text: string; args: MolangNode[] | null }
	| { k: "unary"; op: "-" | "!" | "+"; e: MolangNode }
	| { k: "bin"; op: string; l: MolangNode; r: MolangNode }
	| { k: "tern"; c: MolangNode; a: MolangNode; b: MolangNode | null }
	| { k: "assign"; l: MolangNode; r: MolangNode }
	| { k: "block"; stmts: MolangNode[] }
	| { k: "index"; e: MolangNode; i: MolangNode }
	| { k: "kw"; text: string; e: MolangNode | null };

interface Token {
	type: "num" | "name" | "str" | "op" | "bad" | "eof";
	text: string;
	pos: number;
}

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "??", "->", "<", ">", "+", "-", "*", "/", "!", "?", ":", ";", ",", "=", "(", ")", "[", "]", "{", "}"];
const KEYWORDS = new Set(["return", "break", "continue", "this", "true", "false", "loop", "for_each"]);
/** Prefixos de nome que o Bedrock aceita (sem diferenciar caixa). */
const BEDROCK_PREFIXES = new Set(["q", "query", "v", "variable", "t", "temp", "c", "context", "math", "geometry", "material", "texture", "array"]);
/** Structs que existem no runtime do Cobblemon (MoLangEnvironment do bedrockk); outro prefixo vale 0 no Java. */
const JAVA_STRUCTS = new Set(["q", "query", "v", "variable", "t", "temp", "c", "context", "math", "array"]);
/**
 * Aninhamento máximo (chamadas de expressão aninhadas neste parser; um ternário "c ? a : (…)" encadeado soma 2 por
 * nível). O cliente recusou 263 ternários encadeados ("stack depth", held_item_anchor do raichu = 526 aqui) e aceitou
 * 111 (unown = 222 aqui): o limite é o maior valor já visto funcionando.
 */
export const MOLANG_MAX_DEPTH = 224;

export class MolangSyntaxError extends Error {
	pos: number;
	constructor(message: string, pos: number) {
		super(message);
		this.pos = pos;
	}
}

export function tokenizeMolang(src: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		const rest = src.slice(i);
		const num = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
		if (num) {
			out.push({ type: "num", text: num[0], pos: i });
			i += num[0].length;
			continue;
		}
		const name = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest);
		if (name) {
			out.push({ type: "name", text: name[0], pos: i });
			i += name[0].length;
			continue;
		}
		if (c === "'") {
			const j = src.indexOf("'", i + 1);
			if (j < 0) {
				out.push({ type: "bad", text: rest, pos: i });
				break;
			}
			out.push({ type: "str", text: src.slice(i, j + 1), pos: i });
			i = j + 1;
			continue;
		}
		const op = OPS.find((o) => rest.startsWith(o));
		if (op) {
			out.push({ type: "op", text: op, pos: i });
			i += op.length;
			continue;
		}
		out.push({ type: "bad", text: c, pos: i });
		i++;
	}
	out.push({ type: "eof", text: "", pos: src.length });
	return out;
}

type Dialect = "bedrock" | "java";

/** Precedência dos operadores binários em cada dialeto (maior = liga mais forte). */
const PRECEDENCE: Record<Dialect, Record<string, number>> = {
	// Bedrock: como C (docs do Molang), ternário abaixo de ??, atribuição por último.
	bedrock: { "=": 1, "?": 2, "??": 3, "||": 4, "&&": 5, "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7, "+": 8, "-": 8, "*": 9, "/": 9, "->": 11, "[": 12 },
	// bedrockk Precedence: ASSIGNMENT 2, CONDITIONAL 3, ARRAY_ACCESS 4, COALESCE 5, AND 6, OR 7, COMPARE 8, SUM 9,
	// PRODUCT 10, PREFIX 11, ARROW 12.
	java: { "=": 2, "?": 3, "[": 4, "??": 5, "&&": 6, "||": 7, "==": 8, "!=": 8, "<": 8, "<=": 8, ">": 8, ">=": 8, "+": 9, "-": 9, "*": 10, "/": 10, "->": 12 },
};
const UNARY_PRECEDENCE: Record<Dialect, number> = { bedrock: 10, java: 11 };

class Parser {
	private toks: Token[];
	private i = 0;
	private depth = 0;
	maxDepth = 0;
	/** Java: nomes com struct desconhecido viram 0 (contados aqui). */
	unknownNames: string[] = [];
	private dialect: Dialect;
	constructor(src: string, dialect: Dialect) {
		this.dialect = dialect;
		this.toks = tokenizeMolang(src);
	}

	peek(): Token {
		return this.toks[this.i];
	}
	next(): Token {
		return this.toks[this.i++];
	}
	private fail(msg: string, t: Token = this.peek()): never {
		throw new MolangSyntaxError(msg, t.pos);
	}
	private isOp(text: string, t: Token = this.peek()): boolean {
		return t.type === "op" && t.text === text;
	}
	private expect(text: string): void {
		if (!this.isOp(text)) this.fail(`esperado '${text}', achou '${this.peek().text || "fim"}'`);
		this.i++;
	}

	/** Programa: instruções separadas por ';'. `single` = só a primeira expressão (bone value do Cobblemon). */
	program(single: boolean): MolangNode[] {
		const stmts: MolangNode[] = [];
		if (this.peek().type === "eof") this.fail("expressão vazia");
		for (;;) {
			stmts.push(this.expr(0));
			if (this.isOp(";")) {
				this.i++;
				if (single) break;
				if (this.peek().type === "eof") break;
				continue;
			}
			break;
		}
		return stmts;
	}

	/** Bedrock: depois do programa só pode vir o fim. */
	end(): void {
		const t = this.peek();
		if (t.type === "eof") return;
		if (this.isOp(",")) this.fail("vírgula fora de argumentos de função");
		if (this.isOp(")")) this.fail("')' sem '(' correspondente");
		if (t.type === "bad") this.fail(`token desconhecido '${t.text}'`);
		this.fail(`operações sem operador entre elas (sobrou '${t.text}')`);
	}

	private enter(): void {
		this.depth++;
		if (this.depth > this.maxDepth) this.maxDepth = this.depth;
		if (this.dialect === "bedrock" && this.depth > MOLANG_MAX_DEPTH) this.fail(`aninhamento maior que ${MOLANG_MAX_DEPTH} (stack depth do cliente)`);
	}

	expr(minPrec: number): MolangNode {
		this.enter();
		let left = this.prefix();
		const prec = PRECEDENCE[this.dialect];
		for (;;) {
			const t = this.peek();
			if (t.type !== "op") break;
			const p = prec[t.text];
			if (p === undefined || p <= minPrec) break;
			if (t.text === "?") {
				this.i++;
				const a = this.expr(this.dialect === "bedrock" ? 1 : p - 1);
				let b: MolangNode | null = null;
				if (this.isOp(":")) {
					this.i++;
					b = this.expr(this.dialect === "bedrock" ? 1 : p - 1);
				}
				left = { k: "tern", c: left, a, b };
				continue;
			}
			if (t.text === "=") {
				this.i++;
				const r = this.expr(p - 1);
				left = { k: "assign", l: left, r };
				continue;
			}
			if (t.text === "[") {
				this.i++;
				const idx = this.expr(0);
				this.expect("]");
				left = { k: "index", e: left, i: idx };
				continue;
			}
			this.i++;
			if (this.dialect === "java" && this.peek().type === "eof") {
				// "1+" no Java monta o nó com o lado direito nulo e falha ao avaliar; aqui fica só o lado esquerdo.
				this.i--;
				break;
			}
			const r = this.expr(p);
			left = { k: "bin", op: t.text, l: left, r };
		}
		this.depth--;
		return left;
	}

	private args(): MolangNode[] {
		this.expect("(");
		const out: MolangNode[] = [];
		if (this.isOp(")")) {
			this.i++;
			return out;
		}
		for (;;) {
			out.push(this.expr(0));
			if (this.isOp(",")) {
				this.i++;
				continue;
			}
			this.expect(")");
			return out;
		}
	}

	private prefix(): MolangNode {
		const t = this.next();
		if (t.type === "num") return { k: "num", text: t.text };
		if (t.type === "str") return { k: "str", text: t.text };
		if (t.type === "bad") this.fail(`token desconhecido '${t.text}'`, t);
		if (t.type === "eof") this.fail("operador no fim da expressão", t);
		if (t.type === "name") {
			const lower = t.text.toLowerCase();
			if (KEYWORDS.has(lower)) return this.keyword(lower, t);
			const args = this.isOp("(") ? this.args() : null;
			const head = lower.split(".")[0];
			const hasField = lower.includes(".");
			if (this.dialect === "bedrock") {
				if (!hasField || !BEDROCK_PREFIXES.has(head)) this.fail(`token desconhecido '${t.text}'`, t);
				return { k: "name", text: t.text, args };
			}
			if (!JAVA_STRUCTS.has(head) || !hasField) {
				this.unknownNames.push(t.text);
				return { k: "num", text: "0" };
			}
			return { k: "name", text: t.text, args };
		}
		// Operadores prefixados.
		switch (t.text) {
			case "(": {
				const e = this.expr(0);
				this.expect(")");
				return e;
			}
			case "{": {
				const stmts: MolangNode[] = [];
				while (!this.isOp("}")) {
					if (this.peek().type === "eof") this.fail("'{' sem '}'");
					stmts.push(this.expr(0));
					if (this.isOp(";")) this.i++;
					else if (!this.isOp("}")) this.fail("instrução sem ';' dentro de '{}'");
				}
				this.i++;
				return { k: "block", stmts };
			}
			case "-":
			case "!":
			case "+": {
				if (this.dialect === "bedrock") {
					if (t.text === "+") this.fail("'+' unário não existe no Bedrock", t);
					const n = this.peek();
					if (t.text === "-" && n.type === "op" && (n.text === "-" || n.text === "+")) this.fail("'-' seguido de outro sinal", n);
				}
				const e = this.expr(UNARY_PRECEDENCE[this.dialect]);
				return { k: "unary", op: t.text as "-" | "!" | "+", e };
			}
		}
		if (t.text === ",") this.fail("vírgula fora de argumentos de função", t);
		if (t.text === ")") this.fail("')' sem '(' correspondente", t);
		return this.fail(`'${t.text}' inesperado`, t);
	}

	private keyword(kw: string, t: Token): MolangNode {
		switch (kw) {
			case "true":
			case "false":
			case "this":
			case "break":
			case "continue":
				return { k: "kw", text: kw, e: null };
			case "return":
				return { k: "kw", text: kw, e: this.expr(0) };
			default: {
				// loop(n, {...}) / for_each(v.x, array, {...})
				if (!this.isOp("(")) this.fail(`${kw} sem argumentos`, t);
				return { k: "name", text: kw, args: this.args() };
			}
		}
	}
}

/** Primeiro erro de sintaxe do Molang no Bedrock (undefined = expressão aceita). */
export function checkBedrockMolang(expr: string): string | undefined {
	if (!expr.trim()) return "expressão vazia";
	try {
		const p = new Parser(expr, "bedrock");
		p.program(false);
		p.end();
		return undefined;
	} catch (e) {
		if (e instanceof MolangSyntaxError) return `${e.message} (posição ${e.pos})`;
		throw e;
	}
}

/** Árvore do Molang no Bedrock (undefined se inválido). */
export function parseBedrockMolang(expr: string): MolangNode[] | undefined {
	try {
		const p = new Parser(expr, "bedrock");
		const out = p.program(false);
		p.end();
		return out;
	} catch {
		return undefined;
	}
}

export interface JavaParse {
	stmts: MolangNode[];
	/** Parte ignorada pelo parser do Java (texto depois do ponto onde ele parou). */
	ignored: string;
	/** Nomes sem struct que valem 0. */
	unknownNames: string[];
}

/**
 * Lê como o Cobblemon (bedrockk). `single`: só a primeira expressão (valores de osso usam parseExpression()).
 * Devolve undefined quando o Java também falharia (ex.: '(' sem ')').
 */
export function parseJavaMolang(expr: string, single = false): JavaParse | undefined {
	try {
		const p = new Parser(expr, "java");
		const stmts = p.program(single);
		const pos = p.peek().pos;
		return { stmts, ignored: expr.slice(pos).trim(), unknownNames: p.unknownNames };
	} catch (e) {
		if (e instanceof MolangSyntaxError) return undefined;
		throw e;
	}
}

// ---------------------------------------------------------------------------------------------
// Impressão em Molang do Bedrock

function isAtom(n: MolangNode): boolean {
	return n.k === "num" || n.k === "str" || n.k === "name" || n.k === "kw" && n.e === null || n.k === "block" || n.k === "index";
}

function wrap(n: MolangNode): string {
	if (n.k === "unary" && n.op === "+") return wrap(n.e);
	const s = printNode(n);
	return isAtom(n) ? s : `(${s})`;
}

function printNode(n: MolangNode): string {
	switch (n.k) {
		case "num":
			return n.text;
		case "str":
			return n.text;
		case "name":
			return n.args ? `${n.text}(${n.args.map(printNode).join(", ")})` : n.text;
		case "kw":
			return n.e ? `${n.text} ${printNode(n.e)}` : n.text;
		case "unary": {
			if (n.op === "+") return printNode(n.e);
			// "-" de número vira literal negativo; o resto ganha parênteses (evita "--x").
			if (n.op === "-" && n.e.k === "num") return `-${n.e.text}`;
			return `${n.op}${wrap(n.e)}`;
		}
		case "bin":
			return `${wrap(n.l)} ${n.op} ${wrap(n.r)}`;
		case "tern":
			return n.b ? `${wrap(n.c)} ? ${wrap(n.a)} : ${wrap(n.b)}` : `${wrap(n.c)} ? ${wrap(n.a)}`;
		case "assign":
			return `${printNode(n.l)} = ${printNode(n.r)}`;
		case "block":
			return `{${n.stmts.map((s) => `${printNode(s)};`).join(" ")}}`;
		case "index":
			return `${wrap(n.e)}[${printNode(n.i)}]`;
	}
}

/** Imprime instruções do Java em Molang do Bedrock (parênteses explícitos: a precedência não importa). */
export function printBedrockMolang(stmts: MolangNode[], statementList: boolean): string {
	if (stmts.length === 1 && !statementList) return printNode(stmts[0]);
	return stmts.map((s) => `${printNode(s)};`).join(" ");
}

/** Mesma árvore (ignorando '+' unário, que o Java descarta, e texto/caixa de números e nomes). */
function sameTree(a: MolangNode, b: MolangNode): boolean {
	if (a.k === "unary" && a.op === "+") return sameTree(a.e, b);
	if (b.k === "unary" && b.op === "+") return sameTree(a, b.e);
	if (a.k !== b.k) return false;
	switch (a.k) {
		case "num":
			return Number(a.text) === Number((b as typeof a).text);
		case "str":
			return a.text === (b as typeof a).text;
		case "name": {
			const o = b as typeof a;
			if (a.text.toLowerCase() !== o.text.toLowerCase() || !!a.args !== !!o.args) return false;
			return !a.args || (a.args.length === o.args!.length && a.args.every((x, i) => sameTree(x, o.args![i])));
		}
		case "kw": {
			const o = b as typeof a;
			return a.text === o.text && (!a.e ? !o.e : !!o.e && sameTree(a.e, o.e));
		}
		case "unary": {
			const o = b as typeof a;
			return a.op === o.op && sameTree(a.e, o.e);
		}
		case "bin": {
			const o = b as typeof a;
			return a.op === o.op && sameTree(a.l, o.l) && sameTree(a.r, o.r);
		}
		case "tern": {
			const o = b as typeof a;
			return sameTree(a.c, o.c) && sameTree(a.a, o.a) && (!a.b ? !o.b : !!o.b && sameTree(a.b, o.b));
		}
		case "assign": {
			const o = b as typeof a;
			return sameTree(a.l, o.l) && sameTree(a.r, o.r);
		}
		case "block": {
			const o = b as typeof a;
			return a.stmts.length === o.stmts.length && a.stmts.every((x, i) => sameTree(x, o.stmts[i]));
		}
		case "index": {
			const o = b as typeof a;
			return sameTree(a.e, o.e) && sameTree(a.i, o.i);
		}
	}
}

export interface MolangRepair {
	expr: string;
	/** Por que mudou (undefined = texto original mantido). */
	reason?: string;
}

/**
 * Molang do Cobblemon → Molang do Bedrock com o MESMO valor que o Java calcula. Se o Bedrock já lê a expressão igual
 * ao Java, o texto fica como está; senão a árvore do Java é reimpressa. `single`: valor de osso (o Java lê só a
 * primeira expressão). Expressão que nem o Java consegue ler vira `fallback`.
 */
export function javaMolangToBedrock(expr: string, single = false, fallback = "0"): MolangRepair {
	const trimmed = expr.trim();
	const java = parseJavaMolang(trimmed, single);
	if (!java) return { expr: fallback, reason: "o Java também não lê (expressão descartada)" };
	const bedrock = parseBedrockMolang(trimmed);
	const statementList = !single && (java.stmts.length > 1 || /;\s*$/.test(trimmed) && !java.ignored);
	if (bedrock && !java.ignored && !java.unknownNames.length && bedrock.length === java.stmts.length && bedrock.every((b, i) => sameTree(java.stmts[i], b))) {
		return { expr };
	}
	const reasons: string[] = [];
	if (java.ignored) reasons.push(`o Java ignora '${java.ignored.slice(0, 40)}'`);
	if (java.unknownNames.length) reasons.push(`nome sem struct vale 0 (${[...new Set(java.unknownNames)].slice(0, 3).join(", ")})`);
	if (!reasons.length) reasons.push(bedrock ? "precedência diferente no Java" : (checkBedrockMolang(trimmed) ?? "sintaxe"));
	const out = printBedrockMolang(java.stmts, statementList);
	// Instrução única terminada em ';' (timeline) continua terminada em ';'.
	return { expr: statementList || !/;\s*$/.test(trimmed) || single ? out : `${out};`, reason: reasons.join("; ") };
}

// ---------------------------------------------------------------------------------------------
// Avaliação (semântica do Java; ângulos em graus) para pré-calcular curvas.

const RAD = Math.PI / 180;
const MATH: Record<string, (a: number[]) => number> = {
	abs: ([x]) => Math.abs(x),
	acos: ([x]) => Math.acos(x) / RAD,
	asin: ([x]) => Math.asin(x) / RAD,
	atan: ([x]) => Math.atan(x) / RAD,
	atan2: ([y, x]) => Math.atan2(y, x) / RAD,
	ceil: ([x]) => Math.ceil(x),
	clamp: ([x, a, b]) => Math.max(a, Math.min(b, x)),
	cos: ([x]) => Math.cos(x * RAD),
	sin: ([x]) => Math.sin(x * RAD),
	exp: ([x]) => Math.exp(x),
	floor: ([x]) => Math.floor(x),
	ln: ([x]) => Math.log(x),
	lerp: ([a, b, t]) => a + (b - a) * t,
	max: ([a, b]) => Math.max(a, b),
	min: ([a, b]) => Math.min(a, b),
	mod: ([a, b]) => a % b,
	pow: ([a, b]) => Math.pow(a, b),
	round: ([x]) => Math.round(x),
	sqrt: ([x]) => Math.sqrt(x),
	trunc: ([x]) => Math.trunc(x),
	sign: ([x]) => (x >= 0 ? 1 : -1),
	hermite_blend: ([t]) => 3 * t * t - 2 * t * t * t,
};

/** A expressão só depende de q.anim_time e de funções determinísticas (dá para pré-calcular). */
export function isAnimTimeOnly(stmts: MolangNode[]): boolean {
	const ok = (n: MolangNode): boolean => {
		switch (n.k) {
			case "num":
				return true;
			case "name": {
				const l = n.text.toLowerCase();
				if (l === "q.anim_time" || l === "query.anim_time") return !n.args;
				if (l === "math.pi") return !n.args;
				if (l.startsWith("math.")) return !!n.args && l.slice(5) in MATH && n.args.every(ok);
				return false;
			}
			case "unary":
				return ok(n.e);
			case "bin":
				return ["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!=", "&&", "||"].includes(n.op) && ok(n.l) && ok(n.r);
			case "tern":
				return ok(n.c) && ok(n.a) && (!n.b || ok(n.b));
			default:
				return false;
		}
	};
	return stmts.length === 1 && ok(stmts[0]);
}

export function evalMolang(n: MolangNode, animTime: number): number {
	const ev = (x: MolangNode): number => evalMolang(x, animTime);
	switch (n.k) {
		case "num":
			return Number(n.text);
		case "name": {
			const l = n.text.toLowerCase();
			if (l === "q.anim_time" || l === "query.anim_time") return animTime;
			if (l === "math.pi") return Math.PI;
			const fn = MATH[l.slice(5)];
			if (l.startsWith("math.") && fn && n.args) return fn(n.args.map(ev));
			throw new Error(`não avaliável: ${n.text}`);
		}
		case "unary":
			return n.op === "-" ? -ev(n.e) : n.op === "!" ? (ev(n.e) === 0 ? 1 : 0) : ev(n.e);
		case "bin": {
			const a = ev(n.l);
			if (n.op === "&&") return a !== 0 && ev(n.r) !== 0 ? 1 : 0;
			if (n.op === "||") return a !== 0 || ev(n.r) !== 0 ? 1 : 0;
			const b = ev(n.r);
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
			throw new Error(`operador não avaliável: ${n.op}`);
		}
		case "tern":
			return ev(n.c) !== 0 ? ev(n.a) : n.b ? ev(n.b) : 0;
		default:
			throw new Error(`nó não avaliável: ${n.k}`);
	}
}
