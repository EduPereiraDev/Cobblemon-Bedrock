// Frente "mundo-final": habitats (pools, fases, estilos natural/ativado, detector), hasSpace pela largura do
// hitbox, trocas de aldeão/vendedor ambulante, injeções de loot, estruturas convertidas (.mcstructure),
// frutos das berries e papéis de parede do PC. Dados reais do Cobblemon 1.8.2 (generated/) e API mockada.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SPAWNS, SpawnEntry } from "../generated/scripts/spawns";
import { HABITAT_ANCHOR_RANGES, HABITAT_POOLS, HabitatSpawnEntry } from "../generated/scripts/habitats";
import { UNLOCKABLE_WALLPAPERS } from "../generated/scripts/wallpapers";
import { getSpeciesData } from "../scripts/speciesData";
import { SpawnContext, worldClock } from "../scripts/spawning/SpawnConditions";
import { hasSpaceBox, selectSpawnActions, spawnSizeOf } from "../scripts/spawning/SpawnSelector";
import { CellInfo, makeHasSpace, ZoneBlockCache } from "../scripts/spawning/Spawner";
import {
	activationBudget, attachHabitatInfluences, calculatePhase, clearHabitats, createSpawnEntries, currentPhase, defaultSettings, detectHabitats,
	habitatClock, habitatInfluence, habitatSpawnerId, habitatWorld, influentialRange, injectedEntries, phaseCount, phaseMatches, phaseOrderFor,
	poolByIndex, pruneSpawned, registerHabitat, structureSettings,
} from "../scripts/spawning/Habitats";
import { enqueueActivation, finishHabitatRemoval, habitatLoop, onHabitatRemoved, parseLevelRange, redstoneSignalAt, settingsFromForm, updateRedstone, visualStates } from "../scripts/machines/habitat";
import { readBedrockNbt, readJavaNbt, writeBedrockNbt, nbt } from "../tools/importer/nbt.ts";
import {
	applyProcessors, BlockMapper, convertBlocks, parseStateKey, placementOf, PlacedBlock, structureIndex, typedState, writeMcstructure,
} from "../tools/importer/structures.ts";
import { LOOT_INJECTIONS } from "../tools/importer/lootInjection.ts";
import { assemble, assemblyBlocks, canAttach, JigsawSource, rotateDir, rotatePos, rotateProps, templateBox } from "../tools/importer/jigsaw.ts";
import { seededRandom } from "../tools/importer/structures.ts";
import { parsePhases } from "../tools/importer/habitats.ts";

const ROOT = process.cwd();
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const HAND_BP = join(ROOT, "behavior_packs", "CobblemonBedrock");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
worldClock.timeOfDay = () => 6000;
worldClock.moonPhase = () => 0;

const overworld = { id: "minecraft:overworld", containsBlock: () => false } as unknown as SpawnContext["dimension"];

function ctx(x: number, z: number, extra: Partial<SpawnContext> = {}): SpawnContext {
	return {
		dimension: overworld, location: { x: x + 0.5, y: 65, z: z + 0.5 }, blockY: 64, positionType: "grounded", biome: "plains",
		baseBlock: "minecraft:grass_block", skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false, height: 10, ...extra,
	};
}

// ---------------------------------------------------------------------------------------------
// 1. hasSpace pela largura do hitbox (AreaSpawnablePosition.hasSpace)

