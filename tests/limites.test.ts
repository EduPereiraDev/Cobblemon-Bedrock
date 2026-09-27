// Frente limites-a (pesquisa 8 promovida a produção): sprint da montaria (port do HorseBehaviour), freelook/roll,
// NPC com modelo de Pokémon (resourceIdentifier de espécie), NPC escondido por jogador, aranhas imunes à teia e
// Pokédex na estante entalhada (importador).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JAVA_DEFAULT_WALK_SPEED, SPRINT_DOUBLE_TAP_TICKS, SPRINT_REARM_STAMINA, newSprintState, rideStatLerp, sprintAccelerationSeconds, sprintBar,
  sprintFov, sprintStaminaSeconds, stepSpeed, stepSprint, stepStamina, walkMovementValue,
} from "../scripts/entity/RideSprint";
import { rollTestKeyframes } from "../scripts/entity/RideCameraRoll";
import { rideCameraPreset } from "../scripts/entity/Riding";
import {
  NPC_MODEL_SCALE, angleDelta, pokemonModelHitbox, pokemonModelScaleModifier, pokemonModelSpecies, rotationFromView,
} from "../scripts/npc/PokemonModelData";
import { NPC, npcAppearanceHooks } from "../scripts/npc/NPCEntity";
import { getNPCClass, getNPCClassIds, getNPCPresetIds } from "../scripts/npc/NPCClass";
import { handleLimitsEvent } from "../scripts/experimental/limits";
import { getEntityInfo } from "../scripts/entity/EntityData";
import { COBWEB_IMMUNE_FORMAT, isCobwebImmune, migratePushable, rideStyleInfo } from "../tools/importer/entities.ts";
import { vanillaItemTagsFor } from "../tools/importer/items.ts";

const ROOT = process.cwd();
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const SPECIES = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon", "species");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
};

// ------------------------------------------------------------------------------------------ sprint (#33)

test("duplo toque para frente em até 7 ticks liga o sprint", () => {
  const s = newSprintState();
  // 1º toque: arma o timer e o toggle (sprintToggleable), sem correr (como no Java).
  stepSprint(s, { forward: true, sprintKey: false });
  assert.equal(s.sprintTickTimer, SPRINT_DOUBLE_TAP_TICKS);
  assert.equal(s.sprintToggleable, true);
  assert.equal(s.sprinting, false);
  for (let i = 0; i < 3; i++) stepSprint(s, { forward: false, sprintKey: false });
  const tapped = stepSprint(s, { forward: true, sprintKey: false });
  assert.equal(tapped, true);
  assert.equal(s.sprinting, true);
});

test("toques espaçados demais não ligam", () => {
  const s = newSprintState();
  stepSprint(s, { forward: true, sprintKey: false });
  for (let i = 0; i < SPRINT_DOUBLE_TAP_TICKS + 2; i++) stepSprint(s, { forward: false, sprintKey: false });
  stepSprint(s, { forward: true, sprintKey: false });
  assert.equal(s.sprinting, false);
});

test("tecla de correr + frente liga; soltar a frente desliga", () => {
  const s = newSprintState();
  stepSprint(s, { forward: true, sprintKey: true });
  assert.equal(s.sprinting, false);
  stepSprint(s, { forward: true, sprintKey: true });
  assert.equal(s.sprinting, true);
  stepSprint(s, { forward: false, sprintKey: true });
  assert.equal(s.sprinting, false);
});

test("fôlego: gasta correndo, zera, e só rearma acima de 0,33", () => {
  const s = newSprintState();
  stepSprint(s, { forward: true, sprintKey: true });
  stepSprint(s, { forward: true, sprintKey: true });
  // 4 s de fôlego = 80 ticks correndo até zerar.
  let ticks = 0;
  while (s.stamina > 0 && ticks < 200) { stepStamina(s, 4); stepSprint(s, { forward: true, sprintKey: true }); ticks++; }
  assert.ok(ticks >= 79 && ticks <= 81, `ticks=${ticks}`);
  assert.equal(s.sprinting, false);
  assert.equal(s.sprintToggleable, false);
  for (let i = 0; i < 3; i++) { stepStamina(s, 4); stepSprint(s, { forward: true, sprintKey: true }); }
  assert.equal(s.sprinting, false);
  while (s.stamina <= SPRINT_REARM_STAMINA) { stepStamina(s, 4); stepSprint(s, { forward: true, sprintKey: true }); }
  stepSprint(s, { forward: true, sprintKey: true });
  stepSprint(s, { forward: true, sprintKey: true });
  assert.equal(s.sprinting, true);
});

