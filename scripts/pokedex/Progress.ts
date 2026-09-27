/**
 * "Progresso Cobblemon" (frente extras-final): lista leve, na Pokédex, dos objetivos das conquistas (advancements)
 * da aba "catching" do Cobblemon 1.8.2 (`data/cobblemon/advancement/catching/*.json`).
 *
 * O Bedrock não deixa add-ons criarem conquistas (NÃO POSSÍVEL NO BEDROCK), então os contadores de
 * `PlayerAdvancementData` (totalCaptureCount, totalShinyCaptureCount, totalAlphaCaptureCount, totalEvolvedCount,
 * totalTradedCount, aspectsCollected) ficam numa dynamic property do jogador e a tela da Pokédex mostra cada objetivo
 * com o texto da conquista original (`advancements.cobblemon.<id>`).
 *
 * Gatilhos: captura (scripts/catching), obter Pokémon/Pokédex (scripts/pokedex) e ganchos exportados para as frentes
 * de evolução, troca e fósseis (`recordEvolution`, `recordTrade`, `recordResurrection`; ver docs/pendencias/extras-final.md).
 */
import { DexPropertyHolder } from "./PokedexStorage";
import { awardStat } from "../events/PlayerStats";

export const PROGRESS_PROPERTY = "cobblemon:progress";

/** Contadores guardados (nomes curtos para caber folgado na dynamic property). */
export interface ProgressState {
  /** totalCaptureCount */
  c: number;
  /** totalShinyCaptureCount */
  s: number;
  /** totalAlphaCaptureCount */
  a: number;
  /** totalEvolvedCount */
  e: number;
  /** totalTradedCount */
  t: number;
  /** Pokémon revividos de fósseis */
  r: number;
  /** Marcas simples já alcançadas ("full_party", "pokedex"...) */
  f: string[];
  /** Evoluções "origem>destino" acompanhadas por algum objetivo */
  ev: string[];
  /** aspectsCollected, só dos aspectos acompanhados por algum objetivo: espécie → aspectos */
  asp: Record<string, string[]>;
}

export interface ProgressGoal {
  /** Id da conquista sem namespace/pasta ("first_catch"). */
  id: string;
  /** Alvo (1 para objetivos simples). */
  target: number;
  /** Valor atual (limitado ao alvo pela tela). */
  value(state: ProgressState): number;
  /** Aspectos acompanhados (aspects_collected). */
  aspects?: { species: string; aspects: string[] };
  /** Evolução acompanhada (pokemon_evolved com espécie). */
  evolution?: string;
  /** Precisa de um gancho de outra frente para avançar. */
  needsHook?: string;
}

const VIVILLON = ["archipelago", "continental", "elegant", "fancy", "garden", "high-plains", "icy-snow", "jungle", "marine",
  "meadow", "modern", "monsoon", "ocean", "polar", "river", "sandstorm", "savanna", "sun", "tundra"].map(x => `vivillon-wings-${x}`);
const VIVILLON_FULL = [...VIVILLON, ...["inferno", "void", "forsaken", "poke-ball"].map(x => `vivillon-wings-${x}`)];

const countAspects = (state: ProgressState, species: string, aspects: string[]) =>
  aspects.filter(aspect => state.asp[species]?.includes(aspect)).length;

