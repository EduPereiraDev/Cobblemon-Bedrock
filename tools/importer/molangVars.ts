// Frente cliente-teste3-log (docs/pendencias/cliente-teste3-log.md): variáveis Molang (v.*/variable.*) lidas sem
// terem sido definidas. No Java o MoLangRuntime do Cobblemon devolve 0 para variável desconhecida; o cliente Bedrock
// devolve 0 também, mas acusa "[Molang][error] unhandled request for unknown variable 'variable.x'" a cada avaliação
// (3º teste em cliente: 61 mil linhas em partículas, 31 mil em render controllers, 512 em animações).
//
// Regras (usadas pelo importador para corrigir e pelo validate para conferir):
//  - partícula: toda variável lida é do motor (v.emitter_*, v.particle_*) ou escrita no creation_expression do
//    emissor antes da leitura (o importador põe `v.x = v.x ?? padrão;` no começo). Curvas contam como leitura: o
//    cliente avalia a direção/velocidade da 1ª partícula antes da 1ª curva (fireblast: v.burstarc);
//  - client entity: toda variável lida nos render controllers, animações e animation controllers da entidade é escrita
//    no `initialize` ou no `pre_animation` (o on_entry de um controller pode não ter rodado ainda: gimmick_tint,
//    quirk_loops). O importador acrescenta `v.x = v.x ?? 0;` no fim do pre_animation para as que faltam.
// `v.x ?? y` não acusa nada no cliente (medido: partículas-filhas com o guarda não aparecem no log do 3º teste).
import { tokenizeMolang } from "./molangSyntax.ts";
import { tryReadJson, walk, writeJson } from "./util.ts";

export interface VarUse {
	/** Nome sem prefixo, em minúsculas (v.Foo → foo). */
	name: string;
	/** Membro de struct (variable.color.r → "r"). */
	member?: string;
	write: boolean;
	/** Leitura protegida por `??` (não acusa erro). */
	guarded: boolean;
}

const VAR = /^(?:v|variable)\.([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?$/i;

/** Usos de v.* numa expressão, na ordem. */
export function molangVarUses(expr: unknown): VarUse[] {
	if (typeof expr !== "string" || !/\b(?:v|variable)\./i.test(expr)) return [];
	const toks = tokenizeMolang(expr);
	const out: VarUse[] = [];
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i];
		if (t.type !== "name") continue;
		const m = VAR.exec(t.text);
		if (!m) continue;
		const next = toks[i + 1];
		// Chamada (v.x(...)) não existe no Bedrock; conta como leitura.
		const write = next?.type === "op" && next.text === "=";
		const guarded = next?.type === "op" && next.text === "??";
		out.push({ name: m[1].toLowerCase(), member: m[2]?.toLowerCase(), write, guarded });
	}
	return out;
}

/** Leituras sem `??` (as que o cliente acusa se a variável não existir). */
export function unguardedReads(expr: unknown): string[] {
	return molangVarUses(expr).filter((u) => !u.write && !u.guarded).map((u) => u.name);
}

/** Variáveis escritas (`v.x = ...`). */
export function writtenVars(expr: unknown): string[] {
	return molangVarUses(expr).filter((u) => u.write).map((u) => u.name);
}

/** Todas as strings (Molang) de um valor JSON, com a chave de cada uma; `skip` = chaves cujo valor é nome. */
export function molangStrings(value: unknown, skip: ReadonlySet<string> = new Set(), key = ""): Array<{ key: string; expr: string }> {
	const out: Array<{ key: string; expr: string }> = [];
	const visit = (v: unknown, k: string) => {
		if (typeof v === "string") {
			if (!skip.has(k)) out.push({ key: k, expr: v });
		} else if (Array.isArray(v)) v.forEach((x) => visit(x, k));
		else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) visit(x, kk);
	};
	visit(value, key);
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Partículas

/** Variáveis que o motor define em toda partícula (documentação do Bedrock: Molang em partículas). */
export const PARTICLE_ENGINE_VARS: ReadonlySet<string> = new Set([
	"emitter_age", "emitter_lifetime", "emitter_random_1", "emitter_random_2", "emitter_random_3", "emitter_random_4",
	"particle_age", "particle_lifetime", "particle_random_1", "particle_random_2", "particle_random_3", "particle_random_4",
]);

