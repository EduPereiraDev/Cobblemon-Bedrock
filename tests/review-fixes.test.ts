// Frente "review-fixes": correções de achados da revisão independente — Nosepass com um só mecanismo de giro,
// telas do menu de interação sem unhandled rejection, pasto que só ataca o monstro mais próximo dentro da área,
// flags de NPC idempotentes (guia) e lead escolhido no PvP 1×1 (também com nível fixo). API do Minecraft mockada.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { advance, createPlayer, FakePlayer } from "./batalhas-harness";
import { formHooks } from "./mocks/minecraft-server-ui";
import * as SpeciesAi from "../scripts/entity/SpeciesAi";
import { POINT_TO_SPAWN_SPECIES, pointEntityToSpawn, pointToSpawnTarget } from "../scripts/visual/PointToSpawn";
import { chooseLevelRule, openPlayerInteractionMenu } from "../scripts/trade/PlayerInteraction";
import { HOSTILE_SENSE_RANGE, IGNORED_HOSTILE_FAMILIES, nearestPastureHostile, updatePastureConflict } from "../scripts/machines/pastureConflict";
import { NPC_APPLIED_FLAG_PROPS, applyNpcFlags } from "../scripts/npc/NpcFlags";
import { PokemonData } from "../scripts/Pokemon";
import { buildBattleTeam, playerBattleLead, startMultiBattle, startPvPBattle, tryGetBattleFromEntity } from "../scripts/battle";
import { challengePlayer } from "../scripts/ChallengePlayer";
import handleChallenge from "../scripts/ChallengePlayer";
import { setSelectedSlot } from "../scripts/ui/PartySelection";
import { setMoveLearningPrompt } from "../scripts/battle/Rewards";
import { Dex } from "../scripts/showdown";

const ROOT = process.cwd();
const warnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
console.info = () => { };
console.log = () => { };
setMoveLearningPrompt(async () => false);

const unhandled: unknown[] = [];
process.on("unhandledRejection", reason => { unhandled.push(reason); });

type Vec = { x: number; y: number; z: number };

// ---------------------------------------------------------------------------------------------
// 1. Nosepass: um só mecanismo (PointToSpawn), lista do SPECIES_AI e estável perto do spawn

{
	// O giro por setRotation da passada de entidades não existe mais.
	assert.ok(!("tickSpeciesAi" in SpeciesAi), "SpeciesAi não gira mais o Pokémon");
	assert.ok(!("yawToward" in SpeciesAi));
	assert.ok(!readFileSync(join(ROOT, "scripts", "entity", "index.ts"), "utf8").includes("SpeciesAi"), "entityPass sem tarefa de giro");
	// Nenhum outro script combina o spawn do mundo com giro de entidade.
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (path.endsWith(".ts")) files.push(path);
		}
	};
	walk(join(ROOT, "scripts"));
	const rotators = files.filter(file => {
		const text = readFileSync(file, "utf8");
		return text.includes("getDefaultSpawnLocation") && /\.(setRotation|lookAt)\(/.test(text);
	}).map(file => file.slice(ROOT.length + 1));
	assert.deepEqual(rotators, [join("scripts", "visual", "PointToSpawn.ts")], "um só mecanismo aponta para o spawn");
	// Lista vinda do dado gerado.
	assert.ok(POINT_TO_SPAWN_SPECIES.length > 0 && POINT_TO_SPAWN_SPECIES.every(type => SpeciesAi.pointsToSpawn(type)));

	// Perto do spawn: várias passadas seguidas dão sempre o mesmo alvo (sem dois giros brigando) e nenhum setRotation.
	const spawn = { x: 10, y: 70, z: -4 };
	const calls: string[] = [];
	const targets: Vec[] = [];
	const nosepass = (location: Vec) => ({
		typeId: "cobblemon:nosepass",
		location,
		getProperty: () => false,
		getVelocity: () => ({ x: 0, y: 0, z: 0 }),
		getComponent: () => undefined,
		getHeadLocation: () => ({ ...location, y: location.y + 0.8 }),
		lookAt: (target: Vec) => { calls.push("lookAt"); targets.push(target); },
		setRotation: () => { calls.push("setRotation"); },
	}) as never;
	const near = nosepass({ x: 10.2, y: 70, z: -3.3 });
	for (let pass = 0; pass < 6; pass++) assert.equal(pointEntityToSpawn(near, spawn), true);
	assert.deepEqual([...new Set(calls)], ["lookAt"], "só lookAt, nunca setRotation");
	assert.equal(new Set(targets.map(t => JSON.stringify(t))).size, 1, "alvo estável perto do spawn");
	assert.deepEqual(targets[0], { x: 10.5, y: 70.8, z: -3.5 });
	// Em cima do centro do bloco do spawn: sem direção (LookControl.getYRotD vazio), sem giro.
	calls.length = 0;
	assert.equal(pointEntityToSpawn(nosepass({ x: 10.5, y: 70, z: -3.5 }), spawn), false);
	assert.deepEqual(calls, []);
	assert.equal(pointToSpawnTarget({ x: 10.5, y: 0, z: -3.5 }, spawn, 1), undefined);
	assert.ok(pointToSpawnTarget({ x: 10.51, y: 0, z: -3.5 }, spawn, 1));
}

