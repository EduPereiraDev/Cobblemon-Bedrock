// Animações do Cobblemon (bedrock/pokemon/animations). No Cobblemon a animação é achada por (grupo = nome do
// arquivo, nome); no Bedrock o id é global. Por isso cada animação ganha o id `animation.<grupo>.<nome local>`,
// o Molang exclusivo do Cobblemon é reescrito e efeitos de som/partícula são ligados aos ids do Bedrock.
// Montaria: q.r.* vira v.cr_* (molas no pre_animation, ver molang.ts/RidingMolang). Partículas vêm do RP à mão
// ou do Cobblemon (particles.ts, emitidas sob demanda); sons inexistentes passam por soundAlias (sounds.ts).
import { basename } from "node:path";
import { RidingMolang, rewriteMolang, scanMolang, unquote } from "./molang.ts";
import { particleIndex } from "./particles.ts";
import type { ParticleIndex } from "./particles.ts";
import { soundAlias } from "./sounds.ts";
import { BEDROCK_POKEMON, OUT_RP, count, report, safeName, tryReadJson, walk, warn, writeJson } from "./util.ts";

export interface AnimInfo {
	/** Id final no Bedrock. */
	id: string;
	/** Chave curta usada no mapa `animations` da client entity e nos controllers. */
	short: string;
	length: number;
	loop: boolean;
}

interface Group {
	name: string;
	file: string;
	json: any;
	/** nome original → info */
	anims: Map<string, AnimInfo>;
}

export interface EmittedEffects {
	/** chave curta → evento de som do Bedrock */
	sounds: Map<string, string>;
	/** chave curta → id de partícula */
	particles: Map<string, string>;
	/** Usos de q.r.* ("nome|N") que o pre_animation da client entity precisa calcular. */
	riding: Set<string>;
}

/** Tamanho da entidade para as variáveis v.entity_* das partículas (ParticleStorm do Cobblemon). */
export interface EntitySize {
	width: number;
	height: number;
	scale: number;
}

export class AnimationIndex {
	groups = new Map<string, Group>();
	private usedIds = new Set<string>();
	private emitted = new Map<string, EmittedEffects>();
	private particles: ParticleIndex;
	/** Grupo de animação → tamanho da espécie (para o pre_effect_script das partículas). */
	sizeOf: (group: string) => EntitySize | undefined = () => undefined;

	private soundEvents: Set<string>;

	constructor(soundEvents: Set<string>, particles: ParticleIndex = particleIndex()) {
		this.soundEvents = soundEvents;
		this.particles = particles;
		for (const file of walk(`${BEDROCK_POKEMON}/animations`, (n) => n.endsWith(".animation.json"))) {
			const json = tryReadJson(file);
			const name = basename(file, ".animation.json");
			if (!json || typeof json.animations !== "object") {
				report.animationParseFailures.push({ file: basename(file), error: json ? "sem 'animations'" : "JSON inválido" });
				continue;
			}
			// Grupo repetido (ex.: latios.animation.json em duas pastas): o último carregado vence, como no Cobblemon.
			const previous = this.groups.get(name);
			if (previous) for (const a of previous.anims.values()) this.usedIds.delete(a.id);
			const group: Group = { name, file, json, anims: new Map() };
			for (const [orig, anim] of Object.entries<any>(json.animations)) {
				const local = orig.startsWith("animation.") ? orig.split(".").slice(2).join(".") || orig.split(".")[1] : orig;
				let id = `animation.${name}.${local.toLowerCase().replace(/[^a-z0-9_.]/g, "_")}`;
				let n = 2;
				while (this.usedIds.has(id)) id = `animation.${name}.${local}_${n++}`;
				this.usedIds.add(id);
				group.anims.set(orig, { id, short: id.replace(/^animation\./, ""), length: lengthOf(anim), loop: anim.loop === true || anim.loop === "true" });
			}
			this.groups.set(name, group);
		}
	}

