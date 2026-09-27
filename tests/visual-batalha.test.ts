// Frente "visual-batalha": Illusion/Transform/Imposter (entidade de exibição), Sketch permanente, tipo efetivo na
// tela, mensagens de troca, envio com bola (partículas por bola, escalonamento), recolha, balsa, efeitos de
// status/boost (action_effects), Eggant Berry segurada, sons de level-up e o `[is]` do adaptador.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { advance, advanceUntil, createPlayer, FakeDimension, FakeEntity, FakePlayer, overworld, spawnWild } from "./batalhas-harness";
import { PokemonData } from "../scripts/Pokemon";
import { BattleActor, PokemonBattle, startPvPBattle, startWildBattle } from "../scripts/battle";
import { ActionResponse, MoveActionResponse, PassActionResponse, SwitchActionResponse } from "../scripts/battle/ActionResponse";
import { RequestData, requestPokemonUUID } from "../scripts/battle/Request";
import { getTargetOptions, getSimActive } from "../scripts/battle/SimQueries";
import { Dex } from "../scripts/showdown";
import { setMoveLearningPrompt } from "../scripts/battle/Rewards";
import { MOCK_TAG, mockAspects, resolveMockTarget } from "../scripts/battle/effects/Mock";
import { planActionEffect, statusTimeline } from "../scripts/battle/effects";
import { hitboxWidth, needsPlatform, platformTypeForWidth, PlatformType, removeStalePlatforms } from "../scripts/battle/Platform";
import { ballParticleName, yawTowards } from "../scripts/battle/SendOut";
import { displayedMoveType } from "../scripts/GUI/Battle";
import { playExpGainedSounds } from "../scripts/battle/LevelUpSounds";
import { toShowdownItemId } from "../scripts/items/heldItems";

const originalError = console.error;
const errors: string[] = [];
console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
console.info = () => { };
console.log = () => { };
console.warn = () => { };
setMoveLearningPrompt(async () => false);

// ------------------------------------------------------------------------------------------------ mundo falso extra
// (só neste teste: rotação, cabeça, partículas e sons gravados)
const particles: string[] = [];
const playerSounds: string[] = [];
const fakeEntity = FakeEntity.prototype as unknown as Record<string, unknown>;
fakeEntity.getRotation = function (this: { rotation?: { x: number; y: number } }) { return this.rotation ?? { x: 0, y: 0 }; };
fakeEntity.setRotation = function (this: { rotation?: { x: number; y: number } }, r: { x: number; y: number }) { this.rotation = r; };
fakeEntity.getHeadLocation = function (this: FakeEntity) { return { x: this.location.x, y: this.location.y + 1.5, z: this.location.z }; };
fakeEntity.getViewDirection = () => ({ x: 1, y: 0, z: 0 });
fakeEntity.remove = function (this: FakeEntity) { this.isValid = false; };
const effects = new Map<string, Set<string>>();
fakeEntity.addEffect = function (this: FakeEntity, id: string) { if (!effects.has(this.id)) effects.set(this.id, new Set()); effects.get(this.id)!.add(id); };
fakeEntity.removeEffect = function (this: FakeEntity, id: string) { effects.get(this.id)?.delete(id); };
(FakeDimension.prototype as unknown as Record<string, unknown>).spawnParticle = (id: string) => { particles.push(id); };
(FakePlayer.prototype as unknown as Record<string, unknown>).playSound = (id: string) => { playerSounds.push(id); };

function pokemon(species: string, level: number, moves: string[], extra: Partial<PokemonData> = {}) {
	const data = Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false }), extra);
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}

/** Sempre o 1º golpe, no 1º alvo inimigo; troca obrigatória pela 1ª reserva viva. */
function firstMove(actor: BattleActor, request: RequestData): ActionResponse[] {
	const out: ActionResponse[] = [];
	for (let slot = 0; slot < actor.slotCount; slot++) {
		if (!actor.slotNeedsChoice(slot, request)) { out.push(new PassActionResponse()); continue; }
		if (request.forceSwitch) {
			const next = request.side.pokemon.find(x => !x.active && !x.condition.endsWith("fnt"));
			out.push(new SwitchActionResponse(requestPokemonUUID(next!)));
			continue;
		}
		const move = request.active![slot].moves.find(x => !x.disabled) ?? request.active![slot].moves[0];
		const targets = getTargetOptions(actor, slot, move.target);
		out.push(new MoveActionResponse(move.id, targets?.find(x => !x.ally)?.loc ?? targets?.[0]?.loc));
	}
	return out;
}

