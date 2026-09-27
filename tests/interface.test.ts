// Frente "interface": armazenamento (time/PC), config, ajudantes de comando e telas (partes puras),
// com a API do Minecraft mockada e um jogador falso que guarda dynamic properties num Map.
import assert from "node:assert/strict";
import { PokemonData } from "../scripts/Pokemon";
import {
  PCPlace, StorageResult, clearPC, clearParty, countBox, countParty, depositToPC, findFirstEmptyBoxSlot, findPokemonLocation,
  getBoxCount, getBoxName, getPokemonFromPCLocation, getSafeTeam, isValidLocation, movePokemon, releasePokemon, renameBox,
  setBoxCount, setPokemonToPCLocation, spacesPerBox, storePokemonInFirstSpace, withdrawFromPC,
} from "../scripts/pokemonStorage";
import {
  CONFIG_FIELDS, DEFAULT_CONFIG, CobblemonConfig, coerceConfigValue, getConfig, parseConfig, updateConfig, resetConfig,
} from "../scripts/Config";
import { findConfigKey, parseBoxArg, parseConfigAssignment, parseDexRange, parseSlotArg, STARTER_KIT } from "../scripts/commands";
import { applyPropertiesToPokemon, clampEvs, createPokemonFromProperties, parsePropertyExtras } from "../scripts/GUI/PokemonEdit";
import { PokemonProperties } from "../scripts/PokemonProperties";
import { forgetMove, swapMoves } from "../scripts/GUI/Moves";
import { renderPartyHud } from "../scripts/GUI/PartyHud";
import { buildSummarySections } from "../scripts/GUI/Summary";
import { getStarterCategories, starterSpecies } from "../scripts/GUI/StarterGUI";
import { wrapBox } from "../scripts/GUI/PC";

/** Jogador falso: só o que o armazenamento usa. */
class FakePlayer {
  id = "player-1";
  name = "Ash";
  isValid = true;
  props = new Map<string, string | number | boolean>();
  messages: unknown[] = [];
  getDynamicProperty(key: string) { return this.props.get(key); }
  setDynamicProperty(key: string, value?: string | number | boolean) {
    if (value === undefined) this.props.delete(key);
    else this.props.set(key, value);
  }
  sendMessage(msg: unknown) { this.messages.push(msg); }
}
const newPlayer = () => new FakePlayer() as any;
const mon = (species = "pikachu", level = 10) => PokemonData.generateNewWildPokemon(species, { level, shiny: false });

// ---------------------------------------------------------------------------------------------
// 1. Config

