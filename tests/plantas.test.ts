// Frente "mundo-plantas": crescimento/colheita de berries (mulch, rendimento, mutações), cultivos,
// minerais que crescem, saccharine e formato de escadas, com os dados reais do Cobblemon 1.8.2
// (generated/scripts/items.ts) e um mundo de blocos falso.
import assert from "node:assert/strict";
import { ITEMS } from "../generated/scripts/items";
import {
	BerryBushComponent, BerryData, BushContext, calculateYield, canApplyMulch, createRecord, determineMutation, FRUIT_AGE, getBerry, growHelper,
	harvest, MATURE_AGE, mutationCandidates, processTick, setMulch,
} from "../scripts/custom_components/plants/berry";
import {
	computeStairShape, gateInWall, isWall, slabMerges, stairInfo, StairInfo,
} from "../scripts/custom_components/plants/building";
import { clock, Dir4, drops, memoryBackend, OFFSETS, rng, setStoreBackend } from "../scripts/custom_components/plants/common";
import {
	canMutateRevivalHerb, CROP_RULES, cropBoneMeal, cropRandomTick, GalaricaNutBushComponent, growthSpeed, HeartyGrainsComponent, heartyCanGrow, SoilInfo,
} from "../scripts/custom_components/plants/crops";
import { clusterOfGemBlock, clusterStep, gemBlockOfCluster, hasHeatSource, TUMBLESTONE_NEXT } from "../scripts/custom_components/plants/gems";
import { mulchVariantOf } from "../scripts/custom_components/plants/mulch";
import { hasLogWithin, honeyDripTarget, leafDistance } from "../scripts/custom_components/plants/saccharine";
import { PLANT_BLOCK_COMPONENTS, PLANT_ITEM_COMPONENTS } from "../scripts/custom_components/plants";
import { BLOCK_COMPONENTS } from "../generated/scripts/blockBehaviours";

// ---------------------------------------------------------------------------------------------
// Aleatoriedade controlada

/** Gerador determinístico (LCG) para as simulações. */
function seeded(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}
function withRng<T>(source: () => number, fn: () => T): T {
	const previous = rng.next;
	rng.next = source;
	try { return fn(); } finally { rng.next = previous; }
}
const always = (value: number) => () => value;

// ---------------------------------------------------------------------------------------------
// Mundo falso

type States = Record<string, string | number | boolean>;
class FakePermutation {
	constructor(public id: string, public states: States) { }
	get type() { return { id: this.id }; }
	getState(key: string) { return this.states[key]; }
	withState(key: string, value: string | number | boolean) { return new FakePermutation(this.id, { ...this.states, [key]: value }); }
	getAllStates() { return { ...this.states }; }
}
const spawned: Array<{ typeId: string; count: number }> = [];
class FakeDimension {
	id = "minecraft:overworld";
	blocks = new Map<string, FakePermutation>();
	light = 15;
	biome = "minecraft:plains";
	commands: string[] = [];
	key(l: { x: number; y: number; z: number }) { return `${l.x},${l.y},${l.z}`; }
	set(l: { x: number; y: number; z: number }, id: string, states: States = {}) { this.blocks.set(this.key(l), new FakePermutation(id, states)); }
	getBlock(l: { x: number; y: number; z: number }) { return new FakeBlock(this, { x: l.x, y: l.y, z: l.z }); }
	getLightLevel() { return this.light; }
	getBiome() { return { id: this.biome }; }
	spawnParticle() { }
	playSound() { }
	spawnItem() { }
	runCommand(command: string) { this.commands.push(command); }
}
class FakeBlock {
	constructor(public dimension: FakeDimension, public location: { x: number; y: number; z: number }) { }
	get permutation() { return this.dimension.blocks.get(this.dimension.key(this.location)) ?? new FakePermutation("minecraft:air", {}); }
	get typeId() { return this.permutation.id; }
	get isWaterlogged() { return false; }
	setPermutation(p: FakePermutation) { this.dimension.blocks.set(this.dimension.key(this.location), p); }
	setType(id: string) { this.dimension.set(this.location, id); }
	hasTag() { return false; }
}
class FakePlayer {
	constructor(public dimension: FakeDimension, public item?: { typeId: string; amount: number }) { }
	selectedSlotIndex = 0;
	location = { x: 0, y: 0, z: 0 };
	isSneaking = false;
	getGameMode() { return "Survival"; }
	getComponent() {
		const self = this;
		return {
			container: {
				getItem: () => (self.item && self.item.amount > 0 ? { ...self.item, hasTag: () => false, getComponent: () => undefined } : undefined),
				setItem: (_slot: number, item?: { typeId: string; amount: number }) => { self.item = item ? { typeId: item.typeId, amount: item.amount } : undefined; },
				addItem: () => undefined,
			},
		};
	}
}
drops.spawn = (_dimension, _location, typeId, count) => { spawned.push({ typeId, count }); };
const backend = memoryBackend();
setStoreBackend(backend);
const asAny = (x: unknown) => x as any;

