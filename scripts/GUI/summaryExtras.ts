/**
 * Frente msd-fase3: linhas extras na aba Informações do resumo, vindas de extensões (o Mega Showdown mostra o tipo Tera,
 * o fator Gigantamax e o nível de Dynamax: mixin/client/ui/SummaryMixin + DynamaxLevelHandler). Sem provedor (mundo
 * sem a extensão), o resumo fica exatamente como antes.
 */
import type { Player, RawMessage } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";

export type SummaryInfoProvider = (pokemon: PokemonData) => RawMessage[];

const providers: SummaryInfoProvider[] = [];

/** Registra um provedor (idempotente). */
export function addSummaryInfoProvider(provider: SummaryInfoProvider): void {
  if (!providers.includes(provider)) providers.push(provider);
}

/** Só para os testes. */
export function clearSummaryInfoProviders(): void {
  providers.length = 0;
}

/** Linhas extras (provedor com erro não derruba o resumo). */
export function extraSummaryInfo(pokemon: PokemonData): RawMessage[] {
  const out: RawMessage[] = [];
  for (const provider of providers) {
    try { out.push(...provider(pokemon)); }
    catch (e) { console.warn(`[resumo] linha extra: ${e}`); }
  }
  return out;
}

/**
 * Frente msd-fase6: a lista de golpes de um Pokémon do jogador foi mostrada (aba Golpes do resumo e menu de golpes; o
 * `MoveSlotWidget` do resumo do Cobblemon, onde uma extensão pode conferir o moveset, ex.: forma que depende de um
 * golpe). O ouvinte pode mudar o Pokémon recebido (e gravar); devolve true se mudou algo. Sem ouvinte, nada muda.
 */
export type MovesShownListener = (player: Player, pokemon: PokemonData) => boolean | void;

const movesShownListeners: MovesShownListener[] = [];

/** Registra um ouvinte (idempotente). */
export function addMovesShownListener(listener: MovesShownListener): void {
  if (!movesShownListeners.includes(listener)) movesShownListeners.push(listener);
}

export function removeMovesShownListener(listener: MovesShownListener): void {
  const i = movesShownListeners.indexOf(listener);
  if (i >= 0) movesShownListeners.splice(i, 1);
}

/** Só para os testes. */
export function clearMovesShownListeners(): void {
  movesShownListeners.length = 0;
}

/** Avisa os ouvintes (erro de um não derruba a tela). Devolve se algum mudou o Pokémon. */
export function notifyMovesShown(player: Player, pokemon: PokemonData): boolean {
  let changed = false;
  for (const listener of movesShownListeners) {
    try { if (listener(player, pokemon)) changed = true; }
    catch (e) { console.warn(`[golpes] ouvinte: ${e}`); }
  }
  return changed;
}
