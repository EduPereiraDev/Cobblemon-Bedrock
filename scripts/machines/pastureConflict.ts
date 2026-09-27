/**
 * Frente dados-ia: "ataca mobs hostis" do pasto pela IA da entidade (behaviours/attack_hostile_mobs.json,
 * AttackHostileMobsTask) em vez de impulso e dano por script.
 *
 * O importador gera em cada Pokémon o grupo `cobblemon:pasture_conflict` (behavior.nearest_attackable_target contra
 * monstros, fora creeper/slime/piglin, + behavior.melee_box_attack com o dano de `minecraft:attack`) e os eventos
 * `cobblemon:enable_pasture_conflict` / `cobblemon:disable_pasture_conflict`, que também gravam a propriedade
 * `cobblemon:pasture_conflict`. Como a IA do Bedrock não sabe da área do pasto (Tethering.canRoamTo), o script só
 * liga o grupo enquanto o monstro mais próximo do Pokémon (o alvo que a IA pegaria) está DENTRO da área, e desliga
 * quando não está (o alvo sai da área ou outro monstro fora dela fica mais perto).
 */
import { Entity, Vector3 } from "@minecraft/server";

export const PASTURE_CONFLICT_PROPERTY = "cobblemon:pasture_conflict";

/** Alcance do sensor NEAREST_VISIBLE_LIVING_ENTITIES do Minecraft (16 blocos). */
export const HOSTILE_SENSE_RANGE = 16;

/** Famílias que o AttackHostileMobsTask ignora: Creeper, Slime (e Magma Cube) e piglins. */
export const IGNORED_HOSTILE_FAMILIES = ["creeper", "slime", "magmacube", "piglin", "zombie_pigman"];

/** A entidade tem o grupo gerado (pacote atualizado). */
export function hasPastureConflictAi(entity: Entity): boolean {
  try { return entity.getProperty(PASTURE_CONFLICT_PROPERTY) !== undefined; }
  catch { return false; }
}

/** Liga/desliga o grupo de ataque se o estado mudou. @returns true se disparou evento. */
export function setPastureConflict(entity: Entity | undefined, enabled: boolean): boolean {
  if (!entity?.isValid || !hasPastureConflictAi(entity)) return false;
  try {
    if ((entity.getProperty(PASTURE_CONFLICT_PROPERTY) === true) === enabled) return false;
    // Em batalha a IA fica desligada (cobblemon:battle_start tira o grupo e zera a propriedade).
    if (enabled && entity.getProperty("cobblemon:in_battle") === true) return false;
    entity.triggerEvent(enabled ? "cobblemon:enable_pasture_conflict" : "cobblemon:disable_pasture_conflict");
    return true;
  }
  catch { return false; }
}

/** Monstro que o Pokémon do pasto atacaria (Enemy vivo, família monster, fora os ignorados), dentro da área. */
export function isValidPastureTarget(target: Entity, insideArea: (loc: Vector3) => boolean): boolean {
  try {
    if (!target.isValid) return false;
    const family = target.getComponent("minecraft:type_family");
    if (!family?.hasTypeFamily("monster")) return false;
    if (IGNORED_HOSTILE_FAMILIES.some(f => family.hasTypeFamily(f))) return false;
    return insideArea(target.location);
  }
  catch { return false; }
}

/**
 * Monstro mais próximo do Pokémon pelo mesmo critério do `nearest_attackable_target` do grupo (família monster, fora os
 * ignorados, até 16 blocos), sem olhar a área. É ele que a IA escolheria como alvo.
 */
export function nearestPastureHostile(entity: Entity): Entity | undefined {
  const candidates = entity.dimension.getEntities({
    location: entity.location, maxDistance: HOSTILE_SENSE_RANGE, families: ["monster"], excludeFamilies: IGNORED_HOSTILE_FAMILIES,
  });
  const origin = entity.location;
  let nearest: Entity | undefined;
  let best = Infinity;
  for (const candidate of candidates) {
    if (candidate.id === entity.id || !isValidPastureTarget(candidate, () => true)) continue;
    const { x, y, z } = candidate.location;
    const distance = (x - origin.x) ** 2 + (y - origin.y) ** 2 + (z - origin.z) ** 2;
    if (distance < best) {
      best = distance;
      nearest = candidate;
    }
  }
  return nearest;
}

/**
 * Um passe (20 ticks) do Pokémon com "ataca mobs hostis": liga a IA de ataque só se o monstro mais próximo dele (o que
 * o `nearest_attackable_target` escolheria) está DENTRO da área; com o mais próximo fora, desliga (review-fixes: antes
 * bastava existir algum monstro na área e a IA podia perseguir outro, mais perto, fora dela).
 * @returns true se a IA ficou (ou deveria ficar) ligada.
 */
export function updatePastureConflict(entity: Entity, insideArea: (loc: Vector3) => boolean): boolean {
  const nearest = nearestPastureHostile(entity);
  const enabled = !!nearest && isValidPastureTarget(nearest, insideArea);
  setPastureConflict(entity, enabled);
  return enabled;
}
