/**
 * Times de NPC (api/npc/partyproviders): SimplePartyProvider e PoolPartyProvider do Cobblemon 1.8.2.
 *
 * - simple: lista de PokemonProperties; sem `level=` usa o nível do NPC.
 * - pool: sorteia entre `minPokemon` e `maxPokemon` Pokémon da pool, só entradas cujo `npcLevels` contém o
 *   nível do NPC; peso `-1` = escolha garantida; cada entrada sai no máximo `selectableTimes` vezes; nível =
 *   `level` da entrada, senão o do NPC + 0..`levelVariation`. `useFixedRandom` usa o UUID do NPC como semente.
 * - script (ScriptPartyProvider): roda o script MoLang com q.npc, q.level, q.players, q.player e q.party (o time
 *   em montagem: `add_by_properties`, `count`...); script inexistente → um Magikarp, como no Cobblemon.
 * - composed_pool (ComposedPoolPartyProvider): pool rotulada (party_pools) + composição de 6 posições
 *   (party_compositions); min/max, pesos, faixas e repetições são MoLang. `movesetBuilders` das entradas não são
 *   aplicados (os golpes saem do nível, como os de qualquer Pokémon criado por propriedades).
 *
 * `isStatic`: o time é gerado uma vez (ao criar o NPC) e salvo; senão é gerado a cada desafio.
 */
import { PokemonData } from "../Pokemon";
import { PokemonProperties } from "../PokemonProperties";
import { getSpeciesData } from "../speciesData";
import { createPokemonFromProperties } from "../GUI/PokemonEdit";
import type { NPCPartyProvider, PoolEntry } from "./NPCClass";
import { withNamespace } from "./NPCClass";
import { MOLANG_SCRIPTS, PARTY_COMPOSITIONS, PARTY_POOLS } from "../../generated/scripts/npcs";
import { MoArray, MoEnvironment, MoStruct, MoValue, asNumber, asString } from "./molang/MoLang";

export const MAX_PARTY_SIZE = 6;

/** Cria o Pokémon a partir das propriedades (injeção nos testes). */
export type PokemonFactory = (properties: string, level: number) => PokemonData | undefined;

