/**
 * Efeitos de itens usados em Pokémon fora de batalha (Cobblemon 1.8.2, `item/interactive/**`,
 * `item/berry/**`, `MintItem`, `AbilityChangeItem`, `TechnicalMachineItem`, `LinkCableItem` e a parte de
 * evolução por item do `PokemonEntity.attemptItemInteraction`).
 *
 * Tudo aqui é lógica pura sobre `PokemonData` (sem interface nem inventário), para ser testável no Node.
 * A interface (seleção do time/golpe, consumo do item) fica em `scripts/items/usage.ts`.
 */
import type { ItemStack, Player, RawMessage } from "@minecraft/server";
import { ITEMS, ItemData } from "../../generated/scripts/items";
import { AddExperienceResult, MAX_PP_STAGES, MOVE_COUNT, PokemonData, StatusEffect } from "../Pokemon";
import { getConfig } from "../Config";
import { MAX_EV_PER_STAT, StatKey, toStatKey } from "../pokemon/Stats";
import { getMoveTranslation, message } from "../language";
import { Dex, toID } from "../showdown";
import { Evolution } from "../evolution/Evolution";
import { ItemInteractionEvolution } from "../evolution/variants/ItemInteractionEvolution";
import { TradeEvolution } from "../evolution/variants/TradeEvolution";
import { providedItemName } from "./itemNames"; // frente msd-fase6: nome de item de outro namespace

// ---------------------------------------------------------------------------------------------
// Tipos

export type ItemKind =
  | "heal" | "status" | "revive" | "restore_pp" | "pp_up" | "ev" | "reset_evs" | "ev_berry" | "experience"
  | "hyper_training" | "mint" | "ability" | "evolution" | "tm";

/** Dados do uso que não vêm do Pokémon: golpe escolhido, golpe do TM, jogador (mensagens de EXP). */
export interface ItemUseContext {
  /** Slot do golpe escolhido (Ether, PP Up, Leppa Berry...). */
  moveSlot?: number;
  /** Golpe gravado no TM (id Showdown). */
  tmMove?: string;
  /** Jogador que usa o item: `gainExp` manda as mensagens de EXP/nível/golpe para ele. */
  player?: Player;
}

export interface ItemUseResult {
  /** O item teve efeito (e deve ser consumido, salvo `consume === false`). */
  success: boolean;
  /** Gastar uma unidade (fora do criativo). Falso para TM com `infiniteTmUses`. */
  consume: boolean;
  /** Item devolvido ao jogador (garrafa das poções, tigela do Berry Juice). */
  returnItem?: string;
  /** Som tocado no Pokémon. */
  sound?: string;
  /** Mensagens para o jogador (sucesso ou motivo da falha). */
  messages: RawMessage[];
  /** Mostrar "X usou Y em Z" (itens que no Cobblemon não têm mensagem própria). */
  feedback?: boolean;
  /** Pokémon depois do efeito (o mesmo objeto, salvo quando `savedElsewhere`). */
  pokemon: PokemonData;
  /** Resultado de `gainExp` (doces de EXP / Rare Candy). */
  experience?: AddExperienceResult;
  /**
   * Uma evolução forçada já salvou uma cópia nova do Pokémon (Evolution.forceEvolve): não salve este
   * objeto por cima; releia o Pokémon pelo uuid.
   */
  savedElsewhere?: boolean;
  /** Golpe que ficou guardado porque o moveset está cheio (TM): a interface pode oferecer a troca. */
  benchedMove?: string;
}

export interface ItemBehaviour {
  /** Item Bedrock (ex.: cobblemon:potion). */
  typeId: string;
  kind: ItemKind;
  /** Escolhe um golpe depois do Pokémon (Ether, Max Ether, PP Up, PP Max, Leppa/Hopo Berry). */
  selectsMove?: boolean;
  /**
   * Só funciona apontando para o Pokémon (itens de evolução que são comida ou item segurado): usar no ar
   * não abre o seletor do time.
   */
  entityOnly?: boolean;
  /** Se não puder ser usado no Pokémon apontado, a interação normal continua (menu / troca de item). */
  passIfUnusable?: boolean;
  canUse(pokemon: PokemonData, ctx?: ItemUseContext): boolean;
  canUseOnMove?(pokemon: PokemonData, slot: number, ctx?: ItemUseContext): boolean;
  apply(pokemon: PokemonData, ctx?: ItemUseContext): ItemUseResult;
  /** Mensagem específica quando não pode ser usado (Mint igual, TM que não aprende...). */
  failureMessage?(pokemon: PokemonData, ctx?: ItemUseContext): RawMessage | undefined;
}

