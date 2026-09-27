/**
 * Tora de saccharine com mel como influência de spawn (Cobblemon 1.7.0: `SaccharineLogSlatheredDetector` +
 * `SaccharineLogSlatheredInfluence`).
 *
 * - Detector: toras `cobblemon:saccharine_log_slathered` a até 32 + diagonal da zona do centro da zona de spawn; cada
 *   uma influencia as posições a até 32 blocos (SpatialSpawningZoneInfluence).
 * - No Pokémon que nasce sob a influência (uma vez por tora, sem Pokémon que já tenha habilidade oculta ou
 *   `honey_drenched`): 5 % de habilidade oculta, 1/`honeySlatherShinyChance` de shiny, 1/`honeySlatherAlphaChance` de
 *   Alfa (moveset de Alfa), e na primeira ativação da tora: o Pokémon vai para a frente da face com mel, toca o arroto,
 *   a tora volta a ser comum e o Pokémon ganha o aspect `honey_drenched`.
 *
 * O Bedrock não tem POI: o port guarda as toras com mel num registro (dynamic property de mundo) quando o jogador passa
 * mel (ou coloca a tora) e confere o bloco antes de usar.
 */
import { BlockPermutation, Dimension, Entity, Vector3, system, world } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import type { SpawnAction, SpawnInfluence } from "./SpawnSelector";
import type { SpawnContext } from "./SpawnConditions";
import { getConfig } from "../Config";

export const SLATHERED_LOG = "cobblemon:saccharine_log_slathered";
export const PLAIN_LOG = "cobblemon:saccharine_log";
export const HONEY_DRENCHED_ASPECT = "honey_drenched";
export const HIDDEN_ABILITY_CHANCE = 0.05;
export const DETECTOR_RANGE = 32;
const SAFE_BLOCK_SEARCH_DISTANCE = 10;
const REGISTRY_PROPERTY = "cobblemon:slathered_logs";

interface LogPos { dimension: string; x: number; y: number; z: number }

const registry = new Map<string, LogPos>();
let loaded = false;

const keyOf = (p: LogPos) => `${p.dimension}|${p.x}|${p.y}|${p.z}`;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = world.getDynamicProperty(REGISTRY_PROPERTY);
    if (typeof raw !== "string") return;
    for (const pos of JSON.parse(raw) as LogPos[]) registry.set(keyOf(pos), pos);
  }
  catch { /* registro inválido: recomeça */ }
}

function save() {
  try { world.setDynamicProperty(REGISTRY_PROPERTY, JSON.stringify([...registry.values()])); }
  catch (e) { console.warn(`Toras com mel: ${e}`); }
}

/** Registra uma tora com mel (chamado quando o bloco vira `saccharine_log_slathered`). */
export function registerSlatheredLog(dimension: string, pos: Vector3) {
  load();
  const entry = { dimension, x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  if (registry.has(keyOf(entry))) return;
  registry.set(keyOf(entry), entry);
  save();
}

export function unregisterSlatheredLog(entry: LogPos) {
  if (registry.delete(keyOf(entry))) save();
}

/** Toras registradas (para testes e depuração). */
export function slatheredLogs(): LogPos[] {
  load();
  return [...registry.values()];
}

/** Estado de uma influência: `activated` depois que a tora foi consumida. */
export interface HoneyInfluenceState {
  log: LogPos;
  activated: boolean;
}

/**
 * affectSpawn sem o mundo (testável): rolagens de HA, shiny e Alfa no Pokémon. Retorna o que mudou.
 * `giveHiddenAbility` e `setAlpha` vêm de fora para não depender do spawner aqui.
 */
export function rollHoneyBonuses(
  pokemon: Pick<PokemonData, "aspects" | "shiny">,
  hasHiddenAbility: boolean,
  config: { honeySlatherShinyChance: number; honeySlatherAlphaChance: number },
  random: () => number = Math.random,
): { skip: boolean; hiddenAbility: boolean; shiny: boolean; alpha: boolean } {
  if (pokemon.aspects.includes(HONEY_DRENCHED_ASPECT) || hasHiddenAbility) return { skip: true, hiddenAbility: false, shiny: false, alpha: false };
  const hiddenAbility = random() <= HIDDEN_ABILITY_CHANCE;
  const shiny = !pokemon.shiny && config.honeySlatherShinyChance > 0 && Math.floor(random() * config.honeySlatherShinyChance) === 0;
  const alpha = !pokemon.aspects.includes("alpha") && config.honeySlatherAlphaChance > 0 && Math.floor(random() * config.honeySlatherAlphaChance) === 0;
  return { skip: false, hiddenAbility, shiny, alpha };
}

const FACE_OFFSETS: Record<string, { x: number; z: number }> = {
  north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
};

/** attemptSafeMove: procura um lugar livre em meio-círculo na frente da face com mel, descendo até 10 blocos. */
function findSafeSpot(dimension: Dimension, log: LogPos, face: string, inWater: boolean): Vector3 | undefined {
  const dir = FACE_OFFSETS[face];
  if (!dir) return undefined;
  const origin = { x: log.x + dir.x, y: log.y, z: log.z + dir.z };
  for (let radius = 0; radius <= SAFE_BLOCK_SEARCH_DISTANCE; radius++) {
    for (let down = 0; down < SAFE_BLOCK_SEARCH_DISTANCE; down++) {
      const y = origin.y - down;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx * dx + dz * dz > radius * radius) continue;
          if (dx * dir.x + dz * dir.z < 0) continue;
          try {
            const at = dimension.getBlock({ x: origin.x + dx, y, z: origin.z + dz });
            const below = dimension.getBlock({ x: origin.x + dx, y: y - 1, z: origin.z + dz });
            if (!at || !below) continue;
            if (!at.isAir && !at.isLiquid) continue;
            const water = below.typeId === "minecraft:water" || below.typeId === "minecraft:flowing_water";
            if (inWater ? water : !below.isAir && !below.isLiquid) return { x: at.x + 0.5, y: at.y, z: at.z + 0.5 };
          }
          catch { /* fora do mundo carregado */ }
        }
      }
    }
  }
  return undefined;
}

