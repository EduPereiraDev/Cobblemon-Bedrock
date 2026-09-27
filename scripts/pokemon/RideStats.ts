/**
 * Atributos de montaria do Cobblemon 1.8.2 (`api/riding/stats/RidingStat.kt`, `Pokemon.getRideStat/addRideBoosts`,
 * `RidingBehaviourSettings.calculate`, `item/AprijuiceItem.kt`).
 *
 * - Cada estilo de montaria da forma (LAND/AIR/LIQUID) tem, por atributo (ACCELERATION, SKILL, SPEED, STAMINA, JUMP),
 *   uma faixa "min-max" (0–100). Sem bônus o valor é o início da faixa.
 * - Ride boosts (Aprijuice temperada no Campfire Pot) somam pontos por atributo, guardados no Pokémon
 *   (`PokemonData.rideBoosts`), limitados a `getMaxRideBoost` = maior largura de faixa entre os estilos.
 * - Valor efetivo por estilo: `min(início + bônus, fim)`.
 * - O port converte o valor efetivo nos componentes do Bedrock com as mesmas fórmulas do importador
 *   (`tools/importer/entities.ts: rideStyleInfo`): velocidade (movement/flying_speed/underwater_movement), pulo e
 *   fôlego do voo. `scripts/entity/Riding.ts` aplica ao montar e a cada troca de estilo.
 */
import type { Entity, EntityAttributeComponent, EntityFlyingSpeedComponent, Player } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { getRideInfo } from "../entity/EntityData";
import type { RideInfo, RideStyle, RideStyleInfo } from "../entity/EntityData";
import { toSpeciesId } from "../speciesData";

/** Som em loop da montaria (RideSoundSettings; campo `sounds` do importador). */
export interface RideSoundData { sound: string; passengers: boolean; others: boolean; volume: string; pitch: string }
/** RideStyleInfo com os campos novos do importador (frente dados-ui): fim das faixas e sons. */
export type RideStyleData = RideStyleInfo & { max?: Record<string, number>; sounds?: RideSoundData[] };

/** Ordem do enum RidingStat (e o sabor de cada um: o tempero da Aprijuice que o aumenta). */
export const RIDING_STATS = ["ACCELERATION", "SKILL", "SPEED", "STAMINA", "JUMP"] as const;
export type RidingStat = (typeof RIDING_STATS)[number];
export const RIDING_STAT_FLAVOUR: Record<RidingStat, string> = {
  ACCELERATION: "SPICY", SKILL: "DRY", SPEED: "SWEET", STAMINA: "SOUR", JUMP: "BITTER",
};
/** Ordem de exibição do StatsWidget/summary (velocidade, aceleração, habilidade, pulo, fôlego). */
export const RIDING_STATS_DISPLAY: readonly RidingStat[] = ["SPEED", "ACCELERATION", "SKILL", "JUMP", "STAMINA"];
export const RIDE_STYLES: readonly RideStyle[] = ["LAND", "AIR", "LIQUID"];

export function isRidingStat(name: string): name is RidingStat {
  return (RIDING_STATS as readonly string[]).includes(name.toUpperCase());
}

type RideSubject = Pick<PokemonData, "species" | "aspects" | "rideBoosts"> & { getFormName?(): string };

function formNameOf(pokemon: RideSubject): string {
  try {
    const name = pokemon.getFormName?.() ?? "";
    return name === "Normal" ? "" : name;
  }
  catch { return ""; }
}

/** RidingProperties da forma (undefined = não montável). */
export function rideInfoOf(pokemon: RideSubject): RideInfo | undefined {
  try { return getRideInfo(toSpeciesId(pokemon.species), formNameOf(pokemon)); }
  catch { return undefined; }
}

/** Faixa [início, fim] do atributo no estilo (dados antigos sem `max`: fim = início). */
export function statRange(style: RideStyleInfo, stat: RidingStat): [number, number] {
  const min = style.stats?.[stat] ?? 0;
  const max = Math.max(min, (style as RideStyleData).max?.[stat] ?? min);
  return [min, max];
}

function styleList(info: RideInfo | undefined): RideStyleInfo[] {
  return info ? RIDE_STYLES.map(style => info.styles[style]).filter((s): s is RideStyleInfo => !!s) : [];
}

/** Pokemon.getBaseRideStat: maior início de faixa entre os estilos. */
export function getBaseRideStat(pokemon: RideSubject, stat: RidingStat, info = rideInfoOf(pokemon)): number {
  const styles = styleList(info);
  return styles.length ? Math.max(...styles.map(style => statRange(style, stat)[0])) : 0;
}

/** Pokemon.getMaxRideBoost: a faixa mais larga (fim − início) entre os estilos. */
export function getMaxRideBoost(pokemon: RideSubject, stat: RidingStat, info = rideInfoOf(pokemon)): number {
  const styles = styleList(info);
  return styles.length ? Math.max(...styles.map(style => { const [min, max] = statRange(style, stat); return max - min; })) : 0;
}

