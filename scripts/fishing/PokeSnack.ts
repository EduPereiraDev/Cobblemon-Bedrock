/**
 * Poké Snack e Poké Cake (block/PokeSnackBlock.kt + block/entity/PokeSnackBlockEntity.kt +
 * api/spawning/spawner/PokeSnackSpawnerFactory.kt do Cobblemon 1.8.2), como componente de bloco
 * `cobblemon:poke_snack`:
 *
 * - `cobblemon:poke_snack` (isLure): a cada RANDOM_TICKS_BETWEEN_SPAWNS ticks aleatórios (× multiplicador de
 *   bite_time da isca) tenta 1 spawn em volta, com os buckets de Poké Snack, `isPokeSnack = true`, só entradas
 *   que não são herd, efeitos de isca (temperos) e rarity_bucket normalizando os buckets. Cada Pokémon que
 *   sai ganha o aspect `poke_snack_crumbed` e come uma mordida; passou de 8 mordidas, o bloco some.
 * - `cobblemon:poke_cake`: bolo comestível (2 de fome, 0,4 de saturação por mordida), sem spawns.
 *
 * Estado por bloco (spawns feitos, ticks até o próximo, iscas) em dynamic property do mundo: blocos não têm
 * dynamic properties na API estável.
 */
import type { Block, BlockCustomComponent, Dimension, Player, Vector3 } from "@minecraft/server";
import { GameMode, system, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { bucketNormalizingInfluence, SpawnInfluence, trySpawnFromBait } from "../spawning/Spawner";
import { BaitEffect, BaitEffectTypes, baitInfluence, getBaitById, rarityTier } from "./BaitEffects";

export const POKE_SNACK_BLOCK = "cobblemon:poke_snack";
export const POKE_CAKE_BLOCK = "cobblemon:poke_cake";
export const BITES_STATE = "cobblemon:bites";
export const MAX_BITES = 8;
export const SPAWNS_PER_BITE = 1;
export const RANDOM_TICKS_BETWEEN_SPAWNS = 2;
export const POKE_SNACK_CRUMBED_ASPECT = "poke_snack_crumbed";
/**
 * Ticks aleatórios do Java por tick aleatório do Bedrock: randomTickSpeed padrão 3 (Java) × 1 (Bedrock).
 * Mantém o ritmo do Cobblemon (~1 spawn a cada 2 ticks aleatórios do Java).
 */
export const RANDOM_TICK_SCALE = 3;

export interface SnackState {
  /** amountSpawned */
  spawned: number;
  /** randomTicksUntilNextSpawn (em ticks aleatórios do Java). */
  ticks: number;
  /** Ids de isca (componente BAIT_EFFECTS do item colocado). */
  baits?: string[];
}

// ---------------------------------------------------------------------------------------------
// Lógica pura

export function snackEffects(state: SnackState | undefined): BaitEffect[] {
  return (state?.baits ?? []).flatMap(id => getBaitById(id) ?? []);
}

/** getBiteTimeMultiplier: 1 − value de um bite_time ao acaso (se passar na chance). */
export function biteTimeMultiplier(effects: readonly BaitEffect[], random: () => number = Math.random): number {
  const list = effects.filter(e => e.type === BaitEffectTypes.BITE_TIME);
  if (!list.length) return 1;
  const effect = list[Math.floor(random() * list.length)];
  if (random() > effect.chance) return 1;
  return 1 - (effect.value ?? 0);
}

/** getRandomTicksBetweenSpawns (mínimo 1). */
export function randomTicksBetweenSpawns(effects: readonly BaitEffect[], random: () => number = Math.random): number {
  return Math.max(1, RANDOM_TICKS_BETWEEN_SPAWNS * biteTimeMultiplier(effects, random));
}

/** Raio da zona de spawn do Poké Snack (PokeSnackSpawnerFactory: 17×17×17 em volta do bloco). */
export const POKE_SNACK_SPAWN_RADIUS = 8;

/** PokeSnackBlock.eat para o Poké Snack (isLure): mordidas = spawns / SPAWNS_PER_BITE; > 8 → some. */
export function bitesAfterSpawn(spawned: number): { bites: number; consumed: boolean } {
  const bites = Math.floor(spawned / SPAWNS_PER_BITE);
  return { bites, consumed: bites > MAX_BITES };
}

/**
 * Influências de um Poké Snack (PokeSnackSpawnerFactory.influenceBuilders + o próprio bloco):
 * normalização por rarity_bucket (firstTier 1,2), efeitos de isca e "só não-herd" + aspect crumbed.
 */
export function snackInfluences(effects: readonly BaitEffect[], onSpawn?: SpawnInfluence["affectEntity"]): SpawnInfluence[] {
  const out: SpawnInfluence[] = [];
  const tier = rarityTier(effects);
  if (tier > 0) out.push(bucketNormalizingInfluence(tier, 0.2, 1.2));
  out.push(baitInfluence(effects, { aspect: POKE_SNACK_CRUMBED_ASPECT }));
  out.push({ affectSpawnable: entry => entry.type === "pokemon" && !entry.herd, affectEntity: onSpawn });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Estado por bloco

function stateKey(dimension: Dimension, loc: Vector3): string {
  return `cobblemon:snack:${dimension.id}:${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
}

export function getSnackState(dimension: Dimension, loc: Vector3): SnackState | undefined {
  try {
    const raw = world.getDynamicProperty(stateKey(dimension, loc));
    return typeof raw === "string" ? JSON.parse(raw) as SnackState : undefined;
  }
  catch { return undefined; }
}

function saveSnackState(dimension: Dimension, loc: Vector3, state: SnackState | undefined) {
  try { world.setDynamicProperty(stateKey(dimension, loc), state ? JSON.stringify(state) : undefined); }
  catch { /* limite de dynamic properties */ }
}

/**
 * Para a frente de culinária: grava as iscas (ids de SpawnBaitEffects/temperos) de um Poké Snack recém-colocado
 * (PokeSnackBlockEntity.initializeFromItemStack).
 */
export function setPokeSnackBaits(dimension: Dimension, loc: Vector3, baits: string[]) {
  const state = getSnackState(dimension, loc) ?? { spawned: 0, ticks: RANDOM_TICKS_BETWEEN_SPAWNS };
  state.baits = baits;
  state.ticks = randomTicksBetweenSpawns(snackEffects(state));
  saveSnackState(dimension, loc, state);
}

// ---------------------------------------------------------------------------------------------
// Mundo

function setBites(block: Block, bites: number) {
  try { block.setPermutation(block.permutation.withState(BITES_STATE as never, bites as never)); }
  catch { /* bloco sem o estado */ }
}

function getBites(block: Block): number {
  try { return Number(block.permutation.getState(BITES_STATE as never) ?? 0); }
  catch { return 0; }
}

function removeSnack(block: Block, dimension: Dimension) {
  const loc = block.location;
  saveSnackState(dimension, loc, undefined);
  try { block.setType("minecraft:air"); }
  catch { /* já saiu */ }
}

function playEat(dimension: Dimension, loc: Vector3) {
  try { dimension.playSound("random.eat", loc); }
  catch { /* sem som */ }
}

/** Um Pokémon saiu do Poké Snack: conta o spawn e come uma mordida. */
function eatFromSpawn(dimension: Dimension, loc: Vector3) {
  let block: Block | undefined;
  try { block = dimension.getBlock(loc); }
  catch { return; }
  if (!block || block.typeId !== POKE_SNACK_BLOCK) return;
  const state = getSnackState(dimension, loc) ?? { spawned: 0, ticks: RANDOM_TICKS_BETWEEN_SPAWNS };
  state.spawned++;
  const { bites, consumed } = bitesAfterSpawn(state.spawned);
  playEat(dimension, { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
  if (consumed) {
    removeSnack(block, dimension);
    return;
  }
  saveSnackState(dimension, loc, state);
  setBites(block, bites);
}

function nearestPlayer(dimension: Dimension, loc: Vector3, maxDistance: number): Player | undefined {
  try { return dimension.getPlayers({ location: loc, maxDistance, closest: 1 })[0]; }
  catch { return undefined; }
}

/** randomTick + attemptSpawn do PokeSnackBlockEntity. */
export function pokeSnackRandomTick(block: Block, dimension: Dimension) {
  if (block.typeId !== POKE_SNACK_BLOCK) return;
  const loc = block.location;
  const state = getSnackState(dimension, loc) ?? { spawned: 0, ticks: RANDOM_TICKS_BETWEEN_SPAWNS };
  const effects = snackEffects(state);
  state.ticks -= RANDOM_TICK_SCALE;
  if (state.ticks > 0) {
    saveSnackState(dimension, loc, state);
    return;
  }
  state.ticks = randomTicksBetweenSpawns(effects);
  saveSnackState(dimension, loc, state);
  const center = { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 };
  const player = nearestPlayer(dimension, center, getConfig().maximumSpawningZoneDistanceFromPlayer);
  if (!player) return;
  try {
    trySpawnFromBait(dimension, center, {
      player, maxSpawns: 1,
      // PokeSnackSpawnerFactory: zona fixa de raio 8 em volta do bloco.
      radius: POKE_SNACK_SPAWN_RADIUS,
      influences: snackInfluences(effects, () => eatFromSpawn(dimension, loc)),
    });
  }
  catch (e) { console.warn(`[pesca] Poké Snack não spawnou: ${e}`); }
}

/** Poké Cake: comer uma fatia (playerEat) se o jogador tiver fome (ou estiver no criativo). */
export function eatPokeCake(block: Block, player: Player) {
  if (block.typeId !== POKE_CAKE_BLOCK) return;
  let creative = false;
  try { creative = player.getGameMode() === GameMode.Creative; }
  catch { /* sem modo */ }
  const hunger = player.getComponent("minecraft:player.hunger");
  if (!creative && hunger && hunger.currentValue >= hunger.effectiveMax) return;
  if (hunger) hunger.setCurrentValue(Math.min(hunger.effectiveMax, hunger.currentValue + 2));
  const saturation = player.getComponent("minecraft:player.saturation");
  if (saturation && hunger) saturation.setCurrentValue(Math.min(hunger.currentValue, saturation.currentValue + 2 * 0.1 * 2));
  const dimension = block.dimension;
  const bites = getBites(block) + 1;
  playEat(dimension, player.location);
  if (bites > MAX_BITES) removeSnack(block, dimension);
  else setBites(block, bites);
}

/** Componente de bloco `cobblemon:poke_snack` (Poké Snack e Poké Cake). */
export const PokeSnackComponent: BlockCustomComponent = {
  onRandomTick: ({ block, dimension }) => {
    system.run(() => {
      try { if (block.isValid) pokeSnackRandomTick(block, dimension); }
      catch (e) { console.warn(`[pesca] Poké Snack: ${e}`); }
    });
  },
  onPlayerInteract: ({ block, player }) => {
    if (!player) return;
    system.run(() => {
      try { if (block.isValid && player.isValid) eatPokeCake(block, player); }
      catch (e) { console.warn(`[pesca] Poké Cake: ${e}`); }
    });
  },
  onBreak: ({ block, dimension }) => saveSnackState(dimension, block.location, undefined),
};
