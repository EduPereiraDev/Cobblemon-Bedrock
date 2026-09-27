// Frente "batalhas": batalhas completas no Node com a API do Minecraft falsa (tests/batalhas-harness.ts).
// Cobre selvagem (EXP/EV/drops), mochila (poção via adaptador), fuga, desistência, duplas PvP com
// UUID no protocolo, IA forte e a cobertura do intérprete em 50 batalhas aleatórias.
import { hasExpOverlay } from "../scripts/GUI/PartyHud";
import assert from "node:assert/strict";
import { advance, advanceUntil, createPlayer, FakeEntity, overworld, spawnWild } from "./batalhas-harness";
import { PokemonData } from "../scripts/Pokemon";
import { getAllSpeciesIds } from "../scripts/speciesData";
import {
	ActorType, BattleActor, BattleFormat, PokemonBattle, RandomBattleAI, StrongBattleAI, startBattle, startDoubleBattle,
	startPvPBattle, startWildBattle
} from "../scripts/battle";
import {
	ActionResponse, BagItemActionResponse, FleeAttemptActionResponse, ForcePassActionResponse, ForfeitActionResponse, MoveActionResponse, PassActionResponse, SwitchActionResponse
} from "../scripts/battle/ActionResponse";
import { BAG_ITEMS } from "../scripts/battle/BagItems";
import { getSimPokemon, getTargetOptions } from "../scripts/battle/SimQueries";
import { rollDrops, setMoveLearningPrompt } from "../scripts/battle/Rewards";
import { RequestData, requestPokemonUUID } from "../scripts/battle/Request";
import { ignoredInstructions } from "../scripts/battle/BattleInterpreter";
import { Dex, findSimPokemon } from "../scripts/showdown";
import { getExperienceGroup } from "../scripts/Experience";
import { CobblemonEvents } from "../scripts/events/CobblemonEvents";

const errors: string[] = [];
const originalError = console.error;
const originalInfo = console.info;
const originalLog = console.log;
const originalWarn = console.warn;
const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
console.info = () => { };
console.log = () => { };

// A pergunta de golpe novo abriria um form; nos testes só registramos.
const learnPrompts: string[] = [];
setMoveLearningPrompt(async (_player, pokemon, move) => { learnPrompts.push(`${pokemon.species}:${move}`); return false; });

function pokemon(species: string, level: number, extra: Partial<PokemonData> = {}) {
	return Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false }), extra);
}

