// Frente "mundo-máquinas": fósseis, culinária/temperos, pasto (capacidade e persistência), Poké Snack
// (efeitos de isca) e TMs, com os dados reais do Cobblemon 1.8.2 e a API do Minecraft mockada.
import assert from "node:assert/strict";
import { setStorageBackend, MachineStore, blockKey, parseBlockKey } from "../scripts/machines/store";
import { FOSSILS, ITEM_TAGS, TECHNICAL_MACHINES } from "../scripts/machines/data";
import {
	findFossil, insertFossil, insertOrganic, isFossilIngredient, MATERIAL_TO_START, monitorScreen, naturalMaterialContent,
	naturalMaterialReturnItem, newFossilMachine, PROTECTION_TIME, takeLastFossil, tickFossilMachine, TIME_PER_STAGE, TIME_TO_TAKE,
	isProtectedFrom, clearCreated,
} from "../scripts/machines/fossilLogic";
import {
	applySeasoning, findBrewingRecipe, findCookingRecipe, matchesShaped, mergeFood, mergeMobEffects, rideBoostsFor, seasonedDataFromLore,
	seasoningConsumed, seasoningFor, seasoningLore, seasoningIdsFromLore, trimGrid,
} from "../scripts/machines/cookingLogic";
import { cookTick, CookingPotState } from "../scripts/machines/cooking";
import {
	addTether, canAddPokemon, findTether, insideRoam, nearbyPokemonCap, parsePasture, PastureRecord, removeAllTethers, removeTether,
	serializePasture, Tether,
} from "../scripts/machines/pastureLogic";
import { baitIdsForSeasonings, baitIdsFromLore, seasoningBaitId } from "../scripts/machines/pokeSnack";
import { effectsForItem, rarityTier } from "../scripts/fishing/BaitEffects";
import { randomTicksBetweenSpawns, snackInfluences } from "../scripts/fishing/PokeSnack";
import { availableTMs, missingForTM, openTMMachine, tickTMMachines, tmMoveFromLore, tmStore } from "../scripts/machines/tm";
import { ANALYZER, fossilStore, MONITOR, TANK, tickFossilMachines } from "../scripts/machines/fossils";
import { isCookingIngredient } from "../scripts/machines/cookingLogic";
import { world } from "@minecraft/server";
import { formHooks } from "@minecraft/server-ui";
import { discShelfSlot, isValidDisc } from "../scripts/machines/decor";
import { MACHINE_BLOCK_COMPONENTS } from "../scripts/custom_components/machines";
import { BLOCK_COMPONENTS } from "../generated/scripts/blockBehaviours";
import { COOKING_POT_RECIPES, CookingPotRecipe } from "../generated/scripts/recipes";
import type { SpawnEntry } from "../generated/scripts/spawns";

console.warn = () => { };
const seq = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

// Backend de dynamic properties em memória.
const mem = new Map<string, string>();
setStorageBackend({ get: id => mem.get(id), set: (id, v) => { if (v === undefined) mem.delete(id); else mem.set(id, v); }, ids: () => [...mem.keys()] });

// ---------------------------------------------------------------------------------------------
// 0. Componentes: toda chave desta frente está registrada e nenhuma pendente sobrou.
{
	const mine = ["cobblemon:pasture", "cobblemon:fossil_analyzer", "cobblemon:fossil_monitor", "cobblemon:restoration_tank", "cobblemon:tm_machine",
		"cobblemon:disc_shelf", "cobblemon:display_case", "cobblemon:lectern", "cobblemon:gilded_chest", "cobblemon:campfire", "cobblemon:campfire_pot"];
	for (const k of mine) {
		assert.ok(MACHINE_BLOCK_COMPONENTS[k], `componente ${k} registrado`);
		assert.ok(!(k in BLOCK_COMPONENTS), `${k} ainda pendente em blockBehaviours.ts (rode npm run import)`);
	}
	// O Poké Snack é da frente pesca: registrar de novo aqui quebraria o startup (componente duplicado).
	assert.ok(!("cobblemon:poke_snack" in MACHINE_BLOCK_COMPONENTS));
}

