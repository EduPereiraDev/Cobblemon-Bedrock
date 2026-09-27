/**
 * Comandos de chat (/cobblemon:...), port de `CobblemonCommands.kt` + `command/*.kt`.
 * Funcionam em qualquer plataforma, inclusive console. Mapeamento completo em docs/COMANDOS.md.
 *
 * Callbacks de comando rodam em modo restrito (sem escrita no mundo): validamos o que dá na hora e
 * o trabalho de verdade vai para o próximo tick com system.run.
 */
import {
  CommandPermissionLevel, CustomCommand, CustomCommandOrigin, CustomCommandParamType, CustomCommandResult, CustomCommandStatus,
  Entity, ItemStack, Player, RawMessage, StartupEvent, Vector3, system, world,
} from "@minecraft/server";
import {
  openPCGui, openPartyMenu, setPartyHud, isPartyHudOn, showConfigEditor, showPokemonEditForm, showSummary,
} from "./GUI";
import { setPartyHudStyle } from "./GUI/PartyHud";
import { openAchievements } from "./ui";
import { PokemonData } from "./Pokemon";
import { PokemonProperties } from "./PokemonProperties";
import { Dex, toID } from "./showdown";
import { getAllSpeciesIds, getSpeciesData } from "./speciesData";
import {
  PARTY_SIZE, PCLocation, PCPlace, StorageResult, clearPC, clearParty, countParty, depositToPC, findFirstEmptyBoxSlot,
  getBoxCount, getPokemonFromPCLocation, getSafeBoxTeam, getSafeTeam, healPlayerTeam, movePokemon, renameBox, setBoxCount,
  spacesPerBox, storePokemonInFirstSpace, setPokemonToPCLocation, MAX_BOXES,
} from "./pokemonStorage";
import { giveStarter, offerStarter, resetStarter } from "./starter";
import {
  CONFIG_FIELDS, ConfigKey, DEFAULT_CONFIG, GAME_RULE_KEYS, coerceConfigValue, getConfig, getGameRule, loadConfig, resetConfig,
  resolveGameRule, setConfigValue, setGameRule,
} from "./Config";
import { getSelectedSlot, quickSend, setSelectedSlot, showSelection } from "./pokemon/PartySelection";
import { message } from "./language";
import { isPlayerInAnyBattle, startSpectating, stopBattle, tryGetBattleFromEntity } from "./battle";
import { giveAllMarks, resolveMarkId } from "./pokemon/Marks";
import { createTechnicalMachine } from "./items/tm";
import { getSpawnProbabilities, positionsAround, spawnFromPool } from "./spawning/Spawner";
import { npcDeleteCommand, npcEditCommand, openDialogueCommand, spawnNPCCommand, tradeCommand } from "./npc";
import { BEST_SPAWNER_CONFIG } from "../generated/scripts/spawns";
import { challengePlayer } from "./ChallengePlayer";
import { parseLevelRule } from "./battle/TeamManager";
import { abandonMultiTeam, teamManager } from "./battle/Teams";
import { applyPropertiesToPokemon, createPokemonFromProperties } from "./GUI/PokemonEdit";
import { K, getLivePokemon, recallIfOut, savePokemon, tr } from "./GUI/common";
import { setHeldItem } from "./GUI/Party";
import { getStarterCategories } from "./GUI/StarterGUI";
import { searchPC } from "./GUI/PC";
import { TECHNICAL_MACHINES } from "./machines/data";
import { learnTMs, learnableTMsFromPokemon, unlearnTMs } from "./machines/tm";
import { getStats } from "./events/PlayerStats";
import { openStatsScreen, statsBody } from "./ui/StatsScreen";
import { spawnRuleCommand } from "./spawning/SpawnRules";
import { RIDING_STATS, RidingStat, getMaxRideBoost, isRidingStat, setRideBoost } from "./pokemon/RideStats";
import { registerBattleUiCommand } from "./battle/BattleUiMode";

// ---------------------------------------------------------------------------------------------
// Ajudantes puros (testados em tests/interface.test.ts)

/** Espaço do time digitado pelo jogador (1..6) → índice 0-based, ou undefined se inválido. */
export function parseSlotArg(value: unknown, size = PARTY_SIZE): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > size) return undefined;
  return value - 1;
}

/** Caixa digitada (1..N) → índice 0-based, ou undefined se inválida. */
export function parseBoxArg(value: unknown, boxCount: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > boxCount) return undefined;
  return value - 1;
}

/** Faixa da Pokédex Nacional para giveall/spawnall. Inverte se vier trocada; limita a 1..maxDex. */
export function parseDexRange(min: number | undefined, max: number | undefined, maxDex: number): [number, number] {
  let low = Math.max(1, Math.floor(min ?? 1));
  let high = Math.min(maxDex, Math.floor(max ?? maxDex));
  if (low > high) [low, high] = [Math.max(1, high), Math.min(maxDex, low)];
  return [low, high];
}

/** Acha a chave da config ignorando maiúsculas e "_" (shiny_rate, shinyRate, SHINYRATE). */
export function findConfigKey(name: string): ConfigKey | undefined {
  const wanted = name.toLowerCase().replace(/_/g, "");
  const fromField = CONFIG_FIELDS.find(field => field.lang.replace(/_/g, "") === wanted);
  if (fromField) return fromField.key;
  return (Object.keys(DEFAULT_CONFIG) as ConfigKey[]).find(key => key.toLowerCase() === wanted);
}

/** Valida `chave valor` para `/cobblemon:cobblemonconfig set`. */
export function parseConfigAssignment(name: string, value: string): { key: ConfigKey; value: unknown } | { error: string } {
  const key = findConfigKey(name);
  if (!key) return { error: `Unknown config field: ${name}` };
  const coerced = coerceConfigValue(key, value);
  if (coerced === undefined) return { error: `Invalid value for ${key}: ${value}` };
  return { key, value: coerced };
}

/** Formato do desafio (`/pokebattle <jogador> [formato]`): singles (padrão), doubles, triples ou multi (equipes). */
export function parseChallengeFormat(value: string | undefined): "singles" | "doubles" | "triples" | "multi" | undefined {
  const name = (value ?? "singles").trim().toLowerCase();
  if (name === "" || name === "singles" || name === "single") return "singles";
  if (name === "doubles" || name === "double") return "doubles";
  if (name === "triples" || name === "triple") return "triples";
  if (name === "multi" || name === "multis") return "multi";
  return undefined;
}

/** Itens do kit de teste (`/cobblemon:givestarterkit`). */
export const STARTER_KIT: [string, number][] = [
  ["cobblemon:poke_ball", 16], ["cobblemon:great_ball", 8], ["cobblemon:ultra_ball", 4],
  ["cobblemon:potion", 8], ["cobblemon:super_potion", 4], ["cobblemon:full_heal", 4], ["cobblemon:revive", 4],
  ["cobblemon:rare_candy", 5], ["cobblemon:exp_candy_s", 5], ["cobblemon:oran_berry", 8],
  ["cobblemon:exp_share", 1], ["cobblemon:lucky_egg", 1], ["cobblemon:pc", 1], ["cobblemon:healing_machine", 1],
];

/** Limite de entidades por `/cobblemon:spawnallpokemon` (evita travar o servidor). */
export const SPAWN_ALL_LIMIT = 100;

// ---------------------------------------------------------------------------------------------
// Infraestrutura

type Reply = (msg: RawMessage) => void;

function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.initiator ?? origin.sourceEntity;
  return entity instanceof Player ? entity : undefined;
}

function replyFor(origin: CustomCommandOrigin): Reply {
  const player = playerOf(origin);
  return msg => {
    if (player?.isValid) player.sendMessage(msg);
    else console.info(`[cobblemon] ${JSON.stringify(msg)}`);
  };
}

const ok = (): CustomCommandResult => ({ status: CustomCommandStatus.Success });
const fail = (text: string): CustomCommandResult => ({ status: CustomCommandStatus.Failure, message: text });
const ONLY_PLAYERS = "Only players can use this command. / Só jogadores podem usar este comando.";

/**
 * LocationInUnloadedChunkError pelo nome: o mock de testes não exporta a classe, então não dá para usar
 * `instanceof`.
 */
