import { ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { ItemUtils } from "../utils";

/**
 * `scriptevent cobblemon:interact_evolution <id da evolução>` num Pokémon: dispara a evolução (da forma ativa)
 * e gasta o item da mão do dono só se ela realmente começou.
 */
export default function handleInteractEvolution(arg: ScriptEventCommandMessageAfterEvent) {
  if (!arg.sourceEntity)
    return;

  let evolutionID = arg.message.trim();
  let pokemonData = PokemonData.tryGetFromEntity(arg.sourceEntity);
  if (!pokemonData)
    return;
  const evolved = pokemonData.getEvolutions()
    .filter(x => x.id == evolutionID)
    .some(x => x.evolve(pokemonData!));
  const owner = pokemonData.tryGetOwner();
  if (evolved && owner)
    ItemUtils.decrementItemInHand(owner);
}
