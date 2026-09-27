/**
 * Padrões do vaso decorado (DecoratedPotPatterns do MC 1.21.1 + CobblemonSherds do Cobblemon 1.8.2).
 * Sem imports: o importador (tools/importer/adaptacoes.ts) também lê este arquivo.
 *
 * O índice na lista é o valor das propriedades `cobblemon:face_*` da entidade de exibição do vaso; 0 = tijolo
 * (lado liso, `decorated_pot_side`).
 */

/** Sherds vanilla do MC 1.21.1 (mesmos ids no Bedrock), na ordem do registro DecoratedPotPatterns. */
export const VANILLA_SHERDS = [
  "angler", "archer", "arms_up", "blade", "brewer", "burn", "danger", "explorer", "flow", "friend", "guster", "heart", "heartbreak",
  "howl", "miner", "mourner", "plenty", "prize", "scrape", "sheaf", "shelter", "skull", "snort",
] as const;

/** Sherds do Cobblemon (data/cobblemon/tags/item/decorated_pot_sherds.json → minecraft:decorated_pot_sherds). */
export const COBBLEMON_SHERDS = ["bygone", "capture", "dome", "helix", "nostalgic", "suspicious"] as const;

export const BRICK = "minecraft:brick";

export interface PotPattern {
  /** Item que vira esse lado (tijolo ou sherd). */
  item: string;
  /** Textura do lado no RP (sem extensão). */
  texture: string;
  cobblemon: boolean;
}

/** Todos os lados possíveis: 0 = tijolo, depois os vanilla e os do Cobblemon. */
export const POT_PATTERNS: readonly PotPattern[] = [
  { item: BRICK, texture: "textures/blocks/decorated_pot_side", cobblemon: false },
  ...VANILLA_SHERDS.map(n => ({ item: `minecraft:${n}_pottery_sherd`, texture: `textures/blocks/${n}_pottery_pattern`, cobblemon: false })),
  ...COBBLEMON_SHERDS.map(n => ({ item: `cobblemon:${n}_sherd`, texture: `textures/entity/decorated_pot/${n}_pottery_pattern`, cobblemon: true })),
];

/** Índice do padrão de um item (−1 se não for tijolo nem sherd). */
export function patternIndex(item: string | undefined): number {
  if (!item) return 0;
  return POT_PATTERNS.findIndex(p => p.item === item);
}

/** Item aceito como lado do vaso (#minecraft:decorated_pot_ingredients = tijolo + sherds). */
export function isPotIngredient(item: string | undefined): boolean {
  return patternIndex(item) >= 0 && !!item;
}

export function isCobblemonSherd(item: string | undefined): boolean {
  const i = patternIndex(item);
  return i > 0 && POT_PATTERNS[i].cobblemon;
}

/** Ids do bloco/item/entidade do vaso do Cobblemon. */
export const DECORATED_POT = "cobblemon:decorated_pot";
export const DECORATED_POT_DISPLAY = "cobblemon:decorated_pot_display";
