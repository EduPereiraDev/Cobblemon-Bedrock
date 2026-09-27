import { Dex } from "../../showdown";
import type { SimBattle, SimPokemon, SimSide } from "../../showdown";
import { simPokemonUUID } from "../../showdown";
import type { BattleActor } from "../BattleActor";
import type { RequestData } from "../Request";
import { requestPokemonUUID } from "../Request";
import { getSimBattle } from "../SimQueries";
import { BattleAI, InBattleMove, buildChoice, canBeUsed, isFaintedCondition, mustBeUsed, parseMoveset, switchTo } from "./BattleAI";
import { chooseRandomMove, randomSlotChoice } from "./RandomBattleAI";
import { ActiveTracker, TrackerActor, TrackerPokemon, activeOf } from "./ActiveTracker";
import { moveChoice } from "./SimTargets";
import {
  AIStat, PERSISTENT_STATUSES, accuracyLoweringMoves, antiBoostMoves, antiHazardsMoves, boostFromMoves, canAffectWithStatus,
  entryHazards, getDamageMultiplier, multiHitMoves, pivotMoves, protectMoves, selfRecoveryMoves, setupMoves, statusMoves,
  typeImmuneAbilities, weatherSetupMoves,
} from "./AIUtility";

/**
 * Port fiel da StrongBattleAI.kt do Cobblemon 1.8.2 (986 linhas; baseada no "Pokemon Trainer Tournament Simulator"),
 * com o rastreador (ActiveTracker.kt) e as tabelas (AIUtility.kt). A ordem das regras, os limiares, os coeficientes,
 * os sorteios da habilidade (skill 0–5) e as esquisitices do original foram mantidos, para o NPC decidir como no Java:
 *
 *  - `firstTurn` só volta a false com Fake Out ou quando a IA cai no golpe aleatório do fim de `choose`; como o
 *    caminho normal termina em `findAndUseMostDamagingMove`, a troca voluntária quase nunca acontece (igual ao Java).
 *  - O multiplicador de clima compara com "sunny"/"raining", ids que o Cobblemon nunca produz ("sunnyday"/"raindance"):
 *    não tem efeito, como no original.
 *  - A queimadura que reduz o dano é a do *alvo*; Whirlwind sempre vale 0 (precedência do `||` do original).
 *  - Golpes de status valem ~2 de dano na estimativa (poder 0 + 2), então `considerInflictingStatus` quase nunca passa
 *    no filtro "dano >= 80% do HP"; `considerAntiBoost` só reage a Haze por um caminho morto ("slearsmog", `!isNotEmpty`).
 *  - +1 de boost conta como ×2 em `statEstimationActive`.
 *  - A 2–5 acertos vale 2; Triple Kick/Axel valem 5; Population Bomb 7.
 *
 * Fonte dos dados: o simulador em processo (boosts, status, voláteis, condições de lado e campo), no lugar dos
 * "contextos" que o Cobblemon monta a partir do protocolo. As decisões por posição saem na ordem do Cobblemon
 * (uma chamada por Pokémon ativo) e viram a escolha do Showdown ("move 2 +1, switch 3").
 */
export class StrongBattleAI implements BattleAI {
  readonly skill: number;
  private readonly speedTierCoefficient = 4.0;
  private trickRoomCoefficient = 1.0;
  private readonly typeMatchupWeightConsideration = 2.5;
  private readonly moveDamageWeightConsideration = 0.8;
  private readonly antiBoostWeightConsideration = 25;
  private readonly hpWeightConsideration = 0.25;
  private readonly hpFractionCoefficient = 0.4;
  private readonly boostWeightCoefficient = 1;
  private readonly switchOutMatchupThreshold = -2;
  private readonly selfKoMoveMatchupThreshold = 0.3;
  private readonly trickRoomThreshold = 85;
  private readonly recoveryMoveThreshold = 0.5;
  private readonly accuracySwitchThreshold = -3;
  private readonly hpSwitchOutThreshold = 0.3;
  private readonly randomProtectChance = 0.3;
  private readonly statusDamageConsiderationThreshold = 0.8;

  readonly activeTracker = new ActiveTracker();

  /** `random` substitui o kotlin.random.Random (testes usam uma sequência fixa). */
  constructor(skill = 5, private readonly random: () => number = Math.random) {
    this.skill = Math.max(0, Math.min(5, Math.trunc(Number.isFinite(skill) ? skill : 0)));
  }

  /** Acerta a decisão de golpe? skill × 20% (5 = sempre, sem sortear). */
  checkSkillLevel(): boolean {
    if (this.skill === 5) return true;
    return Math.floor(this.random() * 100) < this.skill * 20;
  }

  /** Considera trocar? 0–2: nunca; 3: 20%; 4: 60%; 5: 100%. */
  checkSwitchOutSkill(): boolean {
    const randomNumber = this.random();
    const chance = this.skill === 3 ? 0.2 : this.skill === 4 ? 0.6 : this.skill === 5 ? 1 : 0;
    return randomNumber <= chance;
  }

  choose(actor: BattleActor, request: RequestData): string {
    const battle = getSimBattle(actor.battle);
    const side = battle?.sides.find(x => x?.id === actor.showdownId) ?? undefined;
    if (!battle || !side) return buildChoice(request, (slot, forceSwitch, chosen) => randomSlotChoice(actor, request, slot, forceSwitch, chosen, this.random));
    return buildChoice(request, (slot, forceSwitch, chosenSwitches) => this.chooseSlot(new Turn(actor, battle, side, request, chosenSwitches), slot, forceSwitch));
  }

  // -------------------------------------------------------------------------------------------------------------
  // choose (uma posição)

