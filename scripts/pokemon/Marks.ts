/**
 * Marcas em potencial (Cobblemon 1.8.2: Pokemon.potentialMarks / addPotentialMark / applyPotentialMarks e os
 * callbacks `pokemon_entity_spawn/apply_potential_marks.molang`, `pokemon_entity_spawn/apply_marks.molang`,
 * `bobber_spawn_pokemon_post/apply_marks.molang` e `pokemon_captured/apply_marks.molang`).
 *
 * O spawn junta as marcas possíveis (clima, hora, raras, personalidade); a captura sorteia no máximo uma.
 * Tudo aqui é lógica pura sobre `PokemonData` (sem API do Minecraft), testável no Node.
 */

/** Chance e grupo de cada marca sorteável (data/cobblemon/marks/*.json; marcas sem `chance` valem 0). */
export const MARK_CHANCES: Readonly<Record<string, { chance: number; group?: string }>> = {
  "cobblemon:mark_fishing": { chance: 0.04 },
  "cobblemon:mark_partner": { chance: 0.01 },
  "cobblemon:mark_revival": { chance: 0.04 },
  "cobblemon:mark_rare": { chance: 0.001, group: "rare" },
  "cobblemon:mark_uncommon": { chance: 0.02, group: "uncommon" },
  "cobblemon:mark_time_dawn": { chance: 0.02, group: "time" },
  "cobblemon:mark_time_dusk": { chance: 0.02, group: "time" },
  "cobblemon:mark_time_lunchtime": { chance: 0.02, group: "time" },
  "cobblemon:mark_time_sleepy-time": { chance: 0.02, group: "time" },
  "cobblemon:mark_weather_blizzard": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_cloudy": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_dry": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_misty": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_rainy": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_sandstorm": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_snowy": { chance: 0.02, group: "weather" },
  "cobblemon:mark_weather_stormy": { chance: 0.02, group: "weather" },
};

/** Marcas de personalidade (todas com chance 0,01, grupo "personality"). */
export const PERSONALITY_MARKS: readonly string[] = [
  "absent-minded", "angry", "calmness", "charismatic", "crafty", "excited", "ferocious", "flustered", "jittery",
  "joyful", "intellectual", "intense", "kindly", "scowling", "rowdy", "peeved", "pumped-up", "smiley", "teary",
  "upbeat", "zoned-out", "humble", "prideful", "slump", "thorny", "unsure", "vigor", "zero_energy",
].map(name => `cobblemon:mark_personality_${name}`);

function markInfo(mark: string): { chance: number; group?: string } {
  if (mark.startsWith("cobblemon:mark_personality_")) return { chance: 0.01, group: "personality" };
  return MARK_CHANCES[mark] ?? { chance: 0 };
}

/** O que precisa existir no Pokémon para as marcas (subconjunto de PokemonData). */
export interface MarkHolder {
  marks: string[];
  activeMark?: string;
  potentialMarks?: string[];
}

/** Pokemon.addPotentialMark (conjunto: sem repetição, ordem de inserção). */
export function addPotentialMarks(pokemon: MarkHolder, ...marks: string[]) {
  const set = pokemon.potentialMarks ?? (pokemon.potentialMarks = []);
  for (const mark of marks) if (!set.includes(mark)) set.push(mark);
}

/** Pokemon.exchangeMark(mark, give = true): dá a marca (sem repetir), tirando as que ela substitui (`replace`). */
export function giveMark(pokemon: MarkHolder, mark: string) {
  for (const replaced of MARK_REPLACES[mark] ?? []) takeMark(pokemon, replaced);
  if (!pokemon.marks.includes(mark)) pokemon.marks.push(mark);
}

/** Pokemon.exchangeMark(mark, give = false): tira a marca (e a ativa, se for ela). */
export function takeMark(pokemon: MarkHolder, mark: string) {
  pokemon.marks = pokemon.marks.filter(x => x !== mark);
  if (pokemon.activeMark === mark) pokemon.activeMark = undefined;
}

/**
 * Pokemon.applyPotentialMarks: sorteia no máximo uma marca entre as potenciais que o Pokémon ainda não tem e
 * limpa a lista. Grupos (`group` ou a chance como texto) em ordem crescente de chance; cada grupo tem uma
 * tentativa `random·100 / chance < probabilidade·100`. Como no Kotlin (`toSortedMap(compareBy { chance })`),
 * grupos com a mesma chance ocupam a mesma chave e o último inserido vence: com `mark_uncommon` presente
 * (sempre, no spawn), os grupos `time`/`weather` (também 0,02) não são sorteados no 1.8.2.
 * @returns true se uma marca foi dada.
 */