/** Objetivos da aba "catching" que o port consegue acompanhar (ordem da árvore do Cobblemon). */
export const PROGRESS_GOALS: ProgressGoal[] = [
  { id: "craft_pokedex", target: 1, value: s => Number(s.f.includes("pokedex")) },
  { id: "first_catch", target: 1, value: s => s.c },
  { id: "first_shiny_catch", target: 1, value: s => s.s },
  { id: "first_alpha_catch", target: 1, value: s => s.a },
  { id: "full_party", target: 1, value: s => Number(s.f.includes("full_party")) },
  { id: "first_evolution", target: 1, value: s => s.e, needsHook: "evolução" },
  { id: "evolve_shedinja", target: 1, value: s => Number(s.ev.includes("nincada>shedinja")), evolution: "nincada>shedinja", needsHook: "evolução" },
  { id: "trade_pokemon", target: 1, value: s => s.t, needsHook: "troca" },
  { id: "catch_alpha_wailord", target: 1, value: s => countAspects(s, "wailord", ["alpha"]), aspects: { species: "wailord", aspects: ["alpha"] } },
  { id: "collect_all_vivillon", target: VIVILLON.length, value: s => countAspects(s, "vivillon", VIVILLON), aspects: { species: "vivillon", aspects: VIVILLON } },
  { id: "collect_all_vivillon_full", target: VIVILLON_FULL.length, value: s => countAspects(s, "vivillon", VIVILLON_FULL), aspects: { species: "vivillon", aspects: VIVILLON_FULL } },
  { id: "evolve_gholdengo_netherite", target: 1, value: s => countAspects(s, "gholdengo", ["netherite-coating-full"]), aspects: { species: "gholdengo", aspects: ["netherite-coating-full"] } },
  { id: "resurrect_pokemon", target: 1, value: s => s.r, needsHook: "fósseis" },
];

/** Aspectos acompanhados por espécie (o resto não é guardado). */
const TRACKED_ASPECTS = new Map<string, Set<string>>();
for (const goal of PROGRESS_GOALS) {
  if (!goal.aspects) continue;
  const set = TRACKED_ASPECTS.get(goal.aspects.species) ?? new Set<string>();
  goal.aspects.aspects.forEach(aspect => set.add(aspect));
  TRACKED_ASPECTS.set(goal.aspects.species, set);
}
const TRACKED_EVOLUTIONS = new Set(PROGRESS_GOALS.map(goal => goal.evolution).filter((x): x is string => !!x));

export function emptyProgress(): ProgressState {
  return { c: 0, s: 0, a: 0, e: 0, t: 0, r: 0, f: [], ev: [], asp: {} };
}

const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

/** Lê o estado (JSON inválido ou ausente → zerado). */
export function parseProgress(raw: unknown): ProgressState {
  const state = emptyProgress();
  if (typeof raw !== "string" || !raw) return state;
  let json: Record<string, unknown>;
  try { json = JSON.parse(raw); }
  catch { return state; }
  if (!json || typeof json !== "object" || Array.isArray(json)) return state;
  state.c = num(json.c); state.s = num(json.s); state.a = num(json.a);
  state.e = num(json.e); state.t = num(json.t); state.r = num(json.r);
  state.f = strings(json.f);
  state.ev = strings(json.ev);
  if (json.asp && typeof json.asp === "object" && !Array.isArray(json.asp))
    for (const [species, aspects] of Object.entries(json.asp as Record<string, unknown>)) {
      const list = strings(aspects);
      if (list.length > 0) state.asp[species] = list;
    }
  return state;
}

export function getProgress(holder: DexPropertyHolder): ProgressState {
  return parseProgress(holder.getDynamicProperty(PROGRESS_PROPERTY));
}

function update(holder: DexPropertyHolder, change: (state: ProgressState) => boolean): boolean {
  try {
    const state = getProgress(holder);
    if (!change(state)) return false;
    holder.setDynamicProperty(PROGRESS_PROPERTY, JSON.stringify(state));
    return true;
  }
  catch (e) {
    console.warn(`Não foi possível gravar o progresso: ${e}`);
    return false;
  }
}

/** PlayerAdvancementData.updateAspectsCollected, só para os aspectos acompanhados. */
function collect(state: ProgressState, species: string, aspects: readonly string[]): boolean {
  const tracked = TRACKED_ASPECTS.get(species);
  if (!tracked) return false;
  let changed = false;
  for (const aspect of aspects) {
    if (!tracked.has(aspect)) continue;
    const list = state.asp[species] ?? (state.asp[species] = []);
    if (!list.includes(aspect)) { list.push(aspect); changed = true; }
  }
  return changed;
}

