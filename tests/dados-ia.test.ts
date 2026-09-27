// Frente "dados-ia": q.has_aspect nos posers (bits sincronizados ao cliente), species_feature_assignments, presets de
// IA de espécie (behaviours → grupos de componentes), flags de NPC, pasto "ataca mobs hostis", camadas com
// scrolling e assentos condicionais. A API do Minecraft é mockada.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildServerEntity } from "../tools/importer/entities.ts";
import type { ServerEntityInput } from "../tools/importer/entities.ts";
import { movementOf } from "../tools/importer/species.ts";
import { CONTEXTS, aiComponents, behaviourStruct, entityConditionFilter, evalCondition, extraComponents, pointsToSpawn, resolvePokemonAi } from "../tools/importer/pokemonBehaviours.ts";
import { aspectBitLines, aspectsPropertyRange, scrollingUvAnim, speciesAspectBits } from "../tools/importer/dadosIa.ts";
import { aspectVar, rewriteHasAspect } from "../tools/importer/posers.ts";
import { aspectMask, syncAspectBits } from "../scripts/entity/AspectSync";
import { pointsToSpawn as scriptPointsToSpawn } from "../scripts/entity/SpeciesAi";
import { POINT_TO_SPAWN_SPECIES } from "../scripts/visual/PointToSpawn";
import { availableSeatCount, seatEntityStruct } from "../scripts/entity/SeatConditions";
import { allAspectsOf, applyFeatureDefaults, defaultValue, featureDef, featureNamesOf, getFeatureProperty, setFeatureProperty, sharedAssignedFeatureAspects } from "../scripts/pokemon/FeatureAssignments";
import { effectiveNpcFlags, applyNpcFlags, setNpcFlag, NPC_FLAG_PROPS } from "../scripts/npc/NpcFlags";
import { IGNORED_HOSTILE_FAMILIES, isValidPastureTarget, setPastureConflict } from "../scripts/machines/pastureConflict";
import { PokemonData } from "../scripts/Pokemon";
import { PokemonProperties } from "../scripts/PokemonProperties";
import { getSpeciesData } from "../scripts/speciesData";
import { initializeEvolutions } from "../scripts/evolution";
import { runMolangTests } from "./dados-ia-molang";

const originalWarn = console.warn;
console.warn = () => { };
const ROOT = process.cwd();
const GEN = join(ROOT, "generated");
const DATA = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon");
type Json = Record<string, any>;
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const species = (path: string) => json(join(DATA, "species", `${path}.json`));

// ---------------------------------------------------------------------------------------------
// 1. #28 q.has_aspect nos posers

