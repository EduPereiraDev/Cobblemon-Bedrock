// Frente "review-fixes", rodada 2: achados da segunda revisão independente. Cada bloco é o teste de regressão de um
// achado (numeração de docs/pendencias/review-fixes.md, seção "Rodada 2"). API do Minecraft mockada.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as mc from "@minecraft/server";
import { NPC } from "../scripts/npc/NPCEntity";
import { BLANKED_NAME_PROPERTY, refreshNpcHide, setHiddenFor, startNpcHide } from "../scripts/npc/NpcHide";
import { NPC_MODEL_TAG, npcModelDisplay, startNpcPokemonModels, syncNpcPokemonModel } from "../scripts/npc/PokemonModel";
import { rideStyleInfo } from "../tools/importer/entities.ts";
import { walkMovementValue } from "../scripts/entity/RideSprint";
import { rideComponentValues } from "../scripts/pokemon/RideStats";
import { getRideInfo } from "../scripts/entity/EntityData";
import { applyModeCommand, battleUiView, hudEligible, MODE_PROPERTY, registerBattleUiModes } from "../scripts/battle/BattleUiMode";
import { battlePromptHooks } from "../scripts/battle/BattlePromptHooks";
import { BattleTypes } from "../scripts/battle/BattleFormat";
import { battleMap } from "../scripts/battle/PokemonBattle";
import { BATTLE_PROMPT } from "../scripts/ui/hudProtocol";
import { inActiveBattle } from "../scripts/GUI/PartyHud";
import { scriptEventHandler } from "../scripts/events/ScriptEvents";

const ROOT = process.cwd();
const server = mc as unknown as Record<string, any>;
const world = server.world;
const system = server.system;
const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
console.info = () => { };
console.log = () => { };

type Vec = { x: number; y: number; z: number };

// Relógio mínimo: currentTick fixo e as tarefas por intervalo guardadas para o teste rodar à mão.
const intervals: Array<() => void> = [];
system.currentTick = 1000;
system.runInterval = (fn: () => void) => { intervals.push(fn); return intervals.length; };
system.runTimeout = () => 0;
system.run = () => 0;

/** Entidade falsa com dynamic properties, propriedades e tags. */
function fakeEntity(id: string, typeId: string, dynamic: Record<string, unknown> = {}) {
	const dyn = new Map<string, unknown>(Object.entries(dynamic));
	const properties = new Map<string, unknown>();
	const tags = new Set<string>();
	const events: string[] = [];
	const entity: any = {
		id, typeId, isValid: true, nameTag: "", events, properties, tags,
		location: { x: 0, y: 64, z: 0 },
		dimension: undefined as any,
		getDynamicProperty: (k: string) => dyn.get(k),
		setDynamicProperty: (k: string, v: unknown) => { if (v === undefined) dyn.delete(k); else dyn.set(k, v); },
		getProperty: (k: string) => properties.get(k),
		setProperty: (k: string, v: unknown) => { properties.set(k, v); },
		triggerEvent: (e: string) => { events.push(e); },
		addTag: (t: string) => { tags.add(t); return true; },
		hasTag: (t: string) => tags.has(t),
		getRotation: () => ({ x: 0, y: 0 }),
		getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
		getComponent: () => undefined,
		teleport: () => { },
		setRotation: () => { },
		remove: () => { entity.isValid = false; },
	};
	return entity;
}

/** Jogador falso: dados MoLang em dynamic property e overrides por entidade registrados. */
function fakePlayer(id: string, name: string) {
	const player = fakeEntity(id, "minecraft:player");
	player.name = name;
	player.overrides = new Map<string, unknown>();
	player.setPropertyOverrideForEntity = (target: { id: string }, property: string, value: unknown) => { player.overrides.set(`${target.id}|${property}`, value); };
	player.removePropertyOverrideForEntity = (target: { id: string }, property: string) => { player.overrides.delete(`${target.id}|${property}`); };
	return player;
}

