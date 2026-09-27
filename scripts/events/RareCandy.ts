import { ScriptEventCommandMessageAfterEvent } from "@minecraft/server";
import { PokemonData } from "../Pokemon";

/** `scriptevent cobblemon:gain_level` num Pokémon: sobe um nível (EXP até o próximo nível da forma ativa). */
export default function handleGainLevelEvent(arg: ScriptEventCommandMessageAfterEvent) {
  if (!arg.sourceEntity?.getComponent("type_family")?.hasTypeFamily("pokemon"))
    return;
  let pokemon = PokemonData.getFromEntity(arg.sourceEntity);
  const result = pokemon.gainExp(pokemon.getExperienceToNextLevel(), pokemon.tryGetOwner());
  // Evolução não opcional já salvou uma cópia nova (Evolution.forceEvolve): não sobrescrever.
  if (result.evolutions.some(id => !pokemon.readyEvolutions.includes(id)))
    return;
  pokemon.tryUpdatePokemonOut();
  pokemon.tryUpdatePokemonInTeam();
}
