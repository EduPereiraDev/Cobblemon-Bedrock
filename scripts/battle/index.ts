import { Entity, Player, RawMessage, world } from "@minecraft/server";
import { battleMap, BattleOptions, PokemonBattle } from "./PokemonBattle";
import { getSafeTeam, hasValidTeam, healPlayerTeam, healPokemon } from "../pokemonStorage";
import { PokemonData } from "../Pokemon";
import { BattleSide } from "./BattleSide";
import { ActorType, BattleActor, BattleActorOptions } from "./BattleActor";
import { BattleFormat, BattleRules } from "./BattleFormat";
import { EntityUtils, UUID } from "../utils";
import { getConfig } from "../Config";
import { message } from "../language";
import { StrongBattleAI } from "./ai/StrongBattleAI";
import type { BattleAI } from "./ai/BattleAI";
import { openSpectatorView, spectateBattleOf, spectateErrorMessage } from "./Spectate";
import { CobblemonEvents } from "../events/CobblemonEvents";
import { registerVisualBattleDebug } from "./DebugVisual";
import { registerBattleUiModes } from "./BattleUiMode";
import { isSendOutAnimating } from "../pokemon/SendOutAnimation";
import { getSelectedPokemon } from "../ui/PartySelection";

// Frente visual-batalha: `scriptevent cobblemon:debug_visual <cenário>` (só pelo console).
registerVisualBattleDebug();
// Frente batalha-minimizavel: tela da batalha minimizável (padrão `java`; preferência por jogador em /cobblemon:battleui).
registerBattleUiModes();

export { BattleActor, ActorType } from "./BattleActor";
export type { BattleActorOptions, PlayerDecider } from "./BattleActor";
export { ActionResponse } from "./ActionResponse";
export { PokemonBattle, battleMap } from "./PokemonBattle";
export type { BattleOptions, BattleEndReason } from "./PokemonBattle";
export { ActivePokemon } from "./ActivePokemon";
export { BattleFormat, BattleTypes, BattleRules } from "./BattleFormat";
export { BattleSide } from "./BattleSide";
export { RandomBattleAI, StrongBattleAI } from "./ai";
export type { BattleAI } from "./ai";
export { BAG_ITEMS, listBagItems } from "./BagItems";
export {
  addSpectator, battleStatusLines, checkSpectate, getSpectatedBattle, isSpectating, openSpectatorView, removeSpectator,
  spectateBattleOf, spectateErrorMessage,
} from "./Spectate";
export type { SpectateError } from "./Spectate";
export { isPlayerInAnyBattle } from "./PokemonBattle";

/** Checks if their battle id exists and if it doesn't, remove battle flags.
 * Also properly sets "cobblemon:in_batttle"
 */
export function cleanUpStaleBattleData(entity: Entity) {
  let battleUUID = entity.getDynamicProperty("in_battle");
  if (battleUUID && typeof battleUUID === "string" && !battleMap.has(battleUUID)) {
    entity.setDynamicProperty("in_battle", undefined);
    battleUUID = undefined;
  }
  try {
    entity.setProperty("cobblemon:in_battle", !!battleUUID);
  }
  catch { }
}

export function tryGetBattleFromEntity(entity: Entity): PokemonBattle | undefined {
  cleanUpStaleBattleData(entity);
  let battle = entity.getDynamicProperty("in_battle");
  if (battle === undefined || typeof battle != "string")
    return undefined;
  return battleMap.get(battle);
}

/** Encerra a batalha em que a entidade está (comando stopbattle). Retorna false se não havia batalha. */
export function stopBattle(entity: Entity): boolean {
  let battle = tryGetBattleFromEntity(entity);
  if (!battle)
    return false;
  battle.stop();
  return true;
}

/**
 * Jogador saiu do servidor (SERVER_PLAYER_LOGOUT do Cobblemon: `getBattleByParticipatingPlayer(player)?.stop()`).
 * Encerra na hora as batalhas de que ele participa, em vez de esperar a checagem periódica de participantes: assim
 * menu e HUD não chegam a usar a entidade já inválida, e quem ficou recebe o fim e a limpeza normais.
 * @returns as batalhas encerradas.
 */
export function stopBattlesOfLeavingPlayer(playerId: string): PokemonBattle[] {
  let stopped: PokemonBattle[] = [];
  for (let battle of [...battleMap.values()]) {
    if (battle.ended || !battle.actors.some(actor => actor.type == ActorType.PLAYER && actor.entityId === playerId))
      continue;
    battle.stop();
    stopped.push(battle);
  }
  return stopped;
}

