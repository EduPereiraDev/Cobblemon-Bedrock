/**
 * `q.pokemon` completo (PokemonMoLangFunctions.kt + SpeciesMoLangFunctions.kt do Cobblemon 1.8.2) sobre o
 * `PokemonData` do port, e o struct da entidade de Pokémon (PokemonEntityMoLangFunctions.kt).
 *
 * Funções que mudam o Pokémon (apply, add_aspects, marcas, IV/EV, golpes, evolução...) gravam de volta no time do
 * dono e na entidade em campo (`persist`), como o `onChange` do Java.
 *
 * Structs indexados do Java (`moveset`, `tm_learnset`, `egg_groups`, `labels`...) são QueryStruct com funções "0",
 * "1"...; aqui viram arrays (`q.pokemon.moveset[0]`, `for_each`, `length`), que o interpretador sabe percorrer.
 *
 * Sem equivalente no Bedrock:
 * - `behaviour`/`behavior`: devolve os dados de comportamento da forma como struct de campos (sem as funções do
 *   FormPokemonBehaviour do Java);
 * - `drops[i].can_drop(...)`: sem contexto de drop no MoLang (sempre 1);
 * - `level_learnset`: struct `nível → [golpes]` (no Java a lista de MoveTemplate não é um valor MoLang).
 */
import { ItemStack } from "@minecraft/server";
import type { Entity } from "@minecraft/server";
import { MoArray, MoStruct, MoValue, asNumber, asString } from "../npc/molang/MoLang";
import type { PokemonData } from "../Pokemon";
import { PokemonProperties } from "../PokemonProperties";
import { getSpeciesData, toSpeciesId, type SpeciesData } from "../speciesData";
import { COBBLEMON_TO_SHOWDOWN_STAT, MAX_IV, STAT_KEYS, StatKey, toStatKey } from "../pokemon/Stats";
import { MOVESET_BUILDERS, getLevelUpMovesUpTo } from "../pokemon/Learnset";
import { MARK_CHANCES, addPotentialMarks, applyPotentialMarks, giveMark, resolveMarkId, takeMark } from "../pokemon/Marks";
import { feedPokemon, getFullness, getMaxFullness } from "../pokemon/Fullness";
import { RIDING_STATS, addRideBoosts, getRideBoost, isRidingStat, setRideBoost } from "../pokemon/RideStats";
import { getSafeTeam } from "../pokemonStorage";
import { resolveVariant } from "../../generated/scripts/variants";
import { toID } from "../showdown";
import { argBool, argInt, createMoveStruct, withNamespace } from "./GeneralFunctions";
import { createItemStackStruct } from "./ItemStackStruct";
import { structHooks } from "./StructHooks";

// q.pokemon para quem não pode importar este módulo (requisitos de evolução; ver StructHooks.ts).
structHooks.pokemon = pokemon => createPokemonStruct(pokemon);

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); }
  catch { return fallback; }
}

// ---------------------------------------------------------------------------------------------
// Espécie (SpeciesMoLangFunctions)

/** Species.struct: identifier, name, tipos, grupo de EXP, tamanho, hitbox, catch_rate e labels. */
export function createSpeciesStruct(speciesId: string, data: SpeciesData | undefined = getSpeciesData(speciesId)): MoStruct {
  const id = toSpeciesId(speciesId);
  const labels = () => data?.labels ?? [];
  return new MoStruct({}, {
    identifier: () => `cobblemon:${id}`,
    name: () => data?.name ?? id,
    primary_type: () => String(data?.primaryType ?? "normal").toLowerCase(),
    secondary_type: () => (data?.secondaryType ? String(data.secondaryType).toLowerCase() : "null"),
    experience_group: () => data?.experienceGroup ?? "",
    height: () => data?.height ?? 0,
    weight: () => data?.weight ?? 0,
    base_scale: () => data?.baseScale ?? 1,
    hitbox_width: () => data?.hitbox?.width ?? 0,
    hitbox_height: () => data?.hitbox?.height ?? 0,
    hitbox_fixed: () => (data?.hitbox?.fixed ? 1 : 0),
    catch_rate: () => data?.catchRate ?? 0,
    labels: () => new MoArray(labels().slice()),
    has_label: args => (labels().includes(asString(args[0])) ? 1 : 0),
  }, data);
}

