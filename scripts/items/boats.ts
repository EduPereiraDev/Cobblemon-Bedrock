/**
 * Barcos de apricorn/saccharine (CobblemonBoatItem / CobblemonBoatEntity), frente mundo-sons.
 *
 * O Bedrock não deixa um item custom colocar um barco vanilla com outra madeira: os barcos são entidades próprias
 * (`cobblemon:<madeira>_boat` / `_chest_boat`, behavior_packs/.../entities/boats) com `runtime_identifier`
 * `minecraft:boat` / `minecraft:chest_boat` (física, remo e controles do barco vanilla) e a textura do Cobblemon.
 * - Usar o item mirando água ou um bloco coloca o barco na superfície, virado para onde o jogador olha.
 * - O motor do barco vanilla solta o item vanilla (barco de carvalho) ao quebrar: o item que cai logo depois, no
 *   lugar do barco, é trocado pelo item do Cobblemon.
 */
import { Dimension, Entity, EntityInventoryComponent, GameMode, ItemStack, Player, system, Vector3, world } from "@minecraft/server";

export const BOAT_ITEMS: Record<string, string> = {
  "cobblemon:apricorn_boat": "cobblemon:apricorn_boat",
  "cobblemon:apricorn_chest_boat": "cobblemon:apricorn_chest_boat",
  "cobblemon:saccharine_boat": "cobblemon:saccharine_boat",
  "cobblemon:saccharine_chest_boat": "cobblemon:saccharine_chest_boat",
};

/** Itens vanilla que o motor do barco solta ao quebrar (variante 0 = carvalho). */
const VANILLA_DROPS = new Set(["minecraft:oak_boat", "minecraft:boat", "minecraft:oak_chest_boat", "minecraft:chest_boat"]);

const REACH = 5;

/** Ponto onde o barco nasce: em cima da água mirada, ou em cima do bloco sólido mirado. */
export function boatSpawnPoint(block: { location: Vector3; isLiquid: boolean; typeId: string }, faceLocation?: Vector3): Vector3 {
  const { x, y, z } = block.location;
  if (block.isLiquid || block.typeId.includes("water")) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
  const fx = faceLocation ? faceLocation.x : 0.5;
  const fz = faceLocation ? faceLocation.z : 0.5;
  return { x: x + fx, y: y + 1, z: z + fz };
}

/** Coloca o barco do item (BoatItem.use). Devolve a entidade ou undefined se não houver onde. */
export function placeBoat(player: Player, itemId: string): Entity | undefined {
  const entityId = BOAT_ITEMS[itemId];
  if (!entityId) return undefined;
  let hit;
  try { hit = player.getBlockFromViewDirection({ includeLiquidBlocks: true, includePassableBlocks: false, maxDistance: REACH }); }
  catch { return undefined; }
  if (!hit?.block) return undefined;
  const at = boatSpawnPoint(hit.block, hit.faceLocation);
  let boat: Entity | undefined;
  try {
    boat = player.dimension.spawnEntity(entityId as never, at);
    boat.setRotation({ x: 0, y: player.getRotation().y });
  }
  catch (e) {
    console.warn(`[barcos] falha ao colocar ${entityId}: ${e}`);
    return undefined;
  }
  if (player.getGameMode() !== GameMode.Creative) consumeOne(player, itemId);
  return boat;
}

function consumeOne(player: Player, itemId: string) {
  const container = (player.getComponent("minecraft:inventory") as EntityInventoryComponent | undefined)?.container;
  if (!container) return;
  const slot = player.selectedSlotIndex;
  const stack = container.getItem(slot);
  if (!stack || stack.typeId !== itemId) return;
  if (stack.amount <= 1) container.setItem(slot, undefined);
  else { stack.amount -= 1; container.setItem(slot, stack); }
}

/** Barcos removidos há pouco: onde e qual item do Cobblemon deve substituir o drop vanilla. */
interface RemovedBoat { dimension: string; location: Vector3; item: string; tick: number }
const removed: RemovedBoat[] = [];

export function rememberRemovedBoat(dimension: Dimension, location: Vector3, typeId: string, tick = system.currentTick) {
  const item = BOAT_ITEMS[typeId];
  if (!item) return;
  removed.push({ dimension: dimension.id, location: { ...location }, item, tick });
  while (removed.length > 16) removed.shift();
}

/** Drop vanilla de um barco nosso que acabou de sumir? Devolve o item do Cobblemon que o substitui. */
export function replacementForDrop(dimension: string, location: Vector3, itemId: string, tick = system.currentTick): string | undefined {
  if (!VANILLA_DROPS.has(itemId)) return undefined;
  const index = removed.findIndex(r => r.dimension === dimension && tick - r.tick <= 5
    && Math.abs(r.location.x - location.x) < 2.5 && Math.abs(r.location.y - location.y) < 2.5 && Math.abs(r.location.z - location.z) < 2.5);
  if (index < 0) return undefined;
  const [entry] = removed.splice(index, 1);
  // Barco com baú: o baú cai à parte; só o barco é trocado.
  return itemId.includes("chest") ? entry.item : entry.item.replace("_chest_boat", "_boat");
}

system.run(() => {
  try {
    world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
      if (!itemStack || !BOAT_ITEMS[itemStack.typeId] || source?.typeId !== "minecraft:player") return;
      placeBoat(source as Player, itemStack.typeId);
    });
    world.beforeEvents.entityRemove.subscribe(({ removedEntity }) => {
      if (!BOAT_ITEMS[removedEntity.typeId]) return;
      try { rememberRemovedBoat(removedEntity.dimension, removedEntity.location, removedEntity.typeId); }
      catch { /* entidade inválida */ }
    });
    world.afterEvents.entitySpawn.subscribe(({ entity }) => {
      if (entity.typeId !== "minecraft:item" || !removed.length) return;
      try {
        const stack = entity.getComponent("minecraft:item")?.itemStack;
        if (!stack) return;
        const replacement = replacementForDrop(entity.dimension.id, entity.location, stack.typeId);
        if (!replacement) return;
        const { dimension, location } = entity;
        entity.remove();
        dimension.spawnItem(new ItemStack(replacement, stack.amount), location);
      }
      catch { /* item já recolhido */ }
    });
  }
  catch { /* ambiente sem mundo (testes) */ }
});
