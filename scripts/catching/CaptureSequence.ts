/**
 * Sequência visual e lógica da captura no mundo, port de `EmptyPokeBallEntity.attemptCatch`, `beginCapture`,
 * `shakeBall`, `breakFree` e `BattleCaptureAction` (Cobblemon 1.8.2).
 *
 * Linha do tempo (a partir do acerto): 0 s som de acerto e a bola quica para trás; 0,2 s abre; 0,7 s para no
 * ar e "puxa" o Pokémon (partículas); 1,95 s fecha; 2,2 s o Pokémon some e a bola cai; ao pousar calcula a
 * captura e segue buildCaptureTimeline (1 s até a 1ª sacudida, 1,25 s entre elas).
 *
 * Sem acesso ao cliente: a bola é movida por teleporte a cada tick e as animações do client entity
 * (`animation.poke_ball.*` / `animation.ancient_poke_ball.*`) tocadas com `playAnimation`. Os sons e partículas que
 * no Cobblemon vêm dessas animações (e do PokemonRenderer: feixe vermelho, encolhimento, sendflash ao escapar) são
 * tocados aqui com os ids do Cobblemon (frente visual-final, #101).
 */
import { Entity, GameMode, ItemStack, Player, Vector3, system } from "@minecraft/server";
import { PokemonData, SHINY_TAG, playShinyRing } from "../Pokemon";
import { renderCaptureMessage, message } from "../language";
import { getSafeTeam, storePokemonInFirstSpace } from "../pokemonStorage";
import { tryGetBattleFromEntity, PokemonBattle, BattleActor, ActivePokemon } from "../battle";
import { ForcePassActionResponse } from "../battle/ActionResponse";
import { findMockOf } from "../battle/effects/Mock";
import { ballParticleName } from "../battle/SendOut";
import { PokeBall, applyCaptureEffects } from "./PokeBalls";
import { ASPECTS_REMOVED_ON_CAPTURE } from "./CaptureEffects";
import { CaptureContext } from "./CaptureCalculator";
import { CAPTURE_TIMINGS, CaptureStep, animationGroup, buildCaptureTimeline } from "./CaptureTimeline";
import { markCaught } from "../pokedex/PokedexStorage";
import { applyPotentialMarks } from "../pokemon/Marks";
import { recordCapture, recordFlag } from "../pokedex/Progress";
import { onPokemonCapturedWallpapers } from "../GUI/PCWallpapers";
import { toSpeciesId } from "../speciesData";
import { MOUTH_ITEM_PROPERTY } from "../spawning/Despawner";
import { giveHeldItemIfEmpty } from "../pokemon/HeldItemStore"; // item segurado só nos dados
import { setBeamTint } from "../pokemon/BeamTint";
import { CobblemonEvents } from "../events/CobblemonEvents"; // frente msd-fase4: POKEMON_CAPTURED

/**
 * Sons do Cobblemon (EmptyPokeBallEntity e as animações `poke_ball`/`ancient_poke_ball`), com os ids `cobblemon.*`
 * que o importador grava no sound_definitions.json (frente visual-final, #101: antes eram os ids sem prefixo do
 * CobbleBuild).
 */
export const CAPTURE_SOUNDS = {
  hit: "cobblemon.poke_ball.hit",
  open: "cobblemon.poke_ball.open",
  shut: "cobblemon.poke_ball.shut",
  recall: "cobblemon.poke_ball.recall",
  shake: "cobblemon.poke_ball.shake",
  critical: "cobblemon.poke_ball.shake.critical",
  captured: "cobblemon.poke_ball.capture_succeeded",
  breakFree: "cobblemon.poke_ball.break",
  bounceOnBlock: "cobblemon.poke_ball.bounce",
  /** Só nas ancient: a bola cai no fim de cada pulo (smallhop/midhop/bighop/weirdhop). */
  landAncient: "cobblemon.poke_ball.land.ancient",
};

/**
 * Sons com variante `.ancient` nas animações da ancient_poke_ball (open, shut, bounce, break, capture e o
 * `shake.ancient` dos pulos). `shake.critical` não tem variante (a animação `critical` da ancient usa o comum).
 */
const ANCIENT_SOUND_VARIANTS = new Set([
  CAPTURE_SOUNDS.open, CAPTURE_SOUNDS.shut, CAPTURE_SOUNDS.bounceOnBlock, CAPTURE_SOUNDS.breakFree,
  CAPTURE_SOUNDS.captured, CAPTURE_SOUNDS.shake,
]);

/** Som da bola: a variante `.ancient` quando existir para bolas ancient. */
export function captureSound(sound: string, ancient?: boolean): string {
  return ancient && ANCIENT_SOUND_VARIANTS.has(sound) ? `${sound}.ancient` : sound;
}

/** Locators de partícula da bola (poke_ball.geo: bola de 8 px; `center_particles` y=4, `top_particles` y=8). */
export const BALL_LOCATOR_OFFSET = { center: 0.25, top: 0.5 };

