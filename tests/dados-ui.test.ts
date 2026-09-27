// Frente "dados-ui": PokemonProperties completo, estatísticas de jogador, PC (ordenar/filtro), markings, atributos
// de montaria, Move Dex, spawn rules, efeitos dos temperos, requisitos genéricos, controles de montaria, HUD de EXP e
// packs embutidos. API do Minecraft mockada (tests/mocks).
import assert from "node:assert/strict";
import { PokemonData } from "../scripts/Pokemon";
import { PokemonProperties, splitMap } from "../scripts/PokemonProperties";
import { COBBLEMON_STATS, awardStat, formatStat, getStats, parseStats } from "../scripts/events/PlayerStats";
import { parseSearch, searchPasses, sortPokemon } from "../scripts/pokemon/SortMode";
import { cycleMarking, getMarkings, markingsText } from "../scripts/pokemon/Markings";
import {
  addRideBoosts, applyAprijuice, canApplyRideBoost, getBaseRideStat, getMaxRideBoost, getRideStat, rideBoostCompletion, rideComponentValues,
  rideInfoOf, statRange,
} from "../scripts/pokemon/RideStats";
import { evaluateRideSound, loopKind, resolveRideSound } from "../scripts/pokemon/RideSounds";
import { buildLearnsetEntries, filterAndSort, formatPercentage, hasDiscoveredMove, collectEvolutionForms } from "../scripts/pokedex/MoveDex";
import { PokedexRecords } from "../scripts/pokedex/PokedexRecords";
import { BASE_SPAWN_RULES, convertCondition, parseSpawnRule, setSpawnRulesForTests, spawnRulesInfluence } from "../scripts/spawning/SpawnRules";
import { effectsToCleanse, isCobblemonMobEffect } from "../scripts/events/MobEffects";
import { AreaRequirement, ChanceRequirement, NegateRequirement, evaluateChance } from "../scripts/evolution/requirements/GenericRequirements";
import { initializeRequirement } from "../scripts/evolution/requirements";
import { rideControlSet } from "../scripts/ui/RideControls";
import { statsBody } from "../scripts/ui/StatsScreen";
import { PARTY_FIELDS, PARTY_SLOTS, encodePartyBody, recordBytes, utf8Length } from "../scripts/ui/hudProtocol";
import { nextStatsPage, rideStatLines } from "../scripts/GUI/Summary";
import { enabledPacks, mergeSounds } from "../tools/importer/embeddedPacks";
import { getConfig } from "../scripts/Config";

const make = (species = "pikachu", level = 20) => PokemonData.generateNewWildPokemon(species, { level, shiny: false });

class FakeHolder {
  id = "p1";
  name = "Ash";
  isValid = true;
  props = new Map<string, unknown>();
  getDynamicProperty(key: string) { return this.props.get(key); }
  setDynamicProperty(key: string, value?: unknown) { if (value === undefined) this.props.delete(key); else this.props.set(key, value); }
}