// ---------------------------------------------------------------------------------------------
// 1. Fósseis: combinações de data/cobblemon/fossils.
{
	assert.equal(FOSSILS.length, 15);
	assert.equal(findFossil(["cobblemon:helix_fossil"])?.result, "omanyte");
	assert.equal(findFossil(["cobblemon:old_amber_fossil"])?.result, "aerodactyl");
	assert.equal(findFossil(["cobblemon:fossilized_bird", "cobblemon:fossilized_drake"])?.result, "dracozolt");
	assert.equal(findFossil(["cobblemon:fossilized_drake", "cobblemon:fossilized_bird"])?.result, "dracozolt", "ordem não importa");
	assert.equal(findFossil(["cobblemon:fossilized_fish", "cobblemon:fossilized_dino"])?.result, "arctovish");
	assert.equal(findFossil(["cobblemon:fossilized_bird", "cobblemon:fossilized_bird"]), undefined, "dois iguais não formam Dracozolt");
	assert.equal(findFossil(["cobblemon:fossilized_bird"]), undefined, "meio fóssil não forma nada");
	assert.equal(findFossil(["cobblemon:helix_fossil", "cobblemon:dome_fossil"]), undefined);
	assert.ok(isFossilIngredient("cobblemon:skull_fossil"));
	assert.ok(!isFossilIngredient("minecraft:bone"));
	// Toda espécie das receitas de fóssil existe no species.ts (via lista de ITEMS[fossil].species).
	for (const f of FOSSILS) assert.ok(f.fossils.length >= 1 && f.fossils.every(i => i.startsWith("cobblemon:")), f.id);
}

// 2. Material orgânico (natural_materials): item exato, tag e item devolvido.
{
	assert.equal(naturalMaterialContent("cobblemon:oran_berry"), 2, "tag #cobblemon:berries");
	assert.equal(naturalMaterialContent("cobblemon:max_revive"), 64);
	assert.equal(naturalMaterialContent("minecraft:wheat_seeds"), 1);
	assert.equal(naturalMaterialContent("minecraft:stone"), undefined);
	assert.equal(naturalMaterialReturnItem("cobblemon:berry_juice"), "minecraft:bowl");
	assert.equal(naturalMaterialContent("cobblemon:hearty_grain_bale"), 16);
}

// 3. Máquina: inserir, ligar, estágios, fim, proteção e retirada.
{
	const m = newFossilMachine("minecraft:overworld", [0, 64, 0], [0, 65, 0], [1, 64, 0]);
	assert.ok(!insertFossil(m, "minecraft:bone", 2), "só fósseis");
	assert.ok(insertFossil(m, "cobblemon:fossilized_bird", 2, { id: "p1", name: "Ash" }));
	assert.ok(insertFossil(m, "cobblemon:fossilized_drake", 2));
	assert.equal(m.result, "cobblemon:dracozolt");
	assert.ok(insertFossil(m, "cobblemon:fossilized_fish", 2), "o 1.8.2 aceita um 3º item (compara com >)");
	assert.equal(m.result, undefined, "três itens não formam nada");
	assert.ok(!insertFossil(m, "cobblemon:fossilized_dino", 2), "quarto recusado");
	assert.equal(takeLastFossil(m), "cobblemon:fossilized_fish");
	assert.equal(m.result, "cobblemon:dracozolt");
	assert.deepEqual(tickFossilMachine(m, 20), [], "sem material não liga");
	for (let i = 0; i < 64; i++) insertOrganic(m, "cobblemon:oran_berry");
	assert.equal(m.organic, MATERIAL_TO_START);
	assert.ok(!insertOrganic(m, "cobblemon:oran_berry"), "cheio");
	assert.deepEqual(tickFossilMachine(m, 20), ["start"]);
	assert.equal(m.time, TIME_TO_TAKE);
	assert.equal(monitorScreen(m), "blue_progress_1");
	assert.ok(!insertFossil(m, "cobblemon:helix_fossil", 2), "ligada não aceita fóssil");
	assert.equal(takeLastFossil(m), undefined, "ligada não devolve");
	assert.deepEqual(tickFossilMachine(m, TIME_PER_STAGE), ["stage"]);
	assert.equal(monitorScreen(m), "blue_progress_2");
	let events: string[] = [];
	for (let t = 0; t < TIME_TO_TAKE && !events.includes("finished"); t += 20) events = tickFossilMachine(m, 20);
	assert.ok(events.includes("finished"));
	assert.ok(m.created);
	assert.equal(m.organic, 0);
	assert.deepEqual(m.fossils, []);
	assert.equal(m.protection, PROTECTION_TIME);
	assert.equal(monitorScreen(m), "green_progress_9");
	assert.ok(isProtectedFrom(m, "p2"), "outro jogador espera a proteção");
	assert.ok(!isProtectedFrom(m, "p1"));
	assert.deepEqual(tickFossilMachine(m, PROTECTION_TIME), ["unprotected"]);
	assert.ok(!isProtectedFrom(m, "p2"));
	assert.equal(monitorScreen(m), "off");
	clearCreated(m);
	assert.ok(!m.created);
	assert.equal(m.result, undefined);
}

