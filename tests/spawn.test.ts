// Frente "spawn": herds, Alfas, buckets, pesca, despawn e escala de nível, com os dados reais do
// Cobblemon 1.8.2 (generated/scripts/spawns.ts) e a API do Minecraft mockada.
import assert from "node:assert/strict";
import { BEST_SPAWNER_CONFIG, SPAWNS, SpawnEntry } from "../generated/scripts/spawns";
import { getSpeciesData } from "../scripts/speciesData";
import { conditionMatches, entryAllowed, isSlimeChunk, SpawnContext, worldClock, baseWeight } from "../scripts/spawning/SpawnConditions";
import {
	alphaScaleMultiplier, alphaTargetLevel, bucketNormalizingInfluence, chooseBucket, playerLevelRange, playerLevelRangeInfluence,
	scaleLevelRange, selectSpawnActions, weightedPick,
} from "../scripts/spawning/SpawnSelector";
import { chooseFishingSpawn, createPokemonForAction, HERD_GROUP_PROPERTY, HERD_LEADER_PROPERTY, spawnFromPool } from "../scripts/spawning/Spawner";
import { DespawnSettings, evaluateDespawn, MOUTH_ITEM_PROPERTY, shouldDespawn, SPAWN_TIME_PROPERTY } from "../scripts/spawning/Despawner";
import { moonPhaseInRange, timeInRange, TimeRanges } from "../scripts/spawning/TimeRange";

const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };

worldClock.timeOfDay = () => 6000;
worldClock.moonPhase = () => 0;

// ---------------------------------------------------------------------------------------------
// Dimensão/entidades falsas

class FakeEntity {
	isValid = true;
	nameTag = "";
	tags = new Set<string>();
	props = new Map<string, unknown>();
	dyn = new Map<string, unknown>();
	events: string[] = [];
	components: Record<string, unknown> = {};
	constructor(public typeId: string, public location: { x: number; y: number; z: number }) { }
	getProperty(k: string) { return this.props.get(k); }
	setProperty(k: string, v: unknown) { this.props.set(k, v); }
	getDynamicProperty(k: string) { return this.dyn.get(k); }
	setDynamicProperty(k: string, v: unknown) { if (v === undefined) this.dyn.delete(k); else this.dyn.set(k, v); }
	triggerEvent(e: string) { this.events.push(e); }
	addTag(t: string) { this.tags.add(t); return true; }
	hasTag(t: string) { return this.tags.has(t); }
	removeTag(t: string) { return this.tags.delete(t); }
	getComponent(c: string) { return this.components[c]; }
	remove() { this.isValid = false; }
	kill() { this.isValid = false; return true; }
}

const spawned: FakeEntity[] = [];
const overworld = {
	id: "minecraft:overworld",
	containsBlock: () => false,
	spawnEntity: (id: string, loc: { x: number; y: number; z: number }) => {
		const e = new FakeEntity(id, loc);
		spawned.push(e);
		return e;
	},
} as unknown as SpawnContext["dimension"];

/** Contexto que satisfaz a condição de uma entrada (quando dá para montar só com os campos simples). */
function ctxFor(entry: SpawnEntry, x = 100, z = 100): SpawnContext {
	const c = entry.condition;
	const y = Math.max(c.minY ?? 64, Math.min(c.maxY ?? 64, 64));
	return {
		dimension: overworld,
		location: { x: x + 0.5, y: y + 1, z: z + 0.5 },
		blockY: y,
		positionType: entry.positionType,
		biome: c.biomes?.[0] ?? "plains",
		baseBlock: c.neededBaseBlocks?.[0] ?? (entry.positionType === "submerged" || entry.positionType === "surface" ? "minecraft:water" : "minecraft:grass_block"),
		skyLight: Math.max(c.minSkyLight ?? 15, Math.min(c.maxSkyLight ?? 15, 15)),
		light: Math.max(c.minLight ?? 15, Math.min(c.maxLight ?? 15, 15)),
		canSeeSky: c.canSeeSky ?? true,
		isRaining: c.isRaining ?? false,
		isThundering: c.isThundering ?? false,
		fluid: c.fluid ?? (entry.positionType === "grounded" ? undefined : "water"),
	};
}

function simple(entry: SpawnEntry): boolean {
	const c = entry.condition;
	return !c.timeRange && c.moonPhase === undefined && !c.structures && !c.neededNearbyBlocks && !c.isPokeSnack && !c.isSlimeChunk && c.minX === undefined;
}