try {
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    try { stopBattlesOfLeavingPlayer(playerId); }
    catch (e) { console.warn(`Battle playerLeave: ${e}`); }
  });
}
catch (e) {
  console.warn(`[cobblemon] batalhas: não foi possível assinar playerLeave: ${e}`);
}

function configNumber(key: string, fallback: number): number {
  let value = (getConfig() as unknown as Record<string, unknown>)[key];
  return typeof value == "number" ? value : fallback;
}

/** Erro ao iniciar (BattleStartError do Cobblemon): mensagem para quem tentou. */
export class BattleStartError {
  constructor(public text: RawMessage) { }
}

function inBattle(entity: Entity) {
  return tryGetBattleFromEntity(entity) !== undefined;
}

/** Como montar o time do jogador (PartyStore.toBattleTeam + BattleFormat.adjustLevel). */
export interface BattleTeamOptions {
  /** cloneParties: batalha com cópias (BattlePokemon.safeCopyOf); o time real não muda. */
  clone?: boolean;
  /** adjustLevel (> 0): todos no nível dado e curados; implica clone. */
  setLevel?: number;
  /** healFirst: cura antes (a cópia, ou o time real se não houver clone). */
  heal?: boolean;
}

/**
 * BattlePokemon.safeCopyOf: cópia com UUID novo marcada como clone de batalha (não é salva, não é capturável,
 * some no fim). Com `setLevel` > 0, fica no nível e curada; com `heal`, curada.
 */
export function cloneForBattle(pokemon: PokemonData, options: BattleTeamOptions = {}): PokemonData {
  const copy = PokemonData.getFromJson(JSON.stringify(pokemon));
  copy.uuid = UUID.generate();
  copy.battleClone = true;
  copy.faintedTimer = undefined;
  copy.healTimer = undefined;
  copy.statusTimer = undefined;
  if (options.setLevel !== undefined && options.setLevel > 0) {
    copy.setLevel(options.setLevel);
    healPokemon(copy);
  }
  else if (options.heal) healPokemon(copy);
  return copy;
}

/** O time vira cópias (cloneParties ou setLevel > 0). */
export function usesClones(options: BattleTeamOptions): boolean {
  return options.clone === true || (options.setLevel !== undefined && options.setLevel > 0);
}

/**
 * PartyStore.toBattleTeam: o time do jogador para a batalha, com o líder primeiro e os desmaiados no fim. Com clone,
 * o líder é mapeado para a cópia dele. Não grava nada.
 */
export function buildBattleTeam(team: readonly (PokemonData | null | undefined)[], leadUUID?: string, options: BattleTeamOptions = {}): PokemonData[] {
  let pokemon = team.filter((x): x is PokemonData => x != null);
  if (usesClones(options)) {
    pokemon = pokemon.map(original => {
      const copy = cloneForBattle(original, options);
      if (leadUUID && original.uuid == leadUUID) leadUUID = copy.uuid;
      return copy;
    });
  }
  let lead = leadUUID ? pokemon.findIndex(x => x.uuid == leadUUID && x.currentHealth > 0) : -1;
  if (lead > 0)
    pokemon.unshift(...pokemon.splice(lead, 1));
  pokemon.sort((a, b) => Number(a.currentHealth <= 0) - Number(b.currentHealth <= 0));
  return pokemon;
}

/**
 * Ator do jogador com o time atual (vivos primeiro, como `toBattleTeam().sortedBy { health <= 0 }`).
 * @param leadUUID Pokémon que abre a batalha (ex.: o que o jogador tem em campo).
 * @param teamOptions cloneParties/setLevel/healFirst (NPCs com `start_battle`).
 */
