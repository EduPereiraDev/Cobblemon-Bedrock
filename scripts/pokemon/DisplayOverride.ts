/**
 * Frente msd-fase1: o que a entidade de um Pokémon MOSTRA pode diferir dos dados dele durante a batalha (Mega, Primal,
 * formas de batalha, Tera, Dynamax). Em vez de mexer em `PokemonData.aspects` (que é gravado no time a cada sincronia
 * e sobreviveria a uma queda do servidor no meio da batalha), um provedor devolve os aspects/gimmick de exibição e
 * este módulo aplica só na entidade: `cobblemon:variant`, `cobblemon:aspects` (bits dos posers) e `cobblemon:gimmick`.
 *
 * Sem provedor registrado (mundo sem o Mega Showdown) nada daqui roda: o base fica exatamente como antes.
 * O provedor é o de `scripts/battle/BattleForms.ts`, ligado pela extensão Mega Showdown.
 */
import type { Entity } from "@minecraft/server";
import { resolveVariant } from "../../generated/scripts/variants";
import { syncAspectBits } from "../entity/AspectSync";
import { GIMMICK_NONE, GIMMICK_PROPERTY } from "../entity/GimmickProperty";
import { getFormForAspects, getSpeciesData, toSpeciesId } from "../speciesData";

export interface DisplayOverride {
  /** Aspects mostrados (undefined = os do Pokémon). */
  aspects?: readonly string[];
  /** Valor de `cobblemon:gimmick` (0 = nenhum). */
  gimmick?: number;
}

/** O que o provedor precisa do Pokémon (PokemonData satisfaz). */
export interface DisplaySubject {
  uuid: string;
  species: string;
  aspects: string[];
}

export type DisplayOverrideProvider = (data: DisplaySubject) => DisplayOverride | undefined;

let provider: DisplayOverrideProvider | undefined;

/** Registra (ou tira, com undefined) o provedor. */
export function setDisplayOverrideProvider(fn: DisplayOverrideProvider | undefined): void {
  provider = fn;
}

export function hasDisplayOverrideProvider(): boolean {
  return provider !== undefined;
}

/** Exibição do Pokémon agora (undefined = sem mudança). Nunca lança. */
export function displayOverrideOf(data: DisplaySubject): DisplayOverride | undefined {
  if (!provider || !data?.uuid) return undefined;
  try { return provider(data); }
  catch { return undefined; }
}

/**
 * Frente msd-fase2: nome da forma MOSTRADA (a da Mega/Primal na batalha), para o tamanho da entidade
 * (`entity/Size.ts`). undefined = sem override de aspects (vale a forma dos dados); "" = forma padrão.
 */
export function displayFormName(data: Partial<DisplaySubject>): string | undefined {
  if (!provider || !data?.uuid || !data.species || !Array.isArray(data.aspects)) return undefined;
  const display = displayOverrideOf(data as DisplaySubject);
  if (!display?.aspects) return undefined;
  try {
    const species = getSpeciesData(data.species);
    return species ? getFormForAspects(species, display.aspects)?.name ?? "" : undefined;
  }
  catch {
    return undefined;
  }
}

type PropertyEntity = Pick<Entity, "getProperty" | "setProperty">;

/** Grava `cobblemon:gimmick` se a entidade declara a propriedade e o valor mudou. */
export function applyGimmickProperty(entity: PropertyEntity, value: number): boolean {
  try {
    const current = entity.getProperty(GIMMICK_PROPERTY);
    if (current === undefined || current === value) return false;
    entity.setProperty(GIMMICK_PROPERTY, value);
    return true;
  }
  catch {
    return false;
  }
}

/**
 * Chamado no fim do `PokemonData.applyToCobblemon` (depois de o base gravar a variante dos dados). Com provedor:
 * troca a variante/bits pelos aspects de exibição e acerta o gimmick (0 quando não há nada, o que desfaz o visual no
 * fim da batalha).
 */
export function applyDisplayOverride(entity: Entity, data: DisplaySubject): void {
  if (!provider) return;
  const display = displayOverrideOf(data);
  if (display?.aspects) {
    try { entity.setProperty("cobblemon:variant", resolveVariant(toSpeciesId(data.species), display.aspects)); } catch { }
    try { syncAspectBits(entity, display.aspects); } catch { }
  }
  applyGimmickProperty(entity, display?.gimmick ?? GIMMICK_NONE);
}
