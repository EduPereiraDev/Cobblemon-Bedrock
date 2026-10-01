// Frente memoria-script (docs/pendencias/memoria-script.md): heap do script do Bedrock (QuickJS) sem mudar o jogo.
// 1. O aquecimento do spawner calcula o tamanho de todas as entradas sem guardar os dados das espécies (eram ~13,5 MB
//    fixos no heap) e o tamanho calculado é o mesmo de antes (mesma conta sobre getSpeciesData).
// 2. Os caches por posição de `neededNearbyBlocks` ficam na própria posição (propriedade oculta), não num WeakMap: mesmas
//    respostas, mesma quantidade de consultas ao mundo, posição de pesca (cópia com spread) com cache próprio.
import assert from "node:assert/strict";
import { SPAWNS } from "../generated/scripts/spawns";
import { getFormForAspects, getSpeciesData, peekSpeciesData } from "../scripts/speciesData";
import { spawnSizeOf, warmSpawnIndex } from "../scripts/spawning/SpawnSelector";
import { conditionMatches, SpawnContext, worldClock } from "../scripts/spawning/SpawnConditions";

let passed = 0;
function test(name: string, fn: () => void) {
	try { fn(); passed++; }
	catch (e) { console.error(`✗ ${name}`); throw e; }
}

worldClock.timeOfDay = () => 6000;
worldClock.moonPhase = () => 0;

/** Espécies das entradas de spawn (e membros de herd). */
const spawnSpecies = new Set<string>();
for (const entry of SPAWNS) {
	spawnSpecies.add(entry.species);
	for (const m of entry.herd?.members ?? []) spawnSpecies.add(m.species);
}

/** A espécie está no cache de getSpeciesData? (peek devolve a instância do cache; fora dele, um objeto novo a cada vez) */
const cached = (species: string) => peekSpeciesData(species) !== undefined && peekSpeciesData(species) === peekSpeciesData(species);

test("aquecimento do spawner não deixa as espécies parseadas no cache", () => {
	const w = warmSpawnIndex();
	for (let r = w.next(); !r.done; r = w.next()) { }
	const left = [...spawnSpecies].filter(cached);
	// Antes da correção: todas (~860) ficavam no cache depois do aquecimento.
	assert.deepEqual(left, [], `espécies no cache depois do aquecimento: ${left.slice(0, 10).join(", ")}`);
	assert.ok(spawnSpecies.size > 500, `poucas espécies de spawn: ${spawnSpecies.size}`);
});

test("peekSpeciesData: sem cache devolve dados novos iguais; com cache devolve a mesma instância", () => {
	const id = [...spawnSpecies][0];
	const a = peekSpeciesData(id), b = peekSpeciesData(id);
	assert.ok(a && b && a !== b);
	assert.deepEqual(a, b);
	const g = getSpeciesData(id);
	assert.deepEqual(a, g);
	assert.equal(peekSpeciesData(id), g);
	assert.equal(peekSpeciesData("nao_existe_xyz"), undefined);
});

test("tamanho de spawn de todas as entradas e membros de herd = conta de antes sobre getSpeciesData", () => {
	/** A conta de antes da correção, com getSpeciesData (cache). */
	const reference = (species: string, aspects: readonly string[]) => {
		const data = getSpeciesData(species);
		const form = data ? getFormForAspects(data, aspects) : undefined;
		const hitbox = form?.hitbox ?? data?.hitbox;
		const scale = form?.baseScale ?? data?.baseScale ?? 1;
		return hitbox ? { width: Math.ceil(hitbox.width * scale), height: Math.ceil(hitbox.height * scale) } : { width: 1, height: 1 };
	};
	let n = 0;
	for (const entry of SPAWNS) {
		assert.deepEqual(spawnSizeOf(entry.species, entry.aspects), reference(entry.species, entry.aspects), entry.id);
		for (const m of entry.herd?.members ?? []) assert.deepEqual(spawnSizeOf(m.species, m.aspects ?? []), reference(m.species, m.aspects ?? []), `${entry.id} herd ${m.species}`);
		n++;
	}
	assert.ok(n > 1000, `entradas: ${n}`);
});

