import { Vector3, BlockCustomComponent, BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent, system, Block, BlockComponentRandomTickEvent, BlockComponentPlayerPlaceBeforeEvent, GameMode, Dimension, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { canBeHealed, getSafeTeam, getTeam, healPlayerPC, healPlayerTeam } from "../pokemonStorage";
import { message } from "../language";
import { cleanUpStaleBattleData } from "../battle";
import { getPokeballEntityName } from "../catching";
import { getConfig, getGameRule } from "../Config";

const ticksPerPokeballPlace = 10;
const waitTicks = 10;
/** Maior valor do estado `cobblemon:charge` do bloco (medidor visual). */
const CHARGE_STATE_MAX = 15;

/**
 * Carga da máquina (HealingMachineBlockEntity.healingCharge): float de 0 a `maxHealerCharge` (mín. 6), que enche
 * em `secondsToChargeHealingMachine` segundos. O Bedrock não tem block entity: a carga e o tick em que foi medida
 * ficam numa dynamic property do mundo por posição; o estado `cobblemon:charge` (0..15) é só o medidor.
 *
 * O tick é o do relógio `healerClock` (ticks do servidor, persistente), não `world.getAbsoluteTime()`: o TICKER do Java
 * soma `chargePerTick` a cada tick do servidor, e o tempo absoluto do Bedrock para com `doDaylightCycle false`
 * (medido: a carga ficava parada). Como no Java, não há recarga "offline": o relógio não anda com o servidor parado, e
 * a máquina com o chunk descarregado (block entity sem tick) fica parada (`trackUnloadedHealers`).
 */
interface ChargeRecord {
  c: number;
  /** Tick de `healerClock` em que `c` foi medida. */
  s?: number;
  /** Registro antigo: tick de `world.getAbsoluteTime()` (lido uma vez e regravado com `s`). */
  t?: number;
  /** Colocada no criativo: carga infinita (HealingMachineBlockEntity.infinite). */
  i?: boolean;
}

const HEALER_PREFIX = "cobblemon:healer|";
/** Relógio persistente (ticks do servidor já contados em sessões anteriores). */
const CLOCK_PROPERTY = "cobblemon:healer_clock";
/** A cada quantos ticks o relógio é gravado e as máquinas descarregadas são conferidas. */
export const CLOCK_SAVE_INTERVAL = 20;
/** A cada quantos ticks a lista de máquinas é relida das dynamic properties. */
const HEALER_RESCAN_INTERVAL = 200;

function chargeKey(block: Block): string {
  const { x, y, z } = block.location;
  return `${HEALER_PREFIX}${block.dimension.id}|${x},${y},${z}`;
}

function absoluteTick(): number {
  try { return world.getAbsoluteTime(); }
  catch { return system.currentTick; }
}

/** `healerClock() = clockOffset + system.currentTick`; undefined até o mundo carregar. */
let clockOffset: number | undefined;

/** Liga o relógio a partir do valor gravado (worldLoad ou primeiro uso) e o grava a cada CLOCK_SAVE_INTERVAL ticks. */
export function startHealerClock() {
  if (clockOffset !== undefined) return;
  let saved = 0;
  try {
    const raw = world.getDynamicProperty(CLOCK_PROPERTY);
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) saved = raw;
  } catch { }
  clockOffset = saved - system.currentTick;
  system.runInterval(() => {
    try { world.setDynamicProperty(CLOCK_PROPERTY, healerClock()); } catch { }
    try { trackUnloadedHealers(); } catch { }
  }, CLOCK_SAVE_INTERVAL);
  system.runInterval(() => { try { rescanHealers(); } catch { } }, HEALER_RESCAN_INTERVAL);
  try { rescanHealers(); } catch { }
  try { migrateLegacyRecords(); } catch { }
}

/** Só para os testes: esquece o relógio em memória. */
export function resetHealerClockForTests() {
  clockOffset = undefined;
  knownHealers.clear();
  unloadedSince.clear();
}

/** Ticks do servidor contados desde a criação do mundo (com este relógio), persistentes entre reinícios. */
export function healerClock(): number {
  if (clockOffset === undefined) startHealerClock();
  return (clockOffset ?? 0) + system.currentTick;
}

world.afterEvents.worldLoad.subscribe(() => { try { startHealerClock(); } catch { } });

/** Máquinas com registro de carga (chave da dynamic property). */
const knownHealers = new Set<string>();
/** Máquina com o chunk descarregado → `healerClock()` em que foi vista assim. */
const unloadedSince = new Map<string, number>();

function rescanHealers() {
  for (const id of world.getDynamicPropertyIds()) if (id.startsWith(HEALER_PREFIX)) knownHealers.add(id);
}

