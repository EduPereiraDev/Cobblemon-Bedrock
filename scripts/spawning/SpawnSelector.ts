/**
 * Seleção de spawns do Cobblemon 1.8.2, sem tocar no mundo: dado um conjunto de posições já
 * calculadas (SpawnContext), escolhe as ações de spawn.
 *
 * Porta de `selection/FlatSpawnablePositionWeightedSelector.kt` + `SpawningSelector.select` +
 * `Spawner.chooseBucket` + `PokemonSpawnDetail`/`PokemonHerdSpawnDetail` (createSpawnAction/onSelection):
 *
 * 1. A cada ação, sorteia o bucket pelos pesos da config (só buckets que existem no pool), a menos que
 *    um herd tenha fixado o bucket (`guaranteedBucket`). Bucket sem candidatos encerra o passe
 *    (o Cobblemon NÃO re-sorteia entre os buckets disponíveis).
 * 2. Sorteia o tipo de posição com peso `spawnablePositionTypeWeights[tipo] × nº de entradas possíveis`.
 * 3. Sorteia a entrada pelo maior peso dela entre as posições (peso × weightMultipliers × influências)
 *    e depois a posição pelo peso nela.
 * 4. Entrada normal: remove posições a menos de `minimumDistanceBetweenEntities`.
 *    Herd: remove todas as outras entradas, fixa o bucket, remove posições a menos de
 *    `minDistanceBetweenSpawns` e continua escolhendo membros até `maxHerdSize` / `maxTimes`.
 *
 * Desvio consciente: posições/entradas removidas valem para todos os buckets do passe (no Cobblemon
 * um bucket calculado depois ainda vê posições já ocupadas).
 */
import type { Entity } from "@minecraft/server";
import { BEST_SPAWNER_CONFIG, HerdMember, SPAWNS, SpawnDrops, SpawnEntry } from "../../generated/scripts/spawns";
import type { PokemonData } from "../Pokemon";
import { getFormForAspects, getSpeciesData } from "../speciesData";
import { baseWeight, entryAllowed, SpawnContext } from "./SpawnConditions";

/** Uma decisão de spawn: o que spawnar, onde e com qual faixa de nível. */
export interface SpawnAction {
  entry: SpawnEntry;
  ctx: SpawnContext;
  bucket: string;
  species: string;
  aspects: string[];
  alpha: boolean;
  heldItem?: string;
  drops?: SpawnDrops;
  /** Faixa do nível; o nível final é sorteado nela ao criar o Pokémon (PokemonSpawnAction.createEntity). */
  levelRange: [number, number];
  /** Membro do herd que gerou esta ação. */
  herdMember?: HerdMember;
  /** Grupo do herd (mesmo valor para todos os membros do mesmo passe). */
  herdGroup?: string;
  /** Ação vazia (EmptySpawnAction): o herd escolheu um membro que não cabe na posição. */
  empty?: boolean;
}

/**
 * Influência de spawn (SpawningInfluence.kt). Usada por isca, Poké Snack, incenso, mel, Lure etc.
 * Todos os métodos são opcionais.
 */
export interface SpawnInfluence {
  /** Ajusta os pesos dos buckets (ex.: normalização por Lure). */
  affectBucketWeights?(weights: Record<string, number>): void;
  /** Falso bloqueia a entrada nesta posição. */
  affectSpawnable?(entry: SpawnEntry, ctx: SpawnContext): boolean;
  /** Peso efetivo depois dos weightMultipliers. */
  affectWeight?(entry: SpawnEntry, ctx: SpawnContext, weight: number): number;
  /** Mexe na ação antes de criar o Pokémon (ex.: faixa de nível). */
  affectAction?(action: SpawnAction): void;
  /** Mexe no Pokémon gerado antes da entidade existir (shiny, natureza, IVs, alpha...). */
  affectPokemon?(action: SpawnAction, pokemon: PokemonData): void;
  /** Depois da entidade criada. */
  affectEntity?(action: SpawnAction, entity: Entity): void;
  /**
   * Spawns extras para o bucket nesta posição (SpawningInfluence.injectSpawns: blocos de habitat). Passam pelos
   * mesmos filtros das entradas normais (condições, affectSpawnable, espaço).
   */
  injectSpawns?(bucket: string, ctx: SpawnContext): SpawnEntry[] | undefined;
}

