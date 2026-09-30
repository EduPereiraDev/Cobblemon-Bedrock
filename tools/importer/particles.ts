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
import { ASSETS, HAND_RP, OUT_RP, OUT_SCRIPTS, copyFile, count, readJson, walk, warn, writeJson, writeText } from "./util.ts";
import { LEVEL_SOUND_EVENTS, PARTICLE_MAX_COLLISION_RADIUS } from "./clientRules.ts";
import { rewriteMolang, scanMolang, unquote } from "./molang.ts";
import { guardParticleVariables, particlePreInitReads } from "./molangVars.ts"; // frentes cliente-teste3-log e cliente-teste4
import { fixBareMolangCalls, moveParticleScopeStatements } from "./molangVars.ts"; // frente msd-beta

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
		// Partículas disparadas por evento de outra (não herdam as variáveis do emissor pai).
		const childIds = new Set<string>();
		for (const id of this.requestedIds) {
			const text = JSON.stringify(readJson(this.files.get(id)!).particle_effect?.events ?? {});
			for (const m of text.matchAll(/"effect"\s*:\s*"([^"]+)"/g)) childIds.add(m[1].includes(":") ? m[1] : `cobblemon:${m[1]}`);
		}
		const cues = new Map<string, { sounds: SoundCue[]; children: ChildCue[] }>();
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
			// Frente msd-fase3: textura citada com a extensão ("…/glowingsparkle.png", partículas Tera do Mega Showdown):
			// no Bedrock o caminho vai sem ".png".
			if (typeof brp?.texture === "string" && brp.texture.endsWith(".png")) brp.texture = brp.texture.slice(0, -4);
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
			// Frente cliente-log: o que o cliente recusa (sons que não são LevelSoundEvent, colisão, flipbook, Molang).
			cues.set(particleId(id), clientSafeParticle(json, { child: childIds.has(id), soundEvents: this.soundEvents }));
			const name = basename(file);
			const flat = (byName.get(name) ?? 0) > 1 ? relative(PARTICLES_DIR, file).replace(/[\\/]/g, "_") : name;
			writeJson(`${OUT_RP}/particles/cobblemon/${flat}`, json);
		}
		const table = flattenParticleSounds(cues);
		writeText(`${OUT_SCRIPTS}/particleSounds.ts`, [
			"// Gerado por tools/importer/particles.ts (frente cliente-log). Não editar.",
			"// Sons dos eventos das partículas do Cobblemon: o sound_effect de partícula do Bedrock só aceita LevelSoundEvents,",
			"// então o script que dispara a partícula toca estes sons (scripts/visual/ParticleSounds.ts). [tempo em s, opções]",
			`export const PARTICLE_SOUNDS: Record<string, ReadonlyArray<readonly [number, readonly string[]]>> = ${JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.map((c) => [c.t, c.sounds])])))};`,
			"",
		].join("\n"));
		count("partículas: sons levados para o script (particleSounds.ts)", Object.keys(table).length);
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

// ---------------------------------------------------------------------------------------------------------------
// Frente cliente-log: o que o cliente Bedrock recusa numa partícula (o BDS não carrega o RP e não acusa nada).
// Passo aplicado em emit() depois de adaptParticle (que traduz o formato do Snowstorm):
//  - sound_effect com evento que não é LevelSoundEvent ("Event name 'x' is not a valid LevelSoundEvent"): sai do
//    JSON e vira um "cue" (tempo, som) em generated/scripts/particleSounds.ts; o script que dispara a partícula toca
//    o som no mesmo tempo (scripts/visual/ParticleSounds.ts);
//  - particle_motion_collision sem collision_radius ("required field does not exist"): no Cobblemon
//    (SnowstormParticleReader) a falta do raio DESLIGA a colisão (enabled 0, raio 0.1) → o componente sai; com
//    "enabled" explícito, raio 0.1. Raio acima de 0.5 bloco ("radius is too large") vira 0.5 (o que o cliente faz);
//  - flipbook: max_frame ausente (o Cobblemon usa 0, frame inválido) é contado pela textura; loop/stretch em texto
//    viram booleanos; step_UV com Molang ("Expected Number") vira UV por expressão com o mesmo quadro por idade;
//  - Molang que o parser do Snowstorm tolera e o do Bedrock não: ")" sobrando ou vírgula solta no nível de cima
//    (o resto é descartado, como o parser lento do Java) e math.max/min com mais de 2 argumentos (aninhados);
//  - (frente cliente-teste3-log) toda variável lida e não escrita pela partícula ganha valor padrão (v.x ?? padrão;
//    v.entity_* com os mesmos do script quando a espécie não tem tamanho, o resto 0 como o MoLangRuntime do Java)
//    na criação do emissor: filhas não herdam as variáveis do pai e a partícula pode nascer sem MolangVariableMap.
// ---------------------------------------------------------------------------------------------------------------