// ---------------------------------------------------------------------------------------------
// 1. PokemonProperties (chaves do PokemonProperties.kt 1.8.2 + CustomPokemonProperty)
{
  assert.deepEqual(splitMap('pikachu nickname="Mr Sparky" level=5'), [["pikachu", undefined], ["nickname", "Mr Sparky"], ["level", "5"]]);
  const quoted = PokemonProperties.parse('pikachu nickname="Mr Sparky"');
  assert.equal(quoted.name, "Mr Sparky");

  const p = PokemonProperties.parse("pikachu originaltrainer=Misty originaltrainertype=npc aspect=festive unaspect=old type=electric scale_modifier=1.2 tag=legendary label=gen1 alpha tera_type=water dmax=3 gmax status=burn min_perfect_ivs=2 uncatchable battleClone held_item_visible=false fullness=4 form=Normal");
  assert.equal(p.species, "pikachu");
  assert.equal(p.originalTrainer, "Misty");
  assert.equal(p.originalTrainerType, "npc");
  assert.deepEqual(p.forcedAspects, ["festive"]);
  assert.deepEqual(p.unaspects, ["old"]);
  assert.equal(p.type, "electric");
  assert.equal(p.scaleModifier, 1.2);
  assert.deepEqual(p.labels, ["legendary", "gen1"]);
  assert.equal(p.isAlpha, true);
  assert.equal(p.teraType, "water");
  assert.equal(p.dmaxLevel, 3);
  assert.equal(p.gmaxFactor, true);
  assert.equal(p.status, "brn");
  assert.equal(p.minPerfectIvs, 2);
  assert.equal(p.uncatchable, true);
  assert.equal(p.battleClone, true);
  assert.equal(p.heldItemVisible, false);
  assert.equal(p.fullness, 4);
  assert.equal(p.form, "Normal");
  assert.deepEqual(p.extra, {}, "nenhuma chave do Cobblemon cai em extra");

  const mon = make("pikachu", 30);
  mon.aspects.push("old");
  const applied = PokemonProperties.parse("originaltrainer=Misty originaltrainertype=npc aspect=festive unaspect=old scale_modifier=1.2 status=par tera_type=water held_item_visible=false min_perfect_ivs=6").apply(mon);
  assert.equal(applied.ogTrainer, "Misty");
  assert.equal(applied.ogTrainerType, "npc");
  assert.ok(applied.aspects.includes("festive") && applied.forcedAspects?.includes("festive"));
  assert.ok(!applied.aspects.includes("old"), "unaspect tira o aspecto forçado");
  assert.equal(applied.scaleModifier, 1.2);
  assert.equal(applied.status, "par");
  assert.equal(applied.teraType, "water");
  assert.equal(applied.heldItemVisible, false);
  assert.ok(Object.values(applied.ivs).every(iv => iv === 31), "min_perfect_ivs=6");
  assert.ok(PokemonProperties.parse("aspect=festive type=electric scale_modifier=1.2 originaltrainer=Misty originaltrainertype=npc").match(applied));
  assert.ok(!PokemonProperties.parse("type=water").match(applied));
  assert.ok(PokemonProperties.parse("unaspect=old").match(applied));
  assert.ok(!PokemonProperties.parse("unaspect=festive").match(applied));
  // no_ai/freeze_frame só existem na entidade: o matcher de Pokémon é falso.
  assert.ok(!PokemonProperties.parse("pikachu no_ai").match(applied));
  assert.equal(PokemonProperties.parse("freeze_frame=1.5").freezeFrame, 1.5);
  // originaltrainertype=none limpa o OT.
  assert.equal(PokemonProperties.parse("ottype=none").apply(applied).ogTrainer, undefined);
  // Gênero solto e nível exato (commonMatches compara igualdade).
  assert.equal(PokemonProperties.parse("female").gender, "f");
  assert.ok(!PokemonProperties.parse("level=29").match(applied));
  assert.ok(PokemonProperties.parse("level=30").match(applied));
  // Rótulos da espécie (LabelProperty).
  const mewtwo = make("mewtwo", 70);
  assert.ok(PokemonProperties.parse("label=legendary").match(mewtwo));
  assert.ok(!PokemonProperties.parse("tag=legendary").match(applied));
  // Uncatchable vira o aspecto lido pela captura.
  assert.ok(PokemonProperties.parse("uncatchable").apply(make()).aspects.includes("uncatchable"));
  // asString: vazio sem nada; com algo, relê igual.
  assert.equal(PokemonProperties.parse("").asString(), "");
  const again = PokemonProperties.parse(PokemonProperties.parse("pikachu level=12 shiny type=electric").asString());
  assert.equal(again.level, 12);
  assert.equal(again.shiny, true);
}

// ---------------------------------------------------------------------------------------------
// 2. Estatísticas de jogador (CobblemonStats, 21 registradas)
{
  assert.equal(COBBLEMON_STATS.length, 21);
  const holder = new FakeHolder();
  awardStat(holder, "captured");
  awardStat(holder, "captured");
  awardStat(holder, "riding_air", 12345);
  const stats = getStats(holder);
  assert.equal(stats.captured, 2);
  assert.equal(stats.battles_lost, 0);
  assert.equal(formatStat("captured", 1234567), "1,234,567");
  assert.equal(formatStat("riding_air", 30), "30 cm");
  assert.equal(formatStat("riding_air", 12345), "123.45 m");
  assert.equal(formatStat("riding_land", 150000), "1.50 km");
  assert.equal(parseStats("lixo").captured, 0);
  const body = statsBody(stats);
  assert.equal((body.rawtext ?? []).filter(part => typeof part.translate === "string" && part.translate.startsWith("stat.cobblemon.")).length, 21);
}