export function applyPotentialMarks(pokemon: MarkHolder, chance = 1, random: () => number = Math.random): boolean {
  const potentials = (pokemon.potentialMarks ?? []).filter(mark => !pokemon.marks.includes(mark));
  if (potentials.length === 0) return false;
  // groupBy (LinkedHashMap) e depois TreeMap por chance: a mesma chance substitui o valor.
  const grouped = new Map<string, { chance: number; marks: string[] }>();
  for (const mark of potentials) {
    const info = markInfo(mark);
    const key = info.group ?? String(info.chance);
    const group = grouped.get(key) ?? { chance: info.chance, marks: [] };
    group.marks.push(mark);
    grouped.set(key, group);
  }
  const byChance = new Map<number, string[]>();
  for (const { chance: c, marks } of grouped.values()) byChance.set(c, marks);
  let selected: string | undefined;
  for (const c of [...byChance.keys()].sort((a, b) => a - b)) {
    const probability = Math.min(1, Math.max(0, c)) * 100;
    if (random() * 100 / chance < probability) {
      const group = byChance.get(c)!;
      selected = group[Math.floor(random() * group.length)];
      break;
    }
  }
  pokemon.potentialMarks = [];
  if (selected === undefined) return false;
  giveMark(pokemon, selected);
  return true;
}

/** Situação do mundo no ponto do spawn (lida pelo spawner). */
export interface SpawnMarkContext {
  overworld: boolean;
  y: number;
  /** world.getTimeOfDay() (0..23999). */
  timeOfDay: number;
  raining: boolean;
  thundering: boolean;
  /** Bioma (id Bedrock sem namespace) pertence à tag, ex.: "cobblemon:is_sandy". */
  biomeIs: (tag: string) => boolean;
}

/**
 * Marcas potenciais de `pokemon_entity_spawn/apply_potential_marks.molang`. As tags vanilla sem equivalente
 * no Bedrock (`minecraft:snow_golem_melts`, `minecraft:increased_fire_burnout`) são pedidas a `biomeIs` com o
 * mesmo nome; neve = chuva num bioma `cobblemon:is_freezing` (o Bedrock não expõe `is_snowing_at`).
 */
export function spawnPotentialMarks(ctx: SpawnMarkContext): string[] {
  const out: string[] = [];
  const freezing = ctx.biomeIs("cobblemon:is_freezing");
  const sandy = ctx.biomeIs("cobblemon:is_sandy");
  const snowing = ctx.raining && freezing;
  const t = ctx.timeOfDay;
  if (!freezing && !sandy && ctx.raining && !ctx.thundering) out.push("cobblemon:mark_weather_rainy");
  if (!freezing && !sandy && ctx.raining && ctx.thundering) out.push("cobblemon:mark_weather_stormy");
  if (ctx.overworld && ctx.y > 191) out.push("cobblemon:mark_weather_cloudy");
  if (ctx.biomeIs("minecraft:increased_fire_burnout")) out.push("cobblemon:mark_weather_misty");
  if ((ctx.biomeIs("minecraft:snow_golem_melts") || ctx.biomeIs("cobblemon:is_arid")) && !ctx.raining && t >= 6000 && t <= 12000)
    out.push("cobblemon:mark_weather_dry");
  if (sandy && (ctx.raining || ctx.thundering)) out.push("cobblemon:mark_weather_sandstorm");
  if (snowing && !ctx.thundering) out.push("cobblemon:mark_weather_snowy");
  if (snowing && ctx.thundering) out.push("cobblemon:mark_weather_blizzard");
  if (ctx.overworld && ((t >= 22300 && t <= 23999) || (t >= 0 && t <= 5999))) out.push("cobblemon:mark_time_dawn");
  if (ctx.overworld && t >= 6000 && t <= 11833) out.push("cobblemon:mark_time_lunchtime");
  if (ctx.overworld && t >= 11834 && t <= 13701) out.push("cobblemon:mark_time_dusk");
  if (ctx.overworld && t >= 13702 && t <= 22299) out.push("cobblemon:mark_time_sleepy-time");
  out.push("cobblemon:mark_rare", "cobblemon:mark_uncommon", ...PERSONALITY_MARKS);
  return out;
}

