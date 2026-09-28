/**
 * PC (port de `client/gui/pc/*`): caixas de 30 espaços (número de caixas pela config/jogador),
 * navegação entre caixas, mover/trocar entre time e caixas ("escolher origem → destino", já que não
 * dá para arrastar), renomear caixa, buscar por propriedades, resumo e soltar.
 *
 * O título das telas em grade leva o marcador invisível SCREEN.PC (scripts/ui/screens.ts) para o JSON UI
 * (`ui/pc.json` via `ui/cobblemon_forms.json`) desenhar a grade; o texto visível continua "PC - ...".
 * Layout dos botões da tela da caixa: [<<] [nome da caixa] [>>] [ ] [ ] [ ] + 30 espaços (6 colunas).
 * O corpo da tela da caixa (que o `ui/pc.json` não mostra como texto) leva o caminho da textura do papel de parede
 * da caixa, desenhada atrás da grade (frente extras-final, `PCWallpapers.ts`).
 *
 * Frente telas: layout do PCGUI do Cobblemon (349×205, `ui/pc.json` gerado por tools/ui/gen-telas.ts): caixa 6×5 com
 * retratos de 32 px, setas e nome da caixa em cima, o time na coluna da direita (botões 36..41, tocar escolhe o
 * espaço do time como na caixa) e a prévia do Pokémon selecionado do time à esquerda (42/43).
 */
import { Player, RawMessage } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { PokemonData } from "../Pokemon";
import { PokemonProperties } from "../PokemonProperties";
import { message, renderPokemonName } from "../language";
import {
  PCLocation, PCPlace, StorageResult, getBoxCount, getBoxName, getPokemonFromPCLocation, getSafeBoxTeam, getSafeTeam,
  movePokemon, renameBox, sortBox, spacesPerBox, withdrawFromPC, MAX_BOX_NAME_LENGTH,
} from "../pokemonStorage";
import { SCREEN, withScreen } from "../ui/screens";
import { K, abilityName, getLivePokemon, getPokemonIconTexture, getPokemonProfileTexture, getPokemonSpriteTexture, getPokemonTypes, isInBattle, itemName, join, natureName, recallIfOut, tr } from "./common";
import { BLANK, GUI, PC, PC_DIM_MARKER, TYPE_DOUBLE, TYPE_SINGLE, genderIcon, safeShow, typeKeyTexture } from "./layout";
import { toID } from "../showdown";
import { SORT_MODES, SortMode, parseSearch, searchPasses, sortPokemon } from "../pokemon/SortMode";
import { getSelectedSlot } from "../ui/PartySelection";
import { confirmRelease, partyButtonText, storageError } from "./Party";
import { showSummary } from "./Summary";
import { pasturedIds } from "../machines/pasture";
import {
  DEFAULT_WALLPAPER, altTexture, baseTexture, bedrockTexturePath, boxWallpaperTexturePath, getAvailableWallpapers,
  getBoxWallpaper, getUnseenWallpapers, markWallpapersSeen, setBoxWallpaper, wallpaperName,
} from "./PCWallpapers";

/**
 * Botões fixos antes dos espaços da caixa: [<<] [caixa] [>>] + 3 vazios, para a grade de 6 colunas
 * do `ui/pc.json` alinhar os 30 espaços em 5 linhas de 6.
 */
const NAV_BUTTONS = 6;

/** Nome exibido da caixa (personalizado ou "Caixa N"). */
export function boxTitle(player: Player, boxID: number): RawMessage {
  const name = getBoxName(player, boxID);
  return name ? { text: name } : { translate: "cobblemon.ui.pc.box.title", with: [(boxID + 1).toString()] };
}

/** Caixa anterior/seguinte com volta ao início/fim. */
export function wrapBox(boxID: number, delta: number, boxCount: number): number {
  return ((boxID + delta) % boxCount + boxCount) % boxCount;
}

function pcTitle(player: Player, boxID: number, suffix?: RawMessage): RawMessage {
  return withScreen(SCREEN.PC, join("PC - ", boxTitle(player, boxID), suffix ? join(" - ", suffix) : undefined));
}