// ---------------------------------------------------------------------------------------------
// Constantes do Cobblemon

const GLASS_BOTTLE = "minecraft:glass_bottle";
const BOWL = "minecraft:bowl";

/** Status do Cobblemon (`Statuses`) → status persistente do Showdown usado em PokemonData.status. */
const STATUS_IDS: Record<string, StatusEffect | undefined> = {
  poison: StatusEffect.Poison,
  poisonbadly: StatusEffect.Badly_Poison,
  paralysis: StatusEffect.Paralyze,
  sleep: StatusEffect.Sleep,
  frozen: StatusEffect.Freeze,
  burn: StatusEffect.Burn,
  // Confusão e atração são voláteis: só existem em batalha.
  confusion: undefined,
  attract: undefined,
};
const ALL_PERSISTENT: StatusEffect[] = [
  StatusEffect.Poison, StatusEffect.Badly_Poison, StatusEffect.Paralyze, StatusEffect.Sleep, StatusEffect.Freeze, StatusEffect.Burn,
];

/** EVIncreaseItem.evIncreaseAmount: Vitamin 10, Feather 1, Mochi 4 (MochiItem.kt). */
const EV_AMOUNTS: Record<string, number> = { vitamin: 10, feather: 1, mochi: 4 };

/** ReviveItem.kt / RevivalHerbItem.kt: HP = ceil(max × fração). */
const REVIVE_RATIOS: Record<string, number> = { revive: 0.5, max_revive: 1, revival_herb: 0.25 };
/** CobblemonMechanics.remedies (`remedies.json`): perda de amizade do Revival Herb. */
const REVIVAL_HERB_FRIENDSHIP_DROP = 15;

/** Sons (`CobblemonSounds`) que existem no RP; os que faltam caem em item.use (pedido em docs/pendencias/itens.md). */
export const ITEM_SOUNDS = {
  spray: "cobblemon.item.medicine.spray.use",
  herb: "cobblemon.item.medicine.herb.use",
  pills: "cobblemon.item.medicine.pills.use",
  liquid: "cobblemon.item.medicine.liquid.use",
  berry: "cobblemon.item.berry.eat",
  /** CandyItem: MEDICINE_CANDY_USE. */
  candy: "cobblemon.item.medicine.candy.use",
  /** FeatherItem e MochiItem (MOCHI_USE = "item.medicine.feather.use" no 1.8.2). */
  feather: "cobblemon.item.medicine.feather.use",
  /** TechnicalMachineItem: TM_USE ao usar e MOVE_LEARN ao aprender. */
  tm: "cobblemon.item.tm.use",
  moveLearn: "cobblemon.gui.move_learn",
  generic: "cobblemon.item.use",
} as const;

/** Chaves de texto do Cobblemon usadas aqui. */
export const ITEM_LANG = {
  mintInteract: "cobblemon.mint.interact",
  mintSameNature: "cobblemon.mint.same_nature",
  abilityChanged: "cobblemon.ability_changer.changed",
  tmTeach: "cobblemon.tms.teach_move",
  tmAlreadyKnown: "cobblemon.tms.already_known",
  tmCannotLearn: "cobblemon.tms.cannot_learn",
  tmUnknownMove: "cobblemon.tms.unknown_move",
} as const;

// ---------------------------------------------------------------------------------------------
// Utilitários

/** Dados gerados do item (ITEMS["potion"]) a partir do id Bedrock. */
export function getItemData(typeId: string): ItemData | undefined {
  if (!typeId.startsWith("cobblemon:")) return undefined;
  return ITEMS[typeId.slice("cobblemon:".length)];
}

function itemKey(typeId: string): RawMessage {
  const [namespace, id] = typeId.includes(":") ? typeId.split(":", 2) : ["cobblemon", typeId];
  if (namespace !== "cobblemon") return providedItemName(namespace, id) ?? { translate: `item.${id}.name` };
  return { translate: `item.cobblemon.${id}` };
}

