/**
 * Pesca com Poké Rod (PokerodItem.kt + PokeRodFishingBobberEntity.kt do Cobblemon 1.8.2) sobre a Script API
 * estável. O Bedrock não tem componente de vara de pesca dirigido por dados, então tudo é script:
 *
 * - Usar a vara (componente `cobblemon:poke_rod`) arremessa uma boia (`cobblemon:poke_bobber`) com a bola da
 *   vara; usar de novo recolhe. A boia não tem física própria: a posição é integrada aqui, tick a tick, com a
 *   mesma física do FishingHook (gravidade 0,03, arrasto 0,92, boiar na superfície).
 * - Na água roda o laço do Cobblemon (FishingLogic.tickFishing): espera → peixe nadando → fisgada com janela
 *   de reação. Recolher dentro da janela sorteia Pokémon (spawn pool de pesca, `chooseFishingSpawn`) ou item
 *   (tabela da Poké Rod). O Pokémon nasce na boia com aspect/tag `fished`, é puxado até o jogador (se pesar
 *   < 90 kg) e 1 s depois começa a batalha.
 * - Isca: na mão secundária ao arremessar (como o `use` do Cobblemon) ou pelo menu (agachar + usar).
 */
import { awardStat } from "../events/PlayerStats";
import {
  Dimension, Entity, EntityComponentTypes, EquipmentSlot, GameMode, ItemStack, MolangVariableMap, Player, system, Vector3, world,
} from "@minecraft/server";
import { BEST_SPAWNER_CONFIG } from "../../generated/scripts/spawns";
import { startWildBattle } from "../battle";
import { recordAchievementEvent } from "../ui/achievements/tracker";
import { message } from "../language";
import { getSpeciesData } from "../speciesData";
import { buildSpawnContext, chooseFishingSpawn, SpawnAction, spawnActionEntity } from "../spawning/Spawner";
import { getWeather } from "../utils/World";
import { baitInfluence, BaitEffect, rarityTier } from "./BaitEffects";
import { openBaitMenu } from "./BaitMenu";
import {
  biteDipVelocity, bobbingVelocity, castOrigin, castVelocity, COBBLEMON_TREASURE, durabilityLoss, FishingEvent, FishingState,
  isOpenOrWaterAround, itemPullVelocity, lobVelocity, newFishingState, nextInt, PositionKind, REEL_IN_MAX_WEIGHT, retrieveDamage,
  rollLootCategory, tickFishing, uniformKind, Vec3, WATER_SURFACE,
} from "./FishingLogic";
import { bobberBallIndex, getPokeRod, lineColorRGB } from "./PokeRods";
import {
  consumeRodBait, damageRod, getRodBait, isBaitStack, RodBait, rodBaitEffects, rodEnchantments, sameBait, setRodBait, stackBaitComponents,
} from "./RodItem";

export const BOBBER_ENTITY = "cobblemon:poke_bobber";
/** Propriedades da boia (BP entities/fishing/poke_bobber.json). */
export const BOBBER_BALL_PROPERTY = "cobblemon:ball";
export const BOBBER_STATE_PROPERTY = "cobblemon:bobber_state";

/** Sons do Cobblemon (sounds.json "fishing.*" → cobblemon.fishing.*; pedido ao importador). */
export const FISHING_SOUNDS = {
  cast: "cobblemon.fishing.rod_cast",
  reel: "cobblemon.fishing.rod_reel_in",
  land: "cobblemon.fishing.bobber_land",
  notification: "cobblemon.fishing.notification",
  splashSmall: "cobblemon.fishing.splash_small",
  splashBig: "cobblemon.fishing.splash_big",
  baitAttach: "cobblemon.fishing.bait_attach",
  baitDetach: "cobblemon.fishing.bait_detach",
  rodBreak: "random.break",
};

/** Partículas snowstorm do Cobblemon (bedrock/particles/fishing; pedido ao importador) e vanilla equivalentes. */
export const FISHING_PARTICLES = {
  bobSplash: "cobblemon:bob_splash",
  bigRipple: "cobblemon:fishing_bobber_big_ripple",
  ripple: "cobblemon:fishing_bobber_ripple",
  surfaceRipple: "cobblemon:fishing_surface_ripple",
  wake: "cobblemon:fishing_wake",
  accessorySplash: "cobblemon:accessory_fish_splash",
  smallSplash: "cobblemon:small_fish_splash",
  bigSplash: "cobblemon:big_fish_splash",
  line: "cobblemon:fishing_line",
  vanillaBubble: "minecraft:basic_bubble_particle",
  vanillaWake: "minecraft:water_wake_particle",
  vanillaSplash: "minecraft:water_splash_particle",
};

