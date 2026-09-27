// Frente "selftest": /cobblemon:selftest — lógica de modos, lotes, parada, restauração (blocos, dynamic properties,
// journal) e o manifesto lido dos packs no build.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anchorPositions, rememberDone,
  BlockChangeLog, KNOWN_PROBLEM_SPECIES, SELFTEST_MODES, StopSignal, TickBudget, blockTargets, chunk, decodeJournal, decodeSnapshot,
  diffDynamicProperties, encodeJournal, encodeSnapshot, formatDuration, gridOffsets, isLeftoverWorldKey, isSelfTestLeftoverBlock, parseSelfTestMode, planFor,
  pokemonTargets, regionCells, regionContains, runInBatches, sampleEvenly, sampleSounds, splitChunks, type DynamicValue, type SelfTestJournal,
  LOCOMOTION_ZONES, MOVEMENT_BATCH, MOVEMENT_SHELL, MOVEMENT_ZONES, SELFTEST_AREA, WATER_TOP, distinctPoserVariants, isWaterBlock, locomotionZones,
  mountRides, movementLayout, movementRounds, movementTargets, nudgeVector, rideZone, zoneSlots, type LocomotionZone,
} from "../scripts/debug/selfTestPlan";
import * as stub from "../scripts/debug/selfTestManifest";
// @ts-ignore módulo .mjs de ferramenta (sem tipos)
import { locomotionFlags, manifestModuleSource, readSelfTestManifest, selfTestManifestPlugin, stateValues } from "../tools/selftest/manifest.mjs";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

await test("modos: padrão quick, inválido undefined, stop/status sem fases", () => {
  assert.equal(parseSelfTestMode(undefined), "quick");
  assert.equal(parseSelfTestMode("  FULL "), "full");
  assert.equal(parseSelfTestMode("everything"), undefined);
  for (const mode of SELFTEST_MODES) assert.ok(parseSelfTestMode(mode));
  assert.deepEqual(planFor("stop"), []);
  assert.deepEqual(planFor("status"), []);
  assert.deepEqual(planFor("ui"), [{ phase: "ui", coverage: "all" }]);
  assert.deepEqual(planFor("movement"), [{ phase: "movement", coverage: "all" }]);
  const quick = planFor("quick");
  assert.deepEqual(quick.map(p => p.phase), ["entities", "movement", "blocks", "particles", "sounds", "ui", "battle"]);
  assert.ok(planFor("full").some(p => p.phase === "movement"));
  assert.ok(quick.every(p => p.coverage === "sample"));
  assert.ok(planFor("full").every(p => p.coverage === "all"));
});

await test("Pokémon: all = todas as combinações; sample = 1 por família + casos conhecidos inteiros", () => {
  const combos = { bulbasaur: 8, ivysaur: 8, torchic: 8, unown: 112, magikarp: 4 };
  const bases = new Set(["bulbasaur", "torchic", "unown", "magikarp"]);
  const all = pokemonTargets(combos, "all", s => bases.has(s));
  assert.equal(all.length, 8 + 8 + 8 + 112 + 4);
  const sample = pokemonTargets(combos, "sample", s => bases.has(s));
  // bulbasaur 1 + ivysaur 0 (não é base) + torchic 8 (conhecido) + unown 112 (conhecido) + magikarp 1
  assert.equal(sample.length, 1 + 8 + 112 + 1);
  assert.ok(!sample.some(t => t.species === "ivysaur"));
  assert.deepEqual(sample.filter(t => t.species === "torchic").map(t => t.variant), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(sample.map(t => `${t.species}#${t.variant}`)).size, sample.length, "sem repetição");
  for (const known of ["exeggutor", "dugtrio", "ninetales", "porygonz", "frillish"]) assert.ok((KNOWN_PROBLEM_SPECIES as readonly string[]).includes(known));
});

