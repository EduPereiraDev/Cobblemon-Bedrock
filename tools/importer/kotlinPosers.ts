// Posers só em Kotlin do Cobblemon (PokemonPosableModel) → o MESMO formato dos posers JSON
// (bedrock/pokemon/posers/*.json), para que posers.ts (PoserFactory.fromJson) os trate igual aos JSON.
//
// Parser determinístico: remove comentários, acha chamadas por parênteses balanceados e traduz um vocabulário
// fechado (registerPose, bedrock, singleBoneLook, quirk, *WalkAnimation, wingFlap, rotation/translation com
// funções de onda, WaveAnimation, transformedParts, CryProvider, getFaintAnimation). Tudo que não é reconhecido
// vai para `unsupported` (nunca é adivinhado) e aparece no relatório.
//
// A saída fica congelada em tools/importer/data/kotlin-posers/*.json (revisável por diff) e é regenerada com
//   node --experimental-strip-types tools/importer/kotlinPosers.ts
// (alias pedido: npm run import:kotlin-posers). O import normal só lê os JSON congelados.
//
// Extensões ao dialeto dos posers JSON (tratadas em posers.ts/GenContext):
//   q.cobblemon_fn('rotation'|'translation', osso, eixo, tipo, a, b, c, d, 'tempo Molang')
//   q.cobblemon_wing_flap(tipo, a, b, c, d, eixo, asaEsq, asaDir, 'tempo Molang')
//   q.cobblemon_wave_chain(tipo, a, b, c, d, oscilações, compCabeça, eixo, 'tempo Molang', 'osso:comp', ...)
// tipo ∈ sine | cosine | triangle (a=amplitude, b=período, c=fase, d=deslocamento vertical) |
//        parabola (a=tightness, b=fase, c=deslocamento vertical, d=0).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ASSETS, ROOT, walk } from "./util.ts";

const KT = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "kotlin", "com", "cobblemon", "mod", "common", "client", "render", "models", "blockbench");

// Frente dados-ia: `DataKeys.X` usados dentro de strings Molang ("q.has_aspect('${DataKeys.HAS_BEEN_SHEARED}')").
let dataKeysCache: Map<string, string> | undefined;
function dataKeys(): Map<string, string> {
	if (dataKeysCache) return dataKeysCache;
	dataKeysCache = new Map();
	const file = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "kotlin", "com", "cobblemon", "mod", "common", "util", "DataKeys.kt");
	if (existsSync(file)) for (const m of readFileSync(file, "utf8").matchAll(/const\s+val\s+(\w+)\s*=\s*"([^"]*)"/g)) dataKeysCache.set(m[1], m[2]);
	return dataKeysCache;
}

/** Substitui `${DataKeys.X}` (template do Kotlin) pelo valor da constante. */
function substituteDataKeys(text: string): string {
	return text.replace(/\$\{DataKeys\.(\w+)\}/g, (all, key: string) => dataKeys().get(key) ?? all);
}
export const KOTLIN_POSERS_DIR = join(ROOT, "tools", "importer", "data", "kotlin-posers");

// ------------------------------------------------------------------ utilidades de texto

