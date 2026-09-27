/**
 * Mobs vanilla que fogem de Pokémon (Cobblemon 1.8.2: `behaviour.entityInteract` da espécie/forma e os mixins
 * EntityCreeperMixin, EntitySkeletonMixin, EntityFoxMixin e PhantomSweepAttackGoalMixin).
 *
 * No Java, creeper/esqueletos/raposa ganham um AvoidEntityGoal contra Pokémon com `avoidedByX` e contra jogadores
 * com um desses Pokémon no ombro; o phantom desiste do ataque perto deles. No Bedrock, os JSON vanilla sobrescritos
 * (behavior_packs/CobblemonBedrock/entities/vanilla_overrides) têm `minecraft:behavior.avoid_mob_type` contra a
 * família `pokemon` com a tag abaixo. O Pokémon no ombro monta no jogador, então fugir dele é fugir do jogador.
 */

export type AvoidingMob = "creeper" | "skeleton" | "fox" | "phantom";
export const AVOIDING_MOBS: readonly AvoidingMob[] = ["creeper", "skeleton", "fox", "phantom"];

/** Tag de entidade lida pelos filtros dos JSON vanilla sobrescritos. */
export function avoidTag(mob: AvoidingMob): string {
  return `cobblemon_avoided_by_${mob}`;
}

const FLAG: Record<AvoidingMob, string> = {
  creeper: "avoidedByCreeper",
  skeleton: "avoidedBySkeleton",
  fox: "avoidedByFox",
  phantom: "avoidedByPhantom",
};

/**
 * Lê `entityInteract` de um `behaviour`. Como FormPokemonBehaviour.entityInteract (`_entityInteract ?: parent`),
 * o bloco da forma, se existir, substitui o da espécie inteiro (campos ausentes = false).
 */
export function avoidedBy(speciesBehaviour: unknown, formBehaviour?: unknown): AvoidingMob[] {
  const read = (behaviour: unknown): Record<string, unknown> | undefined => {
    const interact = (behaviour as { entityInteract?: unknown } | undefined)?.entityInteract;
    return interact && typeof interact === "object" ? interact as Record<string, unknown> : undefined;
  };
  const flags = read(formBehaviour) ?? read(speciesBehaviour) ?? {};
  return AVOIDING_MOBS.filter(mob => flags[FLAG[mob]] === true);
}

/** Entidade mínima (Entity do Minecraft). */
interface TaggedEntity {
  hasTag(tag: string): boolean;
  addTag(tag: string): boolean;
  removeTag(tag: string): boolean;
}

/** Deixa só as tags dos mobs que evitam este Pokémon. */
export function applyAvoidTags(entity: TaggedEntity, mobs: readonly AvoidingMob[]) {
  for (const mob of AVOIDING_MOBS) {
    const tag = avoidTag(mob);
    const wanted = mobs.includes(mob);
    try {
      if (wanted && !entity.hasTag(tag)) entity.addTag(tag);
      else if (!wanted && entity.hasTag(tag)) entity.removeTag(tag);
    }
    catch { }
  }
}
