// Frente cliente-teste4 (docs/pendencias/cliente-teste4.md): o que sobrou no content log do 4º teste em cliente.
// 1. Partícula: o tempo de vida do emissor (emitter_lifetime_*) é avaliado antes do creation_expression; a leitura
//    ali precisa do guarda na própria expressão, `(v.x ?? padrão)` (evo_sparkleburst: "unknown variable
//    'variable.entity_size'" com o guarda no creation_expression).
// 2. Spawner: a fatia "espaço" cede entre leituras de bloco; uma leitura parada (chamada indivisível) aparece no
//    aviso como tal. A contagem de leituras não muda o resultado (mesmo espaço, mesma seleção com semente fixa).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  guardParticleVariables, guardPreInitReads, inlineGuardReads, particlePreInitReads, particleVariableProblems,
} from "../tools/importer/molangVars.ts";
import { CellInfo, makeHasSpace, makeHasSpaceJob, ReadStats, singleReadNote, ZoneBlockCache } from "../scripts/spawning/Spawner";

const ROOT = process.cwd();
const GEN = join(ROOT, "generated/resource_packs");

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Partículas

/** evo_sparkleburst como sai do Java (q.entity_size → v.entity_size) e com o guarda antigo no creation_expression. */
function sparkleburst(): any {
  return {
    particle_effect: {
      description: { identifier: "cobblemon:evo_sparkleburst" },
      components: {
        "minecraft:emitter_initialization": { creation_expression: "v.entity_size = v.entity_size ?? 1;" },
        "minecraft:emitter_rate_instant": { num_particles: "35 * math.clamp(v.entity_size,1,2)" },
        "minecraft:emitter_lifetime_once": { active_time: "0.5 * math.clamp(v.entity_size,1,2)" },
        "minecraft:emitter_shape_sphere": { radius: "math.clamp(v.entity_size,1,2)/2", surface_only: true, direction: "outwards" },
      },
    },
  };
}

test("regra: leitura no tempo de vida do emissor com o guarda só no creation_expression é erro", () => {
  const p = sparkleburst();
  assert.deepEqual(particlePreInitReads(p.particle_effect), ["entity_size"]);
  const problems = particleVariableProblems(p);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /tempo de vida do emissor.*v\.entity_size/);
});

test("guarda na expressão: (v.x ?? padrão) no emitter_lifetime_*, o resto continua no creation_expression", () => {
  const p = sparkleburst();
  assert.deepEqual(guardParticleVariables(p), ["entity_size"]);
  const c = p.particle_effect.components;
  assert.equal(c["minecraft:emitter_lifetime_once"].active_time, "0.5 * math.clamp((v.entity_size ?? 1),1,2)");
  // As outras leituras não mudam (o creation_expression já roda antes delas; 494 partículas sem erro no 4º teste).
  assert.equal(c["minecraft:emitter_rate_instant"].num_particles, "35 * math.clamp(v.entity_size,1,2)");
  assert.equal(c["minecraft:emitter_initialization"].creation_expression, "v.entity_size = v.entity_size ?? 1;");
  assert.deepEqual(particleVariableProblems(p), []);
  // Idempotente.
  const before = JSON.stringify(p);
  assert.deepEqual(guardPreInitReads(p), []);
  assert.equal(JSON.stringify(p), before);
});

test("inlineGuardReads: só leituras sem guarda, fora do motor, e não escritas antes na mesma expressão", () => {
  const def = (n: string) => (n === "entity_size" ? 1 : 0);
  assert.equal(inlineGuardReads("v.a ?? 2", def), "v.a ?? 2");
  assert.equal(inlineGuardReads("v.emitter_age * variable.Particle_random_1", def), "v.emitter_age * variable.Particle_random_1");
  assert.equal(inlineGuardReads("v.t = 1; return v.x * v.t;", def), "v.t = 1; return (v.x ?? 0) * v.t;");
  assert.equal(inlineGuardReads("math.max(variable.entity_size, v.b)", def), "math.max((variable.entity_size ?? 1), (v.b ?? 0))");
  // Looping e expression também (recalculados antes/fora da inicialização).
  const q: any = { particle_effect: { components: {
    "minecraft:emitter_lifetime_looping": { active_time: "v.life", sleep_time: 0 },
    "minecraft:emitter_lifetime_expression": { activation_expression: "v.on", expiration_expression: 0 },
  } } };
  assert.deepEqual(guardPreInitReads(q).sort(), ["life", "on"]);
  assert.equal(q.particle_effect.components["minecraft:emitter_lifetime_looping"].active_time, "(v.life ?? 0)");
  assert.equal(q.particle_effect.components["minecraft:emitter_lifetime_expression"].activation_expression, "(v.on ?? 0)");
});

