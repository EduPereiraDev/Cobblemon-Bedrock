/**
 * Máquina de TMs (TMMachineBlockEntity/TMMachineMenu do Cobblemon 1.8.2) e utilidades de TM.
 *
 * - O golpe de um TM fica na lore bruta do item (`cobblemon.port.tm.move` com [nome traduzido, id]), no formato
 *   de scripts/items/tm.ts (frente itens), que também ensina o golpe ao usar o TM.
 * - TMs disponíveis: os "default" + os aprendidos (TMMoveManager): golpes acessíveis dos Pokémon do jogador e
 *   TMs lidos num monitor. Guardados na dynamic property `cobblemon:tms` do jogador.
 * - Sem slots de GUI no Bedrock: ao gravar, a máquina tira do inventário o Blank TM e os ingredientes da
 *   receita (até 3, getClampedRecipe) e devolve o TM pronto no próximo clique.
 */
import { Block, ItemStack, Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { TECHNICAL_MACHINES, TMDef, TMIngredientDef } from "./data";
import { blockKey, MachineStore, parseBlockKey } from "./store";
import { countInInventory, dropAt, giveOrDrop, isCreative, itemHasTag, itemNameOf, removeFromInventory } from "./itemUtil";
import { dimensionById, getState, keepMachineLoop, MK, playMachineSound, setState, stopMachineLoop, tr } from "./common";
import { getSafeTeam } from "../pokemonStorage";
import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";
import { getTMMove as getItemTMMove, parseTMMove, setTMMove } from "../items/tm";

export { setTMMove };

export const TM_ITEM = "cobblemon:technical_machine";
export const BLANK_TM = "cobblemon:blank_tm";
const LEARNED_PROPERTY = "cobblemon:tms";

// Tempos do TMMachineBlockEntity (em ticks): queima 200 a 2/tick, grava no 10º tick depois e volta no 14º.
const BURN_TICKS = 100;
const CRAFT_AT = BURN_TICKS + 10;
const TOTAL_TICKS = BURN_TICKS + 14;

/** TM com o golpe (formato de lore da frente itens, scripts/items/tm.ts). */
export function createTMStack(move: string, amount = 1): ItemStack {
  return setTMMove(new ItemStack(TM_ITEM, amount), move);
}

/** Golpe gravado num TM e o tipo do TM (data/cobblemon/tms), ou undefined. */
export function getTMMove(stack: ItemStack | undefined): { move: string; type: string } | undefined {
  return tmInfo(getItemTMMove(stack));
}

/** Golpe da lore bruta (mesmo formato de scripts/items/tm.ts). */
export function tmMoveFromLore(lore: readonly RawMessage[]): { move: string; type: string } | undefined {
  return tmInfo(parseTMMove([...lore]));
}

function tmInfo(move: string | undefined) {
  return move && TECHNICAL_MACHINES[move] ? { move, type: TECHNICAL_MACHINES[move].type } : undefined;
}

// ---------------------------------------------------------------------------------------------
// TMs aprendidos

export function getLearnedTMs(player: Player): Set<string> {
  const raw = player.getDynamicProperty(LEARNED_PROPERTY);
  try { return new Set(typeof raw === "string" ? JSON.parse(raw) as string[] : []); }
  catch { return new Set(); }
}

function saveLearned(player: Player, learned: Set<string>) {
  player.setDynamicProperty(LEARNED_PROPERTY, JSON.stringify([...learned]));
}

/** TechnicalMachine.isPassivelyObtained. */
export function isDefaultTM(move: string): boolean {
  return TECHNICAL_MACHINES[move]?.default ?? false;
}

/** TMMoveManager.learn: devolve os que eram novos. Avisa (unlock_tm) os não-default. */
export function learnTMs(player: Player, moves: Iterable<string>, notify = true): string[] {
  const learned = getLearnedTMs(player);
  const added: string[] = [];
  for (const move of moves) {
    if (!TECHNICAL_MACHINES[move] || learned.has(move)) continue;
    learned.add(move);
    added.push(move);
  }
  if (!added.length) return added;
  saveLearned(player, learned);
  if (notify) {
    if (added.length === 1 && !isDefaultTM(added[0])) player.sendMessage(tr("cobblemon.tms.unlock_tm", { translate: `cobblemon.move.${added[0]}` }));
    else if (added.some(m => !isDefaultTM(m))) player.sendMessage(tr("cobblemon.tms.new_tms_learned"));
  }
  return added;
}

export function unlockTM(player: Player, move: string) {
  learnTMs(player, [move]);
}

/** PlayerTMData.unlearn (`/technicalmachine lock`; frente dados-ui): devolve quantos saíram. Sem aviso, como no Cobblemon. */
export function unlearnTMs(player: Player, moves: Iterable<string>): number {
  const learned = getLearnedTMs(player);
  let removed = 0;
  for (const move of moves) if (learned.delete(move)) removed++;
  if (removed) saveLearned(player, learned);
  return removed;
}

/** getLearnableTMsFromPokemon: golpes acessíveis (nível até o atual, guardados e moveset) que têm TM. */
export function learnableTMsFromPokemon(pokemon: PokemonData): string[] {
  let moves: string[] = [];
  try { moves = pokemon.getAccessibleMoves(); }
  catch { moves = pokemon.moves ?? []; }
  return moves.filter(m => !!TECHNICAL_MACHINES[m]);
}

/** Sincroniza pelos Pokémon do time (o PC entra aos poucos por syncTMsFromPokemon ao depositar/abrir). */
export function syncTMsFromParty(player: Player) {
  const moves = new Set<string>();
  for (const p of getSafeTeam(player)) if (p) learnableTMsFromPokemon(p).forEach(m => moves.add(m));
  learnTMs(player, moves);
}

/** TechnicalMachine.filterTms (sem busca de texto): default ou aprendido; tipo e "o Pokémon pode aprender". */
export function availableTMs(learned: ReadonlySet<string>, filter: { type?: string; canLearn?: (move: string) => boolean; search?: string; includeUnlearned?: boolean } = {}): string[] {
  // TMMachineScreen: `includeUnlearned = unlockAllMoveDexMovesByDefault` (frente dados-ui).
  let includeUnlearned = filter.includeUnlearned;
  if (includeUnlearned === undefined) { try { includeUnlearned = getConfig().unlockAllMoveDexMovesByDefault === true; } catch { includeUnlearned = false; } }
  return Object.keys(TECHNICAL_MACHINES).filter(move => {
    const tm = TECHNICAL_MACHINES[move];
    if (!tm.default && !learned.has(move) && !includeUnlearned) return false;
    if (filter.type && tm.type !== filter.type) return false;
    if (filter.search && !move.includes(filter.search.toLowerCase().replace(/[^a-z0-9]/g, ""))) return false;
    if (filter.canLearn && !filter.canLearn(move)) return false;
    return true;
  }).sort();
}

/** Ingrediente atende (item ou tag). */
export function ingredientMatches(ing: TMIngredientDef, id: string): boolean {
  return ing.item ? ing.item === id : !!ing.tag && itemHasTag(id, ing.tag);
}

/** getClampedRecipe(3). */
export function clampedRecipe(tm: TMDef): TMIngredientDef[] {
  return tm.recipe.slice(0, 3);
}

/**
 * Falta algo para gravar? `inventory` = contagem por id. Devolve a lista de ingredientes faltando
 * (inclui o Blank TM).
 */
export function missingForTM(move: string, inventory: ReadonlyMap<string, number>): { ingredient: TMIngredientDef; have: number }[] {
  const tm = TECHNICAL_MACHINES[move];
  if (!tm) return [];
  const needs: TMIngredientDef[] = [{ item: BLANK_TM, count: 1 }, ...clampedRecipe(tm)];
  const missing: { ingredient: TMIngredientDef; have: number }[] = [];
  for (const ing of needs) {
    let have = 0;
    for (const [id, n] of inventory) if (ingredientMatches(ing, id)) have += n;
    if (have < ing.count) missing.push({ ingredient: ing, have });
  }
  return missing;
}

function inventoryCounts(player: Player): Map<string, number> {
  const counts = new Map<string, number>();
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return counts;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item) counts.set(item.typeId, (counts.get(item.typeId) ?? 0) + item.amount);
  }
  return counts;
}

