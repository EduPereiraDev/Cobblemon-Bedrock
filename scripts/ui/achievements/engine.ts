/**
 * Motor das conquistas (advancements) do Cobblemon, sem API do Minecraft: estado por jogador, eventos normalizados e
 * a regra de cada critério (mesma semântica das classes `advancement/criterion/*.kt` do Cobblemon 1.8.2).
 *
 * As definições vêm de `generated/scripts/advancements.ts` (tools/importer/advancements.ts). O rastreio dos eventos
 * no mundo fica em `tracker.ts`.
 */
import type { AdvancementCriterion, AdvancementDef } from "../../../generated/scripts/advancements";

/** Estado guardado (dynamic property `cobblemon:advancements`, JSON curto). */
export interface AchievementState {
  /** Advancements concluídos. */
  d: string[];
  /** Critérios cumpridos por advancement ainda não concluído. */
  c: Record<string, string[]>;
  /** Vitórias: total, PvP, PvW, PvN (PlayerAdvancementData). */
  w: { t: number; p: number; w: number; n: number };
}

export function emptyAchievements(): AchievementState {
  return { d: [], c: {}, w: { t: 0, p: 0, w: 0, n: 0 } };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function parseAchievements(raw: unknown): AchievementState {
  const state = emptyAchievements();
  if (typeof raw !== "string" || !raw) return state;
  try {
    const json = JSON.parse(raw);
    if (Array.isArray(json?.d)) state.d = json.d.filter((x: unknown): x is string => typeof x === "string");
    if (json?.c && typeof json.c === "object")
      for (const [k, v] of Object.entries(json.c)) if (Array.isArray(v)) state.c[k] = v.filter((x): x is string => typeof x === "string");
    if (json?.w) state.w = { t: num(json.w.t), p: num(json.w.p), w: num(json.w.w), n: num(json.w.n) };
  }
  catch { }
  return state;
}

/** Contadores da "Progresso Cobblemon" (scripts/pokedex/Progress.ts), lidos sem alterar. */
export interface ProgressCounters {
  c: number; s: number; a: number; e: number; t: number; r: number;
  ev: string[];
  asp: Record<string, string[]>;
}

/** Evento normalizado. `species`/ids sem namespace. */
export type AchievementEvent =
  | { type: "inventory"; item: string; tm?: string }
  | { type: "pokemon_interact"; item: string; species: string }
  | { type: "progress"; progress: ProgressCounters }
  | { type: "evolve"; from: string; to: string; times: number }
  | { type: "party"; species: string[] }
  | { type: "trade"; traded: string; received: string }
  | { type: "battle_won"; pvp: boolean; pvw: boolean; pvn: boolean; wins: AchievementState["w"] }
  | { type: "level_up"; level: number; hasPreEvolution: boolean; hasEvolutions: boolean }
  | { type: "started_riding" }
  | { type: "riding_stat_boost"; allMax: boolean; anyMax: boolean }
  | { type: "placed_block"; block: string; below?: string; above?: string }
  | { type: "item_used_on_block"; item: string; block: string }
  | { type: "block_use"; block: string; state: Record<string, string | number | boolean> }
  | { type: "entity_interact"; item: string; pokemon: boolean }
  | { type: "learn_tm"; tm: string }
  | { type: "learn_all_tm" }
  | { type: "resurrect"; species: string }
  | { type: "pick_starter" }
  | { type: "pasture_use" }
  | { type: "reel_in"; bait: string; species: string }
  | { type: "plant_tumblestone" }
  | { type: "plant_type_gem" }
  /**
   * Frente msd-fase6: concessão direta (PlayerAdvancements.award de todos os critérios restantes, como o
   * `/advancement grant` e o AdvancementHelper de extensões do Java). Vale para qualquer critério, inclusive
   * `impossible`, que nenhum outro evento cumpre.
   */
  | { type: "grant"; id: string }
  /** Frente msd-fase6: o jogador está dentro destas estruturas (minecraft:location com `structures`). */
  | { type: "structure"; structures: string[] };

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown, fallback = "any") => (typeof v === "string" ? v : fallback);
const any = (want: string, have: string) => want === "any" || want === have;