/** CobblemonClient.lastPcBoxViewed: caixa em que o PC reabre (por jogador, só durante a sessão). */
const lastBoxViewed = new Map<string, number>();
/** Filtro da caixa (FilterWidget do PCGUI): vale enquanto o PC está aberto. */
const boxFilters = new Map<string, string>();

export function getLastBoxViewed(player: Player): number {
  return lastBoxViewed.get(player.id) ?? 0;
}

/** Som de interface do PC (PCGUI.playSound). */
function pcSound(player: Player, sound: "click" | "grab" | "drop" | "release") {
  try { player.playSound(`cobblemon.pc.${sound}`); } catch { }
}

/** Resultado de uma tela de seleção do PC. */
type Selection = { kind: "slot"; location: PCLocation } | { kind: "box"; boxID: number } | undefined;

/**
 * Abre o PC. Resolve quando o jogador fecha (o bloco de PC espera isso para apagar a tela).
 * @param boxID caixa inicial (0-based); sem ela, a última caixa vista (OpenPCPacket.box ?: lastPcBoxViewed).
 */
export async function openPCGui(player: Player, boxID?: number): Promise<void> {
  if (isInBattle(player)) {
    player.sendMessage(message.error({ translate: "cobblemon.pc.inbattle" }));
    return;
  }
  try { await pcLoop(player, boxID); }
  finally { boxFilters.delete(player.id); previewTargets.delete(player.id); }
}

async function pcLoop(player: Player, boxID?: number): Promise<void> {
  const boxes = getBoxCount(player);
  const start = boxID ?? getLastBoxViewed(player);
  let box = start < boxes ? Math.max(0, start) : 0;
  while (true) {
    const selection = await showBoxScreen(player, box);
    if (!selection) return;
    if (selection.kind === "box") { box = selection.boxID; continue; }
    const pokemon = getPokemonFromPCLocation(player, selection.location);
    if (!pokemon) {
      if (selection.location.location === PCPlace.Box) box = selection.location.boxID ?? box;
      continue;
    }
    // O tocado passa a ser o da prévia (o PCGUI mostra o do cursor; aqui, o último tocado).
    previewTargets.set(player.id, pokemon.uuid);
    const next = await showSlotActions(player, selection.location, pokemon);
    if (next === "close") return;
    if (typeof next === "number") box = next;
    else if (selection.location.location === PCPlace.Box) box = selection.location.boxID ?? box;
  }
}

/**
 * Tela de uma caixa. Navegar entre caixas fica dentro desta função; o botão do nome abre o menu
 * da caixa (time, ir para caixa, renomear, buscar).
 */
