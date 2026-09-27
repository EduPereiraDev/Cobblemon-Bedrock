// Testes da frente "limites-b" (aproximações da pesquisa 8): pinturas do Cobblemon (#30), Enfermeira (#99/#113),
// fazendeiro com as plantas do Cobblemon (#136), livro de receitas agrupado (#146) e estruturas vanilla como
// condição de spawn. Lógica pura + arquivos gerados (npm run import) + overrides escritos à mão.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  axisOf, choosePainting, counterClockWise, facingOf, isFreeForPainting, isInteractiveBlock, isSolidForPainting, paintingCells, paintingLocation,
  parsePaintingRecord, VANILLA_PAINTING_SIZES,
} from "../scripts/limitesB/paintingLogic";
import { distanceToBlockCenter, isNurseJoyName, isWorkTime, nearestFreeSite, parseSiteKey, siteKey } from "../scripts/limitesB/nurseLogic";
import { COBBLEMON_CROPS, cropForSeed, farmOffsets, firstPlantable, isMatureCobblemonCrop } from "../scripts/limitesB/farmerLogic";
import { biomeAllows, signatureFor, signatureIds, signatureMatches, signatureVolume, STRUCTURE_SIGNATURES, VANILLA_STRUCTURE_TAGS } from "../scripts/limitesB/structureSignatures";
import { COBBLEMON_PAINTINGS, COBBLEMON_PLANTABLE_SEEDS, NURSE_JOY_NAMES, RECIPE_GROUPS } from "../generated/scripts/limitesB";
import { SPAWNS } from "../generated/scripts/spawns";
import { expandStructureQuery, isDetectableStructure, structureQuery, structureRegistry } from "../scripts/world/StructureRegistry";
import { clearStructureCache, startVanillaStructures, structureStats } from "../scripts/limitesB/vanillaStructures";
import { groupOfItem, nurseTradeTable, paintingHitboxes, regroupCatalog, VILLAGER_LEVEL_XP } from "../tools/importer/limitesB";

const ROOT = process.cwd();
const UP = join(ROOT, "upstream/cobblemon/common/src/main/resources");
const GEN_BP = join(ROOT, "generated/behavior_packs/CobblemonBedrock");
const GEN_RP = join(ROOT, "generated/resource_packs/CobblemonBedrock");
const HAND_BP = join(ROOT, "behavior_packs/CobblemonBedrock");
const HAND_RP = join(ROOT, "resource_packs/CobblemonBedrock");
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
};

// ---------------------------------------------------------------------------------------------
// #30 Pinturas

test("pinturas: variantes geradas = painting_variant + tag placeable do Cobblemon", () => {
  const tag = json(join(UP, "data/minecraft/tags/painting_variant/placeable.json")).values.filter((v: string) => v.startsWith("cobblemon:"));
  assert.deepEqual(COBBLEMON_PAINTINGS.map(p => p.id), tag);
  for (const p of COBBLEMON_PAINTINGS) {
    const j = json(join(UP, `data/cobblemon/painting_variant/${p.name}.json`));
    assert.equal(p.width, j.width);
    assert.equal(p.height, j.height);
    assert.ok(existsSync(join(GEN_RP, `textures/entity/cobblemon_painting/${p.name}.png`)), `textura ${p.name}`);
  }
});

