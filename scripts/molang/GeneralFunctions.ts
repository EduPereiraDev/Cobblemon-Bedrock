/**
 * Funções gerais de MoLang do Cobblemon 1.8.2 (GeneralMoLangFunctions.kt) que faltavam no interpretador do servidor
 * (scripts/npc/molang/MoLang.ts). `registerGeneralFunctions` é chamado por `addStandardQueries` e só registra o que
 * ainda não existe: as funções que o MoLang.ts já tinha (is_blank, replace, set_query, print, random...) continuam
 * como estão. A exceção é `run_molang`, que ganha o segundo argumento (atraso em segundos) e mantém a versão
 * original para o caso sem atraso.
 *
 * Argumentos seguem o MoParams do Kotlin: `getBooleanOrNull` é "== 1", `getIntOrNull` trunca, e faltando argumento
 * vale o padrão do Kotlin. Retornos DoubleValue.ONE/ZERO viram 1/0.
 *
 * Sem equivalente no Bedrock:
 * - `curve(nome)`: devolve uma WaveFunction para as animações do cliente Java; aqui retorna 0.
 * - `file`: o Java lê/grava `.json` em `config/`/`data/`; aqui os "arquivos" ficam em dynamic properties do mundo
 *   (`cobblemon:molang_file:<nome>`), com as mesmas regras de nome (`/molang/` no caminho e extensão `.json`).
 */
import { ItemStack, system, world } from "@minecraft/server";
import { MoArray, MoEnvironment, MoFunction, MoStruct, MoValue, asNumber, asString } from "../npc/molang/MoLang";
import { Dex, toID } from "../showdown";
import { getConfig } from "../Config";
import { MOLANG_SCRIPTS } from "../../generated/scripts/npcs";
import { createItemStackStruct } from "./ItemStackStruct";

// ---------------------------------------------------------------------------------------------
// Utilitários de argumento (MoParams do Kotlin)

/** `getBooleanOrNull(i) ?: fallback`: presente vale `== 1`. */
export function argBool(args: MoValue[], index: number, fallback: boolean): boolean {
  return args[index] === undefined ? fallback : asNumber(args[index]) === 1;
}

/** `getIntOrNull(i) ?: fallback`. */
export function argInt(args: MoValue[], index: number, fallback: number): number {
  return args[index] === undefined ? fallback : Math.trunc(asNumber(args[index]));
}

/** `getDoubleOrNull(i) ?: fallback`. */
export function argNumber(args: MoValue[], index: number, fallback: number): number {
  return args[index] === undefined ? fallback : asNumber(args[index]);
}

/** `asIdentifierDefaultingNamespace()` (namespace padrão `cobblemon`). */
export function withNamespace(id: string, namespace = "cobblemon"): string {
  const clean = id.trim().toLowerCase();
  return clean.includes(":") ? clean : `${namespace}:${clean}`;
}

/** Id de som/partícula do Java (`cobblemon:x.y`) no formato do Bedrock (`cobblemon.x.y`; `minecraft:` sai). */
export function bedrockSoundId(id: string): string {
  const clean = id.trim();
  if (clean.startsWith("minecraft:")) return clean.slice("minecraft:".length);
  return clean.replace(":", ".");
}

// ---------------------------------------------------------------------------------------------
// Golpes (MoveTemplate.struct e Move.struct)

/** Categoria no formato do enum DamageCategory. */
function damageCategory(category: string | undefined): string {
  return (category ?? "status").toUpperCase();
}

/**
 * MoveTemplate.struct (`q.get_move_from_id`, learnsets) ou Move.struct (moveset, com `maxPp` já com PP Ups).
 * `display_name`/`description` saem em inglês (o servidor não traduz); `weight` não existe nos dados do port (0).
 * @returns undefined se o golpe não existe (Moves.getByName == null).
 */
export function createMoveStruct(moveId: string, maxPp?: number, pp?: number): MoStruct | undefined {
  const id = toID(moveId);
  const move = Dex.moves.get(id);
  if (!move || !move.exists) return undefined;
  const basePp = move.pp;
  const struct = new MoStruct({}, {}, move);
  struct
    .fn("name", () => id)
    .fn("display_name", () => move.name)
    .fn("description", () => move.shortDesc || move.desc || "")
    .fn("type", () => move.type.toLowerCase())
    .fn("damage_category", () => damageCategory(move.category))
    .fn("power", () => move.basePower)
    .fn("target", () => move.target)
    // Showdown usa `true` para "sempre acerta"; o Cobblemon importa como -1.
    .fn("accuracy", () => (move.accuracy === true ? -1 : move.accuracy))
    .fn("pp", () => pp ?? basePp)
    .fn("max_pp", () => maxPp ?? Math.floor(basePp * 8 / 5))
    .fn("priority", () => move.priority)
    .fn("crit_ratio", () => move.critRatio ?? 1)
    .fn("weight", () => 0);
  return struct;
}