async function showBoxScreen(player: Player, boxID: number, selecting?: RawMessage): Promise<Selection> {
  let box = boxID;
  while (true) {
    const boxes = getBoxCount(player);
    lastBoxViewed.set(player.id, box);
    const filterText = boxFilters.get(player.id) ?? "";
    const filters = parseSearch(filterText);
    let wallpaper = "";
    try { wallpaper = boxWallpaperTexturePath(player, box); } catch { }
    const form = new ActionFormData()
      .title(pcTitle(player, box, selecting))
      .body(wallpaper)
      .button("<<")
      .button(filterText ? join(boxTitle(player, box), " §e⌕") : boxTitle(player, box))
      .button(">>")
      .button("")
      .button("")
      .button("");
    const content = getSafeBoxTeam(player, box);
    // No pasto (o PC do Cobblemon mostra o ícone de pasto): marca verde depois do nome.
    let pastured = new Set<string>();
    try { pastured = pasturedIds(); } catch { }
    content.forEach(pokemon => {
      if (!pokemon) form.button({ translate: K.empty });
      else {
        const name = renderPokemonName(pokemon);
        let label: string | RawMessage = pastured.has(pokemon.uuid) ? { rawtext: [typeof name === "string" ? { text: name } : name, { text: " §a⌂" }] } : name;
        // Filtro da caixa: quem não passa fica escurecido (PC_DIM_MARKER lido pelo ui/pc.json).
        if (filters.length && !searchPasses(filters, pokemon)) label = join(PC_DIM_MARKER, typeof label === "string" ? { text: label } : label);
        form.button(label, getPokemonIconTexture(pokemon));
      }
    });
    for (let i = content.length; i < spacesPerBox; i++) form.button({ translate: K.empty });
    // Coluna do time (PartyStorageSlot) e a prévia do selecionado.
    const team = getSafeTeam(player);
    for (let i = 0; i < 6; i++) {
      const member = team[i];
      if (member) form.button(renderPokemonName(member), getPokemonIconTexture(member));
      else form.button({ translate: K.empty });
    }
    const preview = previewPokemon(player, team, content);
    if (preview) appendPreviewButtons(form, preview, previewPages.get(player.id) ?? 0);
    const response = await safeShow(player, form);
    if (response?.selection === undefined) return undefined;
    if (response.selection === PC.PREVIEW_PAGE) { previewPages.set(player.id, ((previewPages.get(player.id) ?? 0) + 1) % 3); continue; }
    if (response.selection >= PC.PARTY && response.selection < PC.PARTY + 6)
      return { kind: "slot", location: { location: PCPlace.Team, space: response.selection - PC.PARTY } };
    if (response.selection === 0) { pcSound(player, "click"); box = wrapBox(box, -1, boxes); continue; }
    if (response.selection === 2) { pcSound(player, "click"); box = wrapBox(box, 1, boxes); continue; }
    if (response.selection === 1) {
      const result = await showBoxMenu(player, box, selecting);
      if (result === undefined) continue;
      return result;
    }
    const space = response.selection - NAV_BUTTONS;
    if (space < 0 || space >= spacesPerBox) continue;
    return { kind: "slot", location: { location: PCPlace.Box, boxID: box, space } };
  }
}

/**
 * Frente ui-polish: Pokémon do painel da esquerda. O PCGUI mostra o do cursor (hover) ou o escolhido; o form do servidor
 * não recebe hover, então vale o último tocado (caixa ou time) enquanto ele estiver no time ou na caixa aberta; sem
 * nenhum, o selecionado do time (ou o primeiro).
 */
const previewTargets = new Map<string, string>();

function previewPokemon(player: Player, team: (PokemonData | null)[], box: (PokemonData | null | undefined)[] = []): PokemonData | undefined {
  const target = previewTargets.get(player.id);
  if (target) {
    const found = [...team, ...box].find(p => p?.uuid === target);
    if (found) return found;
  }
  let slot = 0;
  try { slot = getSelectedSlot(player); } catch { }
  return team[slot] ?? team.find((x): x is PokemonData => !!x) ?? undefined;
}

/**
 * Células do painel da esquerda do PCGUI (PC.PREVIEW..PREVIEW_PAGE, nesta ordem): perfil, página de IVs/EVs, "Nv." com a
 * bola, nome com gênero, tipos, item, brilhante, natureza/habilidade/golpes e a área de trocar a página. Exportada para o
 * selftest montar a mesma prévia (antes ele mandava só o perfil e o nome: o painel ficava com um rótulo solto).
 */
export function appendPreviewButtons(form: ActionFormData, preview: PokemonData, page: number): ActionFormData {
  form.button(" ", getPokemonProfileTexture(preview));
  form.button(page === 0 ? "" : previewStatsText(preview, page));
  // Frente ui-layout: campos do painel da esquerda (PC.PREVIEW_LEVEL..PREVIEW_PAGE), na ordem dos índices.
  const types = getPokemonTypes(preview);
  const ball = (preview.pokeball ?? "cobblemon:poke_ball").replace(/^[a-z0-9_]+:/, "");
  form.button(join("§l", tr("cobblemon.label.lv", preview.level)), `${GUI}/ball/${ball}`);
  const gender = genderIcon(preview.gender);
  if (gender) form.button(join("§f§l", preview.getTranslatedName()), gender);
  else form.button(join("§f§l", preview.getTranslatedName()));
  if (types.length) form.button(types.length > 1 ? TYPE_DOUBLE : TYPE_SINGLE, typeKeyTexture(types[0]));
  else form.button("");
  if (types.length > 1) form.button(BLANK, typeKeyTexture(types[1]));
  else form.button("");
  form.button(itemName(preview.minecraftItem));
  if (preview.shiny) form.button(BLANK, `${GUI}/summary/icon_shiny`);
  else form.button("");
  const info = page === 0 ? previewInfo(preview) : undefined;
  form.button(info?.nature ?? "").button(info?.ability ?? "").button(info?.moves ?? "");
  form.button(BLANK);
  return form;
}

