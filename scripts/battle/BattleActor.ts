import { PokemonBattle } from "./PokemonBattle";
import { PokemonData } from "../Pokemon";
import { Entity, Player, RawMessage, Vector3 } from "@minecraft/server";
import { ActivePokemon } from "./ActivePokemon";
import { RequestData, requestPokemonUUID } from "./Request";
import {
  ActionResponse, BagItemActionResponse, FleeAttemptActionResponse, ForcePassActionResponse, ForfeitActionResponse,
  PassActionResponse, ResponseContext
} from "./ActionResponse";
import { BattleMoveset } from "./BattleMoveset";
import { handleMoveRequest } from "../GUI/Battle";
import { message } from "../language";
import type { BattleAI } from "./ai/BattleAI";
import { RandomBattleAI } from "./ai/RandomBattleAI";
import { consumeBagItem } from "./BagItems";
import { getSimPokemon } from "./SimQueries";
import { changeFriendship } from "./PokemonCompat";
import { battlePromptHooks, type PromptSource } from "./BattlePromptHooks";
import { sanitizePlayerRequest } from "./Gimmicks";

export enum ActorType {
  WILD,
  PLAYER,
  NPC
}

/** Item da mochila gasto cujo uso ainda não foi confirmado pelo Showdown (`|bagitem|`). */
export interface UsedBagItem {
  typeId: string;
  itemName: string;
  returnItem?: string;
}

/** Decide as ações de um jogador sem abrir a tela (testes, piloto automático). */
export type PlayerDecider = (actor: BattleActor, request: RequestData) => ActionResponse[] | undefined | Promise<ActionResponse[] | undefined>;

export interface BattleActorOptions {
  /** Força o tipo (senão: jogador, Pokémon selvagem ou NPC pela entidade). */
  type?: ActorType;
  /** IA dos atores que não são jogadores (padrão: RandomBattleAI, como os selvagens do Cobblemon). */
  ai?: BattleAI;
  /** Nome exibido (NPCs). */
  name?: RawMessage;
}

export class BattleActor {
  type: ActorType;
  ai?: BattleAI;
  customName?: RawMessage;
  constructor(
    public actor: Entity,
    public pokemon: PokemonData[],
    options: BattleActorOptions = {}
  ) {
    this.type = options.type ?? ((actor instanceof Player) ? ActorType.PLAYER
      : (actor.getComponent("type_family")?.hasTypeFamily("pokemon")) ? ActorType.WILD
        : ActorType.NPC);
    this.customName = options.name;
    // Capturados já no início: depois que o jogador sai do servidor, ler a entidade lança InvalidEntityError.
    this.entityId = actor.id;
    if (actor instanceof Player)
      try { this.playerName = actor.name; } catch { }
    if (this.type != ActorType.PLAYER)
      this.ai = options.ai ?? new RandomBattleAI();
    try {
      this.dimensionId = actor.dimension.id;
    }
    catch { }
  }

  /** Id da entidade (capturado no início; vale mesmo depois de a entidade ficar inválida). */
  readonly entityId: string;
  /** Nome do jogador capturado no início (a entidade fica inválida quando ele sai do servidor). */
  playerName?: string;

  //Lateinit
  battle!: PokemonBattle
  /** Position of the player Ex: p1 or p2 */
  showdownId!: string

  /** Null indicates that there is a space there but it is empty. (Maybe only one pokemon left) */
  activePokemon: (ActivePokemon | null)[] = [];
  canDynamax = false;
  request?: RequestData;
  /** Aumenta a cada request; respostas de telas abertas para um request antigo são descartadas. */
  requestId = 0;
  responses: ActionResponse[] = [];
  expectingPassActions: ActionResponse[] = [];
  mustChoose = false
  /** Itens gastos neste turno/batalha ainda não confirmados (devolvidos no fim da batalha). */
  itemsUsed: UsedBagItem[] = [];
  /** Há uma tela de escolha aberta para este jogador. */
  prompting = false;
  /** Substitui a tela (testes). */
  decider?: PlayerDecider;
  /** Dimensão no início da batalha: mudar de dimensão encerra a batalha. */
  dimensionId?: string;
  /** Já avisou como reabrir o menu depois de fechar a tela neste request. */
  private closedHintSent = -1;

  /** For when battles start, it's the number of Pokémon that are still in the process of being sent out (animation wise) */
  stillSendingOutCount = 0;
  /** Posição do ator no começo da batalha (EntityBackedBattleActor.initialPos), base das posições de envio. */
  initialPos?: Vector3;
  /**
   * Pokémon que saíram de posição ativa mas ainda estão sendo recolhidos (animação): continuam achados pelas
   * linhas do protocolo já lidas (frente visual-batalha, Switching.ts).
   */
  retiringPokemon: ActivePokemon[] = [];

