import { ColorCodes, getMoveTranslation, message } from "../language";
import { PokemonData } from "../Pokemon";
import { PokemonProperties } from "../PokemonProperties";
import { Dex } from "../showdown";
import { getAllDimensions, toID } from "../utils";
import { EvolutionRequirement } from "./EvolutionRequirement";
import { EvolutionEntry } from "../speciesData";
import { initializeRequirements } from "./requirements";
import { markCaught } from "../pokedex/PokedexStorage";
import { recordEvolution } from "../pokedex/Progress";
import { awardStat } from "../events/PlayerStats";
import { toSpeciesId } from "../speciesData";
import { EVOLUTION_SOUNDS, EvolutionSequenceHooks, announceEvolution, startEvolutionSequence } from "./EvolutionEffect";
import { playCry } from "../battle/Animations";
import type { Entity, Player } from "@minecraft/server";
import { dropEvolutionLoot, shed } from "./EvolutionDrops";
import type { DropTableData } from "../pokemon/Drops";
import { PARTY_SIZE, getSafeTeam, storePokemonInFirstSpace } from "../pokemonStorage";

/** Dependências do shed (time do dono). */
const SHED_DEPS = {
  firstFreePartySlot(owner: Player): number | undefined {
    const index = getSafeTeam(owner).slice(0, PARTY_SIZE).findIndex(member => member == null);
    return index >= 0 ? index : undefined;
  },
  store(owner: Player, pokemon: PokemonData) {
    storePokemonInFirstSpace(pokemon, owner);
  },
  recordEvolution(owner: Player, from: string, to: PokemonData) {
    recordEvolution(owner, from, { species: toSpeciesId(to.species), aspects: to.aspects, shiny: to.shiny });
  },
};

/** Entidade em campo do Pokémon, sem lançar (testes/mundo descarregado). */
function safeEntity(pokemon: PokemonData): Entity | undefined {
  try { return pokemon.tryGetPokemonOut(); }
  catch { return undefined; }
}

/** Troca do modelo e grito no fim da sequência, com os dados que estiverem na entidade naquela hora. */
const SEQUENCE_HOOKS: EvolutionSequenceHooks = {
  lookup: uuid => {
    for (const dimension of getAllDimensions()) {
      const found = dimension.getEntities({ tags: [uuid], families: ["pokemon"] });
      if (found.length > 0) return found[0];
    }
    return undefined;
  },
  swap: entity => {
    const data = PokemonData.tryGetFromEntity(entity);
    if (!data) return entity;
    data.applyToCobblemon(entity);
    return safeEntity(data) ?? entity;
  },
  cry: entity => {
    const data = PokemonData.tryGetFromEntity(entity);
    if (data) playCry(entity, data);
  },
};

export abstract class Evolution {
  /** Evolution.shedder: resultado extra (Nincada → Shedinja). */
  shedder?: PokemonProperties;
  /** Evolution.drops: itens ao terminar (tipo `evolution`, com requisitos). */
  drops?: DropTableData;

  constructor(
    public id = "id",
    public result = new PokemonProperties(),
    public optional = true,
    public consumeHeldItem = true,
    public requirements: EvolutionRequirement[] = [],
    public learnableMoves: string[] = []
  ) { }

  /**
   * Checks if the given [Pokemon] passes all the conditions and is ready to evolve.
   *
   * @param pokemon The [Pokemon] being queried.
   * @return If the [Evolution] can start.
   */
  test(pokemon: PokemonData) {
    return this.requirements.every(x => x.check(pokemon));
  }
  /**
  * Starts this evolution or queues it if [optional] is true.
  * Side effects may occur based on [consumeHeldItem].
  *
  * @param pokemon The [Pokemon] being evolved.
  */
  evolve(pokemon: PokemonData): boolean {
    if (this.consumeHeldItem) {
      pokemon.minecraftItem = undefined;
      pokemon.item = "";
    }
    if (this.optional) {
      if (!pokemon.readyEvolutions.includes(this.id)) {
        pokemon.readyEvolutions.push(this.id);
        // Com Everstone a evolução fica na fila, mas sem aviso (ClientEvolutionController.sendPlayerNotification).
        let owner = pokemon.isEvolutionBlocked() ? undefined : pokemon.tryGetOwner();
        owner?.playSound(EVOLUTION_SOUNDS.notification);
        owner?.sendMessage(message.prefix(ColorCodes.Green, message.With("cobblemon.ui.evolve.hint", [pokemon])));
        pokemon.tryUpdatePokemonOut();
        pokemon.tryUpdatePokemonInTeam();
        return true;
      }
      return false;
    }
    this.forceEvolve(pokemon);
    return true;
  }

