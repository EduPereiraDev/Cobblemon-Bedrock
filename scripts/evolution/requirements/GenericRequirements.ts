/**
 * Requisitos genéricos do Cobblemon 1.8.2 (`pokemon/requirements/*`, registrados no CobbledRequirementAdapter) que só
 * datapacks usam — nenhum dado do jogo base: `chance`, `negate`, `owner_held_item` e `area`. Valem para evoluções
 * e, pelo `evaluateChance`, para as interações (`pokemon_interactions`).
 */
import type { Entity, Player } from "@minecraft/server";
import { PokemonData } from "../../Pokemon";
import { EvoRequirement } from "../../speciesData";
import { EvolutionRequirement } from "../EvolutionRequirement";
import { MoEnvironment, asNumber } from "../../npc/molang/MoLang";
import { structHooks } from "../../molang/StructHooks"; // frente dados-ia

/**
 * Fábrica dos requisitos internos (`negate`), registrada por `./index.ts` (sem import direto: o índice importa este
 * módulo, e o ciclo deixaria as classes indefinidas na montagem da tabela).
 */
let innerFactory: ((requirement: EvoRequirement) => EvolutionRequirement | undefined) | undefined;
export function setInnerRequirementFactory(factory: (requirement: EvoRequirement) => EvolutionRequirement | undefined) {
  innerFactory = factory;
}

let chanceEnv: MoEnvironment | undefined;

/**
 * ChanceRequirement.check: `Random.nextFloat() < resolveFloat(chance)`. A expressão pode ser um número ("0.25") ou
 * MoLang com `q.pokemon`. Expressão inválida conta como 1 (o Cobblemon cairia no padrão "1").
 */
export function evaluateChance(expression: string | number, pokemon?: PokemonData, random: () => number = Math.random): boolean {
  let chance = typeof expression === "number" ? expression : Number(expression);
  if (typeof expression === "string" && !Number.isFinite(chance)) {
    try {
      chanceEnv ??= new MoEnvironment();
      // Frente dados-ia: q.pokemon completo (scripts/molang/PokemonStruct.ts, pelo gancho para evitar ciclo de import).
      if (pokemon && structHooks.pokemon) chanceEnv.query.set("pokemon", structHooks.pokemon(pokemon));
      chance = asNumber(chanceEnv.eval(expression));
    }
    catch { chance = 1; }
  }
  return random() < chance;
}

export class ChanceRequirement extends EvolutionRequirement {
  variant = "chance";
  constructor(public chance: string | number = "1") { super() }
  check(pokemon: PokemonData): boolean {
    return evaluateChance(this.chance, pokemon);
  }
  static getFromSerialized(requirement: EvoRequirement & { chance?: string | number }) {
    return new ChanceRequirement(requirement.chance ?? "1");
  }
}

/** NegateRequirement: o contrário do requisito `inner`. */
export class NegateRequirement extends EvolutionRequirement {
  variant = "negate";
  constructor(private raw?: EvoRequirement, public inner?: EvolutionRequirement) { super() }
  check(pokemon: PokemonData): boolean {
    if (!this.inner && this.raw) this.inner = innerFactory?.(this.raw);
    return this.inner ? !this.inner.check(pokemon) : false;
  }
  static getFromSerialized(requirement: EvoRequirement & { inner?: EvoRequirement }) {
    return new NegateRequirement(requirement.inner);
  }
}

/** OwnerHoldsItemRequirement (`owner_held_item`): o dono segura o item (ou um item da tag `#...`) na mão principal. */
export class OwnerHoldsItemRequirement extends EvolutionRequirement {
  variant = "owner_held_item";
  constructor(public itemCondition = "") { super() }
  check(pokemon: PokemonData): boolean {
    const owner = pokemon.tryGetOwner() as Player | undefined;
    if (!owner) return false;
    let held: string | undefined;
    let tags: string[] = [];
    try {
      const stack = owner.getComponent("minecraft:inventory")?.container?.getItem(owner.selectedSlotIndex);
      held = stack?.typeId;
      tags = stack?.getTags() ?? [];
    }
    catch { return false; }
    if (!held) return false;
    const condition = this.itemCondition.toLowerCase();
    if (condition.startsWith("#")) {
      const tag = condition.slice(1);
      return tags.includes(tag) || tags.includes(tag.replace(/^[a-z0-9_]+:/, ""));
    }
    return held === (condition.includes(":") ? condition : `minecraft:${condition}`);
  }
  static getFromSerialized(requirement: EvoRequirement & { itemCondition?: string }) {
    return new OwnerHoldsItemRequirement(String(requirement.itemCondition ?? ""));
  }
}

interface Box { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

/** AreaRequirement: a entidade do Pokémon (ou o dono) está dentro da caixa (AABB.contains: máximo exclusivo). */
export class AreaRequirement extends EvolutionRequirement {
  variant = "area";
  constructor(public box: Box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }) { super() }
  check(pokemon: PokemonData): boolean {
    const entity: Entity | undefined = pokemon.tryGetPokemonOut() ?? pokemon.tryGetOwner();
    if (!entity) return false;
    return AreaRequirement.contains(this.box, entity.location);
  }
  static contains(box: Box, p: { x: number; y: number; z: number }): boolean {
    return p.x >= box.minX && p.x < box.maxX && p.y >= box.minY && p.y < box.maxY && p.z >= box.minZ && p.z < box.maxZ;
  }
  static getFromSerialized(requirement: EvoRequirement & { box?: Partial<Box> }) {
    const b = requirement.box ?? {};
    const n = (v: unknown, d: number) => (typeof v === "number" ? v : d);
    return new AreaRequirement({
      minX: Math.min(n(b.minX, 0), n(b.maxX, 1)), minY: Math.min(n(b.minY, 0), n(b.maxY, 1)), minZ: Math.min(n(b.minZ, 0), n(b.maxZ, 1)),
      maxX: Math.max(n(b.minX, 0), n(b.maxX, 1)), maxY: Math.max(n(b.minY, 0), n(b.maxY, 1)), maxZ: Math.max(n(b.minZ, 0), n(b.maxZ, 1)),
    });
  }
}
