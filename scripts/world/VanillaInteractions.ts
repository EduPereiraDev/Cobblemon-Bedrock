/**
 * Integrações do Cobblemon 1.8.2 com blocos/itens vanilla que o Bedrock não expõe por dados:
 *
 * - Vaso de flor (FlowerPotBlock + createFlowerPotBlock): mudas de apricorn (semente), muda de saccharine e
 *   Pep-Up Flower plantadas num vaso vazio viram `cobblemon:potted_*`; clicar de mão vazia devolve a planta.
 * - Composteira (registerCompostable): itens de bloco sem JSON próprio (folhas, mudas, fardo...) sobem o nível
 *   com a chance do Kotlin (os demais têm `minecraft:compostable` no item).
 * - Apricorn: soco no apricorn maduro colhe sem quebrar (ApricornBlock.attack → doHarvest); semente de apricorn na
 *   lateral das folhas de apricorn planta o apricorn idade 0 virado para a folha (ApricornSeedItem.getPlacementState).
 * - Pérola do ender (EnderPearlItemMixin): agachado mirando o próprio Pokémon, a pérola não é arremessada.
 */
import { Block, BlockPermutation, Direction, Player, system, world } from "@minecraft/server";
import { COMPOST_BLOCK_ITEMS } from "../../generated/scripts/mundoDetalhes";
import { giveOrDrop, isCreative } from "../machines/itemUtil";
import { ItemStack } from "@minecraft/server";

/** Item plantável → bloco no vaso (conteúdo dos createFlowerPotBlock do CobblemonBlocks.kt). */
export const POTTABLE: Record<string, string> = {
  "cobblemon:pep_up_flower": "cobblemon:potted_pep_up_flower",
  "cobblemon:saccharine_sapling": "cobblemon:potted_saccharine_sapling",
  ...Object.fromEntries(["red", "yellow", "green", "blue", "pink", "black", "white"].map(c => [`cobblemon:${c}_apricorn_seed`, `cobblemon:potted_${c}_apricorn_sapling`])),
};
/** Vaso → item devolvido. */
export const POTTED_ITEM: Record<string, string> = Object.fromEntries(Object.entries(POTTABLE).map(([item, pot]) => [pot, item]));

/** Nível da composteira depois de pôr o item (ComposterBlock.addItem): sobe 1 com a chance; 7 é o máximo por item. */
export function composterNext(level: number, chance: number, roll: number): number {
  if (level >= 7) return level;
  if (level === 0 && chance > 0) return 1;
  return roll < chance ? level + 1 : level;
}

const APRICORN_BLOCK = /^cobblemon:(red|yellow|green|blue|pink|black|white)_apricorn_block$/;
const APRICORN_SEED = /^cobblemon:(red|yellow|green|blue|pink|black|white)_apricorn_seed$/;
const MAX_AGE = 3;

/** Colheita do apricorn maduro (ApricornBlock.harvest): solta o loot, volta à idade 0 e toca o som. */
export function harvestApricorn(block: Block): boolean {
  const m = APRICORN_BLOCK.exec(block.typeId);
  if (!m || block.permutation.getState("cobblemon:growth_state" as never) !== MAX_AGE) return false;
  block.setPermutation(block.permutation.withState("cobblemon:growth_state" as never, 0 as never));
  const { x, y, z } = block.location;
  block.dimension.runCommand(`loot spawn ${x + 0.5} ${y + 0.5} ${z + 0.5} loot "blocks/apricorns/${m[1]}_apricorn"`);
  block.dimension.playSound("cobblemon.block.apricorn.harvest", block.location);
  return true;
}

/** Direção cardinal (estado do apricorn) que aponta para a folha, dada a face da folha clicada. */
export function apricornFacingForFace(face: Direction): string | undefined {
  switch (face) {
    case Direction.North: return "south";
    case Direction.South: return "north";
    case Direction.East: return "west";
    case Direction.West: return "east";
    default: return undefined;
  }
}

function neighbour(block: Block, face: Direction): Block | undefined {
  switch (face) {
    case Direction.North: return block.north();
    case Direction.South: return block.south();
    case Direction.East: return block.east();
    case Direction.West: return block.west();
    case Direction.Up: return block.above();
    default: return block.below();
  }
}

