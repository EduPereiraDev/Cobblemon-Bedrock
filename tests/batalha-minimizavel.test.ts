// Frente "batalha-minimizavel": tela da batalha minimizável (scripts/battle/BattleUiMode.ts), padrão `java`.
// - lógica pura (decidePrompt por origem, preferência/comando, golpes do HUD);
// - protocolo do HUD: cabeçalho min/pr/cur, golpes, cauda do título, JSON UI gerado (caixas esmaecidas, aviso pulsando);
// - batalhas completas no harness: padrão java (abre no início, ESC minimiza, não reabre sozinha, tecla R alterna,
//   troca obrigatória minimizada não abre, aberta abre), interagir sempre abre, PvP esperando o oponente, duplo toque em
//   Pular no celular, preferência `classic` (antigo) e `hud` (golpes pela hotbar), overlay do time escondido na batalha.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { advance, advanceUntil, createPlayer, FakePlayer, spawnWild } from "./batalhas-harness";
import { PokemonData } from "../scripts/Pokemon";
import { BattleActor, PokemonBattle, startPvPBattle, startWildBattle } from "../scripts/battle";
import { ActionResponse, ForfeitActionResponse, MoveActionResponse, SwitchActionResponse } from "../scripts/battle/ActionResponse";
import { RequestData, requestPokemonUUID } from "../scripts/battle/Request";
import {
	applyModeCommand, battleUiView, decidePrompt, DEFAULT_BATTLE_UI_MODE, getBattleUiMode, getUiState, handleJumpTap, hudChoiceAt,
	hudEligible, hudMoves, MODE_PROPERTY, PromptInput, toggleMinimised,
} from "../scripts/battle/BattleUiMode";
import {
	BATTLE_BODY_BYTES, BATTLE_HEAD_FIELDS, BATTLE_MOVE_FIELDS, BATTLE_MOVES, BATTLE_PROMPT, BATTLE_TAIL_OFFSET, BATTLE_TILE_FIELDS, CHANNEL,
	HEADER_BYTES, encodeBattleBody, fieldOffsets, header, recordBytes, utf8Length,
} from "../scripts/ui/hudProtocol";
import { HudState, getHudChannel } from "../scripts/ui/HudBus";
import { battleUiViewOf } from "../scripts/ui/BattleUiView";
import { startPartyHud } from "../scripts/GUI/PartyHud";
import { setMoveLearningPrompt } from "../scripts/battle/Rewards";
import { Dex } from "../scripts/showdown";

const originalError = console.error;
const errors: string[] = [];
console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
console.warn = () => { };
console.info = () => { };
console.log = () => { };
setMoveLearningPrompt(async () => false);

