// Frente cliente-teste3-log (docs/pendencias/cliente-teste3-log.md): o que o content log do 3º teste em cliente acusou.
// 1. Partículas: toda variável lida e não escrita ganha `v.x = v.x ?? padrão;` no creation_expression.
// 2. Client entities: toda variável lida (render controller, animação, controller) é inicializada no pre_animation.
// 3. pokemon_model com ícone. 4. q.r.X(N) colado num número (charizard/flygon) segue o Java (o resto é ignorado).
// 5. Quirks: pick/loops no initialize. 6. fishing_line sem struct. 7. Projétil em chunk que não tica não lança erro.
// 8. Consultas preguiçosas de estrutura com orçamento por tick. 9. Montaria que não respira na água: sem
// behavior.float montada (ele derruba o passageiro) e boiando no LIQUID (buoyant).
// 10. Planos de espessura zero nas entidades ganham espessura (z-fighting).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  entityUndefinedVars, entityVarDocs, guardEntityVariables, guardParticleVariables, molangVarUses, particleVariableProblems,
} from "../tools/importer/molangVars.ts";
import { RidingMolang, rewriteMolang } from "../tools/importer/molang.ts";
import { fixBoneMolang } from "../tools/importer/animationBake.ts";
import { coplanarConflicts, flatEntityCubes, geometryFaces, isFlatEntityCube, thickenFlatEntityCubes } from "../tools/importer/zfight.ts";
import { potHitByProjectile } from "../scripts/adaptacoes/decoratedPot";
import { DECORATED_POT } from "../scripts/adaptacoes/sherds";
import { getStructuresAt, LAZY_CHECK_BUDGET_MS, setLazyStructureCheck } from "../scripts/world/StructureRegistry";

const ROOT = process.cwd();
const GEN = join(ROOT, "generated/resource_packs/CobblemonBedrock");
const GEN_BP = join(ROOT, "generated/behavior_packs/CobblemonBedrock");

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

test("molangVarUses: escrita, leitura com ?? e membro de struct", () => {
  const uses = molangVarUses("v.a = v.a ?? 1; t.x = v.b * variable.color.r; v.c == 2");
  assert.deepEqual(uses.map((u) => [u.name, u.write, u.guarded, u.member ?? ""]), [
    ["a", true, false, ""], ["a", false, true, ""], ["b", false, false, ""], ["color", false, false, "r"], ["c", false, false, ""],
  ]);
});

test("partícula: padrão para toda variável lida (alvo 0, tamanho do script, curva lida cedo)", () => {
  const p: any = {
    particle_effect: {
      components: {
        "minecraft:emitter_initialization": { creation_expression: "v.clampradius = math.max(1.65, v.entity_height);" },
        "minecraft:emitter_shape_point": { direction: ["0", "(v.burstarc/math.clamp(v.target_deltaz*0.5,1,4))", "0"] },
        "minecraft:emitter_rate_instant": { num_particles: "455*v.clampradius" },
        "minecraft:particle_appearance_billboard": { size: ["v.sizecurve", "v.sizecurve"] },
        "minecraft:particle_lifetime_expression": { max_lifetime: "v.particle_lifetime * v.entity_radius" },
      },
      curves: {
        "variable.burstarc": { type: "linear", input: "v.emitter_age", horizontal_range: "v.emitter_lifetime", nodes: [0.06, 0.5, 0.05] },
        "variable.sizecurve": { type: "catmull_rom", input: "v.particle_age", nodes: [0, 1, 0.5, 0] },
      },
    },
  };
  assert.ok(particleVariableProblems(p).length > 0, "antes: lê variável sem definir");
  const guarded = guardParticleVariables(p);
  assert.deepEqual(guarded.sort(), ["burstarc", "entity_height", "entity_radius", "target_deltaz"]);
  const init = p.particle_effect.components["minecraft:emitter_initialization"].creation_expression;
  assert.match(init, /^v\.entity_height = v\.entity_height \?\? 1; /, "padrão antes do creation_expression original");
  assert.match(init, /v\.target_deltaz = v\.target_deltaz \?\? 0;/);
  assert.match(init, /v\.entity_radius = v\.entity_radius \?\? 0\.5;/);
  assert.match(init, /v\.burstarc = v\.burstarc \?\? 0\.06;/, "curva lida na forma do emissor: valor do começo da curva");
  assert.doesNotMatch(init, /sizecurve/, "curva lida só na aparência já existe");
  assert.match(init, /v\.clampradius = math\.max/, "a expressão original continua");
  assert.deepEqual(particleVariableProblems(p), []);
  // Idempotente.
  assert.deepEqual(guardParticleVariables(p), []);
});