function takeIngredient(player: Player, ing: TMIngredientDef) {
  if (ing.item) { removeFromInventory(player, ing.item, ing.count); return; }
  let left = ing.count;
  for (const [id] of inventoryCounts(player)) {
    if (left <= 0) break;
    if (ingredientMatches(ing, id)) left -= removeFromInventory(player, id, left);
  }
}

// ---------------------------------------------------------------------------------------------
// Bloco

interface TMMachineState {
  move?: string;
  /** Ticks desde o início (0..TOTAL_TICKS). */
  progress?: number;
  /** TMs prontos esperando retirada. */
  result?: { move: string; count: number };
}

export const tmStore = new MachineStore<TMMachineState>("tm_machine");

function ingredientName(ing: TMIngredientDef): RawMessage {
  return ing.item ? itemNameOf(ing.item) : { text: `#${ing.tag}` };
}

function moveName(move: string): RawMessage {
  return { translate: `cobblemon.move.${move}` };
}

function applyVisuals(block: Block, state: TMMachineState) {
  const active = state.progress !== undefined;
  setState(block, "cobblemon:active", active);
  setState(block, "cobblemon:empty", !(active && (state.progress ?? 0) < CRAFT_AT));
  setState(block, "cobblemon:dispensed", !!state.result);
}