/** Efeito com tempo de uma animação da bola (sound_effects/particle_effects do Cobblemon). */
export interface BallEffect {
  /** Ticks depois do início da animação. */
  tick: number;
  sound?: string;
  particle?: string;
  locator?: keyof typeof BALL_LOCATOR_OFFSET;
}

const secondsToTicks = (seconds: number) => Math.round(seconds * 20);

/** Instante (s) em que a ancient pousa de novo em cada pulo (sound_effects `poke_ball.land.ancient`). */
export const ANCIENT_HOP_LAND: Readonly<Record<string, number>> = {
  smallhop1: 0.75, smallhop2: 0.75, midhop1: 0.8333, midhop2: 0.7917, bighop: 0.9167, weirdhop: 1.0833,
};

/**
 * Sons e partículas de cada passo da captura, tirados das animações do Cobblemon 1.8.2
 * (`bedrock/poke_balls/animations/*.animation.json`):
 * - `critical`: `shake.critical`; `bounce`: `bounce`(.ancient); `bob1..6`: `shake`;
 * - pulos da ancient: `shake.ancient`, fumaça `ancient_pokeball_smoke` no topo e `land.ancient` ao pousar;
 * - `capture`: `capture_succeeded` (0,034 s), `capturesparks` + `capturestar` (0,0417 s) e `afterspark` (0,125 s)
 *   no centro; a ancient: `capture_succeeded.ancient` (0 s) e hisuisendspark 0,0417 / hisuipuff 0,0833 /
 *   hisuitrail 0,125 / hisuispark + hisuicapturestar 0,4583 / hisuiafterspark 0,5 s no topo;
 * - `break`: `break`(.ancient), sem partícula.
 * @param animation a animação escolhida (ex.: "animation.ancient_poke_ball.midhop2").
 */
export function captureStepEffects(kind: CaptureStep["kind"], ancient: boolean, animation?: string): BallEffect[] {
  const at = (seconds: number, effect: Omit<BallEffect, "tick">): BallEffect => ({ tick: secondsToTicks(seconds), ...effect });
  switch (kind) {
    case "critical":
      return [at(0, { sound: CAPTURE_SOUNDS.critical })];
    case "bounce":
      return [at(0, { sound: captureSound(CAPTURE_SOUNDS.bounceOnBlock, ancient) })];
    case "shake": {
      if (!ancient) return [at(0, { sound: CAPTURE_SOUNDS.shake })];
      const hop = animation?.split(".").pop() ?? "";
      const effects = [
        at(0, { sound: captureSound(CAPTURE_SOUNDS.shake, true) }),
        at(0, { particle: "cobblemon:ancient_pokeball_smoke", locator: "top" }),
      ];
      if (ANCIENT_HOP_LAND[hop] !== undefined) effects.push(at(ANCIENT_HOP_LAND[hop], { sound: CAPTURE_SOUNDS.landAncient }));
      return effects;
    }
    case "success":
      if (ancient) return [
        at(0, { sound: captureSound(CAPTURE_SOUNDS.captured, true) }),
        at(0.0417, { particle: "cobblemon:hisuisendspark", locator: "top" }),
        at(0.0833, { particle: "cobblemon:hisuipuff", locator: "top" }),
        at(0.125, { particle: "cobblemon:hisuitrail", locator: "top" }),
        at(0.4583, { particle: "cobblemon:hisuispark", locator: "top" }),
        at(0.4583, { particle: "cobblemon:hisuicapturestar", locator: "top" }),
        at(0.5, { particle: "cobblemon:hisuiafterspark", locator: "top" }),
      ];
      return [
        at(0.034, { sound: CAPTURE_SOUNDS.captured }),
        at(0.0417, { particle: "cobblemon:capturesparks", locator: "center" }),
        at(0.0417, { particle: "cobblemon:capturestar", locator: "center" }),
        at(0.125, { particle: "cobblemon:afterspark", locator: "center" }),
      ];
    case "break_free":
      return [at(0, { sound: captureSound(CAPTURE_SOUNDS.breakFree, ancient) })];
  }
  return [];
}

/** Ações de captura em andamento por batalha (BattleCaptureAction). */
export interface BattleCaptureAction {
  battle: PokemonBattle;
  thrower: BattleActor;
  target: ActivePokemon;
  ballEntity: Entity;
}

/** Ganchos opcionais que a frente de batalhas expõe (pedido em docs/pendencias/captura.md). */
interface CaptureAwareBattle {
  captureActions?: BattleCaptureAction[];
  finishCaptureAction?(action: BattleCaptureAction): void;
  captureSucceeded?(action: BattleCaptureAction): void;
}

