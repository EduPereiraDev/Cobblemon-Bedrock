// Frente ball-hit: acerto da Poké Ball como no Java (caixa do Pokémon × escala efetiva, inflada em 0,3; segmento do
// tick anterior + o que a bola vai percorrer, cortado no bloco). docs/pendencias/ball-hit.md.
import assert from "node:assert/strict";
import {
  JAVA_HIT_MARGIN, boxFromAABB, firstBallHit, inflateBox, pathBounds, scaleBoxFromFeet, segmentBoxEntry,
} from "../scripts/catching/BallHitTest";
import { configureBallFlight, tickFlights, trackBall, trackedBallCount } from "../scripts/catching/BallFlight";
import { getAllPokeBalls, overhandPitch, projectilePower } from "../scripts/catching/PokeBalls";
import { overhandDirection, throwVelocity } from "../scripts/catching/ThrowBall";
import { BATTLE_CLONE_TAG } from "../scripts/Pokemon";
import { readFileSync } from "node:fs";
import { NPC_MODEL_TAG } from "../scripts/npc/PokemonModel";

type V = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): V => ({ x, y, z });
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const unit = { min: v(0, 0, 0), max: v(1, 1, 1) };

// ------------------------------------------------------------------ segmento × AABB
{
  assert.equal(segmentBoxEntry(v(-1, 0.5, 0.5), v(2, 0.5, 0.5), unit), 1 / 3, "atravessa em X: entra a 1/3");
  assert.equal(segmentBoxEntry(v(0.5, 0.5, 0.5), v(3, 0.5, 0.5), unit), 0, "começa dentro: t = 0");
  assert.equal(segmentBoxEntry(v(-1, 2, 0.5), v(2, 2, 0.5), unit), undefined, "passa por cima");
  assert.equal(segmentBoxEntry(v(-2, 0.5, 0.5), v(-0.5, 0.5, 0.5), unit), undefined, "para antes da caixa");
  assert.equal(segmentBoxEntry(v(2, 0.5, 0.5), v(-1, 0.5, 0.5), unit), 1 / 3, "sentido contrário");
  assert.equal(segmentBoxEntry(v(-1, -1, -1), v(2, 2, 2), unit), 1 / 3, "diagonal pelo canto");
  assert.equal(segmentBoxEntry(v(-1, 1, 0.5), v(0, 1, 0.5), unit), 1, "encosta na aresta no fim do trecho");
  assert.equal(segmentBoxEntry(v(0.5, 5, 0.5), v(0.5, -5, 0.5), unit), 0.4, "queda vertical (voador embaixo)");
  assert.equal(segmentBoxEntry(v(0.5, 0.5, 0.5), v(0.5, 0.5, 0.5), unit), 0, "ponto dentro");
  assert.equal(segmentBoxEntry(v(3, 3, 3), v(3, 3, 3), unit), undefined, "ponto fora");
  // Tangente a uma face inteira (componente zero no eixo e fora da placa).
  assert.equal(segmentBoxEntry(v(-1, 1.0001, 0.5), v(2, 1.0001, 0.5), unit), undefined, "rente por fora");
}

// ------------------------------------------------------------------ caixas
{
  const b = boxFromAABB({ center: v(10, 64.5, -3), extent: v(0.25, 0.5, -0.25) });
  assert.deepEqual(b, { min: v(9.75, 64, -3.25), max: v(10.25, 65, -2.75) }, "getAABB (centro + meia-extensão; extensão sempre positiva)");
  const inf = inflateBox(b, JAVA_HIT_MARGIN);
  assert.ok(near(inf.min.x, 9.45) && near(inf.max.y, 65.3) && near(inf.min.y, 63.7), "infla 0,3 em cada lado");
  assert.equal(JAVA_HIT_MARGIN, 0.3, "ProjectileUtil.getEntityHitResult: margem 0,3F");

  // Escala efetiva (filhote × intrínseca): base e centro fixos, largura/altura multiplicadas.
  const s = scaleBoxFromFeet({ min: v(-0.5, 64, -0.5), max: v(0.5, 66, 0.5) }, 0.9);
  assert.ok(near(s.min.x, -0.45) && near(s.max.z, 0.45) && near(s.min.y, 64) && near(s.max.y, 65.8), "×0,9 a partir dos pés");
  const same = { min: v(0, 0, 0), max: v(1, 1, 1) };
  assert.equal(scaleBoxFromFeet(same, undefined), same, "sem escala: caixa do Bedrock");
  assert.equal(scaleBoxFromFeet(same, 0), same, "escala 0 (inválida): caixa do Bedrock");
  assert.equal(scaleBoxFromFeet(same, Number.NaN), same, "NaN: caixa do Bedrock");

  const bounds = pathBounds([v(0, 0, 0), v(2, 0, 0), v(2, 2, 0)]);
  assert.deepEqual(bounds.center, v(1, 1, 0));
  assert.ok(near(bounds.radius, Math.SQRT2), "raio cobre o caminho todo");
}

