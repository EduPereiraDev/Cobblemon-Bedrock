import { Entity, Player, RawMessage, system } from "@minecraft/server";
import { uiManager } from "@minecraft/server-ui";
import { BattleSide } from "./BattleSide";
import { EntityUtils, UUID } from "../utils";
import { BattleDispatcher } from "./Dispatcher";
import { ActorType, BattleActor } from "./BattleActor";
import { ActivePokemon } from "./ActivePokemon";
import { BattleStream } from "../showdown";
import { message as messages, ColorCodes } from "../language";
import { interpretMessage } from "./BattleInterpreter";
import { BattleFormat } from "./BattleFormat";
import { BattleMessage } from "./BattleMessage";
import { PokemonData, StatusEffect } from "../Pokemon";
import { getConfig } from "../Config";
import { getSimPokemon } from "./SimQueries";
import { awardBattleRewards } from "./Rewards";
import { giveBagItem } from "./BagItems";
import { toID } from "../showdown";
import { CobblemonEvents } from "../events/CobblemonEvents";
import { markSeen } from "../pokedex/PokedexStorage";
import { releaseSpectators, tickSpectators } from "./Spectate";
import { cleanupBattleVisuals, tickBattleVisuals } from "./Switching";
import { endMock } from "./effects/Mock";
import { removePlatform } from "./Platform";

/** Ação de captura em andamento (BattleCaptureAction do Cobblemon; tipo completo em catching/CaptureSequence.ts). */
export interface BattleCaptureActionLike {
  battle: PokemonBattle;
  thrower: BattleActor;
  target: ActivePokemon;
  ballEntity: Entity;
}

/** Chamados para cada entidade liberada no fim da batalha (ex.: NPCs reaplicam os behaviours). */
export const battleEntityReleaseHooks: ((entity: Entity) => void)[] = [];

/**
 * Frente msd-fase4: chamados no fim da batalha, ANTES de sincronizar e gravar os Pokémon dos atores (o que um gancho
 * mudar em `actor.pokemon` é gravado). Vazio no base; o Mega Showdown grava aqui as formas de batalha que ele não
 * desfaz (AspectUtils.revertPokemonsIfRequiredBattleEnd: Shaymin congelado volta à forma Land e fica assim).
 */
export const battleEndHooks: ((battle: PokemonBattle) => void)[] = [];

export const battleMap = new Map<string, PokemonBattle>();

/** Como a batalha terminou. */
export type BattleEndReason = "win" | "tie" | "flee" | "forfeit" | "stopped" | "captured";

export interface BattleOptions {
  /** Distância para fugir do selvagem (padrão: config.defaultFleeDistance = 32). -1 = não dá para fugir. */
  fleeDistance?: number;
  /** Mostra o protocolo do Showdown no log de conteúdo. */
  mute?: boolean;
}

/** Intervalo (ticks) das checagens de participantes (morte, saída, dimensão). */
const PARTICIPANT_CHECK_INTERVAL = 10;
/** Intervalo (ticks) da actionbar/limpeza dos espectadores. */
const SPECTATOR_CHECK_INTERVAL = 20;
/** Intervalo (ticks) da balsa e da entidade de exibição de Illusion/Transform. */
const VISUAL_CHECK_INTERVAL = 5;

/** O jogador está em alguma batalha ativa (dynamic property "in_battle" válida). */
export function isPlayerInAnyBattle(player: Player): boolean {
  try {
    const id = player.getDynamicProperty("in_battle");
    return typeof id === "string" && battleMap.has(id);
  }
  catch {
    return false;
  }
}

