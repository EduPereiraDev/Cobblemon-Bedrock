/**
 * Sprint da montaria terrestre (#33): lógica pura, sem API do Minecraft, para poder ser testada.
 * Port de HorseBehaviour.handleSprinting / tickStamina / calculateRideSpaceVel / rideFovMultiplier / setRideBar
 * (Cobblemon 1.8.2, api/riding/behaviour/types/land/HorseBehaviour.kt). Quem aplica na entidade é o Riding.ts.
 *
 * Java:
 *  - tentar correr = (tecla de correr + frente) OU frente tocada 2× em até 7 ticks (timer "vanilla");
 *  - para de correr quando solta a frente ou o fôlego zera; zerado, só volta a poder correr com fôlego > 0,33;
 *  - fôlego: gasta (1 / staminaExpr) / 20 por tick correndo e recupera 8× isso parado/andando;
 *  - velocidade máxima: speedExpr correndo, getWalkSpeed andando; aceleração = topo / (accelerationExpr × 20) ticks
 *    correndo e topo / 10 ticks andando;
 *  - FOV × 1,15 correndo (rideFovMultiplier);
 *  - a barra de pulo da montaria mostra o fôlego (setRideBar = stamina).
 * No Bedrock a tecla de correr não chega ao script com o jogador montado (provado no BDS, pesquisa 8 §2): o gatilho
 * que funciona em teclado, controle (analógico) e toque é o duplo toque para frente, o mesmo do Java.
 */

/** Timer do duplo toque (sprintTimerTickLength = 7, "Emulate vanillas tick timer length"). */
export const SPRINT_DOUBLE_TAP_TICKS = 7;
/** Fôlego mínimo para rearmar o sprint depois de zerar. */
export const SPRINT_REARM_STAMINA = 0.33;
/** rideFovMultiplier correndo. */
export const SPRINT_FOV_MULTIPLIER = 1.15;
/** Limiar do vetor de movimento para "frente apertada" (teclado = 1; analógico e joystick de toque proporcionais). */
export const SPRINT_FORWARD_THRESHOLD = 0.5;
/** Controlador que tem sprint no Cobblemon (só o HorseBehaviour). */
export const SPRINT_RIDE_KEY = "cobblemon:land/horse";

export interface SprintState {
  forwardHeldLastTick: boolean;
  sprintTickTimer: number;
  sprinting: boolean;
  sprintToggleable: boolean;
  /** 0..1 */
  stamina: number;
}

export function newSprintState(): SprintState {
  return { forwardHeldLastTick: false, sprintTickTimer: 0, sprinting: false, sprintToggleable: false, stamina: 1 };
}

export interface SprintInput {
  /** Frente apertada neste tick (getMovementVector().y acima do limiar). */
  forward: boolean;
  /** Tecla/botão de correr (player.isSprinting, se o motor informar montado). */
  sprintKey: boolean;
}

/** HorseBehaviour.handleSprinting — um tick. Muda `state` e devolve se houve duplo toque neste tick. */
export function stepSprint(state: SprintState, input: SprintInput): boolean {
  let doubleTapped = false;
  if (!state.forwardHeldLastTick && input.forward && !state.sprinting && state.sprintTickTimer === 0) {
    state.sprintTickTimer = SPRINT_DOUBLE_TAP_TICKS;
  }
  else if (!state.forwardHeldLastTick && input.forward && state.sprintTickTimer !== 0) {
    doubleTapped = true;
  }
  else if (!state.sprinting && state.sprintTickTimer > 0) {
    state.sprintTickTimer -= 1;
  }
  else {
    state.sprintTickTimer = 0;
  }

  const tryingToSprint = (input.sprintKey && input.forward) || doubleTapped;

  if (state.stamina <= 0 || !input.forward) {
    state.sprinting = false;
    if (state.stamina <= 0) state.sprintToggleable = false;
  }
  else if (!state.sprinting && !state.sprintToggleable && state.stamina > SPRINT_REARM_STAMINA) {
    state.sprintToggleable = true;
  }
  else if (tryingToSprint && state.sprintToggleable) {
    state.sprinting = true;
  }
  state.forwardHeldLastTick = input.forward;
  return doubleTapped;
}

