/**
 * Gatilho das evoluções `block_click` (Cobblemon.kt: PlatformEvents.RIGHT_CLICK_BLOCK → lockedEvolutions do time).
 * Como nenhuma espécie gerada usa a variante, a busca nos dados é feita uma vez e, sem uso, o clique não custa nada.
 */
import type { Player } from "@minecraft/server";
import { SPECIES } from "../../generated/scripts/species";
import { getSafeTeam } from "../pokemonStorage";
import { BlockClickEvolution } from "./variants/BlockClickEvolution";

let used: boolean | undefined;

/** Alguma espécie tem evolução `block_click` (procura o texto nos JSON das espécies, sem parsear). */
export function anySpeciesUsesBlockClick(): boolean {
  if (used === undefined) used = Object.values(SPECIES).some(json => json.includes("\"block_click\""));
  return used;
}

/** Clique direito num bloco: tenta as evoluções `block_click` de cada Pokémon do time. */
export function attemptBlockClickEvolutions(player: Player, blockId: string) {
  if (!anySpeciesUsesBlockClick()) return;
  for (const pokemon of getSafeTeam(player)) {
    if (!pokemon) continue;
    let evolutions;
    try { evolutions = pokemon.getEvolutions(); }
    catch { continue; }
    for (const evolution of evolutions)
      if (evolution instanceof BlockClickEvolution && evolution.attemptEvolution(pokemon, blockId)) break;
  }
}