export class PokemonBattle {
  runtimeID = system.runInterval(() => this.tick(), 1);
  fleeDistance: number;
  constructor(
    public format: BattleFormat,
    public side1: BattleSide,
    public side2: BattleSide,
    options: BattleOptions = {}
  ) {
    this.fleeDistance = options.fleeDistance ?? configNumber("defaultFleeDistance", 32);
    if (options.mute !== undefined)
      this.mute = options.mute;
    this.sides.forEach(x => x.battle = this);
    this.actors.forEach(actor => {
      actor.battle = this;
      actor.pokemon.forEach(x => {
        x.evolutionProgress.filter(x => x.variant == "battle_critical_hits")
          .forEach(x => x.progress = 0);
        if (actor.Player)
          x.tryUpdatePokemonInTeam(actor.Player);
        x.tryUpdatePokemonOut();
      })
      this.setupEntity(actor.actor);
      // EntityBackedBattleActor.initialPos: base das posições de envio (Switching.getSendOutPosition).
      try { actor.initialPos = { ...actor.actor.location }; } catch { }
    })
    //Set up stream
    void (async () => {
      try {
        for await (const chunk of this.battleStream) {
          interpretMessage(this.battleId, chunk);
        }
      }
      catch (e) {
        this.onSimulatorError(e);
      }
    })();
    battleMap.set(this.battleId, this);
    this.battleStream.write(`>start {"format":${format.toFormatJSON()}}`);
    let actorIndex = 1;
    for (let actor of side1.actors) {
      actor.showdownId = `p${actorIndex}`;
      actorIndex += 2;
    }

    actorIndex = 2;
    for (let actor of side2.actors) {
      actor.showdownId = `p${actorIndex}`;
      actorIndex += 2;
    }

    for (let actor of this.actors) {
      actor.activePokemon = new Array(format.battleType.slotsPerActor).fill(null);
    }
    for (let actor of this.actors) {
      let playerObj = {
        name: actor.actor.id.toString(),
        team: actor.pokemon.map(pokemon => pokemon.toShowdownSet())
      }
      this.battleStream.write(`>player ${actor.showdownId} ${JSON.stringify(playerObj)}`);
    }

    console.log("New Battle: " + this.battleId);
  }
  /** O simulador lançou um erro (ex.: "Stack overflow" em combinações raras): a batalha é encerrada. */
  onSimulatorError(error: unknown) {
    console.warn(`Battle ${this.battleId} simulator error: ${error instanceof Error ? error.stack ?? error.message : error}`);
    this.simulatorCrashed = true;
    if (this.ended)
      return;
    this.broadcastChatMessage(messages.error({ translate: "cobblemon.battle.crash" }));
    this.stop();
  }
  simulatorCrashed = false;
  /** O simulador já emitiu |win| ou |tie| (o fim está na fila do dispatcher). */
  outcomeDecided = false;

  /** Battle Logging */
  /** Quando falso, cada mensagem do Showdown vai para o log de conteúdo (útil para depurar). */
  mute = true;
  get sides() {
    return [this.side1, this.side2];
  }
  get actors() {
    return this.sides.flatMap(x => x.actors);
  }
  get activePokemon() {
    return [...this.side1.getActivePokemon(), ...this.side2.getActivePokemon()]
  }
  get players() {
    return this.actors.filter(x => x.actor instanceof Player).map(x => x.actor as Player);
  }
  get playerIDs() {
    return this.players.map(x => x.id);
  }
  spectators: Player[] = [];
  battleId = UUID.generate();
  battleStream = new BattleStream();

  //Logs
  showdownMessages: string[] = [];
  battleLog: string[] = [];
  chatLog: RawMessage[] = [];
  started = false;
  ended = false;
  endReason?: BattleEndReason;
  turn = 1;
  ticks = 0;
  /** Ordem dos desmaios (faintedAt do Cobblemon), para awardExperienceToFaintedPokemon. */
  faintCounter = 0;
  faintedAt = new Map<string, number>();
  /** UUID → UUIDs dos oponentes enfrentados (facedOpponents), base da EXP e dos EVs. */
  facedOpponents = new Map<string, Set<string>>();

  dispatcher = new BattleDispatcher(x => {
    console.error(`Error while ticking a battle: ${x instanceof Error ? `${x.name}: ${x.message}\n${x.stack ?? ""}` : x}`);
    this.broadcastChatMessage(messages.error({ translate: "cobblemon.battle.crash" }));
    this.stop();
  });

  /** Capturas em andamento: as escolhas ficam retidas até a bola terminar de sacudir. */
  captureActions: BattleCaptureActionLike[] = [];
  /** Escolhas que esperam as capturas terminarem. */
  private heldShowdownActions: string[] = [];
  /** Pokémon selvagens capturados nesta batalha (não são curados/atualizados no fim). */
  capturedUUIDs = new Set<string>();

  majorBattleActions = new Map<string, BattleMessage>();
  minorBattleActions = new Map<string, BattleMessage>();

