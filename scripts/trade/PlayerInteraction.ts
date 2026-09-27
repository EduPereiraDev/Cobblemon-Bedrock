/**
 * Menu de interação jogador → jogador (a "roda" de interação do Cobblemon, que no Bedrock vira um
 * ActionFormData): Batalha (simples/dupla/tripla, via ChallengePlayer da frente batalhas), equipe Multi
 * (Formar grupo / Batalha Multi / Abandonar grupo, frente multi) e Troca.
 *
 * Opções de equipe como no RequestInteractionsHandler do Cobblemon: os dois sem equipe → "Formar grupo"; em equipes
 * diferentes → "Batalha Multi"; na mesma equipe → "Abandonar grupo". Ao desafiar, a segunda tela escolhe a regra
 * de nível (BattleConfigureGUI: Luta Livre / Nível 50 / Nível 100 / Nível 5 para todos).
 */
import { Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { challengePlayer } from "../ChallengePlayer";
import { requestTradeWith, tradeManager } from "./TradeUI";
import { LEVEL_RULES, levelRuleText } from "../battle/TeamManager";
import { abandonMultiTeam, teamManager } from "../battle/Teams";

/**
 * `form.show()` que não rejeita: o jogador sair com a tela aberta (FormRejectError) vira "fechou" (undefined), sem
 * unhandled rejection. Outro erro com o jogador ainda no servidor é registrado.
 */
export async function showFormSafely<T>(player: Player, show: () => Promise<T>): Promise<T | undefined> {
  try {
    return await show();
  }
  catch (e) {
    let valid = false;
    try { valid = player.isValid; } catch { }
    if (valid) console.warn(`[cobblemon] menu de interação: ${e}`);
    return undefined;
  }
}

/** Tela da regra de nível do desafio; undefined se o jogador fechou ou saiu. */
export async function chooseLevelRule(player: Player, format: RawMessage): Promise<number | undefined> {
  const form = new ActionFormData().title(format);
  LEVEL_RULES.forEach(level => form.button(levelRuleText(level)));
  const response = await showFormSafely(player, () => form.show(player));
  if (!response || response.canceled || response.selection === undefined) return undefined;
  return LEVEL_RULES[response.selection];
}

export async function openPlayerInteractionMenu(player: Player, target: Player): Promise<void> {
  if (!player.isValid || !target.isValid || player.id === target.id) return;
  const actions: (() => void | Promise<void>)[] = [];
  const form = new ActionFormData().title({ text: target.name });
  const add = (text: RawMessage, action: () => void | Promise<void>) => {
    form.button(text);
    actions.push(action);
  };
  for (const format of ["singles", "doubles", "triples"] as const) {
    const name: RawMessage = { translate: `cobblemon.battle.types.${format}` };
    add(name, async () => {
      const level = await chooseLevelRule(player, name);
      if (level !== undefined && player.isValid && target.isValid) challengePlayer(player, target, format, level);
    });
  }
  addTeamOptions(player, target, add);
  add({ translate: "cobblemon.ui.interact.trade" }, () => requestTradeWith(player, target));
  // Pedido de troca pendente do outro: atalho para aceitar/recusar.
  const pending = tradeManager.getInboundRequests(player.id).find(r => r.sender.id === target.id);
  if (pending) add({ translate: "cobblemon.ui.interact.decline" }, () => tradeManager.declineRequest(player, pending.id));
  const response = await showFormSafely(player, () => form.show(player));
  if (!response || response.canceled || response.selection === undefined) return;
  await actions[response.selection]?.();
}

/** Botões de equipe Multi (RequestInteractionsHandler: TEAM_REQUEST / MULTI_BATTLE / TEAM_LEAVE). */
function addTeamOptions(player: Player, target: Player, add: (text: RawMessage, action: () => void | Promise<void>) => void) {
  const mine = teamManager.getTeam(player.id), theirs = teamManager.getTeam(target.id);
  const multi: RawMessage = { translate: "cobblemon.battle.types.multi" };
  if (mine && theirs && mine !== theirs) {
    // Desafio pendente da equipe do outro: o botão aceita (na regra escolhida por quem desafiou).
    if (teamManager.getChallenge(target.id, player.id)) add(multi, () => { teamManager.challengeTeam(player, target); });
    else add(multi, async () => {
      const level = await chooseLevelRule(player, multi);
      if (level !== undefined && player.isValid && target.isValid) teamManager.challengeTeam(player, target, level);
    });
    return;
  }
  if (mine && mine === theirs) {
    add({ translate: "cobblemon.ui.interact.team_leave" }, () => { abandonMultiTeam(player); });
    return;
  }
  if (!mine && !theirs) {
    add({ translate: "cobblemon.ui.interact.team_request" }, () => { teamManager.requestTeam(player, target); });
    // Convite pendente do outro: atalho para recusar (o botão acima aceita).
    const invite = teamManager.getTeamRequest(target.id, player.id);
    if (invite) add({ rawtext: [{ translate: "cobblemon.ui.interact.decline" }, { text: " (" }, { translate: "cobblemon.ui.interact.team_request" }, { text: ")" }] },
      () => teamManager.declineTeamRequest(player, invite.id));
  }
}