// ------------------------------------------------------------------ escolha do alvo (como o Java)
{
  // Joltik do Java: hitbox 0,6 × baseScale 0,4 = 0,24 × 0,24 → com a margem, 0,84 de lado.
  const joltik = { entity: "joltik", box: { min: v(-0.12, 64, 4.88), max: v(0.12, 64.24, 5.12) } };
  // A bola passa 0,26 acima e 0,28 ao lado do corpo: sem a margem erraria, com a margem acerta.
  const path = [v(0.4, 64.5, 0), v(0.4, 64.5, 5), v(0.4, 64.5, 6.25)];
  assert.equal(firstBallHit(path, [joltik], 0), undefined, "sem margem (Bedrock): passa raspando e erra");
  const hit = firstBallHit(path, [joltik]);
  assert.equal(hit?.entity, "joltik", "com a margem do Java: acerta");
  assert.equal(hit?.segment, 0);
  assert.ok(hit && near(hit.point.z, 4.58), "ponto de entrada na face inflada");
  assert.equal(firstBallHit([v(0.5, 64.1, 0), v(0.5, 64.1, 8)], [joltik]), undefined, "0,38 ao lado do corpo (> 0,3): erra também no Java");

  // Dois no caminho: vence o mais perto do início; no mesmo tick, o do primeiro trecho vence.
  const a = { entity: "a", box: { min: v(-0.5, 64, 3), max: v(0.5, 65, 4) } };
  const b = { entity: "b", box: { min: v(-0.5, 64, 6), max: v(0.5, 65, 7) } };
  assert.equal(firstBallHit([v(0, 64.5, 0), v(0, 64.5, 10)], [b, a])?.entity, "a", "o mais próximo do início");
  const second = firstBallHit([v(0, 64.5, 0), v(0, 64.5, 1), v(0, 64.5, 10)], [b, a]);
  assert.equal(second?.entity, "a");
  assert.equal(second?.segment, 1, "achado no trecho à frente");
  assert.equal(firstBallHit([v(0, 64.5, 0), v(0, 64.5, 1)], []), undefined, "sem candidatos");
}

