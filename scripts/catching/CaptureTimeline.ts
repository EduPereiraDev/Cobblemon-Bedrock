/**
 * Linha do tempo da animação de captura, port de `EmptyPokeBallEntity.attemptCatch/beginCapture/shakeBall`
 * e do lado cliente (`PokeBallPosableState`). Pura: gera os passos com o tick relativo; quem executa é
 * CaptureSequence.ts.
 */
import type { CaptureContext } from "./CaptureCalculator";

/** Ticks do servidor por segundo. */
export const TICKS_PER_SECOND = 20;

/** Tempos do EmptyPokeBallEntity (segundos → ticks). */
export const CAPTURE_TIMINGS = {
  /** attemptCatch: a bola quica para trás e para no ar. */
  beamStart: Math.round(0.7 * TICKS_PER_SECOND),
  /** Cliente: a bola abre 0,2 s depois do HIT e fecha 1,75 s depois. */
  ballOpen: Math.round(0.2 * TICKS_PER_SECOND),
  ballShut: Math.round(1.95 * TICKS_PER_SECOND),
  /** attemptCatch: o Pokémon some e a bola começa a cair. */
  fallStart: Math.round(2.2 * TICKS_PER_SECOND),
  /** Se ainda estiver caindo depois disso, considera que pousou. */
  maxFall: Math.round(1.5 * TICKS_PER_SECOND),
  /** SECONDS_BEFORE_SHAKE. */
  beforeShake: Math.round(1 * TICKS_PER_SECOND),
  /** SECONDS_BETWEEN_SHAKES. */
  betweenShakes: Math.round(1.25 * TICKS_PER_SECOND),
  /** captureTime: o Pokémon entra no time 1 s (1,8 s nas ancient) depois do resultado. */
  captureDelay: Math.round(1 * TICKS_PER_SECOND),
  captureDelayAncient: Math.round(1.8 * TICKS_PER_SECOND),
  /** breakFree: a bola some 1,2 s depois. */
  breakFreeDiscard: Math.round(1.2 * TICKS_PER_SECOND),
};

export type CaptureStepKind =
  /** Pousou (estado CRITICAL): animação "critical". */
  | "critical"
  /** Pousou (estado SHAKE sem crítica): animação "bounce". */
  | "bounce"
  /** Uma sacudida: animação bobN (ou pulo da ancient). */
  | "shake"
  /** Resultado positivo: animação "capture"; o Pokémon entra no time depois de `captureDelay`. */
  | "success"
  /** Resultado negativo: animação "break" e o Pokémon sai. */
  | "break_free";

export interface CaptureStep {
  /** Tick relativo ao pouso da bola. */
  tick: number;
  kind: CaptureStepKind;
  /** Animações candidatas (o executor escolhe uma). */
  animations: string[];
}

/** Grupo de animações da bola ("poke_ball" ou "ancient_poke_ball"). */
export function animationGroup(ancient: boolean): string {
  return ancient ? "ancient_poke_ball" : "poke_ball";
}

/** Pulos da ancient conforme o número de sacudidas (EmptyPokeBallEntity.shakeBall). */
function ancientHops(numberOfShakes: number): string[] {
  switch (numberOfShakes) {
    case 1: return ["weirdhop"];
    case 2: return ["bighop"];
    case 3: return ["midhop1", "midhop2"];
    case 4: return ["smallhop1", "smallhop2"];
    default: return [];
  }
}

/**
 * Passos a partir do pouso. Reproduz o ScheduledTask do Cobblemon: `iterations = sacudidas + 1`
 * (+2 na crítica), atraso 1 s e intervalo 1,25 s; 4 sacudidas animam só 3; ancient anima 1 pulo.
 */
export function buildCaptureTimeline(context: CaptureContext, ancient: boolean): CaptureStep[] {
  const group = animationGroup(ancient);
  const anim = (name: string) => `animation.${group}.${name}`;
  const steps: CaptureStep[] = [];
  steps.push(context.isCriticalCapture
    ? { tick: 0, kind: "critical", animations: [anim("critical")] }
    : { tick: 0, kind: "bounce", animations: [anim("bounce")] });

  let rollsRemaining = context.numberOfShakes;
  if (rollsRemaining === 4) rollsRemaining--;
  let animatedCritical = false;
  const iterations = context.isCriticalCapture ? context.numberOfShakes + 2 : context.numberOfShakes + 1;
  for (let i = 0; i < iterations; i++) {
    const tick = CAPTURE_TIMINGS.beforeShake + i * CAPTURE_TIMINGS.betweenShakes;
    if (context.isCriticalCapture && !animatedCritical) {
      animatedCritical = true;
      continue;
    }
    if (ancient && rollsRemaining > 1) rollsRemaining = 1;
    if (rollsRemaining <= 0) {
      steps.push(context.isSucessfulCapture
        ? { tick, kind: "success", animations: [anim("capture")] }
        : { tick, kind: "break_free", animations: [anim("break")] });
      break;
    }
    const animations = ancient
      ? ancientHops(context.numberOfShakes).map(anim)
      : [1, 2, 3, 4, 5, 6].map(n => anim(`bob${n}`));
    steps.push({ tick, kind: "shake", animations });
    rollsRemaining--;
  }
  return steps;
}
