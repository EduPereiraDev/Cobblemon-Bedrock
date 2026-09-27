/**
 * Party overlay do Cobblemon (`PartyOverlay.kt`) no HUD: 6 slots à esquerda com retrato, nível, nome, gênero, barras
 * verticais de HP e EXP, status, bola e o slot selecionado deslocado 6 px. O desenho está em
 * `ui/cobblemon_hud.json` (gerado por `tools/ui/gen-hud.ts`); aqui só montamos os dados (canal `P` do HudBus).
 *
 * Diferenças conhecidas: o retrato é imagem 2D (sem o modelo animado), sem ícone de item segurado, sem os pop-ups de
 * EXP/golpe novo/evolução nem o ícone de estado (ombro/montado). Nome: nome da espécie do Cobblemon (igual em en_US
 * e pt_BR) ou o apelido.
 */
import type { Player } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { getExperienceGroup } from "../Experience";
import { getSpeciesData } from "../speciesData";
import { CHANNEL, PartySlotView, encodePartyBody } from "./hudProtocol";
import { getHudChannel, setHudChannel } from "./HudBus";
import { portraitPath } from "./portraits";

/** Status persistentes que têm ícone (`gui/party/status_*.png`). */
const PARTY_STATUS = new Set(["brn", "frz", "par", "psn", "slp", "tox"]);

function genderOf(pokemon: PokemonData): "m" | "f" | "n" {
  const g = (pokemon.gender ?? "").toString().toUpperCase();
  return g === "M" || g === "MALE" ? "m" : g === "F" || g === "FEMALE" ? "f" : "n";
}

/** Nome exibido: apelido ou nome da espécie (sem tradução no servidor; os nomes do Cobblemon são iguais em en/pt). */
export function displayName(pokemon: PokemonData): string {
  if (pokemon.name) return pokemon.name;
  try { return getSpeciesData(pokemon.species)?.name ?? pokemon.species; }
  catch { return pokemon.species; }
}

/** Fração da EXP do nível atual (PartyOverlay: expForThisLevel / expToNextLevel). */
export function expRatio(pokemon: PokemonData): number {
  try {
    const group = getExperienceGroup(pokemon.getExperienceGroup());
    const base = pokemon.level === 1 ? 0 : group.getExperience(pokemon.level);
    const next = group.getExperience(pokemon.level + 1) - group.getExperience(pokemon.level);
    if (next <= 0) return 0;
    return Math.max(0, Math.min(1, (pokemon.experience - base) / next));
  }
  catch { return 0; }
}

function ballId(pokemon: PokemonData): string {
  const ball = pokemon.pokeball || "poke_ball";
  return ball.includes(":") ? ball.slice(ball.indexOf(":") + 1) : ball;
}

/** Visão de um slot ocupado. */
export function partySlotView(pokemon: PokemonData, selected: boolean): PartySlotView {
  const fainted = pokemon.currentHealth <= 0;
  const status = pokemon.status && PARTY_STATUS.has(pokemon.status) ? pokemon.status : "";
  return {
    kind: fainted ? (selected ? "x" : "f") : (selected ? "a" : "n"),
    texture: portraitPath(pokemon.species, pokemon.variant ?? 0),
    name: displayName(pokemon),
    level: pokemon.level,
    hpRatio: pokemon.maxHealth > 0 ? pokemon.currentHealth / pokemon.maxHealth : 0,
    expRatio: expRatio(pokemon),
    status: fainted ? "" : status,
    gender: genderOf(pokemon),
    ball: ballId(pokemon),
  };
}

/** Corpo do canal da party. Party vazia (ou HUD desligado) = todos os slots escondidos. */
/** EXP/level-up em exibição por UUID (PartyOverlayDataControl.ExpGainedData; frente dados-ui). */
export interface ExpOverlay { exp?: number; levelUp?: boolean }

export function buildPartyBody(team: (PokemonData | null)[] | undefined, selectedSlot: number, visible = true, popups?: ReadonlyMap<string, "e" | "m">, exp?: ReadonlyMap<string, ExpOverlay>): string {
  if (!visible || !team || !team.some(x => !!x)) return encodePartyBody([]);
  const slots: PartySlotView[] = [];
  for (let i = 0; i < 6; i++) {
    const pokemon = team[i];
    if (!pokemon) { slots.push({ kind: "e" }); continue; }
    const view = partySlotView(pokemon, i === selectedSlot);
    const popup = popups?.get(pokemon.uuid);
    if (popup) view.popup = popup;
    const gained = exp?.get(pokemon.uuid);
    if (gained?.exp) view.expGained = gained.exp;
    if (gained?.levelUp) view.levelUp = true;
    slots.push(view);
  }
  return encodePartyBody(slots);
}

/** Atualiza o canal da party do jogador (só marca envio se mudou). */
export function pushParty(player: Player, team: (PokemonData | null)[] | undefined, selectedSlot: number, visible: boolean, popups?: ReadonlyMap<string, "e" | "m">, exp?: ReadonlyMap<string, ExpOverlay>) {
  const body = buildPartyBody(team, selectedSlot, visible, popups, exp);
  if (getHudChannel(player, CHANNEL.PARTY) !== body) setHudChannel(player, CHANNEL.PARTY, body);
}