// ---------------------------------------------------------------------------------------------
// Utilitários

/** Stats.getStat (aceita "hp", "attack", "special_defence", "spa"...) só dos atributos permanentes. */
function permanentStat(value: MoValue | undefined): StatKey | undefined {
  return toStatKey(asString(value).replace(/^cobblemon:/, ""));
}

/** Struct `hp/atk/def/spa/spd/spe` (showdownId dos atributos permanentes). */
function statStruct(read: (stat: StatKey) => number): MoStruct {
  const struct = new MoStruct();
  for (const stat of STAT_KEYS) struct.fn(stat, () => read(stat));
  return struct;
}

/** Marks.getByIdentifier(asIdentifierDefaultingNamespace). */
function markId(value: MoValue): string | undefined {
  return resolveMarkId(withNamespace(asString(value)));
}

function genderName(gender: string): string {
  return gender === "m" ? "MALE" : gender === "f" ? "FEMALE" : "GENDERLESS";
}

/** Todas as origens de golpe da forma (Learnset.getAllLegalMoves + legado). */
function allLearnsetMoves(pokemon: PokemonData, includeLegacy: boolean): string[] {
  const learnset = pokemon.getLearnset();
  const moves = new Set<string>();
  for (const list of learnset.levelUpMoves.values()) list.forEach(m => moves.add(m));
  for (const list of [learnset.tmMoves, learnset.eggMoves, learnset.tutorMoves, learnset.specialMoves, learnset.formChangeMoves]) list.forEach(m => moves.add(m));
  if (includeLegacy) learnset.legacyMoves.forEach(m => moves.add(m));
  return [...moves];
}

function moveArray(moves: readonly string[]): MoArray {
  return new MoArray(moves.map(m => createMoveStruct(m)).filter((m): m is MoStruct => !!m));
}

/** Pokemon.updateAspects depois de mudar os forcedAspects: aspectos, variante e troca de forma. */
function updateAspects(pokemon: PokemonData, add: readonly string[], remove: readonly string[]) {
  const previousForm = pokemon.getFormData();
  const forced = new Set(pokemon.forcedAspects ?? []);
  add.forEach(a => forced.add(a));
  remove.forEach(a => forced.delete(a));
  pokemon.forcedAspects = [...forced];
  pokemon.aspects = pokemon.aspects.filter(a => !remove.includes(a));
  for (const aspect of add) if (!pokemon.aspects.includes(aspect)) pokemon.aspects.push(aspect);
  pokemon.variant = resolveVariant(toSpeciesId(pokemon.species), pokemon.aspects);
  pokemon.onFormChanged(previousForm);
}

// ---------------------------------------------------------------------------------------------
// q.pokemon

export interface PokemonStructOptions {
  /** Chamado depois de cada mudança (padrão: grava no time do dono e na entidade em campo). */
  onChange?: (pokemon: PokemonData) => void;
}

/**
 * `Pokemon.struct` do Cobblemon sobre um PokemonData.
 * @param entity Entidade em campo, se conhecida (evita procurar por `tryGetPokemonOut`).
 */