test("gerado: nenhuma partícula (base e MSD) lê variável sem guarda no tempo de vida do emissor", () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".json") ? [join(d, e.name)] : []);
  let checked = 0;
  for (const pack of readdirSync(GEN)) {
    let files: string[] = [];
    try { files = walk(join(GEN, pack, "particles")); } catch { continue; }
    for (const f of files) {
      const j = JSON.parse(readFileSync(f, "utf8"));
      if (!j?.particle_effect) continue;
      checked++;
      assert.deepEqual(particlePreInitReads(j.particle_effect), [], f);
    }
  }
  assert.ok(checked > 1000, `partículas conferidas: ${checked}`);
  const evo = JSON.parse(readFileSync(join(GEN, "CobblemonBedrock/particles/cobblemon/evo_sparkleburst.particle.json"), "utf8"));
  assert.equal(evo.particle_effect.components["minecraft:emitter_lifetime_once"].active_time, "0.5 * math.clamp((v.entity_size ?? 1),1,2)");
  assert.deepEqual(particleVariableProblems(evo), []);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Spawner

const air: CellInfo = { kind: "air", typeId: "minecraft:air" };
const stone: CellInfo = { kind: "solid", typeId: "minecraft:stone" };
const busy = (ms: number) => { const until = Date.now() + ms; while (Date.now() < until) { /* custo */ } };

test("fatia 'espaço': cede entre leituras; a fatia nunca junta mais que o orçamento + uma leitura", () => {
  const read = (_x: number, y: number): CellInfo => { busy(1); return y <= 64 ? stone : air; };
  const cache = new ZoneBlockCache(read, 10000);
  // A coluna da posição já vem lida (resolvePositions guarda do fundo da zona até o topo + folga).
  for (let y = 63; y <= 80; y++) cache.put(10, y, 20, y <= 64 ? stone : air);
  const job = makeHasSpaceJob(cache, 10, 64, 20, "grounded", undefined, 12)(5, 6, 3);
  let start = Date.now(), worst = 0, yields = 0;
  let step = job.next();
  while (!step.done) {
    worst = Math.max(worst, Date.now() - start);
    yields++;
    start = Date.now();
    step = job.next();
  }
  assert.equal(step.value, true);
  assert.ok(yields >= 10, `cedeu ${yields}×`);
  assert.ok(worst <= 3 + 1 + 3, `maior fatia ${worst} ms`); // orçamento 3 ms + a leitura em curso (1 ms) + folga do relógio
});

test("leitura parada (chamada indivisível) vira a fatia inteira e aparece no aviso como tal", () => {
  let n = 0;
  const read = (_x: number, y: number): CellInfo => { if (++n === 7) busy(60); return y <= 64 ? stone : air; };
  const stats: ReadStats = { maxReadMs: 0, reads: 0, sliceMaxReadMs: 0 };
  const job = makeHasSpaceJob(new ZoneBlockCache(read, 10000, stats), 0, 64, 0, "grounded", undefined, 12)(3, 3, 3);
  let start = Date.now(), worst = 0, worstRead = 0;
  let step = job.next();
  while (!step.done) {
    const ms = Date.now() - start;
    if (ms > worst) { worst = ms; worstRead = stats.sliceMaxReadMs ?? 0; }
    stats.sliceMaxReadMs = 0;
    start = Date.now();
    step = job.next();
  }
  assert.ok(stats.maxReadMs >= 60 && stats.reads === n, `maior ${stats.maxReadMs} ms, ${stats.reads} leituras`);
  assert.ok(worstRead >= worst * 0.8, `fatia ${worst} ms, leitura ${worstRead} ms`);
  assert.match(singleReadNote(worst, worstRead), /numa única leitura de bloco/);
  assert.equal(singleReadNote(57, 3), ""); // trabalho espalhado: sem a nota
});

test("medir as leituras não muda o espaço (mesmo resultado, mesmas leituras)", () => {
  const solid = new Set(["12,66,21", "6,65,5"]);
  const read = (x: number, y: number, z: number): CellInfo => (y <= 64 || solid.has(`${x},${y},${z}`) ? stone : air);
  for (const [x, z, w, h] of [[10, 20, 3, 3], [5, 5, 4, 5], [0, 0, 2, 2], [12, 21, 1, 3]]) {
    const plain = new ZoneBlockCache(read, 10000);
    const stats: ReadStats = { maxReadMs: 0, reads: 0 };
    const measured = new ZoneBlockCache(read, 10000, stats);
    assert.equal(makeHasSpace(measured, x, 64, z, "grounded", undefined, 10)(w, h), makeHasSpace(plain, x, 64, z, "grounded", undefined, 10)(w, h));
    assert.equal(measured.reads, plain.reads);
    assert.equal(stats.reads, plain.reads);
  }
});

console.log(`cliente-teste4: ${passed} testes ok`);