// ---------------------------------------------------------------------------------------------
// 1. Importador: herds, Alfas e config de buckets do 1.8.2

const herds = SPAWNS.filter(e => e.type === "pokemon-herd");
assert.ok(herds.length > 1500, `esperava 1500+ herds importados, veio ${herds.length}`);
assert.ok(herds.every(h => h.herd && h.herd.members.length > 0 && h.herd.maxHerdSize > 0), "todo herd precisa de membros");
assert.ok(herds.some(h => h.herd!.members.some(m => m.isLeader && m.isFollower === false)), "herds com líder exclusivo");
const alphaHerds = herds.filter(h => h.herd!.members.some(m => m.alpha));
assert.ok(alphaHerds.length > 800, `esperava 800+ herds com Alfa, veio ${alphaHerds.length}`);
assert.ok(alphaHerds.every(h => h.bucket === "boss"), "herds de Alfa ficam no bucket boss");
for (const h of herds) for (const m of h.herd!.members) {
	assert.ok(getSpeciesData(m.species), `membro de herd sem espécie: ${m.species} (${h.id})`);
	if (m.levelRangeOffset) assert.ok(m.levelRangeOffset[0] <= m.levelRangeOffset[1]);
}
const rhyperior = SPAWNS.find(e => e.id === "rhyperior-alpha-1");
assert.ok(rhyperior?.herd, "rhyperior-alpha-1 deve existir");
const rhyLeader = rhyperior!.herd!.members.find(m => m.isLeader)!;
assert.equal(rhyLeader.species, "rhyperior");
assert.equal(rhyLeader.alpha, true);
assert.equal(rhyLeader.heldItem, "cobblemon:ground_gem");
assert.deepEqual(rhyperior!.herd!.members.find(m => m.species === "rhyhorn")!.levelRangeOffset, [-3, 3]);
assert.ok(rhyperior!.weightMultipliers.some(m => m.multiplier === 0.25 && m.condition?.timeRange === "night"));
// Anticondições dos presets ficam separadas (natural: farmland; entrada: bioma frio).
assert.ok((rhyperior!.anticonditions?.length ?? 0) >= 2, "anticondição do preset deve ser separada da da entrada");
assert.deepEqual(BEST_SPAWNER_CONFIG.worldBuckets, { common: 94, uncommon: 5, rare: 0.5, "ultra-rare": 0.2, boss: 0.3 });
assert.equal(BEST_SPAWNER_CONFIG.fishingBuckets.common, 83.25);
assert.ok(SPAWNS.some(e => e.condition.fluid === "water"), "preset water vira condição fluid");

// ---------------------------------------------------------------------------------------------
// 2. Herds spawnam em grupo (líder primeiro, maxTimes, maxHerdSize, faixa de nível)

const herdCandidates = herds.filter(h => h.positionType === "grounded" && simple(h) && h.herd!.maxHerdSize >= 4);
assert.ok(herdCandidates.length > 50);
let groupsChecked = 0;
for (const herd of herdCandidates.slice(0, 40)) {
	const positions = Array.from({ length: 20 }, (_, i) => ctxFor(herd, 100 + (i % 5) * 1.5, 100 + Math.floor(i / 5) * 1.5));
	if (!positions.every(p => entryAllowed(herd, p))) continue;
	const actions = selectSpawnActions(positions, {
		buckets: { [herd.bucket]: 1 }, poolBuckets: [herd.bucket], maxSpawns: 8, filter: e => e === herd,
	});
	assert.ok(actions.length >= 2, `${herd.id}: herd deveria gerar grupo, gerou ${actions.length}`);
	assert.ok(actions.length <= herd.herd!.maxHerdSize, `${herd.id}: passou de maxHerdSize`);
	assert.equal(new Set(actions.map(a => a.herdGroup)).size, 1, "todos do mesmo grupo");
	const counts = new Map<unknown, number>();
	for (const a of actions) counts.set(a.herdMember, (counts.get(a.herdMember) ?? 0) + 1);
	for (const [m, n] of counts) assert.ok(n <= (m as any).maxTimes, `${herd.id}: maxTimes excedido`);
	// Líder primeiro; membros só-líder (isFollower false) não reaparecem como seguidores.
	if (herd.herd!.members.some(m => m.isLeader)) {
		assert.ok(actions[0].herdMember!.isLeader, `${herd.id}: o líder vem primeiro`);
		const onlyLeaders = actions.filter(a => a.herdMember!.isLeader && a.herdMember!.isFollower === false);
		assert.ok(onlyLeaders.length <= 1, `${herd.id}: um líder só`);
	}
	for (const a of actions) {
		assert.ok(a.levelRange[0] <= a.levelRange[1]);
		if (!a.herdMember!.levelRangeOffset) assert.equal(a.levelRange[0], a.levelRange[1], "sem offset o membro usa o nível do herd");
	}
	// Posições diferentes (minDistanceBetweenSpawns = 1).
	assert.equal(new Set(actions.map(a => a.ctx)).size, actions.length);
	groupsChecked++;
}
assert.ok(groupsChecked >= 10, `poucos herds testados (${groupsChecked})`);