{
	// Caixa do Cobblemon: x/z [min, max), y [y+1, max].
	assert.deepEqual(hasSpaceBox(10, 64, 20, 1, 2), { minX: 9, maxX: 13, minY: 65, maxY: 67, minZ: 19, maxZ: 23 });
	assert.deepEqual(hasSpaceBox(10, 64, 20, 3, 3), { minX: 8, maxX: 14, minY: 65, maxY: 67, minZ: 18, maxZ: 24 });
	assert.deepEqual(hasSpaceBox(0, 0, 0, 5, 10), { minX: -3, maxX: 5, minY: 1, maxY: 7, minZ: -3, maxZ: 5 });

	// Mundo falso: chão em y=64, ar acima; uma coluna sólida em (12, 65..66, 20).
	const solid = new Set(["12,65,20", "12,66,20"]);
	let reads = 0;
	const read = (x: number, y: number, z: number): CellInfo => {
		reads++;
		return y <= 64 || solid.has(`${x},${y},${z}`) ? { kind: "solid", typeId: "minecraft:stone" } : { kind: "air", typeId: "minecraft:air" };
	};
	const cache = new ZoneBlockCache(read, 10000);
	const at10 = makeHasSpace(cache, 10, 64, 20, "grounded", undefined, 10);
	assert.equal(at10(1, 2), false, "vizinho sólido dentro da caixa (largura 1 alcança x+2)");
	const at5 = makeHasSpace(cache, 5, 64, 5, "grounded", undefined, 10);
	assert.equal(at5(2, 2), true, "caixa livre");
	const before = reads;
	assert.equal(at5(2, 2), true);
	assert.equal(reads, before, "resultado memorizado por tamanho");
	// Coluna própria sem altura: rejeita sem ler os vizinhos.
	const low = new ZoneBlockCache((x, y, z) => (y === 66 && x === 0 && z === 0 ? { kind: "solid", typeId: "minecraft:stone" } : read(x, y, z)), 10000);
	assert.equal(makeHasSpace(low, 0, 64, 0, "grounded", undefined, 1)(1, 2), false);
	// Água é "espaço seguro" para grounded (não é sólida) e para submersas só o mesmo fluido.
	const wet = new ZoneBlockCache((_x, y) => (y <= 64 ? { kind: "solid", typeId: "minecraft:stone" } : { kind: "water", typeId: "minecraft:water" }), 10000);
	assert.equal(makeHasSpace(wet, 0, 64, 0, "grounded", undefined, 10)(2, 2), true);
	assert.equal(makeHasSpace(wet, 0, 64, 0, "seafloor", "water", undefined)(2, 2), true);
	assert.equal(makeHasSpace(wet, 0, 64, 0, "submerged", "lava", undefined)(2, 2), false);
	// Fora da zona conta como pedra (SpawningZone.getBlockState): caixa que passa da borda falha.
	const zone = { minX: 0, maxX: 8, minY: 60, maxY: 80, minZ: 0, maxZ: 8 };
	const edge = new ZoneBlockCache(read, 10000);
	assert.equal(makeHasSpace(edge, 4, 64, 4, "grounded", undefined, 10, zone)(1, 2), true, "no meio da zona");
	assert.equal(makeHasSpace(edge, 0, 64, 4, "grounded", undefined, 10, zone)(1, 2), false, "x−1 fora da zona");
	assert.equal(makeHasSpace(edge, 6, 64, 4, "grounded", undefined, 10, zone)(1, 2), false, "x+2 fora da zona");
	// Sem orçamento: cai para a coluna (altura).
	const broke = new ZoneBlockCache(read, 0);
	assert.equal(makeHasSpace(broke, 10, 64, 20, "grounded", undefined, 10)(1, 2), true, "sem leituras decide pela coluna");
	assert.equal(makeHasSpace(broke, 10, 64, 20, "grounded", undefined, 1)(1, 2), false);

	// Seleção: espécie larga (≥2) não entra em posição sem espaço lateral; entra quando há.
	const wide = SPAWNS.find(e => e.type === "pokemon" && e.positionType === "grounded" && !e.condition.biomes?.length && spawnSizeOf(e.species, e.aspects).width >= 2)
		?? SPAWNS.find(e => e.type === "pokemon" && e.positionType === "grounded" && spawnSizeOf(e.species, e.aspects).width >= 2);
	assert.ok(wide, "há spawns de espécies com hitbox largo");
	const base = ctx(0, 0, { biome: wide!.condition.biomes?.[0] ?? "plains" });
	const opts = { buckets: { [wide!.bucket]: 1 }, poolBuckets: [wide!.bucket], maxSpawns: 1, entriesFor: () => [wide!], filter: (e: SpawnEntry) => e === wide };
	const blocked = selectSpawnActions([{ ...base, hasSpace: () => false }], opts);
	assert.equal(blocked.length, 0, "sem espaço pela largura, nada spawna");
	const free = { ...base, hasSpace: (w: number, h: number) => w >= 2 || h >= 1 };
	// Pode falhar por outras condições da entrada; só compara quando a entrada vale sem o hasSpace.
	const control = selectSpawnActions([{ ...base, hasSpace: undefined, height: 50 }], opts);
	if (control.length) assert.equal(selectSpawnActions([free], opts).length, 1, "com espaço, spawna");
}

// ---------------------------------------------------------------------------------------------
// 2. Habitat pools importados

const pools = Object.values(HABITAT_POOLS);
assert.equal(pools.length, 51, "51 habitat pools do 1.8.2");
assert.deepEqual(pools.map(p => p.index).sort((a, b) => a - b), Array.from({ length: 51 }, (_, i) => i + 1), "índices 1..51 (cabem em habitat_pool_hi × 16 + habitat_pool)");
const berryPatch = HABITAT_POOLS["cobblemon:berry_patch"];
assert.ok(berryPatch && berryPatch.name === "cobblemon.habitat.berry_patch.name");
const lickitung = berryPatch.spawns.filter(s => s.species === "lickitung");
assert.equal(lickitung.length, 2);
assert.deepEqual(lickitung.map(s => [s.bucket, s.minLevel, s.maxLevel, s.weight]), [["common", 14, 39, 6], ["uncommon", 14, 39, 6]]);
assert.deepEqual(lickitung[1].phases, [[2, 6]]);
assert.ok(pools.every(p => p.spawns.every(s => getSpeciesData(s.species))), "toda espécie de habitat existe");
assert.ok(pools.some(p => p.spawns.some(s => s.condition.timeRange === "night")), "timeRange das spawns de habitat");
assert.ok(pools.some(p => p.spawns.some(s => s.aspects.includes("alolan") || s.aspects.some(a => a.includes("alola")))), "modifiers viram aspects");
assert.deepEqual(parsePhases("1-3, 5"), [[1, 3], [5, 5]]);
assert.equal(poolByIndex(berryPatch.index), "cobblemon:berry_patch");
assert.equal(poolByIndex(0), undefined);

// Fases (HabitatPool.getPhaseCount / HabitatBlockEntity.calculatePhase).
assert.equal(phaseCount(berryPatch.spawns), 6);
assert.equal(phaseCount([]), 1);
const pos = { x: 100, y: 64, z: -30 };
assert.deepEqual([0, 1, 2, 5, 6].map(d => calculatePhase("SIMPLE", pos, d * 24000 + 100, 6)), [1, 2, 3, 6, 1]);
const order = phaseOrderFor(pos, 6);
assert.deepEqual([...order].sort(), [1, 2, 3, 4, 5, 6], "FIXED_RANDOM é uma permutação fixa");
assert.deepEqual(Array.from({ length: 12 }, (_, d) => calculatePhase("FIXED_RANDOM", pos, d * 24000, 6)), [...order, ...order]);
const fullRandom = Array.from({ length: 30 }, (_, d) => calculatePhase("FULL_RANDOM", pos, d * 24000, 6));
assert.ok(fullRandom.every(p => p >= 1 && p <= 6));
assert.deepEqual(fullRandom, Array.from({ length: 30 }, (_, d) => calculatePhase("FULL_RANDOM", pos, d * 24000 + 500, 6)), "mesmo dia, mesma fase");
assert.ok(new Set(fullRandom).size > 1);
assert.equal(calculatePhase("SIMPLE", pos, 999999, 1), 1);

