// Frente dados-ia: presets de IA de espécie (data/cobblemon/behaviours, 49 arquivos) → grupos de componentes do
// Bedrock, no lugar da IA fixa do importador.
//
// O Cobblemon 1.8.2 monta o cérebro de cada PokemonEntity a partir dos behaviours automáticos
// (behaviours/pokemon/auto/*.json: core, combat, non_party, owned, no_underwater, herdable) e da lista `ai` da
// espécie. Cada behaviour aplica outros (`apply_behaviours`, com condição MoLang sobre `q.entity.*`) e adiciona
// tarefas a atividades (`add_tasks_to_activity`). Aqui as condições são avaliadas por contexto de entidade
// (selvagem, selvagem Alfa, no time, no pasto com "ataca mobs hostis") e as TAREFAS resultantes viram
// componentes vanilla equivalentes:
//
//   wander / cobblemon:wander (hover) / water_wander → behavior.random_stroll / random_fly / random_swim
//   cobblemon:flee_attacker (panics)                  → behavior.panic
//   get_angry_at_attacker (retaliates)                → behavior.hurt_by_target
//   defend_owner                                      → behavior.owner_hurt_by_target
//   attack_hostile_mobs                               → behavior.nearest_attackable_target (monstros)
//   cobblemon:target_entity                           → behavior.nearest_attackable_target (condição traduzida)
//   melee_attack (fights_melee), se a atividade de luta é alcançável (switch_to_fight) → behavior.melee_box_attack
//   cobblemon:move_into_fluid                         → behavior.move_to_water / move_to_lava
//   find_air + go_to_land (avoids_water)              → behavior.move_to_land
//   cobblemon:find_herd_leader (pokemon_herds)        → behavior.follow_mob (líder com tag do script)
//   eat_grass (pokemon_eats_grass)                    → behavior.eat_block
//   move_to_owner (pokemon_follows_owner)             → behavior.follow_owner + teleport_to_owner
//   switch_to_sleep_on_trainer_bed                    → behavior.pet_sleep_with_owner
//   point_to_spawn                                    → script (scripts/visual/PointToSpawn.ts)
//
// Tarefas sem equivalente de componente continuam com os scripts já existentes (sono, abelha, raposa, itens).
import { basename } from "node:path";
import { DATA, tryReadJson, walk, warn } from "./util.ts";
import type { Movement } from "./species.ts";

type Json = Record<string, any>;

// ---------------------------------------------------------------------------------------------
// Avaliador MoLang mínimo (condições dos behaviours: !, &&, ||, comparações, ternário, chamadas q.*)

type Val = number | string;

interface Scope {
	/** Resolve um caminho (`q.entity.behaviour.combat.will_flee`) com os argumentos da chamada (se houver). */
	resolve(path: string, args: Val[]): Val | undefined;
}

/** Expressão já analisada: avaliada sob demanda (ternário, && e || não avaliam o lado não usado). */
type Thunk = () => Val;

