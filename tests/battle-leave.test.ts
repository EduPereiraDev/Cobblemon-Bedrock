// Frente "battle-leave": jogador que sai do servidor no meio de uma batalha PvP (1×1 e Multi 2×2).
// Cobblemon (SERVER_PLAYER_LOGOUT): `getBattleByParticipatingPlayer(player)?.stop()` — a batalha acaba para quem ficou,
// com limpeza, e nada mais tenta usar a entidade que saiu (menu "Battle menu error" e HUD "Failed to get property").
import assert from "node:assert/strict";
import { advance, advanceUntil, createPlayer, FakePlayer } from "./batalhas-harness";
import { PokemonData } from "../scripts/Pokemon";
import { getSafeTeam } from "../scripts/pokemonStorage";
import {
	BattleActor, PokemonBattle, battleMap, startMultiBattle, startPvPBattle, stopBattlesOfLeavingPlayer, tryGetBattleFromEntity,
} from "../scripts/battle";
import { ActionResponse, MoveActionResponse, PassActionResponse, SwitchActionResponse } from "../scripts/battle/ActionResponse";
import { RequestData, requestPokemonUUID } from "../scripts/battle/Request";
import { getTargetOptions } from "../scripts/battle/SimQueries";
import { setMoveLearningPrompt } from "../scripts/battle/Rewards";
import { battleView } from "../scripts/ui/BattleHud";
import { teamManager } from "../scripts/battle/Teams";
import { Dex } from "../scripts/showdown";

const originalError = console.error, originalWarn = console.warn, originalInfo = console.info, originalLog = console.log;
const logged: string[] = [];
console.error = (...args: unknown[]) => { logged.push(`ERROR ${args.join(" ")}`); };
console.warn = (...args: unknown[]) => { logged.push(`WARN ${args.join(" ")}`); };
console.info = () => { };
console.log = () => { };
setMoveLearningPrompt(async () => false);

