// data/cobblemon/action_effects (timelines de efeitos de batalha) → generated/scripts/actionEffects.ts, lido pelo
// intérprete scripts/battle/effects. O Molang das timelines usa um vocabulário pequeno (medido nas 154 timelines),
// então ele é traduzido AQUI para uma forma estruturada; o script só avalia condições simples.
//
// Também emite:
//  - as partículas citadas (particles.ts, com as dependências);
//  - as animações genéricas de golpe (bedrock/generic/animations/*) como animation.cobblemon_generic.<grupo>.<nome>
//    (mexem no osso root_part, que models.ts acrescenta em toda geometria de Pokémon);
//  - os locators de cada espécie (offset no espaço do modelo, pixels) usados pelas timelines.
import { basename } from "node:path";
import type { AnimationIndex } from "./animations.ts";
import { rewriteMolang, scanMolang, splitArgs, unquote } from "./molang.ts";
import { particleIndex } from "./particles.ts";
import { ASSETS, BEDROCK_POKEMON, DATA, OUT_RP, OUT_SCRIPTS, count, readJson, tryReadJson, walk, warn, writeJson, writeText } from "./util.ts";

/** Condição sobre a entidade (conjunção). Ausente = não testa. */
export interface EntityCond {
	user?: boolean;
	missed?: boolean;
	hurt?: boolean;
	failed?: boolean;
	onGround?: boolean;
}

/** Texto com partes vindas do golpe: ["cobblemon:impact_", "$move.type"]. */
export type StrExpr = string[];

export type ActionKeyframe =
	| { t: "pause"; s: number }
	| { t: "holds"; add?: string[]; remove?: string[] }
	| { t: "anim"; names: StrExpr[]; delay: number; who: EntityCond }
	| { t: "particles"; effect: StrExpr; loc: string[]; target?: string[]; delay: number; who: EntityCond }
	| { t: "sound"; sound: StrExpr; delay: number; who: EntityCond }
	| { t: "entity"; delay: number; who: EntityCond; sounds: StrExpr[]; play: string[]; particles: Array<{ effect: string; loc: string }> }
	| { t: "seq"; cond?: "not_status"; kfs: ActionKeyframe[] };

const MOVE_FIELDS: Record<string, string> = { "q.move.name": "$move.name", "q.move.type": "$move.type", "q.move.damage_category": "$move.category" };

/** Vanilla do Java → definição de som do Bedrock. */
const VANILLA_SOUNDS: Record<string, string> = {
	"minecraft:entity.generic.explode": "random.explode",
	"minecraft:entity.egg.throw": "random.bow",
};

interface Ctx {
	file: string;
	skipped: string[];
	particles: Set<string>;
	sounds: Set<string>;
	generic: Set<string>;
	locators: Set<string>;
}

