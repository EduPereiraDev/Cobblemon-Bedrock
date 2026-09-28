/**
 * Bola arremessada que NÃO capturou: quando volta a ser item e quando some (EmptyPokeBallEntity do Cobblemon 1.8.2).
 *
 * Regras do Java (upstream/cobblemon/.../entity/pokeball/EmptyPokeBallEntity.kt):
 * - bateu num bloco antes de acertar um Pokémon (`onHitBlock`, l. 181-197): some e, se o dono é um jogador fora do
 *   criativo, cai o item da mesma bola (`spawnAtLocation(defaultItem)`, l. 188-191). Sem dono: só some;
 * - acertou um Pokémon mas a captura foi recusada (`onHitEntity` → `drop()`, l. 199-288): não selvagem, uncatchable,
 *   batalha de outro, não é 1x1, não é a vez, ocupado, jogador em batalha, evento cancelado. `drop()` (l. 282-288)
 *   derruba o item, menos para jogador no criativo;
 * - acertou uma entidade que não é Pokémon (l. 279): o Java deixa a bola seguir e ela cai no bloco seguinte (item).
 *   No Bedrock o projétil para no acerto, então o item cai ali mesmo (mesmo resultado, outro lugar);
 * - voou 600 ticks sem acertar nada (`tick`, l. 300-302) ou o dono sumiu (l. 304-308): some, sem item;
 * - captura que falhou (`breakFree`, l. 394-418) ou deu certo (l. 343-374): a bola é consumida (não volta).
 */
import { getPokeBallOrDefault } from "./PokeBalls";

/** EmptyPokeBallEntity.tick: `tickCount > 600 && capturingPokemon == null` → a bola é removida (sem item). */
export const BALL_MAX_FLIGHT_TICKS = 600;

/** O que a regra precisa saber de quem arremessou (undefined = sem dono: saiu do mundo ou não identificado). */
export interface BallThrower {
  creative: boolean;
}

/**
 * Item a derrubar quando a bola não capturou (bloco, entidade inválida ou captura recusada), ou undefined quando ela
 * só some (criativo ou sem dono).
 * @param ballTypeId Id da entidade da bola (`cobblemon:great_ball`); o item tem o mesmo id.
 */
export function missedBallItem(ballTypeId: string | undefined, thrower: BallThrower | undefined): string | undefined {
  if (!thrower || thrower.creative) return undefined;
  return getPokeBallOrDefault(ballTypeId ?? "cobblemon:poke_ball").id;
}

/** A bola deve expirar (sumir sem item)? Só se ainda não começou uma captura. */
export function shouldExpireBall(flightTicks: number, capturing: boolean): boolean {
  return !capturing && flightTicks >= BALL_MAX_FLIGHT_TICKS;
}
