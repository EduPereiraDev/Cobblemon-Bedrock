// Reescrita de Molang: troca funções exclusivas do Cobblemon por equivalentes do Bedrock (ou constantes)
// e lista as queries/funções conhecidas do Bedrock (usadas também pelo validador).
import { unconverted } from "./util.ts";

/** Queries do Bedrock (estáveis) que o conteúdo gerado pode usar. Comparação sem diferenciar caixa. */
export const BEDROCK_QUERIES = new Set([
	"above_top_solid", "actor_count", "all", "all_animations_finished", "any", "any_animation_finished",
	"anim_time", "approx_eq", "armor_color_slot", "armor_material_slot", "armor_texture_slot", "average_frame_time",
	"blocking", "body_x_rotation", "body_y_rotation", "bone_aabb", "bone_origin", "bone_rotation", "camera_distance_range_lerp",
	"camera_rotation", "can_climb", "can_damage_nearby_mobs", "can_dash", "can_fly", "can_power_jump", "can_swim", "can_walk",
	"cape_flap_amount", "cardinal_facing", "cardinal_facing_2d", "cardinal_player_facing", "combine_entities", "count",
	"current_squish_value", "dash_cooldown_progress", "day", "death_ticks", "delta_time", "distance_from_camera",
	"effect_emitter_count", "effect_particle_count", "equipment_count", "equipped_item_all_tags", "equipped_item_any_tag",
	"equipped_item_is_attachable", "eye_target_x_rotation", "eye_target_y_rotation", "facing_target_to_range_attack",
	"frame_alpha", "get_actor_info_id", "get_animation_frame", "get_default_bone_pivot", "get_locator_offset",
	"get_root_locator_offset", "ground_speed", "has_any_family", "has_armor_slot", "has_biome_tag", "has_block_property",
	"has_cape", "has_collision", "has_dash_cooldown", "has_gravity", "has_owner", "has_player_rider", "has_property", "has_rider",
	"has_target", "head_roll_angle", "head_x_rotation", "head_y_rotation", "health", "heartbeat_interval", "heartbeat_phase",
	"heightmap", "hurt_direction", "hurt_time", "in_range", "invulnerable_ticks", "is_admiring", "is_alive", "is_angry",
	"is_attached_to_entity", "is_avoiding_block", "is_avoiding_mobs", "is_baby", "is_breathing", "is_bribed", "is_carrying_block",
	"is_casting", "is_celebrating", "is_celebrating_special", "is_charged", "is_charging", "is_chested", "is_critical",
	"is_croaking", "is_dancing", "is_delayed_attacking", "is_digging", "is_eating", "is_eating_mob", "is_elder", "is_emerging",
	"is_emoting", "is_enchanted", "is_fire_immune", "is_first_person", "is_ghost", "is_gliding", "is_grazing", "is_idling",
	"is_ignited", "is_illager_captain", "is_in_contact_with_water", "is_in_lava", "is_in_love", "is_in_ui", "is_in_water",
	"is_in_water_or_rain", "is_interested", "is_invisible", "is_item_equipped", "is_item_name_any", "is_jump_goal_jumping",
	"is_jumping", "is_laying_down", "is_laying_egg", "is_leashed", "is_levitating", "is_lingering", "is_local_player",
	"is_moving", "is_name_any", "is_on_fire", "is_on_ground", "is_on_screen", "is_onfire", "is_orphaned", "is_owner_identifier_any",
	"is_persona_or_premium_skin", "is_playing_dead", "is_powered", "is_pregnant", "is_ram_attacking", "is_resting", "is_riding",
	"is_rolling", "is_saddled", "is_scared", "is_scenting", "is_searching", "is_selected_item", "is_shaking", "is_shaking_wetness",
	"is_sheared", "is_shield_powered", "is_silent", "is_sitting", "is_sleeping", "is_sneaking", "is_sneezing", "is_sniffing",
	"is_sonic_boom", "is_spectator", "is_sprinting", "is_stackable", "is_stalking", "is_standing", "is_stunned", "is_swimming",
	"is_tamed", "is_transforming", "is_using_item", "is_wall_climbing", "item_in_use_duration", "item_is_charged",
	"item_max_use_duration", "item_remaining_use_duration", "key_frame_lerp_time", "last_frame_time", "last_hit_by_player",
	"lie_amount", "life_span", "life_time", "lod_index", "log", "main_hand_item_max_duration", "main_hand_item_use_duration",
	"mark_variant", "max_durability", "max_health", "max_trade_tier", "maximum_frame_time", "minimum_frame_time",
	"model_scale", "modified_distance_moved", "modified_move_speed", "moon_brightness", "moon_phase", "movement_direction",
	"noise", "on_fire_time", "out_of_control", "player_level", "position", "position_delta", "previous_squish_value",
	"property", "remaining_durability", "rider_body_x_rotation", "rider_body_y_rotation", "rider_head_x_rotation", "rider_head_y_rotation", "roll_counter", "rotation_to_camera", "scoreboard", "shake_angle", "shake_time",
	"shield_blocking_bob", "show_bottom", "sit_amount", "skin_id", "sleep_rotation", "sneeze_counter", "spellcolor",
	"standing_scale", "state_time", "structural_integrity", "surface_particle_color", "surface_particle_texture_coordinate",
	"surface_particle_texture_size", "swell_amount", "swelling_dir", "swim_amount", "tail_angle", "target_x_rotation",
	"target_y_rotation", "texture_frame_index", "time_of_day", "time_stamp", "total_emitter_count", "total_particle_count",
	"trade_tier", "unhappy_counter", "variant", "vertical_speed", "walk_distance", "wing_flap_position", "wing_flap_speed",
	"yaw_speed",
]);

