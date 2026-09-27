// Testes da frente "vilas": Pokécenter, mini-habitats e fazendas de berries das vilas do Java como estruturas jigsaw
// próprias do mod, com a frequência derivada dos pesos do pool de casas (tools/importer/villages.ts), o Pokécenter por
// script desligado e as portas do Cobblemon com as duas metades nas estruturas (tools/importer/blocks.ts).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { world } from "@minecraft/server";
import { readBedrockNbt, readJavaNbt } from "../tools/importer/nbt.ts";
import { bedrockWorldgenId } from "../tools/importer/jigsaw.ts";
import { applyProcessors, seededRandom } from "../tools/importer/structures.ts";
import {
  HOUSE_PIECES_PER_VILLAGE, JAVA_VILLAGE_SEPARATION, JAVA_VILLAGE_SPACING, VILLAGE_BIOMES, berryFarmLocations, cropToBerryVariants,
  entranceStartHeight, housePoolWeights, kotlinVillageWeights, saltOf, spreadFor, villagePieceOdds, villageStructures,
} from "../tools/importer/villages.ts";
import { STRUCTURE_IDS } from "../generated/scripts/structures";
import { HABITAT_ANCHOR_RANGES } from "../generated/scripts/habitats";
import { isDetectableStructure, parseMarkerTags } from "../scripts/world/StructureRegistry";
import { pokecentersEnabled } from "../scripts/world/Villages";

const ROOT = process.cwd();
const UPSTREAM_STRUCTURES = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon", "structure");
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const WG = join(GEN_BP, "worldgen");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
};
const close = (a: number, b: number, eps = 5e-4) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------
// Conta de frequência

test("pesos do pool de casas (JSON do Cobblemon + injeção do Kotlin)", () => {
  assert.deepEqual(kotlinVillageWeights(), { pokecenterWeight: 35, berryFarmWeight: 1 });
  const expected: Record<string, { vanilla: number; empty: number }> = {
    desert: { vanilla: 201, empty: 5 }, plains: { vanilla: 304, empty: 10 }, savanna: { vanilla: 304, empty: 5 },
    snowy: { vanilla: 186, empty: 6 }, taiga: { vanilla: 210, empty: 6 },
  };
  for (const biome of VILLAGE_BIOMES) {
    const w = housePoolWeights(biome);
    assert.equal(w.vanilla, expected[biome].vanilla, `${biome}: casas vanilla`);
    assert.equal(w.empty, expected[biome].empty, `${biome}: vazio`);
    // 2 × 150 no JSON + (35 + 1) do addBuildingToPool (repete `weight` vezes e adiciona mais uma).
    assert.equal(w.pokecenter, 336, `${biome}: pokécenter`);
    assert.equal(w.berry, 4, `${biome}: 2 fazendas × (1 + 1)`);
    assert.equal(w.habitats, 6, `${biome}: 6 mini-habitats de peso 1`);
    assert.equal(w.habitatElements.length, 6);
    for (const [i, e] of w.habitatElements.entries()) assert.equal(e.location, `cobblemon:habitats/village_${biome}${i + 1}`);
    assert.match(String(w.pokecenterElement.location), new RegExp(`village_${biome}_pokecenter$`));
  }
});

