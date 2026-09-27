import { Player } from "@minecraft/server";
import { PokemonData } from "../Pokemon";

/**
 * Port de `api/pokeball/catching/CatchRateModifier.kt` (Cobblemon 1.8.2).
 *
 * Importante: o CobblemonCaptureCalculator NÃO chama `modifyCatchRate`; ele usa
 * `behavior(...)(taxa, isValid ? value : 1)`. `modifyCatchRate` existe para compatibilidade da API.
 */
export abstract class CatchRateModifier {
  constructor() { }
  /** Captura garantida (Master Ball / Ancient Origin Ball). */
  isGuaranteed(): boolean {
    return false;
  }
  /** Nome antigo (com erro de digitação) mantido para código que ainda lê o campo. */
  get isGarunteed(): boolean {
    return this.isGuaranteed();
  }
  /** Valor do modificador (ex.: o multiplicador). */
  abstract value(thrower: Player, pokemon: PokemonData): number;
  /** Operação aplicada com o valor. */
  abstract behavior(thrower: Player, pokemon: PokemonData): Behavior;
  /** Se o modificador vale neste caso. */
  isValid(thrower: Player, pokemon: PokemonData): boolean {
    return true;
  }
  /** Aplica o modificador a uma taxa (mesma regra do MultiplierModifier.kt). */
  modifyCatchRate(currentCatchRate: number, thrower: Player, pokemon: PokemonData): number {
    if (!this.isValid(thrower, pokemon))
      return currentCatchRate;
    return this.behavior(thrower, pokemon)(currentCatchRate, this.value(thrower, pokemon));
  }
}

export type Behavior = (input: number, value: number) => number;

/** CatchRateModifier.Behavior: as contas são em Float (32 bits) como no Kotlin. */
export const BehaviorMutators = {
  ADD: ((input, value) => Math.fround(input + value)) as Behavior,
  SUBTRACT: ((input, value) => Math.fround(input - value)) as Behavior,
  MULTIPLY: ((input, value) => Math.fround(input * value)) as Behavior,
  DIVIDE: ((input, value) => Math.fround(input / value)) as Behavior,
};
