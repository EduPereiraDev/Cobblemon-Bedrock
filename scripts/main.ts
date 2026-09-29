/** This file should be used only for event bindings and such. */
import { BOOT_STARTED } from "./bootTimer";

import { Entity, Player, system, world } from "@minecraft/server"
import { ActionFormData } from "@minecraft/server-ui";
import { openPartyMenu, startPartyHud } from "./GUI";
import { PokemonData } from "./Pokemon";
import { getSafeTeam } from "./pokemonStorage";
import { registerCustomComponents } from "./custom_components";
import { setupCobblemon } from "./Pokemon";
import { registerCommands } from "./commands";
import { hasSelectedStarter, hasTeam, offerStarter, promptStarterOnJoin, startStarterReminder } from "./starter";
import WorldCleanup from "./Cleanup";
import { message } from "./language";
import { bindCatchEvents } from "./catching";
import { isCaptureInProgress } from "./catching/CaptureSequence";
import { isTrackedPlatform, PLATFORM_ENTITY } from "./battle/Platform";
import { isBattleMock, resolveMockTarget } from "./battle/effects/Mock";
import { scriptEventHandler } from "./events";
import { handlePokemonInteract } from "./events/ScriptEvents";
import { startSpawner } from "./spawning/Spawner";
import { startEntityBehaviours } from "./entity";
import { startWorld } from "./world";
import { startMachines } from "./machines";
import { registerSocialEvents } from "./npc";
import { NPC_MODEL_TAG } from "./npc/PokemonModel";
import { setDexData } from "./pokedex";
import { DEXES, DEX_ENTRIES } from "../generated/scripts/dex";
import { BATTLE_CLONE_TAG } from "./Pokemon";
import { shouldThrowOnEntityInteract, throwPokeBall } from "./catching/ThrowBall";
import { battleMap, isPlayerInAnyBattle, startSpectating } from "./battle";
import { getConfig } from "./Config";
import { requestTradeWith } from "./trade/TradeUI";
import { attemptBlockClickEvolutions } from "./evolution/BlockClick";
import { isEvolving } from "./evolution/EvolutionEffect";
import { setPassiveBattleCheck, setPassiveBusyCheck, startPassivePartyTick } from "./pokemon/PassiveHealing";
import { registerGameplayHooks } from "./pokemon/GameplayHooks";
import { startSleepHeal } from "./pokemon/SleepHeal";
import { startBlocksTraveled } from "./pokemon/BlocksTraveled";
import { startProximityEffects } from "./pokemon/ProximityEffects";
import { startVisualFinal } from "./visual"; // frente visual-final: partículas de aspect e Nosepass
import { startPartySelection } from "./pokemon/PartySelection";
import { grantDefaultKeyItems } from "./pokemon/KeyItems";
import { watchSlatheredLogs } from "./spawning/HoneyLog";
import { startWildBattle } from "./battle";
import { openPlayerInteractionMenu } from "./trade/PlayerInteraction";
import { STUDIO_TAG, isOrphanStudioEntity, startStudio } from "./ui/studio";
import { registerStatHandlers } from "./events/StatHandler";
import { registerLimitPrototypes } from "./experimental/limits"; // pesquisa 8: protótipos desligados por padrão
import { startAdaptacoes } from "./adaptacoes"; // frente adaptacoes: funil/comparador da panela, abelhas, dispenser, vaso, Mental Herb
import { startComparadores } from "./comparadores"; // frente comparadores: comparador da Healing Machine e do Metronome
import { startLimitesB } from "./limitesB"; // frente limites-b: pinturas, enfermeira, fazendeiro, estruturas vanilla
import { handleControlPokemonInteract, isControlItem, startControlItem } from "./controle"; // frente controle: Poké Ball do time
// Extensão Mega Showdown: privada (fora do repositório público). `@private/*` resolve pelo `paths` do tsconfig para
// scripts/extensions/megaShowdown/ quando existe e para extensions/privateStub.ts quando não (e sempre no build público).
import { isMegaShowdownActive, startMegaShowdown } from "@private/mega-showdown"; // frente msd-infra: extensão Mega Showdown (dormente sem o pack)
import { startMegaShowdownContent } from "@private/mega-showdown/content"; // frente msd-conteudo: espécies, spawns e conquistas do MSD


