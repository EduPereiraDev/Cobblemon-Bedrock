/**
 * Markings do Cobblemon 1.8.2 (`Pokemon.markings`, `client/gui/summary/widgets/MarkingsWidget.kt`, `SetMarkingsPacket`):
 * seis símbolos (● ▲ ■ ♥ ★ ◆), cada um com 3 estados (0 = apagado, 1, 2), que o dono alterna tocando no resumo
 * (e na prévia do PC). Guardados em `PokemonData.markings`.
 */
import type { Player } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { findPokemonLocation, getPokemonFromPCLocation, setPokemonToPCLocation, PCPlace } from "../pokemonStorage";

export const MARKING_COUNT = 6;
/** Símbolos na ordem das texturas `icon_marking_0..5`. */
export const MARKING_SYMBOLS = ["●", "▲", "■", "♥", "★", "◆"] as const;
/** Cor de cada estado no texto (0 apagado; 1 e 2 como as duas cores da textura). */
export const MARKING_COLORS = ["§8", "§9", "§d"] as const;

/** Estados atuais (sempre 6 números 0..2; ausente = tudo 0). */
export function getMarkings(pokemon: Pick<PokemonData, "markings">): number[] {
  const out: number[] = [];
  for (let i = 0; i < MARKING_COUNT; i++) {
    const value = pokemon.markings?.[i];
    out.push(value === 1 || value === 2 ? value : 0);
  }
  return out;
}

/** MarkingsWidget.incrementState: (estado + 1) % 3 no símbolo `index`. */
export function cycleMarking(states: readonly number[], index: number): number[] {
  const out = [...states];
  if (index >= 0 && index < MARKING_COUNT) out[index] = ((out[index] ?? 0) + 1) % 3;
  return out;
}

/** Texto colorido dos 6 símbolos (listas e prévia do PC). Vazio se tudo apagado e `hideEmpty`. */
export function markingsText(pokemon: Pick<PokemonData, "markings">, hideEmpty = false): string {
  const states = getMarkings(pokemon);
  if (hideEmpty && states.every(state => state === 0)) return "";
  return states.map((state, i) => `${MARKING_COLORS[state]}${MARKING_SYMBOLS[i]}`).join("") + "§r";
}

/**
 * SetMarkingsHandler: grava as markings no Pokémon onde ele estiver (time ou PC) e na entidade fora da bola.
 * Devolve false se o Pokémon não é do jogador.
 */
export function setMarkings(player: Player, pokemon: PokemonData, states: readonly number[]): boolean {
  const clean = getMarkings({ markings: [...states] });
  pokemon.markings = clean;
  const location = findPokemonLocation(player, pokemon.uuid);
  if (!location) return false;
  const stored = getPokemonFromPCLocation(player, location);
  if (!stored) return false;
  stored.markings = clean;
  if (location.location === PCPlace.Team) {
    const live = stored.tryGetPokemonOut();
    if (live) {
      try {
        const raw = live.getDynamicProperty("data");
        if (typeof raw === "string") {
          const data = JSON.parse(raw);
          data.markings = clean;
          live.setDynamicProperty("data", JSON.stringify(data));
        }
      }
      catch { }
    }
  }
  setPokemonToPCLocation(player, location, stored);
  return true;
}