/**
 * Chaves de partícula cujo valor é nome (textura, id, material, evento), não Molang. "direction" fica de fora: além de
 * "outwards"/"inwards" ela aceita [x, y, z] em Molang (fireblast lê v.burstarc ali); palavras soltas não têm v.*.
 */
export const PARTICLE_NAME_KEYS: ReadonlySet<string> = new Set(["texture", "material", "effect", "identifier", "event_name", "event", "log"]);

/** Padrões das variáveis que o Cobblemon passa (ParticleStorm) quando ninguém as preenche. */
export const PARTICLE_VAR_DEFAULTS: Readonly<Record<string, number>> = {
	// Os mesmos do script sem tamanho (ActionEffects.particleVariables com a espécie sem hitbox).
	entity_width: 1, entity_height: 1, entity_size: 1, entity_radius: 0.5, entity_scale: 1,
};

const isMolangLike = (s: string) => !/^[a-z_]+$/i.test(s) && !/^#[0-9a-f]{6,8}$/i.test(s.trim());

/** Expressões Molang de uma partícula (componentes, curvas, eventos), sem os nomes. */
export function particleExpressions(pe: any): Array<{ key: string; expr: string }> {
	return [
		...molangStrings(pe?.components ?? {}, PARTICLE_NAME_KEYS),
		...molangStrings(pe?.curves ?? {}, PARTICLE_NAME_KEYS),
		...molangStrings(pe?.events ?? {}, PARTICLE_NAME_KEYS),
	].filter((e) => isMolangLike(e.expr));
}

