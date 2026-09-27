/**
 * Regras da máquina de fósseis (FossilMultiblockStructure.kt / Fossils.kt / NaturalMaterials.kt do Cobblemon
 * 1.8.2), sem API do Minecraft: combinação de fósseis, material orgânico, tempo e tela do monitor.
 */
import { FOSSILS, FossilDef, NATURAL_MATERIALS, NaturalMaterialDef } from "./data";
import { itemHasTag } from "./itemUtil";

export const TICKS_PER_MINUTE = 1200;
/** Material orgânico para ligar a máquina. */
export const MATERIAL_TO_START = 128;
/** 12 minutos. */
export const TIME_TO_TAKE = TICKS_PER_MINUTE * 12;
export const TIME_PER_STAGE = TIME_TO_TAKE / 8;
/** Depois de pronto, só o dono pode retirar por 5 minutos. */
export const PROTECTION_TIME = TICKS_PER_MINUTE * 5;

/** Estado persistido da estrutura (analisador + monitor em cima + tanque ao lado). */
export interface FossilMachineState {
  dimension: string;
  analyzer: [number, number, number];
  monitor: [number, number, number];
  tank: [number, number, number];
  /** Material orgânico (0..128). */
  organic: number;
  /** Itens de fóssil inseridos (ids), na ordem. */
  fossils: string[];
  /** Id do fóssil (data/cobblemon/fossils) que os itens formam, se algum. */
  result?: string;
  /** Ticks restantes; -1 = parada. */
  time: number;
  /** Pokémon pronto no tanque. */
  created: boolean;
  /** Ticks de proteção; -1 = sem proteção. */
  protection: number;
  owner?: string;
  ownerName?: string;
}

export function newFossilMachine(dimension: string, analyzer: [number, number, number], monitor: [number, number, number], tank: [number, number, number]): FossilMachineState {
  return { dimension, analyzer, monitor, tank, organic: 0, fossils: [], time: -1, created: false, protection: -1 };
}

/** Fossil.matchesIngredients: mesmo número de itens e cada fóssil exigido presente entre os itens. */
export function matchesIngredients(fossil: FossilDef, items: readonly string[]): boolean {
  if (fossil.fossils.length !== items.length) return false;
  return fossil.fossils.every(f => items.includes(f));
}

/** Fossils.getFossilByItemStacks. */
export function findFossil(items: readonly string[], fossils: readonly FossilDef[] = FOSSILS): FossilDef | undefined {
  return fossils.find(f => matchesIngredients(f, items));
}

export function fossilById(id: string | undefined): FossilDef | undefined {
  return id ? FOSSILS.find(f => f.id === id) : undefined;
}

/** Fossils.isFossilIngredient. */
export function isFossilIngredient(item: string, fossils: readonly FossilDef[] = FOSSILS): boolean {
  return fossils.some(f => f.fossils.includes(item));
}

function naturalMaterial(item: string, materials: readonly NaturalMaterialDef[] = NATURAL_MATERIALS): NaturalMaterialDef | undefined {
  // Itens exatos têm prioridade sobre tags; o último registro de um mesmo item vence (reload do Cobblemon).
  let byItem: NaturalMaterialDef | undefined;
  for (const m of materials) if (m.item === item) byItem = m;
  if (byItem) return byItem;
  return materials.find(m => m.tag && itemHasTag(item, m.tag));
}

/** NaturalMaterials.getContent. */
export function naturalMaterialContent(item: string): number | undefined {
  return naturalMaterial(item)?.content;
}

export function naturalMaterialReturnItem(item: string): string | undefined {
  return naturalMaterial(item)?.returnItem;
}

export function isRunning(m: FossilMachineState): boolean {
  return m.time > 0;
}

/** updateFossilType. */
export function updateFossilType(m: FossilMachineState) {
  m.result = m.fossils.length ? findFossil(m.fossils)?.id : undefined;
}

