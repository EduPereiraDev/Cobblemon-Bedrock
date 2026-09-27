/**
 * Golpes do Pokémon (aba de golpes do resumo do Cobblemon): trocar a ordem, trocar por outro
 * golpe que ele pode (re)aprender e esquecer. Usa `getLearnableMoves` do Pokemon.ts quando existir.
 */
import { Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { MOVE_COUNT, PokemonData } from "../Pokemon";
import { Dex, toID } from "../showdown";
import { renderMove } from "../language";
import { message } from "../language";
import { K, isInBattle, savePokemon, tr } from "./common";
import { PCLocation } from "../pokemonStorage";

export const MAX_MOVES = MOVE_COUNT;

/**
 * Golpes que o Pokémon pode colocar no moveset agora (relearner do Cobblemon: golpes por nível
 * até o atual + os guardados), sem os que já estão nele.
 */
export function getRelearnableMoves(pokemon: PokemonData): string[] {
  let moves: string[];
  try { moves = pokemon.getRelearnableMoves(); }
  catch { moves = []; }
  const current = new Set(pokemon.moves.map(x => toID(x)));
  const seen = new Set<string>();
  return moves.map(x => toID(x)).filter(id => {
    if (current.has(id) || seen.has(id) || !Dex.moves.get(id).exists) return false;
    seen.add(id);
    return true;
  });
}

/** Troca a posição de dois golpes (junto com os PP). */
export function swapMoves(pokemon: PokemonData, a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0 || a >= pokemon.moves.length || b >= pokemon.moves.length) return false;
  [pokemon.moves[a], pokemon.moves[b]] = [pokemon.moves[b], pokemon.moves[a]];
  [pokemon.movesInfo[a], pokemon.movesInfo[b]] = [pokemon.movesInfo[b], pokemon.movesInfo[a]];
  return true;
}

/**
 * Coloca `move` na posição `slot` (PokemonData.teachMove com slot: o golpe antigo fica guardado e a
 * proporção de PP é mantida; espaço vazio recebe o golpe com 0 PP, como no Cobblemon).
 */
export function replaceMove(pokemon: PokemonData, slot: number, move: string): boolean {
  if (slot < 0 || slot >= MAX_MOVES) return false;
  return pokemon.teachMove(move, Math.min(slot, pokemon.moves.length));
}

/** Esquece um golpe (nunca o último; ele fica guardado para reaprender). */
export function forgetMove(pokemon: PokemonData, slot: number): boolean {
  return pokemon.forgetMove(slot);
}

function moveButton(pokemon: PokemonData, slot: number): string | RawMessage {
  if (slot >= pokemon.moves.length) return tr(K.movesEmptySlot);
  return renderMove(pokemon.moves[slot], pokemon.movesInfo[slot]);
}

/** Menu de golpes. Resolve quando o jogador volta. */
export async function showMovesMenu(player: Player, location: PCLocation, pokemon: PokemonData): Promise<void> {
  while (true) {
    if (isInBattle(player)) {
      player.sendMessage(message.error(tr(K.inBattle)));
      return;
    }
    const learnable = getRelearnableMoves(pokemon);
    const slots = Math.min(MAX_MOVES, pokemon.moves.length + (learnable.length > 0 ? 1 : 0));
    const form = new ActionFormData()
      .title({ rawtext: [{ translate: "cobblemon.ui.moves" }, { text: " - " }, pokemon.getTranslatedName()] });
    for (let i = 0; i < slots; i++) form.button(moveButton(pokemon, i));
    form.button({ translate: K.back });
    const response = await form.show(player);
    if (response.selection === undefined || response.selection >= slots) return;
    const slot = response.selection;
    if (slot >= pokemon.moves.length) {
      // Espaço vazio: escolher um golpe para aprender.
      if (await pickReplacement(player, pokemon, slot, learnable)) savePokemon(player, location, pokemon);
      continue;
    }
    const actions = new ActionFormData()
      .title({ rawtext: [{ translate: `cobblemon.move.${toID(pokemon.moves[slot])}` }] });
    const options: ("swap" | "replace" | "forget")[] = [];
    if (pokemon.moves.length > 1) { actions.button(tr(K.movesSwap)); options.push("swap"); }
    actions.button(tr("cobblemon.ui.moves.switch")); options.push("replace");
    if (pokemon.moves.length > 1) { actions.button(tr("cobblemon.ui.moves.forget")); options.push("forget"); }
    actions.button({ translate: K.back });
    const choice = await actions.show(player);
    const option = choice.selection === undefined ? undefined : options[choice.selection];
    if (option === "swap") {
      const target = new ActionFormData().title(tr(K.movesSwapWith));
      const targets = pokemon.moves.map((_, i) => i).filter(i => i !== slot);
      targets.forEach(i => target.button(moveButton(pokemon, i)));
      const picked = await target.show(player);
      if (picked.selection !== undefined && swapMoves(pokemon, slot, targets[picked.selection]))
        savePokemon(player, location, pokemon);
    }
    else if (option === "replace") {
      if (await pickReplacement(player, pokemon, slot, learnable)) savePokemon(player, location, pokemon);
    }
    else if (option === "forget") {
      if (forgetMove(pokemon, slot)) savePokemon(player, location, pokemon);
      else player.sendMessage(message.error(tr(K.movesLastMove)));
    }
  }
}

async function pickReplacement(player: Player, pokemon: PokemonData, slot: number, learnable: string[]): Promise<boolean> {
  if (learnable.length === 0) {
    player.sendMessage(message.warn(tr(K.movesNoneToLearn)));
    return false;
  }
  const form = new ActionFormData().title(tr("cobblemon.ui.moves.switch"));
  learnable.forEach(move => form.button(renderMove(move)));
  const response = await form.show(player);
  if (response.selection === undefined) return false;
  return replaceMove(pokemon, slot, learnable[response.selection]);
}
