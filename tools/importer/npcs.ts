// NPCs do Cobblemon 1.8.2 → entidade `cobblemon:npc` (BP + RP) e dados para os scripts (generated/scripts/npcs.ts).
//
// Cliente: modelos de bedrock/npcs/models (identificadores renomeados para geometry.cobblemon_npc_<arquivo>, porque
// steve/alex/trainer usam todos "geometry.trainer"), texturas de textures/npcs, animações de trainer_generic
// (Molang do Cobblemon reescrito: math.r2d, v.age_in_ticks, v.limb_swing) e um poser equivalente ao
// bedrock/npcs/posers/standard.json (standing / battle-standing, q.look na cabeça e piscada).
// A "skin" é a propriedade `cobblemon:npc_skin` (índice em NPC_SKINS), escolhida pelos scripts a partir do
// resourceIdentifier + aspects do NPC (mesma semântica dos variations/*.json).
//
// Servidor: dados de data/cobblemon/{npcs,npc_presets,dialogues,molang/npc,callbacks/battle_victory} viram
// strings JSON/Molang em generated/scripts/npcs.ts (parse sob demanda).
import { basename, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { rewriteMolang, scanMolang } from "./molang.ts";
import { dedupeLocators } from "./locators.ts"; // frente cliente-modelos
import { ASSETS, DATA, OUT_BP, OUT_RP, OUT_SCRIPTS, copyFile, count, readJson, tryReadJson, walk, warn, writeJson, writeText } from "./util.ts";

const NPC_ASSETS = `${ASSETS}/bedrock/npcs`;
const NPC_DATA = `${DATA}/cobblemon`;
const HEADER = "// Arquivo gerado por tools/importer (npm run import). Não edite à mão.\n/* eslint-disable */\n";

/** Identificador da entidade e propriedades usadas pelos scripts (scripts/npc). */
export const NPC_ENTITY_ID = "cobblemon:npc";
export const NPC_SKIN_PROPERTY = "cobblemon:npc_skin";
/** Frente limites-a: esconde o modelo do NPC (part_visibility); override por jogador no NPC escondido. */
export const NPC_HIDDEN_PROPERTY = "cobblemon:npc_hidden";
export const NPC_MODEL_SEAT_GROUP = "cobblemon:npc_model_seat";
export const NPC_RENDER_SCALE_PROPERTY = "cobblemon:npc_render_scale";
/** Arquivos gerados pelo NPC (o validador trata estes caminhos como entidade não-Pokémon). */
export const NPC_CLIENT_ENTITY_DIR = "entity/npc";
export const NPC_SERVER_ENTITY_DIR = "entities/npc";

/**
 * Behaviours do Cobblemon → componentes vanilla (grupo cobblemon:npc_b_<nome>). Os que não têm objetivo vanilla
 * (stationary, uses_healing_machine, chats, battler...) são tarefas do script (scripts/npc/Behaviours.ts).
 */
const NPC_BEHAVIOUR_GROUPS: Record<string, Record<string, unknown>> = {
	// wander (ChooseWanderTargetTask): passeio aleatório.
	wanders: { "minecraft:behavior.random_stroll": { priority: 7, speed_multiplier: 0.6, interval: 120, xz_dist: 10, y_dist: 7 } },
	// look_at_entities com look_at_entity_types = jogador.
	looks_at_players: { "minecraft:behavior.look_at_player": { priority: 1, look_distance: 8, probability: 0.8, look_time: [2, 4] } },
	// looks_around: olha para entidades próximas e em volta.
	looks_around: {
		"minecraft:behavior.look_at_entity": { priority: 2, look_distance: 6, probability: 0.02, filters: { test: "is_family", subject: "other", value: "mob" } },
		"minecraft:behavior.random_look_around": { priority: 3 },
	},
	// panics (flee_attacker / switch_to_panic_when_hurt / flee_nearest_hostile).
	panics: {
		"minecraft:behavior.panic": { priority: 0, speed_multiplier: 1.25 },
		"minecraft:behavior.avoid_mob_type": { priority: 1, entity_types: [{ filters: { test: "is_family", subject: "other", value: "monster" }, max_dist: 8, walk_speed_multiplier: 1, sprint_speed_multiplier: 1.25 }] },
	},
	// fights_melee (move_to_attack_target + melee_attack); dano de NPCEntity.doHurtTarget = ATTACK_DAMAGE(1) × 5.
	fights_melee: {
		"minecraft:attack": { damage: 5 },
		"minecraft:behavior.melee_attack": { priority: 3, speed_multiplier: 1, track_target: true, reach_multiplier: 2 },
	},
	// retaliates (get_angry_at_attacker / attack_angry_at).
	retaliates: { "minecraft:behavior.hurt_by_target": { priority: 1 } },
	// attack_hostile_mobs.
	attack_hostile_mobs: {
		"minecraft:behavior.nearest_attackable_target": { priority: 2, must_see: true, reselect_targets: true, entity_types: [{ filters: { test: "is_family", subject: "other", value: "monster" }, max_dist: 16 }] },
	},
	// floats (stay_afloat).
	floats: { "minecraft:behavior.float": { priority: 0 } },
	// go_to_healing_machine: só ligado pelo script enquanto o time precisa de cura.
	goes_to_healer: {
		"minecraft:behavior.move_to_block": { priority: 1, search_range: 8, search_height: 4, goal_radius: 1.5, speed_multiplier: 1, tick_interval: 10, target_blocks: ["cobblemon:healing_machine"] },
	},
};

/** Tamanhos de caixa de colisão (passo de 0,2 bloco; 0,6 × 1,8 = jogador). */
const NPC_HITBOX_WIDTHS = Array.from({ length: 15 }, (_, i) => Math.round((i + 1) * 2) / 10);
const NPC_HITBOX_HEIGHTS = Array.from({ length: 20 }, (_, i) => Math.round((i + 1) * 2) / 10);
function npcHitboxKey(width: number, height: number) {
	return `w${Math.round(width * 10)}_h${Math.round(height * 10)}`;
}

/** Grupo de animações do NPC no Bedrock (animation.cobblemon_npc.<nome>). */
const ANIM_GROUP = "cobblemon_npc";
/** Animações de trainer_generic exportadas (nome local → chave curta na client entity). */
const TRAINER_ANIMS = ["idle", "idle_battle", "battle_intro", "lose", "win", "command", "blink", "mega", "return", "send_out"];

interface Skin {
	/** "cobblemon:trainer.geo" */
	model: string;
	/** "cobblemon:textures/npcs/standard/trainer.png" */
	texture: string;
	geometryId: string;
	textureRef: string;
}

/** math.r2d(x) (Cobblemon) → graus; o resto passa pela reescrita padrão. */
function rewriteNpcMolang(expr: string, where: string): string {
	const r2d = (e: string): string =>
		scanMolang(e, (call) => (call.prefix === "math" && call.name.toLowerCase() === "r2d" && call.args ? `((${r2d(call.args[0] ?? "0")}) * 57.29578)` : undefined));
	return rewriteMolang(r2d(expr), where);
}

function rewriteBones(value: any, where: string): any {
	if (typeof value === "string") return rewriteNpcMolang(value, where);
	if (Array.isArray(value)) return value.map((v) => rewriteBones(v, where));
	if (value && typeof value === "object") {
		const out: any = {};
		for (const [k, v] of Object.entries(value)) out[k] = k === "lerp_mode" ? v : rewriteBones(v, where);
		return out;
	}
	return value;
}

/**
 * Skin de jogador (textura "variable" no Cobblemon, baixada da conta do jogador no Java): no Bedrock a skin é do
 * cliente, então a melhor aproximação é a textura padrão do pacote vanilla para o modelo (Steve largo, Alex fino).
 * Essas texturas já existem no jogo e não são copiadas.
 */
const PLAYER_TEXTURES: Record<string, string> = {
	"cobblemon:steve.geo": "minecraft:textures/entity/steve",
	"cobblemon:alex.geo": "minecraft:textures/entity/alex",
};

/** "cobblemon:textures/npcs/x.png" → { file, ref } (ou undefined se não existir). `file` vazio = textura vanilla. */
function textureOf(id: string): { file: string; ref: string } | undefined {
	if (id.startsWith("minecraft:")) return { file: "", ref: id.slice("minecraft:".length) };
	const path = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
	const file = `${ASSETS}/${path}`;
	if (!existsSync(file)) return undefined;
	return { file, ref: path.replace(/\.png$/i, "") };
}

function readDir(dir: string, ext: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const file of walk(dir, (n) => n.endsWith(ext))) {
		const id = `cobblemon:${relative(dir, file).replace(/\\/g, "/").slice(0, -ext.length)}`;
		out[id] = ext === ".json" ? JSON.stringify(readJson(file)) : readText(file);
	}
	return out;
}

