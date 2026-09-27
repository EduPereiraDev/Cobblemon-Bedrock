/**
 * Config do Cobblemon (port de `config/CobblemonConfig.kt` + `config/starter/StarterConfig.kt`).
 *
 * Fica salva como JSON na dynamic property de mundo `cobblemon_config`. Campos que não existem no
 * JSON salvo recebem o valor padrão, então adicionar campos novos não quebra mundos antigos.
 * Editável em jogo por operadores com `/cobblemon:cobblemonconfig` (GUI/ConfigEditor.ts).
 *
 * Os nomes seguem o Cobblemon 1.8.2. Nomes antigos do port (`maxPokemonFriendShip`,
 * `allowExperienceFromPVP`, `maxNearbyBlocksVerticleRange`) são migrados ao carregar e continuam
 * acessíveis como getters.
 */
import { world } from "@minecraft/server";

export const CONFIG_PROPERTY = "cobblemon_config";

/** Categorias do Cobblemon (`config/Category.kt`); o texto vem de `cobblemon.config.ui.category.<id>`. */
export type ConfigCategory = "pokemon" | "spawning" | "battles" | "passive_status" | "healing" | "world" |
  "pokedex" | "storage" | "starter" | "interface" | "riding" | "debug";

export const CONFIG_CATEGORIES: ConfigCategory[] = [
  "pokemon", "spawning", "battles", "passive_status", "healing", "world", "pokedex", "storage", "starter", "interface", "riding", "debug",
];

/** Categoria de iniciais (`config/starter/StarterCategory.kt`). `pokemon` são PokemonProperties. */
export interface StarterCategory {
  name: string;
  displayName: string;
  pokemon: string[];
  /** Mostra um botão "Aleatório" que sorteia um dos Pokémon da categoria. */
  randomStarter?: boolean;
  /** StarterCategory.order (1.8.0): a tela ordena as categorias por este número (padrão 0). */
  order?: number;
}

/** Categorias na ordem da tela (StarterUIPacketHandler: `sortedBy { it.order }`, estável). */
export function sortStarterCategories<T extends { order?: number }>(categories: readonly T[]): T[] {
  return categories.map((category, index) => ({ category, index }))
    .sort((a, b) => (a.category.order ?? 0) - (b.category.order ?? 0) || a.index - b.index)
    .map(x => x.category);
}

/** Iniciais padrão do Cobblemon 1.8.2 (StarterConfig.kt), na mesma ordem. */
export const DEFAULT_STARTERS: StarterCategory[] = [
  { name: "Kanto", order: -110, displayName: "cobblemon.starterselection.category.kanto", pokemon: ["bulbasaur level=10", "charmander level=10", "squirtle level=10"] },
  { name: "Johto", order: -109, displayName: "cobblemon.starterselection.category.johto", pokemon: ["chikorita level=10", "cyndaquil level=10", "totodile level=10"] },
  { name: "Hoenn", order: -108, displayName: "cobblemon.starterselection.category.hoenn", pokemon: ["treecko level=10", "torchic level=10", "mudkip level=10"] },
  { name: "Sinnoh", order: -107, displayName: "cobblemon.starterselection.category.sinnoh", pokemon: ["turtwig level=10", "chimchar level=10", "piplup level=10"] },
  { name: "Unova", order: -106, displayName: "cobblemon.starterselection.category.unova", pokemon: ["snivy level=10", "tepig level=10", "oshawott level=10"] },
  { name: "Kalos", order: -105, displayName: "cobblemon.starterselection.category.kalos", pokemon: ["chespin level=10", "fennekin level=10", "froakie level=10"] },
  { name: "Alola", order: -104, displayName: "cobblemon.starterselection.category.alola", pokemon: ["rowlet level=10", "litten level=10", "popplio level=10"] },
  { name: "Galar", order: -103, displayName: "cobblemon.starterselection.category.galar", pokemon: ["grookey level=10", "scorbunny level=10", "sobble level=10"] },
  {
    name: "Hisui Bias", order: -102, displayName: "cobblemon.starterselection.category.hisui_bias", pokemon: [
      "rowlet region-bias-hisui level=10 pokeball=cobblemon:ancient_poke_ball",
      "cyndaquil region-bias-hisui level=10 pokeball=cobblemon:ancient_poke_ball",
      "oshawott region-bias-hisui level=10 pokeball=cobblemon:ancient_poke_ball",
    ]
  },
  { name: "Paldea", order: -101, displayName: "cobblemon.starterselection.category.paldea", pokemon: ["sprigatito level=10", "fuecoco level=10", "quaxly level=10"] },
  { name: "Special", order: -100, displayName: "cobblemon.starterselection.category.special", pokemon: ["pikachu level=10", "eevee level=10"], randomStarter: true },
];

