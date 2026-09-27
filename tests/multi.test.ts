// Frente "multi": equipes para Batalha Multi (TeamManager do Cobblemon: pedido/aceite/expiração, saída, dissolução,
// desafio equipe → equipe com validações), menu de interação (Formar grupo / Batalha Multi / Abandonar grupo +
// regra de nível), PvP de nível fixo 5/50/100 (1×1 e 2×2) e os ajudantes de /pokebattle e /abandonmultiteam.
import assert from "node:assert/strict";
import { advance, advanceUntil, createPlayer, FakePlayer, overworld } from "./batalhas-harness";
import { formHooks } from "./mocks/minecraft-server-ui";
import { PokemonData } from "../scripts/Pokemon";
import { getSafeTeam } from "../scripts/pokemonStorage";
import { BattleActor, PokemonBattle, tryGetBattleFromEntity } from "../scripts/battle";
import {
	LEVEL_RULES, MAX_BATTLE_RADIUS, MULTI_CHALLENGE_TICKS, MultiBattleTeam, TEAM_REQUEST_TICKS, TeamManager, levelRuleText, parseLevelRule,
} from "../scripts/battle/TeamManager";
import { abandonMultiTeam, teamManager } from "../scripts/battle/Teams";
import { openPlayerInteractionMenu } from "../scripts/trade/PlayerInteraction";
import { challengePlayer } from "../scripts/ChallengePlayer";
import handleChallenge from "../scripts/ChallengePlayer";
import { parseChallengeFormat } from "../scripts/commands";
import { ActionResponse, MoveActionResponse, PassActionResponse, SwitchActionResponse } from "../scripts/battle/ActionResponse";
import { RequestData, requestPokemonUUID } from "../scripts/battle/Request";
import { getTargetOptions } from "../scripts/battle/SimQueries";
import { setMoveLearningPrompt } from "../scripts/battle/Rewards";
import { Dex } from "../scripts/showdown";

const originalError = console.error;
const errors: string[] = [];
console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
console.warn = () => { };
console.info = () => { };
console.log = () => { };
setMoveLearningPrompt(async () => false);

// ---------------------------------------------------------------------------------------------
// Ajudantes

/** Jogador falso mínimo para a lógica pura do TeamManager. */
class TeamPlayer {
	isValid = true;
	messages: unknown[] = [];
	dimension = { id: "minecraft:overworld" };
	location: { x: number; y: number; z: number };
	constructor(public id: string, public name: string, x = 0, z = 0) { this.location = { x, y: 64, z }; }
	sendMessage(message: unknown) { this.messages.push(message); }
	has(key: string) { return this.messages.some(m => JSON.stringify(m).includes(`"${key}"`)); }
	clear() { this.messages = []; }
}

function setup(options: { busy?: Set<string>; noPokemon?: Set<string> } = {}) {
	let tick = 0;
	const scheduled: { at: number; fn: () => void }[] = [];
	const battles: { team1: string[]; team2: string[]; level: number }[] = [];
	const manager = new TeamManager({
		now: () => tick,
		schedule: (fn, ticks) => { scheduled.push({ at: tick + ticks, fn }); },
		isBusy: p => options.busy?.has(p.id) ?? false,
		hasPokemon: p => !(options.noPokemon?.has(p.id) ?? false),
		startBattle: (team1, team2, level) => { battles.push({ team1: team1.map(p => p.id).sort(), team2: team2.map(p => p.id).sort(), level }); return true; },
	});
	const a = new TeamPlayer("A", "Ash") as any, b = new TeamPlayer("B", "Brock", 3) as any;
	const c = new TeamPlayer("C", "Cynthia", 6) as any, d = new TeamPlayer("D", "Dawn", 9) as any;
	const advanceTo = (ticks: number) => {
		tick += ticks;
		for (const s of scheduled.filter(s => s.at <= tick)) { scheduled.splice(scheduled.indexOf(s), 1); s.fn(); }
	};
	return { manager, a, b, c, d, battles, advance: advanceTo, options };
}

/** Forma as duplas A+B e C+D. */
function formTeams(s: ReturnType<typeof setup>) {
	const r1 = s.manager.requestTeam(s.a, s.b) as any;
	s.manager.acceptTeamRequest(s.b, r1.id);
	const r2 = s.manager.requestTeam(s.c, s.d) as any;
	s.manager.acceptTeamRequest(s.d, r2.id);
}

// ---------------------------------------------------------------------------------------------
// 1. Regras de nível e formato do /pokebattle

