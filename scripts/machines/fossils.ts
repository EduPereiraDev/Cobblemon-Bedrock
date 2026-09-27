/**
 * Máquina de fósseis no mundo: fossil_analyzer + monitor em cima + restoration_tank (2 blocos) ao lado.
 * Estado em MachineStore("fossil") pela posição do analisador; cada parte aponta para ele em
 * MachineStore("fossil_part"). O monitor sozinho aceita TM/disco (tela) e Upgrade/Dubious Disc (Porygon).
 */
import { Block, Dimension, ItemStack, Player, system, Vector3 } from "@minecraft/server";
import { getConfig } from "../Config";
import { blockKey, MachineStore, parseBlockKey } from "./store";
import {
  clearCreated, FossilMachineState, fossilById, insertFossil, insertOrganic, isFossilIngredient, isProtectedFrom, isRunning,
  MATERIAL_TO_START, monitorScreen, naturalMaterialContent, naturalMaterialReturnItem, newFossilMachine, takeLastFossil,
  tickFossilMachine, TIME_TO_TAKE,
} from "./fossilLogic";
import {
  add, createPokemonData, dimensionById, directionVector, fromTuple, getState, givePokemon, HORIZONTAL, isPokeBallItem,
  keepMachineLoop, loadedBlock, MK, playMachineSound, rollGlobalShiny, rollOneIn, setState, spawnWildPokemon, stopMachineLoop, tr, tuple,
} from "./common";
import { consumeHeld, dropAt, giveOrDrop, heldItem, isCreative, SlotItem, toItemStack, toSlotItem } from "./itemUtil";
import { getTMMove, unlockTM } from "./tm";
import { recordResurrection } from "../pokedex/Progress";
import { applyFossilMarks } from "../pokemon/Marks";
import { toSpeciesId } from "../speciesData";
import { fetusProgress, removeFossilFetus, syncFossilFetus } from "./fossilFetus"; // frente mundo-detalhes: feto no tanque

export const ANALYZER = "cobblemon:fossil_analyzer";
export const MONITOR = "cobblemon:monitor";
export const DAMAGED_MONITOR = "cobblemon:damaged_monitor";
export const TANK = "cobblemon:restoration_tank";

export const fossilStore = new MachineStore<FossilMachineState>("fossil");
const partStore = new MachineStore<string>("fossil_part");

interface MonitorState {
  disk?: SlotItem;
  porygon?: "upgrade" | "dubious";
  ticks?: number;
}
const monitorStore = new MachineStore<MonitorState>("monitor");

function keyOf(block: Block) {
  return blockKey(block.dimension.id, block.location);
}

function isTankBottom(block: Block | undefined): boolean {
  return block?.typeId === TANK && getState<string>(block, "cobblemon:part") === "bottom";
}

/** Analisador que controla este bloco (se a estrutura estiver formada). */
export function controllerOf(block: Block): string | undefined {
  return partStore.get(keyOf(block));
}

/**
 * FossilMultiblockBuilder: procura analisador com monitor em cima e tanque (parte de baixo) ao lado,
 * todos livres. Forma a estrutura e devolve a chave do analisador.
 */
export function tryFormStructure(block: Block): string | undefined {
  const existing = controllerOf(block);
  if (existing) return existing;
  const dim = block.dimension;
  const candidates: Block[] = [];
  if (block.typeId === ANALYZER) candidates.push(block);
  else if (block.typeId === MONITOR) { const b = block.below(); if (b) candidates.push(b); }
  else if (block.typeId === TANK) {
    const bottom = getState<string>(block, "cobblemon:part") === "top" ? block.below() : block;
    if (bottom) for (const d of HORIZONTAL) { const b = loadedBlock(dim, add(bottom.location, d)); if (b) candidates.push(b); }
  }
  for (const analyzer of candidates) {
    if (analyzer.typeId !== ANALYZER || partStore.has(keyOf(analyzer))) continue;
    const monitor = analyzer.above();
    if (monitor?.typeId !== MONITOR || partStore.has(keyOf(monitor))) continue;
    const tank = HORIZONTAL.map(d => loadedBlock(dim, add(analyzer.location, d))).find(b => isTankBottom(b) && !partStore.has(keyOf(b!)));
    if (!tank) continue;
    return formStructure(analyzer, monitor, tank);
  }
  return undefined;
}

