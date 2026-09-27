/**
 * Frente "comparadores": saída de comparador da Healing Machine (#143) e do Metronome (#74), como no Cobblemon 1.8.2
 * (HealingMachineBlock / ActivatableDecorationBlock.getAnalogOutputSignal). Regras e codificação em ./logic.ts.
 *
 * Custo: a cada 8 ticks (como o comparador da panela) só os blocos registrados e carregados; o bloco sem comparador
 * encostado e com os estados zerados sai logo depois de olhar os 4 vizinhos. Registro:
 * - Healing Machine: toda máquina com registro de carga (`cobblemon:healer|...`, criado ao pôr, usar ou no random tick),
 *   relido a cada 200 ticks, mais as registradas por evento;
 * - Metronome (e máquinas sem registro de carga, ex. postas por estrutura): por evento (pôr o bloco, pôr um comparador ao
 *   lado, interagir com o bloco), guardado em dynamic property (`cobblemon:mach:comparator:<posição>`).
 * Mudança de estado por interação ou comparador posto/tirado atualiza no tick seguinte. Quando as faces mudam o bloco é
 * recolocado no mesmo tick (replaceBlock); quando só a força muda basta a permutação.
 * Nenhum dos dois blocos tem `minecraft:redstone_consumer` (nem entrada de redstone no Java), então não há entrada a
 * replicar por script.
 *
 * Sonda (console do servidor, com `scriptevent cobblemon:debug_probes on`):
 *   scriptevent cobblemon:cmp_state <x> <y> <z>              estados, sinal do Java e força nos vizinhos
 *   scriptevent cobblemon:cmp_heal <x> <y> <z> <fração>      grava a carga (fração de máx) da Healing Machine
 *   scriptevent cobblemon:cmp_list                            blocos registrados
 */
import { Block, Dimension, ScriptEventSource, system, world } from "@minecraft/server";
import { replaceBlock } from "./replace";
import { blockKey, MachineStore, parseBlockKey } from "../machines/store";
import { comparatorMask } from "../adaptacoes/potHoppers";
import { isInfinite, maxHealerCharge, readCharge, writeCharge } from "../custom_components/HealingMachineComponent";
import { debugProbesEnabled, getConfig } from "../Config";
import {
  COMPARATOR_FACES_STATE, ComparatorOut, HEALER_CHARGE_STATE, HEALER_HIGH_STATE, healerMeterLevel, healerPower, healerSignal, healerStates,
  HEALING_MACHINE, METRONOME, METRONOME_ACTIVE_STATE, metronomeSignal, metronomeStates,
} from "./logic";

export const COMPARATOR_INTERVAL = 8;
const RESCAN_INTERVAL = 200;
const HEALER_PREFIX = "cobblemon:healer|";
const TARGETS = new Set([HEALING_MACHINE, METRONOME]);
const COMPARATORS = new Set(["minecraft:unpowered_comparator", "minecraft:powered_comparator"]);
const H4 = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];

const store = new MachineStore<1>("comparator");
let healerKeys = new Set<string>();

function warn(msg: string) {
  console.warn(`[comparadores] ${msg}`);
}

/** `cobblemon:healer|<dim>|x,y,z` → chave de posição. */
export function healerKeyToBlockKey(id: string): string | undefined {
  if (!id.startsWith(HEALER_PREFIX)) return undefined;
  const [dimension, xyz] = id.slice(HEALER_PREFIX.length).split("|");
  const parts = (xyz ?? "").split(",").map(Number);
  if (!dimension || parts.length !== 3 || !parts.every(Number.isFinite)) return undefined;
  return blockKey(dimension, { x: parts[0], y: parts[1], z: parts[2] });
}

function rescanHealers() {
  const next = new Set<string>();
  for (const id of world.getDynamicPropertyIds()) {
    const key = healerKeyToBlockKey(id);
    if (key) next.add(key);
  }
  healerKeys = next;
}

export function register(block: Block) {
  const key = blockKey(block.dimension.id, block.location);
  if (!store.has(key)) store.set(key, 1);
}