function isUnloadedChunkError(e: unknown): boolean {
  const name = (e as { name?: string } | undefined)?.name ?? (e as object | undefined)?.constructor?.name ?? "";
  const text = `${name} ${String(e)}`;
  return text.includes("LocationInUnloadedChunkError");
}

/** Roda no próximo tick; o comando pode vir do console (sem jogador). */
function later(origin: CustomCommandOrigin, action: (executor: Player | undefined, reply: Reply) => void | Promise<void>): CustomCommandResult {
  const executor = playerOf(origin);
  const reply = replyFor(origin);
  system.run(() => {
    Promise.resolve()
      .then(() => action(executor, reply))
      .catch(e => reply(message.error({ text: String(e) })));
  });
  return ok();
}

/** Como `later`, mas exige um jogador executando. */
function laterAsPlayer(origin: CustomCommandOrigin, action: (player: Player, reply: Reply) => void | Promise<void>): CustomCommandResult {
  const player = playerOf(origin);
  if (!player) return fail(ONLY_PLAYERS);
  return later(origin, (_, reply) => action(player, reply));
}

/** Alvos: os jogadores do seletor, ou quem executou. */
function targetsOf(executor: Player | undefined, players: Player[] | undefined): Player[] {
  if (players && players.length > 0) return players.filter(p => p.isValid);
  return executor ? [executor] : [];
}

/** Pokémon do time no espaço (dados vivos se estiver fora), ou manda erro. */
function partyPokemon(target: Player, slot: number, reply: Reply): { location: PCLocation; pokemon: PokemonData } | undefined {
  const location: PCLocation = { location: PCPlace.Team, space: slot };
  const stored = getPokemonFromPCLocation(target, location);
  if (!stored) {
    reply(message.error(tr("cobblemon.command.general.invalid-party-slot", slot + 1)));
    return undefined;
  }
  return { location, pokemon: getLivePokemon(stored) };
}

const P = CustomCommandParamType;
const ANY = CommandPermissionLevel.Any;
const ADMIN = CommandPermissionLevel.GameDirectors;

/** Registra sem deixar um erro derrubar os outros comandos. */
function register(event: StartupEvent, command: CustomCommand, callback: (origin: CustomCommandOrigin, ...args: any[]) => CustomCommandResult | undefined) {
  try { event.customCommandRegistry.registerCommand(command, callback); }
  catch (e) { console.warn(`Não foi possível registrar ${command.name}: ${e}`); }
}

const ENUM_BOXCOUNT = "cobblemon:boxcountaction";
const ENUM_HUD_STYLE = "cobblemon:hudstyle";
const ENUM_CONFIG = "cobblemon:configaction";

// ---------------------------------------------------------------------------------------------
// Registro

export function registerCommands(event: StartupEvent) {
  try {
    event.customCommandRegistry.registerEnum(ENUM_BOXCOUNT, ["query", "add", "remove", "set"]);
    event.customCommandRegistry.registerEnum(ENUM_CONFIG, ["edit", "get", "set", "reset", "reload"]);
    event.customCommandRegistry.registerEnum(ENUM_HUD_STYLE, ["overlay", "text"]);
  }
  catch (e) { console.warn(`Não foi possível registrar enums de comando: ${e}`); }

  registerPlayerCommands(event);
  registerGiveAndSpawn(event);
  registerPokemonAdmin(event);
  registerStorageAdmin(event);
  registerServerAdmin(event);
  registerSocialCommands(event);
  registerGameplayCommands(event);
  registerDadosUiCommands(event);
  registerMultiCommands(event);
  // Frente batalha-minimizavel: /cobblemon:battleui [java|hud|classic|default|status] (sem argumento abre o menu).
  registerBattleUiCommand(event);
}

// ---------------------------------------------------------------------------------------------
// Frente multi: /abandonmultiteam (AbandonMultiTeam.kt, alias abandonmultibattleteam)

function registerMultiCommands(event: StartupEvent) {
  for (const name of ["cobblemon:abandonmultiteam", "cobblemon:abandonmultibattleteam"]) register(event, {
    name, description: "Leaves your Multi Battle team / Sai do seu grupo de Batalha Multi.",
    permissionLevel: ANY, cheatsRequired: false,
  }, origin => laterAsPlayer(origin, (player, reply) => {
    if (!abandonMultiTeam(player)) reply(message.error({ translate: "cobblemon.port.multi.not_in_team" }));
  }));
}

// ---------------------------------------------------------------------------------------------
// Frente dados-ui: /technicalmachine, /stats, /spawnrule, /rideboost

const ENUM_TM_ACTION = "cobblemon:tmaction";
const ENUM_TM_SCOPE = "cobblemon:tmscope";
const ENUM_SPAWN_RULE_ACTION = "cobblemon:spawnruleaction";

/** Ids de TM (data/cobblemon/tms = id do golpe no Showdown). */
export function resolveTmId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const id = toID(value.replace(/^cobblemon:/, ""));
  return TECHNICAL_MACHINES[id] ? id : undefined;
}

function registerDadosUiCommands(event: StartupEvent) {
  try {
    event.customCommandRegistry.registerEnum(ENUM_TM_ACTION, ["unlock", "lock", "check"]);
    event.customCommandRegistry.registerEnum(ENUM_TM_SCOPE, ["only", "all"]);
    event.customCommandRegistry.registerEnum(ENUM_SPAWN_RULE_ACTION, ["list", "enable", "disable", "add", "remove"]);
  }
  catch (e) { console.warn(`Não foi possível registrar enums de comando (dados-ui): ${e}`); }

  // TmCommand.kt: /technicalmachine unlock|lock <jogadores> only <TM> | all; /technicalmachine check <jogador>.
  register(event, {
    name: "cobblemon:technicalmachine",
    description: "Unlocks/locks TMs for players or checks their Pokémon / Libera, trava ou confere TMs (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: ENUM_TM_ACTION, type: P.Enum }, { name: "player", type: P.PlayerSelector }],
    optionalParameters: [{ name: ENUM_TM_SCOPE, type: P.Enum }, { name: "tm", type: P.String }],
  }, (origin, action: string, players: Player[] | undefined, scope?: string, tm?: string) => {
    const targets = (players ?? []).filter(p => p.isValid);
    if (!targets.length) return fail("No player / Nenhum jogador");
    if (action !== "check") {
      if (scope !== "only" && scope !== "all") return fail("Use: only <tm> | all");
      if (scope === "only" && !resolveTmId(tm)) return fail("Invalid TM");
    }
    return later(origin, (_executor, reply) => {
      const who = targets.length === 1 ? targets[0].name : `${targets.length} players`;
      if (action === "check") {
        // executeCheck: aprende os TMs de todos os Pokémon do time e do PC do jogador.
        const target = targets[0];
        const moves = new Set<string>();
        const all: (PokemonData | null)[] = [...getSafeTeam(target)];
        for (let box = 0; box < getBoxCount(target); box++) all.push(...getSafeBoxTeam(target, box));
        for (const pokemon of all) if (pokemon) learnableTMsFromPokemon(pokemon).forEach(move => moves.add(move));
        learnTMs(target, moves);
        reply({ text: `Unlocked ${moves.size} TMs for ${target.name}` });
        return;
      }
      const ids = scope === "all" ? Object.keys(TECHNICAL_MACHINES) : [resolveTmId(tm)!];
      for (const target of targets) {
        if (action === "unlock") learnTMs(target, ids);
        else unlearnTMs(target, ids);
      }
      const verb = action === "unlock" ? "Unlocked" : "Locked";
      reply({ text: scope === "all" ? `${verb} ${ids.length} TMs for ${who}` : `${verb} TM cobblemon:${ids[0]} for ${who}` });
    });
  });

  // Estatísticas do Cobblemon (CobblemonStats): o Bedrock não tem a tela de Estatísticas para add-on.
  register(event, {
    name: "cobblemon:stats",
    description: "Shows your Cobblemon statistics / Mostra suas estatísticas do Cobblemon.",
    permissionLevel: ANY,
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players?: Player[]) => {
    const viewer = playerOf(origin);
    const target = players?.find(p => p.isValid);
    if (!viewer) {
      if (!target) return fail(ONLY_PLAYERS);
      return later(origin, (_e, reply) => reply(statsBody(getStats(target))));
    }
    // Ver as de outro jogador: só operador.
    if (target && target.id !== viewer.id && viewer.commandPermissionLevel < CommandPermissionLevel.GameDirectors)
      return fail("You can only see your own statistics / Só as suas estatísticas");
    return later(origin, () => openStatsScreen(viewer, target ?? viewer));
  });

  // Spawn rules (CobblemonSpawnRules, só datapack no Java): listar, ligar/desligar, adicionar JSON e remover.
  register(event, {
    name: "cobblemon:spawnrule",
    description: "Manages Cobblemon spawn rules (datapack spawn_rules) / Gerencia as spawn rules (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: ENUM_SPAWN_RULE_ACTION, type: P.Enum }],
    optionalParameters: [{ name: "id", type: P.String }, { name: "json", type: P.String }],
  }, (origin, action: string, id?: string, json?: string) => later(origin, (_e, reply) => {
    reply(spawnRuleCommand(action, id, json));
  }));

  // Ride boosts (Pokemon.setRideBoost) para testes/admin: /rideboost <espaço> <atributo|all> <valor|max>.
  register(event, {
    name: "cobblemon:rideboost",
    description: "Sets ride boosts of a party Pokémon / Define os ride boosts de um Pokémon do time (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }, { name: "stat", type: P.String }, { name: "value", type: P.String }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, stat: string, value: string, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail("Slot 1-6");
    const name = stat.toUpperCase();
    if (name !== "ALL" && !isRidingStat(name)) return fail("Stat: acceleration, skill, speed, stamina, jump, all");
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        const stats = name === "ALL" ? RIDING_STATS : [name as RidingStat];
        for (const s of stats) {
          const max = getMaxRideBoost(found.pokemon, s);
          const amount = value.toLowerCase() === "max" ? max : Number(value);
          if (Number.isFinite(amount)) setRideBoost(found.pokemon, s, amount);
        }
        savePokemon(target, found.location, found.pokemon);
        reply({ text: `${target.name}: ${JSON.stringify(found.pokemon.rideBoosts ?? {})}` });
      }
    });
  });
}