{
	const sink = new Set<string>();
	assert.equal(rewriteHasAspect("q.has_aspect('sheared') == 0.0", sink), `${aspectVar("sheared")} == 0.0`);
	assert.equal(rewriteHasAspect("query.has_aspect(\"regrown-tail-1\")", sink), "v.cobblemon_aspect_regrown_tail_1");
	assert.deepEqual([...sink].sort(), ["regrown-tail-1", "sheared"]);
	assert.deepEqual(speciesAspectBits([{ aspects: ["b", "a"] }, { aspects: ["a", "c"] }]), ["a", "b", "c"]);
	assert.deepEqual(aspectsPropertyRange(1), [0, 1]);
	assert.deepEqual(aspectsPropertyRange(3), [0, 7]);
	assert.deepEqual(aspectBitLines(["x", "y"]), [
		"v.cobblemon_aspect_x = math.mod(math.floor(q.property('cobblemon:aspects') / 1), 2);",
		"v.cobblemon_aspect_y = math.mod(math.floor(q.property('cobblemon:aspects') / 2), 2);",
	]);
	// Poser Kotlin convertido do Mareep: lã e caminhada dependem do aspect (antes a lã ficava sempre escondida).
	const mareep = json(join(ROOT, "tools", "importer", "data", "kotlin-posers", "mareep.json"));
	assert.equal(mareep.poses.standing.transformedParts[0].isVisible, "q.has_aspect('sheared') == false");
	assert.deepEqual(mareep.poses.walk.animations.filter((a: unknown) => typeof a === "object").map((a: Json) => a.condition), ["q.has_aspect('sheared') == false", "q.has_aspect('sheared')"]);
	for (const id of ["wooloo", "dubwool"]) {
		const poser = json(join(ROOT, "tools", "importer", "data", "kotlin-posers", `${id}.json`));
		assert.ok(Object.values<Json>(poser.poses).every(p => (p.transformedParts ?? []).every((t: Json) => t.isVisible === "q.has_aspect('sheared') == false")), `${id}: lã pelo aspect`);
	}
	// Bits na entidade (script).
	assert.equal(aspectMask("slowpoke", ["regrown-tail-1", "regrown-tail-3"]), 5);
	assert.equal(aspectMask("cobblemon:mareep", ["sheared"]), 1);
	assert.equal(aspectMask("pikachu", ["sheared"]), 0, "espécie sem aspects de poser");
	const props: Record<string, unknown> = { "cobblemon:aspects": 0 };
	const fake = { typeId: "cobblemon:mareep", getProperty: (k: string) => props[k] as any, setProperty: (k: string, v: any) => { props[k] = v; } };
	assert.equal(syncAspectBits(fake, ["sheared", "male"]), true);
	assert.equal(props["cobblemon:aspects"], 1);
	assert.equal(syncAspectBits(fake, ["sheared"]), false, "sem mudança não escreve");
	assert.equal(syncAspectBits({ ...fake, typeId: "cobblemon:pikachu" }, ["sheared"]), false);
	// Conteúdo gerado (npm run import).
	const rpEntity = join(GEN, "resource_packs", "CobblemonBedrock", "entity", "pokemon", "mareep.entity.json");
	if (existsSync(rpEntity)) {
		const pre: string[] = json(rpEntity)["minecraft:client_entity"].description.scripts.pre_animation;
		assert.ok(pre.includes("v.cobblemon_aspect_sheared = math.mod(math.floor(q.property('cobblemon:aspects') / 1), 2);"));
		const bp = json(join(GEN, "behavior_packs", "CobblemonBedrock", "entities", "pokemon", "mareep.json"))["minecraft:entity"];
		assert.deepEqual(bp.description.properties["cobblemon:aspects"], { type: "int", range: [0, 1], default: 0, client_sync: true });
		const ctrl = json(join(GEN, "resource_packs", "CobblemonBedrock", "animation_controllers", "pokemon", "mareep.animation_controllers.json"));
		assert.ok(JSON.stringify(ctrl).includes("v.cobblemon_aspect_sheared"), "caminhada do Mareep pelo aspect");
		assert.ok(!JSON.stringify(ctrl).includes("== false"), "literal false vira 0.0 no Molang");
		const slowpoke = json(join(GEN, "resource_packs", "CobblemonBedrock", "animations", "pokemon", "_generated", "slowpoke.animation.json"));
		assert.ok(JSON.stringify(slowpoke).includes("v.cobblemon_aspect_regrown_tail_2"), "cauda do Slowpoke pelo aspect");
		assert.equal(json(join(GEN, "behavior_packs", "CobblemonBedrock", "entities", "pokemon", "pikachu.json"))["minecraft:entity"].description.properties["cobblemon:aspects"], undefined, "sem propriedade sem aspects de poser");
		for (const [id, e] of [["pikachu", 0], ["charizard", 0], ["slowpoke", 0]] as const) {
			const n = Object.keys(json(join(GEN, "behavior_packs", "CobblemonBedrock", "entities", "pokemon", `${id}.json`))["minecraft:entity"].description.properties).length;
			assert.ok(n + e <= 32, `${id}: ${n} propriedades (limite 32)`);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// 2. #111 presets de IA de espécie (behaviours)

{
	const scope = { resolve: (p: string) => ({ "q.a": 1, "q.b": 0 } as Record<string, number>)[p] };
	assert.equal(evalCondition("q.a && !q.b", scope, "t"), true);
	assert.equal(evalCondition("q.b ? q.desconhecido : 1", scope, "t"), true, "ramo não usado não é avaliado");
	assert.equal(evalCondition("(q.a || q.b) && 2 > 1", scope, "t"), true);
	assert.equal(evalCondition("q.desconhecido", scope, "t"), false, "desconhecido = falso");
	assert.equal(behaviourStruct({})["combat.will_flee"], 1, "padrão CombatBehaviour.willFlee");
	assert.equal(behaviourStruct({ behaviour: { moving: { walk: { canWalk: false }, fly: { canFly: true } } } })["moving.can_move"], 1);

	const input = (data: Json) => {
		const m = movementOf(data);
		return { movement: m, data, aquatic: m.canBreatheUnderwater && (m.avoidsLand || !m.canWalk) && !m.canFly, shearable: false, toleratedLeaders: [] as string[] };
	};
	const comps = (data: Json, ctx: keyof typeof CONTEXTS) => aiComponents(resolvePokemonAi(data, CONTEXTS[ctx], "teste"), input(data));
	// Andador padrão: passeio, pânico, sem ataque; Alfa revida (retaliates com is_alpha) e luta corpo a corpo.
	const walker = { baseStats: { attack: 50 } };
	const w = comps(walker, "wild");
	assert.ok(w["minecraft:behavior.random_stroll"] && w["minecraft:behavior.panic"]);
	assert.ok(!w["minecraft:behavior.hurt_by_target"] && !w["minecraft:behavior.melee_box_attack"], "fights_melee sem switch_to_fight não ataca");
	const alpha = extraComponents(comps(walker, "wildAlpha"), w);
	assert.deepEqual(Object.keys(alpha).sort(), ["minecraft:behavior.hurt_by_target", "minecraft:behavior.melee_box_attack"]);
	// No time: segue o dono (5 / teleporta a 32), vai para a terra se não respira embaixo d'água.
	const party = comps(walker, "party");
	assert.equal(party["minecraft:behavior.follow_owner"].start_distance, 5);
	assert.equal(party["minecraft:behavior.teleport_to_owner"].filters.value, 32);
	assert.ok(party["minecraft:behavior.move_to_land"], "avoids_water (go_to_land)");
	assert.ok(!party["minecraft:behavior.panic"], "panics só fora do time");
	// Pasto com "ataca mobs hostis": alvo em monstros (sem creeper/slime/piglin) + ataque.
	const pasture = extraComponents(extraComponents(comps(walker, "pasturedConflict"), comps(walker, "pastured")), w);
	const target = pasture["minecraft:behavior.nearest_attackable_target"];
	assert.ok(target && pasture["minecraft:behavior.melee_box_attack"]);
	assert.equal(target.entity_types[0].filters.all_of[0].value, "monster");
	assert.deepEqual(target.entity_types[0].filters.all_of[1].none_of.map((f: Json) => f.value), IGNORED_HOSTILE_FAMILIES);

	// Dados reais: Pidgeotto no time ataca Magikarp na superfície (target_entity + defend_owner → switch_to_fight).
	const pidgeotto = species("generation1/pidgeotto");
	const pParty = comps(pidgeotto, "party");
	const mk = pParty["minecraft:behavior.nearest_attackable_target"].entity_types[0].filters.all_of;
	assert.deepEqual(mk.map((f: Json) => f.value), ["pokemon", "cobblemon_magikarp", false]);
	assert.ok(!comps(pidgeotto, "wild")["minecraft:behavior.nearest_attackable_target"], "selvagem sem retaliates não caça");
	assert.deepEqual(entityConditionFilter("q.entity.is_pokemon"), { test: "is_family", subject: "other", value: "pokemon" });
	assert.equal(entityConditionFilter("q.entity.health < 5"), undefined, "condição sem tradução");
	// Ninjask: alturas de voo do set_variables (2..10).
	const ninjask = comps(species("generation3/ninjask"), "wild")["minecraft:behavior.random_fly"];
	assert.deepEqual([ninjask.y_dist, ninjask.y_offset], [4, 6]);
	// Nosepass: point_to_spawn (script).
	assert.ok(pointsToSpawn(resolvePokemonAi(species("generation3/nosepass"), CONTEXTS.wild)));
	assert.ok(!pointsToSpawn(resolvePokemonAi(walker, CONTEXTS.wild)));
	// Combee: pokemon_bee + fights_melee da espécie, retaliates → sem extra de Alfa.
	const combee = species("generation4/combee");
	assert.deepEqual(extraComponents(comps(combee, "wildAlpha"), comps(combee, "wild")), {});

	// Entidade: grupos e eventos.
	const entity = (data: Json, extra: Partial<ServerEntityInput> = {}) => buildServerEntity({ id: "testmon", variants: 2, hitbox: { width: 1, height: 1 }, baseScale: 1, movement: movementOf(data), data, ...extra })["minecraft:entity"];
	const e = entity(walker);
	assert.ok(e.component_groups["cobblemon:alpha_ai"]["minecraft:behavior.hurt_by_target"]);
	assert.ok(e.component_groups["cobblemon:pasture_conflict"]["minecraft:behavior.nearest_attackable_target"]);
	assert.equal(e.events["cobblemon:set_alpha"].trigger, "cobblemon:alpha_ai_refresh");
	assert.deepEqual(e.events["cobblemon:alpha_ai_refresh"].sequence[0].add.component_groups, ["cobblemon:alpha_ai"]);
	assert.ok(e.events["cobblemon:unset_alpha"].remove.component_groups.includes("cobblemon:alpha_ai"));
	assert.ok(e.events["cobblemon:battle_start"].remove.component_groups.includes("cobblemon:alpha_ai"));
	assert.ok(e.events["cobblemon:battle_start"].remove.component_groups.includes("cobblemon:pasture_conflict"));
	assert.equal(e.events["cobblemon:battle_start"].set_property["cobblemon:pasture_conflict"], false);
	assert.ok(!Object.keys(e.component_groups["cobblemon:in_battle"]).some(c => c in e.components), "in_battle não redefine componentes da base");
	const end = e.events["cobblemon:battle_end"].sequence;
	assert.deepEqual(end[end.length - 1].add.component_groups, ["cobblemon:alpha_ai"]);
	assert.ok(!e.events["cobblemon:sleep"].remove.component_groups.includes("cobblemon:alpha_ai"), "sono não tira a retaliação");
	assert.ok(e.events["cobblemon:set_owned"].remove.component_groups.includes("cobblemon:alpha_ai"));
	assert.deepEqual(e.events["cobblemon:enable_pasture_conflict"], { add: { component_groups: ["cobblemon:pasture_conflict"] }, set_property: { "cobblemon:pasture_conflict": true } });
	assert.deepEqual(e.description.properties["cobblemon:pasture_conflict"], { type: "bool", default: false });
	// Espécie sem extra de Alfa: grupo e passos somem; evento de refresh fica vazio (o trigger continua válido).
	const c = entity(combee, { id: "combee" });
	assert.equal(c.component_groups["cobblemon:alpha_ai"], undefined);
	assert.deepEqual(c.events["cobblemon:alpha_ai_refresh"], {});
	// Nenhum componente de grupo novo está na base (remover o grupo não apaga componente da base).
	for (const g of ["cobblemon:alpha_ai", "cobblemon:pasture_conflict"]) for (const k of Object.keys(e.component_groups[g] ?? {})) assert.ok(!(k in e.components), `${g}: ${k} na base`);
	const bpDir = join(GEN, "behavior_packs", "CobblemonBedrock", "entities", "pokemon");
	if (existsSync(join(bpDir, "pidgeotto.json"))) {
		const gen = json(join(bpDir, "pidgeotto.json"))["minecraft:entity"];
		assert.ok(gen.component_groups["cobblemon:owned_ai"]["minecraft:behavior.nearest_attackable_target"], "Pidgeotto gerado caça Magikarp");
		assert.ok(json(join(bpDir, "nosepass.json"))["minecraft:entity"].component_groups["cobblemon:wild_ai"]);
	}
	assert.ok(scriptPointsToSpawn("cobblemon:nosepass") || !existsSync(join(bpDir, "nosepass.json")));
	assert.ok(!scriptPointsToSpawn("pikachu"));
	// review-fixes: o giro é só o de scripts/visual/PointToSpawn.ts, com a lista vinda do dado gerado.
	assert.ok(POINT_TO_SPAWN_SPECIES.every(type => scriptPointsToSpawn(type)), "lista do PointToSpawn = SPECIES_AI");
	assert.ok(POINT_TO_SPAWN_SPECIES.includes("cobblemon:nosepass") || !existsSync(join(bpDir, "nosepass.json")));
}

// ---------------------------------------------------------------------------------------------
// 3. #109 species_feature_assignments

{
	const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
	assert.ok(featureNamesOf("spinda").includes("face_spots"));
	assert.ok(featureNamesOf("vivillon").includes("vivillon_wings"));
	assert.ok(featureNamesOf("wooloo").includes("color") && featureNamesOf("wooloo").includes("sheared"), "species.features + atribuições");
	const color = featureDef("color")!;
	assert.equal(defaultValue(color), "none", "padrão que é uma escolha");
	assert.equal(defaultValue(featureDef("vivillon_wings")!), "meadow");
	assert.equal(defaultValue(featureDef("claw")!, () => 0.9), "right", "random");
	assert.equal(defaultValue(featureDef("absofusion")!), undefined, "\"none\" fora das escolhas = sem valor");
	assert.equal(defaultValue(featureDef("alolan")!), "false");
	assert.ok(allAspectsOf(featureDef("claw")!).includes("claw-left"));
	// Criação: padrões e sorteios.
	const vivillon = { species: "vivillon", aspects: ["male"] };
	assert.equal(applyFeatureDefaults(vivillon), true);
	assert.ok(vivillon.aspects.includes("vivillon-wings-meadow"));
	assert.equal(applyFeatureDefaults(vivillon), false, "quem já tem valor fica");
	const spinda = { species: "spinda", aspects: [] as string[] };
	applyFeatureDefaults(spinda, seq(0));
	assert.ok(spinda.aspects.includes("face-spots-none") && spinda.aspects.includes("left-ear-spots-none"), JSON.stringify(spinda.aspects));
	const wooloo = { species: "wooloo", aspects: [] as string[] };
	applyFeatureDefaults(wooloo);
	assert.ok(wooloo.aspects.includes("color-none") && !wooloo.aspects.includes("sheared"), "flag falsa não vira aspect");
	// Evolução: a feature que a espécie nova também tem fica.
	assert.deepEqual(sharedAssignedFeatureAspects(["color-red", "sheared", "male"], "dubwool").sort(), ["color-red", "sheared"]);
	assert.deepEqual(sharedAssignedFeatureAspects(["alolan", "region-bias-alola"], "raichu"), ["alolan"], "region_bias é só do Pikachu");
	// Propriedades chave=valor e matches.
	const cream = { species: "alcremie", aspects: ["cream-vanilla"] };
	assert.equal(setFeatureProperty(cream, "cream", "ruby"), true);
	assert.deepEqual(cream.aspects, ["cream-ruby"]);
	assert.equal(getFeatureProperty(cream, "cream"), "ruby");
	assert.equal(setFeatureProperty(cream, "colour", "red"), false, "feature de outra espécie");
	assert.equal(getFeatureProperty({ species: "electrode", aspects: [] }, "hisuian"), "false");
	// Pokémon gerado.
	const alcremie = PokemonData.generateNewWildPokemon("alcremie", { level: 10, shiny: false });
	assert.equal(alcremie.aspects.filter(a => a.startsWith("cream-")).length, 1, "creme sorteado");
	assert.equal(alcremie.aspects.filter(a => a.startsWith("decoration-")).length, 1, "decoração sorteada");
	const mimikyu = PokemonData.generateNewWildPokemon("mimikyu", { level: 10, shiny: false });
	assert.ok(mimikyu.aspects.includes("disguised-form"), "padrão \"disguised\" do disguise_form");
	const parsed = PokemonProperties.parse("alcremie cream=mint decoration=star");
	assert.ok(parsed.match(Object.assign(PokemonData.generateNewWildPokemon("alcremie", { level: 10 }), { aspects: ["cream-mint", "decoration-star"] })));
	assert.ok(!parsed.match(Object.assign(PokemonData.generateNewWildPokemon("alcremie", { level: 10 }), { aspects: ["cream-ruby", "decoration-star"] })));
	const applied = PokemonProperties.parse("cream=lemon").apply(alcremie);
	assert.equal(applied.aspects.filter(a => a.startsWith("cream-")).join(), "cream-lemon");
	// Evolução do Wooloo leva a cor; Wurmple segue com um casulo só.
	const w2 = PokemonData.generateNewWildPokemon("wooloo", { level: 30, shiny: false });
	w2.aspects = [...w2.aspects.filter(a => !a.startsWith("color-")), "color-blue"];
	const dubwool = PokemonProperties.parse("dubwool").apply(w2);
	assert.ok(dubwool.aspects.includes("color-blue"), JSON.stringify(dubwool.aspects));
	for (let i = 0; i < 10; i++) {
		const wurmple = PokemonData.generateNewWildPokemon("wurmple", { level: 10 });
		assert.equal(wurmple.aspects.filter(a => a.endsWith("-cocoon")).length, 1);
		assert.equal(initializeEvolutions(getSpeciesData("wurmple")!.evolutions).filter(evo => evo.test(wurmple)).length, 1);
	}
}

// ---------------------------------------------------------------------------------------------
// 4. isMovable / isLeashable / allowProjectileHits

{
	const dyn: Record<string, unknown> = {};
	const props: Record<string, unknown> = { "cobblemon:projectile_hits": true };
	const events: string[] = [];
	const npc = {
		getDynamicProperty: (k: string) => dyn[k],
		setDynamicProperty: (k: string, v?: unknown) => { if (v === undefined) delete dyn[k]; else dyn[k] = v; },
		getProperty: (k: string) => props[k] as any,
		setProperty: (k: string, v: any) => { props[k] = v; },
		triggerEvent: (ev: string) => { events.push(ev); },
	};
	assert.deepEqual(effectiveNpcFlags(npc, {}), { movable: true, leashable: true, projectileHits: true }, "padrão do NPCClass");
	assert.deepEqual(effectiveNpcFlags(npc, { isMovable: false, allowProjectileHits: false }), { movable: false, leashable: true, projectileHits: false });
	applyNpcFlags(npc, { movable: false, leashable: false, projectileHits: false });
	assert.deepEqual(events, ["cobblemon:npc_set_immovable", "cobblemon:npc_set_unleashable"]);
	assert.equal(props["cobblemon:projectile_hits"], false);
	events.length = 0;
	setNpcFlag(npc, "movable", true, { isMovable: false });
	assert.equal(dyn[NPC_FLAG_PROPS.movable], true, "valor do NPC vence o da classe");
	assert.equal(events[0], "cobblemon:npc_set_movable");
	const npcJson = join(GEN, "behavior_packs", "CobblemonBedrock", "entities", "npc", "npc.json");
	if (existsSync(npcJson)) {
		const e = json(npcJson)["minecraft:entity"];
		assert.equal(e.component_groups["cobblemon:npc_pushable"]["minecraft:pushable"].is_pushable, true);
		assert.equal(e.component_groups["cobblemon:npc_not_pushable"]["minecraft:pushable"].is_pushable, false);
		assert.ok(e.component_groups["cobblemon:npc_leashable"]["minecraft:leashable"]);
		assert.ok(e.components["minecraft:damage_sensor"].triggers.some((t: Json) => t.cause === "projectile" && t.on_damage?.filters?.domain === "cobblemon:projectile_hits" && t.deals_damage === "no"));
		assert.deepEqual(e.events["cobblemon:npc_set_movable"].add.component_groups, ["cobblemon:npc_pushable"]);
		assert.ok(e.events["minecraft:entity_spawned"].add.component_groups.includes("cobblemon:npc_pushable"));
	}
}

// ---------------------------------------------------------------------------------------------
// 5. Pasto: "ataca mobs hostis" pela IA

{
	const family = (...families: string[]) => ({ hasTypeFamily: (f: string) => families.includes(f) });
	const mob = (families: string[], x = 0) => ({ isValid: true, location: { x, y: 0, z: 0 }, getComponent: () => family(...families) }) as any;
	const inside = (loc: { x: number }) => Math.abs(loc.x) <= 5;
	assert.ok(isValidPastureTarget(mob(["monster", "zombie"]), inside));
	assert.ok(!isValidPastureTarget(mob(["monster", "creeper"]), inside), "Creeper fica de fora");
	assert.ok(!isValidPastureTarget(mob(["monster", "slime"]), inside));
	assert.ok(!isValidPastureTarget(mob(["monster", "zombie"], 20), inside), "fora da área do pasto");
	assert.ok(!isValidPastureTarget(mob(["animal"]), inside));
	const props: Record<string, unknown> = { "cobblemon:pasture_conflict": false, "cobblemon:in_battle": false };
	const fired: string[] = [];
	const pokemon = { isValid: true, getProperty: (k: string) => props[k], triggerEvent: (ev: string) => { fired.push(ev); props["cobblemon:pasture_conflict"] = ev.startsWith("cobblemon:enable"); } } as any;
	assert.equal(setPastureConflict(pokemon, true), true);
	assert.equal(setPastureConflict(pokemon, true), false, "já ligado");
	props["cobblemon:in_battle"] = true;
	assert.equal(setPastureConflict(pokemon, false), true);
	assert.equal(setPastureConflict(pokemon, true), false, "não liga em batalha");
	assert.deepEqual(fired, ["cobblemon:enable_pasture_conflict", "cobblemon:disable_pasture_conflict"]);
}

// ---------------------------------------------------------------------------------------------
// 6. #84 só datapack: scrolling e assentos condicionais

{
	assert.equal(scrollingUvAnim([undefined, undefined]), undefined);
	assert.deepEqual(scrollingUvAnim([{ speedU: 0.1, speedV: 0 }, { speedU: 0.1, speedV: 0 }]), { offset: ["math.mod(q.life_time * 0.1, 1.0)", "0.0"], scale: [1, 1] });
	const mixed = scrollingUvAnim([{ speedU: 0.5, speedV: 0 }, undefined, undefined])!;
	assert.equal(mixed.offset[0], "(v.cobblemon_variant == 0) ? math.mod(q.life_time * 0.5, 1.0) : (0.0)");
	const subject = { species: "testmon", formName: "", aspects: ["alpha"], level: 30, shiny: false, wild: false, passengers: 0 };
	assert.equal(availableSeatCount(subject, 3), 3, "sem condição: todos");
	assert.equal(availableSeatCount(subject, 3, [null, "q.entity.is_alpha", "q.entity.level >= 50"]), 2);
	assert.equal(availableSeatCount({ ...subject, aspects: [] }, 3, [null, "q.entity.is_alpha", "q.entity.has_aspect('big')"]), 1);
	assert.equal(availableSeatCount({ ...subject, passengers: 1 }, 2, [null, "q.passenger_count < 1"]), 1);
	assert.equal(availableSeatCount(subject, 2, [null, "(("]), 1, "condição quebrada = assento fechado");
	assert.equal(seatEntityStruct(subject).get("is_alpha"), 1);
}

// ---------------------------------------------------------------------------------------------
// 7. #70/#84 MoLang de datapack (funções gerais, q.pokemon, q.item, q.player, q.world): tests/dados-ia-molang.ts

runMolangTests();

console.warn = originalWarn;
console.log("ok: dados-ia (q.has_aspect, species features, IA por behaviours, NPC, pasto, scrolling, assentos condicionais, MoLang)");
