/**
 * Storing Pokemon Data
 * Each pokemon has a json stored in the dynamic property "data"
 * The team is stored in a jsonified array in dynamic property "team"
 * Each PC slot is its own dynamic property "pc:<box>:<slot>" (0-based), so a full box never
 * hits the 32767-char limit of a single dynamic property. Box names live in "pc:<box>:name".
 * All blank spots in either array are just null
 *
 * Número de caixas: `pc_box_count` no jogador (comando boxcount) ou `defaultBoxCount` da config.
 * As funções daqui só mexem nos dados; recolher a entidade que está fora da bola é papel de quem chama.
 */

import { awardStat } from "./events/PlayerStats";
import { Player, RawMessage } from "@minecraft/server";
import { PokemonData } from "./Pokemon";
import { getConfig } from "./Config";
import { markCaught } from "./pokedex/PokedexStorage";

/** Espaços por caixa do PC (fixo no Cobblemon: 6×5). */
export const spacesPerBox = 30;
export const SLOTS_PER_BOX = spacesPerBox;
/** Tamanho do time. */
export const PARTY_SIZE = 6;
/** Limite de caixas aceito pelo Cobblemon (IntConstraint do defaultBoxCount). */
export const MAX_BOXES = 1000;
/** Tamanho máximo do nome de uma caixa. */
export const MAX_BOX_NAME_LENGTH = 32;

const BOX_COUNT_PROPERTY = "pc_box_count";

export enum PCPlace {
  Box,
  Team
}

export interface PCLocation {
  location: PCPlace,
  boxID?: number,
  space: number
}

export interface BoxData {
  /** Custom name of box if there is one */
  name?: string,
  boxData: (PokemonData | null)[]
}

/** Resultado de operações de armazenamento que podem ser recusadas. */
export enum StorageResult {
  Ok = "ok",
  InvalidLocation = "invalid_location",
  EmptySource = "empty_source",
  /** Deixaria o time sem Pokémon (preventCompletePartyDeposit, ou soltar o último). */
  LastPartyPokemon = "last_party_pokemon",
  NoSpace = "no_space",
}

/**Initializes player;
 * Only call if player has chosen a starter pokemon or if they just caught one.
 * (If writing to data, not reading it)
 */
function initializePlayer(player: Player) {
  // O time cabe numa propriedade só (6 Pokémon, bem abaixo do limite de 32767 caracteres).
  player.setDynamicProperty("team", `[null,null,null,null,null,null]`);
  player.setDynamicProperty("initialized", true);
}
/** Guardado no time/PC de um jogador: o dono passa a ser ele (evoluir/EXP sem nunca ter saído da bola). */
function claimForPlayer(pokemon: PokemonData, player: Player) {
  pokemon.trainer = player.id;
  if (!pokemon.ogTrainer) pokemon.ogTrainer = player.name;
}
function slotKey(boxID: number, space: number) {
  return `pc:${boxID}:${space}`;
}
function nameKey(boxID: number) {
  return `pc:${boxID}:name`;
}

/** Quantas caixas o PC deste jogador tem. */
export function getBoxCount(player: Player): number {
  const own = player.getDynamicProperty(BOX_COUNT_PROPERTY);
  const count = typeof own === "number" ? own : getConfig().defaultBoxCount;
  return Math.max(1, Math.min(MAX_BOXES, Math.floor(count)));
}

/**
 * Muda o número de caixas do jogador. Recusa remover caixas com Pokémon, a menos que `force`
 * (nesse caso os Pokémon das caixas removidas continuam salvos e voltam se as caixas voltarem).
 * @returns true se mudou.
 */
export function setBoxCount(player: Player, count: number, force = false): boolean {
  count = Math.floor(count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_BOXES) return false;
  const current = getBoxCount(player);
  if (count < current && !force) {
    for (let box = count; box < current; box++)
      if (countBox(player, box) > 0) return false;
  }
  player.setDynamicProperty(BOX_COUNT_PROPERTY, count);
  return true;
}

function validBox(player: Player, boxID: number | undefined): boxID is number {
  return boxID !== undefined && Number.isInteger(boxID) && boxID >= 0 && boxID < getBoxCount(player);
}

