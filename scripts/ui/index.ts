/**
 * Frente ui-base: infraestrutura de interface para as outras frentes.
 *
 * - `hudProtocol` / `HudBus`: dados do HUD pelo título (1 por tick por jogador, canais com prioridade);
 * - `PartyOverlay` + `PartySelection`: party à esquerda e slot selecionado (API para envio rápido);
 * - `BattleHud`: caixas de info da batalha;
 * - `Toast`: toasts no canto superior direito;
 * - `achievements`: conquistas do Cobblemon (rastreio, toast, chat e tela);
 * - `screens`: marcadores invisíveis de título para rotear forms no JSON UI;
 * - `glyphs`: ícones inline (páginas E2/E3);
 * - `portraits`: caminho do retrato (liga no `portraitTexture` da frente retratos).
 */
import { startHudBus } from "./HudBus";
import { startBattleHud } from "./BattleHud";
import { startToasts } from "./Toast";
import { ADVANCEMENTS_BY_ID, hasAchievement, startAchievements } from "./achievements/tracker";
import { setAdvancementLookup } from "../evolution/requirements/ExtraRequirements";
import { isProgressGoalDone } from "../pokedex/Progress";

export { SCREEN, ROUTED_SCREENS, withScreen, screenOf } from "./screens";
export type { ScreenMarker } from "./screens";
export { setHudChannel, getHudChannel, refreshHud } from "./HudBus";
export { getSelectedSlot, setSelectedSlot, cycleSelectedSlot, getSelectedPokemon, onSelectionChanged } from "./PartySelection";
export { showToast, advancementToast, captureToast, evolutionToast } from "./Toast";
export { setPortraitResolver, portraitPath } from "./portraits";
export { typeGlyph, categoryGlyph, ballGlyph, TYPE_GLYPHS, CATEGORY_GLYPHS } from "./glyphs";
export { recordAchievementEvent, hasAchievement, getAchievements, onAchievementCompleted } from "./achievements/tracker";
export { openAchievements } from "./achievements/screen";
export type { AchievementEvent } from "./achievements/engine";

let started = false;

/** Liga HudBus, HUD de batalha, toasts e conquistas (uma vez, no worldLoad; chamado por `startPartyHud`). */
export function startUiBase() {
  if (started) return;
  started = true;
  startHudBus();
  startBattleHud();
  startToasts();
  startAchievements();
  // Requisito de evolução `advancement` (pedido E.5 da jogabilidade): conquistas de verdade; ids fora da lista
  // (datapacks) continuam na "Progresso Cobblemon".
  setAdvancementLookup((owner, advancement) => {
    const id = advancement.replace(/^cobblemon:/, "");
    return ADVANCEMENTS_BY_ID.has(id) ? hasAchievement(owner, id) : isProgressGoalDone(owner, advancement);
  });
}
