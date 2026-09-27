/**
 * Diálogos na tela (DialogueManager + GUI de diálogo do Cobblemon) com server-ui:
 * - opções → ActionFormData (título = nome de quem fala, corpo = linhas, um botão por opção visível;
 *   opção não selecionável aparece apagada e escolher reabre a página);
 * - sem entrada / auto-continue → ActionFormData com "Continuar" (auto-continue sem pular: sem botão, a página
 *   avança sozinha no prazo);
 * - texto → ModalFormData com campo de texto.
 * Fechar a tela = `escapeAction`. Prazo (timeout/auto-continue) fecha a tela e roda a ação do prazo.
 * Retrato (face), fundo e cor do texto não têm equivalente em forms.
 */
import { Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, ModalFormData, uiManager } from "@minecraft/server-ui";
import { ActiveDialogue, RenderedPage } from "./ActiveDialogue";
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
  session.dialogue.close();
  try { uiManager.closeAllForms(player); } catch { }
}

/** Jogador saiu: descarta o diálogo. */
export function onDialoguePlayerLeave(playerId: string): void {
  const session = sessions.get(playerId);
  if (!session) return;
  session.token++;
  sessions.delete(playerId);
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

  const form = new ActionFormData().title(title).body(body);
  const values: string[] = [];
  if (page.input === "option") {
    for (const option of page.options) {
      form.button(option.selectable ? option.text : { rawtext: [{ text: "§8" }, option.text] });
      values.push(option.value);
    }
  }
  else if (page.allowSkip) {
    form.button({ translate: "cobblemon.port.dialogue.continue" });
    values.push("");
  }
  form.show(player).then(response => {
    if (!isCurrent(session, token)) return;
    if (response.canceled || response.selection === undefined) return handleCancel(session, response.cancelationReason);
    session.busyRetries = 0;
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
