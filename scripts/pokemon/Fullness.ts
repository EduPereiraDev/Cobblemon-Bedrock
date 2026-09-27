/**
 * Fome/saciedade dos Pokémon (Cobblemon 1.8.2: `Pokemon.currentFullness`, `getMaxFullness`, `feedPokemon`,
 * `tickMetabolism`, `PokemonSelectingItem.canUseOnPokemon` + tag `cobblemon:poke_food`).
 *
 * - Barriga máxima pelo peso da espécie: `potência do Grass Knot(peso) / 10 / 2 + 1` (1 a 7). O peso é o número do
 *   JSON da espécie (hectogramas), exatamente como o Cobblemon passa para `getGrassKnotPower`.
 * - Comer: berries, mochis, Berry Juice, Aprijuice e Poké Puff somam 1 (berries de cura por porção somam 5, Poké Puff
 *   4). Com a barriga cheia a comida não soma nada; itens da tag `poke_food` (berries "filling", mochis, aprijuices,
 *   Poké Snack) nem podem ser usados. Isso limita o ganho de EV/amizade por berries em sequência.
 * - Metabolismo: a cada segundo (time do jogador), com barriga > 0, soma 20 ticks; ao passar da taxa da espécie
 *   (`(20 − velocidade/BST × 20 × 4) × 60 s`, mínimo 60 s) perde 1.
 *
 * O port usa estes cálculos em dois lugares: a rotina de 1 s do time (scripts/pokemon/PassiveHealing.ts) e o uso de
 * itens em Pokémon (os comportamentos de scripts/items/effects.ts são embrulhados por `installFullnessHooks`).
 */
import type { Entity } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { getSpeciesData } from "../speciesData";
import type { ItemBehaviour, ItemUseContext, ItemUseResult } from "../items/effects";

/** Sons do Cobblemon (CobblemonSounds.BERRY_EAT / BERRY_EAT_FULL). */
export const BERRY_EAT_SOUND = "cobblemon.item.berry.eat";
export const BERRY_EAT_FULL_SOUND = "cobblemon.item.berry.eat.full";

type Subject = Pick<PokemonData, "species" | "fullness" | "metabolismCycle">;

/** Pokemon.getGrassKnotPower (faixas em "libras" aplicadas ao número do peso da espécie). */
export function grassKnotPower(weight: number): number {
  if (weight >= 0.1 && weight <= 21.8) return 20;
  if (weight >= 21.9 && weight <= 54.9) return 40;
  if (weight >= 55.0 && weight <= 110.1) return 60;
  if (weight >= 110.2 && weight <= 220.3) return 80;
  if (weight >= 220.4 && weight <= 440.8) return 100;
  if (weight >= 440.9) return 120;
  return 0;
}

/** Barriga máxima para um peso (divisões inteiras, como no Kotlin). */
export function maxFullnessForWeight(weight: number): number {
  return Math.floor(Math.floor(grassKnotPower(weight) / 10) / 2) + 1;
}

function speciesOf(pokemon: Pick<PokemonData, "species">) {
  return getSpeciesData(pokemon.species);
}

export function getMaxFullness(pokemon: Pick<PokemonData, "species">): number {
  return maxFullnessForWeight(speciesOf(pokemon)?.weight ?? 0);
}

export function getFullness(pokemon: Pick<PokemonData, "fullness">): number {
  return typeof pokemon.fullness === "number" && pokemon.fullness > 0 ? Math.floor(pokemon.fullness) : 0;
}

/** Pokemon.isFull. */
export function isFull(pokemon: Pick<PokemonData, "species" | "fullness">): boolean {
  return getFullness(pokemon) >= getMaxFullness(pokemon);
}