/** Biomas Bedrock das tags vanilla usadas pelo script de marcas (sem tag gerada pelo importador). */
export const VANILLA_MARK_BIOME_TAGS: Readonly<Record<string, readonly string[]>> = {
  // minecraft:snow_golem_melts (Java 1.21.1): badlands, desert, savanna e variantes, e o Nether.
  "minecraft:snow_golem_melts": [
    "desert", "desert_hills", "desert_mutated", "mesa", "mesa_bryce", "mesa_plateau", "mesa_plateau_mutated",
    "mesa_plateau_stone", "mesa_plateau_stone_mutated", "savanna", "savanna_mutated", "savanna_plateau",
    "savanna_plateau_mutated", "hell", "crimson_forest", "warped_forest", "soulsand_valley", "basalt_deltas",
  ],
  // minecraft:increased_fire_burnout: bamboo jungle, mushroom fields, mangrove swamp, snowy slopes, picos, swamp, jungle.
  "minecraft:increased_fire_burnout": [
    "bamboo_jungle", "bamboo_jungle_hills", "mushroom_island", "mushroom_island_shore", "mangrove_swamp",
    "snowy_slopes", "frozen_peaks", "jagged_peaks", "swampland", "swampland_mutated", "jungle", "jungle_hills",
    "jungle_edge", "jungle_mutated", "jungle_edge_mutated",
  ],
};

/**
 * Marcas dadas direto no spawn (`pokemon_entity_spawn/apply_marks.molang`): categoria de tamanho XS (sem ser Alfa)
 * → Mini; XL ou Alfa → Jumbo. Sem categoria (chamadas antigas), só o Alfa conta.
 */
export function spawnGivenMarks(alpha: boolean, sizeCategory?: string): string[] {
  if (sizeCategory === "XS" && !alpha) return ["cobblemon:mark_mini"];
  if (sizeCategory === "XL" || alpha) return ["cobblemon:mark_jumbo"];
  return [];
}

/** Marca potencial da pesca (`bobber_spawn_pokemon_post/apply_marks.molang`). */
export const FISHING_MARK = "cobblemon:mark_fishing";

// ---------------------------------------------------------------------------------------------
// Todas as marcas (data/cobblemon/marks, 168 arquivos) — para `giveallmarks` e validação de ids.

const PERSONALITY = ["absent-minded", "angry", "calmness", "charismatic", "crafty", "excited", "ferocious", "flustered",
  "humble", "intellectual", "intense", "jittery", "joyful", "kindly", "peeved", "prideful", "pumped-up", "rowdy", "scowling",
  "slump", "smiley", "teary", "thorny", "unsure", "upbeat", "vigor", "zero_energy", "zoned-out"];
const CONTEST = (region: string) => ["beauty", "cool", "cute", "smart", "tough"].flatMap(kind => [1, 2, 3, 4].map(n => `contest_${region}_${kind}_${n}`));

/** Ids de todas as marcas e fitas do Cobblemon 1.8.2 (ordem alfabética dos arquivos). */
export const ALL_MARKS: readonly string[] = [
  "mark_alpha", "mark_curry", "mark_destiny", "mark_fishing", "mark_gourmand", "mark_itemfinder", "mark_jumbo",
  "mark_mightiest", "mark_mini", "mark_partner", ...PERSONALITY.map(p => `mark_personality_${p}`), "mark_rare",
  "mark_revival", "mark_time_dawn", "mark_time_dusk", "mark_time_lunchtime", "mark_time_sleepy-time", "mark_titan",
  "mark_uncommon", ...["blizzard", "cloudy", "dry", "misty", "rainy", "sandstorm", "snowy", "stormy"].map(w => `mark_weather_${w}`),
  ...[
    "ability", "ability_double", "ability_great", "ability_multi", "ability_pair", "ability_world", "artist",
    "battle_royal_master", "battle_tower_master", "battle_tree_great", "battle_tree_master", "battle_victory",
    "battle_winning", "battler_expert", "battler_skillful", "best_friends", "champion", "champion_alola",
    "champion_galar", "champion_hoenn", "champion_kalos", "champion_paldea", "champion_sinnoh", ...CONTEST("hoenn"),
    ...CONTEST("sinnoh"), "contest_super_master_beauty", "contest_super_master_cleverness", "contest_super_master_coolness",
    "contest_super_master_cuteness", "contest_super_master_toughness", "contest_super_star", "contest_super_star_twinkling",
    "day_alert", "day_careless", "day_downcast", "day_relax", "day_shock", "day_smile", "day_snooze", "effort", "event",
    "event_birthday", "event_champion_battle", "event_champion_national", "event_champion_regional", "event_champion_world",
    "event_classic", "event_color_blue", "event_color_green", "event_color_red", "event_country", "event_earth",
    "event_mystery_zone_land", "event_mystery_zone_marine", "event_mystery_zone_sky", "event_national", "event_premier",
    "event_souvenir", "event_special", "event_wishing", "event_world", "footprint", "hisui", "legend", "master_rank",
    "memory_battle", "memory_battle_gold", "memory_contest", "memory_contest_gold", "once-in-a-lifetime", "partner",
    "record", "syndicate_gorgeous", "syndicate_gorgeous_royal", "syndicate_royal", "training",
  ].map(r => `ribbon_${r}`),
].map(id => `cobblemon:${id}`);

