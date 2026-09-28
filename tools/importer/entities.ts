// Client entity, render controllers (RP) e entidade de servidor (BP) de cada espécie, e o módulo
// generated/scripts/entityData.ts (tamanhos, ombro, montaria e interações usados por scripts/entity).
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Movement } from "./species.ts";
import type { PoserOutput } from "./posers.ts";
import { flipbookChannel } from "./animatedTextures.ts";
import type { ChannelFrames } from "./animatedTextures.ts";
import { RidingMolang } from "./molang.ts";
import { DATA, OUT_BP, OUT_RP, OUT_SCRIPTS, count, splitId, tryReadJson, walk, warn, writeJson, writeText } from "./util.ts";
import { bedrockVanillaItem } from "./vanilla.ts";
import { heldItemAnchorAnimation, speciesBehaviours } from "./mundoDetalhes.ts"; // frente mundo-detalhes
import { CONTEXTS, aiComponents, extraComponents, pointsToSpawn, resolvePokemonAi } from "./pokemonBehaviours.ts"; // frente dados-ia
import { ASPECTS_PROPERTY, aspectBitLines, aspectsPropertyRange, recordSpeciesAi, scrollingUvAnim } from "./dadosIa.ts"; // frente dados-ia
import { alphaEyesAnimations, emitAlphaEyes } from "./visualFinal.ts"; // frente visual-final
import { walkMovementValue } from "../../scripts/entity/RideSprint.ts"; // review-fixes rodada 2: andar montado
import { DYNAMAX_GROW_SECONDS, DYNAMAX_SCALE_FACTOR, GIMMICK_DYNAMAX, GIMMICK_MAX, GIMMICK_PROPERTY, gimmickTints } from "../../scripts/entity/GimmickProperty.ts"; // frente msd-fase1
import { TYPE_HUES } from "../../scripts/GUI/layoutSpec.ts"; // frente msd-fase1: cor do tipo (ElementalType.hue) na tinta Tera
import { POKEMON_MATERIALS } from "./zfightEntities.ts"; // frente zfight2: materiais das client entities de Pokémon

export interface ComboOut {
	poser: string;
	geometryKey: string;
	textureKey: string;
	/** Textura base animada (flipbook): chaves dos quadros. */
	textureFrames?: ChannelFrames;
	/** `name` = nome da camada no resolver (frente visual-final: `alpha_eyes`). */
	layers: Array<{ channel: string; textureKey: string; frames?: ChannelFrames; name?: string; scrolling?: { speedU: number; speedV: number } }>;
}

export interface Channel {
	key: string;
	name: string;
	emissive: boolean;
	translucent: boolean;
}

export interface SpeciesRender {
	id: string;
	geometries: Map<string, string>;
	textures: Map<string, string>;
	combos: ComboOut[];
	channels: Channel[];
	posers: PoserOutput[];
	movement: Movement;
	soundEffects: Map<string, string>;
	particleEffects: Map<string, string>;
	/** Frente dados-ia: aspects lidos por q.has_aspect nos posers (bit i de cobblemon:aspects). */
	aspectBits?: string[];
}

const VARIANT = "q.property('cobblemon:variant')";

/**
 * Tinta vermelha do feixe de captura/recolha (PokemonRenderer.renderTransition, beamMode 3): depois de
 * BEAM_EXTEND_TIME (0,2 s) verde e azul do modelo caem para 1 − min(0,6; (s − 0,2) / BEAM_SHRINK_TIME) e ficam em 0,4.
 * Os scripts ligam `cobblemon:beam_tint` quando o feixe começa (scripts/pokemon/BeamTint.ts); o cliente conta o tempo
 * em `v.cobblemon_beam_t`. O `overlay_color` (1, 0, 0, a) mistura o vermelho com a textura: verde e azul ficam
 * exatamente × (1 − a), o vermelho clareia um pouco (o Bedrock não multiplica cor em entity_alphatest).
 * BEAM_TINT_MAX_SECONDS é só uma trava: o feixe visível dura no máximo 1,5 s (captura), e uma propriedade presa
 * (servidor fechado no meio da captura) não deixa o Pokémon vermelho para sempre.
 */
export const BEAM_TINT_PROPERTY = "cobblemon:beam_tint";
export const BEAM_TINT_DELAY_SECONDS = 0.2;
export const BEAM_TINT_FADE_SECONDS = 0.4;
export const BEAM_TINT_MAX_ALPHA = 0.6;
export const BEAM_TINT_MAX_SECONDS = 3;

export function beamTintPreAnimation(): string[] {
	const t = "v.cobblemon_beam_t";
	return [
		`${t} = q.property('${BEAM_TINT_PROPERTY}') ? (${t} ?? 0) + q.delta_time : 0;`,
		`v.cobblemon_beam_tint = (${t} > ${BEAM_TINT_DELAY_SECONDS} && ${t} < ${BEAM_TINT_MAX_SECONDS}) ? math.min(${BEAM_TINT_MAX_ALPHA}, (${t} - ${BEAM_TINT_DELAY_SECONDS}) / ${BEAM_TINT_FADE_SECONDS}) : 0;`,
	];
}

/**
 * `overlay_color` de cada render controller; fora do feixe devolve `this` (mantém o flash de dano do motor).
 * Frente msd-fase1: sem o feixe, a tinta do gimmick (Tera pelo tipo, Dynamax vermelho; `v.cobblemon_gimmick_*` do
 * controlador GIMMICK_TINT_CONTROLLER) vem antes do `this`. O feixe continua com prioridade.
 */
export function beamTintOverlay(): Record<"r" | "g" | "b" | "a", string> {
	const on = "v.cobblemon_beam_tint > 0";
	const gimmick = `(v.cobblemon_gimmick_a > 0 && v.cobblemon_beam_tint <= 0)`;
	return {
		r: `${on} ? 1.0 : (v.cobblemon_gimmick_a > 0 ? v.cobblemon_gimmick_r : this)`,
		g: `${gimmick} ? v.cobblemon_gimmick_g : (${on} ? 0.0 : this)`,
		b: `${gimmick} ? v.cobblemon_gimmick_b : (${on} ? 0.0 : this)`,
		a: `${gimmick} ? v.cobblemon_gimmick_a : (${on} ? v.cobblemon_beam_tint : this)`,
	};
}

// ---------------------------------------------------------------------------------------------
// Frente msd-fase1: gimmick de batalha no visual (propriedade `cobblemon:gimmick`, scripts/entity/GimmickProperty.ts)

/** Controlador de animação (RP) que põe a cor do gimmick em `v.cobblemon_gimmick_r/g/b/a` ao mudar a propriedade. */
export const GIMMICK_TINT_CONTROLLER = "controller.animation.cobblemon.gimmick_tint";

/**
 * Escala visual: a do Pokémon × Dynamax (até DYNAMAX_SCALE_FACTOR em DYNAMAX_GROW_SECONDS, como o MaxGimmick do MSD;
 * `v.cobblemon_dmax` vai de 0 a 1 no pre_animation). Só o visual: a hitbox fica no grupo de tamanho.
 */
export const POKEMON_SCALE_MOLANG = `q.property('cobblemon:scale_modifier') * (1.0 + ${(DYNAMAX_SCALE_FACTOR - 1).toFixed(1)} * v.cobblemon_dmax)`;

export function gimmickPreAnimation(): string[] {
	const grow = `(q.property('${GIMMICK_PROPERTY}') >= ${GIMMICK_DYNAMAX} ? q.delta_time : -q.delta_time) / ${DYNAMAX_GROW_SECONDS.toFixed(1)}`;
	return [
		`v.cobblemon_dmax = math.clamp((v.cobblemon_dmax ?? 0) + ${grow}, 0, 1);`,
		// Frente cliente-teste3-log: a cor do gimmick vem do on_entry de GIMMICK_TINT_CONTROLLER, mas o overlay_color dos
		// render controllers foi avaliado antes dele (31 mil "unknown variable 'variable.cobblemon_gimmick_a'" no 3º teste,
		// spinda/tentacool/bunnelby...). O `??` mantém a cor que o controller gravou.
		"v.cobblemon_gimmick_a = v.cobblemon_gimmick_a ?? 0; v.cobblemon_gimmick_r = v.cobblemon_gimmick_r ?? 0; v.cobblemon_gimmick_g = v.cobblemon_gimmick_g ?? 0; v.cobblemon_gimmick_b = v.cobblemon_gimmick_b ?? 0;",
	];
}

const channel = (rgb: number, shift: number) => (((rgb >> shift) & 255) / 255).toFixed(3);

/** Um estado por valor 1..GIMMICK_MAX (cor em on_entry) e o `default` sem tinta. */
export function gimmickTintController(): Record<string, unknown> {
	const property = `q.property('${GIMMICK_PROPERTY}')`;
	const tints = gimmickTints(TYPE_HUES);
	const states: Record<string, unknown> = {
		default: {
			on_entry: ["v.cobblemon_gimmick_a = 0.0;"],
			transitions: [...tints.keys()].map((value) => ({ [`g${value}`]: `${property} == ${value}` })),
		},
	};
	for (const [value, tint] of tints) {
		states[`g${value}`] = {
			on_entry: [`v.cobblemon_gimmick_r = ${channel(tint.rgb, 16)}; v.cobblemon_gimmick_g = ${channel(tint.rgb, 8)}; v.cobblemon_gimmick_b = ${channel(tint.rgb, 0)}; v.cobblemon_gimmick_a = ${tint.alpha.toFixed(2)};`],
			transitions: [{ default: `${property} != ${value}` }],
		};
	}
	return { format_version: "1.10.0", animation_controllers: { [GIMMICK_TINT_CONTROLLER]: { initial_state: "default", states } } };
}

let gimmickControllerWritten = false;
function emitGimmickTintController(): void {
	if (gimmickControllerWritten) return;
	gimmickControllerWritten = true;
	writeJson(`${OUT_RP}/animation_controllers/pokemon/cobblemon_gimmick_tint.animation_controllers.json`, gimmickTintController());
}