export interface CaptureAttempt {
  thrower: Player;
  ballEntity: Entity;
  target: Entity;
  ball: PokeBall;
  /** Calcula o resultado na hora do pouso (processCapture). */
  calculate: () => CaptureContext;
  battleAction?: BattleCaptureAction;
  /** Escala do Pokémon antes do feixe (preenchida pela sequência; restaurada ao escapar). */
  originalScale?: { entity: Entity; value: number };
  /** Entidade com a tinta vermelha do feixe ligada (desligada ao escapar ou no fim da sequência). */
  tinted?: Entity;
}

function waitTicks(ticks: number): Promise<void> {
  return new Promise(resolve => system.runTimeout(() => resolve(), Math.max(1, Math.round(ticks))));
}

function safe(action: () => void) {
  try { action(); } catch { }
}

function playSound(entity: Entity, sound: string, volume = 1, pitch = 1) {
  safe(() => entity.dimension.playSound(sound, entity.location, { volume, pitch }));
}

/** Uma das animações candidatas (bob1..6, midhop1/2...). */
function pickAnimation(animations: string[]): string | undefined {
  if (animations.length === 0) return undefined;
  return animations[Math.floor(Math.random() * animations.length)];
}

function playAnimation(entity: Entity, animations: string[]) {
  const animation = pickAnimation(animations);
  if (animation) safe(() => entity.playAnimation(animation));
}

function spawnParticle(entity: Entity, particle: string, location: Vector3) {
  safe(() => entity.dimension.spawnParticle(particle, location));
}

/** Toca os efeitos (sons/partículas) de uma animação da bola no tempo de cada um. */
function playBallEffects(ball: Entity, effects: BallEffect[]) {
  for (const effect of effects) {
    const run = () => {
      if (!ball.isValid) return;
      if (effect.sound) playSound(ball, effect.sound);
      if (effect.particle) spawnParticle(ball, effect.particle, add(ball.location, { x: 0, y: BALL_LOCATOR_OFFSET[effect.locator ?? "center"], z: 0 }));
    };
    if (effect.tick <= 0) run();
    else system.runTimeout(run, effect.tick);
  }
}

/** Propriedade de escala do cliente (a mesma do envio/recolha da frente visual-batalha). */
const SCALE_PROPERTY = "cobblemon:scale_modifier";
const MIN_SCALE = 0.05;

function readScale(entity: Entity): number | undefined {
  try {
    const value = entity.getProperty(SCALE_PROPERTY);
    return typeof value === "number" ? value : undefined;
  }
  catch { return undefined; }
}

function writeScale(entity: Entity, value: number) {
  safe(() => entity.setProperty(SCALE_PROPERTY, Math.max(MIN_SCALE, Math.min(3.5, value))));
}

/**
 * Interpolação de escala em andamento por entidade (id → número do trabalho). Um trabalho novo, o restoreScale ou o
 * breakFree invalidam os timeouts pendentes do anterior: sem isso, uma captura abortada no começo do raio deixava o
 * encolhimento agendado (+4 a +12 ticks) escrever depois do crescimento do breakFree e a escala ficava em 0,05.
 */
const scaleJobs = new Map<string, number>();
let nextScaleJob = 0;

function entityKey(entity: Entity): string | undefined {
  try { return entity.id; }
  catch { return undefined; }
}

/** Cancela a interpolação pendente da entidade (os timeouts já agendados deixam de escrever). */
function cancelScale(entity: Entity) {
  const key = entityKey(entity);
  if (key !== undefined) scaleJobs.delete(key);
}

/** Interpola a escala de `from` a `to` (fatores de `base`) em `ticks`, começando daqui a `delay` ticks. */
function lerpScale(entity: Entity, base: number, from: number, to: number, ticks: number, delay = 0) {
  const key = entityKey(entity);
  const job = ++nextScaleJob;
  if (key !== undefined) scaleJobs.set(key, job);
  const current = () => key === undefined || scaleJobs.get(key) === job;
  for (let i = 0; i <= ticks; i++) {
    system.runTimeout(() => {
      if (!current()) return;
      if (entity.isValid) writeScale(entity, base * (from + (to - from) * (i / ticks)));
      if (i === ticks && key !== undefined) scaleJobs.delete(key);
    }, Math.max(1, delay + i));
  }
}

const add = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const lerp = (a: Vector3, b: Vector3, t: number): Vector3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** Centro aproximado do Pokémon (para o "raio" da bola). */
function centerOf(entity: Entity): Vector3 {
  try {
    const head = entity.getHeadLocation();
    return lerp(entity.location, head, 0.5);
  }
  catch {
    return add(entity.location, { x: 0, y: 0.5, z: 0 });
  }
}

/** A captura ainda pode continuar (dono e alvo existem). */
function stillValid(attempt: CaptureAttempt): boolean {
  return attempt.ballEntity.isValid && attempt.target.isValid && attempt.thrower.isValid;
}

/**
 * Ids das bolas com captura em andamento (só em memória). O `entityLoad` do main.ts consulta isto para não matar
 * uma bola em captura como se fosse uma bola velha carregada do disco.
 */
const activeCaptureBalls = new Set<string>();

