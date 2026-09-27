import type { Entity } from "@minecraft/server";
import { world } from "@minecraft/server";
import { AdditionalMoveDataManager, PokemonData, PersistentStatuses } from "./Pokemon";
import { Dex, toID } from "./showdown";
import { getFormByName, getSpeciesData, toSpeciesId } from "./speciesData";
import { tryRemoveNamespace } from "./utils";
import { MAX_EV_PER_STAT, MAX_IV, StatKey, toStatKey } from "./pokemon/Stats";
import { INT_FEATURES, ensureWeightedFeatureAspects, getIntFeature, setIntFeature, sharedFeatureAspects } from "./pokemon/SpeciesFeatures";
import { getFeatureProperty, setFeatureProperty } from "./pokemon/FeatureAssignments"; // frente dados-ia
import { MOVESET_BUILDERS } from "./pokemon/Learnset";
import { getConfig } from "./Config";

/**
 * Implementação de PokemonProperties do Cobblemon 1.8.2 (`api/pokemon/PokemonProperties.kt` + as
 * CustomPokemonProperty registradas em `Cobblemon.kt`): strings como "raichu alolan", "gender=female",
 * "bisharp held_item=cobblemon:kings_rock", "level=30 shiny" ou `nickname="Mr Bob"`.
 *
 * Chaves (as mesmas do Cobblemon, com os apelidos): `species`, `form`, `level|lvl|l`, `shiny|s`, `alpha|is_alpha`,
 * `gender` (ou `male`/`female`/`genderless` soltos), `friendship`, `fullness`, `pokeball`, `nature`, `ability`,
 * `status`, `nickname|nick`, `type|elemental_type`, `tera_type|tera`, `dmax_level|dmax`, `gmax_factor|gmax`,
 * `tradeable|tradable`, `originaltrainertype|ottype` (ou `none`/`player`/`npc` soltos), `originaltrainer|ot`,
 * `moves`, `moveset_builders|movesetbuilders|moveset_builder|movesetbuilder`, `helditem|held_item`,
 * `min_perfect_ivs`, `scale_modifier`, `<stat>_iv`, `<stat>_ev`, e as propriedades customizadas `uncatchable`,
 * `battleClone`, `label|tag`, `hiddenability|ha`, `aspect`, `unaspect`, `freeze_frame`, `no_ai`, `held_item_visible`.
 *
 * - O primeiro token sem "=" que for uma espécie conhecida vira `species` (ou `random`).
 * - Outros tokens sem "=" viram aspectos (as features de espécie do Cobblemon: "alolan", "hisuian"...).
 * - Chaves desconhecidas ficam em `extra` (features inteiras/escolha de espécie e extras do port).
 * - `no_ai` e `freeze_frame` só valem para a entidade (`applyToEntity`); no Pokémon não fazem nada e não batem.
 */
export type OriginalTrainerType = "none" | "player" | "npc";
const OT_TYPES: OriginalTrainerType[] = ["none", "player", "npc"];

/** Status persistentes aceitos por `status=` (nome do Cobblemon ou do Showdown → id do Showdown). */
const STATUS_NAMES: Record<string, string> = {
  burn: "brn", brn: "brn", freeze: "frz", frozen: "frz", frz: "frz", paralysis: "par", paralyze: "par", par: "par",
  poison: "psn", psn: "psn", poison_badly: "tox", badly_poisoned: "tox", tox: "tox", sleep: "slp", slp: "slp",
};

const ELEMENTAL_TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying",
  "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
/** TeraTypes: os 18 elementais + Stellar. */
const TERA_TYPES = [...ELEMENTAL_TYPES, "stellar"];

/** Aspectos derivados (não podem ser tirados por `unaspect`, como no Cobblemon). */
const DERIVED_ASPECTS = new Set(["shiny", "male", "female", "alpha"]);

