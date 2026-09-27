/**
 * Música de batalha (frente motor; Cobblemon 1.8.2 client/sound/BattleMusicController.kt).
 *
 * O Cobblemon define três eventos de som vazios para resource packs preencherem — `battle.pvw.default` (selvagem),
 * `battle.pvp.default` (jogadores) e `battle.pvn.default` (NPC) — e só pausa a música do jogo quando o evento tem
 * som. Aqui os eventos existem no RP (`cobblemon.battle.pv*.default`, categoria music) e o script usa
 * `Player.playMusic(id, { loop, fade })`/`stopMusic()` (estáveis em 2.10). Como o servidor não sabe se um pack
 * preencheu os eventos (e `playMusic` com evento vazio calaria a música vanilla), tocar é opcional:
 * dynamic property do mundo `cobblemon:battle_music = true` (`/scriptevent cobblemon:battle_music on`).
 *
 * Início/fim: `tickBattleMusic` compara o estado de batalha de cada jogador a cada 10 ticks (sem depender de hooks);
 * as funções `startBattleMusic`/`stopBattleMusic` também podem ser chamadas direto pela batalha
 * (docs/pendencias/motor.md tem o trecho).
 */
import { Player, system, world } from "@minecraft/server";

export type BattleMusicKind = "pvw" | "pvp" | "pvn";
export const BATTLE_MUSIC_PROPERTY = "cobblemon:battle_music";
const FADE_IN = 1;

/** Id do evento de som (RP) para o tipo de batalha. */
export function battleMusicTrack(kind: BattleMusicKind): string {
  return `cobblemon.battle.${kind}.default`;
}

/** Tipo pela composição da batalha (PokemonBattle.isPvP/isPvN/isPvW). */
export function battleMusicKind(battle: { isPvP?: boolean; isPvN?: boolean; isPvW?: boolean } | undefined): BattleMusicKind | undefined {
  if (!battle) return undefined;
  if (battle.isPvP) return "pvp";
  if (battle.isPvN) return "pvn";
  return "pvw";
}

export function battleMusicEnabled(): boolean {
  try { return world.getDynamicProperty(BATTLE_MUSIC_PROPERTY) === true; }
  catch { return false; }
}

/** Jogador → faixa tocando. */
const playing = new Map<string, string>();

/** BattleMusicController.initializeMusic/switchMusic. */
export function startBattleMusic(player: Player, kind: BattleMusicKind, force = false): boolean {
  if (!force && !battleMusicEnabled()) return false;
  const track = battleMusicTrack(kind);
  if (playing.get(player.id) === track) return true;
  try {
    player.playMusic(track, { loop: true, fade: FADE_IN, volume: 1 });
    playing.set(player.id, track);
    return true;
  }
  catch (e) {
    console.warn(`[música] ${track}: ${e}`);
    return false;
  }
}

/** BattleMusicController.endMusic (fade) — volta a música normal do jogo. */
export function stopBattleMusic(player: Player): boolean {
  if (!playing.delete(player.id)) return false;
  // stopMusic não tem fade na 2.10 (o Java faz fade de saída); a música do jogo volta ao ciclo normal.
  try { player.stopMusic(); }
  catch { /* jogador saiu */ }
  return true;
}

export function isBattleMusicPlaying(playerId: string): boolean {
  return playing.has(playerId);
}

/** Uma passada: começa/para a música conforme o jogador entrou/saiu de batalha. */
export function tickBattleMusic(players: readonly Player[], battleOf: (player: Player) => { isPvP?: boolean; isPvN?: boolean; isPvW?: boolean } | undefined) {
  const enabled = battleMusicEnabled();
  const seen = new Set<string>();
  for (const player of players) {
    seen.add(player.id);
    const kind = enabled ? battleMusicKind(battleOf(player)) : undefined;
    if (kind) startBattleMusic(player, kind, true);
    else if (playing.has(player.id)) stopBattleMusic(player);
  }
  for (const id of [...playing.keys()]) if (!seen.has(id)) playing.delete(id);
}

let started = false;

export function startBattleMusicTicker(battleOf: (player: Player) => { isPvP?: boolean; isPvN?: boolean; isPvW?: boolean } | undefined) {
  if (started) return;
  started = true;
  system.runInterval(() => {
    try { tickBattleMusic(world.getAllPlayers(), battleOf); }
    catch (e) { console.warn(`[música] ${e}`); }
  }, 10);
  system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== BATTLE_MUSIC_PROPERTY) return;
    world.setDynamicProperty(BATTLE_MUSIC_PROPERTY, !/^(off|false|0)$/i.test(message.trim()));
  });
}
