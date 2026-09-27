// Frente "social": interpretador MoLang, diálogos do Cobblemon (dados reais), classes/presets de NPC e geração
// de time, callback de fim de batalha com NPC, e troca entre jogadores (atômica, com evolução por troca).
import assert from "node:assert/strict";
import { MoArray, MoEnvironment, MoStruct, parseMoLang, asString } from "../scripts/npc/molang/MoLang";
import { ActiveDialogue } from "../scripts/npc/dialogue/ActiveDialogue";
import { getDialogue, getDialogueIds, parseDialogue } from "../scripts/npc/dialogue/Dialogue";
import { getNPCClass, getNPCClassIds, getNPCPresetIds, provideVariationAspects } from "../scripts/npc/NPCClass";
import { createNPCPokemon, formulateParty, provideParty, seededRandom } from "../scripts/npc/Party";
import { NPC, battleFormatFromId, checkChallenge, handleNPCBattleVictory, resolveSkin } from "../scripts/npc/NPCEntity";
import { createPlayerStruct, getNpcData, MOLANG_DATA_PROPERTY } from "../scripts/npc/PlayerStruct";
import { MOLANG_CALLBACKS, MOLANG_SCRIPTS, NPC_SKINS } from "../generated/scripts/npcs";
import { ActiveTrade, TradeCancelReason, TradeManager, TradeResult, attemptTradeEvolution } from "../scripts/trade/TradeManager";
import { PokemonData } from "../scripts/Pokemon";
import { PCPlace, getSafeTeam, setPokemonToPCLocation } from "../scripts/pokemonStorage";
import { BattleFormat } from "../scripts/battle";

const originalWarn = console.warn;
console.warn = () => { };
const originalInfo = console.info;
console.info = () => { };

// ---------------------------------------------------------------------------------------------
// 1. Interpretador MoLang

{
  const env = new MoEnvironment();
  assert.equal(env.eval("1 + 2 * 3"), 7);
  assert.equal(env.eval("(1 + 2) * 3"), 9);
  assert.equal(env.eval("10 / 4"), 2.5);
  assert.equal(env.eval("!0 && 1 || 0"), 1);
  assert.equal(env.eval("2 > 1 ? 'a' : 'b'"), "a");
  assert.equal(env.eval("0 ? 5"), 0, "condicional binário falso = 0");
  assert.equal(env.eval("'Hello, I\\'m ' + 'Ash' + '!'"), "Hello, I'm Ash!");
  assert.equal(env.eval("'x' == 'x'"), 1);
  assert.equal(env.eval("'x' != 0"), 1, "string ≠ número");
  assert.equal(env.eval("v.a = 3; v.b = v.a * 2; return v.b + 1;"), 7);
  assert.equal(env.eval("v.b"), 6, "variáveis persistem no ambiente");
  assert.equal(env.eval("t.x = 1; t.x"), 1);
  assert.equal(env.eval("t.x"), 0, "temporárias não persistem");
  assert.equal(env.eval("t.data.nested.value = 5; t.data.nested.value"), 5, "structs intermediários são criados");
  assert.equal(env.eval("math.clamp(15, 0, 10) + math.abs(-2)"), 12);
  assert.equal(Math.round(env.eval("math.cos(180)") as number), -1, "trigonometria em graus");
  assert.equal(env.eval("v.n = 0; loop(5, { v.n = v.n + 1; v.n >= 3 ? break; }); v.n"), 3);
  assert.equal(env.eval("t.sum = 0; for_each(t.i, q.array(1, 2, 3), { t.sum = t.sum + t.i; }); t.sum"), 6);
  assert.equal(env.eval("q.is_blank('') && !q.is_blank('a') && q.is_blank(0)"), 1);
  assert.equal(env.eval("q.replace('give {{player}} x', '{{player}}', 'Ash')"), "give Ash x");
  assert.equal(env.eval(["v.list_a = 1;", "v.list_b = v.list_a + 1"]), 2, "lista de expressões compartilha o ambiente");
  assert.equal(env.eval("v.missing ?? 9"), 9);
  assert.equal(env.eval("v.flag = 0; v.flag ? v.r = 'a' : v.r = 'b'; v.r"), "b", "atribuição nos ramos do ternário");
  // Funções sem parênteses são chamadas (q.player.username); funções desconhecidas valem 0 e ficam registradas.
  env.withQuery("player", new MoStruct({}, { username: () => "Ash" }));
  assert.equal(env.eval("q.player.username"), "Ash");
  assert.equal(env.eval("q.player.unknown_fn(1)"), 0);
  assert.ok(env.missing.has("query.player.unknown_fn"));
  // Contexto (c.) e índice em array.
  assert.equal(env.eval("c.pos[1] + 1", { pos: new MoArray([10, 20, 30]) }), 21);
  // Laço infinito é interrompido (watchdog).
  env.maxSteps = 500;
  assert.throws(() => env.eval("loop(100000, { v.z = 1; })"));
  env.maxSteps = 20000;
  // Persistência de struct em JSON (dados do jogador).
  const saved = MoStruct.fromJSON(JSON.parse(JSON.stringify(new MoStruct({ a: 1, b: "x", c: new MoStruct({ d: 2 }) }).toJSON())));
  assert.equal(saved.get("a"), 1);
  assert.equal((saved.get("c") as MoStruct).get("d"), 2);
}