function formStructure(analyzer: Block, monitor: Block, tank: Block): string {
  const dim = analyzer.dimension;
  const key = keyOf(analyzer);
  // O monitor solta o disco que tiver ao virar parte da máquina (dropDisk).
  const monitorKey = keyOf(monitor);
  const loose = monitorStore.get(monitorKey);
  if (loose?.disk) dropAt(dim, monitor.location, toItemStack(loose.disk));
  if (loose?.porygon) dropAt(dim, monitor.location, new ItemStack(loose.porygon === "upgrade" ? "cobblemon:upgrade" : "cobblemon:dubious_disc", 1));
  monitorStore.delete(monitorKey);
  fossilStore.set(key, newFossilMachine(dim.id, tuple(analyzer.location), tuple(monitor.location), tuple(tank.location)));
  for (const part of [analyzer.location, monitor.location, tank.location, add(tank.location, { x: 0, y: 1, z: 0 })])
    partStore.set(blockKey(dim.id, part), key);
  setState(monitor, "cobblemon:screen", "off");
  playMachineSound(dim, analyzer.location, "fossilAssemble");
  return key;
}

function blocksOf(m: FossilMachineState, dim: Dimension) {
  const tankLoc = fromTuple(m.tank);
  return {
    analyzer: loadedBlock(dim, fromTuple(m.analyzer)),
    monitor: loadedBlock(dim, fromTuple(m.monitor)),
    tank: loadedBlock(dim, tankLoc),
    tankTop: loadedBlock(dim, add(tankLoc, { x: 0, y: 1, z: 0 })),
  };
}

/** Estados visuais: analisador/tanque ligados e tela do monitor. */
function applyVisuals(m: FossilMachineState, dim: Dimension) {
  const b = blocksOf(m, dim);
  const on = m.time >= 0;
  setState(b.analyzer, "cobblemon:on", on);
  setState(b.tankTop, "cobblemon:on", on);
  setState(b.tank, "cobblemon:on", on);
  setState(b.monitor, "cobblemon:screen", monitorScreen(m));
}

/** Pokémon revivido: nível 1, shiny pela taxa global ou 1/fossilMachineShinyChance, Alfa 1/fossilMachineAlphaChance. */
export function createRevivedPokemon(species: string) {
  const cfg = getConfig();
  const shiny = rollGlobalShiny() || rollOneIn(cfg.fossilMachineShinyChance);
  const alpha = rollOneIn(cfg.fossilMachineAlphaChance);
  return createPokemonData(species, { level: 1, shiny, alpha });
}

function resultSpecies(m: FossilMachineState): string | undefined {
  return fossilById(m.result)?.result;
}

/** Solta o Pokémon pronto como selvagem atrás do tanque (quebra da máquina). */
function releaseWild(m: FossilMachineState, dim: Dimension) {
  const species = resultSpecies(m);
  if (!species) return;
  const data = createRevivedPokemon(species);
  if (!data) return;
  // Sem jogador: as marcas do fóssil ficam só como potenciais (sorteadas na captura).
  try { applyFossilMarks(data, false); }
  catch { /* sem marcas */ }
  const tank = blocksOf(m, dim).tank;
  const facing = tank ? getState<string>(tank, "minecraft:cardinal_direction") : undefined;
  const behind = add(fromTuple(m.tank), directionVector(facing), -2);
  spawnWildPokemon(dim, { x: behind.x + 0.5, y: behind.y, z: behind.z + 0.5 }, data);
}