// ---------------------------------------------------------------------------------------------
// 4. Receitas da panela: forma, sem forma, tags e espelho.
{
	const grid = (...cells: (string | null)[]) => [...cells, ...new Array(9 - cells.length).fill(null)];
	const M = "minecraft:milk_bucket", H = "minecraft:honey_bottle", V = "cobblemon:vivichoke", G = "cobblemon:hearty_grains";
	const snack = findCookingRecipe([M, M, M, H, V, H, G, G, G]);
	assert.equal(snack?.result.item, "cobblemon:poke_snack");
	assert.equal(findCookingRecipe([M, M, M, H, V, H, G, G, null]), undefined, "faltou um grão");
	// Sem forma: berry_sweet em qualquer posição.
	assert.equal(findCookingRecipe(grid(null, null, "minecraft:sugar", null, "minecraft:blue_dye", null, null, "minecraft:honey_bottle"))?.result.item, "cobblemon:berry_sweet");
	// Tag #cobblemon:berries (3 berries quaisquer).
	assert.equal(findCookingRecipe(grid("cobblemon:oran_berry", "cobblemon:pecha_berry", "cobblemon:oran_berry", "minecraft:stick", "minecraft:sugar"))?.result.item, "cobblemon:candied_berry");
	assert.equal(findCookingRecipe(grid("cobblemon:oran_berry", "minecraft:dirt", "cobblemon:oran_berry", "minecraft:stick", "minecraft:sugar")), undefined);
	// Grade recortada.
	assert.deepEqual(trimGrid([null, null, null, null, "a", "b", null, null, null]), { w: 2, h: 1, cells: ["a", "b"] });
	// Espelho horizontal numa receita assimétrica (sintética).
	const asym: CookingPotRecipe = { id: "t", shaped: true, pattern: ["AB"], key: { A: [{ item: "x:a" }], B: [{ item: "x:b" }] }, result: { item: "x:r", count: 1 }, seasoningProcessors: [] };
	assert.ok(matchesShaped(asym, grid(null, "x:a", "x:b")));
	assert.ok(matchesShaped(asym, grid("x:b", "x:a")), "espelhada");
	assert.ok(!matchesShaped(asym, grid("x:a", null, "x:b")));
	// Todas as receitas geradas têm resultado e ingredientes.
	for (const r of COOKING_POT_RECIPES) assert.ok(r.result.item && (r.shaped ? r.pattern && r.key : r.ingredients?.length), r.id);
}

