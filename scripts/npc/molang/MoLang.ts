/**
 * Mini-interpretador de MoLang para os scripts do servidor (diálogos, interações de NPC, callbacks).
 *
 * O Cobblemon usa o Mocha (MoLang no servidor) com structs de consulta (`q.player`, `q.npc`, `q.dialogue`),
 * variáveis (`v.`), temporárias (`t.`) e contexto (`c.`). O Bedrock não roda MoLang arbitrário no servidor,
 * então este módulo implementa o subconjunto usado pelos dados do Cobblemon 1.8.2:
 *
 * - literais número/string ('texto', com \' e \\), `true`/`false`;
 * - `q./query.`, `v./variable.`, `t./temp.`, `c./context.`, `math.`; acesso a membro em cadeia e chamadas
 *   (`q.player.main_held_item.is_of('minecraft:iron_sword')`); função sem parênteses é chamada sem argumentos
 *   (`q.player.username`), como no Mocha;
 * - atribuição (`t.data.scared_npc = true`), `! -` unários, `* / + -`, `< <= > >= == !=`, `&& ||`, `??`,
 *   ternário `a ? b : c` e condicional binário `a ? b`;
 * - blocos `{ ...; }`, `return`, `break`, `continue`, `loop(n, {...})`, `for_each(t.x, array, {...})`.
 *
 * O valor de uma expressão com várias instruções é o do `return` ou o da última instrução (como o
 * `resolve` do Cobblemon com listas de expressões).
 */

import { registerGeneralFunctions } from "../../molang/GeneralFunctions"; // frente dados-ia

// ---------------------------------------------------------------------------------------------
// Valores

export type MoFunction = (args: MoValue[], env: MoEnvironment) => MoValue | void;
export type MoValue = number | string | MoStruct | MoArray;

/** Struct do Mocha: campos (VariableStruct) e funções (QueryStruct) no mesmo objeto. */
export class MoStruct {
  readonly fields = new Map<string, MoValue>();
  readonly functions = new Map<string, MoFunction>();
  /** Objeto do jogo por trás do struct (ObjectValue do Mocha): Player, Entity... */
  host?: unknown;

  constructor(fields?: Record<string, MoValue>, functions?: Record<string, MoFunction>, host?: unknown) {
    if (fields) for (const [k, v] of Object.entries(fields)) this.fields.set(k.toLowerCase(), v);
    if (functions) for (const [k, f] of Object.entries(functions)) this.functions.set(k.toLowerCase(), f);
    this.host = host;
  }

  get(name: string): MoValue | undefined {
    return this.fields.get(name.toLowerCase());
  }
  set(name: string, value: MoValue): this {
    this.fields.set(name.toLowerCase(), value);
    return this;
  }
  fn(name: string, fn: MoFunction): this {
    this.functions.set(name.toLowerCase(), fn);
    return this;
  }
  has(name: string): boolean {
    const key = name.toLowerCase();
    return this.fields.has(key) || this.functions.has(key);
  }
  /** Só os campos, como objeto simples (para salvar em JSON). */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.fields) {
      if (typeof v === "number" || typeof v === "string") out[k] = v;
      else if (v instanceof MoStruct) out[k] = v.toJSON();
      else if (v instanceof MoArray) out[k] = v.items.filter(x => typeof x !== "object").slice();
    }
    return out;
  }
  static fromJSON(json: unknown): MoStruct {
    const struct = new MoStruct();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
        if (typeof v === "number" || typeof v === "string") struct.set(k, v);
        else if (typeof v === "boolean") struct.set(k, v ? 1 : 0);
        else if (Array.isArray(v)) struct.set(k, new MoArray(v.filter((x): x is number | string => typeof x === "number" || typeof x === "string")));
        else if (v && typeof v === "object") struct.set(k, MoStruct.fromJSON(v));
      }
    }
    return struct;
  }
}

export class MoArray {
  constructor(public items: MoValue[] = []) { }
}

export function isTruthy(value: MoValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0 && value !== "false" && value !== "0";
  return true;
}

export function asNumber(value: MoValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return value === undefined ? 0 : 1;
}

