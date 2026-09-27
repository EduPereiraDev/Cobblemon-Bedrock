import { Block, Dimension, Entity, Vector3 } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import type { ActivePokemon } from "./ActivePokemon";

/**
 * Balsa para Pokémon em batalha na água (PlatformType.kt + PokemonEntity.tick/getAdjustedSendoutPosition).
 *
 * Regra do Cobblemon: Pokémon com dono, em batalha, tocando a água sem estar submerso, que não respira debaixo
 * d'água, não anda sobre a água e não voa, ganha uma plataforma do tamanho do hitbox (largura × baseScale:
 * ≤0,511 XS, <1,01 S, <1,8 M, <2,875 L, senão XL) e fica 0,25 bloco acima da superfície; a plataforma some quando
 * ele volta a pisar em chão firme (ou sai de campo). O cliente desenha `water_platform_<tamanho>.geo`.
 *
 * No Bedrock a plataforma é a entidade `cobblemon:battle_platform` (colidível, sem gravidade, geometria e textura
 * do Cobblemon por tamanho) na superfície da água, com o Pokémon posto em cima dela.
 */

export const PLATFORM_ENTITY = "cobblemon:battle_platform";
export const PLATFORM_OF_PROPERTY = "cobblemon:platform_of";
/** Altura do convés (a translação de 0,25 do PokemonRenderer). */
export const PLATFORM_DECK = 0.25;
/** Altura visível da água num bloco de fonte (8/9). */
const WATER_SURFACE = 0.889;

export enum PlatformType { NONE = -1, WATER_XS = 0, WATER_S = 1, WATER_M = 2, WATER_L = 3, WATER_XL = 4 }

/** PlatformType.getPlatformTypeForPokemon: pela largura do hitbox × baseScale da forma. */
export function platformTypeForWidth(width: number): PlatformType {
  if (width <= 0.511) return PlatformType.WATER_XS;
  if (width < 1.01) return PlatformType.WATER_S;
  if (width < 1.8) return PlatformType.WATER_M;
  if (width < 2.875) return PlatformType.WATER_L;
  return PlatformType.WATER_XL;
}

interface MovingBehaviour {
  fly?: { canFly?: boolean };
  swim?: { canBreatheUnderwater?: boolean; canWalkOnWater?: boolean };
}

/** Comportamento de movimento da forma ativa (a forma sobrescreve a espécie, como FormData.behaviour). */
function movingOf(data: PokemonData): MovingBehaviour {
  let species: { behaviour?: { moving?: MovingBehaviour }; hitbox?: { width?: number }; baseScale?: number } | undefined;
  let form: { behaviour?: { moving?: MovingBehaviour } } | undefined;
  try { species = data.getSpeciesData() as never; } catch { }
  try { form = data.getFormData() as never; } catch { }
  const base = species?.behaviour?.moving ?? {};
  const over = form?.behaviour?.moving ?? {};
  return { fly: { ...base.fly, ...over.fly }, swim: { ...base.swim, ...over.swim } };
}

/** Largura efetiva do hitbox (form.hitbox.width * form.baseScale). */
export function hitboxWidth(data: PokemonData): number {
  let species: { hitbox?: { width?: number }; baseScale?: number } | undefined;
  let form: { hitbox?: { width?: number }; baseScale?: number } | undefined;
  try { species = data.getSpeciesData() as never; } catch { }
  try { form = data.getFormData() as never; } catch { }
  const width = form?.hitbox?.width ?? species?.hitbox?.width ?? 1;
  const scale = form?.baseScale ?? species?.baseScale ?? 1;
  return width * scale;
}

/** A espécie precisa de balsa na água (não respira debaixo d'água, não anda na água, não voa). */
export function needsPlatform(data: PokemonData): boolean {
  const moving = movingOf(data);
  return !moving.swim?.canBreatheUnderwater && !moving.swim?.canWalkOnWater && !moving.fly?.canFly;
}

function isWater(block: Block | undefined): boolean {
  try {
    if (!block) return false;
    return block.typeId === "minecraft:water" || block.typeId === "minecraft:flowing_water" || (block.isLiquid && block.typeId.includes("water"));
  }
  catch {
    return false;
  }
}

/**
 * Superfície da água na coluna da entidade (y da face de cima da água), ou undefined se ela não está na água ou
 * está submersa além de 1 bloco (isInWater && !isUnderWater).
 */
export function waterSurfaceAt(dimension: Dimension, location: Vector3): number | undefined {
  let y = Math.floor(location.y);
  let block: Block | undefined;
  try { block = dimension.getBlock({ x: Math.floor(location.x), y, z: Math.floor(location.z) }); } catch { return undefined; }
  // Os pés podem estar logo acima da água (flutuando).
  if (!isWater(block)) {
    try { block = dimension.getBlock({ x: Math.floor(location.x), y: y - 1, z: Math.floor(location.z) }); } catch { return undefined; }
    if (!isWater(block)) return undefined;
    y -= 1;
  }
  // Sobe até o último bloco de água (no máximo 2 blocos acima dos pés: mais que isso = submerso).
  for (let i = 0; i < 2; i++) {
    let above: Block | undefined;
    try { above = dimension.getBlock({ x: Math.floor(location.x), y: y + 1, z: Math.floor(location.z) }); } catch { return undefined; }
    if (!isWater(above)) return y + WATER_SURFACE;
    y += 1;
  }
  return undefined;
}

