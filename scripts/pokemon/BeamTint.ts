/**
 * Tinta vermelha do Pokémon durante o feixe de captura/recolha (Cobblemon 1.8.2: PokemonRenderer.renderTransition,
 * beamMode 3). O servidor só liga/desliga a propriedade sincronizada `cobblemon:beam_tint`; o cliente (pre_animation +
 * `overlay_color` gerados por tools/importer/entities.ts) espera BEAM_EXTEND_TIME (0,2 s) e escurece verde e azul até
 * 0,4 em 0,24 s, como o Java. Ligar no mesmo tick em que o feixe começa (o encolhimento também espera 0,2 s).
 */
import { Entity } from "@minecraft/server";

export const BEAM_TINT_PROPERTY = "cobblemon:beam_tint";

/** Liga/desliga a tinta; ignora entidades inválidas ou sem a propriedade (NPCs, entidades antigas). */
export function setBeamTint(entity: Entity | undefined, on: boolean): boolean {
  if (!entity) return false;
  try {
    if (!entity.isValid || entity.getProperty(BEAM_TINT_PROPERTY) === undefined) return false;
    // Sempre grava: o setProperty só vale no fim do tick, e o getProperty do mesmo tick ainda devolve o valor antigo
    // (comparar antes deixaria "liga e desliga no mesmo tick" com a tinta ligada; conferido no BDS).
    entity.setProperty(BEAM_TINT_PROPERTY, on);
    return true;
  }
  catch {
    return false;
  }
}
