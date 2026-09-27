/**
 * Rastreador de estado da StrongBattleAI (battles/ai/strongBattleAI/ActiveTracker.kt do Cobblemon 1.8.2).
 *
 * O Cobblemon monta o rastreador a partir dos "contextos" da batalha (mensagens do protocolo: boost, status,
 * clima, telas, perigos). No port o simulador (@pkmn/sim) roda no mesmo processo, então os mesmos campos são
 * lidos direto do estado dele (valores exatos em vez da contagem de mensagens). As regras de atualização são as
 * do original, inclusive as que deixam dados velhos:
 *  - Aliados: a IA sabe tudo (Pokémon vivo: nível, tipos da forma, habilidade, golpes, item).
 *  - Oponentes: só o que é "visto" em campo (espécie/forma exibidas, habilidade = a 1ª da forma, % de HP);
 *    quem ainda não entrou fica com 0% de HP (conta como fora de combate nas somas do original).
 *  - Quem sai de campo guarda HP e boosts da última vez em que esteve ativo.
 *  - `firstTurn` volta a true a cada entrada em campo.
 */
import { Dex } from "../../showdown";
import type { SimBattle, SimPokemon, SimSide } from "../../showdown";
import { simPokemonUUID } from "../../showdown";
import { AI_STATS, AIStat } from "./AIUtility";

export interface TrackerPokemon {
  /** UUID do Pokémon (nome no simulador). */
  id: string;
  /** Pokémon do simulador: só nos aliados (o `pokemon` do TrackerPokemon do Cobblemon). */
  pokemon?: SimPokemon;
  /** Espécie base (Species) e forma (FormData), ids do Dex. Nos oponentes, só depois de vistos. */
  species?: string;
  form?: string;
  currentHp?: number;
  currentHpPercent: number;
  boosts: Partial<Record<AIStat, number>>;
  currentVolatile?: string;
  currentStatus?: string;
  currentAbility?: string;
  moves: string[];
  firstTurn: boolean;
  protectCount: number;
}

export class TrackerActor {
  readonly party: TrackerPokemon[] = [];
  readonly activePokemon: TrackerPokemon[] = [];
  constructor(public readonly id: string) { }

  /** updateAlliedActivePokemon / updateOpponentActivePokemon (idênticos no original). */
  updateActivePokemon(side: SimSide) {
    const current = activeOf(side);
    for (const pokemon of current) {
      const id = simPokemonUUID(pokemon);
      if (this.activePokemon.some(x => x.id === id)) continue;
      const tracked = this.party.find(x => x.id === id);
      if (!tracked) continue;
      this.party.splice(this.party.indexOf(tracked), 1);
      tracked.firstTurn = true;
      this.activePokemon.push(tracked);
    }
    const swappedOut = this.activePokemon.filter(x => !current.some(p => simPokemonUUID(p) === x.id));
    for (const tracked of swappedOut) {
      this.activePokemon.splice(this.activePokemon.indexOf(tracked), 1);
      this.party.push(tracked);
    }
  }
}

export class TrackerSide {
  screenCondition?: string;
  tailwindCondition?: string;
  sideHazards: string[] = [];
  readonly actors: TrackerActor[] = [];

  get activePokemon(): TrackerPokemon[] {
    return this.actors.flatMap(x => x.activePokemon);
  }

  update(sides: SimSide[], allied: boolean) {
    for (const actor of this.actors) {
      const side = sides.find(x => x.id === actor.id);
      if (side) actor.updateActivePokemon(side);
    }
    for (const pokemon of sides.flatMap(activeOf)) {
      const tracked = this.activePokemon.find(x => x.id === simPokemonUUID(pokemon));
      if (!tracked) continue;
      tracked.boosts = Object.fromEntries(AI_STATS.map(stat => [stat, pokemon.boosts[stat] ?? 0]));
      tracked.currentStatus = pokemon.status || undefined;
      tracked.currentVolatile = lastVolatile(pokemon);
      if (allied) {
        tracked.pokemon = pokemon;
        tracked.species = baseSpeciesId(pokemon.baseSpecies.id);
        tracked.form = pokemon.baseSpecies.id;
        tracked.currentHp = pokemon.maxhp;
        tracked.currentHpPercent = pokemon.maxhp > 0 ? pokemon.hp / pokemon.maxhp : 0;
        tracked.currentAbility = pokemon.baseAbility;
        tracked.moves = pokemon.baseMoveSlots.map(x => x.id);
      }
      else {
        // Espécie/forma exibidas (Ilusão mostra a do disfarce) e a 1ª habilidade da forma: "palpite educado".
        const exposed = pokemon.illusion ?? pokemon;
        tracked.form = exposed.baseSpecies.id;
        tracked.species = baseSpeciesId(tracked.form);
        tracked.currentAbility = firstAbility(tracked.form);
        tracked.currentHpPercent = pokemon.maxhp > 0 ? pokemon.hp / pokemon.maxhp : 0;
      }
    }
    // Contextos do lado: perigos (HAZARD), telas (SCREEN) e vento de cauda (TAILWIND), na ordem em que começaram.
    const conditions = [...new Set(sides.flatMap(side => Object.keys(side.sideConditions)))];
    this.sideHazards = conditions.filter(x => HAZARDS.has(x));
    this.screenCondition = conditions.find(x => SCREENS.has(x));
    this.tailwindCondition = conditions.find(x => x === "tailwind");
  }
}

