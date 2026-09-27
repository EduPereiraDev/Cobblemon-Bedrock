/**
 * Acesso aos dados de entidade gerados pelo importador (generated/scripts/entityData.ts): tamanhos por
 * forma/Alfa, formas que vão no ombro, montaria por forma e a tabela de pokemon_interactions.
 */
import { ENTITY_INFO, INTERACTIONS } from "../../generated/scripts/entityData";
import type { EntityInfo, InteractionSet, RideInfo, RideStyle } from "../../generated/scripts/entityData";

export type { EntityInfo, InteractionSet, RideInfo, RideStyle };
export type { Interaction, InteractionEffect, RideStyleInfo } from "../../generated/scripts/entityData";

/** "cobblemon:pikachu" | "pikachu" → dados da espécie. */
export function getEntityInfo(speciesOrType: string): EntityInfo | undefined {
  return ENTITY_INFO[speciesOrType.replace(/^cobblemon:/, "")];
}

/** Id de espécie a partir do typeId da entidade (cobblemon:<id>). */
export function speciesIdOfType(typeId: string): string {
  return typeId.replace(/^cobblemon:/, "");
}

/** Montaria da forma (FormData.riding: forma sem campo próprio herda a da espécie; `null` = sem montaria). */
export function getRideInfo(speciesId: string, formName = ""): RideInfo | undefined {
  const info = getEntityInfo(speciesId);
  if (!info) return undefined;
  const own = formName ? info.ride[formName] : undefined;
  if (own === null) return undefined;
  return own ?? info.ride[""] ?? undefined;
}

/** A forma pode ir no ombro (FormData.shoulderMountable). */
export function isShoulderMountable(speciesId: string, formName = ""): boolean {
  return getEntityInfo(speciesId)?.shoulder.includes(formName) ?? false;
}

/** Índice do grupo cobblemon:size_<n> para a forma (e Alfa). */
export function getSizeIndex(speciesId: string, formName = "", alpha = false): number {
  const info = getEntityInfo(speciesId);
  if (!info) return 0;
  const table = alpha ? info.sizeAlpha : info.sizeForms;
  return table[formName] ?? table[""] ?? 0;
}

/** Conjuntos de interação (data/cobblemon/pokemon_interactions). */
export function getInteractionSets(): readonly InteractionSet[] {
  return INTERACTIONS;
}
