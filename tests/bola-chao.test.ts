// Frente ball-hit, "afundando no chão (beta 7)" (docs/pendencias/ball-hit.md): a sequência de captura roda na
// `cobblemon:<bola>_dummy`, não no projétil com runtime de snowball (que o servidor fazia cair através do chão).
// 1. Dados: cada bola arremessável tem a dummy; a dummy não tem projétil nem física; o evento `cobblemon:capture` a
//    deixa com a escala do projétil (1,0) sem mudar a do envio (0,4); o client entity é o mesmo da bola.
// 2. swapToCaptureDummy: posição/direção, propriedades, remoção do projétil sem item; sem dummy segue no projétil.
// 3. Handlers de verdade (catching/index.ts): acerto num selvagem → dummy anima, projétil sai sem item, nada de
//    acerto/item duplo depois; recusas (não selvagem/uncatchable) continuam no projétil com item, sem dummy.
// 4. groundBelow: o topo do 1º bloco com colisão abaixo (o getBlockBelow antigo não achava vidro, folhas, laje...).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Player, system, world } from "@minecraft/server";
import { getAllPokeBalls } from "../scripts/catching/PokeBalls";
import { CAPTURE_DUMMY_EVENT, captureDummyId, swapToCaptureDummy } from "../scripts/catching/CaptureDummy";
import { groundBelow, isCaptureInProgress } from "../scripts/catching/CaptureSequence";
import { addBallHitHook, bindCatchEvents, clearBallHitHooksForTests } from "../scripts/catching";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

const readLenient = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));

// ---------------------------------------------------------------------------------------------
// 1. Dados do BP/RP

await test("as 49 bolas têm a dummy; ela não tem projétil nem física e a captura a deixa do tamanho do projétil", () => {
  const bp = "behavior_packs/CobblemonBedrock/entities/pokeballs";
  const rp = "resource_packs/CobblemonBedrock/entity/pokeballs";
  const balls = getAllPokeBalls();
  assert.equal(balls.length, 49);
  for (const ball of balls) {
    const thrown = readLenient(`${bp}/${ball.name}.json`)["minecraft:entity"];
    const dummy = readLenient(`${bp}/${ball.name}_dummy.json`)["minecraft:entity"];
    assert.equal(dummy.description.identifier, captureDummyId(`cobblemon:${ball.name}`));
    assert.equal(dummy.description.runtime_identifier, undefined, `${ball.name}: dummy sem runtime de arremessável`);
    for (const component of ["minecraft:projectile", "minecraft:physics", "minecraft:pushable"]) {
      assert.equal(dummy.components[component], undefined, `${ball.name}_dummy sem ${component}`);
      for (const group of Object.values<Record<string, unknown>>(dummy.component_groups))
        assert.equal(group[component], undefined, `${ball.name}_dummy: nenhum grupo põe ${component}`);
    }
    // Escala: o projétil não tem minecraft:scale (1,0); a captura põe 1,0 na dummy; o envio continua 0,4.
    const thrownScale = thrown.components["minecraft:scale"]?.value ?? 1;
    assert.equal(dummy.components["minecraft:scale"].value, 0.4, `${ball.name}_dummy: escala do envio intacta`);
    const event = dummy.events[CAPTURE_DUMMY_EVENT];
    assert.deepEqual(event, { add: { component_groups: [CAPTURE_DUMMY_EVENT] } }, `${ball.name}_dummy: evento ${CAPTURE_DUMMY_EVENT}`);
    assert.equal(dummy.component_groups[CAPTURE_DUMMY_EVENT]["minecraft:scale"].value, thrownScale, `${ball.name}: dummy da captura do tamanho do projétil`);
    assert.ok(dummy.events["cobblemon:instant_kill"], `${ball.name}_dummy some com cobblemon:instant_kill (killBall)`);
    // Mesmo visual: geometria, textura, material, animações e render controller iguais aos da bola.
    // As comuns estão no RP escrito à mão; as ancient vêm do importador (generated/, pokeballs.ts gera as duas iguais).
    const dir = existsSync(`${rp}/${ball.name}.json`) ? rp : `generated/${rp}`;
    if (!existsSync(`${dir}/${ball.name}.json`)) { assert.ok(ball.ancient, `${ball.name}: client entity no RP`); continue; }
    const thrownClient = readLenient(`${dir}/${ball.name}.json`)["minecraft:client_entity"].description;
    const dummyClient = readLenient(`${dir}/${ball.name}_dummy.json`)["minecraft:client_entity"].description;
    const { identifier: a, ...thrownLook } = thrownClient;
    const { identifier: b, ...dummyLook } = dummyClient;
    assert.equal(b, `${a}_dummy`);
    assert.deepEqual(dummyLook, thrownLook, `${ball.name}: client entity da dummy igual ao da bola`);
  }
});

