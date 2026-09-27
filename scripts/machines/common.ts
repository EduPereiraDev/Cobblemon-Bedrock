/**
 * Utilidades compartilhadas pelas máquinas: blocos vizinhos, estados, sons, textos do port e criação de
 * Pokémon selvagens/obtidos fora da captura (fósseis, Porygon, Gimmighoul).
 */
import { Block, BlockPermutation, Dimension, Entity, Player, RawMessage, Vector3, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { storePokemonInFirstSpace } from "../pokemonStorage";
import { markCaught } from "../pokedex";
import { getSpeciesData } from "../speciesData";
import { getConfig } from "../Config";
import { ITEMS } from "../../generated/scripts/items";

/** Textos do port pedidos em docs/pendencias/mundo-maquinas.md (en_US / pt_BR). */
export const MK = {
  pastureAdd: "cobblemon.port.pasture.add",
  pastureEmpty: "cobblemon.port.pasture.empty",
  pastureFull: "cobblemon.port.pasture.full",
  pastureChoose: "cobblemon.port.pasture.choose",
  pastureOwner: "cobblemon.port.pasture.owner",
  pastureNone: "cobblemon.port.pasture.none_available",
  pastureFainted: "cobblemon.port.pasture.fainted",
  pastureRecall: "cobblemon.port.pasture.recall",
  pastureConflictOn: "cobblemon.port.pasture.conflict_on",
  pastureConflictOff: "cobblemon.port.pasture.conflict_off",
  fossilStatus: "cobblemon.port.fossil.status",
  fossilNoStructure: "cobblemon.port.fossil.no_structure",
  fossilNeedBall: "cobblemon.port.fossil.need_ball",
  fossilUnknown: "cobblemon.port.fossil.unknown",
  cookingSlot: "cobblemon.port.cooking.slot",
  cookingSeasoning: "cobblemon.port.cooking.seasoning_slot",
  cookingResult: "cobblemon.port.cooking.result",
  cookingLidOpen: "cobblemon.port.cooking.lid_open",
  cookingLidClose: "cobblemon.port.cooking.lid_close",
  cookingProgress: "cobblemon.port.cooking.progress",
  cookingNoRecipe: "cobblemon.port.cooking.no_recipe",
  cookingHint: "cobblemon.port.cooking.hint",
  cookingRemovePot: "cobblemon.port.cooking.remove_pot",
  brewingTitle: "cobblemon.port.brewing.title",
  brewingNone: "cobblemon.port.brewing.none",
  brewingFuel: "cobblemon.port.brewing.fuel",
  brewingBrewing: "cobblemon.port.brewing.brewing",
  tmChooseMove: "cobblemon.port.tm_machine.choose_move",
  tmMissing: "cobblemon.port.tm_machine.missing",
  tmBusy: "cobblemon.port.tm_machine.busy",
  tmSearch: "cobblemon.port.tm_machine.search",
  tmFilterParty: "cobblemon.port.tm_machine.filter_party",
  tmType: "cobblemon.port.tm_machine.type",
  tmNone: "cobblemon.port.tm_machine.none",
  chestNoStorage: "cobblemon.port.gilded_chest.no_storage",
  displayCaseEmpty: "cobblemon.port.display_case.empty",
  displayCaseRich: "cobblemon.port.display_case.rich",
  cookingConvertTitle: "cobblemon.port.cooking.convert_title",
  cookingConvertBody: "cobblemon.port.cooking.convert_body",
  cookingConvertConfirm: "cobblemon.port.cooking.convert_confirm",
  cookingConvertCancel: "cobblemon.port.cooking.convert_cancel",
} as const;

export function tr(key: string, ...args: (string | number | RawMessage)[]): RawMessage {
  if (!args.length) return { translate: key };
  return { translate: key, with: { rawtext: args.map(a => typeof a === "object" ? a : { text: String(a) }) } };
}

export const HORIZONTAL: readonly Vector3[] = [{ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }];

/** Vetor da direção cardinal ("north" = -z). */
export function directionVector(direction: string | undefined): Vector3 {
  switch (direction) {
    case "south": return { x: 0, y: 0, z: 1 };
    case "east": return { x: 1, y: 0, z: 0 };
    case "west": return { x: -1, y: 0, z: 0 };
    default: return { x: 0, y: 0, z: -1 };
  }
}

export function add(a: Vector3, b: Vector3, scale = 1): Vector3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

export function tuple(loc: Vector3): [number, number, number] {
  return [Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z)];
}