// ---------------------------------------------------------------------------------------------
// 2. Menu de interação: form.show() rejeitado (jogador saiu) não vira unhandled rejection

{
	const quitter = { isValid: true, id: "quitter", name: "Quitter" } as any;
	formHooks.show = () => { quitter.isValid = false; return Promise.reject(new Error("FormRejectError: player left")); };
	assert.equal(await chooseLevelRule(quitter, { text: "x" }), undefined);
	// Menu principal responde (Batalha simples) e o jogador sai na tela da regra de nível.
	const red = createPlayer("MenuRed", [pokemon("bulbasaur", 10)], { x: 0, y: 64, z: 0 });
	const blue = createPlayer("MenuBlue", [pokemon("squirtle", 10)], { x: 3, y: 64, z: 0 });
	let screen = 0;
	formHooks.show = () => {
		if (screen++ === 0) return { canceled: false, selection: 0 };
		red.isValid = false;
		return Promise.reject(new Error("FormRejectError: player left"));
	};
	await openPlayerInteractionMenu(red as never, blue as never);
	// Rejeição direto no menu principal (o jogador sai com a tela aberta).
	red.isValid = true;
	formHooks.show = () => { red.isValid = false; return Promise.reject(new Error("FormRejectError: player left")); };
	await openPlayerInteractionMenu(red as never, blue as never);
	// Erro inesperado com o jogador ainda no servidor: resolve como "fechou", mas fica registrado.
	red.isValid = true;
	formHooks.show = () => Promise.reject(new Error("MalformedResponse"));
	await openPlayerInteractionMenu(red as never, blue as never);
	assert.deepEqual(warnings.filter(w => /menu de interação/.test(w)), ["[cobblemon] menu de interação: Error: MalformedResponse"]);
	warnings.length = 0;
	await advance(2);
	assert.ok(!blue.hasMessage("cobblemon.challenge.received"), "sem desafio de quem saiu");
	delete formHooks.show;
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(unhandled, [], "sem unhandled rejection");

	// report(): jogador inválido não recebe sendMessage (lançaria no Bedrock).
	const gone = createPlayer("Gone", [], { x: 0, y: 64, z: 20 });
	const other = createPlayer("Other", [pokemon("pidgey", 5)], { x: 2, y: 64, z: 20 });
	gone.isValid = false;
	gone.sendMessage = () => { throw new Error("InvalidEntityError"); };
	assert.equal(startPvPBattle(gone as never, other as never), undefined);
	assert.ok(other.hasMessage("cobblemon.battle.error.no_pokemon"), "o outro ainda recebe o erro");
}

// ---------------------------------------------------------------------------------------------
// 3. Pasto: liga só com o monstro mais próximo DENTRO da área

