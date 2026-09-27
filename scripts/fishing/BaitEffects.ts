/**
 * Iscas do Cobblemon 1.8.2: registro de efeitos (api/fishing/SpawnBaitEffects.kt, SpawnBait.kt,
 * SpawnBaitUtils.kt) e a influência de spawn que os aplica (api/spawning/influence/SpawnBaitInfluence.kt +
 * FishingSpawnCause.kt).
 *
 * Tudo aqui é lógica pura sobre SpawnEntry/PokemonData: nada toca no mundo, então os testes rodam no Node.
 */
import type { Entity } from "@minecraft/server";
import type { SpawnEntry } from "../../generated/scripts/spawns";
import { getConfig } from "../Config";
import type { PokemonData } from "../Pokemon";
import { Dex } from "../showdown";
import { getFormForAspects, getSpeciesData, StatSet } from "../speciesData";
import type { SpawnAction, SpawnInfluence } from "../spawning/SpawnSelector";
import { SPAWN_BAITS } from "./baitData";
import { addPotentialMarks, FISHING_MARK } from "../pokemon/Marks";

/** Um efeito de isca (SpawnBait.Effect). `type`/`sub` sem namespace ("bite_time", "atk", "water_1"...). */
export interface BaitEffect {
  type: string;
  sub?: string;
  /** Chance (0–1) de o efeito valer. */
  chance: number;
  value?: number;
}

/** Tipos de efeito (SpawnBait.Effects). */
export const BaitEffectTypes = {
  NATURE: "nature",
  IV: "iv",
  EV: "ev",
  BITE_TIME: "bite_time",
  GENDER_CHANCE: "gender_chance",
  LEVEL_RAISE: "level_raise",
  TYPING: "typing",
  EGG_GROUP: "egg_group",
  SHINY_REROLL: "shiny_reroll",
  MARK_CHANCE: "mark_chance",
  DROPS_REROLL: "drops_reroll",
  HIDDEN_ABILITY_CHANCE: "ha_chance",
  ALPHA_CHANCE: "alpha_chance",
  POKEMON_CHANCE: "pokemon_chance",
  FRIENDSHIP: "friendship",
  RARITY_BUCKET: "rarity_bucket",
  SIZE: "size",
} as const;

/** Aspect que a pesca põe no Pokémon (FishingSpawnCause.FISHED_ASPECT; a Lure Ball procura por ele). */
export const FISHED_ASPECT = "fished";
/** FishingSpawnCause.DROPS_REROLL_ASPECT. */
export const DROPS_REROLL_ASPECT = "drops_reroll";

// ---------------------------------------------------------------------------------------------
// Registro

/** Item → ids de registro das iscas que valem para ele. */
let byItem: Map<string, string[]> | undefined;
/** Efeitos extras registrados em tempo de execução (temperos da culinária, iscas de outras frentes). */
const extra = new Map<string, { item?: string; effects: BaitEffect[] }>();

function index(): Map<string, string[]> {
  if (byItem) return byItem;
  byItem = new Map();
  const add = (id: string, item: string | undefined) => {
    if (!item) return;
    let list = byItem!.get(item);
    if (!list) byItem!.set(item, list = []);
    if (!list.includes(id)) list.push(id);
  };
  for (const [id, def] of Object.entries(SPAWN_BAITS)) add(id, def.item);
  for (const [id, def] of extra) add(id, def.item);
  return byItem;
}

/**
 * Registra uma isca extra (ex.: tempero `seasonings:oran_berry` da frente de culinária, ou um item de isca novo).
 * `item` omitido: só pode ser referenciada por id (componente BAIT_EFFECTS de uma Poké Bait / Poké Snack).
 */
export function registerSpawnBait(id: string, effects: BaitEffect[], item?: string) {
  extra.set(id, { item, effects });
  byItem = undefined;
}

