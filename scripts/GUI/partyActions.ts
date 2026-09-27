/**
 * Frente msd-fase2: ações extras no menu de um Pokémon do time (o menu do time substitui a roda de interação do
 * Cobblemon, scripts/GUI/Party.ts). Extensões registram um provedor; sem provedor (mundo sem o Mega Showdown) o menu
 * fica exatamente como antes. O Mega Showdown põe aqui Mega Evoluir / Ultra Explosão / Primal (roda de interação do
 * MSD: mixin/PokemonEntityMixin.showInteractionWheel).
 */
import type { Player, RawMessage } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";

export interface PartyAction {
  label: RawMessage;
  icon?: string;
  /** Roda a ação; o menu fecha depois. */
  run: (player: Player, pokemon: PokemonData) => void | Promise<void>;
}

/** `isOut` = o Pokémon está fora da bola (a roda do Cobblemon é aberta na entidade). */
export type PartyActionProvider = (player: Player, pokemon: PokemonData, isOut: boolean) => PartyAction[];

const providers: PartyActionProvider[] = [];

/** Registra um provedor (idempotente). */
export function addPartyActionProvider(provider: PartyActionProvider): void {
  if (!providers.includes(provider)) providers.push(provider);
}

/** Só para os testes. */
export function clearPartyActionProviders(): void {
  providers.length = 0;
}

/** Ações extras para o Pokémon (provedor com erro não derruba o menu). */
export function extraPartyActions(player: Player, pokemon: PokemonData, isOut: boolean): PartyAction[] {
  const out: PartyAction[] = [];
  for (const provider of providers) {
    try { out.push(...provider(player, pokemon, isOut)); }
    catch (e) { console.warn(`[menu do time] ação extra: ${e}`); }
  }
  return out;
}
