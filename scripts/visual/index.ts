/**
 * Frente visual-final: efeitos visuais contínuos (partículas de aspect #88 e o quirk do Nosepass #144) e a sonda
 * `scriptevent cobblemon:debug_visual_final`. O main.ts chama `startVisualFinal()` no worldLoad.
 */
import { startAspectParticles } from "./AspectParticles";
import { registerVisualFinalDebug } from "./Debug";
import { startPointToSpawn } from "./PointToSpawn";

export function startVisualFinal() {
  startAspectParticles();
  startPointToSpawn();
  registerVisualFinalDebug();
}
