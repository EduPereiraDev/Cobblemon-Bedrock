/**
 * Montaria (Cobblemon 1.7+/1.8.2: RidingController, RidingProperties, ride_settings).
 *
 * O controle em si é do motor do Bedrock, por componentes estáveis nos grupos gerados pelo importador:
 * - LAND  (horse/vehicle/minekart): minecraft:input_ground_controlled (+ can_power_jump/horse.jump_strength);
 * - AIR   (bird/jet/hover/rocket/glider/helicopter): minecraft:free_camera_controlled +
 *         vertical_movement_action (subir com pulo), sem gravidade — o mesmo do ghast feliz;
 * - LIQUID (dolphin/submarine/boat): free_camera_controlled + underwater_movement (+ fôlego do nautilus).
 * Este módulo monta/desmonta e troca o estilo como o RidingController: pulo duplo → AIR, tocar o chão → LAND,
 * entrar na água → LIQUID; o fôlego do voo (STAMINA) aparece na actionbar e, acabando, o voo vira planeio.
 * Frente dados-ui: velocidade e fôlego saem dos atributos com ride boosts (scripts/pokemon/RideStats.ts), aplicados
 * na entidade ao montar e a cada troca de estilo; sons `rideSounds` em loop (scripts/pokemon/RideSounds.ts); overlay
 * de controles na actionbar (`displayControlSeconds`); estatísticas times_ridden/riding_* (scripts/events/PlayerStats.ts).
 * Animações de montaria do jogador não existem aqui.
 *
 * Frente limites-a (pesquisa 8):
 * - sprint na terra (#33, HorseBehaviour): duplo toque para frente (teclado, analógico ou joystick de toque) corre
 *   com fôlego, aceleração e FOV × 1,15; sem sprint anda no walkSpeed da espécie. A barra de fôlego (setRideBar do
 *   Java) usa a actionbar. Lógica pura em RideSprint.ts; `tickRideSprint` roda a cada tick só para condutores;
 * - freelook (#38, aproximação): modo de câmera "freelook" = órbita em todos os estilos + esquema de controle
 *   PlayerRelative (a câmera gira livre com o mouse/analógico; a montaria vira por A/D). Não é "segurar a tecla";
 * - roll da câmera (#38): modo "roll" = câmera perseguidora por splines com o roll do voo. DESLIGADO por padrão (só
 *   liga se o jogador escolher o modo): a rotação z das splines não dá para confirmar sem cliente.
 *
 * Frente motor (pesquisa 3-motor §7) — câmera e controles:
 * - câmera: preset `cobblemon:ride_orbit` (herda minecraft:follow_orbit) em AIR/LIQUID; `cobblemon:ride_boom`
 *   (minecraft:fixed_boom) opcional; preferência por jogador na dynamic property `cobblemon:ride_camera`
 *   ("auto" padrão = órbita no ar/água, "always" = também em terra, "boom", "off"), trocada com
 *   `/scriptevent cobblemon:ride_camera <modo>`; `camera.clear()` ao desmontar;
 * - controles: no ar/água o agachar não desmonta (InputPermissionCategory.Dismount desligada): agachar segurado
 *   desce, agachar duas vezes rápido desmonta; pulo segurado sobe (vertical_movement_action do grupo AIR);
 * - roll visual: propriedade `cobblemon:roll` (float, client_sync) pela variação de yaw no ar — o RP usa
 *   `q.property('cobblemon:roll')` no bone raiz (pedido à frente animacao). Roll da câmera não existe na API.
 */
import {
  ButtonState, ControlScheme, EasingType, Entity, EntityAttributeComponent, InputButton, InputPermissionCategory, Player, system,
} from "@minecraft/server";
import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";
import { getEntityInfo, getRideInfo, speciesIdOfType } from "./EntityData";
import type { RideInfo, RideStyle } from "./EntityData";
// Frente dados-ui: atributos de montaria (ride boosts), estatísticas, sons e overlay de controles.
import { applyRideValues, getRideStat, rideBoostCompletion, rideValuesFor } from "../pokemon/RideStats";
import type { RideStyleData } from "../pokemon/RideStats";
import { stopRideSounds, tickRideSounds } from "../pokemon/RideSounds";
import { addRidingDistance, awardStat } from "../events/PlayerStats";
import { recordAchievementEvent } from "../ui/achievements/tracker";
import { rideControlsText } from "../ui/RideControls";
import { availableSeatCount } from "./SeatConditions"; // frente dados-ia
import { createPokemonEntityStruct } from "../molang/PokemonStruct"; // frente dados-ia: q.entity das condições de assento
// Frente limites-a: sprint na terra e câmera perseguidora com roll.
import {
  SPRINT_FORWARD_THRESHOLD, SprintState, newSprintState, sprintAccelerationSeconds, sprintBar, sprintFov, sprintStaminaSeconds,
  stepSpeed, stepSprint, stepStamina, walkMovementValue,
} from "./RideSprint";
import { chaseRollCamera } from "./RideCameraRoll";