{
	assert.deepEqual([...LEVEL_RULES], [0, 50, 100, 5], "ordem do BattleConfigureGUI (Anything Goes, 50, 100, 5)");
	assert.equal(parseLevelRule(undefined), 0);
	assert.equal(parseLevelRule(-1), 0, "-1 do Cobblemon = livre");
	assert.equal(parseLevelRule(0), 0);
	assert.equal(parseLevelRule(5), 5);
	assert.equal(parseLevelRule(50), 50);
	assert.equal(parseLevelRule("100"), 100);
	assert.equal(parseLevelRule(42), undefined, "só 5/50/100");
	assert.equal(parseLevelRule(2.5), undefined);
	assert.deepEqual(levelRuleText(50), { translate: "cobblemon.challenge.rule.level", with: { rawtext: [{ text: "50" }] } });
	assert.deepEqual(levelRuleText(0), { translate: "cobblemon.challenge.rule.anything_goes" });
	assert.equal(parseChallengeFormat("multi"), "multi");
	assert.equal(parseChallengeFormat(undefined), "singles");
	assert.equal(parseChallengeFormat("royal"), undefined);
}

// ---------------------------------------------------------------------------------------------
// 2. Pedido de equipe: envio, duplicado, aceite, pedidos concorrentes cancelados, expiração

{
	const s = setup();
	const { manager, a, b, c } = s;
	const request = manager.requestTeam(a, b) as any;
	assert.ok(request && request.id, "pedido criado");
	assert.ok(a.has("cobblemon.team.sent") && b.has("cobblemon.team.received"));
	assert.equal(manager.requestTeam(a, b), undefined, "duplicado");
	assert.ok(a.has("cobblemon.port.multi.team_duplicate"));
	// C também convida B; quando B aceita A, o convite de C cai.
	const fromC = manager.requestTeam(c, b) as any;
	assert.ok(fromC && manager.getInboundTeamRequests("B").length === 2);
	const team = manager.acceptTeamRequest(b, request.id)!;
	assert.ok(team instanceof MultiBattleTeam);
	assert.deepEqual(team.players.map(p => p.id).sort(), ["A", "B"]);
	assert.ok(a.has("cobblemon.team.accept.sender") && b.has("cobblemon.team.accept.receiver"));
	assert.equal(manager.getInboundTeamRequests("B").length, 0, "outros convites a B cancelados");
	assert.ok(c.has("cobblemon.team.canceled.self"));
	assert.ok(manager.sameTeam("A", "B") && !manager.sameTeam("A", "C"));
	// B já tem equipe: convite dele para C/de C para B é recusado.
	assert.equal(manager.requestTeam(c, b), undefined);
	assert.ok(c.has("cobblemon.team.error.existing_team.other"));
	// Equipe cheia (2): A não convida C.
	assert.equal(manager.requestTeam(a, c), undefined);
	assert.ok(a.has("cobblemon.team.error.max_team_size.other"));
}
{
	// Expiração em 60 s (TeamRequest.expiryTime) pelo agendamento.
	const s = setup();
	const request = s.manager.requestTeam(s.a, s.b) as any;
	s.advance(TEAM_REQUEST_TICKS - 1);
	assert.ok(s.manager.getTeamRequest("A", "B"), "ainda válido");
	s.advance(1);
	assert.equal(s.manager.getTeamRequest("A", "B"), undefined, "expirou");
	assert.ok(s.a.has("cobblemon.team.expired.sender") && s.b.has("cobblemon.team.expired.receiver"));
	assert.equal(s.manager.acceptTeamRequest(s.b, request.id), undefined);
	assert.ok(s.b.has("cobblemon.ui.interact.request_already_expired"));
}
{
	// Pedido cruzado: B "pede" para A que já tinha pedido → aceita. Recusa e novo alvo cancela o anterior.
	const s = setup();
	s.manager.requestTeam(s.a, s.b);
	const team = s.manager.requestTeam(s.b, s.a);
	assert.ok(team instanceof MultiBattleTeam, "pedido cruzado forma a equipe");
	const s2 = setup();
	const r = s2.manager.requestTeam(s2.a, s2.b) as any;
	s2.manager.declineTeamRequest(s2.b, r.id);
	assert.ok(s2.a.has("cobblemon.team.decline.sender") && s2.b.has("cobblemon.team.decline.receiver"));
	s2.manager.requestTeam(s2.a, s2.b);
	s2.manager.requestTeam(s2.a, s2.c);
	assert.equal(s2.manager.getTeamRequest("A", "B"), undefined, "só um pedido por remetente");
	assert.ok(s2.b.has("cobblemon.team.canceled.other"));
}
{
	// Validações: longe, ocupado, sem Pokémon.
	const far = setup();
	far.b.location.x = 40;
	assert.equal(far.manager.requestTeam(far.a, far.b), undefined);
	assert.ok(far.a.has("cobblemon.ui.interact.failed"));
	const busy = setup({ busy: new Set(["B"]) });
	assert.equal(busy.manager.requestTeam(busy.a, busy.b), undefined);
	assert.ok(busy.a.has("cobblemon.ui.interact.unavailable"));
	const empty = setup({ noPokemon: new Set(["A"]) });
	const r = empty.manager.requestTeam(empty.a, empty.b) as any;
	assert.equal(empty.manager.acceptTeamRequest(empty.b, r.id), undefined);
	assert.ok(empty.a.has("cobblemon.challenge.error.insufficient_pokemon.self"));
	assert.equal(empty.manager.getTeam("A"), undefined);
}