async function runToEnd(battle: PokemonBattle, maxTicks = 200_000) {
	const ended = await advanceUntil(() => battle.ended, maxTicks);
	if (!ended) originalError(battle.showdownMessages.slice(-4).join("\n---\n"));
	assert.ok(ended, "a batalha deveria terminar");
	await advance(60);
}

const log = (battle: PokemonBattle) => battle.showdownMessages.join("\n");
const mocks = () => overworld.entities.filter(e => e.isValid && e.tags.has(MOCK_TAG));
const chat = (battle: PokemonBattle) => JSON.stringify(battle.chatLog);

// ------------------------------------------------------------------------------------------------ 1. Illusion
{
	const zoroark = pokemon("zoroark", 50, ["nightdaze"], { ability: "illusion" });
	const pikachu = pokemon("pikachu", 50, ["thunderbolt"]);
	const player = createPlayer("Ash", [zoroark, pikachu]);
	const wild = spawnWild(pokemon("rattata", 50, ["tackle"]));
	const battle = startWildBattle(player as never, wild as never)!;
	const actor = battle.getActorFromID(player.id)!;
	actor.decider = firstMove;
	await advanceUntil(() => battle.started, 20_000);
	const text = log(battle);
	// Adaptador: identidade real no protocolo + [is] com o disfarce (fork do Cobblemon).
	assert.ok(text.includes(`|switch|p1a: ${zoroark.uuid}|`), "switch com o UUID real do Zoroark");
	assert.ok(text.includes(`[is] p1: ${pikachu.uuid}`), "`[is]` com o disfarce");
	const active = actor.activePokemon[0]!;
	assert.equal(active.data.uuid, zoroark.uuid, "o Zoroark está em campo (antes o port mandava o Pikachu)");
	assert.equal(active.illusion?.uuid, pikachu.uuid);
	assert.equal(active.mock?.kind, "illusion");
	assert.equal(active.mock?.entity.typeId, "cobblemon:pikachu", "entidade de exibição do disfarce");
	assert.ok(active.mock?.entity.hasTag("cobblemon_ui_display"), "tag do estúdio (sem dados de selvagem)");
	assert.ok(effects.get(active.entity.id)?.has("invisibility"), "o Zoroark real fica invisível");
	assert.equal(resolveMockTarget(active.mock!.entity as never).id, active.entity.id, "a entidade de exibição aponta o real");
	assert.ok(player.hasMessage("cobblemon.battle.switch.self"), "Vai! X! (switch.self)");
	assert.equal(JSON.stringify(active.getName()), JSON.stringify(pikachu.getTranslatedName()), "nome nas mensagens = disfarce");
	assert.equal(active.displayData(false).uuid, pikachu.uuid, "oponente vê o disfarce");
	assert.equal(active.displayData(true).uuid, zoroark.uuid, "aliado vê o real");
	await runToEnd(battle);
	assert.ok(text.includes("|replace|") || log(battle).includes("|replace|") || !log(battle).includes("|-damage|p1a"), "Illusion quebra com dano");
	if (log(battle).includes("|replace|"))
		assert.equal(active.mock, undefined, "fim da Illusion tira o disfarce");
	assert.equal(mocks().length, 0, "sem entidade de exibição depois da batalha");
	assert.ok(!effects.get(active.entity.id)?.has("invisibility"), "o real volta a aparecer");
}

// ------------------------------------------------------------------------------------------------ 2. Transform (golpe)
{
	const mew = pokemon("mew", 50, ["tackle"]);
	const player = createPlayer("Red", [mew]);
	const ditto = pokemon("ditto", 50, ["transform"], { ability: "limber" });
	const wild = spawnWild(ditto);
	const battle = startWildBattle(player as never, wild as never)!;
	const actor = battle.getActorFromID(player.id)!;
	actor.decider = firstMove;
	const wildActive = () => battle.actors[1].activePokemon[0];
	await advanceUntil(() => !!wildActive()?.mock || battle.ended, 40_000);
	assert.ok(log(battle).includes("|-transform|"), "Ditto usou Transform");
	assert.equal(wildActive()?.mock?.kind, "transform");
	assert.equal(wildActive()?.mock?.entity.typeId, "cobblemon:mew", "Ditto aparece como Mew");
	await advance(200);
	assert.ok(chat(battle).includes("cobblemon.battle.transform"), "mensagem de Transform");
	await runToEnd(battle);
	assert.equal(mocks().length, 0, "Transform desfeito no fim da batalha");
	// Transform mantém o shiny de quem se transforma.
	assert.deepEqual(mockAspects("transform", Object.assign(pokemon("mew", 5, ["tackle"]), { aspects: ["shiny"] }), pokemon("ditto", 5, ["transform"])), []);
	assert.deepEqual(mockAspects("transform", pokemon("mew", 5, ["tackle"]), Object.assign(pokemon("ditto", 5, ["transform"]), { shiny: true })), ["shiny"]);
}