/** A entidade é a bola de uma captura em andamento nesta sessão do script. */
export function isCaptureInProgress(entity: Entity): boolean {
  try { return activeCaptureBalls.has(entity.id); }
  catch { return false; }
}

/** Qual parte da captura ficou inválida (para o aviso no log). */
function describeInvalid(attempt: CaptureAttempt): string {
  const parts: string[] = [];
  if (!attempt.ballEntity.isValid) parts.push("bola");
  if (!attempt.target.isValid) parts.push("alvo");
  if (!attempt.thrower.isValid) parts.push("lançador");
  return parts.join(", ") || "nenhuma";
}

/** Só a bola sumiu (alvo e lançador continuam): dá para terminar a captura sem ela. */
function onlyBallLost(attempt: CaptureAttempt): boolean {
  return !attempt.ballEntity.isValid && attempt.target.isValid && attempt.thrower.isValid;
}

/** Devolve a bola ao inventário do lançador (fora do criativo) quando a captura abortou antes do cálculo. */
function refundBall(attempt: CaptureAttempt) {
  const { thrower, ball } = attempt;
  try {
    if (!thrower.isValid || thrower.getGameMode() === GameMode.Creative) return;
    const item = new ItemStack(ball.id, 1);
    const leftover = thrower.getComponent("minecraft:inventory")?.container?.addItem(item);
    if (leftover) thrower.dimension.spawnItem(leftover, thrower.location);
  }
  catch (e) { console.warn(`Não foi possível devolver a Poké Bola: ${e}`); }
}

function faceTarget(attempt: CaptureAttempt, location: Vector3) {
  const facing = attempt.target.isValid ? attempt.target.location : undefined;
  safe(() => attempt.ballEntity.teleport(location, facing ? { facingLocation: { x: facing.x, y: location.y, z: facing.z } } : undefined));
}

/** attemptCatch: quique para trás (±60°), 0,7 s de voo com gravidade de arremessável. */
async function bounceBack(attempt: CaptureAttempt, hitVelocity: Vector3) {
  const start = attempt.ballEntity.location;
  const length = Math.hypot(hitVelocity.x, hitVelocity.z) || 1;
  // -velocidade horizontal normalizada, girada ±60° (yRot(mul * PI/3)).
  const angle = (Math.random() < 0.5 ? 1 : -1) * Math.PI / 3;
  const bx = -hitVelocity.x / length, bz = -hitVelocity.z / length;
  const dir = { x: bx * Math.cos(angle) + bz * Math.sin(angle), z: -bx * Math.sin(angle) + bz * Math.cos(angle) };
  const gravity = 0.03, vy = 1 / 3, horizontal = 0.1;
  for (let t = 1; t <= CAPTURE_TIMINGS.beamStart; t++) {
    if (!stillValid(attempt)) return;
    const y = vy * t - 0.5 * gravity * t * t;
    faceTarget(attempt, { x: start.x + dir.x * horizontal * t, y: start.y + y, z: start.z + dir.z * horizontal * t });
    if (t === CAPTURE_TIMINGS.ballOpen) {
      playAnimation(attempt.ballEntity, [`animation.${animationGroup(attempt.ball.ancient)}.open`]);
      playSound(attempt.ballEntity, captureSound(CAPTURE_SOUNDS.open, attempt.ball.ancient));
    }
    await waitTicks(1);
  }
}

/** PokemonRenderer: o feixe cresce em BEAM_EXTEND_TIME (0,2 s), fica, e recolhe depois de 0,6 s (em 0,2 s). */
const BEAM_EXTEND_TICKS = 4;
const BEAM_SHRINK_TICKS = 8;

/** Fração do feixe (da bola até o Pokémon) visível `tick` ticks depois de começar (renderBeam: `ratio`). */
export function captureBeamRatio(tick: number): number {
  if (tick < BEAM_EXTEND_TICKS) return tick / BEAM_EXTEND_TICKS;
  if (tick > BEAM_EXTEND_TICKS + BEAM_SHRINK_TICKS) return Math.max(0, 1 - (tick - BEAM_EXTEND_TICKS - BEAM_SHRINK_TICKS) / BEAM_EXTEND_TICKS);
  return 1;
}

/** Entidade que aparece (a de exibição com Illusion/Transform, senão o próprio Pokémon). */
function shownEntity(target: Entity): Entity {
  const mock = mockOf(target);
  return mock?.isValid ? mock : target;
}

/**
 * 0,7 s → 2,2 s: a bola para no ar e puxa o Pokémon (beamMode 3): feixe vermelho `cobblemon:recall_beam` da bola
 * até o meio do Pokémon e, depois de 0,2 s, o Pokémon encolhe até sumir em 0,4 s (activeSendoutScale 1 → 0).
 */
