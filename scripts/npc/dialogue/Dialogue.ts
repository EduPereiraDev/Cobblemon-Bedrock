/**
 * Modelo de diálogo do Cobblemon 1.8.2 (api/dialogue/*) e leitura do JSON de data/cobblemon/dialogues
 * com as mesmas regras dos adapters (DialogueTextAdapter, DialogueActionAdapter, DialogueInputAdapter,
 * DialoguePredicateAdapter).
 *
 * - Texto: string = chave de tradução (asTranslated, cai no texto literal se a chave não existir);
 *   `{type: "expression", expression}` ou lista = MoLang que devolve string; objeto sem `type` = Component JSON.
 * - Ação/predicado: string ou lista de strings = MoLang.
 * - Entrada: string/lista = sem entrada (ação ao continuar); objeto com `type` option | text | auto-continue | none.
 */
import { DIALOGUES } from "../../../generated/scripts/npcs";

export type DialogueText =
  | { kind: "translated"; key: string }
  | { kind: "expression"; expression: string | string[] }
  | { kind: "component"; text: string };

/** Ação MoLang; `undefined` = ação padrão do tipo de entrada. */
export type DialogueAction = string | string[];
/** Predicado MoLang; `undefined` = verdadeiro. */
export type DialoguePredicate = string | string[];

export interface DialogueTimeout {
  /** Segundos. */
  duration: number;
  showTimer: boolean;
  /** Padrão: fechar o diálogo. */
  action?: DialogueAction;
}

export interface DialogueOption {
  text: DialogueText;
  value: string;
  action?: DialogueAction;
  isVisible?: DialoguePredicate;
  isSelectable?: DialoguePredicate;
}

export type DialogueInput =
  | { type: "none"; action?: DialogueAction }
  | { type: "option"; options: DialogueOption[]; vertical: boolean; timeout?: DialogueTimeout }
  | { type: "text"; action?: DialogueAction; timeout?: DialogueTimeout }
  | { type: "auto-continue"; delay: number; allowSkip: boolean; showTimer: boolean; action?: DialogueAction };

/** DialogueGibber: sons de "fala" tocados enquanto o texto aparece (um a cada `step` caracteres, a cada `interval` s). */
export interface DialogueGibber {
  step: number;
  interval: number;
  minPitch: number;
  maxPitch: number;
  minVolume: number;
  maxVolume: number;
  /** Ids de som do Cobblemon ("cobblemon:entity.npc.gibber.generic"). */
  sounds: string[];
}

export function parseGibber(json: unknown): DialogueGibber | undefined {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    step: Math.max(1, Math.trunc(n(o.step, 4))),
    interval: Math.max(0.05, n(o.interval, 0.1)),
    minPitch: n(o.minPitch, 0.9),
    maxPitch: n(o.maxPitch, 1.1),
    minVolume: n(o.minVolume, 0.9),
    maxVolume: n(o.maxVolume, 1.0),
    sounds: Array.isArray(o.sounds) && o.sounds.length ? o.sounds.map(String) : ["cobblemon:entity.npc.gibber.generic"],
  };
}

export interface DialogueSpeaker {
  name?: DialogueText;
  /** Retrato (DialogueFace): só guardado; o Bedrock não desenha modelos 3D em forms. */
  face?: unknown;
  gibber?: DialogueGibber;
}

export interface DialoguePage {
  id: string;
  speaker?: string;
  lines: DialogueText[];
  input: DialogueInput;
  textColor?: string;
  background?: string;
  escapeAction?: DialogueAction;
  /** Ações do cliente (animação do retrato): sem equivalente, ignoradas. */
  clientActions: string[];
  gibber?: DialogueGibber;
}

export interface Dialogue {
  id: string;
  pages: DialoguePage[];
  speakers: Record<string, DialogueSpeaker>;
  /** Padrão: fechar o diálogo. */
  escapeAction?: DialogueAction;
  initializationAction?: DialogueAction;
  background?: string;
}

export class DialogueParseError extends Error { }

function parseText(json: unknown): DialogueText {
  if (typeof json === "string" || typeof json === "number" || typeof json === "boolean") return { kind: "translated", key: String(json) };
  if (Array.isArray(json)) return { kind: "expression", expression: json.map(String) };
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (typeof obj.type === "string") {
      if (obj.type !== "expression") throw new DialogueParseError(`tipo de texto desconhecido: ${obj.type}`);
      const expr = obj.expression;
      return { kind: "expression", expression: Array.isArray(expr) ? expr.map(String) : String(expr ?? "''") };
    }
    // Component JSON do Minecraft ({"text": ...} / {"translate": ...}).
    if (typeof obj.translate === "string") return { kind: "translated", key: obj.translate };
    return { kind: "component", text: String(obj.text ?? "") };
  }
  return { kind: "component", text: "" };
}

function parseAction(json: unknown): DialogueAction | undefined {
  if (json === undefined || json === null) return undefined;
  if (Array.isArray(json)) return json.map(String);
  if (typeof json === "object") throw new DialogueParseError("ações por tipo (objeto) não são suportadas");
  return String(json);
}