/** Texto de um valor (StringValue.asString / DoubleValue.asString). */
export function asString(value: MoValue | undefined): string {
  if (value === undefined) return "0";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toFixed(6));
  if (value instanceof MoArray) return value.items.map(asString).join(",");
  return "struct";
}

function equals(a: MoValue | undefined, b: MoValue | undefined): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (a === undefined || b === undefined) return asNumber(a) === asNumber(b) && typeof a !== "string" && typeof b !== "string";
  return a === b;
}

// ---------------------------------------------------------------------------------------------
// Ambiente

/** Ambiente de execução (MoLangRuntime do Cobblemon): query e variáveis persistem entre avaliações. */
export class MoEnvironment {
  query: MoStruct;
  variable: MoStruct;
  /** Funções chamadas que não existem (para relatório/depuração). */
  missing = new Set<string>();
  /** Instruções máximas por avaliação (proteção contra laço infinito: watchdog do Bedrock). */
  maxSteps = 20000;

  constructor(query?: MoStruct, variable?: MoStruct) {
    this.query = query ?? new MoStruct();
    this.variable = variable ?? new MoStruct();
    addStandardQueries(this);
  }

  withQuery(name: string, value: MoValue): this {
    this.query.set(name, value);
    return this;
  }

  /** Avalia um script (ou lista de scripts, que compartilham t.) e devolve o último valor. */
  eval(source: string | string[], context?: Record<string, MoValue> | MoStruct): MoValue {
    const program = parseMoLang(source);
    const ctx = context instanceof MoStruct ? context : new MoStruct(context ?? {});
    return new Evaluator(this, ctx).run(program);
  }

  evalBoolean(source: string | string[], context?: Record<string, MoValue> | MoStruct): boolean {
    return isTruthy(this.eval(source, context));
  }

  evalString(source: string | string[], context?: Record<string, MoValue> | MoStruct): string {
    return asString(this.eval(source, context));
  }
}

/** Funções gerais do Mocha/Cobblemon usadas pelos dados (q.is_blank, q.replace, q.set_query...). */
function addStandardQueries(env: MoEnvironment) {
  const q = env.query;
  q.fn("is_blank", args => {
    const v = args[0];
    return v === undefined || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && v === 0) ? 1 : 0;
  });
  q.fn("replace", args => asString(args[0]).split(asString(args[1])).join(asString(args[2])));
  q.fn("set_query", args => { q.set(asString(args[0]), args[1] ?? 0); return 1; });
  q.fn("run_molang", (args, e) => e.eval(asString(args[0])));
  q.fn("print", args => { console.info(`[molang] ${args.map(asString).join(" ")}`); return 1; });
  q.fn("random", args => args.length >= 2 ? asNumber(args[0]) + Math.random() * (asNumber(args[1]) - asNumber(args[0])) : Math.random());
  q.fn("random_int", args => Math.floor(asNumber(args[0]) + Math.random() * (asNumber(args[1]) - asNumber(args[0]) + 1)));
  q.fn("is_int", args => Number.isInteger(asNumber(args[0])) ? 1 : 0);
  q.fn("is_string", args => typeof args[0] === "string" ? 1 : 0);
  q.fn("array", args => new MoArray(args.slice()));
  q.fn("length", args => args[0] instanceof MoArray ? args[0].items.length : typeof args[0] === "string" ? args[0].length : 0);
  registerGeneralFunctions(q, env); // frente dados-ia: GeneralMoLangFunctions.kt que faltavam
}

const DEG = Math.PI / 180;
const MATH: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round, trunc: Math.trunc, sqrt: Math.sqrt,
  exp: Math.exp, ln: Math.log, pow: Math.pow, min: Math.min, max: Math.max,
  sin: a => Math.sin(a * DEG), cos: a => Math.cos(a * DEG), asin: a => Math.asin(a) / DEG, acos: a => Math.acos(a) / DEG,
  atan: a => Math.atan(a) / DEG, atan2: (y, x) => Math.atan2(y, x) / DEG,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)), mod: (a, b) => a % b, sign: a => (a >= 0 ? 1 : -1),
  lerp: (a, b, t) => a + (b - a) * t, r2d: a => a / DEG, d2r: a => a * DEG,
  random: (a = 0, b = 1) => a + Math.random() * (b - a),
  random_integer: (a = 0, b = 1) => Math.floor(a + Math.random() * (b - a + 1)),
  die_roll: (n, lo, hi) => { let s = 0; for (let i = 0; i < n; i++) s += lo + Math.random() * (hi - lo); return s; },
  die_roll_integer: (n, lo, hi) => { let s = 0; for (let i = 0; i < n; i++) s += Math.floor(lo + Math.random() * (hi - lo + 1)); return s; },
  pi: () => Math.PI,
};