/** Valor da curva no começo (input 0): nó 0 (linear/bezier) ou nó 1 (catmull_rom, o 0 é controle). */
function curveStart(curve: any): number {
	const nodes = Array.isArray(curve?.nodes) ? curve.nodes : undefined;
	if (!nodes) return 0;
	const v = curve.type === "catmull_rom" ? nodes[1] : nodes[0];
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Curvas da partícula por nome de variável (sem prefixo, minúsculas). */
function particleCurves(pe: any): Record<string, any> {
	const curves: Record<string, any> = {};
	for (const [k, c] of Object.entries<any>(pe?.curves ?? {})) {
		const m = VAR.exec(k);
		if (m) curves[m[1].toLowerCase()] = c;
	}
	return curves;
}

/** Padrão de uma variável lida sem definição: o do Cobblemon (entity_*), o começo da curva ou 0 (o do Java). */
function particleVarDefault(name: string, curves: Record<string, any>): number {
	return PARTICLE_VAR_DEFAULTS[name] ?? (curves[name] ? curveStart(curves[name]) : 0);
}

/**
 * Frente cliente-teste4 (docs/pendencias/cliente-teste4.md): componentes do emissor que o cliente avalia ANTES do
 * creation_expression. Medido no 4º teste em cliente: evo_sparkleburst tinha `v.entity_size = v.entity_size ?? 1;` no
 * creation_expression e mesmo assim o cliente acusou "unknown variable 'variable.entity_size'" na expressão
 * `0.5 * math.clamp(v.entity_size,1,2)` — a do `emitter_lifetime_once.active_time`, e só ela: a mesma variável no
 * `emitter_rate_instant.num_particles`, no `emitter_shape_sphere.radius` e na aparência não acusou, nem as ~494
 * partículas que leem v.* nos emitter_rate_*, emitter_shape_* e particle_* com o mesmo guarda. O tempo de vida do emissor
 * é calculado quando o emissor nasce, antes da inicialização (erro tanto na chamada direta do selftest quanto como
 * filha de evo_particles). Os três componentes de tempo de vida pela mesma razão (o looping recalcula a cada ciclo; o
 * expression, a cada quadro, a partir do 1º). Aqui o guarda vai na própria expressão: `(v.x ?? padrão)`.
 */
export const PARTICLE_PRE_INIT_COMPONENTS: ReadonlySet<string> = new Set([
	"minecraft:emitter_lifetime_once", "minecraft:emitter_lifetime_looping", "minecraft:emitter_lifetime_expression",
]);

/** Leitura sem `??` de uma variável que não é do motor (o que o cliente acusa antes do creation_expression). */
function preInitUnguarded(u: VarUse): boolean {
	return !u.write && !u.guarded && !u.member && !PARTICLE_ENGINE_VARS.has(u.name);
}

/** Variáveis lidas sem guarda na própria expressão nos componentes avaliados antes do creation_expression. */
export function particlePreInitReads(pe: any): string[] {
	const out = new Set<string>();
	for (const [component, value] of Object.entries<any>(pe?.components ?? {})) {
		if (!PARTICLE_PRE_INIT_COMPONENTS.has(component)) continue;
		for (const { expr } of molangStrings(value, PARTICLE_NAME_KEYS)) {
			if (!isMolangLike(expr)) continue;
			// Escrita antes na mesma expressão (`v.t = 1; return v.t;`) define.
			const written = new Set<string>();
			for (const u of molangVarUses(expr)) {
				if (u.write) written.add(u.name);
				else if (preInitUnguarded(u) && !written.has(u.name)) out.add(u.name);
			}
		}
	}
	return [...out];
}

/** Troca cada leitura sem guarda `v.x` de uma expressão por `(v.x ?? padrão)`. */
export function inlineGuardReads(expr: string, defaultOf: (name: string) => number): string {
	if (!/\b(?:v|variable)\./i.test(expr)) return expr;
	const toks = tokenizeMolang(expr);
	const reads: Array<{ pos: number; text: string; name: string }> = [];
	const written = new Set<string>();
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i];
		if (t.type !== "name") continue;
		const m = VAR.exec(t.text);
		if (!m) continue;
		const next = toks[i + 1];
		const use: VarUse = {
			name: m[1].toLowerCase(), member: m[2]?.toLowerCase(),
			write: next?.type === "op" && next.text === "=", guarded: next?.type === "op" && next.text === "??",
		};
		if (use.write) written.add(use.name);
		else if (preInitUnguarded(use) && !written.has(use.name)) reads.push({ pos: t.pos, text: t.text, name: use.name });
	}
	let out = expr;
	// De trás para frente: as posições dos tokens anteriores continuam valendo.
	for (const r of reads.reverse()) out = `${out.slice(0, r.pos)}(${r.text} ?? ${defaultOf(r.name)})${out.slice(r.pos + r.text.length)}`;
	return out;
}

/**
 * Guarda na própria expressão (`(v.x ?? padrão)`) as leituras dos componentes avaliados antes do creation_expression
 * (PARTICLE_PRE_INIT_COMPONENTS). Mesmo valor do guarda do creation_expression (o `??` mantém o que o script passar).
 * Devolve as variáveis protegidas.
 */
export function guardPreInitReads(json: any): string[] {
	const pe = json?.particle_effect;
	const names = particlePreInitReads(pe);
	if (!names.length) return [];
	const curves = particleCurves(pe);
	const rewrite = (v: unknown): unknown => {
		if (typeof v === "string") return isMolangLike(v) ? inlineGuardReads(v, (n) => particleVarDefault(n, curves)) : v;
		if (Array.isArray(v)) return v.map(rewrite);
		if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, PARTICLE_NAME_KEYS.has(k) ? x : rewrite(x)]));
		return v;
	};
	for (const component of Object.keys(pe.components)) {
		if (PARTICLE_PRE_INIT_COMPONENTS.has(component)) pe.components[component] = rewrite(pe.components[component]);
	}
	return names;
}

/**
 * Variáveis que a partícula lê e não define antes (nem são do motor), com o padrão de cada uma. As escritas no
 * creation_expression antes de qualquer leitura sem guarda contam como definidas.
 */
