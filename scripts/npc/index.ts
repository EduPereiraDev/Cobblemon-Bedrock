/**
 * Frente social: NPCs, diálogos e troca. `registerSocialEvents()` liga tudo aos eventos do mundo
 * (chamar uma vez em main.ts, no carregamento do script).
 */
import { Player, system, world } from "@minecraft/server";
import { ActorType, BattleActor, tryGetBattleFromEntity } from "../battle";
import { battleEntityReleaseHooks } from "../battle/PokemonBattle";
import { isTruthy } from "./molang/MoLang";
import { CobblemonEvents } from "../events/CobblemonEvents";
import {
  NPC, NPC_ENTITY_ID, VictoryActor, forgetNPCTasks, handleNPCBattleVictory, interactWithNPC, isNPCEntity, recordNPCHurt, setNPCNameLanguage,
  tryPromptNPCBattle,
} from "./NPCEntity";
import { tickNPCTasks } from "./NPCTasks";
import { debugProbesEnabled } from "../Config";
import { handleDebugBattleEvent, handleDebugBehavioursEvent } from "./DebugBattle";
import { onDialoguePlayerLeave } from "./dialogue/DialogueManager";
import { forgetMoLangData } from "./PlayerStruct";
import { onTradePlayerLeave } from "../trade/TradeUI";
import { startNpcPokemonModels } from "./PokemonModel"; // frente limites-a: NPC com modelo de Pokémon
import { shouldHideFrom, startNpcHide } from "./NpcHide"; // frente limites-a: NPC escondido por jogador

export {
  NPC, NPC_ENTITY_ID, interactWithNPC, spawnNPC, isNPCEntity, startTrainerBattle, openNPCDialogue, getNPCNameLanguage, setNPCNameLanguage,
} from "./NPCEntity";
export { getBehaviour, getBehaviourIds, getEditableBehaviours, registerBehaviour } from "./Behaviours";
export { registerPartyPool, registerPartyComposition } from "./Party";
export { getNPCClass, getNPCClassIds, getNPCPresetIds } from "./NPCClass";
export { getDialogue, getDialogueIds, registerDialogue } from "./dialogue/Dialogue";
export { startDialogue, stopDialogue, getActiveDialogue } from "./dialogue/DialogueManager";
export * from "./commands";
export { openPlayerInteractionMenu } from "../trade/PlayerInteraction";
export { requestTradeWith, tradeManager } from "../trade/TradeUI";

function toVictoryActor(actor: BattleActor): VictoryActor {
  if (actor.type === ActorType.NPC && isNPCEntity(actor.actor)) return { npc: new NPC(actor.actor) };
  if (actor.type === ActorType.PLAYER) return { player: actor.actor as Player };
  return { entity: actor.actor };
}

let registered = false;

