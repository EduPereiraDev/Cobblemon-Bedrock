// Frente "entidades": JSON das entidades gerado pelo importador (comportamento → componentes do Bedrock),
// tabela de pokemon_interactions, cooldowns, sono, montaria e tamanho por forma. A API do Minecraft é mockada.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alphaMultiplier, behaviourOf, buildServerEntity, meleeDamage, parseInteractions, rideInfoOf, seatPositions, sizeTable } from "../tools/importer/entities.ts";
import type { ServerEntityInput } from "../tools/importer/entities.ts";
import { movementOf } from "../tools/importer/species.ts";
import { getEntityInfo, getInteractionSets, getRideInfo, getSizeIndex, isShoulderMountable } from "../scripts/entity/EntityData";
import { findInteraction, isOnCooldown, matchesSet, rollAmount, shearDrops, startCooldown } from "../scripts/entity/Interactions";
import type { InteractionTarget } from "../scripts/entity/Interactions";
import { canSleepAt, drowsyStep, inRanges, parseIntRange, parseTimeRanges, restInfo, TIME_RANGES } from "../scripts/entity/Sleep";
import { nextRideStyle, staminaBar, staminaStep } from "../scripts/entity/Riding";
import { sizeIndexFor } from "../scripts/entity/Size";

const originalWarn = console.warn;
/** npm test roda na raiz do repositório (o bundle do teste fica em dist/tests). */
const ROOT = process.cwd();
console.warn = () => { };

type Json = Record<string, any>;
function entity(data: Json, extra: Partial<ServerEntityInput> = {}): Json {
	return buildServerEntity({
		id: extra.id ?? "testmon",
		variants: 2,
		hitbox: data.hitbox ?? { width: 1, height: 1 },
		baseScale: data.baseScale ?? 1,
		movement: movementOf(data),
		data,
		...extra,
	})["minecraft:entity"];
}
const groupHas = (e: Json, group: string, component: string) => !!e.component_groups[group]?.[component];

/** Invariante: evento que remove um grupo que sobrescreve um componente da base adiciona outro grupo com ele. */
function assertSwapInvariant(e: Json, name: string) {
	const base = new Set(Object.keys(e.components));
	const groups: Json = e.component_groups;
	const steps = (ev: Json): Json[] => [ev, ...(ev.sequence ?? []).flatMap(steps)];
	for (const [evName, ev] of Object.entries<Json>(e.events)) {
		const all = steps(ev);
		const removed = all.flatMap(s => s.remove?.component_groups ?? []);
		const added = new Set(all.flatMap(s => s.add?.component_groups ?? []));
		for (const g of removed) {
			for (const c of Object.keys(groups[g] ?? {})) {
				if (!base.has(c)) continue;
				const replaced = [...added].some(a => groups[a]?.[c]);
				assert.ok(replaced, `${name}: ${evName} remove ${g} (${c} da base) sem trocar por outro grupo`);
			}
		}
		for (const g of [...removed, ...added]) assert.ok(groups[g], `${name}: ${evName} referencia grupo inexistente ${g}`);
	}
}

// ---------------------------------------------------------------------------------------------
// 1. Comportamento → componentes por tipo de movimento