/** Valores padrão. O tipo de cada campo (número, booleano, texto, lista) vem daqui. */
export const DEFAULT_CONFIG = {
  // Pokémon
  maxPokemonLevel: 100,
  maxPokemonFriendship: 255,
  announceDropItems: true,
  defaultDropItemMethod: "on_entity",
  dropAfterDeathAnimation: false,
  ambientPokemonCryTicks: 1080,
  experienceMultiplier: 2,
  displayEntityLevelLabel: true,
  displayEntityNameLabel: true,
  displayNameForUnknownPokemon: false,
  displayEntityLabelsWhenCrouchingOnly: false,
  fossilMachineAlphaChance: 20,
  fossilMachineShinyChance: 100,
  honeySlatherAlphaChance: 100,
  honeySlatherShinyChance: 4000,
  shinyNoticeParticlesDistance: 24,
  playerDamagePokemon: true,
  pokemonIntrinsicSizeMin: 0.95,
  pokemonIntrinsicSizeMax: 1.05,
  babyPokemonLevelDuration: 9,
  babyPokemonSizeMultiplier: 0.9,
  minimumRidingScale: 0.75,
  maxDynamaxLevel: 10,
  infiniteTmUses: false,
  // Armazenamento
  defaultKeyItems: [] as string[],
  // 40 desde o Cobblemon 1.7.0 (@LastChangedVersion: configs salvas antes disso voltam ao padrão; ver loadConfig).
  defaultBoxCount: 40,
  pokemonSaveIntervalSeconds: 30,
  preventCompletePartyDeposit: false,
  // Spawn
  maxVerticalCorrectionBlocks: 64,
  minimumLevelRangeMax: 10,
  enableSpawning: true,
  worldSpawningBlocklist: [] as string[],
  minimumDistanceBetweenEntities: 8,
  maxNearbyBlocksHorizontalRange: 4,
  maxNearbyBlocksVerticalRange: 2,
  maxVerticalSpace: 8,
  spawningZoneDiameter: 8,
  spawningZoneHeight: 16,
  ticksBetweenSpawnAttempts: 20,
  minimumSpawningZoneDistanceFromPlayer: 16,
  maximumSpawningZoneDistanceFromPlayer: 64,
  maximumSpawnsPerPass: 8,
  savePokemonToWorld: true,
  pokemonPerChunk: 1,
  pokeSnackPokemonPerChunk: 2,
  baseApricornTreeGenerationChance: 0.1,
  shinyRate: 8192,
  teraTypeRate: 20,
  despawnerNearDistance: 32,
  despawnerFarDistance: 96,
  despawnerMinAgeTicks: 600,
  despawnerMaxAgeTicks: 3600,
  monitorAlphaRate: 40,
  monitorShinyRate: 200,
  // Batalhas
  defaultFleeDistance: 32,
  allowExperienceFromPvP: true,
  experienceShareMultiplier: 0.5,
  awardExperienceToFaintedPokemon: false,
  awardExperienceOnBattleLoss: false,
  luckyEggMultiplier: 1.5,
  allowSpectating: true,
  walkingInBattleAnimations: false,
  battleWildMaxDistance: 12,
  battlePvPMaxDistance: 32,
  battleSpectateMaxDistance: 64,
  // Status passivos (duração fora de batalha, em segundos: [mínimo, máximo])
  passiveStatuses: {
    "cobblemon:poison": [180, 300], "cobblemon:poisonbadly": [180, 300], "cobblemon:paralysis": [180, 300],
    "cobblemon:frozen": [180, 300], "cobblemon:sleep": [180, 300], "cobblemon:burn": [180, 300],
  } as Record<string, [number, number]>,
  // Cura
  infiniteHealerCharge: false,
  maxHealerCharge: 6,
  secondsToChargeHealingMachine: 900,
  defaultFaintTimer: 300,
  faintAwakenHealthPercent: 0.2,
  healPercent: 0.05,
  healTimer: 60,
  // Mundo
  appleLeftoversChance: 0.025,
  maxRootsInArea: 9,
  bigRootPropagationChance: 0.5,
  energyRootChance: 0.25,
  defaultPasturedPokemonLimit: 16,
  pastureBlockUpdateTicks: 40,
  pastureMaxWanderDistance: 32,
  pastureMaxPerChunk: 4,
  maxInsertedFossilItems: 2,
  tradeMaxDistance: 12,
  // Pokédex
  maxPokedexScanningDetectionRange: 10,
  unlockAllMoveDexMovesByDefault: false,
  hideUnimplementedPokemonInThePokedex: false,
  // Iniciais (StarterConfig.kt)
  allowStarterOnJoin: true,
  promptStarterOnceOnly: true,
  starters: DEFAULT_STARTERS,
  // Interface (port: HUD do time na actionbar)
  partyHudEnabled: true,
  partyHudDefaultOn: false,
  // Montaria
  infiniteRideStamina: false,
  /** Segundos do overlay de controles ao montar (RideControlsOverlay; 0 = desligado, padrão do 1.8.2). */
  displayControlSeconds: 0,
  // Depuração
  enableDebugKeys: false,
  /**
   * Só do port: sondas de depuração por `/scriptevent` (md_*, ms_*, debug_visual, ianpc_*). Desligado por padrão;
   * fora do editor, liga só pelo console do servidor (`scriptevent cobblemon:debug_probes on`).
   */
  enableDebugProbes: false,
  // Só do port (campo antigo sem uso conhecido, mantido para não perder dados salvos)
  mainCharacter: "",
};

