import { RawMessage, system, Vector3 } from "@minecraft/server";
import { ActorType, BattleActor } from "./BattleActor";
import { BattleMessage, Effect, EffectType } from "./BattleMessage";
import { PokemonBattle } from "./PokemonBattle";
import { ColorCodes, getMoveTranslation, message as messages } from "../language";
import { battleMap } from "./PokemonBattle";
import { RequestData } from "./Request";
import { GoDispatch, WaitDispatch } from "./Dispatcher";
import { CobblemonEvents } from "../events";
import { calculateExpGain } from "../Experience";
import { ActivePokemon } from ".";
import { Vector3Utils, Vector3Builder } from "@minecraft/math";
import { substringAfter, toDimensionLocation, toID, toIdentifier } from "../utils";
import { ElementalType, PersistentStatuses, PokemonData, StatusEffect } from "../Pokemon";
import DamageTakenRequirement from "../evolution/requirements/DamageTakenRequirement";
import { EvolutionProgress, getEvolutionProgress, setEvolutionProgress } from "../evolution";
import UseMoveRequirement from "../evolution/requirements/UseMoveRequirement";
import DefeatRequirement from "../evolution/requirements/DefeatRequirement";
import { Dex } from "../showdown";
import BattleCriticalHitsRequirement from "../evolution/requirements/BattleCriticalHitsRequirement";
import RecoilRequirement from "../evolution/requirements/RecoilRequirement";
import { battleMsg } from "../language/MessageHelperFunctions";
import { playCry, playFaintAnimation, playHurtAnimation, playMoveAnimation } from "./Animations";
// Frente animacao: efeitos de golpe/dano/desmaio (action_effects do Cobblemon).
import { playDamageEffect, playFaintEffect, playMoveEffects } from "./effects";
// Frente visual-batalha: status/boost (action_effects), Illusion/Transform, trocas com bola e balsa.
import { playActivateEffect, playBoostEffect, playCantEffect, playPrepareEffect, playStartEffect } from "./effects";
import { endMock, startMock } from "./effects/Mock";
import { endIllusion, midBattleSwitch, startOfBattleSwitch } from "./Switching";
import { removePlatform } from "./Platform";
import { dropWildLoot } from "./Rewards";
import { giveBagItem } from "./BagItems";
import { winMessage } from "./PokemonBattle";

/** <UUID of Battle, Last Used Ability, activate, etc> */
const lastCauser = new Map<string, BattleMessage>();

export function interpretMessage(battleId: string, message: string) {
  //Ignore winner summary
  if (message.startsWith(`{"winner":`))
    return;

  let battle = battleMap.get(battleId);
  if (!battle) {
    console.log("No battle could be found with the id: " + battleId);
    return
  }

  battle.showdownMessages.push(message);
  interpret(battle, message);
}

export function interpret(battle: PokemonBattle, rawMessage: string) {
  battle.log();
  battle.log(rawMessage);
  battle.log();
  let lines = rawMessage.split("\n");
  if (lines[0] == "update") {
    lines.shift();
    while (lines.length > 0) {
      let line = lines.shift()!;
      // Cada linha isolada: um erro não derruba o resto da atualização.
      try {
        if (line.startsWith("|split|")) {
          let showdownID = line.split("|split|")[1];
          let targetActor = battle.getActorFromShowdownID(showdownID);
          let privateMessage = lines.shift() ?? "";
          let publicMessage = lines.shift() ?? "";
          if (!targetActor) {
            battle.log("No actor could be found with the showdown id: " + showdownID);
            continue;
          }
          let splitId = new BattleMessage(privateMessage).id;
          let splitInstruction = splitUpdateInstructions[splitId];
          if (splitInstruction)
            splitInstruction(battle, targetActor, new BattleMessage(publicMessage), new BattleMessage(privateMessage), lines);
          else if (!ignoredInstructions.has(splitId))
            battle.log("Unhandled showdown instruction: " + privateMessage);
        }
        else if (line != "|") {
          let message = new BattleMessage(line);
          let instruction = updateInstructions[message.id]
          if (instruction != undefined)
            instruction(battle, message, lines);
          else if (!ignoredInstructions.has(message.id)) {
            // Linha do protocolo sem tratamento: registra no log em vez de mostrar texto cru ao jogador.
            battle.log("Unhandled showdown instruction: " + line);
          }
        }
      }
      catch (e) {
        console.error(`BattleInterpreter Error on '${line}': ${e instanceof Error ? e.stack ?? e.message : e}`);
      }
    }
  }
  else if (lines[0] == "sideupdate") {
    let showdownID = lines[1];
    let targetActor = battle.getActorFromShowdownID(showdownID);
    let line = lines[2];

    if (targetActor == undefined) {
      battle.log("No actor could be found with the showdown id: " + showdownID);
      return;
    }
    try {
      let message = new BattleMessage(line);
      sideUpdateInstructions[message.id]?.(battle, targetActor, message);
    }
    catch (e) {
      console.error(`BattleInterpreter Error on '${line}': ${e instanceof Error ? e.stack ?? e.message : e}`);
    }
  }
}

//Instruction Objects

/** Linhas do protocolo do Showdown que não têm efeito visível no jogo. */
export const ignoredInstructions = new Set([
  // Metadados e cosméticos (Cobblemon: "player", "teamsize", "gametype", "gen", "tier", "rated", "clearpoke", "poke", "teampreview", "start", "rule", "t:", "", "capture", "-anim")
  "player", "teamsize", "gametype", "gen", "tier", "rated", "clearpoke", "poke", "teampreview", "start", "rule", "t:", "", "capture", "-anim",
  "debug", "-hint", "j", "l", "n", "c", "chat", "inactive", "inactiveoff", "raw", "html", "uhtml", "seed", "timestamp", "-candynamax",
  "-center", "-combine", "-waiting"
]);

const updateInstructions: { [key: string]: (battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) => void } = {
  "turn": handleTurnInstruction,
  "upkeep": handleUpkeepInstruction,
  "faint": handleFaintInstruction,
  "win": handleWinInstruction,
  "tie": handleTieInstruction,
  "pp_update": handlePpUpdateInstruction,
  "cant": handleCantInstruction,
  "move": handleMoveInstruction,
  "bagitem": handleBagItemInstruction,
  "detailschange": handleDetailsChangeInstruction,
  "-transform": handleTransformInstruction,
  "-status": handleStatusInstruction,
  "-curestatus": handleCureStatusInstruction,
  "-weather": handleWeatherInstruction,
  "-fieldstart": handleFieldStartInstruction,
  "-fieldend": handleFieldEndInstruction,
  "-fieldactivate": handleFieldActivateInstruction,
  "-start": handleStartInstruction,
  "-end": handleEndInstruction,
  "-sidestart": handleSideStartInstruction,
  "-sideend": handleSideEndInstruction,
  "-crit": handleCritInstruction,
  "-fail": handleFailInstruction,
  "-block": handleBlockInstruction,
  "-prepare": handlePrepareInstruction,
  "-mustrecharge": handleRechargeInstructions,
  "-resisted": handleResistInstruction,
  "-immune": handleImmuneInstruction,
  "-miss": handleMissInstruction,
  "-nothing": (battle, _, _2) => battle.broadcastChatMessage(battleMsg("nothing")),
  "-supereffective": handleSuperEffectiveInstruction,
  "-boost": (battle, message, lines) => handleBoostInstruction(battle, message, lines, true),
  "-unboost": (battle, message, lines) => handleBoostInstruction(battle, message, lines, false),
  "-swapboost": handleSwapBoostInstruction,
  "-copyboost": handleCopyBoostInstruction,
  "-invertboost": handleInvertBoostInstruction,
  "-clearallboost": handleClearAllBoostInstruction,
  "-clearallnegativeboost": handleClearNegativeBoostInstruction,
  "-singleturn": handleSingleTurnInstruction,
  "-singlemove": handleSingleMoveInstruction,
  "-hitcount": handleHitCountInstruction,
  "-activate": handleActivateInstruction,
  "-item": handleItemInstruction,
  "-enditem": handleEndItemInstruction,
  "-ability": handleAbilityInstruction,
  "-endability": handleEndAbilityInstruction,
  "-zpower": handleZPowerInstruction,
  "-zbroken": handleZBrokenInstruction,
  "-terastallize": handleTerastrallizeInstruction,
  "-mega": handleMegaInstruction,
  "-clearboost": handleClearBoostInstruction,
  "-clearpositiveboost": handleClearBoostInstruction,
  "-setboost": handleSetBoostInstruction,
  "-formechange": handleDetailsChangeInstruction,
  "replace": handleReplaceInstruction,
  "swap": handleSwapInstruction,
  "-swapsideconditions": handleSwapSideConditionsInstruction,
  "-notarget": (battle) => battle.dispatcher.dispatchWaiting(1, () => battle.broadcastChatMessage(messages.color("Red", battleMsg("fail")))),
  "-ohko": (battle) => battle.dispatcher.dispatchWaiting(1, () => battle.broadcastChatMessage(messages.color("Red", { translate: "cobblemon.port.battle.ohko" }))),
  "-primal": handleMegaInstruction,
  "-burst": handleMegaInstruction,
  "-message": handleRawMessageInstruction,
  "message": handleRawMessageInstruction,
};