export interface SelectOptions {
  /** Pesos dos buckets (worldBuckets, fishingBuckets, pokeSnackBuckets...). */
  buckets: Record<string, number>;
  /** Pesos por tipo de posição (padrão: best-spawner-config). */
  positionTypeWeights?: Record<string, number>;
  /** Máximo de ações no passe (config maximumSpawnsPerPass). Padrão 1. */
  maxSpawns?: number;
  /** config.minimumDistanceBetweenEntities. Padrão 8. */
  minDistanceBetweenEntities?: number;
  influences?: SpawnInfluence[];
  /** Restringe as entradas candidatas (ex.: só uma espécie, só herds). */
  filter?: (entry: SpawnEntry) => boolean;
  /** Fonte das entradas por posição (padrão: SPAWNS indexado por bioma). */
  entriesFor?: (ctx: SpawnContext) => SpawnEntry[];
  /** Buckets existentes no pool (padrão: os que aparecem em SPAWNS). */
  poolBuckets?: Iterable<string>;
  /** Fonte de aleatoriedade (testes). */
  random?: () => number;
}

// ---------------------------------------------------------------------------------------------
// Índice das entradas

let biomeIndex: Map<string, SpawnEntry[]> | undefined;
let anyBiome: SpawnEntry[] = [];
let allBuckets: Set<string> | undefined;

function buildIndex() {
  biomeIndex = new Map();
  anyBiome = [];
  allBuckets = new Set();
  for (const entry of SPAWNS) {
    allBuckets.add(entry.bucket);
    const biomes = entry.condition.biomes;
    if (!biomes || biomes.length === 0) {
      anyBiome.push(entry);
      continue;
    }
    for (const b of biomes) {
      let list = biomeIndex.get(b);
      if (!list) biomeIndex.set(b, list = []);
      list.push(entry);
    }
  }
}

/** Entradas que podem valer no bioma (índice feito na primeira chamada, não no carregamento). */
export function entriesForBiome(biome: string): SpawnEntry[] {
  if (!biomeIndex) buildIndex();
  const list = biomeIndex!.get(biome);
  return list ? (anyBiome.length ? list.concat(anyBiome) : list) : anyBiome;
}

/** Buckets presentes no pool de spawns do mundo. */
export function poolBuckets(): Set<string> {
  if (!allBuckets) buildIndex();
  return allBuckets!;
}

// ---------------------------------------------------------------------------------------------
// Utilidades

export function randomIntIn(min: number, max: number, random: () => number = Math.random): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(random() * (hi - lo + 1));
}

/** weightedSelection do Cobblemon: undefined se não houver peso positivo. */
export function weightedPick<T>(items: readonly T[], weightOf: (item: T) => number, random: () => number = Math.random): T | undefined {
  let total = 0;
  const weights = items.map(item => {
    const w = weightOf(item);
    const safe = w > 0 && Number.isFinite(w) ? w : 0;
    total += safe;
    return safe;
  });
  if (total <= 0) return undefined;
  let roll = random() * total;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
  return undefined;
}

function distance(a: SpawnContext, b: SpawnContext): number {
  const dx = a.location.x - b.location.x, dy = a.location.y - b.location.y, dz = a.location.z - b.location.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const sizeCache = new Map<string, { width: number; height: number }>();

/** Largura e altura em blocos (ceil(hitbox × baseScale)) da forma — width/height do PokemonSpawnDetail.autoLabel. */
export function spawnSizeOf(species: string, aspects: readonly string[]): { width: number; height: number } {
  const key = `${species}|${aspects.join(",")}`;
  let size = sizeCache.get(key);
  if (size === undefined) {
    const data = getSpeciesData(species);
    const form = data ? getFormForAspects(data, aspects) : undefined;
    const hitbox = form?.hitbox ?? data?.hitbox;
    const scale = form?.baseScale ?? data?.baseScale ?? 1;
    size = hitbox ? { width: Math.ceil(hitbox.width * scale), height: Math.ceil(hitbox.height * scale) } : { width: 1, height: 1 };
    sizeCache.set(key, size);
  }
  return size;
}

/** Altura em blocos (ceil(hitbox.height × baseScale)) da forma. */
export function spawnHeightOf(species: string, aspects: readonly string[]): number {
  return spawnSizeOf(species, aspects).height;
}

/**
 * Caixa que AreaSpawnablePosition.hasSpace examina (x/z: [min, max) ; y: [min, max]) para uma posição cujo
 * bloco base está em (x, y, z). Mesmas contas do Cobblemon 1.8.2 (inclusive a assimetria de +1 no máximo).
 */
export function hasSpaceBox(x: number, y: number, z: number, width: number, height: number) {
  const sizeX = width > 0 ? width : 1;
  const sizeY = height > 0 ? height : 1;
  return {
    minX: Math.floor(x + 0.5 - (sizeX - 1) / 2) - 1,
    maxX: Math.ceil(x + 0.5 + (sizeX + 1) / 2) + 1,
    minY: y + 1,
    maxY: Math.ceil(y + (sizeY + 1) / 2) + 1,
    minZ: Math.floor(z + 0.5 - (sizeX - 1) / 2) - 1,
    maxZ: Math.ceil(z + 0.5 + (sizeX + 1) / 2) + 1,
  };
}

/**
 * AreaSpawnablePosition.postFilter: com largura ou altura > 1, exige a caixa livre de hasSpace (largura do
 * hitbox nas laterais). Sem `ctx.hasSpace` (posições montadas à mão) confere só a coluna.
 */
function fitsAt(species: string, aspects: readonly string[], ctx: SpawnContext): boolean {
  const { width, height } = spawnSizeOf(species, aspects);
  if (width <= 1 && height <= 1) return true;
  if (ctx.hasSpace) return ctx.hasSpace(width, height);
  if (ctx.height === undefined) return true;
  return height <= 1 || ctx.height >= height;
}

/** Normaliza pesos de bucket para somar 100 (SpawningInfluence.normalizeBucketWeights). */
export function normalizeBucketWeights(weights: Record<string, number>) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum <= 0) return;
  for (const key of Object.keys(weights)) weights[key] = weights[key] * 100 / sum;
}

