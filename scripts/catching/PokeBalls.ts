/**
 * Registro de Poké Bolas, port de `api/pokeball/PokeBalls.kt` + `pokeball/PokeBall.kt` (Cobblemon 1.8.2).
 * O id de cada bola é igual ao id do item e ao da entidade de projétil (`cobblemon:<nome>`).
 */
import { Player } from "@minecraft/server";
import { CatchRateModifier } from "./CatchRateModifier";
import { MultiplierModifier } from "./MultiplierModifier";
import { GuaranteedModifier } from "./GarunteedMultiplier";
import { BaseStatModifier } from "./BaseStatModifier";
import { DynamicMultiplierModifier } from "./DynamicMultiplierModifier";
import { CatchRateModifiers, beastBallMultiplier, quickBallMultiplier, timerBallMultiplier } from "./StandardModifiers";
import { CaptureEffect, CaptureEffects, FriendshipEarningBoostEffect } from "./CaptureEffects";
import { ElementalType, StatusEffect } from "../Pokemon";

export interface PokeBall {
  /** Id com namespace, ex.: "cobblemon:poke_ball". */
  id: string;
  /** Id sem namespace, ex.: "poke_ball". */
  name: string;
  catchRateModifier: CatchRateModifier;
  effects: CaptureEffect[];
  /** Arrasto na água (WaterDragModifier); vira `liquid_inertia` do projétil. */
  waterDragValue: number;
  /** Força do arremesso (1,25 padrão; ancient pesadas 0,75; ancient aladas 2,5). */
  throwPower: number;
  ancient: boolean;
}

/** Modificador padrão do createDefault: MultiplierModifier(1) sempre válido. */
const DEFAULT_MODIFIER = () => new MultiplierModifier(1, () => true);

const registry = new Map<string, PokeBall>();

function createDefault(
  name: string,
  catchRateModifier: CatchRateModifier = DEFAULT_MODIFIER(),
  options: { effects?: CaptureEffect[]; waterDragValue?: number; throwPower?: number; ancient?: boolean } = {}
): PokeBall {
  const ball: PokeBall = {
    id: `cobblemon:${name}`,
    name,
    catchRateModifier,
    effects: options.effects ?? [],
    waterDragValue: options.waterDragValue ?? 0.8,
    throwPower: options.throwPower ?? 1.25,
    ancient: options.ancient ?? false,
  };
  registry.set(name, ball);
  return ball;
}

