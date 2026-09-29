// Frente "jogabilidade-final": cura passiva/desmaio/status fora de batalha, sequência de evolução, espectador,
// clones de batalha (cloneParties/setLevel), marcas, cosméticos, tamanho intrínseco, corte do Furfrou,
// block_click e mobs vanilla que fogem de Pokémon. A API do Minecraft é mockada (tests/mocks).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PokemonData, StatusEffect } from "../scripts/Pokemon";
import { getSpeciesData } from "../scripts/speciesData";
import { initializeEvolutions } from "../scripts/evolution";
import { resolveVariant } from "../generated/scripts/variants";
import { PassiveSettings, passiveSecond, rollStatusDuration, STATUS_IDS } from "../scripts/pokemon/PassiveHealing";
import { EVOLUTION_SOUNDS, EVOLUTION_TIMELINE, evolutionPhaseAt, isEvolving } from "../scripts/evolution/EvolutionEffect";
import { activeLine, addSpectator, battleStatusLines, checkSpectate, isSpectating, releaseSpectators, removeSpectator } from "../scripts/battle/Spectate";
import { buildBattleTeam, cloneForBattle, usesClones } from "../scripts/battle";
import { trainerTeamOptions } from "../scripts/npc/NPCEntity";
import {
  ALL_MARKS, FOSSIL_POTENTIAL_MARKS, MARK_REPLACES, PARTNER_MARK, applyFossilMarks, giveAllMarks, giveMark, partnerMarkCheck,
  resolveMarkId, spawnGivenMarks,
} from "../scripts/pokemon/Marks";
import {
  ALL_COSMETIC_ASPECTS, COSMETIC_ITEMS, canWearCosmetics, findCosmeticFor, itemMatchesTag, matchesPokemon, swapCosmeticItem,
} from "../scripts/pokemon/CosmeticItems";
import {
  applyScaleProperty, babyMultiplier, effectiveScale, rollIntrinsicScale, roundIntrinsicScale, sizeCategoryOf, SCALE_PROPERTY,
} from "../scripts/pokemon/Scale";
import { FURFROU_TRIMS, applyFurfrouTrim, interactionScriptAction } from "../scripts/entity/Interactions";
import { avoidTag, avoidedBy, applyAvoidTags } from "../scripts/pokemon/EntityInteract";
import { blockClickMatches, BlockClickEvolution } from "../scripts/evolution/variants/BlockClickEvolution";
import { anySpeciesUsesBlockClick } from "../scripts/evolution/BlockClick";
import { DEFAULT_CONFIG } from "../scripts/Config";
import { readGeneratedTableText } from "../tools/importer/generatedTable.mjs"; // frente otimizacao (#8)

const ROOT = process.cwd();
const UPSTREAM = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources");

const make = (species: string, level = 30) => PokemonData.generateNewWildPokemon(species, { level, shiny: false });
/** Sequência fixa de números "aleatórios". */
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

