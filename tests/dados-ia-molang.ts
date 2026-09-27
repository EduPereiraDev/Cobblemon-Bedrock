// Frente "dados-ia" (itens #70/#84 da paridade: MoLang de datapack): funções gerais, q.pokemon completo, q.item,
// q.player (Pokédex, TMs, inicial, time/PC) e q.world do Cobblemon 1.8.2 no interpretador MoLang do servidor.
// Não termina em .test.ts: quem roda chama `runMolangTests()`.
import assert from "node:assert/strict";
import { world } from "@minecraft/server";
import { MoArray, MoEnvironment, MoStruct, asString } from "../scripts/npc/molang/MoLang";
import { PokemonData } from "../scripts/Pokemon";
import { createPokemonStruct, createSpeciesStruct } from "../scripts/molang/PokemonStruct";
import { createItemStackStruct } from "../scripts/molang/ItemStackStruct";
import { createWorldStruct, isTimeOfDay, lootTablePaths } from "../scripts/molang/WorldStruct";
import { STARTER_UUID_PROPERTY, createPokedexStruct } from "../scripts/molang/PlayerFunctions";
import { createPlayerStruct } from "../scripts/npc/PlayerStruct";
import { evaluateChance } from "../scripts/evolution/requirements/GenericRequirements";
import { markCaught, markSeen } from "../scripts/pokedex/PokedexStorage";

// ---------------------------------------------------------------------------------------------
// Falsos do mundo (só o que as funções leem)

interface FakeEnchantment { type: { id: string }; level: number }

class FakeStack {
  maxAmount = 64;
  constructor(public typeId: string, public amount = 1, public enchantments: FakeEnchantment[] = [], public tags: string[] = []) { }
  getComponent(id: string) {
    if (id === "minecraft:enchantable") return { getEnchantments: () => this.enchantments };
    return undefined;
  }
  hasTag(tag: string) { return this.tags.includes(tag); }
  clone() { return new FakeStack(this.typeId, this.amount, this.enchantments, this.tags); }
}

class FakeDimension {
  id = "minecraft:overworld";
  spawned: { typeId: string; location: unknown }[] = [];
  spawnItem(stack: FakeStack, location: unknown) { this.spawned.push({ typeId: stack.typeId, location }); }
  getBiome() { return { id: "minecraft:plains", getTags: () => ["plains"], hasTags: () => false }; }
  getTopmostBlock() { return undefined; }
  getBlock() { return undefined; }
  getEntities() { return []; }
}

class FakeEntity {
  isValid = true;
  nameTag = "";
  props = new Map<string, unknown>();
  properties = new Map<string, unknown>();
  tags = new Set<string>();
  location = { x: 10, y: 64, z: -3 };
  constructor(public id: string, public typeId: string, public dimension: FakeDimension = new FakeDimension()) { }
  getDynamicProperty(key: string) { return this.props.get(key); }
  setDynamicProperty(key: string, value?: unknown) { if (value === undefined) this.props.delete(key); else this.props.set(key, value); }
  getDynamicPropertyIds() { return [...this.props.keys()]; }
  getProperty(key: string) { return this.properties.get(key); }
  setProperty(key: string, value: unknown) { this.properties.set(key, value); }
  getVelocity() { return { x: 0, y: 0, z: 0 }; }
  getRotation() { return { x: 0, y: 90 }; }
  getTags() { return [...this.tags]; }
  addTag(tag: string) { this.tags.add(tag); return true; }
  hasTag(tag: string) { return this.tags.has(tag); }
  getComponent(_id: string): unknown { return undefined; }
}

