/**
 * Overlay de controles da montaria (`client/gui/RideControlsOverlay.kt` do 1.8.2): ao montar (e a cada troca de
 * estilo) o condutor vê, por `displayControlSeconds`, quais controles valem naquele comportamento. No Bedrock não há
 * HUD de add-on com teclas desenhadas, então a lista vai na actionbar (scripts/entity/Riding.ts), com os mesmos
 * cortes por comportamento do Cobblemon.
 */
import type { RawMessage } from "@minecraft/server";

export interface RideControlSet {
  verticalMouse: boolean;
  horizontalMouse: boolean;
  sneak: boolean;
  jump: boolean;
  /** Teclas de andar para os lados desligadas (só frente/trás). */
  noStrafe: boolean;
}

/** `when (currentBehaviourKey)` do RideControlsOverlay. */
export function rideControlSet(key: string | undefined): RideControlSet {
  const set: RideControlSet = { verticalMouse: true, horizontalMouse: true, sneak: true, jump: true, noStrafe: false };
  switch ((key ?? "").replace(/^cobblemon:/, "")) {
    case "liquid/boat": set.verticalMouse = false; set.horizontalMouse = false; set.sneak = false; break;
    case "liquid/dolphin": set.noStrafe = true; set.sneak = false; set.jump = false; break;
    case "land/horse": set.verticalMouse = false; set.noStrafe = true; set.sneak = false; break;
    case "air/hover": set.verticalMouse = false; break;
    case "air/jet": set.sneak = false; set.jump = false; break;
    case "land/minekart": set.verticalMouse = false; set.horizontalMouse = false; set.sneak = false; break;
    case "air/rocket": set.verticalMouse = false; set.horizontalMouse = false; break;
  }
  return set;
}

/** Texto da actionbar com os controles do comportamento. */
export function rideControlsText(key: string | undefined): RawMessage {
  const set = rideControlSet(key);
  const parts: RawMessage[] = [{ translate: set.noStrafe ? "cobblemon.port.ride.controls.move_forward" : "cobblemon.port.ride.controls.move" }];
  if (set.horizontalMouse && set.verticalMouse) parts.push({ translate: "cobblemon.port.ride.controls.look" });
  else if (set.horizontalMouse) parts.push({ translate: "cobblemon.port.ride.controls.look_horizontal" });
  else if (set.verticalMouse) parts.push({ translate: "cobblemon.port.ride.controls.look_vertical" });
  if (set.jump) parts.push({ translate: "cobblemon.port.ride.controls.jump" });
  if (set.sneak) parts.push({ translate: "cobblemon.port.ride.controls.sneak" });
  const rawtext: RawMessage[] = [];
  parts.forEach((part, i) => { if (i > 0) rawtext.push({ text: " §7|§r " }); rawtext.push(part); });
  return { rawtext };
}