export class PokemonProperties {
  originalString = "";
  species?: string;
  name?: string;
  /** Nome da forma (`form=alola`); comparado com o nome da forma sem diferenciar maiúsculas. */
  form?: string;
  shiny?: boolean;
  /** "m", "f" ou "" (sem gênero), como em PokemonData.gender. */
  gender?: string;
  level?: number;
  friendship?: number;
  fullness?: number;
  /** Propriedade `hiddenability`/`ha` do Cobblemon. */
  hiddenAbility?: boolean;
  /** `hp_iv=31`, `attack_ev=252` etc. (chaves do Showdown). */
  ivs: Partial<Record<StatKey, number>> = {};
  evs: Partial<Record<StatKey, number>> = {};
  minPerfectIvs?: number;
  pokeball?: string;
  nature?: string;
  ability?: string;
  /** Status persistente (id do Showdown: brn, frz, par, psn, tox, slp). */
  status?: string;
  heldItem?: string;
  /** Tokens soltos que não são espécie nem chave conhecida (features/formas: "alolan"...). */
  aspects: string[] = [];
  /** `aspect=x` (AspectPropertyType: vai para os forcedAspects). */
  forcedAspects: string[] = [];
  /** `unaspect=x` (UnaspectPropertyType: tira dos forcedAspects). */
  unaspects: string[] = [];
  /** `type=fire`: só na comparação (algum tipo do Pokémon). */
  type?: string;
  teraType?: string;
  dmaxLevel?: number;
  gmaxFactor?: boolean;
  isAlpha?: boolean;
  /** `tradeable=false` / `tradable=false` (Pokemon.tradeable). */
  tradeable?: boolean;
  originalTrainerType?: OriginalTrainerType;
  /** Nome (3–16 letras) ou UUID do OT. */
  originalTrainer?: string;
  /** `moves=a,b,c,d`: golpes que entram no moveset (ids Showdown). */
  moves?: string[];
  /** `moveset_builders=wild,alpha`: um sorteado monta o moveset. */
  movesetBuilders?: string[];
  scaleModifier?: number;
  /** `label=legendary` / `tag=...` (LabelProperty): só na comparação (rótulos da espécie). */
  labels: string[] = [];
  /** UncatchableProperty (`uncatchable` / `uncatchable=no`). */
  uncatchable?: boolean;
  /** BattleCloneProperty. */
  battleClone?: boolean;
  /** HeldItemVisibleProperty. */
  heldItemVisible?: boolean;
  /** NoAIProperty (só entidade). */
  noAi?: boolean;
  /** FreezeFrameProperty (só entidade; -1 = desliga). */
  freezeFrame?: number;
  extra: Record<string, string> = {};

  /** Nome antigo de `friendship`. */
  get happiness(): number | undefined {
    return this.friendship;
  }
  set happiness(value: number | undefined) {
    this.friendship = value;
  }

  static parse(input?: string): PokemonProperties {
    const props = new PokemonProperties();
    if (!input)
      return props;
    props.originalString = input;
    const config = safeConfig();
    for (const [key, value] of splitMap(input.trim())) {
      if (value === undefined) {
        parseBare(props, key);
        continue;
      }
      const lower = value.toLowerCase();
      switch (key) {
        case "species": {
          const id = lower.replace(/[^a-z0-9_:]/g, "");
          // Espécie inexistente fica como veio: a criação falha ("invalid-pokemon" dos comandos) em vez de sortear.
          if (id === "random") props.species = undefined;
          else if (id) props.species = toSpeciesId(id);
          break;
        }
        case "form": props.form = value; break;
        case "gender": {
          const gender = parseGender(lower);
          if (gender !== undefined) props.gender = gender;
          break;
        }
        case "shiny": case "s": props.shiny = parseBoolean(lower) ?? props.shiny; break;
        case "alpha": case "is_alpha": props.isAlpha = parseBoolean(lower) ?? props.isAlpha; break;
        case "level": case "lvl": case "l": {
          const level = parseNumber(value);
          if (level !== undefined) props.level = clamp(Math.trunc(level), 1, config.maxPokemonLevel);
          break;
        }
        case "friendship": {
          const friendship = parseNumber(value);
          if (friendship !== undefined) props.friendship = clamp(Math.trunc(friendship), 0, config.maxPokemonFriendship);
          break;
        }
        case "fullness": {
          const fullness = parseNumber(value);
          if (fullness !== undefined) props.fullness = Math.trunc(fullness);
          break;
        }
        case "hiddenability": case "ha": props.hiddenAbility = parseBoolean(lower) ?? props.hiddenAbility; break;
        // Guardado como veio ("master_ball" ou "cobblemon:master_ball"): o port aceita os dois; a comparação normaliza.
        case "pokeball": props.pokeball = lower; break;
        case "nature": props.nature = cleanId(value); break;
        case "ability": props.ability = cleanId(value); break;
        case "status": {
          const status = STATUS_NAMES[tryRemoveNamespace(lower)];
          if (status) props.status = status;
          break;
        }
        case "nickname": case "nick": if (value.trim()) props.name = value; break;
        case "type": case "elemental_type": if (ELEMENTAL_TYPES.includes(lower)) props.type = lower; break;
        case "tera_type": case "tera": {
          const tera = tryRemoveNamespace(lower);
          if (TERA_TYPES.includes(tera)) props.teraType = tera;
          break;
        }
        case "dmax_level": case "dmax": {
          const dmax = parseNumber(value);
          if (dmax !== undefined) props.dmaxLevel = clamp(Math.trunc(dmax), 0, config.maxDynamaxLevel);
          break;
        }
        case "gmax_factor": case "gmax": props.gmaxFactor = parseBoolean(lower) ?? props.gmaxFactor; break;
        case "tradeable": case "tradable": props.tradeable = parseBoolean(lower) ?? props.tradeable; break;
        case "originaltrainertype": case "ottype":
          if ((OT_TYPES as string[]).includes(lower)) props.originalTrainerType = lower as OriginalTrainerType;
          break;
        case "originaltrainer": case "ot":
          // parsePlayerProperty: nome de 3 a 16 caracteres ou UUID.
          if ((value.length >= 3 && value.length <= 16) || isUuid(value)) props.originalTrainer = value;
          break;
        case "moves": props.moves = value.split(",").map(move => toID(move)).filter(Boolean); break;
        case "moveset_builders": case "movesetbuilders": case "moveset_builder": case "movesetbuilder":
          props.movesetBuilders = lower.split(",").map(builder => tryRemoveNamespace(builder)).filter(Boolean);
          break;
        case "helditem": case "held_item": props.heldItem = value.includes(":") ? value : `minecraft:${value}`; break;
        case "min_perfect_ivs": {
          const count = parseNumber(value);
          if (count !== undefined) props.minPerfectIvs = clamp(Math.trunc(count), 0, 6);
          break;
        }
        case "scale_modifier": {
          const scale = parseNumber(value);
          if (scale !== undefined) props.scaleModifier = scale;
          break;
        }
        // CustomPokemonProperty registradas no Cobblemon.kt
        case "uncatchable": props.uncatchable = parseBoolean(lower) ?? props.uncatchable; break;
        case "battleclone": props.battleClone = parseBoolean(lower) ?? props.battleClone; break;
        case "label": case "tag": props.labels.push(lower); break;
        case "aspect": props.forcedAspects.push(value); break;
        case "unaspect": props.unaspects.push(value); break;
        case "no_ai": props.noAi = parseBoolean(lower) ?? props.noAi; break;
        case "freeze_frame": props.freezeFrame = parseNumber(value) ?? -1; break;
        case "held_item_visible": props.heldItemVisible = parseBoolean(lower) ?? props.heldItemVisible; break;
        default: {
          // hp_iv, attack_iv, special_defence_ev, ... (Stat em minúsculas + _iv/_ev)
          const statMatch = /^(.+)_(iv|ev)$/.exec(key);
          const stat = statMatch ? toStatKey(statMatch[1]) : undefined;
          const amount = parseNumber(value);
          if (statMatch && stat && amount !== undefined) {
            if (statMatch[2] === "iv") props.ivs[stat] = clamp(Math.trunc(amount), 0, MAX_IV);
            else props.evs[stat] = clamp(Math.trunc(amount), 0, MAX_EV_PER_STAT);
          }
          else props.extra[key] = value;
        }
      }
    }
    return props;
  }

