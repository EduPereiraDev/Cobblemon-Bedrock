import { Entity, Player } from "@minecraft/server";
import { Behavior, CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
import { PokemonData } from "../Pokemon";

/** Entidade já conhecida de um Pokémon durante a captura (evita a busca por tag em todas as dimensões). */
const knownEntities = new WeakMap<PokemonData, Entity>();

/** Associa os dados do alvo à entidade atingida pela bola. */
export function bindCaptureEntity(pokemon: PokemonData, entity: Entity) {
  knownEntities.set(pokemon, entity);
}

/** Entidade do Pokémon (`pokemon.entity` do Kotlin). */
export function getPokemonEntity(pokemon: PokemonData): Entity | undefined {
  const known = knownEntities.get(pokemon);
  if (known?.isValid) return known;
  return pokemon.tryGetPokemonOut();
}

/**
 * WorldStateModifier.kt: calculado a partir da entidade do Pokémon no mundo (vale 1 se ela não existir).
 * O calculador recebe também os dados do Pokémon (no Kotlin vêm por `entity.pokemon`).
 */
export class WorldStateModifier extends CatchRateModifier {
  constructor(
    private calculator: (thrower: Player, pokemonEntity: Entity, pokemon: PokemonData) => number
  ) { super() }
  value(thrower: Player, pokemon: PokemonData) {
    const pokemonEntity = getPokemonEntity(pokemon);
    if (pokemonEntity === undefined || !pokemonEntity.isValid)
      return 1;
    return this.calculator(thrower, pokemonEntity, pokemon);
  }
  behavior(thrower: Player, pokemon: PokemonData): Behavior {
    return BehaviorMutators.MULTIPLY;
  }
}
