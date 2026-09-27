import { Dimension, DimensionLocation, Entity, Player, system, Vector3 } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { setBeamTint } from "../pokemon/BeamTint";

/**
 * Envio e recolha com animação em batalha (Pokemon.sendOutWithAnimation, PokemonEntity.recallWithAnimation e o
 * PokemonClientDelegate/PokemonRenderer do cliente do Cobblemon 1.8.2):
 *
 * Envio (beamMode 1): quem manda arremessa (`poke_ball.throw`), a bola da espécie voa `POKEBALL_AIR_TIME` = 0,5 s
 * até o ponto (`poke_ball.trail`), estoura com as partículas da bola (`<bola>/<battle|casual>/sendflash`, depois
 * `ballsparks` + `ballsendsparkle` e, 0,4 s depois, `<bola>/ballsparkle`), toca `poke_ball.send_out`
 * (`shiny_send_out` para shiny) e o Pokémon cresce de 0 ao tamanho em `BEAM_SHRINK_TIME` = 0,4 s. O envio termina
 * em `SEND_OUT_DURATION` = 1,5 s (grito, se `doCry`).
 *
 * Recolha (beamMode 3): feixe vermelho (1; 0,1; 0,1) de quem recolhe até o Pokémon, que encolhe de 0,2 s a 0,6 s;
 * a entidade some e a recolha termina em 1,5 s.
 *
 * No Bedrock: a bola é a entidade `cobblemon:<bola>_dummy` movida por teleporte a cada tick; o feixe é uma linha
 * de partículas `cobblemon:recall_beam` (textura `phase_beam` do Cobblemon); o tamanho anima pela propriedade
 * `cobblemon:scale_modifier` (a mesma que o `scale` do cliente lê).
 */

export const THROW_DURATION = 0.5;
export const POKEBALL_AIR_TIME = 0.5;
export const SEND_OUT_DURATION = 1.5;
export const BEAM_EXTEND_TIME = 0.2;
export const BEAM_SHRINK_TIME = 0.4;
export const SEND_OUT_STAGGER_BASE_DURATION = 0.35;
export const SEND_OUT_STAGGER_RANDOM_MAX_DURATION = 0.15;

const SCALE_PROPERTY = "cobblemon:scale_modifier";
const MIN_SCALE = 0.05;

function valid(entity: Entity | undefined): entity is Entity {
  try { return !!entity?.isValid; } catch { return false; }
}

function ticks(seconds: number) {
  return Math.max(1, Math.round(seconds * 20));
}

/**
 * Nome da bola sem namespace ("cobblemon:poke_ball" → "poke_ball"; aceita a forma compacta "pokeball"). Local
 * (sem importar catching/PokeBalls: StandardModifiers importa a batalha e fecharia um ciclo de módulos).
 */
export function pokeBallName(id: string): string {
  const plain = id.replace(/^[a-z0-9_.-]+:/, "").replace(/_dummy$/, "");
  if (plain.includes("_")) return plain;
  return plain.replace(/^ancient(?=.)/, "ancient_").replace(/(?<!_)ball$/, "_ball");
}

/** Nome da bola nas pastas de partícula do Cobblemon (`caughtBall.name.path` sem "_": poke_ball → pokeball). */
export function ballParticleName(pokeball: string | undefined): string {
  return pokeBallName(pokeball ?? "poke_ball").replace(/_/g, "");
}

function spawnParticle(dimension: Dimension, id: string, at: Vector3) {
  try { dimension.spawnParticle(id, at); } catch { /* partícula ausente (bola sem pasta própria) */ }
}

/**
 * Partículas de envio da bola no ponto em que ela estoura (PokemonClientDelegate, beamMode 1). `mode` = "battle"
 * em batalha, "casual" fora dela (API para o envio fora de batalha, frente captura).
 */
