// Testes da frente "motor": waterlogging, jigsaw data-driven, registro de estruturas/vilas, contêineres,
// música de batalha, dano por Pokémon e montaria (câmera/controles/roll).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { world } from "@minecraft/server";
import { readBedrockNbt } from "../tools/importer/nbt.ts";
import { waterloggableClasses, LIQUID_DETECTION } from "../tools/importer/blocks.ts";
import { bedrockStructureSet, bedrockWorldgenId, jigsawStates, startHeightOf, structureTags } from "../tools/importer/jigsaw.ts";
import { meleeDamage } from "../tools/importer/entities.ts";
import { STRUCTURE_IDS, STRUCTURE_TAGS, POKECENTERS } from "../generated/scripts/structures";
import {
  chunksCovered, chunksInBox, expandStructureQuery, isDetectableStructure, normalizeStructureId, parseMarkerTags, regionKey, StructureRegistry, structureQuery, VILLAGE_ID,
} from "../scripts/world/StructureRegistry";
import { isFlatNatural, rotateFacing, rotationToward, villageBox, villageTypeOf } from "../scripts/world/Villages";
import { CHEST_HITS, registerChestHit } from "../scripts/world/Containers";
import { battleMusicKind, battleMusicTrack, isBattleMusicPlaying, startBattleMusic, stopBattleMusic, tickBattleMusic } from "../scripts/world/BattleMusic";
import { attackToDamageCurve, damageAfterArmour, defenceToArmour, isPokemonInvulnerable, scaledPokemonDamage, speciesMeleeDamage } from "../scripts/world/PokemonDamage";
import { nextRoll, rideCameraPreset, sneakDismounts, yawDelta } from "../scripts/entity/Riding";

const ROOT = process.cwd();
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const HAND_BP = join(ROOT, "behavior_packs", "CobblemonBedrock");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/^\s*\/\*[\s\S]*?\*\//, ""));
let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
};

// ---------------------------------------------------------------------------------------------
// P0 — waterlogging

test("classes alagáveis (23 do Cobblemon + vanilla)", () => {
  const classes = waterloggableClasses();
  for (const c of ["RingTargetBlock", "CoinPouchBlock", "DecorativeItemBlock", "EjectButtonBlock", "ActivatableDecorationBlock", "PlaqueBlock", "OrbBlock",
    "TumblestoneBlock", "SweetIncenseBlock", "SaccharineLeafBlock", "PCBlock", "WallAttachedDirectionalBlock", "StackableItemBlock", "GalaricaWreathBlock",
    "SixFaceRotationalBlock", "PastureBlock", "WallAttachedStackableItemBlock", "MagnetBlock", "HeartyGrainsBlock", "CampfirePotBlock", "TMMachineBlock",
    "CampfireBlock", "GildedChestBlock", "SlabBlock", "StairBlock", "FenceBlock", "WallBlock", "TrapDoorBlock"]) assert.ok(classes.has(c), c);
  assert.ok(!classes.has("DoorBlock") && !classes.has("DisplayCaseBlock"), "portas/vitrine não alagam no Java");
});

test("blocos gerados com minecraft:liquid_detection", () => {
  for (const id of ["gilded_chest", "pc", "pc_top", "apricorn_slab", "ring_target", "tumblestone_cluster", "pasture"]) {
    const file = join(GEN_BP, "blocks", "cobblemon", `${id}.json`);
    if (!existsSync(file)) continue;
    const comp = json(file)["minecraft:block"].components["minecraft:liquid_detection"];
    assert.deepEqual(comp, LIQUID_DETECTION, `${id} alagável`);
  }
  const door = json(join(GEN_BP, "blocks", "cobblemon", "display_case.json"))["minecraft:block"].components;
  assert.equal(door["minecraft:liquid_detection"], undefined);
  const gilded = json(join(GEN_BP, "blocks", "cobblemon", "gilded_chest.json"));
  assert.ok(Number(gilded.format_version.split(".")[2]) >= 60 || Number(gilded.format_version.split(".")[1]) > 21, "formato >= 1.21.60");
});

// ---------------------------------------------------------------------------------------------
// P1 — jigsaw data-driven