/**
 * Registros antigos (tick de `getAbsoluteTime`): grava a carga de agora com o tick do relógio, uma vez ao carregar o
 * mundo. Sem isso, com `doDaylightCycle false` eles ficariam parados até o próximo random tick.
 */
function migrateLegacyRecords() {
  const max = maxHealerCharge();
  const now = healerClock();
  for (const id of knownHealers) {
    const record = readRecord(id);
    if (!record || typeof record.s === "number" || typeof record.t !== "number") continue;
    const next: ChargeRecord = { c: chargeFromRecord(record, max, now, absoluteTick), s: now, ...(record.i ? { i: true } : {}) };
    try { world.setDynamicProperty(id, JSON.stringify(next)); } catch { }
  }
}

function parseChargeKey(id: string): { dimension: string; location: Vector3 } | undefined {
  const [dimension, xyz] = id.slice(HEALER_PREFIX.length).split("|");
  const parts = (xyz ?? "").split(",").map(Number);
  if (!dimension || parts.length !== 3 || !parts.every(Number.isFinite)) return undefined;
  return { dimension, location: { x: parts[0], y: parts[1], z: parts[2] } };
}

function readRecord(id: string): ChargeRecord | undefined {
  try {
    const raw = world.getDynamicProperty(id);
    return typeof raw === "string" ? JSON.parse(raw) as ChargeRecord : undefined;
  } catch { return undefined; }
}

/**
 * Máquina com o chunk descarregado não recarrega (no Java o TICKER só roda com o chunk carregado): quando o chunk
 * volta, o tick do registro anda o tempo que ficou fora. Granularidade de CLOCK_SAVE_INTERVAL ticks.
 */
export function trackUnloadedHealers(now = healerClock()) {
  for (const id of knownHealers) {
    const pos = parseChargeKey(id);
    if (!pos) { knownHealers.delete(id); continue; }
    let loaded: boolean;
    try { loaded = world.getDimension(pos.dimension).isChunkLoaded(pos.location); }
    catch { continue; }
    if (!loaded) {
      if (!unloadedSince.has(id)) unloadedSince.set(id, now);
      continue;
    }
    const since = unloadedSince.get(id);
    if (since === undefined) continue;
    unloadedSince.delete(id);
    const record = readRecord(id);
    if (!record) { knownHealers.delete(id); continue; }
    if (record.i || typeof record.s !== "number" || now <= since) continue;
    // Medida antes de descarregar: anda o tempo fora; medida depois (não deveria): conta a partir de agora.
    record.s += now - Math.max(since, record.s);
    try { world.setDynamicProperty(id, JSON.stringify(record)); } catch { }
  }
}

export function maxHealerCharge(): number {
  return Math.max(6, getConfig().maxHealerCharge ?? 6);
}

/** Carga por tick (maxCharge / (segundos × 20)); 0 se a config desligar a recarga. */
export function chargePerTick(): number {
  const ticks = Math.max(0, getConfig().secondsToChargeHealingMachine ?? 900) * 20;
  return ticks > 0 ? maxHealerCharge() / ticks : 0;
}

/** PartyStore.getHealingRemainderPercent: soma de (1 - HP/HP máx.) do time. */
export function healingRemainderPercent(team: (PokemonData | null | undefined)[]): number {
  return team.reduce((sum, p) => p ? sum + (1 - (p.maxHealth > 0 ? p.currentHealth / p.maxHealth : 0)) : sum, 0);
}

/** Carga guardada no registro, somando a recarga desde que foi medida. */
export function chargeFromRecord(record: ChargeRecord, max: number, now: number, legacyNow: () => number): number {
  if (record.i) return max;
  const elapsed = typeof record.s === "number" ? now - record.s : typeof record.t === "number" ? legacyNow() - record.t : 0;
  return Math.min(max, Math.max(0, record.c + Math.max(0, elapsed) * chargePerTick()));
}

export function readCharge(block: Block): number {
  const max = maxHealerCharge();
  const record = readRecord(chargeKey(block));
  if (!record) {
    // Bloco sem registro (colocado antes desta versão): parte do medidor.
    const state = block.permutation.getState("cobblemon:charge");
    return Math.min(max, (typeof state === "number" ? state : 0) / CHARGE_STATE_MAX * max);
  }
  return chargeFromRecord(record, max, healerClock(), absoluteTick);
}

export function isInfinite(block: Block): boolean {
  try {
    const raw = world.getDynamicProperty(chargeKey(block));
    return typeof raw === "string" && (JSON.parse(raw) as ChargeRecord).i === true;
  } catch { return false; }
}

