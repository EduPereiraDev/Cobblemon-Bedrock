// Modelo de dados do Pokémon (frente "dados") com os dados reais do Cobblemon (generated/):
// EVs/IVs, amizade, formas, habilidades, natureza/mint, moveset, PP, experiência e compatibilidade de saves.
import assert from "node:assert/strict";
import { Dex } from "../scripts/showdown";
import { PokemonData, evYieldToStats, resolveNature } from "../scripts/Pokemon";
import { PokemonProperties } from "../scripts/PokemonProperties";
import { getSpeciesData, getAvaliableMoves } from "../scripts/speciesData";
import { ExperienceGroups, calculateExpGain } from "../scripts/Experience";
import { calculateEvYield } from "../scripts/pokemon/Stats";
import { initializeEvolutions } from "../scripts/evolution";
import { addPotentialMarks, applyPotentialMarks, spawnPotentialMarks } from "../scripts/pokemon/Marks";
import { rollShiny } from "../scripts/Pokemon";
import { showdownItemOf } from "../scripts/items/heldItems";

const originalWarn = console.warn;
console.warn = () => { };
const make = (species: string, level = 30, extra: Parameters<typeof PokemonData.generateNewWildPokemon>[1] = {}) =>
	PokemonData.generateNewWildPokemon(species, { level, shiny: false, ...extra });

// 1. EVs: 252 por atributo, 510 no total; chaves do Cobblemon aceitas; remoção até zero.
{
	const mon = make("bulbasaur");
	assert.equal(mon.addEvs({ atk: 300 }), 252);
	assert.equal(mon.evs.atk, 252);
	assert.equal(mon.addEvs({ spe: 252 }), 252);
	assert.equal(mon.addEvs({ hp: 100 }), 6, "total limitado a 510");
	assert.equal(mon.getEvTotal(), 510);
	assert.equal(mon.addEvs({ def: 4 }), 0);
	assert.equal(mon.removeEvs({ atk: 10 }), 10);
	assert.equal(mon.evs.atk, 242);
	assert.equal(mon.removeEvs({ hp: 50 }), 6, "remoção não passa de zero");
	assert.equal(mon.evs.hp, 0);
	assert.ok(mon.resetEvs());
	assert.equal(mon.getEvTotal(), 0);
	// Chaves do Cobblemon direto no addEvs e via evYieldToStats.
	assert.equal(mon.addEvs({ special_attack: 3 } as any), 3);
	assert.equal(mon.evs.spa, 3);
	assert.deepEqual(evYieldToStats({ hp: 0, attack: 1, defence: 2, special_attack: 0, special_defence: 0, speed: 3 }), { hp: 0, atk: 1, def: 2, spa: 0, spd: 0, spe: 3 });
	assert.deepEqual(make("bulbasaur").getEvYield(), { hp: 0, atk: 0, def: 0, spa: 1, spd: 0, spe: 0 });
	// Power Weight: +8 HP mesmo com yield 0.
	assert.deepEqual(calculateEvYield({ spa: 1 }, "powerweight"), { hp: 8, spa: 1 });
	// setEv respeita os limites.
	assert.ok(!mon.setEv("hp", 253));
	assert.ok(mon.setEv("hp", 252));
}

// 2. Amizade: limite 0..255, Luxury Ball ×2, Soothe Bell +50%, alias "happiness".
{
	const mon = make("pikachu");
	assert.equal(mon.friendship, getSpeciesData("pikachu")!.baseFriendship);
	mon.setFriendship(300);
	assert.equal(mon.friendship, 255);
	mon.addFriendship(10);
	assert.equal(mon.friendship, 255);
	mon.addFriendship(-500);
	assert.equal(mon.friendship, 0);
	mon.addFriendship(10);
	assert.equal(mon.friendship, 10);
	mon.pokeball = "cobblemon:luxury_ball";
	mon.addFriendship(10);
	assert.equal(mon.friendship, 30, "Luxury Ball dobra o ganho");
	mon.minecraftItem = "cobblemon:soothe_bell";
	mon.addFriendship(10);
	assert.equal(mon.friendship, 60, "Luxury Ball + Soothe Bell: 10 → 20 → 30");
	mon.addFriendship(-5);
	assert.equal(mon.friendship, 55, "perdas não são multiplicadas");
	mon.setFriendship(250);
	mon.addFriendship(10);
	assert.equal(mon.friendship, 255);
	assert.equal(mon.happiness, 255);
	assert.equal((mon.toShowdownSet() as any).happiness, 255);
}

