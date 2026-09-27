/**
 * Spawn rules do Cobblemon 1.8.2 (`api/spawning/CobblemonSpawnRules.kt`, `api/spawning/rules/**`): regras de datapack
 * que mexem em todos os spawns do spawner do jogador. Cada regra tem `components`:
 * - `weight`: se os seletores escolhem o spawn e a posição, o peso vira a expressão `weight` (`v.weight` = peso atual);
 * - `filter`: se os seletores escolhem, o spawn só acontece quando `allow` é verdadeiro;
 * - `location`: a posição só é usada quando `allow` é verdadeiro (`v.x`, `v.y`, `v.z`, `v.world.is_of(...)`,
 *   `v.spawnable_position` = tipo da posição).
 * Seletores: expressão MoLang (texto/lista) com `v.spawn_detail`/`v.spawn` e `v.spawnable_position`, ou objeto
 * `{ "type": "expression", "expression": ... }` / `{ "type": "conditional", "conditions": [...], "anticonditions": [...] }`.
 *
 * O Java carrega as regras de `data/<ns>/spawn_rules/*.json`; o jogo base traz só um exemplo desligado
 * (`pikachu_daylight_multiplier`). No Bedrock não há datapack de add-on: as regras do jogo base vêm embutidas aqui e
 * outras podem ser adicionadas/ligadas por `/cobblemon:spawnrule` (guardadas no mundo, `cobblemon:spawn_rules`).
 */
import { RawMessage, world } from "@minecraft/server";
import { MoArray, MoEnvironment, MoStruct, MoValue, asNumber, isTruthy } from "../npc/molang/MoLang";
import type { SpawnCondition, SpawnEntry } from "../../generated/scripts/spawns";
import { BIOME_TAGS } from "../../generated/scripts/biomeTags";
import { conditionMatches } from "./SpawnConditions";
import type { SpawnContext } from "./SpawnConditions";
import type { SpawnInfluence } from "./SpawnSelector";

/** `data/cobblemon/spawn_rules/pikachu_daylight_multiplier.json` do 1.8.2 (desligado). */
export const BASE_SPAWN_RULES: Record<string, unknown> = {
  "cobblemon:pikachu_daylight_multiplier": {
    displayName: "Pikachu Daylight Multiplier - (Example file). See https://wiki.cobblemon.com/index.php/Spawn_Rules",
    enabled: "false",
    components: [
      { type: "weight", spawnDetailSelector: "v.spawn_detail.pokemon.species == 'pikachu'", spawnablePositionSelector: "v.spawnable_position.light > 8", weight: "v.weight * 20" },
      { type: "filter", spawnDetailSelector: "v.spawn_detail.pokemon.species == 'pikachu'", spawnablePositionSelector: "v.spawnable_position.light < 8", allow: "false" },
      { type: "location", allow: "v.y > 100 || v.world.is_of('minecraft:overworld')" },
    ],
  },
};

export const SPAWN_RULES_PROPERTY = "cobblemon:spawn_rules";

type Expr = string | string[];
type Selector = (entry: SpawnEntry, ctx: SpawnContext) => boolean;
type PositionSelector = (ctx: SpawnContext) => boolean;

interface WeightComponent { type: "weight"; detail: Selector; position: PositionSelector; weight: Expr }
interface FilterComponent { type: "filter"; detail: Selector; position: PositionSelector; allow: Expr }
interface LocationComponent { type: "location"; allow: Expr }
type RuleComponent = WeightComponent | FilterComponent | LocationComponent;

export interface SpawnRule {
  id: string;
  displayName: string;
  enabled: boolean;
  components: RuleComponent[];
}

// ---------------------------------------------------------------------------------------------
// MoLang

let env: MoEnvironment | undefined;

function evaluate(expr: Expr, vars: Record<string, MoValue>): MoValue {
  env ??= new MoEnvironment();
  // Variáveis (v.*) do runtime do Cobblemon: setSimpleVariable.
  for (const [name, value] of Object.entries(vars)) env.variable.set(name, value);
  return env.eval(expr);
}

function evalBoolean(expr: Expr, vars: Record<string, MoValue>, fallback: boolean): boolean {
  try { return isTruthy(evaluate(expr, vars)); } catch { return fallback; }
}

function evalNumber(expr: Expr, vars: Record<string, MoValue>, fallback: number): number {
  try { return asNumber(evaluate(expr, vars)); } catch { return fallback; }
}