/** Posição com uma dimensão falsa que conta as consultas ao mundo. */
function position(found: (blocks: string[]) => boolean, extra: Partial<SpawnContext> = {}) {
	const calls: { blocks: string[]; min: unknown; max: unknown }[] = [];
	const dimension = {
		id: "minecraft:overworld",
		containsBlock: (volume: { from?: unknown; to?: unknown }, filter: { includeTypes: string[] }) => {
			calls.push({ blocks: filter.includeTypes, min: (volume as { args?: unknown[] }).args?.[0], max: (volume as { args?: unknown[] }).args?.[1] });
			return found(filter.includeTypes);
		},
	};
	const ctx = {
		dimension, location: { x: 10.5, y: 64, z: -3.5 }, blockY: 63, positionType: "grounded", biome: "minecraft:plains",
		baseBlock: "minecraft:grass_block", skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false,
		height: 8, ...extra,
	} as unknown as SpawnContext;
	return { ctx, calls };
}
const needs = (blocks: string[]) => ({ neededNearbyBlocks: blocks } as never);

test("neededNearbyBlocks: uma consulta por lista e posição; respostas iguais nas repetições", () => {
	const { ctx, calls } = position(blocks => blocks.includes("minecraft:honey_block"));
	for (let i = 0; i < 3; i++) {
		assert.equal(conditionMatches(needs(["minecraft:honey_block"]), ctx), true);
		assert.equal(conditionMatches(needs(["minecraft:bee_nest", "minecraft:beehive"]), ctx), false);
	}
	assert.equal(calls.length, 2);
	assert.deepEqual(calls.map(c => c.blocks.join(",")), ["minecraft:honey_block", "minecraft:bee_nest,minecraft:beehive"]);
});

test("cache por posição é oculto: não aparece em Object.keys/JSON nem é copiado pelo spread (posição de pesca)", () => {
	const { ctx, calls } = position(() => true);
	const keys = Object.keys(ctx).sort();
	assert.equal(conditionMatches(needs(["minecraft:water"]), ctx), true);
	assert.deepEqual(Object.keys(ctx).sort(), keys);
	assert.equal(JSON.stringify(Object.keys(JSON.parse(JSON.stringify({ ...ctx, dimension: undefined })))).includes("nearby"), false);
	// Como a posição de pesca do Spawner ({ ...ctx, positionType: "fishing" }): cache e caixa próprios.
	const fishing = { ...ctx, positionType: "fishing" } as SpawnContext;
	assert.equal(conditionMatches(needs(["minecraft:water"]), fishing), true);
	assert.equal(calls.length, 2, "a cópia consultou o mundo de novo (cache próprio)");
	assert.equal(conditionMatches(needs(["minecraft:water"]), fishing), true);
	assert.equal(calls.length, 2);
});

test("posição congelada (não extensível) continua com cache (WeakMap de reserva)", () => {
	const { ctx, calls } = position(() => false);
	Object.freeze(ctx);
	assert.equal(conditionMatches(needs(["minecraft:lava"]), ctx), false);
	assert.equal(conditionMatches(needs(["minecraft:lava"]), ctx), false);
	assert.equal(calls.length, 1);
});

test("nearbyBlocks explícito (posições montadas à mão) não consulta o mundo", () => {
	const { ctx, calls } = position(() => { throw new Error("não devia consultar"); }, { nearbyBlocks: new Set(["minecraft:sand"]) } as Partial<SpawnContext>);
	assert.equal(conditionMatches(needs(["minecraft:sand"]), ctx), true);
	assert.equal(conditionMatches(needs(["minecraft:stone"]), ctx), false);
	assert.equal(calls.length, 0);
});

console.log(`memoria-script: ${passed} grupos de testes ok`);
