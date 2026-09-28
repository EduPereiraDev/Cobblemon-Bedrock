/**
 * Escolha do inicial (port de `client/gui/startselection/*`): categorias por região vindas da config
 * (`starters`, padrão = StarterConfig.kt do Cobblemon 1.8.2), lista de Pokémon com sprite e cor do
 * tipo, botão "Aleatório" nas categorias com `randomStarter` e confirmação antes de escolher.
 *
 * Frente telas: uma tela só no layout do Cobblemon (`ui/starter.json`, SCREEN.STARTER): lista de categorias à
 * direita, o Pokémon atual no centro sobre a plataforma do tipo, setas ◀ ▶ (carrossel), nome, tipos, descrição da
 * Pokédex e "Eu escolho você!". O centro é o modelo 3D ao vivo (estúdio de câmera, `scripts/ui/studio`) ou, sem
 * espaço para o estúdio / com a vista 2D escolhida, o perfil 128 px pré-renderizado. Tocar no nome também escolhe.
 */
import { Player, RawMessage } from "@minecraft/server"
import { ActionFormData, MessageFormData } from "@minecraft/server-ui"
import { PokemonProperties } from "../PokemonProperties";
import { getSpeciesData } from "../speciesData";
import { StarterCategory, getConfig, sortStarterCategories } from "../Config";
import { K, getPokemonProfileTexture, join, tr } from "./common";
import { SCREEN } from "../ui/screens";
import { FRAMING, closeStudio, hasStudio, openStudio, prefersStudio, setPrefersStudio, studioAvailable } from "../ui/studio";
import { descriptionKeys } from "../pokedex/PokedexUI";
import { BLANK, CellForm, GUI, STARTER, SUB, layoutTitle, safeShow, typeCells } from "./layout";

/** Categorias válidas da config (ignora Pokémon de espécies que não foram importadas). */
export function getStarterCategories(): StarterCategory[] {
  // StarterCategory.order (pedido E da jogabilidade): ordem estável pelo campo `order`.
  return sortStarterCategories(getConfig().starters)
    .map(category => ({ ...category, pokemon: category.pokemon.filter(entry => starterSpecies(entry) !== undefined) }))
    .filter(category => category.pokemon.length > 0);
}

/** Espécie de uma entrada de inicial ("bulbasaur level=10" → "bulbasaur"). */
export function starterSpecies(entry: string): string | undefined {
  const species = PokemonProperties.parse(entry).species;
  return species && getSpeciesData(species) ? species : undefined;
}

function categoryName(category: StarterCategory): RawMessage {
  return category.displayName.startsWith("cobblemon.") ? { translate: category.displayName } : { text: category.displayName || category.name };
}

/** Ação de uma célula da tela do inicial. */
export type StarterAction =
  | { kind: "category"; index: number }
  | { kind: "more" }
  | { kind: "move"; delta: number }
  | { kind: "choose" }
  | { kind: "random" }
  | { kind: "studio" };

export interface StarterView {
  category: number;
  position: number;
  /** Primeira categoria visível (lista com mais de 11). */
  page: number;
  studio: boolean;
  studioToggle: boolean;
}