// ---------------------------------------------------------------------------------------------
// Lógica pura

export interface RideSurroundings {
  onGround: boolean;
  /** Tocando água/lava (isInLiquid). */
  inLiquid: boolean;
  /** Olhos dentro do fluido (isEyeInFluid/isUnderWater). */
  eyeInFluid: boolean;
  /** O condutor deu pulo duplo agora. */
  doubleJump: boolean;
  hasDriver: boolean;
}

/** RidingController.checkForNewTransition, restrito aos estilos que a forma tem. */
export function nextRideStyle(current: RideStyle | undefined, styles: ReadonlyArray<RideStyle>, s: RideSurroundings): RideStyle | undefined {
  const has = (style: RideStyle) => styles.includes(style);
  const toLand = () => {
    if (s.eyeInFluid) return false;
    const stayInAir = !has("LAND") && current === "AIR";
    return s.onGround && !stayInAir;
  };
  const toLiquid = () => (has("LIQUID") && current !== "AIR" ? s.inLiquid : s.eyeInFluid);
  const toAir = () => {
    if (s.hasDriver) {
      if (!has("AIR")) return false;
      if (current === "LIQUID" && s.eyeInFluid) return false;
      return s.doubleJump;
    }
    return !s.onGround && !s.inLiquid;
  };
  let next: RideStyle | undefined;
  switch (current) {
    case "AIR": next = toLand() ? "LAND" : toLiquid() ? "LIQUID" : "AIR"; break;
    case "LIQUID": next = toAir() ? "AIR" : toLand() ? "LAND" : "LIQUID"; break;
    case "LAND": next = toAir() ? "AIR" : toLiquid() ? "LIQUID" : "LAND"; break;
    default: next = toAir() ? "AIR" : toLiquid() ? "LIQUID" : toLand() ? "LAND" : undefined;
  }
  // Estilo que a forma não tem: o Cobblemon derruba o passageiro; aqui fica no atual (ou no primeiro).
  if (next && has(next)) return next;
  return current && has(current) ? current : styles[0];
}

/** Fôlego do voo em segundos: gasta 1/s voando, recupera 10% do total por segundo fora do ar. */
export function staminaStep(stamina: number, max: number, style: RideStyle | undefined, seconds: number): number {
  if (max <= 0) return max;
  if (style === "AIR") return Math.max(0, stamina - seconds);
  return Math.min(max, stamina + max * 0.1 * seconds);
}

/** Barra de fôlego para a actionbar (10 blocos). */
export function staminaBar(stamina: number, max: number): string {
  const filled = max > 0 ? Math.round((stamina / max) * 10) : 10;
  return `§b${"■".repeat(filled)}§8${"■".repeat(10 - filled)}`;
}

// ---------------------------------------------------------------------------------------------
// Runtime

interface MountState {
  entity: Entity;
  info: RideInfo;
  style?: RideStyle;
  stamina: number;
  maxStamina: number;
  tired: boolean;
  lastTransition: number;
  /** Frente montaria-pulo: saiu do chão desde a última troca de estilo (o AIR só volta para LAND depois disso). */
  airborne?: boolean;
  /** Frente motor: condutor com câmera/permissões alteradas, yaw anterior e roll atual. */
  controlledBy?: Player;
  camera?: string;
  lastYaw?: number;
  roll?: number;
  /** Frente dados-ui: dados do Pokémon (ride boosts) e fim do overlay de controles. */
  data?: PokemonData;
  controlsUntil?: number;
  /** Frente limites-a: sprint na terra, modo de câmera do condutor, freelook e câmera perseguidora. */
  sprint?: LandSprint;
  cameraMode?: RideCameraMode;
  freelook?: boolean;
  chasing?: boolean;
}

/** Estado do sprint na terra (HorseState: sprinting, stamina, timer) + a velocidade aplicada e os valores do estilo. */
interface LandSprint {
  logic: SprintState;
  /** Valor atual de minecraft:movement. */
  speed: number;
  walk: number;
  top: number;
  staminaSeconds: number;
  accelSeconds: number;
  fovApplied: boolean;
}

/** Última posição de cada jogador montado (distância das estatísticas riding_*). */
const lastRiderPos = new Map<string, { x: number; y: number; z: number; t: number }>();

/** Fôlego do voo com o STAMINA efetivo (ride boosts); 0 = infinito. */
function airStaminaOf(info: RideInfo, data: PokemonData | undefined): number {
  if (getConfig().infiniteRideStamina) return 0;
  if (!data) return info.styles.AIR?.stamina ?? 0;
  return rideValuesFor(data, "AIR", info)?.stamina ?? info.styles.AIR?.stamina ?? 0;
}