export function createPlayerActor(player: Player, format: BattleFormat, leadUUID?: string, teamOptions: BattleTeamOptions = {}): BattleActor | BattleStartError {
  if (inBattle(player))
    return new BattleStartError({ translate: "cobblemon.battle.error.in_battle.personal" });
  const cloned = usesClones(teamOptions);
  // healFirst sem clone cura o time real antes de conferir quem pode lutar.
  if (teamOptions.heal && !cloned) {
    healPlayerTeam(player);
    getSafeTeam(player).forEach(pokemon => { try { pokemon?.tryUpdatePokemonOut(); } catch { } });
  }
  let team = cloned ? getSafeTeam(player) : hasValidTeam(player);
  if (!team || !team.some(x => x != null))
    return new BattleStartError({ translate: "cobblemon.battle.error.no_pokemon" });
  let pokemon = buildBattleTeam(team, leadUUID, cloned ? teamOptions : {});
  if (!pokemon.some(x => x.currentHealth > 0))
    return new BattleStartError({ translate: "cobblemon.battle.error.no_pokemon" });
  let usable = pokemon.filter(x => x.currentHealth > 0).length;
  let required = format.battleType.slotsPerActor;
  if (usable < required)
    return new BattleStartError(message.With("cobblemon.battle.error.insufficient_pokemon.personal", [usable.toString(), required.toString()]));
  return new BattleActor(player, pokemon);
}

/** Pokémon do jogador que está em campo (vira o primeiro da batalha, como o "throw" do Cobblemon). */
function sentOutPokemon(player: Player): string | undefined {
  let team = hasValidTeam(player);
  if (!team)
    return undefined;
  for (let pokemon of team) {
    if (!pokemon || pokemon.currentHealth <= 0)
      continue;
    // Envio/recolha animada em andamento: a entidade vai aparecer ou sumir, não serve como o que está em campo.
    if (isSendOutAnimating(pokemon.uuid))
      continue;
    try {
      let entity = pokemon.tryGetPokemonOut();
      if (entity && entity.dimension.id == player.dimension.id)
        return pokemon.uuid;
    }
    catch { }
  }
  return undefined;
}

/**
 * Lead do jogador num desafio PvP 1×1 (Cobblemon: `party()[selectedPokemonId]` do BattleChallengePacket /
 * BattleChallengeResponsePacket, guardado por ChallengeManager.setLead). Como na batalha selvagem do port, quem está em
 * campo vai na frente (o envio rápido já solta o selecionado antes); sem ninguém em campo, o Pokémon selecionado no
 * HUD do time (vivo). undefined = ordem do time.
 */
export function playerBattleLead(player: Player): string | undefined {
  const out = sentOutPokemon(player);
  if (out) return out;
  try {
    const selected = getSelectedPokemon(player);
    if (selected && selected.currentHealth > 0) return selected.uuid;
  }
  catch { }
  return undefined;
}

export interface StartBattleOptions extends BattleOptions {
  /** Mensagem de erro para os jogadores envolvidos (padrão: true). */
  notify?: boolean;
}

/**
 * Inicia uma batalha genérica (BattleRegistry.startBattle). Cada lado é uma lista de atores; o número de
 * atores por lado tem de bater com o formato (1 em singles/doubles/triples, 2 em multi).
 */
export function startBattle(format: BattleFormat, side1: BattleActor[], side2: BattleActor[], options: StartBattleOptions = {}): PokemonBattle | BattleStartError {
  let expected = format.battleType.actorsPerSide;
  if (side1.length != expected || side2.length != expected)
    return new BattleStartError(message.With("cobblemon.battle.error.incorrect_actor_count", [(side1.length + side2.length).toString(), (expected * 2).toString()]));
  for (let actor of [...side1, ...side2]) {
    if (inBattle(actor.actor))
      return new BattleStartError(message.With("cobblemon.battle.error.in_battle", [actor.getName()]));
    let usable = actor.pokemon.filter(x => x.currentHealth > 0).length;
    if (usable == 0)
      return new BattleStartError(message.With("cobblemon.challenge.error.insufficient_pokemon.other", [actor.getName()]));
    // O Showdown não aceita posições ativas vazias no início (BattleBuilder: insufficientPokemon).
    if (usable < format.battleType.slotsPerActor)
      return new BattleStartError(message.With("cobblemon.battle.error.insufficient_pokemon", [actor.getName(), usable.toString(), format.battleType.slotsPerActor.toString()]));
  }
  // Frente msd-fase2: BATTLE_STARTED_PRE (ouvinte com erro não impede a batalha).
  try { CobblemonEvents.emit("BATTLE_STARTED_PRE", [...side1, ...side2]); }
  catch (e) { console.warn(`BATTLE_STARTED_PRE: ${e}`); }
  const battle = new PokemonBattle(format, new BattleSide(side1), new BattleSide(side2), options);
  // Frente dados-ui: BATTLE_STARTED_POST (estatística battles_total).
  CobblemonEvents.emit("BATTLE_STARTED", battle);
  return battle;
}