/** Ajustes do port. */
export const FISHING_TUNING = {
  /** Distância máxima da boia ao jogador (Cobblemon: 32 blocos). */
  maxDistance: 32,
  /** Boia parada no chão some depois disso (ticks). */
  groundRemovalTicks: 1200,
  /** Intervalo (ticks) do desenho da linha e nº máximo de partículas por linha. */
  lineInterval: 2,
  lineMaxPoints: 24,
  /** A boia fica um pouco afundada para a bola não parecer pousada sobre a água. */
  visualSink: 0.12,
  /** Atraso (ticks) entre o Pokémon sair da água e a batalha (afterOnServer 1 s). */
  battleDelay: 20,
  /** Intervalo (ticks) do recálculo de "águas abertas" durante a fisgada. */
  openWaterInterval: 5,
};

type BobberPhase = "flying" | "hooked" | "bobbing";
const PHASE_INDEX: Record<BobberPhase, number> = { flying: 0, bobbing: 1, hooked: 2 };

interface ActiveBobber {
  player: Player;
  entity: Entity;
  dimension: Dimension;
  rodId: string;
  slot: number;
  /** Isca no momento do arremesso (JSON) para a checagem de consistência. */
  baitKey: string;
  bait?: RodBait;
  effects: BaitEffect[];
  lure: number;
  luckOfTheSea: number;
  pos: Vec3;
  vel: Vec3;
  phase: BobberPhase;
  onGround: boolean;
  removalTimer: number;
  hooked?: Entity;
  fishing: FishingState;
  planned?: SpawnAction;
  inOpenWater: boolean;
  outOfOpenWaterTicks: number;
  lastRipple: number;
  age: number;
  lineColor: { red: number; green: number; blue: number };
  /** Última posição enviada ao cliente (evita teleportes parados). */
  shown?: Vec3;
}

const bobbers = new Map<string, ActiveBobber>();
let loopStarted = false;

// ---------------------------------------------------------------------------------------------
// Utilidades de mundo

function safeBlock(dimension: Dimension, loc: Vector3) {
  try { return dimension.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) }); }
  catch { return undefined; }
}

/** Altura do fluido (água) no bloco: fonte 8/9, corrente (8 − nível)/9; 0 fora da água. */
function waterHeightAt(dimension: Dimension, loc: Vector3): number {
  const block = safeBlock(dimension, loc);
  if (!block) return 0;
  const id = block.typeId;
  if (id !== "minecraft:water" && id !== "minecraft:flowing_water") return block.isWaterlogged ? WATER_SURFACE : 0;
  let depth = 0;
  try { depth = Number(block.permutation.getState("liquid_depth" as never) ?? 0); }
  catch { depth = 0; }
  return depth === 0 ? WATER_SURFACE : Math.max(0.1, (8 - (depth & 7)) / 9);
}

function isSolidAt(dimension: Dimension, loc: Vector3): boolean {
  const block = safeBlock(dimension, loc);
  if (!block) return false;
  if (block.isAir || block.isLiquid || PASSABLE_IN_WATER.test(block.typeId)) return false;
  return true;
}

/** Plantas aquáticas: água-fonte sem colisão (INSIDE_WATER no Cobblemon). */
const PASSABLE_IN_WATER = /^minecraft:(seagrass|tall_seagrass|kelp|kelp_plant|bubble_column)$/;

/** getPositionType: água-fonte sem colisão = dentro d'água; ar/nenúfar = acima d'água. */
function positionKind(dimension: Dimension, x: number, y: number, z: number): PositionKind {
  const block = safeBlock(dimension, { x, y, z });
  if (!block) return "invalid";
  if (block.isAir || block.typeId === "minecraft:waterlily") return "above_water";
  if (block.typeId === "minecraft:water") {
    try { if (Number(block.permutation.getState("liquid_depth" as never) ?? 0) !== 0) return "invalid"; }
    catch { /* sem estado */ }
    return "inside_water";
  }
  if (PASSABLE_IN_WATER.test(block.typeId)) return "inside_water";
  return "invalid";
}

function openWaterAround(dimension: Dimension, pos: Vec3): boolean {
  const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
  return isOpenOrWaterAround(dy => {
    const kinds: PositionKind[] = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const kind = positionKind(dimension, bx + dx, by + dy, bz + dz);
      if (kinds.length && kind !== kinds[0]) return "invalid";
      kinds.push(kind);
    }
    return uniformKind(kinds);
  });
}