// 2. Todos os scripts MoLang de NPC/diálogos/callbacks do Cobblemon 1.8.2 são aceitos pelo parser.
{
  const sources: string[] = [];
  for (const [id, text] of Object.entries(MOLANG_SCRIPTS)) {
    if (["cobblemon:basic-npc-interaction", "cobblemon:chatter-npc-interaction", "cobblemon:configure_npc_party",
      "cobblemon:instant_battle_interaction", "cobblemon:run_callback_dialogue"].includes(id)) sources.push(text);
  }
  assert.equal(sources.length, 5, "5 scripts de NPC");
  sources.push(MOLANG_CALLBACKS["cobblemon:battle_victory/npc_battle_end_scripts"]);
  for (const source of sources) assert.doesNotThrow(() => parseMoLang(source), source.slice(0, 60));

  const ids = getDialogueIds();
  assert.deepEqual(ids, ["cobblemon:example", "cobblemon:npc-example", "cobblemon:sacchi_healed", "cobblemon:sacchi_interaction"]);
  let expressions = 0;
  for (const id of ids) {
    const dialogue = getDialogue(id);
    assert.ok(dialogue, `diálogo ${id}`);
    const all: (string | string[] | undefined)[] = [dialogue!.initializationAction, dialogue!.escapeAction];
    for (const speaker of Object.values(dialogue!.speakers)) if (speaker.name?.kind === "expression") all.push(speaker.name.expression);
    for (const page of dialogue!.pages) {
      all.push(page.escapeAction);
      for (const line of page.lines) if (line.kind === "expression") all.push(line.expression);
      const input = page.input;
      if (input.type === "option") {
        for (const o of input.options) all.push(o.action, o.isVisible, o.isSelectable);
        all.push(input.timeout?.action);
      }
      else all.push(input.action, input.type === "text" ? input.timeout?.action : undefined);
    }
    for (const source of all) {
      if (source === undefined) continue;
      expressions++;
      assert.doesNotThrow(() => parseMoLang(source), `${id}: ${JSON.stringify(source)}`);
    }
  }
  assert.ok(expressions >= 40, `esperava ~40+ expressões nos diálogos, veio ${expressions}`);
  // Formato: páginas, falantes, entradas.
  const example = getDialogue("example")!;
  assert.equal(example.pages.length, 16);
  assert.equal(example.pages.find(p => p.id === "intro")!.input.type, "option");
  assert.equal(example.pages.find(p => p.id === "name-question")!.input.type, "text");
  assert.equal(example.pages.find(p => p.id === "page2")!.input.type, "auto-continue");
  assert.throws(() => parseDialogue("x", { pages: [] }));
  assert.throws(() => parseDialogue("x", { pages: [{ input: { type: "bogus" } }] }));
}

// ---------------------------------------------------------------------------------------------
// 3. Diálogos (máquina de estados) com os dados reais

interface PlayerStub {
  struct: MoStruct;
  data: MoStruct;
  saves: number;
  held: string;
}

function playerStub(name = "Ash"): PlayerStub {
  const stub: PlayerStub = { struct: new MoStruct(), data: new MoStruct(), saves: 0, held: "minecraft:air" };
  stub.struct
    .fn("username", () => name)
    .fn("uuid", () => `${name}-uuid`)
    .fn("face", () => 1)
    .fn("main_held_item", () => new MoStruct({}, { is_of: args => (asString(args[0]) === stub.held ? 1 : 0) }))
    .fn("data", () => stub.data)
    .fn("save_data", () => { stub.saves++; return 1; });
  return stub;
}

const text = (msg: any): string => msg.text ?? msg.translate;