export function createPokemonStruct(pokemon: PokemonData, entity?: Entity, options: PokemonStructOptions = {}): MoStruct {
  const entityOf = () => (entity && safe(() => entity!.isValid, false) ? entity : safe(() => pokemon.tryGetPokemonOut(), undefined));
  const persist = () => {
    if (options.onChange) { options.onChange(pokemon); return; }
    safe(() => pokemon.tryUpdatePokemonInTeam(), false);
    const out = entity && safe(() => entity!.isValid, false) ? entity : undefined;
    if (out) safe(() => pokemon.applyToCobblemon(out), undefined);
  };
  /** Troca o conteúdo do PokemonData (apply/forceEvolve devolvem uma cópia). */
  const replaceWith = (next: PokemonData) => {
    if (next !== pokemon) Object.assign(pokemon, next);
  };
  const form = () => pokemon.getFormData();
  const species = () => safe(() => pokemon.getSpeciesData(), undefined as SpeciesData | undefined);

  const struct = new MoStruct({}, {}, pokemon);
  struct
    .set("is_pokemon", 1)
    .fn("id", () => pokemon.uuid)
    .fn("uuid", () => pokemon.uuid)
    .fn("nickname", () => pokemon.name ?? "")
    .fn("level", () => pokemon.level)
    .fn("max_hp", () => pokemon.maxHealth)
    .fn("current_hp", () => pokemon.currentHealth)
    .fn("friendship", () => pokemon.friendship)
    .fn("max_fullness", () => getMaxFullness(pokemon))
    .fn("fullness", () => getFullness(pokemon))
    .fn("lose_fullness", args => {
      pokemon.fullness = Math.max(0, getFullness(pokemon) - Math.trunc(asNumber(args[0])));
      persist();
      return 1;
    })
    .fn("feed_pokemon", args => {
      const result = feedPokemon(pokemon, Math.trunc(asNumber(args[0])));
      const out = argBool(args, 1, true) ? entityOf() : undefined;
      if (out) safe(() => out.dimension.playSound(result.sound, out.location, { pitch: result.pitch }), undefined);
      persist();
      return 1;
    })
    .fn("behaviour", () => MoStruct.fromJSON(form()?.behaviour ?? species()?.behaviour))
    .fn("behavior", () => MoStruct.fromJSON(form()?.behaviour ?? species()?.behaviour))
    .fn("pokeball", () => withNamespace(pokemon.pokeball ?? "poke_ball"))
    .fn("ability", () => toID(pokemon.ability))
    .fn("has_learned", args => (pokemon.getAccessibleMoves().includes(toID(asString(args[0]))) ? 1 : 0))
    .fn("moveset", () => new MoArray(pokemon.moves.map((move, i) => {
      const info = pokemon.movesInfo[i];
      return createMoveStruct(move, info?.maxPp, info?.pp);
    }).filter((m): m is MoStruct => !!m)))
    .fn("evs", () => statStruct(stat => pokemon.evs[stat] ?? 0))
    .fn("ivs", () => statStruct(stat => pokemon.ivs[stat] ?? 0))
    .fn("hyper_trained_ivs", () => statStruct(stat => pokemon.hyperTrainedIvs?.[stat] ?? -1))
    .fn("ride_boosts", () => {
      const boosts = new MoStruct();
      for (const stat of RIDING_STATS) boosts.fn(stat.toLowerCase(), () => getRideBoost(pokemon, stat));
      return boosts;
    })
    .fn("natdex_number", () => species()?.nationalPokedexNumber ?? 0)
    .fn("types", () => new MoArray(pokemon.getTypes().map(t => String(t).toLowerCase())))
    .fn("gender_ratio", () => pokemon.getMaleRatio())
    .fn("ev_yield", () => {
      const yieldTable = pokemon.getEvYield();
      return statStruct(stat => yieldTable[stat] ?? 0);
    })
    .fn("base_stats", () => {
      const base = pokemon.getBaseStats() as unknown as Record<string, number>;
      const table: Partial<Record<StatKey, number>> = {};
      for (const [key, value] of Object.entries(base)) {
        const stat = COBBLEMON_TO_SHOWDOWN_STAT[key];
        if (stat) table[stat] = value;
      }
      return statStruct(stat => table[stat] ?? 0);
    })
    .fn("catch_rate", () => pokemon.getCatchRate())
    .fn("base_experience_yield", () => pokemon.getBaseExperienceYield())
    .fn("drops", () => {
      const entries = (form()?.drops ?? species()?.drops)?.entries ?? [];
      return new MoArray(entries.map(entry => new MoStruct({ item: entry.item }, {
        percentage: () => entry.percentage ?? 100,
        quantity: () => 1,
        max_selectable_times: () => 1,
        // Sem contexto de drop (jogador/entidade) no MoLang do port.
        can_drop: () => 1,
      }, entry)));
    })
    .fn("tm_learnset", () => moveArray(pokemon.getLearnset().tmMoves))
    .fn("egg_learnset", () => moveArray(pokemon.getLearnset().eggMoves))
    .fn("tutor_learnset", () => moveArray(pokemon.getLearnset().tutorMoves))
    .fn("level_learnset", () => {
      const byLevel = new MoStruct();
      for (const [level, moves] of pokemon.getLearnset().levelUpMoves) byLevel.set(String(level), new MoArray(moves.slice()));
      return byLevel;
    })
    .fn("ability_pool", () => new MoArray(pokemon.getAbilityEntries().map(a => toID(a.replace(/^h:/, "")))))
    .fn("egg_groups", () => new MoArray((form()?.eggGroups ?? species()?.eggGroups ?? []).slice()))
    .fn("egg_cycles", () => form()?.eggCycles ?? species()?.eggCycles ?? 0)
    .fn("labels", () => new MoArray(pokemon.getLabels().slice()))
    .fn("aspects", () => new MoArray(pokemon.aspects.slice()))
    .fn("has_aspect", args => (pokemon.aspects.includes(asString(args[0])) ? 1 : 0))
    .fn("form_aspects", () => new MoArray((form()?.aspects ?? []).slice()))
    .fn("form_name", () => pokemon.getFormName())
    .fn("form", () => pokemon.getFormName())
    .fn("pre_evolution", () => {
      const pre = form()?.preEvolution ?? species()?.preEvolution;
      return pre && getSpeciesData(pre) ? createSpeciesStruct(pre) : 0;
    })
    .fn("nature", () => withNamespace(toID(pokemon.nature)))
    .fn("is_wild", () => {
      // PokemonEntity sem dono; sem entidade no mundo é 0, como no Java.
      const out = entityOf();
      return out && !pokemon.trainer ? 1 : 0;
    })
    .fn("is_shiny", () => (pokemon.shiny ? 1 : 0))
    .fn("shiny", () => (pokemon.shiny ? 1 : 0))
    .fn("gender", () => genderName(pokemon.gender))
    .fn("is_in_party", () => {
      const owner = safe(() => pokemon.tryGetOwner(), undefined);
      return owner && safe(() => getSafeTeam(owner).some(p => p?.uuid === pokemon.uuid), false) ? 1 : 0;
    })
    .fn("species", () => createSpeciesStruct(pokemon.species))
    .fn("weight", () => species()?.weight ?? 0)
    .fn("matches", args => (safe(() => PokemonProperties.parse(asString(args[0])).match(pokemon), false) ? 1 : 0))
    .fn("apply", args => {
      replaceWith(PokemonProperties.parse(asString(args[0])).apply(pokemon));
      persist();
      return 1;
    })
    .fn("owner", () => {
      const owner = safe(() => pokemon.tryGetOwner(), undefined);
      return owner && structHooks.player ? structHooks.player(owner) : 0;
    })
    .fn("held_item", () => createItemStackStruct(safe(() => pokemon.getHeldItem(), undefined)))
    .fn("remove_held_item", () => {
      const old = safe(() => pokemon.getHeldItem(), undefined);
      pokemon.minecraftItem = undefined;
      pokemon.item = "";
      persist();
      return createItemStackStruct(old);
    })
    .fn("add_aspects", args => {
      updateAspects(pokemon, args.map(asString), []);
      persist();
      return 1;
    })
    .fn("remove_aspects", args => {
      updateAspects(pokemon, [], args.map(asString));
      persist();
      return 1;
    })
    .fn("cosmetic_item", () => createItemStackStruct(pokemon.cosmeticItem ? safe(() => new ItemStack(pokemon.cosmeticItem!, 1), undefined) : undefined))
    .fn("remove_cosmetic_item", () => {
      const old = pokemon.cosmeticItem;
      pokemon.setCosmeticItem(undefined);
      persist();
      return createItemStackStruct(old ? safe(() => new ItemStack(old, 1), undefined) : undefined);
    })
    // Marcas (Cobblemon 1.8.0: marks, has_mark, remove_marks).
    .fn("marks", () => new MoArray(pokemon.marks.slice()))
    .fn("has_mark", args => {
      const mark = markId(args[0] ?? "");
      return mark && pokemon.marks.includes(mark) ? 1 : 0;
    })
    .fn("remove_marks", args => {
      let removed = false;
      for (const arg of args) {
        const mark = markId(arg);
        if (mark) { takeMark(pokemon, mark); removed = true; }
      }
      if (removed) persist();
      return removed ? 1 : 0;
    })
    .fn("add_marks", args => {
      let applied = false;
      for (const arg of args) {
        const mark = markId(arg);
        if (mark) { giveMark(pokemon, mark); applied = true; }
      }
      if (applied) persist();
      return applied ? 1 : 0;
    })
    .fn("add_marks_with_chance", args => {
      let applied = false;
      for (const arg of args) {
        const mark = markId(arg);
        if (!mark) continue;
        const probability = Math.min(1, Math.max(0, MARK_CHANCES[mark]?.chance ?? 0)) * 100;
        if (Math.random() * 100 < probability) { giveMark(pokemon, mark); applied = true; }
      }
      if (applied) persist();
      return applied ? 1 : 0;
    })
    .fn("add_potential_marks", args => {
      addPotentialMarks(pokemon, ...args.map(markId).filter((m): m is string => !!m));
      persist();
      return 1;
    })
    .fn("apply_potential_marks", () => {
      const applied = applyPotentialMarks(pokemon);
      persist();
      return applied ? 1 : 0;
    })
    .fn("hyper_train_iv", args => {
      const stat = permanentStat(args[0]);
      if (!stat) {
        console.warn(`[molang] hyper_train_iv: atributo desconhecido ou não permanente: ${asString(args[0])}`);
        return 0;
      }
      safe(() => pokemon.hyperTrain(stat, Math.min(MAX_IV, Math.max(0, argInt(args, 1, MAX_IV)))), false);
      persist();
      return 1;
    })
    .fn("add_exp", args => {
      pokemon.gainExp(Math.trunc(asNumber(args[0])), safe(() => pokemon.tryGetOwner(), undefined));
      persist();
      return 1;
    })
    .fn("set_iv", args => {
      const stat = permanentStat(args[0]);
      if (!stat) return 0;
      pokemon.setIv(stat, Math.min(MAX_IV, Math.max(0, argInt(args, 1, MAX_IV))));
      persist();
      return 1;
    })
    .fn("set_ev", args => {
      const stat = permanentStat(args[0]);
      if (!stat) return 0;
      pokemon.setEv(stat, Math.min(255, Math.max(0, argInt(args, 1, 0))));
      persist();
      return 1;
    })
    .fn("set_ride_boost", args => {
      const name = asString(args[0]).toUpperCase();
      if (!isRidingStat(name) || args[1] === undefined) return 0;
      setRideBoost(pokemon, name, asNumber(args[1]));
      persist();
      return 1;
    })
    .fn("add_ride_boost", args => {
      const name = asString(args[0]).toUpperCase();
      if (!isRidingStat(name) || args[1] === undefined) return 0;
      const changed = addRideBoosts(pokemon, { [name]: asNumber(args[1]) });
      if (changed) persist();
      return changed ? 1 : 0;
    })
    .fn("initialize_moveset", args => {
      // Número (preferLatest) ou id de moveset builder; padrão: o builder selvagem da forma.
      const value = args[0];
      let builder = pokemon.aspects.includes("alpha") ? "alpha" : "wild";
      if (typeof value === "string") {
        builder = value.replace(/^cobblemon:/, "");
        if (!MOVESET_BUILDERS[builder]) {
          console.warn(`[molang] initialize_moveset: o moveset builder ${value} não existe`);
          return 0;
        }
      }
      pokemon.initializeMoveset(builder);
      persist();
      return 1;
    })
    .fn("validate_moveset", args => {
      const query = argBool(args, 0, true) ? "any" : "legal";
      for (let i = pokemon.moves.length - 1; i >= 0; i--) {
        if (!pokemon.canLearnMove(pokemon.moves[i], query)) {
          pokemon.moves.splice(i, 1);
          pokemon.movesInfo.splice(i, 1);
        }
      }
      pokemon.learnedMoves = pokemon.learnedMoves.filter(m => pokemon.canLearnMove(m, query));
      persist();
      return 1;
    })
    .fn("teach_learnable_moves", args => {
      const includeLegacy = argBool(args, 0, true);
      const query = includeLegacy ? "any" : "legal";
      for (const move of allLearnsetMoves(pokemon, includeLegacy)) {
        if (pokemon.moves.includes(move) || pokemon.learnedMoves.includes(move) || !pokemon.canLearnMove(move, query)) continue;
        pokemon.learnedMoves.push(move);
      }
      persist();
      return 1;
    })
    .fn("teach_move", args => {
      const move = toID(asString(args[0]));
      if (!createMoveStruct(move)) return 0;
      const bypass = argBool(args, 1, false);
      if (!bypass && !pokemon.canLearnMove(move, "any")) return 0;
      if (pokemon.moves.includes(move) || pokemon.learnedMoves.includes(move)) return 0;
      const taught = pokemon.teachMove(move);
      if (taught) persist();
      return taught ? 1 : 0;
    })
    .fn("can_learn_move", args => {
      const move = toID(asString(args[0]));
      if (!createMoveStruct(move)) return 0;
      return pokemon.canLearnMove(move, argBool(args, 1, true) ? "any" : "legal") ? 1 : 0;
    })
    .fn("unlearn_move", args => {
      const move = toID(asString(args[0]));
      if (!createMoveStruct(move)) return 0;
      pokemon.unlearnMove(move);
      persist();
      return 1;
    })
    .fn("can_evolve", () => (pokemon.getEvolutionEntries().length > 0 ? 1 : 0))
    .fn("force_evolve", args => {
      const index = argInt(args, 0, -1);
      if (index < 0) return 0;
      const evolution = safe(() => pokemon.getEvolutions()[index], undefined);
      if (!evolution) return "null";
      replaceWith(evolution.forceEvolve(pokemon));
      return evolution.id;
    })
    // Cobblemon 1.8.0: q.pokemon.entity.
    .fn("entity", () => {
      const out = entityOf();
      return out ? createPokemonEntityStruct(out, pokemon) : 0;
    })
    .fn("is_alpha", () => (pokemon.aspects.includes("alpha") ? 1 : 0))
    .fn("size_category", () => pokemon.getSizeCategory());
  return struct;
}