  /** Whether or not one side has a player and the other side has a wild pokemon. */
  get isPvW() {
    let playerSide = this.sides.find(x => x.actors.some(y => y.type == ActorType.PLAYER));
    if (!playerSide)
      return false;
    if (playerSide.actors.some(x => x.type != ActorType.PLAYER))
      return false;

    let otherSide = playerSide.getOppositeSide();
    return otherSide.actors.every(x => x.type == ActorType.WILD);
  }

  /** Whether or not there are players on both sides. */
  get isPVP() {
    return this.sides.every(x => x.actors.some(y => y.type == ActorType.PLAYER));
  }

  /** Whether or not there is one player side and one npc side. */
  get isPvN() {
    let playerSide = this.sides.find(x => x.actors.some(y => y.type == ActorType.PLAYER));
    if (!playerSide)
      return false;
    if (playerSide.actors.some(x => x.type != ActorType.PLAYER))
      return false;

    let otherSide = playerSide.getOppositeSide();
    return otherSide.actors.every(x => x.type == ActorType.NPC);
  }

  /** Gets the actor based on their showdown id (p1, p3, so on) */
  getActorFromShowdownID(showdownID: string) {
    return this.actors.find(actor => actor.showdownId == showdownID);
  }

  /** Gets the actor based on their entity id. */
  getActorFromID(entityID: string) {
    return this.actors.find(actor => actor.actor.id == entityID)
  }

  /** Takes in a showdown position (ex: p2a) and returns the active pokemon. */
  getActorAndActiveSlotFromShowdownPosition(showdownPosition: string): [BattleActor, ActivePokemon | null] {
    let playerPos = showdownPosition.substring(0, 2);
    let actor = this.getActorFromShowdownID(playerPos);
    if (!actor)
      throw new Error("Invalid Showdown Position: " + showdownPosition + " - Unknown Actor");
    let letter = showdownPosition[2];
    let activePokemon = actor.activePokemon[actor.slotFromLetter(letter)];
    if (activePokemon === undefined)
      throw new Error("Invalid Showdown Position: " + showdownPosition + " - Unknown Pokemon");
    return [actor, activePokemon];
  }

  /** Takes in the player position and pokemon uuid and returns the active pokemon. */
  getActivePokemon(showdownPosition: string, pokemonUUID: string): [BattleActor, ActivePokemon] {
    let playerPos = showdownPosition.substring(0, 2);
    let actor = this.getActorFromShowdownID(playerPos);
    if (!actor)
      throw new Error("Invalid Showdown Position: " + showdownPosition + " - Unknown Actor");
    // Quem está sendo recolhido (animação da troca) ainda responde pelas linhas já lidas do protocolo.
    let pokemon = actor.activePokemon.find(x => x?.data.uuid == pokemonUUID) ?? actor.retiringPokemon.find(x => x.data.uuid == pokemonUUID);
    if (!pokemon)
      throw new Error("Invalid Showdown Position: " + pokemonUUID + " - Unknown Pokemon");
    return [actor, pokemon];
  }

  /** BEDROCK: Gets the team pokemon data corresponding to the uuid. */
  getPokemon(pokemonUUID: string): PokemonData {
    let output = this.actors.flatMap(x => x.pokemon).find(x => x.uuid == pokemonUUID);
    if (!output)
      throw new Error("The pokemon's uuid could not be found in the battle.");
    return output;
  }

  /** Ator dono de um Pokémon da batalha. */
  getOwner(pokemonUUID: string): BattleActor | undefined {
    return this.actors.find(actor => actor.pokemon.some(x => x.uuid == pokemonUUID));
  }

  /** Send chat message to all players, including spectators. */
  broadcastChatMessage(message: RawMessage) {
    this.chatLog.push(message);
    [...this.spectators, ...this.actors.map(x => x.actor).filter(x => x instanceof Player)].forEach(player => {
      try {
        if (player.isValid)
          player.sendMessage(message);
      }
      catch { }
    })
  }

  writeShowdownAction(...messages: string[]) {
    this.log(messages.join("\n"));
    messages.forEach(x => this.battleStream.write(x));
  }

  /** Escolha de um ator: retida enquanto houver captura em andamento (checkForInputDispatch do Cobblemon). */
  writeChoice(choice: string) {
    if (this.captureActions.length > 0)
      this.heldShowdownActions.push(choice);
    else
      this.writeShowdownAction(choice);
  }