function report(result: PokemonBattle | BattleStartError, players: Player[], notify = true): PokemonBattle | undefined {
  if (result instanceof PokemonBattle)
    return result;
  if (notify)
    players.forEach(player => {
      // Jogador que saiu no meio (ex.: telas do desafio): sendMessage lançaria em entidade inválida.
      try { if (player.isValid) player.sendMessage(message.error(result.text)); } catch { }
    });
  return undefined;
}

/**
 * Batalha contra Pokémon selvagem (BattleBuilder.pve). Aceita um ou mais selvagens: com dois, use
 * `BattleFormat.GEN_9_DOUBLES` (os dois ficam no mesmo ator, como o MultiPokemonBattleActor).
 * Respeita `battleWildMaxDistance` (12) e o Alfa ganha a regra "Wild Alpha".
 */
export function startWildBattle(player: Player, wild: Entity | Entity[], options: StartBattleOptions & { format?: BattleFormat; lead?: string } = {}): PokemonBattle | undefined {
  let wildEntities = Array.isArray(wild) ? wild : [wild];
  let format = options.format ?? (wildEntities.length > 1 ? BattleFormat.GEN_9_DOUBLES : BattleFormat.GEN_9_SINGLES);
  let maxDistance = configNumber("battleWildMaxDistance", 12);
  for (let entity of wildEntities) {
    if (!entity.isValid || entity.dimension.id != player.dimension.id || EntityUtils.DistanceBetween(player.location, entity.location) > maxDistance) {
      if (options.notify !== false)
        player.sendMessage(message.error({ translate: "cobblemon.ui.interact.too_far" }));
      return undefined;
    }
    if (inBattle(entity)) {
      if (options.notify !== false)
        player.sendMessage(message.error(message.With("cobblemon.battle.error.in_battle", [PokemonData.tryGetFromEntity(entity)?.getTranslatedName() ?? { translate: "cobblemon.ui.pokemon" }])));
      return undefined;
    }
  }
  // BattleChallengePacket.selectedPokemonId: o selecionado vai na frente mesmo sem estar em campo (a batalha o envia).
  let playerActor = createPlayerActor(player, format, options.lead ?? sentOutPokemon(player));
  if (playerActor instanceof BattleStartError)
    return report(playerActor, [player], options.notify);
  let wildData = wildEntities.map(entity => PokemonData.getFromEntity(entity));
  if (wildData.some(x => x.aspects.includes("alpha")))
    format = format.withRule(BattleRules.WILD_ALPHA);
  let wildActor = new BattleActor(wildEntities[0], wildData, { type: ActorType.WILD });
  return report(startBattle(format, [playerActor], [wildActor], options), [player], options.notify);
}

/**
 * Opções de PvP: `team` = BattleFormat.adjustLevel dos desafios (frente multi): com `setLevel` > 0 os times
 * viram cópias no nível dado e curadas (BattleBuilder.pvp1v1/pvp2v2).
 */
export interface PvPBattleOptions extends StartBattleOptions {
  team?: BattleTeamOptions;
  /** Lead de cada jogador, na ordem dos jogadores (pvp1v1 leadingPokemonPlayer1/2); undefined = ordem do time. */
  leads?: readonly (string | undefined)[];
}

/** Atores dos jogadores (com o ajuste de nível do desafio) ou o primeiro erro. */
function createPvPActors(players: Player[], format: BattleFormat, options: PvPBattleOptions): BattleActor[] | BattleStartError {
  let teamOptions = options.team ?? {};
  let actors: BattleActor[] = [];
  for (let [index, player] of players.entries()) {
    // Com cópias (nível fixo) o lead é mapeado para a cópia em buildBattleTeam; a ordem do resto do time se mantém.
    let actor = createPlayerActor(player, format, options.leads?.[index], teamOptions);
    if (actor instanceof BattleStartError)
      return actor;
    actors.push(actor);
  }
  // Com cópias de nível ajustado, os Pokémon "reais" em campo voltam antes do envio (como no NPC).
  if (teamOptions.setLevel !== undefined && teamOptions.setLevel > 0)
    players.forEach(recallRealPokemon);
  return actors;
}

