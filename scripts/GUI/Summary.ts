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
import { getExperienceGroup } from "../Experience";
import { getSpeciesData, toSpeciesId } from "../speciesData";
import { renderMove } from "../language";
import { typeColorCodes } from "../language";
import { ElementalType } from "../Pokemon";
import { Dex, toID } from "../showdown";
import { getSafeTeam } from "../pokemonStorage";
import { SCREEN } from "../ui/screens";
import { FRAMING, closeStudio, hasStudio, openStudio, prefersStudio, setPrefersStudio, studioAvailable, studioEntityOf } from "../ui/studio";
import { playPoserAnimation } from "../battle/Animations";
import {
  BLANK, CATEGORY_MARKERS, CellForm, GUI, SELECTED_MARKER, SUB, SUMMARY, SUMMARY_INFO, SUMMARY_MARKS, SUMMARY_MOVES, SUMMARY_TABS, SummaryTab,
  barTexture, expStepFor, genderIcon, layoutTitle, typeCells, typeKeyTexture,
} from "./layout";
import {
  K, abilityName, getLivePokemon, getPokemonIconTexture, getPokemonProfileTexture, getExpProgress, getForm, getFriendship, getMarks, getMintedNature, getPokemonTypes,
  hpText, itemName, join, natureName, statusLabel, tr, typeName,
} from "./common";
import { MAX_EV, STAT_LANG, STAT_ORDER } from "./PokemonEdit";
import {
  RADAR_HEXAGON, RADAR_PENTAGON, STAT_BAR_LINES, STAT_FILL_MARKERS, STAT_MODES, StatMode, radarTextures, statFillTexture,
} from "./layoutSpec";
import { extraSummaryInfo, notifyMovesShown } from "./summaryExtras";
import { sizeCategoryKey } from "../pokemon/Scale";
import { RIDE_STYLES, RIDING_STATS, getMaxRideBoost, getRideBoost, getRideStat, rideInfoOf, rideStyleLangKey, statRange } from "../pokemon/RideStats";
import { Dex as ShowdownDex } from "../showdown";
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
  // Frente msd-fase3: linhas de extensões (tipo Tera, Gigantamax e nível de Dynamax do Mega Showdown).
  info.push(...extraSummaryInfo(pokemon));

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
  | { kind: "mark"; index: number }
  /** Frente ui-polish: barra de modos da aba Atributos e o ícone do estilo de montaria (troca o estilo). */
  | { kind: "statsMode"; mode: StatMode }
  | { kind: "rideStyle" };

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
  /** Frente ui-polish: modo da aba Atributos (StatWidget.statOptions); padrão = atributos. */
  statsMode?: StatMode;
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

/** Modos da barra de baixo da aba Atributos para o Pokémon (Montar só com montaria). */
export function statModesOf(pokemon: PokemonData): StatMode[] {
  return rideStylesOf(pokemon).length ? [...STAT_MODES] : STAT_MODES.filter(mode => mode !== "ride");
}

const STAT_MODE_LANG: Record<StatMode, string> = {
  stats: "cobblemon.ui.stats", ivs: "cobblemon.ui.stats.ivs", evs: "cobblemon.ui.stats.evs", ride: "cobblemon.ui.stats.ride", other: "cobblemon.ui.stats.other",
};
/** Ordem dos vértices do hexágono (StatWidget.statLabels, horário a partir do topo). */
const HEXAGON_STATS: (keyof ReturnType<PokemonData["getCurrentStats"]>)[] = ["hp", "atk", "def", "spe", "spd", "spa"];
const RIDE_ICONS = new Set(["air_bird", "air_hover", "air_jet", "air_rocket", "land_cart", "land_horse", "liquid_boat", "liquid_dolphin", "liquid_submarine"]);

/** Natureza efetiva (Mint): atributo que sobe e o que desce (showdown "atk"...). */
function natureStats(pokemon: PokemonData): { plus?: string; minus?: string } {
  const nature = safe(() => ShowdownDex.natures.get(pokemon.getEffectiveNature()), undefined);
  return nature?.plus && nature.plus !== nature.minus ? { plus: nature.plus, minus: nature.minus } : {};
}

/**
 * Aba Atributos como o StatWidget: gráfico hexagonal (atributos / IVs / EVs), pentágono de montaria ou barras de
 * amizade e saciedade, com a barra de modos embaixo. Cada setor do polígono é uma textura por passo (layoutSpec).
 */
