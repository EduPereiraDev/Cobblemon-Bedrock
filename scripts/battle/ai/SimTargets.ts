import type { SimBattle, SimPokemon } from "../../showdown";
import type { InBattleMove } from "./BattleAI";
import { mustBeUsed } from "./BattleAI";

/** Alvos que o Showdown exige escolher em duplas/triplas. */
export const CHOSEN_TARGETS = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);

/**
 * "move N [alvo]" para o Showdown. Em simples o alvo é dispensado (o Cobblemon manda, o Showdown ignora); em
 * duplas/triplas garante uma posição que o Showdown aceite: a do alvo escolhido, senão a de um Pokémon vivo válido,
 * senão qualquer posição válida (ex.: Helping Hand sem aliado — o golpe falha, mas a escolha é aceita).
 */
export function moveChoice(battle: SimBattle, move: InBattleMove, self: SimPokemon, target?: SimPokemon): string {
  const base = `move ${move.index + 1}`;
  if (battle.activePerHalf <= 1 || mustBeUsed(move) || !CHOSEN_TARGETS.has(move.target)) return base;
  let loc = target ? self.getLocOf(target) : 0;
  if (!loc || !battle.validTargetLoc(loc, self, move.target as never)) {
    const ownLoc = self.getLocOf(self);
    const candidates = [...range(battle.activePerHalf), ...range(battle.activePerHalf).map(x => -x)]
      .filter(x => (x !== ownLoc || move.target === "adjacentAllyOrSelf") && battle.validTargetLoc(x, self, move.target as never));
    loc = candidates.find(x => { const at = self.getAtLoc(x); return !!at && !at.fainted; }) ?? candidates[0] ?? 0;
  }
  return loc ? `${base} ${loc > 0 ? "+" : ""}${loc}` : base;
}

function range(count: number) {
  return Array.from({ length: count }, (_, i) => i + 1);
}