export type ConfigValues = typeof DEFAULT_CONFIG;
export type ConfigKey = keyof ConfigValues;

/** Metadados de um campo editável no formulário de config. */
export interface ConfigFieldSpec {
  key: ConfigKey;
  category: ConfigCategory;
  /** Sufixo da chave de tradução `cobblemon.config.ui.<lang>` (e `.tooltip`). */
  lang: string;
  integer?: boolean;
  min?: number;
  max?: number;
  /** Opções fixas de um campo de texto (vira dropdown). */
  options?: string[];
}

function f(key: ConfigKey, category: ConfigCategory, lang: string, extra: Partial<ConfigFieldSpec> = {}): ConfigFieldSpec {
  return { key, category, lang, ...extra };
}
const INT = (min?: number, max?: number): Partial<ConfigFieldSpec> => ({ integer: true, min, max });
const NUM = (min?: number, max?: number): Partial<ConfigFieldSpec> => ({ min, max });

/** Campos na ordem do CobblemonConfig.kt. `passiveStatuses`, `starters` e `mainCharacter` só pelo JSON. */
export const CONFIG_FIELDS: ConfigFieldSpec[] = [
  f("maxPokemonLevel", "pokemon", "max_pokemon_level", INT(1, 1000)),
  f("maxPokemonFriendship", "pokemon", "max_pokemon_friendship", INT(0, 1000)),
  f("announceDropItems", "pokemon", "announce_drop_items"),
  f("defaultDropItemMethod", "pokemon", "default_drop_item_method", { options: ["on_entity", "on_player", "to_inventory"] }),
  f("dropAfterDeathAnimation", "pokemon", "drops_after_death_animation"),
  f("ambientPokemonCryTicks", "pokemon", "ambient_pokemon_cry_ticks", INT(0)),
  f("experienceMultiplier", "pokemon", "experience_multiplier", NUM(0)),
  f("displayEntityLevelLabel", "pokemon", "display_entity_level_label"),
  f("displayEntityNameLabel", "pokemon", "display_entity_name_label"),
  f("displayNameForUnknownPokemon", "pokemon", "display_name_for_unknown_pokemon"),
  f("displayEntityLabelsWhenCrouchingOnly", "pokemon", "display_entity_labels_when_crouching_only"),
  f("fossilMachineAlphaChance", "pokemon", "fossil_machine_alpha_chance", INT(0)),
  f("fossilMachineShinyChance", "pokemon", "fossil_machine_shiny_chance", INT(0)),
  f("honeySlatherAlphaChance", "pokemon", "honey_slather_alpha_chance", INT(0)),
  f("honeySlatherShinyChance", "pokemon", "honey_slather_shiny_chance", INT(0)),
  f("shinyNoticeParticlesDistance", "pokemon", "shiny_notice_particles_distance", NUM(0)),
  f("playerDamagePokemon", "pokemon", "player_damage_pokemon"),
  f("pokemonIntrinsicSizeMin", "pokemon", "pokemon_intrinsic_size_min", NUM(0.01)),
  f("pokemonIntrinsicSizeMax", "pokemon", "pokemon_intrinsic_size_max", NUM(0.01)),
  f("babyPokemonLevelDuration", "pokemon", "baby_pokemon_level_duration", INT(0)),
  f("babyPokemonSizeMultiplier", "pokemon", "baby_pokemon_size_multiplier", NUM(0.01)),
  f("minimumRidingScale", "pokemon", "minimum_riding_scale", NUM(0)),
  f("infiniteTmUses", "pokemon", "infinite_tm_uses"),
  f("defaultKeyItems", "storage", "default_key_items"),
  f("defaultBoxCount", "storage", "default_box_count", INT(1, 1000)),
  f("pokemonSaveIntervalSeconds", "storage", "pokemon_save_interval_seconds", INT(1, 120)),
  f("preventCompletePartyDeposit", "storage", "prevent_complete_party_deposit"),
  f("maxVerticalCorrectionBlocks", "spawning", "max_vertical_correction_blocks", INT(1, 200)),
  f("minimumLevelRangeMax", "spawning", "minimum_level_range_max", INT(1, 1000)),
  f("enableSpawning", "spawning", "enable_spawning"),
  f("worldSpawningBlocklist", "spawning", "world_spawning_blocklist"),
  f("minimumDistanceBetweenEntities", "spawning", "minimum_distance_between_entities", NUM(0)),
  f("maxNearbyBlocksHorizontalRange", "spawning", "max_nearby_blocks_horizontal_range", INT(0)),
  f("maxNearbyBlocksVerticalRange", "spawning", "max_nearby_blocks_vertical_range", INT(0)),
  f("maxVerticalSpace", "spawning", "max_vertical_space", INT(1)),
  f("spawningZoneDiameter", "spawning", "spawning_zone_diameter", INT(1)),
  f("spawningZoneHeight", "spawning", "spawning_zone_height", INT(1)),
  f("ticksBetweenSpawnAttempts", "spawning", "ticks_between_spawn_attempts", NUM(1)),
  f("minimumSpawningZoneDistanceFromPlayer", "spawning", "minimum_spawning_zone_distance_from_player", NUM(0)),
  f("maximumSpawningZoneDistanceFromPlayer", "spawning", "maximum_spawning_zone_distance_from_player", NUM(0)),
  f("maximumSpawnsPerPass", "spawning", "maximum_spawns_per_pass", INT(0)),
  f("savePokemonToWorld", "spawning", "save_pokemon_to_world"),
  f("pokemonPerChunk", "spawning", "pokemon_per_chunk", NUM(0)),
  f("pokeSnackPokemonPerChunk", "spawning", "poke_snack_pokemon_per_chunk", NUM(0)),
  f("shinyRate", "spawning", "shiny_rate", NUM(0)),
  f("teraTypeRate", "spawning", "tera_type_rate", NUM(0)),
  f("despawnerNearDistance", "spawning", "despawner_near_distance", NUM(0)),
  f("despawnerFarDistance", "spawning", "despawner_far_distance", NUM(0)),
  f("despawnerMinAgeTicks", "spawning", "despawner_min_age_ticks", INT(0)),
  f("despawnerMaxAgeTicks", "spawning", "despawner_max_age_ticks", INT(0)),
  f("monitorAlphaRate", "spawning", "data_monitor_alpha_rate", INT(0)),
  f("monitorShinyRate", "spawning", "data_monitor_shiny_rate", INT(0)),
  f("defaultFleeDistance", "battles", "default_flee_distance", NUM(1)),
  f("allowExperienceFromPvP", "battles", "allow_experience_from_pvp"),
  f("experienceShareMultiplier", "battles", "experience_share_multiplier", NUM(0)),
  f("awardExperienceToFaintedPokemon", "battles", "award_experience_to_fainted_pokemon"),
  f("awardExperienceOnBattleLoss", "battles", "award_experience_on_battle_loss"),
  f("luckyEggMultiplier", "battles", "lucky_egg_multiplier", NUM(0)),
  f("allowSpectating", "battles", "allow_spectating"),
  f("battleWildMaxDistance", "battles", "battle_wild_max_distance", NUM(1)),
  f("battlePvPMaxDistance", "battles", "battle_pvp_max_distance", NUM(1)),
  f("battleSpectateMaxDistance", "battles", "battle_spectate_max_distance", NUM(1)),
  f("infiniteHealerCharge", "healing", "infinite_healer_charge"),
  f("maxHealerCharge", "healing", "max_healer_charge", NUM(0)),
  f("secondsToChargeHealingMachine", "healing", "seconds_to_charge_healing_machine", NUM(0)),
  f("defaultFaintTimer", "healing", "default_faint_timer", INT(0)),
  f("faintAwakenHealthPercent", "healing", "faint_awaken_health_percent", NUM(0, 1)),
  f("healPercent", "healing", "heal_percent", NUM(0, 1)),
  f("healTimer", "healing", "heal_timer", INT(1)),
  f("appleLeftoversChance", "world", "apple_leftovers_chance", NUM(0, 1)),
  f("maxRootsInArea", "world", "max_roots_in_area", INT(0)),
  f("bigRootPropagationChance", "world", "big_root_propagation_chance", NUM(0, 1)),
  f("energyRootChance", "world", "energy_root_chance", NUM(0, 1)),
  f("defaultPasturedPokemonLimit", "world", "default_pastured_pokemon_limit", INT(0)),
  f("pastureBlockUpdateTicks", "world", "pasture_block_update_ticks", INT(1)),
  f("pastureMaxWanderDistance", "world", "pasture_max_wander_distance", INT(0)),
  f("pastureMaxPerChunk", "world", "pasture_max_per_chunk", NUM(0)),
  f("maxInsertedFossilItems", "world", "max_inserted_fossil_items", INT(0)),
  f("tradeMaxDistance", "world", "trade_max_distance", NUM(1)),
  f("maxPokedexScanningDetectionRange", "pokedex", "max_pokedex_scanning_detection_range", NUM(0)),
  f("hideUnimplementedPokemonInThePokedex", "pokedex", "hide_unimplemented_pokemon_in_the_pokedex"),
  f("allowStarterOnJoin", "starter", "allow_starter_on_join"),
  f("promptStarterOnceOnly", "starter", "prompt_starter_once_only"),
  f("partyHudEnabled", "interface", "party_hud_enabled"),
  f("partyHudDefaultOn", "interface", "party_hud_default_on"),
  f("infiniteRideStamina", "riding", "infinite_ride_stamina"),
  // Frente dados-ui: overlay de controles da montaria e Move Dex da Pokédex.
  f("displayControlSeconds", "riding", "display_controls_duration_seconds", NUM(0)),
  f("unlockAllMoveDexMovesByDefault", "pokedex", "unlock_all_move_dex_moves_by_default"),
];