await test("blocos: padrão + um estado por vez; sample só estágios de crescimento", () => {
  const blocks = [
    { id: "cobblemon:oran_berry", states: { "cobblemon:age": [0, 1, 2, 3], "cobblemon:mulch": ["none", "rich"] } },
    { id: "cobblemon:pc", states: { "cobblemon:part": ["bottom", "top"], "cobblemon:on": [false, true] } },
    { id: "cobblemon:apricorn_planks", states: {} },
  ];
  const all = blockTargets(blocks, "all");
  assert.equal(all.length, (1 + 3 + 1) + (1 + 1 + 1) + 1);
  assert.deepEqual(all[0], { id: "cobblemon:oran_berry", states: {} });
  assert.deepEqual(all[1], { id: "cobblemon:oran_berry", states: { "cobblemon:age": 1 } });
  const sample = blockTargets(blocks, "sample");
  assert.equal(sample.length, (1 + 3) + 1 + 1);
  assert.ok(sample.every(t => Object.keys(t.states).every(k => k === "cobblemon:age")));
});

await test("amostras e lotes", () => {
  assert.deepEqual(sampleEvenly([1, 2, 3], 5), [1, 2, 3]);
  const s = sampleEvenly(Array.from({ length: 100 }, (_, i) => i), 5);
  assert.deepEqual(s, [0, 25, 50, 74, 99]);
  assert.deepEqual(sampleEvenly([1, 2], 0), []);
  const sounds = [
    ...Array.from({ length: 50 }, (_, i) => `cobblemon.pokemon.s${i}.cry`),
    "cobblemon.block.pc.on", "cobblemon.block.pc.off", "cobblemon.gui.click", "cobblemon.poke_ball.throw",
  ];
  const picked = sampleSounds(sounds, 10);
  assert.ok(picked.length <= 10 && picked.length >= 4);
  assert.equal(new Set(picked).size, picked.length);
  assert.ok(picked.includes("cobblemon.gui.click"), "grupos pequenos entram");
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  const grid = gridOffsets(16, 4, 4);
  assert.equal(grid.length, 16);
  assert.deepEqual(grid.slice(0, 4).map(g => g.dx), [-6, -2, 2, 6]);
  assert.deepEqual([...new Set(grid.map(g => g.dz))], [0, 4, 8, 12]);
  assert.equal(formatDuration(45_400), "45 s");
  assert.equal(formatDuration(185_000), "3 min 05 s");
});

await test("runInBatches: processa em lotes, pausa entre eles e para no meio", async () => {
  const signal = new StopSignal();
  const seen: number[][] = [];
  let pauses = 0;
  const progress: number[] = [];
  const result = await runInBatches([1, 2, 3, 4, 5, 6, 7], 3, signal, batch => { seen.push(batch); }, async () => { pauses++; }, done => progress.push(done));
  assert.deepEqual(seen, [[1, 2, 3], [4, 5, 6], [7]]);
  assert.equal(pauses, 3);
  assert.deepEqual(progress, [3, 6, 7]);
  assert.deepEqual(result, { processed: 7, batches: 3, stopped: false });

  // `stop` durante o 2º lote: o 3º não começa.
  const stopSignal = new StopSignal();
  const handled: number[][] = [];
  const stoppedRun = await runInBatches([1, 2, 3, 4, 5, 6, 7], 3, stopSignal, (batch, index) => {
    handled.push(batch);
    if (index === 1) stopSignal.stop("stop");
  }, async () => { });
  assert.deepEqual(handled, [[1, 2, 3], [4, 5, 6]]);
  assert.equal(stoppedRun.stopped, true);
  assert.equal(stopSignal.why, "stop");
  // O primeiro motivo vale (jogador saiu depois do stop não troca o motivo).
  stopSignal.stop("left");
  assert.equal(stopSignal.why, "stop");

  // Parada antes de começar: nada roda.
  const early = new StopSignal();
  early.stop("left");
  const none = await runInBatches([1, 2], 1, early, () => { throw new Error("não devia rodar"); }, async () => { });
  assert.deepEqual(none, { processed: 0, batches: 0, stopped: true });
});