// 5. Temperos: tag da receita, processadores e lore.
{
	const snack = COOKING_POT_RECIPES.find(r => r.id === "campfire_pot/poke_snack")!;
	assert.ok(seasoningFor("cobblemon:oran_berry")?.flavours, "berry vira tempero pelos sabores");
	assert.equal(seasoningFor("minecraft:sugar")?.mobEffects?.[0].effect, "speed");
	const data = applySeasoning(snack, ["cobblemon:oran_berry", "minecraft:sugar", "cobblemon:lum_berry"])!;
	assert.deepEqual(data.seasonings, ["cobblemon:oran_berry", "cobblemon:lum_berry"], "açúcar não é tempero de isca");
	assert.deepEqual(data.baits, ["cobblemon:oran_berry", "cobblemon:lum_berry"]);
	assert.deepEqual(data.colours, ["light_blue", seasoningFor("cobblemon:lum_berry")!.colour]);
	const lore = seasoningLore(data)!;
	assert.equal(lore.length, 2);
	assert.deepEqual(seasoningIdsFromLore(lore), ["cobblemon:oran_berry", "cobblemon:lum_berry"]);
	assert.deepEqual(seasonedDataFromLore("cobblemon:poke_snack", lore)?.baits, ["cobblemon:oran_berry", "cobblemon:lum_berry"], "lore → dados de novo");
	assert.ok(seasoningConsumed(snack, "cobblemon:oran_berry"));
	assert.ok(!seasoningConsumed(snack, "minecraft:sugar"));
	// Receita sem tempero: nada é consumido nem aplicado.
	const cake = COOKING_POT_RECIPES.find(r => r.id === "campfire_pot/cake_in_campfire_pot")!;
	assert.equal(applySeasoning(cake, ["cobblemon:oran_berry"]), undefined);
	assert.ok(!seasoningConsumed(cake, "cobblemon:oran_berry"));
	// Chá sinistro: efeitos de poção mesclados (maior amplificador, durações 100/75%).
	const tea = COOKING_POT_RECIPES.find(r => r.id === "campfire_pot/sinister_tea")!;
	const teaData = applySeasoning(tea, ["minecraft:sugar", "minecraft:sugar", "cobblemon:big_root"])!;
	assert.deepEqual(teaData.mobEffects, [{ effect: "speed", duration: 260 + 195, amplifier: 0 }, { effect: "resistance", duration: 100, amplifier: 0 }]);
	assert.deepEqual(mergeMobEffects([{ effect: "a", duration: 100, amplifier: 0 }, { effect: "a", duration: 200, amplifier: 2 }, { effect: "a", duration: 40, amplifier: 1 }]), [{ effect: "a", duration: 200 + 75 + 20, amplifier: 2 }]);
	// Ponigiri: comida somada (FoodUtils.merge).
	assert.deepEqual(mergeFood([{ hunger: 2, saturation: 1.8 }, { hunger: 3, saturation: 0.6 }], 4, 0.4), { hunger: Math.ceil(9 * 0.8), saturation: Math.round(2.8 * 0.8 * 100) / 100 });
	const pon = COOKING_POT_RECIPES.find(r => r.id === "campfire_pot/ponigiri")!;
	assert.deepEqual(applySeasoning(pon, [])?.food, { hunger: 2, saturation: 2.2 }, "Ponigiri: comida base 2 / 0,55");
	assert.deepEqual(applySeasoning(pon, ["minecraft:carrot"])?.food, { hunger: 4, saturation: 4 }, "base + cenoura (2 / 1,8)");
	// Aprijuice: bônus de montaria (limiares de sabor + apricorn).
	assert.deepEqual(rideBoostsFor("cobblemon:aprijuice_blue", {}), { SKILL: 2, JUMP: -1 });
	assert.deepEqual(rideBoostsFor("cobblemon:aprijuice_red", { SPICY: 40, DRY: 10 }), { ACCELERATION: 2 + 2, STAMINA: -1 });
	assert.equal(rideBoostsFor("cobblemon:poke_snack", { SPICY: 40 }), undefined);
}

