import { recallAnimated, sendOutAnimated } from "../pokemon/SendOutAnimation";
import { awardStat } from "../events/PlayerStats";
import { canRidePokemon, canShoulderMount, isOnShoulder, startRiding, toggleShoulder } from "../entity";
import { FORBIDDEN_HELD_ITEM_LANG, isForbiddenHeldItem } from "../pokemon/HeldItems";
/**
 * Menu do time (substitui o overlay de time + a roda de interação do Cobblemon, que não existem
 * no Bedrock): lista os 6 espaços com nível/HP/status e, por Pokémon, mandar para fora/recolher,
 * resumo, golpes, item segurado, apelido, evoluir, mandar para o PC e soltar.
 */
import { GameMode, ItemStack, Player, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { PokemonData } from "../Pokemon";
import { message, renderPokemonName } from "../language";
import { Evolution } from "../evolution";
import {
  PCLocation, PCPlace, StorageResult, countParty, depositToPC, getPokemonFromPCLocation, getSafeTeam, releasePokemon,
} from "../pokemonStorage";
import {
  K, getLivePokemon, getPokemonSpriteTexture, hpText, isInBattle, itemName, join, recallIfOut, savePokemon,
  showYesOrNoDialog, statusLabel, tr,
} from "./common";
import { showSummary } from "./Summary";
import { canWearCosmetics, findCosmeticFor } from "../pokemon/CosmeticItems";
import { showMovesMenu } from "./Moves";
import { openPCGui } from "./PC";
import { extraPartyActions } from "./partyActions"; // frente msd-fase2: ações de extensões (Mega fora da batalha)
import { CobblemonEvents } from "../events/CobblemonEvents"; // frente msd-fase2: HELD_ITEM_POST

/** Texto do botão de um Pokémon: nome colorido pelo tipo, nível, HP e status. */
export function partyButtonText(pokemon: PokemonData, isOut = false): RawMessage {
  const name = renderPokemonName(pokemon);
  const status = statusLabel(pokemon);
  return join(typeof name === "string" ? { text: name } : name, "§r\n", hpText(pokemon), status ? join("  §c", status) : undefined, isOut ? " §b●" : undefined);
}

/** Mensagem para um resultado de armazenamento recusado. */
export function storageError(result: StorageResult): RawMessage | undefined {
  switch (result) {
    case StorageResult.Ok: return undefined;
    case StorageResult.LastPartyPokemon: return message.error(tr(K.lastParty));
    case StorageResult.NoSpace: return message.error(tr(K.storageFull));
    default: return message.error(tr("cobblemon.command.general.invalid-party-slot", "?"));
  }
}

/** Menu principal do time. Resolve quando o jogador fecha. */
export async function openPartyMenu(player: Player): Promise<void> {
  while (true) {
    const team = getSafeTeam(player);
    if (!team.some(x => x != null)) {
      player.sendMessage(message.warn({ translate: "cobblemon.ui.starter.chooseyourstarter", with: ["/cobblemon:starter"] }));
      return;
    }
    const form = new ActionFormData().title({ translate: "cobblemon.ui.party" });
    team.forEach(pokemon => {
      if (!pokemon) form.button({ translate: K.empty });
      else form.button(partyButtonText(pokemon, !!pokemon.tryGetPokemonOut()), getPokemonSpriteTexture(pokemon.species));
    });
    form.button("PC", "textures/block/pc");
    const response = await form.show(player);
    if (response.selection === undefined) return;
    if (response.selection === team.length) {
      await openPCGui(player);
      continue;
    }
    if (!team[response.selection]) continue;
    await showPartyPokemonMenu(player, response.selection);
  }
}

/** Menu de um Pokémon do time. Resolve quando o jogador volta ao time. */
export async function showPartyPokemonMenu(player: Player, slot: number): Promise<void> {
  const location: PCLocation = { location: PCPlace.Team, space: slot };
  while (true) {
    const stored = getPokemonFromPCLocation(player, location);
    if (!stored) return;
    const pokemon = getLivePokemon(stored);
    const isOut = !!pokemon.tryGetPokemonOut();
    const evolutions = getReadyEvolutions(pokemon);

    type Action = "toggle" | "ride" | "shoulder" | "summary" | "moves" | "held" | "cosmetic" | "nickname" | "evolve" | "pc" | "release" | "back" | `extra:${number}`;
    const actions: Action[] = [];
    const form = new ActionFormData()
      .title(pokemon.getTranslatedName())
      .body(join(tr("cobblemon.label.lv", pokemon.level), "  ", hpText(pokemon), "\n",
        { translate: K.heldItem }, ": ", itemName(pokemon.minecraftItem)));
    const add = (action: Action, text: RawMessage, icon?: string) => { actions.push(action); form.button(text, icon); };
    add("toggle", tr(isOut ? K.recall : K.sendOut), getPokemonSpriteTexture(pokemon.species));
    const outEntity = isOut ? pokemon.tryGetPokemonOut() : undefined;
    if (outEntity && canRidePokemon(player, outEntity)) add("ride", tr("cobblemon.ui.interact.ride"));
    if (outEntity && (isOnShoulder(outEntity) || canShoulderMount(player, outEntity))) add("shoulder", tr("cobblemon.ui.interact.mount.shoulder"));
    add("summary", tr("cobblemon.ui.summary.title"));
    add("moves", tr("cobblemon.ui.moves"));
    add("held", tr("cobblemon.ui.interact.give.item"));
    // canGiveCosmetic da roda de interação: já veste algo ou a espécie aceita algum cosmético.
    if (canWearCosmetics(pokemon)) add("cosmetic", tr("cobblemon.ui.interact.give.cosmetic_item"));
    add("nickname", tr(K.nickname));
    if (evolutions.length > 0) add("evolve", tr("cobblemon.ui.evolve"));
    // Frente msd-fase2: ações de extensões (roda de interação do Mega Showdown: Mega/Ultra/Primal fora da batalha).
    const extras = extraPartyActions(player, pokemon, isOut);
    extras.forEach((extra, i) => add(`extra:${i}`, extra.label, extra.icon));
    add("pc", tr(K.toPC));
    add("release", tr("cobblemon.ui.pc.release"));
    add("back", tr(K.back));

    const response = await form.show(player);
    const action = response.selection === undefined ? undefined : actions[response.selection];
    if (!action || action === "back") return;
    if (action.startsWith("extra:")) {
      if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); return; }
      try { await extras[Number(action.slice(6))]?.run(player, pokemon); }
      catch (e) { console.warn(`[menu do time] ação extra: ${e}`); }
      return;
    }
    switch (action) {
      case "toggle":
        // Frente dados-ui: com a bola e o feixe (sendOutWithAnimation/recallWithAnimation).
        if (isOut) await recallAnimated(player, pokemon);
        else if (pokemon.currentHealth <= 0) player.sendMessage(message.error(tr("cobblemon.battle.pokemon_already_fainted", pokemon)));
        else await sendOutAnimated(player, pokemon);
        return;
      case "ride":
        if (outEntity?.isValid) startRiding(player, outEntity);
        return;
      case "shoulder":
        if (outEntity?.isValid) toggleShoulder(player, outEntity);
        return;
      case "summary":
        await showSummary(player, pokemon);
        break;
      case "moves":
        await showMovesMenu(player, location, pokemon);
        break;
      case "held":
        await showHeldItemMenu(player, location, pokemon);
        break;
      case "cosmetic":
        await showCosmeticItemMenu(player, location, pokemon);
        break;
      case "nickname":
        if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); break; }
        await showNicknameForm(player, location, pokemon);
        break;
      case "evolve":
        if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); break; }
        await showEvolveMenu(player, pokemon, evolutions);
        break;
      case "pc": {
        if (isInBattle(player)) { player.sendMessage(message.error({ translate: "cobblemon.pc.inbattle" })); break; }
        const result = depositToPC(player, slot);
        if (result === StorageResult.Ok) { recallIfOut(pokemon); return; }
        const error = storageError(result);
        if (error) player.sendMessage(error);
        break;
      }
      case "release":
        if (await confirmRelease(player, location, pokemon)) return;
        break;
    }
  }
}

