/**
 * Fórmula de captura, port de `pokeball/catching/calculators/CobblemonCaptureCalculator.kt` +
 * `CriticalCaptureProvider.kt` + `PokedexStatusCaptureInfluencer.kt` (Cobblemon 1.8.2).
 *
 * Tudo aqui é puro (sem API do Minecraft) e segue a aritmética do Kotlin: contas em Float (32 bits,
 * `Math.fround`) e divisões inteiras onde o Kotlin divide Int por Int.
 */
import { Behavior, BehaviorMutators } from "./CatchRateModifier";

export interface CaptureContext {
  numberOfShakes: number,
  /** Grafia antiga do port (lida por language/index.ts). */
  isSucessfulCapture: boolean,
  isCriticalCapture: boolean
}

/** CaptureContext.successful(critical). */
export function successfulCapture(critical = false): CaptureContext {
  return critical
    ? { numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true }
    : { numberOfShakes: 4, isSucessfulCapture: true, isCriticalCapture: false };
}

const f = Math.fround;

/** Bônus de status: sono/congelado 2,5; paralisia/queimadura/veneno 1,5. */
export function statusCaptureBonus(status: string | undefined): number {
  switch (status) {
    case "slp": case "frz": return 2.5;
    case "par": case "brn": case "psn": case "tox": return 1.5;
    default: return 1;
  }
}

/** Bônus de nível baixo: `max((36 - 2 × nível) / 10, 1)` com divisão inteira (Int no Kotlin). */
export function lowLevelCaptureBonus(level: number): number {
  if (level >= 13) return 1;
  return Math.max(Math.trunc((36 - 2 * Math.trunc(level)) / 10), 1);
}

export interface CaptureRateInput {
  maxHealth: number;
  currentHealth: number;
  /** Catch rate da forma ativa (`pokemon.form.catchRate`). */
  catchRate: number;
  /** O alvo está numa batalha (`target.battleId != null`): 1× em batalha, 0,5× fora. */
  inBattle: boolean;
  /** Status persistente no formato do Showdown ("slp", "par"...). */
  status?: string;
  level: number;
  /** `isValid ? modifier.value : 1`. */
  ballBonus: number;
  /** `modifier.behavior` (a Poké Ball comum multiplica). */
  behavior?: Behavior;
  /** Maior nível do lado oposto ao jogador (findHighestThrowerLevel); undefined = sem penalidade. */
  highestThrowerLevel?: number;
  /** config.maxPokemonLevel (100). */
  maxPokemonLevel?: number;
}

/** Taxa de captura modificada (antes da captura crítica e das sacudidas). */
export function computeModifiedCatchRate(input: CaptureRateInput): number {
  const darkGrass = 1;
  const inBattleModifier = input.inBattle ? 1 : 0.5;
  const behavior = input.behavior ?? BehaviorMutators.MULTIPLY;
  const base = f(f(f(f(f(3 * input.maxHealth) - f(2 * input.currentHealth)) * darkGrass) * f(input.catchRate)) * inBattleModifier);
  let modified = f(behavior(base, f(input.ballBonus)) / f(3 * input.maxHealth));
  modified = f(modified * f(statusCaptureBonus(input.status) * lowLevelCaptureBonus(input.level)));
  const highest = input.highestThrowerLevel;
  if (highest !== undefined && highest < input.level) {
    // (nível - maior) / (maxPokemonLevel / 2): Int / Int.
    const halfMax = Math.trunc((input.maxPokemonLevel ?? 100) / 2);
    const steps = halfMax > 0 ? Math.trunc((input.level - highest) / halfMax) : 0;
    modified = f(modified * Math.max(0.1, Math.min(1, 1 - steps)));
  }
  return modified;
}

/** `(65536 / (255 / taxa)^0.1875).roundToInt()`: limiar de cada sacudida (sorteio em 0..65536). */
export function shakeProbability(modifiedCatchRate: number): number {
  const ratio = f(255 / f(modifiedCatchRate));
  const value = f(65536 / f(Math.pow(ratio, 0.1875)));
  if (Number.isNaN(value)) return 0;
  return Math.round(value);
}