{
  const config = parseConfig(undefined);
  assert.equal(config.defaultBoxCount, 40);
  assert.equal(config.shinyRate, 8192);
  assert.equal(config.maxPokemonLevel, 100);
  assert.equal(config.starters.length, 11, "11 categorias de iniciais do Cobblemon 1.8.2");
  // 5 campos só informativos saíram do editor (INFO_ONLY_FIELDS, frente jogabilidade).
  assert.ok(CONFIG_FIELDS.length >= 85, `esperava ~85+ campos editáveis, veio ${CONFIG_FIELDS.length}`);
  for (const field of CONFIG_FIELDS) assert.ok(field.key in DEFAULT_CONFIG, `campo sem padrão: ${field.key}`);

  // Persistência: JSON salvo → parse devolve o mesmo.
  const custom = parseConfig({ shinyRate: 512, enableSpawning: false, worldSpawningBlocklist: ["minecraft:the_end"] });
  const roundTrip = parseConfig(JSON.stringify(custom));
  assert.equal(roundTrip.shinyRate, 512);
  assert.equal(roundTrip.enableSpawning, false);
  assert.deepEqual(roundTrip.worldSpawningBlocklist, ["minecraft:the_end"]);
  assert.equal(roundTrip.maxPokemonLevel, 100, "campos ausentes usam o padrão");

  // Nomes antigos do port são migrados e continuam como getters.
  const legacy = parseConfig('{"maxPokemonFriendShip":200,"allowExperienceFromPVP":false,"maxNearbyBlocksVerticleRange":5}');
  assert.equal(legacy.maxPokemonFriendship, 200);
  assert.equal(legacy.maxPokemonFriendShip, 200);
  assert.equal(legacy.allowExperienceFromPvP, false);
  assert.equal(legacy.allowExperienceFromPVP, false);
  assert.equal(legacy.maxNearbyBlocksVerticalRange, 5);
  assert.ok(!("maxPokemonFriendShip" in JSON.parse(JSON.stringify(legacy))), "nome antigo não é salvo");

  // Tipos errados são ignorados; números são limitados às faixas do Cobblemon.
  const bad = parseConfig({ maxPokemonLevel: 5000, shinyRate: "abc", enableSpawning: "sim", defaultBoxCount: 0, starters: [{ nope: 1 }] });
  assert.equal(bad.maxPokemonLevel, 1000);
  assert.equal(bad.shinyRate, 8192);
  assert.equal(bad.enableSpawning, true);
  assert.equal(bad.defaultBoxCount, 1);
  assert.deepEqual(bad.starters, []);
  assert.equal(parseConfig("{not json").shinyRate, 8192);
  assert.equal(parseConfig("[]").shinyRate, 8192);

  assert.equal(coerceConfigValue("experienceMultiplier", "1,5"), 1.5);
  assert.equal(coerceConfigValue("maxPokemonLevel", "50.6"), 51);
  assert.equal(coerceConfigValue("maxPokemonLevel", ""), undefined);
  assert.equal(coerceConfigValue("enableSpawning", "false"), false);
  assert.deepEqual(coerceConfigValue("worldSpawningBlocklist", "a, b,,c"), ["a", "b", "c"]);
  assert.equal(coerceConfigValue("defaultDropItemMethod", "on_player"), "on_player");
  assert.equal(coerceConfigValue("defaultDropItemMethod", "nowhere"), undefined);

  assert.ok(new CobblemonConfig() instanceof CobblemonConfig);
  assert.equal(getConfig().defaultBoxCount, 40, "getConfig antes do worldLoad devolve o padrão");
}

// ---------------------------------------------------------------------------------------------
// 2. Armazenamento: time, PC, limites