// Mundo: NPCs por dimensão, entidades por id e jogadores.
const entities = new Map<string, any>();
let npcs: any[] = [];
let players: any[] = [];
const dimension: any = {
	id: "minecraft:overworld",
	getEntities: () => npcs,
	getPlayers: () => players,
	spawnEntity: (typeId: string, location: Vec) => {
		const display = fakeEntity(`display-${entities.size + 1}`, typeId);
		display.location = location;
		display.dimension = dimension;
		entities.set(display.id, display);
		return display;
	},
};
world.getDimension = () => dimension;
world.getAllPlayers = () => players;
world.getPlayers = () => players;
world.getEntity = (id: string) => entities.get(id);

// O mock do TextPrimitive não tem setText/setLocation (API 2.10.0): o teste acrescenta para observar.
const TextPrimitiveProto = (mc.TextPrimitive as any).prototype;
TextPrimitiveProto.setText = function (text: unknown) { this.text = text; };
TextPrimitiveProto.setLocation = function (location: unknown) { this.location = location; };
const addedLabels: any[] = [];
world.primitiveShapesManager = { addText: (label: unknown) => { addedLabels.push(label); } };

function makeNpc(id: string, extra: Record<string, unknown> = {}) {
	const entity = fakeEntity(id, "cobblemon:npc", { "npc:class": "cobblemon:standard", "npc:name_key": "Joana", ...extra });
	entity.dimension = dimension;
	entities.set(id, entity);
	new NPC(entity).refreshNameTag();
	return entity;
}

// ---------------------------------------------------------------------------------------------
// 1 (MÉDIO) + 8. NPC escondido: o nome volta quando ninguém mais esconde; refreshNameTag e exibição nova não vazam