/**
 * BucketNormalizingInfluence.kt: achata a raridade (pesca: tier = Lure + Luck of the Sea).
 * peso^(1 / (firstTier + gradient × (tier − 1))), depois normaliza para 100.
 */
export function bucketNormalizingInfluence(tier: number, gradient = 0.2, firstTier = 1.29): SpawnInfluence {
  return {
    affectBucketWeights(weights) {
      if (tier === 0) return;
      const factor = firstTier + gradient * (tier - 1);
      for (const key of Object.keys(weights)) weights[key] = Math.pow(weights[key], 1 / factor);
      normalizeBucketWeights(weights);
    },
  };
}

/** Spawner.chooseBucket: pesos da config → influências → só buckets do pool → sorteio. */
export function chooseBucket(buckets: Record<string, number>, influences: SpawnInfluence[] = [], pool: Iterable<string> = poolBuckets(), random: () => number = Math.random): string {
  const weights: Record<string, number> = { ...buckets };
  for (const influence of influences) influence.affectBucketWeights?.(weights);
  const used = new Set(pool);
  const keys = Object.keys(weights).filter(k => used.has(k));
  return weightedPick(keys, k => weights[k], random) ?? Object.keys(buckets)[0];
}

// ---------------------------------------------------------------------------------------------
// Seleção

interface SpawnInfo {
  positions: Map<SpawnContext, number>;
  highest: number;
}
/** Tipo de posição → entradas possíveis → posições e pesos (SpawnablePositionSelectionData). */
type BucketData = Map<string, Map<SpawnEntry, SpawnInfo>>;

class Selection {
  readonly actions: SpawnAction[] = [];
  guaranteedBucket: string | undefined;
  /** Nível sorteado de cada herd do passe (chave `${id}__LEVEL`). */
  readonly context = new Map<string, number>();
  private readonly bucketData = new Map<string, BucketData>();
  private readonly removedEntries = new Set<SpawnEntry>();
  private readonly removedPositions = new Set<SpawnContext>();
  private herdCounter = 0;
  readonly herdGroups = new Map<SpawnEntry, string>();

  constructor(readonly positions: SpawnContext[], readonly opts: SelectOptions, readonly random: () => number) { }

  influencesAt(ctx: SpawnContext): SpawnInfluence[] {
    const extra = ctx.influences ?? [];
    const base = this.opts.influences ?? [];
    return extra.length ? base.concat(extra) : base;
  }

  /** SpawnablePosition.getWeight: peso × weightMultipliers × influências. */
  weightAt(entry: SpawnEntry, ctx: SpawnContext): number {
    let weight = baseWeight(entry, ctx);
    for (const influence of this.influencesAt(ctx)) {
      if (influence.affectWeight) weight = influence.affectWeight(entry, ctx, weight);
    }
    return weight;
  }