{
  const player = newPlayer();
  assert.equal(getBoxCount(player), 40); // defaultBoxCount do Cobblemon 1.8.2 (frente jogabilidade)
  // Enche o time e transborda para o PC.
  const created: PokemonData[] = [];
  for (let i = 0; i < 8; i++) {
    const p = mon("bulbasaur", 5 + i);
    created.push(p);
    const result = storePokemonInFirstSpace(p, player);
    if (i < 6) assert.equal(result, undefined, "time com espaço não manda mensagem");
    else assert.equal((result as any).translate, "cobblemon.overflow_to_pc");
  }
  assert.equal(countParty(player), 6);
  assert.equal(countBox(player, 0), 2);
  assert.equal(player.props.get("pc:0:0") !== undefined, true, "formato pc:<caixa>:<espaço> mantido");
  assert.deepEqual(findFirstEmptyBoxSlot(player), { location: PCPlace.Box, boxID: 0, space: 2 });
  assert.deepEqual(findPokemonLocation(player, created[7].uuid), { location: PCPlace.Box, boxID: 0, space: 1 });

  // Limites de caixa/espaço.
  assert.ok(isValidLocation(player, { location: PCPlace.Box, boxID: 29, space: 29 }));
  assert.ok(!isValidLocation(player, { location: PCPlace.Box, boxID: 40, space: 0 }));
  assert.ok(!isValidLocation(player, { location: PCPlace.Box, boxID: -1, space: 0 }));
  assert.ok(!isValidLocation(player, { location: PCPlace.Box, boxID: 0, space: spacesPerBox }));
  assert.ok(!isValidLocation(player, { location: PCPlace.Team, space: 6 }));
  assert.ok(!isValidLocation(player, { location: PCPlace.Box, boxID: 0.5, space: 0 }));
  assert.equal(getPokemonFromPCLocation(player, { location: PCPlace.Box, boxID: 99, space: 0 }), undefined);
  assert.throws(() => setPokemonToPCLocation(player, { location: PCPlace.Box, boxID: 40, space: 0 }, created[0]));

  // Mover para espaço vazio e trocar dois ocupados (ida e volta preserva os dados).
  const team0 = getSafeTeam(player)[0]!;
  const target = { location: PCPlace.Box, boxID: 3, space: 7 };
  assert.equal(movePokemon(player, { location: PCPlace.Team, space: 0 }, target), StorageResult.Ok);
  assert.equal(getSafeTeam(player)[0], null);
  assert.equal(getPokemonFromPCLocation(player, target)!.uuid, team0.uuid);
  assert.equal(JSON.stringify(getPokemonFromPCLocation(player, target)), JSON.stringify(team0));
  assert.equal(movePokemon(player, target, { location: PCPlace.Team, space: 0 }), StorageResult.Ok);
  assert.equal(getSafeTeam(player)[0]!.uuid, team0.uuid);
  assert.equal(player.props.get("pc:3:7"), undefined, "espaço esvaziado some das dynamic properties");

  const boxA = getPokemonFromPCLocation(player, { location: PCPlace.Box, boxID: 0, space: 0 })!;
  const team1 = getSafeTeam(player)[1]!;
  assert.equal(movePokemon(player, { location: PCPlace.Box, boxID: 0, space: 0 }, { location: PCPlace.Team, space: 1 }), StorageResult.Ok);
  assert.equal(getSafeTeam(player)[1]!.uuid, boxA.uuid);
  assert.equal(getPokemonFromPCLocation(player, { location: PCPlace.Box, boxID: 0, space: 0 })!.uuid, team1.uuid);
  assert.equal(movePokemon(player, { location: PCPlace.Box, boxID: 5, space: 5 }, { location: PCPlace.Team, space: 1 }), StorageResult.EmptySource);
  assert.equal(movePokemon(player, { location: PCPlace.Team, space: 1 }, { location: PCPlace.Box, boxID: 41, space: 0 }), StorageResult.InvalidLocation);

  // Depositar/retirar.
  assert.equal(depositToPC(player, 2), StorageResult.Ok);
  assert.equal(countParty(player), 5);
  assert.equal(withdrawFromPC(player, 0, 1), StorageResult.Ok);
  assert.equal(countParty(player), 6);
  assert.equal(withdrawFromPC(player, 0, 2), StorageResult.NoSpace, "time cheio");

  // Soltar: no PC pode; o último do time não.
  const inBox = findFirstEmptyBoxSlot(player)!;
  setPokemonToPCLocation(player, inBox, mon("eevee"));
  assert.equal(releasePokemon(player, inBox), StorageResult.Ok);
  assert.equal(getPokemonFromPCLocation(player, inBox), null);
  assert.equal(releasePokemon(player, inBox), StorageResult.EmptySource);

  // Nomes de caixa.
  assert.ok(renameBox(player, 2, "  §cMeus iniciais que são muito legais demais  "));
  assert.equal(getBoxName(player, 2), "Meus iniciais que são muito legais demais".slice(0, 32), "sem cor, sem espaços, até 32");
  assert.ok(renameBox(player, 2, ""));
  assert.equal(getBoxName(player, 2), undefined);
  assert.ok(!renameBox(player, 40, "x"));

  // Número de caixas por jogador: não encolhe sobre caixa ocupada, a menos que force.
  setPokemonToPCLocation(player, { location: PCPlace.Box, boxID: 20, space: 0 }, mon("eevee"));
  assert.equal(setBoxCount(player, 10), false);
  assert.equal(getBoxCount(player), 40);
  assert.equal(setBoxCount(player, 40), true);
  assert.equal(getBoxCount(player), 40);
  assert.ok(isValidLocation(player, { location: PCPlace.Box, boxID: 39, space: 0 }));
  assert.equal(setBoxCount(player, 10, true), true);
  assert.equal(getBoxCount(player), 10);
  assert.equal(setBoxCount(player, 0), false);
  assert.equal(setBoxCount(player, 20), true);
  assert.equal(countBox(player, 19), 0);

  // Limpar.
  const removed = clearParty(player);
  assert.equal(removed.length, 6);
  assert.equal(countParty(player), 0);
  assert.equal(getSafeTeam(player).length, 6);
  assert.ok(clearPC(player) > 0);
  assert.equal(findFirstEmptyBoxSlot(player)!.boxID, 0);
  assert.equal(findFirstEmptyBoxSlot(player)!.space, 0);
}