  /** PokemonProperties.asString: texto canônico (vazio se nada foi definido). */
  asString(separator = " "): string {
    const pieces: string[] = [];
    if (this.species) pieces.push(this.species);
    if (this.name !== undefined) pieces.push(`nickname=${this.name}`);
    if (this.form !== undefined) pieces.push(`form=${this.form}`);
    if (this.level !== undefined) pieces.push(`level=${this.level}`);
    if (this.shiny !== undefined) pieces.push(`shiny=${this.shiny}`);
    if (this.gender !== undefined) pieces.push(`gender=${this.gender === "m" ? "male" : this.gender === "f" ? "female" : "genderless"}`);
    if (this.friendship !== undefined) pieces.push(`friendship=${this.friendship}`);
    if (this.fullness !== undefined) pieces.push(`fullness=${this.fullness}`);
    if (this.pokeball !== undefined) pieces.push(`pokeball=${this.pokeball}`);
    if (this.nature !== undefined) pieces.push(`nature=${this.nature}`);
    if (this.ability !== undefined) pieces.push(`ability=${this.ability}`);
    if (this.isAlpha !== undefined) pieces.push(`alpha=${this.isAlpha}`);
    if (this.status !== undefined) pieces.push(`status=${this.status}`);
    if (this.minPerfectIvs !== undefined) pieces.push(`min_perfect_ivs=${this.minPerfectIvs}`);
    for (const [stat, value] of Object.entries(this.ivs)) pieces.push(`${stat}_iv=${value}`);
    for (const [stat, value] of Object.entries(this.evs)) pieces.push(`${stat}_ev=${value}`);
    if (this.type !== undefined) pieces.push(`type=${this.type}`);
    if (this.teraType !== undefined) pieces.push(`tera_type=${this.teraType}`);
    if (this.dmaxLevel !== undefined) pieces.push(`dmax_level=${this.dmaxLevel}`);
    if (this.gmaxFactor !== undefined) pieces.push(`gmax_factor=${this.gmaxFactor}`);
    if (this.tradeable !== undefined) pieces.push(`tradeable=${this.tradeable}`);
    if (this.originalTrainerType !== undefined) pieces.push(`originaltrainertype=${this.originalTrainerType}`);
    if (this.originalTrainer !== undefined) pieces.push(`originaltrainer=${this.originalTrainer}`);
    if (this.uncatchable !== undefined) pieces.push(this.uncatchable ? "uncatchable" : "uncatchable=false");
    if (this.battleClone) pieces.push("battleClone");
    for (const label of this.labels) pieces.push(`label=${label}`);
    if (this.hiddenAbility !== undefined) pieces.push(`hiddenability=${this.hiddenAbility}`);
    for (const aspect of this.forcedAspects) pieces.push(`aspect=${aspect}`);
    for (const aspect of this.unaspects) pieces.push(`unaspect=${aspect}`);
    if (this.freezeFrame !== undefined) pieces.push(`freeze_frame=${this.freezeFrame}`);
    if (this.noAi !== undefined) pieces.push(`no_ai=${this.noAi}`);
    if (this.heldItemVisible !== undefined) pieces.push(`held_item_visible=${this.heldItemVisible}`);
    pieces.push(...this.aspects);
    if (this.moves) pieces.push(`moves=${this.moves.join(",")}`);
    if (this.movesetBuilders) pieces.push(`movesetbuilders=${this.movesetBuilders.join(",")}`);
    if (this.heldItem !== undefined) pieces.push(`helditem=${this.heldItem}`);
    if (this.scaleModifier !== undefined) pieces.push(`scale_modifier=${this.scaleModifier}`);
    return pieces.join(separator);
  }

