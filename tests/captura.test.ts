// Captura e Pokédex (frente "captura"): fórmula do CobblemonCaptureCalculator 1.8.2, modificadores das bolas,
// captura crítica, linha do tempo das sacudidas e armazenamento da Pokédex em pedaços.
import assert from "node:assert/strict";
import type { Player } from "@minecraft/server";
import { PokemonData } from "../scripts/Pokemon";
import {
  calculateCapture, computeModifiedCatchRate, criticalCaptureThreshold, criticalCaughtMultiplier, influenceCapture,
  lowLevelCaptureBonus, rollShakes, shakeProbability, shakeSuccessChance, statusCaptureBonus, captureSuccessChance,
} from "../scripts/catching/CaptureCalculator";
import {
  beastBallMultiplier, duskBallMultiplier, heavyBallMultiplier, levelBallMultiplier, loveBallMultiplier, moonBallMultiplier,
  nestBallMultiplier, quickBallMultiplier, repeatBallMultiplier, timerBallMultiplier,
} from "../scripts/catching/StandardModifiers";
import { getAllPokeBalls, getPokeBall, pokeBallName, projectilePower } from "../scripts/catching/PokeBalls";
import { buildCaptureTimeline } from "../scripts/catching/CaptureTimeline";
import { DexProgress, PokedexRecords, byteLength, splitIntoChunks, MAX_CHUNK_BYTES } from "../scripts/pokedex/PokedexRecords";
import {
  DEX_PROPERTY_COUNT, DEX_PROPERTY_PREFIX, DexPropertyHolder, batchPokedex, forgetPokedex, getCaughtCount, getPokedex,
  getSpeciesKnowledge, hasCaught, hasSeen, markCaught, markSeen, readPokedexChunks,
} from "../scripts/pokedex/PokedexStorage";
import { computeDexCounts, formEntryId, getDex, getDexes, getEntryKnowledge, getNationalEntry, regionForNumber, setDexData } from "../scripts/pokedex/DexData";
import { descriptionKeys, spawnSummary } from "../scripts/pokedex/PokedexUI";
import { grantEntries } from "../scripts/pokedex/PokedexCommand";
import { getSpeciesData } from "../scripts/speciesData";

const originalWarn = console.warn;
console.warn = () => { };
const thrower = { id: "thrower", isValid: false } as unknown as Player;
const make = (species: string, level = 20, extra: Parameters<typeof PokemonData.generateNewWildPokemon>[1] = {}) =>
	PokemonData.generateNewWildPokemon(species, { level, shiny: false, ...extra });

/** Sorteio determinístico: devolve os valores em ordem. */
function sequence(...values: number[]) {
	let i = 0;
	return (bound: number) => {
		const value = values[i++ % values.length];
		assert.ok(value < bound, `valor ${value} fora do limite ${bound}`);
		return value;
	};
}

// 1. Fórmula (valores calculados à mão com a fórmula do Kotlin, Float 32 bits).
{
	const base = { inBattle: false, ballBonus: 1 };
	// Pikachu 190, nível 10, HP cheio 30, fora de batalha: (90-60)*190*0.5/90 = 31,6667.
	let m = computeModifiedCatchRate({ ...base, maxHealth: 30, currentHealth: 30, catchRate: 190, level: 10 });
	assert.equal(m, Math.fround(95 / 3));
	assert.equal(shakeProbability(m), 44322);
	// Nível 1: bônus (36-2)/10 = 3 (divisão inteira): 7,5 × 3 = 22,5.
	assert.equal(lowLevelCaptureBonus(1), 3);
	assert.equal(lowLevelCaptureBonus(4), 2);
	assert.equal(lowLevelCaptureBonus(9), 1);
	assert.equal(lowLevelCaptureBonus(13), 1);
	m = computeModifiedCatchRate({ ...base, maxHealth: 20, currentHealth: 20, catchRate: 45, level: 1 });
	assert.equal(m, 22.5);
	assert.equal(shakeProbability(m), 41571);
	// Em batalha, dormindo, metade do HP, Ultra Ball: (300-100)*45*2/300 * 2,5 = 150.
	m = computeModifiedCatchRate({ maxHealth: 100, currentHealth: 50, catchRate: 45, inBattle: true, status: "slp", level: 40, ballBonus: 2 });
	assert.equal(m, 150);
	assert.equal(shakeProbability(m), 59330);
	// Lendário (3), 1 HP, envenenado: 4,48 → 30716.
	m = computeModifiedCatchRate({ maxHealth: 150, currentHealth: 1, catchRate: 3, inBattle: true, status: "psn", level: 70, ballBonus: 1 });
	assert.equal(m, Math.fround(4.48));
	assert.equal(shakeProbability(m), 30716);
	// Status.
	assert.equal(statusCaptureBonus("frz"), 2.5);
	assert.equal(statusCaptureBonus("tox"), 1.5);
	assert.equal(statusCaptureBonus(undefined), 1);
	// Probabilidade de captura = (limiar/65537)^4: nem taxa 255 é garantida (nextInt(65537) pode dar 65536).
	assert.equal(captureSuccessChance(255), Math.pow(65536 / 65537, 4));
	assert.equal(captureSuccessChance(4000), 1);
	assert.ok(Math.abs(captureSuccessChance(150) - Math.pow(59330 / 65537, 4)) < 1e-12);
	assert.equal(shakeSuccessChance(0), 0);
	// Penalidade de nível (código morto no 1.8.2 para selvagens, mas a conta segue o Kotlin: Int/Int).
	const withPenalty = (highest: number) => computeModifiedCatchRate({ maxHealth: 30, currentHealth: 30, catchRate: 255, inBattle: true, level: 80, ballBonus: 1, highestThrowerLevel: highest });
	assert.equal(withPenalty(60), 85, "diferença 20 / 50 = 0 → sem penalidade");
	assert.equal(withPenalty(20), Math.fround(85 * 0.1), "diferença 60 / 50 = 1 → 10%");
}

