import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";
import type { StatsTable } from "../showdown";

/**
 * Pontes para a API de PokemonData da frente "dados" (addEvs, addFriendship, getEvYield). Se algum
 * método ainda não existir (árvore em integração), usa uma implementação local equivalente.
 */

type StatKey = keyof StatsTable;
const STATS: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
const COBBLEMON_STATS: Record<string, StatKey> = {
  hp: "hp", attack: "atk", defence: "def", defense: "def", special_attack: "spa", special_defence: "spd", special_defense: "spd", speed: "spe",
  atk: "atk", def: "def", spa: "spa", spd: "spd", spe: "spe",
};
const POWER_ITEMS: Record<string, StatKey> = {
  poweranklet: "spe", powerband: "spd", powerbelt: "def", powerbracer: "atk", powerlens: "spa", powerweight: "hp",
};

/** Muda a amizade (positivo = incrementFriendship, negativo = decrementFriendship). */
export function changeFriendship(pokemon: PokemonData, amount: number) {
  const api = pokemon as unknown as { addFriendship?: (amount: number) => boolean };
  if (typeof api.addFriendship === "function") {
    api.addFriendship(amount);
    return;
  }
  const record = pokemon as unknown as { friendship?: number; happiness: number };
  const max = (getConfig() as unknown as { maxPokemonFriendship?: number; maxPokemonFriendShip?: number }).maxPokemonFriendship
    ?? (getConfig() as unknown as { maxPokemonFriendShip?: number }).maxPokemonFriendShip ?? 255;
  const current = record.friendship ?? record.happiness ?? 0;
  const value = Math.max(0, Math.min(max, current + Math.trunc(amount)));
  if ("friendship" in record) record.friendship = value;
  else record.happiness = value;
}

/** EVs que `defeated` dá a `winner` (Generation8EvCalculator: yield da forma + 8 do item "power"). */
export function evYieldFor(winner: PokemonData, defeated: PokemonData): Partial<StatsTable> {
  const api = defeated as unknown as { getEvYield?: () => Partial<StatsTable> };
  const base: Partial<StatsTable> = typeof api.getEvYield === "function" ? api.getEvYield() : convertEvYield(defeated.getSpeciesData().evYield as unknown as Record<string, number>);
  const heldItem = (winner.item || "").replace(/[^a-z0-9]/g, "");
  const boosted = POWER_ITEMS[heldItem];
  const output: Partial<StatsTable> = {};
  for (const stat of STATS) {
    const value = (base[stat] ?? 0) + (stat === boosted ? 8 : 0);
    if (value) output[stat] = value;
  }
  return output;
}

function convertEvYield(evYield: Record<string, number> | undefined): Partial<StatsTable> {
  const output: Partial<StatsTable> = {};
  for (const [key, value] of Object.entries(evYield ?? {})) {
    const stat = COBBLEMON_STATS[key.toLowerCase()];
    if (stat && typeof value === "number") output[stat] = (output[stat] ?? 0) + value;
  }
  return output;
}

/** Soma EVs respeitando 252 por atributo e 510 no total (EVs.add). */
export function addEvs(pokemon: PokemonData, evYield: Partial<StatsTable>) {
  const api = pokemon as unknown as { addEvs?: (evs: Partial<StatsTable>) => number };
  if (typeof api.addEvs === "function") {
    api.addEvs(evYield);
    return;
  }
  for (const stat of STATS) {
    const value = Math.trunc(evYield[stat] ?? 0);
    if (value <= 0) continue;
    const total = STATS.reduce((sum, key) => sum + (pokemon.evs[key] ?? 0), 0);
    const add = Math.min(value, 252 - (pokemon.evs[stat] ?? 0), 510 - total);
    if (add > 0) pokemon.evs[stat] = (pokemon.evs[stat] ?? 0) + add;
  }
}

/** Resultado de gainExp (AddExperienceResult); vazio se a versão de PokemonData não devolver nada. */
export interface ExperienceResult {
  oldLevel: number;
  newLevel: number;
  experienceAdded: number;
  newMoves: string[];
  addedMoves: string[];
}

export function gainExperience(pokemon: PokemonData, amount: number): ExperienceResult {
  const oldLevel = pokemon.level;
  const result = pokemon.gainExp(amount) as unknown as Partial<ExperienceResult> | undefined;
  return {
    oldLevel: result?.oldLevel ?? oldLevel,
    newLevel: result?.newLevel ?? pokemon.level,
    experienceAdded: result?.experienceAdded ?? amount,
    newMoves: result?.newMoves ?? [],
    addedMoves: result?.addedMoves ?? [],
  };
}
