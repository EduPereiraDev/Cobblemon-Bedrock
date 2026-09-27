/**
 * Pokédex de cada jogador guardada em dynamic properties do próprio jogador, em pedaços de até 30 KB
 * (`cobblemon:pokedex:0`, `:1`, ... e `cobblemon:pokedex:count`). Cache em memória por jogador; cada
 * mudança real regrava só os pedaços que mudaram.
 *
 * API pública para as outras frentes: markSeen, markCaught, hasCaught, getSpeciesKnowledge, getDexCounts
 * (esta em DexData.ts/index.ts, com o dex regional).
 */
import { Player } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { getFormForAspects, getSpeciesData, toSpeciesId } from "../speciesData";
import { DexPokemonInfo, DexProgress, PokedexRecords, splitIntoChunks } from "./PokedexRecords";

export { DexProgress } from "./PokedexRecords";
export type { DexPokemonInfo } from "./PokedexRecords";

/** Quem guarda os dados (Player no jogo; objeto simples nos testes). */
export interface DexPropertyHolder {
  readonly id: string;
  getDynamicProperty(identifier: string): unknown;
  setDynamicProperty(identifier: string, value?: string | number | boolean): void;
}

export const DEX_PROPERTY_PREFIX = "cobblemon:pokedex:";
export const DEX_PROPERTY_COUNT = `${DEX_PROPERTY_PREFIX}count`;

interface CacheEntry {
  records: PokedexRecords;
  /** Pedaços gravados por último (para só regravar o que mudou). */
  chunks: string[];
  /** Adiar gravação (operações em lote). */
  batchDepth: number;
  dirty: boolean;
}

const cache = new Map<string, CacheEntry>();

/** Ouvintes de mudança (ex.: aviso "registrado" do scanner). */
type DexListener = (holder: DexPropertyHolder, info: DexPokemonInfo, knowledge: DexProgress) => void;
const listeners: DexListener[] = [];
export function onPokedexChanged(listener: DexListener) {
  listeners.push(listener);
}

/** Lê os pedaços do jogador. */
export function readPokedexChunks(holder: DexPropertyHolder): string[] {
  const count = holder.getDynamicProperty(DEX_PROPERTY_COUNT);
  if (typeof count !== "number" || count <= 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const value = holder.getDynamicProperty(`${DEX_PROPERTY_PREFIX}${i}`);
    chunks.push(typeof value === "string" ? value : "");
  }
  return chunks;
}

/** Carrega (ou pega do cache) a Pokédex do jogador. */
function getEntry(holder: DexPropertyHolder): CacheEntry {
  let entry = cache.get(holder.id);
  if (!entry) {
    const chunks = readPokedexChunks(holder);
    let records: PokedexRecords;
    try { records = PokedexRecords.parse(chunks.join("")); }
    catch (e) {
      console.warn(`Pokédex de ${holder.id} ilegível, recomeçando: ${e}`);
      records = new PokedexRecords();
    }
    entry = { records, chunks, batchDepth: 0, dirty: false };
    cache.set(holder.id, entry);
  }
  return entry;
}

/** Registros da Pokédex do jogador (não altere direto: use as funções daqui). */
export function getPokedex(holder: DexPropertyHolder): PokedexRecords {
  return getEntry(holder).records;
}

/** Grava os pedaços que mudaram. */
export function savePokedex(holder: DexPropertyHolder) {
  const entry = getEntry(holder);
  if (entry.batchDepth > 0) { entry.dirty = true; return; }
  const chunks = splitIntoChunks(entry.records.serialize());
  for (let i = 0; i < chunks.length; i++)
    if (entry.chunks[i] !== chunks[i]) holder.setDynamicProperty(`${DEX_PROPERTY_PREFIX}${i}`, chunks[i]);
  for (let i = chunks.length; i < entry.chunks.length; i++)
    holder.setDynamicProperty(`${DEX_PROPERTY_PREFIX}${i}`, undefined);
  if (chunks.length !== entry.chunks.length) holder.setDynamicProperty(DEX_PROPERTY_COUNT, chunks.length);
  entry.chunks = chunks;
  entry.dirty = false;
}

/** Faz várias mudanças direto nos registros e grava uma vez só no fim (só os pedaços alterados). */
export function batchPokedex<T>(holder: DexPropertyHolder, action: (records: PokedexRecords) => T): T {
  const entry = getEntry(holder);
  entry.batchDepth++;
  try { return action(entry.records); }
  finally {
    entry.batchDepth--;
    if (entry.batchDepth === 0) savePokedex(holder);
  }
}

/** Esquece o cache (jogador saiu). */
export function forgetPokedex(playerId: string) {
  cache.delete(playerId);
}