	/** Procura como o Cobblemon: grupo + "animation.<grupo>.<nome>" (ou prefixo customizado). */
	lookup(group: string, name: string, prefix = `animation.${group}`): AnimInfo | undefined {
		return this.groups.get(group)?.anims.get(`${prefix}.${name}`);
	}

	/** Todas as animações de um grupo, por nome local (sem "animation.<grupo>."). */
	localNames(group: string): Map<string, AnimInfo> {
		const out = new Map<string, AnimInfo>();
		const g = this.groups.get(group);
		if (!g) return out;
		for (const [orig, info] of g.anims) {
			const local = orig.startsWith(`animation.${group}.`) ? orig.slice(`animation.${group}.`.length) : orig.split(".").slice(2).join(".") || orig;
			if (!out.has(local)) out.set(local, info);
		}
		return out;
	}

	/** Grava o arquivo do grupo (uma vez) e devolve os efeitos de som/partícula que a client entity precisa mapear. */
	emit(groupName: string): EmittedEffects {
		const cached = this.emitted.get(groupName);
		if (cached) return cached;
		const group = this.groups.get(groupName)!;
		const effects: EmittedEffects = { sounds: new Map(), particles: new Map(), riding: new Set() };
		const riding = new RidingMolang();
		const out: Record<string, any> = {};
		for (const [orig, anim] of Object.entries<any>(group.json.animations)) {
			const info = group.anims.get(orig)!;
			out[info.id] = this.convert(anim, `${groupName}:${orig}`, effects, riding, groupName);
		}
		for (const u of riding.used) effects.riding.add(u);
		writeJson(`${OUT_RP}/animations/pokemon/${groupName}.animation.json`, { format_version: "1.8.0", animations: out });
		this.emitted.set(groupName, effects);
		return effects;
	}

	get emittedCount(): number {
		return this.emitted.size;
	}

	private soundShort(raw: string, where: string, effects: EmittedEffects): string | undefined {
		const event = soundAlias(raw, this.soundEvents);
		if (!event) {
			warn("som referenciado por animação não existe no sounds.json", `${raw} (${where})`);
			return undefined;
		}
		if (event !== raw) count("sons de animação resolvidos por alias");
		const short = `snd_${safeName(event)}`;
		effects.sounds.set(short, `cobblemon.${event}`);
		return short;
	}

	/** v.entity_* que as partículas do Cobblemon leem (ParticleStorm), com o tamanho da espécie do grupo. */
	private entityVarsScript(group: string): string {
		const size = this.sizeOf(group) ?? { width: 1, height: 1, scale: 1 };
		const w = +(size.width * size.scale).toFixed(3);
		const h = +(size.height * size.scale).toFixed(3);
		const big = Math.max(w, h);
		return `v.entity_width = ${w}; v.entity_height = ${h}; v.entity_size = ${big}; v.entity_radius = ${+(big / 2).toFixed(3)}; v.entity_scale = ${size.scale};`;
	}

	private convert(anim: any, where: string, effects: EmittedEffects, riding: RidingMolang, group: string): any {
		const out: any = {};
		for (const [key, value] of Object.entries<any>(anim)) {
			if (key === "bones") out.bones = rewriteDeep(value, where, riding);
			else if (key === "sound_effects") {
				const se = convertTimed(value, (e: any) => {
					const short = typeof e?.effect === "string" ? this.soundShort(e.effect, where, effects) : undefined;
					return short ? { ...e, effect: short } : undefined;
				});
				if (se) out.sound_effects = se;
			} else if (key === "particle_effects") {
				const pe = convertTimed(value, (e: any) => {
					const name = String(e?.effect ?? "");
					const id = this.particles.resolve(name);
					if (!id || !this.particles.request(id)) {
						warn("partícula sem equivalente no RP (removida)", `${name} (${where})`);
						return undefined;
					}
					if (!this.particles.handIds.has(id)) count("partículas de animação do Cobblemon (referências)");
					const short = `ptc_${safeName(name)}`;
					effects.particles.set(short, id);
					const copy = { ...e, effect: short };
					const script = typeof copy.pre_effect_script === "string" ? rewriteMolang(copy.pre_effect_script, where, {}, riding) : "";
					copy.pre_effect_script = `${this.entityVarsScript(group)}${script ? ` ${script.trim().endsWith(";") ? script.trim() : `${script.trim()};`}` : ""}`;
					return copy;
				});
				if (pe) out.particle_effects = pe;
			} else if (key === "timeline") {
				const tl = this.convertTimeline(value, where, effects, out, riding);
				if (tl) out.timeline = tl;
			} else if (typeof value === "string" && key !== "loop") out[key] = rewriteMolang(value, where, {}, riding);
			else out[key] = value;
		}
		return out;
	}

