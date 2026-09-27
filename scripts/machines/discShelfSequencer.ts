/**
 * Estante de discos (DiscShelfBlockEntity/DiscShelfBlockEntityRenderer + NoteBlockMixin do Cobblemon 1.8.2):
 *
 * - Discos visíveis: a entidade `cobblemon:disc_shelf_display` (gerada pelo importador) mostra os 14 espaços com as
 *   texturas de `textures/block/disc_shelf` — música pelo nome do disco (`music_disc_unknown` se não houver), TM
 *   pelo tipo do golpe (`<tipo>_tm`), TM em branco, Upgrade e Dubious Disc; a entidade é girada para a frente.
 * - Sequenciador: um note block logo acima da estante, ao tocar (clique, soco ou pulso de redstone), toca as notas
 *   dos espaços ocupados (NOTE_SLOT_TO_SEMITONE, C = 0) com o instrumento do bloco embaixo da estante (ar = bit),
 *   volume 3 e tom 2^(semitom/12); espaço 1 ocupado sobe uma oitava, espaço 12 desce (os dois = nada).
 *   Desvio: o Bedrock não deixa calar a nota do próprio note block (o Java suprime); ela toca junto.
 */
import { Block, Dimension, Entity, Player, system, Vector3, world } from "@minecraft/server";
import { DISC_TEXTURES } from "../../generated/scripts/mundoDetalhes";
import { blockCenter, containerOf, findStorage, MACHINE_STORAGE } from "../world/Containers";
import { getTMMove } from "./tm";

export const DISC_SHELF = "cobblemon:disc_shelf";
export const DISC_DISPLAY = "cobblemon:disc_shelf_display";
export const SHELF_SLOTS = 14;
const TEXTURE_INDEX = new Map(DISC_TEXTURES.map((name, i) => [name, i + 1]));

/** Espaço → semitom (C = 0), na ordem do Kotlin. */
export const NOTE_SLOT_TO_SEMITONE: Array<[number, number]> = [
  [0, 5], [2, 4], [4, 3], [6, 2], [8, 1], [10, 0], [3, 11], [5, 10], [7, 9], [9, 8], [11, 7], [13, 6],
];

/** Textura do disco (nome em textures/block/disc_shelf) para o item, como getItemTexture/TM do renderer. */
export function discTextureFor(itemId: string, tmType?: string): string {
  if (itemId === "cobblemon:technical_machine") return tmType ? `${tmType.toLowerCase()}_tm` : "blank_tm";
  const name = itemId.replace(/^[a-z0-9_]+:/, "");
  if (TEXTURE_INDEX.has(name)) return name;
  return itemId.startsWith("minecraft:music_disc") ? "music_disc_unknown" : "fallback";
}

export function discTextureIndex(itemId: string | undefined, tmType?: string): number {
  if (!itemId) return 0;
  return TEXTURE_INDEX.get(discTextureFor(itemId, tmType)) ?? TEXTURE_INDEX.get("fallback") ?? 0;
}

/** Notas do pulso: [tom, semitom] para os espaços ocupados (onNoteBlockPulse). */
export function sequencerNotes(filled: readonly boolean[]): number[] {
  const up = !!filled[1];
  const down = !!filled[12];
  const shift = up && !down ? 12 : down && !up ? -12 : 0;
  return NOTE_SLOT_TO_SEMITONE.filter(([slot]) => filled[slot]).map(([, semitone]) => Math.pow(2, (semitone + shift) / 12));
}

