/**
 * Resumo do Pokémon (port de `client/gui/summary/*`): abas Info, Golpes, Atributos e Marcas.
 *
 * Frente telas: o DDUI (`CustomForm`) não pode ser reskinado (é Ore UI), então cada aba é um `ActionFormData`
 * roteado (SCREEN.SUMMARY + sub-marcador da aba) para o layout `ui/summary.json` (331×161, texturas do Cobblemon):
 * perfil 128 px na janela do retrato (ou o modelo 3D ao vivo pelo estúdio de câmera, botão 3D/2D), cabeçalho com
 * gênero/brilhante/Poké Ball, item, tipos, o time à direita (tocar troca o Pokémon exibido) e o conteúdo da aba:
 * linhas + barras de atributos, tiles de golpe pintados pelo tipo (tocar mostra a descrição) e ícones de marcas.
 * Trocar de aba reabre o form na hora.
 */
import { Player, RawMessage } from "@minecraft/server";
import { getFullness, getMaxFullness } from "../pokemon/Fullness";
import { hasBlocksTraveledRequirement } from "../pokemon/BlocksTraveled";
import { getBlocksTraveled, getIntFeature } from "../pokemon/SpeciesFeatures";

import { PokemonData } from "../Pokemon";
import { getSpeciesData, toSpeciesId } from "../speciesData";
import { renderMove } from "../language";
import { typeColorCodes } from "../language";
import { ElementalType } from "../Pokemon";
import { Dex, toID } from "../showdown";
import { getSafeTeam } from "../pokemonStorage";
import { SCREEN } from "../ui/screens";
import { GLYPH_FEMALE, GLYPH_MALE, GLYPH_SHINY, CATEGORY_GLYPHS, typeGlyph } from "../ui/glyphs";
import { FRAMING, closeStudio, hasStudio, openStudio, prefersStudio, setPrefersStudio, studioAvailable, studioEntityOf } from "../ui/studio";
import { playPoserAnimation } from "../battle/Animations";
import {
  BLANK, CellForm, GUI, SUB, SUMMARY, SUMMARY_TABS, SummaryTab, barTexture, layoutTitle, typeKeyTexture,
} from "./layout";
import {
  K, abilityName, getLivePokemon, getPokemonIconTexture, getPokemonProfileTexture, getExpProgress, getForm, getFriendship, getMarks, getMintedNature, getPokemonTypes,
  hpText, itemName, join, natureName, statusLabel, tr, typeName,
} from "./common";
import { STAT_LANG, STAT_ORDER } from "./PokemonEdit";
import { sizeCategoryKey } from "../pokemon/Scale";
import { RIDE_STYLES, RIDING_STATS, getMaxRideBoost, getRideBoost, getRideStat, rideInfoOf, rideStyleLangKey, statRange } from "../pokemon/RideStats";
import type { RideStyle } from "../entity/EntityData";
import { cycleMarking, getMarkings, setMarkings } from "../pokemon/Markings";

export interface SummarySection {
  /** Chave de tradução do título da aba. */
  title: string;
  lines: RawMessage[];
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read(); } catch { return fallback; }
}

function label(key: string, value: RawMessage | string): RawMessage {
  return join("§7", { translate: key }, ": §r", value);
}

/** Cabeçalho: "Pikachu ♂ ★ Nv. 12". */
export function summaryHeader(pokemon: PokemonData): RawMessage {
  const gender = pokemon.gender === "m" ? " §9♂§r" : pokemon.gender === "f" ? " §d♀§r" : "";
  const shiny = pokemon.shiny ? " §e★§r" : "";
  return join("§l", pokemon.getTranslatedName(), `§r${gender}${shiny} `, tr("cobblemon.label.lv", pokemon.level));
}

