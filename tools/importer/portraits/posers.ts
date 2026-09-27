// Enquadramento e pose de UI (PORTRAIT/PROFILE) de cada poser do Cobblemon, para o renderizador de retratos.
// Fontes, na ordem:
//  1. poser JSON (bedrock/pokemon/posers/**), igual ao PoserFactory;
//  2. poser Kotlin já convertido em JSON pela frente "animacao" (se existir; ver KOTLIN_POSER_JSON_DIRS);
//  3. poser Kotlin lido por regex (VaryingModelRepository.inbuilt → pokemon/**/XModel.kt): escala/translação,
//     primeira pose com PORTRAIT/PROFILE, chamadas bedrock("grupo", "anim") e transformedParts simples.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { KOTLIN } from "../kotlin.ts";
import { BEDROCK_POKEMON, ROOT, splitId, tryReadJson, walk } from "../util.ts";

export type Vec3 = [number, number, number];

/** Animação da pose: grupo + nome local, com condição Molang opcional. */
export interface PoseAnim {
	group: string;
	name: string;
	condition?: string;
}

export interface UiPose {
	anims: PoseAnim[];
	/** transformedParts no formato do JSON do Cobblemon ({ part, position, rotation, isVisible }). */
	transformed: any[];
}

export interface PortraitPoser {
	name: string;
	source: "json" | "kotlin-json" | "kotlin" | "default";
	portraitScale: number;
	portraitTranslation: Vec3;
	profileScale: number;
	profileTranslation: Vec3;
	portrait: UiPose;
	profile: UiPose;
}

/**
 * Posers Kotlin convertidos para JSON pela frente "animacao" (kotlinPosers.ts, congelados em
 * tools/importer/data/kotlin-posers/<poser>.json). Poses, animações e transformedParts vêm de lá; a translação
 * do enquadramento (que o conversor ainda não grava) vem da leitura por regex do .kt.
 */
const KOTLIN_POSER_JSON_DIRS = [join(ROOT, "tools", "importer", "data", "kotlin-posers")];

const ALL_POSE_TYPES = ["STAND", "WALK", "SLEEP", "HOVER", "FLY", "FLOAT", "SWIM", "GLIDE", "SHOULDER_LEFT", "SHOULDER_RIGHT", "PROFILE", "PORTRAIT", "OPEN", "NONE"];
/** Conjuntos do PoseType.kt. */
const POSE_SETS: Record<string, string[]> = {
	ALL_POSES: ALL_POSE_TYPES,
	FLYING_POSES: ["FLY", "HOVER"],
	SWIMMING_POSES: ["SWIM", "FLOAT"],
	STANDING_POSES: ["STAND", "WALK"],
	SHOULDER_POSES: ["SHOULDER_LEFT", "SHOULDER_RIGHT"],
	UI_POSES: ["PROFILE", "PORTRAIT"],
	MOVING_POSES: ["WALK", "SWIM", "FLY"],
	STATIONARY_POSES: ["STAND", "FLOAT", "HOVER"],
	NO_GRAV_POSES: ["FLY", "HOVER", "SWIM"],
};

const emptyPose = (): UiPose => ({ anims: [], transformed: [] });

export class PortraitPoserIndex {
	private json = new Map<string, string>();
	private kotlinJson = new Map<string, string>();
	private inbuilt = new Map<string, string>();
	private cache = new Map<string, PortraitPoser>();

