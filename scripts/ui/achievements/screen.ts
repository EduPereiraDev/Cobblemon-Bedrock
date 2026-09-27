/**
 * Tela das conquistas do Cobblemon (a tela de advancements do Java é uma árvore por aba; a de Conquistas do Bedrock é
 * Ore UI e não aceita add-ons). Esta versão é uma lista por aba em forms do server-ui, com o marcador
 * `SCREEN.ACHIEVEMENTS` no título para a frente "telas" trocar pelo layout em árvore sem mexer no script.
 *
 * Visibilidade igual à do Java: concluídas, ou não ocultas com o pai/avô concluído.
 */
import { Player, RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { AdvancementDef } from "../../../generated/scripts/advancements";
import { SCREEN, withScreen } from "../screens";
import { GLYPH_OWNED } from "../glyphs";
import { isVisible, progressOf } from "./engine";
import { ADVANCEMENTS_BY_ID, ADVANCEMENT_DEFS, getAchievements } from "./tracker";

/** Abas na ordem da árvore do Cobblemon (root + subárvores). */
export const ACHIEVEMENT_TABS = ["catching", "agriculture", "geological", "battle"] as const;

const K = {
  title: "cobblemon.port.advancements.title",
  progress: "cobblemon.port.advancements.progress",
  back: "cobblemon.port.advancements.back",
  done: "cobblemon.port.advancements.done",
  empty: "cobblemon.port.advancements.none_visible",
};

/** Raiz de cada aba (root_catching etc.) para o ícone e o nome. */
function tabRoot(tab: string): AdvancementDef | undefined {
  return ADVANCEMENT_DEFS.find(def => def.tab === tab && !def.parent?.includes("/"));
}

/** Linhas de uma aba (ordem: pai antes dos filhos, como a árvore). */
export function tabEntries(tab: string): AdvancementDef[] {
  const defs = ADVANCEMENT_DEFS.filter(def => def.tab === tab);
  const out: AdvancementDef[] = [];
  const visit = (parent: string | undefined) => {
    for (const def of defs) {
      if (def.parent !== parent || out.includes(def)) continue;
      out.push(def);
      visit(def.id);
    }
  };
  const root = tabRoot(tab);
  if (root) { out.push(root); visit(root.id); }
  for (const def of defs) if (!out.includes(def)) out.push(def);
  return out;
}

/** Profundidade na árvore da aba (raiz = 0), para desenhar a árvore como lista recuada (frente dados-ui). */
export function treeDepth(def: AdvancementDef): number {
  let depth = 0;
  let parent = def.parent;
  const seen = new Set<string>();
  while (parent && ADVANCEMENTS_BY_ID.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    const next = ADVANCEMENTS_BY_ID.get(parent)!;
    if (next.tab !== def.tab) break;
    depth++;
    parent = next.parent;
  }
  return depth;
}

/** Prefixo do ramo ("  └ " por nível), como as linhas da árvore de advancements do Java. */
export function treePrefix(depth: number): string {
  return depth <= 0 ? "" : `§8${"  ".repeat(depth - 1)}└ §r`;
}

function status(player: Player, def: AdvancementDef): RawMessage {
  const p = progressOf(getAchievements(player), def);
  if (p.done) return { text: `${GLYPH_OWNED} §r` };
  return { text: p.total > 1 ? `§8${p.met}/${p.total} §r` : "§8• §r" };
}

async function showTab(player: Player, tab: string): Promise<boolean> {
  const state = getAchievements(player);
  const entries = tabEntries(tab).filter(def => isVisible(state, def, ADVANCEMENTS_BY_ID));
  const root = tabRoot(tab);
  const form = new ActionFormData()
    .title(withScreen(SCREEN.ACHIEVEMENTS, root ? { translate: root.title } : { text: tab }))
    .body(entries.length ? { translate: K.progress, with: [String(entries.filter(d => state.d.includes(d.id)).length), String(entries.length)] } : { translate: K.empty });
  form.button({ translate: K.back });
  for (const def of entries) form.button({ rawtext: [{ text: treePrefix(treeDepth(def)) }, status(player, def), { translate: def.title }] }, def.icon);
  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) return false;
  if (response.selection === 0) return true;
  const def = entries[response.selection - 1];
  if (def) await showDetail(player, def);
  return showTab(player, tab);
}

async function showDetail(player: Player, def: AdvancementDef) {
  const p = progressOf(getAchievements(player), def);
  const form = new ActionFormData()
    .title(withScreen(SCREEN.ACHIEVEMENTS, { translate: def.title }))
    .body({ rawtext: [
      { translate: def.description }, { text: "\n\n" },
      p.done ? { translate: K.done } : { translate: K.progress, with: [String(p.met), String(p.total)] },
    ] })
    .button({ translate: K.back }, def.icon);
  await form.show(player);
}

/** Abre a tela de conquistas (abas → lista → detalhe). */
export async function openAchievements(player: Player): Promise<void> {
  while (player.isValid) {
    const state = getAchievements(player);
    const form = new ActionFormData().title(withScreen(SCREEN.ACHIEVEMENTS, { translate: K.title }));
    const rootDef = ADVANCEMENT_DEFS.find(def => !def.parent);
    if (rootDef) form.body({ rawtext: [{ translate: rootDef.title }, { text: "\n" }, { translate: rootDef.description }] });
    for (const tab of ACHIEVEMENT_TABS) {
      const root = tabRoot(tab);
      const defs = ADVANCEMENT_DEFS.filter(def => def.tab === tab);
      const done = defs.filter(def => state.d.includes(def.id)).length;
      form.button({ rawtext: [{ translate: root?.title ?? tab }, { text: `\n§8${done}/${defs.length}` }] }, root?.icon);
    }
    const response = await form.show(player);
    if (response.canceled || response.selection === undefined) return;
    const back = await showTab(player, ACHIEVEMENT_TABS[response.selection]);
    if (!back) return;
  }
}
