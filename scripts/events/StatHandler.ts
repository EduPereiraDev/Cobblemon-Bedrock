/**
 * `events/StatHandler.kt` do Cobblemon 1.8.2: liga os eventos de batalha às estatísticas de jogador
 * (`scripts/events/PlayerStats.ts`). Os demais contadores sobem direto onde o evento acontece (captura, troca,
 * fóssil e evolução pela Progresso/Evolution, nível no `gainExp`, soltar no menu do time, montaria no Riding,
 * Poké Rod no FishingController).
 */
import { Player, system, world } from "@minecraft/server";
import { CobblemonEvents } from "./CobblemonEvents";
import { awardStat, flushRidingDistance } from "./PlayerStats";

let registered = false;

export function registerStatHandlers() {
  if (registered) return;
  registered = true;
  // onBattleStart: todos os jogadores da batalha.
  CobblemonEvents.on("BATTLE_STARTED", battle => {
    for (const player of safePlayers(battle)) awardStat(player, "battles_total");
  });
  // onFleeBattle: o primeiro ator jogador.
  CobblemonEvents.on("BATTLE_FLED", battle => {
    const player = safePlayers(battle)[0];
    if (player) awardStat(player, "battles_fled");
  });
  // onWinBattle: só vitória que não foi captura, em batalha contra selvagem; os jogadores do lado vencedor.
  CobblemonEvents.on("BATTLE_VICTORY", (battle, winners, _losers, wasCaught) => {
    if (wasCaught) return;
    let pvw = false;
    try { pvw = battle.isPvW; } catch { }
    if (!pvw) return;
    for (const actor of winners) {
      const player = actor.actor;
      if (player instanceof Player && player.isValid) awardStat(player, "battles_won");
    }
  });
  // Distância montado: grava o acumulado a cada 5 s e ao sair.
  system.runInterval(() => flushRidingDistance(), 100);
  world.beforeEvents.playerLeave.subscribe(({ player }) => {
    try { flushRidingDistance(player); } catch { }
  });
}

function safePlayers(battle: { players: Player[] }): Player[] {
  try { return battle.players.filter(player => player.isValid); }
  catch { return []; }
}
