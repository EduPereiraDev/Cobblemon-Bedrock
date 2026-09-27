/**
 * HudBus: o único lugar que manda títulos de HUD (protocolo em `hudProtocol.ts`).
 *
 * - Um título por jogador por tick (dois `setTitle` no mesmo tick: o cliente só vê o último).
 * - Cada canal guarda o último corpo desejado; só reenvia quando muda. Prioridade: batalha > toast > party.
 * - A cada `REFRESH_TICKS` todos os canais são reenviados (o HUD do cliente pode ser recriado ao trocar de dimensão ou
 *   renascer, e o receptor preservado volta vazio), e também logo após `playerSpawn`.
 * - fadeIn/stay/fadeOut = 0/1/0 e o `ui/hud_screen.json` esconde o título vanilla quando o texto tem `cbH`.
 * - Frente batalha-minimizavel: um canal pode levar uma "cauda" rawtext depois do corpo de largura fixa (o aviso da
 *   batalha, traduzido no cliente com a tecla no `%1$s`). O título vira `{ rawtext: [cabeçalho + corpo, cauda] }`; o
 *   cliente resolve a tradução antes de entregar o texto ao HUD, e o JSON UI lê a cauda a partir de um offset fixo.
 */
import { Player, RawMessage, system, world } from "@minecraft/server";
import { CHANNEL, HudChannel, header } from "./hudProtocol";

/** Reenvio periódico de segurança (10 s). */
export const REFRESH_TICKS = 200;

const PRIORITY: HudChannel[] = [CHANNEL.BATTLE, CHANNEL.TOAST, CHANNEL.PARTY];

interface ChannelState {
  /** Corpo desejado (sem cabeçalho). */
  body: string;
  /** Cauda rawtext opcional (depois do corpo). */
  tail?: RawMessage;
  /** Corpo + cauda serializados (o que decide se precisa reenviar). */
  key: string;
  /** Chave enviada por último; undefined = nunca enviado (ou forçado a reenviar). */
  sent?: string;
  seq: number;
}

function stateKey(body: string, tail: RawMessage | undefined): string {
  return tail ? `${body}\u0000${JSON.stringify(tail)}` : body;
}

/** Estado por jogador → canal. Exportado para os testes. */
export class HudState {
  channels = new Map<HudChannel, ChannelState>();
  lastRefresh = 0;

  set(channel: HudChannel, body: string, tail?: RawMessage) {
    const key = stateKey(body, tail);
    const state = this.channels.get(channel);
    if (state) { state.body = body; state.tail = tail; state.key = key; }
    else this.channels.set(channel, { body, tail, key, seq: 0 });
  }

  get(channel: HudChannel): string | undefined {
    return this.channels.get(channel)?.body;
  }

  /** Marca todos os canais para reenvio. */
  invalidate() {
    for (const state of this.channels.values()) state.sent = undefined;
  }

  /** Próximo título a enviar (ou undefined). Avança a sequência e marca como enviado. Com cauda: rawtext. */
  next(): string | RawMessage | undefined {
    for (const channel of PRIORITY) {
      const state = this.channels.get(channel);
      if (!state || state.sent === state.key) continue;
      state.seq++;
      state.sent = state.key;
      const text = header(channel, state.seq) + state.body;
      return state.tail ? { rawtext: [{ text }, state.tail] } : text;
    }
    return undefined;
  }
}

const players = new Map<string, HudState>();
let runId: number | undefined;
let tick = 0;

function stateOf(player: Player): HudState {
  let state = players.get(player.id);
  if (!state) {
    state = new HudState();
    state.lastRefresh = tick;
    players.set(player.id, state);
  }
  return state;
}

/** Define o conteúdo de um canal para o jogador (enviado no próximo tick livre). `tail`: cauda rawtext opcional. */
export function setHudChannel(player: Player, channel: HudChannel, body: string, tail?: RawMessage) {
  stateOf(player).set(channel, body, tail);
}

export function getHudChannel(player: Player, channel: HudChannel): string | undefined {
  return players.get(player.id)?.get(channel);
}

/** Força o reenvio de todos os canais do jogador. */
export function refreshHud(player: Player) {
  players.get(player.id)?.invalidate();
}

function flush() {
  tick++;
  if (players.size === 0) return;
  for (const player of world.getPlayers()) {
    const state = players.get(player.id);
    if (!state) continue;
    if (tick - state.lastRefresh >= REFRESH_TICKS) {
      state.lastRefresh = tick;
      state.invalidate();
    }
    const title = state.next();
    if (title === undefined) continue;
    try {
      player.onScreenDisplay.setTitle(title, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 });
    }
    catch { /* jogador saindo */ }
  }
}

/** Liga o laço do HudBus (uma vez). */
export function startHudBus() {
  if (runId !== undefined) return;
  runId = system.runInterval(flush, 1);
  world.afterEvents.playerLeave.subscribe(({ playerId }) => players.delete(playerId));
  world.afterEvents.playerSpawn.subscribe(({ player }) => refreshHud(player));
  world.afterEvents.playerDimensionChange.subscribe(({ player }) => refreshHud(player));
}