export async function openTMMachine(player: Player, block: Block) {
  if (player.isSneaking) {
    // Agachado: abre/fecha a tampa (TMMachineBlock.useWithoutItem).
    const open = getState<boolean>(block, "cobblemon:open") ?? false;
    setState(block, "cobblemon:open", !open);
    playMachineSound(block.dimension, block.location, open ? "tmClose" : "tmOpen");
    return;
  }
  const key = blockKey(block.dimension.id, block.location);
  const state = tmStore.get(key) ?? {};
  if (state.result) {
    giveOrDrop(player, createTMStack(state.result.move, state.result.count));
    state.result = undefined;
    tmStore.set(key, state.progress === undefined ? undefined : state);
    applyVisuals(block, state);
    // TMMachineScreen: tirar o TM pronto do espaço de resultado.
    playMachineSound(block.dimension, block.location, "tmRetrieve");
    return;
  }
  if (state.progress !== undefined) {
    player.onScreenDisplay.setActionBar(tr(MK.tmBusy, moveName(state.move!), `${Math.floor(state.progress * 100 / TOTAL_TICKS)}%`));
    return;
  }
  syncTMsFromParty(player);
  const move = await chooseTM(player);
  if (!move || !block.isValid || block.typeId !== "cobblemon:tm_machine") return;
  // Relê: com a tela aberta outro jogador pode ter começado a gravar ou deixado TMs prontos (não sobrescreve).
  const current = tmStore.get(key);
  if (current?.progress !== undefined || current?.result) return;
  const missing = isCreative(player) ? [] : missingForTM(move, inventoryCounts(player));
  if (missing.length) {
    player.sendMessage(tr(MK.tmMissing, moveName(move), { rawtext: missing.flatMap((m, i) => [...(i ? [{ text: ", " }] : []), { text: `${m.have}/${m.ingredient.count} ` }, ingredientName(m.ingredient)]) }));
    return;
  }
  if (!isCreative(player)) {
    removeFromInventory(player, BLANK_TM, 1);
    for (const ing of clampedRecipe(TECHNICAL_MACHINES[move])) takeIngredient(player, ing);
  }
  const next: TMMachineState = { move, progress: 0 };
  tmStore.set(key, next);
  applyVisuals(block, next);
  playStartSounds(block, clampedRecipe(TECHNICAL_MACHINES[move]).length > 0);
}

/**
 * Sons do início (TMMachineScreen): Blank TM no espaço (tm_insert), ingredientes (item_insert) e a queima
 * começando (start). Sem slots no Bedrock, os três tocam em sequência.
 */
function playStartSounds(block: Block, hasIngredients: boolean) {
  const { dimension, location } = block;
  playMachineSound(dimension, location, "tmInsert");
  if (hasIngredients) system.runTimeout(() => playMachineSound(dimension, location, "tmItemInsert"), 4);
  system.runTimeout(() => playMachineSound(dimension, location, "tmStart"), hasIngredients ? 8 : 4);
}

/** TMMachineBlock.fallOn: uma entidade caindo em cima da máquina aberta fecha a tampa. */
export function closeTMLidOnFall(block: Block) {
  if (!(getState<boolean>(block, "cobblemon:open") ?? false)) return;
  setState(block, "cobblemon:open", false);
  playMachineSound(block.dimension, block.location, "tmClose");
}