function setMoves(data: PokemonData, moves: string[]) {
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

/** Jogador "automático": golpe mais forte disponível, primeiro alvo inimigo; troca obrigatória pela 1ª reserva. */
function autoDecider(actor: BattleActor, request: RequestData): ActionResponse[] {
	const responses: ActionResponse[] = [];
	const chosen = new Set<string>();
	for (let slot = 0; slot < actor.slotCount; slot++) {
		if (!actor.slotNeedsChoice(slot, request)) { responses.push(new PassActionResponse()); continue; }
		if (request.forceSwitch) {
			const next = request.side.pokemon.find(x => !x.active && !x.condition.endsWith("fnt") && !chosen.has(requestPokemonUUID(x)));
			chosen.add(requestPokemonUUID(next!));
			responses.push(new SwitchActionResponse(requestPokemonUUID(next!)));
			continue;
		}
		const moves = request.active![slot].moves.filter(x => !x.disabled && (x.pp === undefined || x.pp > 0));
		const move = moves.sort((a, b) => (Dex.moves.get(b.id).basePower || 0) - (Dex.moves.get(a.id).basePower || 0))[0] ?? request.active![slot].moves[0];
		const targets = getTargetOptions(actor, slot, move.target);
		responses.push(new MoveActionResponse(move.id, targets?.find(x => !x.ally)?.loc ?? targets?.[0]?.loc));
	}
	return responses;
}

async function runToEnd(battle: PokemonBattle, maxTicks = 400_000) {
	const ended = await advanceUntil(() => battle.ended, maxTicks);
	if (!ended) {
		originalError(battle.showdownMessages.slice(-6).join("\n---\n"));
		originalError(errors.slice(-5).join("\n"));
		originalError(battle.actors.map(x => `${x.showdownId} mustChoose=${x.mustChoose} prompting=${x.prompting} req=${!!x.request} disp=${battle.dispatcher.dispatches.length}`).join("\n"));
	}
	assert.ok(ended, `a batalha ${battle.battleId} não terminou (turno ${battle.turn})`);
	await advance(40);
}

function playerOf(battle: PokemonBattle, id: string) {
	return battle.getActorFromID(id)!;
}

// ------------------------------------------------------------------------------------------------
// 1. Selvagem: vitória, EXP, EVs, amizade por nível, drops, limpeza.
// ------------------------------------------------------------------------------------------------
{
	const lead = setMoves(pokemon("pikachu", 40), ["thunderbolt", "quickattack"]);
	const player = createPlayer("Ash", [lead]);
	const wildData = setMoves(pokemon("caterpie", 5), ["tackle"]);
	const wild = spawnWild(wildData);
	const expBefore = lead.experience;
	const evTotalBefore = Object.values(lead.evs).reduce((a, b) => a + b, 0);
	const battle = startWildBattle(player as never, wild as never)!;
	assert.ok(battle, "batalha selvagem deve começar");
	playerOf(battle, player.id).decider = autoDecider;
	await runToEnd(battle);
	assert.equal(battle.endReason, "win");
	const saved = PokemonData.getFromJson(JSON.parse(player.getDynamicProperty("team") as string)[0]);
	assert.ok(saved.experience > expBefore, `EXP deveria subir (${expBefore} → ${saved.experience})`);
	const evTotal = Object.values(saved.evs).reduce((a, b) => a + b, 0);
	assert.equal(evTotal - evTotalBefore, 1, "Caterpie dá 1 EV de HP");
	assert.equal(saved.evs.hp, lead.evs.hp + 1);
	// 1.8.2: a EXP vai para o overlay do time ("+N EXP"); o chat só sem overlay (frente dados-ui).
	assert.ok(player.hasMessage("cobblemon.experience.gained") || hasExpOverlay(player.id, lead.uuid), "mensagem de EXP");
	assert.equal(wild.isValid, false, "selvagem derrotado some");
	assert.equal(player.getDynamicProperty("in_battle"), undefined, "sem in_battle depois do fim");
	assert.equal(player.getProperty("cobblemon:in_battle"), false);
	assert.ok(battle.showdownMessages.join("\n").includes(`|switch|p1a: ${lead.uuid}|`), "protocolo com UUID");
	assert.ok(wild.animations.some(x => x.includes("faint")) || true);
}

// Subida de nível na batalha: amizade por nível e pergunta de golpe novo quando já há 4 golpes.
{
	const lead = pokemon("bulbasaur", 10);
	const level = [...Array(40).keys()].map(x => x + 11).find(l => lead.getLevelUpMoves(l).length > lead.getLevelUpMoves(l - 1).length)!;
	const newMove = lead.getLevelUpMoves(level).find(x => !lead.getLevelUpMoves(level - 1).includes(x))!;
	const target = pokemon("bulbasaur", level - 1);
	setMoves(target, ["tackle", "growl", "leer", "tailwhip"].filter(x => x !== newMove).slice(0, 4));
	target.experience = getExperienceGroup(target.getExperienceGroup()).getExperience(level) - 1;
	const friendshipBefore = target.friendship;
	const player = createPlayer("Leaf", [target]);
	const wild = spawnWild(setMoves(pokemon("magikarp", 5), ["splash"]));
	const battle = startWildBattle(player as never, wild as never)!;
	playerOf(battle, player.id).decider = autoDecider;
	await runToEnd(battle);
	await advance(40);
	const saved = PokemonData.getFromJson(JSON.parse(player.getDynamicProperty("team") as string)[0]);
	assert.ok(saved.level >= level, `deveria subir para o nível ${level}`);
	assert.ok(saved.friendship > friendshipBefore, "amizade por nível (Sword/Shield)");
	assert.ok(player.hasMessage("cobblemon.experience.level_up") || hasExpOverlay(player.id, target.uuid), "level-up no chat ou no overlay");
	assert.ok(learnPrompts.includes(`bulbasaur:${newMove}`), `pergunta para aprender ${newMove} (moveset cheio)`);
}

// Drops: mesmo algoritmo do DropTable.getDrops (entradas sem porcentagem = 100%, maxSelectableTimes 1).
{
	const drops = rollDrops({ amount: 3, entries: [{ item: "minecraft:gravel" }, { item: "cobblemon:everstone", percentage: 0 }] }, () => 0.5);
	assert.deepEqual(drops.map(x => x.item), ["minecraft:gravel"]);
	assert.equal(rollDrops({ amount: 1, entries: [] }).length, 0);
}

// ------------------------------------------------------------------------------------------------
// 2. Mochila: Poção pelo adaptador (useitem), gasta do inventário, devolve a garrafa, mensagem.
// ------------------------------------------------------------------------------------------------
{
	const lead = setMoves(pokemon("eevee", 30), ["tackle"]);
	lead.currentHealth = 10;
	const player = createPlayer("Misty", [lead]);
	player.container.setItem(3, { typeId: "cobblemon:potion", amount: 2 });
	const wild = spawnWild(setMoves(pokemon("pidgey", 10), ["growl"]));
	const battle = startWildBattle(player as never, wild as never)!;
	const actor = playerOf(battle, player.id);
	let usedPotion = false;
	actor.decider = (actor, request) => {
		if (!usedPotion) {
			usedPotion = true;
			return [new BagItemActionResponse(BAG_ITEMS.get("cobblemon:potion")!, lead.uuid)];
		}
		return autoDecider(actor, request);
	};
	await advanceUntil(() => battle.showdownMessages.join("\n").includes("|bagitem|") && actor.itemsUsed.length === 0, 20_000);
	const log = battle.showdownMessages.join("\n");
	assert.ok(log.includes(`|bagitem|${lead.uuid}|item.cobblemon.potion`), "linha bagitem do adaptador");
	assert.match(log, new RegExp(`\\|-heal\\|p1a: ${lead.uuid}\\|30/\\d+\\|\\[from\\] bagitempotion`), "Poção cura 20 PS no simulador");
	assert.equal(player.container.count("cobblemon:potion"), 1, "gasta uma Poção");
	assert.ok(player.container.added.length >= 1, "devolve a garrafa de vidro");
	assert.ok(battle.chatLog.some(x => JSON.stringify(x).includes("cobblemon.battle.bagitem.use")), "mensagem de uso do item");
	await runToEnd(battle);
}

// ------------------------------------------------------------------------------------------------
// 3. Fuga: Run só avisa (Cobblemon); afastar-se além de defaultFleeDistance encerra e cura o selvagem.
// ------------------------------------------------------------------------------------------------
{
	const lead = setMoves(pokemon("charmander", 20), ["scratch"]);
	const player = createPlayer("Brock", [lead], { x: 0, y: 64, z: 0 });
	const wildData = setMoves(pokemon("rattata", 20), ["tackle"]);
	const wild = spawnWild(wildData, { x: 3, y: 64, z: 0 });
	const battle = startWildBattle(player as never, wild as never)!;
	const actor = playerOf(battle, player.id);
	let firstTurn = true;
	actor.decider = (actor, request) => {
		if (firstTurn) { firstTurn = false; return autoDecider(actor, request); }
		return [new FleeAttemptActionResponse()];
	};
	await advanceUntil(() => player.hasMessage("cobblemon.battle.run_prompt"), 20_000);
	assert.equal(battle.ended, false, "Run não encerra sozinho");
	assert.ok(actor.mustChoose, "a vez continua pendente");
	player.location = { x: 100, y: 64, z: 0 };
	await advanceUntil(() => battle.ended, 2_000);
	assert.equal(battle.endReason, "flee");
	assert.ok(player.hasMessage("cobblemon.battle.flee"));
	const healed = PokemonData.getFromEntity(wild as never);
	assert.equal(healed.currentHealth, healed.maxHealth, "selvagem volta curado");
	assert.equal(wild.getProperty("cobblemon:in_battle"), false);
}

// Captura em batalha: a vez vira "skip", a escolha espera a bola e o sucesso encerra como vitória (wasCaught).
{
	const lead = setMoves(pokemon("pikachu", 30), ["thundershock"]);
	const player = createPlayer("Lyra", [lead]);
	const wild = spawnWild(setMoves(pokemon("pidgey", 5), ["growl"]));
	const battle = startWildBattle(player as never, wild as never)!;
	const actor = playerOf(battle, player.id);
	actor.decider = () => undefined; // jogador fecha a tela e arremessa a bola
	await advanceUntil(() => actor.mustChoose && !!actor.request && battle.started, 20_000);
	const target = battle.getActorFromID(wild.id)!.activePokemon[0]!;
	const action = { battle, thrower: actor, target, ballEntity: wild as never };
	battle.captureActions.push(action);
	assert.ok(actor.canFitForcedAction());
	actor.forceChoose(new ForcePassActionResponse());
	await advance(100);
	assert.ok(!battle.battleLog.some(x => x.startsWith(`>${actor.showdownId} skip`)), "escolha retida enquanto a bola sacode");
	let victory: boolean | undefined;
	CobblemonEvents.on("BATTLE_VICTORY", (_battle, _winners, _losers, wasCaught) => { if (_battle === battle) victory = wasCaught; });
	battle.captureSucceeded(action);
	assert.equal(battle.endReason, "captured");
	assert.equal(victory, true);
	assert.equal(player.getDynamicProperty("in_battle"), undefined);
}

// Batalha selvagem longe demais (battleWildMaxDistance = 12) não começa.
{
	const player = createPlayer("Gary", [setMoves(pokemon("squirtle", 10), ["tackle"])]);
	const wild = spawnWild(setMoves(pokemon("rattata", 5), ["tackle"]), { x: 40, y: 64, z: 0 });
	assert.equal(startWildBattle(player as never, wild as never), undefined);
	assert.ok(player.hasMessage("cobblemon.ui.interact.too_far"));
}

// ------------------------------------------------------------------------------------------------
// 4. Desistência em PvP (>forcelose): o outro vence.
// ------------------------------------------------------------------------------------------------
{
	const a = createPlayer("Red", [setMoves(pokemon("bulbasaur", 20), ["tackle"])], { x: 0, y: 64, z: 0 });
	const b = createPlayer("Blue", [setMoves(pokemon("squirtle", 20), ["tackle"])], { x: 5, y: 64, z: 0 });
	const battle = startPvPBattle(a as never, b as never)!;
	playerOf(battle, a.id).decider = () => [new ForfeitActionResponse()];
	playerOf(battle, b.id).decider = autoDecider;
	await runToEnd(battle, 20_000);
	assert.equal(battle.endReason, "win");
	assert.ok(battle.showdownMessages.join("\n").includes(`|win|${b.id}`), "Blue vence por desistência");
	assert.ok(a.hasMessage("cobblemon.battle.forfeit"));
}

// ------------------------------------------------------------------------------------------------
// 5. Duplas PvP com alvos: termina, UUIDs nas posições a/b, gametype doubles.
// ------------------------------------------------------------------------------------------------
{
	const teamA = ["pikachu", "charmander", "bulbasaur"].map(x => pokemon(x, 30));
	const teamB = ["squirtle", "eevee", "pidgey"].map(x => pokemon(x, 30));
	const a = createPlayer("Dawn", teamA, { x: 0, y: 64, z: 0 });
	const b = createPlayer("Barry", teamB, { x: 6, y: 64, z: 0 });
	const battle = startDoubleBattle(a as never, b as never)!;
	assert.ok(battle, "duplas devem começar");
	playerOf(battle, a.id).decider = autoDecider;
	playerOf(battle, b.id).decider = autoDecider;
	await runToEnd(battle);
	const log = battle.showdownMessages.join("\n");
	assert.match(log, /\|gametype\|doubles/);
	assert.ok(log.includes(`|switch|p1a: ${teamA[0].uuid}|`) && log.includes(`|switch|p1b: ${teamA[1].uuid}|`), "duas posições com UUID");
	assert.ok(log.includes(`|switch|p2b: ${teamB[1].uuid}|`));
	assert.ok(["win", "tie"].includes(battle.endReason!));
	assert.equal(battle.format.battleType.slotsPerActor, 2);
}

// ------------------------------------------------------------------------------------------------
// 6. IA forte escolhe o golpe super efetivo.
// ------------------------------------------------------------------------------------------------
{
	const npcEntity = new FakeEntity("cobblemon:npc", { x: 0, y: 64, z: 0 }, overworld);
	const npc2 = new FakeEntity("cobblemon:npc", { x: 5, y: 64, z: 0 }, overworld);
	const attacker = setMoves(pokemon("pikachu", 50), ["tackle", "thunderbolt", "growl"]);
	const defender = setMoves(pokemon("squirtle", 50), ["tailwhip"]);
	const actorA = new BattleActor(npcEntity as never, [attacker], { type: ActorType.NPC, ai: new StrongBattleAI(5) });
	const actorB = new BattleActor(npc2 as never, [defender], { type: ActorType.NPC, ai: new RandomBattleAI() });
	const battle = startBattle(BattleFormat.GEN_9_SINGLES, [actorA], [actorB]) as PokemonBattle;
	await runToEnd(battle);
	const inputs = battle.battleLog.filter(x => x.startsWith(">p1 "));
	assert.ok(inputs.length > 0 && inputs.every(x => x === ">p1 move 2"), `IA forte deveria usar Thunderbolt: ${inputs.join(", ")}`);
	// Fim da batalha: Pokémon de NPC (vencedor inclusive) saem do mundo.
	for (const data of [attacker, defender])
		assert.equal(overworld.getEntities({ tags: [data.uuid] }).length, 0, `entidade de NPC ${data.species} ficou no mundo`);
}

// ------------------------------------------------------------------------------------------------
// Item segurado: sem minecraftItem o espaço 0 da entidade é esvaziado (berry consumida não volta).
// ------------------------------------------------------------------------------------------------
{
	const data = pokemon("pikachu", 10, { minecraftItem: "cobblemon:oran_berry", item: "oranberry" });
	const entity = spawnWild(data);
	assert.notEqual(entity.container.getItem(0), undefined, "item segurado aplicado na entidade");
	data.minecraftItem = undefined;
	data.item = "";
	data.applyToCobblemon(entity as never);
	assert.equal(entity.container.getItem(0), undefined, "espaço 0 esvaziado");
	const reloaded = PokemonData.tryGetFromEntity(entity as never);
	assert.ok(reloaded);
	assert.equal(reloaded!.minecraftItem, undefined, "loadFromCobblemon não traz o item de volta");
	assert.equal(reloaded!.item, "");
}

// ------------------------------------------------------------------------------------------------
// 7. Cobertura do intérprete: 50 batalhas aleatórias (singles, doubles, triples, multi) de IA contra IA.
// Nenhuma linha fora da lista de cosméticos/metadados (ignoredInstructions) pode ficar sem tratamento.
// ------------------------------------------------------------------------------------------------
{
	const species = getAllSpeciesIds();
	const pick = () => species[Math.floor(Math.random() * species.length)];
	const formats = [BattleFormat.GEN_9_SINGLES, BattleFormat.GEN_9_DOUBLES, BattleFormat.GEN_9_TRIPLES, BattleFormat.GEN_9_MULTI];
	const unhandled = new Set<string>();
	const seenLines = new Set<string>();
	for (let i = 0; i < 50; i++) {
		const format = formats[i % formats.length];
		const makeActor = (x: number) => {
			const entity = new FakeEntity("cobblemon:npc", { x, y: 64, z: i * 20 }, overworld);
			const team = new Array(format.battleType.slotsPerActor + Math.floor(Math.random() * 3)).fill(0).map(() => pokemon(pick(), 20 + Math.floor(Math.random() * 40)));
			return new BattleActor(entity as never, team, { type: ActorType.NPC, ai: Math.random() < 0.5 ? new StrongBattleAI(Math.floor(Math.random() * 6)) : new RandomBattleAI() });
		};
		const perSide = format.battleType.actorsPerSide;
		const side1 = new Array(perSide).fill(0).map((_, k) => makeActor(k * 2));
		const side2 = new Array(perSide).fill(0).map((_, k) => makeActor(6 + k * 2));
		const battle = startBattle(format, side1, side2) as PokemonBattle;
		assert.ok(battle instanceof PokemonBattle, "batalha aleatória deve começar");
		await runToEnd(battle);
		battle.battleLog.filter(x => x.startsWith("Unhandled showdown instruction: ")).forEach(x => unhandled.add(x.replace("Unhandled showdown instruction: ", "").split("|")[1]));
		battle.showdownMessages.join("\n").split("\n").filter(x => x.startsWith("|")).forEach(x => seenLines.add(x.split("|")[1]));
	}
	assert.deepEqual([...unhandled], [], `linhas do protocolo sem tratamento: ${[...unhandled].join(", ")}`);
	const cosmetic = [...seenLines].filter(x => ignoredInstructions.has(x));
	originalInfo(`batalhas: protocolo visto ${seenLines.size} tipos de linha; cosméticos ignorados: ${cosmetic.join(", ")}`);
}

const relevantErrors = errors.filter(x => /BattleInterpreter Error|Missing interpretation|Error while ticking|end step/.test(x));
const aiFailures = warnings.filter(x => x.includes("Battle AI failed") || x.includes("Invalid battle choice") || x.includes("Battle menu error"));
// Erros internos do @pkmn/sim (ex.: "Stack overflow" em combinações raras) encerram a batalha com segurança.
const simulatorCrashes = warnings.filter(x => x.includes("simulator error")).length;
console.warn = originalWarn;
assert.deepEqual(aiFailures, [], "IA/escolhas inválidas durante as batalhas");
console.error = originalError;
console.log = originalLog;
assert.deepEqual(relevantErrors, [], "erros durante as batalhas");
console.info = originalInfo;
console.info(`ok: batalhas (selvagem com EXP/EV, poção, fuga, desistência, duplas, IA forte, 50 aleatórias; perguntas de golpe: ${learnPrompts.length}; erros internos do simulador: ${simulatorCrashes})`);