export function fromTuple(t: readonly [number, number, number]): Vector3 {
  return { x: t[0], y: t[1], z: t[2] };
}

export function dimensionById(id: string): Dimension | undefined {
  try { return world.getDimension(id); }
  catch { return undefined; }
}

/** Bloco numa posição carregada (undefined se o chunk não estiver carregado). */
export function loadedBlock(dimension: Dimension, loc: Vector3): Block | undefined {
  try {
    if (!dimension.isChunkLoaded(loc)) return undefined;
    return dimension.getBlock(loc);
  }
  catch { return undefined; }
}

export function getState<T extends string | number | boolean>(block: Block, state: string): T | undefined {
  try { return block.permutation.getState(state as never) as T | undefined; }
  catch { return undefined; }
}

/**
 * Troca um estado do bloco se ele existir e for diferente. Enums com mais de 16 valores são divididos pelo
 * importador em `state`, `state_2`, `state_3`... ("none" = não usado): o valor vai para o estado que o tiver e os
 * estados de estouro dos outros voltam a "none".
 */
export function setState(block: Block | undefined, state: string, value: string | number | boolean) {
  if (!block) return;
  try {
    const current = block.permutation;
    const overflow: string[] = [];
    for (let i = 2; current.getState(`${state}_${i}` as never) !== undefined; i++) overflow.push(`${state}_${i}`);
    // Primeiro estado (principal ou de estouro) que aceita o valor.
    let permutation = current;
    let target: string | undefined;
    for (const candidate of [state, ...overflow]) {
      const next = withStateSafe(current, candidate, value);
      if (next !== current) { permutation = next; target = candidate; break; }
    }
    if (!target) return;
    for (const other of overflow) if (other !== target) permutation = withStateSafe(permutation, other, "none");
    const changed = [state, ...overflow].some(name => permutation.getState(name as never) !== current.getState(name as never));
    if (changed) block.setPermutation(permutation);
  }
  catch { /* estado inexistente neste bloco */ }
}

/** `withState` que devolve a mesma permutação se o valor não existir no estado. */
function withStateSafe(permutation: BlockPermutation, state: string, value: string | number | boolean): BlockPermutation {
  try { return permutation.withState(state as never, value as never); }
  catch { return permutation; }
}

