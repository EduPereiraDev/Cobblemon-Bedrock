// Frente msd-beta (1º teste de um pacote de extensão no cliente real, 2026-09-29): o que o content log e os prints
// acusaram e que o base corrige de forma genérica (nada aqui é de uma extensão específica).
// 1. Partícula: v.particle_* lido no creation_expression do emissor ("unhandled request for unknown variable
//    'variable.particle_age'") vai para a inicialização da partícula; `rand(a, b)` ("unknown token") vira math.random.
//    O validate acusa os dois.
// 2. Tile de golpe: nome mais largo que a linha (o rótulo quebrava e a última palavra sumia: "Dança das") vai para a linha
//    NAME_LONG (escala menor, até 2 linhas); larguras medidas nos .lang dos packs no build.
// 3. Retratos: o índice gerado aceita entradas extras (addPortraitIndex).
// 4. Conquistas: ícones vanilla mapeados.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bareMolangCalls, fixBareMolangCalls, guardParticleVariables, molangStatements, moveParticleScopeStatements, particleScopeReadsInEmitter,
  particleVariableProblems,
} from "../tools/importer/molangVars.ts";
import { clientSafeParticle, repairParticleMolang } from "../tools/importer/particles.ts";
import { moveNameIsLong, moveTileText } from "../scripts/GUI/Battle";
import { MOVE_NAME, MOVE_TILE_LINES } from "../scripts/GUI/layoutSpec";
import { addPortraitIndex, hasPortrait, portraitIconTexture } from "../generated/scripts/portraits";
// @ts-ignore módulo .mjs de ferramenta (sem tipos)
import { MIN_TRACKED_WIDTH, moveNameWidthsSource, readMoveNameWidths } from "../tools/ui/moveNameWidths.mjs";

const ROOT = process.cwd();

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Partículas

/** Rastro em espiral como vem do Snowstorm: ângulos da partícula calculados no creation_expression do emissor. */
function spiral(): any {
  return {
    particle_effect: {
      description: { identifier: "test:spiral" },
      components: {
        "minecraft:emitter_initialization": { creation_expression: "v.entity_size = v.entity_size ?? 1; variable.theta = -variable.particle_age * 360 + variable.particle_random_2 * 180;variable.phi = -90 + variable.particle_age * 90;" },
        "minecraft:emitter_rate_steady": { spawn_rate: 45, max_particles: 100 },
        "minecraft:emitter_shape_point": { offset: ["variable.particle_random_1 - 0.5", 0, 0] },
        "minecraft:particle_motion_parametric": { relative_position: ["math.cos(variable.theta)", "math.sin(variable.phi)", 0] },
        "minecraft:particle_motion_dynamic": { linear_acceleration: ["0 + rand(-0.3, 0.3)", 0, "0 + rand(-0.2, 0.2)"] },
      },
    },
  };
}

test("partícula: v.particle_* no emissor é acusado; nas formas do emissor (por partícula) não", () => {
  const p = spiral();
  assert.deepEqual(particleScopeReadsInEmitter(p.particle_effect), ["minecraft:emitter_initialization: v.particle_age", "minecraft:emitter_initialization: v.particle_random_2"]);
  const problems = particleVariableProblems(p);
  assert.ok(problems.some((m) => m.includes("escopo do emissor")), problems.join("\n"));
  assert.ok(problems.some((m) => m.includes("rand(...)")), problems.join("\n"));
});

test("partícula: comandos com v.particle_* saem do emissor para a partícula, na ordem", () => {
  const p = spiral();
  assert.equal(moveParticleScopeStatements(p), 2);
  const c = p.particle_effect.components;
  assert.equal(c["minecraft:emitter_initialization"].creation_expression, "v.entity_size = v.entity_size ?? 1;");
  assert.equal(c["minecraft:particle_initialization"].per_update_expression, "variable.theta = -variable.particle_age * 360 + variable.particle_random_2 * 180; variable.phi = -90 + variable.particle_age * 90;");
  assert.deepEqual(particleScopeReadsInEmitter(p.particle_effect), []);
  assert.equal(moveParticleScopeStatements(p), 0, "idempotente");
  // Já havia per_update_expression na partícula: os movidos vêm antes.
  const q = spiral();
  q.particle_effect.components["minecraft:particle_initialization"] = { per_update_expression: "v.k = 1" };
  moveParticleScopeStatements(q);
  assert.ok(q.particle_effect.components["minecraft:particle_initialization"].per_update_expression.endsWith("; v.k = 1;"));
  // Tudo do emissor era da partícula: o componente some.
  const r = { particle_effect: { components: { "minecraft:emitter_initialization": { creation_expression: "v.a = v.particle_age;" } } } };
  moveParticleScopeStatements(r);
  assert.equal((r.particle_effect.components as any)["minecraft:emitter_initialization"], undefined);
});

test("partícula: `;` dentro de loop/chaves não separa comandos", () => {
  assert.deepEqual(molangStatements("v.a = 1; loop(2, {v.b = v.b + 1; v.c = 2;}); v.d = 'x;y';"), ["v.a = 1", "loop(2, {v.b = v.b + 1; v.c = 2;})", "v.d = 'x;y'"]);
});