test("pinturas: sorteio do Painting.create (maior área que cabe, uniforme entre vanilla e Cobblemon)", () => {
  const only = (...sizes: string[]) => (s: { width: number; height: number }) => sizes.includes(`${s.width}x${s.height}`);
  // Parede exatamente 3×2: nenhuma vanilla tem 3×2 e 2×2 tem área menor → Slumber sempre.
  for (const roll of [0, 0.5, 0.999]) {
    const c = choosePainting(COBBLEMON_PAINTINGS, only("1x1", "2x1", "1x2", "2x2", "3x2"), roll);
    assert.equal(c?.kind === "cobblemon" && c.variant.name, "slumber");
  }
  // Parede 4×2: 5 vanilla 4×2 + Altar → 1/6 para o Altar (o último sexto do sorteio).
  const fits42 = only("1x1", "2x1", "1x2", "2x2", "3x2", "4x2");
  assert.equal(choosePainting(COBBLEMON_PAINTINGS, fits42, 0.8)?.kind, "vanilla");
  const altar = choosePainting(COBBLEMON_PAINTINGS, fits42, 0.9);
  assert.equal(altar?.kind === "cobblemon" && altar.variant.name, "altar");
  // Parede 2×2: 8 vanilla 2×2 + Nomad → 1/9.
  let nomad = 0;
  for (let i = 0; i < 900; i++) { const c = choosePainting(COBBLEMON_PAINTINGS, only("1x1", "2x1", "1x2", "2x2"), (i + 0.5) / 900); if (c?.kind === "cobblemon") { assert.equal(c.variant.name, "nomad"); nomad++; } }
  assert.equal(nomad, 100);
  // Só 2×1 e 1×2 (área 2): 5 + 3 vanilla + Premonition → 1/9.
  const prem = choosePainting(COBBLEMON_PAINTINGS, only("1x1", "2x1", "1x2"), 0.95);
  assert.equal(prem?.kind === "cobblemon" && prem.variant.name, "premonition");
  // Parede grande (4×4 cabe): só vanilla. Nada cabe: nada.
  assert.equal(choosePainting(COBBLEMON_PAINTINGS, () => true, 0.999)?.kind, "vanilla");
  assert.equal(choosePainting(COBBLEMON_PAINTINGS, () => false, 0.5), undefined);
  assert.equal(Object.values(VANILLA_PAINTING_SIZES).reduce((a, b) => a + b, 0), 47);
});

test("pinturas: blocos ocupados, apoio e posição como Painting.calculateBoundingBox", () => {
  assert.equal(counterClockWise("south"), "east");
  assert.equal(counterClockWise("north"), "west");
  assert.equal(facingOf("North"), "north");
  assert.equal(facingOf("Up"), undefined);
  // Face sul clicada no bloco (0,64,0): âncora (0,64,1). 4×2 → x -1..2 (sentido anti-horário = leste), y 64..65.
  const cells = paintingCells({ x: 0, y: 64, z: 1 }, "south", { width: 4, height: 2 });
  assert.deepEqual([...new Set(cells.map(c => c.front.x))].sort((a, b) => a - b), [-1, 0, 1, 2]);
  assert.deepEqual([...new Set(cells.map(c => c.front.y))].sort(), [64, 65]);
  assert.ok(cells.every(c => c.front.z === 1 && c.wall.z === 0));
  const loc = paintingLocation({ x: 0, y: 64, z: 1 }, "south", { width: 4, height: 2 });
  assert.equal(loc.x, 1);
  assert.equal(loc.y, 64);
  assert.ok(Math.abs(loc.z - (1 + 1 / 32)) < 1e-9);
  // 3×3 fica centrada (y -1..+1); 1×1 ocupa só a âncora.
  const c33 = paintingCells({ x: 5, y: 70, z: 5 }, "east", { width: 3, height: 3 });
  assert.deepEqual([...new Set(c33.map(c => c.front.y))].sort(), [69, 70, 71]);
  assert.deepEqual([...new Set(c33.map(c => c.front.z))].sort(), [4, 5, 6]);
  assert.ok(c33.every(c => c.wall.x === 4));
  assert.equal(axisOf("east"), 1);
  assert.equal(axisOf("north"), 0);
  assert.deepEqual(parsePaintingRecord(JSON.stringify({ v: "altar", f: "north", a: [1, 2, 3] })), { v: "altar", f: "north", a: [1, 2, 3] });
  assert.equal(parsePaintingRecord("{}"), undefined);
});

