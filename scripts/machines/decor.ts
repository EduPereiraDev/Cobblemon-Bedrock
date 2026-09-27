/**
 * Blocos de armazenamento/decoração: vitrine (display_case), estante de discos (disc_shelf), atril com
 * Pokédex (lectern) e baús dourados (gilded_chest / gimmighoul_chest).
 *
 * Frente motor: vitrine, estante e baús guardam ItemStack reais numa entidade com inventário no bloco
 * (scripts/world/Containers.ts) — encantamentos, desgaste e dados do item são preservados. Dados antigos da
 * vitrine/estante (MachineStore com SlotItem) migram para a entidade no primeiro uso ou ao quebrar.
 */
import { Block, Dimension, Direction, EquipmentSlot, ItemStack, Player, Vector3 } from "@minecraft/server";
import { blockKey, MachineStore } from "./store";
import { consumeHeld, dropAt, dropSlotItem, giveOrDrop, giveSlotItem, heldItem, isCreative, SlotItem, toItemStack, toSlotItem } from "./itemUtil";
import { createPokemonData, getState, MK, playMachineSound, setState, spawnWildPokemon, tr } from "./common";
import { getTMMove, unlockTM } from "./tm";
import { refreshDiscShelfDisplay, removeDiscShelfDisplay } from "./discShelfSequencer"; // frente mundo-detalhes: discos visíveis
import { isPokedexItem, openPokedex } from "../pokedex";
import { startWildBattle } from "../battle";
import {
  bindContainerEvents, containerOf, DISPLAY_STORAGE, dropAndRemove, ensureStorage, findStorage, GILDED_STORAGE, MACHINE_STORAGE,
  setChestBreaker, splitStack,
} from "../world/Containers";

// ---------------------------------------------------------------------------------------------
// Vitrine

/** Dados antigos (antes do inventário na entidade): só leitura para migrar. */
interface DisplayCaseState { item?: SlotItem }
const displayStore = new MachineStore<DisplayCaseState>("display_case");
/** Entidade de exibição (segura o item na mão, invisível) e dona do inventário de 1 espaço da vitrine. */
export const DISPLAY_ENTITY = DISPLAY_STORAGE;

/** Mostra o item na mão da entidade (equippable quando existir; senão replaceitem só com o id). */
function showDisplayItem(entity: import("@minecraft/server").Entity, item: ItemStack | undefined) {
  try {
    const eq = entity.getComponent("minecraft:equippable");
    if (eq) { eq.setEquipment(EquipmentSlot.Mainhand, item); return; }
  }
  catch { /* sem equippable em entidade não-jogador */ }
  try { entity.runCommand(item ? `replaceitem entity @s slot.weapon.mainhand 0 ${item.typeId} 1` : "replaceitem entity @s slot.weapon.mainhand 0 air"); }
  catch { /* item sem id de comando */ }
}

/** Contêiner da vitrine (cria a entidade se `create`), migrando o SlotItem antigo. */
function displayContainer(block: Block, create: boolean) {
  const key = blockKey(block.dimension.id, block.location);
  const legacy = displayStore.get(key);
  const entity = create || legacy?.item ? ensureStorage(block.dimension, block.location, DISPLAY_STORAGE, 0.1) : findStorage(block.dimension, block.location, DISPLAY_STORAGE);
  const container = containerOf(entity);
  if (container && legacy) {
    if (legacy.item && !container.getItem(0)) container.setItem(0, toItemStack(legacy.item, 1));
    displayStore.delete(key);
  }
  return { entity, container };
}

