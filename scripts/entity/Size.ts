/**
 * Caixa de colisão e escala por forma e Alfa (FormData.hitbox/baseScale, Pokemon.getAlphaScaleMultiplier).
 * O JSON da entidade tem um grupo `cobblemon:size_<n>` por combinação distinta; o evento de mesmo nome troca
 * o grupo. `minecraft:scale` não é gravável por script na API estável, por isso a troca é por evento.
 * Altura dos olhos (standing/swimming/flyingEyeHeight) não tem componente no Bedrock (fica a do motor).
 */
import { Entity } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { getSizeIndex, speciesIdOfType } from "./EntityData";
import { displayFormName } from "../pokemon/DisplayOverride";

const SIZE_PROPERTY = "cobblemon:size";

/**
 * Grupo de tamanho da forma ativa (e Alfa) do Pokémon. Frente msd-fase2: com forma de exibição na batalha (Mega,
 * Primal, Ultra: pokemon/DisplayOverride.ts), vale a forma mostrada; o laço de 1 s não desfaz o tamanho da Mega.
 */
export function sizeIndexFor(entityTypeId: string, data: Pick<PokemonData, "aspects" | "getFormData"> & Partial<Pick<PokemonData, "uuid" | "species">>): number {
  const alpha = data.aspects.includes("alpha");
  const shown = displayFormName(data);
  return getSizeIndex(speciesIdOfType(entityTypeId), shown ?? data.getFormData()?.name ?? "", alpha);
}

/** Aplica o tamanho se mudou. Retorna true se disparou o evento. */
export function applyEntitySize(entity: Entity, data: PokemonData): boolean {
  const index = sizeIndexFor(entity.typeId, data);
  if (entity.getDynamicProperty(SIZE_PROPERTY) === index) return false;
  try {
    entity.triggerEvent(`cobblemon:size_${index}`);
  }
  catch {
    return false;
  }
  entity.setDynamicProperty(SIZE_PROPERTY, index);
  return true;
}