test("pinturas: apoio sólido, espaço livre e blocos que respondem ao clique", () => {
  assert.ok(isSolidForPainting("minecraft:stone", false, false));
  assert.ok(!isSolidForPainting("minecraft:torch", false, false));
  assert.ok(!isSolidForPainting("minecraft:frame", false, false));
  assert.ok(!isSolidForPainting("minecraft:water", false, true));
  assert.ok(isFreeForPainting("minecraft:air", true, false));
  assert.ok(isFreeForPainting("minecraft:short_grass", false, false));
  assert.ok(!isFreeForPainting("minecraft:frame", false, false));
  assert.ok(!isFreeForPainting("minecraft:stone", false, false));
  assert.ok(isInteractiveBlock("minecraft:chest") && isInteractiveBlock("cobblemon:pc") && isInteractiveBlock("minecraft:oak_door"));
  assert.ok(!isInteractiveBlock("minecraft:stone") && !isInteractiveBlock("minecraft:oak_planks"));
});

test("pinturas: entidade, client entity, geometrias e render controller gerados", () => {
  const bp = json(join(GEN_BP, "entities/display/cobblemon_painting.json"))["minecraft:entity"];
  assert.equal(bp.description.identifier, "cobblemon:painting");
  assert.deepEqual(bp.description.properties["cobblemon:variant"].range, [0, COBBLEMON_PAINTINGS.length - 1]);
  assert.ok(bp.components["minecraft:persistent"] && bp.components["minecraft:physics"].has_gravity === false);
  COBBLEMON_PAINTINGS.forEach((p, v) => {
    for (const [a, axis] of ["ns", "ew"].entries()) {
      const ev = bp.events[`cobblemon:painting_${p.name}_${axis}`];
      assert.deepEqual(ev.set_property, { "cobblemon:variant": v, "cobblemon:axis": a });
      assert.equal(bp.component_groups[`cobblemon:painting_${p.name}_${axis}`]["minecraft:custom_hit_test"].hitboxes.length, p.width);
    }
  });
  const hb = paintingHitboxes({ id: "x", name: "x", width: 4, height: 2 }, "ns").map(h => h.pivot[0]);
  assert.deepEqual(hb, [-1.5, -0.5, 0.5, 1.5]);
  const rp = json(join(GEN_RP, "entity/display/cobblemon_painting.entity.json"))["minecraft:client_entity"].description;
  const geo = json(join(GEN_RP, "models/entity/limites_b/cobblemon_painting.geo.json"))["minecraft:geometry"];
  assert.equal(geo.length, COBBLEMON_PAINTINGS.length * 2);
  for (const g of Object.values<string>(rp.geometry)) assert.ok(geo.some((x: any) => x.description.identifier === g), g);
  const rc = json(join(GEN_RP, "render_controllers/limites_b/cobblemon_painting.render_controllers.json")).render_controllers["controller.render.cobblemon_painting"];
  assert.equal(rc.arrays.geometries["Array.geos"].length, COBBLEMON_PAINTINGS.length * 2);
  assert.equal(rc.arrays.textures["Array.skins"].length, COBBLEMON_PAINTINGS.length);
});

// ---------------------------------------------------------------------------------------------
// #99/#113 Enfermeira

