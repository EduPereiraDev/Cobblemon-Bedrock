/**
 * Classes e presets de NPC (api/npc/NPCClass.kt, NPCPreset.kt, util/adapters/NPCClassAdapter.kt).
 *
 * Uma classe lê primeiro os presets listados em `presets` (cada um sobrescreve/acumula campos, como
 * `NPCPreset.applyTo`) e depois os próprios campos. `variation` (singular) e `variations` são aceitos.
 * Os dados vêm de generated/scripts/npcs.ts (data/cobblemon/npcs e npc_presets).
 */
import { NPC_CLASSES, NPC_PRESETS } from "../../generated/scripts/npcs";

export type MoLangVariableType = "NUMBER" | "TEXT" | "BOOLEAN";

export interface MoLangConfigVariable {
  variableName: string;
  displayName: string;
  description: string;
  category: string;
  type: MoLangVariableType;
  defaultValue: string;
}

export interface WeightedAspect {
  aspects: string[];
  weight: number;
}

/** NPCVariationProvider: lista de aspects sorteada (random) ou com pesos (weighted). */
export type NPCVariationProvider =
  | { type: "random"; aspects: string[] }
  | { type: "weighted"; options: WeightedAspect[] };

export type NPCInteraction =
  | { type: "dialogue"; dialogue: string }
  | { type: "script"; script: string }
  | { type: "custom_script"; script: string | string[] }
  | { type: "none" };

/** Entrada de pool (PoolPartyProvider.DynamicPokemon). */
export interface PoolEntry {
  pokemon: string;
  weight: number;
  selectableTimes: number;
  /** Faixa de nível do NPC em que a entrada vale. */
  npcLevels: [number, number];
  levelVariation: number;
  level?: number;
}

export type NPCPartyProvider =
  | { type: "simple"; isStatic: boolean; pokemon: string[] }
  | { type: "pool"; isStatic: boolean; useFixedRandom: boolean; minPokemon: number; maxPokemon: number; pool: PoolEntry[] }
  | { type: "script"; isStatic: boolean; script: string }
  /** ComposedPoolPartyProvider: pool (party_pools) + composição (party_compositions); min/max são MoLang. */
  | { type: "composed_pool"; isStatic: boolean; useFixedRandom: boolean; minPokemon: string; maxPokemon: string; pool: string; composition: string };

export interface NPCBattleConfiguration {
  canChallenge: boolean;
}

export interface NPCClass {
  id: string;
  resourceIdentifier: string;
  names: string[];
  aspects: string[];
  hitbox: { width: number; height: number };
  battleConfiguration: NPCBattleConfiguration;
  interaction?: NPCInteraction;
  canDespawn: boolean;
  variations: Record<string, NPCVariationProvider>;
  config: MoLangConfigVariable[];
  party?: NPCPartyProvider;
  skill: number;
  autoHealParty: boolean;
  randomizePartyOrder: boolean;
  battleTheme?: string;
  isMovable: boolean;
  isInvulnerable: boolean;
  isLeashable: boolean;
  allowProjectileHits: boolean;
  hideNameTag: boolean;
  /** Presets aplicados (para o relatório/edição). */
  presets: string[];
  /**
   * Behaviours da classe (`behaviours`/`behaviors`/`ai`: configurações `apply_behaviours`, ids com namespace).
   * O `presets` dentro de apply_behaviours (kitchen_sink) não é lido pelo Cobblemon, então também não aqui.
   */
  behaviours: string[];
}

export function withNamespace(id: string, ns = "cobblemon"): string {
  const clean = id.trim().toLowerCase();
  return clean.includes(":") ? clean : `${ns}:${clean}`;
}

export function newNPCClass(id: string): NPCClass {
  return {
    id,
    resourceIdentifier: "cobblemon:dummy",
    names: [],
    aspects: [],
    hitbox: { width: 0.6, height: 1.8 },
    battleConfiguration: { canChallenge: false },
    canDespawn: true,
    variations: {},
    config: [],
    skill: 0,
    autoHealParty: true,
    randomizePartyOrder: false,
    isMovable: true,
    isInvulnerable: false,
    isLeashable: true,
    allowProjectileHits: true,
    hideNameTag: false,
    presets: [],
    behaviours: [],
  };
}

