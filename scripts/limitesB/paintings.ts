/**
 * Pinturas do Cobblemon (#30) no mundo: entidade `cobblemon:painting` (gerada por tools/importer/limitesB.ts).
 *
 * - Colocar: o clique do item Pintura vanilla numa parede refaz o sorteio do Java (paintingLogic.choosePainting).
 *   Se sair uma do Cobblemon, o clique é cancelado e a nossa entidade entra no lugar (gasta 1 item fora do criativo);
 *   se sair uma vanilla, nada muda e o Bedrock coloca a pintura vanilla dele.
 * - Pintura vanilla perto: o Bedrock não expõe a variante; os blocos dela vêm da caixa de colisão (ou, sem ela, de uma
 *   estimativa conservadora do maior tamanho). O Bedrock também não vê as nossas: a vanilla só é deixada passar se a
 *   maior que ele escolheria não alcança nenhuma das nossas, e o uso repetido do item (botão segurado) é cancelado.
 * - Quebrar: golpe, projétil ou explosão quebram e soltam `minecraft:painting` (não no criativo), como
 *   HangingEntity.hurt/dropItem. A cada 100 ticks as pinturas carregadas conferem a parede (HangingEntity.tick →
 *   survives()) e caem se o apoio sumiu ou o espaço foi ocupado.
 * - Recarregar: a entidade é persistente; variante e eixo são propriedades (sobrevivem ao salvar) e o registro
 *   (variante, direção, bloco-âncora) fica numa dynamic property da entidade.
 */
import { Dimension, Entity, EntityDamageCause, GameMode, ItemStack, Player, system, world } from "@minecraft/server";
import { COBBLEMON_PAINTINGS } from "../../generated/scripts/limitesB";
import {
  axisOf, cellsBox, choosePainting, counterClockWise, FACING_VEC, facingOf, Facing, isFreeForPainting, isInteractiveBlock, isSolidForPainting,
  PaintingCell, paintingCells, paintingLocation, PaintingRecord, PaintingSize, PaintingVariant, parsePaintingRecord, VANILLA_PAINTING_SIZES, Vec3,
} from "./paintingLogic";

export const PAINTING_ENTITY = "cobblemon:painting";
const PAINTING_ITEM = "minecraft:painting";
const RECORD = "cobblemon:painting";
const SURVIVE_INTERVAL = 100;
const DIMENSIONS = ["overworld", "nether", "the_end"];

/** Sorteio (trocável nos testes/sondas). */
export const paintingRng = { next: () => Math.random() };

function variantByName(name: string): PaintingVariant | undefined {
  return COBBLEMON_PAINTINGS.find(p => p.name === name);
}

function blockAt(dimension: Dimension, v: Vec3) {
  try { return dimension.getBlock(v); }
  catch { return undefined; }
}

/** Maior lado de uma pintura vanilla (4×4): raio da estimativa conservadora. */
const VANILLA_MAX_REACH = 2;

/**
 * Blocos que uma pintura vanilla ocupa. O Bedrock não expõe a variante dela ao script: usa a caixa de colisão
 * (getAABB) quando ela tem o tamanho de uma pintura; sem isso, conservador: uma cruz de 5 blocos em volta da posição
 * nos dois eixos horizontais possíveis (cobre qualquer pintura até 4×4 com o centro ali).
 */
export function vanillaPaintingBlocks(e: Entity): { blocks: Vec3[]; exact: boolean } {
  const l = e.location;
  try {
    const box = e.getAABB();
    const { center: c, extent: x } = box;
    // Só confia numa caixa com cara de pintura: fina na direção da parede e com ao menos meio bloco no plano.
    if (Math.min(x.x, x.z) < 0.1 && Math.max(x.x, x.z) >= 0.4 && x.y >= 0.4) {
      const out: Vec3[] = [];
      const lo = (v: number, h: number) => Math.floor(v - h + 0.01), hi = (v: number, h: number) => Math.floor(v + h - 0.01);
      for (let bx = lo(c.x, x.x); bx <= hi(c.x, x.x); bx++)
        for (let by = lo(c.y, x.y); by <= hi(c.y, x.y); by++)
          for (let bz = lo(c.z, x.z); bz <= hi(c.z, x.z); bz++) out.push({ x: bx, y: by, z: bz });
      if (out.length <= 64) return { blocks: out, exact: true };
    }
  }
  catch { /* sem caixa: estimativa abaixo */ }
  const bx = Math.floor(l.x), by = Math.floor(l.y), bz = Math.floor(l.z);
  const out: Vec3[] = [];
  for (let dy = -VANILLA_MAX_REACH; dy <= VANILLA_MAX_REACH; dy++) {
    for (let d = -VANILLA_MAX_REACH; d <= VANILLA_MAX_REACH; d++) {
      out.push({ x: bx + d, y: by + dy, z: bz });
      if (d !== 0) out.push({ x: bx, y: by + dy, z: bz + d });
    }
  }
  return { blocks: out, exact: false };
}

