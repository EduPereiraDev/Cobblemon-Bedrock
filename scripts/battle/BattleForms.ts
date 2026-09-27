/**
 * Frente msd-fase1: troca visual de forma e gimmick na batalha (docs/pesquisa/9-extensao-mega-showdown.md §4.2 item 5
 * e §5.2 Fase 1). Handler genérico: `detailschange`/`-formechange` (inclusive as de `-mega`, `-primal` e `-burst`, que
 * vêm junto de um `detailschange`), `-terastallize` e Dynamax (`-start`/`-end`) → aspects da forma → variante da
 * entidade, e `cobblemon:gimmick` para Tera/Dynamax.
 *
 * Como o MSD (AspectUtils + `battle_end_revert`), mas sem gravar nada: o estado fica só em memória e é aplicado na
 * entidade por `pokemon/DisplayOverride.ts`. Por isso o revert é automático:
 *   - fim da batalha: `PokemonBattle.end` tira a batalha do `battleMap` antes de sincronizar as entidades, e o estado
 *     de uma batalha que não existe mais é descartado → a entidade volta à forma dos dados;
 *   - troca: quem entra perde forma temporária (`-formechange`) e Dynamax, como no Showdown; forma permanente da
 *     batalha (`detailschange`: Mega, Primal, Ultra) e Tera continuam, como no jogo;
 *   - desmaio: a entidade some; nada foi gravado.
 *
 * O Cobblemon 1.8.2 sozinho não troca o visual (só posta os eventos): isto só liga com a extensão Mega Showdown
 * (`enableBattleForms`, chamado por `extensions/megaShowdown`). Sem ela, o base fica igual.
 */
import { Entity, system } from "@minecraft/server";
import { Dex, toID } from "../showdown";
import { getFormByName, getFormForAspects, getSpeciesData, toSpeciesId } from "../speciesData";
import type { FormData } from "../speciesData";
import { CobblemonEvents } from "../events/CobblemonEvents";
import { gimmickValue } from "../entity/GimmickProperty";
import { applyDisplayOverride, applyGimmickProperty, setDisplayOverrideProvider } from "../pokemon/DisplayOverride";
import { applyEntitySize } from "../entity/Size";
import { syncAspectBits } from "../entity/AspectSync";
import { GIMMICK_NONE, GIMMICK_PROPERTY } from "../entity/GimmickProperty";
import { resolveVariant } from "../../generated/scripts/variants";
import { PokemonData } from "../Pokemon";
import type { DisplayOverride, DisplaySubject } from "../pokemon/DisplayOverride";
import { battleEntityReleaseHooks, battleMap } from "./PokemonBattle";
import type { PokemonBattle } from "./PokemonBattle";
import type { ActivePokemon } from "./ActivePokemon";

/** Estado visual de batalha de um Pokémon (por UUID). */
export interface BattleVisualState {
  battleId: string;
  /** Espécie/forma do Showdown anunciada ("Charizard-Mega-X"). */
  forme?: string;
  /** `-formechange` (desfeita na troca). */
  temporary?: boolean;
  /** Tipo Tera ("Fire", "Stellar"). */
  tera?: string;
  dynamax?: boolean;
  gigantamax?: boolean;
  /**
   * Frente msd-fase2: forma permanente já anunciada (`detailschange`) mas ainda não mostrada: o efeito do MSD
   * (partícula/pausa) troca o modelo no meio da animação (`apply_after`), por `revealPendingForme`.
   */
  pendingForme?: string;
}

const states = new Map<string, BattleVisualState>();
let enabled = false;

/** Estado atual (testes e depuração). */
export function battleVisualState(uuid: string): BattleVisualState | undefined {
  return states.get(uuid);
}

/** A batalha do estado ainda existe? `lookup` é trocável nos testes. */
let battleExists: (battleId: string) => boolean = (battleId) => {
  const battle = battleMap.get(battleId);
  return !!battle && !battle.ended;
};

/** Só para os testes. */
export function setBattleLookupForTests(fn: ((battleId: string) => boolean) | undefined): void {
  battleExists = fn ?? ((battleId) => {
    const battle = battleMap.get(battleId);
    return !!battle && !battle.ended;
  });
}

function formAspects(form: FormData | undefined): string[] {
  return form?.aspects ?? [];
}

