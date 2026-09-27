/**
 * Definições de Pokédex (regionais + nacional) e entradas, port de `api/pokedex/{Dexes,def/*,entry/*}.kt`.
 *
 * Fonte exata: `data/cobblemon/dexes` e `data/cobblemon/dex_entries`, que o importador deve gerar
 * (pedido em docs/pendencias/captura.md) e entregar via `setDexData`. Enquanto isso, as Pokédex são
 * derivadas das espécies importadas: faixa do número nacional por região + formas regionais (rótulos
 * alolan_form/galarian_form/hisuian_form/paldean_form) como entradas próprias, que reproduz as contagens do
 * Cobblemon 1.8.2 (Kanto 151, Johto 100, ..., Alola 108, Galar 110, Hisui 34, Paldea 122, Unknown 2).
 */
import { SPECIES } from "../../generated/scripts/species";
import { getSpeciesData, toSpeciesId } from "../speciesData";
import { DexProgress, PokedexRecords } from "./PokedexRecords";

export interface DexForm {
  displayForm: string;
  unlockForms: string[];
}

/** PokedexCosmeticVariation: botão que alterna entre aspectos cosméticos (padrão de asa, cor, enfeite...). */
export interface DexVariation {
  /** Chave de tradução ("cobblemon.pokedex.variation.pattern"). */
  displayName: string;
  /** Textura do ícone no Cobblemon ("cobblemon:textures/gui/pokedex/variation/pattern.png"). */
  icon?: string;
  /** Aspectos possíveis; "" = sem aspecto. */
  aspects: string[];
}

export interface DexEntry {
  /** Id da entrada sem namespace ("pikachu", "pikachu-alolabias"). */
  id: string;
  /** Espécie sem namespace. */
  speciesId: string;
  conditionAspects: string[];
  /** Aspectos sempre aplicados ao desenhar a entrada (PokedexEntry.displayAspects). */
  displayAspects?: string[];
  /** Variações cosméticas (PokedexEntry.variations). */
  variations?: DexVariation[];
  /** Formas exibidas; resolvidas sob demanda no modo derivado. */
  getForms(): DexForm[];
}

export interface DexDefinition {
  /** Id sem namespace ("national", "kanto"). */
  id: string;
  sortOrder: number;
  getEntries(): DexEntry[];
}

// ---------------------------------------------------------------------------------------------
// Formato do Cobblemon (entrada de setDexData)

export interface CobblemonDexEntryJson {
  id: string;
  speciesId: string;
  conditionAspects?: string[];
  displayAspects?: string[];
  forms?: { displayForm: string; unlockForms?: string[] }[];
  variations?: unknown[];
}

/** Variação do JSON (formato de PokedexCosmeticVariation) validada; entradas inválidas são ignoradas. */
export function parseVariations(raw: unknown[] | undefined): DexVariation[] {
  const out: DexVariation[] = [];
  for (const item of raw ?? []) {
    if (!item || typeof item !== "object") continue;
    const json = item as { displayName?: unknown; icon?: unknown; aspects?: unknown };
    const aspects = Array.isArray(json.aspects) ? json.aspects.filter((a): a is string => typeof a === "string") : [];
    if (aspects.length === 0) continue;
    out.push({
      displayName: typeof json.displayName === "string" ? json.displayName : "cobblemon.pokedex.variation.cosmetic",
      icon: typeof json.icon === "string" ? json.icon : undefined,
      aspects,
    });
  }
  return out;
}

export interface CobblemonDexJson {
  id: string;
  type?: string;
  sortOrder?: number;
  entries?: string[];
  subDexIds?: string[];
  squash?: boolean;
}

const strip = (id: string) => id.replace(/^[a-z0-9_.-]+:/, "");

let dexes: DexDefinition[] | undefined;
let exactData: { dexes: CobblemonDexJson[]; entries: CobblemonDexEntryJson[] } | undefined;

/** Substitui as Pokédex derivadas pelos dados exatos do Cobblemon (dexes + dex_entries). */
export function setDexData(dexJsons: CobblemonDexJson[], entryJsons: CobblemonDexEntryJson[]) {
  exactData = { dexes: dexJsons, entries: entryJsons };
  dexes = undefined;
}

/** Pokédex ordenadas por sortOrder (a nacional primeiro). */
export function getDexes(): DexDefinition[] {
  if (!dexes) dexes = exactData ? buildExact(exactData.dexes, exactData.entries) : buildDerived();
  return dexes;
}

export function getDex(id: string): DexDefinition | undefined {
  const plain = strip(id);
  return getDexes().find(dex => dex.id === plain);
}

/** Chave de tradução do nome da Pokédex. */
export function dexNameKey(dexId: string): string {
  return `cobblemon.ui.pokedex.region.${strip(dexId)}`;
}