// 1. Cura passiva, desmaio e status fora de batalha (PlayerPartyStore.onSecondPassed).
{
	const settings: PassiveSettings = {
		healPercent: DEFAULT_CONFIG.healPercent, healTimer: DEFAULT_CONFIG.healTimer,
		defaultFaintTimer: DEFAULT_CONFIG.defaultFaintTimer, faintAwakenHealthPercent: DEFAULT_CONFIG.faintAwakenHealthPercent,
		passiveStatuses: DEFAULT_CONFIG.passiveStatuses,
	};
	const p = { currentHealth: 50, maxHealth: 100, friendship: 100 } as any;
	// healTimer começa em −1 (campo novo): o primeiro segundo já cura 5 %.
	let r = passiveSecond(p, settings);
	assert.equal(p.currentHealth, 55);
	assert.ok(r.changed);
	assert.equal(p.healTimer, 60);
	// Depois espera healTimer + 1 segundos (60 → −1).
	for (let i = 0; i < 60; i++) passiveSecond(p, settings, { lastHealth: p.currentHealth });
	assert.equal(p.currentHealth, 55);
	passiveSecond(p, settings, { lastHealth: p.currentHealth });
	assert.equal(p.currentHealth, 60);
	// HP mudou por fora (batalha/item): o timer recomeça do valor da config.
	p.currentHealth = 30;
	passiveSecond(p, settings, { lastHealth: 60 });
	assert.equal(p.currentHealth, 30);
	assert.equal(p.healTimer, 59);
	// Cura mínima de 1 HP e arredondamento (round(max(1, máx × %))).
	const tiny = { currentHealth: 1, maxHealth: 12, friendship: 0, healTimer: 0 } as any;
	passiveSecond(tiny, settings);
	assert.equal(tiny.currentHealth, 2);
	// healPercent = 0 desliga.
	const off = { currentHealth: 1, maxHealth: 100, friendship: 0 } as any;
	passiveSecond(off, { ...settings, healPercent: 0 });
	assert.equal(off.currentHealth, 1);

	// Desmaio: volta depois de defaultFaintTimer + 1 s com ceil(máx × 0,2) e a mensagem faintRecover.
	const fainted = { currentHealth: 0, maxHealth: 99, friendship: 10, status: StatusEffect.Faint } as any;
	const messages: string[] = [];
	let seconds = 0;
	while (fainted.currentHealth <= 0 && seconds < 1000) {
		messages.push(...passiveSecond(fainted, settings, { lastHealth: fainted.currentHealth }).messages);
		seconds++;
	}
	assert.equal(seconds, settings.defaultFaintTimer + 1, "acorda quando o timer passa de 0 para −1");
	assert.equal(fainted.currentHealth, Math.ceil(99 * 0.2));
	assert.equal(fainted.status, undefined);
	assert.deepEqual(messages, ["cobblemon.party.faintRecover"]);
	// faintAwakenHealthPercent = 0: não acorda.
	const asleepForever = { currentHealth: 0, maxHealth: 50, friendship: 0 } as any;
	for (let i = 0; i < 400; i++) passiveSecond(asleepForever, { ...settings, faintAwakenHealthPercent: 0 });
	assert.equal(asleepForever.currentHealth, 0);

	// Status: duração sorteada em passiveStatuses; some com a mensagem de cura; não conta dormindo.
	assert.equal(STATUS_IDS.tox, "cobblemon:poisonbadly");
	assert.equal(rollStatusDuration("par", settings, () => 0), 180);
	assert.equal(rollStatusDuration("par", settings, () => 0.9999), 300);
	assert.equal(rollStatusDuration("brn", { passiveStatuses: { "cobblemon:burn": [5, 5] } }), 5);
	const burned = { currentHealth: 100, maxHealth: 100, friendship: 0, status: "brn" } as any;
	const quick = { ...settings, passiveStatuses: { "cobblemon:burn": [3, 3] as [number, number] } };
	passiveSecond(burned, quick, { playerSleeping: true });
	assert.equal(burned.statusTimer.secondsLeft, 3, "dormindo não desconta");
	const cure: string[] = [];
	for (let i = 0; i < 4; i++) cure.push(...passiveSecond(burned, quick).messages);
	assert.equal(burned.status, undefined);
	assert.deepEqual(cure, ["cobblemon.status.burn.cure"]);
	// Veneno: 1/15 por segundo tira 5 % (mínimo 1); veneno grave 10 %.
	const poisoned = { currentHealth: 100, maxHealth: 100, friendship: 0, status: "psn" } as any;
	passiveSecond(poisoned, settings, { random: seq(0.5, 0) });
	assert.equal(poisoned.currentHealth, 95);
	const toxic = { currentHealth: 100, maxHealth: 100, friendship: 0, status: "tox" } as any;
	passiveSecond(toxic, settings, { random: seq(0.5, 0) });
	assert.equal(toxic.currentHealth, 90);
	const lucky = { currentHealth: 100, maxHealth: 100, friendship: 0, status: "psn" } as any;
	passiveSecond(lucky, settings, { random: seq(0.5, 0.5) });
	assert.equal(lucky.currentHealth, 100);
	// Poison Heal cura e, com HP cheio, o status some.
	const heal = { currentHealth: 96, maxHealth: 100, friendship: 0, status: "psn", ability: "poisonheal", healTimer: 30 } as any;
	passiveSecond(heal, settings, { random: seq(0.5, 0) });
	assert.equal(heal.currentHealth, 100);
	assert.equal(heal.status, undefined);
	// Desmaiar pelo veneno: status de desmaio, timer iniciado e −1 de amizade.
	const weak = { currentHealth: 1, maxHealth: 100, friendship: 50, status: "tox", healTimer: 30 } as any;
	passiveSecond(weak, settings, { random: seq(0.5, 0) });
	assert.equal(weak.currentHealth, 0);
	assert.equal(weak.status, StatusEffect.Faint);
	assert.equal(weak.friendship, 49);
	assert.equal(weak.faintedTimer, settings.defaultFaintTimer);
	// PokemonData aceita os campos novos e os preserva no JSON.
	const mon = make("pikachu", 20);
	mon.currentHealth = 1;
	passiveSecond(mon, settings);
	const reloaded = PokemonData.getFromJson(JSON.stringify(mon));
	assert.equal(reloaded.healTimer, settings.healTimer);
	assert.ok(reloaded.currentHealth > 1);
}