// ---------------------------------------------------------------------------------------------
// 3. Sair da equipe e dissolução (abandonmultiteam, saída do servidor)

{
	const s = setup();
	formTeams(s);
	assert.equal(s.manager.getTeams().length, 2);
	assert.equal(s.manager.removeTeamMember("Z"), false, "sem equipe");
	// Desafio pendente de A+B para C+D cai quando a equipe desafiante se desfaz.
	assert.ok(s.manager.challengeTeam(s.a, s.c));
	assert.ok(s.manager.removeTeamMember("A"));
	assert.ok(s.a.has("cobblemon.team.left.self") && s.b.has("cobblemon.team.left.other") && s.b.has("cobblemon.team.disband"));
	assert.equal(s.manager.getTeam("A"), undefined);
	assert.equal(s.manager.getTeam("B"), undefined, "um membro só: equipe desfeita");
	assert.equal(s.manager.getTeams().length, 1);
	assert.ok(s.c.has("cobblemon.challenge.multi.canceled.receiver"), "desafio da equipe desfeita cancelado");
	assert.equal(s.manager.getChallenge("A", "C"), undefined);
	// Saída do servidor: tira da equipe e cancela pedidos.
	s.manager.requestTeam(s.a, s.b);
	s.manager.onPlayerLeave("D");
	assert.equal(s.manager.getTeam("C"), undefined, "C sozinho → dissolvida");
	s.manager.onPlayerLeave("A");
	assert.equal(s.manager.getTeamRequest("A", "B"), undefined, "pedido de quem saiu cancelado");
}

// ---------------------------------------------------------------------------------------------
// 4. Desafio Multi: envio, aceite por qualquer membro, nível, validações, expiração

