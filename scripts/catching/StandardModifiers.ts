/**
 * Port de `api/pokeball/catching/modifiers/CatchRateModifiers.kt` (Cobblemon 1.8.2).
 * As regras de cada bola ficam em funções puras (testadas em tests/captura.test.ts); os modificadores
 * só buscam o estado do mundo/batalha e chamam essas funções.
 */
import { Entity, Player, world } from "@minecraft/server";
import { CatchRateModifier } from "./CatchRateModifier";
import { BattleModifier } from "./BattleModifier";
import { WorldStateModifier } from "./WorldStateModifier";
import { DynamicMultiplierModifier } from "./DynamicMultiplierModifier";
import { MultiplierModifier } from "./MultiplierModifier";
import { tryGetBattleFromEntity } from "../battle";
import { ElementalType, PokemonData, StatusEffect } from "../Pokemon";
import { isInBiome } from "../utils";
import { BIOME_TAGS } from "../../generated/scripts/biomeTags";
import { DexProgress, getSpeciesKnowledge } from "../pokedex/PokedexStorage";

// ---------------------------------------------------------------------------------------------
// Regras puras

/** LEVEL (Level Ball): compara o maior nível dos seus Pokémon ativos com o do alvo. */
export function levelBallMultiplier(highestLevel: number, targetLevel: number): number {
  if (highestLevel > targetLevel * 4) return 4;
  if (highestLevel > targetLevel * 2) return 3;
  if (highestLevel > targetLevel) return 2;
  return 1;
}

/** Gênero do port ("m", "f", "" = sem gênero) → "m" | "f" | undefined. */
function genderOf(gender: string | undefined): "m" | "f" | undefined {
  const g = (gender ?? "").toLowerCase();
  if (g === "m" || g === "male") return "m";
  if (g === "f" || g === "female") return "f";
  return undefined;
}

/**
 * LOVE (Love Ball): 8× se um ativo seu for da mesma espécie e do gênero oposto, 2,5× se só o gênero for
 * oposto (regra do Cobblemon 1.8.2), 1× caso contrário ou se o alvo não tiver gênero.
 */
export function loveBallMultiplier(team: { species: string; gender?: string }[], target: { species: string; gender?: string }): number {
  const targetGender = genderOf(target.gender);
  if (targetGender === undefined) return 1;
  const opposite = team.filter(x => { const g = genderOf(x.gender); return g !== undefined && g !== targetGender; });
  if (opposite.some(x => x.species === target.species)) return 8;
  if (opposite.length > 0) return 2.5;
  return 1;
}

/** MOON_PHASES (Moon Ball): de dia 1×; de noite depende da fase (0 = lua cheia, índices iguais aos do Java). */
export function moonBallMultiplier(timeOfDay: number, moonPhase: number): number {
  if (((timeOfDay % 24000) + 24000) % 24000 < 12000) return 1;
  switch (moonPhase) {
    case 2: case 6: return 1.5;
    case 1: case 7: return 2.5;
    case 0: return 4;
    default: return 1;
  }
}

/** LIGHT_LEVEL (Dusk Ball): luz 0 → 3,5×; 1..7 → 3×; senão 1×. */
export function duskBallMultiplier(lightLevel: number): number {
  if (lightLevel === 0) return 3.5;
  if (lightLevel >= 1 && lightLevel <= 7) return 3;
  return 1;
}

/** NEST (Nest Ball): (41 - nível) / 10, só abaixo do nível 30. */
export function nestBallMultiplier(level: number): number | undefined {
  return level < 30 ? Math.fround((41 - level) / 10) : undefined;
}

/** WEIGHT_BASED (Heavy Ball), peso em hectogramas; só vale a partir de 1000 (faixas fechadas do Kotlin). */
export function heavyBallMultiplier(weight: number): number | undefined {
  if (!(weight >= 1000)) return undefined;
  if (weight >= 3000) return 4;
  if (weight >= 2000 && weight <= 2999) return 2.5;
  if (weight >= 1000 && weight <= 1999) return 1.5;
  return 1;
}

/** Timer Ball: 1 + turno × 1229/4096, no máximo 4. */
export function timerBallMultiplier(turn: number): number {
  return Math.min(Math.fround(1 + turn * Math.fround(1229 / 4096)), 4);
}

/** Quick Ball: 5× no primeiro turno. */
export function quickBallMultiplier(turn: number): number {
  return turn === 1 ? 5 : 1;
}

/** Beast Ball: 5× em Ultra Beasts, 0,1× no resto. */
export function beastBallMultiplier(isUltraBeast: boolean): number {
  return isUltraBeast ? 5 : 0.1;
}

