/**
 * Aprijuice com ride boosts (`item/AprijuiceItem.kt` do 1.8.2): sem bônus é só bebida (frente itens,
 * scripts/items/food.ts); com bônus (temperada no Campfire Pot) é um PokemonSelectingItem — usar no Pokémon (ou no ar,
 * escolhendo no time) alimenta 1, soma os bônus de montaria (`scripts/pokemon/RideStats.ts`) e gasta uma unidade.
 */
import { ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { PokemonData } from "../Pokemon";
import { readFoodData } from "../items/food";
import { seasonedDataFromLore } from "../machines/cookingLogic";
import { PCPlace, getSafeTeam, setPokemonToPCLocation } from "../pokemonStorage";
import { decrementItemInHand } from "../utils/ItemUtils";
import { canEat, feedPokemon, isFull } from "./Fullness";
import { RIDING_STATS_DISPLAY, applyAprijuice, canUseAprijuice, isAprijuice } from "./RideStats";

/** RideBoostsComponent do item: dynamic property `cobblemon:food_data` ou a lore do prato. */
export function aprijuiceBoosts(stack: ItemStack | undefined): Record<string, number> | undefined {
  if (!stack || !isAprijuice(stack.typeId)) return undefined;
  const fromData = readFoodData(stack)?.rideBoosts;
  if (fromData && Object.keys(fromData).length) return fromData;
  let lore: RawMessage[] = [];
  try { lore = stack.getRawLore(); } catch { }
  const fromLore = seasonedDataFromLore(stack.typeId, lore)?.rideBoosts;
  return fromLore && Object.keys(fromLore).length ? fromLore : undefined;
}

/** AprijuiceItem.hasRideBoosts. */
export function hasRideBoosts(stack: ItemStack | undefined): boolean {
  const boosts = aprijuiceBoosts(stack);
  return !!boosts && Object.values(boosts).some(Boolean);
}

/** PokemonSelectingItem.canUseOnPokemon + AprijuiceItem.canUseOnPokemon (e a barriga, como a comida `poke_food`). */
export function canDrinkAprijuice(pokemon: PokemonData, stack: ItemStack): boolean {
  if (pokemon.currentHealth <= 0) return false;
  if (!canEat(pokemon, stack.typeId)) return false;
  return canUseAprijuice(pokemon, aprijuiceBoosts(stack));
}

/**
 * applyToPokemon: alimenta 1, soma os bônus e devolve true se funcionou (quem chama gasta o item e salva).
 * Mensagem de falha vai para o jogador.
 */
export function drinkAprijuice(player: Player, pokemon: PokemonData, stack: ItemStack): boolean {
  if (!canDrinkAprijuice(pokemon, stack)) {
    const key = isFull(pokemon) ? "cobblemon.port.aprijuice.full" : "cobblemon.port.aprijuice.cannot";
    player.sendMessage({ translate: key, with: { rawtext: [pokemon.getTranslatedName()] } });
    return false;
  }
  feedPokemon(pokemon, 1);
  applyAprijuice(pokemon, aprijuiceBoosts(stack));
  try { player.playSound("random.drink"); } catch { }
  const shown = RIDING_STATS_DISPLAY.filter(stat => (aprijuiceBoosts(stack) ?? {})[stat]);
  player.sendMessage({ translate: "cobblemon.port.aprijuice.applied", with: { rawtext: [pokemon.getTranslatedName(), { text: shown.map(s => s.toLowerCase()).join(", ") }] } });
  return true;
}

/** Clique no próprio Pokémon com a Aprijuice na mão. Devolve true se tratou (com ou sem sucesso). */
export function tryAprijuiceOnEntity(player: Player, entity: { isValid: boolean }, stored: PokemonData | undefined, heldItem: ItemStack | undefined): boolean {
  if (!heldItem || !hasRideBoosts(heldItem) || !stored) return false;
  const team = getSafeTeam(player);
  const slot = team.findIndex(member => member?.uuid === stored.uuid);
  if (slot === -1) return false;
  if (drinkAprijuice(player, stored, heldItem)) {
    decrementItemInHand(player);
    stored.tryUpdatePokemonOut();
    setPokemonToPCLocation(player, { location: PCPlace.Team, space: slot }, stored);
  }
  return true;
}

/** Usar no ar: escolhe um Pokémon do time (PartySelectCallback) e aplica. */
export async function openAprijuiceSelection(player: Player, stack: ItemStack): Promise<boolean> {
  const team = getSafeTeam(player);
  const options: number[] = [];
  const form = new ActionFormData().title({ translate: stack.localizationKey ?? `item.${stack.typeId}` });
  team.forEach((member, slot) => {
    if (!member) return;
    const usable = canDrinkAprijuice(member, stack);
    form.button({ rawtext: [usable ? { text: "§f" } : { text: "§8" }, member.getTranslatedName(), { text: ` §7Lv. ${member.level}` }] });
    options.push(slot);
  });
  if (!options.length) return false;
  const response = await form.show(player);
  if (response.selection === undefined || !player.isValid) return false;
  const slot = options[response.selection];
  const current = getSafeTeam(player)[slot];
  if (!current) return false;
  const live = current.tryGetPokemonOut() ? PokemonData.tryGetFromEntity(current.tryGetPokemonOut()!) ?? current : current;
  // A mão pode ter mudado enquanto a tela estava aberta.
  const inHand = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
  if (!inHand || inHand.typeId !== stack.typeId || !hasRideBoosts(inHand)) return false;
  if (!drinkAprijuice(player, live, inHand)) return false;
  decrementItemInHand(player);
  live.tryUpdatePokemonOut();
  setPokemonToPCLocation(player, { location: PCPlace.Team, space: slot }, live);
  return true;
}
