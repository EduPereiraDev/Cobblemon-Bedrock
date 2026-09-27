/**
 * Pokémon no ombro (Cobblemon 1.8.2: PokemonEntity.tryMountingShoulder, ShoulderedState, PlayerMixin).
 *
 * O Bedrock não tem "entidade no ombro" como o Java (NBT no jogador). O port monta a entidade no
 * `minecraft:rideable` do player.json (os dois assentos dos papagaios), que aceita a família
 * `pokemon_shoulder`. A família só existe enquanto o Pokémon está no ombro (evento cobblemon:shoulder_on),
 * porque o rideable do jogador puxa para os assentos qualquer entidade da família que encostar nele.
 * Como no Cobblemon, o Pokémon não cai sozinho: se o motor o derrubar (pulo, dano, voo), volta ao ombro;
 * sai recolhendo pela party, com o gesto de novo (agachar + interagir) ou agachando duas vezes rápido.
 */
import { Entity, Player, system } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { isShoulderMountable, speciesIdOfType } from "./EntityData";
import { onRideSneakPressed } from "./Riding";

const SHOULDER_PROPERTY = "cobblemon:shouldered_on";
/** Pedido à frente de spawn: entidades com isto não somem pelo Despawner. */
const PERSISTENT_PROPERTY = "cobblemon:persistent";
const MAX_SHOULDER = 2;

interface ShoulderState {
  entity: Entity;
  playerId: string;
}

const shouldered = new Map<string, ShoulderState>();
const lastSneak = new Map<string, number>();

function playerRideable(player: Player) {
  try {
    return player.getComponent("minecraft:rideable");
  }
  catch {
    return undefined;
  }
}

function shoulderRiders(player: Player): Entity[] {
  return (playerRideable(player)?.getRiders() ?? []).filter(r => r.typeId !== "minecraft:parrot");
}

export function isOnShoulder(entity: Entity): boolean {
  return shouldered.has(entity.id);
}

/** canSitOnShoulder (forma shoulderMountable, não Alfa) + belongsTo + hasRoomToMount. */
export function canShoulderMount(player: Player, entity: Entity, data = PokemonData.tryGetFromEntity(entity)): boolean {
  if (!data || entity.getProperty("cobblemon:wild") === true) return false;
  if (entity.getDynamicProperty("owner_name") !== player.name && data.trainer !== player.id) return false;
  if (data.aspects.includes("alpha") || entity.getProperty("cobblemon:alpha") === true) return false;
  if (entity.getProperty("cobblemon:in_battle") === true || entity.getProperty("cobblemon:busy") === true) return false;
  if (!isShoulderMountable(speciesIdOfType(entity.typeId), data.getFormData()?.name ?? "")) return false;
  const rideable = playerRideable(player);
  return !!rideable && (rideable.getRiders()?.length ?? 0) < MAX_SHOULDER && shoulderRiders(player).length < MAX_SHOULDER;
}

function attach(player: Player, entity: Entity): boolean {
  try {
    return playerRideable(player)?.addRider(entity) ?? false;
  }
  catch {
    return false;
  }
}

export function mountShoulder(player: Player, entity: Entity): boolean {
  if (!canShoulderMount(player, entity)) return false;
  if (entity.getProperty("cobblemon:sleeping") === true) entity.triggerEvent("cobblemon:wake");
  // A família nova só vale depois do evento ser aplicado: monta no tick seguinte.
  entity.triggerEvent("cobblemon:shoulder_on");
  shouldered.set(entity.id, { entity, playerId: player.id });
  entity.setDynamicProperty(SHOULDER_PROPERTY, player.id);
  entity.setDynamicProperty(PERSISTENT_PROPERTY, true);
  system.runTimeout(() => {
    if (!entity.isValid || !player.isValid) return;
    if (!attach(player, entity)) dismountShoulder(entity);
  }, 1);
  return true;
}

export function dismountShoulder(entity: Entity, player?: Player) {
  shouldered.delete(entity.id);
  if (!entity.isValid) return;
  try {
    const owner = player ?? entity.getComponent("minecraft:riding")?.entityRidingOn;
    owner?.getComponent("minecraft:rideable")?.ejectRider(entity);
  }
  catch { }
  entity.setDynamicProperty(SHOULDER_PROPERTY, undefined);
  entity.setDynamicProperty(PERSISTENT_PROPERTY, undefined);
  entity.triggerEvent("cobblemon:shoulder_off");
}

/** Liga/desliga o ombro. true = fez algo. */
export function toggleShoulder(player: Player, entity: Entity): boolean {
  if (isOnShoulder(entity)) {
    dismountShoulder(entity, player);
    return true;
  }
  return mountShoulder(player, entity);
}

/** Tira todos os Pokémon do ombro do jogador (agachar duas vezes rápido). */
export function dismountAll(player: Player) {
  for (const [, state] of shouldered) if (state.playerId === player.id) dismountShoulder(state.entity, player);
}

/** Sneak apertado: dois toques em até 7 ticks tiram os Pokémon do ombro. */
export function onSneakPressed(player: Player) {
  // Frente motor: montado no ar/água, o agachar é da montaria (descer; duas vezes = desmontar).
  if (onRideSneakPressed(player)) return;
  const now = system.currentTick;
  const last = lastSneak.get(player.id);
  if (last !== undefined && now - last <= 7) {
    lastSneak.delete(player.id);
    dismountAll(player);
  }
  else lastSneak.set(player.id, now);
}

/** A cada 10 ticks: devolve ao ombro quem o motor derrubou; limpa o estado de quem sumiu. */
export function tickShoulder() {
  for (const [id, state] of shouldered) {
    const entity = state.entity;
    if (!entity.isValid) {
      shouldered.delete(id);
      continue;
    }
    let player: Player | undefined;
    try {
      player = entity.dimension.getPlayers().find(p => p.id === state.playerId);
    }
    catch { }
    if (!player?.isValid) {
      dismountShoulder(entity);
      continue;
    }
    const on = entity.getComponent("minecraft:riding")?.entityRidingOn?.id === player.id;
    if (!on && player.isOnGround && !player.isInWater && !player.isSleeping) attach(player, entity);
  }
}

export function forgetShoulder(entityId: string) {
  shouldered.delete(entityId);
}