/** Evoluções prontas (o Pokémon atende os requisitos e está em readyEvolutions). */
function getReadyEvolutions(pokemon: PokemonData): Evolution[] {
  // Everstone impede evoluir (o Cobblemon esconde o botão).
  if (pokemon.readyEvolutions.length === 0 || pokemon.isEvolutionBlocked()) return [];
  try {
    const all = pokemon.getEvolutions();
    return pokemon.readyEvolutions.map(id => all.find(evo => evo.id === id)).filter((x): x is Evolution => x !== undefined);
  }
  catch { return []; }
}

async function showEvolveMenu(player: Player, pokemon: PokemonData, evolutions: Evolution[]) {
  const form = new ActionFormData().title(tr("cobblemon.ui.evolution"));
  evolutions.forEach(evo => {
    const result = evo.result.apply(pokemon);
    const name = renderPokemonName(result);
    form.button(typeof name === "string" ? { text: name } : name, getPokemonSpriteTexture(result.species));
  });
  form.button({ translate: K.back });
  const response = await form.show(player);
  if (response.selection === undefined || response.selection >= evolutions.length) return;
  // A batalha pode ter começado com a tela aberta.
  if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); return; }
  // Está no time deste jogador: o forceEvolve acha o dono pelo trainer (saves antigos podem não ter).
  pokemon.trainer = player.id;
  evolutions[response.selection].forceEvolve(pokemon);
}

