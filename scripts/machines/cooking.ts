/**
 * Culinária no mundo:
 * - Panela na fogueira (CampfireBlock/CampfireBlockEntity): usar uma panela (`cobblemon:campfire_pot_*`) numa
 *   fogueira vanilla acesa troca o bloco por `cobblemon:campfire`/`cobblemon:soul_campfire` com a panela.
 *   Interagir abre a cozinha (grade 3×3 + 3 temperos + resultado + tampa); agachado retira a panela.
 *   Cozinha 100 ticks por prato com a tampa fechada, como no Cobblemon.
 * - A panela solta no chão (`cobblemon:campfire_pot_*`) é decorativa: interagir abre/fecha a tampa.
 * - Poções do Cobblemon (receitas brewing_stand): o suporte de poções do Bedrock não aceita receitas com
 *   itens de add-on, então usar um ingrediente/frasco do Cobblemon num suporte vanilla abre uma tela própria
 *   (ingrediente + até 3 frascos + blaze powder, 400 ticks).
 * - Comer um prato temperado aplica os efeitos de poção/comida extra dos temperos (lore).
 */
import { applyCobblemonMobEffect } from "../events/MobEffects";
import { Block, Dimension, ItemStack, MolangVariableMap, Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { BREWING_RECIPES, BrewingRecipe } from "../../generated/scripts/recipes";
import { blockKey, MachineStore, parseBlockKey } from "./store";
import {
  applySeasoning, BLAZE_POWDER_USES, BREWING_TICKS, COOKING_TICKS, findBrewingRecipe, findCookingRecipe, GRID_SIZE, isBrewingBottle,
  isBrewingInput, isCookingIngredient, isSeasoning, seasonedDataFromLore, seasoningConsumed, seasoningLore, SEASONING_SLOTS,
} from "./cookingLogic";
import {
  countInInventory, CRAFTING_REMAINDERS, dropAt, dropSlotItem, giveOrDrop, giveSlotItem, isCreative, isPlainStack, itemNameOf, maxStackOf,
  removeFromInventory, sameStack, SlotItem, toItemStack, toSlotItem,
} from "./itemUtil";
import { dimensionById, getState, keepMachineLoop, loadedBlock, MK, playMachineSound, setState, stopMachineLoop, tr } from "./common";
import { addFood, readFoodData } from "../items/food";

export const CAMPFIRES = ["cobblemon:campfire", "cobblemon:soul_campfire"];
const VANILLA_FOR: Record<string, string> = { "cobblemon:campfire": "minecraft:campfire", "cobblemon:soul_campfire": "minecraft:soul_campfire" };
const COBBLEMON_FOR: Record<string, string> = { "minecraft:campfire": "cobblemon:campfire", "minecraft:soul_campfire": "cobblemon:soul_campfire" };

export interface CookingPotState {
  pot: string;
  grid: (SlotItem | null)[];
  seasonings: (SlotItem | null)[];
  result: SlotItem | null;
  progress: number;
  /** Tampa fechada (LID): só cozinha fechada. */
  lid: boolean;
  /** Último sinal de redstone visto (CampfireBlock.POWERED). */
  powered?: boolean;
}

export const cookingStore = new MachineStore<CookingPotState>("cooking");

export function isCampfirePotItem(id: string | undefined): boolean {
  return !!id && /^cobblemon:campfire_pot_[a-z]+$/.test(id);
}

function newState(pot: string): CookingPotState {
  return { pot, grid: new Array(GRID_SIZE).fill(null), seasonings: new Array(SEASONING_SLOTS).fill(null), result: null, progress: 0, lid: false };
}

// ---------------------------------------------------------------------------------------------
// Resultado de uma rodada

/** O que sairia agora (item + lore de tempero) ou undefined. */
export function currentOutput(state: CookingPotState): { recipe: ReturnType<typeof findCookingRecipe>; output: SlotItem } | undefined {
  const recipe = findCookingRecipe(state.grid.map(s => s?.id ?? null));
  if (!recipe) return undefined;
  const seasoned = applySeasoning(recipe, state.seasonings.map(s => s?.id ?? "").filter(Boolean));
  const output: SlotItem = { id: recipe.result.item, n: recipe.result.count };
  const lore = seasoningLore(seasoned);
  if (lore) output.lore = lore;
  return { recipe, output };
}

/**
 * Um tick agregado de cozimento (CampfireBlockEntity.serverTick). Devolve os restos (baldes/garrafas) a
 * soltar quando um prato fica pronto.
 */
export function cookTick(state: CookingPotState, ticks: number): { cooked: boolean; remainders: string[] } {
  const none = { cooked: false, remainders: [] as string[] };
  const out = currentOutput(state);
  if (!out || !state.lid) { state.progress = 0; return none; }
  if (state.result && (!sameStack(state.result, out.output) || state.result.n + out.output.n > maxStackOf(out.output.id))) {
    state.progress = 0;
    return none;
  }
  state.progress += ticks;
  if (state.progress < COOKING_TICKS) return none;
  state.progress = 0;
  if (state.result) state.result.n += out.output.n;
  else state.result = { ...out.output };
  const remainders: string[] = [];
  state.grid = state.grid.map(slot => {
    if (!slot) return null;
    const rem = CRAFTING_REMAINDERS[slot.id];
    if (rem) remainders.push(rem);
    return slot.n > 1 ? { ...slot, n: slot.n - 1 } : null;
  });
  state.seasonings = state.seasonings.map(slot => {
    if (!slot || !seasoningConsumed(out.recipe!, slot.id)) return slot;
    return slot.n > 1 ? { ...slot, n: slot.n - 1 } : null;
  });
  return { cooked: true, remainders };
}

// ---------------------------------------------------------------------------------------------
// Panela na fogueira

/** Usar a panela numa fogueira acesa (vanilla ou do Cobblemon sem panela). */
export async function placePotOnCampfire(player: Player, block: Block, potItem: string): Promise<boolean> {
  const original = block.typeId;
  const target = COBBLEMON_FOR[original] ?? (CAMPFIRES.includes(original) ? original : undefined);
  if (!target) return false;
  if (getState<boolean>(block, "extinguished")) return false;
  const key = blockKey(block.dimension.id, block.location);
  if (cookingStore.get(key)) return false;
  if (original !== target) {
    // A comida assando na fogueira vanilla não é visível ao script e trocar o bloco a apagaria (no Java ela
    // cai, CampfirePotItem.useOn): pergunta antes. Depois da resposta, confere tudo de novo.
    if (!await confirmCampfireConversion(player)) return false;
    if (!block.isValid || block.typeId !== original || getState<boolean>(block, "extinguished") || cookingStore.get(key)) return false;
    if (!isCreative(player) && countInInventory(player, potItem) < 1) return false;
  }
  const facing = getState<string>(block, "minecraft:cardinal_direction");
  if (block.typeId !== target) {
    block.setType(target);
    if (facing) setState(block, "minecraft:cardinal_direction", facing);
  }
  cookingStore.set(key, newState(potItem));
  if (!isCreative(player)) removeFromInventory(player, potItem, 1);
  playMachineSound(block.dimension, block.location, "potSet");
  return true;
}

/** Confirmação de trocar a fogueira vanilla (a comida que estiver assando nela se perde). */
async function confirmCampfireConversion(player: Player): Promise<boolean> {
  try {
    const res = await new MessageFormData()
      .title(tr(MK.cookingConvertTitle))
      .body(tr(MK.cookingConvertBody))
      .button1(tr(MK.cookingConvertConfirm))
      .button2(tr(MK.cookingConvertCancel))
      .show(player);
    return res.selection === 0;
  }
  catch { return false; }
}

function dropContents(dim: Dimension, block: { x: number; y: number; z: number }, state: CookingPotState) {
  for (const slot of [...state.grid, ...state.seasonings, state.result]) if (slot) dropSlotItem(dim, block, slot);
}

/** Agachado: tira a panela (removePotItem) e volta a fogueira vanilla. */
function removePot(player: Player, block: Block, state: CookingPotState) {
  const key = blockKey(block.dimension.id, block.location);
  dropContents(block.dimension, block.location, state);
  cookingStore.delete(key);
  stopPotLoops(block.dimension, key);
  giveOrDrop(player, new ItemStack(state.pot, 1));
  const vanilla = VANILLA_FOR[block.typeId];
  const facing = getState<string>(block, "minecraft:cardinal_direction");
  if (vanilla) {
    block.setType(vanilla);
    if (facing) setState(block, "minecraft:cardinal_direction", facing);
  }
  playMachineSound(block.dimension, block.location, "potRetrieve");
}

/** Fogueira do Cobblemon quebrada: solta panela e conteúdo. */
export function onCampfireRemoved(dimension: Dimension, key: string) {
  const state = cookingStore.get(key);
  cookingStore.delete(key);
  if (!state) return;
  stopPotLoops(dimension, key);
  const { location } = parseBlockKey(key);
  dropContents(dimension, location, state);
  dropAt(dimension, location, new ItemStack(state.pot, 1));
}

function slotLabel(slot: SlotItem | null, emptyKey: string, index: number): RawMessage {
  if (!slot) return { rawtext: [{ text: "§8" }, tr(emptyKey, `${index + 1}`)] };
  return { rawtext: [itemNameOf(slot.id), { text: ` §7×${slot.n}${slot.lore?.length ? " §d✦" : ""}` }] };
}

/** Escolhe uma pilha do inventário (para pôr num espaço). */
async function pickFromInventory(player: Player, filter: (id: string) => boolean): Promise<number | undefined> {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return undefined;
  const slots: number[] = [];
  const form = new ActionFormData().title({ translate: "cobblemon.container.campfire_pot" });
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item || !filter(item.typeId)) continue;
    slots.push(i);
    form.button({ rawtext: [itemNameOf(item.typeId), { text: ` §7×${item.amount}` }] });
  }
  if (!slots.length) return undefined;
  const res = await form.show(player);
  return res.selection === undefined ? undefined : slots[res.selection];
}