  /**
   * Retorna uma cópia do Pokémon com estas propriedades aplicadas (usado na evolução, edição e criação).
   * Trocar espécie/forma segue os setters do Cobblemon: a habilidade fica no mesmo slot, golpes de troca
   * de forma são atualizados e o HP mantém a proporção.
   */
  apply(pokemon: PokemonData): PokemonData {
    const clone = PokemonData.getFromJson(JSON.stringify(pokemon));
    const previousSpecies = clone.species;
    const previousForm = clone.getFormData();
    clone.ensureAbilityCoordinates();
    if (this.species !== undefined && this.species !== toSpeciesId(clone.species)) {
      // Ao trocar de espécie, formas da espécie antiga deixam de valer; gênero e shiny continuam.
      clone.species = this.species;
      const shared = sharedFeatureAspects(clone.aspects, this.species);
      clone.aspects = clone.aspects.filter(aspect => ["shiny", "male", "female", "alpha"].includes(aspect) || shared.includes(aspect)
        || (clone.forcedAspects ?? []).includes(aspect));
      ensureWeightedFeatureAspects(clone);
    }
    if (this.form !== undefined) applyForm(clone, this.form);
    for (const aspect of this.aspects)
      if (!clone.aspects.includes(aspect)) clone.aspects.push(aspect);
    if (this.name !== undefined) clone.name = this.name;
    if (this.shiny !== undefined) {
      clone.shiny = this.shiny;
      clone.aspects = clone.aspects.filter(aspect => aspect !== "shiny").concat(this.shiny ? ["shiny"] : []);
    }
    if (this.gender !== undefined) {
      clone.gender = this.gender;
      clone.aspects = clone.aspects.filter(aspect => aspect !== "male" && aspect !== "female")
        .concat(this.gender === "m" ? ["male"] : this.gender === "f" ? ["female"] : []);
    }
    if (this.isAlpha !== undefined) {
      clone.aspects = clone.aspects.filter(aspect => aspect !== "alpha").concat(this.isAlpha ? ["alpha"] : []);
    }
    // Propriedades customizadas (aspect/unaspect vão para forcedAspects; features de espécie em `extra`).
    for (const aspect of this.forcedAspects) {
      clone.forcedAspects = [...new Set([...(clone.forcedAspects ?? []), aspect])];
      if (!clone.aspects.includes(aspect)) clone.aspects.push(aspect);
    }
    for (const aspect of this.unaspects) {
      clone.forcedAspects = (clone.forcedAspects ?? []).filter(x => x !== aspect);
      if (!DERIVED_ASPECTS.has(aspect)) clone.aspects = clone.aspects.filter(x => x !== aspect);
    }
    if (this.uncatchable !== undefined) {
      clone.aspects = clone.aspects.filter(aspect => aspect !== "uncatchable").concat(this.uncatchable ? ["uncatchable"] : []);
    }
    if (this.battleClone) clone.battleClone = true;
    if (this.heldItemVisible !== undefined) clone.heldItemVisible = this.heldItemVisible;
    clone.onFormChanged(previousForm, previousSpecies);
    if (this.level !== undefined) clone.setLevel(this.level);
    if (this.friendship !== undefined) clone.setFriendship(this.friendship);
    if (this.fullness !== undefined) clone.fullness = Math.max(0, this.fullness);
    if (this.pokeball !== undefined) clone.pokeball = this.pokeball;
    if (this.nature !== undefined) clone.nature = this.nature;
    for (const [key, value] of Object.entries(this.extra)) applyFeature(clone, key, value);
    if (this.ability !== undefined) clone.setAbility(this.ability);
    if (this.hiddenAbility === true) clone.giveHiddenAbility();
    else if (this.hiddenAbility === false && clone.hasHiddenAbility()) clone.rollAbility();
    if (this.status !== undefined && PersistentStatuses.includes(this.status)) {
      clone.status = this.status as PokemonData["status"];
      clone.statusTimer = undefined;
    }
    for (const [stat, value] of Object.entries(this.ivs)) clone.setIv(stat as StatKey, value!);
    if (this.minPerfectIvs !== undefined) {
      for (const stat of shuffled<StatKey>(["hp", "atk", "def", "spa", "spd", "spe"]).slice(0, this.minPerfectIvs)) clone.setIv(stat, MAX_IV);
    }
    for (const [stat, value] of Object.entries(this.evs)) clone.setEv(stat as StatKey, value!);
    if (this.teraType !== undefined) clone.teraType = this.teraType;
    if (this.dmaxLevel !== undefined) clone.dynamaxLevel = this.dmaxLevel;
    if (this.gmaxFactor !== undefined) clone.gigantamax = this.gmaxFactor;
    if (this.tradeable !== undefined) clone.tradeable = this.tradeable;
    applyOriginalTrainer(clone, this);
    if (this.moves?.length) applyMoves(clone, this.moves);
    if (this.movesetBuilders?.length) {
      const builders = this.movesetBuilders.filter(builder => MOVESET_BUILDERS[builder]);
      if (builders.length) clone.initializeMoveset(builders[Math.floor(Math.random() * builders.length)]);
    }
    if (this.scaleModifier !== undefined) clone.scaleModifier = this.scaleModifier;
    return clone;
  }