// 2. Sacudidas, crítica e o influenciador da Pokédex.
{
	assert.deepEqual(rollShakes(31.666, false, sequence(0, 0, 0, 0)), { numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false });
	assert.deepEqual(rollShakes(31.666, false, sequence(0, 44322, 0, 0)), { numberOfShakes: 3, isSucessfulCapture: false, isCriticalCapture: false });
	assert.deepEqual(rollShakes(31.666, false, sequence(44321, 0, 0, 0)), { numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false });
	// Crítica: só a primeira sacudida conta.
	assert.deepEqual(rollShakes(31.666, true, sequence(0)), { numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true });
	assert.deepEqual(rollShakes(31.666, true, sequence(65536)), { numberOfShakes: 1, isSucessfulCapture: false, isCriticalCapture: true }, "crítica sempre anima 1 sacudida");
	// Multiplicadores por espécies capturadas.
	assert.equal(criticalCaughtMultiplier(30), 0);
	assert.equal(criticalCaughtMultiplier(31), 0.5);
	assert.equal(criticalCaughtMultiplier(150), 0.5);
	assert.equal(criticalCaughtMultiplier(300), 1);
	assert.equal(criticalCaughtMultiplier(450), 1.5);
	assert.equal(criticalCaughtMultiplier(600), 2);
	assert.equal(criticalCaughtMultiplier(601), 2.5);
	// c = round(taxa × mult / 6).
	assert.equal(criticalCaptureThreshold(100, 10), 0);
	assert.equal(criticalCaptureThreshold(100, 100), 8);
	assert.equal(criticalCaptureThreshold(100, 700), 42);
	// calculateCapture: 1º sorteio é a crítica (nextInt(256)), depois as sacudidas.
	const input = { maxHealth: 30, currentHealth: 30, catchRate: 190, inBattle: false, level: 10, ballBonus: 1, guaranteed: false, alreadyOwnedForm: false };
	assert.deepEqual(calculateCapture({ ...input, caughtCount: 700 }, sequence(0, 0)), { numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true });
	assert.deepEqual(calculateCapture({ ...input, caughtCount: 700 }, sequence(255, 0, 0, 0, 0)), { numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false });
	// Forma já capturada: sucesso vira crítica de 1 sacudida; falha não muda.
	assert.deepEqual(calculateCapture({ ...input, caughtCount: 0, alreadyOwnedForm: true }, sequence(0)), { numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true });
	assert.deepEqual(influenceCapture({ numberOfShakes: 2, isSucessfulCapture: false, isCriticalCapture: false }, true), { numberOfShakes: 2, isSucessfulCapture: false, isCriticalCapture: false });
	// Garantida (Master Ball).
	assert.deepEqual(calculateCapture({ ...input, guaranteed: true }, sequence(99999)), { numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false });
	assert.deepEqual(calculateCapture({ ...input, guaranteed: true, alreadyOwnedForm: true }), { numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true });
}