/** Põe a pilha do inventário num espaço (junta com a mesma, troca se diferente). */
function putStack(player: Player, invSlot: number, current: SlotItem | null, accepts: (id: string) => boolean): SlotItem | null {
  const container = player.getComponent("minecraft:inventory")?.container;
  const stack = container?.getItem(invSlot);
  if (!container || !stack) return current;
  // Relê o espaço (pode ter mudado com a tela aberta): item fora da lista ou com dados extras não entra.
  if (!accepts(stack.typeId) || !isPlainStack(stack)) return current;
  const incoming = toSlotItem(stack);
  if (current && sameStack(current, incoming)) {
    const room = maxStackOf(current.id) - current.n;
    const moved = Math.min(room, incoming.n);
    if (moved <= 0) return current;
    if (!isCreative(player)) {
      if (moved >= stack.amount) container.setItem(invSlot, undefined);
      else { stack.amount -= moved; container.setItem(invSlot, stack); }
    }
    return { ...current, n: current.n + moved };
  }
  if (!isCreative(player)) container.setItem(invSlot, undefined);
  if (current) giveSlotItem(player, current);
  return incoming;
}

export async function openCookingPot(player: Player, block: Block) {
  const key = blockKey(block.dimension.id, block.location);
  let state = cookingStore.get(key);
  if (!state) return;
  if (player.isSneaking) { removePot(player, block, state); return; }
  while (true) {
    state = cookingStore.get(key);
    if (!state || !block.isValid || !CAMPFIRES.includes(block.typeId)) return;
    const out = currentOutput(state);
    const body: RawMessage[] = [];
    body.push(out ? { rawtext: [{ text: "→ " }, itemNameOf(out.output.id), { text: ` ×${out.output.n}` }] } : tr(MK.cookingNoRecipe));
    if (out && state.lid) body.push({ text: "\n" }, tr(MK.cookingProgress, `${Math.floor(state.progress * 100 / COOKING_TICKS)}%`));
    body.push({ text: "\n§7" }, tr(MK.cookingHint));
    const form = new ActionFormData().title({ translate: "cobblemon.container.campfire_pot" }).body({ rawtext: body });
    state.grid.forEach((s, i) => form.button(slotLabel(s, MK.cookingSlot, i)));
    state.seasonings.forEach((s, i) => form.button(slotLabel(s, MK.cookingSeasoning, i)));
    form.button(state.result ? { rawtext: [tr(MK.cookingResult), { text: ": " }, itemNameOf(state.result.id), { text: ` ×${state.result.n}` }] } : tr(MK.cookingResult));
    form.button(tr(state.lid ? MK.cookingLidOpen : MK.cookingLidClose));
    form.button(tr(MK.cookingRemovePot));
    const res = await form.show(player);
    if (res.selection === undefined) return;
    state = cookingStore.get(key);
    if (!state) return;
    const sel = res.selection;
    if (sel < GRID_SIZE + SEASONING_SLOTS) {
      const isSeason = sel >= GRID_SIZE;
      const list = isSeason ? state.seasonings : state.grid;
      const idx = isSeason ? sel - GRID_SIZE : sel;
      if (list[idx]) {
        giveSlotItem(player, list[idx]!);
        list[idx] = null;
      }
      else {
        // Só ingredientes de receita/temperos (a grade guarda só id/quantidade/lore/nome, como os itens de receita).
        const accepts = (id: string) => isSeason ? isSeasoning(id) : isCookingIngredient(id) || isSeasoning(id);
        const inv = await pickFromInventory(player, accepts);
        state = cookingStore.get(key);
        if (inv === undefined || !state) continue;
        const target = isSeason ? state.seasonings : state.grid;
        target[idx] = putStack(player, inv, target[idx], accepts);
        playMachineSound(block.dimension, block.location, "itemAdd", 0.5);
      }
      state.progress = 0;
    }
    else if (sel === GRID_SIZE + SEASONING_SLOTS) {
      if (state.result) {
        giveSlotItem(player, state.result);
        state.result = null;
        // CookingPotResultSlot.onTake: som só para quem tirou.
        try { player.playSound("cobblemon.block.campfire_pot.take_item"); }
        catch { /* som inexistente */ }
      }
    }
    else if (sel === GRID_SIZE + SEASONING_SLOTS + 1) {
      state.lid = !state.lid;
      playMachineSound(block.dimension, block.location, state.lid ? "potClose" : "potOpen");
    }
    else {
      removePot(player, block, state);
      return;
    }
    cookingStore.set(key, state);
  }
}

