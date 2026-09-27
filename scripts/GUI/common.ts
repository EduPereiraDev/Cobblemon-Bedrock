/**
 * Utilidades compartilhadas pelas telas (time, resumo, PC, config): textos traduzíveis,
 * leitura "defensiva" dos dados do Pokémon e persistência depois de editar.
 */
import { Player, RawMessage } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { PokemonData } from "../Pokemon";
import { FormData, toSpeciesId } from "../speciesData";
import { hasPortrait, portraitIconTexture, portraitTexture, profileTexture } from "../../generated/scripts/portraits";
import { toID } from "../utils";
import { PCLocation, PCPlace, setPokemonToPCLocation } from "../pokemonStorage";
import { tryGetBattleFromEntity } from "../battle";

/** Argumento aceito por `tr`: texto literal, número, mensagem pronta ou Pokémon (vira o nome traduzido). */
export type TrArg = string | number | RawMessage | PokemonData;

/** Mensagem traduzível com argumentos posicionais (%1$s, %2$s...). */
export function tr(key: string, ...args: TrArg[]): RawMessage {
  if (args.length === 0) return { translate: key };
  return {
    translate: key,
    with: {
      rawtext: args.map(arg => arg instanceof PokemonData ? arg.getTranslatedName()
        : typeof arg === "string" || typeof arg === "number" ? { text: String(arg) }
          : arg)
    }
  };
}

/** Junta pedaços (texto e mensagens) numa RawMessage só. */
export function join(...parts: (string | RawMessage | undefined)[]): RawMessage {
  return { rawtext: parts.filter(x => x !== undefined).map(x => typeof x === "string" ? { text: x } : x!) };
}

/** Chaves de texto exclusivas do port (pedidas em docs/pendencias/interface.md). */
export const K = {
  sendOut: "cobblemon.port.party.send_out",
  recall: "cobblemon.port.party.recall",
  nickname: "cobblemon.port.party.nickname",
  nicknameHint: "cobblemon.port.party.nickname_hint",
  toPC: "cobblemon.port.party.to_pc",
  releaseConfirm: "cobblemon.port.release.confirm",
  released: "cobblemon.port.release.done",
  lastParty: "cobblemon.port.storage.last_party",
  storageFull: "cobblemon.port.storage.full",
  partyFull: "cobblemon.port.storage.party_full",
  inBattle: "cobblemon.port.in_battle",
  heldTake: "cobblemon.port.held.take",
  heldGive: "cobblemon.port.held.give",
  heldNone: "cobblemon.port.held.none",
  heldTaken: "cobblemon.port.held.taken",
  heldEmptyHand: "cobblemon.port.held.empty_hand",
  movesSwap: "cobblemon.port.moves.swap",
  movesSwapWith: "cobblemon.port.moves.swap_with",
  movesNoneToLearn: "cobblemon.port.moves.none_to_learn",
  movesLastMove: "cobblemon.port.moves.last_move",
  movesEmptySlot: "cobblemon.port.moves.empty_slot",
  heldItem: "cobblemon.port.summary.held_item",
  ball: "cobblemon.port.summary.ball",
  marks: "cobblemon.port.summary.marks",
  noMarks: "cobblemon.port.summary.no_marks",
  minted: "cobblemon.port.summary.minted",
  pcMove: "cobblemon.port.pc.move",
  pcMoveTo: "cobblemon.port.pc.move_to",
  pcWithdraw: "cobblemon.port.pc.withdraw",
  pcRename: "cobblemon.port.pc.rename",
  pcRenameHint: "cobblemon.port.pc.rename_hint",
  pcGoto: "cobblemon.port.pc.goto",
  pcBoxCount: "cobblemon.port.pc.box_count",
  hudOn: "cobblemon.port.hud.on",
  hudOff: "cobblemon.port.hud.off",
  hudDisabled: "cobblemon.port.hud.disabled",
  starterConfirm: "cobblemon.port.starter.confirm",
  configTitle: "cobblemon.port.config.title",
  configSaved: "cobblemon.port.config.saved",
  configReset: "cobblemon.port.config.reset_done",
  configInvalid: "cobblemon.port.config.invalid",
  configJsonOnly: "cobblemon.port.config.json_only",
  back: "gui.back",
  next: "gui.next",
  empty: "hudScreen.tooltip.empty",
} as const;

/**
 * Ícone do Pokémon para forms e JSON UI: retrato pré-renderizado (rosto 64 px, enquadramento de retrato do
 * Cobblemon) da espécie na variante visual `variant` (= `PokemonData.variant`: shiny, forma, gênero, camadas).
 * Aceita o próprio PokemonData (usa espécie e variant dele) ou só o nome da espécie (variant 0 se omitido).
 * Espécie sem retrato gerado cai no sprite antigo em textures/sprites.
 */
export function getPokemonSpriteTexture(species: string | PokemonData, variant?: number): string {
  const name = typeof species === "string" ? species : species.species;
  const id = toSpeciesId(name);
  if (hasPortrait(id)) return portraitTexture(id, variant ?? (typeof species === "string" ? 0 : species.variant ?? 0));
  return "textures/sprites/" + name
    .toLowerCase()
    .replace(" ", "-")
    .replace(/[^a-z0-9\-]+/g, '');
}

/** Rosto 32 px (grades do PC/Pokédex e tiles pequenos), com a mesma regra de variante e reserva. */
export function getPokemonIconTexture(species: string | PokemonData, variant?: number): string {
  const name = typeof species === "string" ? species : species.species;
  const id = toSpeciesId(name);
  if (hasPortrait(id)) return portraitIconTexture(id, variant ?? (typeof species === "string" ? 0 : species.variant ?? 0));
  return getPokemonSpriteTexture(name);
}