test("enfermeira: trocas geradas das ofertas Kotlin (2 por nível, XP de nível do aldeão)", () => {
  const table = json(join(GEN_BP, "trading/economy_trades/cobblemon_nurse_trades.json"));
  assert.equal(table.tiers.length, 5);
  table.tiers.forEach((t: any, i: number) => {
    assert.equal(t.total_exp_required, VILLAGER_LEVEL_XP[i]);
    assert.equal(t.groups[0].num_to_select, 2);
  });
  const all = table.tiers.flatMap((t: any) => t.groups[0].trades);
  assert.equal(all.length, 21);
  const brew = all.find((t: any) => t.gives[0].item === "cobblemon:medicinal_brew");
  assert.deepEqual(brew.wants, [{ item: "minecraft:emerald", quantity: 8, price_multiplier: 0.05 }, { item: "minecraft:glass_bottle", quantity: 1 }]);
  assert.equal(brew.max_uses, 8);
  assert.equal(brew.trader_exp, 5);
  const leek = all.find((t: any) => t.wants[0].item === "cobblemon:medicinal_leek");
  assert.deepEqual([leek.wants[0].quantity, leek.gives[0].item, leek.gives[0].quantity], [24, "minecraft:emerald", 1]);
  // Todo item do Cobblemon das trocas existe no BP gerado.
  const items = new Set<string>();
  for (const dir of ["items", "blocks"]) {
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(join(d, e.name)); else if (e.name.endsWith(".json")) { try { const j = json(join(d, e.name)); items.add((j["minecraft:item"] ?? j["minecraft:block"])?.description?.identifier); } catch { /* */ } } } };
    walk(join(GEN_BP, dir));
  }
  for (const t of all) for (const it of [...t.wants, ...t.gives]) if (it.item.startsWith("cobblemon:")) assert.ok(items.has(it.item), it.item);
  assert.deepEqual(nurseTradeTable([]).tiers, []);
});

test("enfermeira: horário, estação, Joy", () => {
  assert.ok(isWorkTime(0) && isWorkTime(7999) && isWorkTime(10500) && isWorkTime(24000 + 100));
  assert.ok(!isWorkTime(8000) && !isWorkTime(12000) && !isWorkTime(9000));
  const k = siteKey("minecraft:overworld", 1.7, 64, -3.2);
  assert.equal(k, "minecraft:overworld|1,64,-4");
  assert.deepEqual(parseSiteKey(k), { dimension: "minecraft:overworld", x: 1, y: 64, z: -4 });
  assert.ok(distanceToBlockCenter({ x: 2.5, y: 64, z: 0.5 }, { x: 1, y: 64, z: 0 }) < 1.73);
  assert.ok(NURSE_JOY_NAMES.includes("Joy") && NURSE_JOY_NAMES.includes("ジョーイ"));
  assert.ok(isNurseJoyName("§dNurse Joy", NURSE_JOY_NAMES));
  assert.ok(isNurseJoyName("Enfermeira Joëlle", NURSE_JOY_NAMES));
  assert.ok(!isNurseJoyName("Joyce", NURSE_JOY_NAMES) && !isNurseJoyName(undefined, NURSE_JOY_NAMES));
  const sites = [{ x: 10, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }];
  assert.deepEqual(nearestFreeSite({ x: 0, y: 64, z: 0 }, sites, () => false), { x: 2, y: 64, z: 0 });
  assert.deepEqual(nearestFreeSite({ x: 0, y: 64, z: 0 }, sites, s => s.x === 2), { x: 10, y: 64, z: 0 });
});

test("enfermeira: override do villager_v2 (BP) acrescenta o grupo sem quebrar as profissões vanilla", () => {
  const e = json(join(HAND_BP, "entities/vanilla_overrides/villager_v2.json"))["minecraft:entity"];
  assert.equal(e.description.identifier, "minecraft:villager_v2");
  assert.equal(e.description.properties["cobblemon:nurse_joy"].client_sync, true);
  const nurse = e.component_groups["cobblemon:nurse"];
  assert.deepEqual(nurse["minecraft:type_family"].family, ["villager", "cobblemon_nurse", "mob"]);
  assert.equal(nurse["minecraft:variant"].value, 15);
  assert.equal(nurse["minecraft:economy_trade_table"].table, "trading/economy_trades/cobblemon_nurse_trades.json");
  assert.deepEqual(e.component_groups["cobblemon:nurse_work"]["minecraft:behavior.move_to_block"].target_blocks, ["cobblemon:healing_machine"]);
  assert.ok(e.events["cobblemon:become_nurse"].add.component_groups.includes("cobblemon:nurse"));
  assert.ok(e.events["cobblemon:unbecome_nurse"].remove.component_groups.includes("cobblemon:nurse"));
  // As 13 profissões vanilla continuam, e trocar de profissão tira os grupos da enfermeira.
  for (const p of ["farmer", "fisherman", "shepherd", "fletcher", "librarian", "cartographer", "cleric", "armorer", "weaponsmith", "toolsmith", "butcher", "leatherworker", "mason", "unskilled", "nitwit"]) assert.ok(e.component_groups[p], p);
  for (const [k, v] of Object.entries<any>(e.events)) {
    if (k.startsWith("minecraft:become_")) assert.ok(v.remove.component_groups.includes("cobblemon:nurse"), k);
    if (k.startsWith("minecraft:schedule_")) assert.ok(v.remove.component_groups.includes("cobblemon:nurse_work"), k);
  }
  // Agenda da enfermeira = work_schedule das profissões, trocando só o evento de trabalho.
  const ours = e.component_groups["cobblemon:nurse_schedule"]["minecraft:scheduler"].scheduled_events.map((s: any) => s.event);
  const pro = e.component_groups.work_schedule["minecraft:scheduler"].scheduled_events.map((s: any) => s.event === "minecraft:schedule_work_pro_villager" ? "cobblemon:schedule_work_nurse" : s.event);
  assert.deepEqual(ours, pro);
});