// ---------------------------------------------------------------------------------------------
// Conversão Pokémon → dados da Pokédex

/** Dados da Pokédex a partir de um Pokémon do port. */
export function dexInfoFromPokemon(pokemon: PokemonData | { species: string; aspects?: readonly string[]; gender?: string; shiny?: boolean; level?: number }): DexPokemonInfo {
  const species = toSpeciesId(pokemon.species);
  const aspects = pokemon.aspects ?? [];
  const speciesData = getSpeciesData(species);
  const form = speciesData ? getFormForAspects(speciesData, aspects)?.name ?? "Normal" : "Normal";
  return {
    species,
    form,
    aspects: [...aspects],
    gender: pokemon.gender ?? (aspects.includes("male") ? "m" : aspects.includes("female") ? "f" : ""),
    shiny: pokemon.shiny ?? aspects.includes("shiny"),
    level: pokemon.level,
  };
}

/** Dados da Pokédex a partir de espécie + aspectos. */
export function dexInfoFromSpecies(species: string, aspects: readonly string[] = []): DexPokemonInfo {
  return dexInfoFromPokemon({ species, aspects });
}

function toInfo(species: string | PokemonData | DexPokemonInfo, aspects?: readonly string[]): DexPokemonInfo {
  if (typeof species === "string") return dexInfoFromSpecies(species, aspects ?? []);
  if (species instanceof PokemonData) return dexInfoFromPokemon(species);
  if ("form" in species && typeof species.form === "string") return species;
  return dexInfoFromPokemon(species as unknown as PokemonData);
}

function register(holder: DexPropertyHolder, info: DexPokemonInfo, knowledge: DexProgress): boolean {
  const entry = getEntry(holder);
  const changed = knowledge === DexProgress.OWNED ? entry.records.obtain(info) : entry.records.encounter(info);
  if (!changed) return false;
  savePokedex(holder);
  for (const listener of listeners) {
    try { listener(holder, info, knowledge); }
    catch (e) { console.warn(`Erro num ouvinte da Pokédex: ${e}`); }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// API pública

/**
 * Marca como visto (PokedexManager.encounter). Aceita um PokemonData ou espécie + aspectos.
 * Gatilhos do Cobblemon: início de batalha selvagem, cada Pokémon que entra em campo numa batalha
 * (para todos os jogadores dela), desafio PvP e scanner da Pokédex.
 * @returns verdadeiro se a Pokédex mudou.
 */
export function markSeen(player: DexPropertyHolder, species: string | PokemonData | DexPokemonInfo, aspects?: readonly string[]): boolean {
  try { return register(player, toInfo(species, aspects), DexProgress.SEEN); }
  catch (e) { console.warn(`markSeen falhou: ${e}`); return false; }
}

/**
 * Marca como capturado/obtido (PokedexManager.obtain). Gatilhos do Cobblemon: Pokémon entra no time/PC
 * (captura, inicial, troca, comando), evolui, muda de aspecto ou sobe de nível.
 * @returns verdadeiro se a Pokédex mudou.
 */
export function markCaught(player: DexPropertyHolder, species: string | PokemonData | DexPokemonInfo, aspects?: readonly string[]): boolean {
  try { return register(player, toInfo(species, aspects), DexProgress.OWNED); }
  catch (e) { console.warn(`markCaught falhou: ${e}`); return false; }
}

/** Maior conhecimento da espécie (usado pela Repeat Ball). */
export function getSpeciesKnowledge(player: DexPropertyHolder, species: string): DexProgress {
  return getPokedex(player).getKnowledgeForSpecies(toSpeciesId(species));
}

/** A espécie (ou a forma, se informada) já foi capturada. */
export function hasCaught(player: DexPropertyHolder, species: string, form?: string): boolean {
  const records = getPokedex(player);
  const id = toSpeciesId(species);
  return form === undefined
    ? records.getKnowledgeForSpecies(id) === DexProgress.OWNED
    : records.getFormKnowledge(id, form) === DexProgress.OWNED;
}

/** A espécie já foi vista (ou capturada). */
export function hasSeen(player: DexPropertyHolder, species: string): boolean {
  return getPokedex(player).getKnowledgeForSpecies(toSpeciesId(species)) !== DexProgress.UNREGISTERED;
}

/** CaughtCount global (captura crítica). */
export function getCaughtCount(player: DexPropertyHolder): number {
  return getPokedex(player).getCaughtCount();
}

/** Guarda de tipo para chamadas vindas de código que só tem um Player. */
export function asDexHolder(player: Player): DexPropertyHolder {
  return player;
}