test("conversões de jigsaw", () => {
  assert.equal(bedrockWorldgenId("cobblemon:shipwreck_coves/lush_shipwreck_cove"), "cobblemon:shipwreck_coves_lush_shipwreck_cove");
  assert.deepEqual(jigsawStates("west_up"), { facing_direction: 4, rotation: 0 });
  assert.deepEqual(jigsawStates("east_up"), { facing_direction: 5, rotation: 0 });
  assert.deepEqual(jigsawStates("up_north"), { facing_direction: 1, rotation: 2 });
  assert.deepEqual(jigsawStates("down_south"), { facing_direction: 0, rotation: 0 });
  assert.deepEqual(startHeightOf({ absolute: -11 }), { type: "constant", value: { absolute: -11 } });
  assert.deepEqual(startHeightOf({ type: "minecraft:uniform", min_inclusive: { absolute: 25 }, max_inclusive: { absolute: 30 } }), { type: "uniform", min: { absolute: 25 }, max: { absolute: 30 } });
  const set = bedrockStructureSet("cobblemon:shipwreck_coves", { placement: { salt: 1, spacing: 100, separation: 50, spread_type: "triangular" }, structures: [{ structure: "cobblemon:a/b", weight: 2 }, { structure: "cobblemon:x" }] }, new Set(["cobblemon:a/b"])) as any;
  assert.deepEqual(set["minecraft:structure_set"].placement, { type: "minecraft:random_spread", salt: 1, separation: 49, spacing: 100, spread_type: "triangular" });
  assert.deepEqual(set["minecraft:structure_set"].structures, [{ structure: "cobblemon:a_b", weight: 2 }]);
});

test("worldgen gerado: estruturas, pools, conjuntos e peças consistentes", () => {
  const wg = join(GEN_BP, "worldgen");
  const structures = readdirSync(join(wg, "structures")).map(f => json(join(wg, "structures", f))["minecraft:jigsaw"]);
  const pools = new Map(readdirSync(join(wg, "template_pools")).map(f => {
    const p = json(join(wg, "template_pools", f))["minecraft:template_pool"];
    return [p.description.identifier, p];
  }));
  assert.ok(structures.length >= 60, `estruturas (${structures.length})`);
  const ids = new Set(structures.map(s => s.description.identifier));
  for (const cove of ["lush", "magma", "submerged"]) assert.ok(ids.has(`cobblemon:shipwreck_coves_${cove}_shipwreck_cove`), `enseada ${cove}`);
  for (const s of structures) {
    assert.ok(!s.description.identifier.includes("/"), "id sem / (o /locate recusa)");
    assert.ok(pools.has(s.start_pool), `${s.description.identifier}: start_pool ${s.start_pool}`);
    assert.ok(s.max_depth <= 20 && s.max_distance_from_center.horizontal <= 128);
    assert.ok(Array.isArray(s.biome_filters) && s.biome_filters.length);
  }
  let elements = 0;
  for (const [id, p] of pools) {
    if (p.fallback) assert.ok(pools.has(p.fallback), `${id}: fallback`);
    for (const e of p.elements) {
      if (e.element.element_type === "minecraft:empty_pool_element") continue;
      elements++;
      assert.ok(existsSync(join(GEN_BP, "structures", `${e.element.location}.mcstructure`)), `${id}: ${e.element.location}`);
      assert.ok(!e.element.location.includes(":"), "location é caminho em structures/ (T3)");
    }
  }
  assert.ok(elements > 500);
  for (const f of readdirSync(join(wg, "structure_sets"))) {
    const set = json(join(wg, "structure_sets", f))["minecraft:structure_set"];
    for (const e of set.structures) assert.ok(ids.has(e.structure), `${f}: ${e.structure}`);
  }
  // Peça com jigsaws: pool alvo existe; marcador com índices válidos.
  const piece: any = readBedrockNbt(readFileSync(join(GEN_BP, "structures", "cobblemon", "jigsaw", "shipwreck_coves", "cove2", "cave.mcstructure")));
  const palette = piece.structure.palette.default.block_palette;
  assert.ok(palette.some((b: any) => b.name === "minecraft:jigsaw"), "jigsaws mantidos na peça");
  const bes = Object.values<any>(piece.structure.palette.default.block_position_data).map(v => v.block_entity_data).filter(Boolean).filter((b: any) => b.id === "JigsawBlock");
  assert.ok(bes.length > 0);
  for (const be of bes) assert.ok(be.target_pool === "minecraft:empty" || pools.has(be.target_pool), `target_pool ${be.target_pool}`);
  const marker = piece.structure.entities.find((e: any) => e.identifier === "cobblemon:structure_marker");
  assert.ok(marker, "marcador na peça");
  const parsed = parseMarkerTags(marker.Tags);
  assert.ok(parsed && parsed.ids.includes("cobblemon:shipwreck_coves/lush_shipwreck_cove"), "marcador aponta para a enseada");
  assert.equal(parsed!.radius, Math.ceil(Math.hypot(piece.size[0], piece.size[2]) / 2), "raio cobre a peça em qualquer rotação");
});

