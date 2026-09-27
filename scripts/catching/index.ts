/**
 * Captura de Pokémon (frente "captura"): arremesso, validação do acerto, fórmula do Cobblemon 1.8.2 e a
 * sequência de captura. Ver docs/pendencias/captura.md para a API e os pedidos às outras frentes.
 */
import { resolveMockTarget } from "../battle/effects/Mock";
import { Entity, GameMode, ItemStack, Player, Vector3, world } from "@minecraft/server";
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
import { BattleCaptureAction, beginBattleCapture, runCaptureSequence } from "./CaptureSequence";
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

/** Devolve a bola como item (fora do criativo) e remove a entidade. */
function dropPokeball(pokeball: Entity, player?: Player) {
  try {
    if (player?.getGameMode() !== GameMode.Creative)
      pokeball.dimension.spawnItem(new ItemStack(getPokeBallOrDefault(pokeball.typeId).id, 1), pokeball.location);
  }
  catch (e) { console.warn(`Não foi possível devolver a Poké Bola: ${e}`); }
  pokeball.triggerEvent("cobblemon:instant_kill");
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

/** EmptyPokeBallEntity.onHitEntity: valida e começa a captura. */
function handleBallHit(projectile: Entity, hitEntity: Entity, thrower: Player, hitVector: Vector3) {
  // Acertos duplicados são comuns no Bedrock.
  if (projectile.getDynamicProperty("activated")) return;
  // Illusion/Transform (frente visual-batalha): a bola que acerta a entidade de exibição mira o Pokémon real.
  const target = resolveMockTarget(hitEntity);
  const ball = getPokeBallOrDefault(projectile.typeId);
  const fail = (text: Parameters<typeof message.error>[0]) => {
    thrower.sendMessage(message.error(text));
    dropPokeball(projectile, thrower);
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
    if (!hitActor || !hitActive) { dropPokeball(projectile, thrower); return; }
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

  projectile.setDynamicProperty("activated", true);
  try { projectile.triggerEvent("cobblemon:disable"); } catch { }
  if (battleAction) beginBattleCapture(battleAction, { translate: `item.cobblemon.${ball.name}` });
  void runCaptureSequence({
    thrower, ballEntity: projectile, target, ball, battleAction,
    calculate: () => processCapture(thrower, ball, target),
  }, hitVector);
}

let bound = false;

/** Liga os eventos de arremesso/captura (e da Pokédex). Chamado uma vez pelo main.ts. */
export function bindCatchEvents() {
  if (bound) return;
  bound = true;

  // Dono do projétil e animação de giro no ar.
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    if (!isPokeballEntity(entity)) return;
    const owner = entity.getComponent("minecraft:projectile")?.owner
      ?? entity.dimension.getPlayers({ location: entity.location, closest: 1 })[0];
    if (owner) entity.setDynamicProperty("player_id", owner.id);
    const ball = getPokeBall(entity.typeId);
    try { entity.playAnimation(`animation.${ball?.ancient ? "ancient_poke_ball" : "poke_ball"}.throw`); } catch { }
  });

  // Bateu num bloco sem capturar: nuvem, som de madeira agudo e volta a ser item.
  world.afterEvents.projectileHitBlock.subscribe(arg => {
    const projectile = arg.projectile;
    if (!isPokeballEntity(projectile)) return;
    if (projectile.getDynamicProperty("activated") || projectile.getProperty("cobblemon:disabled")) return;
    try {
      arg.dimension.spawnParticle("minecraft:white_smoke_particle", arg.location);
      // SoundEvents.WOOD_PLACE com pitch 2,5 (o Java limita a 2,0); no Bedrock, colocar madeira = dig.wood.
      arg.dimension.playSound("dig.wood", arg.location, { pitch: 2 });
    } catch { }
    dropPokeball(projectile, arg.source instanceof Player ? arg.source : getThrower(projectile));
  });

  world.afterEvents.projectileHitEntity.subscribe(arg => {
    const projectile = arg.projectile;
    if (!isPokeballEntity(projectile)) return;
    if (projectile.getDynamicProperty("activated")) return;
    const thrower = getThrower(projectile, arg.source);
    const target = arg.getEntityHit().entity;
    if (!thrower) { dropPokeball(projectile); return; }
    if (!isPokemonEntity(target)) { dropPokeball(projectile, thrower); return; }
    try { handleBallHit(projectile, target, thrower, arg.hitVector); }
    catch (e) {
      console.error(`Erro ao processar acerto da Poké Bola: ${e}`);
      dropPokeball(projectile, thrower);
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