{
  // example.json: expressões, opções visíveis/selecionáveis, set_page, v.*, texto digitado, prazos e Esc.
  const player = playerStub();
  const d = new ActiveDialogue(getDialogue("example")!, { player: player.struct });
  d.initialize();
  assert.equal(d.currentPage.id, "player-chat");
  let page = d.render();
  assert.equal(text(page.speaker), "Ash");
  assert.equal(text(page.lines[0]), "Hello, I'm Ash!");
  d.handleInput("");
  assert.equal(text(d.render().lines[0]), "Nice to meet you, Ash! Welcome to the world of dialogues!");
  assert.equal(text(d.render().speaker), "Mouse Pokémon");
  d.handleInput("");
  assert.equal(d.currentPage.id, "intro");
  page = d.render();
  assert.deepEqual(page.options.map(o => o.value), ["yes", "no"], "sem espada: opções de espada escondidas");
  player.held = "minecraft:iron_sword";
  page = d.render();
  assert.deepEqual(page.options.map(o => [o.value, o.selectable]), [["yes", true], ["no", true], ["sword", true], ["sword2", false]]);
  d.handleInput("yes");
  assert.equal(d.currentPage.id, "player-surrogate");
  assert.equal(text(d.render().lines[0]), "That sounds great!");
  d.handleInput("");
  assert.equal(d.currentPage.id, "page1");
  d.handleInput("");
  assert.equal(d.currentPage.id, "page2");
  assert.equal(d.render().deadline, 5);
  d.timeout(d.inputId);
  assert.ok(d.closed, "page2: auto-continue roda q.dialogue.close()");

  // Espada: grava q.player.data().scared_npc e salva; na volta a opção "Sword again!" fica selecionável.
  const d2 = new ActiveDialogue(getDialogue("example")!, { player: player.struct });
  d2.initialize();
  d2.setPage("intro");
  d2.handleInput("sword");
  d2.handleInput("");
  assert.equal(d2.currentPage.id, "sword");
  d2.handleInput("");
  assert.ok(d2.closed);
  assert.equal(player.data.get("scared_npc"), 1);
  assert.equal(player.saves, 1);
  const d3 = new ActiveDialogue(getDialogue("example")!, { player: player.struct });
  d3.initialize();
  d3.setPage("intro");
  assert.deepEqual(d3.render().options.map(o => [o.value, o.selectable]), [["yes", true], ["no", true], ["sword", false], ["sword2", true]]);
  d3.handleInput("sword"); // não selecionável → fecha
  assert.ok(d3.closed);

  // Prazo da página com opções: q.dialogue.input('stand') → v.reaction.
  const d4 = new ActiveDialogue(getDialogue("example")!, { player: player.struct });
  d4.initialize();
  d4.setPage("sword-again");
  const staleInput = d4.inputId - 1;
  d4.timeout(staleInput);
  assert.equal(d4.currentPage.id, "sword-again", "timeout antigo é ignorado");
  d4.timeout(d4.inputId);
  assert.equal(d4.currentPage.id, "sword-again-decided");
  assert.equal(text(d4.render().lines[0]), "He kills you.");
  assert.equal(d4.render().allowSkip, false);
  d4.handleInput("");
  assert.equal(d4.currentPage.id, "sword-again-decided", "auto-continue sem pular ignora clique");
  d4.timeout(d4.inputId);
  assert.equal(text(d4.render().lines[0]), "Nah, I'm just kidding. Interesting that you chose to stand still though.");
  d4.escape(); // escapeAction do diálogo: set_page('quitter')
  assert.equal(d4.currentPage.id, "quitter");
  d4.escape(); // escapeAction da página: close
  assert.ok(d4.closed);

  // Entrada de texto: v.selected_option.
  const d5 = new ActiveDialogue(getDialogue("example")!, { player: player.struct });
  d5.initialize();
  d5.setPage("name-question");
  assert.equal(d5.render().input, "text");
  assert.equal(d5.render().deadline, 10);
  d5.handleInput("pikachu");
  assert.equal(d5.currentPage.id, "name-speak");
  assert.equal(text(d5.render().lines[0]), "You are a pikachu, right?");
  d5.handleInput("");
  assert.equal(text(d5.render().lines[0]), "Correct! You know things that you shouldn't...");
  d5.setPage("name-question");
  d5.handleInput("raichu");
  d5.handleInput("");
  assert.equal(text(d5.render().lines[0]), "Wrong! I'm not a \"raichu\". Whatever that is.");
  // Página inexistente é ignorada; passar da última fecha.
  d5.setPage("nope");
  assert.equal(d5.currentPage.id, "name-guess");
  d5.setPage(16);
  assert.ok(d5.closed);
  assert.deepEqual([...d.errors, ...d2.errors, ...d3.errors, ...d4.errors], []);
  assert.equal(d5.errors.length, 1, "só o aviso da página inexistente");
}

function npcStub(options: { inBattle?: boolean; hurt?: boolean; canBattle?: boolean } = {}) {
  const calls: { battle: string[]; effects: string[]; chatting: number } = { battle: [], effects: [], chatting: 0 };
  const struct = new MoStruct({ is_npc: 1 }, {
    name: () => "Red",
    face: () => 1,
    is_in_battle_with: () => (options.inBattle ? 1 : 0),
    is_doing_activity: args => (args.some(a => ["minecraft:idle", "cobblemon:battling"].includes(asString(a))) ? 1 : 0),
    was_hurt_by: () => (options.hurt ? 1 : 0),
    can_battle: () => (options.canBattle === false ? 0 : 1),
    start_battle: args => { calls.battle.push(args.length > 1 ? asString(args[1]) : "singles"); return 1; },
    set_chatting: () => { calls.chatting++; return 1; },
    run_action_effect: args => { calls.effects.push(asString(args[0])); return 1; },
  });
  return { struct, calls };
}