/** Funções math.* do Molang do Bedrock. */
export const BEDROCK_MATH = new Set([
	"abs", "acos", "asin", "atan", "atan2", "ceil", "clamp", "copy_sign", "cos", "die_roll", "die_roll_integer", "ease_in_back",
	"ease_in_bounce", "ease_in_circ", "ease_in_cubic", "ease_in_elastic", "ease_in_expo", "ease_in_out_back", "ease_in_out_bounce",
	"ease_in_out_circ", "ease_in_out_cubic", "ease_in_out_elastic", "ease_in_out_expo", "ease_in_out_quad", "ease_in_out_quart",
	"ease_in_out_quint", "ease_in_out_sine", "ease_in_quad", "ease_in_quart", "ease_in_quint", "ease_in_sine", "ease_out_back",
	"ease_out_bounce", "ease_out_circ", "ease_out_cubic", "ease_out_elastic", "ease_out_expo", "ease_out_quad", "ease_out_quart",
	"ease_out_quint", "ease_out_sine", "exp", "floor", "hermite_blend", "inverse_lerp", "lerp", "lerprotate", "ln", "max", "min",
	"min_angle", "mod", "pi", "pow", "random", "random_integer", "round", "sign", "sin", "sqrt", "trunc",
]);

/** Contexto de tradução: o que substituir para cada query do Cobblemon. */
export type QueryMapper = (name: string, args: string[], raw: string) => string | undefined;

/** Substituições padrão (valem para animações e condições de pose). */
export const COMMON_QUERY_MAP: Record<string, string> = {
	has_entity: "1.0",
	in_air: "(!q.is_on_ground)",
	// PokemonEntityMoLangFunctions: is_ridden = hasControllingPassenger → query estável do Bedrock.
	is_ridden: "q.has_rider",
	is_sprinting: "0.0",
	is_gliding: "0.0",
	is_standing_on_blocks: "0.0",
	// Estilo de montaria: código calculado no cliente (entities.ts, pre_animation). As comparações
	// q.riding_style == 'AIR' são reescritas antes (rewriteRideStyle); o que sobrar vira o código numérico.
	riding_style: "v.cobblemon_ride_style",
	horizontal_velocity: "(q.ground_speed / 20.0)",
	in_battle: "q.property('cobblemon:in_battle')",
	input_up: "0.0",
	input_down: "0.0",
	input_left: "0.0",
	input_right: "0.0",
	input_jump: "0.0",
};

/** Substituições de COMMON_QUERY_MAP que são equivalentes (não contam como Molang não convertido). */
const EXACT_QUERIES = new Set(["is_ridden", "riding_style", "in_battle", "horizontal_velocity", "in_air"]);

/** Códigos de v.cobblemon_ride_style (entities.ts calcula no pre_animation). */
export const RIDE_STYLE_CODE: Record<string, number> = { NONE: 0, LAND: 1, AIR: 2, LIQUID: 3 };

/** q.riding_style == 'AIR' → (v.cobblemon_ride_style == 2); estilos desconhecidos viram falso/verdadeiro. */
export function rewriteRideStyle(expr: string): string {
	return expr.replace(/q(?:uery)?\.riding_style\s*(==|!=)\s*'(\w+)'/gi, (_m, op: string, style: string) => {
		const code = RIDE_STYLE_CODE[style.toUpperCase()];
		if (code === undefined) return op === "==" ? "0.0" : "1.0";
		return `(v.cobblemon_ride_style ${op} ${code})`;
	});
}