/** Planta o apricorn idade 0 ao lado da folha clicada (true = plantou). */
export function plantApricornBlock(leaves: Block, face: Direction, seed: string): boolean {
  const color = APRICORN_SEED.exec(seed)?.[1];
  const facing = apricornFacingForFace(face);
  if (!color || !facing || leaves.typeId !== "cobblemon:apricorn_leaves") return false;
  const target = neighbour(leaves, face);
  if (!target?.isAir) return false;
  target.setPermutation(BlockPermutation.resolve(`cobblemon:${color}_apricorn_block`, { "cobblemon:growth_state": 0, "minecraft:cardinal_direction": facing }));
  target.dimension.playSound("dig.wood", target.location);
  return true;
}

/** Espaço e item da mão no momento da interação (o consumo roda no tick seguinte). */
interface HeldRef {
  slot: number;
  typeId: string;
}

function heldRef(player: Player, typeId: string): HeldRef {
  return { slot: player.selectedSlotIndex, typeId };
}

/** O espaço guardado ainda tem o item da interação (o jogador pode ter trocado de espaço ou largado o item). */
function stillHolds(player: Player, ref: HeldRef): boolean {
  if (isCreative(player)) return true;
  return player.getComponent("minecraft:inventory")?.container?.getItem(ref.slot)?.typeId === ref.typeId;
}

/** Tira 1 do espaço guardado, só se ainda for o mesmo item (nada no criativo). */
function consumeHeldRef(player: Player, ref: HeldRef) {
  if (isCreative(player)) return;
  const container = player.getComponent("minecraft:inventory")?.container;
  const item = container?.getItem(ref.slot);
  if (!container || item?.typeId !== ref.typeId) return;
  if (item.amount <= 1) container.setItem(ref.slot, undefined);
  else {
    item.amount--;
    container.setItem(ref.slot, item);
  }
}

function plantApricornOnLeaves(player: Player, leaves: Block, face: Direction, seed: string): boolean {
  const facing = apricornFacingForFace(face);
  if (!APRICORN_SEED.test(seed) || !facing || leaves.typeId !== "cobblemon:apricorn_leaves" || !neighbour(leaves, face)?.isAir) return false;
  const ref = heldRef(player, seed);
  system.run(() => {
    try { if (stillHolds(player, ref) && plantApricornBlock(leaves, face, seed)) consumeHeldRef(player, ref); }
    catch (e) { console.warn(`[mundo-detalhes] semente de apricorn: ${e}`); }
  });
  return true;
}

/** Planta o item no vaso vazio (true = trocou o bloco). */
export function potPlantBlock(pot: Block, item: string): boolean {
  const potted = POTTABLE[item];
  if (!potted || pot.typeId !== "minecraft:flower_pot") return false;
  pot.setType(potted);
  pot.dimension.playSound("block.flower_pot.place", pot.location);
  return true;
}

/** Tira a planta do vaso (devolve o item, ou undefined se não era um vaso do Cobblemon). */
export function takeFromPotBlock(pot: Block): string | undefined {
  const item = POTTED_ITEM[pot.typeId];
  if (!item) return undefined;
  pot.setType("minecraft:flower_pot");
  pot.dimension.playSound("block.flower_pot.place", pot.location);
  return item;
}

/** Põe um item na composteira (ComposterBlock.addItem). Devolve o nível novo, ou undefined se não aceitou. */
export function compostIntoBlock(composter: Block, item: string, roll = Math.random()): number | undefined {
  const chance = COMPOST_BLOCK_ITEMS[item];
  if (chance === undefined || composter.typeId !== "minecraft:composter") return undefined;
  const current = Number(composter.permutation.getState("composter_fill_level" as never) ?? 0);
  if (current >= 7) return undefined;
  const next = composterNext(current, chance, roll);
  if (next !== current) composter.setPermutation(composter.permutation.withState("composter_fill_level" as never, next as never));
  composter.dimension.playSound(next !== current ? "block.composter.fill_success" : "block.composter.fill", composter.location);
  // ComposterBlock: ao chegar em 7, fica pronto (8) depois de 20 ticks.
  if (next === 7) {
    system.runTimeout(() => {
      try {
        if (composter.typeId === "minecraft:composter" && Number(composter.permutation.getState("composter_fill_level" as never)) === 7) {
          composter.setPermutation(composter.permutation.withState("composter_fill_level" as never, 8 as never));
          composter.dimension.playSound("block.composter.ready", composter.location);
        }
      }
      catch { /* chunk descarregado */ }
    }, 20);
  }
  return next;
}

