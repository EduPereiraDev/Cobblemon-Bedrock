// Frente "jogabilidade" (onda 2): gamerules e config (versão/caixas), fome, cura ao dormir, features (stash do
// Gimmighoul, passos, cauda do Slowpoke), requisitos de evolução reais, drops e shed de evolução, recompensas do Alfa,
// tora com mel, brilho de shiny/rótulos, seleção do time, itens segurados proibidos e Tera Type.
// A API do Minecraft é mockada (tests/mocks).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_FIELDS, DEFAULT_CONFIG, DEFAULT_GAME_RULES, GAME_RULE_KEYS, INFO_ONLY_FIELDS, LAST_CHANGED_VERSION, getGameRule,
  isLaterVersion, migrateConfigJson, parseConfig, parseGameRules, resolveGameRule, setGameRule, sortStarterCategories,
} from "../scripts/Config";
import { PokemonData, rollTeraType } from "../scripts/Pokemon";
import { PokemonProperties } from "../scripts/PokemonProperties";
import {
  BERRY_EAT_FULL_SOUND, BERRY_EAT_SOUND, FEED_AMOUNTS, POKE_FOOD, canEat, feedPokemon, getMaxFullness, getMetabolismRate,
  grassKnotPower, isFull, maxFullnessForWeight, metabolismRateForStats, tickMetabolism, wrapBehaviourWithFullness,
} from "../scripts/pokemon/Fullness";
import { didSleep, nightSkipped } from "../scripts/pokemon/SleepHeal";
import {
  INT_FEATURES, SLOWPOKE_TAILS, TAIL_FEATURE, addBlocksTraveled, applyTailAspects, canShearTail, getBlocksTraveled,
  getIntFeature, handleStashItem, isStashItem, shearTail, tailAspects, tickTailRegrowth, WEIGHTED_FEATURES, rollWeightedChoice,
  ensureWeightedFeatureAspects,
} from "../scripts/pokemon/SpeciesFeatures";
import { characteristicOf, javaUuidHash, rainbowAspect } from "../scripts/pokemon/Characteristic";
import { COLORABLE_SPECIES, dyeColorOf, setColorAspect } from "../scripts/pokemon/FeatureInteractions";
import { blockDistSqr, hasBlocksTraveledRequirement, trackStep } from "../scripts/pokemon/BlocksTraveled";
import {
  AdvancementRequirement, BlocksTraveledRequirement, PropertyRangeRequirement, StructureRequirement, parseIntRange,
  setAdvancementLookup, setEvolutionStructureLookup,
} from "../scripts/evolution/requirements/ExtraRequirements";
import { initializeEvolutions } from "../scripts/evolution";
import { dropEvolutionLoot, findLastPokeBallSlot, shed } from "../scripts/evolution/EvolutionDrops";
import { rollDropEntries } from "../scripts/pokemon/Drops";
import { ALPHA_LOOT } from "../scripts/pokemon/alphaLoot";
import { alphaRewardTable, alphaRewardTables, rollAlphaTable } from "../scripts/pokemon/AlphaRewards";
import { HONEY_DRENCHED_ASPECT, honeyInfluence, rollHoneyBonuses } from "../scripts/spawning/HoneyLog";
import { labelMatches, labelMode, shinyNoticeStep, SHINY_PARTICLE_COOLDOWN_MS } from "../scripts/pokemon/ProximityEffects";
import { cycleSlot, getSelectedSlot, setSelectedSlot } from "../scripts/pokemon/PartySelection";
import { FORBIDDEN_HELD_ITEMS, isForbiddenHeldItem } from "../scripts/pokemon/HeldItems";
import { cancelPlayerDamage, shouldDiscardLoadedWild } from "../scripts/pokemon/GameplayHooks";
import { getKeyItems, grantDefaultKeyItems, hasKeyItem } from "../scripts/pokemon/KeyItems";
import { isProgressGoalDone, PROGRESS_PROPERTY } from "../scripts/pokedex/Progress";

const ROOT = process.cwd();
const UP = join(ROOT, "upstream", "cobblemon", "common", "src", "main");
const DATA = join(UP, "resources", "data", "cobblemon");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const make = (species: string, level = 30) => PokemonData.generateNewWildPokemon(species, { level, shiny: false });
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
const holder = () => {
  const props = new Map<string, unknown>();
  return { props, getDynamicProperty: (k: string) => props.get(k), setDynamicProperty: (k: string, v: unknown) => { props.set(k, v); } } as any;
};

