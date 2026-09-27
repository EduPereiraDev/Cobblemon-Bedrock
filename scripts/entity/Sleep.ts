/**
 * Sono dos Pokémon (Cobblemon 1.8.2: DrowsySensor, GoToSleepTask, WakeUpTask, SleepIfOnTrainerBed).
 *
 * - Selvagem com `behaviour.resting.canSleep`: uma vez por segundo, fica sonolento com `drowsyChance`
 *   dentro de `times` (sem ter apanhado nem estar bravo), perde a sonolência com `rouseChance` ou fora do
 *   horário; sonolento e num lugar válido (canSleepAt) dorme e ganha o status Sono; acorda sem sonolência.
 * - Com dono (no time): só dorme com o status Sono (não acorda sozinho), ou, se `willSleepOnBed`, quando o
 *   dono está dormindo na cama perto dele (a entidade anda até a cama com behavior.pet_sleep_with_owner).
 * - `depth` (normal/comatose) existe no 1.8.2 mas não é usado pelo mod; aqui também não.
 */
import { Entity, Player, world } from "@minecraft/server";
import { PokemonData, StatusEffect } from "../Pokemon";
import type { SpeciesData, FormData } from "../speciesData";

// ---------------------------------------------------------------------------------------------
// Lógica pura

/** TimeRange.timeRanges do Cobblemon (inclusivos). */
export const TIME_RANGES: Record<string, Array<[number, number]>> = {
  any: [[0, 23999]],
  day: [[23460, 23999], [0, 12541]],
  night: [[12542, 23459]],
  morning: [[23000, 23999], [0, 4999]],
  noon: [[5000, 6999]],
  afternoon: [[7000, 12999]],
  evening: [[13000, 16999]],
  midnight: [[17000, 18999]],
  predawn: [[19000, 22999]],
  dawn: [[22300, 23999], [0, 166]],
  dusk: [[11834, 13701]],
  twilight: [[11834, 13701], [22300, 23999], [0, 166]],
};

/** IntRangesAdapter: nomes ("night"), faixas ("167-11833") ou números, separados por vírgula; aceita lista. */
export function parseTimeRanges(value: unknown, fallback: Array<[number, number]> = TIME_RANGES.night): Array<[number, number]> {
  if (value === undefined || value === null) return fallback;
  const parts = (Array.isArray(value) ? value : [value]).flatMap(v => String(v).split(","));
  const out: Array<[number, number]> = [];
  for (const raw of parts) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    if (TIME_RANGES[part]) out.push(...TIME_RANGES[part]);
    else {
      const r = parseIntRange(part);
      if (r) out.push(r);
    }
  }
  return out.length ? out : fallback;
}

/** "0-4" → [0, 4]; "7" → [7, 7]; "-1" → [-1, -1]. */
export function parseIntRange(value: unknown): [number, number] | undefined {
  if (typeof value === "number") return [value, value];
  const s = String(value ?? "").trim();
  const m = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  if (/^-?\d+$/.test(s)) return [Number(s), Number(s)];
  return undefined;
}

export function inRanges(ranges: ReadonlyArray<readonly [number, number]>, value: number): boolean {
  return ranges.some(([a, b]) => value >= a && value <= b);
}

/** RestBehaviour com os padrões do Cobblemon. */
export interface RestInfo {
  canSleep: boolean;
  times: Array<[number, number]>;
  light: [number, number];
  drowsyChance: number;
  rouseChance: number;
  willSleepOnBed: boolean;
  canSeeSky?: boolean;
  /** Fluidos onde pode dormir (vazio = fora de fluido). Só "#minecraft:water" existe nos dados. */
  fluids: string[];
}

export function restInfo(resting: any): RestInfo {
  const r = resting ?? {};
  return {
    canSleep: r.canSleep === true,
    times: parseTimeRanges(r.times),
    light: parseIntRange(r.light) ?? [0, 15],
    drowsyChance: typeof r.drowsyChance === "number" ? r.drowsyChance : 1 / 30,
    rouseChance: typeof r.rouseChance === "number" ? r.rouseChance : 1 / 240,
    willSleepOnBed: r.willSleepOnBed === true,
    canSeeSky: typeof r.canSeeSky === "boolean" ? r.canSeeSky : undefined,
    fluids: Array.isArray(r.fluids) ? r.fluids.map(String) : [],
  };
}

