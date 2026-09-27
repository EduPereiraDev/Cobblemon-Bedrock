// Amizade como no Cobblemon: K/pokemon/Pokemon.kt (set/increment/decrementFriendship),
// K/api/pokemon/friendship/FriendshipMutationCalculator.kt, PokeBalls.kt (Luxury Ball) e
// Cobblemon.kt (item com a tag cobblemon:is_friendship_booster = Soothe Bell).
import { toID } from "../showdown";

/** Tag cobblemon:is_friendship_booster (ids Showdown). */
export const FRIENDSHIP_BOOSTER_ITEMS = ["soothebell"];
/** Bolas com FriendshipEarningBoostEffect (ids Showdown) → multiplicador. */
export const FRIENDSHIP_BALL_MULTIPLIERS: Record<string, number> = { luxuryball: 2 };
/** Amizade a partir da qual o Pokémon ganha o bônus de afeição (EXP ×1.2). */
export const AFFECTION_FRIENDSHIP = 220;

/** FriendshipMutationCalculator.SWORD_AND_SHIELD_LEVEL_UP */
export function levelUpFriendship(friendship: number): number {
  if (friendship <= 99) return 3;
  if (friendship <= 199) return 2;
  return 0;
}

/** "cobblemon:luxury_ball", "luxury_ball" ou "luxuryball" → "luxuryball". */
export function normalizeItemId(id: string | undefined): string {
  if (!id) return "";
  return toID(id.replace(/^[a-z0-9_.-]+:/i, ""));
}

/**
 * Ganho efetivo de amizade "conquistada" (incrementFriendship): Luxury Ball (×2, prioridade LOW) e
 * depois Soothe Bell (+50%, LOWEST), cada um arredondado como no Cobblemon (roundToInt).
 */
export function boostedFriendshipGain(amount: number, pokeball?: string, heldItem?: string): number {
  let increment = amount;
  if (increment <= 0) return increment;
  const ballMultiplier = FRIENDSHIP_BALL_MULTIPLIERS[normalizeItemId(pokeball)];
  if (ballMultiplier) increment = Math.round(increment * ballMultiplier);
  if (FRIENDSHIP_BOOSTER_ITEMS.includes(normalizeItemId(heldItem))) increment = Math.round(increment + increment * 0.5);
  return increment;
}