/** Sons do Java sem namespace do Cobblemon citados por partículas → evento do Bedrock. */
const CLIENT_VANILLA_SOUNDS: Record<string, string> = {
	"entity.generic.explode": "random.explode",
	"minecraft:entity.generic.explode": "random.explode",
};
/** Definições vanilla do Bedrock usadas como destino (os valores das tabelas acima). */
const BEDROCK_VANILLA_SOUND_DEFS = new Set([...Object.values(VANILLA_SOUNDS), ...Object.values(CLIENT_VANILLA_SOUNDS)]);
// Padrões das variáveis quando ninguém as preenche: PARTICLE_VAR_DEFAULTS em molangVars.ts (frente cliente-teste3-log).

export type SoundCue = { t: number; sounds: string[] };
export type ChildCue = { t: number; effect: string };

let cobblemonSoundNames: Set<string> | undefined;
function cobblemonSounds(): Set<string> {
	cobblemonSoundNames ??= new Set(existsSync(`${ASSETS}/sounds.json`) ? Object.keys(readJson(`${ASSETS}/sounds.json`)) : []);
	return cobblemonSoundNames;
}

/** Nome de som de um sound_effect → definição do Bedrock tocável por script (ou undefined: mudo, como no Java). */
export function particleSoundDefinition(name: string, soundEvents?: Set<string>, known: Set<string> = cobblemonSounds()): string | undefined {
	const n = name.trim();
	if (CLIENT_VANILLA_SOUNDS[n]) return CLIENT_VANILLA_SOUNDS[n];
	if (BEDROCK_VANILLA_SOUND_DEFS.has(n)) return n;
	const bare = n.replace(/^cobblemon[.:]/, "").replace(/^minecraft:/, "");
	// "move.absorb.actor" sem namespace: no Java seria minecraft:move.absorb.actor (mudo); o evento do Cobblemon
	// existe com esse nome, então vira alias (melhoria, como soundAlias das animações).
	if (known.has(bare)) {
		soundEvents?.add(bare);
		return `cobblemon.${bare}`;
	}
	return undefined;
}

/**
 * Conserta Molang que o Bedrock recusa: corta no primeiro ")" sem par ou vírgula no nível de cima (por comando
 * separado por ";") e aninha math.max/min com mais de 2 argumentos.
 */
export function repairParticleMolang(expr: string): string {
	// Frente msd-beta: `rand(a, b)` (Snowstorm/Java) não existe no Bedrock ("unknown token") → math.random(a, b).
	expr = fixBareMolangCalls(expr);
	const statements = expr.split(";");
	const fixed = statements.map((st) => {
		let depth = 0;
		let quote = false;
		for (let i = 0; i < st.length; i++) {
			const c = st[i];
			if (c === "'") quote = !quote;
			if (quote) continue;
			if (c === "(") depth++;
			else if (c === ")") {
				if (depth === 0) return st.slice(0, i);
				depth--;
			} else if (c === "," && depth === 0) return st.slice(0, i);
		}
		return st;
	});
	let out = fixed.join(";");
	out = scanMolang(out, (call) => {
		if (call.prefix !== "math" || !["max", "min"].includes(call.name.toLowerCase()) || !call.args || call.args.length <= 2) return undefined;
		const args = call.args.map((a) => repairParticleMolang(a.trim()));
		let acc = args[args.length - 1];
		for (let i = args.length - 2; i >= 0; i--) acc = `math.${call.name.toLowerCase()}(${args[i]}, ${acc})`;
		return acc;
	});
	return out;
}