{
	const s = setup();
	formTeams(s);
	for (const p of [s.a, s.b, s.c, s.d]) p.clear();
	// Sem equipe do outro lado / mesma equipe: erro.
	assert.equal(s.manager.challengeTeam(s.a, s.b), undefined);
	assert.ok(s.a.has("cobblemon.challenge.multi.error.missing_team"));
	const challenge = s.manager.challengeTeam(s.a, s.c, 50) as any;
	assert.ok(challenge && challenge.level === 50);
	assert.ok(s.a.has("cobblemon.challenge.multi.sent") && s.b.has("cobblemon.challenge.multi.sent"), "toda a equipe desafiante é avisada");
	assert.ok(s.c.has("cobblemon.challenge.multi.received") && s.d.has("cobblemon.challenge.multi.received"));
	assert.ok(s.d.has("cobblemon.challenge.rule.level"), "regra de nível no chat");
	assert.equal(s.manager.challengeTeam(s.b, s.d), undefined, "duplicado (mesma equipe → mesma equipe)");
	assert.ok(s.b.has("cobblemon.challenge.error.duplicate"));
	// D (não o alvo C) aceita: qualquer membro da equipe desafiada pode.
	assert.equal(s.manager.acceptChallenge(s.d, challenge.id), true);
	assert.deepEqual(s.battles, [{ team1: ["C", "D"], team2: ["A", "B"], level: 50 }], "pvp2v2: equipe desafiada contra a desafiante");
	assert.ok(s.a.has("cobblemon.challenge.multi.accept.sender") && s.d.has("cobblemon.challenge.multi.accept.receiver"));
	// Aceitar pelo "desafio de volta" (botão Batalha Multi do menu).
	const again = s.manager.challengeTeam(s.c, s.a) as any;
	assert.ok(again && again.level === 0);
	assert.equal(s.manager.challengeTeam(s.b, s.d), true, "a equipe desafiada aceita desafiando de volta");
	assert.deepEqual(s.battles[1], { team1: ["A", "B"], team2: ["C", "D"], level: 0 });
}
{
	// Validações no aceite: proximidade (raio 15 do centro), dimensão, Pokémon, ocupado; expiração em 20 s.
	const s = setup();
	formTeams(s);
	const far = s.manager.challengeTeam(s.a, s.c) as any;
	s.d.location.z = MAX_BATTLE_RADIUS * 3;
	assert.equal(s.manager.acceptChallenge(s.c, far.id), false);
	assert.ok(s.a.has("cobblemon.challenge.multi.error.player_distance"));
	s.d.location.z = 0;
	const dim = s.manager.challengeTeam(s.a, s.c) as any;
	s.d.dimension = { id: "minecraft:nether" };
	assert.equal(s.manager.acceptChallenge(s.c, dim.id), false);
	assert.ok(s.c.has("cobblemon.challenge.multi.error.player_different_dimension"));
	s.d.dimension = { id: "minecraft:overworld" };
	s.options.noPokemon = new Set(["B"]);
	const noMon = s.manager.challengeTeam(s.a, s.c) as any;
	assert.equal(s.manager.acceptChallenge(s.c, noMon.id), false);
	assert.ok(s.d.has("cobblemon.challenge.multi.error.insufficient_pokemon"));
	s.options.noPokemon = undefined;
	s.options.busy = new Set(["D"]);
	assert.equal(s.manager.challengeTeam(s.a, s.c), undefined, "equipe desafiada ocupada");
	s.options.busy = undefined;
	const late = s.manager.challengeTeam(s.a, s.c) as any;
	s.advance(MULTI_CHALLENGE_TICKS);
	assert.ok(s.a.has("cobblemon.challenge.multi.expired.sender") && s.c.has("cobblemon.challenge.multi.expired.receiver"));
	assert.equal(s.manager.acceptChallenge(s.c, late.id), false);
	assert.equal(s.battles.length, 0);
}

// ---------------------------------------------------------------------------------------------
// 5. Jogo de verdade (harness de batalha): menu de interação → equipes → Multi 2×2 nível 50 até o fim

function pokemon(species: string, level: number, moves = ["tackle"]) {
	const data = PokemonData.generateNewWildPokemon(species, { level, shiny: false });
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

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
		const move = request.active![slot].moves.find(x => !x.disabled) ?? request.active![slot].moves[0];
		const targets = getTargetOptions(actor, slot, move.target);
		responses.push(new MoveActionResponse(move.id, targets?.find(x => !x.ally)?.loc ?? targets?.[0]?.loc));
	}
	return responses;
}

async function runToEnd(battle: PokemonBattle) {
	const ended = await advanceUntil(() => battle.ended, 400_000);
	if (!ended) originalError(battle.showdownMessages.slice(-4).join("\n---\n"), errors.slice(-5).join("\n"));
	assert.ok(ended, "a batalha terminou");
	await advance(40);
}

/** Respostas das telas em fila (índice do botão; undefined = fechou). */
const answers: (number | undefined)[] = [];
formHooks.show = () => {
	const selection = answers.shift();
	return selection === undefined ? { canceled: true } : { canceled: false, selection };
};
async function menu(player: FakePlayer, target: FakePlayer, ...selections: (number | undefined)[]) {
	answers.push(...selections);
	await openPlayerInteractionMenu(player as never, target as never);
	await advance(5);
	assert.equal(answers.length, 0, "todas as telas esperadas abriram");
}