export function writeCharge(block: Block, charge: number, infinite = isInfinite(block)) {
  const max = maxHealerCharge();
  const value = Math.min(max, Math.max(0, charge));
  const record: ChargeRecord = { c: value, s: healerClock(), ...(infinite ? { i: true } : {}) };
  const key = chargeKey(block);
  try { world.setDynamicProperty(key, JSON.stringify(record)); } catch { }
  knownHealers.add(key);
  unloadedSince.delete(key);
  const level = getConfig().infiniteHealerCharge || infinite ? CHARGE_STATE_MAX : Math.floor(value / max * CHARGE_STATE_MAX);
  try {
    if (block.permutation.getState("cobblemon:charge") !== level)
      block.setPermutation(block.permutation.withState("cobblemon:charge", level));
  } catch { }
}

const pokeballLocations: { [key: number]: Vector3 } = {
  0: { x: 0.36, y: 0.7, z: 0.25 },
  1: { x: 0.64, y: 0.7, z: 0.25 },
  2: { x: 0.36, y: 0.7, z: 0.5 },
  3: { x: 0.64, y: 0.7, z: 0.5 },
  4: { x: 0.36, y: 0.7, z: 0.75 },
  5: { x: 0.64, y: 0.7, z: 0.75 }
}

export default class HealingMachineComponent implements BlockCustomComponent {
  onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
    arg.block.dimension.getEntities({ location: arg.block.location, families: ["pokeball_dummy"], maxDistance: 1 }).forEach(x => x.triggerEvent("cobblemon:instant_kill"));
    const key = chargeKey(arg.block);
    try { world.setDynamicProperty(key, undefined); } catch { }
    knownHealers.delete(key);
    unloadedSince.delete(key);
  }
  async onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
    if (arg.block.permutation.getState("cobblemon:busy")) return;
    if (!arg.player) return;
    cleanUpStaleBattleData(arg.player);
    if (arg.player.getDynamicProperty('in_battle') !== undefined) {
      arg.player.sendMessage(message.color("Red", { translate: "cobblemon.healingmachine.inbattle" }));
      return;
    }
    let team = getTeam(arg.player);
    if (team === undefined) return;
    let validTeam = team.filter(x => x != null);
    if (validTeam.length === 0) return;
    let healTeam = validTeam.filter(x => canBeHealed(x!));
    if (healTeam.length === 0) {
      // Time já curado: com healersHealPC o PC ainda pode ter o que curar (sem custo de carga, como o time cheio).
      if (getGameRule("healersHealPC") && healPlayerPC(arg.player) > 0) {
        try { arg.dimension.playSound("cobblemon.block.healing_machine.active", arg.block.location, { volume: 0.7 }); } catch { }
        return;
      }
      arg.player.sendMessage({ translate: "cobblemon.healingmachine.alreadyhealed" });
      return;
    }
    // HealingMachineBlockEntity.canHeal/activate: custa a soma do HP que falta (em frações do HP máximo).
    const infinite = getConfig().infiniteHealerCharge || isInfinite(arg.block);
    const currentCharge = readCharge(arg.block);
    const needed = healingRemainderPercent(validTeam);
    if (!infinite && currentCharge < needed) {
      const percent = Math.floor((needed - currentCharge) / validTeam.length * 100);
      arg.player.sendMessage(message.color("Red", message.With("cobblemon.healingmachine.notenoughcharge", [`${percent}%`])));
      return;
    }
    if (!infinite && currentCharge !== maxHealerCharge()) writeCharge(arg.block, currentCharge - needed);
    else writeCharge(arg.block, currentCharge);
    arg.block.setPermutation(arg.block.permutation.withState("cobblemon:busy", true));
    team.forEach(x => x?.return(arg.player!))
    system.runTimeout(() => this.spawnPokeball(arg, team.filter(x => x !== null), 0), waitTicks);
  }
  spawnPokeball(arg: BlockComponentPlayerInteractEvent, pokemonData: PokemonData[], currentIndex: number) {
    if (!arg.block.isValid || arg.block.typeId != "cobblemon:healing_machine") {
      this.killAllPokeballs(arg.dimension, arg.block.location);
      return;
    }
    if (arg.player === undefined || !arg.player.isValid) {
      this.cleanup(arg.block);
      return;
    }
    if (pokemonData[currentIndex] != null) {
      let direction = arg.block.permutation.getState("minecraft:cardinal_direction") as string | undefined;
      let pLocation = pokeballLocations[currentIndex];
      let location: Vector3;
      let facingLocation: Vector3;
      switch (direction) {
        case "north":
          location = Vector3Math.add(pLocation, arg.block.location);
          facingLocation = Vector3Math.add(location, { x: 0, y: 0, z: 1 });
          break;
        case "south":
          location = Vector3Math.add({ x: (1 - pLocation.x), y: pLocation.y, z: (1 - pLocation.z) }, arg.block.location);
          facingLocation = Vector3Math.add(location, { x: 0, y: 0, z: -1 });
          break;
        case "west":
          location = Vector3Math.add({ x: (1 - pLocation.z), y: pLocation.y, z: pLocation.x }, arg.block.location);
          facingLocation = Vector3Math.add(location, { x: 1, y: 0, z: 0 });
          break;
        case "east":
        default:
          location = Vector3Math.add({ x: pLocation.z, y: pLocation.y, z: (1 - pLocation.x) }, arg.block.location);
          facingLocation = Vector3Math.add(location, { x: -1, y: 0, z: 0 });
          break;
      }
      //There are not enough options with dimension.spawnEntity
      arg.dimension.runCommand(`summon cobblemon:${getPokeballEntityName(pokemonData[currentIndex]!.pokeball || "poke_ball")}_dummy ${location.x} ${location.y} ${location.z} facing ${facingLocation.x} ${facingLocation.y} ${facingLocation.z}`);
    }
    //Finish the heal
    if (pokemonData.length == currentIndex + 1 || currentIndex >= pokemonData.length - 1) {
      system.runTimeout(() => this.healTeam(arg), waitTicks);
    }
    //Continue Iterating
    else {
      system.runTimeout(() => this.spawnPokeball(arg, pokemonData, currentIndex + 1), ticksPerPokeballPlace);
    }
  }
  healTeam(arg: BlockComponentPlayerInteractEvent) {
    if (!arg.block.isValid || arg.block.typeId != "cobblemon:healing_machine") {
      this.killAllPokeballs(arg.dimension, arg.block.location);
      return;
    }
    if (arg.player === undefined || !arg.player.isValid) {
      this.cleanup(arg.block);
      return;
    }
    arg.block.setPermutation(arg.block.permutation.withState("cobblemon:active", true));
    // HealingMachineBlockEntity.activate: som do Cobblemon; HealingMachineBlock.animateTick: brilhos verdes enquanto cura.
    const center = { x: arg.block.location.x + 0.5, y: arg.block.location.y + 0.5, z: arg.block.location.z + 0.5 };
    try { arg.dimension.playSound("cobblemon.block.healing_machine.active", center, { volume: 0.7 }); } catch { }
    const block = arg.block;
    const sparkles = system.runInterval(() => spawnHealingSparkles(block), 4);
    system.runTimeout(() => system.clearRun(sparkles), 37);
    system.runTimeout(() => {
      this.cleanup(arg.block);
      healPlayerTeam(arg.player!);
      // Gamerule healersHealPC (HealingMachineBlock cura também o PC do jogador).
      if (getGameRule("healersHealPC")) healPlayerPC(arg.player!);
      // A entidade fora da bola tem uma cópia dos dados: atualiza (como o comando healpokemon).
      getSafeTeam(arg.player!).forEach(pokemon => pokemon?.tryUpdatePokemonOut());
    }, 37);
  }
  cleanup(block: Block) {
    block.setPermutation(block.permutation.withState("cobblemon:busy", false).withState("cobblemon:active", false));
    this.killAllPokeballs(block.dimension, block.location);
  }
  killAllPokeballs(dimension: Dimension, location: Vector3) {
    dimension.getEntities({ location: location, families: ["pokeball_dummy"], maxDistance: 2 }).forEach(x => x.triggerEvent("cobblemon:instant_kill"));
  }
  /** Só atualiza o medidor: a carga é calculada pelos ticks do servidor decorridos (secondsToChargeHealingMachine). */
  onRandomTick(arg: BlockComponentRandomTickEvent) {
    if (arg.block.permutation.getState("cobblemon:busy")) return;
    writeCharge(arg.block, readCharge(arg.block));
  }
  beforeOnPlayerPlace(arg: BlockComponentPlayerPlaceBeforeEvent) {
    // HealingMachineBlock.setPlacedBy: colocada no criativo fica com carga infinita; sobrevivência começa vazia.
    const full = arg.player != undefined && arg.player.getGameMode() == GameMode.Creative;
    arg.permutationToPlace = arg.permutationToPlace.withState("cobblemon:charge", full ? CHARGE_STATE_MAX : 0);
    const block = arg.block;
    system.run(() => { if (block.isValid) writeCharge(block, full ? maxHealerCharge() : 0, full); });
  }
}

/** HealingMachineBlock.animateTick: villager_happy em volta do topo (metade das vezes). */
export function spawnHealingSparkles(block: Block, random: () => number = Math.random) {
  try {
    if (!block.isValid || random() < 0.5) return;
    const sign = () => (random() < 0.5 ? -1 : 1);
    const { x, y, z } = block.location;
    block.dimension.spawnParticle("minecraft:villager_happy", { x: x + 0.5 + random() * 0.3 * sign(), y: y + 0.9, z: z + 0.5 + random() * 0.3 * sign() });
  } catch { /* chunk descarregado */ }
}

class Vector3Math {
  static add(one: Vector3, two: Vector3) {
    return { x: one.x + two.x, y: one.y + two.y, z: one.z + two.z }
  }
}