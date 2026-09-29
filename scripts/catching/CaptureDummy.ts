/**
 * Frente ball-hit, "afundando no chão (beta 7)" (docs/pendencias/ball-hit.md): no acerto que começa a captura, o
 * projétil arremessado vira a `cobblemon:<bola>_dummy` e toda a sequência roda nela.
 *
 * Desde a beta 7 as bolas arremessáveis têm `runtime_identifier: minecraft:snowball`. Esse ator aplica a gravidade do
 * `minecraft:projectile` sempre que o script para de teleportá-lo, e o `cobblemon:disable` tira o `minecraft:physics`
 * (sem colisão): do pouso em diante o servidor mandava a bola cair através do chão (medido no BDS: y 170 → 43 durante
 * as sacudidas, `set_entity_motion` y −0,2). A `_dummy` (a mesma do envio, SendOut.ts) não tem projétil nem física:
 * só se move por teleporte. O client entity dela é o da bola (mesma geometria, textura e animações); o evento
 * `cobblemon:capture` põe a escala 1,0 do projétil (a dummy do envio é 0,4).
 */
import { Entity, Vector3 } from "@minecraft/server";

/** Evento da `_dummy` que a deixa do tamanho do projétil (BP: grupo `cobblemon:capture`). */
export const CAPTURE_DUMMY_EVENT = "cobblemon:capture";

/** Id da dummy de um projétil de bola (`cobblemon:great_ball` → `cobblemon:great_ball_dummy`). */
export function captureDummyId(projectileTypeId: string): string {
  return projectileTypeId.endsWith("_dummy") ? projectileTypeId : `${projectileTypeId}_dummy`;
}

/** Propriedades dinâmicas da bola que passam para a dummy. */
const CARRIED_PROPERTIES = ["player_id", "activated"];

/**
 * Troca o projétil pela dummy na mesma posição e direção e remove o projétil (sem item: ele já está `activated` e
 * `resolved`, então nenhum handler de bloco/entidade/expiração o trata como bola que errou).
 * @param at Onde a bola parou (o acerto por proximidade pode tê-la teleportado neste tick); padrão: a posição dela.
 * @returns A dummy, ou o próprio projétil se não deu para criar a dummy (comportamento da beta 7).
 */
export function swapToCaptureDummy(projectile: Entity, at?: Vector3): Entity {
  let dummy: Entity;
  try {
    const location = at ?? projectile.location;
    let yaw: number | undefined;
    try { yaw = projectile.getRotation().y; } catch { }
    dummy = projectile.dimension.spawnEntity(captureDummyId(projectile.typeId), location,
      { initialRotation: yaw, spawnEvent: CAPTURE_DUMMY_EVENT });
  }
  catch (e) {
    console.warn(`Captura sem a dummy da bola (segue no projétil): ${e}`);
    return projectile;
  }
  for (const key of CARRIED_PROPERTIES) {
    try {
      const value = projectile.getDynamicProperty(key);
      if (value !== undefined) dummy.setDynamicProperty(key, value);
    }
    catch { }
  }
  try { projectile.setDynamicProperty("activated", true); } catch { }
  try { projectile.setDynamicProperty("resolved", true); } catch { }
  try { projectile.remove(); }
  catch {
    try { projectile.triggerEvent("cobblemon:instant_kill"); } catch { }
  }
  return dummy;
}
