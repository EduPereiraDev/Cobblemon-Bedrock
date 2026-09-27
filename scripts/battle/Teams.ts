/**
 * Instância do jogo do TeamManager (equipes Multi): liga tempo, distâncias da config, "ocupado" (batalha ou troca),
 * Pokémon utilizáveis e o início da batalha 2×2 com a regra de nível. Também tira da equipe quem sai do servidor.
 */
import { Player, system, world } from "@minecraft/server";
import { TeamManager } from "./TeamManager";
import { startMultiBattle, tryGetBattleFromEntity } from "./index";
import { getSafeTeam } from "../pokemonStorage";
import { getConfig } from "../Config";
import { tradeManager } from "../trade/TradeUI";

function configNumber(key: string, fallback: number): number {
  const value = (getConfig() as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : fallback;
}

export const teamManager = new TeamManager({
  now: () => system.currentTick,
  schedule: (fn, ticks) => { system.runTimeout(fn, ticks); },
  teamDistance: () => configNumber("tradeMaxDistance", 12),
  challengeDistance: () => configNumber("battlePvPMaxDistance", 32),
  isBusy: player => !!tryGetBattleFromEntity(player) || !!tradeManager.getActiveTrade(player.id),
  hasPokemon: player => getSafeTeam(player).some(pokemon => !!pokemon && pokemon.currentHealth > 0),
  startBattle: (team1, team2, level) =>
    !!startMultiBattle(team1, team2, level > 0 ? { team: { setLevel: level } } : {}),
});

/** `/cobblemon:abandonmultiteam` e "Abandonar grupo": false se o jogador não estava em equipe. */
export function abandonMultiTeam(player: Player): boolean {
  return teamManager.removeTeamMember(player.id);
}

try {
  world.afterEvents.playerLeave.subscribe(({ playerId }) => teamManager.onPlayerLeave(playerId));
}
catch (e) {
  console.warn(`[cobblemon] equipes Multi: não foi possível assinar playerLeave: ${e}`);
}
