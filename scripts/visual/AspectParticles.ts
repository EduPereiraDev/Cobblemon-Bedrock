/**
 * Frente visual-final (#88): partículas de aspect fora de batalha, port de `AspectParticleMap` +
 * `PokemonClientDelegate.spawnAspectParticle` (Cobblemon 1.8.2).
 *
 * No Cobblemon, a cada tick do cliente, cada Pokémon a até 8 blocos (caixa 16×16×16) do jogador, que não esteja
 * silencioso (dentro da bola/captura), sorteia por aspect: `honey_drenched` → FALLING_HONEY (7,5 %, 1 partícula),
 * `poke_snack_crumbed` → partículas de bloco do Poké Snack (5 %, 3). Cada partícula nasce num ponto aleatório do
 * hitbox. `has_nectar` fica com o comportamento da abelha (scripts/entity/SpeciesBehaviours.ts) e `alpha_eyes` é
 * do cliente (animação gerada por tools/importer/visualFinal.ts, presa aos locators de olho).
 *
 * No Bedrock o servidor decide: um passe a cada 2 ticks (dois sorteios por passe, a mesma taxa por tick); os
 * aspects de cada entidade são relidos da propriedade `data` no máximo a cada 2 s.
 */
import { Dimension, Entity, Vector3, system, world } from "@minecraft/server";
import { getEntityInfo } from "../entity/EntityData";

export interface AspectParticle {
  /** Partícula do Bedrock (spawnParticle). */
  particle: string;
  /** Chance por tick. */
  chance: number;
  /** Partículas por sorteio. */
  amount: number;
}

/**
 * AspectParticleMap sem `alpha_eyes` (cliente) e `has_nectar` (abelha). FALLING_HONEY → `honey_drip_particle`
 * (a gota de mel do Bedrock); o bloco do Poké Snack → `cobblemon:poke_snack_crumbs` (partícula de bloco com a
 * textura `poke_snack_particle` do Cobblemon, resource_packs/.../particles/visual_final).
 */
export const ASPECT_PARTICLES: Readonly<Record<string, AspectParticle>> = {
  honey_drenched: { particle: "minecraft:honey_drip_particle", chance: 0.075, amount: 1 },
  poke_snack_crumbed: { particle: "cobblemon:poke_snack_crumbs", chance: 0.05, amount: 3 },
};

/** Meia aresta da caixa de busca (AABB.ofSize(player, 16, 16, 16)). */
export const ASPECT_PARTICLE_RANGE = 8;
const PASS_TICKS = 2;
const REFRESH_TICKS = 40;

/** Aspects da lista `aspects` do JSON salvo em `data`, sem montar o PokemonData inteiro. */
export function aspectsFromData(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const match = /"aspects"\s*:\s*\[([^\]]*)\]/.exec(raw);
  if (!match) return [];
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1])) !== null) out.push(m[1]);
  return out;
}

/** Quais partículas de aspect a entidade solta (na ordem do mapa). */
export function aspectParticlesFor(aspects: readonly string[]): AspectParticle[] {
  return Object.entries(ASPECT_PARTICLES).filter(([aspect]) => aspects.includes(aspect)).map(([, p]) => p);
}

/**
 * Quantas partículas saem em `ticks` ticks (um sorteio por tick, como o spawnAspectParticle).
 * @param random gerador (testes).
 */
export function rollAspectParticles(particle: AspectParticle, ticks: number, random: () => number = Math.random): number {
  let n = 0;
  for (let i = 0; i < ticks; i++) if (particle.chance > random()) n += particle.amount;
  return n;
}

/** Ponto aleatório no hitbox (largura × altura × escala do grupo de tamanho, Alfa incluído). */
export function randomPointInHitbox(location: Vector3, width: number, height: number, random: () => number = Math.random): Vector3 {
  return {
    x: location.x + (random() - 0.5) * width,
    y: location.y + random() * height,
    z: location.z + (random() - 0.5) * width,
  };
}

function hitboxOf(entity: Entity): { width: number; height: number } {
  const info = getEntityInfo(entity.typeId);
  let alpha = false;
  try { alpha = entity.getProperty("cobblemon:alpha") === true; } catch { }
  const size = info ? info.sizes[(alpha ? info.sizeAlpha[""] : info.sizeForms[""]) ?? 0] ?? info.sizes[0] : undefined;
  let modifier = 1;
  try {
    const value = entity.getProperty("cobblemon:scale_modifier");
    if (typeof value === "number" && value > 0) modifier = value;
  }
  catch { }
  return size ? { width: size.width * size.scale * modifier, height: size.height * size.scale * modifier } : { width: 0.6, height: 1 };
}

interface Cached {
  tick: number;
  particles: AspectParticle[];
}
const cache = new Map<string, Cached>();

function particlesOf(entity: Entity, now: number): AspectParticle[] {
  const cached = cache.get(entity.id);
  if (cached && now - cached.tick < REFRESH_TICKS) return cached.particles;
  let raw: unknown;
  try { raw = entity.getDynamicProperty("data"); } catch { }
  const particles = aspectParticlesFor(aspectsFromData(raw));
  cache.set(entity.id, { tick: now, particles });
  return particles;
}

/** "Silencioso" no Cobblemon: na captura (busy + invisível) ou sendo enviado/recolhido. */
function isQuiet(entity: Entity): boolean {
  try { return entity.getProperty("cobblemon:busy") === true; }
  catch { return false; }
}

/**
 * Um passe em volta de um ponto: sorteia e solta as partículas dos Pokémon na caixa. `seen` evita repetir entidades
 * entre jogadores. Devolve quantas partículas saíram (sonda de depuração).
 */
export function aspectParticlePass(dimension: Dimension, center: Vector3, seen = new Set<string>(), now = system.currentTick): number {
  let spawned = 0;
  let nearby: Entity[];
  try {
    const r = ASPECT_PARTICLE_RANGE;
    nearby = dimension.getEntities({
      families: ["pokemon"],
      location: { x: center.x - r, y: center.y - r, z: center.z - r },
      volume: { x: 2 * r, y: 2 * r, z: 2 * r },
    });
  }
  catch { return 0; }
  for (const entity of nearby) {
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    const particles = particlesOf(entity, now);
    if (!particles.length || isQuiet(entity)) continue;
    const box = hitboxOf(entity);
    for (const particle of particles) {
      const n = rollAspectParticles(particle, PASS_TICKS);
      for (let i = 0; i < n; i++) {
        try {
          entity.dimension.spawnParticle(particle.particle, randomPointInHitbox(entity.location, box.width, box.height));
          spawned++;
        }
        catch { /* partícula ausente */ }
      }
    }
  }
  return spawned;
}

function pass() {
  const seen = new Set<string>();
  for (const player of world.getAllPlayers()) {
    if (player.isValid) aspectParticlePass(player.dimension, player.location, seen);
  }
}

let started = false;

/** Liga as partículas de aspect (worldLoad). */
export function startAspectParticles() {
  if (started) return;
  started = true;
  world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => { cache.delete(removedEntityId); });
  system.runInterval(() => {
    try { pass(); }
    catch (e) { console.warn(`Partículas de aspect: ${e}`); }
  }, PASS_TICKS);
}