/** Remove comentários // e /* *\/ fora de strings. */
export function stripComments(src: string): string {
	let out = "";
	let i = 0;
	let str: string | null = null;
	while (i < src.length) {
		const c = src[i];
		if (str) {
			out += c;
			if (c === "\\") {
				out += src[i + 1] ?? "";
				i += 2;
				continue;
			}
			if (c === str) str = null;
			i++;
			continue;
		}
		if (c === "\"" || c === "'") {
			str = c;
			out += c;
			i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const j = src.indexOf("*/", i + 2);
			i = j < 0 ? src.length : j + 2;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

/** Índice do fechamento que casa com a abertura em `open` ((, [, {). */
function matchClose(s: string, open: number): number {
	const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
	const stack: string[] = [];
	let str: string | null = null;
	for (let i = open; i < s.length; i++) {
		const c = s[i];
		if (str) {
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === str) str = null;
			continue;
		}
		if (c === "\"") {
			str = c;
			continue;
		}
		if (pairs[c]) stack.push(pairs[c]);
		else if (c === ")" || c === "]" || c === "}") {
			if (stack.pop() !== c) return -1;
			if (!stack.length) return i;
		}
	}
	return -1;
}

/** Divide no nível superior por vírgula. */
function splitTop(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	let str: string | null = null;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (str) {
			cur += c;
			if (c === "\\") {
				cur += s[++i];
				continue;
			}
			if (c === str) str = null;
			continue;
		}
		if (c === "\"") {
			str = c;
			cur += c;
			continue;
		}
		if ("([{".includes(c)) depth++;
		else if (")]}".includes(c)) depth--;
		if (c === "," && depth === 0) {
			if (cur.trim()) out.push(cur.trim());
			cur = "";
			continue;
		}
		cur += c;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

interface Call {
	receiver?: string;
	name: string;
	positional: string[];
	named: Record<string, string>;
	lambda?: string;
	end: number;
}

/** Lê `recv.nome(args) { lambda }` a partir de `start`. */
function readCall(s: string, start: number): Call | undefined {
	const m = /^\s*(?:([A-Za-z_][\w.]*)\.)?([A-Za-z_]\w*)\s*(?=[({])/.exec(s.slice(start));
	if (!m) return undefined;
	let i = start + m[0].length;
	const call: Call = { receiver: m[1], name: m[2], positional: [], named: {}, end: i };
	if (s[i] === "(") {
		const j = matchClose(s, i);
		if (j < 0) return undefined;
		for (const a of splitTop(s.slice(i + 1, j))) {
			const nm = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
			if (nm) call.named[nm[1]] = nm[2].trim();
			else call.positional.push(a);
		}
		i = j + 1;
	}
	const k = /^\s*\{/.exec(s.slice(i));
	if (k) {
		const open = i + k[0].length - 1;
		const j = matchClose(s, open);
		if (j > 0) {
			call.lambda = s.slice(open + 1, j).trim();
			i = j + 1;
		}
	}
	call.end = i;
	return call;
}

const parseCallExpr = (expr: string): Call | undefined => readCall(expr.trim(), 0);

function str(s: string | undefined): string | undefined {
	if (!s) return undefined;
	const m = /^"([^"]*)"$/.exec(s.trim());
	return m ? m[1] : undefined;
}

// ------------------------------------------------------------------ contexto (ossos, constantes)

class Ctx {
	parts = new Map<string, string>();
	/** Frames declarados como object (cabeças/asas extras): nome → papel (head, leftWing...) → osso. */
	frames = new Map<string, Map<string, string>>();
	consts = new Map<string, number>();
	quirks = new Map<string, string[]>();
	anims = new Map<string, string>();
	unsupported: string[] = [];

	num(expr: string | undefined): number | undefined {
		if (expr === undefined) return undefined;
		let e = expr.trim().replace(/\s+/g, " ");
		const rad = /^\(?(.+?)\)?\.toRadians\(\)$/.exec(e);
		if (rad) {
			const v = this.num(rad[1]);
			return v === undefined ? undefined : (v * Math.PI) / 180;
		}
		const deg = /^Math\.toRadians\((.+)\)(?:\.toFloat\(\))?$/.exec(e);
		if (deg) {
			const v = this.num(deg[1]);
			return v === undefined ? undefined : (v * Math.PI) / 180;
		}
		e = e.replace(/\.toFloat\(\)|\.toDouble\(\)/g, "");
		if (/^-?\d+(\.\d+)?[fFdD]?$/.test(e)) return Number.parseFloat(e);
		if (/^-?[A-Za-z_]\w*$/.test(e)) {
			const neg = e.startsWith("-");
			const v = this.consts.get(neg ? e.slice(1) : e);
			return v === undefined ? undefined : neg ? -v : v;
		}
		// aritmética simples (a * b / c + d), com constantes conhecidas e PI
		const safe = e.replace(/(\d+(?:\.\d+)?)[fFdD]\b/g, "$1").replace(/[A-Za-z_]\w*/g, (w) => {
			if (w === "PI") return `(${Math.PI})`;
			const v = this.consts.get(w);
			return v === undefined ? "NaN" : `(${v})`;
		});
		if (/^[\d.\s()+\-*/NaN]+$/.test(safe) && !safe.includes("NaN")) {
			const v = Function(`return (${safe})`)();
			return typeof v === "number" && Number.isFinite(v) ? v : undefined;
		}
		return undefined;
	}

	bone(expr: string | undefined): string | undefined {
		if (!expr) return undefined;
		const e = expr.trim();
		const gp = /^getPart\("([^"]+)"\)$/.exec(e);
		if (gp) return gp[1];
		return this.parts.get(e.replace(/^this\./, ""));
	}
}

const AXIS: Record<string, string> = { X_AXIS: "x", Y_AXIS: "y", Z_AXIS: "z", "0": "x", "1": "y", "2": "z" };
const axisOf = (e?: string) => (e ? AXIS[e.trim().replace(/^.*\./, "")] : undefined);
const r5 = (n: number) => +n.toFixed(5);

// ------------------------------------------------------------------ PoseType

const POSE_SETS: Record<string, string[]> = {
	ALL_POSES: ["STAND", "WALK", "SLEEP", "HOVER", "FLY", "FLOAT", "SWIM", "SHOULDER_LEFT", "SHOULDER_RIGHT", "PROFILE", "PORTRAIT", "NONE"],
	FLYING_POSES: ["FLY", "HOVER"],
	SWIMMING_POSES: ["SWIM", "FLOAT"],
	STANDING_POSES: ["STAND", "WALK"],
	SHOULDER_POSES: ["SHOULDER_LEFT", "SHOULDER_RIGHT"],
	UI_POSES: ["PROFILE", "PORTRAIT"],
	MOVING_POSES: ["WALK", "SWIM", "FLY"],
	STATIONARY_POSES: ["STAND", "FLOAT", "HOVER"],
};

function poseTypes(expr: string, ctx: Ctx): string[] | undefined {
	const tokens = expr.replace(/\s+/g, " ").split(/\s*([+-])\s*/);
	const acc = new Set<string>();
	let op = "+";
	for (const t of tokens) {
		if (t === "+" || t === "-") {
			op = t;
			continue;
		}
		let set: string[] | undefined;
		const so = /^(?:setOf|mutableSetOf|EnumSet\.of)\((.*)\)$/.exec(t);
		const name = t.replace(/^PoseType\.(Companion\.)?/, "");
		if (so) set = splitTop(so[1]).map((x) => x.replace(/^PoseType\./, ""));
		else if (POSE_SETS[name]) set = POSE_SETS[name];
		else if (/^[A-Z_]+$/.test(name)) set = [name];
		if (!set) {
			ctx.unsupported.push(`poseTypes: ${expr}`);
			return undefined;
		}
		for (const s of set) op === "+" ? acc.add(s) : acc.delete(s);
	}
	return [...acc];
}

// ------------------------------------------------------------------ condições (lambda Kotlin → chaves JSON/Molang)

interface CondOut {
	flags: Record<string, boolean>;
	molang: string[];
}

const ATOMS: Array<[RegExp, (m: RegExpExecArray) => { flag?: [string, boolean]; molang?: string }]> = [
	[/^(!?)it\.isBattling$/, (m) => ({ flag: ["isBattle", !m[1]] })],
	[/^it\.isBattling (==|!=) (true|false)$/, (m) => ({ flag: ["isBattle", (m[1] === "==") === (m[2] === "true")] })],
	[/^(!?)it\.isInWater$/, (m) => ({ flag: ["isTouchingWater", !m[1]] })],
	[/^(!?)it\.isUnderWater$/, (m) => ({ flag: ["isUnderWater", !m[1]] })],
	[/^(!?)it\.isInWaterOrRain$/, (m) => ({ flag: ["isInWaterOrRain", !m[1]] })],
	[/^it\.getEntity\(\)\?\.isDusk\(\) (==|!=) true$/, (m) => ({ flag: ["isDusk", m[1] === "=="] })],
	[/^(!?)it\.containsAspect\(DataKeys\.HAS_BEEN_SHEARED\)(?:\.get\(\))?$/, (m) => ({ molang: `${m[1]}q.has_aspect('sheared')` })],
	[/^it\.getEntity\(\)\?\.isStandingOn\(setOf\((.+)\)\) (==|!=) true$/, (m) => {
		const blocks = m[1].replace(/"/g, "");
		const key = blocks.includes("red_sand") && /minecraft:sand\b/.test(blocks) ? "isStandingOnSandOrRedSand" : blocks.includes("red_sand") ? "isStandingOnRedSand" : "isStandingOnSand";
		return { flag: [key, m[2] === "=="] };
	}],
	[/^\(it\.getEntity\(\) as\? PokemonEntity\)\?\.isFalling\(\) (==|!=) true$/, (m) => ({ molang: `${m[1] === "==" ? "" : "!"}(!q.is_on_ground && q.vertical_speed < -0.1)` })],
	[/^\(it\.getEntity\(\) as\? PokemonEntity\)\?\.ownerUUID (==|!=) null$/, (m) => ({ molang: `${m[1] === "==" ? "" : "!"}q.property('cobblemon:wild')` })],
];

function condition(lambda: string, ctx: Ctx): CondOut | undefined {
	const body = lambda.replace(/\s+/g, " ").trim().replace(/^\w+ -> /, "");
	if (body.includes("||")) {
		ctx.unsupported.push(`condition(||): ${body}`);
		return undefined;
	}
	const out: CondOut = { flags: {}, molang: [] };
	for (const atom of body.split("&&").map((a) => a.trim().replace(/^\((.*)\)$/, "$1"))) {
		let ok = false;
		for (const [re, fn] of ATOMS) {
			const m = re.exec(atom);
			if (!m) continue;
			const r = fn(m);
			if (r.flag) out.flags[r.flag[0]] = r.flag[1];
			if (r.molang) out.molang.push(r.molang);
			ok = true;
			break;
		}
		if (!ok) {
			ctx.unsupported.push(`condition: ${atom}`);
			return undefined;
		}
	}
	return out;
}

// ------------------------------------------------------------------ funções de onda e variáveis de tempo

interface WaveSpec {
	kind: "sine" | "cosine" | "triangle" | "parabola";
	a: number;
	b: number;
	c: number;
	d: number;
}

function waveSpec(expr: string | undefined, ctx: Ctx): WaveSpec | undefined {
	if (!expr) return undefined;
	const c = parseCallExpr(expr);
	if (!c) return undefined;
	const n = (k: string, i: number, d: number) => {
		const raw = c.named[k] ?? c.positional[i];
		if (raw === undefined) return d;
		return ctx.num(raw);
	};
	const spec = (kind: WaveSpec["kind"], vals: Array<number | undefined>): WaveSpec | undefined => {
		if (vals.some((v) => v === undefined)) return undefined;
		const [a, b, cc, d] = vals as number[];
		return { kind, a: r5(a), b: r5(b), c: r5(cc), d: r5(d) };
	};
	switch (c.name) {
		case "sineFunction":
		case "cosineFunction":
		case "triangleFunction":
			return spec(c.name.replace("Function", "") as WaveSpec["kind"], [n("amplitude", 0, 1), n("period", 1, 1), n("phaseShift", 2, 0), n("verticalShift", 3, 0)]);
		case "parabolaFunction": {
			if (c.named.peak !== undefined || (c.named.tightness === undefined && c.positional.length === 2)) {
				// parabolaFunction(peak, period) = parabolaFunction(tightness = -4·peak/period², verticalShift = peak, phaseShift = period/2)
				const peak = ctx.num(c.named.peak ?? c.positional[0]);
				const period = ctx.num(c.named.period ?? c.positional[1]);
				if (peak === undefined || period === undefined || period === 0) return undefined;
				return spec("parabola", [(-4 * peak) / period ** 2, period / 2, peak, 0]);
			}
			return spec("parabola", [n("tightness", 0, -1), n("phaseShift", 1, 0), n("verticalShift", 2, 1), 0]);
		}
		default:
			return undefined;
	}
}

/** Lambda de tempo `{ state, limbSwing, ageInTicks -> ... }` → expressão Molang (segundos ou limbSwing). */
function timeExpr(lambda: string | undefined, ctx: Ctx, fallback = "q.anim_time"): string | undefined {
	if (!lambda) return fallback;
	const body = lambda.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
	const m = /^(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*->\s*(.+)$/.exec(body);
	if (!m) {
		ctx.unsupported.push(`timeVariable: ${body}`);
		return undefined;
	}
	const [, st, ls, age, exprRaw] = m;
	let expr = exprRaw.replace(/(\d+(?:\.\d+)?)[fF]\b/g, "$1");
	const map: Array<[RegExp, string]> = [
		[new RegExp(`\\b${st}\\.animationSeconds\\b`, "g"), "q.anim_time"],
		[new RegExp(`\\b${age}\\b`, "g"), "(q.life_time * 20)"],
		[new RegExp(`\\b${ls}\\b`, "g"), "q.modified_distance_moved"],
	];
	for (const [re, rep] of map) expr = expr.replace(re, rep);
	if (!/^[\w.\s()+\-*/]+$/.test(expr) || /[a-zA-Z_]/.test(expr.replace(/q\.\w+|math\.\w+/g, ""))) {
		ctx.unsupported.push(`timeVariable: ${body}`);
		return undefined;
	}
	return expr.replace(/\(q\.life_time \* 20\) \/ 20(?:\.0)?/g, "q.life_time");
}

function specArgs(s: WaveSpec): string {
	return `'${s.kind}', ${s.a}, ${s.b}, ${s.c}, ${s.d}`;
}

// ------------------------------------------------------------------ animações

function bedrockRef(c: Call, fn: string): string | undefined {
	const g = str(c.positional[0] ?? c.named.animationGroup);
	const a = str(c.positional[1] ?? c.named.animation);
	if (!g || !a) return undefined;
	const prefix = str(c.positional[2] ?? c.named.animationPrefix);
	return prefix ? `q.${fn}('${g}', '${a}', '${prefix}')` : `q.${fn}('${g}', '${a}')`;
}

/** `bedrock(...)`/`bedrockStateful(...)`/`"molang".asExpressionLike()` → expressão Molang da animação. */
function animRefExpr(expr: string): string | undefined {
	const e = expr.trim();
	const molang = /^"([^"]+)"\.asExpressionLike\(\)$/.exec(e);
	if (molang) return molang[1];
	const c = parseCallExpr(e);
	if (!c) return undefined;
	if (c.name === "bedrock") return bedrockRef(c, "bedrock");
	if (c.name === "bedrockStateful") return bedrockRef(c, "bedrock_stateful");
	return undefined;
}

/** Converte um item de `animations = arrayOf(...)`. Devolve expressão Molang no dialeto dos posers JSON. */
function animation(expr: string, ctx: Ctx): string | undefined {
	const e = expr.trim();
	if (ctx.anims.has(e)) return ctx.anims.get(e);
	const c = parseCallExpr(e);
	if (!c) {
		ctx.unsupported.push(`anim: ${e.slice(0, 60)}`);
		return undefined;
	}
	const n = (k: string, i: number) => ctx.num(c.named[k] ?? c.positional[i]);
	switch (c.name) {
		case "bedrock":
			return bedrockRef(c, "bedrock");
		case "bedrockStateful":
			return bedrockRef(c, "bedrock_stateful");
		case "singleBoneLook": {
			const head = ctx.parts.get("head");
			if (!head) {
				ctx.unsupported.push("singleBoneLook sem head");
				return undefined;
			}
			const flag = (k: string) => c.named[k] === "true";
			const pm = n("pitchMultiplier", 4) ?? (flag("disableX") ? 0 : flag("invertX") ? -1 : 1);
			const ym = n("yawMultiplier", 5) ?? (flag("disableY") ? 0 : flag("invertY") ? -1 : 1);
			return `q.look('${head}', ${pm}, ${ym}, ${n("maxPitch", 6) ?? 70}, ${n("minPitch", 7) ?? -45}, ${n("maxYaw", 8) ?? 45}, ${n("minYaw", 9) ?? -45})`;
		}
		case "SingleBoneLookAnimation": {
			const first = c.named.bone ?? c.named.frame ?? c.positional[0];
			const bone = first === "this" ? ctx.parts.get("head") : ctx.frames.get(first?.trim() ?? "")?.get("head") ?? ctx.bone(first);
			if (!bone) {
				ctx.unsupported.push(`SingleBoneLookAnimation: ${e.slice(0, 80)}`);
				return undefined;
			}
			// Construtor secundário (frame, invertX, invertY, disableX, disableY, pm?, ym?, maxPitch?, minPitch?, maxYaw?, minYaw?)
			const boolArg = (i: number, k: string) => (c.named[k] ?? c.positional[i]) === "true";
			const secondary = ["true", "false"].includes(c.positional[1] ?? "") || c.named.invertX !== undefined || c.named.disableX !== undefined;
			if (secondary) {
				const pm = n("pitchMultiplier", 5) ?? (boolArg(3, "disableX") ? 0 : boolArg(1, "invertX") ? -1 : 1);
				const ym = n("yawMultiplier", 6) ?? (boolArg(4, "disableY") ? 0 : boolArg(2, "invertY") ? -1 : 1);
				return `q.look('${bone}', ${pm}, ${ym}, ${n("maxPitch", 7) ?? 70}, ${n("minPitch", 8) ?? -45}, ${n("maxYaw", 9) ?? 45}, ${n("minYaw", 10) ?? -45})`;
			}
			return `q.look('${bone}', ${n("pitchMultiplier", 1) ?? 1}, ${n("yawMultiplier", 2) ?? 1}, ${n("maxPitch", 3) ?? 70}, ${n("minPitch", 4) ?? -45}, ${n("maxYaw", 5) ?? 45}, ${n("minYaw", 6) ?? -45})`;
		}
		case "BipedWalkAnimation": {
			const l = ctx.bone(c.named.leftLeg) ?? ctx.parts.get("leftLeg");
			const r = ctx.bone(c.named.rightLeg) ?? ctx.parts.get("rightLeg");
			if (!l || !r) {
				ctx.unsupported.push("BipedWalk sem pernas");
				return undefined;
			}
			return `q.biped_walk(${n("periodMultiplier", 1) ?? 0.6662}, ${n("amplitudeMultiplier", 2) ?? 1.4}, '${l}', '${r}')`;
		}
		case "QuadrupedWalkAnimation": {
			const b = ["foreLeftLeg", "foreRightLeg", "hindLeftLeg", "hindRightLeg"].map((k) => ctx.parts.get(k));
			const named = ["legFrontLeft", "legFrontRight", "legBackLeft", "legBackRight"].map((k) => ctx.bone(c.named[k]));
			const bones = b.map((x, i) => named[i] ?? x);
			if (bones.some((x) => !x)) {
				ctx.unsupported.push("QuadrupedWalk sem pernas");
				return undefined;
			}
			return `q.quadruped_walk(${n("periodMultiplier", 1) ?? 0.6662}, ${n("amplitudeMultiplier", 2) ?? 1.4}, ${bones.map((x) => `'${x}'`).join(", ")})`;
		}
		case "BimanualSwingAnimation": {
			const l = ctx.bone(c.named.leftArm) ?? ctx.parts.get("leftArm");
			const r = ctx.bone(c.named.rightArm) ?? ctx.parts.get("rightArm");
			if (!l || !r) {
				ctx.unsupported.push("BimanualSwing sem braços");
				return undefined;
			}
			return `q.bimanual_swing(${n("swingPeriodMultiplier", 1) ?? 0.6662}, ${n("amplitudeMultiplier", 2) ?? 1}, '${l}', '${r}')`;
		}
		case "wingFlap":
		case "WingFlapIdleAnimation": {
			const s = waveSpec(c.named.flapFunction ?? c.named.rotation, ctx);
			const axis = axisOf(c.named.axis) ?? "y";
			const frame = c.receiver ? ctx.frames.get(c.receiver) : undefined;
			const l = ctx.bone(c.named.leftWing) ?? frame?.get("leftWing") ?? ctx.parts.get("leftWing");
			const r = ctx.bone(c.named.rightWing) ?? frame?.get("rightWing") ?? ctx.parts.get("rightWing");
			if (c.receiver && !frame) ctx.unsupported.push(`wingFlap em frame desconhecido: ${c.receiver}`);
			const time = timeExpr(c.named.timeVariable ?? (c.lambda ? `{${c.lambda}}` : undefined), ctx);
			if (!s || !l || !r || !time) {
				ctx.unsupported.push(`wingFlap: ${e.slice(0, 90)}`);
				return undefined;
			}
			return `q.cobblemon_wing_flap(${specArgs(s)}, '${axis}', '${l}', '${r}', '${time}')`;
		}
		case "rotation":
		case "translation": {
			const bone = ctx.bone(c.receiver);
			const s = waveSpec(c.named.function ?? c.positional[0], ctx);
			const axis = axisOf(c.named.axis ?? c.positional[1]);
			const tv = c.named.timeVariable ?? c.positional[2] ?? (c.lambda ? `{${c.lambda}}` : undefined);
			const time = timeExpr(tv, ctx);
			if (!bone || !s || !axis || !time) {
				ctx.unsupported.push(`${c.name}(fn): ${e.slice(0, 90)}`);
				return undefined;
			}
			return `q.cobblemon_fn('${c.name}', '${bone}', '${axis}', ${specArgs(s)}, '${time}')`;
		}
		case "WaveAnimation": {
			const s = waveSpec(c.named.waveFunction, ctx);
			const segs = c.named.segments ? parseCallExpr(c.named.segments) : undefined;
			const segBones = segs?.positional.map((x) => ctx.parts.get(`seg:${x.trim()}`)) ?? [];
			if (c.named.moveHead === "true") ctx.unsupported.push("WaveAnimation(moveHead=true): cabeça não se move");
			if (!s || segBones.some((x) => !x) || !segBones.length) {
				ctx.unsupported.push(`WaveAnimation: ${e.slice(0, 60)}`);
				return undefined;
			}
			const time = c.named.basedOnLimbSwing === "true" ? "q.modified_distance_moved" : "q.anim_time";
			return `q.cobblemon_wave_chain(${specArgs(s)}, ${ctx.num(c.named.oscillationsScalar) ?? 1}, ${ctx.num(c.named.headLength) ?? 0}, '${axisOf(c.named.rotationAxis) ?? "y"}', '${time}', ${segBones.map((b) => `'${b}'`).join(", ")})`;
		}
		default:
			ctx.unsupported.push(`anim ${c.name}`);
			return undefined;
	}
}

function quirkExpr(expr: string, ctx: Ctx): string | undefined {
	const c = parseCallExpr(expr);
	if (!c || !["quirk", "quirkMultiple"].includes(c.name) || !c.lambda) return undefined;
	const secs = c.named.secondsBetweenOccurrences ?? c.positional[0];
	let min = 8;
	let max = 30;
	let loops = 1;
	if (secs) {
		const m = /^\(?\s*([^\s]+)\s+to\s+([^\s)]+)\s*\)?$/.exec(secs.trim());
		const a = m ? ctx.num(m[1]) : undefined;
		const b = m ? ctx.num(m[2]) : undefined;
		if (a === undefined || b === undefined) {
			ctx.unsupported.push(`quirk seconds: ${secs}`);
			return undefined;
		}
		min = a;
		max = b;
	}
	const lt = c.named.loopTimes ?? c.positional[1];
	if (lt) {
		const m = /(\d+)\s*\.\.\s*(\d+)/.exec(lt);
		if (m) loops = Number(m[2]);
	}
	if (c.named.condition) ctx.unsupported.push(`quirk condition: ${c.named.condition}`);
	const refs: Array<[string, string]> = [];
	for (const m of c.lambda.matchAll(/bedrock(?:Stateful)?\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)) refs.push([m[1], m[2]]);
	if (!refs.length || new Set(refs.map((r) => r[0])).size > 1) {
		ctx.unsupported.push(`quirk lambda: ${c.lambda.slice(0, 60)}`);
		return undefined;
	}
	const names = refs.map((r) => `'${r[1]}'`);
	// quirkMultiple toca todas juntas; o dialeto JSON só sabe "uma de várias" (q.array): aproximação por sorteio.
	const list = names.length === 1 ? names[0] : `q.array(${names.join(", ")})`;
	return `q.bedrock_quirk('${refs[0][0]}', ${list}, ${min}, ${max}, ${loops})`;
}

/** Frente dados-ia: expressão Molang de um val (`isSheared`) ou literal `"...".asExpressionLike()`. */
function expressionOf(expr: string, ctx: Ctx): string | undefined {
	const e = expr.trim();
	const lit = /^"([^"]+)"\.asExpressionLike\(\)$/.exec(e);
	if (lit) return substituteDataKeys(lit[1]);
	const v = ctx.anims.get(e);
	// Só expressões (não referências de animação q.bedrock...).
	return v && !/^q\.bedrock/.test(v) ? v : undefined;
}