test("partícula: struct (variable.color.r) é problema; fishing_line usa escalares com padrão", () => {
  const p: any = { particle_effect: { components: { "minecraft:particle_appearance_tinting": { color: ["variable.color.r", "variable.color.g", "variable.color.b", 1] } } } };
  assert.ok(particleVariableProblems(p).some((m) => m.includes("struct")));
  const line = JSON.parse(readFileSync(join(ROOT, "resource_packs/CobblemonBedrock/particles/fishing/fishing_line.particle.json"), "utf8"));
  assert.deepEqual(particleVariableProblems(line), []);
  const src = readFileSync(join(ROOT, "scripts/fishing/FishingController.ts"), "utf8");
  for (const c of ["r", "g", "b"]) assert.ok(src.includes(`"variable.color_${c}"`), `script passa v.color_${c}`);
  assert.ok(!src.includes("setColorRGB"), "sem struct de cor no script");
});

test("client entity: variáveis do render controller/controller viram v.x ?? 0 no pre_animation", () => {
  const docs = entityVarDocs([["x", {
    render_controllers: { "controller.render.t": { overlay_color: { a: "v.cobblemon_gimmick_a > 0 ? v.cobblemon_gimmick_a : this" } } },
    animation_controllers: { "controller.animation.t.quirk0": { states: { play: { on_entry: ["v.loops = math.random_integer(1, 2);"], transitions: [{ wait: "q.state_time >= 0.75 * v.loops" }] } } } },
    animations: { "animation.t.ride": { bones: { neck: { rotation: ["v.cr_o_yaw_change_2 * 3", 0, "v.cr_o_pitch_change"] } } } },
  }]]);
  const desc: any = {
    identifier: "cobblemon:teste",
    animations: { quirk0: "controller.animation.t.quirk0", ride: "animation.t.ride" },
    render_controllers: ["controller.render.t"],
    scripts: { initialize: ["v.cr_o_pitch_change = 0;"], pre_animation: ["v.cr_o_yaw_change_2 = 1;"] },
  };
  assert.deepEqual([...entityUndefinedVars(desc, docs).keys()].sort(), ["cobblemon_gimmick_a", "loops"]);
  assert.deepEqual(guardEntityVariables(desc, docs).sort(), ["cobblemon_gimmick_a", "loops"]);
  assert.equal(desc.scripts.pre_animation[0], "v.cobblemon_gimmick_a = v.cobblemon_gimmick_a ?? 0; v.loops = v.loops ?? 0;");
  assert.equal(entityUndefinedVars(desc, docs).size, 0);
});

test("montaria: q.r.pitch_change(0)30 e q.r.yaw_change(2)4 seguem o Java (resto descartado)", () => {
  const riding = new RidingMolang();
  const a = fixBoneMolang(rewriteMolang("30-12.5*q.r.pitch_change(0)30*(-1*q.r.yaw_change(0))", "t", {}, riding), "t");
  assert.equal(a, "30 - (12.5 * v.cr_o_pitch_change)");
  const b = fixBoneMolang(rewriteMolang("q.r.yaw_change(2)4+q.r.roll_change(2)*-3", "t", {}, riding), "t");
  assert.equal(b, "v.cr_o_yaw_change_2");
  // Sem colagem nada muda.
  assert.equal(rewriteMolang("q.r.yaw_change(2)*-5+5", "t", {}, riding), "v.cr_o_yaw_change_2*-5+5");
});