class Parser {
	private i = 0;
	private readonly s: string;
	private readonly scope: Scope;
	constructor(src: string, scope: Scope) {
		this.s = src;
		this.scope = scope;
	}
	private ws() {
		while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
	}
	private peek(tok: string): boolean {
		this.ws();
		return this.s.startsWith(tok, this.i);
	}
	private eat(tok: string): boolean {
		if (!this.peek(tok)) return false;
		this.i += tok.length;
		return true;
	}
	parse(): Val {
		const v = this.ternary();
		this.ws();
		if (this.i < this.s.length) throw new Error(`sobra: ${this.s.slice(this.i)}`);
		return v();
	}
	private ternary(): Thunk {
		const c = this.or();
		if (this.eat("?")) {
			const a = this.ternary();
			if (!this.eat(":")) return () => (truthy(c()) ? a() : 0);
			const b = this.ternary();
			return () => (truthy(c()) ? a() : b());
		}
		return c;
	}
	private or(): Thunk {
		let l = this.and();
		while (this.eat("||")) {
			const left = l;
			const r = this.and();
			l = () => (truthy(left()) || truthy(r()) ? 1 : 0);
		}
		return l;
	}
	private and(): Thunk {
		let l = this.cmp();
		while (this.eat("&&")) {
			const left = l;
			const r = this.cmp();
			l = () => (truthy(left()) && truthy(r()) ? 1 : 0);
		}
		return l;
	}
	private cmp(): Thunk {
		let l = this.add();
		for (;;) {
			const op = ["==", "!=", "<=", ">=", "<", ">"].find((o) => this.peek(o));
			if (!op) return l;
			this.i += op.length;
			const left = l;
			const r = this.add();
			l = () => {
				const a = left();
				const b = r();
				if (op === "==") return a === b || (num(a) === num(b) && typeof a !== "string" && typeof b !== "string") ? 1 : 0;
				if (op === "!=") return a === b ? 0 : 1;
				if (op === "<") return num(a) < num(b) ? 1 : 0;
				if (op === ">") return num(a) > num(b) ? 1 : 0;
				if (op === "<=") return num(a) <= num(b) ? 1 : 0;
				return num(a) >= num(b) ? 1 : 0;
			};
		}
	}
	private add(): Thunk {
		let l = this.mul();
		for (;;) {
			const left = l;
			if (this.eat("+")) {
				const r = this.mul();
				l = () => num(left()) + num(r());
			} else if (this.peek("-") && !this.peek("->")) {
				this.i++;
				const r = this.mul();
				l = () => num(left()) - num(r());
			} else return l;
		}
	}
	private mul(): Thunk {
		let l = this.unary();
		for (;;) {
			const left = l;
			if (this.eat("*")) {
				const r = this.unary();
				l = () => num(left()) * num(r());
			} else if (this.eat("/")) {
				const r = this.unary();
				l = () => {
					const d = num(r());
					return d === 0 ? 0 : num(left()) / d;
				};
			} else return l;
		}
	}
	private unary(): Thunk {
		if (this.eat("!")) {
			const v = this.unary();
			return () => (truthy(v()) ? 0 : 1);
		}
		if (this.eat("-")) {
			const v = this.unary();
			return () => -num(v());
		}
		return this.atom();
	}
	private atom(): Thunk {
		this.ws();
		if (this.eat("(")) {
			const v = this.ternary();
			this.eat(")");
			return v;
		}
		const ch = this.s[this.i];
		if (ch === "'" || ch === "\"") {
			const end = this.s.indexOf(ch, this.i + 1);
			const v = this.s.slice(this.i + 1, end < 0 ? this.s.length : end);
			this.i = end < 0 ? this.s.length : end + 1;
			return () => v;
		}
		const n = /^\d+(\.\d+)?/.exec(this.s.slice(this.i));
		if (n) {
			this.i += n[0].length;
			const v = Number(n[0]);
			return () => v;
		}
		const id = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*/i.exec(this.s.slice(this.i));
		if (!id) throw new Error(`token inesperado: ${this.s.slice(this.i, this.i + 10)}`);
		this.i += id[0].length;
		const path = id[0].toLowerCase().replace(/^query\./, "q.");
		if (path === "true") return () => 1;
		if (path === "false") return () => 0;
		const args: Thunk[] = [];
		if (this.eat("(")) {
			if (!this.eat(")")) {
				do args.push(this.ternary());
				while (this.eat(","));
				this.eat(")");
			}
		}
		return () => {
			const v = this.scope.resolve(path, args.map((a) => a()));
			if (v === undefined) throw new Error(`desconhecido: ${path}`);
			return v;
		};
	}
}

function truthy(v: Val): boolean {
	return typeof v === "string" ? v.length > 0 && v !== "false" && v !== "0" : v !== 0;
}

function num(v: Val): number {
	return typeof v === "number" ? v : Number(v) || 0;
}

/** Avalia uma condição de behaviour; expressão desconhecida vale `fallback` (com aviso no relatório). */
export function evalCondition(expr: unknown, scope: Scope, where: string, fallback = false): boolean {
	if (expr === undefined || expr === null) return true;
	if (typeof expr === "boolean") return expr;
	if (typeof expr === "number") return expr !== 0;
	try {
		return truthy(new Parser(String(expr), scope).parse());
	} catch (e) {
		warn("condição de behaviour não avaliada no importador", `${where}: ${String(expr)} (${(e as Error).message})`);
		return fallback;
	}
}