test("distribuição de mini-habitats por vila (N = 10 peças de casa)", () => {
  assert.equal(HOUSE_PIECES_PER_VILLAGE, 10);
  // Valores conferidos por um DP independente em Python (docs/pendencias/vilas.md).
  const expected: Record<string, [number, number, number, number]> = {
    desert: [0.771, 0.203, 0.025, 0.2559], plains: [0.841, 0.147, 0.012, 0.1720], savanna: [0.841, 0.147, 0.012, 0.1720],
    snowy: [0.756, 0.215, 0.029, 0.2755], taiga: [0.780, 0.197, 0.024, 0.2455],
  };
  for (const biome of VILLAGE_BIOMES) {
    const odds = villagePieceOdds(housePoolWeights(biome));
    const [p0, p1, p2, e] = expected[biome];
    assert.ok(close(odds.habitats[0], p0, 1e-3) && close(odds.habitats[1], p1, 1e-3) && close(odds.habitats[2], p2, 1e-3), `${biome}: ${odds.habitats}`);
    assert.ok(close(odds.expectedHabitats, e), `${biome}: E = ${odds.expectedHabitats}`);
    assert.ok(close(odds.habitats.reduce((a, b) => a + b, 0), 1, 1e-9), "soma 1");
    assert.ok(odds.pokecenter > 0.999, `${biome}: quase toda vila tem Pokécenter (${odds.pokecenter})`);
  }
  // Fazendas de berries por vila (N = 10), conferidas por DP com frações e Monte Carlo em Python.
  const farms: Record<string, number> = { desert: 0.1701, plains: 0.1145, savanna: 0.1145, snowy: 0.1830, taiga: 0.1632 };
  for (const biome of VILLAGE_BIOMES) {
    const odds = villagePieceOdds(housePoolWeights(biome));
    assert.ok(close(odds.expectedBerryFarms, farms[biome]), `${biome}: E[fazendas] = ${odds.expectedBerryFarms}`);
    assert.ok(close(odds.berryFarms.reduce((a, b) => a + b, 0), 1, 1e-9), "soma 1");
  }
  // Grupo berry_farm: no máximo 2 por vila, mesmo com o pool só de fazendas.
  const onlyFarms = villagePieceOdds({ vanilla: 0, pokecenter: 0, berry: 4, habitats: 1 }, 5);
  assert.ok(close(onlyFarms.berryFarms[2], 1 - onlyFarms.berryFarms[0] - onlyFarms.berryFarms[1], 1e-12));
  assert.ok(onlyFarms.expectedBerryFarms <= 2 && onlyFarms.expectedBerryFarms > 1.9, `E = ${onlyFarms.expectedBerryFarms}`);
  // Sem Pokécenter nem fazendas no pool, 1 sorteio: chance = 6 / (vanilla + 6).
  const one = villagePieceOdds({ vanilla: 94, pokecenter: 0, berry: 0, habitats: 6 }, 1);
  assert.ok(close(one.habitats[1], 0.06, 1e-12) && close(one.expectedHabitats, 0.06, 1e-12));
  // Grupo pokécenter sai da lista depois de 1 peça: nunca 2 Pokécenters, a chance por sorteio sobe depois dele.
  // 2 sorteios, pool {pokécenter 10, habitat 1}: E = 10/11 · 1 + 1/11 · (1 + 1/11) = 1 + 1/121; P(pc) = 1 − 1/121.
  const onlyPc = villagePieceOdds({ vanilla: 0, pokecenter: 10, berry: 0, habitats: 1 }, 2);
  assert.ok(close(onlyPc.expectedHabitats, 1 + 1 / 121, 1e-12), `E = ${onlyPc.expectedHabitats}`);
  assert.ok(close(onlyPc.pokecenter, 1 - 1 / 121, 1e-12), `P(pc) = ${onlyPc.pokecenter}`);
});

test("espaçamento equivalente: S = 34 / √q, separação na proporção do Java e < S/2", () => {
  assert.deepEqual(spreadFor(1), { spacing: JAVA_VILLAGE_SPACING, separation: JAVA_VILLAGE_SEPARATION });
  assert.deepEqual(spreadFor(0.25), { spacing: 68, separation: 16 });
  for (const q of [0.05, 0.1, 0.172, 0.2755, 0.5, 0.999]) {
    const { spacing, separation } = spreadFor(q);
    assert.ok(separation < spacing / 2, `q=${q}`);
    // Densidade relativa às vilas dentro de 5 %.
    assert.ok(Math.abs((JAVA_VILLAGE_SPACING / spacing) ** 2 / q - 1) < 0.05, `q=${q}: ${spacing}`);
  }
  assert.notEqual(saltOf("cobblemon:village_habitats/plains"), saltOf("cobblemon:village_habitats/desert"));
  assert.ok(saltOf("x") >= 0 && saltOf("x") < 2 ** 31);
});

// ---------------------------------------------------------------------------------------------
// Worldgen gerado

