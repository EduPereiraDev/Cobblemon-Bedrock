// Posers do Cobblemon → animation controllers do Bedrock.
//
// Seleção de pose (igual ao Cobblemon: a PRIMEIRA pose cujo poseTypes contém o tipo atual e cujas condições
// batem) é calculada em Molang no pre_animation da client entity, na variável v.cobblemon_pose_<poser>.
// O controller tem um estado por pose "de mundo" (STAND, WALK, SLEEP, FLOAT, SWIM, FLY, HOVER) e transita
// quando a variável muda. Quirks (piscar etc.) viram controllers separados com timer aleatório.
// Posers só em Kotlin (sem JSON) vêm convertidos para o mesmo formato JSON (kotlinPosers.ts, congelados em
// tools/importer/data/kotlin-posers); só sem eles cai no poser de reserva montado pela convenção de nomes.
import { basename } from "node:path";
import type { AnimationIndex, AnimInfo, EmittedEffects } from "./animations.ts";
import { loadKotlinPosers } from "./kotlinPosers.ts";
import { rewriteMolang, scanMolang, splitArgs, unquote } from "./molang.ts";
import { javaMolangToBedrock } from "./molangSyntax.ts"; // frente cliente-modelos
import { BEDROCK_POKEMON, OUT_RP, count, safeName, splitId, tryReadJson, walk, warn, writeJson } from "./util.ts";

/** Códigos de v.cobblemon_pose_type (calculado no pre_animation da client entity). */
export const POSE_TYPE_CODE: Record<string, number> = { STAND: 0, WALK: 1, SLEEP: 2, FLOAT: 3, SWIM: 4, FLY: 5, HOVER: 6 };
const WORLD_POSE_TYPES = Object.keys(POSE_TYPE_CODE);

export interface PoserOutput {
	name: string;
	/** Veio de um JSON do Cobblemon ou de um poser Kotlin convertido (false = reserva por convenção). */
	fromJson: boolean;
	source: "json" | "kotlin" | "fallback";
	/** Linhas extras do pre_animation da client entity (pitch_tilt etc.). */
	preAnimation: string[];
	controllers: string[];
	/** chave curta → id da animação (tudo que os controllers usam + animações nomeadas). */
	animations: Map<string, string>;
	/** nome (cry, recoil, battle_cry, faint...) → id completo da animação. */
	named: Record<string, string>;
	poseVar: string;
	poseExpr: string;
	initialize: string[];
	effects: EmittedEffects[];
	poseNames: string[];
	/** Frente dados-ia: aspects lidos por q.has_aspect (viram v.cobblemon_aspect_<nome>, ver aspectVar). */
	aspects: string[];
}

interface AnimRef {
	short: string;
	id: string;
	condition?: string;
}

interface QuirkDef {
	anims: AnimInfo[];
	min: number;
	max: number;
	loops: number;
}

interface PoseDef {
	name: string;
	poseTypes: string[];
	condition: string;
	anims: AnimRef[];
	quirks: QuirkDef[];
	named: Record<string, AnimInfo>;
	isBattle?: boolean;
}

export class PoserFactory {
	private jsonPosers = new Map<string, string>();
	private kotlinPosers = new Map<string, any>();
	private kotlinPending: Record<string, string[]> = {};
	private cache = new Map<string, PoserOutput | null>();

	private anims: AnimationIndex;

	constructor(anims: AnimationIndex) {
		this.anims = anims;
		// Mesma chave que o Cobblemon: nome do arquivo sem extensão (o último vence).
		for (const file of walk(`${BEDROCK_POKEMON}/posers`, (n) => n.endsWith(".json"))) this.jsonPosers.set(basename(file, ".json"), file);
		const kt = loadKotlinPosers();
		this.kotlinPosers = kt.posers;
		this.kotlinPending = kt.pending;
	}

	hasJson(poserId: string): boolean {
		return this.jsonPosers.has(splitId(poserId).path);
	}

	/** Gera (uma vez) o controller do poser; `null` quando não há animações utilizáveis. */
	get(poserId: string, bones: Set<string>, speciesId: string): PoserOutput | null {
		const name = splitId(poserId).path;
		if (this.cache.has(name)) return this.cache.get(name)!;
		const file = this.jsonPosers.get(name);
		let result: PoserOutput | null;
		const kotlin = this.kotlinPosers.get(name);
		if (file) {
			const json = tryReadJson(file);
			if (!json?.poses) {
				warn("poser JSON inválido (usando reserva)", name);
				result = this.fallback(name, bones, speciesId);
			} else result = this.fromJson(name, json, bones, "json");
		} else if (kotlin?.poses) {
			// Conversão do Kotlin: pendências (se houver) já foram listadas pelo conversor; aqui só avisamos.
			for (const p of this.kotlinPending[name] ?? []) warn("poser Kotlin com trecho não convertido", `${name}: ${p}`);
			result = this.fromJson(name, kotlin, bones, "kotlin");
			if (result) count("posers Kotlin convertidos");
			else result = this.fallback(name, bones, speciesId);
		} else result = this.fallback(name, bones, speciesId);
		this.cache.set(name, result);
		return result;
	}

	// -----------------------------------------------------------------------------------------
	// Poser JSON

