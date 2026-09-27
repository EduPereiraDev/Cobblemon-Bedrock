import { Player, RawMessage } from "@minecraft/server";
import { BattleActor } from "./BattleActor";
import { PokemonBattle } from "./PokemonBattle";
import { playCry } from "./Animations";

export class BattleSide {
  constructor(public actors: BattleActor[]) { }
  battle!: PokemonBattle
  getActivePokemon() {
    return this.actors.flatMap(x => x.activePokemon);
  }
  getOppositeSide() {
    return (this == this.battle.side1) ? this.battle.side2 : this.battle.side1
  }
  broadcaseChatMessage(text: RawMessage) {
    this.actors.forEach(x => {
      if (x.actor instanceof Player)
        x.actor.sendMessage(text);
    })
  }
  stillSendingOut() {
    return this.actors.some(x => x.stillSendingOutCount > 0);
  }
  /** Grito dos Pokémon em campo (animação `cry` do poser + som da espécie). */
  playCries() {
    this.getActivePokemon().forEach(x => {
      // Com Illusion/Transform grita o que aparece (a entidade de exibição).
      if (x && !x.pending)
        playCry(x.visual, x.mock?.data ?? x.illusion ?? x.data);
    })
  }
}
