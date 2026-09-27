// Frente cliente-modelos: ajustes das animações do Cobblemon para o que o cliente Bedrock aceita.
//
// 1. Molang de cada valor de osso/timeline passa por javaMolangToBedrock (mesmo valor que o parser do Cobblemon calcula,
//    em sintaxe que o Bedrock lê).
// 2. `lerp_mode: "catmullrom"` com Molang: o Bedrock recusa a animação inteira ("Precomputed cubic interpolation requires
//    keyframes have constant data") e ela não toca. No Java (BedrockKeyFrameBoneValue.resolve + catmullromLerp) cada
//    quadro avalia o Molang dos 4 keyframes vizinhos no tempo atual e interpola a spline. Quando o canal só depende de
//    q.anim_time (quase todos), essa curva é uma função do tempo: ela é amostrada aqui com a MESMA fórmula do Java e vira
//    keyframes numéricos lineares (subdivisão adaptativa até o erro ficar abaixo da tolerância). Canal que depende de outra
//    coisa (v.*, math.random) perde só a suavização: vira linear, com o Molang intacto.
// 3. Chaves que o Bedrock não aceita dentro de `bones` (osso "sound_effects", nomes com símbolos): o Java as lê como
//    ossos inexistentes e não faz nada, então saem.
import { count, warn } from "./util.ts";
import { evalMolang, isAnimTimeOnly, javaMolangToBedrock, parseJavaMolang } from "./molangSyntax.ts";
import type { MolangNode } from "./molangSyntax.ts";

/** Chave de osso aceita em `bones` de animação (o cliente recusou "_&/3%6-7A": "child not valid here"). */
export const BONE_NAME = /^[A-Za-z0-9_.\-]+$/;
const CHANNELS = new Set(["position", "rotation", "scale", "relative_to"]);

/** Tolerância da amostragem por canal (graus, pixels, fator). */
const TOLERANCE: Record<string, number> = { rotation: 0.1, position: 0.01, scale: 0.001 };
/** Menor passo entre amostras (s). */
const MIN_STEP = 1 / 480;
/** Maior passo aceito sem subdividir (s): nenhuma oscilação curta fica entre duas amostras. */
const MAX_STEP = 1 / 8;
const PROBES = [0.13, 0.29, 0.5, 0.71, 0.87];

const r5 = (n: number) => {
	const v = Math.round(n * 100000) / 100000;
	return Object.is(v, -0) ? 0 : v;
};
const timeKey = (t: number) => {
	const s = String(Math.round(t * 10000) / 10000);
	return s.includes(".") ? s : `${s}.0`;
};

/** Molang de um valor de osso → Bedrock com a semântica do Java (conta as mudanças). */
export function fixBoneMolang(expr: string, where: string): string | number {
	const r = javaMolangToBedrock(expr, true);
	if (r.reason) {
		count("Molang de animação corrigido para o Bedrock (semântica do Java)");
		warn("Molang de animação corrigido (semântica do Java)", `${where}: ${expr} → ${r.expr} (${r.reason})`);
	}
	return /^-?\d+(\.\d+)?$/.test(r.expr.trim()) ? Number(r.expr) : r.expr;
}

function mapValues(v: any, fn: (s: string) => string | number): any {
	if (typeof v === "string") return fn(v);
	if (Array.isArray(v)) return v.map((x) => mapValues(x, fn));
	if (v && typeof v === "object") {
		const out: any = {};
		for (const [k, x] of Object.entries(v)) out[k] = k === "lerp_mode" ? x : mapValues(x, fn);
		return out;
	}
	return v;
}

/** `bones` já reescrito (rewriteMolang) → válido para o Bedrock. `length` = duração da animação (s). */
export function fixBones(bones: any, length: number, where: string): any {
	if (!bones || typeof bones !== "object") return bones;
	const out: Record<string, any> = {};
	for (const [bone, value] of Object.entries<any>(bones)) {
		if (!BONE_NAME.test(bone) || !value || typeof value !== "object" || Array.isArray(value)) {
			warn("osso inválido na animação (o Java ignora; removido)", `${where}: ${bone}`);
			count("ossos inválidos removidos de animações");
			continue;
		}
		const b: Record<string, any> = {};
		for (const [ch, data] of Object.entries<any>(value)) {
			if (!CHANNELS.has(ch)) {
				warn("chave inválida em osso de animação (o Java ignora; removida)", `${where}: ${bone}.${ch}`);
				count("chaves inválidas removidas de ossos de animação");
				continue;
			}
			if (ch === "relative_to") {
				b[ch] = data;
				continue;
			}
			const fixed = mapValues(data, (s) => fixBoneMolang(s, `${where}/${bone}.${ch}`));
			b[ch] = fixCatmullrom(fixed, ch, length, `${where}/${bone}.${ch}`);
		}
		if (Object.keys(b).length) out[bone] = b;
	}
	return out;
}

type Vec = [MolangNode, MolangNode, MolangNode];
interface Key {
	t: number;
	pre: Vec;
	post: Vec;
	smooth: boolean;
}