// ---------------------------------------------------------------------------------------------
// 1. Registro: todos os componentes pendentes da frente estão registrados

const MACHINE_ONLY = new Set(["cobblemon:campfire", "cobblemon:campfire_pot", "cobblemon:disc_shelf", "cobblemon:display_case", "cobblemon:fossil_analyzer",
	"cobblemon:fossil_monitor", "cobblemon:gilded_chest", "cobblemon:lectern", "cobblemon:pasture", "cobblemon:poke_snack", "cobblemon:restoration_tank",
	"cobblemon:tm_machine",
	// Ferramenta de criativo do 1.8.2 (habitat_pools); ainda sem script, fica pendente em blockBehaviours.ts.
	"cobblemon:habitat_block"]);
for (const name of Object.keys(BLOCK_COMPONENTS)) {
	if (MACHINE_ONLY.has(name)) continue;
	assert.ok(PLANT_BLOCK_COMPONENTS[name], `componente pendente sem registro: ${name}`);
}
for (const name of Object.keys(PLANT_BLOCK_COMPONENTS)) assert.ok(name.startsWith("cobblemon:"), name);
assert.ok(PLANT_ITEM_COMPONENTS["cobblemon:mulch"], "cobblemon:mulch registrado");
assert.equal(mulchVariantOf("cobblemon:rich_mulch"), "rich");
assert.equal(mulchVariantOf("cobblemon:mulch_base"), undefined);

// ---------------------------------------------------------------------------------------------
// 2. Dados das berries e tabela de mutações

const berryIds = Object.entries(ITEMS).filter(([, d]) => d.category === "berry" && d.berry).map(([id]) => `cobblemon:${id}`);
assert.equal(berryIds.length, 70, "70 berries com dados de arbusto");
let mutationEntries = 0;
for (const id of berryIds) {
	const berry = getBerry(id)!;
	assert.ok(berry.growthPoints >= 4 && berry.growthPoints <= 10, `${id}: growthPoints ${berry.growthPoints}`);
	assert.ok(berry.baseYield.min >= 1 && berry.baseYield.max >= berry.baseYield.min, `${id}: baseYield`);
	for (const [partner, result] of Object.entries(berry.mutations)) {
		mutationEntries++;
		assert.ok(getBerry(result), `${id}+${partner}: mutação para berry inexistente ${result}`);
		// A tabela do Cobblemon é simétrica: A+B = B+A.
		assert.equal(getBerry(partner)?.mutations[id], result, `${id}+${partner} não é simétrica`);
	}
}
assert.equal(mutationEntries, 154, "entradas de mutação do Cobblemon 1.8.2");
const oran = getBerry("cobblemon:oran_berry")!;
assert.deepEqual(mutationCandidates(oran, ["cobblemon:pecha_berry"]), ["cobblemon:lum_berry"]);
assert.deepEqual(mutationCandidates(oran, ["cobblemon:pecha_berry", "cobblemon:cheri_berry", "cobblemon:razz_berry"]).sort(), ["cobblemon:leppa_berry", "cobblemon:lum_berry"]);
assert.deepEqual(mutationCandidates(oran, ["cobblemon:oran_berry", "cobblemon:figy_berry"]), []);

