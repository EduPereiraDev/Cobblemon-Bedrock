/**
 * Frente dados-ia: features de espécie de todas as `species_feature_assignments` (87 no Cobblemon 1.8.2) e de
 * `species.features`, com as definições de `species_features` (generated/scripts/dadosIa.ts).
 *
 * No Cobblemon, trocar a espécie (criação e evolução) roda `SpeciesFeatures.getFeaturesFor(species).invoke(pokemon)`:
 * - a feature que o Pokémon já tem e ainda vale fica (ex.: `alolan` do Rattata passa ao Raticate; a cor do Wooloo
 *   ao Dubwool);
 * - senão entra o padrão: escolha (`choice`) = `default` se for uma das escolhas, sorteio se `default` = "random",
 *   nada nos outros casos; `weighted_choice` sorteia pelos pesos; `flag` = "true"/"false"/"random".
 * Depois `updateAspects` gera os aspects: `aspectFormat` com a escolha, ou a primeira chave da flag ligada.
 *
 * No port os valores de feature de aspect são guardados como os próprios aspects (PokemonData.aspects). Features
 * inteiras (Gimmighoul, blocks_traveled) e a cauda do Slowpoke continuam em pokemon/SpeciesFeatures.ts.
 */
import { FEATURE_DEFS, FeatureDef, GLOBAL_FEATURES, SPECIES_FEATURES } from "../../generated/scripts/dadosIa";

export type { FeatureDef };

function speciesKey(species: string): string {
  return species.replace(/^cobblemon:/, "").toLowerCase();
}

/** Nomes das features da espécie (species.features + atribuições + globais). */
export function featureNamesOf(species: string): string[] {
  return [...new Set([...(SPECIES_FEATURES[speciesKey(species)] ?? []), ...GLOBAL_FEATURES])];
}

export function featureDef(name: string): FeatureDef | undefined {
  return FEATURE_DEFS[name];
}

/** Escolhas válidas (choice e weighted_choice). */
export function choicesOf(def: FeatureDef): string[] {
  return def.type === "weighted_choice" ? Object.keys(def.weights ?? {}) : def.choices ?? [];
}

/** Aspect de uma escolha (aspectFormat com {{choice}}) ou da flag ligada (primeira chave). */
export function aspectOf(def: FeatureDef, value: string | boolean): string | undefined {
  if (!def.isAspect) return undefined;
  if (def.type === "flag") return value === true || value === "true" ? def.keys[0] : undefined;
  if (def.type === "integer") return undefined;
  return def.aspectFormat.replace(/\{\{\s*choice\s*\}\}/g, String(value).toLowerCase());
}

/** Todos os aspects que a feature pode dar (AspectProvider.getAllAspects). */
export function allAspectsOf(def: FeatureDef): string[] {
  if (!def.isAspect) return [];
  if (def.type === "flag") return [def.keys[0]];
  return choicesOf(def).map(choice => aspectOf(def, choice)!).filter(Boolean);
}

/** Valor atual da feature a partir dos aspects (undefined = o Pokémon não tem a feature). */
export function featureValueFromAspects(def: FeatureDef, aspects: readonly string[]): string | undefined {
  if (def.type === "flag") return def.isAspect && aspects.includes(def.keys[0]) ? "true" : undefined;
  for (const choice of choicesOf(def)) {
    const aspect = aspectOf(def, choice);
    if (aspect && aspects.includes(aspect)) return choice;
  }
  return undefined;
}

/** WeightedChoiceSpeciesFeatureProvider: sorteio pelos pesos. */
function weightedPick(weights: Record<string, number>, random: () => number): string | undefined {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (!entries.length) return undefined;
  let pick = random() * total;
  for (const [choice, weight] of entries) {
    pick -= Math.max(0, weight);
    if (pick < 0) return choice;
  }
  return entries[entries.length - 1][0];
}

/** Valor padrão ao ganhar a feature (ChoiceSpeciesFeatureProvider/FlagSpeciesFeatureProvider.invoke). */
export function defaultValue(def: FeatureDef, random: () => number = Math.random): string | undefined {
  const d = def.default === undefined ? undefined : String(def.default).toLowerCase();
  if (def.type === "flag") {
    if (d === "random") return random() < 0.5 ? "true" : "false";
    return d === "true" || d === "false" ? d : undefined;
  }
  if (def.type === "integer") return undefined;
  const choices = choicesOf(def);
  if (d !== undefined && choices.includes(d)) return d;
  if (d === "random") {
    if (def.type === "weighted_choice") return weightedPick(def.weights ?? {}, random);
    return choices.length ? choices[Math.floor(random() * choices.length)] : undefined;
  }
  return undefined;
}

/**
 * Garante os aspects das features de aspect da espécie: quem já tem valor fica; quem não tem recebe o padrão.
 * @returns true se mudou os aspects.
 */
export function applyFeatureDefaults(pokemon: { species: string; aspects: string[] }, random: () => number = Math.random): boolean {
  let changed = false;
  for (const name of featureNamesOf(pokemon.species)) {
    const def = featureDef(name);
    if (!def?.isAspect || def.type === "integer") continue;
    if (featureValueFromAspects(def, pokemon.aspects) !== undefined) continue;
    const value = defaultValue(def, random);
    const aspect = value === undefined ? undefined : aspectOf(def, value);
    if (!aspect) continue;
    pokemon.aspects = [...pokemon.aspects, aspect];
    changed = true;
  }
  return changed;
}

/** Aspects de features que a espécie nova também tem (ficam na evolução/troca de espécie). */
export function sharedAssignedFeatureAspects(aspects: readonly string[], newSpecies: string): string[] {
  const kept: string[] = [];
  for (const name of featureNamesOf(newSpecies)) {
    const def = featureDef(name);
    if (!def) continue;
    const all = allAspectsOf(def);
    kept.push(...aspects.filter(aspect => all.includes(aspect) && !kept.includes(aspect)));
  }
  return kept;
}

/** Feature da espécie pela chave de propriedade (`keys`, ex.: "colour" → color). */
export function featureByKey(species: string, key: string): FeatureDef | undefined {
  const k = key.toLowerCase();
  for (const name of featureNamesOf(species)) {
    const def = featureDef(name);
    if (def && def.keys.some(x => x.toLowerCase() === k)) return def;
  }
  return undefined;
}

/**
 * Propriedade `chave=valor` de uma feature de aspect da espécie (CustomPokemonProperty das features):
 * troca o aspect da feature. @returns true se a chave é de uma feature de aspect da espécie.
 */
export function setFeatureProperty(pokemon: { species: string; aspects: string[] }, key: string, value: string): boolean {
  const def = featureByKey(pokemon.species, key);
  if (!def || !def.isAspect || def.type === "integer") return false;
  const v = value.toLowerCase();
  if (def.type !== "flag" && !choicesOf(def).includes(v)) return true;
  if (def.type === "flag" && v !== "true" && v !== "false") return true;
  const all = allAspectsOf(def);
  const aspect = aspectOf(def, v);
  pokemon.aspects = pokemon.aspects.filter(a => !all.includes(a)).concat(aspect ? [aspect] : []);
  return true;
}

/** Valor da feature de aspect pela chave (para `matches` de PokemonProperties); undefined = não é dessa espécie. */
export function getFeatureProperty(pokemon: { species: string; aspects: readonly string[] }, key: string): string | undefined {
  const def = featureByKey(pokemon.species, key);
  if (!def || !def.isAspect || def.type === "integer") return undefined;
  return featureValueFromAspects(def, pokemon.aspects) ?? (def.type === "flag" ? "false" : undefined);
}