/** Página da caixa de informação da prévia por jogador (0 = info, 1 = IVs, 2 = EVs; PCGUI.currentStatIndex). */
const previewPages = new Map<string, number>();

/** Página 0 da caixa (PCGUI STAT_INFO): natureza (com Mint), habilidade e os golpes. */
function previewInfo(pokemon: PokemonData): { nature: RawMessage; ability: RawMessage; moves: RawMessage } {
  const moves: (string | RawMessage)[] = [];
  pokemon.moves.slice(0, 4).forEach((move, i) => moves.push(i > 0 ? "\n" : "", { translate: `cobblemon.move.${toID(move)}` }));
  return {
    nature: join("§f§l", natureName(pokemon.mintedNature || pokemon.nature || "hardy")),
    ability: join("§f§l", pokemon.ability ? abilityName(pokemon.ability) : "-"),
    moves: join("§f", ...(moves.length ? moves : ["-"])),
  };
}

/** Páginas 1 e 2 (PCGUI STAT_IV/STAT_EV): um atributo por linha. */
function previewStatsText(pokemon: PokemonData, page: number): RawMessage {
  const stats = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
  const lang: Record<string, string> = { hp: "hp", atk: "atk", def: "def", spa: "sp_atk", spd: "sp_def", spe: "speed" };
  const value = (stat: typeof stats[number]) => {
    if (page === 2) return pokemon.evs[stat] ?? 0;
    try { return pokemon.getEffectiveIv(stat); } catch { return pokemon.ivs[stat] ?? 0; }
  };
  const parts: (string | RawMessage)[] = [page === 1 ? "§b§l" : "§a§l", { translate: page === 1 ? "cobblemon.ui.stats.ivs" : "cobblemon.ui.stats.evs" }, "§r"];
  stats.forEach(stat => parts.push("\n§7", { translate: `cobblemon.ui.stats.${lang[stat]}` }, `: §f§l${value(stat)}`));
  return join(...parts);
}

/** Menu da caixa: time, ir para caixa, renomear, buscar. undefined = voltar para a caixa. */
async function showBoxMenu(player: Player, boxID: number, selecting?: RawMessage): Promise<Selection> {
  type Option = "party" | "goto" | "rename" | "search" | "wallpaper" | "sort" | "filter";
  const options: Option[] = ["party", "goto"];
  // Sem o marcador SCREEN.PC no título: menus de texto usam o layout de lista, não a grade de sprites.
  const form = new ActionFormData()
    .title(selecting ? join(boxTitle(player, boxID), " - ", selecting) : boxTitle(player, boxID))
    .button({ translate: "cobblemon.ui.party" })
    .button(tr(K.pcGoto));
  if (!selecting) {
    form.button(tr(K.pcRename)); options.push("rename");
    form.button({ translate: "cobblemon.ui.pokedex.search" }); options.push("search");
    // Frente dados-ui: filtro da caixa (FilterWidget) e ordenar (botões PokemonSortMode do PCGUI).
    const current = boxFilters.get(player.id);
    form.button(current ? join({ translate: "cobblemon.ui.pc.filter" }, `: §e${current}`) : { translate: "cobblemon.ui.pc.filter" }); options.push("filter");
    form.button(tr("cobblemon.port.pc.sort")); options.push("sort");
    let unseen = 0;
    try { unseen = getUnseenWallpapers(player).length; } catch { }
    form.button(join({ translate: "cobblemon.ui.pc.wallpaper" }, unseen > 0 ? ` §a(${unseen})` : undefined)); options.push("wallpaper");
  }
  form.button({ translate: K.back });
  const response = await form.show(player);
  const option = response.selection === undefined ? undefined : options[response.selection];
  switch (option) {
    case "party": {
      const location = await showPartySelect(player, !!selecting, selecting);
      return location ? { kind: "slot", location } : undefined;
    }
    case "goto": {
      const boxes = getBoxCount(player);
      const goto = await new ModalFormData()
        .title(tr(K.pcGoto))
        .slider(tr(K.pcBoxCount, boxes), 1, boxes, { defaultValue: boxID + 1 })
        .show(player);
      const value = goto.formValues?.[0];
      return typeof value === "number" ? { kind: "box", boxID: value - 1 } : undefined;
    }
    case "rename":
      await showRenameBox(player, boxID);
      return undefined;
    case "search": {
      const location = await showSearch(player);
      return location ? { kind: "slot", location } : undefined;
    }
    case "wallpaper":
      await showWallpaperPicker(player, boxID);
      return undefined;
    case "filter":
      await showBoxFilter(player);
      return undefined;
    case "sort":
      await showSortMenu(player, boxID);
      return undefined;
  }
  return undefined;
}

