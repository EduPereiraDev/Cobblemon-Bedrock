/**
 * Pinturas do Cobblemon (#30), lógica pura. No Java as 4 variantes (painting_variant) entram no sorteio do item
 * Pintura vanilla: `Painting.create` testa todas as variantes `placeable` na parede clicada, fica só com as de maior
 * área que cabem e sorteia uma. O Bedrock não tem registro de variantes, então o script refaz esse sorteio com a
 * lista das pinturas vanilla do Bedrock (tamanhos) + as do Cobblemon; se sair uma do Cobblemon, o clique vira a
 * entidade `cobblemon:painting`; se sair uma vanilla, o jogo segue normalmente (a vanilla não é tocada).
 */
export type Facing = "north" | "south" | "east" | "west";

export interface Vec3 { x: number; y: number; z: number }
export interface PaintingSize { width: number; height: number }
export interface PaintingVariant extends PaintingSize { id: string; name: string }

/**
 * Pinturas vanilla do Bedrock que o item pode sortear (textures/painting do bedrock-samples 1.26.50.4: atlas kz +
 * as 21 de 1.21), por tamanho largura×altura → quantidade. Earth/Wind/Water/Fire não existem no Bedrock.
 */
export const VANILLA_PAINTING_SIZES: Readonly<Record<string, number>> = {
  "1x1": 8,  // kebab, aztec, alban, aztec2, bomb, plant, wasteland, meditative
  "2x1": 5,  // pool, courbet, sea, sunset, creebet
  "1x2": 3,  // wanderer, graham, prairie_ride
  "2x2": 8,  // match, bust, stage, void, skull_and_roses, wither, baroque, humble
  "4x2": 5,  // fighters, changing, finding, lowmist, passage
  "3x3": 9,  // bouquet, cavebird, cotan, dennis, endboss, fern, owlemons, sunflowers, tides
  "4x3": 2,  // skeleton, donkey_kong
  "3x4": 2,  // backyard, pond
  "4x4": 5,  // pointer, pigscene, burning_skull, orb, unpacked
};

export const FACING_VEC: Readonly<Record<Facing, Vec3>> = {
  north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 }, east: { x: 1, y: 0, z: 0 }, west: { x: -1, y: 0, z: 0 },
};

/** Direction.getCounterClockWise do Java (visto de cima). */
export function counterClockWise(f: Facing): Facing {
  return ({ north: "west", west: "south", south: "east", east: "north" } as const)[f];
}

/** Face de bloco da Script API ("North"...) → direção horizontal; undefined para Up/Down. */
export function facingOf(face: string): Facing | undefined {
  const f = face.toLowerCase();
  return f === "north" || f === "south" || f === "east" || f === "west" ? f : undefined;
}

/** Eixo da placa: 0 = parede norte/sul (a pintura se estende em x), 1 = leste/oeste (em z). */
export function axisOf(f: Facing): 0 | 1 {
  return f === "north" || f === "south" ? 0 : 1;
}

/** Primeiro deslocamento de uma dimensão (Painting.offsetForPaintingSize): 1 → 0, 2 → 0, 3 → -1, 4 → -1. */
function firstOffset(n: number): number {
  return -Math.floor((n - 1) / 2);
}

export interface PaintingCell { front: Vec3; wall: Vec3 }

/**
 * Blocos ocupados (`front`) e blocos de apoio (`wall`, logo atrás) de uma pintura w×h pendurada a partir de
 * `anchor` (o bloco na frente da face clicada), como Painting.calculateBoundingBox/calculateSupportBox.
 */
export function paintingCells(anchor: Vec3, facing: Facing, size: PaintingSize): PaintingCell[] {
  const f = FACING_VEC[facing];
  const side = FACING_VEC[counterClockWise(facing)];
  const out: PaintingCell[] = [];
  for (let i = 0; i < size.width; i++) {
    const a = firstOffset(size.width) + i;
    for (let j = 0; j < size.height; j++) {
      const b = firstOffset(size.height) + j;
      const front = { x: anchor.x + side.x * a, y: anchor.y + b, z: anchor.z + side.z * a };
      out.push({ front, wall: { x: front.x - f.x, y: front.y, z: front.z - f.z } });
    }
  }
  return out;
}

/** Posição da entidade: centro da pintura na horizontal, base na vertical, 1/32 de bloco à frente da parede. */
export function paintingLocation(anchor: Vec3, facing: Facing, size: PaintingSize): Vec3 {
  const f = FACING_VEC[facing];
  const side = FACING_VEC[counterClockWise(facing)];
  const along = size.width % 2 === 0 ? 0.5 : 0;
  const out = 0.5 - 1 / 32;
  return {
    x: anchor.x + 0.5 + side.x * along - f.x * out,
    y: anchor.y + firstOffset(size.height),
    z: anchor.z + 0.5 + side.z * along - f.z * out,
  };
}

/** Caixa (mín/máx inclusive, em blocos) dos blocos ocupados. */
export function cellsBox(cells: readonly PaintingCell[]): { min: Vec3; max: Vec3 } {
  const xs = cells.map(c => c.front.x), ys = cells.map(c => c.front.y), zs = cells.map(c => c.front.z);
  return { min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) }, max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) } };
}

export type PaintingChoice = { kind: "vanilla"; area: number } | { kind: "cobblemon"; variant: PaintingVariant; area: number };

/**
 * Painting.create: variantes que cabem → só as de maior área → sorteio uniforme. `fits(w, h)` diz se um tamanho
 * cabe (o mesmo para todas as variantes daquele tamanho). `roll` ∈ [0, 1). Undefined = nada cabe.
 */
