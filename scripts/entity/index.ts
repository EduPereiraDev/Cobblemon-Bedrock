/**
 * Comportamento das entidades de Pokémon no mundo: sono, montaria, ombro, interações por item,
 * tamanho por forma/Alfa e líder de herd. Ponto de entrada: `startEntityBehaviours()` (no worldLoad)
 * e `tryPokemonInteraction()` (no começo de handlePokemonInteract).
 */
import { ButtonState, Entity, InputButton, ItemStack, Player, system, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";
import { getAllDimensions } from "../utils";
import { onAteGrass, tryDataInteraction, tryMooshtankBowl, tryShear } from "./Interactions";
import { canRidePokemon, forgetMount, isRidingPokemon, onJumpPressed, startRiding, tickRideSprint, tickRiding, trackMountIfRidden } from "./Riding";
import { canShoulderMount, forgetShoulder, isOnShoulder, onSneakPressed, tickShoulder, toggleShoulder } from "./Shoulder";
import { applyEntitySize } from "./Size";
import { speciesIdOfType } from "./EntityData";
import { forgetSleepState, onPokemonHurt, tickSleep } from "./Sleep";
import { forgetHeldItemDisplay, syncHeldItemDisplay } from "./HeldItemDisplay"; // frente mundo-detalhes
import { forgetLightEmitter, hasLightingData, startDynamicLights, trackLightEmitter } from "./DynamicLight"; // frente mundo-detalhes
import { startSpeciesBehaviours, tickSpeciesBehaviours, forgetSpeciesBehaviours } from "./SpeciesBehaviours"; // frente mundo-detalhes
import { syncAspectBits } from "./AspectSync"; // frente dados-ia
import { registerDadosIaProbe } from "../debug/DadosIaProbe"; // frente dados-ia: sonda de console

export { canRidePokemon, startRiding, stopRiding, getMountedPokemon } from "./Riding";
export { canShoulderMount, mountShoulder, dismountShoulder, toggleShoulder, isOnShoulder } from "./Shoulder";
export { applyEntitySize } from "./Size";
export { findInteraction } from "./Interactions";
export { onHitByPokeball } from "./SpeciesBehaviours";

/** Tag lida pelo follow_mob dos membros de herd (a dynamic property vem do Spawner). */
const HERD_LEADER_TAG = "cobblemon_herd_leader";

function isPokemon(entity: Entity): boolean {
  try {
    return entity.isValid && entity.typeId.startsWith("cobblemon:") && !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon");
  }
  catch {
    return false;
  }
}

function isOwner(player: Player, entity: Entity, data?: PokemonData): boolean {
  return entity.getDynamicProperty("owner_name") === player.name || (!!data?.trainer && data.trainer === player.id);
}

/**
 * Chamado no começo de handlePokemonInteract (scripts/events/ScriptEvents.ts). true = a interação foi
 * tratada aqui e o fluxo normal (menu, item, batalha) não roda. Ordem do PokemonEntity.mobInteract:
 * tesoura (dono ou selvagem) → tigela (mooshtank) → agachar (ombro/montaria, no lugar da roda de interação)
 * → pokemon_interactions (dono, sem agachar).
 */
export function tryPokemonInteraction(player: Player, pokemon: Entity, heldItem?: ItemStack): boolean {
  try {
    if (!isPokemon(pokemon) || pokemon.getProperty("cobblemon:initialized") !== true) return false;
    // Montado nele ou no ombro: não abre menu nem batalha.
    if (isRidingPokemon(player, pokemon)) return true;
    const data = PokemonData.tryGetFromEntity(pokemon);
    if (!data) return false;
    const owner = isOwner(player, pokemon, data);
    const wild = pokemon.getProperty("cobblemon:wild") === true;
    if (!owner && !wild) {
      // Pokémon de outro jogador já montado: entra como passageiro se houver assento.
      return canRidePokemon(player, pokemon, data) && startRiding(player, pokemon);
    }
    if (owner && isOnShoulder(pokemon)) return toggleShoulder(player, pokemon);
    if (pokemon.getProperty("cobblemon:in_battle") !== true) {
      if (tryShear(player, pokemon, data, heldItem)) return true;
      if (owner && tryMooshtankBowl(player, pokemon, data, heldItem)) return true;
    }
    if (!owner) return false;
    if (player.isSneaking) {
      // Roda de interação do Cobblemon: aqui, mão vazia e Pokémon sem item (a troca de item não faria nada).
      const holdsItem = !!pokemon.getComponent("minecraft:inventory")?.container?.getItem(0);
      if (heldItem || holdsItem) return false;
      if (canShoulderMount(player, pokemon, data)) return toggleShoulder(player, pokemon);
      if (canRidePokemon(player, pokemon, data)) return startRiding(player, pokemon);
      return false;
    }
    if (pokemon.getProperty("cobblemon:in_battle") === true || pokemon.getProperty("cobblemon:busy") === true) return false;
    return tryDataInteraction(player, pokemon, data, heldItem);
  }
  catch (e) {
    console.warn(`[entidades] interação falhou: ${e}`);
    return false;
  }
}

/** JSON dos dados por entidade: reaproveita o PokemonData enquanto a string não muda. */
const dataCache = new Map<string, { json: string; data: PokemonData }>();

function cachedData(entity: Entity): PokemonData | undefined {
  const json = entity.getDynamicProperty("data");
  if (typeof json !== "string") return undefined;
  const hit = dataCache.get(entity.id);
  if (hit && hit.json === json) return hit.data;
  try {
    const data = PokemonData.getFromJson(json);
    dataCache.set(entity.id, { json, data });
    return data;
  }
  catch {
    return undefined;
  }
}

/**
 * Som ambiente (Mob.playAmbientSound com getAmbientSoundInterval = config.ambientPokemonCryTicks):
 * `cobblemon.pokemon.<espécie>.ambient`, em média um a cada intervalo (+ o sorteio de 1/1000 por tick do Mob).
 */
const nextAmbient = new Map<string, number>();
function tickAmbient(entity: Entity) {
  const interval = getConfig().ambientPokemonCryTicks;
  if (!(interval > 0) || entity.getProperty("cobblemon:busy") === true) return;
  const now = system.currentTick;
  const next = nextAmbient.get(entity.id);
  if (next === undefined) {
    nextAmbient.set(entity.id, now + Math.floor(Math.random() * interval));
    return;
  }
  if (now < next) return;
  nextAmbient.set(entity.id, now + interval + Math.floor(Math.random() * 40));
  try {
    entity.dimension.playSound(`cobblemon.pokemon.${speciesIdOfType(entity.typeId)}.ambient`, entity.location);
  }
  catch { }
}

/** Uma passada por segundo em cada Pokémon carregado (sono, tamanho, líder de herd, som ambiente, montaria externa). */
function* entityPass(): Generator<void, void, void> {
  for (const dimension of getAllDimensions()) {
    let entities: Entity[];
    try {
      entities = dimension.getEntities({ families: ["pokemon"] });
    }
    catch {
      continue;
    }
    for (const entity of entities) {
      if (!entity.isValid || entity.getProperty("cobblemon:initialized") !== true) continue;
      try {
        if (entity.getDynamicProperty("cobblemon:herd_leader") === true && !entity.hasTag(HERD_LEADER_TAG)) entity.addTag(HERD_LEADER_TAG);
        const data = cachedData(entity);
        if (!data) continue;
        applyEntitySize(entity, data);
        tickAmbient(entity);
        trackMountIfRidden(entity, data);
        if (!isOnShoulder(entity) && !entity.getComponent("minecraft:rideable")?.getRiders().length)
          tickSleep(entity, data, data.tryGetOwner(entity));
        // Frente mundo-detalhes: item segurado visível, luz dinâmica e comportamentos de espécie.
        syncHeldItemDisplay(entity, data);
        const species = speciesIdOfType(entity.typeId);
        if (hasLightingData(species)) trackLightEmitter(entity, species, data.getFormName());
        tickSpeciesBehaviours(entity, data);
        // Frente dados-ia: aspects dos posers no cliente (q.has_aspect). O point_to_spawn do Nosepass fica só em
        // scripts/visual/PointToSpawn.ts (review-fixes: dois giros brigavam perto do spawn).
        syncAspectBits(entity, data.aspects);
      }
      catch (e) {
        console.warn(`[entidades] ${entity.typeId}: ${e}`);
      }
      yield;
    }
  }
}

let passRunning = false;
let started = false;

export function startEntityBehaviours() {
  if (started) return;
  started = true;
  system.runInterval(() => {
    if (passRunning) return;
    passRunning = true;
    const job = entityPass();
    system.runJob((function* () {
      try {
        yield* job;
      }
      finally {
        passRunning = false;
      }
    })());
  }, 20);
  system.runInterval(tickRiding, 2);
  // Frente limites-a: sprint na terra (duplo toque) precisa de cada tick; só percorre as montarias ativas.
  system.runInterval(tickRideSprint, 1);
  startDynamicLights();
  startSpeciesBehaviours();
  registerDadosIaProbe(); // frente dados-ia
  system.runInterval(tickShoulder, 10);

  world.afterEvents.entityHurt.subscribe(({ hurtEntity }) => {
    if (isPokemon(hurtEntity)) onPokemonHurt(hurtEntity);
  });
  world.afterEvents.dataDrivenEntityTrigger.subscribe(({ entity }) => {
    if (isPokemon(entity)) onAteGrass(entity);
  }, { eventTypes: ["cobblemon:ate_grass"] });
  world.afterEvents.playerButtonInput.subscribe(({ player, button }) => {
    if (button === InputButton.Jump) onJumpPressed(player);
    else if (button === InputButton.Sneak) onSneakPressed(player);
  }, { buttons: [InputButton.Jump, InputButton.Sneak], state: ButtonState.Pressed });
  world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
    dataCache.delete(removedEntityId);
    nextAmbient.delete(removedEntityId);
    forgetSleepState(removedEntityId);
    forgetMount(removedEntityId);
    forgetShoulder(removedEntityId);
    forgetHeldItemDisplay(removedEntityId);
    forgetLightEmitter(removedEntityId);
    forgetSpeciesBehaviours(removedEntityId);
  });
}
