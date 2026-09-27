import { Entity } from "@minecraft/server";
import { Dex } from "../../showdown";
import { toSpeciesId } from "../../speciesData";
import type { PokemonData } from "../../Pokemon";
import { EffectActor, EffectMove, findTimeline, namedAnimationsOf, pickAnimation, runActionEffect } from "./ActionEffects";

export { runActionEffect, planActionEffect, findTimeline, locatorPosition, pickAnimation } from "./ActionEffects";
export type { EffectActor, EffectContext, EffectMove } from "./ActionEffects";

/** Pokémon em campo como os handlers do BattleInterpreter o recebem. */
export interface EffectPokemon {
  entity: Entity | undefined;
  data: PokemonData;
  /** Entidade que aparece no mundo (a de exibição de Illusion/Transform; frente visual-batalha). */
  readonly visual?: Entity | undefined;
  /** Espécie do modelo que aparece (Illusion/Transform). */
  readonly visualSpecies?: string | undefined;
}

/** Status do Showdown → timeline de status do Cobblemon (StatusInstruction/DamageInstruction). */
const STATUS_EFFECTS: Record<string, string> = { brn: "burn", psn: "poison", tox: "poisonbadly", par: "paralysis", slp: "sleep", confusion: "confused", attract: "attract" };

/** Resultado do golpe para o alvo, lido nas linhas seguintes do protocolo (até o próximo |move|/|turn|). */
function outcome(lines: readonly string[] | undefined, targetPos: string | undefined, userPos: string | undefined) {
  const out = { missed: false, hurt: false, failed: false };
  for (const line of lines ?? []) {
    const parts = line.split("|");
    const cmd = parts[1];
    if (cmd === "move" || cmd === "turn" || cmd === "upkeep") break;
    const a1 = parts[2]?.split(":")[0];
    const a2 = parts[3]?.split(":")[0];
    if ((cmd === "-miss" && (!targetPos || !a2 || a2 === targetPos)) || (cmd === "-immune" && (!targetPos || a1 === targetPos))) out.missed = true;
    else if (cmd === "-damage" && (!targetPos || a1 === targetPos)) out.hurt = true;
    else if (cmd === "-fail" && (!userPos || a1 === userPos)) out.failed = true;
  }
  return out;
}

function actor(p: EffectPokemon, isUser: boolean): EffectActor {
  return { entity: p.visual ?? p.entity, species: p.visualSpecies ?? toSpeciesId(p.data.species), isUser };
}

/** Timeline do Status do Cobblemon para um id do Showdown (Statuses.getStatus(showdownName).getActionEffect()). */
export function statusTimeline(showdownId: string | undefined): string | undefined {
  const status = showdownId ? STATUS_EFFECTS[showdownId] : undefined;
  return status && findTimeline(status) ? status : undefined;
}

/**
 * Timeline de um só Pokémon (UsersProvider) — frente visual-batalha: `boost`/`unboost` (BoostInstruction),
 * status em `cant`/`-activate` (CantInstruction/ActivateInstruction), `start_<id>`, `activate_<id>` e `prepare_<id>`.
 * Devolve os segundos até as holds serem liberadas (0 = sem timeline).
 */
export function playPokemonEffect(pokemon: EffectPokemon, timeline: string | undefined): number {
  if (!timeline || !findTimeline(timeline)) return 0;
  try {
    return runActionEffect(timeline, { actors: [actor(pokemon, true)] });
  } catch {
    return 0;
  }
}

/** BoostInstruction: `boost`/`unboost` só quando houve mudança de estágio. */
export function playBoostEffect(pokemon: EffectPokemon, isBoost: boolean, stages: number): number {
  if (!stages) return 0;
  return playPokemonEffect(pokemon, isBoost ? "boost" : "unboost");
}

/** CantInstruction: timeline do status (par/slp/frz/attract...) do Pokémon que não pôde agir. */
export function playCantEffect(pokemon: EffectPokemon, effectId: string | undefined): number {
  return playPokemonEffect(pokemon, statusTimeline(effectId));
}

/** ActivateInstruction: status (ex. confusão) ou `activate_<id>` (Protect, Powder). */
export function playActivateEffect(pokemon: EffectPokemon, effectId: string | undefined): number {
  if (!effectId) return 0;
  return playPokemonEffect(pokemon, statusTimeline(effectId) ?? `activate_${effectId}`);
}

/** StartInstruction: `start_<id>` (ex. `start_alphaboost`). PrepareInstruction: `prepare_<id>`. */
export function playStartEffect(pokemon: EffectPokemon, effectId: string | undefined): number {
  return effectId ? playPokemonEffect(pokemon, `start_${effectId}`) : 0;
}

export function playPrepareEffect(pokemon: EffectPokemon, effectId: string | undefined): number {
  return effectId ? playPokemonEffect(pokemon, `prepare_${effectId}`) : 0;
}

/**
 * Efeito do golpe (MoveInstruction.kt): timeline `<golpe>_<espécie>` → `<golpe>` → `generic_move`.
 * Devolve os segundos que a fila da batalha deve esperar (holds do Cobblemon; 0 = não esperar).
 */
export function playMoveEffects(user: EffectPokemon, target: EffectPokemon | undefined, moveId: string, following?: readonly string[], userPos?: string, targetPos?: string): number {
  try {
    const dex = Dex.moves.get(moveId);
    const move: EffectMove = { name: dex.id || moveId, type: String(dex.type ?? "normal").toLowerCase(), category: String(dex.category ?? "status").toLowerCase() };
    const res = outcome(following, targetPos, userPos);
    const userActor = { ...actor(user, true), failed: res.failed };
    const actors: EffectActor[] = [userActor];
    if (target && target.data.uuid !== user.data.uuid) actors.push({ ...actor(target, false), missed: res.missed, hurt: res.hurt, failed: res.failed });
    const species = userActor.species;
    const id = findTimeline(move.name, species) ? move.name : "generic_move";
    return runActionEffect(id, { move, actors }, species);
  } catch {
    return 0;
  }
}

/** Dano por status/efeito (DamageInstruction.kt): status → `damage_<efeito>` → `generic_damage`. */
export function playDamageEffect(pokemon: EffectPokemon, effectId: string | undefined): number {
  try {
    const actors: EffectActor[] = [{ ...actor(pokemon, true) }];
    // DamageInstruction: o Showdown não diz se o veneno é tóxico; consulta o status do Pokémon.
    const statusId = effectId === "psn" && String(pokemon.data.status) === "tox" ? "tox" : effectId;
    const status = statusId ? STATUS_EFFECTS[statusId] : undefined;
    const id = status && findTimeline(status) ? status : effectId && findTimeline(`damage_${effectId}`) ? `damage_${effectId}` : "generic_damage";
    return runActionEffect(id, { actors });
  } catch {
    return 0;
  }
}

/** Desmaio: `battle_faint` do poser (pose de batalha) ou `faint`. Devolve se tocou alguma. */
export function playFaintEffect(pokemon: EffectPokemon): boolean {
  const e = pokemon.visual ?? pokemon.entity;
  try {
    if (!e?.isValid) return false;
    const id = pickAnimation(namedAnimationsOf(e, pokemon.visualSpecies ?? toSpeciesId(pokemon.data.species)), ["faint"]);
    if (!id) return false;
    e.playAnimation(id);
    return true;
  } catch {
    return false;
  }
}