// ---------------------------------------------------------------------------------------------
// Léxico

type Token =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "id"; value: string }
  | { type: "op"; value: string }
  | { type: "eof" };

const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "??", "->", "<", ">", "+", "-", "*", "/", "!", "?", ":", "=", "(", ")", "{", "}", "[", "]", ",", ";", "."];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" || ch === "\"") {
      const quote = ch;
      let value = "";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) { value += source[i + 1]; i += 2; continue; }
        value += source[i++];
      }
      i++;
      tokens.push({ type: "str", value });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?f?/i.exec(source.slice(i))!;
      tokens.push({ type: "num", value: parseFloat(m[0].replace(/f$/i, "")) });
      i += m[0].length;
      continue;
    }
    if (/[a-z_]/i.test(ch)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(source.slice(i))!;
      tokens.push({ type: "id", value: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find(o => source.startsWith(o, i));
    if (!op) throw new MoLangError(`caractere inesperado '${ch}'`, source);
    tokens.push({ type: "op", value: op });
    i += op.length;
  }
  tokens.push({ type: "eof" });
  return tokens;
}

export class MoLangError extends Error {
  constructor(message: string, public source?: string) {
    super(source ? `${message} em: ${source}` : message);
  }
}

// ---------------------------------------------------------------------------------------------
// Sintaxe

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "root"; name: string }
  | { k: "member"; obj: Node; name: string }
  | { k: "call"; obj: Node; name: string; args: Node[] }
  | { k: "index"; obj: Node; index: Node }
  | { k: "unary"; op: string; arg: Node }
  | { k: "binary"; op: string; left: Node; right: Node }
  | { k: "ternary"; cond: Node; then: Node; else?: Node }
  | { k: "assign"; target: Node; value: Node }
  | { k: "block"; body: Node[] }
  | { k: "return"; value?: Node }
  | { k: "break" }
  | { k: "continue" }
  | { k: "loop"; count: Node; body: Node }
  | { k: "for_each"; target: Node; array: Node; body: Node };

const ROOTS: Record<string, string> = {
  q: "query", query: "query", v: "variable", variable: "variable", t: "temp", temp: "temp",
  c: "context", context: "context", math: "math",
};

const cache = new Map<string, Node[]>();