/** True se o local existe (caixa dentro do número de caixas do jogador, espaço dentro da faixa). */
export function isValidLocation(player: Player, location: PCLocation): boolean {
  if (!Number.isInteger(location.space) || location.space < 0) return false;
  if (location.location === PCPlace.Team) return location.space < PARTY_SIZE;
  if (location.location === PCPlace.Box) return location.space < spacesPerBox && validBox(player, location.boxID);
  return false;
}

function writeBoxSlot(player: Player, boxID: number, space: number, pokemon: PokemonData | null) {
  player.setDynamicProperty(slotKey(boxID, space), pokemon ? JSON.stringify(pokemon) : undefined);
}

function generateNewBoxData(): BoxData {
  let boxArray: null[] = (new Array(spacesPerBox)).fill(null);
  return { boxData: boxArray };
}
/**
 * @returns PokemonData, null if the space is empty, and undefined if the player is not initialized or other errors
 */
export function getPokemonFromPCLocation(player: Player, location: PCLocation): PokemonData | null | undefined {
  if (!player.getDynamicProperty("initialized")) return undefined
  if (!isValidLocation(player, location)) return undefined;
  if (location.location === PCPlace.Team)
    return getSafeTeam(player)[location.space] ?? null;
  const json = player.getDynamicProperty(slotKey(location.boxID!, location.space));
  return typeof json === "string" ? PokemonData.getFromJson(json) : null;
}
/** Be Careful, this can overwrite pokemon.
 * @throws Errors
 */
export function setPokemonToPCLocation(player: Player, location: PCLocation, pokemon: PokemonData | null) {
  if (!player.getDynamicProperty("initialized"))
    initializePlayer(player);
  if (!isValidLocation(player, location)) throw new Error("Invalid PCLocation to Save to.");
  if (pokemon) claimForPlayer(pokemon, player);
  if (location.location === PCPlace.Team) {
    let pokemonArray = getSafeTeam(player);
    pokemonArray[location.space] = pokemon;
    player.setDynamicProperty("team", JSON.stringify(pokemonArray));
  }
  else {
    writeBoxSlot(player, location.boxID!, location.space, pokemon);
  }
}

/** Accepts either json or PokemonData as input and stores the pokemon to the player
 * Returns the message to send to the player.
*/
export function storePokemonInFirstSpace(data: PokemonData | string, player: Player): RawMessage | undefined {
  if (typeof data === "string") data = PokemonData.getFromJson(data);
  if (!player.getDynamicProperty("initialized") || player.getDynamicProperty("team") === undefined) initializePlayer(player);
  claimForPlayer(data, player);
  // Pokédex: entrar no time/PC (inicial, /givepokemon, troca, fóssil...) conta como obtido (POKEMON_GAINED).
  markCaught(player, data);

  //Test if team has room
  let teamJson = player.getDynamicProperty("team");
  if (typeof teamJson === "string") {
    let team = decodePokemonArray(teamJson)!;
    for (let i = 0; i < PARTY_SIZE; i++) {
      if (team[i] == null) {
        team[i] = data;
        player.setDynamicProperty("team", JSON.stringify(team));
        // StatHandler.onDexEntryGain (POKEMON_GAINED do PlayerPartyStore.add).
        awardStat(player, "dex_entries");
        return;
      }
    }
  }

  //Add if Boxes have room
  const free = findFirstEmptyBoxSlot(player);
  if (free) {
    writeBoxSlot(player, free.boxID!, free.space, data);
    awardStat(player, "dex_entries");
    return { translate: "cobblemon.overflow_to_pc", with: { rawtext: [data.getTranslatedName(), { translate: "cobblemon.ui.pc.box.title", with: [(free.boxID! + 1).toString()] }] } };
  }

  return { translate: "cobblemon.overflow_no_space" };
}

/** Primeiro espaço vazio do PC (caixa por caixa), ou undefined se estiver cheio. */
export function findFirstEmptyBoxSlot(player: Player, startBox = 0): PCLocation | undefined {
  const boxes = getBoxCount(player);
  for (let i = Math.max(0, startBox); i < boxes; i++) {
    for (let space = 0; space < spacesPerBox; space++) {
      if (player.getDynamicProperty(slotKey(i, space)) === undefined)
        return { location: PCPlace.Box, boxID: i, space };
    }
  }
  return undefined;
}