/** Monta o conteúdo das abas. Função pura (só lê o PokemonData). */
export function buildSummarySections(pokemon: PokemonData): SummarySection[] {
  const species = getSpeciesData(pokemon.species);
  const types = getPokemonTypes(pokemon);
  const form = getForm(pokemon);
  const minted = getMintedNature(pokemon);
  const exp = getExpProgress(pokemon);
  const status = statusLabel(pokemon);

  const typeParts: (string | RawMessage)[] = [];
  types.forEach((type, i) => {
    if (i > 0) typeParts.push("§r / ");
    typeParts.push(typeColorCodes[type as ElementalType] ?? "", typeName(type));
  });

  const info: RawMessage[] = [
    label("cobblemon.ui.info.species", join(`#${species?.nationalPokedexNumber ?? "?"} `, { translate: `cobblemon.species.${species ? pokemon.species : "unknown"}.name` })),
  ];
  if (form) info.push(label("cobblemon.ui.pokedex.info.form", form.name));
  info.push(label("cobblemon.ui.info.type", join(...typeParts)));
  info.push(label("cobblemon.ui.info.original_trainer", pokemon.ogTrainer ?? "-"));
  info.push(label("cobblemon.ui.info.nature", minted
    ? join(natureName(pokemon.nature), " §8(", tr(K.minted, natureName(minted)), "§8)")
    : natureName(pokemon.nature || "hardy")));
  const hidden = safe(() => pokemon.hasHiddenAbility(), false);
  info.push(label("cobblemon.ui.info.ability", pokemon.ability ? join(abilityName(pokemon.ability), hidden ? " §d(H)" : "") : "-"));
  info.push(label("cobblemon.ui.info.experience_points", exp.experience.toString()));
  info.push(label("cobblemon.ui.info.to_next_level", exp.toNextLevel.toString()));
  info.push(label("cobblemon.ui.stats.friendship", getFriendship(pokemon).toString()));
  // Pedido E da jogabilidade: saciedade, passos (só com requisito de evolução) e estoque do Gimmighoul.
  info.push(label("cobblemon.ui.stats.fullness", `${safe(() => getFullness(pokemon), 0)}/${safe(() => getMaxFullness(pokemon), 0)}`));
  if (safe(() => hasBlocksTraveledRequirement(pokemon), false)) info.push(label("cobblemon.ui.stats.blocks_traveled", safe(() => getBlocksTraveled(pokemon), 0).toString()));
  const coins = safe(() => getIntFeature(pokemon, "gimmighoul_coins"), undefined);
  if (coins !== undefined) info.push(label("cobblemon.ui.stash.gold", coins.toString()));
  const scrap = safe(() => getIntFeature(pokemon, "gimmighoul_netherite"), undefined);
  if (scrap !== undefined) info.push(label("cobblemon.ui.stash.netherite", scrap.toString()));
  info.push(label(K.heldItem, itemName(pokemon.minecraftItem)));
  if (pokemon.cosmeticItem) info.push(label("cobblemon.cosmetic_item", itemName(pokemon.cosmeticItem)));
  // PokemonSizeCategory (XS..XL) do tamanho intrínseco.
  const size = safe(() => pokemon.getSizeCategory(), undefined);
  if (size) info.push(join("§7", tr("cobblemon.size_category.prefix", { translate: sizeCategoryKey(size) })));
  info.push(label(K.ball, itemName(pokemon.pokeball ?? "cobblemon:poke_ball")));
  info.push(label("cobblemon.ui.stats.hp", status ? join(hpText(pokemon), "  §c", status) : hpText(pokemon)));

  const stats = pokemon.getCurrentStats();
  const statLines: RawMessage[] = [
    join("§7", { translate: "cobblemon.ui.stats.stat" }, " | ", { translate: "cobblemon.ui.stats.ivs" }, " | ", { translate: "cobblemon.ui.stats.evs" }),
  ];
  for (const stat of STAT_ORDER) {
    const iv = safe(() => pokemon.getEffectiveIv(stat), pokemon.ivs[stat] ?? 0);
    const trained = safe(() => pokemon.isHyperTrained(stat), false) ? "§6*" : "";
    statLines.push(join("§f", { translate: STAT_LANG[stat] }, `: §l${stats[stat]}§r  §7IV §b${iv}${trained}§7  EV §a${pokemon.evs[stat] ?? 0}`));
  }
  const evTotal = STAT_ORDER.reduce((sum, stat) => sum + (pokemon.evs[stat] ?? 0), 0);
  statLines.push(join("§7", { translate: "cobblemon.ui.stats.evs" }, `: ${evTotal}/510`));

  const moves: RawMessage[] = pokemon.moves.map((move, i) => {
    const rendered = renderMove(move, pokemon.movesInfo[i]);
    return typeof rendered === "string" ? { text: rendered } : rendered;
  });
  if (moves.length === 0) moves.push({ text: "-" });

  const marks = getMarks(pokemon).map(mark => join(mark === pokemon.activeMark ? "§e★ §r" : "", { translate: `cobblemon.mark.${mark.replace(/^[a-z0-9_]+:/, "")}` }));
  if (marks.length === 0) marks.push(tr(K.noMarks));

  return [
    { title: "cobblemon.ui.info", lines: info },
    { title: "cobblemon.ui.stats", lines: statLines },
    { title: "cobblemon.ui.moves", lines: moves },
    { title: K.marks, lines: marks },
  ];
}