/** Converte o texto (ou lista de textos, como no JSON do Cobblemon) em instruções. Resultado em cache. */
export function parseMoLang(source: string | string[]): Node[] {
  const text = Array.isArray(source) ? source.map(s => s.trim()).filter(Boolean).map(s => (s.endsWith(";") ? s : `${s};`)).join("\n") : source;
  const cached = cache.get(text);
  if (cached) return cached;
  const parsed = new Parser(tokenize(text), text).program();
  if (cache.size > 500) cache.clear();
  cache.set(text, parsed);
  return parsed;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private source: string) { }

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private isOp(value: string): boolean {
    const t = this.peek();
    return t.type === "op" && t.value === value;
  }
  private eatOp(value: string): boolean {
    if (this.isOp(value)) { this.pos++; return true; }
    return false;
  }
  private expectOp(value: string) {
    if (!this.eatOp(value)) throw new MoLangError(`esperava '${value}'`, this.source);
  }

  program(): Node[] {
    const body = this.statements("eof");
    if (this.peek().type !== "eof") throw new MoLangError("sobra de tokens", this.source);
    return body;
  }

  /** Instruções até `}` (bloco) ou fim. */
  private statements(end: "eof" | "}"): Node[] {
    const body: Node[] = [];
    while (true) {
      while (this.eatOp(";")) { }
      const t = this.peek();
      if (t.type === "eof" || (end === "}" && t.type === "op" && t.value === "}")) break;
      body.push(this.statement());
      if (!this.eatOp(";")) {
        const after = this.peek();
        if (after.type === "eof" || (after.type === "op" && after.value === "}")) break;
        // Blocos não precisam de ';' depois de '}'.
        const prev = this.tokens[this.pos - 1];
        if (!(prev.type === "op" && prev.value === "}")) throw new MoLangError("esperava ';'", this.source);
      }
    }
    return body;
  }

  private statement(): Node {
    const t = this.peek();
    if (t.type === "id") {
      const word = t.value.toLowerCase();
      if (word === "return") {
        this.next();
        const end = this.peek();
        if (end.type === "eof" || (end.type === "op" && (end.value === ";" || end.value === "}"))) return { k: "return" };
        return { k: "return", value: this.expression() };
      }
      if (word === "break") { this.next(); return { k: "break" }; }
      if (word === "continue") { this.next(); return { k: "continue" }; }
    }
    return this.expression();
  }

  expression(): Node {
    return this.assignment();
  }

  private assignment(): Node {
    const left = this.ternary();
    if (this.isOp("=")) {
      this.next();
      if (left.k !== "member" && left.k !== "index") throw new MoLangError("atribuição inválida", this.source);
      return { k: "assign", target: left, value: this.assignment() };
    }
    return left;
  }

  private ternary(): Node {
    const cond = this.coalesce();
    if (this.eatOp("?")) {
      // Ramos aceitam atribuição (`c ? v.a = 1 : v.a = 2`).
      const then = this.assignment();
      if (this.eatOp(":")) return { k: "ternary", cond, then, else: this.assignment() };
      return { k: "ternary", cond, then };
    }
    return cond;
  }

  private binaryLevel(ops: string[], next: () => Node): Node {
    let left = next();
    while (true) {
      const t = this.peek();
      if (t.type === "op" && ops.includes(t.value)) {
        this.next();
        left = { k: "binary", op: t.value, left, right: next() };
      }
      else return left;
    }
  }

  private coalesce(): Node { return this.binaryLevel(["??"], () => this.or()); }
  private or(): Node { return this.binaryLevel(["||"], () => this.and()); }
  private and(): Node { return this.binaryLevel(["&&"], () => this.equality()); }
  private equality(): Node { return this.binaryLevel(["==", "!="], () => this.relational()); }
  private relational(): Node { return this.binaryLevel(["<", "<=", ">", ">="], () => this.additive()); }
  private additive(): Node { return this.binaryLevel(["+", "-"], () => this.multiplicative()); }
  private multiplicative(): Node { return this.binaryLevel(["*", "/"], () => this.unary()); }

  private unary(): Node {
    if (this.eatOp("!")) return { k: "unary", op: "!", arg: this.unary() };
    if (this.eatOp("-")) return { k: "unary", op: "-", arg: this.unary() };
    if (this.eatOp("+")) return this.unary();
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    while (true) {
      if (this.eatOp(".") || this.eatOp("->")) {
        const t = this.next();
        if (t.type !== "id") throw new MoLangError("esperava nome depois de '.'", this.source);
        if (this.isOp("(")) node = { k: "call", obj: node, name: t.value.toLowerCase(), args: this.args() };
        else node = { k: "member", obj: node, name: t.value.toLowerCase() };
      }
      else if (this.eatOp("[")) {
        const index = this.expression();
        this.expectOp("]");
        node = { k: "index", obj: node, index };
      }
      else return node;
    }
  }

  private args(): Node[] {
    this.expectOp("(");
    const args: Node[] = [];
    if (this.eatOp(")")) return args;
    do args.push(this.expression()); while (this.eatOp(","));
    this.expectOp(")");
    return args;
  }

  private primary(): Node {
    const t = this.next();
    if (t.type === "num") return { k: "num", v: t.value };
    if (t.type === "str") return { k: "str", v: t.value };
    if (t.type === "op") {
      if (t.value === "(") {
        const inner = this.expression();
        this.expectOp(")");
        return inner;
      }
      if (t.value === "{") {
        const body = this.statements("}");
        this.expectOp("}");
        return { k: "block", body };
      }
    }
    if (t.type === "id") {
      const word = t.value.toLowerCase();
      // break/continue/return também valem como ramo de condicional (`v.n >= 3 ? break;`).
      if (word === "break") return { k: "break" };
      if (word === "continue") return { k: "continue" };
      if (word === "return") {
        const end = this.peek();
        if (end.type === "eof" || (end.type === "op" && [";", "}", ":", ")"].includes(end.value))) return { k: "return" };
        return { k: "return", value: this.expression() };
      }
      if (word === "true") return { k: "num", v: 1 };
      if (word === "false") return { k: "num", v: 0 };
      if (word === "loop" && this.isOp("(")) {
        const args = this.args();
        return { k: "loop", count: args[0] ?? { k: "num", v: 0 }, body: args[1] ?? { k: "block", body: [] } };
      }
      if (word === "for_each" && this.isOp("(")) {
        const args = this.args();
        if (args.length < 3) throw new MoLangError("for_each precisa de 3 argumentos", this.source);
        return { k: "for_each", target: args[0], array: args[1], body: args[2] };
      }
      const root = ROOTS[word];
      if (root) return { k: "root", name: root };
      // Nome solto (ex.: "this"): tratado como variável.
      return { k: "member", obj: { k: "root", name: "variable" }, name: word };
    }
    throw new MoLangError("expressão inválida", this.source);
  }
}