/** Sons das máquinas: eventos de bloco do Cobblemon (sounds.json, importados como `cobblemon.block.*`). */
const SOUNDS: Record<string, string> = {
  fossilAssemble: "cobblemon.block.fossil_machine.assemble",
  fossilInsert: "cobblemon.block.fossil_machine.insert_fossil",
  fossilRetrieve: "cobblemon.block.fossil_machine.retrieve_fossil",
  dnaInsert: "cobblemon.block.fossil_machine.insert_dna",
  dnaFull: "cobblemon.block.fossil_machine.dna_full",
  fossilStart: "cobblemon.block.fossil_machine.activate",
  fossilFinished: "cobblemon.block.fossil_machine.finished",
  fossilUnprotected: "cobblemon.block.fossil_machine.unprotected",
  pokemonRetrieve: "cobblemon.block.fossil_machine.retrieve_pokemon",
  dnaInsertSmall: "cobblemon.block.fossil_machine.insert_dna_small",
  fossilLoop: "cobblemon.block.fossil_machine.active_loop",
  monitorInsert: "cobblemon.block.monitor.insert",
  monitorLoading: "cobblemon.block.monitor.loading",
  monitorGlitching: "cobblemon.block.monitor.glitching",
  pcOn: "cobblemon.pc.on",
  pcOff: "cobblemon.pc.off",
  potPlace: "cobblemon.block.campfire_pot.place",
  /** CampfirePotItem.useOn: panela posta numa fogueira. */
  potSet: "cobblemon.block.campfire_pot.set",
  /** CampfireBlock.removePotItem. */
  potRetrieve: "cobblemon.block.campfire_pot.retrieve",
  /** CookingPotResultSlot.onTake. */
  potTakeItem: "cobblemon.block.campfire_pot.take_item",
  potOpen: "cobblemon.block.campfire_pot.open",
  potClose: "cobblemon.block.campfire_pot.close",
  potCook: "cobblemon.block.campfire_pot.cook",
  potActive: "cobblemon.block.campfire_pot.active",
  potAmbient: "cobblemon.block.campfire_pot.ambient",
  tmOpen: "cobblemon.block.tm_machine.open",
  tmClose: "cobblemon.block.tm_machine.close",
  tmStart: "cobblemon.block.tm_machine.start",
  tmBurn: "cobblemon.block.tm_machine.burn_loop",
  tmCraft: "cobblemon.block.tm_machine.craft",
  tmInsert: "cobblemon.block.tm_machine.tm_insert",
  tmRetrieve: "cobblemon.block.tm_machine.tm_retrieve",
  tmItemInsert: "cobblemon.block.tm_machine.item_insert",
  tmItemRetrieve: "cobblemon.block.tm_machine.item_retrieve",
  healingActive: "cobblemon.block.healing_machine.active",
  itemAdd: "cobblemon.block.display_case.add_item",
  itemRemove: "cobblemon.block.display_case.remove_item",
  eat: "random.eat",
  monitorBreak: "cobblemon.block.monitor.break",
  explode: "random.explode",
  brewing: "random.potion.brewed",
};

