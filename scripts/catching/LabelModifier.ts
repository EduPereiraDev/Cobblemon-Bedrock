import { Player } from "@minecraft/server";
import { Behavior, CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
import { PokemonData } from "../Pokemon";

/** LabelModifier.kt: vale se o Pokémon tem (matching) ou não tem (!matching) todos os rótulos. */
export class LabelModifier extends CatchRateModifier {
  labels: string[]
  constructor(
    private multiplier: number,
    private matching: boolean,
    ...labels: string[]
  ) {
    super()
    this.labels = labels;
  }
  value(thrower: Player, pokemon: PokemonData) {
    return this.multiplier
  }
  behavior(thrower: Player, pokemon: PokemonData): Behavior {
    return BehaviorMutators.MULTIPLY;
  }
  isValid(thrower: Player, pokemon: PokemonData): boolean {
    const has = pokemon.hasLabels(...this.labels);
    return this.matching ? has : !has;
  }
}