/** DisplayCaseBlockEntity.updateItem. */
export function interactDisplayCase(player: Player, block: Block) {
  const hand = heldItem(player);
  const { entity, container } = displayContainer(block, !!hand);
  const current = container?.getItem(0);
  if (!entity || !container) {
    if (!hand) player.onScreenDisplay.setActionBar(tr(MK.displayCaseEmpty));
    return;
  }
  if (hand && current && hand.typeId === current.typeId) return;
  if (!hand && current) {
    if (!isCreative(player)) giveOrDrop(player, current);
    container.setItem(0, undefined);
    playMachineSound(block.dimension, block.location, "itemRemove");
  }
  else if (hand && !current) {
    container.setItem(0, splitStack(hand, 1));
    consumeHeld(player, 1);
    playMachineSound(block.dimension, block.location, "itemAdd");
  }
  else if (hand && current) {
    container.setItem(0, splitStack(hand, 1));
    if (!isCreative(player)) {
      consumeHeld(player, 1);
      giveOrDrop(player, current);
    }
    playMachineSound(block.dimension, block.location, "itemAdd");
  }
  else {
    player.onScreenDisplay.setActionBar(tr(MK.displayCaseEmpty));
    return;
  }
  const shown = container.getItem(0);
  if (!shown) {
    try { entity.remove(); }
    catch { /* já removida */ }
    return;
  }
  showDisplayItem(entity, shown);
}

export function onDisplayCaseRemoved(dimension: Dimension, location: Vector3) {
  const key = blockKey(dimension.id, location);
  const state = displayStore.get(key);
  displayStore.delete(key);
  if (state?.item) dropSlotItem(dimension, location, state.item);
  for (let i = 0; i < 4; i++) {
    const entity = findStorage(dimension, location, DISPLAY_STORAGE);
    if (!entity) break;
    dropAndRemove(dimension, location, entity);
  }
}

// ---------------------------------------------------------------------------------------------
// Estante de discos (14 espaços, 2 colunas × 7 linhas na face da frente)

/** Dados antigos (antes do inventário na entidade): só leitura para migrar. */
interface DiscShelfState { slots: (SlotItem | null)[] }
const shelfStore = new MachineStore<DiscShelfState>("disc_shelf");
export const DISC_SHELF_SLOTS = 14;

/** DiscShelfBlockEntity.isValidItem. */
export function isValidDisc(id: string): boolean {
  return id === "cobblemon:technical_machine" || id === "cobblemon:blank_tm" || id === "cobblemon:upgrade"
    || id === "cobblemon:dubious_disc" || id.startsWith("minecraft:music_disc");
}

/**
 * getHitSlot: coluna/linha pelo ponto clicado na face (0..1 a partir do canto noroeste de baixo).
 * `face` = face clicada ("north"...). Devolve -1 fora das áreas dos discos.
 */
export function discShelfSlot(face: string, rel: Vector3): number {
  let x: number;
  const y = rel.y;
  switch (face) {
    case "north": x = 1 - rel.x; break;
    case "south": x = rel.x; break;
    case "west": x = rel.z; break;
    case "east": x = 1 - rel.z; break;
    default: return -1;
  }
  let col: number;
  if (x >= 1 / 16 && x <= 7 / 16) col = 0;
  else if (x >= 9 / 16 && x <= 15 / 16) col = 1;
  else return -1;
  if (y < 1 / 16 || y > 15 / 16) return -1;
  const rowFromBottom = Math.max(0, Math.min(6, Math.floor((y - 1 / 16) / (2 / 16))));
  return (6 - rowFromBottom) * 2 + col;
}

/** Contêiner da estante (cria se `create`), migrando os SlotItem antigos. */
function shelfContainer(block: Block, create: boolean) {
  const key = blockKey(block.dimension.id, block.location);
  const legacy = shelfStore.get(key);
  const hasLegacy = !!legacy?.slots.some(s => s);
  const entity = create || hasLegacy ? ensureStorage(block.dimension, block.location, MACHINE_STORAGE, 0.4) : findStorage(block.dimension, block.location, MACHINE_STORAGE);
  const container = containerOf(entity);
  if (container && legacy) {
    legacy.slots.forEach((s, i) => { if (s && i < container.size && !container.getItem(i)) container.setItem(i, toItemStack(s, 1)); });
    shelfStore.delete(key);
  }
  return { entity, container };
}

