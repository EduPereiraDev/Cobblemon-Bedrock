/**
 * Roteamento de forms por marcador invisível.
 *
 * Antes, o JSON UI escolhia o layout procurando texto visível no título ("PC", "Battle:"): qualquer título com essas
 * letras (um jogador chamado "PCgamer", uma caixa renomeada, uma tradução) caía na grade do PC. Agora cada tela do
 * Cobblemon começa o título com um marcador feito só de códigos de formatação, que o cliente não desenha:
 * `§0§1§r` = PC, `§0§2§r` = batalha, e assim por diante. O JSON UI (`ui/cobblemon_forms.json`) testa
 * `((#title_text - '<marcador>') = #title_text)`.
 *
 * Para uma tela nova ganhar layout próprio (frente "telas"):
 *   1. use `withScreen(SCREEN.X, título)` no script;
 *   2. acrescente o marcador em `ROUTED_SCREENS` (o teste confere que o JSON UI esconde o `long_form` vanilla só para
 *      marcadores com layout) e o layout em `ui/cobblemon_forms.json` (`router`).
 */
import type { RawMessage } from "@minecraft/server";

/** Marcadores de tela (sempre no início do título). */
export const SCREEN = {
  PC: "§0§1§r",
  BATTLE: "§0§2§r",
  SUMMARY: "§0§3§r",
  STARTER: "§0§4§r",
  POKEDEX: "§0§5§r",
  ACHIEVEMENTS: "§0§6§r",
} as const;

export type ScreenMarker = (typeof SCREEN)[keyof typeof SCREEN];

/** Marcadores que já têm layout no JSON UI (o `long_form` vanilla some para eles). */
// Frente telas: resumo, inicial e Pokédex (ui/summary.json, ui/starter.json, ui/pokedex.json).
export const ROUTED_SCREENS: readonly ScreenMarker[] = [SCREEN.PC, SCREEN.BATTLE, SCREEN.SUMMARY, SCREEN.STARTER, SCREEN.POKEDEX];

/** Título com o marcador na frente (o texto exibido continua o mesmo). */
export function withScreen(marker: ScreenMarker, title: string | RawMessage): RawMessage {
  return { rawtext: [{ text: marker }, typeof title === "string" ? { text: title } : title] };
}

/** Qual marcador um título (já resolvido em texto) carrega, se algum. */
export function screenOf(resolvedTitle: string): ScreenMarker | undefined {
  return (Object.values(SCREEN) as ScreenMarker[]).find(marker => resolvedTitle.startsWith(marker));
}
