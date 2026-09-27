import { ItemCustomComponent, ItemComponentConsumeEvent, Player, ItemStack, system, world } from "@minecraft/server";
import { getConfig } from "../Config";

/**
 * Leftovers ao comer uma maçã (PlayerMixin.onEatFood do Cobblemon): itens da tag `cobblemon:held/leaves_leftovers`
 * dão Leftovers com a chance `appleLeftoversChance` (config, padrão 0,025); sem espaço, cai na frente do jogador.
 * A maçã vanilla usa este componente (behavior_packs/.../items/apple.json); as 4 maçãs do Cobblemon passam pelo
 * evento itemCompleteUse abaixo (os JSON delas são gerados pelo importador).
 */
export const LEAVES_LEFTOVERS = new Set(["minecraft:apple", "cobblemon:sweet_apple", "cobblemon:tart_apple", "cobblemon:syrupy_apple", "cobblemon:candied_apple"]);

export function rollLeftovers(random: () => number = Math.random): boolean {
  return random() < (getConfig().appleLeftoversChance ?? 0.025);
}

export function giveLeftovers(player: Player) {
  const leftovers = new ItemStack("cobblemon:leftovers", 1);
  const rest = player.getComponent("inventory")?.container?.addItem(leftovers);
  if (rest) {
    const look = player.getViewDirection();
    const { x, y, z } = player.location;
    player.dimension.spawnItem(rest, { x: x + look.x * 0.5, y: y + 1, z: z + look.z * 0.5 });
  }
}

export default class GiveLeftoversComponent implements ItemCustomComponent {
  onConsume(arg: ItemComponentConsumeEvent) {
    if (!(arg.source instanceof Player))
      return;
    if (rollLeftovers()) giveLeftovers(arg.source as Player);
  }
}

system.run(() => {
  try {
    world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source }) => {
      // A maçã vanilla já passa pelo componente (evita o sorteio em dobro).
      if (!itemStack || itemStack.typeId === "minecraft:apple" || !LEAVES_LEFTOVERS.has(itemStack.typeId)) return;
      if (source?.typeId !== "minecraft:player") return;
      if (rollLeftovers()) giveLeftovers(source as Player);
    });
  }
  catch { /* ambiente sem mundo (testes) */ }
});