// ---------------------------------------------------------------------------------------------
// Contexto da entidade (q.entity.*) a partir do JSON da espécie

export interface AiContext {
	wild: boolean;
	party: boolean;
	alpha: boolean;
	pastured: boolean;
	conflict: boolean;
}

export const CONTEXTS = {
	wild: { wild: true, party: false, alpha: false, pastured: false, conflict: false },
	wildAlpha: { wild: true, party: false, alpha: true, pastured: false, conflict: false },
	party: { wild: false, party: true, alpha: false, pastured: false, conflict: false },
	pastured: { wild: false, party: false, alpha: false, pastured: true, conflict: false },
	pasturedConflict: { wild: false, party: false, alpha: false, pastured: true, conflict: true },
} satisfies Record<string, AiContext>;

/** Campos de `behaviour` com os padrões das classes do Cobblemon (pokemon/ai/*.kt), em snake_case do MoLang. */
export function behaviourStruct(data: any): Record<string, Val> {
	const b = data?.behaviour ?? {};
	const m = b.moving ?? {};
	const walk = { ...(m.walking ?? {}), ...(m.walk ?? {}) };
	const swim = m.swim ?? {};
	const fly = m.fly ?? {};
	const rest = b.resting ?? m.resting ?? {};
	const combat = b.combat ?? {};
	const herd = b.herd ?? {};
	const block = b.blockInteract ?? {};
	const bool = (v: unknown, d: boolean) => ((v ?? d) ? 1 : 0);
	const canWalk = walk.canWalk ?? m.canWalk ?? true;
	const canSwimInWater = swim.canSwimInWater ?? swim.canSwim ?? true;
	const canSwimInLava = swim.canSwimInLava ?? false;
	const canFly = fly.canFly ?? false;
	return {
		"moving.can_look": bool(m.canLook, true),
		"moving.can_move": canWalk || canSwimInWater || canSwimInLava || canFly ? 1 : 0,
		"moving.wander_chance": Number(m.wanderChance ?? 120),
		"moving.wander_speed": Number(m.wanderSpeed ?? 1),
		"moving.walk.can_walk": bool(canWalk, true),
		"moving.walk.avoids_land": bool(walk.avoidsLand, false),
		"moving.swim.can_swim_in_water": bool(canSwimInWater, true),
		"moving.swim.avoids_water": bool(swim.avoidsWater, false),
		"moving.swim.can_breathe_underwater": bool(swim.canBreatheUnderwater, false),
		"moving.swim.can_walk_on_water": bool(swim.canWalkOnWater, false),
		"moving.swim.can_swim_in_lava": bool(canSwimInLava, false),
		"moving.swim.can_walk_on_lava": bool(swim.canWalkOnLava, false),
		"moving.swim.can_breathe_underlava": bool(swim.canBreatheUnderlava, false),
		"moving.fly.can_fly": bool(canFly, false),
		"resting.can_sleep": bool(rest.canSleep, false),
		"resting.will_sleep_on_bed": bool(rest.willSleepOnBed, false),
		"combat.will_defend_self": bool(combat.willDefendSelf, false),
		"combat.will_flee": bool(combat.willFlee, true),
		"combat.will_defend_owner": bool(combat.willDefendOwner, false),
		"combat.fights_melee": bool(combat.fightsMelee, true),
		"herd.has_tolerated_leaders": Array.isArray(herd.toleratedLeaders) && herd.toleratedLeaders.length ? 1 : 0,
		"herd.max_size": Number(herd.maxSize ?? 0),
		"block_interact.immune_to_sweet_berry_bush_block": bool(block.immuneToSweetBerryBushBlock, false),
		"block_interact.can_stand_on_powder_snow": bool(block.canStandOnPowderSnow, false),
		"block_interact.can_path_through_sacc_leaves": bool(block.canPathThroughSaccLeaves, false),
	};
}