	constructor() {
		for (const f of walk(`${BEDROCK_POKEMON}/posers`, (n) => n.endsWith(".json"))) this.json.set(basename(f, ".json"), f);
		for (const dir of KOTLIN_POSER_JSON_DIRS) for (const f of walk(dir, (n) => n.endsWith(".json") && !n.startsWith("_"))) this.kotlinJson.set(basename(f, ".json"), f);
		const bb = join(KOTLIN, "client", "render", "models", "blockbench");
		const repoFile = join(bb, "repository", "VaryingModelRepository.kt");
		if (existsSync(repoFile)) {
			const kt = new Map(walk(join(bb, "pokemon"), (n) => n.endsWith(".kt")).map((f) => [basename(f, ".kt"), f]));
			const repo = stripComments(readFileSync(repoFile, "utf8"));
			for (const m of repo.matchAll(/inbuilt\("([^"]+)",\s*::\s*(\w+)\)/g)) if (kt.has(m[2])) this.inbuilt.set(m[1], kt.get(m[2])!);
		}
	}

	get(poserId: string | undefined): PortraitPoser {
		const name = splitId(poserId ?? "").path;
		let p = this.cache.get(name);
		if (!p) {
			p = this.load(name);
			this.cache.set(name, p);
		}
		return p;
	}

	private load(name: string): PortraitPoser {
		const jf = this.json.get(name);
		if (jf) {
			const j = tryReadJson(jf);
			if (j?.poses) return fromJson(name, j, "json");
		}
		const kf = this.inbuilt.get(name);
		const fromKt = kf ? fromKotlin(name, readFileSync(kf, "utf8")) : undefined;
		const kj = this.kotlinJson.get(name);
		const j = kj ? tryReadJson(kj) : undefined;
		if (j?.poses) {
			const p = fromJson(name, j, "kotlin-json");
			if (fromKt) {
				// Campos de enquadramento ausentes no JSON convertido: os do .kt.
				if (j.portraitScale === undefined) p.portraitScale = fromKt.portraitScale;
				if (j.portraitTranslation === undefined) p.portraitTranslation = fromKt.portraitTranslation;
				if (j.profileScale === undefined && j.profileSummaryScale === undefined) p.profileScale = fromKt.profileScale;
				if (j.profileTranslation === undefined && j.profileSummaryTranslation === undefined) p.profileTranslation = fromKt.profileTranslation;
			}
			return p;
		}
		if (fromKt) return fromKt;
		return { name, source: "default", portraitScale: 1, portraitTranslation: [0, 0, 0], profileScale: 1, profileTranslation: [0, 0, 0], portrait: emptyPose(), profile: emptyPose() };
	}
}

// ---------------------------------------------------------------------------------------------
// JSON

function vec(v: unknown): Vec3 {
	if (Array.isArray(v) && v.length >= 3) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>;
		return [Number(o.x) || 0, Number(o.y) || 0, Number(o.z) || 0];
	}
	return [0, 0, 0];
}

function fromJson(name: string, j: any, source: PortraitPoser["source"]): PortraitPoser {
	const poses = Object.values<any>(j.poses ?? {});
	const hasType = (p: any, t: string) => p.allPoseTypes === true || (p.poseTypes ?? []).some((s: string) => String(s).toUpperCase() === t);
	const pick = (t: string): UiPose => {
		// setPoseToFirstSuitable: a primeira pose (ordem de declaração) com o tipo.
		const pose = poses.find((p) => hasType(p, t)) ?? poses.find((p) => hasType(p, "STAND") && !p.isBattle) ?? poses[0];
		if (!pose) return emptyPose();
		const anims: PoseAnim[] = [];
		for (const e of pose.animations ?? []) {
			const expr = typeof e === "string" ? e : e?.animation;
			const m = typeof expr === "string" ? /q\.bedrock\(\s*'([^']+)'\s*,\s*'([^']+)'/.exec(expr) : null;
			if (m) anims.push({ group: m[1], name: m[2], condition: typeof e === "object" && typeof e.condition === "string" ? e.condition : undefined });
		}
		return { anims, transformed: [...(j.transformedParts ?? []), ...(pose.transformedParts ?? [])] };
	};
	return {
		name,
		source,
		portraitScale: Number(j.portraitScale ?? 1),
		portraitTranslation: vec(j.portraitTranslation),
		profileScale: Number(j.profileSummaryScale ?? j.profileScale ?? 1),
		profileTranslation: vec(j.profileSummaryTranslation ?? j.profileTranslation),
		portrait: pick("PORTRAIT"),
		profile: pick("PROFILE"),
	};
}

// ---------------------------------------------------------------------------------------------
// Kotlin (regex)

/** Remove comentários de linha e de bloco (fora de strings). */
export function stripComments(src: string): string {
	return src.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => (m.startsWith('"') ? m : m.startsWith("/*") ? " " : ""));
}

/** Avalia `PoseType.STATIONARY_POSES + PoseType.UI_POSES - PoseType.FLOAT`, `setOf(...)` etc. */
export function evalPoseTypes(expr: string): Set<string> {
	const out = new Set<string>();
	const re = /([+-])?\s*(setOf\(([^)]*)\)|(?:PoseType\.)?([A-Z_]+))/g;
	for (const m of expr.matchAll(re)) {
		const sign = m[1] ?? "+";
		let items: string[] = [];
		if (m[3] !== undefined) items = [...m[3].matchAll(/(?:PoseType\.)?([A-Z_]+)/g)].flatMap((x) => POSE_SETS[x[1]] ?? [x[1]]);
		else if (m[4]) items = POSE_SETS[m[4]] ?? (ALL_POSE_TYPES.includes(m[4]) ? [m[4]] : []);
		for (const i of items) sign === "-" ? out.delete(i) : out.add(i);
	}
	return out;
}

/** Trecho de `open` até o parêntese que fecha (inclusive), respeitando aninhamento. */
function balanced(src: string, open: number): string {
	let depth = 0;
	for (let i = open; i < src.length; i++) {
		if (src[i] === "(") depth++;
		else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
	}
	return src.slice(open);
}

