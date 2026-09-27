/**
 * Tamanho intrínseco e de filhote (Cobblemon 1.8.2: Pokemon.scaleModifier, initializeScale, setIntrinsicScale,
 * effectiveScale e PokemonSizeCategory). Lógica pura, testável no Node.
 *
 * - `scaleModifier`: sorteado ao criar o Pokémon (PokemonProperties.create → initializeScale) entre
 *   `pokemonIntrinsicSizeMin` e `pokemonIntrinsicSizeMax` (0,95–1,05), arredondado a 0,1 %; Alfa fica em 1.
 * - `effectiveScale`: nível 1 = `babyPokemonSizeMultiplier`; até `babyPokemonLevelDuration` cresce linearmente
 *   até 1; Alfa usa a escala de Alfa (grupo de tamanho próprio no port).
 * - Categoria XS/S/M/L/XL: a faixa min–max dividida em 5 partes (marcas Mini/Jumbo no spawn).
 *
 * O visual depende da entidade: `minecraft:scale` não é gravável por script na API estável e os grupos
 * `cobblemon:size_<n>` são por forma/Alfa. Se o entity JSON declarar a propriedade `cobblemon:scale_modifier`
 * (pedido ao importador), `applyScaleProperty` grava a escala efetiva nela para o client entity usar.
 */

export type SizeCategory = "XS" | "S" | "M" | "L" | "XL";
export const SIZE_CATEGORIES: readonly SizeCategory[] = ["XS", "S", "M", "L", "XL"];

/** Propriedade de entidade (float, client_sync) que o client entity multiplicaria na escala. */
export const SCALE_PROPERTY = "cobblemon:scale_modifier";

export interface ScaleSettings {
  pokemonIntrinsicSizeMin: number;
  pokemonIntrinsicSizeMax: number;
  babyPokemonLevelDuration: number;
  babyPokemonSizeMultiplier: number;
}

export const DEFAULT_SCALE_SETTINGS: ScaleSettings = {
  pokemonIntrinsicSizeMin: 0.95,
  pokemonIntrinsicSizeMax: 1.05,
  babyPokemonLevelDuration: 9,
  babyPokemonSizeMultiplier: 0.9,
};

/** Pokemon.setIntrinsicScale: arredonda o desvio a 0,1 % (1.0437 → 1.044). Mínimo 0,05 (setter do scaleModifier). */
export function roundIntrinsicScale(value: number): number {
  const deltaPercent = (value - 1) * 100;
  const roundedPercent = Math.round(deltaPercent * 10) / 10;
  return Math.max(0.05, 1 + roundedPercent / 100);
}

/** Pokemon.initializeScale: Alfa = 1; senão sorteio uniforme entre min e max (Random.nextBetween). */
export function rollIntrinsicScale(settings: ScaleSettings = DEFAULT_SCALE_SETTINGS, alpha = false, random: () => number = Math.random): number {
  if (alpha) return 1;
  const min = Math.min(settings.pokemonIntrinsicSizeMin, settings.pokemonIntrinsicSizeMax);
  const max = Math.max(settings.pokemonIntrinsicSizeMin, settings.pokemonIntrinsicSizeMax);
  return roundIntrinsicScale(min + random() * (max - min));
}

/** Multiplicador de filhote (effectiveScale sem Alfa). */
export function babyMultiplier(level: number, settings: ScaleSettings = DEFAULT_SCALE_SETTINGS): number {
  if (level <= 1) return settings.babyPokemonSizeMultiplier;
  const duration = settings.babyPokemonLevelDuration;
  if (duration <= 1 || level >= duration) return 1;
  const t = (level - 1) / (duration - 1);
  const min = settings.babyPokemonSizeMultiplier;
  return min + (1 - min) * t;
}

/** Pokemon.effectiveScale (sem Alfa: o Alfa tem grupo de tamanho próprio). `scaleModifier` ausente = 1. */
export function effectiveScale(level: number, scaleModifier: number | undefined, settings: ScaleSettings = DEFAULT_SCALE_SETTINGS): number {
  return babyMultiplier(level, settings) * (scaleModifier ?? 1);
}

/** PokemonSizeCategory.fromScale. */
export function sizeCategoryOf(scaleModifier: number | undefined, settings: ScaleSettings = DEFAULT_SCALE_SETTINGS): SizeCategory {
  const min = settings.pokemonIntrinsicSizeMin;
  const max = settings.pokemonIntrinsicSizeMax;
  const range = Math.max(0.0001, max - min);
  const segment = range / SIZE_CATEGORIES.length;
  const adjusted = Math.min(range, Math.max(0, (scaleModifier ?? 1) - min));
  const index = Math.min(SIZE_CATEGORIES.length - 1, Math.max(0, Math.floor(adjusted / segment)));
  return SIZE_CATEGORIES[index];
}

/** Chave de tradução da categoria (PokemonSizeCategory.translationKey). */
export function sizeCategoryKey(category: SizeCategory): string {
  return `cobblemon.size_category.${category.toLowerCase()}`;
}

/** Entidade mínima para gravar a escala (Entity do Minecraft). */
interface ScaleEntity {
  getProperty(id: string): unknown;
  setProperty(id: string, value: number): void;
}

/** Grava a escala efetiva na propriedade da entidade, se ela existir. @returns true se gravou. */
export function applyScaleProperty(entity: ScaleEntity, scale: number): boolean {
  try {
    const current = entity.getProperty(SCALE_PROPERTY);
    if (typeof current !== "number") return false;
    if (Math.abs(current - scale) < 0.0005) return false;
    entity.setProperty(SCALE_PROPERTY, scale);
    return true;
  }
  catch {
    return false;
  }
}
