/**
 * Move Dex da Pokédex (Cobblemon 1.8.2: aba TAB_MOVES do PokedexGUI, `client/gui/pokedex/widgets/MovesLearnsetWidget.kt`)
 * e os filtros que dependem dele (`api/pokedex/filter/{PokedexCategoryFilter,SearchFilter}.kt`).
 *
 * Regras de descoberta (iguais ao widget):
 * - golpe por nível: descoberto se `unlockAllMoveDexMovesByDefault`, ou se o maior nível registrado da forma (ou de
 *   qualquer evolução dela) já alcança o nível do golpe (`highestLevel` do FormDexRecord, gravado ao obter/subir);
 * - golpe de TM: bloqueado ("???") se o TM existe, não foi aprendido pelo jogador e não é "passivo" (default);
 * - golpe de ovo: sempre visível.
 * Filtros de categoria: Todos / Nível / TM / Ovo; ordenação: nível (padrão), nome, tipo, descoberto.
 * A aba abre com a forma só vista (looseUnlockTabs).
 */
import type { Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { Dex, toID } from "../showdown";
import { FormData, SpeciesData, getFormByName, getFormForAspects, getLearnset, getSpeciesData, toSpeciesId } from "../speciesData";
import { PokemonProperties } from "../PokemonProperties";
import { getConfig } from "../Config";
import { TECHNICAL_MACHINES } from "../machines/data";
import { getLearnedTMs } from "../machines/tm";
import { typeGlyph, CATEGORY_GLYPHS } from "../ui/glyphs";
import { PokedexRecords } from "./PokedexRecords";

export type LearnsetCategory = "all" | "level" | "tm" | "egg";
export const LEARNSET_CATEGORIES: LearnsetCategory[] = ["all", "level", "tm", "egg"];
export type LearnsetSort = "level" | "name" | "type" | "discovered";
export const LEARNSET_SORTS: LearnsetSort[] = ["level", "name", "type", "discovered"];

export interface LearnsetEntry {
  /** Id do Showdown. */
  move: string;
  source: Exclude<LearnsetCategory, "all">;
  level?: number;
  tmLocked: boolean;
  discovered: boolean;
  /** Há TM do golpe (TechnicalMachines.moveToTM). */
  tmId?: string;
  tmUnlocked: boolean;
}

/** O que a descoberta precisa saber do jogador. */
export interface MoveDexContext {
  records: PokedexRecords;
  learnedTMs: ReadonlySet<string>;
  unlockAll: boolean;
}

/** Forma de dados (undefined = padrão) pelo nome exibido ("Normal", "Alola"). */
export function formByDisplay(species: SpeciesData, displayForm: string | undefined): FormData | undefined {
  if (!displayForm || displayForm.toLowerCase() === "normal") return undefined;
  return getFormByName(species, displayForm);
}

function formRecordName(form: FormData | undefined): string {
  return form?.name ?? "Normal";
}

/** Evolution.result → forma de destino (resolveEvolutionForm): espécie + `form=`/aspectos; senão a padrão. */
function resolveEvolutionForm(result: string): { speciesId: string; form?: FormData } | undefined {
  let props: PokemonProperties;
  try { props = PokemonProperties.parse(result); } catch { return undefined; }
  if (!props.species) return undefined;
  const species = getSpeciesData(props.species);
  if (!species) return undefined;
  let form: FormData | undefined;
  if (props.form) {
    const wanted = props.form.toLowerCase().replace(/[^a-z0-9]/g, "");
    form = (species.forms ?? []).find(f => f.name.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted);
  }
  else if (props.aspects.length) form = getFormForAspects(species, props.aspects);
  return { speciesId: toSpeciesId(props.species), form };
}

/** collectEvolutionForms: todas as formas alcançáveis por evolução a partir desta (sem repetir). */
export function collectEvolutionForms(speciesId: string, form: FormData | undefined): { speciesId: string; form?: FormData }[] {
  const results: { speciesId: string; form?: FormData }[] = [];
  const visited = new Set<string>();
  const key = (id: string, f?: FormData) => `${id}|${formRecordName(f).toLowerCase()}`;
  const traverse = (id: string, f: FormData | undefined, depth: number) => {
    if (depth > 8) return;
    const species = getSpeciesData(id);
    if (!species) return;
    const evolutions = f?.evolutions?.length ? f.evolutions : species.evolutions ?? [];
    for (const evolution of evolutions) {
      const target = resolveEvolutionForm(evolution.result);
      if (!target) continue;
      const k = key(target.speciesId, target.form);
      if (visited.has(k)) continue;
      visited.add(k);
      results.push(target);
      traverse(target.speciesId, target.form, depth + 1);
    }
  };
  traverse(speciesId, form, 0);
  return results;
}

/** Maior nível registrado (FormDexRecord.highestLevel; -1 = nunca obtido). */
function highestLevelOf(records: PokedexRecords, speciesId: string, form: FormData | undefined, fallbackToSpecies: boolean): number {
  const formLevel = records.getFormRecord(speciesId, formRecordName(form))?.highestLevel;
  if (formLevel !== undefined && formLevel >= 0) return formLevel;
  if (fallbackToSpecies) return records.getSpeciesRecord(speciesId)?.highestLevel ?? -1;
  return formLevel ?? -1;
}

function isTmUnlocked(move: string, ctx: MoveDexContext): boolean {
  const tm = TECHNICAL_MACHINES[move];
  return !!tm && (ctx.unlockAll || ctx.learnedTMs.has(move) || tm.default === true);
}

/** MovesLearnsetWidget.buildLearnsetEntries: nível (em ordem), TM (por nome) e ovo (por nome), sem repetir golpe. */
export function buildLearnsetEntries(speciesId: string, form: FormData | undefined, ctx: MoveDexContext): LearnsetEntry[] {
  const learnset = getLearnset(speciesId, form);
  const highestLevel = Math.max(0, highestLevelOf(ctx.records, speciesId, form, false));
  const highestEvolutionLevel = Math.max(0, ...collectEvolutionForms(speciesId, form)
    .map(evo => highestLevelOf(ctx.records, evo.speciesId, evo.form, true)));
  const levelDiscovered = (level: number) => ctx.unlockAll || highestLevel >= level || highestEvolutionLevel >= level;
  const entries = new Map<string, LearnsetEntry>();
  const add = (move: string, source: LearnsetEntry["source"], level?: number, tmLocked = false, discovered = true) => {
    if (entries.has(move) || !Dex.moves.get(move).exists) return;
    const tmId = TECHNICAL_MACHINES[move] ? move : undefined;
    entries.set(move, { move, source, level, tmLocked: source === "tm" ? tmLocked : false, discovered, tmId, tmUnlocked: isTmUnlocked(move, ctx) });
  };
  const byName = (a: string, b: string) => moveName(a).localeCompare(moveName(b));
  [...learnset.levelUpMoves.keys()].sort((a, b) => a - b).forEach(level => {
    for (const move of learnset.levelUpMoves.get(level) ?? []) add(move, "level", level, false, levelDiscovered(level));
  });
  [...learnset.tmMoves].sort(byName).forEach(move => {
    const locked = !ctx.unlockAll && !!TECHNICAL_MACHINES[move] && !ctx.learnedTMs.has(move) && TECHNICAL_MACHINES[move].default !== true;
    add(move, "tm", undefined, locked, !locked);
  });
  [...learnset.eggMoves].sort(byName).forEach(move => add(move, "egg"));
  return [...entries.values()];
}

/** Nome do golpe no Showdown (a ordenação por nome do Cobblemon usa o nome traduzido; o servidor não traduz). */
export function moveName(move: string): string {
  return Dex.moves.get(move).name || move;
}

function moveType(move: string): string {
  return toID(Dex.moves.get(move).type || "normal");
}

const sourceOrder = (source: LearnsetEntry["source"]) => (source === "tm" ? 1 : source === "egg" ? 2 : 0);

/** applyFilter + sortEntries do widget. */
export function filterAndSort(entries: readonly LearnsetEntry[], category: LearnsetCategory, sort: LearnsetSort): LearnsetEntry[] {
  const filtered = category === "all" ? [...entries] : entries.filter(entry => entry.source === category);
  const cmp = (...keys: ((e: LearnsetEntry) => string | number)[]) => (a: LearnsetEntry, b: LearnsetEntry) => {
    for (const key of keys) {
      const x = key(a), y = key(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
  const undiscovered = (e: LearnsetEntry) => (e.discovered ? 0 : 1);
  const name = (e: LearnsetEntry) => moveName(e.move).toLowerCase();
  const type = (e: LearnsetEntry) => moveType(e.move);
  const level = (e: LearnsetEntry) => e.level ?? Number.MAX_SAFE_INTEGER;
  switch (sort) {
    case "name": return filtered.sort(cmp(undiscovered, name, type, level));
    case "type": return filtered.sort(cmp(type, undiscovered, name, level));
    case "level": return filtered.sort(cmp(e => sourceOrder(e.source), level, undiscovered, type, name));
    case "discovered": return filtered.sort(cmp(e => (e.tmId ? 0 : 1), e => (e.tmId && e.tmUnlocked ? 0 : 1), name, e => sourceOrder(e.source)));
  }
}

/** Contexto do jogador (TMs aprendidos e a config). */
export function moveDexContext(player: Player, records: PokedexRecords): MoveDexContext {
  let learned: ReadonlySet<string> = new Set();
  try { learned = getLearnedTMs(player); } catch { }
  let unlockAll = false;
  try { unlockAll = getConfig().unlockAllMoveDexMovesByDefault === true; } catch { }
  return { records, learnedTMs: learned, unlockAll };
}

// ---------------------------------------------------------------------------------------------
// Filtros da lista de entradas (PokedexCategoryFilter / SearchFilter)

/** PokedexCategoryFilter.hasUndiscoveredLevelUpTM para uma forma. */
export function hasUndiscoveredLevelUpTM(speciesId: string, form: FormData | undefined, ctx: MoveDexContext): boolean {
  const learnset = getLearnset(speciesId, form);
  const highestLevel = highestLevelOf(ctx.records, speciesId, form, false);
  const highestEvolutionLevel = Math.max(-1, ...collectEvolutionForms(speciesId, form).map(evo => highestLevelOf(ctx.records, evo.speciesId, evo.form, true)));
  for (const [level, moves] of learnset.levelUpMoves) {
    for (const move of moves) {
      const tm = TECHNICAL_MACHINES[move];
      if (!tm) continue;
      const unlocked = ctx.learnedTMs.has(move) || tm.default === true;
      if (!unlocked && !(highestLevel >= level || highestEvolutionLevel >= level)) return true;
    }
  }
  return false;
}

/** SearchFilter.hasDiscoveredMove: algum golpe descoberto da forma contém o texto. */
export function hasDiscoveredMove(speciesId: string, form: FormData | undefined, search: string, ctx: MoveDexContext): boolean {
  const learnset = getLearnset(speciesId, form);
  const highestLevel = highestLevelOf(ctx.records, speciesId, form, false);
  const highestEvolutionLevel = Math.max(-1, ...collectEvolutionForms(speciesId, form).map(evo => highestLevelOf(ctx.records, evo.speciesId, evo.form, true)));
  const matches = (move: string) => moveName(move).toLowerCase().includes(search) || move.includes(search.replace(/[^a-z0-9]/g, ""));
  for (const [level, moves] of learnset.levelUpMoves)
    for (const move of moves) if (matches(move) && (highestLevel >= level || highestEvolutionLevel >= level)) return true;
  for (const move of learnset.tmMoves) {
    const tm = TECHNICAL_MACHINES[move];
    const discovered = !tm || ctx.learnedTMs.has(move) || tm.default === true;
    if (discovered && matches(move)) return true;
  }
  for (const list of [learnset.tutorMoves, learnset.eggMoves, learnset.formChangeMoves])
    for (const move of list) if (matches(move)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Tela

const tr = (translate: string, ...args: (string | number | RawMessage)[]): RawMessage => args.length === 0
  ? { translate }
  : { translate, with: { rawtext: args.map(arg => typeof arg === "object" ? arg : { text: String(arg) }) } };
const join = (...parts: (RawMessage | string | undefined)[]): RawMessage =>
  ({ rawtext: parts.filter((x): x is RawMessage | string => x !== undefined).map(x => typeof x === "string" ? { text: x } : x) });

/** DecimalFormat("#.##") com CEILING + "%" (formatPercentage); ≤ 0 = "—". */
export function formatPercentage(value: number): string {
  if (!(value > 0)) return "—";
  const rounded = Math.ceil(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toString()}%`;
}

/** Primeira chance de efeito secundário do golpe (MoveTemplate.effectChances). */
export function effectChance(move: string): number {
  const data = Dex.moves.get(move) as unknown as { secondary?: { chance?: number } | null; secondaries?: { chance?: number }[] | null };
  const list = data.secondaries ?? (data.secondary ? [data.secondary] : []);
  return list.find(s => typeof s?.chance === "number")?.chance ?? 0;
}

/** Linha de um golpe na lista (tipo, nome ou "???", nível/origem e o TM). */
export function entryButton(entry: LearnsetEntry): RawMessage {
  const type = typeGlyph(moveType(entry.move));
  const name: RawMessage = entry.discovered ? { translate: `cobblemon.move.${entry.move}` } : { translate: "cobblemon.ui.generic.question_marks" };
  const label: RawMessage = entry.level !== undefined ? tr("cobblemon.ui.lv.number", entry.level) : { translate: `cobblemon.ui.moves.${entry.source}` };
  const tm = entry.tmId ? join(entry.tmUnlocked ? " §a[" : " §8[", { translate: "cobblemon.ui.moves.tm" }, "]") : undefined;
  return join(`§f${type} `, entry.discovered ? "§0" : "§8", name, "§r\n§7", label, tm);
}

/** Painel de dados do golpe (renderDataSection): nome, PP, categoria, poder, precisão, efeito e descrição. */
export function moveDetails(entry: LearnsetEntry): RawMessage {
  if (!entry.discovered) return join("§l", { translate: "cobblemon.ui.moves" }, "§r\n—");
  const move = Dex.moves.get(entry.move);
  const power = move.basePower > 0 ? String(move.basePower) : "—";
  const accuracy = move.accuracy === true ? "—" : formatPercentage(move.accuracy);
  return join(
    "§l", { translate: `cobblemon.move.${entry.move}` }, "§r  ", tr("cobblemon.ui.moves.pp", move.pp), ` ${CATEGORY_GLYPHS[move.category] ?? ""}`,
    "\n§7", { translate: "cobblemon.ui.power" }, `: §f${power}`,
    "\n§7", { translate: "cobblemon.ui.accuracy" }, `: §f${accuracy}`,
    "\n§7", { translate: "cobblemon.ui.effect" }, `: §f${formatPercentage(effectChance(entry.move))}`,
    "\n\n§r", { translate: `cobblemon.move.${entry.move}.desc` },
  );
}

export interface MoveDexView {
  speciesId: string;
  /** Formas vistas (nome exibido) para as setas de forma. */
  forms: string[];
  formIndex: number;
  category: LearnsetCategory;
  sort: LearnsetSort;
}

/**
 * Abre o Move Dex (aba de golpes da entrada). `back` volta para a entrada. Os sons são os da Pokédex
 * (POKEDEX_CLICK_SHORT ao escolher um golpe).
 */
export async function openMoveDex(player: Player, records: PokedexRecords, view: MoveDexView, back: () => Promise<void>): Promise<void> {
  const species = getSpeciesData(view.speciesId);
  if (!species) return back();
  const ctx = moveDexContext(player, records);
  while (player.isValid) {
    const displayForm = view.forms[view.formIndex] ?? "Normal";
    const form = formByDisplay(species, displayForm);
    const entries = filterAndSort(buildLearnsetEntries(view.speciesId, form, ctx), view.category, view.sort);
    const number = String(species.nationalPokedexNumber ?? 0).padStart(4, "0");
    const categoryLabel: RawMessage = view.category === "all" ? { translate: "cobblemon.ui.pokedex.filter.all" } : { translate: `cobblemon.ui.moves.${view.category}` };
    const formLabel: RawMessage = displayForm.toLowerCase() === "normal" ? { translate: "cobblemon.ui.pokedex.info.form.normal" } : { text: displayForm };
    const form_ = new ActionFormData()
      .title(join({ translate: "cobblemon.ui.moves" }, ` - ${number} `, { translate: `cobblemon.species.${view.speciesId}.name` }))
      .body(join("§7", { translate: "cobblemon.ui.pokedex.info.form" }, ": §f", formLabel, "\n§7", tr("cobblemon.port.movedex.count", entries.filter(e => e.discovered).length, entries.length)));
    type Action = { kind: "category" } | { kind: "sort" } | { kind: "form"; delta: number } | { kind: "move"; entry: LearnsetEntry } | { kind: "back" };
    const actions: Action[] = [];
    form_.button(join(tr("cobblemon.port.movedex.category"), ": §l", categoryLabel)); actions.push({ kind: "category" });
    form_.button(join(tr("cobblemon.port.movedex.sort"), ": §l", { translate: `cobblemon.port.movedex.sort.${view.sort}` }), `textures/gui/cobblemon/pokedex/button_sort_move_${view.sort}`); actions.push({ kind: "sort" });
    if (view.forms.length > 1) { form_.button(join("◀ ", formLabel, " ▶")); actions.push({ kind: "form", delta: 1 }); }
    for (const entry of entries) { form_.button(entryButton(entry)); actions.push({ kind: "move", entry }); }
    form_.button(tr("cobblemon.port.pokedex.back")); actions.push({ kind: "back" });
    let response;
    try { response = await form_.show(player); } catch { return; }
    if (response.selection === undefined) return;
    const action = actions[response.selection];
    try { player.playSound("cobblemon.item.pokedex.click_short", { volume: 0.6 }); } catch { }
    switch (action?.kind) {
      case "category": view.category = LEARNSET_CATEGORIES[(LEARNSET_CATEGORIES.indexOf(view.category) + 1) % LEARNSET_CATEGORIES.length]; break;
      case "sort": view.sort = LEARNSET_SORTS[(LEARNSET_SORTS.indexOf(view.sort) + 1) % LEARNSET_SORTS.length]; break;
      case "form": view.formIndex = (view.formIndex + action.delta + view.forms.length) % view.forms.length; break;
      case "move": {
        const detail = new ActionFormData().title({ translate: "cobblemon.ui.moves" }).body(moveDetails(action.entry)).button(tr("cobblemon.port.pokedex.back"));
        try { const r = await detail.show(player); if (r.selection === undefined) return; } catch { return; }
        break;
      }
      case "back": return back();
      default: return;
    }
  }
}
