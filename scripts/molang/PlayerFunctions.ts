/**
 * Funções de `q.player` do Cobblemon 1.8.2 (PlayerMoLangFunctions.kt, PokedexMoLangFunctions.kt,
 * PokemonStoreMoLangFunctions.kt/PartyMoLangFunctions.kt/PCMoLangFunctions.kt) que o scripts/npc/PlayerStruct.ts não
 * tinha. `registerPlayerFunctions` é chamado no fim de `createPlayerStruct` e só acrescenta; as exceções
 * (superconjuntos do que já existia, mesmo resultado para o uso antigo) são:
 * - `main_held_item`: struct de ItemStack completo (continua com `id`, `is_of` e `is_empty`, agora com
 *   `is_enchanted`, `has_enchantment`, `count`...);
 * - `world`: struct de mundo completo (continua com `game_time`).
 *
 * Sem equivalente no Bedrock (retornam 0): `swing_hand` (a API estável não anima o braço), `seen_credits` (o Bedrock
 * não expõe se o jogador viu os créditos) e `battle` (sem struct de batalha no port; `in_battle` já existe).
 * `battle_music` ignora o tom (Player.playMusic não tem pitch) e `start_battle` ignora `rules`.
 */
import { EntityHealthComponent, EquipmentSlot, GameMode, ItemStack, Player } from "@minecraft/server";
import { MoArray, MoStruct, MoValue, asNumber, asString } from "../npc/molang/MoLang";
import { PokemonData } from "../Pokemon";
import { PCPlace, getBoxCount, getPokemonFromPCLocation, getSafeTeam, healPokemon, setBoxCount, setPokemonToPCLocation, storePokemonInFirstSpace } from "../pokemonStorage";
import { PokemonProperties } from "../PokemonProperties";
import { createNPCPokemon } from "../npc/Party";
import { getActiveDialogue } from "../npc/dialogue/DialogueManager";
import { startPvPBattle } from "../battle";
import { battleFormatFromId } from "../npc/NPCEntity";
import { getLearnedTMs, learnTMs, unlearnTMs } from "../machines/tm";
import { TECHNICAL_MACHINES } from "../machines/data";
import { getPokedex, markCaught, markSeen } from "../pokedex/PokedexStorage";
import { DexProgress } from "../pokedex/PokedexRecords";
import { computeDexCounts, getDex } from "../pokedex/DexData";
import { isProgressGoalDone } from "../pokedex/Progress";
import { COBBLEMON_STATS, CobblemonStat, getStat } from "../events/PlayerStats";
import { getUnlockedWallpapers, hasUnlockedWallpaper, unlockWallpaper } from "../GUI/PCWallpapers";
import { toSpeciesId } from "../speciesData";
import { toID } from "../showdown";
import { argBool, argInt, argNumber, bedrockSoundId, withNamespace } from "./GeneralFunctions";
import { createItemStackStruct, itemStackOfStruct } from "./ItemStackStruct";
import { createWorldStruct, playerFromValue } from "./WorldStruct";
import { createPokemonEntityStruct, createPokemonStruct } from "./PokemonStruct";
import { createEntityStruct } from "./EntityStruct";
import { structHooks } from "./StructHooks";
import { createPlayerStruct } from "../npc/PlayerStruct";

// q.pokemon.owner / q.pokemon.entity (ver StructHooks.ts).
structHooks.player = player => createPlayerStruct(player);
structHooks.entity = entity => createEntityStruct(entity);

/** Mesmas chaves de scripts/starter.ts (o jogador já escolheu o inicial) e do uuid gravado por giveStarter. */
const STARTER_SELECTED = "starter_selected";
export const STARTER_UUID_PROPERTY = "cobblemon:starter_uuid";

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); }
  catch { return fallback; }
}

function inventory(player: Player) {
  return safe(() => player.getComponent("minecraft:inventory")?.container, undefined);
}

/** ItemStack de um argumento: struct (ObjectValue<ItemStack>) ou id (ResourceLocation). */
function stackFromValue(value: MoValue | undefined): ItemStack | undefined {
  if (value === undefined) return undefined;
  const fromStruct = itemStackOfStruct(value);
  if (fromStruct) return safe(() => fromStruct.clone(), fromStruct);
  if (typeof value !== "string") return undefined;
  return safe(() => new ItemStack(withNamespace(value, "minecraft"), 1), undefined);
}