/**
 * Campos mantidos só como dado (fora do editor): no Cobblemon 1.8.2 são de cliente ou de recursos que o Bedrock
 * não tem, então editar não teria efeito.
 * - `maxDynamaxLevel`: não há Dynamax no Cobblemon 1.8.2 jogável (nem no port);
 * - `enableDebugKeys`: teclas de depuração do cliente Java;
 * - `baseApricornTreeGenerationChance`: a geração de mundo das árvores de apricorn é fixada no importador (features);
 * - `walkingInBattleAnimations`: MoLang `do_effect_walks` das animações do cliente Java.
 * (`unlockAllMoveDexMovesByDefault` saiu daqui: o Move Dex da Pokédex existe desde a frente dados-ui.)
 */
export const INFO_ONLY_FIELDS: ConfigKey[] = [
  "maxDynamaxLevel", "enableDebugKeys", "baseApricornTreeGenerationChance", "walkingInBattleAnimations",
];

/** Versão do Cobblemon gravada com a config (CobblemonConfig.lastSavedVersion). */
export const CONFIG_VERSION = "1.8.2";

/**
 * `@LastChangedVersion` do CobblemonConfig.kt: se a config salva é de uma versão anterior à mudança do padrão, o
 * campo volta ao padrão novo (Cobblemon.loadConfig). Configs do port salvas antes deste campo contam como "0.0.1",
 * como no Cobblemon (defaultBoxCount 30 → 40; jogadores sem `boxcount` próprio ganham as caixas novas, nada é perdido).
 */