const ENUM_GAMERULE = "cobblemon:gamerule";

/**
 * Frente jogabilidade: gamerules do Cobblemon (o Bedrock não deixa add-on registrar gamerule;
 * `/cobblemon:cobblemongamerule` funciona como `/gamerule`; o nome curto `gamerule` é do vanilla), envio rápido e seleção do Pokémon (tecla R e setas do overlay do Cobblemon).
 */
function registerGameplayCommands(event: StartupEvent) {
  try { event.customCommandRegistry.registerEnum(ENUM_GAMERULE, [...GAME_RULE_KEYS]); }
  catch (e) { console.warn(`Não foi possível registrar o enum de gamerule: ${e}`); }
  register(event, {
    name: "cobblemon:cobblemongamerule",
    description: "Queries or sets a Cobblemon gamerule / Consulta ou muda uma gamerule do Cobblemon.",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: ENUM_GAMERULE, type: P.Enum }],
    optionalParameters: [{ name: "value", type: P.Boolean }],
  }, (origin, rule: string, value?: boolean) => {
    const key = resolveGameRule(String(rule ?? ""));
    if (!key) return fail(`Unknown gamerule: ${rule}`);
    return later(origin, (_, reply) => {
      if (value === undefined) { reply({ text: `Gamerule ${key} = ${getGameRule(key)}` }); return; }
      setGameRule(key, value);
      reply({ text: `Gamerule ${key} is now set to: ${value}` });
    });
  });
  register(event, {
    name: "cobblemon:sendout",
    description: "Sends out/recalls the selected party Pokémon or battles what you aim at (Cobblemon R key) / Envia o Pokémon selecionado (tecla R).",
    permissionLevel: ANY, cheatsRequired: false,
    optionalParameters: [{ name: "slot", type: P.Integer }],
  }, (origin, slot?: number) => {
    const index = slot === undefined ? undefined : parseSlotArg(slot);
    if (slot !== undefined && index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return laterAsPlayer(origin, player => {
      if (index !== undefined) setSelectedSlot(player, index);
      quickSend(player, index ?? getSelectedSlot(player));
    });
  });
  register(event, {
    name: "cobblemon:selectslot",
    description: "Selects a party slot for quick send-out (1-6) / Seleciona o Pokémon do time para o envio rápido.",
    permissionLevel: ANY, cheatsRequired: false,
    mandatoryParameters: [{ name: "slot", type: P.Integer }],
  }, (origin, slot: number) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return laterAsPlayer(origin, player => {
      setSelectedSlot(player, index);
      showSelection(player);
    });
  });
}

/** NPCs, diálogos e troca (frente social; SpawnNPC.kt, NPCEditCommand, OpenDialogueCommand, trade). */
function registerSocialCommands(event: StartupEvent) {
  const spawnAt = (origin: CustomCommandOrigin, cls: string, level?: number, skin?: number, position?: Vector3) =>
    later(origin, (executor, reply) => {
      const source = executor ?? origin.sourceEntity;
      const where = position ?? source?.location;
      if (!source || !where) { reply(message.error({ text: ONLY_PLAYERS })); return; }
      const out = spawnNPCCommand(source.dimension, where, cls, level ?? 1, skin);
      reply(out.ok ? out.message : message.error(out.message));
    });
  for (const name of ["cobblemon:spawnnpc", "cobblemon:npcspawn"]) register(event, {
    name, description: "Spawns an NPC (class or preset) / Cria um NPC (classe ou preset).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "class", type: P.String }],
    optionalParameters: [{ name: "level", type: P.Integer }, { name: "skin", type: P.Integer }],
  }, (origin, cls: string, level?: number, skin?: number) => spawnAt(origin, cls, level, skin));
  for (const name of ["cobblemon:spawnnpcat", "cobblemon:npcspawnat"]) register(event, {
    name, description: "Spawns an NPC at a position / Cria um NPC numa posição.",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "position", type: P.Location }, { name: "class", type: P.String }],
    optionalParameters: [{ name: "level", type: P.Integer }],
  }, (origin, position: Vector3, cls: string, level?: number) => spawnAt(origin, cls, level, undefined, position));
  // NPCDeleteCommand: `/npcdelete <alvo>` funciona pelo console; sem alvo, o NPC para onde o jogador olha.
  register(event, {
    name: "cobblemon:npcdelete", description: "Deletes the target NPC or the one you are looking at / Apaga o NPC indicado ou para onde você olha.",
    permissionLevel: ADMIN, cheatsRequired: true,
    optionalParameters: [{ name: "target", type: P.EntitySelector }],
  }, (origin, targets?: Entity[]) => {
    if (targets === undefined) return laterAsPlayer(origin, (player, reply) => {
      const out = npcDeleteCommand(player);
      reply(out.ok ? out.message : message.error(out.message));
    });
    return later(origin, (executor, reply) => {
      const valid = (targets ?? []).filter(entity => entity.isValid);
      if (valid.length === 0) { reply(message.error({ translate: "cobblemon.command.npcedit.non_npc" })); return; }
      for (const entity of valid) {
        const out = npcDeleteCommand(executor as Player, entity);
        reply(out.ok ? out.message : message.error(out.message));
      }
    });
  });
  register(event, {
    name: "cobblemon:npcedit", description: "Edits the NPC you are looking at / Edita o NPC para onde você olha.",
    permissionLevel: ADMIN, cheatsRequired: true,
  }, origin => laterAsPlayer(origin, (player, reply) => {
    const out = npcEditCommand(player);
    if (!out.ok) reply(message.error(out.message));
  }));
  register(event, {
    name: "cobblemon:opendialogue", description: "Opens a dialogue for a player / Abre um diálogo para um jogador.",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "dialogue", type: P.String }, { name: "player", type: P.PlayerSelector }],
  }, (origin, dialogue: string, players: Player[]) => later(origin, (_, reply) => {
    for (const player of players ?? []) {
      const out = openDialogueCommand(dialogue, player);
      if (!out.ok) reply(message.error(out.message));
    }
  }));
  register(event, {
    name: "cobblemon:trade", description: "Requests (or accepts) a trade with a player / Pede (ou aceita) troca com um jogador.",
    permissionLevel: ANY, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players: Player[]) => laterAsPlayer(origin, (player, reply) => {
    const out = tradeCommand(player, players?.find(p => p.isValid && p.id !== player.id));
    if (!out.ok) reply(message.error(out.message));
  }));
}