/** Valor de um argumento nomeado de nível 0 (`poseTypes = ...`) dentro de uma chamada. */
function namedArg(call: string, arg: string): string | undefined {
	const m = new RegExp(`\\b${arg}\\s*=`).exec(call);
	if (!m) return undefined;
	let depth = 0;
	const start = m.index + m[0].length;
	for (let i = start; i < call.length; i++) {
		const c = call[i];
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") {
			if (depth === 0) return call.slice(start, i);
			depth--;
		} else if (c === "," && depth === 0) return call.slice(start, i);
	}
	return call.slice(start);
}

const AXIS: Record<string, number> = { X_AXIS: 0, Y_AXIS: 1, Z_AXIS: 2 };

function fromKotlin(name: string, raw: string): PortraitPoser {
	const src = stripComments(raw);
	const num = (re: RegExp, d: number) => {
		const m = re.exec(src);
		return m ? Number(m[1].replace(/[Ff]$/, "")) : d;
	};
	const v3 = (re: RegExp): Vec3 => {
		const m = re.exec(src);
		if (!m) return [0, 0, 0];
		const p = m[1].split(",").map((s) => Number(s.trim().replace(/[FfDd]$/, "")));
		return [p[0] || 0, p[1] || 0, p[2] || 0];
	};
	// Partes: `val x = getPart("osso")` e `rootPart = root.registerChildWithAllChildren("osso")`.
	const parts = new Map<string, string>();
	for (const m of src.matchAll(/va[lr]\s+(\w+)\s*(?::\s*[\w.<>?]+)?\s*=\s*getPart\("([^"]+)"\)/g)) parts.set(m[1], m[2]);
	const root = /rootPart\s*=\s*root\.registerChildWithAllChildren\("([^"]+)"\)/.exec(src);
	if (root) parts.set("rootPart", root[1]);

	const poses: Array<{ types: Set<string>; call: string }> = [];
	for (const m of src.matchAll(/registerPose\s*\(/g)) {
		const call = balanced(src, m.index + m[0].length - 1);
		const types = evalPoseTypes(namedArg(call, "poseTypes") ?? "");
		poses.push({ types, call });
	}
	const pick = (t: string): UiPose => {
		const pose = poses.find((p) => p.types.has(t)) ?? poses.find((p) => p.types.has("STAND")) ?? poses[0];
		if (!pose) return emptyPose();
		const anims: PoseAnim[] = [...(namedArg(pose.call, "animations") ?? "").matchAll(/\bbedrock\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)].map((c) => ({ group: c[1], name: c[2] }));
		const transformed: any[] = [];
		const tp = namedArg(pose.call, "transformedParts") ?? "";
		for (const m of tp.matchAll(/(\w+)\.createTransformation\(\)((?:\s*\.\s*\w+\([^()]*\))*)/g)) {
			const part = parts.get(m[1]);
			if (!part) continue;
			const t: any = { part };
			for (const c of m[2].matchAll(/\.\s*(\w+)\(([^()]*)\)/g)) {
				const args = c[2].split(",").map((s) => s.trim().replace(/^\w+\s*=\s*/, ""));
				const axis = AXIS[(args[0] ?? "").replace(/^.*\./, "")];
				const value = Number((args[1] ?? "").replace(/[Ff]$/, ""));
				if (c[1] === "withVisibility" && (args[0] === "true" || args[0] === "false")) t.isVisible = args[0] === "true";
				else if (c[1] === "addPosition" && axis !== undefined && Number.isFinite(value)) (t.position ??= [0, 0, 0])[axis] += value;
				else if (c[1] === "addRotationDegrees" && axis !== undefined && Number.isFinite(value)) (t.rotation ??= [0, 0, 0])[axis] += value;
				else if (c[1] === "addRotation" && axis !== undefined && Number.isFinite(value)) (t.rotation ??= [0, 0, 0])[axis] += (value * 180) / Math.PI;
			}
			if (Object.keys(t).length > 1) transformed.push(t);
		}
		return { anims, transformed };
	};
	return {
		name,
		source: "kotlin",
		portraitScale: num(/portraitScale\s*=\s*([-\d.]+[Ff]?)/, 1),
		portraitTranslation: v3(/portraitTranslation\s*=\s*Vec3d?\(([^)]*)\)/),
		profileScale: num(/profileScale\s*=\s*([-\d.]+[Ff]?)/, 1),
		profileTranslation: v3(/profileTranslation\s*=\s*Vec3d?\(([^)]*)\)/),
		portrait: pick("PORTRAIT"),
		profile: pick("PROFILE"),
	};
}
