/** Requisitos de evolução do Cobblemon 1.8 que o port original não tinha. */
import { PokemonData } from "../../Pokemon";
import { PokemonProperties } from "../../PokemonProperties";
import { EvoRequirement } from "../../speciesData";
import { EvolutionRequirement } from "../EvolutionRequirement";
import { TimeRanges } from "../../spawning/TimeRange";
import type { StatsTable } from "../../showdown";
import type { Player } from "@minecraft/server";
import { getBlocksTraveled, getIntFeature } from "../../pokemon/SpeciesFeatures";
import { isProgressGoalDone } from "../../pokedex/Progress";

const STAT_KEYS: Record<string, keyof StatsTable> = {
  hp: "hp", attack: "atk", defence: "def", special_attack: "spa", special_defence: "spd", speed: "spe",
};

/** Hora do dia ("day", "night", "dusk"...). */
export class TimeRangeRequirement extends EvolutionRequirement {
  variant = "time_range";
  constructor(public range = "any") { super() }
  check(): boolean {
    return TimeRanges[this.range]?.validate() ?? true;
  }
  static getFromSerialized(requirement: EvoRequirement) {
    return new TimeRangeRequirement(requirement.range);
  }
}

/** O Pokémon precisa ter as propriedades (ex.: "gender=female"). */
export class PropertiesRequirement extends EvolutionRequirement {
  variant = "properties";
  constructor(public target: PokemonProperties) { super() }
  check(pokemon: PokemonData): boolean {
    return this.target.match(pokemon);
  }
  static getFromSerialized(requirement: EvoRequirement) {
    return new PropertiesRequirement(PokemonProperties.parse(requirement.target));
  }
}

/** Compara dois atributos atuais (Tyrogue, etc.). */
export class StatCompareRequirement extends EvolutionRequirement {
  variant = "stat_compare";
  constructor(public highStat = "attack", public lowStat = "defence") { super() }
  check(pokemon: PokemonData): boolean {
    const stats = pokemon.getCurrentStats();
    return stats[STAT_KEYS[this.highStat]] > stats[STAT_KEYS[this.lowStat]];
  }
  static getFromSerialized(requirement: EvoRequirement & { highStat?: string, lowStat?: string }) {
    return new StatCompareRequirement(requirement.highStat, requirement.lowStat);
  }
}

export class StatEqualRequirement extends EvolutionRequirement {
  variant = "stat_equal";
  constructor(public statOne = "attack", public statTwo = "defence") { super() }
  check(pokemon: PokemonData): boolean {
    const stats = pokemon.getCurrentStats();
    return stats[STAT_KEYS[this.statOne]] === stats[STAT_KEYS[this.statTwo]];
  }
  static getFromSerialized(requirement: EvoRequirement & { statOne?: string, statTwo?: string }) {
    return new StatEqualRequirement(requirement.statOne, requirement.statTwo);
  }
}

/**
 * Consulta de estrutura (frente "motor": `isInStructure`). Recebe a entidade/posição do Pokémon e o id/tag da
 * estrutura (ex.: "#minecraft:village") e responde true/false, ou undefined se não souber. Sem consulta registrada o
 * port mantém o comportamento antigo: condição nunca cumprida, anticondição sempre cumprida.
 */
export type StructureLookup = (pokemon: PokemonData, structure: string) => boolean | undefined;
let structureLookup: StructureLookup | undefined;
export function setEvolutionStructureLookup(lookup: StructureLookup | undefined) {
  structureLookup = lookup;
}