// Mutação: 12,5% sem mulch, 50% com surprise mulch (que gasta uma carga), troca um ponto.
function mutationRate(mulch: "none" | "surprise"): number {
	let hits = 0;
	const trials = 20000;
	withRng(seeded(7), () => {
		for (let i = 0; i < trials; i++) {
			const ctx = createRecord(oran, MATURE_AGE, mulch);
			ctx.rec.points = new Array(5).fill(oran.id);
			if (determineMutation(ctx, { inPreferredBiome: false, neighbourBerries: ["cobblemon:pecha_berry"] })) {
				hits++;
				assert.equal(ctx.rec.points.filter((p) => p === "cobblemon:lum_berry").length, 1);
			}
			if (mulch === "surprise") assert.equal(ctx.rec.mulchDuration, 2, "surprise mulch gasta 1 de 3");
		}
	});
	return hits / trials;
}
assert.ok(Math.abs(mutationRate("none") - 0.125) < 0.01, "12,5% de mutação");
assert.ok(Math.abs(mutationRate("surprise") - 0.5) < 0.015, "50% com surprise mulch");

// ---------------------------------------------------------------------------------------------
// 3. Rendimento por mulch/bioma (Berry.calculateYield)

function yieldRange(berry: BerryData, mulch: BushContext["mulch"], inPreferredBiome: boolean): [number, number] {
	let min = Infinity, max = -Infinity;
	withRng(seeded(11), () => {
		for (let i = 0; i < 4000; i++) {
			const ctx = createRecord(berry, MATURE_AGE, mulch);
			const value = calculateYield(ctx, { inPreferredBiome, neighbourBerries: [] });
			min = Math.min(min, value);
			max = Math.max(max, value);
		}
	});
	return [min, max];
}
// oran: baseYield 2..3, fator preferred_biome +0..1, mulches favoritos peat/loamy, 10 pontos.
assert.deepEqual(yieldRange(oran, "none", false), [2, 3]);
assert.deepEqual(yieldRange(oran, "none", true), [2, 4]);
assert.deepEqual(yieldRange(oran, "peat", false), [2, 4], "mulch favorito vale como o bioma preferido");
assert.deepEqual(yieldRange(oran, "sandy", false), [2, 3], "mulch que não é favorito não soma");
assert.deepEqual(yieldRange(oran, "rich", false), [3, 5], "rich mulch +1..2");
assert.deepEqual(yieldRange(oran, "rich", true), [3, 6]);
// Teto: pontos de crescimento do modelo.
const tiny: BerryData = { ...oran, id: "cobblemon:oran_berry", growthPoints: 3 };
assert.deepEqual(yieldRange(tiny, "rich", true), [3, 3]);
// Rich mulch dura 5 colheitas.
{
	const ctx = createRecord(oran, MATURE_AGE, "none");
	setMulch(ctx, "rich");
	for (let i = 0; i < 5; i++) {
		assert.equal(ctx.mulch, "rich");
		calculateYield(ctx, { inPreferredBiome: false, neighbourBerries: [] });
	}
	assert.equal(ctx.mulch, "none", "rich mulch acaba depois de 5 usos");
}

// ---------------------------------------------------------------------------------------------
// 4. Progressão do crescimento (timers com compensação de tempo)