/** Confirma e solta um Pokémon. @returns true se soltou. */
export async function confirmRelease(player: Player, location: PCLocation, pokemon: PokemonData): Promise<boolean> {
  if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); return false; }
  if (location.location === PCPlace.Team && countParty(player) <= 1) {
    player.sendMessage(message.error(tr(K.lastParty)));
    return false;
  }
  const yes = await showYesOrNoDialog(player, tr(K.releaseConfirm, pokemon), tr("cobblemon.ui.pc.release"));
  if (!yes) return false;
  // Relê o local: o Pokémon pode ter mudado de lugar enquanto a pergunta estava aberta.
  const current = getPokemonFromPCLocation(player, location);
  if (!current || current.uuid !== pokemon.uuid) return false;
  const result = releasePokemon(player, location);
  if (result !== StorageResult.Ok) {
    const error = storageError(result);
    if (error) player.sendMessage(error);
    return false;
  }
  recallIfOut(pokemon);
  player.sendMessage(tr(K.released, pokemon));
  // ReleasePokemonEvent.Post → StatHandler.onRelease; som do PC (StorageWidget: PC_RELEASE).
  awardStat(player, "released");
  try { player.playSound("cobblemon.pc.release"); } catch { }
  return true;
}

/** Apelido (vazio volta ao nome da espécie). */
export async function showNicknameForm(player: Player, location: PCLocation, pokemon: PokemonData) {
  const response = await new ModalFormData()
    .title(tr(K.nickname))
    .textField(pokemon.getTranslatedName(), tr(K.nicknameHint), { defaultValue: pokemon.name })
    .show(player);
  const value = response.formValues?.[0];
  if (typeof value !== "string") return;
  // A batalha pode ter começado com a tela aberta: não grava por cima dos dados da batalha.
  if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); return; }
  const nickname = value.replace(/§./g, "").trim().slice(0, 12);
  if (nickname === pokemon.name) return;
  pokemon.name = nickname;
  savePokemon(player, location, pokemon);
}

/** Item segurado: tirar (volta ao inventário) ou dar o item da mão. */
export async function showHeldItemMenu(player: Player, location: PCLocation, pokemon: PokemonData) {
  const hand = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
  const handItem = hand?.hasItem() ? hand.getItem() : undefined;
  const form = new ActionFormData()
    .title(tr("cobblemon.ui.interact.give.item"))
    .body(join({ translate: K.heldItem }, ": ", itemName(pokemon.minecraftItem)));
  const options: ("give" | "take")[] = [];
  if (handItem) { form.button(join(tr(K.heldGive), "\n§8", handItem.typeId)); options.push("give"); }
  if (pokemon.minecraftItem) { form.button(tr(K.heldTake)); options.push("take"); }
  form.button({ translate: K.back });
  const response = await form.show(player);
  const option = response.selection === undefined ? undefined : options[response.selection];
  if (!option) return;
  if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); return; }
  // O menu ficou aberto: relê o Pokémon para não gravar uma cópia velha (cura passiva, troca, PC...).
  const fresh = refreshPokemon(player, location, pokemon);
  if (!fresh) return;
  pokemon = fresh;

  const container = player.getComponent("minecraft:inventory")?.container;
  const previous = pokemon.getHeldItem();
  if (option === "give") {
    const slot = container?.getSlot(player.selectedSlotIndex);
    const item = slot?.hasItem() ? slot.getItem() : undefined;
    if (!slot || !item) { player.sendMessage(message.error(tr(K.heldEmptyHand))); return; }
    // Itens que perderiam o conteúdo (bolsas, caixas de shulker): recusados (pedido E da jogabilidade).
    if (isForbiddenHeldItem(item.typeId)) { player.sendMessage(message.error({ translate: FORBIDDEN_HELD_ITEM_LANG })); return; }
    if (player.getGameMode() !== GameMode.Creative) {
      if (item.amount > 1) { item.amount -= 1; slot.setItem(item); }
      else slot.setItem(undefined);
    }
    setHeldItem(pokemon, item.typeId);
    player.sendMessage(tr("cobblemon.command.held_item", player.name, pokemon, itemName(item.typeId)));
  }
  else {
    setHeldItem(pokemon, undefined);
    player.sendMessage(tr(K.heldTaken, pokemon));
  }
  if (previous) {
    const leftover = container?.addItem(previous);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
  }
  savePokemon(player, location, pokemon);
}

/**
 * Item cosmético (PokemonEntity.offerCosmeticItem): dar o item da mão (se a espécie aceitar), trocar ou tirar.
 * O item é consumido (1) fora do criativo e o anterior volta ao inventário; os aspects mudam o visual.
 */
