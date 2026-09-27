/**
 * Frente "mundo-máquinas": agendador dos "block entities" e eventos de mundo que não passam por custom
 * component (fogueira/atril/suporte de poções vanilla, entidades de pasto, comer prato temperado).
 *
 * Ligação (main.ts, dentro de world.afterEvents.worldLoad): `startMachines();` — ver
 * docs/pendencias/mundo-maquinas.md. Os componentes de bloco já entram pelo registro automático.
 */
import { system, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { parseBlockKey } from "./store";
import { dimensionById, loadedBlock } from "./common";
import { tickFossilMachines } from "./fossils";
import { checkPastures, onPasturedEntityLoaded, tickPastureConflicts } from "./pasture";
import { applySeasonedFood, hasPendingBrew, isCampfirePotItem, isCobblemonBrewingItem, onBrewingStandRemoved, openBrewing, placePotOnCampfire, tickBrewing, tickCookingPots } from "./cooking";
import { onSnackPlaced, registerSeasoningBaits, rememberSnackItem } from "./pokeSnack";
import { tickTMMachines } from "./tm";
import { placePokedexOnLectern } from "./decor";
import { isPokedexItem } from "../pokedex";
import { blockKey } from "./store";
import { registerMundoSonsProbe } from "./probe";

export { isPastured } from "./pasture";
export { getTMMove, setTMMove, createTMStack, learnTMs, getLearnedTMs } from "./tm";
export { baitIdsForSeasonings, baitIdsFromLore } from "./pokeSnack";
export { seasonedDataFromLore, seasoningIdsFromLore } from "./cookingLogic";

const FAST = 10;
const SLOW = 20;
let started = false;

function safe(name: string, fn: () => void) {
  try { fn(); }
  catch (e) { console.warn(`[máquinas] ${name}: ${e}`); }
}

export function startMachines() {
  if (started) return;
  started = true;
  safe("iscas", registerSeasoningBaits);
  safe("sonda", registerMundoSonsProbe);

  system.runInterval(() => {
    safe("panelas", () => tickCookingPots(FAST));
    safe("TM", () => tickTMMachines(FAST, key => {
      const { dimension, location } = parseBlockKey(key);
      const dim = dimensionById(dimension);
      return dim && loadedBlock(dim, location);
    }));
  }, FAST);

  system.runInterval(() => {
    safe("fósseis", () => tickFossilMachines(SLOW));
    safe("pastos (mobs hostis)", tickPastureConflicts);
    safe("poções", () => tickBrewing(SLOW));
  }, SLOW);

  let pastureTimer = 0;
  system.runInterval(() => {
    pastureTimer += SLOW;
    if (pastureTimer < Math.max(1, getConfig().pastureBlockUpdateTicks)) return;
    pastureTimer = 0;
    safe("pastos", checkPastures);
  }, SLOW);

  // Blocos vanilla que viram máquinas do Cobblemon ao receber um item.
  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    const { block, player, itemStack } = event;
    const id = itemStack?.typeId;
    const type = block.typeId;
    if (id === "cobblemon:poke_snack") rememberSnackItem(player, itemStack);
    if ((type === "minecraft:campfire" || type === "minecraft:soul_campfire") && isCampfirePotItem(id)) {
      event.cancel = true;
      if (event.isFirstEvent) system.run(() => { if (block.isValid) void placePotOnCampfire(player, block, id!).catch(e => console.warn(`[máquinas] panela na fogueira: ${e}`)); });
    }
    else if (type === "minecraft:lectern" && isPokedexItem(id) && player.isSneaking) {
      event.cancel = true;
      if (event.isFirstEvent) system.run(() => { if (block.isValid) placePokedexOnLectern(player, block); });
    }
    else if (type === "minecraft:brewing_stand" && (isCobblemonBrewingItem(id) || hasPendingBrew(block))) {
      event.cancel = true;
      if (event.isFirstEvent) system.run(() => { if (block.isValid) void openBrewing(player, block); });
    }
  });

  world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => safe("poké snack", () => onSnackPlaced(player, block)));

  world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    if (brokenBlockPermutation.type.id === "minecraft:brewing_stand") safe("suporte", () => onBrewingStandRemoved(block.dimension, blockKey(block.dimension.id, block.location)));
  });

  world.afterEvents.entityLoad.subscribe(({ entity }) => safe("pasto", () => onPasturedEntityLoaded(entity)));

  world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source }) => {
    if (itemStack && source?.typeId === "minecraft:player") safe("comida", () => applySeasonedFood(source, itemStack));
  });
}