function transformation(expr: string, ctx: Ctx): any | undefined {
	// <part>.createTransformation().addPosition(...).addRotation(...).withVisibility(...)
	const e = expr.replace(/\s+/g, "");
	const m = /^([\w.]+|getPart\("[^"]+"\))\.createTransformation\(\)((?:\.\w+\([^()]*(?:\([^()]*\)[^()]*)*\))*)$/.exec(e);
	if (!m) {
		ctx.unsupported.push(`transformedPart: ${expr.slice(0, 80)}`);
		return undefined;
	}
	const part = ctx.bone(m[1]);
	if (!part) {
		ctx.unsupported.push(`transformedPart osso: ${m[1]}`);
		return undefined;
	}
	const out: any = { part };
	const pos = [0, 0, 0];
	const rot = [0, 0, 0];
	let hasPos = false;
	let hasRot = false;
	for (const call of m[2].matchAll(/\.(\w+)\(((?:[^()]|\([^()]*\))*)\)/g)) {
		const args = splitTop(call[2]);
		const name = call[1];
		if (name === "withVisibility") {
			const v = (args[0] ?? "").replace(/^visibility=/, "");
			// Frente dados-ia: visibilidade por expressão (`withVisibility(visibility = isNotSheared)`).
			if (v === "true" || v === "false") out.isVisible = v === "true";
			else {
				const cond = expressionOf(v, ctx);
				if (cond) out.isVisible = cond;
				else ctx.unsupported.push(`withVisibility: ${v.slice(0, 60)}`);
			}
			continue;
		}
		const vec = (target: number[], factor: number, add: boolean) => {
			if (args.length === 3) {
				args.forEach((a, i) => {
					const v = ctx.num(a);
					if (v === undefined) throw a;
					target[i] = (add ? target[i] : 0) + v * factor;
				});
			} else if (args.length === 2) {
				const ax = ["x", "y", "z"].indexOf(axisOf(args[0]) ?? "");
				const v = ctx.num(args[1]);
				if (ax < 0 || v === undefined) throw args.join(",");
				target[ax] = (add ? target[ax] : 0) + v * factor;
			} else throw args.join(",");
		};
		try {
			if (name === "addPosition" || name === "withPosition") {
				vec(pos, 1, name === "addPosition");
				hasPos = true;
			} else if (name === "addRotation" || name === "withRotation") {
				vec(rot, 1, name === "addRotation");
				hasRot = true;
			} else if (name === "addRotationDegrees" || name === "withRotationDegrees") {
				vec(rot, Math.PI / 180, name === "addRotationDegrees");
				hasRot = true;
			} else {
				ctx.unsupported.push(`transform .${name}`);
				return undefined;
			}
		} catch (bad) {
			ctx.unsupported.push(`transform arg: ${bad}`);
			return undefined;
		}
	}
	// Formato JSON do Cobblemon: posição no espaço do Java (Y para baixo) e rotação em GRAUS.
	if (hasPos) out.position = pos.map((v) => r5(v));
	if (hasRot) out.rotation = rot.map((v) => +((v * 180) / Math.PI).toFixed(3));
	return out;
}

// ------------------------------------------------------------------ cry / faint com escolha por pose ou batalha

type Choice = { when: "battle" | "poses" | "notPoses" | "always"; poses?: string[]; anim: string };

/** Corpo de `CryProvider { ... }` / `getFaintAnimation(...) = ...` → lista ordenada de escolhas. */
function choices(bodyRaw: string, ctx: Ctx, what: string): Choice[] | undefined {
	const body = bodyRaw.replace(/\s+/g, " ").trim().replace(/^\w+ -> /, "");
	const anim = (x: string) => {
		const inner = /^PrimaryAnimation\((.*)\)$/.exec(x.trim());
		const e = inner ? inner[1] : x;
		return animRefExpr(e) ?? ctx.anims.get(e.trim());
	};
	const test = (cond: string): Omit<Choice, "anim"> | undefined => {
		const c = cond.trim();
		const posed = /^\w+\.isPosedIn\(([^)]*)\)$/.exec(c);
		if (posed) return { when: "poses", poses: posed[1].split(",").map((s) => s.trim()) };
		const notPosed = /^\w+\.isNotPosedIn\(([^)]*)\)$/.exec(c);
		if (notPosed) return { when: "notPoses", poses: notPosed[1].split(",").map((s) => s.trim()) };
		if (/^(?:\w+\.isBattling|\(\w+\.getEntity\(\) as\? PokemonEntity\)\?\.isBattling == true)$/.test(c)) return { when: "battle" };
		return undefined;
	};
	// if (cond) A else B | if (cond) A else if (cond2) B else null
	const ANIM = String.raw`(?:PrimaryAnimation\()?(?:\w+\("[^"]*"\s*,\s*"[^"]*"(?:\s*,\s*"[^"]*")?\)|"[^"]*"\.asExpressionLike\(\)|\w+)\)?`;
	const ifm = new RegExp(`^if \\((.+?)\\) (${ANIM}) else (.+)$`).exec(body);
	if (ifm) {
		const t = test(ifm[1]);
		const a = anim(ifm[2]);
		if (!t || !a) {
			ctx.unsupported.push(`${what}: ${body.slice(0, 90)}`);
			return undefined;
		}
		const tail = ifm[3].trim();
		if (tail === "null") return [{ ...t, anim: a }];
		const rest = choices(tail, ctx, what);
		return rest ? [{ ...t, anim: a }, ...rest] : undefined;
	}
	const when = /^when \{ (.+) \}$/.exec(body);
	if (when) {
		const out: Choice[] = [];
		for (const branch of when[1].split(/ (?=(?:\w+\.is\w+|else|\(\w+\.getEntity)[^>]*->)/)) {
			const bm = /^(.+?) -> (.+)$/.exec(branch.trim());
			if (!bm) {
				ctx.unsupported.push(`${what}(when): ${branch}`);
				return undefined;
			}
			const a = bm[2].trim() === "null" ? null : anim(bm[2]);
			if (a === undefined) {
				ctx.unsupported.push(`${what}(when): ${branch}`);
				return undefined;
			}
			if (bm[1].trim() === "else") {
				if (a) out.push({ when: "always", anim: a });
				continue;
			}
			const t = test(bm[1]);
			if (!t) {
				ctx.unsupported.push(`${what}(when): ${branch}`);
				return undefined;
			}
			if (a) out.push({ ...t, anim: a });
		}
		return out;
	}
	const a = anim(body);
	if (a) return [{ when: "always", anim: a }];
	ctx.unsupported.push(`${what}: ${body.slice(0, 90)}`);
	return undefined;
}