/** PokemonData guardado num struct de Pokémon (ObjectValue<Pokemon>). */
function pokemonOfStruct(value: MoValue | undefined): PokemonData | undefined {
  if (!(value instanceof MoStruct)) return undefined;
  const host = value.host as PokemonData | undefined;
  return host && typeof host === "object" && typeof (host as PokemonData).species === "string" && typeof (host as PokemonData).uuid === "string" ? host : undefined;
}

// ---------------------------------------------------------------------------------------------
// Pokédex (PokedexMoLangFunctions)

const PROGRESS_NAMES = ["UNREGISTERED", "SEEN", "OWNED"];

function speciesRecordStruct(player: Player, speciesId: string): MoStruct {
  const records = getPokedex(player);
  const record = records.getSpeciesRecord(speciesId);
  if (!record) return new MoStruct();
  return new MoStruct({}, {
    knowledge: () => PROGRESS_NAMES[records.getKnowledgeForSpecies(speciesId)],
    has_knowledge: args => (PROGRESS_NAMES.indexOf(asString(args[0]).toUpperCase()) === records.getKnowledgeForSpecies(speciesId) ? 1 : 0),
    aspects: () => new MoArray([...record.aspects]),
    has_aspect: args => (record.aspects.has(asString(args[0])) ? 1 : 0),
    get_form_record: args => {
      const form = record.forms.get(asString(args[0]).toLowerCase());
      return form ? new MoStruct({ knowledge: PROGRESS_NAMES[form.knowledge], highest_level: form.highestLevel }) : new MoStruct();
    },
  }, record);
}

/**
 * PokedexManager.struct. `dex_*` recebem o id da Pokédex (Cobblemon 1.8.2: "kanto", "cobblemon:paldea"...); sem id
 * (extensão do port) usam a contagem global. Pokédex inexistente = 0, como no Kotlin.
 */
export function createPokedexStruct(player: Player): MoStruct {
  const knowledge = (species: string, form?: string): DexProgress => {
    const records = getPokedex(player);
    const id = toSpeciesId(species);
    return form === undefined ? records.getKnowledgeForSpecies(id) : records.getFormKnowledge(id, form);
  };
  const counts = (dexId?: string) => computeDexCounts(getPokedex(player), dexId);
  const percent = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);
  /** Valor por Pokédex ou global; Pokédex desconhecida = 0. */
  const byDex = (args: MoValue[], read: (c: ReturnType<typeof counts>) => number) => {
    if (args[0] === undefined) return read(counts());
    const dexId = withNamespace(asString(args[0]));
    return getDex(dexId) ? read(counts(dexId)) : 0;
  };
  return new MoStruct({}, {
    player_id: () => player.id,
    get_species_record: args => speciesRecordStruct(player, toSpeciesId(asString(args[0]))),
    has_seen: args => (knowledge(asString(args[0]), args[1] !== undefined ? asString(args[1]) : undefined) >= DexProgress.SEEN ? 1 : 0),
    has_caught: args => (knowledge(asString(args[0]), args[1] !== undefined ? asString(args[1]) : undefined) === DexProgress.OWNED ? 1 : 0),
    caught_count: () => counts().caught,
    seen_count: () => counts().seen,
    caught_percent: () => { const c = counts(); return percent(c.caught, c.total); },
    seen_percent: () => { const c = counts(); return percent(c.seen, c.total); },
    dex_caught_count: args => byDex(args, c => c.caught),
    dex_seen_count: args => byDex(args, c => c.seen),
    dex_caught_percent: args => byDex(args, c => percent(c.caught, c.total)),
    dex_seen_percent: args => byDex(args, c => percent(c.seen, c.total)),
    see: args => {
      const pokemon = pokemonOfStruct(args[0]);
      if (pokemon) markSeen(player, pokemon);
      return 1;
    },
    catch: args => {
      const pokemon = pokemonOfStruct(args[0]);
      if (pokemon) markCaught(player, pokemon);
      return 1;
    },
  }, player);
}

// ---------------------------------------------------------------------------------------------
// Time e PC (PokemonStoreMoLangFunctions + PartyMoLangFunctions / PCMoLangFunctions)

function saveTeam(player: Player, team: (PokemonData | null)[]) {
  player.setDynamicProperty("team", JSON.stringify(team));
}

/** Pokémon do time com gravação automática ao mudar (Pokemon.onChange → PartyStore). */
function partyPokemonStruct(player: Player, pokemon: PokemonData): MoStruct {
  return createPokemonStruct(pokemon, undefined, {
    onChange: changed => {
      const team = getSafeTeam(player);
      const index = team.findIndex(p => p?.uuid === changed.uuid);
      if (index !== -1) { team[index] = changed; saveTeam(player, team); }
      safe(() => changed.tryUpdatePokemonOut(), undefined);
    },
  });
}

