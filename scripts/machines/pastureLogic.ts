/**
 * Regras do pasto (PokemonPastureBlockEntity / PasturePokemonHandler do Cobblemon 1.8.2) sem API do Minecraft:
 * registro persistido, capacidade, limite por jogador, área de passeio e (de)serialização.
 */
import type { Vector3 } from "@minecraft/server";

export interface Tether {
  tetheringId: string;
  playerId: string;
  playerName: string;
  pokemonId: string;
  species: string;
  level: number;
  /** Apelido (para a lista sem precisar do PC do dono). */
  name?: string;
  shiny?: boolean;
  /** Variante do modelo (PokemonData.variant) para o retrato certo na lista do pasto. */
  variant?: number;
  /** Última posição conhecida no PC (evita varrer todas as caixas a cada checagem). */
  box?: number;
  /** PokemonBehaviourFlag.PASTURE_CONFLICT: ataca mobs hostis por perto (botão na tela do pasto). */
  conflict?: boolean;
  space?: number;
}

export interface PastureRecord {
  dimension: string;
  pos: [number, number, number];
  ownerId?: string;
  ownerName?: string;
  tethers: Tether[];
}

export interface PastureLimits {
  /** defaultPasturedPokemonLimit (getMaxTethered). */
  maxTethered: number;
  /** PasturePermissions.maxPokemon (padrão = maxTethered). */
  maxPerPlayer: number;
}

export type AddResult = "ok" | "full" | "player_full" | "fainted" | "already";

/** canAddPokemon (sem o limite de Pokémon por perto, que precisa do mundo). */
export function canAddPokemon(record: PastureRecord, playerId: string, pokemon: { uuid: string; currentHealth: number }, limits: PastureLimits): AddResult {
  if (record.tethers.some(t => t.pokemonId === pokemon.uuid)) return "already";
  if (pokemon.currentHealth <= 0) return "fainted";
  if (record.tethers.length >= limits.maxTethered) return "full";
  if (record.tethers.filter(t => t.playerId === playerId).length >= limits.maxPerPlayer) return "player_full";
  return "ok";
}

/** Limite de Pokémon por perto: pastureMaxPerChunk × (raio/16×2)². */
export function nearbyPokemonCap(maxPerChunk: number, radius: number): number {
  const chunkDiameter = (radius / 16) * 2;
  return maxPerChunk * chunkDiameter * chunkDiameter;
}

export function addTether(record: PastureRecord, tether: Tether) {
  record.tethers.push(tether);
}

/** releasePokemon. */
export function removeTether(record: PastureRecord, pokemonId: string): Tether | undefined {
  const i = record.tethers.findIndex(t => t.pokemonId === pokemonId);
  if (i < 0) return undefined;
  return record.tethers.splice(i, 1)[0];
}

/** releaseAllPokemon(playerId). */
export function removeAllTethers(record: PastureRecord, playerId: string): Tether[] {
  const removed = record.tethers.filter(t => t.playerId === playerId);
  record.tethers = record.tethers.filter(t => t.playerId !== playerId);
  return removed;
}

/** Caixa de passeio (minRoamPos..maxRoamPos = posição ± raio). */
export function roamBox(pos: readonly [number, number, number], radius: number) {
  return {
    min: { x: pos[0] - radius, y: pos[1] - radius, z: pos[2] - radius },
    max: { x: pos[0] + radius, y: pos[1] + radius, z: pos[2] + radius },
  };
}

/** Tethering.canRoamTo / checkPastureTether: dentro da caixa? */
export function insideRoam(pos: readonly [number, number, number], radius: number, loc: Vector3): boolean {
  const { min, max } = roamBox(pos, radius);
  return loc.x >= min.x && loc.x <= max.x + 1 && loc.y >= min.y && loc.y <= max.y + 1 && loc.z >= min.z && loc.z <= max.z + 1;
}

export function serializePasture(record: PastureRecord): string {
  return JSON.stringify(record);
}

/** Lê um registro salvo, descartando entradas inválidas (dados antigos/corrompidos). */
export function parsePasture(json: string): PastureRecord | undefined {
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch { return undefined; }
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<PastureRecord>;
  if (typeof r.dimension !== "string" || !Array.isArray(r.pos) || r.pos.length !== 3) return undefined;
  const tethers = (Array.isArray(r.tethers) ? r.tethers : []).filter((t): t is Tether =>
    !!t && typeof t.tetheringId === "string" && typeof t.pokemonId === "string" && typeof t.playerId === "string");
  return { dimension: r.dimension, pos: r.pos as [number, number, number], ownerId: r.ownerId, ownerName: r.ownerName, tethers };
}

/** Todos os Pokémon no pasto de todos os registros (para "já está num pasto?"). */
export function findTether(records: Iterable<PastureRecord>, pokemonId: string): { record: PastureRecord; tether: Tether } | undefined {
  for (const record of records) {
    const tether = record.tethers.find(t => t.pokemonId === pokemonId);
    if (tether) return { record, tether };
  }
  return undefined;
}

/**
 * Dano do ataque a mobs hostis no pasto (aproximação do AttackHostileMobsTask/MeleeAttack do Cobblemon, que usa o
 * atributo de ataque da entidade): 2 + nível/10, arredondado.
 */
export function pastureAttackDamage(level: number): number {
  return Math.round(2 + Math.max(1, level) / 10);
}