function playSound(dimension: Dimension, id: string, loc: Vector3, pitch = 1, volume = 1) {
  try { dimension.playSound(id, loc, { pitch, volume }); }
  catch { /* som ausente */ }
}

function particle(dimension: Dimension, id: string, loc: Vector3, vars?: MolangVariableMap) {
  try { dimension.spawnParticle(id, loc, vars); }
  catch { /* partícula ausente ou fora do mundo carregado */ }
}

function mainhand(player: Player): ItemStack | undefined {
  try { return player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand); }
  catch { return undefined; }
}

function setMainhand(player: Player, stack: ItemStack | undefined) {
  try { player.getComponent(EntityComponentTypes.Equippable)?.setEquipment(EquipmentSlot.Mainhand, stack); }
  catch { /* jogador saiu */ }
}

function offhand(player: Player): ItemStack | undefined {
  try { return player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Offhand); }
  catch { return undefined; }
}

function setOffhand(player: Player, stack: ItemStack | undefined) {
  try { player.getComponent(EntityComponentTypes.Equippable)?.setEquipment(EquipmentSlot.Offhand, stack); }
  catch { /* jogador saiu */ }
}

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

/** Devolve itens ao inventário; o que não couber cai no chão. */
export function giveOrDrop(player: Player, stack: ItemStack) {
  let leftover: ItemStack | undefined = stack;
  try { leftover = player.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(stack); }
  catch { leftover = stack; }
  if (leftover) {
    try { player.dimension.spawnItem(leftover, player.location); }
    catch { /* fora do mundo carregado */ }
  }
}

function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function dist2(a: Vec3, b: Vec3): number { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }

// ---------------------------------------------------------------------------------------------
// API

/** O jogador está com a boia na água/no ar? */
export function isFishing(player: Player): boolean {
  return bobbers.has(player.id);
}

/**
 * Uso da Poké Rod (PokerodItem.use). Chamado pelo componente `cobblemon:poke_rod` fora do modo restrito.
 * - Boia fora: recolhe.
 * - Agachado: abre o menu de isca.
 * - Isca na mão secundária: prende na vara (e arremessa, como no Cobblemon).
 */
export function useRod(player: Player) {
  if (!player.isValid) return;
  const rod = mainhand(player);
  if (!rod || !getPokeRod(rod.typeId)) return;
  const active = bobbers.get(player.id);
  if (active) {
    reel(active, rod);
    return;
  }
  if (player.isSneaking) {
    void openBaitMenu(player);
    return;
  }
  const off = offhand(player);
  if (isBaitStack(off)) attachBait(player, rod, off, "offhand");
  cast(player, mainhand(player) ?? rod);
}

/**
 * Prende `stack` (pilha de isca) na vara: mesma isca → completa até o máximo; outra isca → a antiga volta
 * ao inventário e a nova entra inteira (overrideOtherStackedOnMe). Grava a vara na mão principal.
 * `from` diz de onde tirar os itens usados ("offhand" ou um slot do inventário).
 * @returns Quantidade presa.
 */
export function attachBait(player: Player, rod: ItemStack, stack: ItemStack, from: "offhand" | number): number {
  const current = getRodBait(rod);
  const max = Math.max(1, stack.maxAmount);
  let taken: number;
  if (current && sameBait(current, stack)) {
    taken = Math.max(0, Math.min(current.max - current.count, stack.amount));
    if (taken === 0) return 0;
    setRodBait(rod, { ...current, count: current.count + taken });
  }
  else {
    if (current) {
      try { giveOrDrop(player, new ItemStack(current.item, current.count)); }
      catch { /* item da isca antiga não existe mais */ }
    }
    taken = Math.min(max, stack.amount);
    setRodBait(rod, { item: stack.typeId, count: taken, max, components: stackBaitComponents(stack) });
  }
  const remaining = stack.amount - taken;
  const rest = remaining > 0 ? stack.clone() : undefined;
  if (rest) rest.amount = remaining;
  if (from === "offhand") setOffhand(player, rest);
  else {
    try { player.getComponent(EntityComponentTypes.Inventory)?.container?.setItem(from, rest); }
    catch { /* inventário mudou */ }
  }
  setMainhand(player, rod);
  playSound(player.dimension, FISHING_SOUNDS.baitAttach, player.location);
  return taken;
}

