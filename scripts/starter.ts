/**
 * Escolha do Pokémon inicial (port de `starter/CobbledStarterHandler.kt` + StarterConfig).
 *
 * Dynamic properties no jogador:
 * - `starter_selected`: já escolheu (não pode escolher de novo, a menos que um admin resete);
 * - `starter_prompted`: já recebeu a tela automática no login (para `promptStarterOnceOnly`).
 */
import { Player } from "@minecraft/server";
import { showStarterGUI } from "./GUI";
import { getConfig, getGameRule } from "./Config";
import { getTeam, storePokemonInFirstSpace } from "./pokemonStorage";
import { createPokemonFromProperties } from "./GUI/PokemonEdit";

const SELECTED = "starter_selected";
const PROMPTED = "starter_prompted";

export function hasTeam(player: Player): boolean {
  return (getTeam(player) ?? []).some(pokemon => pokemon != null);
}

export function hasSelectedStarter(player: Player): boolean {
  return player.getDynamicProperty(SELECTED) === true;
}

/** Libera o jogador para escolher o inicial de novo (pokemonrestart). */
export function resetStarter(player: Player) {
  player.setDynamicProperty(SELECTED, undefined);
  player.setDynamicProperty(PROMPTED, undefined);
}

/** Deve abrir a tela sozinha no login? (allowStarterOnJoin + promptStarterOnceOnly). */
export function shouldPromptOnJoin(player: Player): boolean {
  const config = getConfig();
  if (!config.allowStarterOnJoin || hasSelectedStarter(player) || hasTeam(player)) return false;
  return !(config.promptStarterOnceOnly && player.getDynamicProperty(PROMPTED) === true);
}

/** Abre a tela automática do login e marca que já foi oferecida. */
export async function promptStarterOnJoin(player: Player) {
  if (!shouldPromptOnJoin(player)) return;
  player.setDynamicProperty(PROMPTED, true);
  await offerStarter(player);
}

/**
 * Mostra a tela de iniciais se o jogador ainda pode escolher.
 * @param force admin (openstarterscreen): ignora a escolha anterior e o time atual.
 */
export async function offerStarter(player: Player, force = false) {
  if (!force && (hasSelectedStarter(player) || hasTeam(player))) {
    player.sendMessage({ translate: "cobblemon.ui.starter.alreadyselected" });
    return;
  }
  const choice = await showStarterGUI(player);
  if (choice === undefined || !player.isValid) return;
  if (!force && (hasSelectedStarter(player) || hasTeam(player))) return;
  giveStarter(player, choice);
}

/** Cria e entrega o inicial a partir da entrada da config ("bulbasaur level=10"). */
export function giveStarter(player: Player, entry: string) {
  const pokemon = createPokemonFromProperties(entry);
  pokemon.ogTrainer ??= player.name;
  // Gamerule doShinyStarters (CobbledStarterHandler): o inicial sai shiny.
  if (getGameRule("doShinyStarters")) {
    pokemon.shiny = true;
    if (!pokemon.aspects.includes("shiny")) pokemon.aspects = ["shiny", ...pokemon.aspects];
  }
  player.setDynamicProperty(SELECTED, true);
  player.setDynamicProperty("cobblemon:starter_uuid", pokemon.uuid); // frente dados-ia: q.player.get_starter_uuid
  const result = storePokemonInFirstSpace(pokemon, player);
  if (result) player.sendMessage(result);
}