/** Returns Team. All empty team members are returned as null
 * @returns - Array memebers will be either data or null
 */
export function getTeam(player: Player): (PokemonData | null)[] | undefined {
  if (!player.getDynamicProperty("initialized")) return undefined;
  let teamData = player.getDynamicProperty("team");
  if (!teamData || typeof teamData != "string") return undefined;
  return decodePokemonArray(teamData);
}
/** Returns the team data, but if team data not initialized, but safer
 * @returns - Team data or [null,null,null,null,null,null] if uninitialized
 */
export function getSafeTeam(player: Player): (PokemonData | null)[] {
  const team = getTeam(player) || [];
  // Garante sempre 6 posições (times antigos ou corrompidos podem ter menos).
  while (team.length < PARTY_SIZE) team.push(null);
  return team;
}

/** Quantos Pokémon há no time. */
export function countParty(player: Player): number {
  return getSafeTeam(player).filter(x => x != null).length;
}

/** Quantos Pokémon há numa caixa. */
export function countBox(player: Player, boxID: number): number {
  let count = 0;
  for (let space = 0; space < spacesPerBox; space++)
    if (player.getDynamicProperty(slotKey(boxID, space)) !== undefined) count++;
  return count;
}

/** This exists so that all data is initialized as a class
 * @param jsonArray Either a string of a pokemonData Array or the pokemon data array itself
 */
function decodePokemonArray(jsonArray: string | (PokemonData | null)[]): (PokemonData | null)[] | undefined {
  let array: (PokemonData | null)[] = (Array.isArray(jsonArray)) ? jsonArray : JSON.parse(jsonArray);
  if (!Array.isArray(array))
    return undefined;
  //Make sure each item is initialized as a class.
  array.forEach((x, i) => {
    if (x && typeof x === "object") {
      array[i] = PokemonData.getFromJson(x);
    }
    else array[i] = null;
  });
  return array;
}
/** Removes Pokemon from space.
 * @param boxID Use index starting from 0
 * @param space Use index starting from 0
 * @throws errors
 */
// I want this function to throw errors so that duplication exploits don't happen as easily
export function removePokemon(player: Player, boxID: number, space: number) {
  if (!validBox(player, boxID) || space < 0 || space >= spacesPerBox)
    throw new Error("Invalid box slot.");
  if (player.getDynamicProperty(slotKey(boxID, space)) === undefined)
    throw new Error("There is no pokemon in that slot.");
  writeBoxSlot(player, boxID, space, null);
}

/**
 * Troca o conteúdo de dois locais (time ou PC). Se o destino estiver vazio, é só mover.
 * Respeita `preventCompletePartyDeposit`: não deixa o time vazio quando a opção está ligada.
 */
export function movePokemon(player: Player, from: PCLocation, to: PCLocation): StorageResult {
  if (!isValidLocation(player, from) || !isValidLocation(player, to)) return StorageResult.InvalidLocation;
  const source = getPokemonFromPCLocation(player, from);
  if (!source) return StorageResult.EmptySource;
  if (sameLocation(from, to)) return StorageResult.Ok;
  const target = getPokemonFromPCLocation(player, to) ?? null;
  const leavesParty = from.location === PCPlace.Team && to.location === PCPlace.Box && target === null;
  if (leavesParty && getConfig().preventCompletePartyDeposit && countParty(player) <= 1)
    return StorageResult.LastPartyPokemon;
  setPokemonToPCLocation(player, to, source);
  setPokemonToPCLocation(player, from, target);
  return StorageResult.Ok;
}

/** Manda um Pokémon do time para o primeiro espaço livre do PC. */
export function depositToPC(player: Player, teamSlot: number): StorageResult {
  const free = findFirstEmptyBoxSlot(player);
  if (!free) return StorageResult.NoSpace;
  return movePokemon(player, { location: PCPlace.Team, space: teamSlot }, free);
}

