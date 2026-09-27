/**
 * Telas da Pokédex (server-ui), aproximação de `client/gui/pokedex/PokedexGUI.kt`:
 * lista de Pokédex (nacional + regionais) → lista de entradas paginada com filtro e busca → entrada.
 *
 * O que a entrada mostra segue o PokedexGUI: nome e tipos com a espécie vista; descrição, habilidades,
 * altura/peso e atributos base só com a forma capturada; drops (e o resumo de spawn do port) com a forma vista.
 *
 * Frente telas: a lista e a entrada usam o layout do PokedexGUI (`ui/pokedex.json`, SCREEN.POKEDEX): moldura na cor
 * da Pokédex usada (`pokedex_base_<cor>`), grade 5×5 de espaços com o rosto de 32 px de cada espécie conhecida e,
 * na entrada, o perfil 128 px sobre a plataforma do tipo, nome, tipos, formas vistas e o texto rolável.
 */
import { Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, ActionFormResponse, FormCancelationReason, ModalFormData, ModalFormResponse } from "@minecraft/server-ui";
import { FormData as SpeciesFormData, SpeciesData, getFormByName, getSpeciesData } from "../speciesData";
import { SPAWNS } from "../../generated/scripts/spawns";
import { getConfig } from "../Config";
import { DexProgress, PokedexRecords } from "./PokedexRecords";
import { getPokedex } from "./PokedexStorage";
import {
  DexDefinition, DexEntry, DexForm, computeDexCounts, dexNameKey, getDex, getDexes, getEntryKnowledge, getFormsWithKnowledge,
  getNationalEntry,
} from "./DexData";
import { EntryVariationView, describeEntryVariations, humanizeAspect } from "./PokedexVariations";
import { getProgress, goalStatuses, recordFlag } from "./Progress";
import { getSafeTeam } from "../pokemonStorage";
import { SCREEN } from "../ui/screens";
import { typeGlyph } from "../ui/glyphs";
import { BLANK, CellForm, GUI, POKEDEX_ENTRY, POKEDEX_LIST, SUB, layoutTitle } from "../GUI/layout";
import { getPokemonIconTexture, getPokemonProfileTexture } from "../GUI/common";
import { resolveVariant } from "../../generated/scripts/variants";
import { Dex, toID } from "../showdown";
import { getEntityInfo, getRideInfo } from "../entity/EntityData";
import { RIDE_STYLES, RIDING_STATS_DISPLAY, rideStyleLangKey, statRange } from "../pokemon/RideStats";
import { formByDisplay, hasDiscoveredMove, hasUndiscoveredLevelUpTM, moveDexContext, openMoveDex } from "./MoveDex";

/** Chaves de texto do port (pedido de lang em docs/pendencias/captura.md). */
export const DEX_KEYS = {
  counts: "cobblemon.port.pokedex.counts",
  progress: "cobblemon.port.pokedex.progress",
  page: "cobblemon.port.pokedex.page",
  next: "cobblemon.port.pokedex.next",
  previous: "cobblemon.port.pokedex.previous",
  back: "cobblemon.port.pokedex.back",
  searchHint: "cobblemon.port.pokedex.search_hint",
  noResults: "cobblemon.port.pokedex.no_results",
  spawns: "cobblemon.port.pokedex.spawns",
  noSpawns: "cobblemon.port.pokedex.no_spawns",
  catchToLearn: "cobblemon.port.pokedex.catch_to_learn",
  scanning: "cobblemon.port.pokedex.scanning",
  forms: "cobblemon.port.pokedex.forms",
  filter: "cobblemon.port.pokedex.filter",
  // Frente extras-final (variações, progresso e scanner).
  variations: "cobblemon.port.pokedex.variations",
  shinySeen: "cobblemon.port.pokedex.shiny_seen",
  formsSeen: "cobblemon.port.pokedex.forms_seen",
  progressTitle: "cobblemon.port.pokedex.progress_title",
  progressBody: "cobblemon.port.pokedex.progress_body",
  scanNewSpecies: "cobblemon.port.pokedex.scan_new_species",
  scanNewForm: "cobblemon.port.pokedex.scan_new_form",
  scanNewVariation: "cobblemon.port.pokedex.scan_new_variation",
  scanKnown: "cobblemon.port.pokedex.scan_known",
  scanOwned: "cobblemon.port.pokedex.scan_owned",
  scanCancelled: "cobblemon.port.pokedex.scan_cancelled",
  // Frente telas (modo scanner).
  scanAim: "cobblemon.port.pokedex.scan_aim",
} as const;

