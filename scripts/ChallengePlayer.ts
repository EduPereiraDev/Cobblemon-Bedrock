import { Player, system } from "@minecraft/server";
import { battleMap, BattleFormat, cleanUpStaleBattleData, playerBattleLead, startPvPBattle, tryGetBattleFromEntity } from "./battle";
import { EntityUtils } from "./utils";
import { getConfig } from "./Config";
import { message } from "./language";
import { levelRuleText } from "./battle/TeamManager";

/** ChallengeManager.kt: desafios PvP pendentes (desafiado → desafiantes), com o formato escolhido. */
interface PendingChallenge {
  challengerId: string;
  format: "singles" | "doubles" | "triples";
  /** BattleFormat.adjustLevel (5/50/100); 0 = "Anything Goes". Frente multi. */
  level: number;
  expiresAt: number;
  /** Lead do desafiante no momento do desafio (ChallengeManager.setLead no ChallengeHandler). */
  challengerLead?: string;
}

const activeChallenges: Map<string, PendingChallenge[]> = new Map();
/** 60 s, como o `challengeExpiry` padrão do Cobblemon. */
const ticksUntilChallengeExpires = 1200;

function formatName(format: PendingChallenge["format"]) {
  return { translate: `cobblemon.battle.types.${format}` };
}

function withinPvPDistance(a: Player, b: Player) {
  if (a.dimension.id != b.dimension.id)
    return false;
  let max = (getConfig() as unknown as Record<string, unknown>).battlePvPMaxDistance;
  return EntityUtils.DistanceBetween(a.location, b.location) <= (typeof max == "number" ? max : 32);
}

/**
 * Interação jogador → jogador: reabre o menu se já batalham entre si, aceita um desafio pendente do outro
 * ou envia um desafio novo (no formato pedido; padrão singles).
 */
export default function handleChallenge(challenger: Player, challengee: Player, format: PendingChallenge["format"] = "singles", level = 0) {
  cleanUpStaleBattleData(challenger);
  cleanUpStaleBattleData(challengee);

  let challengerInBattle = challenger.getDynamicProperty("in_battle");
  //If they are already in a battle together
  if (challengerInBattle && challengerInBattle === challengee.getDynamicProperty("in_battle")) {
    let battle = battleMap.get(challengerInBattle as string);
    battle?.getActorFromID(challenger.id)?.promptPlayerForRequest();
    return;
  }

  if (tryGetBattleFromEntity(challenger)) {
    challenger.sendMessage(message.error({ translate: "cobblemon.battle.error.in_battle.personal" }));
    return;
  }
  if (tryGetBattleFromEntity(challengee)) {
    challenger.sendMessage(message.error(message.With("cobblemon.battle.error.in_battle", [challengee.name])));
    return;
  }
  if (!withinPvPDistance(challenger, challengee)) {
    challenger.sendMessage(message.error({ translate: "cobblemon.ui.interact.too_far" }));
    return;
  }

  //If Player is accepting a challenge
  let pending = activeChallenges.get(challenger.id)?.find(x => x.challengerId == challengee.id && x.expiresAt > system.currentTick);
  if (pending) {
    acceptChallenge(challenger, challengee, pending);
    return;
  }

  let sent = activeChallenges.get(challengee.id)?.find(x => x.challengerId == challenger.id && x.expiresAt > system.currentTick);
  if (sent) {
    challenger.sendMessage(message.error(message.With("cobblemon.challenge.error.duplicate", [challengee.name])));
    return;
  }
  issueChallenge(challenger, challengee, format, level);
}

/**
 * A interação com o outro jogador resolve direto (sem menu): já batalham entre si (reabre o menu da batalha)
 * ou há um desafio pendente do outro (aceita, no formato escolhido por ele).
 */
export function hasDirectChallengeAction(challenger: Player, challengee: Player): boolean {
  const battleId = challenger.getDynamicProperty("in_battle");
  if (battleId && battleId === challengee.getDynamicProperty("in_battle") && battleMap.has(battleId as string)) return true;
  return !!activeChallenges.get(challenger.id)?.some(x => x.challengerId == challengee.id && x.expiresAt > system.currentTick);
}

/** Desafio com formato explícito (menu de interação da frente social/UI) e regra de nível (0 = livre). */
export function challengePlayer(challenger: Player, challengee: Player, format: PendingChallenge["format"], level = 0) {
  handleChallenge(challenger, challengee, format, level);
}

function issueChallenge(challenger: Player, challengee: Player, format: PendingChallenge["format"], level: number) {
  let list = activeChallenges.get(challengee.id) ?? [];
  list.push({ challengerId: challenger.id, format, level, expiresAt: system.currentTick + ticksUntilChallengeExpires, challengerLead: playerBattleLead(challenger) });
  activeChallenges.set(challengee.id, list);
  challenger.sendMessage(message.With("cobblemon.challenge.sent", [challengee.name, formatName(format)]));
  challengee.sendMessage(message.With("cobblemon.challenge.received", [challenger.name, formatName(format)]));
  // A tela do Cobblemon mostra a regra de nível do desafio recebido; aqui ela vai no chat.
  if (level > 0) {
    challenger.sendMessage(levelRuleText(level));
    challengee.sendMessage(levelRuleText(level));
  }
  system.runTimeout(() => {
    if (removeChallenge(challenger.id, challengee.id)) {
      if (challenger.isValid)
        challenger.sendMessage(message.With("cobblemon.challenge.expired.sender", [challengee.isValid ? challengee.name : "?"]));
      if (challengee.isValid)
        challengee.sendMessage(message.With("cobblemon.challenge.expired.receiver", [challenger.isValid ? challenger.name : "?"]));
    }
  }, ticksUntilChallengeExpires);
}

function acceptChallenge(accepter: Player, challenger: Player, challenge: PendingChallenge) {
  removeChallenge(challenger.id, accepter.id);
  accepter.sendMessage(message.With("cobblemon.challenge.accept.receiver", [challenger.name]));
  challenger.sendMessage(message.With("cobblemon.challenge.accept.sender", [accepter.name]));
  // pvp1v1 com o lead de cada um: o do desafiante guardado no desafio e o de quem aceita agora (ChallengeResponseHandler).
  let leads = [challenge.challengerLead, playerBattleLead(accepter)];
  startPvPBattle(challenger, accepter, BattleFormat.fromName(challenge.format), challenge.level > 0 ? { team: { setLevel: challenge.level }, leads } : { leads });
}

/** Remove o desafio; true se ele existia. */
function removeChallenge(challengerId: string, challengeeId: string): boolean {
  let list = activeChallenges.get(challengeeId);
  if (!list)
    return false;
  let index = list.findIndex(x => x.challengerId == challengerId);
  if (index == -1)
    return false;
  list.splice(index, 1);
  if (list.length == 0)
    activeChallenges.delete(challengeeId);
  return true;
}