// Herd de ponta a ponta: entidades com o mesmo grupo e um líder marcado.
{
	const herd = herdCandidates.find(h => h.herd!.members.some(m => m.isLeader) && h.herd!.members.every(m => (m.isLeader === true) !== (m.isFollower !== false)) && entryAllowed(h, ctxFor(h)))!;
	const positions = Array.from({ length: 20 }, (_, i) => ctxFor(herd, 200 + (i % 5) * 2, 200 + Math.floor(i / 5) * 2));
	spawned.length = 0;
	const entities = spawnFromPool({ positions, buckets: { [herd.bucket]: 1 }, maxSpawns: 8, filter: e => e === herd }) as unknown as FakeEntity[];
	assert.ok(entities.length >= 2, `herd ${herd.id} deveria criar 2+ entidades, criou ${entities.length}`);
	assert.equal(new Set(entities.map(e => e.getDynamicProperty(HERD_GROUP_PROPERTY))).size, 1);
	assert.equal(entities.filter(e => e.getDynamicProperty(HERD_LEADER_PROPERTY) === true).length, 1);
	for (const e of entities) {
		assert.equal(e.getProperty("cobblemon:wild"), true);
		assert.ok(typeof e.getDynamicProperty(SPAWN_TIME_PROPERTY) === "number", "hora do spawn gravada");
		assert.ok(typeof e.getDynamicProperty("data") === "string");
	}
}

// ---------------------------------------------------------------------------------------------
// 3. Alfa: aspect, marca, moveset "alpha", item e escala

{
	const herd = alphaHerds.find(h => h.positionType === "grounded" && simple(h) && entryAllowed(h, ctxFor(h)))!;
	assert.ok(herd, "precisa de um herd de Alfa testável");
	const positions = Array.from({ length: 12 }, (_, i) => ctxFor(herd, 300 + i * 2, 300));
	const actions = selectSpawnActions(positions, { buckets: { boss: 1 }, poolBuckets: ["boss"], maxSpawns: 8, filter: e => e === herd });
	const leader = actions.find(a => a.alpha)!;
	assert.ok(leader, `${herd.id}: o líder Alfa deve sair`);
	assert.ok(leader.heldItem?.endsWith("_gem"), "Alfa segura a gema do tipo");
	const data = createPokemonForAction(leader);
	assert.ok(data.aspects.includes("alpha"), "aspect alpha");
	assert.ok(data.aspects.includes("alpha_eyes"), "aspect da marca mark_alpha");
	assert.ok(data.marks.includes("cobblemon:mark_alpha"));
	assert.equal(data.activeMark, "cobblemon:mark_alpha");
	assert.equal(data.minecraftItem, leader.heldItem);
	assert.ok(data.moves.length > 0);
	spawned.length = 0;
	const entities = spawnFromPool({ positions, buckets: { boss: 1 }, maxSpawns: 8, filter: e => e === herd }) as unknown as FakeEntity[];
	const alphaEntity = entities.find(e => e.tags.has("cobblemon_alpha"));
	assert.ok(alphaEntity, "entidade Alfa recebe a tag cobblemon_alpha");
	assert.ok(JSON.parse(alphaEntity!.getDynamicProperty("data") as string).aspects.includes("alpha"));
	// Escala: 1.1 + 0.8 × 0.5^tamanho (tamanho limitado a 0.25..5).
	assert.ok(Math.abs(alphaScaleMultiplier({ width: 1, height: 1 }, 1) - 1.5) < 1e-9);
	assert.ok(Math.abs(alphaScaleMultiplier({ width: 20, height: 20 }, 1) - (1.1 + 0.8 / 32)) < 1e-9);
	assert.ok(Math.abs(alphaScaleMultiplier({ width: 0.1, height: 0.1 }, 1) - (1.1 + 0.8 * Math.pow(0.5, 0.25))) < 1e-9);
}