/** Ação de uma célula do resumo. */
export type SummaryAction =
  | { kind: "tab"; tab: SummaryTab }
  | { kind: "cry" }
  | { kind: "marking"; index: number }
  | { kind: "party"; slot: number }
  | { kind: "studio" }
  | { kind: "move"; index: number }
  | { kind: "mark"; index: number };

export interface SummaryView {
  tab: SummaryTab;
  /** Modelo 3D ao vivo atrás da janela (layout "estúdio"). */
  studio: boolean;
  /** O botão 3D/2D aparece (há espaço para o estúdio). */
  studioToggle: boolean;
  /** Time do jogador, se o Pokémon está nele (painel da direita). */
  party?: (PokemonData | null)[];
  /** Golpe/marca destacado (descrição no corpo). */
  selected?: number;
  /**
   * Página da aba Atributos (StatWidget: STATS/IV/EV juntos no port, RIDE por estilo): undefined = atributos;
   * um estilo = atributos de montaria daquele estilo. Tocar na aba Atributos de novo avança a página.
   */
  statsPage?: RideStyle;
  /** Markings em edição (MarkingsWidget.markingStates; gravadas ao sair/trocar). */
  markings?: number[];
}

/** Estilos de montaria da forma na ordem do Cobblemon (páginas RIDE da aba Atributos). */
export function rideStylesOf(pokemon: PokemonData): RideStyle[] {
  const info = safe(() => rideInfoOf(pokemon), undefined);
  return info ? RIDE_STYLES.filter(style => !!info.styles[style]) : [];
}

/** Próxima página da aba Atributos: atributos → estilos de montaria → atributos. */
export function nextStatsPage(pokemon: PokemonData, current: RideStyle | undefined): RideStyle | undefined {
  const styles = rideStylesOf(pokemon);
  if (!styles.length) return undefined;
  if (current === undefined) return styles[0];
  const i = styles.indexOf(current);
  return i >= 0 && i < styles.length - 1 ? styles[i + 1] : undefined;
}

/** Linhas da página RIDE (StatWidget: rótulo, valor e o bônus em % do máximo). */
export function rideStatLines(pokemon: PokemonData, style: RideStyle): { label: RawMessage; value: number; max: number; boostPercent: number }[] {
  const info = rideInfoOf(pokemon);
  const settings = info?.styles[style];
  if (!settings) return [];
  return RIDING_STATS.map(stat => {
    const [, max] = statRange(settings, stat);
    const maxBoost = getMaxRideBoost(pokemon, stat, info);
    const boost = getRideBoost(pokemon, stat);
    return {
      label: { translate: `cobblemon.ui.stats.ride.${stat.toLowerCase()}` },
      value: Math.floor(getRideStat(pokemon, style, stat, info)),
      max,
      boostPercent: maxBoost > 0 ? Math.floor((boost / maxBoost) * 100) : 0,
    };
  });
}