/** Uma parte foi quebrada/retirada: desfaz a estrutura (playerWillDestroy). */
export function breakStructure(controllerKey: string) {
  const m = fossilStore.get(controllerKey);
  const { dimension: dimId } = parseBlockKey(controllerKey);
  const dim = dimensionById(dimId);
  fossilStore.delete(controllerKey);
  if (!m || !dim) return;
  for (const part of [fromTuple(m.analyzer), fromTuple(m.monitor), fromTuple(m.tank), add(fromTuple(m.tank), { x: 0, y: 1, z: 0 })])
    partStore.delete(blockKey(dimId, part));
  // Fósseis voltam se a máquina não tinha começado ou ainda faltava ≥ 20 ticks.
  if (m.time === -1 || m.time >= 20) for (const f of m.fossils) dropAt(dim, fromTuple(m.analyzer), new ItemStack(f, 1));
  if (m.created) releaseWild(m, dim);
  removeFossilFetus(dim, fromTuple(m.tank));
  m.time = -1;
  m.organic = 0;
  m.fossils = [];
  const b = blocksOf(m, dim);
  setState(b.analyzer, "cobblemon:on", false);
  setState(b.tankTop, "cobblemon:on", false);
  setState(b.tank, "cobblemon:on", false);
  setState(b.monitor, "cobblemon:screen", "off");
}

/** Chamado quando qualquer parte é quebrada (antes ou depois de sumir). */
export function onFossilPartRemoved(dimension: Dimension, location: Vector3, typeId: string) {
  const key = blockKey(dimension.id, location);
  const controller = partStore.get(key);
  if (controller) breakStructure(controller);
  if (typeId === MONITOR || typeId === DAMAGED_MONITOR) {
    const loose = monitorStore.get(key);
    if (loose?.disk) dropAt(dimension, location, toItemStack(loose.disk));
    if (loose?.porygon) dropAt(dimension, location, new ItemStack(loose.porygon === "upgrade" ? "cobblemon:upgrade" : "cobblemon:dubious_disc", 1));
    monitorStore.delete(key);
  }
}

function statusMessage(m: FossilMachineState) {
  const species = resultSpecies(m);
  const pct = isRunning(m) ? Math.floor((TIME_TO_TAKE - m.time) * 100 / TIME_TO_TAKE) : m.created ? 100 : 0;
  return tr(MK.fossilStatus, species ? { translate: `cobblemon.species.${species}.name` } : tr(MK.fossilUnknown), `${m.fossils.length}`, `${m.organic}/${MATERIAL_TO_START}`, `${pct}%`);
}

