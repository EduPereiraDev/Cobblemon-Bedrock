/**
 * Frente "telas": montagem dos forms de layout fixo (ver `layoutSpec.ts`).
 *
 * `CellForm` guarda o conteúdo por índice de célula e completa os buracos com botões vazios (escondidos pelo
 * JSON UI), então o índice que o jogador escolhe é sempre o índice da célula. Cada célula pode ter uma ação.
 */
import { Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, ActionFormResponse, FormCancelationReason } from "@minecraft/server-ui";
import { SCREEN, ScreenMarker, withScreen } from "../ui/screens";
import { SubMarker } from "./layoutSpec";

export * from "./layoutSpec";

/** Texto não vazio mínimo: célula visível sem rótulo (ex.: barra, retrato). */
export const BLANK = " ";

/** Título com o marcador da tela, o(s) sub-marcador(es) e o texto visível. */
export function layoutTitle(screen: ScreenMarker, sub: SubMarker | SubMarker[], title: string | RawMessage): RawMessage {
  const subs = Array.isArray(sub) ? sub.join("") : sub;
  return withScreen(screen, { rawtext: [{ text: subs }, typeof title === "string" ? { text: title } : title] });
}

interface Cell<T> {
  text: string | RawMessage;
  icon?: string;
  action?: T;
}

export class CellForm<T = unknown> {
  private readonly cells: (Cell<T> | undefined)[] = [];
  private bodyText: string | RawMessage = "";

  /**
   * @param count número mínimo de células (o layout do JSON UI tem tantas quantas o `layoutSpec` define).
   */
  constructor(readonly title: RawMessage, readonly count: number) { }

  body(text: string | RawMessage): this {
    this.bodyText = text;
    return this;
  }

  /** Conteúdo da célula `index`. Texto vazio esconde a célula. */
  cell(index: number, text: string | RawMessage, icon?: string, action?: T): this {
    this.cells[index] = { text, icon, action };
    return this;
  }

  has(index: number): boolean {
    return this.cells[index] !== undefined;
  }

  /** Ação da célula escolhida (undefined = célula vazia ou fora do layout). */
  actionAt(index: number | undefined): T | undefined {
    return index === undefined ? undefined : this.cells[index]?.action;
  }

  /** Textos na ordem dos botões (para testes e diagnóstico). */
  texts(): (string | RawMessage)[] {
    const total = Math.max(this.count, this.cells.length);
    return Array.from({ length: total }, (_, i) => this.cells[i]?.text ?? "");
  }

  icons(): (string | undefined)[] {
    const total = Math.max(this.count, this.cells.length);
    return Array.from({ length: total }, (_, i) => this.cells[i]?.icon);
  }

  build(): ActionFormData {
    const form = new ActionFormData().title(this.title).body(this.bodyText);
    const total = Math.max(this.count, this.cells.length);
    for (let i = 0; i < total; i++) {
      const cell = this.cells[i];
      if (!cell) form.button("");
      else if (cell.icon) form.button(cell.text, cell.icon);
      else form.button(cell.text);
    }
    return form;
  }

  /**
   * Mostra e devolve a célula escolhida. `undefined` = fechado. Chat/inventário aberto (UserBusy): tenta de novo a
   * cada meio segundo, até `retries` vezes.
   */
  async show(player: Player, retries = 20, outcome?: { busy?: boolean }): Promise<{ index: number; action?: T } | undefined> {
    const form = this.build();
    if (outcome) outcome.busy = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!player.isValid) return undefined;
      let response: ActionFormResponse;
      // Jogador saiu com a tela aberta (FormRejectError): só fecha.
      try { response = await form.show(player); } catch { return undefined; }
      if (response.canceled && response.cancelationReason === FormCancelationReason.UserBusy) {
        await new Promise<void>(resolve => system.runTimeout(() => resolve(), 10));
        continue;
      }
      if (response.selection === undefined) return undefined;
      return { index: response.selection, action: this.actionAt(response.selection) };
    }
    // Todas as tentativas deram UserBusy: a tela nunca apareceu (cliente ainda carregando, outra tela aberta).
    if (outcome) outcome.busy = true;
    return undefined;
  }
}

/** `form.show` que devolve undefined quando o jogador sai com a tela aberta (FormRejectError), em vez de rejeitar. */
export async function safeShow<T>(player: Player, form: { show(player: Player): Promise<T> }): Promise<T | undefined> {
  try { return await form.show(player); } catch { return undefined; }
}

/** Atalho: novo `CellForm` para a tela/sub-layout. */
export function cellForm<T = unknown>(screen: ScreenMarker, sub: SubMarker | SubMarker[], title: string | RawMessage, count: number): CellForm<T> {
  return new CellForm<T>(layoutTitle(screen, sub, title), count);
}

export { SCREEN };