/** Entrada da espécie na Pokédex nacional (todas as formas juntas). */
export function getNationalEntry(species: string): DexEntry | undefined {
  const id = toSpeciesId(species);
  return getDex("national")?.getEntries().find(entry => entry.speciesId === id);
}

// ---------------------------------------------------------------------------------------------
// Aglutinação (AggregatePokedexDef.squash / PokedexEntry.combinedWith)

function combineEntries(a: DexEntry, b: DexEntry): DexEntry {
  // PokedexEntry.combinedWith: variações novas (por displayName) e aspectos de exibição da primeira entrada.
  const variations = [...(a.variations ?? [])];
  for (const variation of b.variations ?? [])
    if (!variations.some(x => x.displayName === variation.displayName)) variations.push(variation);
  return {
    id: a.id,
    speciesId: a.speciesId,
    conditionAspects: a.conditionAspects,
    displayAspects: a.displayAspects,
    variations,
    getForms() {
      const forms = a.getForms().map(form => ({ displayForm: form.displayForm, unlockForms: [...form.unlockForms] }));
      for (const form of b.getForms()) {
        const existing = forms.find(x => x.displayForm === form.displayForm);
        if (existing) existing.unlockForms.push(...form.unlockForms);
        else forms.push({ displayForm: form.displayForm, unlockForms: [...form.unlockForms] });
      }
      return forms;
    },
  };
}

