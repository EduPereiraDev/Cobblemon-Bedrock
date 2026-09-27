/**
 * Componentes de bloco da frente "mundo-máquinas" (pasto, fósseis, TM machine, culinária, baús, vitrines).
 * O Poké Snack/Poké Cake (`cobblemon:poke_snack`) é registrado pela frente pesca (scripts/fishing/components.ts);
 * a ligação com os temperos fica em scripts/machines/pokeSnack.ts.
 */
import {
  Block, BlockComponentBlockBreakEvent, BlockComponentOnPlaceEvent, BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent,
  BlockComponentPlayerPlaceBeforeEvent, BlockCustomComponent, BlockPermutation, Dimension, Player, system, Vector3,
} from "@minecraft/server";
import { blockKey } from "../../machines/store";
import { replacedInPlace } from "../../comparadores/replace";
import { onPasturePlaced, onPastureRemoved, openPasture, pastureStore } from "../../machines/pasture";
import { interactFossilMachine, onFossilPartRemoved, tryFormStructure } from "../../machines/fossils";
import { closeTMLidOnFall, onTMMachineRemoved, openTMMachine } from "../../machines/tm";
import { CAMPFIRES, cookingStore, isCampfirePotItem, onCampfireRemoved, openCookingPot, placePotOnCampfire, togglePotLid } from "../../machines/cooking";
import {
  interactDiscShelf, interactDisplayCase, interactGildedChest, interactLectern, onDiscShelfRemoved, onDisplayCaseRemoved,
  onGildedChestPlaced, onGildedChestRemoved, onLecternRemoved, revealGimmighoul, GIMMIGHOUL_CHEST,
} from "../../machines/decor";
import { dropAt, heldItem } from "../../machines/itemUtil";
import { getState } from "../../machines/common";
import { onHabitatPlaced, onHabitatRandomTick, onHabitatRemoved, onHabitatTick, openHabitatEditor } from "../../machines/habitat";

type BreakEvent = BlockComponentBlockBreakEvent | BlockComponentPlayerBreakEvent;

/** Estado de um bloco já quebrado (a permutação antiga vem no evento). */
function brokenState<T extends string | number | boolean>(arg: BreakEvent, state: string): T | undefined {
  try { return arg.brokenBlockPermutation.getState(state as never) as T | undefined; }
  catch { return undefined; }
}

function brokenType(arg: BreakEvent): string {
  return arg.brokenBlockPermutation.type.id;
}

/** Tipo do bloco que está agora no lugar do quebrado (undefined se ilegível). */
function currentTypeOf(arg: BreakEvent): string | undefined {
  try { return arg.block.typeId; }
  catch { return undefined; }
}

/** Callback de quebra único para onBreak e onPlayerBreak (as rotinas são idempotentes). */
function onRemoved(handler: (dimension: Dimension, location: Vector3, arg: BreakEvent) => void): Pick<BlockCustomComponent, "onBreak" | "onPlayerBreak"> {
  const run = (arg: BreakEvent) => {
    try { handler(arg.dimension, arg.block.location, arg); }
    catch (e) { console.warn(`[máquinas] quebra em ${arg.block.location.x},${arg.block.location.y},${arg.block.location.z}: ${e}`); }
  };
  return { onBreak: run, onPlayerBreak: run };
}

/** Interação: roda fora do evento (forms e mudanças de bloco). */
function interact(fn: (arg: BlockComponentPlayerInteractEvent) => unknown): Pick<BlockCustomComponent, "onPlayerInteract"> {
  return {
    onPlayerInteract: arg => {
      if (!arg.player) return;
      system.run(() => {
        if (!arg.player?.isValid || !arg.block.isValid) return;
        try { void fn(arg); }
        catch (e) { console.warn(`[máquinas] interação: ${e}`); }
      });
    },
  };
}

/** Parte de cima de bloco duplo: cancela se não houver espaço acima. */
function requireSpaceAbove(arg: BlockComponentPlayerPlaceBeforeEvent) {
  const above = arg.block.above();
  if (!above || !(above.isAir || above.isLiquid)) arg.cancel = true;
}

/** Coloca a metade de cima (`cobblemon:part` = top) com os mesmos estados. */
function placeTopHalf(block: Block) {
  if (getState<string>(block, "cobblemon:part") !== "bottom") return;
  const above = block.above();
  if (!above || !(above.isAir || above.isLiquid)) return;
  above.setPermutation(block.permutation.withState("cobblemon:part" as never, "top" as never));
}

/** Remove a outra metade (sem drop: cada metade tem o próprio loot, ou o pasto cuida disso). */
function removeOtherHalf(dimension: Dimension, location: Vector3, typeId: string, part: string | undefined) {
  const other = { x: location.x, y: location.y + (part === "top" ? -1 : 1), z: location.z };
  try {
    const block = dimension.getBlock(other);
    if (block?.typeId === typeId) block.setType("minecraft:air");
  }
  catch { /* fora do mundo */ }
}

const fossilPart: BlockCustomComponent = {
  onPlace: (arg: BlockComponentOnPlaceEvent) => { system.run(() => { if (arg.block.isValid) tryFormStructure(arg.block); }); },
  ...interact(arg => interactFossilMachine(arg.player!, arg.block)),
  ...onRemoved((dim, loc, arg) => onFossilPartRemoved(dim, loc, brokenType(arg))),
};