/** O critério é cumprido por este evento? */
export function criterionMatches(criterion: AdvancementCriterion, event: AchievementEvent): boolean {
  const c = criterion as Record<string, unknown>;
  switch (criterion.t) {
    case "inventory":
      if (event.type !== "inventory") return false;
      if (!list(c.items).includes(event.item)) return false;
      return c.tm === undefined || c.tm === event.tm;
    case "pokemon_interact":
      return event.type === "pokemon_interact" && any(str(c.item), event.item) && any(str(c.species), event.species);
    case "aspects": {
      if (event.type !== "progress") return false;
      const have = event.progress.asp[str(c.species, "")] ?? [];
      return list(c.aspects).every(a => have.includes(a));
    }
    case "catch": {
      if (event.type !== "progress") return false;
      const count = Number(c.count ?? 0);
      const times = c.kind === "shiny" ? event.progress.s : c.kind === "alpha" ? event.progress.a : event.progress.c;
      return times > 0 && times >= count;
    }
    case "evolve": {
      const count = Number(c.count ?? 0);
      if (event.type === "progress") {
        // Contador total (first_evolution) e pares acompanhados pela Progress (nincada>shedinja).
        if (c.species === "any" && c.evolution === "any") return event.progress.e > 0 && event.progress.e >= count;
        return event.progress.ev.includes(`${str(c.species)}>${str(c.evolution)}`) && event.progress.e >= count;
      }
      if (event.type !== "evolve") return false;
      return event.times >= count && any(str(c.species), event.from) && any(str(c.evolution), event.to);
    }
    case "party": {
      if (event.type !== "party") return false;
      // PartyCheckCriterion: "any" conta qualquer Pokémon; o tamanho precisa bater.
      const party = list(c.party);
      const anyCount = party.filter(p => p === "any").length;
      if (anyCount === party.length) return event.species.length === party.length;
      const specific = party.filter(p => p !== "any");
      return event.species.length === party.length && specific.every(s => event.species.includes(s));
    }
    case "trade":
      return event.type === "trade" && any(str(c.traded), event.traded) && any(str(c.received), event.received)
        || (event.type === "progress" && c.traded === "any" && c.received === "any" && event.progress.t > 0);
    case "battles_won": {
      if (event.type !== "battle_won") return false;
      // BattleCountableCriterion.matches (a última regra que casar define typeCheck/times).
      const types = list(c.battle_types ?? c.types);
      let typeCheck = types.length === 0 || types.includes("any");
      let times = event.wins.t;
      if (types.includes("pvp")) { typeCheck = event.pvp; times = event.wins.p; }
      if (types.includes("pvw")) { typeCheck = event.pvw; times = event.wins.w; }
      if (types.includes("pvn")) { typeCheck = event.pvn; times = event.wins.w; }
      if (types.length > 1) times = event.wins.t;
      return typeCheck && times >= Number(c.count ?? 0);
    }
    case "level_up": {
      if (event.type !== "level_up") return false;
      // LevelUpCriterion: nível exato + checagem de evolução (preEvo != hasEvolution quando algum existe).
      let evolutionCheck = true;
      if (event.hasPreEvolution || event.hasEvolutions) evolutionCheck = event.hasPreEvolution !== event.hasEvolutions;
      return Number(c.level ?? 0) === event.level && evolutionCheck === (c.evolved !== false);
    }
    case "started_riding":
      return event.type === "started_riding";
    case "riding_stat_boost":
      if (event.type !== "riding_stat_boost") return false;
      return c.stat === "any" ? event.anyMax : event.allMax;
    case "placed_block": {
      if (event.type !== "placed_block") return false;
      if (!list(c.blocks).includes(event.block)) return false;
      if (typeof c.below === "string" && event.below !== c.below) return false;
      if (typeof c.above === "string" && event.above !== c.above) return false;
      return true;
    }
    case "item_used_on_block":
      return event.type === "item_used_on_block" && list(c.items).includes(event.item) && list(c.blocks).includes(event.block);
    case "block_use": {
      if (event.type !== "block_use" || !list(c.blocks).includes(event.block)) return false;
      const state = c.state as Record<string, string> | undefined;
      return !state || Object.entries(state).every(([k, v]) => String(event.state[k]) === String(v));
    }
    case "entity_interact":
      return event.type === "entity_interact" && event.pokemon && list(c.items).includes(event.item);
    case "learn_tm":
      return event.type === "learn_tm" && any(str(c.tm), event.tm);
    case "learn_all_tm":
      return event.type === "learn_all_tm";
    case "resurrect":
      return (event.type === "resurrect" && any(str(c.species), event.species))
        || (event.type === "progress" && c.species === "any" && event.progress.r > 0);
    case "pick_starter":
      return event.type === "pick_starter";
    case "pasture_use":
      return event.type === "pasture_use";
    case "reel_in":
      // ReelInPokemonCriterionCondition: "empty_bait" também aceita qualquer isca.
      return event.type === "reel_in" && any(str(c.species), event.species)
        && (c.bait === "any" || c.bait === "cobblemon:empty_bait" || c.bait === event.bait);
    case "plant_tumblestone":
      return event.type === "plant_tumblestone";
    case "plant_type_gem":
      return event.type === "plant_type_gem";
    case "structure":
      return event.type === "structure" && list(c.structures).some(id => event.structures.includes(id));
  }
  return false;
}