export function particleUndefinedVars(pe: any): Map<string, number> {
	const init = pe?.components?.["minecraft:emitter_initialization"]?.creation_expression;
	const defined = new Set<string>();
	const missing = new Map<string, number>();
	const curves = particleCurves(pe);
	const need = (name: string) => {
		if (PARTICLE_ENGINE_VARS.has(name) || defined.has(name) || missing.has(name)) return;
		missing.set(name, particleVarDefault(name, curves));
	};
	// creation_expression em ordem: escrita antes de leitura define; leitura antes, não.
	for (const u of molangVarUses(init)) {
		if (u.write) defined.add(u.name);
		else if (!u.guarded) need(u.name);
	}
	// Curva: o motor grava a variável a cada quadro, mas no 1º quadro o emissor nasce (forma, velocidade/giro inicial,
	// taxa, eventos de criação) ANTES da 1ª avaliação das curvas (fireblast_actor1: v.burstarc na direção do
	// emitter_shape_point, 3º teste). Lida só na aparência/movimento da partícula, ela já existe (sem erro no log).
	const early = (component: string) => component.startsWith("minecraft:emitter_") || component === "minecraft:particle_initial_speed" || component === "minecraft:particle_initial_spin";
	const readAll = (value: unknown, earlyContext: boolean) => {
		for (const { key, expr } of molangStrings(value, PARTICLE_NAME_KEYS)) {
			if (!isMolangLike(expr) || (key === "creation_expression" && expr === init)) continue;
			for (const name of unguardedReads(expr)) if (earlyContext || !curves[name]) need(name);
		}
	};
	for (const [component, value] of Object.entries<any>(pe?.components ?? {})) readAll(value, early(component));
	readAll(pe?.curves ?? {}, false);
	readAll(pe?.events ?? {}, true);
	return missing;
}

/** Struct (variable.x.y) não existe no Molang de partícula do Bedrock ("unable to find member variable"). */
export function particleStructReads(pe: any): string[] {
	const out = new Set<string>();
	for (const { expr } of particleExpressions(pe)) for (const u of molangVarUses(expr)) if (u.member) out.add(`v.${u.name}.${u.member}`);
	return [...out];
}

/**
 * Põe `v.x = v.x ?? padrão;` no começo do creation_expression para cada variável lida e não definida (não mexe no
 * que o script ou a animação passar: o `??` mantém o valor que já existe). Devolve as variáveis protegidas.
 */
export function guardParticleVariables(json: any): string[] {
	const pe = json?.particle_effect;
	if (!pe) return [];
	// Frente cliente-teste4: primeiro as leituras avaliadas antes do creation_expression (guarda na própria expressão).
	const early = guardPreInitReads(json);
	const missing = particleUndefinedVars(pe);
	if (!missing.size) return early;
	const comps = (pe.components ??= {});
	const init = (comps["minecraft:emitter_initialization"] ??= {});
	const guard = [...missing].map(([name, def]) => `v.${name} = v.${name} ?? ${def};`).join(" ");
	const prev = typeof init.creation_expression === "string" ? init.creation_expression.trim() : "";
	init.creation_expression = prev ? `${guard} ${prev}${prev.endsWith(";") ? "" : ";"}` : guard;
	return [...new Set([...early, ...missing.keys()])];
}