const num = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function parseHitbox(v: unknown): { width: number; height: number } | undefined {
  if (v === "player") return { width: 0.6, height: 1.8 };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { width: num(o.width, 0.6), height: num(o.height, 1.8) };
  }
  return undefined;
}

export function parseVariation(v: unknown): NPCVariationProvider | undefined {
  if (Array.isArray(v)) {
    // Lista: WeightedNPCVariationProvider (NPCVariationProviderAdapter); strings viram opções de peso 1.
    return {
      type: "weighted",
      options: v.map(x => typeof x === "string" ? { aspects: [x], weight: 1 } : {
        aspects: toArray((x as any)?.aspects ?? (x as any)?.aspect).map(String), weight: num((x as any)?.weight, 1),
      }),
    };
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.type === "random") return { type: "random", aspects: toArray(o.aspects).map(String) };
    if (o.type === "weighted") return {
      type: "weighted",
      options: toArray(o.options).map((x: any) => ({ aspects: toArray(x?.aspects ?? x?.aspect).map(String), weight: num(x?.weight, 1) })),
    };
  }
  return undefined;
}

function parseInteraction(v: unknown): NPCInteraction | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "dialogue": return { type: "dialogue", dialogue: withNamespace(String(o.dialogue ?? "")) };
    case "script": return { type: "script", script: withNamespace(String(o.script ?? "")) };
    case "custom_script": return { type: "custom_script", script: Array.isArray(o.script) ? o.script.map(String) : String(o.script ?? "0") };
    case "none": return { type: "none" };
  }
  return undefined;
}

function parseConfigVariable(v: any): MoLangConfigVariable {
  const type = String(v?.type ?? "NUMBER").toUpperCase();
  return {
    variableName: String(v?.variableName ?? "variable"),
    displayName: String(v?.displayName ?? "Variable"),
    description: String(v?.description ?? ""),
    category: String(v?.category ?? "Variables"),
    type: type === "TEXT" || type === "BOOLEAN" ? type : "NUMBER",
    defaultValue: String(v?.defaultValue ?? "0"),
  };
}

/** "1-8" → [1, 8] (npcLevels). */
function parseRange(v: unknown, fallback: [number, number]): [number, number] {
  if (typeof v !== "string" && typeof v !== "number") return fallback;
  const parts = String(v).split("-").map(x => parseInt(x.trim()));
  if (parts.length === 1 && Number.isFinite(parts[0])) return [parts[0], parts[0]];
  if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) return [parts[0], parts[1]];
  return fallback;
}

export function parsePartyProvider(v: unknown): NPCPartyProvider | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const type = String(o.type ?? "simple").replace(/^cobblemon:/, "");
  switch (type) {
    case "simple":
      return {
        type: "simple",
        isStatic: o.isStatic === undefined ? true : o.isStatic === true,
        pokemon: toArray(o.pokemon).map(p => typeof p === "string" ? p : propsFromObject(p)),
      };
    case "pool":
      return {
        type: "pool",
        isStatic: o.isStatic === true,
        useFixedRandom: o.useFixedRandom === true,
        minPokemon: num(o.minPokemon, 1),
        maxPokemon: num(o.maxPokemon, 6),
        pool: toArray(o.pool).map((e: any): PoolEntry => typeof e === "string"
          ? { pokemon: e, weight: 1, selectableTimes: 1, npcLevels: [1, 100], levelVariation: 0 }
          : {
            pokemon: String(e?.pokemon ?? ""),
            weight: num(e?.weight, 1),
            selectableTimes: num(e?.selectableTimes, 1),
            npcLevels: parseRange(e?.npcLevels, [1, 100]),
            levelVariation: num(e?.levelVariation, 0),
            level: e?.level !== undefined ? num(e.level, 1) : undefined,
          }),
      };
    case "script":
      // ScriptPartyProvider: estático salvo `"isStatic": false`.
      return { type: "script", isStatic: o.isStatic !== false, script: withNamespace(String(o.script ?? "dummy")) };
    case "composed_pool":
      return {
        type: "composed_pool",
        isStatic: o.isStatic !== false,
        useFixedRandom: o.useFixedRandom === true,
        minPokemon: String(o.minPokemon ?? "1"),
        maxPokemon: String(o.maxPokemon ?? "6"),
        pool: withNamespace(String(o.pool ?? "")),
        composition: withNamespace(String(o.composition ?? "")),
      };
  }
  console.warn(`Provedor de time de NPC desconhecido: ${type}`);
  return undefined;
}