/** Tira a isca da vara e devolve ao inventário. */
export function detachBait(player: Player, rod: ItemStack): boolean {
  const current = getRodBait(rod);
  if (!current) return false;
  setRodBait(rod, undefined);
  setMainhand(player, rod);
  try { giveOrDrop(player, new ItemStack(current.item, current.count)); }
  catch { /* item não existe */ }
  playSound(player.dimension, FISHING_SOUNDS.baitDetach, player.location);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Arremesso

function cast(player: Player, rod: ItemStack) {
  const rodData = getPokeRod(rod.typeId)!;
  const rotation = player.getRotation();
  const origin = castOrigin(player.getHeadLocation(), rotation.y);
  let entity: Entity;
  try { entity = player.dimension.spawnEntity(BOBBER_ENTITY, origin); }
  catch (e) {
    console.warn(`[pesca] não foi possível criar a boia: ${e}`);
    return;
  }
  try { entity.setProperty(BOBBER_BALL_PROPERTY, bobberBallIndex(rod.typeId)); }
  catch { /* entidade sem a propriedade */ }
  // POKEROD_CAST_POST → StatHandler.onPokeRodCast (frente dados-ui).
  awardStat(player, "rod_casts");
  const bait = getRodBait(rod);
  const enchants = rodEnchantments(rod);
  bobbers.set(player.id, {
    player, entity, dimension: player.dimension, rodId: rod.typeId, slot: player.selectedSlotIndex,
    baitKey: JSON.stringify(bait ?? null), bait, effects: rodBaitEffects(bait), lure: enchants.lure, luckOfTheSea: enchants.luckOfTheSea,
    pos: origin, vel: castVelocity(rotation.x, rotation.y), phase: "flying", onGround: false, removalTimer: 0,
    fishing: newFishingState(), inOpenWater: true, outOfOpenWaterTicks: 0, lastRipple: -Infinity, age: 0,
    lineColor: lineColorRGB(rodData.lineColor),
  });
  playSound(player.dimension, FISHING_SOUNDS.cast, player.location, 1, 0.5);
  startLoop();
}

function discard(bobber: ActiveBobber) {
  bobbers.delete(bobber.player.id);
  try { if (bobber.entity.isValid) bobber.entity.remove(); }
  catch { /* já removida */ }
}

/** removeIfInvalid: jogador vivo, vara na mão (mesmo slot), mesma isca, até 32 blocos. */
function stillValid(b: ActiveBobber): boolean {
  const player = b.player;
  if (!player.isValid || !b.entity.isValid) return false;
  if (player.dimension.id !== b.dimension.id) return false;
  if (player.selectedSlotIndex !== b.slot) return false;
  const rod = mainhand(player);
  if (!rod || rod.typeId !== b.rodId) return false;
  if (JSON.stringify(getRodBait(rod) ?? null) !== b.baitKey) return false;
  try {
    const health = player.getComponent(EntityComponentTypes.Health);
    if (health && health.currentValue <= 0) return false;
  }
  catch { /* sem vida */ }
  return dist2(b.pos, player.location) <= FISHING_TUNING.maxDistance * FISHING_TUNING.maxDistance;
}

// ---------------------------------------------------------------------------------------------
// Tick

function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  system.runInterval(() => {
    if (bobbers.size === 0) return;
    for (const b of [...bobbers.values()]) {
      try { tickBobber(b); }
      catch (e) {
        console.warn(`[pesca] erro no tick da boia: ${e}`);
        discard(b);
      }
    }
  }, 1);
}

function setPhase(b: ActiveBobber, phase: BobberPhase) {
  b.phase = phase;
  try { b.entity.setProperty(BOBBER_STATE_PROPERTY, PHASE_INDEX[phase]); }
  catch { /* sem propriedade */ }
}

