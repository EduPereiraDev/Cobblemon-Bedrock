import { GameMode, ItemStack, Player } from "@minecraft/server";
import { Dex } from "../showdown";
import type { SimPokemon } from "../showdown";
import { PokemonData } from "../Pokemon";

/**
 * Itens da mochila usáveis em batalha (Cobblemon 1.8.2, `K/item/**` com `bagItem`) e o que cada um
 * manda para o Showdown (`getShowdownInput`). Os valores de cura vêm de `data/cobblemon/mechanics`.
 */
export interface BagItemDef {
  /** Item Bedrock (ex.: cobblemon:potion). */
  typeId: string;
  /** Chave de tradução usada nas mensagens (`|bagitem|`). */
  itemName: string;
  /** Script do Showdown (ver BAG_ITEM_SCRIPTS em showdown.ts). */
  script: string;
  /** Em quem pode ser usado: Pokémon de pé ou desmaiado. */
  target: "alive" | "fainted";
  /** Precisa escolher um golpe (Ether, Leppa Berry). */
  selectsMove?: boolean;
  /** Dados extras do script para o alvo. */
  data: (target: SimPokemon, pokemon: PokemonData, moveId?: string) => string[];
  /** Mesmo teste do `canUse` do Cobblemon, feito sobre o estado do simulador. */
  canUse: (target: SimPokemon, pokemon: PokemonData) => boolean;
  /** Item devolvido quando o uso se confirma (ex.: garrafa de vidro das poções). */
  returnItem?: string;
  /** Mudança de amizade ao usar (remédios amargos baixam, X items sobem 1). */
  friendship?: number;
  /** Som tocado no Pokémon alvo. */
  sound?: string;
  /** Categoria só para ordenar/agrupar o menu. */
  category: "heal" | "status" | "revive" | "pp" | "battle";
}

/** `data/cobblemon/mechanics/potions.json`, `remedies.json` e `berries.json`. */
const POTION_AMOUNTS = { potion: 20, super_potion: 60, hyper_potion: 120 };
const REMEDIES = {
  remedy: { heal: 20, friendship: -5 },
  fine_remedy: { heal: 60, friendship: -5 },
  superb_remedy: { heal: 120, friendship: -5 },
  energy_root: { heal: 80, friendship: -10 },
  revival_herb: { heal: 0, friendship: -15 },
  heal_powder: { heal: 0, friendship: -5 },
};
const BERRY_PORTION_RATIO = 0.33;
const BERRY_PP_RESTORE = 10;
const ORAN_RESTORE = 10;
const PERSISTENT = ["brn", "frz", "par", "psn", "tox", "slp"];

const alive = (target: SimPokemon) => target.hp > 0 && !target.fainted;
const hurt = (target: SimPokemon) => alive(target) && target.hp < target.maxhp;
const missingPP = (target: SimPokemon) => alive(target) && target.baseMoveSlots.some(slot => slot.pp < slot.maxpp);
const hasStatus = (target: SimPokemon, statuses: string[]) =>
  alive(target) && ((!!target.status && statuses.includes(target.status)) || statuses.some(status => !!target.volatiles[status]));

const BAG_ITEM_LIST: BagItemDef[] = [];
function add(def: Omit<BagItemDef, "itemName"> & { itemName?: string }) {
  BAG_ITEM_LIST.push({ ...def, itemName: def.itemName ?? `item.${def.typeId.replace(":", ".")}` });
}

// Poções (PotionItem.kt)
for (const [id, amount] of Object.entries(POTION_AMOUNTS))
  add({ typeId: `cobblemon:${id}`, script: "potion", target: "alive", category: "heal", data: () => [`${amount}`], canUse: hurt, returnItem: "minecraft:glass_bottle", sound: "medicine_spray.use" });
add({ typeId: "cobblemon:max_potion", script: "potion", target: "alive", category: "heal", data: t => [`${t.maxhp - t.hp}`], canUse: hurt, returnItem: "minecraft:glass_bottle", sound: "medicine_spray.use" });
add({ typeId: "cobblemon:full_restore", script: "full_restore", target: "alive", category: "heal", data: () => [], canUse: hurt, returnItem: "minecraft:glass_bottle", sound: "medicine_spray.use" });
add({ typeId: "cobblemon:berry_juice", script: "potion", target: "alive", category: "heal", data: () => ["20"], canUse: hurt, returnItem: "minecraft:bowl" });
add({ typeId: "cobblemon:moomoo_milk", script: "clear_boost", target: "alive", category: "battle", data: () => [], canUse: alive, returnItem: "minecraft:glass_bottle" });