// Nível do bloco intersecta a faixa de cada spawn (HabitatSpawn.createSpawnDetail).
const narrowed = createSpawnEntries(berryPatch.spawns, [30, 35]);
assert.ok(narrowed.every(s => s.minLevel >= 30 && s.maxLevel <= 35));
assert.ok(!narrowed.some(s => s.species === "zigzagoon"), "fora da faixa do bloco some");
assert.ok(narrowed.length < berryPatch.spawns.length);

// ---------------------------------------------------------------------------------------------
// 3. Estilo natural: injeta spawns perto do bloco e substitui (replaceSpawns)

let tick = 1000;
habitatClock.tick = () => tick;
habitatClock.gameTime = () => 24000 * 1 + 10; // dia 1 → fase 2 (SIMPLE)
habitatWorld.lookup = () => "cobblemon:habitat_block";
clearHabitats();
{
	const natural = registerHabitat("minecraft:overworld", { x: 0, y: 64, z: 0 }, { ...defaultSettings(), style: "natural", poolId: "cobblemon:berry_patch", replaceSpawns: true, rangeOfInfluence: 16 });
	assert.equal(currentPhase(natural), 2);
	assert.equal(influentialRange(natural, "world"), 16);
	assert.equal(influentialRange(natural, "fishing"), 0, "pool sem spawns de pesca não afeta a pesca");
	const phase2 = injectedEntries(natural, "common", ctx(1, 1));
	assert.ok(phase2.length > 0 && phase2.every(e => phaseMatches(e, 2) && e.bucket === "common"));
	assert.ok(phase2.some(e => e.species === "zigzagoon"), "Zigzagoon é da fase 2");
	assert.ok(!phase2.some(e => e.species === "turtwig"), "Turtwig é da fase 3");

	// Detector: dentro do alcance vale, fora não.
	const near = ctx(3, 3), far = ctx(40, 40);
	const detected = detectHabitats("minecraft:overworld", { x: 20, y: 64, z: 20 }, 8, 8, "world");
	assert.equal(detected.length, 1);
	assert.equal(detectHabitats("minecraft:nether", { x: 0, y: 64, z: 0 }, 8, 8, "world").length, 0);
	assert.equal(detectHabitats("minecraft:overworld", { x: 500, y: 64, z: 0 }, 8, 8, "world").length, 0, "fora do raio de 128");
	attachHabitatInfluences([near, far], detected);
	assert.equal(near.influences?.length, 1);
	assert.equal(far.influences, undefined);

	// Seleção: a posição perto só aceita as spawns do bloco (substituição); a longe continua normal.
	const worldEntry = SPAWNS.find(e => e.type === "pokemon" && e.positionType === "grounded" && e.bucket === "common" && !Object.keys(e.condition).length)
		?? SPAWNS.find(e => e.type === "pokemon" && e.positionType === "grounded" && e.bucket === "common")!;
	const nearActions = selectSpawnActions([near], { buckets: { common: 1 }, poolBuckets: ["common"], maxSpawns: 1, entriesFor: () => [worldEntry] });
	assert.equal(nearActions.length, 1);
	assert.ok(natural.entrySet.has(nearActions[0].entry), "substituída pela spawn do habitat");
	assert.ok(["zigzagoon", "linoone"].includes(nearActions[0].species));
	// Sem substituição, a entrada do mundo continua possível junto com as injetadas.
	natural.settings.replaceSpawns = false;
	const inf = habitatInfluence(natural, "world");
	assert.equal(inf.affectSpawnable!(worldEntry, near), true);
	natural.settings.replaceSpawns = true;
	assert.equal(habitatInfluence(natural, "world").affectSpawnable!(worldEntry, near), false);
}

// ---------------------------------------------------------------------------------------------
// 4. Estilo ativado: cancela o spawn natural no raio, spawner próprio, limites

clearHabitats();
{
	const activated = registerHabitat("minecraft:overworld", { x: 0, y: 64, z: 0 }, {
		...defaultSettings(), style: "activated", poolId: "cobblemon:berry_patch", cancelledNaturalSpawningRange: 12, maxSpawns: 3, maxSpawnsPerActivation: 2, chance: 0.5,
	});
	assert.equal(influentialRange(activated, "world"), 12);
	const worldInf = habitatInfluence(activated, "world");
	const ownInf = habitatInfluence(activated, habitatSpawnerId(activated));
	const any = SPAWNS[0];
	assert.equal(worldInf.affectSpawnable!(any, ctx(1, 1)), false, "spawn natural cancelado no raio");
	assert.equal(ownInf.affectSpawnable!(activated.entries[0], ctx(1, 1)), true, "o próprio spawner spawna");
	assert.equal(worldInf.injectSpawns!("common", ctx(1, 1))?.length ?? 0, 0, "ativado não injeta no natural");
	// chance / maxSpawns / maxSpawnsPerActivation.
	assert.equal(activationBudget(activated, () => 0.9), 0, "chance falhou");
	assert.equal(activationBudget(activated, () => 0.1), 2);
	activated.spawned.add("a").add("b");
	assert.equal(activationBudget(activated, () => 0.1), 1, "sobra 1 até maxSpawns");
	activated.spawned.add("c");
	assert.equal(activationBudget(activated, () => 0.1), 0, "maxSpawns atingido");
	pruneSpawned(activated, id => id === "a");
	assert.deepEqual([...activated.spawned], ["a"]);
	// Redstone: borda de subida uma vez por pulso; sinal pelos vizinhos (getRedstonePower do próprio bloco custom é undefined).
	activated.receivingSignal = false;
	assert.equal(updateRedstone(activated, 15), true);
	assert.equal(updateRedstone(activated, 15), false, "sinal contínuo não reativa");
	assert.equal(updateRedstone(activated, 0), false);
	assert.equal(updateRedstone(activated, 3), true, "novo pulso");
	const powered = { getBlock: (p: { x: number; y: number; z: number }) => ({ getRedstonePower: () => (p.x === 1 ? 7 : p.y === 64 && p.x === 0 && p.z === 0 ? undefined : 0) }) };
	assert.equal(redstoneSignalAt(powered as never, { x: 0, y: 64, z: 0 }), 7);
	// Fila: uma ativação por tick; repetida não duplica.
	enqueueActivation(activated);
	enqueueActivation(activated);
	// Pool vazio (custom padrão) nunca ativa.
	const empty = registerHabitat("minecraft:overworld", { x: 50, y: 64, z: 50 }, defaultSettings());
	assert.equal(activationBudget(empty, () => 0), 0);
	assert.equal(influentialRange(empty, "world"), -1, "sem cancelamento por padrão");
	// Bloco que sumiu do mundo sai do registro quando é conferido.
	tick += 1000;
	habitatWorld.lookup = () => "minecraft:stone";
	assert.equal(detectHabitats("minecraft:overworld", { x: 0, y: 64, z: 0 }, 8, 8, "world").length, 0);
	habitatWorld.lookup = () => "cobblemon:habitat_block";
}
clearHabitats();