  /** A captura terminou (sucesso ou fuga): libera as escolhas retidas. */
  finishCaptureAction(action: BattleCaptureActionLike) {
    this.captureActions = this.captureActions.filter(x => x !== action);
    if (this.captureActions.length > 0 || this.ended)
      return;
    let held = this.heldShowdownActions;
    this.heldShowdownActions = [];
    held.forEach(x => this.writeShowdownAction(x));
  }

  /**
   * Captura em batalha deu certo (`>capture` do fork do Cobblemon): o Pokémon sai e a batalha termina como
   * vitória de quem capturou (BATTLE_VICTORY com wasCaught = true), sem EXP pelo capturado.
   */
  captureSucceeded(action: BattleCaptureActionLike) {
    if (this.ended)
      return;
    let captured = action.target.data;
    this.capturedUUIDs.add(captured.uuid);
    this.captureActions = this.captureActions.filter(x => x !== action);
    this.heldShowdownActions = [];
    let winners = action.thrower.getSide().actors;
    let losers = action.thrower.getSide().getOppositeSide().actors;
    let slot = action.target.actor.activePokemon.indexOf(action.target);
    // Antes de tirar do slot: o cleanupBattleVisuals só enxerga quem está nos slots, então a entidade de exibição
    // (Illusion/Transform) e a balsa do capturado sairiam do alcance e ficariam no mundo.
    try { endMock(action.target, false); } catch { }
    try { removePlatform(captured.uuid); } catch { }
    if (slot != -1)
      action.target.actor.activePokemon[slot] = null;
    this.stop("captured");
    CobblemonEvents.emit("BATTLE_VICTORY", this, winners, losers, true);
  }

  /** Pokédex: todos os jogadores da batalha "viram" o Pokémon (POKEMON_SEEN do Cobblemon). */
  markSeenByPlayers(pokemon: PokemonData) {
    for (let actor of this.actors) {
      let player = actor.Player;
      if (!player?.isValid || actor.pokemon.includes(pokemon))
        continue;
      try {
        markSeen(player, pokemon);
      }
      catch { }
    }
  }

  /** Signifies a new turn in the battle. */
  newTurn(newTurnNumber: number) {
    this.actors.forEach(x => x.turn());
    this.updateFacedOpponents();
    this.turn = newTurnNumber;
  }

  /** PokemonBattle.turn do Cobblemon: cada Pokémon vivo em campo "enfrentou" os inimigos vivos em campo. */
  updateFacedOpponents() {
    for (let side of this.sides) {
      let opposite = side.getOppositeSide().getActivePokemon().filter(x => x != null && x.data.currentHealth > 0);
      for (let active of side.getActivePokemon()) {
        if (!active || active.data.currentHealth <= 0)
          continue;
        let faced = this.facedOpponents.get(active.data.uuid) ?? new Set<string>();
        opposite.forEach(x => faced.add(x!.data.uuid));
        this.facedOpponents.set(active.data.uuid, faced);
      }
    }
  }

  hasFaced(pokemonUUID: string, opponentUUID: string) {
    return this.facedOpponents.get(pokemonUUID)?.has(opponentUUID) ?? false;
  }

  /**
   * Fim da batalha (PokemonBattle.end do Cobblemon): sincroniza HP/PP/status com o simulador, dá EXP/EVs,
   * devolve itens da mochila não usados, cura o selvagem que sobreviveu e limpa as propriedades.
   */
  end(reason: BattleEndReason = "stopped") {
    if (this.ended)
      return;
    this.ended = true;
    this.endReason = reason;
    console.info(`Battle ${this.battleId} ended (${reason})`);
    battleMap.delete(this.battleId);
    system.clearRun(this.runtimeID);

    for (const hook of battleEndHooks) this.guard("endHooks", () => hook(this));
    this.guard("sync", () => this.syncFromSimulator());
    this.guard("rewards", () => awardBattleRewards(this));
    this.guard("refund", () => this.refundUnusedItems());
    this.guard("heal", () => this.healWildPokemon());
    this.guard("visuals", () => cleanupBattleVisuals(this));
    this.guard("cleanup", () => this.cleanUpEntities());
    this.guard("blackout", () => this.notifyBlackout());
    this.guard("spectators", () => releaseSpectators(this));
  }