{
  // npc-example: diálogo de treinador (Battle / Trade / Cancel).
  const player = playerStub();
  const npc = npcStub();
  const d = new ActiveDialogue(getDialogue("npc-example")!, { player: player.struct, npc: npc.struct });
  d.initialize();
  assert.ok(!d.closed);
  assert.equal(text(d.render().lines[0]), "Hello, I'm Ash!");
  d.handleInput("");
  assert.equal(d.currentPage.id, "npc-chat");
  assert.equal(text(d.render().speaker), "Red");
  assert.equal(text(d.render().lines[0]), "Hello, Ash! I'm Red!");
  assert.deepEqual(d.render().options.map(o => [o.value, o.selectable]), [["battle", true], ["trade", false], ["cancel", true]]);
  d.handleInput("battle");
  assert.ok(d.closed);
  assert.deepEqual(npc.calls.battle, ["double"], "q.npc.start_battle(q.player, 'double')");
  assert.equal(battleFormatFromId("double").battleType.name, BattleFormat.GEN_9_DOUBLES.battleType.name);
  assert.equal(battleFormatFromId(undefined).battleType.name, BattleFormat.GEN_9_SINGLES.battleType.name);

  // Já em batalha com o jogador: initializationAction fecha antes de abrir.
  const inBattle = new ActiveDialogue(getDialogue("npc-example")!, { player: player.struct, npc: npcStub({ inBattle: true }).struct });
  inBattle.initialize();
  assert.ok(inBattle.closed && !inBattle.initialized);
  // Apanhou do jogador → hurt-1.
  const hurt = new ActiveDialogue(getDialogue("npc-example")!, { player: player.struct, npc: npcStub({ hurt: true }).struct });
  hurt.initialize();
  hurt.handleInput("");
  assert.equal(hurt.currentPage.id, "hurt-1");
  // Sem time: Battle não selecionável.
  const noParty = new ActiveDialogue(getDialogue("npc-example")!, { player: player.struct, npc: npcStub({ canBattle: false }).struct });
  noParty.initialize();
  noParty.handleInput("");
  assert.equal(noParty.render().options[0].selectable, false);
}

{
  // sacchi_interaction: página de entrada decidida pela máquina de cura perto.
  const landing = (healer: MoArray | number, fullHealth: boolean, canHeal: boolean) => {
    const player = playerStub();
    player.struct.fn("is_party_at_full_health", () => (fullHealth ? 1 : 0)).fn("can_heal_at_healer", () => (canHeal ? 1 : 0));
    const npc = npcStub();
    npc.struct.fn("find_nearby_block", () => healer);
    const d = new ActiveDialogue(getDialogue("sacchi_interaction")!, { player: player.struct, npc: npc.struct });
    d.initialize();
    assert.equal(npc.calls.chatting, 1, "c.npc.set_chatting()");
    assert.equal(d.currentPage.id, "greeting");
    d.handleInput("");
    return { d, npc };
  };
  assert.equal(landing(0, false, true).d.currentPage.id, "no_healer");
  assert.equal(landing(new MoArray([1, 2, 3]), true, true).d.currentPage.id, "full_health");
  assert.equal(landing(new MoArray([1, 2, 3]), false, false).d.currentPage.id, "no_charge");
  const { d, npc } = landing(new MoArray([1, 2, 3]), false, true);
  assert.equal(d.currentPage.id, "has_charge");
  d.handleInput("yes");
  assert.ok(d.closed);
  assert.deepEqual(npc.calls.effects, ["npc_heal_player_pokemon"]);
  assert.equal(d.runtime.variable.get("callback_dialogue"), "sacchi_healed");
}

// ---------------------------------------------------------------------------------------------
// 4. Classes, presets e times de NPC

