/**
 * Ordenar a caixa do PC (`api/pokemon/PokemonSortMode.kt` + `PCBox.sort` do Cobblemon 1.8.2) e o filtro da caixa
 * (`api/storage/pc/search/Search.kt`).
 */
import type { PokemonData } from "../Pokemon";
import { PokemonProperties } from "../PokemonProperties";
import { getSpeciesData } from "../speciesData";

/** Ordem do enum (botões da barra de ordenação do PCGUI). */
export const SORT_MODES = ["name", "level", "type", "pokedex_number", "gender"] as const;
export type SortMode = (typeof SORT_MODES)[number];

/** Enum Gender do Cobblemon: MALE, FEMALE, GENDERLESS. */
const GENDER_ORDER: Record<string, number> = { m: 0, f: 1, "": 2 };

/** Nome exibido (getDisplayName().string): apelido ou nome da espécie. */
export function displayName(pokemon: PokemonData): string {
  if (pokemon.name) return pokemon.name;
  return getSpeciesData(pokemon.species)?.name ?? pokemon.species;
}

function sortKey(pokemon: PokemonData, mode: SortMode): string | number | undefined {
  switch (mode) {
    case "name": return displayName(pokemon);
    case "level": return pokemon.level;
    case "type": {
      try { return String(pokemon.getPrimaryType()).toLowerCase(); } catch { return undefined; }
    }
    case "pokedex_number": return getSpeciesData(pokemon.species)?.nationalPokedexNumber;
    case "gender": return GENDER_ORDER[pokemon.gender ?? ""] ?? 2;
  }
}

/** compareTo do Kotlin: números pela ordem; textos por código de caractere (sensível a maiúsculas). */
function compareValues(a: string | number | undefined, b: string | number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * PokemonSortMode.comparator(descending): vazios sempre no fim; o resto pela chave (crescente ou decrescente).
 * Ordenação estável (sortWith do Kotlin é estável).
 */
export function sortPokemon<T extends PokemonData | null | undefined>(slots: readonly T[], mode: SortMode, descending = false): T[] {
  return slots
    .map((pokemon, index) => ({ pokemon, index, key: pokemon ? sortKey(pokemon, mode) : undefined }))
    .sort((a, b) => {
      if (!a.pokemon !== !b.pokemon) return a.pokemon ? -1 : 1;
      if (!a.pokemon) return a.index - b.index;
      const byKey = compareValues(a.key, b.key);
      return (descending ? -byKey : byKey) || a.index - b.index;
    })
    .map(entry => entry.pokemon);
}

/** Um filtro do Search (PokemonFilter). */
type Filter = (pokemon: PokemonData) => boolean;

function hasLabel(pokemon: PokemonData, label: string): boolean {
  try { return pokemon.hasLabels(label); } catch { return false; }
}

/**
 * Search.of: peças separadas por espaço, `!` inverte; `holding|helditem|held_item`, `fainted`, `legendary`,
 * `mythical`, `ultrabeast|ultra_beast`; qualquer outra peça passa se o nome da espécie ou o nome exibido contém o
 * texto (parcial: "cha" acha Charmander) ou se, lida como PokemonProperties, bate com o Pokémon.
 */
export function parseSearch(query: string): Filter[] {
  if (!query.trim()) return [];
  return query.toLowerCase().trim().split(" ").map(piece => {
    const inverted = piece.startsWith("!");
    const filter = inverted ? piece.slice(1) : piece;
    let test: Filter;
    switch (filter) {
      case "holding": case "helditem": case "held_item": test = p => !!p.minecraftItem; break;
      case "fainted": test = p => p.currentHealth <= 0; break;
      case "legendary": test = p => hasLabel(p, "legendary"); break;
      case "mythical": test = p => hasLabel(p, "mythical"); break;
      case "ultrabeast": case "ultra_beast": test = p => hasLabel(p, "ultra_beast"); break;
      default: {
        const props = PokemonProperties.parse(filter);
        const hasProps = props.asString().length > 0;
        test = p => {
          if (!filter) return true;
          const species = (getSpeciesData(p.species)?.name ?? p.species).toLowerCase();
          const name = displayName(p).toLowerCase();
          if (species.includes(filter) || name.includes(filter)) return true;
          try { return hasProps && props.match(p); } catch { return false; }
        };
      }
    }
    return inverted ? (p: PokemonData) => !test(p) : test;
  });
}

/** Search.passes: todos os filtros; vazio (sem busca) passa tudo; espaço vazio nunca passa. */
export function searchPasses(filters: readonly Filter[], pokemon: PokemonData | null | undefined): boolean {
  if (!pokemon) return false;
  return filters.every(filter => filter(pokemon));
}