function tickBobber(b: ActiveBobber) {
  if (!stillValid(b)) {
    discard(b);
    return;
  }
  b.age++;
  const dimension = b.dimension;
  if (b.onGround) {
    if (++b.removalTimer >= FISHING_TUNING.groundRemovalTicks) {
      discard(b);
      return;
    }
  }
  else b.removalTimer = 0;

  const fluid = waterHeightAt(dimension, b.pos);
  const inWater = fluid > 0;
  const blockY = Math.floor(b.pos.y);

  if (b.phase === "flying") {
    if (b.hooked) {
      b.vel = { x: 0, y: 0, z: 0 };
      setPhase(b, "hooked");
      return;
    }
    if (inWater) {
      b.vel = { x: b.vel.x * 0.3, y: b.vel.y * 0.2, z: b.vel.z * 0.3 };
      setPhase(b, "bobbing");
      return;
    }
    checkEntityHit(b);
  }
  else if (b.phase === "hooked") {
    const target = b.hooked;
    if (target && target.isValid && target.dimension.id === dimension.id) {
      const loc = target.location;
      let head = loc.y + 1;
      try { head = target.getHeadLocation().y; }
      catch { /* sem cabeça */ }
      b.pos = { x: loc.x, y: loc.y + (head - loc.y) * 0.8, z: loc.z };
      teleport(b);
    }
    else {
      b.hooked = undefined;
      setPhase(b, "flying");
    }
    return;
  }
  else {
    b.vel = bobbingVelocity(b.pos, b.vel, blockY, fluid, b.fishing.caughtFish);
    const window = b.fishing.hookCountdown > 0 || b.fishing.fishTravelCountdown > 0;
    if (!window) b.inOpenWater = true;
    else if (b.inOpenWater && b.age % FISHING_TUNING.openWaterInterval === 0)
      b.inOpenWater = b.outOfOpenWaterTicks < 10 && openWaterAround(dimension, b.pos);
    if (inWater) {
      b.outOfOpenWaterTicks = Math.max(0, b.outOfOpenWaterTicks - 1);
      tickFishingLogic(b, blockY);
    }
    else b.outOfOpenWaterTicks = Math.min(10, b.outOfOpenWaterTicks + 1);
  }

  if (!inWater) b.vel = { x: b.vel.x, y: b.vel.y - 0.03, z: b.vel.z };
  move(b);
  if (b.phase === "flying" && b.onGround) b.vel = { x: 0, y: 0, z: 0 };
  b.vel = { x: b.vel.x * 0.92, y: b.vel.y * 0.92, z: b.vel.z * 0.92 };
  teleport(b);
  if (b.age % FISHING_TUNING.lineInterval === 0) drawLine(b);
}

/** Move com colisão simples contra blocos sólidos (raio no voo, ponto na água). */
function move(b: ActiveBobber) {
  const len = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  if (len < 1e-5) return;
  const dir = { x: b.vel.x / len, y: b.vel.y / len, z: b.vel.z / len };
  let hit;
  try { hit = b.dimension.getBlockFromRay(b.pos, dir, { maxDistance: len + 0.1, includeLiquidBlocks: false, includePassableBlocks: false }); }
  catch { hit = undefined; }
  if (!hit) {
    b.pos = add(b.pos, b.vel);
    b.onGround = false;
    return;
  }
  const at = { x: hit.block.location.x + hit.faceLocation.x, y: hit.block.location.y + hit.faceLocation.y, z: hit.block.location.z + hit.faceLocation.z };
  // Para um pouco antes da face atingida.
  b.pos = { x: at.x - dir.x * 0.05, y: at.y - dir.y * 0.05, z: at.z - dir.z * 0.05 };
  const face = String(hit.face);
  if (face === "Up") {
    b.onGround = true;
    b.vel = { x: b.vel.x, y: 0, z: b.vel.z };
  }
  else if (face === "Down") b.vel = { x: b.vel.x, y: 0, z: b.vel.z };
  else if (face === "North" || face === "South") b.vel = { x: b.vel.x, y: b.vel.y, z: 0 };
  else b.vel = { x: 0, y: b.vel.y, z: b.vel.z };
  if (b.phase === "flying") b.vel = { x: 0, y: face === "Up" ? 0 : b.vel.y, z: 0 };
  if (isSolidAt(b.dimension, b.pos)) b.pos = { x: b.pos.x, y: Math.floor(b.pos.y) + 1.01, z: b.pos.z };
}

function teleport(b: ActiveBobber) {
  const sink = b.phase === "bobbing" ? FISHING_TUNING.visualSink : 0;
  const target = { x: b.pos.x, y: b.pos.y - sink, z: b.pos.z };
  if (b.shown && dist2(b.shown, target) < 1e-6) return;
  b.shown = target;
  try { b.entity.teleport(target); }
  catch { /* chunk descarregado */ }
}

/** checkForCollision/onHitEntity: fisga a primeira entidade no caminho (menos o dono e outras boias). */
function checkEntityHit(b: ActiveBobber) {
  const len = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  if (len < 1e-3 || b.age < 2) return;
  const dir = { x: b.vel.x / len, y: b.vel.y / len, z: b.vel.z / len };
  let hits;
  try { hits = b.dimension.getEntitiesFromRay(b.pos, dir, { maxDistance: len + 0.2, excludeFamilies: ["poke_bobber"] }); }
  catch { return; }
  for (const hit of hits) {
    const e = hit.entity;
    if (!e.isValid || e.id === b.player.id || e.id === b.entity.id) continue;
    b.hooked = e;
    return;
  }
}