export function playBallSendOutParticles(dimension: Dimension, at: Vector3, pokeball: string | undefined, mode: "battle" | "casual") {
  const ball = ballParticleName(pokeball);
  // As partículas já têm o deslocamento de 0,5 para cima no emissor.
  spawnParticle(dimension, `cobblemon:${ball}_${mode}_sendflash`, at);
  system.runTimeout(() => {
    spawnParticle(dimension, `cobblemon:${ball}_${mode}_ballsparks`, at);
    spawnParticle(dimension, `cobblemon:${ball}_${mode}_ballsendsparkle`, at);
  }, 1);
  system.runTimeout(() => spawnParticle(dimension, `cobblemon:${ball}_ballsparkle`, at), ticks(0.4) + 1);
}

/**
 * De onde sai a bola/feixe (PokemonRenderer: olhos − 0,4 e 0,3 para o lado da mão do jogador; olhos − 0,7 e 0,4
 * para outras entidades).
 */
export function throwSource(thrower: Entity): Vector3 {
  let head: Vector3;
  try { head = thrower.getHeadLocation(); } catch { head = { x: thrower.location.x, y: thrower.location.y + 1.5, z: thrower.location.z }; }
  let yaw = 0;
  try { yaw = (thrower.getRotation().y * Math.PI) / 180; } catch { }
  // Direita do olhar no Bedrock: (-cos(yaw), -sin(yaw)) → o lado da mão (o Cobblemon subtrai o vetor girado 90°).
  const isPlayer = thrower instanceof Player;
  const side = isPlayer ? 0.3 : 0.4;
  const down = isPlayer ? 0.4 : 0.7;
  return { x: head.x - Math.cos(yaw) * side, y: head.y - down, z: head.z - Math.sin(yaw) * side };
}