// ---------------------------------------------------------------------------------------------
// 4. Buckets: distribuição pelos pesos do 1.8.2; bucket sem candidato não re-sorteia

{
	const N = 200000;
	const counts: Record<string, number> = {};
	let seed = 12345;
	const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
	for (let i = 0; i < N; i++) {
		const b = chooseBucket(BEST_SPAWNER_CONFIG.worldBuckets, [], ["common", "uncommon", "rare", "ultra-rare", "boss"], rnd);
		counts[b] = (counts[b] ?? 0) + 1;
	}
	const total = Object.values(BEST_SPAWNER_CONFIG.worldBuckets).reduce((a, b) => a + b, 0);
	for (const [bucket, weight] of Object.entries(BEST_SPAWNER_CONFIG.worldBuckets)) {
		const expected = weight / total;
		const got = (counts[bucket] ?? 0) / N;
		assert.ok(Math.abs(got - expected) < Math.max(0.004, expected * 0.25), `bucket ${bucket}: esperado ${expected}, veio ${got}`);
	}
	// Só buckets do pool entram no sorteio.
	for (let i = 0; i < 1000; i++) assert.notEqual(chooseBucket(BEST_SPAWNER_CONFIG.worldBuckets, [], ["common", "rare"]), "boss");
	// Normalização (Lure 3): raros ficam mais prováveis.
	const w: Record<string, number> = { ...BEST_SPAWNER_CONFIG.fishingBuckets };
	bucketNormalizingInfluence(3).affectBucketWeights!(w);
	assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 1e-6);
	assert.ok(w["ultra-rare"] > BEST_SPAWNER_CONFIG.fishingBuckets["ultra-rare"]);

	// Bucket escolhido sem entrada na posição → nenhum spawn (sem re-sortear).
	const onlyCommon = SPAWNS.find(e => e.type === "pokemon" && e.bucket === "common" && e.positionType === "grounded" && simple(e) && entryAllowed(e, ctxFor(e)))!;
	let spawnedCount = 0;
	for (let i = 0; i < 400; i++) {
		const acts = selectSpawnActions([ctxFor(onlyCommon)], { buckets: { common: 50, rare: 50 }, poolBuckets: ["common", "rare"], filter: e => e === onlyCommon });
		spawnedCount += acts.length;
	}
	assert.ok(spawnedCount > 120 && spawnedCount < 280, `metade dos passes deveria falhar no bucket raro, spawnaram ${spawnedCount}/400`);

	// weightedPick respeita os pesos.
	let heavy = 0;
	for (let i = 0; i < 10000; i++) if (weightedPick(["a", "b"], x => (x === "a" ? 9 : 1)) === "a") heavy++;
	assert.ok(heavy > 8700 && heavy < 9300);
}

// weightMultipliers: condição → multiplica; anticondições: basta uma.
{
	const entry = rhyperior!;
	const ctx = ctxFor(entry);
	worldClock.timeOfDay = () => 6000;
	assert.equal(baseWeight(entry, ctx), entry.weight);
	worldClock.timeOfDay = () => 18000;
	assert.equal(baseWeight(entry, ctx), entry.weight * 0.25);
	worldClock.timeOfDay = () => 6000;
	const farmland = { ...ctx, baseBlock: "minecraft:farmland" };
	assert.ok(!entryAllowed(entry, farmland), "anticondição do preset natural (farmland) bloqueia sozinha");
}

// ---------------------------------------------------------------------------------------------
// 5. Pesca

