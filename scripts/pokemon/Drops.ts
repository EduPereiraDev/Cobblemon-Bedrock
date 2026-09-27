/**
 * Entrega de drops (Cobblemon 1.8.2: `api/drop/DropTable.kt`, `ItemDropEntry.drop`, `EvolutionItemDropEntry`).
 *
 * - `rollDropEntries`: DropTable.getDrops (quantidade sorteada; entradas com `requirements` só valem se o Pokémon
 *   passar em todos, como EvolutionItemDropEntry.canDrop).
 * - `deliverItem`: ItemDropEntry.drop com `defaultDropItemMethod` da config (`on_entity`, `on_player`,
 *   `to_inventory`); em lava vai para o inventário; `announceDropItems` avisa o que entrou no inventário
 *   (`cobblemon.drop.item.inventory` / `cobblemon.drop.item.full`).
 *
 * Usado pelos drops de evolução (scripts/evolution/EvolutionDrops.ts) e pelas recompensas do Alfa
 * (scripts/pokemon/AlphaRewards.ts). Os drops do selvagem derrotado (scripts/battle/Rewards.ts) podem usar o mesmo
 * `deliverItem` (pedido em docs/pendencias/jogabilidade.md).
 */
import { Dimension, Entity, ItemStack, Player, Vector3 } from "@minecraft/server";
import { getConfig } from "../Config";

export interface DropEntryData {
  item: string;
  percentage?: number;
  quantity?: number;
  quantityRange?: string;
  maxSelectableTimes?: number;
  /** Só em entradas `type: "evolution"`: requisitos (formato dos requisitos de evolução). */
  requirements?: unknown[];
  type?: string;
}

export interface DropTableData {
  amount?: number | string;
  entries?: DropEntryData[];
}

/** IntRangeAdapter: "3" → 3..3, "1-2" → 1..2. */
export function parseDropRange(value: number | string | undefined, fallback: [number, number]): [number, number] {
  if (value === undefined) return fallback;
  if (typeof value === "number") return [value, value];
  const match = /(-?\d+)-?(-?\d+)?/.exec(value);
  if (!match) return fallback;
  const start = parseInt(match[1]);
  return [start, match[2] ? parseInt(match[2]) : start];
}

function randomIn([min, max]: [number, number], random: () => number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** DropTable.getDrops. `canDrop` filtra entradas (requisitos das entradas de evolução). */
export function rollDropEntries(table: DropTableData | undefined, canDrop: (entry: DropEntryData) => boolean = () => true, random = Math.random): DropEntryData[] {
  const entries = table?.entries ?? [];
  const chosenAmount = randomIn(parseDropRange(table?.amount, [1, 1]), random);
  const quantity = (entry: DropEntryData) => entry.quantity ?? 1;
  const possible = entries.filter(entry => quantity(entry) <= chosenAmount && canDrop(entry));
  const drops: DropEntryData[] = [];
  if (possible.length === 0) return drops;
  let dropCount = 0;
  do {
    const drop = possible.find(entry => random() * 100 < (entry.percentage ?? 100));
    if (!drop) {
      // Conta como um drop, senão as porcentagens não significariam nada (comentário do Cobblemon).
      dropCount++;
      continue;
    }
    drops.push(drop);
    dropCount += quantity(drop);
    const remaining = chosenAmount - dropCount;
    const times = drops.filter(x => x === drop).length;
    for (let i = possible.length - 1; i >= 0; i--) {
      const entry = possible[i];
      if ((entry === drop && (entry.maxSelectableTimes ?? 1) <= times) || quantity(entry) > remaining) possible.splice(i, 1);
    }
  } while (dropCount < chosenAmount && possible.length > 0);
  return drops;
}

/** Quantidade de uma entrada (quantityRange sorteado ou quantity). */
export function entryAmount(entry: DropEntryData, random = Math.random): number {
  return entry.quantityRange ? randomIn(parseDropRange(entry.quantityRange, [1, 1]), random) : (entry.quantity ?? 1);
}

export type DropMethod = "on_entity" | "on_player" | "to_inventory";

export interface DropTarget {
  dimension: Dimension;
  location: Vector3;
  /** Entidade do Pokémon (ON_ENTITY). */
  entity?: Entity;
  /** Jogador (ON_PLAYER / TO_INVENTORY). */
  player?: Player;
  /** Força um método (senão `defaultDropItemMethod`). */
  method?: DropMethod;
}

function inLava(dimension: Dimension, location: Vector3): boolean {
  try {
    const type = dimension.getBlock(location)?.typeId;
    return type === "minecraft:lava" || type === "minecraft:flowing_lava";
  }
  catch { return false; }
}

function spawnAt(dimension: Dimension, location: Vector3, stack: ItemStack) {
  try { dimension.spawnItem(stack, location); }
  catch (e) { console.warn(`Não foi possível dropar ${stack.typeId}: ${e}`); }
}

/** Mensagem de item recebido (ItemDropEntry.drop com announceDropItems). */
function announce(player: Player, stack: ItemStack, succeeded: boolean) {
  if (!getConfig().announceDropItems) return;
  const name = { translate: stack.localizationKey };
  player.sendMessage(succeeded
    ? { translate: "cobblemon.drop.item.inventory", with: { rawtext: [{ text: String(stack.amount) }, { rawtext: [{ text: "§a" }, name] }] } }
    : { rawtext: [{ text: "§c" }, { translate: "cobblemon.drop.item.full", with: { rawtext: [name] } }] });
}

/** ItemDropEntry.drop: entrega um item conforme o método. Retorna o método usado. */
export function deliverItem(stack: ItemStack, target: DropTarget): DropMethod | "on_position" {
  let method: DropMethod = target.method ?? (getConfig().defaultDropItemMethod as DropMethod) ?? "on_entity";
  if (inLava(target.dimension, target.location)) method = "to_inventory";
  const player = target.player?.isValid ? target.player : undefined;
  if (method === "on_player" && player) {
    spawnAt(player.dimension, player.location, stack);
    return method;
  }
  if (method === "to_inventory" && player && stack.amount > 0) {
    const amount = stack.amount;
    let leftover: ItemStack | undefined;
    try { leftover = player.getComponent("minecraft:inventory")?.container?.addItem(stack); }
    catch { leftover = stack; }
    if (leftover) spawnAt(player.dimension, player.location, leftover);
    const shown = stack.clone();
    shown.amount = amount;
    announce(player, shown, !leftover);
    return method;
  }
  if (method === "on_entity" && target.entity?.isValid) {
    spawnAt(target.entity.dimension, target.entity.location, stack);
    return method;
  }
  spawnAt(target.dimension, target.location, stack);
  return "on_position";
}

/** Cria o item (undefined se o id não existe no Bedrock) com a quantidade pedida. */
export function makeStack(item: string, amount: number): ItemStack | undefined {
  if (amount <= 0) return undefined;
  try { return new ItemStack(item, Math.min(amount, 64)); }
  catch { return undefined; }
}