async function beamUp(attempt: CaptureAttempt) {
  playSound(attempt.ballEntity, CAPTURE_SOUNDS.recall, 0.6);
  safe(() => attempt.ballEntity.clearVelocity());
  const group = animationGroup(attempt.ball.ancient);
  const duration = CAPTURE_TIMINGS.fallStart - CAPTURE_TIMINGS.beamStart;
  const hover = attempt.ballEntity.location;
  const shown = shownEntity(attempt.target);
  const base = readScale(shown);
  // beamMode 3: tinta vermelha no cliente (0,2 s depois, junto com o encolhimento).
  if (setBeamTint(shown, true)) attempt.tinted = shown;
  if (base !== undefined) {
    attempt.originalScale = { entity: shown, value: base };
    lerpScale(shown, base, 1, 0, BEAM_SHRINK_TICKS, BEAM_EXTEND_TICKS);
  }
  for (let t = 0; t < duration; t++) {
    if (!stillValid(attempt)) return;
    // setNoGravity(true): segura a bola parada no ar.
    faceTarget(attempt, hover);
    safe(() => attempt.ballEntity.clearVelocity());
    const tick = CAPTURE_TIMINGS.beamStart + t;
    if (tick === CAPTURE_TIMINGS.ballOpen + 10) playAnimation(attempt.ballEntity, [`animation.${group}.open_idle`]);
    if (tick === CAPTURE_TIMINGS.ballShut) {
      playAnimation(attempt.ballEntity, [`animation.${group}.shut`]);
      playSound(attempt.ballEntity, captureSound(CAPTURE_SOUNDS.shut, attempt.ball.ancient));
    }
    const ratio = captureBeamRatio(t);
    if (t % 2 === 0 && ratio > 0) {
      // Da bola (locator `beam` na tampa) até o meio do Pokémon; o feixe sai da bola e volta para ela.
      const from = add(attempt.ballEntity.location, { x: 0, y: BALL_LOCATOR_OFFSET.center, z: 0 }), to = centerOf(shown.isValid ? shown : attempt.target);
      const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      if (distance <= 20) {
        const steps = Math.min(24, Math.max(4, Math.ceil(distance * 3)));
        for (let i = 0; i <= steps; i++) spawnParticle(attempt.ballEntity, "cobblemon:recall_beam", lerp(from, to, (i / steps) * ratio));
      }
    }
    await waitTicks(1);
  }
}

/**
 * Altura do chão logo abaixo da bola: o topo do 1º bloco com colisão num raio para baixo. É onde o FALL do Java para
 * (`onHit` BLOCK; o clip do projétil usa a colisão do bloco e ignora fluidos, então a água não segura a bola).
 * Afundando no chão (beta 7), medido no BDS: o `getBlockBelow` com `includePassableBlocks: false` só achava blocos
 * "sólidos" do Bedrock (pedra, grama, terra) e devolvia `undefined` em vidro, folhas, laje, gelo, terra arada e painel;
 * a bola caía o 1,5 s inteiro e parava dentro/abaixo do chão. O raio acha todos e dá o topo da colisão (laje: +0,5).
 */
export function groundBelow(entity: Entity): number | undefined {
  try {
    const hit = entity.dimension.getBlockFromRay(entity.location, { x: 0, y: -1, z: 0 },
      { includeLiquidBlocks: false, includePassableBlocks: false, maxDistance: 32 });
    if (!hit) return undefined;
    const y = hit.block.location.y;
    // faceLocation (face Up) medido no BDS: 0 no bloco inteiro (vidro, pedra, folhas, gelo), 0,5 na laje, 0,9375 na
    // terra arada. 0 = topo do bloco (1,0); aceita também um valor absoluto por segurança.
    const face = hit.faceLocation?.y;
    const top = typeof face !== "number" || !Number.isFinite(face) ? 1 : face > 1.0001 ? face - y : face;
    return y + (top > 0 && top <= 1.0001 ? Math.min(1, top) : 1);
  }
  catch {
    return undefined;
  }
}

/** 2,2 s: estado FALL até pousar (no máximo 1,5 s). */
async function fall(attempt: CaptureAttempt) {
  const ground = groundBelow(attempt.ballEntity);
  let position = attempt.ballEntity.location;
  let vy = 0;
  for (let t = 0; t < CAPTURE_TIMINGS.maxFall; t++) {
    if (!stillValid(attempt)) return;
    vy = (vy - 0.03) * 0.99;
    let y = position.y + vy;
    const landed = ground !== undefined && y <= ground;
    if (landed) y = ground!;
    position = { x: position.x, y, z: position.z };
    faceTarget(attempt, position);
    // O som do pouso vem do passo seguinte (animação `bounce`, ou `critical` que a substitui).
    if (landed) return;
    await waitTicks(1);
  }
}

/** Entidade de exibição (Illusion/Transform) do alvo, se houver. */
function mockOf(target: Entity): Entity | undefined {
  try { return findMockOf(target.id); }
  catch { return undefined; }
}