/** Traz um Pokémon do PC para o primeiro espaço livre do time. */
export function withdrawFromPC(player: Player, boxID: number, space: number): StorageResult {
  const team = getSafeTeam(player);
  const free = team.findIndex(x => x == null);
  if (free === -1) return StorageResult.NoSpace;
  return movePokemon(player, { location: PCPlace.Box, boxID, space }, { location: PCPlace.Team, space: free });
}

/** Solta (apaga) o Pokémon de um local. Não solta o último Pokémon do time. */
export function releasePokemon(player: Player, location: PCLocation): StorageResult {
  if (!isValidLocation(player, location)) return StorageResult.InvalidLocation;
  const pokemon = getPokemonFromPCLocation(player, location);
  if (!pokemon) return StorageResult.EmptySource;
  if (location.location === PCPlace.Team && countParty(player) <= 1) return StorageResult.LastPartyPokemon;
  setPokemonToPCLocation(player, location, null);
  return StorageResult.Ok;
}

/** Esvazia o time. @returns os Pokémon removidos. */
export function clearParty(player: Player): PokemonData[] {
  const removed = getSafeTeam(player).filter((x): x is PokemonData => x != null);
  if (player.getDynamicProperty("initialized"))
    player.setDynamicProperty("team", JSON.stringify(new Array(PARTY_SIZE).fill(null)));
  return removed;
}

/** Esvazia todas as caixas do PC (inclusive nomes). @returns quantos Pokémon foram removidos. */
export function clearPC(player: Player): number {
  let removed = 0;
  const boxes = getBoxCount(player);
  for (let box = 0; box < boxes; box++) {
    for (let space = 0; space < spacesPerBox; space++) {
      if (player.getDynamicProperty(slotKey(box, space)) !== undefined) {
        player.setDynamicProperty(slotKey(box, space), undefined);
        removed++;
      }
    }
    player.setDynamicProperty(nameKey(box), undefined);
  }
  return removed;
}