test("planos de espessura zero das entidades ganham espessura e param de brigar", () => {
  const geo: any = {
    bones: [{
      name: "frill", pivot: [0, 0, 0], cubes: [
        { origin: [0, 10, 0], size: [13, 0, 3], uv: [0, 0] },
        { origin: [2, 10, 0], size: [4, 0, 2], uv: [20, 0], inflate: 0.01 }, // plano empilhado (separateCoplanarCubes)
        { origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 10] },
      ],
    }],
  };
  assert.equal(flatEntityCubes(geo).length, 2);
  const faces0 = geometryFaces(geo);
  assert.ok(coplanarConflicts(faces0, { doubleSided: true }).some((z) => z.opposite && z.a.cube === 0 && z.b.cube === 0), "antes: as duas faces do plano brigam");
  assert.equal(thickenFlatEntityCubes(geo), 2);
  assert.equal(flatEntityCubes(geo).length, 0);
  const [plane, stacked, solid] = geo.bones[0].cubes;
  assert.ok(!isFlatEntityCube(plane) && plane.inflate > 0);
  assert.ok(stacked.inflate - plane.inflate > 0.005, "o empilhado continua por cima");
  assert.equal(solid.inflate, undefined, "cubo sólido não muda");
  assert.ok(!coplanarConflicts(geometryFaces(geo), { doubleSided: true }).some((z) => z.opposite && z.a.cube === z.b.cube), "depois: nenhuma face oposta no mesmo plano");
});

test("vaso atingido por projétil: bloco num chunk que não tica não lança erro", () => {
  const throwing = { getBlockHit: () => ({ block: { isValid: true, get typeId(): string { throw new Error("LocationInUnloadedChunkError"); } } as any }), projectile: { typeId: "minecraft:arrow" } };
  assert.equal(potHitByProjectile(throwing), undefined);
  const invalid = { getBlockHit: () => ({ block: { isValid: false } as any }), projectile: { typeId: "minecraft:arrow" } };
  assert.equal(potHitByProjectile(invalid), undefined);
  const pot = { isValid: true, typeId: DECORATED_POT } as any;
  assert.equal(potHitByProjectile({ getBlockHit: () => ({ block: pot }), projectile: { typeId: "minecraft:arrow" } }), pot);
  assert.equal(potHitByProjectile({ getBlockHit: () => ({ block: pot }), projectile: { typeId: "cobblemon:poke_ball" } }), undefined);
});

test("estruturas: consultas preguiçosas param no orçamento do tick e voltam no seguinte", () => {
  const calls: string[] = [];
  let clock = 0;
  const now = () => clock;
  const slow = (id: string) => () => { calls.push(id); clock += LAZY_CHECK_BUDGET_MS + 1; };
  setLazyStructureCheck("t:a", slow("a"));
  setLazyStructureCheck("t:b", slow("b"));
  const dim: any = { id: "minecraft:overworld" };
  try {
    getStructuresAt(dim, { x: 0, y: 64, z: 0 }, ["t:a", "t:b"], now, 1000);
    assert.deepEqual(calls, ["a"], "a segunda consulta fica para outro tick");
    getStructuresAt(dim, { x: 0, y: 64, z: 0 }, ["t:b"], now, 1000);
    assert.deepEqual(calls, ["a"], "mesmo tick: orçamento gasto");
    getStructuresAt(dim, { x: 0, y: 64, z: 0 }, ["t:b"], now, 1001);
    assert.deepEqual(calls, ["a", "b"], "tick seguinte: roda");
  }
  finally {
    setLazyStructureCheck("t:a", undefined);
    setLazyStructureCheck("t:b", undefined);
  }
});

// ---------------------------------------------------------------------------------------------
// Conteúdo gerado (npm run import)

