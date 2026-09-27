import { ContextEvolution } from "../Evolution";
import { PokemonData } from "../../Pokemon";
import { EvolutionEntry } from "../../speciesData";
import { PokemonProperties } from "../../PokemonProperties";
import { initializeRequirements } from "../requirements";

/**
 * BlockClickEvolution (variante `block_click` do Cobblemon 1.8.2): clicar com o botão direito num bloco testa as
 * evoluções deste tipo dos Pokémon do time (PlatformEvents.RIGHT_CLICK_BLOCK). `requiredContext` é um id de bloco
 * (`minecraft:dirt`) ou uma tag (`#minecraft:logs`). Tags de bloco do Java não existem no Bedrock e o importador não
 * exporta tabela delas, então só ids exatos casam. Nenhuma espécie do 1.8.2 usa esta variante.
 */
export class BlockClickEvolution extends ContextEvolution<string, string> {
  testContext(pokemon: PokemonData, blockId: string): boolean {
    return blockClickMatches(this.requiredContext, blockId);
  }
  static getFromSerializied(evolution: EvolutionEntry): BlockClickEvolution {
    return new BlockClickEvolution(
      typeof evolution.requiredContext === "string" ? evolution.requiredContext : "minecraft:dirt",
      evolution.id,
      PokemonProperties.parse(evolution.result),
      evolution.optional,
      evolution.consumeHeldItem,
      initializeRequirements(evolution.requirements),
      evolution.learnableMoves,
    );
  }
}

/** RegistryLikeCondition<Block>.fits: id exato (namespace padrão minecraft); tags não são resolvidas. */
export function blockClickMatches(requiredContext: string, blockId: string): boolean {
  if (!requiredContext || requiredContext.startsWith("#")) return false;
  const full = requiredContext.includes(":") ? requiredContext : `minecraft:${requiredContext}`;
  return full === blockId;
}