  private _battleTheme: string | undefined = undefined
  get battleTheme() {
    return this._battleTheme;
  }
  set battleTheme(theme) {
    if (!(this.actor instanceof Player))
      return;
    if (theme) {
      this.updateMusic();
    }
    else {
      this.actor.stopMusic();
    }
    this._battleTheme = theme;
  }

  /** BEDROCK: Easy access to the player. Mostly for legacy code with Old Battle Participant Type */
  get Player() {
    if (this.actor instanceof Player)
      return this.actor as Player;
    else
      return undefined
  }

  getName(): RawMessage {
    if (this.customName)
      return this.customName;
    if (this.actor instanceof Player)
      return message.toMessage(this.actor.isValid ? this.actor.name : this.playerName ?? this.entityId);
    else if (this.type == ActorType.WILD)
      return this.pokemon[0].getTranslatedName()
    else
      return message.toMessage(this.actor.nameTag || this.actor.typeId);
  }

  nameOwned(name: string): RawMessage {
    if (this.type == ActorType.WILD)
      return { text: name };
    return message.battleMsg("owned_pokemon", [this.getName(), name]);
  }

  /**
   * Posição (slot) a partir da letra do Showdown. Em multi, p3/p4 ficam na segunda metade do campo
   * ("p3b"), então a letra é deslocada por floor(n/2) × posições do ator.
   */
  slotFromLetter(letter: string): number {
    return letter.toLowerCase().charCodeAt(0) - 97 - this.letterOffset;
  }

  letterFromSlot(slot: number): string {
    return String.fromCharCode(97 + slot + this.letterOffset);
  }

  private get letterOffset() {
    let n = parseInt(this.showdownId?.substring(1) ?? "1") - 1;
    return Math.floor(n / 2) * this.slotCount;
  }

  /** Número de posições ativas do ator no formato. */
  get slotCount() {
    return this.battle.format.battleType.slotsPerActor;
  }

  /** Se a posição precisa de uma escolha neste request (senão recebe "pass"). */
  slotNeedsChoice(slot: number, request = this.request): boolean {
    if (!request)
      return false;
    if (request.forceSwitch) {
      if (!request.forceSwitch[slot])
        return false;
      // Mais posições para trocar do que reservas vivas: as que sobram passam (forcedPassesLeft do Showdown).
      let earlier = request.forceSwitch.slice(0, slot).filter(x => x).length;
      let bench = request.side.pokemon.filter(x => !x.active && !(x.condition.endsWith(" fnt") || x.condition.startsWith("0"))).length;
      return earlier < bench;
    }
    let pokemon = request.side.pokemon[slot];
    if (!request.active?.[slot] || !pokemon)
      return false;
    return !(pokemon.condition.endsWith(" fnt") || pokemon.condition.startsWith("0") || pokemon.commanding);
  }

  /** Posições que podem receber uma ação forçada (golpe, não troca obrigatória). */
  private countMovableSlots() {
    if (!this.request || this.request.forceSwitch)
      return 0;
    let count = 0;
    for (let slot = 0; slot < this.slotCount; slot++)
      if (this.slotNeedsChoice(slot)) count++;
    return count;
  }

  canFitForcedAction() {
    if (!this.request)
      return false;
    return this.mustChoose && !this.battle.ended && this.countMovableSlots() > this.expectingPassActions.length
  }

  /**
   * Ocupa a vez de uma posição com uma ação forçada (ex.: Poké Bola arremessada em batalha →
   * ForcePassActionResponse). Se todas as posições ficarem forçadas, a escolha é enviada na hora.
   */
  forceChoose(response: ActionResponse) {
    this.expectingPassActions.push(response);
    if (this.expectingPassActions.length >= this.countMovableSlots())
      this.submitResponses([]);
  }

  getSide() {
    return (this.battle.side1.actors.includes(this)) ? this.battle.side1 : this.battle.side2
  }

  getPlayerIDs() {
    return (this.type == ActorType.PLAYER) ? [this.actor.id] : [];
  }

  isForPlayer(player: Player) {
    return this.getPlayerIDs().includes(player.id);
  }

  isForPokemon(entity: Entity) {
    // Também a entidade de exibição de Illusion/Transform; a posição "a caminho" ainda não tem entidade.
    return this.activePokemon.some(x => !!x && !x.pending && (x.entity.id == entity.id || x.mock?.entity.id == entity.id));
  }

  /** Novo turno (TurnInstruction). As escolhas são pedidas quando chega o request. */
  turn() {
  }

  upkeep() {
  }