// ---------------------------------------------------------------------------------------------
// groundBelow: raio para baixo sem fluidos/passáveis, topo da colisão (faceLocation medido no BDS)

await test("groundBelow: 1º bloco com colisão abaixo, topo pelo faceLocation (0 = bloco inteiro, laje 0,5)", () => {
  const calls: unknown[] = [];
  const at = (hit: unknown) => ({
    location: { x: 0.5, y: 173.5, z: 0.5 },
    dimension: { getBlockFromRay: (from: unknown, dir: unknown, options: unknown) => { calls.push({ from, dir, options }); return hit; } },
  }) as never;
  const block = (y: number) => ({ location: { x: 0, y, z: 0 }, typeId: "minecraft:glass" });
  // Medido: vidro/pedra/folhas/gelo faceLocation.y = 0; laje 0,5; terra arada 0,9375.
  assert.equal(groundBelow(at({ block: block(169), face: "Up", faceLocation: { x: 0.5, y: 0, z: 0.5 } })), 170);
  assert.equal(groundBelow(at({ block: block(169), face: "Up", faceLocation: { x: 0.5, y: 0.5, z: 0.5 } })), 169.5);
  assert.equal(groundBelow(at({ block: block(169), face: "Up", faceLocation: { x: 0.5, y: 0.9375, z: 0.5 } })), 169.9375);
  assert.equal(groundBelow(at({ block: block(169), face: "Up", faceLocation: { x: 0.5, y: 1, z: 0.5 } })), 170);
  // Valor absoluto (se o motor mudar): continua o topo certo.
  assert.equal(groundBelow(at({ block: block(169), face: "Up", faceLocation: { x: 0.5, y: 169.5, z: 0.5 } })), 169.5);
  // Nada abaixo (vazio, só água): cai o 1,5 s inteiro, como o Java (o clip ignora fluidos).
  assert.equal(groundBelow(at(undefined)), undefined);
  const call = calls[0] as { dir: unknown; options: Record<string, unknown> };
  assert.deepEqual(call.dir, { x: 0, y: -1, z: 0 });
  assert.equal(call.options.includeLiquidBlocks, false);
  assert.equal(call.options.includePassableBlocks, false);
  const throwing = { location: { x: 0, y: 0, z: 0 }, dimension: { getBlockFromRay: () => { throw new Error("fora do mundo"); } } } as never;
  assert.equal(groundBelow(throwing), undefined);
});

// ---------------------------------------------------------------------------------------------
// Entidades falsas

type Props = Record<string, unknown>;
const drops: unknown[] = [];
const spawned: FakeEntity[] = [];
let failSpawn = false;

interface FakeEntity {
  typeId: string; id: string; isValid: boolean; location: { x: number; y: number; z: number }; props: Props;
  removed: number; killed: number; events: string[]; teleports: unknown[]; animations: string[];
  spawnOptions?: { initialRotation?: number; spawnEvent?: string };
  [k: string]: unknown;
}

let nextId = 0;
const dimension = {
  id: "minecraft:overworld",
  spawnItem: (item: unknown) => { drops.push(item); },
  spawnParticle: () => { },
  playSound: () => { },
  getPlayers: () => [],
  getBlockBelow: () => undefined,
  spawnEntity: (typeId: string, location: { x: number; y: number; z: number }, options?: FakeEntity["spawnOptions"]) => {
    if (failSpawn) throw new Error(`tipo inválido ${typeId}`);
    const e = fake(typeId, [typeId.endsWith("_dummy") ? "pokeball_dummy" : "?"], { ...location });
    e.spawnOptions = options;
    if (options?.spawnEvent) e.events.push(options.spawnEvent);
    spawned.push(e);
    return e;
  },
};

function fake(typeId: string, families: string[], location = { x: 10.25, y: 64.5, z: -3.75 }, props: Props = {}): FakeEntity {
  const e: FakeEntity = {
    typeId, id: `e${++nextId}`, isValid: true, location, props: { ...props }, removed: 0, killed: 0, events: [], teleports: [], animations: [],
    dimension,
    getComponent: (id: string) => id === "minecraft:type_family" ? { hasTypeFamily: (f: string) => families.includes(f) } : undefined,
    getDynamicProperty: (k: string) => e.props[k],
    setDynamicProperty: (k: string, v: unknown) => { e.props[k] = v; },
    getProperty: (k: string) => e.props[`prop:${k}`],
    setProperty: (k: string, v: unknown) => { e.props[`prop:${k}`] = v; },
    getRotation: () => ({ x: 12, y: 135 }),
    triggerEvent: (ev: string) => { e.events.push(ev); if (ev === "cobblemon:instant_kill") { e.killed++; e.isValid = false; } },
    remove: () => { e.removed++; e.isValid = false; },
    teleport: (to: unknown) => { e.teleports.push(to); },
    clearVelocity: () => { },
    playAnimation: (a: string) => { e.animations.push(a); },
    hasTag: () => false,
    addEffect: () => { },
    removeEffect: () => { },
    getHeadLocation: () => ({ x: 0, y: 65, z: 0 }),
    getTags: () => [],
  };
  return e;
}

