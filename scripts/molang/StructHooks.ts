/**
 * Ganchos entre os structs MoLang "leves" e os "pesados".
 *
 * `PokemonStruct.ts` é importado pelos requisitos de evolução (GenericRequirements), que são carregados no meio do
 * `import` de scripts/evolution/Evolution.ts. Se ele importasse o struct de jogador/entidade (que puxam batalha,
 * NPC, trocas...), o bundle avaliaria `TradeEvolution extends ContextEvolution` antes de `ContextEvolution` existir.
 * Pelo mesmo motivo os requisitos (`chance`) pegam o q.pokemon por aqui: importar PokemonStruct.ts de lá puxaria
 * PokemonProperties → Pokemon → evolução → requisitos antes de `ChanceRequirement` existir.
 * `PokemonStruct.ts` e `PlayerFunctions.ts` preenchem os ganchos ao carregar.
 *
 * Este módulo não importa nada em tempo de execução, então está sempre avaliado antes de quem o usa.
 */
import type { Entity, Player } from "@minecraft/server";
import type { MoStruct } from "../npc/molang/MoLang";
import type { PokemonData } from "../Pokemon";

export interface StructHooks {
  /** createPokemonStruct (q.pokemon); usado pelos requisitos de evolução sem importar PokemonStruct.ts. */
  pokemon?: (pokemon: PokemonData) => MoStruct;
  /** createPlayerStruct (q.player). */
  player?: (player: Player) => MoStruct;
  /** createEntityStruct (funções de entidade genéricas). */
  entity?: (entity: Entity) => MoStruct;
}

export const structHooks: StructHooks = {};