// ------------------------------------------------------------------------------------------------
// 1. Lógica pura
// ------------------------------------------------------------------------------------------------
{
	assert.equal(DEFAULT_BATTLE_UI_MODE, "java", "o padrão é o comportamento do Cobblemon");
	const base: PromptInput = { mode: "java", source: "turn", minimised: false, requestId: 3, hudEligible: true };
	assert.equal(decidePrompt({ ...base, mode: "classic", minimised: true }), "open", "classic sempre abre");
	assert.equal(decidePrompt({ ...base, mode: "classic", source: "toggle", minimised: true }), "open");
	// Turno: aberta → abre; minimizada → só o aviso (inclusive troca obrigatória).
	assert.equal(decidePrompt(base), "open");
	assert.equal(decidePrompt({ ...base, minimised: true }), "prompt");
	assert.equal(decidePrompt({ ...base, minimised: true, hudEligible: false }), "prompt");
	// Tecla R: minimizada → abre; aberta esperando (tela do request ainda não mostrada) → minimiza.
	assert.equal(decidePrompt({ ...base, source: "toggle", minimised: true }), "open");
	assert.equal(decidePrompt({ ...base, source: "toggle", shownRequestId: 2 }), "minimise");
	assert.equal(decidePrompt({ ...base, source: "toggle", shownRequestId: 3 }), "open");
	// Interagir com o oponente / nova tentativa: sempre abre (nunca minimiza por engano durante as animações).
	assert.equal(decidePrompt({ ...base, source: "reopen", shownRequestId: 2 }), "open", "interagir nas animações não minimiza");
	assert.equal(decidePrompt({ ...base, source: "reopen", minimised: true }), "open");
	// HUD.
	const hud: PromptInput = { ...base, mode: "hud" };
	assert.equal(decidePrompt({ ...hud, minimised: true }), "hud");
	assert.equal(decidePrompt({ ...hud, minimised: true, hudEligible: false }), "prompt", "duplas caem no aviso");
	assert.equal(decidePrompt({ ...hud, source: "toggle", minimised: true, hudRequestId: 3 }), "confirm");
	assert.equal(decidePrompt({ ...hud, source: "toggle", minimised: true, hudRequestId: 2 }), "open", "HUD de request velho não confirma");
	assert.equal(decidePrompt({ ...hud, source: "reopen", minimised: true, hudRequestId: 3 }), "open", "interagir abre a tela no modo hud");
	assert.equal(decidePrompt(hud), "open", "primeiro turno abre a tela, como no Java");

	const request = {
		active: [{ moves: [
			{ move: "Thunderbolt", id: "thunderbolt", pp: 15, maxpp: 24, target: "normal", disabled: false },
			{ move: "Growl", id: "growl", pp: 0, maxpp: 40, target: "allAdjacentFoes", disabled: false },
		] }],
		side: { name: "p1", id: "p1", pokemon: [] }, noCancel: false,
	} as unknown as RequestData;
	assert.ok(hudEligible(request, 1));
	assert.ok(!hudEligible(request, 2), "duplas não cabem no HUD");
	assert.ok(!hudEligible({ ...request, forceSwitch: [true] } as RequestData, 1), "troca obrigatória não cabe no HUD");
	assert.equal(hudChoiceAt(request, 2).kind, "none");
	assert.equal(hudChoiceAt(request, 4).kind, "menu");
	assert.deepEqual(hudMoves(request), [
		{ id: "thunderbolt", type: "electric", pp: "15/24", usable: true },
		{ id: "growl", type: "normal", pp: "0/40", usable: false },
	]);

	// Preferência por jogador: sem nada = java; explícita vale; `default` apaga; inválido avisa.
	const holder = new Map<string, unknown>();
	const fake = { getDynamicProperty: (k: string) => holder.get(k), setDynamicProperty: (k: string, v: unknown) => { v === undefined ? holder.delete(k) : holder.set(k, v); } };
	assert.equal(getBattleUiMode(fake as never), "java", "padrão java sem preferência");
	assert.equal((applyModeCommand("hud", fake as never) as { translate: string }).translate, "cobblemon.port.battle_ui.mode_set");
	assert.equal(getBattleUiMode(fake as never), "hud");
	applyModeCommand("classic", fake as never);
	assert.equal(holder.get(MODE_PROPERTY), "classic");
	applyModeCommand("java", fake as never);
	assert.equal(holder.get(MODE_PROPERTY), "java", "escolha explícita fica gravada");
	applyModeCommand("default", fake as never);
	assert.equal(holder.has(MODE_PROPERTY), false, "default apaga a preferência");
	assert.equal((applyModeCommand("xyz", fake as never) as { translate: string }).translate, "cobblemon.port.battle_ui.mode_invalid");
	const status = applyModeCommand("status", fake as never) as { translate: string; with: { rawtext: { translate: string }[] } };
	assert.equal(status.with.rawtext[0].translate, "cobblemon.port.battle_ui.mode.java");
}