/** Os grupos de requisitos (E de OUs) estão todos cumpridos? */
export function requirementsMet(def: AdvancementDef, met: readonly string[]): boolean {
  return def.requirements.every(group => group.some(name => met.includes(name)));
}

/**
 * Aplica um evento: marca os critérios cumpridos e devolve os advancements concluídos agora (na ordem das
 * definições). Muta `state`. `changed` indica se algo precisa ser gravado.
 */
export function applyEvent(state: AchievementState, defs: readonly AdvancementDef[], event: AchievementEvent): { completed: AdvancementDef[]; changed: boolean } {
  const completed: AdvancementDef[] = [];
  let changed = false;
  const grant = event.type === "grant" ? event.id.replace(/^cobblemon:/, "") : undefined;
  for (const def of defs) {
    if (state.d.includes(def.id)) continue;
    if (grant !== undefined && def.id !== grant) continue;
    let met = state.c[def.id];
    for (const [name, criterion] of Object.entries(def.criteria)) {
      if (met?.includes(name) || (grant === undefined && !criterionMatches(criterion, event))) continue;
      if (!met) met = state.c[def.id] = [];
      met.push(name);
      changed = true;
    }
    if (met && requirementsMet(def, met)) {
      state.d.push(def.id);
      delete state.c[def.id];
      completed.push(def);
      changed = true;
    }
  }
  return { completed, changed };
}

/** Progresso para a tela: grupos cumpridos / total de grupos. */
export function progressOf(state: AchievementState, def: AdvancementDef): { done: boolean; met: number; total: number } {
  if (state.d.includes(def.id)) return { done: true, met: def.requirements.length, total: def.requirements.length };
  const met = state.c[def.id] ?? [];
  return { done: false, met: def.requirements.filter(group => group.some(name => met.includes(name))).length, total: def.requirements.length };
}

/** Tipos de critério que dependem de ganchos de outras frentes (sem detecção somente leitura). */
export const HOOKED_CRITERIA = new Set(["riding_stat_boost", "reel_in"]);

/**
 * Visível na árvore? (AdvancementVisibilityEvaluator do Minecraft: concluído; ou não oculto e sem pai, ou com o pai
 * ou o avô concluído.)
 */
export function isVisible(state: AchievementState, def: AdvancementDef, byId: ReadonlyMap<string, AdvancementDef>): boolean {
  if (state.d.includes(def.id)) return true;
  if (def.hidden) return false;
  if (!def.parent) return true;
  if (state.d.includes(def.parent)) return true;
  const grandparent = byId.get(def.parent)?.parent;
  return !!grandparent && state.d.includes(grandparent);
}