/** FormPokemonBehaviour: a forma troca o objeto `resting` inteiro; senão vale o da espécie. */
export function restOf(species: SpeciesData | undefined, form?: FormData): RestInfo {
  const formRest = (form?.behaviour as any)?.resting;
  const speciesBehaviour = species?.behaviour as any;
  return restInfo(formRest ?? speciesBehaviour?.resting ?? speciesBehaviour?.moving?.resting);
}

/** DrowsySensor.drowsyLogic fora de batalha. Retorna o novo estado de sonolência. */
export function drowsyStep(drowsy: boolean, rest: RestInfo, timeOfDay: number, disturbed: boolean, random = Math.random): boolean {
  const shouldBeDrowsy = rest.canSleep && !disturbed && inRanges(rest.times, ((timeOfDay % 24000) + 24000) % 24000);
  if (!drowsy && shouldBeDrowsy && random() < rest.drowsyChance) return true;
  if (drowsy && !shouldBeDrowsy) return false;
  if (drowsy && random() < rest.rouseChance) return false;
  return drowsy;
}

/**
 * Luz emitida pelo bloco (world.getLightEmission, que o PokemonEntity.canSleepAt testa no bloco de baixo).
 * O Bedrock não expõe a emissão por script; tabela dos blocos vanilla que brilham.
 */
const LIGHT_EMISSION: Record<string, number> = {
  "minecraft:glowstone": 15, "minecraft:sea_lantern": 15, "minecraft:shroomlight": 15, "minecraft:lit_pumpkin": 15,
  "minecraft:beacon": 15, "minecraft:lava": 15, "minecraft:flowing_lava": 15, "minecraft:lit_redstone_lamp": 15,
  "minecraft:ochre_froglight": 15, "minecraft:verdant_froglight": 15, "minecraft:pearlescent_froglight": 15,
  "minecraft:lantern": 15, "minecraft:campfire": 15, "minecraft:fire": 15, "minecraft:conduit": 15,
  "minecraft:end_rod": 14, "minecraft:torch": 14, "minecraft:wall_torch": 14, "minecraft:copper_torch": 14,
  "minecraft:end_gateway": 15, "minecraft:end_portal": 15, "minecraft:crying_obsidian": 10, "minecraft:soul_lantern": 10,
  "minecraft:soul_torch": 10, "minecraft:soul_campfire": 10, "minecraft:soul_fire": 10, "minecraft:enchanting_table": 7,
  "minecraft:ender_chest": 7, "minecraft:glow_lichen": 7, "minecraft:lit_redstone_ore": 9, "minecraft:lit_deepslate_redstone_ore": 9,
  "minecraft:redstone_torch": 7, "minecraft:sculk_catalyst": 6, "minecraft:amethyst_cluster": 5, "minecraft:magma": 3,
  "minecraft:brewing_stand": 1, "minecraft:brown_mushroom": 1, "minecraft:dragon_egg": 1, "minecraft:end_portal_frame": 1,
  "minecraft:sculk_sensor": 1, "minecraft:calibrated_sculk_sensor": 1,
};

export function blockLightEmission(typeId: string | undefined): number {
  return typeId ? LIGHT_EMISSION[typeId] ?? 0 : 0;
}

/** Contexto do lugar onde a entidade está (PokemonEntity.canSleepAt com pos = bloco de baixo). */
export interface SleepSpot {
  blockBelow?: string;
  inWater: boolean;
  onGround: boolean;
  seesSky?: boolean;
}