{
	const fishing = SPAWNS.filter(e => e.positionType === "fishing");
	assert.ok(fishing.length > 400, `entradas de pesca: ${fishing.length}`);
	const base: SpawnContext = {
		dimension: overworld, location: { x: 0.5, y: 63, z: 0.5 }, blockY: 62, positionType: "fishing", biome: "river",
		baseBlock: "minecraft:water", skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false, fluid: "water",
	};
	const seen = new Map<string, number>();
	let water = 0, total = 0;
	for (let i = 0; i < 1500; i++) {
		const action = chooseFishingSpawn(base, { rodType: "cobblemon:poke_rod", lureLevel: 0 });
		if (!action) continue;
		assert.equal(action.entry.positionType, "fishing");
		assert.ok(!action.entry.condition.rodType, "sem a vara certa não sai entrada de rodType");
		total++;
		seen.set(action.species, (seen.get(action.species) ?? 0) + 1);
		const s = getSpeciesData(action.species)!;
		if (s.primaryType === ("water" as any) || s.secondaryType === ("water" as any)) water++;
	}
	assert.ok(total > 1000, `pesca no rio deveria quase sempre ter algo (${total}/1500)`);
	assert.ok(seen.size >= 3, `variedade na pesca: ${[...seen.keys()]}`);
	assert.ok(water / total > 0.8, `pesca deveria dar Pokémon de água (${water}/${total})`);

	const rodEntry = fishing.find(e => e.condition.rodType);
	assert.ok(rodEntry, "entradas com rodType (Love/Master Rod) devem ser importadas");
	{
		const ctx = { ...ctxFor(rodEntry!), positionType: "fishing" };
		const lure = { lureLevel: 5 };
		assert.ok(!entryAllowed(rodEntry!, { ...ctx, fishing: { ...lure, rodType: "cobblemon:poke_rod", bait: rodEntry!.condition.bait } }));
		assert.ok(entryAllowed(rodEntry!, { ...ctx, fishing: { ...lure, rodType: rodEntry!.condition.rodType, bait: rodEntry!.condition.bait } }), `${rodEntry!.id} com a vara certa`);
	}
	const lureEntry = fishing.find(e => e.condition.minLureLevel !== undefined && !e.condition.rodType && simple(e));
	assert.ok(lureEntry, "entradas com minLureLevel devem ser importadas");
	{
		const ctx = { ...ctxFor(lureEntry!), positionType: "fishing" };
		assert.ok(!entryAllowed(lureEntry!, { ...ctx, fishing: { lureLevel: 0 } }), "sem Lure não passa em minLureLevel");
		assert.ok(entryAllowed(lureEntry!, { ...ctx, fishing: { lureLevel: lureEntry!.condition.minLureLevel } }), `${lureEntry!.id} com Lure`);
	}
	// Campos de pesca não valem fora de posições de pesca.
	assert.ok(conditionMatches({ minLureLevel: 3 }, { ...base, positionType: "grounded" }));
}

// ---------------------------------------------------------------------------------------------
// 6. Despawn (CobblemonAgingDespawner)

{
	const s: DespawnSettings = { despawnerNearDistance: 32, despawnerFarDistance: 96, despawnerMinAgeTicks: 600, despawnerMaxAgeTicks: 3600 };
	assert.equal(shouldDespawn(100, 200, s), false, "jovem demais");
	assert.equal(shouldDespawn(5000, 10, s), false, "jogador perto");
	assert.equal(shouldDespawn(700, 100, s), true, "longe demais");
	assert.equal(shouldDespawn(4000, 40, s), true, "velho demais");
	// Meio do caminho (64 blocos → razão 0.5 → idade máx. 1500).
	assert.equal(shouldDespawn(1400, 64, s), false);
	assert.equal(shouldDespawn(1600, 64, s), true);

	const wild = (over: (e: FakeEntity) => void = () => { }) => {
		const e = new FakeEntity("cobblemon:pikachu", { x: 0, y: 64, z: 0 });
		e.setProperty("cobblemon:wild", true);
		e.setDynamicProperty(SPAWN_TIME_PROPERTY, 0);
		over(e);
		return e;
	};
	const far = [{ x: 500, y: 64, z: 0 }];
	assert.equal(evaluateDespawn(wild() as any, far, 1000, s), "despawn");
	assert.equal(evaluateDespawn(wild() as any, [{ x: 10, y: 64, z: 0 }], 1000, s), "keep");
	assert.equal(evaluateDespawn(wild() as any, far, 100, s), "keep", "idade abaixo do mínimo");
	assert.equal(evaluateDespawn(wild(e => e.setProperty("cobblemon:in_battle", true)) as any, far, 9999, s), "skip");
	assert.equal(evaluateDespawn(wild(e => e.setDynamicProperty("in_battle", "abc")) as any, far, 9999, s), "skip");
	assert.equal(evaluateDespawn(wild(e => e.setProperty("cobblemon:busy", true)) as any, far, 9999, s), "skip");
	assert.equal(evaluateDespawn(wild(e => e.setProperty("cobblemon:wild", false)) as any, far, 9999, s), "skip", "com dono");
	assert.equal(evaluateDespawn(wild(e => { e.components.riding = {}; }) as any, far, 9999, s), "skip", "montado");
	assert.equal(evaluateDespawn(wild(e => { e.components.inventory = { container: { getItem: () => ({ typeId: "cobblemon:ground_gem" }) } }; }) as any, far, 9999, s), "skip", "segurando item");
	assert.equal(evaluateDespawn(wild(e => { e.components.inventory = { container: { getItem: () => undefined } }; }) as any, far, 9999, s), "despawn");
	assert.equal(evaluateDespawn(wild(e => e.setDynamicProperty(MOUTH_ITEM_PROPERTY, "minecraft:diamond")) as any, far, 9999, s), "skip", "item na boca");
	assert.equal(MOUTH_ITEM_PROPERTY, "cobblemon:mouth_item");
	const fresh = wild(e => e.setDynamicProperty(SPAWN_TIME_PROPERTY, undefined));
	assert.equal(evaluateDespawn(fresh as any, far, 5000, s), "keep", "sem hora de spawn começa a envelhecer agora");
	assert.equal(fresh.getDynamicProperty(SPAWN_TIME_PROPERTY), 5000);
	assert.equal(evaluateDespawn(wild() as any, [], 1000, s), "despawn", "sem jogadores na dimensão");
}