  /**
   * Propriedades que só existem na entidade (FreezeFrameProperty, NoAIProperty): `freeze_frame` fica numa dynamic
   * property (o cliente do Bedrock não congela a animação por script: sem efeito visual) e `no_ai` zera o
   * movimento da entidade e marca a tag `cobblemon_no_ai`.
   */
  applyToEntity(entity: Entity) {
    if (this.freezeFrame !== undefined) {
      try { entity.setDynamicProperty(FREEZE_FRAME_PROPERTY, this.freezeFrame); } catch { }
    }
    if (this.noAi !== undefined) setNoAi(entity, this.noAi);
  }

  /** Comparação com a entidade (as propriedades de entidade + as do Pokémon, se houver dados). */
  matchEntity(entity: Entity, pokemon?: PokemonData): boolean {
    if (this.freezeFrame !== undefined) {
      let current: unknown;
      try { current = entity.getDynamicProperty(FREEZE_FRAME_PROPERTY); } catch { }
      if ((typeof current === "number" ? current : -1) !== this.freezeFrame) return false;
    }
    if (this.noAi !== undefined && entity.hasTag(NO_AI_TAG) !== this.noAi) return false;
    return pokemon ? this.match(pokemon, true) : true;
  }

  /** Verdadeiro se o Pokémon tem todas as propriedades definidas aqui (PokemonProperties.matches). */
  match(pokemon: PokemonData, ignoreEntityOnly = false): boolean {
    // FreezeFrameProperty/NoAIProperty: o matcher de Pokémon (sem entidade) é sempre falso.
    if (!ignoreEntityOnly && (this.freezeFrame !== undefined || this.noAi !== undefined)) return false;
    if (this.level !== undefined && pokemon.level !== this.level) return false;
    if (this.shiny !== undefined && this.shiny !== (pokemon.shiny ?? false)) return false;
    if (this.gender !== undefined && this.gender !== pokemon.gender) return false;
    if (this.species !== undefined && this.species !== toSpeciesId(pokemon.species)) return false;
    if (this.name !== undefined && pokemon.name !== this.name) return false;
    if (this.form !== undefined && this.form.toLowerCase() !== formName(pokemon).toLowerCase()) return false;
    if (this.friendship !== undefined && pokemon.friendship !== this.friendship) return false;
    if (this.fullness !== undefined && (pokemon.fullness ?? 0) !== this.fullness) return false;
    if (this.pokeball !== undefined && normalizeBall(pokemon.pokeball) !== normalizeBall(this.pokeball)) return false;
    if (this.nature !== undefined && cleanId(pokemon.nature) !== this.nature) return false;
    if (this.ability !== undefined && cleanId(pokemon.ability) !== this.ability) return false;
    if (this.isAlpha !== undefined && pokemon.aspects.includes("alpha") !== this.isAlpha) return false;
    if (this.status !== undefined && pokemon.status !== this.status) return false;
    if (this.minPerfectIvs !== undefined && Object.values(pokemon.ivs).filter(iv => iv === MAX_IV).length < this.minPerfectIvs) return false;
    for (const [stat, value] of Object.entries(this.ivs)) if (pokemon.ivs[stat] !== value) return false;
    for (const [stat, value] of Object.entries(this.evs)) if (pokemon.evs[stat] !== value) return false;
    if (this.type !== undefined && !safeTypes(pokemon).includes(this.type)) return false;
    if (this.teraType !== undefined && (pokemon.teraType ?? "").toLowerCase() !== this.teraType) return false;
    if (this.dmaxLevel !== undefined && (pokemon.dynamaxLevel ?? 0) !== this.dmaxLevel) return false;
    if (this.gmaxFactor !== undefined && (pokemon.gigantamax ?? false) !== this.gmaxFactor) return false;
    if (this.tradeable !== undefined && (pokemon.tradeable ?? true) !== this.tradeable) return false;
    if (this.originalTrainer !== undefined && pokemon.ogTrainer !== this.originalTrainer && pokemon.ogTrainerId !== this.originalTrainer) return false;
    if (this.originalTrainerType !== undefined && originalTrainerTypeOf(pokemon) !== this.originalTrainerType) return false;
    if (this.moves?.some(move => !pokemon.moves.includes(Dex.moves.get(move).id))) return false;
    if (this.heldItem !== undefined && pokemon.minecraftItem !== this.heldItem) return false;
    if (this.scaleModifier !== undefined && (pokemon.scaleModifier ?? 1) !== this.scaleModifier) return false;
    if (this.hiddenAbility !== undefined && pokemon.hasHiddenAbility() !== this.hiddenAbility) return false;
    if (!this.aspects.every(aspect => pokemon.aspects.includes(aspect))) return false;
    if (!this.forcedAspects.every(aspect => pokemon.aspects.includes(aspect))) return false;
    if (this.unaspects.some(aspect => pokemon.aspects.includes(aspect))) return false;
    if (this.uncatchable !== undefined && pokemon.aspects.includes("uncatchable") !== this.uncatchable) return false;
    if (this.battleClone && !pokemon.battleClone) return false;
    if (this.heldItemVisible !== undefined && (pokemon.heldItemVisible ?? true) !== this.heldItemVisible) return false;
    if (this.labels.length && !this.labels.every(label => safeHasLabel(pokemon, label))) return false;
    for (const [key, value] of Object.entries(this.extra)) {
      const feature = speciesFeature(pokemon, key);
      if (feature === undefined || feature.toLowerCase() !== value.toLowerCase()) return false;
    }
    return true;
  }
}