function simulateGrowth(berry: BerryData, mulch: BushContext["mulch"], seed: number) {
	return withRng(seeded(seed), () => {
		const ctx = createRecord(berry, 0, "none");
		if (mulch !== "none") setMulch(ctx, mulch);
		let now = 1000;
		const ages = [ctx.age];
		let ticks = 0;
		// Random tick a cada ~68 s (média do Bedrock), com jitter.
		while (ctx.age < FRUIT_AGE && ticks < 100000) {
			now += 1000 + Math.floor(rng.next() * 1700);
			ticks++;
			if (processTick(ctx, now) && growHelper(ctx, { inPreferredBiome: false, neighbourBerries: [] })) ages.push(ctx.age);
		}
		return { ctx, ages, elapsed: now - 1000 };
	});
}
{
	const { ctx, ages, elapsed } = simulateGrowth(oran, "none", 3);
	assert.deepEqual(ages, [0, 1, 2, 3, 4, 5], "passa por todas as idades, uma de cada vez");
	assert.ok(ctx.rec.points.length >= 2 && ctx.rec.points.length <= 3, "colheita gerada em 3→4");
	// growthTime do oran 36..44 min × 1,4 → 50..61 min; o ciclo inteiro fica abaixo disso (+ granularidade).
	const minutes = elapsed / 1200;
	assert.ok(minutes > 20 && minutes < 64, `ciclo de ${minutes.toFixed(1)} min`);
	// Colher: volta para 3, drops = pontos.
	const counts = harvest(ctx);
	assert.equal(ctx.age, MATURE_AGE);
	assert.equal([...counts.values()].reduce((a, b) => a + b, 0), ctx.rec.points.length);
	assert.ok(ctx.rec.stageTimer > 0, "timers de refreshRate");
}
{
	// Growth mulch: metade do tempo.
	let normal = 0, fast = 0;
	for (let seed = 1; seed <= 20; seed++) {
		normal += simulateGrowth(oran, "none", seed).elapsed;
		fast += simulateGrowth(oran, "growth", seed).elapsed;
	}
	const ratio = fast / normal;
	assert.ok(ratio > 0.4 && ratio < 0.65, `growth mulch acelera (${ratio.toFixed(2)})`);
}
{
	// Farinha de osso: sucesso com boneMealChance.
	const ctx = createRecord(oran, 0, "none");
	assert.equal(withRng(always(0.99), () => growHelper(ctx, { inPreferredBiome: false, neighbourBerries: [] }, true)), false);
	assert.equal(withRng(always(0.1), () => growHelper(ctx, { inPreferredBiome: false, neighbourBerries: [] }, true)), true);
	assert.equal(ctx.age, 1);
}
{
	// Mulch só em solo arado (ou raiz presa), sem mulch anterior e antes de florir.
	const ctx = createRecord(oran, 2, "none");
	assert.equal(canApplyMulch(ctx, true), true);
	assert.equal(canApplyMulch(ctx, false), false);
	ctx.age = 4;
	assert.equal(canApplyMulch(ctx, true), false);
	const growing = createRecord(oran, 1, "none");
	const before = growing.rec.stageTimer;
	setMulch(growing, "growth");
	assert.equal(growing.rec.stageTimer, Math.trunc(before * 0.5), "growth mulch corta o timer atual");
	assert.equal(growing.rec.mulchDuration, 5);
}

// Componente completo no mundo falso: plantar, crescer, colher.
{
	const dim = new FakeDimension();
	const pos = { x: 0, y: 64, z: 0 };
	dim.set({ x: 0, y: 63, z: 0 }, "minecraft:farmland", { moisturized_amount: 7 });
	dim.set(pos, "cobblemon:oran_berry", { "cobblemon:age": 0, "cobblemon:rooted": false, "cobblemon:mulch": "none" });
	dim.set({ x: 1, y: 64, z: 0 }, "cobblemon:pecha_berry", { "cobblemon:age": 5, "cobblemon:rooted": false, "cobblemon:mulch": "none" });
	const block = dim.getBlock(pos);
	const component = new BerryBushComponent();
	component.onPlace(asAny({ block, dimension: dim }));
	assert.equal(backend.data.size, 1, "registro criado ao plantar");
	// Mulch pelo item.
	const player = new FakePlayer(dim, { typeId: "cobblemon:growth_mulch", amount: 2 });
	component.onPlayerInteract(asAny({ block, dimension: dim, player }));
	assert.equal(block.permutation.getState("cobblemon:mulch"), "growth");
	assert.equal(player.item?.amount, 1, "mulch consumido");
	let now = 10;
	clock.now = () => now;
	withRng(seeded(5), () => {
		for (let i = 0; i < 5000 && block.permutation.getState("cobblemon:age") !== 5; i++) {
			now += 1400;
			component.onRandomTick(asAny({ block, dimension: dim }));
		}
	});
	assert.equal(block.permutation.getState("cobblemon:age"), 5, "arbusto amadurece por random tick");
	spawned.length = 0;
	const hand = new FakePlayer(dim);
	component.onPlayerInteract(asAny({ block, dimension: dim, player: hand }));
	assert.equal(block.permutation.getState("cobblemon:age"), 3, "colheita volta para 3");
	const total = spawned.reduce((a, s) => a + s.count, 0);
	assert.ok(total >= 2 && total <= 4, `colheu ${total} berries`);
	assert.ok(spawned.every((s) => s.typeId === "cobblemon:oran_berry" || s.typeId === "cobblemon:lum_berry"));
	// Pá tira o mulch (se ainda houver).
	dim.set(pos, "cobblemon:oran_berry", { ...block.permutation.getAllStates(), "cobblemon:mulch": "peat" });
	component.onPlayerInteract(asAny({ block, dimension: dim, player: { ...new FakePlayer(dim), getComponent: () => ({ container: { getItem: () => ({ typeId: "minecraft:iron_shovel", amount: 1, hasTag: (t: string) => t === "minecraft:is_shovel" }) } }), getGameMode: () => "Survival" } }));
	assert.equal(block.permutation.getState("cobblemon:mulch"), "none", "pá remove o mulch");
	clock.now = () => 0;
}

