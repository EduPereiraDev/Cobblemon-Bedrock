// Partículas do Cobblemon (assets/cobblemon/bedrock/particles, formato Snowstorm = Bedrock) emitidas sob demanda:
// animações das espécies, action_effects de batalha e scripts (evolução, corte do Furfrou) pedem ids; o índice
// fecha as dependências (eventos particle_effect) e grava só o que foi pedido, com as adaptações abaixo.
//
// Adaptações para o Bedrock (medidas nas 1.104 partículas do 1.8.2):
//  - componente "cobblemon:emitter_space" (escala pelo tamanho da entidade, só do Cobblemon) é removido;
//  - q.entity_width/height/size/radius/scale (funções do ParticleStorm) viram as variáveis v.entity_*, que o
//    Cobblemon também define; quem dispara preenche (pre_effect_script da animação ou MolangVariableMap do script);
//  - eventos com expression "q.sound('x')" viram sound_effect nativo; sound_effect "cobblemon:x" → "cobblemon.x";
//  - textura citada como "textures/particles/..." está guardada em "textures/particle/..." (loader do Snowstorm);
//  - (frente visual-batalha) ids com "/" (partículas de bola: "cobblemon:pokeball/battle/sendflash") viram "_"
//    ("cobblemon:pokeball_battle_sendflash"), como `particleId()` exporta;
//  - (frente visual-batalha) "emitter_lifetime_looping" sem sleep_time (ou 0) vira "emitter_lifetime_once": no
//    ParticleStorm do Cobblemon esse emissor para depois de active_time (LoopingEmitterLifetime com sleepTime 0),
//    no Bedrock um emissor criado por spawnParticle repetiria para sempre.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { encodePng } from "./png.ts";
import { ASSETS, HAND_RP, OUT_RP, copyFile, count, readJson, walk, warn, writeJson } from "./util.ts";
import { rewriteMolang, scanMolang, unquote } from "./molang.ts";

const PARTICLES_DIR = `${ASSETS}/bedrock/particles`;