/** Sons da Pokédex do Cobblemon (`cobblemon.item.pokedex.*` no sound_definitions gerado). */
export const DEX_SOUNDS = {
  open: "cobblemon.item.pokedex.open",
  close: "cobblemon.item.pokedex.close",
  click: "cobblemon.item.pokedex.click",
  clickShort: "cobblemon.item.pokedex.click_short",
  scanOpen: "cobblemon.item.pokedex.scan_open",
  scanClose: "cobblemon.item.pokedex.scan_close",
  scanLoop: "cobblemon.item.pokedex.scan_loop",
  scanDetail: "cobblemon.item.pokedex.scan_detail",
  scanRegisterPokemon: "cobblemon.item.pokedex.scan_register_pokemon",
  scanRegisterAspect: "cobblemon.item.pokedex.scan_register_aspect",
} as const;

/** Toca um som só para o jogador (ignora erros: jogador saiu, som ausente). */
export function playDexSound(player: Player, sound: string, volume = 1, pitch = 1) {
  try { player.playSound(sound, { volume, pitch }); } catch { }
}

/** Espaços por página (grade 5×5 do EntriesScrollingWidget). */
const PAGE_SIZE = 25; // = POKEDEX_LIST.SLOT_COUNT (literal: módulo em ciclo de imports)
const COLOR_PROPERTY = "cobblemon:dex_color";
const DEX_COLORS = ["red", "yellow", "green", "blue", "pink", "black", "white"];

/** Guarda a cor da última Pokédex usada (a moldura da tela usa `pokedex_base_<cor>`). */
export function setDexColor(player: Player, color: string) {
  if (DEX_COLORS.includes(color)) try { player.setDynamicProperty(COLOR_PROPERTY, color); } catch { }
}

function frameTexture(player: Player): string {
  let color = "red";
  try { const value = player.getDynamicProperty(COLOR_PROPERTY); if (typeof value === "string" && DEX_COLORS.includes(value)) color = value; } catch { }
  return `${GUI}/pokedex/pokedex_base_${color}`;
}
const CAUGHT_ICON = "textures/item/poke_balls/poke_ball";

/** PokedexCategoryFilterType (ordem do Cobblemon 1.8.2). */
type Filter = "all" | "owned" | "seen" | "unregistered" | "undiscovered_tm_move" | "rideable";
const FILTERS: Filter[] = ["all", "owned", "seen", "unregistered", "undiscovered_tm_move", "rideable"];
/** SearchByType. */
type SearchBy = "species" | "abilities" | "moves" | "drops";
const SEARCH_TYPES: SearchBy[] = ["species", "abilities", "moves", "drops"];

const tr = (translate: string, ...args: (string | number | RawMessage)[]): RawMessage => args.length === 0
  ? { translate }
  : { translate, with: { rawtext: args.map(arg => typeof arg === "object" ? arg : { text: String(arg) }) } };
const text = (value: string | number): RawMessage => ({ text: String(value) });
const join = (...parts: (RawMessage | string | undefined)[]): RawMessage =>
  ({ rawtext: parts.filter((x): x is RawMessage | string => x !== undefined).map(x => typeof x === "string" ? { text: x } : x) });

/** Nome traduzido da espécie. */
export function speciesName(species: string): RawMessage {
  return { translate: `cobblemon.species.${species}.name` };
}

/** Número nacional formatado ("#025"). */
function dexNumber(species: string): string {
  const n = getSpeciesData(species)?.nationalPokedexNumber ?? 0;
  return `#${String(n).padStart(4, "0")}`;
}