// ---------------------------------------------------------------------------------------------
// 5. Cultivos

{
	const block = asAny({});
	// Mint: luz ≥ 9 e 1/8.
	assert.equal(withRng(always(0), () => cropRandomTick(CROP_RULES.mint, 3, 8, block)), undefined, "sem luz não cresce");
	assert.equal(withRng(always(0), () => cropRandomTick(CROP_RULES.mint, 3, 9, block)), 4);
	assert.equal(withRng(always(0.5), () => cropRandomTick(CROP_RULES.mint, 3, 15, block)), undefined, "1 em 8");
	assert.equal(withRng(always(0), () => cropRandomTick(CROP_RULES.mint, 7, 15, block)), undefined, "maduro não cresce");
	// Medicinal leek ignora a luz; 1/4.
	assert.equal(withRng(always(0.2), () => cropRandomTick(CROP_RULES.medicinal_leek, 0, 0, block)), 1);
	assert.equal(withRng(always(0.3), () => cropRandomTick(CROP_RULES.medicinal_leek, 0, 0, block)), undefined);
	// Farinha de osso.
	assert.equal(cropBoneMeal(CROP_RULES.mint, 6), 7);
	assert.equal(cropBoneMeal(CROP_RULES.mint, 7), undefined);
	assert.equal(cropBoneMeal(CROP_RULES.vivichoke, 2), 3, "vivichoke: um estágio por vez");
	assert.equal(withRng(always(0.99), () => cropBoneMeal(CROP_RULES.revival_herb, 5)), 8, "revival herb: 2..5 limitado a 8");
	assert.equal(withRng(always(0), () => cropBoneMeal(CROP_RULES.revival_herb, 1)), 3);
	// Umidade do CropBlock vanilla.
	const moist: SoilInfo[][] = [0, 1, 2].map(() => [0, 1, 2].map(() => ({ farmland: true, moist: true })));
	assert.equal(growthSpeed(moist, false, false, false), 10);
	assert.equal(growthSpeed(moist, true, true, false), 5, "vizinhos iguais nos dois eixos dividem por 2");
	const dry: SoilInfo[][] = [0, 1, 2].map(() => [0, 1, 2].map(() => ({ farmland: false, moist: false })));
	assert.equal(growthSpeed(dry, false, false, false), 1);
	// Revival herb: só surprise mulch, até a idade 6, sem mutação.
	assert.equal(canMutateRevivalHerb(6, "none", "surprise"), true);
	assert.equal(canMutateRevivalHerb(7, "none", "surprise"), false);
	assert.equal(canMutateRevivalHerb(2, "power", "surprise"), false);
	assert.equal(canMutateRevivalHerb(2, "none", "rich"), false);
	// Hearty grains.
	assert.equal(heartyCanGrow(2, false), true);
	assert.equal(heartyCanGrow(3, false), false, "precisa de espaço acima para passar de 3");
	assert.equal(heartyCanGrow(3, true), true);
	assert.equal(heartyCanGrow(6, true), false);
}
{
	// Hearty grains no mundo: a partir da idade 4 aparece a metade de cima; quebrar em cima volta a 3.
	const dim = new FakeDimension();
	dim.set({ x: 0, y: 64, z: 0 }, "cobblemon:hearty_grains", { "cobblemon:age": 3, "cobblemon:half": "lower" });
	const lower = dim.getBlock({ x: 0, y: 64, z: 0 });
	const grains = new HeartyGrainsComponent();
	grains.grow(asAny(lower), 1);
	const upper = dim.getBlock({ x: 0, y: 65, z: 0 });
	assert.equal(upper.typeId, "cobblemon:hearty_grains");
	assert.equal(upper.permutation.getState("cobblemon:half"), "upper");
	assert.equal(upper.permutation.getState("cobblemon:age"), 4);
	grains.grow(asAny(lower), 5);
	assert.equal(lower.permutation.getState("cobblemon:age"), 6);
	assert.equal(upper.permutation.getState("cobblemon:age"), 6);
	const broken = upper.permutation;
	dim.set(upper.location, "minecraft:air");
	grains.onPlayerBreak(asAny({ block: upper, dimension: dim, brokenBlockPermutation: broken }));
	assert.equal(lower.permutation.getState("cobblemon:age"), 3);
}
{
	// Galarica: madura dá 1..2 nozes e volta à idade 1.
	const dim = new FakeDimension();
	dim.set({ x: 0, y: 64, z: 0 }, "cobblemon:galarica_nut_bush", { "cobblemon:age": 3 });
	const bush = dim.getBlock({ x: 0, y: 64, z: 0 });
	spawned.length = 0;
	new GalaricaNutBushComponent().onPlayerInteract(asAny({ block: bush, dimension: dim, player: new FakePlayer(dim) }));
	assert.equal(bush.permutation.getState("cobblemon:age"), 1);
	assert.equal(spawned[0]?.typeId, "cobblemon:galarica_nuts");
	assert.ok(spawned[0].count >= 1 && spawned[0].count <= 2);
}

