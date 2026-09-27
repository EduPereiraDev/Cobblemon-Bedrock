/**
 * Abelhas nas plantas do Cobblemon (tag `minecraft:bee_growables` do Cobblemon 1.8.2 + Bee.BeeGrowCropGoal do MC
 * 1.21.1 + BeeEntityMixin do Cobblemon).
 *
 * No Java a abelha com néctar roda a meta BeeGrowCropGoal: a cada tick da meta (as metas comuns rodam a cada 2 ticks)
 * há 1 em adjustedTickDelay(30) = 15 de chance de olhar os 2 blocos abaixo dela; cada um que estiver na tag e puder
 * crescer ganha 1 de idade (partícula de farinha de osso) e conta para o limite de 10 plantas por polinização.
 * `canUse`/`canContinueToUse` falham 30 % das vezes (a meta para e volta), exigem néctar, colmeia válida e menos de 10
 * plantas desde a última polinização (o contador zera quando a abelha pega néctar).
 *
 * O que cresce de fato (a tag inclui mais blocos, mas o código só mexe nestes):
 * - CropBlock: mints (idade até 7), vivichoke (7), revival herb (8; `getStateForAge` volta ao estado padrão, então
 *   a mutação some — igual ao Java) e medicinal leek (3);
 * - SaccharineLeafBlock (mixin): idade < 2 e sem água → +1.
 * Apricorns e galarica estão na tag mas não são CropBlock/StemBlock: no Java a abelha não faz nada com eles.
 * Berries não estão na tag.
 *
 * No Bedrock: a cada 10 ticks, para cada abelha carregada com `minecraft:has_nectar`, simula os 5 ticks da meta com a
 * posição do momento. A colmeia não é visível a scripts: a exigência de colmeia válida fica de fora.
 */
import { Block, Dimension, Entity, system, world } from "@minecraft/server";

export const SAMPLE_TICKS = 10;
/** As metas comuns rodam a cada 2 ticks (Mob.serverAiStep). */
export const GOAL_TICK_EVERY = 2;
/** adjustedTickDelay(30) com metas a cada 2 ticks. */
export const GROW_ROLL = 15;
/** Bee.canBeeUse: `random.nextFloat() < 0.3F` → false. */
export const CAN_USE_FAIL = 0.3;
export const MAX_CROPS_PER_POLLINATION = 10;
const AGE = "cobblemon:age";

export interface BeeGrowRule {
  maxAge: number;
  /** Estados que voltam ao padrão (CropBlock.getStateForAge usa defaultBlockState). */
  reset?: Record<string, string | number | boolean>;
  /** SaccharineLeafBlock: só sem água. */
  dryOnly?: boolean;
}

const MINTS = ["red", "blue", "cyan", "pink", "green", "white"].map(c => `cobblemon:${c}_mint`);

/** Blocos da tag que crescem de fato com a abelha. */
export const BEE_GROW_RULES: Record<string, BeeGrowRule> = {
  ...Object.fromEntries(MINTS.map(id => [id, { maxAge: 7 }])),
  "cobblemon:vivichoke_seeds": { maxAge: 7 },
  "cobblemon:revival_herb": { maxAge: 8, reset: { "cobblemon:mutation": "none" } },
  "cobblemon:medicinal_leek": { maxAge: 3 },
  "cobblemon:saccharine_leaves": { maxAge: 2, dryOnly: true },
};

/** Estão na tag bee_growables do Cobblemon mas o Java não os faz crescer (não são CropBlock). */
export const BEE_TAG_NO_EFFECT = [
  ...["black", "blue", "green", "pink", "red", "white", "yellow"].map(c => `cobblemon:${c}_apricorn_block`),
  "cobblemon:galarica_nut_bush",
];

/** rng trocável nos testes. */
export const beeRng = { next: (): number => Math.random() };

/**
 * Um tick da meta (GoalSelector.tick): para se `canContinueToUse` falhar, tenta começar de novo (`canUse`) no mesmo
 * tick e, rodando, sorteia o crescimento. `eligible` = néctar e menos de 10 plantas.
 */