/** Estado da panela para sons/partículas (CampfireBlockEntity.clientTick): cozinhando, só com itens, ou vazia. */
export function potActivity(state: CookingPotState): "cooking" | "idle" | "empty" {
  const hasItems = state.grid.some(s => !!s) || state.seasonings.some(s => !!s);
  if (!hasItems) return "empty";
  return state.lid && currentOutput(state) ? "cooking" : "idle";
}

/**
 * Redstone (CampfireBlock.neighborChanged): sinal liga → fecha a tampa; sinal some → abre. Só age na mudança do
 * sinal (`powered` guardado), então abrir/fechar pela tela continua valendo enquanto o sinal não muda.
 */
export function applyRedstoneLid(state: CookingPotState, power: number): "open" | "close" | undefined {
  const powered = power > 0;
  if (powered === (state.powered ?? false)) return undefined;
  state.powered = powered;
  if (state.lid === powered) return undefined;
  state.lid = powered;
  return powered ? "close" : "open";
}

function stopPotLoops(dimension: Dimension, key: string) {
  const { location } = parseBlockKey(key);
  stopMachineLoop(dimension, location, key, "potActive");
  stopMachineLoop(dimension, location, key, "potAmbient");
}

/** Bolhas do caldo (partícula cobblemon:broth_bubbles do Cobblemon, a cada 20 ticks enquanto cozinha). */
function spawnBroth(dimension: Dimension, location: { x: number; y: number; z: number }) {
  try {
    const vars = new MolangVariableMap();
    vars.setFloat("variable.size", 1);
    dimension.spawnParticle("cobblemon:broth_bubbles", { x: location.x + 0.5, y: location.y + 0.5375, z: location.z + 0.5 }, vars);
  }
  catch { /* partícula ainda não importada */ }
}