export function createPartyStoreStruct(player: Player): MoStruct {
  const members = () => getSafeTeam(player).filter((p): p is PokemonData => p != null);
  const matching = (args: MoValue[]) => {
    const props = PokemonProperties.parse(asString(args[0]));
    return members().filter(p => safe(() => props.match(p), false));
  };
  return new MoStruct({}, {
    uuid: () => player.id,
    add: args => {
      const pokemon = pokemonOfStruct(args[0]);
      return pokemon ? addToStore(player, pokemon) : 0;
    },
    add_by_properties: args => {
      const pokemon = createNPCPokemon(asString(args[0]), 1);
      return pokemon ? addToStore(player, pokemon) : 0;
    },
    find_by_properties: args => { const found = matching(args)[0]; return found ? partyPokemonStruct(player, found) : 0; },
    find_all_by_properties: args => new MoArray(matching(args).map(p => partyPokemonStruct(player, p))),
    find_by_id: args => {
      const found = members().find(p => p.uuid === asString(args[0]));
      return found ? partyPokemonStruct(player, found) : 0;
    },
    remove_by_id: args => {
      const team = getSafeTeam(player);
      const index = team.findIndex(p => p?.uuid === asString(args[0]));
      if (index === -1) return 0;
      team[index] = null;
      saveTeam(player, team);
      return 1;
    },
    average_level: () => { const list = members(); return list.length ? list.reduce((s, p) => s + p.level, 0) / list.length : 0; },
    count: () => members().length,
    count_by_properties: args => matching(args).length,
    highest_level: () => members().reduce((max, p) => Math.max(max, p.level), 0),
    lowest_level: () => { const list = members(); return list.length ? Math.min(...list.map(p => p.level)) : 0; },
    heal: () => {
      const team = getSafeTeam(player);
      team.forEach(p => { if (p) healPokemon(p); });
      saveTeam(player, team);
      return 1;
    },
    healing_remainder_percent: () => members().reduce((sum, p) => sum + (1 - (p.maxHealth > 0 ? p.currentHealth / p.maxHealth : 1)), 0),
    has_usable_pokemon: () => (members().some(p => p.currentHealth > 0) ? 1 : 0),
    pokemon: () => new MoArray(members().map(p => partyPokemonStruct(player, p))),
    get_pokemon: args => {
      const pokemon = getSafeTeam(player)[argInt(args, 0, 0)];
      return pokemon ? partyPokemonStruct(player, pokemon) : 0;
    },
    set_pokemon: args => {
      const index = argInt(args, 0, 0);
      const pokemon = pokemonOfStruct(args[1]);
      const team = getSafeTeam(player);
      if (!pokemon || index < 0 || index >= team.length) return 0;
      pokemon.trainer = player.id;
      team[index] = pokemon;
      saveTeam(player, team);
      return 1;
    },
  }, player);
}

/** PokemonStore.add: time, senão PC. 0 = sem espaço. */
function addToStore(player: Player, pokemon: PokemonData): number {
  const result = storePokemonInFirstSpace(pokemon, player);
  return result && (result as { translate?: string }).translate === "cobblemon.overflow_no_space" ? 0 : 1;
}

export function createPCStoreStruct(player: Player): MoStruct {
  return new MoStruct({}, {
    uuid: () => player.id,
    get_pokemon: args => {
      const pokemon = safe(() => getPokemonFromPCLocation(player, { location: PCPlace.Box, boxID: argInt(args, 0, 0), space: argInt(args, 1, 0) }), undefined);
      return pokemon ? createPokemonStruct(pokemon, undefined, {
        onChange: changed => safe(() => setPokemonToPCLocation(player, { location: PCPlace.Box, boxID: argInt(args, 0, 0), space: argInt(args, 1, 0) }, changed), undefined),
      }) : 0;
    },
    set_pokemon: args => {
      const pokemon = pokemonOfStruct(args[2]);
      if (!pokemon) return 0;
      pokemon.trainer = player.id;
      return safe(() => { setPokemonToPCLocation(player, { location: PCPlace.Box, boxID: argInt(args, 0, 0), space: argInt(args, 1, 0) }, pokemon); return 1; }, 0);
    },
    // resize(novo tamanho, travar): o port não tem trava de tamanho; força o novo número de caixas.
    resize: args => (setBoxCount(player, argInt(args, 0, getBoxCount(player)), true) ? 1 : 0),
    get_box_count: () => getBoxCount(player),
    has_unlocked_wallpaper: args => (hasUnlockedWallpaper(player, withNamespace(asString(args[0]))) ? 1 : 0),
    get_unlocked_wallpapers: () => new MoArray(getUnlockedWallpapers(player).slice()),
    unlock_wallpaper: args => (unlockWallpaper(player, withNamespace(asString(args[0])), argBool(args, 1, true)) ? 1 : 0),
  }, player);
}

