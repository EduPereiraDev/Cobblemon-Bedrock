/**
 * Frente batalha-minimizavel: ponte entre o estado da tela da batalha (`scripts/battle/BattleUiMode.ts`) e o HUD de
 * batalha (`BattleHud.ts`). O HUD pergunta a cada atualização; o modo da batalha registra quem responde. Este arquivo
 * não importa nada de `scripts/battle` (sem import circular).
 */
import type { Player, RawMessage } from "@minecraft/server";
import type { BattleUiHead } from "./hudProtocol";

export interface BattleUiView extends BattleUiHead {
  /** Texto do aviso (cauda do título, traduzido no cliente). */
  text?: RawMessage;
}

type Provider = (player: Player) => BattleUiView | undefined;

let provider: Provider | undefined;

/** Registra quem calcula a visão (uma vez, em `registerBattleUiModes`). */
export function setBattleUiViewProvider(fn: Provider | undefined) {
  provider = fn;
}

/** Visão da tela da batalha para o jogador (undefined = espectador, modo `classic` ou fora de batalha). */
export function battleUiViewOf(player: Player): BattleUiView | undefined {
  if (!provider) return undefined;
  try { return provider(player); }
  catch { return undefined; }
}