/** Comandos de jogador (sem cheats). */
function registerPlayerCommands(event: StartupEvent) {
  register(event, {
    name: "cobblemon:party",
    description: "Opens your party menu / Abre o menu do seu time.",
    permissionLevel: ANY, cheatsRequired: false,
  }, origin => laterAsPlayer(origin, player => openPartyMenu(player)));

  register(event, {
    name: "cobblemon:pc",
    description: "Opens your Pokémon PC / Abre o PC de Pokémon.",
    permissionLevel: ANY, cheatsRequired: false,
    optionalParameters: [{ name: "box", type: P.Integer }],
  }, (origin, box?: number) => laterAsPlayer(origin, (player, reply) => {
    const count = getBoxCount(player);
    const index = box === undefined ? 0 : parseBoxArg(box, count);
    if (index === undefined) { reply(message.error(tr("cobblemon.command.pc.invalid-box", box!, count))); return; }
    return openPCGui(player, index);
  }));

  register(event, {
    name: "cobblemon:starter",
    description: "Choose your starter Pokémon / Escolhe o seu Pokémon inicial.",
    permissionLevel: ANY, cheatsRequired: false,
  }, origin => laterAsPlayer(origin, player => offerStarter(player)));

  register(event, {
    name: "cobblemon:summary",
    description: "Shows the summary of a party Pokémon / Mostra o resumo de um Pokémon do time.",
    permissionLevel: ANY, cheatsRequired: false,
    optionalParameters: [{ name: "slot", type: P.Integer }],
  }, (origin, slot?: number) => laterAsPlayer(origin, (player, reply) => {
    const index = slot === undefined ? getSafeTeam(player).findIndex(x => x != null) : parseSlotArg(slot);
    if (index === undefined || index < 0) { reply(message.error(tr("cobblemon.command.general.invalid-party-slot", slot ?? 1))); return; }
    const found = partyPokemon(player, index, reply);
    if (found) return showSummary(player, found.pokemon);
  }));

  register(event, {
    name: "cobblemon:partyhud",
    description: "Shows/hides your party HUD (style: overlay | text) / Mostra/esconde o HUD do time (estilo: overlay | text).",
    permissionLevel: ANY, cheatsRequired: false,
    optionalParameters: [{ name: "enabled", type: P.Boolean }, { name: ENUM_HUD_STYLE, type: P.Enum }],
  }, (origin, enabled?: boolean, style?: string) => laterAsPlayer(origin, (player, reply) => {
    if (!getConfig().partyHudEnabled) { reply(message.error(tr(K.hudDisabled))); return; }
    // Pedido da ui-base: estilo "overlay" (party do Cobblemon à esquerda) ou "text" (actionbar antiga).
    if (style === "overlay" || style === "text") setPartyHudStyle(player, style);
    const on = enabled ?? (style ? true : !isPartyHudOn(player));
    setPartyHud(player, on);
    reply(tr(on ? K.hudOn : K.hudOff));
  }));

  register(event, {
    name: "cobblemon:advancements",
    description: "Opens the Cobblemon advancements / Abre as conquistas do Cobblemon.",
    permissionLevel: ANY, cheatsRequired: false,
  }, origin => laterAsPlayer(origin, player => openAchievements(player)));

  register(event, {
    name: "cobblemon:renamebox",
    description: "Renames one of your PC boxes (empty = default) / Renomeia uma caixa do PC.",
    permissionLevel: ANY, cheatsRequired: false,
    mandatoryParameters: [{ name: "box", type: P.Integer }],
    optionalParameters: [{ name: "name", type: P.String }],
  }, (origin, box: number, name?: string) => laterAsPlayer(origin, (player, reply) => {
    const index = parseBoxArg(box, getBoxCount(player));
    if (index === undefined || !renameBox(player, index, name)) {
      reply(message.error(tr("cobblemon.command.pokebox.box_does_not_exist", box)));
      return;
    }
    reply(message.color("Green", tr(K.pcRename)));
  }));

  register(event, {
    name: "cobblemon:pokebattle",
    description: "Challenges (or accepts a challenge from) a player / Desafia um jogador para batalha.",
    permissionLevel: ANY, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }],
    // Frente multi: `level` = regra de nível do desafio (BattleFormat.adjustLevel): 5, 50 ou 100; 0/-1 = livre.
    optionalParameters: [{ name: "format", type: P.String }, { name: "level", type: P.Integer }],
  }, (origin, players: Player[], format?: string, level?: number) => {
    const chosen = parseChallengeFormat(format);
    if (!chosen) return fail(`Invalid format: ${format} (singles, doubles, triples, multi)`);
    const rule = parseLevelRule(level);
    if (rule === undefined) return fail(`Invalid level: ${level} (5, 50, 100; 0 = any)`);
    return laterAsPlayer(origin, (player, reply) => {
      const target = players?.find(p => p.isValid && p.id !== player.id);
      if (!target) { reply(message.error({ translate: "cobblemon.ui.interact.unavailable" })); return; }
      if (chosen === "multi") teamManager.challengeTeam(player, target, rule);
      else challengePlayer(player, target, chosen, rule);
    });
  });

  register(event, {
    name: "cobblemon:cobblemon",
    description: "Cobblemon Bedrock information / Informações do Cobblemon Bedrock.",
    permissionLevel: ANY, cheatsRequired: false,
  }, origin => later(origin, (_, reply) => {
    reply({ text: `§6Cobblemon Bedrock§r — port of Cobblemon 1.8.2 · ${getAllSpeciesIds().length} species · /cobblemon:party /cobblemon:pc /cobblemon:starter` });
  }));
}