test("tabela de estruturas e tags", () => {
  assert.ok(STRUCTURE_IDS.includes("cobblemon:ruins/temperate_gimmi_tower"));
  assert.ok(STRUCTURE_TAGS["cobblemon:ruin"]?.includes("cobblemon:ruins/lush_gimmi_tower"), "#cobblemon:ruin inclui #cobblemon:ruins/tower");
  assert.deepEqual(STRUCTURE_TAGS, structureTags());
  for (const biome of ["plains", "desert", "savanna", "snowy", "taiga"]) {
    const pc = POKECENTERS[biome];
    assert.ok(pc && existsSync(join(GEN_BP, "structures", `${pc.structure.replace(":", "/")}.mcstructure`)), `pokécenter ${biome}`);
    assert.equal(pc.entranceFacing, "west");
  }
});

// ---------------------------------------------------------------------------------------------
// Registro de estruturas e vilas

test("registro por chunk", () => {
  assert.deepEqual(chunksCovered(8, 8, 0), [[0, 0]]);
  assert.equal(chunksCovered(0, 0, 16).length, 9);
  assert.deepEqual(chunksInBox(-1, -1, 16, 0), [[-1, -1], [-1, 0], [0, -1], [0, 0], [1, -1], [1, 0]]);
  assert.equal(regionKey("minecraft:overworld", 33, -1), "cobblemon:st:overworld:1:-1");
  assert.equal(normalizeStructureId("minecraft:village_plains"), VILLAGE_ID);
  assert.deepEqual(expandStructureQuery("#minecraft:village"), [VILLAGE_ID]);
  assert.ok(expandStructureQuery("#cobblemon:ruin").includes("cobblemon:ruins/deserted_gimmi_tower"));
  assert.deepEqual(expandStructureQuery("#cobblemon:nao_existe"), []);
  assert.deepEqual(parseMarkerTags(["x", "cobblemon:st=0,1,999", "cobblemon:sr=20"], ["a", "b"]), { ids: ["a", "b"], radius: 20 });
  assert.equal(parseMarkerTags(["cobblemon:sr=20"]), undefined);
  const data = new Map<string, string>();
  const store = { read: (k: string) => data.get(k), write: (k: string, v: string | undefined) => { if (v === undefined) data.delete(k); else data.set(k, v); } };
  const reg = new StructureRegistry(store);
  assert.equal(reg.register("minecraft:overworld", chunksCovered(100, 100, 20), "cobblemon:ruins/x"), 9);
  assert.equal(reg.register("minecraft:overworld", chunksCovered(100, 100, 20), "cobblemon:ruins/x"), 0, "idempotente");
  assert.equal(reg.flush(), 1);
  const again = new StructureRegistry(store);
  assert.deepEqual(again.structuresInChunk("minecraft:overworld", 6, 6), ["cobblemon:ruins/x"], "persistido");
  assert.deepEqual(again.structuresInChunk("minecraft:nether", 6, 6), []);
  // Consulta das frentes de spawn/evolução: vanilla sem detector → undefined; detectável fora → false.
  assert.ok(isDetectableStructure(VILLAGE_ID) && isDetectableStructure("cobblemon:ruins/lush_gimmi_tower") && !isDetectableStructure("minecraft:monument"));
  (world as any).getDynamicProperty = () => undefined;
  const dim: any = { id: "minecraft:overworld" };
  assert.equal(structureQuery(dim, { x: 0, y: 64, z: 0 }, ["minecraft:monument", "minecraft:igloo"]), undefined);
  assert.equal(structureQuery(dim, { x: 0, y: 64, z: 0 }, ["#cobblemon:ruin"]), false);
});

test("vilas: caixa, bioma, rotação e terreno", () => {
  assert.deepEqual(villageBox([{ x: 0, y: 64, z: 0 }, { x: 40, y: 70, z: -10 }], 16), { minX: -16, minZ: -26, maxX: 56, maxZ: 16 });
  assert.equal(villageBox([]), undefined);
  assert.equal(villageTypeOf("minecraft:desert"), "desert");
  assert.equal(villageTypeOf("minecraft:savanna_plateau"), "savanna");
  assert.equal(villageTypeOf("minecraft:ice_plains"), "snowy");
  assert.equal(villageTypeOf("minecraft:taiga"), "taiga");
  assert.equal(villageTypeOf("minecraft:plains"), "plains");
  assert.equal(rotateFacing("west", 1), "north");
  // Entrada a oeste; sino a leste do molde → gira 180°.
  assert.equal(rotationToward("west", 30, 0), 2);
  assert.equal(rotationToward("west", -30, 0), 0);
  assert.equal(rotateFacing("west", rotationToward("west", 0, 25)), "south");
  assert.ok(isFlatNatural([64, 65, 64], [true, true, true]));
  assert.ok(!isFlatNatural([64, 66], [true, true]), "variação > 1");
  assert.ok(!isFlatNatural([64, 64], [true, false]), "superfície não natural");
});