/** PvP 1x1 no formato pedido (singles, doubles ou triples). */
export function startPvPBattle(player1: Player, player2: Player, format = BattleFormat.GEN_9_SINGLES, options: PvPBattleOptions = {}): PokemonBattle | undefined {
  let { team: _team, leads: _leads, ...battleOptions } = options;
  let actors = createPvPActors([player1, player2], format, options);
  if (actors instanceof BattleStartError)
    return report(actors, [player1, player2], options.notify);
  return report(startBattle(format, [actors[0]], [actors[1]], battleOptions), [player1, player2], options.notify);
}

export function startBattleBetween2Players(player1: Player, player2: Player): PokemonBattle | undefined {
  return startPvPBattle(player1, player2, BattleFormat.GEN_9_SINGLES);
}

export function startDoubleBattle(player1: Player, player2: Player, options: StartBattleOptions = {}) {
  return startPvPBattle(player1, player2, BattleFormat.GEN_9_DOUBLES, options);
}

export function startTripleBattle(player1: Player, player2: Player, options: StartBattleOptions = {}) {
  return startPvPBattle(player1, player2, BattleFormat.GEN_9_TRIPLES, options);
}

/** Multi (2 contra 2, um Pokémon ativo por jogador): p1+p3 contra p2+p4. */
export function startMultiBattle(team1: [Player, Player], team2: [Player, Player], options: PvPBattleOptions = {}): PokemonBattle | undefined {
  let format = BattleFormat.GEN_9_MULTI;
  let players = [...team1, ...team2];
  let { team: _team, leads: _leads, ...battleOptions } = options;
  let actors = createPvPActors(players, format, options);
  if (actors instanceof BattleStartError)
    return report(actors, players, options.notify);
  return report(startBattle(format, [actors[0], actors[1]], [actors[2], actors[3]], battleOptions), players, options.notify);
}

export interface NPCBattleOptions extends StartBattleOptions {
  format?: BattleFormat;
  /** Habilidade da IA (StrongBattleAI, 0 a 5; padrão 5). */
  skill?: number;
  ai?: BattleAI;
  name?: RawMessage;
  /** q.npc.start_battle: cloneParties / setLevel (adjustLevel, também no time do NPC) / healFirst. */
  team?: BattleTeamOptions;
}

/**
 * Treinador NPC (NPCBattleActor + StrongBattleAI): `npc` é a entidade do treinador e `team` o time dele
 * (PokemonData sem dono; as entidades são criadas ao entrar em campo).
 */
export function startNPCBattle(player: Player, npc: Entity, team: PokemonData[], options: NPCBattleOptions = {}): PokemonBattle | undefined {
  let format = options.format ?? BattleFormat.GEN_9_SINGLES;
  let teamOptions = options.team ?? {};
  let playerActor = createPlayerActor(player, format, undefined, teamOptions);
  if (playerActor instanceof BattleStartError)
    return report(playerActor, [player], options.notify);
  // BattleBuilder.pvn com adjustLevel: o time do NPC também fica no nível e curado.
  let setLevel = teamOptions.setLevel;
  if (setLevel !== undefined && setLevel > 0) {
    team.forEach(pokemon => {
      pokemon.setLevel(setLevel!);
      healPokemon(pokemon);
    });
    // SwitchInstruction: com times clonados por nível, os Pokémon "reais" em campo voltam antes do envio.
    recallRealPokemon(player);
  }
  let actorOptions: BattleActorOptions = { type: ActorType.NPC, ai: options.ai ?? new StrongBattleAI(options.skill ?? 5), name: options.name };
  let npcActor = new BattleActor(npc, team, actorOptions);
  return report(startBattle(format, [playerActor], [npcActor], options), [player], options.notify);
}

/** Recolhe os Pokémon do time que estão em campo (antes de mandar os clones de nível ajustado). */
function recallRealPokemon(player: Player) {
  for (const pokemon of getSafeTeam(player)) {
    if (!pokemon) continue;
    try {
      if (pokemon.tryGetPokemonOut()) pokemon.return(player);
    }
    catch { }
  }
}

/**
 * Assistir a batalha de `target` (jogador ou Pokémon em batalha): regras do SpectateBattleHandler, histórico no chat
 * e a tela de espectador. `force` = comando (sem config nem distância). @returns true se passou a assistir.
 */
export function startSpectating(spectator: Player, target: Entity, force = false): boolean {
  const battle = tryGetBattleFromEntity(target);
  const result = spectateBattleOf(spectator, target, battle, inBattle(spectator), force);
  if (typeof result === "string") {
    spectator.sendMessage(spectateErrorMessage(result));
    return false;
  }
  void openSpectatorView(spectator, result);
  return true;
}
