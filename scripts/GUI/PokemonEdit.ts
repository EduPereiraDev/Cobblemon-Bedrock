/**
 * Criação e edição de Pokémon a partir de PokemonProperties do Cobblemon
 * (`pikachu level=30 shiny nature=adamant hp_iv=31 attack_ev=252`), usada por
 * givepokemon/spawnpokemon/pokemonedit e pela escolha do inicial, mais o formulário de edição
 * (admin) aberto por `/cobblemon:pokemonedit <slot>` sem propriedades.
 */
import { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { PokemonData, resolveNature } from "../Pokemon";
import { PokemonProperties } from "../PokemonProperties";
import { Dex, toID } from "../showdown";
import type { StatsTable } from "../showdown";
import { getAllSpeciesIds, getSpeciesData } from "../speciesData";
import { getConfig } from "../Config";
import { PCLocation } from "../pokemonStorage";
import { abilityName, natureName, savePokemon, tr } from "./common";

export const MAX_IV = 31;
export const MAX_EV = 252;
export const MAX_TOTAL_EVS = 510;

/** Ordem dos atributos na UI. */
export const STAT_ORDER: (keyof StatsTable)[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** Chave de tradução do nome de cada atributo (cobblemon.ui.stats.*). */
export const STAT_LANG: Record<keyof StatsTable, string> = {
  hp: "cobblemon.ui.stats.hp", atk: "cobblemon.ui.stats.atk", def: "cobblemon.ui.stats.def",
  spa: "cobblemon.ui.stats.sp_atk", spd: "cobblemon.ui.stats.sp_def", spe: "cobblemon.ui.stats.speed",
};

/** Limita EVs a 0..252 e o total a 510 (cortando dos últimos atributos). */
export function clampEvs(evs: StatsTable): StatsTable {
  const out = { ...evs };
  for (const stat of STAT_ORDER) out[stat] = Math.max(0, Math.min(MAX_EV, Math.floor(out[stat] || 0)));
  let excess = STAT_ORDER.reduce((sum, stat) => sum + out[stat], 0) - MAX_TOTAL_EVS;
  for (const stat of [...STAT_ORDER].reverse()) {
    if (excess <= 0) break;
    const cut = Math.min(out[stat], excess);
    out[stat] -= cut;
    excess -= cut;
  }
  return out;
}

function setShiny(pokemon: PokemonData, shiny: boolean) {
  pokemon.shiny = shiny;
  pokemon.aspects = pokemon.aspects.filter(x => x !== "shiny").concat(shiny ? ["shiny"] : []);
}

function setGender(pokemon: PokemonData, gender: string) {
  pokemon.gender = gender;
  pokemon.aspects = pokemon.aspects.filter(x => x !== "male" && x !== "female")
    .concat(gender === "m" ? ["male"] : gender === "f" ? ["female"] : []);
  // Corrige gênero impossível para a espécie (sem gênero, só macho, só fêmea).
  pokemon.checkGender();
}

/** Habilidades possíveis da forma atual (sem o prefixo "h:" das ocultas). */
export function getPossibleAbilities(pokemon: PokemonData): string[] {
  try { return pokemon.getAbilityEntries().map(x => toID(x.replace(/^h:/, ""))); }
  catch { return []; }
}

/**
 * Extras do port que o PokemonProperties do Cobblemon não tem: `ivs=31`/`evs=0` (todos os atributos) e
 * `mint=adamant` (natureza de Mint).
 */
export interface PropertyExtras {
  allIvs?: number;
  allEvs?: number;
  mint?: string;
}

export function parsePropertyExtras(extra: Record<string, string>): PropertyExtras {
  const out: PropertyExtras = {};
  const number = (value: string | undefined) => {
    const parsed = value === undefined ? NaN : parseInt(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  out.allIvs = number(extra.ivs);
  out.allEvs = number(extra.evs);
  const mint = extra.mint ?? extra.minted_nature ?? extra.mintednature;
  if (mint !== undefined) out.mint = mint;
  return out;
}

/**
 * Aplica propriedades a um Pokémon (pokemonedit). Usa PokemonProperties.apply (espécie, forma,
 * nível, gênero, shiny, IV/EV, habilidade...) e completa com item segurado, natureza e extras.
 * @returns o Pokémon editado (cópia com o mesmo UUID).
 */
export function applyPropertiesToPokemon(pokemon: PokemonData, props: PokemonProperties): PokemonData {
  const edited = props.apply(pokemon);
  if (props.nature !== undefined) edited.nature = resolveNature(props.nature) ?? edited.nature;
  if (props.heldItem !== undefined) {
    edited.minecraftItem = props.heldItem;
    edited.item = toID(props.heldItem.split(":").pop() ?? "");
  }
  const extras = parsePropertyExtras(props.extra);
  if (extras.allIvs !== undefined) for (const stat of STAT_ORDER) edited.setIv(stat, Math.max(0, Math.min(MAX_IV, extras.allIvs)));
  if (extras.allEvs !== undefined) {
    edited.evs = clampEvs({ hp: extras.allEvs, atk: extras.allEvs, def: extras.allEvs, spa: extras.allEvs, spd: extras.allEvs, spe: extras.allEvs });
    edited.recalculateHealth();
  }
  if (extras.mint !== undefined) edited.applyMint(extras.mint);
  return edited;
}

/**
 * Cria um Pokémon novo a partir de propriedades (givepokemon, spawnpokemon, iniciais).
 * Sem espécie (ou "random") sorteia uma espécie implementada.
 * @throws se a espécie não existir.
 */
export function createPokemonFromProperties(input: string | PokemonProperties, defaults: { level?: number; shiny?: boolean } = {}): PokemonData {
  const props = typeof input === "string" ? PokemonProperties.parse(input) : input;
  const species = props.species ?? randomSpecies();
  if (!getSpeciesData(species)) throw new Error(`Unknown species ${species}`);
  const level = props.level ?? defaults.level;
  const minPerfect = props.minPerfectIvs;
  const pokemon = PokemonData.generateNewWildPokemon(species, {
    level: level !== undefined && Number.isFinite(level) ? level : undefined,
    shiny: props.shiny ?? defaults.shiny,
    // `alpha` (isAlpha) entra já na criação: escala e moveset de Alfa saem daqui.
    aspects: props.isAlpha ? [...props.aspects, "alpha"] : props.aspects,
    hiddenAbility: props.hiddenAbility,
    minPerfectIvs: minPerfect !== undefined && Number.isFinite(minPerfect) ? minPerfect : undefined,
  });
  // O restante (gênero, natureza, IVs...) passa pelo mesmo caminho da edição.
  const rest = PokemonProperties.parse(props.originalString);
  rest.species = undefined;
  rest.level = undefined;
  rest.shiny = undefined;
  rest.aspects = [];
  rest.hiddenAbility = undefined;
  rest.minPerfectIvs = undefined;
  rest.isAlpha = undefined;
  const result = applyPropertiesToPokemon(pokemon, rest);
  result.updateMaxHP();
  result.currentHealth = result.maxHealth;
  return result;
}

function randomSpecies(): string {
  const all = getAllSpeciesIds().filter(id => getSpeciesData(id)?.implemented !== false);
  return all[Math.floor(Math.random() * all.length)];
}

/**
 * Formulário de edição (admin): nível, shiny, gênero, natureza, habilidade, IVs e EVs.
 * @param player quem vê o formulário
 * @param owner dono do Pokémon (padrão: o próprio `player`)
 */
export async function showPokemonEditForm(player: Player, location: PCLocation, pokemon: PokemonData, owner: Player = player): Promise<boolean> {
  const natures = Dex.natures.all().map(x => x.name).sort();
  const abilities = getPossibleAbilities(pokemon);
  if (pokemon.ability && !abilities.includes(toID(pokemon.ability))) abilities.push(toID(pokemon.ability));
  const genders = ["m", "f", ""];
  const currentNature = resolveNature(pokemon.nature) ?? pokemon.nature;
  const form = new ModalFormData()
    .title({ rawtext: [{ translate: "cobblemon.ui.summary.title" }, { text: " - " }, pokemon.getTranslatedName()] })
    .slider({ translate: "cobblemon.ui.lv" }, 1, getConfig().maxPokemonLevel, { defaultValue: pokemon.level })
    .toggle("Shiny", { defaultValue: !!pokemon.shiny })
    .dropdown({ translate: "cobblemon.ui.info.gender" }, [{ translate: "cobblemon.gender.male" }, { translate: "cobblemon.gender.female" }, { translate: "cobblemon.gender.genderless" }],
      { defaultValueIndex: Math.max(0, genders.indexOf(pokemon.gender)) })
    .dropdown({ translate: "cobblemon.ui.info.nature" }, natures.map(natureName), { defaultValueIndex: Math.max(0, natures.indexOf(currentNature)) })
    .dropdown({ translate: "cobblemon.ui.info.ability" }, abilities.length ? abilities.map(abilityName) : ["-"],
      { defaultValueIndex: Math.max(0, abilities.indexOf(toID(pokemon.ability))) });
  for (const stat of STAT_ORDER)
    form.slider(tr("cobblemon.port.edit.iv", tr(STAT_LANG[stat])), 0, MAX_IV, { defaultValue: pokemon.ivs[stat] ?? 0 });
  for (const stat of STAT_ORDER)
    form.slider(tr("cobblemon.port.edit.ev", tr(STAT_LANG[stat])), 0, MAX_EV, { defaultValue: pokemon.evs[stat] ?? 0, valueStep: 4 });
  const response = await form.show(player);
  const values = response.formValues;
  if (!values) return false;
  const [level, shiny, gender, nature, ability] = values;
  if (typeof level === "number") pokemon.setLevel(level);
  if (typeof shiny === "boolean") setShiny(pokemon, shiny);
  if (typeof gender === "number") setGender(pokemon, genders[gender]);
  if (typeof nature === "number" && natures[nature]) pokemon.nature = natures[nature];
  if (typeof ability === "number" && abilities[ability]) pokemon.setAbility(abilities[ability]);
  STAT_ORDER.forEach((stat, i) => {
    const iv = values[5 + i];
    if (typeof iv === "number") pokemon.ivs[stat] = iv;
  });
  const evs = { ...pokemon.evs };
  STAT_ORDER.forEach((stat, i) => {
    const ev = values[11 + i];
    if (typeof ev === "number") evs[stat] = ev;
  });
  pokemon.evs = clampEvs(evs);
  pokemon.recalculateHealth();
  if (!owner.isValid) return false;
  savePokemon(owner, location, pokemon);
  player.sendMessage(tr("cobblemon.command.pokemonedit", pokemon, owner.name));
  return true;
}
