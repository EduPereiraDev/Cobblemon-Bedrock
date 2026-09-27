// Frente "pesca": fórmulas da boia (espera, fisgada, janela), sorteio Pokémon × item, tabela de loot,
// efeitos de isca no Pokémon gerado e no peso das entradas, filtro por tipo de vara e Poké Snack.
import assert from "node:assert/strict";
import { BEST_SPAWNER_CONFIG, SPAWNS, SpawnEntry } from "../generated/scripts/spawns";
import { ITEMS } from "../generated/scripts/items";
import { PokemonData } from "../scripts/Pokemon";
import { Dex } from "../scripts/showdown";
import { getSpeciesData } from "../scripts/speciesData";
import { entryAllowed, SpawnContext, worldClock } from "../scripts/spawning/SpawnConditions";
import { bucketNormalizingInfluence, chooseBucket } from "../scripts/spawning/SpawnSelector";
import { chooseFishingSpawn, createPokemonForAction } from "../scripts/spawning/Spawner";
import {
	alterBiteTime, applyBaitEffects, baitInfluence, baitWeight, effectsForItem, FISHED_ASPECT, getBaitById, isFishingBait, mergeEffects,
	pokemonSpawnChance, rarityTier, registerSpawnBait,
} from "../scripts/fishing/BaitEffects";
import { SPAWN_BAITS } from "../scripts/fishing/baitData";
import {
	bobbingVelocity, calculateMinMaxCountdown, castVelocity, durabilityLoss, isOpenOrWaterAround, lobVelocity, newFishingState, nextInt,
	pokemonCatchProbability, retrieveDamage, rollLootCategory, rollPokemonCatch, rollWaitCountdown, tickFishing, WATER_SURFACE,
} from "../scripts/fishing/FishingLogic";
import { BOBBER_BALLS, bobberBallIndex, FIRST_ANCIENT_BALL, getPokeRod, lineColorRGB, POKE_RODS } from "../scripts/fishing/PokeRods";
import { parseRodBait, rodBaitEffects } from "../scripts/fishing/RodItem";
import { bitesAfterSpawn, MAX_BITES, randomTicksBetweenSpawns, snackInfluences } from "../scripts/fishing/PokeSnack";

const originalWarn = console.warn;
console.warn = () => { };
worldClock.timeOfDay = () => 6000;
worldClock.moonPhase = () => 0;