{
	const family = (...families: string[]) => ({ hasTypeFamily: (f: string) => families.includes(f) });
	let seq = 0;
	const mob = (x: number, families = ["monster", "zombie"]) => ({ id: `m${seq++}`, isValid: true, location: { x, y: 0, z: 0 }, getComponent: () => family(...families) });
	const props: Record<string, unknown> = { "cobblemon:pasture_conflict": false, "cobblemon:in_battle": false };
	const fired: string[] = [];
	let world: ReturnType<typeof mob>[] = [];
	let lastQuery: Record<string, unknown> = {};
	const pokemon = {
		id: "pk", isValid: true, location: { x: 0, y: 0, z: 0 },
		getProperty: (k: string) => props[k],
		triggerEvent: (ev: string) => { fired.push(ev); props["cobblemon:pasture_conflict"] = ev.startsWith("cobblemon:enable"); },
		dimension: { getEntities: (options: Record<string, unknown>) => { lastQuery = options; return world; } },
	} as any;
	const inside = (loc: Vec) => loc.x >= -5 && loc.x <= 5;
	// Mesmo critério do nearest_attackable_target: raio 16, monster, fora os ignorados.
	world = [mob(3)];
	assert.equal(updatePastureConflict(pokemon, inside), true);
	assert.equal(lastQuery.maxDistance, HOSTILE_SENSE_RANGE);
	assert.deepEqual(lastQuery.families, ["monster"]);
	assert.deepEqual(lastQuery.excludeFamilies, IGNORED_HOSTILE_FAMILIES);
	// Dois monstros dentro: liga (o mais próximo está dentro).
	world = [mob(4.5), mob(-3)];
	assert.equal(nearestPastureHostile(pokemon), world[1]);
	assert.equal(updatePastureConflict(pokemon, inside), true, "mais próximo dentro");
	// Um dentro (mais perto) e um fora (mais longe): continua ligado.
	world = [mob(4.5), mob(-8)];
	assert.equal(nearestPastureHostile(pokemon), world[0]);
	assert.equal(updatePastureConflict(pokemon, inside), true);
	// Um fora mais perto que o de dentro: a IA iria atrás do de fora → desliga (antes ligava).
	world = [mob(4.8), mob(-5.5)];
	world[0].location = { x: 4.8, y: 0, z: 3 }; // dentro, distância ~5.66
	assert.equal(nearestPastureHostile(pokemon), world[1]);
	assert.equal(updatePastureConflict(pokemon, inside), false, "mais próximo fora da área: desliga");
	assert.equal(props["cobblemon:pasture_conflict"], false);
	// Creeper mais perto não conta (o componente também o ignora); o próximo válido está dentro.
	world = [mob(1, ["monster", "creeper"]), mob(2)];
	assert.equal(nearestPastureHostile(pokemon), world[1]);
	assert.equal(updatePastureConflict(pokemon, inside), true);
	world = [];
	assert.equal(updatePastureConflict(pokemon, inside), false);
	assert.deepEqual(fired, ["cobblemon:enable_pasture_conflict", "cobblemon:disable_pasture_conflict", "cobblemon:enable_pasture_conflict", "cobblemon:disable_pasture_conflict"]);
}

// ---------------------------------------------------------------------------------------------
// 4. NPC: applyNpcFlags idempotente (não readiciona minecraft:leashable a cada onLoad)

{
	const dyn: Record<string, unknown> = {};
	const events: string[] = [];
	let leashable = true;
	const npc = {
		getDynamicProperty: (k: string) => dyn[k],
		setDynamicProperty: (k: string, v?: unknown) => { if (v === undefined) delete dyn[k]; else dyn[k] = v; },
		getProperty: () => true,
		setProperty: () => { },
		triggerEvent: (ev: string) => {
			events.push(ev);
			if (ev === "cobblemon:npc_set_leashable") leashable = true;
			if (ev === "cobblemon:npc_set_unleashable") leashable = false;
		},
		getComponent: (id: string) => (id === "minecraft:leashable" && leashable ? {} : undefined),
	};
	const all = { movable: true, leashable: true, projectileHits: true };
	// NPC salvo antes do estado aplicado: guia presente conta como aplicada (sem readicionar).
	applyNpcFlags(npc, all);
	assert.ok(!events.includes("cobblemon:npc_set_leashable"), "guia já presente: sem evento");
	assert.equal(dyn[NPC_APPLIED_FLAG_PROPS.leashable], true);
	assert.equal(dyn[NPC_APPLIED_FLAG_PROPS.movable], true);
	events.length = 0;
	// onLoad/applyInvulnerability repetidos: nenhum evento.
	for (let i = 0; i < 5; i++) applyNpcFlags(npc, all);
	assert.deepEqual(events, []);
	// Mudança de estado dispara uma vez em cada direção.
	applyNpcFlags(npc, { ...all, leashable: false });
	applyNpcFlags(npc, { ...all, leashable: false });
	applyNpcFlags(npc, all);
	applyNpcFlags(npc, { ...all, movable: false });
	assert.deepEqual(events, ["cobblemon:npc_set_unleashable", "cobblemon:npc_set_leashable", "cobblemon:npc_set_immovable"]);
}

