/**
 * Frente "comparadores": sinal de comparador da Healing Machine (#143) e do Metronome (#74), como no Cobblemon 1.8.2.
 * Sem imports: o importador (tools/importer/comparadores.ts) também lê este arquivo.
 *
 * Técnica (a mesma da panela, #40): o bloco NÃO tem `minecraft:redstone_consumer` e as permutações ligam
 * `minecraft:redstone_producer` com a força do Java só nas faces com comparador encostado e com a entrada virada para o
 * bloco (estado `cobblemon:comparator_faces`, máscara N=1, L=2, S=4, O=8). O script grava os estados.
 *
 * Healing Machine: o limite de 65.536 permutações vale para o mundo inteiro (o pack já soma ~17 mil) e a máquina já
 * tem 512 combinações; um estado de força (11 valores) × máscara (16) daria 90.112. O sinal do Java
 * (HealingMachineBlockEntity.updateRedstoneSignal: `((carga / máx) * 100).toInt() / 10`, no máximo 10) é derivado do
 * medidor que já existe (`cobblemon:charge` = floor(15 × carga / máx)) mais 1 bit (`cobblemon:comparator_high`): cada
 * nível c do medidor cobre carga/máx em [c/15, (c+1)/15), onde o sinal é floor(2c/3) ou floor(2c/3) + 1.
 * Acréscimo: 2 × 16 = ×32 (512 → 16.384).
 *
 * Metronome (ActivatableDecorationBlock.getAnalogOutputSignal): 4 quando `active`, 0 senão. Acréscimo: ×16 (8 → 128).
 */

export const HEALING_MACHINE = "cobblemon:healing_machine";
export const METRONOME = "cobblemon:metronome";
/** Máscara das faces com comparador lendo o bloco (N=1, L=2, S=4, O=8). */
export const COMPARATOR_FACES_STATE = "cobblemon:comparator_faces";
/** Healing Machine: sinal = base do medidor + 1. */
export const HEALER_HIGH_STATE = "cobblemon:comparator_high";
/** Medidor da Healing Machine (0..15), gravado por HealingMachineComponent.writeCharge. */
export const HEALER_CHARGE_STATE = "cobblemon:charge";
export const HEALER_CHARGE_STATE_MAX = 15;
/** HealingMachineBlockEntity.MAX_REDSTONE_SIGNAL. */
export const HEALER_MAX_SIGNAL = 10;
/** ActivatableDecorationBlock: "forced 4". */
export const METRONOME_SIGNAL = 4;
export const METRONOME_ACTIVE_STATE = "cobblemon:active";
/** Formato mínimo do `minecraft:redstone_producer`. */
export const PRODUCER_FORMAT = "1.21.120";

export const FACE_BITS: ReadonlyArray<readonly ["north" | "east" | "south" | "west", number]> = [["north", 1], ["east", 2], ["south", 4], ["west", 8]];

export function facesOf(mask: number): ("north" | "east" | "south" | "west")[] {
  return FACE_BITS.filter(([, bit]) => (mask & bit) !== 0).map(([f]) => f);
}

/**
 * HealingMachineBlockEntity.updateRedstoneSignal (`toInt()` trunca). O ramo de carga infinita do Java não retorna e cai
 * no mesmo cálculo; no port a carga infinita já é `máx` (readCharge), o que dá 10. A carga do port é double (o Java usa
 * Float): o cálculo é em double, com a mesma fração do medidor, para os dois concordarem nas fronteiras exatas.
 */
export function healerSignal(charge: number, maxCharge: number): number {
  if (!(maxCharge > 0) || !(charge > 0)) return 0;
  const percent = Math.trunc(Math.min(maxCharge, charge) / maxCharge * 100);
  return Math.max(0, Math.min(HEALER_MAX_SIGNAL, Math.trunc(percent / 10)));
}

/** Nível do medidor como HealingMachineComponent.writeCharge o grava. */
export function healerMeterLevel(charge: number, maxCharge: number, infinite: boolean): number {
  if (infinite) return HEALER_CHARGE_STATE_MAX;
  if (!(maxCharge > 0)) return 0;
  const value = Math.min(maxCharge, Math.max(0, charge));
  return Math.max(0, Math.min(HEALER_CHARGE_STATE_MAX, Math.floor(value / maxCharge * HEALER_CHARGE_STATE_MAX)));
}

/** Menor sinal possível com o medidor em `level`: floor(10 × level / 15). */
export function healerMeterBase(level: number): number {
  return Math.min(HEALER_MAX_SIGNAL, Math.floor((2 * level) / 3));
}

/** Força que as permutações emitem para (medidor, bit). */
export function healerPower(level: number, high: boolean): number {
  return Math.min(HEALER_MAX_SIGNAL, healerMeterBase(level) + (high ? 1 : 0));
}

/** Bit que faz a permutação emitir `signal` com o medidor em `level` (o mais próximo quando não dá exato). */
export function healerHigh(level: number, signal: number): boolean {
  return signal > healerMeterBase(level) && healerPower(level, true) > healerMeterBase(level);
}

export function metronomeSignal(active: boolean): number {
  return active ? METRONOME_SIGNAL : 0;
}

export interface ComparatorOut { mask: number; high: boolean }

/** Estados de saída: sem sinal ou sem comparador, tudo zerado (o Java só entrega o sinal analógico ao comparador). */
export function healerStates(level: number, signal: number, mask: number): ComparatorOut {
  const high = healerHigh(level, signal);
  if (mask <= 0 || healerPower(level, high) <= 0) return { mask: 0, high: false };
  return { mask: mask & 15, high };
}

export function metronomeStates(active: boolean, mask: number): ComparatorOut {
  return { mask: active && mask > 0 ? mask & 15 : 0, high: false };
}

// ---------------------------------------------------------------------------------------------
// Permutações (importador)

export interface ProducerPermutation { power: number; mask: number; condition: string }

/**
 * Healing Machine: uma permutação por (força 1..10, máscara 1..15), com a condição sobre os pares (medidor, bit)
 * que dão aquela força. 150 permutações.
 */
export function healerPermutations(): ProducerPermutation[] {
  const byPower = new Map<number, string[]>();
  for (let level = 0; level <= HEALER_CHARGE_STATE_MAX; level++) {
    for (const high of [false, true]) {
      const power = healerPower(level, high);
      if (power <= 0) continue;
      const term = `(q.block_state('${HEALER_CHARGE_STATE}') == ${level} && ${high ? "" : "!"}q.block_state('${HEALER_HIGH_STATE}'))`;
      byPower.set(power, [...(byPower.get(power) ?? []), term]);
    }
  }
  const out: ProducerPermutation[] = [];
  for (const [power, terms] of [...byPower].sort((a, b) => a[0] - b[0])) {
    for (let mask = 1; mask <= 15; mask++) {
      out.push({ power, mask, condition: `q.block_state('${COMPARATOR_FACES_STATE}') == ${mask} && (${terms.join(" || ")})` });
    }
  }
  return out;
}

/** Metronome: força 4 com `active` em cada máscara 1..15. */
export function metronomePermutations(): ProducerPermutation[] {
  const out: ProducerPermutation[] = [];
  for (let mask = 1; mask <= 15; mask++) {
    out.push({ power: METRONOME_SIGNAL, mask, condition: `q.block_state('${METRONOME_ACTIVE_STATE}') && q.block_state('${COMPARATOR_FACES_STATE}') == ${mask}` });
  }
  return out;
}