export const LAST_CHANGED_VERSION: Partial<Record<ConfigKey, string>> = {
  ambientPokemonCryTicks: "1.4.0",
  defaultBoxCount: "1.7.0",
  maxRootsInArea: "1.7.0",
  bigRootPropagationChance: "1.7.0",
};

/** Versão "a.b.c" posterior a outra (VersionUtils.isLaterVersion). */
export function isLaterVersion(version: string, than: string): boolean {
  const a = version.split(".").map(x => parseInt(x) || 0);
  const b = than.split(".").map(x => parseInt(x) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/**
 * Config salva → mesma config sem os campos cujo padrão mudou depois da versão em que ela foi salva
 * (`lastSavedVersion`; ausente = "0.0.1"). O parse depois preenche esses campos com o padrão novo.
 */
export function migrateConfigJson(json: unknown): unknown {
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); }
    catch { return json; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json;
  const input: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const lastSavedVersion = typeof input.lastSavedVersion === "string" ? input.lastSavedVersion : "0.0.1";
  for (const [key, changedIn] of Object.entries(LAST_CHANGED_VERSION)) {
    if (changedIn && isLaterVersion(changedIn, lastSavedVersion)) delete input[key];
  }
  return input;
}

/** Chaves antigas do port → chave atual. */
const LEGACY_KEYS: Record<string, ConfigKey> = {
  maxPokemonFriendShip: "maxPokemonFriendship",
  allowExperienceFromPVP: "allowExperienceFromPvP",
  maxNearbyBlocksVerticleRange: "maxNearbyBlocksVerticalRange",
};

export interface CobblemonConfig extends ConfigValues { }
/** Classe da config: os campos vêm de DEFAULT_CONFIG; os getters mantêm os nomes antigos funcionando. */
export class CobblemonConfig {
  constructor(values: Partial<ConfigValues> = {}) {
    Object.assign(this, structuredCloneSafe(DEFAULT_CONFIG), values);
  }
  /** @deprecated use maxPokemonFriendship */
  get maxPokemonFriendShip() { return this.maxPokemonFriendship; }
  /** @deprecated use allowExperienceFromPvP */
  get allowExperienceFromPVP() { return this.allowExperienceFromPvP; }
  /** @deprecated use maxNearbyBlocksVerticalRange */
  get maxNearbyBlocksVerticleRange() { return this.maxNearbyBlocksVerticalRange; }

  toJSON(): ConfigValues {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) out[key] = (this as any)[key];
    return out as ConfigValues;
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Converte o JSON salvo numa config válida: chaves antigas migradas, tipos conferidos contra o
 * padrão e números limitados às faixas do Cobblemon. Nunca lança; JSON inválido vira o padrão.
 */
export function parseConfig(json: unknown): CobblemonConfig {
  const config = new CobblemonConfig();
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); }
    catch { return config; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return config;
  const input: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    if (oldKey in input && !(newKey in input)) input[newKey] = input[oldKey];
    delete input[oldKey];
  }
  for (const key of Object.keys(DEFAULT_CONFIG) as ConfigKey[]) {
    if (!(key in input)) continue;
    const value = coerceConfigValue(key, input[key]);
    if (value !== undefined) (config as any)[key] = value;
  }
  return config;
}