/** RNG determinístico (mulberry32) para as simulações. */
function rng(seed: number): () => number {
	return () => {
		seed |= 0; seed = seed + 0x6D2B79F5 | 0;
		let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// ---------------------------------------------------------------------------------------------
// 1. Poké Rods

{
	assert.equal(Object.keys(POKE_RODS).length, 48, "48 Poké Rods no 1.8.2");
	assert.equal(BOBBER_BALLS.length, 48);
	assert.equal(new Set(BOBBER_BALLS).size, 48, "bolas das boias sem repetição");
	assert.ok(BOBBER_BALLS.slice(0, FIRST_ANCIENT_BALL).every(b => !b.startsWith("ancient_")));
	assert.ok(BOBBER_BALLS.slice(FIRST_ANCIENT_BALL).every(b => b.startsWith("ancient_")));
	for (const rod of Object.values(POKE_RODS)) {
		const item = ITEMS[rod.id.replace("cobblemon:", "")];
		assert.ok(item, `item da vara ${rod.id} gerado pelo importador`);
		assert.equal(item.category, "poke_rod");
		assert.equal(item.ball, rod.pokeBallId, `bola de ${rod.id}`);
		assert.equal(String(item.lineColor).toLowerCase(), rod.lineColor.toLowerCase(), `cor da linha de ${rod.id}`);
	}
	const rodItems = Object.entries(ITEMS).filter(([, d]) => d.category === "poke_rod").map(([id]) => `cobblemon:${id}`);
	assert.deepEqual(rodItems.sort(), Object.keys(POKE_RODS).sort(), "todas as varas do importador são conhecidas");
	assert.equal(bobberBallIndex("cobblemon:poke_rod"), 0);
	assert.equal(BOBBER_BALLS[bobberBallIndex("cobblemon:ancient_origin_rod")], "ancient_origin_ball");
	assert.equal(getPokeRod("master_rod")?.lineColor, "#D1CDD1");
	assert.deepEqual(lineColorRGB("#FF0080"), { red: 1, green: 0, blue: 128 / 255 });
}

// ---------------------------------------------------------------------------------------------
// 2. Registro de iscas

{
	assert.equal(Object.keys(SPAWN_BAITS).length, 79, "79 arquivos de spawn_bait_effects");
	for (const id of ["cobblemon:oran_berry", "minecraft:golden_apple", "cobblemon:poke_bait", "cobblemon:sweet_heart"])
		assert.ok(isFishingBait(id), `${id} é isca`);
	assert.ok(!isFishingBait("cobblemon:love_sweet"), "love_sweet não é isca de pesca no 1.8.2 (só tempero)");
	assert.ok(!isFishingBait("minecraft:dirt"));
	assert.deepEqual(effectsForItem("cobblemon:poke_bait"), [], "Poké Bait sem tempero não tem efeito");
	assert.deepEqual(effectsForItem("cobblemon:oran_berry"), [{ type: "bite_time", chance: 1, value: 0.33 }]);
	// Temperos registrados em tempo de execução (componente BAIT_EFFECTS da Poké Bait).
	registerSpawnBait("seasonings:test", [{ type: "level_raise", chance: 1, value: 3 }]);
	assert.deepEqual(getBaitById("seasonings:test"), [{ type: "level_raise", chance: 1, value: 3 }]);
	assert.deepEqual(effectsForItem("cobblemon:poke_bait", ["seasonings:test"]).map(e => e.type), ["level_raise"]);
	assert.ok(!isFishingBait("seasonings:test"), "tempero sem item não vira isca por item");
	// Isca guardada na vara.
	assert.equal(parseRodBait("lixo"), undefined);
	assert.deepEqual(parseRodBait(JSON.stringify({ item: "cobblemon:oran_berry", count: 3 })), { item: "cobblemon:oran_berry", count: 3, max: 64, components: undefined });
	assert.deepEqual(rodBaitEffects({ item: "minecraft:golden_carrot", count: 1, max: 64 }), [{ type: "rarity_bucket", chance: 1, value: 1 }]);

	// mergeEffects: soma por tipo+subcategoria, chance limitada a 1, valor arredondado para cima.
	const merged = mergeEffects([
		{ type: "iv", sub: "hp", chance: 0.6, value: 2.2 }, { type: "iv", sub: "hp", chance: 0.6, value: 1 }, { type: "iv", sub: "atk", chance: 0.1, value: 1 },
	]);
	assert.deepEqual(merged, [{ type: "iv", sub: "hp", chance: 1, value: 4 }, { type: "iv", sub: "atk", chance: 0.1, value: 1 }]);
	assert.equal(rarityTier(effectsForItem("minecraft:enchanted_golden_apple")), 10);
	assert.equal(rarityTier(effectsForItem("minecraft:golden_apple")), 1);
}

// ---------------------------------------------------------------------------------------------
// 3. Fórmulas de tempo (espera, isca bite_time, janela de reação)

{
	// calculateMinMaxCountdown com os pesos de fishingBuckets.
	assert.deepEqual(calculateMinMaxCountdown(BEST_SPAWNER_CONFIG.fishingBuckets.common), [19, 36]);
	assert.deepEqual(calculateMinMaxCountdown(BEST_SPAWNER_CONFIG.fishingBuckets.uncommon), [15, 22]);
	assert.deepEqual(calculateMinMaxCountdown(BEST_SPAWNER_CONFIG.fishingBuckets["ultra-rare"]), [15, 20]);
	assert.deepEqual(calculateMinMaxCountdown(50), [17, 30], "sem ação planejada usa peso 50");
	assert.deepEqual(calculateMinMaxCountdown(1000), [20, 40], "limites");

	// Espera: nextInt(100, 600); Oran (bite_time 0.33, chance 1) tira 33%.
	const oran = effectsForItem("cobblemon:oran_berry");
	assert.equal(alterBiteTime(300, oran, () => 0), 201);
	assert.equal(alterBiteTime(300, [], () => 0), 300);
	assert.equal(alterBiteTime(300, effectsForItem("minecraft:enchanted_golden_apple"), () => 0), 1, "bite_time 1.0 → 1 tick");
	assert.equal(alterBiteTime(300, [{ type: "bite_time", chance: 0.5, value: 0.5 }], () => 0.9), 300, "falhou na chance");
	let sum = 0, min = Infinity, max = -Infinity;
	const r = rng(1);
	for (let i = 0; i < 20000; i++) {
		const w = rollWaitCountdown([], r);
		sum += w; min = Math.min(min, w); max = Math.max(max, w);
	}
	assert.equal(min, 100); assert.equal(max, 600);
	near(sum / 20000, 350, 5, "espera média sem isca");

	// Simulação do laço completo até a fisgada: Lure diminui a espera (waitCountdown -= 1 + lure).
	const ticksUntilBite = (lure: number, effects = [] as ReturnType<typeof effectsForItem>, seed = 7) => {
		const random = rng(seed);
		let total = 0;
		for (let run = 0; run < 400; run++) {
			const state = newFishingState();
			for (let t = 1; t < 5000; t++) {
				const events = tickFishing(state, { raining: false, canSeeSky: true, lureLevel: lure, effects, random, planSpawn: () => BEST_SPAWNER_CONFIG.fishingBuckets.common });
				if (events.some(e => e.type === "bite")) { total += t; break; }
			}
		}
		return total / 400;
	};
	const base = ticksUntilBite(0), lure3 = ticksUntilBite(3), oranBite = ticksUntilBite(0, oran);
	// Pouso (1) + espera (média 350) + viagem do peixe (nextInt(20, 80), média 50).
	near(base, 1 + 350 + 50, 15, "ticks até a fisgada sem Lure");
	near(lure3, 1 + 350 / 4 + 50, 12, "Lure III: espera ÷ 4");
	near(oranBite, 1 + 350 * 0.67 + 50, 15, "Oran Berry: espera × 0,67");

	// Estado: evento land só no primeiro tick; fisgada abre a janela; sem puxar, escapa.
	{
		const state = newFishingState();
		const random = rng(3);
		let plans = 0;
		const env = { raining: false, canSeeSky: true, lureLevel: 0, effects: [], random, planSpawn: () => { plans++; return 1.375; } };
		assert.deepEqual(tickFishing(state, env), [{ type: "land" }]);
		assert.ok(state.waitCountdown >= 100 && state.waitCountdown <= 600);
		let bite = false, escaped = false;
		for (let t = 0; t < 2000 && !escaped; t++) {
			const events = tickFishing(state, env);
			if (events.some(e => e.type === "land")) assert.fail("land só no primeiro pouso");
			if (events.some(e => e.type === "bite")) {
				bite = true;
				assert.ok(state.caughtFish);
				if (state.typeCaught === "pokemon") assert.ok(state.hookCountdown >= 15 && state.hookCountdown <= 20, "ultra-rare: janela 15–20");
				else assert.ok(state.hookCountdown >= 20 && state.hookCountdown <= 40, "item: janela 20–40");
			}
			if (events.some(e => e.type === "escape")) escaped = true;
		}
		assert.ok(bite && escaped, "fisgou e escapou");
		assert.ok(!state.caughtFish && state.waitCountdown === 0);
		assert.equal(plans, state.typeCaught === "pokemon" ? 1 : 0, "planeja o spawn só em fisgada de Pokémon");
	}
	// Sem céu: metade das vezes o tick não conta (i − 1).
	{
		const state = newFishingState();
		state.isCast = true; state.waitCountdown = 1000;
		const random = rng(11);
		for (let t = 0; t < 1000; t++) tickFishing(state, { raining: false, canSeeSky: false, lureLevel: 0, effects: [], random, planSpawn: () => 50 });
		near(1000 - state.waitCountdown, 500, 50, "sem céu a espera anda à metade");
	}
}

// ---------------------------------------------------------------------------------------------
// 4. Pokémon × item e tabela de loot

{
	assert.equal(pokemonSpawnChance([]), 85);
	near(pokemonCatchProbability(85), 85 / 101, 1e-12, "nextInt(0, 100) < 85");
	const random = rng(5);
	let pokemon = 0;
	for (let i = 0; i < 50000; i++) if (rollPokemonCatch([], random)) pokemon++;
	near(pokemon / 50000, 85 / 101, 0.01, "chance de Pokémon sem isca");
	// Isca pokemon_chance (chance 0,5 → 50 em 100).
	const half = [{ type: "pokemon_chance", chance: 0.5 }];
	assert.equal(pokemonSpawnChance(half), 50);
	pokemon = 0;
	for (let i = 0; i < 50000; i++) if (rollPokemonCatch(half, random)) pokemon++;
	near(pokemon / 50000, 50 / 101, 0.01, "chance de Pokémon com pokemon_chance 0,5");

	// Loot: sem águas abertas só lixo; com águas abertas 66/17/17.
	for (let i = 0; i < 2000; i++) assert.equal(rollLootCategory(false, random), "junk");
	const counts: Record<string, number> = { junk: 0, cobblemon_treasure: 0, treasure: 0 };
	for (let i = 0; i < 60000; i++) counts[rollLootCategory(true, random)]++;
	near(counts.junk / 60000, 0.66, 0.01, "lixo");
	near(counts.cobblemon_treasure / 60000, 0.17, 0.01, "tesouro do Cobblemon");
	near(counts.treasure / 60000, 0.17, 0.01, "tesouro vanilla");

	// Águas abertas: água embaixo, ar em cima; misturado ou ar embaixo da água falha.
	assert.ok(isOpenOrWaterAround(dy => dy <= 0 ? "inside_water" : "above_water"));
	assert.ok(isOpenOrWaterAround(() => "inside_water"));
	assert.ok(!isOpenOrWaterAround(() => "above_water"), "ar desde a camada de baixo não é águas abertas");
	assert.ok(!isOpenOrWaterAround(dy => dy === 1 ? "invalid" : "inside_water"));
	assert.ok(!isOpenOrWaterAround(dy => dy === 0 ? "above_water" : "inside_water"), "água sobre ar");

	// Dano na vara (retrieve).
	assert.equal(retrieveDamage({ caught: true }), 1);
	assert.equal(retrieveDamage({ hookedEntity: "entity" }), 5);
	assert.equal(retrieveDamage({ hookedEntity: "item" }), 3);
	assert.equal(retrieveDamage({ caught: true, onGround: true }), 2);
	assert.equal(retrieveDamage({}), 0);
	assert.equal(durabilityLoss(5, 0, random), 5);
	let loss = 0;
	for (let i = 0; i < 10000; i++) loss += durabilityLoss(1, 3, random);
	near(loss / 10000, 0.25, 0.02, "Unbreaking III: 1/4 do dano");
}

// ---------------------------------------------------------------------------------------------
// 5. Física

{
	// Arremesso olhando para o sul (yaw 0), na horizontal: 0,6/|v| + triangle(0,5) ≈ 1,1 bloco/tick em +Z.
	const v = castVelocity(0, 0, () => 0.5);
	near(v.x, 0, 1e-9, "x"); near(v.y, 0, 1e-9, "y"); near(v.z, 1.1, 0.01, "z");
	const up = castVelocity(-45, 90, () => 0.5);
	assert.ok(up.y > 0.3 && up.x < -0.3, "olhando para cima e para o oeste");
	// Boiando: converge para a superfície da água-fonte.
	let pos = { x: 0, y: 64.5, z: 0 }, vel = { x: 0, y: 0, z: 0 };
	const random = rng(9);
	for (let t = 0; t < 400; t++) {
		vel = bobbingVelocity(pos, vel, 64, WATER_SURFACE, false, random);
		pos = { x: pos.x + vel.x, y: pos.y + vel.y, z: pos.z + vel.z };
		vel = { x: vel.x * 0.92, y: vel.y * 0.92, z: vel.z * 0.92 };
	}
	near(pos.y, 64 + WATER_SURFACE, 0.15, "boia na superfície");
	// Pokémon puxado: vai na direção do jogador e para cima.
	const lob = lobVelocity({ x: 0, y: 64, z: 0 }, 0, { x: 0, y: 63, z: 20 });
	assert.ok(lob.z < 0 && lob.y > 0.3 && Math.abs(lob.x) < 1e-9, "arco em direção ao jogador");
	assert.equal(nextInt(3, 3), 3);
}

// ---------------------------------------------------------------------------------------------
// 6. Efeitos de isca no Pokémon gerado

{
	const fresh = (species = "psyduck", level = 20) => {
		const p = PokemonData.generateNewWildPokemon(species, { level, shiny: false });
		p.nature = "Hardy";
		p.ivs = { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 };
		p.friendship = 70;
		return p;
	};
	const always = () => 0;

	let p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:sweet_heart"), always);
	assert.equal(p.friendship, 105, "Sweet Heart: amizade +35");

	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:leppa_berry"), always);
	assert.equal(p.level, 25, "Leppa: nível +5");
	p = fresh("psyduck", 98);
	applyBaitEffects(p, effectsForItem("cobblemon:leppa_berry"), always);
	assert.equal(p.level, 100, "nível limitado a maxPokemonLevel");

	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:lansat_berry"), always);
	assert.equal(p.ivs.hp, 15, "Lansat: IV de HP +5");
	p = fresh(); p.ivs.hp = 29;
	applyBaitEffects(p, effectsForItem("cobblemon:lansat_berry"), always);
	assert.equal(p.ivs.hp, 31, "IV limitado a 31");

	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:belue_berry"), always);
	assert.equal(Dex.natures.get(p.nature).plus, "def", `Belue: natureza que sobe Defesa (${p.nature})`);

	p = fresh(); p.gender = "m"; p.aspects = p.aspects.filter(a => a !== "female" && a !== "male").concat("male");
	applyBaitEffects(p, effectsForItem("cobblemon:kee_berry"), always);
	assert.equal(p.gender, "f", "Kee: fêmea");
	assert.ok(p.aspects.includes("female") && !p.aspects.includes("male"));
	const genderless = fresh("staryu");
	applyBaitEffects(genderless, effectsForItem("cobblemon:kee_berry"), always);
	assert.equal(genderless.gender, "", "sem gênero não muda");

	p = fresh();
	applyBaitEffects(p, [{ type: "shiny_reroll", chance: 1, value: 1e9 }], always);
	assert.ok(p.shiny && p.aspects.includes("shiny"), "shiny_reroll com valor enorme sempre dá shiny");
	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:starf_berry"), () => 0.99);
	assert.ok(!p.shiny, "Starf: 5/8193 de chance, com random alto não sai");

	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:enigma_berry"), always);
	assert.ok(p.hasHiddenAbility(), `Enigma: habilidade oculta (${p.ability})`);

	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:hopo_berry"), always);
	assert.ok(p.aspects.includes("alpha") && p.marks.includes("cobblemon:mark_alpha"), "Hopo: Alfa");

	p = fresh();
	applyBaitEffects(p, effectsForItem("cobblemon:custap_berry"), always);
	assert.ok(p.aspects.includes("drops_reroll"));

	// Chance: efeito que não passa (Kee 25%, random 0,5) não faz nada.
	p = fresh(); p.gender = "m"; p.aspects = p.aspects.filter(a => a !== "female" && a !== "male").concat("male");
	assert.deepEqual(applyBaitEffects(p, effectsForItem("cobblemon:kee_berry"), () => 0.5), []);
	assert.equal(p.gender, "m");

	// Pelo pipeline do spawner: createPokemonForAction + influência da pesca (aspect fished + isca).
	const entry = SPAWNS.find(e => e.positionType === "fishing" && e.species === "magikarp" && !e.herd)!;
	assert.ok(entry, "entrada de pesca do Magikarp");
	const action = {
		entry, ctx: { location: { x: 0, y: 64, z: 0 }, influences: [] } as unknown as SpawnContext, bucket: entry.bucket,
		species: entry.species, aspects: [...entry.aspects], alpha: false, levelRange: [10, 10] as [number, number],
	};
	const data = createPokemonForAction(action, [baitInfluence(effectsForItem("cobblemon:sweet_heart"), { fished: true, random: always })]);
	assert.ok(data.aspects.includes(FISHED_ASPECT), "aspect fished (Lure Ball)");
	assert.equal(data.level, 10);
	assert.equal(data.friendship, data.getBaseFriendship() + 35, "isca aplicada ao Pokémon gerado");
}

// ---------------------------------------------------------------------------------------------
// 7. Peso das entradas (EV, tipo, grupo de ovo)

{
	const entry = (species: string) => ({ species, aspects: [] as string[] });
	const passho = effectsForItem("cobblemon:passho_berry"); // tipo Água × 10
	assert.equal(baitWeight(entry("magikarp"), 5, passho), 50);
	assert.equal(baitWeight(entry("charmander"), 5, passho), 5);
	const tamato = effectsForItem("cobblemon:tamato_berry"); // EV de Velocidade
	assert.ok((getSpeciesData("magikarp")!.evYield.speed ?? 0) > 0);
	assert.equal(baitWeight(entry("magikarp"), 5, tamato), 5, "Magikarp rende EV de Velocidade");
	assert.equal(baitWeight(entry("psyduck"), 5, tamato), 0, "Psyduck não rende EV de Velocidade: fora");
	const aspear = effectsForItem("cobblemon:aspear_berry"); // water_1 / water_2 × 10
	assert.equal(baitWeight(entry("magikarp"), 3, aspear), 30, "Magikarp é water_2");
	assert.equal(baitWeight(entry("charmander"), 3, aspear), 3);
	assert.equal(baitWeight({ species: "magikarp", aspects: [], herd: {} as never }, 3, passho), 3, "herds não são afetados");
	assert.equal(baitWeight(entry("magikarp"), 3, effectsForItem("cobblemon:oran_berry")), 3, "isca sem efeito de peso");
}

// ---------------------------------------------------------------------------------------------
// 8. Tipo de vara, isca e Lure nas entradas de pesca

{
	const overworld = { id: "minecraft:overworld", containsBlock: () => false } as unknown as SpawnContext["dimension"];
	const wooper = SPAWNS.find(e => e.id === "wooper-true-15")!;
	assert.ok(wooper?.condition.rodType === "cobblemon:love_rod", "Wooper de coração exige a Love Rod");
	const ctx: SpawnContext = {
		dimension: overworld, location: { x: 0.5, y: 63, z: 0.5 }, blockY: 62, positionType: "fishing", biome: wooper.condition.biomes![0],
		baseBlock: "minecraft:water", skyLight: 4, light: 4, canSeeSky: true, isRaining: false, isThundering: false, fluid: "water",
	};
	assert.ok(!entryAllowed(wooper, { ...ctx, fishing: { rodType: "cobblemon:poke_rod" } }));
	assert.ok(entryAllowed(wooper, { ...ctx, fishing: { rodType: "cobblemon:love_rod" } }));
	const hearts = (rodType: string) => {
		let n = 0;
		for (let i = 0; i < 3000; i++) {
			const action = chooseFishingSpawn(ctx, { rodType, lureLevel: 0 });
			if (action?.entry.condition.rodType) {
				assert.equal(action.entry.condition.rodType, rodType, "só entradas da vara usada");
				n++;
			}
		}
		return n;
	};
	assert.equal(hearts("cobblemon:poke_rod"), 0, "Poké Rod não pesca entradas de outra vara");
	assert.ok(hearts("cobblemon:love_rod") > 0, "Love Rod pesca o Wooper de coração");

	// Isca exigida pela entrada (bait) e Lure mínimo.
	const baitEntry = SPAWNS.find(e => e.id === "wooper-true-17")!;
	assert.equal(baitEntry?.condition.bait, "cobblemon:love_sweet");
	assert.ok(!entryAllowed(baitEntry, { ...ctx, fishing: { bait: "cobblemon:oran_berry" } }), "sem a isca certa");
	assert.ok(entryAllowed(baitEntry, { ...ctx, fishing: { bait: "cobblemon:love_sweet" } }), "com a isca certa");
	const lureEntry = SPAWNS.find(e => e.positionType === "fishing" && e.condition.minLureLevel === 2)!;
	const lureCtx = { ...ctx, biome: lureEntry.condition.biomes?.[0] ?? ctx.biome, skyLight: 15, light: 15, canSeeSky: lureEntry.condition.canSeeSky ?? true };
	assert.ok(!entryAllowed(lureEntry, { ...lureCtx, fishing: { lureLevel: 1 } }), "Lure I não basta para minLureLevel 2");

	// Tier da normalização: rarity_bucket da isca + Luck of the Sea (a boia passa luckOfTheSeaLevel = −Lure).
	const flat = [bucketNormalizingInfluence(rarityTier(effectsForItem("minecraft:enchanted_golden_apple")) + 3)];
	const random = rng(21);
	const rare = { base: 0, flat: 0 };
	for (let i = 0; i < 40000; i++) {
		if (chooseBucket(BEST_SPAWNER_CONFIG.fishingBuckets, [], undefined, random) === "ultra-rare") rare.base++;
		if (chooseBucket(BEST_SPAWNER_CONFIG.fishingBuckets, flat, undefined, random) === "ultra-rare") rare.flat++;
	}
	assert.ok(rare.flat > rare.base * 3, `isca de raridade achata os buckets (${rare.base} → ${rare.flat})`);
}

// ---------------------------------------------------------------------------------------------
// 9. Poké Snack

{
	assert.deepEqual(bitesAfterSpawn(1), { bites: 1, consumed: false });
	assert.deepEqual(bitesAfterSpawn(MAX_BITES), { bites: 8, consumed: false });
	assert.deepEqual(bitesAfterSpawn(MAX_BITES + 1), { bites: 9, consumed: true }, "passou de 8 mordidas: some");
	assert.equal(randomTicksBetweenSpawns([]), 2);
	near(randomTicksBetweenSpawns(effectsForItem("cobblemon:oran_berry"), () => 0), 2 * 0.67, 1e-9, "Oran: 2 × 0,67");
	assert.equal(randomTicksBetweenSpawns(effectsForItem("minecraft:enchanted_golden_apple"), () => 0), 1, "mínimo 1");
	const influences = snackInfluences(effectsForItem("minecraft:golden_carrot"));
	assert.equal(influences.length, 3, "normalização (rarity_bucket) + isca + filtro");
	const filter = influences[2];
	const herd = SPAWNS.find(e => e.type === "pokemon-herd")!;
	const single = SPAWNS.find(e => e.type === "pokemon")!;
	assert.equal(filter.affectSpawnable!(herd, {} as SpawnContext), false, "Poké Snack não atrai herds");
	assert.equal(filter.affectSpawnable!(single, {} as SpawnContext), true);
	const data = PokemonData.generateNewWildPokemon("magikarp", { level: 5 });
	influences[1].affectPokemon!({} as never, data);
	assert.ok(data.aspects.includes("poke_snack_crumbed"));
	assert.equal(snackInfluences([]).length, 2, "sem rarity_bucket não normaliza");
}

console.warn = originalWarn;
console.log("pesca: ok");