test("enfermeira: client entity (RP) com a textura nurse/nurse_joy e nível visível", () => {
  const d = json(join(HAND_RP, "entity/limites_b/villager_v2.entity.json"))["minecraft:client_entity"].description;
  assert.equal(d.identifier, "minecraft:villager_v2");
  assert.ok(d.scripts.pre_animation.some((s: string) => s.includes("query.variant == 15") && s.includes("cobblemon:nurse_joy")));
  const rc = json(join(HAND_RP, "render_controllers/limites_b/cobblemon_villager.render_controllers.json")).render_controllers;
  for (const r of d.render_controllers) assert.ok(r === "controller.render.villager_v3_base" || rc[r], r);
  const prof = rc["controller.render.cobblemon_villager_masked"].arrays.textures["Array.professions"];
  assert.equal(prof[15], "Texture.cobblemon_nurse");
  assert.equal(prof[16], "Texture.cobblemon_nurse_joy");
  for (const t of ["cobblemon_nurse", "cobblemon_nurse_joy"]) assert.ok(existsSync(join(GEN_RP, `${d.textures[t]}.png`)), t);
  // Sem nome de textura vanilla perdido.
  for (const t of ["farmer", "nitwit", "unskilled", "level_diamond", "baby_taiga"]) assert.ok(d.textures[t], t);
});

// ---------------------------------------------------------------------------------------------
// #136 Fazendeiro

test("fazendeiro: sementes da tag → plantas geradas, idade madura, ordem do inventário", () => {
  const tag = json(join(UP, "data/minecraft/tags/item/villager_plantable_seeds.json")).values;
  assert.deepEqual([...COBBLEMON_PLANTABLE_SEEDS], tag);
  for (const seed of tag) {
    const crop = cropForSeed(seed);
    assert.ok(crop && COBBLEMON_CROPS[crop], seed);
    const item = json(join(GEN_BP, `items/cobblemon/${seed.slice(10)}.json`))["minecraft:item"].components["minecraft:block_placer"];
    assert.equal(item.block, crop, `${seed} coloca ${item.block}`);
    const block = json(join(GEN_BP, `blocks/cobblemon/${crop!.slice(10)}.json`))["minecraft:block"].description.states["cobblemon:age"];
    assert.equal(Math.max(...block), COBBLEMON_CROPS[crop!].maxAge, crop);
  }
  assert.ok(isMatureCobblemonCrop("cobblemon:red_mint", { "cobblemon:age": 7 }));
  assert.ok(!isMatureCobblemonCrop("cobblemon:red_mint", { "cobblemon:age": 6 }));
  assert.ok(isMatureCobblemonCrop("cobblemon:hearty_grains", { "cobblemon:age": 6, "cobblemon:half": "lower" }));
  assert.ok(!isMatureCobblemonCrop("cobblemon:hearty_grains", { "cobblemon:age": 6, "cobblemon:half": "upper" }));
  assert.ok(!isMatureCobblemonCrop("minecraft:wheat", { growth: 7 }));
  assert.deepEqual(firstPlantable([undefined, "cobblemon:red_mint_seeds", "minecraft:wheat_seeds"], tag), { slot: 1, item: "cobblemon:red_mint_seeds", cobblemon: true });
  assert.deepEqual(firstPlantable(["minecraft:bread", "minecraft:carrot", "cobblemon:red_mint_seeds"], tag), { slot: 1, item: "minecraft:carrot", cobblemon: false });
  assert.equal(firstPlantable(["minecraft:bread"], tag), undefined);
  assert.equal(farmOffsets().length, 27);
});

