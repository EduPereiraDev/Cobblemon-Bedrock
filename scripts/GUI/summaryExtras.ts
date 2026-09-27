/**
 * Frente msd-fase3: linhas extras na aba Informações do resumo, vindas de extensões (o Mega Showdown mostra o tipo Tera,
 * o fator Gigantamax e o nível de Dynamax: mixin/client/ui/SummaryMixin + DynamaxLevelHandler). Sem provedor (mundo
 * sem a extensão), o resumo fica exatamente como antes.
 */
import type { RawMessage } from "@minecraft/server";
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