  private chooseSlot(turn: Turn, slot: number, forceSwitch: boolean): string {
    this.updateActiveTracker(turn);
    const self = turn.side.active[slot] ?? undefined;
    const actorTracker = this.activeTracker.alliedSide.actors.find(x => x.id === turn.side.id);
    const availableSwitches = actorTracker ? this.availableSwitches(turn, actorTracker) : [];

    if (forceSwitch || !self || self.fainted) {
      // Troca obrigatória: a reserva com a melhor estimativa de confronto.
      let best: { tracker: TrackerPokemon; index: number; score: number } | undefined;
      for (const option of availableSwitches) {
        const score = this.estimateMatchup(turn, option.tracker);
        if (!best || score > best.score) best = { ...option, score };
      }
      return best ? switchTo(best.index, turn.chosenSwitches) : "pass";
    }
    const moveset = turn.request.active?.[slot];
    if (!moveset) return "pass";
    const moves = parseMoveset(moveset);
    const trapped = !!moveset.trapped;

    // Golpe obrigatório (Recharge, Outrage travado...): usa.
    const forced = moves.find(mustBeUsed);
    if (forced) return this.chooseMove(turn, forced, self);

    const activeTrackerPokemon = this.activeTracker.alliedSide.activePokemon.find(x => x.id === simPokemonUUID(self));
    if (!activeTrackerPokemon) return chooseRandomMove(turn.actor, turn.request, slot, this.random);
    const opponents = this.activeTracker.opponentSide.activePokemon;

    // Proteção em recarga: desconta 1 (70%) ou 2 (30%) para não ficar previsível.
    if (activeTrackerPokemon.protectCount > 0) {
      activeTrackerPokemon.protectCount = Math.max(0, activeTrackerPokemon.protectCount - (this.random() < this.randomProtectChance ? 2 : 1));
    }

    const availableMoves = moves.filter(canBeUsed).map(move => ({ move, data: moveData(move.id) }));
    const randomMove = randomOrNull(availableMoves, this.random);
    if (!randomMove) {
      const struggle = moves.find(x => x.id === "struggle");
      return `move ${(struggle?.index ?? 0) + 1}`;
    }

    if (!this.checkSkillLevel()) return this.chooseMove(turn, randomMove.move, self);

    const context: SlotContext = { turn, self, tracker: activeTrackerPokemon, opponents, availableMoves, availableSwitches, moves, trapped };

    // Troca pelo confronto atual.
    if (this.checkSwitchOutSkill() && this.shouldSwitchOut(context)) {
      const switched = this.considerSwitching(context);
      if (switched) return switched;
    }

    // HP abaixo de 30% e sem trocar: o golpe mais forte.
    if (activeTrackerPokemon.currentHpPercent < 0.3 && !this.shouldSwitchOut(context)) {
      const move = this.findAndUseMostDamagingMove(context);
      if (move) return move;
    }

    if (!this.shouldSwitchOut(context)) {
      const nRemainingMons = sum(this.activeTracker.alliedSide.actors, actor => actor.party.filter(x => x.currentHpPercent > 0).length);
      const nOppRemainingMons = sum(this.activeTracker.opponentSide.actors, actor => actor.party.filter(x => x.currentHpPercent > 0).length);

      // Sleep Talk dormindo.
      const sleepTalk = availableMoves.find(x => activeTrackerPokemon.currentStatus === "slp" && x.move.id === "sleeptalk");
      if (sleepTalk) return this.chooseMove(turn, sleepTalk.move, self);

      // Fake Out no primeiro turno em campo, num alvo que não seja Fantasma.
      const fakeOut = availableMoves.find(x => x.move.id === "fakeout" && activeTrackerPokemon.firstTurn);
      if (fakeOut) {
        const targets = turn.targetList(fakeOut.move.target, self) ?? [];
        const validTarget = opponents.find(opp => targets.some(t => simPokemonUUID(t) === opp.id) && !formTypes(opp).includes("Ghost"));
        activeTrackerPokemon.firstTurn = false;
        return this.chooseMove(turn, fakeOut.move, self, targets.find(t => validTarget !== undefined && validTarget.id === simPokemonUUID(t)));
      }

      // Explosion / Self-Destruct com pouco HP contra alguém (não Fantasma) acima de 50%.
      const selfKo = availableMoves.find(x => (x.move.id === "explosion" || x.move.id === "selfdestruct")
        && activeTrackerPokemon.currentHpPercent < this.selfKoMoveMatchupThreshold
        && opponents.some(opp => !formTypes(opp).includes("Ghost") && opp.currentHpPercent > 0.5));
      if (selfKo) return this.chooseMove(turn, selfKo.move, self);

      // Recuperação com menos de 50%.
      const recovery = availableMoves.find(x => activeTrackerPokemon.currentHpPercent < this.recoveryMoveThreshold && selfRecoveryMoves.includes(x.move.id));
      if (recovery) return this.chooseMove(turn, recovery.move, self);

      // Efeitos de campo (fora clima).
      for (const { move } of availableMoves) {
        if (move.id === "tailwind" && move.id !== this.activeTracker.alliedSide.tailwindCondition && availableSwitches.length > 2)
          return this.chooseMove(turn, move, self);
        if (move.id === "trickroom" && move.id !== this.activeTracker.currentRoom
          && availableSwitches.filter(x => this.statEstimationActive(x.tracker, "spe") <= this.trickRoomThreshold).length >= 2)
          return this.chooseMove(turn, move, self);
        if (move.id === "auroraveil" && move.id !== this.activeTracker.alliedSide.screenCondition
          && ["hail", "snow"].includes(this.activeTracker.currentWeather ?? ""))
          return this.chooseMove(turn, move, self);
        if (move.id === "lightscreen" && move.id !== this.activeTracker.alliedSide.screenCondition
          && opponents.some(opp => speciesBaseStat(opp.species, "spa") > speciesBaseStat(opp.species, "atk"))
          && availableSwitches.length > 1)
          return this.chooseMove(turn, move, self);
        if (move.id === "reflect" && move.id !== this.activeTracker.alliedSide.screenCondition
          && opponents.some(opp => speciesBaseStat(opp.species, "atk") > speciesBaseStat(opp.species, "spa"))
          && availableSwitches.length > 1)
          return this.chooseMove(turn, move, self);
      }

      // Perigos de entrada: pôr e tirar.
      for (const { move } of availableMoves) {
        if (nOppRemainingMons >= 3 && entryHazards.includes(move.id) && !this.activeTracker.opponentSide.sideHazards.includes(move.id))
          return this.chooseMove(turn, move, self);
        if (nRemainingMons >= 2 && antiHazardsMoves.includes(move.id) && this.activeTracker.alliedSide.sideHazards.length > 0)
          return this.chooseMove(turn, move, self);
      }

      const antiBoost = this.considerAntiBoost(context);
      if (antiBoost) return antiBoost;

      // Court Change.
      const sideBuffs = ["tailwind", "lightscreen", "reflect"];
      for (const { move } of availableMoves) {
        const oppSide = [...this.activeTracker.opponentSide.sideHazards];
        if (move.id === "courtchange"
          && (!entryHazards.every(x => !this.activeTracker.alliedSide.sideHazards.includes(x)) || sideBuffs.some(x => oppSide.includes(x)))
          && !sideBuffs.some(x => oppSide.includes(x))
          && entryHazards.every(x => !oppSide.includes(x)))
          return this.chooseMove(turn, move, self);
      }

      // Strength Sap.
      for (const { move } of availableMoves) {
        if (move.id === "strengthsap" && activeTrackerPokemon.currentHpPercent < 0.5 && speciesBaseStat(activeTrackerPokemon.species, "atk") > 80)
          return this.chooseMove(turn, move, self);
      }

      // Belly Drum: HP > 60% com Sitrus Berry, ou > 80%, e ataque sem boost.
      for (const { move } of availableMoves) {
        if (move.id === "bellydrum"
          && (activeTrackerPokemon.currentHpPercent > 0.6 && activeTrackerPokemon.pokemon?.item === "sitrusberry" || activeTrackerPokemon.currentHpPercent > 0.8)
          && (activeTrackerPokemon.boosts.atk ?? 0) < 1)
          return this.chooseMove(turn, move, self);
      }

      // Golpes de clima (se o clima pedido ainda não está ativo).
      for (const { move } of availableMoves) {
        const requiredWeather = weatherSetupMoves[move.id];
        if (requiredWeather === undefined) continue;
        const weather = this.activeTracker.currentWeather;
        if (weather !== requiredWeather.toLowerCase()
          && !(weather === "primordialsea" && requiredWeather === "raindance")
          && !(weather === "desolateland" && requiredWeather === "sunnyday"))
          return this.chooseMove(turn, move, self);
      }

      // "Setup" (telas/campo) com HP cheio e confronto favorável: golpe sem alvo.
      if (activeTrackerPokemon.currentHpPercent === 1 && this.estimateMatchup(turn, activeTrackerPokemon) > 0) {
        for (const { move } of availableMoves) {
          if (!setupMoves.has(move.id)) continue;
          const stats = Object.keys(boostFromMoves[move.id] ?? {}) as AIStat[];
          const lowest = stats.length ? Math.min(...stats.map(stat => activeTrackerPokemon.boosts[stat] ?? 0)) : 0;
          if (lowest < 6 && (move.id !== "curse" || !formTypes(activeTrackerPokemon).includes("Ghost")))
            return `move ${move.index + 1}`;
        }
      }

      const status = this.considerInflictingStatus(context);
      if (status) return status;

      // Proteção (com recarga de 3 escolhas).
      for (const { move } of availableMoves) {
        if (!protectMoves.has(move.id)) continue;
        const opp = this.activeTracker.opponentSide;
        const ally = this.activeTracker.alliedSide;
        if ((opp.screenCondition !== undefined || opp.tailwindCondition !== undefined) && (ally.screenCondition === undefined || ally.tailwindCondition === undefined)
          || opponents.some(x => x.currentStatus === undefined) && activeTrackerPokemon.protectCount === 0 && !opponents.some(x => x.currentAbility === "unseenfist")) {
          activeTrackerPokemon.protectCount = 3;
          return this.chooseMove(turn, move, self);
        }
      }

      const damaging = this.findAndUseMostDamagingMove(context);
      if (damaging) return damaging;
    }

    // Healing Wish (só faz sentido quando já ia trocar).
    for (const { move } of availableMoves) {
      if (move.id === "healingwish" && activeTrackerPokemon.currentHpPercent < this.selfKoMoveMatchupThreshold)
        return this.chooseMove(turn, move, self);
    }

    if (this.shouldSwitchOut(context)) {
      const best = this.bestSwitch(turn, availableSwitches);
      if (best) return switchTo(best.index, turn.chosenSwitches);
    }
    activeTrackerPokemon.firstTurn = false;
    return this.chooseMove(turn, randomMove.move, self);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Estimativas

  /** Valor de entrar/ficar em campo contra os oponentes ativos (estimateMatchup). */
  estimateMatchup(turn: Turn, pokemon: TrackerPokemon): number {
    this.updateActiveTracker(turn);
    const currentAbility = pokemon.pokemon?.baseAbility ?? pokemon.currentAbility;
    const speedEstimation = this.statEstimationActive(pokemon, "spe");
    const opponents = this.activeTracker.opponentSide.activePokemon;
    let score = 1.0;
    for (const opponent of opponents) {
      score += this.bestDamageMultiplier(pokemon, opponent) * this.moveDamageWeightConsideration + this.typeMatchup(pokemon, opponent) * this.typeMatchupWeightConsideration;
      score -= this.bestDamageMultiplier(opponent, pokemon) * this.moveDamageWeightConsideration + this.typeMatchup(opponent, pokemon) * this.typeMatchupWeightConsideration;
      const opponentSpeed = this.statEstimationActive(opponent, "spe");
      if (speedEstimation > opponentSpeed) score += this.speedTierCoefficient * this.trickRoomCoefficient;
      else if (opponentSpeed > speedEstimation) score -= this.speedTierCoefficient * this.trickRoomCoefficient;
      score += pokemon.currentHpPercent * this.hpFractionCoefficient * this.hpWeightConsideration;
      score -= opponent.currentHpPercent * this.hpFractionCoefficient * this.hpWeightConsideration;
    }
    if (opponents.some(x => (x.boosts.atk ?? 0) > 1 || (x.boosts.spa ?? 0) > 1)
      && (pokemon.moves.some(x => antiBoostMoves.includes(x)) || currentAbility === "unaware"))
      score += this.antiBoostWeightConsideration;
    return score;
  }

  hasMajorStatusImmunity(target: TrackerPokemon): boolean {
    const ability = target.pokemon?.baseAbility ?? target.currentAbility;
    if (!ability) return false;
    return ["comatose", "purifyingsalt"].includes(ability) || (this.activeTracker.currentWeather === "sunny" && ability === "leafguard");
  }

  private shouldSwitchOut(context: SlotContext): boolean {
    const { turn, tracker } = context;
    this.updateActiveTracker(turn);
    if (context.trapped) return false;
    // Acabou de entrar: não troca.
    if (tracker.firstTurn) return false;
    const actorTracker = this.activeTracker.alliedSide.actors.find(x => x.activePokemon.includes(tracker));
    if (!actorTracker) return false;
    // currentHp dos aliados é o HP máximo: desmaiados no banco também contam aqui (como no original).
    const availableSwitches = actorTracker.party.filter(x => (x.currentHp ?? 0) > 0);
    const speedEstimation = this.statEstimationActive(tracker, "spe");
    const opponents = this.activeTracker.opponentSide.activePokemon;
    const opponentSpeeds = opponents.map(x => this.statEstimationActive(x, "spe"));

    // Só troca se alguém é bem melhor que o atual.
    const currentScore = this.estimateMatchup(turn, tracker);
    const bestSwitchScore = availableSwitches.length ? Math.max(...availableSwitches.map(x => this.estimateMatchup(turn, x))) : currentScore;
    const improvementThreshold = Math.abs(currentScore) * 0.5 + 3;
    if (bestSwitchScore <= currentScore + improvementThreshold) return false;
    if (bestSwitchScore < 1) return false;

    // Mais lento e com pouco HP: fica.
    if (tracker.currentHpPercent < this.hpSwitchOutThreshold && opponentSpeeds.some(x => x > speedEstimation)) return false;

    // Truant / Slow Start que não são da espécie: troca.
    const ability = tracker.pokemon?.baseAbility ?? tracker.currentAbility;
    const legalAbilities = speciesAbilities(tracker.species ?? tracker.form);
    if ((ability === "truant" && !legalAbilities.includes("truant")) || (ability === "slowstart" && !legalAbilities.includes("slowstart"))) return true;

    // Preso a golpes inúteis (sem efeito em ninguém ou poder < 40): troca.
    const available = context.moves.filter(canBeUsed).map(x => moveData(x.id));
    const unavailable = context.moves.filter(x => !canBeUsed(x));
    if (unavailable.length > 0
      && available.every(move => opponents.every(opp => this.moveDamageMultiplier(tracker, move, opp) === 0) || move.basePower < 40))
      return true;

    if (availableSwitches.length === 0 || !availableSwitches.some(x => this.estimateMatchup(turn, x) > 0)) return false;

    // ...e um "bom motivo".
    if (opponents.some(x => (x.boosts.accuracy ?? 0) <= this.accuracySwitchThreshold)
      || opponents.some(x => (x.boosts.def ?? 0) <= -3)
      || opponents.some(x => (x.boosts.spd ?? 0) <= -3))
      return true;

    const physical = opponents.filter(x => formBaseStat(x, "atk") > formBaseStat(x, "spa"));
    const special = opponents.filter(x => !physical.includes(x));
    if (physical.some(x => (x.boosts.atk ?? 0) <= -3) || special.some(x => (x.boosts.spa ?? 0) <= -3)) return true;

    return this.estimateMatchup(turn, tracker) < this.switchOutMatchupThreshold && tracker.currentHpPercent > this.hpSwitchOutThreshold;
  }

  /** Atributo estimado: base da espécie com IV 31 e 5 extras, vezes o boost (+1 vira ×2, como no original). */
  statEstimationActive(pokemon: TrackerPokemon, stat: AIStat): number {
    const boost = pokemon.boosts[stat] ?? 0;
    const actualBoost = boost > 1 ? (2 + boost) / 2 : 2 / (2 - boost);
    const baseStat = speciesBaseStat(pokemon.species, stat);
    return ((2 * baseStat + 31) + 5) * actualBoost;
  }

  moveDamageMultiplier(attacker: TrackerPokemon, move: MoveInfo, defender: TrackerPokemon): number {
    let multiplier = 1.0;
    const type = effectiveType(move, attacker.pokemon);
    for (const defenderType of formTypes(defender)) multiplier *= getDamageMultiplier(type, defenderType);
    return multiplier;
  }

  /** Melhor multiplicador entre os golpes do atacante (tipo cru do golpe, status inclusive). Oponentes: 1. */
  bestDamageMultiplier(attacker: TrackerPokemon, defender: TrackerPokemon): number {
    const moves = attacker.pokemon ? attacker.pokemon.baseMoveSlots.map(x => x.id) : attacker.moves;
    const defenderTypes = formTypes(defender);
    let best = 1.0;
    for (const id of moves) {
      let multiplier = 1.0;
      for (const type of defenderTypes) multiplier *= getDamageMultiplier(moveData(id).type, type);
      if (multiplier > best) best = multiplier;
    }
    return best;
  }

  typeMatchup(attacking: TrackerPokemon, defending: TrackerPokemon): number {
    let multiplier = 1.0;
    for (const attackType of formTypes(attacking))
      for (const defenseType of formTypes(defending)) multiplier *= getDamageMultiplier(attackType, defenseType);
    return multiplier;
  }

  /** Número de acertos esperado (inteiro, como no original). */
  expectedHits(move: MoveInfo): number {
    const hits = multiHitMoves[move.id];
    if (move.id === "triplekick" || move.id === "tripleaxel") return Math.trunc(1 + 2 * 0.9 + 3 * 0.81);
    if (move.id === "populationbomb") return 7;
    if (!hits) return 1;
    if (hits[0] === hits[1]) return hits[0];
    return Math.trunc((2 + 3) / 3) + Math.trunc((4 + 5) / 6);
  }

  /** Dano estimado de um golpe do atacante (aliado) no oponente (calculateDamage). */
  calculateDamage(move: InBattleMove | MoveInfo, attacker: TrackerPokemon, opponent: TrackerPokemon): number {
    const data = moveData(move.id);
    if (!data.exists) return 0;
    const type = effectiveType(data, attacker.pokemon);
    const opponentAbility = opponent.pokemon?.baseAbility ?? opponent.currentAbility ?? "unknown";
    if (typeImmuneAbilities[opponentAbility] === type || (opponentAbility === "suctioncup" && move.id === "roar") || move.id === "whirlwind")
      return 0;
    const physicalRatio = this.statEstimationActive(attacker, "atk") / this.statEstimationActive(opponent, "def");
    const specialRatio = this.statEstimationActive(attacker, "spa") / this.statEstimationActive(opponent, "spd");
    const level = attacker.pokemon?.level ?? 1;
    const statRatio = data.category === "Physical" ? physicalRatio : specialRatio;
    const attackerTypes = formTypes(attacker);
    const attackerAbility = attacker.pokemon?.baseAbility ?? attacker.currentAbility;
    const stab = attackerTypes.includes(type) && attackerAbility === "adaptability" ? 2 : attackerTypes.includes(type) ? 1.5 : 1;
    const weather = this.activeTracker.currentWeather;
    const weatherMultiplier =
      weather === "sunny" && (type === "Fire" || data.id === "hydrosteam") ? 1.5
        : weather === "sunny" && type === "Water" ? 0.5
          : weather === "raining" && type === "Water" ? 1.5
            : weather === "raining" && type === "Fire" ? 0.5
              : 1;
    const opponentStatus = opponent.pokemon ? (opponent.pokemon.status || undefined) : opponent.currentStatus;
    const burn = opponentStatus === "brn" && data.category === "Physical" ? 0.5 : 1;
    let damage = ((Math.trunc((2 * level) / 5) + 2) * data.basePower * statRatio) / 50 + 2;
    damage *= weatherMultiplier;
    damage *= stab;
    damage *= this.moveDamageMultiplier(attacker, data, opponent);
    damage *= burn;
    damage *= this.expectedHits(data);
    return damage;
  }

  /** Golpe → (alvo que mais sofre, dano) ou (sem alvo, dano total nos oponentes − dano nos aliados). */
  private calculateMoveDamage(turn: Turn, move: InBattleMove, self: SimPokemon, selfTracker: TrackerPokemon): [SimPokemon | undefined, number] {
    if (NON_OPPONENT_TARGETS.has(move.target)) return [undefined, 0];
    const single = turn.targetList(move.target, self);
    const multi = turn.multiTargetList(move.target, self);
    if (single && single.length) {
      let best: [SimPokemon | undefined, number] | undefined;
      for (const opponent of this.activeTracker.opponentSide.activePokemon) {
        const target = single.find(x => simPokemonUUID(x) === opponent.id);
        if (!target) continue;
        const damage = this.calculateDamage(move, selfTracker, opponent);
        if (!best || damage > best[1]) best = [target, damage];
      }
      // O original lançaria exceção (maxBy vazio); aqui vale 0.
      return best ?? [undefined, 0];
    }
    if (multi && multi.length) {
      const allies = multi.filter(x => turn.isAllied(x, self)).map(simPokemonUUID);
      const opponents = multi.filter(x => !turn.isAllied(x, self)).map(simPokemonUUID);
      const opponentDamage = sum(this.activeTracker.opponentSide.activePokemon.filter(x => opponents.includes(x.id)), x => this.calculateDamage(move, selfTracker, x));
      const alliedDamage = sum(this.activeTracker.alliedSide.activePokemon.filter(x => allies.includes(x.id)), x => this.calculateDamage(move, selfTracker, x));
      return [undefined, opponentDamage - alliedDamage];
    }
    return [undefined, 0];
  }

  /** O golpe escolhido é o que mais fere este oponente (e fere algo)? */
  private mostDamagingMove(selected: InBattleMove, moves: InBattleMove[], pokemon: TrackerPokemon, opponent: TrackerPokemon): boolean {
    const selectedDamage = this.calculateDamage(selected, pokemon, opponent);
    for (const move of moves.filter(x => !x.disabled && x.id !== selected.id))
      if (this.calculateDamage(move, pokemon, opponent) > selectedDamage) return false;
    return selectedDamage > 0;
  }

  private updateActiveTracker(turn: Turn) {
    this.activeTracker.update(turn.battle, turn.side);
    this.trickRoomCoefficient = this.activeTracker.currentRoom === "trickroom" ? -1 : 1;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Decisões auxiliares

  private availableSwitches(turn: Turn, actorTracker: TrackerActor): SwitchOption[] {
    const output: SwitchOption[] = [];
    for (const tracker of actorTracker.party) {
      const index = turn.request.side.pokemon.findIndex(x => requestPokemonUUID(x) === tracker.id);
      if (index < 0) continue;
      const pokemon = turn.request.side.pokemon[index];
      // canBeSentOut: vivo, fora de campo e ainda não escolhido neste turno (willBeSwitchedIn).
      if (pokemon.active || isFaintedCondition(pokemon) || turn.chosenSwitches.has(index)) continue;
      output.push({ tracker, index });
    }
    return output;
  }

  private bestSwitch(turn: Turn, options: SwitchOption[]): SwitchOption | undefined {
    let best: { option: SwitchOption; score: number } | undefined;
    for (const option of options) {
      const score = this.estimateMatchup(turn, option.tracker);
      if (!best || score > best.score) best = { option, score };
    }
    return best?.option;
  }

  private considerSwitching(context: SlotContext): string | undefined {
    const { turn, self, tracker, availableMoves } = context;
    const best = this.bestSwitch(turn, context.availableSwitches);

    // Golpe de pivô antes de trocar.
    for (const { move, data } of availableMoves.filter(x => pivotMoves.includes(x.move.id))) {
      const single = turn.targetList(move.target, self)?.filter(x => !turn.isAllied(x, self));
      const multi = turn.multiTargetList(move.target, self);
      if (move.target === "self") return this.chooseMove(turn, move, self, self);
      if (single) {
        let target: { pokemon: SimPokemon; value: number } | undefined;
        for (const pokemon of single) {
          const opponent = context.opponents.find(x => x.id === simPokemonUUID(pokemon));
          if (!opponent) continue;
          const value = this.moveDamageMultiplier(tracker, data, opponent);
          if (!target || value > target.value) target = { pokemon, value };
        }
        if (target && target.value > 0) return this.chooseMove(turn, move, self, target.pokemon);
      }
      else if (multi) {
        const allies = multi.filter(x => turn.isAllied(x, self)).map(simPokemonUUID);
        const opponents = multi.filter(x => !turn.isAllied(x, self)).map(simPokemonUUID);
        const alliedDamage = sum(this.activeTracker.alliedSide.activePokemon.filter(x => allies.includes(x.id)), x => this.calculateDamage(move, tracker, x));
        const opponentDamage = sum(this.activeTracker.opponentSide.activePokemon.filter(x => opponents.includes(x.id)), x => this.calculateDamage(move, tracker, x));
        if (alliedDamage > opponentDamage) continue;
        return this.chooseMove(turn, move, self);
      }
    }

    const chilly = availableMoves.find(x => x.move.id === "chillyreception" && this.activeTracker.currentWeather !== "snow");
    if (chilly) return this.chooseMove(turn, chilly.move, self);

    return best ? switchTo(best.index, turn.chosenSwitches) : undefined;
  }

  private considerAntiBoost(context: SlotContext): string | undefined {
    const { turn, self, tracker, opponents } = context;
    for (const { move } of context.availableMoves.filter(x => antiBoostMoves.includes(x.move.id))) {
      const single = turn.targetList(move.target, self)?.filter(x => !turn.isAllied(x, self));
      const multi = turn.multiTargetList(move.target, self);
      if (move.target === "self" && sum(Object.values(tracker.boosts).filter(x => x < 0), x => x) < 3) {
        return this.chooseMove(turn, move, self);
      }
      else if (single && single.length) {
        let target: { pokemon: SimPokemon; value: number } | undefined;
        for (const pokemon of single) {
          const opponent = opponents.find(x => x.id === simPokemonUUID(pokemon));
          const value = opponent ? sum(Object.values(opponent.boosts).filter(x => x > 0), x => x) : 0;
          if (!target || value > target.value) target = { pokemon, value };
        }
        if (target && target.value > 0) return this.chooseMove(turn, move, self, target.pokemon);
      }
      else if (multi && multi.length === 0) {
        // Ramo inalcançável no original (`!multiTargetList.isNotEmpty()`): mantido pela paridade.
        return this.chooseMove(turn, move, self);
      }
    }
    return undefined;
  }

  private considerInflictingStatus(context: SlotContext): string | undefined {
    const { turn, self, tracker, opponents, availableMoves } = context;
    if (tracker.currentHpPercent > 0.5) {
      for (const { move, data } of availableMoves) {
        const status = statusMoves[move.id];
        if (status === undefined) continue;
        const isPersistent = PERSISTENT_STATUSES.has(status);
        if (move.target === "self") continue;
        const single = turn.targetList(move.target, self)?.filter(x => !turn.isAllied(x, self));
        const multi = turn.multiTargetList(move.target, self);
        const affectable = (x: TrackerPokemon) => (isPersistent ? x.currentStatus === undefined : x.currentVolatile !== status)
          && x.currentHpPercent > 0.3
          && canAffectWithStatus(status, speciesTypes(x.species), x.pokemon?.baseAbility ?? x.currentAbility)
          && !this.hasMajorStatusImmunity(x);
        if (single && single.length) {
          const targetOf = (opponent: TrackerPokemon) => single.find(x => simPokemonUUID(x) === opponent.id);
          const sensibleTargets = opponents
            .filter(x => targetOf(x) !== undefined)
            .filter(x => !(this.calculateDamage(move, tracker, x) >= x.currentHpPercent * this.statusDamageConsiderationThreshold))
            .filter(affectable);
          for (const potentialTarget of sensibleTargets) {
            switch (status) {
              case "brn":
                if (speciesBaseStat(potentialTarget.species, "atk") > 80) return this.chooseMove(turn, move, self, targetOf(potentialTarget));
                break;
              case "par": {
                const electricVersusGround = effectiveType(data, tracker.pokemon) === "Electric" && speciesTypes(potentialTarget.species).includes("Ground");
                const faster = speciesBaseStat(potentialTarget.species, "spe") > speciesBaseStat(tracker.species, "spe");
                if (!electricVersusGround && faster) return this.chooseMove(turn, move, self, targetOf(potentialTarget));
                break;
              }
              case "slp":
                // "sleeppoweder" (sic): só Spore passa.
                if (["spore", "sleeppoweder"].includes(move.id)) return this.chooseMove(turn, move, self, targetOf(potentialTarget));
                break;
              case "psn":
              case "tox":
              case "cursed":
              case "leech":
              case "confusion":
                return this.chooseMove(turn, move, self, targetOf(potentialTarget));
            }
          }
        }
        else if (multi && multi.length) {
          const allies = multi.filter(x => turn.isAllied(x, self)).map(simPokemonUUID);
          const others = multi.filter(x => !turn.isAllied(x, self)).map(simPokemonUUID);
          const affectedAllies = this.activeTracker.alliedSide.activePokemon.filter(x => allies.includes(x.id)).filter(affectable).length;
          const affectedOpponents = this.activeTracker.opponentSide.activePokemon.filter(x => others.includes(x.id)).filter(affectable).length;
          if (affectedAllies > affectedOpponents) continue;
          return this.chooseMove(turn, move, self);
        }
      }
    }

    // Golpes que baixam precisão (HP cheio e confronto favorável).
    for (const { move } of availableMoves) {
      if (!accuracyLoweringMoves.has(move.id) || tracker.currentHpPercent !== 1 || !(this.estimateMatchup(turn, tracker) > 0)) continue;
      if (move.target === "self") continue;
      const single = turn.targetList(move.target, self)?.filter(x => !turn.isAllied(x, self));
      const multi = turn.multiTargetList(move.target, self);
      if (single && single.length) {
        const target = single.find(x => ((opponents.find(o => o.id === simPokemonUUID(x))?.boosts.accuracy) ?? 0) > this.boostWeightCoefficient);
        if (target) return this.chooseMove(turn, move, self, target);
      }
      else if (multi && multi.length) {
        const allies = multi.filter(x => turn.isAllied(x, self)).map(simPokemonUUID);
        const others = multi.filter(x => !turn.isAllied(x, self)).map(simPokemonUUID);
        const boosted = (x: TrackerPokemon) => (x.boosts.accuracy ?? 0) > this.boostWeightCoefficient;
        const affectedAllies = this.activeTracker.alliedSide.activePokemon.filter(x => allies.includes(x.id)).filter(boosted).length;
        const affectedOpponents = this.activeTracker.opponentSide.activePokemon.filter(x => others.includes(x.id)).filter(boosted).length;
        if (affectedAllies > affectedOpponents) continue;
        return this.chooseMove(turn, move, self);
      }
    }
    return undefined;
  }

  private findAndUseMostDamagingMove(context: SlotContext): string | undefined {
    const { turn, self, tracker, opponents, availableMoves } = context;
    let best: { move: InBattleMove; target: SimPokemon | undefined; value: number } | undefined;
    for (const { move, data } of availableMoves) {
      let value = this.calculateMoveDamage(turn, move, self, tracker);
      if (move.id === "fakeout") value = [undefined, 0];
      if (move.id === "synchronoise" && !formTypes(tracker).some(type => opponents.some(opp => speciesTypes(opp.species).includes(type))))
        value = [undefined, 0];
      // Soak vale muito contra quem não é Aço ("posion" no original: Veneno não conta).
      if (move.id === "soak" && value[0] && !speciesTypes(this.trackerOf(value[0])?.species).some(type => type === "Steel" || type.toLowerCase() === "posion"))
        value = [value[0], 200];
      // Pivô perde valor quando a IA não quer trocar e ele já é o golpe mais forte contra todos.
      if (pivotMoves.includes(move.id) && opponents.every(opp => this.moveDamageMultiplier(tracker, data, opp) !== 0)
        && (!this.shouldSwitchOut(context) && !opponents.some(opp => !this.mostDamagingMove(move, context.moves, tracker, opp))))
        value = [undefined, 0];
      if (!best || value[1] > best.value) best = { move, target: value[0], value: value[1] };
    }
    if (!best) return undefined;
    return this.chooseMove(turn, best.move, self, mustBeUsed(best.move) ? undefined : best.target);
  }

  private trackerOf(pokemon: SimPokemon): TrackerPokemon | undefined {
    const id = simPokemonUUID(pokemon);
    return [...this.activeTracker.alliedSide.activePokemon, ...this.activeTracker.opponentSide.activePokemon].find(x => x.id === id);
  }

  /** chooseMove: alvo dado, ou um inimigo aleatório da lista de alvos, ou qualquer um dela. */
  private chooseMove(turn: Turn, move: InBattleMove, self: SimPokemon, target?: SimPokemon): string {
    const targets = mustBeUsed(move) ? undefined : turn.targetList(move.target, self);
    if (!targets || targets.length === 0) return turn.moveChoice(move, self);
    const chosen = target ?? randomOrNull(targets.filter(x => !turn.isAllied(x, self)), this.random) ?? randomOrNull(targets, this.random)!;
    return turn.moveChoice(move, self, chosen);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Estado de uma decisão e consultas ao simulador

const NON_OPPONENT_TARGETS = new Set(["self", "adjacentAlly", "adjacentAllyOrSelf", "allyTeam", "allies", "allySide", "scripted", "randomNormal"]);

interface SwitchOption { tracker: TrackerPokemon; index: number }

interface SlotContext {
  turn: Turn;
  self: SimPokemon;
  tracker: TrackerPokemon;
  opponents: TrackerPokemon[];
  availableMoves: { move: InBattleMove; data: MoveInfo }[];
  availableSwitches: SwitchOption[];
  moves: InBattleMove[];
  trapped: boolean;
}

/** Uma escolha completa do ator: simulador, lado, request e as trocas já escolhidas neste turno. */
export class Turn {
  constructor(
    readonly actor: BattleActor,
    readonly battle: SimBattle,
    readonly side: SimSide,
    readonly request: RequestData,
    readonly chosenSwitches: Set<number>,
  ) { }

  isAllied(a: SimPokemon, b: SimPokemon) {
    return a.side.n % 2 === b.side.n % 2;
  }

  /** Pokémon ativos vivos de todos os lados (getAllActivePokemon). */
  allActive(): SimPokemon[] {
    return this.battle.sides.flatMap(side => side ? activeOf(side) : []).filter(x => !x.fainted && x.hp > 0);
  }

  adjacent(self: SimPokemon): SimPokemon[] {
    return this.allActive().filter(x => x !== self && self.isAdjacent(x));
  }

  /** MoveTarget.targetList: alvos que se escolhe (null = golpe sem escolha de alvo). */
  targetList(target: string, self: SimPokemon): SimPokemon[] | undefined {
    switch (target) {
      case "any": return this.allActive().filter(x => x !== self);
      case "normal": return this.adjacent(self);
      case "adjacentAlly": return this.adjacent(self).filter(x => this.isAllied(x, self));
      case "adjacentAllyOrSelf": return [...this.adjacent(self).filter(x => this.isAllied(x, self)), self];
      case "adjacentFoe": return this.adjacent(self).filter(x => !this.isAllied(x, self));
      default: return undefined;
    }
  }

  /** Targetable.getMultiTargetList: quem um golpe de área atinge. */
  multiTargetList(target: string, self: SimPokemon): SimPokemon[] | undefined {
    switch (target) {
      case "all": return this.allActive();
      case "allAdjacent": return this.adjacent(self);
      case "allAdjacentFoes": return this.adjacent(self).filter(x => !this.isAllied(x, self));
      case "self":
      case "randomNormal":
      case "scripted": return [self];
      case "allies":
      case "allySide":
      case "allyTeam": return this.allActive().filter(x => this.isAllied(x, self));
      case "foeSide": return this.allActive().filter(x => !this.isAllied(x, self));
      default: return undefined;
    }
  }

  /** "move N [alvo]" (ver moveChoice em SimTargets). */
  moveChoice(move: InBattleMove, self: SimPokemon, target?: SimPokemon): string {
    return moveChoice(this.battle, move, self, target);
  }
}


// ---------------------------------------------------------------------------------------------------------------
// Dados (Dex no lugar dos registros do Cobblemon)

export interface MoveInfo {
  id: string;
  exists: boolean;
  type: string;
  category: "Physical" | "Special" | "Status";
  basePower: number;
}

const moveCache = new Map<string, MoveInfo>();
export function moveData(id: string): MoveInfo {
  let info = moveCache.get(id);
  if (!info) {
    const move = Dex.moves.get(id);
    info = { id: move.exists ? move.id : id, exists: move.exists, type: move.type || "Normal", category: move.category ?? "Status", basePower: move.basePower || 0 };
    moveCache.set(id, info);
  }
  return info;
}

/** MoveTemplate.getEffectiveElementalType: Hidden Power, -ate e Normalize (só para aliados; oponentes: tipo cru). */
export function effectiveType(move: MoveInfo, pokemon: SimPokemon | undefined): string {
  if (!pokemon) return move.type;
  if (move.id === "hiddenpower") return pokemon.hpType || move.type;
  const ability = pokemon.baseAbility;
  if (move.type === "Normal") {
    if (move.category !== "Status") {
      switch (ability) {
        case "pixilate": return "Fairy";
        case "aerilate": return "Flying";
        case "refrigerate": return "Ice";
        case "galvanize": return "Electric";
      }
    }
    return move.type;
  }
  if (ability === "normalize") return "Normal";
  return move.type;
}

/** Tipos da forma (Pokemon.types / FormData.types). */
function formTypes(pokemon: TrackerPokemon): string[] {
  const id = pokemon.form ?? pokemon.species;
  return id ? [...Dex.species.get(id).types] : [];
}

/** Tipos da espécie base (Species.types). */
function speciesTypes(species: string | undefined): string[] {
  return species ? [...Dex.species.get(species).types] : [];
}

/** Atributo base da espécie (Species.baseStats); precisão/evasão não existem (0). */
function speciesBaseStat(species: string | undefined, stat: AIStat): number {
  if (!species || stat === "accuracy" || stat === "evasion") return 0;
  return Dex.species.get(species).baseStats?.[stat] ?? 0;
}

/** Atributo base da forma (FormData.baseStats). */
function formBaseStat(pokemon: TrackerPokemon, stat: "atk" | "spa"): number {
  const id = pokemon.form ?? pokemon.species;
  return id ? Dex.species.get(id).baseStats?.[stat] ?? 0 : 0;
}

function speciesAbilities(species: string | undefined): string[] {
  if (!species) return [];
  return Object.values(Dex.species.get(species).abilities ?? {}).filter(Boolean).map(x => Dex.abilities.get(x as string).id);
}

function randomOrNull<T>(list: T[], random: () => number): T | undefined {
  return list.length ? list[Math.floor(random() * list.length)] : undefined;
}

function sum<T>(list: T[], value: (item: T) => number): number {
  let total = 0;
  for (const item of list) total += value(item);
  return total;
}
