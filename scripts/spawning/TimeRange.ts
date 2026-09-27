import { world } from "@minecraft/server";

/**
 * Faixas inteiras inclusivas (IntRanges.kt do Cobblemon). Aceita "0-2,5", "4", números e nomes
 * registrados (TimeRange.timeRanges / MoonPhaseRange.moonPhaseRanges).
 */
export class IntRanges {
  ranges: [number, number][] = [];
  constructor(...ranges: [min: number, max: number][]) {
    this.ranges = ranges;
  }
  contains(value: number): boolean {
    return this.ranges.some(r => value >= r[0] && value <= r[1]);
  }
  /** "0-2,5" → [[0,2],[5,5]]; undefined se não der para interpretar. */
  static parse(text: string | number): [number, number][] | undefined {
    if (typeof text === "number") return Number.isFinite(text) ? [[text, text]] : undefined;
    const out: [number, number][] = [];
    for (const part of String(text).split(",")) {
      const m = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(part);
      if (!m) return undefined;
      const a = Number(m[1]);
      const b = m[2] !== undefined ? Number(m[2]) : a;
      out.push([Math.min(a, b), Math.max(a, b)]);
    }
    return out.length ? out : undefined;
  }
}

export class TimeRange extends IntRanges {
  /** Verifica a hora atual do mundo (0–23999). */
  validate(): boolean {
    return this.contains(world.getTimeOfDay());
  }
}

/** TimeRange.timeRanges do Cobblemon 1.8.2 (faixas inclusivas). */
export const TimeRanges: Record<string, TimeRange> = {
  "any": new TimeRange([0, 23999]),
  "day": new TimeRange([23460, 23999], [0, 12541]),
  "night": new TimeRange([12542, 23459]),
  "morning": new TimeRange([23000, 23999], [0, 4999]),
  "noon": new TimeRange([5000, 6999]),
  "afternoon": new TimeRange([7000, 12999]),
  "evening": new TimeRange([13000, 16999]),
  "midnight": new TimeRange([17000, 18999]),
  "predawn": new TimeRange([19000, 22999]),
  "dawn": new TimeRange([22300, 23999], [0, 166]),
  "dusk": new TimeRange([11834, 13701]),
  "twilight": new TimeRange([11834, 13701], [22300, 23999], [0, 166]),
};

/** MoonPhaseRange.moonPhaseRanges do Cobblemon (0 = cheia ... 4 = nova; mesma numeração do Bedrock). */
export const MoonPhaseRanges: Record<string, IntRanges> = {
  "crescent": new IntRanges([3, 3], [5, 5]),
  "gibbous": new IntRanges([1, 1], [7, 7]),
  "full": new IntRanges([0, 0]),
  "new": new IntRanges([4, 4]),
  "quarter": new IntRanges([2, 2], [6, 6]),
  "waxing": new IntRanges([5, 5], [7, 7]),
  "waning": new IntRanges([1, 1], [3, 3]),
};

const parsedTime = new Map<string, IntRanges | null>();

/** Verdadeiro se `time` (0–23999) está na faixa: nome ("night") ou lista "a-b,c-d". */
export function timeInRange(range: string, time: number): boolean {
  const named = TimeRanges[range.toLowerCase()];
  if (named) return named.contains(time);
  let parsed = parsedTime.get(range);
  if (parsed === undefined) {
    const list = IntRanges.parse(range);
    parsed = list ? new IntRanges(...list) : null;
    parsedTime.set(range, parsed);
  }
  return parsed ? parsed.contains(time) : false;
}

/** Verdadeiro se a fase `phase` (0–7) está em `range` (número, "5-7", "0,4" ou nome). */
export function moonPhaseInRange(range: string | number, phase: number): boolean {
  if (typeof range === "string") {
    const named = MoonPhaseRanges[range.toLowerCase()];
    if (named) return named.contains(phase);
  }
  const list = IntRanges.parse(range);
  return list ? new IntRanges(...list).contains(phase) : false;
}