/** Aplica os atributos do estilo atual na entidade (depois dos grupos de componente do evento). */
function scheduleRideValues(state: MountState) {
  const style = state.style;
  const data = state.data;
  if (!style || !data) return;
  system.runTimeout(() => {
    if (!state.entity.isValid || state.style !== style) return;
    const values = rideValuesFor(data, style, state.info);
    if (values) applyRideValues(state.entity, style, values);
    // Frente limites-a: na terra com sprint a velocidade é a do sprint (andar/acelerando), não o topo.
    if (style === "LAND" && state.sprint) setMovement(state.entity, state.sprint.speed);
  }, 1);
}

/** Mostra os controles do estilo por `displayControlSeconds` (RideControlsOverlay: só para quem conduz). */
function showControls(state: MountState) {
  const seconds = getConfig().displayControlSeconds;
  if (!(typeof seconds === "number" && seconds > 0)) { state.controlsUntil = undefined; return; }
  state.controlsUntil = system.currentTick + Math.round(seconds * 20);
}

const mounts = new Map<string, MountState>();
const lastJump = new Map<string, number>();
const doubleJumps = new Set<string>();
/** Janela do agachar duplo (desmontar no ar/água). */
const DOUBLE_JUMP_TICKS = 7;
/** Janela do pulo duplo: LocalPlayerMixin.cobblemon$survivalJumpTriggerTime = 12 ticks. */
const DOUBLE_JUMP_WINDOW = 12;
/**
 * Frente montaria-pulo: decolagem. No Java o 1º toque já tira a montaria do chão (pulo do HorseBehaviour) ou o jato
 * anda sozinho (minSpeedFactor), e o AIR não tem gravidade. Aqui o grupo ride_air só tira a gravidade: parada no chão,
 * ela ficava lá e 10 ticks depois voltava para LAND (a câmera ia para a órbita e voltava). O pulo duplo dá um impulso
 * de subida (0,25 sem gravidade e com o arrasto de 0,91/tick ≈ 2,5 blocos, perto do pulo do HorseBehaviour; medido no
 * BDS: 0,5 subia ~5,5) e o AIR só volta para LAND depois de sair do chão, ou sem conseguir subir (teto) por
 * TAKEOFF_GRACE_TICKS. Pulo segurado continua subindo pelo vertical_movement_action.
 */
const TAKEOFF_VELOCITY = 0.25;
const TAKEOFF_GRACE_TICKS = 40;

function formNameOf(data: PokemonData): string {
  return data.getFormData()?.name ?? "";
}

function isOwner(player: Player, entity: Entity, data?: PokemonData): boolean {
  return entity.getDynamicProperty("owner_name") === player.name || (!!data?.trainer && data.trainer === player.id);
}

function riders(entity: Entity): Entity[] {
  try {
    return entity.getComponent("minecraft:rideable")?.getRiders() ?? [];
  }
  catch {
    return [];
  }
}

/** Condições do canRide do showInteractionWheel (sem plataforma/pasto/beam, que não existem no port). */
export function canRidePokemon(player: Player, entity: Entity, data = PokemonData.tryGetFromEntity(entity)): boolean {
  if (!data || entity.getProperty("cobblemon:wild") === true) return false;
  // PokemonEntity.tryRidingPokemon: pequeno demais para montar (pedido G da frente jogabilidade).
  if (data.getEffectiveScale() < getConfig().minimumRidingScale) return false;
  if (entity.getProperty("cobblemon:in_battle") === true || entity.getProperty("cobblemon:busy") === true) return false;
  if (player.getProperty("cobblemon:in_battle") === true) return false;
  const info = getRideInfo(speciesIdOfType(entity.typeId), formNameOf(data));
  if (!info || !entity.getComponent("minecraft:rideable")) return false;
  const current = riders(entity);
  if (current.some(r => r.id === player.id)) return false;
  if (!isOwner(player, entity, data) && current.length === 0) return false;
  // Frente dados-ia: assentos condicionais (Seat.condition) limitam quantos sobem.
  const seats = availableSeatCount({
    species: speciesIdOfType(entity.typeId), formName: formNameOf(data), aspects: data.aspects, level: data.level,
    shiny: data.shiny === true, wild: false, passengers: current.length,
    entityStruct: () => createPokemonEntityStruct(entity, data),
  }, info.seats);
  return current.length < seats;
}

