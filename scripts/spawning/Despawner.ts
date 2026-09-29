/**
 * Despawn por idade × distância (CobblemonAgingDespawner.kt + PokemonEntity.checkDespawn).
 *
 * - Só Pokémon selvagens (propriedade `cobblemon:wild`), fora de batalha/ocupados, que não estão
 *   montados em algo e que não seguram item (no Cobblemon, item na mão torna a entidade persistente).
 * - Jogador mais perto < despawnerNearDistance: fica.
 * - Idade > despawnerMaxAgeTicks ou jogador mais perto > despawnerFarDistance: some.
 * - Entre as duas distâncias: some se idade > (1 − razão da distância) × (maxAge − minAge)
 *   (fórmula exata do Cobblemon, sem somar minAge).
 * - Idade < despawnerMinAgeTicks: nunca.
 *
 * Custo: uma consulta filtrada por dimensão a cada DESPAWN_INTERVAL_TICKS e no máximo
 * DESPAWN_BATCH entidades avaliadas por rodada (rodízio).
 */
import type { Entity, Vector3 } from "@minecraft/server";
import { getHeldItemOnEntity } from "../pokemon/HeldItemStore";

export interface DespawnSettings {
  despawnerNearDistance: number;
  despawnerFarDistance: number;
  despawnerMinAgeTicks: number;
  despawnerMaxAgeTicks: number;
}

/** Idade (ticks) e distância até o jogador mais perto → deve sumir? */
export function shouldDespawn(ageTicks: number, closestPlayerDistance: number, s: DespawnSettings): boolean {
  if (ageTicks < s.despawnerMinAgeTicks) return false;
  if (closestPlayerDistance < s.despawnerNearDistance) return false;
  if (ageTicks > s.despawnerMaxAgeTicks || closestPlayerDistance > s.despawnerFarDistance) return true;
  const nearToFar = s.despawnerFarDistance - s.despawnerNearDistance;
  const youngToOld = s.despawnerMaxAgeTicks - s.despawnerMinAgeTicks;
  const distanceRatio = nearToFar > 0 ? (closestPlayerDistance - s.despawnerNearDistance) / nearToFar : 1;
  const maximumAge = (1 - distanceRatio) * youngToOld;
  return ageTicks > maximumAge;
}

/** Dynamic property com o tick absoluto do mundo em que o Pokémon apareceu. */
export const SPAWN_TIME_PROPERTY = "cobblemon:spawn_time";
/** Dynamic property que outras frentes podem ligar para impedir o despawn (pasto, ombro, NPC...). */
export const PERSISTENT_PROPERTY = "cobblemon:persistent";
/** Item na boca (raposa/Vulpix, SpeciesBehaviours.MOUTH_PROPERTY): o Pokémon carrega um item e não pode sumir. */
export const MOUTH_ITEM_PROPERTY = "cobblemon:mouth_item";

/** O mínimo de Entity que o despawner usa (facilita testes com entidades falsas). */
export type DespawnEntity = Pick<Entity, "isValid" | "location" | "getProperty" | "getDynamicProperty" | "setDynamicProperty" | "getComponent">;

export type DespawnVerdict = "despawn" | "keep" | "skip";

function distanceSq(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Ocupado demais para sumir: batalha, captura, montado, persistente ou com item. */
export function isDespawnExempt(entity: DespawnEntity): boolean {
  if (entity.getProperty("cobblemon:wild") !== true) return true;
  if (entity.getProperty("cobblemon:in_battle") === true) return true;
  if (entity.getProperty("cobblemon:busy") === true) return true;
  if (entity.getDynamicProperty("in_battle") !== undefined) return true;
  if (entity.getDynamicProperty(PERSISTENT_PROPERTY) === true) return true;
  // Item na boca conta como item segurado (sumir apagaria o item do jogador).
  const mouth = entity.getDynamicProperty(MOUTH_ITEM_PROPERTY);
  if (typeof mouth === "string" && mouth) return true;
  try {
    // Passageiro de algo (isPassenger) — o componente "riding" só existe em quem está montado.
    if (entity.getComponent("riding")) return true;
    // isPersistenceRequired: canDropHeldItem && heldItem não vazio (item segurado nos dados; pokemon/HeldItemStore).
    if (getHeldItemOnEntity(entity) !== undefined) return true;
  }
  catch { /* entidade sem componentes: segue */ }
  return false;
}

/**
 * Decide o destino de uma entidade. `players` = posições dos jogadores NA MESMA dimensão.
 * Entidades sem hora de spawn recebem `now` (passam a envelhecer a partir de agora).
 */
export function evaluateDespawn(entity: DespawnEntity, players: readonly Vector3[], now: number, s: DespawnSettings): DespawnVerdict {
  if (!entity.isValid) return "skip";
  if (isDespawnExempt(entity)) return "skip";
  let spawnTime = entity.getDynamicProperty(SPAWN_TIME_PROPERTY);
  if (typeof spawnTime !== "number" || spawnTime > now) {
    entity.setDynamicProperty(SPAWN_TIME_PROPERTY, now);
    spawnTime = now;
  }
  const age = now - spawnTime;
  let closest = Number.MAX_VALUE;
  for (const p of players) closest = Math.min(closest, distanceSq(p, entity.location));
  return shouldDespawn(age, Math.sqrt(closest), s) ? "despawn" : "keep";
}