{
  assert.deepEqual(getNPCClassIds(), ["cobblemon:ai_test", "cobblemon:kitchen_sink", "cobblemon:sacchi", "cobblemon:standard"]);
  assert.deepEqual(getNPCPresetIds(), ["cobblemon:battler_test"]);

  const standard = getNPCClass("standard")!;
  assert.deepEqual(standard.names, ["Red", "Green", "Blue", "Yellow"]);
  assert.equal(standard.config.length, 7);
  assert.equal(standard.config.find(c => c.variableName === "can_rechallenge")!.type, "BOOLEAN");
  assert.deepEqual(standard.interaction, { type: "dialogue", dialogue: "cobblemon:npc-example" });
  assert.equal(standard.battleConfiguration.canChallenge, true);
  assert.equal(standard.skill, 5);
  assert.equal(standard.autoHealParty, false);
  assert.equal(standard.party?.type, "simple");
  assert.deepEqual(Object.keys(standard.variations).sort(), ["dirt", "net"]);
  const aspects = provideVariationAspects(standard, seededRandom(1));
  assert.equal(aspects.length, 2);
  assert.ok(["clean", "slightly_dirty", "dirty", "filthy"].includes(aspects[0]));
  assert.ok(["green", "blue", "red"].includes(aspects[1]));

  // ai_test aplica o preset battler_test (pool, diálogo, skill).
  const ai = getNPCClass("cobblemon:ai_test")!;
  assert.deepEqual(ai.presets, ["cobblemon:battler_test"]);
  assert.deepEqual(ai.names, ["AI Man"]);
  assert.equal(ai.party?.type, "pool");
  assert.deepEqual(ai.interaction, { type: "dialogue", dialogue: "cobblemon:npc-example" });
  assert.equal(ai.canDespawn, false);
  // Preset sozinho vira classe (npcspawn battler_test).
  assert.equal(getNPCClass("battler_test")?.party?.type, "pool");
  assert.equal(getNPCClass("nao_existe"), undefined);

  // Sacchi: resourceIdentifier = id da classe → skin da Sacchi.
  const sacchi = getNPCClass("sacchi")!;
  assert.equal(sacchi.resourceIdentifier, "cobblemon:sacchi");
  const sacchiSkin = resolveSkin(sacchi.resourceIdentifier, []);
  assert.equal(NPC_SKINS[sacchiSkin].texture, "cobblemon:textures/npcs/sacchi/sacchi.png");
  assert.equal(NPC_SKINS[resolveSkin("cobblemon:standard", ["hasty", "model-slim"])].texture, "cobblemon:textures/npcs/standard/trainer.png", "model-slim sem textura não troca a skin");

  // Pool: só entradas com npcLevels contendo o nível; 4–6 Pokémon; cada entrada até selectableTimes; nível = do NPC.
  const pool = ai.party!;
  for (let seed = 1; seed <= 40; seed++) {
    for (const [level, allowed] of [[5, ["weedle", "caterpie", "wurmple"]], [9, ["kakuna", "metapod", "silcoon"]], [12, ["beedrill", "butterfree", "dustox"]]] as const) {
      const entries = formulateParty(pool, { level, random: seededRandom(seed * 31 + level) });
      const species = entries.map(e => e.properties);
      if (level === 12) assert.equal(entries.length, 3, "nível 12: só 3 entradas com selectableTimes 1");
      else assert.ok(entries.length >= 4 && entries.length <= 6, `${entries.length} Pokémon no nível ${level}`);
      assert.ok(species.every(s => (allowed as readonly string[]).includes(s)), `${species} no nível ${level}`);
      for (const s of allowed) assert.ok(species.filter(x => x === s).length <= 2);
      assert.ok(entries.every(e => e.level === level));
    }
  }
  // Nível 10: entradas de 8-10 e de 10-15.
  const ten = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) for (const e of formulateParty(pool, { level: 10, random: seededRandom(seed) })) ten.add(e.properties);
  assert.ok(["kakuna", "beedrill"].every(s => ten.has(s)), [...ten].join());
  // Mesmo sorteio com a mesma semente.
  assert.deepEqual(formulateParty(pool, { level: 5, random: seededRandom(7) }), formulateParty(pool, { level: 5, random: seededRandom(7) }));

  // Time fixo do "standard": 6 Pokémon nível 100 com golpes, natureza, item, habilidade, IV/EV das propriedades.
  const party = provideParty(standard.party!, { level: 1 });
  assert.deepEqual(party.map(p => p.species), ["spiritomb", "porygonz", "togekiss", "lucario", "milotic", "garchomp"]);
  const spiritomb = party[0];
  assert.equal(spiritomb.level, 100);
  // PokemonProperties.apply (`moves=`) põe os golpes em espaços sorteados, como o Cobblemon.
  assert.deepEqual([...spiritomb.moves].sort(), ["darkpulse", "shadowball", "suckerpunch", "willowisp"]);
  assert.equal(spiritomb.movesInfo.length, 4);
  assert.equal(spiritomb.nature.toLowerCase(), "jolly");
  assert.equal(spiritomb.ability, "pressure");
  assert.equal(spiritomb.minecraftItem, "cobblemon:sitrus_berry");
  assert.equal(spiritomb.pokeball, "master_ball");
  assert.deepEqual(spiritomb.ivs, { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  assert.equal(spiritomb.evs.hp, 252);
  assert.equal(spiritomb.evs.spa, 252);
  assert.equal(spiritomb.evs.spe, 6);
  assert.equal(spiritomb.currentHealth, spiritomb.maxHealth);
  assert.equal(spiritomb.trainer, undefined, "Pokémon de NPC não têm dono");
  assert.ok(party.every(p => p.moves.length === 4 && !p.shiny));
  // Pool cria Pokémon de verdade no nível do NPC.
  const bugs = provideParty(pool, { level: 5, random: seededRandom(3) });
  assert.ok(bugs.length >= 4 && bugs.every(p => p.level === 5 && p.moves.length > 0));
  assert.equal(createNPCPokemon("naoexiste level=5", 5), undefined);
}

// ---------------------------------------------------------------------------------------------
// 5. Entidade de NPC (fake), callback de fim de batalha, cooldown/derrotado

class FakeDimension {
  id = "minecraft:overworld";
  commands: string[] = [];
  runCommand(cmd: string) { this.commands.push(cmd); return { successCount: 1 }; }
  getEntities() { return []; }
  getBlock() { return undefined; }
}

class FakeEntity {
  isValid = true;
  nameTag = "";
  props = new Map<string, unknown>();
  properties = new Map<string, unknown>();
  animations: string[] = [];
  location = { x: 0, y: 64, z: 0 };
  constructor(public id: string, public typeId: string, public dimension: FakeDimension = new FakeDimension()) { }
  getDynamicProperty(key: string) { return this.props.get(key); }
  setDynamicProperty(key: string, value?: unknown) { if (value === undefined) this.props.delete(key); else this.props.set(key, value); }
  getProperty(key: string) { return this.properties.get(key); }
  setProperty(key: string, value: unknown) { this.properties.set(key, value); }
  playAnimation(id: string) { this.animations.push(id); }
}

class FakePlayer extends FakeEntity {
  messages: unknown[] = [];
  constructor(id: string, public name: string, dimension?: FakeDimension) { super(id, "minecraft:player", dimension); }
  sendMessage(msg: unknown) { this.messages.push(msg); }
  playSound() { }
  getComponent() { return undefined; }
}

{
  const dimension = new FakeDimension();
  const entity = new FakeEntity("npc-1", "cobblemon:npc", dimension);
  entity.setDynamicProperty("npc:class", "cobblemon:standard");
  const npc = new NPC(entity as any);
  npc.initialize(10, { random: seededRandom(5) });
  assert.ok(["Red", "Green", "Blue", "Yellow"].includes(entity.nameTag));
  assert.equal(npc.level, 10);
  assert.equal(npc.getParty()?.length, 6, "time estático salvo na entidade");
  assert.equal(entity.properties.get("cobblemon:npc_skin"), 0);
  assert.equal(npc.getConfig().challenge_cooldown, 5);
  assert.equal(npc.getConfig().can_rechallenge, 1);
  assert.ok(npc.canBattle());
  const player = new FakePlayer("player-1", "Ash", dimension);
  assert.equal(checkChallenge(npc as any, player as any, 0), undefined);

  // player_win_command com {{player}}/{{npc}}; o callback grava last_challenged_time nos dados do jogador.
  npc.setConfigValue("player_win_command", "give {{player}} cobblemon:rare_candy 1 # {{npc}}");
  npc.setConfigValue("can_rechallenge", false);
  handleNPCBattleVictory([{ player: player as any }], [{ npc }], undefined, dimension as any);
  assert.deepEqual(dimension.commands, [`give Ash cobblemon:rare_candy 1 # ${entity.nameTag}`]);
  const data = getNpcData(player as any, npc.uuid);
  assert.equal(data.get("last_challenged_time"), 0);
  assert.equal(data.get("defeated"), 1);
  assert.ok(String(player.getDynamicProperty(MOLANG_DATA_PROPERTY)).includes(npc.uuid), "dados MoLang salvos no jogador");
  assert.ok(entity.animations.includes("animation.cobblemon_npc.lose"));
  assert.equal(checkChallenge(npc as any, player as any, 100), "defeated", "can_rechallenge = false");
  npc.setConfigValue("can_rechallenge", true);
  npc.setConfigValue("challenge_cooldown", 200);
  assert.equal(checkChallenge(npc as any, player as any, 100), "cooldown");
  assert.equal(checkChallenge(npc as any, player as any, 250), undefined);
  // Time todo desmaiado e estático: não pode batalhar.
  npc.setParty(npc.getParty()!.map(p => Object.assign(p, { currentHealth: 0 })));
  assert.equal(checkChallenge(npc as any, player as any, 250), "no_party");

  // q.player: dados, get_npc_data, main_held_item.
  const struct = createPlayerStruct(player as any);
  const env = new MoEnvironment().withQuery("player", struct);
  assert.equal(env.eval(`q.player.get_npc_data('${npc.uuid}').defeated`), 1);
  assert.equal(env.eval("t.d = q.player.data(); t.d.flag = 7; q.player.save_data(); q.player.data().flag"), 7);
  assert.equal(env.eval("q.player.main_held_item.is_of('minecraft:air')"), 1);
  assert.equal(env.eval("q.player.username + ':' + q.player.uuid"), "Ash:player-1");
}

// ---------------------------------------------------------------------------------------------
// 6. Troca entre jogadores

class TradePlayer extends FakePlayer {
  constructor(id: string, name: string, x = 0) {
    super(id, name);
    this.location = { x, y: 64, z: 0 };
    this.setDynamicProperty("initialized", true);
    this.setDynamicProperty("team", JSON.stringify([null, null, null, null, null, null]));
  }
}

const mon = (species: string, level = 30, extra: Record<string, unknown> = {}) =>
  Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false }), extra);