/** Condição "variant ∈ índices" curta (usa negação quando é mais curta). */
function variantCondition(indices: number[], total: number): string | undefined {
	if (indices.length === total) return undefined;
	const others = [...Array(total).keys()].filter((i) => !indices.includes(i));
	if (others.length < indices.length) return `!(${others.map((i) => `v.cobblemon_variant == ${i}`).join(" || ")})`;
	return indices.map((i) => `v.cobblemon_variant == ${i}`).join(" || ");
}

export function emitClientEntity(s: SpeciesRender): void {
	const total = s.combos.length;
	const rcBase = `controller.render.cobblemon.pokemon.${s.id}`;
	// Texturas animadas (flipbook): array combos × quadros + índice por Molang (animatedTextures.ts).
	const texPre: string[] = [];
	const baseTex = flipbookChannel(s.combos.map((c) => c.textureFrames ?? { keys: [c.textureKey], fps: 10, loop: true }), VARIANT, "v.cobblemon_tex_f_base");
	texPre.push(...baseTex.preAnimation);
	const renderControllers: Record<string, any> = {
		[rcBase]: {
			arrays: {
				geometries: { "Array.geo": s.combos.map((c) => `Geometry.${c.geometryKey}`) },
				textures: { "Array.tex": baseTex.array },
			},
			geometry: `Array.geo[${VARIANT}]`,
			materials: [{ "*": "Material.default" }],
			textures: [baseTex.index],
			overlay_color: beamTintOverlay(),
		},
	};
	const rcList: any[] = [rcBase];
	s.channels.forEach((ch, i) => {
		const id = `${rcBase}.layer${i}`;
		const present: number[] = [];
		const frames: ChannelFrames[] = s.combos.map((c, ci) => {
			const layer = c.layers.find((l) => l.channel === ch.key);
			if (layer) present.push(ci);
			return layer ? layer.frames ?? { keys: [layer.textureKey], fps: 10, loop: true } : { keys: ["blank"], fps: 10, loop: true };
		});
		const tex = flipbookChannel(frames, VARIANT, `v.cobblemon_tex_f_${i}`);
		for (const l of tex.preAnimation) if (!texPre.includes(l)) texPre.push(l);
		const rc: any = {
			arrays: {
				geometries: { "Array.geo": s.combos.map((c) => `Geometry.${c.geometryKey}`) },
				textures: { "Array.tex": tex.array },
			},
			geometry: `Array.geo[${VARIANT}]`,
			materials: [{ "*": ch.translucent ? "Material.layer_translucent" : "Material.layer" }],
			textures: [tex.index],
			// Tinta do feixe também nas camadas (o PosableModel desenha as camadas com o mesmo red/green/blue).
			overlay_color: beamTintOverlay(),
		};
		// Camada emissiva: brilho próprio, sem depender da luz do ambiente.
		if (ch.emissive) rc.ignore_lighting = true;
		// Frente dados-ia: camada com "scrolling" (PosableModel.getScrollingLayer) → uv_anim por variante.
		const uvAnim = scrollingUvAnim(s.combos.map((c) => c.layers.find((l) => l.channel === ch.key)?.scrolling));
		if (uvAnim) rc.uv_anim = uvAnim;
		renderControllers[id] = rc;
		// Condição curta vira filtro; lista longa sai mais barata desenhando a textura transparente (blank).
		const cond = variantCondition(present, total);
		rcList.push(cond && cond.split("||").length <= 6 ? { [id]: cond } : id);
	});
	writeJson(`${OUT_RP}/render_controllers/pokemon/${s.id}.render_controllers.json`, { format_version: "1.10.0", render_controllers: renderControllers });

	const animations: Record<string, string> = {};
	const animate: any[] = [];
	const initialize: string[] = [];
	const m = s.movement;
	const pre: string[] = [
		`v.cobblemon_variant = ${VARIANT};`,
		"v.cobblemon_in_battle = q.property('cobblemon:in_battle');",
		"v.cobblemon_sleeping = q.property('cobblemon:sleeping');",
		"v.cobblemon_moving = q.ground_speed > 0.3 || q.modified_move_speed > 0.1;",
		`v.cobblemon_submerged = ${m.canBreatheUnderwater ? "q.is_in_water" : "0.0"};`,
		`v.cobblemon_flying = ${m.canFly ? "!q.is_on_ground && !q.is_in_water" : "0.0"};`,
		"v.cobblemon_pose_type = v.cobblemon_sleeping ? 2 : (v.cobblemon_submerged ? (v.cobblemon_moving ? 4 : 3) : (v.cobblemon_flying ? (v.cobblemon_moving ? 5 : 6) : (v.cobblemon_moving ? 1 : 0)));",
	];
	// Estilo de montaria no cliente (q.riding_style do Cobblemon): 0 nenhum, 1 terra, 2 ar (fora do chão por mais
	// de 0,4 s, só em quem voa montado), 3 água. Sem propriedade sincronizada; ver molang.ts/RIDE_STYLE_CODE.
	const rideGroups = entityInfoFor(s.id)?.rideGroups ?? [];
	const canAir = rideGroups.includes("AIR");
	if (canAir) pre.push("v.cobblemon_air_t = q.is_on_ground ? 0 : (v.cobblemon_air_t ?? 0) + q.delta_time;");
	pre.push(`v.cobblemon_ride_style = q.has_rider ? (q.is_in_water ? 3 : ${canAir ? "(v.cobblemon_air_t > 0.4 ? 2 : 1)" : "1"}) : 0;`);
	// Estado procedural dos posers (pitch_tilt) e molas da montaria (q.r.*), sem repetir linhas.
	const riding = new Set<string>();
	for (const p of s.posers) {
		for (const l of p.preAnimation) if (!pre.includes(l)) pre.push(l);
		for (const e of p.effects) for (const u of e.riding) riding.add(u);
	}
	pre.push(...RidingMolang.preAnimation(riding));
	pre.push(...texPre);
	// Frente dados-ia: q.has_aspect dos posers (v.cobblemon_aspect_<nome>) a partir de cobblemon:aspects.
	pre.push(...aspectBitLines(s.aspectBits ?? []));
	// Tinta vermelha do feixe (beamMode 3), lida pelo overlay_color dos render controllers.
	pre.push(...beamTintPreAnimation());
	// Frente msd-fase1: crescimento do Dynamax (escala) e tinta do gimmick (controlador compartilhado).
	pre.push(...gimmickPreAnimation());
	emitGimmickTintController();
	animations["cobblemon_gimmick_tint"] = GIMMICK_TINT_CONTROLLER;
	animate.push("cobblemon_gimmick_tint");
	for (const p of s.posers) {
		for (const [short, id] of p.animations) animations[short] = id;
		for (const c of p.controllers) animations[c.replace(/^controller\.animation\./, "ctrl.")] = c;
		pre.push(`${p.poseVar} = ${p.poseExpr};`);
		initialize.push(...p.initialize);
		const indices = s.combos.flatMap((c, i) => (c.poser === p.name ? [i] : []));
		const cond = variantCondition(indices, total);
		for (const c of p.controllers) {
			const short = c.replace(/^controller\.animation\./, "ctrl.");
			animate.push(cond ? { [short]: cond } : short);
		}
	}
	// Rolagem visual no voo montado (frente motor: scripts/entity/Riding.ts grava cobblemon:roll no BP, que só
	// existe em quem voa montado). Gira o osso root_part (models.ts) no eixo da frente.
	if (canAir) {
		const rollId = `animation.cobblemon_gen.${s.id}.ride_roll`;
		writeJson(`${OUT_RP}/animations/pokemon/_generated/${s.id}_ride.animation.json`, {
			format_version: "1.8.0",
			animations: { [rollId]: { loop: true, bones: { root_part: { rotation: [0, 0, "q.has_rider ? q.property('cobblemon:roll') : 0"] } } } },
		});
		animations["cobblemon_ride_roll"] = rollId;
		animate.push("cobblemon_ride_roll");
	}
	// Frente mundo-detalhes: âncoras dos locators item/item_hat/item_face (vestíveis no Pokémon).
	const anchor = heldItemAnchorAnimation(s.id, s.combos.map((c) => s.geometries.get(c.geometryKey) ?? ""));
	if (anchor) {
		animations[anchor[0]] = anchor[1];
		animate.push(anchor[0]);
	}
	// Frente visual-final: partícula alpha_eyes nos locators de olho das variantes com a camada `alpha_eyes`.
	const info = entityInfoFor(s.id);
	const eyes = alphaEyesAnimations(
		s.id,
		s.combos.map((c) => ({ geometryId: s.geometries.get(c.geometryKey) ?? "", alpha: c.layers.some((l) => l.name === "alpha_eyes") })),
		info?.sizes[info.sizeAlpha[""] ?? 0],
	);
	if (eyes) {
		emitAlphaEyes(s.id, eyes);
		s.particleEffects.set(eyes.particle[0], eyes.particle[1]);
		for (const a of eyes.animations) {
			animations[a.key] = a.id;
			const cond = variantCondition(a.variants, total);
			animate.push(cond ? { [a.key]: cond } : a.key);
		}
	}
	// Animações nomeadas (cry, recoil, physical...) do poser principal também pelo nome curto.
	const main = s.posers.find((p) => p.name === s.combos[0]?.poser) ?? s.posers[0];
	for (const p of [main, ...s.posers.filter((x) => x !== main)]) {
		for (const [name, id] of Object.entries(p.named)) animations[name] ??= id;
	}

	const description: any = {
		identifier: `cobblemon:${s.id}`,
		// Frente zfight2: base de um lado (= entityCutout do Java) e camadas que passam no empate de profundidade com a
		// base (zfightEntities.ts; materials/entity.material gerado no index.ts).
		materials: { ...POKEMON_MATERIALS },
		textures: { ...Object.fromEntries(s.textures), ...(s.channels.length ? { blank: "textures/blank" } : {}) },
		geometry: Object.fromEntries(s.geometries),
		animations,
		// Escala visual por Pokémon (multiplica a do minecraft:scale do grupo de tamanho).
		scripts: { initialize: initialize.length ? initialize : undefined, scale: POKEMON_SCALE_MOLANG, pre_animation: pre, animate },
		render_controllers: rcList,
	};
	if (!description.scripts.initialize) delete description.scripts.initialize;
	if (s.soundEffects.size) description.sound_effects = Object.fromEntries(s.soundEffects);
	if (s.particleEffects.size) description.particle_effects = Object.fromEntries(s.particleEffects);
	writeJson(`${OUT_RP}/entity/pokemon/${s.id}.entity.json`, { format_version: "1.10.0", "minecraft:client_entity": { description } });
}