/** SpawnBaitEffects.getFromIdentifier. */
export function getBaitById(id: string): BaitEffect[] | undefined {
  return extra.get(id)?.effects ?? SPAWN_BAITS[id]?.effects;
}

/** SpawnBaitEffects.isFishingBait: o item aparece em algum registro de isca (mesmo sem efeitos, ex.: Poké Bait). */
export function isFishingBait(itemId: string | undefined): boolean {
  return !!itemId && index().has(itemId);
}

/**
 * SpawnBaitEffects.getEffectsFromItemStack: efeitos dos ids do componente BAIT_EFFECTS (`componentIds`)
 * + os do próprio item.
 */
export function effectsForItem(itemId: string | undefined, componentIds: readonly string[] = []): BaitEffect[] {
  const out: BaitEffect[] = [];
  for (const id of componentIds) out.push(...(getBaitById(id) ?? []));
  if (itemId) for (const id of index().get(itemId) ?? []) out.push(...(getBaitById(id) ?? []));
  return out;
}

/** SpawnBaitUtils.mergeEffects: soma chance (máx. 1) e valor (arredondado para cima) por tipo+subcategoria. */
export function mergeEffects(effects: readonly BaitEffect[]): BaitEffect[] {
  const groups = new Map<string, BaitEffect[]>();
  for (const e of effects) {
    const key = `${e.type}|${e.sub ?? ""}`;
    let list = groups.get(key);
    if (!list) groups.set(key, list = []);
    list.push(e);
  }
  const out: BaitEffect[] = [];
  for (const list of groups.values()) {
    const chance = Math.min(1, list.reduce((a, e) => a + e.chance, 0));
    const value = Math.ceil(list.reduce((a, e) => a + (e.value ?? 0), 0));
    out.push({ type: list[0].type, sub: list[0].sub, chance, value });
  }
  return out;
}

/** Soma dos `rarity_bucket` (stackedLureTier do bobber e do Poké Snack). */
export function rarityTier(effects: readonly BaitEffect[]): number {
  return Math.trunc(effects.filter(e => e.type === BaitEffectTypes.RARITY_BUCKET).reduce((a, e) => a + (e.value ?? 0), 0));
}

function randomOf<T>(list: readonly T[], random: () => number): T | undefined {
  return list.length ? list[Math.floor(random() * list.length)] : undefined;
}

/**
 * PokeRodFishingBobberEntity.alterBiteTimeAttempt: um efeito bite_time ao acaso; se passar na chance, tira
 * `value` × espera (mínimo 1). Sem efeito de bite_time, devolve a espera.
 */
export function alterBiteTime(waitCountdown: number, effects: readonly BaitEffect[], random: () => number = Math.random): number {
  const effect = randomOf(effects.filter(e => e.type === BaitEffectTypes.BITE_TIME), random);
  if (!effect) return waitCountdown;
  if (random() > effect.chance) return waitCountdown;
  const reduced = waitCountdown - waitCountdown * (effect.value ?? 0);
  return reduced <= 0 ? 1 : Math.trunc(reduced);
}

/** Chance padrão (em 100) de fisgar um Pokémon em vez de item (pokemonSpawnChance). */
export const POKEMON_SPAWN_CHANCE = 85;

/** PokeRodFishingBobberEntity.getPokemonSpawnChance: pokemon_chance da isca (chance × 100) ou 85. */
export function pokemonSpawnChance(effects: readonly BaitEffect[], random: () => number = Math.random): number {
  const effect = randomOf(effects.filter(e => e.type === BaitEffectTypes.POKEMON_CHANCE), random);
  if (!effect) return POKEMON_SPAWN_CHANCE;
  return effect.chance >= 0 && effect.chance <= 100 ? Math.trunc(effect.chance * 100) : POKEMON_SPAWN_CHANCE;
}

// ---------------------------------------------------------------------------------------------
// Atributos

