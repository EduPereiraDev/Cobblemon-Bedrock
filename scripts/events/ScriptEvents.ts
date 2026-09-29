import { tryAprijuiceOnEntity } from "../pokemon/Aprijuice";
import { Entity, ItemStack, Player, ScriptEventCommandMessageAfterEvent, ScriptEventSource, system, world } from "@minecraft/server"
import { showPokemonGUI } from "../GUI";
import { PokemonData, setupCobblemon } from "../Pokemon";
import { battleMap, PokemonBattle, cleanUpStaleBattleData, BattleFormat, BattleSide, BattleActor, startWildBattle } from "../battle";
import { toID } from "../showdown";
import { registerDebugSettings } from "../debug/debugMain"
import { getSpeciesData } from "../speciesData";
import { storePokemonInFirstSpace } from "../pokemonStorage";
import handleChallenge, { hasDirectChallengeAction } from "../ChallengePlayer";
import { openPlayerInteractionMenu } from "../trade/PlayerInteraction";
import exchangeHeldItem from "./ExchangeHeldItem";
import handleInteractEvolution from "./InteractEvolution";
import handleGainLevelEvent from "./RareCandy";
import { useItemOnPokemonEntity } from "../items/usage";
import { tryPokemonInteraction } from "../entity";
import { K, isInBattle, tr } from "../GUI/common";
import { message } from "../language";
import { tryDyePokemon, trySlowpokeShear, tryStashItem } from "../pokemon/FeatureInteractions";
import { runJogabilidadeChecks } from "../pokemon/DebugChecks";
import { debugProbesEnabled, updateConfig } from "../Config";

export function scriptEventHandler(event: ScriptEventCommandMessageAfterEvent) {
  if (!event.id.startsWith("cobblemon:"))
    return;

  if (scriptIDDictionary[event.id]) {
    scriptIDDictionary[event.id](event);
  }
  else {
    let warning = `§4ScriptEvent ${event.id} is invalid!`;
    if (event.sourceEntity && event.sourceEntity instanceof Player) {
      let player = event.sourceEntity as Player
      player.sendMessage(warning);
    }
  }
}