function potPlant(player: Player, pot: Block, item: string): boolean {
  if (!POTTABLE[item] || pot.typeId !== "minecraft:flower_pot") return false;
  const ref = heldRef(player, item);
  system.run(() => {
    try { if (stillHolds(player, ref) && potPlantBlock(pot, item)) consumeHeldRef(player, ref); }
    catch (e) { console.warn(`[mundo-detalhes] vaso: ${e}`); }
  });
  return true;
}

function takeFromPot(player: Player, pot: Block): boolean {
  if (!POTTED_ITEM[pot.typeId]) return false;
  system.run(() => {
    try {
      const item = takeFromPotBlock(pot);
      if (item) giveOrDrop(player, new ItemStack(item, 1));
    }
    catch (e) { console.warn(`[mundo-detalhes] vaso: ${e}`); }
  });
  return true;
}

function compost(player: Player, composter: Block, item: string): boolean {
  if (COMPOST_BLOCK_ITEMS[item] === undefined || composter.typeId !== "minecraft:composter") return false;
  if (Number(composter.permutation.getState("composter_fill_level" as never) ?? 0) >= 7) return false;
  const ref = heldRef(player, item);
  system.run(() => {
    try {
      if (stillHolds(player, ref) && compostIntoBlock(composter, item) !== undefined) consumeHeldRef(player, ref);
    }
    catch (e) { console.warn(`[mundo-detalhes] composteira: ${e}`); }
  });
  return true;
}

function looksAtOwnPokemon(player: Player): boolean {
  try {
    const hit = player.getEntitiesFromViewDirection({ maxDistance: 10, families: ["pokemon"] })[0]?.entity;
    if (!hit || hit.getProperty("cobblemon:initialized") !== true) return false;
    return hit.getDynamicProperty("owner_name") === player.name;
  }
  catch {
    return false;
  }
}

let started = false;

export function startVanillaInteractions() {
  if (started) return;
  started = true;
  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    if (!event.isFirstEvent) return;
    const { player, block, blockFace } = event;
    const item = event.itemStack?.typeId;
    try {
      if (item) {
        if (APRICORN_SEED.test(item) && block.typeId === "cobblemon:apricorn_leaves" && plantApricornOnLeaves(player, block, blockFace, item)) event.cancel = true;
        else if (block.typeId === "minecraft:flower_pot" && POTTABLE[item] && potPlant(player, block, item)) event.cancel = true;
        else if (block.typeId === "minecraft:composter" && compost(player, block, item)) event.cancel = true;
      }
      else if (POTTED_ITEM[block.typeId] && takeFromPot(player, block)) event.cancel = true;
    }
    catch (e) { console.warn(`[mundo-detalhes] interação com bloco: ${e}`); }
  });
  // Soco no apricorn maduro: colhe sem quebrar.
  world.afterEvents.entityHitBlock.subscribe(({ damagingEntity, hitBlock }) => {
    if (!(damagingEntity instanceof Player) || !APRICORN_BLOCK.test(hitBlock.typeId)) return;
    try { harvestApricorn(hitBlock); }
    catch (e) { console.warn(`[mundo-detalhes] colheita do apricorn: ${e}`); }
  });
  world.beforeEvents.playerBreakBlock.subscribe(event => {
    if (!APRICORN_BLOCK.test(event.block.typeId) || event.block.permutation.getState("cobblemon:growth_state" as never) !== MAX_AGE) return;
    // Criativo quebra antes do soco ser tratado: colhe em vez de quebrar.
    event.cancel = true;
    const block = event.block;
    system.run(() => {
      try { harvestApricorn(block); }
      catch { /* bloco já mudou */ }
    });
  });
  world.beforeEvents.itemUse.subscribe(event => {
    if (event.itemStack.typeId !== "minecraft:ender_pearl" || !event.source.isSneaking) return;
    if (looksAtOwnPokemon(event.source)) event.cancel = true;
  });
}
