import type { BattleActor } from "../BattleActor";
import type { ActiveMoveset, RequestData, RequestMove, RequestPokemon } from "../Request";
import { requestPokemonUUID } from "../Request";

/**
 * IA de batalha (K/api/battles/model/ai/BattleAI.kt). Recebe o request do Showdown e devolve a escolha
 * completa do ator (ex.: "move 1 +1, switch 3"). Pode consultar o estado do simulador via SimQueries.
 */
export interface BattleAI {
  choose(actor: BattleActor, request: RequestData): string;
}

export function isFaintedCondition(pokemon: RequestPokemon | undefined) {
  return !pokemon || pokemon.condition.endsWith(" fnt") || pokemon.condition.startsWith("0");
}

/** Reservas que podem entrar em campo (vivas, fora de campo e ainda não escolhidas neste turno). */
export function switchCandidates(request: RequestData, alreadyChosen: Set<number>): number[] {
  const output: number[] = [];
  request.side.pokemon.forEach((pokemon, index) => {
    if (pokemon.active || isFaintedCondition(pokemon) || alreadyChosen.has(index)) return;
    output.push(index);
  });
  return output;
}

/**
 * Monta a escolha de todas as posições. `chooseSlot` decide uma posição que precisa agir; posições
 * sem ação (desmaiado sem reserva, ou sem troca obrigatória) recebem "pass".
 */
export function buildChoice(
  request: RequestData,
  chooseSlot: (slot: number, forceSwitch: boolean, chosenSwitches: Set<number>) => string
): string {
  const chosenSwitches = new Set<number>();
  const slots = request.forceSwitch?.length ?? request.active?.length ?? 0;
  const parts: string[] = [];
  for (let slot = 0; slot < slots; slot++) {
    if (request.forceSwitch) {
      if (!request.forceSwitch[slot]) { parts.push("pass"); continue; }
      const candidates = switchCandidates(request, chosenSwitches);
      if (candidates.length === 0) { parts.push("pass"); continue; }
      parts.push(chooseSlot(slot, true, chosenSwitches));
      continue;
    }
    const pokemon = request.side.pokemon[slot];
    if (!request.active?.[slot] || isFaintedCondition(pokemon) || pokemon?.commanding) { parts.push("pass"); continue; }
    parts.push(chooseSlot(slot, false, chosenSwitches));
  }
  return parts.join(", ");
}

/** "switch N" (N = posição no time do request, a partir de 1) e marca como escolhido. */
export function switchTo(index: number, chosenSwitches: Set<number>) {
  chosenSwitches.add(index);
  return `switch ${index + 1}`;
}

export function uuidAt(request: RequestData, index: number) {
  return requestPokemonUUID(request.side.pokemon[index]);
}

export function randomOf<T>(array: T[], random: () => number = Math.random): T | undefined {
  return array.length ? array[Math.floor(random() * array.length)] : undefined;
}

/**
 * Golpe do request como o InBattleMove do Cobblemon: campos ausentes (golpe travado, Recharge) valem
 * pp = maxpp = 100 e alvo "self", que é o que o `mustBeUsed` reconhece.
 */
export interface InBattleMove {
  /** Posição no request (0 = "move 1"). */
  index: number;
  id: string;
  pp: number;
  maxpp: number;
  target: string;
  disabled: boolean;
}

export function parseMoveset(moveset: ActiveMoveset): InBattleMove[] {
  return moveset.moves.map((move: RequestMove, index) => ({
    index,
    id: move.id,
    pp: typeof move.pp === "number" ? move.pp : 100,
    maxpp: typeof move.maxpp === "number" ? move.maxpp : 100,
    target: move.target ?? "self",
    disabled: !!move.disabled,
  }));
}

/** InBattleMove.mustBeUsed: escolha forçada (Thrash, Recharge...). */
export function mustBeUsed(move: InBattleMove) {
  return move.maxpp === 100 && move.pp === 100 && move.target === "self";
}

/** InBattleMove.canBeUsed. */
export function canBeUsed(move: InBattleMove) {
  return (move.pp > 0 && !move.disabled) || mustBeUsed(move);
}