export const FREEZE_FRAME_PROPERTY = "cobblemon:freeze_frame";
export const NO_AI_TAG = "cobblemon_no_ai";

/** NoAIProperty no Bedrock: movimento 0 (o motor não deixa desligar a IA por script) e a tag de marcação. */
export function setNoAi(entity: Entity, noAi: boolean) {
  try {
    const movement = entity.getComponent("minecraft:movement");
    if (noAi) {
      if (!entity.hasTag(NO_AI_TAG)) entity.setDynamicProperty("cobblemon:no_ai_speed", movement?.currentValue ?? 0);
      movement?.setCurrentValue(0);
      entity.addTag(NO_AI_TAG);
    }
    else if (entity.hasTag(NO_AI_TAG)) {
      const saved = entity.getDynamicProperty("cobblemon:no_ai_speed");
      if (typeof saved === "number") movement?.setCurrentValue(saved);
      else movement?.resetToDefaultValue();
      entity.removeTag(NO_AI_TAG);
    }
  }
  catch { /* entidade inválida */ }
}

/** String.splitMap do Cobblemon: pares chave/valor separados por espaço, valores entre aspas podem ter espaços. */
export function splitMap(input: string, delimiter = " ", assigner = "="): [string, string | undefined][] {
  const result: [string, string | undefined][] = [];
  let joiner: string | undefined;
  for (const argument of input.split(delimiter)) {
    if (joiner !== undefined && argument.endsWith("\"")) {
      joiner += `${delimiter}${argument.slice(0, -1)}`;
      const index = joiner.indexOf(assigner);
      result.push([(index === -1 ? joiner : joiner.slice(0, index)).toLowerCase(), index === -1 ? undefined : joiner.slice(index + 1)]);
      joiner = undefined;
    }
    else if (joiner === undefined) {
      if (!argument) continue;
      const index = argument.indexOf(assigner);
      if (index === -1) { result.push([argument.toLowerCase(), undefined]); continue; }
      const key = argument.slice(0, index).toLowerCase();
      const value = argument.slice(index + 1);
      if (value.startsWith("\"")) {
        if (value.length > 1 && value.endsWith("\"")) result.push([key, value.slice(1, -1)]);
        else joiner = `${key}${assigner}${value.slice(1)}`;
      }
      else result.push([key, value]);
    }
    else joiner += `${delimiter}${argument}`;
  }
  if (joiner !== undefined) {
    const index = joiner.indexOf(assigner);
    result.push([joiner.slice(0, index).toLowerCase(), joiner.slice(index + 1)]);
  }
  return result;
}

