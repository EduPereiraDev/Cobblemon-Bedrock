import { EvolutionEntry } from "../../speciesData";
import { Evolution, PassiveEvolution } from "../Evolution";
import { LevelUpEvolution } from "./LevelUpEvolution";
import { ItemInteractionEvolution } from "./ItemInteractionEvolution";
import { TradeEvolution } from "./TradeEvolution";
import { BlockClickEvolution } from "./BlockClickEvolution";
import { PokemonProperties } from "../../PokemonProperties";
import type { DropTableData } from "../../pokemon/Drops";

const evolutionVariants: Record<string, (EvolutionEntry) => Evolution> = {
  "passive": PassiveEvolution.getFromSerializied,
  "level_up": LevelUpEvolution.getFromSerializied,
  "item_interact": ItemInteractionEvolution.getFromSerializied,
  "trade": TradeEvolution.getFromSerializied,
  "block_click": BlockClickEvolution.getFromSerializied,
}

export function initializeEvolution(evolution: EvolutionEntry) {
  let constructor = evolutionVariants[evolution.variant];
  if (constructor != undefined) {
    const built = constructor(evolution);
    // Campos comuns a todas as variantes (Evolution.shedder / Evolution.drops).
    if (built && evolution.shedder) built.shedder = PokemonProperties.parse(evolution.shedder);
    if (built && evolution.drops?.entries?.length) built.drops = evolution.drops as DropTableData;
    return built;
  }
  console.warn(`Could not get a valid evolution type constructor for evolution ${evolution.variant}!`);
  return undefined;
}

export function initializeEvolutions(requirements: EvolutionEntry[] = []): Evolution[] {
  return requirements
    .map(x => initializeEvolution(x))
    .filter(x => !(!x));
}