/** Sub-marcador da aba (função, não tabela no topo do módulo: Summary participa de ciclos de import). */
function tabMarker(tab: SummaryTab) {
  return tab === "moves" ? SUB.SUMMARY_MOVES : tab === "stats" ? SUB.SUMMARY_STATS : tab === "marks" ? SUB.SUMMARY_MARKS : SUB.SUMMARY_INFO;
}
// Literal (não K.marks): Summary entra num ciclo de imports e K ainda não existe na avaliação do módulo.
const TAB_LANG: Record<SummaryTab, string> = { info: "cobblemon.ui.info", moves: "cobblemon.ui.moves", stats: "cobblemon.ui.stats", marks: "cobblemon.port.summary.marks" };
const MOVE_CATEGORY: Record<string, string> = { Physical: "physical", Special: "special", Status: "status" };

function lines(parts: RawMessage[]): RawMessage {
  const out: RawMessage[] = [];
  parts.forEach((line, i) => { if (i > 0) out.push({ text: "\n" }); out.push(line); });
  return { rawtext: out };
}

/** Texto do tile de golpe do resumo: tipo + nome; categoria + PP. */
function moveTileText(pokemon: PokemonData, index: number): RawMessage {
  const id = pokemon.moves[index];
  const move = Dex.moves.get(id);
  const info = pokemon.movesInfo[index];
  const pp = info ? `${info.pp}/${info.maxPp}` : `${move.pp}/${move.pp}`;
  const low = info && info.maxPp > 0 && info.pp <= Math.floor(info.maxPp / 2) ? (info.pp === 0 ? "§c" : "§6") : "§f";
  return join(`§f${typeGlyph(toID(move.type))} `, { translate: `cobblemon.move.${toID(id)}` },
    `\n${CATEGORY_GLYPHS[move.category] ?? ""} §fPP ${low}${pp}`);
}

/** Corpo da aba Golpes: descrição, poder, precisão e categoria do golpe escolhido. */
function moveDetails(pokemon: PokemonData, index: number): RawMessage {
  const id = pokemon.moves[index];
  if (!id) return { text: "" };
  const move = Dex.moves.get(id);
  const power = move.basePower > 0 ? String(move.basePower) : "—";
  const accuracy = move.accuracy === true ? "—" : `${move.accuracy}%`;
  return join("§7", { translate: "cobblemon.ui.power" }, `: §f${power}  §7`, { translate: "cobblemon.ui.accuracy" }, `: §f${accuracy}  §7`,
    { translate: `cobblemon.move.category.${MOVE_CATEGORY[move.category] ?? "status"}` }, "\n§f", { translate: `cobblemon.move.${toID(id)}.desc` });
}

/**
 * Monta o form da aba (função pura sobre os dados: testável). Os índices seguem `SUMMARY` de `layoutSpec.ts`.
 */