/** Sobe no Pokémon (dono como condutor; outros jogadores só como passageiros). */
export function startRiding(player: Player, entity: Entity): boolean {
  const data = PokemonData.tryGetFromEntity(entity);
  if (!data || !canRidePokemon(player, entity, data)) return false;
  const info = getRideInfo(speciesIdOfType(entity.typeId), formNameOf(data))!;
  if (entity.getProperty("cobblemon:sleeping") === true) entity.triggerEvent("cobblemon:wake");
  const ok = entity.getComponent("minecraft:rideable")?.addRider(player) ?? false;
  if (ok) {
    // RIDE_EVENT_POST: StatHandler.onRide (times_ridden) e AdvancementHandler.startRiding (max_ride_stats).
    awardStat(player, "times_ridden");
    if (isOwner(player, entity, data)) {
      try { recordAchievementEvent(player, { type: "riding_stat_boost", ...rideBoostCompletion(data, info) }); }
      catch { }
    }
  }
  if (ok && !mounts.has(entity.id)) {
    const max = airStaminaOf(info, data);
    // on_mount liga o primeiro estilo do JSON (LAND, AIR, LIQUID nessa ordem).
    const first = getEntityInfo(entity.typeId)?.rideGroups[0];
    const state: MountState = { entity, info, style: first, stamina: max, maxStamina: max, tired: false, lastTransition: system.currentTick, data };
    mounts.set(entity.id, state);
    scheduleRideValues(state);
    if (isOwner(player, entity, data)) showControls(state);
  }
  return ok;
}

export function stopRiding(entity: Entity) {
  const state = mounts.get(entity.id);
  if (state) releaseControls(state);
  stopRideSounds(entity.id);
  try {
    entity.getComponent("minecraft:rideable")?.ejectRiders();
  }
  catch { }
  mounts.delete(entity.id);
}

export function isRidingPokemon(player: Player, entity: Entity): boolean {
  return riders(entity).some(r => r.id === player.id);
}

/** Jump apertado (playerButtonInput): dois toques em até 12 ticks = pulo duplo. */
export function onJumpPressed(player: Player) {
  const now = system.currentTick;
  const last = lastJump.get(player.id);
  if (last !== undefined && now - last <= DOUBLE_JUMP_WINDOW) {
    doubleJumps.add(player.id);
    lastJump.delete(player.id);
  }
  else lastJump.set(player.id, now);
}

function setStyle(state: MountState, style: RideStyle) {
  state.style = style;
  state.tired = false;
  state.airborne = false;
  state.lastTransition = system.currentTick;
  state.entity.triggerEvent(`cobblemon:ride_${style.toLowerCase()}`);
  if (state.controlledBy) applyControls(state, state.controlledBy);
  // Frente dados-ui: velocidade com ride boosts e os controles do estilo novo.
  scheduleRideValues(state);
  if (state.controlledBy) showControls(state);
}

// ---------------------------------------------------------------------------------------------
// Câmera, controles e roll (frente motor)

export type RideCameraMode = "auto" | "always" | "boom" | "off" | "freelook" | "roll";
const RIDE_CAMERA_MODES: readonly RideCameraMode[] = ["auto", "always", "boom", "off", "freelook", "roll"];
export const RIDE_CAMERA_PROPERTY = "cobblemon:ride_camera";
export const ROLL_PROPERTY = "cobblemon:roll";
const ORBIT_PRESET = "cobblemon:ride_orbit";
const BOOM_PRESET = "cobblemon:ride_boom";
/** Roll máximo (graus) e ganho por grau de yaw por tick. */
const MAX_ROLL = 45;
const ROLL_GAIN = 3;

/** Preset de câmera para o estilo e a preferência do jogador (undefined = câmera normal do jogador). */
export function rideCameraPreset(style: RideStyle | undefined, mode: RideCameraMode): string | undefined {
  if (mode === "off" || !style) return undefined;
  if (mode === "boom") return BOOM_PRESET;
  // Frente limites-a: freelook = órbita em todos os estilos (o PlayerRelative só vale no follow_orbit).
  if (mode === "always" || mode === "freelook") return ORBIT_PRESET;
  // Frente limites-a: roll = câmera perseguidora (minecraft:free) no ar; na água, a órbita de sempre.
  if (mode === "roll" && style === "AIR") return undefined;
  return style === "AIR" || style === "LIQUID" ? ORBIT_PRESET : undefined;
}

/** O agachar desmonta neste estilo? (No ar/água ele desce.) */
export function sneakDismounts(style: RideStyle | undefined): boolean {
  return style !== "AIR" && style !== "LIQUID";
}

/** Menor diferença entre ângulos (graus, -180..180). */
export function yawDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Roll suavizado: inclina para o lado da curva, volta a 0 em linha reta. */
export function nextRoll(current: number, deltaYaw: number): number {
  const target = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, -deltaYaw * ROLL_GAIN));
  return Math.round((current + (target - current) * 0.35) * 10) / 10;
}

function cameraModeOf(player: Player): RideCameraMode {
  try {
    const v = player.getDynamicProperty(RIDE_CAMERA_PROPERTY);
    return RIDE_CAMERA_MODES.includes(v as RideCameraMode) ? v as RideCameraMode : "auto";
  }
  catch { return "auto"; }
}

