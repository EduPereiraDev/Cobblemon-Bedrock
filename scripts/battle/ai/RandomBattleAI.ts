import type { BattleActor } from "../BattleActor";
import type { RequestData } from "../Request";
import { getSimActive, getSimBattle, getTargetOptions } from "../SimQueries";
import { moveChoice } from "./SimTargets";
import { BattleAI, buildChoice, canBeUsed, mustBeUsed, parseMoveset, randomOf, switchCandidates, switchTo } from "./BattleAI";

/**
 * RandomBattleAI.kt: troca aleatória quando obrigado (sem reserva: passa); senão um golpe usável
 * (`canBeUsed`) aleatório — sem nenhum, Struggle — num alvo aleatório, preferindo inimigos; golpe
 * obrigatório vai sem alvo. Usada pelos Pokémon selvagens, como no Cobblemon.
 */
export class RandomBattleAI implements BattleAI {
  constructor(private readonly random: () => number = Math.random) { }

  choose(actor: BattleActor, request: RequestData): string {
    return buildChoice(request, (slot, forceSwitch, chosenSwitches) => randomSlotChoice(actor, request, slot, forceSwitch, chosenSwitches, this.random));
  }
}

/** Decisão aleatória de uma posição (também é a de quem erra o teste de habilidade na StrongBattleAI). */
export function randomSlotChoice(actor: BattleActor, request: RequestData, slot: number, forceSwitch: boolean, chosenSwitches: Set<number>, random: () => number = Math.random): string {
  if (forceSwitch) {
    const index = randomOf(switchCandidates(request, chosenSwitches), random);
    return index === undefined ? "pass" : switchTo(index, chosenSwitches);
  }
  return chooseRandomMove(actor, request, slot, random);
}

export function chooseRandomMove(actor: BattleActor, request: RequestData, slot: number, random: () => number = Math.random): string {
  const moveset = request.active?.[slot];
  if (!moveset) return "pass";
  const moves = parseMoveset(moveset);
  const move = randomOf(moves.filter(canBeUsed), random);
  if (!move) {
    const struggle = moves.find(x => x.id === "struggle");
    return `move ${(struggle?.index ?? 0) + 1}`;
  }
  if (mustBeUsed(move)) return `move ${move.index + 1}`;
  const targets = getTargetOptions(actor, slot, move.target);
  const target = targets && targets.length ? randomOf(targets.filter(x => !x.ally), random) ?? randomOf(targets, random)! : undefined;
  const battle = getSimBattle(actor.battle);
  const self = getSimActive(actor, slot);
  if (battle && self) return moveChoice(battle, move, self, target?.pokemon);
  return target ? `move ${move.index + 1} ${target.loc > 0 ? "+" : ""}${target.loc}` : `move ${move.index + 1}`;
}
