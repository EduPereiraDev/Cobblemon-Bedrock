/**
 * Efeitos que dependem do jogador perto do Pokémon (no Cobblemon são do cliente; no Bedrock o servidor decide):
 *
 * 1. Brilho de shiny selvagem (PokemonClientDelegate.playWildShinySounds, config `shinyNoticeParticlesDistance`,
 *    padrão 24): shiny selvagem (sem dono, fora de batalha) a até N blocos → uma vez por aproximação o anel
 *    `cobblemon:wild_shiny_ring` + `particle.wild_shiny_chime` para aquele jogador; a cada 3,5 s o brilho
 *    `cobblemon:shiny_sparkle_ambient_wild` + `particle.wild_shiny_ambient_chime`. Olhar para qualquer shiny
 *    (CobblemonClient: `isLookingAt`) solta `cobblemon:ambient_shiny_sparkle` + `particle.shiny_ambient_chime`.
 * 2. Rótulos (PokemonRenderer): `displayNameForUnknownPokemon` desligado (padrão) mostra "???" no lugar do nome das
 *    espécies que o jogador nunca registrou na Pokédex; `displayEntityLabelsWhenCrouchingOnly` só mostra o rótulo com o
 *    jogador agachado. O `nameTag` do Bedrock é um só para todos: o port usa o jogador mais perto de cada Pokémon.
 *
 * Um passe a cada 10 ticks, um jogador por tick (system.runJob).
 */
