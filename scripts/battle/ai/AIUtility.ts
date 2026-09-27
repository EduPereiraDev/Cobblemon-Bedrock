/**
 * Tabelas da StrongBattleAI (battles/ai/strongBattleAI/AIUtility.kt do Cobblemon 1.8.2), copiadas como estão,
 * inclusive os erros de digitação do original ("sleeppoweder", "slearsmog", "lightingrod", "posion"): a paridade
 * é com o comportamento do Cobblemon, não com o que ele pretendia.
 *
 * Tipos com o nome do Showdown ("Fire"); atributos com as chaves do Showdown (atk, def, spa, spd, spe,
 * accuracy, evasion).
 */

export type AIStat = "atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion";
export const AI_STATS: AIStat[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];

const TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic",
  "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"] as const;

/** Linha = tipo atacante, coluna = tipo defensor, na ordem de TYPES (AIUtility.typeEffectiveness). */
const CHART: number[][] = [
  /* Normal   */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 0, 1, 1, 0.5, 1],
  /* Fire     */[1, 0.5, 0.5, 1, 2, 2, 1, 1, 1, 1, 1, 2, 0.5, 1, 0.5, 1, 2, 1],
  /* Water    */[1, 2, 0.5, 1, 0.5, 1, 1, 1, 2, 1, 1, 1, 2, 1, 0.5, 1, 1, 1],
  /* Electric */[1, 1, 2, 0.5, 0.5, 1, 1, 1, 0, 2, 1, 1, 1, 1, 0.5, 1, 1, 1],
  /* Grass    */[1, 0.5, 2, 1, 0.5, 1, 1, 0.5, 2, 0.5, 1, 0.5, 2, 1, 0.5, 1, 0.5, 1],
  /* Ice      */[1, 0.5, 0.5, 1, 2, 0.5, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1, 0.5, 1],
  /* Fighting */[2, 1, 1, 1, 1, 2, 1, 0.5, 1, 0.5, 0.5, 0.5, 2, 0, 1, 2, 2, 0.5],
  /* Poison   */[1, 1, 1, 1, 2, 1, 1, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 1, 1, 0, 2],
  /* Ground   */[1, 2, 1, 2, 0.5, 1, 1, 2, 1, 0, 1, 0.5, 2, 1, 1, 1, 2, 1],
  /* Flying   */[1, 1, 1, 0.5, 2, 1, 2, 1, 1, 1, 1, 2, 0.5, 1, 1, 1, 0.5, 1],
  /* Psychic  */[1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 0.5, 1, 1, 1, 1, 0, 0.5, 1],
  /* Bug      */[1, 0.5, 1, 1, 2, 1, 0.5, 0.5, 1, 0.5, 2, 1, 1, 0.5, 1, 2, 0.5, 0.5],
  /* Rock     */[1, 2, 1, 1, 1, 2, 0.5, 1, 0.5, 2, 1, 2, 1, 1, 1, 1, 0.5, 1],
  /* Ghost    */[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 1, 0.5, 1, 1],
  /* Dragon   */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 0.5, 0],
  /* Dark     */[1, 1, 1, 1, 1, 1, 0.5, 1, 1, 1, 2, 1, 1, 2, 1, 0.5, 1, 0.5],
  /* Steel    */[1, 0.5, 0.5, 0.5, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 0.5, 2],
  /* Fairy    */[1, 0.5, 1, 1, 1, 1, 2, 0.5, 1, 1, 1, 1, 1, 1, 2, 2, 0.5, 1],
];

/** AIUtility.getDamageMultiplier: tipo fora da tabela (ex.: "Stellar", "???") vale 1. */
export function getDamageMultiplier(attackerType: string, defenderType: string): number {
  const row = TYPES.indexOf(attackerType as typeof TYPES[number]);
  const column = TYPES.indexOf(defenderType as typeof TYPES[number]);
  return row < 0 || column < 0 ? 1 : CHART[row][column];
}

/** Golpes de múltiplos acertos (mínimo, máximo). "watershuriken" aparece duas vezes no original: vale a última (3, 3). */
export const multiHitMoves: Record<string, [number, number]> = {
  armthrust: [2, 5], barrage: [2, 5], bonerush: [2, 5], bulletseed: [2, 5], cometpunch: [2, 5], doubleslap: [2, 5],
  furyattack: [2, 5], furyswipes: [2, 5], iciclespear: [2, 5], pinmissile: [2, 5], rockblast: [2, 5], scaleshot: [2, 5],
  spikecannon: [2, 5], tailslap: [2, 5],
  bonemerang: [2, 2], doublehit: [2, 2], doubleironbash: [2, 2], doublekick: [2, 2], dragondarts: [2, 2], dualchop: [2, 2],
  dualwingbeat: [2, 2], geargrind: [2, 2], twinbeam: [2, 2], twineedle: [2, 2], surgingstrikes: [3, 3], tripledive: [3, 3],
  watershuriken: [3, 3],
  tripleaxel: [1, 3], triplekick: [1, 3], populationbomb: [1, 10],
};