test("fazendeiro: o override deixa o fazendeiro pegar as sementes do Cobblemon (VillagerGatherableItems)", () => {
  const e = json(join(HAND_BP, "entities/vanilla_overrides/villager_v2.json"))["minecraft:entity"];
  const items = e.component_groups.work_schedule_farmer["minecraft:shareables"].items.map((i: any) => i.item);
  for (const seed of COBBLEMON_PLANTABLE_SEEDS) assert.ok(items.includes(seed), seed);
  // As vanilla continuam lá.
  for (const v of ["minecraft:wheat_seeds", "minecraft:bread", "minecraft:bone_meal"]) assert.ok(items.includes(v), v);
});

// ---------------------------------------------------------------------------------------------
// #146 Livro de receitas agrupado

test("livro de receitas: grupos do Java viram subgrupos do catálogo, sem perder nem duplicar itens", () => {
  const cat = json(join(GEN_BP, "item_catalog/crafting_item_catalog.json"))["minecraft:crafting_items_catalog"].categories;
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (const c of cat) for (const g of c.groups) {
    if (g.group_identifier) names.push(g.group_identifier.name);
    for (const i of g.items) seen.set(i, (seen.get(i) ?? 0) + 1);
  }
  for (const [id, n] of seen) assert.equal(n, 1, `${id} aparece ${n} vezes`);
  assert.ok(seen.size > 700, `${seen.size} itens`);
  assert.deepEqual(names.filter(n => n.startsWith("cobblemon:recipe_group.")), [...RECIPE_GROUPS]);
  const group = (name: string) => cat.flatMap((c: any) => c.groups).find((g: any) => g.group_identifier?.name === `cobblemon:recipe_group.${name}`);
  assert.deepEqual(new Set(group("red_mints").items), new Set(["cobblemon:adamant_mint", "cobblemon:brave_mint", "cobblemon:lonely_mint", "cobblemon:naughty_mint"]));
  assert.equal(group("basic_balls").items.length, 7);
  assert.equal(group("evolution_stone_from_block").items.length, 10);
  for (const lang of ["en_US", "pt_BR"]) {
    const text = readFileSync(join(HAND_RP, `texts/${lang}.lang`), "utf8");
    for (const g of RECIPE_GROUPS) assert.ok(new RegExp(`^${g.replace(/[.]/g, "\\.")}=.+$`, "m").test(text), `${lang}: ${g}`);
    assert.ok(/^entity\.villager\.cobblemon\.nurse=.+$/m.test(text), `${lang}: enfermeira`);
  }
});