  private matches(entry: SpawnEntry, ctx: SpawnContext): boolean {
    if (this.removedEntries.has(entry)) return false;
    if (this.opts.filter && !this.opts.filter(entry)) return false;
    for (const influence of this.influencesAt(ctx)) {
      if (influence.affectSpawnable && !influence.affectSpawnable(entry, ctx)) return false;
    }
    if (!entryAllowed(entry, ctx)) return false;
    // Herds verificam o tamanho de cada membro na hora de criar a ação.
    if (!entry.herd && !fitsAt(entry.species, entry.aspects, ctx)) return false;
    return true;
  }

  getDataForBucket(bucket: string): BucketData {
    let data = this.bucketData.get(bucket);
    if (data) return data;
    data = new Map();
    const entriesFor = this.opts.entriesFor ?? ((ctx: SpawnContext) => entriesForBiome(ctx.biome));
    for (const ctx of this.positions) {
      if (this.removedPositions.has(ctx)) continue;
      let candidates = entriesFor(ctx);
      // Spawner.getMatchingSpawns: as do pool + as injetadas pelas influências da posição.
      for (const influence of this.influencesAt(ctx)) {
        const injected = influence.injectSpawns?.(bucket, ctx);
        if (injected?.length) candidates = candidates.concat(injected);
      }
      for (const entry of candidates) {
        if (entry.bucket !== bucket || !this.matches(entry, ctx)) continue;
        let byType = data.get(ctx.positionType);
        if (!byType) data.set(ctx.positionType, byType = new Map());
        let info = byType.get(entry);
        if (!info) byType.set(entry, info = { positions: new Map(), highest: 0 });
        const weight = this.weightAt(entry, ctx);
        info.positions.set(ctx, weight);
        if (weight > info.highest) info.highest = weight;
      }
    }
    this.bucketData.set(bucket, data);
    return data;
  }

  removeEntries(shouldRemove: (entry: SpawnEntry) => boolean) {
    for (const data of this.bucketData.values()) {
      for (const [type, byType] of data) {
        for (const entry of [...byType.keys()]) {
          if (shouldRemove(entry)) {
            byType.delete(entry);
            this.removedEntries.add(entry);
          }
        }
        if (byType.size === 0) data.delete(type);
      }
    }
  }

  removePositions(shouldRemove: (ctx: SpawnContext) => boolean) {
    for (const ctx of this.positions) if (!this.removedPositions.has(ctx) && shouldRemove(ctx)) this.removedPositions.add(ctx);
    for (const data of this.bucketData.values()) {
      for (const [type, byType] of data) {
        for (const [entry, info] of [...byType]) {
          let highest = 0;
          for (const [ctx, weight] of [...info.positions]) {
            if (this.removedPositions.has(ctx)) info.positions.delete(ctx);
            else if (weight > highest) highest = weight;
          }
          info.highest = highest;
          if (info.positions.size === 0) byType.delete(entry);
        }
        if (byType.size === 0) data.delete(type);
      }
    }
  }

  /** FlatSpawnablePositionWeightedSelector.selectSpawnAction. */
  selectSpawnAction(bucket: string): SpawnAction | undefined {
    const data = this.getDataForBucket(bucket);
    if (data.size === 0) return undefined;
    const typeWeights = this.opts.positionTypeWeights ?? BEST_SPAWNER_CONFIG.spawnablePositionTypeWeights;
    const types = [...data.keys()];
    const type = weightedPick(types, t => (typeWeights[t] ?? 1) * data.get(t)!.size, this.random);
    if (type === undefined) return undefined;
    const byType = data.get(type)!;
    const entries = [...byType.keys()];
    const entry = weightedPick(entries, e => byType.get(e)!.highest, this.random);
    if (!entry) return undefined;
    const info = byType.get(entry)!;
    const positions = [...info.positions.keys()];
    const ctx = weightedPick(positions, p => info.positions.get(p)!, this.random) ?? positions[0];
    return entry.herd ? this.chooseHerd(entry, ctx, bucket) : this.choosePokemon(entry, ctx, bucket);
  }

  // --- PokemonSpawnDetail --------------------------------------------------------------------

