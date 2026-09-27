/**
 * Toasts no canto superior direito (AdvancementToast do Minecraft / CobblemonToast), desenhados pelo
 * `ui/cobblemon_hud.json` a partir do canal `T` do HudBus. O Bedrock não tem API de toast para scripts.
 *
 * Fila por jogador: um toast por vez, `TOAST_TICKS` na tela (5 s, como o toast de conquista do Java), depois o
 * próximo. As linhas são chaves de tradução (o label do JSON UI traduz) ou texto literal.
 */
import { Player, system, world } from "@minecraft/server";
import { CHANNEL, ToastView, encodeToastBody } from "./hudProtocol";
import { setHudChannel } from "./HudBus";

export const TOAST_TICKS = 100;
/** Máximo na fila por jogador (o resto é descartado, como o limite visual do ToastComponent). */
export const TOAST_QUEUE_LIMIT = 16;

const HIDDEN = encodeToastBody(undefined);

interface ToastQueue {
  items: ToastView[];
  /** Tick em que o toast atual some (0 = nada na tela). */
  until: number;
}

const queues = new Map<string, ToastQueue>();
let tick = 0;
let runId: number | undefined;

/** Enfileira um toast para o jogador. */
export function showToast(player: Player, toast: ToastView) {
  let queue = queues.get(player.id);
  if (!queue) queues.set(player.id, queue = { items: [], until: 0 });
  if (queue.items.length >= TOAST_QUEUE_LIMIT) return;
  queue.items.push(toast);
}

/** Toast de conquista (AdvancementToast): moldura e cor do cabeçalho pelo tipo (task/goal/challenge). */
export function advancementToast(frame: "task" | "goal" | "challenge", titleKey: string, icon?: string): ToastView {
  return {
    icon,
    frame: frame === "challenge" ? "c" : frame === "goal" ? "g" : "t",
    color: frame === "challenge" ? "p" : "y",
    line1: `cobblemon.port.advancement.toast.${frame}`,
    line2: titleKey,
  };
}

/** Toast genérico de captura (API; o Cobblemon avisa a captura só no chat, então nada chama isto automaticamente). */
export function captureToast(pokemonName: string, icon?: string): ToastView {
  return { icon, frame: "t", color: "y", line1: "cobblemon.port.toast.caught", line2: pokemonName };
}

/** Toast genérico de evolução (API; ver `captureToast`). */
export function evolutionToast(fromName: string, toName: string, icon?: string): ToastView {
  return { icon, frame: "g", color: "y", line1: "cobblemon.port.toast.evolved", line2: `${fromName} → ${toName}` };
}

function update() {
  tick++;
  for (const [id, queue] of queues) {
    if (queue.until !== 0 && tick < queue.until) continue;
    const player = world.getEntity(id);
    if (!(player instanceof Player) || !player.isValid) { queues.delete(id); continue; }
    const next = queue.items.shift();
    if (next) {
      setHudChannel(player, CHANNEL.TOAST, encodeToastBody(next));
      queue.until = tick + TOAST_TICKS;
    }
    else {
      setHudChannel(player, CHANNEL.TOAST, HIDDEN);
      queues.delete(id);
    }
  }
}

export function startToasts() {
  if (runId !== undefined) return;
  runId = system.runInterval(update, 1);
  world.afterEvents.playerLeave.subscribe(({ playerId }) => queues.delete(playerId));
}