/**
 * Sinal de vizinhança mudou (CampfireBlock.neighborChanged): grava `powered` e abre/fecha a tampa com o som. Chamado pelo
 * laço de scripts/adaptacoes/potRedstone.ts, que lê a redstone dos 6 vizinhos (a fogueira não tem mais
 * `minecraft:redstone_consumer`: o `getRedstonePower()` dela seria a própria saída do comparador).
 */
export function setPotPowered(dimension: Dimension, key: string, powered: boolean): "open" | "close" | undefined {
  const state = cookingStore.get(key);
  if (!state || (state.powered ?? false) === powered) return undefined;
  const lid = applyRedstoneLid(state, powered ? 15 : 0);
  cookingStore.set(key, state);
  if (lid) playMachineSound(dimension, parseBlockKey(key).location, lid === "close" ? "potClose" : "potOpen");
  return lid;
}

export function tickCookingPots(ticks: number) {
  const now = system.currentTick;
  for (const key of cookingStore.keys()) {
    const state = cookingStore.get(key);
    if (!state) continue;
    const { dimension, location } = parseBlockKey(key);
    const dim = dimensionById(dimension);
    const block = dim && loadedBlock(dim, location);
    if (!block) continue;
    if (!CAMPFIRES.includes(block.typeId)) { onCampfireRemoved(dim!, key); continue; }
    // A tampa por redstone é tratada em scripts/adaptacoes/potRedstone.ts (setPotPowered, a cada 2 ticks).
    // Laços de som: "active" cozinhando, "ambient" com itens parados, nada vazia.
    const activity = potActivity(state);
    if (activity === "cooking") {
      stopMachineLoop(dim!, location, key, "potAmbient");
      keepMachineLoop(dim!, location, key, "potActive", now);
      if (now % 20 < ticks) spawnBroth(dim!, location);
    }
    else if (activity === "idle") {
      stopMachineLoop(dim!, location, key, "potActive");
      keepMachineLoop(dim!, location, key, "potAmbient", now);
    }
    else stopPotLoops(dim!, key);
    if (!state.lid && state.progress === 0) continue;
    const before = state.progress;
    const { cooked, remainders } = cookTick(state, ticks);
    for (const r of remainders) dropAt(dim!, { x: location.x, y: location.y + 0.6, z: location.z }, new ItemStack(r, 1));
    if (cooked) playMachineSound(dim!, location, "potCook");
    if (cooked || before !== state.progress) cookingStore.set(key, state);
  }
}