class FakePlayer extends FakeEntity {
  messages: unknown[] = [];
  gameMode = "Creative";
  commandPermissionLevel = 2;
  mainHand?: FakeStack;
  name: string;
  constructor(id: string, name: string, dimension?: FakeDimension) {
    super(id, "minecraft:player", dimension);
    this.name = name;
  }
  sendMessage(msg: unknown) { this.messages.push(msg); }
  playSound() { }
  getGameMode() { return this.gameMode; }
  getComponent(id: string): unknown {
    if (id === "minecraft:equippable") return {
      getEquipment: (slot: string) => (slot === "Mainhand" ? this.mainHand : undefined),
      setEquipment: (slot: string, stack?: FakeStack) => { if (slot === "Mainhand") this.mainHand = stack; },
    };
    return undefined;
  }
}

const make = (species: string, level = 20) => PokemonData.generateNewWildPokemon(species, { level, shiny: false });

function envWith(values: Record<string, unknown>): MoEnvironment {
  const env = new MoEnvironment();
  for (const [name, value] of Object.entries(values)) env.withQuery(name, value as MoStruct);
  return env;
}

// ---------------------------------------------------------------------------------------------

function testGeneralFunctions() {
  const env = new MoEnvironment();
  assert.equal(env.eval("q.to_lower('AbC') + q.to_upper('x')"), "abcX");
  assert.equal(env.eval("q.string_length('pikachu')"), 7);
  assert.equal(env.eval("q.is_included('cobblemon:pikachu', 'pika')"), 1);
  assert.equal(env.eval("q.is_included('cobblemon', 'pika')"), 0);
  assert.equal(env.eval("t.parts = q.split_string('a,b,c', ','); return q.length(t.parts);"), 3);
  assert.equal(env.eval("q.split_string('a,b,c', ',')[1]"), "b");
  assert.equal(env.eval("q.is_number('3.5')"), 1);
  assert.equal(env.eval("q.is_number('abc')"), 0);
  assert.equal(env.eval("q.to_number('3.5') + 1"), 4.5);
  assert.equal(env.eval("q.to_number('abc')"), 0);
  assert.equal(env.eval("q.to_int('42')"), 42);
  assert.equal(env.eval("q.to_int('4.2')"), 0, "toIntOrNull do Kotlin: '4.2' não é int");
  assert.equal(env.eval("q.to_string(7) + '!'"), "7!");

  // Arrays (ArrayStruct): append, insert, delete.
  assert.equal(env.eval("t.a = q.array(1, 2); q.append(t.a, 3); q.insert(t.a, 0, 0); q.delete(t.a, 2); return q.length(t.a);"), 3);
  const array = env.eval("t.a = q.array('x', 'y'); q.insert(t.a, 1, 'z'); return t.a;");
  assert.ok(array instanceof MoArray);
  assert.deepEqual((array as MoArray).items, ["x", "z", "y"]);

  // Variáveis de struct (VariableStruct).
  assert.equal(env.eval("v.bag.a = 1; q.set_variable(v.bag, 'b', 5); return q.get_variable(v.bag, 'b') + q.get_variable(v.bag, 'a');"), 6);
  assert.equal(env.eval("q.delete_variable(v.bag, 'b'); return q.get_variable(v.bag, 'b');"), 0);
  assert.equal(env.eval("q.delete_variables(v.bag); return q.get_variable(v.bag, 'a');"), 0);

  // Datas (dd/MM/yyyy) e relógio.
  assert.equal(env.eval("q.date_is_after('02/01/2026', '01/01/2026')"), 1);
  assert.equal(env.eval("q.date_is_after('01/01/2025', '01/01/2026')"), 0);
  assert.match(asString(env.eval("q.date_local_time()")), /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(env.eval(`q.date_of(${new Date(2026, 8, 26, 12).getTime()})`), "26/09/2026");
  assert.ok((env.eval("q.system_time_millis()") as number) > 0);

  // Golpes (MoveTemplate.struct).
  assert.equal(env.eval("q.get_move_from_id('thunderbolt').type"), "electric");
  assert.equal(env.eval("q.get_move_from_id('thunderbolt').damage_category"), "SPECIAL");
  assert.equal(env.eval("q.get_move_from_id('thunderbolt').power"), 90);
  assert.equal(env.eval("q.get_move_from_id('swift').accuracy"), -1, "sempre acerta = -1");
  assert.equal(env.eval("q.get_move_from_id('nao_existe')"), 0);

  // Structs criados por script.
  assert.equal(env.eval("t.p = q.create_simple_party_provider(); t.p.add_pokemon('pikachu level=5'); t.p.set_static(false); return q.length(t.p.pokemon) * 10 + t.p.static;"), 10);
  assert.equal(env.eval("q.create_pickup_item('minecraft:apple', 3).pickup_priority"), 3);
  assert.equal(env.eval("q.do_effect_walks()"), 0);
  assert.equal(env.eval("q.curve('sine')"), 0, "WaveFunction só existe no cliente Java");
  assert.equal(env.eval("q.run_script('cobblemon:nao_existe')"), 0);

  // q.file: mesmas regras de nome do Java; o conteúdo fica em cache e em dynamic property do mundo.
  assert.equal(env.eval("t.f = q.file.load('world/molang/test.json'); t.f.count = 3; q.file.save('world/molang/test.json', t.f); return q.file.load('world/molang/test.json').count;"), 3);
  assert.equal(env.eval("q.file.exists('world/molang/test.json')"), 1);
  assert.equal(env.eval("q.file.save('../fora.json', q.file.load('x'))"), 0, "fora de /molang/ é recusado");

  // As do MoLang.ts continuam como estavam; run_molang ganha o atraso.
  const r = env.eval("q.random(1, 2)") as number;
  assert.ok(r >= 1 && r <= 2, "q.random(a, b) antigo (intervalo) não foi trocado");
  assert.equal(env.eval("q.run_molang('1 + 1')"), 2);
  assert.equal(env.eval("q.run_molang('v.late = 1', 0.5)"), 1, "com atraso devolve 1 na hora");
  assert.equal(env.eval("q.is_blank('')"), 1);
}

function testItemStack() {
  const sword = new FakeStack("minecraft:diamond_sword", 1, [{ type: { id: "sharpness" }, level: 3 }], ["minecraft:is_sword"]);
  const env = envWith({ item: createItemStackStruct(sword as never) });
  // Cobblemon 1.8.0: q.item.is_enchanted() e q.item.has_enchantment(id, nível).
  assert.equal(env.eval("q.item.is_enchanted()"), 1);
  assert.equal(env.eval("q.item.has_enchantment('minecraft:sharpness', 3)"), 1);
  assert.equal(env.eval("q.item.has_enchantment('sharpness')"), 1, "nível mínimo padrão 1");
  assert.equal(env.eval("q.item.has_enchantment('minecraft:sharpness', 4)"), 0);
  assert.equal(env.eval("q.item.has_enchantment('minecraft:smite')"), 0);
  assert.equal(env.eval("q.item.is_of('minecraft:diamond_sword') && q.item.is_of('diamond_sword')"), 1);
  assert.equal(env.eval("q.item.is_in('#minecraft:is_sword')"), 1);
  assert.equal(env.eval("q.item.item.id"), "minecraft:diamond_sword");
  assert.equal(env.eval("q.item.id"), "minecraft:diamond_sword");

  const apples = new FakeStack("minecraft:apple", 5);
  let changed: FakeStack | undefined = apples;
  const appleEnv = envWith({ item: createItemStackStruct(apples as never, next => { changed = next as never; }) });
  assert.equal(appleEnv.eval("q.item.is_enchanted()"), 0);
  assert.equal(appleEnv.eval("q.item.grow(2); q.item.count"), 7);
  assert.equal(appleEnv.eval("q.item.shrink(7); q.item.is_empty"), 1);
  assert.equal(changed, undefined, "stack acabou: onChange(undefined)");

  const empty = envWith({ item: createItemStackStruct(undefined) });
  assert.equal(empty.eval("q.item.is_empty && q.item.is_of('minecraft:air') && !q.item.is_enchanted()"), 1);
}

function testPokemonStruct() {
  const pikachu = make("pikachu", 20);
  const entity = new FakeEntity("entity-1", "cobblemon:pikachu");
  const env = envWith({ pokemon: createPokemonStruct(pikachu, entity as never) });

  assert.equal(env.eval("q.pokemon.level"), 20);
  assert.equal(env.eval("q.pokemon.id"), pikachu.uuid);
  assert.equal(env.eval("q.pokemon.species.identifier"), "cobblemon:pikachu");
  assert.equal(env.eval("q.pokemon.species.name"), "Pikachu");
  assert.equal(env.eval("q.pokemon.species.primary_type"), "electric");
  assert.equal(env.eval("q.pokemon.species.secondary_type"), "null");
  assert.equal(env.eval("q.pokemon.species.has_label('gen1')"), 1);
  assert.equal(env.eval("q.pokemon.natdex_number"), 25);
  assert.equal(env.eval("q.pokemon.types[0]"), "electric");
  assert.equal(env.eval("q.pokemon.catch_rate"), 190);
  assert.equal(env.eval("q.pokemon.ev_yield.spe"), 2);
  assert.equal(env.eval("q.pokemon.base_stats.spe"), 90);
  assert.equal(env.eval("q.pokemon.pre_evolution.identifier"), "cobblemon:pichu");
  assert.equal(env.eval("q.pokemon.form_name"), "Normal");
  assert.equal(env.eval("q.pokemon.is_shiny"), 0);
  assert.equal(env.eval("q.pokemon.is_alpha"), 0);
  assert.ok(["XS", "S", "M", "L", "XL"].includes(asString(env.eval("q.pokemon.size_category"))));
  assert.ok(asString(env.eval("q.pokemon.nature")).startsWith("cobblemon:"));
  assert.equal(env.eval("q.pokemon.gender"), pikachu.gender === "m" ? "MALE" : "FEMALE");
  assert.ok((env.eval("q.pokemon.max_hp") as number) > 0);
  assert.ok((env.eval("q.length(q.pokemon.tm_learnset)") as number) > 0);
  assert.ok((env.eval("q.length(q.pokemon.egg_groups)") as number) > 0);
  assert.ok((env.eval("q.length(q.pokemon.moveset)") as number) > 0);
  assert.equal(typeof env.eval("q.pokemon.moveset[0].name"), "string");
  assert.equal(env.eval("q.pokemon.matches('pikachu')"), 1);
  assert.equal(env.eval("q.pokemon.matches('bulbasaur')"), 0);

  // Aspectos forçados (add_aspects/remove_aspects).
  assert.equal(env.eval("q.pokemon.add_aspects('molang-test'); q.pokemon.has_aspect('molang-test')"), 1);
  assert.ok(pikachu.forcedAspects?.includes("molang-test"));
  assert.equal(env.eval("q.pokemon.remove_aspects('molang-test'); q.pokemon.has_aspect('molang-test')"), 0);

  // Marcas (Cobblemon 1.8.0: marks, has_mark, remove_marks).
  assert.equal(env.eval("q.pokemon.add_marks('mark_rare')"), 1);
  assert.equal(env.eval("q.pokemon.has_mark('cobblemon:mark_rare')"), 1);
  assert.equal(env.eval("q.pokemon.marks[0]"), "cobblemon:mark_rare");
  assert.equal(env.eval("q.pokemon.remove_marks('mark_rare')"), 1);
  assert.equal(env.eval("q.pokemon.has_mark('mark_rare')"), 0);
  assert.equal(env.eval("q.pokemon.remove_marks('nao_existe')"), 0);
  assert.equal(env.eval("q.pokemon.add_potential_marks('mark_rare'); q.length(q.pokemon.marks)"), 0);
  assert.deepEqual(pikachu.potentialMarks, ["cobblemon:mark_rare"]);

  // IV/EV/Hyper Training.
  assert.equal(env.eval("q.pokemon.set_iv('attack', 15); q.pokemon.ivs.atk"), 15);
  assert.equal(env.eval("q.pokemon.set_ev('hp', 100); q.pokemon.evs.hp"), 100);
  assert.equal(env.eval("q.pokemon.set_iv('accuracy', 3)"), 0, "só atributos permanentes");
  assert.equal(env.eval("q.pokemon.hyper_train_iv('spe'); q.pokemon.hyper_trained_ivs.spe"), pikachu.ivs.spe === 31 ? -1 : 31);

  // Golpes.
  assert.equal(env.eval("q.pokemon.can_learn_move('thunderbolt')"), 1);
  assert.equal(env.eval("q.pokemon.can_learn_move('nao_existe')"), 0);
  assert.equal(env.eval("q.pokemon.teach_move('thunderbolt', true)"), 1);
  assert.equal(env.eval("q.pokemon.has_learned('thunderbolt')"), 1);
  assert.equal(env.eval("q.pokemon.teach_move('thunderbolt', true)"), 0, "já sabe");
  assert.equal(env.eval("q.pokemon.unlearn_move('thunderbolt'); q.pokemon.has_learned('thunderbolt')"), 0);
  assert.equal(env.eval("q.pokemon.initialize_moveset('cobblemon:alpha')"), 1);
  assert.equal(env.eval("q.pokemon.initialize_moveset('cobblemon:nao_existe')"), 0);

  // Barriga, amizade e propriedades.
  const fullness = env.eval("q.pokemon.feed_pokemon(3, false); q.pokemon.fullness") as number;
  assert.equal(fullness, 3);
  assert.equal(env.eval("q.pokemon.lose_fullness(1); q.pokemon.fullness"), 2);
  assert.ok((env.eval("q.pokemon.max_fullness") as number) > 0);
  assert.equal(env.eval("q.pokemon.apply('level=30 shiny'); q.pokemon.level"), 30);
  assert.equal(env.eval("q.pokemon.is_shiny"), 1);
  assert.equal(pikachu.level, 30, "apply grava no próprio PokemonData");
  assert.equal(env.eval("q.pokemon.can_evolve"), 1);

  // Cobblemon 1.8.0: q.pokemon.entity (entidade em campo).
  assert.equal(env.eval("q.pokemon.entity.is_pokemon"), 1);
  assert.equal(env.eval("q.pokemon.entity.x"), 10);
  assert.equal(env.eval("q.pokemon.entity.uuid"), "entity-1");
  assert.equal(env.eval("q.pokemon.entity.pokemon.level"), 30);
  assert.equal(env.eval("q.pokemon.entity.has_aspect('shiny')"), 1);
  assert.equal(env.eval("q.pokemon.entity.add_tag('x'); q.pokemon.entity.has_tag('x')"), 1);
  assert.equal(env.eval("q.pokemon.owner"), 0, "selvagem: sem dono");

  // Espécie solta e requisito `chance` com o struct completo.
  assert.equal(envWith({ s: createSpeciesStruct("bulbasaur") }).eval("q.s.secondary_type"), "poison");
  assert.equal(evaluateChance("q.pokemon.species.identifier == 'cobblemon:pikachu' ? 1 : 0", pikachu, () => 0.5), true);
  assert.equal(evaluateChance("q.pokemon.level < 10 ? 1 : 0", pikachu, () => 0.5), false);
  assert.equal(evaluateChance("q.pokemon.has_aspect('shiny') ? 1 : 0", pikachu, () => 0.5), true);
}

function testPlayerFunctions() {
  const dimension = new FakeDimension();
  const player = new FakePlayer("player-1", "Ash", dimension);
  const env = envWith({ player: createPlayerStruct(player as never) });

  // Cobblemon 1.8.0: has_chosen_starter e get_starter_uuid.
  assert.equal(env.eval("q.player.has_chosen_starter"), 0);
  assert.equal(env.eval("q.player.get_starter_uuid"), 0);
  player.setDynamicProperty("starter_selected", true);
  player.setDynamicProperty(STARTER_UUID_PROPERTY, "abc-123");
  assert.equal(env.eval("q.player.has_chosen_starter"), 1);
  assert.equal(env.eval("q.player.get_starter_uuid"), "abc-123");

  // Cobblemon 1.8.0: TMs do jogador.
  assert.equal(env.eval("q.player.has_tm_move_unlocked('thunderbolt')"), 0);
  assert.equal(env.eval("q.player.unlock_tm_move('thunderbolt')"), 1);
  assert.equal(env.eval("q.player.has_tm_move_unlocked('thunderbolt')"), 1);
  assert.equal(env.eval("q.player.lock_tm_move('thunderbolt')"), 1);
  assert.equal(env.eval("q.player.has_tm_move_unlocked('thunderbolt')"), 0);
  assert.equal(env.eval("q.player.unlock_tm_move('tackle_que_nao_existe')"), 0);

  // Item na mão (superconjunto do antigo) com encantamento.
  assert.equal(env.eval("q.player.main_held_item.is_of('minecraft:air')"), 1, "mão vazia continua ar");
  player.mainHand = new FakeStack("minecraft:bow", 1, [{ type: { id: "minecraft:power" }, level: 2 }]);
  assert.equal(env.eval("q.player.main_held_item.is_enchanted()"), 1);
  assert.equal(env.eval("q.player.main_held_item.has_enchantment('power', 2)"), 1);
  assert.equal(env.eval("q.player.main_held_item.id"), "minecraft:bow");
  assert.equal(env.eval("q.player.off_held_item.is_empty"), 1);

  // Modo de jogo e permissão.
  assert.equal(env.eval("q.player.is_creative && !q.player.is_survival"), 1);
  assert.equal(env.eval("q.player.has_permission('cobblemon.command.x', 2)"), 1);
  assert.equal(env.eval("q.player.has_permission('cobblemon.command.x')"), 0, "padrão: nível 4");
  assert.equal(env.eval("q.player.get_custom_stat('cobblemon:captured')"), 0);
  assert.equal(env.eval("q.player.swing_hand"), 0);

  // Pokédex (dex_* com id opcional).
  markSeen(player as never, "bulbasaur");
  markCaught(player as never, "pikachu");
  assert.equal(env.eval("q.player.pokedex.has_caught('pikachu')"), 1);
  assert.equal(env.eval("q.player.pokedex.has_caught('cobblemon:bulbasaur')"), 0);
  assert.equal(env.eval("q.player.pokedex.has_seen('bulbasaur')"), 1);
  assert.equal(env.eval("q.player.pokedex.caught_count"), 1);
  assert.equal(env.eval("q.player.pokedex.seen_count"), 2);
  assert.equal(env.eval("q.player.pokedex.dex_caught_count('national')"), 1);
  assert.equal(env.eval("q.player.pokedex.dex_seen_count('cobblemon:national')"), 2);
  assert.equal(env.eval("q.player.pokedex.dex_caught_count()"), 1, "sem id: contagem global");
  assert.equal(env.eval("q.player.pokedex.dex_caught_count('nao_existe')"), 0);
  assert.ok((env.eval("q.player.pokedex.dex_caught_percent('national')") as number) > 0);
  assert.equal(env.eval("q.player.pokedex.get_species_record('pikachu').knowledge"), "OWNED");
  assert.equal(createPokedexStruct(player as never).functions.has("dex_seen_percent"), true);

  // Time: struct do PartyStore, com gravação de volta ao mudar um Pokémon.
  const pikachu = make("pikachu", 12);
  pikachu.trainer = player.id;
  player.setDynamicProperty("initialized", true);
  player.setDynamicProperty("team", JSON.stringify([pikachu, null, null, null, null, null]));
  assert.equal(env.eval("q.player.party.count"), 1);
  assert.equal(env.eval("q.player.party.get_pokemon(0).species.identifier"), "cobblemon:pikachu");
  assert.equal(env.eval("q.player.party.find_by_properties('pikachu').level"), 12);
  assert.equal(env.eval("q.player.party.find_by_properties('bulbasaur')"), 0);
  assert.equal(env.eval("q.player.party.highest_level"), 12);
  env.eval("q.player.party.get_pokemon(0).set_iv('hp', 5)");
  assert.equal(JSON.parse(player.getDynamicProperty("team") as string)[0].ivs.hp, 5, "mudança gravada no time");
  env.eval("q.player.party.get_pokemon(0).add_marks('mark_rare')");
  assert.deepEqual(JSON.parse(player.getDynamicProperty("team") as string)[0].marks, ["cobblemon:mark_rare"]);

  // Mundo do jogador (superconjunto do antigo, com game_time).
  assert.equal(typeof env.eval("q.player.world.game_time"), "number");
  assert.equal(env.eval("q.player.world.is_time_of_day('day')"), 1);
  assert.equal(env.eval("q.player.world.is_time_of_day('night')"), 0);
}

function testWorldStruct() {
  assert.equal(isTimeOfDay("midnight", 18000), true);
  assert.equal(isTimeOfDay("dawn", 100), true);
  assert.equal(isTimeOfDay("nao_existe", 100), false);
  assert.deepEqual(lootTablePaths("minecraft:chests/simple_dungeon"), ["chests/simple_dungeon"]);
  assert.deepEqual(lootTablePaths("cobblemon:gilded_chest"), ["cobblemon/gilded_chest", "gilded_chest"]);

  // Cobblemon 1.8.0: q.world.spawn_loot_table_items(id, x, y, z) com um LootTableManager falso.
  const dimension = new FakeDimension();
  const mocked = world as unknown as Record<string, unknown>;
  const previous = mocked.getLootTableManager;
  mocked.getLootTableManager = () => ({
    getLootTable: (path: string) => (path === "chests/simple_dungeon" ? { path } : undefined),
    generateLootFromTable: () => [new FakeStack("minecraft:diamond", 2), new FakeStack("minecraft:air", 0)],
  });
  try {
    const env = envWith({ world: createWorldStruct(dimension as never) });
    assert.equal(env.eval("t.items = q.world.spawn_loot_table_items('minecraft:chests/simple_dungeon', 1, 2, 3); q.length(t.items)"), 1);
    assert.equal(env.eval("q.world.spawn_loot_table_items('minecraft:chests/simple_dungeon', 1, 2, 3)[0].is_of('minecraft:diamond')"), 1);
    assert.deepEqual(dimension.spawned[0], { typeId: "minecraft:diamond", location: { x: 1, y: 2, z: 3 } });
    assert.equal(env.eval("q.length(q.world.spawn_loot_table_items('minecraft:nao_existe', 0, 0, 0))"), 0);
    assert.equal(env.eval("q.world.is_raining"), 0);
    assert.equal(env.eval("q.world.server"), 0);
    assert.equal(env.eval("q.world.is_healer_in_use(q.array(0, 0, 0))"), 1, "sem máquina de cura conta como em uso");
  }
  finally {
    mocked.getLootTableManager = previous;
  }
}

export function runMolangTests(): void {
  const warn = console.warn;
  const info = console.info;
  const log = console.log;
  console.warn = () => { };
  console.info = () => { };
  console.log = () => { };
  try {
    testGeneralFunctions();
    testItemStack();
    testPokemonStruct();
    testPlayerFunctions();
    testWorldStruct();
  }
  finally {
    console.warn = warn;
    console.info = info;
    console.log = log;
  }
}
