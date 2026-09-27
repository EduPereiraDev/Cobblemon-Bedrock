/**
 * HUD do time (`PartyOverlay.kt`).
 *
 * Estilo padrão "overlay": a party desenhada à esquerda da tela pelo resource pack (`ui/cobblemon_hud.json`), com
 * os dados mandados pelo HudBus (`scripts/ui`). Estilo "text" (reserva): o texto antigo na actionbar, atualizado a
 * cada segundo. O estilo fica na dynamic property `party_hud_style` do jogador.
 *
 * Liga/desliga por jogador com `/cobblemon:partyhud` (dynamic property `party_hud`); a config `partyHudEnabled`
 * desliga para todos. No estilo overlay o HUD vem ligado (como no Cobblemon); `partyHudDefaultOn` vale para o estilo
 * texto. Durante batalhas a actionbar do estilo texto fica livre para a batalha e o overlay some: no Java o
 * `BattleOverlay` substitui o `PartyOverlay` enquanto houver batalha (CobblemonClient.beforeChatRender, frente
 * batalha-minimizavel).
 *
 * `startPartyHud()` também liga o resto da frente ui-base (HudBus, HUD de batalha, toasts e conquistas).
 */
import { Player, RawMessage, SoundInstance, system, world } from "@minecraft/server";
import { PokemonData, setExpGainedSink } from "../Pokemon";
import { getConfig } from "../Config";
import { getTeam } from "../pokemonStorage";
import { getSelection, onSelectionChanged } from "../ui/PartySelection";
import { onSelectedSlotChanged } from "../pokemon/PartySelection";
import { ExpOverlay, pushParty } from "../ui/PartyOverlay";
import { startUiBase } from "../ui";
import { setPartyPopupSink } from "../ui/achievements/tracker";
import { battleMap } from "../battle/PokemonBattle";

const HUD_PROPERTY = "party_hud";
const STYLE_PROPERTY = "party_hud_style";
/** Intervalo de atualização do estilo texto (ticks). A actionbar some sozinha em ~3 s, então 1 s mantém visível. */
export const HUD_INTERVAL_TICKS = 20;
/** Intervalo de conferência do overlay (ticks); só reenvia quando algo mudou. */
export const OVERLAY_INTERVAL_TICKS = 5;
/** Duração do pop-up de evolução/golpe novo ao lado do slot (PartyOverlayDataControl.POPUP_TIME, ~3 s). */
export const POPUP_TICKS = 60;

export type PartyHudStyle = "overlay" | "text";

let runId: number | undefined;
/** Cache por jogador: JSON do time → mensagem montada (evita refazer o texto se nada mudou). */
const cache = new Map<string, { json: string; message: RawMessage }>();
/** Cache do overlay: chave (time + seleção + pop-ups + ligado) do último envio. */
const overlayCache = new Map<string, string>();
/** Pop-ups por jogador: UUID → tipo e tick de término. */
const popups = new Map<string, Map<string, { kind: "e" | "m"; until: number }>>();

// ---------------------------------------------------------------------------------------------
// EXP ganha e level-up no overlay (PartyOverlayDataControl.pokemonGainedExp; frente dados-ui)

/** Tempos do PartyOverlayDataControl (ticks). */
export const EXP_TIMING = {
  BAR_UPDATE_BEFORE_TIME: 15, BAR_FLASH_TIME: 2, LEVEL_UP_PORTRAIT_TIME: 10, POPUP_TOTAL: 3 + 40 + 3,
} as const;
/** ticksMax do ExpGainedData = BAR_UPDATE_BEFORE_TIME + BAR_FLASH_TIME + POPUP_TIME.total(). */
export const EXP_OVERLAY_TICKS = EXP_TIMING.BAR_UPDATE_BEFORE_TIME + EXP_TIMING.BAR_FLASH_TIME + EXP_TIMING.POPUP_TOTAL;

interface ExpData { start: number; oldLevel?: number; exp: number; moves: number; evos: number; jingle: boolean; popped: boolean }
const expData = new Map<string, Map<string, ExpData>>();
const startSounds = new Map<string, SoundInstance>();

/**
 * pokemonGainedExp: junta com o que já estava na tela (soma EXP, mantém o nível antigo, absorve os pop-ups), toca
 * `gui.levelup_start` e, aos 15 ticks, `gui.levelup` (ou `evolution.notification` se liberou evolução).
 * Devolve false se o jogador não vê o overlay (HUD desligado ou estilo texto): quem chama manda no chat.
 */
