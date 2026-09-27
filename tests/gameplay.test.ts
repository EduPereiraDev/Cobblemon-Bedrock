// Lógica de jogo com os dados reais do Cobblemon (generated/), rodando no Node com a API do
// Minecraft mockada: geração de Pokémon, evoluções, propriedades, batalha e escolha de spawn.
import assert from "node:assert/strict";
import { Dex } from "../scripts/showdown";
import { PokemonData } from "../scripts/Pokemon";
import { PokemonProperties } from "../scripts/PokemonProperties";
import { getAllSpeciesIds, getSpeciesData } from "../scripts/speciesData";
import { initializeEvolutions } from "../scripts/evolution";
import { chooseSpawn, SpawnContext } from "../scripts/spawning/Spawner";
import { resolveVariant } from "../generated/scripts/variants";
import { BattleStream, getPlayerStreams } from "../scripts/showdown";

const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };

// 1. Todas as espécies geram Pokémon válidos e todas as evoluções/requisitos são reconhecidos.
const species = getAllSpeciesIds();
assert.ok(species.length > 800, `esperava 800+ espécies, veio ${species.length}`);
let showdownMissing: string[] = [];
for (const id of species) {
	const pokemon = PokemonData.generateNewWildPokemon(id, { level: 30 });
	const stats = pokemon.getCurrentStats();
	for (const [stat, value] of Object.entries(stats))
		assert.ok(Number.isFinite(value) && value > 0, `${id}: atributo ${stat} inválido (${value})`);
	assert.ok(pokemon.maxHealth > 0, `${id}: HP máximo inválido`);
	assert.ok(pokemon.variant >= 0, `${id}: variante inválida`);
	for (const move of pokemon.moves) assert.ok(Dex.moves.get(move).exists, `${id}: golpe desconhecido ${move}`);
	if (!Dex.species.get(pokemon.getShowdownSpecies()).exists) showdownMissing.push(id);
	initializeEvolutions(getSpeciesData(id)!.evolutions ?? []);
}
assert.deepEqual(showdownMissing, [], "toda espécie precisa existir no Showdown");
const unknownRequirements = warnings.filter(w => /valid (requirement|evolution type) constructor/.test(w));
assert.deepEqual([...new Set(unknownRequirements)], [], "requisitos/variantes de evolução sem implementação");

// 2. Propriedades do Cobblemon.
const alolan = PokemonProperties.parse("raichu alolan");
assert.equal(alolan.species, "raichu");
assert.deepEqual(alolan.aspects, ["alolan"]);
assert.equal(PokemonProperties.parse("gender=female").gender, "f");
const pikachu = PokemonData.generateNewWildPokemon("pikachu", { level: 30, shiny: false });
pikachu.gender = "m"; pikachu.aspects = ["male"];
const raichu = alolan.apply(pikachu);
assert.equal(raichu.species, "raichu");
assert.deepEqual(raichu.aspects.sort(), ["alolan", "male"]);
assert.equal(raichu.getShowdownSpecies(), "Raichu-Alola");
assert.notEqual(resolveVariant("raichu", ["alolan"]), resolveVariant("raichu", []), "Raichu de Alola deve ter visual próprio");
assert.ok(PokemonProperties.parse("gender=female").match(Object.assign(PokemonData.generateNewWildPokemon("combee"), { gender: "f" })));
assert.ok(!PokemonProperties.parse("gender=female").match(Object.assign(PokemonData.generateNewWildPokemon("combee"), { gender: "m" })));

// Wurmple evolui para um só casulo, estável por Pokémon; Inkay só vira Malamar pelo apelido Dinnerbone.
for (let i = 0; i < 20; i++) {
	const wurmple = PokemonData.generateNewWildPokemon("wurmple", { level: 10 });
	const ready = initializeEvolutions(getSpeciesData("wurmple")!.evolutions).filter(evo => evo.test(wurmple));
	assert.equal(ready.length, 1, "Wurmple deve ter exatamente uma evolução disponível");
}
const inkay = PokemonData.generateNewWildPokemon("inkay", { level: 30 });
const dinnerbone = PokemonProperties.parse("inkay nickname=Dinnerbone");
assert.ok(!dinnerbone.match(inkay));
inkay.name = "Dinnerbone";
assert.ok(dinnerbone.match(inkay));