function setDismountAllowed(player: Player, allowed: boolean) {
  try { player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, allowed); }
  catch { /* jogador saiu */ }
}

/** Frente limites-a (#38): esquema de controle do freelook (PlayerRelative) ou o padrão do jogador. */
function setFreelook(state: MountState, driver: Player, on: boolean) {
  if ((state.freelook ?? false) === on) return;
  try {
    driver.setControlScheme(on ? ControlScheme.PlayerRelative : undefined);
    state.freelook = on;
  }
  catch (e) {
    console.warn(`[montaria] freelook: ${e}`);
    state.freelook = false;
  }
}

/** Aplica câmera e permissões ao condutor conforme o estilo atual. */
function applyControls(state: MountState, driver: Player) {
  state.controlledBy = driver;
  setDismountAllowed(driver, sneakDismounts(state.style));
  const mode = cameraModeOf(driver);
  state.cameraMode = mode;
  // Sai da câmera perseguidora (roll) quando o estilo ou o modo muda.
  if (state.chasing && !(mode === "roll" && state.style === "AIR")) {
    state.chasing = false;
    state.camera = "minecraft:free";
  }
  const preset = rideCameraPreset(state.style, mode);
  // O motor só aceita o PlayerRelative com a câmera de órbita já ativa: desliga antes de trocar, liga depois.
  const freelook = mode === "freelook" && preset === ORBIT_PRESET;
  if (!freelook) setFreelook(state, driver, false);
  if (preset !== state.camera) {
    try {
      if (preset) {
        const size = getEntityInfo(state.entity.typeId)?.sizes[0];
        const height = size ? size.height * size.scale : 1;
        driver.camera.setCamera(preset, { entityOffset: { x: 0, y: Math.min(3, height * 0.5), z: 0 }, viewOffset: { x: 0, y: 0 } });
      }
      else driver.camera.clear();
      state.camera = preset;
    }
    catch (e) {
      console.warn(`[montaria] câmera ${preset}: ${e}`);
      state.camera = preset;
    }
  }
  if (freelook) setFreelook(state, driver, true);
}

/** Devolve câmera, permissões e roll ao normal. */
function releaseControls(state: MountState) {
  const driver = state.controlledBy;
  state.controlledBy = undefined;
  // Frente limites-a: sprint (velocidade e FOV) e freelook voltam ao normal.
  endSprint(state, driver);
  if (driver?.isValid) {
    setDismountAllowed(driver, true);
    if (state.freelook) setFreelook(state, driver, false);
    if (state.camera || state.chasing) {
      try { driver.camera.clear(); }
      catch { }
    }
  }
  state.freelook = false;
  state.chasing = false;
  state.camera = undefined;
  if (state.roll) {
    state.roll = 0;
    try { if (state.entity.isValid) state.entity.setProperty(ROLL_PROPERTY, 0); }
    catch { /* espécie sem a propriedade */ }
  }
}

const lastRideSneak = new Map<string, number>();

/** Sneak apertado (Shoulder.onSneakPressed repassa): duas vezes rápido no ar/água desmonta. */
export function onRideSneakPressed(player: Player): boolean {
  const vehicle = getMountedPokemon(player);
  if (!vehicle) return false;
  const state = mounts.get(vehicle.id);
  if (!state || sneakDismounts(state.style)) return false;
  const now = system.currentTick;
  const last = lastRideSneak.get(player.id);
  if (last !== undefined && now - last <= DOUBLE_JUMP_TICKS) {
    lastRideSneak.delete(player.id);
    releaseControls(state);
    try { vehicle.getComponent("minecraft:rideable")?.ejectRider(player); }
    catch { }
    return true;
  }
  lastRideSneak.set(player.id, now);
  return true;
}

/** A cada passada: descer com agachar segurado e roll pela curva. */
function tickControls(state: MountState, driver: Player) {
  if (state.controlledBy?.id !== driver.id) {
    if (state.controlledBy) releaseControls(state);
    applyControls(state, driver);
  }
  const entity = state.entity;
  if (!sneakDismounts(state.style)) {
    try {
      if (driver.inputInfo.getButtonState(InputButton.Sneak) === ButtonState.Pressed) {
        const v = entity.getVelocity();
        if (v.y > -0.6) entity.applyImpulse({ x: 0, y: -0.12, z: 0 });
      }
    }
    catch { /* entidade sem física de impulso */ }
  }
  let yaw: number;
  try { yaw = entity.getRotation().y; }
  catch { return; }
  const prev = state.lastYaw ?? yaw;
  state.lastYaw = yaw;
  const roll = state.style === "AIR" ? nextRoll(state.roll ?? 0, yawDelta(prev, yaw) / 2) : 0;
  if (Math.abs(roll - (state.roll ?? 0)) < 0.5 && !(roll === 0 && state.roll)) return;
  state.roll = roll;
  try { entity.setProperty(ROLL_PROPERTY, roll); }
  catch { /* espécie sem a propriedade (só voadoras montáveis têm) */ }
}