/** Esconde o Pokémon (dentro da bola) e o impede de andar. Com Illusion/Transform, esconde também o disfarce. */
function hidePokemon(target: Entity) {
  const mock = mockOf(target);
  // O real com disfarce já está invisível pelo Mock (efeito longo): não encurta a duração dele.
  if (mock) safe(() => mock.addEffect("invisibility", 20 * 60, { showParticles: false }));
  else safe(() => target.addEffect("invisibility", 20 * 60, { showParticles: false }));
}

/** Pokémon com captura em andamento (busyLocks do Java: só em memória; depois de uma queda nada fica ocupado). */
const activeCaptureTargets = new Set<string>();

export function isCaptureTarget(entity: Entity): boolean {
  try { return activeCaptureTargets.has(entity.id); }
  catch { return false; }
}

function freezePokemon(target: Entity) {
  safe(() => activeCaptureTargets.add(target.id));
  safe(() => target.setProperty("cobblemon:busy", true));
  safe(() => target.addEffect("slowness", 20 * 60, { amplifier: 255, showParticles: false }));
}

/** Volta a escala original na hora (saídas sem a animação de escape). */
function restoreScale(attempt: CaptureAttempt) {
  const original = attempt.originalScale;
  if (original) cancelScale(original.entity);
  if (original?.entity.isValid) writeScale(original.entity, original.value);
  attempt.originalScale = undefined;
}

/** Desliga a tinta do feixe (idempotente). */
function clearBeamTint(attempt: CaptureAttempt) {
  if (attempt.tinted) setBeamTint(attempt.tinted, false);
  attempt.tinted = undefined;
}

function releasePokemon(target: Entity) {
  // Com um disfarce válido o Pokémon real continua invisível (o Mock o esconde) e só o disfarce reaparece.
  const mock = mockOf(target);
  if (mock) safe(() => mock.removeEffect("invisibility"));
  else safe(() => target.removeEffect("invisibility"));
  safe(() => target.removeEffect("slowness"));
  safe(() => target.setProperty("cobblemon:busy", false));
  safe(() => activeCaptureTargets.delete(target.id));
}

/**
 * breakFree: o Pokémon reaparece onde está a bola e cresce de 0 a 1 em 0,4 s (beamMode 2); fora de batalha perde o
 * sono. A bola toca a animação `break` (som), 0,1 s depois solta o `sendflash` casual da bola e, se o Pokémon for
 * shiny, o anel de brilho 0,5 s depois. O selvagem não tem dono: sem o som de envio (PokemonClientDelegate).
 */
function breakFree(attempt: CaptureAttempt) {
  const { target, ballEntity } = attempt;
  if (!target.isValid) return;
  safe(() => { if (ballEntity.isValid) target.teleport(ballEntity.location); });
  releasePokemon(target);
  // beamMode 2 (sai da bola): sem tinta.
  clearBeamTint(attempt);
  const original = attempt.originalScale;
  // O encolhimento do raio pode ainda estar agendado (abort logo no começo): cancela antes de crescer.
  if (original) cancelScale(original.entity);
  if (original?.entity.isValid) {
    writeScale(original.entity, original.value * MIN_SCALE);
    lerpScale(original.entity, original.value, 0, 1, BEAM_SHRINK_TICKS);
  }
  attempt.originalScale = undefined;
  if (!attempt.battleAction && tryGetBattleFromEntity(target) === undefined) {
    safe(() => {
      const data = PokemonData.getFromEntity(target);
      if (data.status === "slp") {
        data.status = undefined;
        data.statusDuration = undefined;
        data.applyToCobblemon(target);
      }
    });
  }
  if (ballEntity.isValid) {
    playBallEffects(ballEntity, captureStepEffects("break_free", attempt.ball.ancient));
    const flash = `cobblemon:${ballParticleName(attempt.ball.id)}_casual_sendflash`;
    const at = ballEntity.location;
    const dimension = ballEntity.dimension;
    system.runTimeout(() => safe(() => dimension.spawnParticle(flash, at)), 2);
  }
  let shiny = false;
  try { shiny = target.hasTag(SHINY_TAG); } catch { }
  if (shiny) system.runTimeout(() => { if (target.isValid) playShinyRing(target); }, 10);
}

function killBall(ballEntity: Entity) {
  safe(() => { if (ballEntity.isValid) ballEntity.triggerEvent("cobblemon:instant_kill"); });
}

/**
 * Item na boca (raposa/Vulpix, SpeciesBehaviours): a entidade some com `instant_despawn`, que não derruba nada.
 * Vai para o espaço do item segurado se estiver vazio (o Pokémon capturado leva o item); senão cai no chão.
 */
function releaseMouthItem(target: Entity) {
  const id = target.getDynamicProperty(MOUTH_ITEM_PROPERTY);
  if (typeof id !== "string" || !id) return;
  try {
    if (!giveHeldItemIfEmpty(target, id)) target.dimension.spawnItem(new ItemStack(id, 1), target.location);
  }
  catch (e) {
    console.warn(`Não foi possível soltar o item da boca (${id}): ${e}`);
    return;
  }
  safe(() => target.runCommand("replaceitem entity @s slot.weapon.mainhand 0 air"));
  safe(() => target.setDynamicProperty(MOUTH_ITEM_PROPERTY, undefined));
}