// ---------------------------------------------------------------------------------------------
// TMs (Cobblemon 1.8.0: has_tm_move_unlocked, unlock_tm_move, lock_tm_move)

/** TechnicalMachines.moveToTM: só golpes que têm TM. */
function tmMove(value: MoValue | undefined): string | undefined {
  const move = toID(asString(value));
  return TECHNICAL_MACHINES[move] ? move : undefined;
}

// ---------------------------------------------------------------------------------------------
// Registro

export function registerPlayerFunctions(struct: MoStruct, player: Player): void {
  const heldStruct = (slot: EquipmentSlot) => {
    const equippable = safe(() => player.getComponent("minecraft:equippable"), undefined);
    const stack = safe(() => equippable?.getEquipment(slot), undefined);
    return createItemStackStruct(stack, next => safe(() => equippable?.setEquipment(slot, next), undefined));
  };
  const health = () => safe(() => player.getComponent("minecraft:health") as EntityHealthComponent | undefined, undefined);
  const gameMode = () => safe(() => player.getGameMode(), GameMode.Survival);

  struct
    .fn("main_held_item", () => heldStruct(EquipmentSlot.Mainhand))
    .fn("off_held_item", () => heldStruct(EquipmentSlot.Offhand))
    .fn("inventory", () => {
      const container = inventory(player);
      if (!container) return new MoArray([]);
      const items: MoStruct[] = [];
      for (let i = 0; i < container.size; i++) {
        const slot = i;
        items.push(createItemStackStruct(safe(() => container.getItem(slot), undefined), next => safe(() => container.setItem(slot, next), undefined)));
      }
      return new MoArray(items);
    })
    .fn("has_inventory_space", () => (safe(() => (inventory(player)?.emptySlotsCount ?? 0) > 0, false) ? 1 : 0))
    .fn("set_inventory_slot", args => {
      const container = inventory(player);
      const slot = argInt(args, 0, -1);
      if (!container || slot < 0 || slot >= container.size) return 0;
      const stack = stackFromValue(args[1]);
      if (!stack) return 0;
      return safe(() => { container.setItem(slot, stack); return 1; }, 0);
    })
    .fn("give_item", args => {
      const container = inventory(player);
      const stack = stackFromValue(args[0]);
      if (!container || !stack) return 0;
      const free = safe(() => container.firstEmptySlot(), undefined);
      if (free === undefined) {
        if (!argBool(args, 1, false)) return 0;
        safe(() => player.dimension.spawnItem(stack, player.location), undefined);
        return 1;
      }
      return safe(() => { container.setItem(free, stack); return 1; }, 0);
    })
    // Sem API estável para animar o braço do jogador.
    .fn("swing_hand", () => 0)
    .fn("food_level", () => safe(() => player.getComponent("minecraft:player.hunger")?.currentValue ?? 20, 20))
    .fn("saturation_level", () => safe(() => player.getComponent("minecraft:player.saturation")?.currentValue ?? 5, 5))
    .fn("teleport", args => {
      safe(() => player.teleport({ x: asNumber(args[0]), y: asNumber(args[1]), z: asNumber(args[2]) }), undefined);
      return 1;
    })
    .fn("heal", args => {
      const component = health();
      if (!component) return 0;
      const amount = argNumber(args, 0, component.effectiveMax);
      safe(() => component.setCurrentValue(Math.min(component.effectiveMax, component.currentValue + amount)), false);
      return 1;
    })
    .fn("environment", () => new MoStruct({ query: struct }))
    .fn("riding_pokemon", () => {
      const vehicle = safe(() => player.getComponent("minecraft:riding")?.entityRidingOn, undefined);
      const pokemon = vehicle ? safe(() => PokemonData.tryGetFromEntity(vehicle), undefined) : undefined;
      return vehicle && pokemon ? createPokemonEntityStruct(vehicle, pokemon) : 0;
    })
    // O Bedrock não expõe se o jogador viu os créditos.
    .fn("seen_credits", () => 0)
    .fn("is_in_dialogue", () => (getActiveDialogue(player) ? 1 : 0))
    .fn("active_dialogue", () => {
      const dialogue = getActiveDialogue(player);
      return dialogue ? new MoStruct({ id: dialogue.dialogue.id ?? "" }, {
        current_page: () => dialogue.currentPage.id ?? "",
        current_page_number: () => dialogue.currentPageIndex,
      }, dialogue) : 0;
    })
    .fn("is_spectator", () => (gameMode() === GameMode.Spectator ? 1 : 0))
    .fn("is_creative", () => (gameMode() === GameMode.Creative ? 1 : 0))
    .fn("is_survival", () => (gameMode() === GameMode.Survival ? 1 : 0))
    .fn("is_adventure", () => (gameMode() === GameMode.Adventure ? 1 : 0))
    .fn("run_command", args => safe(() => player.runCommand(asString(args[0]).replace(/^\//, "")).successCount, 0))
    .fn("set_battle_theme", args => {
      player.setDynamicProperty("cobblemon:battle_theme", bedrockSoundId(asString(args[0])));
      return 1;
    })
    .fn("battle_music", args => {
      const sound = bedrockSoundId(asString(args[0]));
      if (!sound) return 0;
      // O tom (3º argumento) não existe em Player.playMusic; `restart` é o comportamento padrão do playMusic.
      safe(() => player.playMusic(sound, { volume: argNumber(args, 1, 1), loop: true }), undefined);
      return 1;
    })
    .fn("stop_battle_music", () => { safe(() => player.stopMusic(), undefined); return 1; })
    .fn("play_sound_on_server", args => {
      safe(() => player.playSound(bedrockSoundId(asString(args[0])), { volume: argNumber(args, 2, 1), pitch: argNumber(args, 3, 1) }), undefined);
      return 1;
    })
    .fn("party", () => createPartyStoreStruct(player))
    .fn("pc", () => createPCStoreStruct(player))
    .fn("has_permission", args => (safe(() => Number(player.commandPermissionLevel) >= Math.min(4, argInt(args, 1, 4)), false) ? 1 : 0))
    // Sem struct de batalha no port (BattleMoLangFunctions); use in_battle.
    .fn("battle", () => 0)
    .fn("pokedex", () => createPokedexStruct(player))
    .fn("has_advancement", args => (isProgressGoalDone(player, asString(args[0])) ? 1 : 0))
    .fn("has_tm_move_unlocked", args => {
      const move = tmMove(args[0]);
      return move && getLearnedTMs(player).has(move) ? 1 : 0;
    })
    .fn("unlock_tm_move", args => {
      const move = tmMove(args[0]);
      if (!move) return 0;
      learnTMs(player, [move]);
      return getLearnedTMs(player).has(move) ? 1 : 0;
    })
    .fn("lock_tm_move", args => {
      const move = tmMove(args[0]);
      if (!move) return 0;
      unlearnTMs(player, [move]);
      return getLearnedTMs(player).has(move) ? 0 : 1;
    })
    .fn("start_battle", args => {
      const opponent = playerFromValue(args[0]);
      if (!opponent || opponent.id === player.id) return 0;
      const format = battleFormatFromId(args[1] === undefined ? undefined : asString(args[1]));
      const setLevel = argInt(args, 2, -1);
      const battle = safe(() => startPvPBattle(player, opponent, format, {
        team: { setLevel: setLevel > 0 ? setLevel : undefined, clone: setLevel !== -1 || argBool(args, 3, false), heal: argBool(args, 4, false) },
      }), undefined);
      return battle ? new MoStruct({ id: battle.battleId }, {}, battle) : 0;
    })
    .fn("get_custom_stat", args => {
      const name = asString(args[0]).replace(/^cobblemon:/, "") as CobblemonStat;
      return (COBBLEMON_STATS as readonly string[]).includes(name) ? getStat(player, name) : 0;
    })
    // Cobblemon 1.8.0: has_chosen_starter e get_starter_uuid.
    .fn("has_chosen_starter", () => (player.getDynamicProperty(STARTER_SELECTED) === true ? 1 : 0))
    .fn("get_starter_uuid", () => {
      const uuid = player.getDynamicProperty(STARTER_UUID_PROPERTY);
      return typeof uuid === "string" ? uuid : 0;
    })
    // Superconjunto do `world` antigo (game_time continua).
    .fn("world", () => createWorldStruct(player.dimension));
}
