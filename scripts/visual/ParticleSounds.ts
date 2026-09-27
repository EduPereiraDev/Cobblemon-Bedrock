import { Dimension, system, Vector3 } from "@minecraft/server";
import { PARTICLE_SOUNDS } from "../../generated/scripts/particleSounds";

/**
 * Frente cliente-log: sons dos eventos das partículas do Cobblemon.
 *
 * No Cobblemon (ParticleStorm) um evento de partícula pode tocar qualquer som (`sound_effect`); no Bedrock o
 * `sound_effect` de partícula só aceita LevelSoundEvents do motor e o cliente recusa o resto ("Event name 'x' is not
 * a valid LevelSoundEvent"). O importador tira esses sons do JSON e grava em generated/scripts/particleSounds.ts o
 * tempo (s, a partir do disparo, já com os das partículas-filhas) e as opções de som; quem dispara a partícula por
 * script chama `playParticleSounds` logo depois de `spawnParticle`.
 */
export function playParticleSounds(dimension: Dimension, particle: string, location: Vector3): void {
  const cues = PARTICLE_SOUNDS[particle];
  if (!cues) return;
  for (const [seconds, options] of cues) {
    const sound = options[Math.floor(Math.random() * options.length)];
    if (!sound) continue;
    const play = () => {
      try { dimension.playSound(sound, location); } catch { }
    };
    const ticks = Math.round(seconds * 20);
    if (ticks <= 0) play();
    else system.runTimeout(play, ticks);
  }
}

/** Há sons de evento para a partícula (testes e diagnóstico). */
export function particleHasSounds(particle: string): boolean {
  return !!PARTICLE_SOUNDS[particle];
}