function setup(aSpecies: string[], bSpecies: string[], distance = 3) {
  const events: { started: ActiveTrade[]; cancelled: TradeCancelReason[]; completed: TradeResult[]; updates: number } = { started: [], cancelled: [], completed: [], updates: 0 };
  let tick = 0;
  const manager = new TradeManager({
    now: () => tick,
    maxDistance: () => 12,
    listener: {
      onTradeStarted: t => events.started.push(t),
      onTradeUpdated: () => events.updates++,
      onTradeCancelled: (_, reason) => events.cancelled.push(reason),
      onTradeCompleted: (_, result) => events.completed.push(result),
    },
  });
  const a = new TradePlayer("A", "Ash") as any;
  const b = new TradePlayer("B", "Brock", distance) as any;
  aSpecies.forEach((s, i) => setPokemonToPCLocation(a, { location: PCPlace.Team, space: i }, mon(s, 30, { trainer: "A", ogTrainer: "Ash", friendship: 200 })));
  bSpecies.forEach((s, i) => setPokemonToPCLocation(b, { location: PCPlace.Team, space: i }, mon(s, 30, { trainer: "B", ogTrainer: "Brock", friendship: 180 })));
  return { manager, a, b, events, advance: (t: number) => { tick += t; } };
}

const allUuids = (...players: any[]) => players.flatMap(p => getSafeTeam(p).filter(x => x).map(x => x!.uuid)).sort();

