/**
 * Frente ball-hit: acerto da Poké Ball no Pokémon como no Java (lógica pura, testável no Node).
 *
 * Java (Cobblemon 1.8.2 / MC 1.21.1): `EmptyPokeBallEntity` é um `ThrowableItemProjectile`. A cada tick,
 * `ProjectileUtil.getHitResultOnMoveVector` corta o segmento `posição → posição + deltaMovement` no primeiro bloco e
 * procura entidades cuja caixa, INFLADA em 0,3 em cada lado (`getEntityHitResult(..., margin = 0.3F)`), é cruzada pelo
 * segmento (`AABB.clip`); vence a mais próxima do início. O tamanho da própria bola (0,4 × 0,4) não entra no teste: a
 * bola é um ponto e o alvo ganha a margem. A caixa do Pokémon é `hitbox × baseScale × effectiveScale`
 * (`PokemonEntity.getDimensions`), com a base nos pés e centrada em X/Z.
 *
 * No Bedrock o `minecraft:projectile` testa o acerto com a caixa de colisão sem essa margem e sem o `effectiveScale`
 * (a escala de filhote/intrínseca é só visual: `cobblemon:scale_modifier`), o que deixava Pokémon pequenos quase
 * impossíveis de acertar. O port refaz o teste do Java por script (BallFlight.ts) com estas funções.
 */
import { Vector3 } from "@minecraft/server";

/** ProjectileUtil.getEntityHitResult: margem de 0,3 bloco em cada lado da caixa do alvo (MC 1.21.1). */
export const JAVA_HIT_MARGIN = 0.3;

/** Caixa alinhada aos eixos por cantos. */
export interface Box {
  min: Vector3;
  max: Vector3;
}

/** Caixa do `Entity.getAABB()` (centro + meia-extensão) em cantos. */
export function boxFromAABB(aabb: { center: Vector3; extent: Vector3 }): Box {
  const e = { x: Math.abs(aabb.extent.x), y: Math.abs(aabb.extent.y), z: Math.abs(aabb.extent.z) };
  return {
    min: { x: aabb.center.x - e.x, y: aabb.center.y - e.y, z: aabb.center.z - e.z },
    max: { x: aabb.center.x + e.x, y: aabb.center.y + e.y, z: aabb.center.z + e.z },
  };
}

/** AABB.inflate: aumenta `margin` em cada lado. */
export function inflateBox(box: Box, margin: number): Box {
  return {
    min: { x: box.min.x - margin, y: box.min.y - margin, z: box.min.z - margin },
    max: { x: box.max.x + margin, y: box.max.y + margin, z: box.max.z + margin },
  };
}

/**
 * Caixa do Java a partir da caixa do Bedrock (`hitbox × baseScale`, ou a do Alfa, que tem grupo de tamanho próprio) e
 * da escala efetiva (`cobblemon:scale_modifier` = filhote × intrínseca, só visual no Bedrock): mantém o centro em X/Z e
 * a base (os pés) e multiplica largura e altura. Escala inválida (ausente, 0, NaN) = caixa do Bedrock.
 */
export function scaleBoxFromFeet(box: Box, scale: number | undefined): Box {
  if (scale === undefined || !Number.isFinite(scale) || scale <= 0 || scale === 1) return box;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const hx = (box.max.x - box.min.x) / 2 * scale, hz = (box.max.z - box.min.z) / 2 * scale;
  const height = (box.max.y - box.min.y) * scale;
  return { min: { x: cx - hx, y: box.min.y, z: cz - hz }, max: { x: cx + hx, y: box.min.y + height, z: cz + hz } };
}

/**
 * Fração t ∈ [0, 1] do segmento `start → end` em que ele entra na caixa (método das placas), ou undefined se não
 * cruza. Começando dentro da caixa, t = 0 (o Java só conta a entrada pela face; aqui a bola que nasce dentro de um
 * Pokémon colado no jogador também acerta, como o ThrowBall.ts já pretendia). Segmento de comprimento zero = ponto.
 */
export function segmentBoxEntry(start: Vector3, end: Vector3, box: Box): number | undefined {
  let tMin = 0, tMax = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const s = start[axis], d = end[axis] - s;
    const lo = box.min[axis], hi = box.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (s < lo || s > hi) return undefined;
      continue;
    }
    let t1 = (lo - s) / d, t2 = (hi - s) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return undefined;
  }
  return tMin;
}

export function lerpVector(a: Vector3, b: Vector3, t: number): Vector3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Candidato ao acerto: a entidade e a sua caixa do Java (ainda sem a margem). */
export interface HitCandidate<T> {
  entity: T;
  box: Box;
}

export interface BallHit<T> {
  entity: T;
  /** Ponto de entrada na caixa inflada. */
  point: Vector3;
  /** Índice do trecho do caminho (0 = primeiro segmento). */
  segment: number;
  /** Fração dentro do trecho. */
  t: number;
}

/**
 * Primeiro Pokémon atingido ao longo do caminho da bola (pontos em ordem: trechos percorridos em sequência). Dentro de
 * um trecho vence a entrada mais próxima do início (Java: menor distância ao início do segmento).
 */
export function firstBallHit<T>(path: readonly Vector3[], candidates: readonly HitCandidate<T>[], margin = JAVA_HIT_MARGIN): BallHit<T> | undefined {
  if (!candidates.length) return undefined;
  const boxes = candidates.map((c) => ({ entity: c.entity, box: inflateBox(c.box, margin) }));
  for (let i = 0; i + 1 < path.length; i++) {
    let best: BallHit<T> | undefined;
    for (const c of boxes) {
      const t = segmentBoxEntry(path[i], path[i + 1], c.box);
      if (t !== undefined && (!best || t < best.t)) best = { entity: c.entity, point: lerpVector(path[i], path[i + 1], t), segment: i, t };
    }
    if (best) return best;
  }
  return undefined;
}

/** Centro e raio de uma esfera que contém o caminho (consulta de entidades próximas). */
export function pathBounds(path: readonly Vector3[]): { center: Vector3; radius: number } {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of path) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
  }
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  return { center, radius: Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2 };
}
