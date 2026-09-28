// Frente zfight2 (docs/pendencias/zfight2.md): z-fighting que sobrou nos Pokémon depois da beta 5.
// 1. Cubos coplanares entre ossos diferentes (pose de repouso) são separados; os blocos continuam só no mesmo osso.
// 2. A espessura dos planos mantém a ordem do Java (inflate negativo = plano de fundo; 0 e 0,025 não se igualam).
// 3. Materiais: base de um lado (entityCutout do Java) e camadas com depthFunc LessEqual (como iron_golem/villager_v2).
// 4. Detector (zfightEntities.ts): acusa camada/plano/coplanar/geometrias sobrepostas; zera com a correção.
// 5. Gerado (npm run import): as espécies citadas no teste em cliente e mais 30 sem risco e com a geometria do Java.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boneDrawOrder, coplanarConflicts, geometryFaces, isFlatEntityCube, separateCoplanarCubes, shiftCoplanarCubes, thickenFlatEntityCubes } from "../tools/importer/zfight.ts";
import { COBBLEMON_ENTITY_MATERIALS, POKEMON_MATERIALS, entityMaterialFile, entityZFightRisks, materialTable, oneSidedGeometries } from "../tools/importer/zfightEntities.ts";

const ROOT = process.cwd();
const GEN = join(ROOT, "generated/resource_packs/CobblemonBedrock");
const UP = join(ROOT, "upstream/cobblemon/common/src/main/resources/assets/cobblemon/bedrock/pokemon/models");

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

const sameSide = (geo: any) => coplanarConflicts(geometryFaces(geo), { doubleSided: false, minArea: 0.05, skipHidden: true });

test("ordem de desenho do Java: osso, depois os filhos, na ordem do JSON", () => {
  const order = boneDrawOrder({ bones: [{ name: "root" }, { name: "b", parent: "root" }, { name: "a", parent: "root" }, { name: "c", parent: "b" }] });
  assert.deepEqual([...order.keys()], ["root", "b", "c", "a"]);
});

test("cubos coplanares em ossos diferentes: só a face em conflito do desenhado depois sai 0,01 px", () => {
  const geo: any = {
    bones: [
      { name: "head", pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [8, 8, 8], uv: [0, 0] }] },
      { name: "lid_a", parent: "head", pivot: [0, 0, 0], cubes: [{ origin: [1, 8, 1], size: [2, 0, 2], uv: [40, 0] }] },
      { name: "lid_b", parent: "head", pivot: [0, 0, 0], cubes: [{ origin: [1, 8, 1], size: [2, 0, 2], uv: [50, 0] }] },
      { name: "cap", parent: "head", pivot: [0, 0, 0], cubes: [{ origin: [2, 4, 2], size: [4, 4, 4], uv: [60, 0] }] },
    ],
  };
  assert.ok(sameSide(geo).some((z) => z.a.bone !== z.b.bone), "antes: faces coplanares entre ossos");
  const blocks = structuredClone(geo);
  assert.equal(separateCoplanarCubes(blocks), 0, "o separador dos blocos continua só no mesmo osso");
  assert.ok(shiftCoplanarCubes(geo) >= 2);
  assert.equal(sameSide(geo).length, 0, "depois: nenhum par do mesmo lado");
  const top = (n: string) => { const c = geo.bones.find((b: any) => b.name === n).cubes[0]; return c.origin[1] + c.size[1] + (c.inflate ?? 0); };
  assert.ok(top("head") < top("lid_a") && top("lid_a") < top("lid_b"), "a ordem do Java decide quem fica por cima");
  assert.equal(top("head"), 8, "o cubo desenhado antes não muda");
  const cap = geo.bones.find((b: any) => b.name === "cap").cubes[0];
  // O cap é o último na ordem do Java: fica acima das duas pálpebras; só a face de cima andou (as outras cinco ficam).
  assert.deepEqual([cap.origin, cap.size], [[2, 4, 2], [4, 4.03, 4]]);
  assert.ok(top("lid_b") < top("cap"));
});