// ---------------------------------------------------------------------------------------------
// 3. PC: ordenar (PokemonSortMode) e filtro (Search)
{
  const a = make("pikachu", 10); a.name = "Zed";
  const b = make("bulbasaur", 50);
  const c = make("charmander", 30);
  const slots = [null, a, null, b, c];
  assert.deepEqual(sortPokemon(slots, "level").map(x => x?.level ?? null), [10, 30, 50, null, null]);
  assert.deepEqual(sortPokemon(slots, "level", true).map(x => x?.level ?? null), [50, 30, 10, null, null]);
  assert.deepEqual(sortPokemon(slots, "pokedex_number").map(x => x?.species ?? null), ["bulbasaur", "charmander", "pikachu", null, null]);
  assert.deepEqual(sortPokemon(slots, "name").map(x => x?.species ?? null), ["bulbasaur", "charmander", "pikachu", null, null], "Bulbasaur < Charmander < Zed");
  assert.deepEqual(sortPokemon(slots, "type").map(x => x?.species ?? null), ["pikachu", "charmander", "bulbasaur", null, null], "electric < fire < grass");
  // Nome parcial ("cha" acha Charmander), inversão e propriedades.
  assert.ok(searchPasses(parseSearch("cha"), c));
  assert.ok(!searchPasses(parseSearch("cha"), b));
  assert.ok(searchPasses(parseSearch("!cha"), b));
  assert.ok(searchPasses(parseSearch("level=50"), b));
  assert.ok(searchPasses(parseSearch("zed"), a), "nome exibido (apelido)");
  assert.ok(!searchPasses(parseSearch("holding"), a));
  a.minecraftItem = "cobblemon:oran_berry";
  assert.ok(searchPasses(parseSearch("holding"), a));
  assert.ok(!searchPasses(parseSearch(""), null));
}

// ---------------------------------------------------------------------------------------------
// 4. Markings
{
  const mon = make();
  assert.deepEqual(getMarkings(mon), [0, 0, 0, 0, 0, 0]);
  let states = cycleMarking(getMarkings(mon), 2);
  states = cycleMarking(states, 2);
  assert.deepEqual(states, [0, 0, 2, 0, 0, 0]);
  assert.deepEqual(cycleMarking(states, 2), [0, 0, 0, 0, 0, 0], "(estado + 1) % 3");
  mon.markings = [1, 0, 2, 0, 0, 0];
  assert.ok(markingsText(mon).startsWith("§9●§8▲§d■"));
  assert.equal(markingsText(make(), true), "");
}

// ---------------------------------------------------------------------------------------------
// 5. Atributos de montaria e Aprijuice
{
  const style = { key: "cobblemon:land/horse", stats: { SPEED: 10, ACCELERATION: 55, SKILL: 15, JUMP: 25, STAMINA: 20 }, max: { SPEED: 20, ACCELERATION: 75, SKILL: 45, JUMP: 35, STAMINA: 45 }, speed: 0.15, jump: 0.4, stamina: 51.2 };
  assert.deepEqual(statRange(style as any, "SPEED"), [10, 20]);
  assert.deepEqual(statRange({ ...style, max: undefined } as any, "SPEED"), [10, 10], "dados antigos sem max");
  const values = rideComponentValues("LAND", style as any, { SPEED: 20, ACCELERATION: 75, SKILL: 45, JUMP: 35, STAMINA: 45 });
  assert.ok(values.speed >= 0.15 && values.jump >= 0.4);

  const aero = make("aerodactyl", 40);
  const info = rideInfoOf(aero);
  assert.ok(info?.styles.AIR && info.styles.LAND, "Aerodactyl monta em terra e ar");
  if ((info!.styles.AIR as any).max) {
    // AIR SPEED 45-75, LAND SPEED 10-20: base = maior início (45); máximo de bônus = faixa mais larga (30).
    assert.equal(getBaseRideStat(aero, "SPEED", info), 45);
    assert.equal(getMaxRideBoost(aero, "SPEED", info), 30);
    assert.ok(addRideBoosts(aero, { SPEED: 12, JUMP: 5 }, info));
    assert.equal(getRideStat(aero, "AIR", "SPEED", info), 57);
    assert.equal(getRideStat(aero, "LAND", "SPEED", info), 20, "limitado ao fim da faixa do estilo");
    addRideBoosts(aero, { SPEED: 100 }, info);
    assert.equal(aero.rideBoosts?.SPEED, 30);
    assert.ok(!canApplyRideBoost(aero, "SPEED", false, info));
    assert.equal(rideBoostCompletion(aero, info).anyMax, true);
    assert.equal(rideBoostCompletion(aero, info).allMax, false);
    assert.equal(applyAprijuice(aero, { SPEED: 3 }), "cannot_apply", "SPEED já no máximo");
    assert.equal(applyAprijuice(aero, { SKILL: 3 }), "applied");
    assert.equal(applyAprijuice(aero, undefined), "no_boosts");
    // Página de montaria do resumo.
    assert.equal(nextStatsPage(aero, undefined), "LAND");
    assert.equal(nextStatsPage(aero, "LAND"), "AIR");
    assert.equal(nextStatsPage(aero, "AIR"), undefined);
    assert.equal(rideStatLines(aero, "AIR").length, 5);
  }
  assert.equal(nextStatsPage(make("abra"), undefined), undefined, "Abra não é montável");
  // Sons de montaria.
  assert.equal(loopKind("cobblemon.ride.loop.wind.stereo"), "wind");
  assert.equal(resolveRideSound("cobblemon.ride.loop.wind", true), "cobblemon.ride.loop.wind.stereo");
  const quiet = evaluateRideSound({ volume: "math.pow(math.min(q.ride_velocity() / 1.5, 1.0),2)", pitch: "math.max(1.0 ,0.2 + math.pow(math.min(q.ride_velocity() / 1.5, 1.0),2))" }, 0, 0);
  const loud = evaluateRideSound({ volume: "math.pow(math.min(q.ride_velocity() / 1.5, 1.0),2)", pitch: "1" }, 3, 0);
  assert.equal(quiet.volume, 0);
  assert.equal(quiet.pitch, 1);
  assert.equal(loud.volume, 1);
  // Overlay de controles por comportamento.
  assert.deepEqual(rideControlSet("cobblemon:land/horse"), { verticalMouse: false, horizontalMouse: true, sneak: false, jump: true, noStrafe: true });
  assert.equal(rideControlSet("cobblemon:air/jet").jump, false);
  assert.equal(getConfig().displayControlSeconds, 0, "overlay desligado por padrão, como no 1.8.2");
}