export interface ProgressPokemon {
  /** Espécie sem namespace. */
  species: string;
  aspects: readonly string[];
  shiny?: boolean;
}

const isAlpha = (pokemon: ProgressPokemon) => pokemon.aspects.includes("alpha");

/** AdvancementHandler.onCapture. */
export function recordCapture(holder: DexPropertyHolder, pokemon: ProgressPokemon): boolean {
  // StatHandler.onCapture (estatísticas captured/shinies_captured).
  awardStat(holder, "captured");
  if (pokemon.shiny ?? pokemon.aspects.includes("shiny")) awardStat(holder, "shinies_captured");
  return update(holder, state => {
    state.c++;
    if (pokemon.shiny ?? pokemon.aspects.includes("shiny")) state.s++;
    if (isAlpha(pokemon)) state.a++;
    collect(state, pokemon.species, pokemon.aspects);
    return true;
  });
}

/** AdvancementHandler.onEvolve (gancho para a frente de evolução). `from`/`to` = espécies sem namespace. */
export function recordEvolution(holder: DexPropertyHolder, from: string, to: ProgressPokemon): boolean {
  return update(holder, state => {
    state.e++;
    const key = `${from}>${to.species}`;
    if (TRACKED_EVOLUTIONS.has(key) && !state.ev.includes(key)) state.ev.push(key);
    collect(state, to.species, to.aspects);
    return true;
  });
}

/** AdvancementHandler.onTradeCompleted (gancho para a frente de troca): chame para quem recebeu. */
export function recordTrade(holder: DexPropertyHolder, received: ProgressPokemon): boolean {
  // StatHandler.onTradeCompleted (traded) e o POKEMON_GAINED do Pokémon recebido (dex_entries).
  awardStat(holder, "traded");
  awardStat(holder, "dex_entries");
  return update(holder, state => {
    state.t++;
    collect(state, received.species, received.aspects);
    return true;
  });
}

/** resurrect_pokemon (gancho para a frente de fósseis). */
export function recordResurrection(holder: DexPropertyHolder, pokemon: ProgressPokemon): boolean {
  // StatHandler.onFossilRevived.
  awardStat(holder, "fossils_revived");
  return update(holder, state => {
    state.r++;
    collect(state, pokemon.species, pokemon.aspects);
    return true;
  });
}

/** Aspectos de um Pokémon obtido por outro caminho (inicial, comando, evolução já registrada na Pokédex). */
export function recordCollectedAspects(holder: DexPropertyHolder, pokemon: ProgressPokemon): boolean {
  if (!TRACKED_ASPECTS.has(pokemon.species)) return false;
  return update(holder, state => collect(state, pokemon.species, pokemon.aspects));
}

/** Marca simples alcançada ("full_party", "pokedex"). */
export function recordFlag(holder: DexPropertyHolder, flag: string): boolean {
  return update(holder, state => {
    if (state.f.includes(flag)) return false;
    state.f.push(flag);
    return true;
  });
}

export interface GoalStatus {
  goal: ProgressGoal;
  value: number;
  done: boolean;
}

/** Situação de cada objetivo. */
export function goalStatuses(state: ProgressState): GoalStatus[] {
  return PROGRESS_GOALS.map(goal => {
    const value = Math.min(goal.target, goal.value(state));
    return { goal, value, done: value >= goal.target };
  });
}

/**
 * Conquista concluída? Aceita o id completo do Cobblemon ("cobblemon:catching/collect_all_vivillon") ou só o nome.
 * Usada pelo requisito de evolução `advancement` (Spewpa → Vivillon Poké Ball). Undefined = objetivo não acompanhado.
 */
export function isProgressGoalDone(holder: DexPropertyHolder, advancement: string): boolean | undefined {
  const id = advancement.replace(/^[^:]*:/, "").split("/").pop() ?? advancement;
  const goal = PROGRESS_GOALS.find(g => g.id === id);
  if (!goal) return undefined;
  return goal.value(getProgress(holder)) >= goal.target;
}
