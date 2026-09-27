// Habilidades como no Cobblemon: K/api/abilities/AbilityPool.kt, K/api/abilities/PotentialAbility.kt,
// K/pokemon/abilities/HiddenAbility.kt, K/api/item/ability/AbilityChanger.kt e
// K/item/interactive/ability/AbilityTypeChanger.kt.
import { toID } from "../showdown";

/** K/api/Priority.kt (a ordem importa: a seleção vai de HIGHEST para LOWEST). */
export type AbilityPriority = "HIGHEST" | "HIGH" | "NORMAL" | "LOW" | "LOWEST";
export const ABILITY_PRIORITIES: readonly AbilityPriority[] = ["HIGHEST", "HIGH", "NORMAL", "LOW", "LOWEST"];

export type AbilityType = "common" | "hidden";

/** Uma habilidade possível da forma (PotentialAbility). */
export interface PotentialAbility {
  /** Id Showdown da habilidade. */
  ability: string;
  type: AbilityType;
  /** CommonAbility = LOWEST, HiddenAbility = LOW. */
  priority: AbilityPriority;
  /** Índice dentro do grupo de prioridade (AbilityPool.mapping[priority].indexOf). */
  index: number;
}

/** Interpreta a lista "abilities" do JSON da espécie/forma ("overgrow", "h:chlorophyll"). */
export function parseAbilityPool(entries: readonly string[] = []): PotentialAbility[] {
  const counters: Partial<Record<AbilityPriority, number>> = {};
  const pool: PotentialAbility[] = [];
  for (const entry of entries) {
    const hidden = entry.startsWith("h:");
    const ability = toID(hidden ? entry.slice(2) : entry);
    if (!ability) continue;
    const priority: AbilityPriority = hidden ? "LOW" : "LOWEST";
    const index = counters[priority] ?? 0;
    counters[priority] = index + 1;
    pool.push({ ability, type: hidden ? "hidden" : "common", priority, index });
  }
  return pool;
}

/** AbilityPool.mapping[priority] */
export function abilitiesWithPriority(pool: PotentialAbility[], priority: AbilityPriority): PotentialAbility[] {
  return pool.filter(potential => potential.priority === priority).sort((a, b) => a.index - b.index);
}

/**
 * AbilityPool.select. No Cobblemon 1.8.2 `HiddenAbility.isSatisfiedBy` é sempre falso: a HA nunca
 * sai no sorteio normal (só por isca/pesca, propriedade `ha` ou Ability Patch). `hiddenAbilityChance`
 * permite a efeitos de spawn (iscas, pesca) forçar a HA com a chance dada; o padrão (0) é o do Cobblemon.
 */
export function selectAbility(pool: PotentialAbility[], hiddenAbilityChance = 0, random: () => number = Math.random): PotentialAbility | undefined {
  if (hiddenAbilityChance > 0 && random() < hiddenAbilityChance) {
    const hidden = pickHiddenAbility(pool, random);
    if (hidden) return hidden;
  }
  for (const priority of ABILITY_PRIORITIES) {
    const potentials = abilitiesWithPriority(pool, priority).filter(potential => potential.type !== "hidden");
    if (potentials.length > 0) return potentials[Math.floor(random() * potentials.length)];
  }
  return undefined;
}

/** FishingSpawnCause.alterHAAttempt: primeira HA encontrada, da maior para a menor prioridade. */
export function pickHiddenAbility(pool: PotentialAbility[], random: () => number = Math.random): PotentialAbility | undefined {
  for (const priority of ABILITY_PRIORITIES) {
    const hidden = abilitiesWithPriority(pool, priority).filter(potential => potential.type === "hidden");
    if (hidden.length > 0) return hidden[Math.floor(random() * hidden.length)];
  }
  return undefined;
}

/** Pokemon.attachAbilityCoordinate: posição (prioridade + índice) da habilidade na forma, se legal. */
export function findAbilityCoordinate(pool: PotentialAbility[], ability: string, priority?: AbilityPriority): PotentialAbility | undefined {
  ability = toID(ability);
  return pool.find(potential => potential.ability === ability && (priority === undefined || potential.priority === priority));
}

/**
 * Pokemon.attemptAbilityUpdate (troca de espécie/forma): mesma prioridade e índice; se não existir,
 * desce os índices até 0. Undefined = sortear de novo.
 */
export function resolveAbilityForSlot(pool: PotentialAbility[], priority: AbilityPriority, index: number): PotentialAbility | undefined {
  const potentials = abilitiesWithPriority(pool, priority);
  const exact = potentials.find(potential => potential.index === index);
  if (exact) return exact;
  for (let i = Math.max(0, index); i >= 0; i--) {
    const found = potentials.find(potential => potential.index === i);
    if (found) return found;
  }
  return undefined;
}

/** Tipo da habilidade atual (AbilityTypeChanger.findCurrent); undefined se forçada/ilegal. */
export function findCurrentAbilityType(pool: PotentialAbility[], ability: string, forced: boolean): AbilityType | undefined {
  if (forced) return undefined;
  return pool.find(potential => potential.ability === toID(ability))?.type;
}

export type AbilityChanger = "capsule" | "patch";

/** AbilityChanger.COMMON_ABILITY (Ability Capsule) só troca a partir de uma comum; HIDDEN_ABILITY (Ability Patch) de comum ou oculta. */
export function canChangeFrom(changer: AbilityChanger, current: AbilityType | undefined): boolean {
  if (changer === "capsule") return current === "common";
  return current === "common" || current === "hidden";
}

/**
 * AbilityTypeChanger.queryPossible: Capsule → outras comuns; Patch → a oculta, ou (se já for oculta)
 * as comuns.
 */
export function queryPossibleAbilities(pool: PotentialAbility[], changer: AbilityChanger, ability: string, forced: boolean): PotentialAbility[] {
  const current = findCurrentAbilityType(pool, ability, forced);
  const changerType: AbilityType = changer === "capsule" ? "common" : "hidden";
  const targetType: AbilityType = current === "hidden" ? "common" : changerType;
  return pool.filter(potential => potential.type === targetType && potential.ability !== toID(ability));
}