/**
 * `ours`: blocos das nossas pinturas (exatos). `vanilla`: das vanilla, com a estimativa conservadora (para colocar).
 * `vanillaExact`: só as vanilla com caixa medida (para derrubar: estimativa nunca derruba a nossa).
 */
export interface Occupancy { ours: Set<string>; vanilla: Set<string>; vanillaExact: Set<string> }

/** Blocos ocupados perto da âncora, separados entre as nossas e as vanilla. */
export function occupancyNear(dimension: Dimension, anchor: Vec3, ignore?: Entity): Occupancy {
  const ours = new Set<string>();
  const vanilla = new Set<string>();
  const vanillaExact = new Set<string>();
  const center = { x: anchor.x + 0.5, y: anchor.y + 0.5, z: anchor.z + 0.5 };
  try {
    for (const e of dimension.getEntities({ type: PAINTING_ENTITY, location: center, maxDistance: 6 })) {
      if (ignore && e.id === ignore.id) continue;
      const rec = parsePaintingRecord(e.getDynamicProperty(RECORD));
      const v = rec && variantByName(rec.v);
      if (!rec || !v) continue;
      for (const c of paintingCells({ x: rec.a[0], y: rec.a[1], z: rec.a[2] }, rec.f, v)) ours.add(`${c.front.x},${c.front.y},${c.front.z}`);
    }
    for (const e of dimension.getEntities({ type: "minecraft:painting", location: center, maxDistance: 8 })) {
      const { blocks, exact } = vanillaPaintingBlocks(e);
      for (const b of blocks) {
        vanilla.add(`${b.x},${b.y},${b.z}`);
        if (exact) vanillaExact.add(`${b.x},${b.y},${b.z}`);
      }
    }
  }
  catch { /* chunk descarregado */ }
  return { ours, vanilla, vanillaExact };
}

/** Blocos ocupados: nossas + vanilla (conservador ao colocar; só caixas medidas com `exactOnly`). */
function occupiedNear(dimension: Dimension, anchor: Vec3, ignore?: Entity, exactOnly = false): Set<string> {
  const occ = occupancyNear(dimension, anchor, ignore);
  for (const k of exactOnly ? occ.vanillaExact : occ.vanilla) occ.ours.add(k);
  return occ.ours;
}

type BlockInfo = { free: boolean; solid: boolean } | undefined;

/** Leitura de blocos com cache (os tamanhos testados num clique repetem quase todos os blocos). */
function blockReader(dimension: Dimension) {
  const cache = new Map<string, BlockInfo>();
  return (v: Vec3): BlockInfo => {
    const key = `${v.x},${v.y},${v.z}`;
    if (cache.has(key)) return cache.get(key);
    const b = blockAt(dimension, v);
    const info = b ? { free: isFreeForPainting(b.typeId, b.isAir, b.isLiquid), solid: isSolidForPainting(b.typeId, b.isAir, b.isLiquid) } : undefined;
    cache.set(key, info);
    return info;
  };
}

/** Painting.survives(): apoio sólido atrás de todos os blocos, espaço livre e sem outra pintura por cima. */
export function paintingFits(dimension: Dimension, cells: readonly PaintingCell[], occupied: Set<string>, read = blockReader(dimension)): boolean {
  for (const c of cells) {
    if (occupied.has(`${c.front.x},${c.front.y},${c.front.z}`)) return false;
    const front = read(c.front);
    const wall = read(c.wall);
    if (!front?.free || !wall?.solid) return false;
  }
  return true;
}

