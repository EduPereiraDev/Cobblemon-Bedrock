//Handles Importing Data from JSON Files

import { Block, Entity, WeatherType, world } from "@minecraft/server"
import { toID } from "./showdown"
import { SPECIES } from "../generated/scripts/species";
import { ElementalType } from "./Pokemon";
import { getConfig } from "./Config";
import { BlockUtils, toDimensionLocation } from "./utils";
import { Learnset, getLevelUpMovesUpTo, parseLearnset } from "./pokemon/Learnset";


//Interfaces for typesafety for decoding the json files
export interface SpeciesData {
  name: string;
  nationalPokedexNumber: number;
  baseStats: StatSet;
  maleRatio: number;
  catchRate: number;
  baseScale: number;
  baseExperienceYield: number;
  baseFriendship: number;
  evYield: StatSet;
  experienceGroup: string;
  hitbox: HitboxEntry;
  primaryType: ElementalType;
  secondaryType?: ElementalType;
  abilities: string[];
  shoulderMountable: boolean;
  moves: string[];
  evolutions: EvolutionEntry[];
  features: string[];
  standingEyeHeight?: number;
  swimmingEyeHeight?: number;
  flyingEyeHeight?: number;
  behaviour: BehaviorClass;
  pokedex: string[];
  drops: DropTable;
  eggCycles: number;
  eggGroups: string[];
  cannotDynamax: boolean;
  implemented: boolean;
  height: number,
  weight: number,
  forms?: FormData[];
  labels?: string[];
  aspects?: string[];
  preEvolution?: string;
}

export interface FormData {
  name: string;
  aspects?: string[];
  baseStats?: StatSet;
  maleRatio?: number;
  hitbox?: HitboxEntry;
  baseScale?: number;
  eggCycles?: number;
  behaviour?: unknown;
  catchRate?: number;
  experienceGroup?: string;
  baseExperienceYield?: number;
  baseFriendship?: number;
  evYield?: StatSet;
  primaryType?: string;
  secondaryType?: string;
  shoulderMountable?: boolean;
  moves?: string[];
  evolutions?: EvolutionEntry[];
  abilities?: string[];
  drops?: DropTable;
  pokedex?: string[];
  preEvolution?: string;
  standingEyeHeight?: number;
  swimmingEyeHeight?: number;
  flyingEyeHeight?: number;
  labels?: string[];
  cannotDynamax?: boolean;
  eggGroups?: string[];
  height?: number;
  weight?: number;
  requiredMove?: string;
  requiredItem?: string;
  requiredItems?: string;
  battleTheme?: string;
  battleOnly?: boolean;
}

export interface StatSet {
  hp: number;
  attack: number;
  defence: number;
  special_attack: number;
  special_defence: number;
  speed: number;
}

export interface DropTable {
  amount?: number;
  entries?: DropEntry[];
}

interface DropEntry {
  item: string;
  percentage?: number;
  quantityRange?: string;
}

export interface HitboxEntry {
  width: number;
  height: number;
  fixed: boolean;
}

export interface EvolutionEntry {
  id: string;
  variant: string;
  result: string;
  consumeHeldItem: boolean;
  learnableMoves: string[];
  requiredContext?: unknown;
  requirements: EvoRequirement[];
  optional: boolean;
  /** Evolution.shedder (Nincada → Shedinja). */
  shedder?: string;
  /** Evolution.drops (entradas `type: "evolution"` com requisitos opcionais). */
  drops?: { amount?: number | string; entries?: { item: string; percentage?: number; quantityRange?: string; requirements?: EvoRequirement[]; type?: string }[] };
}

export interface EvoRequirement {
  variant: string;
  biomeCondition?: string;
  biomeAnticondition?: string;
  minLevel?: number;
  maxLevel?: number;
  amount?: number;
  range?: string;
  type?: string;
  isRaining?: boolean;
  isThundering?: boolean;
  move?: string;
  identifier?: string;
  possibilities?: EvoRequirement[],
  moonPhase?: string;
  ratio?: string;
  itemCondition?: string;
  target?: string;
  contains?: boolean
}

interface BehaviorClass {
  moving: MoveData;
  resting: RestData;
  idle: IdleData;
}

interface MoveData {
  walk: Walk;
  fly: Fly;
  swim: Swim;
  canLook: boolean;
  wanderSpeed: number;
  wanderChance: number;
  lookAtEntities: boolean;
}

interface Walk {
  canWalk: boolean;
  avoidsLand: boolean;
  walkSpeed: number;
}

interface Fly {
  canFly: boolean;
  flySpeedHorizontal: number;
}