export function buildSummaryForm(pokemon: PokemonData, view: SummaryView): CellForm<SummaryAction> {
  const subs = view.studio ? [tabMarker(view.tab), SUB.STUDIO] : [tabMarker(view.tab)];
  const form = new CellForm<SummaryAction>(layoutTitle(SCREEN.SUMMARY, subs, tr("cobblemon.ui.summary.title")), SUMMARY.COUNT);
  SUMMARY_TABS.forEach((tab, i) => form.cell(SUMMARY.TABS + i, tr(TAB_LANG[tab]), `${GUI}/summary/summary_tab_icon_${tab}`, { kind: "tab", tab }));
  // Tocar no retrato toca o grito (ModelWidget.playCryOnClick).
  form.cell(SUMMARY.PORTRAIT, BLANK, view.studio ? undefined : getPokemonProfileTexture(pokemon), { kind: "cry" });
  // Markings (MarkingsWidget): o texto "m<estado>" escolhe o quadro da textura no JSON UI.
  const markings = view.markings ?? getMarkings(pokemon);
  markings.forEach((state, i) => form.cell(SUMMARY.MARKINGS + i, `m${state}`, `${GUI}/summary/icon_marking_${i}`, { kind: "marking", index: i }));
  const gender = pokemon.gender === "m" ? ` §9${GLYPH_MALE}` : pokemon.gender === "f" ? ` §d${GLYPH_FEMALE}` : "";
  form.cell(SUMMARY.NAME, join("§f", pokemon.getTranslatedName(), `§r${gender}${pokemon.shiny ? ` §e${GLYPH_SHINY}` : ""}`));
  const ball = (pokemon.pokeball ?? "cobblemon:poke_ball").replace(/^[a-z0-9_]+:/, "");
  form.cell(SUMMARY.LEVEL, tr("cobblemon.label.lv", pokemon.level), `${GUI}/ball/${ball}`);
  form.cell(SUMMARY.ITEM, itemName(pokemon.minecraftItem));
  const types = getPokemonTypes(pokemon);
  const typeParts: (string | RawMessage)[] = [];
  types.forEach((type, i) => typeParts.push(i > 0 ? " " : "", `§f${typeGlyph(type)}`, typeColorCodes[type as ElementalType] ?? "", typeName(type)));
  const status = statusLabel(pokemon);
  form.cell(SUMMARY.TYPES, join(...typeParts, "\n", hpText(pokemon), status ? join(" §c", status) : undefined));
  if (view.studioToggle) form.cell(SUMMARY.STUDIO, view.studio ? "2D" : "3D", undefined, { kind: "studio" });
  view.party?.slice(0, 6).forEach((member, i) => {
    if (!member) return;
    const current = member.uuid === pokemon.uuid;
    form.cell(SUMMARY.PARTY + i, `${current ? "§e" : "§f"}${member.level}`, getPokemonIconTexture(member), { kind: "party", slot: i });
  });

  const sections = buildSummarySections(pokemon);
  switch (view.tab) {
    case "info":
      form.body(lines(sections[0].lines));
      break;
    case "stats": {
      if (view.statsPage) {
        const style = view.statsPage;
        const settings = safe(() => rideInfoOf(pokemon)?.styles[style], undefined);
        rideStatLines(pokemon, style).forEach((line, i) => {
          form.cell(SUMMARY.STAT_ROWS + i, join("§f", line.label, `: §l${line.value}§r§7/${line.max}  §a+${line.boostPercent}%`));
          form.cell(SUMMARY.STAT_BARS + i, BLANK, barTexture(line.value, 100));
        });
        form.body(lines([
          join("§7", { translate: "cobblemon.ui.stats.ride" }, ": §f", { translate: rideStyleLangKey(style, settings?.key) }, "§7 | ", { translate: rideStyleLangKey(style) }),
          tr("cobblemon.port.summary.ride_next"),
        ]));
        break;
      }
      const stats = pokemon.getCurrentStats();
      const top = Math.max(1, ...STAT_ORDER.map(stat => stats[stat] ?? 0));
      STAT_ORDER.forEach((stat, i) => {
        const iv = safe(() => pokemon.getEffectiveIv(stat), pokemon.ivs[stat] ?? 0);
        const trained = safe(() => pokemon.isHyperTrained(stat), false) ? "§6*" : "";
        form.cell(SUMMARY.STAT_ROWS + i, join("§f", { translate: STAT_LANG[stat] }, `: §l${stats[stat]}§r  §7IV §b${iv}${trained}  §7EV §a${pokemon.evs[stat] ?? 0}`));
        form.cell(SUMMARY.STAT_BARS + i, BLANK, barTexture(stats[stat] ?? 0, top));
      });
      // Abaixo das barras: total de EVs, amizade e saciedade (summary_stats_other_*).
      form.body(lines([
        sections[1].lines[sections[1].lines.length - 1],
        label("cobblemon.ui.stats.friendship", getFriendship(pokemon).toString()),
        label("cobblemon.ui.stats.fullness", `${safe(() => getFullness(pokemon), 0)}/${safe(() => getMaxFullness(pokemon), 0)}`),
        ...(rideStylesOf(pokemon).length ? [tr("cobblemon.port.summary.ride_next")] : []),
      ]));
      break;
    }
    case "moves":
      pokemon.moves.slice(0, 4).forEach((move, i) => form.cell(SUMMARY.MOVES + i, moveTileText(pokemon, i),
        typeKeyTexture(toID(Dex.moves.get(move).type)), { kind: "move", index: i }));
      form.body(pokemon.moves.length ? moveDetails(pokemon, Math.min(view.selected ?? 0, pokemon.moves.length - 1)) : tr(K.movesEmptySlot));
      break;
    case "marks": {
      const marks = getMarks(pokemon).slice(0, SUMMARY.MARK_SLOTS);
      marks.forEach((mark, i) => {
        const id = mark.replace(/^[a-z0-9_]+:/, "");
        form.cell(SUMMARY.MARKS + i, { translate: `cobblemon.mark.${id}` }, `${GUI}/mark/${id}`, { kind: "mark", index: i });
      });
      const chosen = marks[view.selected ?? marks.findIndex(m => m === pokemon.activeMark)] ?? marks[0];
      if (!chosen) form.body(tr(K.noMarks));
      else {
        const id = chosen.replace(/^[a-z0-9_]+:/, "");
        form.body(join(chosen === pokemon.activeMark ? "§e★ " : "§f", { translate: `cobblemon.mark.${id}` }, "\n§7", { translate: `cobblemon.mark.${id}.desc` }));
      }
      break;
    }
  }
  return form;
}