const HAZARDS = new Set(["spikes", "toxicspikes", "stealthrock", "stickyweb", "gmaxsteelsurge"]);
const SCREENS = new Set(["reflect", "lightscreen", "auroraveil"]);
const ROOMS = ["trickroom", "magicroom", "wonderroom"];

export class ActiveTracker {
  currentRoom?: string;
  currentTerrain?: string;
  currentWeather?: string;
  readonly alliedSide = new TrackerSide();
  readonly opponentSide = new TrackerSide();
  private battle?: SimBattle;

  get isInitialized() {
    return this.alliedSide.actors.length > 0 && this.opponentSide.actors.length > 0;
  }

  /**
   * updateActiveTracker: inicializa uma vez por batalha (o original cria uma IA por ator) e atualiza campo,
   * ativos e lados. `aiSide` é o lado do simulador do ator da IA (p1..p4; em multi, o parceiro é aliado).
   */
  update(battle: SimBattle, aiSide: SimSide) {
    if (this.battle !== battle || !this.isInitialized) this.initialize(battle, aiSide);
    this.currentWeather = battle.field.weather || undefined;
    this.currentTerrain = battle.field.terrain || undefined;
    this.currentRoom = ROOMS.find(x => battle.field.pseudoWeather[x]);
    const [allied, opposing] = splitSides(battle, aiSide);
    this.alliedSide.update(allied, true);
    this.opponentSide.update(opposing, false);
  }

  private initialize(battle: SimBattle, aiSide: SimSide) {
    this.battle = battle;
    const [allied, opposing] = splitSides(battle, aiSide);
    const build = (side: SimSide, known: boolean) => {
      const actor = new TrackerActor(side.id);
      actor.party.push(...side.pokemon.map(pokemon => known ? createAllied(pokemon) : createOpposing(pokemon)));
      for (const pokemon of activeOf(side)) {
        const tracked = actor.party.find(x => x.id === simPokemonUUID(pokemon));
        if (!tracked) continue;
        actor.party.splice(actor.party.indexOf(tracked), 1);
        actor.activePokemon.push(tracked);
      }
      return actor;
    };
    this.alliedSide.actors.length = 0;
    this.alliedSide.actors.push(...allied.map(side => build(side, true)));
    this.opponentSide.actors.length = 0;
    this.opponentSide.actors.push(...opposing.map(side => build(side, false)));
  }
}

/** Pokémon ativos de um lado (inclusive desmaiados ainda na posição, como o `battlePokemon` do Cobblemon). */
export function activeOf(side: SimSide): SimPokemon[] {
  return side.active.filter((x): x is SimPokemon => !!x);
}

/** Lados aliados (mesma metade: p1/p3 ou p2/p4) e oponentes. */
export function splitSides(battle: SimBattle, aiSide: SimSide): [SimSide[], SimSide[]] {
  const sides = battle.sides.filter((x): x is SimSide => !!x);
  return [sides.filter(x => x.n % 2 === aiSide.n % 2), sides.filter(x => x.n % 2 !== aiSide.n % 2)];
}

function createAllied(pokemon: SimPokemon): TrackerPokemon {
  return {
    id: simPokemonUUID(pokemon),
    pokemon,
    species: baseSpeciesId(pokemon.baseSpecies.id),
    form: pokemon.baseSpecies.id,
    currentHp: pokemon.maxhp,
    currentHpPercent: pokemon.maxhp > 0 ? pokemon.hp / pokemon.maxhp : 0,
    boosts: {},
    currentAbility: pokemon.baseAbility,
    moves: pokemon.baseMoveSlots.map(x => x.id),
    firstTurn: true,
    protectCount: 0,
  };
}

function createOpposing(pokemon: SimPokemon): TrackerPokemon {
  // Só o id: o resto chega quando o Pokémon é visto em campo.
  return { id: simPokemonUUID(pokemon), currentHpPercent: 0, boosts: {}, moves: [], firstTurn: true, protectCount: 0 };
}

function lastVolatile(pokemon: SimPokemon): string | undefined {
  const keys = Object.keys(pokemon.volatiles);
  return keys.length ? keys[keys.length - 1] : undefined;
}

/** Espécie base de uma forma ("raichualola" → "raichu"). */
export function baseSpeciesId(formId: string): string {
  const species = Dex.species.get(formId);
  return species.exists ? Dex.species.get(species.baseSpecies).id : formId;
}

function firstAbility(formId: string): string | undefined {
  const ability = Dex.species.get(formId).abilities?.["0"];
  return ability ? Dex.abilities.get(ability).id : undefined;
}