// ---------------------------------------------------------------------------------------------
// 2. swapToCaptureDummy

await test("troca: dummy da mesma bola no ponto, com a direção e o evento de captura; projétil removido sem item", () => {
  drops.length = 0; spawned.length = 0;
  const projectile = fake("cobblemon:great_ball", ["pokeball"], undefined, { player_id: "p1", activated: true });
  const at = { x: 1, y: 70, z: 2 };
  const dummy = swapToCaptureDummy(projectile as never, at) as unknown as FakeEntity;
  assert.equal(spawned.length, 1);
  assert.equal(dummy, spawned[0]);
  assert.equal(dummy.typeId, "cobblemon:great_ball_dummy");
  assert.deepEqual(dummy.location, at, "no ponto onde a bola parou");
  assert.equal(dummy.spawnOptions?.initialRotation, 135, "mesma direção (yaw)");
  assert.equal(dummy.spawnOptions?.spawnEvent, CAPTURE_DUMMY_EVENT);
  assert.equal(dummy.props.player_id, "p1");
  assert.equal(dummy.props.activated, true);
  assert.equal(projectile.removed, 1, "projétil removido");
  assert.equal(projectile.props.resolved, true);
  assert.equal(drops.length, 0, "nenhum item");
  // Sem `at`: a posição do projétil.
  const other = fake("cobblemon:ancient_feather_ball", ["pokeball"], { x: 5, y: 6, z: 7 });
  const d2 = swapToCaptureDummy(other as never) as unknown as FakeEntity;
  assert.equal(d2.typeId, "cobblemon:ancient_feather_ball_dummy");
  assert.deepEqual(d2.location, { x: 5, y: 6, z: 7 });
});

await test("troca: sem dummy (spawn falhou) segue no projétil, como na beta 7", () => {
  spawned.length = 0;
  failSpawn = true;
  const projectile = fake("cobblemon:poke_ball", ["pokeball"]);
  const warn = console.warn; console.warn = () => { };
  try { assert.equal(swapToCaptureDummy(projectile as never), projectile as never); }
  finally { console.warn = warn; failSpawn = false; }
  assert.equal(projectile.removed, 0);
  assert.equal(projectile.isValid, true);
});

// ---------------------------------------------------------------------------------------------
// 3. Handlers de verdade

type Handler = (arg: any) => void;
const handlers = new Map<string, Handler[]>();
const recorder = (name: string) => ({
  subscribe: (fn: Handler) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]); return fn; },
  unsubscribe: () => { },
});
const events = new Proxy({}, { get: (_t, key) => recorder(String(key)) });
const w = world as any;
w.afterEvents = events;
w.beforeEvents = events;
w.getEntity = () => undefined;
const timeouts: { ticks: number; fn: () => void }[] = [];
const s = system as any;
s.runTimeout = (fn: () => void, ticks: number) => { timeouts.push({ fn, ticks }); return timeouts.length; };
s.run = (fn: () => void) => { fn(); return 0; };
s.runInterval = () => 0;
s.clearRun = () => { };
bindCatchEvents();
const fire = (name: string, arg: any) => {
  for (const fn of handlers.get(name) ?? []) fn(arg);
};

function makePlayer() {
  const player = { id: "jogador", isValid: true, name: "Jogador", messages: [] as unknown[], getGameMode: () => "Survival", sendMessage: (m: unknown) => { player.messages.push(m); }, dimension, location: { x: 0, y: 64, z: 0 },
    getDynamicProperty: () => undefined, setDynamicProperty: () => { }, getComponent: () => undefined, hasTag: () => false, getTags: () => [] };
  return Object.setPrototypeOf(player, (Player as any).prototype) as typeof player;
}
const hitAt = { x: 10, y: 64.5, z: -3 };
const entityHit = (ball: unknown, source: unknown, target: unknown) => ({
  projectile: ball, source, dimension, location: hitAt, hitVector: { x: 0, y: 0, z: 1 },
  getEntityHit: () => ({ entity: target }),
});