/** Id do Bedrock para um id do Cobblemon (frente visual-batalha: "/" não entra no identificador). */
export function particleId(id: string): string {
	return id.replace(/\//g, "_");
}

/** Sons do Java citados por partículas → definições do Bedrock. */
const VANILLA_SOUNDS: Record<string, string> = {
	"minecraft:entity.sheep.shear": "mob.sheep.shear",
};

const ENTITY_VARS = ["width", "height", "size", "radius", "scale"];
const WHITE_TEXTURE = "textures/particle/cobblemon_white";

export class ParticleIndex {
	/** id do Bedrock → arquivo do Cobblemon. */
	files = new Map<string, string>();
	/** ids que já existem no RP escrito à mão (não são sobrescritos). */
	handIds = new Set<string>();
	private requested = new Set<string>();
	/** Partículas gravadas sem os eventos de som (o script toca o som: pedido C da frente jogabilidade). */
	private silent = new Set<string>();
	private missing = new Set<string>();
	/** Eventos de som citados pelas partículas emitidas (sem o prefixo "cobblemon."). */
	soundEvents = new Set<string>();

	constructor() {
		for (const file of walk(PARTICLES_DIR, (n) => n.endsWith(".json"))) {
			const id = readJson(file)?.particle_effect?.description?.identifier;
			if (typeof id === "string" && !this.files.has(id)) this.files.set(id, file);
		}
		for (const file of walk(`${HAND_RP}/particles`, (n) => n.endsWith(".json"))) {
			const id = readJson(file)?.particle_effect?.description?.identifier;
			if (typeof id === "string") this.handIds.add(id);
		}
	}

	/** O id existe (no RP à mão ou no Cobblemon). */
	has(id: string): boolean {
		return this.handIds.has(id) || this.files.has(id);
	}

	/** Nome usado por animações/timelines ("impact_electric", "cobblemon:x") → id existente. */
	resolve(name: string): string | undefined {
		const n = name.trim();
		const candidates = n.includes(":") ? [n] : [`cobblemon:${n}`, `cobblemon:${n.replace(/_particle$/, "")}`, `minecraft:${n}`];
		return candidates.find((c) => this.has(c));
	}

	/** Pede a emissão de um id (e das partículas que ele dispara). Devolve false se não existir. */
	request(id: string, opts: { silent?: boolean } = {}): boolean {
		if (opts.silent) this.silent.add(id);
		if (this.handIds.has(id)) return true;
		const file = this.files.get(id);
		if (!file) {
			if (!this.missing.has(id)) warn("partícula inexistente no Cobblemon", id);
			this.missing.add(id);
			return false;
		}
		if (this.requested.has(id)) return true;
		this.requested.add(id);
		const json = readJson(file);
		for (const ev of Object.values<any>(json.particle_effect?.events ?? {})) {
			for (const e of [ev, ...(Array.isArray(ev?.sequence) ? ev.sequence : []), ...(Array.isArray(ev?.randomize) ? ev.randomize : [])]) {
				const dep = e?.particle_effect?.effect;
				if (typeof dep === "string") this.request(dep.includes(":") ? dep : `cobblemon:${dep}`, opts);
			}
		}
		return true;
	}

	get requestedIds(): string[] {
		return [...this.requested].sort();
	}

	/** Grava as partículas pedidas (com adaptações) e as texturas. Devolve quantas foram gravadas. */
	emit(): number {
		const copied = new Set<string>();
		// Arquivos numa pasta só (particles/cobblemon/<nome>); nomes repetidos em pastas diferentes ganham prefixo.
		const byName = new Map<string, number>();
		for (const id of this.requestedIds) byName.set(basename(this.files.get(id)!), (byName.get(basename(this.files.get(id)!)) ?? 0) + 1);
		for (const id of this.requestedIds) {
			const file = this.files.get(id)!;
			const json = adaptParticle(readJson(file), id, this.soundEvents, (dep) => this.requested.has(dep) || this.handIds.has(dep), this.silent.has(id));
			const brp = json.particle_effect?.description?.basic_render_parameters;
			// Textura de bloco do vanilla Java (lã branca) → branco liso gerado aqui (o tint da partícula dá a cor).
			if (typeof brp?.texture === "string" && brp.texture.startsWith("textures/blocks/")) {
				brp.texture = WHITE_TEXTURE;
				if (!copied.has(WHITE_TEXTURE)) {
					copied.add(WHITE_TEXTURE);
					const out = `${OUT_RP}/${WHITE_TEXTURE}.png`;
					mkdirSync(dirname(out), { recursive: true });
					writeFileSync(out, encodePng({ width: 16, height: 16, rgba: Buffer.alloc(16 * 16 * 4, 255) }));
				}
			}
			const texture = brp?.texture;
			if (typeof texture === "string" && texture.startsWith("textures/") && texture !== WHITE_TEXTURE && !existsSync(`${HAND_RP}/${texture}.png`)) {
				// Caminhos citados de três jeitos no Cobblemon: textures/particles/x, textures/particle/x e (erro de
				// digitação) textures/textures/x; o arquivo mora em textures/particle/.
				const rest = texture.replace(/^textures\/(?:textures|particles|particle)\//, "");
				const candidates = [texture, `textures/particle/${rest}`];
				const found = candidates.find((c) => existsSync(`${ASSETS}/${c}.png`));
				if (found) {
					brp.texture = found === texture ? texture : `textures/particle/${rest}`;
					if (!copied.has(found)) copyFile(`${ASSETS}/${found}.png`, `${OUT_RP}/${brp.texture}.png`);
					copied.add(found);
				} else warn("textura de partícula ausente", `${texture} (${id})`);
			}
			const name = basename(file);
			const flat = (byName.get(name) ?? 0) > 1 ? relative(PARTICLES_DIR, file).replace(/[\\/]/g, "_") : name;
			writeJson(`${OUT_RP}/particles/cobblemon/${flat}`, json);
		}
		return this.requested.size;
	}
}

/** Reescreve Molang de partícula (q.entity_* → v.entity_*, q.random → math.random) e valida o resto. */
function particleMolang(expr: string, where: string): string {
	const out = scanMolang(expr, (call) => {
		if (call.prefix !== "q" && call.prefix !== "query") return undefined;
		const name = call.name.toLowerCase();
		const ent = /^entity_(\w+)$/.exec(name);
		if (ent && ENTITY_VARS.includes(ent[1])) return `v.entity_${ent[1]}`;
		if (name === "random") return `math.random(${(call.args ?? ["0", "1"]).join(", ")})`;
		return undefined;
	});
	return rewriteMolang(out, where);
}

function deepMolang(value: any, where: string, key = ""): any {
	if (typeof value === "string") {
		// Nomes (texturas, ids, materiais, espaços) não são Molang.
		if (["texture", "material", "effect", "identifier", "type", "event_name", "event", "mode", "facing_camera_mode", "direction"].includes(key)) return value;
		if (/^[a-z_]+$/i.test(value)) return value;
		return particleMolang(value, where);
	}
	if (Array.isArray(value)) return value.map((v) => deepMolang(v, where, key));
	if (value && typeof value === "object") {
		const out: any = {};
		for (const [k, v] of Object.entries(value)) out[k] = deepMolang(v, where, k);
		return out;
	}
	return value;
}

function soundName(raw: string, sounds: Set<string>): string {
	const id = raw.trim();
	if (VANILLA_SOUNDS[id]) return VANILLA_SOUNDS[id];
	const m = /^cobblemon:(.+)$/.exec(id);
	if (m) {
		sounds.add(m[1]);
		return `cobblemon.${m[1]}`;
	}
	return id.replace(/^minecraft:/, "");
}

/** Aplica as adaptações descritas no topo do arquivo. */
export function adaptParticle(json: any, id: string, sounds = new Set<string>(), exists: (id: string) => boolean = () => true, silent = false): any {
	const pe = json.particle_effect ?? {};
	const components = { ...(pe.components ?? {}) };
	delete components["cobblemon:emitter_space"];
	const looping = components["minecraft:emitter_lifetime_looping"];
	if (looping && typeof looping === "object" && (looping.sleep_time === undefined || looping.sleep_time === 0 || looping.sleep_time === "0" || looping.sleep_time === "0.0")) {
		delete components["minecraft:emitter_lifetime_looping"];
		components["minecraft:emitter_lifetime_once"] = { active_time: looping.active_time ?? 1 };
	}
	for (const k of Object.keys(components)) if (!k.startsWith("minecraft:")) delete components[k];
	const events: Record<string, any> = {};
	for (const [name, evRaw] of Object.entries<any>(pe.events ?? {})) {
		const ev = { ...evRaw };
		if (typeof ev.expression === "string" && /\bq(?:uery)?\.sound\s*\(/i.test(ev.expression)) {
			let sound: string | undefined;
			const rest = scanMolang(ev.expression, (call) => {
				if ((call.prefix === "q" || call.prefix === "query") && call.name.toLowerCase() === "sound") {
					sound = unquote(call.args?.[0]);
					return "0";
				}
				return undefined;
			}).trim();
			if (sound) ev.sound_effect = { event_name: soundName(sound, sounds) };
			if (/^[\d\s;]*$/.test(rest)) delete ev.expression;
			else ev.expression = rest;
		}
		if (ev.sound_effect?.event_name) ev.sound_effect = { ...ev.sound_effect, event_name: soundName(ev.sound_effect.event_name, sounds) };
		if (silent) delete ev.sound_effect;
		if (ev.particle_effect?.effect && !String(ev.particle_effect.effect).includes(":")) ev.particle_effect = { ...ev.particle_effect, effect: `cobblemon:${ev.particle_effect.effect}` };
		// Evento que dispara partícula inexistente (erro do próprio Cobblemon): sai só o disparo.
		// (o evento continua existindo, vazio, porque as linhas do tempo o citam pelo nome).
		if (ev.particle_effect?.effect && !exists(ev.particle_effect.effect)) delete ev.particle_effect;
		if (ev.particle_effect?.effect) ev.particle_effect = { ...ev.particle_effect, effect: particleId(ev.particle_effect.effect) };
		events[name] = ev;
	}
	const desc = { ...(pe.description ?? {}) };
	if (typeof desc.identifier === "string") desc.identifier = particleId(desc.identifier);
	const brp = { ...(desc.basic_render_parameters ?? {}) };
	if (typeof brp.texture === "string") brp.texture = brp.texture.replace(/^cobblemon:/, "");
	desc.basic_render_parameters = brp;
	const out: any = { description: desc, components: deepMolang(components, `partícula ${id}`) };
	if (pe.curves) out.curves = deepMolang(pe.curves, `partícula ${id}`);
	if (Object.keys(events).length) out.events = deepMolang(events, `partícula ${id}`);
	return { format_version: json.format_version ?? "1.10.0", particle_effect: out };
}

let shared: ParticleIndex | undefined;
/** Índice único do import (animações, action_effects e scripts pedem no mesmo). */
export function particleIndex(): ParticleIndex {
	shared ??= new ParticleIndex();
	return shared;
}

/**
 * Partículas do Cobblemon usadas por scripts: evo_* e poodle_hair_* (frente jogabilidade-final) e o brilho de
 * shiny (pedido C da frente jogabilidade: pokemon/ProximityEffects.ts e Pokemon.playShinyRing tocam os sons,
 * então essas vão sem os eventos de som).
 */
export function emitScriptParticles(): string[] {
	const index = particleIndex();
	const ids = [...index.files].filter(([, f]) => /^(evo_|poodle_hair_|broth_)/.test(basename(f)) /* broth_: bolhas da panela (frente mundo-sons) */).map(([id]) => id);
	for (const id of ids) index.request(id);
	const shiny = [...index.files].filter(([, f]) => /^(wild_shiny_ring|shiny_sparkle_ambient_wild|ambient_shiny_sparkle|shiny_ring\d*|shiny_glimmer)\.particle\.json$/.test(basename(f))).map(([id]) => id);
	for (const id of shiny) index.request(id, { silent: true });
	// Frente visual-batalha: partículas de bola (envio/recolha por bola, casual/battle, captura), sem som (o
	// script toca poke_ball.*). Ids com "/" saem com "_" (particleId).
	const balls = [...index.files].filter(([, f]) => relative(PARTICLES_DIR, f).replace(/\\/g, "/").startsWith("balls/")).map(([id]) => id);
	for (const id of balls) index.request(id, { silent: true });
	count("partículas de script (bolas: envio, recolha, captura)", balls.length);
	count("partículas de script (evolução, Furfrou)", ids.length);
	count("partículas de script (brilho de shiny, sem som)", shiny.length);
	return [...ids, ...shiny, ...balls].sort();
}

/** Grava tudo o que foi pedido no import (chamar uma vez, no fim). */
export function emitRequestedParticles(): number {
	const n = particleIndex().emit();
	count("partículas do Cobblemon emitidas", n);
	return n;
}