// ---------------------------------------------------------------------------------------------
// Contêineres

test("entidades de contêiner", () => {
  const chest = json(join(HAND_BP, "entities", "machines", "gilded_chest_storage.json"))["minecraft:entity"].components;
  assert.equal(chest["minecraft:inventory"].container_type, "container");
  assert.equal(chest["minecraft:inventory"].can_be_siphoned_from, true, "funil puxa (T10)");
  assert.ok(chest["minecraft:collision_box"].width > 1 && chest["minecraft:collision_box"].height > 1, "caixa maior que o bloco recebe o clique");
  assert.equal(chest["minecraft:interact"], undefined, "on_interact cancelaria a UI");
  const display = json(join(HAND_BP, "entities", "machines", "display_case_item.json"))["minecraft:entity"].components;
  assert.equal(display["minecraft:inventory"].inventory_size, 1);
  const storage = json(join(HAND_BP, "entities", "world", "machine_storage.json"))["minecraft:entity"].components;
  assert.ok(storage["minecraft:inventory"].inventory_size >= 14, "estante de discos cabe");
  assert.ok(!storage["minecraft:inventory"].can_be_siphoned_from);
  assert.ok(existsSync(join(HAND_BP, "entities", "world", "structure_marker.json")));
});

test("baú dourado quebra por golpes na entidade", () => {
  assert.equal(registerChestHit("e1", 0, true), true, "criativo: 1 golpe");
  for (let i = 1; i < CHEST_HITS; i++) assert.equal(registerChestHit("e2", i * 5, false), false);
  assert.equal(registerChestHit("e2", CHEST_HITS * 5, false), true);
  assert.equal(registerChestHit("e3", 0, false), false);
  assert.equal(registerChestHit("e3", 100, false), false, "janela expirou: recomeça");
});

// ---------------------------------------------------------------------------------------------
// Música de batalha

test("música de batalha", () => {
  assert.equal(battleMusicTrack("pvw"), "cobblemon.battle.pvw.default");
  assert.equal(battleMusicKind({ isPvP: true }), "pvp");
  assert.equal(battleMusicKind({ isPvN: true }), "pvn");
  assert.equal(battleMusicKind({ isPvW: true }), "pvw");
  assert.equal(battleMusicKind(undefined), undefined);
  const calls: string[] = [];
  const player: any = { id: "p1", playMusic: (id: string, o: any) => calls.push(`play ${id} ${o.loop}`), stopMusic: () => calls.push("stop") };
  (world as any).getDynamicProperty = (k: string) => (k === "cobblemon:battle_music" ? true : undefined);
  let battle: any = { isPvW: true };
  tickBattleMusic([player], () => battle);
  tickBattleMusic([player], () => battle);
  assert.deepEqual(calls, ["play cobblemon.battle.pvw.default true"], "toca uma vez em laço");
  battle = undefined;
  tickBattleMusic([player], () => battle);
  assert.deepEqual(calls.slice(1), ["stop"]);
  assert.ok(!isBattleMusicPlaying("p1"));
  (world as any).getDynamicProperty = () => undefined;
  assert.equal(startBattleMusic(player, "pvp"), false, "desligado por padrão (eventos vazios como no Cobblemon)");
  assert.equal(stopBattleMusic(player), false);
  const defs = readFileSync(join(ROOT, "resource_packs", "CobblemonBedrock", "sounds", "sound_definitions.json"), "utf8");
  for (const k of ["pvw", "pvp", "pvn"]) assert.ok(defs.includes(`"cobblemon.battle.${k}.default"`));
});

// ---------------------------------------------------------------------------------------------
// Dano por Pokémon


