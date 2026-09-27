/**
 * Golpe gravado no TM (`cobblemon:technical_machine`).
 *
 * No Cobblemon 1.8.2 o golpe fica no componente de item `cobblemon:tm_move` ({ move: "<nome>" }) e aparece
 * em cinza na dica do item. No Bedrock, dynamic property em ItemStack só funciona em itens não empilháveis,
 * então o golpe fica na lore, no mesmo formato da Máquina de TM (scripts/machines/tm.ts):
 * `{ translate: "cobblemon.port.tm.move", with: { rawtext: [{ translate: "cobblemon.move.<id>" }, { text: "<id>" }] } }`
 * (a lang mostra só o 1º argumento). Lores diferentes não empilham: cada golpe é uma pilha, como no Java.
 */
import { ItemStack, RawMessage } from "@minecraft/server";
import { Dex, toID } from "../showdown";

export const TECHNICAL_MACHINE = "cobblemon:technical_machine";
export const BLANK_TM = "cobblemon:blank_tm";
/** Chave da linha de lore do TM (compartilhada com a Máquina de TM). */
export const TM_LORE_KEY = "cobblemon.port.tm.move";
const MOVE_KEY_PREFIX = "cobblemon.move.";

/** Linha de lore que identifica o golpe do TM. */
export function tmLoreLine(move: string): RawMessage {
  const id = toID(move);
  return { translate: TM_LORE_KEY, with: { rawtext: [{ translate: `${MOVE_KEY_PREFIX}${id}` }, { text: id }] } };
}

/** Argumentos de uma RawMessage (`with` pode ser lista de textos ou RawMessage). */
function argsOf(raw: RawMessage): RawMessage[] {
  const args = raw.with;
  if (!args) return [];
  return Array.isArray(args) ? args.map(text => ({ text })) : args.rawtext ?? [args];
}

/** Procura o golpe numa RawMessage: linha do TM (2º argumento = id) ou `cobblemon.move.<id>` em qualquer parte. */
function findMoveKey(raw: RawMessage | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.translate === TM_LORE_KEY) {
    const id = argsOf(raw)[1]?.text;
    if (id) return toID(id);
  }
  if (typeof raw.translate === "string" && raw.translate.startsWith(MOVE_KEY_PREFIX)) return raw.translate.slice(MOVE_KEY_PREFIX.length);
  for (const part of [...(raw.rawtext ?? []), ...argsOf(raw)]) {
    const found = findMoveKey(part);
    if (found) return found;
  }
  return undefined;
}

/** Golpe de uma lore (RawMessage ou texto simples como "Thunderbolt" / "cobblemon.move.thunderbolt"). */
export function parseTMMove(lore: (RawMessage | string)[]): string | undefined {
  for (const line of lore) {
    let id: string | undefined;
    if (typeof line === "string") {
      const key = line.match(/cobblemon\.move\.([a-z0-9]+)/);
      id = key ? key[1] : toID(line.replace(/§./g, ""));
    }
    else id = findMoveKey(line);
    if (id && Dex.moves.get(id).exists) return Dex.moves.get(id).id;
  }
  return undefined;
}

/** TMMoveComponent.getTMMove: golpe gravado no TM, ou undefined (TM sem golpe = "Unknown Move"). */
export function getTMMove(stack: ItemStack | undefined): string | undefined {
  if (!stack || stack.typeId !== TECHNICAL_MACHINE) return undefined;
  try {
    const raw = stack.getRawLore();
    const move = parseTMMove(raw);
    if (move) return move;
  } catch { }
  try { return parseTMMove(stack.getLore()); } catch { }
  return undefined;
}

/** TMMoveComponent.setTMMove: grava o golpe no TM (substitui a lore). */
export function setTMMove(stack: ItemStack, move: string): ItemStack {
  stack.setLore([tmLoreLine(move)]);
  return stack;
}

/**
 * TMMoveComponent.createStack: um TM com o golpe. Para a Máquina de TM, loot e comandos.
 * @throws se o golpe não existir.
 */
export function createTechnicalMachine(move: string, amount = 1): ItemStack {
  const id = toID(move);
  if (!Dex.moves.get(id).exists) throw new Error(`Golpe desconhecido para TM: ${move}`);
  return setTMMove(new ItemStack(TECHNICAL_MACHINE, amount), Dex.moves.get(id).id);
}