  /** Chegou um `|request|` do Showdown para este ator. */
  receiveRequest(request: RequestData) {
    // Frente msd-fase1: ShowdownActionRequest.sanitize — gimmick sem item-chave some do request do jogador.
    if (this.type == ActorType.PLAYER)
      sanitizePlayerRequest(request, this.Player);
    this.request = request;
    this.requestId++;
    this.responses = [];
    this.expectingPassActions = [];
    let needsChoice = !request.wait && ((request.active?.length ?? 0) > 0 || !!request.forceSwitch?.some(x => x));
    this.mustChoose = needsChoice;
    if (!needsChoice)
      return;
    if (this.type == ActorType.PLAYER) {
      // Abre a tela depois das mensagens/animações do turno que acabou.
      this.battle.dispatcher.doWhenClear(() => this.promptPlayerForRequest("turn"));
    }
    else {
      this.makeAIChoice();
    }
  }

  private makeAIChoice() {
    if (!this.request || !this.ai || this.battle.ended)
      return;
    let choice: string;
    try {
      choice = this.ai.choose(this, this.request);
    }
    catch (e) {
      console.warn(`Battle AI failed (${e instanceof Error ? e.stack ?? e.message : e}); using default choice.`);
      choice = "default";
    }
    this.mustChoose = false;
    this.battle.writeChoice(`>${this.showdownId} ${choice}`);
  }

  /** Contexto de uma posição para validar/serializar respostas. */
  getResponseContext(slot: number, request = this.request!): ResponseContext {
    let moveset = request.active?.[slot];
    return {
      actor: this,
      request,
      slot,
      active: this.activePokemon[slot] ?? null,
      moveset: moveset ? BattleMoveset.parse(moveset) : undefined,
      forceSwitch: request.forceSwitch?.[slot] ?? false,
    };
  }

  /**
   * Recebe as respostas (uma por posição, na ordem) e envia ao Showdown. Posições que não precisam
   * agir podem vir como PassActionResponse ou faltar. Desistir/fugir valem para o ator inteiro.
   * @returns false se a escolha era inválida (o jogador deve escolher de novo).
   */
  submitResponses(responses: ActionResponse[]): boolean {
    let request = this.request;
    if (!request || this.battle.ended)
      return false;
    if (responses.some(x => x instanceof ForfeitActionResponse)) {
      this.battle.forfeit(this);
      return true;
    }
    if (responses.some(x => x instanceof FleeAttemptActionResponse)) {
      // Como no Cobblemon: Run só avisa; a fuga acontece ao se afastar do Pokémon selvagem.
      this.Player?.sendMessage({ translate: "cobblemon.battle.run_prompt" });
      // Frente batalha-minimizavel: "Fugir" minimiza a batalha (BattleGeneralActionSelection.kt:68).
      battlePromptHooks.onMenuClosed?.(this, this.requestId);
      return true;
    }
    let forced = [...this.expectingPassActions];
    let finalResponses: ActionResponse[] = [];
    // Uma resposta por posição (como a tela devolve) ou só as das posições que precisam agir, em ordem.
    let aligned = responses.length === this.slotCount;
    let responseIndex = 0;
    for (let slot = 0; slot < this.slotCount; slot++) {
      if (!this.slotNeedsChoice(slot, request)) {
        finalResponses.push(new PassActionResponse());
        continue;
      }
      let response: ActionResponse | undefined = aligned ? responses[slot] : responses[responseIndex++];
      // As primeiras posições que agem ficam com as ações forçadas (ex.: Poké Bola arremessada).
      if (!request.forceSwitch && forced.length > 0 && (!response || response instanceof ForcePassActionResponse || !aligned)) {
        if (!aligned && response) responseIndex--;
        response = forced.shift()!;
      }
      if (!response || !response.isValid(this.getResponseContext(slot, request))) {
        console.warn(`Invalid battle choice for ${this.showdownId} slot ${slot}: ${response?.constructor.name}`);
        return false;
      }
      finalResponses.push(response);
    }
    this.responses = finalResponses;
    this.applyBagItemCosts();
    this.writeShowdownResponse();
    return true;
  }

  /** Gasta os itens da mochila escolhidos e calcula os dados do script (antes de enviar). */
  private applyBagItemCosts() {
    let player = this.Player;
    this.responses.forEach(response => {
      if (!(response instanceof BagItemActionResponse))
        return;
      let def = response.bagItem;
      let data = this.pokemon.find(x => x.uuid == response.targetUUID);
      let sim = getSimPokemon(this.battle, response.targetUUID);
      if (data && sim)
        response.scriptData = def.data(sim, data, response.data);
      if (player && consumeBagItem(player, def.typeId))
        this.itemsUsed.push({ typeId: def.typeId, itemName: def.itemName, returnItem: def.returnItem });
      if (data && def.friendship)
        changeFriendship(data, def.friendship);
      if (def.sound) {
        let entity = this.activePokemon.find(x => x?.data.uuid == response.targetUUID)?.entity;
        try {
          (entity?.isValid ? entity : player)?.dimension.playSound(def.sound, (entity?.isValid ? entity : player)!.location);
        }
        catch { }
      }
    });
  }