test("20 estruturas jigsaw novas com bioma da vila, chão e terreno adaptado", () => {
  const defs = villageStructures();
  assert.equal(defs.length, 20);
  assert.equal(defs.filter(v => v.late).length, 10, "as 10 fazendas entram depois");
  for (const v of defs) {
    const id = bedrockWorldgenId(v.id);
    const file = join(WG, "structures", `${id.split(":")[1]}.json`);
    assert.ok(existsSync(file), file);
    const s = json(file)["minecraft:jigsaw"];
    assert.equal(s.description.identifier, id);
    assert.ok(!id.includes("/"), "id sem / (o /locate recusa)");
    assert.equal(s.terrain_adaptation, "beard_thin");
    assert.equal(s.heightmap_projection, "world_surface");
    // Camada 0 no chão (jigsaw de entrada em y = 1); a fazenda grande de neve tem a entrada em y = 0 (fica 1 acima).
    const startY = v.id === "cobblemon:village_berry_farms/snowy_large" ? 0 : -1;
    assert.deepEqual(s.start_height, { type: "constant", value: { absolute: startY } }, id);
    assert.equal(s.step, "surface_structures");
    const filter = JSON.stringify(s.biome_filters);
    const biome = v.id.split("/")[1].split("_")[0];
    const tag = { desert: "desert", plains: "plains", savanna: "savanna", snowy: "ice", taiga: "taiga" }[biome]!;
    assert.ok(filter.includes(`"${tag}"`), `${id}: filtro de bioma ${filter}`);
    // Pool inicial: 1 Pokécenter ou os 6 mini-habitats de peso 1; peças existem.
    const pool = json(join(WG, "template_pools", `${s.start_pool.split(":")[1]}.json`))["minecraft:template_pool"];
    assert.equal(pool.elements.length, v.id.includes("habitats") ? 6 : v.id.includes("berry_farms") ? 15 : 1);
    for (const e of pool.elements) {
      assert.equal(e.weight, 1);
      assert.equal(e.element.projection, "rigid");
      assert.ok(existsSync(join(GEN_BP, "structures", `${e.element.location}.mcstructure`)), e.element.location);
    }
    // Conjunto próprio com o espaçamento da conta.
    const set = json(join(WG, "structure_sets", `${bedrockWorldgenId(v.setId).split(":")[1]}.json`))["minecraft:structure_set"];
    assert.deepEqual(set.structures, [{ structure: id, weight: 1 }]);
    const { spacing, separation } = spreadFor(v.share);
    assert.equal(set.placement.spacing, spacing);
    assert.equal(set.placement.separation, separation);
    assert.equal(set.placement.spread_type, "linear");
    assert.notEqual(set.placement.salt, 10387312, "sal diferente do das vilas");
  }
  const spacings = Object.fromEntries(defs.map(v => [v.id, spreadFor(v.share).spacing]));
  assert.deepEqual(spacings, {
    "cobblemon:village_pokecenters/desert": 34, "cobblemon:village_habitats/desert": 67,
    "cobblemon:village_pokecenters/plains": 34, "cobblemon:village_habitats/plains": 82,
    "cobblemon:village_pokecenters/savanna": 34, "cobblemon:village_habitats/savanna": 82,
    "cobblemon:village_pokecenters/snowy": 34, "cobblemon:village_habitats/snowy": 65,
    "cobblemon:village_pokecenters/taiga": 34, "cobblemon:village_habitats/taiga": 69,
    // Fazendas: S = 34 / √(E[fazendas] / 2) por molde (pequena e grande têm o mesmo peso).
    "cobblemon:village_berry_farms/desert_small": 117, "cobblemon:village_berry_farms/desert_large": 117,
    "cobblemon:village_berry_farms/plains_small": 142, "cobblemon:village_berry_farms/plains_large": 142,
    "cobblemon:village_berry_farms/savanna_small": 142, "cobblemon:village_berry_farms/savanna_large": 142,
    "cobblemon:village_berry_farms/snowy_small": 112, "cobblemon:village_berry_farms/snowy_large": 112,
    "cobblemon:village_berry_farms/taiga_small": 119, "cobblemon:village_berry_farms/taiga_large": 119,
  });
});