function repairDeep(value: any, key = ""): any {
	if (typeof value === "string") {
		if (["texture", "material", "effect", "identifier", "type", "event_name", "event", "mode", "facing_camera_mode", "direction", "log"].includes(key)) return value;
		if (/^[a-z_]+$/i.test(value)) return value;
		return repairParticleMolang(value);
	}
	if (Array.isArray(value)) return value.map((v) => repairDeep(v, key));
	if (value && typeof value === "object") {
		const out: any = {};
		for (const [k, v] of Object.entries(value)) out[k] = repairDeep(v, k);
		return out;
	}
	return value;
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" || v === 1 || v === "1" ? true : v === "false" || v === 0 || v === "0" ? false : undefined);

/** Flipbook aceito pelo cliente (max_frame, booleanos, step_UV numérico; senão UV por expressão). */
function fixFlipbook(uv: any): void {
	const fb = uv?.flipbook;
	if (!fb || typeof fb !== "object") return;
	for (const k of ["loop", "stretch_to_lifetime"]) {
		if (fb[k] === undefined) continue;
		const b = bool(fb[k]);
		if (b === undefined) delete fb[k];
		else fb[k] = b;
	}
	const step = Array.isArray(fb.step_UV) ? fb.step_UV : [0, 0];
	const base = Array.isArray(fb.base_UV) ? fb.base_UV : [0, 0];
	if (fb.max_frame === undefined) {
		// Quadros que cabem na textura andando step_UV a partir de base_UV (o Cobblemon usa 0: quadro inválido).
		const [su, sv] = [num(step[0]) ?? 0, num(step[1]) ?? 0];
		const [bu, bv] = [num(base[0]) ?? 0, num(base[1]) ?? 0];
		const w = num(uv.texture_width) ?? 1, h = num(uv.texture_height) ?? 1;
		const size = Array.isArray(fb.size_UV) ? fb.size_UV.map((x: unknown) => num(x) ?? 0) : [0, 0];
		const frames = [su ? Math.floor((su > 0 ? w - bu - size[0] : bu) / Math.abs(su)) + 1 : Infinity, sv ? Math.floor((sv > 0 ? h - bv - size[1] : bv) / Math.abs(sv)) + 1 : Infinity];
		const n = Math.min(...frames);
		fb.max_frame = Number.isFinite(n) && n > 0 ? n : 1;
		count("partículas: flipbook sem max_frame (contado pela textura)");
	}
	const stepNumeric = step.every((x: unknown) => typeof x === "number" || num(x) !== undefined);
	if (stepNumeric) {
		fb.step_UV = step.map((x: unknown) => num(x) ?? 0);
		return;
	}
	// step_UV com Molang: o cliente só aceita número. Mesmo quadro por idade, com a UV calculada na expressão.
	const fps = num(fb.frames_per_second) ?? 0;
	const max = typeof fb.max_frame === "number" ? fb.max_frame : `(${fb.max_frame})`;
	const frame = fb.stretch_to_lifetime
		? `math.min(math.floor(v.particle_age / math.max(v.particle_lifetime, 0.0001) * ${max}), ${max} - 1)`
		: fb.loop
			? `math.mod(math.floor(v.particle_age * ${fps}), ${max})`
			: `math.min(math.floor(v.particle_age * ${fps}), ${max} - 1)`;
	const axis = (i: number) => `(${base[i] ?? 0}) + (${frame}) * (${step[i] ?? 0})`;
	delete uv.flipbook;
	uv.uv = [axis(0), axis(1)];
	uv.uv_size = Array.isArray(fb.size_UV) ? fb.size_UV : [1, 1];
	count("partículas: flipbook com step_UV em Molang convertido em UV por expressão");
}

/** Evento(s) citado(s) por um gatilho: string ou lista. */
const evList = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Deixa uma partícula (já adaptada) aceitável pelo cliente. Devolve os sons tirados do JSON e as partículas-filhas,
 * com o tempo (s) em que o emissor os dispara, para o script reproduzir.
 */
export function clientSafeParticle(json: any, opts: { child?: boolean; soundEvents?: Set<string>; knownSounds?: Set<string> } = {}): { sounds: SoundCue[]; children: ChildCue[] } {
	const pe = json?.particle_effect;
	const sounds: SoundCue[] = [];
	const children: ChildCue[] = [];
	if (!pe) return { sounds, children };
	const comps = (pe.components ??= {});
	for (const k of Object.keys(comps)) if (!k.startsWith("minecraft:")) delete comps[k];
	// Colisão.
	const col = comps["minecraft:particle_motion_collision"];
	if (col && typeof col === "object") {
		if (col.collision_radius === undefined) {
			if (col.enabled === undefined) delete comps["minecraft:particle_motion_collision"];
			else col.collision_radius = 0.1;
			count("partículas: colisão sem collision_radius (desligada, como no Cobblemon)");
		} else if (num(col.collision_radius) !== undefined && num(col.collision_radius)! > PARTICLE_MAX_COLLISION_RADIUS) {
			col.collision_radius = PARTICLE_MAX_COLLISION_RADIUS;
			count("partículas: collision_radius acima de 0.5 bloco");
		}
	}
	fixFlipbook(comps["minecraft:particle_appearance_billboard"]?.uv);
	pe.components = repairDeep(comps);
	if (pe.curves) pe.curves = repairDeep(pe.curves);
	if (pe.events) pe.events = repairDeep(pe.events);
	// Frente msd-beta: v.particle_* lido no creation_expression do emissor vai para a inicialização da partícula
	// (o cliente acusa "unknown variable 'variable.particle_age'"); antes do guarda de variáveis abaixo.
	if (moveParticleScopeStatements(json)) count("partículas: comandos com v.particle_* do emissor para a partícula (particle_initialization)", 1);
	// Frente cliente-teste3-log: TODA variável lida e não escrita pela partícula ganha padrão no creation_expression
	// (`v.x = v.x ?? padrão;`): filhas (o pai não passa as variáveis dele), as disparadas por animação/entidade/script
	// sem MolangVariableMap e as curvas lidas antes da 1ª avaliação. O `??` mantém o valor que o script passar.
	// Antes só as filhas e só v.entity_* (3º teste em cliente: 61 mil "unknown variable" em ~495 partículas).
	void opts.child;
	// Frente cliente-teste4: o tempo de vida do emissor é avaliado antes do creation_expression; o guarda vai na expressão.
	if (particlePreInitReads(pe).length) count("partículas: variáveis lidas no tempo de vida do emissor com (v.x ?? padrão) na expressão", 1);
	const guarded = guardParticleVariables(json);
	if (guarded.length) count("partículas: variáveis lidas sem definição com padrão no creation_expression", 1);
	// Sons e filhas por evento.
	const eventSounds = new Map<string, string[]>();
	const eventChildren = new Map<string, string[]>();
	for (const [name, ev] of Object.entries<any>(pe.events ?? {})) {
		const options: string[] = [];
		const kids: string[] = [];
		const walkNode = (node: any) => {
			if (!node || typeof node !== "object") return;
			const snd = node.sound_effect?.event_name;
			if (typeof snd === "string" && !LEVEL_SOUND_EVENTS.has(snd)) {
				const def = particleSoundDefinition(snd, opts.soundEvents, opts.knownSounds);
				if (def) options.push(def);
				else warn("partícula: som sem equivalente no Bedrock (mudo, como no Java)", snd);
				delete node.sound_effect;
			}
			if (typeof node.particle_effect?.effect === "string") kids.push(node.particle_effect.effect);
			for (const k of ["sequence", "randomize"]) for (const c of Array.isArray(node[k]) ? node[k] : []) walkNode(c);
		};
		walkNode(ev);
		if (options.length) eventSounds.set(name, options);
		if (kids.length) eventChildren.set(name, kids);
	}
	const fire = (events: string[], t: number | undefined) => {
		if (t === undefined || !Number.isFinite(t)) return;
		for (const e of events) {
			const s = eventSounds.get(e);
			if (s) sounds.push({ t, sounds: s });
			for (const k of eventChildren.get(e) ?? []) children.push({ t, effect: k });
		}
	};
	const once = comps["minecraft:emitter_lifetime_once"];
	const emitterEnd = num(once?.active_time);
	const particleLife = num(comps["minecraft:particle_lifetime_expression"]?.max_lifetime);
	const em = comps["minecraft:emitter_lifetime_events"] ?? {};
	fire(evList(em.creation_event), 0);
	for (const [t, e] of Object.entries<any>(em.timeline ?? {})) fire(evList(e), num(t));
	fire(evList(em.expiration_event), emitterEnd);
	const pl = comps["minecraft:particle_lifetime_events"] ?? {};
	fire(evList(pl.creation_event), 0);
	for (const [t, e] of Object.entries<any>(pl.timeline ?? {})) fire(evList(e), num(t));
	fire(evList(pl.expiration_event), particleLife);
	sounds.sort((a, b) => a.t - b.t);
	return { sounds, children };
}

/** Sons por partícula já com os das filhas (deslocados pelo tempo do disparo), para o script. */
export function flattenParticleSounds(own: Map<string, { sounds: SoundCue[]; children: ChildCue[] }>): Record<string, SoundCue[]> {
	const out: Record<string, SoundCue[]> = {};
	const collect = (id: string, offset: number, depth: number, acc: SoundCue[]) => {
		const e = own.get(id);
		if (!e || depth > 4) return;
		for (const s of e.sounds) acc.push({ t: Math.round((s.t + offset) * 1000) / 1000, sounds: s.sounds });
		for (const c of e.children) collect(particleId(c.effect), offset + c.t, depth + 1, acc);
	};
	for (const id of own.keys()) {
		const acc: SoundCue[] = [];
		collect(id, 0, 0, acc);
		if (acc.length) out[id] = acc.sort((a, b) => a.t - b.t);
	}
	return out;
}