test("fôlego infinito não gasta", () => {
  const s = newSprintState();
  s.sprinting = true;
  stepStamina(s, 4, true);
  assert.equal(s.stamina, 1);
});

test("q.get_ride_stats do horse.json: fôlego 4..240 s, aceleração 12..0,1 s", () => {
  assert.equal(rideStatLerp(240, 4, 0), 4);
  assert.equal(sprintStaminaSeconds(100), 240);
  assert.equal(sprintStaminaSeconds(0), 4);
  assert.ok(Math.abs(sprintAccelerationSeconds(100) - 0.1) < 1e-9);
  assert.equal(sprintAccelerationSeconds(0), 12);
});

test("velocidade acelera até o topo e volta ao andar", () => {
  let v = 0.2;
  for (let i = 0; i < 400; i++) v = stepSpeed(v, 0.2, 0.4, true, 2);
  assert.equal(v, 0.4);
  const one = stepSpeed(0.2, 0.2, 0.4, true, 2);
  assert.ok(Math.abs(one - 0.21) < 1e-9, `passo=${one}`); // 0,4 / 40 ticks
  for (let i = 0; i < 40; i++) v = stepSpeed(v, 0.2, 0.4, false, 2);
  assert.equal(v, 0.2);
});

test("andar montado = getWalkSpeed (walkSpeed × 0,7 × 0,42) convertido; FOV × 1,15", () => {
  // 0,35 × 0,7 × 0,42 = 0,1029 b/tick = 2,06 b/s ÷ 43 (sem o antigo × 0,8, review-fixes rodada 2).
  assert.equal(walkMovementValue(JAVA_DEFAULT_WALK_SPEED), 0.048);
  assert.equal(walkMovementValue(undefined), 0.048);
  assert.ok(walkMovementValue(0.5) > walkMovementValue(0.25));
  assert.equal(sprintFov(70), 80.5);
});

test("barra de fôlego: 10 blocos, cor por estado", () => {
  assert.equal((sprintBar(0.5, true).match(/■/g) ?? []).length, 10);
  assert.ok(sprintBar(0.5, true).startsWith("§e"));
  assert.ok(sprintBar(0.2, false, false).startsWith("§c"));
  assert.ok(sprintBar(0.9, false, true).startsWith("§a"));
});

test("importador: só o HorseBehaviour com canSprint tem sprint, com o walkSpeed da espécie", () => {
  const horse = rideStyleInfo("LAND", "cobblemon:land/horse", { SPEED: "40" }, 0.3, {});
  assert.equal(horse.sprint, true);
  assert.equal(horse.walkSpeed, 0.3);
  const noSprint = rideStyleInfo("LAND", "cobblemon:land/horse", { SPEED: "40" }, 0.3, { canSprint: "false" });
  assert.equal(noSprint.sprint, undefined);
  const vehicle = rideStyleInfo("LAND", "cobblemon:land/vehicle", { SPEED: "40" }, 0.3, {});
  assert.equal(vehicle.sprint, undefined);
});

test("montaria gerada: Arcanine tem sprint", () => {
  const land = getEntityInfo("arcanine")?.ride[""]?.styles.LAND;
  assert.equal(land?.sprint, true);
  assert.ok(typeof land?.walkSpeed === "number");
});

// ------------------------------------------------------------------------------------------ câmera (#38)

