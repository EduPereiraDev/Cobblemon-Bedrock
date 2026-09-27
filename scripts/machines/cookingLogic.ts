/**
 * Regras da panela de fogueira (CampfireBlockEntity / CookingPotRecipe / SeasoningProcessor do Cobblemon 1.8.2)
 * e do suporte de poções do Cobblemon (receitas brewing_stand), sem API do Minecraft.
 *
 * Os dados de tempero ficam na lore bruta do item cozido: uma linha `cobblemon.port.cooking.seasoned_with`
 * por tempero, com [nome traduzido, id]. Tudo o mais (sabores, cor, efeitos de isca, efeitos de poção,
 * comida extra e bônus de montaria) é recalculado a partir desses ids e do id do item.
 */
import type { RawMessage } from "@minecraft/server";
import { BREWING_RECIPES, BrewingRecipe, COOKING_POT_RECIPES, CookingPotRecipe, RecipeOption } from "../../generated/scripts/recipes";
import { ITEMS } from "../../generated/scripts/items";
import { APRIJUICE_FLAVOUR_THRESHOLDS, MobEffectDef, SEASONINGS, SeasoningDef } from "./data";
import { isFishingBait } from "../fishing/BaitEffects";
import { itemHasTag, itemNameOf, matchesAny, matchesOption } from "./itemUtil";

export const GRID_SIZE = 9;
export const SEASONING_SLOTS = 3;
/** COOKING_TOTAL_TIME 200 a COOKING_PROGRESS_PER_TICK 2 = 100 ticks por prato. */
export const COOKING_TICKS = 100;
/** Suporte de poções vanilla: 400 ticks; 1 blaze powder = 20 usos. */
export const BREWING_TICKS = 400;
export const BLAZE_POWDER_USES = 20;

export const SEASONED_LORE_KEY = "cobblemon.port.cooking.seasoned_with";

// ---------------------------------------------------------------------------------------------
// Temperos

/** Tempero de um item: data/cobblemon/seasonings ou, para berries, sabores e cor de ITEMS[berry].berry. */
export function seasoningFor(id: string): SeasoningDef | undefined {
  const direct = SEASONINGS[id];
  if (direct) return direct;
  if (!id.startsWith("cobblemon:")) return undefined;
  const berry = ITEMS[id.slice("cobblemon:".length)]?.berry as { flavours?: Record<string, number>; colour?: string } | undefined;
  if (!berry) return undefined;
  return { colour: (berry.colour ?? "white").toLowerCase(), flavours: berry.flavours ?? {}, food: { hunger: 0, saturation: 0 } };
}

export function isSeasoning(id: string): boolean {
  return !!seasoningFor(id);
}

/** O item aparece em alguma receita da panela (chave de receita com forma ou ingrediente sem forma). */
export function isCookingIngredient(id: string, recipes: readonly CookingPotRecipe[] = COOKING_POT_RECIPES): boolean {
  return recipes.some(r => [...Object.values(r.key ?? {}), ...(r.ingredients ?? [])].some(options => matchesAny(id, options)));
}

/** Os temperos que entram na receita (os que têm a seasoningTag). */
export function seasoningsForRecipe(recipe: CookingPotRecipe, seasonings: readonly (string | null | undefined)[]): string[] {
  const tag = recipe.seasoningTag;
  if (!tag || tag === "cobblemon:empty") return [];
  return seasonings.filter((s): s is string => !!s && itemHasTag(s, tag));
}

/** SeasoningProcessor.consumesItem de algum processador da receita. */
export function seasoningConsumed(recipe: CookingPotRecipe, id: string): boolean {
  if (!recipe.seasoningTag || !itemHasTag(id, recipe.seasoningTag)) return false;
  const s = seasoningFor(id);
  if (!s) return false;
  return recipe.seasoningProcessors.some(p => {
    switch (p) {
      case "ride_boosts": case "flavour": return !!s.flavours && Object.keys(s.flavours).length > 0;
      case "spawn_bait": return hasBaitEffects(id);
      case "food": return !!s.food;
      case "mob_effects": return !!s.mobEffects;
      case "food_colour": case "ingredient": return true;
      default: return false;
    }
  });
}

