/**
 * Usar itens em Pokémon fora de batalha: a parte de interface e inventário.
 *
 * Como no Cobblemon (`PokemonSelectingItem`, `PokemonAndMoveSelectingItem`, `PokemonEntityInteraction`):
 * - usar o item no ar abre a seleção do time (Pokémon onde o item não funciona aparecem marcados);
 * - usar o item apontando para o próprio Pokémon aplica direto nele (`useItemOnPokemonEntity`, chamado por
 *   `handlePokemonInteract` em scripts/events/ScriptEvents.ts);
 * - Ethers, PP Up e Leppa/Hopo Berry pedem o golpe depois do Pokémon;
 * - o item só é gasto se teve efeito, e nunca no criativo.
 * Os efeitos em si ficam em `scripts/items/effects.ts`.
 */
import { Entity, GameMode, ItemStack, Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { PokemonData } from "../Pokemon";
import { getMoveTranslation, message, renderMove } from "../language";
import { getSafeTeam } from "../pokemonStorage";
import { K, getLivePokemon, getPokemonSpriteTexture, isInBattle, itemName, join, tr } from "../GUI/common";
import { partyButtonText } from "../GUI/Party";
import { promptMoveReplacement } from "../GUI/Battle";
import { ITEM_LANG, ItemBehaviour, ItemUseContext, ItemUseResult, getItemBehaviour } from "./effects";
import { TECHNICAL_MACHINE, getTMMove } from "./tm";
import { recordAchievementEvent } from "../ui/achievements/tracker";

/** Chaves de texto do port desta frente (pedidas em docs/pendencias/itens.md). */
export const ITEM_PORT_LANG = {
  choosePokemon: "cobblemon.port.item.choose_pokemon",
  chooseMove: "cobblemon.port.item.choose_move",
  teachTm: "cobblemon.port.item.teach_tm",
  noEffect: "cobblemon.port.item.no_effect",
  noParty: "cobblemon.port.item.no_party",
} as const;

/** "Jogador usou o item X em Y!" (mesmo texto da mochila em batalha). */
const USED_ON = "cobblemon.battle.bagitem.use";

/**
 * Uso pela entidade e pelo onUse podem chegar juntos no mesmo clique: o onUse espera alguns ticks e
 * desiste se a interação com a entidade já tratou o item.
 */
const recentEntityUse = new Map<string, number>();
const ENTITY_USE_WINDOW_TICKS = 4;
const ON_USE_DELAY_TICKS = 2;

// ---------------------------------------------------------------------------------------------
// Inventário

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

function getContainer(player: Player) {
  return player.getComponent("minecraft:inventory")?.container;
}

/** Item na mão do jogador agora. */
function heldStack(player: Player): ItemStack | undefined {
  try { return getContainer(player)?.getItem(player.selectedSlotIndex); }
  catch { return undefined; }
}

/** Mesmo item (e, para TMs, o mesmo golpe gravado). */
function sameItem(a: ItemStack | undefined, b: ItemStack): boolean {
  if (!a || a.typeId !== b.typeId) return false;
  return b.typeId !== TECHNICAL_MACHINE || getTMMove(a) === getTMMove(b);
}

/** `stack.isHeld(player)`: o jogador ainda segura o item (evita usar um item que saiu da mão durante o menu). */
function stillHeld(player: Player, stack: ItemStack): boolean {
  return player.isValid && sameItem(heldStack(player), stack);
}

/** Gasta uma unidade: primeiro da mão, senão de qualquer slot com o mesmo item. */
function consumeOne(player: Player, stack: ItemStack) {
  if (isCreative(player)) return;
  const container = getContainer(player);
  if (!container) return;
  const slots = [player.selectedSlotIndex, ...Array.from({ length: container.size }, (_, i) => i)];
  for (const index of slots) {
    const slot = container.getSlot(index);
    const item = slot.hasItem() ? slot.getItem() : undefined;
    if (!sameItem(item, stack)) continue;
    if (item!.amount > 1) slot.amount = item!.amount - 1;
    else slot.setItem(undefined);
    return;
  }
}

/** `giveOrDropItemStack`. */
function giveItem(player: Player, typeId: string) {
  try {
    const leftover = getContainer(player)?.addItem(new ItemStack(typeId, 1));
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  }
  catch (e) {
    console.warn(`Não foi possível devolver ${typeId} para ${player.name}: ${e}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Pokémon

/** Versão mais recente do Pokémon do time (a entidade, se estiver fora da bola). */
function findPartyPokemon(player: Player, uuid: string): PokemonData | undefined {
  const stored = getSafeTeam(player).find(pokemon => pokemon?.uuid === uuid);
  return stored ? getLivePokemon(stored) : undefined;
}

/** Salva na entidade (se estiver fora) e no time. */
function savePokemon(player: Player, pokemon: PokemonData) {
  pokemon.tryUpdatePokemonOut();
  pokemon.tryUpdatePokemonInTeam(player);
}

function safeCanUse(behaviour: ItemBehaviour, pokemon: PokemonData, ctx: ItemUseContext): boolean {
  try { return behaviour.canUse(pokemon, ctx); }
  catch (e) {
    console.warn(`canUse ${behaviour.typeId} em ${pokemon.species}: ${e}`);
    return false;
  }
}

function contextFor(player: Player, stack: ItemStack): ItemUseContext {
  return { player, tmMove: getTMMove(stack) };
}

function sendFailure(player: Player, behaviour: ItemBehaviour, pokemon: PokemonData, ctx: ItemUseContext, outcome?: ItemUseResult) {
  const messages: RawMessage[] = outcome?.messages.length ? outcome.messages
    : [behaviour.failureMessage?.(pokemon, ctx) ?? message.With(ITEM_PORT_LANG.noEffect, [pokemon])];
  messages.forEach(msg => player.sendMessage(msg));
}

function playSound(player: Player, sound: string | undefined, entity?: Entity) {
  if (!sound) return;
  try {
    if (entity?.isValid) entity.dimension.playSound(sound, entity.location);
    else player.playSound(sound);
  } catch { }
}

// ---------------------------------------------------------------------------------------------
// Forms

/** Mostra o form; se o jogador estiver ocupado (chat, inventário), tenta de novo por alguns segundos. */
async function showForm(player: Player, form: ActionFormData): Promise<number | undefined> {
  for (let attempt = 0; attempt < 40 && player.isValid; attempt++) {
    const response = await form.show(player);
    if (response.canceled && response.cancelationReason === FormCancelationReason.UserBusy) {
      await system.waitTicks(5);
      continue;
    }
    return response.selection;
  }
  return undefined;
}

/** Botão de algo que não pode receber o item: fica marcado. */
function unavailable(text: string | RawMessage): RawMessage {
  return join(typeof text === "string" ? { text } : text, " §4✗");
}

// ---------------------------------------------------------------------------------------------
// Aplicação

/** Aplica o efeito já escolhido (Pokémon e golpe): salva, gasta o item, mensagens e golpes novos. */
async function finishUse(player: Player, stack: ItemStack, pokemon: PokemonData, behaviour: ItemBehaviour, ctx: ItemUseContext, entity?: Entity) {
  if (!stillHeld(player, stack)) return;
  let outcome: ItemUseResult;
  try { outcome = behaviour.apply(pokemon, ctx); }
  catch (e) {
    console.warn(`Erro ao usar ${stack.typeId} em ${pokemon.species}: ${e}`);
    return;
  }
  if (!outcome.success) {
    sendFailure(player, behaviour, pokemon, ctx, outcome);
    return;
  }
  // Evolução forçada já salvou uma cópia nova; salvar este objeto desfaria a evolução.
  if (!outcome.savedElsewhere) savePokemon(player, outcome.pokemon);
  if (outcome.consume) consumeOne(player, stack);
  // Conquistas com item em Pokémon (frente telas, pedido da ui-base): evento exato no uso bem-sucedido.
  try { recordAchievementEvent(player, { type: "pokemon_interact", item: stack.typeId, species: outcome.pokemon.species.replace(/^cobblemon:/, "") }); }
  catch { /* conquistas indisponíveis */ }
  if (outcome.returnItem && !isCreative(player)) giveItem(player, outcome.returnItem);
  playSound(player, outcome.sound, entity);
  outcome.messages.forEach(msg => player.sendMessage(msg));
  if (outcome.feedback) player.sendMessage(message.With(USED_ON, [player.name, itemName(stack.typeId), outcome.pokemon]));

  // Golpes que não couberam (subida de nível) ou TM com moveset cheio: pergunta qual trocar.
  const experience = outcome.experience;
  const pending = [
    ...(experience ? experience.newMoves.filter(move => !experience.addedMoves.includes(move)) : []),
    ...(outcome.benchedMove ? [outcome.benchedMove] : []),
  ];
  for (const move of pending) {
    if (!player.isValid) return;
    const current = findPartyPokemon(player, outcome.pokemon.uuid) ?? outcome.pokemon;
    if (current.moves.includes(move)) continue;
    await promptMoveReplacement(player, current, move);
  }
}

/** Segunda etapa dos itens de golpe: escolhe o golpe e aplica. */
async function chooseMoveAndUse(player: Player, stack: ItemStack, pokemon: PokemonData, behaviour: ItemBehaviour, ctx: ItemUseContext, entity?: Entity) {
  const form = new ActionFormData()
    .title(itemName(stack.typeId))
    .body(tr(ITEM_PORT_LANG.chooseMove, itemName(stack.typeId), pokemon));
  const usable = pokemon.moves.map((_, slot) => !!behaviour.canUseOnMove?.(pokemon, slot, ctx));
  pokemon.moves.forEach((move, slot) => {
    const info = pokemon.movesInfo[slot] ? { ...pokemon.movesInfo[slot] } : undefined;
    const text = renderMove(move, info);
    form.button(usable[slot] ? text : unavailable(text));
  });
  const slot = await showForm(player, form);
  if (slot === undefined || slot >= pokemon.moves.length) return;
  const move = pokemon.moves[slot];
  const fresh = findPartyPokemon(player, pokemon.uuid) ?? pokemon;
  const freshSlot = fresh.moves.indexOf(move);
  const moveCtx = { ...ctx, moveSlot: freshSlot };
  if (freshSlot === -1 || !behaviour.canUseOnMove?.(fresh, freshSlot, moveCtx)) {
    sendFailure(player, behaviour, fresh, moveCtx);
    return;
  }
  await finishUse(player, stack, fresh, behaviour, moveCtx, entity);
}

/** Seleção do time (PartySelectCallbacks.createFromPokemon). */
async function choosePokemonAndUse(player: Player, stack: ItemStack, behaviour: ItemBehaviour) {
  if (isInBattle(player)) {
    player.sendMessage(message.error(tr(K.inBattle)));
    return;
  }
  const ctx = contextFor(player, stack);
  if (behaviour.kind === "tm" && !ctx.tmMove) {
    player.sendMessage(message.error({ translate: ITEM_LANG.tmUnknownMove }));
    return;
  }
  const members = getSafeTeam(player).filter((pokemon): pokemon is PokemonData => !!pokemon).map(getLivePokemon);
  if (members.length === 0) {
    player.sendMessage(message.warn(tr(ITEM_PORT_LANG.noParty)));
    return;
  }
  const usable = members.map(pokemon => safeCanUse(behaviour, pokemon, ctx));
  // Pedras de evolução não fazem nada no ar no Cobblemon: aqui abrem o time só se alguém puder evoluir.
  if (behaviour.kind === "evolution" && !usable.some(Boolean)) return;

  const form = new ActionFormData()
    .title(itemName(stack.typeId))
    .body(behaviour.kind === "tm"
      ? tr(ITEM_PORT_LANG.teachTm, getMoveTranslation(ctx.tmMove!))
      : tr(ITEM_PORT_LANG.choosePokemon, itemName(stack.typeId)));
  members.forEach((pokemon, i) => {
    const text = partyButtonText(pokemon, !!pokemon.tryGetPokemonOut());
    form.button(usable[i] ? text : unavailable(text), getPokemonSpriteTexture(pokemon));
  });
  const index = await showForm(player, form);
  if (index === undefined || !members[index]) return;
  if (!stillHeld(player, stack)) return;
  const pokemon = findPartyPokemon(player, members[index].uuid) ?? members[index];
  if (!safeCanUse(behaviour, pokemon, ctx)) {
    sendFailure(player, behaviour, pokemon, ctx);
    return;
  }
  if (behaviour.selectsMove) {
    await chooseMoveAndUse(player, stack, pokemon, behaviour, ctx);
    return;
  }
  await finishUse(player, stack, pokemon, behaviour, ctx);
}

// ---------------------------------------------------------------------------------------------
// Entradas

/**
 * Usou o item no ar (onUse dos componentes `cobblemon:use_on_pokemon` e `cobblemon:technical_machine`):
 * abre a seleção do time.
 */
export function onUseItem(player: Player, stack: ItemStack | undefined) {
  if (!stack) return;
  const behaviour = getItemBehaviour(stack.typeId);
  if (!behaviour || behaviour.entityOnly) return;
  // PokemonSelectingItem.use: agachado não faz nada (PokemonAndMoveSelectingItem ignora o agachar).
  if (player.isSneaking && !behaviour.selectsMove) return;
  const snapshot = stack.clone();
  system.runTimeout(() => {
    if (!player.isValid) return;
    const last = recentEntityUse.get(player.id);
    if (last !== undefined && system.currentTick - last <= ENTITY_USE_WINDOW_TICKS) return;
    void choosePokemonAndUse(player, snapshot, behaviour).catch(e => console.warn(`Uso de ${snapshot.typeId}: ${e}`));
  }, ON_USE_DELAY_TICKS);
}

/**
 * Usou o item apontando para o próprio Pokémon (fora da bola). Ordem do PokemonEntity.attemptItemInteraction:
 * evolução por item, depois o efeito do item.
 * @returns true se o item foi tratado aqui (mesmo sem efeito); false para seguir com a interação normal.
 */
export function useItemOnPokemonEntity(player: Player, entity: Entity, stack: ItemStack): boolean {
  const behaviour = getItemBehaviour(stack.typeId);
  if (!behaviour) return false;
  recentEntityUse.set(player.id, system.currentTick);
  const pokemon = PokemonData.tryGetFromEntity(entity);
  if (!pokemon) return false;
  const ctx = contextFor(player, stack);
  if (!safeCanUse(behaviour, pokemon, ctx)) {
    if (behaviour.passIfUnusable) return false;
    sendFailure(player, behaviour, pokemon, ctx);
    return true;
  }
  if (isInBattle(player)) {
    player.sendMessage(message.error(tr(K.inBattle)));
    return true;
  }
  const run = behaviour.selectsMove
    ? chooseMoveAndUse(player, stack, pokemon, behaviour, ctx, entity)
    : finishUse(player, stack, pokemon, behaviour, ctx, entity);
  void run.catch(e => console.warn(`Uso de ${stack.typeId}: ${e}`));
  return true;
}