/** Panela decorativa: abre/fecha a tampa. */
export function togglePotLid(block: Block) {
  const open = getState<boolean>(block, "cobblemon:open") ?? false;
  setState(block, "cobblemon:open", !open);
  playMachineSound(block.dimension, block.location, open ? "potClose" : "potOpen", 0.6);
}

// ---------------------------------------------------------------------------------------------
// Pratos temperados: efeitos ao comer

/**
 * Ao terminar de comer/beber um prato temperado: efeitos de poção (SinisterTeaItem → MOB_EFFECTS) e
 * `foodData.add(FOOD)` (PonigiriItem). Se a frente itens já achou dados na dynamic property
 * `cobblemon:food_data` (pilha de 1), ela cuida e aqui não se faz nada.
 */
export function applySeasonedFood(player: Player, stack: ItemStack) {
  if (readFoodData(stack)) return;
  let lore: RawMessage[] = [];
  try { lore = stack.getRawLore(); }
  catch { return; }
  const data = seasonedDataFromLore(stack.typeId, lore);
  if (!data) return;
  for (const e of data.mobEffects ?? []) {
    // Efeitos do Cobblemon (limpeza, mental_restoration): frente dados-ui, scripts/events/MobEffects.ts.
    if (applyCobblemonMobEffect(player, e)) continue;
    try { player.addEffect(e.effect, Math.max(1, e.duration), { amplifier: e.amplifier }); }
    catch { /* efeito inexistente no Bedrock */ }
  }
  if (data.food && (data.food.hunger || data.food.saturation)) addFood(player, data.food.hunger, data.food.saturation);
}

// ---------------------------------------------------------------------------------------------
// Poções do Cobblemon no suporte de poções

interface BrewingState {
  fuel: number;
  recipe?: string;
  count?: number;
  progress?: number;
  results?: SlotItem;
}
const brewingStore = new MachineStore<BrewingState>("brewing");

/** A mão tem algo que abre a tela de poções do Cobblemon? */
export function isCobblemonBrewingItem(id: string | undefined): boolean {
  // Ingredientes/frascos vanilla (glass_bottle, dragon_breath...) continuam no suporte vanilla.
  return !!id?.startsWith("cobblemon:") && (isBrewingInput(id) || isBrewingBottle(id));
}

function inventoryIds(player: Player): Map<string, number> {
  const out = new Map<string, number>();
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return out;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it) out.set(it.typeId, (out.get(it.typeId) ?? 0) + it.amount);
  }
  return out;
}

