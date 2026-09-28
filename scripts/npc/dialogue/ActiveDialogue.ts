/**
 * Diálogo em andamento (ActiveDialogue do Cobblemon): máquina de estados sem UI. A tela (DialogueManager)
 * só desenha `render()` e repassa a escolha para `handleInput`/`escape`/`timeout`.
 *
 * Semântica do Cobblemon 1.8.2:
 * - `initialize()` roda `initializationAction` e depois abre a página atual (que a ação pode ter trocado
 *   ou fechado com `q.dialogue.close()`).
 * - Entrada sem tipo: continuar roda a ação (padrão: próxima página). Passar da última página fecha.
 * - Opções: a ação da opção (padrão: nada); opção invisível/não selecionável escolhida mesmo assim fecha.
 * - Texto: `v.selected_option` recebe o texto digitado; ação padrão: próxima página.
 * - auto-continue: depois de `delay` segundos (ou clique, se allowSkip) roda a ação (padrão: próxima página).
 * - Tempo esgotado (`timeout`): ação do timeout (padrão: fechar).
 * - Esc: `escapeAction` da página ou do diálogo (padrão: fechar).
 */
import type { RawMessage } from "@minecraft/server";
import { MoEnvironment, MoStruct, MoValue, asNumber, asString } from "../molang/MoLang";
import type { Dialogue, DialogueAction, DialogueGibber, DialogueInput, DialoguePage, DialogueText } from "./Dialogue";

export interface DialogueHost {
  /** Struct de `q.player`. */
  player: MoStruct;
  /** Struct de `q.npc` (diálogo aberto por um NPC). */
  npc?: MoStruct;
  /** Segundos desde um marco qualquer (para v.seconds_taken_to_input). */
  now?(): number;
}

export interface RenderedOption {
  text: RawMessage;
  value: string;
  selectable: boolean;
}

/**
 * Frente ui-polish: rosto de quem fala (DialogueFace do Java). `artificial` de Pokémon vira o retrato da espécie;
 * `q.player.face(lado)`/`q.npc.face(lado)` viram o rosto da skin. O Java desenha o modelo ao vivo; aqui é uma imagem.
 */
export type RenderedFace = { kind: "pokemon"; species: string; left: boolean } | { kind: "player" | "npc"; left: boolean };

/** Lê o `face` do falante (objeto `artificial` ou expressão `q.player.face(true)`). */
export function parseFace(face: unknown): RenderedFace | undefined {
  if (typeof face === "string") {
    const m = /q(?:uery)?\.(player|npc)\.face\(\s*(true|false|1|0)?\s*\)/i.exec(face);
    if (!m) return undefined;
    return { kind: m[1].toLowerCase() as "player" | "npc", left: m[2] === undefined ? m[1].toLowerCase() === "player" : m[2] === "true" || m[2] === "1" };
  }
  if (face && typeof face === "object") {
    const f = face as { type?: string; modelType?: string; identifier?: string; isLeftSide?: boolean };
    if (f.modelType === "pokemon" && typeof f.identifier === "string") return { kind: "pokemon", species: f.identifier.replace(/^[a-z0-9_]+:/, ""), left: f.isLeftSide === true };
  }
  return undefined;
}

export interface RenderedPage {
  pageId: string;
  /** Frente ui-polish: rosto de quem fala (retrato do DialogueScreen). */
  face?: RenderedFace;
  inputId: number;
  speaker?: RawMessage;
  lines: RawMessage[];
  input: DialogueInput["type"];
  options: RenderedOption[];
  vertical: boolean;
  /** Segundos até o timeout/auto-continue (undefined = sem prazo). */
  deadline?: number;
  allowSkip: boolean;
  /** Gibber da página, senão o do falante (DialogueScreen). */
  gibber?: DialogueGibber;
  /** Tamanho aproximado do texto (literais; chaves traduzidas contam 40), para o gibber. */
  textLength: number;
}