// ---------------------------------------------------------------------------------------------
// q.file (MoLangLoadedFilesCache)

const FILE_PREFIX = "cobblemon:molang_file:";
const loadedFiles = new Map<string, MoStruct>();

/** Mesmas regras do validatePath do Java (sem sistema de arquivos, só o nome importa). */
function validFileName(name: string): boolean {
  if (!name.includes("/molang/") || !name.endsWith(".json") || name.includes("..")) {
    console.warn(`[molang] q.file: nome de arquivo inválido: ${name}`);
    return false;
  }
  return true;
}

function loadFile(name: string): MoStruct {
  let data = loadedFiles.get(name);
  if (data) return data;
  let raw: unknown;
  try {
    const json = world.getDynamicProperty(FILE_PREFIX + name);
    raw = typeof json === "string" ? JSON.parse(json) : undefined;
  }
  catch { raw = undefined; }
  data = MoStruct.fromJSON(raw);
  loadedFiles.set(name, data);
  return data;
}

function fileStruct(): MoStruct {
  return new MoStruct({}, {
    load: args => {
      const name = asString(args[0]);
      return validFileName(name) ? loadFile(name) : new MoStruct();
    },
    save: args => {
      const name = asString(args[0]);
      if (!validFileName(name) || !(args[1] instanceof MoStruct)) return 0;
      loadedFiles.set(name, args[1]);
      try { world.setDynamicProperty(FILE_PREFIX + name, JSON.stringify(args[1].toJSON())); }
      catch (e) { console.warn(`[molang] q.file.save(${name}) falhou: ${e}`); return 0; }
      return 1;
    },
    exists: args => {
      const name = asString(args[0]);
      if (!validFileName(name)) return 0;
      try { return loadedFiles.has(name) || world.getDynamicProperty(FILE_PREFIX + name) !== undefined ? 1 : 0; }
      catch { return 0; }
    },
    // MoLangLoadedFilesCache.clear: só esquece o cache (o arquivo continua salvo).
    clear: args => { loadedFiles.delete(asString(args[0])); return 1; },
  });
}

// ---------------------------------------------------------------------------------------------
// Datas (formato dd/MM/yyyy do Java)