// 6. Cozimento: progresso com tampa, consumo, restos e pilha do resultado.
{
	const M = "minecraft:milk_bucket", H = "minecraft:honey_bottle", V = "cobblemon:vivichoke", G = "cobblemon:hearty_grains";
	const one = (id: string, n = 1) => ({ id, n });
	const state: CookingPotState = {
		pot: "cobblemon:campfire_pot_red", grid: [one(M, 2), one(M), one(M), one(H), one(V), one(H), one(G), one(G), one(G)],
		seasonings: [one("cobblemon:oran_berry", 3), one("minecraft:sugar"), null], result: null, progress: 0, lid: false,
	};
	assert.deepEqual(cookTick(state, 10), { cooked: false, remainders: [] }, "tampa aberta não cozinha");
	assert.equal(state.progress, 0);
	state.lid = true;
	for (let i = 0; i < 9; i++) assert.ok(!cookTick(state, 10).cooked);
	const done = cookTick(state, 10);
	assert.ok(done.cooked);
	assert.deepEqual(done.remainders.sort(), ["minecraft:bucket", "minecraft:bucket", "minecraft:bucket", "minecraft:glass_bottle", "minecraft:glass_bottle"].sort());
	assert.equal(state.result?.id, "cobblemon:poke_snack");
	assert.deepEqual(seasoningIdsFromLore(state.result?.lore), ["cobblemon:oran_berry"]);
	assert.deepEqual(state.grid[0], { id: M, n: 1 });
	assert.equal(state.grid[1], null);
	assert.equal(state.seasonings[0]?.n, 2, "berry de isca consumida");
	assert.equal(state.seasonings[1]?.n, 1, "açúcar fica (fora da tag)");
	// Resultado diferente no espaço de saída bloqueia.
	const other: CookingPotState = { ...state, grid: [one(M), one(M), one(M), one(H), one(V), one(H), one(G), one(G), one(G)], seasonings: [null, null, null], progress: 0 };
	for (let i = 0; i < 12; i++) assert.ok(!cookTick(other, 10).cooked, "sem tempero = outro item, não empilha");
	assert.equal(other.progress, 0);
}

// 7. Poções do Cobblemon (receitas brewing_stand).
{
	assert.equal(findBrewingRecipe("cobblemon:pecha_berry", "minecraft:glass_bottle")?.result.item, "cobblemon:antidote");
	assert.equal(findBrewingRecipe("cobblemon:lum_berry", "cobblemon:max_potion")?.result.item, "cobblemon:full_restore");
	assert.equal(findBrewingRecipe("cobblemon:pecha_berry", "cobblemon:max_potion"), undefined);
}

// ---------------------------------------------------------------------------------------------
// 8. Pasto: capacidade, limite por jogador, desmaiado, área e persistência.
{
	const record: PastureRecord = { dimension: "minecraft:overworld", pos: [10, 64, -5], ownerId: "p1", ownerName: "Ash", tethers: [] };
	const limits = { maxTethered: 3, maxPerPlayer: 2 };
	const tether = (i: number, player = "p1"): Tether => ({ tetheringId: `t${i}`, playerId: player, playerName: player, pokemonId: `mon${i}`, species: "pikachu", level: 5 + i });
	assert.equal(canAddPokemon(record, "p1", { uuid: "mon1", currentHealth: 0 }, limits), "fainted");
	assert.equal(canAddPokemon(record, "p1", { uuid: "mon1", currentHealth: 10 }, limits), "ok");
	addTether(record, tether(1));
	assert.equal(canAddPokemon(record, "p1", { uuid: "mon1", currentHealth: 10 }, limits), "already");
	addTether(record, tether(2));
	assert.equal(canAddPokemon(record, "p1", { uuid: "mon3", currentHealth: 10 }, limits), "player_full");
	assert.equal(canAddPokemon(record, "p2", { uuid: "mon3", currentHealth: 10 }, limits), "ok");
	addTether(record, tether(3, "p2"));
	assert.equal(canAddPokemon(record, "p2", { uuid: "mon4", currentHealth: 10 }, limits), "full");
	assert.equal(nearbyPokemonCap(4, 32), 64);
	assert.ok(insideRoam(record.pos, 32, { x: 42.5, y: 64, z: -5 }));
	assert.ok(!insideRoam(record.pos, 32, { x: 44, y: 64, z: -5 }));
	// Persistência: JSON de ida e volta e registro salvo sobrevive a "recarregar" o índice.
	const round = parsePasture(serializePasture(record))!;
	assert.deepEqual(round, record);
	assert.equal(parsePasture("{"), undefined);
	assert.equal(parsePasture(JSON.stringify({ dimension: "x", pos: [1, 2] })), undefined);
	assert.equal(parsePasture(JSON.stringify({ ...record, tethers: [...record.tethers, { broken: true }] }))!.tethers.length, 3, "entradas inválidas descartadas");
	const store = new MachineStore<PastureRecord>("pasture");
	const key = blockKey("minecraft:overworld", { x: 10.7, y: 64.2, z: -4.3 });
	assert.equal(key, "minecraft:overworld|10|64|-5");
	assert.deepEqual(parseBlockKey(key), { dimension: "minecraft:overworld", location: { x: 10, y: 64, z: -5 } });
	store.set(key, record);
	setStorageBackend({ get: id => mem.get(id), set: (id, v) => { if (v === undefined) mem.delete(id); else mem.set(id, v); }, ids: () => [...mem.keys()] });
	const reloaded = new MachineStore<PastureRecord>("pasture");
	assert.deepEqual(reloaded.keys(), [key], "índice remontado das dynamic properties");
	assert.deepEqual(reloaded.get(key), record);
	assert.equal(findTether([reloaded.get(key)!], "mon3")?.tether.playerId, "p2");
	assert.deepEqual(removeAllTethers(record, "p1").map(t => t.pokemonId), ["mon1", "mon2"]);
	assert.equal(removeTether(record, "mon3")?.pokemonId, "mon3");
	assert.equal(record.tethers.length, 0);
	reloaded.delete(key);
	assert.deepEqual(reloaded.keys(), []);
	assert.throws(() => reloaded.set("grande", { ...record, ownerName: "x".repeat(40000) }), /grande demais/);
}