test("freelook = órbita em todos os estilos; roll = perseguidora só no ar; auto inalterado", () => {
  assert.equal(rideCameraPreset("LAND", "freelook"), "cobblemon:ride_orbit");
  assert.equal(rideCameraPreset("AIR", "freelook"), "cobblemon:ride_orbit");
  assert.equal(rideCameraPreset("AIR", "roll"), undefined);
  assert.equal(rideCameraPreset("LIQUID", "roll"), "cobblemon:ride_orbit");
  assert.equal(rideCameraPreset("LAND", "roll"), undefined);
  assert.equal(rideCameraPreset("LAND", "auto"), undefined);
  assert.equal(rideCameraPreset("AIR", "auto"), "cobblemon:ride_orbit");
});

test("keyframes do teste de roll mexem só no z", () => {
  const k = rollTestKeyframes(10, 90, 30);
  assert.deepEqual(k.map(f => f.rotation.z), [0, 30, -30, 0]);
  assert.ok(k.every(f => f.rotation.x === 10 && f.rotation.y === 90));
});

test("roll da câmera desligado por padrão (modo padrão = auto)", () => {
  const riding = readFileSync(join(ROOT, "scripts", "entity", "Riding.ts"), "utf8");
  assert.match(riding, /: "auto";/);
  assert.match(riding, /cameraMode === "roll"/);
});

// ------------------------------------------------------------------------------------------ NPC com modelo de Pokémon (#53)

test("resourceIdentifier de espécie liga o modelo; skins de NPC não", () => {
  assert.equal(pokemonModelSpecies("cobblemon:pikachu"), "pikachu");
  assert.equal(pokemonModelSpecies("Cobblemon:Mudkip"), "mudkip");
  assert.equal(pokemonModelSpecies("pikachu"), "pikachu");
  assert.equal(pokemonModelSpecies("cobblemon:standard"), undefined);
  assert.equal(pokemonModelSpecies("minecraft:pig"), undefined);
  assert.equal(pokemonModelSpecies(undefined), undefined);
  // Nenhuma classe/preset do 1.8.2 usa espécie (o Java também não): nada muda sem o behaviour/MoLang.
  for (const id of [...getNPCClassIds(), ...getNPCPresetIds()]) {
    const cls = getNPCClass(id);
    if (cls) assert.equal(pokemonModelSpecies(cls.resourceIdentifier), undefined, id);
  }
});

test("escala da exibição = renderScale × modelScale × hitboxScale ÷ baseScale; hitbox da espécie no tamanho desenhado", () => {
  const base = getEntityInfo("pikachu")!.sizes[0];
  assert.equal(pokemonModelScaleModifier("pikachu", 1), Math.round((NPC_MODEL_SCALE / base.scale) * 1000) / 1000);
  assert.equal(pokemonModelScaleModifier("pikachu", 100), 3.5, "limitada à faixa da propriedade");
  assert.equal(pokemonModelScaleModifier("pikachu", 0.001), 0.05);
  const hb = pokemonModelHitbox("pikachu", 1)!;
  assert.equal(hb.width, Math.round(base.width * NPC_MODEL_SCALE * 100) / 100);
  assert.equal(hb.height, Math.round(base.height * NPC_MODEL_SCALE * 100) / 100);
  assert.equal(pokemonModelHitbox("naoexiste"), undefined);
});

test("cabeça: rotação a partir da direção do olhar", () => {
  assert.deepEqual(rotationFromView({ x: 0, y: 0, z: 1 }), { x: 0, y: 0 });
  assert.equal(rotationFromView({ x: -1, y: 0, z: 0 }).y, 90);
  assert.equal(rotationFromView({ x: 0, y: -1, z: 0.0001 }).x, 90);
  assert.equal(angleDelta(179, -179), 2);
});