/** Instrumento (NoteBlockInstrument) pelo bloco embaixo da estante → som do Bedrock. */
export function instrumentSound(blockId: string | undefined): string {
  const id = (blockId ?? "minecraft:air").replace(/^minecraft:/, "");
  if (id === "air" || id === "cave_air" || id === "void_air") return "note.bit";
  if (/(^|_)(planks|log|wood|stem|hyphae|bamboo_block)$|^(bookshelf|chest|crafting_table|note_block|jukebox|barrel|composter|lectern|loom)$|_(fence|fence_gate|door|trapdoor|sign|slab|stairs)$/.test(id) && !/stone|brick|deepslate|blackstone|copper|iron|quartz|prismarine|purpur|sandstone|andesite|diorite|granite|tuff|mud/.test(id)) return "note.bass";
  if (/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$|concrete_powder$/.test(id)) return "note.snare";
  if (/glass|^sea_lantern$|^beacon$/.test(id)) return "note.hat";
  if (id === "gold_block") return "note.bell";
  if (id === "clay") return "note.flute";
  if (id === "packed_ice") return "note.chime";
  if (/wool$/.test(id)) return "note.guitar";
  if (id === "bone_block") return "note.xylophone";
  if (id === "iron_block") return "note.iron_xylophone";
  if (id === "soul_sand") return "note.cow_bell";
  if (id === "pumpkin") return "note.didgeridoo";
  if (id === "emerald_block") return "note.bit";
  if (id === "hay_block") return "note.banjo";
  if (id === "glowstone") return "note.pling";
  if (/stone|cobble|brick|deepslate|blackstone|basalt|netherrack|obsidian|ore|andesite|diorite|granite|tuff|calcite|quartz|prismarine|purpur|terracotta|concrete$|end_stone|sandstone|nylium|bedrock/.test(id)) return "note.bd";
  return "note.harp";
}

function facingYaw(facing: string | undefined): number {
  switch (facing) {
    case "south": return 0;
    case "west": return 90;
    case "east": return -90;
    default: return 180;
  }
}

function findDisplay(dimension: Dimension, location: Vector3): Entity | undefined {
  try { return dimension.getEntities({ type: DISC_DISPLAY, location: blockCenter(location, 0.5), maxDistance: 0.9, closest: 1 })[0]; }
  catch { return undefined; }
}

/** Atualiza a entidade de exibição da estante (cria, atualiza os 14 espaços ou remove se vazia). */
export function refreshDiscShelfDisplay(block: Block) {
  if (block.typeId !== DISC_SHELF) return;
  const storage = findStorage(block.dimension, block.location, MACHINE_STORAGE);
  const container = containerOf(storage);
  const values: number[] = [];
  for (let i = 0; i < SHELF_SLOTS; i++) {
    const item = container?.getItem(i);
    values.push(item ? discTextureIndex(item.typeId, getTMMove(item)?.type) : 0);
  }
  let display = findDisplay(block.dimension, block.location);
  if (!values.some(v => v > 0)) {
    try { display?.remove(); }
    catch { /* já removida */ }
    return;
  }
  const facing = String(block.permutation.getState("minecraft:cardinal_direction" as never) ?? "north");
  const apply = (target: Entity) => {
    try {
      target.setRotation({ x: 0, y: facingYaw(facing) });
      values.forEach((v, i) => {
        if (target.getProperty(`cobblemon:slot_${i}`) !== v) target.setProperty(`cobblemon:slot_${i}`, v);
      });
    }
    catch { /* entidade saindo */ }
  };
  if (!display) {
    try { display = block.dimension.spawnEntity(DISC_DISPLAY as never, blockCenter(block.location, 0), { initialRotation: facingYaw(facing) }); }
    catch { return; }
    // Propriedades gravadas no mesmo tick do spawn se perdem (visto no BDS): grava de novo no tick seguinte.
    const spawned = display;
    system.runTimeout(() => { if (spawned.isValid) apply(spawned); }, 2);
  }
  apply(display);
}

export function removeDiscShelfDisplay(dimension: Dimension, location: Vector3) {
  for (let i = 0; i < 2; i++) {
    const display = findDisplay(dimension, location);
    if (!display) return;
    try { display.remove(); }
    catch { return; }
  }
}

/** Pulso do note block acima da estante (uma vez por tick, como lastNotePulseTick). */
const lastPulse = new Map<string, number>();