/** Taxa de metabolismo em ticks para perder 1 de barriga (Pokemon.getMetabolismRate). */
export function metabolismRateForStats(speed: number, baseStatTotal: number): number {
  const baseBerryCount = 20;
  const multiplier = 4;
  const ratio = baseStatTotal > 0 ? speed / baseStatTotal : 0;
  // `.toInt()` do Kotlin trunca em direção a zero.
  let seconds = Math.trunc((baseBerryCount - ratio * baseBerryCount * multiplier) * 60);
  if (seconds <= 0) seconds = 60;
  return seconds * 20;
}

export function getMetabolismRate(pokemon: Pick<PokemonData, "species">): number {
  const stats = speciesOf(pokemon)?.baseStats as Record<string, number> | undefined;
  if (!stats) return metabolismRateForStats(0, 0);
  const total = Object.values(stats).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return metabolismRateForStats(Number(stats.speed) || 0, total);
}

/** Resultado de `feedPokemon`: som para tocar na entidade (se estiver fora da bola). */
export interface FeedResult {
  sound: string;
  /** Tom do som (1 + metade da fração de barriga). */
  pitch: number;
  changed: boolean;
}

/**
 * Pokemon.feedPokemon: escolhe o som pela barriga de antes; cheia não soma; o primeiro alimento reinicia o ciclo.
 */
export function feedPokemon(pokemon: Pick<PokemonData, "species" | "fullness" | "metabolismCycle">, feedCount: number): FeedResult {
  const max = getMaxFullness(pokemon);
  const current = getFullness(pokemon);
  const sound: FeedResult = current >= max
    ? { sound: BERRY_EAT_FULL_SOUND, pitch: 1, changed: false }
    : { sound: BERRY_EAT_SOUND, pitch: 1 + (current / max) * 0.5, changed: false };
  if (current >= max) return sound;
  const next = Math.max(0, Math.min(max, current + feedCount));
  pokemon.fullness = next;
  if (next === 1) pokemon.metabolismCycle = 0;
  sound.changed = next !== current;
  return sound;
}