function formatDate(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function parseDate(text: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/.exec(text.trim());
  if (!m) throw new Error(`Cannot parse date ${text}, expected it to be in dd/MM/yyyy format`);
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

// ---------------------------------------------------------------------------------------------
// Structs criados por script

/** SimplePartyProvider.struct: até 6 textos de propriedades e o `isStatic`. */
function simplePartyProviderStruct(): MoStruct {
  const provider = { type: "simple", isStatic: true, pokemon: [] as string[] };
  return new MoStruct({}, {
    add_pokemon: args => {
      if (provider.pokemon.length >= 6) return 0;
      provider.pokemon.push(asString(args[0]));
      return 1;
    },
    clear_pokemon: () => { provider.pokemon.length = 0; return 1; },
    set_static: args => { provider.isStatic = argBool(args, 0, true); return 1; },
    static: () => (provider.isStatic ? 1 : 0),
    pokemon: () => new MoArray(provider.pokemon.slice()),
  }, provider);
}

/** ObtainableItem.struct (itens que o Pokémon apanha do chão; usado pelos configurers do Java). */
function pickupItemStruct(item: string | undefined, priority: number): MoStruct {
  const host = { item, pickupPriority: priority };
  return new MoStruct({ item: item ?? "", pickup_priority: priority }, {}, host);
}

// ---------------------------------------------------------------------------------------------
// Tabela

function isArray(value: MoValue | undefined): value is MoArray {
  return value instanceof MoArray;
}

const GENERAL_FUNCTIONS: Record<string, MoFunction> = {
  delete_variable: args => {
    if (args[0] instanceof MoStruct) args[0].fields.delete(asString(args[1]).toLowerCase());
    return 1;
  },
  delete_variables: args => {
    if (args[0] instanceof MoStruct) args[0].fields.clear();
    return 1;
  },
  get_variable: args => (args[0] instanceof MoStruct ? args[0].get(asString(args[1])) ?? 0 : 0),
  set_variable: args => {
    const value = args[2] ?? 0;
    if (args[0] instanceof MoStruct) args[0].set(asString(args[1]), value);
    return value;
  },
  is_included: args => (asString(args[0]).includes(asString(args[1])) ? 1 : 0),
  to_lower: args => asString(args[0]).toLowerCase(),
  to_upper: args => asString(args[0]).toUpperCase(),
  string_length: args => asString(args[0]).length,
  split_string: args => new MoArray(asString(args[0]).split(asString(args[1]))),
  run_command: args => {
    const command = asString(args[0]).replace(/^\//, "");
    try { return world.getDimension("overworld").runCommand(command).successCount; }
    catch (e) { console.warn(`[molang] run_command falhou (${command}): ${e}`); return 0; }
  },
  is_number: args => {
    const text = asString(args[0]).trim();
    return text !== "" && !Number.isNaN(Number(text)) ? 1 : 0;
  },
  to_number: args => {
    const text = asString(args[0]).trim();
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? n : 0;
  },
  to_int: args => {
    const text = asString(args[0]).trim();
    return /^[+-]?\d+$/.test(text) ? Math.trunc(Number(text)) : 0;
  },
  to_string: args => asString(args[0]),
  do_effect_walks: () => (getConfig().walkingInBattleAnimations ? 1 : 0),
  // WaveFunctions do cliente Java: sem uso no servidor Bedrock.
  curve: () => 0,
  append: args => {
    if (!isArray(args[0])) return 0;
    args[0].items.push(args[1] ?? 0);
    return args[0];
  },
  insert: args => {
    if (!isArray(args[0])) return 0;
    const index = Math.max(0, Math.min(args[0].items.length, argInt(args, 1, 0)));
    args[0].items.splice(index, 0, args[2] ?? 0);
    return args[0];
  },
  delete: args => {
    if (!isArray(args[0])) return 0;
    const index = argInt(args, 1, -1);
    if (index >= 0 && index < args[0].items.length) args[0].items.splice(index, 1);
    return args[0];
  },
  run_script: (args, env) => {
    const id = withNamespace(asString(args[0]));
    const script = MOLANG_SCRIPTS[id];
    if (script === undefined) {
      console.warn(`[molang] run_script: script ${id} não existe`);
      return 0;
    }
    // Os argumentos extras viram c.arg_1, c.arg_2...
    const context = new MoStruct();
    args.slice(1).forEach((value, i) => context.set(`arg_${i + 1}`, value));
    return env.eval(script, context);
  },
  system_time_millis: () => Date.now(),
  date_local_time: () => formatDate(Date.now()),
  date_of: args => formatDate(asNumber(args[0])),
  date_is_after: args => (parseDate(asString(args[0])) > parseDate(asString(args[1])) ? 1 : 0),
  get_move_from_id: args => createMoveStruct(asString(args[0])) ?? 0,
  create_simple_party_provider: () => simplePartyProviderStruct(),
  create_pickup_item: args => pickupItemStruct(args[0] !== undefined ? asString(args[0]) : undefined, argInt(args, 1, 0)),
  create_itemstack: args => {
    const id = withNamespace(asString(args[0]), "minecraft");
    try { return createItemStackStruct(new ItemStack(id, Math.max(1, argInt(args, 1, 1)))); }
    catch {
      console.warn(`[molang] create_itemstack: o item ${id} não existe`);
      return 0;
    }
  },
  file: () => fileStruct(),
};

/**
 * Registra no `q.` as funções gerais que ainda não existem (não troca as do MoLang.ts) e o atraso do `run_molang`.
 */
export function registerGeneralFunctions(query: MoStruct, _env: MoEnvironment): void {
  for (const name in GENERAL_FUNCTIONS) if (!query.functions.has(name)) query.functions.set(name, GENERAL_FUNCTIONS[name]);
  const runMolang = query.functions.get("run_molang");
  if (runMolang && !(runMolang as { delayed?: boolean }).delayed) {
    // q.run_molang(expr, atraso): com atraso > 0, avalia depois (ServerTaskTracker.after) e devolve 1 na hora.
    const delayed: MoFunction = (args, env) => {
      const delay = argNumber(args, 1, 0);
      if (delay <= 0) return runMolang(args, env);
      const expression = asString(args[0]);
      system.runTimeout(() => {
        try { env.eval(expression); }
        catch (e) { console.warn(`[molang] run_molang (atrasado) falhou: ${expression}: ${e}`); }
      }, Math.max(1, Math.round(delay * 20)));
      return 1;
    };
    (delayed as { delayed?: boolean }).delayed = true;
    query.functions.set("run_molang", delayed);
  }
}