/** Monta a tela (pura sobre a config: testável). Índices em `STARTER` (layoutSpec.ts). */
export function buildStarterForm(categories: StarterCategory[], view: StarterView): CellForm<StarterAction> {
  const subs = view.studio ? [SUB.STARTER, SUB.STUDIO] : [SUB.STARTER];
  const form = new CellForm<StarterAction>(layoutTitle(SCREEN.STARTER, subs, { translate: "cobblemon.ui.starter.title" }), STARTER.COUNT);
  const overflow = categories.length > STARTER.CATEGORY_SLOTS + 1;
  const visible = overflow ? STARTER.CATEGORY_SLOTS : STARTER.CATEGORY_SLOTS + 1;
  for (let i = 0; i < visible; i++) {
    const index = view.page + i;
    const category = categories[index];
    if (!category) break;
    form.cell(STARTER.CATEGORIES + i, join(index === view.category ? "§e" : "§f", categoryName(category)), undefined, { kind: "category", index });
  }
  if (overflow) form.cell(STARTER.MORE, "§7...", undefined, { kind: "more" });
  const category = categories[view.category];
  const entries = category.pokemon;
  const position = ((view.position % entries.length) + entries.length) % entries.length;
  const species = starterSpecies(entries[position])!;
  const data = getSpeciesData(species);
  const primary = (data?.primaryType ?? "normal").toLowerCase();
  form.cell(STARTER.MODEL, BLANK, view.studio ? undefined : getPokemonProfileTexture(species));
  form.cell(STARTER.PLATFORM, BLANK, `${GUI}/starterselection/starter_platform_base_${primary}`);
  form.cell(STARTER.NAME, join("§l§f", { translate: `cobblemon.species.${species}.name` }), undefined, { kind: "choose" });
  // Frente ui-layout: número da Pokédex (#0004) ao lado do nome e os tipos como ícones (TypeIcon), sem glifos.
  form.cell(STARTER.DEX_NUMBER, `§l§f#${data?.nationalPokedexNumber ? String(data.nationalPokedexNumber).padStart(4, "0") : "????"}`);
  const types = [data?.primaryType, data?.secondaryType].filter(t => !!t).map(t => String(t).toLowerCase());
  typeCells(form, types, STARTER.TYPES, STARTER.TYPE2);
  const description = data ? descriptionKeys(species, data, undefined).map(key => ({ translate: key })) : [];
  form.cell(STARTER.DESCRIPTION, description.length ? join("§f", ...description) : { translate: "cobblemon.ui.starter.random_description" });
  if (entries.length > 1) {
    const neighbour = (delta: number) => starterSpecies(entries[(position + delta + entries.length) % entries.length])!;
    form.cell(STARTER.PREVIOUS, join("◀ ", { translate: `cobblemon.species.${neighbour(-1)}.name` }), undefined, { kind: "move", delta: -1 });
    form.cell(STARTER.NEXT, join({ translate: `cobblemon.species.${neighbour(1)}.name` }, " ▶"), undefined, { kind: "move", delta: 1 });
  }
  form.cell(STARTER.CHOOSE, { translate: "cobblemon.ui.starter.choosebutton" }, undefined, { kind: "choose" });
  if (category.randomStarter) form.cell(STARTER.RANDOM, { translate: "cobblemon.ui.starter.random" }, undefined, { kind: "random" });
  if (view.studioToggle) form.cell(STARTER.STUDIO, view.studio ? "2D" : "3D", undefined, { kind: "studio" });
  return form;
}

/**
 * Mostra a tela do inicial e a confirmação.
 * @returns a entrada escolhida (PokemonProperties em texto) ou undefined se o jogador desistiu.
 */
export async function showStarterGUI(player: Player, opts: { busyRetries?: number; outcome?: { busy?: boolean } } = {}): Promise<string | undefined> {
  const categories = getStarterCategories();
  if (categories.length === 0) return undefined;
  const view: StarterView = { category: 0, position: 0, page: 0, studio: false, studioToggle: false };
  let wantStudio = prefersStudio(player, true);
  try {
    while (player.isValid) {
      const category = categories[view.category];
      const entry = category.pokemon[((view.position % category.pokemon.length) + category.pokemon.length) % category.pokemon.length];
      view.studioToggle = hasStudio(player) || studioAvailable(player);
      view.studio = wantStudio && view.studioToggle ? openStudio(player, { species: starterSpecies(entry)! }, FRAMING.starter) : false;
      if (!view.studio && hasStudio(player)) closeStudio(player);
      // Só a 1ª tela espera mais: no login o cliente pode passar muito tempo carregando o pacote (UserBusy).
      const first = opts.busyRetries !== undefined;
      const result = await buildStarterForm(categories, view).show(player, first ? opts.busyRetries : undefined, opts.outcome);
      opts.busyRetries = undefined;
      if (!result) return undefined;
      const action = result.action;
      if (!action) continue;
      let chosen: string | undefined;
      let random = false;
      switch (action.kind) {
        // CategoryList: GUI_CLICK ao escolher a categoria.
        case "category":
          view.category = action.index; view.position = 0;
          try { player.playSound("cobblemon.gui.click"); } catch { }
          break;
        case "more": view.page = view.page + STARTER.CATEGORY_SLOTS >= categories.length ? 0 : view.page + STARTER.CATEGORY_SLOTS; break;
        case "move": view.position += action.delta; break;
        case "studio": wantStudio = !view.studio; setPrefersStudio(player, wantStudio); break;
        case "choose": chosen = entry; break;
        case "random":
          chosen = category.pokemon[Math.floor(Math.random() * category.pokemon.length)];
          random = true;
          break;
      }
      if (!chosen) continue;
      const species = starterSpecies(chosen)!;
      const confirm = await safeShow(player, new MessageFormData()
        .title({ translate: "cobblemon.ui.starter.title" })
        .body(random ? { translate: "cobblemon.ui.starter.random_description" } : tr(K.starterConfirm, { translate: `cobblemon.species.${species}.name` }))
        .button1({ translate: K.back })
        .button2({ translate: "cobblemon.ui.starter.choosebutton" }));
      if (confirm?.selection === 1) return chosen;
      if (confirm?.selection === undefined) return undefined;
    }
    return undefined;
  }
  finally {
    closeStudio(player);
  }
}