await test("restauração de blocos: guarda o original da 1ª mudança e desfaz na ordem inversa", () => {
  const log = new BlockChangeLog<string>();
  assert.ok(log.record({ x: 0, y: 64, z: 0 }, "air"));
  assert.ok(log.record({ x: 1, y: 64, z: 0 }, "air"));
  // A mesma posição mudando de novo (grama de apoio → bloco) não sobrescreve o original.
  assert.ok(!log.record({ x: 0, y: 64, z: 0 }, "minecraft:grass_block"));
  assert.equal(log.size, 2);
  assert.deepEqual(log.restoreOrder(), [
    { pos: { x: 1, y: 64, z: 0 }, original: "air" },
    { pos: { x: 0, y: 64, z: 0 }, original: "air" },
  ]);
  const region = { min: { x: -1, y: 63, z: -1 }, max: { x: 1, y: 64, z: 1 } };
  assert.equal([...regionCells(region)].length, 3 * 2 * 3);
  assert.ok(regionContains(region, { x: 1.9, y: 64.5, z: -1 }));
  assert.ok(!regionContains(region, { x: 2, y: 64, z: 0 }));
  assert.ok(isSelfTestLeftoverBlock("cobblemon:pc") && isSelfTestLeftoverBlock("minecraft:barrier") && isSelfTestLeftoverBlock("minecraft:grass_block"));
  assert.ok(!isSelfTestLeftoverBlock("minecraft:chest") && !isSelfTestLeftoverBlock("minecraft:stone"));
  // Registro de berry no mundo (onPlace; só a quebra por jogador apaga): dentro da área e da dimensão → sobra do teste.
  const area = { min: { x: 41, y: 114, z: 27 }, max: { x: 65, y: 128, z: 57 } };
  assert.ok(isLeftoverWorldKey("cobblemon:berry|minecraft:overworld|60,116,38", "minecraft:overworld", area));
  assert.ok(!isLeftoverWorldKey("cobblemon:berry|minecraft:overworld|60,64,38", "minecraft:overworld", area), "fora da área");
  assert.ok(!isLeftoverWorldKey("cobblemon:berry|minecraft:nether|60,116,38", "minecraft:overworld", area), "outra dimensão");
  assert.ok(!isLeftoverWorldKey("other:berry|minecraft:overworld|60,116,38", "minecraft:overworld", area), "fora do namespace");
  assert.ok(!isLeftoverWorldKey("cobblemon_config", "minecraft:overworld", area));
  assert.ok(isLeftoverWorldKey("cobblemon:pasture|minecraft:overworld|-1,2,3|41,114,27", "minecraft:overworld", area), "vale a última posição");
});

await test("restauração do jogador: dynamic properties alteradas voltam, criadas somem", () => {
  const before = new Map<string, DynamicValue>([
    ["team", "[1,2]"], ["cobblemon:pokedex_0", "abc"], ["cobblemon:stats", "{\"battles_total\":3}"], ["pos", { x: 1, y: 2, z: 3 }], ["flag", true],
  ]);
  const after = new Map<string, DynamicValue>([
    ["team", "[1,2]"], ["cobblemon:pokedex_0", "abcd"], ["cobblemon:stats", "{\"battles_total\":4}"], ["pos", { x: 1, y: 2, z: 3 }],
    ["in_battle", "x"],
  ]);
  const diff = diffDynamicProperties(before, after);
  assert.deepEqual(diff.restore.map(([k]) => k).sort(), ["cobblemon:pokedex_0", "cobblemon:stats", "flag"]);
  assert.deepEqual(diff.remove, ["in_battle"]);
  // Snapshot sobrevive à ida e volta (queda do servidor), em pedaços.
  const text = encodeSnapshot(before);
  const parts = splitChunks(text, 7);
  assert.ok(parts.length > 1 && parts.every(p => p.length <= 7));
  const decoded = decodeSnapshot(parts.join(""));
  assert.deepEqual(decoded, before);
  assert.equal(decodeSnapshot("{oops"), undefined);
  assert.deepEqual(splitChunks(""), [""]);
});