/** Teste de encaixe de um clique, com cache de blocos e de tamanhos (≤ 32 getBlock e 2 getEntities). */
export function paintingFitter(dimension: Dimension, anchor: Vec3, facing: Facing, occupied = occupiedNear(dimension, anchor), read = blockReader(dimension)): (size: PaintingSize) => boolean {
  const memo = new Map<string, boolean>();
  return (size: PaintingSize) => {
    const key = `${size.width}x${size.height}`;
    let ok = memo.get(key);
    if (ok === undefined) memo.set(key, ok = paintingFits(dimension, paintingCells(anchor, facing, size), occupied, read));
    return ok;
  };
}

/**
 * O Bedrock não enxerga as nossas pinturas (são entidades nossas): a vanilla que ele escolheria (a de maior área que
 * cabe ignorando as nossas) pode cair por cima de uma. Conservador: qualquer bloco nosso dentro do alcance desse
 * tamanho em volta da âncora (a convenção de deslocamento do Bedrock não é exposta) conta como sobreposição.
 */
export function vanillaWouldOverlapOurs(dimension: Dimension, anchor: Vec3, facing: Facing, occ: Occupancy, read = blockReader(dimension)): boolean {
  if (!occ.ours.size) return false;
  const fits = paintingFitter(dimension, anchor, facing, occ.vanilla, read);
  let area = 0;
  const sizes: PaintingSize[] = [];
  for (const [key, n] of Object.entries(VANILLA_PAINTING_SIZES)) {
    if (n <= 0) continue;
    const [width, height] = key.split("x").map(Number);
    if (!fits({ width, height })) continue;
    if (width * height > area) { area = width * height; sizes.length = 0; }
    if (width * height === area) sizes.push({ width, height });
  }
  const side = FACING_VEC[counterClockWise(facing)];
  for (const size of sizes) {
    for (let a = -(size.width - 1); a <= size.width - 1; a++) {
      for (let b = -(size.height - 1); b <= size.height - 1; b++) {
        if (occ.ours.has(`${anchor.x + side.x * a},${anchor.y + b},${anchor.z + side.z * a}`)) return true;
      }
    }
  }
  return false;
}

/** Sorteio do Java para um clique (só leitura: pode rodar no before-event). */
export function rollPainting(dimension: Dimension, anchor: Vec3, facing: Facing, roll = paintingRng.next(), fits = paintingFitter(dimension, anchor, facing)) {
  return choosePainting(COBBLEMON_PAINTINGS, fits, roll);
}

/** Cria a entidade. @returns a pintura ou undefined se não coube mais (o mundo mudou entre o clique e o tick). */
export function placePainting(dimension: Dimension, anchor: Vec3, facing: Facing, variant: PaintingVariant): Entity | undefined {
  const cells = paintingCells(anchor, facing, variant);
  if (!paintingFits(dimension, cells, occupiedNear(dimension, anchor))) return undefined;
  const axis = axisOf(facing) === 0 ? "ns" : "ew";
  const entity = dimension.spawnEntity(PAINTING_ENTITY, paintingLocation(anchor, facing, variant), {
    initialRotation: 0,
    spawnEvent: `cobblemon:painting_${variant.name}_${axis}`,
  });
  const record: PaintingRecord = { v: variant.name, f: facing, a: [anchor.x, anchor.y, anchor.z] };
  entity.setDynamicProperty(RECORD, JSON.stringify(record));
  try { dimension.playSound("dig.wood", paintingLocation(anchor, facing, variant)); }
  catch { /* som opcional */ }
  return entity;
}

/** HangingEntity.dropItem + remove: solta o item (se `drop`) e some. */
export function breakPainting(entity: Entity, drop: boolean) {
  if (!entity.isValid) return;
  const dimension = entity.dimension;
  const at = entity.location;
  if (drop) {
    try { dimension.spawnItem(new ItemStack(PAINTING_ITEM, 1), { x: at.x, y: at.y + 0.5, z: at.z }); }
    catch { /* fora do mundo */ }
  }
  try { dimension.playSound("dig.wood", at); }
  catch { /* som opcional */ }
  entity.remove();
}

function consumeHeld(player: Player) {
  if (player.getGameMode() === GameMode.Creative) return;
  const inv = player.getComponent("minecraft:inventory")?.container;
  const slot = player.selectedSlotIndex;
  const held = inv?.getItem(slot);
  if (!inv || held?.typeId !== PAINTING_ITEM) return;
  if (held.amount > 1) { held.amount -= 1; inv.setItem(slot, held); }
  else inv.setItem(slot);
}

