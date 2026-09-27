/**
 * Features de espécie com valor por Pokémon que o port precisa guardar (Cobblemon 1.8.2):
 *
 * - `IntSpeciesFeature` com `itemPoints` (`data/cobblemon/species_features/gimmighoul_coins.json` e
 *   `gimmighoul_netherite.json`, atribuídas ao Gimmighoul em `species_feature_assignments`): o "stash" de moedas e de
 *   netherite (StashHandler). Dar Relic Coin (1), Relic Coin Pouch (9) ou Relic Coin Sack (81) soma no stash de
 *   moedas (máx. 999); sucata (1), lingote (4) ou bloco de netherite (36) no de netherite (máx. 256). Com 999 moedas o
 *   Gimmighoul evolui em Gholdengo (requisito `properties` "gimmighoul_coins=999"); o netherite decide o estágio da
 *   cobertura (requisito `property_range`).
 * - `blocks_traveled` (`global_species_features/blocks_traveled.json`, todas as espécies, 0..1000): passos dados fora
 *   da bola, só contados para quem tem uma evolução com o requisito `blocks_traveled` (Pawmo, Bramblin, Rellor).
 * - `slowpoke_tail_regrowth` (`SlowpokeTailRegrowthSpeciesFeature` + `mechanics/slowpoke_tails.json`): segundos até a
 *   cauda do Slowpoke crescer de novo depois de tosada (dá Tasty Tail).
 *
 * Tudo fica em `PokemonData.features` (chave → número); campo ausente = valor padrão.
 */
import type { PokemonData } from "../Pokemon";
import { applyFeatureDefaults, sharedAssignedFeatureAspects } from "./FeatureAssignments"; // frente dados-ia

export interface IntFeatureSpec {
  key: string;
  default: number;
  min: number;
  max: number;
  /** Espécies com a feature (undefined = global: todas). */
  species?: string[];
  /** StashHandler: item → pontos. */
  itemPoints?: Record<string, number>;
}

/** Features inteiras do Cobblemon 1.8.2 que o port acompanha (valores dos JSON do upstream). */
export const INT_FEATURES: Record<string, IntFeatureSpec> = {
  gimmighoul_coins: {
    key: "gimmighoul_coins", default: 0, min: 0, max: 999, species: ["gimmighoul"],
    itemPoints: { "cobblemon:relic_coin": 1, "cobblemon:relic_coin_pouch": 9, "cobblemon:relic_coin_sack": 81 },
  },
  gimmighoul_netherite: {
    key: "gimmighoul_netherite", default: 0, min: 0, max: 256, species: ["gimmighoul"],
    itemPoints: { "minecraft:netherite_scrap": 1, "minecraft:netherite_ingot": 4, "minecraft:netherite_block": 36 },
  },
  blocks_traveled: { key: "blocks_traveled", default: 0, min: 0, max: 1000 },
};

/** Som do Cobblemon ao dar item ao stash (CobblemonSounds.GIMMIGHOUL_GIVE_ITEM). */
export const STASH_SOUND = "cobblemon.pokemon.gimmighoul.give_item";

function baseSpecies(pokemon: Pick<PokemonData, "species">): string {
  return pokemon.species.replace(/^cobblemon:/, "").toLowerCase();
}

/** A espécie tem a feature (SpeciesFeatures.getFeaturesFor). */
export function hasIntFeature(pokemon: Pick<PokemonData, "species">, key: string): boolean {
  const spec = INT_FEATURES[key];
  if (!spec) return false;
  return !spec.species || spec.species.includes(baseSpecies(pokemon));
}

/** Valor da feature, ou undefined se a espécie não a tem (pokemon.getFeature<IntSpeciesFeature>). */
export function getIntFeature(pokemon: Pick<PokemonData, "species" | "features">, key: string): number | undefined {
  if (!hasIntFeature(pokemon, key)) return undefined;
  const value = pokemon.features?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : INT_FEATURES[key].default;
}

/** Grava a feature limitada a min..max (IntSpeciesFeature). Falso se a espécie não a tem. */
export function setIntFeature(pokemon: Pick<PokemonData, "species" | "features">, key: string, value: number): boolean {
  const spec = INT_FEATURES[key];
  if (!spec || !hasIntFeature(pokemon, key)) return false;
  const bounded = Math.max(spec.min, Math.min(spec.max, Math.floor(value)));
  pokemon.features = { ...(pokemon.features ?? {}), [key]: bounded };
  return true;
}