/** Yaw (graus, convenção do Bedrock) de `from` olhando para `to`. */
export function yawTowards(from: Vector3, to: Vector3): number {
  const yaw = (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
  return Number.isFinite(yaw) ? yaw : 0;
}

/** Escala atual da propriedade (ou 1). */
function scaleOf(entity: Entity): number {
  try {
    const value = entity.getProperty(SCALE_PROPERTY);
    return typeof value === "number" && value > 0 ? value : 1;
  }
  catch {
    return 1;
  }
}

function setScale(entity: Entity, value: number) {
  try { entity.setProperty(SCALE_PROPERTY, Math.max(MIN_SCALE, Math.min(3.5, value))); } catch { }
}

/**
 * Interpola a escala da entidade de `from` a `to` (fatores da escala final) em `seconds`, começando daqui a
 * `delayTicks`. `getEntity` é consultado a cada passo (a entidade que aparece pode mudar: Illusion).
 */
export function lerpScale(getEntity: () => Entity | undefined, target: number, from: number, to: number, seconds: number, delayTicks = 0) {
  const total = ticks(seconds);
  for (let i = 0; i <= total; i++) {
    const run = () => {
      const entity = getEntity();
      if (!valid(entity)) return;
      const t = i / total;
      setScale(entity, target * (from + (to - from) * t));
    };
    if (delayTicks + i <= 0) run();
    else system.runTimeout(run, delayTicks + i);
  }
}

export interface SendOutJob {
  /** O envio terminou (SEND_OUT_DURATION depois de começar). */
  done: boolean;
  /** A entidade do Pokémon (existe depois que a bola estoura). */
  entity?: Entity;
  /** Cancelado antes da bola chegar (batalha acabou, quem arremessou sumiu). */
  cancelled?: boolean;
}

export interface SendOutOptions {
  /** Quem arremessa (jogador, NPC). Sem ele (ou inválido) o Pokémon aparece direto. */
  thrower: Entity | undefined;
  /** Dono (jogador) passado ao `PokemonData.sendOut`. */
  owner: Player | undefined;
  pokemon: PokemonData;
  location: DimensionLocation;
  /** Para onde o Pokémon olha ao chegar (o oponente); sem isso, para quem arremessou. */
  facing?: Vector3;
  mode?: "battle" | "casual";
  /** Espera antes do arremesso (escalonamento do começo da batalha), em segundos. */
  delay?: number;
  /** Chamado quando a entidade aparece (Illusion, balsa, marcas de batalha); pode trocar a entidade que aparece. */
  onSpawn?: (entity: Entity) => Entity | void;
  /** Chamado em SEND_OUT_DURATION (grito etc.). */
  onDone?: (entity: Entity | undefined) => void;
  /** Consultado antes da bola estourar: falso cancela (a bola some, o Pokémon não sai; `onDone(undefined)` no tick seguinte). */
  stillValid?: () => boolean;
  /**
   * Escala final da entidade que aparece (a devolvida pelo `onSpawn`, ex. disfarce de Illusion). Sem isso: a escala
   * efetiva dos dados do Pokémon enviado. Vem dos dados porque a propriedade gravada no mesmo tick pode não ser lida.
   */
  targetScale?: (visual: Entity) => number | undefined;
}

/** Escala final do envio pelos dados (a propriedade acabou de ser gravada e pode ainda não refletir o valor). */
function sendOutTargetScale(options: SendOutOptions, visual: Entity, entity: Entity): number {
  try {
    const fromOption = options.targetScale?.(visual);
    if (typeof fromOption === "number" && fromOption > 0) return fromOption;
    if (visual === entity) {
      const fromData = options.pokemon.getEffectiveScale();
      if (typeof fromData === "number" && fromData > 0) return fromData;
    }
  }
  catch { }
  return scaleOf(visual);
}

/** Arremessa a bola e manda o Pokémon para o ponto (sendOutWithAnimation). */
export function animatedSendOut(options: SendOutOptions): SendOutJob {
  const job: SendOutJob = { done: false };
  const delay = Math.max(0, Math.round((options.delay ?? 0) * 20));
  const begin = () => {
    const { thrower, location } = options;
    const dimension = location.dimension;
    const hasThrower = valid(thrower) && thrower.dimension.id === dimension.id;
    const source = hasThrower ? throwSource(thrower!) : { x: location.x, y: location.y + 1, z: location.z };
    // A bola estoura um pouco antes do ponto, na direção de quem arremessou (sendOutOffset).
    const dx = source.x - location.x, dz = source.z - location.z;
    const horizontal = Math.hypot(dx, dz) || 1;
    const back = Math.min(1, horizontal * 0.2);
    const burst = { x: location.x + (dx / horizontal) * back, y: location.y, z: location.z + (dz / horizontal) * back };
    const end = { x: burst.x, y: burst.y + 0.9, z: burst.z };
    let ball: Entity | undefined;
    if (hasThrower) {
      try { dimension.playSound("cobblemon.poke_ball.throw", source, { volume: 0.6 }); } catch { }
      try {
        ball = dimension.spawnEntity(`cobblemon:${pokeBallName(options.pokemon.pokeball ?? "poke_ball")}_dummy`, source);
      }
      catch { ball = undefined; }
    }
    const air = ticks(POKEBALL_AIR_TIME);
    if (ball) {
      const height = 0.6 + Math.min(2, Math.hypot(end.x - source.x, end.z - source.z) * 0.08);
      let tick = 0;
      const run = system.runInterval(() => {
        tick++;
        if (!valid(ball) || tick >= air) {
          system.clearRun(run);
          return;
        }
        const t = tick / air;
        const at = {
          x: source.x + (end.x - source.x) * t,
          y: source.y + (end.y - source.y) * t + 4 * height * t * (1 - t),
          z: source.z + (end.z - source.z) * t,
        };
        try { ball!.teleport(at); } catch { }
        if (tick === 2) {
          try { dimension.playSound("cobblemon.poke_ball.trail", at, { volume: 0.1 }); } catch { }
        }
      }, 1);
    }
    const land = () => {
      if (ball) {
        try { ball.remove(); } catch { try { ball.triggerEvent("cobblemon:instant_kill"); } catch { } }
      }
      if (options.stillValid && !options.stillValid()) {
        job.cancelled = true;
        job.done = true;
        // Quem espera o fim do envio (fila da batalha, trava do envio casual) também é avisado no cancelamento.
        system.runTimeout(() => {
          try { options.onDone?.(undefined); } catch (e) { console.warn(`Envio com animação (onDone): ${e}`); }
        }, 1);
        return;
      }
      let entity: Entity | undefined;
      try {
        entity = options.pokemon.sendOut(options.owner, location);
      }
      catch (e) {
        console.warn(`Envio com animação falhou: ${e}`);
      }
      job.entity = entity;
      if (valid(entity)) {
        const face = options.facing ?? (hasThrower ? thrower!.location : undefined);
        if (face) {
          try { entity.setRotation({ x: 0, y: yawTowards(entity.location, face) }); } catch { }
        }
        let visual: Entity = entity;
        try {
          const replaced = options.onSpawn?.(entity);
          if (replaced) visual = replaced;
        }
        catch (e) {
          console.warn(`Envio com animação (onSpawn): ${e}`);
        }
        if (hasThrower) {
          playBallSendOutParticles(dimension, { x: burst.x, y: burst.y, z: burst.z }, options.pokemon.pokeball, options.mode ?? "battle");
          // Cresce de 0 ao tamanho em BEAM_SHRINK_TIME (activeSendoutScale).
          const target = sendOutTargetScale(options, visual, entity);
          setScale(visual, target * MIN_SCALE);
          lerpScale(() => visual, target, MIN_SCALE, 1, BEAM_SHRINK_TIME, 1);
        }
      }
      const rest = ticks(SEND_OUT_DURATION) - (hasThrower ? air : 0);
      system.runTimeout(() => {
        job.done = true;
        try { options.onDone?.(job.entity); } catch (e) { console.warn(`Envio com animação (onDone): ${e}`); }
      }, Math.max(1, rest));
    };
    if (hasThrower) system.runTimeout(land, air);
    else land();
  };
  if (delay > 0) system.runTimeout(begin, delay);
  else begin();
  return job;
}

export interface RecallJob {
  /** A entidade já saiu de campo (fim do encolhimento, BEAM_EXTEND + BEAM_SHRINK). */
  removed: boolean;
  /** A recolha terminou (SEND_OUT_DURATION). */
  done: boolean;
}

/**
 * Recolhe com feixe (recallWithAnimation). `visual` é a entidade que aparece (a de exibição em Illusion);
 * `remove` tira o Pokémon de campo (PokemonData.return / instant_kill) no fim do encolhimento.
 */
export function animatedRecall(entity: Entity, visual: Entity | undefined, recaller: Entity | undefined, remove: () => void): RecallJob {
  const job: RecallJob = { removed: false, done: false };
  const shown = valid(visual) ? visual : entity;
  // beamMode 3: tinta vermelha no cliente (0,2 s depois, junto com o encolhimento).
  setBeamTint(shown, true);
  const extend = ticks(BEAM_EXTEND_TIME);
  const shrink = ticks(BEAM_SHRINK_TIME);
  const hasRecaller = valid(recaller) && recaller.dimension.id === entity.dimension.id;
  // Feixe: linha de partículas de quem recolhe até o meio do Pokémon, renovada a cada 2 ticks.
  if (hasRecaller) {
    for (let t = 0; t < extend + shrink; t += 2) {
      system.runTimeout(() => {
        if (!valid(shown) || !valid(recaller)) return;
        const from = throwSource(recaller!);
        let height = 1;
        try { height = Math.max(0.3, shown.getHeadLocation().y - shown.location.y); } catch { }
        const to = { x: shown.location.x, y: shown.location.y + height / 2, z: shown.location.z };
        const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
        if (distance > 20) return;
        // O feixe cresce em BEAM_EXTEND_TIME.
        const reach = Math.min(1, (t + 1) / extend);
        const steps = Math.min(24, Math.max(4, Math.ceil(distance * 3)));
        for (let i = 0; i <= steps; i++) {
          const k = (i / steps) * reach;
          spawnParticle(shown.dimension, "cobblemon:recall_beam", { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k });
        }
      }, Math.max(1, t));
    }
  }
  // Encolhe de 1 a 0 depois de BEAM_EXTEND_TIME.
  if (valid(shown)) lerpScale(() => valid(shown) ? shown : undefined, scaleOf(shown), 1, MIN_SCALE, BEAM_SHRINK_TIME, extend);
  system.runTimeout(() => {
    job.removed = true;
    try { remove(); } catch (e) { console.warn(`Recolha com animação falhou: ${e}`); }
  }, extend + shrink + 1);
  system.runTimeout(() => { job.done = true; }, ticks(SEND_OUT_DURATION));
  return job;
}