// 3. Batalhas entre Pokémon gerados, com o set convertido para o Showdown.
async function battle(a: PokemonData, b: PokemonData) {
	const stream = new BattleStream();
	const streams = getPlayerStreams(stream);
	let log = "";
	const done = (async () => { for await (const chunk of streams.omniscient) log += chunk + "\n"; })();
	for (const side of [streams.p1, streams.p2])
		(async () => { for await (const c of side) if (c.startsWith("|request|") && !c.includes('"wait":true')) side.write("default"); })();
	streams.omniscient.write(`>start {"format":{"gameType":"singles","gen":9}}`);
	streams.omniscient.write(`>player p1 ${JSON.stringify({ name: "A", team: [a.toShowdownSet()] })}`);
	streams.omniscient.write(`>player p2 ${JSON.stringify({ name: "B", team: [b.toShowdownSet()] })}`);
	await done;
	return log;
}
for (let i = 0; i < 25; i++) {
	const pick = () => PokemonData.generateNewWildPokemon(species[Math.floor(Math.random() * species.length)], { level: 40 });
	const [a, b] = [pick(), pick()];
	const log = await battle(a, b);
	assert.match(log, /\|(win|tie)\|/, `batalha ${a.species} x ${b.species} não terminou`);
	assert.ok(log.includes(`p1a: ${a.uuid}`), "protocolo deve usar o UUID");
}

// 4. Spawn: contextos típicos precisam render Pokémon, com variedade.
const overworld = { id: "minecraft:overworld", containsBlock: () => false } as unknown as SpawnContext["dimension"];
const ctx = (over: Partial<SpawnContext>): SpawnContext => ({
	dimension: overworld, location: { x: 100, y: 70, z: 100 }, positionType: "grounded", biome: "plains",
	baseBlock: "minecraft:grass_block", skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false, ...over,
});
const sample = (c: SpawnContext, n = 1500) => {
	const seen = new Map<string, number>();
	for (let i = 0; i < n; i++) {
		const entry = chooseSpawn(c);
		if (entry) seen.set(entry.species, (seen.get(entry.species) ?? 0) + 1);
	}
	return seen;
};
const plains = sample(ctx({}));
assert.ok(plains.size >= 5, `planície de dia deveria ter variedade, veio ${[...plains.keys()]}`);
const forest = sample(ctx({ biome: "forest" }));
assert.ok(forest.size >= 5, `floresta deveria ter variedade, veio ${[...forest.keys()]}`);
const ocean = sample(ctx({ biome: "ocean", positionType: "submerged", baseBlock: "minecraft:water", canSeeSky: false, location: { x: 0, y: 50, z: 0 } }));
assert.ok(ocean.size >= 3, `oceano submerso deveria ter Pokémon aquáticos, veio ${[...ocean.keys()]}`);
const cave = sample(ctx({ canSeeSky: false, skyLight: 0, light: 0, baseBlock: "minecraft:stone", location: { x: 0, y: 20, z: 0 } }));
assert.ok(cave.size >= 3, `caverna deveria ter Pokémon subterrâneos, veio ${[...cave.keys()]}`);
for (const id of [...plains.keys(), ...forest.keys(), ...ocean.keys(), ...cave.keys()])
	assert.ok(getSpeciesData(id), `spawn escolheu espécie sem dados: ${id}`);

console.warn = originalWarn;
const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k).join(", ");
console.log(`ok: ${species.length} espécies geradas; 25 batalhas; spawns planície [${top(plains)}], floresta [${top(forest)}], oceano [${top(ocean)}], caverna [${top(cave)}]`);