/** Interação com qualquer parte (useWithoutItem / useItemOn da estrutura). */
export function interactFossilMachine(player: Player, block: Block) {
  // Monitor danificado: decorativo (só reage a redstone no Java).
  if (block.typeId === DAMAGED_MONITOR) return;
  const controller = tryFormStructure(block);
  if (!controller) {
    if (block.typeId === MONITOR) return interactLooseMonitor(player, block);
    player.onScreenDisplay.setActionBar(tr(MK.fossilNoStructure));
    return;
  }
  const m = fossilStore.get(controller);
  if (!m) return;
  const dim = block.dimension;
  const analyzerLoc = fromTuple(m.analyzer);
  const hand = heldItem(player);
  const handId = hand?.typeId;

  // Poké Ball: retirar o Pokémon pronto.
  if (m.created && isPokeBallItem(handId)) {
    if (isProtectedFrom(m, player.id)) {
      player.onScreenDisplay.setActionBar(tr("cobblemon.fossilmachine.protected", m.ownerName ?? "?"));
      return;
    }
    const species = resultSpecies(m);
    const data = species ? createRevivedPokemon(species) : undefined;
    consumeHeld(player, 1);
    if (data) {
      // fossil_revived/apply_marks.molang: marcas potenciais do fóssil, sorteadas na hora (jogador presente).
      try { applyFossilMarks(data, true); }
      catch (e) { console.warn(`[fósseis] marcas: ${e}`); }
      givePokemon(player, data, handId!);
      // Progresso Cobblemon (AdvancementHandler: fósseis revividos), pedido da frente extras-final.
      try { recordResurrection(player, { species: toSpeciesId(data.species), aspects: data.aspects }); }
      catch (e) { console.warn(`[fósseis] progresso: ${e}`); }
      playMachineSound(dim, fromTuple(m.tank), "pokemonRetrieve");
    }
    clearCreated(m);
    fossilStore.set(controller, m);
    applyVisuals(m, dim);
    return;
  }
  if (m.created) {
    player.onScreenDisplay.setActionBar(tr(MK.fossilNeedBall));
    return;
  }
  // Mão vazia: retirar o último fóssil (ou só mostrar o estado).
  if (!hand) {
    const item = takeLastFossil(m);
    if (item) {
      giveOrDrop(player, new ItemStack(item, 1));
      playMachineSound(dim, analyzerLoc, "fossilRetrieve");
      fossilStore.set(controller, m);
    }
    player.onScreenDisplay.setActionBar(statusMessage(m));
    return;
  }
  if (isFossilIngredient(handId!)) {
    if (insertFossil(m, handId!, getConfig().maxInsertedFossilItems, { id: player.id, name: player.name })) {
      consumeHeld(player, 1);
      playMachineSound(dim, analyzerLoc, "fossilInsert");
      fossilStore.set(controller, m);
    }
    player.onScreenDisplay.setActionBar(statusMessage(m));
    return;
  }
  if (naturalMaterialContent(handId!) !== undefined) {
    if (insertOrganic(m, handId!)) {
      if (!isCreative(player)) {
        const ret = naturalMaterialReturnItem(handId!);
        consumeHeld(player, 1);
        if (ret) giveOrDrop(player, new ItemStack(ret, 1));
      }
      playMachineSound(dim, fromTuple(m.tank), m.organic >= MATERIAL_TO_START ? "dnaFull" : dnaInsertSound(controller));
      fossilStore.set(controller, m);
    }
    player.onScreenDisplay.setActionBar(statusMessage(m));
    return;
  }
  player.onScreenDisplay.setActionBar(statusMessage(m));
}

/** Último material inserido por máquina (FossilMultiblockStructure.lastInteraction, só em memória). */
const lastOrganicInsert = new Map<string, number>();

/** Inserções seguidas (< 10 ticks) usam o som curto (insert_dna_small), como no Java. */
export function dnaInsertSound(controller: string, now = system.currentTick): "dnaInsert" | "dnaInsertSmall" {
  const last = lastOrganicInsert.get(controller);
  lastOrganicInsert.set(controller, now);
  return last !== undefined && now - last < 10 ? "dnaInsertSmall" : "dnaInsert";
}

/** Avança todas as máquinas carregadas. */
export function tickFossilMachines(ticks: number) {
  for (const key of fossilStore.keys()) {
    const m = fossilStore.get(key);
    if (!m) { fossilStore.delete(key); continue; }
    const dim = dimensionById(m.dimension);
    if (!dim) continue;
    const analyzer = loadedBlock(dim, fromTuple(m.analyzer));
    if (!analyzer) continue; // chunk descarregado: a máquina pausa, como um block entity
    // Estrutura desmontada por fora (pistão, /setblock, explosão sem evento): desfaz.
    const b = blocksOf(m, dim);
    // Alguma parte em chunk descarregado (borda de chunk): pausa neste tick em vez de desmontar.
    if (!b.monitor || !b.tank || !b.tankTop) continue;
    if (analyzer.typeId !== ANALYZER || b.monitor?.typeId !== MONITOR || !isTankBottom(b.tank)) {
      breakStructure(key);
      continue;
    }
    const events = tickFossilMachine(m, ticks);
    // Laço do tanque enquanto restaura (FossilMultiblockStructure.runningSound).
    if (m.time > 0) keepMachineLoop(dim, fromTuple(m.tank), key, "fossilLoop", system.currentTick, 0.6);
    else stopMachineLoop(dim, fromTuple(m.tank), key, "fossilLoop");
    // Feto no tanque enquanto restaura ou com o Pokémon pronto (RestorationTankRenderer).
    syncFossilFetus(dim, fromTuple(m.tank), isRunning(m) || m.created, m.result, fetusProgress(m.time, TIME_TO_TAKE, m.created), getState<string>(b.tank, "minecraft:cardinal_direction"));
    if (!events.length && m.time < 0 && m.protection < 0) continue;
    for (const e of events) {
      if (e === "start") playMachineSound(dim, fromTuple(m.tank), "fossilStart");
      if (e === "finished") playMachineSound(dim, fromTuple(m.tank), "fossilFinished");
      if (e === "unprotected") playMachineSound(dim, fromTuple(m.tank), "fossilUnprotected");
    }
    fossilStore.set(key, m);
    if (events.length) applyVisuals(m, dim);
  }
  tickLooseMonitors(ticks);
}