test("livro de receitas: regroupCatalog e groupOfItem (lógica)", () => {
  const groups = new Map([["fire_stone", ["cobblemon:fire_stone"]], ["evolution_stone_from_block", ["cobblemon:fire_stone", "cobblemon:water_stone"]], ["solo", ["cobblemon:x"]]]);
  const of = groupOfItem(groups);
  assert.equal(of.get("cobblemon:fire_stone"), "evolution_stone_from_block");
  const catalog = {
    format_version: "1.21.60",
    "minecraft:crafting_items_catalog": { categories: [{ category_name: "items", groups: [
      { items: ["minecraft:stick"] },
      { group_identifier: { icon: "cobblemon:fire_stone", name: "cobblemon:itemGroup.cobblemon.evolution_item" }, items: ["cobblemon:y", "cobblemon:fire_stone", "cobblemon:x", "cobblemon:water_stone"] },
    ] }] },
  };
  const { catalog: out, groups: made } = regroupCatalog(catalog, of);
  const g = out["minecraft:crafting_items_catalog"].categories[0].groups;
  assert.deepEqual(made, ["cobblemon:recipe_group.evolution_stone_from_block"]);
  assert.deepEqual(g.map(x => x.items), [["minecraft:stick"], ["cobblemon:y", "cobblemon:x"], ["cobblemon:fire_stone", "cobblemon:water_stone"]]);
  assert.equal(g[1].group_identifier?.icon, "cobblemon:y");
});

// ---------------------------------------------------------------------------------------------
// Estruturas vanilla como condição

test("estruturas: toda estrutura vanilla das condições de spawn tem assinatura (menos naufrágio e poço)", () => {
  const used = new Set<string>();
  const walk = (o: any) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) { o.forEach(walk); return; } if (Array.isArray(o.structures)) o.structures.forEach((s: string) => used.add(s)); for (const v of Object.values(o)) walk(v); };
  walk(SPAWNS);
  const vanilla = [...used].filter(s => s.replace(/^#/, "").startsWith("minecraft:") && s !== "#minecraft:village");
  const ids = new Set(signatureIds());
  const uncovered = vanilla.filter(q => {
    const tag = q.startsWith("#") ? VANILLA_STRUCTURE_TAGS[q.slice(1)] : undefined;
    return !(tag ? tag.some(id => ids.has(id)) : ids.has(q));
  });
  assert.deepEqual(uncovered.sort(), ["#minecraft:shipwreck", "minecraft:desert_well"]);
});

test("estruturas: volume por chunk, bioma e assinatura", () => {
  const monument = signatureFor("minecraft:monument")!;
  assert.deepEqual(signatureVolume(monument, 2, -1, 50), { min: { x: 32, y: 30, z: -16 }, max: { x: 47, y: 64, z: -1 } });
  const hut = signatureFor("minecraft:swamp_hut")!;
  assert.deepEqual(signatureVolume(hut, 0, 0, 64), { min: { x: -4, y: 52, z: -4 }, max: { x: 19, y: 80, z: 19 } });
  assert.equal(signatureFor("minecraft:woodland_mansion")?.id, "minecraft:mansion");
  assert.ok(biomeAllows(monument, "minecraft:deep_ocean") && !biomeAllows(monument, "minecraft:plains"));
  assert.ok(biomeAllows(hut, "swampland") && !biomeAllows(hut, "mangrove_swamp"));
  const outpost = signatureFor("minecraft:pillager_outpost")!;
  assert.ok(biomeAllows(outpost, "plains") && !biomeAllows(outpost, "roofed_forest") && !biomeAllows(outpost, "pale_garden"));
  assert.ok(biomeAllows(signatureFor("minecraft:mansion")!, "minecraft:pale_garden"));
  assert.ok(signatureMatches(monument, list => list.includes("minecraft:sea_lantern") || list.includes("minecraft:prismarine_bricks")));
  assert.ok(!signatureMatches(monument, list => list.includes("minecraft:prismarine_bricks")));
  assert.ok(STRUCTURE_SIGNATURES.every(s => s.all.length && s.all.every(l => l.length)));
});