/** Token solto: espécie, gênero, tipo de OT, flags booleanas ou aspecto (feature de espécie). */
function parseBare(props: PokemonProperties, key: string) {
  const species = key.replace(/[^a-z0-9_:]/g, "");
  if (props.species === undefined && (key === "random" || getSpeciesData(species))) {
    props.species = key === "random" ? undefined : toSpeciesId(species);
    return;
  }
  switch (key) {
    case "shiny": case "s": props.shiny = true; return;
    case "alpha": case "is_alpha": props.isAlpha = true; return;
    case "hiddenability": case "ha": props.hiddenAbility = true; return;
    case "male": props.gender = "m"; return;
    case "female": props.gender = "f"; return;
    case "genderless": props.gender = ""; return;
    case "uncatchable": props.uncatchable = true; return;
    case "battleclone": props.battleClone = true; return;
    case "no_ai": props.noAi = true; return;
    case "held_item_visible": props.heldItemVisible = true; return;
    case "gmax_factor": case "gmax": props.gmaxFactor = true; return;
    case "tradeable": case "tradable": props.tradeable = true; return;
  }
  if ((OT_TYPES as string[]).includes(key)) { props.originalTrainerType = key as OriginalTrainerType; return; }
  props.aspects.push(key);
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  return undefined;
}

function parseGender(value: string): string | undefined {
  if (value === "male" || value === "m") return "m";
  if (value === "female" || value === "f") return "f";
  if (value === "genderless" || value === "none" || value === "") return "";
  return undefined;
}

