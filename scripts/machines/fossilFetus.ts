/**
 * Feto no tanque de restauração (RestorationTankRenderer.renderFetus do Cobblemon 1.8.2).
 *
 * Enquanto a máquina restaura (ou já tem o Pokémon pronto), a entidade `cobblemon:fossil_fetus` (gerada pelo
 * importador) fica dentro do tanque, em (0,5; 1 + yTranslation; 0,5) do bloco de baixo, virada para a frente do
 * tanque. A propriedade `cobblemon:progress` (1 − tempo restante / TIME_TO_TAKE) move as curvas dos 3 embriões e do
 * feto no cliente; `cobblemon:fetus` escolhe o modelo do fóssil (`<fóssil>_fetus`, ou o substitute).
 * Desvio: o Java gira o feto conforme o lado em que o tanque encosta no analisador; aqui ele olha para a frente
 * do bloco do tanque.
 */
import { Dimension, Entity, system, Vector3 } from "@minecraft/server";
import { FETUS_NAMES, FETUS_Y_TRANSLATION } from "../../generated/scripts/mundoDetalhes";

export const FOSSIL_FETUS = "cobblemon:fossil_fetus";

/** Índice do modelo do feto para o fóssil (0 = substitute_fetus). */
export function fetusIndex(fossilId: string | undefined): number {
  if (!fossilId) return 0;
  const name = fossilId.replace(/^[a-z0-9_]+:/, "");
  const i = FETUS_NAMES.indexOf(name);
  return i < 0 ? 0 : i;
}

/** completionPercentage do renderer (0..1); pronto = 1. */
export function fetusProgress(timeRemaining: number, total: number, created: boolean): number {
  if (created || timeRemaining === 0) return 1;
  if (timeRemaining < 0) return 0;
  return Math.max(0, Math.min(1, 1 - timeRemaining / total));
}

function yawOf(facing: string | undefined): number {
  switch (facing) {
    case "south": return 0;
    case "west": return 90;
    case "east": return -90;
    default: return 180;
  }
}

function findFetus(dimension: Dimension, tank: Vector3): Entity | undefined {
  try {
    return dimension.getEntities({ type: FOSSIL_FETUS, location: { x: tank.x + 0.5, y: tank.y + 1.1, z: tank.z + 0.5 }, maxDistance: 1.2, closest: 1 })[0];
  }
  catch {
    return undefined;
  }
}

/**
 * Mostra/atualiza/remove o feto do tanque. `show` = restaurando ou com Pokémon pronto.
 * `tank` = bloco de baixo do tanque (coordenadas inteiras).
 */
export function syncFossilFetus(dimension: Dimension, tank: Vector3, show: boolean, fossilId: string | undefined, progress: number, facing: string | undefined) {
  let fetus = findFetus(dimension, tank);
  if (!show) {
    try { fetus?.remove(); }
    catch { /* já removido */ }
    return;
  }
  const index = fetusIndex(fossilId);
  const name = FETUS_NAMES[index] ?? "substitute";
  const at = { x: tank.x + 0.5, y: tank.y + 1 + (FETUS_Y_TRANSLATION[name] ?? 0), z: tank.z + 0.5 };
  const apply = (target: Entity) => {
    try {
      if (target.getProperty("cobblemon:fetus") !== index) target.setProperty("cobblemon:fetus", index);
      const current = Number(target.getProperty("cobblemon:progress") ?? 0);
      if (Math.abs(current - progress) >= 0.001) target.setProperty("cobblemon:progress", progress);
    }
    catch { /* chunk saindo */ }
  };
  if (!fetus) {
    try { fetus = dimension.spawnEntity(FOSSIL_FETUS as never, at, { initialRotation: yawOf(facing) }); }
    catch { return; }
    // Propriedades gravadas no mesmo tick do spawn se perdem (visto no BDS): grava de novo no tick seguinte.
    const spawned = fetus;
    system.runTimeout(() => { if (spawned.isValid) apply(spawned); }, 2);
  }
  apply(fetus);
}

export function removeFossilFetus(dimension: Dimension, tank: Vector3) {
  syncFossilFetus(dimension, tank, false, undefined, 0, undefined);
}