function drawLine(b: ActiveBobber) {
  const player = b.player;
  const yaw = player.getRotation().y * Math.PI / 180;
  const head = player.getHeadLocation();
  // Ponta da vara: à direita e um pouco abaixo dos olhos.
  const tip = { x: head.x - Math.cos(yaw) * 0.35 - Math.sin(yaw) * 0.6, y: head.y - 0.1, z: head.z - Math.sin(yaw) * 0.35 + Math.cos(yaw) * 0.6 };
  const end = { x: b.pos.x, y: b.pos.y + 0.1, z: b.pos.z };
  const distance = Math.sqrt(dist2(tip, end));
  const points = Math.max(4, Math.min(FISHING_TUNING.lineMaxPoints, Math.ceil(distance * 2)));
  const sag = b.phase === "bobbing" && !b.fishing.caughtFish ? Math.min(1.2, distance * 0.06) : 0;
  const vars = new MolangVariableMap();
  // Frente cliente-teste3-log: cor em variáveis escalares (a partícula não lê struct: "unable to find member variable .r").
  vars.setFloat("variable.color_r", b.lineColor.red);
  vars.setFloat("variable.color_g", b.lineColor.green);
  vars.setFloat("variable.color_b", b.lineColor.blue);
  for (let i = 1; i < points; i++) {
    const t = i / points;
    particle(b.dimension, FISHING_PARTICLES.line, {
      x: tip.x + (end.x - tip.x) * t,
      y: tip.y + (end.y - tip.y) * t - sag * 4 * t * (1 - t),
      z: tip.z + (end.z - tip.z) * t,
    }, vars);
  }
}

// ---------------------------------------------------------------------------------------------
// Pesca na água

function tickFishingLogic(b: ActiveBobber, blockY: number) {
  const dimension = b.dimension;
  const above = { x: b.pos.x, y: blockY + 1, z: b.pos.z };
  const weather = getWeather(dimension);
  const raining = String(weather) !== "Clear";
  let canSeeSky = true;
  try {
    const top = dimension.getTopmostBlock({ x: Math.floor(b.pos.x), z: Math.floor(b.pos.z) });
    canSeeSky = !top || top.y <= blockY;
  }
  catch { /* sem topo */ }
  const events = tickFishing(b.fishing, {
    raining: raining && canSeeSky,
    canSeeSky,
    lureLevel: b.lure,
    effects: b.effects,
    random: Math.random,
    planSpawn: () => planSpawn(b, blockY),
  });
  for (const event of events) showEvent(b, event, above);
}

function showEvent(b: ActiveBobber, event: FishingEvent, above: Vec3) {
  const d = b.dimension;
  const at = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
  switch (event.type) {
    case "land":
      playSound(d, FISHING_SOUNDS.land, at);
      particle(d, FISHING_PARTICLES.bobSplash, at);
      break;
    case "ripple":
      if (b.age - b.lastRipple >= 20) {
        particle(d, FISHING_PARTICLES.ripple, at);
        b.lastRipple = b.age;
      }
      particle(d, FISHING_PARTICLES.surfaceRipple, at);
      break;
    case "trail": {
      const trail = { x: b.pos.x + event.offsetX, y: above.y, z: b.pos.z + event.offsetZ };
      if (waterHeightAt(d, { x: trail.x, y: trail.y - 1, z: trail.z }) <= 0) break;
      if (Math.random() < 0.15) particle(d, FISHING_PARTICLES.vanillaBubble, { x: trail.x, y: trail.y - 0.1, z: trail.z });
      particle(d, FISHING_PARTICLES.wake, trail);
      particle(d, FISHING_PARTICLES.vanillaWake, trail);
      break;
    }
    case "bite": {
      playSound(d, FISHING_SOUNDS.notification, at);
      particle(d, FISHING_PARTICLES.bobSplash, at);
      particle(d, FISHING_PARTICLES.bigRipple, at);
      const m = { x: at.x, y: at.y + 0.5, z: at.z };
      for (let i = 0; i < 6; i++) {
        const off = { x: m.x + (Math.random() - 0.5) * 0.5, y: m.y, z: m.z + (Math.random() - 0.5) * 0.5 };
        particle(d, FISHING_PARTICLES.vanillaBubble, off);
        particle(d, FISHING_PARTICLES.vanillaWake, off);
      }
      b.vel = biteDipVelocity(b.vel);
      break;
    }
    case "escape":
      b.planned = undefined;
      break;
  }
}

