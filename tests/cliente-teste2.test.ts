// Frente fix3 (docs/pendencias/cliente-teste2.md): segundo teste em cliente real.
// 1. Pilha de script: o parser/avaliador de MoLang não pode gastar dezenas de chamadas por nível (o Bedrock derruba o
//    mundo num StackOverflow, sem catch; orçamento medido no BDS ≈ 330 chamadas simples, menor no cliente Windows).
import assert from "node:assert/strict";
import { MoEnvironment, asNumber, parseMoLang, parseTokens, tokenize } from "../scripts/npc/molang/MoLang";
import { SLICE_BUDGET_MS, SliceClock, selectSpawnActions, selectSpawnActionsJob, warmSpawnIndex } from "../scripts/spawning/SpawnSelector";
import { BEST_SPAWNER_CONFIG } from "../generated/scripts/spawns";
import { FRAMING, STUDIO_UI_HEIGHT, cameraFor, profileFramingOf } from "../scripts/ui/studio";
import type { StudioFraming } from "../scripts/ui/studio";
import { ENTITY_INFO } from "../generated/scripts/entityData";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

Error.stackTraceLimit = Infinity;
const stackDepth = () => new Error().stack!.split("\n").length;

/** Maior profundidade de pilha (em chamadas) do parser, medida a cada leitura de token. */
function parseDepth(source: string): number {
  const tokens = tokenize(source);
  const base = stackDepth();
  let max = 0;
  const proxy = new Proxy(tokens, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) max = Math.max(max, stackDepth() - base);
      return Reflect.get(target, key, receiver);
    },
  });
  parseTokens(proxy, source);
  return max;
}

/** Maior profundidade de pilha da avaliação (medida dentro de q.probe(), no fundo da expressão). */
function evalDepth(source: string): number {
  const env = new MoEnvironment();
  let max = 0;
  const base = stackDepth();
  env.query.fn("probe", () => { max = Math.max(max, stackDepth() - base); return 0.5; });
  env.eval(source);
  return max;
}

const RIDE_PITCH = "math.max(1.0 ,0.2 + math.pow(math.min(q.ride_velocity() / 1.5, 1.0),2))";

await test("MoLang: precedência e associatividade iguais às do parser antigo (7 níveis)", () => {
  const env = new MoEnvironment();
  const n = (s: string) => asNumber(env.eval(s));
  assert.equal(n("2 - 3 - 4"), -5);
  assert.equal(n("8 / 4 / 2"), 1);
  assert.equal(n("1 + 2 * 3"), 7);
  assert.equal(n("(1 + 2) * 3"), 9);
  assert.equal(n("-2 * 3"), -6);
  assert.equal(n("!1 + 1"), 1);
  assert.equal(n("1 < 2 == 1"), 1);
  assert.equal(n("1 + 1 == 2 && 3 > 2"), 1);
  assert.equal(n("1 || 0 && 0"), 1); // && liga mais forte que || (como antes)
  assert.equal(n("0 && 1 || 1"), 1);
  assert.equal(n("v.nada ?? 1 + 2"), 3); // ?? é o mais fraco dos binários
  assert.equal(n("1 ? 2 : 3 + 4"), 2);
  assert.equal(n("0 ? 2 : 1 ? 5 : 6"), 5);
  assert.equal(n("v.a = 2 + 3; v.a * 2"), 10);
  assert.equal(n("math.max(1.0, 0.2 + math.pow(math.min(0.75 / 1.5, 1.0), 2))"), 1);
  assert.equal(n("math.pow(math.min(3 / 1.5, 1.0), 2)"), 1);
  assert.deepEqual(parseMoLang("x - y * z")[0], {
    k: "binary", op: "-",
    left: { k: "member", obj: { k: "root", name: "variable" }, name: "x" },
    right: { k: "binary", op: "*", left: { k: "member", obj: { k: "root", name: "variable" }, name: "y" }, right: { k: "member", obj: { k: "root", name: "variable" }, name: "z" } },
  });
});

await test("MoLang: som da montaria aquática cabe com folga na pilha curta do Bedrock (regressão do StackOverflow)", () => {
  const parse = parseDepth(RIDE_PITCH);
  const evaluation = evalDepth(RIDE_PITCH.replace("q.ride_velocity()", "q.probe()"));
  // Antes: ~27 chamadas por nível de aninhamento (7 níveis de binaryLevel + closure) → ~110 no parser desta expressão.
  assert.ok(parse <= 45, `parser usa ${parse} chamadas`);
  assert.ok(evaluation <= 30, `avaliação usa ${evaluation} chamadas`);
});