/**
 * Insere um item de fóssil. Como no Cobblemon, recusa com a máquina ligada/pronta e quando
 * `fossils.length > maxInserted` (o 1.8.2 compara com ">" — com o padrão 2, cabem 3 itens).
 */
export function insertFossil(m: FossilMachineState, item: string, maxInserted: number, owner?: { id: string; name: string }): boolean {
  if (isRunning(m) || m.created || !isFossilIngredient(item)) return false;
  if (m.fossils.length > maxInserted) return false;
  m.fossils.push(item);
  if (owner) {
    m.owner = owner.id;
    m.ownerName = owner.name;
  }
  updateFossilType(m);
  return true;
}

/** Mão vazia: devolve o último fóssil (máquina parada e vazia de Pokémon). */
export function takeLastFossil(m: FossilMachineState): string | undefined {
  if (isRunning(m) || m.created || !m.fossils.length) return undefined;
  const item = m.fossils.pop();
  updateFossilType(m);
  return item;
}

/** insertOrganicMaterial: soma o conteúdo (limitado a 128). */
export function insertOrganic(m: FossilMachineState, item: string): boolean {
  const content = naturalMaterialContent(item);
  if (isRunning(m) || m.created || m.organic >= MATERIAL_TO_START || content === undefined) return false;
  if (content <= 0 && m.organic === 0) return false;
  m.organic = Math.max(0, Math.min(MATERIAL_TO_START, m.organic + content));
  return true;
}

export type FossilTickEvent = "start" | "stage" | "finished" | "unprotected";

/**
 * Avança `ticks` ticks (FossilMultiblockStructure.tick agregado). Devolve os eventos ocorridos.
 * Liga sozinha quando há 128 de material e uma combinação válida.
 */
export function tickFossilMachine(m: FossilMachineState, ticks: number): FossilTickEvent[] {
  const events: FossilTickEvent[] = [];
  if (m.protection > 0) {
    m.protection = Math.max(0, m.protection - ticks);
    if (m.protection === 0) {
      m.protection = -1;
      m.owner = undefined;
      m.ownerName = undefined;
      events.push("unprotected");
    }
  }
  if (m.created) return events;
  if (m.time === -1) {
    if (m.organic >= MATERIAL_TO_START && m.result) {
      m.time = TIME_TO_TAKE;
      events.push("start");
    }
    return events;
  }
  const before = m.time;
  m.time = Math.max(0, m.time - ticks);
  if (Math.floor(before / TIME_PER_STAGE) !== Math.floor(m.time / TIME_PER_STAGE)) events.push("stage");
  if (m.time === 0) {
    m.fossils = [];
    m.created = true;
    if (m.owner) m.protection = PROTECTION_TIME;
    // stopMachine
    m.time = -1;
    m.organic = 0;
    events.push("finished");
  }
  return events;
}

/** Retirada (Poké Ball ou quebra): zera o estado do Pokémon pronto. */
export function clearCreated(m: FossilMachineState) {
  m.created = false;
  m.owner = undefined;
  m.ownerName = undefined;
  m.protection = -1;
  m.fossils = [];
  updateFossilType(m);
}

/** Tela do monitor (updateProgress / getProgressScreen). */
export function monitorScreen(m: FossilMachineState): string {
  if (m.protection > 0) return "green_progress_9";
  if (m.time <= 0) return "off";
  const stage = Math.floor((TIME_TO_TAKE - m.time) / TIME_PER_STAGE);
  return stage >= 0 && stage <= 8 ? `blue_progress_${stage + 1}` : "off";
}

/** Sinal de comparador do monitor (getAnalogOutputSignal), útil para depuração. */
export function monitorSignal(m: FossilMachineState): number {
  if (m.created) return 15;
  if (!isRunning(m)) return 0;
  return Math.max(15 - Math.floor(m.time * 15 / TIME_TO_TAKE), 1);
}

/** O dono ainda tem prioridade de retirada. */
export function isProtectedFrom(m: FossilMachineState, playerId: string): boolean {
  return m.created && m.protection > 0 && !!m.owner && m.owner !== playerId;
}