// ------------------------------------------------------------------------------------------------ 3. Imposter + Sketch
{
	const ditto = pokemon("ditto", 50, ["transform"], { ability: "imposter" });
	const player = createPlayer("Blue", [ditto]);
	const wild = spawnWild(pokemon("pidgey", 50, ["tackle"]));
	const battle = startWildBattle(player as never, wild as never)!;
	battle.getActorFromID(player.id)!.decider = firstMove;
	await advanceUntil(() => !!battle.actors[0].activePokemon[0]?.mock || battle.ended, 40_000);
	assert.equal(battle.actors[0].activePokemon[0]?.mock?.entity.typeId, "cobblemon:pidgey", "Imposter: Ditto vira o oponente ao entrar");
	battle.stop();
	await advance(60);
	assert.equal(mocks().length, 0);
}
{
	const smeargle = pokemon("smeargle", 50, ["sketch"]);
	const player = createPlayer("Leaf", [smeargle]);
	// Jolteon selvagem bem mais rápido: usa Tackle antes do Sketch.
	const wild = spawnWild(pokemon("jolteon", 50, ["tackle"]));
	const battle = startWildBattle(player as never, wild as never)!;
	battle.getActorFromID(player.id)!.decider = firstMove;
	await advanceUntil(() => log(battle).includes("move: Sketch") || battle.ended, 60_000);
	// O golpe troca quando a fila da batalha chega na linha (ActivateInstruction), não na leitura.
	await advanceUntil(() => chat(battle).includes("activate.sketch") || battle.ended, 20_000);
	battle.stop();
	await advance(60);
	assert.ok(log(battle).includes("|-activate|") && log(battle).includes("move: Sketch|Tackle"), "Sketch copiou Tackle");
	const saved = PokemonData.getFromJson(JSON.parse(player.getDynamicProperty("team") as string)[0]);
	assert.ok(saved.moves.includes("tackle"), `golpe desenhado fica depois da batalha (${saved.moves})`);
	assert.ok(!saved.moves.includes("sketch"), "Sketch sai do moveset");
	assert.ok(saved.learnedMoves.includes("sketch"), "Sketch vai para os golpes guardados (exchangeMove)");
}

// ------------------------------------------------------------------------------------------------ 4. Trocas (log, bola, recolha)
{
	const a1 = pokemon("charmander", 30, ["scratch"]);
	const a2 = pokemon("squirtle", 30, ["tackle"]);
	const b1 = pokemon("bulbasaur", 30, ["growl"]);
	const pa = createPlayer("Ana", [a1, a2], { x: 0, y: 64, z: 0 });
	const pb = createPlayer("Bia", [b1], { x: 10, y: 64, z: 0 });
	particles.length = 0;
	const battle = startPvPBattle(pa as never, pb as never)!;
	const actorA = battle.getActorFromID(pa.id)!;
	let switched = false;
	actorA.decider = (actor, request) => {
		if (!switched && !request.forceSwitch) { switched = true; return [new SwitchActionResponse(a2.uuid)]; }
		return firstMove(actor, request);
	};
	battle.getActorFromID(pb.id)!.decider = firstMove;
	// Começo: bolas arremessadas (entidades dummy) e a batalha espera o envio.
	await advance(5);
	assert.ok(overworld.entities.some(e => e.typeId.endsWith("_dummy")), "bola arremessada no envio");
	assert.ok(battle.side1.stillSendingOut() || battle.side2.stillSendingOut() || battle.started);
	await advanceUntil(() => pa.hasMessage("cobblemon.battle.withdraw.self"), 60_000);
	assert.ok(pb.hasMessage("cobblemon.battle.withdraw.other"), "Fulano recolheu X (oponente)");
	await advanceUntil(() => actorA.activePokemon[0]?.data.uuid === a2.uuid && !actorA.activePokemon[0]?.pending, 20_000);
	assert.ok(pa.hasMessage("cobblemon.battle.switch.self"), "Vai! X! (dono)");
	assert.ok(pb.hasMessage("cobblemon.battle.switch.other"), "Fulano mandou X! (oponente)");
	assert.ok(particles.includes("cobblemon:recall_beam"), "feixe da recolha");
	assert.ok(particles.includes("cobblemon:pokeball_battle_sendflash"), "partícula de envio da Poké Ball (battle)");
	const squirtle = actorA.activePokemon[0]!;
	assert.ok(squirtle.entity.isValid && squirtle.entity.typeId === "cobblemon:squirtle");
	assert.equal(a1.tryGetPokemonOut(), undefined, "Charmander recolhido");
	await runToEnd(battle);
	assert.ok(particles.includes("cobblemon:statdown_actor"), "Growl: timeline `unboost` (statdown_actor)");
	assert.equal(overworld.entities.filter(e => e.isValid && e.typeId.endsWith("_dummy")).length, 0, "bolas de envio somem");
}