// ---------------------------------------------------------------------------------------------
// Entidade de servidor (BP)
//
// Mapeia `behaviour`, `riding`, `shoulderMountable`, `hitbox`/`baseScale` (espécie e formas) do
// Cobblemon 1.8.2 para componentes estáveis do Bedrock 26.x. Regra usada em todo o arquivo: um
// componente que muda de valor por estado fica na base (valor inicial) E em grupos que são sempre
// TROCADOS no mesmo evento (remove um, adiciona o outro), como o vanilla faz (drowned, villager_v2).
// Remover um grupo que sobrescreve um componente da base sem pôr outro no lugar deixa a entidade sem
// o componente.

/** Entrada do gerador. `data` é o JSON completo da espécie; `modelFile` é a geometria padrão (assentos). */
export interface ServerEntityInput {
	id: string;
	variants: number;
	hitbox: { width: number; height: number };
	baseScale: number;
	movement: Movement;
	data?: any;
	modelFile?: string;
	/** Frente dados-ia: aspects sincronizados ao cliente (propriedade cobblemon:aspects, bit i = aspectBits[i]). */
	aspectBits?: string[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Comportamento de IA com os padrões das classes do Cobblemon (CombatBehaviour, RestBehaviour, MoveBehaviour...). */
export interface BehaviourInfo {
	canSleep: boolean;
	willSleepOnBed: boolean;
	willDefendSelf: boolean;
	willFlee: boolean;
	willDefendOwner: boolean;
	fightsMelee: boolean;
	wanderChance: number;
	wanderSpeed: number;
	canSwimInLava: boolean;
	canWalkOnLava: boolean;
	canBreatheUnderlava: boolean;
	/** Espécies (ids) que esta aceita como líder de herd (HerdBehaviour.toleratedLeaders). */
	toleratedLeaders: string[];
	/** Tem o comportamento cobblemon:pokemon_eats_grass (campo `ai` da espécie). */
	eatsGrass: boolean;
	/** Tem a feature "sheared" (Wooloo, Dubwool, Mareep). */
	shearable: boolean;
}

export function behaviourOf(data: any): BehaviourInfo {
	const b = data?.behaviour ?? {};
	const combat = b.combat ?? {};
	const rest = b.resting ?? b.moving?.resting ?? {};
	const moving = b.moving ?? {};
	const swim = moving.swim ?? {};
	const leaders: string[] = [];
	for (const l of b.herd?.toleratedLeaders ?? []) {
		const species = String(l?.pokemon ?? "").trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (species && !leaders.includes(species)) leaders.push(species);
	}
	const ai: any[] = Array.isArray(data?.ai) ? data.ai : [];
	return {
		canSleep: rest.canSleep ?? false,
		willSleepOnBed: rest.willSleepOnBed ?? false,
		willDefendSelf: combat.willDefendSelf ?? false,
		willFlee: combat.willFlee ?? true,
		willDefendOwner: combat.willDefendOwner ?? false,
		fightsMelee: combat.fightsMelee ?? true,
		wanderChance: Math.max(1, Math.round(Number(moving.wanderChance ?? 120))),
		wanderSpeed: Number(moving.wanderSpeed ?? 1) || 1,
		canSwimInLava: swim.canSwimInLava ?? false,
		canWalkOnLava: swim.canWalkOnLava ?? false,
		canBreatheUnderlava: swim.canBreatheUnderlava ?? false,
		toleratedLeaders: leaders,
		eatsGrass: ai.some((c) => JSON.stringify(c).includes("pokemon_eats_grass")),
		shearable: Array.isArray(data?.features) && data.features.includes("sheared"),
	};
}

/**
 * Dano corpo a corpo (PokemonServerDelegate.attackToDamageCurve) com o Ataque de um Pokémon de nível 25,
 * IV 15, EV 0 e natureza neutra. O Bedrock não deixa o script mudar o dano do `minecraft:attack`, então
 * o valor por nível vira um valor fixo por espécie.
 */
export function meleeDamage(baseAttack: number): number {
	const level = 25;
	const attack = Math.floor(((2 * baseAttack + 15) * level) / 100) + 5;
	return attack < 10 ? 1 : Math.max(1, Math.ceil(Math.sqrt(Math.pow(attack - 10, 0.875))));
}

/** Pokemon.getAlphaScaleMultiplier (mesma fórmula de alphaScaleMultiplier em scripts/spawning). */
export function alphaMultiplier(hitbox: { width: number; height: number }, baseScale: number): number {
	const size = clamp(Math.max(hitbox.width, hitbox.height) * baseScale, 0.25, 5);
	return 1.1 + 0.8 * Math.pow(0.5, size);
}

// ------------------------------------------------------------------ tamanho por forma / Alfa

export interface SizeEntry {
	width: number;
	height: number;
	scale: number;
}

/** Tamanhos distintos da espécie: índice 0 = forma padrão. `forms[nome]` e `alpha[nome]` apontam para o índice. */
export interface SizeTable {
	sizes: SizeEntry[];
	forms: Record<string, number>;
	alpha: Record<string, number>;
}

export function sizeTable(data: any, fallbackHitbox: { width: number; height: number }, fallbackScale: number): SizeTable {
	const out: SizeTable = { sizes: [], forms: {}, alpha: {} };
	const index = (s: SizeEntry) => {
		const e = { width: round(Math.max(0.1, s.width)), height: round(Math.max(0.1, s.height)), scale: round(s.scale) };
		let i = out.sizes.findIndex((o) => o.width === e.width && o.height === e.height && o.scale === e.scale);
		if (i < 0) i = out.sizes.push(e) - 1;
		return i;
	};
	const baseHitbox = { width: data?.hitbox?.width ?? fallbackHitbox.width, height: data?.hitbox?.height ?? fallbackHitbox.height };
	const baseScale = data?.baseScale ?? fallbackScale;
	const add = (name: string, hitbox: { width: number; height: number }, scale: number) => {
		out.forms[name] = index({ ...hitbox, scale });
		out.alpha[name] = index({ ...hitbox, scale: scale * alphaMultiplier(hitbox, scale) });
	};
	add("", baseHitbox, baseScale);
	for (const f of data?.forms ?? []) {
		if (!f?.name || (f.hitbox === undefined && f.baseScale === undefined)) continue;
		add(String(f.name), { width: f.hitbox?.width ?? baseHitbox.width, height: f.hitbox?.height ?? baseHitbox.height }, f.baseScale ?? baseScale);
	}
	return out;
}

// ------------------------------------------------------------------ montaria (riding)

export type RideStyle = "LAND" | "AIR" | "LIQUID";

/** Estilo de montaria com os atributos já convertidos para o Bedrock (valores por espécie/forma). */
export interface RideStyleInfo {
	key: string;
	/** Atributos do Cobblemon (início da faixa `stats`, 0–100). */
	stats: Record<string, number>;
	/** Valor de `minecraft:movement` (ou `flying_speed`/`underwater_movement`) montado. */
	speed: number;
	/** `horse.jump_strength` (terra) ou velocidade vertical (ar). 0 = sem pulo. */
	jump: number;
	/** Segundos de fôlego (ar) antes de começar a planar; 0 = infinito. */
	stamina: number;
	/** Frente dados-ui: fim da faixa `stats` (máximo com ride boosts; RidingBehaviourSettings.calculate). */
	max: Record<string, number>;
	/** Frente dados-ui: `rideSounds` do estilo (RideSoundSettings), para os loops de montaria. */
	sounds: RideSoundOut[];
	/** Frente limites-a (#33): LAND do HorseBehaviour com canSprint — o script faz o sprint (duplo toque). */
	sprint?: boolean;
	/** Frente limites-a (#33): walkSpeed da espécie (Java, b/tick antes do atributo) para o andar sem sprint. */
	walkSpeed?: number;
}

/** RideSoundSettings: som em loop, a quem toca e as expressões MoLang de volume/tom. */
export interface RideSoundOut { sound: string; passengers: boolean; others: boolean; volume: string; pitch: string }

export interface RideInfo {
	seats: number;
	styles: Partial<Record<RideStyle, RideStyleInfo>>;
}

const STYLE_OF_KEY: Record<string, RideStyle> = {
	"cobblemon:land/horse": "LAND", "cobblemon:land/vehicle": "LAND", "cobblemon:land/minekart": "LAND",
	"cobblemon:air/bird": "AIR", "cobblemon:air/jet": "AIR", "cobblemon:air/hover": "AIR", "cobblemon:air/rocket": "AIR",
	"cobblemon:air/glider": "AIR", "cobblemon:air/helicopter": "AIR",
	"cobblemon:liquid/dolphin": "LIQUID", "cobblemon:liquid/submarine": "LIQUID", "cobblemon:liquid/boat": "LIQUID",
	"cobblemon:liquid/burst": "LIQUID",
};

/** "65-85" | {ranges: "10-20"} → início da faixa (o valor sem ride boosts). */
function statStart(v: unknown): number {
	const s = typeof v === "object" && v !== null ? (v as any).ranges : v;
	const m = /^\s*(\d+(?:\.\d+)?)/.exec(String(s ?? ""));
	return m ? clamp(Number(m[1]), 0, 100) : 0;
}

/** "65-85" | {ranges: "10-20"} → fim da faixa (máximo com ride boosts); sem faixa = o início. */
function statEnd(v: unknown): number {
	const s = typeof v === "object" && v !== null ? (v as any).ranges : v;
	const m = /^\s*(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?/.exec(String(s ?? ""));
	if (!m) return 0;
	return clamp(Number(m[2] ?? m[1]), 0, 100);
}

/** rideSounds do estilo (frente dados-ui). */
function rideSoundsOf(list: unknown): RideSoundOut[] {
	if (!Array.isArray(list)) return [];
	return list.filter((x: any) => x?.soundLocation).map((x: any) => ({
		sound: `cobblemon.${String(x.soundLocation).replace(/^cobblemon:/, "")}`,
		passengers: x.playForPassengers !== false,
		others: x.playForNonPassengers !== false,
		volume: String(x.volumeExpr ?? "1"),
		pitch: String(x.pitchExpr ?? "1"),
	}));
}

/**
 * Converte as expressões `q.get_ride_stats(stat, estilo, max, min)` dos ride_settings do Cobblemon em
 * valores de componente do Bedrock. Referências usadas (vanilla 26.x): cavalo `movement` 0.3375 ≈ 14,6 b/s
 * (b/s ≈ 43 × valor; medido no BDS do port: 0,027 → 1,2 b/s). Terra: a velocidade do HorseBehaviour é o
 * deslocamento por tick no regime (PokemonEntity.travel: deltaMovement → velocity), então b/tick × 20 / 43, sem
 * redutor; ghast feliz `flying_speed` 0.016 ≈ 3,2 b/s (b/s ≈ 200 × valor);
 * nautilus montado `underwater_movement` 0.055 (b/s ≈ 80 × valor).
 */
export function rideStyleInfo(style: RideStyle, key: string, rawStats: Record<string, unknown>, walkSpeed: number, settings: any): RideStyleInfo {
	const stats: Record<string, number> = {};
	const max: Record<string, number> = {};
	for (const k of ["SPEED", "ACCELERATION", "SKILL", "JUMP", "STAMINA"]) {
		stats[k] = statStart(rawStats?.[k]);
		max[k] = Math.max(stats[k], statEnd(rawStats?.[k]));
	}
	const sounds = rideSoundsOf(settings?.rideSounds);
	const lerp = (max: number, min: number, s: number) => min + ((max - min) / 100) * s;
	const bool = (v: unknown, def: boolean) => (v === undefined ? def : String(v) === "true");
	if (style === "LAND") {
		const canSprint = bool(settings?.canSprint, true);
		const canJump = bool(settings?.canJump, true);
		// HorseBehaviour: sprint até 0.1..1.2 b/tick; sem sprint anda no getWalkSpeed (walkSpeed × 0,7 × 0,42 b/tick).
		const top = lerp(1.2, 0.1, stats.SPEED);
		const speed = canSprint ? clamp((top * 20) / 43, 0.15, 0.45) : walkMovementValue(walkSpeed);
		const jump = canJump ? clamp(lerp(1.6, 0.2, stats.JUMP) * 0.625, 0.4, 1.0) : 0;
		// Frente limites-a (#33): só o HorseBehaviour tem sprint (handleSprinting); `speed` continua sendo o topo.
		const sprint = canSprint && key === "cobblemon:land/horse";
		return {
			key, stats, speed: round(speed), jump: round(jump), stamina: round(lerp(240, 4, stats.STAMINA)), max, sounds,
			...(sprint ? { sprint: true, walkSpeed: round(walkSpeed) } : {}),
		};
	}
	if (style === "AIR") {
		// BirdBehaviour: 4..20 b/s; jato/foguete mais rápidos (mesma faixa ×1.5).
		const fast = key.endsWith("/jet") || key.endsWith("/rocket");
		const bps = lerp(20, 4, stats.SPEED) * (fast ? 1.5 : 1);
		const glider = key.endsWith("/glider");
		return {
			key, stats,
			speed: round(clamp(bps / 200, 0.02, 0.15)),
			jump: glider ? 0 : 0.5,
			stamina: bool(settings?.infiniteStamina, false) ? 0 : round(Math.max(1, lerp(80, 0, stats.STAMINA))),
			max, sounds,
		};
	}
	// LIQUID: DolphinBehaviour 2..24 b/s.
	const bps = lerp(24, 2, stats.SPEED);
	return { key, stats, speed: round(clamp(bps / 80, 0.03, 0.25)), jump: 0, stamina: round(lerp(40, 2, stats.STAMINA)), max, sounds };
}

/** Montaria de uma espécie/forma (RidingProperties: `seats` + `behaviours`; o campo legado `behaviour` é ignorado, como no 1.8.2). */
export function rideInfoOf(riding: any, walkSpeed: number, rideSettings: Record<string, any>): RideInfo | undefined {
	const seats = Array.isArray(riding?.seats) ? riding.seats.length : 0;
	const behaviours = riding?.behaviours;
	if (!seats || !behaviours || typeof behaviours !== "object") return undefined;
	const styles: RideInfo["styles"] = {};
	for (const [styleName, settings] of Object.entries<any>(behaviours)) {
		const style = styleName.toUpperCase() as RideStyle;
		if (!["LAND", "AIR", "LIQUID"].includes(style) || !settings?.key) continue;
		const key = String(settings.key);
		if (key === "cobblemon:composite") continue;
		const global = rideSettings[key.replace(/^cobblemon:[a-z]+\//, "")] ?? {};
		styles[style] = rideStyleInfo(style, key, settings.stats ?? {}, walkSpeed, { ...global, ...settings });
	}
	return Object.keys(styles).length ? { seats, styles } : undefined;
}

let rideSettingsCache: Record<string, any> | undefined;
/** data/cobblemon/ride_settings/*.json (valores globais por controlador). */
export function loadRideSettings(): Record<string, any> {
	if (rideSettingsCache) return rideSettingsCache;
	rideSettingsCache = {};
	const dir = `${DATA}/cobblemon/ride_settings`;
	if (existsSync(dir)) for (const f of walk(dir, (n) => n.endsWith(".json"))) rideSettingsCache[basename(f, ".json")] = tryReadJson(f) ?? {};
	return rideSettingsCache;
}

/**
 * Posições dos assentos a partir dos locators `seat_N` da geometria (Seat.locator; vazio = seat_{i+1}).
 * Geometria do Bedrock olha para −z; no espaço do assento a frente é +z, por isso x e z trocam de sinal.
 * O locator é convertido de pixels (1/16) e multiplicado pela escala da espécie.
 */
export function seatPositions(riding: any, modelFile: string | undefined, scale: number, height: number): number[][] {
	const seats: any[] = Array.isArray(riding?.seats) ? riding.seats : [];
	const locators = new Map<string, number[]>();
	const geo = modelFile ? tryReadJson(modelFile)?.["minecraft:geometry"]?.[0] : undefined;
	for (const bone of geo?.bones ?? []) {
		for (const [name, v] of Object.entries<any>(bone.locators ?? {})) {
			const p = Array.isArray(v) ? v : Array.isArray(v?.offset) ? v.offset : undefined;
			if (p && p.length === 3) locators.set(name, p.map(Number));
		}
	}
	return seats.map((seat, i) => {
		const p = locators.get(seat?.locator || `seat_${i + 1}`);
		if (!p) return [0, round(height * scale * 0.85), round(-0.2 * i)];
		return [round((-p[0] / 16) * scale), round((p[1] / 16) * scale), round((-p[2] / 16) * scale)];
	});
}

// ------------------------------------------------------------------ dados para os scripts

/** Resumo por espécie usado em runtime (generated/scripts/entityData.ts). */
export interface EntityInfoOut {
	sizes: SizeEntry[];
	sizeForms: Record<string, number>;
	sizeAlpha: Record<string, number>;
	/** Nomes de forma ("" = padrão) que podem ir no ombro. */
	shoulder: string[];
	/** Montaria por forma ("" = padrão). Forma sem entrada herda a da espécie; `null` = forma sem montaria. */
	ride: Record<string, RideInfo | null>;
	/** Estilos que existem no JSON da entidade (grupos cobblemon:ride_*). */
	rideGroups: RideStyle[];
	shearable: boolean;
}

const ENTITY_INFO = new Map<string, EntityInfoOut>();

export function entityInfoFor(id: string): EntityInfoOut | undefined {
	return ENTITY_INFO.get(id);
}

/** Espécies com `shoulderMountable` na espécie ou em alguma forma. */
function shoulderForms(data: any): string[] {
	const out: string[] = [];
	if (data?.shoulderMountable) out.push("");
	for (const f of data?.forms ?? []) {
		const v = f?.shoulderMountable ?? data?.shoulderMountable;
		if (v && f?.name) out.push(String(f.name));
	}
	return out;
}

// ------------------------------------------------------------------ JSON da entidade

type Json = Record<string, any>;

/**
 * Frente dados-ia: IA por contexto a partir dos presets de behaviour do Cobblemon (tools/importer/pokemonBehaviours.ts).
 * `wild` = selvagem/fora do time, `owned` = no time, `alpha` = extra do Alfa selvagem (retaliates), `pasture` = extra do
 * pasto com "ataca mobs hostis" (attack_hostile_mobs). Os extras não repetem componentes do grupo base.
 */
function speciesAi(id: string, m: Movement, b: BehaviourInfo, data: any, aquatic: boolean): { wild: Json; owned: Json; alpha: Json; pasture: Json } {
	const input = { movement: m, data, aquatic, shearable: b.shearable, toleratedLeaders: b.toleratedLeaders };
	const resolved = Object.fromEntries(Object.entries(CONTEXTS).map(([k, ctx]) => [k, resolvePokemonAi(data, ctx, id)])) as Record<keyof typeof CONTEXTS, ReturnType<typeof resolvePokemonAi>>;
	const comp = (k: keyof typeof CONTEXTS) => aiComponents(resolved[k], input);
	const wild = comp("wild");
	recordSpeciesAi(id, { pointToSpawn: pointsToSpawn(resolved.wild) });
	return {
		wild,
		owned: comp("party"),
		alpha: extraComponents(comp("wildAlpha"), wild),
		// O Pokémon do pasto usa o grupo wild_ai: o extra é o que o conflito acrescenta, sem repetir o wild_ai.
		pasture: extraComponents(extraComponents(comp("pasturedConflict"), comp("pastured")), wild),
	};
}

function lookAi(): Json {
	return {
		"minecraft:behavior.look_at_player": { priority: 8, look_distance: 8, probability: 0.02 },
		"minecraft:behavior.random_look_around": { priority: 9 },
	};
}

/** Tira de add/remove os grupos que não existem e descarta passos que ficaram vazios. */
function pruneEvents(events: Json, existing: Set<string>): void {
	const clean = (ev: Json) => {
		for (const k of ["add", "remove"]) {
			if (!ev[k]?.component_groups) continue;
			ev[k].component_groups = ev[k].component_groups.filter((g: string) => existing.has(g));
			if (!ev[k].component_groups.length) delete ev[k];
		}
		if (Array.isArray(ev.sequence)) {
			ev.sequence.forEach(clean);
			ev.sequence = ev.sequence.filter((step: Json) => Object.keys(step).some((k) => k !== "filters"));
		}
	};
	for (const ev of Object.values(events)) clean(ev);
}

export function buildServerEntity(e: ServerEntityInput): Json {
	const m = e.movement;
	const data = e.data ?? {};
	const b = behaviourOf(data);
	const aquatic = m.canBreatheUnderwater && (m.avoidsLand || !m.canWalk) && !m.canFly;
	const amphibious = m.canBreatheUnderwater && !aquatic;
	const lavaSwimmer = b.canSwimInLava && m.fireImmune;
	const sizes = sizeTable(data, e.hitbox, e.baseScale);
	const base = sizes.sizes[0];
	const shoulder = shoulderForms(data);
	// Frente mundo-detalhes: comportamentos de espécie (pokemon_fox: família "lightweight" = fica em pé na neve fofa,
	// can_stand_on_powder_snow; no formato 1.21.90 o componente próprio não existe e a família faz o mesmo).
	const speciesB = speciesBehaviours(data);
	const families = ["pokemon", "mob", `cobblemon_${e.id}`, ...(speciesB.fox ? ["lightweight"] : [])];

	// Montaria: estilos da espécie + formas (união), assentos pelo modelo padrão.
	const rideSettings = loadRideSettings();
	const ride: Record<string, RideInfo | null> = {};
	const speciesRide = rideInfoOf(data.riding, m.walkSpeed, rideSettings);
	if (speciesRide) ride[""] = speciesRide;
	for (const f of data.forms ?? []) {
		if (f?.name && f.riding !== undefined) ride[String(f.name)] = rideInfoOf(f.riding, m.walkSpeed, rideSettings) ?? null;
	}
	const rideInfos = Object.values(ride).filter((r): r is RideInfo => !!r);
	const rideGroups = (["LAND", "AIR", "LIQUID"] as RideStyle[]).filter((s) => rideInfos.some((r) => r.styles[s]));
	const rideable = rideGroups.length > 0;
	const maxSeats = Math.max(0, ...rideInfos.map((r) => r.seats));
	const seatSource = data.riding?.seats?.length >= maxSeats ? data.riding : (data.forms ?? []).find((f: any) => f?.riding?.seats?.length === maxSeats)?.riding;
	const styleOf = (s: RideStyle) => speciesRide?.styles[s] ?? rideInfos.find((r) => r.styles[s])?.styles[s];

	const components: Json = {
		"minecraft:type_family": { family: families },
		// O Bedrock aplica minecraft:scale também à caixa de colisão; por isso a caixa vai sem baseScale.
		"minecraft:collision_box": { width: base.width, height: base.height },
		"minecraft:scale": { value: base.scale },
		"minecraft:health": { value: 20, max: 20 },
		"minecraft:physics": {},
		"minecraft:pushable": { is_pushable: true, is_pushable_by_piston: true },
		"minecraft:nameable": {},
		"minecraft:jump.static": {},
		"minecraft:breathable": { total_supply: 15, suffocate_time: 0, breathes_air: true, breathes_water: m.canBreatheUnderwater, breathes_lava: b.canBreatheUnderlava },
		// Sempre presente: Pokemon.sendOut chama tameable.tame(player) logo depois do spawnEntity, antes de cobblemon:set_owned.
		"minecraft:tameable": { probability: 0 },
		"minecraft:follow_range": { value: 32, max: 32 },
		// Slot 0 = item segurado (PokemonData.applyToCobblemon/loadFromCobblemon leem este inventário).
		"minecraft:inventory": { container_type: "inventory", inventory_size: 1 },
		"minecraft:attack": { damage: meleeDamage(Number(data.baseStats?.attack ?? 50)) },
		"minecraft:interact": {
			interactions: [{ interact_text: "cobblemon.ui.interact", on_interact: { event: "cobblemon:interacted", target: "self" } }],
		},
	};
	if (m.fireImmune) components["minecraft:fire_immune"] = {};
	// Só a navegação de chão aceita lava (vanilla: strider).
	const lavaNav = lavaSwimmer || (b.canWalkOnLava && m.fireImmune) ? { can_path_over_lava: true, can_walk_in_lava: true } : {};
	if (lavaSwimmer) components["minecraft:lava_movement"] = { value: round(m.swimSpeed) };
	if (aquatic) {
		Object.assign(components, {
			"minecraft:movement": { value: round(m.swimSpeed) },
			"minecraft:underwater_movement": { value: round(m.swimSpeed) },
			"minecraft:movement.sway": { sway_amplitude: 0 },
			"minecraft:navigation.generic": { can_swim: true, can_walk: false, can_breach: true, can_path_over_water: false, can_sink: false, is_amphibious: true },
			"minecraft:behavior.swim_idle": { priority: 8 },
		});
	} else if (m.canFly) {
		Object.assign(components, {
			"minecraft:movement": { value: round(m.canWalk ? m.walkSpeed : m.flySpeed) },
			"minecraft:flying_speed": { value: round(m.flySpeed) },
			"minecraft:can_fly": {},
			"minecraft:movement.fly": {},
			"minecraft:navigation.fly": { can_path_over_water: true, can_path_from_air: true },
			"minecraft:damage_sensor": { triggers: { cause: "fall", deals_damage: "no" } },
		});
		// pokemon_no_underwater: quem não respira embaixo d'água fica boiando (stay_afloat).
		if (!m.canBreatheUnderwater) components["minecraft:behavior.float"] = { priority: 0 };
		if (m.canBreatheUnderwater) components["minecraft:underwater_movement"] = { value: round(m.swimSpeed) };
	} else if (amphibious) {
		Object.assign(components, {
			"minecraft:movement": { value: round(m.walkSpeed) },
			"minecraft:underwater_movement": { value: round(m.swimSpeed) },
			"minecraft:movement.amphibious": { max_turn: 15 },
			"minecraft:navigation.generic": { can_swim: true, can_walk: true, can_breach: true, can_path_over_water: true, can_sink: true, is_amphibious: true, avoid_damage_blocks: true },
		});
	} else {
		Object.assign(components, {
			"minecraft:movement": { value: round(m.walkSpeed) },
			"minecraft:movement.basic": {},
			"minecraft:navigation.walk": { can_path_over_water: !m.avoidsWater, avoid_water: m.avoidsWater, avoid_damage_blocks: true, can_sink: !m.canWalkOnWater, ...lavaNav },
			// pokemon_no_underwater: quem não respira embaixo d'água fica boiando (stay_afloat).
			"minecraft:behavior.float": { priority: 0 },
		});
	}
	const flightSpeed = components["minecraft:flying_speed"]?.value;
	// Frente mundo-detalhes: o item segurado é mostrado na mão secundária (scripts/entity/HeldItemDisplay.ts);
	// essa cópia visual nunca cai no chão.
	components["minecraft:equipment"] = {
		table: "loot_tables/empty.json",
		// O que a raposa carrega na boca (mão principal) cai inteiro, como no Java.
		slot_drop_chance: [{ slot: "slot.weapon.offhand", drop_chance: 0 }, ...(speciesB.picksUpItems ? [{ slot: "slot.weapon.mainhand", drop_chance: 1 }] : [])],
	};
	if (speciesB.fox) {
		// apply_fox_properties: immune_to_sweet_berry_bush_block (a neve fofa vem da família "lightweight").
		addDamageTrigger(components, { on_damage: { filters: { test: "is_block", subject: "block", value: "minecraft:sweet_berry_bush" } }, deals_damage: "no" });
	}

	// O despawn do selvagem é por script (scripts/spawning/Despawner.ts), por isso não há minecraft:despawn.
	const ai = speciesAi(e.id, m, b, data, aquatic);
	const groups: Json = {
		"cobblemon:wild_ai": ai.wild,
		"cobblemon:owned": { "minecraft:is_tamed": {} },
		"cobblemon:owned_ai": ai.owned,
		// Frente dados-ia: Alfa selvagem revida (pokemon_non_party: retaliates com is_alpha) e pasto com
		// "ataca mobs hostis" (pokemon_owned: attack_hostile_mobs; scripts/machines/pasture.ts liga/desliga).
		"cobblemon:alpha_ai": ai.alpha,
		"cobblemon:pasture_conflict": ai.pasture,
		"cobblemon:idle_look": m.canLook ? lookAi() : {},
		// Dormindo: sem metas de IA (os grupos *_ai e idle_look saem) e sem girar o corpo.
		"cobblemon:asleep": { "minecraft:body_rotation_blocked": {} },
		// Em batalha (como no Cobblemon): os grupos de IA saem (sem andar, revidar ou fugir) e o corpo não gira.
		// Não redefine componentes da base (movement/pushable): remover o grupo apagaria o da base também.
		"cobblemon:in_battle": { "minecraft:body_rotation_blocked": {} },
		"cobblemon:instant_kill": { "minecraft:instant_despawn": {} },
	};
	// Frente mundo-detalhes: pokemon_fox / pokemon_picks_up_items (fora do time): pega itens do chão com a boca
	// (mão principal), come a comida que carrega e colhe sweet berries (harvest_sweet_berry_bush).
	if (speciesB.picksUpItems) {
		Object.assign(groups["cobblemon:wild_ai"], {
			"minecraft:shareables": {
				singular_pickup: true,
				all_items: true,
				all_items_max_amount: 1,
				items: [
					{ item: "minecraft:sweet_berries", priority: 0, max_amount: 1 },
					{ item: "minecraft:glow_berries", priority: 0, max_amount: 1 },
					{ item: "minecraft:is_food", priority: 1, max_amount: 1 },
				],
			},
			// Anda até o item; a coleta em si é do script (scripts/entity/SpeciesBehaviours.ts): com o inventário de
			// 1 espaço (item segurado) o Bedrock guardaria o item lá e ele se perderia.
			"minecraft:behavior.pickup_items": { priority: 6, max_dist: 8, goal_radius: 1.5, speed_multiplier: 1.0, can_pickup_any_item: true },
		});
		if (speciesB.fox) {
			groups["cobblemon:wild_ai"]["minecraft:behavior.raid_garden"] = {
				priority: 6, blocks: ["minecraft:sweet_berry_bush"], speed_multiplier: 1.0, search_range: 12, search_height: 2, goal_radius: 0.8, max_to_eat: 0, initial_eat_delay: 2,
			};
		}
	}
	// Frente mundo-detalhes: pokemon_bee (Combee) — os scripts (scripts/entity/SpeciesBehaviours.ts) trocam os grupos.
	if (speciesB.bee) {
		groups["cobblemon:bee_look_for_flower"] = {
			"minecraft:behavior.move_to_block": {
				priority: 5, tick_interval: 20, start_chance: 0.5, search_range: 12, search_height: 6, goal_radius: 1.0, stay_duration: 20.0,
				target_selection_method: "random", target_offset: [0, 0.25, 0], target_blocks: BEE_FLOWERS,
				on_stay_completed: [{ event: "cobblemon:bee_collected_nectar", target: "self" }],
			},
		};
		groups["cobblemon:bee_return"] = {
			"minecraft:behavior.move_to_block": {
				// Folha/colmeia é sólida no Bedrock (o Combee do Java atravessa folhas de saccharine): chegar ao lado basta.
				priority: 5, tick_interval: 20, search_range: 16, search_height: 10, goal_radius: 2.0, stay_duration: 12.5,
				target_blocks: ["cobblemon:saccharine_leaves", "minecraft:beehive", "minecraft:bee_nest"],
				on_stay_completed: [{ event: "cobblemon:bee_deposit", target: "self" }],
			},
		};
	}
	const sizeGroups = sizes.sizes.map((_, i) => `cobblemon:size_${i}`);
	sizes.sizes.forEach((s, i) => {
		groups[`cobblemon:size_${i}`] = { "minecraft:collision_box": { width: s.width, height: s.height }, "minecraft:scale": { value: s.scale } };
	});
	const hasShoulder = shoulder.length > 0;
	if (hasShoulder) {
		groups["cobblemon:family_default"] = { "minecraft:type_family": { family: families } };
		// Família aceita pelos assentos do player.json (ombros); só existe enquanto está montado.
		groups["cobblemon:family_shoulder"] = { "minecraft:type_family": { family: [...families, "pokemon_shoulder"] } };
	}

	const rideGroupNames = rideGroups.map((s) => `cobblemon:ride_${s.toLowerCase()}`);
	if (rideable) {
		const positions = seatPositions(seatSource, e.modelFile, base.scale, base.height);
		const radius = round(clamp(Math.max(base.width, base.height) * base.scale * 2.5, 4, 16));
		groups["cobblemon:rideable"] = {
			"minecraft:rideable": {
				seat_count: positions.length,
				crouching_skip_interact: true,
				pull_in_entities: false,
				family_types: ["player"],
				interact_text: "action.interact.ride.horse",
				on_rider_enter_event: "cobblemon:on_mount",
				on_rider_exit_event: "cobblemon:on_dismount",
				seats: positions.map((position, i) => ({ min_rider_count: i, max_rider_count: positions.length, position, third_person_camera_radius: radius })),
			},
		};
		// Valores de IA dos componentes que mudam ao montar.
		const aiMove: Json = { "minecraft:movement": components["minecraft:movement"] };
		if (flightSpeed !== undefined) aiMove["minecraft:flying_speed"] = { value: flightSpeed };
		if (components["minecraft:underwater_movement"]) aiMove["minecraft:underwater_movement"] = components["minecraft:underwater_movement"];
		// Frente cliente-teste3-log: minecraft:behavior.float "tira os passageiros no momento em que a cabeça do mob fica
		// embaixo d'água" (documentação do componente). Na base, o motor derrubava o jogador ao montar/entrar na água
		// quem não respira embaixo d'água (garchomp, drampa: selftest do 3º teste e BDS, "o motor tirou o jogador:
		// … LIQUID (-)"). No Java PokemonEntity.dismountsUnderwater() = false. Montável: o boiar da IA sai da base e fica
		// no grupo cobblemon:move_ai (sem montaria: nasce com ele, sai no on_mount e volta no on_dismount), fora dos grupos
		// de montaria (que copiam aiMove).
		const float = components["minecraft:behavior.float"];
		if (float) delete components["minecraft:behavior.float"];
		groups["cobblemon:move_ai"] = float ? { ...aiMove, "minecraft:behavior.float": float } : aiMove;
		const land = styleOf("LAND");
		if (land) {
			groups["cobblemon:ride_land"] = {
				...aiMove,
				"minecraft:movement": { value: land.speed },
				"minecraft:input_ground_controlled": {},
				...(land.jump > 0 ? { "minecraft:can_power_jump": {}, "minecraft:horse.jump_strength": { value: land.jump } } : {}),
			};
		}
		const air = styleOf("AIR");
		if (air) {
			const common: Json = {
				...aiMove,
				"minecraft:movement": { value: air.speed },
				"minecraft:flying_speed": { value: air.speed },
				"minecraft:free_camera_controlled": { strafe_speed_modifier: 0.5, backwards_movement_modifier: 0.3 },
			};
			// can_fly só entra no grupo se a base não tiver (remover o grupo tiraria o da base).
			if (!components["minecraft:can_fly"]) common["minecraft:can_fly"] = {};
			groups["cobblemon:ride_air"] = { ...common, "minecraft:physics": { has_gravity: false }, ...(air.jump > 0 ? { "minecraft:vertical_movement_action": { vertical_velocity: air.jump } } : {}) };
			// Sem fôlego (ou planador): continua guiando, mas com gravidade (grupo cobblemon:gravity) e desce planando.
			groups["cobblemon:ride_air_tired"] = common;
			groups["cobblemon:gravity"] = { "minecraft:physics": {} };
		}
		const liquid = styleOf("LIQUID");
		if (liquid) {
			const underwater = liquid.key.endsWith("/submarine") || liquid.key.endsWith("/dolphin");
			// Frente cliente-teste3-log: LIQUID de superfície (boat/burst: Garchomp, Drampa, Tauros de Paldea-Aqua). No Java o
			// BoatBehaviour mantém a montaria boiando (sobe 0,5/tick enquanto há água em eyeY + surfaceLevelOffset). Montada,
			// ela perde o behavior.float (ver cobblemon:move_ai acima, a causa de o motor derrubar o jogador) e afundaria:
			// minecraft:buoyant (o do barco) a deixa na superfície enquanto está no LIQUID; o grupo sai ao desmontar (a base
			// não tem o componente, então tirar o grupo não tira nada da base).
			const surface = !underwater && !m.canBreatheUnderwater;
			groups["cobblemon:ride_liquid"] = {
				...aiMove,
				"minecraft:movement": { value: liquid.speed },
				"minecraft:underwater_movement": { value: liquid.speed },
				"minecraft:free_camera_controlled": { strafe_speed_modifier: 0.5, backwards_movement_modifier: 0.3 },
				...(underwater ? { "minecraft:underwater_mount_breathing": {} } : {}),
				...(surface ? { "minecraft:buoyant": { base_buoyancy: 1.0, apply_gravity: true, simulate_waves: false, liquid_blocks: ["minecraft:water", "minecraft:flowing_water"] } } : {}),
			};
		}
	}
	const allRide = [...rideGroupNames, ...(styleOf("AIR") ? ["cobblemon:ride_air_tired"] : [])];
	const hasAir = !!styleOf("AIR");

	const bool = (def = false) => ({ type: "bool", default: def, client_sync: true });
	// Frente dados-ia: o sono não tira alpha_ai/pasture_conflict (ferido, o Pokémon acorda por script e revida, como
	// as tarefas de "core" do Cobblemon); batalha, ombro e montaria tiram todos.
	const sleepGroups = ["cobblemon:wild_ai", "cobblemon:owned_ai", "cobblemon:idle_look", ...(speciesB.bee ? ["cobblemon:bee_look_for_flower", "cobblemon:bee_return"] : [])];
	const aiGroups = [...sleepGroups, "cobblemon:alpha_ai", "cobblemon:pasture_conflict"];
	const wildOrOwnedAi = [
		{ filters: { test: "bool_property", domain: "cobblemon:wild", value: true }, add: { component_groups: ["cobblemon:wild_ai"] } },
		{ filters: { test: "bool_property", domain: "cobblemon:wild", value: false }, add: { component_groups: ["cobblemon:owned_ai"] } },
	];
	// Frente dados-ia: Alfa selvagem volta a revidar ao sair da batalha/ombro/montaria.
	const alphaAiStep = {
		filters: { all_of: [{ test: "bool_property", domain: "cobblemon:wild", value: true }, { test: "bool_property", domain: "cobblemon:alpha", value: true }] },
		add: { component_groups: ["cobblemon:alpha_ai"] },
	};
	const events: Json = {
		"minecraft:entity_spawned": {
			add: { component_groups: ["cobblemon:wild_ai", "cobblemon:idle_look", "cobblemon:size_0", ...(hasShoulder ? ["cobblemon:family_default"] : []), ...(rideable ? ["cobblemon:move_ai"] : []), ...(hasAir ? ["cobblemon:gravity"] : [])] },
			set_property: { "cobblemon:wild": true },
		},
		"cobblemon:set_wild": {
			add: { component_groups: ["cobblemon:wild_ai", "cobblemon:idle_look"] },
			remove: { component_groups: ["cobblemon:owned", "cobblemon:owned_ai", "cobblemon:asleep", ...(rideable ? ["cobblemon:rideable"] : [])] },
			set_property: { "cobblemon:wild": true, "cobblemon:sleeping": false },
		},
		"cobblemon:set_owned": {
			add: { component_groups: ["cobblemon:owned", "cobblemon:owned_ai", "cobblemon:idle_look", ...(rideable ? ["cobblemon:rideable"] : [])] },
			remove: { component_groups: ["cobblemon:wild_ai", "cobblemon:asleep", "cobblemon:alpha_ai", "cobblemon:pasture_conflict"] },
			set_property: { "cobblemon:wild": false, "cobblemon:sleeping": false, "cobblemon:pasture_conflict": false },
		},
		"cobblemon:sleep": {
			add: { component_groups: ["cobblemon:asleep"] },
			remove: { component_groups: sleepGroups },
			set_property: { "cobblemon:sleeping": true },
		},
		"cobblemon:battle_start": {
			add: { component_groups: ["cobblemon:in_battle"] },
			remove: { component_groups: aiGroups },
			set_property: { "cobblemon:in_battle": true, "cobblemon:pasture_conflict": false },
		},
		"cobblemon:battle_end": {
			sequence: [
				{ remove: { component_groups: ["cobblemon:in_battle"] }, add: { component_groups: ["cobblemon:idle_look"] }, set_property: { "cobblemon:in_battle": false } },
				...wildOrOwnedAi,
				alphaAiStep,
			],
		},
		"cobblemon:wake": {
			sequence: [
				{ remove: { component_groups: ["cobblemon:asleep"] }, add: { component_groups: ["cobblemon:idle_look"] }, set_property: { "cobblemon:sleeping": false } },
				...wildOrOwnedAi,
			],
		},
		// Alfa: tamanho de Alfa da forma padrão; scripts/entity/Size.ts corrige para a forma ativa.
		"cobblemon:set_alpha": {
			remove: { component_groups: sizeGroups.filter((g) => g !== `cobblemon:size_${sizes.alpha[""]}`) },
			add: { component_groups: [`cobblemon:size_${sizes.alpha[""]}`] },
			set_property: { "cobblemon:alpha": true },
			// Frente dados-ia: retaliates do Alfa (só selvagem, fora de batalha e acordado).
			trigger: "cobblemon:alpha_ai_refresh",
		},
		"cobblemon:unset_alpha": { remove: { component_groups: [...sizeGroups.filter((g) => g !== "cobblemon:size_0"), "cobblemon:alpha_ai"] }, add: { component_groups: ["cobblemon:size_0"] }, set_property: { "cobblemon:alpha": false } },
		"cobblemon:alpha_ai_refresh": {
			sequence: [
				{
					filters: {
						all_of: [
							{ test: "bool_property", domain: "cobblemon:wild", value: true },
							{ test: "bool_property", domain: "cobblemon:in_battle", value: false },
						],
					},
					add: { component_groups: ["cobblemon:alpha_ai"] },
				},
			],
		},
		// Frente dados-ia: pasto com "ataca mobs hostis" (scripts/machines/pasture.ts, tickPastureConflicts).
		"cobblemon:enable_pasture_conflict": { add: { component_groups: ["cobblemon:pasture_conflict"] }, set_property: { "cobblemon:pasture_conflict": true } },
		"cobblemon:disable_pasture_conflict": { remove: { component_groups: ["cobblemon:pasture_conflict"] }, set_property: { "cobblemon:pasture_conflict": false } },
		"cobblemon:instant_kill": { add: { component_groups: ["cobblemon:instant_kill"] } },
		"cobblemon:interacted": {},
		...(speciesB.bee
			? {
				"cobblemon:bee_seek": { add: { component_groups: ["cobblemon:bee_look_for_flower"] }, remove: { component_groups: ["cobblemon:bee_return"] } },
				"cobblemon:bee_collected_nectar": { add: { component_groups: ["cobblemon:bee_return"] }, remove: { component_groups: ["cobblemon:bee_look_for_flower"] } },
				"cobblemon:bee_has_nectar": { add: { component_groups: ["cobblemon:bee_return"] }, remove: { component_groups: ["cobblemon:bee_look_for_flower"] } },
				"cobblemon:bee_deposit": {},
				"cobblemon:bee_idle": { remove: { component_groups: ["cobblemon:bee_look_for_flower", "cobblemon:bee_return"] } },
			}
			: {}),
		"cobblemon:ate_grass": {},
	};
	sizes.sizes.forEach((_, i) => {
		events[`cobblemon:size_${i}`] = { remove: { component_groups: sizeGroups.filter((_, j) => j !== i) }, add: { component_groups: [`cobblemon:size_${i}`] } };
	});
	if (hasShoulder) {
		events["cobblemon:shoulder_on"] = { remove: { component_groups: ["cobblemon:family_default", ...aiGroups] }, add: { component_groups: ["cobblemon:family_shoulder"] } };
		events["cobblemon:shoulder_off"] = {
			sequence: [
				{ remove: { component_groups: ["cobblemon:family_shoulder"] }, add: { component_groups: ["cobblemon:family_default", "cobblemon:idle_look"] } },
				...wildOrOwnedAi,
				alphaAiStep,
			],
		};
	}
	if (rideable) {
		const first = rideGroups[0];
		const gravityOff = (style: RideStyle) => (hasAir ? (style === "AIR" ? { remove: ["cobblemon:gravity"], add: [] } : { remove: [], add: ["cobblemon:gravity"] }) : { remove: [], add: [] });
		const switchTo = (style: RideStyle, group = `cobblemon:ride_${style.toLowerCase()}`) => {
			const g = gravityOff(style === "AIR" && group.endsWith("_tired") ? "LAND" : style);
			return {
				remove: { component_groups: [...aiGroups, "cobblemon:asleep", "cobblemon:move_ai", ...allRide.filter((n) => n !== group), ...g.remove] },
				add: { component_groups: [group, ...g.add] },
			};
		};
		events["cobblemon:on_mount"] = switchTo(first);
		for (const s of rideGroups) events[`cobblemon:ride_${s.toLowerCase()}`] = switchTo(s);
		if (hasAir) events["cobblemon:ride_air_tired"] = switchTo("AIR", "cobblemon:ride_air_tired");
		events["cobblemon:on_dismount"] = {
			sequence: [
				{ remove: { component_groups: allRide }, add: { component_groups: ["cobblemon:move_ai", "cobblemon:idle_look", ...(hasAir ? ["cobblemon:gravity"] : [])] } },
				...wildOrOwnedAi,
				alphaAiStep,
			],
		};
	}

	// Grupos vazios (ex.: idle_look de quem não olha em volta) saem, junto com as referências nos eventos.
	for (const [name, g] of Object.entries(groups)) if (!Object.keys(g).length) delete groups[name];
	pruneEvents(events, new Set(Object.keys(groups)));
	// Frente dados-ia: sequência que ficou vazia (grupo opcional ausente, ex.: alpha_ai) vira evento vazio.
	for (const ev of Object.values(events)) if (Array.isArray(ev.sequence) && !ev.sequence.length) delete ev.sequence;

	ENTITY_INFO.set(e.id, {
		sizes: sizes.sizes,
		sizeForms: sizes.forms,
		sizeAlpha: sizes.alpha,
		shoulder,
		ride,
		rideGroups,
		shearable: b.shearable,
	});

	// Frente limites-a (#79): BlockBehavior.immuneToCobwebBlock (PokemonEntity.makeStuckInBlock ignora a teia). O
	// componente do Bedrock só existe no schema 1.26.50, e nele `minecraft:pushable` virou pushable_by_entity/_by_block.
	const cobwebImmune = isCobwebImmune(data);
	if (cobwebImmune) {
		components["minecraft:block_movement_slowdown_immunity"] = { blocks: ["minecraft:web"] };
		migratePushable(components);
		for (const g of Object.values(groups)) migratePushable(g as Json);
	}

	return {
		format_version: cobwebImmune ? COBWEB_IMMUNE_FORMAT : "1.21.90",
		"minecraft:entity": {
			description: {
				identifier: `cobblemon:${e.id}`,
				is_spawnable: false,
				is_summonable: true,
				spawn_category: "creature",
				properties: {
					"cobblemon:variant": { type: "int", range: [0, Math.max(1, e.variants - 1)], default: 0, client_sync: true },
					"cobblemon:in_battle": bool(),
					"cobblemon:sleeping": bool(),
					"cobblemon:wild": bool(),
					"cobblemon:initialized": bool(),
					"cobblemon:busy": bool(),
					"cobblemon:alpha": bool(),
					// Escala intrínseca × filhote (scripts/pokemon/Scale.ts); só visual: a hitbox fica no grupo size_<n>.
					"cobblemon:scale_modifier": { type: "float", range: [0.05, 3.5], default: "1.0", client_sync: true }, // default em string: JSON.stringify escreveria 1 (int) e o Bedrock rejeita
					// Tinta vermelha do feixe de captura/recolha (beamMode 3; scripts/pokemon/BeamTint.ts).
					[BEAM_TINT_PROPERTY]: bool(),
					// Frente motor: roll visual da montaria voadora (scripts/entity/Riding.ts; o RP lê q.property).
					...(rideable && hasAir ? { "cobblemon:roll": { type: "float", range: [-90.5, 90.5], default: "0.0", client_sync: true } } : {}),
					// Frente dados-ia: grupo cobblemon:pasture_conflict ligado (só no servidor).
					"cobblemon:pasture_conflict": { type: "bool", default: false },
					// Frente msd-fase1: gimmick de batalha (0 nenhum, 1..19 Tera pelo tipo, 20 Dynamax, 21 G-Max); o RP lê a
					// tinta e a escala (scripts/entity/GimmickProperty.ts).
					[GIMMICK_PROPERTY]: { type: "int", range: [0, GIMMICK_MAX], default: 0, client_sync: true },
					// Frente dados-ia: aspects lidos pelos posers (q.has_aspect), bit i = aspectBits[i].
					...(e.aspectBits?.length ? { [ASPECTS_PROPERTY]: { type: "int", range: aspectsPropertyRange(e.aspectBits.length), default: 0, client_sync: true } } : {}),
				},
			},
			component_groups: groups,
			components,
			events,
		},
	};
}

/** Frente limites-a (#79): versão do schema que tem `minecraft:block_movement_slowdown_immunity` (26.50). */
export const COBWEB_IMMUNE_FORMAT = "1.26.50";

/** behaviour.blockInteract.immuneToCobwebBlock da espécie (BlockBehavior; padrão false). */
export function isCobwebImmune(data: any): boolean {
	return data?.behaviour?.blockInteract?.immuneToCobwebBlock === true;
}

/**
 * `minecraft:pushable` (removido no schema 1.26.50) → `minecraft:pushable_by_entity` (is_pushable) +
 * `minecraft:pushable_by_block` (is_pushable_by_piston), como no bedrock-samples 1.26.50.4. Ausência = não empurra.
 */
export function migratePushable(components: Json): void {
	const old = components?.["minecraft:pushable"];
	if (!old) return;
	delete components["minecraft:pushable"];
	if (old.is_pushable !== false) components["minecraft:pushable_by_entity"] = {};
	if (old.is_pushable_by_piston !== false) components["minecraft:pushable_by_block"] = {};
}

/** Flores da abelha vanilla (bee.json, v1.26.50.4, look_for_food) — o PathToFlowerTask usa a tag #minecraft:flowers. */
const BEE_FLOWERS = [
	"minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:red_tulip", "minecraft:orange_tulip",
	"minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley",
	"minecraft:dandelion", "minecraft:wither_rose", "minecraft:sunflower", "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony",
	"minecraft:flowering_azalea", "minecraft:azalea_leaves_flowered", "minecraft:mangrove_propagule", "minecraft:pitcher_plant",
	"minecraft:torchflower", "minecraft:cherry_leaves", "minecraft:pink_petals", "minecraft:wildflowers",
];

/** Acrescenta um gatilho ao minecraft:damage_sensor (objeto ou lista). */
function addDamageTrigger(components: Json, trigger: Json): void {
	const current = components["minecraft:damage_sensor"]?.triggers;
	const list = current === undefined ? [] : Array.isArray(current) ? current : [current];
	components["minecraft:damage_sensor"] = { triggers: [...list, trigger] };
}

export function emitServerEntity(e: ServerEntityInput): void {
	writeJson(`${OUT_BP}/entities/pokemon/${e.id}.json`, buildServerEntity(e));
}

// ------------------------------------------------------------------ interações (pokemon_interactions)

/** Efeito de interação (InteractionEffect) já com ids do Bedrock. */
export type InteractionEffectOut =
	| { type: "shrink_item"; amount: number }
	| { type: "drop_item" | "give_item"; item: string; min: number; max: number }
	| { type: "play_sound"; sound: string }
	| { type: "script"; script: string };

export interface InteractionOut {
	grouping: string;
	/** Requisito `properties` da própria interação (ex.: Rotom "form=frost"), além do conjunto. */
	properties?: Record<string, string>;
	/** Ticks (o Cobblemon desconta 20 por segundo enquanto o Pokémon está no time). */
	cooldown: number;
	/** Itens aceitos na mão principal do dono (owner_held_item), já no Bedrock. */
	items: string[];
	/** Frente dados-ui: requisito `chance` (expressão MoLang da probabilidade 0..1; ChanceRequirement). */
	chance?: string;
	effects: InteractionEffectOut[];
}

export interface InteractionSetOut {
	/** Espécie exigida (requirement `properties` do conjunto). */
	species: string;
	/** Outras propriedades exigidas ("gender" → "female", "form" → "frost"). */
	properties: Record<string, string>;
	interactions: InteractionOut[];
}

/** Tags de item do Java usadas nas interações → itens do Bedrock. */
const INTERACTION_TAGS: Record<string, string[]> = {
	"c:tools/brush": ["minecraft:brush"],
	"c:tools/shear": ["minecraft:shears"],
	"c:tools/shears": ["minecraft:shears"],
	"c:fertilizers": ["minecraft:bone_meal"],
};

/** Sons do Java → definições de som do Bedrock (resource_pack/sounds/sound_definitions.json vanilla). */
const INTERACTION_SOUNDS: Record<string, string> = {
	"minecraft:item.brush.brushing.generic": "brush.generic",
	"minecraft:item.bone_meal.use": "item.bone_meal.use",
	"minecraft:item.bucket.fill": "bucket.fill_water",
	"minecraft:item.bucket.generic": "bucket.fill_water",
	"minecraft:item.bottle.fill": "bottle.fill",
};

function itemsOf(condition: unknown, mapItem: (id: string) => string | undefined): string[] {
	const list = Array.isArray(condition) ? condition : [condition];
	const out: string[] = [];
	for (const c of list) {
		const s = String((c as any)?.item ?? c ?? "");
		if (s.startsWith("#")) out.push(...(INTERACTION_TAGS[s.slice(1)] ?? []));
		else {
			const id = mapItem(s);
			if (id) out.push(id);
		}
	}
	return [...new Set(out)];
}

/** "gogoat gender=female" → espécie + propriedades. */
function parseTarget(target: string): { species: string; properties: Record<string, string> } {
	const [speciesRaw, ...props] = String(target).trim().split(/\s+/);
	const properties: Record<string, string> = {};
	for (const p of props) {
		const [k, v] = p.split("=");
		if (k && v !== undefined) properties[k.toLowerCase()] = v.toLowerCase();
	}
	return { species: (speciesRaw ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""), properties };
}

function rangeOf(v: unknown): { min: number; max: number } {
	const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(String(v ?? "1"));
	if (!m) return { min: 1, max: 1 };
	const min = Number(m[1]);
	return { min, max: m[2] !== undefined ? Math.max(min, Number(m[2])) : min };
}

/** Lê data/cobblemon/pokemon_interactions (arquivos na ordem do Cobblemon: conjuntos com espécie primeiro). */
export function parseInteractions(files: Array<{ name: string; json: any }>, mapItem: (id: string) => string | undefined): InteractionSetOut[] {
	const out: InteractionSetOut[] = [];
	for (const { json } of files) {
		const req = (json?.requirements ?? []).find((r: any) => r?.variant === "properties");
		if (!req?.target) continue;
		const { species, properties } = parseTarget(req.target);
		const interactions: InteractionOut[] = [];
		for (const i of json.interactions ?? []) {
			const itemReq = (i.requirements ?? []).find((r: any) => r?.variant === "owner_held_item");
			const effects: InteractionEffectOut[] = [];
			for (const eff of i.effects ?? []) {
				if (eff.variant === "shrink_item") effects.push({ type: "shrink_item", amount: Number(eff.amount ?? 1) || 1 });
				else if (eff.variant === "drop_item" || eff.variant === "give_item") {
					const item = mapItem(String(eff.item ?? ""));
					if (item) effects.push({ type: eff.variant, item, ...rangeOf(eff.amount) });
					else warn("interação: item sem equivalente no Bedrock", String(eff.item));
				}
				else if (eff.variant === "play_sound") effects.push({ type: "play_sound", sound: INTERACTION_SOUNDS[String(eff.sound)] ?? String(eff.sound).replace(/^minecraft:/, "") });
				else if (eff.variant === "script") effects.push({ type: "script", script: String(eff.script ?? "") });
			}
			const cooldown = Math.max(0, Math.round(Number(i.cooldown ?? 0)) || 0);
			const out: InteractionOut = { grouping: String(i.grouping ?? "cobblemon:default"), cooldown, items: itemReq ? itemsOf(itemReq.itemCondition, mapItem) : [], effects };
			const propReq = (i.requirements ?? []).find((r: any) => r?.variant === "properties" && r.target);
			if (propReq) out.properties = parseTarget(propReq.target).properties;
			const chanceReq = (i.requirements ?? []).find((r: any) => r?.variant === "chance");
			if (chanceReq) out.chance = String(chanceReq.chance ?? "1");
			interactions.push(out);
		}
		out.push({ species, properties, interactions });
	}
	return out;
}

/** Java → Bedrock para itens das interações (vanilla renomeados; cobblemon:* mantém o id). */
function interactionItem(id: string): string | undefined {
	const { ns } = splitId(id, "minecraft");
	if (ns === "cobblemon") return id;
	return bedrockVanillaItem(id);
}

/** generated/scripts/entityData.ts: tamanhos, ombro, montaria e interações para scripts/entity. */
export function emitEntityDataModule(): void {
	const dir = `${DATA}/cobblemon/pokemon_interactions`;
	const files = existsSync(dir) ? walk(dir, (n) => n.endsWith(".json")).sort().map((f) => ({ name: basename(f, ".json"), json: tryReadJson(f) })) : [];
	const sets = parseInteractions(files, interactionItem).sort((a, b) => Number(Object.keys(a.properties).length === 0) - Number(Object.keys(b.properties).length === 0));
	const species = [...ENTITY_INFO].sort(([a], [b]) => a.localeCompare(b)).map(([id, info]) => `\t${JSON.stringify(id)}: ${JSON.stringify(info)},`);
	writeText(
		`${OUT_SCRIPTS}/entityData.ts`,
		`// Arquivo gerado por tools/importer/entities.ts (npm run import). Não edite à mão.
/* eslint-disable */
export type RideStyle = "LAND" | "AIR" | "LIQUID";
export interface RideSoundInfo { sound: string; passengers: boolean; others: boolean; volume: string; pitch: string }
export interface RideStyleInfo { key: string; stats: Record<string, number>; speed: number; jump: number; stamina: number; max?: Record<string, number>; sounds?: RideSoundInfo[]; sprint?: boolean; walkSpeed?: number }
export interface RideInfo { seats: number; styles: Partial<Record<RideStyle, RideStyleInfo>> }
export interface SizeEntry { width: number; height: number; scale: number }
export interface EntityInfo {
	sizes: SizeEntry[];
	sizeForms: Record<string, number>;
	sizeAlpha: Record<string, number>;
	shoulder: string[];
	ride: Record<string, RideInfo | null>;
	rideGroups: RideStyle[];
	shearable: boolean;
}
export type InteractionEffect =
	| { type: "shrink_item"; amount: number }
	| { type: "drop_item" | "give_item"; item: string; min: number; max: number }
	| { type: "play_sound"; sound: string }
	| { type: "script"; script: string };
export interface Interaction { grouping: string; properties?: Record<string, string>; cooldown: number; items: string[]; effects: InteractionEffect[]; chance?: string }
export interface InteractionSet { species: string; properties: Record<string, string>; interactions: Interaction[] }

/** Dados de entidade por espécie (id sem namespace). */
export const ENTITY_INFO: Record<string, EntityInfo> = {
${species.join("\n")}
};

/** data/cobblemon/pokemon_interactions do Cobblemon 1.8.2 (conjuntos mais específicos primeiro). */
export const INTERACTIONS: InteractionSet[] = ${JSON.stringify(sets)};
`,
	);
	count("interações de Pokémon (conjuntos)", sets.length);
}