/** Chance de passar numa sacudida (`Random.nextInt(65537) < limiar`). */
export function shakeSuccessChance(modifiedCatchRate: number): number {
  return Math.min(Math.max(shakeProbability(modifiedCatchRate), 0), 65537) / 65537;
}

/** Chance de sucesso de uma captura não crítica: as 4 sacudidas passam. */
export function captureSuccessChance(modifiedCatchRate: number): number {
  return Math.pow(shakeSuccessChance(modifiedCatchRate), 4);
}

/** Multiplicador de captura crítica pelo número de espécies capturadas (CriticalCaptureProvider). */
export function criticalCaughtMultiplier(caughtCount: number): number {
  if (caughtCount <= 30) return 0;
  if (caughtCount <= 150) return 0.5;
  if (caughtCount <= 300) return 1;
  if (caughtCount <= 450) return 1.5;
  if (caughtCount <= 600) return 2;
  return 2.5;
}

/** Limiar `c` da captura crítica: crítica se `Random.nextInt(256) < c`. */
export function criticalCaptureThreshold(modifiedCatchRate: number, caughtCount: number): number {
  const b = f(f(modifiedCatchRate) * criticalCaughtMultiplier(caughtCount));
  // ToDo do Cobblemon: ×2 com o Catching Charm.
  return Math.round(f(f(b * 1) / 6));
}

/** Chance de captura crítica. */
export function criticalCaptureChance(modifiedCatchRate: number, caughtCount: number): number {
  return Math.min(Math.max(criticalCaptureThreshold(modifiedCatchRate, caughtCount), 0), 256) / 256;
}

/** `Random.nextInt(bound)`: inteiro em [0, bound). */
export type IntRandom = (bound: number) => number;
export const defaultIntRandom: IntRandom = bound => Math.floor(Math.random() * bound);

/** Sorteia se a captura será crítica. */
export function rollCriticalCapture(modifiedCatchRate: number, caughtCount: number, random: IntRandom = defaultIntRandom): boolean {
  return random(256) < criticalCaptureThreshold(modifiedCatchRate, caughtCount);
}

/** Laço de sacudidas do CobblemonCaptureCalculator (a crítica para depois da primeira). */
export function rollShakes(modifiedCatchRate: number, critical: boolean, random: IntRandom = defaultIntRandom): CaptureContext {
  const threshold = shakeProbability(modifiedCatchRate);
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (random(65537) < threshold) shakes++;
    if (i === 0 && critical)
      return { numberOfShakes: 1, isSucessfulCapture: shakes === 1, isCriticalCapture: true };
  }
  return { numberOfShakes: shakes, isSucessfulCapture: shakes === 4, isCriticalCapture: false };
}

/**
 * PokedexStatusCaptureInfluencer: captura bem-sucedida de uma forma que o jogador já tem (OWNED)
 * vira crítica de uma sacudida.
 */
export function influenceCapture(context: CaptureContext, alreadyOwnedForm: boolean): CaptureContext {
  if (!context.isSucessfulCapture || !alreadyOwnedForm) return context;
  return { numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true };
}

export interface CaptureRollInput extends CaptureRateInput {
  guaranteed: boolean;
  /** Espécies capturadas na Pokédex do jogador (CaughtCount); undefined = arremessador não é jogador. */
  caughtCount?: number;
  /** A forma alvo já está como OWNED na Pokédex do jogador. */
  alreadyOwnedForm: boolean;
}

/** processCapture completo, com o sorteio injetável (testes). */
export function calculateCapture(input: CaptureRollInput, random: IntRandom = defaultIntRandom): CaptureContext {
  if (input.guaranteed) return influenceCapture(successfulCapture(), input.alreadyOwnedForm);
  const modified = computeModifiedCatchRate(input);
  const critical = input.caughtCount !== undefined ? rollCriticalCapture(modified, input.caughtCount, random) : false;
  const result = rollShakes(modified, critical, random);
  // A crítica retorna direto no Kotlin (sem passar pelo influencer).
  return result.isCriticalCapture ? result : influenceCapture(result, input.alreadyOwnedForm);
}