export function registerSocialEvents() {
  if (registered) return;
  registered = true;

  // Fim de batalha: o NPC volta a passear/olhar conforme os behaviours dele.
  battleEntityReleaseHooks.push(entity => {
    if (entity.isValid && isNPCEntity(entity)) new NPC(entity).restoreAfterBattle();
  });

  // Interagir com o NPC: diálogo/script/batalha (ou reabrir o menu da batalha em andamento com ele).
  world.beforeEvents.playerInteractWithEntity.subscribe(event => {
    const { player, target } = event;
    if (target.typeId !== NPC_ENTITY_ID) return;
    event.cancel = true;
    // Frente limites-a: quem não vê o NPC (NPCEntity.shouldHideFrom) não interage com ele.
    if (shouldHideFrom(target, player)) return;
    system.run(() => {
      if (!player.isValid || !target.isValid) return;
      if (tryPromptNPCBattle(player, target)) return;
      interactWithNPC(player, target);
    });
  });

  // /summon cobblemon:npc (sem classe): vira um NPC "standard" nível 1, como o /spawnnpc sem argumentos extras.
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    if (!entity.isValid || entity.typeId !== NPC_ENTITY_ID || entity.getDynamicProperty("npc:class") !== undefined) return;
    try {
      entity.setDynamicProperty("npc:class", "cobblemon:standard");
      new NPC(entity).initialize(1);
    }
    catch (e) { console.warn(`NPC: não foi possível iniciar ${entity.id}: ${e}`); }
  });

  // Behaviours: reaplicados ao carregar (grupos de componentes, tarefas de script, tamanho e nameTag).
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    if (!isNPCEntity(entity) || entity.getDynamicProperty("npc:class") === undefined) return;
    try { new NPC(entity).onLoad(); }
    catch (e) { console.warn(`NPC: não foi possível recarregar ${entity.id}: ${e}`); }
  });
  world.afterEvents.entityRemove.subscribe(({ removedEntityId, typeId }) => {
    if (typeId === NPC_ENTITY_ID) forgetNPCTasks(removedEntityId);
  });
  // NPCs já carregados quando o script sobe (e os que o entityLoad não pegou): varredura a cada 30 s.
  const scan = () => {
    for (const id of ["overworld", "nether", "the_end"]) {
      try {
        for (const entity of world.getDimension(id).getEntities({ type: NPC_ENTITY_ID }))
          if (entity.getDynamicProperty("npc:class") !== undefined) new NPC(entity).applyBehaviours(false);
      }
      catch { }
    }
  };
  system.runTimeout(scan, 40);
  system.runInterval(scan, 600);
  // Tarefas de behaviour sem objetivo vanilla (casa, máquina de cura, olhar quem fala / a batalha).
  system.runInterval(() => tickNPCTasks(), 20);
  // Frente limites-a: modelo de Pokémon (resourceIdentifier de espécie) e NPC escondido por jogador.
  startNpcPokemonModels();
  startNpcHide();

  // Opções e verificação: idioma dos nameTags de NPC e batalha NPC × selvagem pelo console.
  system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
    if (id === "cobblemon:npc_name_language") {
      const ok = setNPCNameLanguage(message.trim());
      console.info(`NPC: idioma dos nomes ${ok ? `= ${message.trim()}` : `inválido (${message.trim()})`}`);
    }
    // Sondas ianpc_*: só com as sondas de depuração ligadas (config `enableDebugProbes`).
    else if (id === "cobblemon:ianpc_behaviours" && debugProbesEnabled()) {
      try { handleDebugBehavioursEvent(message); }
      catch (e) { console.warn(`ia-npc: behaviours de teste falharam: ${e}`); }
    }
    else if (id === "cobblemon:ianpc_battle" && debugProbesEnabled()) {
      try { handleDebugBattleEvent(message, sourceEntity); }
      catch (e) { console.warn(`ia-npc: batalha de teste falhou: ${e}`); }
    }
  });

  // exit_battle_when_hurt (battler): NPC ferido em batalha encerra as batalhas dele; dano sem atacante só com
  // exit_battle_from_passive_damage.
  world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
    if (!isNPCEntity(hurtEntity)) return;
    try {
      const npc = new NPC(hurtEntity);
      if (!npc.behaviourTasks.has("exit_battle_when_hurt")) return;
      const config = npc.getConfig();
      if (!isTruthy(config.exit_battle_when_hurt)) return;
      if (!damageSource.damagingEntity && !isTruthy(config.exit_battle_from_passive_damage)) return;
      tryGetBattleFromEntity(hurtEntity)?.stop();
    }
    catch (e) { console.warn(`NPC: exit_battle_when_hurt falhou: ${e}`); }
  });

  // q.npc.was_hurt_by: guarda quem bateu (o dano vale, salvo NPC de classe invulnerável).
  world.afterEvents.entityHitEntity.subscribe(({ damagingEntity, hitEntity }) => recordNPCHurt(hitEntity, damagingEntity));

  // Cada limpeza isolada: uma exceção numa não impede as outras.
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    for (const cleanup of [onTradePlayerLeave, onDialoguePlayerLeave, forgetMoLangData]) {
      try { cleanup(playerId); }
      catch (e) { console.warn(`Social: limpeza de ${playerId} falhou: ${e}`); }
    }
  });

  CobblemonEvents.on("BATTLE_VICTORY", (battle, winners, losers) => {
    if (![...winners, ...losers].some(a => a.type === ActorType.NPC)) return;
    try { handleNPCBattleVictory(winners.map(toVictoryActor), losers.map(toVictoryActor), battle.battleId); }
    catch (e) { console.warn(`NPC: fim de batalha: ${e}`); }
  });
}