function entityScope(data: any, ctx: AiContext, config: Record<string, Val>): Scope {
	const beh = behaviourStruct(data);
	return {
		resolve(path, args) {
			if (path.startsWith("q.entity.behaviour.")) return beh[path.slice("q.entity.behaviour.".length)];
			if (path.startsWith("q.entity.config.")) return config[path.slice("q.entity.config.".length)] ?? 0;
			switch (path) {
				case "q.entity.is_wild": return ctx.wild ? 1 : 0;
				case "q.entity.is_in_party": return ctx.party ? 1 : 0;
				case "q.entity.is_alpha": return ctx.alpha ? 1 : 0;
				case "q.entity.is_pastured": return ctx.pastured ? 1 : 0;
				case "q.entity.pasture_conflict_enabled": return ctx.conflict ? 1 : 0;
				case "q.entity.is_pokemon": return 1;
				case "q.entity.is_npc": return 0;
				case "q.entity.is_battling": return 0;
				// Struct do dono (só testado como argumento de can_see).
				case "q.entity.owner": return ctx.wild ? 0 : 1;
				// Chance por tick (pokemon_follows_owner fora do time): "pode acontecer".
				case "math.random": return num(args[0] ?? 0);
				case "q.length": return typeof args[0] === "string" ? args[0].length : num(args[0] ?? 0) ? 1 : 0;
				case "q.entity.can_see":
				case "q.entity.distance_to_owner":
					return 0;
			}
			return undefined;
		},
	};
}

// ---------------------------------------------------------------------------------------------
// Behaviours → tarefas

export interface TaskRef {
	activity: string;
	name: string;
	config: Json;
}

export interface ResolvedAi {
	behaviours: string[];
	tasks: TaskRef[];
	variables: Record<string, Val>;
}

let behaviourCache: Map<string, Json> | undefined;
/** data/cobblemon/behaviours/**.json por id ("cobblemon:panics", "cobblemon:pokemon/auto/pokemon_core"). */
export function loadBehaviours(): Map<string, Json> {
	if (behaviourCache) return behaviourCache;
	behaviourCache = new Map();
	const dir = `${DATA}/cobblemon/behaviours`;
	for (const file of walk(dir, (n) => n.endsWith(".json"))) {
		const rel = file.slice(dir.length + 1).replace(/\.json$/, "");
		const json = tryReadJson(file);
		if (!json) continue;
		behaviourCache.set(`cobblemon:${rel}`, json);
		// apply_behaviours cita só o nome ("cobblemon:pokemon_bee" para pokemon/pokemon_bee.json).
		if (!behaviourCache.has(`cobblemon:${basename(rel)}`)) behaviourCache.set(`cobblemon:${basename(rel)}`, json);
	}
	return behaviourCache;
}

const stripNs = (s: string) => String(s).replace(/^[a-z_]+:/, "");

/** Behaviours automáticos de Pokémon (CobblemonBehaviours: pastas pokemon/auto), em ordem de nome. */
function autoBehaviours(): string[] {
	return [...loadBehaviours().keys()].filter((k) => k.startsWith("cobblemon:pokemon/auto/")).sort();
}

/**
 * Resolve os behaviours e tarefas de um Pokémon da espécie `data` no contexto `ctx` (BehaviourConfigurationContext:
 * autos + `ai` da espécie, com apply_behaviours recursivo e condições avaliadas).
 */