/** Valida um valor para um campo. Retorna undefined se o tipo não bater. */
export function coerceConfigValue(key: ConfigKey, value: unknown): unknown {
  const fallback = DEFAULT_CONFIG[key];
  const spec = CONFIG_FIELDS.find(field => field.key === key);
  if (typeof fallback === "number") {
    if (typeof value === "string" && value.trim() === "") return undefined;
    const parsed = typeof value === "string" ? Number(value.trim().replace(",", ".")) : value;
    if (typeof parsed !== "number" || !Number.isFinite(parsed)) return undefined;
    let number: number = parsed;
    if (spec?.integer) number = Math.round(number);
    if (spec?.min !== undefined) number = Math.max(spec.min, number);
    if (spec?.max !== undefined) number = Math.min(spec.max, number);
    return number;
  }
  if (typeof fallback === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }
  if (typeof fallback === "string") {
    if (typeof value !== "string") return undefined;
    if (spec?.options && !spec.options.includes(value)) return undefined;
    return value;
  }
  if (Array.isArray(fallback)) {
    if (typeof value === "string")
      return value.split(",").map(x => x.trim()).filter(x => x.length > 0);
    if (!Array.isArray(value)) return undefined;
    if (key === "starters") return value.filter(isStarterCategory);
    return value.filter(x => typeof x === "string");
  }
  // Objetos (passiveStatuses): só aceita objeto simples.
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return undefined;
}