const sideUpdateInstructions: { [key: string]: (battle: PokemonBattle, actor: BattleActor, message: BattleMessage) => void } = {
  "request": handleRequestInstruction,
  "error": handleErrorInstruction
};

const splitUpdateInstructions: { [key: string]: (battle: PokemonBattle, actor: BattleActor, message: BattleMessage, message2: BattleMessage, remainingLines: string[]) => void } = {
  "switch": handleSwitchInstruction,
  "drag": handleDragInstruction,
  "-damage": handleDamageInstruction,
  "-heal": handleHealInstruction,
  "-sethp": handleSetHPInstruction,
};

/** Used for translation key */
const statusNames: { [key: string]: string } = {
  brn: "burn",
  fnt: "faint",
  frz: "frozen",
  par: "paralysis",
  slp: "sleep",
  tox: "poisonbadly",
  psn: "poison"
}

/** Used for translation key
 * Recommended to use || "accuracy" after this
 */
export const statNames: { [key: string]: string } = {
  spe: "speed",
  hp: "hp",
  atk: "attack",
  def: "defence",
  spa: "special_attack",
  spd: "special_defence",
  accuracy: "accuracy", //Hope these are right
  evasion: "evasion"
}

const severityNames = {
  0: "cap.single",
  1: "slight",
  2: "sharp",
  3: "severe"
}

//Instruction Functions

function handleBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[], isBoost: boolean) {
  let pokemon = message.getBattlePokemon(0, battle);
  let statKey = message.argumentAt(1);
  let stages = parseInt(message.argumentAt(2)!);
  if (!pokemon || !statKey || Number.isNaN(stages))
    return;
  let statName: RawMessage = { translate: `cobblemon.stat.${statNames[statKey]}.name` };
  let severity = severityNames[stages] || "severe";
  let rootKey = (isBoost) ? "boost" : "unboost";

  if (stages === 0) {
    let othersExist = remainingLines.filter(it => {
      let isAlsoBoost = it.startsWith("|-" + rootKey);
      return isAlsoBoost && it.split("|")[2] == message.rawMessage.split("|")[2] && it.split("|")[4] == "0";
    })
    if (othersExist.length > 0) {
      battle.dispatcher.dispatchGo(() => battle.broadcastChatMessage({ translate: `cobblemon.battle.${rootKey}.cap.multiple` }));
      return;
    }
  }

  battle.dispatcher.dispatch(() => {
    // BoostInstruction: timeline `boost`/`unboost` (partícula statup/statdown) e a mensagem; espera as holds.
    let hold = playBoostEffect(pokemon, isBoost, stages);
    let lang: RawMessage = (message.hasOptionalArgument("zeffect"))
      ? messages.With(`cobblemon.battle.${rootKey}.${severity}.zeffect`, [pokemon.getName(), statName])
      : messages.With(`cobblemon.battle.${rootKey}.${severity}`, [pokemon.getName(), statName])
    battle.broadcastChatMessage(lang);

    //TODO: Whatever the context manager is necessary for
    battle.minorBattleActions.set(pokemon.data.uuid, message);
    return new WaitDispatch(Math.max(1.5, hold));
  })
}

function handleTurnInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  if (!battle.started) {
    battle.started = true;
    battle.actors.filter(actor => actor.type == ActorType.PLAYER).forEach(actor => {
      actor.updateMusic();
    })
    battle.actors.forEach(actor => {
      actor.syncOutPokemon();
    })
    battle.dispatcher.dispatch(() => {
      return { canProceed: () => !battle.side1.stillSendingOut() && !battle.side2.stillSendingOut() }
    })
    battle.dispatcher.dispatchGo(() => {
      battle.side1.playCries()
      system.runTimeout(() => battle.side2.playCries(), 20);
    })
  }
  let turnNumber = parseInt(message.argumentAt(0)!);
  if (Number.isNaN(turnNumber))
    return;

  // As telas de escolha abrem quando chega o |request| (BattleActor.receiveRequest).
  battle.dispatcher.dispatchGo(() => {
    battle.broadcastChatMessage(messages.prefix(ColorCodes.Aqua, messages.With("cobblemon.battle.turn", [turnNumber.toString()])));
    battle.newTurn(turnNumber);
  })
}

function handleUpkeepInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => battle.actors.forEach(x => x.upkeep()))
}

function handleFaintInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let posAndUUID = message.showdownPositionAndUUID(0);
  if (!posAndUUID)
    return;

  let pokemon = message.getBattlePokemon(0, battle);
  if (!pokemon)
    return;

  // FaintInstruction.kt: HP a 0, animação de desmaio e, depois, mensagem e saída de campo.
  battle.dispatcher.dispatch(() => {
    pokemon.data.currentHealth = 0;
    pokemon.data.status = StatusEffect.Faint;
    if (!battle.faintedAt.has(pokemon.data.uuid))
      battle.faintedAt.set(pokemon.data.uuid, battle.faintCounter++);
    if (!playFaintEffect(pokemon)) playFaintAnimation(pokemon.visual, pokemon.mock?.data ?? pokemon.data);
    return new WaitDispatch(1.5);
  })
  battle.dispatcher.dispatchWaiting(1, () => {
    battle.broadcastChatMessage(messages.error(messages.With("cobblemon.battle.fainted", [pokemon.getName()])));
    CobblemonEvents.emit("BATTLE_FAINTED", battle, pokemon);

    let actor = pokemon.actor;
    // Desmaio: some a balsa e o visual de Illusion/Transform (EffectTracker.wipe na morte).
    removePlatform(pokemon.data.uuid);
    endMock(pokemon, false);
    try {
      if (pokemon.pending) {
        // A bola ainda estava a caminho (não há entidade para tirar).
      }
      else if (actor.type == ActorType.WILD) {
        // Selvagem derrotado: drops no local e a entidade morre.
        dropWildLoot(pokemon);
        if (pokemon.entity.isValid)
          pokemon.entity.kill();
      }
      else if (actor.Player) {
        pokemon.data.tryUpdatePokemonInTeam(actor.Player);
        pokemon.data.return(actor.Player);
      }
      else if (pokemon.entity.isValid) {
        pokemon.entity.triggerEvent("cobblemon:instant_kill");
      }
    }
    catch (e) {
      console.warn(`Faint cleanup failed: ${e}`);
    }

    let activeIndex = actor.activePokemon.findIndex(x => x?.data.uuid == posAndUUID[1]);
    if (activeIndex != -1)
      actor.activePokemon[activeIndex] = null;

    //Stop being followed by that species if it is out
    let otherSide = actor.getSide().getOppositeSide();
    let sameSpeciesOut = actor.getSide().getActivePokemon().some(x => x?.entity.isValid && x.entity.typeId === pokemon.entity.typeId);
    let tag = `targetedBy:` + pokemon.entity.typeId
    if (!sameSpeciesOut) {
      otherSide.getActivePokemon().forEach(x => {
        if (x?.entity.isValid && x.entity.hasTag(tag))
          x.entity.removeTag(tag);
      })
    }

    battle.majorBattleActions.set(posAndUUID[1], message);
  })
}

function handleBagItemInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let uuid = message.argumentAt(0);
    let itemName = message.argumentAt(1);
    if (!uuid || !itemName)
      return;
    let pokemon = message.pokemonByUuid(0, battle);
    let owner = battle.getOwner(uuid);
    if (!pokemon || !owner)
      return;
    // Uso confirmado: devolve o recipiente (garrafa, tigela) e tira da lista de reembolso.
    let used = owner.confirmBagItemUse(itemName);
    if (used?.returnItem && owner.Player?.isValid)
      giveBagItem(owner.Player, used.returnItem);
    battle.broadcastChatMessage(battleMsg("bagitem.use", [owner.getName(), { translate: itemName }, pokemon.getTranslatedName()]));
  })
}

function handleWinInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  // O resultado já está decidido: a partir daqui, entidades sumindo (selvagem morto no desmaio) não encerram
  // a batalha como "stopped" antes da vitória ser despachada.
  battle.outcomeDecided = true;
  battle.dispatcher.dispatchGo(() => {
    let user = message.argumentAt(0);
    if (!user)
      return;

    let ids = user.split("&").map(x => x.trim());
    let winners = ids.map(x => battle.getActorFromID(x)).filter(x => x != undefined);
    let losers = battle.actors.filter(x => !winners.some(y => y.actor.id == x.actor.id))
    battle.broadcastChatMessage(winMessage(winners.map(x => x.getName())));

    battle.end("win");
    CobblemonEvents.emit("BATTLE_VICTORY", battle, winners, losers, false);
  })
}

function handleTieInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.outcomeDecided = true;
  battle.dispatcher.dispatchGo(() => {
    if (battle.ended)
      return;
    battle.broadcastChatMessage(messages.prefix(ColorCodes.Gold, { translate: "cobblemon.battle.tie" }));
    battle.end("tie");
  })
}

function handleStatusInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let posAndUUID = message.showdownPositionAndUUID(0);
  let pokemon = message.getBattlePokemon(0, battle);
  let statusLabel = message.argumentAt(1);
  if (!posAndUUID || !pokemon || !statusLabel)
    return;
  broadcastOptionalAbility(battle, message.effect(), pokemon.getName());
  battle.dispatcher.dispatchWaiting(1, () => {
    //Persistent status
    if (PersistentStatuses.includes(statusLabel)) {
      pokemon.data.status = (statusLabel as StatusEffect);
      pokemon.syncWithOut();
    }

    battle.broadcastChatMessage(messages.With(`cobblemon.status.${statusNames[statusLabel]}.apply`, [pokemon.getName()]));
    battle.minorBattleActions.set(pokemon.data.uuid, message);

  })
}

function handleMissInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    battle.broadcastChatMessage(messages.color("Red", battleMsg("missed")));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleImmuneInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    battle.broadcastChatMessage(messages.color("Red", battleMsg("immune", [pokemon.getName()])));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleInvertBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    let name = pokemon.getName();
    battle.broadcastChatMessage(battleMsg("invertboost", [name]))
  })
}

function handleMoveInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let userPokemon = message.getBattlePokemon(0, battle);
  let targetPokemon = message.getBattlePokemon(2, battle);
  let effect = message.effectAt(1);
  if (!userPokemon || !effect)
    return;
  let optionalEffect = message.effect();
  let move = Dex.moves.get(effect.id);
  let pokemonName = userPokemon.getName();
  broadcastOptionalAbility(battle, optionalEffect, pokemonName);

  battle.dispatcher.dispatch(() => {
    lastCauser.set(battle.battleId, message);

    userPokemon.data.getEvolutions().forEach(x => {
      if (x.requirements.some(x => x instanceof UseMoveRequirement)) {
        let progress = getEvolutionProgress<number>(userPokemon.data, x.id, "use_move") || 0;
        setEvolutionProgress(userPokemon.data, x.id, "use_move", 0);
      }
    })

    let msg = (() => {
      if (optionalEffect?.id == "magicbounce")
        return battleMsg("ability.magicbounce", [pokemonName, getMoveTranslation(effect.id)]);
      else if (move.name != "struggle" && targetPokemon && targetPokemon.data.uuid != userPokemon.data.uuid)
        return battleMsg("used_move_on", [pokemonName, getMoveTranslation(effect.id), targetPokemon.getName()])
      else
        return battleMsg("used_move", [pokemonName, getMoveTranslation(effect.id)])
    })();
    battle.broadcastChatMessage(msg);
    // Timeline do action_effect (animação + partículas + sons); a fila espera as holds do Cobblemon.
    const hold = playMoveEffects(userPokemon, targetPokemon, effect.id, remainingLines, message.argumentAt(0)?.split(":")[0], message.argumentAt(2)?.split(":")[0]);
    // NPCBattleActor: o treinador faz o gesto de comando quando o Pokémon dele usa um golpe.
    playNPCAnimation(userPokemon.actor, "animation.cobblemon_npc.command");
    battle.majorBattleActions.set(userPokemon.data.uuid, message);
    return hold > 0 ? new WaitDispatch(hold) : GoDispatch;
  })
}

function handleCantInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  // CantInstruction: a timeline do status (paralisia, sono, paixão...) antes da mensagem.
  battle.dispatcher.dispatch(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    let hold = pokemon ? playCantEffect(pokemon, message.effectAt(1)?.id) : 0;
    return hold > 0 ? new WaitDispatch(Math.min(hold, 1)) : GoDispatch;
  });
  battle.dispatcher.dispatchWaiting(1, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    let effectId = message.effectAt(1)?.id;
    if (!pokemon || !effectId)
      return;
    let name = pokemon.getName();
    let move = message.moveAt(2);
    if (!move) {
      //This is literally so common. For example: Sleep effects
      //console.warn(`Unrecognized move ${message.argumentAt(2)}`);
    }
    let moveName = (move) ? getMoveTranslation(move.id) : messages.toMessage(`(Unrecognized: ${message.argumentAt(2)})`);
    let msg = (() => {
      switch (effectId) {
        case "armortail":
        case "damp":
        case "dazzling":
        case "queenlymajesty":
          return battleMsg("cant.generic", [name, moveName]);
        case "par":
        case "slp":
        case "frz":
          return messages.With(`cobblemon.status.${statusNames[effectId]}.is`, [name]);
        default:
          return battleMsg(`cant.${effectId}`, [name, moveName]);
      }
    })();

    battle.broadcastChatMessage(messages.prefix(ColorCodes.Red, msg));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleResistInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    battle.broadcastChatMessage({ translate: "cobblemon.battle.resisted" });
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handlePpUpdateInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let pokemon = message.getPokemon(0, battle);
    if (!pokemon)
      return;

    let moveDatum = message.argumentAt(1)?.split(", ");
    if (moveDatum === undefined)
      return;

    moveDatum.forEach(moveData => {
      let [moveId, movePp] = moveData.split(": ");
      let moveIndex = pokemon.moves.findIndex(x => x.toLowerCase() == moveId.toLowerCase());
      if (moveIndex == -1)
        return;
      let moveInfo = pokemon.movesInfo[moveIndex];
      moveInfo.pp = parseInt(movePp);
    })
  })
}

function handleSuperEffectiveInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    battle.broadcastChatMessage(messages.translate("cobblemon.battle.superEffective"))
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleCritInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    battle.broadcastChatMessage(messages.color("Yellow", { translate: "cobblemon.battle.crit" }));
    let lastCause = lastCauser.get(battle.battleId);
    let battlePokemon = message.getBattlePokemon(0, battle);
    if (lastCause && battlePokemon) {
      pokemon.data.getEvolutions().filter(x => x instanceof BattleCriticalHitsRequirement).forEach(x => {
        let progress = getEvolutionProgress<number>(pokemon.data, x.id, "battle_critical_hits") || 0;
        setEvolutionProgress(pokemon.data, x.id, "battle_critical_hits", progress + 1);
      })
    }
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleWeatherInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let weather = message.effectAt(0)?.id;
  let user = message.getSourceBattlePokemon(battle)?.getName() || { text: "UNKNOWN" };
  broadcastOptionalAbility(battle, message.effect(), user);

  battle.dispatcher.dispatchWaiting(1.5, () => {
    let msg = (() => {
      if (message.hasOptionalArgument("upkeep"))
        return battleMsg(`weather.${weather}.upkeep`)
      else if (weather != "none") {
        return battleMsg(`weather.${weather}.start`)
      }
      else {
        return battleMsg(`weather.${weather}.end`);
      }
    })();
    battle.broadcastChatMessage(msg);
  })
}

function handleFailInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    let pokemonName = pokemon.getName();
    let effectID = message.effectAt(1)?.id;

    let msg = (() => {
      switch (effectID) {
        case undefined:
        case "burnup":
        case "doubleshock":
          return battleMsg("fail");
        case "shedtail":
          return battleMsg("fail.substitute", [pokemonName]);
        case "hyperspacefurry":
        case "aurawheel":
          return battleMsg("fail.darkvoid", [pokemonName]);
        case "corrosivegas":
          return battleMsg("fail.healblock", [pokemonName]);
        case "dynamax":
          return battleMsg("fail.grassknot", [pokemonName]);
        case "unboost":
          let statkey = message.argumentAt(2);
          if (!statkey)
            return battleMsg(`fail.${effectID}`, [pokemonName])
          let stat: RawMessage = { translate: `cobblemon.stat.${statNames[statkey]}.name` };
          return battleMsg(`fail.${effectID}.single`, [pokemonName, stat]);
        default:
          return battleMsg(`fail.${effectID}`, [pokemonName]);
      }
    })();
    battle.broadcastChatMessage(messages.color("Red", msg));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleRechargeInstructions(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(2, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    battle.broadcastChatMessage(battleMsg("recharge", [pokemon.getName()]));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleCureStatusInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  // Pode ser um Pokémon no banco (Heal Bell, Aromatherapy, item da mochila).
  let data = message.pokemonData(0, battle);
  if (!data)
    return;
  let pokemonData = data;
  let pokemonName = pokemonData.getTranslatedName();
  let status = message.argumentAt(1);
  if (!status)
    return;
  let effect = message.effect();
  broadcastOptionalAbility(battle, effect, pokemonName);

  battle.dispatcher.dispatchWaiting(1, () => {
    pokemonData.status = undefined;
    pokemonData.statusDuration = undefined;
    syncPokemonData(battle, pokemonData);
    if (message.hasOptionalArgument("silent"))
      return;

    let msg: RawMessage;
    if (effect?.type == EffectType.ABILITY)
      msg = battleMsg(`curestatus.${effect.id}`, [pokemonName]);
    else
      msg = messages.With(`cobblemon.status.${statusNames[status]}.cure`, [pokemonName]);

    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokemonData.uuid, message);
  })
}

function handleStartInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  // StartInstruction: timeline `start_<efeito>` (ex. start_alphaboost) antes da mensagem.
  battle.dispatcher.dispatch(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    let hold = pokemon ? playStartEffect(pokemon, message.effectAt(1)?.id) : 0;
    return hold > 0 ? new WaitDispatch(hold) : GoDispatch;
  });
  battle.dispatcher.dispatch(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    let effectID = message.effectAt(1)?.id;
    if (!pokemon || !effectID)
      return GoDispatch;

    let optionalEffect = message.effect();
    let optionalPokemon = message.getSourceBattlePokemon(battle);
    let optionalPokemonName = optionalPokemon?.getName();
    let extraEffect = message.effectAt(2)?.typelessData || "UNKOWN";

    battle.minorBattleActions.set(pokemon.data.uuid, message);
    // Frente msd-fase1: `-start|…|Dynamax|Gmax` → escala/visual da extensão Mega Showdown.
    if (effectID == "dynamax") {
      let dynamaxed = pokemon;
      emitSafely(() => CobblemonEvents.emit("DYNAMAX", battle, dynamaxed, true, message.effectAt(2)?.id == "gmax"));
    }

    if (!message.hasOptionalArgument("silent")) {
      let msg = (() => {
        if (optionalEffect?.id == "reflecttype" && optionalPokemonName)
          return battleMsg("start.reflecttype", [pokemon.getName(), optionalPokemonName]);
        switch (effectID) {
          case "confusion":
          case "perish3":
            return undefined;
          case "perish2":
          case "perish1":
          case "perish0":
          case "stockpile1":
          case "stockpile2":
          case "stockpile3":
            return battleMsg(`start.${effectID.substring(0, effectID.length - 1)}`, [pokemon.getName(), effectID[effectID.length - 1]]);
          case "dynamax":
            return messages.color("Yellow", battleMsg(`start.${message.effectAt(2)?.id || effectID}`, [pokemon.getName()]));
          case "curse":
            return battleMsg("start.curse", [optionalPokemonName!, pokemon.getName()]);
          default:
            return battleMsg(`start.${effectID}`, [pokemon.getName(), extraEffect]);
        }
      })();
      if (!msg)
        return GoDispatch;
      battle.broadcastChatMessage(msg);
    }

    return new WaitDispatch(1);
  })
}

function handleSingleTurnInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    let pokemonName = pokemon.getName();
    let sourceName = message.getSourceBattlePokemon(battle)?.getName() || { text: "UNKOWN" };
    let effectID = message.effectAt(1)?.id;
    if (!effectID)
      return;
    let msg = battleMsg(`singleturn.${effectID}`, [pokemonName, sourceName]);
    battle.broadcastChatMessage(msg);
  })
}

/** TransformInstruction: o visual vira o do alvo (TransformEffect, grito 1 s depois) e depois a mensagem. */
function handleTransformInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let active = message.getBattlePokemon(0, battle);
  let target = message.getBattlePokemon(1, battle);
  let targetData = target?.data ?? message.getPokemon(1, battle);
  if (!active || !targetData)
    return;
  broadcastOptionalAbility(battle, message.effect(), active.getName());
  battle.dispatcher.dispatch(() => {
    // Transform em quem está com Illusion copia o que aparece (o mock do alvo).
    let copied = target?.mock?.data ?? target?.illusion ?? targetData!;
    let wait = startMock(active, "transform", copied, battle.started);
    return wait > 0 ? new WaitDispatch(wait) : GoDispatch;
  });
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let targetName = target?.getName() ?? targetData!.getTranslatedName();
    battle.broadcastChatMessage(battleMsg("transform", [active.getName(), targetName]));
    battle.minorBattleActions.set(active.data.uuid, message);
  });
}

function handleSingleMoveInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    let pokemonName = pokemon.getName();
    let effectID = message.effectAt(1)?.id;
    if (!effectID)
      return;
    let msg = battleMsg(`singlemove.${effectID}`, [pokemonName]);
    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleEndAbilityInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    let pokemonName = pokemon.getName();

    let msg = battleMsg(`endability`, [pokemonName]);
    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleBlockInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    if (!pokemon)
      return;
    let pokemonName = pokemon.getName();
    let effectID = message.effectAt(1)?.id;
    if (!effectID)
      return;
    let msg = battleMsg(`block.${effectID}`, [pokemonName]);
    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

function handleActivateInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  // Lido já na leitura (ActivateInstruction.preActionEffect): os despachos entram na ordem do protocolo.
  let pokemon = message.getBattlePokemon(0, battle);
  if (!pokemon)
    return;
  let pokemonName = pokemon.getName();
  let sourceName = message.getSourceBattlePokemon(battle)?.getName() || { text: "UNKOWN" };
  let effect = message.effectAt(1);
  if (!effect)
    return;
  let extraEffect = message.effectAt(2)?.typelessData || "UNKOWN";
  broadcastOptionalAbility(battle, effect, pokemonName);
  {

    battle.dispatcher.dispatch(() => {
      // ActivateInstruction: timeline do status (confusão, paixão) ou `activate_<efeito>` (Protect, Powder).
      let hold = playActivateEffect(pokemon, effect.id);
      return hold > 0 ? new WaitDispatch(hold) : GoDispatch;
    });
    battle.dispatcher.dispatch(() => {
      lastCauser.set(battle.battleId, message);
      battle.minorBattleActions.set(pokemon.data.uuid, message);
      // Sketch: o golpe copiado substitui Sketch no Pokémon de verdade (fica depois da batalha).
      if (effect.id == "sketch")
        // (o nome vem cru no protocolo: Effect.typelessData corta a 1ª letra de efeitos sem prefixo)
        applySketch(battle, pokemon, message.argumentAt(2));

      let lang = (() => {
        switch (effect.id) {
          case "magnitude":
            return battleMsg("activate.magnitude", [message.argumentAt(2) || "1"]);
          case "spite":
          case "eeriespell":
            return battleMsg("activate.spite", [pokemonName, extraEffect, message.argumentAt(3)!])
          case "toxicdebris":
          case "shedskin":
          case "iceface":
          case "owntempo":
          case "vitalspirit":
            return undefined;
          case "destinybond":
            battle.activePokemon.map(x => x?.data.uuid).filter(x => x != undefined).forEach(x => battle.minorBattleActions.set(x, message));
            return battleMsg("activate.destinybond", [pokemonName]);
          case "focussash":
          case "focusband":
            return battleMsg("activate.focusband", [pokemonName, effect.typelessData]);
          case "maxguard":
          case "protect":
            return battleMsg("activate.protect", [pokemonName]);
          case "shadowforce":
          case "hyperspacefury":
          case "hyperspacehole":
            return battleMsg("activate.phantomforce", [pokemonName]);
          default: {
            // `[msg]` escolhe a variante da mensagem (activate.<efeito>.<variante>), como no Cobblemon.
            let variant = message.optionalArgument("msg");
            return battleMsg(variant ? `activate.${effect.id}.${variant}` : `activate.${effect.id}`, [pokemonName, sourceName, extraEffect]);
          }
        }
      })();
      if (!lang)
        return GoDispatch;
      battle.broadcastChatMessage(lang);
      return new WaitDispatch(1);
    })
  }
}

function handleFieldStartInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let sourceName = message.getSourceBattlePokemon(battle)?.getName() || { text: "UNKOWN" };
  let effect = message.effectAt(0);
  if (!effect)
    return;
  broadcastOptionalAbility(battle, effect, sourceName);

  battle.dispatcher.dispatchWaiting(1.5, () => {
    let msg = battleMsg(`fieldstart.${effect.id}`, [sourceName]);
    battle.broadcastChatMessage(msg);
  })
}

function handleFieldEndInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let effectID = message.effectAt(0);
    if (!effectID)
      return;
    let msg = battleMsg(`fieldend.${effectID.id}`);
    battle.broadcastChatMessage(msg);
  })
}

function handleFieldActivateInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(2.5, () => {
    let effectID = message.effectAt(0)?.id;
    if (!effectID)
      return;
    let msg = battleMsg(`fieldactivate.${effectID}`);
    battle.broadcastChatMessage(messages.color("Red", msg));
  })
}

function handleAbilityInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let pokemon = message.getBattlePokemon(0, battle);
  if (!pokemon)
    return;
  let pokemonName = pokemon.getName();
  let effect = message.effectAt(1);
  if (!effect)
    return;
  let optionalEffect = message.effect();
  let optionalPokemon = message.getSourceBattlePokemon(battle);
  let optionalPokemonName = optionalPokemon?.getName();


  battle.dispatcher.dispatch(() => {
    lastCauser.set(battle.battleId, message);
    battle.minorBattleActions.set(pokemon.data.uuid, message);
    // Frente msd-fase6: `-ability` processado (o fim do AbilityInstruction.invoke do Java).
    emitSafely(() => CobblemonEvents.emit("ABILITY_REVEALED", battle, pokemon, effect.id));

    if (optionalEffect)
      broadcastAbility(battle, optionalEffect, pokemonName);
    else
      broadcastAbility(battle, effect, pokemonName);

    let lang = (() => {
      if (optionalEffect?.id == "trace")
        return (optionalPokemonName) ? battleMsg("ability.trace", [pokemonName, optionalPokemonName, effect.typelessData]) : undefined;
      if (optionalEffect?.id == "reciever" || optionalEffect?.id == "powerofalchemy")
        return (optionalPokemonName) ? battleMsg("ability.reciever", [optionalPokemonName, effect.typelessData]) : undefined;
      switch (effect.id) {
        case "sturdy":
        case "unnerve":
        case "anticipation":
          return battleMsg(`ability.${effect.id}`, [pokemonName]);
        case "airlock":
        case "cloudnine":
          return battleMsg("ability.airlock");
      }
      return undefined;
    })();
    if (lang) {
      battle.broadcastChatMessage(lang);
      return new WaitDispatch(1);
    }
    return GoDispatch;
  })
}

function broadcastOptionalAbility(battle: PokemonBattle, effect: Effect | undefined, pokemonName: RawMessage) {
  if (effect && effect.type == EffectType.ABILITY)
    broadcastAbility(battle, effect, pokemonName);
}

function broadcastAbility(battle: PokemonBattle, effect: Effect, pokemonName: RawMessage) {
  battle.dispatcher.dispatchGo(() => {
    let msg = messages.prefix(ColorCodes.Yellow, messages.With("cobblemon.battle.ability.generic", [pokemonName, effect.typelessData]));
    battle.broadcastChatMessage(msg);
  })
}

function handlePrepareInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  // PrepareInstruction: timeline `prepare_<golpe>` (se existir) antes da mensagem.
  battle.dispatcher.dispatch(() => {
    let pokemon = message.getBattlePokemon(0, battle);
    let hold = pokemon ? playPrepareEffect(pokemon, message.effectAt(1)?.id) : 0;
    return hold > 0 ? new WaitDispatch(hold) : GoDispatch;
  });
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokmeon = message.getBattlePokemon(0, battle);
    if (!pokmeon)
      return;
    let pokemonName = pokmeon.getName();
    let effectID = message.effectAt(1)?.id;
    if (!effectID)
      return;
    let msg: RawMessage;
    if (effectID == "shadowforce")
      msg = battleMsg("prepare.phantomforce", [pokemonName]);
    else if (effectID == "solarblade")
      msg = battleMsg("prepare.solarbeam", [pokemonName]);
    else
      msg = battleMsg("prepare." + effectID, [pokemonName]);
    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokmeon.data.uuid, message);
  })
}

function handleSwapBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(2, () => {
    let pokmeon = message.getBattlePokemon(0, battle);
    if (!pokmeon)
      return;
    let pokemonName = pokmeon.getName();
    let targetPokemon = message.getBattlePokemon(1, battle);
    if (!targetPokemon)
      return;
    let targetPokemonName = targetPokemon.getName();
    let effectID = message.effect()?.id;
    if (!effectID)
      return;
    let msg: RawMessage;
    if (["guardswap", "powerswap", "heartswap"].includes(effectID))
      msg = battleMsg(`swapboost.${effectID}`, [pokemonName])
    else
      msg = battleMsg(`swapboost.generic`, [pokemonName, targetPokemonName])
    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokmeon.data.uuid, message);
  })
}

function handleCopyBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1, () => {
    let pokmeon = message.getBattlePokemon(0, battle);
    if (!pokmeon)
      return;
    let pokemonName = pokmeon.getName();
    let targetPokemon = message.getBattlePokemon(1, battle);
    if (!targetPokemon)
      return;
    let targetPokemonName = targetPokemon.getName();
    let effectID = message.effect()?.id;
    if (!effectID)
      return;
    let msg: RawMessage = battleMsg("copyboost.generic", [pokemonName, targetPokemonName]);
    battle.broadcastChatMessage(msg);
    battle.minorBattleActions.set(pokmeon.data.uuid, message);
  })
}

function handleEndInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(2, () => {
    let pokmeon = message.getBattlePokemon(0, battle);
    if (!pokmeon)
      return;
    let pokemonName = pokmeon.getName();
    let effectID = message.effectAt(1)?.id;
    if (!effectID)
      return;
    if (effectID == "dynamax")
      emitSafely(() => CobblemonEvents.emit("DYNAMAX", battle, pokmeon, false, false)); // frente msd-fase1
    if (!message.hasOptionalArgument("silent")) {
      let msg: RawMessage;
      if (effectID === "yawn")
        msg = battleMsg(`status.sleep.apply`, [pokemonName])
      else
        msg = battleMsg(`end.${effectID}`, [pokemonName])
      battle.broadcastChatMessage(msg);
    }
    battle.minorBattleActions.set(pokmeon.data.uuid, message);
  })
}

function handleSideStartInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(2, () => {
    let side = (message.argumentAt(0)?.[1] === '1') ? battle.side1 : battle.side2;
    let effect = message.effectAt(1);
    if (!effect)
      return;
    battle.sides.forEach(it => {
      let subject = (it === side) ? battleMsg("side_subject.ally") : battleMsg("side_subject.opponent");
      let lang = battleMsg(`sidestart.${effect.id}`, [subject]);
      it.broadcaseChatMessage(lang);
    })
  })
}

function handleSideEndInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(2, () => {
    let side = (message.argumentAt(0)?.[1] === '1') ? battle.side1 : battle.side2;
    let effect = message.effectAt(1);
    if (!effect)
      return;
    battle.sides.forEach(it => {
      let subject = (it === side) ? battleMsg("side_subject.ally") : battleMsg("side_subject.opponent");
      let lang = battleMsg(`sideend.${effect.id}`, [subject]);
      it.broadcaseChatMessage(lang);
    })
  })
}

function handleErrorInstruction(battle: PokemonBattle, actor: BattleActor, message: BattleMessage) {
  battle.log("Error Instruction: " + message.rawMessage);
  if (message.rawMessage.includes("Can't choose for Team Preview") || message.rawMessage.includes("The game is over"))
    return;
  // Escolha recusada pelo Showdown: o ator escolhe de novo (a IA cai no "default").
  if (actor.type != ActorType.PLAYER) {
    if (actor.request && !battle.ended)
      battle.writeChoice(`>${actor.showdownId} default`);
    return;
  }
  battle.dispatcher.dispatchGo(() => {
    let lang: RawMessage;
    if (message.rawMessage.includes("is trapped") || message.rawMessage.includes("trapped"))
      lang = messages.error({ translate: "cobblemon.port.battle.ui.trapped_generic" });
    else if (message.rawMessage.includes("[Unavailable choice]"))
      lang = messages.error({ translate: "cobblemon.port.battle.ui.unavailable" });
    else
      lang = battle.createUnimplimented(message);
    actor.Player?.sendMessage(lang);
    if (actor.request) {
      actor.mustChoose = true;
      battle.dispatcher.doWhenClear(() => actor.promptPlayerForRequest());
    }
  })
}