// 3. Modificadores (regras puras de CatchRateModifiers.kt e PokeBalls.kt).
{
	assert.equal(levelBallMultiplier(50, 10), 4);
	assert.equal(levelBallMultiplier(25, 10), 3);
	assert.equal(levelBallMultiplier(11, 10), 2);
	assert.equal(levelBallMultiplier(10, 10), 1);
	assert.equal(loveBallMultiplier([{ species: "pikachu", gender: "m" }], { species: "pikachu", gender: "f" }), 8);
	assert.equal(loveBallMultiplier([{ species: "eevee", gender: "m" }], { species: "pikachu", gender: "f" }), 2.5);
	assert.equal(loveBallMultiplier([{ species: "pikachu", gender: "f" }], { species: "pikachu", gender: "f" }), 1);
	assert.equal(loveBallMultiplier([{ species: "pikachu", gender: "m" }], { species: "magnemite", gender: "" }), 1);
	assert.equal(moonBallMultiplier(6000, 0), 1, "de dia");
	assert.equal(moonBallMultiplier(18000, 0), 4);
	assert.equal(moonBallMultiplier(18000, 1), 2.5);
	assert.equal(moonBallMultiplier(18000, 6), 1.5);
	assert.equal(moonBallMultiplier(18000, 4), 1);
	assert.equal(duskBallMultiplier(0), 3.5);
	assert.equal(duskBallMultiplier(7), 3);
	assert.equal(duskBallMultiplier(8), 1);
	assert.equal(nestBallMultiplier(1), Math.fround(4));
	assert.equal(nestBallMultiplier(29), Math.fround(1.2));
	assert.equal(nestBallMultiplier(30), undefined);
	assert.equal(heavyBallMultiplier(999), undefined);
	assert.equal(heavyBallMultiplier(1500), 1.5);
	assert.equal(heavyBallMultiplier(2500), 2.5);
	assert.equal(heavyBallMultiplier(3000), 4);
	assert.equal(heavyBallMultiplier(2999.5), 1, "faixas fechadas do Kotlin (2000F..2999F)");
	assert.equal(timerBallMultiplier(1), Math.fround(1 + 1229 / 4096), "Timer: 1 + turno × 1229/4096 (o port antigo não somava 1)");
	assert.equal(timerBallMultiplier(10), 4);
	assert.equal(quickBallMultiplier(1), 5);
	assert.equal(quickBallMultiplier(2), 1);
	assert.equal(beastBallMultiplier(true), 5);
	assert.equal(beastBallMultiplier(false), 0.1, "Beast Ball: 0,1× fora de Ultra Beasts");
	assert.equal(repeatBallMultiplier(DexProgress.OWNED), 3.5);
	assert.equal(repeatBallMultiplier(DexProgress.SEEN), 1);

	// Registro: 32 bolas comuns do Cobblemon + 16 ancient + strange_ball do port.
	const balls = getAllPokeBalls();
	assert.equal(balls.filter(b => b.ancient).length, 16);
	assert.equal(balls.length, 49);
	assert.equal(pokeBallName("cobblemon:luxury_ball"), "luxury_ball");
	assert.equal(pokeBallName("luxuryball"), "luxury_ball");
	assert.equal(pokeBallName("cobblemon:poke_ball_dummy"), "poke_ball");
	assert.equal(getPokeBall("cobblemon:ancient_jet_ball")!.throwPower, 2.5);
	assert.equal(projectilePower(getPokeBall("ancient_jet_ball")!), 3);
	assert.equal(projectilePower(getPokeBall("ancient_gigaton_ball")!), 0.9);
	assert.equal(projectilePower(getPokeBall("poke_ball")!), 1.5);
	assert.equal(getPokeBall("dive_ball")!.waterDragValue, 0.99);
	assert.ok(getPokeBall("master_ball")!.catchRateModifier.isGuaranteed());
	assert.ok(getPokeBall("ancient_origin_ball")!.catchRateModifier.isGuaranteed());

	// Modificadores com Pokémon reais (form-aware).
	const bonus = (ball: string, pokemon: PokemonData) => {
		const modifier = getPokeBall(ball)!.catchRateModifier;
		return modifier.isValid(thrower, pokemon) ? modifier.value(thrower, pokemon) : 1;
	};
	assert.equal(bonus("great_ball", make("pikachu")), 1.5);
	assert.equal(bonus("ancient_wing_ball", make("pikachu")), 1.5);
	assert.equal(bonus("ancient_feather_ball", make("pikachu")), 1);
	assert.equal(bonus("net_ball", make("squirtle")), 3);
	assert.equal(bonus("net_ball", make("caterpie")), 3);
	assert.equal(bonus("net_ball", make("bulbasaur")), 1);
	assert.equal(bonus("fast_ball", make("jolteon")), 4);
	assert.equal(bonus("fast_ball", make("snorlax")), 1);
	assert.equal(bonus("heavy_ball", make("snorlax")), 4);
	assert.equal(bonus("heavy_ball", make("pikachu")), 1);
	assert.equal(bonus("beast_ball", make("pikachu")), 0.1);
	assert.equal(bonus("beast_ball", make("poipole")), 5);
	assert.equal(bonus("nest_ball", make("pikachu", 11)), Math.fround(3));
	const sleeping = make("pikachu");
	sleeping.status = "slp" as PokemonData["status"];
	assert.equal(bonus("dream_ball", sleeping), 4);
	assert.equal(bonus("dream_ball", make("pikachu")), 1);
	// Fora de batalha: Level/Love/Timer/Quick valem 1.
	for (const ball of ["level_ball", "love_ball", "timer_ball", "quick_ball"]) assert.equal(bonus(ball, make("pikachu")), 1, ball);
	// Catch rate da forma: Raichu de Alola tem o próprio.
	const alolan = make("raichu", 20, { aspects: ["alolan"] });
	const formRate = getSpeciesData("raichu")!.forms!.find(f => f.name === "Alola")!.catchRate ?? getSpeciesData("raichu")!.catchRate;
	assert.equal(alolan.getCatchRate(), formRate);
}

