/**
 * Variações da entrada da Pokédex (frente extras-final), port de `client/gui/pokedex/widgets/PokemonInfoWidget.kt`
 * (botões de gênero, shiny e `variations`) e de `AbstractPokedexManager.getNewInformation`.
 *
 * No Cobblemon os botões trocam o modelo 3D da entrada; no Bedrock (formulários do server-ui, sem modelo) a entrada
 * lista o que o jogador já viu: gêneros e estados de shiny da forma, formas vistas e, por variação cosmética, os
 * aspectos já registrados. Puro (sem API do Minecraft).
 */
import { DexEntry, DexForm } from "./DexData";
import { DexPokemonInfo, DexProgress, GENDER_BITS, PokedexRecords, SHINY_BITS, genderBit } from "./PokedexRecords";

/** PokedexLearnedInformation. */
export enum LearnedInformation {
  NONE = 0,
  SPECIES = 1,
  FORM = 2,
  VARIATION = 3,
}

/** AbstractPokedexManager.getNewInformation: o que o escaneamento deste Pokémon acrescentaria à Pokédex. */
export function getNewInformation(records: PokedexRecords, info: DexPokemonInfo): LearnedInformation {
  const species = records.getSpeciesRecord(info.species);
  if (!species || records.getKnowledgeForSpecies(info.species) === DexProgress.UNREGISTERED) return LearnedInformation.SPECIES;
  const form = records.getFormRecord(info.species, info.form || "Normal");
  if (!form || form.knowledge === DexProgress.UNREGISTERED) return LearnedInformation.FORM;
  if (info.aspects.some(aspect => !species.aspects.has(aspect))
    || (form.genders & genderBit(info.gender)) === 0
    || (form.shinyStates & (info.shiny ? SHINY_BITS.shiny : SHINY_BITS.normal)) === 0)
    return LearnedInformation.VARIATION;
  return LearnedInformation.NONE;
}

export type SeenGender = "male" | "female" | "genderless";
export type SeenShinyState = "normal" | "shiny";

export interface VariationView {
  /** Chave de tradução do nome da variação. */
  displayName: string;
  icon?: string;
  /** Aspectos da variação já registrados (sem o ""), na ordem do Cobblemon. */
  seen: string[];
  /** Quantos aspectos a variação tem (sem o ""). */
  total: number;
  /** Todos os aspectos (para o rótulo legível). */
  aspects: string[];
}

export interface EntryVariationView {
  genders: SeenGender[];
  shinyStates: SeenShinyState[];
  variations: VariationView[];
  /** Aspectos de exibição da entrada (só mudam o modelo 3D). */
  displayAspects: string[];
  /** Formas da entrada com o conhecimento de cada uma. */
  forms: { displayForm: string; knowledge: DexProgress }[];
}

/** Bits de gênero e shiny vistos numa forma exibida (somando as formas de desbloqueio dela). */
function formBits(records: PokedexRecords, speciesId: string, form: DexForm): { genders: number; shiny: number } {
  let genders = 0, shiny = 0;
  for (const name of new Set([form.displayForm, ...form.unlockForms])) {
    const record = records.getFormRecord(speciesId, name);
    if (!record || record.knowledge === DexProgress.UNREGISTERED) continue;
    genders |= record.genders;
    shiny |= record.shinyStates;
  }
  return { genders, shiny };
}

function formKnowledge(records: PokedexRecords, speciesId: string, form: DexForm): DexProgress {
  let best = DexProgress.UNREGISTERED;
  for (const name of form.unlockForms) {
    const knowledge = records.getFormKnowledge(speciesId, name);
    if (knowledge > best) best = knowledge;
  }
  return best;
}

/**
 * O que a entrada mostra de variações para a forma exibida `form` (PokemonInfoWidget.setupButtons):
 * gêneros vistos (sem o "sem gênero" quando há macho/fêmea), estados de shiny vistos e, por variação,
 * os aspectos que o registro da espécie já tem.
 */
export function describeEntryVariations(records: PokedexRecords, entry: DexEntry, form: DexForm | undefined): EntryVariationView {
  const record = records.getSpeciesRecord(entry.speciesId);
  const bits = form ? formBits(records, entry.speciesId, form) : { genders: 0, shiny: 0 };
  const genders: SeenGender[] = [];
  if (bits.genders & GENDER_BITS.m) genders.push("male");
  if (bits.genders & GENDER_BITS.f) genders.push("female");
  if (genders.length === 0 && bits.genders & GENDER_BITS.n) genders.push("genderless");
  const shinyStates: SeenShinyState[] = [];
  if (bits.shiny & SHINY_BITS.normal) shinyStates.push("normal");
  if (bits.shiny & SHINY_BITS.shiny) shinyStates.push("shiny");
  const variations = (entry.variations ?? []).map(variation => {
    const aspects = variation.aspects.filter(aspect => aspect !== "");
    return {
      displayName: variation.displayName,
      icon: variation.icon,
      seen: aspects.filter(aspect => record?.aspects.has(aspect) ?? false),
      total: aspects.length,
      aspects,
    };
  });
  return {
    genders,
    shinyStates,
    variations,
    displayAspects: [...(entry.displayAspects ?? [])],
    forms: entry.getForms().map(x => ({ displayForm: x.displayForm, knowledge: formKnowledge(records, entry.speciesId, x) })),
  };
}

/**
 * Rótulo legível de um aspecto de variação, sem o prefixo comum às irmãs
 * ("vivillon-wings-high-plains" entre "vivillon-wings-*" → "High Plains"). O servidor não sabe se existe a chave
 * `cobblemon.ui.pokedex.info.form.<aspecto>` (só metade dos aspectos tem), então o texto é montado aqui.
 */
export function humanizeAspect(aspect: string, siblings: readonly string[] = []): string {
  const tokens = aspect.split(/[-_]/).filter(Boolean);
  const others = siblings.filter(x => x !== "" && x !== aspect).map(x => x.split(/[-_]/).filter(Boolean));
  let prefix = 0;
  if (others.length > 0) {
    prefix = tokens.length - 1;
    for (const other of others) {
      let common = 0;
      while (common < prefix && common < other.length - 1 && other[common] === tokens[common]) common++;
      prefix = Math.min(prefix, common);
    }
  }
  return tokens.slice(prefix).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
