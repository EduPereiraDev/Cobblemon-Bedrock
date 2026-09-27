// Learnset e montagem de moveset do Cobblemon: K/api/pokemon/moves/Learnset.kt,
// K/api/pokemon/moves/LearnsetQuery.kt, K/api/moves/DefaultMovesetBuilder.kt, K/api/moves/MoveSelector.kt
// e D/moveset_builders/{wild,alpha}.json.
import { Dex, toID } from "../showdown";

/** Golpes de uma espécie/forma separados pela origem (prefixo no JSON da espécie). */
export interface Learnset {
  /** "N:golpe" → nível → golpes (ordem do JSON, sem repetição dentro do nível). */
  levelUpMoves: Map<number, string[]>;
  tmMoves: string[];
  eggMoves: string[];
  tutorMoves: string[];
  legacyMoves: string[];
  specialMoves: string[];
  formChangeMoves: string[];
}

export type LearnsetSource = "level" | "tm" | "egg" | "tutor" | "legacy" | "special" | "form_change";

const PREFIXES: Record<string, keyof Omit<Learnset, "levelUpMoves">> = {
  tm: "tmMoves", egg: "eggMoves", tutor: "tutorMoves", legacy: "legacyMoves", special: "specialMoves",
  form_change: "formChangeMoves",
};

/** Só golpes conhecidos pelo motor de batalha entram (Moves.getByName do Cobblemon). */
export function isKnownMove(move: string): boolean {
  const data = Dex.moves.get(move);
  return !!data && data.exists;
}

/** Interpreta a lista de golpes do JSON da espécie ("1:tackle", "tm:toxic", "egg:...", ...). */
export function parseLearnset(entries: readonly string[] = []): Learnset {
  const learnset: Learnset = {
    levelUpMoves: new Map(), tmMoves: [], eggMoves: [], tutorMoves: [], legacyMoves: [], specialMoves: [],
    formChangeMoves: [],
  };
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator === -1) continue;
    const prefix = entry.slice(0, separator);
    const move = toID(entry.slice(separator + 1));
    if (!move || !isKnownMove(move)) continue;
    const list = PREFIXES[prefix];
    if (list) {
      if (!learnset[list].includes(move)) learnset[list].push(move);
      continue;
    }
    if (!/^\d+$/.test(prefix)) continue;
    const level = parseInt(prefix);
    const levelMoves = learnset.levelUpMoves.get(level) ?? [];
    if (!levelMoves.includes(move)) levelMoves.push(move);
    learnset.levelUpMoves.set(level, levelMoves);
  }
  return learnset;
}

/** Learnset.getLevelUpMovesUpTo: golpes por nível até `level`, em ordem crescente de nível, sem repetição. */
export function getLevelUpMovesUpTo(learnset: Learnset, level: number): string[] {
  const output: string[] = [];
  for (const moveLevel of [...learnset.levelUpMoves.keys()].filter(x => x <= level).sort((a, b) => a - b))
    for (const move of learnset.levelUpMoves.get(moveLevel)!)
      if (!output.includes(move)) output.push(move);
  return output;
}

/** Nível em que o golpe é aprendido (o menor), ou undefined. */
export function getLevelOfMove(learnset: Learnset, move: string): number | undefined {
  let found: number | undefined;
  for (const [level, moves] of learnset.levelUpMoves)
    if (moves.includes(move) && (found === undefined || level < found)) found = level;
  return found;
}

/** Todas as origens pelas quais o golpe pode ser aprendido. */
export function getLearnsetSources(learnset: Learnset, move: string): LearnsetSource[] {
  move = toID(move);
  const sources: LearnsetSource[] = [];
  if ([...learnset.levelUpMoves.values()].some(moves => moves.includes(move))) sources.push("level");
  if (learnset.tmMoves.includes(move)) sources.push("tm");
  if (learnset.eggMoves.includes(move)) sources.push("egg");
  if (learnset.tutorMoves.includes(move)) sources.push("tutor");
  if (learnset.legacyMoves.includes(move)) sources.push("legacy");
  if (learnset.specialMoves.includes(move)) sources.push("special");
  if (learnset.formChangeMoves.includes(move)) sources.push("form_change");
  return sources;
}

/**
 * LearnsetQuery.ANY (padrão, usado por /teach e pela troca de forma) ou LEGAL (sem legacy/special).
 */