/** Aplica as escolhas como `animations[key]` (sempre) e `namedAnimations[key]` nas poses que batem. */
function applyChoices(poser: any, key: string, list: Choice[], poseVarToName: Map<string, string>, ctx: Ctx): void {
	// A PRIMEIRA escolha que bate vence; por isso percorremos do fim para o começo, sobrescrevendo.
	const poseNames = Object.keys(poser.poses);
	for (const ch of [...list].reverse()) {
		if (ch.when === "always") {
			poser.animations[key] = ch.anim;
			for (const p of poseNames) if (poser.poses[p].namedAnimations?.[key]) delete poser.poses[p].namedAnimations[key];
			continue;
		}
		let targets: string[];
		if (ch.when === "battle") targets = poseNames.filter((p) => poser.poses[p].isBattle === true);
		else {
			const names = (ch.poses ?? []).map((v) => poseVarToName.get(v));
			if (names.some((x) => !x)) {
				ctx.unsupported.push(`${key}: pose desconhecida em ${ch.poses?.join(",")}`);
				continue;
			}
			targets = ch.when === "poses" ? (names as string[]) : poseNames.filter((p) => !names.includes(p));
		}
		for (const p of targets) (poser.poses[p].namedAnimations ??= {})[key] = ch.anim;
	}
}