// 3. Formas: Raichu de Alola tem tipos, habilidades, atributos e golpes próprios.
{
	const kanto = make("raichu", 40);
	const alola = make("raichu", 40, { aspects: ["alolan"] });
	assert.equal(kanto.getFormData(), undefined);
	assert.equal(alola.getFormData()?.name, "Alola");
	assert.deepEqual(kanto.getTypes(), ["electric"]);
	assert.deepEqual(alola.getTypes(), ["electric", "psychic"]);
	assert.equal(alola.ability, "surgesurfer");
	assert.notEqual(kanto.ability, "surgesurfer");
	assert.equal(alola.getBaseStats().special_attack, 95);
	assert.equal(kanto.getBaseStats().special_attack, 90);
	assert.equal(alola.getShowdownSpecies(), "Raichu-Alola");
	assert.ok(alola.getLevelUpMoves(1).includes("psychic"), "Raichu de Alola aprende Psychic por nível");
	assert.ok(!kanto.getLevelUpMoves(1).includes("psychic"));
	assert.ok(getAvaliableMoves("raichu", 1, ["alolan"]).includes("psychic"));
	// Tipo secundário: forma que só define o primário não herda o secundário da espécie.
	const partner = make("pikachu", 10, { aspects: ["partner-cap"] });
	assert.deepEqual(partner.getTypes(), ["electric"]);
	// Evoluções vêm da forma (Rattata de Alola → Raticate de Alola).
	const rattata = make("rattata", 20, { aspects: ["alolan"] });
	assert.deepEqual(rattata.getEvolutions().map(e => e.result.aspects), [["alolan"]]);
	assert.equal(make("sandshrew", 10, { aspects: ["alolan"] }).getPrimaryType(), "ice");
}

// 4. Habilidade oculta: nunca no spawn padrão (Cobblemon 1.8.2); com chance 1 (iscas), sempre.
{
	for (let i = 0; i < 300; i++) {
		const mon = make("bulbasaur", 5);
		assert.equal(mon.ability, "overgrow");
		assert.ok(!mon.hasHiddenAbility());
	}
	for (let i = 0; i < 50; i++)
		assert.equal(make("bulbasaur", 5, { hiddenAbilityChance: 1 }).ability, "chlorophyll");
	const forced = make("bulbasaur", 5, { hiddenAbility: true });
	assert.ok(forced.hasHiddenAbility());
	assert.equal(forced.abilityPriority, "LOW");
	assert.ok(PokemonProperties.parse("bulbasaur ha").apply(make("bulbasaur")).hasHiddenAbility());
}

// 5. Ability Capsule e Ability Patch.
{
	const girafarig = make("girafarig");
	girafarig.setAbility("innerfocus");
	assert.ok(girafarig.canUseAbilityCapsule());
	assert.ok(girafarig.useAbilityCapsule());
	assert.equal(girafarig.ability, "earlybird");
	assert.equal(girafarig.abilityIndex, 1);
	assert.ok(girafarig.useAbilityPatch());
	assert.equal(girafarig.ability, "sapsipper");
	assert.ok(!girafarig.canUseAbilityCapsule(), "Capsule não sai da oculta");
	assert.ok(girafarig.useAbilityPatch(), "Patch volta da oculta para uma comum");
	assert.ok(["innerfocus", "earlybird"].includes(girafarig.ability));
	const pikachu = make("pikachu");
	assert.ok(!pikachu.canUseAbilityCapsule(), "Pikachu só tem uma habilidade comum");
	pikachu.setAbility("wonderguard");
	assert.ok(pikachu.abilityForced);
	assert.ok(!pikachu.canUseAbilityPatch(), "habilidade forçada não troca");
}