/** SpawnDetail.struct + PokemonSpawnDetail (`pokemon` = PokemonProperties, `min_level`/`max_level`). */
export function spawnDetailStruct(entry: SpawnEntry): MoStruct {
  const [species] = entry.species.split(" ");
  const pokemon = new MoStruct({
    species: species.replace(/^cobblemon:/, ""), level: 0, shiny: 0, form: 0, gender: 0, friendship: 0,
  });
  return new MoStruct({
    weight: entry.weight, percentage: -1, id: entry.id, bucket: entry.bucket, width: -1, height: -1,
    spawnable_position_type: entry.positionType, labels: new MoArray([]), pokemon, min_level: entry.minLevel, max_level: entry.maxLevel,
  });
}

/** SpawnablePositionMoLangFunctions: biome, world, light, x/y/z, moon_phase, can_see_sky, sky_light. */
export function spawnablePositionStruct(ctx: SpawnContext): MoStruct {
  const dimensionId = safeDimensionId(ctx);
  const worldValue = holder(dimensionId, id => id === dimensionId || id === dimensionId.replace(/^minecraft:/, ""));
  const biomeValue = holder(`minecraft:${ctx.biome}`, id => {
    const bare = id.replace(/^#/, "");
    if (id.startsWith("#")) return (BIOME_TAGS[bare] ?? []).includes(ctx.biome);
    return bare.replace(/^minecraft:/, "") === ctx.biome;
  });
  let moonPhase = 0;
  try { moonPhase = world.getMoonPhase(); } catch { }
  return new MoStruct({
    biome: biomeValue, world: worldValue, light: ctx.light, x: Math.floor(ctx.location.x), y: Math.floor(ctx.blockY ?? ctx.location.y),
    z: Math.floor(ctx.location.z), moon_phase: moonPhase, can_see_sky: ctx.canSeeSky ? 1 : 0, sky_light: ctx.skyLight,
  });
}

/** Holder<T>.asMoLangValue: `is_of(id)` e `is_in(#tag)`. */
function holder(id: string, matches: (id: string) => boolean): MoStruct {
  return new MoStruct({ id }, {
    is_of: args => (matches(String(args[0] ?? "")) ? 1 : 0),
    is_in: args => (matches(`#${String(args[0] ?? "").replace(/^#/, "")}`) ? 1 : 0),
  });
}

function safeDimensionId(ctx: SpawnContext): string {
  try { return ctx.dimension.id; } catch { return "minecraft:overworld"; }
}

// ---------------------------------------------------------------------------------------------
// Leitura das regras (formato do Cobblemon)

function isExpr(value: unknown): value is Expr {
  return typeof value === "string" || (Array.isArray(value) && value.every(v => typeof v === "string"));
}

/** Condição do Cobblemon (JSON do datapack) → SpawnCondition do port (campos equivalentes; tags de bioma). */
export function convertCondition(raw: Record<string, unknown>): SpawnCondition {
  const out: Record<string, unknown> = {};
  const copy = ["minSkyLight", "maxSkyLight", "minLight", "maxLight", "canSeeSky", "isRaining", "isThundering", "timeRange", "moonPhase",
    "minY", "maxY", "minX", "maxX", "minZ", "maxZ", "isSlimeChunk", "minHeight", "maxHeight", "minDepth", "maxDepth", "fluidIsSource"];
  for (const key of copy) if (raw[key] !== undefined) out[key] = raw[key];
  if (Array.isArray(raw.biomes)) {
    out.biomes = [...new Set((raw.biomes as string[]).flatMap(b => {
      const id = String(b);
      if (id.startsWith("#")) return BIOME_TAGS[id.slice(1)] ?? BIOME_TAGS[`minecraft:${id.slice(1)}`] ?? [];
      return [id.replace(/^[a-z0-9_.-]+:/, "")];
    }))];
  }
  if (Array.isArray(raw.dimensions)) out.dimensions = (raw.dimensions as string[]).map(String);
  for (const key of ["neededBaseBlocks", "neededNearbyBlocks", "structures"]) if (Array.isArray(raw[key])) out[key] = raw[key];
  return out as SpawnCondition;
}

function parseDetailSelector(raw: unknown): Selector {
  if (raw === undefined) return () => true;
  const expr = isExpr(raw) ? raw : (raw as { type?: string; expression?: unknown })?.type === "expression" ? (raw as { expression?: unknown }).expression : undefined;
  if (!isExpr(expr)) return () => true;
  return entry => {
    const detail = spawnDetailStruct(entry);
    return evalBoolean(expr, { spawn: detail, spawn_detail: detail }, false);
  };
}

function parsePositionSelector(raw: unknown): PositionSelector {
  if (raw === undefined) return () => true;
  if (isExpr(raw) || (raw as { type?: string })?.type === "expression") {
    const expr = isExpr(raw) ? raw : (raw as { expression?: unknown }).expression;
    if (!isExpr(expr)) return () => true;
    return ctx => evalBoolean(expr, { spawnable_position: spawnablePositionStruct(ctx) }, false);
  }
  const obj = raw as { type?: string; conditions?: unknown[]; anticonditions?: unknown[] };
  if (obj?.type === "conditional") {
    const conditions = (obj.conditions ?? []).filter(c => c && typeof c === "object").map(c => convertCondition(c as Record<string, unknown>));
    const anticonditions = (obj.anticonditions ?? []).filter(c => c && typeof c === "object").map(c => convertCondition(c as Record<string, unknown>));
    // ConditionalSpawnablePositionSelector: alguma condição (se houver) e nenhuma anticondição.
    return ctx => {
      if (conditions.length && !conditions.some(c => safeMatches(c, ctx))) return false;
      return !(anticonditions.length && anticonditions.some(c => safeMatches(c, ctx)));
    };
  }
  return () => true;
}

function safeMatches(condition: SpawnCondition, ctx: SpawnContext): boolean {
  try { return conditionMatches(condition, ctx); } catch { return false; }
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" ? true : value.toLowerCase() === "false" ? false : fallback;
  return fallback;
}

/** Lê uma regra no formato do Cobblemon. Componentes desconhecidos são ignorados. */
export function parseSpawnRule(id: string, json: unknown): SpawnRule | undefined {
  if (!json || typeof json !== "object") return undefined;
  const raw = json as { displayName?: unknown; enabled?: unknown; components?: unknown[] };
  const components: RuleComponent[] = [];
  for (const c of raw.components ?? []) {
    const comp = c as Record<string, unknown>;
    const detail = parseDetailSelector(comp.spawnDetailSelector ?? comp.spawnSelector);
    const position = parsePositionSelector(comp.spawnablePositionSelector ?? comp.contextSelector);
    if (comp.type === "weight") components.push({ type: "weight", detail, position, weight: isExpr(comp.weight) ? comp.weight : "v.weight" });
    else if (comp.type === "filter") components.push({ type: "filter", detail, position, allow: isExpr(comp.allow) ? comp.allow : typeof comp.allow === "boolean" ? String(comp.allow) : "true" });
    else if (comp.type === "location") components.push({ type: "location", allow: isExpr(comp.allow) ? comp.allow : "true" });
  }
  return { id, displayName: typeof raw.displayName === "string" ? raw.displayName : "Spawn Rule", enabled: bool(raw.enabled, true), components };
}

// ---------------------------------------------------------------------------------------------
// Registro

interface StoredRules { rules?: Record<string, unknown>; enabled?: Record<string, boolean> }

let cache: SpawnRule[] | undefined;

function readStored(): StoredRules {
  try {
    const raw = world.getDynamicProperty(SPAWN_RULES_PROPERTY);
    return typeof raw === "string" ? JSON.parse(raw) as StoredRules : {};
  }
  catch { return {}; }
}

function writeStored(stored: StoredRules) {
  world.setDynamicProperty(SPAWN_RULES_PROPERTY, JSON.stringify(stored));
  cache = undefined;
}

/** Todas as regras (jogo base + do mundo), com o estado ligado/desligado do mundo por cima. */
export function getSpawnRules(): SpawnRule[] {
  if (cache) return cache;
  const stored = readStored();
  const all = { ...BASE_SPAWN_RULES, ...(stored.rules ?? {}) };
  cache = Object.entries(all).map(([id, json]) => parseSpawnRule(id, json)).filter((r): r is SpawnRule => !!r)
    .map(rule => ({ ...rule, enabled: stored.enabled?.[rule.id] ?? rule.enabled }));
  return cache;
}

/** Só para testes: troca o registro sem mundo. */
export function setSpawnRulesForTests(rules: SpawnRule[] | undefined) {
  cache = rules;
}

/**
 * As regras ligadas como influência do spawner (PlayerSpawnerFactory: CobblemonSpawnRules.rules.filter(enabled)
 * .flatMap(components)). Undefined se nenhuma está ligada (nada a fazer no passe).
 */
export function spawnRulesInfluence(): SpawnInfluence | undefined {
  const components = getSpawnRules().filter(rule => rule.enabled).flatMap(rule => rule.components);
  if (!components.length) return undefined;
  const weights = components.filter((c): c is WeightComponent => c.type === "weight");
  const filters = components.filter((c): c is FilterComponent => c.type === "filter");
  const locations = components.filter((c): c is LocationComponent => c.type === "location");
  return {
    affectSpawnable(entry, ctx) {
      // LocationRuleCalculator.isAllowedPosition vale para a posição inteira (qualquer entrada).
      for (const location of locations) {
        const vars = {
          x: Math.floor(ctx.location.x), y: Math.floor(ctx.blockY ?? ctx.location.y), z: Math.floor(ctx.location.z),
          spawnable_position: String(ctx.positionType), world: holder(safeDimensionId(ctx), id => id === safeDimensionId(ctx)),
          dimension_type: holder(safeDimensionId(ctx), id => id === safeDimensionId(ctx)),
        };
        if (!evalBoolean(location.allow, vars, true)) return false;
      }
      for (const filter of filters) {
        if (!filter.detail(entry, ctx) || !filter.position(ctx)) continue;
        const detail = spawnDetailStruct(entry);
        if (!evalBoolean(filter.allow, { spawn: detail, spawn_detail: detail, spawnable_position: spawnablePositionStruct(ctx) }, true)) return false;
      }
      return true;
    },
    affectWeight(entry, ctx, weight) {
      let current = weight;
      for (const tweak of weights) {
        if (!tweak.detail(entry, ctx) || !tweak.position(ctx)) continue;
        const detail = spawnDetailStruct(entry);
        current = evalNumber(tweak.weight, { spawn: detail, spawn_detail: detail, weight: current }, current);
      }
      return current;
    },
  };
}

/** `/cobblemon:spawnrule list|enable|disable|add|remove [id] [json]`. */
export function spawnRuleCommand(action: string, id?: string, json?: string): RawMessage {
  const rules = getSpawnRules();
  const fullId = id ? (id.includes(":") ? id : `cobblemon:${id}`) : undefined;
  switch (action) {
    case "list":
      if (!rules.length) return { text: "No spawn rules" };
      return { text: rules.map(rule => `${rule.enabled ? "§a●" : "§8○"} §f${rule.id}§7 - ${rule.displayName} (${rule.components.length})`).join("\n") };
    case "enable": case "disable": {
      if (!fullId || !rules.some(rule => rule.id === fullId)) return { text: `§cUnknown spawn rule: ${id ?? ""}` };
      const stored = readStored();
      stored.enabled = { ...(stored.enabled ?? {}), [fullId]: action === "enable" };
      writeStored(stored);
      return { text: `Spawn rule ${fullId}: ${action === "enable" ? "enabled" : "disabled"}` };
    }
    case "add": {
      if (!fullId || !json) return { text: "§cUsage: /cobblemon:spawnrule add <id> <json>" };
      let parsedJson: unknown;
      try { parsedJson = JSON.parse(json); } catch (e) { return { text: `§cInvalid JSON: ${e}` }; }
      if (!parseSpawnRule(fullId, parsedJson)) return { text: "§cInvalid spawn rule" };
      const stored = readStored();
      stored.rules = { ...(stored.rules ?? {}), [fullId]: parsedJson };
      writeStored(stored);
      return { text: `Spawn rule ${fullId} added` };
    }
    case "remove": {
      if (!fullId) return { text: "§cUsage: /cobblemon:spawnrule remove <id>" };
      const stored = readStored();
      if (!stored.rules?.[fullId]) return { text: `§cOnly world rules can be removed: ${fullId}` };
      delete stored.rules[fullId];
      if (stored.enabled) delete stored.enabled[fullId];
      writeStored(stored);
      return { text: `Spawn rule ${fullId} removed` };
    }
  }
  return { text: "§cUsage: /cobblemon:spawnrule list|enable|disable|add|remove" };
}
