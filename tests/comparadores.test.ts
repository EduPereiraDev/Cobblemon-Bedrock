// Frente "comparadores": sinal de comparador da Healing Machine (#143) e do Metronome (#74) com as regras do Java,
// a codificação em estados (medidor + bit, máscara de faces), as permutações do importador e o laço com a API mockada.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { system, world } from "@minecraft/server";
import {
  chargeFromRecord, healerClock, maxHealerCharge, readCharge, resetHealerClockForTests, startHealerClock, trackUnloadedHealers, writeCharge,
} from "../scripts/custom_components/HealingMachineComponent";
import {
  COMPARATOR_FACES_STATE, facesOf, HEALER_CHARGE_STATE, HEALER_HIGH_STATE, healerHigh, healerMeterLevel, healerPermutations, healerPower,
  healerSignal, healerStates, METRONOME_ACTIVE_STATE, metronomePermutations, metronomeSignal, metronomeStates, PRODUCER_FORMAT,
} from "../scripts/comparadores/logic";
import { healerKeyToBlockKey, updateBlock } from "../scripts/comparadores/index";
import { setStorageBackend } from "../scripts/machines/store";

console.warn = () => { };
const mem = new Map<string, string>();
setStorageBackend({ get: id => mem.get(id), set: (id, v) => { if (v === undefined) mem.delete(id); else mem.set(id, v); }, ids: () => [...mem.keys()] });

