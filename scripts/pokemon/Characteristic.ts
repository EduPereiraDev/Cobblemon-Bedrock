/**
 * Characteristic e a cor da cauda do Smeargle (Cobblemon 1.7.0: `pokemon/Characteristic.kt` +
 * `CHARACTERISTIC_RAINBOW_ASPECT` em `pokemon/aspects/PokemonAspects.kt`, ligado por `behaviour.characteristicRainbow`).
 *
 * Characteristic: o maior IV, começando a busca num atributo que depende do UUID (`abs(uuid.hashCode()) % 6`), e o
 * resto do IV por 5. A cor vem do par (atributo aumentado pela natureza, atributo da characteristic). A tabela é a do
 * Kotlin, inclusive "rainbow-light-blue" (os resolvers do Cobblemon usam "rainbow-light_blue", então essa cor não
 * aparece nem no Cobblemon).
 */
import type { StatsTable } from "../showdown";

type Stat = keyof StatsTable;
/** Ordem de Stats.PERMANENT (HP, Attack, Defence, Sp. Atk, Sp. Def, Speed). */
export const STAT_ORDER: Stat[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** java.util.UUID.hashCode para "xxxxxxxx-xxxx-..." (undefined se não for UUID). */
export function javaUuidHash(uuid: string): number | undefined {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return undefined;
  const most = BigInt.asIntN(64, BigInt(`0x${hex.slice(0, 16)}`));
  const least = BigInt.asIntN(64, BigInt(`0x${hex.slice(16)}`));
  const hilo = most ^ least;
  return Number(BigInt.asIntN(32, hilo >> 32n) ^ BigInt.asIntN(32, hilo));
}

/** Characteristic.calculate: atributo relevante e mod. */
export function characteristicOf(ivs: StatsTable, uuid: string): { stat: Stat; mod: number } {
  const hash = javaUuidHash(uuid) ?? 0;
  const startAt = Math.abs(hash) % STAT_ORDER.length;
  let best: Stat | undefined;
  for (let i = 0; i < STAT_ORDER.length; i++) {
    const stat = STAT_ORDER[(startAt + i) % STAT_ORDER.length];
    if (best === undefined || ivs[stat] > ivs[best]) best = stat;
  }
  const stat = best ?? "hp";
  return { stat, mod: (ivs[stat] ?? 0) % 5 };
}

const pairs: [string, [Stat | null, Stat][]][] = [
  ["rainbow-red", [["atk", "atk"], ["atk", "hp"], [null, "atk"], ["spe", "def"], ["def", "spe"]]],
  ["rainbow-orange", [["atk", "def"], ["def", "atk"]]],
  ["rainbow-yellow", [["def", "def"], ["def", "hp"], [null, "def"], ["atk", "spd"], ["spd", "atk"]]],
  ["rainbow-lime", [["def", "spd"], ["spd", "def"]]],
  ["rainbow-green", [["spd", "spd"], ["spd", "hp"], [null, "spd"], ["def", "spa"], ["spa", "def"]]],
  ["rainbow-cyan", [["spd", "spa"], ["spa", "spd"]]],
  ["rainbow-blue", [["spa", "spa"], ["spa", "hp"], [null, "spa"], ["spd", "spe"], ["spe", "spd"]]],
  ["rainbow-purple", [["spa", "spe"], ["spe", "spa"]]],
  ["rainbow-magenta", [["spe", "spe"], ["spe", "hp"], [null, "spe"], ["spa", "atk"], ["atk", "spa"]]],
  ["rainbow-pink", [["spe", "atk"], ["atk", "spe"]]],
  ["rainbow-light-blue", [[null, "hp"]]],
];

/** calculateColourAspect: `increased` = atributo que a natureza aumenta (null nas neutras). */
export function rainbowAspect(increased: Stat | null, characteristic: Stat): string | undefined {
  for (const [aspect, list] of pairs)
    if (list.some(([a, b]) => a === increased && b === characteristic)) return aspect;
  return undefined;
}

export const RAINBOW_PREFIX = "rainbow-";
