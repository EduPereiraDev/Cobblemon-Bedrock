/**
 * Estatísticas de jogador do Cobblemon 1.8.2 (`api/stats/CobblemonStats.kt` + `events/StatHandler.kt` +
 * `mixin/ServerPlayerMixin.checkRidingStatistics`).
 *
 * O Bedrock não deixa add-on registrar estatística na tela de Estatísticas vanilla (NÃO POSSÍVEL NO BEDROCK), então os
 * 21 contadores ficam numa dynamic property do jogador (`cobblemon:stats`, JSON) e aparecem em
 * `/cobblemon:stats [jogador]` (tela com os nomes `stat.cobblemon.*` e o formato de distância do vanilla).
 *
 * Quando cada um sobe (igual ao StatHandler do 1.8.2):
 * - captured / shinies_captured: captura (POKEMON_CAPTURED) — `recordCapture` da Progresso;
 * - released: soltar pela tela do time/PC (ReleasePokemonEvent.Post);
 * - evolved: fim de uma evolução (EVOLUTION_COMPLETE; o Shedinja da muda não conta);
 * - level_up: uma vez por ganho de EXP que muda o nível (LEVEL_UP_EVENT);
 * - battles_won: vencedores jogadores de batalha contra selvagem, sem ser por captura (BATTLE_VICTORY com isPvW);
 * - battles_fled: o selvagem ficou longe demais (BATTLE_FLED);
 * - battles_total: início de batalha, para cada jogador (BATTLE_STARTED_POST);
 * - dex_entries: Pokémon ganho (POKEMON_GAINED: entrar no time/PC, evoluir);
 * - traded: cada participante de uma troca concluída; fossils_revived: fóssil revivido;
 * - times_ridden: montar (RIDE_EVENT_POST); rod_casts / reel_ins: arremessar / recolher a Poké Rod;
 * - riding_land / riding_air / riding_liquid: centímetros percorridos montado, pelo estilo atual (mixin).
 * `battles_lost`, `pokemon_interacted_with`, `eggs_collected` e `eggs_hatched` existem no registro do 1.8.2, mas nada
 * os incrementa (sem ovos no jogo base): ficam em 0, como lá.
 */
import { Player, world } from "@minecraft/server";

export const STATS_PROPERTY = "cobblemon:stats";

/** Ordem do `CobblemonStats.registerStats`. */
export const COBBLEMON_STATS = [
  "captured", "shinies_captured", "released", "evolved", "level_up", "battles_won", "battles_lost", "battles_fled",
  "battles_total", "dex_entries", "eggs_collected", "eggs_hatched", "traded", "fossils_revived", "times_ridden",
  "rod_casts", "reel_ins", "pokemon_interacted_with", "riding_land", "riding_air", "riding_liquid",
] as const;
export type CobblemonStat = (typeof COBBLEMON_STATS)[number];

/** Estatísticas com StatFormatter.DISTANCE (valor em centímetros). */
export const DISTANCE_STATS: ReadonlySet<CobblemonStat> = new Set(["riding_land", "riding_air", "riding_liquid"]);

/** Algo que guarda dynamic properties (o jogador; nos testes, um objeto falso). */
export interface StatHolder {
  getDynamicProperty(key: string): unknown;
  setDynamicProperty(key: string, value?: string | number | boolean): void;
}

export type StatTable = Record<CobblemonStat, number>;

export function emptyStats(): StatTable {
  return Object.fromEntries(COBBLEMON_STATS.map(stat => [stat, 0])) as StatTable;
}

/** Lê a tabela (JSON inválido ou ausente → tudo 0). */
export function parseStats(raw: unknown): StatTable {
  const stats = emptyStats();
  if (typeof raw !== "string" || !raw) return stats;
  try {
    const json = JSON.parse(raw);
    if (json && typeof json === "object")
      for (const stat of COBBLEMON_STATS) {
        const value = (json as Record<string, unknown>)[stat];
        if (typeof value === "number" && Number.isFinite(value) && value > 0) stats[stat] = Math.floor(value);
      }
  }
  catch { }
  return stats;
}

export function getStats(holder: StatHolder): StatTable {
  let raw: unknown;
  try { raw = holder.getDynamicProperty(STATS_PROPERTY); } catch { }
  return parseStats(raw);
}

export function getStat(holder: StatHolder, stat: CobblemonStat): number {
  return getStats(holder)[stat];
}

/** `ServerPlayer.awardStat(stat, amount)`: soma e grava. */
export function awardStat(holder: StatHolder | undefined, stat: CobblemonStat, amount = 1) {
  if (!holder || !(amount > 0)) return;
  try {
    if ((holder as { isValid?: boolean }).isValid === false) return;
    const stats = getStats(holder);
    stats[stat] = Math.min(Number.MAX_SAFE_INTEGER, stats[stat] + Math.floor(amount));
    holder.setDynamicProperty(STATS_PROPERTY, JSON.stringify(stats));
  }
  catch (e) { console.warn(`Não foi possível gravar a estatística ${stat}: ${e}`); }
}

/** Zera (comando de administrador). */
export function resetStats(holder: StatHolder) {
  try { holder.setDynamicProperty(STATS_PROPERTY, undefined); } catch { }
}

const DECIMAL = (value: number) => value.toFixed(2);

/** StatFormatter do vanilla: DEFAULT (número com separador) ou DISTANCE (cm → m → km). */
export function formatStat(stat: CobblemonStat, value: number): string {
  // NumberFormat.getIntegerInstance(Locale.US) à mão (o QuickJS do Bedrock não garante toLocaleString).
  if (!DISTANCE_STATS.has(stat)) return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const meters = value / 100;
  const km = meters / 1000;
  if (km > 0.5) return `${DECIMAL(km)} km`;
  if (meters > 0.5) return `${DECIMAL(meters)} m`;
  return `${value} cm`;
}

// ---------------------------------------------------------------------------------------------
// Distância montado (checkRidingStatistics): acumula por tick e grava de tempos em tempos.

const pendingDistance = new Map<string, Partial<Record<CobblemonStat, number>>>();

/**
 * Soma a distância (em blocos) andada montado num Pokémon com o estilo `style`. O vanilla arredonda cada passo para
 * centímetros (`Math.round(sqrt(dx²+dy²+dz²) × 100)`).
 */
export function addRidingDistance(player: Player, style: "LAND" | "AIR" | "LIQUID" | undefined, blocks: number) {
  if (!style || !(blocks > 0)) return;
  const stat: CobblemonStat = style === "LAND" ? "riding_land" : style === "AIR" ? "riding_air" : "riding_liquid";
  const cm = Math.round(blocks * 100);
  if (cm <= 0) return;
  let pending = pendingDistance.get(player.id);
  if (!pending) pendingDistance.set(player.id, pending = {});
  pending[stat] = (pending[stat] ?? 0) + cm;
}

/** Grava as distâncias acumuladas (chamado a cada poucos segundos e ao sair). */
export function flushRidingDistance(player?: Player) {
  const players = player ? [player] : world.getPlayers();
  for (const p of players) {
    const pending = pendingDistance.get(p.id);
    if (!pending) continue;
    pendingDistance.delete(p.id);
    if (!p.isValid) continue;
    try {
      const stats = getStats(p);
      for (const [stat, cm] of Object.entries(pending)) stats[stat as CobblemonStat] += cm ?? 0;
      p.setDynamicProperty(STATS_PROPERTY, JSON.stringify(stats));
    }
    catch { }
  }
}