const scriptIDDictionary: { [key: string]: Function } = {
  // Frente batalha-minimizavel: tratado em scripts/battle/BattleUiMode.ts (alias do /cobblemon:battleui; aqui só não avisa "inválido").
  "cobblemon:battle_ui_mode": function () { },
  // Tratado em scripts/world/index.ts (setRideCameraMode); aqui só não avisa "inválido".
  "cobblemon:ride_camera": function () { },
  // Tratado em scripts/debug/SelfTest.ts (alias do /cobblemon:selftest); aqui só não avisa "inválido".
  "cobblemon:selftest": function () { },
  "cobblemon:interacted": function (event: ScriptEventCommandMessageAfterEvent) {
    // O comando da fila roda depois: a entidade pode ter saído (recolhida, capturada) nesse meio tempo.
    const entity = event.sourceEntity;
    if (!entity?.isValid) return;
    let player = entity.dimension.getPlayers({ location: entity.location, tags: ["interacter"], closest: 1 })[0];
    if (!player) return;
    player.removeTag("interacter");
    handlePokemonInteract(player, entity);
  },
  "cobblemon:setup": function (event: ScriptEventCommandMessageAfterEvent) {
    const entity = event.sourceEntity;
    if (!entity?.isValid || entity.getProperty("cobblemon:initialized") === true)
      return;
    setupCobblemon(entity)
  },
  "cobblemon:update_self": function (event: ScriptEventCommandMessageAfterEvent) {
    //Ensures that the json data and state data are up to date
    if (!event.sourceEntity || !event.sourceEntity.getComponent("type_family")?.hasTypeFamily("pokemon"))
      return;
    let pokemonData = PokemonData.getFromEntity(event.sourceEntity);
    pokemonData.tryUpdatePokemonOut();
    pokemonData.tryUpdatePokemonInTeam();
  },
  "cobblemon:pokeball_thrown": function (event: ScriptEventCommandMessageAfterEvent) {
    // O dono já é registrado pelo projétil (catching/index.ts); só usa o jogador mais perto como último recurso.
    // Comando da fila do minecraft:entity_spawned: num arremesso à queima-roupa a bola já virou a dummy da captura
    // (catching/CaptureDummy) e saiu antes dele rodar.
    const ball = event.sourceEntity;
    if (!ball?.isValid || ball.getDynamicProperty("player_id") !== undefined) return;
    let player = ball.dimension.getPlayers({ location: ball.location, closest: 1 })[0];
    if (player) ball.setDynamicProperty("player_id", player.id);
  },
  "cobblemon:debug_setup": function () {
    registerDebugSettings();
  },
  "cobblemon:give_pokemon_to_self": function (event: ScriptEventCommandMessageAfterEvent) {
    if (!event.sourceEntity || !(event.sourceEntity instanceof Player)) return;
    let player = event.sourceEntity as Player;
    let messageArray = event.message.split(" ");
    if (!event.message || messageArray.length < 1 || messageArray.length > 3) {
      player.sendMessage("§c Syntax: command <species> <level?> <shiny?>");
      return;
    }
    let species = toID(messageArray[0]);
    let speciesData = getSpeciesData(species); //Make sure that data is accessible
    if (!speciesData) {
      player.sendMessage("§c Not Valid Cobblemon");
      return;
    }
    let level: number | undefined = undefined;
    if (messageArray.length >= 2 && !isNaN(parseInt(messageArray[1]))) {
      level = parseInt(messageArray[1]);
    }
    let shiny = messageArray.length >= 3 ? messageArray[2] === "shiny" || messageArray[2] === "true" : undefined;
    let pokemon = PokemonData.generateNewWildPokemon(species, { level, shiny });
    storePokemonInFirstSpace(pokemon, player);
  },
  "cobblemon:recieve_challenge": function (event: ScriptEventCommandMessageAfterEvent) {
    if (!event.sourceEntity || !(event.sourceEntity instanceof Player)) return;
    let player = event.sourceEntity as Player;
    let [challenger] = player.dimension.getEntities({ tags: ["challenger"], closest: 1, location: player.location });
    if (challenger === undefined || !(challenger instanceof Player))
      return;
    challenger.removeTag("challenger");
    // Batalha em andamento entre os dois ou desafio pendente: resolve direto. Senão, o menu de interação
    // (Batalha simples/dupla/tripla + Troca, scripts/trade/PlayerInteraction.ts) escolhe o formato.
    if (hasDirectChallengeAction(challenger, player)) handleChallenge(challenger, player);
    else void openPlayerInteractionMenu(challenger, player);
  },
  "cobblemon:interact_evolution": handleInteractEvolution,
  /**
   * Depuração pelo console do servidor: `scriptevent cobblemon:debug_battle pikachu eevee 20`.
   * Cria dois Pokémon selvagens no spawn do mundo e faz a IA batalhar entre eles. Só pelo console do servidor.
   */
  "cobblemon:debug_battle": function (event: ScriptEventCommandMessageAfterEvent) {
    if (event.sourceType !== ScriptEventSource.Server) return;
    const [first = "pikachu", second = "eevee", levelText = "20"] = event.message.trim().split(/\s+/);
    const dimension = world.getDimension("overworld");
    const spawn = world.getDefaultSpawnLocation();
    // Sem jogadores, o chunk do spawn pode ainda não estar carregado: tenta de novo por até 30 s.
    const attempts = Number((event as { attempts?: number }).attempts ?? 0);
    if (!dimension.isChunkLoaded({ x: spawn.x, y: 64, z: spawn.z })) {
      if (attempts < 30) system.runTimeout(() => scriptIDDictionary["cobblemon:debug_battle"]({ ...event, id: event.id, message: event.message, sourceType: event.sourceType, attempts: attempts + 1 }), 20);
      else console.warn("debug_battle: chunk do spawn não carregou");
      return;
    }
    const top = dimension.getTopmostBlock({ x: spawn.x, z: spawn.z });
    const location = { x: spawn.x + 0.5, y: (top?.y ?? 64) + 1, z: spawn.z + 0.5 };
    const level = parseInt(levelText) || 20;
    const actors = [first, second].map((species, i) => {
      const data = PokemonData.generateNewWildPokemon(species, { level });
      const entity = dimension.spawnEntity(data.getEntityId(), { ...location, x: location.x + i * 2 });
      data.applyToCobblemon(entity);
      entity.setProperty("cobblemon:wild", true);
      return new BattleActor(entity, [data]);
    });
    const battle = new PokemonBattle(BattleFormat.GEN_9_SINGLES, new BattleSide([actors[0]]), new BattleSide([actors[1]]));
    battle.mute = false;
    console.info(`debug_battle started: ${first} vs ${second} (L${level}) id=${battle.battleId}`);
  },
  /** Liga/desliga as sondas de depuração (md_*, ms_*, debug_visual, ianpc_*). Só pelo console do servidor. */
  "cobblemon:debug_probes": function (event: ScriptEventCommandMessageAfterEvent) {
    if (event.sourceType !== ScriptEventSource.Server) return;
    const on = /^(on|true|1|ligar)$/i.test(event.message.trim());
    updateConfig({ enableDebugProbes: on });
    console.info(`Sondas de depuração: ${debugProbesEnabled() ? "ligadas" : "desligadas"}`);
  },
  "cobblemon:gain_level": handleGainLevelEvent,
  /** Conferência da frente jogabilidade pelo console: `scriptevent cobblemon:debug_jogabilidade [all|alpha|honey|...]`. */
  "cobblemon:debug_jogabilidade": function (event: ScriptEventCommandMessageAfterEvent) {
    runJogabilidadeChecks(event.message ?? "");
  },
}

