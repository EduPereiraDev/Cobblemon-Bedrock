/**
 * Diálogos na tela (DialogueManager + GUI de diálogo do Cobblemon) com server-ui:
 * - opções → ActionFormData (título = nome de quem fala, corpo = linhas, um botão por opção visível;
 *   opção não selecionável aparece apagada e escolher reabre a página);
 * - sem entrada / auto-continue → ActionFormData com "Continuar" (auto-continue sem pular: sem botão, a página
 *   avança sozinha no prazo);
 * - texto → ModalFormData com campo de texto.
 * Fechar a tela = `escapeAction`. Prazo (timeout/auto-continue) fecha a tela e roda a ação do prazo.
 *
 * Frente ui-polish: o form de opções/continuar é roteado (SCREEN.DIALOGUE → ui/dialogue.json) para o layout do
 * DialogueScreen: nome em cima, caixa de texto clara, retrato ao lado (Pokémon = retrato da espécie; jogador/NPC = rosto
 * da skin) e as opções embaixo (lado a lado ou em coluna, como `vertical`). A ordem dos botões não mudou: as opções
 * primeiro (ou "Continuar"), depois células vazias até o retrato (DIALOGUE.PORTRAIT).
 */
import { Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, ModalFormData, uiManager } from "@minecraft/server-ui";
import { ActiveDialogue, RenderedFace, RenderedPage } from "./ActiveDialogue";
import { DIALOGUE, DIALOGUE_DISABLED_MARKER, DIALOGUE_MAX_HORIZONTAL, SUB } from "../../GUI/layoutSpec";
import { SCREEN } from "../../ui/screens";
import { portraitPath } from "../../ui/portraits";
import type { Dialogue } from "./Dialogue";
import type { MoStruct } from "../molang/MoLang";
import { createPlayerStruct } from "../PlayerStruct";

interface Session {
  dialogue: ActiveDialogue;
  player: Player;
  /** Cada tela aberta ganha um token; respostas de telas antigas são ignoradas. */
  token: number;
  busyRetries: number;
  /** Página (inputId) cujo prazo já está agendado: reabrir a tela não reinicia o cronômetro. */
  deadlineInput: number;
}

const sessions = new Map<string, Session>();

export interface DialogueStartOptions {
  /** Struct `q.npc` (diálogo aberto por NPC). */
  npc?: MoStruct;
  /** Chamado quando o diálogo termina (fechado, Esc, jogador saiu). */
  onClosed?: (dialogue: ActiveDialogue) => void;
  /** Frente ui-polish: skin do NPC (textura) para o rosto `q.npc.face(...)`. */
  npcSkin?: string;
}

/** Skin padrão do jogador (o servidor não tem a skin real do cliente). */
const PLAYER_SKIN = "textures/entity/steve";
const npcSkins = new Map<string, string | undefined>();

/** Texto e textura do retrato (célula DIALOGUE.PORTRAIT) para o rosto da página. */
export function dialogueFaceCell(face: RenderedFace | undefined, npcSkin?: string): { text: string; icon: string } | undefined {
  if (!face) return undefined;
  const side = face.left ? "left" : "right";
  if (face.kind === "pokemon") return { text: `${side}_pokemon`, icon: portraitPath(face.species) };
  const skin = face.kind === "player" ? PLAYER_SKIN : npcSkin;
  return skin ? { text: `${side}_skin`, icon: skin } : undefined;
}

/**
 * Form da página (opções ou continuar) no layout do DialogueScreen. Título = marcador + sub-marcador + nome de quem fala;
 * corpo = linhas. Devolve o form e o valor de cada botão (índice = botão).
 */
export function buildDialogueForm(page: RenderedPage, npcSkin?: string): { form: ActionFormData; values: string[] } {
  const count = Math.min(page.options.length, DIALOGUE.OPTION_SLOTS);
  const horizontal = [SUB.DIALOGUE_H1, SUB.DIALOGUE_H2, SUB.DIALOGUE_H3, SUB.DIALOGUE_H4][count - 1];
  const layout = page.input !== "option" ? SUB.DIALOGUE_CONTINUE : page.vertical || count > DIALOGUE_MAX_HORIZONTAL || !horizontal ? SUB.DIALOGUE_VERTICAL : horizontal;
  const title: RawMessage = { rawtext: [{ text: SCREEN.DIALOGUE + layout }, page.speaker ?? { text: "" }] };
  const form = new ActionFormData().title(title).body(joinLines(page.lines));
  const values: string[] = [];
  if (page.input === "option") {
    for (const option of page.options.slice(0, DIALOGUE.OPTION_SLOTS)) {
      form.button(option.selectable ? option.text : { rawtext: [{ text: `${DIALOGUE_DISABLED_MARKER}§7` }, option.text] });
      values.push(option.value);
    }
  }
  else if (page.allowSkip) {
    form.button({ translate: "cobblemon.port.dialogue.continue" });
    values.push("");
  }
  const face = dialogueFaceCell(page.face, npcSkin);
  if (face) {
    for (let i = values.length; i < DIALOGUE.PORTRAIT; i++) form.button("");
    form.button(face.text, face.icon);
  }
  return { form, values };
}

export function getActiveDialogue(player: Player): ActiveDialogue | undefined {
  return sessions.get(player.id)?.dialogue;
}

/** Abre um diálogo para o jogador (substitui o que estiver aberto). */
export function startDialogue(player: Player, dialogue: Dialogue, options: DialogueStartOptions = {}): ActiveDialogue {
  stopDialogue(player);
  const active = new ActiveDialogue(dialogue, {
    player: createPlayerStruct(player),
    npc: options.npc,
    now: () => system.currentTick / 20,
  });
  const session: Session = { dialogue: active, player, token: 0, busyRetries: 0, deadlineInput: -1 };
  npcSkins.set(player.id, options.npcSkin);
  active.onClosed = d => {
    if (sessions.get(player.id)?.dialogue === d) sessions.delete(player.id);
    options.onClosed?.(d);
  };
  sessions.set(player.id, session);
  active.initialize();
  if (!active.closed) show(session);
  return active;
}