// Emote continua como atalho (console não tem tecla de time): abre o menu do time, ou a escolha do inicial.
world.afterEvents.playerEmote.subscribe(({ player }) => {
  if (hasTeam(player)) void openPartyMenu(player);
  else void offerStarter(player);
});

// Login sem inicial: oferece a escolha depois que o mundo terminar de carregar para o jogador
// (respeita allowStarterOnJoin/promptStarterOnceOnly da config).
startStarterReminder();
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn && !hasTeam(player))
    system.runTimeout(() => { if (player.isValid) void promptStarterOnJoin(player); }, 100);
  // GeneralPlayerData.initialize: itens-chave padrão da config.
  if (initialSpawn) {
    try { grantDefaultKeyItems(player); }
    catch (e) { console.warn(`Itens-chave: ${e}`); }
  }
});

// Pokémon que surgem sem dados (ovo de spawn, /summon) viram selvagens com dados gerados.
world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (!entity.isValid || !entity.typeId.startsWith("cobblemon:")) return;
  if (!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon")) return;
  // Modelo de exibição do estúdio de câmera (frente telas): sem dados de selvagem.
  if (entity.hasTag(STUDIO_TAG)) return;
  // getProperty não enxerga setProperty do mesmo tick; a dynamic property "data" é síncrona.
  if (entity.getDynamicProperty("data") !== undefined) return;
  try { setupCobblemon(entity); }
  catch (e) { console.warn(`Não foi possível iniciar ${entity.typeId}: ${e}`); }
});

