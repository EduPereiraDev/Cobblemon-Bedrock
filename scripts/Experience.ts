import { getConfig } from "./Config";
import type { PokemonData } from "./Pokemon";
import { AFFECTION_FRIENDSHIP } from "./pokemon/Friendship";

/** Divisão inteira do Kotlin (trunca em direção a zero). */
function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Reimplementação de CachedLevelThresholds (K/api/LevelCurve.kt): limiares de nível em cache.
 * O limite de nível é o do Cobblemon (1000); o teto de config.maxPokemonLevel é aplicado por quem chama
 * (PokemonData.gainExp / setLevel), como em Pokemon.addExperience.
 */
export class CachedLevelThreshold {
  savedThreshholds: number[] = []
  constructor(
    public getExperience: (level: number) => number,
    public levelLimit = 1000
  ) { }

  getLevel(experience: number): number {
    let level = 1;
    while (level <= this.savedThreshholds.length) {
      let threshold = this.savedThreshholds[level - 1];
      if (experience < threshold) {
        return level - 1;
      }
      level++;
    }
    while (level < this.levelLimit) {
      let threshold = this.getExperience(level);
      this.savedThreshholds.push(threshold);
      if (experience < threshold) {
        return level - 1;
      }
      level++;
    }
    return 1;
  }
}

/** K/api/pokemon/experience/ExperienceGroups.kt, com a aritmética inteira do Kotlin. */
export const ExperienceGroups: Record<string, CachedLevelThreshold> = {
  "erratic": new CachedLevelThreshold(level => {
    if (level == 1) return 0;
    const cube = level ** 3;
    if (level < 50) return idiv(cube * (100 - level), 50);
    if (level < 68) return idiv(cube * (150 - level), 100);
    if (level < 98) return idiv(idiv(cube * (1911 - 10 * level), 3), 500);
    return idiv(cube * (160 - level), 100);
  }),
  "fast": new CachedLevelThreshold(level => {
    if (level == 1) return 0;
    return idiv(4 * level ** 3, 5);
  }),
  "medium_fast": new CachedLevelThreshold(level => {
    if (level == 1) return 0;
    return level ** 3;
  }),
  "medium_slow": new CachedLevelThreshold(level => {
    return Math.max(0, idiv(level ** 3 * 6, 5) - 15 * level ** 2 + 100 * level - 140);
  }),
  "slow": new CachedLevelThreshold(level => {
    if (level == 1) return 0;
    return idiv(5 * level ** 3, 4);
  }),
  "fluctuating": new CachedLevelThreshold(level => {
    if (level == 1) return 0;
    const cube = level ** 3;
    if (level < 15) return idiv(cube * (idiv(level + 1, 3) + 24), 50);
    if (level < 36) return idiv(cube * (level + 14), 50);
    return idiv(cube * (idiv(level, 2) + 32), 50);
  })
}

/** Grupo de experiência pelo nome (sem diferenciar maiúsculas); medium_fast se desconhecido. */
export function getExperienceGroup(name: string | undefined): CachedLevelThreshold {
  return ExperienceGroups[(name ?? "").toLowerCase()] ?? ExperienceGroups.medium_fast;
}

/**
 * StandardExperienceCalculator (K/api/pokemon/experience/ExperienceCalculator.kt).
 * @param ownerName Nome do dono atual do vencedor, para o bônus de Pokémon trocado (×1.5). Se omitido,
 * é lido do dono online (tryGetOwner); sem dono conhecido, não há bônus.
 */
export function calculateExpGain(pokemon: PokemonData, faintedPokmeon: PokemonData, participationMultiplier: number = 1, ownerName?: string): number {
  let baseExp = faintedPokmeon.getBaseExperienceYield();
  let opponentLevel = faintedPokmeon.level;
  let term1 = (baseExp * opponentLevel) / 5;
  // This is meant to be a division but this is due to the intended behavior of handling the 2.0 sent over from Exp. All in modern Pokémon
  let term2 = 1 * participationMultiplier;
  let victorLevel = pokemon.level;
  let term3 = Math.pow(((2.0 * opponentLevel) + 10) / (opponentLevel + victorLevel + 10), 2.5);
  // Bônus de treinador original: no Cobblemon, 1.5 se o dono atual não for o OT.
  if (ownerName === undefined) {
    try { ownerName = pokemon.tryGetOwner()?.name; } catch { ownerName = undefined; }
  }
  let nonOtBonus = (pokemon.ogTrainer && ownerName && pokemon.ogTrainer !== ownerName) ? 1.5 : 1.0;
  let luckyEggMultiplier = (pokemon.item == "luckyegg") ? getConfig().luckyEggMultiplier : 1;
  // Pokémon prestes a evoluir por nível (todos os requisitos ok, incluindo um de nível) ganham ×1.2.
  let evolutionMultiplier = pokemon.getEvolutions().some(evolution =>
    evolution.requirements.some(requirement => requirement.variant === "level") && evolution.test(pokemon)
  ) ? 1.2 : 1;
  let affectionMultiplier = (pokemon.friendship >= AFFECTION_FRIENDSHIP) ? 1.2 : 1;
  //Config
  let gimickBoost = getConfig().experienceMultiplier;
  let term4 = term1 * term2 * term3 + 1;
  return Math.round(term4 * nonOtBonus * luckyEggMultiplier * evolutionMultiplier * affectionMultiplier * gimickBoost);
}