// ------------------------------------------------------------------ arquivo

export interface KotlinPoserResult {
	file: string;
	cls: string;
	poser: any;
	poses: number;
	animsOk: number;
	animsTotal: number;
	unsupported: string[];
}

export function convertKotlinPoser(file: string): KotlinPoserResult {
	const src = stripComments(readFileSync(file, "utf8"));
	const ctx = new Ctx();
	const cls = basename(file, ".kt");
	const root = /rootPart\s*=\s*root\.registerChildWithAllChildren\("([^"]+)"\)/.exec(src);
	if (root) ctx.parts.set("rootPart", root[1]);
	// Frames extras (val x = object : HeadedFrame/BiWingedFrame { override val head = getPart("y") ... }):
	// cada um tem seu mapa de ossos e sai do texto usado para achar os ossos do modelo.
	let partsSrc = src;
	for (const m of src.matchAll(/va[lr]\s+(\w+)\s*=\s*object\s*:\s*\w+Frame\s*\{/g)) {
		const open = m.index! + m[0].length - 1;
		const close = matchClose(src, open);
		if (close < 0) continue;
		const body = src.slice(open, close + 1);
		const frame = new Map<string, string>();
		for (const p of body.matchAll(/override\s+val\s+(\w+)\s*(?::\s*\w+\??)?\s*=\s*getPart\("([^"]+)"\)/g)) frame.set(p[1], p[2]);
		ctx.frames.set(m[1], frame);
		partsSrc = partsSrc.replace(body, "{}");
	}
	for (const m of partsSrc.matchAll(/(?:override\s+)?(?:private\s+)?(?:val|var)\s+(\w+)\s*(?::\s*\w+\??)?\s*=\s*getPart\("([^"]+)"\)/g)) ctx.parts.set(m[1], m[2]);
	for (const m of src.matchAll(/(?:private\s+)?va[lr]\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(-?[\d.]+[fFdD]?|\([^)\n]*\)\.toRadians\(\)|-?[\d.]+[fF]?\.toRadians\(\))\s*\n/g)) {
		const v = ctx.num(m[2]);
		if (v !== undefined) ctx.consts.set(m[1], v);
	}
	for (const m of src.matchAll(/va[lr]\s+(\w+)\s*=\s*WaveSegment\(\s*(?:modelPart\s*=\s*)?(\w+)\s*,\s*(?:length\s*=\s*)?([\d.]+)[fF]?\s*\)/g)) {
		const b = ctx.parts.get(m[2]);
		if (b) ctx.parts.set(`seg:${m[1]}`, `${b}:${Number(m[3])}`);
	}
	// vals locais: quirks, animações nomeadas (bedrock/bedrockStateful ou "molang".asExpressionLike())
	for (const m of src.matchAll(/val\s+(\w+)\s*=\s*(?=quirk|quirkMultiple|bedrock|")/g)) {
		const start = m.index! + m[0].length;
		const ml = /^"([^"]+)"\.asExpressionLike\(\)/.exec(src.slice(start));
		if (ml) {
			ctx.anims.set(m[1], substituteDataKeys(ml[1]));
			continue;
		}
		const c = readCall(src, start);
		if (!c) continue;
		const text = src.slice(start, c.end);
		if (c.name.startsWith("quirk")) {
			const q = quirkExpr(text, ctx);
			if (q) ctx.quirks.set(m[1], [q]);
		} else {
			const a = c.name === "bedrockStateful" ? bedrockRef(c, "bedrock_stateful") : c.name === "bedrock" ? bedrockRef(c, "bedrock") : undefined;
			if (a) ctx.anims.set(m[1], a);
		}
	}
	const poser: any = { rootBone: ctx.parts.get("rootPart"), animations: {}, poses: {} };
	const poseVarToName = new Map<string, string>();
	let animsOk = 0;
	let animsTotal = 0;
	for (const m of src.matchAll(/(?:(\w+)\s*=\s*)?registerPose\s*\(/g)) {
		const c = readCall(src, m.index! + (m[0].length - "registerPose(".length));
		if (!c) {
			ctx.unsupported.push("registerPose ilegível");
			continue;
		}
		const a = c.named;
		const types = a.poseTypes ? poseTypes(a.poseTypes, ctx) : a.poseType ? poseTypes(a.poseType, ctx) : undefined;
		const name = str(a.poseName) ?? (a.poseType ? a.poseType.replace(/^PoseType\./, "").toLowerCase() : `pose_${Object.keys(poser.poses).length}`);
		if (m[1]) poseVarToName.set(m[1], name);
		const pose: any = { poseTypes: types ?? [] };
		if (a.condition) {
			const lam = /^\{([\s\S]*)\}$/.exec(a.condition.trim());
			const cond = lam ? condition(lam[1], ctx) : undefined;
			if (cond) {
				for (const [k, v] of Object.entries(cond.flags)) pose[k] = v;
				if (cond.molang.length) pose.condition = cond.molang.join(" && ");
			} else pose.condition = "false";
		}
		const list = (k: string) => {
			const x = a[k] ? /^(?:arrayOf|listOf|mutableListOf)\(([\s\S]*)\)$/.exec(a[k].trim()) : null;
			return x ? splitTop(x[1]) : [];
		};
		pose.animations = [];
		for (const an of list("animations")) {
			animsTotal++;
			// Frente dados-ia: `anim.withCondition(expr)` → { animation, condition } (dialeto JSON dos posers).
			const withCond = /^([\s\S]+)\.withCondition\(([\s\S]+)\)$/.exec(an.trim());
			const conv = animation(withCond ? withCond[1] : an, ctx);
			if (conv) {
				if (withCond) {
					const cond = expressionOf(withCond[2], ctx);
					if (cond) pose.animations.push({ animation: conv, condition: cond });
					else {
						ctx.unsupported.push(`withCondition: ${withCond[2].slice(0, 60)}`);
						continue;
					}
				} else pose.animations.push(conv);
				animsOk++;
			}
		}
		const quirks: string[] = [];
		for (const q of list("quirks")) {
			const fromVal = ctx.quirks.get(q.trim());
			const inline = fromVal ? undefined : quirkExpr(q, ctx);
			if (fromVal) quirks.push(...fromVal);
			else if (inline) quirks.push(inline);
			else ctx.unsupported.push(`quirk ref: ${q.slice(0, 40)}`);
		}
		if (quirks.length) pose.quirks = quirks;
		const tps = list("transformedParts").map((t) => transformation(t, ctx)).filter(Boolean);
		if (tps.length) pose.transformedParts = tps;
		if (a.namedAnimations) {
			const mm = /mutableMapOf\(([\s\S]*)\)/.exec(a.namedAnimations);
			if (mm) {
				pose.namedAnimations = {};
				for (const kv of splitTop(mm[1])) {
					const p = /^"([^"]+)"\s+to\s+([\s\S]+)$/.exec(kv.trim());
					const v = p ? ctx.anims.get(p[2].trim()) ?? animRefExpr(p[2]) : undefined;
					if (p && v) pose.namedAnimations[p[1]] = v;
					else ctx.unsupported.push(`namedAnimation: ${kv.slice(0, 60)}`);
				}
			}
		}
		poser.poses[name] = pose;
	}
	// cry: CryProvider { ... }
	const cryAt = /cryAnimation\s*=\s*CryProvider\s*\{/.exec(src);
	if (cryAt) {
		const open = cryAt.index + cryAt[0].length - 1;
		const close = matchClose(src, open);
		const list = close > 0 ? choices(src.slice(open + 1, close), ctx, "cry") : undefined;
		if (list) applyChoices(poser, "cry", list, poseVarToName, ctx);
	}
	// faint: override fun getFaintAnimation(state: PosableState) = <expr>  (até o próximo "override"/fim da classe)
	const faintAt = /override\s+fun\s+getFaintAnimation\s*\(/.exec(src);
	if (faintAt) {
		const paren = src.indexOf("(", faintAt.index);
		const close = matchClose(src, paren);
		let rest = src.slice(close + 1).trimStart();
		let body: string | undefined;
		if (rest.startsWith("=")) {
			rest = rest.slice(1);
			const stop = rest.search(/\n\s*(?:override|fun|val|var|private|\}\s*$)/);
			body = (stop >= 0 ? rest.slice(0, stop) : rest).trim();
		} else if (rest.startsWith(":")) {
			const eq = rest.indexOf("=");
			const stop = rest.slice(eq + 1).search(/\n\s*(?:override|fun|val|var|private|\}\s*$)/);
			body = (stop >= 0 ? rest.slice(eq + 1, eq + 1 + stop) : rest.slice(eq + 1)).trim();
		}
		const list = body ? choices(body, ctx, "faint") : undefined;
		if (list) applyChoices(poser, "faint", list, poseVarToName, ctx);
		else if (!body) ctx.unsupported.push("getFaintAnimation com corpo em bloco");
	}
	// Enquadramento de retrato/perfil (pedido da frente retratos): escala e Vec3(x, y, z).
	for (const k of ["portraitScale", "profileScale"]) {
		const m = new RegExp(`${k}\\s*=\\s*(-?[\\d.]+)[fFdD]?\\b`).exec(src);
		if (m) poser[k] = Number(m[1]);
	}
	for (const k of ["portraitTranslation", "profileTranslation"]) {
		const m = new RegExp(`${k}\\s*=\\s*Vec3d?\\(([^)]*)\\)`).exec(src);
		const v = m ? splitTop(m[1]).map((x) => ctx.num(x)) : undefined;
		if (v?.length === 3 && v.every((x) => x !== undefined)) poser[k] = v;
	}
	if (!Object.keys(poser.animations).length) delete poser.animations;
	return { file, cls, poser, poses: Object.keys(poser.poses).length, animsOk, animsTotal, unsupported: ctx.unsupported };
}