/**
 * Usa o item da mão num Pokémon do próprio jogador (remédios, doces, vitaminas, mints, TMs, itens de
 * evolução...). A lógica fica em scripts/items (frente "itens"). Retorna true se o item foi tratado.
 */
function useItemOnPokemon(player: Player, pokemon: Entity, item: ItemStack): boolean {
  return useItemOnPokemonEntity(player, pokemon, item);
}

/** Jogador interagiu (botão de usar) com um Pokémon: item, menu do próprio Pokémon, troca de item ou batalha selvagem. */
export function handlePokemonInteract(player: Player, pokemon: Entity, heldItem?: ItemStack) {
  // Ordem do PokemonEntity.mobInteract: tesoura (cauda do Slowpoke) e stash (Gimmighoul) antes do resto.
  if (trySlowpokeShear(player, pokemon, heldItem)) return;
  if (tryPokemonInteraction(player, pokemon, heldItem)) return;
  if (!isInBattle(player) && tryStashItem(player, pokemon, heldItem)) return;
  if (!isInBattle(player) && pokemon.getProperty("cobblemon:in_battle") !== true && tryDyePokemon(player, pokemon, heldItem)) return;
  cleanUpStaleBattleData(player);
  cleanUpStaleBattleData(pokemon);
  if (pokemon.getDynamicProperty("owner_name") === player.name) {
    // Aprijuice temperada (ride boosts): AprijuiceItem é um PokemonSelectingItem (frente dados-ui).
    if (heldItem && !player.isSneaking && !isInBattle(player) && tryAprijuiceOnEntity(player, pokemon, PokemonData.tryGetFromEntity(pokemon), heldItem))
      return;
    if (heldItem && !player.isSneaking && useItemOnPokemon(player, pokemon, heldItem))
      return;
    // Em batalha (jogador ou Pokémon), nada de trocar o item segurado nem abrir o menu do Pokémon.
    if (isInBattle(player) || pokemon.getProperty("cobblemon:in_battle") === true) {
      player.sendMessage(message.error(tr(K.inBattle)));
      return;
    }
    if (player.isSneaking) {
      exchangeHeldItem(player, pokemon);
    }
    else {
      showPokemonGUI(pokemon, player)
    }
  }
  //If starting a battle
  else if (pokemon.getProperty("cobblemon:wild") === true) {
    if (pokemon.getDynamicProperty("in_battle") && pokemon.getDynamicProperty("in_battle") === player.getDynamicProperty("in_battle")) {
      let battle = battleMap.get(player.getDynamicProperty("in_battle") as string);
      if (battle) {
        let actor = battle.getActorFromID(player.id);
        actor?.promptPlayerForRequest();
      }
    }
    else if (!pokemon.getDynamicProperty("in_battle") && !player.getDynamicProperty("in_battle") && player.getDynamicProperty("initialized")) {
      startWildBattle(player, pokemon);
    }
  }
}