// ---------------------------------------------------------------------------------------------
// 6. Move Dex
{
  const records = new PokedexRecords();
  const ctx = { records, learnedTMs: new Set<string>(), unlockAll: false };
  const entries = buildLearnsetEntries("bulbasaur", undefined, ctx);
  const level = entries.filter(e => e.source === "level");
  assert.ok(level.length > 5);
  assert.ok(level.filter(e => (e.level ?? 0) > 0).every(e => !e.discovered), "nunca obtido: golpes de nível com nível > 0 escondidos");
  const tms = entries.filter(e => e.source === "tm");
  assert.ok(tms.some(e => e.tmLocked && !e.discovered));
  assert.ok(entries.filter(e => e.source === "egg").every(e => e.discovered));
  // Obtido no nível 20: descobre até o 20.
  records.obtain({ species: "bulbasaur", form: "Normal", aspects: [], level: 20 });
  const after = buildLearnsetEntries("bulbasaur", undefined, ctx);
  assert.ok(after.filter(e => e.source === "level" && (e.level ?? 0) <= 20).every(e => e.discovered));
  assert.ok(after.filter(e => e.source === "level" && (e.level ?? 0) > 20).every(e => !e.discovered));
  // Evolução obtida em nível alto descobre os golpes do pré-evoluído (highestEvolutionLevel).
  records.obtain({ species: "venusaur", form: "Normal", aspects: [], level: 60 });
  assert.ok(buildLearnsetEntries("bulbasaur", undefined, ctx).filter(e => e.source === "level").every(e => e.discovered));
  assert.ok(collectEvolutionForms("bulbasaur", undefined).map(f => f.speciesId).includes("venusaur"));
  // unlockAllMoveDexMovesByDefault
  const all = buildLearnsetEntries("charmander", undefined, { ...ctx, unlockAll: true });
  assert.ok(all.every(e => e.discovered));
  // Filtro e ordenação.
  const onlyTm = filterAndSort(entries, "tm", "name");
  assert.ok(onlyTm.every(e => e.source === "tm"));
  const byLevel = filterAndSort(entries, "all", "level");
  assert.equal(byLevel[0].source, "level");
  assert.equal(byLevel[byLevel.length - 1].source, "egg");
  assert.equal(formatPercentage(100), "100%");
  assert.equal(formatPercentage(-1), "—");
  assert.ok(hasDiscoveredMove("bulbasaur", undefined, "tackle", ctx));
}