// ---------------------------------------------------------------------------------------------
// 7. Nível: faixa do jogador (PlayerLevelRangeInfluence) e Alfas (AlphaLevelMatchingSensor)

{
	const cfg = { variation: 5, maxPokemonLevel: 100, minimumLevelRangeMax: 10 };
	assert.deepEqual(playerLevelRange([], cfg), [1, 10]);
	assert.deepEqual(playerLevelRange([3, 7], cfg), [2, 12]);
	assert.deepEqual(playerLevelRange([50], cfg), [45, 55]);
	assert.deepEqual(scaleLevelRange([10, 30], [20, 40]), [20, 30]);
	assert.deepEqual(scaleLevelRange([40, 60], [1, 10]), [40, 45], "spawn acima do jogador: 1º quarto da faixa");
	assert.deepEqual(scaleLevelRange([5, 25], [40, 50]), [20, 25], "spawn abaixo do jogador: último quarto");
	const influence = playerLevelRangeInfluence(() => [50], cfg);
	const action: any = { levelRange: [30, 60] };
	influence.affectAction!(action);
	assert.deepEqual(action.levelRange, [45, 55]);
	assert.equal(alphaTargetLevel(10), 14);
	assert.equal(alphaTargetLevel(25), 33);
	assert.equal(alphaTargetLevel(40), 52);
	assert.equal(alphaTargetLevel(60), 76);
	assert.equal(alphaTargetLevel(90), 100);
	assert.equal(alphaTargetLevel(5, 36), 36, "não abaixo do nível de evolução");
}

// ---------------------------------------------------------------------------------------------
// 8. Tempo, lua e slime chunk

assert.ok(timeInRange("night", 13000));
assert.ok(timeInRange("day", 23500) && timeInRange("day", 0) && !timeInRange("day", 13000));
assert.ok(timeInRange("morning", 23100) && timeInRange("evening", 15000) && timeInRange("predawn", 20000));
assert.ok(timeInRange("100-200,500-600", 550) && !timeInRange("100-200", 300));
assert.ok(TimeRanges.any.contains(0) && TimeRanges.any.contains(23999));
assert.ok(moonPhaseInRange("5-7", 6) && !moonPhaseInRange("5-7", 4));
assert.ok(moonPhaseInRange(0, 0) && moonPhaseInRange("0", 0) && moonPhaseInRange("full", 0) && moonPhaseInRange("crescent", 5));
{
	let slimes = 0;
	for (let x = -50; x < 50; x++) for (let z = -50; z < 50; z++) if (isSlimeChunk(x, z)) slimes++;
	assert.ok(slimes > 800 && slimes < 1200, `~10% de slime chunks, veio ${slimes}/10000`);
}

console.warn = originalWarn;
const spawnWarnings = warnings.filter(w => /Falha ao spawnar/.test(w));
assert.deepEqual(spawnWarnings, [], "spawns não devem falhar");
console.log(`ok: ${herds.length} herds (${alphaHerds.length} com Alfa), ${groupsChecked} grupos conferidos, pesca, despawn e níveis`);
