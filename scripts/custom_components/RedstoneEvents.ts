/**
 * Redstone dos blocos decorativos do Cobblemon que dependem de projéteis (frente mundo-sons):
 * - Ring Target (RingTargetBlock extends TargetBlock): um projétil acertando emite sinal proporcional à distância
 *   do centro da face (1..15) por 20 ticks (flecha/tridente) ou 8 ticks (outros), como o alvo vanilla.
 * - Botões de madeira: flechas apertam (ButtonBlock.checkPressed com AbstractArrow).
 * O sinal em si vem do JSON dos blocos (`minecraft:redstone_producer` por permutação, em
 * behavior_packs/CobblemonBedrock/blocks/cobblemon/*.json mesclado por cima do bloco gerado).
 */
import { Block, Direction, system, Vector3, world } from "@minecraft/server";
import { buttonSpec, pressButton } from "./ButtonComponent";

export const RING_TARGET = "cobblemon:ring_target";
export const RING_POWER_STATE = "cobblemon:power";

const ARROWS = new Set(["minecraft:arrow", "minecraft:thrown_trident"]);

/**
 * TargetBlock.getRedstoneStrength: `faceLocation` é o ponto relativo ao bloco (0..1). Quanto mais perto do centro da
 * face atingida, mais forte (mínimo 1).
 */
export function targetPower(face: Direction | string, faceLocation: Vector3): number {
  const frac = (v: number) => v - Math.floor(v);
  const dx = Math.abs(frac(faceLocation.x) - 0.5);
  const dy = Math.abs(frac(faceLocation.y) - 0.5);
  const dz = Math.abs(frac(faceLocation.z) - 0.5);
  const f = String(face).toLowerCase();
  const d = f === "up" || f === "down" ? Math.max(dx, dz) : f === "north" || f === "south" ? Math.max(dx, dy) : Math.max(dy, dz);
  return Math.max(1, Math.ceil(15 * Math.min(1, Math.max(0, (0.5 - d) / 0.5))));
}

/** Duração do sinal do alvo: 20 ticks para flechas/tridente, 8 para os demais projéteis. */
export function targetDuration(projectileType: string): number {
  return ARROWS.has(projectileType) ? 20 : 8;
}

/** Contador por posição: um acerto novo renova o sinal; só o último agendamento desliga. */
const targetHits = new Map<string, number>();

export function hitRingTarget(block: Block, power: number, duration: number) {
  const key = `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
  const serial = (targetHits.get(key) ?? 0) + 1;
  targetHits.set(key, serial);
  setPower(block, power);
  system.runTimeout(() => {
    if (targetHits.get(key) !== serial) return;
    targetHits.delete(key);
    if (block.isValid && block.typeId === RING_TARGET) setPower(block, 0);
  }, duration);
}

function setPower(block: Block, power: number) {
  try {
    if (block.permutation.getState(RING_POWER_STATE as never) === power) return;
    block.setPermutation(block.permutation.withState(RING_POWER_STATE as never, power as never));
  }
  catch { /* bloco sem o estado (JSON antigo) */ }
}

system.run(() => {
  try {
    world.afterEvents.projectileHitBlock.subscribe(event => {
      let hit;
      try { hit = event.getBlockHit(); }
      catch { return; }
      const block = hit?.block;
      if (!block?.isValid) return;
      // Frente cliente-teste3-log: bloco num chunk carregado que não tica (borda da simulação) lança
      // LocationInUnloadedChunkError no typeId; sem catch, o erro ia para o log a cada acerto.
      let id: string;
      try { id = block.typeId; }
      catch { return; }
      const projectile = event.projectile?.isValid ? event.projectile.typeId : "";
      if (id === RING_TARGET) {
        hitRingTarget(block, targetPower(hit.face, hit.faceLocation), targetDuration(projectile));
        return;
      }
      if (ARROWS.has(projectile) && buttonSpec(id).arrows && id.endsWith("_button") && id.startsWith("cobblemon:")) pressButton(block);
    });
  }
  catch { /* ambiente sem mundo (testes) */ }
});