  private choosePokemon(entry: SpawnEntry, ctx: SpawnContext, bucket: string): SpawnAction {
    let heldItem = entry.heldItem;
    const heldItems = entry.heldItems ?? [];
    if (heldItems.length) {
      // PossibleHeldItem: chance de nenhum = 1 − soma das porcentagens.
      const until100 = 1 - heldItems.reduce((sum, h) => sum + h.percentage / 100, 0);
      if (!(until100 > 0 && this.random() < until100))
        heldItem = weightedPick(heldItems, h => h.percentage, this.random)?.item ?? heldItem;
    }
    const action: SpawnAction = {
      entry, ctx, bucket,
      species: entry.species,
      aspects: [...entry.aspects],
      alpha: entry.alpha === true,
      heldItem,
      drops: entry.drops,
      levelRange: [entry.minLevel, entry.maxLevel],
    };
    // SpawnDetail.onSelection: nada a menos de minimumDistanceBetweenEntities.
    const minDistance = this.opts.minDistanceBetweenEntities ?? 8;
    this.removePositions(p => distance(p, ctx) < minDistance);
    return action;
  }

  // --- PokemonHerdSpawnDetail ----------------------------------------------------------------

  private herdLevel(entry: SpawnEntry): number {
    const key = `${entry.id}__LEVEL`;
    let level = this.context.get(key);
    if (level === undefined) {
      level = randomIntIn(entry.minLevel, entry.maxLevel, this.random);
      this.context.set(key, level);
    }
    return level;
  }

  private memberCounts(entry: SpawnEntry): Map<HerdMember, number> {
    const counts = new Map<HerdMember, number>();
    for (const action of this.actions) {
      if (action.entry !== entry || action.empty || !action.herdMember) continue;
      counts.set(action.herdMember, (counts.get(action.herdMember) ?? 0) + 1);
    }
    return counts;
  }

  private validMembers(entry: SpawnEntry): HerdMember[] {
    const level = this.herdLevel(entry);
    const counts = this.memberCounts(entry);
    return entry.herd!.members.filter(m => {
      if ((counts.get(m) ?? 0) >= m.maxTimes) return false;
      if (m.herdLevelRange && (level < m.herdLevelRange[0] || level > m.herdLevelRange[1])) return false;
      return true;
    });
  }

  private lacksPossibleLeader(entry: SpawnEntry): boolean {
    const valid = this.validMembers(entry);
    const counts = this.memberCounts(entry);
    const leaderIsPossible = valid.some(m => m.isLeader === true);
    const leaderIsSelected = [...counts].some(([m, n]) => m.isLeader === true && n > 0);
    return leaderIsPossible && !leaderIsSelected;
  }

  private membersForRole(entry: SpawnEntry, leaderRole: boolean): HerdMember[] {
    return this.validMembers(entry).filter(m => (leaderRole && m.isLeader === true) || (!leaderRole && m.isFollower !== false));
  }

  private chooseHerd(entry: SpawnEntry, ctx: SpawnContext, bucket: string): SpawnAction {
    const herd = entry.herd!;
    let group = this.herdGroups.get(entry);
    if (!group) this.herdGroups.set(entry, group = `${entry.id}#${++this.herdCounter}`);
    // createSpawnAction
    const member = weightedPick(this.membersForRole(entry, this.lacksPossibleLeader(entry)), m => m.weight, this.random) ?? herd.members[0];
    let level = this.context.get(`${entry.id}__LEVEL`) ?? 1;
    const memberAspects = member.aspects ?? [];
    const empty = !fitsAt(member.species, memberAspects, ctx);
    if (member.levelRange) level = Math.min(member.levelRange[1], Math.max(member.levelRange[0], level));
    const levelRange: [number, number] = member.levelRangeOffset
      ? [level + member.levelRangeOffset[0], level + member.levelRangeOffset[1]]
      : [level, level];
    const action: SpawnAction = {
      entry, ctx, bucket,
      species: member.species,
      aspects: [...memberAspects],
      alpha: member.alpha === true,
      heldItem: member.heldItem,
      levelRange,
      herdMember: member,
      herdGroup: group,
      empty: empty || undefined,
    };
    // onSelection
    this.removeEntries(e => e !== entry);
    this.guaranteedBucket = bucket;
    this.removePositions(p => distance(p, ctx) < (herd.minDistanceBetweenSpawns ?? 1));
    const herdSpawnCount = this.actions.filter(a => a.entry === entry && !a.empty).length + 1;
    const lacksLeader = this.lacksPossibleLeader(entry);
    if (herdSpawnCount >= herd.maxHerdSize || this.membersForRole(entry, lacksLeader).length === 0)
      this.removeEntries(e => e === entry);
    return action;
  }
}

/**
 * SpawningSelector.select: escolhe até `maxSpawns` ações nas posições dadas. Ações vazias (herd sem
 * espaço) ficam de fora do retorno, mas contam no limite como no Cobblemon.
 */
