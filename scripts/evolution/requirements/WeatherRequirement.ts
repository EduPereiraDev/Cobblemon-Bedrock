import { Entity, WeatherType, world } from "@minecraft/server";
import { getWeather } from "../../utils";
import { PokemonData } from "../../Pokemon";
import { EvoRequirement } from "../../speciesData";
import { toID } from "../../utils";
import { EvolutionRequirement } from "../EvolutionRequirement";
import EntityQueryRequirement from "../EntityQueryRequirement";

export default class WeatherRequirement extends EntityQueryRequirement {
  variant = "weather";
  constructor(
    public isRaining: boolean | undefined = undefined,
    public isThundering: boolean | undefined = undefined
  ) { super() }
  queryCheck(pokemon: PokemonData, entity: Entity): boolean {
    let currentWeather = getWeather(entity.dimension);
    if (this.isThundering && currentWeather == WeatherType.Thunder)
      return true;
    if (this.isRaining && (currentWeather == WeatherType.Rain || currentWeather == WeatherType.Thunder))
      return true;
    return false;
  }
  static getFromSerialized(requirement: EvoRequirement): WeatherRequirement {
    return new WeatherRequirement(requirement.isRaining, requirement.isThundering);
  }
}