export function playMachineSound(dimension: Dimension, loc: Vector3, sound: keyof typeof SOUNDS | string, volume = 1, pitch = 1) {
  try { dimension.playSound(SOUNDS[sound] ?? sound, { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, { volume, pitch }); }
  catch { /* som inexistente */ }
}

/** Id do som de máquina (chave de SOUNDS ou id direto). */
export function machineSoundId(sound: string): string {
  return SOUNDS[sound] ?? sound;
}

/**
 * Duração (ticks) dos sons em loop do Cobblemon (arquivos .ogg de assets/cobblemon/sounds). O Java toca estes sons
 * com repetição pelo BlockEntitySoundTracker e os cancela quando a máquina para.
 */
export const LOOP_TICKS: Record<string, number> = {
  tmBurn: 80,
  fossilLoop: 160,
  monitorLoading: 250,
  monitorGlitching: 250,
  potActive: 360,
  potAmbient: 360,
};

/** Loops ativos: `<chave do bloco>|<som>` → tick do próximo toque. */
const activeLoops = new Map<string, number>();

/**
 * Mantém um som em loop numa máquina (chamar a cada tick da máquina enquanto a condição valer). O Bedrock não tem
 * som posicional cancelável: o som é tocado de novo ao fim da duração dele e, ao parar (`stopMachineLoop`), um
 * `/stopsound` corta o som nos jogadores por perto.
 */
export function keepMachineLoop(dimension: Dimension, loc: Vector3, key: string, sound: string, now: number, volume = 1) {
  const id = `${key}|${sound}`;
  const next = activeLoops.get(id);
  if (next !== undefined && now < next) return;
  activeLoops.set(id, now + (LOOP_TICKS[sound] ?? 100));
  playMachineSound(dimension, loc, sound, volume);
}

/** Para um loop iniciado por keepMachineLoop (sem efeito se não estiver tocando). */
export function stopMachineLoop(dimension: Dimension, loc: Vector3, key: string, sound: string) {
  const id = `${key}|${sound}`;
  if (!activeLoops.delete(id)) return;
  stopSoundNear(dimension, loc, machineSoundId(sound));
}

/** Loop ativo? (testes) */
export function isMachineLoopActive(key: string, sound: string): boolean {
  return activeLoops.has(`${key}|${sound}`);
}

/** `/stopsound` nos jogadores a até 32 blocos (corta um som posicional que ainda está tocando). */
export function stopSoundNear(dimension: Dimension, loc: Vector3, soundId: string) {
  try { dimension.runCommand(`stopsound @a[x=${Math.floor(loc.x)},y=${Math.floor(loc.y)},z=${Math.floor(loc.z)},r=32] ${soundId}`); }
  catch { /* sem jogadores / comando indisponível */ }
}

export interface ObtainOptions {
  level: number;
  shiny?: boolean;
  alpha?: boolean;
}

/** Aspects/marca de Alfa (mesma regra de scripts/spawning/Spawner.ts). */
const ALPHA_ASPECTS = ["alpha", "alpha_eyes"];
const ALPHA_MARK = "cobblemon:mark_alpha";

/** Cria os dados de um Pokémon (sem entidade) com nível, shiny e Alfa. Undefined se a espécie não existir. */
export function createPokemonData(species: string, options: ObtainOptions): PokemonData | undefined {
  if (!getSpeciesData(species)) return undefined;
  const data = PokemonData.generateNewWildPokemon(species, {
    level: options.level,
    shiny: options.shiny,
    aspects: options.alpha ? [...ALPHA_ASPECTS] : [],
    movesetBuilder: options.alpha ? "alpha" : undefined,
  });
  if (options.alpha) {
    if (!data.marks.includes(ALPHA_MARK)) data.marks.push(ALPHA_MARK);
    data.activeMark = ALPHA_MARK;
  }
  return data;
}

/** `Random.nextInt(chance) == 0` do Kotlin (chance ≤ 0 nunca). */
export function rollOneIn(chance: number, random: () => number = Math.random): boolean {
  return chance > 0 && Math.floor(random() * chance) === 0;
}

/** Shiny pela taxa global do Cobblemon (PokemonProperties.roll). */
export function rollGlobalShiny(random: () => number = Math.random): boolean {
  const rate = getConfig().shinyRate;
  return rate > 0 && random() * rate < 1;
}

/** Dá um Pokémon ao jogador (time → PC), registra na Pokédex e avisa se foi para o PC. */
export function givePokemon(player: Player, data: PokemonData, ball = "cobblemon:poke_ball") {
  data.pokeball = ball;
  if (!data.ogTrainer) data.ogTrainer = player.name;
  data.trainer = player.id;
  const msg = storePokemonInFirstSpace(data, player);
  markCaught(player, data);
  if (msg) player.sendMessage(msg);
}

/** Cria a entidade selvagem (mesmos passos de spawnActionEntity). */
export function spawnWildPokemon(dimension: Dimension, location: Vector3, data: PokemonData): Entity | undefined {
  let entity: Entity | undefined;
  try {
    entity = dimension.spawnEntity(data.getEntityId() as never, location);
    data.applyToCobblemon(entity);
    entity.setProperty("cobblemon:wild", true);
    entity.triggerEvent("cobblemon:set_wild");
    if (data.aspects.includes("alpha")) {
      entity.addTag("cobblemon_alpha");
      try { if (entity.getProperty("cobblemon:alpha") !== undefined) entity.triggerEvent("cobblemon:set_alpha"); }
      catch { /* sem suporte a Alfa */ }
    }
    try { entity.setDynamicProperty("cobblemon:spawn_time", world.getAbsoluteTime()); }
    catch { /* sem relógio absoluto */ }
    return entity;
  }
  catch (e) {
    console.warn(`[máquinas] falha ao criar ${data.species}: ${e}`);
    try { if (entity?.isValid) entity.remove(); }
    catch { /* já removida */ }
    return undefined;
  }
}

/** Item de Poké Ball (ITEMS[id].category === "poke_ball"). */
export function isPokeBallItem(id: string | undefined): boolean {
  if (!id?.startsWith("cobblemon:")) return false;
  return ITEMS[id.slice("cobblemon:".length)]?.category === "poke_ball";
}