/** HP máximo atualizado (atributos podem ter mudado por EV/nível desde o último cálculo). */
function maxHp(pokemon: PokemonData): number {
  pokemon.updateMaxHP();
  return Math.max(1, pokemon.maxHealth);
}
export function isFainted(pokemon: PokemonData): boolean {
  return pokemon.currentHealth <= 0;
}
export function isFullHealth(pokemon: PokemonData): boolean {
  return pokemon.currentHealth >= maxHp(pokemon);
}

/**
 * Quantidade de cura dos dados (`amount`): número, "full" ou a expressão Molang das berries
 * (`Math.floor(v.pokemon.max_hp * 0.33)`).
 */
export function resolveHealAmount(amount: unknown, pokemon: PokemonData): number {
  if (typeof amount === "number") return amount;
  if (amount === "full") return Number.MAX_SAFE_INTEGER;
  if (typeof amount === "string") {
    const portion = amount.match(/v\.pokemon\.max_hp\s*\*\s*([\d.]+)/);
    if (portion) return Math.floor(maxHp(pokemon) * parseFloat(portion[1]));
    const value = Number(amount);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * `berries.json` friendshipRaiseAmount: `v.pokemon.friendship < 100 ? 10 : (v.pokemon.friendship < 200 ? 5 : 1)`.
 * Lê os números da expressão gerada; sem ela, usa os valores do Cobblemon.
 */
export function resolveFriendshipRaise(expression: unknown, friendship: number): number {
  if (typeof expression === "number") return expression;
  const m = typeof expression === "string"
    ? expression.match(/<\s*(\d+)\s*\?\s*(\d+)\s*:\s*\(?\s*v\.pokemon\.friendship\s*<\s*(\d+)\s*\?\s*(\d+)\s*:\s*(\d+)/)
    : null;
  const [a, x, b, y, z] = m ? m.slice(1).map(Number) : [100, 10, 200, 5, 1];
  return friendship < a ? x : friendship < b ? y : z;
}

function statusList(names: unknown): StatusEffect[] {
  if (!Array.isArray(names)) return [];
  return names.map(name => STATUS_IDS[String(name)]).filter((x): x is StatusEffect => x !== undefined);
}

function statKey(stat: unknown): StatKey | undefined {
  return typeof stat === "string" ? toStatKey(stat) : undefined;
}

function hasMissingPp(pokemon: PokemonData, slot: number): boolean {
  const info = pokemon.movesInfo[slot];
  return !!pokemon.moves[slot] && !!info && info.pp < info.maxPp;
}

function result(pokemon: PokemonData, success: boolean, extra: Partial<ItemUseResult> = {}): ItemUseResult {
  return { success, consume: success, messages: [], pokemon, ...extra };
}

// ---------------------------------------------------------------------------------------------
// Comportamentos

function healBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  const id = typeId.slice("cobblemon:".length);
  const friendshipDrop = typeof data.friendshipDrop === "number" ? data.friendshipDrop : 0;
  const isBerry = data.category === "berry";
  const isRemedy = friendshipDrop > 0;
  // PotionItem devolve garrafa; BerryJuiceItem devolve tigela; remédios e berries, nada.
  const returnItem = typeof data.returnItem === "string" ? data.returnItem : id === "berry_juice" ? BOWL : undefined;
  const sound = isBerry || id === "berry_juice" ? ITEM_SOUNDS.berry : isRemedy ? ITEM_SOUNDS.herb : ITEM_SOUNDS.spray;
  return {
    typeId, kind: "heal",
    // PotionItem/RemedyItem/HealingBerryItem: não está com HP cheio e não desmaiou.
    canUse: pokemon => !isFainted(pokemon) && !isFullHealth(pokemon),
    apply(pokemon) {
      if (isFainted(pokemon) || isFullHealth(pokemon)) return result(pokemon, false);
      const max = maxHp(pokemon);
      pokemon.currentHealth = Math.min(max, pokemon.currentHealth + resolveHealAmount(data.amount, pokemon));
      if (data.curesStatus === true) pokemon.status = undefined;
      if (friendshipDrop) pokemon.addFriendship(-friendshipDrop);
      return result(pokemon, true, { returnItem, sound, feedback: true });
    },
  };
}

function statusBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  const friendshipDrop = typeof data.friendshipDrop === "number" ? data.friendshipDrop : 0;
  // Heal Powder cura qualquer status; os outros só os da lista.
  const anyStatus = typeId === "cobblemon:heal_powder";
  const statuses = anyStatus ? ALL_PERSISTENT : statusList(data.statuses);
  const isBerry = data.category === "berry";
  const returnItem = !isBerry && !friendshipDrop ? GLASS_BOTTLE : undefined;
  const sound = isBerry ? ITEM_SOUNDS.berry : friendshipDrop ? ITEM_SOUNDS.herb : ITEM_SOUNDS.spray;
  const cures = (pokemon: PokemonData) => !isFainted(pokemon) && !!pokemon.status && statuses.includes(pokemon.status);
  return {
    typeId, kind: "status",
    canUse: cures,
    apply(pokemon) {
      if (!cures(pokemon)) return result(pokemon, false);
      pokemon.status = undefined;
      pokemon.statusDuration = undefined;
      if (friendshipDrop) pokemon.addFriendship(-friendshipDrop);
      return result(pokemon, true, { returnItem, sound, feedback: true });
    },
  };
}

function reviveBehaviour(typeId: string): ItemBehaviour {
  const id = typeId.slice("cobblemon:".length);
  const ratio = REVIVE_RATIOS[id] ?? 0.5;
  const herb = id === "revival_herb";
  return {
    typeId, kind: "revive",
    canUse: isFainted,
    apply(pokemon) {
      if (!isFainted(pokemon)) return result(pokemon, false);
      const max = maxHp(pokemon);
      pokemon.currentHealth = ratio >= 1 ? max : Math.ceil(max * ratio);
      if (herb) pokemon.addFriendship(-REVIVAL_HERB_FRIENDSHIP_DROP);
      return result(pokemon, true, { sound: herb ? ITEM_SOUNDS.herb : ITEM_SOUNDS.pills, feedback: true });
    },
  };
}

function restorePpBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  const isBerry = data.category === "berry";
  const allMoves = data.target === "all_moves";
  const full = data.amount === "full";
  const amount = typeof data.amount === "number" ? data.amount : 10;
  const restore = (pokemon: PokemonData, slot: number): boolean => {
    const info = pokemon.movesInfo[slot];
    if (!hasMissingPp(pokemon, slot)) return false;
    info.pp = full ? info.maxPp : Math.min(info.maxPp, info.pp + amount);
    return true;
  };
  const extra = { returnItem: isBerry ? undefined : GLASS_BOTTLE, sound: isBerry ? ITEM_SOUNDS.berry : ITEM_SOUNDS.liquid, feedback: true };
  const anyMissing = (pokemon: PokemonData) => pokemon.moves.some((_, slot) => hasMissingPp(pokemon, slot));
  if (allMoves) return {
    typeId, kind: "restore_pp",
    canUse: anyMissing,
    apply(pokemon) {
      let changed = false;
      pokemon.moves.forEach((_, slot) => { changed = restore(pokemon, slot) || changed; });
      return result(pokemon, changed, extra);
    },
  };
  return {
    typeId, kind: "restore_pp", selectsMove: true,
    canUse: anyMissing,
    canUseOnMove: (pokemon, slot) => hasMissingPp(pokemon, slot),
    apply(pokemon, ctx) {
      const slot = ctx?.moveSlot;
      if (slot === undefined) return result(pokemon, false);
      return result(pokemon, restore(pokemon, slot), extra);
    },
  };
}

function ppUpBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  const stages = typeof data.stages === "number" ? data.stages : 1;
  const canRaise = (pokemon: PokemonData, slot: number) => !!pokemon.moves[slot] && pokemon.getPpStages(slot) < MAX_PP_STAGES;
  return {
    typeId, kind: "pp_up", selectsMove: true,
    canUse: pokemon => pokemon.moves.some((_, slot) => canRaise(pokemon, slot)),
    canUseOnMove: canRaise,
    apply(pokemon, ctx) {
      const slot = ctx?.moveSlot;
      if (slot === undefined || !canRaise(pokemon, slot)) return result(pokemon, false);
      const ok = stages >= MAX_PP_STAGES ? pokemon.ppMax(slot) : pokemon.raiseMaxPp(slot, stages);
      return result(pokemon, ok, { returnItem: GLASS_BOTTLE, sound: ITEM_SOUNDS.pills, feedback: true });
    },
  };
}

function evBehaviour(typeId: string, data: ItemData): ItemBehaviour | undefined {
  const stat = statKey(data.stat);
  const amount = EV_AMOUNTS[data.category];
  if (!stat || !amount) return undefined;
  const vitamin = data.category === "vitamin";
  return {
    typeId, kind: "ev",
    // EVIncreaseItem.canUseOnPokemon: só o limite por atributo (o total é conferido ao somar).
    canUse: pokemon => (pokemon.evs[stat] ?? 0) < MAX_EV_PER_STAT,
    apply(pokemon) {
      const gained = pokemon.addEvs({ [stat]: amount });
      return result(pokemon, gained > 0, {
        returnItem: vitamin ? GLASS_BOTTLE : undefined, sound: vitamin ? ITEM_SOUNDS.pills : ITEM_SOUNDS.feather, feedback: true,
      });
    },
  };
}