  private guard(step: string, run: () => void) {
    try {
      run();
    }
    catch (e) {
      console.error(`Battle ${this.battleId} end step '${step}' failed: ${e}`);
    }
  }

  /** HP, status e PP finais vêm do simulador (o intérprete não recebe atualização de PP). */
  syncFromSimulator() {
    for (let actor of this.actors) {
      for (let pokemon of actor.pokemon) {
        let sim = getSimPokemon(this, pokemon.uuid);
        if (!sim || this.capturedUUIDs.has(pokemon.uuid))
          continue;
        // Frente msd-fase3: batalha que termina com o Pokémon em Dynamax volta ao HP sem o Dynamax (Pokemon.getUndynamaxedHP).
        pokemon.currentHealth = sim.fainted ? 0 : sim.getUndynamaxedHP();
        // Pokemon.currentHealth do Cobblemon corta no HP máximo dos dados: forma de batalha com mais HP (Tera Shift,
        // Terapagos-Stellar) não deixa o Pokémon acima do máximo depois da batalha.
        if (pokemon.maxHealth > 0 && pokemon.currentHealth > pokemon.maxHealth) pokemon.currentHealth = pokemon.maxHealth;
        if (pokemon.currentHealth <= 0)
          pokemon.status = StatusEffect.Faint;
        else if (sim.status) {
          pokemon.status = sim.status as StatusEffect;
          pokemon.statusDuration = sim.status == "slp" ? sim.statusState?.time : undefined;
        }
        else {
          pokemon.status = undefined;
          pokemon.statusDuration = undefined;
        }
        sim.baseMoveSlots.forEach(slot => {
          let index = pokemon.moves.findIndex(move => toID(move) == slot.id);
          if (index != -1 && pokemon.movesInfo[index])
            pokemon.movesInfo[index].pp = Math.max(0, Math.min(slot.pp, pokemon.movesInfo[index].maxPp ?? slot.maxpp));
        });
      }
      if (actor.Player?.isValid)
        actor.pokemon.forEach(x => {
          x.tryUpdatePokemonInTeam(actor.Player);
          // A entidade em campo também recebe HP/status/PP finais (senão fica com os dados de antes da batalha).
          if (x.currentHealth > 0) x.tryUpdatePokemonOut();
        });
    }
  }

  /** Itens gastos cujo uso o Showdown não confirmou (batalha acabou antes) voltam ao jogador. */
  refundUnusedItems() {
    for (let actor of this.actors) {
      let player = actor.Player;
      if (player?.isValid)
        actor.itemsUsed.forEach(item => giveBagItem(player!, item.typeId));
      actor.itemsUsed = [];
    }
  }

  /** O selvagem que sobreviveu volta curado (Pokemon.heal no fim da batalha). */
  healWildPokemon() {
    this.actors
      .filter(x => x.type == ActorType.WILD)
      .forEach(x => {
        x.pokemon.filter(pokemon => pokemon.currentHealth > 0 && !this.capturedUUIDs.has(pokemon.uuid)).forEach(pokemonData => {
          pokemonData.updateMaxHP();
          pokemonData.currentHealth = pokemonData.maxHealth;
          pokemonData.status = undefined;
          pokemonData.statusDuration = undefined;
          pokemonData.movesInfo.forEach(info => info.pp = info.maxPp);
          pokemonData.tryUpdatePokemonOut();
        })
      })
  }

