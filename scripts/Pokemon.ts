import { awardStat } from "./events/PlayerStats";
import { Dimension, DimensionLocation, Entity, ItemStack, Player, RawMessage, Vector3, world } from "@minecraft/server";
import { Dex, toID } from "./showdown";
import { getSpeciesData, SpeciesData, toSpeciesId, FormData, getFormForAspects, getLearnset, StatSet, HitboxEntry, EvolutionEntry } from "./speciesData";
import { resolveVariant } from "../generated/scripts/variants";
import type { PokemonSet, StatsTable } from "./showdown";
import { getSafeTeam, getTeam, storePokemonInFirstSpace } from "./pokemonStorage";
import { UUID, getAllDimensions, removeNamespace } from "./utils";
import { getExperienceGroup } from "./Experience";
import { getMoveTranslation, message, renderMove } from "./language";
import { EvolutionProgress } from "./evolution/EvolutionProgress";
import { Evolution } from "./evolution";
import { initializeEvolutions } from "./evolution";
import { PassiveEvolution } from "./evolution/Evolution";
import { getConfig } from "./Config";
import {
  STAT_KEYS, StatKey, EvYield, MAX_EV_PER_STAT, MAX_EV_TOTAL, MAX_IV, COBBLEMON_TO_SHOWDOWN_STAT, addEvToTable,
  evYieldToStats, toStatKey,
} from "./pokemon/Stats";
import {
  Learnset, LearnsetSource, buildMoveset, canLearn, getLearnsetSources, getLevelUpMovesUpTo, isKnownMove,
} from "./pokemon/Learnset";
import {
  AbilityChanger, AbilityPriority, AbilityType, PotentialAbility, canChangeFrom, findAbilityCoordinate,
  findCurrentAbilityType, parseAbilityPool, pickHiddenAbility, queryPossibleAbilities, resolveAbilityForSlot,
  selectAbility,
} from "./pokemon/Abilities";
import { boostedFriendshipGain, levelUpFriendship, normalizeItemId } from "./pokemon/Friendship";
import { showdownItemOf } from "./items/heldItems";
import { playExpGainedSounds } from "./battle/LevelUpSounds";
import { applyEntitySize } from "./entity/Size";
import { markCaught } from "./pokedex/PokedexStorage";
import { SizeCategory, applyScaleProperty, effectiveScale, rollIntrinsicScale, sizeCategoryOf } from "./pokemon/Scale";
import { AvoidingMob, applyAvoidTags, avoidedBy } from "./pokemon/EntityInteract";
import { swapCosmeticItem } from "./pokemon/CosmeticItems";
import { giveMark, takeMark } from "./pokemon/Marks";
import { ensureWeightedFeatureAspects } from "./pokemon/SpeciesFeatures";
import { syncAspectBits } from "./entity/AspectSync"; // frente dados-ia
import { applyDisplayOverride } from "./pokemon/DisplayOverride"; // frente msd-fase1
import { RAINBOW_PREFIX, characteristicOf, rainbowAspect } from "./pokemon/Characteristic";

export { evYieldToStats } from "./pokemon/Stats";
export type { StatKey, EvYield } from "./pokemon/Stats";

export enum ElementalType {
  Normal = "normal",
  Fire = "fire",
  Water = "water",
  Grass = "grass",
  Electric = "electric",
  Ice = "ice",
  Fighting = "fighting",
  Poison = "poison",
  Ground = "ground",
  Flying = "flying",
  Psychic = "psychic",
  Bug = "bug",
  Rock = "rock",
  Ghost = "ghost",
  Dragon = "dragon",
  Dark = "dark",
  Steel = "steel",
  Fairy = "fairy"
}
export enum StatusEffect {
  Burn = "brn",
  Faint = "fnt",
  Freeze = "frz",
  Paralyze = "par",
  Sleep = "slp",
  Poison = "psn",
  Badly_Poison = "tox"
}

/** Valid properties to save the state of */
const validSaveEntityProperties = ["cobblemon:has_been_sheared"];

export const PersistentStatuses = ["brn", "frz", "par", "tox", "psn", "slp"];

/** Faixa de nível usada quando um Pokémon aparece sem regra de spawn (ovo, /summon). */
const DEFAULT_WILD_LEVELS = { min: 5, max: 15 };

/** Chance de shiny do Cobblemon (config padrão: 1 em 8192). */
export const SHINY_RATE = 8192;

/** Sorteio de shiny do Cobblemon: `shinyRate <= 0` = nunca; senão chance de 1 em `shinyRate`. */
export function rollShiny(shinyRate: number = SHINY_RATE): boolean {
  if (!(shinyRate > 0)) return false;
  return Math.random() * shinyRate < 1;
}

/** Número máximo de golpes no moveset (MoveSet.MOVE_COUNT). */
export const MOVE_COUNT = 4;
/** Estágios máximos de PP Up por golpe (Move.raiseMaxPP). */
export const MAX_PP_STAGES = 3;

/** Tag das entidades de clones de batalha (BattleCloneProperty): não interagem nem são capturadas. */
export const BATTLE_CLONE_TAG = "cobblemon_battle_clone";

/** Inicializa um Pokémon selvagem que apareceu sem dados (spawn egg, /summon, etc.). */
export function setupCobblemon(entity: Entity, level?: number) {
  const species = isValidCobblemon(entity);
  if (!species || !getSpeciesData(species)) throw new Error(`Could not set up cobblemon ${entity.typeId}: No Data Found`);
  const data = PokemonData.generateNewWildPokemon(species, { level });
  data.applyToCobblemon(entity);
  entity.setProperty("cobblemon:wild", true);
  entity.triggerEvent("cobblemon:set_wild");
}

export interface WildPokemonOptions {
  level?: number;
  shiny?: boolean;
  /** Aspectos extras (formas regionais etc.), além de gênero e shiny. */
  aspects?: string[];
  /**
   * Chance (0–1) de receber a habilidade oculta. O Cobblemon 1.8.2 nunca sorteia HA no spawn normal
   * (padrão 0); iscas/pesca usam isto.
   */
  hiddenAbilityChance?: number;
  /** Força a habilidade oculta, se a forma tiver uma (propriedade `ha`). */
  hiddenAbility?: boolean;
  /** Mínimo de IVs 31 (IVs.createRandomIVs(minPerfectIVs)). */
  minPerfectIvs?: number;
  /** Moveset builder do Cobblemon: "wild" (padrão) ou "alpha". */
  movesetBuilder?: string;
}

export interface AdditionalMoveData {
  pp: number;
  maxPp: number;
  extraPp: number;
  /** Estágios de PP Up (0–3, Move.raisedPpStages). Ausente em saves antigos. */
  ppStages?: number;
}

/** PP máximo com `stages` PP Ups (Move.maxPp do Cobblemon). */
export function maxPpWithStages(basePp: number, stages: number): number {
  return basePp + Math.floor(stages * basePp / 5);
}

//I had this in the AdditionalMoveData when it was a class, but I changed it because json decoding doesn't know its supposed to be a class
export class AdditionalMoveDataManager {
  static create(pp: number, ppStages = 0): AdditionalMoveData {
    const maxPp = maxPpWithStages(pp, ppStages);
    return { pp: maxPp, maxPp, extraPp: maxPp - pp, ppStages }
  }
  /**Call this function whenever the move changes */
  static update(oldData: AdditionalMoveData, newMovePP: number): AdditionalMoveData {
    let percentage = oldData.maxPp > 0 ? oldData.pp / oldData.maxPp : 1;
    if (oldData.ppStages !== undefined)
      oldData.extraPp = maxPpWithStages(newMovePP, oldData.ppStages) - newMovePP;
    oldData.maxPp = newMovePP + oldData.extraPp;
    oldData.pp = Math.round(percentage * oldData.maxPp);
    return oldData
  }
  static ppUp(oldData: AdditionalMoveData, amount: number) {
    oldData.extraPp += amount;
    oldData.maxPp += amount;
    return oldData;
  }
  /** Estágios de PP Up; em saves antigos (só extraPp) estima a partir do PP extra. */
  static getStages(data: AdditionalMoveData, basePp: number): number {
    if (data.ppStages !== undefined) return data.ppStages;
    if (!data.extraPp || basePp < 5) return 0;
    return Math.min(MAX_PP_STAGES, Math.round(data.extraPp / Math.floor(basePp / 5)));
  }
  private constructor() { }
}

/** Resultado de PokemonData.gainExp (AddExperienceResult do Cobblemon, com extras para a batalha). */
export interface AddExperienceResult {
  oldLevel: number;
  newLevel: number;
  /** EXP efetivamente somada (0 se já estava no nível máximo). */
  experienceAdded: number;
  /** Golpes por nível que ficaram disponíveis nesta subida (ids Showdown). */
  newMoves: string[];
  /** Dos `newMoves`, os que entraram direto no moveset (havia espaço). */
  addedMoves: string[];
  /** Amizade ganha pelas subidas de nível. */
  friendshipGained: number;
  /** Ids das evoluções que ficaram prontas ou aconteceram. */
  evolutions: string[];
}

/** Class representing data unique to each pokemon, like its uuid.
 */