/** A pintura ainda se segura? (HangingEntity.tick → survives, a cada 100 ticks.) Undefined = não dá para saber. */
export function paintingSurvives(entity: Entity): boolean | undefined {
  const rec = parsePaintingRecord(entity.getDynamicProperty(RECORD));
  const v = rec && variantByName(rec.v);
  // Sem registro (/summon): não há parede conhecida; fica como está.
  if (!rec || !v) return undefined;
  const cells = paintingCells({ x: rec.a[0], y: rec.a[1], z: rec.a[2] }, rec.f, v);
  // A parede pode estar no chunk vizinho: a caixa inclui os blocos de apoio.
  const box = cellsBox([...cells, ...cells.map(c => ({ front: c.wall, wall: c.wall }))]);
  const dimension = entity.dimension;
  for (const corner of [box.min, box.max, { x: box.min.x, y: box.min.y, z: box.max.z }, { x: box.max.x, y: box.min.y, z: box.min.z }]) {
    try { if (!dimension.isChunkLoaded(corner)) return undefined; }
    catch { return undefined; }
  }
  // Bloco que não deu para ler (descarregou no meio, fora do mundo) = "não sei", nunca "caiu".
  const read = blockReader(dimension);
  for (const c of cells) if (read(c.front) === undefined || read(c.wall) === undefined) return undefined;
  return paintingFits(dimension, cells, occupiedNear(dimension, { x: rec.a[0], y: rec.a[1], z: rec.a[2] }, entity, true), read);
}

let started = false;

export function startPaintings() {
  if (started || !COBBLEMON_PAINTINGS.length) return;
  started = true;
  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    if (event.itemStack?.typeId !== PAINTING_ITEM) return;
    const facing = facingOf(String(event.blockFace));
    if (!facing) return;
    // Uso repetido (botão segurado): o Bedrock colocaria a vanilla dele sem ver as nossas; só um clique novo coloca.
    if (!event.isFirstEvent) { event.cancel = true; return; }
    const { player, block } = event;
    let mode: GameMode;
    try { mode = player.getGameMode(); }
    catch { return; }
    if (mode === GameMode.Adventure || mode === GameMode.Spectator) return;
    // Bloco que responde ao clique: o item só é usado agachado (como no Java).
    if (!player.isSneaking && isInteractiveBlock(block.typeId)) return;
    const f = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[facing];
    const anchor = { x: block.location.x + f[0], y: block.location.y, z: block.location.z + f[1] };
    const dimension = block.dimension;
    const occ = occupancyNear(dimension, anchor);
    const read = blockReader(dimension);
    const all = new Set([...occ.ours, ...occ.vanilla]);
    const choice = rollPainting(dimension, anchor, facing, paintingRng.next(), paintingFitter(dimension, anchor, facing, all, read));
    if (choice?.kind !== "cobblemon") {
      // Vanilla (ou nada cabe): deixa o Bedrock pôr a dele, a menos que ela possa cobrir uma das nossas.
      if (vanillaWouldOverlapOurs(dimension, anchor, facing, occ, read)) event.cancel = true;
      return;
    }
    event.cancel = true;
    const variant = choice.variant;
    system.run(() => {
      try {
        if (!player.isValid) return;
        if (placePainting(dimension, anchor, facing, variant)) consumeHeld(player);
      }
      catch (e) { console.warn(`[limites-b] pintura: ${e}`); }
    });
  });
  world.beforeEvents.entityHurt.subscribe(event => {
    const entity = event.hurtEntity;
    event.cancel = true;
    const source = event.damageSource;
    const attacker = source.damagingEntity;
    const creative = attacker instanceof Player && attacker.getGameMode() === GameMode.Creative;
    system.run(() => { try { breakPainting(entity, !creative); } catch { /* já removida */ } });
  }, {
    entityFilter: { type: PAINTING_ENTITY },
    allowedDamageCauses: [EntityDamageCause.entityAttack, EntityDamageCause.projectile, EntityDamageCause.entityExplosion, EntityDamageCause.blockExplosion],
  });
  system.runInterval(() => {
    for (const id of DIMENSIONS) {
      let list: Entity[];
      try { list = world.getDimension(id).getEntities({ type: PAINTING_ENTITY }); }
      catch { continue; }
      for (const e of list) {
        try { if (paintingSurvives(e) === false) breakPainting(e, true); }
        catch { /* descarregou no meio */ }
      }
    }
  }, SURVIVE_INTERVAL);
}