// ---------------------------------------------------------------------------------------------
// Avaliação

class ReturnSignal { constructor(public value: MoValue) { } }
class BreakSignal { }
class ContinueSignal { }

class Evaluator {
  private temp = new MoStruct();
  private steps = 0;
  private mathStruct: MoStruct;

  constructor(private env: MoEnvironment, private context: MoStruct) {
    this.mathStruct = new MoStruct();
    for (const [name, fn] of Object.entries(MATH)) this.mathStruct.fn(name, args => fn(...args.map(asNumber)));
  }

  run(program: Node[]): MoValue {
    let last: MoValue = 0;
    try {
      for (const node of program) last = this.eval(node);
    }
    catch (signal) {
      if (signal instanceof ReturnSignal) return signal.value;
      if (signal instanceof BreakSignal || signal instanceof ContinueSignal) return last;
      throw signal;
    }
    return last;
  }

  private tick() {
    if (++this.steps > this.env.maxSteps) throw new MoLangError("limite de instruções excedido");
  }

  private root(name: string): MoStruct {
    switch (name) {
      case "query": return this.env.query;
      case "variable": return this.env.variable;
      case "temp": return this.temp;
      case "context": return this.context;
      default: return this.mathStruct;
    }
  }

  private path(node: Node): string {
    if (node.k === "root") return node.name;
    if (node.k === "member" || node.k === "call") return `${this.path(node.obj)}.${node.name}`;
    return "?";
  }

  private member(obj: MoValue | undefined, name: string, node: Node): MoValue {
    if (obj instanceof MoStruct) {
      const field = obj.fields.get(name);
      if (field !== undefined) return field;
      const fn = obj.functions.get(name);
      if (fn) return fn([], this.env) ?? 0;
      return 0;
    }
    if (obj instanceof MoArray && name === "length") return obj.items.length;
    void node;
    return 0;
  }