// ------------------------------------------------------------------ acompanhamento por tick (BallFlight)
{
  interface FakeEntity {
    id: string; isValid: boolean; location: V; velocity?: V; tags: string[]; aabb?: { center: V; extent: V };
    scale?: number; health?: number; vehicle?: FakeEntity; owner?: FakeEntity;
  }
  const hits: { ball: string; target: string; forward: boolean; point: V }[] = [];
  const resolved = new Set<string>();
  let blockAt: V | undefined;
  let pokemon: FakeEntity[] = [];
  const dimension = {
    getEntities: (q: { families?: string[] }) => (q.families?.includes("pokemon") ? pokemon : []).map(wrap),
    getBlockFromRay: (from: V, dir: V, o: { maxDistance: number }) => {
      if (!blockAt) return undefined;
      const d = (blockAt.z - from.z) / (dir.z || 1e-9);
      if (d < 0 || d > o.maxDistance) return undefined;
      return { block: { location: v(Math.floor(blockAt.x), Math.floor(blockAt.y), Math.floor(blockAt.z)) }, faceLocation: v(blockAt.x - Math.floor(blockAt.x), blockAt.y - Math.floor(blockAt.y), 0) };
    },
  };
  const cache = new Map<string, any>();
  function wrap(e: FakeEntity): any {
    if (!cache.has(e.id)) cache.set(e.id, {
      get id() { return e.id; }, get isValid() { return e.isValid; }, get location() { return e.location; }, dimension,
      getVelocity: () => e.velocity ?? v(0, 0, 0),
      hasTag: (t: string) => e.tags.includes(t),
      getAABB: () => e.aabb,
      getProperty: (p: string) => (p === "cobblemon:scale_modifier" ? e.scale : undefined),
      getComponent: (c: string) => c === "minecraft:health" ? (e.health === undefined ? undefined : { currentValue: e.health })
        : c === "minecraft:riding" ? (e.vehicle ? { entityRidingOn: wrap(e.vehicle) } : undefined)
        : c === "minecraft:projectile" ? { owner: e.owner ? wrap(e.owner) : undefined } : undefined,
    });
    return cache.get(e.id);
  }
  configureBallFlight(
    (ball, target, point, _velocity, forward) => { hits.push({ ball: ball.id, target: target.id, forward, point }); resolved.add(ball.id); },
    (ball) => resolved.has(ball.id),
  );
  const mon = (id: string, x: number, y: number, z: number, w: number, h: number, extra: Partial<FakeEntity> = {}): FakeEntity =>
    ({ id, isValid: true, location: v(x, y, z), tags: [], aabb: { center: v(x, y + h / 2, z), extent: v(w / 2, h / 2, w / 2) }, health: 20, ...extra });
  const player: FakeEntity = { id: "player", isValid: true, location: v(0, 64, 0), tags: [] };

  // Bola a 1,25/tick em +Z na altura 64,5; Joltik (0,24) a 5 blocos, a linha passa 0,18 ao lado e 0,26 acima do corpo.
  const ball: FakeEntity = { id: "b1", isValid: true, location: v(0.3, 64.5, 0), velocity: v(0, 0, 1.25), tags: [], owner: player };
  pokemon = [mon("joltik", 0, 64, 5, 0.24, 0.24)];
  trackBall(wrap(ball));
  assert.equal(trackedBallCount(), 1);
  for (let i = 0; i < 6 && !hits.length; i++) {
    tickFlights();
    ball.location = v(ball.location.x, ball.location.y, ball.location.z + 1.25);
  }
  assert.equal(hits.length, 1, "acertou o Joltik pela margem do Java");
  assert.equal(hits[0].target, "joltik");
  assert.equal(hits[0].forward, true, "achado antes de a bola chegar (trecho à frente)");
  assert.equal(trackedBallCount(), 0, "depois do acerto a bola sai do acompanhamento");
  // Sem acerto duplo: a bola resolvida não é mais testada.
  trackBall(wrap(ball));
  tickFlights();
  assert.equal(hits.length, 1, "bola resolvida: sem segundo acerto");
  assert.equal(trackedBallCount(), 0);

  // Escala efetiva pequena (filhote 0,9 num Pokémon de 1 bloco): a caixa encolhe a partir dos pés.
  hits.length = 0; resolved.clear();
  const b2: FakeEntity = { id: "b2", isValid: true, location: v(0.74, 64.5, 0), velocity: v(0, 0, 1), tags: [], owner: player };
  pokemon = [mon("baby", 0, 64, 4, 1, 1, { scale: 0.9 })];
  trackBall(wrap(b2));
  for (let i = 0; i < 6; i++) { tickFlights(); b2.location = v(b2.location.x, b2.location.y, b2.location.z + 1); }
  assert.equal(hits.length, 1, "0,74 do centro: dentro de 0,45 + 0,3");
  hits.length = 0; resolved.clear();
  const b3: FakeEntity = { id: "b3", isValid: true, location: v(0.78, 64.5, 0), velocity: v(0, 0, 1), tags: [], owner: player };
  trackBall(wrap(b3));
  for (let i = 0; i < 6; i++) { tickFlights(); b3.location = v(b3.location.x, b3.location.y, b3.location.z + 1); }
  assert.equal(hits.length, 0, "0,78 do centro: fora (com escala 1 acertaria)");

  // Bloco entre a bola e o Pokémon no trecho à frente: o bloco vem primeiro (o nativo derruba o item).
  hits.length = 0; resolved.clear();
  const b4: FakeEntity = { id: "b4", isValid: true, location: v(0, 64.5, 2.5), velocity: v(0, 0, 1.5), tags: [], owner: player };
  pokemon = [mon("behind_wall", 0, 64, 4, 1, 1)];
  blockAt = v(0.5, 64.5, 3);
  trackBall(wrap(b4));
  tickFlights();
  assert.equal(hits.length, 0, "parede antes do Pokémon: sem acerto");
  blockAt = undefined;
  flushFlights();

  // Fora do teste: montaria/ombro de quem arremessou, clone de batalha, exibição de NPC, Pokémon sem vida.
  hits.length = 0; resolved.clear();
  const mount = mon("mount", 0, 64, 3, 1.5, 1.5);
  const riding: FakeEntity = { ...player, id: "rider", vehicle: mount };
  const shoulder = mon("shoulder", 0, 64, 3, 0.5, 0.5, { vehicle: riding });
  const clone = mon("clone", 0, 64, 3, 1, 1, { tags: [BATTLE_CLONE_TAG] });
  const npc = mon("npc", 0, 64, 3, 1, 1, { tags: [NPC_MODEL_TAG] });
  const fainted = mon("fainted", 0, 64, 3, 1, 1, { health: 0 });
  for (const target of [mount, shoulder, clone, npc, fainted]) {
    pokemon = [target];
    const b: FakeEntity = { id: `x_${target.id}`, isValid: true, location: v(0, 64.5, 0), velocity: v(0, 0, 1.25), tags: [], owner: riding };
    trackBall(wrap(b));
    for (let i = 0; i < 5; i++) { tickFlights(); b.location = v(0, 64.5, b.location.z + 1.25); }
    flushFlights();
  }
  assert.deepEqual(hits, [], "montaria, ombro, clone, NPC e desmaiado não são atingidos");

  // Um Pokémon comum no mesmo lugar é atingido (controle do teste acima).
  pokemon = [mon("wild", 0, 64, 3, 1, 1)];
  const ok: FakeEntity = { id: "ok", isValid: true, location: v(0, 64.5, 0), velocity: v(0, 0, 1.25), tags: [], owner: riding };
  trackBall(wrap(ok));
  for (let i = 0; i < 5 && !hits.length; i++) { tickFlights(); ok.location = v(0, 64.5, ok.location.z + 1.25); }
  assert.equal(hits.length, 1);
  assert.equal(hits[0].target, "wild");

  // Bola que sumiu (bateu num bloco, virou item) sai do acompanhamento sem teste.
  hits.length = 0;
  const gone: FakeEntity = { id: "gone", isValid: false, location: v(0, 64.5, 2.9), velocity: v(0, 0, 1), tags: [] };
  trackBall(wrap(gone));
  tickFlights();
  assert.equal(trackedBallCount(), 0);
  assert.equal(hits.length, 0);

  /** Deixa o mapa vazio (as bolas de teste que não acertaram). */
  function flushFlights() {
    for (const e of cache.values()) resolved.add(e.id);
    tickFlights();
    resolved.clear();
  }
}