await test("MoLang: custo por nível de aninhamento é pequeno e constante", () => {
  const nested = (k: number) => { let s = "q.probe()"; for (let i = 0; i < k; i++) s = `math.max(1, 0.5 + ${s} * 2)`; return s; };
  const perLevelParse = (parseDepth(nested(12)) - parseDepth(nested(2))) / 10;
  const perLevelEval = (evalDepth(nested(12)) - evalDepth(nested(2))) / 10;
  assert.ok(perLevelParse <= 12, `parser: ${perLevelParse} chamadas por nível`);
  assert.ok(perLevelEval <= 8, `avaliação: ${perLevelEval} chamadas por nível`);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Spawner: o orçamento vale para a fatia inteira (cliente: "passe lento: 21–37 ms na maior fatia (bucket; …)")

await test("spawner: relógio de fatia compartilhado", () => {
  const clock = new SliceClock(2);
  assert.equal(clock.due, false);
  const until = performance.now() + 2.5;
  while (performance.now() < until) { /* espera */ }
  assert.equal(clock.due, true);
  assert.ok(clock.remaining >= 0.5);
  clock.reset();
  assert.equal(clock.due, false);
});

await test("spawner: bucket com muitas posições cede dentro do orçamento e escolhe o mesmo que a seleção síncrona", () => {
  const w = warmSpawnIndex();
  for (let r = w.next(); !r.done; r = w.next()) { }
  const dim: any = { id: "minecraft:overworld", containsBlock: () => false };
  // hasSpace de ~0,05 ms (leitura de blocos): 24–90 posições × dezenas de candidatas.
  const spin = (ms: number) => { const until = performance.now() + ms; while (performance.now() < until) { } };
  const ctx = (i: number, biome: string): any => ({
    dimension: dim, location: { x: 100 + (i % 10) * 2 + 0.5, y: 70, z: 200 + Math.floor(i / 10) * 2 + 0.5 }, blockY: 69, positionType: i % 5 === 4 ? "surface" : "grounded", biome,
    baseBlock: i % 5 === 4 ? "minecraft:water" : "minecraft:grass_block", skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false,
    height: 8, depth: 3, fluid: i % 5 === 4 ? "water" : undefined, zoneHasAny: () => true, hasSpace: () => { spin(0.05); return true; },
  });
  const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const opts = (random: () => number): any => ({ buckets: BEST_SPAWNER_CONFIG.worldBuckets, positionTypeWeights: BEST_SPAWNER_CONFIG.spawnablePositionTypeWeights, maxSpawns: 8, minDistanceBetweenEntities: 8, influences: [], random });
  const slices: number[] = [];
  for (const [run, n, biome] of [[1, 60, "plains"], [2, 24, "forest"], [3, 90, "river"]] as const) {
    const p1 = Array.from({ length: n }, (_, i) => ctx(i, biome));
    const p2 = Array.from({ length: n }, (_, i) => ctx(i, biome));
    const sync = selectSpawnActions(p1, opts(seeded(run)));
    const job = selectSpawnActionsJob(p2, opts(seeded(run)));
    let t = performance.now();
    let r = job.next();
    while (true) {
      slices.push(performance.now() - t);
      if (r.done) break;
      t = performance.now();
      r = job.next();
    }
    assert.deepEqual(r.value.map((x) => [x.entry.id, p2.indexOf(x.ctx)]), sync.map((x) => [x.entry.id, p1.indexOf(x.ctx)]), `${biome}: mesma seleção`);
  }
  slices.sort((a, b) => a - b);
  const p99 = slices[Math.floor(slices.length * 0.99)];
  // Antes (um relógio por posição): maior fatia de ~24 ms com 24 posições e ~86 ms com 90 (Node --jitless).
  assert.ok(p99 <= SLICE_BUDGET_MS + 2, `p99 das fatias ${p99.toFixed(2)} ms`);
  assert.ok(slices[slices.length - 1] <= SLICE_BUDGET_MS * 4, `maior fatia ${slices[slices.length - 1].toFixed(2)} ms`);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Estúdio 3D: o modelo cabe na janela em qualquer altura de UI até 480 px (cliente: UI ~360 px, Charmander vazava)

type V = { x: number; y: number; z: number };
/** Projeção (px da UI, relativo ao centro da tela, y para cima) com a câmera olhando `facing`, FOV vertical de 60°. */
function project(p: V, cam: V, facing: V, uiHeight: number, fov = 60): { x: number; y: number } {
  const sub = (a: V, b: V) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm = (a: V) => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
  const cross = (a: V, b: V) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const f = norm(sub(facing, cam));
  const r = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const u = cross(r, f);
  const d = sub(p, cam);
  const t = Math.tan((fov * Math.PI) / 360);
  const depth = dot(d, f);
  return { x: (dot(d, r) / depth / t) * (uiHeight / 2), y: (dot(d, u) / depth / t) * (uiHeight / 2) };
}

/** Caixa do modelo (colisão × escala da forma) projetada: devolve [esquerda, direita, baixo, cima] em px da UI. */
function modelRect(species: string, framing: StudioFraming, uiHeight: number) {
  const size = ENTITY_INFO[species].sizes[0];
  const h = size.height * size.scale, w = size.width * size.scale * 1.3;
  const stage = { x: 0.5, y: 100, z: 0.5 };
  const cam = cameraFor(stage, { height: h * 1.02, width: w, scale: size.scale, profile: profileFramingOf(species) }, framing);
  const pts: { x: number; y: number }[] = [];
  for (const dx of [-w / 2, w / 2]) for (const dy of [0, h]) for (const dz of [-w / 2, w / 2]) pts.push(project({ x: stage.x + dx, y: stage.y + dy, z: stage.z + dz }, cam.location, cam.facing, uiHeight));
  return { left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), bottom: Math.min(...pts.map((p) => p.y)), top: Math.max(...pts.map((p) => p.y)), distance: cam.distance };
}

await test("estúdio: Bulbasaur, Charmander, Squirtle, Wooper, Onix e outros cabem na janela do inicial e do resumo (UI 270–480 px)", () => {
  const species = ["bulbasaur", "charmander", "squirtle", "wooper", "onix", "pikachu", "eevee", "piplup", "rowlet", "snorlax", "lapras", "chikorita"];
  for (const [name, framing] of [["inicial", FRAMING.starter], ["resumo", FRAMING.summary]] as const) {
    const win = framing.window;
    for (const sp of species) {
      for (const ui of [270, 360, 400, 480]) {
        const r = modelRect(sp, framing, ui);
        const where = `${name} ${sp} UI ${ui} (${r.bottom.toFixed(0)}..${r.top.toFixed(0)} × ${r.left.toFixed(0)}..${r.right.toFixed(0)}; janela ${win.top - win.height}..${win.top} × ±${win.width / 2})`;
        assert.ok(r.top <= win.top && r.bottom >= win.top - win.height, `altura: ${where}`);
        assert.ok(r.right <= win.width / 2 && r.left >= -win.width / 2, `largura: ${where}`);
      }
    }
  }
});

await test("estúdio: no tamanho do Java (ModelWidget do inicial: 54 × profileScale px por bloco do modelo) na UI de referência", () => {
  // Charmander: profileScale 0,73, ty 0,66 → pés 82,8 px abaixo do topo da janela (−1,3 px do centro da tela) e
  // 1,31 bloco de modelo × 39,4 px = 51,7 px de altura; na UI de referência o estúdio reproduz isso.
  const size = ENTITY_INFO.charmander.sizes[0];
  const r = modelRect("charmander", FRAMING.starter, STUDIO_UI_HEIGHT);
  const javaHeight = 54 * profileFramingOf("charmander")[0] * size.height; // colisão do modelo, sem a escala do mundo
  assert.ok(Math.abs(r.top - r.bottom - javaHeight * 1.02) / javaHeight < 0.15, `altura ${(r.top - r.bottom).toFixed(1)} vs Java ${javaHeight.toFixed(1)}`);
  assert.ok(Math.abs(r.bottom - -1.3) < 6, `pés em ${r.bottom.toFixed(1)} px (Java −1,3)`);
});

console.log(`cliente-teste2: ${passed} testes ok`);