/** O item é isca (tem registro em spawn_bait_effects, via frente pesca) ou tempero com baitEffects. */
export function hasBaitEffects(id: string): boolean {
  return isFishingBait(id) || !!seasoningFor(id)?.baitEffects?.length;
}

// ---------------------------------------------------------------------------------------------
// Receitas

interface Trimmed { w: number; h: number; cells: (string | null)[] }

/** CraftingInput.of: recorta linhas/colunas vazias da grade 3×3. */
export function trimGrid(grid: readonly (string | null | undefined)[], width = 3, height = 3): Trimmed {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!grid[y * width + x]) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return { w: 0, h: 0, cells: [] };
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const cells: (string | null)[] = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push(grid[y * width + x] ?? null);
  return { w, h, cells };
}

function trimPattern(pattern: readonly string[]): { w: number; h: number; rows: string[] } {
  const w0 = Math.max(0, ...pattern.map(r => r.length));
  const rows = pattern.map(r => r.padEnd(w0, " "));
  const filled = (s: string) => s.trim().length > 0;
  let top = 0, bottom = rows.length - 1;
  while (top <= bottom && !filled(rows[top])) top++;
  while (bottom >= top && !filled(rows[bottom])) bottom--;
  const body = rows.slice(top, bottom + 1);
  let left = 0, right = w0 - 1;
  const colFilled = (x: number) => body.some(r => r[x] !== " ");
  while (left <= right && !colFilled(left)) left++;
  while (right >= left && !colFilled(right)) right--;
  return { w: right - left + 1, h: body.length, rows: body.map(r => r.slice(left, right + 1)) };
}

/** ShapedRecipePattern.matches (com espelho horizontal). */
export function matchesShaped(recipe: CookingPotRecipe, grid: readonly (string | null | undefined)[]): boolean {
  if (!recipe.shaped || !recipe.pattern || !recipe.key) return false;
  const input = trimGrid(grid);
  const pattern = trimPattern(recipe.pattern);
  if (input.w !== pattern.w || input.h !== pattern.h) return false;
  const check = (mirror: boolean) => {
    for (let y = 0; y < pattern.h; y++) for (let x = 0; x < pattern.w; x++) {
      const ch = pattern.rows[y][mirror ? pattern.w - 1 - x : x];
      const cell = input.cells[y * input.w + x];
      if (ch === " ") { if (cell) return false; continue; }
      if (!cell || !matchesAny(cell, recipe.key![ch] ?? [])) return false;
    }
    return true;
  };
  return check(false) || check(true);
}

