/**
 * Fim da evolução (Cobblemon 1.8.2, `Evolution.evolutionMethod`):
 *
 * - `shed` ("shedders", 1.6.0): Nincada → Ninjask cria também um Shedinja se o dono tiver um espaço livre no time e
 *   uma Poké Ball qualquer no inventário (a última encontrada, gasta fora do criativo; no criativo usa Poké Ball). O
 *   Shedinja é uma cópia do Pokémon já evoluído, sem item segurado, com o `shedder` aplicado e a bola usada.
 * - `dropEvolutionLoot` (1.6.1/1.8.0): a tabela `drops` da evolução (Shed Shell do Nincada/Karrablast/Spewpa, Turtle
 *   Scute, Shell Helmet do Shelmet com Karrablast no time...) com a gamerule `doPokemonLoot`, no Pokémon (se estiver
 *   fora) ou no dono, pelo método de drop da config.
 */
import { Entity, GameMode, ItemStack, Player } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import type { PokemonProperties } from "../PokemonProperties";
import { getGameRule } from "../Config";
import { DropEntryData, DropTableData, deliverItem, entryAmount, makeStack, rollDropEntries } from "../pokemon/Drops";
import { initializeRequirements } from "./requirements";
import type { EvoRequirement } from "../speciesData";
import { UUID } from "../utils";

/** Tag de item das bolas (CobblemonItemTags.POKE_BALLS). */
export const POKE_BALL_TAG = "cobblemon:poke_balls";
export const DEFAULT_BALL = "cobblemon:poke_ball";

function isCreative(player: Player): boolean {
  try { return player.getGameMode() === GameMode.Creative; }
  catch { return false; }
}

function isPokeBall(stack: ItemStack | undefined): boolean {
  if (!stack) return false;
  try { return stack.hasTag(POKE_BALL_TAG); }
  catch { return /^cobblemon:\w+_ball$/.test(stack.typeId); }
}

/** Última bola do inventário (o laço do Cobblemon sobrescreve a cada achado). */
export function findLastPokeBallSlot(stacks: (ItemStack | undefined)[]): number {
  let found = -1;
  stacks.forEach((stack, i) => { if (isPokeBall(stack)) found = i; });
  return found;
}

export interface ShedDeps {
  /** Espaço livre no time (índice) ou undefined. */
  firstFreePartySlot(owner: Player): number | undefined;
  /** Guarda o Shedinja no time do dono. */
  store(owner: Player, pokemon: PokemonData): void;
  /** Progresso Cobblemon (evolve_shedinja). */
  recordEvolution?(owner: Player, from: string, to: PokemonData): void;
}

/**
 * Evolution.shed. `evolved` = Pokémon depois do resultado e dos golpes novos; `preEvolutionSpecies` = espécie antes.
 * Retorna o Shedinja criado, ou undefined.
 */
export function shed(shedder: PokemonProperties | undefined, evolved: PokemonData, owner: Player | undefined, preEvolutionSpecies: string, deps: ShedDeps): PokemonData | undefined {
  if (!shedder || !owner?.isValid) return undefined;
  const container = owner.getComponent("minecraft:inventory")?.container;
  let ballSlot = -1;
  let ballId = DEFAULT_BALL;
  if (!isCreative(owner)) {
    if (!container) return undefined;
    const stacks: (ItemStack | undefined)[] = [];
    for (let i = 0; i < container.size; i++) stacks.push(container.getItem(i));
    ballSlot = findLastPokeBallSlot(stacks);
    if (ballSlot < 0) return undefined;
    ballId = stacks[ballSlot]!.typeId;
  }
  if (deps.firstFreePartySlot(owner) === undefined) return undefined;

  // pokemon.clone() (UUID novo) → removeHeldItem → shedder.apply → caughtBall.
  const copy = shedder.apply(evolved);
  copy.uuid = UUID.generate();
  copy.minecraftItem = undefined;
  copy.item = "";
  copy.pokeball = ballId;
  copy.readyEvolutions = [];
  copy.evolutionProgress = [];
  copy.recalculateHealth?.();
  deps.store(owner, copy);
  try { deps.recordEvolution?.(owner, preEvolutionSpecies, copy); } catch { }
  if (ballSlot >= 0 && container) {
    const slot = container.getSlot(ballSlot);
    const stack = slot.getItem();
    if (stack) {
      if (stack.amount > 1) slot.amount = stack.amount - 1;
      else slot.setItem(undefined);
    }
  }
  return copy;
}

/**
 * Evolution.evolutionMethod (drops): com `doPokemonLoot`, sorteia a tabela e entrega. Entradas com `requirements`
 * (EvolutionItemDropEntry) só valem se o Pokémon evoluído passar. Retorna os itens entregues.
 */
export function dropEvolutionLoot(drops: DropTableData | undefined, evolved: PokemonData, owner: Player | undefined, entity: Entity | undefined, random = Math.random): string[] {
  if (!drops?.entries?.length || !owner?.isValid) return [];
  if (!getGameRule("doPokemonLoot")) return [];
  const canDrop = (entry: DropEntryData) => {
    if (!entry.requirements?.length) return true;
    try { return initializeRequirements(entry.requirements as EvoRequirement[]).every(r => r.check(evolved)); }
    catch { return false; }
  };
  const delivered: string[] = [];
  for (const entry of rollDropEntries(drops, canDrop, random)) {
    const stack = makeStack(entry.item, entryAmount(entry, random));
    if (!stack) continue;
    const where = entity?.isValid ? entity : owner;
    deliverItem(stack, { dimension: where.dimension, location: where.location, entity: entity?.isValid ? entity : undefined, player: owner });
    delivered.push(entry.item);
  }
  return delivered;
}
