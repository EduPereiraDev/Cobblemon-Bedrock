import { Player } from "@minecraft/server";
import { Behavior, CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
import { PokemonData } from "../Pokemon";

/** DynamicMultiplierModifier.kt: multiplicador calculado na hora, com condição. */
export class DynamicMultiplierModifier extends CatchRateModifier {
  constructor(
    private multiplier: (thrower: Player, pokemon: PokemonData) => number,
    private condition: (thrower: Player, pokemon: PokemonData) => boolean
  ) { super() }
  value(thrower: Player, pokemon: PokemonData) {
    return this.multiplier(thrower, pokemon)
  }
  behavior(thrower: Player, pokemon: PokemonData): Behavior {
    return BehaviorMutators.MULTIPLY;
  }
  isValid(thrower: Player, pokemon: PokemonData): boolean {
    return this.condition(thrower, pokemon);
  }
}