function pokemon(species: string, level: number, moves = ["tackle"]) {
	const data = PokemonData.generateNewWildPokemon(species, { level, shiny: false });
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

function autoDecider(actor: BattleActor, request: RequestData): ActionResponse[] {
	const responses: ActionResponse[] = [];
	for (let slot = 0; slot < actor.slotCount; slot++) {
		if (!actor.slotNeedsChoice(slot, request)) { responses.push(new PassActionResponse()); continue; }
		if (request.forceSwitch) {
			const next = request.side.pokemon.find(x => !x.active && !x.condition.endsWith("fnt"));
			responses.push(new SwitchActionResponse(requestPokemonUUID(next!)));
			continue;
		}
		const move = request.active![slot].moves[0];
		const targets = getTargetOptions(actor, slot, move.target);
		responses.push(new MoveActionResponse(move.id, targets?.find(x => !x.ally)?.loc ?? targets?.[0]?.loc));
	}
	return responses;
}

/** Como no Bedrock: depois de sair, ler `name` ou chamar `sendMessage` lança InvalidEntityError. */
function behaveLikeBedrock(player: FakePlayer) {
	const name = player.name;
	Object.defineProperty(player, "name", {
		get() { if (!player.isValid) throw new Error("Failed to get property 'name'"); return name; },
	});
	const send = player.sendMessage.bind(player);
	player.sendMessage = (msg: unknown) => {
		if (!player.isValid) throw new Error("InvalidEntityError: sendMessage");
		send(msg);
	};
}

/** Tela de escolha aberta (o form fica pendente até o teste fechar; ao desconectar, fecha sem resposta). */
function openMenu(actor: BattleActor) {
	let close: (value: ActionResponse[] | undefined) => void = () => { };
	actor.decider = () => new Promise(resolve => { close = resolve; });
	return () => close(undefined);
}

function assertCleanedUp(battle: PokemonBattle, players: FakePlayer[]) {
	assert.ok(battle.ended, "a batalha deve terminar quando um participante sai");
	assert.equal(battle.endReason, "stopped", "saída = stop() (como o Cobblemon)");
	assert.ok(!battleMap.has(battle.battleId), "batalha fora do registro");
	for (const player of players) {
		assert.equal(tryGetBattleFromEntity(player as never), undefined, `${player.name}: sem batalha`);
		assert.equal(player.getDynamicProperty("in_battle"), undefined, `${player.name}: in_battle limpo`);
		assert.equal(player.getProperty("cobblemon:in_battle"), false, `${player.name}: propriedade in_battle limpa`);
	}
	for (const actor of battle.actors) {
		assert.equal(actor.mustChoose, false);
		assert.equal(actor.prompting, false);
	}
}

const problems = () => logged.filter(x => /Battle menu error|HUD de batalha|InvalidEntityError|Failed to get property|end step/.test(x));

// ------------------------------------------------------------------------------------------------
// 1. PvP 1×1: o menu de quem sai fecha ANTES de a batalha saber da saída (ordem real do BDS no log do bug).
// ------------------------------------------------------------------------------------------------
{
	const red = createPlayer("Red", [pokemon("bulbasaur", 20)], { x: 0, y: 64, z: 0 });
	const blue = createPlayer("Blue", [pokemon("squirtle", 20)], { x: 5, y: 64, z: 0 });
	behaveLikeBedrock(red);
	const blueTeamBefore = JSON.stringify(getSafeTeam(blue as never).map(x => x?.uuid));
	const battle = startPvPBattle(red as never, blue as never)!;
	assert.ok(battle, "PvP deve começar");
	const redActor = battle.getActorFromID(red.id)!;
	const blueActor = battle.getActorFromID(blue.id)!;
	const closeRedMenu = openMenu(redActor);
	blueActor.decider = autoDecider;
	assert.ok(await advanceUntil(() => redActor.prompting, 20_000), "o menu de Red deve abrir");

	// Red sai: a entidade fica inválida e o form fecha sem resposta.
	red.isValid = false;
	// HUD de Blue (e o nome do oponente) nessa janela: sem ler a entidade inválida.
	const view = battleView(battle, blue as never);
	assert.equal(view.rightActor, "Red", "HUD mostra o nome capturado antes da saída");
	assert.deepEqual(redActor.getName(), { text: "Red" }, "getName usa o nome capturado");
	closeRedMenu();
	await advance(1, 1);
	assert.deepEqual(problems(), [], "sem erro de menu/HUD depois que o jogador saiu");

	// playerLeave: a batalha acaba na hora, sem esperar a checagem periódica.
	const stopped = stopBattlesOfLeavingPlayer(red.id);
	assert.deepEqual(stopped, [battle]);
	assertCleanedUp(battle, [blue]);
	assert.equal(JSON.stringify(getSafeTeam(blue as never).map(x => x?.uuid)), blueTeamBefore, "time de Blue intacto");
	await advance(60);
	assert.deepEqual(problems(), [], "sem erros depois do fim");
	assert.deepEqual(stopBattlesOfLeavingPlayer(red.id), [], "segunda chamada não faz nada");
}

// ------------------------------------------------------------------------------------------------
// 2. PvP 1×1: saída detectada primeiro (playerLeave) e o menu fecha depois; o HUD roda no meio.
// ------------------------------------------------------------------------------------------------
{
	const red = createPlayer("Leaf", [pokemon("charmander", 20)], { x: 0, y: 64, z: 0 });
	const blue = createPlayer("Silver", [pokemon("totodile", 20)], { x: 5, y: 64, z: 0 });
	behaveLikeBedrock(red);
	const battle = startPvPBattle(red as never, blue as never)!;
	const redActor = battle.getActorFromID(red.id)!;
	const closeRedMenu = openMenu(redActor);
	battle.getActorFromID(blue.id)!.decider = autoDecider;
	assert.ok(await advanceUntil(() => redActor.prompting, 20_000));
	red.isValid = false;
	stopBattlesOfLeavingPlayer(red.id);
	closeRedMenu();
	await advance(60);
	assertCleanedUp(battle, [blue]);
	assert.deepEqual(problems(), []);
}

// ------------------------------------------------------------------------------------------------
// 3. Espectador/jogador fora da batalha saindo não encerra nada; checagem periódica continua valendo.
// ------------------------------------------------------------------------------------------------
{
	const a = createPlayer("Ethan", [pokemon("chikorita", 20)], { x: 0, y: 64, z: 0 });
	const b = createPlayer("Lyra", [pokemon("cyndaquil", 20)], { x: 5, y: 64, z: 0 });
	const stranger = createPlayer("Kris", [pokemon("pidgey", 5)], { x: 9, y: 64, z: 0 });
	const battle = startPvPBattle(a as never, b as never)!;
	const close = openMenu(battle.getActorFromID(a.id)!);
	const closeB = openMenu(battle.getActorFromID(b.id)!);
	assert.deepEqual(stopBattlesOfLeavingPlayer(stranger.id), []);
	assert.ok(!battle.ended);
	// Sem o evento (ex.: saída não notificada), a checagem periódica ainda encerra.
	behaveLikeBedrock(a);
	a.isValid = false;
	close();
	await advance(20, 1);
	assertCleanedUp(battle, [b]);
	closeB();
	await advance(20);
	assert.deepEqual(problems(), []);
}

// ------------------------------------------------------------------------------------------------
// 4. Multi 2×2: um jogador sai; a batalha acaba para os 3 que ficaram e a equipe dele é desfeita.
// ------------------------------------------------------------------------------------------------
{
	const a = createPlayer("MultiA1", [pokemon("pikachu", 30, ["thundershock"])], { x: 0, y: 64, z: 0 });
	const b = createPlayer("MultiA2", [pokemon("eevee", 30)], { x: 2, y: 64, z: 0 });
	const c = createPlayer("MultiB1", [pokemon("psyduck", 30)], { x: 6, y: 64, z: 0 });
	const d = createPlayer("MultiB2", [pokemon("geodude", 30)], { x: 8, y: 64, z: 0 });
	for (const p of [a, b, c, d]) behaveLikeBedrock(p);
	const request = teamManager.requestTeam(a as never, b as never);
	assert.ok(request && "id" in request && !("players" in request), "convite de equipe criado");
	assert.ok(teamManager.acceptTeamRequest(b as never, (request as { id: number }).id), "equipe A formada");
	assert.ok(teamManager.sameTeam(a.id, b.id));
	const battle = startMultiBattle([a as never, b as never], [c as never, d as never])!;
	assert.ok(battle, "Multi deve começar");
	const closeA = openMenu(battle.getActorFromID(a.id)!);
	for (const p of [b, c, d]) battle.getActorFromID(p.id)!.decider = autoDecider;
	assert.ok(await advanceUntil(() => battle.getActorFromID(a.id)!.prompting, 20_000));

	a.isValid = false;
	for (const viewer of [b, c, d]) battleView(battle, viewer as never);
	closeA();
	await advance(1, 1);
	// Os dois assinantes de playerLeave (batalhas e equipes).
	stopBattlesOfLeavingPlayer(a.id);
	teamManager.onPlayerLeave(a.id);
	assertCleanedUp(battle, [b, c, d]);
	assert.equal(teamManager.getTeam(a.id), undefined, "quem saiu não tem equipe");
	assert.equal(teamManager.getTeam(b.id), undefined, "equipe de 1 é desfeita");
	await advance(60);
	assert.deepEqual(problems(), [], "sem erros no Multi");
}

console.error = originalError;
console.warn = originalWarn;
console.log = originalLog;
console.info = originalInfo;
console.info("ok: battle-leave (PvP 1×1 nas duas ordens, estranho saindo, checagem periódica, Multi 2×2 com equipe desfeita)");