interface Swim {
  avoidsWater: boolean;
  swimSpeed: number;
  canSwimInWater: boolean;
  canSwimInLava: boolean;
  canBreatheUnderwater: boolean;
  canBreathUnderlava: boolean;
  hurtByLava: boolean;
  canWalkOnWater: boolean;
  canWalkOnLava: boolean;
}

interface RestData {
  canSleep: boolean;
  willSleepOnBed: boolean;
  depth: string;
  light: string;
  sleepChance: number;
  times: string;
}

interface IdleData {
  pointAtSpawn: boolean;
}



const speciesCache = new Map<string, SpeciesData>();

/** Id de espécie do Cobblemon (nome do arquivo de espécie, ex.: "mrmime") a partir de nome ou id. */
export function toSpeciesId(species: string): string {
  return toID(species.replace(/^cobblemon:/, ""));
}

/** Todas as espécies importadas (ids). */
export function getAllSpeciesIds(): string[] {
  return Object.keys(SPECIES);
}

/** Dados da espécie, parseados sob demanda a partir do JSON gerado pelo importador. */
export function getSpeciesData(species: string): SpeciesData | undefined {
  const id = toSpeciesId(species);
  let data = speciesCache.get(id);
  if (!data) {
    const json = SPECIES[id];
    if (json === undefined)
      return undefined;
    data = JSON.parse(json) as SpeciesData;
    speciesCache.set(id, data);
  }
  return data;
}

/**
 * Frente memoria-script (docs/pendencias/memoria-script.md): os dados da espécie SEM guardar no cache, para quem lê um
 * campo de muitas espécies de uma vez (tamanho do hitbox no aquecimento do spawner, que passa por todas as entradas de
 * spawn). Guardar as ~860 espécies parseadas custava ~13,5 MB do heap do script para sempre. Já no cache: devolve a
 * mesma instância. Somente leitura (o objeto pode ser o do cache).
 */
export function peekSpeciesData(species: string): SpeciesData | undefined {
  const id = toSpeciesId(species);
  const cached = speciesCache.get(id);
  if (cached) return cached;
  const json = SPECIES[id];
  return json === undefined ? undefined : JSON.parse(json) as SpeciesData;
}

/**
 * Forma ativa para um conjunto de aspectos (Species.getForm do Cobblemon): a última forma cujos
 * aspectos estão todos presentes. Undefined = forma padrão (os dados da própria espécie).
 */
export function getFormForAspects(speciesData: SpeciesData, aspects: readonly string[] = []): FormData | undefined {
  const forms = speciesData.forms ?? [];
  for (let i = forms.length - 1; i >= 0; i--) {
    const formAspects = forms[i].aspects ?? [];
    if (formAspects.every(aspect => aspects.includes(aspect))) return forms[i];
  }
  return undefined;
}

/** Forma pelo nome (Species.getFormByName), sem diferenciar maiúsculas. */
export function getFormByName(speciesData: SpeciesData, name: string): FormData | undefined {
  return speciesData.forms?.find(form => form.name.toLowerCase() === name.toLowerCase());
}

const learnsetCache = new Map<string, Learnset>();

/**
 * Frente msd-fase2: esquece o que foi parseado da espécie (dados e learnsets). Usado quando uma extensão troca a
 * entrada de SPECIES no worldLoad (scripts/extensions/megaShowdown/tables.ts).
 */
export function forgetSpeciesData(species: string): void {
  const id = toSpeciesId(species);
  speciesCache.delete(id);
  for (const key of [...learnsetCache.keys()]) if (key.startsWith(`${id}/`)) learnsetCache.delete(key);
}

/** Learnset (golpes por origem) da espécie ou da forma, em cache. */
export function getLearnset(species: string, form?: FormData): Learnset {
  const speciesData = getSpeciesData(species);
  const key = `${toSpeciesId(species)}/${form?.moves ? form.name : ""}`;
  let learnset = learnsetCache.get(key);
  if (!learnset) {
    learnset = parseLearnset(form?.moves ?? speciesData?.moves ?? []);
    learnsetCache.set(key, learnset);
  }
  return learnset;
}

/**
 * Golpes aprendidos por nível até `maxLevel` (ou todos, se omitido). Formato do Cobblemon: "nível:golpe".
 * Com `aspects`, usa o learnset da forma correspondente (ex.: Raichu de Alola).
 */
export function getAvaliableMoves(species: string, maxLevel?: number, aspects?: readonly string[]): string[] {
  const speciesData = getSpeciesData(species);
  if (!speciesData) return [];
  const form = aspects ? getFormForAspects(speciesData, aspects) : undefined;
  return getLevelUpMovesUpTo(getLearnset(species, form), maxLevel ?? Number.MAX_SAFE_INTEGER);
}

export function getFullName(species: string): string {
  return getSpeciesData(species)?.name ?? species;
}
