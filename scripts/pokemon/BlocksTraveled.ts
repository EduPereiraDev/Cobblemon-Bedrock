/**
 * Passos dos Pokémon fora da bola (Cobblemon 1.8.2: `PokemonEntity.updateBlocksTraveled`, feature global
 * `blocks_traveled`, requisito de evolução `blocks_traveled` de Pawmo → Pawmot, Bramblin → Brambleghast e
 * Rellor → Rabsca).
 *
 * Como no Cobblemon, só conta para Pokémon que têm uma evolução com esse requisito (`hasBlocksTraveledRequirement`),
 * a cada tick, somando `distSqr` entre a posição de bloco atual e a do tick anterior; montado em algo ou caindo não
 * conta. O valor fica em `PokemonData.features.blocks_traveled` (máx. 1000) e é gravado a cada segundo.
 *
 * Custo: a lista de entidades acompanhadas é refeita a cada 20 ticks só a partir dos times (poucos Pokémon têm o
 * requisito); por tick só lê a posição dessas entidades.
 */
import { Entity, Player, system, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { getSafeTeam } from "../pokemonStorage";
import { addBlocksTraveled } from "./SpeciesFeatures";

/** A espécie/forma tem evolução com `blocks_traveled` (Pokemon.hasBlocksTraveledRequirement). */
export function hasBlocksTraveledRequirement(pokemon: PokemonData): boolean {
  try {
    return pokemon.getEvolutionEntries().some(entry => (entry.requirements ?? []).some(r => r.variant === "blocks_traveled"));
  }
  catch { return false; }
}

/** `blockPosition().distSqr(prev)`: distância² entre posições de bloco (inteiras). */
export function blockDistSqr(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = Math.floor(a.x) - Math.floor(b.x);
  const dy = Math.floor(a.y) - Math.floor(b.y);
  const dz = Math.floor(a.z) - Math.floor(b.z);
  return dx * dx + dy * dy + dz * dz;
}

interface Tracked {
  entity: Entity;
  uuid: string;
  ownerId: string;
  last?: { x: number; y: number; z: number; dimension: string };
  pending: number;
}

const tracked = new Map<string, Tracked>();

function isPassengerOrFalling(entity: Entity): boolean {
  try {
    if (entity.getComponent("minecraft:riding")?.entityRidingOn) return true;
  }
  catch { /* sem componente */ }
  try { return entity.isFalling; }
  catch { return false; }
}

/** Um tick de uma entidade acompanhada (exportado para teste). */
export function trackStep(entry: Tracked, location: { x: number; y: number; z: number }, dimension: string, skip: boolean) {
  const last = entry.last;
  entry.last = { x: location.x, y: location.y, z: location.z, dimension };
  if (!last || last.dimension !== dimension || skip) return;
  const moved = blockDistSqr(location, last);
  // Teleporte (recolher e soltar longe) não é passo.
  if (moved > 0 && moved <= 64) entry.pending += moved;
}

function refresh() {
  const seen = new Set<string>();
  for (const player of world.getAllPlayers()) {
    let team: (PokemonData | null)[];
    try { team = getSafeTeam(player); }
    catch { continue; }
    for (const pokemon of team) {
      if (!pokemon || !hasBlocksTraveledRequirement(pokemon)) continue;
      let entity: Entity | undefined;
      try { entity = pokemon.tryGetPokemonOut(); }
      catch { entity = undefined; }
      if (!entity?.isValid) continue;
      seen.add(pokemon.uuid);
      const current = tracked.get(pokemon.uuid);
      if (current && current.entity === entity) continue;
      tracked.set(pokemon.uuid, { entity, uuid: pokemon.uuid, ownerId: player.id, pending: current?.pending ?? 0 });
    }
  }
  for (const [uuid, entry] of tracked) if (!seen.has(uuid)) { flush(entry); tracked.delete(uuid); }
}

/** Grava os passos acumulados na entidade e no time. */
function flush(entry: Tracked) {
  if (entry.pending <= 0) return;
  const blocks = entry.pending;
  entry.pending = 0;
  const owner = world.getEntity(entry.ownerId) as Player | undefined;
  if (!owner?.isValid) return;
  const team = getSafeTeam(owner);
  const index = team.findIndex(p => p?.uuid === entry.uuid);
  if (index < 0) return;
  const stored = team[index]!;
  if (!addBlocksTraveled(stored, blocks)) return;
  owner.setDynamicProperty("team", JSON.stringify(team));
  if (entry.entity.isValid) {
    const live = PokemonData.tryGetFromEntity(entry.entity);
    if (live && addBlocksTraveled(live, blocks)) entry.entity.setDynamicProperty("data", JSON.stringify(live));
  }
}

let started = false;

/** Liga o contador (worldLoad). */
export function startBlocksTraveled() {
  if (started) return;
  started = true;
  let ticks = 0;
  system.runInterval(() => {
    if (++ticks % 20 === 0) {
      try { refresh(); }
      catch (e) { console.warn(`Passos: ${e}`); }
      for (const entry of tracked.values()) {
        try { flush(entry); }
        catch (e) { console.warn(`Passos (gravar): ${e}`); }
      }
    }
    for (const [uuid, entry] of tracked) {
      if (!entry.entity.isValid) { tracked.delete(uuid); continue; }
      try { trackStep(entry, entry.entity.location, entry.entity.dimension.id, isPassengerOrFalling(entry.entity)); }
      catch { tracked.delete(uuid); }
    }
  }, 1);
}
