/**
 * Guarda de título dos forms (docs/pendencias/telas-empilhadas.md).
 *
 * O roteador do JSON UI (`ui/server_form.json` e `ui/cobblemon_forms.json`) decide o layout comparando strings:
 * `((#title_text - '§0§1§r') = #title_text)`. Uma string que começa com algo que um parser numérico aceita (dígito,
 * sinal, ou "inf"/"nan", como em "Infernape", "Nancy", "007", "10.000.000 Volt Thunderbolt") é lida pelo JSON UI
 * como número. Aí o `-`/`=` de string deixa de funcionar, e o cliente mostra o form com todos os layouts do roteador
 * ao mesmo tempo (PC, resumo, inicial, Pokédex, diálogo, batalha), um por cima do outro.
 *
 * Títulos com marcador (`withScreen`) começam com "§" e já são sempre texto. Os demais ganham o prefixo invisível
 * `§r`: o texto mostrado é o mesmo, e o título nunca começa com algo numérico. A guarda é aplicada uma vez no
 * `title()` das três telas do `@minecraft/server-ui`, para valer para todas as telas (inclusive as de extensões).
 */
import type { RawMessage } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";

/** Prefixo invisível que mantém o título como texto para o JSON UI. */
export const TITLE_GUARD = "§r";

/** Título que o JSON UI nunca lê como número: quem já começa com "§" (marcador, cor) fica igual. */
export function guardFormTitle(title: string | RawMessage): string | RawMessage {
  if (typeof title === "string") return title.startsWith("§") ? title : TITLE_GUARD + title;
  if (typeof title !== "object" || title === null) return title;
  if (typeof title.text === "string" && title.text.startsWith("§")) return title;
  const first = title.rawtext?.[0];
  if (first && typeof first.text === "string" && first.text.startsWith("§") && first.translate === undefined) return title;
  return { rawtext: [{ text: TITLE_GUARD }, title] };
}

type TitledPrototype = { title?: (title: string | RawMessage) => unknown };
const GUARDED = Symbol.for("cobblemon.formTitleGuard");

/**
 * Envolve `title()` de ActionFormData, ModalFormData e MessageFormData com `guardFormTitle` (uma vez por classe).
 * `classes` só muda nos testes. @returns false se alguma classe não pôde ser envolvida (aviso no log).
 */
export function installFormTitleGuard(classes: Record<string, unknown> = { ActionFormData, ModalFormData, MessageFormData }): boolean {
  let ok = true;
  for (const [name, cls] of Object.entries(classes)) {
    try {
      const proto = (cls as { prototype?: TitledPrototype } | undefined)?.prototype;
      const original = proto?.title;
      if (!proto || typeof original !== "function") { ok = false; console.warn(`[telas] guarda de título: ${name}.prototype.title não existe`); continue; }
      if ((original as unknown as Record<symbol, boolean>)[GUARDED]) continue;
      const guarded = function (this: unknown, title: string | RawMessage) {
        return original.call(this, guardFormTitle(title));
      };
      (guarded as unknown as Record<symbol, boolean>)[GUARDED] = true;
      proto.title = guarded;
    }
    catch (e) {
      ok = false;
      console.warn(`[telas] guarda de título em ${name}: ${e}`);
    }
  }
  return ok;
}