	/** `q.sound('x')` vira sound_effect no mesmo tempo; o resto do Molang é reescrito. */
	private convertTimeline(timeline: any, where: string, effects: EmittedEffects, out: any, riding: RidingMolang): any {
		const result: Record<string, string[]> = {};
		for (const [time, entry] of Object.entries<any>(timeline ?? {})) {
			const list: string[] = (Array.isArray(entry) ? entry : [entry]).filter((x) => typeof x === "string");
			const kept: string[] = [];
			for (const expr of list) {
				const sounds: string[] = [];
				let rest = scanMolang(expr, (call) => {
					if ((call.prefix === "q" || call.prefix === "query") && call.name.toLowerCase() === "sound") {
						const ev = unquote(call.args?.[0]);
						if (ev) sounds.push(ev);
						return "0.0";
					}
					return undefined;
				});
				for (const ev of sounds) {
					const short = this.soundShort(ev, where, effects);
					if (!short) continue;
					out.sound_effects ??= {};
					const cur = out.sound_effects[time];
					const add = { effect: short };
					out.sound_effects[time] = cur === undefined ? add : Array.isArray(cur) ? [...cur, add] : [cur, add];
				}
				rest = rewriteMolang(rest, where, {}, riding).trim();
				// Sobrou só casca (ex.: "1.0 ? { 0.0; };")? Descarta.
				if (sounds.length && /^[\d.\s?:{};()!&|]*$/.test(rest.replace(/0\.0|1\.0/g, ""))) continue;
				if (rest) kept.push(rest.endsWith(";") ? rest : `${rest};`);
			}
			if (kept.length) result[time] = kept;
		}
		return Object.keys(result).length ? result : undefined;
	}
}

function convertTimed(value: any, fn: (e: any) => any): any {
	const result: Record<string, any> = {};
	for (const [time, entry] of Object.entries<any>(value ?? {})) {
		if (typeof entry !== "object" || entry === null) continue; // entradas inválidas (ex.: número solto)
		const list = (Array.isArray(entry) ? entry : [entry]).map(fn).filter(Boolean);
		if (list.length) result[time] = list.length === 1 ? list[0] : list;
	}
	return Object.keys(result).length ? result : undefined;
}

function rewriteDeep(value: any, where: string, riding?: RidingMolang): any {
	if (typeof value === "string") return rewriteMolang(value, where, {}, riding);
	if (Array.isArray(value)) return value.map((v) => rewriteDeep(v, where, riding));
	if (value && typeof value === "object") {
		const out: any = {};
		for (const [k, v] of Object.entries(value)) out[k] = k === "lerp_mode" ? v : rewriteDeep(v, where, riding);
		return out;
	}
	return value;
}

function lengthOf(anim: any): number {
	if (typeof anim.animation_length === "number" && anim.animation_length > 0) return anim.animation_length;
	let max = 0;
	const visit = (tl: any) => {
		if (tl && typeof tl === "object" && !Array.isArray(tl)) {
			for (const k of Object.keys(tl)) {
				const t = Number(k);
				if (!Number.isNaN(t)) max = Math.max(max, t);
			}
		}
	};
	for (const bone of Object.values<any>(anim.bones ?? {})) {
		visit(bone?.rotation);
		visit(bone?.position);
		visit(bone?.scale);
	}
	for (const k of ["sound_effects", "particle_effects", "timeline"]) visit(anim[k]);
	return max || 1;
}