// 2. Sequência de evolução (Evolution.forceEvolve + evolution.animation.json).
{
	assert.deepEqual({ ...EVOLUTION_TIMELINE }, { start: 1, evolve: 11.2, cry: 12 });
	assert.equal(evolutionPhaseAt(0), "wait");
	assert.equal(evolutionPhaseAt(20), "buildup");
	assert.equal(evolutionPhaseAt(20 * 7), "glow");
	assert.equal(evolutionPhaseAt(Math.ceil(11.2 * 20)), "swap");
	assert.equal(evolutionPhaseAt(12 * 20), "cry");
	assert.equal(evolutionPhaseAt(13 * 20), "done");
	const soundsFile = join(ROOT, "generated", "resource_packs", "CobblemonBedrock", "sounds", "sound_definitions.json");
	if (existsSync(soundsFile)) {
		const sounds = readFileSync(soundsFile, "utf8");
		for (const id of Object.values(EVOLUTION_SOUNDS)) assert.ok(sounds.includes(`"${id}"`), `som ${id} existe no pack`);
	}
	// Sem entidade em campo (testes): os dados evoluem na hora, sem sequência pendente.
	const charmander = make("charmander", 16);
	const evolution = initializeEvolutions(getSpeciesData("charmander")!.evolutions)[0];
	const charmeleon = evolution.forceEvolve(charmander);
	assert.equal(charmeleon.species, "charmeleon");
	assert.ok(!isEvolving(charmeleon.uuid));
}

// 3. Espectador (SpectateBattleHandler + PokemonBattle.spectators).
{
	const base = { allowSpectating: true, maxDistance: 64, self: false, targetInBattle: true, spectatorInBattle: false, distance: 10 };
	assert.equal(checkSpectate(base), undefined);
	assert.equal(checkSpectate({ ...base, allowSpectating: false }), "disabled");
	assert.equal(checkSpectate({ ...base, allowSpectating: false, force: true }), undefined, "o comando ignora a config");
	assert.equal(checkSpectate({ ...base, self: true }), "self");
	assert.equal(checkSpectate({ ...base, targetInBattle: false }), "not_in_battle");
	assert.equal(checkSpectate({ ...base, spectatorInBattle: true }), "in_battle");
	assert.equal(checkSpectate({ ...base, distance: 65 }), "too_far");
	assert.equal(checkSpectate({ ...base, distance: Infinity }), "too_far");
	assert.equal(checkSpectate({ ...base, distance: 1000, force: true }), undefined);

	const pikachu = make("pikachu", 25);
	pikachu.currentHealth = Math.floor(pikachu.maxHealth / 2);
	pikachu.status = StatusEffect.Paralyze;
	const eevee = make("eevee", 25);
	const actor = (name: string, pokemon: PokemonData, wild = false) => ({
		getName: () => ({ text: name }), type: wild ? 0 : 1, pokemon: [pokemon], activePokemon: [{ data: pokemon }],
	});
	const side1 = { actors: [actor("Ash", pikachu)], getActivePokemon: () => [{ data: pikachu }] };
	const side2 = { actors: [actor("Wild", eevee, true)], getActivePokemon: () => [{ data: eevee }] };
	const battle: any = { spectators: [], chatLog: Array.from({ length: 20 }, (_, i) => ({ text: `linha ${i}` })), turn: 3, ended: false, sides: [side1, side2] };
	const received: unknown[] = [];
	const player: any = { id: "p1", isValid: true, sendMessage: (m: unknown) => received.push(m) };
	assert.ok(addSpectator(battle, player));
	assert.ok(!addSpectator(battle, player), "não entra duas vezes");
	assert.ok(isSpectating(battle, player));
	assert.equal(received.length, 1 + 12, "aviso + histórico (últimas 12 mensagens)");
	const lines = JSON.stringify(battleStatusLines(battle));
	assert.ok(lines.includes("cobblemon.battle.turn") && lines.includes("Ash") && lines.includes("(1/1)"));
	assert.ok(!lines.includes("Wild§r (") && lines.includes("Wild"), "selvagem sem contagem de time");
	assert.ok(JSON.stringify(activeLine(pikachu)).includes("cobblemon.ui.status.par"));
	assert.ok(JSON.stringify(activeLine(pikachu)).includes("50%") || JSON.stringify(activeLine(pikachu)).includes("49%"));
	assert.ok(removeSpectator(battle, player));
	assert.ok(!isSpectating(battle, player));
	addSpectator(battle, player);
	releaseSpectators(battle);
	assert.equal(battle.spectators.length, 0);
}

