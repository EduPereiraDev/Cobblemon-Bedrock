/**
 * Menu de isca da Poké Rod (agachar + usar). Substitui o "clique direito no inventário" do Cobblemon
 * (PokerodItem.overrideOtherStackedOnMe), que o Bedrock não tem: lista as iscas do inventário e a opção de
 * tirar a isca atual.
 */
import { EntityComponentTypes, EquipmentSlot, ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { attachBait, detachBait } from "./FishingController";
import { getPokeRod } from "./PokeRods";
import { getRodBait, isBaitStack, itemNameKey, sameBait } from "./RodItem";

interface BaitChoice {
  slot: number;
  stack: ItemStack;
  total: number;
}

function rodInHand(player: Player): ItemStack | undefined {
  try {
    const stack = player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
    return stack && getPokeRod(stack.typeId) ? stack : undefined;
  }
  catch { return undefined; }
}

/** Iscas do inventário, agrupadas por item (a primeira pilha de cada tipo é a que vai para a vara). */
function baitChoices(player: Player): BaitChoice[] {
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) return [];
  const byItem = new Map<string, BaitChoice>();
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (!isBaitStack(stack)) continue;
    const found = byItem.get(stack.typeId);
    if (found) found.total += stack.amount;
    else byItem.set(stack.typeId, { slot, stack, total: stack.amount });
  }
  return [...byItem.values()];
}

export async function openBaitMenu(player: Player) {
  const rod = rodInHand(player);
  if (!rod) return;
  const slot = player.selectedSlotIndex;
  const current = getRodBait(rod);
  const choices = baitChoices(player).filter(c => !(current && sameBait(current, c.stack) && current.count >= current.max));
  const form = new ActionFormData().title({ translate: "cobblemon.fishing.bait_menu.title" });
  const body: RawMessage[] = [];
  if (current) body.push({ translate: "cobblemon.pokerod.bait", with: { rawtext: [{ translate: itemNameKey(current.item) }, { text: String(current.count) }] } }, { text: "\n\n" });
  body.push({ translate: choices.length ? "cobblemon.fishing.bait_menu.body" : "cobblemon.fishing.bait_menu.none" });
  form.body({ rawtext: body });
  const actions: (() => void)[] = [];
  for (const choice of choices) {
    form.button({ rawtext: [{ translate: itemNameKey(choice.stack.typeId) }, { text: ` ×${choice.total}` }] });
    actions.push(() => {
      const hand = rodInHand(player);
      if (!hand || player.selectedSlotIndex !== slot) return;
      // Relê o slot: o inventário pode ter mudado com o menu aberto.
      const stack = player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(choice.slot);
      if (!stack || stack.typeId !== choice.stack.typeId) return;
      attachBait(player, hand, stack, choice.slot);
    });
  }
  if (current) {
    form.button({ translate: "cobblemon.fishing.bait_menu.remove" });
    actions.push(() => {
      const hand = rodInHand(player);
      if (hand && player.selectedSlotIndex === slot) detachBait(player, hand);
    });
  }
  if (actions.length === 0) form.button({ translate: "gui.done" });
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return;
  actions[response.selection]?.();
}