function aggregate(id: string, sortOrder: number, subDexIds: string[], squash: boolean, lookup: (id: string) => DexDefinition | undefined): DexDefinition {
  let cached: DexEntry[] | undefined;
  return {
    id, sortOrder,
    getEntries() {
      if (cached) return cached;
      const subEntries = subDexIds.map(sub => lookup(strip(sub))?.getEntries() ?? []);
      if (!squash) return cached = subEntries.flat();
      const bySpecies = new Map<string, DexEntry>();
      for (const entries of subEntries) for (const entry of entries) {
        const existing = bySpecies.get(entry.speciesId);
        bySpecies.set(entry.speciesId, existing ? combineEntries(existing, entry) : entry);
      }
      return cached = [...bySpecies.values()];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Dados exatos

function buildExact(dexJsons: CobblemonDexJson[], entryJsons: CobblemonDexEntryJson[]): DexDefinition[] {
  const entries = new Map<string, DexEntry>();
  for (const json of entryJsons) {
    const forms = (json.forms ?? []).map(form => ({ displayForm: form.displayForm, unlockForms: form.unlockForms ?? [form.displayForm] }));
    entries.set(strip(json.id), {
      id: strip(json.id),
      speciesId: strip(json.speciesId),
      conditionAspects: json.conditionAspects ?? [],
      displayAspects: json.displayAspects ?? [],
      variations: parseVariations(json.variations),
      getForms: () => forms,
    });
  }
  const result: DexDefinition[] = [];
  const lookup = (id: string) => result.find(dex => dex.id === id);
  for (const json of dexJsons) {
    const id = strip(json.id);
    if (json.subDexIds) result.push(aggregate(id, json.sortOrder ?? 0, json.subDexIds, json.squash ?? true, lookup));
    else {
      const list = (json.entries ?? []).map(entry => entries.get(strip(entry))).filter((x): x is DexEntry => !!x);
      result.push({ id, sortOrder: json.sortOrder ?? 0, getEntries: () => list });
    }
  }
  return result.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------------------------
// Dados derivados das espécies

/** Regiões na ordem da Pokédex nacional do Cobblemon (subDexIds de national.json) e sortOrder. */
export const REGIONS: { id: string; sortOrder: number; formLabel?: string; range?: [number, number] }[] = [
  { id: "kanto", sortOrder: 1, range: [1, 151] },
  { id: "johto", sortOrder: 2, range: [152, 251] },
  { id: "hoenn", sortOrder: 3, range: [252, 386] },
  { id: "sinnoh", sortOrder: 4, range: [387, 493] },
  { id: "unova", sortOrder: 5, range: [494, 649] },
  { id: "kalos", sortOrder: 6, range: [650, 721] },
  { id: "alola", sortOrder: 7, range: [722, 807], formLabel: "alolan_form" },
  { id: "unknown", sortOrder: 8, range: [808, 809] },
  { id: "galar", sortOrder: 9, range: [810, 898], formLabel: "galarian_form" },
  { id: "hisui", sortOrder: 10, range: [899, 905], formLabel: "hisuian_form" },
  { id: "paldea", sortOrder: 11, range: [906, 1025], formLabel: "paldean_form" },
];

const REGIONAL_LABELS = REGIONS.filter(r => r.formLabel).map(r => r.formLabel!);

/** Região pela numeração nacional. */
export function regionForNumber(dexNumber: number): string {
  return REGIONS.find(r => r.range && dexNumber >= r.range[0] && dexNumber <= r.range[1])?.id ?? "unknown";
}

/** Id de entrada de uma forma regional ("pikachu" + "Alola-Bias" → "pikachu-alolabias"). */
export function formEntryId(species: string, formName: string): string {
  return `${species}-${formName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

function baseEntry(species: string): DexEntry {
  return {
    id: species,
    speciesId: species,
    conditionAspects: [],
    getForms() {
      const data = getSpeciesData(species);
      const forms: DexForm[] = [{ displayForm: "Normal", unlockForms: ["Normal"] }];
      for (const form of data?.forms ?? []) {
        // As formas de batalha (Mega, Gmax) também aparecem na entrada, como no Cobblemon.
        if ((form.labels ?? []).some(label => REGIONAL_LABELS.includes(label))) continue;
        forms.push({ displayForm: form.name, unlockForms: [form.name] });
      }
      return forms;
    },
  };
}

function buildDerived(): DexDefinition[] {
  const numbers = new Map<string, number>();
  const regionEntries = new Map<string, { number: number; order: number; entry: DexEntry }[]>();
  for (const region of REGIONS) regionEntries.set(region.id, []);
  for (const [species, json] of Object.entries(SPECIES)) {
    // Só o número nacional, sem parsear o JSON inteiro (watchdog).
    const match = /"nationalPokedexNumber":(\d+)/.exec(json);
    const dexNumber = match ? Number(match[1]) : 0;
    numbers.set(species, dexNumber);
    regionEntries.get(regionForNumber(dexNumber))!.push({ number: dexNumber, order: 0, entry: baseEntry(species) });
    if (!REGIONAL_LABELS.some(label => json.includes(`"${label}"`))) continue;
    // Formas regionais: só estas espécies são parseadas.
    for (const form of getSpeciesData(species)?.forms ?? []) {
      const region = REGIONS.find(r => r.formLabel && (form.labels ?? []).includes(r.formLabel));
      if (!region) continue;
      const formName = form.name;
      regionEntries.get(region.id)!.push({
        number: dexNumber, order: 1,
        entry: {
          id: formEntryId(species, formName), speciesId: species, conditionAspects: [],
          getForms: () => [{ displayForm: formName, unlockForms: [formName] }],
        },
      });
    }
  }
  const result: DexDefinition[] = [];
  for (const region of REGIONS) {
    const list = regionEntries.get(region.id)!
      .sort((a, b) => (a.order - b.order) || (a.number - b.number) || a.entry.id.localeCompare(b.entry.id))
      .map(x => x.entry);
    result.push({ id: region.id, sortOrder: region.sortOrder, getEntries: () => list });
  }
  result.push(aggregate("national", 0, REGIONS.map(r => r.id), true, id => result.find(dex => dex.id === id)));
  return result.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------------------------
// Contagens (PokedexValueCalculator)

export interface DexCounts {
  seen: number;
  caught: number;
  total: number;
}

/** SeenCount/CaughtCount de uma Pokédex (por entrada) ou globais (por espécie) se `dexId` faltar. */
export function computeDexCounts(records: PokedexRecords, dexId?: string): DexCounts {
  if (!dexId) {
    const total = getDex("national")?.getEntries().length ?? 0;
    return { seen: records.getSeenCount(), caught: records.getCaughtCount(), total };
  }
  const entries = getDex(dexId)?.getEntries() ?? [];
  let seen = 0, caught = 0;
  for (const entry of entries) {
    const knowledge = records.getKnowledgeForSpecies(entry.speciesId);
    if (knowledge !== DexProgress.UNREGISTERED) seen++;
    if (knowledge === DexProgress.OWNED) caught++;
  }
  return { seen, caught, total: entries.length };
}

/**
 * getHighestKnowledgeFor(entry): maior conhecimento entre as formas de desbloqueio da entrada
 * (exige os conditionAspects já vistos).
 */
export function getEntryKnowledge(records: PokedexRecords, entry: DexEntry): DexProgress {
  const record = records.getSpeciesRecord(entry.speciesId);
  if (!record) return DexProgress.UNREGISTERED;
  if (!entry.conditionAspects.every(aspect => record.aspects.has(aspect))) return DexProgress.UNREGISTERED;
  let best = DexProgress.UNREGISTERED;
  for (const form of entry.getForms())
    for (const unlock of form.unlockForms) {
      const knowledge = records.getFormKnowledge(entry.speciesId, unlock);
      if (knowledge > best) best = knowledge;
    }
  return best;
}

/** getFormsWithKnowledge: formas da entrada com pelo menos esse conhecimento. */
export function getFormsWithKnowledge(records: PokedexRecords, entry: DexEntry, knowledge: DexProgress): DexForm[] {
  const record = records.getSpeciesRecord(entry.speciesId);
  if (!record) return [];
  if (!entry.conditionAspects.every(aspect => record.aspects.has(aspect))) return [];
  return entry.getForms().filter(form => form.unlockForms.some(unlock => records.getFormKnowledge(entry.speciesId, unlock) >= knowledge));
}