/** Campo `replace` das marcas (a de ouro substitui a comum). */
export const MARK_REPLACES: Readonly<Record<string, readonly string[]>> = {
  "cobblemon:ribbon_memory_battle_gold": ["cobblemon:ribbon_memory_battle"],
  "cobblemon:ribbon_memory_contest_gold": ["cobblemon:ribbon_memory_contest"],
};

/** Normaliza um id digitado (`mark_rare`, `cobblemon:Mark_Rare`) e diz se a marca existe. */
export function resolveMarkId(input: string): string | undefined {
  const id = input.trim().toLowerCase();
  const full = id.includes(":") ? id : `cobblemon:${id}`;
  return ALL_MARKS.includes(full) ? full : undefined;
}

/** MarkGiveAllCommand: `pokemon.marks = Marks.all()` (a marca ativa continua, já que continua obtida). */
export function giveAllMarks(pokemon: MarkHolder) {
  pokemon.marks = [...ALL_MARKS];
}

// ---------------------------------------------------------------------------------------------
// Marca de parceiro (`callbacks/player_tick_pre/partner_mark.molang`)

/** A cada 10 s de jogo; 10 000 blocos percorridos; amizade ≥ 200; chance da marca (0,01). */
export const PARTNER_MARK = {
  mark: "cobblemon:mark_partner",
  ticksBetweenChecks: 20 * 10,
  stepsRequired: 10000,
  friendshipRequired: 200,
} as const;

/**
 * Uma checagem do partner_mark.molang: se o total de blocos percorridos cruzou um múltiplo de 10 000 desde a última
 * checagem, cada Pokémon do time com amizade ≥ 200 tenta a marca (add_marks_with_chance: `random·100 < chance·100`).
 * @returns os Pokémon que ganharam a marca.
 */
export function partnerMarkCheck<T extends MarkHolder & { friendship: number }>(
  totalBlocks: number, lastCheck: number, party: readonly (T | null | undefined)[], random: () => number = Math.random,
): T[] {
  const winners: T[] = [];
  if (Math.floor(totalBlocks / PARTNER_MARK.stepsRequired) <= Math.floor(lastCheck / PARTNER_MARK.stepsRequired)) return winners;
  const probability = Math.min(1, Math.max(0, markInfo(PARTNER_MARK.mark).chance)) * 100;
  for (const pokemon of party) {
    if (!pokemon || pokemon.friendship < PARTNER_MARK.friendshipRequired) continue;
    if (random() * 100 < probability) {
      giveMark(pokemon, PARTNER_MARK.mark);
      winners.push(pokemon);
    }
  }
  return winners;
}

// ---------------------------------------------------------------------------------------------
// Fóssil revivido (`callbacks/fossil_revived/apply_marks.molang`)

/** Marcas potenciais do fóssil: raras, personalidade e Revival; sorteadas na hora se houver jogador. */
export const FOSSIL_POTENTIAL_MARKS: readonly string[] = [
  "cobblemon:mark_rare", "cobblemon:mark_uncommon", ...PERSONALITY_MARKS, "cobblemon:mark_revival",
];

/** Aplica o callback do fóssil. @returns true se uma marca foi dada. */
export function applyFossilMarks(pokemon: MarkHolder, hasPlayer: boolean, random: () => number = Math.random): boolean {
  addPotentialMarks(pokemon, ...FOSSIL_POTENTIAL_MARKS);
  return hasPlayer ? applyPotentialMarks(pokemon, 1, random) : false;
}