  /** Mantido para compatibilidade: valida e grava as respostas (sem enviar). */
  setActionResponse(responses: ActionResponse[]) {
    this.responses = responses;
  }

  writeShowdownResponse() {
    let request = this.request;
    if (!request)
      return;
    let showdownMessages: string[] = this.responses.map((response, slot) => response.toShowdownString(this.getResponseContext(slot, request)));
    this.responses = [];
    this.mustChoose = false;
    this.expectingPassActions = [];
    this.battle.writeChoice(`>${this.showdownId} ${showdownMessages.join(", ")}`);
    battlePromptHooks.onChoiceSent?.(this);
  }

  /** O Showdown confirmou o uso de um item (`|bagitem|`): devolve o recipiente (garrafa etc.). */
  confirmBagItemUse(itemName: string) {
    let index = this.itemsUsed.findIndex(x => x.itemName == itemName);
    if (index == -1)
      return;
    let [used] = this.itemsUsed.splice(index, 1);
    return used;
  }

  /** BEDROCK: Sync's all the pokemon data with the player / entity. */
  syncOutPokemon() {
    this.pokemon.forEach(pokemon => {
      if (this.actor instanceof Player) {
        pokemon.tryUpdatePokemonInTeam(this.actor)
      }
      pokemon.tryUpdatePokemonOut();
    })
  }

  /** BEDROCK: Ensures the correct music is playing */
  updateMusic() {
    if (!this.battleTheme || !(this.actor instanceof Player))
      return;
    this.actor.playMusic(this.battleTheme);
  }

  /**
   * BEDROCK: Abre a tela de escolha do jogador (ou usa o `decider`). Seguro chamar várias vezes: se já
   * houver tela aberta ou nada a escolher, não faz nada. Fechar a tela não perde o request; interagir com
   * o oponente reabre.
   * @param source quem pediu (frente batalha-minimizavel, `BattlePromptHooks.PromptSource`): `turn` = chegou o
   * request; `reopen` = interagir/nova tentativa (padrão); `toggle` = a "tecla R" do port (agachado + pular).
   */
  promptPlayerForRequest(source: PromptSource = "reopen") {
    if (!this.request || !this.mustChoose || this.battle.ended || this.prompting || this.type != ActorType.PLAYER || !this.actor.isValid)
      return;
    let request = this.request;
    let requestId = this.requestId;
    // Todas as posições já ocupadas por ações forçadas.
    if (!request.forceSwitch && this.expectingPassActions.length > 0 && this.expectingPassActions.length >= this.countMovableSlots()) {
      this.submitResponses([]);
      return;
    }
    // Frente batalha-minimizavel: a batalha pode estar minimizada (padrão `java`) ou com a escolha no HUD (`hud`).
    if (battlePromptHooks.beforePrompt?.(this, source))
      return;
    this.prompting = true;
    let decide = this.decider ?? ((actor: BattleActor, req: RequestData) => handleMoveRequest(req, actor, actor.battle));
    Promise.resolve()
      .then(() => decide(this, request))
      .then(responses => {
        this.prompting = false;
        // Jogador saiu do servidor (a tela fecha sozinha): o playerLeave/checagem de participantes encerra a batalha.
        if (this.battle.ended || !this.mustChoose || !this.actor.isValid)
          return;
        // Chegou outro request enquanto a tela estava aberta: pergunta de novo com o atual (a batalha seguia aberta).
        if (requestId != this.requestId) {
          this.battle.dispatcher.doWhenClear(() => this.promptPlayerForRequest("turn"));
          return;
        }
        if (!responses) {
          if (!battlePromptHooks.onMenuClosed?.(this, requestId))
            this.sendReopenHint(requestId);
          return;
        }
        if (!this.submitResponses(responses))
          this.battle.dispatcher.doWhenClear(() => this.promptPlayerForRequest());
      })
      .catch(e => {
        this.prompting = false;
        // Tela que falhou porque o jogador saiu no meio dela: esperado, não é erro.
        if (!this.actor.isValid)
          return;
        console.error(`Battle menu error: ${e}`);
      });
  }

  private sendReopenHint(requestId: number) {
    if (this.closedHintSent == requestId || !this.Player?.isValid)
      return;
    this.closedHintSent = requestId;
    this.Player?.sendMessage(message.color("Gray", { translate: "cobblemon.port.battle.reopen_hint" }));
  }

  /** UUIDs dos Pokémon do request (ordem do Showdown). */
  getRequestUUIDs() {
    return this.request?.side.pokemon.map(x => requestPokemonUUID(x)) ?? [];
  }
}