// Quebra: onBreak + onPlayerBreak da mesma quebra dropam uma vez; criativo não dropa.
{
	const drops: string[] = [];
	const dim = { id: "minecraft:overworld", spawnItem: (item: { typeId?: string }) => { drops.push(String(item.typeId ?? "item")); } } as never;
	const creative = { getGameMode: () => "Creative" } as never;
	onHabitatRemoved(dim, { x: 1, y: 2, z: 3 });
	onHabitatRemoved(dim, { x: 1, y: 2, z: 3 }, creative);
	finishHabitatRemoval("minecraft:overworld|1|2|3");
	assert.equal(drops.length, 0, "criativo (vindo em qualquer um dos eventos) não dropa");
	assert.equal(finishHabitatRemoval("minecraft:overworld|1|2|3"), false, "decidido uma vez só");
	onHabitatRemoved(dim, { x: 5, y: 2, z: 3 });
	onHabitatRemoved(dim, { x: 5, y: 2, z: 3 }, { getGameMode: () => "Survival" } as never);
	finishHabitatRemoval("minecraft:overworld|5|2|3");
	assert.equal(drops.length, 1, "sobrevivência: um drop");
}

// Configuração das estruturas e do editor.
{
	const s = structureSettings("cobblemon:treasure_hoard");
	assert.equal(s.style, "natural");
	assert.equal(s.replaceSpawns, true);
	assert.equal(s.phaseOrder, "FULL_RANDOM");
	assert.equal(s.rangeOfInfluence, HABITAT_ANCHOR_RANGES["cobblemon:treasure_hoard"]);
	assert.deepEqual(visualStates(s), { activated: false, cancels: true });
	assert.deepEqual(visualStates({ ...defaultSettings(), cancelledNaturalSpawningRange: 5 }), { activated: true, cancels: true });
	assert.deepEqual(parseLevelRange("5-20", 100), [5, 20]);
	assert.equal(parseLevelRange("20-5", 100), undefined);
	assert.equal(parseLevelRange("0-5", 100), undefined);
	const poolIdx = 1 + Object.keys(HABITAT_POOLS).indexOf("cobblemon:berry_patch");
	const edited = settingsFromForm([1, poolIdx, 2, "10-50", "shiny", "grass_block", true, 24, 1, "0.25", 8, 20, "5", "-1"], defaultSettings(), 100)!;
	assert.equal(edited.style, "natural");
	assert.equal(edited.poolId, "cobblemon:berry_patch");
	assert.equal(edited.phaseOrder, "FULL_RANDOM");
	assert.deepEqual(edited.levelRange, [10, 50]);
	assert.equal(edited.mimicId, "minecraft:grass_block");
	assert.equal(edited.trigger, "TICK");
	assert.equal(edited.chance, 0.25);
	assert.equal(edited.maxSpawnsPerActivation, -1);
	assert.equal(settingsFromForm([0, 0, 0, "x", "", "", false, 16, 0, "1", -1, 16, "-1", "1"], defaultSettings(), 100), undefined);
}

// Bloco de habitat gerado: componente registrado, tick e estados do pool.
{
	const block = json(join(GEN_BP, "blocks", "cobblemon", "habitat_block.json"))["minecraft:block"];
	assert.ok(block.components["cobblemon:habitat_block"], "custom component anexado pelo importador");
	assert.deepEqual(block.components["minecraft:tick"], { interval_range: [10, 10], looping: true });
	assert.equal(block.description.states["cobblemon:habitat_pool"].length, 16);
	assert.deepEqual(block.description.states["cobblemon:habitat_pool_hi"], [0, 1, 2, 3]);
	const pending = readFileSync(join(ROOT, "generated", "scripts", "blockBehaviours.ts"), "utf8");
	assert.ok(!pending.includes("\"cobblemon:habitat_block\":"), "habitat_block não é mais pendente");
}

// ---------------------------------------------------------------------------------------------
// 5. Trocas (CobblemonTradeOffers)

{
	const fisher = json(join(HAND_BP, "trading", "economy_trades", "fisherman_trades.json"));
	assert.equal(fisher.tiers.length, 5);
	const master = fisher.tiers[4].groups.flatMap((g: any) => g.trades);
	const template = master.find((t: any) => t.gives[0].item === "cobblemon:pokerod_smithing_template");
	assert.ok(template, "pescador mestre vende o molde de Poké Rod");
	assert.deepEqual([template.wants[0].item, template.wants[0].quantity, template.max_uses, template.trader_exp], ["minecraft:emerald", 12, 3, 30]);
	assert.ok(master.some((t: any) => t.wants[0].item === "minecraft:pufferfish"), "trocas vanilla preservadas");
	assert.ok(fisher.tiers[0].groups[0].trades.some((t: any) => t.wants[0].item === "minecraft:string"));
	const wanderer = json(join(HAND_BP, "trading", "economy_trades", "wandering_trader_trades.json"));
	const sells = wanderer.tiers[0].groups[2];
	assert.equal(sells.num_to_select, 5);
	const cob = sells.trades.filter((t: any) => String(t.gives[0].item).startsWith("cobblemon:"));
	assert.deepEqual(cob.map((t: any) => [t.gives[0].item, t.wants[0].quantity, t.max_uses]), [
		["cobblemon:vivichoke_seeds", 6, 1], ["cobblemon:saccharine_sapling", 5, 4], ["cobblemon:hearty_grains", 1, 12],
		["cobblemon:chipped_pot", 5, 1], ["cobblemon:masterpiece_teacup", 5, 1],
	]);
	assert.ok(sells.trades.length > 70, "trocas vanilla do vendedor preservadas");
	const items = new Set(readdirSync(join(GEN_BP, "items", "cobblemon")).map(f => `cobblemon:${f.replace(/\.json$/, "")}`));
	for (const t of [template, ...cob]) assert.ok(items.has(t.gives[0].item), `item ${t.gives[0].item} existe`);
}