export function notifyExpGained(player: Player, uuid: string, oldLevel: number | undefined, expGained: number, movesLearned = 0, evosUnlocked = 0): boolean {
  if (!isPartyHudOn(player) || getPartyHudStyle(player) !== "overlay") return false;
  let map = expData.get(player.id);
  if (!map) expData.set(player.id, map = new Map());
  const previous = map.get(uuid);
  const pending = popups.get(player.id)?.get(uuid);
  map.set(uuid, {
    start: tick, jingle: false, popped: false,
    oldLevel: oldLevel ?? previous?.oldLevel,
    exp: Math.max(0, Math.trunc(expGained)) + (previous?.exp ?? 0),
    moves: movesLearned + (previous?.moves ?? 0) + (pending?.kind === "m" ? 1 : 0),
    evos: evosUnlocked + (previous?.evos ?? 0) + (pending?.kind === "e" ? 1 : 0),
  });
  popups.get(player.id)?.delete(uuid);
  try { startSounds.get(player.id)?.stop(); } catch { }
  try { const sound = player.playSound("cobblemon.gui.levelup_start"); if (sound) startSounds.set(player.id, sound); } catch { }
  overlayCache.delete(player.id);
  return true;
}

/** O overlay está mostrando EXP ganha deste Pokémon (testes e depuração). */
export function hasExpOverlay(playerId: string, uuid: string): boolean {
  return expData.get(playerId)?.has(uuid) ?? false;
}

/** Estado da EXP na tela neste tick (e os sons/pop-ups que vencem agora). */
function activeExp(player: Player): Map<string, ExpOverlay> | undefined {
  const map = expData.get(player.id);
  if (!map) return undefined;
  const out = new Map<string, ExpOverlay>();
  for (const [uuid, data] of map) {
    const age = tick - data.start;
    if (age >= EXP_OVERLAY_TICKS) { map.delete(uuid); continue; }
    const after = EXP_TIMING.BAR_UPDATE_BEFORE_TIME + EXP_TIMING.BAR_FLASH_TIME;
    if (!data.jingle && age >= EXP_TIMING.BAR_UPDATE_BEFORE_TIME && data.oldLevel !== undefined) {
      data.jingle = true;
      try { startSounds.get(player.id)?.stop(); } catch { }
      try { player.playSound(data.evos > 0 ? "cobblemon.evolution.notification" : "cobblemon.gui.levelup"); } catch { }
    }
    if (!data.popped && age >= after) {
      data.popped = true;
      if (data.evos > 0) showPartyPopup(player, uuid, "e");
      else if (data.moves > 0) showPartyPopup(player, uuid, "m");
    }
    out.set(uuid, { exp: data.exp, levelUp: data.oldLevel !== undefined && age >= after && age < after + EXP_TIMING.LEVEL_UP_PORTRAIT_TIME });
  }
  if (map.size === 0) expData.delete(player.id);
  return out;
}
let tick = 0;

export function getPartyHudStyle(player: Player): PartyHudStyle {
  return player.getDynamicProperty(STYLE_PROPERTY) === "text" ? "text" : "overlay";
}

export function setPartyHudStyle(player: Player, style: PartyHudStyle) {
  player.setDynamicProperty(STYLE_PROPERTY, style === "text" ? "text" : undefined);
  cache.delete(player.id);
  overlayCache.delete(player.id);
  if (style === "overlay") player.onScreenDisplay.setActionBar("");
  else pushParty(player, [], -1, false);
}

export function isPartyHudOn(player: Player): boolean {
  const config = getConfig();
  if (!config.partyHudEnabled) return false;
  const own = player.getDynamicProperty(HUD_PROPERTY);
  if (typeof own === "boolean") return own;
  return getPartyHudStyle(player) === "overlay" ? true : config.partyHudDefaultOn;
}

export function setPartyHud(player: Player, on: boolean) {
  player.setDynamicProperty(HUD_PROPERTY, on);
  cache.delete(player.id);
  overlayCache.delete(player.id);
  if (!on) {
    player.onScreenDisplay.setActionBar("");
    pushParty(player, [], -1, false);
  }
}

/** Uma entrada compacta: "Pikachu Nv.12 35/40". */
function entry(pokemon: PokemonData): RawMessage[] {
  const max = Math.max(1, pokemon.maxHealth);
  const ratio = pokemon.currentHealth / max;
  const color = pokemon.currentHealth <= 0 ? "§8" : ratio > 0.5 ? "§a" : ratio > 0.2 ? "§e" : "§c";
  const status = pokemon.currentHealth > 0 && pokemon.status ? [{ text: " §6" }, { translate: `cobblemon.ui.status.${pokemon.status}` }] : [];
  return [
    { text: "§f" }, pokemon.getTranslatedName(),
    { text: " §7" }, { translate: "cobblemon.label.lv", with: [pokemon.level.toString()] },
    { text: ` ${color}${Math.max(0, pokemon.currentHealth)}/${max}` }, ...status,
  ];
}

