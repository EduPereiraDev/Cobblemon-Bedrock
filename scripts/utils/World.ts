import { Dimension, Vector3, WeatherType, world } from "@minecraft/server";

/**
 * A API estável não expõe o clima atual (Dimension.getWeather é beta), então acompanhamos
 * pelo evento weatherChange. Até a primeira mudança observada, assume céu limpo.
 */
const weatherByDimension = new Map<string, WeatherType>();
world.afterEvents.weatherChange.subscribe(event => {
  weatherByDimension.set(event.dimension, event.newWeather);
});

export function getWeather(dimension: Dimension): WeatherType {
  return weatherByDimension.get(dimension.id) ?? WeatherType.Clear;
}

/** Verdadeiro se o bioma em `location` é um dos `biomeIds` (com ou sem o prefixo minecraft:). */
export function isInBiome(dimension: Dimension, location: Vector3, biomeIds: string[]): boolean {
  const id = dimension.getBiome(location).id;
  const plain = id.replace(/^minecraft:/, "");
  return biomeIds.some(biome => biome === id || biome.replace(/^minecraft:/, "") === plain);
}