function resetEvsBehaviour(typeId: string): ItemBehaviour {
  return {
    typeId, kind: "reset_evs",
    canUse: pokemon => pokemon.getEvTotal() > 0,
    apply: pokemon => result(pokemon, pokemon.resetEvs(), { sound: ITEM_SOUNDS.generic, feedback: true }),
  };
}

function evBerryBehaviour(typeId: string, data: ItemData): ItemBehaviour | undefined {
  const stat = statKey(data.stat);
  if (!stat) return undefined;
  const lower = typeof data.ev === "number" ? Math.max(0, data.ev) : 10;
  return {
    typeId, kind: "ev_berry",
    // FriendshipRaisingBerryItem: tem EV para tirar ou amizade abaixo do máximo.
    canUse: pokemon => (pokemon.evs[stat] ?? 0) > 0 || pokemon.friendship < pokemon.getMaxFriendship(),
    apply(pokemon) {
      const raised = pokemon.addFriendship(resolveFriendshipRaise(data.friendship, pokemon.friendship));
      const lowered = pokemon.removeEvs({ [stat]: lower }) !== 0;
      return result(pokemon, raised || lowered, { sound: ITEM_SOUNDS.berry, feedback: true });
    },
  };
}

function experienceBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  const levelUp = data.effect === "level_up";
  const amount = typeof data.experience === "number" ? data.experience : 0;
  return {
    typeId, kind: "experience",
    // CandyItem.canUseOnPokemon = isPlayerOwned; no nível máximo o doce não é gasto.
    canUse: pokemon => pokemon.level < getConfig().maxPokemonLevel,
    apply(pokemon, ctx) {
      const exp = levelUp ? pokemon.getExperienceToNextLevel() : amount;
      const experience = pokemon.gainExp(exp, ctx?.player);
      // Evolução não opcional ganha na hora (forceEvolve) salva uma cópia nova do Pokémon.
      const savedElsewhere = experience.evolutions.some(id => !pokemon.readyEvolutions.includes(id));
      return result(pokemon, experience.experienceAdded > 0, { experience, savedElsewhere, sound: ITEM_SOUNDS.candy });
    },
  };
}

function hyperTrainingBehaviour(typeId: string, data: ItemData): ItemBehaviour | undefined {
  const stat = statKey(data.stat);
  const delta = typeof data.amount === "number" ? data.amount : 0;
  if (!stat || !delta) return undefined;
  return {
    typeId, kind: "hyper_training",
    canUse: pokemon => pokemon.canAdjustHyperTrainedIv(stat, delta),
    apply: pokemon => result(pokemon, pokemon.adjustHyperTrainedIv(stat, delta), { sound: ITEM_SOUNDS.pills, feedback: true }),
  };
}

function mintBehaviour(typeId: string, data: ItemData): ItemBehaviour | undefined {
  const nature = typeof data.nature === "string" ? data.nature : undefined;
  if (!nature) return undefined;
  const item = itemKey(typeId);
  return {
    typeId, kind: "mint",
    canUse: pokemon => pokemon.canApplyMint(nature),
    failureMessage: pokemon => message.With(ITEM_LANG.mintSameNature, [pokemon, item]),
    apply(pokemon) {
      if (!pokemon.applyMint(nature))
        return result(pokemon, false, { messages: [message.With(ITEM_LANG.mintSameNature, [pokemon, item])] });
      return result(pokemon, true, { sound: ITEM_SOUNDS.herb, messages: [message.With(ITEM_LANG.mintInteract, [pokemon, item])] });
    },
  };
}

function abilityBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  const patch = data.ability === "hidden";
  return {
    typeId, kind: "ability",
    canUse: pokemon => patch ? pokemon.canUseAbilityPatch() : pokemon.canUseAbilityCapsule(),
    apply(pokemon) {
      const changed = patch ? pokemon.useAbilityPatch() : pokemon.useAbilityCapsule();
      if (!changed) return result(pokemon, false);
      const ability = { translate: `cobblemon.ability.${toID(pokemon.ability)}` };
      return result(pokemon, true, {
        // AbilityChangeItem: a Ability Capsule devolve uma garrafa.
        returnItem: patch ? undefined : GLASS_BOTTLE, sound: ITEM_SOUNDS.generic,
        messages: [message.With(ITEM_LANG.abilityChanged, [pokemon, ability])],
      });
    },
  };
}

/** Evoluções que o item dispara agora (ItemInteractionEvolution; Link Cable também TradeEvolution sem parceiro). */
export function findItemEvolutions(pokemon: PokemonData, typeId: string): Evolution[] {
  let evolutions: Evolution[];
  try { evolutions = pokemon.getEvolutions(); } catch { return []; }
  const stack = { typeId } as unknown as ItemStack;
  const found = evolutions.filter(evolution =>
    evolution instanceof ItemInteractionEvolution && evolution.testContext(pokemon, stack) && evolution.test(pokemon));
  // LinkCableItem: evoluções por troca sem parceiro exigido (requiredContext vazio), com requisitos cumpridos.
  if (typeId === "cobblemon:link_cable")
    found.push(...evolutions.filter(evolution =>
      evolution instanceof TradeEvolution && !evolution.requiredContext.originalString && evolution.test(pokemon)));
  // Uma evolução opcional já na fila não "começa" de novo (Evolution.evolve devolve falso).
  return found.filter(evolution => !(evolution.optional && pokemon.readyEvolutions.includes(evolution.id)));
}

