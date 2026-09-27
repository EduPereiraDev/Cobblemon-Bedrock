import type { StatsTable } from "../showdown";
import { gimmickMove } from "./BattleMoveset"
/** Interface of the JSON data sent with the |REQUEST| header */
export interface RequestData {
  active?: ActiveMoveset[]
  side: RequestSide

  forceSwitch?: boolean[]
  noCancel: boolean
  /** I've never seen this, but cobblemon base seems to have this as a property */
  wait?: boolean
}

export interface ActiveMoveset {
  moves: RequestMove[]
  trapped?: boolean
  canMegaEvo?: boolean
  /** Só em formatos com Mega X/Y separadas (mixandmega); o gen9 do port usa `canMegaEvo`. */
  canMegaEvoX?: boolean
  canMegaEvoY?: boolean
  canUltraBurst?: boolean
  /** Um golpe Z por golpe do Pokémon (`null` = esse golpe não vira Z). `move` é o NOME ("Inferno Overdrive"). */
  canZMove?: (gimmickMove | null)[]
  canDynamax?: boolean
  /** Frente msd-fase1: no @pkmn/sim é um objeto (Pokemon.getDynamaxRequest), não uma lista. `move` é o id. */
  maxMoves?: MaxMovesRequest
  /** Tipo Tera ("Fire") quando o Pokémon pode terastalizar. */
  canTerastallize?: string
}

/** `maxMoves` do request (Pokemon.getDynamaxRequest do @pkmn/sim). */
export interface MaxMovesRequest {
  maxMoves: gimmickMove[]
  /** Nome do golpe G-Max quando o Pokémon tem o fator Gigantamax. */
  gigantamax?: string
}

interface RequestSide {
  name: string
  id: string // ex: p1 or p2
  pokemon: RequestPokemon[]
}

export interface RequestMove {
  move: string
  id: string
  pp: number
  maxpp: number
  target: string
  disabled: boolean
  gimmickMove?: gimmickMove
}

export interface RequestPokemon {
  ident: string //Identifier and position ex: p1: Cyndaquill
  details: string
  condition: string // Number/Number or 0 and STATUS
  active: boolean
  stats: StatsTable
  moves: string[]
  baseAbility: string
  item: string
  pokeball: string
  ability: string

  commanding?: boolean
  reviving?: boolean
  teraType?: string
  terastallized?: string
}
/** UUID do Pokémon de um request. O adaptador (showdown.ts) usa o UUID como nome, então `ident` = "p1: <uuid>". */
export function requestPokemonUUID(pokemon: RequestPokemon): string {
  return pokemon.ident.slice(pokemon.ident.indexOf(": ") + 2);
}