type ShowdownStat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
const STAT_ALIASES: Record<string, ShowdownStat> = {
  hp: "hp", atk: "atk", attack: "atk", def: "def", defense: "def", defence: "def", spa: "spa", special_attack: "spa",
  spd: "spd", special_defence: "spd", special_defense: "spd", spe: "spe", speed: "spe",
};
const EV_KEYS: Record<ShowdownStat, keyof StatSet> = {
  hp: "hp", atk: "attack", def: "defence", spa: "special_attack", spd: "special_defence", spe: "speed",
};

/** Stats.getStat (aceita "atk", "attack", "cobblemon:spd"...). */
export function statOf(key: string | undefined): ShowdownStat | undefined {
  if (!key) return undefined;
  return STAT_ALIASES[key.replace(/^[a-z_]+:/, "").toLowerCase()];
}

// ---------------------------------------------------------------------------------------------
// Efeitos no Pokémon (FishingSpawnCause.alter*Attempt). Aplicados nos dados antes da entidade existir.

function setGender(pokemon: PokemonData, gender: "m" | "f") {
  pokemon.gender = gender;
  pokemon.aspects = pokemon.aspects.filter(a => a !== "male" && a !== "female");
  pokemon.aspects.push(gender === "m" ? "male" : "female");
}

/** Aspects e marca do Alfa (mesmos do spawner: `alpha` + `alpha_eyes` da mark_alpha). */
const ALPHA_ASPECTS = ["alpha", "alpha_eyes"];
const ALPHA_MARK = "cobblemon:mark_alpha";

/** Efeitos de isca por tipo (SpawnBait.Effects.setupEffects). Tipos sem função (EV, typing...) só mexem no peso. */
export const BAIT_EFFECT_FUNCTIONS: Record<string, (pokemon: PokemonData, effect: BaitEffect, random: () => number) => void> = {
  // alterNatureAttempt: natureza que aumenta o atributo, se a atual já não for uma delas.
  [BaitEffectTypes.NATURE]: (pokemon, effect, random) => {
    const stat = statOf(effect.sub);
    if (!stat) return;
    const possible = Dex.natures.all().filter(n => n.plus === stat);
    if (possible.length === 0 || possible.some(n => n.name === pokemon.nature)) return;
    pokemon.nature = randomOf(possible, random)!.name;
  },
  // alterIVAttempt: IV + value, no máximo 31.
  [BaitEffectTypes.IV]: (pokemon, effect) => {
    const stat = statOf(effect.sub);
    if (!stat) return;
    pokemon.ivs[stat] = Math.min(31, (pokemon.ivs[stat] ?? 0) + Math.trunc(effect.value ?? 0));
    pokemon.updateMaxHP?.();
    pokemon.currentHealth = pokemon.maxHealth;
  },
  // shinyReroll: nextInt(0, shinyRate + 1) <= value.
  [BaitEffectTypes.SHINY_REROLL]: (pokemon, effect, random) => {
    if (pokemon.shiny) return;
    const odds = Math.trunc(getConfig().shinyRate);
    if (odds <= 0) return;
    if (Math.floor(random() * (odds + 1)) <= Math.trunc(effect.value ?? 0)) {
      pokemon.shiny = true;
      if (!pokemon.aspects.includes("shiny")) pokemon.aspects.unshift("shiny");
    }
  },
  // alterMarksAttempt: no Cobblemon só vale na captura (marcas vêm depois); sem efeito no spawn.
  [BaitEffectTypes.MARK_CHANCE]: () => { },
  // saveDropsReroll: aspect forçado drops_reroll.
  [BaitEffectTypes.DROPS_REROLL]: (pokemon) => {
    if (!pokemon.aspects.includes(DROPS_REROLL_ASPECT)) pokemon.aspects.push(DROPS_REROLL_ASPECT);
  },
  // alterGenderAttempt: só em espécies com os dois gêneros.
  [BaitEffectTypes.GENDER_CHANCE]: (pokemon, effect) => {
    const ratio = pokemon.getMaleRatio();
    if (!(ratio > 0 && ratio < 1)) return;
    const sub = effect.sub?.replace(/^[a-z_]+:/, "");
    if (sub === "male" && pokemon.gender !== "m") setGender(pokemon, "m");
    else if (sub === "female" && pokemon.gender !== "f") setGender(pokemon, "f");
  },
  // alterLevelAttempt: nível + value, no máximo maxPokemonLevel.
  [BaitEffectTypes.LEVEL_RAISE]: (pokemon, effect) => {
    const level = Math.min(getConfig().maxPokemonLevel, pokemon.level + Math.trunc(effect.value ?? 0));
    pokemon.setLevel(level);
    pokemon.currentHealth = pokemon.maxHealth;
  },
  // alterHAAttempt: habilidade oculta da forma, se houver.
  [BaitEffectTypes.HIDDEN_ABILITY_CHANCE]: (pokemon) => { pokemon.giveHiddenAbility(); },
  // alterAlphaAttempt: vira Alfa (aspects, marca, moveset "alpha"); a entidade recebe a escala em affectEntity.
  [BaitEffectTypes.ALPHA_CHANCE]: (pokemon) => {
    if (pokemon.aspects.includes("alpha")) return;
    for (const a of ALPHA_ASPECTS) if (!pokemon.aspects.includes(a)) pokemon.aspects.push(a);
    if (!pokemon.marks.includes(ALPHA_MARK)) pokemon.marks.push(ALPHA_MARK);
    pokemon.activeMark = ALPHA_MARK;
    pokemon.initializeMoveset("alpha");
  },
  // alterFriendshipAttempt: amizade + value, no máximo maxPokemonFriendship.
  [BaitEffectTypes.FRIENDSHIP]: (pokemon, effect) => {
    pokemon.setFriendship(Math.min(pokemon.getMaxFriendship(), pokemon.friendship + Math.trunc(effect.value ?? 0)));
  },
  // alterSize: scaleModifier += value / 1000. O port não tem escala por Pokémon (sem efeito).
  [BaitEffectTypes.SIZE]: () => { },
};