{
  // Fluxo completo: pedido → aceite → ofertas → aceites → troca atômica.
  const { manager, a, b, events } = setup(["pikachu", "eevee"], ["onix"]);
  const before = allUuids(a, b);
  const pikachu = getSafeTeam(a)[0]!;
  const onix = getSafeTeam(b)[0]!;
  const request = manager.requestTrade(a, b);
  assert.ok(request && !("participants" in request));
  assert.equal(manager.requestTrade(a, b), undefined, "pedido duplicado");
  const trade = manager.acceptRequest(b, (request as any).id)!;
  assert.ok(trade instanceof ActiveTrade);
  assert.equal(events.started.length, 1);
  assert.equal(trade.participants[0].player.id, "B", "ActiveTrade(receiver, sender)");
  assert.ok(manager.isBusy(a) && manager.isBusy(b));
  assert.ok(!manager.updateOffer(a, 3), "espaço vazio não vale");
  assert.ok(!manager.updateOffer(a, 0, onix.uuid), "UUID diferente do espaço não vale");
  assert.ok(manager.updateOffer(a, 0, pikachu.uuid));
  assert.ok(!manager.setAcceptance(a, true), "não aceita sem oferta do outro");
  assert.ok(manager.updateOffer(b, 0, onix.uuid));
  assert.ok(manager.setAcceptance(a, true, onix.uuid));
  // Trocar a oferta desfaz os aceites.
  assert.ok(manager.updateOffer(a, 1));
  assert.equal(trade.participant("A")!.offer.accepted, false);
  assert.ok(manager.updateOffer(a, 0));
  assert.ok(!manager.setAcceptance(b, true, "outro-uuid"), "aceite de oferta que já mudou é ignorado");
  assert.ok(manager.setAcceptance(a, true, onix.uuid));
  assert.equal(events.completed.length, 0);
  assert.ok(manager.setAcceptance(b, true, pikachu.uuid));
  assert.equal(events.completed.length, 1, "com os dois aceites a troca acontece");
  assert.ok(trade.finished && !manager.getActiveTrade("A"));
  const teamA = getSafeTeam(a);
  const teamB = getSafeTeam(b);
  assert.equal(teamA[0]!.uuid, onix.uuid);
  assert.equal(teamB[0]!.uuid, pikachu.uuid);
  assert.equal(teamA[0]!.trainer, "A");
  assert.equal(teamB[0]!.trainer, "B");
  assert.equal(teamB[0]!.ogTrainer, "Ash", "treinador original mantido");
  assert.equal(teamA[1]!.species, "eevee", "o resto do time não muda");
  assert.deepEqual(allUuids(a, b), before, "nenhum Pokémon duplicado ou perdido");
  assert.equal(teamB[0]!.friendship, teamB[0]!.getBaseFriendship(), "amizade volta à base com o novo dono");

  // Pikachu volta para Ash: amizade de antes da troca é restaurada.
  const r2 = manager.requestTrade(b, a) as any;
  manager.acceptRequest(a, r2.id);
  manager.updateOffer(b, 0);
  manager.updateOffer(a, 0);
  manager.setAcceptance(a, true);
  manager.setAcceptance(b, true);
  assert.equal(getSafeTeam(a)[0]!.uuid, pikachu.uuid);
  assert.equal(getSafeTeam(a)[0]!.friendship, 200, "restoreFriendship");
  assert.equal(getSafeTeam(b)[0]!.friendship, 180);
}

{
  // Tentativa de duplicação: o Pokémon ofertado sai do time antes do aceite → troca cancelada, nada muda.
  const { manager, a, b, events } = setup(["pikachu", "eevee"], ["onix"]);
  const r = manager.requestTrade(a, b) as any;
  manager.acceptRequest(b, r.id);
  manager.updateOffer(a, 0);
  manager.updateOffer(b, 0);
  manager.setAcceptance(a, true);
  const snapshotA = a.getDynamicProperty("team");
  const snapshotB = b.getDynamicProperty("team");
  const moved = getSafeTeam(a)[0]!;
  setPokemonToPCLocation(a, { location: PCPlace.Team, space: 0 }, null);
  setPokemonToPCLocation(a, { location: PCPlace.Box, boxID: 0, space: 0 }, moved);
  const afterMove = a.getDynamicProperty("team");
  manager.setAcceptance(b, true);
  assert.deepEqual(events.cancelled, ["invalid"]);
  assert.equal(events.completed.length, 0);
  assert.equal(a.getDynamicProperty("team"), afterMove);
  assert.equal(b.getDynamicProperty("team"), snapshotB);
  assert.notEqual(snapshotA, afterMove);

  // Reorganizou o time (mesmo UUID em outro espaço): a troca usa o espaço novo.
  const s2 = setup(["pikachu", "eevee"], ["onix"]);
  const r2 = s2.manager.requestTrade(s2.a, s2.b) as any;
  s2.manager.acceptRequest(s2.b, r2.id);
  const pika = getSafeTeam(s2.a)[0]!;
  s2.manager.updateOffer(s2.a, 0);
  s2.manager.updateOffer(s2.b, 0);
  const team = getSafeTeam(s2.a);
  setPokemonToPCLocation(s2.a, { location: PCPlace.Team, space: 0 }, team[1]);
  setPokemonToPCLocation(s2.a, { location: PCPlace.Team, space: 1 }, team[0]);
  s2.manager.setAcceptance(s2.a, true);
  s2.manager.setAcceptance(s2.b, true);
  assert.equal(s2.events.completed.length, 1);
  assert.equal(getSafeTeam(s2.a)[1]!.species, "onix");
  assert.equal(getSafeTeam(s2.b)[0]!.uuid, pika.uuid);
}

