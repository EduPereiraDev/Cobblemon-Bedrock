/**
 * Onde o Pokémon aparece ao ser mandado para fora (ServerPlayer.raycastSafeSendout do Cobblemon 1.8.2, chamado pelo
 * SendOutPokemonHandler com alcance 12, queda 5 e fluidos ANY):
 * - mira no topo de um bloco cujo bloco de cima não é sólido → em cima dele, no ponto mirado;
 * - mira na lateral/baixo de um bloco → à frente da face (0,125 + meia largura, ou meia altura embaixo), descendo até
 *   5 blocos até o chão;
 * - mira no ar → anda pela linha da mira de 2,5 até 12 e, em cada passo, procura chão embaixo (queda crescente de 0 a
 *   5); fica com o chão mais próximo da mira;
 * - nada seguro → não manda (undefined). Nunca no pé do jogador.
 * `isPositionSafe`: o bloco de apoio e o de dentro não podem ser arbusto de berry, cacto, rosa do Wither, fogo, magma,
 * fogueira ou lava. (O Java libera fogo/lava para espécies imunes a fogo; aqui não há esse dado no script: todas evitam.)
 *
 * "Sólido" no Bedrock estável (não há `Block.isSolid`): o raio que ignora blocos atravessáveis (grama, flores) para
 * nele. A mira também ignora os atravessáveis: mirar a grama alta cai no bloco de baixo (o mesmo lugar em que o Java
 * deixa o Pokémon depois da gravidade).
 */
import { Dimension, Direction, Player, Vector3 } from "@minecraft/server";

export const SEND_OUT_RANGE = 12;
export const SEND_OUT_DROP = 5;
const MIN_DROP = 2.5;
/** O Java anda 0,05; 0,1 dá o mesmo chão com metade das consultas (a mira cruza um bloco a cada ≥ 10 passos). */
const AIR_STEP = 0.1;
const TRACE_STEP = 0.5;

const UNSAFE = new Set([
  "minecraft:sweet_berry_bush", "minecraft:cactus", "minecraft:wither_rose",
  "minecraft:fire", "minecraft:soul_fire", "minecraft:magma", "minecraft:campfire", "minecraft:soul_campfire",
  "minecraft:lava", "minecraft:flowing_lava",
]);

export interface Hitbox { width: number; height: number; scale: number }

/** O mundo como o cálculo precisa (o runtime usa a dimensão; os testes, um mapa de blocos). */
export interface SendOutWorld {
  /** Primeiro bloco na mira (sem atravessáveis; com líquidos), com a face e o ponto exato. */
  aim(): { block: Vector3; face: Direction; point: Vector3 } | undefined;
  /** Bloco sólido (para um raio que ignora atravessáveis) na posição inteira. */
  solid(pos: Vector3): boolean;
  /** Bloco não-ar (sólido, atravessável ou líquido) na posição inteira. */
  nonAir(pos: Vector3): boolean;
  typeId(pos: Vector3): string | undefined;
}

const floor3 = (p: Vector3): Vector3 => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const same = (a: Vector3, b: Vector3) => a.x === b.x && a.y === b.y && a.z === b.z;

/** Pokemon.isPositionSafe: o bloco de apoio e o par (acima se sólido, senão abaixo). */
export function isPositionSafe(world: SendOutWorld, pos: Vector3): boolean {
  const other = world.solid(pos) ? { ...pos, y: pos.y + 1 } : { ...pos, y: pos.y - 1 };
  for (const p of [pos, other]) {
    const id = world.typeId(p);
    if (id && UNSAFE.has(id)) return false;
  }
  return true;
}

/** Vec3.traceDownwards: desce de 0,5 em 0,5 até `maxDistance`; o primeiro bloco não-ar. */
export function traceDownwards(world: SendOutWorld, start: Vector3, maxDistance: number): { location: Vector3; block: Vector3 } | undefined {
  let last = floor3(start);
  for (let step = TRACE_STEP; step <= maxDistance; step += TRACE_STEP) {
    const location = { x: start.x, y: start.y - step, z: start.z };
    const block = floor3(location);
    if (same(block, last)) continue;
    last = block;
    if (world.nonAir(block)) return { location, block };
  }
  return undefined;
}

function faceNormal(face: Direction): Vector3 {
  switch (face) {
    case Direction.Up: return { x: 0, y: 1, z: 0 };
    case Direction.Down: return { x: 0, y: -1, z: 0 };
    case Direction.North: return { x: 0, y: 0, z: -1 };
    case Direction.South: return { x: 0, y: 0, z: 1 };
    case Direction.West: return { x: -1, y: 0, z: 0 };
    default: return { x: 1, y: 0, z: 0 };
  }
}