export function getRideBoost(pokemon: RideSubject, stat: RidingStat): number {
  const value = pokemon.rideBoosts?.[stat];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Pokemon.canApplyRideBoost: subir só abaixo do máximo; descer só acima de 0. */
export function canApplyRideBoost(pokemon: RideSubject, stat: RidingStat, decreases = false, info = rideInfoOf(pokemon)): boolean {
  const current = getRideBoost(pokemon, stat);
  return decreases ? current > 0 : current < getMaxRideBoost(pokemon, stat, info);
}

/** Pokemon.addRideBoosts: soma os bônus que ainda cabem (limitados a 0..máx). Devolve true se algo mudou. */
export function addRideBoosts(pokemon: RideSubject, boosts: Partial<Record<string, number>>, info = rideInfoOf(pokemon)): boolean {
  let changed = false;
  for (const [name, amount] of Object.entries(boosts)) {
    const stat = name.toUpperCase();
    if (!isRidingStat(stat) || typeof amount !== "number" || !amount) continue;
    if (!canApplyRideBoost(pokemon, stat, amount < 0, info)) continue;
    const max = getMaxRideBoost(pokemon, stat, info);
    pokemon.rideBoosts = { ...(pokemon.rideBoosts ?? {}), [stat]: Math.min(max, Math.max(0, getRideBoost(pokemon, stat) + amount)) };
    changed = true;
  }
  return changed;
}

/** Pokemon.setRideBoost (comando/edição). */
export function setRideBoost(pokemon: RideSubject, stat: RidingStat, value: number, info = rideInfoOf(pokemon)) {
  pokemon.rideBoosts = { ...(pokemon.rideBoosts ?? {}), [stat]: Math.min(getMaxRideBoost(pokemon, stat, info), Math.max(0, value)) };
}

/** Pokemon.getRideStat → RidingBehaviourSettings.calculate: `min(início + bônus, fim)`; 0 se o estilo não existe. */
export function getRideStat(pokemon: RideSubject, style: RideStyle, stat: RidingStat, info = rideInfoOf(pokemon)): number {
  const settings = info?.styles[style];
  if (!settings) return 0;
  const [min, max] = statRange(settings, stat);
  return Math.min(min + getRideBoost(pokemon, stat), max);
}

/** Todos os atributos de um estilo com os bônus. */
export function effectiveRideStats(pokemon: RideSubject, style: RideStyle, info = rideInfoOf(pokemon)): Record<RidingStat, number> {
  return Object.fromEntries(RIDING_STATS.map(stat => [stat, getRideStat(pokemon, style, stat, info)])) as Record<RidingStat, number>;
}

/**
 * RidingStatBoostCriterion (`max_ride_stats`: stat "all", valor 0): um atributo "basta" quando não dá mais para
 * subir o bônus. allMax = todos; anyMax = algum.
 */
export function rideBoostCompletion(pokemon: RideSubject, info = rideInfoOf(pokemon)): { allMax: boolean; anyMax: boolean } {
  const done = RIDING_STATS.map(stat => !canApplyRideBoost(pokemon, stat, false, info));
  return { allMax: done.every(Boolean), anyMax: done.some(Boolean) };
}

// ---------------------------------------------------------------------------------------------
// Conversão para os componentes do Bedrock (mesmas fórmulas de tools/importer/entities.ts: rideStyleInfo)

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (max: number, min: number, s: number) => min + ((max - min) / 100) * s;

function landSpeed(speed: number): number { return round(clamp((lerp(1.2, 0.1, speed) * 20) / 43, 0.15, 0.45)); }
function landJump(jump: number): number { return round(clamp(lerp(1.6, 0.2, jump) * 0.625, 0.4, 1.0)); }
function airSpeed(key: string, speed: number): number {
  const fast = key.endsWith("/jet") || key.endsWith("/rocket");
  return round(clamp((lerp(20, 4, speed) * (fast ? 1.5 : 1)) / 200, 0.02, 0.15));
}
function airStamina(stamina: number): number { return round(Math.max(1, lerp(80, 0, stamina))); }
function liquidSpeed(speed: number): number { return round(clamp(lerp(24, 2, speed) / 80, 0.03, 0.25)); }

export interface RideComponentValues {
  /** movement / flying_speed / underwater_movement do grupo do estilo. */
  speed: number;
  /** horse.jump_strength (terra; 0 = sem pulo) — o Bedrock não deixa mudar por script. */
  jump: number;
  /** Segundos de fôlego do voo (0 = infinito). */
  stamina: number;
}

/**
 * Valores do Bedrock para o estilo com os atributos efetivos. Onde o importador não usou o atributo (terra sem
 * sprint anda no getWalkSpeed da espécie, já convertido pelo importador com `walkMovementValue`; montaria sem pulo;
 * fôlego infinito), o valor gerado é mantido.
 */
export function rideComponentValues(styleName: RideStyle, style: RideStyleInfo, stats: Record<RidingStat, number>): RideComponentValues {
  const base = style.stats ?? {};
  if (styleName === "LAND") {
    const sprints = style.speed === landSpeed(base.SPEED ?? 0);
    const jumps = style.jump > 0 && style.jump === landJump(base.JUMP ?? 0);
    return { speed: sprints ? landSpeed(stats.SPEED) : style.speed, jump: jumps ? landJump(stats.JUMP) : style.jump, stamina: style.stamina };
  }
  if (styleName === "AIR") {
    const matches = style.speed === airSpeed(style.key, base.SPEED ?? 0);
    return {
      speed: matches ? airSpeed(style.key, stats.SPEED) : style.speed,
      jump: style.jump,
      stamina: style.stamina === 0 ? 0 : airStamina(stats.STAMINA),
    };
  }
  const matches = style.speed === liquidSpeed(base.SPEED ?? 0);
  return { speed: matches ? liquidSpeed(stats.SPEED) : style.speed, jump: 0, stamina: style.stamina };
}

/** Valores do estilo atual do Pokémon (com os bônus), ou undefined se o estilo não existe na forma. */
export function rideValuesFor(pokemon: RideSubject, styleName: RideStyle, info = rideInfoOf(pokemon)): RideComponentValues | undefined {
  const style = info?.styles[styleName];
  if (!style) return undefined;
  return rideComponentValues(styleName, style, effectiveRideStats(pokemon, styleName, info));
}

/** Aplica a velocidade do estilo na entidade montada (depois dos grupos de componente do evento de estilo). */
export function applyRideValues(entity: Entity, styleName: RideStyle, values: RideComponentValues) {
  try {
    (entity.getComponent("minecraft:movement") as EntityAttributeComponent | undefined)?.setCurrentValue(values.speed);
    if (styleName === "AIR") {
      const flying = entity.getComponent("minecraft:flying_speed") as EntityFlyingSpeedComponent | undefined;
      if (flying) flying.value = values.speed;
    }
    if (styleName === "LIQUID")
      (entity.getComponent("minecraft:underwater_movement") as EntityAttributeComponent | undefined)?.setCurrentValue(values.speed);
  }
  catch { /* entidade sem o componente neste estilo */ }
}

// ---------------------------------------------------------------------------------------------
// Aprijuice (AprijuiceItem: PokemonSelectingItem só quando tem RIDE_BOOST)

/** Bônus gravados na Aprijuice pelo Campfire Pot (`cobblemon:food_data` ou a lore do prato). */
export type RideBoostReader = (stack: { typeId: string }) => Record<string, number> | undefined;

export function isAprijuice(typeId: string | undefined): boolean {
  return !!typeId && /^cobblemon:aprijuice_/.test(typeId);
}

/** AprijuiceItem.canUseOnPokemon: tem bônus e algum ainda cabe. */
export function canUseAprijuice(pokemon: RideSubject, boosts: Record<string, number> | undefined): boolean {
  if (!boosts) return false;
  const entries = Object.entries(boosts).filter(([stat, value]) => isRidingStat(stat) && value);
  if (!entries.length) return false;
  const info = rideInfoOf(pokemon);
  return entries.some(([stat, value]) => canApplyRideBoost(pokemon, stat.toUpperCase() as RidingStat, value < 0, info));
}

/** Resultado para a mensagem do jogador. */
export type AprijuiceOutcome = "applied" | "no_boosts" | "cannot_apply";

/** AprijuiceItem.applyToPokemon: soma os bônus (quem chama gasta o item e alimenta o Pokémon). */
export function applyAprijuice(pokemon: RideSubject, boosts: Record<string, number> | undefined): AprijuiceOutcome {
  if (!boosts || !Object.values(boosts).some(Boolean)) return "no_boosts";
  if (!canUseAprijuice(pokemon, boosts)) return "cannot_apply";
  addRideBoosts(pokemon, boosts);
  return "applied";
}

/** Linha de exibição de um atributo ("Speed 45 (+10) / 75"). */
export function describeRideStat(pokemon: RideSubject, style: RideStyle, stat: RidingStat, info = rideInfoOf(pokemon)): { value: number; min: number; max: number; boost: number } | undefined {
  const settings = info?.styles[style];
  if (!settings) return undefined;
  const [min, max] = statRange(settings, stat);
  return { value: getRideStat(pokemon, style, stat, info), min, max, boost: getRideBoost(pokemon, stat) };
}

/** Nome traduzível do estilo e do controlador ("cobblemon.ui.ride_style.air.bird"). */
export function rideStyleLangKey(style: RideStyle, key?: string): string {
  const base = `cobblemon.ui.ride_style.${style.toLowerCase()}`;
  const controller = key?.replace(/^cobblemon:[a-z]+\//, "");
  if (!controller) return base;
  // O lang do 1.8.2 só nomeia estes; os demais (glider, helicopter, burst, vehicle, minekart) ficam no estilo.
  const known: Record<string, string> = { bird: "air.bird", hover: "air.hover", jet: "air.jet", rocket: "air.rocket", horse: "land.horse", minekart: "land.cart", boat: "liquid.boat", dolphin: "liquid.dolphin", submarine: "liquid.submarine" };
  return known[controller] ? `cobblemon.ui.ride_style.${known[controller]}` : base;
}

/** Quem montou: o dono (para `max_ride_stats`). */
export type RideOwnerCheck = (player: Player, entity: Entity) => boolean;
