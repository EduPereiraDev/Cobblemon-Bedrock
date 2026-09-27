/**
 * BattleFormat.kt: tipo de batalha (singles/doubles/triples/multi) e regras. O adaptador (showdown.ts) só usa
 * o gameType; as regras ficam registradas no formato (ex.: "Wild Alpha" do Cobblemon, que o @pkmn/sim não tem).
 */
export class BattleFormat {
  constructor(
    public mod = "cobblemon",
    public battleType: BattleType = BattleTypes.SINGLES,
    public ruleSet = new Set<string>(),
    public gen = 9
  ) { }

  //Presets
  static get GEN_9_SINGLES() {
    return new BattleFormat("base", BattleTypes.SINGLES, new Set<string>([BattleRules.OBTAINABLE, BattleRules.PAST, BattleRules.UNOBTAINABLE]))
  }

  static get GEN_9_DOUBLES() {
    return new BattleFormat("cobblemon", BattleTypes.DOUBLES, new Set<string>([BattleRules.OBTAINABLE]))
  }

  static get GEN_9_TRIPLES() {
    return new BattleFormat("cobblemon", BattleTypes.TRIPLES, new Set<string>([BattleRules.OBTAINABLE]))
  }

  static get GEN_9_MULTI() {
    return new BattleFormat("cobblemon", BattleTypes.MULTI, new Set<string>([BattleRules.OBTAINABLE]))
  }

  /** Formato pelo nome do tipo ("singles", "doubles", "triples", "multi"). */
  static fromName(name: string): BattleFormat {
    switch (name.toLowerCase()) {
      case "doubles": return BattleFormat.GEN_9_DOUBLES;
      case "triples": return BattleFormat.GEN_9_TRIPLES;
      case "multi": return BattleFormat.GEN_9_MULTI;
      default: return BattleFormat.GEN_9_SINGLES;
    }
  }

  /** Cópia com uma regra a mais (BattleFormat.setBattleRules). */
  withRule(rule: string): BattleFormat {
    return new BattleFormat(this.mod, this.battleType, new Set([...this.ruleSet, rule]), this.gen);
  }

  //We cant just use json.stringify() cuz gametype and ruleset
  toFormatJSON() {
    return JSON.stringify({ mod: this.mod, gameType: this.battleType.name, gen: `${this.gen}`, ruleset: [...this.ruleSet], effectType: "Format" });
  }
}

export interface BattleType {
  name: string
  actorsPerSide: number
  slotsPerActor: number
}

export const BattleTypes = {
  SINGLES: { name: "singles", actorsPerSide: 1, slotsPerActor: 1 } as BattleType,
  DOUBLES: { name: "doubles", actorsPerSide: 1, slotsPerActor: 2 } as BattleType,
  TRIPLES: { name: "triples", actorsPerSide: 1, slotsPerActor: 3 } as BattleType,
  MULTI: { name: "multi", actorsPerSide: 2, slotsPerActor: 1 } as BattleType,
}

/** BattleRules.kt */
export const BattleRules = {
  OBTAINABLE: "Obtainable",
  PAST: "+Past",
  UNOBTAINABLE: "+Unobtainable",
  BAG_CLAUSE: "Bag Clause",
  TEAM_PREVIEW: "Team Preview",
  ENDLESS_BATTLE_CLAUSE: "Endless Battle Clause",
  CANCEL_MOD: "Cancel Mod",
  SLEEP_CLAUSE: "Sleep Clause Mod",
  HP_PERCENTAGE_MOD: "HP Percentage Mod",
  WILD_ALPHA: "Wild Alpha",
}
