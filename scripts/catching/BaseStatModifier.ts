import { Player } from "@minecraft/server";
import { Behavior, CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
import { PokemonData } from "../Pokemon";
import type { StatSet } from "../speciesData";

/** BaseStatModifier.kt: vale se o atributo base da forma ativa passa no comparador (Fast Ball). */
export class BaseStatModifier extends CatchRateModifier {
  constructor(
    public stat: keyof StatSet,
    public comparator: (value: number) => boolean,
    public multiplier: number
  ) { super() }
  value(thrower: Player, pokemon: PokemonData) {
    return this.multiplier;
  }
  behavior(thrower: Player, pokemon: PokemonData): Behavior {
    return BehaviorMutators.MULTIPLY;
  }
  isValid(thrower: Player, pokemon: PokemonData): boolean {
    const value = pokemon.getBaseStats()?.[this.stat];
    return typeof value === "number" && this.comparator(value);
  }
}