/**
 * planSpawn: FishingSpawnerFactory com a posição da boia. Condições `minLureLevel` usam o Lure do
 * encantamento; a normalização de buckets usa rarity_bucket da isca + Luck of the Sea (como o Cobblemon).
 * @returns Peso (fishingBuckets) do bucket sorteado.
 */
function planSpawn(b: ActiveBobber, blockY: number): number | undefined {
  b.planned = undefined;
  const location = { x: Math.floor(b.pos.x) + 0.5, y: blockY + 1, z: Math.floor(b.pos.z) + 0.5 };
  let action: SpawnAction | undefined;
  try {
    const ctx = buildSpawnContext(b.dimension, location, "fishing");
    const tier = rarityTier(b.effects) + b.luckOfTheSea;
    action = chooseFishingSpawn(ctx, {
      rodType: b.rodId,
      bait: b.bait?.item,
      lureLevel: b.lure,
      luckOfTheSeaLevel: b.luckOfTheSea,
      bucketTier: tier,
    }, { player: b.player, influences: [baitInfluence(b.effects)] });
  }
  catch (e) {
    console.warn(`[pesca] falha ao planejar o spawn: ${e}`);
  }
  b.planned = action;
  return action ? BEST_SPAWNER_CONFIG.fishingBuckets[action.bucket] : undefined;
}

// ---------------------------------------------------------------------------------------------
// Recolher

function reel(b: ActiveBobber, rod: ItemStack) {
  const player = b.player;
  if (!stillValid(b)) {
    discard(b);
    return;
  }
  // POKEROD_REEL → StatHandler.onReelIn (frente dados-ui): todo recolher conta.
  awardStat(player, "reel_ins");
  let damage = 0;
  let rodChanged = false;
  if (b.hooked && b.hooked.isValid) {
    pullEntity(b, b.hooked);
    damage = retrieveDamage({ hookedEntity: b.hooked.typeId === "minecraft:item" ? "item" : "entity" });
  }
  else if (b.fishing.hookCountdown > 0) {
    if (b.fishing.typeCaught === "item") {
      giveLoot(b);
      damage = retrieveDamage({ caught: true });
    }
    else {
      if (catchPokemon(b)) {
        consumeRodBait(rod);
        rodChanged = true;
      }
      damage = retrieveDamage({ caught: true });
    }
  }
  if (b.onGround) damage = retrieveDamage({ onGround: true });
  discard(b);

  playSound(player.dimension, FISHING_SOUNDS.reel, player.location, 1 / (Math.random() * 0.4 + 0.8));
  if (damage > 0 && !isCreative(player)) {
    const loss = durabilityLoss(damage, rodEnchantments(rod).unbreaking);
    if (damageRod(rod, loss)) {
      setMainhand(player, undefined);
      playSound(player.dimension, FISHING_SOUNDS.rodBreak, player.location);
      return;
    }
    if (loss > 0) rodChanged = true;
  }
  if (rodChanged) setMainhand(player, rod);
}

/** pullEntity: puxa a entidade 10% da distância até o dono. */
function pullEntity(b: ActiveBobber, target: Entity) {
  const p = b.player.location, t = target.location;
  const v = { x: (p.x - t.x) * 0.1, y: (p.y - t.y) * 0.1, z: (p.z - t.z) * 0.1 };
  try {
    if (target.typeId === "minecraft:player") target.applyKnockback({ x: v.x, z: v.z }, v.y);
    else target.applyImpulse(v);
  }
  catch { /* entidade sem física */ }
}

const FALLBACK_JUNK = ["minecraft:bowl", "minecraft:leather", "minecraft:stick", "minecraft:string", "minecraft:bone", "minecraft:rotten_flesh"];

function lootFromTable(path: string): ItemStack[] | undefined {
  try {
    const manager = world.getLootTableManager();
    const table = manager.getLootTable(path);
    if (!table) return undefined;
    return manager.generateLootFromTable(table) ?? [];
  }
  catch { return undefined; }
}