let nextDialogueId = 1;

export class ActiveDialogue {
  readonly dialogueId = nextDialogueId++;
  readonly runtime: MoEnvironment;
  currentPage: DialoguePage;
  initialized = false;
  closed = false;
  /** Muda a cada página (ActiveInput.inputId): timeouts antigos são descartados. */
  inputId = 0;
  private inputStartedAt = 0;
  /** Chamado quando a página muda depois de aberto (a UI redesenha). */
  onPageChanged?: (dialogue: ActiveDialogue) => void;
  /** Chamado uma vez ao fechar. */
  onClosed?: (dialogue: ActiveDialogue) => void;
  /** Erros de MoLang (não interrompem o diálogo). */
  errors: string[] = [];

  constructor(public readonly dialogue: Dialogue, public readonly host: DialogueHost) {
    this.currentPage = dialogue.pages[0];
    this.runtime = new MoEnvironment();
    this.runtime.withQuery("dialogue", this.createStruct());
    this.runtime.withQuery("player", host.player);
    if (host.npc) this.runtime.withQuery("npc", host.npc);
  }

  get currentPageIndex(): number {
    return this.dialogue.pages.indexOf(this.currentPage);
  }

  private createStruct(): MoStruct {
    const struct = new MoStruct();
    struct.fn("current_page", () => new MoStruct({ id: this.currentPage.id }, {
      lines: () => this.currentPage.lines.map(l => this.textToString(l)).join("\n"),
    }));
    struct.fn("current_page_number", () => this.currentPageIndex);
    struct.fn("next_page", () => { this.incrementPage(); return 1; });
    struct.fn("set_page", args => { this.setPage(args[0] ?? 0); return 1; });
    struct.fn("close", () => { this.close(); return 1; });
    struct.fn("input", args => { this.handleInput(args.length ? asString(args[0]) : ""); return 1; });
    struct.fn("is_closed", () => (this.closed ? 1 : 0));
    return struct;
  }

  private context(): MoStruct {
    return new MoStruct({ player: this.host.player, npc: this.host.npc ?? new MoStruct() });
  }

  /** Roda uma ação MoLang (ExpressionLikeDialogueAction). */
  runAction(action: DialogueAction | undefined, input?: string): void {
    if (action === undefined) return;
    if (input !== undefined) this.runtime.variable.set("selected_option", input);
    try { this.runtime.eval(action, this.context()); }
    catch (e) { this.reportError(`ação ${JSON.stringify(action)}: ${e}`); }
  }

  /** Avalia um predicado (isVisible / isSelectable). Sem predicado = verdadeiro. */
  test(predicate: DialogueAction | undefined): boolean {
    if (predicate === undefined) return true;
    try { return this.runtime.evalBoolean(predicate, this.context()); }
    catch (e) {
      this.reportError(`predicado ${JSON.stringify(predicate)}: ${e}`);
      return false;
    }
  }

  private reportError(text: string) {
    this.errors.push(text);
    console.warn(`[diálogo ${this.dialogue.id}] ${text}`);
  }

  initialize(): void {
    this.runAction(this.dialogue.initializationAction);
    if (this.closed) return;
    this.setPage(this.currentPage);
    this.initialized = true;
  }

  setPage(value: MoValue | DialoguePage): void {
    if (this.closed) return;
    let page: DialoguePage | undefined;
    if (typeof value === "object" && value !== null && "lines" in value && "input" in value) page = value as DialoguePage;
    else if (typeof value === "string") {
      page = this.dialogue.pages.find(p => p.id === value);
      if (!page) return this.reportError(`página '${value}' não existe`);
    }
    else {
      const index = Math.trunc(asNumber(value as MoValue));
      if (index === this.dialogue.pages.length) return this.close();
      page = this.dialogue.pages[index];
      if (!page) return this.reportError(`página ${index} não existe`);
    }
    this.currentPage = page;
    this.inputId++;
    this.inputStartedAt = this.host.now?.() ?? 0;
    if (this.initialized) this.onPageChanged?.(this);
  }

