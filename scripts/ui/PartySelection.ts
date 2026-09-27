/**
 * Slot selecionado da party (ClientStorageManager.selectedSlot do Cobblemon): o Pokémon destacado no HUD e alvo do
 * envio rápido. O Cobblemon segue o Pokémon pelo UUID: se ele mudar de posição, a seleção vai junto.
 *
 * API para a frente "jogabilidade" ligar às entradas (roda/teclas de subir e descer, envio rápido):
 *   getSelectedSlot(player) → índice 0..5 (ou -1 com a party vazia)
 *   cycleSelectedSlot(player, forward) → shiftSelected(forward)
 *   setSelectedSlot(player, slot) / getSelectedPokemon(player)
 *
 * Formato compatível com `scripts/pokemon/PartySelection.ts` (frente jogabilidade): `cobblemon:selected_slot` guarda o
 * índice (número). O UUID seguido fica em `cobblemon:selected_uuid` ("índice|uuid"); se o índice mudar por fora
 * (comando /selectslot da outra frente), vale o índice novo.
 */
import type { Player } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { getSafeTeam } from "../pokemonStorage";

export const SELECTION_PROPERTY = "cobblemon:selected_slot";
export const SELECTION_UUID_PROPERTY = "cobblemon:selected_uuid";

export interface Selection {
  slot: number;
  uuid?: string;
}

/** Party mínima para a lógica pura: UUID por posição (null = vazio). */
export type PartyIds = (string | null | undefined)[];

/** ClientStorageManager.shiftSelected (versão iterativa, sem recursão). */
export function shiftSelection(party: PartyIds, current: Selection, forward: boolean): Selection {
  if (!party.some(x => !!x)) return { slot: 0 };
  let slot = current.slot;
  for (let guard = 0; guard <= party.length * 2 + 2; guard++) {
    slot += forward ? 1 : -1;
    if (slot >= party.length) slot = -1;
    else if (slot < 0) slot = party.length;
    else if (party[slot]) return { slot, uuid: party[slot]! };
  }
  return { slot: 0 };
}

/** ClientStorageManager.checkSelectedPokemon: acompanha o UUID e cai no primeiro Pokémon quando preciso. */
export function checkSelection(party: PartyIds, current: Selection): Selection {
  const first = party.findIndex(x => !!x);
  if (first < 0) return { slot: -1 };
  if (current.uuid) {
    const found = party.indexOf(current.uuid);
    if (found >= 0) return { slot: found, uuid: current.uuid };
  }
  if (current.slot >= 0 && current.slot < party.length && party[current.slot] && !current.uuid)
    return { slot: current.slot, uuid: party[current.slot]! };
  return { slot: first, uuid: party[first]! };
}

/** Lê índice (número) + UUID gravado junto com o índice. */
function readSelection(player: Player): Selection {
  const slot = player.getDynamicProperty(SELECTION_PROPERTY);
  const index = typeof slot === "number" && Number.isInteger(slot) ? slot : -1;
  const raw = player.getDynamicProperty(SELECTION_UUID_PROPERTY);
  if (typeof raw === "string") {
    const [recorded, uuid] = raw.split("|");
    // UUID só vale se foi gravado para o mesmo índice (senão a seleção mudou por fora).
    if (Number(recorded) === index && uuid) return { slot: index, uuid };
  }
  return { slot: index };
}

function partyIds(team: (PokemonData | null)[]): PartyIds {
  return team.map(p => (p ? p.uuid : null));
}

const listeners: ((player: Player) => void)[] = [];

/** Avisado quando a seleção muda (o HUD da party se atualiza). */
export function onSelectionChanged(listener: (player: Player) => void) {
  listeners.push(listener);
}

/** Grava (se mudou). Devolve true quando algo mudou. */
function write(player: Player, selection: Selection): boolean {
  const uuidRaw = `${selection.slot}|${selection.uuid ?? ""}`;
  const same = player.getDynamicProperty(SELECTION_PROPERTY) === selection.slot && player.getDynamicProperty(SELECTION_UUID_PROPERTY) === uuidRaw;
  if (same) return false;
  player.setDynamicProperty(SELECTION_PROPERTY, selection.slot >= 0 ? selection.slot : undefined);
  player.setDynamicProperty(SELECTION_UUID_PROPERTY, uuidRaw);
  return true;
}

function store(player: Player, selection: Selection) {
  if (!write(player, selection)) return;
  for (const listener of listeners) {
    try { listener(player); } catch { }
  }
}

/** Seleção atual já conferida contra a party (segue o UUID). */
export function getSelection(player: Player, team: (PokemonData | null)[] = getSafeTeam(player)): Selection {
  const checked = checkSelection(partyIds(team), readSelection(player));
  write(player, checked);
  return checked;
}

/** Índice do slot selecionado (0..5), ou -1 com a party vazia. */
export function getSelectedSlot(player: Player): number {
  return getSelection(player).slot;
}

/** Pokémon selecionado, se houver. */
export function getSelectedPokemon(player: Player): PokemonData | undefined {
  const team = getSafeTeam(player);
  const slot = getSelection(player, team).slot;
  return slot >= 0 ? team[slot] ?? undefined : undefined;
}

/** Seleciona um slot ocupado. Devolve false se o slot estiver vazio. */
export function setSelectedSlot(player: Player, slot: number): boolean {
  const team = getSafeTeam(player);
  const pokemon = team[slot];
  if (!pokemon) return false;
  store(player, { slot, uuid: pokemon.uuid });
  return true;
}

/** Próximo/anterior Pokémon da party (pula vazios, dá a volta). Devolve o novo slot. */
export function cycleSelectedSlot(player: Player, forward = true): number {
  const team = getSafeTeam(player);
  const next = shiftSelection(partyIds(team), getSelection(player, team), forward);
  store(player, next);
  return next.slot;
}