/** FilterWidget: texto do Search (nome parcial, propriedades, `!`, holding/fainted/legendary...). Vazio limpa. */
async function showBoxFilter(player: Player) {
  const response = await new ModalFormData()
    .title({ translate: "cobblemon.ui.pc.filter" })
    .textField({ translate: "cobblemon.ui.pc.filter.tooltip" }, { translate: "cobblemon.ui.pc.filter" }, { defaultValue: boxFilters.get(player.id) ?? "" })
    .show(player);
  const value = response.formValues?.[0];
  if (typeof value !== "string") return;
  const text = value.trim();
  if (text) boxFilters.set(player.id, text);
  else boxFilters.delete(player.id);
}

/** Botões de ordenação: modo crescente ou, como o Shift do PCGUI, decrescente (SortPCBoxPacket). */
async function showSortMenu(player: Player, boxID: number) {
  const form = new ActionFormData().title(join(tr("cobblemon.port.pc.sort"), " - ", boxTitle(player, boxID)));
  const choices: [SortMode, boolean][] = [];
  for (const mode of SORT_MODES) {
    form.button({ translate: `cobblemon.ui.sort.${mode}` }, `textures/gui/cobblemon/pc/pc_button_sort_${mode}`);
    choices.push([mode, false]);
    form.button(tr("cobblemon.port.pc.sort_reverse", { translate: `cobblemon.ui.sort.${mode}` }), `textures/gui/cobblemon/pc/pc_button_sort_${mode}_reverse`);
    choices.push([mode, true]);
  }
  const response = await form.show(player);
  const choice = response.selection === undefined ? undefined : choices[response.selection];
  if (!choice) return;
  sortPCBox(player, boxID, choice[0], choice[1]);
  pcSound(player, "click");
}

/** SortPCBoxHandler: ordena a caixa do jogador. */
export function sortPCBox(player: Player, boxID: number, mode: SortMode, descending: boolean): boolean {
  return sortBox(player, boxID, slots => sortPokemon(slots, mode, descending));
}

/**
 * Escolha do papel de parede da caixa (WallpapersScrollingWidget): padrão + disponíveis com miniatura; os novos
 * têm "NOVO" (marcados como vistos ao abrir a lista). Com versão alternativa, pergunta qual usar (Shift no Cobblemon).
 */