// ---------------------------------------------------------------------------------------------
// 7. Spawn rules
{
  const example = parseSpawnRule("cobblemon:pikachu_daylight_multiplier", BASE_SPAWN_RULES["cobblemon:pikachu_daylight_multiplier"])!;
  assert.equal(example.enabled, false, "o exemplo do 1.8.2 vem desligado");
  assert.equal(example.components.length, 3);
  setSpawnRulesForTests([example]);
  assert.equal(spawnRulesInfluence(), undefined, "nenhuma regra ligada");
  setSpawnRulesForTests([{ ...example, enabled: true }]);
  const influence = spawnRulesInfluence()!;
  const entry = (species: string) => ({ id: species, type: "pokemon", species, aspects: [], positionType: "grounded", bucket: "common", minLevel: 1, maxLevel: 5, weight: 10, weightMultipliers: [], condition: {} }) as any;
  const ctx = (light: number, y = 64) => ({ dimension: { id: "minecraft:overworld" }, location: { x: 0, y, z: 0 }, positionType: "grounded", biome: "plains", baseBlock: "minecraft:grass_block", skyLight: 15, light, canSeeSky: true, isRaining: false, isThundering: false }) as any;
  assert.equal(influence.affectWeight!(entry("pikachu"), ctx(12), 10), 200, "peso × 20 com luz > 8");
  assert.equal(influence.affectWeight!(entry("eevee"), ctx(12), 10), 10);
  assert.equal(influence.affectSpawnable!(entry("pikachu"), ctx(4)), false, "filtro: sem pikachu no escuro");
  assert.equal(influence.affectSpawnable!(entry("eevee"), ctx(4)), true);
  const nether = { ...ctx(12, 50), dimension: { id: "minecraft:the_nether" } };
  assert.equal(influence.affectSpawnable!(entry("eevee"), nether), false, "location: y > 100 ou overworld");
  setSpawnRulesForTests(undefined);
  const cond = convertCondition({ biomes: ["minecraft:plains", "#cobblemon:evolution/regional/cubone_alolabiome"], minY: 10, canSeeSky: true });
  assert.ok(cond.biomes?.includes("plains") && cond.biomes.includes("beach"));
  assert.equal(cond.minY, 10);
}

// ---------------------------------------------------------------------------------------------
// 8. Temperos (cleanse_*, mental_restoration) e requisitos genéricos
{
  assert.ok(isCobblemonMobEffect("cobblemon:cleanse_negative"));
  assert.ok(!isCobblemonMobEffect("minecraft:speed"));
  assert.deepEqual(effectsToCleanse("cleanse_negative", ["minecraft:poison", "minecraft:speed", "slowness"]), ["minecraft:poison", "slowness"]);
  assert.deepEqual(effectsToCleanse("cleanse_all", ["minecraft:poison", "minecraft:speed"]), ["minecraft:poison", "minecraft:speed"]);

  assert.equal(evaluateChance("0.25", undefined, () => 0.1), true);
  assert.equal(evaluateChance("0.25", undefined, () => 0.5), false);
  assert.equal(evaluateChance("math.min(1, 0.5)", undefined, () => 0.4), true);
  const mon = make("pikachu", 30);
  assert.ok(new ChanceRequirement("1").check(mon));
  const negate = initializeRequirement({ variant: "negate", inner: { variant: "level", minLevel: 50 } } as any) as NegateRequirement;
  assert.ok(negate instanceof NegateRequirement);
  assert.ok(negate.check(mon), "nível 30 não é >= 50");
  assert.ok(AreaRequirement.contains({ minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 }, { x: 5, y: 1, z: 9.9 }));
  assert.ok(!AreaRequirement.contains({ minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 }, { x: 10, y: 1, z: 1 }));
  for (const variant of ["chance", "negate", "owner_held_item", "area"])
    assert.ok(initializeRequirement({ variant } as any), `requisito ${variant}`);
}

// ---------------------------------------------------------------------------------------------
// 9. HUD: EXP ganha e level-up no protocolo da party
{
  const body = encodePartyBody([{ kind: "n", name: "Pikachu", level: 5, hpRatio: 1, expRatio: 0.5, expGained: 123, levelUp: true }]);
  assert.equal(utf8Length(body), PARTY_SLOTS * recordBytes(PARTY_FIELDS));
  assert.ok(PARTY_FIELDS.some(f => f.name === "xp") && PARTY_FIELDS.some(f => f.name === "lu"));
}

// ---------------------------------------------------------------------------------------------
// 10. Packs embutidos (Cobblemon.builtinPacks)
{
  assert.deepEqual(enabledPacks(undefined), ["gyaradosjump", "regionbiasforms"], "DEFAULT_ENABLED sem mod exigido");
  assert.deepEqual(enabledPacks("uniqueshinyforms,adorncompatibility"), ["uniqueshinyforms"]);
  assert.deepEqual(enabledPacks(""), []);
  const merged = mergeSounds({ "a": { sounds: ["x"] }, "b": { sounds: ["y"] } }, { "a": { sounds: ["z"] }, "b": { replace: true, sounds: ["w"] }, "c": { sounds: ["q"] } });
  assert.deepEqual(merged.a.sounds, ["x", "z"]);
  assert.deepEqual(merged.b.sounds, ["w"]);
  assert.deepEqual(merged.c.sounds, ["q"]);
}

console.log("dados-ui.test.ts: ok");