function parseTimeout(json: unknown): DialogueTimeout | undefined {
  if (!json || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;
  return {
    duration: typeof obj.delay === "number" ? obj.delay : typeof obj.duration === "number" ? obj.duration : 10,
    showTimer: obj.showTimer !== false,
    action: parseAction(obj.action),
  };
}

function parseInput(json: unknown): DialogueInput {
  if (json === undefined || json === null) return { type: "none" };
  if (typeof json === "string" || Array.isArray(json) || typeof json === "number") return { type: "none", action: parseAction(json) };
  const obj = json as Record<string, unknown>;
  switch (obj.type) {
    case "option":
      return {
        type: "option",
        vertical: obj.vertical === true,
        timeout: parseTimeout(obj.timeout),
        options: (Array.isArray(obj.options) ? obj.options : []).map((o: any) => ({
          text: parseText(o?.text ?? ""),
          value: String(o?.value ?? ""),
          action: parseAction(o?.action),
          isVisible: parseAction(o?.isVisible),
          isSelectable: parseAction(o?.isSelectable),
        })),
      };
    case "text":
      return { type: "text", action: parseAction(obj.action), timeout: parseTimeout(obj.timeout) };
    case "auto-continue":
      return {
        type: "auto-continue",
        delay: typeof obj.delay === "number" ? obj.delay : 5,
        allowSkip: obj.allowSkip !== false,
        showTimer: obj.showTimer === true,
        action: parseAction(obj.action),
      };
    case "none":
      return { type: "none", action: parseAction(obj.action) };
    default:
      throw new DialogueParseError(`tipo de entrada desconhecido: ${String(obj.type)}`);
  }
}

function parseSpeaker(json: unknown): DialogueSpeaker {
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return { name: obj.name !== undefined ? parseText(obj.name) : undefined, face: obj.face, gibber: parseGibber(obj.gibber) };
}

/** Lê um diálogo do JSON do Cobblemon. @throws DialogueParseError */
export function parseDialogue(id: string, json: unknown): Dialogue {
  if (!json || typeof json !== "object") throw new DialogueParseError(`diálogo ${id} inválido`);
  const obj = json as Record<string, unknown>;
  const pages = (Array.isArray(obj.pages) ? obj.pages : []).map((p: any, i: number): DialoguePage => ({
    id: typeof p?.id === "string" ? p.id : "",
    speaker: typeof p?.speaker === "string" ? p.speaker : undefined,
    lines: (Array.isArray(p?.lines) ? p.lines : p?.lines !== undefined ? [p.lines] : []).map(parseText),
    input: parseInput(p?.input),
    textColor: typeof p?.textColor === "string" ? p.textColor : undefined,
    background: typeof p?.background === "string" ? p.background : undefined,
    escapeAction: parseAction(p?.escapeAction),
    clientActions: Array.isArray(p?.clientActions) ? p.clientActions.map(String) : [],
    gibber: parseGibber(p?.gibber),
  }));
  if (!pages.length) throw new DialogueParseError(`diálogo ${id} sem páginas`);
  const speakers: Record<string, DialogueSpeaker> = {};
  if (obj.speakers && typeof obj.speakers === "object")
    for (const [k, v] of Object.entries(obj.speakers as Record<string, unknown>)) speakers[k] = parseSpeaker(v);
  return {
    id,
    pages,
    speakers,
    escapeAction: parseAction(obj.escapeAction),
    initializationAction: parseAction(obj.initializationAction),
    background: typeof obj.background === "string" ? obj.background : undefined,
  };
}

/** "npc-example" → "cobblemon:npc-example"; aceita "dialogues/x.json" antigo. */
export function normalizeDialogueId(id: string): string {
  let clean = id.trim().toLowerCase().replace(/\.json$/, "");
  if (!clean.includes(":")) clean = `cobblemon:${clean}`;
  return clean.replace(/:dialogues\//, ":");
}

const loaded = new Map<string, Dialogue | null>();
/** Diálogos registrados por código (API para outras frentes / addons). */
const registered = new Map<string, Dialogue>();

export function registerDialogue(dialogue: Dialogue) {
  registered.set(normalizeDialogueId(dialogue.id), dialogue);
}

/** Diálogo pelo id (parse sob demanda do JSON gerado). */
export function getDialogue(id: string): Dialogue | undefined {
  const key = normalizeDialogueId(id);
  const custom = registered.get(key);
  if (custom) return custom;
  if (loaded.has(key)) return loaded.get(key) ?? undefined;
  const raw = DIALOGUES[key];
  let dialogue: Dialogue | null = null;
  if (raw !== undefined) {
    try { dialogue = parseDialogue(key, JSON.parse(raw)); }
    catch (e) { console.warn(`Diálogo ${key} inválido: ${e}`); }
  }
  loaded.set(key, dialogue);
  return dialogue ?? undefined;
}

export function getDialogueIds(): string[] {
  return [...new Set([...Object.keys(DIALOGUES), ...registered.keys()])].sort();
}
