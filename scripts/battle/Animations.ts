import { Entity } from "@minecraft/server";
import { POSER_ANIMATIONS } from "../../generated/scripts/variants";
import { Dex } from "../showdown";
import { toSpeciesId } from "../speciesData";
import type { PokemonData } from "../Pokemon";

/**
 * Animações de batalha. O Cobblemon usa timelines de `action_effects` (partículas, câmera, poses);
 * no Bedrock tocamos as animações nomeadas do poser da espécie (cry/physical/special/status/recoil/faint,
 * exportadas pelo importador em POSER_ANIMATIONS) e o som da espécie quando existir.
 */
export type PoserAnimation = "cry" | "physical" | "special" | "status" | "recoil" | "faint";

function animationFor(pokemon: PokemonData, key: PoserAnimation): string | undefined {
  return POSER_ANIMATIONS[toSpeciesId(pokemon.species)]?.[key];
}

/** Toca a animação do poser, se a espécie tiver. Retorna false se não havia animação. */
export function playPoserAnimation(entity: Entity | undefined, pokemon: PokemonData, key: PoserAnimation): boolean {
  if (!entity?.isValid) return false;
  const animation = animationFor(pokemon, key);
  if (!animation) return false;
  try {
    entity.playAnimation(animation);
    return true;
  }
  catch {
    return false;
  }
}

/** Grito ao entrar em campo: animação `cry` e o som `cobblemon.pokemon.<espécie>.cry`. */
export function playCry(entity: Entity | undefined, pokemon: PokemonData) {
  if (!entity?.isValid) return;
  playPoserAnimation(entity, pokemon, "cry");
  try {
    entity.dimension.playSound(`cobblemon.pokemon.${toSpeciesId(pokemon.species)}.cry`, entity.location);
  }
  catch { }
}

/** Pose do golpe pela categoria (físico/especial/status); sem animação da categoria, usa o grito. */
export function playMoveAnimation(entity: Entity | undefined, pokemon: PokemonData, moveId: string) {
  const move = Dex.moves.get(moveId);
  const key: PoserAnimation = move.category === "Physical" ? "physical" : move.category === "Special" ? "special" : "status";
  if (!playPoserAnimation(entity, pokemon, key)) playPoserAnimation(entity, pokemon, "cry");
}

export function playHurtAnimation(entity: Entity | undefined, pokemon: PokemonData) {
  playPoserAnimation(entity, pokemon, "recoil");
}

export function playFaintAnimation(entity: Entity | undefined, pokemon: PokemonData) {
  playPoserAnimation(entity, pokemon, "faint");
}