// ------------------------------------------------------------------------------------------------
// 2. Protocolo do HUD e JSON UI gerado
// ------------------------------------------------------------------------------------------------
const hud = JSON.parse(readFileSync(join(process.cwd(), "resource_packs", "CobblemonBedrock", "ui", "cobblemon_hud.json"), "utf8").replace(/^\/\/.*$/m, ""));
/** Primeiros N bytes UTF-8 (o '%.Ns' do JSON UI). */
const prefixBytes = (s: string, n: number) => Buffer.from(s, "utf8").subarray(0, n).toString("utf8");
/** Avalia os bindings de fatia (mesmos padrões de tests/ui-base.test.ts). */
function evalBindings(bindings: any[], preserved: string, props: Record<string, string> = {}): Record<string, string> {
	props["#preserved"] = preserved;
	for (const b of bindings) {
		if (b.binding_type !== "view") continue;
		const src: string = b.source_property_name;
		let value: string | undefined;
		let m: RegExpMatchArray | null;
		if (src === "#preserved") value = preserved;
		else if ((m = src.match(/^\(#p - \('%\.(\d+)s' \* #p\)\)$/))) value = props["#p"].split(prefixBytes(props["#p"], Number(m[1]))).join("");
		else if ((m = src.match(/^\(\('%\.(\d+)s' \* (#r_\w+)\) - '\t'\)$/))) value = prefixBytes(props[m[2]], Number(m[1])).split("\t").join("");
		if (value !== undefined) props[b.target_property_name] = value;
	}
	return props;
}
{
	assert.deepEqual(
		(({ min, pr, cur }) => ({ min, pr, cur }))(fieldOffsets(BATTLE_HEAD_FIELDS, HEADER_BYTES)),
		{ min: 55, pr: 57, cur: 59 },
		"offsets do cabeçalho usados pelo cenário E2E 10",
	);
	const tile = { texture: "textures/sprites/pikachu", name: "Pikachu", level: 30, hpRatio: 1, hpText: "60/60" };
	const moves = [{ id: "thunderbolt", type: "electric", pp: "15/24", usable: true }, { id: "growl", type: "normal", pp: "0/40", usable: false }];
	const body = encodeBattleBody({ slotsPerActor: 1, left: [tile], right: [tile], ui: { minimised: true, prompt: BATTLE_PROMPT.MENU, cursor: 1, moves } });
	assert.equal(utf8Length(body), BATTLE_BODY_BYTES);
	assert.equal(BATTLE_BODY_BYTES, recordBytes(BATTLE_HEAD_FIELDS) + 6 * recordBytes(BATTLE_TILE_FIELDS) + BATTLE_MOVES * recordBytes(BATTLE_MOVE_FIELDS));
	// O cliente resolve a cauda rawtext; aqui simulamos o texto já traduzido.
	const tail = "Você precisa escolher uma ação. Pressione Shift + Espaço.";
	const title = header(CHANNEL.BATTLE, 7) + body + tail;
	const headPanel = hud.battle_overlay.controls[0].cbhud_battle_head;
	const head = evalBindings(headPanel.bindings, title);
	// Frente ui-cliente: campos numéricos com o prefixo NUM_LEAD ("_").
	assert.equal(head["#min"], "_1");
	assert.equal(head["#pr"], "_3");
	assert.equal(head["#cur"], "_1");
	const prompt = hud.battle_overlay.controls.find((c: any) => c.cbhud_battle_prompt).cbhud_battle_prompt;
	assert.equal(evalBindings(prompt.bindings, title)["#tail"], tail, "a cauda começa em BATTLE_TAIL_OFFSET");
	assert.ok(prompt.bindings.some((b: any) => b.source_property_name.includes(`'%.${BATTLE_TAIL_OFFSET}s'`)));
	const move0 = hud.battle_move_0.controls[0].cbhud_bm0;
	const m0 = evalBindings(move0.bindings, title);
	assert.equal(m0["#id"], "thunderbolt");
	assert.equal(m0["#type"], "electric");
	assert.equal(m0["#pp"], "15/24");
	assert.equal(m0["#use"], "_1");
	assert.equal(evalBindings(hud.battle_move_1.controls[0].cbhud_bm1.bindings, title)["#use"], "_0");
	assert.equal(evalBindings(hud.battle_move_2.controls[0].cbhud_bm2.bindings, title)["#id"], "");
	// Fora do menu os golpes vão vazios e o cursor em branco.
	const plain = encodeBattleBody({ slotsPerActor: 1, left: [tile], right: [tile], ui: { minimised: true, prompt: BATTLE_PROMPT.ACTIONS, moves } });
	const plainHead = evalBindings(headPanel.bindings, header(CHANNEL.BATTLE, 1) + plain);
	assert.equal(plainHead["#pr"], "_1");
	assert.equal(plainHead["#cur"], "");
	assert.equal(evalBindings(move0.bindings, header(CHANNEL.BATTLE, 1) + plain)["#id"], "");
	// Caixas: cópia opaca e cópia esmaecida (0,5, propagada aos filhos) escolhidas pelo `min`.
	const tilePanel = hud.battle_tile_l0.controls.find((c: any) => c.cbhud_btl0).cbhud_btl0;
	const [bright, dim] = tilePanel.controls.map((c: any) => Object.values(c)[0]);
	assert.equal(bright.alpha, 1);
	assert.equal(dim.alpha, 0.5);
	assert.equal(dim.propagate_alpha, true);
	assert.equal(dim.bindings[0].source_property_name, "(#min = '_1')");
	assert.equal(dim.bindings[0].source_control_name, "cbhud_battle_head");
	// Aviso: pulsa com uma animação alpha em laço de 4 s (2 s para cada lado).
	const actions = hud.battle_overlay.controls.find((c: any) => c.prompt_actions).prompt_actions;
	assert.equal(actions.alpha, "@cobblemon_hud.prompt_fade_out");
	assert.equal(hud.prompt_fade_out.next, "@cobblemon_hud.prompt_fade_in");
	assert.equal(hud.prompt_fade_in.next, "@cobblemon_hud.prompt_fade_out");
	assert.equal(hud.prompt_fade_out.duration + hud.prompt_fade_in.duration, 4);
	assert.ok(actions.bindings.some((b: any) => b.source_property_name === "(#pr = '_1')"));
	const hide = hud.battle_overlay.controls.find((c: any) => c.prompt_hide).prompt_hide;
	assert.equal(hide.alpha, 0.75, "hide_label com 0,75 como a BattleGUI");

	// HudBus: com cauda o título vira rawtext; mudar só a cauda reenvia.
	const state = new HudState();
	state.set(CHANNEL.BATTLE, "b", { translate: "cobblemon.battle.ui.actions_label" });
	const sent = state.next() as { rawtext: { text?: string; translate?: string }[] };
	assert.equal(sent.rawtext[0].text, `${header(CHANNEL.BATTLE, 1)}b`);
	assert.equal(sent.rawtext[1].translate, "cobblemon.battle.ui.actions_label");
	state.set(CHANNEL.BATTLE, "b", { translate: "cobblemon.battle.ui.actions_label" });
	assert.equal(state.next(), undefined, "mesmo corpo e cauda não reenvia");
	state.set(CHANNEL.BATTLE, "b", { translate: "cobblemon.battle.ui.hide_label" });
	assert.ok(state.next(), "cauda nova reenvia");
	state.set(CHANNEL.BATTLE, "b");
	assert.equal(state.next(), `${header(CHANNEL.BATTLE, 3)}b`, "sem cauda volta a ser texto");
}

// ------------------------------------------------------------------------------------------------
// Batalhas completas
// ------------------------------------------------------------------------------------------------

function pokemon(species: string, level: number, moves: string[]) {
	const data = PokemonData.generateNewWildPokemon(species, { level, shiny: false });
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

type TestPlayer = FakePlayer & { inputInfo: { lastInputModeUsed: string } };

interface Harness {
	player: TestPlayer;
	battle: PokemonBattle;
	actor: BattleActor;
	/** Quantas vezes a tela (decider) foi aberta. */
	opened: () => number;
	/** Requests mostrados na tela, na ordem. */
	shown: RequestData[];
}

function makePlayer(name: string, team: PokemonData[], location?: { x: number; y: number; z: number }): TestPlayer {
	const player = createPlayer(name, team, location) as TestPlayer;
	player.inputInfo = { lastInputModeUsed: "KeyboardAndMouse" };
	return player;
}

/** Batalha selvagem com a tela trocada por `screen` (undefined = jogador fechou a tela). */
function setup(name: string, mode: string | undefined, screen: (call: number, actor: BattleActor, request: RequestData) => ActionResponse[] | undefined, team = [pokemon("mewtwo", 100, ["tackle", "growl"])], wildData = pokemon("chansey", 30, ["splash"])): Harness {
	const player = makePlayer(name, team);
	if (mode) player.setDynamicProperty(MODE_PROPERTY, mode);
	const wild = spawnWild(wildData);
	const battle = startWildBattle(player as never, wild as never)!;
	assert.ok(battle, "batalha deve começar");
	const actor = battle.getActorFromID(player.id)!;
	let calls = 0;
	const shown: RequestData[] = [];
	actor.decider = (a, request) => { shown.push(request); return screen(++calls, a, request); };
	return { player, battle, actor, opened: () => calls, shown };
}

const tackle = () => [new MoveActionResponse("tackle")];
const growl = () => [new MoveActionResponse("growl")];
/** Espera o request pendente com as animações ainda na fila (antes de a tela abrir). */
const waitAnimating = (h: Harness) => advanceUntil(() => h.actor.mustChoose && h.battle.dispatcher.dispatches.length > 0 && getUiState(h.player.id)?.shownRequestId !== h.actor.requestId && !h.actor.prompting, 20_000);

// 3. Padrão (java, sem preferência): abre no início; ESC minimiza; não reabre; interagir/tecla R reabrem; HUD integrado.
{
	const h = setup("Java", undefined, call => call === 1 ? undefined : growl());
	assert.equal(getBattleUiMode(h.player as never), "java");
	// Antes da primeira tela (animações de entrada): "GUI aberta" esperando → hide_label no HUD.
	const intro = battleUiView(h.player as never);
	assert.equal(intro?.minimised, false);
	assert.ok(await advanceUntil(() => h.opened() === 1, 20_000), "a tela abre sozinha no começo");
	await advance(20);
	const state = getUiState(h.player.id)!;
	assert.ok(state.minimised, "fechar a tela minimiza");
	assert.ok(!h.player.hasMessage("cobblemon.port.battle.reopen_hint") && !h.player.hasMessage("cobblemon.port.battle_ui.reopen_hint"), "sem dica no chat");
	const view = battleUiViewOf(h.player as never)!;
	assert.equal(view.minimised, true, "HUD esmaecido");
	assert.equal(view.prompt, BATTLE_PROMPT.ACTIONS, "aviso do Cobblemon no HUD");
	assert.deepEqual(view.text, { translate: "cobblemon.battle.ui.actions_label", with: { rawtext: [{ translate: "cobblemon.port.battle_ui.key.keyboard" }] } });
	await advance(200);
	assert.equal(h.opened(), 1, "minimizado: a tela não reabre sozinha (sem timer)");
	// Tecla R (agachar + pular → promptPlayerForRequest("toggle")): reabre e escolhe Growl.
	h.actor.promptPlayerForRequest("toggle");
	await advance(5);
	assert.equal(h.opened(), 2, "tecla R reabre");
	assert.equal(getUiState(h.player.id)!.minimised, false, "reaberto");
	// Próximo turno: "GUI aberta" → abre sozinha.
	assert.ok(await advanceUntil(() => h.opened() === 3, 20_000), "aberto: o turno seguinte abre sozinho");
	// Interagir com o oponente durante as animações NÃO minimiza (caminho antigo do port: sempre abre).
	assert.ok(await waitAnimating(h), "request pendente com animações");
	assert.equal(battleUiView(h.player as never)?.prompt, BATTLE_PROMPT.HIDE, "esperando com a batalha aberta: hide_label");
	h.actor.promptPlayerForRequest("reopen");
	assert.equal(getUiState(h.player.id)!.minimised, false, "interagir não minimiza");
	await advance(5);
	assert.equal(h.opened(), 4, "interagir abre na hora");
	// Tecla R durante as animações do turno minimiza; o turno seguinte não abre.
	assert.ok(await waitAnimating(h));
	const opened = h.opened();
	h.actor.promptPlayerForRequest("toggle");
	assert.equal(getUiState(h.player.id)!.minimised, true, "R esperando o turno minimiza");
	await advance(200);
	assert.equal(h.opened(), opened, "minimizado pela tecla R: não abre sozinho");
	// Com escolha pendente o toggleMinimised (sem escolha pendente) não se aplica.
	assert.equal(toggleMinimised(h.player as never), undefined);
	h.actor.decider = () => tackle();
	h.actor.promptPlayerForRequest("reopen");
	assert.ok(await advanceUntil(() => h.battle.ended, 200_000), "java termina");
	assert.equal(h.battle.endReason, "win");
	await advance(40);
	assert.equal(getUiState(h.player.id), undefined, "estado limpo no fim");
	assert.equal(battleUiView(h.player as never), undefined, "fora de batalha: nada no HUD");
}

// 4. Troca obrigatória depois de desmaio (Java: BattleMakeChoiceHandler só liga mustChoose; a GUI aberta monta a troca).
{
	const team = () => [pokemon("magikarp", 5, ["splash"]), pokemon("magikarp", 5, ["splash"]), pokemon("mewtwo", 100, ["tackle"])];
	const switchTo = (request: RequestData, index: number) => [new SwitchActionResponse(requestPokemonUUID(request.side.pokemon[index]))];
	/** Troca obrigatória pela 1ª reserva viva; senão Tackle. */
	const auto = (_a: BattleActor, request: RequestData) => {
		if (!request.forceSwitch) return tackle();
		const next = request.side.pokemon.find(x => !x.active && !x.condition.endsWith("fnt"));
		return [new SwitchActionResponse(requestPokemonUUID(next!))];
	};
	const foe = () => pokemon("pikachu", 40, ["thunderbolt"]);
	// 4a. Batalha aberta: a troca obrigatória abre sozinha.
	{
		const h = setup("ForceOpen", undefined, (call, _a, request) => request.forceSwitch ? switchTo(request, 2) : [new MoveActionResponse("splash")], team(), foe());
		assert.ok(await advanceUntil(() => h.shown.some(r => r.forceSwitch?.[0]), 60_000), "aberta: a troca obrigatória abre sozinha");
		h.actor.decider = auto;
		h.actor.promptPlayerForRequest("reopen");
		assert.ok(await advanceUntil(() => h.battle.ended, 200_000));
	}
	// 4b. Minimizada durante as animações do desmaio: a troca obrigatória NÃO abre; o aviso aparece; a tecla R abre.
	{
		const h = setup("ForceMin", undefined, (call, _a, request) => request.forceSwitch ? switchTo(request, 2) : [new MoveActionResponse("splash")], team(), foe());
		assert.ok(await advanceUntil(() => h.opened() === 1, 20_000));
		// A escolha do 1º turno já foi; o request da troca chega na hora e espera as animações do golpe.
		assert.ok(await advanceUntil(() => !!h.actor.request?.forceSwitch?.[0] && h.actor.mustChoose, 60_000), "request de troca obrigatória");
		assert.ok(!h.actor.prompting && getUiState(h.player.id)?.shownRequestId !== h.actor.requestId, "ainda nas animações");
		h.actor.promptPlayerForRequest("toggle");
		assert.equal(getUiState(h.player.id)!.minimised, true, "R nas animações minimiza");
		const before = h.opened();
		await advance(300);
		assert.equal(h.opened(), before, "minimizada: a troca obrigatória não abre a tela (como no Java)");
		assert.equal(battleUiView(h.player as never)?.prompt, BATTLE_PROMPT.ACTIONS, "aviso no HUD durante a troca pendente");
		h.actor.promptPlayerForRequest("toggle");
		await advance(5);
		assert.equal(h.opened(), before + 1, "tecla R abre a troca");
		assert.ok(h.shown.at(-1)?.forceSwitch?.[0], "a tela aberta é a da troca obrigatória");
		assert.ok(await advanceUntil(() => h.battle.ended || !h.actor.request?.forceSwitch, 20_000), "troca feita");
		h.actor.decider = auto;
		h.actor.promptPlayerForRequest("reopen");
		assert.ok(await advanceUntil(() => h.battle.ended, 200_000), "termina depois da troca");
	}
}

// 5. PvP: esperando o oponente (sem escolha pendente) a tecla R alterna; minimizado, o turno seguinte não abre.
{
	const splash = () => [new MoveActionResponse("splash")];
	const a = makePlayer("Red", [pokemon("mewtwo", 100, ["splash"])], { x: 0, y: 64, z: 0 });
	const b = makePlayer("Blue", [pokemon("chansey", 50, ["splash"])], { x: 5, y: 64, z: 0 });
	const battle = startPvPBattle(a as never, b as never)!;
	assert.ok(battle, "PvP começa");
	const actorA = battle.getActorFromID(a.id)!;
	const actorB = battle.getActorFromID(b.id)!;
	let opensA = 0;
	actorA.decider = () => { opensA++; return splash(); };
	let releaseB: (r: ActionResponse[] | undefined) => void = () => { };
	actorB.decider = () => new Promise(resolve => { releaseB = resolve; });
	assert.ok(await advanceUntil(() => opensA === 1 && actorB.prompting, 20_000), "as duas telas abrem no começo");
	await advance(10);
	assert.equal(actorA.mustChoose, false, "Red escolheu e espera");
	assert.equal(battleUiView(a as never)?.prompt, BATTLE_PROMPT.HIDE, "esperando com a batalha aberta: hide_label");
	assert.equal(toggleMinimised(a as never), true, "tecla R esperando o oponente minimiza");
	assert.deepEqual(battleUiView(a as never), { minimised: true, prompt: BATTLE_PROMPT.NONE }, "minimizado sem nada a escolher: só as caixas esmaecidas");
	releaseB(splash());
	assert.ok(await advanceUntil(() => actorA.mustChoose && battle.dispatcher.dispatches.length === 0, 20_000), "turno 2 pendente para Red");
	await advance(40);
	assert.equal(opensA, 1, "minimizado: o turno seguinte não abre");
	assert.equal(battleUiView(a as never)?.prompt, BATTLE_PROMPT.ACTIONS);
	actorA.promptPlayerForRequest("toggle");
	await advance(5);
	assert.equal(opensA, 2, "tecla R reabriu a tela de Red");
	// Blue estava com a tela aberta (turno 2 abriu sozinho para ele) e desiste.
	assert.ok(actorB.prompting, "Blue não minimizou: a tela dele abriu no turno 2");
	releaseB([new ForfeitActionResponse()]);
	assert.ok(await advanceUntil(() => battle.ended, 200_000), "PvP termina");
}

// 6. Celular: duplo toque em Pular reabre só no toque, com escolha pendente e a batalha minimizada.
{
	const h = setup("Touch", undefined, call => call === 1 ? undefined : tackle());
	assert.ok(await advanceUntil(() => h.opened() === 1, 20_000));
	await advance(20);
	assert.ok(getUiState(h.player.id)!.minimised);
	// Teclado: pular duas vezes não faz nada (evita falso positivo andando).
	const t0 = 1_000_000;
	assert.equal(handleJumpTap(h.player as never, t0), false);
	assert.equal(handleJumpTap(h.player as never, t0 + 3), false, "teclado/controle: duplo pulo não reabre");
	h.player.inputInfo.lastInputModeUsed = "Touch";
	assert.equal(battleUiView(h.player as never)?.text && JSON.stringify(battleUiView(h.player as never)?.text).includes("cobblemon.port.battle_ui.key.touch"), true, "o aviso cita o gesto do toque");
	assert.equal(handleJumpTap(h.player as never, t0 + 100), false, "1º toque");
	assert.equal(handleJumpTap(h.player as never, t0 + 100 + 20), false, "toques espaçados (> 10 ticks) não contam");
	assert.equal(handleJumpTap(h.player as never, t0 + 100 + 25), true, "duplo toque reabre");
	await advance(5);
	assert.equal(h.opened(), 2);
	assert.ok(await advanceUntil(() => h.battle.ended, 200_000));
	// Sem batalha: nada.
	assert.equal(handleJumpTap(h.player as never, t0 + 500), false);
	assert.equal(handleJumpTap(h.player as never, t0 + 502), false, "fora de batalha o duplo toque não faz nada");
}
{
	// Batalha aberta (não minimizada) e esperando: duplo toque não mexe.
	const h = setup("TouchOpen", undefined, () => growl());
	h.player.inputInfo.lastInputModeUsed = "Touch";
	assert.ok(await advanceUntil(() => h.opened() === 1, 20_000));
	assert.ok(await waitAnimating(h));
	assert.equal(handleJumpTap(h.player as never, 2_000_000), false);
	assert.equal(handleJumpTap(h.player as never, 2_000_004), false, "aberta: duplo toque não minimiza nem abre");
	assert.equal(getUiState(h.player.id)!.minimised, false);
	h.actor.decider = () => tackle();
	assert.ok(await advanceUntil(() => h.battle.ended, 200_000));
}

// 7. Preferência `classic`: o antigo — a tela abre a cada turno; fechada, a dica (com a tecla) vai para o chat.
{
	const h = setup("Classic", "classic", call => call === 2 ? undefined : call < 4 ? growl() : tackle());
	assert.ok(await advanceUntil(() => h.opened() >= 2, 20_000), "abre no 1º e no 2º turno");
	await advance(20);
	assert.ok(h.player.hasMessage("cobblemon.port.battle_ui.reopen_hint"), "classic: dica de reabrir no chat");
	assert.equal(battleUiView(h.player as never), undefined, "classic: nada de aviso no HUD");
	h.actor.promptPlayerForRequest("toggle");
	assert.ok(await advanceUntil(() => h.battle.ended, 200_000), "classic termina");
	assert.equal(h.battle.endReason, "win");
	assert.ok(h.opened() >= 4, "classic reabre a cada turno");
}

// 8. Preferência `hud`: fecha a tela do 1º turno e vence escolhendo pela hotbar + tecla R, sem abrir outra tela.
{
	const h = setup("Hud", "hud", () => undefined);
	assert.ok(await advanceUntil(() => h.opened() === 1, 20_000), "hud: a tela abre no começo");
	await advance(20);
	assert.equal(getUiState(h.player.id)!.hudRequestId, h.actor.requestId, "fechada → menu no HUD");
	let view = battleUiView(h.player as never)!;
	assert.equal(view.prompt, BATTLE_PROMPT.MENU);
	assert.deepEqual(view.moves?.map(m => m.id), ["tackle", "growl"], "menu de golpes no HUD");
	assert.equal(view.cursor, 0);
	h.player.selectedSlotIndex = 1;
	view = battleUiView(h.player as never)!;
	assert.equal(view.cursor, 1, "o cursor segue a hotbar");
	let turns = 0;
	const before = h.battle.turn;
	h.actor.promptPlayerForRequest("toggle");
	assert.ok(await advanceUntil(() => h.battle.turn > before, 20_000), "golpe escolhido pelo HUD");
	assert.ok(h.battle.showdownMessages.join("\n").includes("|Growl|"), "usou Growl");
	h.player.selectedSlotIndex = 0;
	while (!h.battle.ended && turns++ < 40) {
		await advanceUntil(() => h.battle.ended || (h.actor.mustChoose && getUiState(h.player.id)?.hudRequestId === h.actor.requestId), 20_000);
		if (h.battle.ended) break;
		h.actor.promptPlayerForRequest("toggle");
		await advance(10);
	}
	assert.ok(h.battle.ended, "hud termina");
	assert.equal(h.battle.endReason, "win");
	assert.equal(h.opened(), 1, "nenhuma tela além da primeira");
	await advance(40);
	assert.equal(getUiState(h.player.id), undefined, "estado limpo no fim");
}
{
	// Espaço 7 + R abre o menu completo.
	const h = setup("HudMenu", "hud", call => call === 1 ? undefined : tackle());
	assert.ok(await advanceUntil(() => h.opened() === 1, 20_000));
	await advance(20);
	h.player.selectedSlotIndex = 6;
	h.actor.promptPlayerForRequest("toggle");
	await advance(5);
	assert.equal(h.opened(), 2, "espaço 7 + R abre o menu completo");
	assert.ok(await advanceUntil(() => h.battle.ended, 200_000));
}

// 9. HUD real: overlay do time some na batalha e volta no fim; canal B leva o aviso como cauda rawtext.
{
	startPartyHud();
	const h = setup("Overlay", undefined, call => call === 1 ? undefined : tackle());
	const emptyParty = getHudChannel(h.player as never, CHANNEL.PARTY);
	assert.ok(await advanceUntil(() => h.opened() === 1, 20_000));
	await advance(20);
	const party = getHudChannel(h.player as never, CHANNEL.PARTY) ?? "";
	assert.ok(party.startsWith("-"), "em batalha o overlay do time fica escondido");
	const battleBody = getHudChannel(h.player as never, CHANNEL.BATTLE) ?? "";
	const bodyHead = header(CHANNEL.BATTLE, 0) + battleBody;
	const head = evalBindings(hud.battle_overlay.controls[0].cbhud_battle_head.bindings, bodyHead);
	assert.equal(head["#min"], "_1", "canal B: minimizado");
	assert.equal(head["#pr"], "_1", "canal B: aviso pulsando");
	h.actor.promptPlayerForRequest("toggle");
	assert.ok(await advanceUntil(() => h.battle.ended, 200_000));
	await advance(20);
	const after = getHudChannel(h.player as never, CHANNEL.PARTY) ?? "";
	assert.ok(after.startsWith("a") || after.startsWith("n"), `fora da batalha o overlay volta (${JSON.stringify(after.slice(0, 1))}, antes ${JSON.stringify(emptyParty?.slice(0, 1))})`);
}

assert.deepEqual(errors, [], `sem erros: ${errors.join("\n")}`);
originalError; // mantém a referência (depuração)
console.info = console.log;
process.stdout.write("batalha-minimizavel: ok\n");