/** REPEAT (Repeat Ball): 3,5× se a espécie já foi capturada (Pokédex). */
export function repeatBallMultiplier(knowledge: DexProgress): number {
  return knowledge === DexProgress.OWNED ? 3.5 : 1;
}

// ---------------------------------------------------------------------------------------------
// Estado do mundo

/** `entity.isUnderWater` do Java: os olhos estão dentro de água. */
function isUnderWater(entity: Entity): boolean {
  try {
    if (!entity.isInWater) return false;
    const block = entity.dimension.getBlock(entity.getHeadLocation());
    if (!block) return false;
    return block.typeId === "minecraft:water" || block.typeId === "minecraft:flowing_water" || block.isWaterlogged;
  }
  catch {
    return false;
  }
}

/** `getMaxLocalRawBrightness` na posição do bloco (máximo entre luz de bloco e do céu, já com a hora). */
function lightLevelAt(entity: Entity): number | undefined {
  try {
    const loc = entity.location;
    return entity.dimension.getLightLevel({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
  }
  catch {
    return undefined;
  }
}

/** Aspecto que a pesca põe no Pokémon (FishingSpawnCause.FISHED_ASPECT). */
export const FISHED_ASPECT = "fished";

// ---------------------------------------------------------------------------------------------
// Modificadores

export const CatchRateModifiers = {
  LEVEL: new BattleModifier((_, team, target) => {
    // maxOf { originalPokemon?.level ?: 1 }; posição vazia conta como nível 1.
    const levels = team.map(x => x?.level ?? 1);
    if (levels.length === 0) return 1;
    return levelBallMultiplier(Math.max(...levels), target.level);
  }),
  SUBMERGED_IN_WATER: new WorldStateModifier((_, entity) => isUnderWater(entity) ? 3.5 : 1),
  NEST: new DynamicMultiplierModifier(
    (_, pokemon) => nestBallMultiplier(pokemon.level) ?? 1,
    (_, pokemon) => pokemon.level < 30
  ),
  LOVE: new BattleModifier((_, team, target) =>
    loveBallMultiplier(team.filter((x): x is PokemonData => x != null), target)),
  MOON_PHASES: new WorldStateModifier(() => moonBallMultiplier(world.getTimeOfDay(), world.getMoonPhase() as number)),
  LIGHT_LEVEL: new WorldStateModifier((_, entity) => {
    const light = lightLevelAt(entity);
    return light === undefined ? 1 : duskBallMultiplier(light);
  }),
  /** 1,5× só fora de batalha (`!entity.isBattling`). */
  SAFARI: new WorldStateModifier((_, entity) => tryGetBattleFromEntity(entity) === undefined ? 1.5 : 1),
  /** 2,5× em biomas `#cobblemon:is_temperate`. */
  PARK: new WorldStateModifier((_, entity) =>
    isInBiome(entity.dimension, entity.location, BIOME_TAGS["cobblemon:is_temperate"] ?? []) ? 2.5 : 1),
  /** 4× em Pokémon pescados. */
  LURE: new WorldStateModifier((_, entity, pokemon) =>
    (pokemon.aspects.includes(FISHED_ASPECT) || entity.hasTag(FISHED_ASPECT)) ? 4 : 1),
  WEIGHT_BASED: new DynamicMultiplierModifier(
    (_, pokemon) => heavyBallMultiplier(getWeight(pokemon)) ?? 1,
    (_, pokemon) => getWeight(pokemon) >= 1000
  ),
  REPEAT: new WorldStateModifier((thrower, _, pokemon) => repeatBallMultiplier(getSpeciesKnowledge(thrower, pokemon.species))),
  /** Vale se algum tipo da forma ativa estiver na lista (Net Ball). */
  typeBoosting(multiplier: number, ...types: ElementalType[]): CatchRateModifier {
    return new MultiplierModifier(multiplier, (_, pokemon) => pokemon.getTypes().some(type => types.includes(type)));
  },
  /** Vale se o Pokémon tiver um dos status (Dream Ball). */
  statusBoosting(multiplier: number, ...statuses: StatusEffect[]): CatchRateModifier {
    return new MultiplierModifier(multiplier, (_, pokemon) => pokemon.status !== undefined && statuses.includes(pokemon.status));
  },
  /** Multiplicador pelo turno da batalha em que o jogador participa (Timer/Quick Ball); 1× fora dela. */
  turnBased(calculator: (turn: number) => number): CatchRateModifier {
    return new BattleModifier((player: Player) => {
      const battle = tryGetBattleFromEntity(player);
      return battle ? calculator(battle.turn) : 1;
    });
  },
}

/** Peso da forma ativa em hectogramas. */
function getWeight(pokemon: PokemonData): number {
  return pokemon.getFormData()?.weight ?? pokemon.getSpeciesData().weight;
}