if (existsSync(join(GEN, "entity/pokemon/spinda.entity.json"))) {
  test("gerado: spinda/joltik/charizard/flygon sem variável lida sem inicializar", () => {
    const docs: Array<[string, any]> = [];
    for (const dir of ["animations/pokemon", "animation_controllers/pokemon", "render_controllers/pokemon"]) {
      for (const f of readdirSync(join(GEN, dir))) if (/^(spinda|joltik|charizard|flygon|cobblemon_gimmick_tint)\./.test(f)) docs.push([f, JSON.parse(readFileSync(join(GEN, dir, f), "utf8"))]);
    }
    const index = entityVarDocs(docs);
    for (const sp of ["spinda", "joltik", "charizard", "flygon", "tentacool", "bunnelby"]) {
      const desc = JSON.parse(readFileSync(join(GEN, `entity/pokemon/${sp}.entity.json`), "utf8"))["minecraft:client_entity"].description;
      const missing = [...entityUndefinedVars(desc, index).keys()].filter((n) => !/^cobblemon_(alpha|held)/.test(n));
      assert.deepEqual(missing, [], `${sp}: ${missing.join(", ")}`);
    }
    const charizard = readFileSync(join(GEN, "animations/pokemon/charizard.animation.json"), "utf8");
    const flygon = readFileSync(join(GEN, "animations/pokemon/flygon.animation.json"), "utf8");
    assert.ok(!/cr_o_pitch_change30|cr_o_yaw_change_24/.test(charizard + flygon));
  });
  test("gerado: partículas do log sem variável indefinida; pokemon_model com ícone; Garchomp boia", () => {
    for (const f of ["acid_actorfling", "stringshot_targetwrap", "blizzard_targetswirl", "explosion_actorbigring", "megadrain_actor", "fireblast_actor1", "explosion_actorfire"]) {
      const p = JSON.parse(readFileSync(join(GEN, `particles/cobblemon/${f}.particle.json`), "utf8"));
      assert.deepEqual(particleVariableProblems(p), [], f);
    }
    const item = JSON.parse(readFileSync(join(GEN_BP, "items/cobblemon/pokemon_model.json"), "utf8"));
    const icon = item["minecraft:item"].components["minecraft:icon"];
    assert.equal(typeof icon, "string");
    const atlas = JSON.parse(readFileSync(join(GEN, "textures/item_texture.json"), "utf8")).texture_data;
    assert.ok(atlas[icon], "ícone no item_texture");
    for (const sp of ["garchomp", "drampa"]) {
      const e = JSON.parse(readFileSync(join(GEN_BP, `entities/pokemon/${sp}.json`), "utf8"))["minecraft:entity"];
      assert.ok(e.component_groups["cobblemon:ride_liquid"]["minecraft:buoyant"], `${sp}: ride_liquid boia`);
      assert.equal(e.components["minecraft:buoyant"], undefined, `${sp}: a base não tem buoyant (tirar o grupo não mexe na base)`);
      // behavior.float tira o passageiro quando a cabeça afunda: fora da base e dos grupos de montaria, só no move_ai.
      assert.equal(e.components["minecraft:behavior.float"], undefined, `${sp}: sem behavior.float na base`);
      assert.ok(e.component_groups["cobblemon:move_ai"]["minecraft:behavior.float"], `${sp}: boia pela IA quando não está montado`);
      for (const g of ["cobblemon:ride_land", "cobblemon:ride_air", "cobblemon:ride_liquid", "cobblemon:ride_air_tired"]) {
        assert.equal(e.component_groups[g]?.["minecraft:behavior.float"], undefined, `${sp}: ${g} sem behavior.float`);
      }
      assert.ok(e.events["cobblemon:on_mount"].remove.component_groups.includes("cobblemon:move_ai"), `${sp}: on_mount tira o move_ai`);
    }
    // Quem não monta continua com o boiar na base.
    const pidgey = JSON.parse(readFileSync(join(GEN_BP, "entities/pokemon/pidgey.json"), "utf8"))["minecraft:entity"];
    assert.ok(pidgey.components["minecraft:behavior.float"], "pidgey (não montável) boia pela base");
    const lapras = JSON.parse(readFileSync(join(GEN_BP, "entities/pokemon/lapras.json"), "utf8"))["minecraft:entity"];
    assert.equal(lapras.component_groups["cobblemon:ride_liquid"]?.["minecraft:buoyant"], undefined, "quem respira na água continua como antes");
  });
  test("gerado: geometrias de Pokémon sem plano de espessura zero (slowking_galarian, pássaros, plantas)", () => {
    const models = join(GEN, "models/entity/pokemon");
    const wanted = /^(slowpoke_galarian|slowbro_galarian|slowking_galarian|pidgeot|bellossom|oddish|decidueye)\.geo\.json$/;
    let seen = 0;
    for (const dir of readdirSync(models)) {
      for (const f of readdirSync(join(models, dir))) {
        if (!wanted.test(f)) continue;
        seen++;
        for (const g of JSON.parse(readFileSync(join(models, dir, f), "utf8"))["minecraft:geometry"]) assert.deepEqual(flatEntityCubes(g), [], f);
      }
    }
    assert.ok(seen >= 5, `geometrias conferidas: ${seen}`);
  });
}

console.log(`cliente-teste3-log: ${passed} testes ok`);