export function pulseNoteBlock(noteBlock: Block) {
  const shelf = noteBlock.below();
  if (!shelf || shelf.typeId !== DISC_SHELF) return;
  const key = `${noteBlock.dimension.id}|${noteBlock.x}|${noteBlock.y}|${noteBlock.z}`;
  if (lastPulse.get(key) === system.currentTick) return;
  lastPulse.set(key, system.currentTick);
  const container = containerOf(findStorage(shelf.dimension, shelf.location, MACHINE_STORAGE));
  if (!container) return;
  const filled: boolean[] = [];
  for (let i = 0; i < SHELF_SLOTS; i++) filled.push(!!container.getItem(i));
  const sound = instrumentSound(shelf.below()?.typeId);
  const at = { x: noteBlock.x + 0.5, y: noteBlock.y + 0.5, z: noteBlock.z + 0.5 };
  for (const pitch of sequencerNotes(filled)) {
    try { noteBlock.dimension.playSound(sound, at, { volume: 3, pitch }); }
    catch { /* som ausente */ }
  }
}

/** Redstone: borda de subida do sinal de cada note block acima de uma estante com discos. */
const powered = new Map<string, boolean>();

function pollRedstone() {
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    let storages: Entity[];
    try { storages = world.getDimension(dimId).getEntities({ type: MACHINE_STORAGE }); }
    catch { continue; }
    for (const storage of storages) {
      let shelf: Block | undefined;
      try { shelf = storage.dimension.getBlock({ x: Math.floor(storage.location.x), y: Math.floor(storage.location.y), z: Math.floor(storage.location.z) }); }
      catch { continue; }
      if (!shelf || shelf.typeId !== DISC_SHELF) continue;
      const note = shelf.above();
      if (!note || note.typeId !== "minecraft:noteblock") continue;
      const key = `${dimId}|${note.x}|${note.y}|${note.z}`;
      let power = 0;
      try { power = note.getRedstonePower() ?? 0; }
      catch { power = 0; }
      const on = power > 0;
      if (on && !powered.get(key)) pulseNoteBlock(note);
      powered.set(key, on);
    }
  }
}

/** Mantém as exibições das estantes carregadas em dia (dados antigos, estantes de antes desta versão). */
function syncDisplays() {
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    let storages: Entity[];
    try { storages = world.getDimension(dimId).getEntities({ type: MACHINE_STORAGE }); }
    catch { continue; }
    for (const storage of storages) {
      try {
        const block = storage.dimension.getBlock({ x: Math.floor(storage.location.x), y: Math.floor(storage.location.y), z: Math.floor(storage.location.z) });
        if (block?.typeId === DISC_SHELF) refreshDiscShelfDisplay(block);
      }
      catch { /* chunk saindo */ }
    }
    // Exibições órfãs (estante quebrada por explosão/pistão).
    let displays: Entity[];
    try { displays = world.getDimension(dimId).getEntities({ type: DISC_DISPLAY }); }
    catch { continue; }
    for (const display of displays) {
      try {
        const block = display.dimension.getBlock({ x: Math.floor(display.location.x), y: Math.floor(display.location.y), z: Math.floor(display.location.z) });
        if (block && block.typeId !== DISC_SHELF) display.remove();
      }
      catch { /* chunk saindo */ }
    }
  }
}

let started = false;

export function startDiscShelfSequencer() {
  if (started) return;
  started = true;
  const isNoteBlock = (block: Block) => block.typeId === "minecraft:noteblock";
  world.afterEvents.playerInteractWithBlock.subscribe(({ block }) => {
    if (isNoteBlock(block)) pulseNoteBlock(block);
  });
  world.afterEvents.entityHitBlock.subscribe(({ damagingEntity, hitBlock }) => {
    if (damagingEntity instanceof Player && isNoteBlock(hitBlock)) pulseNoteBlock(hitBlock);
  });
  system.runInterval(pollRedstone, 2);
  system.runInterval(syncDisplays, 100);
}