  /** Tira as marcas de batalha de atores e Pokémon e fecha telas abertas. */
  cleanUpEntities() {
    let entities: Entity[] = [...this.actors.map(x => x.actor), ...this.activePokemon.filter(x => x != null && !x.pending).map(x => x!.entity)];
    for (let actor of this.actors) {
      for (let pokemon of actor.pokemon) {
        let entity = pokemon.tryGetPokemonOut();
        if (entity)
          entities.push(entity);
      }
    }
    for (let entity of entities) {
      try {
        if (!entity?.isValid)
          continue;
        if (entity.getDynamicProperty("in_battle") === this.battleId)
          entity.setDynamicProperty("in_battle", undefined);
        entity.setProperty("cobblemon:in_battle", false);
        // Devolve a IA (Pokémon/NPC têm o evento; outras entidades ignoram).
        try { entity.triggerEvent("cobblemon:battle_end"); } catch { }
        for (const hook of battleEntityReleaseHooks) {
          try { hook(entity); } catch (e) { console.warn(`battle release hook: ${e}`); }
        }
        entity.getTags().filter(tag => tag.startsWith("targetedBy:")).forEach(tag => entity.removeTag(tag));
      }
      catch { }
    }
    // Clones de batalha (cloneParties/setLevel) somem no fim (postBattleEntityOperation = recallWithAnimation).
    for (let actor of this.actors) {
      for (let pokemon of actor.pokemon) {
        if (!pokemon.battleClone)
          continue;
        try {
          let entity = pokemon.tryGetPokemonOut();
          if (entity?.isValid)
            entity.triggerEvent("cobblemon:instant_kill");
        }
        catch { }
      }
    }
    // Pokémon de NPC não têm dono nem bola: saem do mundo quando a batalha acaba, de qualquer jeito.
    for (let actor of this.actors) {
      if (actor.type != ActorType.NPC)
        continue;
      // (A posição "a caminho" guarda o próprio NPC como marcador: não é Pokémon para sumir.)
      let npcEntities: Entity[] = actor.activePokemon.filter(x => x != null && !x.pending).map(x => x!.entity);
      for (let pokemon of actor.pokemon) {
        try {
          let entity = pokemon.tryGetPokemonOut();
          if (entity) npcEntities.push(entity);
        }
        catch { }
      }
      for (let entity of npcEntities) {
        try {
          if (entity?.isValid)
            entity.triggerEvent("cobblemon:instant_kill");
        }
        catch { }
      }
    }
    for (let actor of this.actors) {
      actor.mustChoose = false;
      actor.request = undefined;
      let player = actor.Player;
      if (player?.isValid && actor.prompting) {
        try { uiManager.closeAllForms(player); } catch { }
      }
      actor.prompting = false;
    }
  }

  /** Todos os Pokémon do jogador desmaiaram: aviso (o Cobblemon 1.8.2 não tem "blackout"/teleporte). */
  notifyBlackout() {
    for (let actor of this.actors) {
      let player = actor.Player;
      if (!player?.isValid || actor.pokemon.length == 0)
        continue;
      if (actor.pokemon.every(x => x.currentHealth <= 0))
        player.sendMessage(messages.color("Red", messages.With("cobblemon.port.battle.blacked_out", [player.name])));
    }
  }

  log(message = "") {
    if (!this.mute)
      console.info(message);
    this.battleLog.push(message);
  }

  tick() {
    if (this.ended)
      return;
    this.ticks++;
    this.dispatcher.tick();
    if (this.ended)
      return;
    if (this.ticks % PARTICIPANT_CHECK_INTERVAL == 0)
      this.checkParticipants();
    if (!this.ended && this.ticks % VISUAL_CHECK_INTERVAL == 0)
      tickBattleVisuals(this);
    if (!this.ended && this.ticks % SPECTATOR_CHECK_INTERVAL == 0 && this.spectators.length > 0)
      tickSpectators(this, isPlayerInAnyBattle);
    if (!this.ended && this.started && this.isPvW && this.dispatcher.dispatches.length == 0)
      this.checkFlee();
  }

  /**
   * Regras de permanência: jogador que saiu, morreu ou mudou de dimensão encerra a batalha; entidade
   * de ator que sumiu (selvagem capturado/despawnado) também.
   */
  checkParticipants() {
    // |win|/|tie| já chegou do simulador: o fim vem pelo despacho dessa linha.
    if (this.outcomeDecided)
      return;
    for (let actor of this.actors) {
      let entity = actor.actor;
      let gone = !entity.isValid;
      if (!gone && actor.type == ActorType.PLAYER) {
        try {
          if (actor.dimensionId && entity.dimension.id != actor.dimensionId)
            gone = true;
          let health = entity.getComponent("minecraft:health");
          if (health && health.currentValue <= 0)
            gone = true;
        }
        catch {
          gone = true;
        }
      }
      // Selvagem derrotado: o FaintInstruction mata a entidade antes do |win| ser despachado; não é "sumiu".
      // (frente animacao: com a espera dos action_effects a checagem passou a cair nessa janela.)
      // O desmaio atualiza a cópia do Pokémon ativo (ActivePokemon.data), que pode não ser o mesmo objeto de
      // actor.pokemon; faintedAt é gravado (por UUID) antes de a entidade morrer.
      if (gone && actor.type == ActorType.WILD && actor.pokemon.every(p => p.currentHealth <= 0 || this.faintedAt.has(p.uuid)))
        continue;
      if (gone) {
        this.stop();
        return;
      }
    }
  }