export function selectSpawnActions(positions: SpawnContext[], opts: SelectOptions): SpawnAction[] {
  if (positions.length === 0) return [];
  const random = opts.random ?? Math.random;
  const selection = new Selection(positions, opts, random);
  const maxSpawns = Math.max(0, opts.maxSpawns ?? 1);
  const pool = opts.poolBuckets ?? poolBuckets();
  while (selection.actions.length < maxSpawns) {
    const bucket = selection.guaranteedBucket ?? chooseBucket(opts.buckets, opts.influences, pool, random);
    const action = selection.selectSpawnAction(bucket);
    if (!action) break;
    selection.actions.push(action);
  }
  const actions = selection.actions.filter(a => !a.empty);
  // SpawnAction.complete: influências mexem na ação antes de criar a entidade.
  for (const action of actions) {
    for (const influence of selection.influencesAt(action.ctx)) influence.affectAction?.(action);
  }
  return actions;
}

/** Nível final da ação: sorteado na faixa (PokemonSpawnAction.createEntity), mínimo 1. */
export function rollLevel(action: SpawnAction, random: () => number = Math.random): number {
  return Math.max(1, randomIntIn(action.levelRange[0], action.levelRange[1], random));
}

// ---------------------------------------------------------------------------------------------
// Nível pelo time do jogador

export interface LevelRangeSettings {
  variation: number;
  maxPokemonLevel: number;
  minimumLevelRangeMax: number;
}

/**
 * Faixa de nível do jogador (PlayerLevelRangeInfluence.getPlayerLevelRange):
 * [max(maior − variação, 1), min(nível máx., max(maior + variação, minimumLevelRangeMax))];
 * sem time: [1, minimumLevelRangeMax].
 */
export function playerLevelRange(partyLevels: readonly number[], s: LevelRangeSettings): [number, number] {
  if (partyLevels.length === 0) return [1, s.minimumLevelRangeMax];
  const highest = Math.max(...partyLevels);
  return [Math.max(highest - s.variation, 1), Math.min(s.maxPokemonLevel, Math.max(highest + s.variation, s.minimumLevelRangeMax))];
}

/** PlayerLevelRangeInfluence.affectAction: interseção da faixa do spawn com a do jogador. */
export function scaleLevelRange(derived: [number, number], player: [number, number]): [number, number] {
  const lo = Math.max(derived[0], player[0]);
  const hi = Math.min(derived[1], player[1]);
  if (lo <= hi) return [lo, hi];
  const width = derived[1] - derived[0];
  if (derived[0] > player[1]) return [derived[0], Math.trunc(derived[0] + width / 4)];
  return [Math.trunc(derived[0] + 3 * width / 4), derived[1]];
}

/**
 * Influência de nível pelo time. No Cobblemon 1.8.2 ela grava `props.level`, que
 * `PokemonSpawnAction.createEntity` sobrescreve com `levelRange.random()` — ou seja, não tem efeito
 * nos spawns naturais. Aqui ela ajusta a faixa (o comportamento pretendido); o spawner só a liga se
 * `SPAWN_TUNING.playerLevelScaling` for verdadeiro.
 */
export function playerLevelRangeInfluence(partyLevels: () => readonly number[], settings: LevelRangeSettings): SpawnInfluence {
  let cached: [number, number] | undefined;
  return {
    affectAction(action) {
      cached ??= playerLevelRange(partyLevels(), settings);
      action.levelRange = scaleLevelRange(action.levelRange, cached);
    },
  };
}

/** Nível-alvo de um Alfa pelo maior nível do time (AlphaLevelMatchingSensor.getTargetLevel). */
export function alphaTargetLevel(strongestPartyLevel: number, minimumEvolutionLevel = 1, maxLevel = 100): number {
  const l = strongestPartyLevel;
  const target = l < 21 ? l + 4 : l <= 30 ? l + 8 : l <= 45 ? l + 12 : l <= 65 ? l + 16 : l + 20;
  return Math.max(minimumEvolutionLevel, Math.min(maxLevel, target));
}

/** Escala de Alfa (Pokemon.getAlphaScaleMultiplier): 1.1 + 0.8 × 0.5^clamp(max(w, h) × baseScale, 0.25, 5). */
export function alphaScaleMultiplier(hitbox: { width: number; height: number }, baseScale: number): number {
  const size = Math.min(5, Math.max(0.25, Math.max(hitbox.width, hitbox.height) * baseScale));
  return 1.1 + 0.8 * Math.pow(0.5, size);
}
