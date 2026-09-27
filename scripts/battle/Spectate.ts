/**
 * Espectadores de batalha (Cobblemon 1.8.2: PokemonBattle.spectators, SpectateBattleHandler, SpectateBattleCommand,
 * RequestInteractionsHandler e a opção "Assistir" da roda de interação).
 *
 * - Interagir com um jogador (ou Pokémon) em batalha, sem estar em batalha, com `allowSpectating` e a até
 *   `battleSpectateMaxDistance` blocos: vira espectador. `/cobblemon:spectatebattle <jogador>` (admin) ignora
 *   config e distância, como o comando do Cobblemon.
 * - O espectador recebe o histórico do chat da batalha (BattleMessagePacket(chatLog)) e todas as mensagens
 *   seguintes (broadcastChatMessage já inclui `spectators`). A tela do Cobblemon vira uma tela só de leitura com o
 *   estado atual (Atualizar / Parar de assistir) e uma linha na actionbar a cada segundo.
 * - Sai ao fechar pela tela, ao sair do jogo, ao entrar numa batalha ou quando a batalha acaba.
 */
import { Entity, Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { getConfig } from "../Config";
import { message } from "../language";
import { EntityUtils } from "../utils";
import { ActorType } from "./BattleActor";
import type { PokemonBattle } from "./PokemonBattle";
import type { PokemonData } from "../Pokemon";

/** Quantas mensagens do histórico o espectador recebe ao entrar. */
export const SPECTATE_HISTORY = 12;

export type SpectateError = "disabled" | "self" | "not_in_battle" | "in_battle" | "too_far";

const ERROR_KEYS: Record<SpectateError, string> = {
  disabled: "cobblemon.ui.interact.unavailable",
  self: "cobblemon.command.spectatebattle.self_spectate_disallowed",
  not_in_battle: "cobblemon.command.spectatebattle.player_not_in_battle",
  in_battle: "cobblemon.command.spectatebattle.while_battling_disallowed",
  too_far: "cobblemon.ui.interact.failed",
};

export function spectateErrorMessage(error: SpectateError): RawMessage {
  return message.error({ translate: ERROR_KEYS[error] });
}

export interface SpectateCheck {
  allowSpectating: boolean;
  maxDistance: number;
  /** Comando: sem checar config nem distância. */
  force?: boolean;
  self: boolean;
  targetInBattle: boolean;
  spectatorInBattle: boolean;
  /** Distância até o alvo (Infinity em outra dimensão). */
  distance: number;
}

/** Regras do SpectateBattleHandler/RequestInteractionsHandler, na mesma ordem. */
export function checkSpectate(check: SpectateCheck): SpectateError | undefined {
  if (!check.force && !check.allowSpectating) return "disabled";
  if (check.self) return "self";
  if (!check.targetInBattle) return "not_in_battle";
  if (check.spectatorInBattle) return "in_battle";
  if (!check.force && !(check.distance <= check.maxDistance)) return "too_far";
  return undefined;
}

function distanceBetween(a: Entity, b: Entity): number {
  try {
    if (a.dimension.id !== b.dimension.id) return Infinity;
    return EntityUtils.DistanceBetween(a.location, b.location);
  }
  catch {
    return Infinity;
  }
}

export function isSpectating(battle: PokemonBattle, player: Player): boolean {
  return battle.spectators.some(x => x.id === player.id);
}

/** Batalha que o jogador está assistindo. */
export function getSpectatedBattle(player: Player, battles: Iterable<PokemonBattle>): PokemonBattle | undefined {
  for (const battle of battles) if (!battle.ended && isSpectating(battle, player)) return battle;
  return undefined;
}

/** Adiciona o espectador e manda o histórico do chat. @returns false se já assistia. */
export function addSpectator(battle: PokemonBattle, player: Player): boolean {
  if (isSpectating(battle, player)) return false;
  battle.spectators.push(player);
  player.sendMessage(message.color("Gray", message.With("cobblemon.port.spectate.started", [battleTitle(battle)])));
  for (const line of battle.chatLog.slice(-SPECTATE_HISTORY)) player.sendMessage(line);
  return true;
}

/** RemoveSpectatorHandler. */
export function removeSpectator(battle: PokemonBattle, player: Player | string, notify = true): boolean {
  const id = typeof player === "string" ? player : player.id;
  const index = battle.spectators.findIndex(x => x.id === id);
  if (index === -1) return false;
  const [removed] = battle.spectators.splice(index, 1);
  if (notify) {
    try { if (removed.isValid) removed.sendMessage(message.color("Gray", { translate: "cobblemon.port.spectate.stopped" })); } catch { }
  }
  return true;
}

/**
 * SpectateBattleHandler.spectateBattle: `spectator` passa a assistir a batalha de `target` (jogador ou Pokémon em
 * batalha). @returns a batalha, ou o erro.
 */
export function spectateBattleOf(spectator: Player, target: Entity, battle: PokemonBattle | undefined, spectatorInBattle: boolean, force = false): PokemonBattle | SpectateError {
  const config = getConfig();
  const error = checkSpectate({
    allowSpectating: config.allowSpectating,
    maxDistance: config.battleSpectateMaxDistance,
    force,
    self: spectator.id === target.id,
    targetInBattle: !!battle && !battle.ended,
    spectatorInBattle,
    distance: distanceBetween(spectator, target),
  });
  if (error) return error;
  addSpectator(battle!, spectator);
  return battle!;
}

// ---------------------------------------------------------------------------------------------
// Tela e actionbar (só leitura)

function percent(pokemon: PokemonData): number {
  const max = Math.max(1, pokemon.maxHealth);
  return Math.max(0, Math.round(pokemon.currentHealth / max * 100));
}

function hpColor(value: number) {
  return value <= 0 ? "§8" : value > 50 ? "§a" : value > 20 ? "§e" : "§c";
}

/** "Jogador A x Jogador B". */
export function battleTitle(battle: PokemonBattle): RawMessage {
  const side = (index: 0 | 1) => {
    const names: RawMessage[] = [];
    battle.sides[index].actors.forEach((actor, i) => {
      if (i > 0) names.push({ text: " & " });
      names.push(actor.getName());
    });
    return names;
  };
  return { rawtext: [...side(0), { text: " §7x§r " }, ...side(1)] };
}

/** Linha de um Pokémon em campo: nome, HP em % (espectadores veem proporção, como os oponentes) e status. */
export function activeLine(pokemon: PokemonData): RawMessage {
  const hp = percent(pokemon);
  const parts: RawMessage[] = [pokemon.getTranslatedName(), { text: ` §7Lv.${pokemon.level} ${hpColor(hp)}${hp}%§r` }];
  if (pokemon.currentHealth <= 0) parts.push({ text: " §8" }, { translate: "cobblemon.ui.status.fnt" });
  else if (pokemon.status) parts.push({ text: " §c" }, { translate: `cobblemon.ui.status.${pokemon.status}` });
  return { rawtext: parts };
}

/** Estado atual para a tela: turno, cada ator com os Pokémon em campo e quantos ainda podem lutar. */
export function battleStatusLines(battle: PokemonBattle): RawMessage[] {
  const lines: RawMessage[] = [message.With("cobblemon.battle.turn", [battle.turn.toString()])];
  for (const side of battle.sides) {
    for (const actor of side.actors) {
      const healthy = actor.pokemon.filter(x => x.currentHealth > 0).length;
      const party = actor.type === ActorType.WILD ? "" : ` §7(${healthy}/${actor.pokemon.length})`;
      lines.push({ rawtext: [{ text: "§l" }, actor.getName(), { text: `§r${party}` }] });
      for (const active of actor.activePokemon) {
        if (!active) continue;
        lines.push({ rawtext: [{ text: "  " }, activeLine(active.data)] });
      }
    }
  }
  return lines;
}

/** Linha curta da actionbar: Pokémon em campo de cada lado. */
export function spectatorActionBar(battle: PokemonBattle): RawMessage {
  const sideText = (index: 0 | 1): RawMessage[] => {
    const out: RawMessage[] = [];
    battle.sides[index].getActivePokemon().forEach(active => {
      if (!active) return;
      if (out.length > 0) out.push({ text: ", " });
      const hp = percent(active.data);
      out.push(active.data.getTranslatedName(), { text: ` ${hpColor(hp)}${hp}%§r` });
    });
    return out;
  };
  return { rawtext: [...sideText(0), { text: " §7x§r " }, ...sideText(1)] };
}

function join(lines: RawMessage[], separator = "\n"): RawMessage {
  const out: RawMessage[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ text: separator });
    out.push(line);
  });
  return { rawtext: out };
}