function vecOf(v: any): Vec | undefined {
	const arr = Array.isArray(v) ? v : undefined;
	if (!arr || arr.length !== 3) return undefined; // o Java exige array de 3 (asJsonArray)
	const out: MolangNode[] = [];
	for (const x of arr) {
		if (typeof x === "number") out.push({ k: "num", text: String(x) });
		else if (typeof x === "string") {
			const p = parseJavaMolang(x, true);
			if (!p || p.ignored || !isAnimTimeOnly(p.stmts)) return undefined;
			out.push(p.stmts[0]);
		} else return undefined;
	}
	return out as Vec;
}

const hasMolang = (v: any): boolean => typeof v === "string" || (Array.isArray(v) ? v.some(hasMolang) : !!v && typeof v === "object" && Object.entries(v).some(([k, x]) => k !== "lerp_mode" && hasMolang(x)));

/** Canal com catmullrom + Molang → keyframes aceitos pelo Bedrock (ver cabeçalho). */
export function fixCatmullrom(channel: any, kind: string, length: number, where: string): any {
	if (!channel || typeof channel !== "object" || Array.isArray(channel)) return channel;
	const entries = Object.entries<any>(channel);
	const smooth = entries.some(([, k]) => k && typeof k === "object" && !Array.isArray(k) && k.lerp_mode === "catmullrom");
	if (!smooth || !hasMolang(channel)) return channel;
	const linearized = () => {
		const out: Record<string, any> = {};
		for (const [t, k] of entries) {
			if (k && typeof k === "object" && !Array.isArray(k) && k.lerp_mode === "catmullrom") {
				const { lerp_mode: _l, ...rest } = k;
				out[t] = rest;
			} else out[t] = k;
		}
		return out;
	};
	if (entries.length === 1) return linearized(); // um keyframe só: nada a interpolar
	const keys: Key[] = [];
	for (const [t, k] of entries) {
		const time = Number(t);
		if (!Number.isFinite(time)) return channel;
		if (Array.isArray(k)) {
			const v = vecOf(k);
			if (!v) return countLinear(linearized(), where);
			keys.push({ t: time, pre: v, post: v, smooth: false });
		} else if (k && typeof k === "object") {
			const post = vecOf(k.post ?? k.pre);
			const pre = vecOf(k.pre ?? k.post);
			if (!post || !pre) return countLinear(linearized(), where);
			keys.push({ t: time, pre, post, smooth: k.lerp_mode === "catmullrom" });
		} else return countLinear(linearized(), where);
	}
	keys.sort((a, b) => a.t - b.t);
	count("canais catmullrom com Molang pré-calculados (curva do Java)");
	return bake(keys, kind, Math.max(length, keys[keys.length - 1].t));
}

/**
 * Valor do canal (formato Bedrock, keyframes) no Java no tempo t, com a fórmula do BedrockKeyFrameBoneValue.resolve.
 * undefined = não dá para avaliar (Molang que não depende só de q.anim_time). Usado nos testes.
 */
export function javaChannelAt(channel: Record<string, any>, t: number): number[] | undefined {
	const keys: Key[] = [];
	for (const [time, k] of Object.entries<any>(channel)) {
		const post = Array.isArray(k) ? vecOf(k) : vecOf(k?.post ?? k?.pre);
		const pre = Array.isArray(k) ? post : vecOf(k?.pre ?? k?.post);
		if (!post || !pre) return undefined;
		keys.push({ t: Number(time), pre, post, smooth: !Array.isArray(k) && k?.lerp_mode === "catmullrom" });
	}
	keys.sort((a, b) => a.t - b.t);
	const after = keys.findIndex((k) => k.t > t);
	return resolveIn(keys, after < 0 ? keys.length - 1 : after - 1, t);
}

/** Valor de um canal Bedrock linear (keyframes numéricos, pre/post) no tempo t, como o cliente interpola. */
export function bedrockLinearAt(channel: Record<string, any>, t: number): number[] {
	const keys = Object.entries<any>(channel).map(([time, k]) => ({ t: Number(time), pre: (Array.isArray(k) ? k : k.pre ?? k.post) as number[], post: (Array.isArray(k) ? k : k.post ?? k.pre) as number[] })).sort((a, b) => a.t - b.t);
	const after = keys.findIndex((k) => k.t > t);
	if (after === 0) return keys[0].pre;
	if (after < 0) return keys[keys.length - 1].post;
	const a = keys[after - 1], b = keys[after];
	const f = (t - a.t) / (b.t - a.t);
	return a.post.map((v, i) => v + (b.pre[i] - v) * f);
}

function countLinear(out: any, where: string): any {
	count("canais catmullrom com Molang não constante (viraram lineares)");
	warn("catmullrom com Molang que não depende só de q.anim_time (vira linear)", where);
	return out;
}

const evalVec = (v: Vec, t: number): number[] => v.map((n) => evalMolang(n, t));