/** givepokemon/pokegive, spawnpokemon/pokespawn, giveall, spawnall, starter kit. */
function registerGiveAndSpawn(event: StartupEvent) {
  const give = (executor: Player | undefined, reply: Reply, properties: string, targets: Player[], defaults: { level?: number; shiny?: boolean }) => {
    for (const target of targets) {
      const pokemon = createPokemonFromProperties(properties, defaults);
      pokemon.ogTrainer ??= target.name;
      const result = storePokemonInFirstSpace(pokemon, target);
      if (result) target.sendMessage(result);
      reply(tr("cobblemon.command.givepokemon.give", pokemon, target.name));
    }
    if (targets.length === 0 && !executor) reply(message.error({ text: ONLY_PLAYERS }));
  };
  const validateProps = (properties: string): CustomCommandResult | undefined => {
    const props = PokemonProperties.parse(properties);
    const first = properties.trim().split(/\s+/)[0]?.toLowerCase();
    if (!properties.trim()) return fail("Error: You need to include a Pokémon name or 'random'");
    if (props.species === undefined && first !== "random" && !first.includes("="))
      return fail(`Invalid Pokémon name: ${first}`);
    return undefined;
  };

  // Compatível com a versão anterior do port: <espécie|propriedades> [nível] [shiny] [jogador].
  register(event, {
    name: "cobblemon:givepokemon",
    description: "Gives a Pokémon (properties: \"pikachu level=10 shiny\") / Dá um Pokémon (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "properties", type: P.String }],
    optionalParameters: [{ name: "level", type: P.Integer }, { name: "shiny", type: P.Boolean }, { name: "player", type: P.PlayerSelector }],
  }, (origin, properties: string, level?: number, shiny?: boolean, players?: Player[]) =>
    validateProps(properties) ?? later(origin, (executor, reply) => give(executor, reply, properties, targetsOf(executor, players), { level, shiny })));

  register(event, {
    name: "cobblemon:pokegive",
    description: "Gives a Pokémon by properties (alias of givepokemon) / Dá um Pokémon (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "properties", type: P.String }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, properties: string, players?: Player[]) =>
    validateProps(properties) ?? later(origin, (executor, reply) => give(executor, reply, properties, targetsOf(executor, players), {})));

  const spawn = (executor: Player | undefined, reply: Reply, properties: string, location: Vector3 | undefined, defaults: { level?: number; shiny?: boolean }) => {
    const dimension = executor?.dimension ?? world.getDimension("overworld");
    const where = location ?? executor?.location;
    if (!where) { reply(message.error({ text: ONLY_PLAYERS })); return; }
    const data = createPokemonFromProperties(properties, defaults);
    let entity;
    try { entity = dimension.spawnEntity(data.getEntityId(), where); }
    catch (e) {
      // Posição num chunk descarregado (ex.: logo depois de um /tp para longe): mensagem traduzida em vez da exceção crua.
      if (isUnloadedChunkError(e)) { reply(message.error({ translate: "cobblemon.port.command.spawnpokemon.unloaded_chunk" })); return; }
      throw e;
    }
    data.applyToCobblemon(entity);
    entity.setProperty("cobblemon:wild", true);
    entity.triggerEvent("cobblemon:set_wild");
    // PokemonProperties.createEntity → applyCustomProperties: `no_ai` e `freeze_frame` só existem na entidade.
    // Depois dos grupos do set_wild (que redefinem o minecraft:movement).
    const entityProps = PokemonProperties.parse(properties);
    const spawned = entity;
    system.runTimeout(() => { if (spawned.isValid) entityProps.applyToEntity(spawned); }, 2);
  };

  register(event, {
    name: "cobblemon:spawnpokemon",
    description: "Spawns a wild Pokémon (properties) / Faz um Pokémon selvagem aparecer (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "properties", type: P.String }],
    optionalParameters: [{ name: "level", type: P.Integer }, { name: "shiny", type: P.Boolean }, { name: "position", type: P.Location }],
  }, (origin, properties: string, level?: number, shiny?: boolean, position?: Vector3) =>
    validateProps(properties) ?? later(origin, (executor, reply) => spawn(executor, reply, properties, position, { level, shiny })));

  register(event, {
    name: "cobblemon:pokespawn",
    description: "Spawns a wild Pokémon (alias of spawnpokemon) / Faz um Pokémon aparecer (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "properties", type: P.String }],
    optionalParameters: [{ name: "position", type: P.Location }],
  }, (origin, properties: string, position?: Vector3) =>
    validateProps(properties) ?? later(origin, (executor, reply) => spawn(executor, reply, properties, position, {})));

  register(event, {
    name: "cobblemon:giveallpokemon",
    description: "Puts every species in a dex range into your PC (test) / Coloca todas as espécies no PC (teste).",
    permissionLevel: ADMIN, cheatsRequired: true,
    optionalParameters: [{ name: "min", type: P.Integer }, { name: "max", type: P.Integer }],
  }, (origin, min?: number, max?: number) => laterAsPlayer(origin, (player, reply) => {
    const species = speciesInDexRange(min, max);
    // Um Pokémon por tick de job: centenas de espécies sem estourar o watchdog.
    system.runJob((function* () {
      let given = 0;
      let startBox = 0;
      for (const id of species) {
        if (!player.isValid) return;
        // Continua da última caixa usada para não varrer o PC inteiro a cada Pokémon.
        const slot = findFirstEmptyBoxSlot(player, startBox);
        if (!slot) { reply(message.error({ translate: "cobblemon.command.pokebox.storage_is_full" })); break; }
        startBox = slot.boxID ?? 0;
        try {
          const pokemon = PokemonData.generateNewWildPokemon(id, { level: 10 });
          pokemon.ogTrainer = player.name;
          setPokemonToPCLocation(player, slot, pokemon);
          given++;
        }
        catch (e) { console.warn(`giveallpokemon ${id}: ${e}`); }
        yield;
      }
      reply(message.color("Green", tr("cobblemon.port.command.giveall", given)));
    })());
  }));

  register(event, {
    name: "cobblemon:spawnallpokemon",
    description: `Spawns one of each species in a dex range (max ${SPAWN_ALL_LIMIT}) / Spawna uma de cada espécie (teste).`,
    permissionLevel: ADMIN, cheatsRequired: true,
    optionalParameters: [{ name: "min", type: P.Integer }, { name: "max", type: P.Integer }],
  }, (origin, min?: number, max?: number) => laterAsPlayer(origin, (player, reply) => {
    const species = speciesInDexRange(min, max ?? (min !== undefined ? min + SPAWN_ALL_LIMIT - 1 : SPAWN_ALL_LIMIT)).slice(0, SPAWN_ALL_LIMIT);
    const origin3 = player.location;
    system.runJob((function* () {
      let spawned = 0;
      for (const [i, id] of species.entries()) {
        if (!player.isValid) return;
        try {
          const data = PokemonData.generateNewWildPokemon(id, { level: 10 });
          const location = { x: origin3.x + (i % 10) * 3 - 13.5, y: origin3.y, z: origin3.z + Math.floor(i / 10) * 3 + 3 };
          const entity = player.dimension.spawnEntity(data.getEntityId(), location);
          data.applyToCobblemon(entity);
          entity.setProperty("cobblemon:wild", true);
          entity.triggerEvent("cobblemon:set_wild");
          spawned++;
        }
        catch (e) { console.warn(`spawnallpokemon ${id}: ${e}`); }
        yield;
      }
      reply(message.color("Green", tr("cobblemon.port.command.spawnall", spawned)));
    })());
  }));

  register(event, {
    name: "cobblemon:givestarterkit",
    description: "QA: balls, healing items, candies, PC and Healing Machine (+ a starter if you have none).",
    permissionLevel: ADMIN, cheatsRequired: true,
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players?: Player[]) => later(origin, (executor, reply) => {
    for (const target of targetsOf(executor, players)) {
      const container = target.getComponent("minecraft:inventory")?.container;
      for (const [id, amount] of STARTER_KIT) {
        let stack: ItemStack;
        try { stack = new ItemStack(id, amount); }
        catch { continue; } // item não existe nesta versão do pack
        const leftover = container?.addItem(stack);
        if (leftover) target.dimension.spawnItem(leftover, target.location);
      }
      if (countParty(target) === 0) {
        const categories = getStarterCategories();
        const all = categories.flatMap(c => c.pokemon);
        if (all.length > 0) giveStarter(target, all[Math.floor(Math.random() * all.length)]);
      }
      reply(message.color("Green", tr("cobblemon.port.command.starterkit", target.name)));
    }
  }));
}

function speciesInDexRange(min: number | undefined, max: number | undefined): string[] {
  const all = getAllSpeciesIds()
    .map(id => ({ id, data: getSpeciesData(id) }))
    .filter(x => x.data && x.data.implemented !== false);
  const maxDex = all.reduce((m, x) => Math.max(m, x.data!.nationalPokedexNumber), 1);
  const [low, high] = parseDexRange(min, max, maxDex);
  return all
    .filter(x => x.data!.nationalPokedexNumber >= low && x.data!.nationalPokedexNumber <= high)
    .sort((a, b) => a.data!.nationalPokedexNumber - b.data!.nationalPokedexNumber)
    .map(x => x.id);
}

/** Comandos que mexem num Pokémon do time. */
function registerPokemonAdmin(event: StartupEvent) {
  const heal = (executor: Player | undefined, reply: Reply, players?: Player[]) => {
    for (const target of targetsOf(executor, players)) {
      if (tryGetBattleFromEntity(target)) { reply(message.error({ translate: "cobblemon.command.pokeheal.in_battle" })); continue; }
      healPlayerTeam(target);
      getSafeTeam(target).forEach(pokemon => pokemon?.tryUpdatePokemonOut());
      reply(tr("cobblemon.command.healpokemon.heal", target.name));
    }
  };
  for (const name of ["cobblemon:healpokemon", "cobblemon:pokeheal"]) {
    register(event, {
      name,
      description: "Fully heals a party / Cura totalmente o time (admin).",
      permissionLevel: ADMIN, cheatsRequired: true,
      optionalParameters: [{ name: "player", type: P.PlayerSelector }],
    }, (origin, players?: Player[]) => later(origin, (executor, reply) => heal(executor, reply, players)));
  }

  register(event, {
    name: "cobblemon:levelup",
    description: "Raises a party Pokémon by one level / Sobe um nível (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        const { pokemon, location } = found;
        if (pokemon.level >= getConfig().maxPokemonLevel) { reply(message.warn(tr("cobblemon.label.lv", pokemon.level))); continue; }
        pokemon.gainExp(Math.max(1, pokemon.getExperienceToNextLevel()), target);
        savePokemon(target, location, pokemon);
      }
    });
  });

  register(event, {
    name: "cobblemon:teach",
    description: "Teaches a move to a party Pokémon / Ensina um golpe (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }, { name: "move", type: P.String }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }, { name: "bypasslearnset", type: P.Boolean }],
  }, (origin, slot: number, move: string, players?: Player[], bypass?: boolean) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    const moveData = Dex.moves.get(toID(move));
    if (!moveData.exists) return fail(`Invalid move name: ${move}`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        const { pokemon, location } = found;
        const moveName = { translate: `cobblemon.move.${moveData.id}` };
        if (pokemon.moves.includes(moveData.id)) { reply(message.error(tr("cobblemon.command.teach.already_knows", pokemon, moveName))); continue; }
        if (!bypass && !pokemon.canLearnMove(moveData.id)) { reply(message.error(tr("cobblemon.port.command.cant_learn", pokemon, moveName))); continue; }
        if (!pokemon.teachMove(moveData.id)) { reply(message.error(tr("cobblemon.command.teach.already_knows", pokemon, moveName))); continue; }
        savePokemon(target, location, pokemon);
        reply(tr("cobblemon.command.teach", pokemon, target.name, moveName));
      }
    });
  });

  register(event, {
    name: "cobblemon:querylearnset",
    description: "Can this party Pokémon learn a move? / O Pokémon pode aprender o golpe? (admin)",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "slot", type: P.Integer }, { name: "move", type: P.String }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, move: string, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    const moveData = Dex.moves.get(toID(move));
    if (!moveData.exists) return fail(`Invalid move name: ${move}`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        const can = found.pokemon.canLearnMove(moveData.id);
        reply(tr(can ? "cobblemon.port.command.can_learn" : "cobblemon.port.command.cant_learn", found.pokemon, { translate: `cobblemon.move.${moveData.id}` }));
      }
    });
  });

  for (const name of ["cobblemon:pokemonedit", "cobblemon:pokeedit"]) {
    register(event, {
      name,
      description: "Edits a party Pokémon (\"level=50 shiny nature=adamant hp_iv=31\"; no properties = form) (admin).",
      permissionLevel: ADMIN, cheatsRequired: true,
      mandatoryParameters: [{ name: "slot", type: P.Integer }],
      optionalParameters: [{ name: "properties", type: P.String }, { name: "player", type: P.PlayerSelector }],
    }, (origin, slot: number, properties?: string, players?: Player[]) => {
      const index = parseSlotArg(slot);
      if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
      return later(origin, async (executor, reply) => {
        const targets = targetsOf(executor, players);
        for (const target of targets) {
          const found = partyPokemon(target, index, reply);
          if (!found) continue;
          if (!properties || !properties.trim()) {
            // Sem propriedades: formulário para quem executou, editando o Pokémon do alvo.
            if (executor) await showPokemonEditForm(executor, found.location, found.pokemon, target);
            continue;
          }
          const edited = applyPropertiesToPokemon(found.pokemon, PokemonProperties.parse(properties));
          savePokemon(target, found.location, edited);
          reply(tr("cobblemon.command.pokemonedit", edited, target.name));
        }
      });
    });
  }

  register(event, {
    name: "cobblemon:friendship",
    description: "Shows (or sets) a party Pokémon's friendship / Mostra ou define a amizade (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }],
    optionalParameters: [{ name: "value", type: P.Integer }, { name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, value?: number, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        if (value !== undefined) {
          found.pokemon.setFriendship(value);
          savePokemon(target, found.location, found.pokemon);
        }
        reply(tr("cobblemon.command.friendship", found.pokemon, found.pokemon.friendship));
      }
    });
  });

  register(event, {
    name: "cobblemon:helditem",
    description: "Sets the held item of a party Pokémon / Define o item segurado (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }, { name: "item", type: P.ItemType }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, item: { id: string }, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        const id = item.id === "minecraft:air" ? undefined : item.id;
        setHeldItem(found.pokemon, id);
        savePokemon(target, found.location, found.pokemon);
        reply(tr("cobblemon.command.held_item", target.name, found.pokemon, id ?? "-"));
      }
    });
  });

  const markCommand = (name: string, add: boolean) => register(event, {
    name,
    description: add ? "Gives a mark to a party Pokémon (admin)" : "Takes a mark from a party Pokémon (admin)",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }, { name: "mark", type: P.String }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, mark: string, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    // MarkArgumentType: só marcas que existem (data/cobblemon/marks).
    const id = resolveMarkId(mark);
    if (!id) return fail(`Unknown mark: ${mark} / Marca desconhecida: ${mark}`);
    const markName = { translate: `cobblemon.mark.${id.split(":")[1]}` };
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        const changed = add ? found.pokemon.addMark(id) : found.pokemon.removeMark(id);
        if (!changed) {
          reply(message.error(tr(add ? "cobblemon.command.givemark.already_has" : "cobblemon.command.takemark.does_not_have", target.name, found.pokemon, markName)));
          continue;
        }
        savePokemon(target, found.location, found.pokemon);
        reply(add ? tr("cobblemon.command.givemark", target.name, found.pokemon, markName) : tr("cobblemon.command.takemark", markName, target.name, found.pokemon));
      }
    });
  });
  markCommand("cobblemon:givemark", true);
  markCommand("cobblemon:takemark", false);

  // MarkGiveAllCommand: o Pokémon recebe todas as marcas e fitas.
  register(event, {
    name: "cobblemon:giveallmarks",
    description: "Gives every mark to a party Pokémon (admin) / Dá todas as marcas a um Pokémon do time.",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "slot", type: P.Integer }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        giveAllMarks(found.pokemon);
        savePokemon(target, found.location, found.pokemon);
        const given = tr("cobblemon.command.giveallmarks", target.name, found.pokemon);
        reply(given);
        if (executor?.id !== target.id) target.sendMessage(given);
      }
    });
  });

  // SpectateBattleCommand: assistir a batalha de um jogador (sem checar config nem distância, como no Cobblemon).
  register(event, {
    name: "cobblemon:spectatebattle",
    description: "Spectates a player's battle (admin) / Assiste à batalha de um jogador.",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players: Player[]) => laterAsPlayer(origin, (player, reply) => {
    const target = players?.find(p => p.isValid);
    if (!target) { reply(message.error({ translate: "cobblemon.command.spectatebattle.player_not_in_battle" })); return; }
    startSpectating(player, target, true);
  }));
}