/** raycastSafeSendout. `eye` e `dir` (unitário) da cabeça do jogador. */
export function safeSendOutPosition(world: SendOutWorld, eye: Vector3, dir: Vector3, hitbox: Hitbox, maxDistance = SEND_OUT_RANGE, dropHeight = SEND_OUT_DROP): Vector3 | undefined {
  const hit = world.aim();
  if (!hit) {
    // Mira no ar: o chão embaixo da linha da mira mais perto dela.
    const minDrop = Math.min(MIN_DROP, maxDistance);
    let best: Vector3 | undefined;
    let smallest = dropHeight;
    for (let step = minDrop; step <= maxDistance + 1e-9; step += AIR_STEP) {
      const pos = { x: eye.x + dir.x * step, y: eye.y + dir.y * step, z: eye.z + dir.z * step };
      const drop = minDrop !== maxDistance ? ((step - minDrop) / (maxDistance - minDrop)) * dropHeight : minDrop;
      const down = traceDownwards(world, pos, drop);
      if (!down || !isPositionSafe(world, down.block)) continue;
      const height = pos.y - down.location.y;
      if (height < smallest) {
        smallest = height;
        best = down.block;
      }
    }
    return best ? { x: best.x + 0.5, y: best.y + 1, z: best.z + 0.5 } : undefined;
  }
  if (hit.face !== Direction.Up) {
    // Lateral ou de baixo: um pouco à frente da face e desce até o chão.
    const offset = 0.125 + (hit.face === Direction.Down ? hitbox.height : hitbox.width) * hitbox.scale * 0.5;
    const n = faceNormal(hit.face);
    const pos = { x: hit.point.x + n.x * offset, y: hit.point.y + n.y * offset, z: hit.point.z + n.z * offset };
    const down = traceDownwards(world, pos, dropHeight);
    if (!down || !isPositionSafe(world, down.block)) return undefined;
    return { x: down.location.x, y: down.block.y + 1, z: down.location.z };
  }
  const above = { ...hit.block, y: hit.block.y + 1 };
  if (!world.solid(above) && isPositionSafe(world, hit.block)) return { x: hit.point.x, y: hit.block.y + 1, z: hit.point.z };
  return undefined;
}

/** O mundo real a partir da dimensão e da mira do jogador. */
export function worldFor(player: Player, maxDistance = SEND_OUT_RANGE): SendOutWorld {
  const dimension: Dimension = player.dimension;
  const block = (pos: Vector3) => { try { return dimension.getBlock(pos); } catch { return undefined; } };
  return {
    aim() {
      try {
        const hit = player.getBlockFromViewDirection({ maxDistance, includeLiquidBlocks: true, includePassableBlocks: false });
        if (!hit) return undefined;
        const b = hit.block;
        return { block: { x: b.x, y: b.y, z: b.z }, face: hit.face, point: { x: b.x + hit.faceLocation.x, y: b.y + hit.faceLocation.y, z: b.z + hit.faceLocation.z } };
      }
      catch { return undefined; }
    },
    solid(pos) {
      const b = block(pos);
      if (!b || b.isAir || b.isLiquid) return false;
      try {
        // Raio curto de cima para baixo dentro do próprio bloco, ignorando atravessáveis.
        const ray = dimension.getBlockFromRay({ x: pos.x + 0.5, y: pos.y + 0.999, z: pos.z + 0.5 }, { x: 0, y: -1, z: 0 }, { maxDistance: 0.998, includePassableBlocks: false, includeLiquidBlocks: false });
        return !!ray && ray.block.x === pos.x && ray.block.y === pos.y && ray.block.z === pos.z;
      }
      catch { return true; }
    },
    nonAir(pos) {
      const b = block(pos);
      return !!b && !b.isAir;
    },
    typeId(pos) {
      return block(pos)?.typeId;
    },
  };
}

/**
 * Plano B do menu do time (o Java só manda pela mira): o chão à frente do jogador, de 2 a 4 blocos na horizontal,
 * descendo até 8 blocos a partir da altura dos olhos; o primeiro lugar seguro. Undefined se não houver chão.
 */
export function groundInFront(world: SendOutWorld, eye: Vector3, dir: Vector3): Vector3 | undefined {
  const h = Math.hypot(dir.x, dir.z);
  const fx = h > 1e-6 ? dir.x / h : 0, fz = h > 1e-6 ? dir.z / h : 1;
  for (const d of [2.5, 3, 2, 3.5, 4]) {
    const pos = { x: eye.x + fx * d, y: eye.y, z: eye.z + fz * d };
    const down = traceDownwards(world, pos, 8);
    if (down && isPositionSafe(world, down.block) && !world.solid({ ...down.block, y: down.block.y + 1 }))
      return { x: down.location.x, y: down.block.y + 1, z: down.location.z };
  }
  return undefined;
}