/** Entidade de NPC falsa (dynamic properties e propriedades em mapas). */
function fakeNpcEntity(props: Record<string, unknown>) {
  const dynamic = new Map<string, unknown>(Object.entries(props));
  const properties = new Map<string, unknown>();
  const events: string[] = [];
  return {
    id: "-1", typeId: "cobblemon:npc", isValid: true, nameTag: "", events, properties,
    getDynamicProperty: (k: string) => dynamic.get(k),
    setDynamicProperty: (k: string, v: unknown) => { if (v === undefined) dynamic.delete(k); else dynamic.set(k, v); },
    getProperty: (k: string) => properties.get(k),
    setProperty: (k: string, v: unknown) => { properties.set(k, v); },
    triggerEvent: (e: string) => { events.push(e); },
  };
}

test("NPC: set_resource_identifier de espécie troca a hitbox padrão e avisa o modelo; set_hitbox manda", () => {
  const entity = fakeNpcEntity({ "npc:class": "cobblemon:standard" });
  const npc = new NPC(entity as never);
  const classHitbox = npc.hitbox;
  assert.equal(npc.pokemonModelSpecies, undefined);
  const seen: string[] = [];
  npcAppearanceHooks.push(n => seen.push(n.pokemonModelSpecies ?? "-"));
  npc.setResourceIdentifier("cobblemon:pikachu");
  assert.equal(npc.pokemonModelSpecies, "pikachu");
  assert.deepEqual(npc.hitbox, pokemonModelHitbox("pikachu", 1));
  assert.ok(seen.includes("pikachu"), "gancho de aparência chamado");
  assert.ok(entity.events.some(e => e.startsWith("cobblemon:npc_hitbox_w")), "grupo de colisão reaplicado");
  npc.setHitbox({ width: 2, height: 2 });
  assert.deepEqual(npc.hitbox, { width: 2, height: 2 });
  npc.setHitbox(undefined);
  npc.setPlayerTexture("Steve");
  assert.equal(npc.pokemonModelSpecies, undefined, "skin de jogador vence (player_textured força cobblemon:standard)");
  npc.setPlayerTexture(undefined);
  npc.setResourceIdentifier(undefined);
  assert.deepEqual(npc.hitbox, classHitbox);
  npcAppearanceHooks.pop();
});

test("pack gerado: npc_hidden (client_sync, padrão false), part_visibility e assento só por evento", () => {
  const bp = readJson(join(GEN_BP, "entities", "npc", "npc.json"))["minecraft:entity"];
  assert.equal(bp.description.properties["cobblemon:npc_hidden"].default, false);
  assert.equal(bp.description.properties["cobblemon:npc_hidden"].client_sync, true);
  assert.equal(bp.components["minecraft:rideable"], undefined, "sem assento por padrão");
  const seat = bp.component_groups["cobblemon:npc_model_seat"]["minecraft:rideable"];
  assert.deepEqual(seat.family_types, ["pokemon"]);
  assert.equal(seat.pull_in_entities, false);
  assert.ok(bp.events["cobblemon:npc_model_seat_on"] && bp.events["cobblemon:npc_model_seat_off"]);
  const rc = readJson(join(GEN_RP, "render_controllers", "npc", "cobblemon_npc.render_controllers.json"));
  assert.equal(rc.render_controllers["controller.render.cobblemon_npc"].part_visibility[0]["*"], "!q.property('cobblemon:npc_hidden')");
  // Os overlays escritos à mão do protótipo saíram (o validate acusava render controller duplicado).
  assert.equal(existsSync(join(ROOT, "behavior_packs", "CobblemonBedrock", "entities", "npc", "npc.json")), false);
  assert.equal(existsSync(join(ROOT, "resource_packs", "CobblemonBedrock", "render_controllers", "npc")), false);
});

// ------------------------------------------------------------------------------------------ NPC escondido

test("handler de interação do NPC sai para quem não vê o NPC (antes de abrir o diálogo)", () => {
  const src = readFileSync(join(ROOT, "scripts", "npc", "index.ts"), "utf8");
  const i = src.indexOf("if (shouldHideFrom(target, player)) return;");
  assert.ok(i > 0);
  assert.ok(i < src.indexOf("interactWithNPC(player, target)"));
  assert.match(src, /startNpcHide\(\);/);
  assert.match(src, /startNpcPokemonModels\(\);/);
});