/** Porte de catmullromLerp/getPointOnSpline (InterpolationMath.kt) para um eixo. */
function catmull(points: Array<[number, number]>, alpha: number): number {
	const n = points.length;
	const p = (n - 1) * alpha;
	const ip = Math.floor(p);
	const w = p - ip;
	const i0 = ip === 0 ? ip : ip - 1;
	const i2 = ip > n - 2 ? n - 1 : ip + 1;
	const i3 = ip > n - 3 ? n - 1 : ip + 2;
	const p0 = points[i0][1], p1 = points[Math.min(ip, n - 1)][1], p2 = points[i2][1], p3 = points[i3][1];
	const v0 = (p2 - p0) * 0.5;
	const v1 = (p3 - p1) * 0.5;
	const t2 = w * w;
	const t3 = w * t2;
	return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * w + p1;
}

/** Valor do canal no Java para o tempo t, usando o segmento [keys[bi], keys[bi+1]] (bi = -1: antes do 1º). */
function resolveIn(keys: Key[], bi: number, t: number): number[] {
	const before = bi >= 0 ? keys[bi] : undefined;
	const after = bi + 1 < keys.length ? keys[bi + 1] : undefined;
	const afterData = after ? evalVec(after.pre, t) : [0, 0, 0];
	const beforeData = before ? evalVec(before.post, t) : [0, 0, 0];
	if (!before && !after) return [0, 0, 0];
	if (!before) return afterData;
	if (!after) return beforeData;
	const alphaLin = (t - before.t) / (after.t - before.t);
	if (before.smooth || after.smooth) {
		const a = bi > 0 ? keys[bi - 1] : undefined;
		const d = bi + 2 < keys.length ? keys[bi + 2] : undefined;
		const aData = a ? evalVec(a.post, t) : undefined;
		const dData = d ? evalVec(d.pre, t) : undefined;
		return [0, 1, 2].map((axis) => {
			const pts: Array<[number, number]> = [];
			if (a && aData) pts.push([a.t, aData[axis]]);
			pts.push([before.t, beforeData[axis]]);
			pts.push([after.t, afterData[axis]]);
			if (d && dData) pts.push([d.t, dData[axis]]);
			const alpha = (alphaLin + (a ? 1 : 0)) / (pts.length - 1);
			return catmull(pts, alpha);
		});
	}
	return [0, 1, 2].map((axis) => beforeData[axis] + (afterData[axis] - beforeData[axis]) * alphaLin);
}

function bake(keys: Key[], kind: string, end: number): Record<string, any> {
	const tol = TOLERANCE[kind] ?? 0.001;
	// Pontos (t, valor) em ordem; nos keyframes pode haver salto (pre ≠ post).
	const samples: Array<{ t: number; pre: number[]; post: number[] }> = [];
	const push = (t: number, pre: number[], post: number[] = pre) => samples.push({ t, pre: pre.map(r5), post: post.map(r5) });
	const refine = (bi: number, t0: number, v0: number[], t1: number, v1: number[], depth: number) => {
		if (t1 - t0 >= 2 * MIN_STEP && depth < 14) {
			let worst = 0;
			// Frações irregulares: com 1/4, 1/2, 3/4 uma oscilação de período submúltiplo do intervalo passava batida.
			for (const f of PROBES) {
				const t = t0 + (t1 - t0) * f;
				const real = resolveIn(keys, bi, t);
				for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(real[i] - (v0[i] + (v1[i] - v0[i]) * f)));
			}
			if (worst > tol || t1 - t0 > MAX_STEP) {
				const tm = (t0 + t1) / 2;
				const vm = resolveIn(keys, bi, tm);
				refine(bi, t0, v0, tm, vm, depth + 1);
				push(tm, vm);
				refine(bi, tm, vm, t1, v1, depth + 1);
			}
		}
	};
	// Antes do primeiro keyframe o Java usa o `pre` dele avaliado no tempo atual.
	const first = keys[0];
	if (first.t > 0) {
		const v0 = resolveIn(keys, -1, 0);
		push(0, v0);
		refine(-1, 0, v0, first.t, evalVec(first.pre, first.t), 0);
	}
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i];
		const left = i === 0 ? (first.t > 0 ? evalVec(k.pre, k.t) : resolveIn(keys, i, k.t)) : resolveIn(keys, i - 1, k.t);
		const right = resolveIn(keys, i, k.t);
		push(k.t, left, right);
		const tNext = i + 1 < keys.length ? keys[i + 1].t : end;
		if (tNext > k.t) {
			const vNext = i + 1 < keys.length ? resolveIn(keys, i, tNext) : resolveIn(keys, i, tNext);
			refine(i, k.t, right, tNext, vNext, 0);
			if (i + 1 === keys.length) push(tNext, vNext);
		}
	}
	const out: Record<string, any> = {};
	for (const s of samples.sort((a, b) => a.t - b.t)) {
		const key = timeKey(s.t);
		const jump = s.pre.some((x, i) => Math.abs(x - s.post[i]) > tol / 10);
		out[key] = jump ? { pre: s.pre, post: s.post } : s.post;
	}
	return out;
}
