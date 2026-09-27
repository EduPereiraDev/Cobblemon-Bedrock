/**
 * Poké Snack temperado (PokeSnackBlockEntity.initializeFromItemStack do Cobblemon 1.8.2).
 *
 * O bloco `cobblemon:poke_snack` (spawns, mordidas, Poké Cake) é da frente pesca (scripts/fishing/PokeSnack.ts,
 * componente registrado por ela). Aqui só ligamos a culinária: o Poké Snack cozido na panela leva na lore os
 * temperos de isca; ao colocá-lo, os ids de isca (BaitSeasoningProcessor) vão para o bloco com
 * `setPokeSnackBaits`, e os efeitos passam a valer nos spawns do bloco.
 */
import { Block, ItemStack, Player, RawMessage } from "@minecraft/server";
import { SPAWN_BAITS } from "../fishing/baitData";
import { BaitEffect, registerSpawnBait } from "../fishing/BaitEffects";
import { setPokeSnackBaits } from "../fishing/PokeSnack";
import { SEASONINGS } from "./data";
import { seasoningIdsFromLore } from "./cookingLogic";

export const POKE_SNACK = "cobblemon:poke_snack";

/** Id de isca de um tempero com `baitEffects` (BaitSeasoningProcessor: `seasonings:<path>`). */
export function seasoningBaitId(item: string): string {
  return `seasonings:${item.replace(/^[a-z0-9_.-]+:/, "")}`;
}

/**
 * BaitSeasoningProcessor.apply: ids de isca dos temperos — os registros de spawn_bait_effects do item
 * (SpawnBaitEffects.getBaitIdentifiersFromItem) e `seasonings:<path>` para temperos com baitEffects.
 */
export function baitIdsForSeasonings(seasonings: readonly string[]): string[] {
  const ids: string[] = [];
  for (const item of seasonings) {
    for (const [id, def] of Object.entries(SPAWN_BAITS)) if (def.item === item) ids.push(id);
    if (SEASONINGS[item]?.baitEffects?.length) ids.push(seasoningBaitId(item));
  }
  return ids;
}

/** Registra na pesca os temperos com baitEffects próprios (nenhum no 1.8.2, mas datapacks podem ter). */
export function registerSeasoningBaits() {
  for (const [item, def] of Object.entries(SEASONINGS)) {
    if (!def.baitEffects?.length) continue;
    const effects: BaitEffect[] = def.baitEffects.map(e => ({
      type: e.type.replace(/^[a-z0-9_.-]+:/, ""),
      sub: e.subcategory?.replace(/^[a-z0-9_.-]+:/, ""),
      chance: e.chance,
      value: e.value,
    }));
    registerSpawnBait(seasoningBaitId(item), effects);
  }
}

/** Ids de isca da lore de um Poké Snack cozido. */
export function baitIdsFromLore(lore: readonly RawMessage[] | undefined): string[] {
  return baitIdsForSeasonings(seasoningIdsFromLore(lore));
}

/** Lore do item em mãos antes de colocar (o bloco só existe no after-event, quando a pilha já diminuiu). */
const pending = new Map<string, string[]>();

/** beforeEvents.playerInteractWithBlock com um Poké Snack na mão. */
export function rememberSnackItem(player: Player, stack: ItemStack | undefined) {
  if (stack?.typeId !== POKE_SNACK) return;
  let lore: RawMessage[] = [];
  try { lore = stack.getRawLore(); }
  catch { /* sem lore */ }
  const ids = baitIdsFromLore(lore);
  if (ids.length) pending.set(player.id, ids);
  else pending.delete(player.id);
}

/** afterEvents.playerPlaceBlock: grava as iscas no bloco recém-colocado. */
export function onSnackPlaced(player: Player, block: Block) {
  if (block.typeId !== POKE_SNACK) return;
  const ids = pending.get(player.id);
  pending.delete(player.id);
  if (ids?.length) setPokeSnackBaits(block.dimension, block.location, ids);
}