  /**
  * Starts this evolution as soon as possible.
  * This will not present a choice to the client regardless of [optional].
  *
  * Com o Pokémon em campo, toca a sequência de evolução (scripts/evolution/EvolutionEffect.ts): os dados mudam
  * na hora e o modelo é trocado no fim; na bola, som de interface e mensagem imediata (como o Cobblemon).
  *
  * @param pokemon The [Pokemon] being evolved.
  */
  forceEvolve(pokemon: PokemonData): PokemonData {
    const preEvoName = pokemon.getTranslatedName();
    const fromSpecies = toSpeciesId(pokemon.species);
    // No ombro o Cobblemon recolhe antes (tryRecallWithAnimation); em batalha não há sequência.
    let entity = safeEntity(pokemon);
    if (entity && entity.getDynamicProperty("cobblemon:shouldered_on") !== undefined) {
      const shoulderOwner = pokemon.tryGetOwner();
      if (shoulderOwner) pokemon.return(shoulderOwner);
      entity = undefined;
    }
    if (entity && entity.getProperty("cobblemon:in_battle") === true) entity = undefined;
    // Evolution.evolutionMethod: o Pokémon não perde golpes ao evoluir (ex.: aprendeu no nível 17 um golpe
    // que a evolução só aprende no 18), então os acessíveis da forma anterior continuam acessíveis.
    const previousRelearnable = pokemon.getRelearnableMoves();
    pokemon = this.result.apply(pokemon);
    const owner = pokemon.tryGetOwner();
    const movesToLearn = [...new Set([...previousRelearnable, ...this.learnableMoves.map(x => toID(x))])];
    for (const move of movesToLearn) {
      if (!Dex.moves.get(move).exists || pokemon.moves.includes(move)) continue;
      const couldAdd = pokemon.teachMove(move);
      if (couldAdd && !previousRelearnable.includes(move))
        owner?.sendMessage(message.With("cobblemon.experience.learned_move", [pokemon, getMoveTranslation(move)]));
    }
    pokemon.readyEvolutions = [];
    // Pokédex: a espécie evoluída passa a obtida (POKEMON_EVOLVED → PokedexManager.obtain).
    if (owner) markCaught(owner, pokemon);
    // "Progresso Cobblemon" (AdvancementHandler.onEvolve).
    if (owner) {
      try { recordEvolution(owner, fromSpecies, { species: toSpeciesId(pokemon.species), aspects: pokemon.aspects, shiny: pokemon.shiny }); }
      catch { }
      // StatHandler.onEvolve (EVOLUTION_COMPLETE) e onDexEntryGain (POKEMON_GAINED do evolutionMethod).
      awardStat(owner, "evolved");
      awardStat(owner, "dex_entries");
    }
    // Evolution.evolutionMethod: shed (Shedinja) e drops da evolução.
    try { shed(this.shedder, pokemon, owner, fromSpecies, SHED_DEPS); }
    catch (e) { console.warn(`Shed de ${fromSpecies} falhou: ${e}`); }
    try { dropEvolutionLoot(this.drops, pokemon, owner, entity?.isValid ? entity : undefined); }
    catch (e) { console.warn(`Drops da evolução de ${fromSpecies} falharam: ${e}`); }
    if (entity?.isValid) {
      // Dados novos na entidade já (recolher no meio da sequência guarda a espécie nova); o modelo troca no fim.
      entity.setDynamicProperty("data", JSON.stringify(pokemon));
      pokemon.tryUpdatePokemonInTeam();
      startEvolutionSequence(entity, pokemon, preEvoName, owner, SEQUENCE_HOOKS);
    }
    else {
      pokemon.tryUpdatePokemonOut();
      pokemon.tryUpdatePokemonInTeam();
      announceEvolution(owner, preEvoName, pokemon);
    }
    // Como no Cobblemon, testa na hora as evoluções passivas da nova espécie (ex.: evoluiu tarde).
    pokemon.getEvolutions().forEach(evolution => {
      if (evolution instanceof PassiveEvolution) evolution.attemptEvolution(pokemon);
    });
    return pokemon;
  }
  /** Takes in the input recieved from the pokemon data and returns an instance of this class.
   * @throws If this is not overrided by inheritor.
   */
  static getFromSerializied(evolution: EvolutionEntry): Evolution {
    throw new Error("Evolution was not implimented properly.");
  };
}

export class PassiveEvolution extends Evolution {
  /**
  * Checks if the given [Pokemon] satisfies the requirements.
  * If yes the evolution will attempt to start.
  *
  * @param pokemon The [Pokemon] being tested.
  * @return If the [Pokemon] will evolve.
  */
  attemptEvolution(pokemon: PokemonData): boolean {
    if (this.test(pokemon)) {
      return this.evolve(pokemon);
    }
    return false;
  }
  static getFromSerializied(evolution: EvolutionEntry): PassiveEvolution {
    return new PassiveEvolution(evolution.id, PokemonProperties.parse(evolution.result), evolution.optional, evolution.consumeHeldItem, initializeRequirements(evolution.requirements), evolution.learnableMoves);
  };
}

/**
 * Represents an evolution of a [Pokemon] that can only occur during specific actions and with added context.
 * For the default implementations see [ItemInteractionEvolution] & [TradeEvolution].
 *
 * @param RC The context given at runtime when querying the [Evolution].
 * @param TC The context that is serialized from JSON during species loading, this is what the [RC] is expected to match against.
 */
export abstract class ContextEvolution<RC, TC> extends Evolution {
  //Boilerplate
  constructor(
    public requiredContext: TC,
    id = "id",
    result = new PokemonProperties(),
    optional = true,
    consumeHeldItem = true,
    requirements: EvolutionRequirement[] = [],
    learnableMoves: string[] = []
  ) {
    super(id, result, optional, consumeHeldItem, requirements, learnableMoves)
  }

  /** Test if the Context Evolution is valid. */
  abstract testContext(pokemon: PokemonData, context: RC): boolean;
  attemptEvolution(pokemon: PokemonData, context: RC): boolean {
    if (this.test(pokemon) && this.testContext(pokemon, context)) {
      return this.evolve(pokemon);
    }
    return false;
  }
}