function statsCells(form: CellForm<SummaryAction>, pokemon: PokemonData, mode: StatMode, style: RideStyle | undefined) {
  statModesOf(pokemon).forEach((m, i) => form.cell(SUMMARY.STAT_TABS + i, join(m === mode ? `${SELECTED_MARKER}§f` : "§7", { translate: STAT_MODE_LANG[m] }), undefined, { kind: "statsMode", mode: m }));
  if (mode === "other") {
    // FriendshipFeatureRenderer (0..255, rosa; mais forte a partir de 160) e FullnessFeatureRenderer (verde/amarelo/vermelho).
    const friendship = getFriendship(pokemon);
    const fullness = safe(() => getFullness(pokemon), 0);
    const maxFullness = Math.max(1, safe(() => getMaxFullness(pokemon), 1));
    const bars: { name: RawMessage; value: number; ratio: number; color: string; overlay: string }[] = [
      { name: { translate: "cobblemon.ui.stats.friendship" }, value: friendship, ratio: friendship / 255, color: friendship >= 160 ? "friendship_high" : "friendship", overlay: "friendship" },
      { name: { translate: "cobblemon.ui.stats.fullness" }, value: fullness, ratio: fullness / maxFullness, color: fullness / maxFullness <= 0.33 ? "green" : fullness / maxFullness <= 0.66 ? "yellow" : "red", overlay: "fullness" },
    ];
    if (safe(() => hasBlocksTraveledRequirement(pokemon), false)) {
      const steps = safe(() => getBlocksTraveled(pokemon), 0);
      bars.push({ name: { translate: "cobblemon.ui.stats.blocks_traveled" }, value: steps, ratio: 1, color: "white", overlay: "steps" });
    }
    const coins = safe(() => getIntFeature(pokemon, "gimmighoul_coins"), undefined);
    if (coins !== undefined) bars.push({ name: { translate: "cobblemon.ui.stash.gold" }, value: coins, ratio: Math.min(1, coins / 999), color: "white", overlay: "coin" });
    bars.slice(0, 4).forEach((bar, i) => {
      const ratio = Math.max(0, Math.min(1, bar.ratio));
      const lines: (string | RawMessage)[] = [];
      lines[STAT_BAR_LINES.VALUE] = `§f${bar.value}`;
      lines[STAT_BAR_LINES.PERCENT] = `§f${Math.floor(ratio * 100)}%`;
      lines[STAT_BAR_LINES.NAME] = join("§f§l", bar.name);
      form.cell(SUMMARY.STAT_ROWS + i, join(STAT_FILL_MARKERS[bar.color], lines[0], "\n", lines[1], "\n", lines[2]), statFillTexture(ratio));
      form.cell(SUMMARY.STAT_BARS + i, BLANK, `${GUI}/summary/summary_stats_${bar.overlay}_overlay`);
    });
    return;
  }
  if (mode === "ride" && style) {
    const info = safe(() => rideInfoOf(pokemon), undefined);
    const settings = info?.styles[style];
    const values = RIDING_STATS.map(stat => safe(() => getRideStat(pokemon, style, stat, info), 0));
    const colorKey = style === "AIR" ? "air" : style === "LIQUID" ? "liquid" : "land";
    radarTextures(RADAR_PENTAGON, values.map(v => v / 100)).forEach((texture, k) => form.cell(SUMMARY.STAT_BARS + k, colorKey, texture));
    RIDING_STATS.forEach((stat, k) => form.cell(SUMMARY.STAT_ROWS + k, join("§f§l", { translate: `cobblemon.ui.stats.ride.${stat.toLowerCase()}` }, `\n§r§f${Math.floor(values[k])}`)));
    const controller = settings?.key?.replace(/^cobblemon:[a-z]+\//, "").replace("minekart", "cart");
    const iconKey = `${style.toLowerCase()}_${controller ?? ""}`;
    form.cell(SUMMARY.STAT_ROWS + 5, BLANK, RIDE_ICONS.has(iconKey) ? `${GUI}/summary/icon_ride_${iconKey}` : undefined, { kind: "rideStyle" });
    form.body(join("§f", { translate: rideStyleLangKey(style, settings?.key) }, "§7 | ", { translate: rideStyleLangKey(style) }));
    return;
  }
  // STATS / IV / EV: razão de cada vértice (StatWidget: atributo/400, IV/31, EV/252) e os valores embaixo do rótulo.
  const stats = pokemon.getCurrentStats();
  const nature = mode === "stats" ? natureStats(pokemon) : {};
  const ratios = HEXAGON_STATS.map(stat => mode === "stats" ? (stat === "hp" ? pokemon.maxHealth : stats[stat] ?? 0) / 400
    : mode === "ivs" ? safe(() => pokemon.getEffectiveIv(stat), pokemon.ivs[stat] ?? 0) / 31 : (pokemon.evs[stat] ?? 0) / MAX_EV);
  radarTextures(RADAR_HEXAGON, ratios).forEach((texture, k) => form.cell(SUMMARY.STAT_BARS + k, mode, texture));
  HEXAGON_STATS.forEach((stat, k) => {
    let value: string;
    if (mode === "stats") value = stat === "hp" ? `${pokemon.currentHealth} / ${pokemon.maxHealth}` : String(stats[stat] ?? 0);
    else if (mode === "ivs") {
      const raw = pokemon.ivs[stat] ?? 0;
      value = safe(() => pokemon.isHyperTrained(stat), false) ? `${raw} (${safe(() => pokemon.getEffectiveIv(stat), raw)})` : String(raw);
    }
    else value = String(pokemon.evs[stat] ?? 0);
    const color = nature.plus === stat ? "§c" : nature.minus === stat ? "§9" : "§f";
    const arrow = nature.plus === stat ? `${GUI}/summary/summary_stats_icon_increase` : nature.minus === stat ? `${GUI}/summary/summary_stats_icon_decrease` : undefined;
    form.cell(SUMMARY.STAT_ROWS + k, join(`${color}§l`, { translate: STAT_LANG[stat] }, `\n§r§f${value}`), arrow);
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

/** PP do tile (MoveSlotWidget: dourado na metade, vermelho em 0) com o prefixo da categoria (ícone no layout). */
function movePpText(pokemon: PokemonData, index: number): string {
  const move = Dex.moves.get(pokemon.moves[index]);
  const info = pokemon.movesInfo[index];
  const pp = info ? info.pp : move.pp;
  const max = info ? info.maxPp : move.pp;
  const color = max > 0 && pp <= Math.floor(max / 2) ? (pp === 0 ? "§c" : "§6") : "§f";
  return `${CATEGORY_MARKERS[move.category] ?? CATEGORY_MARKERS.Status}${color}§l${pp}/${max}`;
}

/** Número da Pokédex com 4 dígitos (InfoWidget: zeros à esquerda). Nunca só dígitos no texto: vai com §l. */
function dexNumberText(pokemon: PokemonData): string {
  const n = getSpeciesData(pokemon.species)?.nationalPokedexNumber;
  return `§l${n ? String(n).padStart(4, "0") : "????"}`;
}

/** Nome do tamanho (InfoWidget: icon_size_<xs|s|m|l|xl|alpha>). */
function sizeIcon(pokemon: PokemonData): string | undefined {
  if ((pokemon.aspects ?? []).includes("alpha")) return `${GUI}/summary/icon_size_alpha`;
  const size = safe(() => pokemon.getSizeCategory(), undefined);
  return size ? `${GUI}/summary/icon_size_${String(size).toLowerCase()}` : undefined;
}

/** Linhas do port sem lugar no Java (caixa de baixo à esquerda da aba Info). */
function infoExtraLines(pokemon: PokemonData): RawMessage[] {
  const out: RawMessage[] = [];
  const form = getForm(pokemon);
  if (form) out.push(label("cobblemon.ui.pokedex.info.form", form.name));
  if (pokemon.cosmeticItem) out.push(label("cobblemon.cosmetic_item", itemName(pokemon.cosmeticItem)));
  if (safe(() => hasBlocksTraveledRequirement(pokemon), false)) out.push(label("cobblemon.ui.stats.blocks_traveled", safe(() => getBlocksTraveled(pokemon), 0).toString()));
  const coins = safe(() => getIntFeature(pokemon, "gimmighoul_coins"), undefined);
  if (coins !== undefined) out.push(label("cobblemon.ui.stash.gold", coins.toString()));
  const scrap = safe(() => getIntFeature(pokemon, "gimmighoul_netherite"), undefined);
  if (scrap !== undefined) out.push(label("cobblemon.ui.stash.netherite", scrap.toString()));
  // Frente msd-fase3: tipo Tera, Gigantamax e nível de Dynamax.
  out.push(...extraSummaryInfo(pokemon));
  return out;
}

/** Corpo da aba Golpes: a descrição do golpe escolhido (poder/precisão/efeito vão nas células). */
function moveDescription(pokemon: PokemonData, index: number): RawMessage {
  const id = pokemon.moves[index];
  if (!id) return { text: "" };
  return join("§f", { translate: `cobblemon.move.${toID(id)}.desc` });
}

/** Poder, precisão e chance de efeito (MovesWidget: "—" quando não se aplica). */
function moveNumbers(pokemon: PokemonData, index: number): [string, string, string] {
  const move = Dex.moves.get(pokemon.moves[index]);
  const power = move.basePower > 0 ? String(move.basePower) : "—";
  const accuracy = move.accuracy === true ? "—" : `${move.accuracy}%`;
  const chance = move.secondary?.chance ?? move.secondaries?.find(x => x.chance)?.chance;
  return [`§l${power}`, `§l${accuracy}`, `§l${chance ? `${chance}%` : "—"}`];
}

/** Modo da aba Atributos: o pedido (se o Pokémon o tem) ou atributos. Compatível com `statsPage` (página de montaria). */
function currentStatsMode(pokemon: PokemonData, view: SummaryView): StatMode {
  const modes = statModesOf(pokemon);
  if (view.statsMode && modes.includes(view.statsMode)) return view.statsMode;
  return view.statsPage && modes.includes("ride") ? "ride" : "stats";
}

/**
 * Monta o form da aba (função pura sobre os dados: testável). Os índices seguem `SUMMARY` de `layoutSpec.ts`.
 * Frente ui-layout: cada campo do Summary.kt na sua célula (nada de texto corrido no corpo).
 */
export function buildSummaryForm(pokemon: PokemonData, view: SummaryView): CellForm<SummaryAction> {
  const subs: (typeof SUB)[keyof typeof SUB][] = [tabMarker(view.tab)];
  const statsMode = view.tab === "stats" ? currentStatsMode(pokemon, view) : undefined;
  if (statsMode === "ride") subs.push(SUB.SUMMARY_STATS_RIDE);
  if (statsMode === "other") subs.push(SUB.SUMMARY_STATS_OTHER);
  if (view.tab === "stats" && rideStylesOf(pokemon).length) subs.push(SUB.SUMMARY_STATS_RIDE_TAB);
  if (view.studio) subs.push(SUB.STUDIO);
  const form = new CellForm<SummaryAction>(layoutTitle(SCREEN.SUMMARY, subs, tr("cobblemon.ui.summary.title")), SUMMARY.COUNT);
  SUMMARY_TABS.forEach((tab, i) => form.cell(SUMMARY.TABS + i, tr(TAB_LANG[tab]), `${GUI}/summary/summary_tab_icon_${tab}`, { kind: "tab", tab }));
  // Tocar no retrato toca o grito (ModelWidget.playCryOnClick).
  form.cell(SUMMARY.PORTRAIT, BLANK, view.studio ? undefined : getPokemonProfileTexture(pokemon), { kind: "cry" });
  // Markings (MarkingsWidget): o texto "m<estado>" escolhe o quadro da textura no JSON UI.
  const markings = view.markings ?? getMarkings(pokemon);
  markings.forEach((state, i) => form.cell(SUMMARY.MARKINGS + i, `m${state}`, `${GUI}/summary/icon_marking_${i}`, { kind: "marking", index: i }));
  // Cabeçalho: nome (+ gênero em ícone), "Nv. N" com a bola, status, brilhante.
  form.cell(SUMMARY.NAME, join("§f§l", pokemon.getTranslatedName()), genderIcon(pokemon.gender));
  const ball = (pokemon.pokeball ?? "cobblemon:poke_ball").replace(/^[a-z0-9_]+:/, "");
  form.cell(SUMMARY.LEVEL, join("§l", tr("cobblemon.label.lv", pokemon.level)), `${GUI}/ball/${ball}`);
  const status = pokemon.currentHealth <= 0 ? "fnt" : pokemon.status;
  if (status) form.cell(SUMMARY.STATUS, join("§l", { translate: `cobblemon.ui.status.${status}` }), `${GUI}/battle/battle_status_${status}`);
  if (pokemon.shiny) form.cell(SUMMARY.SHINY, BLANK, `${GUI}/summary/icon_shiny`);
  form.cell(SUMMARY.ITEM, itemName(pokemon.minecraftItem));
  typeCells(form, getPokemonTypes(pokemon), SUMMARY.TYPES, SUMMARY.TYPE2);
  if (view.studioToggle) form.cell(SUMMARY.STUDIO, view.studio ? "2D" : "3D", undefined, { kind: "studio" });
  // Time (PartyWidget): fora do time (PC), o Java abre o resumo com a lista só deste Pokémon.
  const party = view.party ?? [pokemon];
  party.slice(0, 6).forEach((member, i) => {
    if (!member) return;
    const current = member.uuid === pokemon.uuid;
    form.cell(SUMMARY.PARTY + i, join(current ? SELECTED_MARKER : "", "§f", tr("cobblemon.ui.lv.number", member.level)), getPokemonIconTexture(member), { kind: "party", slot: i });
    form.cell(SUMMARY.PARTY_NAMES + i, join("§f", member.getTranslatedName()), genderIcon(member.gender));
    form.cell(SUMMARY.PARTY_BARS + i, BLANK, barTexture(member.currentHealth, member.maxHealth));
  });

  switch (view.tab) {
    case "info": {
      // InfoWidget: Nº Dex, Espécie, Tipo, TO, Natureza, Habilidade (rótulos fixos no layout; aqui só os valores).
      const species = getSpeciesData(pokemon.species);
      const minted = getMintedNature(pokemon);
      const hidden = safe(() => pokemon.hasHiddenAbility(), false);
      const types = getPokemonTypes(pokemon);
      const typeParts: (string | RawMessage)[] = [];
      types.forEach((type, i) => typeParts.push(i > 0 ? "/" : "", typeName(type)));
      const values: (string | RawMessage)[] = [
        dexNumberText(pokemon),
        join("§l", { translate: `cobblemon.species.${species ? toSpeciesId(pokemon.species) : "unknown"}.name` }),
        join("§l", ...typeParts),
        `§l${pokemon.ogTrainer ?? ""}`,
        minted ? join("§l", natureName(minted), "§r§7*") : join("§l", natureName(pokemon.nature || "hardy")),
        pokemon.ability ? join("§l", abilityName(pokemon.ability), hidden ? " §d(H)" : "") : "§l-",
      ];
      values.forEach((value, i) => form.cell(SUMMARY_INFO.ROWS + i, value));
      const size = sizeIcon(pokemon);
      if (size) form.cell(SUMMARY_INFO.SIZE, BLANK, size);
      const exp = getExpProgress(pokemon);
      form.cell(SUMMARY_INFO.EXP, `§l${exp.experience}`);
      form.cell(SUMMARY_INFO.TO_NEXT, `§l${exp.toNextLevel}`);
      const into = safe(() => pokemon.level <= 1 ? pokemon.experience : pokemon.experience - getExperienceGroup(pokemon.getExperienceGroup()).getExperience(pokemon.level), 0);
      const span = into + exp.toNextLevel;
      form.cell(SUMMARY_INFO.EXP_BAR, expStepFor(span > 0 ? into / span : 0));
      const extra = infoExtraLines(pokemon);
      if (extra.length) form.cell(SUMMARY_INFO.EXTRA, lines(extra));
      // Descrição da habilidade (x 8, y 94,5).
      form.body(pokemon.ability ? join("§f", { translate: `cobblemon.ability.${toID(pokemon.ability.replace(/^cobblemon:/, ""))}.desc` }) : "");
      break;
    }
    case "stats": {
      const mode = statsMode ?? "stats";
      statsCells(form, pokemon, mode, mode === "ride" ? view.statsPage ?? rideStylesOf(pokemon)[0] : undefined);
      break;
    }
    case "moves": {
      const chosen = pokemon.moves.length ? Math.min(view.selected ?? 0, pokemon.moves.length - 1) : -1;
      pokemon.moves.slice(0, 4).forEach((move, i) => {
        form.cell(SUMMARY_MOVES.TILES + i, join(i === chosen ? SELECTED_MARKER : "", "§f", { translate: `cobblemon.move.${toID(move)}` }),
          typeKeyTexture(toID(Dex.moves.get(move).type)), { kind: "move", index: i });
        form.cell(SUMMARY_MOVES.PP + i, movePpText(pokemon, i));
      });
      if (chosen >= 0) {
        const [power, accuracy, effect] = moveNumbers(pokemon, chosen);
        form.cell(SUMMARY_MOVES.POWER, power).cell(SUMMARY_MOVES.ACCURACY, accuracy).cell(SUMMARY_MOVES.EFFECT, effect);
      }
      form.body(chosen >= 0 ? moveDescription(pokemon, chosen) : tr(K.movesEmptySlot));
      break;
    }
    case "marks": {
      const marks = getMarks(pokemon).slice(0, SUMMARY.MARK_SLOTS);
      const selected = view.selected ?? marks.findIndex(m => m === pokemon.activeMark);
      marks.forEach((mark, i) => {
        const id = mark.replace(/^[a-z0-9_]+:/, "");
        form.cell(SUMMARY_MARKS.SLOTS + i, join(i === selected ? SELECTED_MARKER : "", { translate: `cobblemon.mark.${id}` }), `${GUI}/mark/${id}`, { kind: "mark", index: i });
      });
      const chosen = marks[selected];
      // MarksWidget: título = nome do Pokémon (ou o título da marca); descrição da marca escolhida.
      form.cell(SUMMARY_MARKS.TITLE, join("§f", pokemon.getTranslatedName()));
      if (!chosen) form.body(marks.length ? "" : tr(K.noMarks));
      else {
        const id = chosen.replace(/^[a-z0-9_]+:/, "");
        form.cell(SUMMARY_MARKS.SELECTED, BLANK, `${GUI}/mark/${id}`);
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
  let statsMode: StatMode | undefined;
  let markings = getMarkings(current);
  /** MarkingsWidget.saveMarkingsToPokemon: grava só se mudou (SetMarkingsPacket). */
  const saveMarkings = () => {
    if (markings.join() === getMarkings(current).join()) return;
    try { setMarkings(player, current, markings); } catch (e) { console.warn(`markings: ${e}`); }
  };
  let wantStudio = options.studio ?? prefersStudio(player, false);
  try {
    while (player.isValid) {
      // Frente msd-fase6: aba Golpes mostrada (MoveSlotWidget do Cobblemon); um ouvinte que mude o Pokémon já gravou.
      const movesChanged = tab === "moves" && notifyMovesShown(player, current);
      const team = safe(() => getSafeTeam(player), [] as (PokemonData | null)[]);
      if (movesChanged) {
        const fresh = team.find(member => member?.uuid === current.uuid);
        if (fresh) current = getLivePokemon(fresh);
      }
      const inParty = team.some(member => member?.uuid === current.uuid);
      const toggle = hasStudio(player) || safe(() => studioAvailable(player), false);
      let studio = false;
      if (wantStudio && toggle) studio = openStudio(player, current, FRAMING.summary);
      else if (hasStudio(player)) closeStudio(player);
      // Fora do time (PC): a lista do painel é só este Pokémon (Summary.open(listOf(pokemon)) do Java).
      const shownParty = inParty ? team : [current];
      const form = buildSummaryForm(current, { tab, studio, studioToggle: toggle, party: shownParty, selected, statsPage, statsMode, markings });
      const result = await form.show(player);
      if (!result?.action) {
        if (!result) { saveMarkings(); return; }
        continue;
      }
      const action = result.action;
      switch (action.kind) {
        case "tab":
          if (action.tab !== tab) { statsPage = undefined; statsMode = undefined; }
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
          const member = (inParty ? team : [current])[action.slot];
          if (member) {
            saveMarkings();
            current = getLivePokemon(member); selected = undefined; statsPage = undefined;
            if (statsMode === "ride" && !rideStylesOf(current).length) statsMode = undefined;
            markings = getMarkings(current);
          }
          break;
        }
        case "move": case "mark": selected = action.index; break;
        case "statsMode":
          statsMode = action.mode;
          if (action.mode === "ride") statsPage ??= rideStylesOf(current)[0];
          try { player.playSound("cobblemon.gui.click"); } catch { }
          break;
        // Ícone do centro do pentágono: próximo estilo (StatWidget.mouseClicked: rideBehaviourIndex + 1).
        case "rideStyle": {
          const styles = rideStylesOf(current);
          if (styles.length > 1) {
            const i = statsPage ? styles.indexOf(statsPage) : 0;
            statsPage = styles[(i + 1) % styles.length];
            try { player.playSound("cobblemon.gui.click"); } catch { }
          }
          break;
        }
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