await test("journal: ida e volta; inválido é descartado", () => {
  const journal: SelfTestJournal = {
    v: 1, playerId: "-4294967295", playerName: "Steve", dimension: "minecraft:overworld", origin: { x: 10.5, y: 70, z: -3.2 },
    rotation: { x: 5, y: 90 }, gameMode: "Survival", region: { min: { x: -2, y: 116, z: -11 }, max: { x: 22, y: 130, z: 19 } },
    snapshotChunks: 2, started: 123,
  };
  const back = decodeJournal(encodeJournal(journal));
  assert.deepEqual(back, { ...journal, regionClean: false, playerRestored: false });
  assert.equal(decodeJournal("{}"), undefined);
  assert.equal(decodeJournal(42), undefined);
  assert.equal(decodeJournal(JSON.stringify({ ...journal, region: { min: { x: 1 } } })), undefined);
  const budget = (() => { let t = 0; return new TickBudget(5, () => t++); })();
  assert.ok(!budget.expired());
});

await test("âncoras do journal: uma por coluna de chunk da área, dentro dela", () => {
  const region = { min: { x: 41, y: 114, z: 27 }, max: { x: 65, y: 128, z: 57 } };
  const anchors = anchorPositions(region);
  // x 41..65 → chunks 2, 3, 4; z 27..57 → chunks 1, 2, 3.
  assert.equal(anchors.length, 9);
  assert.ok(anchors.every(a => regionContains(region, a)));
  assert.equal(new Set(anchors.map(a => `${Math.floor(a.x / 16)},${Math.floor(a.z / 16)}`)).size, 9);
  const negative = anchorPositions({ min: { x: -20, y: 0, z: -3 }, max: { x: -18, y: 10, z: 3 } });
  assert.equal(negative.length, 2);
  assert.ok(negative.every(a => a.x >= -20 && a.x < -17 && a.y === 9));
  assert.deepEqual(rememberDone([1, 2, 3], 2, 3), [1, 3, 2]);
  assert.deepEqual(rememberDone([1, 2, 3], 4, 3), [2, 3, 4]);
});