// 4. NPC start_battle com cloneParties/setLevel (BattleBuilder.pvn + BattlePokemon.safeCopyOf).
{
	assert.deepEqual(trainerTeamOptions({}), { clone: false, setLevel: undefined, heal: false });
	assert.deepEqual(trainerTeamOptions({ cloneParties: true }), { clone: true, setLevel: undefined, heal: false });
	assert.deepEqual(trainerTeamOptions({ setLevel: 50, healFirst: true }), { clone: true, setLevel: 50, heal: true });
	// setLevel != −1 implica clone mesmo com 0 (NPCServerDelegate), mas só > 0 ajusta o nível.
	assert.deepEqual(trainerTeamOptions({ setLevel: 0 }), { clone: true, setLevel: undefined, heal: false });
	assert.deepEqual(trainerTeamOptions({ setLevel: -1 }), { clone: false, setLevel: undefined, heal: false });
	assert.ok(usesClones({ setLevel: 5 }) && usesClones({ clone: true }) && !usesClones({ heal: true }));

	const a = make("bulbasaur", 10), b = make("squirtle", 12), c = make("charmander", 14);
	b.currentHealth = 0;
	c.currentHealth = 3;
	const originals = JSON.stringify([a, b, c]);
	const team = buildBattleTeam([a, null, b, c], c.uuid, { setLevel: 50 });
	assert.equal(JSON.stringify([a, b, c]), originals, "o time real não muda");
	assert.equal(team.length, 3);
	assert.ok(team.every(x => x.battleClone && x.level === 50 && x.currentHealth === x.maxHealth), "clones no nível 50, curados");
	assert.ok(team.every(x => ![a.uuid, b.uuid, c.uuid].includes(x.uuid)), "UUIDs novos");
	assert.equal(team[0].species, "charmander", "o líder vira a cópia do líder");
	const cloneOnly = buildBattleTeam([a, b], undefined, { clone: true });
	assert.equal(cloneOnly[0].level, 10);
	assert.equal(cloneOnly[1].currentHealth, 0, "clone sem cura mantém o desmaio (vai para o fim)");
	const healed = cloneForBattle(b, { clone: true, heal: true });
	assert.equal(healed.currentHealth, healed.maxHealth);
	assert.equal(b.currentHealth, 0);
	const real = buildBattleTeam([a, b], a.uuid);
	assert.ok(real[0] === a && !real[0].battleClone, "sem clone usa os mesmos objetos");
	assert.ok(!PokemonData.getFromJson(JSON.stringify(a)).battleClone);
}