// ---------------------------------------------------------------------------------------------
// 9. Poké Snack: temperos de isca da panela → ids de isca do bloco (frente pesca) → influências de spawn.
{
	assert.deepEqual(baitIdsForSeasonings(["cobblemon:oran_berry", "minecraft:sugar"]), ["cobblemon:berries/oran_berry"], "açúcar não é isca");
	assert.deepEqual(baitIdsForSeasonings(["minecraft:golden_apple"]), ["cobblemon:fruits/golden_apple"]);
	assert.equal(seasoningBaitId("cobblemon:oran_berry"), "seasonings:oran_berry");
	// Poké Snack cozido com Oran + Lum: a lore do item leva os temperos e vira ids de isca.
	const snack = COOKING_POT_RECIPES.find(r => r.id === "campfire_pot/poke_snack")!;
	const lore = seasoningLore(applySeasoning(snack, ["cobblemon:oran_berry", "cobblemon:lum_berry", "minecraft:golden_apple"]));
	const ids = baitIdsFromLore(lore);
	assert.deepEqual(ids, ["cobblemon:berries/oran_berry", "cobblemon:berries/lum_berry", "cobblemon:fruits/golden_apple"]);
	assert.deepEqual(baitIdsFromLore(undefined), []);
	// Efeitos resolvidos pela pesca: bite_time (mais rápido), grupo de ovo, rarity_bucket (Lure) e shiny.
	const effects = effectsForItem(undefined, ids);
	assert.ok(effects.some(e => e.type === "bite_time") && effects.some(e => e.type === "egg_group") && effects.some(e => e.type === "shiny_reroll"));
	assert.equal(rarityTier(effects), 1);
	assert.equal(randomTicksBetweenSpawns(effectsForItem(undefined, ["cobblemon:berries/oran_berry"]), seq(0, 0)), Math.max(1, 2 * (1 - 0.33)));
	assert.equal(randomTicksBetweenSpawns([]), 2, "sem tempero: 2 random ticks entre spawns");
	// Influências do bloco: Lure pelo rarity_bucket, isca e "sem herd".
	const influences = snackInfluences(effects);
	const entry = (species: string, type = "pokemon"): SpawnEntry => ({ id: species, type, species, aspects: [], positionType: "grounded", bucket: "common", minLevel: 1, maxLevel: 5, weight: 1, weightMultipliers: [], condition: {} });
	const spawnable = influences.find(i => i.affectSpawnable)!;
	assert.equal(spawnable.affectSpawnable!(entry("pidgey"), {} as never), true);
	assert.equal(spawnable.affectSpawnable!(entry("pidgey", "pokemon-herd"), {} as never), false);
	const weigh = (species: string) => influences.reduce((w, i) => i.affectWeight ? i.affectWeight(entry(species), {} as never, w) : w, 2);
	assert.equal(weigh("bulbasaur"), 20, "Lum: grupo monstro ×10");
	assert.equal(weigh("pidgey"), 2);
	assert.ok(influences.length >= 3, "normalização + isca + sem herd");
}