await test("manifesto: stub vazio e o plugin lê os packs mesclados", () => {
  assert.equal(stub.SELFTEST_MANIFEST_BUILT, false);
  assert.deepEqual([stub.SELFTEST_ENTITIES, stub.SELFTEST_BLOCKS, stub.SELFTEST_PARTICLES, stub.SELFTEST_SOUNDS], [[], [], [], []]);
  const dir = mkdtempSync(join(tmpdir(), "selftest-"));
  try {
    const bp = join(dir, "behavior_packs", "CobblemonBedrock");
    const rp = join(dir, "resource_packs", "CobblemonBedrock");
    const write = (file: string, data: string) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, data); };
    write(join(bp, "entities", "npc", "npc.json"), JSON.stringify({ "minecraft:entity": { description: { identifier: "cobblemon:npc", properties: { "cobblemon:npc_skin": { type: "int", range: [0, 4] }, "cobblemon:flag": { type: "bool" } } } } }));
    // JSON com comentário (como os gerados pelo CobbleBuild).
    write(join(bp, "entities", "pokeballs", "poke_ball.json"), `/* gerado */ { "minecraft:entity": { "description": { "identifier": "cobblemon:poke_ball", }, } }`);
    write(join(bp, "entities", "pokemon", "bulbasaur.json"), JSON.stringify({ "minecraft:entity": { description: { identifier: "cobblemon:bulbasaur" } } }));
    write(join(bp, "entities", "pokemon", "magikarp.json"), JSON.stringify({ "minecraft:entity": {
      description: { identifier: "cobblemon:magikarp" },
      components: { "minecraft:navigation.generic": { can_swim: true, can_walk: false } },
      component_groups: { "cobblemon:wild_ai": { "minecraft:behavior.random_swim": { priority: 7 } } },
    } }));
    write(join(bp, "entities", "world", "machine_storage.json"), JSON.stringify({ "minecraft:entity": { description: { identifier: "cobblemon:machine_storage" } } }));
    write(join(bp, "entities", "player.json"), JSON.stringify({ "minecraft:entity": { description: { identifier: "minecraft:player" } } }));
    write(join(rp, "entity", "npc", "npc.entity.json"), JSON.stringify({ "minecraft:client_entity": { description: { identifier: "cobblemon:npc", animations: { idle: "animation.cobblemon_npc.idle", ctrl: "controller.animation.cobblemon_npc.pose" } } } }));
    write(join(bp, "blocks", "berry.json"), JSON.stringify({ "minecraft:block": { description: { identifier: "cobblemon:oran_berry", states: { "cobblemon:age": { values: { min: 0, max: 5 } }, "cobblemon:mulch": ["none", "rich"] } } } }));
    write(join(rp, "particles", "a.json"), JSON.stringify({ particle_effect: { description: { identifier: "cobblemon:spark" } } }));
    write(join(rp, "sounds", "sound_definitions.json"), JSON.stringify({ format_version: "1.20.20", sound_definitions: { "cobblemon.gui.click": {}, "cobblemon.pc.on": {} } }));
    const m = readSelfTestManifest(dir);
    assert.deepEqual(m.entities.map((e: { id: string }) => e.id), ["cobblemon:npc", "cobblemon:poke_ball"]);
    assert.deepEqual(m.entities[0], { id: "cobblemon:npc", group: "npc", ints: { "cobblemon:npc_skin": 4 }, animations: ["animation.cobblemon_npc.idle"] });
    assert.deepEqual(m.blocks, [{ id: "cobblemon:oran_berry", states: { "cobblemon:age": [0, 1, 2, 3, 4, 5], "cobblemon:mulch": ["none", "rich"] } }]);
    assert.deepEqual(m.particles, ["cobblemon:spark"]);
    assert.deepEqual(m.sounds, ["cobblemon.gui.click", "cobblemon.pc.on"]);
    // Pokémon não entram nas entidades, só nas capacidades de locomoção.
    assert.deepEqual(m.locomotion, { bulbasaur: "", magikarp: "s" });
    assert.equal(stateValues({ values: { min: 0, max: 100 } }).length, 16, "faixas grandes são limitadas");
    // O módulo gerado tem exatamente os exports do stub (o tsc só enxerga o stub).
    const source: string = manifestModuleSource(m);
    const exported = [...source.matchAll(/export const (\w+)/g)].map(x => x[1]).sort();
    assert.deepEqual(exported, Object.keys(stub).sort());
    assert.ok(source.includes("SELFTEST_MANIFEST_BUILT = true"));
    assert.equal(selfTestManifestPlugin({ dist: dir }).name, "selftest-manifest");
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

await test("movimento: caixas seladas de barreira dentro da área, água só na piscina e colocada por último", () => {
  const layout = movementLayout();
  const within = (c: { dx: number; dy: number; dz: number }) =>
    c.dx >= SELFTEST_AREA.minX && c.dx <= SELFTEST_AREA.maxX && c.dy >= SELFTEST_AREA.minY && c.dy <= SELFTEST_AREA.maxY && c.dz >= SELFTEST_AREA.minZ && c.dz <= SELFTEST_AREA.maxZ;
  assert.ok(layout.every(within), "tudo dentro da área só-ar");
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const solid = new Set(layout.filter(c => c.type === "minecraft:barrier").map(c => key(c.dx, c.dy, c.dz)));
  assert.equal(new Set(layout.map(c => key(c.dx, c.dy, c.dz))).size, layout.length, "sem posição repetida");
  // Água por último, só dentro da piscina, até WATER_TOP.
  const firstWater = layout.findIndex(c => c.type === "minecraft:water");
  assert.ok(firstWater > 0 && layout.slice(firstWater).every(c => c.type === "minecraft:water"));
  const pool = MOVEMENT_ZONES.water;
  for (const c of layout.slice(firstWater)) {
    assert.ok(c.dx >= pool.minX && c.dx <= pool.maxX && c.dz >= pool.minZ && c.dz <= pool.maxZ && c.dy >= pool.minY && c.dy <= WATER_TOP);
  }
  // Selada: a partir do interior de cada zona, andando por tudo que não é barreira, nunca se sai da zona.
  for (const zone of LOCOMOTION_ZONES) {
    const box = MOVEMENT_ZONES[zone];
    const start = key(box.minX, box.minY, box.minZ);
    const seen = new Set([start]);
    const queue = [[box.minX, box.minY, box.minZ]];
    while (queue.length) {
      const [x, y, z] = queue.pop()!;
      assert.ok(x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && z >= box.minZ && z <= box.maxZ, `${zone}: escapou em ${x},${y},${z}`);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = key(x + dx, y + dy, z + dz);
        if (solid.has(k) || seen.has(k)) continue;
        seen.add(k);
        queue.push([x + dx, y + dy, z + dz]);
      }
    }
    assert.equal(seen.size, (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1) * (box.maxZ - box.minZ + 1), `${zone}: interior inteiro livre`);
  }
  // Âncoras do journal (y = max - 1 da área) acima do teto; o jogador (z < 0) fora das caixas.
  assert.ok(SELFTEST_AREA.maxY - 1 > MOVEMENT_SHELL.maxY);
  assert.ok(MOVEMENT_SHELL.minZ > -4.5);
  assert.ok(isWaterBlock("minecraft:water") && isWaterBlock("minecraft:flowing_water") && !isWaterBlock("minecraft:barrier"));
  assert.ok(isSelfTestLeftoverBlock("minecraft:water") && isSelfTestLeftoverBlock("minecraft:flowing_water"));
});