import { Entity, GameMode, Player, system, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { PokemonData, SHINY_TAG } from "../Pokemon";
import { hasSeen } from "../pokedex/PokedexStorage";

export const SHINY_PARTICLES = {
  wildRing: "cobblemon:wild_shiny_ring",
  wildAmbient: "cobblemon:shiny_sparkle_ambient_wild",
  ownedAmbient: "cobblemon:ambient_shiny_sparkle",
};
/** Sons que no Cobblemon vêm dos eventos das partículas Snowstorm (tocados aqui pelo script). */
export const SHINY_SOUNDS = {
  wildRing: "cobblemon.particle.wild_shiny_chime",
  wildAmbient: "cobblemon.particle.wild_shiny_ambient_chime",
  ownedAmbient: "cobblemon.particle.shiny_ambient_chime",
};
/** PokemonClientDelegate.SHINY_PARTICLE_COOLDOWN (s). */
export const SHINY_PARTICLE_COOLDOWN_MS = 3500;
const PASS_TICKS = 10;
/** Distância dos rótulos tratados (o Bedrock mostra nameTag de perto). */
const LABEL_RANGE = 32;
const LOOK_RANGE = 16;

/** Estado do brilho para um par jogador × Pokémon. */
export interface ShinyNoticeState {
  shined: boolean;
  lastAmbient: number;
}

export interface ShinyNoticeAction {
  ring: boolean;
  ambient: boolean;
}

/**
 * playWildShinySounds para um Pokémon: `inRange` (distância ≤ config), `battling`, `now` em ms.
 * Muda o estado e diz o que tocar.
 */
export function shinyNoticeStep(state: ShinyNoticeState, inRange: boolean, battling: boolean, now: number): ShinyNoticeAction {
  const action = { ring: false, ambient: false };
  if (!inRange) {
    state.shined = false;
    return action;
  }
  if (now - state.lastAmbient > SHINY_PARTICLE_COOLDOWN_MS && !battling) {
    action.ambient = true;
    state.lastAmbient = now;
  }
  if (!state.shined) {
    action.ring = true;
    state.shined = true;
  }
  return action;
}

/** Qual rótulo o Pokémon deve ter para o jogador mais perto: nome escondido e/ou nenhum rótulo. */
export function labelMode(known: boolean, sneaking: boolean, config: { displayNameForUnknownPokemon: boolean; displayEntityLabelsWhenCrouchingOnly: boolean }): "none" | "hidden" | "shown" {
  if (config.displayEntityLabelsWhenCrouchingOnly && !sneaking) return "none";
  if (!config.displayNameForUnknownPokemon && !known) return "hidden";
  return "shown";
}

/** jogador → (entidade → estado do brilho). */
const shinyStates = new Map<string, Map<string, ShinyNoticeState>>();
const lookCooldown = new Map<string, number>();

function speciesOf(entity: Entity): string {
  return entity.typeId.replace(/^cobblemon:/, "");
}

function isWild(entity: Entity): boolean {
  try { return entity.getProperty("cobblemon:wild") === true && entity.getDynamicProperty("owner_name") === undefined; }
  catch { return false; }
}

function isBattling(entity: Entity): boolean {
  try { return entity.getProperty("cobblemon:in_battle") === true; }
  catch { return false; }
}

function particleAt(entity: Entity) {
  return { x: entity.location.x, y: entity.location.y + 0.6, z: entity.location.z };
}

function playFor(player: Player, entity: Entity, particle: string, sound: string) {
  const at = particleAt(entity);
  try { player.spawnParticle(particle, at); } catch { /* partícula ausente no RP */ }
  try { player.playSound(sound, { location: at }); } catch { /* som ausente */ }
}

function shinyPass(player: Player, now: number) {
  const distance = getConfig().shinyNoticeParticlesDistance;
  const states = shinyStates.get(player.id) ?? new Map<string, ShinyNoticeState>();
  shinyStates.set(player.id, states);
  const nearby = distance > 0
    ? player.dimension.getEntities({ tags: [SHINY_TAG], families: ["pokemon"], location: player.location, maxDistance: distance })
    : [];
  const inRange = new Set<string>();
  for (const entity of nearby) {
    if (!isWild(entity)) continue;
    inRange.add(entity.id);
    const state = states.get(entity.id) ?? { shined: false, lastAmbient: 0 };
    states.set(entity.id, state);
    const action = shinyNoticeStep(state, true, isBattling(entity), now);
    if (action.ring && player.getGameMode() !== GameMode.Spectator) playFor(player, entity, SHINY_PARTICLES.wildRing, SHINY_SOUNDS.wildRing);
    if (action.ambient) playFor(player, entity, SHINY_PARTICLES.wildAmbient, SHINY_SOUNDS.wildAmbient);
  }
  // Saiu do alcance: pode brilhar de novo ao voltar.
  for (const id of [...states.keys()]) if (!inRange.has(id)) states.delete(id);

  // Olhando para um shiny qualquer (inclusive com dono).
  try {
    const hit = player.getEntitiesFromViewDirection({ maxDistance: LOOK_RANGE, families: ["pokemon"] })[0]?.entity;
    if (hit?.hasTag(SHINY_TAG) && now - (lookCooldown.get(hit.id) ?? 0) > SHINY_PARTICLE_COOLDOWN_MS) {
      lookCooldown.set(hit.id, now);
      playFor(player, hit, SHINY_PARTICLES.ownedAmbient, SHINY_SOUNDS.ownedAmbient);
    }
  }
  catch { /* sem raycast */ }
}

/** O rótulo atual da entidade já corresponde ao modo? (applyToCobblemon põe o rótulo "shown" a cada atualização). */
export function labelMatches(nameTag: string, mode: "none" | "hidden" | "shown"): boolean {
  if (mode === "none") return nameTag === "";
  if (mode === "hidden") return nameTag.startsWith("???");
  return nameTag !== "" && !nameTag.startsWith("???");
}

/** Rótulos dos Pokémon perto de cada jogador, decidido pelo jogador mais perto. */
function labelPass(players: Player[]) {
  const config = getConfig();
  // Sem nada a esconder, o rótulo de applyToCobblemon já é o certo.
  if (config.displayNameForUnknownPokemon && !config.displayEntityLabelsWhenCrouchingOnly) return;
  const nearest = new Map<string, { entity: Entity; player: Player; dist: number }>();
  for (const player of players) {
    let entities: Entity[];
    try { entities = player.dimension.getEntities({ families: ["pokemon"], location: player.location, maxDistance: LABEL_RANGE }); }
    catch { continue; }
    for (const entity of entities) {
      const dx = entity.location.x - player.location.x, dy = entity.location.y - player.location.y, dz = entity.location.z - player.location.z;
      const dist = dx * dx + dy * dy + dz * dz;
      const current = nearest.get(entity.id);
      if (!current || dist < current.dist) nearest.set(entity.id, { entity, player, dist });
    }
  }
  for (const { entity, player } of nearest.values()) {
    let known = true;
    try { known = hasSeen(player, speciesOf(entity)); } catch { }
    let mode = labelMode(known, player.isSneaking, config);
    // Sem o nome no rótulo, esconder o nome não muda nada.
    if (mode === "hidden" && config.displayEntityNameLabel === false) mode = "shown";
    let nameTag = "";
    try { nameTag = entity.nameTag; } catch { continue; }
    if (labelMatches(nameTag, mode)) continue;
    if (mode === "shown" && !config.displayEntityNameLabel && !config.displayEntityLevelLabel) continue;
    const data = PokemonData.tryGetFromEntity(entity);
    if (!data) continue;
    try { entity.nameTag = mode === "none" ? "" : data.getEntityLabel(mode === "hidden"); }
    catch { /* entidade saindo */ }
  }
}

let started = false;

/** Liga os efeitos de proximidade (worldLoad). */
export function startProximityEffects() {
  if (started) return;
  started = true;
  world.afterEvents.playerLeave.subscribe(({ playerId }) => shinyStates.delete(playerId));
  world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => { lookCooldown.delete(removedEntityId); });
  let passes = 0;
  system.runInterval(() => {
    const players = world.getAllPlayers();
    const now = Date.now();
    const labels = ++passes % 2 === 0;
    system.runJob((function* () {
      for (const player of players) {
        if (!player.isValid) continue;
        try { shinyPass(player, now); }
        catch (e) { console.warn(`Brilho de shiny: ${e}`); }
        yield;
      }
      if (labels) {
        try { labelPass(players.filter(p => p.isValid)); }
        catch (e) { console.warn(`Rótulos: ${e}`); }
      }
    })());
  }, PASS_TICKS);
}
