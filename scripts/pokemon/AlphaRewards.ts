/**
 * Recompensas ao derrotar um Alfa selvagem (Cobblemon 1.8.0+: callback
 * `data/cobblemon/callbacks/battle_fainted/pokemon_alpha_drops.molang` + `loot_table/alpha/**`).
 *
 * Quando um Pokémon selvagem Alfa desmaia em batalha:
 * 1. tabela geral pelo nível: tier1 (< 31), tier2 (≥ 31), tier3 (≥ 51), tier4 (≥ 66);
 * 2. duas chances de 50 % de uma tabela por tipo (`alpha/types/<tipo>_rewards_tier<1|2>`, tier 2 a partir do nível 51).
 *    Como no MoLang do Cobblemon (`q.length(t.types)` depois de preencher só `t.types[0]`), as duas chances usam o
 *    tipo primário.
 * Os itens caem na posição da entidade (`world.spawn_loot_table_items`). Itens que o Bedrock ainda não tem são
 * ignorados.
 */
import { Dimension, ItemStack, Vector3 } from "@minecraft/server";
import { ALPHA_LOOT, AlphaLootCount } from "./alphaLoot";

export interface AlphaSubject {
  aspects: readonly string[];
  level: number;
  types: readonly string[];
}

/** Tabela geral pelo nível. */
export function alphaRewardTable(level: number): string {
  if (level >= 66) return "alpha_rewards_tier4";
  if (level >= 51) return "alpha_rewards_tier3";
  if (level >= 31) return "alpha_rewards_tier2";
  return "alpha_rewards_tier1";
}

/** Tabelas sorteadas para o Alfa derrotado (na ordem do callback). */
export function alphaRewardTables(pokemon: AlphaSubject, random: () => number = Math.random): string[] {
  if (!pokemon.aspects.includes("alpha")) return [];
  const tables = [alphaRewardTable(pokemon.level)];
  const typeTier = pokemon.level >= 51 ? 2 : 1;
  const primary = (pokemon.types[0] ?? "normal").toLowerCase();
  // types[1] = types[0] (a lista do MoLang só tem um elemento quando q.length é avaliado).
  const types = [primary, primary];
  for (const type of types) {
    // math.random_integer(1, 2) == 1
    if (1 + Math.floor(random() * 2) === 1) tables.push(`types/${type}_rewards_tier${typeTier}`);
  }
  return tables;
}

function rollCount(count: AlphaLootCount, random: () => number): number {
  if (typeof count === "number") return count;
  const [min, max] = count;
  return Math.floor(min) + Math.floor(random() * (Math.floor(max) - Math.floor(min) + 1));
}

/** LootTable.getRandomItems: por pool, `rolls` sorteios ponderados. Retorna [item, quantidade]. */
export function rollAlphaTable(table: string, random: () => number = Math.random): [string, number][] {
  const out: [string, number][] = [];
  for (const pool of ALPHA_LOOT[table] ?? []) {
    const rolls = rollCount(pool.rolls, random);
    const total = pool.entries.reduce((sum, [, weight]) => sum + weight, 0);
    for (let i = 0; i < rolls && total > 0; i++) {
      let pick = Math.floor(random() * total);
      for (const [item, weight, count] of pool.entries) {
        pick -= weight;
        if (pick >= 0) continue;
        if (item) out.push([item, rollCount(count, random)]);
        break;
      }
    }
  }
  return out;
}

/** Sorteia e solta as recompensas na posição. Retorna os itens soltos. */
export function dropAlphaRewards(pokemon: AlphaSubject, dimension: Dimension, location: Vector3, random: () => number = Math.random): [string, number][] {
  const dropped: [string, number][] = [];
  for (const table of alphaRewardTables(pokemon, random)) {
    for (const [item, amount] of rollAlphaTable(table, random)) {
      if (amount <= 0) continue;
      try {
        dimension.spawnItem(new ItemStack(item, Math.min(64, amount)), location);
        dropped.push([item, amount]);
      }
      catch { /* item ainda não existe no Bedrock */ }
    }
  }
  return dropped;
}