function readText(file: string): string {
	return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

export interface NpcEmitStats {
	skins: number;
	classes: number;
	presets: number;
	dialogues: number;
	scripts: number;
}

export function emitNpcs(): NpcEmitStats {
	// 1. Geometrias (identificador único por arquivo).
	const geometryOf = new Map<string, string>();
	const geometryJson = new Map<string, { file: string; json: unknown }>();
	for (const file of walk(`${NPC_ASSETS}/models`, (n) => n.endsWith(".json"))) {
		const json = tryReadJson(file);
		const geo = json?.["minecraft:geometry"]?.[0];
		if (!geo) {
			warn("modelo de NPC inválido", basename(file));
			continue;
		}
		const key = basename(file, ".json"); // "trainer.geo"
		const id = `geometry.cobblemon_npc_${key.replace(/\.geo$/, "").toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
		geo.description.identifier = id;
		geometryOf.set(`cobblemon:${key}`, id);
		geometryJson.set(id, { file: `${OUT_RP}/models/${NPC_CLIENT_ENTITY_DIR}/${key}.json`, json: { format_version: json.format_version ?? "1.12.0", "minecraft:geometry": [geo] } });
	}

	// 2. Variações (resolvers) e skins: cada par modelo+textura concreto vira um índice de cobblemon:npc_skin.
	const skins: Skin[] = [];
	const skinIndex = (model: string, texture: string): number | undefined => {
		const found = skins.findIndex((s) => s.model === model && s.texture === texture);
		if (found >= 0) return found;
		const geometryId = geometryOf.get(model);
		const tex = textureOf(texture);
		if (!geometryId || !tex) {
			warn("variação de NPC sem modelo/textura (ignorada)", `${model} + ${texture}`);
			return undefined;
		}
		skins.push({ model, texture, geometryId, textureRef: tex.ref });
		return skins.length - 1;
	};
	const resolvers: Record<string, { order: number; variations: Array<{ aspects: string[]; model?: string; texture?: string }> }[]> = {};
	for (const file of walk(`${NPC_ASSETS}/variations`, (n) => n.endsWith(".json"))) {
		const json = tryReadJson(file);
		if (!json?.name) continue;
		const variations = (json.variations ?? []).map((v: any) => ({
			aspects: Array.isArray(v.aspects) ? v.aspects.map(String) : [],
			model: typeof v.model === "string" ? v.model : undefined,
			// Textura "variable" = skin baixada da conta do jogador: o resolver não troca a skin por ela; as skins de
			// jogador (PLAYER_TEXTURES) entram no fim da lista e são escolhidas pelo script (q.entity.set_player_texture).
			texture: typeof v.texture === "string" && v.texture !== "variable" ? v.texture : undefined,
		}));
		for (const v of variations) if (v.model && v.texture) skinIndex(v.model, v.texture);
		(resolvers[json.name] ??= []).push({ order: Number(json.order ?? 0), variations });
	}
	for (const list of Object.values(resolvers)) list.sort((a, b) => a.order - b.order);
	// Texturas sem variação (ex.: textures/npcs/default.png) viram skins extras no modelo padrão de treinador.
	const baseModel = skins[0]?.model ?? "cobblemon:trainer.geo";
	for (const file of walk(`${ASSETS}/textures/npcs`, (n) => n.endsWith(".png"))) {
		const id = `cobblemon:${relative(ASSETS, file).replace(/\\/g, "/")}`;
		if (!skins.some((s) => s.texture === id)) skinIndex(baseModel, id);
	}
	// Skins de jogador por último (índices antigos de cobblemon:npc_skin continuam valendo).
	for (const [model, texture] of Object.entries(PLAYER_TEXTURES)) if (geometryOf.has(model)) skinIndex(model, texture);
	if (!skins.length) {
		warn("nenhuma skin de NPC gerada", NPC_ASSETS);
		return { skins: 0, classes: 0, presets: 0, dialogues: 0, scripts: 0 };
	}
	for (const s of skins) {
		const file = textureOf(s.texture)!.file;
		if (file) copyFile(file, `${OUT_RP}/${s.textureRef}.png`);
	}
	// Só as geometrias usadas por alguma skin.
	// Frente cliente-modelos: locators iguais em nome e diferentes em posição entre as geometrias da entidade colidem
	// no cliente (locators.ts); na ordem g0, g1... o repetido ganha nome próprio.
	const npcLocators = new Map<string, string>();
	for (const id of new Set(skins.map((s) => s.geometryId))) {
		const json = geometryJson.get(id)!.json as any;
		const renamed = dedupeLocators(json["minecraft:geometry"][0], npcLocators, id);
		if (renamed.size) count("locators renomeados (colidiam com outra geometria da entidade)", renamed.size);
		writeJson(geometryJson.get(id)!.file, json);
	}

	// 3. Animações (trainer_generic) + look + controllers.
	const anims: Record<string, any> = {};
	const animMap: Record<string, string> = {};
	const trainer = tryReadJson(`${NPC_ASSETS}/animations/trainer_generic.animation.json`)?.animations ?? {};
	for (const name of TRAINER_ANIMS) {
		const src = trainer[`animation.trainer_generic.${name}`];
		if (!src) continue;
		const id = `animation.${ANIM_GROUP}.${name}`;
		const out: any = {};
		for (const [k, v] of Object.entries<any>(src)) {
			if (k === "bones") out.bones = rewriteBones(v, id);
			// Timeline só tem q.render_item/q.clear_items (item na mão): sem equivalente no Bedrock.
			else if (k === "timeline" || k === "sound_effects" || k === "particle_effects") continue;
			else out[k] = v;
		}
		anims[id] = out;
		animMap[name === "return" ? "recall" : name] = id;
	}
	anims[`animation.${ANIM_GROUP}.look`] = {
		loop: true,
		bones: { head: { rotation: ["math.clamp(q.target_x_rotation, -45, 70)", "math.clamp(q.target_y_rotation, -45, 45)", 0] } },
	};
	animMap.look = `animation.${ANIM_GROUP}.look`;
	writeJson(`${OUT_RP}/animations/npc/${ANIM_GROUP}.animation.json`, { format_version: "1.8.0", animations: anims });

	const poseCtrl = `controller.animation.${ANIM_GROUP}.pose`;
	const blinkCtrl = `controller.animation.${ANIM_GROUP}.blink`;
	const has = (k: string) => k in animMap;
	writeJson(`${OUT_RP}/animation_controllers/npc/${ANIM_GROUP}.animation_controllers.json`, {
		format_version: "1.10.0",
		animation_controllers: {
			// poser standard: "standing" (q.in_battle() == false) e "battle-standing" (q.in_battle() == true).
			[poseCtrl]: {
				initial_state: "standing",
				states: {
					standing: {
						animations: ["look", ...(has("idle") ? ["idle"] : [])],
						transitions: [{ battle_standing: "q.property('cobblemon:in_battle')" }],
						blend_transition: 0.2,
					},
					battle_standing: {
						animations: ["look", ...(has("idle_battle") ? ["idle_battle"] : has("idle") ? ["idle"] : [])],
						transitions: [{ standing: "!q.property('cobblemon:in_battle')" }],
						blend_transition: 0.2,
					},
				},
			},
			// q.bedrock_quirk('trainer_generic', 'blink'): piscada a cada 3–6 s.
			[blinkCtrl]: {
				initial_state: "idle",
				states: {
					idle: { transitions: [{ blink: "q.state_time > v.cobblemon_npc_blink_at" }] },
					blink: {
						...(has("blink") ? { animations: ["blink"] } : {}), // cliente-modelos: [] é recusado pelo cliente
						on_exit: ["v.cobblemon_npc_blink_at = math.random(3, 6);"],
						transitions: [{ idle: "q.all_animations_finished || q.state_time > 0.5" }],
					},
				},
			},
		},
	});
	animMap.ctrl_pose = poseCtrl;
	animMap.ctrl_blink = blinkCtrl;

	// 4. Render controller + client entity.
	const rcId = `controller.render.${ANIM_GROUP}`;
	const skinExpr = `q.property('${NPC_SKIN_PROPERTY}')`;
	writeJson(`${OUT_RP}/render_controllers/npc/${ANIM_GROUP}.render_controllers.json`, {
		format_version: "1.10.0",
		render_controllers: {
			[rcId]: {
				arrays: {
					geometries: { "Array.geo": skins.map((_, i) => `Geometry.g${i}`) },
					textures: { "Array.tex": skins.map((_, i) => `Texture.t${i}`) },
				},
				geometry: `Array.geo[${skinExpr}]`,
				materials: [{ "*": "Material.default" }],
				textures: [`Array.tex[${skinExpr}]`],
				// Frente limites-a: modelo do NPC oculto quando ele usa um modelo de Pokémon (resourceIdentifier de
				// espécie, scripts/npc/PokemonModel.ts) ou está escondido para este jogador (override por jogador,
				// scripts/npc/NpcHide.ts).
				part_visibility: [{ "*": `!q.property('${NPC_HIDDEN_PROPERTY}')` }],
			},
		},
	});
	writeJson(`${OUT_RP}/${NPC_CLIENT_ENTITY_DIR}/npc.entity.json`, {
		format_version: "1.10.0",
		"minecraft:client_entity": {
			description: {
				identifier: NPC_ENTITY_ID,
				materials: { default: "entity_alphatest" },
				textures: Object.fromEntries(skins.map((s, i) => [`t${i}`, s.textureRef])),
				geometry: Object.fromEntries(skins.map((s, i) => [`g${i}`, s.geometryId])),
				animations: animMap,
				scripts: {
					// NPCEntity.renderScale × hitboxScale (o script grava o produto na propriedade).
					scale: `q.property('${NPC_RENDER_SCALE_PROPERTY}')`,
					initialize: ["v.cobblemon_npc_blink_at = math.random(3, 6);"],
					// Variáveis que as animações do Cobblemon esperam (MoLangFunctions do cliente Java).
					pre_animation: [
						"v.age_in_ticks = q.life_time * 20;",
						"v.limb_swing = q.modified_distance_moved;",
						"v.limb_swing_amount = math.min(q.modified_move_speed, 1);",
					],
					animate: ["ctrl_pose", "ctrl_blink"],
				},
				render_controllers: [rcId],
			},
		},
	});

	// 5. Entidade do servidor. Os behaviours do Cobblemon (data/cobblemon/behaviours) viram grupos de componentes que o
	// script liga/desliga por evento (scripts/npc/Behaviours.ts): sem nenhum, o NPC fica parado e não olha para
	// ninguém, como o NPC "standard" do 1.8.2 (só o behaviour automático npc_core). A caixa de colisão configurável
	// (NPCClass.hitbox, npc_scale_configuration) vira um grupo por tamanho em passos de 0,2 bloco.
	const skinMax = Math.max(1, skins.length - 1);
	const groups: Record<string, unknown> = { "cobblemon:despawn": { "minecraft:instant_despawn": {} } };
	const events: Record<string, unknown> = {
		"cobblemon:npc_interacted": {},
		"cobblemon:instant_kill": { add: { component_groups: ["cobblemon:despawn"] } },
	};
	for (const [name, components] of Object.entries(NPC_BEHAVIOUR_GROUPS)) {
		const group = `cobblemon:npc_b_${name}`;
		groups[group] = components;
		events[`cobblemon:npc_b_${name}_on`] = { add: { component_groups: [group] } };
		events[`cobblemon:npc_b_${name}_off`] = { remove: { component_groups: [group] } };
	}
	const hitboxGroups: string[] = [];
	for (const w of NPC_HITBOX_WIDTHS) for (const h of NPC_HITBOX_HEIGHTS) {
		const key = npcHitboxKey(w, h);
		const group = `cobblemon:npc_hitbox_${key}`;
		hitboxGroups.push(group);
		groups[group] = { "minecraft:collision_box": { width: w, height: h } };
		events[`cobblemon:npc_hitbox_${key}`] = { add: { component_groups: [group] } };
	}
	events["cobblemon:npc_hitbox_reset"] = { remove: { component_groups: hitboxGroups } };
	// Frente dados-ia: NPCClass/NPCEntity isMovable (isPushable), isLeashable (canBeLeashed) e allowProjectileHits
	// (canBeHitByProjectile). Empurrável troca de grupo (o componente fica sempre presente); a guia é um grupo
	// opcional; projéteis passam a não ferir com cobblemon:projectile_hits = false (o Bedrock não deixa o projétil
	// atravessar a entidade: ele para nela sem dano).
	groups["cobblemon:npc_pushable"] = { "minecraft:pushable": { is_pushable: true, is_pushable_by_piston: true } };
	groups["cobblemon:npc_not_pushable"] = { "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: true } };
	groups["cobblemon:npc_leashable"] = { "minecraft:leashable": {} };
	events["cobblemon:npc_set_movable"] = { remove: { component_groups: ["cobblemon:npc_not_pushable"] }, add: { component_groups: ["cobblemon:npc_pushable"] } };
	events["cobblemon:npc_set_immovable"] = { remove: { component_groups: ["cobblemon:npc_pushable"] }, add: { component_groups: ["cobblemon:npc_not_pushable"] } };
	events["cobblemon:npc_set_leashable"] = { add: { component_groups: ["cobblemon:npc_leashable"] } };
	events["cobblemon:npc_set_unleashable"] = { remove: { component_groups: ["cobblemon:npc_leashable"] } };
	// Em batalha o NPC fica parado (sem passear, fugir ou brigar); no fim o script reaplica os behaviours.
	// Boiar fica: um NPC batalhando na água não pode se afogar.
	events["cobblemon:battle_start"] = { remove: { component_groups: Object.keys(NPC_BEHAVIOUR_GROUPS).filter((name) => !/float/.test(name)).map((name) => `cobblemon:npc_b_${name}`) } };
	events["cobblemon:battle_end"] = {};
	// Frente limites-a: assento da entidade de exibição do modelo de Pokémon (scripts/npc/PokemonModel.ts). Família
	// "pokemon" (a exibição é a entidade da espécie), sem puxar ninguém: só o script monta (addRider). Sem trava de
	// rotação: o script gira a exibição para onde o NPC olha.
	groups[NPC_MODEL_SEAT_GROUP] = {
		"minecraft:rideable": {
			seat_count: 1,
			family_types: ["pokemon"],
			interact_text: "",
			pull_in_entities: false,
			rider_can_interact: false,
			seats: [{ position: [0, 0, 0] }],
		},
	};
	events["cobblemon:npc_model_seat_on"] = { add: { component_groups: [NPC_MODEL_SEAT_GROUP] } };
	events["cobblemon:npc_model_seat_off"] = { remove: { component_groups: [NPC_MODEL_SEAT_GROUP] } };
	// Tamanho do jogador ao nascer (antes do script aplicar a classe).
	// Frente dados-ia: nasce empurrável e com guia (padrões do NPCClass); o script aplica a classe logo depois.
	events["minecraft:entity_spawned"] = { add: { component_groups: [`cobblemon:npc_hitbox_${npcHitboxKey(0.6, 1.8)}`, "cobblemon:npc_pushable", "cobblemon:npc_leashable"] } };
	writeJson(`${OUT_BP}/${NPC_SERVER_ENTITY_DIR}/npc.json`, {
		format_version: "1.21.90",
		"minecraft:entity": {
			description: {
				identifier: NPC_ENTITY_ID,
				is_spawnable: false,
				is_summonable: true,
				properties: {
					[NPC_SKIN_PROPERTY]: { type: "int", range: [0, skinMax], default: 0, client_sync: true },
					// default em string: JSON.stringify escreveria 1 (int) e o Bedrock rejeita.
					[NPC_RENDER_SCALE_PROPERTY]: { type: "float", range: [0.05, 16.5], default: "1.0", client_sync: true },
					"cobblemon:in_battle": { type: "bool", default: false, client_sync: true },
					// NPCClass.isInvulnerable (padrão false, como no Cobblemon); o script liga pela classe do NPC.
					"cobblemon:invulnerable": { type: "bool", default: false },
					// Frente dados-ia: NPCClass.allowProjectileHits (padrão true); o script grava pela classe/preset/NPC.
					"cobblemon:projectile_hits": { type: "bool", default: true },
					// Frente limites-a: modelo do NPC escondido (modelo de Pokémon ou NPC escondido por jogador).
					[NPC_HIDDEN_PROPERTY]: { type: "bool", default: false, client_sync: true },
				},
			},
			component_groups: groups,
			components: {
				"minecraft:type_family": { family: ["cobblemon_npc", "npc_trainer", "mob"] },
				"minecraft:health": { value: 20, max: 20 },
				"minecraft:physics": {},
				// isMovable: valor da base = não empurrável; os grupos cobblemon:npc_pushable/_not_pushable (frente dados-ia)
				// trocam pela classe (padrão do Cobblemon: empurrável).
				"minecraft:pushable": { is_pushable: false, is_pushable_by_piston: true },
				"minecraft:knockback_resistance": { value: 1 },
				"minecraft:nameable": { always_show: true, allow_name_tag_renaming: false },
				"minecraft:persistent": {},
				"minecraft:breathable": { total_supply: 15, suffocate_time: 0 },
				// Anda só quando um behaviour pede (wanders, fights_melee, uses_healing_machine...).
				"minecraft:movement": { value: 0.5 },
				"minecraft:movement.basic": {},
				"minecraft:navigation.walk": { can_path_over_water: false, avoid_water: true, can_open_doors: true, can_pass_doors: true },
				"minecraft:jump.static": {},
				"minecraft:can_climb": {},
				// NPCEntity.isInvulnerableTo: o NPC leva dano normalmente (Cobblemon: isInvulnerable = false por padrão);
				// com `cobblemon:invulnerable` (NPCClass.isInvulnerable) só o vazio e /kill ferem. O golpe é registrado
				// pelo script via entityHitEntity para q.npc.was_hurt_by.
				"minecraft:damage_sensor": {
					triggers: [
						{ cause: "void", deals_damage: "yes" },
						{ cause: "self_destruct", deals_damage: "yes" },
						{ on_damage: { filters: { test: "bool_property", domain: "cobblemon:invulnerable" } }, deals_damage: "no" },
						// Frente dados-ia: allowProjectileHits = false.
						{ cause: "projectile", on_damage: { filters: { test: "bool_property", domain: "cobblemon:projectile_hits", value: false } }, deals_damage: "no" },
					],
				},
				"minecraft:interact": {
					interactions: [{ interact_text: "cobblemon.ui.interact", on_interact: { event: "cobblemon:npc_interacted", target: "self" } }],
				},
			},
			events,
		},
	});

	// 6. Dados para os scripts.
	const classes = readDir(`${NPC_DATA}/npcs`, ".json");
	const presets = readDir(`${NPC_DATA}/npc_presets`, ".json");
	const dialogues = readDir(`${NPC_DATA}/dialogues`, ".json");
	const scripts: Record<string, string> = {};
	// CobblemonScripts: id = namespace + nome do arquivo sem pastas ("cobblemon:run_callback_dialogue"); molang/client fica de fora.
	for (const [id, text] of Object.entries(readDir(`${NPC_DATA}/molang`, ".molang"))) {
		if (id.startsWith("cobblemon:client/")) continue;
		scripts[`cobblemon:${id.slice(id.lastIndexOf("/") + 1).replace(/^cobblemon:/, "")}`] = text;
	}
	const callbacks = readDir(`${NPC_DATA}/callbacks`, ".molang");
	// Behaviours que um NPC pode ter (fora os de Pokémon), com os automáticos em npc/auto.
	const behaviours: Record<string, string> = {};
	for (const [id, text] of Object.entries(readDir(`${NPC_DATA}/behaviours`, ".json"))) {
		if (id.startsWith("cobblemon:pokemon/")) continue;
		const json = JSON.parse(text);
		if (json.entityType && json.entityType !== NPC_ENTITY_ID) continue;
		// Id do Cobblemon: pasta incluída ("cobblemon:npc/chatter_npc"); os de npc/auto são automáticos.
		behaviours[id] = JSON.stringify({ ...json, auto: id.includes("/auto/") });
	}
	const partyPools = readDir(`${NPC_DATA}/party_pools`, ".json");
	const partyCompositions = readDir(`${NPC_DATA}/party_compositions`, ".json");
	const lang: Record<string, Record<string, string>> = {};
	for (const [bedrock, cobblemon] of [["en_US", "en_us"], ["pt_BR", "pt_br"]]) {
		const data: Record<string, string> = tryReadJson(`${ASSETS}/lang/${cobblemon}.json`) ?? {};
		for (const [k, v] of Object.entries(data)) if (k.startsWith("npc.") && typeof v === "string") (lang[k] ??= {})[bedrock] = v;
	}
	const skinsOut = skins.map((s) => ({ model: s.model, texture: s.texture }));
	const obj = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
	writeText(
		`${OUT_SCRIPTS}/npcs.ts`,
		`${HEADER}
/** Skins do NPC: índice = valor da propriedade ${NPC_SKIN_PROPERTY}. */
export const NPC_SKINS: Array<{ model: string; texture: string }> = ${JSON.stringify(skinsOut)};

/** Resolvers de variação (bedrock/npcs/variations), por resourceIdentifier, ordenados por "order". */
export const NPC_RESOLVERS: Record<string, Array<{ order: number; variations: Array<{ aspects: string[]; model?: string; texture?: string }> }>> = ${JSON.stringify(resolvers)};

/** Animações one-shot do NPC (win, lose, send_out, recall, command...) → id do Bedrock. */
export const NPC_ANIMATIONS: Record<string, string> = ${JSON.stringify(Object.fromEntries(Object.entries(animMap).filter(([k]) => !k.startsWith("ctrl_"))))};

/** Classes de NPC (data/cobblemon/npcs), JSON em string. */
export const NPC_CLASSES: Record<string, string> = {
${obj(classes)}
};

/** Presets de NPC (data/cobblemon/npc_presets), JSON em string. */
export const NPC_PRESETS: Record<string, string> = {
${obj(presets)}
};

/** Diálogos (data/cobblemon/dialogues), JSON em string. */
export const DIALOGUES: Record<string, string> = {
${obj(dialogues)}
};

/** Scripts Molang (data/cobblemon/molang), por id de CobblemonScripts ("cobblemon:instant_battle_interaction"). */
export const MOLANG_SCRIPTS: Record<string, string> = {
${obj(scripts)}
};

/** Callbacks Molang (data/cobblemon/callbacks), por id ("cobblemon:battle_victory/npc_battle_end_scripts"). */
export const MOLANG_CALLBACKS: Record<string, string> = {
${obj(callbacks)}
};

/** Behaviours de NPC (data/cobblemon/behaviours, sem os de Pokémon), JSON em string; "auto" = aplicado a todo NPC. */
export const NPC_BEHAVIOURS: Record<string, string> = {
${obj(behaviours)}
};

/** Grupos de componentes de behaviour na entidade (evento cobblemon:npc_b_<nome>_on/_off). */
export const NPC_BEHAVIOUR_GROUP_NAMES: string[] = ${JSON.stringify(Object.keys(NPC_BEHAVIOUR_GROUPS))};

/** Larguras/alturas de caixa de colisão com grupo na entidade (evento cobblemon:npc_hitbox_w<W>_h<H>, em décimos). */
export const NPC_HITBOX_WIDTHS: number[] = ${JSON.stringify(NPC_HITBOX_WIDTHS)};
export const NPC_HITBOX_HEIGHTS: number[] = ${JSON.stringify(NPC_HITBOX_HEIGHTS)};

/** Pools e composições de time (data/cobblemon/party_pools e party_compositions; o 1.8.2 não traz nenhum). */
export const PARTY_POOLS: Record<string, string> = {
${obj(partyPools)}
};
export const PARTY_COMPOSITIONS: Record<string, string> = {
${obj(partyCompositions)}
};

/** Textos "npc.*" do Cobblemon (nomes de NPC) por idioma: nameTag não traduz, então o script escolhe. */
export const NPC_LANG: Record<string, Record<string, string>> = ${JSON.stringify(lang)};
`,
	);

	const stats = {
		skins: skins.length,
		classes: Object.keys(classes).length,
		presets: Object.keys(presets).length,
		dialogues: Object.keys(dialogues).length,
		scripts: Object.keys(scripts).length + Object.keys(callbacks).length,
	};
	count("NPC: skins", stats.skins);
	count("NPC: classes", stats.classes);
	count("NPC: diálogos", stats.dialogues);
	return stats;
}