// 4. Linha do tempo das sacudidas (EmptyPokeBallEntity.beginCapture: 1 s + 1,25 s).
{
	const kinds = (steps: ReturnType<typeof buildCaptureTimeline>) => steps.map(s => `${s.kind}@${s.tick}`);
	assert.deepEqual(kinds(buildCaptureTimeline({ numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false }, false)),
		["bounce@0", "shake@20", "shake@45", "shake@70", "success@95"], "4 sacudidas animam 3");
	assert.deepEqual(kinds(buildCaptureTimeline({ numberOfShakes: 2, isSucessfulCapture: false, isCriticalCapture: false }, false)),
		["bounce@0", "shake@20", "shake@45", "break_free@70"]);
	assert.deepEqual(kinds(buildCaptureTimeline({ numberOfShakes: 0, isSucessfulCapture: false, isCriticalCapture: false }, false)),
		["bounce@0", "break_free@20"]);
	assert.deepEqual(kinds(buildCaptureTimeline({ numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true }, false)),
		["critical@0", "shake@45", "success@70"]);
	const ancient = buildCaptureTimeline({ numberOfShakes: 3, isSucessfulCapture: false, isCriticalCapture: false }, true);
	assert.deepEqual(kinds(ancient), ["bounce@0", "shake@20", "break_free@45"], "ancient anima um pulo só");
	assert.deepEqual(ancient[1].animations, ["animation.ancient_poke_ball.midhop1", "animation.ancient_poke_ball.midhop2"]);
	assert.deepEqual(buildCaptureTimeline({ numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false }, true)[1].animations,
		["animation.ancient_poke_ball.smallhop1", "animation.ancient_poke_ball.smallhop2"]);
	assert.equal(buildCaptureTimeline({ numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false }, false)[1].animations.length, 6, "bob1..bob6");
}

