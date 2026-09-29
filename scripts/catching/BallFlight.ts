/**
 * Frente ball-hit: acerto por proximidade da Poké Ball arremessada (teste do Java refeito por script; ver BallHitTest.ts).
 *
 * Cada bola em voo é acompanhada tick a tick. O caminho testado é o trecho já percorrido desde o tick anterior e o
 * trecho que ela vai percorrer agora (`posição → posição + velocidade`, cortado no primeiro bloco, como o
 * `ProjectileUtil.getHitResultOnMoveVector` do Java). Um Pokémon cuja caixa do Java (inflada em 0,3) cruza esse
 * caminho dispara o mesmo fluxo do acerto nativo (`onHit`). O acerto nativo do `minecraft:projectile` continua
 * valendo; o primeiro que chegar marca a bola (`activated`) e o outro é ignorado, então não há acerto duplo.
 *
 * Fora do teste (Java `canHitEntity`): entidades que não são Pokémon (o jogador que arremessou, outros mobs: ficam com
 * o acerto nativo), a montaria/ombro de quem arremessou (`isPassengerOfSameVehicle`), clones de batalha, exibições de
 * NPC e Pokémon sem vida. Pokémon de batalha de outro jogador É atingido, como no Java: o fluxo recusa ("in_battle")
 * e a bola cai como item.
 */
import { Dimension, Entity, Vector3, system } from "@minecraft/server";
import { BATTLE_CLONE_TAG } from "../Pokemon";
import { NPC_MODEL_TAG } from "../npc/PokemonModel";
import { Box, HitCandidate, boxFromAABB, firstBallHit, pathBounds, scaleBoxFromFeet } from "./BallHitTest";

/** Maior distância dos pés de um Pokémon a um canto da sua caixa (Wailord Alfa ≈ 8,7) + a margem, com folga. */
const MAX_POKEMON_REACH = 11;
/** EmptyPokeBallEntity.tick: 600 ticks de voo e a bola some; depois disso não há o que acompanhar. */
const MAX_TRACKED_TICKS = 600;

interface Flight {
  ball: Entity;
  last: Vector3;
  ticks: number;
}

/** Acerto encontrado: `forward` = no trecho que a bola ainda ia percorrer (ela está antes do alvo). */
export type ProximityHitHandler = (ball: Entity, target: Entity, point: Vector3, velocity: Vector3, forward: boolean) => void;

const flights = new Map<string, Flight>();
let loop: number | undefined;
let handler: ProximityHitHandler | undefined;
/** Diz se a bola já foi resolvida (acerto, bloco, item): então para de ser acompanhada. */
let isResolved: (ball: Entity) => boolean = () => false;

export function configureBallFlight(onHit: ProximityHitHandler, resolved: (ball: Entity) => boolean) {
  handler = onHit;
  isResolved = resolved;
}

/** Começa a acompanhar uma bola recém-arremessada (idempotente). */
export function trackBall(ball: Entity) {
  let id: string, location: Vector3;
  try { id = ball.id; location = ball.location; }
  catch { return; }
  if (!flights.has(id)) flights.set(id, { ball, last: location, ticks: 0 });
  if (loop === undefined) loop = system.runInterval(tickFlights, 1);
}

/** Bolas acompanhadas agora (diagnóstico/testes). */
export function trackedBallCount(): number {
  return flights.size;
}

/** Um tick de todas as bolas acompanhadas (o `runInterval` chama; exposto para os testes). */
export function tickFlights() {
  for (const [id, flight] of flights) {
    let keep = false;
    try { keep = tickFlight(flight); }
    catch (e) { console.warn(`Poké Bola: teste de acerto falhou: ${e}`); }
    if (!keep) flights.delete(id);
  }
  if (flights.size === 0 && loop !== undefined) {
    system.clearRun(loop);
    loop = undefined;
  }
}

/** Um tick de uma bola; devolve se ela continua em voo. */
function tickFlight(flight: Flight): boolean {
  const ball = flight.ball;
  if (!ball.isValid || isResolved(ball)) return false;
  if (++flight.ticks > MAX_TRACKED_TICKS) return false;
  const here = ball.location;
  const velocity = ball.getVelocity();
  const dimension = ball.dimension;
  const ahead = clipAtBlock(dimension, here, velocity);
  const path = [flight.last, here, ahead];
  flight.last = here;
  const bounds = pathBounds(path);
  const candidates = pokemonNear(dimension, bounds.center, bounds.radius + MAX_POKEMON_REACH, ball);
  const hit = firstBallHit(path, candidates);
  if (!hit || !handler) return true;
  handler(ball, hit.entity, hit.point, velocity, hit.segment === 1);
  return false;
}

/** Fim do trecho à frente: `from + velocidade`, ou o ponto em que ele bate no primeiro bloco sólido. */
function clipAtBlock(dimension: Dimension, from: Vector3, velocity: Vector3): Vector3 {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const end = { x: from.x + velocity.x, y: from.y + velocity.y, z: from.z + velocity.z };
  if (speed < 1e-6) return end;
  try {
    const direction = { x: velocity.x / speed, y: velocity.y / speed, z: velocity.z / speed };
    const block = dimension.getBlockFromRay(from, direction, { maxDistance: speed, includeLiquidBlocks: false, includePassableBlocks: false });
    if (block) {
      const at = block.block.location;
      return { x: at.x + block.faceLocation.x, y: at.y + block.faceLocation.y, z: at.z + block.faceLocation.z };
    }
  }
  catch { }
  return end;
}

/** Veículo mais de baixo de uma entidade (ela mesma se não monta nada). */
function rootVehicle(entity: Entity | undefined): Entity | undefined {
  let current = entity;
  for (let i = 0; i < 4 && current; i++) {
    const vehicle = current.getComponent("minecraft:riding")?.entityRidingOn;
    if (!vehicle) break;
    current = vehicle;
  }
  return current;
}

function ownerOf(ball: Entity): Entity | undefined {
  try { return ball.getComponent("minecraft:projectile")?.owner; }
  catch { return undefined; }
}

/** Pokémon que a bola pode atingir perto do caminho, com a caixa do Java. */
function pokemonNear(dimension: Dimension, center: Vector3, radius: number, ball: Entity): HitCandidate<Entity>[] {
  const out: HitCandidate<Entity>[] = [];
  const entities = dimension.getEntities({ location: center, maxDistance: radius, families: ["pokemon"] });
  if (!entities.length) return out;
  const ownerRoot = rootVehicle(ownerOf(ball));
  for (const entity of entities) {
    try {
      if (!entity.isValid || entity.hasTag(BATTLE_CLONE_TAG) || entity.hasTag(NPC_MODEL_TAG)) continue;
      const health = entity.getComponent("minecraft:health");
      if (health && health.currentValue <= 0) continue;
      // Java canHitEntity: nada que esteja no mesmo veículo de quem arremessou (a montaria, o Pokémon no ombro).
      if (ownerRoot && rootVehicle(entity)?.id === ownerRoot.id) continue;
      out.push({ entity, box: javaBox(entity) });
    }
    catch { }
  }
  return out;
}

/** Caixa do Java: a do Bedrock (hitbox × baseScale do grupo de tamanho) × escala efetiva (`cobblemon:scale_modifier`). */
function javaBox(entity: Entity): Box {
  const box = boxFromAABB(entity.getAABB());
  let scale: number | undefined;
  try {
    const value = entity.getProperty("cobblemon:scale_modifier");
    if (typeof value === "number") scale = value;
  }
  catch { }
  return scaleBoxFromFeet(box, scale);
}