export class PokemonData implements PokemonSet {
  //Defaults In case constructor is called (ONLY USE FACTORY METHODS)
  /** Use .getName() instead because this is blank unless a nickname is set */
  name: string = "";
  currentHealth = 1;
  uuid: string = "very random uuid";
  species: string = "unown";
  item: string = "";
  /** The Item in the pokemon's hand but as a minecraft item identifier. */
  minecraftItem?: string;
  ability: string = "";
  /** Prioridade da habilidade no pool da forma (LOWEST = comum, LOW = oculta). Preservada na evolução. */
  abilityPriority?: AbilityPriority;
  /** Índice da habilidade dentro do grupo de prioridade. Preservado na evolução. */
  abilityIndex?: number;
  /** Habilidade fora do pool da forma (definida à força); não muda com evolução/forma. */
  abilityForced?: boolean;
  /** Golpes ativos (até 4, ids Showdown). */
  moves: string[] = [];
  /** PP de cada golpe em `moves` (mesmo índice). */
  movesInfo: AdditionalMoveData[] = [];
  status: StatusEffect | undefined;
  statusDuration: number | undefined;
  /** Natureza original (nome Showdown, ex.: "Adamant"). Use getEffectiveNature() para atributos. */
  nature: string = "";
  /** Natureza aplicada por Mint (Pokemon.mintedNature); vence `nature` nos atributos. */
  mintedNature?: string;
  gender: string = "";
  evs: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  ivs: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  /** IVs de Hyper Training (IVs.hyperTrainedIVs): usados no lugar do IV natural nos atributos. */
  hyperTrainedIvs: Partial<StatsTable> = {};
  level: number = 1;
  experience: number = 0;
  /** Índice da combinação modelo+textura no render controller (propriedade cobblemon:variant). */
  variant: number = 0;
  /** Aspectos do Cobblemon (shiny, male/female, formas) usados para escolher a variante visual. */
  aspects: string[] = [];
  /** Golpes guardados fora do moveset ("benched moves"): ensinados, de evolução ou esquecidos. */
  learnedMoves: string[] = [];
  maxHealth = 1;
  pokeball?: string;
  /** The Name of the original tamer */
  ogTrainer?: string;
  /** OriginalTrainerType (none/player/npc). Ausente = "player" quando há `ogTrainer` (saves antigos). */
  ogTrainerType?: "none" | "player" | "npc";
  /** Id do jogador OT (player.id ou UUID vindo de `originaltrainer=`). */
  ogTrainerId?: string;
  /** Pokemon.forcedAspects (propriedades `aspect=`/`unaspect=`): aspectos mantidos mesmo sem origem derivada. */
  forcedAspects?: string[];
  /** Pokemon.markings: 6 estados (0 = apagada, 1 = azul, 2 = rosa) na ordem ● ▲ ■ ♥ ★ ◆. Ausente = tudo 0. */
  markings?: number[];
  /** Pokemon.rideBoosts (RidingStat → pontos somados ao início da faixa; scripts/pokemon/RideStats.ts). */
  rideBoosts?: Record<string, number>;
  /** Pokemon.heldItemVisible (HeldItemVisibleProperty). Ausente = true. */
  heldItemVisible?: boolean;
  /** Player ID of the pokemon's owner */
  trainer?: string;
  evolutionProgress: EvolutionProgress<unknown>[] = [];
  /** Id's of evolutions that are ready. */
  readyEvolutions: string[] = [];
  /** Saved entity properties to be reloaded */
  entityStates: Record<string, string | boolean | number> = {};

  shiny?: boolean;
  /** Amizade (0 a config.maxPokemonFriendship). Mude com addFriendship/setFriendship. */
  friendship: number = 0;

  /** Marcas obtidas (ids do Cobblemon, ex.: "cobblemon:mark_alpha"). */
  marks: string[] = [];
  /** Marca exibida como título. */
  activeMark?: string;
  /** Marcas que podem ser dadas na captura (Pokemon.potentialMarks); sorteadas por applyPotentialMarks. */
  potentialMarks?: string[];
  /** Pokemon.tradeable: false impede a troca (TradeManager). Ausente = pode trocar. */
  tradeable?: boolean;
  /** Amizade guardada por treinador ao trocar (Pokemon.cacheFriendship / restoreFriendship). */
  tradeFriendship?: Record<string, number>;
  /** Cooldown das interações (`pokemon_interactions`): grouping → tick absoluto do fim (scripts/entity/Interactions.ts). */
  interactionCooldowns?: Record<string, number>;
  /** Item cosmético (id Minecraft); os aspects dele vêm de scripts/pokemon/CosmeticItems.ts (COSMETIC_SLOT_ASPECT). */
  cosmeticItem?: string;
  /** Escala intrínseca (Pokemon.scaleModifier, sorteada em 0,95–1,05 ao criar). Ausente = 1 (saves antigos). */
  scaleModifier?: number;
  /** Pokemon.faintedTimer: segundos até acordar do desmaio fora de batalha (scripts/pokemon/PassiveHealing.ts). */
  faintedTimer?: number;
  /** Pokemon.healTimer: segundos até a próxima cura passiva. */
  healTimer?: number;
  /** PersistentStatusContainer: status persistente fora de batalha e segundos restantes. */
  statusTimer?: { status: string; secondsLeft: number };
  /** BattleCloneProperty: cópia usada numa batalha com cloneParties/setLevel; nunca volta para o time real. */
  battleClone?: boolean;
  /** Pokemon.currentFullness: barriga (0..máx pela massa; scripts/pokemon/Fullness.ts). Ausente = 0. */
  fullness?: number;
  /** Pokemon.metabolismCycle: ticks acumulados até perder 1 de barriga. */
  metabolismCycle?: number;
  /**
   * Features inteiras por Pokémon (scripts/pokemon/SpeciesFeatures.ts): `gimmighoul_coins`, `gimmighoul_netherite`,
   * `blocks_traveled`, `slowpoke_tail_regrowth`. Ausente = padrão da feature.
   */
  features?: Record<string, number>;

  //Unused
  hpType?: string;
  dynamaxLevel?: number;
  gigantamax?: boolean;
  teraType?: string;

  private constructor() { }

  /** Nome antigo de `friendship` (saves antigos e PokemonSet do Showdown). */
  get happiness(): number {
    return this.friendship;
  }
  set happiness(value: number) {
    this.friendship = value;
  }

  /** Returns the name or species if the name is blank
   * I got tired of writing (pokemon.name || pokemon.species)
   * In most cases, getTranslatedName is better, but this works if you cannot use a translation.
   *  */
  getName(): string {
    return (this.name || this.species)
  }
  /** Returns the name in a format that the bedrock client can translate */
  getTranslatedName(): RawMessage {
    return this.name ? { text: this.name } : { translate: `cobblemon.species.${toID(this.species)}.name` }
  }

  updateMaxHP() {
    this.maxHealth = this.getCurrentStats().hp;
  }

  /**
   * Recalcula o HP máximo mantendo a proporção de HP atual (Pokemon.updateHP do Cobblemon).
   * @param rounding "round" (mudança de IV/EV/forma) ou "ceil" (mudança de nível).
   */
  recalculateHealth(rounding: "round" | "ceil" = "round") {
    const ratio = this.maxHealth > 0 ? Math.min(1, Math.max(0, this.currentHealth / this.maxHealth)) : 1;
    this.updateMaxHP();
    const value = rounding === "ceil" ? Math.ceil(ratio * this.maxHealth) : Math.round(ratio * this.maxHealth);
    this.currentHealth = Math.min(this.maxHealth, Math.max(0, value));
  }

  // -------------------------------------------------------------------------------------------
  // Forma ativa e dados dependentes da forma (FormData do Cobblemon)

  /** Forma ativa pelos aspectos (Species.getForm); undefined = forma padrão. */
  getFormData(): FormData | undefined {
    const speciesData = getSpeciesData(this.species);
    return speciesData ? getFormForAspects(speciesData, this.aspects) : undefined;
  }

  /** Nome da forma ativa ("Normal" para a padrão, como no Cobblemon). */
  getFormName(): string {
    return this.getFormData()?.name ?? "Normal";
  }

