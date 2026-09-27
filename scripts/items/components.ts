/** Componentes de item da frente "itens" (usar em Pokémon, TMs, comidas com efeito). */
import { ItemComponentConsumeEvent, ItemComponentUseEvent, ItemCustomComponent, Player } from "@minecraft/server";
import { onUseItem } from "./usage";
import { applyFoodEffect, consumeWithoutFoodComponent } from "./food";
import { hasRideBoosts, openAprijuiceSelection } from "../pokemon/Aprijuice";
// Barcos de apricorn/saccharine: assina os eventos de mundo ao carregar (frente mundo-sons).
import "./boats";

function asPlayer(entity: unknown): Player | undefined {
  const candidate = entity as Player | undefined;
  return candidate?.isValid && candidate.typeId === "minecraft:player" ? candidate : undefined;
}

export const ITEM_CUSTOM_COMPONENTS: Record<string, ItemCustomComponent> = {
  // Remédios, berries, vitaminas, doces, mints, itens de evolução...: seleção do time ao usar no ar.
  "cobblemon:use_on_pokemon": {
    onUse: (event: ItemComponentUseEvent) => onUseItem(event.source, event.itemStack),
  },
  // TM: ensina o golpe gravado na lore do item (scripts/items/tm.ts).
  "cobblemon:technical_machine": {
    onUse: (event: ItemComponentUseEvent) => onUseItem(event.source, event.itemStack),
  },
  // Aprijuice, Ponigiri, Sinister Tea, Vivichoke Dip.
  "cobblemon:food_effect": {
    onConsume: (event: ItemComponentConsumeEvent) => {
      const player = asPlayer(event.source);
      if (player && event.itemStack) applyFoodEffect(player, event.itemStack);
    },
    // Enquanto o JSON do item não tiver `minecraft:food`, come na hora.
    onUse: (event: ItemComponentUseEvent) => {
      // Aprijuice com ride boosts: escolhe o Pokémon do time em vez de beber (frente dados-ui, AprijuiceItem.use).
      if (event.itemStack && hasRideBoosts(event.itemStack)) {
        const player = asPlayer(event.source);
        if (player) void openAprijuiceSelection(player, event.itemStack);
        return;
      }
      if (event.itemStack) consumeWithoutFoodComponent(event.source, event.itemStack);
    },
  },
};