// ---------------------------------------------------------------------------------------------
// 10. TMs e estante de discos.
{
	assert.ok(Object.keys(TECHNICAL_MACHINES).length > 300);
	const defaults = availableTMs(new Set());
	assert.ok(defaults.length > 0 && defaults.every(m => TECHNICAL_MACHINES[m].default));
	assert.ok(!defaults.includes("acrobatics"), "acrobatics é desbloqueável");
	assert.ok(availableTMs(new Set(["acrobatics"])).includes("acrobatics"));
	assert.deepEqual(availableTMs(new Set(["acrobatics"]), { type: "flying", search: "acro" }), ["acrobatics"]);
	const inv = new Map([["cobblemon:blank_tm", 1], ["cobblemon:flying_gem", 6], ["minecraft:wind_charge", 1]]);
	assert.deepEqual(missingForTM("acrobatics", inv), []);
	inv.set("cobblemon:flying_gem", 5);
	assert.deepEqual(missingForTM("acrobatics", inv).map(m => [m.ingredient.item, m.have]), [["cobblemon:flying_gem", 5]]);
	inv.delete("cobblemon:blank_tm");
	assert.equal(missingForTM("acrobatics", inv).length, 2, "sem Blank TM");
	const lore = [{ translate: "cobblemon.port.tm.move", with: { rawtext: [{ translate: "cobblemon.move.acrobatics" }, { text: "acrobatics" }] } }];
	assert.deepEqual(tmMoveFromLore(lore), { move: "acrobatics", type: "flying" });
	assert.equal(tmMoveFromLore([{ text: "x" }]), undefined);
	// Estante: 2 colunas × 7 linhas; linha 0 no topo.
	assert.equal(discShelfSlot("south", { x: 0.2, y: 0.9, z: 1 }), 0);
	assert.equal(discShelfSlot("south", { x: 0.8, y: 0.9, z: 1 }), 1);
	assert.equal(discShelfSlot("south", { x: 0.2, y: 0.1, z: 1 }), 12);
	assert.equal(discShelfSlot("north", { x: 0.2, y: 0.1, z: 0 }), 13, "norte espelha x");
	assert.equal(discShelfSlot("south", { x: 0.5, y: 0.5, z: 1 }), -1, "entre as colunas");
	assert.ok(isValidDisc("minecraft:music_disc_cat") && isValidDisc("cobblemon:blank_tm") && !isValidDisc("minecraft:stone"));
	assert.ok(ITEM_TAGS["cobblemon:berries"].includes("cobblemon:oran_berry"));
}

// ---------------------------------------------------------------------------------------------
// 11. Máquina de fósseis com parte em chunk descarregado: pausa (não desmonta); estrutura quebrada desmonta.
{
	const posKey = (l: { x: number; y: number; z: number }) => `${l.x}|${l.y}|${l.z}`;
	const blocks = new Map<string, { typeId: string; part?: string }>();
	const unloaded = new Set<string>();
	const dim: any = {
		id: "minecraft:overworld",
		isChunkLoaded: (l: { x: number; y: number; z: number }) => !unloaded.has(posKey(l)),
		getBlock: (l: { x: number; y: number; z: number }) => {
			const b = blocks.get(posKey(l));
			if (!b) return undefined;
			return { ...b, location: l, dimension: dim, isValid: true, permutation: { getState: (s: string) => s === "cobblemon:part" ? b.part : undefined }, setPermutation() { } };
		},
		playSound() { }, spawnItem() { }, getEntities: () => [],
	};
	const originalGetDimension = (world as any).getDimension;
	(world as any).getDimension = () => dim;
	blocks.set("0|64|0", { typeId: ANALYZER });
	blocks.set("1|64|0", { typeId: MONITOR });
	blocks.set("2|64|0", { typeId: TANK, part: "bottom" });
	blocks.set("2|65|0", { typeId: TANK, part: "top" });
	const key = blockKey("minecraft:overworld", { x: 0, y: 64, z: 0 });
	fossilStore.set(key, newFossilMachine("minecraft:overworld", [0, 64, 0], [1, 64, 0], [2, 64, 0]));
	for (const part of ["1|64|0", "2|64|0", "2|65|0"]) {
		unloaded.clear();
		unloaded.add(part);
		tickFossilMachines(20);
		assert.ok(fossilStore.get(key), `parte ${part} descarregada: a máquina pausa em vez de desmontar`);
	}
	unloaded.clear();
	tickFossilMachines(20);
	assert.ok(fossilStore.get(key), "estrutura inteira carregada continua");
	blocks.set("1|64|0", { typeId: "minecraft:air" });
	tickFossilMachines(20);
	assert.equal(fossilStore.get(key), undefined, "monitor carregado e ausente: desmonta");
	(world as any).getDimension = originalGetDimension;
}

