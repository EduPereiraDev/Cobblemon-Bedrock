import { Entity, RawMessage } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { ActorType, BattleActor } from "./BattleActor";
import { PokemonBattle } from "./PokemonBattle";
import { BattleMoveset } from "./BattleMoveset";

/** Holds relevant data for active pokemon in battle. */
export class ActivePokemon {
  /** UUID's of all pokemon this pokemon has seen (used for exp gain) */
  seenPokemon: string[] = []
  battle: PokemonBattle
  /** Illusion: Pokémon do mesmo time cujo visual/nome os outros veem (ActiveBattlePokemon.illusion do Cobblemon). */
  illusion?: PokemonData
  /**
   * Entidade de exibição de Illusion/Transform (frente visual-batalha, effects/Mock.ts): o Pokémon real fica
   * invisível e esta entidade da espécie copiada ocupa o lugar dele (o "mockEffect" do Cobblemon).
   */
  mock?: { kind: "illusion" | "transform"; entity: Entity; species: string; data: PokemonData }
  /**
   * O Pokémon já ocupa a posição (as linhas seguintes do protocolo o acham), mas ainda não está no mundo: a bola
   * está a caminho. `entity` guarda um marcador (a entidade que sai ou o treinador) que não deve ser mexido.
   */
  pending = false
  /**
   * @param data Data of the pokemon
   * @param battle Battle this is being used in (used to auto reveal itself to all out pokemon)
   */
  constructor(
    public data: PokemonData,
    public actor: BattleActor,
    public entity: Entity
  ) {
    this.battle = actor.battle;
    this.seeAllActivePokemon();
    this.revealToActivePokemon();
  }

  /** Nome mostrado nas mensagens da batalha (o do disfarce durante a Illusion, BattlePokemon.getName). */
  getName(): RawMessage {
    return (this.illusion ?? this.data).getTranslatedName();
  }

  /** Pokémon exposto a quem vê (ActiveBattlePokemonDTO.fromPokemon: aliado vê o real, o resto vê o disfarce). */
  displayData(isAlly: boolean): PokemonData {
    return isAlly ? this.data : this.illusion ?? this.data;
  }

  /** Entidade que aparece no mundo (a de exibição durante Illusion/Transform). */
  get visual(): Entity | undefined {
    try {
      if (this.mock?.entity.isValid) return this.mock.entity;
    }
    catch { }
    try {
      return this.entity?.isValid ? this.entity : undefined;
    }
    catch {
      return undefined;
    }
  }

  /** Espécie do modelo que aparece no mundo (sem namespace). */
  get visualSpecies(): string | undefined {
    return this.mock?.species;
  }

  /** Ensures that the pokemon is up to date, both in the field and in the player's team. */
  syncWithOut() {
    if (this.actor.type == ActorType.PLAYER && this.actor.Player) {
      // Clone de batalha: nunca grava no time real (só a entidade em campo).
      if (!this.data.battleClone) this.data.updatePokemonInTeam(this.actor.Player);
      this.data.tryUpdatePokemonOut();
    }
    else {
      this.data.tryUpdatePokemonOut();
    }
    // applyToCobblemon regrava o rótulo: com a entidade de exibição, o Pokémon real continua sem nome.
    if (this.mock) {
      try { if (this.entity.isValid) this.entity.nameTag = ""; } catch { }
    }
  }

  seeAllActivePokemon() {
    let allActivePokemon = this
      .getSide()
      .getOppositeSide()
      .actors
      .flatMap(x => x.activePokemon)
      .filter(x => x != null)
      .map(x => x.data.uuid)
    //Ensures Uniqueness
    this.seenPokemon = [...new Set([...this.seenPokemon, ...allActivePokemon])];
  }

  revealToActivePokemon() {
    this.getSide()
      .getOppositeSide()
      .actors
      .flatMap(x => x.activePokemon)
      .filter(x => x != null)
      .forEach(x => x.seenPokemon.push(this.data.uuid))
  }

  getSide() {
    return this.actor.getSide();
  }

  isAllied(pokemon: ActivePokemon) {
    return (pokemon.getSide() == this.getSide())
  }

  /** Returns all pokemon adjacent to the pokemon, including across from it.*/
  getAdjacent(): ActivePokemon[] {
    let digit = this.getDigit();
    // Posições do lado (duplas: 2 de um ator; multi: 1 de cada um dos 2 atores).
    let sideSize = this.getSide().getActivePokemon().length;
    return this.battle.activePokemon
      .filter(x => x != null)
      .filter(it => {
        let sameSideDigit = (it.isAllied(this))
          ? it.getDigit()
          : sideSize - it.getDigit() + 1;
        let digitDistance = Math.abs(sameSideDigit - digit)
        return digitDistance <= 1 && it !== this;
      })
  }

  /** Returns the showdown letter corresponding to the position on the field */
  getLetter(): string {
    let index = this.actor.activePokemon.findIndex(x => x == this)
    if (index == -1)
      throw new Error("The activePokemon is not active and could not be assigned a letter");
    return this.actor.letterFromSlot(index);
  }

  /** Finds the showdown digit for this particular pokemon. */
  getDigit(asAlly = true): number {
    let digit = this.getSide().getActivePokemon().findIndex(x => x == this) + 1;
    if (digit === 0)
      throw new Error("Pokemon was not on its own side somehow?");
    return digit * ((asAlly) ? 1 : -1);
  }

  getDigitRelativeTo(pokemon: ActivePokemon) {
    return this.getDigit(this.isAllied(pokemon))
  }

  getShowdownPosition() {
    return `${this.actor.showdownId}${this.getLetter()}`
  }

  getSignedDigitRelativeTo(other: ActivePokemon) {
    let digit = Math.abs(this.getDigitRelativeTo(other));
    //This seems backwards but ok
    return ((this.isAllied(other)) ? `-${digit}` : `+${digit}`);
  }
}