/** Divide argumentos no nível superior ("a, f(b,c)" → ["a", "f(b,c)"]). */
export function splitArgs(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	let quote: string | null = null;
	for (const ch of s) {
		if (quote) {
			cur += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === "\"") {
			quote = ch;
			cur += ch;
		} else if (ch === "(" || ch === "[" || ch === "{") {
			depth++;
			cur += ch;
		} else if (ch === ")" || ch === "]" || ch === "}") {
			depth--;
			cur += ch;
		} else if (ch === "," && depth === 0) {
			out.push(cur.trim());
			cur = "";
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

/** Extrai o valor de uma string Molang 'x' ou "x". */
export function unquote(s: string | undefined): string | undefined {
	if (s === undefined) return undefined;
	const t = s.trim();
	if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith("\"") && t.endsWith("\""))) return t.slice(1, -1);
	return undefined;
}

const IDENT = /^(q|query|math|v|variable|t|temp|c|context)\.([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)/i;

export interface MolangCall {
	prefix: string;
	name: string;
	args: string[] | null;
	start: number;
	end: number;
}

/** Percorre as chamadas/identificadores q./math./v. de uma expressão (ignorando strings). */
export function scanMolang(expr: string, visit: (call: MolangCall) => string | undefined): string {
	let out = "";
	let i = 0;
	while (i < expr.length) {
		const ch = expr[i];
		if (ch === "'") {
			const j = expr.indexOf("'", i + 1);
			const end = j < 0 ? expr.length : j + 1;
			out += expr.slice(i, end);
			i = end;
			continue;
		}
		const prev = i > 0 ? expr[i - 1] : "";
		if (/[a-z]/i.test(ch) && !/[a-z0-9_.]/i.test(prev)) {
			const m = IDENT.exec(expr.slice(i));
			if (m) {
				const prefix = m[1].toLowerCase();
				const name = m[2];
				let end = i + m[0].length;
				let args: string[] | null = null;
				let k = end;
				let inner: [number, number] | undefined;
				while (k < expr.length && expr[k] === " ") k++;
				if (expr[k] === "(") {
					let depth = 0;
					let quote = false;
					let j = k;
					for (; j < expr.length; j++) {
						const c = expr[j];
						if (c === "'") quote = !quote;
						if (quote) continue;
						if (c === "(") depth++;
						else if (c === ")" && --depth === 0) break;
					}
					args = splitArgs(expr.slice(k + 1, j));
					inner = [k + 1, Math.min(j, expr.length)];
					end = Math.min(j + 1, expr.length);
				}
				const replacement = visit({ prefix, name, args, start: i, end });
				if (replacement !== undefined) out += replacement;
				else if (inner) {
					// Chamada mantida: os argumentos também passam pelo visitante (q.x dentro de math.clamp(...)).
					out += expr.slice(i, inner[0]) + scanMolang(expr.slice(inner[0], inner[1]), visit) + expr.slice(inner[1], end);
				} else out += expr.slice(i, end);
				i = end;
				continue;
			}
			// Palavra comum: copia inteira para não casar sufixos.
			const w = /^[a-z_][a-z0-9_]*/i.exec(expr.slice(i))![0];
			out += w;
			i += w.length;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

/**
 * Reescreve uma expressão Molang do Cobblemon para o Bedrock. Queries desconhecidas viram `0.0`
 * e ficam registradas no relatório. `extra` permite substituições específicas do contexto.
 */
export function rewriteMolang(expr: string, where: string, extra: Record<string, string> = {}, riding?: RidingMolang): string {
	return scanMolang(rewriteRideStyle(expr), (call) => {
		const lname = call.name.toLowerCase();
		if (call.prefix === "q" || call.prefix === "query") {
			if (lname in extra) return extra[lname];
			if (riding && /^(?:r|riding)\./.test(lname)) return riding.rewriteCall(lname, call.args);
			if (lname in COMMON_QUERY_MAP) {
				if (!EXACT_QUERIES.has(lname)) unconverted(`q.${lname} (substituída)`, where);
				return COMMON_QUERY_MAP[lname];
			}
			if (BEDROCK_QUERIES.has(lname)) return undefined;
			unconverted(`q.${lname}`, where);
			return "0.0";
		}
		if (call.prefix === "math") {
			if (BEDROCK_MATH.has(lname)) return undefined;
			unconverted(`math.${lname}`, where);
			return "0.0";
		}
		return undefined;
	});
}

/** Molang "suspeito" de ter sintaxe inválida (parênteses/aspas desbalanceados). */
export function looksBroken(expr: string): boolean {
	let depth = 0;
	let quotes = 0;
	for (const ch of expr) {
		if (ch === "'") quotes++;
		else if (ch === "(") depth++;
		else if (ch === ")") depth--;
		if (depth < 0) return true;
	}
	return depth !== 0 || quotes % 2 !== 0;
}

// ---------------------------------------------------------------------------------------------
// Molang de montaria do Cobblemon (q.r.* / q.riding.*: PosableState.ridingFunctions + RidingAnimationData)
// → variáveis v.cr_* calculadas no pre_animation da client entity, só com queries do cliente (sem rede).
// RidingAnimationData roda por tick com molas Vec3Spring(k=90, c=18); aqui a mola roda por quadro com
// dt = q.delta_time (limitado a 0,05 s), a mesma resposta contínua. O argumento N (média dos últimos N ticks)
// vira média exponencial com τ = N/40 s. Saídas normalizadas e limitadas como no Cobblemon.

const CR = "v.cr";

/** Sinais brutos por quadro, nas unidades do Cobblemon (blocos/tick, graus, graus/s). */
const RIDE_RAW: Record<string, string[]> = {
	vel: [
		`${CR}_vx = (q.position(0) - (${CR}_px ?? q.position(0))) / ${CR}_dt / 20; ${CR}_px = q.position(0);`,
		`${CR}_vz = (q.position(2) - (${CR}_pz ?? q.position(2))) / ${CR}_dt / 20; ${CR}_pz = q.position(2);`,
		`${CR}_vy = q.vertical_speed / 20;`,
	],
	// Montarias do Bedrock não inclinam a entidade: o olhar do condutor é o substituto do pitch.
	rot: [
		`${CR}_yaw = q.body_y_rotation;`,
		`${CR}_pitch = q.has_rider ? q.rider_head_x_rotation(0) : 0;`,
		`${CR}_dyaw = math.min_angle(${CR}_yaw - (${CR}_lyaw ?? ${CR}_yaw)) / ${CR}_dt; ${CR}_lyaw = ${CR}_yaw;`,
		`${CR}_dpitch = (${CR}_pitch - (${CR}_lpitch ?? ${CR}_pitch)) / ${CR}_dt; ${CR}_lpitch = ${CR}_pitch;`,
	],
};

const LOCAL_FWD = `(-math.sin(${CR}_yaw) * ${CR}_vx + math.cos(${CR}_yaw) * ${CR}_vz)`;
const LOCAL_RIGHT = `(math.cos(${CR}_yaw) * ${CR}_vx + math.sin(${CR}_yaw) * ${CR}_vz)`;

/** Cada q.r.X: sinais brutos, molas (nome → alvo), expressão final e faixa. */
const RIDE_DEFS: Record<string, { raw: string[]; springs: Array<[string, string]>; expr: string; clamp: [number, number] }> = {
	velocity_y: { raw: ["vel"], springs: [["svy", `${CR}_vy`]], expr: `${CR}_svy`, clamp: [-1, 1] },
	velocity_x: { raw: ["vel"], springs: [["svx", `${CR}_vx`]], expr: `${CR}_svx`, clamp: [-1, 1] },
	velocity_z: { raw: ["vel"], springs: [["svz", `${CR}_vz`]], expr: `${CR}_svz`, clamp: [-1, 1] },
	speed: { raw: ["vel"], springs: [["svx", `${CR}_vx`], ["svy", `${CR}_vy`], ["svz", `${CR}_vz`]], expr: `math.sqrt(${CR}_svx * ${CR}_svx + ${CR}_svy * ${CR}_svy + ${CR}_svz * ${CR}_svz)`, clamp: [-1, 1] },
	velocity_right: { raw: ["vel", "rot"], springs: [["slx", LOCAL_RIGHT]], expr: `${CR}_slx`, clamp: [-1, 1] },
	velocity_forward: { raw: ["vel", "rot"], springs: [["slz", LOCAL_FWD]], expr: `${CR}_slz`, clamp: [-1, 1] },
	velocity_up: { raw: ["vel"], springs: [["sly", `${CR}_vy`]], expr: `${CR}_sly`, clamp: [-1, 1] },
	yaw_change: { raw: ["rot"], springs: [["syr", `${CR}_dyaw`]], expr: `${CR}_syr / -140`, clamp: [-1, 1] },
	pitch_change: { raw: ["rot"], springs: [["spr", `${CR}_dpitch`]], expr: `${CR}_spr / 140`, clamp: [-1, 1] },
	pitch: { raw: ["rot"], springs: [["sp", `${CR}_pitch`]], expr: `${CR}_sp / 90`, clamp: [-1, 1] },
	yaw: { raw: ["rot"], springs: [["sy", `${CR}_yaw`]], expr: `${CR}_sy / 180`, clamp: [-1, 1] },
	dive: { raw: ["rot"], springs: [["sdv", `math.max(math.sin(${CR}_pitch), 0)`]], expr: `${CR}_sdv`, clamp: [0, 1] },
	// Sem rolagem no Bedrock (como os estilos do Cobblemon que não rolam).
	roll: { raw: [], springs: [], expr: "0", clamp: [-1, 1] },
	roll_change: { raw: [], springs: [], expr: "0", clamp: [-1, 1] },
	// Intenção do condutor: aproximada pela velocidade local (o cliente não sabe as teclas de outro jogador).
	input_forward: { raw: ["vel", "rot"], springs: [["sif", `math.clamp(${LOCAL_FWD} * 8, -1, 1)`]], expr: `${CR}_sif`, clamp: [-1, 1] },
	input_right: { raw: ["vel", "rot"], springs: [["sir", `math.clamp(${LOCAL_RIGHT} * 8, -1, 1)`]], expr: `${CR}_sir`, clamp: [-1, 1] },
	input_up: { raw: ["vel"], springs: [["siu", `math.clamp(${CR}_vy * 8, -1, 1)`]], expr: `${CR}_siu`, clamp: [-1, 1] },
	// Não existe no Cobblemon 1.8.2 (vale 0 lá também).
	target_distance_x: { raw: [], springs: [], expr: "0", clamp: [-1, 1] },
	target_distance_y: { raw: [], springs: [], expr: "0", clamp: [-1, 1] },
};

/** Reescreve q.r.X(N) e registra o que o pre_animation precisa calcular. */
export class RidingMolang {
	/** "nome|N" usados. */
	used = new Set<string>();

	rewriteCall(lname: string, args: string[] | null): string {
		const m = /^(?:r|riding)\.(\w+)$/.exec(lname);
		const name = m?.[1];
		if (!name || !RIDE_DEFS[name]) {
			unconverted(`q.${lname}`, "montaria");
			return "0.0";
		}
		const n = Math.min(19, Math.max(0, Math.round(Number(args?.[0] ?? 0)) || 0));
		this.used.add(`${name}|${n}`);
		return ridingVar(name, n);
	}

	/** Linhas do pre_animation para um conjunto de usos (união de vários grupos de animação). */
	static preAnimation(used: Iterable<string>): string[] {
		const list = [...new Set(used)].sort();
		if (!list.length) return [];
		const raw = new Set<string>();
		const springs = new Map<string, string>();
		const outputs: string[] = [];
		for (const key of list) {
			const [name, nRaw] = key.split("|");
			const def = RIDE_DEFS[name];
			if (!def) continue;
			const n = Number(nRaw);
			for (const r of def.raw) raw.add(r);
			for (const [s, target] of def.springs) springs.set(s, target);
			const out = ridingVar(name, n);
			const base = `math.clamp(${def.expr}, ${def.clamp[0]}, ${def.clamp[1]})`;
			outputs.push(n ? `${out} = (${out} ?? 0) + (${base} - (${out} ?? 0)) * math.min(1, ${CR}_dt * ${+(40 / n).toFixed(3)});` : `${out} = ${base};`);
		}
		const lines = [`${CR}_dt = math.clamp(q.delta_time, 0.001, 0.05);`];
		for (const r of ["vel", "rot"]) if (raw.has(r)) lines.push(...RIDE_RAW[r]);
		// Fora da montaria os alvos vão a 0 e as molas assentam (sem pulo ao montar de novo).
		for (const [s, target] of springs) {
			const v = `${CR}_${s}`;
			lines.push(`${v}_v = (${v}_v ?? 0) + (90 * ((q.has_rider ? ${target} : 0) - (${v} ?? 0)) - 18 * (${v}_v ?? 0)) * ${CR}_dt; ${v} = (${v} ?? 0) + ${v}_v * ${CR}_dt;`);
		}
		lines.push(...outputs);
		return lines;
	}
}

function ridingVar(name: string, n: number): string {
	return `${CR}_o_${name}${n ? `_${n}` : ""}`;
}
