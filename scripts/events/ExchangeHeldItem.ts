import { Entity, ItemStack, Player } from "@minecraft/server";
import { message } from "../language";
import { PokemonData } from "../Pokemon";
import { ItemUtils } from "../utils";
import { itemName } from "../GUI/common";
import { FORBIDDEN_HELD_ITEM_LANG, isForbiddenHeldItem } from "../pokemon/HeldItems";
import { CobblemonEvents } from "./CobblemonEvents"; // frente msd-fase4: HELD_ITEM_POST
import { getHeldItemOnEntity, setHeldItemOnEntity } from "../pokemon/HeldItemStore";

/** Pilha de uma unidade do item segurado (os dados guardam só o id). */
function stackOf(itemId: string): ItemStack | undefined {
  try { return new ItemStack(itemId, 1); }
  catch { return undefined; } // item que não existe mais nos packs
}

/**
 * Agachar + usar no próprio Pokémon: dá, troca ou tira o item segurado (Pokemon.swapHeldItem).
 * Mensagens `cobblemon.held_item.*` com o nome traduzido dos itens. O item segurado fica só nos dados do Pokémon
 * (pokemon/HeldItemStore): a entidade não tem inventário.
 */
export default function exchangeHeldItem(player: Player, pokemon: Entity) {
  let playerHandSlot = player.getComponent("inventory")?.container?.getSlot(player.selectedSlotIndex);
  if (!playerHandSlot)
    return;
  let playerItem = playerHandSlot.getItem();
  let pokemonData = PokemonData.getFromEntity(pokemon);
  const pokemonItem = getHeldItemOnEntity(pokemon);
  if (!playerItem && !pokemonItem)
    return;

  // PokemonEntity.offerHeldItem: contêineres (shulker/bolsa) não podem ser segurados (perderiam o conteúdo).
  if (playerItem && isForbiddenHeldItem(playerItem.typeId)) {
    player.sendMessage(message.error(message.With({ translate: FORBIDDEN_HELD_ITEM_LANG }, [itemName(playerItem.typeId), pokemonData])));
    return;
  }

  if (playerItem && pokemonItem && playerItem.typeId === pokemonItem) {
    player.sendMessage(message.With({ translate: "cobblemon.held_item.already_holding" }, [pokemonData, itemName(pokemonItem)]));
    return;
  }

  if (playerItem && !pokemonItem) {
    // Grava antes de consumir: sem dados válidos, nada muda no inventário do jogador.
    if (!setHeldItemOnEntity(pokemon, playerItem.typeId)) return;
    player.sendMessage(message.With({ translate: "cobblemon.held_item.give" }, [pokemonData, itemName(playerItem.typeId)]));
    ItemUtils.decrementItemInHand(player);
  }

  if (playerItem && pokemonItem) {
    const returned = stackOf(pokemonItem);
    if (!setHeldItemOnEntity(pokemon, playerItem.typeId)) return;
    player.sendMessage(message.With({ translate: "cobblemon.held_item.replace" }, [itemName(pokemonItem), pokemonData, itemName(playerItem.typeId)]));
    ItemUtils.decrementItemInHand(player);
    if (returned) {
      // Inventário cheio: a sobra cai no chão (não some).
      const leftover = player.getComponent("inventory")?.container?.addItem(returned);
      if (leftover) player.dimension.spawnItem(leftover, player.location);
    }
  }

  if (!playerItem && pokemonItem) {
    const returned = stackOf(pokemonItem);
    if (!setHeldItemOnEntity(pokemon, undefined)) return;
    player.sendMessage(message.With({ translate: "cobblemon.held_item.take" }, [itemName(pokemonItem), pokemonData]));
    if (returned) playerHandSlot.setItem(returned);
  }

  //Ensures that the pokemon's held item is updated in data.
  const previous = pokemonData.minecraftItem;
  pokemonData.loadFromCobblemon(pokemon);
  // Frente msd-fase4: HELD_ITEM_POST também na troca por agachar + usar (o Mega Showdown aplica/desfaz placas,
  // memórias, máscaras...). Ouvinte com erro não impede a troca; o Pokémon é gravado logo abaixo.
  if (previous !== pokemonData.minecraftItem) {
    try { CobblemonEvents.emit("HELD_ITEM_POST", pokemonData, previous, pokemonData.minecraftItem); }
    catch (e) { console.warn(`HELD_ITEM_POST: ${e}`); }
  }
  pokemonData.tryUpdatePokemonInTeam(player);
  pokemonData.tryUpdatePokemonOut();
}