export function interactDiscShelf(player: Player, block: Block, face: Direction, faceLocation: Vector3 | undefined) {
  if (!faceLocation) return;
  const facing = getState<string>(block, "minecraft:cardinal_direction");
  const clicked = String(face).toLowerCase();
  // Só a face da frente (o facing do Bedrock pode estar invertido em relação ao modelo; aceita as duas).
  if (facing && clicked !== facing && clicked !== opposite(facing)) return;
  const slot = discShelfSlot(clicked, faceLocation);
  if (slot < 0) return;
  const hand = heldItem(player);
  if (hand && !isValidDisc(hand.typeId)) return;
  const { entity, container } = shelfContainer(block, !!hand);
  if (!entity || !container) return;
  const old = container.getItem(slot);
  if (hand) {
    if (old) giveOrDrop(player, old);
    container.setItem(slot, splitStack(hand, 1));
    consumeHeld(player, 1);
    playMachineSound(block.dimension, block.location, "itemAdd");
  }
  else {
    if (!old) return;
    giveOrDrop(player, old);
    container.setItem(slot, undefined);
    playMachineSound(block.dimension, block.location, "itemRemove");
  }
  let empty = true;
  for (let i = 0; i < DISC_SHELF_SLOTS && empty; i++) if (container.getItem(i)) empty = false;
  if (empty) {
    try { entity.remove(); }
    catch { /* já removida */ }
  }
  refreshDiscShelfDisplay(block);
}

function opposite(d: string) {
  return ({ north: "south", south: "north", east: "west", west: "east" } as Record<string, string>)[d] ?? d;
}

export function onDiscShelfRemoved(dimension: Dimension, location: Vector3) {
  const key = blockKey(dimension.id, location);
  const state = shelfStore.get(key);
  shelfStore.delete(key);
  for (const s of state?.slots ?? []) if (s) dropSlotItem(dimension, location, s);
  dropAndRemove(dimension, location, findStorage(dimension, location, MACHINE_STORAGE));
  removeDiscShelfDisplay(dimension, location);
}

// ---------------------------------------------------------------------------------------------
// Atril com Pokédex

interface LecternState { pokedex: SlotItem }
const lecternStore = new MachineStore<LecternState>("lectern");
export const LECTERN = "cobblemon:lectern";

/**
 * Pokédex num atril vanilla (agachado): vira o atril do Cobblemon com a Pokédex. Agachado porque a API não diz se
 * o atril vanilla tem livro — trocar o bloco apagaria o livro.
 */
export function placePokedexOnLectern(player: Player, block: Block): boolean {
  const hand = heldItem(player);
  if (block.typeId !== "minecraft:lectern" || !hand || !isPokedexItem(hand.typeId) || !player.isSneaking) return false;
  const facing = getState<string>(block, "minecraft:cardinal_direction");
  block.setType(LECTERN);
  if (facing) setState(block, "minecraft:cardinal_direction", facing);
  lecternStore.set(blockKey(block.dimension.id, block.location), { pokedex: toSlotItem(hand, 1) });
  consumeHeld(player, 1);
  playMachineSound(block.dimension, block.location, "itemAdd");
  return true;
}

export function interactLectern(player: Player, block: Block) {
  const key = blockKey(block.dimension.id, block.location);
  const state = lecternStore.get(key);
  if (!state) return;
  if (player.isSneaking) {
    giveSlotItem(player, state.pokedex);
    lecternStore.delete(key);
    const facing = getState<string>(block, "minecraft:cardinal_direction");
    block.setType("minecraft:lectern");
    if (facing) setState(block, "minecraft:cardinal_direction", facing);
    return;
  }
  // LecternBlockEntity.hasViewer → EMIT_LIGHT: luz 13 enquanto alguém lê a Pokédex no atril.
  const viewers = (lecternViewers.get(key) ?? 0) + 1;
  lecternViewers.set(key, viewers);
  setLecternLight(block, true);
  void openPokedex(player).finally(() => {
    const left = Math.max(0, (lecternViewers.get(key) ?? 1) - 1);
    if (left) lecternViewers.set(key, left);
    else {
      lecternViewers.delete(key);
      setLecternLight(block, false);
    }
  });
}

const lecternViewers = new Map<string, number>();

function setLecternLight(block: Block, on: boolean) {
  try {
    if (block.typeId === LECTERN && block.permutation.getState("cobblemon:emit_light" as never) !== on)
      block.setPermutation(block.permutation.withState("cobblemon:emit_light" as never, on as never));
  }
  catch { /* estado ausente (bloco antigo) ou chunk descarregado */ }
}

