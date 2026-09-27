/**
 * Registros da Pokédex por jogador, port de `api/pokedex/{AbstractPokedexManager,PokedexManager,
 * SpeciesDexRecord,FormDexRecord,PokedexValueCalculator}.kt` (Cobblemon 1.8.2).
 *
 * Puro (sem API do Minecraft). A serialização é compacta, uma linha por espécie:
 *   `<espécie>\t<maiorNível>\t<aspecto,aspecto>\t<forma>:<K>:<G>:<S>:<nível>;...`
 * K = conhecimento (1 visto, 2 capturado), G = gêneros vistos (bits: 1 macho, 2 fêmea, 4 sem gênero),
 * S = estados de shiny vistos (bits: 1 normal, 2 shiny), nível vazio = -1.
 */

/** PokedexEntryProgress. */
export enum DexProgress {
  UNREGISTERED = 0,
  SEEN = 1,
  OWNED = 2,
}

/** O que a Pokédex precisa saber de um Pokémon (PokedexEntityData). */
export interface DexPokemonInfo {
  /** Id da espécie sem namespace ("pikachu"). */
  species: string;
  /** Nome da forma ("Normal", "Alola-Bias"). */
  form: string;
  aspects: readonly string[];
  /** "m", "f" ou "" (sem gênero). */
  gender?: string;
  shiny?: boolean;
  level?: number;
}

export const GENDER_BITS = { m: 1, f: 2, n: 4 } as const;
export const SHINY_BITS = { normal: 1, shiny: 2 } as const;

export interface FormDexRecord {
  knowledge: DexProgress;
  /** Bits de GENDER_BITS. */
  genders: number;
  /** Bits de SHINY_BITS. */
  shinyStates: number;
  highestLevel: number;
}

export interface SpeciesDexRecord {
  aspects: Set<string>;
  highestLevel: number;
  /** Chave = nome da forma em minúsculas (SpeciesDexRecord.getOrCreateFormRecord). */
  forms: Map<string, FormDexRecord>;
}

/** Bit do gênero do port ("m", "f", "" / outro = sem gênero). */
export function genderBit(gender: string | undefined): number {
  const g = (gender ?? "").toLowerCase();
  if (g === "m" || g === "male") return GENDER_BITS.m;
  if (g === "f" || g === "female") return GENDER_BITS.f;
  return GENDER_BITS.n;
}

function newForm(): FormDexRecord {
  return { knowledge: DexProgress.UNREGISTERED, genders: 0, shinyStates: 0, highestLevel: -1 };
}

export class PokedexRecords {
  readonly species = new Map<string, SpeciesDexRecord>();
  private cachedCounts?: { seen: number; caught: number };

  // -------------------------------------------------------------------------------------------
  // Consulta

  getSpeciesRecord(species: string): SpeciesDexRecord | undefined {
    return this.species.get(species);
  }

  getFormRecord(species: string, form: string): FormDexRecord | undefined {
    return this.species.get(species)?.forms.get(form.toLowerCase());
  }

  /** getKnowledgeForSpecies: maior conhecimento entre as formas. */
  getKnowledgeForSpecies(species: string): DexProgress {
    const record = this.species.get(species);
    if (!record) return DexProgress.UNREGISTERED;
    let best = DexProgress.UNREGISTERED;
    for (const form of record.forms.values()) if (form.knowledge > best) best = form.knowledge;
    return best;
  }

  getFormKnowledge(species: string, form: string): DexProgress {
    return this.getFormRecord(species, form)?.knowledge ?? DexProgress.UNREGISTERED;
  }

  /** CaughtCount (global): espécies com alguma forma capturada. */
  getCaughtCount(): number {
    return this.getCounts().caught;
  }

  /** SeenCount (global): espécies vistas ou capturadas. */
  getSeenCount(): number {
    return this.getCounts().seen;
  }

  private getCounts() {
    if (!this.cachedCounts) {
      let seen = 0, caught = 0;
      for (const id of this.species.keys()) {
        const knowledge = this.getKnowledgeForSpecies(id);
        if (knowledge !== DexProgress.UNREGISTERED) seen++;
        if (knowledge === DexProgress.OWNED) caught++;
      }
      this.cachedCounts = { seen, caught };
    }
    return this.cachedCounts;
  }

  // -------------------------------------------------------------------------------------------
  // Atualização (encountered / obtained)

  /** PokedexManager.encounter. Retorna verdadeiro se algo mudou. */
  encounter(info: DexPokemonInfo): boolean {
    return this.register(info, DexProgress.SEEN);
  }

  /** PokedexManager.obtain. Retorna verdadeiro se algo mudou. */
  obtain(info: DexPokemonInfo): boolean {
    return this.register(info, DexProgress.OWNED);
  }

  private getOrCreateSpecies(species: string): SpeciesDexRecord {
    let record = this.species.get(species);
    if (!record) {
      record = { aspects: new Set(), highestLevel: -1, forms: new Map() };
      this.species.set(species, record);
    }
    return record;
  }

  private getOrCreateForm(record: SpeciesDexRecord, form: string): FormDexRecord {
    const key = form.toLowerCase();
    let formRecord = record.forms.get(key);
    if (!formRecord) {
      formRecord = newForm();
      record.forms.set(key, formRecord);
    }
    return formRecord;
  }

  /** FormDexRecord.wouldBeDifferent. */
  wouldBeDifferent(info: DexPokemonInfo, knowledge: DexProgress): boolean {
    const record = this.species.get(info.species);
    const form = record?.forms.get(info.form.toLowerCase());
    if (!record || !form) return true;
    const level = info.level ?? -1;
    return (form.genders & genderBit(info.gender)) === 0
      || (form.shinyStates & (info.shiny ? SHINY_BITS.shiny : SHINY_BITS.normal)) === 0
      || knowledge > form.knowledge
      || (form.highestLevel < level && knowledge === DexProgress.OWNED)
      || info.aspects.some(aspect => !record.aspects.has(aspect));
  }

