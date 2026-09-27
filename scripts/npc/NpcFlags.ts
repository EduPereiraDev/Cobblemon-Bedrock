/**
 * Frente dados-ia: `isMovable`, `isLeashable` e `allowProjectileHits` do NPC (NPCEntity: valor próprio da entidade
 * ou, sem ele, o da classe/preset; padrão true nos três).
 *
 * - isMovable → isPushable: grupos cobblemon:npc_pushable / cobblemon:npc_not_pushable (eventos
 *   cobblemon:npc_set_movable / cobblemon:npc_set_immovable).
 * - isLeashable → canBeLeashed: grupo cobblemon:npc_leashable (eventos cobblemon:npc_set_leashable / _unleashable).
 * - allowProjectileHits → canBeHitByProjectile: propriedade cobblemon:projectile_hits (o damage_sensor anula o dano
 *   de projétil com false; o projétil não atravessa a entidade como no Java).
 */

/** Dynamic properties do valor próprio do NPC (NPCEntity.isMovable/isLeashable/allowProjectileHits, nulos = classe). */
export const NPC_FLAG_PROPS = {
  movable: "npc:is_movable",
  leashable: "npc:is_leashable",
  projectileHits: "npc:allow_projectile_hits",
} as const;

export type NpcFlag = keyof typeof NPC_FLAG_PROPS;

export interface NpcFlagValues {
  movable: boolean;
  leashable: boolean;
  projectileHits: boolean;
}

/**
 * Último estado aplicado por evento (review-fixes): `applyNpcFlags` roda em todo onLoad/applyInvulnerability e
 * reacionar o grupo `cobblemon:npc_leashable` (readicionar `minecraft:leashable`) não pode acontecer à toa com o NPC
 * preso na guia. Só dispara o evento quando o valor muda.
 */
export const NPC_APPLIED_FLAG_PROPS = {
  movable: "npc:applied_movable",
  leashable: "npc:applied_leashable",
} as const;

/** Entidade mínima. */
interface FlagEntity {
  getDynamicProperty(id: string): unknown;
  setDynamicProperty(id: string, value?: boolean | number | string): void;
  getProperty(id: string): boolean | number | string | undefined;
  setProperty(id: string, value: boolean | number | string): void;
  triggerEvent(event: string): void;
  /** Para reconhecer a guia já presente (NPC salvo antes do estado aplicado existir). */
  getComponent?(id: string): unknown;
}

/** Classe (NPCClass) com os três campos. */
interface FlagClass {
  isMovable?: boolean;
  isLeashable?: boolean;
  allowProjectileHits?: boolean;
}

/** Valor efetivo: o do NPC, se gravado; senão o da classe; senão true (padrão do Cobblemon). */
export function effectiveNpcFlags(entity: Pick<FlagEntity, "getDynamicProperty">, npcClass: FlagClass): NpcFlagValues {
  const own = (flag: NpcFlag) => {
    const v = entity.getDynamicProperty(NPC_FLAG_PROPS[flag]);
    return typeof v === "boolean" ? v : undefined;
  };
  return {
    movable: own("movable") ?? npcClass.isMovable ?? true,
    leashable: own("leashable") ?? npcClass.isLeashable ?? true,
    projectileHits: own("projectileHits") ?? npcClass.allowProjectileHits ?? true,
  };
}

/** Estado já aplicado de um flag: o gravado; sem ele, a guia presente conta como "leashable" aplicado. */
function appliedFlag(entity: FlagEntity, flag: keyof typeof NPC_APPLIED_FLAG_PROPS): boolean | undefined {
  const stored = entity.getDynamicProperty(NPC_APPLIED_FLAG_PROPS[flag]);
  if (typeof stored === "boolean") return stored;
  if (flag === "leashable" && entity.getComponent) {
    try { return entity.getComponent("minecraft:leashable") ? true : undefined; }
    catch { }
  }
  return undefined;
}

/** Dispara o evento do flag só se o estado aplicado mudou; grava o novo estado. @returns true se disparou. */
function applyFlagEvent(entity: FlagEntity, flag: keyof typeof NPC_APPLIED_FLAG_PROPS, value: boolean, on: string, off: string): boolean {
  try {
    if (appliedFlag(entity, flag) === value) {
      if (entity.getDynamicProperty(NPC_APPLIED_FLAG_PROPS[flag]) !== value) entity.setDynamicProperty(NPC_APPLIED_FLAG_PROPS[flag], value);
      return false;
    }
    entity.triggerEvent(value ? on : off);
    entity.setDynamicProperty(NPC_APPLIED_FLAG_PROPS[flag], value);
    return true;
  }
  catch { return false; }
}

/** Aplica os três valores na entidade (eventos/propriedade), sem reaplicar o que já está no estado pedido. */
export function applyNpcFlags(entity: FlagEntity, flags: NpcFlagValues) {
  applyFlagEvent(entity, "movable", flags.movable, "cobblemon:npc_set_movable", "cobblemon:npc_set_immovable");
  applyFlagEvent(entity, "leashable", flags.leashable, "cobblemon:npc_set_leashable", "cobblemon:npc_set_unleashable");
  try {
    if (entity.getProperty("cobblemon:projectile_hits") !== undefined && entity.getProperty("cobblemon:projectile_hits") !== flags.projectileHits)
      entity.setProperty("cobblemon:projectile_hits", flags.projectileHits);
  }
  catch { }
}

/** set_movable / set_leashable / set_allow_projectile_hits do MoLang (NPCMoLangFunctions): grava o valor do NPC. */
export function setNpcFlag(entity: FlagEntity, flag: NpcFlag, value: boolean | undefined, npcClass: FlagClass) {
  entity.setDynamicProperty(NPC_FLAG_PROPS[flag], value);
  applyNpcFlags(entity, effectiveNpcFlags(entity, npcClass));
}