/** Time e PC: limpar, mover para o PC, tirar de outro jogador, caixas. */
function registerStorageAdmin(event: StartupEvent) {
  register(event, {
    name: "cobblemon:clearparty",
    description: "Removes every Pokémon from a party / Esvazia o time (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players?: Player[]) => later(origin, (executor, reply) => {
    for (const target of targetsOf(executor, players)) {
      const removed = clearParty(target);
      removed.forEach(recallIfOut);
      reply(tr(removed.length ? "cobblemon.command.clearparty.cleared" : "cobblemon.command.clearparty.nonethere", target.name));
    }
  }));

  register(event, {
    name: "cobblemon:clearpc",
    description: "Removes every Pokémon from a PC / Esvazia o PC (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players?: Player[]) => later(origin, (executor, reply) => {
    for (const target of targetsOf(executor, players)) {
      clearPC(target);
      reply(tr("cobblemon.command.clearpc.cleared", target.name));
    }
  }));

  for (const name of ["cobblemon:pokemonrestart", "cobblemon:pokerestart"]) {
    register(event, {
      name,
      description: "Clears party and PC; optionally lets the player pick a starter again (admin).",
      permissionLevel: ADMIN, cheatsRequired: false,
      optionalParameters: [{ name: "player", type: P.PlayerSelector }, { name: "resetstarter", type: P.Boolean }],
    }, (origin, players?: Player[], resetStarters?: boolean) => later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        clearParty(target).forEach(recallIfOut);
        clearPC(target);
        if (resetStarters) {
          resetStarter(target);
          void offerStarter(target);
        }
        reply(tr("cobblemon.command.pokemonrestart", target.name));
      }
    }));
  }

  register(event, {
    name: "cobblemon:pokebox",
    description: "Sends a party Pokémon to the PC (optional box) / Manda um Pokémon do time para o PC (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "slot", type: P.Integer }],
    optionalParameters: [{ name: "box", type: P.Integer }, { name: "player", type: P.PlayerSelector }],
  }, (origin, slot: number, box?: number, players?: Player[]) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const found = partyPokemon(target, index, reply);
        if (!found) continue;
        if (countParty(target) <= 1) { reply(message.error({ translate: "cobblemon.command.pokebox.last_pokemon" })); continue; }
        const result = sendToBox(target, index, box, reply);
        if (result === StorageResult.Ok) recallIfOut(found.pokemon);
      }
    });
  });

  register(event, {
    name: "cobblemon:pokeboxall",
    description: "Sends the whole party to the PC except the last Pokémon / Manda o time todo para o PC (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    optionalParameters: [{ name: "box", type: P.Integer }, { name: "player", type: P.PlayerSelector }],
  }, (origin, box?: number, players?: Player[]) => later(origin, (executor, reply) => {
    for (const target of targetsOf(executor, players)) {
      const team = getSafeTeam(target);
      for (let i = 0; i < team.length; i++) {
        const pokemon = team[i];
        if (!pokemon) continue;
        if (countParty(target) <= 1) { reply(message.warn({ translate: "cobblemon.command.pokebox.last_pokemon" })); break; }
        if (sendToBox(target, i, box, reply) !== StorageResult.Ok) break;
        recallIfOut(pokemon);
      }
    }
  }));

  register(event, {
    name: "cobblemon:pctake",
    description: "Takes a Pokémon from another player's PC into yours / Tira um Pokémon do PC de outro jogador (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }, { name: "box", type: P.Integer }, { name: "slot", type: P.Integer }],
  }, (origin, players: Player[], box: number, slot: number) => later(origin, (executor, reply) => {
    const target = players?.find(p => p.isValid);
    if (!target) return;
    // PcTakeCommand: não mexe no PC de quem está em batalha.
    if (isPlayerInAnyBattle(target)) { reply(message.error({ translate: "cobblemon.pc.inbattle" })); return; }
    const boxIndex = parseBoxArg(box, getBoxCount(target));
    if (boxIndex === undefined) { reply(message.error(tr("cobblemon.command.pctake.too_many_boxes", getBoxCount(target)))); return; }
    const slotIndex = parseSlotArg(slot, spacesPerBox);
    if (slotIndex === undefined) { reply(message.error({ translate: "cobblemon.command.pctake.invalid_slot" })); return; }
    const location: PCLocation = { location: PCPlace.Box, boxID: boxIndex, space: slotIndex };
    const pokemon = getPokemonFromPCLocation(target, location);
    if (!pokemon) { reply(message.error(tr("cobblemon.command.pctake.no_pokemon", box, slot))); return; }
    setPokemonToPCLocation(target, location, null);
    // Executor jogador diferente do alvo: vai para o time dele; console ou o próprio alvo: o Pokémon é apagado.
    if (executor && executor.id !== target.id) {
      const result = storePokemonInFirstSpace(pokemon, executor);
      if (result) executor.sendMessage(result);
      reply(tr("cobblemon.command.pctake.taken_other", pokemon, target.name));
      return;
    }
    reply(tr("cobblemon.command.pctake.removed", pokemon, box, slot));
  }));

  register(event, {
    name: "cobblemon:takepokemon",
    description: "Takes a Pokémon from another player's party into yours / Tira um Pokémon do time de outro jogador (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }, { name: "slot", type: P.Integer }],
  }, (origin, players: Player[], slot: number) => {
    const index = parseSlotArg(slot);
    if (index === undefined) return fail(`Invalid party slot ${slot} (1-${PARTY_SIZE})`);
    return laterAsPlayer(origin, (executor, reply) => {
      const target = players?.find(p => p.isValid);
      if (!target) return;
      const found = partyPokemon(target, index, reply);
      if (!found) return;
      recallIfOut(found.pokemon);
      setPokemonToPCLocation(target, found.location, null);
      const result = storePokemonInFirstSpace(found.pokemon, executor);
      if (result) executor.sendMessage(result);
      reply(tr("cobblemon.command.pctake.taken_other", found.pokemon, target.name));
    });
  });

  register(event, {
    name: "cobblemon:pcsearch",
    description: "Searches a player's PC by properties / Busca no PC de um jogador (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }, { name: "properties", type: P.String }],
  }, (origin, players: Player[], properties: string) => later(origin, (_, reply) => {
    const target = players?.find(p => p.isValid);
    if (!target) return;
    const matches = searchPC(target, properties);
    if (matches.length === 0) { reply(tr("cobblemon.command.pcsearch.nomatch", properties, target.name)); return; }
    reply(tr("cobblemon.command.pcsearch.found", target.name));
    for (const { location, pokemon } of matches) {
      reply({
        rawtext: [
          tr("cobblemon.command.pcsearch.entry", pokemon, tr("cobblemon.label.lv", pokemon.level)),
          tr("cobblemon.command.pcsearch.location", (location.boxID ?? 0) + 1, location.space + 1),
        ]
      });
    }
  }));

  register(event, {
    name: "cobblemon:boxcount",
    description: "Queries/changes how many PC boxes a player has / Número de caixas do PC (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: ENUM_BOXCOUNT, type: P.Enum }, { name: "player", type: P.PlayerSelector }],
    optionalParameters: [{ name: "amount", type: P.Integer }],
  }, (origin, action: string, players: Player[], amount?: number) => {
    if (action !== "query" && (amount === undefined || amount < 1 || amount > MAX_BOXES)) return fail(`amount must be 1-${MAX_BOXES}`);
    return later(origin, (_, reply) => {
      for (const target of players?.filter(p => p.isValid) ?? []) {
        const current = getBoxCount(target);
        const next = action === "add" ? current + amount! : action === "remove" ? current - amount! : action === "set" ? amount! : current;
        if (action !== "query" && !setBoxCount(target, next)) {
          reply(message.error(tr("cobblemon.port.command.boxcount_not_empty", target.name)));
          continue;
        }
        reply(tr(K.pcBoxCount, getBoxCount(target)));
      }
    });
  });
}