{
	startNpcHide();
	const alice = fakePlayer("p-alice", "Alice");
	const bob = fakePlayer("p-bob", "Bob");

	// Caso do achado: o único jogador esconde (sem ninguém para ver o rótulo) e depois desfaz.
	players = [alice];
	const npc = makeNpc("npc-1");
	npcs = [npc];
	assert.equal(npc.nameTag, "Joana");
	setHiddenFor(npc, alice, true);
	assert.equal(npc.nameTag, "", "escondido de alguém: nameTag global vazio");
	assert.equal(npc.getDynamicProperty(BLANKED_NAME_PROPERTY), "Joana", "marca persistente do nome apagado");
	assert.equal(alice.overrides.get("npc-1|cobblemon:npc_hidden"), true);
	assert.equal(addedLabels.length, 0, "sem ninguém que veja: sem rótulo");
	setHiddenFor(npc, alice, false);
	assert.equal(npc.nameTag, "Joana", "hide desfeito com viewers vazio: o nome volta (antes ficava vazio)");
	assert.equal(npc.getDynamicProperty(BLANKED_NAME_PROPERTY), undefined);
	assert.equal(alice.overrides.has("npc-1|cobblemon:npc_hidden"), false);

	// Com alguém vendo: rótulo só para ele; desfeito, rótulo sai e o nome volta.
	players = [alice, bob];
	setHiddenFor(npc, alice, true);
	assert.equal(npc.nameTag, "");
	assert.equal(addedLabels.length, 1);
	const label = addedLabels[0];
	assert.deepEqual(label.visibleTo.map((p: any) => p.name), ["Bob"]);
	assert.equal(label.text, "Joana");

	// 8: refreshNameTag (set_name/idioma/onLoad) não devolve o nome a todos até o próximo refresh.
	new NPC(npc).refreshNameTag();
	assert.equal(npc.nameTag, "", "refreshNameTag reaplica a ocultação no mesmo tick");
	// 8: renomear e mudar hitbox atualizam o rótulo.
	new NPC(npc).setNameKey("Maria");
	assert.equal(npc.nameTag, "");
	assert.equal(label.text, "Maria", "rótulo acompanha o nome novo");
	const y0 = label.location.y;
	npc.setDynamicProperty("npc:hitbox_scale", 2);
	refreshNpcHide();
	assert.ok(label.location.y > y0 + 0.5, `rótulo sobe com a hitbox (${y0} → ${label.location.y})`);

	setHiddenFor(npc, alice, false);
	assert.equal(npc.nameTag, "Maria");
	npc.setDynamicProperty("npc:hitbox_scale", undefined);

	// "/reload": estado em memória perdido, mas a marca no NPC basta para devolver o nome.
	const reloaded = makeNpc("npc-2");
	reloaded.nameTag = "";
	reloaded.setDynamicProperty(BLANKED_NAME_PROPERTY, "Joana");
	npcs = [reloaded];
	refreshNpcHide();
	assert.equal(reloaded.nameTag, "Joana", "restaura no load/reload");
	// NPC sem chave de nome (nameTag literal): volta o nameTag guardado, não "NPC".
	const literal = fakeEntity("npc-3", "cobblemon:npc", { "npc:class": "cobblemon:standard" });
	literal.dimension = dimension;
	literal.nameTag = "Guarda";
	entities.set(literal.id, literal);
	npcs = [literal];
	setHiddenFor(literal, alice, true);
	assert.equal(literal.nameTag, "");
	assert.equal(addedLabels.at(-1).text, "Guarda", "rótulo com o nameTag guardado");
	setHiddenFor(literal, alice, false);
	assert.equal(literal.nameTag, "Guarda");

	// 8: exibição recriada nasce encolhida para quem não vê (sem esperar os 20 ticks do laço).
	startNpcPokemonModels();
	const modeled = makeNpc("npc-4");
	npcs = [modeled];
	new NPC(modeled).setResourceIdentifier("cobblemon:pikachu");
	setHiddenFor(modeled, alice, true);
	syncNpcPokemonModel(modeled);
	const display = npcModelDisplay("npc-4");
	assert.ok(display, "exibição criada");
	assert.ok(alice.overrides.has(`${display!.id}|cobblemon:scale_modifier`), "override na exibição logo ao criar");
	assert.ok(!bob.overrides.has(`${display!.id}|cobblemon:scale_modifier`));
	// Exibição some (/kill) e volta: a nova também já nasce escondida para Alice.
	display!.isValid = false;
	system.currentTick += 40;
	for (const run of intervals) run();
	const again = npcModelDisplay("npc-4");
	assert.ok(again && again.id !== display!.id, "exibição recriada pelo tickModel");
	assert.ok(alice.overrides.has(`${again!.id}|cobblemon:scale_modifier`), "recriada já escondida");

	// 3 (BAIXO): in_battle da exibição é reaplicado mesmo se algo de fora gravar false nela.
	modeled.setProperty("cobblemon:in_battle", true);
	for (const run of intervals) run();
	assert.equal(again!.getProperty("cobblemon:in_battle"), true);
	again!.setProperty("cobblemon:in_battle", false);
	for (const run of intervals) run();
	assert.equal(again!.getProperty("cobblemon:in_battle"), true, "tickModel compara com a propriedade da exibição");
	assert.ok(again!.hasTag(NPC_MODEL_TAG));
}

// 3 (BAIXO): o handler de interação de Pokémon do main.ts ignora a exibição do NPC antes de handlePokemonInteract.
{
	const src = readFileSync(join(ROOT, "scripts", "main.ts"), "utf8");
	const handler = src.slice(src.indexOf("world.beforeEvents.playerInteractWithEntity.subscribe"));
	const skip = handler.indexOf("if (target.hasTag(NPC_MODEL_TAG)) return;");
	assert.ok(skip > 0, "main.ts ignora cobblemon_npc_model");
	assert.ok(skip < handler.indexOf("handlePokemonInteract(player, target, heldItem)"));
	assert.ok(skip < handler.indexOf("startSpectating(player, target)"));
}

// ---------------------------------------------------------------------------------------------
// 2 (MÉDIO). Montaria `horse` sem sprint anda no getWalkSpeed do Java convertido (não no walkSpeed cru)