/** Mostra o formulário; se o jogador estiver ocupado (chat aberto), tenta de novo por alguns segundos. */
async function show<T extends ActionFormResponse | ModalFormResponse>(player: Player, form: { show(player: Player): Promise<T> }): Promise<T | undefined> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!player.isValid) return undefined;
    let response: T;
    // Jogador saiu com a tela aberta: FormRejectError vira "fechado" (sem promessa rejeitada solta).
    try { response = await form.show(player); } catch { return undefined; }
    if (response.canceled && response.cancelationReason === FormCancelationReason.UserBusy) {
      await new Promise<void>(resolve => system.runTimeout(() => resolve(), 5));
      continue;
    }
    // Sons da tela do Cobblemon: clique curto nos botões, "fechar" ao sair.
    playDexSound(player, response.canceled ? DEX_SOUNDS.close : DEX_SOUNDS.clickShort, 0.6);
    return response.canceled ? undefined : response;
  }
  return undefined;
}

function isHidden(entry: DexEntry): boolean {
  if (!getConfig().hideUnimplementedPokemonInThePokedex) return false;
  return getSpeciesData(entry.speciesId)?.implemented === false;
}

// ---------------------------------------------------------------------------------------------
// Lista de Pokédex

/** Abre a Pokédex: sem espécie, a lista de Pokédex; com espécie, direto na entrada nacional. */
export async function openPokedex(player: Player, species?: string): Promise<void> {
  if (species) {
    const entry = getNationalEntry(species);
    if (entry) return openEntry(player, entry, "national");
  }
  return openDexList(player);
}

export async function openDexList(player: Player): Promise<void> {
  const records = getPokedex(player);
  const dexes = getDexes();
  const global = computeDexCounts(records);
  const form = new ActionFormData()
    .title({ translate: "item.cobblemon.pokedex_red" })
    .body(tr(DEX_KEYS.counts, global.seen, global.caught));
  for (const dex of dexes) {
    const counts = computeDexCounts(records, dex.id);
    form.button(join({ translate: dexNameKey(dex.id) }, "\n§8", tr(DEX_KEYS.progress, counts.caught, counts.total)));
  }
  form.button({ translate: "cobblemon.ui.pokedex.search" });
  form.button(tr(DEX_KEYS.progressTitle));
  const response = await show(player, form);
  if (response?.selection === undefined) return;
  if (response.selection === dexes.length) return openSearch(player, "national");
  if (response.selection === dexes.length + 1) return openProgress(player);
  const dex = dexes[response.selection];
  if (dex) return openDexPage(player, dex.id, 0, "all");
}

// ---------------------------------------------------------------------------------------------
// Lista de entradas

/** Espécie com alguma forma montável (PokedexCategoryFilter.RIDEABLE: forma padrão e formas). */
export function isRideableSpecies(speciesId: string): boolean {
  const info = getEntityInfo(speciesId);
  if (!info) return false;
  return Object.values(info.ride).some(ride => !!ride && Object.keys(ride.styles).length > 0);
}

/** PokedexCategoryFilter.test. `ctx` (TMs do jogador) só é lido pelo filtro de TM não descoberto. */
export function entryPassesFilter(records: PokedexRecords, entry: DexEntry, filter: Filter, ctx?: ReturnType<typeof moveDexContext>): boolean {
  const knowledge = getEntryKnowledge(records, entry);
  switch (filter) {
    case "all": return true;
    case "owned": return knowledge >= DexProgress.OWNED;
    // SEEN: visto ou capturado (knowledge >= OWNED || == SEEN).
    case "seen": return knowledge !== DexProgress.UNREGISTERED;
    case "unregistered": return knowledge === DexProgress.UNREGISTERED;
    case "rideable": return knowledge !== DexProgress.UNREGISTERED && isRideableSpecies(entry.speciesId);
    case "undiscovered_tm_move": {
      if (knowledge === DexProgress.UNREGISTERED || !ctx) return false;
      const species = getSpeciesData(entry.speciesId);
      if (!species) return false;
      const forms = getFormsWithKnowledge(records, entry, DexProgress.SEEN);
      const datas = forms.length ? forms.map(form => formByDisplay(species, form.displayForm)) : [undefined];
      return datas.some(form => hasUndiscoveredLevelUpTM(entry.speciesId, form, ctx));
    }
  }
}

function applyFilter(records: PokedexRecords, entries: DexEntry[], filter: Filter, ctx?: ReturnType<typeof moveDexContext>): DexEntry[] {
  if (filter === "all") return entries;
  return entries.filter(entry => entryPassesFilter(records, entry, filter, ctx));
}