// ------------------------------------------------------------------------------------------ teia (#79)

test("aranhas: as 8 espécies com immuneToCobwebBlock", () => {
  const immune = ["generation2/spinarak", "generation2/ariados", "generation5/joltik", "generation5/galvantula", "generation7/dewpider",
    "generation7/araquanid", "generation9/tarountula", "generation9/spidops"];
  for (const f of immune) assert.equal(isCobwebImmune(readJson(join(SPECIES, `${f}.json`))), true, f);
  assert.equal(isCobwebImmune(readJson(join(SPECIES, "generation1", "pikachu.json"))), false);
});

test("aranhas geradas: format 1.26.50, imunes à teia, sem minecraft:pushable", () => {
  for (const id of ["spinarak", "ariados", "joltik", "galvantula", "dewpider", "araquanid", "tarountula", "spidops"]) {
    const json = readJson(join(GEN_BP, "entities", "pokemon", `${id}.json`));
    assert.equal(json.format_version, COBWEB_IMMUNE_FORMAT, id);
    const e = json["minecraft:entity"];
    assert.deepEqual(e.components["minecraft:block_movement_slowdown_immunity"], { blocks: ["minecraft:web"] }, id);
    assert.doesNotMatch(JSON.stringify(e), /"minecraft:pushable"/, id);
    assert.ok(e.components["minecraft:pushable_by_entity"] && e.components["minecraft:pushable_by_block"], id);
  }
  const pikachu = readJson(join(GEN_BP, "entities", "pokemon", "pikachu.json"));
  assert.equal(pikachu.format_version, "1.21.90");
  assert.equal(pikachu["minecraft:entity"].components["minecraft:block_movement_slowdown_immunity"], undefined);
});

test("migratePushable: is_pushable/is_pushable_by_piston viram os componentes do 1.26.50", () => {
  const a: Record<string, any> = { "minecraft:pushable": { is_pushable: true, is_pushable_by_piston: true } };
  migratePushable(a);
  assert.deepEqual(a, { "minecraft:pushable_by_entity": {}, "minecraft:pushable_by_block": {} });
  const b: Record<string, any> = { "minecraft:pushable": { is_pushable: false, is_pushable_by_piston: true } };
  migratePushable(b);
  assert.deepEqual(b, { "minecraft:pushable_by_block": {} });
});

// ------------------------------------------------------------------------------------------ estante (#31)

test("Pokédex: tag minecraft:bookshelf_books (data/minecraft/tags/item/bookshelf_books = #cobblemon:pokedex)", () => {
  assert.deepEqual(vanillaItemTagsFor("cobblemon:pokedex_red", ["cobblemon:pokedex"]), ["minecraft:bookshelf_books"]);
  assert.deepEqual(vanillaItemTagsFor("cobblemon:poke_ball", ["cobblemon:poke_balls"]), []);
  for (const color of ["black", "blue", "green", "pink", "red", "white", "yellow"]) {
    const item = readJson(join(GEN_BP, "items", "cobblemon", `pokedex_${color}.json`))["minecraft:item"];
    assert.ok(item.components["minecraft:tags"].tags.includes("minecraft:bookshelf_books"), color);
  }
});

// ------------------------------------------------------------------------------------------ sondas

test("sondas cblimits:* não fazem nada sem as sondas de depuração", () => {
  handleLimitsEvent("cblimits:npc_model_info", "", undefined);
  handleLimitsEvent("cblimits:input_probe", "on", undefined);
  const main = readFileSync(join(ROOT, "scripts", "main.ts"), "utf8");
  assert.match(main, /registerLimitPrototypes\(\);/);
  const probes = readFileSync(join(ROOT, "scripts", "experimental", "limits", "index.ts"), "utf8");
  assert.match(probes, /if \(!debugProbesEnabled\(\)\) return;/);
  assert.doesNotMatch(probes, /case "on":|case "freelook":|case "npc_model":/, "sem liga/desliga de recurso promovido");
});

console.log(`limites: ${passed} testes ok`);