async function chooseTM(player: Player): Promise<string | undefined> {
  let filter: { type?: string; search?: string; party?: boolean } = {};
  const TYPES = ["", "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
  const party = getSafeTeam(player).filter((p): p is PokemonData => !!p);
  while (true) {
    const learned = getLearnedTMs(player);
    const canLearn = filter.party ? (move: string) => party.some(p => {
      try { return p.getMoveSources(move).some(s => s === "tm" || s === "tutor" || s === "egg"); }
      catch { return false; }
    }) : undefined;
    const moves = availableTMs(learned, { type: filter.type, search: filter.search, canLearn }).slice(0, 120);
    const form = new ActionFormData().title({ translate: "cobblemon.container.tm_machine" }).body(moves.length ? tr(MK.tmChooseMove) : tr(MK.tmNone));
    form.button(tr(MK.tmSearch));
    for (const move of moves) {
      const tm = TECHNICAL_MACHINES[move];
      form.button({ rawtext: [moveName(move), { text: `\n§8${tm.type}` }] });
    }
    const res = await form.show(player);
    if (res.selection === undefined) return undefined;
    if (res.selection === 0) {
      const modal = await new ModalFormData()
        .title(tr(MK.tmSearch))
        .textField(tr(MK.tmSearch), "", { defaultValue: filter.search ?? "" })
        .dropdown(tr(MK.tmType), TYPES.map(t => t ? { translate: `cobblemon.type.${t}` } : { text: "-" }), { defaultValueIndex: Math.max(0, TYPES.indexOf(filter.type ?? "")) })
        .toggle(tr(MK.tmFilterParty), { defaultValue: !!filter.party })
        .show(player);
      if (modal.formValues) filter = { search: String(modal.formValues[0] ?? "") || undefined, type: TYPES[Number(modal.formValues[1])] || undefined, party: !!modal.formValues[2] };
      continue;
    }
    return moves[res.selection - 1];
  }
}

/** Avança as máquinas em processo. */
export function tickTMMachines(ticks: number, getBlock: (key: string) => Block | undefined) {
  for (const key of tmStore.keys()) {
    const state = tmStore.get(key);
    if (!state || state.progress === undefined) continue;
    const block = getBlock(key);
    if (!block) continue;
    if (block.typeId !== "cobblemon:tm_machine") {
      // A máquina sumiu sem o evento de quebra: devolve TMs prontos/materiais como na quebra normal.
      const { dimension, location } = block;
      onTMMachineRemoved(dimension.id, key, stack => dropAt(dimension, location, stack));
      continue;
    }
    const before = state.progress;
    state.progress = Math.min(TOTAL_TICKS, before + ticks);
    // Laço da queima (TMMachineBlockEntity.clientTick: burn_loop enquanto BURN_ACTIVE).
    if (state.progress < BURN_TICKS) keepMachineLoop(block.dimension, block.location, key, "tmBurn", system.currentTick);
    else stopMachineLoop(block.dimension, block.location, key, "tmBurn");
    if (before < CRAFT_AT && state.progress >= CRAFT_AT && state.move) {
      state.result = { move: state.move, count: (state.result?.move === state.move ? state.result.count : 0) + 1 };
      playMachineSound(block.dimension, block.location, "tmCraft");
    }
    if (state.progress >= TOTAL_TICKS) {
      state.progress = undefined;
      state.move = undefined;
    }
    tmStore.set(key, state);
    applyVisuals(block, state);
  }
}

/** Quebra: devolve o TM pronto (ou os materiais, se ainda não gravou). */
export function onTMMachineRemoved(dimensionId: string, key: string, drop: (stack: ItemStack) => void) {
  const state = tmStore.get(key);
  tmStore.delete(key);
  if (!state) return;
  const dim = dimensionById(dimensionId);
  if (dim) stopMachineLoop(dim, parseBlockKey(key).location, key, "tmBurn");
  if (state.result) drop(createTMStack(state.result.move, state.result.count));
  if (state.progress !== undefined && state.progress < CRAFT_AT && state.move) {
    drop(new ItemStack(BLANK_TM, 1));
    for (const ing of clampedRecipe(TECHNICAL_MACHINES[state.move])) if (ing.item) drop(new ItemStack(ing.item, ing.count));
  }
}

export { countInInventory };