test("pilha escondida dentro da cabeça (pálpebras de expressão) fica como no Java", () => {
  const geo: any = {
    bones: [
      { name: "head", pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [8, 8, 8], uv: [0, 0] }] },
      { name: "lid_angry", parent: "head", pivot: [0, 0, 0], cubes: [{ origin: [1, 4, 0.1], size: [3, 2, 0], uv: [40, 0], inflate: 0.02 }] },
      { name: "lid_sad", parent: "head", pivot: [0, 0, 0], cubes: [{ origin: [1, 4, 0.1], size: [3, 2, 0], uv: [50, 0], inflate: 0.02 }] },
    ],
  };
  assert.ok(coplanarConflicts(geometryFaces(geo), { doubleSided: false }).length > 0, "coplanares (sem descontar as escondidas)");
  assert.equal(sameSide(geo).length, 0, "mas dentro da cabeça: não aparecem");
  const before = JSON.stringify(geo);
  assert.equal(shiftCoplanarCubes(geo), 0);
  assert.equal(JSON.stringify(geo), before);
});

test("coplanares com rotação de osso (pivô aplicado) também são achados", () => {
  const geo: any = {
    bones: [
      { name: "a", pivot: [0, 0, 0], rotation: [0, 0, 30], cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }] },
      { name: "b", pivot: [0, 0, 0], rotation: [0, 0, 30], cubes: [{ origin: [1, 4, 1], size: [2, 0, 2], uv: [20, 0] }] },
    ],
  };
  assert.equal(sameSide(geo).length, 1);
  shiftCoplanarCubes(geo);
  assert.equal(sameSide(geo).length, 0);
});

test("espessura dos planos mantém a ordem do Java (Eternatus: plano de fundo com inflate -0,01)", () => {
  // Upstream geometry.eternatus ribcage_left2.
  const rib = () => ({ bones: [{ name: "ribcage_left2", pivot: [23, 35, 1], rotation: [0, 0, 11], cubes: [
    { origin: [23, 14, -24.5], size: [0, 21, 48], uv: [416, 385] },
    { origin: [23, 14, -25.5], size: [0, 21, 50], inflate: -0.01, uv: [412, 270] },
  ] }] });
  // Um lado (Pokémon): o de fundo fica como no Java; o outro ganha espessura; nenhum par coplanar.
  const one: any = rib();
  assert.equal(thickenFlatEntityCubes(one, true), 1);
  assert.equal(one.bones[0].cubes[0].inflate, 0.025);
  assert.equal(one.bones[0].cubes[1].inflate, -0.01);
  assert.equal(sameSide(one).length, 0, "um lado: nenhuma face do mesmo lado no mesmo plano");
  assert.ok(!isFlatEntityCube(one.bones[0].cubes[1], true) && isFlatEntityCube(one.bones[0].cubes[1]), "o de fundo só é aceito com material de um lado");
  // Dois lados: sobem juntos o mesmo tanto, o de fundo continua abaixo (antes: os dois viravam 0,025).
  const two: any = rib();
  thickenFlatEntityCubes(two);
  const [a, b] = two.bones[0].cubes;
  assert.ok(b.inflate >= 0.025 && a.inflate - b.inflate > 0.009, `${a.inflate} / ${b.inflate}`);
  assert.equal(sameSide(two).length, 0);
});

test("espessura: plano já grosso não empata com o fino que sobe", () => {
  const geo: any = { bones: [{ name: "fin", pivot: [0, 0, 0], cubes: [
    { origin: [0, 0, 0], size: [4, 0, 4], uv: [0, 0] },
    { origin: [0, 0, 0], size: [4, 0, 4], uv: [8, 0], inflate: 0.025 },
  ] }] };
  thickenFlatEntityCubes(geo, true);
  assert.equal(geo.bones[0].cubes[0].inflate, 0.025);
  assert.equal(geo.bones[0].cubes[1].inflate, 0.05);
  assert.equal(thickenFlatEntityCubes(geo, true), 0, "idempotente");
});

test("materiais: base de um lado e camadas que passam no empate de profundidade", () => {
  const t = materialTable([entityMaterialFile()]);
  assert.deepEqual(t.get("entity_alphatest"), { cull: false, depthFunc: "Less" });
  assert.deepEqual(t.get(POKEMON_MATERIALS.default), { cull: true, depthFunc: "Less" });
  assert.deepEqual(t.get(POKEMON_MATERIALS.layer), { cull: true, depthFunc: "LessEqual" });
  assert.deepEqual(t.get(POKEMON_MATERIALS.layer_translucent), { cull: true, depthFunc: "LessEqual" });
  // Só estado de profundidade: nenhum define/shader novo.
  for (const body of Object.values(COBBLEMON_ENTITY_MATERIALS)) assert.deepEqual(Object.keys(body), ["depthFunc"]);
  assert.ok(Object.keys(COBBLEMON_ENTITY_MATERIALS).every((k) => /^cobblemon_[a-z_]+:entity_[a-z_]+$/.test(k)));
});