/**
 * HorseBehaviour.tickStamina — um tick. `staminaSeconds` = staminaExpr (q.get_ride_stats('STAMINA', 'LAND', 240, 4));
 * `infinite` = infiniteStamina da espécie/config.
 */
export function stepStamina(state: SprintState, staminaSeconds: number, infinite = false): void {
  if (infinite || !(staminaSeconds > 0)) return;
  const drain = 1 / staminaSeconds / 20;
  const next = state.sprinting ? Math.max(0, state.stamina - drain) : Math.min(1, state.stamina + drain * 8);
  state.stamina = Math.min(1, Math.max(0, next));
}

/** q.get_ride_stats(stat, style, max, min): min + (max − min) × valor / 100. */
export function rideStatLerp(max: number, min: number, value: number): number {
  return min + ((max - min) / 100) * value;
}

/**
 * Próximo valor do `minecraft:movement` da montaria: anda até `target` (topo correndo, andar senão) com a
 * aceleração do Cobblemon — `accelSeconds` segundos para ir de 0 ao topo correndo; 0,5 s andando. Desacelerar
 * (soltar o sprint) volta no mesmo passo do andar, como a velocidade do HorseBehaviour caindo para o walkSpeed.
 */
export function stepSpeed(current: number, walk: number, top: number, sprinting: boolean, accelSeconds: number): number {
  const target = sprinting ? top : walk;
  const ticks = Math.max(1, (sprinting ? accelSeconds : 0.5) * 20);
  const step = Math.max(1e-4, (sprinting ? top : Math.max(walk, top)) / ticks);
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

/**
 * Andar montado sem sprint (HorseBehaviour.getWalkSpeed = walkSpeed × MOVEMENT_SPEED (0,7, padrão do atributo) ×
 * 1,2 × 0,35 b/tick), convertido para o `minecraft:movement` com a fórmula do importador (b/tick × 20 / 43). Sem o
 * antigo × 0,8: no Java a velocidade do HorseBehaviour é o deslocamento por tick (PokemonEntity.travel), e o 43 já é a
 * razão b/s por unidade de movement medida no BDS. Usado também pelo importador (montaria `horse` sem sprint).
 * `walkSpeed` = behaviour.moving.walk.walkSpeed da espécie (padrão do WalkBehaviour: 0,35).
 */
export const JAVA_DEFAULT_WALK_SPEED = 0.35;
export function walkMovementValue(walkSpeed = JAVA_DEFAULT_WALK_SPEED): number {
  const blocksPerTick = (Number.isFinite(walkSpeed) && walkSpeed > 0 ? walkSpeed : JAVA_DEFAULT_WALK_SPEED) * 0.7 * 1.2 * 0.35;
  return Math.round(((blocksPerTick * 20) / 43) * 1000) / 1000;
}

/** Segundos de fôlego (staminaExpr) e de aceleração (accelerationExpr) a partir dos atributos com ride boosts. */
export function sprintStaminaSeconds(stamina: number): number { return rideStatLerp(240, 4, stamina); }
export function sprintAccelerationSeconds(acceleration: number): number { return Math.max(0.1, rideStatLerp(0.1, 12, acceleration)); }

/** FOV absoluto correndo (a API só aceita valor absoluto; `base` = FOV suposto do jogador). */
export function sprintFov(base: number): number {
  return Math.round(base * SPRINT_FOV_MULTIPLIER * 10) / 10;
}

/**
 * Barra de fôlego (setRideBar do HorseBehaviour: a barra de pulo da montaria mostra o fôlego). Mesmo desenho da
 * barra do voo (10 blocos): amarela correndo, vermelha zerada até rearmar, verde recuperando.
 */
export function sprintBar(stamina: number, sprinting: boolean, toggleable = true): string {
  const filled = Math.round(Math.max(0, Math.min(1, stamina)) * 10);
  const color = sprinting ? "§e" : !toggleable && stamina <= SPRINT_REARM_STAMINA ? "§c" : "§a";
  return `${color}${"■".repeat(filled)}§8${"■".repeat(10 - filled)}`;
}