// 6. Evolução mantém o slot da habilidade (prioridade + índice).
{
	const girafarig = make("girafarig", 40);
	girafarig.setAbility("earlybird");
	const farigiraf = PokemonProperties.parse("farigiraf").apply(girafarig);
	assert.equal(farigiraf.ability, "armortail", "2ª comum → 2ª comum");
	girafarig.setAbility("sapsipper");
	assert.equal(PokemonProperties.parse("farigiraf").apply(girafarig).ability, "sapsipper");
	const magikarp = make("magikarp", 20, { hiddenAbility: true });
	assert.equal(magikarp.ability, "rattled");
	const evolution = initializeEvolutions(getSpeciesData("magikarp")!.evolutions)[0];
	const gyarados = evolution.forceEvolve(magikarp);
	assert.equal(gyarados.species, "gyarados");
	assert.equal(gyarados.ability, "moxie", "oculta → oculta");
	const nincada = make("nincada", 20);
	assert.equal(PokemonProperties.parse("ninjask").apply(nincada).ability, "speedboost");
	// Dados antigos (sem prioridade/índice) também mantêm o slot.
	const old = JSON.parse(JSON.stringify(make("girafarig", 40)));
	old.ability = "earlybird";
	delete old.abilityPriority; delete old.abilityIndex; delete old.abilityForced;
	assert.equal(PokemonProperties.parse("farigiraf").apply(PokemonData.getFromJson(old)).ability, "armortail");
}

// 7. Natureza e Mint: atributos usam a natureza efetiva.
{
	const mon = make("machop", 50);
	mon.nature = "Hardy";
	mon.updateMaxHP();
	const neutral = mon.getCurrentStats();
	assert.ok(mon.applyMint("cobblemon:adamant"));
	assert.equal(mon.getEffectiveNature(), "Adamant");
	assert.equal(mon.nature, "Hardy", "a natureza original é mantida");
	const minted = mon.getCurrentStats();
	assert.equal(minted.atk, Math.floor(neutral.atk * 1.1));
	assert.equal(minted.spa, Math.floor(neutral.spa * 0.9));
	assert.equal((mon.toShowdownSet() as any).nature, "Adamant");
	assert.ok(!mon.applyMint("adamant_mint"), "mint da mesma natureza falha");
	assert.equal(resolveNature("modest_mint"), "Modest");
	assert.equal(resolveNature("banana"), undefined);
}

// 8. IVs e Hyper Training.
{
	const mon = make("machop", 50);
	mon.ivs.atk = 0;
	mon.updateMaxHP();
	const before = mon.getCurrentStats().atk;
	assert.ok(mon.hyperTrain("atk"));
	assert.equal(mon.getEffectiveIv("atk"), 31);
	assert.equal(mon.ivs.atk, 0, "IV natural não muda");
	assert.ok(mon.getCurrentStats().atk > before);
	assert.equal((mon.toShowdownSet() as any).ivs.atk, 31);
	assert.ok(!mon.adjustHyperTrainedIv("atk", 1), "não passa de 31");
	assert.ok(mon.adjustHyperTrainedIv("atk", -1));
	assert.equal(mon.getEffectiveIv("atk"), 30);
	assert.ok(mon.hyperTrain("atk", 0), "voltar ao IV natural desfaz o Hyper Training");
	assert.ok(!mon.isHyperTrained("atk"));
}

// 9. Moveset selvagem = moveset builder "wild" (últimos golpes por nível, 1º slot ofensivo).
{
	for (let i = 0; i < 30; i++) {
		const mon = make("bulbasaur", 20);
		assert.deepEqual([...mon.moves].sort(), ["poisonpowder", "razorleaf", "seedbomb", "sleeppowder"]);
		assert.equal(mon.moves[0], "seedbomb", "slot 1 = último golpe ofensivo");
		assert.equal(mon.movesInfo.length, 4);
	}
	const low = make("bulbasaur", 2);
	assert.deepEqual([...low.moves].sort(), ["growl", "tackle"]);
	for (const id of ["pikachu", "gyarados", "eevee", "mewtwo"]) {
		const mon = make(id, 50);
		const levelMoves = mon.getLevelUpMoves();
		for (const move of mon.moves) assert.ok(levelMoves.includes(move), `${id}: ${move} não é golpe por nível`);
		assert.equal(mon.moves.length, Math.min(4, levelMoves.length));
	}
}