export function canLearn(learnset: Learnset, move: string, query: "any" | "legal" = "any"): boolean {
  const sources = getLearnsetSources(learnset, move);
  if (query === "legal") return sources.some(source => source !== "legacy" && source !== "special");
  return sources.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Moveset builders

/** D/move_weights.json (peso padrão 50). Tera Blast tem peso 0 e nunca é sorteado. */
const MOVE_WEIGHTS: Record<string, number> = { focusblast: 50, terablast: 0 };
const DEFAULT_MOVE_WEIGHT = 50;

function moveWeight(move: string): number {
  return MOVE_WEIGHTS[move] ?? DEFAULT_MOVE_WEIGHT;
}

/** CollectionUtils.weightedSelection (retorna undefined se todos os pesos forem 0). */
function weightedSelection(moves: string[], random: () => number): string | undefined {
  let weightSum = 0;
  for (const move of moves) weightSum += Math.max(0, moveWeight(move));
  const chosen = random() * weightSum;
  weightSum = 0;
  for (const move of moves) {
    const weight = moveWeight(move);
    if (weight > 0) {
      weightSum += weight;
      if (weightSum >= chosen) return move;
    }
  }
  return undefined;
}

type Category = "Physical" | "Special" | "Status";
function category(move: string): Category {
  return Dex.moves.get(move).category as Category;
}

/** Contexto de um seletor: learnset, nível e atributos base da forma (para last_suitable_offensive). */
export interface MoveSelectorContext {
  learnset: Learnset;
  level: number;
  /** Ataque e Ataque Especial base da forma. */
  baseAttack: number;
  baseSpecialAttack: number;
  types: string[];
  random: () => number;
}

type MoveSelector = (ctx: MoveSelectorContext, chosen: Set<string>) => string | undefined;

/** Percorre os níveis do mais alto (≤ nível) para o mais baixo e sorteia no primeiro que tiver candidatos. */
function lastLevelUp(filter: (move: string, ctx: MoveSelectorContext) => boolean): MoveSelector {
  return (ctx, chosen) => {
    const levels = [...ctx.learnset.levelUpMoves.keys()].filter(level => level <= ctx.level).sort((a, b) => b - a);
    for (const level of levels) {
      const moves = ctx.learnset.levelUpMoves.get(level)!.filter(move => filter(move, ctx) && !chosen.has(move));
      if (moves.length > 0) return weightedSelection(moves, ctx.random);
    }
    return undefined;
  };
}

function fromPool(pool: (ctx: MoveSelectorContext) => string[], filter: (move: string, ctx: MoveSelectorContext) => boolean = () => true): MoveSelector {
  return (ctx, chosen) => weightedSelection(pool(ctx).filter(move => !chosen.has(move) && filter(move, ctx)), ctx.random);
}

const levelUpPool = (ctx: MoveSelectorContext) => getLevelUpMovesUpTo(ctx.learnset, ctx.level);
const notLevelUp = (list: (ctx: MoveSelectorContext) => string[]) => (ctx: MoveSelectorContext) => {
  const levelMoves = getLevelUpMovesUpTo(ctx.learnset, ctx.level);
  return list(ctx).filter(move => !levelMoves.includes(move));
};
const isStab = (move: string, ctx: MoveSelectorContext) => ctx.types.includes(toID(Dex.moves.get(move).type));

/** MoveSelector.selectors */
export const MOVE_SELECTORS: Record<string, MoveSelector> = {
  none: () => undefined,
  last_levelup: lastLevelUp(() => true),
  last_offensive: lastLevelUp(move => category(move) !== "Status"),
  last_suitable_offensive: lastLevelUp((move, ctx) => {
    const suitable: Category[] = ctx.baseAttack > ctx.baseSpecialAttack ? ["Physical"]
      : ctx.baseSpecialAttack > ctx.baseAttack ? ["Special"] : ["Physical", "Special"];
    return suitable.includes(category(move));
  }),
  last_status: lastLevelUp(move => category(move) === "Status"),
  levelup: fromPool(levelUpPool),
  stab: fromPool(levelUpPool, (move, ctx) => isStab(move, ctx) && category(move) !== "Status"),
  stab_physical: fromPool(levelUpPool, (move, ctx) => isStab(move, ctx) && category(move) === "Physical"),
  stab_special: fromPool(levelUpPool, (move, ctx) => isStab(move, ctx) && category(move) === "Special"),
  physical: fromPool(levelUpPool, move => category(move) === "Physical"),
  special: fromPool(levelUpPool, move => category(move) === "Special"),
  offensive: fromPool(levelUpPool, move => category(move) !== "Status"),
  status: fromPool(levelUpPool, move => category(move) === "Status"),
  tm: fromPool(notLevelUp(ctx => ctx.learnset.tmMoves)),
  stab_tm: fromPool(notLevelUp(ctx => ctx.learnset.tmMoves), isStab),
  egg: fromPool(notLevelUp(ctx => ctx.learnset.eggMoves)),
};

/** D/moveset_builders/*.json */
export const MOVESET_BUILDERS: Record<string, string[][]> = {
  wild: [["last_offensive", "last_levelup"], ["last_levelup"], ["last_levelup"], ["last_levelup"]],
  alpha: [
    ["last_suitable_offensive", "last_offensive", "last_levelup"],
    ["last_offensive", "last_levelup"],
    ["tm", "last_levelup"],
    ["tm", "last_levelup"],
  ],
};

/** Golpe usado quando nenhum seletor encontra nada (Moves.getExceptional). */
export const EXCEPTIONAL_MOVE = "tackle";

/**
 * DefaultMovesetBuilder.build: para cada slot, o primeiro seletor que devolver um golpe vence.
 * Retorna os ids dos golpes (até 4), na ordem dos slots.
 */
export function buildMoveset(builder: string | string[][], ctx: MoveSelectorContext): string[] {
  const slots = typeof builder === "string" ? (MOVESET_BUILDERS[builder] ?? MOVESET_BUILDERS.wild) : builder;
  const chosen = new Set<string>();
  for (const selectors of slots) {
    for (const name of selectors) {
      const move = MOVE_SELECTORS[name]?.(ctx, chosen);
      if (move !== undefined) {
        chosen.add(move);
        break;
      }
    }
  }
  if (chosen.size === 0) chosen.add(EXCEPTIONAL_MOVE);
  return [...chosen];
}