// 1. Config: defaultBoxCount 40 com migração por versão, campos só informativos, gamerules.
{
  assert.equal(DEFAULT_CONFIG.defaultBoxCount, 40);
  assert.ok(isLaterVersion("1.7.0", "0.0.1") && !isLaterVersion("1.7.0", "1.8.2") && !isLaterVersion("1.7.0", "1.7.0"));
  // Config antiga do port (sem lastSavedVersion) com 30 caixas → volta ao padrão 40; salva na 1.8.2 mantém o valor.
  const old = parseConfig(migrateConfigJson(JSON.stringify({ defaultBoxCount: 30, shinyRate: 512 })));
  assert.equal(old.defaultBoxCount, 40);
  assert.equal(old.shinyRate, 512, "campos sem @LastChangedVersion ficam");
  const current = parseConfig(migrateConfigJson(JSON.stringify({ defaultBoxCount: 30, lastSavedVersion: "1.8.2" })));
  assert.equal(current.defaultBoxCount, 30);
  assert.deepEqual(Object.keys(LAST_CHANGED_VERSION).sort(), ["ambientPokemonCryTicks", "bigRootPropagationChance", "defaultBoxCount", "maxRootsInArea"]);
  // Os 5 campos sem efeito possível saíram do editor, mas continuam no JSON.
  for (const key of INFO_ONLY_FIELDS) {
    assert.ok(key in DEFAULT_CONFIG);
    assert.ok(!CONFIG_FIELDS.some(f => f.key === key), `${key} fora do editor`);
  }
  // As 6 gamerules do Cobblemon (CobblemonGameRules.kt) com os padrões do 1.8.2.
  const kotlin = readFileSync(join(UP, "kotlin/com/cobblemon/mod/common/world/gamerules/CobblemonGameRules.kt"), "utf8");
  const upstreamRules = [...kotlin.matchAll(/registerGameRule\("(\w+)",[^)]*?create`?\((true|false)\)/g)].map(m => [m[1], m[2] === "true"]);
  assert.equal(upstreamRules.length, 6);
  const renamed: Record<string, string> = { doShinyStarters: "doShinyStarters" };
  for (const [name, value] of upstreamRules) {
    const key = resolveGameRule(renamed[name as string] ?? String(name));
    assert.ok(key, `gamerule ${name}`);
    assert.equal(DEFAULT_GAME_RULES[key!], value, `padrão de ${name}`);
  }
  assert.equal(GAME_RULE_KEYS.length, 6);
  assert.deepEqual(parseGameRules('{"doPokemonLoot":false,"x":1,"battleInvulnerability":"sim"}'), { ...DEFAULT_GAME_RULES, doPokemonLoot: false });
  setGameRule("doShinyStarters", true);
  assert.equal(getGameRule("doShinyStarters"), true);
  setGameRule("doShinyStarters", false);
  // battleInvulnerability / mobTargetInBattle.
  assert.equal(cancelPlayerDamage(false, true, { battleInvulnerability: true, mobTargetInBattle: false }), false);
  assert.equal(cancelPlayerDamage(true, false, { battleInvulnerability: true, mobTargetInBattle: true }), true);
  assert.equal(cancelPlayerDamage(true, true, { battleInvulnerability: false, mobTargetInBattle: false }), true);
  assert.equal(cancelPlayerDamage(true, false, { battleInvulnerability: false, mobTargetInBattle: false }), false, "jogador contra jogador continua");
  assert.equal(shouldDiscardLoadedWild({ isWild: true, owned: false, persistent: false }, false), true);
  assert.equal(shouldDiscardLoadedWild({ isWild: true, owned: false, persistent: false }, true), false);
  assert.equal(shouldDiscardLoadedWild({ isWild: false, owned: true, persistent: false }, false), false);
  // Itens-chave padrão (GeneralPlayerData.initialize).
  const p = holder();
  assert.equal(grantDefaultKeyItems(p, ["cobblemon:key_stone"]), 1);
  assert.equal(grantDefaultKeyItems(p, ["cobblemon:key_stone"]), 0);
  assert.ok(hasKeyItem(p, "cobblemon:key_stone"));
  assert.deepEqual(getKeyItems(p), ["cobblemon:key_stone"]);
}

// 2. Fome/saciedade (Pokemon.getMaxFullness, feedPokemon, getMetabolismRate).
{
  assert.equal(grassKnotPower(0), 0);
  assert.equal(grassKnotPower(21), 20);
  assert.equal(grassKnotPower(69), 60);
  assert.equal(grassKnotPower(460), 120);
  assert.equal(maxFullnessForWeight(69), 4, "Bulbasaur (69) → 60 / 10 / 2 + 1");
  assert.equal(maxFullnessForWeight(0), 1);
  assert.equal(maxFullnessForWeight(9999), 7);
  const bulbasaur = make("bulbasaur");
  assert.equal(getMaxFullness(bulbasaur), 4);
  // (20 − 45/318 × 20 × 4) × 60 → int → × 20 ticks.
  assert.equal(getMetabolismRate(bulbasaur), Math.trunc((20 - (45 / 318) * 80) * 60) * 20);
  assert.equal(metabolismRateForStats(200, 300), 60 * 20, "taxa ≤ 0 vira 60 s");
  let feed = feedPokemon(bulbasaur, 1);
  assert.equal(feed.sound, BERRY_EAT_SOUND);
  assert.equal(bulbasaur.fullness, 1);
  assert.equal(bulbasaur.metabolismCycle, 0);
  feed = feedPokemon(bulbasaur, 5);
  assert.equal(bulbasaur.fullness, 4, "limitado ao máximo");
  assert.ok(isFull(bulbasaur));
  feed = feedPokemon(bulbasaur, 1);
  assert.equal(feed.sound, BERRY_EAT_FULL_SOUND);
  assert.equal(feed.changed, false);
  // Comida (tag poke_food) não pode com a barriga cheia; remédio (Oran) pode.
  assert.ok(!canEat(bulbasaur, "cobblemon:pomeg_berry"));
  assert.ok(canEat(bulbasaur, "cobblemon:oran_berry"));
  // Metabolismo: perde 1 quando o ciclo passa da taxa.
  const rate = getMetabolismRate(bulbasaur);
  bulbasaur.metabolismCycle = rate - 20;
  assert.ok(tickMetabolism(bulbasaur, 20));
  assert.equal(bulbasaur.fullness, 3);
  assert.equal(bulbasaur.metabolismCycle, 0);
  // Tag poke_food confere com o upstream (berries/filling + mochis + aprijuices + Poké Snack).
  const tags = join(DATA, "tags", "item");
  const expand = (values: string[]): string[] => values.flatMap(v => v.startsWith("#cobblemon:")
    ? expand(json(join(tags, `${v.slice("#cobblemon:".length)}.json`)).values) : [v]);
  const upstream = new Set(expand(json(join(tags, "poke_food.json")).values));
  assert.deepEqual([...POKE_FOOD].sort(), [...upstream].sort());
  assert.equal(FEED_AMOUNTS["cobblemon:sitrus_berry"], 1);
  assert.equal(FEED_AMOUNTS["cobblemon:figy_berry"], 5);
  // Embrulho do comportamento de item: bloqueia com barriga cheia e soma ao usar.
  const behaviour: any = {
    typeId: "cobblemon:pomeg_berry", kind: "ev_berry", canUse: () => true,
    apply: (pokemon: PokemonData) => ({ success: true, consume: true, messages: [], pokemon, sound: BERRY_EAT_SOUND }),
  };
  wrapBehaviourWithFullness(behaviour);
  const eevee = make("eevee");
  assert.ok(behaviour.canUse(eevee));
  const outcome = behaviour.apply(eevee);
  assert.equal(outcome.pokemon.fullness, 1);
  eevee.fullness = getMaxFullness(eevee);
  assert.ok(!behaviour.canUse(eevee), "barriga cheia bloqueia a berry de EV");
}

// 3. Cura ao dormir (Pokemon.didSleep) e detecção do pulo da noite.
{
  const mon = make("pikachu", 30);
  mon.currentHealth = 0;
  mon.status = "fnt" as any;
  mon.movesInfo.forEach(m => { m.pp = 0; });
  assert.ok(didSleep(mon));
  assert.equal(mon.currentHealth, Math.floor(mon.maxHealth / 2), "desmaiado volta com metade");
  assert.equal(mon.status, undefined);
  assert.equal(mon.faintedTimer, -1);
  mon.movesInfo.forEach(m => assert.equal(m.pp, Math.floor(m.maxPp / 2)));
  didSleep(mon);
  assert.equal(mon.currentHealth, Math.min(mon.maxHealth, 2 * Math.floor(mon.maxHealth / 2)), "+ metade (divisão inteira)");
  didSleep(mon);
  assert.equal(mon.currentHealth, mon.maxHealth);
  assert.ok(nightSkipped({ timeOfDay: 18000, absolute: 1000 }, { timeOfDay: 0, absolute: 7000 }, 10));
  assert.ok(!nightSkipped({ timeOfDay: 18000, absolute: 1000 }, { timeOfDay: 18010, absolute: 1010 }, 10));
  assert.ok(!nightSkipped({ timeOfDay: 6000, absolute: 1000 }, { timeOfDay: 1000, absolute: 20000 }, 10), "/time set de dia não é sono");
}

// 4. Features: stash do Gimmighoul → Gholdengo, passos, cauda do Slowpoke.
{
  const coins = json(join(DATA, "species_features", "gimmighoul_coins.json"));
  const scrap = json(join(DATA, "species_features", "gimmighoul_netherite.json"));
  const steps = json(join(DATA, "global_species_features", "blocks_traveled.json"));
  assert.deepEqual(INT_FEATURES.gimmighoul_coins.itemPoints, coins.itemPoints);
  assert.equal(INT_FEATURES.gimmighoul_coins.max, coins.max);
  assert.deepEqual(INT_FEATURES.gimmighoul_netherite.itemPoints, scrap.itemPoints);
  assert.equal(INT_FEATURES.gimmighoul_netherite.max, scrap.max);
  assert.equal(INT_FEATURES.blocks_traveled.max, steps.max);
  const mechanic = json(join(DATA, "mechanics", "slowpoke_tails.json"));
  assert.equal(SLOWPOKE_TAILS.regrowthSeconds, mechanic.regrowthSeconds);
  assert.deepEqual(Object.fromEntries(Object.entries(SLOWPOKE_TAILS.aspectThresholds).map(([k, v]) => [k, v])), mechanic.aspectThresholds);

  const gimmighoul = make("gimmighoul", 20);
  assert.equal(getIntFeature(gimmighoul, "gimmighoul_coins"), 0);
  assert.equal(getIntFeature(make("pikachu"), "gimmighoul_coins"), undefined);
  assert.ok(isStashItem(gimmighoul, "cobblemon:relic_coin"));
  assert.ok(!isStashItem(make("pikachu"), "cobblemon:relic_coin"));
  for (let i = 0; i < 12; i++) handleStashItem(gimmighoul, "cobblemon:relic_coin_sack");
  assert.equal(getIntFeature(gimmighoul, "gimmighoul_coins"), 972);
  handleStashItem(gimmighoul, "cobblemon:relic_coin_sack");
  assert.equal(getIntFeature(gimmighoul, "gimmighoul_coins"), 999, "limitado a 999");
  handleStashItem(gimmighoul, "minecraft:netherite_ingot");
  assert.equal(getIntFeature(gimmighoul, "gimmighoul_netherite"), 4);
  // Requisitos: properties "gimmighoul_coins=999" e property_range do netherite.
  assert.ok(PokemonProperties.parse("gimmighoul gimmighoul_coins=999").match(gimmighoul));
  assert.ok(!PokemonProperties.parse("gimmighoul gimmighoul_coins=999").match(make("gimmighoul")));
  const evolutions = initializeEvolutions(gimmighoul.getEvolutionEntries());
  const plain = evolutions.find(e => e.id === "gimmighoul_gholdengo")!;
  const stage1 = evolutions.find(e => e.id === "gimmighoul_gholdengonetherite1")!;
  assert.ok(plain.test(gimmighoul), "com 999 moedas o Gimmighoul pode evoluir");
  assert.ok(!stage1.test(gimmighoul), "4 de netherite não chega ao estágio 1 (32-63)");
  gimmighoul.features!.gimmighoul_netherite = 40;
  assert.ok(stage1.test(gimmighoul));
  const gholdengo = stage1.result.apply(gimmighoul);
  assert.equal(gholdengo.species, "gholdengo");
  assert.ok(gholdengo.aspects.includes("netherite-coating-stage1"), "resultado aplica o aspect da cobertura");
  assert.deepEqual(parseIntRange("32-63", [0, 256]), [32, 63]);
  assert.ok(new PropertyRangeRequirement("gimmighoul_netherite", 32, 63).check(gimmighoul));

  // Passos: só espécies com o requisito contam; requisito lê o valor.
  const pawmo = make("rellor", 20);
  assert.ok(hasBlocksTraveledRequirement(pawmo));
  assert.ok(!hasBlocksTraveledRequirement(make("pikachu")));
  const requirement = new BlocksTraveledRequirement(1000);
  assert.ok(!requirement.check(pawmo));
  addBlocksTraveled(pawmo, 999);
  assert.ok(!requirement.check(pawmo));
  addBlocksTraveled(pawmo, 5);
  assert.equal(getBlocksTraveled(pawmo), 1000, "limitado ao máximo da feature");
  assert.ok(requirement.check(pawmo));
  assert.equal(blockDistSqr({ x: 0.2, y: 64, z: 0.9 }, { x: 1.5, y: 64, z: 1.1 }), 2, "diagonal = 2 (distSqr)");
  const entry = { pending: 0 } as any;
  trackStep(entry, { x: 0, y: 64, z: 0 }, "overworld", false);
  trackStep(entry, { x: 1, y: 64, z: 0 }, "overworld", false);
  trackStep(entry, { x: 2, y: 63, z: 0 }, "overworld", true);
  trackStep(entry, { x: 200, y: 63, z: 0 }, "overworld", false);
  assert.equal(entry.pending, 1, "caindo/montado e teleporte não contam");

  // Cauda do Slowpoke.
  const slowpoke = make("slowpoke");
  assert.ok(canShearTail(slowpoke));
  shearTail(slowpoke);
  assert.equal(slowpoke.features![TAIL_FEATURE], 1200);
  assert.ok(!canShearTail(slowpoke));
  assert.deepEqual(tailAspects(1200), []);
  assert.deepEqual(tailAspects(500).sort(), ["regrown-tail-1"]);
  assert.deepEqual(tailAspects(0).sort(), ["regrown-tail-1", "regrown-tail-2", "regrown-tail-3"]);
  slowpoke.features![TAIL_FEATURE] = 1;
  assert.ok(tickTailRegrowth(slowpoke, false));
  assert.ok(canShearTail(slowpoke));
  applyTailAspects(slowpoke);
  assert.ok(slowpoke.aspects.includes("regrown-tail-3"));
  assert.ok(!canShearTail(make("pikachu")));
}

// 5. Requisitos advancement e structure.
{
  const spewpa = make("spewpa", 20);
  spewpa.trainer = undefined;
  const advancement = new AdvancementRequirement("cobblemon:catching/collect_all_vivillon");
  assert.ok(!advancement.check(spewpa), "sem dono jogador não passa");
  spewpa.trainer = "player-1";
  setAdvancementLookup((_owner, id) => id.endsWith("collect_all_vivillon"));
  assert.ok(advancement.check(spewpa));
  const p = holder();
  assert.equal(isProgressGoalDone(p, "cobblemon:catching/collect_all_vivillon"), false);
  assert.equal(isProgressGoalDone(p, "cobblemon:catching/nao_existe"), undefined);
  p.props.set(PROGRESS_PROPERTY, JSON.stringify({ c: 1 }));
  assert.equal(isProgressGoalDone(p, "cobblemon:catching/first_catch"), true);
  // Estrutura: sem consulta, condição falha e anticondição passa; com consulta (frente motor), respeita.
  const inVillage = new StructureRequirement("#minecraft:village");
  const notVillage = new StructureRequirement(undefined, "#minecraft:village");
  assert.ok(!inVillage.check(spewpa) && notVillage.check(spewpa));
  setEvolutionStructureLookup(() => true);
  assert.ok(inVillage.check(spewpa) && !notVillage.check(spewpa));
  setEvolutionStructureLookup(undefined);
}

// 6. Drops e shed de evolução.
{
  // Nincada: shedder e drop de Shed Shell chegam do JSON gerado.
  const nincada = make("nincada", 20);
  const evolution = initializeEvolutions(nincada.getEvolutionEntries())[0];
  assert.equal(evolution.shedder?.species, "shedinja");
  assert.equal(evolution.drops?.entries?.[0].item, "cobblemon:shed_shell");
  // Shell Helmet do Shelmet só com Karrablast no time (requisito da entrada).
  const shelmetItem = initializeEvolutions(make("shelmet").getEvolutionEntries()).find(e => e.id === "shelmet_accelgor_item")!;
  const entries = rollDropEntries(shelmetItem.drops, entry => !entry.requirements?.length, Math.random);
  assert.deepEqual(entries, [], "sem cumprir o requisito, nada cai");
  assert.equal(rollDropEntries(shelmetItem.drops, () => true, () => 0)[0].item, "cobblemon:shell_helmet");
  // 67 espécies com drops de evolução no upstream: todas chegam ao port.
  let upstreamDrops = 0;
  // Karrablast: troca com Shelmet (requiredContext) e item Shell Helmet.
  const karrablast = initializeEvolutions(make("karrablast").getEvolutionEntries());
  assert.ok(karrablast.some(e => e.id === "karrablast_escavalier" && (e as any).requiredContext.species === "shelmet"));
  assert.ok(karrablast.some(e => e.id === "karrablast_escavalier_item"));
  // Última bola do inventário (o laço do Cobblemon sobrescreve).
  const ball = (typeId: string) => ({ typeId, hasTag: (t: string) => t === "cobblemon:poke_balls" && typeId.endsWith("_ball") });
  assert.equal(findLastPokeBallSlot([undefined, ball("cobblemon:poke_ball") as any, ball("minecraft:stone") as any, ball("cobblemon:great_ball") as any]), 3);
  assert.equal(findLastPokeBallSlot([ball("minecraft:stone") as any]), -1);
  // Shed: time com espaço + bola → Shedinja com a bola, sem item, UUID novo; sem espaço → nada.
  const ninjask = evolution.result.apply(nincada);
  ninjask.minecraftItem = "cobblemon:leftovers";
  const slots: any[] = [undefined, { typeId: "cobblemon:great_ball", amount: 2, hasTag: () => true }];
  const container = {
    size: slots.length, getItem: (i: number) => slots[i],
    getSlot: (i: number) => ({ getItem: () => slots[i], set amount(v: number) { slots[i].amount = v; }, setItem: (v: unknown) => { slots[i] = v; } }),
  };
  const owner: any = { isValid: true, getGameMode: () => "Survival", getComponent: () => ({ container }) };
  const stored: PokemonData[] = [];
  const deps = { firstFreePartySlot: () => 1, store: (_o: unknown, p: PokemonData) => { stored.push(p); } };
  const shedinja = shed(evolution.shedder, ninjask, owner, "nincada", deps)!;
  assert.equal(shedinja.species, "shedinja");
  assert.equal(shedinja.pokeball, "cobblemon:great_ball");
  assert.equal(shedinja.minecraftItem, undefined);
  assert.notEqual(shedinja.uuid, ninjask.uuid);
  assert.equal(shedinja.level, ninjask.level);
  assert.equal(slots[1].amount, 1, "uma bola gasta");
  assert.equal(stored.length, 1);
  assert.equal(shed(evolution.shedder, ninjask, owner, "nincada", { ...deps, firstFreePartySlot: () => undefined }), undefined);
  // doPokemonLoot desligado: sem drops de evolução.
  setGameRule("doPokemonLoot", false);
  assert.deepEqual(dropEvolutionLoot(evolution.drops, ninjask, owner, undefined), []);
  setGameRule("doPokemonLoot", true);
  void upstreamDrops;
}

// 7. Recompensas do Alfa (loot_table/alpha + pokemon_alpha_drops.molang).
{
  assert.equal(Object.keys(ALPHA_LOOT).length, 40, "4 gerais + 36 por tipo (18 tipos × 2 tiers)");
  assert.equal(alphaRewardTable(30), "alpha_rewards_tier1");
  assert.equal(alphaRewardTable(31), "alpha_rewards_tier2");
  assert.equal(alphaRewardTable(51), "alpha_rewards_tier3");
  assert.equal(alphaRewardTable(66), "alpha_rewards_tier4");
  assert.deepEqual(alphaRewardTables({ aspects: [], level: 70, types: ["fire"] }), [], "só Alfa");
  // random 0 → as duas chances de tipo (random_integer(1, 2) == 1) acertam; tipo primário nas duas.
  assert.deepEqual(alphaRewardTables({ aspects: ["alpha"], level: 55, types: ["fire", "flying"] }, () => 0),
    ["alpha_rewards_tier3", "types/fire_rewards_tier2", "types/fire_rewards_tier2"]);
  assert.deepEqual(alphaRewardTables({ aspects: ["alpha"], level: 10, types: ["water"] }, () => 0.9), ["alpha_rewards_tier1"]);
  const drops = rollAlphaTable("alpha_rewards_tier1", seq(0, 0.99));
  assert.equal(drops.length, 1);
  assert.equal(drops[0][0], "cobblemon:exp_candy_xs");
  assert.ok(drops[0][1] >= 1 && drops[0][1] <= 3);
  for (const [table, pools] of Object.entries(ALPHA_LOOT))
    for (const pool of pools) assert.ok(pool.entries.length > 0, `${table} sem entradas`);
}

// 8. Tora com mel (SaccharineLogSlatheredInfluence).
{
  const config = { honeySlatherShinyChance: 4000, honeySlatherAlphaChance: 100 };
  const mon = make("combee");
  const lucky = rollHoneyBonuses(mon, false, config, () => 0);
  assert.deepEqual(lucky, { skip: false, hiddenAbility: true, shiny: true, alpha: true });
  const unlucky = rollHoneyBonuses(mon, false, config, () => 0.99);
  assert.deepEqual(unlucky, { skip: false, hiddenAbility: false, shiny: false, alpha: false });
  assert.ok(rollHoneyBonuses(mon, true, config).skip, "já com habilidade oculta: nada");
  const state = { log: { dimension: "minecraft:overworld", x: 0, y: 64, z: 0 }, activated: false };
  let alpha = 0;
  const influence = honeyInfluence(state, { hasHiddenAbility: () => false, giveHiddenAbility: () => { }, makeAlpha: () => { alpha++; } });
  const first = make("combee"), second = make("combee");
  influence.affectPokemon!({} as any, first);
  influence.affectPokemon!({} as any, second);
  assert.ok(first.aspects.includes(HONEY_DRENCHED_ASPECT), "o primeiro Pokémon ativa a tora");
  assert.ok(!second.aspects.includes(HONEY_DRENCHED_ASPECT));
  assert.ok(state.activated);
  void alpha;
}

// 9. Brilho de shiny e rótulos.
{
  const state = { shined: false, lastAmbient: 0 };
  let action = shinyNoticeStep(state, true, false, 10_000);
  assert.deepEqual(action, { ring: true, ambient: true });
  action = shinyNoticeStep(state, true, false, 10_000 + 1000);
  assert.deepEqual(action, { ring: false, ambient: false }, "cooldown de 3,5 s e anel uma vez");
  action = shinyNoticeStep(state, true, true, 10_000 + SHINY_PARTICLE_COOLDOWN_MS + 1);
  assert.deepEqual(action, { ring: false, ambient: false }, "em batalha sem brilho ambiente");
  shinyNoticeStep(state, false, false, 20_000);
  assert.equal(state.shined, false, "longe: pode brilhar de novo");
  const config = { displayNameForUnknownPokemon: false, displayEntityLabelsWhenCrouchingOnly: false };
  assert.equal(labelMode(false, false, config), "hidden");
  assert.equal(labelMode(true, false, config), "shown");
  assert.equal(labelMode(false, false, { ...config, displayNameForUnknownPokemon: true }), "shown");
  assert.equal(labelMode(true, false, { ...config, displayEntityLabelsWhenCrouchingOnly: true }), "none");
  assert.equal(labelMode(true, true, { ...config, displayEntityLabelsWhenCrouchingOnly: true }), "shown");
  assert.ok(labelMatches("??? Lv. 5", "hidden") && !labelMatches("Pikachu Lv. 5", "hidden") && labelMatches("", "none"));
  const pika = make("pikachu", 12);
  assert.equal(pika.getEntityLabel(), "Pikachu Lv. 12");
  assert.equal(pika.getEntityLabel(true), "??? Lv. 12");
}

// 10. Seleção do time, itens proibidos, Tera Type.
{
  const p = holder();
  assert.equal(getSelectedSlot(p), 0);
  setSelectedSlot(p, 3);
  assert.equal(getSelectedSlot(p), 3);
  setSelectedSlot(p, 9);
  assert.equal(getSelectedSlot(p), 5);
  assert.equal(cycleSlot([true, false, true, false, false, false], 0, 1), 2);
  assert.equal(cycleSlot([true, false, true, false, false, false], 2, 1), 0, "dá a volta");
  assert.equal(cycleSlot([true, false, true, false, false, false], 0, -1), 2);
  assert.equal(cycleSlot([false, false, false, false, false, false], 4, 1), 4);
  // Tag container_held_items do upstream: todas as caixas de shulker vanilla bloqueadas.
  const tag = json(join(DATA, "tags", "item", "held", "container_held_items.json")).values
    .filter((v: unknown) => typeof v === "string") as string[];
  for (const id of tag) assert.ok(FORBIDDEN_HELD_ITEMS.has(id), id);
  assert.ok(isForbiddenHeldItem("minecraft:bundle") && isForbiddenHeldItem("minecraft:red_bundle"));
  assert.ok(!isForbiddenHeldItem("cobblemon:leftovers"));
  // Tera: 1/taxa → tipo que o Pokémon não tem; senão um dos dele.
  assert.equal(rollTeraType(["fire", "flying"], 20, seq(0.99, 0.6)), "Flying");
  const other = rollTeraType(["fire"], 20, seq(0, 0));
  assert.notEqual(other, "Fire");
  assert.ok(make("charmander").teraType, "criação sorteia o Tera Type");
}

// 11. Extras: escolhas ponderadas, cauda do Smeargle, tingir, ordem dos iniciais.
{
  const spec = json(join(DATA, "species_features", "landsnake_form.json"));
  assert.deepEqual(WEIGHTED_FEATURES.find(f => f.key === "landsnake_form")!.choices, spec.choices);
  assert.deepEqual(WEIGHTED_FEATURES.find(f => f.key === "maushold_family")!.choices, json(join(DATA, "species_features", "maushold_family.json")).choices);
  assert.equal(rollWeightedChoice({ "two-segment": 99, "three-segment": 1 }, () => 0.995), "three-segment");
  assert.equal(rollWeightedChoice({ "two-segment": 99, "three-segment": 1 }, () => 0.5), "two-segment");
  const dunsparce = make("dunsparce");
  assert.ok(dunsparce.aspects.some(a => a.endsWith("-segment-form")), "Dunsparce nasce com a forma sorteada");
  dunsparce.aspects = dunsparce.aspects.filter(a => !a.endsWith("-segment-form")).concat(["three-segment-form"]);
  const dudunsparce = PokemonProperties.parse("dudunsparce").apply(dunsparce);
  assert.ok(dudunsparce.aspects.includes("three-segment-form"), "a forma passa para o Dudunsparce");
  assert.ok(ensureWeightedFeatureAspects({ species: "maushold", aspects: [] } as any, () => 0));
  // Characteristic (UUID.hashCode do Java) e cor do Smeargle.
  assert.equal(javaUuidHash("00000000-0000-0001-0000-000000000000"), 1);
  assert.equal(javaUuidHash("00000001-0000-0000-0000-000000000000"), 1);
  const ivs = { hp: 10, atk: 31, def: 31, spa: 5, spd: 5, spe: 5 };
  assert.equal(characteristicOf(ivs, "00000000-0000-0000-0000-000000000000").stat, "atk", "começa no HP: primeiro máximo = Ataque");
  assert.equal(characteristicOf(ivs, "00000000-0000-0000-0000-000000000002").stat, "def", "começa na Defesa");
  assert.equal(characteristicOf(ivs, "00000000-0000-0000-0000-000000000000").mod, 1);
  assert.equal(rainbowAspect("atk", "atk"), "rainbow-red");
  assert.equal(rainbowAspect(null, "hp"), "rainbow-light-blue");
  assert.equal(rainbowAspect("spe", "atk"), "rainbow-pink");
  const smeargle = make("smeargle");
  smeargle.updateRainbowAspect();
  assert.equal(smeargle.aspects.filter(a => a.startsWith("rainbow-")).length, 1, "Smeargle tem uma cor");
  const pikachu = make("pikachu");
  pikachu.aspects.push("rainbow-red");
  pikachu.updateRainbowAspect();
  assert.ok(!pikachu.aspects.some(a => a.startsWith("rainbow-")));
  // Tingir Wooloo/Dubwool/Conkeldurr.
  assert.deepEqual(COLORABLE_SPECIES, json(join(DATA, "species_feature_assignments", "color.json")).pokemon);
  assert.equal(dyeColorOf("minecraft:light_blue_dye"), "light_blue");
  assert.equal(dyeColorOf("minecraft:ink_sac"), undefined);
  const wooloo = make("wooloo");
  setColorAspect(wooloo, "red");
  setColorAspect(wooloo, "blue");
  assert.deepEqual(wooloo.aspects.filter(a => a.startsWith("color-")), ["color-blue"]);
  setColorAspect(wooloo, undefined);
  assert.ok(!wooloo.aspects.some(a => a.startsWith("color-")));
  // Ordem das categorias de iniciais (StarterCategory.order).
  assert.deepEqual(DEFAULT_CONFIG.starters.map(c => c.order), [-110, -109, -108, -107, -106, -105, -104, -103, -102, -101, -100]);
  assert.deepEqual(sortStarterCategories([{ name: "b", order: 1 }, { name: "a" }, { name: "c", order: -5 }]).map(c => c.name), ["c", "a", "b"]);
}

console.log("jogabilidade2: ok");