createDefault("poke_ball");
createDefault("slate_ball");
createDefault("azure_ball");
createDefault("verdant_ball");
createDefault("roseate_ball");
createDefault("citrine_ball");
createDefault("great_ball", new MultiplierModifier(1.5));
createDefault("ultra_ball", new MultiplierModifier(2));
createDefault("master_ball", new GuaranteedModifier());
createDefault("safari_ball", CatchRateModifiers.SAFARI);
createDefault("fast_ball", new BaseStatModifier("speed", value => value >= 100, 4));
createDefault("level_ball", CatchRateModifiers.LEVEL);
createDefault("lure_ball", CatchRateModifiers.LURE);
createDefault("heavy_ball", CatchRateModifiers.WEIGHT_BASED);
createDefault("love_ball", CatchRateModifiers.LOVE);
createDefault("friend_ball", undefined, { effects: [CaptureEffects.friendshipSetter(150)] });
createDefault("moon_ball", CatchRateModifiers.MOON_PHASES);
createDefault("sport_ball", new MultiplierModifier(1.5));
createDefault("net_ball", CatchRateModifiers.typeBoosting(3, ElementalType.Bug, ElementalType.Water));
createDefault("dive_ball", CatchRateModifiers.SUBMERGED_IN_WATER, { waterDragValue: 0.99 });
createDefault("nest_ball", CatchRateModifiers.NEST);
createDefault("repeat_ball", CatchRateModifiers.REPEAT);
createDefault("timer_ball", CatchRateModifiers.turnBased(timerBallMultiplier));
createDefault("luxury_ball", undefined, { effects: [new FriendshipEarningBoostEffect(2)] });
createDefault("premier_ball");
createDefault("dusk_ball", CatchRateModifiers.LIGHT_LEVEL);
createDefault("heal_ball", undefined, { effects: [CaptureEffects.FULL_RESTORE] });
createDefault("quick_ball", CatchRateModifiers.turnBased(quickBallMultiplier));
createDefault("cherish_ball");
createDefault("park_ball", CatchRateModifiers.PARK);
createDefault("dream_ball", CatchRateModifiers.statusBoosting(4, StatusEffect.Sleep));
createDefault("beast_ball", new DynamicMultiplierModifier((_, pokemon) => beastBallMultiplier(pokemon.hasLabels("ultra_beast")), () => true));
createDefault("ancient_poke_ball", undefined, { ancient: true });
createDefault("ancient_citrine_ball", undefined, { ancient: true });
createDefault("ancient_verdant_ball", undefined, { ancient: true });
createDefault("ancient_azure_ball", undefined, { ancient: true });
createDefault("ancient_roseate_ball", undefined, { ancient: true });
createDefault("ancient_slate_ball", undefined, { ancient: true });
createDefault("ancient_ivory_ball", undefined, { ancient: true });
createDefault("ancient_great_ball", new MultiplierModifier(1.5), { ancient: true });
createDefault("ancient_ultra_ball", new MultiplierModifier(2), { ancient: true });
createDefault("ancient_heavy_ball", undefined, { throwPower: 0.75, ancient: true });
createDefault("ancient_leaden_ball", new MultiplierModifier(1.5), { throwPower: 0.75, ancient: true });
createDefault("ancient_gigaton_ball", new MultiplierModifier(2), { throwPower: 0.75, ancient: true });
createDefault("ancient_feather_ball", undefined, { throwPower: 2.5, ancient: true });
createDefault("ancient_wing_ball", new MultiplierModifier(1.5), { throwPower: 2.5, ancient: true });
createDefault("ancient_jet_ball", new MultiplierModifier(2), { throwPower: 2.5, ancient: true });
createDefault("ancient_origin_ball", new GuaranteedModifier(), { ancient: true });
// Existe no port (entidade/item antigos), não no registro do Cobblemon 1.8.2: bola comum.
createDefault("strange_ball");

/** Nome sem namespace a partir do id do item/entidade ("cobblemon:poke_ball", "poke_ball" ou "pokeball"). */
export function pokeBallName(id: string): string {
  const plain = id.replace(/^[a-z0-9_.-]+:/, "").replace(/_dummy$/, "");
  if (registry.has(plain)) return plain;
  const compact = plain.replace(/_/g, "");
  for (const name of registry.keys())
    if (name.replace(/_/g, "") === compact) return name;
  return plain;
}

/** Bola pelo id (com ou sem namespace); undefined se não for uma Poké Bola conhecida. */
export function getPokeBall(id: string): PokeBall | undefined {
  return registry.get(pokeBallName(id));
}

/** Bola pelo id, ou a Poké Ball comum. */
export function getPokeBallOrDefault(id: string | undefined): PokeBall {
  return (id ? getPokeBall(id) : undefined) ?? registry.get("poke_ball")!;
}

/** Todas as bolas registradas. */
export function getAllPokeBalls(): PokeBall[] {
  return [...registry.values()];
}

/** Aplica os efeitos de captura da bola (PokeBall.effects). */
export function applyCaptureEffects(ball: PokeBall, thrower: Player, pokemon: Parameters<CaptureEffect["apply"]>[1]) {
  for (const effect of ball.effects) effect.apply(thrower, pokemon);
}

/** Id da entidade de projétil (= id do item). */
export function projectileEntityId(ball: PokeBall): string {
  return ball.id;
}

/** `minecraft:projectile.power` equivalente ao throwPower (a Poké Ball comum usa 1,5 no BP ⇔ 1,25). */
export function projectilePower(ball: PokeBall): number {
  return Math.round(ball.throwPower * 1.2 * 100) / 100;
}