/** Corpo inteiro 128 px (enquadramento do Summary do Cobblemon), com a mesma regra de variante. */
export function getPokemonProfileTexture(species: string | PokemonData, variant?: number): string {
  const name = typeof species === "string" ? species : species.species;
  const id = toSpeciesId(name);
  if (hasPortrait(id)) return profileTexture(id, variant ?? (typeof species === "string" ? 0 : species.variant ?? 0));
  return getPokemonSpriteTexture(name);
}

/** Shows a yes or no dialog to the player
 * @returns true if yes, false if no, and undefined if cancelled.
 */
export async function showYesOrNoDialog(player: Player, bodyText: string | RawMessage, title?: string | RawMessage): Promise<boolean | undefined> {
  let confirmationDialog = new MessageFormData()
    .title(title || { translate: "cobblemon.ui.generic.yes" })
    .body(bodyText)
    .button1({ translate: "cobblemon.ui.generic.no" })
    .button2({ translate: "cobblemon.ui.generic.yes" })

  let response = await confirmationDialog.show(player);
  if (response.selection === undefined) return undefined;
  if (response.selection === 1) return true;
  if (response.selection === 0) return false;
  return undefined;
}

/** True se o jogador está numa batalha ativa. */
export function isInBattle(player: Player): boolean {
  try { return tryGetBattleFromEntity(player) !== undefined; }
  catch { return false; }
}

/** Recolhe (remove do mundo) a entidade do Pokémon se ele estiver fora da bola. */
export function recallIfOut(pokemon: PokemonData) {
  const entity = pokemon.tryGetPokemonOut();
  if (entity?.isValid) entity.triggerEvent("cobblemon:instant_kill");
}

/**
 * Dados mais atuais do Pokémon: se ele está fora da bola, a entidade tem o HP/item mais recentes.
 * `stored` é a cópia salva no time/PC.
 */
export function getLivePokemon(stored: PokemonData): PokemonData {
  const entity = stored.tryGetPokemonOut();
  if (!entity) return stored;
  return PokemonData.tryGetFromEntity(entity) ?? stored;
}

/** Salva o Pokémon editado no local de origem e atualiza a entidade se estiver fora. */
export function savePokemon(player: Player, location: PCLocation, pokemon: PokemonData) {
  if (location.location === PCPlace.Team) pokemon.tryUpdatePokemonOut();
  setPokemonToPCLocation(player, location, pokemon);
}

/** Forma ativa do Pokémon (undefined = forma padrão). */
export function getForm(pokemon: PokemonData): FormData | undefined {
  try { return pokemon.getFormData(); } catch { return undefined; }
}

/** Tipos (primário e opcional secundário) considerando a forma. */
export function getPokemonTypes(pokemon: PokemonData): string[] {
  try { return pokemon.getTypes().map(x => String(x).toLowerCase()); } catch { return []; }
}

/** Amizade. */
export function getFriendship(pokemon: PokemonData): number {
  return pokemon.friendship ?? 0;
}

/** Natureza efetiva de uma Mint, se houver. */
export function getMintedNature(pokemon: PokemonData): string | undefined {
  return pokemon.mintedNature || undefined;
}

/** Marcas (ids como `cobblemon:mark_lunchtime`). */
export function getMarks(pokemon: PokemonData): string[] {
  return Array.isArray(pokemon.marks) ? pokemon.marks : [];
}

/** Experiência atual e quanto falta para o próximo nível. */
export function getExpProgress(pokemon: PokemonData): { experience: number; toNextLevel: number } {
  let toNextLevel = 0;
  try { toNextLevel = Math.max(0, pokemon.getExperienceToNextLevel()); } catch { }
  return { experience: pokemon.experience, toNextLevel };
}

/** Texto traduzível de um id com namespace opcional ("cobblemon:leftovers" → item.cobblemon.leftovers). */
export function itemName(itemId: string | undefined): RawMessage {
  if (!itemId) return tr(K.heldNone);
  const [namespace, id] = itemId.includes(":") ? itemId.split(":", 2) : ["cobblemon", itemId];
  if (namespace === "cobblemon") return { translate: `item.cobblemon.${id}` };
  return { translate: `item.${id}.name` };
}

/** Nome traduzido de uma natureza ("Adamant" / "adamant"). */
export function natureName(nature: string): RawMessage {
  return { translate: `cobblemon.nature.${toID(nature.replace(/^cobblemon:/, ""))}` };
}

/** Nome traduzido de uma habilidade. */
export function abilityName(ability: string): RawMessage {
  return { translate: `cobblemon.ability.${toID(ability.replace(/^cobblemon:/, ""))}` };
}

/** Nome traduzido de um tipo. */
export function typeName(type: string): RawMessage {
  return { translate: `cobblemon.type.${toID(type)}` };
}

/** "§a♥ 35/40" (verde/amarelo/vermelho conforme o HP). */
export function hpText(pokemon: PokemonData): string {
  const max = Math.max(1, pokemon.maxHealth);
  const ratio = pokemon.currentHealth / max;
  const color = pokemon.currentHealth <= 0 ? "§8" : ratio > 0.5 ? "§a" : ratio > 0.2 ? "§e" : "§c";
  return `${color}${Math.max(0, pokemon.currentHealth)}/${max}§r`;
}

/** Abreviação traduzida do status (QMD, PAR...), ou undefined. */
export function statusLabel(pokemon: PokemonData): RawMessage | undefined {
  if (pokemon.currentHealth <= 0) return { translate: "cobblemon.ui.status.fnt" };
  if (!pokemon.status) return undefined;
  return { translate: `cobblemon.ui.status.${pokemon.status}` };
}

/** Número 1-based de exibição. */
export function displayIndex(index: number): string {
  return (index + 1).toString();
}