/**
 * Mostra o resumo. Resolve quando o jogador fecha a tela.
 * @param options.tab aba inicial; `studio` força a vista 3D (padrão: preferência do jogador, 2D sem escolha).
 */
export async function showSummary(player: Player, pokemon: PokemonData, options: { tab?: SummaryTab; studio?: boolean } = {}): Promise<void> {
  let current = pokemon;
  let tab: SummaryTab = options.tab ?? "info";
  let selected: number | undefined;
  let statsPage: RideStyle | undefined;
  let markings = getMarkings(current);
  /** MarkingsWidget.saveMarkingsToPokemon: grava só se mudou (SetMarkingsPacket). */
  const saveMarkings = () => {
    if (markings.join() === getMarkings(current).join()) return;
    try { setMarkings(player, current, markings); } catch (e) { console.warn(`markings: ${e}`); }
  };
  let wantStudio = options.studio ?? prefersStudio(player, false);
  try {
    while (player.isValid) {
      const team = safe(() => getSafeTeam(player), [] as (PokemonData | null)[]);
      const inParty = team.some(member => member?.uuid === current.uuid);
      const toggle = hasStudio(player) || safe(() => studioAvailable(player), false);
      let studio = false;
      if (wantStudio && toggle) studio = openStudio(player, current, FRAMING.summary);
      else if (hasStudio(player)) closeStudio(player);
      const form = buildSummaryForm(current, { tab, studio, studioToggle: toggle, party: inParty ? team : undefined, selected, statsPage, markings });
      const result = await form.show(player);
      if (!result?.action) {
        if (!result) { saveMarkings(); return; }
        continue;
      }
      const action = result.action;
      switch (action.kind) {
        case "tab":
          statsPage = action.tab === "stats" && tab === "stats" ? nextStatsPage(current, statsPage) : undefined;
          tab = action.tab; selected = undefined;
          try { player.playSound("cobblemon.gui.click"); } catch { }
          break;
        case "cry": playSummaryCry(player, current); break;
        case "marking":
          markings = cycleMarking(markings, action.index);
          try { player.playSound("cobblemon.gui.click"); } catch { }
          break;
        case "studio":
          wantStudio = !studio;
          setPrefersStudio(player, wantStudio);
          break;
        case "party": {
          const member = team[action.slot];
          if (member) {
            saveMarkings();
            current = getLivePokemon(member); selected = undefined; statsPage = undefined;
            markings = getMarkings(current);
          }
          break;
        }
        case "move": case "mark": selected = action.index; break;
      }
    }
  }
  finally {
    closeStudio(player);
  }
}

/** ModelWidget.playCry: animação `cry` no modelo do estúdio (se houver) e o som do grito para o jogador. */
export function playSummaryCry(player: Player, pokemon: PokemonData) {
  try { player.playSound(`cobblemon.pokemon.${toSpeciesId(pokemon.species)}.cry`); } catch { }
  const model = studioEntityOf(player);
  if (model) try { playPoserAnimation(model, pokemon, "cry"); } catch { }
}