/** Pokemon.tickMetabolism (chamado a cada segundo com 20 ticks, só com barriga > 0). Retorna true se a barriga mudou. */
export function tickMetabolism(pokemon: Subject, ticksPassed = 20): boolean {
  if (getFullness(pokemon) <= 0) return false;
  pokemon.metabolismCycle = (pokemon.metabolismCycle ?? 0) + Math.max(1, ticksPassed);
  if (pokemon.metabolismCycle < getMetabolismRate(pokemon)) return false;
  pokemon.fullness = Math.max(0, getFullness(pokemon) - 1);
  pokemon.metabolismCycle = 0;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Itens

const berry = (name: string) => `cobblemon:${name}_berry`;

/** Tag `cobblemon:poke_food` (berries/filling = damage_reduction + damaging + non_battle, mochis, aprijuices, Poké Snack). */
export const POKE_FOOD = new Set<string>([
  ...["babiri", "charti", "chilan", "chople", "coba", "colbur", "haban", "kasib", "kebia", "occa", "passho", "payapa", "rindo",
    "roseli", "shuca", "tanga", "wacan", "yache"].map(berry),
  ...["jaboca", "rowap"].map(berry),
  ...["razz", "bluk", "nanab", "wepear", "pinap", "cornn", "magost", "rabuta", "nomel", "pomeg", "kelpsy", "qualot", "hondew",
    "grepa", "tamato", "spelon", "pamtre", "watmel", "durin", "belue", "hopo"].map(berry),
  ...["health", "muscle", "resist", "genius", "clever", "swift", "fresh_start"].map(x => `cobblemon:${x}_mochi`),
  ...["red", "yellow", "green", "blue", "pink", "black", "white"].map(x => `cobblemon:aprijuice_${x}`),
  "cobblemon:poke_snack",
]);

/** Quanto cada item soma na barriga ao ser usado com sucesso num Pokémon (chamadas de feedPokemon nos itens). */
export const FEED_AMOUNTS: Record<string, number> = {
  // StatusCuringBerryItem, PPRestoringBerryItem, HealingBerryItem, FriendshipRaisingBerryItem: 1
  ...Object.fromEntries(["cheri", "chesto", "pecha", "rawst", "aspear", "persim", "lum", "eggant", "leppa", "hopo", "oran",
    "sitrus", "pomeg", "kelpsy", "qualot", "hondew", "grepa", "tamato"].map(name => [berry(name), 1])),
  // PortionHealingBerryItem: 5
  ...Object.fromEntries(["figy", "wiki", "mago", "aguav", "iapapa"].map(name => [berry(name), 5])),
  "cobblemon:berry_juice": 1,
  ...Object.fromEntries(["health", "muscle", "resist", "genius", "clever", "swift", "fresh_start"].map(x => [`cobblemon:${x}_mochi`, 1])),
  ...Object.fromEntries(["red", "yellow", "green", "blue", "pink", "black", "white"].map(x => [`cobblemon:aprijuice_${x}`, 1])),
  "cobblemon:poke_puff": 4,
};

export function isPokeFood(typeId: string): boolean {
  return POKE_FOOD.has(typeId);
}

/** PokemonSelectingItem.canUseOnPokemon: comida (`poke_food`) só com barriga livre. */
export function canEat(pokemon: Pick<PokemonData, "species" | "fullness">, typeId: string): boolean {
  return !isPokeFood(typeId) || !isFull(pokemon);
}

/** Som da comida na entidade (feedPokemon toca pela entidade). */
function playFeedSound(entity: Entity | undefined, feed: FeedResult) {
  if (!entity?.isValid) return;
  try { entity.dimension.playSound(feed.sound, entity.location, { pitch: feed.pitch }); }
  catch { /* som ausente */ }
}

/**
 * Embrulha o comportamento de um item (scripts/items/effects.ts): bloqueia comida com a barriga cheia e soma a
 * barriga quando o item funcionou. O som da comida substitui o do item (o Cobblemon toca o do feedPokemon).
 */
export function wrapBehaviourWithFullness(behaviour: ItemBehaviour, entityOf: (pokemon: PokemonData) => Entity | undefined = () => undefined): ItemBehaviour {
  const marker = behaviour as ItemBehaviour & { __fullness?: true };
  if (marker.__fullness) return behaviour;
  const amount = FEED_AMOUNTS[behaviour.typeId];
  const food = isPokeFood(behaviour.typeId);
  if (!amount && !food) return behaviour;
  const canUse = behaviour.canUse.bind(behaviour);
  const apply = behaviour.apply.bind(behaviour);
  behaviour.canUse = (pokemon: PokemonData, ctx?: ItemUseContext) => canEat(pokemon, behaviour.typeId) && canUse(pokemon, ctx);
  behaviour.apply = (pokemon: PokemonData, ctx?: ItemUseContext): ItemUseResult => {
    const outcome = apply(pokemon, ctx);
    if (outcome.success && amount) {
      const feed = feedPokemon(outcome.pokemon, amount);
      if (outcome.sound === BERRY_EAT_SOUND || outcome.sound === undefined) {
        outcome.sound = undefined;
        playFeedSound(entityOf(outcome.pokemon), feed);
      }
    }
    return outcome;
  };
  marker.__fullness = true;
  return behaviour;
}

/**
 * Liga a fome aos itens do port: para cada item que come, pega o comportamento (cacheado) em scripts/items/effects.ts
 * e embrulha. Chamado uma vez no carregamento (main.ts).
 */
export function installFullnessHooks(getBehaviour: (typeId: string) => ItemBehaviour | undefined, entityOf?: (pokemon: PokemonData) => Entity | undefined): number {
  let count = 0;
  for (const typeId of new Set([...Object.keys(FEED_AMOUNTS), ...POKE_FOOD])) {
    let behaviour: ItemBehaviour | undefined;
    try { behaviour = getBehaviour(typeId); }
    catch { behaviour = undefined; }
    if (!behaviour) continue;
    wrapBehaviourWithFullness(behaviour, entityOf);
    count++;
  }
  return count;
}