/**
 * StashHandler.handleItem: soma os pontos do item em cada feature da espécie que o aceita (limitado ao máximo).
 * Retorna true se alguma feature aceitou o item (o item é gasto mesmo com o stash cheio, como no Cobblemon).
 */
export function handleStashItem(pokemon: Pick<PokemonData, "species" | "features">, itemId: string): boolean {
  let handled = false;
  for (const spec of Object.values(INT_FEATURES)) {
    const points = spec.itemPoints?.[itemId];
    if (points === undefined || !hasIntFeature(pokemon, spec.key)) continue;
    const current = getIntFeature(pokemon, spec.key) ?? spec.default;
    // `feature.value += points` e depois `if (value > max) value = max`.
    setIntFeature(pokemon, spec.key, current + points);
    handled = true;
  }
  return handled;
}

/** Algum item dá pontos para esta espécie (para decidir se a interação é do stash). */
export function isStashItem(pokemon: Pick<PokemonData, "species">, itemId: string): boolean {
  return Object.values(INT_FEATURES).some(spec => spec.itemPoints?.[itemId] !== undefined && hasIntFeature(pokemon, spec.key));
}

// ---------------------------------------------------------------------------------------------
// Passos (blocks_traveled)

/** Pokemon.addBlocksTraveled: soma sem passar do máximo da feature (1000). */
export function addBlocksTraveled(pokemon: Pick<PokemonData, "species" | "features">, blocks: number): boolean {
  if (blocks <= 0) return false;
  const current = getIntFeature(pokemon, "blocks_traveled") ?? 0;
  const next = Math.min(INT_FEATURES.blocks_traveled.max, current + Math.floor(blocks));
  if (next === current) return false;
  return setIntFeature(pokemon, "blocks_traveled", next);
}