// ------------------------------------------------------------------------------------------------ 5. Efeitos de status
{
	assert.equal(statusTimeline("par"), "paralysis");
	assert.equal(statusTimeline("slp"), "sleep");
	assert.equal(statusTimeline("confusion"), "confused");
	assert.equal(statusTimeline("frz"), undefined, "congelado não tem timeline no 1.8.2");
	const actors = [{ entity: undefined, species: "pikachu", isUser: true }];
	for (const id of ["boost", "unboost", "burn", "paralysis", "sleep", "poison", "poisonbadly", "confused", "attract", "activate_protect", "start_alphaboost"])
		assert.ok(planActionEffect(id, { actors }), `timeline ${id}`);
	assert.equal(planActionEffect("boost", { actors })!.release, 0.85, "boost segura a fila 0,85 s (0,1 + 0,75)");
}

// ------------------------------------------------------------------------------------------------ 6. Tipo efetivo na tela
{
	const hp = { hpType: "Fire", baseAbility: "static" } as never;
	assert.equal(displayedMoveType("hiddenpower", hp), "Fire", "Hidden Power mostra o tipo do Pokémon");
	assert.equal(displayedMoveType("tackle", { baseAbility: "pixilate" } as never), "Fairy");
	assert.equal(displayedMoveType("tackle", { baseAbility: "aerilate" } as never), "Flying");
	assert.equal(displayedMoveType("growl", { baseAbility: "pixilate" } as never), "Normal", "golpe de status não muda");
	assert.equal(displayedMoveType("ember", { baseAbility: "normalize" } as never), "Normal", "Normalize");
	assert.equal(displayedMoveType("ember", undefined), "Fire");
}

// ------------------------------------------------------------------------------------------------ 7. Eggant Berry segurada
{
	assert.ok(Dex.items.get("eggantberry").exists, "Eggant Berry registrada no dex do simulador");
	assert.equal(toShowdownItemId("cobblemon:eggant_berry"), "eggantberry", "item segurado vai para o set");
	const holder = pokemon("pikachu", 30, ["tackle"], { gender: "Male" as never });
	holder.minecraftItem = "cobblemon:eggant_berry";
	const player = createPlayer("Misty", [holder]);
	const wild = spawnWild(pokemon("clefairy", 30, ["attract"], { gender: "Female" as never }));
	const battle = startWildBattle(player as never, wild as never)!;
	battle.getActorFromID(player.id)!.decider = firstMove;
	await advanceUntil(() => log(battle).includes("Eggant Berry") || battle.ended, 80_000);
	const text = log(battle);
	if (text.includes("|-start|p1a") && text.includes("Attract"))
		assert.ok(text.includes("|-end|p1a") && text.includes("[from] item: Eggant Berry"), "come a Eggant Berry e cura a paixão");
	battle.stop();
	await advance(60);
}