  private register(info: DexPokemonInfo, knowledge: DexProgress): boolean {
    if (!info.species) return false;
    if (!this.wouldBeDifferent(info, knowledge)) return false;
    const record = this.getOrCreateSpecies(info.species);
    const form = this.getOrCreateForm(record, info.form || "Normal");
    const level = info.level ?? -1;
    // FormDexRecord.addInformation
    form.genders |= genderBit(info.gender);
    form.shinyStates |= info.shiny ? SHINY_BITS.shiny : SHINY_BITS.normal;
    if (knowledge === DexProgress.OWNED) form.highestLevel = Math.max(form.highestLevel, level);
    if (knowledge > form.knowledge) form.knowledge = knowledge;
    // SpeciesDexRecord.addInformation
    for (const aspect of info.aspects) record.aspects.add(aspect);
    if (knowledge === DexProgress.OWNED) record.highestLevel = Math.max(record.highestLevel, level);
    this.cachedCounts = undefined;
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Comando /pokedex

  /** setKnowledgeProgress + addAllShinyStatesAndGenders (grant). */
  grantForm(species: string, form: string, knowledge: DexProgress, genders: number, maxLevel: number, aspects: readonly string[] = []) {
    const record = this.getOrCreateSpecies(species);
    const formRecord = this.getOrCreateForm(record, form);
    formRecord.knowledge = knowledge;
    formRecord.genders |= genders;
    formRecord.shinyStates |= SHINY_BITS.normal | SHINY_BITS.shiny;
    formRecord.highestLevel = maxLevel;
    for (const aspect of aspects) record.aspects.add(aspect);
    this.cachedCounts = undefined;
  }

  deleteSpecies(species: string): boolean {
    this.cachedCounts = undefined;
    return this.species.delete(species);
  }

  /** deleteFormRecord: apaga a espécie se não sobrar forma. */
  deleteForm(species: string, form: string): boolean {
    const record = this.species.get(species);
    if (!record) return false;
    const removed = record.forms.delete(form.toLowerCase());
    if (record.forms.size === 0) this.species.delete(species);
    this.cachedCounts = undefined;
    return removed;
  }

  clear() {
    this.species.clear();
    this.cachedCounts = undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Serialização

  serialize(): string {
    const lines: string[] = [FORMAT_HEADER];
    const ids = [...this.species.keys()].sort();
    for (const id of ids) {
      const record = this.species.get(id)!;
      if (record.forms.size === 0) continue;
      const forms = [...record.forms.entries()].map(([name, form]) =>
        [esc(name), form.knowledge, form.genders, form.shinyStates, form.highestLevel < 0 ? "" : form.highestLevel].join(":"));
      lines.push([esc(id), record.highestLevel < 0 ? "" : record.highestLevel, [...record.aspects].map(esc).join(","), forms.join(";")].join("\t"));
    }
    return lines.join("\n");
  }

  static parse(text: string | undefined): PokedexRecords {
    const records = new PokedexRecords();
    if (!text) return records;
    const lines = text.split("\n");
    if (lines[0] !== FORMAT_HEADER) return records;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const [id, level, aspects, forms] = line.split("\t");
      if (!id) continue;
      const record: SpeciesDexRecord = {
        aspects: new Set(aspects ? aspects.split(",").map(unesc) : []),
        highestLevel: parseLevel(level),
        forms: new Map(),
      };
      for (const part of (forms ?? "").split(";")) {
        if (!part) continue;
        const [name, knowledge, genders, shiny, formLevel] = part.split(":");
        const k = Number(knowledge);
        record.forms.set(unesc(name), {
          knowledge: k === DexProgress.OWNED ? DexProgress.OWNED : k === DexProgress.SEEN ? DexProgress.SEEN : DexProgress.UNREGISTERED,
          genders: Number(genders) & 7,
          shinyStates: Number(shiny) & 3,
          highestLevel: parseLevel(formLevel),
        });
      }
      if (record.forms.size > 0) records.species.set(unesc(id), record);
    }
    return records;
  }
}

const FORMAT_HEADER = "cdex1";

function parseLevel(value: string | undefined): number {
  if (!value) return -1;
  const n = Number(value);
  return Number.isFinite(n) ? n : -1;
}

/** Escapa os separadores do formato (e o próprio %). */
function esc(value: string): string {
  return value.replace(/[%\t\n;:,]/g, ch => `%${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

function unesc(value: string): string {
  return value.replace(/%([0-9a-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ---------------------------------------------------------------------------------------------
// Pedaços (dynamic properties de string têm limite de 32767 bytes)

/** Tamanho máximo de cada pedaço em bytes UTF-8 (folga abaixo de 32 KB). */
export const MAX_CHUNK_BYTES = 30000;

function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** Divide o texto em pedaços de no máximo `maxBytes` bytes UTF-8, sem partir caracteres. */
export function splitIntoChunks(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let start = 0, bytes = 0, i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i)!;
    const size = utf8Length(codePoint);
    const units = codePoint > 0xffff ? 2 : 1;
    if (bytes + size > maxBytes) {
      chunks.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += units;
  }
  if (start < text.length || chunks.length === 0) chunks.push(text.slice(start));
  return chunks;
}

/** Tamanho em bytes UTF-8. */
export function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i)!;
    bytes += utf8Length(codePoint);
    if (codePoint > 0xffff) i++;
  }
  return bytes;
}
