// Avaliador mínimo de Molang para poses estáticas (t fixo). Compila a expressão para JS com
// lista branca de tokens; qualquer coisa fora do subconjunto (atribuição, ';', loops) devolve null
// e o chamador cai para o valor de repouso (0).

export interface MolangCtx {
	/** Valores de consultas (q.anim_time etc.); ausentes valem 0. */
	q: Record<string, number>;
	/** Aspects da forma, para q.has_aspect('x'). */
	aspects: Set<string>;
}

export type MolangFn = (ctx: MolangCtx) => number;

const D = Math.PI / 180;
const M = {
	sin: (x: number) => Math.sin(x * D),
	cos: (x: number) => Math.cos(x * D),
	asin: (x: number) => Math.asin(x) / D,
	acos: (x: number) => Math.acos(x) / D,
	atan: (x: number) => Math.atan(x) / D,
	atan2: (y: number, x: number) => Math.atan2(y, x) / D,
	abs: Math.abs,
	floor: Math.floor,
	ceil: Math.ceil,
	round: Math.round,
	trunc: Math.trunc,
	sqrt: Math.sqrt,
	pow: Math.pow,
	exp: Math.exp,
	ln: Math.log,
	min: Math.min,
	max: Math.max,
	mod: (a: number, b: number) => a % b,
	clamp: (v: number, a: number, b: number) => Math.min(Math.max(v, a), b),
	lerp: (a: number, b: number, t: number) => a + (b - a) * t,
	lerprotate: (a: number, b: number, t: number) => a + (((((b - a) % 360) + 540) % 360) - 180) * t,
	hermite_blend: (t: number) => 3 * t * t - 2 * t * t * t,
	random: (a: number, b: number) => (a + b) / 2, // determinístico
	random_integer: (a: number, b: number) => Math.round((a + b) / 2),
	die_roll: () => 0,
	die_roll_integer: () => 0,
	min_angle: (a: number) => ((((a + 180) % 360) + 360) % 360) - 180,
	pi: Math.PI,
};

const QFN: Record<string, (ctx: MolangCtx, ...args: any[]) => number> = {
	has_aspect: (ctx, a: string) => (ctx.aspects.has(a) ? 1 : 0),
};

const cache = new Map<string, MolangFn | null>();

export function compileMolang(src: unknown): MolangFn | null {
	if (typeof src === "number") return () => src;
	if (typeof src === "boolean") return () => (src ? 1 : 0);
	if (typeof src !== "string") return null;
	const key = src;
	if (cache.has(key)) return cache.get(key)!;
	let fn: MolangFn | null = null;
	try {
		fn = build(src);
	} catch {
		fn = null;
	}
	cache.set(key, fn);
	return fn;
}

function build(src0: string): MolangFn | null {
	let src = src0.trim().replace(/;\s*$/, "");
	if (/^return\s+/i.test(src)) src = src.replace(/^return\s+/i, "");
	if (src.includes(";") || /[^=!<>]=[^=]/.test(src) || /\bloop\b|\bfor_each\b/.test(src)) return null;
	const out: string[] = [];
	const re = /\s+|(\d+\.?\d*(?:e[+-]?\d+)?f?|\.\d+f?)|('[^']*')|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(&&|\|\||==|!=|<=|>=|\?\?|[-+*/()<>!?:,])/gy;
	let m: RegExpExecArray | null;
	let pos = 0;
	while (pos < src.length) {
		re.lastIndex = pos;
		m = re.exec(src);
		if (!m || m.index !== pos) return null;
		pos = re.lastIndex;
		if (m[1]) out.push(String(parseFloat(m[1])));
		else if (m[2]) out.push(JSON.stringify(m[2].slice(1, -1)));
		else if (m[3]) {
			const id = m[3].toLowerCase();
			const [ns, ...rest] = id.split(".");
			const name = rest.join(".");
			const isCall = /^\s*\(/.test(src.slice(pos));
			if (id === "true") out.push("1");
			else if (id === "false") out.push("0");
			else if (ns === "math") {
				if (!(name in M)) return null;
				out.push(`M.${name}`);
			} else if (ns === "q" || ns === "query") {
				if (isCall) out.push(name in QFN ? `QF.${name}.bind(null, c)` : `(() => 0)`);
				else out.push(`(c.q[${JSON.stringify(name)}] ?? 0)`);
			} else if (["v", "variable", "t", "temp", "c", "context"].includes(ns)) out.push("0");
			else if (id === "this") out.push("0");
			else return null;
		} else if (m[4]) out.push(m[4]);
	}
	const body = out.join(" ");
	// eslint-disable-next-line no-new-func
	const f = new Function("M", "QF", "c", `return (${body});`) as (m: typeof M, qf: typeof QFN, c: MolangCtx) => unknown;
	return (ctx) => {
		const v = Number(f(M, QFN, ctx));
		return Number.isFinite(v) ? v : 0;
	};
}