/** Manda o Pokémon do espaço do time para o PC (caixa opcional). */
function sendToBox(target: Player, teamSlot: number, box: number | undefined, reply: Reply): StorageResult {
  if (box === undefined) {
    const result = depositToPC(target, teamSlot);
    if (result === StorageResult.NoSpace) reply(message.error({ translate: "cobblemon.command.pokebox.storage_is_full" }));
    else if (result === StorageResult.LastPartyPokemon) reply(message.error({ translate: "cobblemon.command.pokebox.last_pokemon" }));
    return result;
  }
  const boxIndex = parseBoxArg(box, getBoxCount(target));
  if (boxIndex === undefined) { reply(message.error(tr("cobblemon.command.pokebox.box_does_not_exist", box))); return StorageResult.InvalidLocation; }
  for (let space = 0; space < spacesPerBox; space++) {
    const location: PCLocation = { location: PCPlace.Box, boxID: boxIndex, space };
    if (getPokemonFromPCLocation(target, location) == null) {
      const result = movePokemon(target, { location: PCPlace.Team, space: teamSlot }, location);
      if (result === StorageResult.LastPartyPokemon) reply(message.error({ translate: "cobblemon.command.pokebox.last_pokemon" }));
      return result;
    }
  }
  reply(message.error(tr("cobblemon.command.pokebox.box_is_full", box)));
  return StorageResult.NoSpace;
}