test("PokemonEntity.isInvulnerableTo: dono, ocupado, feixe e playerDamagePokemon", () => {
  const base = { busy: false, beam: false, owned: false, attackerIsPlayer: false, cause: "entityAttack", playerDamagePokemon: true };
  // Selvagem: jogador bate (config padrão), mob bate, sufoca.
  assert.equal(isPokemonInvulnerable({ ...base, attackerIsPlayer: true }), false);
  assert.equal(isPokemonInvulnerable(base), false);
  assert.equal(isPokemonInvulnerable({ ...base, cause: "suffocation" }), false);
  // Com dono: nenhum jogador (nem o dono) machuca; sufocamento não; mob e lava sim.
  assert.equal(isPokemonInvulnerable({ ...base, owned: true, attackerIsPlayer: true }), true);
  assert.equal(isPokemonInvulnerable({ ...base, owned: true, attackerIsPlayer: true, cause: "projectile" }), true);
  assert.equal(isPokemonInvulnerable({ ...base, owned: true, cause: "suffocation" }), true);
  assert.equal(isPokemonInvulnerable({ ...base, owned: true }), false);
  assert.equal(isPokemonInvulnerable({ ...base, owned: true, cause: "lava" }), false);
  // Ocupado (captura) ou no feixe: nada machuca.
  assert.equal(isPokemonInvulnerable({ ...base, busy: true, cause: "lava" }), true);
  assert.equal(isPokemonInvulnerable({ ...base, beam: true }), true);
  // playerDamagePokemon desligado: selvagem também fica imune a jogador.
  assert.equal(isPokemonInvulnerable({ ...base, attackerIsPlayer: true, playerDamagePokemon: false }), true);
  assert.equal(isPokemonInvulnerable({ ...base, playerDamagePokemon: false }), false);
});

test("dano por Pokémon (PokemonServerDelegate)", () => {
  assert.equal(attackToDamageCurve(5), 1);
  assert.equal(attackToDamageCurve(176), 10, "Rhydon nível 60: 5 corações");
  assert.equal(attackToDamageCurve(460), 15, "Slaking máximo: 7,5 corações");
  for (const base of [5, 45, 84, 130, 190]) assert.equal(speciesMeleeDamage(base), meleeDamage(base), "igual ao dano fixo gerado");
  assert.equal(scaledPokemonDamage(4, 176, 130), 4 * 10 / speciesMeleeDamage(130));
  assert.deepEqual(defenceToArmour(150), [0, 0]);
  assert.deepEqual(defenceToArmour(400), [20, 13]);
  assert.deepEqual(defenceToArmour(900), [30, 20]);
  assert.equal(damageAfterArmour(10, 0, 0), 10);
  assert.ok(Math.abs(damageAfterArmour(10, 20, 0) - 10 * (1 - 15 / 25)) < 1e-9);
});

// ---------------------------------------------------------------------------------------------
// Montaria

test("câmera, controles e roll da montaria", () => {
  assert.equal(rideCameraPreset("AIR", "auto"), "cobblemon:ride_orbit");
  assert.equal(rideCameraPreset("LIQUID", "auto"), "cobblemon:ride_orbit");
  assert.equal(rideCameraPreset("LAND", "auto"), undefined);
  assert.equal(rideCameraPreset("LAND", "always"), "cobblemon:ride_orbit");
  assert.equal(rideCameraPreset("AIR", "boom"), "cobblemon:ride_boom");
  assert.equal(rideCameraPreset("AIR", "off"), undefined);
  assert.ok(sneakDismounts("LAND") && !sneakDismounts("AIR") && !sneakDismounts("LIQUID"));
  assert.equal(yawDelta(170, -170), 20);
  assert.equal(yawDelta(-170, 170), -20);
  let roll = 0;
  for (let i = 0; i < 20; i++) roll = nextRoll(roll, 10);
  assert.ok(roll <= -29 && roll >= -45, `inclina na curva (${roll})`);
  for (let i = 0; i < 30; i++) roll = nextRoll(roll, 0);
  assert.ok(Math.abs(roll) < 0.5, "volta ao nível");
  for (const p of ["ride_orbit", "ride_boom"]) {
    const preset = json(join(HAND_BP, "cameras", "presets", `${p}.json`))["minecraft:camera_preset"];
    assert.equal(preset.identifier, `cobblemon:${p}`);
  }
  const flyers = readdirSync(join(GEN_BP, "entities", "pokemon")).filter(f => readFileSync(join(GEN_BP, "entities", "pokemon", f), "utf8").includes("cobblemon:ride_air\""));
  if (flyers.length) {
    const e = json(join(GEN_BP, "entities", "pokemon", flyers[0]))["minecraft:entity"];
    assert.ok(e.description.properties["cobblemon:roll"], `${flyers[0]}: propriedade de roll`);
  }
});

console.log(`motor: ${passed} testes ok`);