/** "'cobblemon:impact_' + q.move.type" | "q.move.name" | "cobblemon:x" → partes. */
function strExpr(raw: unknown, ctx: Ctx): StrExpr | undefined {
	if (typeof raw !== "string") return undefined;
	const s = raw.trim();
	if (!/['+]|^q\./.test(s)) return [s];
	const parts: string[] = [];
	for (const p of s.split("+").map((x) => x.trim())) {
		const lit = unquote(p);
		if (lit !== undefined) parts.push(lit);
		else if (MOVE_FIELDS[p]) parts.push(MOVE_FIELDS[p]);
		else {
			ctx.skipped.push(`${ctx.file}: texto ${s}`);
			return undefined;
		}
	}
	return parts;
}

/** entityCondition → conjunção estruturada. Padrão do Cobblemon: q.entity.is_user. */
function entityCond(raw: unknown, ctx: Ctx): EntityCond | undefined {
	if (raw === undefined) return { user: true };
	const s = String(raw).replace(/\s+/g, " ").trim();
	if (s === "true") return {};
	const out: EntityCond = {};
	for (const atom of s.split("&&").map((a) => a.trim())) {
		const m = /^(q\.entity\.is_user|q\.missed(?:\(q\.entity\.uuid\))?|q\.hurt\(q\.entity\.uuid\)|q\.failed(?:\(q\.entity\.uuid\))?|q\.entity\.is_on_ground)(?: == (true|false))?$/.exec(atom);
		if (!m) {
			ctx.skipped.push(`${ctx.file}: condição ${atom}`);
			return undefined;
		}
		const v = m[2] !== "false";
		if (m[1] === "q.entity.is_user") out.user = v;
		else if (m[1].startsWith("q.missed")) out.missed = v;
		else if (m[1].startsWith("q.hurt")) out.hurt = v;
		else if (m[1].startsWith("q.failed")) out.failed = v;
		else out.onGround = v;
	}
	return out;
}

/** Atraso: número ou Molang simples (q.do_effect_walks é sempre falso aqui: não há caminhada até o alvo). */
function seconds(raw: unknown): number {
	if (typeof raw === "number") return raw;
	if (typeof raw !== "string") return 0;
	const s = raw.replace(/q\.do_effect_walks/g, "0").trim();
	if (/^[\d.\s?:()!=<>&|+\-*/]+$/.test(s)) {
		try {
			const v = Function(`return (${s})`)();
			if (typeof v === "number" && Number.isFinite(v)) return v;
		} catch {
			/* cai no 0 */
		}
	}
	return 0;
}

function soundId(raw: string, ctx: Ctx): string {
	if (VANILLA_SOUNDS[raw]) return VANILLA_SOUNDS[raw];
	const m = /^(?:cobblemon:)?([a-z0-9_.]+)$/.exec(raw);
	if (m && !raw.startsWith("minecraft:")) {
		ctx.sounds.add(m[1]);
		return `cobblemon.${m[1]}`;
	}
	return raw.replace(/^minecraft:/, "");
}

function convertKeyframes(list: unknown, ctx: Ctx): ActionKeyframe[] {
	const out: ActionKeyframe[] = [];
	for (const k of Array.isArray(list) ? list : [list]) {
		if (typeof k === "string") {
			// save_position / move_to_target / return_to_position / pause sem valor: caminhada até o alvo (não portada).
			if (k === "pause") out.push({ t: "pause", s: 0 });
			else ctx.skipped.push(`${ctx.file}: ${k}`);
			continue;
		}
		if (!k || typeof k !== "object") continue;
		const kf = k as any;
		switch (kf.type) {
			case "pause":
				out.push({ t: "pause", s: seconds(kf.pause) });
				break;
			case "add_holds":
			case "remove_holds":
				out.push({ t: "holds", [kf.type === "add_holds" ? "add" : "remove"]: (kf.holds ?? []).map(String) });
				break;
			case "animation": {
				const who = entityCond(kf.entityCondition, ctx);
				const names = (Array.isArray(kf.animation) ? kf.animation : [kf.animation ?? "physical"]).map((a: unknown) => strExpr(a, ctx)).filter(Boolean) as StrExpr[];
				if (who && names.length) out.push({ t: "anim", names, delay: seconds(kf.delay), who });
				break;
			}
			case "entity_particles": {
				const who = entityCond(kf.entityCondition, ctx);
				const effect = strExpr(kf.effect, ctx);
				if (!who || !effect) break;
				// Efeito fixo: pede a partícula já; efeito por tipo (impact_<tipo>): pede todos os tipos.
				if (effect.length === 1) ctx.particles.add(effect[0]);
				else if (effect.includes("$move.type")) for (const type of TYPES) ctx.particles.add(effect.map((p) => (p === "$move.type" ? type : p)).join(""));
				const loc = (Array.isArray(kf.locators) ? kf.locators : kf.locator ? [kf.locator] : ["target"]).map(String);
				const target = Array.isArray(kf.targetLocators) ? kf.targetLocators.map(String) : undefined;
				for (const l of [...loc, ...(target ?? [])]) ctx.locators.add(l);
				out.push({ t: "particles", effect, loc, ...(target ? { target } : {}), delay: seconds(kf.delay), who });
				break;
			}
			case "entity_sound": {
				const who = entityCond(kf.entityCondition, ctx);
				const sound = strExpr(kf.sound, ctx);
				if (!who || !sound) break;
				out.push({ t: "sound", sound: sound.map((p) => (p.startsWith("$") ? p : soundId(p, ctx))), delay: seconds(kf.delay), who });
				break;
			}
			case "entity_molang": {
				const who = entityCond(kf.entityCondition, ctx);
				if (!who) break;
				const exprs: string[] = (Array.isArray(kf.expressions) ? kf.expressions : [kf.expressions]).filter((e: unknown) => typeof e === "string");
				const kfOut = { t: "entity" as const, delay: seconds(kf.delay), who, sounds: [] as StrExpr[], play: [] as string[], particles: [] as Array<{ effect: string; loc: string }> };
				for (const e of exprs) {
					scanMolang(e, (call) => {
						if (call.prefix !== "q" && call.prefix !== "query") return undefined;
						const name = call.name.toLowerCase();
						const a = call.args ?? [];
						if (name === "sound") {
							const ev = unquote(a[0]);
							if (ev) kfOut.sounds.push([soundId(ev, ctx)]);
						} else if (name === "play_animation") {
							const inner = /^q\.bedrock(?:_stateful)?\((.*)\)$/.exec((a[0] ?? "").trim());
							const [g, n] = inner ? splitArgs(inner[1]).map((x) => unquote(x)) : [];
							if (g && n) {
								ctx.generic.add(`${g}.${n}`);
								kfOut.play.push(`${g}.${n}`);
							} else ctx.skipped.push(`${ctx.file}: play_animation ${a[0]}`);
						} else if (name === "particle") {
							const eff = unquote(a[0]);
							const loc = unquote(a[1]) ?? "target";
							if (eff) {
								ctx.particles.add(eff);
								ctx.locators.add(loc);
								kfOut.particles.push({ effect: eff, loc });
							}
						} else if (!["bedrock", "bedrock_stateful"].includes(name)) ctx.skipped.push(`${ctx.file}: q.${name}`);
						return undefined;
					});
				}
				if (kfOut.sounds.length || kfOut.play.length || kfOut.particles.length) out.push(kfOut);
				break;
			}
			case "sequence": {
				const cond = kf.condition === undefined ? undefined : String(kf.condition).replace(/\s+/g, " ").trim();
				if (cond === "q.do_effect_walks") break; // sempre falso aqui
				if (cond && cond !== "q.move.damage_category != 'status'") {
					ctx.skipped.push(`${ctx.file}: sequence ${cond}`);
					break;
				}
				out.push({ t: "seq", ...(cond ? { cond: "not_status" as const } : {}), kfs: convertKeyframes(kf.keyframes ?? [], ctx) });
				break;
			}
			case "entity_sound_with_timeline":
			default:
				ctx.skipped.push(`${ctx.file}: ${kf.type}`);
		}
	}
	return out;
}

const TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];

/** Locators (pixels, espaço do modelo) usados pelas timelines, por espécie (geometria da combinação 0). */
function speciesLocators(models: Map<string, string>, wanted: Set<string>): Record<string, Record<string, number[]>> {
	const out: Record<string, Record<string, number[]>> = {};
	for (const [species, file] of models) {
		const geo = tryReadJson(file)?.["minecraft:geometry"]?.[0];
		const locs: Record<string, number[]> = {};
		for (const bone of geo?.bones ?? []) {
			for (const [name, v] of Object.entries<any>(bone.locators ?? {})) {
				if (!wanted.has(name)) continue;
				const p = Array.isArray(v) ? v : Array.isArray(v?.offset) ? v.offset : undefined;
				if (p?.length === 3) locs[name] = p.map((n: number) => Math.round(Number(n) * 100) / 100);
			}
		}
		if (Object.keys(locs).length) out[species] = locs;
	}
	return out;
}

/** Animações genéricas (bedrock/generic/animations) com ids próprios; devolve "grupo.nome" → id. */
function emitGenericAnimations(): Map<string, string> {
	const ids = new Map<string, string>();
	const out: Record<string, any> = {};
	for (const file of walk(`${ASSETS}/bedrock/generic/animations`, (n) => n.endsWith(".animation.json"))) {
		const json = tryReadJson(file);
		for (const [orig, anim] of Object.entries<any>(json?.animations ?? {})) {
			const m = /^animation\.([a-z0-9_]+)\.([a-z0-9_]+)$/i.exec(orig);
			if (!m) continue;
			const id = `animation.cobblemon_generic.${m[1]}.${m[2]}`.toLowerCase();
			ids.set(`${m[1]}.${m[2]}`.toLowerCase(), id);
			out[id] = JSON.parse(JSON.stringify(anim), (k, v) => (typeof v === "string" && k !== "lerp_mode" && k !== "loop" ? rewriteMolang(v, `generic:${orig}`) : v));
		}
	}
	writeJson(`${OUT_RP}/animations/cobblemon_generic.animation.json`, { format_version: "1.8.0", animations: out });
	return ids;
}

/**
 * Gera generated/scripts/actionEffects.ts. `models` = espécie → arquivo .geo da combinação padrão (para os
 * locators); sem ele, usa o modelo de mesmo nome da espécie.
 */
export function emitActionEffects(_anims?: AnimationIndex, models?: Map<string, string>): void {
	const ctx: Ctx = { file: "", skipped: [], particles: new Set(["cobblemon:hit"]), sounds: new Set(), generic: new Set(), locators: new Set(["target", "middle", "root"]) };
	const timelines: Record<string, ActionKeyframe[]> = {};
	for (const file of walk(`${DATA}/cobblemon/action_effects`, (n) => n.endsWith(".json"))) {
		const json = readJson(file);
		ctx.file = basename(file, ".json");
		timelines[ctx.file] = convertKeyframes(json?.timeline ?? [], ctx);
	}
	const generic = emitGenericAnimations();
	const play: Record<string, string> = {};
	for (const g of ctx.generic) {
		const id = generic.get(g);
		if (id) play[g] = id;
		else warn("action_effect: animação genérica inexistente (ignorada)", g);
	}
	const particles = particleIndex();
	const known: string[] = [];
	for (const p of ctx.particles) {
		const id = particles.resolve(p);
		if (id && particles.request(id)) known.push(id);
		else warn("action_effect: partícula inexistente (ignorada)", p);
	}
	for (const s of ctx.skipped) warn("action_effect: trecho não portado (ignorado)", s);
	// Locators: geometria padrão de cada espécie (modelo de mesmo nome quando não vem do index).
	const geoFiles = models ?? new Map<string, string>();
	if (!models) {
		for (const f of walk(`${BEDROCK_POKEMON}/models`, (n) => n.endsWith(".geo.json"))) {
			const key = basename(f, ".geo.json");
			if (!key.includes("_") || !geoFiles.has(key.split("_")[0])) geoFiles.set(key, f);
		}
	}
	const locators = speciesLocators(geoFiles, ctx.locators);
	writeText(
		`${OUT_SCRIPTS}/actionEffects.ts`,
		`// Arquivo gerado por tools/importer/actionEffects.ts (npm run import). Não edite à mão.
/* eslint-disable */
export interface EntityCond { user?: boolean; missed?: boolean; hurt?: boolean; failed?: boolean; onGround?: boolean }
export type StrExpr = string[];
export type ActionKeyframe =
	| { t: "pause"; s: number }
	| { t: "holds"; add?: string[]; remove?: string[] }
	| { t: "anim"; names: StrExpr[]; delay: number; who: EntityCond }
	| { t: "particles"; effect: StrExpr; loc: string[]; target?: string[]; delay: number; who: EntityCond }
	| { t: "sound"; sound: StrExpr; delay: number; who: EntityCond }
	| { t: "entity"; delay: number; who: EntityCond; sounds: StrExpr[]; play: string[]; particles: Array<{ effect: string; loc: string }> }
	| { t: "seq"; cond?: "not_status"; kfs: ActionKeyframe[] };

/** Timelines de data/cobblemon/action_effects (id = nome do arquivo). */
export const ACTION_EFFECTS: Record<string, ActionKeyframe[]> = ${JSON.stringify(timelines)};

/** q.bedrock_stateful('grupo', 'nome') das timelines → animação genérica emitida no RP. */
export const GENERIC_ANIMATIONS: Record<string, string> = ${JSON.stringify(play)};

/** Partículas das timelines que existem no RP (as demais são ignoradas pelo intérprete). */
export const EFFECT_PARTICLES: string[] = ${JSON.stringify(known.sort())};

/** Locators (pixels, espaço do modelo Bedrock: frente = −z) por espécie. */
export const LOCATORS: Record<string, Record<string, number[]>> = ${JSON.stringify(locators)};
`,
	);
	count("action_effects (timelines)", Object.keys(timelines).length);
	count("action_effects: partículas", known.length);
	count("action_effects: animações genéricas", Object.keys(play).length);
	count("action_effects: trechos não portados", ctx.skipped.length);
}