// ---------------------------------------------------------------------------------------------
// Entidade de Pokémon (PokemonEntityMoLangFunctions)

/**
 * q.entity de um Pokémon em campo: funções de entidade + as do PokemonEntity. Sem equivalente no Bedrock (0):
 * estados de montaria (`get_riding_state`, `is_gliding`, `is_drifting`...) e `run_action_effect`.
 */
export function createPokemonEntityStruct(entity: Entity, pokemon: PokemonData): MoStruct {
  // Funções de entidade genéricas pelo gancho (EntityStruct.ts; ver StructHooks.ts).
  const struct = structHooks.entity?.(entity) ?? new MoStruct({}, {}, entity);
  const property = (name: string) => safe(() => entity.getProperty(name), undefined);
  const riders = () => safe(() => entity.getComponent("minecraft:rideable")?.getRiders() ?? [], [] as Entity[]);
  struct
    .set("is_pokemon", 1)
    .fn("pokemon", () => createPokemonStruct(pokemon, entity))
    .fn("is_wild", () => (property("cobblemon:wild") === true || !pokemon.trainer ? 1 : 0))
    .fn("in_battle", () => (property("cobblemon:in_battle") === true ? 1 : 0))
    .fn("is_in_party", () => (pokemon.trainer ? 1 : 0))
    .fn("is_moving", () => {
      const v = safe(() => entity.getVelocity(), { x: 0, y: 0, z: 0 });
      return Math.abs(v.x) + Math.abs(v.z) > 0.001 ? 1 : 0;
    })
    .fn("is_ridden", () => (riders().length > 0 ? 1 : 0))
    .fn("has_aspect", args => (pokemon.aspects.includes(asString(args[0])) ? 1 : 0))
    .fn("is_holding_item", () => (pokemon.minecraftItem ? 1 : 0))
    .fn("is_wearing_hat", () => 0)
    .fn("is_wearing_face", () => 0)
    .fn("is_busy", () => (property("cobblemon:busy") === true ? 1 : 0))
    // Tag do pasto (scripts/machines/pasture.ts, PASTURED_TAG) e o grupo de ataque ligado (pastureConflict.ts).
    .fn("is_pastured", () => (safe(() => entity.hasTag("cobblemon_pastured"), false) ? 1 : 0))
    .fn("pasture_conflict_enabled", () => (property("cobblemon:pasture_conflict") === true ? 1 : 0))
    .fn("riding_style", () => 0);
  return struct;
}