/** Sinal do Java para o bloco (para a sonda). */
export function javaSignal(block: Block): number {
  if (block.typeId === METRONOME) return metronomeSignal(block.permutation.getState(METRONOME_ACTIVE_STATE as never) === true);
  if (block.typeId === HEALING_MACHINE) return healerSignal(readCharge(block), maxHealerCharge());
  return 0;
}

function applyStates(block: Block, out: ComparatorOut): boolean {
  const perm = block.permutation;
  const healer = block.typeId === HEALING_MACHINE;
  const facesChanged = perm.getState(COMPARATOR_FACES_STATE as never) !== out.mask;
  if (!facesChanged && (!healer || perm.getState(HEALER_HIGH_STATE as never) === out.high)) return false;
  let next = perm.withState(COMPARATOR_FACES_STATE as never, out.mask as never);
  if (healer) next = next.withState(HEALER_HIGH_STATE as never, out.high as never);
  if (facesChanged) replaceBlock(block, next);
  else block.setPermutation(next);
  return true;
}

/** Atualiza os estados de saída de um bloco carregado. Devolve se mudou. */
export function updateBlock(block: Block): boolean {
  if (!TARGETS.has(block.typeId)) return false;
  const perm = block.permutation;
  const faces = perm.getState(COMPARATOR_FACES_STATE as never);
  // Pack sem os estados (import antigo): nada a fazer.
  if (faces === undefined) return false;
  const mask = comparatorMask(block);
  if (mask === 0 && faces === 0) return false;
  if (block.typeId === METRONOME) return applyStates(block, metronomeStates(perm.getState(METRONOME_ACTIVE_STATE as never) === true, mask));
  if (mask === 0) return applyStates(block, { mask: 0, high: false });
  const max = maxHealerCharge();
  const charge = readCharge(block);
  const infinite = getConfig().infiniteHealerCharge === true || isInfinite(block);
  let level = Number(perm.getState(HEALER_CHARGE_STATE as never) ?? 0);
  // O medidor do bloco só é refeito no random tick; o sinal sai dele, então é refeito aqui quando está velho
  // (o Java atualiza CHARGE_LEVEL a cada tick). Durante a cura a carga fica parada, como no Java.
  if (perm.getState("cobblemon:busy" as never) !== true && healerMeterLevel(charge, max, infinite) !== level) {
    writeCharge(block, charge);
    level = Number(block.permutation.getState(HEALER_CHARGE_STATE as never) ?? level);
  }
  return applyStates(block, healerStates(level, healerSignal(charge, max), mask));
}

function loadedBlock(key: string): Block | undefined {
  const { dimension, location } = parseBlockKey(key);
  let dim: Dimension;
  try { dim = world.getDimension(dimension); }
  catch { return undefined; }
  try { return dim.isChunkLoaded(location) ? dim.getBlock(location) : undefined; }
  catch { return undefined; }
}

export function tickKey(key: string) {
  const block = loadedBlock(key);
  if (!block) return;
  if (!TARGETS.has(block.typeId)) {
    if (store.has(key)) store.delete(key);
    return;
  }
  updateBlock(block);
}

export function tickAll() {
  const keys = new Set([...store.keys(), ...healerKeys]);
  for (const key of keys) {
    try { tickKey(key); }
    catch (e) { warn(`${key}: ${e}`); }
  }
}

function neighbors(block: Block): Block[] {
  const out: Block[] = [];
  for (const o of H4) {
    try {
      const n = block.dimension.getBlock({ x: block.location.x + o.x, y: block.location.y, z: block.location.z + o.z });
      if (n) out.push(n);
    } catch { /* fora do mundo */ }
  }
  return out;
}

/** Registra e atualiza no tick seguinte (a interação/colocação termina de gravar o bloco antes). */
function touch(block: Block) {
  if (!TARGETS.has(block.typeId)) return;
  register(block);
  const key = blockKey(block.dimension.id, block.location);
  system.run(() => { try { tickKey(key); } catch (e) { warn(`${key}: ${e}`); } });
}

