/**
 * Captura de Pokémon (frente "captura"): arremesso, validação do acerto, fórmula do Cobblemon 1.8.2 e a
 * sequência de captura. Ver docs/pendencias/captura.md para a API e os pedidos às outras frentes.
 */
import { resolveMockTarget } from "../battle/effects/Mock";
import { Dimension, Entity, GameMode, ItemStack, Player, Vector3, system, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { tryGetBattleFromEntity } from "../battle";
import { ActorType } from "../battle/BattleActor";
import { BattleTypes } from "../battle/BattleFormat";
import { message } from "../language";
import { getConfig } from "../Config";
import { CatchRateModifier } from "./CatchRateModifier";
import { MultiplierModifier } from "./MultiplierModifier";
import { bindCaptureEntity } from "./WorldStateModifier";
import { CaptureContext, calculateCapture } from "./CaptureCalculator";
import { PokeBall, getPokeBall, getPokeBallOrDefault, pokeBallName } from "./PokeBalls";
import { BattleCaptureAction, beginBattleCapture, isCaptureInProgress, runCaptureSequence } from "./CaptureSequence";
import { BALL_MAX_FLIGHT_TICKS, missedBallItem, shouldExpireBall } from "./MissedBall";
import { configureBallFlight, trackBall } from "./BallFlight";
import { swapToCaptureDummy } from "./CaptureDummy";
import { DexProgress, getPokedex } from "../pokedex/PokedexStorage";
import { bindPokedex } from "../pokedex";
import { bindPCWallpapers } from "../GUI/PCWallpapers";

export { CatchRateModifier, BehaviorMutators } from "./CatchRateModifier";
export type { Behavior } from "./CatchRateModifier";
export { BaseStatModifier } from "./BaseStatModifier";
export { BattleModifier } from "./BattleModifier";
export { DynamicMultiplierModifier } from "./DynamicMultiplierModifier";
export { GuaranteedModifier, GarunteedModifier } from "./GarunteedMultiplier";
export { LabelModifier } from "./LabelModifier";
export { MultiplierModifier } from "./MultiplierModifier";
export { WorldStateModifier } from "./WorldStateModifier";
export { CatchRateModifiers } from "./StandardModifiers";
export type { CaptureContext } from "./CaptureCalculator";
export {
  calculateCapture, computeModifiedCatchRate, shakeProbability, captureSuccessChance, criticalCaptureChance,
} from "./CaptureCalculator";
export { getPokeBall, getPokeBallOrDefault, getAllPokeBalls, pokeBallName } from "./PokeBalls";
export type { PokeBall } from "./PokeBalls";

/** Família das entidades de Poké Bola arremessada. */
const POKEBALL_FAMILY = "pokeball";

/**
 * @param pokeball Entidade da bola ou id (com ou sem namespace).
 * @returns O modificador da bola, ou um neutro se não for uma bola conhecida.
 */
export function getCatchRateModifier(pokeball: Entity | string): CatchRateModifier {
  const id = typeof pokeball === "string" ? pokeball : pokeball.typeId;
  return getPokeBall(id)?.catchRateModifier ?? new MultiplierModifier(1);
}

/**
 * findHighestThrowerLevel do Cobblemon: o ator do jogador cujo Pokémon ativo É o alvo. Num selvagem isso nunca
 * acontece, então na prática não há penalidade (comportamento do 1.8.2, mantido de propósito).
 */
function findHighestThrowerLevel(thrower: Player, target: Entity, pokemon: PokemonData): number | undefined {
  const battle = tryGetBattleFromEntity(target);
  if (!battle) return undefined;
  const actor = battle.actors.find(actor => actor.type === ActorType.PLAYER && actor.actor.id === thrower.id
    && actor.activePokemon.some(active => active?.data.uuid === pokemon.uuid));
  if (!actor) return undefined;
  const levels = actor.getSide().getOppositeSide().actors.flatMap(x => x.activePokemon).map(x => x?.data.level ?? 1);
  return levels.length > 0 ? Math.max(...levels) : undefined;
}

/** Calcula quantas sacudidas e se a captura deu certo (CobblemonCaptureCalculator.processCapture). */
export function processCapture(thrower: Player, pokeball: Entity | PokeBall, targetPokemon: Entity): CaptureContext {
  const ball = "catchRateModifier" in pokeball ? pokeball : getPokeBallOrDefault(pokeball.typeId);
  const target = PokemonData.getFromEntity(targetPokemon);
  bindCaptureEntity(target, targetPokemon);
  const modifier = ball.catchRateModifier;
  const dex = getPokedex(thrower);
  const alreadyOwnedForm = dex.getFormKnowledge(target.species, target.getFormName()) === DexProgress.OWNED;
  const guaranteed = modifier.isGuaranteed();
  const valid = guaranteed ? true : modifier.isValid(thrower, target);
  return calculateCapture({
    guaranteed,
    maxHealth: target.maxHealth,
    currentHealth: target.currentHealth,
    catchRate: target.getCatchRate(),
    inBattle: tryGetBattleFromEntity(targetPokemon) !== undefined,
    status: target.status,
    level: target.level,
    ballBonus: valid ? modifier.value(thrower, target) : 1,
    behavior: modifier.behavior(thrower, target),
    highestThrowerLevel: findHighestThrowerLevel(thrower, targetPokemon, target),
    maxPokemonLevel: getConfig().maxPokemonLevel ?? 100,
    caughtCount: dex.getCaughtCount(),
    alreadyOwnedForm,
  });
}

/** Onde a bola bateu (vem do evento de acerto: continua válido mesmo se o projétil já tiver sido invalidado). */
interface HitPlace {
  dimension: Dimension;
  location: Vector3;
}

function safeTypeId(entity: Entity): string | undefined {
  try { return entity.typeId; }
  catch { return undefined; }
}

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

/**
 * EmptyPokeBallEntity.onHitBlock/drop(): a bola some e, fora do criativo, cai como item da mesma bola (MissedBall.ts).
 * Sem dono (jogador saiu), o Java só descarta. O item nasce no ponto do acerto (`at`), com fallback na entidade.
 */
function dropPokeball(pokeball: Entity, player: Player | undefined, at?: HitPlace) {
  // Frente ball-hit: resolvida (o acerto por proximidade para de acompanhar; nada de segundo item/acerto).
  try { pokeball.setDynamicProperty("resolved", true); } catch { }
  const itemId = missedBallItem(safeTypeId(pokeball), player?.isValid ? { creative: isCreative(player) } : undefined);
  if (itemId) {
    try {
      const place = at ?? { dimension: pokeball.dimension, location: pokeball.location };
      place.dimension.spawnItem(new ItemStack(itemId, 1), place.location);
    }
    catch (e) { console.warn(`Não foi possível devolver a Poké Bola: ${e}`); }
  }
  try { if (pokeball.isValid) pokeball.triggerEvent("cobblemon:instant_kill"); }
  catch { }
}

/** EmptyPokeBallEntity.tick: 600 ticks sem capturar → a bola some (sem item). */
function expireBall(pokeball: Entity) {
  try {
    if (!pokeball.isValid) return;
    const capturing = pokeball.getDynamicProperty("activated") === true || isCaptureInProgress(pokeball);
    if (shouldExpireBall(BALL_MAX_FLIGHT_TICKS, capturing)) pokeball.triggerEvent("cobblemon:instant_kill");
  }
  catch { }
}

function isPokeballEntity(entity: Entity): boolean {
  try { return entity.isValid && !!entity.getComponent("minecraft:type_family")?.hasTypeFamily(POKEBALL_FAMILY); }
  catch { return false; }
}

function isPokemonEntity(entity: Entity | undefined): entity is Entity {
  try { return !!entity && entity.isValid && !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon"); }
  catch { return false; }
}

/** Quem arremessou a bola. */
function getThrower(projectile: Entity, source?: Entity): Player | undefined {
  const id = projectile.getDynamicProperty("player_id");
  if (typeof id === "string") {
    const entity = world.getEntity(id);
    if (entity instanceof Player) return entity;
  }
  return source instanceof Player ? source : undefined;
}

function pokemonName(entity: Entity) {
  return PokemonData.tryGetFromEntity(entity)?.getTranslatedName() ?? { translate: "cobblemon.ui.pokemon" };
}

/** Pokémon selvagem: sem dono (propriedade `cobblemon:wild` e sem `owner_name`). */
function isWild(entity: Entity): boolean {
  try { return entity.getProperty("cobblemon:wild") === true && !entity.getDynamicProperty("owner_name"); }
  catch { return false; }
}

/** UncatchableProperty: aspecto/tag "uncatchable". */
function isUncatchable(entity: Entity): boolean {
  if (entity.hasTag("uncatchable")) return true;
  return PokemonData.tryGetFromEntity(entity)?.aspects.includes("uncatchable") ?? false;
}

/**
 * Gancho "bola acertou um Pokémon" (CobblemonEvents.THROWN_POKEBALL_HIT, cancelável; frente msd-fase6). Devolve true
 * para cancelar: a captura não começa e a bola volta a ser item. Sem gancho registrado, nada muda.
 */
export type BallHitHook = (thrower: Player, target: Entity, ballTypeId: string) => boolean;
const ballHitHooks: BallHitHook[] = [];

export function addBallHitHook(hook: BallHitHook): void {
  if (!ballHitHooks.includes(hook)) ballHitHooks.push(hook);
}

/** Só para os testes. */
export function clearBallHitHooksForTests(): void {
  ballHitHooks.length = 0;
}

function ballHitCanceled(thrower: Player, target: Entity, ballTypeId: string): boolean {
  for (const hook of ballHitHooks) {
    try { if (hook(thrower, target, ballTypeId)) return true; }
    catch (e) { console.warn(`Gancho de acerto da Poké Bola: ${e}`); }
  }
  return false;
}

/**
 * EmptyPokeBallEntity.onHitEntity: valida e começa a captura.
 * @param ballAt Onde a bola parou, se foi teleportada neste tick (acerto por proximidade no trecho já percorrido).
 */
function handleBallHit(projectile: Entity, hitEntity: Entity, thrower: Player, hitVector: Vector3, at?: HitPlace, ballAt?: Vector3) {
  // Acertos duplicados são comuns no Bedrock.
  if (projectile.getDynamicProperty("activated")) return;
  // Illusion/Transform (frente visual-batalha): a bola que acerta a entidade de exibição mira o Pokémon real.
  const target = resolveMockTarget(hitEntity);
  const ball = getPokeBallOrDefault(projectile.typeId);
  const fail = (text: Parameters<typeof message.error>[0]) => {
    thrower.sendMessage(message.error(text));
    dropPokeball(projectile, thrower, at);
  };

  if (!isWild(target)) return fail(message.With("cobblemon.capture.not_wild", [pokemonName(target)]));
  if (isUncatchable(target)) return fail({ translate: "cobblemon.capture.cannot_be_caught" });

  const battle = tryGetBattleFromEntity(target);
  let battleAction: BattleCaptureAction | undefined;
  if (battle) {
    const throwerActor = battle.getActorFromID(thrower.id);
    if (!throwerActor) return fail(message.With("cobblemon.capture.in_battle", [pokemonName(target)]));
    const hitActor = battle.actors.find(actor => actor.isForPokemon(target));
    const hitActive = hitActor?.activePokemon.find(active => active?.entity.id === target.id);
    if (!hitActor || !hitActive) { dropPokeball(projectile, thrower, at); return; }
    if (battle.format.battleType !== BattleTypes.SINGLES || hitActor.pokemon.filter(x => x.currentHealth > 0).length > 1)
      return fail({ translate: "cobblemon.capture.not_single" });
    if (!throwerActor.canFitForcedAction())
      return fail({ translate: "cobblemon.capture.not_your_turn" });
    battleAction = { battle, thrower: throwerActor, target: hitActive, ballEntity: projectile };
  }
  else if (target.getProperty("cobblemon:busy") === true) {
    return fail(message.With("cobblemon.capture.busy", [pokemonName(target)]));
  }
  else if (tryGetBattleFromEntity(thrower) !== undefined) {
    return fail({ translate: "cobblemon.capture.you_in_battle" });
  }

  // CobblemonEvents.THROWN_POKEBALL_HIT (frente msd-fase6): depois das validações e antes da captura; cancelado, a bola
  // cai como item em silêncio (EmptyPokeBallEntity.drop()).
  if (ballHitHooks.length && ballHitCanceled(thrower, target, projectile.typeId)) {
    dropPokeball(projectile, thrower, at);
    return;
  }

  projectile.setDynamicProperty("activated", true);
  try { projectile.triggerEvent("cobblemon:disable"); } catch { }
  if (battleAction) beginBattleCapture(battleAction, { translate: `item.cobblemon.${ball.name}` });
  // Afundando no chão (beta 7): a sequência roda na `_dummy` (sem projétil nem física), não no arremessável. A troca
  // vem depois de tudo que pode lançar erro: com o projétil já removido, o `catch` de quem chama derrubaria um item.
  const ballEntity = swapToCaptureDummy(projectile, ballAt);
  if (battleAction) battleAction.ballEntity = ballEntity;
  void runCaptureSequence({
    thrower, ballEntity, target, ball, battleAction,
    calculate: () => processCapture(thrower, ball, target),
  }, hitVector);
}

/** A bola já acertou (captura em curso) ou já virou item/sumiu: fora do teste de acerto por proximidade. */
function isBallResolved(pokeball: Entity): boolean {
  try {
    return pokeball.getDynamicProperty("activated") === true || pokeball.getDynamicProperty("resolved") === true
      || pokeball.getProperty("cobblemon:disabled") === true;
  }
  catch { return true; }
}

/**
 * Frente ball-hit: acerto por proximidade (BallFlight.ts, teste do Java com a caixa inflada) → o mesmo fluxo do acerto
 * nativo. A bola para onde o Java a deixaria: no trecho à frente ela ainda não chegou ao alvo (fica onde está); no
 * trecho já percorrido ela passou do ponto de entrada (volta para ele).
 */
function onProximityHit(projectile: Entity, target: Entity, point: Vector3, velocity: Vector3, forward: boolean) {
  if (isBallResolved(projectile)) return;
  const at: HitPlace = { dimension: projectile.dimension, location: point };
  const thrower = getThrower(projectile);
  if (!thrower) { dropPokeball(projectile, undefined, at); return; }
  try { projectile.clearVelocity(); } catch { }
  if (!forward) { try { projectile.teleport(point); } catch { } }
  try { handleBallHit(projectile, target, thrower, velocity, at, forward ? undefined : point); }
  catch (e) {
    console.error(`Erro ao processar acerto da Poké Bola: ${e}`);
    dropPokeball(projectile, thrower, at);
  }
}

let bound = false;

/** Liga os eventos de arremesso/captura (e da Pokédex). Chamado uma vez pelo main.ts. */
export function bindCatchEvents() {
  if (bound) return;
  bound = true;
  configureBallFlight(onProximityHit, isBallResolved);

  // Dono do projétil e animação de giro no ar.
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    if (!isPokeballEntity(entity)) return;
    const owner = entity.getComponent("minecraft:projectile")?.owner
      ?? entity.dimension.getPlayers({ location: entity.location, closest: 1 })[0];
    if (owner) entity.setDynamicProperty("player_id", owner.id);
    const ball = getPokeBall(entity.typeId);
    try { entity.playAnimation(`animation.${ball?.ancient ? "ancient_poke_ball" : "poke_ball"}.throw`); } catch { }
    system.runTimeout(() => expireBall(entity), BALL_MAX_FLIGHT_TICKS);
    trackBall(entity);
  });

  // Bateu num bloco sem capturar: nuvem, som de madeira agudo e volta a ser item.
  world.afterEvents.projectileHitBlock.subscribe(arg => {
    const projectile = arg.projectile;
    if (!isPokeballEntity(projectile)) return;
    // Já acertou (nativo ou por proximidade) ou já virou item: sem segundo item.
    if (isBallResolved(projectile)) return;
    try {
      arg.dimension.spawnParticle("minecraft:white_smoke_particle", arg.location);
      // SoundEvents.WOOD_PLACE com pitch 2,5 (o Java limita a 2,0); no Bedrock, colocar madeira = dig.wood.
      arg.dimension.playSound("dig.wood", arg.location, { pitch: 2 });
    } catch { }
    dropPokeball(projectile, arg.source instanceof Player ? arg.source : getThrower(projectile), { dimension: arg.dimension, location: arg.location });
  });

  world.afterEvents.projectileHitEntity.subscribe(arg => {
    const projectile = arg.projectile;
    if (!isPokeballEntity(projectile)) return;
    if (isBallResolved(projectile)) return;
    const thrower = getThrower(projectile, arg.source);
    const target = arg.getEntityHit().entity;
    const at: HitPlace = { dimension: arg.dimension, location: arg.location };
    // Sem dono: o Java descarta a bola (tick: owner == null) sem item.
    if (!thrower) { dropPokeball(projectile, undefined, at); return; }
    // Entidade que não é Pokémon: no Java a bola segue e cai no próximo bloco; aqui o projétil parou, cai ali mesmo.
    if (!isPokemonEntity(target)) { dropPokeball(projectile, thrower, at); return; }
    try { handleBallHit(projectile, target, thrower, arg.hitVector, at); }
    catch (e) {
      console.error(`Erro ao processar acerto da Poké Bola: ${e}`);
      dropPokeball(projectile, thrower, at);
    }
  });

  bindPokedex();
  // Papéis de parede do PC (comandos e desbloqueio por bioma); idempotente, o main.ts também pode chamar.
  bindPCWallpapers();
}

/** Nome sem namespace de uma bola (compatibilidade com dados antigos: `pokemon.pokeball = "poke_ball"`). */
export function getPokeballEntityName(pokeball: string | undefined): string {
  return pokeBallName(pokeball ?? "poke_ball");
}