export const MACHINE_BLOCK_COMPONENTS: Record<string, BlockCustomComponent> = {
  // Bloco de habitat (scripts/machines/habitat.ts + scripts/spawning/Habitats.ts).
  "cobblemon:habitat_block": {
    onPlace: arg => { system.run(() => { if (arg.block.isValid) onHabitatPlaced(arg.block); }); },
    onTick: arg => {
      try { onHabitatTick(arg.block); }
      catch (e) { console.warn(`[habitat] tick: ${e}`); }
    },
    onRandomTick: arg => {
      try { onHabitatRandomTick(arg.block); }
      catch (e) { console.warn(`[habitat] random tick: ${e}`); }
    },
    ...interact(arg => openHabitatEditor(arg.player!, arg.block)),
    onBreak: arg => {
      try {
        const source = arg.entitySource;
        onHabitatRemoved(arg.dimension, arg.block.location, source?.typeId === "minecraft:player" ? source as Player : undefined);
      }
      catch { /* removido */ }
    },
    onPlayerBreak: arg => { try { onHabitatRemoved(arg.dimension, arg.block.location, arg.player); } catch { /* removido */ } },
  },
  "cobblemon:pasture": {
    beforeOnPlayerPlace: arg => {
      requireSpaceAbove(arg);
      if (arg.cancel || !arg.player) return;
      const key = blockKey(arg.dimension.id, arg.block.location);
      pastureStore.set(key, { dimension: arg.dimension.id, pos: [arg.block.location.x, arg.block.location.y, arg.block.location.z], ownerId: arg.player.id, ownerName: arg.player.name, tethers: [] });
    },
    onPlace: arg => { system.run(() => { if (arg.block.isValid) onPasturePlaced(arg.block); }); },
    ...interact(arg => openPasture(arg.player!, arg.block)),
    ...onRemoved((dim, loc, arg) => onPastureRemoved(dim, loc, brokenState<string>(arg, "cobblemon:part"))),
  },
  "cobblemon:fossil_analyzer": fossilPart,
  "cobblemon:fossil_monitor": fossilPart,
  "cobblemon:restoration_tank": {
    beforeOnPlayerPlace: requireSpaceAbove,
    onPlace: arg => {
      system.run(() => {
        if (!arg.block.isValid) return;
        placeTopHalf(arg.block);
        tryFormStructure(arg.block);
      });
    },
    ...interact(arg => interactFossilMachine(arg.player!, arg.block)),
    ...onRemoved((dim, loc, arg) => {
      const part = brokenState<string>(arg, "cobblemon:part");
      onFossilPartRemoved(dim, loc, brokenType(arg));
      removeOtherHalf(dim, loc, brokenType(arg), part);
    }),
  },
  "cobblemon:tm_machine": {
    ...interact(arg => openTMMachine(arg.player!, arg.block)),
    // TMMachineBlock.fallOn (precisa de minecraft:entity_fall_on no JSON: behavior_packs/.../tm_machine.json).
    onEntityFallOn: arg => {
      const entity = arg.entity;
      if (!entity?.isValid || entity.typeId === "minecraft:item") return;
      try { if (entity.location.y < arg.block.location.y + 0.55) return; }
      catch { return; }
      closeTMLidOnFall(arg.block);
    },
    ...onRemoved((dim, loc) => onTMMachineRemoved(dim.id, blockKey(dim.id, loc), stack => dropAt(dim, loc, stack))),
  },
  "cobblemon:disc_shelf": {
    ...interact(arg => interactDiscShelf(arg.player!, arg.block, arg.face, arg.faceLocation)),
    ...onRemoved((dim, loc) => onDiscShelfRemoved(dim, loc)),
  },
  "cobblemon:display_case": {
    ...interact(arg => interactDisplayCase(arg.player!, arg.block)),
    ...onRemoved((dim, loc) => onDisplayCaseRemoved(dim, loc)),
  },
  "cobblemon:lectern": {
    ...interact(arg => interactLectern(arg.player!, arg.block)),
    ...onRemoved((dim, loc) => onLecternRemoved(dim, loc)),
  },
  "cobblemon:gilded_chest": {
    onPlace: arg => { system.run(() => { if (arg.block.isValid) onGildedChestPlaced(arg.block); }); },
    ...interact(arg => interactGildedChest(arg.player!, arg.block)),
    onBreak: arg => { try { onGildedChestRemoved(arg.dimension, arg.block.location, brokenType(arg)); } catch { /* removido */ } },
    onPlayerBreak: arg => {
      try {
        if (brokenType(arg) === GIMMIGHOUL_CHEST) revealGimmighoul(arg.player, arg.block);
        else onGildedChestRemoved(arg.dimension, arg.block.location, brokenType(arg), arg.player);
      }
      catch { /* removido */ }
    },
  },
  "cobblemon:campfire": {
    ...interact(arg => {
      const key = blockKey(arg.block.dimension.id, arg.block.location);
      if (cookingStore.get(key)) return openCookingPot(arg.player!, arg.block);
      const hand = heldItem(arg.player!)?.typeId;
      if (isCampfirePotItem(hand)) void placePotOnCampfire(arg.player!, arg.block, hand!).catch(e => console.warn(`[máquinas] panela na fogueira: ${e}`));
    }),
    // A recolocação do comparador (scripts/comparadores/replace.ts) também dispara o onBreak: aí a panela fica.
    ...onRemoved((dim, loc, arg) => {
      if (!CAMPFIRES.includes(brokenType(arg)) || replacedInPlace(dim.id, loc, currentTypeOf(arg), CAMPFIRES)) return;
      onCampfireRemoved(dim, blockKey(dim.id, loc));
    }),
  },
  "cobblemon:campfire_pot": {
    ...interact(arg => togglePotLid(arg.block)),
  },
};

export type { BlockPermutation };