function evolutionBehaviour(typeId: string, data: ItemData): ItemBehaviour {
  return {
    typeId, kind: "evolution",
    // Comidas (maçãs, doces) e itens segurados só evoluem apontando para o Pokémon, como no Cobblemon.
    entityOnly: data.category !== "evolution_item",
    passIfUnusable: true,
    canUse: pokemon => findItemEvolutions(pokemon, typeId).length > 0,
    apply(pokemon) {
      for (const evolution of findItemEvolutions(pokemon, typeId)) {
        // Só consome quando a evolução realmente começa (ContextEvolution.attemptEvolution).
        if (evolution.evolve(pokemon))
          return result(pokemon, true, { savedElsewhere: !evolution.optional, sound: ITEM_SOUNDS.generic });
      }
      return result(pokemon, false);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// TM

/** TechnicalMachineItem: a forma aprende o golpe por TM (`tmLearnableMoves` = só a lista de TMs). */
export function canLearnFromTM(pokemon: PokemonData, move: string): boolean {
  return pokemon.getMoveSources(toID(move)).includes("tm");
}
/** Já conhece: está no moveset ou entre os acessíveis (por nível até o atual + guardados). */
export function alreadyKnowsMove(pokemon: PokemonData, move: string): boolean {
  move = toID(move);
  return pokemon.moves.includes(move) || pokemon.getAccessibleMoves().includes(move);
}

function tmBehaviour(typeId: string): ItemBehaviour {
  const validMove = (move?: string) => !!move && Dex.moves.get(move).exists;
  const canUse = (pokemon: PokemonData, ctx?: ItemUseContext) =>
    validMove(ctx?.tmMove) && canLearnFromTM(pokemon, ctx!.tmMove!) && !alreadyKnowsMove(pokemon, ctx!.tmMove!);
  const failureMessage = (pokemon: PokemonData, ctx?: ItemUseContext): RawMessage => {
    const move = ctx?.tmMove;
    if (!validMove(move)) return { translate: ITEM_LANG.tmUnknownMove };
    if (!canLearnFromTM(pokemon, move!)) return message.With(ITEM_LANG.tmCannotLearn, [pokemon, getMoveTranslation(move!)]);
    return message.With(ITEM_LANG.tmAlreadyKnown, [pokemon, getMoveTranslation(move!)]);
  };
  return {
    typeId, kind: "tm", canUse, failureMessage,
    apply(pokemon, ctx) {
      const move = toID(ctx?.tmMove ?? "");
      if (!canUse(pokemon, ctx)) return result(pokemon, false, { messages: [failureMessage(pokemon, ctx)] });
      const hadSpace = pokemon.moves.length < MOVE_COUNT;
      // Sem espaço o golpe fica guardado (benchedMoves), como no Cobblemon.
      if (!pokemon.teachMove(move)) return result(pokemon, false);
      return result(pokemon, true, {
        consume: !getConfig().infiniteTmUses,
        sound: hadSpace ? ITEM_SOUNDS.moveLearn : ITEM_SOUNDS.tm,
        messages: [message.prefix("§a", message.With(ITEM_LANG.tmTeach, [pokemon, getMoveTranslation(move)]))],
        benchedMove: hadSpace ? undefined : move,
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tabela

function buildBehaviour(typeId: string): ItemBehaviour | undefined {
  if (typeId === "cobblemon:technical_machine") return tmBehaviour(typeId);
  const data = getItemData(typeId);
  if (!data) return undefined;
  const effect = data.effect;
  switch (data.category) {
    case "medicine":
    case "berry":
      if (effect === "heal") return healBehaviour(typeId, data);
      if (effect === "cure_status") return statusBehaviour(typeId, data);
      if (effect === "revive") return reviveBehaviour(typeId);
      if (effect === "restore_pp") return restorePpBehaviour(typeId, data);
      if (effect === "pp_up") return ppUpBehaviour(typeId, data);
      if (effect === "change_ability") return abilityBehaviour(typeId, data);
      if (effect === "lower_ev_raise_friendship") return evBerryBehaviour(typeId, data);
      break;
    case "vitamin":
    case "feather":
    case "mochi":
      if (effect === "reset_evs") return resetEvsBehaviour(typeId);
      return evBehaviour(typeId, data);
    case "candy":
      return experienceBehaviour(typeId, data);
    case "hyper_training":
      return hyperTrainingBehaviour(typeId, data);
    case "mint":
      return mintBehaviour(typeId, data);
  }
  if (data.evolution === true || data.category === "evolution_item") return evolutionBehaviour(typeId, data);
  return undefined;
}

const cache = new Map<string, ItemBehaviour | undefined>();

/**
 * Frente msd-fase3: comportamento de um item de extensão (Tera Shards, Max Soup, Dynamax Candy... do Mega Showdown),
 * usado pelos mesmos caminhos dos itens do Cobblemon (apontar para o Pokémon ou escolher no time). Sem registro (mundo
 * sem a extensão), nada muda.
 */
export function registerItemBehaviour(behaviour: ItemBehaviour): void {
  cache.set(behaviour.typeId, behaviour);
}

/** Comportamento do item fora de batalha, ou undefined se o item não é usado em Pokémon. */
export function getItemBehaviour(typeId: string): ItemBehaviour | undefined {
  if (!cache.has(typeId)) cache.set(typeId, buildBehaviour(typeId));
  return cache.get(typeId);
}

/**
 * Atalho para testes e comandos: aplica o item ao Pokémon (sem interface).
 * Itens que escolhem golpe precisam de `ctx.moveSlot`; TMs, de `ctx.tmMove`.
 */
export function useItemOn(pokemon: PokemonData, typeId: string, ctx: ItemUseContext = {}): ItemUseResult {
  const behaviour = getItemBehaviour(typeId);
  if (!behaviour) return result(pokemon, false);
  if (!behaviour.canUse(pokemon, ctx)) {
    const reason = behaviour.failureMessage?.(pokemon, ctx);
    return result(pokemon, false, { messages: reason ? [reason] : [] });
  }
  if (behaviour.selectsMove && (ctx.moveSlot === undefined || !behaviour.canUseOnMove?.(pokemon, ctx.moveSlot, ctx)))
    return result(pokemon, false);
  return behaviour.apply(pokemon, ctx);
}