function handleRequestInstruction(battle: PokemonBattle, actor: BattleActor, message: BattleMessage) {
  battle.log("Request Instruction");
  let json = message.rawMessage.split("|request|")[1];
  if (!json)
    return;
  let request = JSON.parse(json) as RequestData & { teamPreview?: boolean };
  if (request.teamPreview)
    return;
  actor.receiveRequest(request);
}

/** `[is] p1: <uuid>` (Illusion): o disfarce do Pokémon que entra (SwitchInstruction: battlePokemonFromOptional("is")). */
function illusionOf(battle: PokemonBattle, message: BattleMessage): PokemonData | undefined {
  let raw = message.optionalArgument("is");
  let uuid = raw?.split(": ")[1]?.trim();
  if (!uuid)
    return undefined;
  try {
    return battle.getPokemon(uuid);
  }
  catch {
    return undefined;
  }
}

/** Imposter: há um `-transform` do mesmo Pokémon logo depois (TransformInstruction.expectedTarget). */
function isImposterSwitch(position: string, remainingLines: string[]): boolean {
  return remainingLines.some(line => line.startsWith(`|-transform|${position}:`));
}

function handleSwitchInstruction(battle: PokemonBattle, actor: BattleActor, publicMessage: BattleMessage, privateMessage: BattleMessage, remainingLines: string[] = []) {
  let posAndUUID = publicMessage.showdownPositionAndUUID(0);
  if (!posAndUUID)
    return;
  let [position, uuid] = posAndUUID;
  let [owner] = battle.getActorAndActiveSlotFromShowdownPosition(position);
  let pokemon = battle.getPokemon(uuid);
  let illusion = illusionOf(battle, publicMessage);
  if (!battle.started) {
    startOfBattleSwitch(battle, owner, position, pokemon, illusion);
    return;
  }
  // HP de quem entra (o dano de entrada já vem nas linhas seguintes).
  let health = parseInt(privateMessage.argumentAt(2)?.split(" ")[0]?.split("/")[0] ?? "");
  if (!Number.isNaN(health) && health >= 0)
    pokemon.currentHealth = Math.min(health, pokemon.maxHealth || health);
  battle.majorBattleActions.set(pokemon.uuid, publicMessage);
  // Frente msd-fase1: o Showdown desfaz formas temporárias e o Dynamax de quem sai; quem entra começa sem elas.
  emitSafely(() => CobblemonEvents.emit("POKEMON_SWITCHED_IN", battle, pokemon.uuid));
  let old = owner.activePokemon[owner.slotFromLetter(position[2])];
  if (old && old.data.uuid !== pokemon.uuid)
    battle.majorBattleActions.set(old.data.uuid, publicMessage);
  midBattleSwitch(battle, owner, position, pokemon, { illusion, imposter: isImposterSwitch(position, remainingLines) });
}

/** Animação do treinador NPC (ids de NPC_ANIMATIONS em generated/scripts/npcs.ts). */
function playNPCAnimation(actor: BattleActor | undefined, animation: string) {
  if (actor?.type !== ActorType.NPC) return;
  try { if (actor.actor.isValid) actor.actor.playAnimation(animation); } catch { }
}

function handleDamageInstruction(battle: PokemonBattle, actor: BattleActor, publicMessage: BattleMessage, privateMessage: BattleMessage) {
  let battlePokemon = publicMessage.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  if (privateMessage.optionalArgument("from") == "recoil") {
    battlePokemon.data.getEvolutions().forEach(x => {
      if (x.requirements.some(x => x instanceof RecoilRequirement)) {
        //I have no idea why this is calculated seperately but im just gonna trust the cobblemon devs.
        let newPercentage = parseInt(privateMessage.argumentAt(1)?.split("/")?.[0]!);
        if (Number.isNaN(newPercentage))
          newPercentage = 0;
        let newHealth = Math.round(battlePokemon.data.maxHealth * (newPercentage / 100));
        let difference = battlePokemon.data.currentHealth - newHealth;
        let progress = getEvolutionProgress<number>(battlePokemon.data, x.id, "recoil") || 0;
        setEvolutionProgress(battlePokemon.data, x.id, "recoil", progress + difference);
      }
    })
  }
  let newHealth = privateMessage.argumentAt(1)?.split(" ")[0];
  if (!newHealth)
    return;
  let effect = privateMessage.effect();
  let pokemonName = battlePokemon.getName();
  let sourceName = privateMessage.getSourceBattlePokemon(battle)?.getName() || { text: "UNKOWN" };
  broadcastOptionalAbility(battle, effect, sourceName);

  battle.dispatcher.dispatch(() => {
    let newHealthRatio: number;
    let remainingHealth = parseInt(newHealth.split("/")[0]);

    if (effect) {
      playDamageEffect(battlePokemon, effect.id);
      let msg = (() => {
        switch (effect.id) {
          case "blacksludge":
          case "stickybarb":
            return battleMsg("damage.item", [pokemonName, effect.typelessData]);
          case "brn":
          case "psn":
          case "tox":
            let status = statusNames[effect.id];
            return messages.With(`cobblemon.status.${status}.hurt`, [pokemonName]);
          case "aftermath":
            return battleMsg("damage.generic", [pokemonName]);
          case "chloroblast":
          case "steelbeam":
            return battleMsg("damage.mindblown", [pokemonName]);
          case "jumpkick":
            return battleMsg("damage.highjumpkick", [pokemonName]);
          default:
            return battleMsg(`damage.${effect.id}`, [pokemonName, sourceName])
        }
      })();
      battle.broadcastChatMessage(msg);
    }

    if (newHealth == "0") {
      //This seems redundant with faint but ok
      newHealthRatio = 0;
      battle.dispatcher.dispatchGo(() => {
        battlePokemon.data.currentHealth = 0;
        battlePokemon.syncWithOut();
      })
    }
    else {
      let maxHealth = parseInt(newHealth.split("/")[1]);
      let difference = maxHealth - remainingHealth;
      newHealthRatio = remainingHealth / maxHealth;
      battle.dispatcher.dispatchToFront(() => {
        battlePokemon.data.currentHealth = remainingHealth;
        if (difference > 0 && !effect)
          playHurtAnimation(battlePokemon.visual, battlePokemon.mock?.data ?? battlePokemon.data);
        if (difference > 0) {
          let pokemon = battlePokemon.data;
          let evolutions = pokemon.getEvolutions();
          evolutions.forEach(x => {
            if (x.requirements.some(x => x instanceof DamageTakenRequirement)) {
              let progress = getEvolutionProgress<number>(pokemon, x.id, "damage_taken") || 0;
              setEvolutionProgress(pokemon, x.id, "damage_taken", progress + difference);
            }
          })
        }
        battlePokemon.syncWithOut();
        return GoDispatch;
      })
    }
    battle.minorBattleActions.set(battlePokemon.data.uuid, privateMessage);
    return new WaitDispatch(1);
  })
}

function handleDragInstruction(battle: PokemonBattle, actor: BattleActor, publicMessage: BattleMessage, privateMessage: BattleMessage, remainingLines: string[] = []) {
  let posAndUUID = publicMessage.showdownPositionAndUUID(0);
  if (!posAndUUID)
    return;
  let [pos, pokemonUUID] = posAndUUID;
  let [owner, activePokemon] = battle.getActorAndActiveSlotFromShowdownPosition(pos);
  let newPokemon = battle.getPokemon(pokemonUUID);
  let health = parseInt(privateMessage.argumentAt(2)?.split(" ")[0]?.split("/")[0] ?? "");
  if (!Number.isNaN(health) && health >= 0)
    newPokemon.currentHealth = Math.min(health, newPokemon.maxHealth || health);
  if (activePokemon)
    battle.majorBattleActions.set(activePokemon.data.uuid, publicMessage);
  battle.majorBattleActions.set(newPokemon.uuid, publicMessage);
  // Frente msd-fase2 (B4): arrastado para dentro (Roar/Whirlwind/Dragon Tail/Red Card) também entra sem forma
  // temporária nem Dynamax, como no `switch`.
  emitSafely(() => CobblemonEvents.emit("POKEMON_SWITCHED_IN", battle, newPokemon.uuid));
  midBattleSwitch(battle, owner, pos, newPokemon, {
    illusion: illusionOf(battle, publicMessage),
    imposter: isImposterSwitch(pos, remainingLines),
    drag: true,
    announce: () => battle.broadcastChatMessage(battleMsg("dragged_out", [newPokemon.getTranslatedName()])),
  });
}

function handleHitCountInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let battlePokemon = message.getBattlePokemon(0, battle);
    let hitCount = parseInt(message.argumentAt(1)!);
    if (!battlePokemon || Number.isNaN(hitCount))
      return;
    let msg = (hitCount == 1) ? battleMsg("hit_count_singular") : battleMsg("hit_count", [hitCount.toString()]);
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    battle.broadcastChatMessage(msg);
  })
}

function handleItemInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let sourceName = message.getSourceBattlePokemon(battle)?.getName() || { text: "UNKOWN" };
  broadcastOptionalAbility(battle, message.effect(), sourceName);

  battle.dispatcher.dispatchGo(() => {
    let battlePokemon = message.getBattlePokemon(0, battle);
    if (!battlePokemon)
      return;
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    //Held item manager
    let itemId = message.effectAt(1)?.id;
    if (!itemId)
      return;
    let consumeHeldItem = shouldConsumeItem(battlePokemon.data, battle);
    if (message.hasOptionalArgument("silent")) {
      if (consumeHeldItem) {
        battlePokemon.data.minecraftItem = undefined;
        battlePokemon.data.item = "";
        battlePokemon.syncWithOut();
      }
      return;
    }
    let effect = message.effect();
    let battlerName = battlePokemon.getName();
    // Airballoon is the only item using the null effect gimmick.
    if (effect == undefined) {
      battle.broadcastChatMessage(battleMsg(`item.${itemId}.start`, [battlerName]));
      return;
    }

    //TODO: Hopefully mojang will add a way to fetch item translations.
    let itemName = itemId;
    let effectId = effect.id;
    let msg = (() => {
      switch (effectId) {
        case "magician":
        case "pickpocket":
        case "covet":
        case "theif":
          return battleMsg("item.theif", [battlerName, itemName, sourceName]);
        case "pickup":
        case "recycle":
          return battleMsg("item.recycle", [battlerName, itemName]);
        case "switcheroo":
        case "trick":
          return battleMsg("item.trick", [battlerName, itemName]);
        default:
          return battleMsg(`item.${effectId}`, [battlerName, itemName, sourceName]);
      }
    })();
    battle.broadcastChatMessage(msg);
    //TODO: Impliment takeItemEffects and GiveItemEffects
  })
}

function handleEndItemInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => {
    let battlePokemon = message.getBattlePokemon(0, battle);
    let itemEffect = message.effectAt(1);
    if (!battlePokemon || !itemEffect)
      return;
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    if (message.hasOptionalArgument("eat")) {
      battlePokemon.entity.dimension.playSound("berry.eat", battlePokemon.entity.location);
    }
    //HeldItemManager
    let itemId = itemEffect.id;
    if (message.hasOptionalArgument("silent")) {
      battlePokemon.data.minecraftItem = undefined;
      battlePokemon.data.item = "";
      battlePokemon.syncWithOut();
      return;
    }
    let battlerName = battlePokemon.getName();
    //TODO: Hopefully mojang adds a way to get an item's translation key
    let itemName = itemId;
    if (message.hasOptionalArgument("eat")) {
      battle.broadcastChatMessage(battleMsg("item.eat", [battlerName, itemName]));
      battlePokemon.data.minecraftItem = undefined;
      battlePokemon.data.item = "";
      battlePokemon.syncWithOut();
      return;
    }
    let sourceName = message.getSourceBattlePokemon(battle)?.getName() || { text: "unknown" };
    let effect = message.effect();
    let msg = (() => {
      if (effect?.id)
        return battleMsg(`enditem.${effect.id}`, [battlerName, itemName, sourceName]);
      else if (["boosterenergy", "electricseed", "grassyseed", "mintyseed", "psychicseed", "roomservice"].includes(itemId))
        return battleMsg("enditem.generic", [battlerName, itemName]);
      else
        return battleMsg(`enditem.${itemId}`, [battlerName]);
    })();
    battlePokemon.data.minecraftItem = undefined;
    battlePokemon.data.item = "";
    battlePokemon.syncWithOut();
    battle.broadcastChatMessage(msg);
  })
}

function shouldConsumeItem(pokemon: PokemonData, battle: PokemonBattle): boolean {
  let tag = (() => {
    if (battle.isPVP)
      return "cobblemon:consumed_in_pvp_battle";
    else if (battle.isPvN)
      return "cobblemon:consumed_in_pvn_battle";
    else
      return "cobblemon:consumed_in_wild_battle";
  })();
  return pokemon.getHeldItem()?.hasTag(tag) || false;
}

function handleHealInstruction(battle: PokemonBattle, actor: BattleActor, publicMessage: BattleMessage, privateMessage: BattleMessage) {
  // Pode ser um Pokémon no banco (item da mochila, Wish): usa o PokemonData diretamente.
  let pokemonData = privateMessage.pokemonData(0, battle);
  let rawHpAndStatus = privateMessage.argumentAt(1)?.split(" ")
  let rawHpRatio = rawHpAndStatus?.[0]
  if (!pokemonData || !rawHpAndStatus || !rawHpRatio)
    return;
  let data = pokemonData;
  let newHealth = rawHpRatio.split("/").map(x => Number(x));
  let effect = privateMessage.effect();
  let pokemonName = data.getTranslatedName();
  broadcastOptionalAbility(battle, effect, pokemonName);

  battle.dispatcher.dispatchWaiting(1, () => {
    let silent = privateMessage.hasOptionalArgument("silent");
    if (!silent) {
      let msg = (() => {
        if (privateMessage.hasOptionalArgument("zeffect"))
          return battleMsg("heal.zeffect", [data]);
        if (privateMessage.hasOptionalArgument("wisher")) {
          let name = privateMessage.optionalArgument("wisher")!
          let wisher = actor.pokemon.find(x => x.uuid == name || toID(x.species) == toID(name));
          return battleMsg("heal.wish", [wisher?.getTranslatedName() || actor.nameOwned(name)]);
        }
        if (privateMessage.hasOptionalArgument("from") && effect) {
          if (effect.type == EffectType.ITEM) {
            if (["leftovers", "shellbell", "blacksludge"].includes(effect.id))
              return battleMsg("heal.leftovers", [data, effect.typelessData]);
            else
              return battleMsg("heal.item", [data, effect.typelessData]);
          }
          if (effect.id == "drain") {
            let drained = privateMessage.getSourceBattlePokemon(battle);
            return battleMsg("heal.drain", [drained?.getName() ?? pokemonName]);
          }
          return battleMsg(`heal.${effect.id}`, [data]);
        }
        return battleMsg("heal.generic", [data]);
      })();
      battle.broadcastChatMessage(msg);
    }
    battle.minorBattleActions.set(data.uuid, privateMessage);
    data.currentHealth = Math.round(newHealth[0]);
    // Reviver (item da mochila, Revival Blessing): deixa de estar desmaiado.
    if (data.currentHealth > 0 && data.status == StatusEffect.Faint)
      data.status = undefined;
    syncPokemonData(battle, data);

    //This part is not always present
    let rawStatus = rawHpAndStatus[1];
    if (!rawStatus)
      return;
    if (PersistentStatuses.includes(rawStatus) && data.status != rawStatus) {
      data.status = rawStatus as StatusEffect;
      syncPokemonData(battle, data);
      if (!silent) {
        battle.broadcastChatMessage(messages.With(`cobblemon.status.${statusNames[rawStatus]}.apply`, [data.getTranslatedName()]));
      }
    }
  })
}

function handleSetHPInstruction(battle: PokemonBattle, actor: BattleActor, publicMessage: BattleMessage, privateMessage: BattleMessage) {
  battle.dispatcher.dispatchWaiting(1, () => {
    let flatHP = Number(privateMessage.argumentAt(1)?.split("/")[0]);
    let data = privateMessage.pokemonData(0, battle);
    if (Number.isNaN(flatHP) || !data)
      return;
    data.currentHealth = Math.round(flatHP);
    syncPokemonData(battle, data);

    if (!publicMessage.hasOptionalArgument("silent")) {
      let effectId = publicMessage.effect()?.id;
      if (effectId)
        battle.broadcastChatMessage(battleMsg(`sethp.${effectId}`));
    }
    battle.minorBattleActions.set(data.uuid, publicMessage);
  })
}

function handleClearAllBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    battle.broadcastChatMessage(battleMsg("clearallboost"));
  })
}

function handleClearNegativeBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let battlePokemon = message.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  let pokemonName = battlePokemon.getName();
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let lang: RawMessage;
    if (message.hasOptionalArgument("zeffect"))
      lang = battleMsg("clearallnegativeboost.zeffect", [pokemonName]);
    else
      lang = battleMsg("clearallnegativeboost", [pokemonName]);
    if (!message.hasOptionalArgument("silent")) {
      battle.broadcastChatMessage(lang);
    }
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
  })
}

function handleZPowerInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let battlePokemon = message.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  let pokemonName = battlePokemon.getName();
  battle.dispatcher.dispatchWaiting(1, () => {
    battle.broadcastChatMessage(messages.color("Yellow", battleMsg("zpower", [pokemonName])));
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    emitSafely(() => CobblemonEvents.emit("ZPOWER", battle, battlePokemon));
  })
}

function handleZBrokenInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let battlePokemon = message.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  let pokemonName = battlePokemon.getName();
  battle.dispatcher.dispatchWaiting(1, () => {
    battle.broadcastChatMessage(messages.color("Red", battleMsg("zbroken", [pokemonName])));
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
  })
}

function handleTerastrallizeInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let battlePokemon = message.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  let pokemonName = battlePokemon.getName();
  let type = message.effectAt(1);
  if (!type)
    return;
  let typeTranslated: RawMessage = { translate: `cobblemon.type.${type.id}` }
  let typeName = message.argumentAt(1) ?? type.id;
  battle.dispatcher.dispatchWaiting(1, () => {
    // TerastallizeInstruction.kt: mensagem em amarelo e CobblemonEvents.TERASTALLIZATION.
    battle.broadcastChatMessage(messages.color("Yellow", battleMsg("terastallize", [pokemonName, typeTranslated])));
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    emitSafely(() => CobblemonEvents.emit("TERASTALLIZATION", battle, battlePokemon, typeName));
  })
}

/** FormeChangeInstruction.kt: `detailschange` (permanente) e `-formechange` (temporária). */
function handleDetailsChangeInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let battlePokemon = message.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  let pokemonName = battlePokemon.getName();
  let details = message.argumentAt(1)?.split(",")[0]?.toLowerCase();
  if (!details)
    return;
  let speciesName = details.split("-")[0];
  let formName = details.includes("-") ? details.substring(details.lastIndexOf("-") + 1) : speciesName;
  let typeKey = (message.id == "detailschange") ? "permanent" : "temporary";
  let forme = message.argumentAt(1)!.split(",")[0].trim();
  broadcastOptionalAbility(battle, message.effect(), pokemonName);
  battle.dispatcher.dispatchWaiting(1, () => {
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    // Frente msd-fase1: CobblemonEvents.FORME_CHANGE (a troca visual da forma é da extensão Mega Showdown).
    emitSafely(() => CobblemonEvents.emit("FORME_CHANGE", battle, battlePokemon, forme, message.id == "detailschange"));
    let lang: RawMessage | undefined = (() => {
      switch (formName) {
        case "busted":
        case "hero":
        case "complete":
          return undefined;
        case "school":
        case "wishiwashi":
        case "meteor":
        case "minior":
          return battleMsg(`formechange.${formName}`, [pokemonName]);
        case speciesName:
          return battleMsg("formechange.default.temporary.ended", [pokemonName]);
        default:
          return battleMsg(`formechange.default.${typeKey}`, [pokemonName, formName]);
      }
    })();
    if (lang)
      battle.broadcastChatMessage(lang);
  })
}

/**
 * `-mega` (MegaInstruction), `-primal` e `-burst`. Frente msd-fase1: o Cobblemon 1.8.2 não trata `-primal` e o MSD o
 * deixa sem mensagem (PrimalInstruction vazio); `-burst` usa `cobblemon.battle.ultra` (UltraInstruction do MSD).
 */
function handleMegaInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let battlePokemon = message.getBattlePokemon(0, battle);
  if (!battlePokemon)
    return;
  let pokemonName = battlePokemon.getName();
  let kind: "mega" | "primal" | "ultra" = message.id == "-primal" ? "primal" : message.id == "-burst" ? "ultra" : "mega";
  battle.dispatcher.dispatchWaiting(kind == "primal" ? 0 : 1, () => {
    if (kind != "primal")
      battle.broadcastChatMessage(messages.color("Yellow", battleMsg(kind, [pokemonName])));
    battle.minorBattleActions.set(battlePokemon.data.uuid, message);
    emitSafely(() => CobblemonEvents.emit("MEGA_EVOLUTION", battle, battlePokemon, kind));
  })
}

/** Ouvinte com erro não pode derrubar a fila da batalha. */
function emitSafely(emit: () => void) {
  try { emit(); }
  catch (e) { console.error(`BattleInterpreter: evento falhou: ${e instanceof Error ? e.stack ?? e.message : e}`); }
}

function handleClearBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let pokemon = message.getBattlePokemon(0, battle);
  if (!pokemon)
    return;
  battle.dispatcher.dispatchWaiting(1.5, () => {
    battle.broadcastChatMessage(battleMsg("clearboost", [pokemon.getName()]));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

/** `message`/`-message`: texto livre do Showdown (em inglês), repassado como está. */
function handleRawMessageInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let text = message.argumentAt(0);
  if (!text)
    return;
  battle.dispatcher.dispatchWaiting(1, () => battle.broadcastChatMessage(messages.toMessage(text!)));
}

/** `replace` (fim da Illusion, ReplaceInstruction): some o disfarce; a mensagem vem do `-end`. */
function handleReplaceInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let posAndUUID = message.showdownPositionAndUUID(0);
  if (!posAndUUID)
    return;
  let active = message.getBattlePokemon(0, battle);
  if (!active)
    return;
  battle.dispatcher.dispatch(() => endIllusion(battle, active));
}

function handleSetBoostInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchWaiting(1.5, () => {
    let pokemon = message.getBattlePokemon(0, battle);
    let effectID = message.effect()?.id;
    if (!pokemon || !effectID)
      return;
    battle.broadcastChatMessage(battleMsg(`setboost.${effectID}`, [pokemon.getName()]));
    battle.minorBattleActions.set(pokemon.data.uuid, message);
  })
}

/** `swap` (Ally Switch / shift de triplas): troca as posições ativas dos dois aliados. */
function handleSwapInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  let posAndUUID = message.showdownPositionAndUUID(0);
  let targetIndex = parseInt(message.argumentAt(1) ?? "");
  if (!posAndUUID || Number.isNaN(targetIndex))
    return;
  battle.dispatcher.dispatchWaiting(1, () => {
    let [position] = posAndUUID;
    let [actor, activeA] = battle.getActorAndActiveSlotFromShowdownPosition(position);
    let indexA = actor.slotFromLetter(position[2]);
    let activeB = actor.activePokemon[targetIndex] ?? null;
    actor.activePokemon[indexA] = activeB;
    actor.activePokemon[targetIndex] = activeA;
    if (!activeA || message.hasOptionalArgument("silent"))
      return;
    let lastCause = lastCauser.get(battle.battleId);
    let lang = (lastCause?.id == "move" && lastCause.effectAt(1)?.id == "allyswitch" && activeB)
      ? battleMsg("activate.allyswitch", [activeA.getName(), activeB.getName()])
      : battleMsg("shift", [activeA.getName()]);
    battle.broadcastChatMessage(lang);
  })
}

/** Court Change: as condições de lado são trocadas no Showdown; aqui não há estado local a mudar. */
function handleSwapSideConditionsInstruction(battle: PokemonBattle, message: BattleMessage, remainingLines: string[]) {
  battle.dispatcher.dispatchGo(() => battle.log(`Swap side conditions: ${message.rawMessage}`));
}

/**
 * ActivateInstruction (sketch): o golpe desenhado entra no lugar de Sketch no moveset (exchangeMove, com a
 * proporção de PP) e é salvo — no Cobblemon só no `effectedPokemon`, então clone de batalha não muda o real.
 */
export function applySketch(battle: PokemonBattle, pokemon: ActivePokemon, sketched: string | undefined) {
  if (!sketched)
    return;
  let data = pokemon.data;
  let slot = data.moves.findIndex(x => toID(x) == "sketch");
  let move = Dex.moves.get(sketched.replace(/[^A-Za-z0-9]/g, ""));
  if (slot == -1 || !move.exists)
    return;
  if (data.teachMove(move.id, slot))
    syncPokemonData(battle, data);
}

/** Grava o PokemonData no time do dono (se jogador) e na entidade em campo. */
function syncPokemonData(battle: PokemonBattle, data: PokemonData) {
  let active = battle.activePokemon.find(x => x?.data.uuid == data.uuid);
  if (active) {
    active.syncWithOut();
    return;
  }
  let owner = battle.getOwner(data.uuid);
  if (owner?.Player)
    data.tryUpdatePokemonInTeam(owner.Player);
}