/**
 * O Pokémon entra no time/PC: caughtBall, efeitos da bola, callbacks de `pokemon_captured`
 * (remove_aspects) e registro na Pokédex (POKEMON_GAINED → obtain).
 */
function completeCapture(attempt: CaptureAttempt): PokemonData | undefined {
  const { thrower, target, ball } = attempt;
  if (!target.isValid) return undefined;
  // Antes de ler os dados: se o item for para o espaço do item segurado, ele entra junto no time/PC.
  releaseMouthItem(target);
  const pokemon = PokemonData.getFromEntity(target);
  pokemon.pokeball = ball.id;
  // PlayerPartyStore.add: o treinador original só é definido se ainda não houver.
  if (!pokemon.ogTrainer) pokemon.ogTrainer = thrower.name;
  pokemon.trainer = thrower.id;
  applyCaptureEffects(ball, thrower, pokemon);
  pokemon.aspects = pokemon.aspects.filter(aspect => !ASPECTS_REMOVED_ON_CAPTURE.includes(aspect));
  // Callback pokemon_captured/apply_marks: sorteia uma das marcas em potencial juntadas no spawn.
  applyPotentialMarks(pokemon);
  // Frente msd-fase4: POKEMON_CAPTURED (antes de gravar; ouvinte com erro não impede a captura).
  try { CobblemonEvents.emit("POKEMON_CAPTURED", pokemon, thrower); }
  catch (e) { console.warn(`POKEMON_CAPTURED: ${e}`); }
  // Guarda primeiro: se gravar falhar, o Pokémon continua no mundo em vez de sumir.
  const storageMessage = storePokemonInFirstSpace(pokemon, thrower);
  target.triggerEvent("cobblemon:instant_kill");
  if (storageMessage !== undefined) thrower.sendMessage(storageMessage);
  markCaught(thrower, pokemon);
  // Callback pokemon_captured/wallpaper_unlocks (Alfa) e contadores do "Progresso Cobblemon" (AdvancementHandler.onCapture).
  try {
    onPokemonCapturedWallpapers(thrower, pokemon.aspects);
    recordCapture(thrower, { species: toSpeciesId(pokemon.species), aspects: pokemon.aspects, shiny: pokemon.shiny });
    if (getSafeTeam(thrower).filter(x => !!x).length >= 6) recordFlag(thrower, "full_party");
  }
  catch (e) { console.warn(`Erro nos extras da captura: ${e}`); }
  return pokemon;
}

/**
 * `>capture` do BattleCaptureAction: na hora do sucesso o Pokémon sai da batalha (antes que o tick da batalha a
 * encerre por ator inválido).
 */
function settleBattleCapture(action: BattleCaptureAction) {
  const battle = action.battle as PokemonBattle & CaptureAwareBattle;
  try {
    if (typeof battle.captureSucceeded === "function") battle.captureSucceeded(action);
    // Sem o gancho da frente de batalhas: encerra a batalha (o selvagem não existe mais).
    else if (!battle.ended) battle.stop();
  }
  catch (e) { console.warn(`Erro ao encerrar a batalha após a captura: ${e}`); }
}

/** BattleCaptureAction.attach: resultado anunciado 2 s depois (dispatchWaiting(2F)) e a ação é liberada. */
function finishBattleCapture(action: BattleCaptureAction, successful: boolean, pokemonName: ReturnType<PokemonData["getTranslatedName"]>) {
  const battle = action.battle as PokemonBattle & CaptureAwareBattle;
  system.runTimeout(() => {
    try {
      battle.broadcastChatMessage(successful
        ? message.color("Green", { translate: "cobblemon.capture.succeeded", with: { rawtext: [pokemonName] } })
        : message.color("Red", { translate: "cobblemon.capture.broke_free", with: { rawtext: [pokemonName] } }));
    }
    finally {
      if (typeof battle.finishCaptureAction === "function") battle.finishCaptureAction(action);
      else if (battle.captureActions) battle.captureActions = battle.captureActions.filter(x => x !== action);
    }
  }, 40);
}

/** Registra a ação na batalha e gasta a vez do jogador (ForcePassActionResponse). */
export function beginBattleCapture(action: BattleCaptureAction, ballItemName: { translate: string }) {
  const battle = action.battle as PokemonBattle & CaptureAwareBattle;
  if (Array.isArray(battle.captureActions)) battle.captureActions.push(action);
  battle.broadcastChatMessage(message.color("Yellow", {
    translate: "cobblemon.capture.attempted_capture",
    with: { rawtext: [action.thrower.getName(), ballItemName, action.target.data.getTranslatedName()] },
  }));
  action.thrower.forceChoose(new ForcePassActionResponse());
}