// Último do time: soltar é recusado; preventCompletePartyDeposit bloqueia depositar o último.
{
  const player = newPlayer();
  storePokemonInFirstSpace(mon("charmander"), player);
  assert.equal(releasePokemon(player, { location: PCPlace.Team, space: 0 }), StorageResult.LastPartyPokemon);
  assert.equal(depositToPC(player, 0), StorageResult.Ok, "sem a opção, pode esvaziar o time");
  assert.equal(withdrawFromPC(player, 0, 0), StorageResult.Ok);
  updateConfig({ preventCompletePartyDeposit: true });
  assert.equal(depositToPC(player, 0), StorageResult.LastPartyPokemon);
  resetConfig();
  assert.equal(getConfig().preventCompletePartyDeposit, false);
}

// Caixas vindas da config (defaultBoxCount).
{
  updateConfig({ defaultBoxCount: 40 });
  assert.equal(getBoxCount(newPlayer()), 40);
  resetConfig();
}

// ---------------------------------------------------------------------------------------------
// 3. Ajudantes de comando

assert.equal(parseSlotArg(1), 0);
assert.equal(parseSlotArg(6), 5);
assert.equal(parseSlotArg(0), undefined);
assert.equal(parseSlotArg(7), undefined);
assert.equal(parseSlotArg(2.5), undefined);
assert.equal(parseSlotArg(30, 30), 29);
assert.equal(parseBoxArg(30, 30), 29);
assert.equal(parseBoxArg(31, 30), undefined);
assert.deepEqual(parseDexRange(undefined, undefined, 1025), [1, 1025]);
assert.deepEqual(parseDexRange(151, 1, 1025), [1, 151]);
assert.deepEqual(parseDexRange(-5, 5000, 1025), [1, 1025]);
assert.equal(findConfigKey("shiny_rate"), "shinyRate");
assert.equal(findConfigKey("SHINYRATE"), "shinyRate");
assert.equal(findConfigKey("default_box_count"), "defaultBoxCount");
assert.equal(findConfigKey("mainCharacter"), "mainCharacter");
assert.equal(findConfigKey("nada"), undefined);
assert.deepEqual(parseConfigAssignment("shiny_rate", "512"), { key: "shinyRate", value: 512 });
assert.ok("error" in parseConfigAssignment("shiny_rate", "muito"));
assert.ok("error" in parseConfigAssignment("xyz", "1"));
assert.ok(STARTER_KIT.every(([id, n]) => id.startsWith("cobblemon:") && n > 0));

// ---------------------------------------------------------------------------------------------
// 4. Criação/edição por propriedades

{
  const pokemon = createPokemonFromProperties("pikachu level=30 shiny nature=adamant hp_iv=31 attack_ev=252 gender=female nickname=Sparky");
  assert.equal(pokemon.species, "pikachu");
  assert.equal(pokemon.level, 30);
  assert.equal(pokemon.shiny, true);
  assert.ok(pokemon.aspects.includes("shiny"));
  assert.equal(pokemon.nature, "Adamant");
  assert.equal(pokemon.ivs.hp, 31);
  assert.equal(pokemon.evs.atk, 252);
  assert.equal(pokemon.gender, "f");
  assert.equal(pokemon.name, "Sparky");
  assert.equal(pokemon.currentHealth, pokemon.maxHealth);
  assert.throws(() => createPokemonFromProperties("level=5 species=naoexiste"));

  const edited = applyPropertiesToPokemon(pokemon, PokemonProperties.parse("level=50 ivs=0 mint=timid"));
  assert.equal(edited.uuid, pokemon.uuid);
  assert.equal(edited.level, 50);
  assert.ok(Object.values(edited.ivs).every(x => x === 0));
  assert.equal(edited.mintedNature, "Timid");
  assert.deepEqual(parsePropertyExtras({ ivs: "31", evs: "x", mint: "bold" }), { allIvs: 31, allEvs: undefined, mint: "bold" });
  const clamped = clampEvs({ hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 300 });
  assert.equal(Object.values(clamped).reduce((a, b) => a + b, 0), 510);
  assert.equal(clamped.hp, 252);
  assert.equal(clamped.atk, 252);
  assert.equal(clamped.def, 6);
  assert.equal(clamped.spe, 0);

  const starter = createPokemonFromProperties("rowlet region-bias-hisui level=10 pokeball=cobblemon:ancient_poke_ball");
  assert.ok(starter.aspects.includes("region-bias-hisui"));
  assert.equal(starter.pokeball, "cobblemon:ancient_poke_ball");
  assert.equal(starter.level, 10);
}