export async function showWallpaperPicker(player: Player, boxID: number): Promise<void> {
  const available = getAvailableWallpapers(player);
  const unseen = getUnseenWallpapers(player);
  const current = getBoxWallpaper(player, boxID);
  const mark = (texture: string) => baseTexture(current) === texture ? " §2✔" : "";
  // Sem o marcador SCREEN.PC no título: lista com miniaturas, não a grade.
  const form = new ActionFormData()
    .title(join({ translate: "cobblemon.ui.pc.wallpaper" }, " - ", boxTitle(player, boxID)));
  form.button(join({ translate: "cobblemon.port.wallpaper.default" }, current === DEFAULT_WALLPAPER ? " §2✔" : ""));
  for (const texture of available) {
    const isNew = unseen.includes(texture) ? join(" §a", { translate: "cobblemon.port.wallpaper.new" }) : undefined;
    form.button(join(wallpaperName(texture), mark(texture), isNew), bedrockTexturePath(texture));
  }
  form.button({ translate: K.back });
  const response = await form.show(player);
  if (unseen.length > 0) markWallpapersSeen(player, unseen);
  if (response.selection === undefined || response.selection > available.length) return;
  if (response.selection === 0) { setBoxWallpaper(player, boxID, DEFAULT_WALLPAPER); return; }
  const texture = available[response.selection - 1];
  const alt = altTexture(texture);
  let useAlt = false;
  if (alt) {
    const choice = await new ActionFormData()
      .title(wallpaperName(texture))
      .button({ translate: "cobblemon.port.wallpaper.normal" }, bedrockTexturePath(texture))
      .button({ translate: "cobblemon.port.wallpaper.alt" }, bedrockTexturePath(alt))
      .show(player);
    if (choice.selection === undefined) return;
    useAlt = choice.selection === 1;
  }
  if (setBoxWallpaper(player, boxID, texture, useAlt)) {
    try { player.playSound("cobblemon.pc.click"); } catch { }
  }
}

/** Renomear caixa (vazio volta ao nome padrão). */
export async function showRenameBox(player: Player, boxID: number) {
  const response = await new ModalFormData()
    .title(tr(K.pcRename))
    .textField(boxTitle(player, boxID), tr(K.pcRenameHint, MAX_BOX_NAME_LENGTH), { defaultValue: getBoxName(player, boxID) ?? "" })
    .show(player);
  const value = response.formValues?.[0];
  if (typeof value === "string") renameBox(player, boxID, value);
}

/** Busca no PC por PokemonProperties ("pikachu shiny", "level=50", "gender=female"). */
async function showSearch(player: Player): Promise<PCLocation | undefined> {
  const query = await new ModalFormData()
    .title({ translate: "cobblemon.ui.pokedex.search" })
    .textField({ translate: "cobblemon.ui.pc.filter" }, { translate: "cobblemon.ui.pc.filter.tooltip" })
    .show(player);
  const text = query.formValues?.[0];
  if (typeof text !== "string" || text.trim().length === 0) return undefined;
  const matches = searchPC(player, text, 60, true);
  const form = new ActionFormData().title({ translate: "cobblemon.ui.pokedex.search" });
  if (matches.length === 0) form.body(tr("cobblemon.command.pcsearch.nomatch", text, player.name));
  matches.forEach(({ location, pokemon }) => {
    const name = renderPokemonName(pokemon);
    form.button(join(typeof name === "string" ? { text: name } : name, "\n§8",
      tr("cobblemon.command.pcsearch.location", (location.boxID ?? 0) + 1, location.space + 1)), getPokemonSpriteTexture(pokemon));
  });
  const response = await form.show(player);
  if (response.selection === undefined) return undefined;
  return matches[response.selection]?.location;
}

/**
 * Pokémon do PC que batem com a busca (limitado a 60 resultados). `/pcsearch` (PcSearchCommand) usa
 * PokemonProperties.matches; a busca da tela (`useFilter`) usa a regra do filtro do PC (Search.of): nome parcial
 * ("cha"), propriedades ("shiny level=50"), `!` e holding/fainted/legendary/mythical/ultrabeast.
 */
export function searchPC(player: Player, query: string, limit = 60, useFilter = false): { location: PCLocation; pokemon: PokemonData }[] {
  const filters = useFilter ? parseSearch(query) : [];
  const props = useFilter ? { match: (pokemon: PokemonData) => searchPasses(filters, pokemon) } : PokemonProperties.parse(query);
  const out: { location: PCLocation; pokemon: PokemonData }[] = [];
  const boxes = getBoxCount(player);
  for (let box = 0; box < boxes && out.length < limit; box++) {
    getSafeBoxTeam(player, box).forEach((pokemon, space) => {
      if (pokemon && out.length < limit && props.match(pokemon))
        out.push({ location: { location: PCPlace.Box, boxID: box, space }, pokemon });
    });
  }
  return out;
}