export function choosePainting(
  cobblemon: readonly PaintingVariant[],
  fits: (size: PaintingSize) => boolean,
  roll: number,
  vanilla: Readonly<Record<string, number>> = VANILLA_PAINTING_SIZES,
): PaintingChoice | undefined {
  const memo = new Map<string, boolean>();
  const fitsMemo = (w: number, h: number) => {
    const key = `${w}x${h}`;
    let ok = memo.get(key);
    if (ok === undefined) memo.set(key, ok = fits({ width: w, height: h }));
    return ok;
  };
  const vanillaFit: Array<{ area: number; n: number }> = [];
  for (const [key, n] of Object.entries(vanilla)) {
    const [w, h] = key.split("x").map(Number);
    if (n > 0 && fitsMemo(w, h)) vanillaFit.push({ area: w * h, n });
  }
  const oursFit = cobblemon.filter(v => fitsMemo(v.width, v.height));
  const area = Math.max(0, ...vanillaFit.map(v => v.area), ...oursFit.map(v => v.width * v.height));
  if (area <= 0) return undefined;
  const nVanilla = vanillaFit.filter(v => v.area === area).reduce((s, v) => s + v.n, 0);
  const ours = oursFit.filter(v => v.width * v.height === area);
  const total = nVanilla + ours.length;
  const pick = Math.min(total - 1, Math.floor(Math.max(0, roll) * total));
  if (pick < nVanilla) return { kind: "vanilla", area };
  return { kind: "cobblemon", variant: ours[pick - nVanilla], area };
}

/** Registro salvo na entidade (dynamic property `cobblemon:painting`). */
export interface PaintingRecord { v: string; f: Facing; a: [number, number, number] }

export function parsePaintingRecord(raw: unknown): PaintingRecord | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const r = JSON.parse(raw) as PaintingRecord;
    if (typeof r?.v !== "string" || !FACING_VEC[r.f] || !Array.isArray(r.a) || r.a.length !== 3 || !r.a.every(Number.isFinite)) return undefined;
    return r;
  }
  catch { return undefined; }
}

/** Blocos que não seguram nem bloqueiam uma pintura (sem colisão, como o `noCollision`/`isSolid` do Java). */
const NON_SOLID = /^minecraft:(air|cave_air|void_air|light_block\w*|structure_void|water|flowing_water|lava|flowing_lava|bubble_column|short_grass|tall_grass|grass|fern|large_fern|dead_bush|deadbush|seagrass|tall_seagrass|kelp|kelp_plant|vine|glow_lichen|sculk_vein|snow_layer|\w*_?torch|\w*_carpet|moss_carpet|pale_moss_carpet|\w+_button|\w+_pressure_plate|lever|tripwire|trip_wire|tripwire_hook|rail|\w+_rail|redstone_wire|\w*_?sign|\w+_hanging_sign|ladder|fire|soul_fire|\w+_sapling|\w+_flower|\w+_tulip|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|pink_petals|wildflowers|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass|sunflower|lilac|rose_bush|peony|brown_mushroom|red_mushroom|crimson_roots|warped_roots|nether_sprouts|hanging_roots|cave_vines\w*|twisting_vines\w*|weeping_vines\w*|spore_blossom|sweet_berry_bush|cobweb|web|small_dripleaf_block|big_dripleaf|\w+_coral|\w+_coral_fan|\w+_coral_wall_fan|sea_pickle)$/;

/** Molduras são blocos no Bedrock (entidades penduradas no Java): nem seguram nem deixam pendurar por cima. */
const HANGING_BLOCK = /^minecraft:(frame|glow_frame)$/;

/** O bloco pode segurar uma pintura (sólido)? */
export function isSolidForPainting(typeId: string, isAir: boolean, isLiquid: boolean): boolean {
  return !isAir && !isLiquid && !NON_SOLID.test(typeId) && !HANGING_BLOCK.test(typeId);
}

/** O bloco deixa a pintura ocupar o espaço (sem colisão)? Blocos do Cobblemon sempre bloqueiam (sem lista). */
export function isFreeForPainting(typeId: string, isAir: boolean, isLiquid: boolean): boolean {
  return isAir || isLiquid || NON_SOLID.test(typeId);
}

/**
 * Blocos que respondem ao clique direito (o item só é usado agachado, como no Java): contêineres, portas, mesas
 * de trabalho, redstone e os blocos do Cobblemon.
 */
const INTERACTIVE = /^minecraft:(\w*chest|barrel|\w*shulker_box|\w*furnace|smoker|blast_furnace|crafting_table|crafter|\w*door|\w*trapdoor|\w*fence_gate|\w+_button|lever|\w*bed|\w*anvil|cartography_table|fletching_table|smithing_table|loom|stonecutter\w*|grindstone|composter|\w*cauldron|lectern|bell|noteblock|note_block|\w*repeater|\w*comparator|hopper|dispenser|dropper|enchanting_table|brewing_stand|beacon|jukebox|daylight_detector\w*|respawn_anchor|lodestone|\w*_sign|\w+_hanging_sign|decorated_pot|chiseled_bookshelf|vault|trial_spawner|cake|\w+_cake|flower_pot|frame|glow_frame|command_block|\w+_command_block|structure_block|jigsaw|beehive|bee_nest|campfire|soul_campfire|dragon_egg|copper_golem_statue|\w*copper_chest\w*)$/;

export function isInteractiveBlock(typeId: string): boolean {
  return typeId.startsWith("cobblemon:") || INTERACTIVE.test(typeId);
}
