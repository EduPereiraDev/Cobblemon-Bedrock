/**
 * Frente "telas": zoom e overlay do scanner da Pokédex (PokedexUsageContext + PokedexScannerRenderer do Cobblemon).
 *
 * - Zoom: `camera.setFov` em passos logarítmicos (o Cobblemon vai de FOV 80 a 10 pela roda do mouse; o Bedrock aceita
 *   no mínimo ~30, então os passos vão de 70 a 30). A roda do mouse (ou LB/RB, ou tocar na hotbar) troca o slot da
 *   hotbar: no modo scanner isso vira "zoom" e o slot volta para a Pokédex.
 * - Overlay: mensagem de actionbar com o prefixo `cbS` (ui/cobblemon_scanner.json desenha bordas, scanlines, anéis
 *   e a moldura de informação; o actionbar vanilla esconde essas mensagens). Reenviada enquanto o scanner está
 *   ligado (o overlay some sozinho 1,5 s depois da última).
 * - HUD vanilla escondido durante o scanner (hotbar, vida, fome...), como o Cobblemon.
 */
import { EasingType, HudElement, HudVisibility, Player, RawMessage, system, world } from "@minecraft/server";

/** Prefixo do overlay do scanner no actionbar (ui/cobblemon_scanner.json). */
export const SCAN_OVERLAY_PREFIX = "cbS";

/** FOV por passo de zoom (0 = sem zoom). */
export const ZOOM_FOVS = [70, 58, 48, 40, 34, 30] as const;

interface ScanState {
  step: number;
  slot: number;
  lastText?: RawMessage;
  lastSent: number;
  persistent: boolean;
}

const states = new Map<string, ScanState>();

const HIDDEN: HudElement[] = [
  HudElement.Hotbar, HudElement.Health, HudElement.Hunger, HudElement.Armor, HudElement.StatusEffects,
  HudElement.ItemText, HudElement.ProgressBar, HudElement.AirBubbles, HudElement.HorseHealth, HudElement.PaperDoll,
].filter(x => x !== undefined);

/** Novo passo de zoom pela troca de slot (roda para baixo = slot seguinte = mais zoom), com volta 8↔0. */
export function zoomStepAfterSlotChange(step: number, previousSlot: number, newSlot: number): number {
  let delta = newSlot - previousSlot;
  if (delta > 4) delta -= 9;
  if (delta < -4) delta += 9;
  return Math.max(0, Math.min(ZOOM_FOVS.length - 1, step + Math.sign(delta)));
}

/** Mensagem do overlay (actionbar) com o texto de informação. */
export function scanOverlayMessage(info?: RawMessage | string): RawMessage {
  const rest: RawMessage = info === undefined ? { text: "" } : typeof info === "string" ? { text: info } : info;
  return { rawtext: [{ text: SCAN_OVERLAY_PREFIX }, rest] };
}

function applyFov(player: Player, step: number) {
  try { player.camera.setFov({ fov: ZOOM_FOVS[step], easeOptions: { easeTime: 0.15, easeType: EasingType.OutQuad } }); } catch { }
}

export function isScannerOn(player: Player): boolean {
  return states.has(player.id);
}

export function isPersistentScanner(player: Player): boolean {
  return states.get(player.id)?.persistent === true;
}

/** Liga o scanner (zoom inicial no passo 1). `persistent`: fica ligado até `stopScanner` (modo agachar + usar). */
export function startScanner(player: Player, persistent: boolean) {
  const existing = states.get(player.id);
  if (existing) {
    existing.persistent = existing.persistent || persistent;
    return;
  }
  const state: ScanState = { step: 1, slot: player.selectedSlotIndex, lastSent: 0, persistent };
  states.set(player.id, state);
  applyFov(player, state.step);
  try { player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, HIDDEN); } catch { }
  setScannerInfo(player, undefined);
}

/** Texto da moldura de informação (alvo, progresso, resultado). */
export function setScannerInfo(player: Player, info: RawMessage | string | undefined) {
  const state = states.get(player.id);
  if (!state) return;
  state.lastText = info === undefined ? undefined : typeof info === "string" ? { text: info } : info;
  state.lastSent = system.currentTick;
  try { player.onScreenDisplay.setActionBar(scanOverlayMessage(state.lastText)); } catch { }
}

export function stopScanner(player: Player) {
  if (!states.delete(player.id)) return;
  if (!player.isValid) return;
  try { player.runCommand("camera @s fov_clear"); } catch { }
  try { player.onScreenDisplay.resetHudElementsVisibility(); } catch { }
}

let started = false;

/** Zoom pela hotbar, reenvio do overlay e saída automática (outro item na mão, jogador inválido). */
export function startScannerZoom(isPokedexHeld: (player: Player) => boolean) {
  if (started) return;
  started = true;
  world.afterEvents.playerHotbarSelectedSlotChange.subscribe(({ player, previousSlotSelected, newSlotSelected }) => {
    const state = states.get(player.id);
    if (!state || newSlotSelected === state.slot) return;
    const before = state.step;
    state.step = zoomStepAfterSlotChange(state.step, previousSlotSelected, newSlotSelected);
    // PokedexUsageContext.adjustZoom: POKEDEX_SCAN_ZOOM_INCREMENT a cada passo (nada nos limites).
    if (state.step !== before) {
      try { player.playSound("cobblemon.item.pokedex.scan_zoom_increment"); } catch { }
    }
    applyFov(player, state.step);
    try { player.selectedSlotIndex = state.slot; } catch { }
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => { states.delete(playerId); });
  world.afterEvents.playerSpawn.subscribe(({ player }) => stopScanner(player));
  world.afterEvents.playerDimensionChange.subscribe(({ player }) => stopScanner(player));
  system.runInterval(() => {
    for (const [id, state] of [...states]) {
      const player = world.getEntity(id) as Player | undefined;
      if (!player?.isValid) { states.delete(id); continue; }
      if (!isPokedexHeld(player)) { stopScanner(player); continue; }
      if (system.currentTick - state.lastSent >= 20) setScannerInfo(player, state.lastText);
    }
  }, 5);
}
