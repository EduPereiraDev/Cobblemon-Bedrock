import { Player, system } from "@minecraft/server";

/**
 * Sons do overlay do time ao ganhar EXP (PartyOverlayDataControl do cliente do Cobblemon 1.8.2, disparado pelo
 * ExpGainedDataPacket de Pokemon.addExperienceWithPlayer — batalha, doces e /levelup):
 *  - `gui.levelup_start` (a barra enchendo) a cada ganho de EXP; um ganho novo corta o anterior;
 *  - `BAR_UPDATE_BEFORE_TIME` = 15 ticks depois, se subiu de nível: `gui.levelup` (o jingle), a não ser que uma
 *    evolução tenha ficado disponível (aí o jingle é `evolution.notification`, que o port já toca em
 *    evolution/Evolution.ts ao marcar a evolução pronta).
 * São sons de interface: só o dono ouve (player.playSound).
 */

export const LEVELUP_START_SOUND = "cobblemon.gui.levelup_start";
export const LEVELUP_SOUND = "cobblemon.gui.levelup";
/** PartyOverlayDataControl.BAR_UPDATE_BEFORE_TIME. */
export const BAR_UPDATE_BEFORE_TIME = 15;

/** Resultado mínimo de PokemonData.gainExp / AddExperienceResult. */
export interface ExpGainLike {
  oldLevel: number;
  newLevel: number;
  experienceAdded: number;
  evolutions?: readonly string[];
}

const pendingJingle = new Map<string, number>();

/** Toca os sons do ganho de EXP para o dono. Sem EXP ganha (nível máximo), nada toca. */
export function playExpGainedSounds(player: Player | undefined, result: ExpGainLike) {
  if (!player || result.experienceAdded <= 0) return;
  try {
    if (!player.isValid) return;
    try { player.runCommand(`stopsound @s ${LEVELUP_START_SOUND}`); } catch { }
    player.playSound(LEVELUP_START_SOUND);
  }
  catch {
    return;
  }
  if (result.newLevel <= result.oldLevel || (result.evolutions?.length ?? 0) > 0) return;
  const previous = pendingJingle.get(player.id);
  if (previous !== undefined) system.clearRun(previous);
  const id = system.runTimeout(() => {
    pendingJingle.delete(player.id);
    try { if (player.isValid) player.playSound(LEVELUP_SOUND); } catch { }
  }, BAR_UPDATE_BEFORE_TIME);
  pendingJingle.set(player.id, id);
}