function isStarterCategory(value: unknown): value is StarterCategory {
  const category = value as StarterCategory;
  return !!category && typeof category.name === "string" && Array.isArray(category.pokemon)
    && category.pokemon.every(x => typeof x === "string");
}

let config = new CobblemonConfig();
let loaded = false;

/** Lê a config do mundo. Chamado no worldLoad; seguro chamar de novo (ex.: reload). */
export function loadConfig(): CobblemonConfig {
  config = parseConfig(migrateConfigJson(world.getDynamicProperty(CONFIG_PROPERTY)));
  loaded = true;
  saveConfig();
  return config;
}

function saveConfig() {
  world.setDynamicProperty(CONFIG_PROPERTY, JSON.stringify({ ...config.toJSON(), lastSavedVersion: CONFIG_VERSION }));
}

world.afterEvents.worldLoad.subscribe(() => {
  try { loadConfig(); }
  catch (e) { console.warn(`Config do Cobblemon inválida, usando padrão: ${e}`); }
  try { loadGameRules(); }
  catch (e) { console.warn(`Gamerules do Cobblemon inválidas, usando padrão: ${e}`); }
});

/** Config atual. Antes do worldLoad devolve os valores padrão. */
export function getConfig(): CobblemonConfig {
  return config;
}

/** Sondas de depuração por `/scriptevent` ligadas (config `enableDebugProbes`, padrão desligado). */
export function debugProbesEnabled(): boolean {
  try { return getConfig().enableDebugProbes === true; }
  catch { return false; }
}