// Usar (clique direito / toque) num Pokémon. O before-event roda em modo restrito, então a ação vai para o próximo tick.
world.beforeEvents.playerInteractWithEntity.subscribe(event => {
  const { player, target } = event;
  // Jogador em batalha, sem estar em batalha: "Assistir" (ou trocar), como a roda de interação do Cobblemon.
  if (target instanceof Player) {
    if (!getConfig().allowSpectating || !isPlayerInAnyBattle(target) || isPlayerInAnyBattle(player)) return;
    event.cancel = true;
    system.run(() => { if (player.isValid && target.isValid) void openBattlingPlayerMenu(player, target); });
    return;
  }
  if (!target.typeId.startsWith("cobblemon:") || !target.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon")) return;
  let heldItem = event.itemStack;
  // Com a Pokédex na mão, o clique é o scanner da Pokédex, não interação com o Pokémon.
  if (heldItem?.typeId.startsWith("cobblemon:pokedex")) return;
  // Frente controle: com a Poké Ball do time, agachado + usar num selvagem = batalha com o selecionado e no próprio
  // Pokémon = montar (ou o menu dele); no resto, a interação é a de mão vazia (o item nunca vai para o Pokémon).
  if (isControlItem(heldItem?.typeId)) {
    if (handleControlPokemonInteract(event)) return;
    heldItem = undefined;
  }
  event.cancel = true;
  // Frente ui-cliente: com Poké Ball na mão, usar mirando o Pokémon arremessa (no Bedrock a mira na entidade troca o
  // itemUse por esta interação; no Java o mobInteract passa e o PokeBallItem.use arremessa).
  if (heldItem && shouldThrowOnEntityInteract(heldItem.typeId, {
    sneaking: player.isSneaking, isPokemon: true, isBattleClone: target.hasTag(BATTLE_CLONE_TAG), isNpcModel: target.hasTag(NPC_MODEL_TAG),
  })) {
    const ballItem = heldItem.typeId;
    system.run(() => { if (player.isValid) throwPokeBall(player, ballItem); });
    return;
  }
  // Clone de batalha (cloneParties/setLevel): sem interação (InteractPokemonHandler ignora isBattleClone).
  if (target.hasTag(BATTLE_CLONE_TAG)) return;
  // Exibição do NPC com modelo de Pokémon: o clique é do NPC (scripts/npc/PokemonModel.ts), não de um Pokémon.
  if (target.hasTag(NPC_MODEL_TAG)) return;
  // Pokémon numa batalha da qual o jogador não participa: assistir (ChallengeHandler mira o dono/a batalha).
  const spectate = getConfig().allowSpectating && isEntityInBattle(target) && !isPlayerInAnyBattle(player);
  system.run(() => {
    if (!player.isValid || !target.isValid) return;
    if (spectate) startSpectating(player, target);
    else handlePokemonInteract(player, target, heldItem);
  });
});

/** A entidade está numa batalha ativa (dynamic property "in_battle" com batalha existente). */
function isEntityInBattle(entity: Entity): boolean {
  const id = entity.getDynamicProperty("in_battle");
  return typeof id === "string" && battleMap.has(id);
}

/** Roda de interação com um jogador em batalha: Assistir e Trocar (RequestInteractionsHandler). */
async function openBattlingPlayerMenu(player: Player, target: Player) {
  const response = await new ActionFormData()
    .title({ text: target.name })
    .button({ translate: "cobblemon.ui.interact.spectate" })
    .button({ translate: "cobblemon.ui.interact.trade" })
    .show(player);
  if (response.canceled || response.selection === undefined || !player.isValid || !target.isValid) return;
  if (response.selection === 0) startSpectating(player, target);
  else requestTradeWith(player, target);
}

// Clique direito num bloco: evoluções `block_click` do time (PlatformEvents.RIGHT_CLICK_BLOCK).
world.afterEvents.playerInteractWithBlock.subscribe(({ player, block }) => {
  try { attemptBlockClickEvolutions(player, block.typeId); }
  catch (e) { console.warn(`block_click: ${e}`); }
});

system.beforeEvents.startup.subscribe(event => {
  registerCustomComponents(event);
  registerCommands(event);
});

//World cleanup stuff
world.afterEvents.worldLoad.subscribe(event => {
  WorldCleanup(event);
  startSpawner();
  startMachines();
  startEntityBehaviours();
  startWorld(); // registro de estruturas, vilas, dano por Pokémon, música de batalha, câmera de montaria
  startPartyHud();
  // Estúdio de câmera das telas: limpa sobras de uma queda e liga a limpeza automática.
  startStudio();
  system.runInterval(passiveFriendship, PASSIVE_FRIENDSHIP_TICKS);
  // Cura passiva, timer de desmaio, status fora de batalha e marca de parceiro (1 s por jogador).
  setPassiveBattleCheck(isPlayerInAnyBattle);
  setPassiveBusyCheck(isEvolving);
  startPassivePartyTick();
  // Frente jogabilidade: gamerules/Alfa/fome, cura ao dormir, passos, brilho de shiny e rótulos, tora com mel e
  // envio rápido (agachar + pular; agachar duas vezes troca o selecionado).
  registerGameplayHooks(isPlayerInAnyBattle);
  startSleepHeal(isPlayerInAnyBattle, (_player, team) => team.forEach(pokemon => { try { pokemon?.tryUpdatePokemonOut(); } catch { } }));
  startBlocksTraveled();
  startProximityEffects();
  startVisualFinal();
  // Frente dados-ui: estatísticas de jogador (StatHandler: batalhas e distância montado).
  registerStatHandlers();
  watchSlatheredLogs();
  startAdaptacoes();
  startComparadores();
  startLimitesB();
  const msdStarted = Date.now(); // frente msd-fase2: custo da extensão no tick do worldLoad (watchdog)
  startMegaShowdown(); // frente msd-infra: só liga com o pack CobblemonMegaShowdown no mundo
  startMegaShowdownContent(); // frente msd-conteudo: tabelas do MSD, só com o pack no mundo
  if (isMegaShowdownActive()) console.info(`Cobblemon Bedrock: Mega Showdown no worldLoad em ${Date.now() - msdStarted} ms`);
  startPartySelection({
    inBattle: isPlayerInAnyBattle,
    reopenBattle: player => {
      const id = player.getDynamicProperty("in_battle");
      // Frente batalha-minimizavel: a "tecla R" alterna minimizado/aberto (PartySendBinding.toggleBattleScreen).
      if (typeof id === "string") battleMap.get(id)?.getActorFromID(player.id)?.promptPlayerForRequest("toggle");
    },
    startWildBattle: (player, wild) => { startWildBattle(player, wild); },
    openPlayerMenu: (player, target) => { void openPlayerInteractionMenu(player, target); },
  });
  // Frente controle: item "Poké Ball do time" (usar = time, agachado + usar = envio rápido, agachado + atacar = próximo).
  startControlItem({
    inBattle: isPlayerInAnyBattle,
    hasTeam,
    openParty: player => { void openPartyMenu(player); },
    offerStarter: player => { void offerStarter(player); },
    hasSelectedStarter,
  });
});

/**
 * Amizade passiva (PlayerPartyStore.kt): a cada 120 s, cada Pokémon do time fora da bola com
 * amizade < 160 ganha 1. Um jogador por tick (runJob) para não pesar.
 */
const PASSIVE_FRIENDSHIP_TICKS = 120 * 20;
function passiveFriendship() {
  const players = world.getPlayers();
  system.runJob((function* () {
    for (const player of players) {
      if (!player.isValid) continue;
      let changed = false;
      const team = getSafeTeam(player);
      team.forEach((stored, i) => {
        if (!stored || stored.friendship >= 160) return;
        const entity = stored.tryGetPokemonOut();
        if (!entity) return;
        const live = PokemonData.tryGetFromEntity(entity) ?? stored;
        if (!live.addFriendship(1)) return;
        team[i] = live;
        live.tryUpdatePokemonOut();
        changed = true;
      });
      if (changed) player.setDynamicProperty("team", JSON.stringify(team));
      yield;
    }
  })());
}
/**
 * Disfarce de batalha (Illusion/Transform) carregado do disco: sem batalha viva (in_battle ausente ou fora do
 * battleMap), o Pokémon real por trás volta a aparecer. Com batalha viva o followMock já faz isso.
 */
function revealStaleMockTarget(mock: Entity) {
  try {
    const real = resolveMockTarget(mock);
    if (real === mock || !real.isValid) return;
    const battleId = real.getDynamicProperty("in_battle");
    if (typeof battleId === "string" && battleMap.has(battleId)) return;
    real.removeEffect("invisibility");
  }
  catch { }
}

world.afterEvents.entityLoad.subscribe(arg => {
  // A entidade pode ter sumido no mesmo tick em que carregou.
  if (!arg.entity.isValid) return;
  // Balsa de batalha carregada do disco (sobra de queda/chunk descarregado): só fica se uma batalha desta sessão a usa.
  if (arg.entity.typeId === PLATFORM_ENTITY) {
    if (!isTrackedPlatform(arg.entity)) arg.entity.remove();
    return;
  }
  let familyComponent = arg.entity.getComponent("minecraft:type_family");
  if (!familyComponent)
    return;

  // Modelo do estúdio de câmera sem sessão (chunk recarregado depois de uma queda): remove.
  if (isOrphanStudioEntity(arg.entity)) {
    if (isBattleMock(arg.entity)) revealStaleMockTarget(arg.entity);
    arg.entity.remove();
    return;
  }

  // Remove bolas velhas carregadas do disco. Uma bola com captura em andamento (registrada em memória pelo
  // CaptureSequence) pode disparar entityLoad no meio da sequência e não pode morrer (E2E-3).
  if (familyComponent.hasTypeFamily("pokeball") || familyComponent.hasTypeFamily("pokeball_dummy")) {
    if (!isCaptureInProgress(arg.entity)) arg.entity.triggerEvent("cobblemon:instant_kill");
    return;
  }

  //Prevents Shenanigans with duplicating pokemon by unloading them
  if (familyComponent.hasTypeFamily("pokemon") && arg.entity.getDynamicProperty("owner_name")) {
    arg.entity.triggerEvent("cobblemon:instant_kill");
  }
})

bindCatchEvents();
// NPCs (interação, /summon, golpes, saída de jogador, vitória em batalha) e troca.
registerSocialEvents();
// Pokédex exatas do Cobblemon (dexes + dex_entries); a montagem é preguiçosa (na primeira consulta).
setDexData(DEXES, DEX_ENTRIES);

system.afterEvents.scriptEventReceive.subscribe(scriptEventHandler);
registerLimitPrototypes();
console.info(`Cobblemon Bedrock: scripts carregados em ${Date.now() - BOOT_STARTED} ms`);