/** Nome da caixa (personalizado ou undefined). */
export function getBoxName(player: Player, boxID: number): string | undefined {
  const name = player.getDynamicProperty(nameKey(boxID));
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** Renomeia uma caixa. Nome vazio volta ao padrão ("Caixa N"). @returns false se a caixa não existe. */
export function renameBox(player: Player, boxID: number, name?: string): boolean {
  if (!validBox(player, boxID)) return false;
  const clean = (name ?? "").replace(/§./g, "").trim().slice(0, MAX_BOX_NAME_LENGTH);
  player.setDynamicProperty(nameKey(boxID), clean.length > 0 ? clean : undefined);
  return true;
}

function sameLocation(a: PCLocation, b: PCLocation) {
  return a.location === b.location && a.space === b.space && (a.location === PCPlace.Team || a.boxID === b.boxID);
}

/** Procura um Pokémon pelo UUID no time e no PC. */
export function findPokemonLocation(player: Player, uuid: string): PCLocation | undefined {
  const teamIndex = getSafeTeam(player).findIndex(x => x?.uuid === uuid);
  if (teamIndex !== -1) return { location: PCPlace.Team, space: teamIndex };
  const boxes = getBoxCount(player);
  for (let box = 0; box < boxes; box++) {
    for (let space = 0; space < spacesPerBox; space++) {
      const json = player.getDynamicProperty(slotKey(box, space));
      if (typeof json === "string" && json.includes(uuid) && PokemonData.getFromJson(json).uuid === uuid)
        return { location: PCPlace.Box, boxID: box, space };
    }
  }
  return undefined;
}

/** Returns PC Box Pokemon. All empty team members are returned as null
 * @returns - Array memebers will be either data or null
 */
export function getBoxTeam(player: Player, boxID: number): (PokemonData | null)[] | undefined {
  return getBoxData(player, boxID)?.boxData;
}

/** Returns PC Box Data but if the data is unintialized return an empty box */
export function getSafeBoxTeam(player: Player, boxID: number): (PokemonData | null)[] {
  return getBoxTeam(player, boxID) || generateNewBoxData().boxData;
}

export function getBoxData(player: Player, boxID: number): BoxData | undefined {
  if (!player.getDynamicProperty("initialized") || !validBox(player, boxID)) return undefined;
  const boxData: (PokemonData | null)[] = [];
  for (let space = 0; space < spacesPerBox; space++) {
    const json = player.getDynamicProperty(slotKey(boxID, space));
    boxData.push(typeof json === "string" ? PokemonData.getFromJson(json) : null);
  }
  return { name: getBoxName(player, boxID), boxData };
}

/** Returns PC Box Data but if the data is unintialized return an empty box */
export function getSafeBoxData(player: Player, boxID: number): BoxData {
  return getBoxData(player, boxID) || generateNewBoxData();
}

/** Cura um Pokémon (HP, PP e status). */
export function healPokemon(pokemon: PokemonData) {
  pokemon.updateMaxHP();
  pokemon.currentHealth = pokemon.maxHealth;
  pokemon.movesInfo.forEach((_, i, a) => {
    a[i].pp = a[i].maxPp
  })
  pokemon.status = undefined;
}

/** Pokemon.canBeHealed: HP abaixo do máximo, algum status ou golpe sem PP cheio. */
export function canBeHealed(pokemon: PokemonData): boolean {
  return pokemon.currentHealth !== pokemon.maxHealth || !!pokemon.status || pokemon.movesInfo.some(move => move && move.pp !== move.maxPp);
}

/**
 * Cura todo o PC do jogador (gamerule `healersHealPC`: HealingMachineBlock cura também `player.pc()`).
 * Só regrava os espaços que mudaram. @returns quantos Pokémon foram curados.
 */
export function healPlayerPC(player: Player): number {
  let healed = 0;
  const boxes = getBoxCount(player);
  for (let box = 0; box < boxes; box++) {
    for (let space = 0; space < spacesPerBox; space++) {
      const raw = player.getDynamicProperty(slotKey(box, space));
      if (typeof raw !== "string") continue;
      let pokemon: PokemonData;
      try { pokemon = PokemonData.getFromJson(raw); }
      catch { continue; }
      if (!canBeHealed(pokemon)) continue;
      healPokemon(pokemon);
      writeBoxSlot(player, box, space, pokemon);
      healed++;
    }
  }
  return healed;
}

/**
 * Frente msd-fase3: avisados quando o time do jogador é curado por inteiro (máquina de cura, comando, NPC: o
 * `Pokemon.heal()` do Cobblemon, que posta POKEMON_HEALED com HealingSource.Force). O Mega Showdown recarrega a Tera
 * Orb aqui. Vazio no base.
 */
export const partyHealedHooks: ((player: Player) => void)[] = [];

/** Heals the player's entire team
 * @returns whether or not it was sucessful
 */
export function healPlayerTeam(player: Player): boolean {
  let teamData = getTeam(player);
  if (teamData === undefined) return false;
  teamData.forEach((x, i, a) => {
    if (x === null) return;
    healPokemon(x);
    a[i] = x;
  })
  player.setDynamicProperty("team", JSON.stringify(teamData));
  for (const hook of partyHealedHooks) {
    try { hook(player); } catch (e) { console.warn(`Cura do time (extensão): ${e}`); }
  }
  return true;
}

export function isPlayerInitialized(player: Player): boolean {
  return !(player.getDynamicProperty("team") === undefined || player.getDynamicProperty("initialized") === undefined);
}

/** If the player's team is valid and not empty, the team will be returned. */
export function hasValidTeam(player: Player): (PokemonData | null)[] | false {
  let team = getSafeTeam(player);
  if (team.some(x => x != null && x.currentHealth > 0))
    return team;
  return false;
}

/**
 * PCBox.sort (frente dados-ui): reordena a caixa com a ordem dada por `sort` (os mesmos objetos, vazios no fim) e grava.
 * Devolve false se a caixa não existe.
 */
export function sortBox(player: Player, boxID: number, sort: (slots: (PokemonData | null)[]) => (PokemonData | null)[]): boolean {
  if (!validBox(player, boxID)) return false;
  const current = getSafeBoxTeam(player, boxID);
  const sorted = sort([...current]);
  for (let space = 0; space < spacesPerBox; space++) {
    const before = current[space] ?? null;
    const after = sorted[space] ?? null;
    if (before?.uuid === after?.uuid) continue;
    writeBoxSlot(player, boxID, space, after);
  }
  return true;
}