export function getBlocksTraveled(pokemon: Pick<PokemonData, "species" | "features">): number {
  return getIntFeature(pokemon, "blocks_traveled") ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Cauda do Slowpoke (slowpoke_tail_regrowth)

/** `data/cobblemon/mechanics/slowpoke_tails.json` do Cobblemon 1.8.2. */
export const SLOWPOKE_TAILS = {
  canShearSlowpoke: true,
  onlyRegrowWhenSentOut: false,
  regrowthSeconds: 1200,
  /** Segundos restantes < chave → aspect (SlowpokeTailsMechanic.getAspects). */
  aspectThresholds: { 1: "regrown-tail-3", 200: "regrown-tail-2", 700: "regrown-tail-1" } as Record<number, string>,
};
export const TAIL_FEATURE = "slowpoke_tail_regrowth";
export const TASTY_TAIL = "cobblemon:tasty_tail";
const TAIL_SPECIES = ["slowpoke"];
const TAIL_ASPECTS = Object.values(SLOWPOKE_TAILS.aspectThresholds);

/** O Slowpoke tem a feature (e a mecânica permite tosar). */
export function hasTailFeature(pokemon: Pick<PokemonData, "species">): boolean {
  return SLOWPOKE_TAILS.canShearSlowpoke && TAIL_SPECIES.includes(baseSpecies(pokemon));
}

/** Segundos até a cauda crescer (0 = pronta para tosar). */
export function tailRegrowthSeconds(pokemon: Pick<PokemonData, "species" | "features">): number {
  const value = pokemon.features?.[TAIL_FEATURE];
  return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
}

/** Aspects da cauda em crescimento para os segundos restantes. */
export function tailAspects(regrowthSeconds: number): string[] {
  return Object.entries(SLOWPOKE_TAILS.aspectThresholds)
    .filter(([threshold]) => regrowthSeconds < Number(threshold))
    .map(([, aspect]) => aspect);
}

/**
 * updateAspects (SlowpokeTailRegrowthSpeciesFeatureProvider.provide): tira os aspects de cauda antigos e põe os do
 * tempo atual. Cauda inteira (0 s) = os três `regrown-tail-*`; recém-tosada = nenhum.
 */
export function applyTailAspects(pokemon: Pick<PokemonData, "species" | "features" | "aspects">) {
  const kept = pokemon.aspects.filter(aspect => !TAIL_ASPECTS.includes(aspect));
  pokemon.aspects = hasTailFeature(pokemon) ? [...kept, ...tailAspects(tailRegrowthSeconds(pokemon))] : kept;
}

/** PokemonEntity.readyForShearing (ramo do Slowpoke). */
export function canShearTail(pokemon: Pick<PokemonData, "species" | "features" | "currentHealth">): boolean {
  return hasTailFeature(pokemon) && pokemon.currentHealth > 0 && tailRegrowthSeconds(pokemon) <= 0;
}

/** SlowpokeTailRegrowthSpeciesFeature.onShear: começa a contagem (o chamador dropa a Tasty Tail). */
export function shearTail(pokemon: Pick<PokemonData, "species" | "features" | "aspects">) {
  pokemon.features = { ...(pokemon.features ?? {}), [TAIL_FEATURE]: SLOWPOKE_TAILS.regrowthSeconds };
  applyTailAspects(pokemon);
}

/**
 * onSecondPassed: desce 1 s. `sentOut` = o Pokémon está fora da bola. Retorna true se mudou.
 * (Com `onlyRegrowWhenSentOut` só conta fora da bola; o port conta pelo time, um passe por segundo.)
 */
export function tickTailRegrowth(pokemon: Pick<PokemonData, "species" | "features" | "aspects">, sentOut: boolean): boolean {
  const seconds = tailRegrowthSeconds(pokemon);
  if (seconds <= 0 || !hasTailFeature(pokemon)) return false;
  if (SLOWPOKE_TAILS.onlyRegrowWhenSentOut && !sentOut) return false;
  pokemon.features = { ...(pokemon.features ?? {}), [TAIL_FEATURE]: seconds - 1 };
  applyTailAspects(pokemon);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Escolhas ponderadas (WeightedChoiceSpeciesFeatureProvider, 1.8.0): Dunsparce/Dudunsparce de 2 ou 3 segmentos e
// família de 3 ou 4 do Tandemaus/Maushold. Sorteadas ao criar o Pokémon (padrão "random") e mantidas na evolução
// (as duas espécies da linha têm a feature).

export interface WeightedFeatureSpec {
  key: string;
  species: string[];
  choices: Record<string, number>;
  aspectFormat: string;
}

/** `species_features/{landsnake_form,maushold_family}.json` + `species_feature_assignments`. */
export const WEIGHTED_FEATURES: WeightedFeatureSpec[] = [
  { key: "landsnake_form", species: ["dunsparce", "dudunsparce"], choices: { "two-segment": 99, "three-segment": 1 }, aspectFormat: "{{choice}}-form" },
  { key: "maushold_family", species: ["tandemaus", "maushold"], choices: { three: 1, four: 99 }, aspectFormat: "maushold-family-{{choice}}" },
];

function featureAspects(spec: WeightedFeatureSpec): string[] {
  return Object.keys(spec.choices).map(choice => spec.aspectFormat.replace("{{choice}}", choice));
}

/** Sorteio ponderado (WeightedChoiceSpeciesFeatureProvider.get com "random"). */
export function rollWeightedChoice(choices: Record<string, number>, random: () => number = Math.random): string {
  const entries = Object.entries(choices);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = random() * total;
  for (const [choice, weight] of entries) {
    pick -= weight;
    if (pick < 0) return choice;
  }
  return entries[entries.length - 1][0];
}

/** Garante o aspect de cada escolha ponderada da espécie (sorteia se faltar). Retorna true se mudou. */
export function ensureWeightedFeatureAspects(pokemon: Pick<PokemonData, "species" | "aspects">, random: () => number = Math.random): boolean {
  const species = baseSpecies(pokemon);
  let changed = false;
  for (const spec of WEIGHTED_FEATURES) {
    if (!spec.species.includes(species)) continue;
    const all = featureAspects(spec);
    if (pokemon.aspects.some(aspect => all.includes(aspect))) continue;
    pokemon.aspects = [...pokemon.aspects, spec.aspectFormat.replace("{{choice}}", rollWeightedChoice(spec.choices, random))];
    changed = true;
  }
  // Frente dados-ia: padrão de todas as outras features de aspect da espécie (species_feature_assignments).
  if (applyFeatureDefaults(pokemon, random)) changed = true;
  return changed;
}

/** Aspects de escolhas ponderadas que continuam valendo na espécie nova (evolução dentro da linha). */
export function sharedFeatureAspects(aspects: readonly string[], newSpecies: string): string[] {
  const species = newSpecies.replace(/^cobblemon:/, "").toLowerCase();
  const kept: string[] = [];
  for (const spec of WEIGHTED_FEATURES) {
    if (!spec.species.includes(species)) continue;
    const all = featureAspects(spec);
    kept.push(...aspects.filter(aspect => all.includes(aspect)));
  }
  // Frente dados-ia: qualquer feature que a espécie nova também tem continua (Pokemon.species setter).
  for (const aspect of sharedAssignedFeatureAspects(aspects, newSpecies)) if (!kept.includes(aspect)) kept.push(aspect);
  return kept;
}