// ---------------------------------------------------------------------------------------------
// 6. Minerais, saccharine e lajes

assert.equal(TUMBLESTONE_NEXT["cobblemon:small_budding_tumblestone"], "cobblemon:medium_budding_tumblestone");
assert.equal(TUMBLESTONE_NEXT["cobblemon:large_budding_sky_tumblestone"], "cobblemon:sky_tumblestone_cluster");
assert.equal(TUMBLESTONE_NEXT["cobblemon:tumblestone_cluster"], undefined, "cluster é o último estágio");
for (const [from, to] of Object.entries(TUMBLESTONE_NEXT)) {
	assert.ok(BLOCK_COMPONENTS["cobblemon:tumblestone"]?.blocks.includes(from) ?? PLANT_BLOCK_COMPONENTS["cobblemon:tumblestone"], from);
	assert.ok(to.startsWith("cobblemon:"), to);
}
assert.equal(hasHeatSource((l) => (l.y === 63 && l.x === 1 ? "minecraft:magma" : "minecraft:stone"), { x: 0, y: 64, z: 0 }), true);
assert.equal(hasHeatSource(() => "minecraft:stone", { x: 0, y: 64, z: 0 }), false);
assert.equal(gemBlockOfCluster("cobblemon:fire_gem_cluster"), "cobblemon:fire_gem_block");
assert.equal(clusterOfGemBlock("cobblemon:fairy_gem_block"), "cobblemon:fairy_gem_cluster");
assert.equal(clusterOfGemBlock("cobblemon:deepslate_crystal_core"), undefined);
assert.deepEqual(clusterStep("g", 1, true, false), { kind: "stage", stage: 2 });
assert.deepEqual(clusterStep("g", 3, true, false), { kind: "gem" });
assert.deepEqual(clusterStep("g", 3, true, true), { kind: "stunt" });
assert.deepEqual(clusterStep("s", 1, true, false), { kind: "none" }, "atrofiado não cresce");
assert.deepEqual(clusterStep(undefined, 1, true, false), { kind: "none" }, "decorativo não cresce");
assert.deepEqual(clusterStep("g", 1, false, false), { kind: "none" }, "sem suporte de gema não cresce");