export function resolvePokemonAi(data: any, ctx: AiContext, where = "espécie"): ResolvedAi {
	const all = loadBehaviours();
	const out: ResolvedAi = { behaviours: [], tasks: [], variables: {} };
	const config: Record<string, Val> = {};
	const scope = entityScope(data, ctx, config);
	const applied = new Set<string>();
	const runConfigs = (configs: unknown, from: string) => {
		for (const c of Array.isArray(configs) ? configs : []) {
			const type = stripNs(c?.type ?? "");
			if (c?.condition !== undefined && !evalCondition(c.condition, scope, `${where} ${from}`)) continue;
			if (type === "apply_behaviours") {
				for (const id of c.behaviours ?? c.behaviors ?? []) apply(String(id).includes(":") ? String(id) : `cobblemon:${id}`);
			} else if (type === "add_tasks_to_activity") {
				const activity = stripNs(c.activity ?? "idle");
				for (const list of Object.values<any>(c.tasksByPriority ?? {})) {
					for (const t of Array.isArray(list) ? list : [list]) {
						const cfg: Json = typeof t === "string" ? { type: t } : t ?? {};
						if (cfg.condition !== undefined && typeof cfg.condition === "boolean" && !cfg.condition) continue;
						out.tasks.push({ activity, name: stripNs(cfg.type ?? ""), config: cfg });
					}
				}
			} else if (type === "set_variables") {
				Object.assign(out.variables, c.variableValues ?? {});
			}
		}
	};
	const apply = (id: string) => {
		if (applied.has(id)) return;
		applied.add(id);
		const json = all.get(id);
		if (!json) {
			warn("behaviour inexistente citado por apply_behaviours", `${where}: ${id}`);
			return;
		}
		out.behaviours.push(id);
		// pickup_items (pokemon_non_party) lê a configuração da raposa/itens.
		if (id === "cobblemon:pokemon_fox" || id === "cobblemon:pokemon_picks_up_items") config.pickup_items = "items";
		runConfigs(json.configurations, id);
	};
	// A lista `ai` da espécie vem antes: ela liga configurações (pickup_items) lidas pelos autos.
	const speciesAi = Array.isArray(data?.ai) ? data.ai : [];
	for (const c of speciesAi) if (stripNs(c?.type ?? "") === "apply_behaviours") for (const id of c.behaviours ?? []) {
		if (id === "cobblemon:pokemon_fox" || id === "cobblemon:pokemon_picks_up_items") config.pickup_items = "items";
	}
	for (const id of autoBehaviours()) apply(id);
	runConfigs(speciesAi, "ai");
	return out;
}

// ---------------------------------------------------------------------------------------------
// Tarefas → componentes

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Valor de um parâmetro de tarefa: número, ou variável de behaviour ({variableName, defaultValue}). */
function param(v: unknown, vars: Record<string, Val>, d: number): number {
	if (typeof v === "number") return v;
	if (v && typeof v === "object" && "variableName" in (v as Json)) {
		const name = String((v as Json).variableName);
		return num(vars[name] ?? (v as Json).defaultValue ?? d);
	}
	return d;
}

/**
 * Condição de alvo do Cobblemon (`entityCondition` de target_entity) → filtro de entidade do Bedrock.
 * Átomos conhecidos: is_pokemon, species.identifier == 'ns:x', world.is_air(x, y + 1, z) (na superfície da água).
 */
export function entityConditionFilter(expr: string): Json | undefined {
	const all: Json[] = [];
	for (const atom of String(expr).split("&&").map((a) => a.trim())) {
		if (/^q\.entity\.is_pokemon$/.test(atom)) all.push({ test: "is_family", subject: "other", value: "pokemon" });
		else if (/^q\.entity\.species\.identifier\s*==\s*'[a-z_]+:([a-z0-9_]+)'$/.test(atom)) {
			const species = /'[a-z_]+:([a-z0-9_]+)'/.exec(atom)![1];
			all.push({ test: "is_family", subject: "other", value: `cobblemon_${species}` });
		} else if (/^q\.entity\.world\.is_air\(\s*q\.entity\.x\s*,\s*q\.entity\.y\s*\+\s*1\s*,\s*q\.entity\.z\s*\)$/.test(atom)) {
			// Ar logo acima do alvo: na superfície (tocando a água, sem estar submerso) ou fora dela.
			all.push({ test: "is_underwater", subject: "other", value: false });
		} else return undefined;
	}
	return all.length === 1 ? all[0] : { all_of: all };
}

export interface AiInput {
	movement: Movement;
	data: any;
	/** Espécie é só aquática (nada, sem andar/voar). */
	aquatic: boolean;
	shearable: boolean;
	toleratedLeaders: string[];
}

/**
 * Componentes de IA das tarefas resolvidas. As guardas de viabilidade do Bedrock (andar só fora da água para
 * aquáticos; nadar a esmo só quem respira embaixo d'água) são as mesmas da IA anterior do importador.
 */