/** Roda a cada 2 ticks só para os Pokémon montados. */
export function tickRiding() {
  const tick = system.currentTick;
  for (const [id, state] of mounts) {
    const entity = state.entity;
    if (!entity.isValid) {
      releaseControls(state);
      stopRideSounds(id);
      mounts.delete(id);
      continue;
    }
    const current = riders(entity);
    if (!current.length) {
      releaseControls(state);
      stopRideSounds(id);
      mounts.delete(id);
      entity.triggerEvent("cobblemon:on_dismount");
      continue;
    }
    // Frente dados-ui: distância montado (riding_land/air/liquid), loops de som e overlay de controles.
    const players = current.filter((r): r is Player => r instanceof Player);
    for (const rider of players) {
      const pos = rider.location;
      const last = lastRiderPos.get(rider.id);
      lastRiderPos.set(rider.id, { x: pos.x, y: pos.y, z: pos.z, t: tick });
      // Só entre passadas seguidas (remontar ou teleportar não conta como distância).
      const moved = last ? Math.hypot(pos.x - last.x, pos.y - last.y, pos.z - last.z) : 0;
      if (last && tick - last.t <= 4 && last.t !== tick && moved < 16) addRidingDistance(rider, state.style, moved);
    }
    const styleData = state.style ? state.info.styles[state.style] as RideStyleData | undefined : undefined;
    let input = 0;
    try {
      const driverPlayer = players[0];
      const move = driverPlayer?.inputInfo.getMovementVector();
      input = move ? Math.min(1, Math.hypot(move.x, move.y)) : 0;
    }
    catch { }
    tickRideSounds(entity, state.style, styleData?.sounds, players, input);
    if (state.controlsUntil !== undefined && players[0]) {
      if (tick >= state.controlsUntil) state.controlsUntil = undefined;
      else if (tick % 10 === 0) {
        try { players[0].onScreenDisplay.setActionBar(rideControlsText(styleData?.key)); } catch { }
      }
    }
    const driver = current[0];
    if (driver instanceof Player) tickControls(state, driver);
    else if (state.controlledBy) releaseControls(state);
    if (driver.getProperty("cobblemon:in_battle") === true || entity.getProperty("cobblemon:in_battle") === true) {
      stopRiding(entity);
      continue;
    }
    const styles = (Object.keys(state.info.styles) as RideStyle[]).filter(s => getEntityInfo(entity.typeId)?.rideGroups.includes(s));
    const jumped = doubleJumps.delete(driver.id);
    const onGround = entity.isOnGround;
    if (state.style === "AIR" && !onGround) state.airborne = true;
    if (tick - state.lastTransition >= 10) {
      const next = nextRideStyle(state.style, styles, {
        onGround: landingCounts(state, onGround, tick),
        inLiquid: entity.isInWater,
        eyeInFluid: entity.isInWater && isHeadUnderwater(entity),
        doubleJump: jumped,
        hasDriver: true,
      });
      if (next && next !== state.style) {
        const from = state.style;
        setStyle(state, next);
        if (next === "AIR" && jumped && from !== "AIR") takeOff(state);
      }
    }
    if (state.maxStamina > 0 && tick % 20 === 0) {
      state.stamina = staminaStep(state.stamina, state.maxStamina, state.style, 1);
      if (state.style === "AIR" && state.stamina <= 0 && !state.tired) {
        state.tired = true;
        entity.triggerEvent("cobblemon:ride_air_tired");
      }
      if (state.style === "AIR" || state.stamina < state.maxStamina) {
        try {
          // O overlay de controles (frente dados-ui) usa a actionbar enquanto estiver na tela.
          // Frente limites-a: na terra, a barra do sprint (fôlego da terra) tem a vez enquanto estiver na tela.
          const sprintBarShown = state.style === "LAND" && !!state.sprint && (state.sprint.logic.sprinting || state.sprint.logic.stamina < 1);
          if (driver instanceof Player && state.controlsUntil === undefined && !sprintBarShown) driver.onScreenDisplay.setActionBar(staminaBar(state.stamina, state.maxStamina));
        }
        catch { }
      }
    }
  }
}

/** No AIR, o chão só conta depois de a montaria ter saído dele (ou passada a carência da decolagem). */
export function landingCounts(state: { style?: RideStyle; airborne?: boolean; lastTransition: number }, onGround: boolean, tick: number): boolean {
  if (!onGround || state.style !== "AIR") return onGround;
  return !!state.airborne || tick - state.lastTransition >= TAKEOFF_GRACE_TICKS;
}