/** PokemonProperties em objeto JSON ({"species": "x", "level": 5}) → string. */
function propsFromObject(p: unknown): string {
  if (!p || typeof p !== "object") return String(p ?? "");
  return Object.entries(p as Record<string, unknown>)
    .map(([k, v]) => (k === "species" ? String(v) : `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`))
    .join(" ");
}

/** NPCPreset.applyTo / NPCClassAdapter: aplica campos presentes em `json` sobre `npcClass`. */
function applyFields(npcClass: NPCClass, json: Record<string, unknown>, fromPreset: boolean) {
  const names = json.names ?? json.name;
  if (names !== undefined) {
    const list = toArray(names).map(String);
    // Preset acumula nomes; a classe substitui.
    npcClass.names = fromPreset ? [...npcClass.names, ...list] : list;
  }
  if (typeof json.resourceIdentifier === "string") npcClass.resourceIdentifier = withNamespace(json.resourceIdentifier);
  if (json.aspects !== undefined) {
    const list = toArray(json.aspects).map(String);
    npcClass.aspects = fromPreset ? [...new Set([...npcClass.aspects, ...list])] : list;
  }
  for (const key of ["variation", "variations"]) {
    const obj = json[key];
    if (obj && typeof obj === "object" && !Array.isArray(obj))
      for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
        const provider = parseVariation(value);
        if (provider) npcClass.variations[name] = provider;
      }
  }
  const hitbox = parseHitbox(json.hitbox);
  if (hitbox) npcClass.hitbox = hitbox;
  if (json.battleConfiguration && typeof json.battleConfiguration === "object")
    npcClass.battleConfiguration = { canChallenge: (json.battleConfiguration as any).canChallenge === true };
  const interaction = parseInteraction(json.interaction);
  if (interaction) npcClass.interaction = interaction;
  if (typeof json.canDespawn === "boolean") npcClass.canDespawn = json.canDespawn;
  if (Array.isArray(json.config)) {
    for (const raw of json.config) {
      const variable = parseConfigVariable(raw);
      npcClass.config = npcClass.config.filter(x => x.variableName !== variable.variableName);
      npcClass.config.push(variable);
    }
  }
  const party = parsePartyProvider(json.party);
  if (party) npcClass.party = party;
  if (json.skill !== undefined) npcClass.skill = num(json.skill, npcClass.skill);
  if (typeof json.autoHealParty === "boolean") npcClass.autoHealParty = json.autoHealParty;
  if (typeof json.randomizePartyOrder === "boolean") npcClass.randomizePartyOrder = json.randomizePartyOrder;
  if (typeof json.battleTheme === "string") npcClass.battleTheme = json.battleTheme;
  if (typeof json.isMovable === "boolean") npcClass.isMovable = json.isMovable;
  if (typeof json.isInvulnerable === "boolean") npcClass.isInvulnerable = json.isInvulnerable;
  if (typeof json.hideNameTag === "boolean") npcClass.hideNameTag = json.hideNameTag;
  if (typeof json.isLeashable === "boolean") npcClass.isLeashable = json.isLeashable;
  if (typeof json.allowProjectileHits === "boolean") npcClass.allowProjectileHits = json.allowProjectileHits;
  // BehaviourConfig: preset acumula, a classe também (NPCClassAdapter faz addAll).
  const behaviourConfigs = json.behaviours ?? json.behaviors ?? json.ai;
  for (const config of toArray(behaviourConfigs)) {
    const type = String((config as any)?.type ?? "").replace(/^[a-z_]+:/, "");
    if (type !== "apply_behaviours") continue;
    for (const id of toArray((config as any).behaviours ?? (config as any).behaviors).map(String))
      if (!npcClass.behaviours.includes(withNamespace(id))) npcClass.behaviours.push(withNamespace(id));
  }
}

