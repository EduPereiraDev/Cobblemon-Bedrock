import { Dex, findSimPokemon, simPokemonUUID } from "../showdown";
import type { SimBattle, SimPokemon, SimSide } from "../showdown";
import type { BattleActor } from "./BattleActor";
import type { PokemonBattle } from "./PokemonBattle";

/**
 * Consultas ao estado do simulador (@pkmn/sim). O estado do simulador é a fonte da verdade durante a
 * batalha (HP, PP, status, posições); os PokemonData são atualizados pelo intérprete com atraso das
 * animações. Usado pelas telas (alvos, efetividade, mochila) e pelas IAs.
 */

export function getSimBattle(battle: PokemonBattle): SimBattle | undefined {
  return battle.battleStream.battle ?? undefined;
}

export function getSimSide(actor: BattleActor): SimSide | undefined {
  return getSimBattle(actor.battle)?.sides.find(side => side?.id === actor.showdownId);
}

/** Pokémon do simulador na posição ativa `slot` do ator. */
export function getSimActive(actor: BattleActor, slot: number): SimPokemon | undefined {
  return getSimSide(actor)?.active[slot] ?? undefined;
}

export function getSimPokemon(battle: PokemonBattle, uuid: string): SimPokemon | undefined {
  return findSimPokemon(getSimBattle(battle), uuid);
}

/** Golpes cujo alvo é escolhido pelo jogador em duplas/triplas. */
const TARGETED = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);

export interface TargetOption {
  /** Posição relativa do Showdown (1..3 inimigo, -1..-3 aliado). */
  loc: number;
  pokemon: SimPokemon;
  uuid: string;
  ally: boolean;
}

/**
 * Alvos possíveis de um golpe usado pelo Pokémon na posição `slot`.
 * @returns undefined quando o golpe não pede alvo (simples, ou alvo automático como "allAdjacentFoes").
 */
export function getTargetOptions(actor: BattleActor, slot: number, moveTarget: string): TargetOption[] | undefined {
  const sim = getSimBattle(actor.battle);
  const source = getSimActive(actor, slot);
  if (!sim || !source || sim.activePerHalf <= 1 || !TARGETED.has(moveTarget)) return undefined;
  const options: TargetOption[] = [];
  const half = sim.activePerHalf;
  for (const loc of [...range(1, half), ...range(1, half).map(x => -x)]) {
    if (!sim.validTargetLoc(loc, source, moveTarget as never)) continue;
    const target = source.getAtLoc(loc);
    if (!target || target.fainted || !target.hp) continue;
    if (target === source && moveTarget !== "adjacentAllyOrSelf") continue;
    options.push({ loc, pokemon: target, uuid: simPokemonUUID(target), ally: loc < 0 });
  }
  return options;
}

function range(from: number, to: number) {
  const output: number[] = [];
  for (let i = from; i <= to; i++) output.push(i);
  return output;
}

/** Multiplicador de tipo de um golpe contra um Pokémon (0, 0.25, 0.5, 1, 2, 4). */
export function typeMultiplier(moveType: string, defender: SimPokemon): number {
  const types = defender.getTypes();
  if (!Dex.getImmunity(moveType, types)) return 0;
  return Math.pow(2, Dex.getEffectiveness(moveType, types));
}

/** Pokémon ativos (vivos) dos lados inimigos do ator. */
export function getOpposingActive(actor: BattleActor): SimPokemon[] {
  const side = getSimSide(actor);
  if (!side) return [];
  return side.foes(true).filter(pokemon => pokemon && !pokemon.fainted && pokemon.hp > 0);
}