  incrementPage(): void {
    this.setPage(this.currentPageIndex + 1);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed?.(this);
  }

  /** Esc / fechar a tela. */
  escape(): void {
    const action = this.currentPage.escapeAction ?? this.dialogue.escapeAction;
    if (action === undefined) this.close();
    else this.runAction(action);
  }

  /** Prazo da página esgotado (só vale se `inputId` ainda for o da página que armou o timer). */
  timeout(inputId: number): void {
    if (this.closed || inputId !== this.inputId) return;
    const input = this.currentPage.input;
    if (input.type === "auto-continue") return this.runOrDefault(input.action, () => this.incrementPage());
    const timeout = input.type === "option" || input.type === "text" ? input.timeout : undefined;
    if (!timeout) return;
    this.runOrDefault(timeout.action, () => this.close());
  }

  private runOrDefault(action: DialogueAction | undefined, fallback: () => void, input?: string) {
    if (action === undefined) fallback();
    else this.runAction(action, input);
  }

  /** Resposta do jogador na página atual (ActiveInput.handle). */
  handleInput(value: string): void {
    if (this.closed) return;
    const seconds = (this.host.now?.() ?? 0) - this.inputStartedAt;
    this.runtime.variable.set("seconds_taken_to_input", seconds);
    const input = this.currentPage.input;
    switch (input.type) {
      case "none":
        return this.runOrDefault(input.action, () => this.incrementPage());
      case "text":
        return this.runOrDefault(input.action, () => this.setPage(this.currentPageIndex + 1), value);
      case "auto-continue":
        if (!input.allowSkip) return;
        return this.runOrDefault(input.action, () => this.incrementPage());
      case "option": {
        const option = input.options.find(o => o.value === value);
        if (!option) return;
        if (!this.test(option.isSelectable) || !this.test(option.isVisible)) return this.close();
        this.runAction(option.action ?? [], value);
        return;
      }
    }
  }

  textToString(text: DialogueText): string {
    if (text.kind === "translated") return text.key;
    if (text.kind === "component") return text.text;
    try { return this.runtime.evalString(text.expression, this.context()); }
    catch (e) {
      this.reportError(`texto ${JSON.stringify(text.expression)}: ${e}`);
      return "";
    }
  }

  renderText(text: DialogueText): RawMessage {
    return text.kind === "translated" ? { translate: text.key } : { text: this.textToString(text) };
  }

  /** O que a tela precisa desenhar agora. */
  render(): RenderedPage {
    const page = this.currentPage;
    const speaker = page.speaker ? this.dialogue.speakers[page.speaker] : undefined;
    const input = page.input;
    const options: RenderedOption[] = input.type === "option"
      ? input.options.filter(o => this.test(o.isVisible)).map(o => ({ text: this.renderText(o.text), value: o.value, selectable: this.test(o.isSelectable) }))
      : [];
    const deadline = input.type === "auto-continue" ? input.delay : input.type === "option" || input.type === "text" ? input.timeout?.duration : undefined;
    return {
      pageId: page.id,
      inputId: this.inputId,
      speaker: speaker?.name ? this.renderText(speaker.name) : undefined,
      face: parseFace(speaker?.face),
      lines: page.lines.map(l => this.renderText(l)),
      input: input.type,
      options,
      vertical: input.type === "option" && input.vertical,
      deadline: deadline !== undefined && deadline > 0 ? deadline : undefined,
      allowSkip: input.type !== "auto-continue" || input.allowSkip,
      gibber: page.gibber ?? speaker?.gibber,
      textLength: page.lines.reduce((sum, l) => sum + (l.kind === "translated" ? 40 : this.textToString(l).length), 0),
    };
  }
}