/** Impulso da decolagem, um tick depois do evento ride_air (os componentes do grupo novo já valem). */
function takeOff(state: MountState) {
  const entity = state.entity;
  const vy = TAKEOFF_VELOCITY;
  system.runTimeout(() => {
    try {
      if (!entity.isValid || state.style !== "AIR") return;
      const v = entity.getVelocity();
      if (v.y < vy) entity.applyImpulse({ x: 0, y: vy - v.y, z: 0 });
    }
    catch (e) { console.warn(`[montaria] decolagem: ${e}`); }
  }, 1);
}

/** Cabeça do Pokémon dentro d'água (bloco na altura dos olhos). */
function isHeadUnderwater(entity: Entity): boolean {
  const size = getEntityInfo(entity.typeId)?.sizes[0];
  const eye = size ? size.height * size.scale * 0.85 : 0.8;
  try {
    const block = entity.dimension.getBlock({ x: entity.location.x, y: entity.location.y + eye, z: entity.location.z });
    return !!block && (block.typeId === "minecraft:water" || block.typeId === "minecraft:flowing_water" || block.isWaterlogged);
  }
  catch {
    return false;
  }
}

/** Quem montou por fora do script (ex.: comando /ride) também é acompanhado. */
export function trackMountIfRidden(entity: Entity, data: PokemonData) {
  if (mounts.has(entity.id) || !riders(entity).length) return;
  const info = getRideInfo(speciesIdOfType(entity.typeId), formNameOf(data));
  if (!info) return;
  const max = airStaminaOf(info, data);
  const state: MountState = { entity, info, style: getEntityInfo(entity.typeId)?.rideGroups[0], stamina: max, maxStamina: max, tired: false, lastTransition: system.currentTick, data };
  mounts.set(entity.id, state);
  scheduleRideValues(state);
}

export function forgetMount(entityId: string) {
  const state = mounts.get(entityId);
  if (state) releaseControls(state);
  stopRideSounds(entityId);
  mounts.delete(entityId);
}

/** `/scriptevent cobblemon:ride_camera <auto|always|boom|off|freelook|roll>` (quem roda o comando). */
export function setRideCameraMode(player: Player, mode: string) {
  const value: RideCameraMode = RIDE_CAMERA_MODES.includes(mode as RideCameraMode) ? mode as RideCameraMode : "auto";
  player.setDynamicProperty(RIDE_CAMERA_PROPERTY, value);
  const vehicle = getMountedPokemon(player);
  const state = vehicle && mounts.get(vehicle.id);
  if (state) {
    state.camera = state.camera ?? "";
    applyControls(state, player);
  }
}

/** Usado pelo jogo para saber se um jogador está montado (ex.: despawn, batalha). */
export function getMountedPokemon(player: Player): Entity | undefined {
  try {
    const vehicle = player.getComponent("minecraft:riding")?.entityRidingOn;
    return vehicle && mounts.has(vehicle.id) ? vehicle : undefined;
  }
  catch {
    return undefined;
  }
}

/** Estilo atual da montaria do jogador (estatísticas e telas). */
export function getRideStyle(player: Player): RideStyle | undefined {
  const vehicle = getMountedPokemon(player);
  return vehicle ? mounts.get(vehicle.id)?.style : undefined;
}

// ---------------------------------------------------------------------------------------------
// Sprint na terra (#33) e câmera perseguidora com roll (#38) — frente limites-a

/**
 * rideFovMultiplier (× 1,15 correndo). A API só aceita FOV absoluto e o FOV escolhido pelo jogador não é legível:
 * o sprint usa 70 (padrão do Java) × 1,15 e devolve com `setFov()` sem valor (fov_clear), que volta ao do jogador.
 */
export const RIDE_SPRINT_FOV = { enabled: true, base: 70, easeSeconds: 0.25 };

function setMovement(entity: Entity, value: number) {
  try { (entity.getComponent("minecraft:movement") as EntityAttributeComponent | undefined)?.setCurrentValue(value); }
  catch { /* entidade descarregada */ }
}

/** Valores do sprint para a forma montada: andar, topo (ride boosts), fôlego e aceleração; undefined = sem sprint. */
function landSprintValues(state: MountState): Omit<LandSprint, "logic" | "speed" | "fovApplied"> | undefined {
  const style = state.info.styles.LAND as RideStyleData | undefined;
  const data = state.data;
  if (!style?.sprint || !data) return undefined;
  const values = rideValuesFor(data, "LAND", state.info);
  if (!values) return undefined;
  return {
    walk: walkMovementValue(style.walkSpeed),
    top: values.speed,
    staminaSeconds: sprintStaminaSeconds(getRideStat(data, "LAND", "STAMINA", state.info)),
    accelSeconds: sprintAccelerationSeconds(getRideStat(data, "LAND", "ACCELERATION", state.info)),
  };
}