// Remédios e ervas (RemedyItem.kt, EnergyRootItem.kt, HealPowderItem.kt, RevivalHerbItem.kt)
for (const id of ["remedy", "fine_remedy", "superb_remedy", "energy_root"] as const)
  add({ typeId: `cobblemon:${id}`, script: "potion", target: "alive", category: "heal", data: () => [`${REMEDIES[id].heal}`], canUse: hurt, friendship: REMEDIES[id].friendship, sound: "medicine_herb.use" });
add({ typeId: "cobblemon:heal_powder", script: "cure_status", target: "alive", category: "status", data: () => [], canUse: t => hasStatus(t, PERSISTENT), friendship: REMEDIES.heal_powder.friendship, sound: "medicine_herb.use" });
add({ typeId: "cobblemon:revival_herb", script: "revive", target: "fainted", category: "revive", data: () => ["0.25"], canUse: t => t.fainted || t.hp <= 0, friendship: REMEDIES.revival_herb.friendship, sound: "medicine_herb.use" });

// Reviver (ReviveItem.kt)
add({ typeId: "cobblemon:revive", script: "revive", target: "fainted", category: "revive", data: () => ["0.5"], canUse: t => t.fainted || t.hp <= 0, sound: "medicine_pills.use" });
add({ typeId: "cobblemon:max_revive", script: "revive", target: "fainted", category: "revive", data: () => ["1"], canUse: t => t.fainted || t.hp <= 0, sound: "medicine_pills.use" });

// Curas de status (StatusCureItem.kt)
const STATUS_CURES: Record<string, string[]> = {
  full_heal: PERSISTENT,
  antidote: ["psn", "tox"],
  awakening: ["slp"],
  burn_heal: ["brn"],
  ice_heal: ["frz"],
  paralyze_heal: ["par"],
};
for (const [id, statuses] of Object.entries(STATUS_CURES))
  add({ typeId: `cobblemon:${id}`, script: "cure_status", target: "alive", category: "status", data: () => statuses, canUse: t => hasStatus(t, statuses), returnItem: "minecraft:glass_bottle", sound: "medicine_spray.use" });

// PP (EtherItem.kt, ElixirItem.kt)
add({ typeId: "cobblemon:ether", script: "ether", target: "alive", category: "pp", selectsMove: true, data: (_, __, move) => [move ?? "", "10"], canUse: missingPP, returnItem: "minecraft:glass_bottle", sound: "medicine_liquid.use" });
add({ typeId: "cobblemon:max_ether", script: "ether", target: "alive", category: "pp", selectsMove: true, data: (_, __, move) => [move ?? ""], canUse: missingPP, returnItem: "minecraft:glass_bottle", sound: "medicine_liquid.use" });
add({ typeId: "cobblemon:elixir", script: "elixir", target: "alive", category: "pp", data: () => ["10"], canUse: missingPP, returnItem: "minecraft:glass_bottle", sound: "medicine_liquid.use" });
add({ typeId: "cobblemon:max_elixir", script: "elixir", target: "alive", category: "pp", data: () => [], canUse: missingPP, returnItem: "minecraft:glass_bottle", sound: "medicine_liquid.use" });

// Itens de batalha (XStatItem.kt, DireHitItem.kt, GuardSpecItem.kt): +1 de amizade
const X_ITEMS: Record<string, string> = { x_attack: "atk", x_defence: "def", x_special_attack: "spa", x_special_defence: "spd", x_speed: "spe", x_accuracy: "accuracy" };
for (const [id, stat] of Object.entries(X_ITEMS))
  add({ typeId: `cobblemon:${id}`, script: "x_stat", target: "alive", category: "battle", data: () => [stat, "2"], canUse: alive, friendship: 1 });
add({ typeId: "cobblemon:dire_hit", script: "dire_hit", target: "alive", category: "battle", data: () => [], canUse: alive, friendship: 1 });
add({ typeId: "cobblemon:guard_spec", script: "guard_spec", target: "alive", category: "battle", data: () => [], canUse: alive, friendship: 1 });

// Berries (item/berry/*): cura, PP e status
const STATUS_BERRIES: Record<string, string[]> = {
  cheri: ["par"], chesto: ["slp"], pecha: ["psn", "tox"], rawst: ["brn"], aspear: ["frz"],
  persim: ["confusion"], lum: [...PERSISTENT, "confusion"], eggant: ["attract"],
};
for (const [id, statuses] of Object.entries(STATUS_BERRIES))
  add({ typeId: `cobblemon:${id}_berry`, script: "cure_status", target: "alive", category: "status", data: () => statuses, canUse: t => hasStatus(t, statuses) });