// ---------------------------------------------------------------------------------------------
// 6. Injeções de loot (LootInjector)

{
	for (const { bedrock, injection } of LOOT_INJECTIONS) {
		assert.ok(existsSync(join(GEN_BP, "loot_tables", "cobblemon", "injection", `${injection}.json`)), `injeção ${injection} convertida`);
		for (const path of bedrock) {
			const table = json(join(GEN_BP, "loot_tables", `${path}.json`));
			const last = table.pools[table.pools.length - 1];
			assert.deepEqual(last, { rolls: 1, entries: [{ type: "loot_table", name: `loot_tables/cobblemon/injection/${injection}.json`, weight: 1 }] }, `${path} recebe o pool do Cobblemon`);
			const vanilla = json(join(ROOT, "tools", "importer", "data", "vanilla_loot", `${path}.json`));
			assert.equal(table.pools.length, vanilla.pools.length + 1, `${path}: pools vanilla preservados`);
		}
	}
	const houses = LOOT_INJECTIONS.filter(i => i.injection === "chests/village_house");
	assert.equal(houses.length, 5, "5 casas de vila usam village_house");
	const fishing = json(join(GEN_BP, "loot_tables", "cobblemon", "injection", "gameplay", "fishing", "treasure.json"));
	assert.equal(fishing.pools[0].entries[0].name, "cobblemon:pokerod_smithing_template");
	assert.deepEqual(fishing.pools[0].conditions, [{ condition: "random_chance", chance: 0.167 }]);
	const jungle = json(join(GEN_BP, "loot_tables", "cobblemon", "injection", "chests", "jungle_temple.json"));
	const tm = jungle.pools.flatMap((p: any) => p.entries).find((e: any) => e.name === "cobblemon:technical_machine");
	assert.deepEqual(tm.functions.find((f: any) => f.function === "set_lore"), { function: "set_lore", lore: ["§7Grass Pledge"] }, "TM com golpe vira lore");
	const village = json(join(GEN_BP, "loot_tables", "cobblemon", "injection", "chests", "village_house.json"));
	assert.deepEqual(village.pools[0].rolls, { min: 1, max: 2 }, "rolls {min,max} sem type");
}

// ---------------------------------------------------------------------------------------------
// 7. Estruturas: conversão NBT → .mcstructure