{
	const stats = { SPEED: "50", ACCELERATION: "50", SKILL: "50", JUMP: "50", STAMINA: "50" };
	// Java: getWalkSpeed = walkSpeed × 0,7 (MOVEMENT_SPEED) × 1,2 × 0,35 b/tick; Bedrock ≈ 43 b/s por unidade de movement.
	const javaWalkBps = 0.35 * 0.7 * 1.2 * 0.35 * 20;
	const noSprint = rideStyleInfo("LAND", "cobblemon:land/horse", stats, 0.35, { canSprint: "false" });
	assert.equal(noSprint.speed, walkMovementValue(0.35));
	assert.ok(Math.abs(noSprint.speed * 43 - javaWalkBps) < 0.05, `andar ${noSprint.speed * 43} b/s ≈ Java ${javaWalkBps}`);
	assert.ok(noSprint.speed < 0.1, "antes: walkSpeed cru 0,35 (~15 b/s)");
	// Sprint: topo = speedExpr (b/tick) × 20 / 43, sem o × 0,8 (PokemonEntity.travel desloca a velocidade inteira).
	const sprint = rideStyleInfo("LAND", "cobblemon:land/horse", stats, 0.35, {});
	const topBps = (0.1 + (1.2 - 0.1) * 0.5) * 20;
	assert.ok(Math.abs(sprint.speed * 43 - topBps) < 0.1, `topo ${sprint.speed * 43} b/s ≈ Java ${topBps}`);
	assert.equal(sprint.walkSpeed, 0.35);

	// Dados gerados (npm run import): todas as montarias `horse` sem sprint ficam na faixa de andar do Java.
	for (const species of ["altaria", "articuno", "gyarados", "dondozo"]) {
		const land = getRideInfo(species)?.styles.LAND as any;
		assert.ok(land && !land.sprint, species);
		assert.ok(land.speed > 0 && land.speed < 0.06, `${species}: ${land.speed}`);
		// RideStats mantém o valor gerado (já convertido) em vez de tratá-lo como topo.
		assert.equal(rideComponentValues("LAND", land, { SPEED: 100, ACCELERATION: 100, SKILL: 100, JUMP: 100, STAMINA: 100 }).speed, land.speed);
	}
	// Com sprint: a fórmula do RideStats bate com a do importador (ride boosts recalculam o topo).
	const arcanine = getRideInfo("arcanine")!.styles.LAND as any;
	assert.ok(arcanine.sprint);
	assert.equal(rideComponentValues("LAND", arcanine, arcanine.stats).speed, arcanine.speed);
	const bp = JSON.parse(readFileSync(join(ROOT, "generated", "behavior_packs", "CobblemonBedrock", "entities", "pokemon", "altaria.json"), "utf8"));
	assert.equal(bp["minecraft:entity"].component_groups["cobblemon:ride_land"]["minecraft:movement"].value, (getRideInfo("altaria")!.styles.LAND as any).speed);
}

// ---------------------------------------------------------------------------------------------
// 4 e 5 (BAIXO). Modo `hud`: só singles; trocar de modo no meio da batalha não deixa o menu preso

const moveRequest = { requestType: "move", rqid: 5, active: [{ moves: [{ move: "Tackle", id: "tackle", pp: 35, maxpp: 35, target: "normal", disabled: false }] }], side: { pokemon: [] } } as any;

function fakeBattle(id: string, battleType: typeof BattleTypes.SINGLES) {
	const battle: any = { battleId: id, ended: false, spectators: [], format: { battleType } };
	battleMap.set(id, battle);
	return battle;
}

function battler(id: string, battle: any, mode: string) {
	const player = fakePlayer(id, id);
	player.setDynamicProperty("in_battle", battle.battleId);
	player.setDynamicProperty(MODE_PROPERTY, mode);
	player.selectedSlotIndex = 0;
	player.inputInfo = { lastInputModeUsed: "KeyboardAndMouse" };
	player.sendMessage = () => { };
	const actor: any = {
		battle, Player: player, prompting: false, mustChoose: true, request: moveRequest, requestId: 7,
		get slotCount() { return battle.format.battleType.slotsPerActor; },
	};
	battle.getActorFromID = (pid: string) => (pid === id ? actor : undefined);
	return { player, actor };
}