// ------------------------------------------------------------------ física do arremesso (Java)
{
  // PokeBallItem: xRot - overhandFactor; overhandFactor = xRot < 0 ? 5·cos(xRot) : 5.
  assert.equal(overhandPitch(0), -5, "olhando reto: 5° por cima");
  assert.equal(overhandPitch(30), 25, "olhando para baixo: 5°");
  assert.ok(near(overhandPitch(-60), -62.5), "olhando 60° para cima: 5·cos(60°) = 2,5°");
  assert.ok(near(overhandPitch(-90), -90), "olhando para cima: sem desvio");

  const flat = overhandDirection(v(0, 0, 1));
  assert.ok(near(flat.y, Math.sin(5 * Math.PI / 180)) && near(flat.z, Math.cos(5 * Math.PI / 180)) && near(flat.x, 0), "reto → +5°");
  const diag = overhandDirection(v(3, 0, 4));
  assert.ok(near(diag.x / diag.z, 3 / 4), "mantém o rumo horizontal");
  const down = overhandDirection(v(0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)));
  assert.ok(near(Math.asin(-down.y) * 180 / Math.PI, 25), "30° para baixo → 25°");
  assert.deepEqual(overhandDirection(v(0, 1, 0)), v(0, 1, 0), "vertical: sem rumo, fica");
  const vel = throwVelocity(overhandDirection(v(0, 0, 1)), projectilePower(getAllPokeBalls().find((b) => b.name === "poke_ball")!));
  assert.ok(near(Math.hypot(vel.x, vel.y, vel.z), 1.25), "Poké Ball: 1,25 bloco/tick (throwPower)");

  // As 49 entidades de bola (BP à mão) com a física do ThrowableProjectile e a potência = throwPower do Java.
  const dir = "behavior_packs/CobblemonBedrock/entities/pokeballs";
  let checked = 0;
  for (const ball of getAllPokeBalls()) {
    const text = readFileSync(`${dir}/${ball.name}.json`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const entity = JSON.parse(text)["minecraft:entity"];
    // Classe de arremessável do vanilla: sem ela o ator genérico anda de novo pela velocidade a cada tick.
    assert.equal(entity.description.runtime_identifier, "minecraft:snowball", `${ball.name}: runtime_identifier`);
    assert.ok("minecraft:physics" in entity.components, `${ball.name}: physics como o vanilla`);
    const projectile = entity.components["minecraft:projectile"];
    assert.equal(projectile.power, ball.throwPower, `${ball.name}: power = throwPower`);
    assert.equal(projectile.power, projectilePower(ball), `${ball.name}: igual ao arremesso por script`);
    assert.equal(projectile.gravity, 0.03, `${ball.name}: gravidade do ThrowableProjectile`);
    assert.equal(projectile.inertia, 0.99, `${ball.name}: retenção no ar do Java`);
    assert.equal(projectile.angle_offset, -5, `${ball.name}: 5° por cima`);
    assert.equal(projectile.liquid_inertia, ball.waterDragValue, `${ball.name}: arrasto na água (waterDragValue)`);
    checked++;
  }
  assert.equal(checked, 49);
}

console.log("ball-hit: ok");
