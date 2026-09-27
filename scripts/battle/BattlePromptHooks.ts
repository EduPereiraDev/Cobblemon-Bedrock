/**
 * Frente batalha-minimizavel: ganchos na abertura da tela de escolha da batalha (`BattleActor`).
 *
 * `BattleUiMode.ts` registra os ganchos e decide, por jogador, se a tela abre ou se a batalha fica minimizada (padrão
 * `java`, como o Cobblemon 1.8.2). Sem ganchos registrados (testes que não carregam `battle/index.ts`) o fluxo é o
 * antigo: a tela abre a cada request e, fechada, a dica de reabrir vai para o chat.
 *
 * Este arquivo não importa nada de `scripts/battle` em tempo de execução (evita import circular com `BattleActor`).
 */
import type { BattleActor } from "./BattleActor";

/**
 * Quem pediu a tela:
 * - `turn`: chegou um request (turno novo, troca obrigatória) ou a tela aberta precisa ser refeita com o request atual;
 * - `reopen`: o jogador pediu por outro caminho (interagir com o oponente/NPC, nova tentativa depois de escolha
 *   inválida) — sempre abre;
 * - `toggle`: a "tecla R" do port (agachado + pular; duplo toque em Pular no celular) — PartySendBinding.toggleBattleScreen.
 */
export type PromptSource = "turn" | "reopen" | "toggle";

export interface BattlePromptHooks {
  /**
   * Antes de abrir a tela de escolha.
   * @returns true se o modo cuidou do pedido (a tela NÃO abre).
   */
  beforePrompt?(actor: BattleActor, source: PromptSource): boolean;
  /**
   * A tela fechou sem escolha (ESC / X / "Fugir"): a batalha ficou "minimizada".
   * @returns true para não mandar a dica antiga de reabrir no chat.
   */
  onMenuClosed?(actor: BattleActor, requestId: number): boolean;
  /** A escolha do ator foi enviada ao Showdown (não há mais nada a escolher neste request). */
  onChoiceSent?(actor: BattleActor): void;
}

/** Ganchos ativos (vazio = comportamento antigo). */
export let battlePromptHooks: BattlePromptHooks = {};

export function setBattlePromptHooks(hooks: BattlePromptHooks) {
  battlePromptHooks = hooks;
}