  eval(node: Node): MoValue {
    this.tick();
    switch (node.k) {
      case "num": return node.v;
      case "str": return node.v;
      case "root": return this.root(node.name);
      case "member": return this.member(this.eval(node.obj), node.name, node);
      case "index": {
        const obj = this.eval(node.obj);
        const index = asNumber(this.eval(node.index));
        return obj instanceof MoArray ? obj.items[Math.floor(index)] ?? 0 : 0;
      }
      case "call": {
        const obj = this.eval(node.obj);
        const args = node.args.map(a => this.eval(a));
        if (obj instanceof MoStruct) {
          const fn = obj.functions.get(node.name);
          if (fn) return fn(args, this.env) ?? 0;
          const field = obj.fields.get(node.name);
          if (field !== undefined) return field;
        }
        this.env.missing.add(this.path(node));
        return 0;
      }
      case "unary": {
        const v = this.eval(node.arg);
        return node.op === "!" ? (isTruthy(v) ? 0 : 1) : -asNumber(v);
      }
      case "binary": return this.binary(node.op, node.left, node.right);
      case "ternary": {
        if (isTruthy(this.eval(node.cond))) return this.eval(node.then);
        return node.else ? this.eval(node.else) : 0;
      }
      case "assign": {
        const value = this.eval(node.value);
        this.assign(node.target, value);
        return value;
      }
      case "block": {
        let last: MoValue = 0;
        for (const inner of node.body) last = this.eval(inner);
        return last;
      }
      case "return": throw new ReturnSignal(node.value ? this.eval(node.value) : 0);
      case "break": throw new BreakSignal();
      case "continue": throw new ContinueSignal();
      case "loop": {
        const count = Math.min(1024, Math.max(0, Math.floor(asNumber(this.eval(node.count)))));
        for (let i = 0; i < count; i++) {
          try { this.eval(node.body); }
          catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (signal instanceof ContinueSignal) continue;
            throw signal;
          }
        }
        return 0;
      }
      case "for_each": {
        const array = this.eval(node.array);
        const items = array instanceof MoArray ? array.items.slice() : [];
        for (const item of items) {
          this.assign(node.target, item);
          try { this.eval(node.body); }
          catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (signal instanceof ContinueSignal) continue;
            throw signal;
          }
        }
        return 0;
      }
    }
  }

  private binary(op: string, leftNode: Node, rightNode: Node): MoValue {
    if (op === "&&") return isTruthy(this.eval(leftNode)) && isTruthy(this.eval(rightNode)) ? 1 : 0;
    if (op === "||") return isTruthy(this.eval(leftNode)) || isTruthy(this.eval(rightNode)) ? 1 : 0;
    if (op === "??") {
      const left = this.eval(leftNode);
      return left === 0 || left === undefined ? this.eval(rightNode) : left;
    }
    const left = this.eval(leftNode);
    const right = this.eval(rightNode);
    switch (op) {
      case "==": return equals(left, right) ? 1 : 0;
      case "!=": return equals(left, right) ? 0 : 1;
      case "+":
        if (typeof left === "string" || typeof right === "string") return asString(left) + asString(right);
        return asNumber(left) + asNumber(right);
      case "-": return asNumber(left) - asNumber(right);
      case "*": return asNumber(left) * asNumber(right);
      case "/": {
        const d = asNumber(right);
        return d === 0 ? 0 : asNumber(left) / d;
      }
      case "<": return asNumber(left) < asNumber(right) ? 1 : 0;
      case "<=": return asNumber(left) <= asNumber(right) ? 1 : 0;
      case ">": return asNumber(left) > asNumber(right) ? 1 : 0;
      case ">=": return asNumber(left) >= asNumber(right) ? 1 : 0;
    }
    throw new MoLangError(`operador desconhecido ${op}`);
  }

  private assign(target: Node, value: MoValue) {
    if (target.k === "member") {
      const obj = this.container(target.obj);
      obj.set(target.name, value);
      return;
    }
    if (target.k === "index") {
      const arr = this.eval(target.obj);
      if (arr instanceof MoArray) arr.items[Math.floor(asNumber(this.eval(target.index)))] = value;
      return;
    }
    throw new MoLangError("atribuição inválida");
  }

  /** Struct onde gravar (cria structs intermediários: `t.a.b = 1` com t.a ainda vazio). */
  private container(node: Node): MoStruct {
    if (node.k === "root") return this.root(node.name);
    if (node.k === "member") {
      const parent = this.container(node.obj);
      const existing = parent.fields.get(node.name) ?? (parent.functions.has(node.name) ? this.member(parent, node.name, node) : undefined);
      if (existing instanceof MoStruct) return existing;
      const created = new MoStruct();
      parent.set(node.name, created);
      return created;
    }
    const value = this.eval(node);
    if (value instanceof MoStruct) return value;
    throw new MoLangError("atribuição em valor que não é struct");
  }
}