test("peças com marcador do StructureRegistry e bloco de habitat", () => {
  for (const biome of VILLAGE_BIOMES) {
    for (const kind of ["pokecenters", "habitats"]) {
      const id = `cobblemon:village_${kind}/${biome}`;
      assert.ok(STRUCTURE_IDS.includes(id), `${id} em STRUCTURE_IDS`);
      assert.ok(isDetectableStructure(id), `${id} detectável pelas condições de spawn`);
    }
    const piece: any = readBedrockNbt(readFileSync(join(GEN_BP, "structures", "cobblemon", "jigsaw", "habitats", `village_${biome}1__habitats_abandoned_village_${biome}.mcstructure`)));
    const marker = piece.structure.entities.find((e: any) => e.identifier === "cobblemon:structure_marker");
    assert.ok(marker, `${biome}: marcador`);
    assert.deepEqual(parseMarkerTags(marker.Tags)?.ids, [`cobblemon:village_habitats/${biome}`]);
    const palette = piece.structure.palette.default.block_palette.map((b: any) => b.name);
    assert.ok(palette.includes("cobblemon:habitat_block"), `${biome}: bloco de habitat âncora`);
    assert.ok(!palette.includes("minecraft:gold_block"), `${biome}: gold_block do molde vira ar (processador)`);
  }
  assert.equal(HABITAT_ANCHOR_RANGES["cobblemon:abandoned_village_house"], 16);
  // Índices antigos preservados: as novas entram no fim da tabela (marcadores de mundos existentes continuam valendo).
  assert.ok(STRUCTURE_IDS.indexOf("cobblemon:village_habitats/desert") > STRUCTURE_IDS.indexOf("cobblemon:shipwreck_coves/submerged_shipwreck_cove"));
  const firstFarm = STRUCTURE_IDS.findIndex(id => id.startsWith("cobblemon:village_berry_farms/"));
  assert.equal(firstFarm, STRUCTURE_IDS.indexOf("cobblemon:village_pokecenters/taiga") + 1, "fazendas depois das 10 primeiras");
  assert.equal(STRUCTURE_IDS.length - firstFarm, 10);
});

// ---------------------------------------------------------------------------------------------
// Fazendas de berries (addBerryFarms + crop_to_berry)

test("crop_to_berry: 15 pares, cada cultivo vira uma berry do par com idade 1..3 (1/6 cada)", () => {
  const variants = cropToBerryVariants();
  assert.equal(variants.length, 15);
  for (const v of variants) {
    const rules = (v.processors[0] as any).rules.filter((r: any) => r.input_predicate.block === "minecraft:wheat");
    assert.equal(rules.length, 6, `${v.id}: 2 berries × 3 idades`);
    // Probabilidade de cada saída com as regras encadeadas: Π (1 − p_i) × p_j = 1/6.
    let rest = 1;
    for (const r of rules) {
      const p = r.input_predicate.probability ?? 1;
      assert.ok(close(rest * p, 1 / 6, 1e-12), `${v.id}: ${r.output_state.Name} ${r.output_state.Properties.age}`);
      rest *= 1 - p;
    }
    assert.deepEqual([...new Set(rules.map((r: any) => r.output_state.Name))].sort(), [...v.pair].sort());
    assert.deepEqual(rules.map((r: any) => r.output_state.Properties.age), ["1", "2", "3", "1", "2", "3"]);
  }
  // Conversão real: o trigo do molde some e vira só as berries do par.
  const t: any = readJavaNbt(readFileSync(join(UPSTREAM_STRUCTURES, "village_plains", "plains_berry_large.nbt")));
  const blocks = t.blocks.map((b: any) => ({ pos: b.pos, name: t.palette[b.state].Name, props: { ...(t.palette[b.state].Properties ?? {}) } }));
  const out = applyProcessors(blocks, variants[0].processors as any[], seededRandom("teste"));
  assert.equal(out.filter(b => b.name === "minecraft:wheat").length, 0);
  const berries = out.filter(b => b.name.endsWith("_berry"));
  assert.equal(berries.length, blocks.filter((b: any) => b.name === "minecraft:wheat").length);
  assert.ok(berries.every(b => variants[0].pair.includes(b.name) && ["1", "2", "3"].includes(b.props.age)));
});

