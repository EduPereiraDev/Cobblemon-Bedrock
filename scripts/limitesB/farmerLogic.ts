/**
 * Fazendeiro e as plantas do Cobblemon (#136), lógica pura. No Java o HarvestFarmland do aldeão fazendeiro colhe
 * qualquer CropBlock maduro em cima de farmland e planta a primeira semente da tag `villager_plantable_seeds` do
 * inventário no ar em cima de farmland; o Cobblemon põe mints, revival herb, vivichoke e hearty grains na tag e
 * deixa o fazendeiro pegá-las do chão (EntityVillagerMixin/VillagerGatherableItems). O `harvest_farm_block` do
 * Bedrock não aceita lista: o override do aldeão põe as sementes nos `shareables` (pegar do chão) e o script faz a
 * colheita/plantio só das plantas do Cobblemon (as vanilla continuam com a IA do Bedrock).
 */
export const FARMER_FAMILY = "farmer";
export const FARMLAND = "minecraft:farmland";
export const AGE_STATE = "cobblemon:age";
export const HALF_STATE = "cobblemon:half";

/** CropBlocks do Cobblemon que existem no port e a idade madura (isMaxAge). */
export const COBBLEMON_CROPS: Readonly<Record<string, { maxAge: number; double?: boolean }>> = {
  "cobblemon:blue_mint": { maxAge: 7 },
  "cobblemon:cyan_mint": { maxAge: 7 },
  "cobblemon:green_mint": { maxAge: 7 },
  "cobblemon:pink_mint": { maxAge: 7 },
  "cobblemon:red_mint": { maxAge: 7 },
  "cobblemon:white_mint": { maxAge: 7 },
  "cobblemon:revival_herb": { maxAge: 8 },
  "cobblemon:vivichoke_seeds": { maxAge: 7 },
  "cobblemon:hearty_grains": { maxAge: 6, double: true },
};

/** Semente (BlockItem da tag) → bloco colocado (defaultBlockState). */
export function cropForSeed(item: string): string | undefined {
  const mint = /^cobblemon:(blue|cyan|green|pink|red|white)_mint_seeds$/.exec(item);
  if (mint) return `cobblemon:${mint[1]}_mint`;
  if (item === "cobblemon:revival_herb" || item === "cobblemon:vivichoke_seeds" || item === "cobblemon:hearty_grains") return item;
  return undefined;
}

/** Tag vanilla villager_plantable_seeds do MC 1.21.1 (essas o Bedrock planta sozinho). */
export const VANILLA_PLANTABLE = new Set([
  "minecraft:wheat_seeds", "minecraft:potato", "minecraft:carrot", "minecraft:beetroot_seeds", "minecraft:torchflower_seeds", "minecraft:pitcher_pod",
]);

/**
 * Primeira semente plantável do inventário, na ordem dos slots (HarvestFarmland.tick percorre o inventário e planta a
 * primeira da tag). Vanilla primeiro = o Bedrock planta; do Cobblemon = o script planta.
 */
export function firstPlantable(items: ReadonlyArray<string | undefined>, cobblemonSeeds: readonly string[]): { slot: number; item: string; cobblemon: boolean } | undefined {
  for (let slot = 0; slot < items.length; slot++) {
    const id = items[slot];
    if (!id) continue;
    if (VANILLA_PLANTABLE.has(id)) return { slot, item: id, cobblemon: false };
    if (cobblemonSeeds.includes(id) && cropForSeed(id)) return { slot, item: id, cobblemon: true };
  }
  return undefined;
}

/** Bloco maduro do Cobblemon (para hearty grains, só a metade de baixo conta: é ela que fica em cima da farmland). */
export function isMatureCobblemonCrop(typeId: string, states: Readonly<Record<string, unknown>>): boolean {
  const crop = COBBLEMON_CROPS[typeId];
  if (!crop) return false;
  if (crop.double && states[HALF_STATE] !== undefined && states[HALF_STATE] !== "lower") return false;
  return Number(states[AGE_STATE]) >= crop.maxAge;
}

/** Vizinhança 3×3×3 do HarvestFarmland (validFarmlandAroundVillager: dx, dy, dz de -1 a 1). */
export function farmOffsets(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) out.push([dx, dy, dz]);
  return out;
}

export type FarmAction = { kind: "harvest"; pos: [number, number, number] } | { kind: "plant"; pos: [number, number, number]; slot: number; block: string };
