/**
 * Frente visual-final (#144): quirk do Nosepass, port de `PointToSpawnTaskConfig` (tarefa `point_to_spawn` da
 * atividade `idle`, só no nosepass.json do Cobblemon 1.8.2).
 *
 * No Java, sem alvo de olhar nem de caminhada (parado, ocioso), o Nosepass olha para o centro do bloco do spawn do
 * mundo (`level.sharedSpawnPos`) na altura dos próprios olhos; como a espécie tem `canLook: false`, o corpo inteiro
 * gira. Aqui: a cada 10 ticks, cada Nosepass parado, fora de batalha, acordado, sem montar/ser montado e fora do
 * ombro vira para o spawn com `Entity.lookAt` (API estável). O spawn é o mesmo em todas as dimensões, como o
 * `sharedSpawnPos` das dimensões derivadas no Java.
 *
 * Único mecanismo do quirk (review-fixes): o giro por `setRotation` que existia em scripts/entity/SpeciesAi.ts (passada
 * de entidades de 1 s) brigava com este perto do spawn e foi removido; a lista de espécies vem do `SPECIES_AI` gerado
 * pelo importador (espécies com `pointToSpawn`).
 */
import { Entity, Vector3, system, world } from "@minecraft/server";
import { SPECIES_AI } from "../../generated/scripts/dadosIa";

/** Espécies com a tarefa `point_to_spawn` (SPECIES_AI gerado a partir do `ai` das espécies do 1.8.2). */
export const POINT_TO_SPAWN_SPECIES = Object.keys(SPECIES_AI).filter(id => SPECIES_AI[id]?.pointToSpawn === true).map(id => `cobblemon:${id}`);
/** LookControl.getYRotD: sem giro com o alvo a menos de 1e-5 bloco em X e Z (em cima do spawn). */
const MIN_LOOK_DELTA = 1e-5;
const PASS_TICKS = 10;
/** Velocidade horizontal (blocos/tick) abaixo da qual o Pokémon está parado (sem WALK_TARGET). */
const IDLE_SPEED = 0.02;

/** Estado da entidade que decide se a tarefa roda. */
export interface PointToSpawnState {
  inBattle: boolean;
  sleeping: boolean;
  busy: boolean;
  riding: boolean;
  onShoulder: boolean;
  /** Velocidade horizontal (blocos/tick). */
  speed: number;
}

/** A tarefa roda (atividade idle, sem caminhada). */
export function shouldPointToSpawn(state: PointToSpawnState): boolean {
  return !state.inBattle && !state.sleeping && !state.busy && !state.riding && !state.onShoulder && state.speed < IDLE_SPEED;
}

/** Ponto a olhar: centro do bloco do spawn (`Vec3.atCenterOf`) com Y = altura dos olhos da entidade. */
export function spawnLookTarget(spawn: Vector3, eyeY: number): Vector3 {
  return { x: Math.floor(spawn.x) + 0.5, y: eyeY, z: Math.floor(spawn.z) + 0.5 };
}

/** Alvo do olhar a partir de `location`; undefined em cima do spawn (sem direção, como o LookControl do Java). */
export function pointToSpawnTarget(location: Vector3, spawn: Vector3, eyeY: number): Vector3 | undefined {
  const target = spawnLookTarget(spawn, eyeY);
  if (Math.abs(target.x - location.x) <= MIN_LOOK_DELTA && Math.abs(target.z - location.z) <= MIN_LOOK_DELTA) return undefined;
  return target;
}

function property(entity: Entity, name: string): boolean {
  try { return entity.getProperty(name) === true; }
  catch { return false; }
}

function stateOf(entity: Entity): PointToSpawnState {
  let speed = 0;
  try {
    const v = entity.getVelocity();
    speed = Math.hypot(v.x, v.z);
  }
  catch { }
  let riding = false;
  try { riding = !!entity.getComponent("minecraft:riding")?.entityRidingOn || (entity.getComponent("minecraft:rideable")?.getRiders().length ?? 0) > 0; }
  catch { }
  let onShoulder = false;
  try { onShoulder = !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon_shoulder"); }
  catch { }
  return {
    inBattle: property(entity, "cobblemon:in_battle"),
    sleeping: property(entity, "cobblemon:sleeping"),
    busy: property(entity, "cobblemon:busy"),
    riding,
    onShoulder,
    speed,
  };
}

function pass() {
  let spawn: Vector3;
  try { spawn = world.getDefaultSpawnLocation(); }
  catch { return; }
  for (const id of ["overworld", "nether", "the_end"]) {
    let entities: Entity[];
    try { entities = POINT_TO_SPAWN_SPECIES.flatMap(type => world.getDimension(id).getEntities({ type })); }
    catch { continue; }
    for (const entity of entities) pointEntityToSpawn(entity, spawn);
  }
}

/** Uma passada para uma entidade: vira para o spawn com `lookAt` se a tarefa roda. @returns true se girou. */
export function pointEntityToSpawn(entity: Entity, spawn: Vector3): boolean {
  if (!shouldPointToSpawn(stateOf(entity))) return false;
  try {
    const target = pointToSpawnTarget(entity.location, spawn, entity.getHeadLocation().y);
    if (!target) return false;
    entity.lookAt(target);
    return true;
  }
  catch { return false; /* entidade saindo */ }
}

let started = false;

/** Liga o quirk (worldLoad). */
export function startPointToSpawn() {
  if (started) return;
  started = true;
  system.runInterval(() => {
    try { pass(); }
    catch (e) { console.warn(`Nosepass (point_to_spawn): ${e}`); }
  }, PASS_TICKS);
}