test("fazendas: 2 moldes por bioma, peças geradas sem trigo, com marcador e entrada no chão", () => {
  for (const biome of VILLAGE_BIOMES) {
    const farms = berryFarmLocations(biome);
    assert.deepEqual(farms.map(f => f.location), [`cobblemon:village_${biome}/${biome}_berry_small`, `cobblemon:village_${biome}/${biome}_berry_large`]);
    for (const { size, location } of farms) {
      assert.equal(entranceStartHeight(location), biome === "snowy" && size === "large" ? 0 : -1, location);
      for (let i = 1; i <= 15; i++) {
        const file = join(GEN_BP, "structures", "cobblemon", "jigsaw", `village_${biome}`, `${biome}_berry_${size}__crop_to_berry_pair${i}.mcstructure`);
        const piece: any = readBedrockNbt(readFileSync(file));
        const palette: string[] = piece.structure.palette.default.block_palette.map((b: any) => b.name);
        assert.ok(!palette.includes("minecraft:wheat"), `${file}: trigo`);
        assert.ok(palette.some(n => n.endsWith("_berry")), `${file}: berries`);
        const marker = piece.structure.entities.find((e: any) => e.identifier === "cobblemon:structure_marker");
        assert.deepEqual(parseMarkerTags(marker.Tags)?.ids, [`cobblemon:village_berry_farms/${biome}_${size}`]);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Portas do Cobblemon nas estruturas (bedrockStateFor: metade de cima, direção)

test("Pokécenters: portas com as duas metades e direção do molde; máquina de cura virada como no molde", () => {
  const pieces: Record<string, string[]> = {
    desert: ["jigsaw/village_desert/village_desert_pokecenter", "village/desert_pokecenter"],
    plains: ["jigsaw/village_plains/village_plains_pokecenter__villages_pokecenter_mossy", "village/plains_pokecenter"],
    savanna: ["jigsaw/village_savanna/village_savanna_pokecenter", "village/savanna_pokecenter"],
    snowy: ["jigsaw/village_snowy/village_snowy_pokecenter", "village/snowy_pokecenter"],
    taiga: ["jigsaw/village_taiga/village_taiga_pokecenter__villages_pokecenter_mossy", "village/taiga_pokecenter"],
  };
  let doors = 0;
  for (const [biome, outs] of Object.entries(pieces)) {
    const t: any = readJavaNbt(readFileSync(join(UPSTREAM_STRUCTURES, `village_${biome}`, `village_${biome}_pokecenter.nbt`)));
    const want = t.blocks.filter((b: any) => /apricorn_door|healing_machine/.test(t.palette[b.state].Name)).map((b: any) => {
      const p = t.palette[b.state];
      const name = p.Name === "cobblemon:healing_machine" ? p.Name : `cobblemon:apricorn_door_${p.Properties.half === "upper" ? "top" : "bottom"}_left`;
      return `${b.pos.join(",")}|${name}|${p.Properties.facing}`;
    }).sort();
    assert.ok(want.some((w: string) => w.includes("_door_top_left")), `${biome}: molde com porta`);
    for (const o of outs) {
      const s: any = readBedrockNbt(readFileSync(join(GEN_BP, "structures", "cobblemon", `${o}.mcstructure`)));
      const [X, Y, Z] = s.size;
      const palette = s.structure.palette.default.block_palette;
      const idx = s.structure.block_indices[0];
      const got: string[] = [];
      for (let x = 0; x < X; x++) for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) {
        const b = palette[idx[(x * Y + y) * Z + z]];
        if (!b || !/apricorn_door|healing_machine/.test(b.name)) continue;
        got.push(`${x},${y},${z}|${b.name}|${b.states["minecraft:cardinal_direction"]}`);
        if (b.name.endsWith("_door_bottom_left")) {
          doors++;
          const above = palette[idx[(x * Y + y + 1) * Z + z]];
          assert.equal(above?.name, "cobblemon:apricorn_door_top_left", `${o}: metade de cima acima de ${x},${y},${z}`);
          assert.equal(above.states["minecraft:cardinal_direction"], b.states["minecraft:cardinal_direction"]);
        }
      }
      assert.deepEqual(got.sort(), want, o);
    }
  }
  assert.equal(doors, 24, "12 portas × 2 cópias (peça jigsaw + Pokécenter por script)");
});

// ---------------------------------------------------------------------------------------------
// Pokécenter por script: desligado por padrão

test("Pokécenter por script desligado por padrão, liga só com a chave", () => {
  const w = world as any;
  const original = w.getDynamicProperty;
  try {
    w.getDynamicProperty = () => undefined;
    assert.equal(pokecentersEnabled(), false);
    w.getDynamicProperty = () => false;
    assert.equal(pokecentersEnabled(), false);
    w.getDynamicProperty = (k: string) => (k === "cobblemon:village_pokecenters" ? true : undefined);
    assert.equal(pokecentersEnabled(), true);
    w.getDynamicProperty = () => { throw new Error("sem mundo"); };
    assert.equal(pokecentersEnabled(), false);
  }
  finally { w.getDynamicProperty = original; }
});

console.log(`vilas: ${passed} testes ok`);