export async function showCosmeticItemMenu(player: Player, location: PCLocation, pokemon: PokemonData) {
  const hand = player.getComponent("minecraft:inventory")?.container?.getSlot(player.selectedSlotIndex);
  const handItem = hand?.hasItem() ? hand.getItem() : undefined;
  const valid = handItem ? findCosmeticFor(pokemon, handItem.typeId) : undefined;
  const form = new ActionFormData()
    .title(tr("cobblemon.ui.interact.give.cosmetic_item"))
    .body(join({ translate: "cobblemon.cosmetic_item" }, ": ", itemName(pokemon.cosmeticItem)));
  const options: ("give" | "take")[] = [];
  if (handItem && valid) { form.button(join(tr(K.heldGive), "\n§8", handItem.typeId)); options.push("give"); }
  if (pokemon.cosmeticItem) { form.button(tr(K.heldTake)); options.push("take"); }
  form.button({ translate: K.back });
  const response = await form.show(player);
  const option = response.selection === undefined ? undefined : options[response.selection];
  if (!option) return;
  if (isInBattle(player)) { player.sendMessage(message.error(tr(K.inBattle))); return; }
  // O menu ficou aberto: relê o Pokémon para não gravar uma cópia velha (cura passiva, troca, PC...).
  const fresh = refreshPokemon(player, location, pokemon);
  if (!fresh) return;
  pokemon = fresh;

  const container = player.getComponent("minecraft:inventory")?.container;
  let giving: string | undefined;
  if (option === "give") {
    const slot = container?.getSlot(player.selectedSlotIndex);
    const item = slot?.hasItem() ? slot.getItem() : undefined;
    if (!slot || !item || !findCosmeticFor(pokemon, item.typeId)) { player.sendMessage(message.error(tr(K.heldEmptyHand))); return; }
    if (item.typeId === pokemon.cosmeticItem) {
      player.sendMessage(message.error(tr("cobblemon.cosmetic_item.already_wearing", pokemon, itemName(item.typeId))));
      return;
    }
    if (player.getGameMode() !== GameMode.Creative) {
      if (item.amount > 1) { item.amount -= 1; slot.setItem(item); }
      else slot.setItem(undefined);
    }
    giving = item.typeId;
  }
  const returned = pokemon.setCosmeticItem(giving);
  if (returned) {
    try {
      const leftover = container?.addItem(new ItemStack(returned, 1));
      if (leftover) player.dimension.spawnItem(leftover, player.location);
    }
    catch { }
  }
  if (giving && returned) player.sendMessage(tr("cobblemon.cosmetic_item.replace", itemName(returned), pokemon, itemName(giving)));
  else if (giving) player.sendMessage(tr("cobblemon.cosmetic_item.give", pokemon, itemName(giving)));
  else if (returned) player.sendMessage(tr("cobblemon.cosmetic_item.take", itemName(returned), pokemon));
  savePokemon(player, location, pokemon);
}

/** Troca o item segurado no dado e, se o Pokémon estiver fora, também na entidade. */
export function setHeldItem(pokemon: PokemonData, itemId: string | undefined) {
  const previous = pokemon.minecraftItem;
  pokemon.minecraftItem = itemId;
  pokemon.item = itemId ? (itemId.split(":").pop() ?? "").replace(/[^a-z0-9]+/g, "") : "";
  const entity = pokemon.tryGetPokemonOut();
  const container = entity?.getComponent("minecraft:inventory")?.container;
  if (container) container.setItem(0, itemId ? new ItemStack(itemId, 1) : undefined);
  // Frente msd-fase2: HELD_ITEM_POST (o Mega Showdown desfaz Mega/Ultra/Primal quando a pedra/cristal/orbe sai).
  // Quem chama grava o Pokémon depois; ouvinte com erro não impede a troca.
  if (previous !== itemId) {
    try { CobblemonEvents.emit("HELD_ITEM_POST", pokemon, previous, itemId); }
    catch (e) { console.warn(`HELD_ITEM_POST: ${e}`); }
  }
}

/** Menu do Pokémon a partir da entidade (interagir com o próprio Pokémon fora da bola). */
export async function showPokemonMenuFromEntity(player: Player, uuid: string) {
  const slot = getSafeTeam(player).findIndex(x => x?.uuid === uuid);
  if (slot === -1) return;
  await showPartyPokemonMenu(player, slot);
}

/** Versão atual do Pokémon no local (dados vivos se estiver fora), ou undefined se ele saiu de lá. */
function refreshPokemon(player: Player, location: PCLocation, pokemon: PokemonData): PokemonData | undefined {
  const stored = getPokemonFromPCLocation(player, location);
  if (!stored || stored.uuid !== pokemon.uuid) return undefined;
  return getLivePokemon(stored);
}