  checkFlee() {
    let wildPokemonOutOfRange = !this.actors
      .filter(x => x.type == ActorType.WILD)
      .filter(x => x.actor.isValid)
      .some(pokemonActor => {
        if (this.fleeDistance == -1)
          return true;
        let dimension = pokemonActor.actor.dimension.id;

        let playerDistances = this.actors
          .filter(x => x.type == ActorType.PLAYER)
          .filter(x => x.actor.isValid)
          .filter(x => x.actor.dimension.id == dimension)
          .map(x => EntityUtils.DistanceBetween(x.actor.location, pokemonActor.actor.location))

        return playerDistances.length > 0 && Math.min(...playerDistances) < this.fleeDistance;
      })
    if (wildPokemonOutOfRange)
      this.flee();
  }

  /** Fuga da batalha selvagem (por distância). O selvagem é curado em end(). */
  flee() {
    if (this.ended)
      return;
    this.broadcastChatMessage(messages.color("Yellow", { translate: "cobblemon.battle.flee" }));
    // Frente dados-ui: BATTLE_FLED (estatística battles_fled).
    CobblemonEvents.emit("BATTLE_FLED", this);
    this.stop("flee");
  }

  /** O ator desiste (Cobblemon: `>forcelose`); o Showdown responde com `|win|` para o outro lado. */
  forfeit(actor: BattleActor) {
    if (this.ended)
      return;
    this.broadcastChatMessage(messages.color("Red", messages.battleMsg("forfeit", [actor.getName()])));
    actor.mustChoose = false;
    this.writeShowdownAction(`>forcelose ${actor.showdownId}`);
  }

  /** Encerra sem vencedor (>forcetie). */
  stop(reason: BattleEndReason = "stopped") {
    if (this.ended)
      return;
    this.end(reason);
    this.writeShowdownAction(">forcetie");
  }

  /** Mantido para compatibilidade: as escolhas são enviadas por cada ator em submitResponses. */
  checkForInputDispatch() {
  }

  /**
   * Creates a [Text] representation of an error to interpret a battle message.
   * This also logs the error, the goal of this function is to make sure users see missing interpretations and report them to us.
   * Logging is independent of [mute].
   *
   * @param message The [BattleMessage] that wasn't able to find a lang interpretation.
   * @return The generated [Text] meant to notify the client.
   */
  createUnimplimented(message: BattleMessage) {
    let text = `Missing interpretation on ${message.id} action ${message.rawMessage}`;
    console.error(text);
    return messages.error(text);
  }

  createUnimplimentedSplit(publicMessage: BattleMessage, privateMessage: BattleMessage): RawMessage {
    if (publicMessage.id != privateMessage.id)
      throw new Error("Messages do not match.")
    console.error(`Missing Interpretation on '${publicMessage.id} action: \nPublic >> ${publicMessage.rawMessage}\nPrivate >> ${privateMessage.rawMessage}'`);
    return messages.error(`Missing Interpretation on '${publicMessage.id}' action please report to the developers`);
  }

  /** Sets the entity properties to indicate that the pokemon is in a battle. */
  setupEntity(entity: Entity) {
    try {
      entity.setDynamicProperty("in_battle", this.battleId);
      entity.setProperty("cobblemon:in_battle", true);
    }
    catch { }
    // Congela a IA durante a batalha (sem andar, revidar ou fugir), como no Cobblemon.
    try { if (!(entity instanceof Player)) entity.triggerEvent("cobblemon:battle_start"); } catch { }
  }
}


function configNumber(key: string, fallback: number): number {
  try {
    let value = (getConfig() as unknown as Record<string, unknown>)[key];
    return typeof value == "number" ? value : fallback;
  }
  catch {
    return fallback;
  }
}

/** Mensagem de vitória com cor (usada pelo intérprete). */
export function winMessage(names: RawMessage[]): RawMessage {
  return messages.prefix(ColorCodes.Gold, messages.With("cobblemon.battle.win", [{ rawtext: names }]));
}