/** Problemas de variável numa partícula (validate). */
export function particleVariableProblems(json: any): string[] {
	const pe = json?.particle_effect;
	if (!pe) return [];
	const problems: string[] = [];
	const missing = particleUndefinedVars(pe);
	if (missing.size) problems.push(`lê variável sem definir (o cliente acusa "unknown variable"; ponha v.x = v.x ?? 0 no creation_expression): ${[...missing.keys()].map((n) => `v.${n}`).join(", ")}`);
	const early = particlePreInitReads(pe);
	if (early.length) problems.push(`lê variável sem guarda no tempo de vida do emissor (${[...PARTICLE_PRE_INIT_COMPONENTS].filter((c) => pe.components?.[c]).join(", ")}), avaliado antes do creation_expression: o cliente acusa "unknown variable" mesmo com o padrão lá; use (v.x ?? padrão) na própria expressão: ${early.map((n) => `v.${n}`).join(", ")}`);
	const structs = particleStructReads(pe);
	if (structs.length) problems.push(`struct em variável de partícula (o cliente acusa "unable to find member variable"; use variáveis escalares): ${structs.join(", ")}`);
	return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Client entities

/** Variáveis que o motor define para entidades (nenhuma: v.* é sempre do conteúdo). */
const ENTITY_ENGINE_VARS: ReadonlySet<string> = new Set([]);

export interface EntityVarDocs {
	/** id → JSON de cada animação (animations[id]). */
	animations: Map<string, any>;
	/** id → JSON de cada animation controller. */
	controllers: Map<string, any>;
	/** id → JSON de cada render controller. */
	renderControllers: Map<string, any>;
}

/** Índice de animações/controllers/render controllers de uma árvore de JSONs (arquivo → JSON). */
export function entityVarDocs(docs: Iterable<[string, any]>): EntityVarDocs {
	const out: EntityVarDocs = { animations: new Map(), controllers: new Map(), renderControllers: new Map() };
	for (const [, j] of docs) {
		for (const [id, a] of Object.entries<any>(j?.animations ?? {})) if (!out.animations.has(id)) out.animations.set(id, a);
		for (const [id, c] of Object.entries<any>(j?.animation_controllers ?? {})) if (!out.controllers.has(id)) out.controllers.set(id, c);
		for (const [id, r] of Object.entries<any>(j?.render_controllers ?? {})) if (!out.renderControllers.has(id)) out.renderControllers.set(id, r);
	}
	return out;
}

const RC_KEYS = ["geometry", "textures", "materials", "part_visibility", "color", "overlay_color", "on_fire_color", "is_hurt_color", "light_color_multiplier", "uv_anim", "arrays"];

/** Leituras (sem guarda) de uma client entity, por origem (render controller, animação, controller, scripts). */
export function entityVariableReads(desc: any, docs: EntityVarDocs): Map<string, string> {
	const reads = new Map<string, string>();
	const add = (expr: unknown, where: string) => { for (const n of unguardedReads(expr)) if (!reads.has(n)) reads.set(n, where); };
	const deep = (v: unknown, where: string, skip: ReadonlySet<string> = new Set()) => { for (const s of molangStrings(v, skip)) add(s.expr, where); };
	const sc = desc?.scripts ?? {};
	for (const k of ["scale", "scaleX", "scaleY", "scaleZ", "should_update_bones_and_effects_offscreen", "should_update_effects_offscreen"]) add(sc[k], `scripts.${k}`);
	for (const a of sc.animate ?? []) if (a && typeof a === "object") for (const cond of Object.values(a)) add(cond, "scripts.animate");
	for (const rc of desc?.render_controllers ?? []) {
		const id = typeof rc === "string" ? rc : Object.keys(rc ?? {})[0];
		if (rc && typeof rc === "object") for (const cond of Object.values(rc)) add(cond, `render_controllers.${id}`);
		const def = docs.renderControllers.get(id);
		if (!def) continue;
		for (const k of RC_KEYS) {
			if (k === "arrays") {
				// Arrays de nomes (Texture.x, Geometry.x): não são Molang.
				continue;
			}
			deep(def[k], id);
		}
	}
	for (const ref of Object.values<string>(desc?.animations ?? {})) {
		const anim = docs.animations.get(ref);
		if (anim) {
			for (const [bone, value] of Object.entries<any>(anim.bones ?? {})) deep(value, `${ref} | ${bone}`, new Set(["lerp_mode"]));
			for (const k of ["anim_time_update", "blend_weight", "start_delay", "loop_delay"]) add(anim[k], `${ref} | ${k}`);
			for (const list of Object.values<any>(anim.timeline ?? {})) deep(list, `${ref} | timeline`);
			continue;
		}
		const ctrl = docs.controllers.get(ref);
		if (!ctrl) continue;
		for (const [sn, s] of Object.entries<any>(ctrl.states ?? {})) {
			for (const a of s?.animations ?? []) if (a && typeof a === "object") for (const cond of Object.values(a)) add(cond, `${ref} | ${sn}`);
			for (const t of s?.transitions ?? []) for (const cond of Object.values(t ?? {})) add(cond, `${ref} | ${sn} | transição`);
			for (const k of ["on_entry", "on_exit"]) deep(s?.[k], `${ref} | ${sn} | ${k}`);
			if (typeof s?.blend_transition === "string") add(s.blend_transition, `${ref} | ${sn}`);
		}
	}
	return reads;
}

/** Variáveis escritas no initialize/pre_animation, e as lidas no pre_animation antes de serem escritas. */
export function entityScriptVars(desc: any): { written: Set<string>; readBeforeWrite: Map<string, string> } {
	const sc = desc?.scripts ?? {};
	const written = new Set<string>();
	const readBeforeWrite = new Map<string, string>();
	const list = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
	for (const phase of ["initialize", "pre_animation"]) {
		for (const expr of list(sc[phase])) {
			for (const u of molangVarUses(expr)) {
				if (u.write) written.add(u.name);
				else if (!u.guarded && !written.has(u.name) && !ENTITY_ENGINE_VARS.has(u.name) && !readBeforeWrite.has(u.name)) readBeforeWrite.set(u.name, phase);
			}
		}
	}
	return { written, readBeforeWrite };
}

/** Variáveis lidas pela entidade e não inicializadas nos scripts (nome → onde é lida). */
export function entityUndefinedVars(desc: any, docs: EntityVarDocs): Map<string, string> {
	const { written, readBeforeWrite } = entityScriptVars(desc);
	const missing = new Map<string, string>();
	for (const [name, where] of entityVariableReads(desc, docs)) if (!written.has(name) && !ENTITY_ENGINE_VARS.has(name)) missing.set(name, where);
	// Lida no initialize/pre_animation antes de alguma escrita (e nunca escrita antes): 1º quadro sem valor.
	for (const [name, phase] of readBeforeWrite) if (!missing.has(name) && !written.has(name)) missing.set(name, `scripts.${phase}`);
	return missing;
}

/**
 * Acrescenta no pre_animation `v.x = v.x ?? 0;` para cada variável lida pela entidade e não inicializada nos scripts.
 * Devolve as variáveis acrescentadas.
 */
export function guardEntityVariables(desc: any, docs: EntityVarDocs): string[] {
	const missing = entityUndefinedVars(desc, docs);
	if (!missing.size) return [];
	const sc = (desc.scripts ??= {});
	const pre: string[] = typeof sc.pre_animation === "string" ? [sc.pre_animation] : Array.isArray(sc.pre_animation) ? sc.pre_animation : [];
	// No começo: as linhas seguintes do pre_animation podem ler essas variáveis.
	sc.pre_animation = [[...missing.keys()].map((n) => `v.${n} = v.${n} ?? 0;`).join(" "), ...pre];
	return [...missing.keys()];
}

/**
 * Pós-passe do import: `guardEntityVariables` em toda client entity gerada, com as animações/controllers/render
 * controllers do RP gerado e do escrito à mão (como o build junta). Devolve entidades e variáveis protegidas.
 */
export function ensureEntityVariables(outRp: string, handRp: string): { entities: number; variables: number; names: Map<string, number> } {
	const docs: Array<[string, any]> = [];
	for (const root of [outRp, handRp]) {
		for (const dir of ["animations", "animation_controllers", "render_controllers"]) {
			for (const f of walk(`${root}/${dir}`, (n) => n.endsWith(".json"))) docs.push([f, tryReadJson(f)]);
		}
	}
	const index = entityVarDocs(docs);
	let entities = 0, variables = 0;
	const names = new Map<string, number>();
	for (const f of walk(`${outRp}/entity`, (n) => n.endsWith(".json"))) {
		const json = tryReadJson(f);
		const desc = json?.["minecraft:client_entity"]?.description;
		if (!desc) continue;
		const added = guardEntityVariables(desc, index);
		if (!added.length) continue;
		writeJson(f, json);
		entities++;
		variables += added.length;
		for (const n of added) names.set(n, (names.get(n) ?? 0) + 1);
	}
	return { entities, variables, names };
}
