/**
 * Comidas com efeito (`cobblemon:food_effect`): Aprijuice, Ponigiri, Sinister Tea e Vivichoke Dip.
 *
 * Cobblemon 1.8.2:
 * - Aprijuice sem bônus de montaria (`RIDE_BOOST`) é bebida: `foodData.eat(4, 1.2)`. Com bônus (do
 *   Campfire Pot) é dado a um Pokémon; montaria ainda não existe no port, então só a bebida vale.
 * - Ponigiri: comida base 2 / 0.55 e, se tiver o componente `FOOD` do Campfire Pot, `foodData.add(hunger, saturation)`.
 * - Sinister Tea: bebida (vira tigela) que aplica os `MOB_EFFECTS` dos temperos do Campfire Pot.
 * - Vivichoke Dip: comida 10 / 0.6, vira tigela, limpa todos os efeitos e dá Absorção I por 45 s.
 *
 * Dados do Campfire Pot no ItemStack: dynamic property `cobblemon:food_data` (JSON `FoodData`). Só funciona em
 * pilha de 1 (limitação do Bedrock); sem ela vale o comportamento do item sem temperos.
 */
import { GameMode, ItemStack, Player } from "@minecraft/server";
import { applyCobblemonMobEffect } from "../events/MobEffects";

export const FOOD_DATA_PROPERTY = "cobblemon:food_data";

export interface FoodMobEffect {
  /** Efeito (id Java/Bedrock, com ou sem "minecraft:"). */
  effect: string;
  /** Duração em ticks. */
  duration: number;
  amplifier?: number;
}

/** Dados de temperos gravados pelo Campfire Pot (FoodComponent + MobEffectsComponent + RideBoostsComponent). */
export interface FoodData {
  hunger?: number;
  saturation?: number;
  mobEffects?: FoodMobEffect[];
  rideBoosts?: Record<string, number>;
}

/** Comida base de cada item (para quando o JSON do item ainda não tem `minecraft:food`). */
interface BaseFood {
  nutrition: number;
  saturationModifier: number;
  convertsTo?: string;
}
const BASE_FOOD: Record<string, BaseFood> = {
  aprijuice: { nutrition: 4, saturationModifier: 1.2 },
  ponigiri: { nutrition: 2, saturationModifier: 0.55 },
  sinister_tea: { nutrition: 0, saturationModifier: 0, convertsTo: "minecraft:bowl" },
  vivichoke_dip: { nutrition: 10, saturationModifier: 0.6, convertsTo: "minecraft:bowl" },
};

/** Vivichoke Dip: `MobEffectInstance(MobEffects.ABSORPTION, 900, 0)`. */
const VIVICHOKE_ABSORPTION = { effect: "absorption", duration: 900, amplifier: 0 };

/** "cobblemon:aprijuice_red" → "aprijuice"; "cobblemon:ponigiri" → "ponigiri". */
export function foodKind(typeId: string): string | undefined {
  const id = typeId.replace(/^cobblemon:/, "");
  if (id.startsWith("aprijuice_")) return "aprijuice";
  return BASE_FOOD[id] ? id : undefined;
}

/** Lê os temperos gravados no item, se houver. */
export function readFoodData(stack: ItemStack | undefined): FoodData | undefined {
  if (!stack) return undefined;
  try {
    const raw = stack.getDynamicProperty(FOOD_DATA_PROPERTY);
    if (typeof raw !== "string") return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as FoodData : undefined;
  } catch {
    return undefined;
  }
}

/** Saturação do `FoodData.eat(nutrition, modifier)` do Java: nutrition × modifier × 2. */
export function saturationFor(nutrition: number, saturationModifier: number): number {
  return nutrition * saturationModifier * 2;
}

/** `FoodData.add`: fome até 20; saturação até a fome atual. */
export function addFood(player: Player, hunger: number, saturation: number) {
  try {
    const hungerComponent = player.getComponent("minecraft:player.hunger");
    const saturationComponent = player.getComponent("minecraft:player.saturation");
    if (!hungerComponent || !saturationComponent) return;
    const food = Math.min(hungerComponent.effectiveMax, Math.max(0, hungerComponent.currentValue + hunger));
    hungerComponent.setCurrentValue(food);
    saturationComponent.setCurrentValue(Math.min(food, Math.max(0, saturationComponent.currentValue + saturation)));
  } catch (e) {
    console.warn(`Não foi possível alimentar ${player.name}: ${e}`);
  }
}

function applyMobEffect(player: Player, effect: FoodMobEffect) {
  // cobblemon:cleanse_negative / cleanse_all / mental_restoration (frente dados-ui, scripts/events/MobEffects.ts).
  if (applyCobblemonMobEffect(player, effect)) return;
  const id = effect.effect.replace(/^minecraft:/, "");
  try {
    player.addEffect(id, Math.max(1, Math.trunc(effect.duration)), { amplifier: Math.max(0, Math.trunc(effect.amplifier ?? 0)) });
  } catch {
    // Efeito do Java sem equivalente no Bedrock: ignora.
  }
}

function clearEffects(player: Player) {
  for (const effect of player.getEffects()) {
    try { player.removeEffect(effect.typeId); } catch { }
  }
}

/**
 * Efeitos extras depois de comer/beber (onConsume). A fome/saturação base já veio do componente
 * `minecraft:food` do item.
 */
export function applyFoodEffect(player: Player, stack: ItemStack) {
  const kind = foodKind(stack.typeId);
  if (!kind) return;
  const data = readFoodData(stack);
  switch (kind) {
    case "ponigiri":
      if (data && (data.hunger || data.saturation)) addFood(player, data.hunger ?? 0, data.saturation ?? 0);
      break;
    case "sinister_tea":
      data?.mobEffects?.forEach(effect => applyMobEffect(player, effect));
      break;
    case "vivichoke_dip":
      // finishUsingItem: removeAllEffects() e depois o efeito da comida (Absorção).
      clearEffects(player);
      applyMobEffect(player, VIVICHOKE_ABSORPTION);
      break;
    case "aprijuice":
      // Sem montaria no port: a Aprijuice é só bebida (fome/saturação do componente de comida).
      break;
  }
}

/**
 * Item sem `minecraft:food` no JSON (onUse): come na hora, aplicando a comida base, os efeitos e
 * gastando o item. Com o componente de comida, não faz nada (o onConsume cuida).
 * @returns Verdadeiro se consumiu.
 */
export function consumeWithoutFoodComponent(player: Player, stack: ItemStack): boolean {
  const kind = foodKind(stack.typeId);
  if (!kind) return false;
  try { if (stack.getComponent("minecraft:food")) return false; } catch { }
  const base = BASE_FOOD[kind];
  addFood(player, base.nutrition, saturationFor(base.nutrition, base.saturationModifier));
  applyFoodEffect(player, stack);
  let creative = false;
  try { creative = player.getGameMode() === GameMode.Creative; } catch { }
  if (!creative) {
    const container = player.getComponent("minecraft:inventory")?.container;
    const slot = container?.getSlot(player.selectedSlotIndex);
    const held = slot?.hasItem() ? slot.getItem() : undefined;
    if (slot && held && held.typeId === stack.typeId) {
      if (held.amount > 1) slot.amount = held.amount - 1;
      else slot.setItem(undefined);
    }
    if (base.convertsTo) {
      const leftover = container?.addItem(new ItemStack(base.convertsTo, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
    }
  }
  player.playSound(kind === "ponigiri" || kind === "vivichoke_dip" ? "random.eat" : "random.drink");
  return true;
}