test("partícula: rand(a, b) → math.random(a, b); loop/for_each/math.* não são chamadas soltas", () => {
  assert.equal(fixBareMolangCalls("0 + rand(-0.3, 0.3)"), "0 + math.random(-0.3, 0.3)");
  assert.equal(repairParticleMolang("0 + rand(-0.2, 0.2)"), "0 + math.random(-0.2, 0.2)");
  assert.deepEqual(bareMolangCalls("loop(2, {v.a = math.sin(q.x);}); for_each(t.x, q.y, {});"), []);
  assert.deepEqual(bareMolangCalls("foo(1) + rand(1, 2)"), ["foo", "rand"]);
  assert.equal(fixBareMolangCalls("foo(1)"), "foo(1)", "desconhecida fica (o validate acusa)");
});

test("partícula: clientSafeParticle corrige o rastro inteiro e o validate não acusa mais nada", () => {
  const p = spiral();
  clientSafeParticle(p);
  guardParticleVariables(p);
  assert.deepEqual(particleVariableProblems(p), []);
  const json = JSON.stringify(p);
  assert.ok(!json.includes("rand("), json);
  assert.ok(json.includes("math.random(-0.3, 0.3)"));
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Tile de golpe: nome longo

test("tile de golpe: nome mais largo que a linha vai para NAME_LONG (linha vazia antes)", () => {
  const limit = MOVE_NAME.WIDTH / MOVE_NAME.SCALE;
  const widths = { swordsdance: 98, tackle: 40 };
  assert.ok(limit > 96 && limit < 98);
  assert.equal(moveNameIsLong("swordsdance", "", widths), true, "Dança das Espadas (98 px) quebrava no cliente");
  assert.equal(moveNameIsLong("tackle", "", widths), false);
  assert.equal(moveNameIsLong("tackle", "Z-", { tackle: 90 }), true, "Z- soma");
  assert.equal(moveNameIsLong("naoexiste", "", widths), false);
  assert.equal(moveNameIsLong(undefined, "", widths), false);
  assert.equal(MOVE_TILE_LINES.NAME_LONG, MOVE_TILE_LINES.NAME + 1);
  // Sem tabela (stub dos testes), o texto continua com 3 linhas e o nome na última.
  const text = moveTileText("tackle", 35, 35, false, undefined, []);
  const flat = JSON.stringify(text);
  assert.equal((flat.match(/\\n/g) ?? []).length, 2, flat);
});

test("tile de golpe: larguras lidas dos .lang de todos os RPs de dist/ (a maior entre as línguas)", () => {
  const dist = mkdtempSync(join(tmpdir(), "move-names-"));
  try {
    for (const [pack, lang, lines] of [
      ["A", "en_US", ["cobblemon.move.swordsdance=Swords Dance", "cobblemon.move.tackle=Tackle"]],
      ["A", "pt_BR", ["cobblemon.move.swordsdance=Dança das Espadas", "cobblemon.move.tackle=Investida"]],
      ["B", "pt_BR", ["cobblemon.move.zzlongo=Um Nome de Golpe Bem Comprido Mesmo", "outra.chave=Muito muito muito muito longa"]],
    ] as const) {
      mkdirSync(join(dist, "resource_packs", pack, "texts"), { recursive: true });
      writeFileSync(join(dist, "resource_packs", pack, "texts", `${lang}.lang`), lines.join("\n"));
    }
    const w = readMoveNameWidths(dist);
    assert.ok(w.swordsdance > 96, `${w.swordsdance}`);
    assert.ok(w.zzlongo > 140, "o nome do pack B entra");
    assert.equal(w.tackle, undefined, `curto (< ${MIN_TRACKED_WIDTH} px) fica de fora`);
    assert.equal(Object.keys(w).some((k) => k.includes("chave")), false);
    assert.ok(moveNameWidthsSource(w).includes("MOVE_NAME_WIDTHS_BUILT: boolean = true"));
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test("tile de golpe: o layout tem a área do nome longo (2 linhas na escala menor)", () => {
  const battle = readFileSync(join(ROOT, "resource_packs", "CobblemonBedrock", "ui", "battle.json"), "utf8");
  assert.ok(battle.includes(`"font_scale_factor":${MOVE_NAME.LONG_SCALE}`), "rótulo na escala do nome longo");
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Retratos

test("retratos: addPortraitIndex acrescenta e troca entradas", () => {
  assert.equal(hasPortrait("zz_teste"), false);
  assert.equal(addPortraitIndex({ zz_teste: ["012", "000"] }), 1);
  assert.equal(hasPortrait("zz_teste"), true);
  assert.ok(portraitIconTexture("zz_teste", 2).endsWith("zz_teste_2"));
  assert.equal(addPortraitIndex({ zz_teste: ["012", "000"] }), 0, "igual não conta");
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Conquistas

test("conquistas: ícones vanilla usados por extensões", () => {
  const src = readFileSync(join(ROOT, "tools", "importer", "advancements.ts"), "utf8");
  for (const id of ["glowstone_dust", "iron_pickaxe", "spyglass"]) assert.ok(src.includes(`"minecraft:${id}": "items/${id}"`), id);
  assert.ok(/export class IconResolver/.test(src));
});

console.log(`cliente-beta-extensao: ${passed} testes ok`);