	private fromJson(name: string, json: any, bones: Set<string>, source: "json" | "kotlin"): PoserOutput | null {
		const ctx = new GenContext(name, this.anims);
		aspectSink = ctx.aspects;
		const poses: PoseDef[] = [];
		const topTransforms: any[] = json.transformedParts ?? [];
		for (const [poseName, pose] of Object.entries<any>(json.poses ?? {})) {
			const types: string[] = pose.allPoseTypes ? WORLD_POSE_TYPES : (pose.poseTypes ?? []).map((t: string) => String(t).toUpperCase());
			const worldTypes = types.filter((t) => WORLD_POSE_TYPES.includes(t));
			if (!worldTypes.length) continue;
			const def: PoseDef = { name: poseName, poseTypes: worldTypes, condition: poseCondition(pose, worldTypes, `${name}/${poseName}`), anims: [], quirks: [], named: {}, isBattle: pose.isBattle };
			// pitch_tilt na pose: o look desconta a inclinação já aplicada (SingleBoneLookAnimation).
			const entries: any[] = pose.animations ?? [];
			const tiltExpr = entries.map((e) => (typeof e === "string" ? e : e?.animation)).find((e) => typeof e === "string" && /\bq(?:uery)?\.pitch_tilt\s*\(/.test(e));
			ctx.poseTilt = tiltExpr ? ctx.pitchTiltVar(tiltExpr) : undefined;
			for (const entry of entries) {
				const expr = typeof entry === "string" ? entry : entry?.animation;
				if (typeof expr !== "string") continue;
				const cond = typeof entry === "object" && typeof entry.condition === "string" ? translateCondition(entry.condition, `${name}/${poseName}`) : undefined;
				const ref = ctx.idleAnimation(expr, bones);
				if (ref) def.anims.push(cond && cond !== "1.0" ? { ...ref, condition: cond } : ref);
			}
			ctx.poseTilt = undefined;
			const transforms = [...topTransforms, ...(pose.transformedParts ?? [])];
			if (transforms.length) {
				const ref = ctx.transformAnimation(poseName, transforms);
				if (ref) def.anims.push(ref);
			}
			for (const q of pose.quirks ?? []) {
				const quirk = ctx.quirk(q);
				if (quirk) def.quirks.push(quirk);
			}
			for (const [key, expr] of Object.entries<any>(pose.namedAnimations ?? {})) {
				const info = typeof expr === "string" ? ctx.namedAnimation(expr) : undefined;
				if (info) def.named[key] = info;
			}
			poses.push(def);
		}
		if (!poses.length) {
			warn("poser sem poses de mundo", name);
			return null;
		}
		const named: Record<string, AnimInfo> = {};
		for (const [key, expr] of Object.entries<any>(json.animations ?? {})) {
			const info = typeof expr === "string" ? ctx.namedAnimation(expr) : undefined;
			if (info) named[key] = info;
		}
		// Animações nomeadas específicas de batalha ficam como battle_<nome>; as de outras poses (ex.: faint
		// por pose nos posers Kotlin) valem como padrão quando o poser não define uma geral.
		for (const p of poses) {
			for (const [key, info] of Object.entries(p.named)) {
				if (p.isBattle) {
					const k = key.startsWith("battle_") ? key : `battle_${key}`;
					named[k] ??= info;
				}
			}
		}
		for (const p of poses) {
			if (p.isBattle) continue;
			for (const [key, info] of Object.entries(p.named)) named[key] ??= info;
		}
		// Convenções extras (faint, battle_cry...) se o grupo tiver.
		ctx.addConventionalNamed(name, named);
		return ctx.finish(poses, named, source);
	}

	// -----------------------------------------------------------------------------------------
	// Reserva por convenção (poser em Kotlin no Cobblemon)

	private fallback(name: string, bones: Set<string>, speciesId: string): PoserOutput | null {
		// Grupo com o nome do poser, da espécie ou que comece por eles (ex.: eiscue → eiscue_ice).
		const hasIdle = (g: string) => ["ground_idle", "idle", "battle_idle", "air_idle", "water_idle"].some((n) => this.anims.localNames(g).has(n));
		const group = [name, speciesId].find((g) => this.anims.groups.has(g) && hasIdle(g))
			?? [...this.anims.groups.keys()].sort().find((g) => (g.startsWith(`${name}_`) || g.startsWith(`${speciesId}_`)) && hasIdle(g))
			?? [name, speciesId].find((g) => this.anims.groups.has(g));
		const local = group ? this.anims.localNames(group) : new Map<string, AnimInfo>();
		const pick = (...names: string[]) => names.map((n) => local.get(n)).find(Boolean);
		const idle = pick("ground_idle", "idle", "battle_idle", "air_idle", "water_idle", "surfacewater_idle");
		const ctx = new GenContext(name, this.anims);
		aspectSink = ctx.aspects;
		const lookBone = ["head_ai", "head"].find((b) => bones.has(b));
		const look = lookBone ? ctx.lookAnimation([`'${lookBone}'`]) : undefined;
		if (!idle) {
			// Sem idle (como no Cobblemon para algumas espécies): pose de repouso do .geo + look. Sem "respiração"
			// artificial, que o Cobblemon também não tem.
			const refs: AnimRef[] = look ? [look] : [];
			const named: Record<string, AnimInfo> = {};
			if (group) ctx.addConventionalNamed(group, named);
			return ctx.finish([{ name: "standing", poseTypes: WORLD_POSE_TYPES, condition: "1.0", anims: refs, quirks: [], named: {} }], named, "fallback");
		}
		const blink = local.get("blink");
		const quirks: QuirkDef[] = blink ? [{ anims: [blink], min: 8, max: 30, loops: 1 }] : [];
		const mk = (poseName: string, types: string[], cond: string, anim: AnimInfo | undefined, withLook = true): PoseDef | undefined => {
			if (!anim) return undefined;
			const refs: AnimRef[] = [];
			if (withLook && look) refs.push(look);
			refs.push({ short: anim.short, id: anim.id });
			ctx.use(anim);
			return { name: poseName, poseTypes: types, condition: typeCondition(types) + (cond ? ` && ${cond}` : ""), anims: refs, quirks: withLook ? quirks : [], named: {} };
		};
		const walkAnim = pick("ground_walk", "walk", "ground_run");
		const poses = [
			mk("battle-standing", ["STAND"], "v.cobblemon_in_battle", pick("battle_idle")),
			mk("sleep", ["SLEEP"], "", pick("sleep", "ground_sleep"), false),
			mk("float", ["FLOAT"], "", pick("water_idle", "surfacewater_idle")),
			mk("swim", ["SWIM"], "", pick("water_swim", "surfacewater_swim", "water_idle")),
			mk("hover", ["HOVER"], "", pick("air_idle")),
			mk("fly", ["FLY"], "", pick("air_fly", "air_idle")),
			mk("walking", ["WALK"], "", walkAnim ?? idle),
			mk("standing", ["STAND", "FLOAT", "SWIM", "HOVER", "FLY", "SLEEP"], "", idle),
		].filter((p): p is PoseDef => !!p);
		for (const q of quirks) for (const a of q.anims) ctx.use(a);
		const named: Record<string, AnimInfo> = {};
		ctx.addConventionalNamed(group!, named);
		return ctx.finish(poses, named, "fallback");
	}
}

/** Nomes convencionais de animações "nomeadas" expostas aos scripts. */
const CONVENTIONAL_NAMED = ["cry", "battle_cry", "faint", "physical", "special", "status", "recoil", "battle_recoil", "sleep"];

function typeCondition(types: string[]): string {
	const codes = [...new Set(types.map((t) => POSE_TYPE_CODE[t]))].sort();
	if (codes.length === WORLD_POSE_TYPES.length) return "1.0";
	return `(${codes.map((c) => `v.cobblemon_pose_type == ${c}`).join(" || ")})`;
}

/** Condição Molang de uma pose do Cobblemon (PoseAdapter + JsonPose). */
function poseCondition(pose: any, types: string[], where: string): string {
	const parts = [typeCondition(types)];
	const bool = (key: string, expr: string) => {
		if (typeof pose[key] === "boolean") parts.push(pose[key] ? expr : `!${expr}`);
	};
	bool("isBattle", "v.cobblemon_in_battle");
	bool("isTouchingWater", "q.is_in_water");
	bool("isUnderWater", "v.cobblemon_submerged");
	bool("isInWaterOrRain", "q.is_in_water_or_rain");
	bool("isWild", "q.property('cobblemon:wild')");
	bool("isDusk", "(q.time_of_day > 0.7 && q.time_of_day < 0.8)");
	for (const k of ["isStandingOnRedSand", "isStandingOnSand", "isStandingOnSandOrRedSand"]) {
		if (pose[k] === true) parts.push("0.0");
	}
	if (pose.isRideStyle) parts.push("0.0");
	const conds = [pose.condition, ...(Array.isArray(pose.conditions) ? pose.conditions : [pose.conditions])]
		.flat()
		.filter((c) => typeof c === "string");
	if (conds.length) parts.push(`(${conds.map((c: string) => translateCondition(c, where)).join(" || ")})`);
	return parts.filter((p) => p !== "1.0").join(" && ") || "1.0";
}

/**
 * Frente dados-ia: variável do cliente com o aspect `aspect` (1/0). A client entity da espécie calcula a
 * variável a partir da propriedade sincronizada `cobblemon:aspects` (bitmask, ver entities.ts/aspectBitLines);
 * espécie sem o bit deixa a variável indefinida (0), como um aspect ausente.
 */
export function aspectVar(aspect: string): string {
	return `v.cobblemon_aspect_${safeName(aspect)}`;
}

/** Aspects citados por q.has_aspect no poser em geração (GenContext.aspects). */
let aspectSink: Set<string> | undefined;

/** q.has_aspect('x') / query.has_aspect("x") → aspectVar(x); o nome vai para aspectSink. */
export function rewriteHasAspect(expr: string, sink?: Set<string>): string {
	return expr.replace(/\b(?:q|query)\.has_aspect\s*\(\s*(['"])([^'"]*)\1\s*\)/gi, (_all, _q: string, aspect: string) => {
		sink?.add(aspect);
		return aspectVar(aspect);
	});
}

function translateCondition(expr: string, where: string): string {
	// Frente dados-ia: literais true/false soltos (ex.: "q.has_aspect('sheared') == false") viram 1.0/0.0.
	const literals = expr.trim().replace(/'[^']*'|\b(true|false)\b/gi, (m, lit?: string) => (lit ? (lit.toLowerCase() === "true" ? "1.0" : "0.0") : m));
	const out = rewriteMolang(rewriteHasAspect(literals, aspectSink), where, {
		is_flying: "v.cobblemon_flying",
		// Sem argumento de texto (não deveria acontecer): aspect ausente.
		has_aspect: "0.0",
	});
	// Frente cliente-modelos: condição malformada vale o que o parser do Java lê (ele para no primeiro token que não
	// continua a expressão: "a && b: 1.0 ? 0.0" = "a && b"), em sintaxe do Bedrock e com a precedência do Java.
	const fixed = javaMolangToBedrock(out, true, "0.0");
	if (fixed.reason) warn("condição Molang de pose corrigida (semântica do Java)", `${where}: ${expr} → ${fixed.expr} (${fixed.reason})`);
	return `(${fixed.expr})`;
}

/** Acumula o que um poser gera: animações usadas, animações sintéticas e controllers. */
class GenContext {
	animations = new Map<string, string>();
	groups = new Set<string>();
	generated: Record<string, any> = {};
	/** Linhas do pre_animation (estado de pitch_tilt), sem repetição. */
	preAnimation: string[] = [];
	/** Frente dados-ia: aspects de q.has_aspect usados pelo poser. */
	aspects = new Set<string>();
	/** Variável de inclinação da pose atual (o look desconta). */
	poseTilt: string | undefined;
	private genCount = 0;
	readonly safe: string;

	readonly poser: string;
	private anims: AnimationIndex;

	constructor(poser: string, anims: AnimationIndex) {
		this.poser = poser;
		this.anims = anims;
		this.safe = safeName(poser);
	}

	use(info: AnimInfo): AnimRef {
		this.animations.set(info.short, info.id);
		this.groups.add(info.id.split(".")[1]);
		return { short: info.short, id: info.id };
	}

	private resolveBedrock(args: string[] | null, where: string): AnimInfo | undefined {
		const group = unquote(args?.[0]);
		const anim = unquote(args?.[1]) ?? args?.[1];
		const prefix = unquote(args?.[2]);
		if (!group || !anim) return undefined;
		const info = this.anims.lookup(group, anim, prefix);
		if (!info) warn("animação referenciada pelo poser não existe", `${where}: ${group}.${anim}`);
		return info;
	}

	/** Primeira chamada de topo de uma expressão de animação do poser. */
	private topCall(expr: string): { name: string; args: string[] | null } | undefined {
		const trimmed = expr.trim();
		// Formato legado: "bedrock(pikachu, ground_idle)" ou "look".
		const legacy = /^([a-z_]+)\((.*)\)$/i.exec(trimmed);
		if (legacy && !trimmed.startsWith("q.")) return { name: legacy[1], args: splitArgs(legacy[2]).map((a) => (unquote(a) !== undefined ? a : `'${a}'`)) };
		if (/^[a-z_]+$/i.test(trimmed)) return { name: trimmed, args: [] };
		let found: { name: string; args: string[] | null } | undefined;
		scanMolang(trimmed, (call) => {
			if (!found && (call.prefix === "q" || call.prefix === "query")) found = { name: call.name.toLowerCase(), args: call.args };
			return undefined;
		});
		return found;
	}

	idleAnimation(expr: string, bones: Set<string>): AnimRef | undefined {
		const call = this.topCall(expr);
		if (!call) return undefined;
		const where = `${this.poser}: ${expr}`;
		switch (call.name) {
			case "bedrock":
			case "bedrock_stateful": {
				const info = this.resolveBedrock(call.args, where);
				return info ? this.use(info) : undefined;
			}
			case "look":
				return this.lookAnimation(call.args ?? [], bones);
			case "biped_walk":
				return this.bipedWalk(call.args ?? []);
			case "quadruped_walk":
				return this.quadrupedWalk(call.args ?? []);
			case "bimanual_swing":
				return this.bimanualSwing(call.args ?? []);
			case "sine_wing_flap":
				return this.wingFlap(call.args ?? []);
			case "pitch_tilt":
				return this.pitchTilt(call.args ?? []);
			case "cobblemon_fn":
				return this.functionAnimation(call.args ?? []);
			case "cobblemon_wing_flap":
				return this.functionWingFlap(call.args ?? []);
			case "cobblemon_wave_chain":
				return this.waveChain(call.args ?? []);
			default:
				warn("animação procedural do poser sem conversão (ignorada)", `${call.name} (${this.poser})`);
				return undefined;
		}
	}

	namedAnimation(expr: string): AnimInfo | undefined {
		const call = this.topCall(expr);
		if (!call || !["bedrock", "bedrock_stateful", "bedrock_primary"].includes(call.name)) return undefined;
		const group = unquote(call.args?.[0]);
		if (group === "dummy") return undefined;
		const info = this.resolveBedrock(call.args, `${this.poser}: ${expr}`);
		if (info) this.use(info);
		return info;
	}

	quirk(q: any): QuirkDef | undefined {
		if (typeof q === "string") {
			const call = this.topCall(q);
			if (!call || !["bedrock_quirk", "bedrock_primary_quirk"].includes(call.name) || !call.args) {
				if (call) warn("quirk sem conversão (ignorado)", `${call.name} (${this.poser})`);
				return undefined;
			}
			const group = unquote(call.args[0]);
			const namesArg = call.args[1] ?? "";
			let names: string[] = [];
			const arr = /^q(?:uery)?\.array\((.*)\)$/i.exec(namesArg.trim());
			names = arr ? splitArgs(arr[1]).map((a) => unquote(a) ?? a) : [unquote(namesArg) ?? namesArg];
			const anims = names.map((n) => (group ? this.anims.lookup(group, n) : undefined)).filter((a): a is AnimInfo => !!a);
			if (!anims.length) {
				warn("quirk sem animação existente", `${this.poser}: ${q}`);
				return undefined;
			}
			for (const a of anims) this.use(a);
			const num = (i: number, d: number) => (call.args![i] !== undefined && !Number.isNaN(Number(call.args![i])) ? Number(call.args![i]) : d);
			return { anims, min: num(2, 8), max: num(3, 30), loops: Math.max(1, Math.round(num(4, 1))) };
		}
		if (q && typeof q === "object") {
			const list = [q.animation, ...(Array.isArray(q.animations) ? q.animations : [q.animations])].flat().filter((x) => typeof x === "string");
			const anims = list.map((s: string) => this.namedAnimation(s)).filter((a): a is AnimInfo => !!a);
			if (!anims.length) return undefined;
			return { anims: [anims[0]], min: q.minSecondsBetweenOccurrences ?? 8, max: q.maxSecondsBetweenOccurrences ?? 30, loops: q.loopTimes ?? 1 };
		}
		return undefined;
	}

	/** Grava uma animação sintética e devolve a referência. */
	private generatedByContent = new Map<string, AnimRef>();

	private addGenerated(kind: string, anim: any): AnimRef {
		// Animações sintéticas idênticas (ex.: o mesmo q.look em várias poses) são reaproveitadas.
		const content = JSON.stringify(anim);
		const existing = this.generatedByContent.get(content);
		if (existing) return existing;
		const id = `animation.cobblemon_gen.${this.safe}.${kind}_${this.genCount++}`;
		this.generated[id] = anim;
		const short = id.replace(/^animation\./, "");
		this.animations.set(short, id);
		const ref = { short, id };
		this.generatedByContent.set(content, ref);
		return ref;
	}

	/** q.look(bone, pitchMul, yawMul, maxPitch, minPitch, maxYaw, minYaw) → rotação da cabeça pelo alvo. */
	lookAnimation(args: string[], bones?: Set<string>): AnimRef | undefined {
		let bone = unquote(args[0]) ?? "head_ai";
		if (bones && bones.size && !bones.has(bone)) {
			const alt = ["head_ai", "head"].find((b) => bones.has(b));
			if (!alt) {
				warn("q.look em osso inexistente (ignorado)", `${this.poser}: ${bone}`);
				return undefined;
			}
			bone = alt;
		}
		const n = (i: number, d: number) => (args[i] !== undefined && !Number.isNaN(Number(args[i])) ? Number(args[i]) : d);
		const [pm, ym, maxPitch, minPitch, maxYaw, minYaw] = [n(1, 1), n(2, 1), n(3, 70), n(4, -45), n(5, 45), n(6, -45)];
		const tilt = this.poseTilt ? ` - ${this.poseTilt}` : "";
		return this.addGenerated("look", {
			loop: true,
			bones: {
				[bone]: {
					rotation: [
						`${pm} * math.clamp(q.target_x_rotation, ${minPitch}, ${maxPitch})${tilt}`,
						`${ym} * math.clamp(q.target_y_rotation, ${minYaw}, ${maxYaw})`,
						0,
					],
				},
			},
		});
	}

	private walkCycle(period: number, amplitude: number, phase: number): string {
		const deg = (r: number) => +(r * 57.29578).toFixed(3);
		return `math.cos(q.modified_distance_moved * ${deg(period)}${phase ? " + 180" : ""}) * ${deg(amplitude)} * q.modified_move_speed`;
	}

	private num(args: string[], i: number, d: number): number {
		return args[i] !== undefined && !Number.isNaN(Number(args[i])) ? Number(args[i]) : d;
	}

	private str(args: string[], i: number, d: string): string {
		return unquote(args[i]) ?? d;
	}

	bipedWalk(args: string[]): AnimRef {
		const p = this.num(args, 0, 0.6662);
		const a = this.num(args, 1, 1.4);
		return this.addGenerated("biped_walk", {
			loop: true,
			bones: {
				[this.str(args, 2, "leg_left")]: { rotation: [this.walkCycle(p, a, 0), 0, 0] },
				[this.str(args, 3, "leg_right")]: { rotation: [this.walkCycle(p, a, 1), 0, 0] },
			},
		});
	}

	quadrupedWalk(args: string[]): AnimRef {
		const p = this.num(args, 0, 0.6662);
		const a = this.num(args, 1, 1.4);
		return this.addGenerated("quadruped_walk", {
			loop: true,
			bones: {
				[this.str(args, 2, "leg_front_left")]: { rotation: [this.walkCycle(p, a, 0), 0, 0] },
				[this.str(args, 3, "leg_front_right")]: { rotation: [this.walkCycle(p, a, 1), 0, 0] },
				[this.str(args, 4, "leg_back_left")]: { rotation: [this.walkCycle(p, a, 1), 0, 0] },
				[this.str(args, 5, "leg_back_right")]: { rotation: [this.walkCycle(p, a, 0), 0, 0] },
			},
		});
	}

	bimanualSwing(args: string[]): AnimRef {
		const p = +(this.num(args, 0, 0.6662) * 57.29578).toFixed(3);
		const a = +(this.num(args, 1, 1) * 57.29578).toFixed(3);
		const swing = `math.cos(q.modified_distance_moved * ${p}) * ${a} * q.modified_move_speed`;
		const idleZ = "(math.cos(q.life_time * 20 * 5.157) * 2.865 + 2.865)";
		const idleY = "math.sin(q.life_time * 20 * 3.839) * 2.865";
		return this.addGenerated("bimanual_swing", {
			loop: true,
			bones: {
				[this.str(args, 2, "arm_left")]: { rotation: [0, `${swing} - ${idleY}`, `-${idleZ}`] },
				[this.str(args, 3, "arm_right")]: { rotation: [0, `${swing} + ${idleY}`, idleZ] },
			},
		});
	}

	wingFlap(args: string[]): AnimRef {
		const amp = +(this.num(args, 0, 0.9) * 57.29578).toFixed(3);
		const period = this.num(args, 1, 0.9) || 0.9;
		const shift = +(this.num(args, 2, 0) * 57.29578).toFixed(3);
		const axis = ["x", "y", "z"].indexOf(this.str(args, 3, "y"));
		const angle = `(math.sin(q.anim_time * ${+(360 / period).toFixed(3)}) * ${amp} + ${shift})`;
		const rot = (sign: string) => [0, 1, 2].map((i) => (i === (axis < 0 ? 1 : axis) ? `${sign}${angle}` : 0));
		return this.addGenerated("wing_flap", {
			loop: true,
			bones: {
				[this.str(args, 4, "wing_left")]: { rotation: rot("") },
				[this.str(args, 5, "wing_right")]: { rotation: rot("-") },
			},
		});
	}

	/**
	 * q.pitch_tilt(bone, maxChangePerTick=1.5, min=-45, max=45) (PitchTiltAnimation): inclina o osso pelo ângulo do
	 * movimento. O estado vive numa variável da entidade atualizada no pre_animation; o limite por quadro do Kotlin
	 * (60 quadros/s) vira limite por segundo × q.delta_time para não depender do FPS.
	 */
	pitchTiltVar(expr: string): string | undefined {
		const call = this.topCall(expr);
		if (!call || call.name !== "pitch_tilt") return undefined;
		const args = call.args ?? [];
		const bone = this.str(args, 0, "root");
		const maxChange = this.num(args, 1, 1.5);
		const min = this.num(args, 2, -45);
		const max = this.num(args, 3, 45);
		const v = `v.cobblemon_pt_${safeName(bone)}${maxChange === 1.5 && min === -45 && max === 45 ? "" : `_${safeName(`${maxChange}_${min}_${max}`)}`}`;
		const lines = [
			`${v}_t = q.has_rider ? 0 : -math.clamp(q.ground_speed < 0.01 ? (q.vertical_speed > 0.01 ? ${max} : (q.vertical_speed < -0.01 ? ${min} : 0)) : math.atan2(q.vertical_speed, q.ground_speed), ${min}, ${max});`,
			`${v} = (${v} ?? 0) + math.clamp(${v}_t - (${v} ?? 0), -${+(maxChange * 60).toFixed(3)} * q.delta_time, ${+(maxChange * 60).toFixed(3)} * q.delta_time);`,
		];
		for (const l of lines) if (!this.preAnimation.includes(l)) this.preAnimation.push(l);
		return v;
	}

	pitchTilt(args: string[]): AnimRef | undefined {
		const v = this.pitchTiltVar(`q.pitch_tilt(${args.join(", ")})`);
		if (!v) return undefined;
		return this.addGenerated("pitch_tilt", { loop: true, bones: { [this.str(args, 0, "root")]: { rotation: [v, 0, 0] } } });
	}

	private waveMolang(kind: string, a: number, b: number, c: number, d: number, t: string): string | undefined {
		return waveMolang(kind, a, b, c, d, t);
	}

	private waveArgs(args: string[], at: number): { kind: string; a: number; b: number; c: number; d: number } {
		return { kind: this.str(args, at, "sine"), a: this.num(args, at + 1, 1), b: this.num(args, at + 2, 1) || 1, c: this.num(args, at + 3, 0), d: this.num(args, at + 4, 0) };
	}

	/** q.cobblemon_fn('rotation'|'translation', osso, eixo, tipo, a, b, c, d, 'tempo'): part.rotation/translation(fn). */
	functionAnimation(args: string[]): AnimRef | undefined {
		const kind = this.str(args, 0, "rotation");
		const bone = this.str(args, 1, "");
		const axis = ["x", "y", "z"].indexOf(this.str(args, 2, "y"));
		const w = this.waveArgs(args, 3);
		const t = this.str(args, 8, "q.anim_time");
		const fn = this.waveMolang(w.kind, w.a, w.b, w.c, w.d, t);
		if (!bone || axis < 0 || !fn) {
			warn("animação procedural do poser sem conversão (ignorada)", `cobblemon_fn ${w.kind} (${this.poser})`);
			return undefined;
		}
		// Rotação: radianos → graus (mesmo sinal). Translação: pixels, Y negado (espaço do Java → animação Bedrock).
		const value = kind === "rotation" ? `${fn} * 57.29578` : axis === 1 ? `-${fn}` : fn;
		const vec = [0, 1, 2].map((i) => (i === axis ? value : 0));
		return this.addGenerated(`fn_${kind}`, { loop: true, bones: { [bone]: kind === "rotation" ? { rotation: vec } : { position: vec } } });
	}

	/** q.cobblemon_wing_flap(tipo, a, b, c, d, eixo, esq, dir, 'tempo'): WingFlapIdleAnimation com qualquer função. */
	functionWingFlap(args: string[]): AnimRef | undefined {
		const w = this.waveArgs(args, 0);
		const axis = ["x", "y", "z"].indexOf(this.str(args, 5, "y"));
		const fn = this.waveMolang(w.kind, w.a, w.b, w.c, w.d, this.str(args, 8, "q.anim_time"));
		if (!fn || axis < 0) {
			warn("animação procedural do poser sem conversão (ignorada)", `cobblemon_wing_flap ${w.kind} (${this.poser})`);
			return undefined;
		}
		const rot = (sign: string) => [0, 1, 2].map((i) => (i === axis ? `${sign}${fn} * 57.29578` : 0));
		return this.addGenerated("wing_flap", { loop: true, bones: { [this.str(args, 6, "wing_left")]: { rotation: rot("") }, [this.str(args, 7, "wing_right")]: { rotation: rot("-") } } });
	}

	/**
	 * q.cobblemon_wave_chain(tipo, a, b, c, d, oscilações, compCabeça, eixo, 'tempo', 'osso:comp'...): WaveAnimation.
	 * Por segmento: θ = atan((f(t+t1) − f(t+t2)) / (t2 − t1)), rotação θ − θ_anterior; t1/t2 só dependem dos
	 * comprimentos, então viram constantes aqui. math.atan do Molang já devolve graus.
	 */
	waveChain(args: string[]): AnimRef | undefined {
		const w = this.waveArgs(args, 0);
		const osc = this.num(args, 5, 1) || 1;
		const headLength = this.num(args, 6, 0);
		const axis = ["x", "y", "z"].indexOf(this.str(args, 7, "y"));
		const t = this.str(args, 8, "q.anim_time");
		const segs = args.slice(9).map((a) => unquote(a) ?? "").map((x) => ({ bone: x.split(":")[0], length: Number(x.split(":")[1] ?? 0) }));
		if (!segs.length || axis < 0 || !this.waveMolang(w.kind, w.a, w.b, w.c, w.d, "0")) {
			warn("animação procedural do poser sem conversão (ignorada)", `cobblemon_wave_chain (${this.poser})`);
			return undefined;
		}
		let total = (headLength + segs.reduce((acc, x) => acc + x.length, 0)) / osc - headLength / osc;
		let prevLen = headLength;
		let prevTheta = "0";
		const bones: Record<string, any> = {};
		for (const sgm of segs) {
			const t2 = total + prevLen / 2 / osc;
			const t1 = total - sgm.length / 2 / osc;
			const fa = this.waveMolang(w.kind, w.a, w.b, w.c, w.d, `(${t} + ${+t1.toFixed(5)})`)!;
			const fb = this.waveMolang(w.kind, w.a, w.b, w.c, w.d, `(${t} + ${+t2.toFixed(5)})`)!;
			const theta = `math.atan((${fa} - ${fb}) / ${+(t2 - t1).toFixed(5)})`;
			bones[sgm.bone] = { rotation: [0, 1, 2].map((i) => (i === axis ? `${theta} - ${prevTheta}` : 0)) };
			prevTheta = theta;
			prevLen = sgm.length;
			total = Math.max(0, total - sgm.length / osc);
		}
		return this.addGenerated("wave_chain", { loop: true, bones });
	}

	/** transformedParts da pose → animação estática (posição/rotação/escala; isVisible=false vira escala 0). */
	transformAnimation(poseName: string, parts: any[]): AnimRef | undefined {
		const bones: Record<string, any> = {};
		for (const t of parts) {
			if (!t?.part) continue;
			const b: any = (bones[t.part] ??= {});
			// ModelPartTransformation soma a posição direto em ModelPart (espaço do Java, Y para baixo); a animação
			// Bedrock do Cobblemon nega o Y (MolangBoneValue.yMul = -1). Por isso o Y troca de sinal aqui.
			if (Array.isArray(t.position)) b.position = t.position.map((v: any, i: number) => (i !== 1 ? v : typeof v === "number" ? -v : `-(${v})`));
			if (Array.isArray(t.rotation)) b.rotation = t.rotation;
			const scale = Array.isArray(t.scale) ? t.scale : undefined;
			const vis = t.isVisible ?? t.visible;
			if (vis === false || vis === "false" || vis === 0) b.scale = 0;
			else if (typeof vis === "string" && vis !== "true") {
				const cond = translateCondition(vis, `${this.poser}/${poseName}`);
				b.scale = `${cond} ? 1.0 : 0.0`;
			} else if (scale) b.scale = scale;
		}
		if (!Object.keys(bones).length) return undefined;
		return this.addGenerated(`pose_${safeName(poseName)}`, { loop: true, bones });
	}

	addConventionalNamed(group: string, named: Record<string, AnimInfo>): void {
		const local = this.anims.localNames(group);
		for (const n of CONVENTIONAL_NAMED) {
			if (named[n]) continue;
			const info = local.get(n);
			if (info) named[n] = info;
		}
		for (const info of Object.values(named)) this.use(info);
	}

	/** Monta controllers, grava as animações sintéticas e devolve o resultado do poser. */
	finish(poses: PoseDef[], named: Record<string, AnimInfo>, source: PoserOutput["source"]): PoserOutput {
		const poseVar = `v.cobblemon_pose_${this.safe}`;
		const stateNames = uniqueNames(poses.map((p) => safeName(p.name)));
		// Seleção: primeira pose adequada; se nenhuma, a primeira (como getFirstSuitablePose).
		let poseExpr = "0";
		for (let i = poses.length - 1; i >= 0; i--) {
			poseExpr = poses[i].condition === "1.0" ? `${i}` : `(${poses[i].condition}) ? ${i} : (${poseExpr})`;
		}
		const states: Record<string, any> = {};
		poses.forEach((p, i) => {
			states[stateNames[i]] = {
				// Frente cliente-modelos: "animations": [] é recusado pelo cliente ("Required child not found").
				...(p.anims.length ? { animations: p.anims.map((a) => (a.condition ? { [a.short]: a.condition } : a.short)) } : {}),
				transitions: poses.map((_, j) => j).filter((j) => j !== i).map((j) => ({ [stateNames[j]]: `${poseVar} == ${j}` })),
				blend_transition: 0.2,
			};
		});
		const mainId = `controller.animation.cobblemon.${this.safe}`;
		const controllers: Record<string, any> = { [mainId]: { initial_state: stateNames[0], states } };
		const controllerIds = [mainId];
		const initialize: string[] = [];
		// Quirks iguais em várias poses viram um controller só, ativo nessas poses.
		const quirkMap = new Map<string, { q: QuirkDef; poses: number[] }>();
		poses.forEach((p, i) => {
			for (const q of p.quirks) {
				const key = `${q.anims.map((a) => a.id).join(",")}|${q.min}|${q.max}|${q.loops}`;
				const e = quirkMap.get(key) ?? { q, poses: [] };
				if (!e.poses.includes(i)) e.poses.push(i);
				quirkMap.set(key, e);
			}
		});
		let qi = 0;
		for (const { q, poses: idx } of quirkMap.values()) {
			const timer = `v.cobblemon_quirk_${this.safe}_${qi}`;
			const pick = `v.cobblemon_quirk_pick_${this.safe}_${qi}`;
			const loops = `v.cobblemon_quirk_loops_${this.safe}_${qi}`;
			const inPose = idx.length === poses.length ? "1.0" : `(${idx.map((i) => `${poseVar} == ${i}`).join(" || ")})`;
			const len = Math.max(...q.anims.map((a) => a.length));
			const min = Math.min(q.min, q.max);
			const max = Math.max(q.min, q.max);
			const schedule = `${timer} = q.life_time + math.random(${min}, ${max});`;
			initialize.push(`${timer} = math.random(${min}, ${max});`);
			const id = `controller.animation.cobblemon.${this.safe}.quirk${qi}`;
			controllers[id] = {
				initial_state: "wait",
				states: {
					wait: {
						on_entry: [schedule],
						transitions: [{ play: `q.life_time >= ${timer} && ${inPose}` }],
					},
					play: {
						on_entry: [`${pick} = math.random_integer(0, ${q.anims.length - 1});`, `${loops} = math.random_integer(1, ${q.loops});`],
						animations: q.anims.map((a, k) => (q.anims.length === 1 ? a.short : { [a.short]: `${pick} == ${k}` })),
						transitions: [{ wait: `q.state_time >= ${+(len).toFixed(4)} * ${loops} || !${inPose}` }],
						blend_transition: 0.1,
					},
				},
			};
			controllerIds.push(id);
			qi++;
		}
		writeJson(`${OUT_RP}/animation_controllers/pokemon/${this.safe}.animation_controllers.json`, { format_version: "1.10.0", animation_controllers: controllers });
		if (Object.keys(this.generated).length) {
			writeJson(`${OUT_RP}/animations/pokemon/_generated/${this.safe}.animation.json`, { format_version: "1.8.0", animations: this.generated });
		}
		const effects = [...this.groups].filter((g) => this.anims.groups.has(g)).map((g) => this.anims.emit(g));
		const namedIds: Record<string, string> = {};
		for (const [k, info] of Object.entries(named)) namedIds[k] = info.id;
		return {
			name: this.poser,
			fromJson: source !== "fallback",
			source,
			preAnimation: this.preAnimation,
			controllers: controllerIds,
			animations: this.animations,
			named: namedIds,
			poseVar,
			poseExpr,
			initialize,
			effects,
			poseNames: poses.map((p) => p.name),
			aspects: [...this.aspects].sort(),
		};
	}
}

/** Função de onda do Kotlin (WaveFunctions.kt) em Molang, no tempo `t`. Unidade de saída = a da função. */
export function waveMolang(kind: string, a: number, b: number, c: number, d: number, t: string): string | undefined {
	const f = (n: number) => +n.toFixed(5);
	switch (kind) {
		case "sine":
		case "cosine":
			return `(math.${kind === "sine" ? "sin" : "cos"}(${f(360 / b)} * (${t} - ${f(c)})) * ${f(a)} + ${f(d)})`;
		case "triangle":
			return `(${f((4 * a) / b)} * math.abs(math.mod(${t} + ${f((3 * b) / 4 - c)}, ${f(b)}) - ${f(b / 2)}) - ${f(a)} + ${f(d)})`;
		case "parabola": {
			// a = tightness, b = fase, c = desloc. vertical: a·(t' − b)² + c, com t' dobrado para o intervalo
			// entre as raízes (a parábola se repete, como no WaveFunctions.kt).
			const r2 = -c / a;
			if (!(r2 > 0)) return undefined;
			const r = Math.sqrt(r2);
			const tMin = b - r;
			const period = 2 * r;
			return `(${f(a)} * math.pow(${f(tMin)} + math.mod(math.mod(${t} - ${f(tMin)}, ${f(period)}) + ${f(period)}, ${f(period)}) - ${f(b)}, 2) + ${f(c)})`;
		}
		default:
			return undefined;
	}
}

function uniqueNames(names: string[]): string[] {
	const seen = new Map<string, number>();
	return names.map((n) => {
		const c = seen.get(n) ?? 0;
		seen.set(n, c + 1);
		return c ? `${n}_${c + 1}` : n;
	});
}