/** Golpe → status que ele causa (nomes do Showdown; "cursed" e "leech" são nomes próprios do Cobblemon). */
export const statusMoves: Record<string, string> = {
  willowisp: "brn", scald: "brn", scorchingsands: "brn",
  glare: "par", nuzzle: "par", stunspore: "par", thunderwave: "par",
  darkvoid: "slp", hypnosis: "slp", lovelykiss: "slp", relicsong: "slp", sing: "slp", sleeppower: "slp", spore: "slp", yawn: "slp",
  chatter: "confusion", confuseray: "confusion", dynamicpunch: "confusion", flatter: "confusion", supersonic: "confusion",
  swagger: "confusion", sweetkiss: "confusion", teeterdance: "confusion",
  poisongas: "psn", poisonpowder: "psn", toxic: "tox", toxicthread: "psn",
  curse: "cursed", leechseed: "leech",
};

/** Status persistentes (Statuses.getStatus(x) is PersistentStatus). */
export const PERSISTENT_STATUSES = new Set(["brn", "par", "slp", "frz", "psn", "tox"]);

export const boostFromMoves: Record<string, Partial<Record<AIStat, number>>> = {
  bellydrum: { atk: 6 },
  bulkup: { atk: 1, def: 1 },
  clangoroussoul: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  coil: { atk: 1, def: 1, accuracy: 1 },
  dragondance: { atk: 1, spe: 1 },
  extremeevoboost: { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 },
  clangoroussoulblaze: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  filletaway: { atk: 2, spa: 2, spe: 2 },
  honeclaws: { atk: 1, accuracy: 1 },
  noretreat: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  shellsmash: { atk: 2, def: -1, spa: 2, spd: -1, spe: 2 },
  shiftgear: { atk: 1, spe: 2 },
  swordsdance: { atk: 2 },
  tidyup: { atk: 1, spe: 1 },
  victorydance: { atk: 1, def: 1, spe: 1 },
  acidarmor: { def: 2 },
  barrier: { def: 2 },
  cottonguard: { def: 3 },
  defensecurl: { def: 1 },
  irondefense: { def: 2 },
  shelter: { def: 2, evasion: 1 },
  stockpile: { def: 1, spd: 1 },
  stuffcheeks: { def: 2 },
  amnesia: { spd: 2 },
  calmmind: { spa: 1, spd: 1 },
  geomancy: { spa: 2, spd: 2, spe: 2 },
  nastyplot: { spa: 2 },
  quiverdance: { spa: 1, spd: 1, spe: 1 },
  tailglow: { spa: 3 },
  takeheart: { spa: 1, spd: 1 },
  agility: { spe: 2 },
  autotomize: { spe: 2 },
  rockpolish: { spe: 2 },
  curse: { atk: 1, def: 1, spe: -1 },
  minimize: { evasion: 2 },
};

export const entryHazards = ["spikes", "stealthrock", "stickyweb", "toxicspikes"];
export const antiHazardsMoves = ["rapidspin", "defog", "tidyup"];
export const antiBoostMoves = ["slearsmog", "haze"];
export const pivotMoves = ["uturn", "flipturn", "partingshot", "batonpass", "shedtail", "voltswitch", "teleport"];
/** "Setup" no original são as telas/campo, não os golpes de aumento de atributo. */
export const setupMoves = new Set(["tailwind", "trickroom", "auroraveil", "lightscreen", "reflect"]);
export const selfRecoveryMoves = ["healorder", "milkdrink", "recover", "rest", "roost", "slackoff", "softboiled"];
export const weatherSetupMoves: Record<string, string> = {
  chillyreception: "Snow", hail: "Hail", raindance: "RainDance", sandstorm: "Sandstorm", snowscape: "Snow", sunnyday: "SunnyDay",
};
export const accuracyLoweringMoves = new Set(["flash", "kinesis", "leaftornado", "mirrorshot", "mudbomb", "mudslap", "muddywater",
  "nightgaze", "octazooka", "sandattack", "secretpower", "smokescreen"]);
export const protectMoves = new Set(["protect", "banefulbunker", "obstruct", "craftyshield", "detect", "quickguard", "spikyshield", "silktrap"]);

/** Status → (tipos imunes, habilidades imunes). Tipos em minúsculas como no original. */
const statusImmunityMap: Record<string, [string[], string[]]> = {
  brn: [["fire"], ["waterbubble", "waterveil", "flareboost", "guts", "magicguard"]],
  par: [["electric"], ["limber", "guts"]],
  slp: [["grass"], ["insomnia", "sweetveil"]],
  confusion: [["fire"], ["owntempo", "oblivious"]],
  psn: [["poison", "steel"], ["immunity", "poisonheal", "guts", "magicguard"]],
  tox: [["poison", "steel"], ["immunity", "poisonheal", "guts", "magicguard"]],
  cursed: [["ghost"], ["magicguard"]],
  leech: [["grass"], ["liquidooze", "magicguard"]],
};

/** AIUtility.canAffectWithStatus: status sem entrada ("custom") sempre afeta. */
export function canAffectWithStatus(status: string, types: readonly string[], ability?: string): boolean {
  const entry = statusImmunityMap[status];
  if (!entry) return true;
  const [typing, abilities] = entry;
  return !types.some(type => typing.includes(type.toLowerCase())) && !abilities.includes(ability ?? "");
}

/** Habilidade → tipo que ela anula ("lightingrod" com o erro de digitação do original: Lightning Rod não entra). */
export const typeImmuneAbilities: Record<string, string> = {
  lightingrod: "Electric", flashfire: "Fire", levitate: "Ground", sapsipper: "Grass", motordrive: "Electric",
  stormdrain: "Water", voltabsorb: "Electric", waterabsorb: "Water", immunity: "Poison", eartheater: "Ground",
};