// ---------------------------------------------------------------------------------------------
// 5. Golpes, HUD, resumo, iniciais

{
  const pokemon = mon("pikachu", 40);
  while (pokemon.moves.length < 3) pokemon.teachMove(["thunderbolt", "quickattack", "irontail"][pokemon.moves.length]);
  const [a, b] = pokemon.moves;
  const [infoA, infoB] = pokemon.movesInfo;
  assert.ok(swapMoves(pokemon, 0, 1));
  assert.deepEqual(pokemon.moves.slice(0, 2), [b, a]);
  assert.equal(pokemon.movesInfo[0], infoB);
  assert.equal(pokemon.movesInfo[1], infoA);
  assert.ok(!swapMoves(pokemon, 0, 9));
  const count = pokemon.moves.length;
  assert.ok(forgetMove(pokemon, 0));
  assert.equal(pokemon.moves.length, count - 1);

  const hud = renderPartyHud([pokemon, null, mon("eevee", 5), mon("mew", 5), mon("snorlax", 5)]);
  assert.ok(hud && Array.isArray(hud.rawtext));
  const text = JSON.stringify(hud);
  assert.ok(text.includes("cobblemon.species.pikachu.name"));
  assert.ok(text.includes("\\n"), "4 Pokémon quebram em duas linhas");
  assert.equal(renderPartyHud([null, null]), undefined);

  const sections = buildSummarySections(pokemon);
  assert.deepEqual(sections.map(s => s.title), ["cobblemon.ui.info", "cobblemon.ui.stats", "cobblemon.ui.moves", "cobblemon.port.summary.marks"]);
  assert.ok(sections[1].lines.length >= 7, "cabeçalho + 6 atributos");
  assert.equal(sections[2].lines.length, pokemon.moves.length);

  const categories = getStarterCategories();
  assert.equal(categories.length, 11);
  assert.deepEqual(categories[0].pokemon.map(starterSpecies), ["bulbasaur", "charmander", "squirtle"]);
  assert.ok(categories.find(c => c.name === "Special")!.randomStarter);
  assert.equal(starterSpecies("rowlet region-bias-hisui level=10"), "rowlet");

  assert.equal(wrapBox(0, -1, 30), 29);
  assert.equal(wrapBox(29, 1, 30), 0);
}

// ---------------------------------------------------------------------------------------------
// Guardar no time/PC de um jogador define o dono (trainer): evoluir/EXP sem nunca ter saído da bola.

{
  const player = newPlayer();
  const first = mon("charmander");
  first.trainer = undefined;
  first.ogTrainer = undefined;
  storePokemonInFirstSpace(first, player);
  const inTeam = getSafeTeam(player)[0]!;
  assert.equal(inTeam.trainer, "player-1");
  assert.equal(inTeam.ogTrainer, "Ash", "sem treinador original: vira o jogador");

  const traded = Object.assign(mon("eevee"), { trainer: "outro", ogTrainer: "Brock" });
  const boxSlot = { location: PCPlace.Box, boxID: 2, space: 4 };
  setPokemonToPCLocation(player, boxSlot, traded);
  const inBox = getPokemonFromPCLocation(player, boxSlot)!;
  assert.equal(inBox.trainer, "player-1");
  assert.equal(inBox.ogTrainer, "Brock", "treinador original mantido");

  // Transbordo para o PC também.
  for (let i = 0; i < 6; i++) storePokemonInFirstSpace(mon("bulbasaur"), player);
  const overflow = findFirstEmptyBoxSlot(player);
  assert.ok(overflow);
  const last = mon("squirtle");
  storePokemonInFirstSpace(last, player);
  assert.equal(getPokemonFromPCLocation(player, overflow!)!.trainer, "player-1");
  // Esvaziar um espaço continua valendo.
  setPokemonToPCLocation(player, boxSlot, null);
  assert.equal(getPokemonFromPCLocation(player, boxSlot), null);
}

console.log("interface.test.ts: ok");
