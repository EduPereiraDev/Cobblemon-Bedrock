/**
 * Tela das estatísticas do Cobblemon (adaptação da aba "Geral" da tela de Estatísticas do Java, onde o 1.8.2 registra
 * `stat.cobblemon.*`): o Bedrock não aceita estatísticas de add-on na tela vanilla, então `/cobblemon:stats` abre esta
 * lista (nome traduzido e valor no formato do vanilla).
 */
import type { Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { COBBLEMON_STATS, StatTable, formatStat, getStats } from "../events/PlayerStats";

/** Corpo da tela (função pura). */
export function statsBody(stats: StatTable): RawMessage {
  const rawtext: RawMessage[] = [];
  COBBLEMON_STATS.forEach((stat, i) => {
    if (i > 0) rawtext.push({ text: "\n" });
    rawtext.push({ text: "§7" }, { translate: `stat.cobblemon.${stat}` }, { text: `: §f${formatStat(stat, stats[stat])}§r` });
  });
  return { rawtext };
}

/** Mostra as estatísticas de `target` para `viewer`. */
export async function openStatsScreen(viewer: Player, target: Player = viewer): Promise<void> {
  const form = new ActionFormData()
    .title({ rawtext: [{ translate: "cobblemon.port.stats.title" }, { text: viewer.id === target.id ? "" : ` - ${target.name}` }] })
    .body(statsBody(getStats(target)))
    .button({ translate: "gui.done" });
  try { await form.show(viewer); } catch { }
}