/** Receitas possíveis com o inventário: [receita, ingrediente, frasco]. */
function craftableBrews(inv: Map<string, number>): { recipe: BrewingRecipe; input: string; bottle: string }[] {
  const out: { recipe: BrewingRecipe; input: string; bottle: string }[] = [];
  for (const input of inv.keys()) for (const bottle of inv.keys()) {
    const recipe = findBrewingRecipe(input, bottle);
    if (recipe && !out.some(o => o.recipe.id === recipe.id)) out.push({ recipe, input, bottle });
  }
  return out;
}

export async function openBrewing(player: Player, block: Block) {
  const key = blockKey(block.dimension.id, block.location);
  const state = brewingStore.get(key) ?? { fuel: 0 };
  if (state.results) {
    giveSlotItem(player, state.results);
    state.results = undefined;
    brewingStore.set(key, state);
    return;
  }
  if (state.progress !== undefined) {
    player.onScreenDisplay.setActionBar(tr(MK.brewingBrewing, `${Math.floor(state.progress * 100 / BREWING_TICKS)}%`));
    return;
  }
  const options = craftableBrews(inventoryIds(player));
  const form = new ActionFormData().title(tr(MK.brewingTitle)).body(options.length ? tr(MK.brewingFuel, `${state.fuel}`) : tr(MK.brewingNone));
  for (const o of options) form.button({ rawtext: [itemNameOf(o.input), { text: " + " }, itemNameOf(o.bottle), { text: " → " }, itemNameOf(o.recipe.result.item)] });
  const res = await form.show(player);
  if (res.selection === undefined || !options[res.selection]) return;
  const o = options[res.selection];
  const fresh = brewingStore.get(key) ?? { fuel: 0 };
  if (fresh.progress !== undefined) return;
  if (fresh.fuel <= 0) {
    if (!isCreative(player) && removeFromInventory(player, "minecraft:blaze_powder", 1) < 1) {
      player.sendMessage(tr(MK.brewingFuel, "0"));
      return;
    }
    fresh.fuel = BLAZE_POWDER_USES;
  }
  const inv = inventoryIds(player);
  const count = Math.min(3, inv.get(o.bottle) ?? 0);
  if (count < 1 || (inv.get(o.input) ?? 0) < 1) return;
  if (!isCreative(player)) {
    removeFromInventory(player, o.input, 1);
    removeFromInventory(player, o.bottle, count);
  }
  fresh.fuel--;
  fresh.recipe = o.recipe.id;
  fresh.count = count;
  fresh.progress = 0;
  brewingStore.set(key, fresh);
  playMachineSound(block.dimension, block.location, "brewing", 0.5);
}

export function tickBrewing(ticks: number) {
  for (const key of brewingStore.keys()) {
    const state = brewingStore.get(key);
    if (!state || state.progress === undefined) continue;
    const { dimension, location } = parseBlockKey(key);
    const dim = dimensionById(dimension);
    const block = dim && loadedBlock(dim, location);
    if (!block) continue;
    if (block.typeId !== "minecraft:brewing_stand") { onBrewingStandRemoved(dim!, key); continue; }
    state.progress += ticks;
    if (state.progress >= BREWING_TICKS) {
      const recipe = BREWING_RECIPES_BY_ID().get(state.recipe ?? "");
      if (recipe) state.results = { id: recipe.result.item, n: recipe.result.count * (state.count ?? 1) };
      state.progress = undefined;
      state.recipe = undefined;
      playMachineSound(dim!, location, "brewing");
    }
    brewingStore.set(key, state);
  }
}

export function onBrewingStandRemoved(dimension: Dimension, key: string) {
  const state = brewingStore.get(key);
  brewingStore.delete(key);
  if (state?.results) dropSlotItem(dimension, parseBlockKey(key).location, state.results);
}

let brewingById: Map<string, BrewingRecipe> | undefined;
function BREWING_RECIPES_BY_ID(): Map<string, BrewingRecipe> {
  brewingById ??= new Map(BREWING_RECIPES.map(r => [r.id, r]));
  return brewingById;
}

/** O suporte tem poção do Cobblemon em preparo ou pronta (a interação vai para a tela própria). */
export function hasPendingBrew(block: Block): boolean {
  const state = brewingStore.get(blockKey(block.dimension.id, block.location));
  return !!state && (state.progress !== undefined || !!state.results);
}

export { toItemStack };