/** Tela de espectador (só leitura). Reabre em "Atualizar" até o jogador sair ou a batalha acabar. */
export async function openSpectatorView(player: Player, battle: PokemonBattle): Promise<void> {
  while (player.isValid && !battle.ended && isSpectating(battle, player)) {
    const recent = battle.chatLog.slice(-6);
    const body: RawMessage[] = [...battleStatusLines(battle)];
    if (recent.length) body.push({ text: "\n§7—" }, ...recent);
    const response = await new ActionFormData()
      .title(battleTitle(battle))
      .body(join(body))
      .button({ translate: "cobblemon.port.spectate.refresh" })
      .button({ translate: "cobblemon.port.spectate.stop" })
      .show(player);
    if (response.canceled || response.selection === undefined) return;
    if (response.selection === 1) {
      removeSpectator(battle, player);
      return;
    }
  }
}

/**
 * Checagem periódica (PokemonBattle.tick): tira quem saiu do jogo ou entrou numa batalha e mostra a actionbar.
 * @param inBattle diz se o jogador está em alguma batalha.
 */
export function tickSpectators(battle: PokemonBattle, inBattle: (player: Player) => boolean) {
  for (const spectator of [...battle.spectators]) {
    let valid = false;
    try { valid = spectator.isValid; } catch { }
    if (!valid) {
      removeSpectator(battle, spectator.id, false);
      continue;
    }
    if (inBattle(spectator)) {
      removeSpectator(battle, spectator);
      continue;
    }
    try { spectator.onScreenDisplay.setActionBar(spectatorActionBar(battle)); } catch { }
  }
}

/** Fim da batalha: avisa e esvazia a lista. */
export function releaseSpectators(battle: PokemonBattle) {
  for (const spectator of battle.spectators) {
    try { if (spectator.isValid) spectator.sendMessage(message.color("Gray", { translate: "cobblemon.port.spectate.ended" })); } catch { }
  }
  battle.spectators = [];
}