/** Time dentro do PC (para escolher origem/destino). */
async function showPartySelect(player: Player, showEmpty: boolean, selecting?: RawMessage): Promise<PCLocation | undefined> {
  const team = getSafeTeam(player);
  // Lista com retratos (a grade do PC é só a tela da caixa).
  const form = new ActionFormData().title(join("PC - ", { translate: "cobblemon.ui.party" }, selecting ? join(" - ", selecting) : undefined));
  const slots: number[] = [];
  team.forEach((pokemon, i) => {
    if (pokemon) { form.button(partyButtonText(pokemon), getPokemonSpriteTexture(pokemon)); slots.push(i); }
    else if (showEmpty) { form.button({ translate: K.empty }); slots.push(i); }
  });
  const response = await form.show(player);
  if (response.selection === undefined) return undefined;
  return { location: PCPlace.Team, space: slots[response.selection] };
}

/**
 * Ações de um Pokémon do PC/time. Retorna "close" para fechar o PC, um número para abrir aquela
 * caixa, ou undefined para voltar à caixa de origem.
 */
async function showSlotActions(player: Player, location: PCLocation, stored: PokemonData): Promise<"close" | number | undefined> {
  const pokemon = location.location === PCPlace.Team ? getLivePokemon(stored) : stored;
  type Action = "summary" | "move" | "withdraw" | "release" | "back";
  const actions: Action[] = [];
  const form = new ActionFormData().title(pokemon.getTranslatedName());
  const add = (action: Action, text: RawMessage, icon?: string) => { actions.push(action); form.button(text, icon); };
  add("summary", tr("cobblemon.ui.summary.title"), getPokemonSpriteTexture(pokemon));
  add("move", tr(K.pcMove));
  if (location.location === PCPlace.Box) add("withdraw", tr(K.pcWithdraw));
  add("release", tr("cobblemon.ui.pc.release"));
  add("back", tr(K.back));
  const response = await form.show(player);
  const action = response.selection === undefined ? undefined : actions[response.selection];
  switch (action) {
    case undefined: return "close";
    case "summary":
      await showSummary(player, pokemon);
      return undefined;
    case "move": {
      // StorageWidget: pegar (PC_GRAB) e soltar (PC_DROP).
      pcSound(player, "grab");
      const target = await pickDestination(player, location);
      if (!target) return undefined;
      const displaced = getPokemonFromPCLocation(player, target) ?? null;
      const result = movePokemon(player, location, target);
      if (result !== StorageResult.Ok) { sendError(player, result); return undefined; }
      pcSound(player, "drop");
      // Quem sai do time volta para a bola.
      if (location.location === PCPlace.Team && target.location === PCPlace.Box) recallIfOut(pokemon);
      if (displaced && target.location === PCPlace.Team && location.location === PCPlace.Box) recallIfOut(displaced);
      return target.location === PCPlace.Box ? target.boxID : undefined;
    }
    case "withdraw": {
      const result = withdrawFromPC(player, location.boxID!, location.space);
      if (result === StorageResult.NoSpace) player.sendMessage(message.error(tr(K.partyFull)));
      else if (result !== StorageResult.Ok) sendError(player, result);
      else pcSound(player, "drop");
      return undefined;
    }
    case "release":
      await confirmRelease(player, location, pokemon);
      return undefined;
  }
  return undefined;
}

function sendError(player: Player, result: StorageResult) {
  const error = storageError(result);
  if (error) player.sendMessage(error);
}

/** Escolhe o destino de um "mover": qualquer espaço de caixa ou do time. */
async function pickDestination(player: Player, from: PCLocation): Promise<PCLocation | undefined> {
  const startBox = from.location === PCPlace.Box ? from.boxID ?? 0 : 0;
  let box = startBox;
  while (true) {
    const selection = await showBoxScreen(player, box, tr(K.pcMoveTo));
    if (!selection) return undefined;
    if (selection.kind === "box") { box = selection.boxID; continue; }
    return selection.location;
  }
}