// 5. Marcas: todas, replace, parceiro, Mini/Jumbo, fóssil.
{
	const marksDir = join(UPSTREAM, "data", "cobblemon", "marks");
	if (existsSync(marksDir)) {
		const upstream = readdirSync(marksDir).filter(f => f.endsWith(".json")).map(f => `cobblemon:${f.replace(/\.json$/, "")}`).sort();
		assert.deepEqual([...ALL_MARKS].sort(), upstream, "ALL_MARKS = data/cobblemon/marks");
		for (const file of readdirSync(marksDir)) {
			const json = JSON.parse(readFileSync(join(marksDir, file), "utf8"));
			const id = `cobblemon:${file.replace(/\.json$/, "")}`;
			if (json.replace?.length) assert.deepEqual(MARK_REPLACES[id], json.replace, `replace de ${id}`);
			else assert.equal(MARK_REPLACES[id], undefined);
		}
	}
	assert.equal(ALL_MARKS.length, 168);
	assert.equal(resolveMarkId("Mark_Partner"), "cobblemon:mark_partner");
	assert.equal(resolveMarkId("cobblemon:mark_nope"), undefined);
	const holder = { marks: ["cobblemon:ribbon_memory_battle"], activeMark: "cobblemon:ribbon_memory_battle" } as any;
	giveMark(holder, "cobblemon:ribbon_memory_battle_gold");
	assert.deepEqual(holder.marks, ["cobblemon:ribbon_memory_battle_gold"], "a de ouro substitui a comum");
	assert.equal(holder.activeMark, undefined);
	const mon = make("eevee");
	giveAllMarks(mon);
	assert.equal(mon.marks.length, 168);
	mon.removeMark("cobblemon:mark_rare");
	assert.equal(mon.marks.length, 167);
	// Parceiro: a cada 10 000 blocos, amizade ≥ 200, chance 1 %.
	assert.equal(PARTNER_MARK.stepsRequired, 10000);
	const friend = { marks: [], friendship: 200 } as any, stranger = { marks: [], friendship: 199 } as any;
	assert.deepEqual(partnerMarkCheck(9999, 0, [friend, stranger], () => 0), [], "ainda não andou 10 000 blocos");
	assert.deepEqual(partnerMarkCheck(10000, 9999, [friend, null, stranger], () => 0.5), [], "chance de 1 % falhou");
	assert.deepEqual(partnerMarkCheck(10000, 9999, [friend, null, stranger], () => 0.005), [friend]);
	assert.deepEqual(friend.marks, ["cobblemon:mark_partner"]);
	assert.deepEqual(partnerMarkCheck(19999, 10000, [stranger], () => 0), []);
	// Spawn: XS → Mini (sem Alfa), XL ou Alfa → Jumbo.
	assert.deepEqual(spawnGivenMarks(false, "XS"), ["cobblemon:mark_mini"]);
	assert.deepEqual(spawnGivenMarks(true, "XS"), ["cobblemon:mark_jumbo"]);
	assert.deepEqual(spawnGivenMarks(false, "XL"), ["cobblemon:mark_jumbo"]);
	assert.deepEqual(spawnGivenMarks(false, "M"), []);
	assert.deepEqual(spawnGivenMarks(true), ["cobblemon:mark_jumbo"]);
	// Fóssil: potenciais raras/personalidade/Revival, sorteadas se houver jogador.
	assert.ok(FOSSIL_POTENTIAL_MARKS.includes("cobblemon:mark_revival") && FOSSIL_POTENTIAL_MARKS.length === 31);
	const fossil = { marks: [] } as any;
	assert.ok(!applyFossilMarks(fossil, false));
	assert.equal(fossil.potentialMarks.length, 31);
	const fossil2 = { marks: [] } as any;
	assert.ok(applyFossilMarks(fossil2, true, () => 0));
	assert.equal(fossil2.marks.length, 1);
}

// 6. Cosméticos (data/cobblemon/cosmetic_items + COSMETIC_SLOT_ASPECT).
{
	const dir = join(UPSTREAM, "data", "cobblemon", "cosmetic_items");
	if (existsSync(dir)) {
		const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort();
		assert.equal(files.length, COSMETIC_ITEMS.length);
		files.forEach((file, i) => {
			const json = JSON.parse(readFileSync(join(dir, file), "utf8"));
			assert.deepEqual(COSMETIC_ITEMS[i], json, `cosmético ${file}`);
		});
	}
	const pikachu = make("pikachu");
	assert.ok(canWearCosmetics(pikachu));
	assert.ok(!canWearCosmetics(make("bulbasaur")));
	assert.deepEqual(findCosmeticFor(pikachu, "cobblemon:big_malasada")?.aspects, ["cosmetic_item-big_malasada"]);
	assert.equal(findCosmeticFor(pikachu, "minecraft:stick"), undefined);
	const before = resolveVariant("pikachu", pikachu.aspects);
	assert.equal(pikachu.setCosmeticItem("cobblemon:big_malasada"), undefined);
	assert.ok(pikachu.aspects.includes("cosmetic_item-big_malasada"));
	assert.notEqual(pikachu.variant, before, "o cosmético muda o visual");
	assert.equal(pikachu.setCosmeticItem("minecraft:compass"), "cobblemon:big_malasada");
	assert.ok(!pikachu.aspects.includes("cosmetic_item-big_malasada") && pikachu.aspects.includes("cosmetic_item-compass"));
	pikachu.setCosmeticItem(undefined);
	assert.ok(!pikachu.aspects.some(a => ALL_COSMETIC_ASPECTS.has(a)));
	assert.equal(pikachu.variant, before);
	// Tags de tronco e propriedades "hisuian=false".
	assert.ok(itemMatchesTag("#minecraft:oak_logs", "minecraft:stripped_oak_wood"));
	assert.ok(itemMatchesTag("#minecraft:crimson_stems", "minecraft:crimson_hyphae"));
	assert.ok(itemMatchesTag("#cobblemon:apricorn_logs", "cobblemon:strip_apricorn_log"));
	assert.ok(!itemMatchesTag("#minecraft:oak_logs", "minecraft:dark_oak_log"));
	assert.deepEqual(findCosmeticFor({ species: "timburr", aspects: [] }, "minecraft:birch_log")?.aspects, ["tree-birch"]);
	assert.ok(matchesPokemon("electrode hisuian=false", { species: "electrode", aspects: [] }));
	assert.ok(!matchesPokemon("electrode hisuian=false", { species: "electrode", aspects: ["hisuian"] }));
	// Troca genérica mantém aspects que não são do cosmético.
	const holder = { species: "furfrou", aspects: ["natural-trim"], cosmeticItem: undefined } as any;
	swapCosmeticItem(holder, "minecraft:red_dye");
	assert.deepEqual(holder.aspects, ["natural-trim", "color-red", "colour-red"]);
}