/** Consome a tora (primeira ativação): move o Pokémon, arroto, tora comum. */
function consumeLog(state: HoneyInfluenceState, entity: Entity) {
  const log = state.log;
  let dimension: Dimension;
  try { dimension = world.getDimension(log.dimension); }
  catch { return; }
  const block = dimension.getBlock(log);
  if (block?.typeId !== SLATHERED_LOG) return;
  const face = String(block.permutation.getState("minecraft:cardinal_direction" as never) ?? "north");
  const safe = findSafeSpot(dimension, log, face, entity.isInWater);
  if (safe) entity.teleport(safe);
  try { dimension.playSound("random.burp", log); } catch { }
  try { dimension.spawnParticle("minecraft:honey_drip_particle", { x: log.x + 0.5, y: log.y + 0.8, z: log.z + 0.5 }); } catch { }
  block.setPermutation(BlockPermutation.resolve(PLAIN_LOG).withState("minecraft:facing_direction" as never, "up" as never));
  unregisterSlatheredLog(log);
}

/**
 * A influência de uma tora para o spawner. `giveHiddenAbility` e `makeAlpha` aplicam no PokemonData (vêm do spawner).
 */
export function honeyInfluence(state: HoneyInfluenceState, hooks: {
  hasHiddenAbility(pokemon: PokemonData): boolean;
  giveHiddenAbility(pokemon: PokemonData): void;
  makeAlpha(pokemon: PokemonData): void;
}): SpawnInfluence {
  const applied = new WeakSet<PokemonData>();
  return {
    affectPokemon(_action: SpawnAction, pokemon: PokemonData) {
      const config = getConfig();
      const roll = rollHoneyBonuses(pokemon, hooks.hasHiddenAbility(pokemon), config);
      if (roll.skip) return;
      if (roll.hiddenAbility) hooks.giveHiddenAbility(pokemon);
      if (roll.shiny) {
        pokemon.shiny = true;
        if (!pokemon.aspects.includes("shiny")) pokemon.aspects.push("shiny");
      }
      if (roll.alpha) hooks.makeAlpha(pokemon);
      if (!state.activated) {
        state.activated = true;
        pokemon.aspects.push(HONEY_DRENCHED_ASPECT);
        applied.add(pokemon);
      }
    },
    affectEntity(_action: SpawnAction, entity: Entity) {
      if (!state.activated) return;
      // Só a entidade do Pokémon que ativou a tora sai da frente dela.
      const marker = `honey_log_${keyOf(state.log)}`;
      if (entity.hasTag(marker)) return;
      try {
        const data = entity.getDynamicProperty("data");
        if (typeof data !== "string" || !data.includes(HONEY_DRENCHED_ASPECT)) return;
      }
      catch { return; }
      entity.addTag(marker);
      system.run(() => { if (entity.isValid) consumeLog(state, entity); });
    },
  };
}

/**
 * SaccharineLogSlatheredDetector.detectFromInput + SpatialSpawningZoneInfluence: liga a influência às posições da zona
 * a até 32 blocos de cada tora (conferida no mundo; tora que sumiu sai do registro).
 */
export function attachHoneyInfluences(dimension: Dimension, positions: SpawnContext[], center: Vector3, zoneLength: number, zoneWidth: number, hooks: Parameters<typeof honeyInfluence>[1]) {
  load();
  if (registry.size === 0 || positions.length === 0) return;
  const search = DETECTOR_RANGE + Math.ceil(Math.sqrt(zoneLength * zoneLength + zoneWidth * zoneWidth));
  for (const log of [...registry.values()]) {
    if (log.dimension !== dimension.id) continue;
    if (Math.abs(log.x - center.x) > search || Math.abs(log.y - center.y) > search || Math.abs(log.z - center.z) > search) continue;
    let type: string | undefined;
    try { type = dimension.getBlock(log)?.typeId; }
    catch { type = undefined; }
    if (type === undefined) continue; // chunk descarregado
    if (type !== SLATHERED_LOG) { unregisterSlatheredLog(log); continue; }
    const influence = honeyInfluence({ log, activated: false }, hooks);
    for (const ctx of positions) {
      const dx = ctx.location.x - (log.x + 0.5), dy = ctx.location.y - (log.y + 0.5), dz = ctx.location.z - (log.z + 0.5);
      if (dx * dx + dy * dy + dz * dz <= DETECTOR_RANGE * DETECTOR_RANGE) ctx.influences = [...(ctx.influences ?? []), influence];
    }
  }
}

let watching = false;

/** Registra toras com mel quando o jogador passa mel ou coloca a tora (worldLoad). */
export function watchSlatheredLogs() {
  if (watching) return;
  watching = true;
  world.afterEvents.playerInteractWithBlock.subscribe(({ block }) => {
    const dimension = block.dimension.id;
    const pos = { x: block.x, y: block.y, z: block.z };
    // O componente da tora troca o bloco no mesmo evento; confere no próximo tick.
    system.run(() => {
      try {
        if (world.getDimension(dimension).getBlock(pos)?.typeId === SLATHERED_LOG) registerSlatheredLog(dimension, pos);
      }
      catch { /* chunk descarregado */ }
    });
  });
  world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.typeId === SLATHERED_LOG) registerSlatheredLog(block.dimension.id, block);
  });
}