// ---------------------------------------------------------------------------------------------
// 5. PvP 1×1: lead = Pokémon selecionado (ChallengeManager.setLead); nível fixo mantém a ordem; Multi = ordem do time

function pokemon(species: string, level: number, moves = ["tackle"]) {
	const data = PokemonData.generateNewWildPokemon(species, { level, shiny: false });
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

{
	// buildBattleTeam com cópias: o lead vira a cópia dele e o resto fica na ordem.
	const team = [pokemon("bulbasaur", 10), pokemon("pidgey", 10), pokemon("rattata", 10)];
	const cloned = buildBattleTeam(team, team[2].uuid, { setLevel: 5 });
	assert.deepEqual(cloned.map(p => p.species), ["rattata", "bulbasaur", "pidgey"]);
	assert.ok(cloned.every(p => p.battleClone && p.level === 5));

	const species = (player: FakePlayer) => tryGetBattleFromEntity(player as never)!.getActorFromID(player.id)!.pokemon.map(p => p.species);
	const stop = (player: FakePlayer) => tryGetBattleFromEntity(player as never)?.stop();
	const red = createPlayer("LeadRed", [pokemon("bulbasaur", 10), pokemon("pidgey", 10), pokemon("rattata", 10)], { x: 0, y: 64, z: 40 });
	const blue = createPlayer("LeadBlue", [pokemon("squirtle", 10), pokemon("caterpie", 10)], { x: 3, y: 64, z: 40 });
	assert.equal(playerBattleLead(red as never), getTeamUuid(red, 0), "sem seleção: primeiro do time");
	setSelectedSlot(red as never, 2);
	setSelectedSlot(blue as never, 1);
	assert.equal(playerBattleLead(red as never), getTeamUuid(red, 2));

	// Luta Livre: o lead de cada um abre; o do desafiante é o do momento do desafio.
	challengePlayer(red as never, blue as never, "singles");
	setSelectedSlot(red as never, 0);
	handleChallenge(blue as never, red as never);
	assert.deepEqual(species(red), ["rattata", "bulbasaur", "pidgey"], "lead do desafiante (guardado no desafio)");
	assert.deepEqual(species(blue), ["caterpie", "squirtle"], "lead de quem aceita");
	stop(red);
	await advance(40);

	// Nível fixo (5): cópias com o mesmo lead e a mesma ordem.
	setSelectedSlot(red as never, 1);
	challengePlayer(red as never, blue as never, "singles", 5);
	handleChallenge(blue as never, red as never);
	const battle = tryGetBattleFromEntity(red as never)!;
	assert.deepEqual(species(red), ["pidgey", "bulbasaur", "rattata"]);
	assert.deepEqual(species(blue), ["caterpie", "squirtle"]);
	assert.ok(battle.actors.every(a => a.pokemon.every(p => p.battleClone && p.level === 5)));
	stop(red);
	await advance(40);

	// Multi: o Cobblemon usa `party().first()` (ChallengeManager.onAccept), não a seleção → ordem do time.
	const c = createPlayer("LeadC", [pokemon("charmander", 10), pokemon("oddish", 10)], { x: 6, y: 64, z: 40 });
	const d = createPlayer("LeadD", [pokemon("pikachu", 10)], { x: 9, y: 64, z: 40 });
	setSelectedSlot(c as never, 1);
	const multi = startMultiBattle([red as never, c as never], [blue as never, d as never]);
	assert.ok(multi, "Multi começa");
	assert.deepEqual(species(c), ["charmander", "oddish"], "Multi: ordem do time (paridade)");
	multi!.stop();
	await advance(40);
}

function getTeamUuid(player: FakePlayer, slot: number): string {
	return JSON.parse(player.getDynamicProperty("team") as string)[slot].uuid;
}

assert.deepEqual(unhandled, [], "sem unhandled rejection");
assert.deepEqual(warnings.filter(w => /menu de interação/.test(w)), [], "saída do jogador não vira aviso");
console.warn = originalWarn;
process.stdout.write("review-fixes: ok\n");