// Árvore de RP mínima para o detector.
function tree(materials: Record<string, string>, geo: any, extra: { layerGeo?: string; geos?: Record<string, any> } = {}): Map<string, any> {
  const geos = extra.geos ?? { g0: geo };
  const rp = new Map<string, any>();
  for (const [k, g] of Object.entries(geos)) rp.set(`/models/entity/pokemon/${k}.geo.json`, { "minecraft:geometry": [{ description: { identifier: `geometry.t_${k}` }, ...g }] });
  rp.set("/render_controllers/pokemon/t.json", { render_controllers: {
    "controller.render.t": { arrays: { geometries: { "Array.geo": ["Geometry.g0"] } }, geometry: "Array.geo[0]", materials: [{ "*": "Material.default" }], textures: ["Texture.t0"] },
    "controller.render.t.layer0": { arrays: { geometries: { "Array.geo": [`Geometry.${extra.layerGeo ?? "g0"}`] } }, geometry: "Array.geo[0]", materials: [{ "*": "Material.layer" }], textures: ["Texture.t1"] },
  } });
  rp.set("/entity/pokemon/t.entity.json", { "minecraft:client_entity": { description: {
    identifier: "cobblemon:t", materials,
    geometry: Object.fromEntries(Object.keys(geos).map((k) => [k, `geometry.t_${k}`])),
    render_controllers: ["controller.render.t", "controller.render.t.layer0"],
  } } });
  rp.set("/materials/entity.material", entityMaterialFile());
  return rp;
}
const planeGeo = { bones: [{ name: "b", pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }, { origin: [0, 4, 0], size: [2, 0, 2], uv: [20, 0], inflate: -0.01 }] }] };

test("detector: camada com entity_alphatest e plano de fundo com material de dois lados (antes)", () => {
  const risks = entityZFightRisks(tree({ default: "entity_alphatest", layer: "entity_alphatest" }, planeGeo));
  assert.equal(risks.length, 1);
  assert.ok(risks[0].risks.camada && risks[0].risks["plano-dois-lados"], JSON.stringify(risks[0].risks));
});

test("detector: com os materiais do Pokémon não sobra risco (depois)", () => {
  const rp = tree({ ...POKEMON_MATERIALS }, planeGeo);
  assert.deepEqual(entityZFightRisks(rp), []);
  assert.ok(oneSidedGeometries(rp).has("geometry.t_g0"));
  // Camada de dois lados (villager_v2: LessEqual, sem descarte) sobre base de um lado com plano: a costa aparece.
  const mixed = entityZFightRisks(tree({ default: POKEMON_MATERIALS.default, layer: "villager_v2" }, planeGeo));
  assert.ok(mixed[0]?.risks["camada-dois-lados"]);
});

test("detector: coplanares entre ossos e geometrias diferentes desenhadas juntas", () => {
  const cross = { bones: [
    { name: "a", pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }] },
    { name: "b", pivot: [0, 0, 0], cubes: [{ origin: [1, 1, 1], size: [2, 3, 2], uv: [20, 0] }] },
  ] };
  const r = entityZFightRisks(tree({ ...POKEMON_MATERIALS }, cross));
  assert.ok(r[0]?.risks["coplanar-entre-ossos"]);
  const other = { bones: [{ name: "c", pivot: [0, 0, 0], cubes: [{ origin: [0, 0, 0], size: [4, 4, 4], uv: [30, 0] }] }] };
  const two = entityZFightRisks(tree({ ...POKEMON_MATERIALS }, undefined, { layerGeo: "g1", geos: { g0: planeGeo, g1: other } }));
  assert.ok(two[0]?.risks["geometrias-sobrepostas"], JSON.stringify(two));
});

// ---------------------------------------------------------------------------------------------
// Conteúdo gerado (npm run import)

/** As citadas no teste em cliente (prints 14–19 e 31–32) e mais 30. */
export const CITED = ["eternatus", "chandelure", "mamoswine", "arbok", "ekans"];
export const OTHERS = [
  "pikachu", "bulbasaur", "venusaur", "charizard", "pidgey", "gyarados", "dragonite", "mewtwo", "lucario", "garchomp",
  "eevee", "umbreon", "gengar", "snorlax", "lapras", "ninetales", "arcanine", "decidueye", "corviknight", "slowking",
  "rayquaza", "hatterene", "tyranitar", "blaziken", "gardevoir", "metagross", "volcarona", "scizor", "litwick", "piloswine",
];