// 7. Tamanho intrínseco / filhote (Pokemon.scaleModifier, effectiveScale, PokemonSizeCategory).
{
	assert.equal(roundIntrinsicScale(1.04374), 1.044);
	assert.equal(roundIntrinsicScale(0.01), 0.05);
	assert.equal(rollIntrinsicScale(undefined, true), 1);
	assert.equal(rollIntrinsicScale(undefined, false, () => 0), 0.95);
	assert.equal(rollIntrinsicScale(undefined, false, () => 1), 1.05);
	assert.equal(sizeCategoryOf(0.95), "XS");
	assert.equal(sizeCategoryOf(0.969), "XS");
	assert.equal(sizeCategoryOf(0.97), "S");
	assert.equal(sizeCategoryOf(1), "M");
	assert.equal(sizeCategoryOf(undefined), "M");
	assert.equal(sizeCategoryOf(1.049), "XL");
	assert.equal(sizeCategoryOf(2), "XL");
	assert.equal(babyMultiplier(1), 0.9);
	assert.equal(babyMultiplier(9), 1);
	assert.ok(Math.abs(babyMultiplier(5) - 0.95) < 1e-9);
	assert.ok(Math.abs(effectiveScale(1, 1.05) - 0.945) < 1e-9);
	for (let i = 0; i < 20; i++) {
		const mon = make("rattata", 1 + i);
		assert.ok(mon.scaleModifier! >= 0.95 && mon.scaleModifier! <= 1.05, "sorteado ao criar");
	}
	const alpha = PokemonData.generateNewWildPokemon("rattata", { level: 5, aspects: ["alpha"] });
	assert.equal(alpha.scaleModifier, 1);
	assert.equal(alpha.getEffectiveScale(), 1);
	const legacy = JSON.parse(JSON.stringify(make("rattata")));
	delete legacy.scaleModifier;
	assert.equal(PokemonData.getFromJson(legacy).getSizeCategory(), "M");
	// Propriedade de escala só é gravada se a entidade a declarar.
	const withProp: any = { value: 1, getProperty: (id: string) => id === SCALE_PROPERTY ? withProp.value : undefined, setProperty: (_: string, v: number) => { withProp.value = v; } };
	assert.ok(applyScaleProperty(withProp, 0.93));
	assert.equal(withProp.value, 0.93);
	assert.ok(!applyScaleProperty({ getProperty: () => undefined, setProperty: () => { throw new Error("não declarada"); } }, 0.9));
}