// 10. Learnset: TM/tutor/egg, ensinar, esquecer e PP Up.
{
	const mon = make("pikachu", 20);
	assert.ok(mon.canLearnMove("thunderbolt"));
	assert.ok(mon.getMoveSources("thunderbolt").includes("tm"));
	assert.ok(!mon.canLearnMove("spore"));
	assert.ok(mon.getLearnableMoves().includes("thunderbolt"));
	assert.ok(!mon.getAccessibleMoves().includes("thunderbolt"), "TM não fica acessível sem ensinar");
	while (mon.moves.length < 4) assert.ok(mon.teachMove(mon.getLearnableMoves().find(m => !mon.moves.includes(m))!));
	assert.ok(mon.teachMove("thunderbolt"), "sem espaço: fica guardado");
	assert.ok(mon.learnedMoves.includes("thunderbolt"));
	assert.ok(!mon.moves.includes("thunderbolt"));
	const replaced = mon.moves[0];
	assert.ok(mon.teachMove("thunderbolt", 0));
	assert.equal(mon.moves[0], "thunderbolt");
	assert.ok(mon.learnedMoves.includes(replaced), "golpe trocado vai para os guardados");
	assert.ok(!mon.learnedMoves.includes("thunderbolt"));
	assert.ok(mon.getRelearnableMoves().includes(replaced));
	assert.ok(mon.forgetMove(3));
	assert.equal(mon.moves.length, 3);

	const tackle = make("bulbasaur", 2);
	const slot = tackle.moves.indexOf("tackle");
	assert.equal(tackle.movesInfo[slot].maxPp, 35);
	assert.ok(tackle.ppUp(slot));
	assert.equal(tackle.movesInfo[slot].maxPp, 42);
	assert.equal(tackle.getPpStages(slot), 1);
	assert.ok(tackle.ppMax(slot));
	assert.equal(tackle.movesInfo[slot].maxPp, 56);
	assert.ok(!tackle.ppUp(slot), "máximo de 3 estágios");
}

// 11. Experiência: curvas iguais às do Cobblemon (aritmética inteira) e gainExp estruturado.
{
	const at = (group: string, level: number) => ExperienceGroups[group].getExperience(level);
	assert.equal(at("erratic", 100), 600000);
	assert.equal(at("fluctuating", 100), 1640000);
	assert.equal(at("slow", 100), 1250000);
	assert.equal(at("medium_slow", 100), 1059860);
	assert.equal(at("fast", 100), 800000);
	assert.equal(at("medium_fast", 100), 1000000);
	assert.equal(at("erratic", 70), Math.trunc(Math.trunc(343000 * 1211 / 3) / 500));
	assert.equal(at("fluctuating", 10), Math.trunc(1000 * (3 + 24) / 50));
	for (const group of Object.keys(ExperienceGroups))
		for (const level of [2, 15, 36, 50, 68, 98, 99, 100]) {
			assert.equal(ExperienceGroups[group].getLevel(at(group, level)), level, `${group} nível ${level}`);
			assert.equal(ExperienceGroups[group].getLevel(at(group, level) - 1), level - 1, `${group} antes do nível ${level}`);
		}

	const mon = make("bulbasaur", 5);
	mon.trainer = "player-1";
	mon.moves = ["tackle"]; mon.movesInfo = [{ pp: 35, maxPp: 35, extraPp: 0 }];
	mon.setFriendship(70);
	const hpBefore = mon.maxHealth;
	const result = mon.gainExp(ExperienceGroups.medium_slow.getExperience(9) - mon.experience);
	assert.equal(result.oldLevel, 5);
	assert.equal(result.newLevel, 9);
	assert.equal(mon.level, 9);
	assert.deepEqual(result.newMoves, ["growth", "leechseed"]);
	assert.deepEqual(result.addedMoves, ["growth", "leechseed"]);
	assert.ok(mon.moves.includes("leechseed"));
	assert.equal(result.friendshipGained, 12, "3 de amizade por nível abaixo de 100");
	assert.ok(mon.maxHealth > hpBefore);
	const capped = make("bulbasaur", 100);
	assert.equal(capped.gainExp(1000).experienceAdded, 0, "nível máximo não ganha EXP");
	// Evolução por nível ao ganhar EXP.
	const charmander = make("charmander", 15);
	const evo = charmander.gainExp(ExperienceGroups.medium_slow.getExperience(16) - charmander.experience);
	assert.equal(evo.newLevel, 16);
	assert.ok(evo.evolutions.length > 0 && charmander.readyEvolutions.length > 0, "Charmander 16 deve ter evolução pronta");
	// EXP usa o yield da forma e a afeição.
	const victor = make("bulbasaur", 20);
	const fainted = make("rattata", 20);
	victor.setFriendship(0);
	const base = calculateExpGain(victor, fainted, 1, "x");
	victor.setFriendship(255);
	assert.equal(calculateExpGain(victor, fainted, 1, "x"), Math.round(base * 1.2));
}

