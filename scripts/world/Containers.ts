/**
 * Contêineres reais para blocos custom (frente motor, pesquisa 3-motor §4).
 *
 * Bloco custom não tem inventário no Bedrock; o caminho estável é uma entidade invisível com `minecraft:inventory`
 * no bloco (como o carrinho com baú). Guardar/retirar por `Container` preserva o ItemStack inteiro — encantamentos,
 * durabilidade, poção, livro, nome, lore e dynamic properties (T11) —, e `can_be_siphoned_from` deixa o funil de
 * baixo puxar (T10). Entidades:
 * - `cobblemon:gilded_chest_storage` (27, UI de baú, funil puxa, caixa 1,02 × 1,02 para receber o clique antes do
 *   bloco): baús dourados;
 * - `cobblemon:display_case_item` (1 espaço, sem UI): vitrine (o item exibido é o do slot 0);
 * - `cobblemon:machine_storage` (27, sem UI, sem funil): estante de discos e outras máquinas que queiram.
 */
import { Container, Dimension, Entity, ItemStack, Player, system, Vector3, world } from "@minecraft/server";

export const GILDED_STORAGE = "cobblemon:gilded_chest_storage";
export const DISPLAY_STORAGE = "cobblemon:display_case_item";
export const MACHINE_STORAGE = "cobblemon:machine_storage";

/** Centro do bloco na altura `dy`. */
export function blockCenter(location: Vector3, dy = 0): Vector3 {
  return { x: Math.floor(location.x) + 0.5, y: Math.floor(location.y) + dy, z: Math.floor(location.z) + 0.5 };
}

/** Entidade de armazenamento do tipo no bloco (a mais próxima do centro). */
export function findStorage(dimension: Dimension, location: Vector3, type: string): Entity | undefined {
  try {
    return dimension.getEntities({ type, location: blockCenter(location, 0.5), maxDistance: 0.9, closest: 1 })[0];
  }
  catch { return undefined; }
}

/** Entidade do bloco, criando se faltar. `dy` = altura da entidade dentro do bloco. */
export function ensureStorage(dimension: Dimension, location: Vector3, type: string, dy = 0): Entity | undefined {
  const found = findStorage(dimension, location, type);
  if (found) return found;
  try { return dimension.spawnEntity(type as never, blockCenter(location, dy)); }
  catch { return undefined; }
}

export function containerOf(entity: Entity | undefined): Container | undefined {
  try { return entity?.getComponent("minecraft:inventory")?.container; }
  catch { return undefined; }
}

/** Solta todo o conteúdo no centro do bloco e remove a entidade. */
export function dropAndRemove(dimension: Dimension, location: Vector3, entity: Entity | undefined) {
  if (!entity) return;
  const container = containerOf(entity);
  if (container) for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    container.setItem(i, undefined);
    try { dimension.spawnItem(item, blockCenter(location, 0.5)); }
    catch (e) { console.warn(`[contêiner] não foi possível soltar ${item.typeId}: ${e}`); }
  }
  try { entity.remove(); }
  catch { /* já removida */ }
}

/** Uma cópia com `amount` itens (preserva todos os componentes da pilha). */
export function splitStack(stack: ItemStack, amount: number): ItemStack {
  const out = stack.clone();
  out.amount = Math.max(1, Math.min(amount, stack.amount));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Baú dourado: quebrar pela entidade e sons de abrir/fechar

/** Golpes (sobrevivência) para quebrar o baú pela entidade; a janela entre golpes é HIT_WINDOW ticks. */
export const CHEST_HITS = 4;
const HIT_WINDOW = 30;
const hits = new Map<string, { n: number; tick: number }>();

export type ChestBreaker = (player: Player, dimension: Dimension, location: Vector3, typeId: string) => void;
let chestBreaker: ChestBreaker | undefined;

/** decor.ts instala a quebra (conteúdo + bloco). */
export function setChestBreaker(fn: ChestBreaker) {
  chestBreaker = fn;
}

/** Conta um golpe; true = quebrou. */
export function registerChestHit(entityId: string, now: number, creative: boolean): boolean {
  if (creative) { hits.delete(entityId); return true; }
  const last = hits.get(entityId);
  const n = last && now - last.tick <= HIT_WINDOW ? last.n + 1 : 1;
  if (n >= CHEST_HITS) { hits.delete(entityId); return true; }
  hits.set(entityId, { n, tick: now });
  return false;
}

function isCreative(player: Player): boolean {
  try { return String(player.getGameMode()) === "Creative"; }
  catch { return false; }
}

function playAt(dimension: Dimension, sound: string, location: Vector3) {
  try { dimension.playSound(sound, location); }
  catch { /* som inexistente */ }
}

let bound = false;

/** Eventos dos contêineres (idempotente; decor.ts chama ao carregar e startWorld também). */
export function bindContainerEvents() {
  if (bound) return;
  bound = true;
  world.afterEvents.entityHitEntity.subscribe(({ damagingEntity, hitEntity }) => {
    if (!(damagingEntity instanceof Player) || hitEntity.typeId !== GILDED_STORAGE) return;
    let dimension: Dimension, location: Vector3;
    try {
      dimension = hitEntity.dimension;
      location = { x: Math.floor(hitEntity.location.x), y: Math.floor(hitEntity.location.y + 0.01), z: Math.floor(hitEntity.location.z) };
    }
    catch { return; }
    const block = dimension.getBlock(location);
    if (!block || !/gilded_chest$/.test(block.typeId)) {
      // Entidade órfã (bloco sumiu por pistão/explosão/comando): devolve o conteúdo.
      dropAndRemove(dimension, location, hitEntity);
      return;
    }
    playAt(dimension, "cobblemon.block.gilded_chest.hit", blockCenter(location, 0.5));
    if (!registerChestHit(hitEntity.id, system.currentTick, isCreative(damagingEntity))) return;
    chestBreaker?.(damagingEntity, dimension, location, block.typeId);
  });
  world.afterEvents.entityContainerOpened.subscribe(({ entity }) => {
    try { if (entity.typeId === GILDED_STORAGE) playAt(entity.dimension, "cobblemon.block.gilded_chest.open", entity.location); }
    catch { /* entidade removida */ }
  });
  world.afterEvents.entityContainerClosed.subscribe(({ entity }) => {
    try { if (entity.typeId === GILDED_STORAGE) playAt(entity.dimension, "cobblemon.block.gilded_chest.close", entity.location); }
    catch { /* entidade removida */ }
  });
}