export function aiComponents(ai: ResolvedAi, input: AiInput): Json {
	const { movement: m, data } = input;
	const beh = behaviourStruct(data);
	const vars = ai.variables;
	const has = (name: string, activity?: string) => ai.tasks.some((t) => t.name === name && (!activity || t.activity === activity));
	const find = (name: string) => ai.tasks.find((t) => t.name === name);
	const wanderSpeed = round(num(beh["moving.wander_speed"]) || 1);
	const wanderChance = Math.max(1, Math.round(num(beh["moving.wander_chance"])));
	const g: Json = {};
	// Passeio.
	// wanders (tarefa "wander" sem alturas); wanders_hover usa cobblemon:wander com minimumHeight/maximumHeight.
	const walkWander = ai.tasks.some((t) => t.name === "wander" && t.activity === "idle" && t.config.minimumHeight === undefined);
	if (walkWander && m.canWalk && !input.aquatic)
		g["minecraft:behavior.random_stroll"] = { priority: 7, speed_multiplier: wanderSpeed, interval: wanderChance, xz_dist: 10, y_dist: 5 };
	const hover = ai.tasks.find((t) => t.name === "wander" && t.activity === "idle" && t.config.minimumHeight !== undefined);
	if (hover && m.canFly) {
		const min = param(hover.config.minimumHeight, vars, 0);
		const max = param(hover.config.maximumHeight, vars, 6);
		// Padrão do Cobblemon (0..6) = configuração anterior; alturas próprias viram faixa em torno do meio.
		const custom = min !== 0 || max !== 6;
		g["minecraft:behavior.random_fly"] = {
			priority: 7, speed_multiplier: wanderSpeed, xz_dist: 10,
			y_dist: custom ? Math.max(1, Math.round((max - min) / 2)) : 6,
			y_offset: custom ? Math.round((min + max) / 2) : 0,
			can_land_on_trees: true, avoid_damage_blocks: true,
		};
	}
	if (has("water_wander", "idle") && m.canSwimInWater && !m.avoidsWater && (input.aquatic || m.canBreatheUnderwater))
		g["minecraft:behavior.random_swim"] = { priority: 7, speed_multiplier: wanderSpeed, xz_dist: 10, y_dist: 5, interval: input.aquatic ? 0 : wanderChance };
	// Fluidos.
	for (const t of ai.tasks.filter((x) => x.name === "move_into_fluid")) {
		if (t.config.movesIntoWater && m.canSwimInWater) g["minecraft:behavior.move_to_water"] = { priority: 3, search_range: 16, search_height: 5, search_count: 1, goal_radius: 0.5 };
		if (t.config.movesIntoLava) g["minecraft:behavior.move_to_lava"] = { priority: 3, search_range: 16, search_height: 5, goal_radius: 0.5 };
	}
	if (has("go_to_land") && !input.aquatic) g["minecraft:behavior.move_to_land"] = { priority: 5, search_range: 16, search_height: 5, goal_radius: 0.5 };
	// Luta: alvo e ataque. A atividade de luta só é alcançável com switch_to_fight (retaliates, defend_owner,
	// attack_hostile_mobs); fora dela melee_attack e alvos de target_entity não fazem nada no Cobblemon.
	const canFight = has("switch_to_fight", "idle");
	if (has("get_angry_at_attacker")) g["minecraft:behavior.hurt_by_target"] = { priority: 1 };
	if (has("defend_owner")) g["minecraft:behavior.owner_hurt_by_target"] = { priority: 1 };
	const targets: Json[] = [];
	if (has("attack_hostile_mobs") && canFight) {
		// AttackHostileMobsTask: Enemy vivo, fora Slime, piglins e Creeper; o script limita à área do pasto.
		targets.push({
			priority: 0, max_dist: 16, must_see: true,
			filters: {
				all_of: [
					{ test: "is_family", subject: "other", value: "monster" },
					{ none_of: ["creeper", "slime", "magmacube", "piglin", "zombie_pigman"].map((f) => ({ test: "is_family", subject: "other", value: f })) },
				],
			},
		});
	}
	if (canFight) {
		for (const t of ai.tasks.filter((x) => x.name === "target_entity")) {
			const filters = entityConditionFilter(String(t.config.entityCondition ?? "true"));
			if (!filters) {
				warn("target_entity com condição sem tradução (ignorada)", String(t.config.entityCondition));
				continue;
			}
			targets.push({ priority: 0, max_dist: param(t.config.range, vars, 24), must_see: true, filters });
		}
	}
	if (targets.length) {
		g["minecraft:behavior.nearest_attackable_target"] = {
			priority: 2, must_see: true, reselect_targets: true, within_radius: Math.max(...targets.map((t) => t.max_dist)),
			entity_types: targets.map((t) => ({ filters: t.filters, max_dist: t.max_dist, must_see: t.must_see })),
		};
	}
	if (canFight && has("melee_attack", "fight") && (g["minecraft:behavior.hurt_by_target"] || g["minecraft:behavior.owner_hurt_by_target"] || targets.length))
		g["minecraft:behavior.melee_box_attack"] = { priority: 2, speed_multiplier: 1.2, track_target: true };
	// Fuga.
	if (has("flee_attacker")) g["minecraft:behavior.panic"] = { priority: 1, speed_multiplier: 1.25 };
	// Herd: segue um líder tolerado por perto (FollowHerdLeaderTask, distância 4..8).
	if (has("find_herd_leader") && input.toleratedLeaders.length) {
		g["minecraft:behavior.follow_mob"] = {
			priority: 5, search_range: 16, stop_distance: 4, speed_multiplier: 1.0,
			filters: {
				all_of: [
					{ test: "has_tag", subject: "other", value: "cobblemon_herd_leader" },
					{ any_of: input.toleratedLeaders.map((s) => ({ test: "is_family", subject: "other", value: `cobblemon_${s}` })) },
				],
			},
		};
	}
	// pokemon_eats_grass: só recupera a lã se estiver tosquiado (EatGrassTask); o script filtra pelo aspect.
	if (has("eat_grass") && input.shearable) {
		g["minecraft:behavior.eat_block"] = {
			priority: 6, success_chance: 0.02, time_until_eat: 1.8,
			eat_and_replace_block_pairs: [{ eat_block: "grass", replace_block: "dirt" }, { eat_block: "tallgrass", replace_block: "air" }],
			on_eat: { event: "cobblemon:ate_grass", target: "self" },
		};
	}
	// Dono: MoveToOwnerTask (anda a mais de maxDistance e teleporta a mais de teleportDistance).
	const toOwner = find("move_to_owner");
	if (toOwner) {
		const scope = entityScope(data, { ...CONTEXTS.party }, {});
		const value = (e: unknown, d: number) => {
			if (typeof e === "number") return e;
			try { return num(new Parser(String(e ?? d), scope).parse()); }
			catch { return d; }
		};
		const maxDistance = value(toOwner.config.maxDistance, 5);
		const teleport = value(toOwner.config.teleportDistance, 32);
		g["minecraft:behavior.follow_owner"] = { priority: 4, speed_multiplier: 1.2, start_distance: maxDistance, stop_distance: 2, can_teleport: false, max_distance: 64 };
		g["minecraft:behavior.teleport_to_owner"] = { priority: 0, cooldown: 1, filters: { test: "owner_distance", operator: ">", value: teleport } };
	}
	// pokemon_sleeps_on_trainer_bed: vai até a cama quando o dono dorme; o script liga cobblemon:sleeping.
	if (has("switch_to_sleep_on_trainer_bed")) g["minecraft:behavior.pet_sleep_with_owner"] = { priority: 2, speed_multiplier: 1.2, search_height: 10, goal_radius: 1.0 };
	return g;
}

/** Componentes de `extra` que não estão (com o mesmo valor) em `base`: o grupo adicional não repete o do grupo base. */
export function extraComponents(extra: Json, base: Json): Json {
	const out: Json = {};
	for (const [k, v] of Object.entries(extra)) if (!(k in base)) out[k] = v;
	return out;
}

/** Espécies com a tarefa point_to_spawn (Nosepass): o script vira o corpo para o spawn do mundo. */
export function pointsToSpawn(ai: ResolvedAi): boolean {
	return ai.tasks.some((t) => t.name === "point_to_spawn");
}