// 8. Furfrou: tesoura + corante vestido → corte (action effect furfrou_trim).
{
	assert.equal(interactionScriptAction("q.pokemon.run_action_effect('cobblemon:furfrou_trim');"), "furfrou_trim");
	assert.equal(interactionScriptAction("q.pokemon.something_else();"), undefined);
	assert.equal(Object.keys(FURFROU_TRIMS).length, 16);
	const furfrou = make("furfrou");
	furfrou.setCosmeticItem("minecraft:pink_dye");
	assert.ok(furfrou.aspects.includes("color-pink"));
	assert.equal(applyFurfrouTrim(furfrou), "heart");
	assert.ok(furfrou.aspects.includes("heart-trim"));
	assert.equal(furfrou.aspects.filter(a => a.endsWith("-trim")).length, 1);
	assert.ok(!furfrou.aspects.includes("color-pink"), "o corante é consumido");
	assert.equal(furfrou.cosmeticItem, undefined);
	assert.notEqual(resolveVariant("furfrou", ["heart-trim"]), resolveVariant("furfrou", ["natural-trim"]), "corte tem visual próprio");
	// Sem corante: só consome o cosmético.
	const plain = make("furfrou");
	plain.aspects = plain.aspects.filter(a => !a.endsWith("-trim")).concat("star-trim");
	assert.equal(applyFurfrouTrim(plain), undefined);
	assert.ok(plain.aspects.includes("star-trim"));
	// Todos os cortes existem no resolver de variações.
	// Frente otimizacao (#8): a tabela está em JSON.parse("…"); o texto JSON dela tem os aspects entre aspas.
	const variants = JSON.stringify(readGeneratedTableText(readFileSync(join(ROOT, "generated", "scripts", "variants.ts"), "utf8"), "VARIANTS"));
	for (const trim of Object.values(FURFROU_TRIMS)) assert.ok(variants.includes(`"${trim}-trim"`), `corte ${trim}`);
}

// 9. Mobs vanilla que fogem (behaviour.entityInteract + JSON vanilla sobrescritos).
{
	const meowth = getSpeciesData("meowth")!;
	assert.deepEqual(avoidedBy(meowth.behaviour), ["creeper", "phantom"]);
	const alola = meowth.forms?.find(f => f.name === "Alola");
	assert.deepEqual(avoidedBy(meowth.behaviour, alola?.behaviour), ["creeper"], "o bloco da forma substitui o da espécie");
	assert.deepEqual(make("growlithe").getAvoidedBy(), ["skeleton", "fox"]);
	assert.deepEqual(make("bulbasaur").getAvoidedBy(), []);
	const tags = new Set<string>(["cobblemon_avoided_by_fox"]);
	applyAvoidTags({ hasTag: t => tags.has(t), addTag: t => (tags.add(t), true), removeTag: t => tags.delete(t) }, ["creeper"]);
	assert.deepEqual([...tags], [avoidTag("creeper")]);
	const dir = join(ROOT, "behavior_packs", "CobblemonBedrock", "entities", "vanilla_overrides");
	const stripComments = (text: string) => text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => str ?? "");
	const expected: Record<string, string> = {
		creeper: "creeper", skeleton: "skeleton", stray: "skeleton", wither_skeleton: "skeleton", bogged: "skeleton", fox: "fox", phantom: "phantom",
	};
	for (const [file, mob] of Object.entries(expected)) {
		const json = JSON.parse(stripComments(readFileSync(join(dir, `${file}.json`), "utf8")));
		const entity = json["minecraft:entity"];
		assert.equal(entity.description.identifier, `minecraft:${file}`);
		const avoid = entity.components["minecraft:behavior.avoid_mob_type"];
		const entries = JSON.stringify(avoid.entity_types);
		assert.ok(entries.includes(`"cobblemon_avoided_by_${mob}"`) && entries.includes("\"pokemon_shoulder\""), `${file} foge de Pokémon`);
	}
}

// 10. block_click (BlockClickEvolution).
{
	assert.ok(blockClickMatches("minecraft:dirt", "minecraft:dirt"));
	assert.ok(blockClickMatches("dirt", "minecraft:dirt"));
	assert.ok(!blockClickMatches("#minecraft:logs", "minecraft:oak_log"), "tags de bloco não são resolvidas");
	const evo = BlockClickEvolution.getFromSerializied({ id: "x", variant: "block_click", result: "ivysaur", consumeHeldItem: false, learnableMoves: [], requiredContext: "minecraft:grass_block", requirements: [] } as any);
	assert.ok(evo.testContext(make("bulbasaur"), "minecraft:grass_block"));
	assert.equal(initializeEvolutions([{ id: "y", variant: "block_click", result: "ivysaur", consumeHeldItem: false, learnableMoves: [], requiredContext: "minecraft:dirt", requirements: [] } as any]).length, 1);
	assert.equal(anySpeciesUsesBlockClick(), false, "nenhuma espécie do 1.8.2 usa block_click");
}

console.log("jogabilidade-final: ok");