// 5. Registros da Pokédex (FormDexRecord/SpeciesDexRecord) e serialização.
{
	const dex = new PokedexRecords();
	assert.ok(dex.encounter({ species: "pikachu", form: "Normal", aspects: ["male"], gender: "m", shiny: false, level: 5 }));
	assert.ok(!dex.encounter({ species: "pikachu", form: "Normal", aspects: ["male"], gender: "m", shiny: false, level: 5 }), "sem novidade");
	assert.equal(dex.getKnowledgeForSpecies("pikachu"), DexProgress.SEEN);
	assert.equal(dex.getFormRecord("pikachu", "normal")!.highestLevel, -1, "visto não guarda nível");
	assert.ok(dex.encounter({ species: "pikachu", form: "Normal", aspects: ["female"], gender: "f", shiny: false, level: 5 }), "gênero novo");
	assert.ok(dex.obtain({ species: "pikachu", form: "Alola-Bias", aspects: ["region-bias-alola", "shiny"], gender: "f", shiny: true, level: 12 }));
	assert.equal(dex.getKnowledgeForSpecies("pikachu"), DexProgress.OWNED);
	assert.equal(dex.getFormKnowledge("pikachu", "Normal"), DexProgress.SEEN);
	assert.equal(dex.getFormKnowledge("pikachu", "alola-bias"), DexProgress.OWNED);
	assert.ok(!dex.encounter({ species: "pikachu", form: "Alola-Bias", aspects: ["region-bias-alola", "shiny"], gender: "f", shiny: true, level: 50 }), "visto não rebaixa");
	assert.ok(dex.obtain({ species: "pikachu", form: "Alola-Bias", aspects: ["region-bias-alola", "shiny"], gender: "f", shiny: true, level: 30 }), "nível maior");
	assert.equal(dex.getSpeciesRecord("pikachu")!.highestLevel, 30);
	dex.encounter({ species: "bulbasaur", form: "Normal", aspects: [], gender: "m" });
	dex.obtain({ species: "mr_mime:odd", form: "Galar;x", aspects: ["a,b", "c%d"], gender: "" });
	assert.equal(dex.getSeenCount(), 3);
	assert.equal(dex.getCaughtCount(), 2);

	const text = dex.serialize();
	const copy = PokedexRecords.parse(text);
	assert.equal(copy.serialize(), text, "ida e volta");
	assert.deepEqual([...copy.getSpeciesRecord("mr_mime:odd")!.aspects].sort(), ["a,b", "c%d"], "separadores escapados");
	assert.equal(copy.getFormKnowledge("mr_mime:odd", "galar;x"), DexProgress.OWNED);
	assert.equal(copy.getFormRecord("pikachu", "normal")!.genders, 3);
	assert.equal(copy.getFormRecord("pikachu", "alola-bias")!.shinyStates, 2);
	assert.equal(PokedexRecords.parse("lixo").getSeenCount(), 0);
	assert.ok(copy.deleteForm("pikachu", "Normal"));
	assert.equal(copy.getKnowledgeForSpecies("pikachu"), DexProgress.OWNED);
	copy.deleteForm("pikachu", "Alola-Bias");
	assert.equal(copy.getSpeciesRecord("pikachu"), undefined, "sem formas a espécie some");
}

// 6. Pedaços < 32 KB e ida e volta pelas dynamic properties.
{
	assert.deepEqual(splitIntoChunks("abcdef", 4), ["abcd", "ef"]);
	assert.deepEqual(splitIntoChunks("", 4), [""]);
	assert.deepEqual(splitIntoChunks("ééé", 4), ["éé", "é"], "não parte caracteres de 2 bytes");
	assert.equal(splitIntoChunks("😀😀", 4).length, 2);

	class Holder implements DexPropertyHolder {
		props = new Map<string, unknown>();
		writes = 0;
		constructor(public id: string) { }
		getDynamicProperty(key: string) { return this.props.get(key); }
		setDynamicProperty(key: string, value?: string | number | boolean) {
			this.writes++;
			if (value === undefined) this.props.delete(key); else this.props.set(key, value);
		}
	}
	const player = new Holder("p1");
	assert.equal(getSpeciesKnowledge(player, "pikachu"), DexProgress.UNREGISTERED);
	assert.ok(markSeen(player, "pikachu"));
	assert.ok(!markSeen(player, "pikachu"), "sem mudança não grava");
	assert.ok(hasSeen(player, "pikachu"));
	assert.ok(!hasCaught(player, "pikachu"));
	assert.ok(markCaught(player, make("raichu", 30, { aspects: ["alolan"] })));
	assert.ok(hasCaught(player, "raichu"));
	assert.ok(hasCaught(player, "raichu", "Alola"));
	assert.ok(!hasCaught(player, "raichu", "Normal"));
	assert.equal(getCaughtCount(player), 1);
	assert.equal(player.getDynamicProperty(DEX_PROPERTY_COUNT), 1);

	// Muitas espécies com aspectos longos: passa de 30 KB e divide.
	const species = getDex("national")!.getEntries().map(e => e.speciesId);
	batchPokedex(player, records => {
		for (const id of species) records.obtain({ species: id, form: "Normal", aspects: ["aspect-" + "x".repeat(60)], gender: "m", level: 50 });
	});
	const chunks = readPokedexChunks(player);
	assert.ok(chunks.length >= 2, `esperava 2+ pedaços, veio ${chunks.length}`);
	for (const chunk of chunks) assert.ok(byteLength(chunk) <= MAX_CHUNK_BYTES, "cada pedaço < 32 KB");
	assert.equal(player.getDynamicProperty(DEX_PROPERTY_COUNT), chunks.length);
	const serialized = getPokedex(player).serialize();
	forgetPokedex(player.id);
	assert.equal(getPokedex(player).serialize(), serialized, "recarrega igual das dynamic properties");
	assert.equal(getCaughtCount(player), species.length);
	// Gravar de novo sem mudança não escreve nada; encolher apaga os pedaços extras.
	const before = player.writes;
	batchPokedex(player, () => { });
	assert.equal(player.writes, before);
	batchPokedex(player, records => { for (const id of species) records.deleteSpecies(id); });
	assert.equal(player.getDynamicProperty(DEX_PROPERTY_COUNT), 1);
	assert.equal(player.getDynamicProperty(`${DEX_PROPERTY_PREFIX}1`), undefined);
	assert.equal(getCaughtCount(player), 0);
}

