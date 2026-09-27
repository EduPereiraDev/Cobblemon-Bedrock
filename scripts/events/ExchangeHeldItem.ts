import { Entity, ItemStack, Player } from "@minecraft/server";
import { message } from "../language";
import { PokemonData } from "../Pokemon";
import { ItemUtils } from "../utils";
import { itemName } from "../GUI/common";
import { FORBIDDEN_HELD_ITEM_LANG, isForbiddenHeldItem } from "../pokemon/HeldItems";
import { CobblemonEvents } from "./CobblemonEvents"; // frente msd-fase4: HELD_ITEM_POST

/** Uma unidade do item, mantendo lore (TMs) e demais dados da pilha. */
function single(item: ItemStack): ItemStack {
  const copy = item.clone();
  copy.amount = 1;
  return copy;
}

/**
 * Agachar + usar no próprio Pokémon: dá, troca ou tira o item segurado (Pokemon.swapHeldItem).
 * Mensagens `cobblemon.held_item.*` com o nome traduzido dos itens.
 */
export default function exchangeHeldItem(player: Player, pokemon: Entity) {
  let playerHandSlot = player.getComponent("inventory")?.container?.getSlot(player.selectedSlotIndex);
  let pokemonHandSlot = pokemon.getComponent("inventory")?.container?.getSlot(0);

  if (!playerHandSlot || !pokemonHandSlot)
    return;
  let playerItem = playerHandSlot.getItem();
  let pokemonItem = pokemonHandSlot.getItem();
  let pokemonData = PokemonData.getFromEntity(pokemon);
  if (!playerItem && !pokemonItem)
    return;

  // PokemonEntity.offerHeldItem: contêineres (shulker/bolsa) não podem ser segurados (perderiam o conteúdo).
  if (playerItem && isForbiddenHeldItem(playerItem.typeId)) {
    player.sendMessage(message.error(message.With({ translate: FORBIDDEN_HELD_ITEM_LANG }, [itemName(playerItem.typeId), pokemonData])));
    return;
  }

  if (playerItem && pokemonItem && playerItem.typeId === pokemonItem.typeId) {
    player.sendMessage(message.With({ translate: "cobblemon.held_item.already_holding" }, [pokemonData, itemName(pokemonItem.typeId)]));
    return;
  }

  if (playerItem && !pokemonItem) {
    player.sendMessage(message.With({ translate: "cobblemon.held_item.give" }, [pokemonData, itemName(playerItem.typeId)]));
    pokemonHandSlot.setItem(single(playerItem));
    ItemUtils.decrementItemInHand(player);
  }

  if (playerItem && pokemonItem) {
    player.sendMessage(message.With({ translate: "cobblemon.held_item.replace" }, [itemName(pokemonItem.typeId), pokemonData, itemName(playerItem.typeId)]));
    pokemonHandSlot.setItem(single(playerItem));
    ItemUtils.decrementItemInHand(player);
    ItemUtils.givePlayerItem(player, pokemonItem);
  }

  if (!playerItem && pokemonItem) {
    player.sendMessage(message.With({ translate: "cobblemon.held_item.take" }, [itemName(pokemonItem.typeId), pokemonData]));
    playerHandSlot.setItem(pokemonItem);
    pokemonHandSlot.setItem();
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