function subscribeEvents() {
  world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    try {
      if (TARGETS.has(block.typeId)) touch(block);
      else if (COMPARATORS.has(block.typeId)) neighbors(block).forEach(touch);
    } catch (e) { warn(`place: ${e}`); }
  });
  world.afterEvents.playerInteractWithBlock.subscribe(({ block }) => {
    try { if (TARGETS.has(block.typeId)) touch(block); }
    catch (e) { warn(`interact: ${e}`); }
  });
  world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    try {
      const id = brokenBlockPermutation.type.id;
      if (TARGETS.has(id)) store.delete(blockKey(block.dimension.id, block.location));
      else if (COMPARATORS.has(id)) neighbors(block).forEach(touch);
    } catch (e) { warn(`break: ${e}`); }
  });
}

// ---------------------------------------------------------------------------------------------
// Sonda

function describe(block: Block): string {
  const power = (b: Block) => { try { return b.getRedstonePower(); } catch { return undefined; } };
  const perm = block.permutation;
  const level = Number(perm.getState(HEALER_CHARGE_STATE as never) ?? 0);
  const high = perm.getState(HEALER_HIGH_STATE as never) === true;
  const faces = Number(perm.getState(COMPARATOR_FACES_STATE as never) ?? 0);
  const emitted = faces === 0 ? 0 : block.typeId === HEALING_MACHINE ? healerPower(level, high) : block.typeId === METRONOME ? metronomeSignal(perm.getState(METRONOME_ACTIVE_STATE as never) === true) : 0;
  let light: number | undefined;
  try { light = block.dimension.getLightLevel({ x: block.location.x, y: block.location.y + 1, z: block.location.z }); }
  catch { light = undefined; }
  const around = ["norte", "leste", "sul", "oeste"].map((name, i) => {
    const o = H4[i];
    try {
      const n = block.dimension.getBlock({ x: block.location.x + o.x, y: block.location.y, z: block.location.z + o.z });
      const far = block.dimension.getBlock({ x: block.location.x + 2 * o.x, y: block.location.y, z: block.location.z + 2 * o.z });
      const dir = n?.permutation.getState("minecraft:cardinal_direction" as never);
      return `${name}=${n?.typeId.replace("minecraft:", "")}${dir !== undefined ? `(${String(dir)})` : ""} p=${n ? power(n) : "-"} | ${far?.typeId.replace("minecraft:", "")} p=${far ? power(far) : "-"}`;
    } catch { return `${name}=-`; }
  });
  const charge = block.typeId === HEALING_MACHINE ? ` carga=${readCharge(block).toFixed(3)}/${maxHealerCharge()}` : "";
  return `${block.typeId} ${JSON.stringify(perm.getAllStates())}${charge} java=${javaSignal(block)} emitido=${emitted} máscara=${comparatorMask(block)} redstone=${power(block)} luz_acima=${light} :: ${around.join(" ; ")}`;
}

function probe(id: string, args: string[]) {
  const [x, y, z] = args.slice(0, 3).map(Number);
  const loc = [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
  const block = loc ? world.getDimension("overworld").getBlock(loc) : undefined;
  if (id === "list") return warn(`registrados: ${store.keys().join(" ")} | cargas: ${[...healerKeys].join(" ")}`);
  if (!block) return warn("uso: cmp_state|cmp_heal <x> <y> <z> [fração]");
  if (id === "heal" && block.typeId === HEALING_MACHINE) {
    writeCharge(block, Math.max(0, Math.min(1, Number(args[3]) || 0)) * maxHealerCharge(), false);
    register(block);
    updateBlock(block);
  }
  warn(describe(block));
}

let started = false;

export function startComparadores() {
  if (started) return;
  started = true;
  try { rescanHealers(); }
  catch (e) { warn(`rescan: ${e}`); }
  subscribeEvents();
  system.runInterval(() => { try { rescanHealers(); } catch (e) { warn(`rescan: ${e}`); } }, RESCAN_INTERVAL);
  system.runInterval(tickAll, COMPARATOR_INTERVAL);
  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (!event.id.startsWith("cobblemon:cmp_") || event.sourceEntity || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    try { probe(event.id.slice("cobblemon:cmp_".length), event.message.trim().split(/\s+/).filter(Boolean)); }
    catch (e) { warn(`sonda: ${e}`); }
  });
}
