/**
 * Pokédex por jogador (frente "captura"). API para as outras frentes:
 *   markSeen(player, species | PokemonData, aspects?)   → PokedexManager.encounter
 *   markCaught(player, species | PokemonData, aspects?) → PokedexManager.obtain
 *   hasCaught / hasSeen / getSpeciesKnowledge / getCaughtCount
 *   getDexCounts(player, dexId?) → { seen, caught, total }
 *   openPokedex(player, species?)
 * Detalhes e gatilhos em docs/pendencias/captura.md.
 */
import { Player, system, world } from "@minecraft/server";
import { PARTY_SIZE, getSafeTeam } from "../pokemonStorage";
import { toID } from "../showdown";
import { DexProgress, batchPokedex, dexInfoFromPokemon, forgetPokedex, getPokedex, onPokedexChanged } from "./PokedexStorage";
import { recordCollectedAspects } from "./Progress";
import { DexCounts, computeDexCounts } from "./DexData";
import { bindPokedexItem } from "./PokedexItem";
import { registerPokedexCommand } from "./PokedexCommand";

export {
  markSeen, markCaught, hasCaught, hasSeen, getSpeciesKnowledge, getCaughtCount, getPokedex, batchPokedex, onPokedexChanged,
  dexInfoFromPokemon, dexInfoFromSpecies, DexProgress,
} from "./PokedexStorage";
export type { DexPokemonInfo, DexPropertyHolder } from "./PokedexStorage";
export { setDexData, getDexes, getDex, getNationalEntry } from "./DexData";
export type { DexCounts, DexEntry, DexDefinition } from "./DexData";
export { openPokedex } from "./PokedexUI";
// Frente extras-final: "Progresso Cobblemon" (ganchos para evolução, troca e fósseis; ver docs/pendencias/extras-final.md).
export { recordCapture, recordEvolution, recordTrade, recordResurrection, recordFlag, getProgress } from "./Progress";
export { POKEDEX_ITEM_IDS, isPokedexItem, usePokedex } from "./PokedexItem";

/** Contagens de visto/capturado: globais (por espécie) ou de uma Pokédex ("kanto", "national"...). */
export function getDexCounts(player: Player, dexId?: string): DexCounts {
  return computeDexCounts(getPokedex(player), dexId);
}

/** Pokémon guardado (JSON do time/PC) → dados mínimos da Pokédex. */
function infoFromStoredJson(json: unknown) {
  if (!json || typeof json !== "object") return undefined;
  const data = json as { species?: string; aspects?: string[]; gender?: string; shiny?: boolean; level?: number };
  if (!data.species) return undefined;
  return dexInfoFromPokemon({ species: toID(data.species), aspects: data.aspects ?? [], gender: data.gender, shiny: data.shiny, level: data.level });
}

/**
 * PokedexManager.scheduleFullSyncFromStores: no login, registra como obtidos todos os Pokémon do time e do PC,
 * 50 por tick (runJob), gravando uma vez no fim.
 */
export function syncPokedexFromStores(player: Player) {
  function* job(): Generator<void, void, void> {
    const infos: ReturnType<typeof infoFromStoredJson>[] = [];
    for (const pokemon of getSafeTeam(player).slice(0, PARTY_SIZE)) if (pokemon) infos.push(infoFromStoredJson(pokemon));
    yield;
    if (!player.isValid) return;
    const slotKeys = player.getDynamicPropertyIds().filter(id => /^pc:\d+:\d+$/.test(id));
    let processed = 0;
    for (const key of slotKeys) {
      if (!player.isValid) return;
      const raw = player.getDynamicProperty(key);
      if (typeof raw === "string") {
        try { infos.push(infoFromStoredJson(JSON.parse(raw))); } catch { }
      }
      if (++processed % 50 === 0) yield;
    }
    if (!player.isValid) return;
    try {
      batchPokedex(player, records => {
        for (const info of infos) if (info) records.obtain(info);
      });
    }
    catch (e) { console.warn(`Não foi possível salvar a Pokédex: ${e}`); }
  }
  try { system.runJob(job()); }
  catch (e) { console.warn(`Sincronização da Pokédex falhou: ${e}`); }
}

let bound = false;

/** Liga item, comando, sincronização no login e limpeza do cache. Chamado por bindCatchEvents(). */
export function bindPokedex() {
  if (bound) return;
  bound = true;
  bindPokedexItem();
  // aspectsCollected do "Progresso Cobblemon": Pokémon obtido por qualquer caminho que mude a Pokédex.
  onPokedexChanged((holder, info, knowledge) => {
    if (knowledge === DexProgress.OWNED) recordCollectedAspects(holder, info);
  });
  try {
    system.beforeEvents.startup.subscribe(event => registerPokedexCommand(event));
  }
  catch (e) { console.warn(`Não foi possível agendar o registro do comando da Pokédex: ${e}`); }
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (initialSpawn) system.runTimeout(() => { if (player.isValid) syncPokedexFromStores(player); }, 40);
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => forgetPokedex(playerId));
}