await test("acerto num selvagem: a sequência roda na dummy; o projétil sai sem item e não acerta de novo", async () => {
  drops.length = 0; spawned.length = 0; timeouts.length = 0;
  const player = makePlayer();
  const ball = fake("cobblemon:ultra_ball", ["pokeball"]);
  const wild = fake("cobblemon:snorlax", ["pokemon"], { x: 10, y: 64, z: -1 }, { "prop:cobblemon:wild": true });
  fire("projectileHitEntity", entityHit(ball, player, wild));
  assert.equal(spawned.length, 1, "uma dummy");
  const dummy = spawned[0];
  assert.equal(dummy.typeId, "cobblemon:ultra_ball_dummy");
  assert.ok(dummy.events.includes(CAPTURE_DUMMY_EVENT));
  assert.equal(ball.removed, 1, "projétil removido");
  assert.equal(ball.props.activated, true);
  assert.ok(ball.events.includes("cobblemon:disable"));
  assert.equal(drops.length, 0, "sem item no acerto");
  assert.equal(isCaptureInProgress(dummy as never), true, "a captura em andamento é a da dummy (entityLoad não a mata)");
  assert.equal(isCaptureInProgress(ball as never), false);
  // O quique começa: os teleportes vão para a dummy, nunca para o projétil.
  for (let i = 0; i < 3; i++) { const next = timeouts.shift(); next?.fn(); await new Promise((r) => setImmediate(r)); }
  assert.ok(dummy.teleports.length >= 1, "a dummy é movida pela sequência");
  assert.equal(ball.teleports.length, 0, "o projétil não é mais movido");
  // Eventos atrasados do projétil (bloco, entidade) não derrubam item nem começam outra captura.
  fire("projectileHitBlock", { projectile: ball, source: player, dimension, location: hitAt });
  fire("projectileHitEntity", entityHit(ball, player, wild));
  assert.equal(drops.length, 0, "sem item atrasado");
  assert.equal(spawned.length, 1, "sem segunda dummy");
});

await test("recusas (não selvagem, uncatchable) continuam no projétil: item + mensagem, sem dummy", () => {
  drops.length = 0; spawned.length = 0;
  const player = makePlayer();
  const owned = fake("cobblemon:poke_ball", ["pokeball"]);
  fire("projectileHitEntity", entityHit(owned, player, fake("cobblemon:eevee", ["pokemon"], undefined, { "prop:cobblemon:wild": false })));
  const refused = fake("cobblemon:poke_ball", ["pokeball"]);
  const uncatchable = fake("cobblemon:mew", ["pokemon"], undefined, { "prop:cobblemon:wild": true });
  (uncatchable as { hasTag: (t: string) => boolean }).hasTag = (t) => t === "uncatchable";
  fire("projectileHitEntity", entityHit(refused, player, uncatchable));
  assert.equal(spawned.length, 0, "nenhuma dummy");
  assert.equal(drops.length, 2, "um item por recusa");
  assert.equal(owned.killed + refused.killed, 2);
  assert.equal(player.messages.length, 2);
});

await test("frente msd-fase6: gancho de acerto cancelável (THROWN_POKEBALL_HIT): item sem mensagem nem dummy; sem gancho, igual", () => {
  drops.length = 0; spawned.length = 0;
  const player = makePlayer();
  const seen: unknown[][] = [];
  addBallHitHook((thrower, target, ball) => { seen.push([thrower, target, ball]); return target.typeId === "cobblemon:ditto"; });
  const canceledBall = fake("cobblemon:poke_ball", ["pokeball"]);
  const ditto = fake("cobblemon:ditto", ["pokemon"], undefined, { "prop:cobblemon:wild": true });
  fire("projectileHitEntity", entityHit(canceledBall, player, ditto));
  assert.equal(seen.length, 1, "o gancho roda depois das validações");
  assert.equal(seen[0][2], "cobblemon:poke_ball");
  assert.equal(spawned.length, 0, "cancelado: sem dummy");
  assert.equal(drops.length, 1, "cancelado: a bola volta a ser item (drop)");
  assert.equal(player.messages.length, 0, "cancelado: sem mensagem (o Java só dá drop())");
  assert.notEqual(canceledBall.props.activated, true);
  // Recusa antes do gancho (não selvagem): o gancho nem roda.
  fire("projectileHitEntity", entityHit(fake("cobblemon:poke_ball", ["pokeball"]), player, fake("cobblemon:ditto", ["pokemon"], undefined, { "prop:cobblemon:wild": false })));
  assert.equal(seen.length, 1, "validações do base antes do gancho");
  // Gancho que deixa (outra espécie): a captura começa como sempre.
  fire("projectileHitEntity", entityHit(fake("cobblemon:poke_ball", ["pokeball"]), player, fake("cobblemon:eevee", ["pokemon"], undefined, { "prop:cobblemon:wild": true })));
  assert.equal(spawned.length, 1, "não cancelado: dummy da captura");
  clearBallHitHooksForTests();
});

console.log(`bola-chao: ${passed} ok`);
