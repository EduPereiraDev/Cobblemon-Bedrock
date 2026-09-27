/**
 * Regras puras do vaso decorado (DecoratedPotBlock / DecoratedPotBlockEntity / DecoratedPotRecipe do MC 1.21.1),
 * usadas pelo vaso do Cobblemon (`cobblemon:decorated_pot`). Sem API do Minecraft.
 */
import { BRICK, isCobblemonSherd, isPotIngredient, patternIndex } from "./sherds";

export type Dir4 = "north" | "east" | "south" | "west";
export const DIRS4: readonly Dir4[] = ["north", "east", "south", "west"];
const OPPOSITE: Record<Dir4, Dir4> = { north: "south", south: "north", east: "west", west: "east" };
const CW: Record<Dir4, Dir4> = { north: "east", east: "south", south: "west", west: "north" };
const CCW: Record<Dir4, Dir4> = { north: "west", west: "south", south: "east", east: "north" };

/** PotDecorations(back, left, right, front): ids dos itens (tijolo = lado liso). */
export type PotDecorations = [back: string, left: string, right: string, front: string];
export const EMPTY_DECORATIONS: PotDecorations = [BRICK, BRICK, BRICK, BRICK];

/** Normaliza uma lista lida de dados salvos (itens inválidos viram tijolo). */
export function normalizeDecorations(raw: unknown): PotDecorations {
  const list = Array.isArray(raw) ? raw : [];
  return [0, 1, 2, 3].map(i => (typeof list[i] === "string" && isPotIngredient(list[i]) ? list[i] : BRICK)) as PotDecorations;
}

export function isEmptyDecorations(d: PotDecorations): boolean {
  return d.every(i => i === BRICK);
}

/**
 * Direção do vaso: HORIZONTAL_FACING = direção horizontal para onde o jogador olha ao colocar
 * (BlockPlaceContext.getHorizontalDirection). Yaw do Bedrock: 0 = sul, 90 = oeste, ±180 = norte, −90 = leste.
 */
export function facingFromYaw(yaw: number): Dir4 {
  const y = ((yaw % 360) + 360) % 360;
  if (y >= 45 && y < 135) return "west";
  if (y >= 135 && y < 225) return "north";
  if (y >= 225 && y < 315) return "east";
  return "south";
}

/**
 * Item de cada lado do mundo (DecoratedPotRenderer: gira 180° − facing; a frente fica do lado do jogador, a
 * esquerda à esquerda de quem olha para a frente).
 */
export function worldSides(facing: Dir4, d: PotDecorations): Record<Dir4, string> {
  const [back, left, right, front] = d;
  return { [facing]: back, [OPPOSITE[facing]]: front, [CCW[facing]]: left, [CW[facing]]: right } as Record<Dir4, string>;
}

/** Valores das propriedades `cobblemon:face_<lado>` da entidade de exibição. */
export function faceProperties(facing: Dir4, d: PotDecorations): Record<Dir4, number> {
  const sides = worldSides(facing, d);
  const out = {} as Record<Dir4, number>;
  for (const dir of DIRS4) out[dir] = Math.max(0, patternIndex(sides[dir]));
  return out;
}

/**
 * DecoratedPotRecipe: espaços 1, 3, 5 e 7 da grade 3×3 (cima, esquerda, direita, baixo) com tijolo ou sherd; o resto
 * vazio. Resultado: PotDecorations(back = cima, left = esquerda, right = direita, front = baixo).
 */
export function recipeDecorations(grid: readonly (string | null | undefined)[]): PotDecorations | undefined {
  if (grid.length !== 9) return undefined;
  for (const i of [0, 2, 4, 6, 8]) if (grid[i]) return undefined;
  const picks = [grid[1], grid[3], grid[5], grid[7]];
  if (!picks.every(p => isPotIngredient(p ?? undefined))) return undefined;
  return picks as PotDecorations;
}

/** A receita do Bedrock só vira o vaso do Cobblemon quando há ao menos um sherd do Cobblemon. */
export function needsCobblemonPot(d: PotDecorations): boolean {
  return d.some(i => isCobblemonSherd(i));
}

/** Quantos itens de cada id a receita consome. */
export function ingredientCounts(d: PotDecorations): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of d) out.set(i, (out.get(i) ?? 0) + 1);
  return out;
}

/** Linhas da dica do item (DecoratedPotBlock.appendHoverText: frente, esquerda, direita, fundo; tijolo no vazio). */
export function tooltipOrder(d: PotDecorations): string[] {
  const [back, left, right, front] = d;
  return [front, left, right, back];
}

// ---------------------------------------------------------------------------------------------
// Quebra

/** ItemTags.BREAKS_DECORATED_POTS do 1.21.1: espadas, machados, picaretas, pás, enxadas, tridente e maça. */
export const BREAKS_POT_ITEM_TAGS = ["minecraft:is_sword", "minecraft:is_axe", "minecraft:is_pickaxe", "minecraft:is_shovel", "minecraft:is_hoe"];
export const BREAKS_POT_ITEMS = ["minecraft:trident", "minecraft:mace"];

/**
 * playerWillDestroy: com uma ferramenta de #breaks_decorated_pots e sem Toque Suave o vaso racha e solta os sherds;
 * senão solta o próprio vaso com as decorações.
 */
export function cracksWith(toolId: string | undefined, toolTags: readonly string[], silkTouch: boolean): boolean {
  if (!toolId || silkTouch) return false;
  return BREAKS_POT_ITEMS.includes(toolId) || toolTags.some(t => BREAKS_POT_ITEM_TAGS.includes(t));
}

/** Loot table decorated_pot: rachado → os 4 lados (tijolo no vazio); inteiro → o vaso. */
export function breakDrops(d: PotDecorations, cracked: boolean): { items: string[]; pot: boolean } {
  return cracked ? { items: [...d], pot: false } : { items: [], pot: true };
}

/** EntityTypeTags.IMPACT_PROJECTILES (ids do Bedrock): projéteis que quebram o vaso (Projectile.mayBreak). */
export const IMPACT_PROJECTILES = new Set([
  "minecraft:arrow", "minecraft:thrown_trident", "minecraft:snowball", "minecraft:egg", "minecraft:fireball", "minecraft:small_fireball",
  "minecraft:dragon_fireball", "minecraft:wither_skull", "minecraft:wither_skull_dangerous", "minecraft:llama_spit", "minecraft:shulker_bullet",
  "minecraft:splash_potion", "minecraft:lingering_potion", "minecraft:xp_bottle", "minecraft:fireworks_rocket", "minecraft:wind_charge_projectile",
  "minecraft:breeze_wind_charge_projectile",
]);

// ---------------------------------------------------------------------------------------------
// Guardar itens (DecoratedPotBlock.useItemOn)

export interface PotContent { n: number; max: number }

/**
 * Cabe mais um item? Vazio aceita qualquer coisa; com item, só a mesma pilha (mesmos componentes) abaixo do máximo.
 * `same` = ItemStack.isSameItemSameComponents.
 */
export function canInsert(current: PotContent | undefined, same: boolean): boolean {
  if (!current || current.n <= 0) return true;
  return same && current.n < current.max;
}

/** Tom do som de inserir: 0,7 + 0,5 × (quantidade / máximo) depois de pôr. */
export function insertPitch(after: PotContent): number {
  return 0.7 + 0.5 * (after.n / Math.max(1, after.max));
}