/**
 * Aspects da forma do Showdown `forme` para o Pokémon: tira os aspects da forma atual dos dados e põe os da forma
 * nova (FormData.aspects: "Charizard-Mega-X" → forma "Mega-X" → `mega_x`). Undefined = forma desconhecida.
 */
export function aspectsForForme(data: Pick<DisplaySubject, "species" | "aspects">, forme: string): string[] | undefined {
  const species = getSpeciesData(data.species);
  if (!species) return undefined;
  const current = getFormForAspects(species, data.aspects);
  const base = data.aspects.filter(aspect => !formAspects(current).includes(aspect));
  const wanted = toID(forme);
  if (!wanted || wanted === toID(species.name)) return base;
  const dexForme = Dex.species.get(forme);
  const form = (species.forms ?? []).find(f => toID(`${species.name}-${f.name}`) === wanted)
    ?? (dexForme.exists && dexForme.forme ? getFormByName(species, dexForme.forme) : undefined);
  if (!form) return undefined;
  return [...base, ...formAspects(form).filter(aspect => !base.includes(aspect))];
}

/** Exibição do Pokémon pelo estado de batalha (provedor do DisplayOverride). */
export function displayFor(data: DisplaySubject): DisplayOverride | undefined {
  const state = states.get(data.uuid);
  if (!state) return undefined;
  if (!battleExists(state.battleId)) {
    states.delete(data.uuid);
    return undefined;
  }
  let aspects: string[] | undefined;
  if (state.forme) aspects = aspectsForForme(data, state.forme);
  if (state.dynamax && state.gigantamax) {
    const species = getSpeciesData(data.species);
    const gmax = species ? getFormByName(species, "Gmax") : undefined;
    if (gmax?.aspects?.length) {
      const from = aspects ?? data.aspects;
      aspects = [...from, ...gmax.aspects.filter(aspect => !from.includes(aspect))];
    }
  }
  const gimmick = gimmickValue(state);
  if (!aspects && !gimmick) return undefined;
  return { aspects, gimmick };
}

/** Aplica o estado na entidade em campo (a de exibição de Illusion/Transform não muda). */
function reapply(active: ActivePokemon): void {
  try {
    if (active.pending || !active.entity?.isValid) return;
    applyDisplayOverride(active.entity, active.data);
    // Frente msd-fase2: tamanho (hitbox/escala) da forma mostrada (entity/Size.ts lê o DisplayOverride).
    applyEntitySize(active.entity, active.data);
  }
  catch { }
}

/**
 * Frente msd-fase2: decide se uma forma permanente anunciada espera o efeito do MSD para aparecer (Mega, Primal,
 * Ultra). Sem portão (sem a extensão), a troca é imediata, como na Fase 1.
 */
export type FormeRevealGate = (battle: PokemonBattle, active: ActivePokemon, forme: string) => boolean;
let formeGate: FormeRevealGate | undefined;
/** Se o efeito não revelar a forma, ela aparece sozinha depois disto (o `-mega` vem logo depois do `detailschange`). */
export const PENDING_FORME_FALLBACK_TICKS = 20 * 15;

export function setFormeRevealGate(gate: FormeRevealGate | undefined): void {
  formeGate = gate;
}

/** Mostra a forma pendente do Pokémon (chamado pelo efeito do MSD no `apply_after`). Devolve se havia forma. */
export function revealPendingForme(battle: PokemonBattle, active: ActivePokemon): boolean {
  const state = states.get(active.data.uuid);
  if (!state?.pendingForme || state.battleId !== battle.battleId || !battleExists(battle.battleId)) return false;
  state.forme = state.pendingForme;
  state.temporary = undefined;
  state.pendingForme = undefined;
  reapply(active);
  return true;
}

function prune(): void {
  for (const [uuid, state] of states) if (!battleExists(state.battleId)) states.delete(uuid);
}

/** Atualiza o estado do Pokémon e reaplica na entidade. */
export function updateVisualState(battle: PokemonBattle, active: ActivePokemon, change: (state: BattleVisualState) => void): BattleVisualState {
  const uuid = active.data.uuid;
  let state = states.get(uuid);
  if (!state || state.battleId !== battle.battleId) state = { battleId: battle.battleId };
  change(state);
  states.set(uuid, state);
  prune();
  reapply(active);
  return state;
}