test("estruturas: integração com o registro (consulta preguiçosa, tags vanilla, cache e registro)", () => {
  assert.equal(isDetectableStructure("minecraft:monument"), false);
  startVanillaStructures();
  assert.ok(isDetectableStructure("minecraft:monument") && isDetectableStructure("minecraft:woodland_mansion"));
  assert.deepEqual(expandStructureQuery("#minecraft:ocean_ruin"), ["minecraft:ocean_ruin_cold", "minecraft:ocean_ruin_warm"]);
  let scans = 0;
  const blocks = new Set(["minecraft:prismarine_bricks", "minecraft:sea_lantern"]);
  const fakeDim = (id: string, biome: string, present: Set<string>) => ({
    id, heightRange: { min: -64, max: 320 },
    isChunkLoaded: () => true,
    getBiome: () => ({ id: `minecraft:${biome}` }),
    getTopmostBlock: () => ({ location: { x: 0, y: 70, z: 0 } }),
    containsBlock: (_v: unknown, filter: { includeTypes: string[] }) => { scans++; return filter.includeTypes.some(t => present.has(t)); },
  }) as never;
  const ocean = fakeDim("minecraft:overworld", "deep_ocean", blocks);
  assert.equal(structureQuery(ocean, { x: 100, y: 45, z: 100 }, ["minecraft:monument"]), true);
  assert.ok(structureRegistry.structuresInChunk("minecraft:overworld", 6, 6).includes("minecraft:monument"));
  // Consulta de vila não roda as assinaturas vanilla (só as consultas dos ids pedidos).
  const before = scans;
  structureQuery(ocean, { x: 500, y: 45, z: 500 }, ["#minecraft:village"]);
  assert.equal(scans, before);
  // Bioma errado: sem containsBlock. Negativo fica em cache (sem novo teste no mesmo chunk).
  const plains = fakeDim("minecraft:overworld", "plains", blocks);
  assert.equal(structureQuery(plains, { x: 1000, y: 64, z: 1000 }, ["minecraft:monument"]), false);
  assert.equal(scans, before);
  const empty = fakeDim("minecraft:overworld", "deep_ocean", new Set());
  assert.equal(structureQuery(empty, { x: 2000, y: 45, z: 2000 }, ["minecraft:monument"]), false);
  const afterMiss = scans;
  assert.equal(structureQuery(empty, { x: 2001, y: 45, z: 2001 }, ["minecraft:monument"]), false);
  assert.equal(scans, afterMiss);
  // Dimensão errada: nada.
  const nether = fakeDim("minecraft:nether", "deep_ocean", blocks);
  assert.equal(structureQuery(nether, { x: 3000, y: 45, z: 3000 }, ["minecraft:monument"]), false);
  // Tag: ruína oceânica quente pela tag.
  const warm = fakeDim("minecraft:overworld", "warm_ocean", new Set(["minecraft:cut_sandstone"]));
  assert.equal(structureQuery(warm, { x: 4000, y: 40, z: 4000 }, ["#minecraft:ocean_ruin"]), true);
  // Naufrágio continua sem detector (condição não cumprida).
  assert.equal(structureQuery(warm, { x: 4000, y: 40, z: 4000 }, ["#minecraft:shipwreck"]), undefined);
  // Mansão: registra os dois ids.
  const forest = fakeDim("minecraft:overworld", "roofed_forest", new Set(["minecraft:dark_oak_planks", "minecraft:cobblestone", "minecraft:glass_pane"]));
  assert.equal(structureQuery(forest, { x: 5000, y: 70, z: 5000 }, ["minecraft:woodland_mansion"]), true);
  assert.ok(structureRegistry.structuresInChunk("minecraft:overworld", 312, 312).includes("minecraft:mansion"));
  clearStructureCache();
  assert.ok(structureStats.hits >= 3);
});

test("main.ts liga a frente e o importador chama o emissor", () => {
  const main = readFileSync(join(ROOT, "scripts/main.ts"), "utf8");
  assert.ok(/import \{ startLimitesB \} from "\.\/limitesB"/.test(main) && /startLimitesB\(\);/.test(main));
  const idx = readFileSync(join(ROOT, "tools/importer/index.ts"), "utf8");
  assert.ok(/emitLimitesB\(!contentOnlyPokemon\);/.test(idx));
});

console.log(`limites-b: ${passed} testes ok (pinturas ${COBBLEMON_PAINTINGS.length}, grupos de receita ${RECIPE_GROUPS.length}, assinaturas ${STRUCTURE_SIGNATURES.length})`);
