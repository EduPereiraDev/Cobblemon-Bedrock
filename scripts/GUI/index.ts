/**
 * Telas do Cobblemon Bedrock. Cada tela fica no seu arquivo; aqui ficam os pontos de entrada
 * usados pelo resto dos scripts (nomes antigos mantidos).
 */
import { recallAnimated, sendOutAnimated } from "../pokemon/SendOutAnimation";
import { ActionFormData } from "@minecraft/server-ui"
import { Entity, Player } from "@minecraft/server"
import { PokemonData } from "../Pokemon"
import { renderPokemonName } from "../language"
import { PCLocation, PCPlace, getSafeTeam, getTeam } from "../pokemonStorage"
import { K, getPokemonSpriteTexture, showYesOrNoDialog } from "./common"
import { showPokemonMenuFromEntity, openPartyMenu } from "./Party"

export { showStarterGUI } from "./StarterGUI";
export { okDialog } from "./OKDialogBox";
export { getPokemonSpriteTexture, showYesOrNoDialog } from "./common";
export { openPartyMenu, showPartyPokemonMenu } from "./Party";
export { openPCGui } from "./PC";
export { showSummary } from "./Summary";
export { showMovesMenu } from "./Moves";
export { showConfigEditor } from "./ConfigEditor";
export { startPartyHud, setPartyHud, isPartyHudOn } from "./PartyHud";
export { showPokemonEditForm } from "./PokemonEdit";

/** Menu do próprio Pokémon ao interagir com ele fora da bola (antes era só apelido/golpes). */
export async function showPokemonGUI(showFrom: Entity, player: Player) {
  const pokemonData = PokemonData.tryGetFromEntity(showFrom);
  if (!pokemonData) return;
  await showPokemonMenuFromEntity(player, pokemonData.uuid);
}

/** Lista rápida para mandar para fora/recolher (atalho do emote). O menu completo é openPartyMenu. */
export async function sendOutGUI(player: Player) {
  let playerTeam = getTeam(player);
  if (!playerTeam) return;
  let validOptions = playerTeam.filter(x => { return (x && (x.name || x.species) && x.level) }) as PokemonData[];
  if (validOptions.length <= 0) return;
  const gui = new ActionFormData;
  gui.title({ translate: "cobblemon.ui.party" });
  validOptions.forEach(x => {
    const name = renderPokemonName(x);
    gui.button(name, getPokemonSpriteTexture(x.species));
  })
  gui.button({ translate: "cobblemon.ui.summary.title" });
  const response = await gui.show(player);
  if (response.selection === undefined) return;
  if (response.selection === validOptions.length) {
    await openPartyMenu(player);
    return;
  }
  let selectedPokemon = validOptions[response.selection];
  if (selectedPokemon.tryGetPokemonOut()) {
    await recallAnimated(player, selectedPokemon);
  }
  else {
    await sendOutAnimated(player, selectedPokemon);
  }
}

/** Escolhe um espaço do time (usado por outras telas). */
export async function showPartyScreen(player: Player, showEmptySlots?: boolean, title?: string): Promise<PCLocation | undefined> {
  let pcgui = new ActionFormData()
    .title({ rawtext: [{ translate: "cobblemon.ui.party" }, { text: title ? " - " + title : "" }] });
  let boxData = getSafeTeam(player);
  let slots: number[] = [];
  boxData.forEach((x, i) => {
    if (!x) {
      if (showEmptySlots) {
        slots.push(i);
        pcgui.button({ translate: K.empty });
      }
    }
    else {
      pcgui.button(renderPokemonName(x), getPokemonSpriteTexture(x.species));
      slots.push(i);
    }
  })
  let response = await pcgui.show(player);
  if (response.selection === undefined) return undefined;
  return { location: PCPlace.Team, space: slots[response.selection] }
}