export function canSleepAt(rest: RestInfo, spot: SleepSpot): boolean {
  const light = blockLightEmission(spot.blockBelow);
  if (light < rest.light[0] || light > rest.light[1]) return false;
  const wantsWater = rest.fluids.some(f => f.includes("water"));
  if (spot.inWater ? !wantsWater : wantsWater) return false;
  if (rest.canSeeSky !== undefined && spot.seesSky !== undefined && rest.canSeeSky !== spot.seesSky) return false;
  return spot.onGround || spot.inWater;
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** Sonolência (memória POKEMON_DROWSY) e último dano (HURT_BY), por id de entidade. */
const drowsyState = new Map<string, boolean>();
const hurtUntil = new Map<string, number>();
/** HURT_BY dura enquanto o lastHurtByMob vale (100 ticks no vanilla). */
const HURT_MEMORY_TICKS = 100;

export function isSleeping(entity: Entity): boolean {
  try {
    return entity.getProperty("cobblemon:sleeping") === true;
  }
  catch {
    return false;
  }
}

export function putToSleep(entity: Entity, data?: PokemonData, setStatus = false) {
  if (!isSleeping(entity)) entity.triggerEvent("cobblemon:sleep");
  if (setStatus && data && data.status !== StatusEffect.Sleep) {
    data.status = StatusEffect.Sleep;
    data.applyToCobblemon(entity);
  }
}

export function wakeUp(entity: Entity, data?: PokemonData, clearStatus = false) {
  if (isSleeping(entity)) entity.triggerEvent("cobblemon:wake");
  if (clearStatus && data && data.status === StatusEffect.Sleep) {
    data.status = undefined;
    data.applyToCobblemon(entity);
  }
}

/** Selvagem apanhou: acorda e não fica sonolento por um tempo. */
export function onPokemonHurt(entity: Entity) {
  hurtUntil.set(entity.id, world.getAbsoluteTime() + HURT_MEMORY_TICKS);
  drowsyState.set(entity.id, false);
  if (isSleeping(entity) && entity.getProperty("cobblemon:wild") === true) wakeUp(entity, PokemonData.tryGetFromEntity(entity), true);
}

export function forgetSleepState(entityId: string) {
  drowsyState.delete(entityId);
  hurtUntil.delete(entityId);
}

function spotOf(entity: Entity): SleepSpot {
  const loc = entity.location;
  let blockBelow: string | undefined;
  let seesSky: boolean | undefined;
  try {
    blockBelow = entity.dimension.getBlock({ x: loc.x, y: loc.y - 0.5, z: loc.z })?.typeId;
    const top = entity.dimension.getTopmostBlock({ x: loc.x, z: loc.z });
    seesSky = !top || top.y < loc.y;
  }
  catch { }
  return { blockBelow, inWater: entity.isInWater, onGround: entity.isOnGround, seesSky };
}

/** Uma checagem por segundo (DrowsySensor roda a cada 20 ticks). */
export function tickSleep(entity: Entity, data: PokemonData, owner: Player | undefined) {
  const sleeping = isSleeping(entity);
  const rest = restOf(data.getSpeciesData(), data.getFormData());
  const hasSleepStatus = data.status === StatusEffect.Sleep;
  if (entity.getProperty("cobblemon:in_battle") === true || entity.getProperty("cobblemon:busy") === true) {
    // Em batalha o sono segue o status (DrowsySensor.isBattling).
    if (sleeping && !hasSleepStatus) wakeUp(entity);
    return;
  }
  const wild = entity.getProperty("cobblemon:wild") === true;
  if (!wild) {
    const onBed = rest.willSleepOnBed && !!owner && owner.isSleeping && owner.dimension.id === entity.dimension.id
      && distanceSq(owner.location, entity.location) <= 3 * 3;
    const shouldSleep = (rest.canSleep && hasSleepStatus) || onBed;
    if (shouldSleep && !sleeping) putToSleep(entity);
    else if (!shouldSleep && sleeping) wakeUp(entity);
    return;
  }
  if (!rest.canSleep) {
    if (sleeping) wakeUp(entity, data, true);
    return;
  }
  const now = world.getAbsoluteTime();
  const disturbed = (hurtUntil.get(entity.id) ?? 0) > now;
  const drowsy = drowsyStep(drowsyState.get(entity.id) ?? false, rest, world.getTimeOfDay(), disturbed);
  drowsyState.set(entity.id, drowsy);
  if (!drowsy && sleeping) wakeUp(entity, data, true);
  else if (drowsy && !sleeping && canSleepAt(rest, spotOf(entity))) putToSleep(entity, data, true);
}

function distanceSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}
