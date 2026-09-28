// Frente "scr" (docs/pendencias/cliente-teste3.md): terceiro teste em cliente real.
// 1. Poké Ball que não captura: volta a ser item como no EmptyPokeBallEntity do Java (bloco, entidade que não é Pokémon,
//    captura recusada), some no criativo e sem dono, e expira em 600 ticks sem acertar nada.
import assert from "node:assert/strict";
import { Player, system, world } from "@minecraft/server";
import { BALL_MAX_FLIGHT_TICKS, missedBallItem, shouldExpireBall } from "../scripts/catching/MissedBall";
import { bindCatchEvents } from "../scripts/catching";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}`); throw e; }
}

// ---------------------------------------------------------------------------------------------
// Regra pura

test("sobrevivência: cai o item da MESMA bola", () => {
  const survival = { creative: false };
  assert.equal(missedBallItem("cobblemon:poke_ball", survival), "cobblemon:poke_ball");
  assert.equal(missedBallItem("cobblemon:great_ball", survival), "cobblemon:great_ball");
  assert.equal(missedBallItem("cobblemon:ancient_feather_ball", survival), "cobblemon:ancient_feather_ball");
  assert.equal(missedBallItem("cobblemon:master_ball", survival), "cobblemon:master_ball");
  // Id desconhecido: Poké Ball comum (getPokeBallOrDefault, como o `pokeBall = POKE_BALL` padrão da entidade).
  assert.equal(missedBallItem("cobblemon:nao_existe", survival), "cobblemon:poke_ball");
  assert.equal(missedBallItem(undefined, survival), "cobblemon:poke_ball");
});

test("criativo e sem dono: só some (onHitBlock `player?.isCreative == false`, drop() e tick sem dono)", () => {
  assert.equal(missedBallItem("cobblemon:ultra_ball", { creative: true }), undefined);
  assert.equal(missedBallItem("cobblemon:ultra_ball", undefined), undefined);
});

test("expira em 600 ticks sem capturar (tickCount > 600 && capturingPokemon == null)", () => {
  assert.equal(BALL_MAX_FLIGHT_TICKS, 600);
  assert.equal(shouldExpireBall(599, false), false);
  assert.equal(shouldExpireBall(600, false), true);
  assert.equal(shouldExpireBall(10_000, true), false, "bola em captura não expira");
});

// ---------------------------------------------------------------------------------------------
// Handlers de verdade (catching/index.ts) com entidades falsas

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
bindCatchEvents();
const fire = (name: string, arg: any) => {
  const list = handlers.get(name) ?? [];
  assert.ok(list.length > 0, `handler ${name} registrado`);
  for (const fn of list) fn(arg);
};

const drops: { item: unknown; location: unknown; dimension: string }[] = [];
const dimension = (name: string) => ({
  name,
  spawnItem: (item: unknown, location: unknown) => { drops.push({ item, location, dimension: name }); },
  spawnParticle: () => { },
  playSound: () => { },
  getPlayers: () => [],
});
const hitDimension = dimension("hit");

function makeBall(typeId = "cobblemon:great_ball", props: Record<string, unknown> = {}) {
  const ball = {
    typeId, isValid: true, location: { x: 100, y: 64, z: 100 }, dimension: dimension("ball"), killed: 0, props: { ...props },
    getComponent: (id: string) => id === "minecraft:type_family" ? { hasTypeFamily: (f: string) => f === "pokeball" } : undefined,
    getDynamicProperty: (k: string) => ball.props[k],
    setDynamicProperty: (k: string, v: unknown) => { ball.props[k] = v; },
    getProperty: () => false,
    triggerEvent: (e: string) => { if (e === "cobblemon:instant_kill") ball.killed++; },
    playAnimation: () => { },
  };
  return ball;
}

function makePlayer(mode: "Survival" | "Creative") {
  const player = { id: `p-${mode}`, isValid: true, messages: [] as unknown[], getGameMode: () => mode, sendMessage: (m: unknown) => { player.messages.push(m); } };
  // `source instanceof Player` no handler: o jogador falso herda do protótipo do mock.
  return Object.setPrototypeOf(player, (Player as any).prototype) as typeof player;
}

const hitAt = { x: 1.5, y: 70, z: -3.25 };

test("bateu no bloco (sobrevivência): 1 item no ponto do acerto e a bola some", () => {
  drops.length = 0;
  const ball = makeBall();
  fire("projectileHitBlock", { projectile: ball, source: makePlayer("Survival"), dimension: hitDimension, location: hitAt });
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0].location, hitAt, "no ponto do acerto do evento");
  assert.equal(drops[0].dimension, "hit", "na dimensão do evento (não depende da entidade continuar válida)");
  assert.equal(ball.killed, 1);
});

test("bateu no bloco (criativo): some sem item", () => {
  drops.length = 0;
  const ball = makeBall();
  fire("projectileHitBlock", { projectile: ball, source: makePlayer("Creative"), dimension: hitDimension, location: hitAt });
  assert.equal(drops.length, 0);
  assert.equal(ball.killed, 1);
});

test("bola já em captura (activated) não vira item ao tocar o chão", () => {
  drops.length = 0;
  const ball = makeBall("cobblemon:great_ball", { activated: true });
  fire("projectileHitBlock", { projectile: ball, source: makePlayer("Survival"), dimension: hitDimension, location: hitAt });
  assert.equal(drops.length, 0);
  assert.equal(ball.killed, 0);
});

function entity(families: string[], props: Record<string, unknown> = {}, tags: string[] = []) {
  return {
    typeId: "cobblemon:snorlax", id: "alvo", isValid: true, location: { x: 0, y: 0, z: 0 },
    getComponent: (id: string) => id === "minecraft:type_family" ? { hasTypeFamily: (f: string) => families.includes(f) } : undefined,
    getProperty: (k: string) => props[k],
    getDynamicProperty: () => undefined,
    hasTag: (t: string) => tags.includes(t),
  };
}

const entityHit = (ball: unknown, source: unknown, target: unknown) => ({
  projectile: ball, source, dimension: hitDimension, location: hitAt, hitVector: { x: 0, y: 0, z: 1 },
  getEntityHit: () => ({ entity: target }),
});

test("acertou entidade que não é Pokémon: item cai (o Java deixa seguir e cai no bloco seguinte)", () => {
  drops.length = 0;
  const ball = makeBall();
  fire("projectileHitEntity", entityHit(ball, makePlayer("Survival"), entity(["mob", "pig"])));
  assert.equal(drops.length, 1);
  assert.equal(ball.killed, 1);
});

test("captura recusada (não selvagem / uncatchable): mensagem + item", () => {
  drops.length = 0;
  const player = makePlayer("Survival");
  const owned = makeBall();
  fire("projectileHitEntity", entityHit(owned, player, entity(["pokemon"], { "cobblemon:wild": false })));
  assert.equal(drops.length, 1, "não selvagem → drop()");
  const uncatchable = makeBall();
  fire("projectileHitEntity", entityHit(uncatchable, player, entity(["pokemon"], { "cobblemon:wild": true }, ["uncatchable"])));
  assert.equal(drops.length, 2, "uncatchable → drop()");
  assert.equal(player.messages.length, 2, "uma mensagem por recusa");
  assert.equal(owned.killed + uncatchable.killed, 2);
  const creative = makePlayer("Creative");
  const creativeBall = makeBall();
  fire("projectileHitEntity", entityHit(creativeBall, creative, entity(["pokemon"], { "cobblemon:wild": false })));
  assert.equal(drops.length, 2, "criativo: drop() não derruba item");
  assert.equal(creativeBall.killed, 1);
});

test("sem dono (jogador saiu): some sem item", () => {
  drops.length = 0;
  const ball = makeBall("cobblemon:great_ball", { player_id: "saiu" });
  fire("projectileHitEntity", entityHit(ball, undefined, entity(["pokemon"], { "cobblemon:wild": true })));
  assert.equal(drops.length, 0);
  assert.equal(ball.killed, 1);
});

test("a bola arremessada expira em 600 ticks se não capturou (sem item)", () => {
  timeouts.length = 0;
  drops.length = 0;
  const flying = makeBall();
  fire("entitySpawn", { entity: flying });
  const expiry = timeouts.find(t => t.ticks === BALL_MAX_FLIGHT_TICKS);
  assert.ok(expiry, "agendou a expiração");
  expiry!.fn();
  assert.equal(flying.killed, 1);
  assert.equal(drops.length, 0);
  const capturing = makeBall();
  fire("entitySpawn", { entity: capturing });
  capturing.props.activated = true;
  timeouts.at(-1)!.fn();
  assert.equal(capturing.killed, 0, "em captura não expira");
});

console.log(`cliente-teste3: ${passed} ok`);
