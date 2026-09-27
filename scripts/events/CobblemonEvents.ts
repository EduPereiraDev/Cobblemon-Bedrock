import { BattleActor, PokemonBattle } from "../battle";
import { PokemonData } from '../Pokemon';
import { ActivePokemon } from '../battle';
import type { Player } from "@minecraft/server";

/** Uses types from Record to create a typescript safe event emitter.
 * @link https://stackblitz.com/edit/node-4kixah?file=index.ts
 */
//Typescript typing can be so overwhelming
//Theres more typescript stuff than there is actual code
class TypedEventEmitter<TEvents extends Record<string, any>> {
  private handlers = new Map<string, Set<(...args: any[]) => void>>()

  emit<TEventName extends keyof TEvents & string>(
    eventName: TEventName,
    ...eventArg: TEvents[TEventName]
  ) {
    this.handlers.get(eventName)?.forEach(handler => handler(...(eventArg as unknown[])))
  }

  on<TEventName extends keyof TEvents & string>(
    eventName: TEventName,
    handler: (...eventArg: TEvents[TEventName]) => void
  ) {
    if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set())
    this.handlers.get(eventName)!.add(handler)
  }

  off<TEventName extends keyof TEvents & string>(
    eventName: TEventName,
    handler: (...eventArg: TEvents[TEventName]) => void
  ) {
    this.handlers.get(eventName)?.delete(handler)
  }
}

/**
 * A map of event names to argument tuples
 */
export type EventTypes = {
  "BATTLE_FAINTED": [PokemonBattle, ActivePokemon]
  "BATTLE_VICTORY": [PokemonBattle, winners: BattleActor[], losers: BattleActor[], wasCaught: boolean]
  /** BATTLE_STARTED_POST: a batalha acabou de ser criada (BattleRegistry.startBattle). */
  "BATTLE_STARTED": [PokemonBattle]
  /** BATTLE_FLED: o selvagem ficou longe demais e a batalha terminou em fuga (PokemonBattle.checkFlee). */
  "BATTLE_FLED": [PokemonBattle]
  /**
   * Frente msd-fase1 (CobblemonEvents.FORME_CHANGE): `detailschange` (permanent) ou `-formechange` (temporária), já no
   * tempo da mensagem. `forme` = nome de espécie do Showdown ("Charizard-Mega-X").
   */
  "FORME_CHANGE": [PokemonBattle, ActivePokemon, forme: string, permanent: boolean]
  /** Frente msd-fase1 (CobblemonEvents.MEGA_EVOLUTION): `-mega`, e também `-primal` e `-burst` (`kind`). */
  "MEGA_EVOLUTION": [PokemonBattle, ActivePokemon, kind: "mega" | "primal" | "ultra"]
  /** Frente msd-fase1 (CobblemonEvents.TERASTALLIZATION): `-terastallize`; `type` no formato do Showdown ("Fire"). */
  "TERASTALLIZATION": [PokemonBattle, ActivePokemon, type: string]
  /** Frente msd-fase1: `-zpower` (aura do golpe Z). */
  "ZPOWER": [PokemonBattle, ActivePokemon]
  /** Frente msd-fase1: `-start|…|Dynamax[|Gmax]` (active = true) e `-end|…|Dynamax` (false). */
  "DYNAMAX": [PokemonBattle, ActivePokemon, active: boolean, gigantamax: boolean]
  /** Frente msd-fase1: um Pokémon entrou em campo no meio da batalha (o Showdown desfaz formas temporárias na saída). */
  "POKEMON_SWITCHED_IN": [PokemonBattle, uuid: string]
  /**
   * Frente msd-fase2 (BATTLE_STARTED_PRE): os atores já montados, antes de o Showdown receber os times (o Mega
   * Showdown desfaz aqui a Mega fora da batalha: AspectUtils.revertPokemonsIfRequiredBattleStart).
   */
  "BATTLE_STARTED_PRE": [actors: BattleActor[]]
  /** Frente msd-fase2 (HELD_ITEM_POST): item segurado trocado pelo menu/comando (ids Minecraft; undefined = nenhum). */
  "HELD_ITEM_POST": [PokemonData, previous: string | undefined, next: string | undefined]
  /**
   * Frente msd-fase4 (CobblemonEvents.POKEMON_CAPTURED): o Pokémon capturado, já com a bola e o treinador, logo antes de
   * ir para o time/PC (o que um ouvinte mudar nele é gravado). O Mega Showdown fixa aqui o tipo Tera do Ogerpon/Terapagos.
   */
  "POKEMON_CAPTURED": [PokemonData, thrower: Player]
}

export const CobblemonEvents = new TypedEventEmitter<EventTypes>()