export function onLecternRemoved(dimension: Dimension, location: Vector3) {
  const key = blockKey(dimension.id, location);
  const state = lecternStore.get(key);
  lecternStore.delete(key);
  if (state) dropAt(dimension, location, toItemStack(state.pokedex));
}

// ---------------------------------------------------------------------------------------------
// Baús dourados

/** Entidade de inventário (27 espaços, UI de baú, funil puxa; caixa 1,02 para receber o clique antes do bloco). */
export const CHEST_STORAGE_ENTITY = GILDED_STORAGE;
export const GIMMIGHOUL_CHEST = "cobblemon:gimmighoul_chest";
const GIMMIGHOUL_LEVELS: [number, number] = [5, 30];

function chestEntity(dimension: Dimension, location: Vector3) {
  return findStorage(dimension, location, CHEST_STORAGE_ENTITY);
}

export function onGildedChestPlaced(block: Block) {
  if (block.typeId === GIMMIGHOUL_CHEST) return;
  ensureStorage(block.dimension, block.location, CHEST_STORAGE_ENTITY, 0);
}

/** Clique no bloco: só chega aqui sem a entidade (ela recebe o clique e abre a UI de baú); recria a entidade. */
export function interactGildedChest(player: Player, block: Block) {
  if (block.typeId === GIMMIGHOUL_CHEST) { revealGimmighoul(player, block); return; }
  if (!chestEntity(block.dimension, block.location)) {
    onGildedChestPlaced(block);
    if (!chestEntity(block.dimension, block.location)) player.onScreenDisplay.setActionBar(tr(MK.chestNoStorage));
  }
}

/** GildedChestBlock.spawnPokemon: Gimmighoul nível 5–30 no lugar do baú e batalha (fora do criativo). */
export function revealGimmighoul(player: Player | undefined, block: Block) {
  const dim = block.dimension;
  const loc = block.location;
  const level = GIMMIGHOUL_LEVELS[0] + Math.floor(Math.random() * (GIMMIGHOUL_LEVELS[1] - GIMMIGHOUL_LEVELS[0] + 1));
  const data = createPokemonData("gimmighoul", { level });
  try { block.setType("minecraft:air"); }
  catch { /* já removido */ }
  if (!data) return;
  const entity = spawnWildPokemon(dim, { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }, data);
  playMachineSound(dim, loc, "cobblemon.pokemon.gimmighoul.reveal");
  if (entity && player && !isCreative(player)) {
    try { startWildBattle(player, entity); }
    catch (e) { console.warn(`[baú] batalha com Gimmighoul falhou: ${e}`); }
  }
}

/** Quebra: solta o conteúdo da entidade de inventário (ou revela o Gimmighoul). */
export function onGildedChestRemoved(dimension: Dimension, location: Vector3, typeId: string, player?: Player) {
  if (typeId === GIMMIGHOUL_CHEST) return;
  void player;
  dropAndRemove(dimension, location, chestEntity(dimension, location));
}

/**
 * O clique esquerdo acerta a entidade (não o bloco): CHEST_HITS golpes quebram o baú (criativo: 1), soltando o
 * conteúdo e o próprio bloco (setblock destroy usa a loot table do bloco).
 */
setChestBreaker((player, dimension, location, typeId) => {
  onGildedChestRemoved(dimension, location, typeId, player);
  const creative = isCreative(player);
  try { dimension.runCommand(`setblock ${location.x} ${location.y} ${location.z} air ${creative ? "replace" : "destroy"}`); }
  catch (e) { console.warn(`[baú] não foi possível quebrar: ${e}`); }
  playMachineSound(dimension, location, "cobblemon.block.gilded_chest.break");
});
bindContainerEvents();

// ---------------------------------------------------------------------------------------------

/** TM guardado numa estante/monitor destrava o TM para quem mexeu (TMMoveManager.syncTMFromMove). */
export function unlockFromStack(player: Player, stack: ItemStack) {
  const move = getTMMove(stack);
  if (move) unlockTM(player, move.move);
}