{
	registerBattleUiModes();
	assert.equal(hudEligible(moveRequest, 1), true, "singles");
	assert.equal(hudEligible(moveRequest, 1, 2), false, "Multi (1 posição, 2 atores por lado) não cabe no HUD");

	// Multi, modo hud, minimizada: aviso do Java (sem menu de golpes que mandaria golpe sem alvo).
	const multi = fakeBattle("b-multi", BattleTypes.MULTI);
	const m = battler("p-multi", multi, "hud");
	assert.ok(battlePromptHooks.onMenuClosed!(m.actor, 7));
	assert.equal(battleUiView(m.player)?.prompt, BATTLE_PROMPT.ACTIONS);
	assert.equal(battlePromptHooks.beforePrompt!(m.actor, "turn"), true);
	assert.equal(battleUiView(m.player)?.prompt, BATTLE_PROMPT.ACTIONS, "turno novo no Multi também não vira menu");

	// Singles, modo hud: menu. Trocar para java pelo comando limpa o menu.
	const singles = fakeBattle("b-singles", BattleTypes.SINGLES);
	const s = battler("p-singles", singles, "hud");
	battlePromptHooks.onMenuClosed!(s.actor, 7);
	assert.equal(battleUiView(s.player)?.prompt, BATTLE_PROMPT.MENU);
	applyModeCommand("java", s.player);
	assert.equal(battleUiView(s.player)?.prompt, BATTLE_PROMPT.ACTIONS, "menu HUD não fica preso depois do /battleui java");
	// De volta ao hud: o menu reaparece (minimizada, request elegível).
	applyModeCommand("hud", s.player);
	assert.equal(battleUiView(s.player)?.prompt, BATTLE_PROMPT.MENU);
	// Preferência trocada por fora do comando (dynamic property): a visão exige mode === "hud".
	s.player.setDynamicProperty(MODE_PROPERTY, "java");
	assert.equal(battleUiView(s.player)?.prompt, BATTLE_PROMPT.ACTIONS);
}

// ---------------------------------------------------------------------------------------------
// 6 (BAIXO). Espectador de batalha: overlay do time escondido, como no Java

{
	const battle = fakeBattle("b-spectated", BattleTypes.SINGLES);
	const watcher = fakePlayer("p-watcher", "Watcher");
	assert.equal(inActiveBattle(watcher), false);
	battle.spectators.push(watcher);
	assert.equal(inActiveBattle(watcher), true, "espectador conta como em batalha para o overlay");
	battle.ended = true;
	assert.equal(inActiveBattle(watcher), false, "batalha encerrada: overlay volta");
	const participant = fakePlayer("p-part", "Part");
	participant.setDynamicProperty("in_battle", "b-singles");
	assert.equal(inActiveBattle(participant), true);
}

// ---------------------------------------------------------------------------------------------
// 7 (BAIXO). /scriptevent cobblemon:ride_camera não responde "is invalid"

{
	const messages: string[] = [];
	const player = Object.create((mc.Player as any).prototype);
	player.sendMessage = (text: unknown) => { messages.push(String(text)); };
	scriptEventHandler({ id: "cobblemon:ride_camera", message: "boom", sourceEntity: player } as never);
	assert.deepEqual(messages, []);
	scriptEventHandler({ id: "cobblemon:nao_existe", message: "", sourceEntity: player } as never);
	assert.ok(messages.some(text => text.includes("is invalid")), "controle: id desconhecido ainda avisa");
}

// Log do cliente (beta 8): comando da fila (queue_command) de uma entidade que já saiu — a bola arremessada à
// queima-roupa vira a dummy da captura antes do scriptevent rodar. Nenhum handler pode lançar.
{
	const gone = { isValid: false, getDynamicProperty() { throw new TypeError("entidade inválida"); } };
	for (const id of ["cobblemon:pokeball_thrown", "cobblemon:interacted", "cobblemon:setup"]) {
		assert.doesNotThrow(() => scriptEventHandler({ id, message: "", sourceEntity: undefined } as never), `${id} sem entidade`);
		assert.doesNotThrow(() => scriptEventHandler({ id, message: "", sourceEntity: gone } as never), `${id} com entidade inválida`);
	}
}

assert.deepEqual(warnings.filter(w => /NPC:/.test(w)), [], "sem avisos do NPC escondido/modelo");
console.error("review-fixes-2: ok");