function rollLoot(inOpenWater: boolean): ItemStack[] {
  const category = rollLootCategory(inOpenWater);
  if (category === "cobblemon_treasure") {
    const id = COBBLEMON_TREASURE[Math.floor(Math.random() * COBBLEMON_TREASURE.length)];
    try { return [new ItemStack(id)]; }
    catch { /* item ainda não importado: cai para o lixo */ }
  }
  if (category === "treasure") {
    const loot = lootFromTable("gameplay/fishing/treasure");
    if (loot) return loot;
  }
  const junk = lootFromTable("gameplay/fishing/junk");
  if (junk) return junk;
  return [new ItemStack(FALLBACK_JUNK[Math.floor(Math.random() * FALLBACK_JUNK.length)])];
}

/** Item pescado: voa até o jogador; 1–6 de EXP por item. */
function giveLoot(b: ActiveBobber) {
  const player = b.player;
  const inOpenWater = b.inOpenWater && openWaterAround(b.dimension, b.pos);
  for (const stack of rollLoot(inOpenWater)) {
    try {
      const item = b.dimension.spawnItem(stack, b.pos);
      const v = itemPullVelocity(player.location, b.pos);
      system.run(() => {
        try { if (item.isValid) item.applyImpulse(v); }
        catch { /* item sem física */ }
      });
    }
    catch { giveOrDrop(player, stack); }
    try { player.addExperience(nextInt(1, 6)); }
    catch { /* sem EXP */ }
  }
}

/** spawnPokemonFromFishing. @returns true se o Pokémon saiu (a isca é consumida). */
function catchPokemon(b: ActiveBobber): boolean {
  const player = b.player;
  const action = b.planned;
  b.planned = undefined;
  const noBite = () => player.sendMessage(message.error({ translate: "cobblemon.fishing.no_bite" }));
  if (!action) {
    noBite();
    return false;
  }
  const entity = spawnActionEntity(action, [baitInfluence(b.effects, { fished: true })]);
  if (!entity) {
    noBite();
    return false;
  }
  const d = b.dimension;
  const at = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
  particle(d, FISHING_PARTICLES.accessorySplash, at);
  const species = getSpeciesData(action.species);
  if ((species?.weight ?? 0) < REEL_IN_MAX_WEIGHT) {
    playSound(d, FISHING_SOUNDS.splashSmall, at);
    particle(d, FISHING_PARTICLES.smallSplash, at);
    const yaw = player.getRotation().y;
    const v = lobVelocity(player.location, yaw, entity.location);
    system.run(() => {
      try { if (entity.isValid) entity.applyImpulse(v); }
      catch { /* sem física */ }
    });
  }
  else {
    particle(d, FISHING_PARTICLES.bigSplash, at);
    playSound(d, FISHING_SOUNDS.splashBig, at);
  }
  for (let i = 0, n = 6 + Math.floor(Math.random() * 4); i < n; i++)
    particle(d, FISHING_PARTICLES.vanillaSplash, { x: at.x + (Math.random() - 0.5) * 2, y: at.y, z: at.z });
  try { player.addExperience(nextInt(1, 6)); }
  catch { /* sem EXP */ }
  // Conquista use_poke_bait (frente telas, pedido da ui-base): Pokémon puxado com a isca.
  try { recordAchievementEvent(player, { type: "reel_in", bait: b.bait?.item ?? "", species: action.species.split(" ")[0].replace(/^cobblemon:/, "") }); }
  catch { /* conquistas indisponíveis */ }

  // forceBattle depois de 1 s (afterOnServer), se o jogador ainda estiver no mundo.
  system.runTimeout(() => {
    if (!player.isValid || !entity.isValid) return;
    try { startWildBattle(player, entity, { notify: false }); }
    catch (e) { console.warn(`[pesca] batalha não iniciou: ${e}`); }
  }, FISHING_TUNING.battleDelay);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Limpeza

let cleanupBound = false;

/** Remove boias órfãs (mundo recarregado, jogador saiu). Idempotente. */
export function bindFishingCleanup() {
  if (cleanupBound) return;
  cleanupBound = true;
  const tracked = (entity: Entity) => [...bobbers.values()].some(b => b.entity.id === entity.id);
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    try { if (entity.typeId === BOBBER_ENTITY && !tracked(entity)) entity.remove(); }
    catch { /* já removida */ }
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    const b = bobbers.get(playerId);
    if (b) discard(b);
  });
  // Varredura leve a cada 10 s (boias que já estavam carregadas quando o script subiu).
  system.runInterval(() => {
    for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
      let list: Entity[] = [];
      try { list = world.getDimension(id).getEntities({ type: BOBBER_ENTITY }); }
      catch { continue; }
      for (const e of list) if (!tracked(e)) {
        try { e.remove(); }
        catch { /* já removida */ }
      }
    }
  }, 200);
}