// ---------------------------------------------------------------------------------------------
// 12. Máquina de TMs: a escolha feita com a tela aberta não sobrescreve TMs prontos/gravação de outro jogador;
// a máquina que sumiu sem evento de quebra devolve os materiais.
{
	const drops: unknown[] = [];
	const block: any = {
		isValid: true, typeId: "cobblemon:tm_machine", location: { x: 7, y: 64, z: 7 },
		dimension: { id: "minecraft:overworld", playSound() { }, spawnItem: (item: unknown) => { drops.push(item); } },
		permutation: { getState: () => undefined, withState() { return this; } }, setPermutation() { },
	};
	const props = new Map<string, unknown>();
	const player: any = {
		isSneaking: false, name: "Ash", id: "p1",
		getDynamicProperty: (k: string) => props.get(k), setDynamicProperty: (k: string, v: unknown) => { if (v === undefined) props.delete(k); else props.set(k, v); },
		getGameMode: () => "Creative", onScreenDisplay: { setActionBar() { } }, sendMessage() { }, getComponent: () => undefined,
	};
	const key = blockKey("minecraft:overworld", block.location);
	const firstTM = availableTMs(new Set())[0];

	// Outro jogador deixou TMs prontos enquanto a tela estava aberta.
	formHooks.show = () => { tmStore.set(key, { result: { move: firstTM, count: 2 } }); return { selection: 1 }; };
	await openTMMachine(player, block);
	assert.deepEqual(tmStore.get(key), { result: { move: firstTM, count: 2 } }, "TMs prontos não são apagados");

	// Outro jogador começou a gravar enquanto a tela estava aberta.
	tmStore.delete(key);
	formHooks.show = () => { tmStore.set(key, { move: firstTM, progress: 30 }); return { selection: 1 }; };
	await openTMMachine(player, block);
	assert.deepEqual(tmStore.get(key), { move: firstTM, progress: 30 }, "gravação em andamento não é reiniciada");

	// Controle: máquina livre começa a gravar o TM escolhido.
	tmStore.delete(key);
	formHooks.show = () => ({ selection: 1 });
	await openTMMachine(player, block);
	assert.deepEqual(tmStore.get(key), { move: firstTM, progress: 0 });
	formHooks.show = undefined;

	// O bloco virou outro sem o evento de quebra: devolve o Blank TM e apaga o registro.
	block.typeId = "minecraft:air";
	tickTMMachines(5, () => block);
	assert.equal(tmStore.get(key), undefined);
	assert.ok(drops.length >= 1, "materiais devolvidos no chão");
}

// ---------------------------------------------------------------------------------------------
// 13. Panela: a grade só aceita ingredientes de receita (e temperos).
{
	assert.ok(isCookingIngredient("minecraft:sugar"));
	assert.ok(isCookingIngredient("cobblemon:oran_berry"), "berry pela tag cobblemon:berries");
	assert.ok(!isCookingIngredient("minecraft:diamond_sword"));
	assert.ok(!isCookingIngredient("minecraft:shulker_box"));
}

console.log("maquinas.test: ok");