/** Gerador pseudoaleatório com semente (mulberry32), para `useFixedRandom` e testes. */
export function seededRandom(seed: number | string): () => number {
  let a = typeof seed === "number" ? seed | 0 : hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

function randomInt(random: () => number, min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Cria um Pokémon de NPC: espécie/forma/natureza/IV/EV/habilidade/item pelas propriedades (PokemonEdit) e
 * golpes de `moves=a,b,c,d` (tratados por PokemonProperties.apply, como no Cobblemon).
 */
export function createNPCPokemon(properties: string, level: number): PokemonData | undefined {
  const props = PokemonProperties.parse(properties);
  if (!props.species || !getSpeciesData(props.species)) {
    console.warn(`NPC: espécie inválida em "${properties}"`);
    return undefined;
  }
  const hasLevel = props.level !== undefined && Number.isFinite(props.level);
  let pokemon = createPokemonFromProperties(props, { level: hasLevel ? props.level : level, shiny: props.shiny ?? false });
  pokemon.updateMaxHP();
  pokemon.currentHealth = pokemon.maxHealth;
  // Pokémon de NPC não têm dono (NPCPartyStore).
  pokemon.trainer = undefined;
  return pokemon;
}

export interface PartyContext {
  /** Nível do NPC. */
  level: number;
  /** UUID do NPC (semente de useFixedRandom). */
  npcUuid?: string;
  random?: () => number;
  factory?: PokemonFactory;
  /** Struct q.npc (scripts de time e expressões da pool composta). */
  npcStruct?: MoStruct;
  /** Structs q.player dos desafiantes (vazio ao criar o NPC). */
  players?: MoStruct[];
  /** Aspects do NPC (npcAspects das entradas da pool composta). */
  aspects?: readonly string[];
}

/** Só as escolhas (propriedades + nível), sem criar os Pokémon: base de `providePartyEntries`/testes. */
export interface PartyEntry {
  properties: string;
  level: number;
}

/** Sorteio do time (formulateParty), sem criar os Pokémon. */
export function formulateParty(provider: NPCPartyProvider, ctx: PartyContext): PartyEntry[] {
  const random = provider.type === "pool" && provider.useFixedRandom && ctx.npcUuid ? seededRandom(ctx.npcUuid) : ctx.random ?? Math.random;
  switch (provider.type) {
    case "simple":
      return provider.pokemon.slice(0, MAX_PARTY_SIZE).map(properties => ({ properties, level: ctx.level }));
    case "pool": {
      const entries: PartyEntry[] = [];
      let desired = randomInt(random, provider.minPokemon, provider.maxPokemon);
      const working = provider.pool.filter(e => ctx.level >= e.npcLevels[0] && ctx.level <= e.npcLevels[1] && e.selectableTimes > 0);
      const useCounts = new Map<PoolEntry, number>();
      while (desired > 0 && working.some(e => e.weight !== 0) && entries.length < MAX_PARTY_SIZE) {
        const forced = working.filter(e => e.weight === -1);
        const selected = forced.length ? forced[Math.floor(random() * forced.length)] : weightedSelection(working, random);
        if (!selected) break;
        const used = (useCounts.get(selected) ?? 0) + 1;
        useCounts.set(selected, used);
        if (used >= selected.selectableTimes) working.splice(working.indexOf(selected), 1);
        desired--;
        const props = PokemonProperties.parse(selected.pokemon);
        const variation = randomInt(random, 0, Math.max(0, Math.floor(selected.levelVariation)));
        const level = props.level ?? selected.level ?? ctx.level + variation;
        entries.push({ properties: selected.pokemon, level });
      }
      if (!entries.length) console.warn(`NPC ${ctx.npcUuid ?? "?"} had no Pokémon produced by their party provider`);
      return entries;
    }
    case "composed_pool":
      return composeParty(provider, ctx);
    case "script":
      // Monta Pokémon direto (provideParty); aqui não há "entradas".
      return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Pool composta (PartyPool + PartyComposition)

interface ComposedEntry {
  pokemon: string;
  labels: string[];
  npcAspects: string[];
  required: string[];
  excluded: string[];
  maxSelectableTimes: string;
  levelVariation: [string, string];
  npcLevels: [string, string];
  weight: string;
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)];

/** IntRangeAdapter / ScriptableIntRangeAdapter: "1-8", 5 ou {"min": "...", "max": "..."}. */
function parseScriptableRange(value: unknown, fallback: [string, string]): [string, string] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return [String(o.min ?? fallback[0]), String(o.max ?? fallback[1])];
  }
  if (typeof value === "number") return [String(value), String(value)];
  if (typeof value === "string") {
    const match = value.trim().match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (match) return [match[1], match[2]];
    return [value, value];
  }
  return fallback;
}

function propertiesText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => (k === "species" ? String(v) : `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)).join(" ");
  return "pikachu";
}

export function parsePartyPool(json: any): ComposedEntry[] {
  return (Array.isArray(json?.entries) ? json.entries : []).map((e: any): ComposedEntry => ({
    pokemon: propertiesText(e?.pokemon ?? "pikachu"),
    labels: strings(e?.labels),
    npcAspects: strings(e?.npcAspects),
    required: strings(e?.required),
    excluded: strings(e?.excluded),
    maxSelectableTimes: String(e?.maxSelectableTimes ?? "6"),
    levelVariation: parseScriptableRange(e?.levelVariation, ["0", "0"]),
    npcLevels: parseScriptableRange(e?.npcLevels, ["1", "100"]),
    weight: String(e?.weight ?? "50"),
  }));
}

export function parsePartyComposition(json: any): { scrambleOrder: boolean; slots: string[][] } {
  return {
    scrambleOrder: json?.scrambleOrder === true,
    slots: [1, 2, 3, 4, 5, 6].map(i => strings(json?.[`slot${i}`])),
  };
}

const extraPools = new Map<string, unknown>();
const extraCompositions = new Map<string, unknown>();
/** Registra pool/composição (datapack/testes). */
export function registerPartyPool(id: string, json: unknown) { extraPools.set(withNamespace(id), json); }
export function registerPartyComposition(id: string, json: unknown) { extraCompositions.set(withNamespace(id), json); }

function lookup(id: string, extra: Map<string, unknown>, generated: Record<string, string>): unknown {
  const key = withNamespace(id);
  if (extra.has(key)) return extra.get(key);
  const raw = generated[key];
  if (raw === undefined) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function partyEnv(ctx: PartyContext): MoEnvironment {
  const env = new MoEnvironment();
  if (ctx.npcStruct) env.withQuery("npc", ctx.npcStruct);
  env.withQuery("level", ctx.level);
  env.withQuery("players", new MoArray(ctx.players ?? []));
  if ((ctx.players ?? []).length === 1) env.withQuery("player", ctx.players![0]);
  return env;
}

function resolveInt(env: MoEnvironment, expression: string): number {
  try { return Math.trunc(asNumber(env.eval(expression))); }
  catch { return Math.trunc(Number(expression) || 0); }
}

function resolveFloat(env: MoEnvironment, expression: string): number {
  try { return asNumber(env.eval(expression)); }
  catch { return Number(expression) || 0; }
}

/** ComposedPoolPartyProvider.provide + PartyComposition.compose + PartyPool.tryChoosingEntry. */
function composeParty(provider: Extract<NPCPartyProvider, { type: "composed_pool" }>, ctx: PartyContext): PartyEntry[] {
  const poolJson = lookup(provider.pool, extraPools, PARTY_POOLS);
  const compositionJson = lookup(provider.composition, extraCompositions, PARTY_COMPOSITIONS);
  if (!poolJson || !compositionJson) {
    console.warn(`NPC: pool ${provider.pool} ou composição ${provider.composition} inexistente`);
    return [];
  }
  const random = provider.useFixedRandom && ctx.npcUuid ? seededRandom(ctx.npcUuid) : ctx.random ?? Math.random;
  const env = partyEnv(ctx);
  const min = resolveInt(env, provider.minPokemon);
  const max = resolveInt(env, provider.maxPokemon);
  const desired = randomInt(random, min, max);
  const pool = parsePartyPool(poolJson);
  const composition = parsePartyComposition(compositionJson);
  const aspects = ctx.aspects ?? [];
  const available = pool.filter(entry => {
    const [low, high] = entry.npcLevels.map(x => resolveInt(env, x));
    return ctx.level >= low && ctx.level <= high && (entry.npcAspects.length === 0 || entry.npcAspects.every(a => aspects.includes(a)));
  });
  const chosen: ComposedEntry[] = [];
  for (const labels of composition.slots) {
    for (const label of labels) {
      const candidates = available
        .filter(entry => entry.labels.includes(label) || label.toLowerCase() === "any")
        .filter(entry => entry.required.every(x => labels.includes(x)) && !entry.excluded.some(x => labels.includes(x))
          && chosen.filter(x => x === entry).length < resolveFloat(env, entry.maxSelectableTimes));
      if (!candidates.length) continue;
      const selected = weightedPick(candidates, entry => resolveFloat(env, entry.weight), random);
      if (selected) chosen.push(selected);
      break;
    }
    if (chosen.length >= desired) break;
  }
  const ordered = composition.scrambleOrder ? shuffled(chosen, random) : chosen;
  return ordered.slice(0, MAX_PARTY_SIZE).map(entry => {
    const [low, high] = entry.levelVariation.map(x => resolveInt(env, x));
    const variation = low === high ? low : randomInt(random, low, high);
    const props = PokemonProperties.parse(entry.pokemon);
    return { properties: entry.pokemon, level: props.level ?? ctx.level + variation };
  });
}

/** CollectionUtils.weightedSelection. */
function weightedPick<T>(list: T[], weight: (item: T) => number, random: () => number): T | undefined {
  let sum = 0;
  for (const item of list) sum += Math.max(0, weight(item));
  const chosen = random() * sum;
  sum = 0;
  for (const item of list) {
    const w = weight(item);
    if (w > 0) {
      sum += w;
      if (sum >= chosen) return item;
    }
  }
  return undefined;
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Time montado por script (ScriptPartyProvider / q.entity.create_npc_party)

/**
 * Struct de um time de NPC em montagem (PokemonStoreMoLangFunctions): `add_by_properties` cria pelo texto de
 * propriedades (sem `level=`, nível 1 como no Pokemon() do Cobblemon), `count`, `average_level`, `highest_level`.
 */
export function createPartyStruct(party: PokemonData[], factory: PokemonFactory = createNPCPokemon): MoStruct {
  const struct = new MoStruct({}, {}, party);
  struct
    .fn("add_by_properties", args => {
      if (party.length >= MAX_PARTY_SIZE) return 0;
      const pokemon = factory(asString(args[0]), 1);
      if (!pokemon) return 0;
      party.push(pokemon);
      return 1;
    })
    .fn("count", () => party.length)
    .fn("average_level", () => party.length ? party.reduce((sum, p) => sum + p.level, 0) / party.length : 0)
    .fn("highest_level", () => party.reduce((max, p) => Math.max(max, p.level), 0))
    .fn("lowest_level", () => party.length ? party.reduce((min, p) => Math.min(min, p.level), Infinity) : 0);
  return struct;
}

/** Time do struct (q.entity.set_npc_party / ScriptPartyProvider). */
export function partyOfStruct(value: MoValue | undefined): PokemonData[] | undefined {
  return value instanceof MoStruct && Array.isArray(value.host) ? value.host as PokemonData[] : undefined;
}

function scriptParty(provider: Extract<NPCPartyProvider, { type: "script" }>, ctx: PartyContext): PokemonData[] {
  const factory = ctx.factory ?? createNPCPokemon;
  const party: PokemonData[] = [];
  const script = MOLANG_SCRIPTS[withNamespace(provider.script)];
  if (script === undefined) {
    console.warn(`NPC: script de time ${provider.script} não existe`);
    const magikarp = factory("magikarp", 1);
    return magikarp ? [magikarp] : [];
  }
  const env = partyEnv(ctx);
  env.withQuery("party", createPartyStruct(party, factory));
  try { env.eval(script); }
  catch (e) { console.warn(`NPC: script de time ${provider.script} falhou: ${e}`); }
  return party;
}

function weightedSelection(entries: PoolEntry[], random: () => number): PoolEntry | undefined {
  const valid = entries.filter(e => e.weight > 0);
  const total = valid.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return undefined;
  let roll = random() * total;
  for (const e of valid) if ((roll -= e.weight) < 0) return e;
  return valid[valid.length - 1];
}

/** Gera o time (NPCPartyProvider.provide). */
export function provideParty(provider: NPCPartyProvider, ctx: PartyContext): PokemonData[] {
  if (provider.type === "script") return scriptParty(provider, ctx);
  const factory = ctx.factory ?? createNPCPokemon;
  const out: PokemonData[] = [];
  for (const entry of formulateParty(provider, ctx)) {
    try {
      const pokemon = factory(entry.properties, entry.level);
      if (pokemon) out.push(pokemon);
    }
    catch (e) { console.warn(`NPC: não foi possível criar "${entry.properties}": ${e}`); }
  }
  return out;
}