// 7. Pokédex regionais derivadas (mesmas contagens do Cobblemon para as espécies importadas) e entradas.
{
	const ids = getDexes().map(d => d.id);
	assert.deepEqual(ids, ["national", "kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "unknown", "galar", "hisui", "paldea"]);
	assert.equal(regionForNumber(25), "kanto");
	assert.equal(regionForNumber(808), "unknown");
	assert.equal(regionForNumber(1000), "paldea");
	assert.equal(formEntryId("pikachu", "Alola-Bias"), "pikachu-alolabias");
	const kanto = getDex("kanto")!.getEntries();
	assert.ok(kanto.every(e => (getSpeciesData(e.speciesId)!.nationalPokedexNumber) <= 151));
	assert.ok(getDex("alola")!.getEntries().some(e => e.id === "raichu-alola"), "forma regional vira entrada de Alola");
	const national = getNationalEntry("raichu")!;
	assert.deepEqual(national.getForms().map(f => f.displayForm), ["Normal", "Alola"], "nacional junta as formas");
	assert.ok(getNationalEntry("pikachu")!.getForms().some(f => f.displayForm === "Gmax"));
	// Conhecimento por entrada e contagens.
	const records = new PokedexRecords();
	records.obtain({ species: "raichu", form: "Alola", aspects: ["alolan"] });
	records.encounter({ species: "pikachu", form: "Normal", aspects: [] });
	assert.equal(getEntryKnowledge(records, getDex("alola")!.getEntries().find(e => e.id === "raichu-alola")!), DexProgress.OWNED);
	assert.equal(getEntryKnowledge(records, getDex("kanto")!.getEntries().find(e => e.id === "raichu")!), DexProgress.UNREGISTERED, "Raichu comum não foi visto");
	const kantoCounts = computeDexCounts(records, "kanto");
	assert.deepEqual([kantoCounts.seen, kantoCounts.caught], [2, 1], "contagem da Pokédex usa o conhecimento da espécie");
	assert.equal(computeDexCounts(records).caught, 1);
	// grant all
	const granted = new PokedexRecords();
	grantEntries(granted, getDex("kanto")!.getEntries(), 100);
	assert.equal(computeDexCounts(granted, "kanto").caught, kanto.length);
	assert.equal(granted.getFormRecord("pikachu", "Normal")!.shinyStates, 3);
	// Descrição e spawns.
	const pikachu = getSpeciesData("pikachu")!;
	assert.deepEqual(descriptionKeys("pikachu", { ...pikachu, pokedex: [] }, pikachu.forms!.find(f => f.name === "Alola-Bias")),
		["cobblemon.species.pikachu-alolabias.desc"]);
	assert.deepEqual(descriptionKeys("pikachu", { ...pikachu, pokedex: [] }, undefined), ["cobblemon.species.pikachu.desc"]);
	assert.ok(spawnSummary("pikachu").length > 0, "Pikachu aparece no mundo");
	// Dados exatos do importador substituem os derivados.
	setDexData(
		[{ id: "cobblemon:kanto", sortOrder: 1, entries: ["cobblemon:bulbasaur"] }, { id: "cobblemon:national", sortOrder: 0, subDexIds: ["cobblemon:kanto"], squash: true }],
		[{ id: "cobblemon:bulbasaur", speciesId: "cobblemon:bulbasaur", forms: [{ displayForm: "Normal", unlockForms: ["Normal"] }] }],
	);
	assert.equal(getDex("national")!.getEntries().length, 1);
	assert.equal(getDex("kanto")!.getEntries()[0].speciesId, "bulbasaur");
}

console.warn = originalWarn;
console.log("captura: ok");