if (existsSync(join(GEN, "materials/entity.material"))) {
  test("gerado: materials/entity.material com os materiais das camadas", () => {
    assert.deepEqual(JSON.parse(readFileSync(join(GEN, "materials/entity.material"), "utf8")), entityMaterialFile());
  });

  test("gerado: citadas + 30 espécies com os materiais novos e sem risco no detector", () => {
    const rp = new Map<string, any>();
    const read = (rel: string) => { const f = join(GEN, rel); if (existsSync(f)) rp.set(`/${rel}`, JSON.parse(readFileSync(f, "utf8"))); };
    read("materials/entity.material");
    for (const sp of [...CITED, ...OTHERS]) {
      read(`entity/pokemon/${sp}.entity.json`);
      read(`render_controllers/pokemon/${sp}.render_controllers.json`);
      const desc = rp.get(`/entity/pokemon/${sp}.entity.json`)?.["minecraft:client_entity"]?.description;
      assert.ok(desc, `${sp}: client entity`);
      assert.deepEqual(desc.materials, { ...POKEMON_MATERIALS }, sp);
    }
    // Geometrias usadas por essas entidades.
    const ids = new Set<string>();
    for (const [k, j] of rp) if (k.startsWith("/entity/")) for (const g of Object.values<string>(j["minecraft:client_entity"].description.geometry)) ids.add(g);
    const models = join(GEN, "models/entity/pokemon");
    for (const dir of readdirSafe(models)) for (const f of readdirSafe(join(models, dir))) {
      const j = JSON.parse(readFileSync(join(models, dir, f), "utf8"));
      if (ids.has(j["minecraft:geometry"]?.[0]?.description?.identifier)) rp.set(`/models/entity/pokemon/${dir}/${f}`, j);
    }
    const risks = entityZFightRisks(rp);
    assert.deepEqual(risks.map((r) => `${r.entity}: ${Object.keys(r.risks).join(",")}`), []);
  });

  test("gerado: geometria igual à do Java fora o inflate (citadas + 30)", () => {
    let checked = 0;
    for (const sp of [...CITED, ...OTHERS]) {
      const dir = readdirSafe(UP).find((d) => d.replace(/^\d+_/, "") === sp);
      if (!dir) continue;
      for (const f of readdirSafe(join(UP, dir))) {
        const gen = join(GEN, "models/entity/pokemon", dir, f);
        if (!existsSync(gen)) continue;
        const up = JSON.parse(readFileSync(join(UP, dir, f), "utf8"))["minecraft:geometry"][0];
        const out = JSON.parse(readFileSync(gen, "utf8"))["minecraft:geometry"][0];
        const byName = new Map<string, any>(out.bones.map((b: any) => [b.name, b]));
        for (const b of up.bones) {
          // O import renomeia alguns ossos (ex. head → cobblemon_head, headLocator.ts).
          const o = byName.get(b.name) ?? byName.get(`cobblemon_${b.name}`);
          assert.ok(o, `${f}: osso ${b.name}`);
          assert.deepEqual(o.rotation ?? null, b.rotation ?? null, `${f}: ${b.name} rotation`);
          (b.cubes ?? []).forEach((c: any, i: number) => {
            const k = o.cubes[i];
            for (const field of ["uv", "pivot", "rotation", "mirror"]) assert.deepEqual(k[field], c[field], `${f}: ${b.name}#${i}.${field}`);
            // Separação entre ossos: só a face em conflito anda (origin/size), no máximo 0,15 px.
            for (const field of ["origin", "size"]) c[field].forEach((v: number, ax: number) => assert.ok(Math.abs(k[field][ax] - v) <= 0.15 + 1e-9, `${f}: ${b.name}#${i}.${field} ${c[field]} → ${k[field]}`));
            const d = (k.inflate ?? 0) - (c.inflate ?? 0);
            // Só sobe: espessura (0,025) e separações de 0,01 do mesmo osso; plano de fundo negativo fica igual.
            assert.ok(d >= -1e-9 && d <= 0.1 + 1e-9, `${f}: ${b.name}#${i} inflate ${c.inflate} → ${k.inflate}`);
            if ((c.inflate ?? 0) < 0 && c.size.filter((s: number) => s === 0).length === 1) assert.equal(k.inflate, c.inflate, `${f}: ${b.name}#${i} plano de fundo`);
          });
          checked++;
        }
      }
    }
    assert.ok(checked > 500, `ossos conferidos: ${checked}`);
  });
}

function readdirSafe(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

console.log(`zfight2: ${passed} testes ok`);