/** Fecha o diálogo (sem rodar escapeAction). */
export function stopDialogue(player: Player): void {
  const session = sessions.get(player.id);
  if (!session) return;
  session.token++;
  sessions.delete(player.id);
  npcSkins.delete(player.id);
  session.dialogue.close();
  try { uiManager.closeAllForms(player); } catch { }
}

/** Jogador saiu: descarta o diálogo. */
export function onDialoguePlayerLeave(playerId: string): void {
  const session = sessions.get(playerId);
  if (!session) return;
  session.token++;
  sessions.delete(playerId);
  npcSkins.delete(playerId);
  session.dialogue.close();
}

function joinLines(lines: RawMessage[]): RawMessage {
  const rawtext: RawMessage[] = [];
  lines.forEach((line, i) => {
    if (i > 0) rawtext.push({ text: "\n" });
    rawtext.push(line);
  });
  return { rawtext };
}

function isCurrent(session: Session, token: number): boolean {
  return sessions.get(session.player.id) === session && session.token === token && !session.dialogue.closed;
}

/** Depois de tratar uma resposta: reabre se o diálogo continua. */
function continueSession(session: Session) {
  if (sessions.get(session.player.id) === session && !session.dialogue.closed) show(session);
}

/**
 * DialogueScreen: um som de "fala" a cada `step` caracteres, espaçados por `interval` s, com tom e volume
 * aleatórios. A tela do Bedrock mostra o texto inteiro de uma vez; o som acompanha o tempo que o texto levaria.
 */
export function playGibber(player: Player, page: RenderedPage, random: () => number = Math.random): number {
  const gibber = page.gibber;
  if (!gibber || !gibber.sounds.length) return 0;
  const count = Math.min(40, Math.ceil(page.textLength / gibber.step));
  const ticks = Math.max(1, Math.round(gibber.interval * 20));
  for (let i = 0; i < count; i++) {
    const sound = gibber.sounds[Math.floor(random() * gibber.sounds.length)].replace(/^cobblemon:/, "cobblemon.");
    const pitch = gibber.minPitch + random() * (gibber.maxPitch - gibber.minPitch);
    const volume = gibber.minVolume + random() * (gibber.maxVolume - gibber.minVolume);
    const play = () => { try { if (player.isValid) player.playSound(sound, { pitch, volume }); } catch { } };
    if (i === 0) play();
    else system.runTimeout(play, i * ticks);
  }
  return count;
}

function show(session: Session) {
  const { dialogue, player } = session;
  if (!player.isValid) return onDialoguePlayerLeave(player.id);
  const token = ++session.token;
  const page = dialogue.render();
  armDeadline(session, page);
  const title = page.speaker ?? { text: "" };
  const body = joinLines(page.lines);
  playGibber(player, page);

  if (page.input === "text") {
    const form = new ModalFormData().title(title).textField(body, "");
    form.show(player).then(response => {
      if (!isCurrent(session, token)) return;
      if (response.canceled) return handleCancel(session, response.cancelationReason);
      session.busyRetries = 0;
      dialogue.handleInput(String(response.formValues?.[0] ?? ""));
      continueSession(session);
    }).catch(e => console.warn(`Diálogo: ${e}`));
    return;
  }

  const { form, values } = buildDialogueForm(page, npcSkins.get(player.id));
  form.show(player).then(response => {
    if (!isCurrent(session, token)) return;
    if (response.canceled || response.selection === undefined) return handleCancel(session, response.cancelationReason);
    session.busyRetries = 0;
    // Retrato ou célula vazia (não são opções): reabre a página.
    if (response.selection >= values.length) return continueSession(session);
    const value = values[response.selection];
    const option = page.options.find(o => o.value === value);
    if (page.input === "option" && option && !option.selectable) return continueSession(session);
    dialogue.handleInput(value ?? "");
    continueSession(session);
  }).catch(e => console.warn(`Diálogo: ${e}`));
}

function handleCancel(session: Session, reason: FormCancelationReason | undefined) {
  // Outra tela/chat aberto: tenta de novo em meio segundo (até ~10 s).
  if (reason === FormCancelationReason.UserBusy) {
    if (++session.busyRetries > 20) return stopDialogue(session.player);
    // Só reabre se nenhuma outra tela foi aberta nesse meio-tempo (ex.: o prazo da página venceu).
    const token = session.token;
    system.runTimeout(() => { if (session.token === token) continueSession(session); }, 10);
    return;
  }
  session.busyRetries = 0;
  session.dialogue.escape();
  continueSession(session);
}

/**
 * Prazo da página (DialogueTimeout / auto-continue): fecha a tela e roda a ação do prazo. Agendado uma vez por
 * página (reabrir depois de Esc/ocupado não reinicia o cronômetro, como no Cobblemon).
 */
function armDeadline(session: Session, page: RenderedPage) {
  if (page.deadline === undefined || session.deadlineInput === page.inputId) return;
  const inputId = page.inputId;
  session.deadlineInput = inputId;
  system.runTimeout(() => {
    if (sessions.get(session.player.id) !== session || session.dialogue.closed || session.dialogue.inputId !== inputId) return;
    session.token++;
    try { uiManager.closeAllForms(session.player); } catch { }
    session.dialogue.timeout(inputId);
    continueSession(session);
  }, Math.max(1, Math.round(page.deadline * 20)));
}