function valid(entity: Entity | undefined): entity is Entity {
  try { return !!entity?.isValid; } catch { return false; }
}

const platforms = new Map<string, Entity>();

/** Plataforma do Pokémon (por UUID dos dados), se existir. */
export function getPlatform(uuid: string): Entity | undefined {
  const entity = platforms.get(uuid);
  if (valid(entity)) return entity;
  platforms.delete(uuid);
  return undefined;
}

/** A entidade é uma balsa em uso nesta sessão do script (registrada em memória por uma batalha ativa). */
export function isTrackedPlatform(entity: Entity): boolean {
  let id: string;
  try { id = entity.id; } catch { return false; }
  for (const platform of platforms.values()) {
    try { if (platform.id === id) return true; } catch { }
  }
  return false;
}

/**
 * Remove as balsas que não pertencem a nenhuma batalha desta sessão (sobras gravadas no disco por uma queda do
 * servidor ou chunk descarregado). Devolve quantas removeu.
 */
export function removeStalePlatforms(dimensions: readonly Dimension[]): number {
  let removed = 0;
  for (const dimension of dimensions) {
    let found: Entity[] = [];
    try { found = dimension.getEntities({ type: PLATFORM_ENTITY }); } catch { continue; }
    for (const entity of found) {
      if (isTrackedPlatform(entity)) continue;
      try { entity.remove(); removed++; } catch { }
    }
  }
  return removed;
}

/** Tira a plataforma do Pokémon (saiu de campo, desmaiou, pisou em terra firme, fim da batalha). */
export function removePlatform(uuid: string) {
  const entity = platforms.get(uuid);
  platforms.delete(uuid);
  if (!valid(entity)) return;
  try { entity.remove(); } catch { try { entity.triggerEvent("cobblemon:instant_kill"); } catch { } }
}

function spawnPlatform(pokemonEntity: Entity, data: PokemonData, surface: number): Entity | undefined {
  const type = platformTypeForWidth(hitboxWidth(data));
  const at = { x: pokemonEntity.location.x, y: surface, z: pokemonEntity.location.z };
  let platform: Entity;
  try {
    platform = pokemonEntity.dimension.spawnEntity(PLATFORM_ENTITY, at, { initialPersistence: false, initialRotation: pokemonEntity.getRotation().y });
  }
  catch (e) {
    console.warn(`Balsa: não foi possível criar a plataforma: ${e}`);
    return undefined;
  }
  try { platform.triggerEvent(`cobblemon:size_${type}`); } catch { }
  try { platform.setDynamicProperty(PLATFORM_OF_PROPERTY, data.uuid); } catch { }
  return platform;
}

/**
 * Checagem por Pokémon em campo (PokemonEntity.tick com isBattling): cria, segue ou tira a balsa.
 * `owned` = o Pokémon tem dono (o Cobblemon exige ownerUUID; selvagem nunca ganha balsa).
 */
export function updatePlatform(active: ActivePokemon, owned: boolean) {
  const entity = active.entity;
  const uuid = active.data.uuid;
  if (!valid(entity) || !owned) {
    removePlatform(uuid);
    return;
  }
  const current = getPlatform(uuid);
  const surface = waterSurfaceAt(entity.dimension, current ? { ...entity.location, y: current.location.y + 0.1 } : entity.location);
  if (!current) {
    // exposedForm: com Illusion/Transform vale a forma que aparece.
    const exposed = active.mock?.data ?? active.data;
    if (surface === undefined || !needsPlatform(exposed)) return;
    const platform = spawnPlatform(entity, exposed, surface);
    if (!platform) return;
    platforms.set(uuid, platform);
    standOn(active, surface);
    return;
  }
  // Voltou para terra firme (ou a água sumiu): a balsa sai (platform != NONE && onGround()).
  if (surface === undefined) {
    removePlatform(uuid);
    return;
  }
  // Segue o Pokémon na horizontal e mantém o convés na superfície.
  const p = current.location;
  const e = entity.location;
  if (Math.abs(p.x - e.x) + Math.abs(p.z - e.z) > 0.15 || Math.abs(p.y - surface) > 0.05) {
    try { current.teleport({ x: e.x, y: surface, z: e.z }); } catch { }
  }
  if (e.y < surface + PLATFORM_DECK - 0.2) standOn(active, surface);
}

/** Põe o Pokémon (e a entidade de exibição) em cima do convés. */
function standOn(active: ActivePokemon, surface: number) {
  const y = surface + PLATFORM_DECK;
  for (const entity of [active.entity, active.mock?.entity]) {
    if (!valid(entity)) continue;
    try { entity.teleport({ x: entity.location.x, y, z: entity.location.z }, { rotation: entity.getRotation() }); } catch { }
  }
}

/** Remove as balsas de uma lista de Pokémon (fim da batalha). */
export function removePlatforms(uuids: Iterable<string>) {
  for (const uuid of uuids) removePlatform(uuid);
}