  getBaseStats(): StatSet {
    return this.getFormData()?.baseStats ?? this.getSpeciesData().baseStats;
  }
  getPrimaryType(): ElementalType {
    return (this.getFormData()?.primaryType as ElementalType | undefined) ?? this.getSpeciesData().primaryType;
  }
  /** Como no FormData: só herda o tipo secundário da espécie se a forma não definir nenhum tipo. */
  getSecondaryType(): ElementalType | undefined {
    const form = this.getFormData();
    if (!form || (form.primaryType === undefined && form.secondaryType === undefined))
      return this.getSpeciesData().secondaryType;
    return form.secondaryType as ElementalType | undefined;
  }
  getTypes(): ElementalType[] {
    const secondary = this.getSecondaryType();
    return secondary ? [this.getPrimaryType(), secondary] : [this.getPrimaryType()];
  }
  /** Lista "abilities" crua da forma (com prefixo "h:" nas ocultas). */
  getAbilityEntries(): string[] {
    return this.getFormData()?.abilities ?? this.getSpeciesData().abilities ?? [];
  }
  getAbilityPool(): PotentialAbility[] {
    return parseAbilityPool(this.getAbilityEntries());
  }
  /** Lista "moves" crua da forma ("N:golpe", "tm:", "egg:", ...). */
  getMoveEntries(): string[] {
    return this.getFormData()?.moves ?? this.getSpeciesData().moves ?? [];
  }
  getLearnset(): Learnset {
    return getLearnset(this.species, this.getFormData());
  }
  getCatchRate(): number {
    return this.getFormData()?.catchRate ?? this.getSpeciesData().catchRate;
  }
  /** Nome do grupo de experiência (ex.: "medium_slow"). */
  getExperienceGroup(): string {
    return this.getFormData()?.experienceGroup ?? this.getSpeciesData().experienceGroup;
  }
  getBaseExperienceYield(): number {
    return this.getFormData()?.baseExperienceYield ?? this.getSpeciesData().baseExperienceYield;
  }
  /** EVs que este Pokémon dá ao ser derrotado, no formato do Showdown (para addEvs). */
  getEvYield(): EvYield {
    return evYieldToStats((this.getFormData()?.evYield ?? this.getSpeciesData().evYield) as unknown as Record<string, number>);
  }
  getBaseFriendship(): number {
    return this.getFormData()?.baseFriendship ?? this.getSpeciesData().baseFriendship;
  }
  getHitbox(): HitboxEntry {
    return this.getFormData()?.hitbox ?? this.getSpeciesData().hitbox;
  }
  getBaseScale(): number {
    return this.getFormData()?.baseScale ?? this.getSpeciesData().baseScale;
  }
  getMaleRatio(): number {
    return this.getFormData()?.maleRatio ?? this.getSpeciesData().maleRatio;
  }
  getLabels(): string[] {
    return this.getFormData()?.labels ?? this.getSpeciesData().labels ?? [];
  }
  /** Pokemon.hasLabels: todos os rótulos presentes (ex.: "legendary"). */
  hasLabels(...labels: string[]): boolean {
    const own = this.getLabels().map(label => label.toLowerCase());
    return labels.every(label => own.includes(label.toLowerCase()));
  }
  /** Evoluções da forma ativa (FormData.evolutions: a forma não herda as da espécie). */
  getEvolutionEntries(): EvolutionEntry[] {
    const form = this.getFormData();
    return form ? (form.evolutions ?? []) : (this.getSpeciesData().evolutions ?? []);
  }

  // -------------------------------------------------------------------------------------------
  // EVs

  /** Soma dos EVs. */
  getEvTotal(): number {
    return STAT_KEYS.reduce((sum, stat) => sum + (this.evs[stat] ?? 0), 0);
  }

  /** Verdadeiro se o atributo ainda aceita EVs (EVIncreaseItem.canUseOnPokemon). */
  canAddEv(stat: StatKey): boolean {
    return (this.evs[stat] ?? 0) < MAX_EV_PER_STAT && this.getEvTotal() < MAX_EV_TOTAL;
  }

