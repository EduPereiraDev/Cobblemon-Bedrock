import { Player } from "@minecraft/server";
import { Behavior, CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
import { PokemonData } from "../Pokemon";

/** GuaranteedModifier.kt (Master Ball, Ancient Origin Ball). */
export class GuaranteedModifier extends CatchRateModifier {
  constructor() { super() }
  isGuaranteed() {
    return true;
  }
  value(thrower: Player, pokemon: PokemonData) {
    return 255;
  }
  behavior(thrower: Player, pokemon: PokemonData): Behavior {
    return BehaviorMutators.MULTIPLY;
  }
}

/** Nome antigo mantido por compatibilidade. */
export const GarunteedModifier = GuaranteedModifier;
