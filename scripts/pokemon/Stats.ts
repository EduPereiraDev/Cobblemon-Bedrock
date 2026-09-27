// Atributos permanentes (IV/EV) com as regras do Cobblemon: K/pokemon/EVs.kt, K/pokemon/IVs.kt,
// K/api/pokemon/stats/EvCalculator.kt e K/item/interactive/HyperTrainingItem.kt.
import type { StatsTable } from "../showdown";

/** Chave de atributo no formato do Showdown (usado em PokemonData.evs/ivs). */
export type StatKey = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export const STAT_KEYS: readonly StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** Chave de atributo nos JSONs do Cobblemon (baseStats, evYield). */
export type CobblemonStatKey = "hp" | "attack" | "defence" | "special_attack" | "special_defence" | "speed";

/** Cobblemon → Showdown. Aceita também a grafia americana ("defense") por segurança. */
export const COBBLEMON_TO_SHOWDOWN_STAT: Record<string, StatKey> = {
  hp: "hp", attack: "atk", defence: "def", defense: "def", special_attack: "spa", special_defence: "spd",
  special_defense: "spd", speed: "spe",
  atk: "atk", def: "def", spa: "spa", spd: "spd", spe: "spe",
};

/** EVs.MAX_STAT_VALUE / EVs.MAX_TOTAL_VALUE */
export const MAX_EV_PER_STAT = 252;
export const MAX_EV_TOTAL = 510;
/** IVs.MAX_VALUE */
export const MAX_IV = 31;

export type EvYield = Partial<Record<StatKey, number>>;

/** Converte chave do Cobblemon ou do Showdown para StatKey (undefined se desconhecida). */
export function toStatKey(stat: string): StatKey | undefined {
  return COBBLEMON_TO_SHOWDOWN_STAT[stat.toLowerCase()];
}

/**
 * Converte o evYield de uma espécie (chaves do Cobblemon: hp/attack/defence/special_attack/
 * special_defence/speed) para as chaves do Showdown usadas por PokemonData.addEvs.
 */
export function evYieldToStats(speciesEvYield: Partial<Record<string, number>> | undefined): EvYield {
  const output: EvYield = {};
  if (!speciesEvYield) return output;
  for (const [key, value] of Object.entries(speciesEvYield)) {
    const stat = toStatKey(key);
    if (!stat || typeof value !== "number" || !Number.isFinite(value)) continue;
    output[stat] = (output[stat] ?? 0) + value;
  }
  return output;
}

export function emptyStats(): StatsTable {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

/**
 * EVs.performAdd: soma `value` ao atributo respeitando 252 por atributo e 510 no total.
 * Valores negativos removem (até zerar). Retorna quanto foi efetivamente aplicado.
 */
export function addEvToTable(evs: StatsTable, stat: StatKey, value: number): number {
  value = Math.trunc(value);
  const currentTotal = STAT_KEYS.reduce((sum, key) => sum + (evs[key] ?? 0), 0);
  if (currentTotal >= MAX_EV_TOTAL && value > 0) return 0;
  const currentStat = evs[stat] ?? 0;
  const possibleForStat = MAX_EV_PER_STAT - currentStat;
  const possibleForTotal = MAX_EV_TOTAL - currentTotal;
  const coerced = Math.max(-currentStat, Math.min(value, Math.min(possibleForStat, possibleForTotal)));
  const newValue = currentStat + coerced;
  if (newValue === currentStat) return 0;
  evs[stat] = newValue;
  return coerced;
}

/** Items "power" (Generation8EvCalculator): +8 em todos os EVs do atributo correspondente. */
const POWER_ITEMS: Record<string, StatKey> = {
  poweranklet: "spe", powerband: "spd", powerbelt: "def", powerbracer: "atk", powerlens: "spa", powerweight: "hp",
};

/**
 * Generation8EvCalculator: EVs ganhos por `heldItemId` (id Showdown, ex.: "powerweight") ao derrotar
 * um Pokémon com `opponentEvYield` (já no formato do Showdown, via PokemonData.getEvYield()).
 * Como no Cobblemon, o bônus do item é somado mesmo quando o yield do atributo é 0.
 */
export function calculateEvYield(opponentEvYield: EvYield, heldItemId?: string): EvYield {
  const boostedStat = heldItemId ? POWER_ITEMS[heldItemId.replace(/[^a-z0-9]/g, "")] : undefined;
  const output: EvYield = {};
  for (const stat of STAT_KEYS) {
    const value = (opponentEvYield[stat] ?? 0) + (stat === boostedStat ? 8 : 0);
    if (value !== 0) output[stat] = value;
  }
  return output;
}