/**
 * SpawnBaitInfluence.affectSpawn: efeitos mesclados; cada um vale com `random() <= chance`.
 * @returns Os tipos de efeito que valeram.
 */
export function applyBaitEffects(pokemon: PokemonData, effects: readonly BaitEffect[], random: () => number = Math.random): string[] {
  const used: string[] = [];
  for (const effect of mergeEffects(effects)) {
    if (random() <= effect.chance) {
      const fn = BAIT_EFFECT_FUNCTIONS[effect.type];
      used.push(effect.type);
      fn?.(pokemon, effect, random);
    }
  }
  return used;
}

/**
 * SpawnBaitInfluence.affectWeight: EV (zera quem não rende o EV), tipo (× value) e grupo de ovo (× value).
 * Herds (PokemonHerdSpawnDetail) não são afetados, como no Cobblemon.
 */
export function baitWeight(entry: Pick<SpawnEntry, "species" | "aspects" | "herd">, weight: number, effects: readonly BaitEffect[]): number {
  const merged = mergeEffects(effects);
  const has = (type: string) => merged.some(e => e.type === type);
  if (!has(BaitEffectTypes.EV) && !has(BaitEffectTypes.TYPING) && !has(BaitEffectTypes.EGG_GROUP)) return weight;
  if (entry.herd) return weight;
  const species = getSpeciesData(entry.species);
  if (!species) return weight;
  const form = getFormForAspects(species, entry.aspects ?? []);
  let newWeight = weight;

  if (has(BaitEffectTypes.EV)) {
    const stat = statOf(effects.find(e => e.type === BaitEffectTypes.EV)?.sub);
    if (stat) {
      const yieldValue = (form?.evYield ?? species.evYield)?.[EV_KEYS[stat]] ?? 0;
      if (yieldValue <= 0) newWeight = 0;
    }
  }
  if (newWeight > 0 && has(BaitEffectTypes.TYPING)) {
    const effect = effects.find(e => e.type === BaitEffectTypes.TYPING);
    const type = effect?.sub?.replace(/^[a-z_]+:/, "").toLowerCase();
    if (effect && type) {
      const primary = String(form?.primaryType ?? species.primaryType).toLowerCase();
      const secondary = form ? form.secondaryType : species.secondaryType;
      const types = [primary, ...(secondary ? [String(secondary).toLowerCase()] : [])];
      if (types.includes(type)) newWeight *= effect.value ?? 1;
    }
  }
  if (newWeight > 0 && has(BaitEffectTypes.EGG_GROUP)) {
    const groups = (form?.eggGroups ?? species.eggGroups ?? []).map(g => g.toLowerCase());
    const match = effects.find(e => e.type === BaitEffectTypes.EGG_GROUP && !!e.sub && groups.includes(e.sub.replace(/^[a-z_]+:/, "").toLowerCase()));
    if (match) newWeight *= match.value ?? 1;
  }
  return newWeight;
}