/** Monta o texto da actionbar (estilo texto): 3 Pokémon por linha. Função pura. */
export function renderPartyHud(team: (PokemonData | null)[]): RawMessage | undefined {
  const members = team.filter((x): x is PokemonData => x != null);
  if (members.length === 0) return undefined;
  const rawtext: RawMessage[] = [];
  members.forEach((pokemon, i) => {
    if (i > 0) rawtext.push({ text: i % 3 === 0 ? "\n" : " §8|§r " });
    rawtext.push(...entry(pokemon));
  });
  return { rawtext };
}

/** Mostra o pop-up de evolução disponível ("e") ou golpe novo ("m") ao lado do slot. */
export function showPartyPopup(player: Player, uuid: string, kind: "e" | "m") {
  let map = popups.get(player.id);
  if (!map) popups.set(player.id, map = new Map());
  map.set(uuid, { kind, until: tick + POPUP_TICKS });
  overlayCache.delete(player.id);
}

function activePopups(player: Player): Map<string, "e" | "m"> | undefined {
  const map = popups.get(player.id);
  if (!map) return undefined;
  const out = new Map<string, "e" | "m">();
  for (const [uuid, popup] of map) {
    if (popup.until > tick) out.set(uuid, popup.kind);
    else map.delete(uuid);
  }
  if (map.size === 0) popups.delete(player.id);
  return out;
}

function updateText(player: Player) {
  if (player.getDynamicProperty("in_battle")) return;
  const json = player.getDynamicProperty("team");
  if (typeof json !== "string") return;
  let cached = cache.get(player.id);
  if (!cached || cached.json !== json) {
    const message = renderPartyHud(getTeam(player) ?? []);
    if (!message) return;
    cached = { json, message };
    cache.set(player.id, cached);
  }
  player.onScreenDisplay.setActionBar(cached.message);
}

function updateOverlay(player: Player, on: boolean) {
  const json = player.getDynamicProperty("team");
  const selection = on ? String(player.getDynamicProperty("cobblemon:selected_slot") ?? "") : "";
  const expMap = on ? activeExp(player) : undefined;
  const popupMap = on ? activePopups(player) : undefined;
  const expKey = expMap ? [...expMap].map(([uuid, e]) => `${uuid}:${e.exp}:${e.levelUp ? 1 : 0}`).join(",") : "";
  const key = `${on ? 1 : 0}|${typeof json === "string" ? json : ""}|${selection}|${popupMap ? [...popupMap].join(",") : ""}|${expKey}`;
  if (overlayCache.get(player.id) === key) return;
  overlayCache.set(player.id, key);
  if (!on) { pushParty(player, [], -1, false); return; }
  const team = getTeam(player) ?? [];
  const selected = getSelection(player, team).slot;
  pushParty(player, team, selected, true, popupMap, expMap);
}

/**
 * Participa ou assiste a uma batalha em andamento. No Java o espectador também recebe o BattleInitializePacket
 * (`CobblemonClient.battle` com `spectating = true`) e o overlay do time dá lugar ao da batalha
 * (CobblemonClient.beforeChatRender).
 */
export function inActiveBattle(player: Player): boolean {
  const id = player.getDynamicProperty("in_battle");
  if (typeof id === "string") {
    const battle = battleMap.get(id);
    if (battle && !battle.ended) return true;
  }
  for (const battle of battleMap.values())
    if (!battle.ended && battle.spectators.some(spectator => spectator.id === player.id)) return true;
  return false;
}

function update() {
  tick += OVERLAY_INTERVAL_TICKS;
  const textTick = tick % HUD_INTERVAL_TICKS < OVERLAY_INTERVAL_TICKS;
  for (const player of world.getPlayers()) {
    try {
      const on = isPartyHudOn(player);
      if (getPartyHudStyle(player) === "text") { if (on && textTick) updateText(player); }
      // Frente batalha-minimizavel: o overlay do time some durante a batalha (volta sozinho no fim).
      else updateOverlay(player, on && !inActiveBattle(player));
    }
    catch { /* jogador saindo no meio da atualização */ }
  }
}

/** Liga o laço do HUD (uma vez, no worldLoad) e o resto da frente ui-base. */
export function startPartyHud() {
  if (runId !== undefined) return;
  startUiBase();
  runId = system.runInterval(update, OVERLAY_INTERVAL_TICKS);
  setPartyPopupSink(showPartyPopup);
  // Frente dados-ui: EXP ganha fora da batalha (Rare Candy, doces, comandos) vai para o overlay.
  setExpGainedSink((player, uuid, oldLevel, exp, moves) => notifyExpGained(player, uuid, oldLevel, exp, moves));
  onSelectionChanged(player => overlayCache.delete(player.id));
  // Seleção mudada pelas entradas/comandos da jogabilidade (pedido E.1): redesenha no próximo ciclo.
  onSelectedSlotChanged(player => overlayCache.delete(player.id));
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    cache.delete(playerId);
    overlayCache.delete(playerId);
    popups.delete(playerId);
    expData.delete(playerId);
    startSounds.delete(playerId);
  });
}