/** Página de uma Pokédex (40 entradas por página). */
export async function openDexPage(player: Player, dexId: string, page: number, filter: Filter, list?: DexEntry[]): Promise<void> {
  const dex = getDex(dexId);
  if (!dex) return openDexList(player);
  const records = getPokedex(player);
  const entries = list ?? applyFilter(records, dex.getEntries().filter(entry => !isHidden(entry)), filter, moveDexContext(player, records));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const counts = computeDexCounts(records, dex.id);

  const form = new CellForm<() => Promise<void>>(layoutTitle(SCREEN.POKEDEX, SUB.POKEDEX_LIST, { translate: dexNameKey(dex.id) }), POKEDEX_LIST.COUNT)
    .body(join(tr(DEX_KEYS.counts, counts.seen, counts.caught), "\n", tr(DEX_KEYS.page, page + 1, pages),
      entries.length === 0 ? join("\n\n", tr(DEX_KEYS.noResults)) : undefined));
  form.cell(POKEDEX_LIST.FRAME, BLANK, frameTexture(player));
  slice.forEach((entry, i) => {
    const knowledge = getEntryKnowledge(records, entry);
    const number = String(getSpeciesData(entry.speciesId)?.nationalPokedexNumber ?? 0).padStart(4, "0");
    const color = knowledge === DexProgress.OWNED ? "§a" : knowledge === DexProgress.SEEN ? "§f" : "§8";
    // O espaço mostra só o número (o nome/forma fica na entrada); o rosto vem no ícone.
    form.cell(POKEDEX_LIST.SLOTS + i, `${color}${number}`,
      knowledge === DexProgress.UNREGISTERED ? undefined : getPokemonIconTexture(entry.speciesId),
      () => openEntry(player, entry, dexId, () => openDexPage(player, dexId, page, filter, list)));
  });
  if (page > 0) form.cell(POKEDEX_LIST.PREVIOUS, tr(DEX_KEYS.previous), undefined, () => openDexPage(player, dexId, page - 1, filter, list));
  if (page < pages - 1) form.cell(POKEDEX_LIST.NEXT, tr(DEX_KEYS.next), undefined, () => openDexPage(player, dexId, page + 1, filter, list));
  if (!list) {
    const nextFilter = FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length];
    form.cell(POKEDEX_LIST.FILTER, tr(DEX_KEYS.filter, { translate: `cobblemon.ui.pokedex.filter.${nextFilter}` }), undefined, () => openDexPage(player, dexId, 0, nextFilter));
    form.cell(POKEDEX_LIST.SEARCH, { translate: "cobblemon.ui.pokedex.search" }, undefined, () => openSearch(player, dexId));
  }
  form.cell(POKEDEX_LIST.PROGRESS, tr(DEX_KEYS.progressTitle), undefined, () => openProgress(player));
  form.cell(POKEDEX_LIST.BACK, tr(DEX_KEYS.back), undefined, () => list ? openDexPage(player, dexId, 0, "all") : openDexList(player));

  const response = await show(player, form.build());
  if (response?.selection === undefined) return;
  await form.actionAt(response.selection)?.();
}

/**
 * SearchFilter (SearchByType): espécie (nome do Cobblemon/número; o nome traduzido não dá para ler no servidor),
 * habilidade e golpe (só entradas capturadas; golpes só os já descobertos no Move Dex) ou drop.
 */