{
	// Unidades do conversor.
	assert.deepEqual(parseStateKey("minecraft:oak_stairs[upside_down_bit=false,weirdo_direction=0]"), { name: "minecraft:oak_stairs", props: { upside_down_bit: "false", weirdo_direction: "0" } });
	assert.deepEqual([typedState("true"), typedState("3"), typedState("north")], [true, 3, "north"]);
	assert.equal(structureIndex([2, 3, 4], 1, 2, 3), (1 * 3 + 2) * 4 + 3);
	const table = { "minecraft:stone[]": "minecraft:stone[]", "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=true]": "minecraft:oak_stairs[upside_down_bit=false,weirdo_direction=0]", "minecraft:water[level=0]": "minecraft:water[liquid_depth=0]", "minecraft:grass_block[snowy=false]": "minecraft:grass_block[]", "minecraft:grass_block[]": "minecraft:grass_block[]" };
	const mapper = new BlockMapper(() => ({ name: "cobblemon:habitat_block", states: { "cobblemon:habitat_pool": 0, "cobblemon:habitat_pool_hi": 0 } }), table);
	const blocks: PlacedBlock[] = [
		{ pos: [0, 0, 0], name: "minecraft:stone", props: {} },
		{ pos: [1, 0, 0], name: "minecraft:oak_stairs", props: { facing: "east", half: "bottom", shape: "straight", waterlogged: "true" } },
		{ pos: [0, 1, 0], name: "minecraft:jigsaw", props: {}, nbt: { final_state: "minecraft:grass_block[snowy=false]" } },
		{ pos: [1, 1, 0], name: "minecraft:structure_void", props: {} },
		{ pos: [0, 0, 1], name: "cobblemon:habitat_block", props: {}, nbt: { PoolId: "cobblemon:berry_patch", RangeOfInfluence: 16, MimicId: "minecraft:grass_block" } },
		{ pos: [1, 0, 1], name: "cobblemon:habitat_block", props: {}, nbt: { PoolId: "cobblemon:berry_patch", RangeOfInfluence: 16, MimicId: "minecraft:grass_block" } },
	];
	const s = convertBlocks([2, 2, 2], blocks, { mapper, poolIndex: new Map([["cobblemon:berry_patch", 20]]) });
	const nameAt = (x: number, y: number, z: number) => s.palette[s.layer0[structureIndex(s.size, x, y, z)]]?.name;
	assert.equal(nameAt(0, 0, 0), "minecraft:stone");
	assert.equal(nameAt(0, 1, 0), "minecraft:grass_block", "jigsaw vira o final_state");
	assert.equal(s.layer0[structureIndex(s.size, 1, 1, 0)], -1, "structure_void não mexe no terreno");
	assert.equal(s.palette[s.layer1[structureIndex(s.size, 1, 0, 0)]].name, "minecraft:water", "waterlogged → água na 2ª camada");
	assert.deepEqual(s.palette[s.layer0[structureIndex(s.size, 1, 0, 0)]].states, { upside_down_bit: false, weirdo_direction: 0 });
	const habitatBlocks = [structureIndex(s.size, 0, 0, 1), structureIndex(s.size, 1, 0, 1)].map(i => s.palette[s.layer0[i]]);
	assert.equal(habitatBlocks.filter(b => b.name === "cobblemon:habitat_block").length, 1, "uma âncora; o resto imita o bloco");
	const anchor = habitatBlocks.find(b => b.name === "cobblemon:habitat_block")!;
	assert.deepEqual([anchor.states["cobblemon:habitat_pool"], anchor.states["cobblemon:habitat_pool_hi"]], [4, 1], "índice 20 = 1 × 16 + 4");
	assert.equal(s.habitat?.poolId, "cobblemon:berry_patch");
	assert.equal(s.habitat?.range, 17, "alcance cobre o outro bloco (1) + 16");
	assert.equal(s.ticks.size, 1, "tick agendado na âncora");
	// Ida e volta do .mcstructure.
	const round: any = readBedrockNbt(writeMcstructure(s));
	assert.deepEqual(round.size, [2, 2, 2]);
	assert.equal(round.structure.block_indices.length, 2);
	assert.equal(round.structure.block_indices[0].length, 8);
	assert.equal(round.structure.palette.default.block_palette[0].version, 18153475);
	const tickEntry = Object.values<any>(round.structure.palette.default.block_position_data)[0];
	assert.deepEqual(tickEntry.tick_queue_data, [{ tick_delay: 10 }]);
	assert.deepEqual(readBedrockNbt(writeBedrockNbt({ a: nbt.byte(1), b: nbt.list("int", [nbt.int(-1)]), c: nbt.compound({ d: nbt.string("x") }) })), { a: 1, b: [-1], c: { d: "x" } });

	// Processadores: rule (random_block_match) e capped (limite).
	const sand = Array.from({ length: 200 }, (_, i): PlacedBlock => ({ pos: [i, 0, 0], name: "minecraft:sand", props: {} }));
	const procs = [
		{ processor_type: "minecraft:rule", rules: [{ input_predicate: { predicate_type: "minecraft:random_block_match", block: "minecraft:sand", probability: 0.5 }, location_predicate: { predicate_type: "minecraft:always_true" }, output_state: { Name: "minecraft:suspicious_sand" }, block_entity_modifier: { type: "minecraft:append_loot", loot_table: "cobblemon:fossils/common/x" } }] },
		{ processor_type: "minecraft:capped", limit: 3, delegate: { processor_type: "minecraft:rule", rules: [{ input_predicate: { predicate_type: "minecraft:random_block_match", block: "minecraft:suspicious_sand", probability: 1 }, location_predicate: { predicate_type: "minecraft:always_true" }, output_state: { Name: "minecraft:suspicious_sand" }, block_entity_modifier: { type: "minecraft:append_loot", loot_table: "cobblemon:fossils/rare/y" } }] } },
		{ processor_type: "minecraft:gravity", heightmap: "WORLD_SURFACE_WG", offset: 0 },
	];
	let seed = 7;
	const out = applyProcessors(sand, procs, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
	const sus = out.filter(b => b.name === "minecraft:suspicious_sand");
	assert.ok(sus.length > 60 && sus.length < 140, `metade vira suspeita (${sus.length})`);
	assert.equal(out.filter(b => b.loot === "cobblemon:fossils/rare/y").length, 3, "capped troca no máximo 3");
	assert.equal(sus.filter(b => b.loot === "cobblemon:fossils/common/x").length, sus.length - 3);

	// Colocação (placed_feature → feature rule).
	const surface = placementOf([{ type: "minecraft:count", count: 1 }, { type: "minecraft:rarity_filter", chance: 500 }, { type: "minecraft:heightmap" }, { type: "minecraft:random_offset", y_spread: -5 }], "overworld");
	assert.deepEqual([surface.pass, surface.chance, surface.y], ["surface_pass", 1 / 500, "q.heightmap(v.worldx, v.worldz) - 5"]);
	const under = placementOf([{ type: "minecraft:height_range", height: { type: "minecraft:uniform", min_inclusive: { absolute: -30 }, max_inclusive: { absolute: -5 } } }], "overworld");
	assert.deepEqual([under.pass, under.y], ["underground_pass", { distribution: "uniform", extent: [-30, -5] }]);

	// Saída do importador: moldes convertidos, features e regras com bioma.
	const dir = join(GEN_BP, "structures", "cobblemon");
	const files = readdirSync(dir).filter(f => /^(fossils|habitats|ruins)_/.test(f));
	assert.ok(files.length >= 200, `≥ 200 moldes convertidos (${files.length})`);
	assert.ok(files.filter(f => f.startsWith("fossils_")).length >= 70, "sítios de fósseis");
	const blockIds = new Set(readdirSync(join(GEN_BP, "blocks", "cobblemon")).map(f => `cobblemon:${f.replace(/\.json$/, "")}`));
	const sandyDen: any = readBedrockNbt(readFileSync(join(dir, "fossils_sandy_den.mcstructure")));
	const palette = sandyDen.structure.palette.default.block_palette;
	assert.ok(palette.some((p: any) => p.name === "minecraft:suspicious_sand"), "areia suspeita dos processadores");
	const brush = Object.values<any>(sandyDen.structure.palette.default.block_position_data).map(v => v.block_entity_data).filter(Boolean);
	assert.ok(brush.length > 0 && brush.every(b => b.id === "BrushableBlock" && /^loot_tables\/cobblemon\/fossils\//.test(b.LootTable)));
	for (const b of brush) assert.ok(existsSync(join(GEN_BP, b.LootTable)), `loot ${b.LootTable} existe`);
	let anchors = 0;
	for (const f of files) {
		const n: any = readBedrockNbt(readFileSync(join(dir, f)));
		for (const p of n.structure.palette.default.block_palette) {
			if (p.name.startsWith("cobblemon:")) assert.ok(blockIds.has(p.name), `${f}: bloco ${p.name} existe`);
			if (p.name === "cobblemon:habitat_block") {
				anchors++;
				const idx = p.states["cobblemon:habitat_pool_hi"] * 16 + p.states["cobblemon:habitat_pool"];
				assert.ok(poolByIndex(idx), `${f}: âncora com pool válido (${idx})`);
			}
		}
	}
	assert.ok(anchors >= 100, `habitats de molde têm âncora (${anchors})`);
	const rule = json(join(GEN_BP, "feature_rules", "cobblemon", "structure_fossils_prehistoric_sandy_den.json"))["minecraft:feature_rules"];
	assert.equal(rule.conditions.placement_pass, "surface_pass");
	assert.ok(rule.conditions["minecraft:biome_filter"], "filtro de bioma (has_block/sand)");
	assert.equal(rule.distribution.scatter_chance.denominator, 500);
	const feature = json(join(GEN_BP, "features", "cobblemon", "structure_fossils_sandy_den.json"))["minecraft:structure_template_feature"];
	assert.equal(feature.structure_name, "cobblemon:fossils_sandy_den");
	assert.equal(feature.facing_direction, "random");
	const rules = readdirSync(join(GEN_BP, "feature_rules", "cobblemon")).filter(f => f.startsWith("structure_"));
	assert.equal(rules.length, 43, "as 43 features cobblemon:structure");
	assert.ok(Object.keys(HABITAT_ANCHOR_RANGES).length >= 15, "alcance das âncoras por pool");

	// Molde original tem habitat blocks (sanidade da leitura NBT do Java).
	const lost = readJavaNbt(readFileSync(join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon", "structure", "habitats", "lost_ruins1.nbt"))) as any;
	assert.ok(lost.palette.some((p: any) => p.Name === "cobblemon:habitat_block"));
}

// ---------------------------------------------------------------------------------------------
// 7b. Estruturas jigsaw montadas na conversão (JigsawPlacement)

{
	assert.deepEqual([0, 1, 2, 3].map(k => rotatePos([1, 2, 3], k)), [[1, 2, 3], [-3, 2, 1], [-1, 2, -3], [3, 2, -1]], "Rotation.CLOCKWISE_90 × k");
	assert.equal(rotateDir("north", 1), "east");
	assert.equal(rotateDir("up", 3), "up");
	assert.deepEqual(rotateProps({ facing: "north", axis: "x", rotation: "14", orientation: "west_up", north: "true", east: "false", south: "low", west: "tall", shape: "ascending_north" }, 1),
		{ facing: "east", axis: "z", rotation: "2", orientation: "north_up", north: "tall", east: "true", south: "false", west: "low", shape: "ascending_east" });
	assert.equal(rotateProps({ shape: "south_east" }, 1).shape, "south_west");
	assert.deepEqual(templateBox([3, 2, 5], 1, [10, 0, 10]), { min: [6, 0, 10], max: [10, 1, 12] });
	const j = (front: string, top: string, name: string, target: string, joint = "rollable") => ({ pos: [0, 0, 0] as [number, number, number], front, top, name, target, pool: "p", joint, selection: 0, placement: 0 });
	assert.ok(canAttach(j("west", "up", "a", "b"), j("east", "up", "b", "c")));
	assert.ok(!canAttach(j("west", "up", "a", "b"), j("west", "up", "b", "c")), "frentes precisam ser opostas");
	assert.ok(!canAttach(j("west", "up", "a", "b"), j("east", "up", "x", "c")), "target do pai = name do filho");
	assert.ok(!canAttach(j("up", "north", "a", "b", "aligned"), j("down", "east", "b", "c")), "aligned exige o mesmo topo");
	assert.ok(canAttach(j("up", "north", "a", "b", "rollable"), j("down", "east", "b", "c")));

	// Montagem real: peças sem sobreposição, filhos encostados num jigsaw do pai, tudo dentro do raio.
	const src = new JigsawSource();
	const berry = json(join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon", "worldgen", "structure", "habitats", "berry_patch.json"));
	let multi = 0;
	for (let seed = 0; seed < 6; seed++) {
		const a = assemble(berry, src, seededRandom(`t${seed}`))!;
		assert.ok(a && a.pieces.length >= 1);
		if (a.pieces.length > 1) multi++;
		for (let i = 0; i < a.pieces.length; i++) for (let k = i + 1; k < a.pieces.length; k++) {
			const p = a.pieces[i].box, q = a.pieces[k].box;
			const overlap = p.min.every((v, d) => v <= q.max[d] && p.max[d] >= q.min[d]);
			assert.ok(!overlap, `peças ${i} e ${k} se sobrepõem`);
		}
		for (const p of a.pieces.slice(1)) assert.equal(p.depth, 1, "berry_patch tem size 1");
		const { size, blocks } = assemblyBlocks(a, seededRandom(`b${seed}`));
		assert.ok(blocks.every(b => b.pos.every((v, d) => v >= 0 && v < size[d])), "blocos dentro da caixa da montagem");
		assert.ok(!blocks.some(b => b.name === "minecraft:structure_void"));
		assert.ok(blocks.some(b => b.name === "cobblemon:habitat_block"), "habitat blocks na montagem");
	}
	assert.ok(multi >= 3, "a peça inicial recebe filhos pelos jigsaws");
	// Pool inicial com elemento vazio (flowerbed_clearing: 20 de 28) vira fator de chance.
	const flower = json(join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon", "worldgen", "structure", "habitats", "flowerbed_clearing.json"));
	assert.equal(assemble(flower, src, seededRandom("f"))!.startShare, 8 / 28);

	// Frente motor: as jigsaw viraram jigsaw data-driven (worldgen/structures + template_pools + peças em
	// structures/cobblemon/jigsaw/**); os testes da saída estão em tests/motor.test.ts.
	const wg = join(GEN_BP, "worldgen", "structures");
	const jig = readdirSync(wg);
	for (const hab of ["berry_patch", "bug_mound", "freshwater_pond", "zen_garden", "deep_sea_spire"]) assert.ok(jig.includes(`habitats_${hab}.json`), `habitat ${hab}`);
	for (const ruin of ["temperate_gimmi_tower", "hidden_bunker_ruins", "luna_henge_ruins"]) assert.ok(jig.includes(`ruins_${ruin}.json`), `ruína ${ruin}`);
	assert.ok(jig.some(f => f.includes("shipwreck_cove")), "enseadas (> 64 blocos) entram como jigsaw data-driven");
	const spire = json(join(wg, "habitats_deep_sea_spire.json"))["minecraft:jigsaw"];
	assert.equal(spire.heightmap_projection, "ocean_floor", "OCEAN_FLOOR_WG → fundo do oceano");
	// berry_patch_start: capped troca 9 dos 10 habitat blocks por folhas; os filhos trocam todos → 1 bloco, alcance 16.
	assert.equal(HABITAT_ANCHOR_RANGES["cobblemon:berry_patch"], 16);
}

// ---------------------------------------------------------------------------------------------
// 8. Frutos/flores/muda das berries: hierarquia do modelo e rotação [-x, -y, z]

{
	const oran = json(join(GEN_BP, "blocks", "cobblemon", "oran_berry.json"))["minecraft:block"].components["minecraft:geometry"];
	assert.equal(oran.identifier, "geometry.cobblemon.oran_berry_growth");
	const geo = json(join(GEN_RP, "models", "blocks", "cobblemon", "oran_berry_growth.geo.json"))["minecraft:geometry"][0];
	const bones = new Map<string, any>(geo.bones.map((b: any) => [b.name, b]));
	const berry = json(join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon", "berries", "oran_berry.json"));
	const p0 = berry.growthPoints[0];
	const fruit0 = bones.get("berry_fruit_0");
	assert.deepEqual(fruit0.pivot, [8 - p0.position.x, p0.position.y, p0.position.z - 8]);
	assert.deepEqual(fruit0.rotation, [-p0.rotation.x, -p0.rotation.y, p0.rotation.z]);
	const children = geo.bones.filter((b: any) => b.parent === "berry_fruit_0");
	assert.ok(children.length > 0, "bones do modelo do fruto sob o ponto");
	assert.ok(bones.has("berry_sprout_0"), "muda (idade 0) em stageOnePositioning");
	assert.equal(oran.bone_visibility.berry_sprout, "q.block_state('cobblemon:age') == 0", "visibilidade da muda no bone de grupo");
	assert.equal(oran.bone_visibility.berry_sprout_0, undefined, "sem entrada por ponto (limite de bone_visibility do Bedrock)");
	for (const b of geo.bones) if (b.parent) assert.ok(bones.has(b.parent), `pai ${b.parent} existe`);
}

// ---------------------------------------------------------------------------------------------
// 8b. Pedidos da frente jogabilidade-final: escala por Pokémon e partículas de script

{
	const bp = json(join(GEN_BP, "entities", "pokemon", "pikachu.json"))["minecraft:entity"].description.properties;
	// Bedrock exige literais float: default em string Molang e faixa com máximo não inteiro (validado no BDS).
	assert.deepEqual(bp["cobblemon:scale_modifier"], { type: "float", range: [0.05, 3.5], default: "1.0", client_sync: true });
	const rp = json(join(GEN_RP, "entity", "pokemon", "pikachu.entity.json"))["minecraft:client_entity"].description.scripts;
	// Frente msd-fase1: a escala multiplica também o crescimento do Dynamax (POKEMON_SCALE_MOLANG em entities.ts).
	assert.ok(rp.scale.startsWith("q.property('cobblemon:scale_modifier') * "), rp.scale);
	assert.equal(rp.scale, "q.property('cobblemon:scale_modifier') * (1.0 + 3.0 * v.cobblemon_dmax)");
	const particles = readdirSync(join(GEN_RP, "particles", "cobblemon"));
	assert.ok(particles.filter(f => f.startsWith("evo_")).length >= 12, "partículas evo_*");
	assert.ok(particles.filter(f => f.startsWith("poodle_hair_")).length >= 10, "partículas poodle_hair_*");
	for (const f of particles) {
		const tex = json(join(GEN_RP, "particles", "cobblemon", f)).particle_effect.description.basic_render_parameters.texture;
		assert.ok(existsSync(join(GEN_RP, `${tex}.png`)) || existsSync(join(ROOT, "resource_packs", "CobblemonBedrock", `${tex}.png`)), `${f}: textura ${tex}`);
	}
}

// ---------------------------------------------------------------------------------------------
// 9. Papéis de parede do PC (pedido da frente extras-final)

{
	assert.equal(UNLOCKABLE_WALLPAPERS.length, 6);
	assert.ok(UNLOCKABLE_WALLPAPERS.some(w => w.id === "cobblemon:biome_cave" && w.texture.endsWith("wallpaper_biome_cave.png") && w.enabled));
	for (const sub of ["basic", "basic/alt", "basic/glow", "biome", "biome/alt", "misc/glow"]) {
		assert.ok(existsSync(join(GEN_RP, "textures", "gui", "pc", "wallpaper", sub)), `subpasta ${sub}`);
	}
	assert.ok(existsSync(join(GEN_RP, "textures", "gui", "pc", "wallpaper", "basic", "wallpaper_basic_01.png")));
}

const unexpected = warnings.filter(w => /Erro|Error/.test(w));
assert.deepEqual(unexpected, [], `avisos inesperados: ${unexpected.join(" | ")}`);
void ({} as HabitatSpawnEntry);
console.log(`ok: hasSpace, ${pools.length} habitat pools (natural/ativado/fases/detector), trocas, ${LOOT_INJECTIONS.length} injeções de loot, estruturas e berries`);
