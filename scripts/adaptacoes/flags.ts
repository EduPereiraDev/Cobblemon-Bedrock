/**
 * Chaves da frente "adaptacoes" (sem imports: o importador também lê este arquivo).
 */

/**
 * Comparador na panela da fogueira (CampfireBlock.getAnalogOutputSignal): estados `cobblemon:comparator`/
 * `cobblemon:comparator_faces` + permutações `minecraft:redstone_producer` nas fogueiras do Cobblemon (importador) e o
 * sinal do Java gravado por scripts/adaptacoes/potHoppers.ts. Só funciona porque a fogueira NÃO tem
 * `minecraft:redstone_consumer` (medido no BDS: com o consumer o produtor das permutações é ignorado e a própria saída
 * fecha a tampa); a tampa por redstone lê os vizinhos por script (scripts/adaptacoes/potRedstone.ts). Mudou? `npm run import`.
 */
export const CAMPFIRE_COMPARATOR = true;
