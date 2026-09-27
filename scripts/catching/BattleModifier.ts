import { Player } from "@minecraft/server";
import { Behavior, CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
import { tryGetBattleFromEntity } from "../battle";
import { PokemonData } from "../Pokemon";

/**
 * BattleModifier.kt: calculado a partir dos Pokémon ativos do jogador na batalha em que ele participa.
 * Fora de batalha vale 1. `team` pode ter `null` (posição vazia), como os ActiveBattlePokemon sem Pokémon.
 */
export class BattleModifier extends CatchRateModifier {
  constructor(
    public calculator: (player: Player, team: (PokemonData | null)[], targetPokemon: PokemonData) => number
  ) { super() }
  value(thrower: Player, pokemon: PokemonData) {
    if (!thrower.isValid)
      return 1;
    const actor = tryGetBattleFromEntity(thrower)?.getActorFromID(thrower.id);
    if (actor === undefined)
      return 1;
    return this.calculator(thrower, actor.activePokemon.map(x => x?.data ?? null), pokemon);
  }
  behavior(thrower: Player, pokemon: PokemonData): Behavior {
    return BehaviorMutators.MULTIPLY;
  }
}