// ---------------------------------------------------------------------------------------------
// Monitor sozinho: disco (TM/música) e processo do Porygon

const PORYGON_TIME = 90;
/** Telas de TM do monitor (MonitorBlock.MonitorScreen): uma por tipo. */
const TM_SCREENS = new Set(["bug", "dark", "dragon", "electric", "fairy", "fighting", "fire", "flying", "ghost", "grass", "ground", "ice", "normal", "poison", "psychic", "rock", "steel", "water"]);

function isMusicDisc(id: string) {
  return id.startsWith("minecraft:music_disc");
}

export function diskScreen(disk: SlotItem | undefined): string {
  if (!disk) return "off";
  if (isMusicDisc(disk.id)) return "music";
  const type = getTMMove(toItemStack(disk))?.type;
  // O enum passa de 16 valores: o importador divide em `screen`/`screen_2`/`screen_3` e setState escolhe o certo.
  return type && TM_SCREENS.has(type) ? `tm_${type}` : "off";
}

function interactLooseMonitor(player: Player, block: Block) {
  const key = keyOf(block);
  const state = monitorStore.get(key) ?? {};
  if (state.porygon) return;
  const hand = heldItem(player);
  const id = hand?.typeId;
  if (id === "cobblemon:upgrade" || id === "cobblemon:dubious_disc") {
    if (state.disk) {
      unlockFromDisk(player, state.disk);
      dropAt(block.dimension, block.location, toItemStack(state.disk));
    }
    consumeHeld(player, 1);
    monitorStore.set(key, { porygon: id === "cobblemon:upgrade" ? "upgrade" : "dubious", ticks: 0 });
    setState(block, "cobblemon:screen", id === "cobblemon:dubious_disc" ? "porygon_glitching" : "porygon_grid");
    playMachineSound(block.dimension, block.location, "monitorInsert");
    keepMachineLoop(block.dimension, block.location, key, id === "cobblemon:dubious_disc" ? "monitorGlitching" : "monitorLoading", system.currentTick, 0.8);
    return;
  }
  if (hand && (id === "cobblemon:technical_machine" || isMusicDisc(id!))) {
    if (state.disk) {
      unlockFromDisk(player, state.disk);
      dropAt(block.dimension, block.location, toItemStack(state.disk));
    }
    const disk = toSlotItem(hand, 1);
    consumeHeld(player, 1);
    unlockFromDisk(player, disk);
    monitorStore.set(key, { disk });
    setState(block, "cobblemon:screen", diskScreen(disk));
    playMachineSound(block.dimension, block.location, "monitorInsert");
    return;
  }
  if (!hand && state.disk) {
    unlockFromDisk(player, state.disk);
    dropAt(block.dimension, block.location, toItemStack(state.disk));
    monitorStore.delete(key);
    setState(block, "cobblemon:screen", "off");
  }
}

function unlockFromDisk(player: Player, disk: SlotItem) {
  if (disk.id !== "cobblemon:technical_machine") return;
  const move = getTMMove(toItemStack(disk));
  if (move) unlockTM(player, move.move);
}