/** Posers registrados só em Kotlin (inbuilt sem JSON de mesmo nome): nome → arquivo .kt. */
export function kotlinOnlyPosers(): Map<string, string> {
	const repo = readFileSync(join(KT, "repository", "VaryingModelRepository.kt"), "utf8");
	const inbuilt = new Map([...repo.matchAll(/inbuilt\("([^"]+)",\s*::\s*(\w+)\)/g)].map((m) => [m[1], m[2]]));
	const jsonNames = new Set(walk(join(ASSETS, "bedrock", "pokemon", "posers"), (n) => n.endsWith(".json")).map((f) => basename(f, ".json")));
	const files = new Map(walk(join(KT, "pokemon"), (n) => n.endsWith(".kt")).map((f) => [basename(f, ".kt"), f]));
	const out = new Map<string, string>();
	for (const [name, cls] of [...inbuilt].sort()) {
		if (jsonNames.has(name) || !files.has(cls)) continue;
		out.set(name, files.get(cls)!);
	}
	return out;
}

/** Converte todos e grava em tools/importer/data/kotlin-posers (congelado para revisão por diff). */
export function writeKotlinPosers(outDir = KOTLIN_POSERS_DIR): { files: number; clean: number; poses: number; animsOk: number; animsTotal: number; pending: Record<string, string[]> } {
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	const pending: Record<string, string[]> = {};
	let clean = 0;
	let poses = 0;
	let animsOk = 0;
	let animsTotal = 0;
	const posers = kotlinOnlyPosers();
	for (const [name, file] of posers) {
		const r = convertKotlinPoser(file);
		poses += r.poses;
		animsOk += r.animsOk;
		animsTotal += r.animsTotal;
		if (r.unsupported.length) pending[name] = r.unsupported;
		else clean++;
		writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify({ _source: `${r.cls}.kt`, ...r.poser }, null, "\t")}\n`);
	}
	const summary = { files: posers.size, clean, poses, animsOk, animsTotal, pending };
	writeFileSync(join(outDir, "_report.json"), `${JSON.stringify(summary, null, "\t")}\n`);
	return summary;
}

/** Posers Kotlin congelados (nome → JSON) e as pendências registradas na conversão. */
export function loadKotlinPosers(dir = KOTLIN_POSERS_DIR): { posers: Map<string, any>; pending: Record<string, string[]> } {
	const posers = new Map<string, any>();
	if (!existsSync(dir)) return { posers, pending: {} };
	for (const f of walk(dir, (n) => n.endsWith(".json") && !n.startsWith("_"))) posers.set(basename(f, ".json"), JSON.parse(readFileSync(f, "utf8")));
	const reportFile = join(dir, "_report.json");
	const pending = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")).pending ?? {} : {};
	return { posers, pending };
}

// ------------------------------------------------------------------ CLI (regenera os JSON congelados)

if (process.argv[1] && /kotlinPosers\.ts$/.test(process.argv[1])) {
	const s = writeKotlinPosers();
	console.log(`posers Kotlin: ${s.files} arquivos, ${s.clean} sem pendência (${((100 * s.clean) / Math.max(1, s.files)).toFixed(1)}%), ${s.poses} poses, animações ${s.animsOk}/${s.animsTotal}`);
	for (const [n, list] of Object.entries(s.pending)) console.log(`  PENDENTE ${n}: ${list.join(" | ")}`);
	console.log(`→ ${KOTLIN_POSERS_DIR}`);
}