/** Cor do CheckSpawnsCommand pela porcentagem (roxo < 0,01; vermelho < 0,1; amarelo < 5; verde). */
export function checkSpawnColor(percent: number): string {
  if (percent < 0.01) return "§d";
  if (percent < 0.1) return "§c";
  if (percent < 5) return "§e";
  return "§a";
}

/**
 * Soma as chances por espécie em várias posições (CheckSpawnsCommand: agrupa pelo nome) e devolve a média,
 * em ordem decrescente. Cada posição conta igual (aproximação do FlatSpawnablePositionWeightedSelector).
 */
export function aggregateSpawnChances(perPosition: { species: string; percent: number }[][]): { species: string; percent: number }[] {
  const totals = new Map<string, number>();
  let counted = 0;
  for (const list of perPosition) {
    if (list.length === 0) continue;
    counted++;
    for (const { species, percent } of list) totals.set(species, (totals.get(species) ?? 0) + percent);
  }
  return [...totals].map(([species, total]) => ({ species, percent: total / counted })).sort((a, b) => b.percent - a.percent);
}

/** Batalhas, iniciais e config. */
function registerServerAdmin(event: StartupEvent) {
  // GiveTmCommand.kt: /givetm <golpe> [jogador] [quantidade] (pilhas de até 64, sobra cai no chão).
  register(event, {
    name: "cobblemon:givetm",
    description: "Gives a TM with a move / Dá um TM com o golpe (admin).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "move", type: P.String }],
    optionalParameters: [{ name: "player", type: P.PlayerSelector }, { name: "quantity", type: P.Integer }],
  }, (origin, move: string, players?: Player[], quantity?: number) => {
    const id = toID(move);
    if (!Dex.moves.get(id).exists) return fail(`Unknown move: ${move}`);
    const amount = Math.max(1, Math.min(2304, Math.floor(quantity ?? 1)));
    return later(origin, (executor, reply) => {
      for (const target of targetsOf(executor, players)) {
        const container = target.getComponent("minecraft:inventory")?.container;
        for (let remaining = amount; remaining > 0; remaining -= 64) {
          const stack = createTechnicalMachine(id, Math.min(64, remaining));
          const leftover = container?.addItem(stack) ?? stack;
          if (leftover) target.dimension.spawnItem(leftover, target.location);
        }
        reply({ rawtext: [{ text: `Gave ${amount} TM ` }, { translate: `cobblemon.move.${Dex.moves.get(id).id}` }, { text: ` to ${target.name}` }] });
      }
    });
  });

  // CheckSpawnsCommand.kt: /checkspawn <bucket> — chances na zona de spawn em volta do jogador.
  register(event, {
    name: "cobblemon:checkspawn",
    description: "Shows what can spawn around you in a bucket (common, uncommon, rare, ultra-rare, boss) / Mostra o que pode aparecer aqui.",
    permissionLevel: ADMIN, cheatsRequired: false,
    mandatoryParameters: [{ name: "bucket", type: P.String }],
  }, (origin, bucket: string) => {
    const name = String(bucket ?? "").toLowerCase();
    if (!(name in BEST_SPAWNER_CONFIG.worldBuckets)) return fail("Invalid Spawn Bucket");
    return laterAsPlayer(origin, (player, reply) => {
      const config = getConfig();
      if (!config.enableSpawning || (config.worldSpawningBlocklist ?? []).includes(player.dimension.id)) return;
      const positions = positionsAround(player.dimension, player.location);
      const chances = aggregateSpawnChances(positions.map(ctx =>
        getSpawnProbabilities(ctx, { [name]: 1 }).map(p => ({ species: p.entry.species, percent: p.percent }))));
      if (chances.length === 0) { reply(message.error({ translate: "cobblemon.command.checkspawns.nothing" })); return; }
      const rawtext: RawMessage[] = [];
      chances.forEach(({ species, percent }, i) => {
        if (i > 0) rawtext.push({ text: "§r, " });
        rawtext.push({ translate: `cobblemon.species.${species}.name` }, { text: `: ${checkSpawnColor(percent)}${Math.round(percent * 100) / 100}%` });
      });
      reply({ rawtext: [{ text: "§n" }, { translate: "cobblemon.command.checkspawns.spawns" }] });
      reply({ rawtext });
    });
  });

  // SpawnPokemonFromPool.kt: /spawnpokemonfrompool [quantidade] (alias forcespawn) — força spawns naturais perto.
  for (const name of ["cobblemon:spawnpokemonfrompool", "cobblemon:forcespawn"]) {
    register(event, {
      name,
      description: "Spawns Pokémon from the natural spawn pool near you / Faz aparecer Pokémon do pool natural (admin).",
      permissionLevel: ADMIN, cheatsRequired: true,
      optionalParameters: [{ name: "amount", type: P.Integer }],
    }, (origin, amount?: number) => laterAsPlayer(origin, (player, reply) => {
      // Cada tentativa varre uma zona inteira: limite baixo para não estourar o watchdog.
      const times = Math.max(1, Math.min(20, Math.floor(amount ?? 1)));
      for (let i = 0; i < times; i++) {
        const spawned = spawnFromPool({ positions: positionsAround(player.dimension, player.location), maxSpawns: 1, player });
        if (spawned.length === 0) { reply(message.error({ translate: "cobblemon.command.spawnpokemonfrompool.unable_to_spawn" })); continue; }
        for (const entity of spawned) {
          const data = PokemonData.tryGetFromEntity(entity);
          const entityName: RawMessage = data ? data.getTranslatedName() : { text: entity.nameTag || entity.typeId };
          reply(message.color("Green", { translate: "cobblemon.command.spawnpokemonfrompool", with: { rawtext: [entityName] } }));
        }
      }
    }));
  }

  register(event, {
    name: "cobblemon:stopbattle",
    description: "Stops the battle a player is in / Encerra a batalha de um jogador (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players?: Player[]) => later(origin, (executor, reply) => {
    for (const target of targetsOf(executor, players)) {
      if (!stopBattle(target)) { reply(message.error(tr("cobblemon.port.command.no_battle", target.name))); continue; }
      reply(tr("cobblemon.port.command.battle_stopped", target.name));
    }
  }));

  register(event, {
    name: "cobblemon:openstarterscreen",
    description: "Opens the starter screen for a player, even if they already chose (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    optionalParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players?: Player[]) => later(origin, (executor) => {
    for (const target of targetsOf(executor, players)) void offerStarter(target, true);
  }));

  register(event, {
    name: "cobblemon:cobblemonconfig",
    description: "Edits the Cobblemon config: edit (form) | get <field> | set <field> <value> | reset | reload (admin).",
    permissionLevel: ADMIN, cheatsRequired: false,
    optionalParameters: [{ name: ENUM_CONFIG, type: P.Enum }, { name: "field", type: P.String }, { name: "value", type: P.String }],
  }, (origin, action?: string, field?: string, value?: string) => {
    switch (action ?? "edit") {
      case "edit":
        return laterAsPlayer(origin, player => showConfigEditor(player));
      case "get": {
        if (!field) return fail("Usage: cobblemonconfig get <field>");
        const key = findConfigKey(field);
        if (!key) return fail(`Unknown config field: ${field}`);
        return { status: CustomCommandStatus.Success, message: `${key} = ${JSON.stringify((getConfig() as unknown as Record<string, unknown>)[key])}` };
      }
      case "set": {
        if (!field || value === undefined) return fail("Usage: cobblemonconfig set <field> <value>");
        const parsed = parseConfigAssignment(field, value);
        if ("error" in parsed) return fail(parsed.error);
        system.run(() => setConfigValue(parsed.key, parsed.value));
        return { status: CustomCommandStatus.Success, message: `${parsed.key} = ${JSON.stringify(parsed.value)}` };
      }
      case "reset":
        system.run(() => resetConfig());
        return { status: CustomCommandStatus.Success, message: "Cobblemon config reset to defaults." };
      case "reload":
        return later(origin, (_, reply) => { loadConfig(); reply({ translate: "cobblemon.command.cobblemon_config.reload" }); });
    }
    return fail(`Unknown action ${action}`);
  });
}