function tickLooseMonitors(ticks: number) {
  for (const key of monitorStore.keys()) {
    const state = monitorStore.get(key);
    if (!state?.porygon) continue;
    const { dimension, location } = parseBlockKey(key);
    const dim = dimensionById(dimension);
    const block = dim && loadedBlock(dim, location);
    if (!block) continue;
    if (block.typeId !== MONITOR) { monitorStore.delete(key); continue; }
    state.ticks = (state.ticks ?? 0) + ticks;
    if (state.ticks < PORYGON_TIME) { monitorStore.set(key, state); continue; }
    monitorStore.delete(key);
    // FossilMultiblockEntity: o laço loading/glitching para quando o processo termina.
    stopMachineLoop(block.dimension, block.location, key, state.porygon === "dubious" ? "monitorGlitching" : "monitorLoading");
    completePorygon(block, state.porygon);
  }
}

/** completePorygonProcess + spawnPorygon. */
function completePorygon(block: Block, process: "upgrade" | "dubious") {
  const dim = block.dimension;
  const loc = block.location;
  const facing = getState<string>(block, "minecraft:cardinal_direction");
  if (process === "upgrade") {
    playMachineSound(dim, loc, "monitorBreak");
    // FossilMultiblockEntity: fumaça (LARGE_SMOKE ×10) na frente da tela.
    const front = add(loc, directionVector(facing), -0.6);
    spawnParticles(dim, "minecraft:basic_smoke_particle", { x: front.x + 0.5, y: loc.y + 0.7, z: front.z + 0.5 }, 10, 0.2);
    try {
      block.setType(DAMAGED_MONITOR);
      if (facing) setState(block, "minecraft:cardinal_direction", facing);
    }
    catch { /* bloco inexistente */ }
  }
  else {
    // Dubious Disc: o monitor explode, dropa 1–3 ferros e fere quem estiver perto (a propagação de sculk não é feita).
    try { block.setType("minecraft:air"); }
    catch { /* já removido */ }
    playMachineSound(dim, loc, "explode");
    // EXPLOSION ×3 + SMOKE ×25.
    const center = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
    spawnParticles(dim, "minecraft:large_explosion", center, 3, 0);
    spawnParticles(dim, "minecraft:basic_smoke_particle", center, 25, 0.5);
    dropAt(dim, loc, new ItemStack("minecraft:iron_ingot", 1 + Math.floor(Math.random() * 3)));
    for (const entity of dim.getEntities({ location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: 3 })) {
      try { entity.applyDamage(Math.random() < 0.5 ? 2 : 4); }
      catch { /* entidade sem vida */ }
    }
  }
  let species: string | undefined;
  let level = 20;
  if (process === "upgrade") {
    if (Math.random() < 0.2) { species = "porygon2"; level = 25; }
    else species = "porygon";
  }
  else if (Math.random() < 0.5) { species = "porygonz"; level = 35; }
  if (!species) return;
  const cfg = getConfig();
  const data = createPokemonData(species, { level, shiny: rollOneIn(cfg.monitorShinyRate), alpha: rollOneIn(cfg.monitorAlphaRate) });
  if (!data) return;
  const front = add(loc, directionVector(facing), -1);
  spawnWildPokemon(dim, { x: front.x + 0.5, y: front.y, z: front.z + 0.5 }, data);
}

/** `ServerLevel.sendParticles(count, spread)`: `count` partículas espalhadas até `spread` em cada eixo. */
function spawnParticles(dim: Dimension, id: string, at: Vector3, count: number, spread: number) {
  for (let i = 0; i < count; i++) {
    try { dim.spawnParticle(id, { x: at.x + (Math.random() * 2 - 1) * spread, y: at.y + (Math.random() * 2 - 1) * spread, z: at.z + (Math.random() * 2 - 1) * spread }); }
    catch { return; }
  }
}
