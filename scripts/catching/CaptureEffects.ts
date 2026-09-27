/**
 * Efeitos de captura, port de `api/pokeball/catching/effects/*` (Cobblemon 1.8.2).
 * Rodam depois de `caughtBall` ser definido e antes do Pokémon entrar no time.
 */
import { Player } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { healPokemon } from "../pokemonStorage";

export interface CaptureEffect {
  apply(thrower: Player | undefined, pokemon: PokemonData): void;
}

/**
 * Luxury Ball: multiplica a amizade "conquistada". O efeito em si não faz nada na captura; o ganho em dobro
 * é aplicado por `PokemonData.addFriendship` lendo `pokemon.pokeball` (FRIENDSHIP_BALL_MULTIPLIERS).
 */
export class FriendshipEarningBoostEffect implements CaptureEffect {
  constructor(public multiplier: number) { }
  apply() { }
}

export const CaptureEffects = {
  /** Heal Ball: `pokemon.heal()` (HP cheio, PP cheio, sem status). */
  FULL_RESTORE: { apply: (_thrower, pokemon) => healPokemon(pokemon) } as CaptureEffect,
  /** Friend Ball: amizade = valor. */
  friendshipSetter(value: number): CaptureEffect {
    return { apply: (_thrower, pokemon) => { pokemon.setFriendship(value); } };
  },
};

/** Aspectos removidos pelo callback `pokemon_captured/remove_aspects.molang`. */
export const ASPECTS_REMOVED_ON_CAPTURE = ["honey_drenched", "poke_snack_crumbed"];
