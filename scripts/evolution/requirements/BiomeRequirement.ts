import { Entity } from "@minecraft/server";
import { PokemonData } from "../../Pokemon";
import { EvoRequirement } from "../../speciesData";
import EntityQueryRequirement from "../EntityQueryRequirement";
import { isInBiome } from "../../utils";
import { BIOME_TAGS } from "../../../generated/scripts/biomeTags";

/** Resolve "#cobblemon:tag" (ou um id de bioma direto) para a lista de biomas do Bedrock. */
function resolveBiomes(value: string): string[] {
  if (value.startsWith("#"))
    return BIOME_TAGS[value.slice(1)] ?? [];
  return [value.replace(/^minecraft:/, "")];
}

/** Requisito de bioma (evoluções regionais). Verifica onde o Pokémon (ou o dono) está. */
export default class BiomeRequirement extends EntityQueryRequirement {
  variant = "biome";
  constructor(
    public biomeCondition?: string,
    public biomeAnticondition?: string
  ) { super() }
  queryCheck(pokemon: PokemonData, entity: Entity): boolean {
    if (this.biomeCondition && !isInBiome(entity.dimension, entity.location, resolveBiomes(this.biomeCondition)))
      return false;
    if (this.biomeAnticondition && isInBiome(entity.dimension, entity.location, resolveBiomes(this.biomeAnticondition)))
      return false;
    return true;
  }
  static getFromSerialized(requirement: EvoRequirement): BiomeRequirement {
    return new BiomeRequirement(requirement.biomeCondition, requirement.biomeAnticondition);
  }
}