// Andador padrão (espécie sem `behaviour`): wander, flutua, pânico (willFlee padrão = true).
{
	const e = entity({ baseStats: { attack: 50 } });
	assert.ok(e.components["minecraft:navigation.walk"]);
	assert.ok(e.components["minecraft:movement.basic"]);
	assert.ok(e.components["minecraft:behavior.float"], "pokemon_no_underwater: floats");
	assert.equal(e.component_groups["cobblemon:wild_ai"]["minecraft:behavior.random_stroll"].interval, 120, "wanderChance 1/120");
	assert.ok(groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.panic"), "panics");
	assert.ok(!groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.hurt_by_target"));
	assert.ok(!e.component_groups["cobblemon:wild"], "despawn por script (sem minecraft:despawn)");
	assert.ok(!JSON.stringify(e).includes("minecraft:despawn"));
	assert.ok(e.components["minecraft:tameable"], "tameable na base: sendOut chama tame() antes de set_owned");
	assert.deepEqual(e.components["minecraft:type_family"].family, ["pokemon", "mob", "cobblemon_testmon"]);
	assertSwapInvariant(e, "andador");
}

// Voador (fly.canFly): navegação de voo, voo aleatório, sem dano de queda.
{
	const e = entity({ behaviour: { moving: { fly: { canFly: true }, walk: { canWalk: false } } } });
	assert.ok(e.components["minecraft:navigation.fly"]);
	assert.ok(e.components["minecraft:can_fly"]);
	assert.ok(e.components["minecraft:movement.fly"]);
	assert.ok(e.components["minecraft:flying_speed"]);
	assert.equal(e.components["minecraft:damage_sensor"].triggers.cause, "fall");
	assert.ok(groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.random_fly"));
	assert.ok(!groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.random_stroll"), "não anda");
}

// Nadador (respira embaixo d'água e evita terra): navegação genérica só de nado.
{
	const e = entity({ behaviour: { moving: { swim: { canBreatheUnderwater: true, swimSpeed: 0.4 }, walk: { avoidsLand: true } } } });
	const nav = e.components["minecraft:navigation.generic"];
	assert.ok(nav.can_swim && !nav.can_walk);
	assert.equal(e.components["minecraft:underwater_movement"].value, 0.4);
	assert.equal(e.components["minecraft:breathable"].breathes_water, true);
	assert.ok(groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.random_swim"));
	assert.ok(groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.move_to_water"), "moves_to_water: avoidsLand && canSwimInWater");
	assert.ok(!e.components["minecraft:behavior.float"], "quem respira na água não fica boiando");
}

// Anfíbio: anda e nada.
{
	const e = entity({ behaviour: { moving: { swim: { canBreatheUnderwater: true } } } });
	assert.ok(e.components["minecraft:movement.amphibious"]);
	const nav = e.components["minecraft:navigation.generic"];
	assert.ok(nav.can_swim && nav.can_walk);
}

// Nadador de lava (imune a fogo): lava_movement e navegação de chão em lava.
{
	const e = entity({ behaviour: { fireImmune: true, moving: { swim: { canSwimInLava: true, canBreatheUnderlava: true } } } });
	assert.ok(e.components["minecraft:fire_immune"]);
	assert.ok(e.components["minecraft:lava_movement"]);
	assert.equal(e.components["minecraft:navigation.walk"].can_walk_in_lava, true);
	assert.equal(e.components["minecraft:breathable"].breathes_lava, true);
}

// Combate: retaliação (willDefendSelf) + fights_melee; defesa do dono; dano pela curva do Cobblemon.
{
	const e = entity({ baseStats: { attack: 100 }, behaviour: { combat: { willDefendSelf: true, willDefendOwner: true, willFlee: false } } });
	assert.ok(groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.hurt_by_target"));
	assert.ok(groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.melee_box_attack"));
	assert.ok(!groupHas(e, "cobblemon:wild_ai", "minecraft:behavior.panic"));
	assert.ok(groupHas(e, "cobblemon:owned_ai", "minecraft:behavior.owner_hurt_by_target"));
	assert.equal(e.components["minecraft:attack"].damage, meleeDamage(100));
	assert.equal(meleeDamage(5), 1);
	assert.equal(meleeDamage(100), 6, "Ataque 63 no nível 25 → 6 de dano");
}

// Dono: segue a mais de 5 blocos e teleporta a mais de 32; dorme na cama do dono se willSleepOnBed.
{
	const e = entity({ behaviour: { resting: { canSleep: true, willSleepOnBed: true } } });
	const follow = e.component_groups["cobblemon:owned_ai"]["minecraft:behavior.follow_owner"];
	assert.equal(follow.start_distance, 5);
	assert.equal(follow.can_teleport, false);
	assert.equal(e.component_groups["cobblemon:owned_ai"]["minecraft:behavior.teleport_to_owner"].filters.value, 32);
	assert.ok(groupHas(e, "cobblemon:owned_ai", "minecraft:behavior.pet_sleep_with_owner"));
	// Sono: sai toda a IA; acordar devolve a IA certa pela propriedade cobblemon:wild.
	assert.deepEqual(e.events["cobblemon:sleep"].remove.component_groups.sort(), ["cobblemon:idle_look", "cobblemon:owned_ai", "cobblemon:wild_ai"]);
	assert.equal(e.events["cobblemon:sleep"].set_property["cobblemon:sleeping"], true);
	const wake = e.events["cobblemon:wake"].sequence;
	assert.equal(wake[1].filters.domain, "cobblemon:wild");
	assert.deepEqual(wake[1].add.component_groups, ["cobblemon:wild_ai"]);
	assert.deepEqual(wake[2].add.component_groups, ["cobblemon:owned_ai"]);
}

// Herd: segue líder tolerado (tag do script + família da espécie).
{
	const e = entity({ behaviour: { herd: { maxSize: 5, toleratedLeaders: [{ pokemon: "tauros bull_breed=combat", tier: 2 }, { pokemon: "miltank", tier: 1 }] } } });
	const follow = e.component_groups["cobblemon:wild_ai"]["minecraft:behavior.follow_mob"];
	assert.equal(follow.filters.all_of[0].value, "cobblemon_herd_leader");
	assert.deepEqual(follow.filters.all_of[1].any_of.map((f: Json) => f.value), ["cobblemon_tauros", "cobblemon_miltank"]);
}

// Tosquia: espécies com feature "sheared" e pokemon_eats_grass comem grama para recuperar a lã.
{
	const data = { features: ["sheared"], ai: [{ type: "apply_behaviours", behaviours: ["cobblemon:pokemon_eats_grass"] }] };
	assert.ok(behaviourOf(data).shearable && behaviourOf(data).eatsGrass);
	const e = entity(data);
	assert.equal(e.component_groups["cobblemon:wild_ai"]["minecraft:behavior.eat_block"].on_eat.event, "cobblemon:ate_grass");
	assert.ok(e.events["cobblemon:ate_grass"]);
}

// ---------------------------------------------------------------------------------------------
// 2. Tamanho por forma e Alfa

{
	const data = { hitbox: { width: 1, height: 2 }, baseScale: 0.5, forms: [{ name: "Big", aspects: ["big"], baseScale: 1.5 }, { name: "Same", aspects: ["same"] }] };
	const t = sizeTable(data, { width: 1, height: 1 }, 1);
	assert.equal(t.sizes[t.forms[""]].scale, 0.5);
	assert.equal(t.sizes[t.forms.Big].scale, 1.5);
	assert.equal(t.forms.Same, undefined, "forma sem hitbox/baseScale usa o da espécie");
	assert.equal(t.sizes[t.alpha[""]].scale, Math.round(0.5 * alphaMultiplier({ width: 1, height: 2 }, 0.5) * 1000) / 1000);
	// 1.1 + 0.8 × 0.5^clamp(2 × 0.5) = 1.5
	assert.equal(alphaMultiplier({ width: 1, height: 2 }, 0.5), 1.5);
	const e = entity(data);
	for (let i = 0; i < t.sizes.length; i++) {
		assert.ok(e.component_groups[`cobblemon:size_${i}`]["minecraft:scale"]);
		assert.equal(e.events[`cobblemon:size_${i}`].add.component_groups[0], `cobblemon:size_${i}`);
		assert.equal(e.events[`cobblemon:size_${i}`].remove.component_groups.length, t.sizes.length - 1);
	}
	assert.equal(e.description.properties["cobblemon:alpha"].type, "bool");
	assert.deepEqual(e.events["cobblemon:set_alpha"].add.component_groups, [`cobblemon:size_${t.alpha[""]}`]);
	assert.equal(e.events["cobblemon:set_alpha"].set_property["cobblemon:alpha"], true);
	assert.ok(e.events["cobblemon:entity_spawned"] === undefined && e.events["minecraft:entity_spawned"].add.component_groups.includes("cobblemon:size_0"));
	assertSwapInvariant(e, "formas");
}

// ---------------------------------------------------------------------------------------------
// 3. Ombro e montaria

{
	const e = entity({ shoulderMountable: true });
	assert.ok(e.component_groups["cobblemon:family_shoulder"]["minecraft:type_family"].family.includes("pokemon_shoulder"));
	assert.ok(!e.components["minecraft:type_family"].family.includes("pokemon_shoulder"), "família do ombro só enquanto montado");
	assert.deepEqual(e.events["cobblemon:shoulder_on"].add.component_groups, ["cobblemon:family_shoulder"]);
	assertSwapInvariant(e, "ombro");
	const player = JSON.parse(readFileSync(join(ROOT, "behavior_packs", "CobblemonBedrock", "entities", "player.json"), "utf8"));
	assert.ok(player["minecraft:entity"].components["minecraft:rideable"].family_types.includes("pokemon_shoulder"), "player.json aceita pokemon_shoulder");
}

{
	// Geometria com locators seat_1 e seat_2 (pixels; o modelo olha para −z).
	const dir = mkdtempSync(join(tmpdir(), "cobblemon-entidades-"));
	const model = join(dir, "ridemon.geo.json");
	writeFileSync(model, JSON.stringify({ "minecraft:geometry": [{ description: { identifier: "geometry.ridemon" }, bones: [{ name: "body", locators: { seat_1: [0, 16, 8], seat_2: { offset: [4, 16, 16] } } }] }] }));
	const riding = {
		seats: [{ locator: "seat_1" }, { locator: "seat_2" }],
		behaviours: {
			LAND: { key: "cobblemon:land/horse", stats: { SPEED: "50-70", JUMP: "40-60", STAMINA: "30-40", ACCELERATION: "10-20", SKILL: "10-20" } },
			AIR: { key: "cobblemon:air/bird", stats: { SPEED: "60-80", STAMINA: "25-40" } },
			LIQUID: { key: "cobblemon:liquid/dolphin", stats: { SPEED: "40-60" } },
		},
	};
	assert.deepEqual(seatPositions(riding, model, 2, 1), [[-0, 2, -1], [-0.5, 2, -2]]);
	const info = rideInfoOf(riding, 0.35, {})!;
	assert.equal(info.seats, 2);
	assert.deepEqual(Object.keys(info.styles).sort(), ["AIR", "LAND", "LIQUID"]);
	assert.equal(info.styles.AIR!.stamina, 20, "STAMINA 25 → 20 s de voo (get_ride_stats AIR 80..0)");
	assert.ok(info.styles.LAND!.jump >= 0.4 && info.styles.LAND!.jump <= 1);
	assert.equal(rideInfoOf({ seats: [], behaviour: { key: "cobblemon:air/glider" } }, 0.35, {}), undefined, "campo legado `behaviour` e sem assentos: sem montaria");

	const e = entity({ riding, hitbox: { width: 1, height: 1 }, baseScale: 2 }, { modelFile: model });
	const rideable = e.component_groups["cobblemon:rideable"]["minecraft:rideable"];
	assert.equal(rideable.seat_count, 2);
	assert.deepEqual(rideable.family_types, ["player"]);
	assert.equal(rideable.on_rider_enter_event, "cobblemon:on_mount");
	assert.equal(rideable.seats[1].min_rider_count, 1);
	assert.ok(groupHas(e, "cobblemon:ride_land", "minecraft:input_ground_controlled"));
	assert.ok(groupHas(e, "cobblemon:ride_land", "minecraft:can_power_jump"));
	assert.ok(groupHas(e, "cobblemon:ride_air", "minecraft:free_camera_controlled"));
	assert.ok(groupHas(e, "cobblemon:ride_air", "minecraft:vertical_movement_action"));
	assert.equal(e.component_groups["cobblemon:ride_air"]["minecraft:physics"].has_gravity, false);
	assert.ok(groupHas(e, "cobblemon:ride_air", "minecraft:can_fly"), "quem não voa ganha can_fly só montado");
	assert.ok(groupHas(e, "cobblemon:ride_liquid", "minecraft:underwater_mount_breathing"));
	assert.ok(e.events["cobblemon:set_owned"].add.component_groups.includes("cobblemon:rideable"));
	assert.ok(!e.events["minecraft:entity_spawned"].add.component_groups.includes("cobblemon:rideable"), "selvagem não é montável");
	assert.deepEqual(e.events["cobblemon:on_mount"].add.component_groups, ["cobblemon:ride_land", "cobblemon:gravity"]);
	assert.ok(e.events["cobblemon:ride_air"].remove.component_groups.includes("cobblemon:gravity"));
	assertSwapInvariant(e, "montaria");
}

// Regras de troca de estilo (RidingController.checkForNewTransition).
{
	const all = ["LAND", "AIR", "LIQUID"] as const;
	const s = { onGround: true, inLiquid: false, eyeInFluid: false, doubleJump: false, hasDriver: true };
	assert.equal(nextRideStyle(undefined, all, s), "LAND");
	assert.equal(nextRideStyle("LAND", all, { ...s, doubleJump: true }), "AIR", "pulo duplo decola");
	assert.equal(nextRideStyle("AIR", all, { ...s, onGround: false }), "AIR");
	assert.equal(nextRideStyle("AIR", all, s), "LAND", "tocar o chão pousa");
	assert.equal(nextRideStyle("LAND", all, { ...s, onGround: false, inLiquid: true }), "LIQUID");
	assert.equal(nextRideStyle("AIR", ["AIR"], s), "AIR", "só voo: continua no ar no chão");
	assert.equal(nextRideStyle("LAND", ["LAND"], { ...s, doubleJump: true }), "LAND", "sem AIR não decola");
	assert.equal(nextRideStyle("LIQUID", all, { ...s, onGround: false, inLiquid: true, eyeInFluid: true, doubleJump: true }), "LIQUID", "submerso não decola");
	assert.equal(staminaStep(10, 20, "AIR", 1), 9);
	assert.equal(staminaStep(0.5, 20, "AIR", 1), 0);
	assert.equal(staminaStep(19, 20, "LAND", 1), 20);
	assert.equal(staminaStep(5, 0, "AIR", 1), 0, "0 = fôlego infinito");
	assert.ok(staminaBar(10, 20).includes("■"));
}

// ---------------------------------------------------------------------------------------------
// 4. pokemon_interactions

{
	// Parser com os casos do Cobblemon: conjunto com propriedade, requisito por interação, tags de item.
	const sets = parseInteractions([
		{ name: "gogoat", json: { requirements: [{ variant: "properties", target: "gogoat gender=female" }], interactions: [{ grouping: "cobblemon:milking", cooldown: "0", requirements: [{ variant: "owner_held_item", itemCondition: "minecraft:bucket" }], effects: [{ variant: "shrink_item" }, { variant: "give_item", item: "minecraft:milk_bucket" }] }] } },
		{ name: "rotom", json: { requirements: [{ variant: "properties", target: "rotom" }], interactions: [{ grouping: "cobblemon:bucket", cooldown: "6000", requirements: [{ variant: "owner_held_item", itemCondition: "minecraft:bucket" }, { variant: "properties", target: "rotom form=frost" }], effects: [{ variant: "give_item", item: "minecraft:powder_snow_bucket" }] }] } },
		{ name: "pidgey", json: { requirements: [{ variant: "properties", target: "pidgey" }], interactions: [{ grouping: "cobblemon:brush", requirements: [{ variant: "owner_held_item", itemCondition: "#c:tools/brush" }], effects: [{ variant: "shrink_item", amount: 8 }, { variant: "drop_item", item: "minecraft:feather", amount: "1-2" }, { variant: "play_sound", sound: "minecraft:item.brush.brushing.generic" }] }] } },
	], (id) => id);
	assert.deepEqual(sets[0].properties, { gender: "female" });
	assert.deepEqual(sets[1].interactions[0].properties, { form: "frost" });
	assert.equal(sets[1].interactions[0].cooldown, 6000);
	assert.deepEqual(sets[2].interactions[0].items, ["minecraft:brush"]);
	assert.deepEqual(sets[2].interactions[0].effects[1], { type: "drop_item", item: "minecraft:feather", min: 1, max: 2 });
	assert.deepEqual(sets[2].interactions[0].effects[2], { type: "play_sound", sound: "brush.generic" });
	assert.equal(sets[2].interactions[0].cooldown, 0, "sem cooldown = 0");

	const target = (species: string, extra: Partial<InteractionTarget> = {}): InteractionTarget => ({ species, gender: "", formName: "", aspects: [], ...extra });
	assert.equal(findInteraction(sets, target("gogoat", { gender: "m" }), "minecraft:bucket", {}, 0), undefined, "Gogoat macho não dá leite");
	assert.equal(findInteraction(sets, target("gogoat", { gender: "f" }), "minecraft:bucket", {}, 0)?.grouping, "cobblemon:milking");
	assert.equal(findInteraction(sets, target("rotom", { formName: "Wash" }), "minecraft:bucket", {}, 0), undefined);
	assert.ok(findInteraction(sets, target("rotom", { formName: "Frost" }), "minecraft:bucket", {}, 0));
	assert.equal(findInteraction(sets, target("pidgey"), "minecraft:stick", {}, 0), undefined, "item errado");
	assert.equal(findInteraction(sets, target("pidgey"), undefined, {}, 0), undefined, "mão vazia");
	assert.ok(matchesSet(sets[2], target("pidgey")));

	// Cooldown por grouping (Pokemon.interactionCooldowns), relógio absoluto.
	const cd = {};
	startCooldown(cd, "cobblemon:bucket", 6000, 100);
	assert.ok(isOnCooldown(cd, "cobblemon:bucket", 5000));
	assert.ok(!isOnCooldown(cd, "cobblemon:bucket", 6100));
	assert.equal(findInteraction(sets, target("rotom", { formName: "Frost" }), "minecraft:bucket", cd, 200), undefined, "em cooldown");
	assert.ok(findInteraction(sets, target("rotom", { formName: "Frost" }), "minecraft:bucket", cd, 6100));
	startCooldown(cd, "cobblemon:brush", 0, 6200);
	assert.deepEqual(cd, {}, "cooldown 0 não grava e os vencidos saem");
	assert.equal(rollAmount({ min: 1, max: 2 }, () => 0.99), 2);
	assert.equal(rollAmount({ min: 1, max: 2 }, () => 0), 1);
	assert.deepEqual(shearDrops(["color-black"], () => 0.99), { item: "minecraft:black_wool", amount: 4 });
	assert.deepEqual(shearDrops([], () => 0), { item: "minecraft:white_wool", amount: 2 });
}

// Tabela real (generated/scripts/entityData.ts): 167 conjuntos do Cobblemon 1.8.2.
{
	const sets = getInteractionSets();
	assert.equal(sets.length, 167);
	const miltank = sets.find(s => s.species === "miltank")!;
	const milk = findInteraction(sets, { species: "miltank", gender: "f", formName: "", aspects: [] }, "minecraft:bucket", {}, 0)!;
	assert.ok(miltank && milk);
	assert.ok(milk.effects.some(e => e.type === "give_item" && e.item === "minecraft:milk_bucket"));
	const bottle = findInteraction(sets, { species: "miltank", gender: "f", formName: "", aspects: [] }, "minecraft:glass_bottle", {}, 0)!;
	assert.ok(bottle.effects.some(e => e.type === "give_item" && e.item === "cobblemon:moomoo_milk"));
	const brush = findInteraction(sets, { species: "pidgey", gender: "m", formName: "", aspects: [] }, "minecraft:brush", {}, 0)!;
	assert.ok(brush.effects.some(e => e.type === "drop_item" && e.item === "minecraft:feather"));
	const lotad = findInteraction(sets, { species: "lotad", gender: "m", formName: "", aspects: [] }, "minecraft:bone_meal", {}, 0);
	assert.ok(lotad?.effects.some(e => e.type === "drop_item" && e.item === "minecraft:waterlily"), "lily_pad → waterlily");
	for (const s of sets) for (const i of s.interactions) {
		assert.ok(i.items.length > 0, `${s.species}: interação sem item`);
		for (const e of i.effects) if (e.type === "drop_item" || e.type === "give_item") assert.match(e.item, /^(minecraft|cobblemon):[a-z0-9_]+$/);
		for (const e of i.effects) if (e.type === "play_sound") assert.doesNotMatch(e.sound, /^minecraft:/);
	}
}

// ---------------------------------------------------------------------------------------------
// 5. Sono (DrowsySensor / canSleepAt)

{
	assert.deepEqual(parseTimeRanges("night"), TIME_RANGES.night);
	assert.deepEqual(parseTimeRanges(["night, noon"]), [...TIME_RANGES.night, ...TIME_RANGES.noon]);
	assert.deepEqual(parseTimeRanges("167-11833,13702-22299"), [[167, 11833], [13702, 22299]]);
	assert.deepEqual(parseTimeRanges(undefined), TIME_RANGES.night, "padrão do RestBehaviour");
	assert.deepEqual(parseIntRange("0-4"), [0, 4]);
	assert.deepEqual(parseIntRange("-1"), [-1, -1]);
	assert.ok(inRanges(TIME_RANGES.day, 0) && inRanges(TIME_RANGES.day, 23500) && !inRanges(TIME_RANGES.day, 15000));

	const rest = restInfo({ canSleep: true, light: "0-4", drowsyChance: 0.5, rouseChance: 0.1 });
	assert.equal(drowsyStep(false, rest, 18000, false, () => 0.4), true, "noite + sorte → sonolento");
	assert.equal(drowsyStep(false, rest, 18000, false, () => 0.6), false);
	assert.equal(drowsyStep(false, rest, 6000, false, () => 0), false, "de dia não");
	assert.equal(drowsyStep(true, rest, 6000, false, () => 0.9), false, "fora do horário perde a sonolência");
	assert.equal(drowsyStep(false, rest, 18000, true, () => 0), false, "apanhou: não dorme");
	assert.equal(drowsyStep(true, rest, 18000, false, () => 0.05), false, "rouseChance");
	assert.equal(drowsyStep(true, rest, 18000, false, () => 0.5), true);
	assert.equal(drowsyStep(false, restInfo({}), 18000, false, () => 0), false, "canSleep padrão = false");

	assert.ok(canSleepAt(rest, { blockBelow: "minecraft:grass_block", inWater: false, onGround: true }));
	assert.ok(!canSleepAt(rest, { blockBelow: "minecraft:glowstone", inWater: false, onGround: true }), "luz emitida 15 fora de 0-4");
	assert.ok(!canSleepAt(rest, { blockBelow: "minecraft:grass_block", inWater: true, onGround: false }), "na água só com fluids");
	assert.ok(!canSleepAt(rest, { blockBelow: "minecraft:air", inWater: false, onGround: false }), "no ar não");
	const water = restInfo({ canSleep: true, fluids: ["#minecraft:water"] });
	assert.ok(canSleepAt(water, { blockBelow: "minecraft:sand", inWater: true, onGround: false }));
	assert.ok(!canSleepAt(water, { blockBelow: "minecraft:sand", inWater: false, onGround: true }));
	const bright = restInfo({ canSleep: true, light: "11-15" });
	assert.ok(canSleepAt(bright, { blockBelow: "minecraft:sea_lantern", inWater: false, onGround: true }));
}

// ---------------------------------------------------------------------------------------------
// 6. Dados gerados de espécies reais (se o importador já rodou)

{
	const pikachu = getEntityInfo("pikachu");
	assert.ok(pikachu, "generated/scripts/entityData.ts com pikachu");
	assert.ok(isShoulderMountable("pikachu"), "Pikachu vai no ombro");
	assert.ok(!isShoulderMountable("snorlax"));
	const charizard = getRideInfo("charizard");
	assert.ok(charizard?.styles.AIR && charizard.styles.LAND, "Charizard: terra e ar");
	assert.equal(getRideInfo("charizard", "Mega-X"), undefined, "Mega com seats [] não monta");
	assert.ok(getRideInfo("tauros", "Paldea-Aqua")?.styles.LIQUID, "Tauros de Paldea (água) nada montado");
	assert.ok(!getRideInfo("tauros")?.styles.LIQUID);
	assert.ok(getEntityInfo("charizard")!.rideGroups.includes("LIQUID") === false);
	assert.ok(getEntityInfo("tauros")!.rideGroups.includes("LIQUID"), "grupo LIQUID existe pela forma");
	assert.equal(getRideInfo("beedrill"), undefined, "só o campo legado `behaviour`: sem montaria no 1.8.2");
	assert.ok(getEntityInfo("wooloo")?.shearable);
	// Tamanho: forma com hitbox própria e Alfa.
	const alpha = getSizeIndex("pikachu", "", true);
	assert.notEqual(alpha, getSizeIndex("pikachu", "", false));
	assert.ok(pikachu!.sizes[alpha].scale > pikachu!.sizes[0].scale);
	const fakeData = (aspects: string[], name?: string) => ({ aspects, getFormData: () => (name ? { name } as any : undefined) }) as any;
	assert.equal(sizeIndexFor("cobblemon:pikachu", fakeData(["alpha"])), alpha);
	assert.equal(sizeIndexFor("cobblemon:pikachu", fakeData([])), 0);

	const bp = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock", "entities", "pokemon");
	if (existsSync(join(bp, "charizard.json"))) {
		for (const id of ["charizard", "pikachu", "magikarp", "wooloo", "lapras", "slugma"]) {
			const e = JSON.parse(readFileSync(join(bp, `${id}.json`), "utf8"))["minecraft:entity"];
			assertSwapInvariant(e, id);
			for (const ev of ["cobblemon:set_wild", "cobblemon:set_owned", "cobblemon:instant_kill", "cobblemon:interacted", "cobblemon:sleep", "cobblemon:wake", "cobblemon:set_alpha"])
				assert.ok(e.events[ev], `${id}: ${ev}`);
		}
		const charizard = JSON.parse(readFileSync(join(bp, "charizard.json"), "utf8"))["minecraft:entity"];
		const seats = charizard.component_groups["cobblemon:rideable"]["minecraft:rideable"].seats;
		assert.ok(seats[0].position[1] > 0.5, "assento do Charizard vem do locator seat_1");
		const magikarp = JSON.parse(readFileSync(join(bp, "magikarp.json"), "utf8"))["minecraft:entity"];
		assert.ok(magikarp.components["minecraft:navigation.generic"]?.can_swim, "Magikarp nada");
		const pikachuJson = JSON.parse(readFileSync(join(bp, "pikachu.json"), "utf8"))["minecraft:entity"];
		assert.ok(pikachuJson.events["cobblemon:shoulder_on"]);
	}
}

console.warn = originalWarn;
console.log("ok: entidades (IA por comportamento, tamanho/Alfa, ombro, montaria, interações, cooldowns, sono)");
