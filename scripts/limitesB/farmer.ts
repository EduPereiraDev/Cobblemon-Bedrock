/**
 * Fazendeiro e as plantas do Cobblemon (#136) no mundo: a cada 40 ticks, no horário de trabalho do fazendeiro e
 * com `mobGriefing`, cada aldeão fazendeiro carregado olha a vizinhança 3×3×3 (como o HarvestFarmland do Java),
 * sorteia um alvo e colhe uma planta madura do Cobblemon (quebra com drop) ou planta a semente do Cobblemon que
 * vier primeiro no inventário no ar em cima de farmland. Custo: ≤ 27 getBlock por fazendeiro a cada 2 s.
 */
import { Block, BlockVolume, Dimension, Entity, system, world } from "@minecraft/server";
import { COBBLEMON_PLANTABLE_SEEDS } from "../../generated/scripts/limitesB";
import { COBBLEMON_CROPS, cropForSeed, FARMER_FAMILY, FarmAction, FARMLAND, farmOffsets, firstPlantable, HALF_STATE, isMatureCobblemonCrop } from "./farmerLogic";
import { isWorkTime } from "./nurseLogic";

const VILLAGER = "minecraft:villager_v2";
const INTERVAL = 40;
const DIMENSIONS = ["overworld", "nether", "the_end"];

const CROP_IDS = Object.keys(COBBLEMON_CROPS);

export const farmerRng = { next: () => Math.random() };
export const farmerStats = { passes: 0, harvested: 0, planted: 0 };

function states(block: Block): Record<string, unknown> {
  try { return block.permutation.getAllStates(); }
  catch { return {}; }
}

function inventoryItems(villager: Entity): Array<string | undefined> {
  const c = villager.getComponent("minecraft:inventory")?.container;
  if (!c) return [];
  const out: Array<string | undefined> = [];
  for (let i = 0; i < c.size; i++) out.push(c.getItem(i)?.typeId);
  return out;
}

/** Alvos possíveis em volta do fazendeiro (só os que o script trata: plantas do Cobblemon). */
export function farmActions(dimension: Dimension, villager: Entity): FarmAction[] {
  const base = { x: Math.floor(villager.location.x), y: Math.floor(villager.location.y), z: Math.floor(villager.location.z) };
  const seed = firstPlantable(inventoryItems(villager), COBBLEMON_PLANTABLE_SEEDS);
  const out: FarmAction[] = [];
  // Filtro barato (1 chamada nativa): nada do Cobblemon para colher nem farmland para plantar → nem lê os 27 blocos.
  const wanted = [...CROP_IDS, ...(seed?.cobblemon ? [FARMLAND] : [])];
  try {
    const volume = new BlockVolume({ x: base.x - 1, y: base.y - 2, z: base.z - 1 }, { x: base.x + 1, y: base.y + 1, z: base.z + 1 });
    if (!dimension.containsBlock(volume, { includeTypes: wanted }, true)) return out;
  }
  catch { return out; }
  for (const [dx, dy, dz] of farmOffsets()) {
    const pos: [number, number, number] = [base.x + dx, base.y + dy, base.z + dz];
    let block: Block | undefined;
    try { block = dimension.getBlock({ x: pos[0], y: pos[1], z: pos[2] }); }
    catch { continue; }
    if (!block) continue;
    if (COBBLEMON_CROPS[block.typeId] && isMatureCobblemonCrop(block.typeId, states(block))) {
      out.push({ kind: "harvest", pos });
      continue;
    }
    if (seed?.cobblemon && block.isAir) {
      let below: Block | undefined;
      try { below = block.below(); }
      catch { below = undefined; }
      if (below?.typeId === FARMLAND) out.push({ kind: "plant", pos, slot: seed.slot, block: cropForSeed(seed.item)! });
    }
  }
  return out;
}

function destroy(dimension: Dimension, x: number, y: number, z: number) {
  dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`);
}

/** Executa uma ação (colher: quebra com drop, como level.destroyBlock; plantar: estado padrão da planta). */
export function performFarmAction(dimension: Dimension, villager: Entity, action: FarmAction): boolean {
  const [x, y, z] = action.pos;
  const block = dimension.getBlock({ x, y, z });
  if (!block) return false;
  if (action.kind === "harvest") {
    if (!isMatureCobblemonCrop(block.typeId, states(block))) return false;
    if (COBBLEMON_CROPS[block.typeId]?.double) {
      const up = block.above();
      if (up?.typeId === block.typeId && states(up)[HALF_STATE] === "upper") destroy(dimension, x, y + 1, z);
    }
    destroy(dimension, x, y, z);
    farmerStats.harvested++;
    return true;
  }
  if (!block.isAir || block.below()?.typeId !== FARMLAND) return false;
  const inv = villager.getComponent("minecraft:inventory")?.container;
  const stack = inv?.getItem(action.slot);
  if (!inv || !stack || cropForSeed(stack.typeId) !== action.block) return false;
  block.setType(action.block);
  if (stack.amount > 1) { stack.amount -= 1; inv.setItem(action.slot, stack); }
  else inv.setItem(action.slot);
  try { dimension.playSound("dig.grass", { x: x + 0.5, y: y + 0.5, z: z + 0.5 }); }
  catch { /* som opcional */ }
  farmerStats.planted++;
  return true;
}

/** Um passe: cada fazendeiro faz no máximo uma ação. `force` ignora horário/gamerule (sonda). */
export function farmerPass(force = false) {
  if (!force) {
    try { if (!world.gameRules.mobGriefing) return; }
    catch { return; }
    if (!isWorkTime(world.getTimeOfDay())) return;
  }
  farmerStats.passes++;
  for (const id of DIMENSIONS) {
    let farmers: Entity[];
    let dimension: Dimension;
    try {
      dimension = world.getDimension(id);
      farmers = dimension.getEntities({ type: VILLAGER, families: [FARMER_FAMILY] });
    }
    catch { continue; }
    for (const v of farmers) {
      try {
        if (!v.isValid) continue;
        const actions = farmActions(dimension, v);
        if (!actions.length) continue;
        performFarmAction(dimension, v, actions[Math.floor(farmerRng.next() * actions.length) % actions.length]);
      }
      catch { /* descarregou no meio */ }
    }
  }
}

let started = false;

export function startFarmers() {
  if (started) return;
  started = true;
  system.runInterval(() => {
    try { farmerPass(); }
    catch (e) { console.warn(`[limites-b] fazendeiro: ${e}`); }
  }, INTERVAL);
}
