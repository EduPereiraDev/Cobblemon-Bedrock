import { requestPokemonUUID, RequestData } from "./Request";
import { toID } from "../utils";
import { ActivePokemon } from "./ActivePokemon";
import { BattleMoveset } from "./BattleMoveset";
import type { BattleActor } from "./BattleActor";
import { bagItemChoiceString } from "../showdown";
import type { BagItemDef } from "./BagItems";
import { gimmickFromChoice, getGimmicks, moveTileInfo } from "./Gimmicks";

export enum ActionResponseType {
  SWITCH,
  MOVE,
  DEFAULT,
  FORCE_PASS,
  PASS,
  HEAL_ITEM,
  BAG_ITEM,
  FORFEIT,
  FLEE_ATTEMPT
}

/** Tudo o que uma resposta precisa saber sobre a posição (slot) que ela ocupa no turno. */
export interface ResponseContext {
  actor: BattleActor;
  request: RequestData;
  /** Índice da posição ativa (0 = "a", 1 = "b", 2 = "c"). */
  slot: number;
  active: ActivePokemon | null;
  moveset?: BattleMoveset;
  forceSwitch: boolean;
}

export abstract class ActionResponse {
  constructor(
    public type: ActionResponseType
  ) { }
  abstract isValid(context: ResponseContext): boolean;
  abstract toShowdownString(context: ResponseContext): string;
}

export class MoveActionResponse extends ActionResponse {
  /**
   * @param moveName Id do golpe (como no request).
   * @param targetLoc Alvo relativo do Showdown (1..3 inimigo, -1..-3 aliado), só em duplas/triplas.
   * @param gimmickID Sufixo do gimmick (`mega`, `ultra`, `zmove`, `dynamax`, `terastallize`; Gimmicks.GIMMICK_CHOICE).
   */
  constructor(
    public moveName: string,
    public targetLoc?: number,
    public gimmickID?: string
  ) { super(ActionResponseType.MOVE) }
  isValid(context: ResponseContext): boolean {
    if (context.forceSwitch || !context.moveset)
      return false;
    let index = context.moveset.moves.findIndex(x => x.id == toID(this.moveName));
    if (index === -1)
      return false;
    let move = context.moveset.moves[index];
    // Frente msd-fase1: o gimmick tem de estar no request já passado pelo sanitize (item-chave do jogador).
    let gimmick = this.gimmickID ? gimmickFromChoice(this.gimmickID) : undefined;
    if (this.gimmickID && (!gimmick || !getGimmicks(context.moveset).includes(gimmick)))
      return false;
    // Golpe Z/Max (ou já em Dynamax): vale o golpe Z/Max (MoveActionResponse.isValid: validGimmickMove).
    if (gimmick === "zmove" || gimmick === "max" || (!gimmick && context.moveset.maxMoves && !context.moveset.canDynamax))
      return moveTileInfo(context.moveset, index, gimmick).selectable || (!gimmick && move.canBeUsed());
    return move.canBeUsed() || move.id == "struggle";
  }
  toShowdownString(context: ResponseContext): string {
    if (!context.moveset)
      throw new Error("Moveset must be provided with MoveActionResponse .toShowdownString");
    let moveIndex = context.moveset.moves.findIndex(x => x.id == toID(this.moveName)) + 1;
    if (moveIndex === 0)
      throw new Error("Move from MoveActionResponse was not found in moveset!");
    let output = "move " + moveIndex.toString();
    if (this.targetLoc)
      output += ` ${this.targetLoc > 0 ? "+" : ""}${this.targetLoc}`;
    if (this.gimmickID)
      output += ` ${this.gimmickID}`;
    return output;
  }
}

export class SwitchActionResponse extends ActionResponse {
  constructor(
    public newPokemonUUID: string
  ) { super(ActionResponseType.SWITCH) }
  isValid(context: ResponseContext): boolean {
    let index = context.request.side.pokemon.findIndex(x => requestPokemonUUID(x) === this.newPokemonUUID);
    if (index === -1)
      return false;
    let requestPokemon = context.request.side.pokemon[index];
    if (requestPokemon.condition.endsWith(" fnt") || requestPokemon.condition.startsWith("0"))
      return false;
    if (requestPokemon.active)
      return false;
    if (!context.forceSwitch && context.moveset?.trapped)
      return false;
    return true;
  }
  toShowdownString(context: ResponseContext): string {
    return `switch ${context.request.side.pokemon.findIndex(x => requestPokemonUUID(x) === this.newPokemonUUID) + 1}`;
  }
}

export class DefaultActionResponse extends ActionResponse {
  constructor() { super(ActionResponseType.DEFAULT) }
  isValid(): boolean {
    return true;
  }
  toShowdownString(): string {
    return "default";
  }
}

/** Posição que não escolhe nada (Pokémon desmaiado sem reserva, ou sem troca obrigatória). */
export class PassActionResponse extends ActionResponse {
  constructor() { super(ActionResponseType.PASS) }
  isValid(): boolean {
    return true;
  }
  toShowdownString(): string {
    return "pass";
  }
}

/**
 * Marca a posição que será ocupada por uma ação forçada (`BattleActor.forceChoose`), como arremessar
 * uma Poké Bola: o Pokémon perde a vez. Vira `skip` no adaptador (showdown.ts).
 */
export class ForcePassActionResponse extends ActionResponse {
  constructor() { super(ActionResponseType.FORCE_PASS) }
  isValid(context: ResponseContext): boolean {
    return !context.forceSwitch;
  }
  toShowdownString(): string {
    return "skip";
  }
}

/** Item da mochila (BagItemActionResponse do Cobblemon): `useitem <uuid> <item> <script> [dados]`. */
export class BagItemActionResponse extends ActionResponse {
  /**
   * @param bagItem Definição do item (BagItems.ts).
   * @param targetUUID Pokémon do time que recebe o item (pode estar no banco).
   * @param data Dados extras (Ether: id do golpe).
   * @param scriptData Dados já calculados para o script (preenchido pelo BattleActor ao enviar).
   */
  constructor(
    public bagItem: BagItemDef,
    public targetUUID: string,
    public data?: string,
    public scriptData: string[] = []
  ) { super(ActionResponseType.BAG_ITEM) }
  isValid(context: ResponseContext): boolean {
    if (context.forceSwitch || !context.moveset)
      return false;
    return context.request.side.pokemon.some(x => requestPokemonUUID(x) === this.targetUUID);
  }
  toShowdownString(): string {
    return bagItemChoiceString({ targetUuid: this.targetUUID, itemName: this.bagItem.itemName, script: this.bagItem.script, data: this.scriptData });
  }
}

/** Desistir (PvP/PvN). Encerra a batalha com `>forcelose`. */
export class ForfeitActionResponse extends ActionResponse {
  constructor() { super(ActionResponseType.FORFEIT) }
  isValid(): boolean {
    return true;
  }
  toShowdownString(): string {
    return "forfeit";
  }
}

/**
 * Fugir de selvagem. No Cobblemon 1.8.2 o botão Run só avisa que é preciso se afastar do Pokémon
 * (`run_prompt`); a fuga acontece por distância (config.defaultFleeDistance).
 */
export class FleeAttemptActionResponse extends ActionResponse {
  constructor() { super(ActionResponseType.FLEE_ATTEMPT) }
  isValid(): boolean {
    return true;
  }
  toShowdownString(): string {
    return "flee-attempt";
  }
}