async function runStep(attempt: CaptureAttempt, step: CaptureStep) {
  const ball = attempt.ballEntity;
  const animation = pickAnimation(step.animations);
  if (animation) safe(() => ball.playAnimation(animation));
  // O som da animação `break` sai do breakFree (qualquer escape, inclusive abortado).
  if (step.kind !== "break_free") playBallEffects(ball, captureStepEffects(step.kind, attempt.ball.ancient, animation));
}

/**
 * Roda a captura inteira. Sempre termina removendo a bola; em caso de erro devolve o Pokémon ao normal.
 * @param hitVelocity Velocidade da bola no acerto (direção do quique).
 */
export async function runCaptureSequence(attempt: CaptureAttempt, hitVelocity: Vector3): Promise<boolean> {
  const { thrower, ballEntity, target } = attempt;
  let caught = false;
  let resolved = false;
  let context: CaptureContext | undefined;
  const ballId = (() => { try { return ballEntity.id; } catch { return undefined; } })();
  if (ballId !== undefined) activeCaptureBalls.add(ballId);
  const targetId = (() => { try { return target.id; } catch { return undefined; } })();
  const name = (() => { try { return PokemonData.getFromEntity(target).getTranslatedName(); } catch { return { translate: "cobblemon.ui.pokemon" }; } })();

  /** Resultado final (com ou sem a bola): o Pokémon entra no time ou escapa. */
  const succeed = (result: CaptureContext) => {
    const captured = completeCapture(attempt);
    caught = captured !== undefined;
    resolved = true;
    if (caught && attempt.battleAction) settleBattleCapture(attempt.battleAction);
    // Fora de batalha o Cobblemon não manda mensagem; o port mantém o aviso ao jogador.
    if (captured && !attempt.battleAction) thrower.sendMessage(message.color("Green", renderCaptureMessage(result, captured)));
  };
  const escape = () => {
    breakFree(attempt);
    resolved = true;
    if (!attempt.battleAction) thrower.sendMessage(message.color("Red", { translate: "cobblemon.capture.broke_free", with: { rawtext: [name] } }));
  };
  /**
   * A sequência não pode continuar. Se só a bola sumiu, termina sem ela: com o resultado já calculado, aplica o
   * resultado; antes do cálculo, devolve a bola (o `finally` solta o Pokémon).
   */
  const abort = (stage: string) => {
    console.warn(`Captura abortada (${stage}): entidade inválida: ${describeInvalid(attempt)}`);
    if (!onlyBallLost(attempt)) return;
    try {
      if (context === undefined) refundBall(attempt);
      else if (context.isSucessfulCapture) succeed(context);
      else escape();
    }
    catch (e) { console.warn(`Erro ao terminar a captura sem a bola: ${e}`); }
  };

  try {
    playSound(ballEntity, CAPTURE_SOUNDS.hit);
    freezePokemon(target);
    await bounceBack(attempt, hitVelocity);
    if (!stillValid(attempt)) { abort("quique"); return caught; }
    await beamUp(attempt);
    if (!stillValid(attempt)) { abort("raio"); return caught; }
    hidePokemon(target);
    await fall(attempt);
    if (!stillValid(attempt)) { abort("queda"); return caught; }

    context = attempt.calculate();
    const timeline = buildCaptureTimeline(context, attempt.ball.ancient);
    let elapsed = 0;
    for (const step of timeline) {
      await waitTicks(step.tick - elapsed);
      elapsed = step.tick;
      if (!stillValid(attempt)) { abort(`passo ${step.kind}`); return caught; }
      await runStep(attempt, step);
      if (step.kind === "success") {
        await waitTicks(attempt.ball.ancient ? CAPTURE_TIMINGS.captureDelayAncient : CAPTURE_TIMINGS.captureDelay);
        if (!stillValid(attempt)) { abort("entrada no time"); return caught; }
        succeed(context);
        killBall(ballEntity);
      }
      else if (step.kind === "break_free") {
        escape();
        await waitTicks(CAPTURE_TIMINGS.breakFreeDiscard);
        killBall(ballEntity);
      }
    }
    return caught;
  }
  catch (e) {
    console.error(`Erro na captura: ${e}`);
    return caught;
  }
  finally {
    if (ballId !== undefined) activeCaptureBalls.delete(ballId);
    // Capturado (a entidade sai sem releasePokemon) ou qualquer outra saída: não fica marcado como em captura.
    if (targetId !== undefined) activeCaptureTargets.delete(targetId);
    if (!caught) {
      // Restaura visibilidade/movimento e a flag `busy` do Pokémon em qualquer saída.
      if (!resolved && target.isValid) breakFree(attempt);
      else if (target.isValid) {
        releasePokemon(target);
        restoreScale(attempt);
      }
    }
    // Qualquer saída (capturado com o disfarce ainda em campo, abortado, escapou): sem tinta presa.
    clearBeamTint(attempt);
    killBall(ballEntity);
    if (attempt.battleAction) finishBattleCapture(attempt.battleAction, caught, name);
  }
}