{
  // Desconexão e cancelamento: troca cancelada, times intactos; pedidos pendentes somem.
  const { manager, a, b, events } = setup(["pikachu"], ["onix"]);
  const r = manager.requestTrade(a, b) as any;
  manager.acceptRequest(b, r.id);
  manager.updateOffer(a, 0);
  manager.updateOffer(b, 0);
  manager.setAcceptance(a, true);
  const teams = [a.getDynamicProperty("team"), b.getDynamicProperty("team")];
  manager.onPlayerLeave("B");
  assert.deepEqual(events.cancelled, ["left"]);
  assert.ok(!manager.getActiveTrade("A"));
  assert.deepEqual([a.getDynamicProperty("team"), b.getDynamicProperty("team")], teams);
  assert.ok(!manager.setAcceptance(b, true), "sem troca ativa");

  // Saiu com pedido pendente: o Player fica inválido e `name` lança exceção; os nomes guardados são usados.
  const gone = setup(["pikachu"], ["onix"]);
  gone.manager.requestTrade(gone.a, gone.b);
  gone.a.isValid = false;
  Object.defineProperty(gone.a, "name", { get() { throw new Error("invalid player"); } });
  assert.doesNotThrow(() => gone.manager.onPlayerLeave("A"));
  assert.equal(gone.manager.getInboundRequests("B").length, 0);
  assert.ok(JSON.stringify(gone.b.messages.at(-1)).includes("Ash"), "aviso usa o nome guardado");

  // Saiu no meio (isValid falso) na hora de trocar.
  const s = setup(["pikachu"], ["onix"]);
  const r2 = s.manager.requestTrade(s.a, s.b) as any;
  s.manager.acceptRequest(s.b, r2.id);
  s.manager.updateOffer(s.a, 0);
  s.manager.updateOffer(s.b, 0);
  s.manager.setAcceptance(s.a, true);
  s.b.isValid = false;
  s.manager.setAcceptance(s.b, true);
  assert.deepEqual(s.events.cancelled, ["left"]);
  assert.equal(getSafeTeam(s.a)[0]!.species, "pikachu");

  // Pedido: distância (tradeMaxDistance), expiração e sem Pokémon.
  const far = setup(["pikachu"], ["onix"], 50);
  assert.equal(far.manager.requestTrade(far.a, far.b), undefined, "longe demais");
  const exp = setup(["pikachu"], ["onix"]);
  const r3 = exp.manager.requestTrade(exp.a, exp.b) as any;
  exp.advance(20 * 20 + 1);
  assert.equal(exp.manager.acceptRequest(exp.b, r3.id), undefined, "pedido expirou");
  const empty = setup(["pikachu"], []);
  const r4 = empty.manager.requestTrade(empty.a, empty.b) as any;
  assert.equal(empty.manager.acceptRequest(empty.b, r4.id), undefined, "quem aceita não tem Pokémon");
  // Pedido cruzado: pedir para quem já pediu aceita.
  const cross = setup(["pikachu"], ["onix"]);
  cross.manager.requestTrade(cross.a, cross.b);
  const started = cross.manager.requestTrade(cross.b, cross.a);
  assert.ok(started instanceof ActiveTrade);
}

{
  // Evolução por troca: Kadabra fica pronto para evoluir (opcional); Karrablast ↔ Shelmet usam o contexto.
  const { manager, a, b, events } = setup(["kadabra"], ["karrablast"]);
  const r = manager.requestTrade(a, b) as any;
  manager.acceptRequest(b, r.id);
  manager.updateOffer(a, 0);
  manager.updateOffer(b, 0);
  manager.setAcceptance(a, true);
  manager.setAcceptance(b, true);
  const kadabra = getSafeTeam(b)[0]!;
  assert.equal(kadabra.species, "kadabra");
  assert.deepEqual(kadabra.readyEvolutions, ["kadabra_alakazam"], "evolução pendente gravada no time do novo dono");
  assert.equal(events.completed[0].evolutions.get(kadabra.uuid), "kadabra_alakazam");
  assert.deepEqual(getSafeTeam(a)[0]!.readyEvolutions, [], "Karrablast trocado por Kadabra não evolui (precisa de Shelmet)");

  const karrablast = mon("karrablast");
  const shelmet = mon("shelmet");
  assert.equal(attemptTradeEvolution(karrablast, shelmet)?.evolutionId, "karrablast_escavalier");
  assert.equal(attemptTradeEvolution(shelmet, karrablast)?.evolutionId, "shelmet_accelgor");
  assert.equal(attemptTradeEvolution(mon("karrablast"), mon("pikachu")), undefined);
  assert.equal(attemptTradeEvolution(mon("pikachu"), mon("eevee")), undefined, "sem evolução por troca");
  const everstone = mon("kadabra", 30, { minecraftItem: "cobblemon:everstone", item: "everstone" });
  assert.equal(attemptTradeEvolution(everstone, mon("pikachu")), undefined, "Everstone bloqueia");
}

console.warn = originalWarn;
console.info = originalInfo;
console.log("social: ok");