await test("movimento: zonas por capacidade, posers diferentes, amostra com casos conhecidos e rodadas", () => {
  assert.deepEqual(locomotionZones("w"), ["ground"]);
  assert.deepEqual(locomotionZones("s"), ["water"]);
  assert.deepEqual(locomotionZones("ws"), ["ground", "water"]);
  assert.deepEqual(locomotionZones("wf"), ["air"]);
  assert.deepEqual(locomotionZones("sf"), ["water", "air"]);
  assert.deepEqual(locomotionZones(""), ["ground"]);
  assert.deepEqual(locomotionZones(undefined), ["ground"]);
  assert.deepEqual(distinctPoserVariants([{ poser: "a" }, { poser: "a" }, { poser: "b" }, { poser: "a" }, { poser: "b" }]), [0, 2]);
  assert.deepEqual(distinctPoserVariants([]), [0]);
  const posers: Record<string, number[]> = { torchic: [0], ninetales: [0, 4], magikarp: [0], pidgey: [0], lapras: [0] };
  for (let i = 0; i < 30; i++) posers[`walker${i}`] = [0];
  const flags: Record<string, string> = { torchic: "w", ninetales: "w", magikarp: "s", pidgey: "wf", lapras: "ws" };
  for (let i = 0; i < 30; i++) flags[`walker${i}`] = "w";
  const all = movementTargets(posers, flags, "all");
  assert.equal(all.ground.length, 1 + 2 + 1 + 30, "torchic, ninetales (2 posers), lapras, 30 walkers");
  assert.deepEqual(all.water.map(t => t.species), ["magikarp", "lapras"]);
  assert.deepEqual(all.air.map(t => t.species), ["pidgey"]);
  assert.ok(all.ground.every(t => t.zone === "ground"));
  const sample = movementTargets(posers, flags, "sample", ["torchic", "ninetales"], { ground: 10, water: 5, air: 5 });
  assert.equal(sample.ground.length, 10);
  assert.deepEqual(sample.ground.slice(0, 3).map(t => `${t.species}#${t.variant}`), ["torchic#0", "ninetales#0", "ninetales#4"], "casos conhecidos primeiro, com todos os posers");
  assert.equal(new Set(sample.ground.map(t => `${t.species}#${t.variant}`)).size, 10);
  const rounds = movementRounds({ ground: [1, 2, 3, 4, 5], water: [1], air: [1, 2, 3] }, { ground: 2, water: 2, air: 2 });
  assert.equal(rounds.length, 3);
  assert.deepEqual(rounds.map(r => r.ground), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(rounds.map(r => r.water), [[1], [], []]);
  assert.deepEqual(rounds.map(r => r.air), [[1, 2], [3], []]);
  assert.deepEqual(movementRounds({ ground: [], water: [], air: [] }), []);
  assert.ok(MOVEMENT_BATCH.ground > 0 && MOVEMENT_BATCH.water > 0 && MOVEMENT_BATCH.air > 0);
});

await test("movimento: posições dentro da zona e empurrão com módulo certo", () => {
  for (const zone of LOCOMOTION_ZONES as readonly LocomotionZone[]) {
    const box = MOVEMENT_ZONES[zone];
    const slots = zoneSlots(box, MOVEMENT_BATCH[zone], zone === "water" ? 1 : 0);
    assert.equal(slots.length, MOVEMENT_BATCH[zone]);
    for (const p of slots) assert.ok(p.x > box.minX && p.x < box.maxX + 1 && p.z > box.minZ && p.z < box.maxZ + 1, `${zone}: ${JSON.stringify(p)}`);
    assert.equal(new Set(slots.map(p => `${p.x},${p.z}`)).size, slots.length, `${zone}: sem posição repetida`);
  }
  assert.equal(zoneSlots(MOVEMENT_ZONES.ground, 1)[0].x, MOVEMENT_ZONES.ground.minX + 3.5);
  const flat = nudgeVector({ x: 0, y: 0, z: 0 }, { x: 3, y: 10, z: 4 }, 0.5, false);
  assert.equal(flat.y, 0);
  assert.ok(Math.abs(Math.hypot(flat.x, flat.z) - 0.5) < 1e-9);
  const free = nudgeVector({ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, 0.4, true);
  assert.deepEqual(free, { x: 0, y: 0.4, z: 0 });
  assert.deepEqual(nudgeVector({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 1, true), { x: 0, y: 0, z: 0 });
});

await test("montaria: amostra com terra/água/ar; completo com cada estilo de cada espécie", () => {
  const rideable = {
    mudsdale: ["LAND"], lapras: ["LAND", "LIQUID"], altaria: ["LAND", "AIR"], bronzong: ["AIR"], gyarados: ["LAND", "AIR", "LIQUID"], none: [],
  } as Record<string, ("LAND" | "AIR" | "LIQUID")[]>;
  assert.deepEqual(mountRides(rideable, "sample"), [
    { species: "mudsdale", style: "LAND" }, { species: "lapras", style: "LIQUID" }, { species: "altaria", style: "AIR" },
  ]);
  // Sem as preferidas: a primeira espécie que tem o estilo.
  assert.deepEqual(mountRides({ foo: ["LAND"], bar: ["AIR"] }, "sample"), [{ species: "foo", style: "LAND" }, { species: "bar", style: "AIR" }]);
  const all = mountRides(rideable, "all");
  assert.deepEqual(all.map(r => `${r.species}:${r.style}`), [
    "mudsdale:LAND", "lapras:LAND", "lapras:LIQUID", "altaria:AIR", "bronzong:AIR", "gyarados:LIQUID", "gyarados:AIR",
  ], "voo começa no chão: quem tem AIR não faz um passeio só de terra");
  assert.equal(rideZone("LAND"), "ground");
  assert.equal(rideZone("LIQUID"), "water");
  assert.equal(rideZone("AIR"), "air");
});

await test("manifesto: capacidades de locomoção pelo JSON da entidade", () => {
  const entity = (components: Record<string, unknown>, wild: Record<string, unknown> = {}) => ({ components, component_groups: { "cobblemon:wild_ai": wild } });
  assert.equal(locomotionFlags(entity({ "minecraft:navigation.walk": {} }, { "minecraft:behavior.random_stroll": {} })), "w");
  assert.equal(locomotionFlags(entity({ "minecraft:navigation.generic": { can_swim: true, can_walk: false } }, { "minecraft:behavior.random_swim": {} })), "s");
  assert.equal(locomotionFlags(entity({ "minecraft:navigation.generic": { can_swim: true, can_walk: true } }, { "minecraft:behavior.random_stroll": {} })), "ws");
  assert.equal(locomotionFlags(entity({ "minecraft:can_fly": {}, "minecraft:navigation.fly": {} }, { "minecraft:behavior.random_fly": {}, "minecraft:behavior.random_stroll": {} })), "wf");
  assert.equal(locomotionFlags(entity({})), "");
  assert.equal(locomotionFlags(undefined), "");
});

console.log(`selftest: ${passed} testes ok`);
