import { WorldLoadAfterEvent, world } from "@minecraft/server";
import { removeStalePlatforms } from "./battle/Platform";

/** Basic cleanup script to run during world startup to clean up residual entities and such */
export default function WorldCleanup(arg: WorldLoadAfterEvent) {
  //Logic was moved from here
  // Balsas de batalha (cobblemon:battle_platform) gravadas por uma queda: nenhuma batalha existe ao carregar o mundo.
  try {
    const dimensions = ["overworld", "nether", "the_end"].map(id => world.getDimension(id));
    removeStalePlatforms(dimensions);
  }
  catch (e) { console.warn(`Limpeza das balsas de batalha: ${e}`); }
}