// ------------------------------------------------------------------------------------------------ 8. Balsa, bolas, sons
{
	assert.equal(platformTypeForWidth(0.5), PlatformType.WATER_XS);
	assert.equal(platformTypeForWidth(0.511), PlatformType.WATER_XS);
	assert.equal(platformTypeForWidth(1.0), PlatformType.WATER_S);
	assert.equal(platformTypeForWidth(1.5), PlatformType.WATER_M);
	assert.equal(platformTypeForWidth(2.5), PlatformType.WATER_L);
	assert.equal(platformTypeForWidth(3), PlatformType.WATER_XL);
	assert.ok(needsPlatform(pokemon("charmander", 5, ["scratch"])), "Charmander precisa de balsa");
	assert.ok(!needsPlatform(pokemon("magikarp", 5, ["splash"])), "Magikarp respira debaixo d'água");
	assert.ok(!needsPlatform(pokemon("pidgey", 5, ["tackle"])), "Pidgey voa");
	assert.ok(hitboxWidth(pokemon("wailord", 5, ["splash"])) > hitboxWidth(pokemon("pichu", 5, ["tackle"])));
	// Balsas sobradas (queda do servidor): sem batalha desta sessão, todas saem ao carregar o mundo.
	{
		const removedIds: string[] = [];
		const fake = (id: string) => ({ id, remove: () => removedIds.push(id) });
		const dim = { getEntities: (q: { type?: string }) => q.type === "cobblemon:battle_platform" ? [fake("a"), fake("b")] : [] };
		assert.equal(removeStalePlatforms([dim as never]), 2);
		assert.deepEqual(removedIds, ["a", "b"]);
	}
	assert.equal(ballParticleName("cobblemon:poke_ball"), "pokeball");
	assert.equal(ballParticleName("ancient_great_ball"), "ancientgreatball");
	assert.equal(Math.round(yawTowards({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 })) + 0, 0, "olhando para +z = yaw 0");
	assert.equal(Math.round(yawTowards({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 })), -90, "olhando para +x = yaw −90");
	// Sons de level-up (PartyOverlayDataControl): barra sempre, jingle 15 ticks depois se subiu.
	const player = createPlayer("Gold", []);
	playerSounds.length = 0;
	playExpGainedSounds(player as never, { oldLevel: 5, newLevel: 6, experienceAdded: 100 });
	assert.deepEqual(playerSounds, ["cobblemon.gui.levelup_start"]);
	await advance(20);
	assert.deepEqual(playerSounds, ["cobblemon.gui.levelup_start", "cobblemon.gui.levelup"]);
	playerSounds.length = 0;
	playExpGainedSounds(player as never, { oldLevel: 5, newLevel: 5, experienceAdded: 10 });
	await advance(20);
	assert.deepEqual(playerSounds, ["cobblemon.gui.levelup_start"], "sem subir de nível, sem jingle");
	playerSounds.length = 0;
	playExpGainedSounds(player as never, { oldLevel: 5, newLevel: 6, experienceAdded: 10, evolutions: ["x"] });
	await advance(20);
	assert.deepEqual(playerSounds, ["cobblemon.gui.levelup_start"], "com evolução o jingle é o aviso de evolução");
}

// ------------------------------------------------------------------------------------------------ 9. Conteúdo gerado
{
	const dir = "generated/resource_packs/CobblemonBedrock/particles/cobblemon";
	if (existsSync(dir)) {
		const files = readdirSync(dir);
		const ids = new Map<string, string>();
		let looping = 0;
		for (const file of files) {
			const json = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
			const id = json.particle_effect.description.identifier as string;
			ids.set(id, file);
			const loop = json.particle_effect.components["minecraft:emitter_lifetime_looping"];
			if (loop && !loop.sleep_time) looping++;
		}
		assert.ok([...ids.keys()].every(id => !id.includes("/")), "nenhum id de partícula com '/'");
		assert.equal(looping, 0, "emissor looping sem sleep_time vira once (ParticleStorm do Cobblemon)");
		for (const ball of ["pokeball", "greatball", "ultraball", "masterball", "ancientpokeball"]) {
			for (const part of ["battle_sendflash", "battle_ballsparks", "battle_ballsendsparkle", "casual_sendflash", "ballsparkle"])
				assert.ok(ids.has(`cobblemon:${ball}_${part}`), `partícula ${ball}_${part}`);
		}
		for (const id of ["cobblemon:statup_actor", "cobblemon:statdown_actor", "cobblemon:paralysis_actor", "cobblemon:sleep_actor", "cobblemon:capturesparks"])
			assert.ok(ids.has(id), id);
	}
	assert.ok(existsSync("resource_packs/CobblemonBedrock/particles/visual_batalha/recall_beam.particle.json"));
	assert.ok(existsSync("behavior_packs/CobblemonBedrock/entities/visual_batalha/battle_platform.json"));
	for (const size of ["xs", "s", "m", "l", "xl"]) {
		assert.ok(existsSync(`resource_packs/CobblemonBedrock/models/entity/visual_batalha/water_platform_${size}.geo.json`));
		assert.ok(existsSync(`resource_packs/CobblemonBedrock/textures/entity/visual_batalha/water_platform_${size}.png`));
	}
}

const internal = errors.filter(e => !/Missing Interpretation/i.test(e));
assert.deepEqual(internal, [], `erros internos: ${internal.slice(0, 3).join(" | ")}`);
console.error = originalError;
process.stdout.write("ok: visual-batalha (Illusion, Transform, Imposter, Sketch, trocas com bola/feixe, log de troca, status/boost, tipo efetivo, Eggant Berry, balsa, sons de level-up, partículas)\n");