// 12. Saves antigos continuam carregando (happiness, sem movesInfo/marcas/hyper training).
{
	const legacy = {
		name: "", currentHealth: 20, uuid: "legacy-uuid", species: "pikachu", item: "", ability: "static",
		moves: ["thundershock", "growl"], movesInfo: [{ pp: 30, maxPp: 30, extraPp: 0 }], nature: "Timid", gender: "m",
		evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
		level: 12, experience: 0, learnedMoves: [], maxHealth: 36, evolutionProgress: [], readyEvolutions: [],
		entityStates: {}, shiny: false, happiness: 123,
	};
	const loaded = PokemonData.getFromJson(JSON.stringify(legacy));
	assert.equal(loaded.friendship, 123);
	assert.deepEqual(loaded.aspects, ["male"]);
	assert.equal(loaded.movesInfo.length, 2);
	assert.equal(loaded.movesInfo[1].maxPp, 40);
	assert.deepEqual(loaded.marks, []);
	assert.deepEqual(loaded.hyperTrainedIvs, {});
	assert.ok(loaded.experience > 0);
	assert.equal(loaded.abilityPriority, "LOWEST");
	const roundTrip = PokemonData.getFromJson(JSON.stringify(loaded));
	assert.equal(roundTrip.friendship, 123);
	assert.ok(!("happiness" in JSON.parse(JSON.stringify(loaded))), "novo save grava só friendship");
	const noFriendship = { ...legacy } as Record<string, unknown>;
	delete noFriendship.happiness;
	assert.equal(PokemonData.getFromJson(noFriendship).friendship, getSpeciesData("pikachu")!.baseFriendship);
	// Marcas e cosméticos.
	assert.ok(loaded.addMark("cobblemon:mark_alpha"));
	assert.ok(loaded.setActiveMark("cobblemon:mark_alpha"));
	assert.ok(!loaded.setActiveMark("cobblemon:mark_other"));
	assert.equal(loaded.setCosmeticItem("minecraft:carved_pumpkin"), undefined);
	assert.equal(PokemonData.getFromJson(JSON.stringify(loaded)).activeMark, "cobblemon:mark_alpha");
}

// 13. Propriedades novas.
{
	const props = PokemonProperties.parse("pikachu friendship=200 hp_iv=0 attack_ev=252 level=30");
	const mon = props.apply(make("pikachu", 10));
	assert.equal(mon.friendship, 200);
	assert.equal(mon.ivs.hp, 0);
	assert.equal(mon.evs.atk, 252);
	assert.equal(mon.level, 30);
	assert.ok(props.match(mon));
	assert.ok(Dex.moves.get(mon.moves[0]).exists);
}

// Integração: marcas em potencial (spawn → captura), shiny pela config, item segurado → Showdown, moves=/tradeable.
{
	const mon = make("pikachu");
	const marks = spawnPotentialMarks({ overworld: true, y: 64, timeOfDay: 1000, raining: true, thundering: false, biomeIs: () => false });
	assert.ok(marks.includes("cobblemon:mark_weather_rainy") && marks.includes("cobblemon:mark_time_dawn") && marks.includes("cobblemon:mark_rare"));
	addPotentialMarks(mon, ...marks);
	// Menor chance primeiro (rara, 0,001): random 0 → a marca rara sai; a lista é limpa.
	assert.ok(applyPotentialMarks(mon, 1, () => 0));
	assert.ok(mon.marks.includes("cobblemon:mark_rare"));
	assert.deepEqual(mon.potentialMarks, []);
	addPotentialMarks(mon, "cobblemon:mark_uncommon");
	assert.equal(applyPotentialMarks(mon, 1, () => 0.99), false);
	assert.equal(rollShiny(0), false);
	assert.equal(rollShiny(1), true);
	assert.equal(showdownItemOf({ minecraftItem: "cobblemon:charcoal_stick" }), "charcoal");
	assert.equal(showdownItemOf({ minecraftItem: "cobblemon:medicinal_leek" }), "leek");
	mon.minecraftItem = "cobblemon:charcoal_stick";
	assert.equal(mon.toShowdownSet().item, "charcoal");
	const taught = PokemonProperties.parse("moves=thunderbolt,surf tradeable=false").apply(make("pikachu", 30));
	assert.ok(taught.moves.includes("thunderbolt") && taught.moves.includes("surf"));
	assert.equal(taught.movesInfo.length, taught.moves.length);
	assert.equal(taught.tradeable, false);
}

console.warn = originalWarn;
console.log("ok: dados do Pokémon (EVs, amizade, formas, habilidades, mints, moveset, PP, EXP, saves antigos)");