/** StructureRequirement: `structureCondition` (tem de estar) e/ou `structureAnticondition` (não pode estar). */
export class StructureRequirement extends EvolutionRequirement {
  variant = "structure";
  constructor(public condition?: string, public anticondition?: string) { super() }
  /** Compatibilidade: antes só guardava se havia condição. */
  get required(): boolean { return this.condition !== undefined; }
  check(pokemon: PokemonData): boolean {
    if (this.condition !== undefined) {
      const inside = structureLookup?.(pokemon, this.condition);
      if (inside !== true) return false;
    }
    if (this.anticondition !== undefined) {
      const inside = structureLookup?.(pokemon, this.anticondition);
      if (inside === true) return false;
    }
    return true;
  }
  static getFromSerialized(requirement: EvoRequirement & { structureCondition?: string, structureAnticondition?: string }) {
    return new StructureRequirement(requirement.structureCondition, requirement.structureAnticondition);
  }
}

/** BlocksTraveledRequirement: `pokemon.getBlocksTraveled() >= amount` (passos contados fora da bola). */
export class BlocksTraveledRequirement extends EvolutionRequirement {
  variant = "blocks_traveled";
  constructor(public amount = 0) { super() }
  check(pokemon: PokemonData): boolean {
    return getBlocksTraveled(pokemon) >= this.amount;
  }
  static getFromSerialized(requirement: EvoRequirement) {
    return new BlocksTraveledRequirement(requirement.amount ?? 0);
  }
}

/**
 * Consulta de conquista do dono (AdvancementRequirement.checkPlayer). O Bedrock não tem advancements de add-on: o
 * port usa o "Progresso Cobblemon" (scripts/pokedex/Progress.ts), e a frente de interface pode trocar a consulta.
 */
export type AdvancementLookup = (owner: Player, advancement: string) => boolean | undefined;
let advancementLookup: AdvancementLookup = (owner, advancement) => isProgressGoalDone(owner, advancement);
export function setAdvancementLookup(lookup: AdvancementLookup) {
  advancementLookup = lookup;
}

/** AdvancementRequirement (OwnerQueryRequirement): sem dono jogador não passa; NPC dono sempre passa. */
export class AdvancementRequirement extends EvolutionRequirement {
  variant = "advancement";
  constructor(public requiredAdvancement = "") { super() }
  check(pokemon: PokemonData): boolean {
    let owner: Player | undefined;
    try { owner = pokemon.tryGetOwner(); }
    catch { owner = undefined; }
    if (!owner) return false;
    return advancementLookup(owner, this.requiredAdvancement) === true;
  }
  static getFromSerialized(requirement: EvoRequirement & { requiredAdvancement?: string }) {
    return new AdvancementRequirement(requirement.requiredAdvancement ?? "");
  }
}

/** PropertyRangeRequirement: a feature inteira existe e está na faixa (IntRange "a-b", padrão 0-256). */
export class PropertyRangeRequirement extends EvolutionRequirement {
  variant = "property_range";
  constructor(public feature = "", public min = 0, public max = 256) { super() }
  check(pokemon: PokemonData): boolean {
    const value = getIntFeature(pokemon, this.feature);
    return value !== undefined && value >= this.min && value <= this.max;
  }
  static getFromSerialized(requirement: EvoRequirement & { feature?: string }) {
    const [min, max] = parseIntRange(requirement.range, [0, 256]);
    return new PropertyRangeRequirement(requirement.feature ?? "", min, max);
  }
}

/** IntRangeAdapter: "3" → 3..3, "32-63" → 32..63. */
export function parseIntRange(value: string | number | undefined, fallback: [number, number]): [number, number] {
  if (value === undefined) return fallback;
  if (typeof value === "number") return [value, value];
  const match = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(value);
  if (!match) return fallback;
  const start = parseInt(match[1]);
  return [start, match[2] !== undefined ? parseInt(match[2]) : start];
}

/**
 * Requisito que o port não reconhece (datapack de terceiros). Considerado cumprido para não travar a evolução.
 */
export class UntrackedRequirement extends EvolutionRequirement {
  constructor(public variant: string) { super() }
  check(): boolean {
    return true;
  }
  static forVariant(variant: string) {
    return () => new UntrackedRequirement(variant);
  }
}