function parseJson(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : undefined;
  }
  catch { return undefined; }
}

/** Aplica um preset (pelo id) numa classe. @returns false se o preset não existe. */
export function applyPreset(npcClass: NPCClass, presetId: string): boolean {
  const id = withNamespace(presetId);
  const json = parseJson(NPC_PRESETS[id]);
  if (!json) return false;
  applyFields(npcClass, json, true);
  npcClass.presets.push(id);
  return true;
}

/** Lê uma classe do JSON do Cobblemon (NPCClassAdapter). */
export function parseNPCClass(id: string, json: Record<string, unknown>): NPCClass {
  const npcClass = newNPCClass(id);
  for (const preset of toArray(json.presets).map(String)) {
    if (!applyPreset(npcClass, preset)) console.warn(`NPC preset ${preset} not found`);
  }
  applyFields(npcClass, json, false);
  // NPCClasses: resourceIdentifier "dummy" vira o id da classe (sacchi → variações "cobblemon:sacchi").
  if (npcClass.resourceIdentifier.endsWith(":dummy")) npcClass.resourceIdentifier = id;
  return npcClass;
}

const classCache = new Map<string, NPCClass | null>();

/**
 * Classe de NPC pelo id ("standard" ou "cobblemon:standard"). Se não houver classe com esse id mas houver
 * um preset, devolve uma classe vazia com o preset aplicado (permite `/npcspawn battler_test`).
 */
export function getNPCClass(id: string): NPCClass | undefined {
  const key = withNamespace(id);
  if (classCache.has(key)) return classCache.get(key) ?? undefined;
  let result: NPCClass | undefined;
  const json = parseJson(NPC_CLASSES[key]);
  if (json) result = parseNPCClass(key, json);
  else if (NPC_PRESETS[key] !== undefined) {
    result = newNPCClass(key);
    applyPreset(result, key);
    result.canDespawn = false;
  }
  classCache.set(key, result ?? null);
  return result;
}

export function getNPCClassIds(): string[] {
  return Object.keys(NPC_CLASSES).sort();
}

export function getNPCPresetIds(): string[] {
  return Object.keys(NPC_PRESETS).sort();
}

/** Valores padrão das variáveis de configuração (NPCEntity: config declarada pela classe). */
export function defaultConfig(npcClass: NPCClass): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const variable of npcClass.config) out[variable.variableName] = coerceConfig(variable.type, variable.defaultValue);
  return out;
}

/** MoLangVariableType.toMoValue. */
export function coerceConfig(type: MoLangVariableType, value: string | number | boolean): string | number {
  if (type === "TEXT") return String(value);
  if (type === "BOOLEAN") return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true" ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Sorteia os aspects de variação (NPCEntity.initialize → provideAspects). */
export function provideVariationAspects(npcClass: NPCClass, random: () => number = Math.random): string[] {
  const out: string[] = [];
  for (const provider of Object.values(npcClass.variations)) {
    if (provider.type === "random") {
      if (provider.aspects.length) out.push(provider.aspects[Math.floor(random() * provider.aspects.length)]);
    }
    else {
      const total = provider.options.reduce((s, o) => s + Math.max(0, o.weight), 0);
      if (total <= 0) continue;
      let roll = random() * total;
      const chosen = provider.options.find(o => (roll -= Math.max(0, o.weight)) < 0) ?? provider.options[provider.options.length - 1];
      out.push(...chosen.aspects);
    }
  }
  return out;
}