  /**
   * Adiciona EVs (EVs.add): até 252 por atributo e 510 no total; valores negativos removem.
   * Aceita chaves do Showdown (hp/atk/def/spa/spd/spe) e do Cobblemon (attack, special_defence, ...).
   * @returns Total de EVs efetivamente adicionados (negativo se removeu).
   */
  addEvs(evYield: Partial<Record<StatKey, number>>): number {
    let applied = 0;
    let hpChanged = false;
    for (const [key, value] of Object.entries(evYield)) {
      const stat = toStatKey(key);
      if (!stat || typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
      const delta = addEvToTable(this.evs, stat, value);
      applied += delta;
      if (delta !== 0) hpChanged = true;
    }
    if (hpChanged) this.recalculateHealth();
    return applied;
  }

  /** Remove EVs (berries redutoras etc.). `evs` com valores positivos = quanto remover. */
  removeEvs(evs: Partial<Record<StatKey, number>>): number {
    const negative: Partial<Record<StatKey, number>> = {};
    for (const [key, value] of Object.entries(evs)) if (typeof value === "number") negative[key as StatKey] = -Math.abs(value);
    return -this.addEvs(negative);
  }

  /** Define o EV (Pokemon.setEV); falso se passar de 252 ou do total 510. */
  setEv(stat: StatKey, value: number): boolean {
    value = Math.trunc(value);
    if (value < 0 || value > MAX_EV_PER_STAT) return false;
    if (this.getEvTotal() - (this.evs[stat] ?? 0) + value > MAX_EV_TOTAL) return false;
    this.evs[stat] = value;
    this.recalculateHealth();
    return true;
  }

  /** Zera os EVs (Fresh Start Mochi). Falso se já estavam zerados. */
  resetEvs(): boolean {
    if (this.getEvTotal() === 0) return false;
    this.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    this.recalculateHealth();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // IVs e Hyper Training

  /** IV usado nos atributos (IVs.getEffectiveBattleIV): o de Hyper Training, se houver. */
  getEffectiveIv(stat: StatKey): number {
    return this.hyperTrainedIvs?.[stat] ?? this.ivs[stat] ?? 0;
  }
  getEffectiveIvs(): StatsTable {
    const output = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    for (const stat of STAT_KEYS) output[stat] = this.getEffectiveIv(stat);
    return output;
  }
  isHyperTrained(stat: StatKey): boolean {
    return this.hyperTrainedIvs?.[stat] !== undefined;
  }

  /**
   * Hyper Training (Pokemon.hyperTrainIV / IVs.setHyperTrainedIV): o atributo passa a usar `value`.
   * Se `value` for igual ao IV natural, o Hyper Training é desfeito.
   * @returns Verdadeiro se algo mudou.
   */
  hyperTrain(stat: StatKey, value: number = MAX_IV): boolean {
    value = Math.trunc(value);
    if (value < 0 || value > MAX_IV) throw new Error(`IV ${value} fora do intervalo 0..${MAX_IV}`);
    this.hyperTrainedIvs ??= {};
    if (value === this.ivs[stat]) {
      if (this.hyperTrainedIvs[stat] === undefined) return false;
      delete this.hyperTrainedIvs[stat];
    }
    else {
      if (this.hyperTrainedIvs[stat] === value) return false;
      this.hyperTrainedIvs[stat] = value;
    }
    this.recalculateHealth();
    return true;
  }

  /** HyperTrainingItem.canChangeIV: o IV efetivo + `delta` continua em 0..31. */
  canAdjustHyperTrainedIv(stat: StatKey, delta: number): boolean {
    const next = this.getEffectiveIv(stat) + delta;
    return next >= 0 && next <= MAX_IV;
  }

  /** Doces de Hyper Training (Health/Mighty/... Candy = +1, Sickly/Weak/... Candy = -1). */
  adjustHyperTrainedIv(stat: StatKey, delta: number): boolean {
    if (!this.canAdjustHyperTrainedIv(stat, delta)) return false;
    return this.hyperTrain(stat, this.getEffectiveIv(stat) + delta);
  }

  /** Define o IV natural (Pokemon.setIV). */
  setIv(stat: StatKey, value: number): boolean {
    value = Math.trunc(value);
    if (value < 0 || value > MAX_IV) return false;
    this.ivs[stat] = value;
    this.recalculateHealth();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Natureza e Mints

  /** Natureza efetiva (Pokemon.effectiveNature): a do Mint, se houver. */
  getEffectiveNature(): string {
    return this.mintedNature || this.nature;
  }

  /** MintItem.canUseOnPokemon: a natureza efetiva é diferente. */
  canApplyMint(nature: string): boolean {
    const resolved = resolveNature(nature);
    return !!resolved && toID(resolved) !== toID(this.getEffectiveNature());
  }

  /**
   * Aplica um Mint (MintItem): muda só a natureza efetiva dos atributos.
   * Aceita "adamant", "Adamant", "cobblemon:adamant" ou "adamant_mint".
   * @returns Falso se a natureza for desconhecida ou igual à efetiva.
   */
  applyMint(nature: string): boolean {
    const resolved = resolveNature(nature);
    if (!resolved || toID(resolved) === toID(this.getEffectiveNature())) return false;
    this.mintedNature = resolved;
    this.recalculateHealth();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Amizade

  /** config.maxPokemonFriendship (255 por padrão). */
  getMaxFriendship(): number {
    return getConfig().maxPokemonFriendship ?? 255;
  }

  /** Pokemon.setFriendship: valor absoluto limitado ao máximo. Falso se inválido. */
  setFriendship(value: number): boolean {
    const sanitized = Math.min(Math.abs(Math.trunc(value)), this.getMaxFriendship());
    if (!Number.isFinite(sanitized)) return false;
    this.friendship = sanitized;
    return true;
  }

  /**
   * Muda a amizade. Positivo = incrementFriendship do Cobblemon (amizade "conquistada": Luxury Ball ×2 e
   * Soothe Bell +50%); negativo = decrementFriendship (sem multiplicadores). Sempre fica em 0..máximo.
   * @returns Verdadeiro se o valor mudou.
   */
  addFriendship(amount: number): boolean {
    amount = Math.trunc(amount);
    if (!Number.isFinite(amount) || amount === 0) return false;
    const old = this.friendship;
    const max = this.getMaxFriendship();
    if (amount > 0) {
      // incrementFriendship: limita ao máximo antes dos multiplicadores e de novo depois.
      const sanitized = Math.min(amount, max - old);
      if (sanitized <= 0) return false;
      const boosted = boostedFriendshipGain(sanitized, this.pokeball, this.minecraftItem || this.item);
      this.friendship = Math.min(max, old + boosted);
    }
    else {
      this.friendship = Math.max(0, old + Math.max(amount, -old));
    }
    return this.friendship !== old;
  }

  // -------------------------------------------------------------------------------------------
  // Habilidades

  /** Tipo da habilidade atual no pool da forma: "common", "hidden" ou undefined (forçada/ilegal). */
  getAbilityType(): AbilityType | undefined {
    return findCurrentAbilityType(this.getAbilityPool(), this.ability, !!this.abilityForced);
  }

  hasHiddenAbility(): boolean {
    return this.getAbilityType() === "hidden";
  }

  /**
   * Pokemon.updateAbility: define a habilidade e guarda a posição dela no pool da forma (para manter
   * o "slot" na evolução). Fora do pool, fica marcada como forçada.
   */
  setAbility(ability: string, priority?: AbilityPriority) {
    this.ability = toID(ability);
    const found = findAbilityCoordinate(this.getAbilityPool(), this.ability, priority)
      ?? (priority ? findAbilityCoordinate(this.getAbilityPool(), this.ability) : undefined);
    if (found) {
      this.abilityPriority = found.priority;
      this.abilityIndex = found.index;
      this.abilityForced = false;
    }
    else {
      this.abilityPriority = undefined;
      this.abilityIndex = undefined;
      this.abilityForced = true;
    }
  }

  /** Pokemon.rollAbility: sorteia do pool (HA só com `hiddenAbilityChance`). */
  rollAbility(hiddenAbilityChance = 0) {
    const selected = selectAbility(this.getAbilityPool(), hiddenAbilityChance);
    if (!selected) return;
    this.ability = selected.ability;
    this.abilityPriority = selected.priority;
    this.abilityIndex = selected.index;
    this.abilityForced = false;
  }

  /** Completa prioridade/índice em dados antigos (sem mudar a habilidade). */
  ensureAbilityCoordinates() {
    if (this.abilityForced || !this.ability) return;
    if (this.abilityPriority !== undefined && this.abilityIndex !== undefined) return;
    this.setAbility(this.ability);
  }

  /**
   * Pokemon.attemptAbilityUpdate, chamado depois de mudar espécie/forma: mantém prioridade e índice;
   * se o índice não existir, desce até 0; sem nada compatível, sorteia de novo.
   */
  attemptAbilityUpdate() {
    if (this.abilityForced) return;
    if (!this.ability || this.abilityPriority === undefined || this.abilityIndex === undefined) {
      this.rollAbility();
      return;
    }
    const potential = resolveAbilityForSlot(this.getAbilityPool(), this.abilityPriority, this.abilityIndex);
    if (potential) {
      // Como no Cobblemon, mantém o índice e a prioridade conhecidos.
      this.ability = potential.ability;
      return;
    }
    this.rollAbility();
  }

  /** Dá a habilidade oculta da forma, se houver (propriedade `ha`, pesca/isca). */
  giveHiddenAbility(): boolean {
    const hidden = pickHiddenAbility(this.getAbilityPool());
    if (!hidden) return false;
    this.ability = hidden.ability;
    this.abilityPriority = hidden.priority;
    this.abilityIndex = hidden.index;
    this.abilityForced = false;
    return true;
  }

  private canUseAbilityChanger(changer: AbilityChanger): boolean {
    const pool = this.getAbilityPool();
    const current = findCurrentAbilityType(pool, this.ability, !!this.abilityForced);
    return canChangeFrom(changer, current) && queryPossibleAbilities(pool, changer, this.ability, !!this.abilityForced).length > 0;
  }

  private useAbilityChanger(changer: AbilityChanger): boolean {
    if (!this.canUseAbilityChanger(changer)) return false;
    const possible = queryPossibleAbilities(this.getAbilityPool(), changer, this.ability, !!this.abilityForced);
    const picked = possible[Math.floor(Math.random() * possible.length)];
    const old = this.ability;
    this.ability = picked.ability;
    this.abilityPriority = picked.priority;
    this.abilityIndex = picked.index;
    this.abilityForced = false;
    return this.ability !== old;
  }

  /** Ability Capsule (AbilityChanger.COMMON_ABILITY): pode trocar para a outra habilidade comum? */
  canUseAbilityCapsule(): boolean {
    return this.canUseAbilityChanger("capsule");
  }
  /** Ability Capsule: troca para outra habilidade comum. Falso se não houver troca possível. */
  useAbilityCapsule(): boolean {
    return this.useAbilityChanger("capsule");
  }
  /** Ability Patch (AbilityChanger.HIDDEN_ABILITY): comum → oculta, oculta → comum. */
  canUseAbilityPatch(): boolean {
    return this.canUseAbilityChanger("patch");
  }
  useAbilityPatch(): boolean {
    return this.useAbilityChanger("patch");
  }

  // -------------------------------------------------------------------------------------------
  // Golpes

  /** Golpes por nível da forma até o nível atual. */
  getLevelUpMoves(level = this.level): string[] {
    return getLevelUpMovesUpTo(this.getLearnset(), level);
  }

  /**
   * Pokemon.allAccessibleMoves (+ o moveset atual): golpes que podem ir para o moveset sem item —
   * por nível até o atual e os guardados (learnedMoves). Usado pela troca de golpes/relearner.
   */
  getAccessibleMoves(): string[] {
    return unique([...this.getLevelUpMoves(), ...this.learnedMoves, ...this.moves]);
  }

  /** Pokemon.relearnableMoves: acessíveis que não estão no moveset. */
  getRelearnableMoves(): string[] {
    return this.getAccessibleMoves().filter(move => !this.moves.includes(move));
  }

  /** Mesma lista de getAccessibleMoves (nome antigo usado pela GUI). */
  getKnownMoves(): string[] {
    return this.getAccessibleMoves();
  }

  /**
   * Golpes que a forma pode aprender agora: por nível até o atual + TM + tutor + ovo (+ troca de forma
   * e os já guardados). Para UI de relearner/TM/tutor.
   */
  getLearnableMoves(): string[] {
    const learnset = this.getLearnset();
    return unique([
      ...this.getLevelUpMoves(), ...learnset.tmMoves, ...learnset.tutorMoves, ...learnset.eggMoves,
      ...learnset.formChangeMoves, ...this.learnedMoves,
    ]);
  }

  /** Origens do golpe no learnset da forma ("level", "tm", "tutor", "egg", "legacy", "special", "form_change"). */
  getMoveSources(move: string): LearnsetSource[] {
    return getLearnsetSources(this.getLearnset(), move);
  }

  /** LearnsetQuery.ANY (padrão) ou LEGAL sobre o learnset da forma. */
  canLearnMove(move: string, query: "any" | "legal" = "any"): boolean {
    return canLearn(this.getLearnset(), toID(move), query);
  }

  /**
   * Ensina um golpe (TeachCommand / TM / tutor). Não valida o learnset (use canLearnMove antes).
   * - Com `slot` (0–3): troca o golpe do slot (o antigo vai para learnedMoves) mantendo a proporção de PP.
   * - Sem `slot`: entra no moveset se houver espaço; senão, fica guardado em learnedMoves.
   * @returns Falso se o golpe for desconhecido ou já estiver no moveset (ou já guardado, sem slot).
   */
  teachMove(move: string, slot?: number): boolean {
    move = toID(move);
    if (!isKnownMove(move) || this.moves.includes(move)) return false;
    const basePp = Dex.moves.get(move).pp;
    if (slot !== undefined) {
      if (slot < 0 || slot >= MOVE_COUNT || slot > this.moves.length) return false;
      const old = this.moves[slot];
      if (old === undefined) {
        this.moves.push(move);
        // exchangeMove: slot vazio recebe o golpe com 0 PP (evita PP infinito esquecendo/relembrando).
        this.movesInfo[this.moves.length - 1] = { ...AdditionalMoveDataManager.create(basePp), pp: 0 };
      }
      else {
        const oldInfo = this.movesInfo[slot];
        const ratio = oldInfo && oldInfo.maxPp > 0 ? oldInfo.pp / oldInfo.maxPp : 1;
        this.benchMove(old);
        this.moves[slot] = move;
        const info = AdditionalMoveDataManager.create(basePp);
        info.pp = Math.trunc(ratio * info.maxPp);
        this.movesInfo[slot] = info;
      }
      this.learnedMoves = this.learnedMoves.filter(x => x !== move);
      return true;
    }
    if (this.moves.length < MOVE_COUNT) {
      this.moves.push(move);
      this.movesInfo[this.moves.length - 1] = AdditionalMoveDataManager.create(basePp);
      this.learnedMoves = this.learnedMoves.filter(x => x !== move);
      return true;
    }
    if (this.learnedMoves.includes(move)) return false;
    this.learnedMoves.push(move);
    return true;
  }

  /** Esquece o golpe do slot (vai para learnedMoves). Não deixa o moveset vazio. */
  forgetMove(slot: number): boolean {
    if (this.moves.length <= 1 || slot < 0 || slot >= this.moves.length) return false;
    const [move] = this.moves.splice(slot, 1);
    this.movesInfo.splice(slot, 1);
    this.benchMove(move);
    return true;
  }

  private benchMove(move: string) {
    if (!this.learnedMoves.includes(move)) this.learnedMoves.push(move);
  }

  /** Remove o golpe do moveset e dos guardados (Pokemon.unlearnMove). */
  unlearnMove(move: string) {
    move = toID(move);
    const index = this.moves.indexOf(move);
    if (index !== -1) {
      this.moves.splice(index, 1);
      this.movesInfo.splice(index, 1);
    }
    this.learnedMoves = this.learnedMoves.filter(x => x !== move);
  }

  /** Estágios de PP Up do golpe no slot. */
  getPpStages(slot: number): number {
    const move = this.moves[slot];
    const info = this.movesInfo[slot];
    if (!move || !info) return 0;
    return AdditionalMoveDataManager.getStages(info, Dex.moves.get(move).pp);
  }

  /** Move.raiseMaxPP: sobe `amount` estágios (máx. 3), mantendo a proporção de PP (arredonda para cima). */
  raiseMaxPp(slot: number, amount: number): boolean {
    const move = this.moves[slot];
    if (!move || !isKnownMove(move)) return false;
    const basePp = Dex.moves.get(move).pp;
    const info = this.movesInfo[slot] ?? AdditionalMoveDataManager.create(basePp);
    const stages = AdditionalMoveDataManager.getStages(info, basePp);
    if (stages >= MAX_PP_STAGES) return false;
    const oldMax = maxPpWithStages(basePp, stages);
    const ratio = info.maxPp > 0 ? info.pp / info.maxPp : 1;
    const newStages = Math.min(MAX_PP_STAGES, stages + amount);
    const newMax = maxPpWithStages(basePp, newStages);
    this.movesInfo[slot] = { pp: Math.ceil(ratio * newMax), maxPp: newMax, extraPp: newMax - basePp, ppStages: newStages };
    return newMax !== oldMax;
  }

  /** PP Up: +1 estágio. */
  ppUp(slot: number): boolean {
    return this.raiseMaxPp(slot, 1);
  }
  /** PP Max: direto para 3 estágios. */
  ppMax(slot: number): boolean {
    return this.raiseMaxPp(slot, MAX_PP_STAGES);
  }

  /**
   * Monta o moveset com um moveset builder do Cobblemon ("wild" = últimos golpes por nível, com o
   * primeiro slot preferindo um golpe ofensivo; "alpha" = variante com TMs). Substitui os golpes atuais.
   */
  initializeMoveset(builder: string = "wild") {
    const baseStats = this.getBaseStats();
    const moves = buildMoveset(builder, {
      learnset: this.getLearnset(),
      level: this.level,
      baseAttack: baseStats.attack,
      baseSpecialAttack: baseStats.special_attack,
      types: this.getTypes(),
      random: Math.random,
    });
    this.moves = moves;
    this.movesInfo = moves.map(move => AdditionalMoveDataManager.create(Dex.moves.get(move).pp));
  }

  // -------------------------------------------------------------------------------------------
  // Marcas (scripts/pokemon/Marks.ts) e cosméticos (scripts/pokemon/CosmeticItems.ts)

  hasMark(mark: string): boolean {
    return this.marks.includes(mark);
  }
  addMark(mark: string): boolean {
    if (this.hasMark(mark)) return false;
    giveMark(this, mark);
    return true;
  }
  removeMark(mark: string): boolean {
    if (!this.hasMark(mark)) return false;
    takeMark(this, mark);
    return true;
  }
  /** Define a marca exibida (precisa estar entre as obtidas); undefined remove. */
  setActiveMark(mark?: string): boolean {
    if (mark !== undefined && !this.hasMark(mark)) return false;
    this.activeMark = mark;
    return true;
  }
  // -------------------------------------------------------------------------------------------
  // Tamanho (scripts/pokemon/Scale.ts) e fuga de mobs (scripts/pokemon/EntityInteract.ts)

  /** Pokemon.initializeScale: sorteia a escala intrínseca (Alfa = 1). */
  initializeScale() {
    this.scaleModifier = rollIntrinsicScale(getConfig(), this.aspects.includes("alpha"));
  }
  /** Pokemon.effectiveScale sem Alfa (filhote × escala intrínseca). */
  getEffectiveScale(): number {
    // O Alfa usa a escala de Alfa (grupo de tamanho próprio da entidade).
    if (this.aspects.includes("alpha")) return 1;
    return effectiveScale(this.level, this.scaleModifier, getConfig());
  }
  /** Pokemon.getSizeCategory (XS..XL). */
  getSizeCategory(): SizeCategory {
    return sizeCategoryOf(this.scaleModifier, getConfig());
  }
  /** Mobs vanilla que evitam este Pokémon (behaviour.entityInteract da forma ativa, senão da espécie). */
  getAvoidedBy(): AvoidingMob[] {
    const species = getSpeciesData(this.species);
    if (!species) return [];
    return avoidedBy(species.behaviour, getFormForAspects(species, this.aspects)?.behaviour);
  }

  /** Troca o item cosmético e devolve o anterior (Pokemon.swapCosmeticItem). */
  setCosmeticItem(item?: string): string | undefined {
    // Troca também os aspects do item (COSMETIC_SLOT_ASPECT) e o visual resolvido.
    const old = swapCosmeticItem(this, item);
    this.variant = resolveVariant(toSpeciesId(this.species), this.aspects);
    return old;
  }

  // -------------------------------------------------------------------------------------------
  // Experiência

  /** EXP necessária para o próximo nível (0 no máximo). */
  getExperienceToNextLevel(): number {
    return this.getExperienceToLevel(this.level + 1);
  }
  getExperienceToLevel(level: number): number {
    if (level <= this.level) return 0;
    return getExperienceGroup(this.getExperienceGroup()).getExperience(level) - this.experience;
  }

  /** Define o nível (setter de Pokemon.level): limita ao máximo, ajusta a EXP e mantém a proporção de HP. */
  setLevel(level: number) {
    const maxLevel = getConfig().maxPokemonLevel;
    const bounded = Math.min(maxLevel, Math.max(1, Math.trunc(level)));
    const group = getExperienceGroup(this.getExperienceGroup());
    this.level = bounded;
    if (group.getLevel(this.experience) !== bounded || bounded === maxLevel)
      this.experience = group.getExperience(bounded);
    this.recalculateHealth("ceil");
  }

  /** Adds the given experience points to the pokemon (Pokemon.addExperience / addExperienceWithPlayer).
   * - Sobe de nível (limitado a config.maxPokemonLevel), mantendo a proporção de HP;
   * - golpes novos por nível entram no moveset se houver espaço;
   * - Pokémon com dono ganha amizade por nível (tabela de Sword/Shield);
   * - tenta as evoluções passivas (level_up).
   * @param player If you provide a player, this function will handle sending them the translated messages.
   */
  gainExp(expGained: number, player?: Player): AddExperienceResult {
    const oldLevel = this.level;
    const maxLevel = getConfig().maxPokemonLevel;
    const result: AddExperienceResult = {
      oldLevel, newLevel: oldLevel, experienceAdded: 0, newMoves: [], addedMoves: [], friendshipGained: 0, evolutions: [],
    };
    expGained = Math.trunc(expGained);
    if (!(expGained >= 0) || oldLevel >= maxLevel) return result;
    const group = getExperienceGroup(this.getExperienceGroup());
    const previousMoves = this.getLevelUpMoves(oldLevel);

    this.experience += expGained;
    result.experienceAdded = expGained;
    const newLevel = Math.min(group.getLevel(this.experience), maxLevel);
    if (newLevel !== oldLevel) {
      this.level = newLevel;
      if (newLevel === maxLevel) this.experience = group.getExperience(maxLevel);
      this.recalculateHealth("ceil");
    }
    result.newLevel = this.level;

    result.newMoves = this.getLevelUpMoves(this.level).filter(move => !previousMoves.includes(move) && !this.moves.includes(move));
    for (const move of result.newMoves) {
      if (this.moves.length < MOVE_COUNT && this.teachMove(move)) result.addedMoves.push(move);
    }

    if (this.trainer && newLevel > oldLevel) {
      const before = this.friendship;
      for (let i = oldLevel; i < newLevel; i++) this.addFriendship(levelUpFriendship(this.friendship));
      result.friendshipGained = this.friendship - before;
    }

    // addExperienceWithPlayer (1.8.2): ExpGainedDataPacket para o overlay do time ("+N EXP", level-up e sons), sem
    // chat. Sem overlay visível (HUD desligado/estilo texto), as mensagens antigas no chat e só os sons.
    let shown = false;
    if (player) {
      try { shown = expGainedSink?.(player, this.uuid, oldLevel !== this.level ? oldLevel : undefined, expGained, result.newMoves.length) ?? false; }
      catch { shown = false; }
      if (!shown) {
        player.sendMessage(message.With("cobblemon.experience.gained", [this, expGained.toString()]));
        if (oldLevel < this.level) {
          player.sendMessage(message.With("cobblemon.experience.level_up", [this, this.level.toString()]));
        }
        result.newMoves.forEach(x => player.sendMessage(message.With("cobblemon.experience.learned_move", [this, getMoveTranslation(x)])));
      }
    }
    // Pokédex: subir de nível com dono registra o Pokémon como obtido (LEVEL_UP_EVENT → PokedexManager.obtain);
    // StatHandler.onLevelUp soma 1 em level_up por evento (não por nível).
    if (this.trainer && this.level > oldLevel) {
      try {
        const owner = player ?? this.tryGetOwner();
        if (owner) {
          markCaught(owner, this);
          awardStat(owner, "level_up");
        }
      } catch { }
    }
    this.getEvolutions().forEach(x => {
      if (x instanceof PassiveEvolution && x.attemptEvolution(this))
        result.evolutions.push(x.id);
    })
    // Frente visual-batalha: sons do overlay de EXP (gui.levelup_start / gui.levelup) para doces e /levelup
    // (o overlay da frente dados-ui já toca os mesmos sons quando aparece).
    if (player && !shown) playExpGainedSounds(player, result);
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Mudança de espécie/forma

  /**
   * Chamado depois de mudar `species`/`aspects` (evolução, troca de forma). Replica os setters de
   * species/form do Cobblemon: golpes de troca de forma (updateMovesOnFormChange), gênero (checkGender),
   * HP proporcional e habilidade pelo mesmo slot (attemptAbilityUpdate).
   * @param previousForm Forma anterior (getFormData() antes da mudança).
   */
  onFormChanged(previousForm: FormData | undefined, previousSpecies?: string) {
    const newForm = this.getFormData();
    const speciesChanged = previousSpecies !== undefined && toSpeciesId(previousSpecies) !== toSpeciesId(this.species);
    if (!speciesChanged && previousForm === newForm) return;
    const oldSpecies = previousSpecies ?? this.species;
    const oldLearnset = getLearnset(oldSpecies, previousForm);
    const newLearnset = this.getLearnset();

    // Golpes da forma antiga que só existiam por causa dela saem do moveset.
    for (let i = this.moves.length - 1; i >= 0; i--) {
      if (oldLearnset.formChangeMoves.includes(this.moves[i])) {
        this.moves.splice(i, 1);
        this.movesInfo.splice(i, 1);
      }
    }
    // Guardados que a forma nova não aprende são descartados (LearnsetQuery.ANY).
    this.learnedMoves = this.learnedMoves.filter(move => canLearn(newLearnset, move));
    for (const move of newLearnset.formChangeMoves) {
      if (this.moves.includes(move)) continue;
      if (this.moves.length < MOVE_COUNT) {
        this.moves.push(move);
        this.movesInfo[this.moves.length - 1] = AdditionalMoveDataManager.create(Dex.moves.get(move).pp);
      }
      else this.benchMove(move);
    }
    if (this.moves.length === 0) {
      const benched = this.learnedMoves.shift() ?? getLevelUpMovesUpTo(newLearnset, this.level).pop();
      if (benched) {
        this.moves.push(benched);
        this.movesInfo = [AdditionalMoveDataManager.create(Dex.moves.get(benched).pp)];
      }
    }
    this.movesInfo.length = this.moves.length;

    this.checkGender();
    this.recalculateHealth();
    this.attemptAbilityUpdate();
  }

  /** Pokemon.checkGender: corrige o gênero se a forma nova não o permitir. */
  checkGender() {
    const ratio = this.getMaleRatio();
    const genderless = !(ratio >= 0 && ratio <= 1);
    let reassess = false;
    if (genderless && this.gender !== "") reassess = true;
    else if (ratio === 0 && this.gender !== "f") reassess = true;
    else if (ratio === 1 && this.gender !== "m") reassess = true;
    else if (!genderless && this.gender === "") reassess = true;
    if (!reassess) return;
    this.gender = genderless ? "" : (ratio === 1 || Math.random() <= ratio) ? "m" : "f";
    this.aspects = this.aspects.filter(aspect => aspect !== "male" && aspect !== "female");
    if (this.gender === "m") this.aspects.push("male");
    if (this.gender === "f") this.aspects.push("female");
  }

  /** Everstone impede evoluir (o Cobblemon esconde o botão de evoluir). */
  isEvolutionBlocked(): boolean {
    return normalizeItemId(this.minecraftItem || this.item) === "everstone";
  }

  /** CHARACTERISTIC_RAINBOW_ASPECT: só formas com `behaviour.characteristicRainbow` (Smeargle). */
  updateRainbowAspect() {
    let rainbow = false;
    try {
      const behaviour = (this.getFormData() as { behaviour?: { characteristicRainbow?: boolean } } | undefined)?.behaviour
        ?? (this.getSpeciesData() as unknown as { behaviour?: { characteristicRainbow?: boolean } }).behaviour;
      rainbow = behaviour?.characteristicRainbow === true;
    } catch { }
    const kept = this.aspects.filter(aspect => !aspect.startsWith(RAINBOW_PREFIX));
    if (!rainbow) {
      if (kept.length !== this.aspects.length) this.aspects = kept;
      return;
    }
    // `pokemon.nature` (a natureza original; a de Mint não muda a cor).
    const plus = (Dex.natures.get(this.nature).plus ?? null) as StatKey | null;
    const aspect = rainbowAspect(plus, characteristicOf(this.ivs, this.uuid).stat);
    this.aspects = aspect ? [...kept, aspect] : kept;
  }

  /**
   * Rótulo acima da entidade (PokemonRenderer.renderNameTag): nome (apelido ou espécie) e " Lv. N", conforme
   * `displayEntityNameLabel`/`displayEntityLevelLabel`. `hideName` troca o nome por "???" (displayNameForUnknownPokemon,
   * decidido por scripts/pokemon/ProximityEffects.ts para o jogador mais perto). Vazio = sem rótulo.
   */
  getEntityLabel(hideName = false): string {
    const config = getConfig();
    const parts: string[] = [];
    if (config.displayEntityNameLabel !== false) {
      let species = this.species;
      try { species = this.getSpeciesData().name || this.species; } catch { }
      parts.push(hideName ? "???" : (this.name || species));
    }
    if (config.displayEntityLevelLabel !== false && this.level > 0) parts.push(`Lv. ${this.level}`);
    return parts.join(" ");
  }

  applyToCobblemon(entity: Entity) {
    let pokemonName = isValidCobblemon(entity);
    let speciesData = this.getSpeciesData();
    if (!pokemonName) throw new Error("Couldn't apply data to invalid pokemon");
    if (this.currentHealth < 1) {
      entity.kill();
      return;
    }

    let tryGetOwner = this.tryGetOwner();
    if (entity.typeId !== this.getEntityId() && tryGetOwner) {
      let location = Object.assign({ dimension: entity.dimension }, entity.location);
      // Sem a tag do UUID, o sendOut abaixo não reaproveita a entidade velha (ainda válida neste tick).
      if (this.uuid) entity.removeTag(this.uuid);
      entity.triggerEvent("cobblemon:instant_kill");
      entity = this.sendOut(tryGetOwner, location);
    }

    // Cauda do Smeargle pela Characteristic (behaviour.characteristicRainbow).
    this.updateRainbowAspect();
    entity.setDynamicProperty("data", JSON.stringify(this));
    this.variant = resolveVariant(toSpeciesId(this.species), this.aspects);
    entity.setProperty("cobblemon:variant", this.variant);
    syncAspectBits(entity, this.aspects); // frente dados-ia: q.has_aspect dos posers no cliente
    entity.nameTag = this.getEntityLabel();
    if (this.uuid && !entity.hasTag(this.uuid))
      entity.addTag(this.uuid);
    // Marca de shiny para o brilho por proximidade (scripts/pokemon/ProximityEffects.ts) sem ler os dados.
    if (this.shiny) { if (!entity.hasTag(SHINY_TAG)) entity.addTag(SHINY_TAG); }
    else if (entity.hasTag(SHINY_TAG)) entity.removeTag(SHINY_TAG);
    entity.setDynamicProperty("uuid", this.uuid);
    // Sem item segurado o espaço 0 fica vazio: senão um item já consumido (berry etc.) voltaria a ser lido
    // pelo loadFromCobblemon (duplicação).
    const heldSlot = entity.getComponent("inventory")?.container?.getSlot(0);
    if (this.minecraftItem)
      heldSlot?.setItem(new ItemStack(this.minecraftItem));
    else
      heldSlot?.setItem(undefined);
    for (const [key, value] of Object.entries(this.entityStates)) {
      // Propriedade salva que a entidade atual não declara (setProperty lançaria erro).
      if (entity.getProperty(key) === undefined) continue;
      entity.setProperty(key, value);
    }
    // Alfa continua grande ao sair da bola (o grupo de escala vem do evento cobblemon:set_alpha).
    if (this.aspects.includes("alpha")) {
      if (entity.getProperty("cobblemon:alpha") === false) entity.triggerEvent("cobblemon:set_alpha");
      if (!entity.hasTag("cobblemon_alpha")) entity.addTag("cobblemon_alpha");
    }
    // Tamanho da forma ativa/Alfa no mesmo tick (o loop de 1 s de scripts/entity também corrige).
    try { applyEntitySize(entity, this); } catch { }
    // Escala intrínseca/filhote (só se o entity JSON declarar cobblemon:scale_modifier) e as tags lidas pelos
    // mobs vanilla sobrescritos (behaviour.entityInteract: creeper, esqueletos, raposa e phantom fogem).
    applyScaleProperty(entity, this.getEffectiveScale());
    applyAvoidTags(entity, this.getAvoidedBy());
    // Frente msd-fase1: forma/gimmick de batalha só na entidade (sem provedor, sem o Mega Showdown, não faz nada).
    applyDisplayOverride(entity, this);
    // Clone de batalha (cloneParties/setLevel): não interage nem é capturado (scripts/main.ts).
    if (this.battleClone && !entity.hasTag(BATTLE_CLONE_TAG)) entity.addTag(BATTLE_CLONE_TAG);
    entity.setProperty("cobblemon:initialized", true);
    if (entity.hasTag("needsServerSetup"))
      entity.removeTag("needsServerSetup");
  }

  updatePokemonInTeam(owner?: Player) {
    owner ??= this.tryGetOwner();
    if (!owner)
      throw new Error("Invalid owner");
    let team = getSafeTeam(owner);
    if (!this.uuid)
      throw new Error("Search Failed, this pokemon does not have a uuid.");
    let indexOfMember = team.findIndex(x => (x?.uuid === this.uuid));
    if (indexOfMember === -1)
      throw new Error("The Pokemon was not in the Party");
    team[indexOfMember] = this;
    owner.setDynamicProperty("team", JSON.stringify(team));
  }

  tryUpdatePokemonInTeam(owner?: Player): boolean {
    try {
      this.updatePokemonInTeam(owner);
      return true;
    }
    catch (e) {
      return false;
    }
  }
  /** Finds the pokemon sent out and updates its data */
  tryUpdatePokemonOut() {
    getAllDimensions().forEach(dimension => {
      let searchArray = dimension.getEntities({ tags: [this.uuid] });
      searchArray.forEach(x => {
        this.applyToCobblemon(x);
      });
    });
  }

  /**
   * Lê um Pokémon salvo (time, PC, entidade). Dados antigos continuam válidos: campos novos recebem
   * padrão (amizade = base da forma, IVs de Hyper Training vazios, marcas vazias, PP por golpe).
   */
  static getFromJson(json: string | object): PokemonData {
    const raw = (typeof json == "string" ? JSON.parse(json) : json) as Record<string, unknown>;
    let output: PokemonData = Object.assign(new PokemonData(), raw);
    // Dados sem aspects (salvos antes deles existirem): reconstrói a partir de shiny e gênero.
    if (!Array.isArray(raw.aspects)) output.aspects = [
      ...(output.shiny ? ["shiny"] : []),
      ...(output.gender === "m" ? ["male"] : output.gender === "f" ? ["female"] : []),
    ];
    if (!Array.isArray(output.moves)) output.moves = [];
    if (!Array.isArray(output.movesInfo)) output.movesInfo = [];
    if (!Array.isArray(output.learnedMoves)) output.learnedMoves = [];
    if (!Array.isArray(output.marks)) output.marks = [];
    if (!output.hyperTrainedIvs || typeof output.hyperTrainedIvs !== "object") output.hyperTrainedIvs = {};
    if (!output.evs) output.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    if (!output.ivs) output.ivs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    // Golpe sem informação de PP (saves antigos): PP cheio.
    output.moves.forEach((move, i) => {
      if (!output.movesInfo[i]) {
        const data = Dex.moves.get(move);
        output.movesInfo[i] = AdditionalMoveDataManager.create(data.exists ? data.pp : 1);
      }
    });
    const hasSpecies = !!getSpeciesData(output.species);
    // Amizade: saves antigos usam "happiness" (o setter já copiou); sem nenhum dos dois, a base da forma.
    if (raw.friendship === undefined && raw.happiness === undefined)
      output.friendship = hasSpecies ? output.getBaseFriendship() : 0;
    if (typeof output.friendship !== "number" || !Number.isFinite(output.friendship)) output.friendship = 0;
    //Old data upgrade
    if (hasSpecies && output.level > 1 && output.experience == 0)
      output.experience = getExperienceGroup(output.getExperienceGroup()).getExperience(output.level);
    if (hasSpecies) output.ensureAbilityCoordinates();
    return output;
  }

  static getFromEntity(entity: Entity): PokemonData {
    let pokemonName = isValidCobblemon(entity);
    if (!pokemonName) throw new Error("Couldn't get data from invalid pokemon");
    let output = new PokemonData()
    output.loadFromCobblemon(entity);
    return output;
  }

  static tryGetFromEntity(entity: Entity): PokemonData | undefined {
    try {
      return PokemonData.getFromEntity(entity);
    }
    catch {
      return undefined;
    }
  }

  /** Retrieves the species data of this pokemon
   * @throws if the species data could not be found.
   */
  getSpeciesData(): SpeciesData {
    let speciesData = getSpeciesData(this.species);
    if (speciesData == undefined)
      throw new Error(`Could not get the species data of ${this.species}`);
    return speciesData;
  }
  /** Atributos atuais: base da forma, IVs efetivos (Hyper Training), EVs e natureza efetiva (Mint). */
  getCurrentStats(): StatsTable {
    const output = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const nature = Dex.natures.get(this.getEffectiveNature());
    for (const [cobblemonStat, base] of Object.entries(this.getBaseStats())) {
      const stat = COBBLEMON_TO_SHOWDOWN_STAT[cobblemonStat];
      if (!stat) continue;
      const core = Math.floor(0.01 * (2 * base + this.getEffectiveIv(stat) + Math.floor(0.25 * (this.evs[stat] ?? 0))) * this.level);
      if (stat === "hp") {
        output.hp = toSpeciesId(this.species) === "shedinja" ? 1 : core + this.level + 10;
      }
      else {
        const natureMultiplier = nature.exists ? (nature.plus === stat ? 1.1 : nature.minus === stat ? 0.9 : 1) : 1;
        output[stat] = Math.floor((core + 5) * natureMultiplier);
      }
    }
    return output;
  }

  /**
   * Set no formato do Showdown para iniciar batalhas. Mantém os campos extras (uuid, HP, PP,
   * status) que o adaptador em showdown.ts aplica ao Pokémon. Natureza e IVs são os efetivos.
   */
  toShowdownSet(): PokemonSet {
    return {
      ...this,
      species: this.getShowdownSpecies(),
      // Id do Showdown pela regra do CobblemonHeldItemManager (charcoal_stick → charcoal, medicinal_leek → leek...).
      item: showdownItemOf(this),
      gender: this.gender.toUpperCase(),
      nature: this.getEffectiveNature(),
      ivs: this.getEffectiveIvs(),
      happiness: this.friendship,
    } as PokemonSet;
  }

  /** Nome da espécie no Showdown, incluindo a forma (ex.: "Raichu-Alola"). */
  getShowdownSpecies(): string {
    const speciesData = this.getSpeciesData();
    const form = this.getFormData();
    const name = form ? `${speciesData.name}-${form.name}` : speciesData.name;
    const species = Dex.species.get(name);
    return species.exists ? species.name : speciesData.name;
  }

  /** Identificador da entidade Bedrock desta espécie (ex.: cobblemon:pikachu). */
  getEntityId(): string {
    return `cobblemon:${toSpeciesId(this.species)}`;
  }

  /** Returns the pokemon Evolutions initialized properly as classes (da forma ativa). */
  getEvolutions(): Evolution[] {
    return initializeEvolutions(this.getEvolutionEntries());
  }

  /** For creating new PokemonData for wild pokemon */
  static generateNewWildPokemon(species: string, options: WildPokemonOptions = {}): PokemonData {
    let pokemonData = getSpeciesData(species);
    if (!pokemonData) throw new Error(`Could not create cobblemon ${species}: No Data Found`);

    let output = new PokemonData();
    //Species & UUID
    output.species = toSpeciesId(species);
    output.uuid = UUID.generate();
    // Aspectos de forma primeiro: a forma decide gênero, habilidades, golpes e atributos.
    output.aspects = [...(options.aspects ?? [])];

    //Level
    const level = options.level ?? getRandomIntBetween(DEFAULT_WILD_LEVELS.min, DEFAULT_WILD_LEVELS.max);
    output.level = Math.min(getConfig().maxPokemonLevel, Math.max(1, level));
    output.experience = getExperienceGroup(output.getExperienceGroup()).getExperience(output.level);

    //Gender & Shiny (maleRatio -1 = sem gênero)
    output.shiny = options.shiny ?? rollShiny(getConfig().shinyRate);
    const maleRatio = output.getMaleRatio();
    if (maleRatio >= 0 && maleRatio <= 1)
      output.gender = (maleRatio === 1 || Math.random() < maleRatio) ? "m" : "f";
    output.aspects = [
      ...(output.shiny ? ["shiny"] : []),
      ...(output.gender === "m" ? ["male"] : output.gender === "f" ? ["female"] : []),
      ...output.aspects,
    ];
    // Escolhas ponderadas da espécie (segmentos do Dudunsparce, família do Maushold).
    ensureWeightedFeatureAspects(output);
    output.variant = resolveVariant(output.species, output.aspects);
    // PokemonProperties.create → initializeScale (tamanho intrínseco; Alfa fica em 1).
    output.initializeScale();

    //Ability (a oculta nunca sai no sorteio padrão do Cobblemon 1.8.2)
    if (!(options.hiddenAbility && output.giveHiddenAbility()))
      output.rollAbility(options.hiddenAbilityChance ?? 0);

    //Moves (moveset builder "wild" do Cobblemon: últimos golpes por nível)
    output.initializeMoveset(options.movesetBuilder ?? "wild");

    //Nature & Friendship
    output.nature = getRandomElementIn(Dex.natures.all())!.name
    output.friendship = output.getBaseFriendship();

    //IVs
    output.ivs = {
      hp: getRandomIntBetween(0, 31),
      atk: getRandomIntBetween(0, 31),
      def: getRandomIntBetween(0, 31),
      spa: getRandomIntBetween(0, 31),
      spd: getRandomIntBetween(0, 31),
      spe: getRandomIntBetween(0, 31)
    }
    // IVs.createRandomIVs(minPerfectIVs): atributos sorteados ficam com 31.
    const perfect = Math.min(STAT_KEYS.length, Math.max(0, options.minPerfectIvs ?? 0));
    const remaining = [...STAT_KEYS];
    for (let i = 0; i < perfect; i++) {
      const stat = remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0];
      output.ivs[stat] = MAX_IV;
    }
    output.updateMaxHP();
    output.currentHealth = output.maxHealth;
    // PokemonProperties.roll: Tera Type (só dado; o Cobblemon 1.8.2 não terastaliza).
    output.teraType = rollTeraType(output.getTypes(), getConfig().teraTypeRate);

    return output;
  }
  /** Reads the data of the provided entity and syncs it to this object.
   * @throws errors
   */
  loadFromCobblemon(entity: Entity) {
    let pokemonName = isValidCobblemon(entity);
    let initialized = entity.getProperty("cobblemon:initialized");
    if (!pokemonName || !initialized) throw new Error("Couldn't load data from invalid pokemon");
    let jsonData = entity.getDynamicProperty("data");
    if (!jsonData || !(typeof jsonData == "string")) throw new Error("Recieved pokemon data was invalid!");
    Object.assign(this, PokemonData.getFromJson(jsonData));
    let heldItem = entity.getComponent("inventory")!.container!.getItem(0);
    if (heldItem === undefined) {
      this.item = "";
      this.minecraftItem = undefined;
    }
    else {
      this.item = toID(removeNamespace(heldItem.typeId));
      this.minecraftItem = heldItem.typeId;
    }
    this.entityStates = Object.fromEntries(
      validSaveEntityProperties.map(x => [x, entity.getProperty(x)]).filter(x => x[1] != null)
    );
  }

  /** Spawns pokemon.
   * This pokemon will be set to not wild, and will only have an owner if specified.
   * @throws if neither an owner nor location is specified.
   */
  sendOut(owner?: Player, location?: DimensionLocation): Entity {
    if (!owner && this.trainer)
      owner = this.tryGetOwner();

    if (location === undefined && owner) {
      let lookingAtBlock = owner.getBlockFromViewDirection({ maxDistance: 10 })?.block;
      if (lookingAtBlock == undefined || !lookingAtBlock.above(1)?.isAir || !lookingAtBlock.above(2)?.isAir) {
        location = Object.assign({ dimension: owner.dimension }, owner.location);
      }
      else {
        location = { x: lookingAtBlock.x, y: lookingAtBlock.y + 1, z: lookingAtBlock.z, dimension: owner.dimension };
      }
    }

    let tryGet = this.tryGetPokemonOut();
    if (tryGet)
      return tryGet;

    if (!location)
      throw new Error("Could not guess a location to spawn " + this.getName())

    let pokemon = location.dimension.spawnEntity(this.getEntityId(), location);

    if (owner) {
      //Tames Pokemon to Player
      pokemon.getComponent("minecraft:tameable")?.tame(owner);
      if (this.trainer != owner.id) {
        this.trainer = owner.id;
        this.tryUpdatePokemonOut();
        this.tryUpdatePokemonInTeam(owner);
      }
      pokemon.setDynamicProperty("owner_name", owner.name);
    }

    pokemon.tryTeleport(location, { facingLocation: owner?.location, checkForBlocks: true });
    this.applyToCobblemon(pokemon);
    pokemon.setProperty("cobblemon:wild", false);
    pokemon.triggerEvent("cobblemon:set_owned");
    // Shiny: som próprio e o anel de brilho (PokemonClientDelegate / Pokemon.sendOut → shiny_ring).
    if (this.shiny) {
      location.dimension.playSound("cobblemon.poke_ball.shiny_send_out", location, { volume: 0.6 });
      playShinyRing(pokemon);
    }
    else location.dimension.playSound("cobblemon.poke_ball.send_out", location);
    return pokemon;
  }

  /** Returns a pokemon back to the player.
   * Will do nothing if no pokemon is out in the current dimension.
   */
  return(owner: Player) {
    owner.dimension.getEntities({ families: ["pokemon"], tags: [this.uuid] }).forEach(x => {
      x.dimension.playSound("cobblemon.poke_ball.recall", x.location);
      // Tira a tag do UUID antes: a entidade só some no tick seguinte, e o tryGetPokemonOut() do mesmo tick
      // (ex.: menu do time redesenhado logo após "Recolher") não pode mais achá-la.
      try { x.removeTag(this.uuid); } catch { }
      x.triggerEvent("cobblemon:instant_kill");
    });
  }
  /** Searches for that entity and returns its handle. */
  tryGetPokemonOut(): Entity | undefined {
    for (const dimension of getAllDimensions()) {
      let searchArray = dimension.getEntities({ tags: [this.uuid], families: ["pokemon"] });
      if (searchArray.length > 0)
        return searchArray[0];
    };
    return undefined;
  }
  /** Searches for the pokemon's owner
   * @param pokemonEntity Entity to use to search, or will use tryGetPokemonOut() if not provided.
  */
  tryGetOwner(pokemonEntity?: Entity): Player | undefined {
    if (!this.trainer)
      return undefined;
    try {
      return world.getEntity(this.trainer!) as Player
    } catch { }
    //Fallback: Mostly for legacy reasons.
    pokemonEntity = pokemonEntity || this.tryGetPokemonOut();
    return pokemonEntity?.getComponent("tameable")?.tamedToPlayer;
  }

  /** Returns the minecraft item that the pokemon is holding, or undefined if nothing. */
  getHeldItem() {
    if (!this.minecraftItem)
      return undefined;
    return new ItemStack(this.minecraftItem, 1);
  }
}
/**
 * PokemonProperties.roll (teraType): com chance 1/`teraTypeRate`, um tipo elemental aleatório que o Pokémon não tem;
 * senão um dos tipos dele. Nome no formato do Showdown ("Fire").
 */
/**
 * Destino do "EXP ganha" (ExpGainedDataPacket → overlay do time; ligado por scripts/GUI/PartyHud.ts). Devolve true se
 * o jogador viu no overlay.
 */
export type ExpGainedSink = (player: Player, uuid: string, oldLevel: number | undefined, expGained: number, movesLearned: number) => boolean;
let expGainedSink: ExpGainedSink | undefined;
export function setExpGainedSink(sink: ExpGainedSink | undefined) {
  expGainedSink = sink;
}

export function rollTeraType(types: readonly string[], teraTypeRate: number, random: () => number = Math.random): string {
  const all = Object.values(ElementalType) as string[];
  const own = types.length > 0 ? types : [ElementalType.Normal];
  let picked: string;
  if (teraTypeRate > 0 && random() < 1 / teraTypeRate) {
    const others = all.filter(type => !own.includes(type));
    picked = (others.length ? others : all)[Math.floor(random() * (others.length ? others.length : all.length))];
  }
  else picked = own[Math.floor(random() * own.length)];
  return picked.charAt(0).toUpperCase() + picked.slice(1);
}

/** Tag das entidades de Pokémon shiny. */
export const SHINY_TAG = "cobblemon_shiny";

/** Anel de brilho ao soltar um shiny (partícula `cobblemon:shiny_ring` + `particle.shiny_chime`). */
export function playShinyRing(entity: Entity) {
  try {
    const at = { x: entity.location.x, y: entity.location.y + 0.5, z: entity.location.z };
    entity.dimension.spawnParticle("cobblemon:shiny_ring", at);
    entity.dimension.playSound("cobblemon.particle.shiny_chime", at);
  }
  catch { /* partícula/som ausente */ }
}

/** If the cobblemon is valid: the name of the cobblemon is returned. */
export function isValidCobblemon(entity: Entity): string | undefined {
  let nameArray = entity.typeId.split(":");
  if (!entity.isValid || nameArray.length !== 2 || nameArray[0] !== "cobblemon") {
    return undefined
  }
  return nameArray[1];
}
/** @throws errors */
export function catchPokemon(pokemon: Entity, player: Player) {
  let pokemonName = isValidCobblemon(pokemon);
  if (!pokemonName) throw new Error("The Pokemon was Invalid and Could not be caught.");
  let pokemonDataJson = pokemon.getDynamicProperty("data");
  if (!pokemonDataJson || typeof pokemonDataJson != "string") throw new Error("The pokemon's data was invalid and could not be caught!");
  storePokemonInFirstSpace(pokemonDataJson, player);
}

/**
 * Nome Showdown da natureza a partir de "adamant", "Adamant", "cobblemon:adamant" ou "adamant_mint".
 * Undefined se desconhecida.
 */
export function resolveNature(nature: string): string | undefined {
  const id = toID(nature.replace(/^[a-z0-9_.-]+:/i, "").replace(/_?mint$/i, ""));
  const data = Dex.natures.get(id);
  return data.exists ? data.name : undefined;
}

//Random Utility Functions:
function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isStatsTable(obj: any): obj is StatsTable {
  return (
    typeof obj === 'object' &&
    'hp' in obj &&
    'atk' in obj &&
    'def' in obj &&
    'spa' in obj &&
    'spd' in obj &&
    'spe' in obj
  );
}

function getRandomElementIn<K>(array: ReadonlyArray<K>): K | undefined {
  if (array.length < 1) return undefined;
  return array[Math.floor(Math.random() * array.length)]
}

export function getRandomIntBetween(min: number, max: number): number {
  // Generate a random number between [start, end]
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