/** Aplica a escala/tag de Alfa na entidade criada (o spawner só faz isso quando a entrada já é Alfa). */
export function markAlphaEntity(entity: Entity) {
  try {
    if (!entity.hasTag("cobblemon_alpha")) entity.addTag("cobblemon_alpha");
    if (entity.getProperty("cobblemon:alpha") === false) entity.triggerEvent("cobblemon:set_alpha");
  }
  catch { /* entidade sem suporte a Alfa */ }
}

export interface BaitInfluenceOptions {
  /** Pesca: aspect/tag `fished` (FishingSpawnCause.affectSpawn). */
  fished?: boolean;
  /** Aspect extra (ex.: poke_snack_crumbed). */
  aspect?: string;
  /** Chamado quando algum efeito vale (SpawnBaitInfluence.onUsed). */
  onUsed?: (action: SpawnAction, used: string[]) => void;
  random?: () => number;
}

/**
 * SpawnBaitInfluence (+ FishingSpawnCause quando `fished`): peso por EV/tipo/grupo de ovo e efeitos no Pokémon
 * gerado. Use em `chooseFishingSpawn(..., { influences })` e `spawnActionEntity(action, [influence])`.
 */
export function baitInfluence(effects: readonly BaitEffect[], options: BaitInfluenceOptions = {}): SpawnInfluence {
  const random = options.random ?? Math.random;
  const alphaActions = new WeakSet<SpawnAction>();
  return {
    affectWeight(entry, _ctx, weight) {
      return effects.length ? baitWeight(entry, weight, effects) : weight;
    },
    affectPokemon(action, pokemon) {
      if (options.fished && !pokemon.aspects.includes(FISHED_ASPECT)) pokemon.aspects.push(FISHED_ASPECT);
      // bobber_spawn_pokemon_post/apply_marks.molang: marca de pesca em potencial (sorteada na captura).
      if (options.fished) addPotentialMarks(pokemon, FISHING_MARK);
      if (options.aspect && !pokemon.aspects.includes(options.aspect)) pokemon.aspects.push(options.aspect);
      const wasAlpha = pokemon.aspects.includes("alpha");
      const used = effects.length ? applyBaitEffects(pokemon, effects, random) : [];
      if (!wasAlpha && pokemon.aspects.includes("alpha")) alphaActions.add(action);
      if (used.length) options.onUsed?.(action, used);
    },
    affectEntity(action, entity) {
      if (options.fished) {
        try { entity.addTag(FISHED_ASPECT); }
        catch { /* entidade inválida */ }
      }
      if (alphaActions.has(action) || action.alpha) markAlphaEntity(entity);
    },
  };
}