/** ShapelessRecipe.matches: cada ingrediente casa com exatamente um item (sem sobras). */
export function matchesShapeless(recipe: CookingPotRecipe, grid: readonly (string | null | undefined)[]): boolean {
  if (recipe.shaped || !recipe.ingredients) return false;
  const items = grid.filter((x): x is string => !!x);
  const ings = recipe.ingredients;
  if (items.length !== ings.length) return false;
  const used = new Array<boolean>(items.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === ings.length) return true;
    for (let j = 0; j < items.length; j++) {
      if (used[j] || !ings[i].some(o => matchesOption(items[j], o))) continue;
      used[j] = true;
      if (assign(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

/** getRecipeFor(COOKING_POT_COOKING) e depois COOKING_POT_SHAPELESS. */
export function findCookingRecipe(grid: readonly (string | null | undefined)[], recipes: readonly CookingPotRecipe[] = COOKING_POT_RECIPES): CookingPotRecipe | undefined {
  return recipes.find(r => r.shaped && matchesShaped(r, grid)) ?? recipes.find(r => !r.shaped && matchesShapeless(r, grid));
}

// ---------------------------------------------------------------------------------------------
// Resultado temperado

export interface SeasonedData {
  /** Ids dos temperos aplicados (IngredientComponent / fonte de todo o resto). */
  seasonings: string[];
  /** FlavourComponent (soma dos sabores). */
  flavours?: Record<string, number>;
  /** FoodColourComponent. */
  colours?: string[];
  /** BaitEffectsComponent (ids dos itens de isca). */
  baits?: string[];
  /** FoodComponent final (FoodSeasoningProcessor). */
  food?: { hunger: number; saturation: number };
  /** MobEffectsComponent mesclado. */
  mobEffects?: MobEffectDef[];
  /** RideBoostsComponent (aprijuice). */
  rideBoosts?: Record<string, number>;
}

/** MobEffectUtils.mergeEffects: maior amplificador; duração 100%/75%/50%/25%... das maiores. */
export function mergeMobEffects(effects: readonly MobEffectDef[]): MobEffectDef[] {
  const groups = new Map<string, MobEffectDef[]>();
  for (const e of effects) {
    let list = groups.get(e.effect);
    if (!list) groups.set(e.effect, list = []);
    list.push(e);
  }
  return [...groups].map(([effect, list]) => {
    const durations = list.map(e => e.duration).sort((a, b) => b - a);
    const duration = Math.ceil(durations.reduce((acc, d, i) => acc + d * (i === 0 ? 1 : i === 1 ? 0.75 : i === 2 ? 0.5 : 0.25), 0));
    return { effect, duration, amplifier: Math.max(...list.map(e => e.amplifier)) };
  });
}

/** FoodUtils.merge. */
export function mergeFood(foods: readonly { hunger: number; saturation: number }[], extraHunger: number, extraSaturation: number) {
  if (!foods.length) return { hunger: 0, saturation: 0 };
  const count = foods.length;
  const hunger = foods.reduce((a, f) => a + f.hunger, 0) + extraHunger;
  const saturation = foods.reduce((a, f) => a + f.saturation, 0) + extraSaturation;
  const mult = count === 1 ? 1 : count === 2 ? 0.8 : count === 3 ? 0.6 : 0.4;
  return { hunger: Math.ceil(hunger * mult), saturation: Math.round(saturation * mult * 100) / 100 };
}

/** Itens cujo `minecraft:food` do Java não está em ITEMS (comida com efeito própria). */
const BASE_FOOD_MODIFIERS: Record<string, [number, number]> = { "cobblemon:ponigiri": [2, 0.55] };

/** DataComponents.FOOD do resultado: nutrição e saturação (= nutrição × modificador × 2). */
export function baseFood(id: string): { hunger: number; saturation: number } {
  const fixed = BASE_FOOD_MODIFIERS[id];
  const food = (ITEMS[id.replace(/^cobblemon:/, "")]?.food ?? {}) as { nutrition?: number; saturation?: number };
  const [nutrition, modifier] = fixed ?? [food.nutrition ?? 0, food.saturation ?? 0];
  return { hunger: nutrition, saturation: Math.round(nutrition * modifier * 2 * 100) / 100 };
}

const RIDING_BY_FLAVOUR: Record<string, string> = { SPICY: "ACCELERATION", DRY: "SKILL", SWEET: "SPEED", SOUR: "STAMINA", BITTER: "JUMP" };
const RIDING_STATS = ["ACCELERATION", "SKILL", "SPEED", "STAMINA", "JUMP"];

/** RideBoostsSeasoningProcessor para um aprijuice. */
export function rideBoostsFor(resultId: string, flavours: Record<string, number>): Record<string, number> | undefined {
  const data = ITEMS[resultId.replace(/^cobblemon:/, "")];
  if (data?.category !== "aprijuice") return undefined;
  const apricorn = (data.statEffects ?? {}) as Record<string, number>;
  const boosts: Record<string, number> = {};
  for (const [flavour, value] of Object.entries(flavours)) {
    const stat = RIDING_BY_FLAVOUR[flavour];
    if (!stat) continue;
    let points = 0;
    for (const [threshold, p] of Object.entries(APRIJUICE_FLAVOUR_THRESHOLDS)) if (value >= Number(threshold)) points = Math.max(points, p);
    boosts[stat] = points;
  }
  for (const stat of RIDING_STATS) if (apricorn[stat]) boosts[stat] = (boosts[stat] ?? 0) + apricorn[stat];
  for (const k of Object.keys(boosts)) if (boosts[k] === 0) delete boosts[k];
  return boosts;
}

/** recipe.applySeasoning: roda os processadores da receita com os temperos filtrados pela tag. */
export function applySeasoning(recipe: CookingPotRecipe, seasonings: readonly string[], filterByTag = true): SeasonedData | undefined {
  const used = filterByTag ? seasoningsForRecipe(recipe, seasonings) : [...seasonings];
  const procs = recipe.seasoningProcessors;
  if (!procs.length) return undefined;
  const defs = used.map(id => ({ id, s: seasoningFor(id)! })).filter(x => x.s);
  const out: SeasonedData = { seasonings: [] };
  const flavours: Record<string, number> = {};
  for (const { s } of defs) for (const [f, v] of Object.entries(s.flavours ?? {})) flavours[f] = (flavours[f] ?? 0) + v;
  for (const p of procs) {
    switch (p) {
      case "ingredient": out.seasonings = defs.map(d => d.id); break;
      case "flavour": out.flavours = flavours; break;
      case "food_colour": out.colours = defs.map(d => d.s.colour); break;
      case "spawn_bait": out.baits = used.filter(hasBaitEffects); break;
      case "mob_effects": {
        const merged = mergeMobEffects(defs.flatMap(d => d.s.mobEffects ?? []));
        if (merged.length) out.mobEffects = merged;
        break;
      }
      case "food": {
        const base = baseFood(recipe.result.item);
        const foods = defs.map(d => d.s.food).filter((f): f is { hunger: number; saturation: number } => !!f);
        out.food = foods.length ? mergeFood(foods, base.hunger, base.saturation) : base;
        break;
      }
      case "ride_boosts": {
        const boosts = rideBoostsFor(recipe.result.item, flavours);
        if (boosts) out.rideBoosts = boosts;
        break;
      }
    }
  }
  // Para a lore guardamos todos os temperos usados (recalculamos o resto a partir deles).
  if (!out.seasonings.length) out.seasonings = defs.map(d => d.id);
  return out;
}

/** Dados de tempero de um item (recalculados dos ids guardados na lore). */
export function seasonedDataFromLore(resultId: string, lore: readonly RawMessage[] | undefined): SeasonedData | undefined {
  const ids = seasoningIdsFromLore(lore);
  if (!ids.length) return undefined;
  const recipe = COOKING_POT_RECIPES.find(r => r.result.item === resultId && r.seasoningProcessors.length);
  if (!recipe) return { seasonings: ids };
  return applySeasoning(recipe, ids, false) ?? { seasonings: ids };
}

export function seasoningIdsFromLore(lore: readonly RawMessage[] | undefined): string[] {
  const ids: string[] = [];
  for (const line of lore ?? []) {
    if (line.translate !== SEASONED_LORE_KEY) continue;
    const w = line.with;
    const args = Array.isArray(w) ? w.map(text => ({ text })) : w?.rawtext ?? [];
    const id = args[1]?.text;
    if (id) ids.push(id);
  }
  return ids;
}

/** Lore do item temperado: uma linha por tempero (a lang mostra só o nome). */
export function seasoningLore(data: SeasonedData | undefined): RawMessage[] | undefined {
  if (!data?.seasonings.length) return undefined;
  return data.seasonings.map(id => ({ translate: SEASONED_LORE_KEY, with: { rawtext: [itemNameOf(id), { text: id }] } }));
}

// ---------------------------------------------------------------------------------------------
// Poções do Cobblemon (receitas brewing_stand)

/** Receita de poção para o ingrediente + frasco. */
export function findBrewingRecipe(input: string, bottle: string, recipes: readonly BrewingRecipe[] = BREWING_RECIPES): BrewingRecipe | undefined {
  return recipes.find(r => matchesAny(input, r.input) && matchesAny(bottle, r.bottle));
}

export function isBrewingInput(id: string): boolean {
  return BREWING_RECIPES.some(r => matchesAny(id, r.input));
}

export function isBrewingBottle(id: string): boolean {
  return BREWING_RECIPES.some(r => matchesAny(id, r.bottle));
}

export function optionItems(options: readonly RecipeOption[]): string[] {
  return options.flatMap(o => "item" in o ? [o.item] : []);
}

export { itemHasTag };