export function entryMatchesSearch(records: PokedexRecords, entry: DexEntry, query: string, by: SearchBy, ctx?: ReturnType<typeof moveDexContext>): boolean {
  if (!query) return true;
  const knowledge = getEntryKnowledge(records, entry);
  if (knowledge === DexProgress.UNREGISTERED) return false;
  const data = getSpeciesData(entry.speciesId);
  if (!data) return false;
  const forms: (SpeciesFormData | undefined)[] = data.forms?.length ? data.forms : [undefined];
  switch (by) {
    case "abilities": {
      if (knowledge !== DexProgress.OWNED) return false;
      return forms.some(form => (form?.abilities ?? data.abilities ?? []).some(entryId => {
        const id = toID(entryId.replace(/^h:/, "").replace(/^cobblemon:/, ""));
        return id.includes(query.replace(/[^a-z0-9]/g, "")) || (Dex.abilities.get(id).name ?? "").toLowerCase().includes(query);
      }));
    }
    case "moves": {
      if (knowledge !== DexProgress.OWNED || !ctx) return false;
      const caught = getFormsWithKnowledge(records, entry, DexProgress.OWNED);
      const datas = caught.length ? caught.map(form => formByDisplay(data, form.displayForm)) : [undefined];
      return datas.some(form => hasDiscoveredMove(entry.speciesId, form, query, ctx));
    }
    case "drops":
      return forms.some(form => ((form?.drops ?? data.drops)?.entries ?? []).some(drop =>
        drop.item.replace(/^[a-z0-9_]+:/, "").replace(/_/g, " ").includes(query)));
    default: {
      const number = String(data.nationalPokedexNumber ?? "");
      return entry.id.includes(query) || (data.name ?? "").toLowerCase().includes(query) || number === query.replace(/^#?0*/, "");
    }
  }
}

async function openSearch(player: Player, dexId: string): Promise<void> {
  const form = new ModalFormData()
    .title({ translate: "cobblemon.ui.pokedex.search" })
    .dropdown(tr("cobblemon.port.pokedex.search_type"), SEARCH_TYPES.map(type => ({ translate: `cobblemon.ui.pokedex.search.type.${type}` })), { defaultValueIndex: 0 })
    .textField(tr("cobblemon.ui.pokedex.search"), tr(DEX_KEYS.searchHint));
  const response = await show(player, form);
  const by = SEARCH_TYPES[Number(response?.formValues?.[0] ?? 0)] ?? "species";
  const query = String(response?.formValues?.[1] ?? "").trim().toLowerCase();
  if (!query) return openDexPage(player, dexId, 0, "all");
  const dex = getDex(dexId);
  const records = getPokedex(player);
  const ctx = moveDexContext(player, records);
  const results = (dex?.getEntries() ?? []).filter(entry => !isHidden(entry) && entryMatchesSearch(records, entry, query, by, ctx));
  return openDexPage(player, dexId, 0, "all", results);
}

// ---------------------------------------------------------------------------------------------
// Entrada

function formData(species: SpeciesData, displayForm: string): SpeciesFormData | undefined {
  return displayForm.toLowerCase() === "normal" ? undefined : getFormByName(species, displayForm);
}

/** Chave da descrição: campo `pokedex` da forma/espécie ou `cobblemon.species.<espécie>[-<forma>].desc`. */
export function descriptionKeys(speciesId: string, species: SpeciesData, form: SpeciesFormData | undefined): string[] {
  const own = form ? form.pokedex : species.pokedex;
  if (own && own.length > 0) return own;
  if (!form) return [`cobblemon.species.${speciesId}.desc`];
  return [`cobblemon.species.${speciesId}-${form.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.desc`];
}

/** Resumo de onde a espécie aparece (spawns.ts), até 6 linhas. */
export function spawnSummary(speciesId: string, aspects: readonly string[] = []): string[] {
  const lines: string[] = [];
  for (const spawn of SPAWNS) {
    const [species] = spawn.species.split(" ");
    if (species !== speciesId) continue;
    if (aspects.length > 0 && !aspects.every(a => spawn.aspects.includes(a))) continue;
    if (aspects.length === 0 && spawn.aspects.some(a => /alolan|galarian|hisuian|paldean|region-bias/.test(a))) continue;
    const biomes = spawn.condition.biomes ?? [];
    const place = biomes.length > 0
      ? biomes.slice(0, 3).map(b => b.replace(/^[a-z_]+:/, "").replace(/_/g, " ")).join(", ") + (biomes.length > 3 ? ", ..." : "")
      : spawn.positionType;
    const time = spawn.condition.timeRange ? ` · ${spawn.condition.timeRange}` : "";
    const line = `${spawn.bucket} · Lv. ${spawn.minLevel}-${spawn.maxLevel} · ${place}${time}`;
    if (!lines.includes(line)) lines.push(line);
    if (lines.length >= 6) break;
  }
  return lines;
}

const STAT_KEYS: [keyof NonNullable<SpeciesData["baseStats"]>, string][] = [
  ["hp", "hp"], ["attack", "atk"], ["defence", "def"], ["special_attack", "sp_atk"], ["special_defence", "sp_def"], ["speed", "speed"],
];

/** Tela da entrada; `formIndex` escolhe entre as formas vistas. */
export async function openEntry(player: Player, entry: DexEntry, dexId: string, back?: () => Promise<void>, formIndex = 0): Promise<void> {
  const records = getPokedex(player);
  const species = getSpeciesData(entry.speciesId);
  const knowledge = getEntryKnowledge(records, entry);
  const seenForms = getFormsWithKnowledge(records, entry, DexProgress.SEEN);
  const caughtForms = getFormsWithKnowledge(records, entry, DexProgress.OWNED);
  const selected: DexForm | undefined = seenForms[Math.min(formIndex, Math.max(0, seenForms.length - 1))];
  const lines: (RawMessage | string)[] = [];
  const title = knowledge === DexProgress.UNREGISTERED || !species
    ? text(`${dexNumber(entry.speciesId)} ???`)
    : join(`${dexNumber(entry.speciesId)} `, speciesName(entry.speciesId));

  if (!species || knowledge === DexProgress.UNREGISTERED || !selected) {
    lines.push(tr("cobblemon.ui.pokedex.unknown"));
  }
  else {
    const form = formData(species, selected.displayForm);
    const caught = caughtForms.some(x => x.displayForm === selected.displayForm);
    const primary = form?.primaryType ?? species.primaryType;
    const secondary = form && (form.primaryType !== undefined || form.secondaryType !== undefined) ? form.secondaryType : species.secondaryType;
    // Forma
    lines.push(join("§l", { translate: "cobblemon.ui.pokedex.info.form" }, "§r: ", selected.displayForm === "Normal"
      ? { translate: "cobblemon.ui.pokedex.info.form.normal" } : selected.displayForm));
    // Tipos (espécie vista)
    lines.push(join("\n§l", { translate: "cobblemon.ui.info.type" }, "§r: ", { translate: `cobblemon.type.${primary}` },
      secondary ? join(" / ", { translate: `cobblemon.type.${secondary}` }) : undefined));
    // Variações vistas (PokemonInfoWidget: gênero, shiny, formas e variações cosméticas).
    lines.push(...variationLines(describeEntryVariations(records, entry, selected)));
    if (caught) {
      const height = form?.height ?? species.height;
      const weight = form?.weight ?? species.weight;
      lines.push("\n", tr("cobblemon.ui.pokedex.height", (height / 10).toFixed(1)), "   ", tr("cobblemon.ui.pokedex.weight", (weight / 10).toFixed(1)));
      lines.push(join("\n\n§l", { translate: "cobblemon.ui.pokedex.info.entry" }, "§r\n"));
      for (const key of descriptionKeys(entry.speciesId, species, form)) lines.push({ translate: key }, " ");
      const abilities = (form?.abilities ?? species.abilities ?? [])
        .map(a => ({ hidden: a.startsWith("h:"), id: a.replace(/^h:/, "").replace(/^cobblemon:/, "") }))
        .sort((a, b) => Number(a.hidden) - Number(b.hidden));
      lines.push(join("\n\n§l", { translate: "cobblemon.ui.info.ability" }, "§r: "));
      abilities.forEach((a, i) => lines.push(i > 0 ? ", " : "", { translate: `cobblemon.ability.${a.id}` }, a.hidden ? " (H)" : ""));
      const stats = form?.baseStats ?? species.baseStats;
      lines.push(join("\n\n§l", { translate: "cobblemon.ui.pokedex.info.stats" }, "§r"));
      for (const [key, lang] of STAT_KEYS) lines.push("\n", { translate: `cobblemon.ui.stats.${lang}` }, `: ${stats?.[key] ?? "?"}`);
      // StatsWidget.rideProperties: estilos de montaria, assentos e as faixas de cada atributo (frente dados-ui).
      lines.push(...rideLines(entry.speciesId, form?.name ?? ""));
    }
    else {
      lines.push("\n\n§8", tr(DEX_KEYS.catchToLearn), "§r");
    }
    // Drops e spawns: forma vista basta (looseUnlockTabs).
    const drops = (form?.drops ?? species.drops)?.entries ?? [];
    lines.push(join("\n\n§l", { translate: "cobblemon.ui.pokedex.info.drops" }, "§r"));
    if (drops.length === 0) lines.push("\n", tr("cobblemon.ui.pokedex.info.drops_empty"));
    for (const drop of drops) {
      const [namespace, id] = drop.item.includes(":") ? drop.item.split(":", 2) : ["minecraft", drop.item];
      const name: RawMessage = namespace === "cobblemon" ? { translate: `item.cobblemon.${id}` } : { translate: `item.${id}.name` };
      const amount = drop.percentage !== undefined ? `${drop.percentage}%` : drop.quantityRange ? `${drop.quantityRange}×` : "1×";
      lines.push("\n- ", name, ` ${amount}`);
    }
    const spawns = spawnSummary(entry.speciesId, form?.aspects ?? []);
    lines.push(join("\n\n§l", tr(DEX_KEYS.spawns), "§r"));
    if (spawns.length === 0) lines.push("\n", tr(DEX_KEYS.noSpawns));
    for (const line of spawns) lines.push(`\n- ${line}`);
  }

  const form = new CellForm<() => Promise<void>>(layoutTitle(SCREEN.POKEDEX, SUB.POKEDEX_ENTRY, title), POKEDEX_ENTRY.COUNT).body(join(...lines));
  form.cell(POKEDEX_ENTRY.FRAME, BLANK, frameTexture(player));
  form.cell(POKEDEX_ENTRY.NAME, title);
  if (species && knowledge !== DexProgress.UNREGISTERED && selected) {
    const shown = formData(species, selected.displayForm);
    const aspects = shown?.aspects ?? [];
    let variant = 0;
    try { variant = resolveVariant(entry.speciesId, aspects); } catch { }
    const primary = String(shown?.primaryType ?? species.primaryType ?? "normal").toLowerCase();
    const secondary = shown && (shown.primaryType !== undefined || shown.secondaryType !== undefined) ? shown.secondaryType : species.secondaryType;
    form.cell(POKEDEX_ENTRY.PROFILE, BLANK, getPokemonProfileTexture(entry.speciesId, variant));
    form.cell(POKEDEX_ENTRY.PLATFORM, BLANK, `${GUI}/pokedex/platform_base_${primary}`);
    form.cell(POKEDEX_ENTRY.TYPES, join(`§f${typeGlyph(primary)} `, { translate: `cobblemon.type.${primary}` },
      secondary ? join(`  ${typeGlyph(String(secondary).toLowerCase())} `, { translate: `cobblemon.type.${String(secondary).toLowerCase()}` }) : undefined));
    if (caughtForms.some(x => x.displayForm === selected.displayForm)) form.cell(POKEDEX_ENTRY.CAUGHT, BLANK, `${GUI}/pokedex/caught_icon`);
  }
  else form.cell(POKEDEX_ENTRY.PLATFORM, BLANK, `${GUI}/pokedex/platform_base`);
  if (seenForms.length > 1) {
    seenForms.slice(0, POKEDEX_ENTRY.FORM_SLOTS).forEach((x, i) => form.cell(POKEDEX_ENTRY.FORMS + i,
      `${i === formIndex ? "§e" : "§f"}${x.displayForm}`, undefined, () => openEntry(player, entry, dexId, back, i)));
  }
  form.cell(POKEDEX_ENTRY.BACK, tr(DEX_KEYS.back), undefined, back ?? (() => openDexPage(player, dexId, 0, "all")));
  // TAB_MOVES (looseUnlockTabs: basta a forma vista).
  if (species && knowledge !== DexProgress.UNREGISTERED && selected && seenForms.length) {
    form.cell(POKEDEX_ENTRY.MOVES, { translate: "cobblemon.ui.moves" }, undefined, () => openMoveDex(player, records, {
      speciesId: entry.speciesId, forms: seenForms.map(f => f.displayForm), formIndex: Math.min(formIndex, seenForms.length - 1), category: "all", sort: "level",
    }, () => openEntry(player, entry, dexId, back, formIndex)));
  }
  const response = await show(player, form.build());
  if (response?.selection === undefined) return;
  await form.actionAt(response.selection)?.();
}

/** Seção "Montaria" da entrada (StatsWidget.rideProperties): estilo, controlador, assentos e as faixas. */
export function rideLines(speciesId: string, formName: string): (RawMessage | string)[] {
  const info = getRideInfo(speciesId, formName);
  if (!info) return [];
  const lines: (RawMessage | string)[] = [join("\n\n§l", { translate: "cobblemon.ui.pokedex.info.stats_ride" }, "§r  ", tr("cobblemon.ui.pokedex.info.stats_ride.seats", info.seats))];
  for (const style of RIDE_STYLES) {
    const settings = info.styles[style];
    if (!settings) continue;
    lines.push(join("\n§7", { translate: rideStyleLangKey(style, settings.key) }, " | ", { translate: rideStyleLangKey(style) }, "§r"));
    for (const stat of RIDING_STATS_DISPLAY) {
      const [min, max] = statRange(settings, stat);
      lines.push(join("\n  ", { translate: `cobblemon.ui.stats.ride.${stat.toLowerCase()}` }, `: ${min === max ? min : `${min}-${max}`}`));
    }
  }
  return lines;
}

/** Linhas da seção de variações da entrada (vazia se não houver nada além do padrão). */
export function variationLines(view: EntryVariationView): (RawMessage | string)[] {
  const lines: (RawMessage | string)[] = [];
  const seenForms = view.forms.filter(form => form.knowledge !== DexProgress.UNREGISTERED);
  const hasVariations = view.variations.some(variation => variation.seen.length > 0);
  const genders = view.genders.filter(gender => gender !== "genderless");
  if (genders.length === 0 && !view.shinyStates.includes("shiny") && !hasVariations && view.forms.length <= 1) return lines;
  lines.push(join("\n\n§l", tr(DEX_KEYS.variations), "§r"));
  if (genders.length > 0) {
    lines.push(join("\n", { translate: "cobblemon.ui.info.gender" }, ": "));
    genders.forEach((gender, i) => lines.push(i > 0 ? ", " : "", gender === "male" ? "§9♂ " : "§c♀ ", { translate: `cobblemon.gender.${gender}` }, "§r"));
  }
  if (view.shinyStates.includes("shiny")) lines.push("\n§6", tr(DEX_KEYS.shinySeen), "§r");
  if (view.forms.length > 1) {
    lines.push("\n", tr(DEX_KEYS.formsSeen, seenForms.length, view.forms.length), ": ");
    seenForms.forEach((form, i) => lines.push(i > 0 ? ", " : "", form.knowledge === DexProgress.OWNED ? "§2" : "§0",
      form.displayForm.toLowerCase() === "normal" ? { translate: "cobblemon.ui.pokedex.info.form.normal" } : form.displayForm, "§r"));
  }
  for (const variation of view.variations) {
    if (variation.seen.length === 0) continue;
    lines.push("\n", { translate: variation.displayName }, ` (${variation.seen.length}/${variation.total}): `,
      variation.seen.map(aspect => humanizeAspect(aspect, variation.aspects)).join(", "));
  }
  return lines;
}

/**
 * "Progresso Cobblemon": objetivos das conquistas da aba de captura (o Bedrock não aceita conquistas de add-on).
 * Feito = verde com ✔; em andamento mostra a contagem.
 */
export async function openProgress(player: Player): Promise<void> {
  try {
    if (getSafeTeam(player).filter(pokemon => !!pokemon).length >= 6) recordFlag(player, "full_party");
  }
  catch { }
  const statuses = goalStatuses(getProgress(player));
  const done = statuses.filter(status => status.done).length;
  const lines: (RawMessage | string)[] = [tr(DEX_KEYS.progressBody), `\n§8${done}/${statuses.length}§r\n`];
  for (const { goal, value, done } of statuses) {
    const count = goal.target > 1 ? ` (${value}/${goal.target})` : "";
    lines.push(done ? "\n§2✔ §l" : "\n§8✘ §l", { translate: `advancements.cobblemon.${goal.id}` }, `§r${done ? "§2" : "§8"}${count}\n§7`,
      { translate: `advancements.cobblemon.${goal.id}.description` }, "§r");
  }
  const form = new ActionFormData().title(tr(DEX_KEYS.progressTitle)).body(join(...lines)).button(tr(DEX_KEYS.back));
  const response = await show(player, form);
  if (response?.selection === 0) return openDexList(player);
}

/** Nome traduzido de uma Pokédex (para outras telas). */
export function dexName(dex: DexDefinition): RawMessage {
  return { translate: dexNameKey(dex.id) };
}