export function goalStep(running: boolean, eligible: boolean, rnd: () => number = beeRng.next): { running: boolean; grow: boolean } {
  if (!eligible) return { running: false, grow: false };
  if (running && rnd() < CAN_USE_FAIL) running = false;
  if (!running && rnd() >= CAN_USE_FAIL) running = true;
  const grow = running && Math.floor(rnd() * GROW_ROLL) === 0;
  return { running, grow };
}

/** Próxima idade de um bloco da tag (undefined = não cresce). */
export function beeGrowth(typeId: string, age: number, waterlogged: boolean): number | undefined {
  const rule = BEE_GROW_RULES[typeId];
  if (!rule) return undefined;
  if (rule.dryOnly && waterlogged) return undefined;
  return age < rule.maxAge ? age + 1 : undefined;
}

// ---------------------------------------------------------------------------------------------
// Mundo

const NECTAR = "minecraft:has_nectar";
const CROPS_PROPERTY = "cobblemon:bee_crops";
const NECTAR_SEEN = "cobblemon:bee_nectar";
const running = new Map<string, boolean>();

function hasNectar(bee: Entity): boolean {
  try { return bee.getProperty(NECTAR) === true; }
  catch { return false; }
}

function cropsGrown(bee: Entity): number {
  const v = bee.getDynamicProperty(CROPS_PROPERTY);
  return typeof v === "number" ? v : 0;
}

/** Cresce o bloco (true = cresceu). */
export function growBlock(block: Block): boolean {
  let age: number;
  try { age = Number(block.permutation.getState(AGE as never) ?? 0); }
  catch { return false; }
  const next = beeGrowth(block.typeId, age, block.isWaterlogged);
  if (next === undefined) return false;
  try {
    let perm = block.permutation.withState(AGE as never, next as never);
    for (const [k, v] of Object.entries(BEE_GROW_RULES[block.typeId].reset ?? {})) perm = perm.withState(k as never, v as never);
    block.setPermutation(perm);
  }
  catch { return false; }
  // levelEvent 2011 (partículas de farinha de osso).
  try { block.dimension.spawnParticle("minecraft:crop_growth_emitter", { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 }); }
  catch { /* partícula é cosmética */ }
  return true;
}

/** Uma amostragem de uma abelha (steps ticks da meta). Devolve quantas plantas cresceram. */
export function sampleBee(bee: Entity, steps = SAMPLE_TICKS / GOAL_TICK_EVERY): number {
  const nectar = hasNectar(bee);
  const seen = bee.getDynamicProperty(NECTAR_SEEN) === true;
  // setHasNectar(true) zera o contador de plantas.
  if (nectar && !seen) bee.setDynamicProperty(CROPS_PROPERTY, 0);
  if (nectar !== seen) bee.setDynamicProperty(NECTAR_SEEN, nectar);
  if (!nectar) { running.delete(bee.id); return 0; }
  let crops = cropsGrown(bee);
  let isRunning = running.get(bee.id) ?? false;
  let grown = 0;
  const loc = bee.location;
  for (let s = 0; s < steps; s++) {
    const step = goalStep(isRunning, crops < MAX_CROPS_PER_POLLINATION);
    isRunning = step.running;
    if (!step.grow) continue;
    for (let i = 1; i <= 2; i++) {
      let block: Block | undefined;
      try { block = bee.dimension.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y) - i, z: Math.floor(loc.z) }); }
      catch { block = undefined; }
      if (block && BEE_GROW_RULES[block.typeId] && growBlock(block)) { crops++; grown++; }
    }
  }
  running.set(bee.id, isRunning);
  if (grown) bee.setDynamicProperty(CROPS_PROPERTY, crops);
  return grown;
}

function dimensions(): Dimension[] {
  const out: Dimension[] = [];
  for (const id of ["overworld", "nether", "the_end"]) {
    try { out.push(world.getDimension(id)); }
    catch { /* dimensão indisponível */ }
  }
  return out;
}

export function tickBees() {
  const alive = new Set<string>();
  for (const dim of dimensions()) {
    let bees: Entity[] = [];
    try { bees = dim.getEntities({ type: "minecraft:bee" }); }
    catch { continue; }
    for (const bee of bees) {
      alive.add(bee.id);
      try { sampleBee(bee); }
      catch { /* abelha saindo */ }
    }
  }
  for (const id of running.keys()) if (!alive.has(id)) running.delete(id);
}

export function startBees() {
  system.runInterval(tickBees, SAMPLE_TICKS);
}