assert.equal(leafDistance([0]), 1);
assert.equal(leafDistance([2, 3]), 3);
assert.equal(leafDistance([]), 4, "sem tora por perto: decai");
{
	// Antes de decair, confirma por busca que não há tora a até 3 folhas de distância.
	const dim = new FakeDimension();
	dim.set({ x: 0, y: 0, z: 0 }, "cobblemon:saccharine_log");
	for (let x = 1; x <= 5; x++) dim.set({ x, y: 0, z: 0 }, "cobblemon:saccharine_leaves");
	assert.equal(hasLogWithin(asAny(dim.getBlock({ x: 3, y: 0, z: 0 })), 3), true);
	assert.equal(hasLogWithin(asAny(dim.getBlock({ x: 5, y: 0, z: 0 })), 3), false);
}
const air = { typeId: "minecraft:air", age: 0 };
assert.equal(honeyDripTarget(2, [air, air, { typeId: "cobblemon:saccharine_leaves", age: 1 }]), 2);
assert.equal(honeyDripTarget(2, [air, { typeId: "minecraft:stone", age: 0 }]), undefined, "bloco sólido para o mel");
assert.equal(honeyDripTarget(1, [{ typeId: "cobblemon:saccharine_leaves", age: 2 }]), undefined, "folha de baixo já cheia");
assert.equal(honeyDripTarget(0, [{ typeId: "cobblemon:saccharine_leaves", age: 0 }]), undefined, "sem mel não escorre");

assert.equal(slabMerges("bottom", "up", undefined), true);
assert.equal(slabMerges("bottom", "north", 0.7), true);
assert.equal(slabMerges("bottom", "north", 0.3), false);
assert.equal(slabMerges("top", "down", undefined), true);
assert.equal(slabMerges("top", "up", undefined), false);

assert.equal(isWall("minecraft:cobblestone_wall"), true);
assert.equal(isWall("cobblemon:polished_tumblestone_wall"), true);
assert.equal(isWall("minecraft:oak_fence"), false);
assert.equal(gateInWall("north", (d) => d === "east"), true);
assert.equal(gateInWall("north", (d) => d === "north" || d === "south"), false, "muro na frente/atrás não conta");

// ---------------------------------------------------------------------------------------------
// 7. Formato das escadas (StairBlock.getStairsShape)

function shapeWith(self: StairInfo, around: Partial<Record<Dir4, StairInfo>>) {
	return computeStairShape(self, (dir) => around[dir]);
}
const N: StairInfo = { facing: "north", half: "bottom" };
assert.equal(shapeWith(N, {}), "straight");
assert.equal(shapeWith(N, { east: { facing: "north", half: "bottom" } }), "straight", "lado a lado continua reta");
// Escada da frente virada para o lado → canto externo.
assert.equal(shapeWith(N, { north: { facing: "east", half: "bottom" } }), "outer_right");
assert.equal(shapeWith(N, { north: { facing: "west", half: "bottom" } }), "outer_left");
// Escada de trás virada para o lado → canto interno.
assert.equal(shapeWith(N, { south: { facing: "west", half: "bottom" } }), "inner_left");
assert.equal(shapeWith(N, { south: { facing: "east", half: "bottom" } }), "inner_right");
// Metades diferentes não conectam.
assert.equal(shapeWith(N, { north: { facing: "east", half: "top" } }), "straight");
// Mesmo eixo não faz canto.
assert.equal(shapeWith(N, { north: { facing: "south", half: "bottom" } }), "straight");
// canTakeShape: uma escada igual do lado bloqueia o canto externo.
assert.equal(shapeWith(N, { north: { facing: "east", half: "bottom" }, west: { facing: "north", half: "bottom" } }), "straight");
// Outras direções (rotação).
assert.equal(shapeWith({ facing: "east", half: "top" }, { east: { facing: "south", half: "top" } }), "outer_right");
assert.equal(shapeWith({ facing: "east", half: "top" }, { west: { facing: "north", half: "top" } }), "inner_left");
// Escada vanilla vizinha (weirdo_direction 0 = east).
{
	const dim = new FakeDimension();
	dim.set({ x: 0, y: 0, z: 0 }, "minecraft:oak_stairs", { weirdo_direction: 0, upside_down_bit: false });
	dim.set({ x: 1, y: 0, z: 0 }, "cobblemon:saccharine_stairs", { "minecraft:cardinal_direction": "south", "minecraft:vertical_half": "top", "cobblemon:shape": "straight" });
	assert.deepEqual(stairInfo(asAny(dim.getBlock({ x: 0, y: 0, z: 0 }))), { facing: "east", half: "bottom" });
	assert.deepEqual(stairInfo(asAny(dim.getBlock({ x: 1, y: 0, z: 0 }))), { facing: "south", half: "top" });
	assert.equal(stairInfo(asAny(dim.getBlock({ x: 2, y: 0, z: 0 }))), undefined);
}
void OFFSETS;

setStoreBackend();
console.log("plantas: ok");