/** Avalia uma condição de permutação (só q.block_state, &&, ||, !, ==). */
function evalCondition(condition: string, states: Record<string, unknown>): boolean {
  const js = condition.replace(/q\.block_state\('([^']+)'\)/g, (_, k: string) => JSON.stringify(states[k]));
  assert.ok(/^[\s\d()&|!=a-z"]*$/.test(js), `condição inesperada: ${js}`);
  return Boolean(new Function(`return (${js});`)());
}

// ---------------------------------------------------------------------------------------------
// 1. HealingMachineBlockEntity.updateRedstoneSignal: ((carga / máx) * 100).toInt() / 10, no máximo 10
{
  assert.equal(healerSignal(0, 6), 0);
  assert.equal(healerSignal(0.5999, 6), 0);
  assert.equal(healerSignal(0.6, 6), 1); // 10 %
  assert.equal(healerSignal(2.1, 6), 3); // 35 %
  assert.equal(healerSignal(5.99, 6), 9);
  assert.equal(healerSignal(6, 6), 10);
  assert.equal(healerSignal(7, 6), 10);
  assert.equal(healerSignal(-1, 6), 0);
  assert.equal(healerSignal(3, 0), 0);
}

// 2. Medidor + bit reproduzem o sinal do Java em toda a faixa (várias cargas máximas)
{
  for (const max of [6, 7.5, 10, 13]) {
    // Grade fina + fronteiras exatas dos décimos e dos quinze níveis (com os vizinhos de 1 ulp).
    const charges: number[] = [];
    for (let i = 0; i <= 3000; i++) charges.push((i / 3000) * max);
    for (let k = 0; k <= 30; k++) {
      const c = (k / 30) * max;
      charges.push(c, c * (1 - Number.EPSILON), c * (1 + Number.EPSILON), (k * max) / 30, max * k / 30);
    }
    for (const charge of charges) {
      const level = healerMeterLevel(charge, max, false);
      const signal = healerSignal(charge, max);
      const out = healerStates(level, signal, 5);
      if (signal === 0) assert.deepEqual(out, { mask: 0, high: false }, `max=${max} carga=${charge}`);
      else {
        assert.equal(healerPower(level, out.high), signal, `max=${max} carga=${charge} nível=${level}`);
        assert.equal(out.mask, 5);
      }
    }
  }
  // Sem comparador: tudo zerado. Carga infinita do port: medidor 15 → 10.
  assert.deepEqual(healerStates(15, 10, 0), { mask: 0, high: false });
  assert.equal(healerMeterLevel(0, 6, true), 15);
  assert.equal(healerPower(15, healerHigh(15, 10)), 10);
  // Medidor velho (ex. durante a cura): a saída fica no valor mais próximo possível.
  assert.equal(healerPower(15, healerHigh(15, 4)), 10);
  assert.equal(healerPower(4, healerHigh(4, 9)), 3);
}

// 3. Permutações da Healing Machine: exatamente uma liga o produtor em cada (medidor, bit, máscara) com força > 0
{
  const perms = healerPermutations();
  assert.equal(perms.length, 150);
  assert.equal(new Set(perms.map(p => `${p.power}|${p.mask}`)).size, 150);
  for (let level = 0; level <= 15; level++) {
    for (const high of [false, true]) {
      for (let mask = 0; mask <= 15; mask++) {
        const st = { [HEALER_CHARGE_STATE]: level, [HEALER_HIGH_STATE]: high, [COMPARATOR_FACES_STATE]: mask };
        const hits = perms.filter(p => evalCondition(p.condition, st));
        const want = mask > 0 ? healerPower(level, high) : 0;
        if (want === 0) assert.equal(hits.length, 0, `nível=${level} bit=${high} máscara=${mask}`);
        else {
          assert.equal(hits.length, 1, `nível=${level} bit=${high} máscara=${mask}`);
          assert.equal(hits[0].power, want);
          assert.equal(hits[0].mask, mask);
        }
      }
    }
  }
  assert.deepEqual(facesOf(1 | 4), ["north", "south"]);
  assert.deepEqual(facesOf(15), ["north", "east", "south", "west"]);
}

// 4. Metronome (ActivatableDecorationBlock): 4 quando ativo
{
  assert.equal(metronomeSignal(true), 4);
  assert.equal(metronomeSignal(false), 0);
  assert.deepEqual(metronomeStates(true, 8), { mask: 8, high: false });
  assert.deepEqual(metronomeStates(false, 8), { mask: 0, high: false });
  assert.deepEqual(metronomeStates(true, 0), { mask: 0, high: false });
  const perms = metronomePermutations();
  assert.equal(perms.length, 15);
  for (const active of [false, true]) {
    for (let mask = 0; mask <= 15; mask++) {
      const hits = perms.filter(p => evalCondition(p.condition, { [METRONOME_ACTIVE_STATE]: active, [COMPARATOR_FACES_STATE]: mask }));
      assert.equal(hits.length, active && mask > 0 ? 1 : 0);
      if (hits.length) assert.equal(hits[0].power, 4);
    }
  }
}

// 5. Registro: chave da carga da Healing Machine → chave de posição
{
  assert.equal(healerKeyToBlockKey("cobblemon:healer|minecraft:overworld|10,64,-3"), "minecraft:overworld|10|64|-3");
  assert.equal(healerKeyToBlockKey("cobblemon:mach:cooking:minecraft:overworld|1|2|3"), undefined);
  assert.equal(healerKeyToBlockKey("cobblemon:healer|minecraft:overworld|x,1,2"), undefined);
}

// 6. updateBlock com blocos falsos: máscara pela direção do comparador, medidor refeito, estados gravados
{
  type States = Record<string, unknown>;
  const grid = new Map<string, FakeBlock>();
  const dimension = { id: "minecraft:overworld", getBlock: (l: { x: number; y: number; z: number }) => grid.get(`${l.x},${l.y},${l.z}`) };
  class FakePerm {
    constructor(readonly states: States, readonly type = "") { }
    getState(k: string) { return this.states[k]; }
    withState(k: string, v: unknown) { return new FakePerm({ ...this.states, [k]: v }, this.type); }
    getAllStates() { return this.states; }
  }
  class FakeBlock {
    writes = 0;
    replaced = 0;
    isWaterlogged = false;
    constructor(public typeId: string, public permutation: FakePerm, readonly location: { x: number; y: number; z: number }) {
      this.permutation = new FakePerm(permutation.states, typeId);
      grid.set(`${location.x},${location.y},${location.z}`, this);
    }
    get dimension() { return dimension; }
    setType(t: string) { this.typeId = t; this.permutation = new FakePerm({}, t); this.replaced++; }
    setPermutation(p: FakePerm) { this.permutation = p; this.typeId = p.type; this.writes++; }
    setWaterlogged(w: boolean) { this.isWaterlogged = w; }
  }
  const dp = new Map<string, unknown>();
  Object.assign(world, {
    getDynamicProperty: (k: string) => dp.get(k),
    setDynamicProperty: (k: string, v: unknown) => { if (v === undefined) dp.delete(k); else dp.set(k, v); },
    getAbsoluteTime: () => 1000,
  });

  // Metronome em (0,0,0); comparador a leste com a entrada virada para oeste (lê o bloco), outro ao sul virado de lado.
  const metro = new FakeBlock("cobblemon:metronome", new FakePerm({ [METRONOME_ACTIVE_STATE]: true, [COMPARATOR_FACES_STATE]: 0 }), { x: 0, y: 0, z: 0 });
  new FakeBlock("minecraft:unpowered_comparator", new FakePerm({ "minecraft:cardinal_direction": "west" }), { x: 1, y: 0, z: 0 });
  new FakeBlock("minecraft:unpowered_comparator", new FakePerm({ "minecraft:cardinal_direction": "east" }), { x: 0, y: 0, z: 1 });
  metro.isWaterlogged = true;
  assert.equal(updateBlock(metro as never), true);
  assert.equal(metro.permutation.getState(COMPARATOR_FACES_STATE), 2);
  assert.equal(metro.typeId, "cobblemon:metronome");
  assert.equal(metro.replaced, 1, "faces mudaram: bloco recolocado (o circuito só religa o produtor ao pôr o bloco)");
  assert.equal(metro.isWaterlogged, true, "água mantida ao recolocar");
  assert.equal(updateBlock(metro as never), false, "sem mudança não grava de novo");
  metro.permutation = metro.permutation.withState(METRONOME_ACTIVE_STATE, false);
  updateBlock(metro as never);
  assert.equal(metro.permutation.getState(COMPARATOR_FACES_STATE), 0);
  assert.equal(metro.replaced, 2);

  // Healing Machine em (10,0,0) com comparador ao norte lendo; carga 35 % gravada com o medidor velho (0).
  const healer = new FakeBlock("cobblemon:healing_machine", new FakePerm({
    [HEALER_CHARGE_STATE]: 0, "cobblemon:busy": false, "cobblemon:active": false, "cobblemon:natural": true, [COMPARATOR_FACES_STATE]: 0, [HEALER_HIGH_STATE]: false,
  }), { x: 10, y: 0, z: 0 });
  new FakeBlock("minecraft:powered_comparator", new FakePerm({ "minecraft:cardinal_direction": "south" }), { x: 10, y: 0, z: -1 });
  dp.set("cobblemon:healer|minecraft:overworld|10,0,0", JSON.stringify({ c: 2.1, t: 1000 }));
  updateBlock(healer as never);
  const lvl = Number(healer.permutation.getState(HEALER_CHARGE_STATE));
  assert.equal(lvl, 5, "medidor refeito: floor(15 × 0,35)");
  assert.equal(healer.permutation.getState(COMPARATOR_FACES_STATE), 1);
  assert.equal(healerPower(lvl, healer.permutation.getState(HEALER_HIGH_STATE) === true), 3);
  assert.equal(healer.permutation.getState("cobblemon:natural"), true, "variante natural preservada");
  assert.equal(healer.replaced, 1);
  // Carga 40 %: medidor 6, sinal 4 (só a força muda: sem recolocar).
  dp.set("cobblemon:healer|minecraft:overworld|10,0,0", JSON.stringify({ c: 2.4, t: 1000 }));
  updateBlock(healer as never);
  assert.equal(healerPower(Number(healer.permutation.getState(HEALER_CHARGE_STATE)), healer.permutation.getState(HEALER_HIGH_STATE) === true), 4);
  assert.equal(healer.replaced, 1, "mudança só de força não recoloca");
  // Tirar o comparador zera a saída.
  grid.delete("10,0,-1");
  updateBlock(healer as never);
  assert.equal(healer.permutation.getState(COMPARATOR_FACES_STATE), 0);
  assert.equal(healer.permutation.getState(HEALER_HIGH_STATE), false);
}

// 7. Blocos gerados pelo importador (quando `npm run import` já rodou)
{
  const dir = "generated/behavior_packs/CobblemonBedrock/blocks/cobblemon";
  const at = (v: string) => v.split(".").map(Number);
  const geq = (a: string, b: string) => { const x = at(a), y = at(b); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return true; };
  for (const [name, perms] of [["healing_machine", healerPermutations()], ["metronome", metronomePermutations()]] as const) {
    const file = `${dir}/${name}.json`;
    if (!existsSync(file)) continue;
    const j = JSON.parse(readFileSync(file, "utf8"));
    const b = j["minecraft:block"];
    assert.ok(geq(j.format_version, PRODUCER_FORMAT), `${name}: formato ${j.format_version}`);
    assert.ok(b.description.states[COMPARATOR_FACES_STATE], `${name}: estado de máscara`);
    const all = [b.components, ...b.permutations.map((p: { components: object }) => p.components)];
    assert.ok(!all.some((c: object) => "minecraft:redstone_consumer" in c), `${name}: sem redstone_consumer`);
    const producers = b.permutations.filter((p: { components: object }) => "minecraft:redstone_producer" in p.components);
    assert.equal(producers.length, perms.length);
    for (const p of perms) {
      const g = producers.find((x: { condition: string }) => x.condition === p.condition);
      assert.ok(g, `${name}: permutação ${p.power}/${p.mask}`);
      assert.deepEqual(g.components["minecraft:redstone_producer"], { power: p.power, connected_faces: facesOf(p.mask) });
    }
    // Produto dos estados (com a direção): o limite de 65.536 é do mundo inteiro.
    let product = 4;
    for (const v of Object.values(b.description.states) as unknown[]) product *= Array.isArray(v) ? v.length : ((v as { values: { min: number; max: number } }).values.max - (v as { values: { min: number; max: number } }).values.min + 1);
    assert.ok(product <= (name === "healing_machine" ? 16384 : 128), `${name}: ${product} combinações`);
  }
  assert.equal(healerSignal(6, 6), 10);
}

// 8. Recarga da Healing Machine por tick do servidor (HealingMachineBlockEntity.TICKER), não pelo tempo absoluto
//    (que para com doDaylightCycle false), sem recarga offline: servidor parado ou chunk descarregado.
{
  const dp = new Map<string, unknown>();
  let loadedChunk = true;
  Object.assign(world, {
    getDynamicProperty: (k: string) => dp.get(k),
    setDynamicProperty: (k: string, v: unknown) => { if (v === undefined) dp.delete(k); else dp.set(k, v); },
    getDynamicPropertyIds: () => [...dp.keys()],
    // Ciclo do dia desligado: o tempo absoluto não anda.
    getAbsoluteTime: () => 777,
    getDimension: () => ({ isChunkLoaded: () => loadedChunk }),
  });
  const sys = system as unknown as { currentTick: number; runInterval: () => number };
  Object.assign(system, { currentTick: 100, runInterval: () => 0 });
  const perm = (states: Record<string, unknown>) => ({
    states,
    getState(k: string) { return this.states[k]; },
    withState(k: string, v: unknown) { return perm({ ...this.states, [k]: v }); },
  });
  const block = {
    typeId: "cobblemon:healing_machine",
    location: { x: 3, y: 64, z: 3 },
    dimension: { id: "minecraft:overworld" },
    permutation: perm({ [HEALER_CHARGE_STATE]: 0 }),
    setPermutation(p: ReturnType<typeof perm>) { this.permutation = p; },
  };
  const key = "cobblemon:healer|minecraft:overworld|3,64,3";
  const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} ≠ ${b}`);
  const perTick = maxHealerCharge() / (900 * 20);

  resetHealerClockForTests();
  dp.set("cobblemon:healer_clock", 5000);
  assert.equal(healerClock(), 5000, "relógio retoma do valor gravado");
  writeCharge(block as never, 0, false);
  assert.equal(JSON.parse(String(dp.get(key))).s, 5000);
  sys.currentTick += 1800;
  close(readCharge(block as never), 1800 * perTick, "sobe por tick com o tempo absoluto parado");

  // Reinício: o relógio gravado continua de onde parou; nada sobe com o servidor parado.
  dp.set("cobblemon:healer_clock", healerClock());
  resetHealerClockForTests();
  sys.currentTick = 0;
  close(readCharge(block as never), 1800 * perTick, "sem recarga com o servidor parado");
  sys.currentTick = 600;
  close(readCharge(block as never), 2400 * perTick, "volta a subir depois do reinício");

  // Chunk descarregado: parado enquanto estiver fora (granularidade do laço).
  trackUnloadedHealers();
  loadedChunk = false;
  trackUnloadedHealers();
  sys.currentTick += 3000;
  loadedChunk = true;
  trackUnloadedHealers();
  close(readCharge(block as never), 2400 * perTick, "sem recarga com o chunk descarregado");
  sys.currentTick += 20;
  close(readCharge(block as never), 2420 * perTick, "sobe de novo com o chunk carregado");

  // Cheia não passa do máximo; infinita fica no máximo.
  sys.currentTick += 10 * 900 * 20;
  close(readCharge(block as never), maxHealerCharge(), "limite");
  writeCharge(block as never, 1, true);
  close(readCharge(block as never), maxHealerCharge(), "infinita");

  // Registro antigo (tick de getAbsoluteTime): convertido uma vez ao carregar o mundo, com a carga de agora.
  dp.set(key, JSON.stringify({ c: 1, t: 777 - 1800 }));
  resetHealerClockForTests();
  startHealerClock();
  const migrated = JSON.parse(String(dp.get(key)));
  assert.equal(typeof migrated.s, "number", "registro antigo ganha o tick do relógio");
  close(migrated.c, 1 + 1800 * perTick, "carga do registro antigo preservada");
  sys.currentTick += 1200;
  close(readCharge(block as never), 1 + 3000 * perTick, "registro convertido sobe por tick");
  assert.equal(chargeFromRecord({ c: 2, s: 100 }, 6, 50, () => 0), 2, "tick do registro à frente do relógio: sem carga negativa");
}

console.log("comparadores: ok");
