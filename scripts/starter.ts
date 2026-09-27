/**
 * Escolha do Pokémon inicial (port de `starter/CobbledStarterHandler.kt` + StarterConfig).
 *
 * Dynamic properties no jogador:
 * - `starter_selected`: já escolheu (não pode escolher de novo, a menos que um admin resete);
 * - `starter_prompted`: já recebeu a tela automática no login (para `promptStarterOnceOnly`).
 */
import { Player, system, world } from "@minecraft/server";
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

/** Tentativas de 10 ticks enquanto o cliente responde UserBusy na tela automática (~3 min). */
const JOIN_BUSY_RETRIES = 360;
/** Espera o jogador se mexer (cliente carregado) antes da tela automática, no máximo isto (ticks). */
const JOIN_READY_MAX_TICKS = 400;
const joinPrompts = new Set<string>();

/** Resolve quando o jogador se mexe/olha em volta (o cliente terminou de carregar) ou no tempo máximo. */
function whenPlayerReady(player: Player): Promise<void> {
  return new Promise(resolve => {
    let start: { x: number; y: number; z: number; ry: number; rx: number } | undefined;
    let waited = 0;
    const id = system.runInterval(() => {
      waited += 10;
      if (!player.isValid) { system.clearRun(id); resolve(); return; }
      try {
        const l = player.location, r = player.getRotation();
        const now = { x: l.x, y: l.y, z: l.z, ry: r.y, rx: r.x };
        if (!start) start = now;
        const moved = Math.abs(now.x - start.x) + Math.abs(now.z - start.z) > 0.2 || Math.abs(now.ry - start.ry) + Math.abs(now.rx - start.rx) > 2;
        if (moved || waited >= JOIN_READY_MAX_TICKS) { system.clearRun(id); resolve(); }
      }
      catch { system.clearRun(id); resolve(); }
    }, 10);
  });
}

/**
 * Abre a tela automática do login. Só marca "já oferecida" se a tela chegou a aparecer: com o pacote grande o
 * cliente real fica muito tempo carregando e a tela voltava UserBusy e se perdia (o bot de teste não carrega nada).
 */
export async function promptStarterOnJoin(player: Player) {
  if (!shouldPromptOnJoin(player) || joinPrompts.has(player.id)) return;
  joinPrompts.add(player.id);
  try {
    await whenPlayerReady(player);
    if (!player.isValid || !shouldPromptOnJoin(player)) return;
    const outcome: { busy?: boolean } = {};
    const choice = await showStarterGUI(player, { busyRetries: JOIN_BUSY_RETRIES, outcome });
    if (!player.isValid) return;
    if (!outcome.busy) player.setDynamicProperty(PROMPTED, true);
    if (choice !== undefined && !hasSelectedStarter(player) && !hasTeam(player)) giveStarter(player, choice);
  }
  finally { joinPrompts.delete(player.id); }
}

/** Lembrete no HUD enquanto o jogador não escolheu o inicial (o Java mostra "Pressione M para escolher..."). */
export function startStarterReminder() {
  system.runInterval(() => {
    const config = getConfig();
    if (!config.allowStarterOnJoin) return;
    for (const player of world.getAllPlayers()) {
      try {
        if (hasSelectedStarter(player) || hasTeam(player)) continue;
        player.onScreenDisplay.setActionBar({ translate: "cobblemon.ui.starter.chooseyourstarter", with: ["/cobblemon:starter"] });
      }
      catch { }
    }
  }, 40);
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