function setSprintFov(driver: Player, sprinting: boolean) {
  const ease = { easeTime: RIDE_SPRINT_FOV.easeSeconds, easeType: EasingType.OutSine };
  try {
    if (sprinting) driver.camera.setFov({ fov: sprintFov(RIDE_SPRINT_FOV.base), easeOptions: ease });
    else driver.camera.setFov({ easeOptions: ease });
  }
  catch { /* jogador saiu */ }
}

/** Fim do sprint (saiu da terra, desmontou ou trocou de condutor): velocidade de montaria de sempre e FOV do jogador. */
function endSprint(state: MountState, driver: Player | undefined) {
  const sprint = state.sprint;
  if (!sprint) return;
  state.sprint = undefined;
  if (state.entity.isValid && state.data) {
    const values = rideValuesFor(state.data, "LAND", state.info);
    if (values && state.style === "LAND") setMovement(state.entity, values.speed);
  }
  if (sprint.fovApplied && driver?.isValid) setSprintFov(driver, false);
}

/** HorseBehaviour.handleSprinting + tickStamina + calculateRideSpaceVel, um tick. */
function stepLandSprint(state: MountState, driver: Player, tick: number) {
  let sprint = state.sprint;
  if (!sprint || tick % 20 === 0) {
    const values = landSprintValues(state);
    if (!values) { endSprint(state, driver); return; }
    if (!sprint) {
      sprint = { logic: newSprintState(), speed: values.walk, fovApplied: false, ...values };
      state.sprint = sprint;
      setMovement(state.entity, sprint.speed);
    }
    else Object.assign(sprint, values);
  }
  let forward = false;
  let sprintKey = false;
  try { forward = driver.inputInfo.getMovementVector().y > SPRINT_FORWARD_THRESHOLD; } catch { }
  // A tecla de correr não chega montado no Bedrock (pesquisa 8 §2); fica para o dia em que chegar.
  try { sprintKey = driver.isSprinting; } catch { }
  const logic = sprint.logic;
  const was = logic.sprinting;
  stepSprint(logic, { forward, sprintKey });
  stepStamina(logic, sprint.staminaSeconds, getConfig().infiniteRideStamina === true);
  const next = stepSpeed(sprint.speed, sprint.walk, sprint.top, logic.sprinting, sprint.accelSeconds);
  if (Math.abs(next - sprint.speed) > 1e-4 || tick % 20 === 0) {
    sprint.speed = next;
    setMovement(state.entity, next);
  }
  if (RIDE_SPRINT_FOV.enabled && was !== logic.sprinting) {
    setSprintFov(driver, logic.sprinting);
    sprint.fovApplied = logic.sprinting;
  }
  // setRideBar: o fôlego na barra (actionbar), sem atropelar o overlay de controles.
  if (state.controlsUntil === undefined && (logic.sprinting || logic.stamina < 1) && tick % 5 === 0) {
    try { driver.onScreenDisplay.setActionBar(sprintBar(logic.stamina, logic.sprinting, logic.sprintToggleable)); }
    catch { }
  }
}

/** Roda a cada tick (entity/index.ts): sprint dos condutores na terra e câmera perseguidora de quem escolheu "roll". */
export function tickRideSprint() {
  if (!mounts.size) return;
  const tick = system.currentTick;
  for (const state of mounts.values()) {
    const driver = state.controlledBy;
    try {
      if (driver?.isValid && state.style === "LAND" && state.entity.isValid) stepLandSprint(state, driver, tick);
      else if (state.sprint) endSprint(state, driver);
      if (driver?.isValid && state.cameraMode === "roll" && state.style === "AIR" && state.entity.isValid && tick % 3 === 0) {
        chaseRollCamera(driver, state.entity, !state.chasing);
        state.chasing = true;
        state.camera = undefined;
      }
    }
    catch (e) { console.warn(`[montaria] sprint: ${e}`); }
  }
}

/** Estado do sprint do jogador montado (sondas de depuração e E2E). */
export function rideSprintSnapshot(player: Player): { sprinting: boolean; stamina: number; speed: number; walk: number; top: number } | undefined {
  const vehicle = getMountedPokemon(player);
  const sprint = vehicle ? mounts.get(vehicle.id)?.sprint : undefined;
  return sprint ? { sprinting: sprint.logic.sprinting, stamina: sprint.logic.stamina, speed: sprint.speed, walk: sprint.walk, top: sprint.top } : undefined;
}

/** Modo de câmera e freelook do condutor (sondas de depuração). */
export function rideCameraSnapshot(player: Player): { mode?: RideCameraMode; camera?: string; freelook: boolean; chasing: boolean } | undefined {
  const vehicle = getMountedPokemon(player);
  const state = vehicle ? mounts.get(vehicle.id) : undefined;
  return state ? { mode: state.cameraMode, camera: state.camera, freelook: !!state.freelook, chasing: !!state.chasing } : undefined;
}