add({ typeId: "cobblemon:oran_berry", script: "potion", target: "alive", category: "heal", data: () => [`${ORAN_RESTORE}`], canUse: hurt });
add({ typeId: "cobblemon:sitrus_berry", script: "potion", target: "alive", category: "heal", data: t => [`${Math.floor(t.maxhp * 0.33)}`], canUse: hurt });
/** Berries que confundem quem não gosta do sabor: o sabor segue o atributo que a natureza abaixa. */
const PORTION_BERRIES: Record<string, string> = { figy: "atk", wiki: "spa", mago: "spe", aguav: "spd", iapapa: "def" };
for (const [id, dislikedStat] of Object.entries(PORTION_BERRIES))
  add({
    typeId: `cobblemon:${id}_berry`, script: "potion_by_portion", target: "alive", category: "heal", canUse: hurt,
    data: (_, pokemon) => [`${BERRY_PORTION_RATIO}`, `${Dex.natures.get(pokemon.nature).minus === dislikedStat}`],
  });
for (const id of ["leppa", "hopo"])
  add({ typeId: `cobblemon:${id}_berry`, script: "ether", target: "alive", category: "pp", selectsMove: true, data: (_, __, move) => [move ?? "", `${BERRY_PP_RESTORE}`], canUse: missingPP });

export const BAG_ITEMS: ReadonlyMap<string, BagItemDef> = new Map(BAG_ITEM_LIST.map(def => [def.typeId, def]));

/**
 * Frente msd-fase3: item de mochila de uma extensão (Max Honey e Max Mushroom do Mega Showdown). O script do Showdown
 * vai em BAG_ITEM_SCRIPTS (showdown.ts). Sem registro (mundo sem a extensão), a mochila fica igual.
 */
export function registerBagItem(def: Omit<BagItemDef, "itemName"> & { itemName?: string }): void {
  const full: BagItemDef = { ...def, itemName: def.itemName ?? `item.${def.typeId.replace(":", ".")}` };
  (BAG_ITEMS as Map<string, BagItemDef>).set(full.typeId, full);
}

/** Ordem do menu: cura, status, reviver, PP, batalha. */
const CATEGORY_ORDER: BagItemDef["category"][] = ["heal", "status", "revive", "pp", "battle"];

export interface BagEntry {
  def: BagItemDef;
  amount: number;
}

function getContainer(player: Player) {
  return player.getComponent("minecraft:inventory")?.container;
}

/** Itens de batalha no inventário do jogador, agrupados por tipo. */
export function listBagItems(player: Player): BagEntry[] {
  const container = getContainer(player);
  if (!container) return [];
  const amounts = new Map<string, number>();
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item && BAG_ITEMS.has(item.typeId)) amounts.set(item.typeId, (amounts.get(item.typeId) ?? 0) + item.amount);
  }
  return [...amounts.entries()]
    .map(([typeId, amount]) => ({ def: BAG_ITEMS.get(typeId)!, amount }))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.def.category) - CATEGORY_ORDER.indexOf(b.def.category) || a.def.typeId.localeCompare(b.def.typeId));
}

/** Tem alguma Poké Bola no inventário (para a dica de captura no menu da mochila). */
export function hasPokeBall(player: Player): boolean {
  const container = getContainer(player);
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item && item.typeId.startsWith("cobblemon:") && item.typeId.endsWith("_ball")) return true;
  }
  return false;
}

function isCreative(player: Player) {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

/** Tira uma unidade do item do inventário. Criativo não gasta (como `hasInfiniteMaterials`). */
export function consumeBagItem(player: Player, typeId: string): boolean {
  if (isCreative(player)) return true;
  const container = getContainer(player);
  if (!container) return false;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (!item || item.typeId !== typeId) continue;
    if (item.amount <= 1) container.setItem(slot, undefined);
    else {
      item.amount--;
      container.setItem(slot, item);
    }
    return true;
  }
  return false;
}

/** Dá um item ao jogador (ou derruba no chão se o inventário estiver cheio). */
export function giveBagItem(player: Player, typeId: string, amount = 1) {
  try {
    const stack = new ItemStack(typeId, amount);
    const leftover = getContainer(player)?.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  }
  catch (e) {
    console.warn(`Could not give ${typeId} to ${player.name}: ${e}`);
  }
}