/** True depois que a config do mundo foi lida. */
export function isConfigLoaded(): boolean {
  return loaded;
}

/** Troca a config inteira e salva no mundo. */
export function updateConfig(conf: CobblemonConfig | Partial<ConfigValues>) {
  config = conf instanceof CobblemonConfig ? conf : parseConfig({ ...config.toJSON(), ...conf });
  saveConfig();
}

/** @deprecated nome antigo (com erro de digitação) de updateConfig. */
export const updataConfig = updateConfig;

/** Altera um campo (com validação) e salva. Retorna false se o valor for inválido. */
export function setConfigValue(key: ConfigKey, value: unknown): boolean {
  const coerced = coerceConfigValue(key, value);
  if (coerced === undefined) return false;
  (config as any)[key] = coerced;
  saveConfig();
  return true;
}

/** Volta todos os campos ao padrão do Cobblemon. */
export function resetConfig() {
  config = new CobblemonConfig();
  saveConfig();
}

// ---------------------------------------------------------------------------------------------
// Gamerules (CobblemonGameRules.kt)
//
// Add-ons do Bedrock não registram gamerules; as 6 do Cobblemon ficam numa dynamic property de mundo própria
// (`cobblemon_gamerules`) e são lidas/alteradas por `/cobblemon:cobblemongamerule <regra> [valor]`, como `/gamerule`.

export const GAME_RULES_PROPERTY = "cobblemon_gamerules";

/** Padrões do Cobblemon 1.8.2. */
export const DEFAULT_GAME_RULES = {
  /** Spawn natural (ServerPlayerMixin); vale junto com `enableSpawning` da config. */
  doPokemonSpawning: true,
  /** Drops de Pokémon selvagem e de evolução (PokemonServerDelegate, Evolution.evolutionMethod). */
  doPokemonLoot: true,
  /** Jogador em batalha não leva dano (PlayerMixin). */
  battleInvulnerability: false,
  /** Mobs miram jogadores em batalha (TargetingConditionsMixin). */
  mobTargetInBattle: true,
  /** Iniciais shiny (CobbledStarterHandler). */
  doShinyStarters: false,
  /** Healing Machine cura também o PC (HealingMachineBlock). */
  healersHealPC: false,
};

export type GameRuleKey = keyof typeof DEFAULT_GAME_RULES;
export const GAME_RULE_KEYS = Object.keys(DEFAULT_GAME_RULES) as GameRuleKey[];

let gameRules: Record<GameRuleKey, boolean> = { ...DEFAULT_GAME_RULES };

/** JSON salvo → regras válidas (booleanos; o resto vira padrão). */
export function parseGameRules(json: unknown): Record<GameRuleKey, boolean> {
  const out = { ...DEFAULT_GAME_RULES };
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); }
    catch { return out; }
  }
  if (!raw || typeof raw !== "object") return out;
  for (const key of GAME_RULE_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function loadGameRules() {
  gameRules = parseGameRules(world.getDynamicProperty(GAME_RULES_PROPERTY));
}

/** Valor atual de uma gamerule do Cobblemon. */
export function getGameRule(key: GameRuleKey): boolean {
  return gameRules[key];
}

export function getGameRules(): Readonly<Record<GameRuleKey, boolean>> {
  return gameRules;
}

/** Nome de gamerule digitado (sem diferenciar maiúsculas) → chave, ou undefined. */
export function resolveGameRule(name: string): GameRuleKey | undefined {
  const lower = name.trim().toLowerCase();
  return GAME_RULE_KEYS.find(key => key.toLowerCase() === lower);
}

/** Muda e salva uma gamerule. */
export function setGameRule(key: GameRuleKey, value: boolean) {
  gameRules = { ...gameRules, [key]: value };
  try { world.setDynamicProperty(GAME_RULES_PROPERTY, JSON.stringify(gameRules)); }
  catch (e) { console.warn(`Não foi possível salvar as gamerules: ${e}`); }
}