function parseNumber(value: string): number | undefined {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function safeConfig(): { maxPokemonLevel: number; maxPokemonFriendship: number; maxDynamaxLevel: number } {
  try {
    const config = getConfig();
    return { maxPokemonLevel: config.maxPokemonLevel ?? 100, maxPokemonFriendship: config.maxPokemonFriendship ?? 255, maxDynamaxLevel: config.maxDynamaxLevel ?? 10 };
  }
  catch { return { maxPokemonLevel: 100, maxPokemonFriendship: 255, maxDynamaxLevel: 10 }; }
}

function safeTypes(pokemon: PokemonData): string[] {
  try { return pokemon.getTypes().map(type => String(type).toLowerCase()); }
  catch { return []; }
}

function safeHasLabel(pokemon: PokemonData, label: string): boolean {
  try { return pokemon.hasLabels(label); }
  catch { return false; }
}

function formName(pokemon: PokemonData): string {
  try { return pokemon.getFormName(); }
  catch { return "Normal"; }
}

function normalizeBall(ball: string | undefined): string {
  const id = (ball ?? "cobblemon:poke_ball").toLowerCase();
  return id.includes(":") ? id : `cobblemon:${id}`;
}

/** `form=`: troca os aspectos de forma pelos da forma pedida (formOnlyShowdownId ou nome). */
function applyForm(pokemon: PokemonData, form: string) {
  const species = getSpeciesData(pokemon.species);
  if (!species) return;
  const wanted = form.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = (species.forms ?? []).find(f => f.name.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted) ?? getFormByName(species, form);
  const formAspects = new Set((species.forms ?? []).flatMap(f => f.aspects ?? []));
  pokemon.aspects = pokemon.aspects.filter(aspect => !formAspects.has(aspect)).concat(target?.aspects ?? []);
}

/** Tipo de OT (ausente = PLAYER quando há nome, como os saves antigos do port). */
export function originalTrainerTypeOf(pokemon: PokemonData): OriginalTrainerType {
  return pokemon.ogTrainerType ?? (pokemon.ogTrainer ? "player" : "none");
}

/**
 * originaltrainertype/originaltrainer: NONE limpa o OT; PLAYER aceita nome ou UUID (o port guarda o nome e,
 * se o jogador estiver online, o id); NPC guarda o nome como veio.
 */
function applyOriginalTrainer(pokemon: PokemonData, props: PokemonProperties) {
  let ot = props.originalTrainer;
  if (props.originalTrainerType === "none") {
    pokemon.ogTrainer = undefined;
    pokemon.ogTrainerId = undefined;
    pokemon.ogTrainerType = "none";
    ot = undefined;
  }
  if (ot === undefined) {
    if (props.originalTrainerType && props.originalTrainerType !== "none") pokemon.ogTrainerType = props.originalTrainerType;
    return;
  }
  const type = props.originalTrainerType ?? (pokemon.ogTrainerType && pokemon.ogTrainerType !== "none" ? pokemon.ogTrainerType : "player");
  pokemon.ogTrainerType = type;
  if (type === "npc") {
    pokemon.ogTrainer = ot;
    pokemon.ogTrainerId = undefined;
    return;
  }
  let online: { name: string; id: string } | undefined;
  try {
    const players = world.getPlayers();
    online = Array.isArray(players) ? players.find(player => player.name === ot || player.id === ot) : undefined;
  } catch { }
  pokemon.ogTrainer = online?.name ?? ot;
  pokemon.ogTrainerId = online?.id ?? (isUuid(ot) ? ot : undefined);
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * PokemonProperties.apply (`moves`): os golpes pedidos entram em espaços sorteados que ainda não têm um deles
 * (PP cheio); golpes que o Pokémon já tem ficam onde estão.
 */
function applyMoves(pokemon: PokemonData, moves: string[]) {
  if (pokemon.moves.length === 0) pokemon.initializeMoveset();
  const templates = shuffled([...new Set(moves.map(move => Dex.moves.get(move)).filter(move => move.exists).map(move => move.id))]);
  const replaceable = shuffled([0, 1, 2, 3].filter(i => !(templates as string[]).includes(pokemon.moves[i])));
  const insertable = templates.filter(move => !pokemon.moves.includes(move));
  const count = Math.min(replaceable.length, insertable.length);
  const length = pokemon.moves.length;
  for (let k = 0; k < count; k++) {
    const move = insertable[k];
    const info = AdditionalMoveDataManager.create(Dex.moves.get(move).pp);
    // Sem buracos no moveset: espaço vazio (índice ≥ tamanho original) vira o próximo livre no fim.
    if (replaceable[k] < length) {
      pokemon.moves[replaceable[k]] = move;
      pokemon.movesInfo[replaceable[k]] = info;
    }
    else {
      pokemon.moves.push(move);
      pokemon.movesInfo.push(info);
    }
  }
}

/**
 * Features de espécie com escolha fixa por Pokémon (no Cobblemon são sorteadas ao criar o Pokémon).
 * Aqui a escolha é derivada do UUID, então é estável sem precisar salvar nada.
 * Features não suportadas (ex.: moedas do Gimmighoul) retornam undefined e não batem.
 */
const CHOICE_FEATURES: Record<string, string[]> = {
  cocoon_species: ["silcoon", "cascoon"],
};

/**
 * Features de escolha que viram aspect (`isAspect` + `aspectFormat` em `data/cobblemon/species_features`), usadas em
 * resultados de evolução do Cobblemon 1.8.2 (Gimmighoul → Gholdengo com cobertura de netherite).
 */
const ASPECT_CHOICE_FEATURES: Record<string, { format: string; choices: string[] }> = {
  netherite_coating: {
    format: "netherite-coating-{{choice}}",
    choices: ["none", "stage1", "stage2", "stage3", "stage4", "stage5", "stage6", "stage7", "full"],
  },
};

/** ChoiceSpeciesFeature.apply / IntSpeciesFeature.apply para uma chave de `extra`. */
function applyFeature(pokemon: PokemonData, key: string, value: string) {
  const choice = ASPECT_CHOICE_FEATURES[key];
  if (choice) {
    const picked = value.toLowerCase();
    if (!choice.choices.includes(picked)) return;
    const all = choice.choices.map(c => choice.format.replace("{{choice}}", c));
    pokemon.aspects = pokemon.aspects.filter(aspect => !all.includes(aspect)).concat([choice.format.replace("{{choice}}", picked)]);
    return;
  }
  if (INT_FEATURES[key]) {
    const number = parseInt(value);
    if (!isNaN(number)) setIntFeature(pokemon, key, number);
    return;
  }
  // Frente dados-ia: qualquer feature de aspect da espécie (species_features/assignments), ex.: "cream=ruby".
  setFeatureProperty(pokemon, key, value);
}

function speciesFeature(pokemon: PokemonData, key: string): string | undefined {
  // Features inteiras guardadas no Pokémon (IntSpeciesFeature.matches compara o valor).
  if (INT_FEATURES[key]) {
    const value = getIntFeature(pokemon, key);
    return value === undefined ? undefined : String(value);
  }
  const aspectChoice = ASPECT_CHOICE_FEATURES[key];
  if (aspectChoice) {
    const prefix = aspectChoice.format.replace("{{choice}}", "");
    const aspect = pokemon.aspects.find(a => a.startsWith(prefix));
    return aspect ? aspect.slice(prefix.length) : aspectChoice.choices[0];
  }
  // Frente dados-ia: feature de aspect da espécie guardada nos aspects (species_feature_assignments).
  const generic = getFeatureProperty(pokemon, key);
  if (generic !== undefined) return generic;
  const choices = CHOICE_FEATURES[key];
  if (!choices) return undefined;
  let hash = 0;
  for (const char of pokemon.uuid) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return choices[Math.abs(hash) % choices.length];
}

function cleanId(value: string): string {
  return toID(tryRemoveNamespace(value));
}