function onFormeChange(battle: PokemonBattle, active: ActivePokemon, forme: string, permanent: boolean): void {
  // Frente msd-fase2: Mega/Primal/Ultra esperam o efeito (o modelo troca no meio da animação, como no MSD).
  if (permanent && formeGate?.(battle, active, forme)) {
    updateVisualState(battle, active, state => { state.pendingForme = forme; });
    try { system.runTimeout(() => revealPendingForme(battle, active), PENDING_FORME_FALLBACK_TICKS); } catch { }
    return;
  }
  updateVisualState(battle, active, state => {
    const species = getSpeciesData(active.data.species);
    // Voltou à espécie base (`-formechange` de volta, ex.: Aegislash): sem forma de batalha.
    if (species && toID(forme) === toID(species.name) && !getFormForAspects(species, active.data.aspects)) {
      state.forme = undefined;
      state.temporary = undefined;
      return;
    }
    state.forme = forme;
    state.temporary = !permanent;
  });
}

function onTerastallize(battle: PokemonBattle, active: ActivePokemon, type: string): void {
  updateVisualState(battle, active, state => { state.tera = type; });
}

function onDynamax(battle: PokemonBattle, active: ActivePokemon, started: boolean, gigantamax: boolean): void {
  updateVisualState(battle, active, state => {
    state.dynamax = started || undefined;
    state.gigantamax = (started && gigantamax) || undefined;
  });
}

function onSwitchIn(battle: PokemonBattle, uuid: string): void {
  const state = states.get(uuid);
  if (!state || state.battleId !== battle.battleId) return;
  if (state.temporary) {
    state.forme = undefined;
    state.temporary = undefined;
  }
  state.dynamax = undefined;
  state.gigantamax = undefined;
}

/** Liga o handler (idempotente). Chamado pela extensão Mega Showdown no worldLoad. */
export function enableBattleForms(): boolean {
  if (enabled) return false;
  enabled = true;
  CobblemonEvents.on("FORME_CHANGE", onFormeChange);
  CobblemonEvents.on("TERASTALLIZATION", onTerastallize);
  CobblemonEvents.on("DYNAMAX", onDynamax);
  CobblemonEvents.on("POKEMON_SWITCHED_IN", onSwitchIn);
  setDisplayOverrideProvider(displayFor);
  battleEntityReleaseHooks.push(resetReleasedEntity);
  return true;
}

/**
 * Frente msd-fase2 (B5): no fim da batalha, entidade de quem tinha forma/gimmick de batalha volta ao visual dos dados.
 * Com o jogador online a sincronia do fim já faz isso; sem ele (saiu no meio), só este gancho do `cleanUpEntities`
 * alcança a entidade, que senão ficaria Mega/tingida e seria reaproveitada pelo próximo envio.
 */
export function resetReleasedEntity(entity: Entity): boolean {
  let uuid: unknown;
  try { uuid = entity.getDynamicProperty("uuid"); } catch { return false; }
  if (typeof uuid !== "string") return false;
  const state = states.get(uuid);
  if (state && battleExists(state.battleId)) return false;
  let gimmick: unknown;
  try { gimmick = entity.getProperty(GIMMICK_PROPERTY); } catch { }
  if (!state && (gimmick === undefined || gimmick === GIMMICK_NONE)) return false;
  states.delete(uuid);
  try {
    const raw = entity.getDynamicProperty("data");
    if (typeof raw === "string") {
      const data = PokemonData.getFromJson(raw);
      entity.setProperty("cobblemon:variant", resolveVariant(toSpeciesId(data.species), data.aspects));
      syncAspectBits(entity, data.aspects);
      applyEntitySize(entity, data);
    }
  }
  catch { }
  applyGimmickProperty(entity, GIMMICK_NONE);
  return true;
}

/** Só para os testes: desliga e limpa. */
export function disableBattleFormsForTests(): void {
  if (enabled) {
    CobblemonEvents.off("FORME_CHANGE", onFormeChange);
    CobblemonEvents.off("TERASTALLIZATION", onTerastallize);
    CobblemonEvents.off("DYNAMAX", onDynamax);
    CobblemonEvents.off("POKEMON_SWITCHED_IN", onSwitchIn);
  }
  enabled = false;
  states.clear();
  setDisplayOverrideProvider(undefined);
  formeGate = undefined;
  const hook = battleEntityReleaseHooks.indexOf(resetReleasedEntity);
  if (hook >= 0) battleEntityReleaseHooks.splice(hook, 1);
}