{
	const red = createPlayer("Red", [pokemon("bulbasaur", 10), pokemon("pidgey", 12)], { x: 0, y: 64, z: 0 });
	const blue = createPlayer("Blue", [pokemon("squirtle", 11)], { x: 3, y: 64, z: 0 });
	const green = createPlayer("Green", [pokemon("charmander", 9)], { x: 6, y: 64, z: 0 });
	const yellow = createPlayer("Yellow", [pokemon("pikachu", 8), pokemon("rattata", 6)], { x: 9, y: 64, z: 0 });
	const levelsBefore = [red, blue, green, yellow].map(p => getSafeTeam(p as never).filter(x => x).map(x => x!.level));

	// Menu sem equipes: [simples, dupla, tripla, Formar grupo, Troca]. Red convida Blue; Blue aceita pelo mesmo botão.
	await menu(red, blue, 3);
	assert.ok(blue.hasMessage("cobblemon.team.received"));
	// Com convite pendente aparece "Recusar (Formar grupo)" no índice 4; Blue aceita pelo botão 3.
	await menu(blue, red, 3);
	assert.ok(teamManager.sameTeam(red.id, blue.id), "Red e Blue em equipe");
	await menu(green, yellow, 3);
	await menu(yellow, green, 3);
	assert.ok(teamManager.sameTeam(green.id, yellow.id));

	// Mesma equipe: [.., .., .., Abandonar grupo, Troca] → não sai sem clicar; outra equipe: [.., .., .., Batalha Multi, Troca].
	// Red desafia a equipe de Green com "Nível 50 para todos" (2ª tela: [Livre, 50, 100, 5] → 1).
	await menu(red, green, 3, 1);
	assert.ok(yellow.hasMessage("cobblemon.challenge.multi.received") && yellow.hasMessage("cobblemon.challenge.rule.level"));
	// Yellow aceita pelo botão Batalha Multi (sem a tela de nível: vale a regra de quem desafiou).
	await menu(yellow, blue, 3);
	const battle = tryGetBattleFromEntity(red as never)!;
	assert.ok(battle, "a batalha Multi começou");
	assert.equal(battle.format.battleType.name, "multi");
	assert.equal(battle.actors.length, 4);
	assert.equal(tryGetBattleFromEntity(yellow as never), battle);
	// Nível ajustado: todos os Pokémon na batalha estão no nível 50, curados e são cópias.
	for (const actor of battle.actors) {
		assert.ok(actor.pokemon.every(p => p.level === 50 && p.battleClone && p.currentHealth === p.maxHealth), `${actor.getName()} no nível 50`);
		actor.decider = autoDecider;
	}
	await runToEnd(battle);
	assert.ok(["win", "tie"].includes(battle.endReason!), `fim: ${battle.endReason}`);
	assert.match(battle.showdownMessages.join("\n"), /\|gametype\|multi/);
	const levelsAfter = [red, blue, green, yellow].map(p => getSafeTeam(p as never).filter(x => x).map(x => x!.level));
	assert.deepEqual(levelsAfter, levelsBefore, "os times reais não mudam de nível");
	assert.ok(teamManager.sameTeam(red.id, blue.id), "a equipe continua depois da batalha");

	// Abandonar grupo pelo menu (Red → Blue, mesma equipe) e pelo comando (Yellow).
	await menu(red, blue, 3);
	assert.ok(red.hasMessage("cobblemon.team.left.self") && blue.hasMessage("cobblemon.team.disband"));
	assert.equal(teamManager.getTeam(blue.id), undefined);
	assert.equal(abandonMultiTeam(yellow as never), true);
	assert.equal(abandonMultiTeam(yellow as never), false, "já sem equipe (o comando avisa not_in_team)");
	assert.equal(teamManager.getTeams().length, 0);

	// 1×1 de nível fixo pelo menu: Red desafia Blue em simples com "Nível 5 para todos"; Blue aceita interagindo.
	await menu(red, blue, 0, 3);
	assert.ok(blue.hasMessage("cobblemon.challenge.received"));
	handleChallenge(blue as never, red as never);
	const single = tryGetBattleFromEntity(red as never)!;
	assert.ok(single && single.format.battleType.name === "singles");
	assert.ok(single.actors.every(a => a.pokemon.every(p => p.level === 5 && p.battleClone)), "todos no nível 5");
	single.actors.forEach(a => a.decider = autoDecider);
	await runToEnd(single);
	// Sem regra: o time real (níveis originais) entra.
	challengePlayer(green as never, yellow as never, "singles");
	handleChallenge(yellow as never, green as never);
	const free = tryGetBattleFromEntity(green as never)!;
	assert.ok(free.actors.every(a => a.pokemon.every(p => !p.battleClone)), "Luta Livre usa o time real");
	assert.equal(free.actors[0].pokemon[0].level, 9);
	free.actors.forEach(a => a.decider = autoDecider);
	await runToEnd(free);
	assert.equal(overworld.entities.filter(e => e.isValid && e.typeId !== "minecraft:player" && e.typeId.startsWith("cobblemon:") && !e.tags.has("player")).filter(e => e.getProperty("cobblemon:in_battle")).length, 0);
}

assert.equal(errors.filter(e => !/showdown|sim/i.test(e)).length, 0, `erros: ${errors.slice(0, 3).join(" | ")}`);
console.error = originalError;
process.stdout.write("multi: ok\n");
