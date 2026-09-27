// Frente "ia-npc": StrongBattleAI (port fiel do StrongBattleAI.kt) e RandomBattleAI em cenários montados direto no
// @pkmn/sim (sem o mundo do Minecraft), mais a completude dos NPCs (behaviours, times, hitbox, skins, start_battle).
import assert from "node:assert/strict";
import { Battle } from "@pkmn/sim";
import type { BattleActor } from "../scripts/battle/BattleActor";
import type { RequestData } from "../scripts/battle/Request";
import { StrongBattleAI } from "../scripts/battle/ai/StrongBattleAI";
import { RandomBattleAI } from "../scripts/battle/ai/RandomBattleAI";
import { getDamageMultiplier } from "../scripts/battle/ai/AIUtility";
import { system, world } from "@minecraft/server";
import { formHooks } from "./mocks/minecraft-server-ui";
import { MoEnvironment } from "../scripts/npc/molang/MoLang";
import { getNPCClass, parsePartyProvider } from "../scripts/npc/NPCClass";
import { formulateParty, provideParty, registerPartyComposition, registerPartyPool, seededRandom } from "../scripts/npc/Party";
import { getBehaviour, getBehaviourIds, getEditableBehaviours } from "../scripts/npc/Behaviours";
import {
	NPC, getNPCNameLanguage, hitboxKey, interactWithNPC, openNPCDialogue, playerSkinIndex, playerSkinIndices, resolveNPCName, resolveSkin,
	scaledHitbox, setNPCNameLanguage, trainerTeamOptions,
} from "../scripts/npc/NPCEntity";
import { findFreeHealer, tickNPCTasks } from "../scripts/npc/NPCTasks";
import { MOLANG_SCRIPTS, NPC_SKINS } from "../generated/scripts/npcs";
import { dropWildLoot } from "../scripts/battle/Rewards";
import { getDialogue } from "../scripts/npc/dialogue/Dialogue";
import { playGibber } from "../scripts/npc/dialogue/DialogueManager";
import { npcDeleteEntitiesCommand } from "../scripts/npc/commands";
import { ActorType } from "../scripts/battle/BattleActor";
import { PokemonData } from "../scripts/Pokemon";
import { getConfig, setGameRule } from "../scripts/Config";

const originalWarn = console.warn;
const originalLog = console.log;
console.log = () => { };

// ------------------------------------------------------------------------------------------------
// Utilitários: batalha crua do simulador e ator falso (só o que as IAs leem: showdownId e o simulador).
// ------------------------------------------------------------------------------------------------

interface Mon { species: string; level?: number; moves: string[]; ability?: string; item?: string; name?: string; nature?: string; evs?: Record<string, number> }

let nextId = 1;
function set(mon: Mon) {
	return {
		name: mon.name ?? `u${nextId++}`, species: mon.species, level: mon.level ?? 50, moves: mon.moves, ability: mon.ability ?? "",
		item: mon.item ?? "", nature: mon.nature ?? "Hardy", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(mon.evs ?? {}) },
		ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: "M",
	};
}

function battle(p1: Mon[], p2: Mon[], format = "gen9customgame", seed: [number, number, number, number] = [1, 2, 3, 4]) {
	const sim = new Battle({ formatid: format as never, seed });
	sim.setPlayer("p1", { name: "A", team: p1.map(set) as never });
	sim.setPlayer("p2", { name: "B", team: p2.map(set) as never });
	// Prévia de time do formato custom: ordem padrão.
	sim.choose("p1", "default");
	sim.choose("p2", "default");
	return sim;
}

function actorOf(sim: Battle, id: string): BattleActor {
	return { showdownId: id, battle: { battleStream: { battle: sim }, battleId: "test" } } as unknown as BattleActor;
}

function request(sim: Battle, id: string): RequestData {
	return sim.sides.find(x => x.id === id)!.activeRequest as unknown as RequestData;
}

/** Sequência fixa de "aleatórios" (repete o último). */
function sequence(...values: number[]) {
	let i = 0;
	return () => values[Math.min(i++, values.length - 1)];
}

function decide(ai: StrongBattleAI | RandomBattleAI, sim: Battle, id = "p2") {
	return ai.choose(actorOf(sim, id), request(sim, id));
}

function moveIndex(sim: Battle, id: string, slot: number, move: string) {
	return (request(sim, id).active![slot].moves.findIndex(x => x.id === move)) + 1;
}

const results: string[] = [];
function scenario(name: string, fn: () => void) {
	fn();
	results.push(name);
}

// ------------------------------------------------------------------------------------------------
// 1. Estimativa de dano (calculateDamage) com os números do original.
// ------------------------------------------------------------------------------------------------
scenario("dano: fórmula, STAB, tipo e esquisitices", () => {
	const sim = battle([{ species: "Squirtle", moves: ["tackle"], ability: "Torrent" }], [{ species: "Pikachu", moves: ["thunderbolt", "quickattack"], ability: "Static" }]);
	const ai = new StrongBattleAI(5);
	decide(ai, sim);
	const self = ai.activeTracker.alliedSide.activePokemon[0];
	const foe = ai.activeTracker.opponentSide.activePokemon[0];
	// Pikachu (SpA 50) × Squirtle (SpD 64): ((floor(100/5)+2) × 90 × 136/164)/50 + 2, STAB 1.5, ×2.
	const expected = ((22 * 90 * (136 / 164)) / 50 + 2) * 1.5 * 2;
	assert.ok(Math.abs(ai.calculateDamage({ id: "thunderbolt" } as never, self, foe) - expected) < 1e-9, "Thunderbolt");
	// +1 de boost conta como ×2 (2 / (2 − 1)); +2 como ×2 também ((2 + 2) / 2).
	self.boosts.spa = 1;
	assert.equal(ai.statEstimationActive(self, "spa"), 136 * 2);
	self.boosts.spa = 2;
	assert.equal(ai.statEstimationActive(self, "spa"), 136 * 2);
	self.boosts.spa = -1;
	assert.equal(ai.statEstimationActive(self, "spa"), 136 * (2 / 3));
	self.boosts.spa = 0;
	// Golpe de status: poder 0 → ainda vale 2 × multiplicadores.
	assert.equal(ai.calculateDamage({ id: "thunderwave" } as never, self, foe), 2 * 1.5 * 2);
	// Whirlwind sempre 0; acertos esperados: 2–5 → 2, Triple Kick → 5, Population Bomb → 7, Water Shuriken → 3.
	assert.equal(ai.calculateDamage({ id: "whirlwind" } as never, self, foe), 0);
	assert.equal(ai.expectedHits({ id: "bulletseed" } as never), 2);
	assert.equal(ai.expectedHits({ id: "triplekick" } as never), 5);
	assert.equal(ai.expectedHits({ id: "populationbomb" } as never), 7);
	assert.equal(ai.expectedHits({ id: "watershuriken" } as never), 3);
	assert.equal(getDamageMultiplier("Ghost", "Normal"), 0);
	assert.equal(getDamageMultiplier("Fairy", "Dragon"), 2);
});

scenario("dano: habilidade que anula tipo, Adaptability, -ate, queimadura do alvo, clima sem efeito", () => {
	// Lanturn: 1ª habilidade Volt Absorb (palpite do rastreador) → Thunderbolt vale 0; escolhe Quick Attack.
	const sim = battle([{ species: "Lanturn", moves: ["surf"], ability: "Volt Absorb" }], [{ species: "Pikachu", moves: ["thunderbolt", "quickattack"], ability: "Static" }]);
	const ai = new StrongBattleAI(5);
	assert.equal(decide(ai, sim), `move ${moveIndex(sim, "p2", 0, "quickattack")}`);
	const self = ai.activeTracker.alliedSide.activePokemon[0];
	const foe = ai.activeTracker.opponentSide.activePokemon[0];
	assert.equal(foe.currentAbility, "voltabsorb");
	assert.equal(ai.calculateDamage({ id: "thunderbolt" } as never, self, foe), 0);

	const sim2 = battle([{ species: "Dragonite", moves: ["tackle"], ability: "Inner Focus" }], [{ species: "Sylveon", moves: ["hypervoice", "swift"], ability: "Pixilate" }]);
	const ai2 = new StrongBattleAI(5);
	decide(ai2, sim2);
	const sylveon = ai2.activeTracker.alliedSide.activePokemon[0];
	const dragonite = ai2.activeTracker.opponentSide.activePokemon[0];
	// Pixilate: Hyper Voice vira Fada (×2 no Dragão) e ganha STAB.
	assert.equal(ai2.moveDamageMultiplier(sylveon, { id: "hypervoice", type: "Normal", category: "Special", basePower: 90, exists: true }, dragonite), 2);

	const sim3 = battle([{ species: "Snorlax", moves: ["tackle"], ability: "Thick Fat" }], [{ species: "Porygonz", moves: ["hyperbeam"], ability: "Adaptability" }]);
	const ai3 = new StrongBattleAI(5);
	decide(ai3, sim3);
	const pz = ai3.activeTracker.alliedSide.activePokemon[0];
	const lax = ai3.activeTracker.opponentSide.activePokemon[0];
	const base = ai3.calculateDamage({ id: "hyperbeam" } as never, pz, lax);
	sim3.sides[1].active[0]!.baseAbility = "download" as never;
	assert.ok(Math.abs(base / ai3.calculateDamage({ id: "hyperbeam" } as never, pz, lax) - 2 / 1.5) < 1e-9, "Adaptability: STAB 2");
	sim3.sides[1].active[0]!.baseAbility = "adaptability" as never;
	// Queimadura do *alvo* reduz golpe físico (esquisitice do original).
	const tackle = ai3.calculateDamage({ id: "tackle" } as never, pz, lax);
	lax.currentStatus = "brn";
	assert.equal(ai3.calculateDamage({ id: "tackle" } as never, pz, lax), tackle * 0.5);
	lax.currentStatus = undefined;
	// Chuva: o original compara com "raining", que nunca acontece → sem efeito.
	sim3.field.weather = "raindance" as never;
	decide(ai3, sim3);
	assert.equal(ai3.activeTracker.currentWeather, "raindance");
	assert.equal(ai3.calculateDamage({ id: "surf" } as never, pz, lax), ai3.calculateDamage({ id: "surf" } as never, pz, lax));
	sim3.field.weather = "" as never;
});

// ------------------------------------------------------------------------------------------------
// 2. Decisões (skill 5).
// ------------------------------------------------------------------------------------------------
scenario("golpe super efetivo mais forte", () => {
	const sim = battle([{ species: "Squirtle", moves: ["tackle"] }], [{ species: "Pikachu", moves: ["tackle", "thunderbolt", "growl"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "thunderbolt")}`);
});

scenario("status quase nunca passa no filtro de dano (Thunder Wave ignorado)", () => {
	const sim = battle([{ species: "Jolteon", moves: ["tackle"] }], [{ species: "Pikachu", moves: ["thunderwave", "quickattack"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "quickattack")}`);
});

scenario("Toxic passa quando o dano estimado é minúsculo (×0.25)", () => {
	// Veneno contra Pedra/Terra = 0.25 → "dano" 0.5 < 80% do HP → alvo sensato.
	const sim = battle([{ species: "Rhyhorn", moves: ["tackle"] }], [{ species: "Snorlax", moves: ["toxic", "tackle"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "toxic")}`);
});

scenario("recuperação com menos de 50% de HP", () => {
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Chansey", moves: ["seismictoss", "softboiled"] }]);
	const chansey = sim.sides[1].active[0]!;
	chansey.hp = Math.floor(chansey.maxhp * 0.4);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "softboiled")}`);
});

scenario("Sleep Talk dormindo", () => {
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Snorlax", moves: ["bodyslam", "sleeptalk"] }]);
	sim.sides[1].active[0]!.setStatus("slp" as never);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "sleeptalk")}`);
});

scenario("Fake Out só no primeiro turno em campo", () => {
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Hitmontop", moves: ["fakeout", "closecombat"] }]);
	const ai = new StrongBattleAI(5);
	assert.equal(decide(ai, sim), `move ${moveIndex(sim, "p2", 0, "fakeout")}`);
	assert.equal(decide(ai, sim), `move ${moveIndex(sim, "p2", 0, "closecombat")}`);
});

scenario("Protect a cada ~3 escolhas quando o oponente não tem status", () => {
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Snorlax", moves: ["protect", "bodyslam"] }]);
	// Sorteio da recarga: 0.9 → desconta 1.
	const ai = new StrongBattleAI(5, sequence(0.9));
	const protect = `move ${moveIndex(sim, "p2", 0, "protect")}`;
	const slam = `move ${moveIndex(sim, "p2", 0, "bodyslam")}`;
	assert.deepEqual([decide(ai, sim), decide(ai, sim), decide(ai, sim), decide(ai, sim)], [protect, slam, slam, protect]);
});

scenario("clima: Rain Dance sem chuva; com chuva, o golpe de dano", () => {
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Politoed", moves: ["watergun", "raindance"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "raindance")}`);
	sim.field.weather = "raindance" as never;
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "watergun")}`);
	sim.field.weather = "" as never;
});

scenario("perigos: oponentes não vistos contam 0 (sem Stealth Rock no 1º turno); Rapid Spin tira os nossos", () => {
	const foes = ["Snorlax", "Eevee", "Pidgey", "Rattata"].map(species => ({ species, moves: ["tackle"] }));
	const sim = battle(foes, [{ species: "Golem", moves: ["stealthrock", "rockslide"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "rockslide")}`);

	const sim2 = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Starmie", moves: ["surf", "rapidspin"] }, { species: "Eevee", moves: ["tackle"] }, { species: "Pidgey", moves: ["tackle"] }]);
	sim2.sides[1].addSideCondition("stealthrock" as never, sim2.sides[0].active[0] as never);
	assert.equal(decide(new StrongBattleAI(5), sim2), `move ${moveIndex(sim2, "p2", 0, "rapidspin")}`);
});

scenario("campo: Tailwind com 3+ reservas; Trick Room com 2 reservas lentas; Reflect contra atacante físico", () => {
	const bench = ["Eevee", "Pidgey", "Rattata"].map(species => ({ species, moves: ["tackle"] }));
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Pidgeot", moves: ["tailwind", "hurricane"] }, ...bench]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "tailwind")}`);

	const slow = ["Shuckle", "Munchlax"].map(species => ({ species, moves: ["tackle"] }));
	const sim2 = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Bronzong", moves: ["trickroom", "gyroball"] }, ...slow]);
	assert.equal(decide(new StrongBattleAI(5), sim2), `move ${moveIndex(sim2, "p2", 0, "trickroom")}`);

	const sim3 = battle([{ species: "Machamp", moves: ["tackle"] }], [{ species: "Mrmime", moves: ["reflect", "psychic"] }, ...bench.slice(0, 2)]);
	assert.equal(decide(new StrongBattleAI(5), sim3), `move ${moveIndex(sim3, "p2", 0, "reflect")}`);
});

scenario("Belly Drum com HP cheio", () => {
	const sim = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Azumarill", moves: ["aquajet", "bellydrum"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "bellydrum")}`);
});

scenario("pivô: U-turn perde valor quando já é o mais forte e a IA não quer trocar; Soak vale 200", () => {
	const sim = battle([{ species: "Bulbasaur", moves: ["tackle"] }], [{ species: "Scizor", moves: ["uturn", "tackle"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim), `move ${moveIndex(sim, "p2", 0, "tackle")}`);
	const sim2 = battle([{ species: "Snorlax", moves: ["tackle"] }], [{ species: "Wailord", moves: ["tackle", "soak"] }]);
	assert.equal(decide(new StrongBattleAI(5), sim2), `move ${moveIndex(sim2, "p2", 0, "soak")}`);
});

scenario("troca obrigatória: a reserva com o melhor confronto", () => {
	const sim = battle([{ species: "Charizard", moves: ["flamethrower"] }],
		[{ species: "Rattata", level: 5, moves: ["tackle"] }, { species: "Venusaur", moves: ["tackle"] }, { species: "Blastoise", moves: ["surf"] }]);
	const ai = new StrongBattleAI(5);
	decide(ai, sim);
	// Um turno de verdade: o Flamethrower derruba o Rattata.
	sim.choose("p1", "move 1");
	sim.choose("p2", "move 1");
	const req = request(sim, "p2");
	assert.ok(req.forceSwitch?.[0], "troca obrigatória");
	const index = req.side.pokemon.findIndex(x => x.details.startsWith("Blastoise")) + 1;
	assert.equal(ai.choose(actorOf(sim, "p2"), req), `switch ${index}`);
});

scenario("troca voluntária: nunca no primeiro turno em campo; depois, para a reserva bem melhor", () => {
	const sim = battle([{ species: "Charizard", moves: ["flamethrower", "airslash"] }],
		[{ species: "Venusaur", moves: ["tackle", "vinewhip"] }, { species: "Blastoise", moves: ["surf", "tackle"] }]);
	const ai = new StrongBattleAI(5);
	const first = decide(ai, sim);
	assert.ok(first.startsWith("move"), `1º turno: ${first}`);
	// Como no original, só Fake Out ou o golpe aleatório do fim zeram firstTurn: forçado aqui.
	ai.activeTracker.alliedSide.activePokemon[0].firstTurn = false;
	const blastoise = request(sim, "p2").side.pokemon.findIndex(x => x.details.startsWith("Blastoise")) + 1;
	assert.equal(decide(ai, sim), `switch ${blastoise}`);
	// Preso: não troca.
	const trapped = request(sim, "p2");
	trapped.active![0].trapped = true;
	assert.ok(ai.choose(actorOf(sim, "p2"), trapped).startsWith("move"));
});

// ------------------------------------------------------------------------------------------------
// 3. Habilidade (skill 0–5).
// ------------------------------------------------------------------------------------------------
scenario("skill: 0 sempre aleatório; 3 acerta com sorteio < 60; 5 sem sorteio", () => {
	const make = () => battle([{ species: "Squirtle", moves: ["tackle"] }], [{ species: "Pikachu", moves: ["tackle", "growl", "thunderbolt"] }]);
	const sim = make();
	const tb = `move ${moveIndex(sim, "p2", 0, "thunderbolt")}`;
	// skill 0: 1º sorteio escolhe o golpe aleatório (0.0 → Tackle), 2º é o teste (0 < 0 falha).
	assert.equal(decide(new StrongBattleAI(0, sequence(0.0, 0.0)), sim), "move 1");
	// skill 3: teste com 0.55 → 55 < 60 passa → melhor golpe; com 0.65 → falha → golpe aleatório (0.34 → Growl).
	assert.equal(decide(new StrongBattleAI(3, sequence(0.34, 0.55, 0.99)), make()), tb);
	assert.equal(decide(new StrongBattleAI(3, sequence(0.34, 0.65)), make()), "move 2");
	assert.equal(decide(new StrongBattleAI(5, sequence(0.0)), make()), tb);
	assert.equal(new StrongBattleAI(9).skill, 5);
	assert.equal(new StrongBattleAI(-2).skill, 0);
	// Troca voluntária por skill: 0–2 nunca, 3 = 20%, 4 = 60%, 5 = sempre.
	assert.equal(new StrongBattleAI(2, sequence(0.01)).checkSwitchOutSkill(), false);
	assert.equal(new StrongBattleAI(3, sequence(0.2)).checkSwitchOutSkill(), true);
	assert.equal(new StrongBattleAI(3, sequence(0.21)).checkSwitchOutSkill(), false);
	assert.equal(new StrongBattleAI(4, sequence(0.6)).checkSwitchOutSkill(), true);
	assert.equal(new StrongBattleAI(5, sequence(0.999)).checkSwitchOutSkill(), true);
});

// ------------------------------------------------------------------------------------------------
// 4. Duplas: alvo que mais sofre, golpes de área sem alvo.
// ------------------------------------------------------------------------------------------------
scenario("duplas: alvo de maior dano e golpe de área", () => {
	const sim = battle([{ species: "Bulbasaur", moves: ["tackle"] }, { species: "Squirtle", moves: ["tackle"] }],
		[{ species: "Pikachu", moves: ["thunderbolt"] }, { species: "Geodude", moves: ["earthquake", "rockslide"] }], "gen9doublescustomgame");
	const choice = decide(new StrongBattleAI(5), sim);
	const [pikachu, geodude] = choice.split(", ");
	const squirtleLoc = sim.sides[1].active[0]!.getLocOf(sim.sides[0].active[1]!);
	assert.equal(pikachu, `move 1 +${squirtleLoc}`, "Thunderbolt na Squirtle");
	// Geodude: Earthquake (área, acerta o aliado Pikachu: 2× nele) perde para Rock Slide (só inimigos) → sem alvo.
	assert.equal(geodude, `move ${moveIndex(sim, "p2", 1, "rockslide")}`);
});

// ------------------------------------------------------------------------------------------------
// 5. RandomBattleAI (selvagens).
// ------------------------------------------------------------------------------------------------
scenario("RandomBattleAI: golpe usável aleatório, preferindo inimigos; troca aleatória", () => {
	const sim = battle([{ species: "Squirtle", moves: ["tackle"] }], [{ species: "Pikachu", moves: ["tackle", "growl", "thunderbolt"] }]);
	const req = request(sim, "p2");
	req.active![0].moves[0].pp = 0;
	assert.equal(new RandomBattleAI(sequence(0.0)).choose(actorOf(sim, "p2"), req), "move 2");
	req.active![0].moves.forEach(x => { x.pp = 0; });
	req.active![0].moves.push({ move: "Struggle", id: "struggle", target: "randomNormal", disabled: false } as never);
	assert.equal(new RandomBattleAI(sequence(0.0)).choose(actorOf(sim, "p2"), req), "move 4");
	const doubles = battle([{ species: "Squirtle", moves: ["tackle"] }, { species: "Eevee", moves: ["tackle"] }],
		[{ species: "Pikachu", moves: ["tackle"] }, { species: "Rattata", moves: ["tackle"] }, { species: "Pidgey", moves: ["tackle"] }], "gen9doublescustomgame");
	for (const part of new RandomBattleAI().choose(actorOf(doubles, "p2"), request(doubles, "p2")).split(", "))
		assert.match(part, /^move 1 \+[12]$/, "alvo inimigo");
});

// ------------------------------------------------------------------------------------------------
// 6. Robustez: batalhas inteiras IA × IA (simples, duplas, triplas) sem escolha inválida.
// ------------------------------------------------------------------------------------------------
scenario("100 batalhas IA × IA sem escolhas inválidas", () => {
	const pool = ["Pikachu", "Charizard", "Blastoise", "Venusaur", "Gengar", "Snorlax", "Machamp", "Alakazam", "Scizor", "Garchomp", "Togekiss",
		"Lucario", "Milotic", "Porygonz", "Spiritomb", "Azumarill", "Chansey", "Bronzong", "Starmie", "Hitmontop", "Politoed", "Shuckle"];
	const movePool = ["tackle", "thunderbolt", "flamethrower", "surf", "earthquake", "rockslide", "protect", "uturn", "voltswitch", "toxic", "willowisp",
		"thunderwave", "recover", "swordsdance", "bellydrum", "stealthrock", "rapidspin", "tailwind", "trickroom", "reflect", "lightscreen", "fakeout",
		"explosion", "sleeptalk", "rest", "raindance", "sunnyday", "haze", "soak", "outrage", "hyperbeam", "spore", "leechseed", "discharge", "heatwave",
		"followme", "helpinghand", "courtchange", "healingwish", "partingshot"];
	let seed = 7;
	const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
	const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
	const formats: [string, number][] = [["gen9customgame", 1], ["gen9doublescustomgame", 2], ["gen9customgame@@@gametype:triples", 3]];
	let invalid: string[] = [];
	let turns = 0;
	for (let i = 0; i < 100; i++) {
		const [format, perSide] = formats[i % formats.length];
		const team = () => Array.from({ length: perSide + 1 + Math.floor(rand() * 3) }, () => ({
			species: pick(pool), level: 30 + Math.floor(rand() * 50), moves: Array.from({ length: 4 }, () => pick(movePool)),
		}));
		let sim: Battle;
		try { sim = battle(team(), team(), format, [i + 1, 2, 3, 4]); }
		catch { sim = battle(team(), team(), "gen9doublescustomgame", [i + 1, 2, 3, 4]); }
		const ais = [new StrongBattleAI(Math.floor(rand() * 6)), rand() < 0.5 ? new StrongBattleAI(5) : new RandomBattleAI()];
		for (let guard = 0; guard < 400 && !sim.ended; guard++) {
			for (const [n, side] of sim.sides.entries()) {
				const req = side.activeRequest as unknown as RequestData | null;
				if (!req || (req as { wait?: boolean }).wait || side.isChoiceDone()) continue;
				const choice = ais[n].choose(actorOf(sim, side.id), req);
				if (!sim.choose(side.id, choice)) {
					invalid.push(`${format} ${side.id}: "${choice}" → ${side.choice.error}`);
					sim.choose(side.id, "default");
				}
			}
			turns++;
		}
	}
	assert.deepEqual(invalid.slice(0, 5), [], `escolhas inválidas (${invalid.length})`);
	assert.ok(turns > 500);
});

// ================================================================================================
// NPCs: behaviours, times (script / pool composta), tamanho, skin de jogador, nomes, start_battle.
// ================================================================================================
console.warn = () => { };
const aiScenarios = results.length;

class FakeBlock {
	states = new Map<string, unknown>([["cobblemon:busy", false], ["cobblemon:active", false]]);
	constructor(public typeId: string, public location: { x: number; y: number; z: number }, public dimension: FakeDimension) { }
	get permutation() {
		const states = new Map(this.states);
		const perm = { getState: (k: string) => states.get(k), withState: (k: string, v: unknown) => { states.set(k, v); return perm; }, states };
		return perm;
	}
	setPermutation(perm: { states: Map<string, unknown> }) { this.states = new Map(perm.states); }
}

class FakeDimension {
	id = "minecraft:overworld";
	commands: string[] = [];
	blocks: FakeBlock[] = [];
	entities: FakeEntity[] = [];
	runCommand(cmd: string) { this.commands.push(cmd); return { successCount: 1 }; }
	getEntities() { return this.entities; }
	getBlock(pos: { x: number; y: number; z: number }) {
		return this.blocks.find(b => b.location.x === pos.x && b.location.y === pos.y && b.location.z === pos.z);
	}
	playSound() { }
}

class FakeEntity {
	isValid = true;
	nameTag = "";
	props = new Map<string, unknown>();
	properties = new Map<string, unknown>();
	animations: string[] = [];
	events: string[] = [];
	looks: unknown[] = [];
	location = { x: 0, y: 64, z: 0 };
	constructor(public id: string, public typeId: string, public dimension: FakeDimension = new FakeDimension()) { dimension.entities.push(this); }
	getDynamicProperty(key: string) { return this.props.get(key); }
	setDynamicProperty(key: string, value?: unknown) { if (value === undefined) this.props.delete(key); else this.props.set(key, value); }
	getProperty(key: string) { return this.properties.get(key); }
	setProperty(key: string, value: unknown) { this.properties.set(key, value); }
	playAnimation(id: string) { this.animations.push(id); }
	triggerEvent(event: string) { this.events.push(event); }
	teleport(location: { x: number; y: number; z: number }) { this.location = { ...location }; }
	lookAt(location: unknown) { this.looks.push(location); }
}

class FakePlayer extends FakeEntity {
	messages: unknown[] = [];
	constructor(id: string, public name: string, dimension?: FakeDimension) { super(id, "minecraft:player", dimension); }
	sendMessage(msg: unknown) { this.messages.push(msg); }
	playSound() { }
	getComponent() { return undefined; }
}

let entityCounter = 1;
function makeNPC(cls: string, level = 10, dimension = new FakeDimension()) {
	const entity = new FakeEntity(`npc-${entityCounter++}`, "cobblemon:npc", dimension);
	entity.setDynamicProperty("npc:class", cls);
	const npc = new NPC(entity as never);
	npc.initialize(level, { random: seededRandom(5) });
	return { entity, npc };
}

// Mundo mínimo: propriedades dinâmicas e entidades por id (o mock do @minecraft/server é um coringa).
const worldProps = new Map<string, unknown>();
const serverWorld = world as unknown as Record<string, unknown>;
serverWorld.getDynamicProperty = (key: string) => worldProps.get(key);
serverWorld.setDynamicProperty = (key: string, value: unknown) => { if (value === undefined) worldProps.delete(key); else worldProps.set(key, value); };
const allEntities: FakeEntity[] = [];
serverWorld.getEntity = (id: string) => allEntities.find(x => x.id === id);
serverWorld.getAllPlayers = () => allEntities.filter(x => x instanceof FakePlayer);
serverWorld.getDimension = () => ({ getEntities: () => allEntities.filter(x => x.typeId === "cobblemon:npc") });
(system as unknown as Record<string, unknown>).runTimeout = (fn: () => void) => { fn(); return 0; };
(system as unknown as Record<string, unknown>).currentTick = 100;

scenario("behaviours: tarefas do Cobblemon → grupos vanilla e tarefas de script", () => {
	assert.deepEqual(getBehaviour("cobblemon:wanders")!.groups, ["wanders"]);
	assert.deepEqual(getBehaviour("cobblemon:looks_at_players")!.groups, ["looks_at_players"]);
	assert.deepEqual(getBehaviour("cobblemon:looks_around")!.groups, ["looks_around"]);
	assert.deepEqual(getBehaviour("cobblemon:panics")!.groups, ["panics"]);
	assert.deepEqual(getBehaviour("cobblemon:fights_melee")!.groups, ["fights_melee"]);
	assert.deepEqual(getBehaviour("cobblemon:retaliates")!.groups, ["retaliates"]);
	assert.deepEqual(getBehaviour("cobblemon:attack_hostile_mobs")!.groups, ["attack_hostile_mobs"]);
	assert.deepEqual(getBehaviour("cobblemon:floats")!.groups, ["floats"]);
	assert.deepEqual(getBehaviour("cobblemon:stationary")!.tasks, ["home"]);
	assert.deepEqual(getBehaviour("cobblemon:uses_healing_machine")!.tasks, ["heal"]);
	assert.deepEqual(getBehaviour("cobblemon:chats")!.tasks, ["look_at_speaker"]);
	assert.deepEqual(getBehaviour("cobblemon:battler")!.tasks, ["look_at_battling", "exit_battle_when_hurt"]);
	assert.ok(getBehaviour("cobblemon:battler")!.variables.some(x => x.variableName === "exit_battle_from_passive_damage"));
	assert.deepEqual(getBehaviour("cobblemon:stationary")!.variables.map(x => x.variableName), ["home_x", "home_y", "home_z", "home_radius"]);
	assert.deepEqual(getBehaviour("cobblemon:npc/chatter_npc")!.scripts, ["q.entity.set_script_interaction('cobblemon:chatter-npc-interaction')"]);
	assert.ok(getBehaviour("cobblemon:npc/auto/npc_core")!.auto);
	const editable = getEditableBehaviours().map(x => x.id);
	assert.ok(editable.includes("cobblemon:wanders") && editable.includes("cobblemon:npc/player_textured"));
	assert.ok(!editable.includes("cobblemon:npc/auto/npc_core"), "automáticos não aparecem no editor");
	assert.ok(!getBehaviourIds().some(x => x.startsWith("cobblemon:pokemon/")), "behaviours de Pokémon ficam de fora");
	// Classes: ai_test aplica "core"; kitchen_sink usa "presets" dentro de apply_behaviours, que o Cobblemon ignora.
	assert.deepEqual(getNPCClass("ai_test")!.behaviours, ["cobblemon:core"]);
	assert.deepEqual(getNPCClass("kitchen_sink")!.behaviours, []);
	assert.deepEqual(getNPCClass("standard")!.behaviours, []);
});

scenario("behaviours: NPC liga/desliga grupos, registra tarefas e soma variáveis", () => {
	const { entity, npc } = makeNPC("standard");
	assert.equal(entity.events.filter(x => x.startsWith("cobblemon:npc_b_")).length, 0, "standard: parado, como no Cobblemon");
	npc.setBehaviours(["cobblemon:wanders", "cobblemon:looks_at_players", "cobblemon:stationary"]);
	assert.ok(entity.events.includes("cobblemon:npc_b_wanders_on") && entity.events.includes("cobblemon:npc_b_looks_at_players_on"));
	assert.ok(npc.behaviourTasks.has("home"));
	assert.equal(npc.getConfig().home_radius, 2, "variável do behaviour com o padrão");
	assert.equal(npc.getConfig().challenge_cooldown, 5, "variáveis da classe continuam");
	entity.events.length = 0;
	npc.setBehaviours(["cobblemon:looks_at_players"]);
	assert.deepEqual(entity.events, ["cobblemon:npc_b_wanders_off"]);
	// Voltar para a classe.
	npc.setBehaviours(undefined);
	assert.deepEqual(npc.behaviourIds, []);
	assert.ok(entity.events.includes("cobblemon:npc_b_looks_at_players_off"));
});

scenario("behaviours de configuração: nameTag, diálogo, conversa (chatter), time configurável, escala", () => {
	const { entity, npc } = makeNPC("standard");
	const name = npc.name;
	npc.setConfigValue("name_tag_display", false);
	npc.setBehaviours(["cobblemon:name_tag_display"]);
	assert.equal(entity.nameTag, "", "nameTag escondido");
	assert.equal(npc.name, name, "o nome continua");
	npc.setConfigValue("name_tag_display", true);
	npc.applyBehaviours();
	assert.equal(entity.nameTag, name);

	npc.setBehaviours(["cobblemon:npc/dialogue_selection"]);
	assert.deepEqual(npc.interaction, { type: "dialogue", dialogue: "cobblemon:npc-example" });
	npc.setConfigValue("chat_message", "Oi!");
	npc.setBehaviours(["cobblemon:npc/chatter_npc"]);
	assert.deepEqual(npc.interaction, { type: "script", script: "cobblemon:chatter-npc-interaction" });
	const player = new FakePlayer("p-chat", "Ash", entity.dimension);
	allEntities.push(player);
	interactWithNPC(player as never, entity as never);
	assert.deepEqual(player.messages, [`${npc.name}: Oi!`]);
	// undo ao remover: volta para a interação da classe.
	npc.setBehaviours([]);
	assert.deepEqual(npc.interaction, getNPCClass("standard")!.interaction);

	npc.setConfigValue("npc_party_pokemon1", "pikachu level=7");
	npc.setConfigValue("npc_party_pokemon2", "eevee level=9");
	npc.setBehaviours(["cobblemon:party_configuration"]);
	assert.deepEqual(npc.getParty()!.map(p => [p.species, p.level]), [["pikachu", 7], ["eevee", 9]]);

	entity.events.length = 0;
	npc.setConfigValue("npc_box_width", 1);
	npc.setConfigValue("npc_box_height", 2);
	npc.setConfigValue("npc_render_scale", 1.5);
	npc.setBehaviours(["cobblemon:npc/npc_scale_configuration"]);
	assert.ok(entity.events.includes("cobblemon:npc_hitbox_w10_h20"), entity.events.join());
	assert.equal(entity.properties.get("cobblemon:npc_render_scale"), 1.5);
});

scenario("tamanho: caixa da classe × escala → grupo de colisão; escala de render", () => {
	const { entity, npc } = makeNPC("sacchi");
	assert.ok(entity.events.includes("cobblemon:npc_hitbox_reset") && entity.events.includes("cobblemon:npc_hitbox_w6_h18"));
	entity.events.length = 0;
	npc.setHitboxScale(2);
	assert.deepEqual(entity.events, ["cobblemon:npc_hitbox_reset", "cobblemon:npc_hitbox_w12_h36"]);
	assert.equal(entity.properties.get("cobblemon:npc_render_scale"), 2);
	npc.setRenderScale(0.5);
	assert.equal(entity.properties.get("cobblemon:npc_render_scale"), 1);
	assert.deepEqual(scaledHitbox({ width: 10, height: 10 }), { width: 3, height: 4 }, "limitada aos grupos gerados");
	assert.equal(hitboxKey(0.6, 1.8), "w6_h18");
});

scenario("skin de jogador: escolhida do conjunto pelo nome, estável, com model-default/model-slim", () => {
	const { entity, npc } = makeNPC("standard");
	const options = playerSkinIndices();
	assert.ok(options.some(i => NPC_SKINS[i].texture === "minecraft:textures/entity/steve") && options.some(i => NPC_SKINS[i].texture === "minecraft:textures/entity/alex"));
	npc.setPlayerTexture("Notch");
	const skin = entity.properties.get("cobblemon:npc_skin") as number;
	assert.equal(skin, playerSkinIndex("notch"), "mesmo nome, mesma skin (sem diferenciar maiúsculas)");
	assert.ok(options.includes(skin));
	assert.ok(npc.aspects.includes(NPC_SKINS[skin].model === "cobblemon:alex.geo" ? "model-slim" : "model-default"));
	const env = new MoEnvironment().withQuery("entity", npc.struct);
	assert.equal(env.eval("q.entity.set_player_texture('Notch')"), 0, "mesmo nome não recarrega");
	env.eval("q.entity.unset_player_texture()");
	assert.equal(entity.properties.get("cobblemon:npc_skin"), resolveSkin("cobblemon:standard", npc.aspects));
	assert.ok(!npc.aspects.some(x => x.startsWith("model-")));
	// Behaviour player_textured (onAdd): skin + resourceIdentifier "standard".
	npc.setConfigValue("player_texture", "Alex");
	npc.setBehaviours(["cobblemon:npc/player_textured"]);
	assert.equal(entity.properties.get("cobblemon:npc_skin"), playerSkinIndex("Alex"));
	assert.equal(npc.forcedResourceIdentifier, "cobblemon:standard");
	npc.setBehaviours([]);
	assert.equal(npc.playerTexture, undefined, "onRemove desfaz");
});

scenario("nomes: chave traduzível no chat/batalha; idioma dos nameTags é opção do mundo", () => {
	const { entity, npc } = makeNPC("sacchi");
	assert.deepEqual(npc.displayName, { translate: "npc.sacchi.name" });
	assert.equal(entity.nameTag, resolveNPCName("npc.sacchi.name", "en_US"));
	assert.equal(getNPCNameLanguage(), "en_US");
	allEntities.push(entity);
	assert.ok(setNPCNameLanguage("pt-BR"));
	assert.equal(getNPCNameLanguage(), "pt_BR");
	assert.equal(npc.name, "Professora Sacchi");
	assert.equal(entity.nameTag, "Professora Sacchi", "NPCs carregados atualizados");
	assert.equal(setNPCNameLanguage("xx_XX"), false);
	setNPCNameLanguage("en_US");
	// Nome digitado no editor vira literal.
	npc.setNameKey("Treinador Zé");
	assert.deepEqual(npc.displayName, { text: "Treinador Zé" });
});

scenario("skill do NPC sobrepõe a da classe; start_battle: nível/clone/cura", () => {
	const { npc } = makeNPC("standard");
	assert.equal(npc.skill, 5);
	npc.setSkill(2);
	assert.equal(npc.skill, 2);
	npc.setSkill(9);
	assert.equal(npc.skill, 5);
	npc.setSkill(undefined);
	assert.deepEqual(trainerTeamOptions({ setLevel: 50 }), { clone: true, setLevel: 50, heal: false });
	assert.deepEqual(trainerTeamOptions({ setLevel: -1, cloneParties: false, healFirst: true }), { clone: false, setLevel: undefined, heal: true });
	assert.deepEqual(trainerTeamOptions({ setLevel: 0 }), { clone: true, setLevel: undefined, heal: false }, "setLevel ≠ −1 implica clone");
	assert.deepEqual(trainerTeamOptions({}), { clone: false, setLevel: undefined, heal: false });
});

scenario("times: provedor script e pool composta", () => {
	(MOLANG_SCRIPTS as Record<string, string>)["cobblemon:ianpc_test_party"] =
		"q.party.add_by_properties('pikachu level=' + q.level); q.party.add_by_properties('eevee level=3'); q.party.count > 1 ? q.party.add_by_properties('rattata');";
	const scripted = provideParty(parsePartyProvider({ type: "script", script: "ianpc_test_party" })!, { level: 12 });
	assert.deepEqual(scripted.map(p => [p.species, p.level]), [["pikachu", 12], ["eevee", 3], ["rattata", 1]]);
	assert.equal(parsePartyProvider({ type: "script", script: "x" })!.isStatic, true, "script é estático por padrão");
	const missing = provideParty({ type: "script", isStatic: true, script: "cobblemon:nao_existe" }, { level: 5 });
	assert.deepEqual(missing.map(p => p.species), ["magikarp"], "script inexistente → Magikarp");

	registerPartyPool("ianpc_pool", {
		entries: [
			{ pokemon: "charmander", labels: ["starter"], weight: 10 },
			{ pokemon: "squirtle", labels: ["starter"], weight: 10, excluded: ["water_banned"] },
			{ pokemon: "pidgey level=4", labels: ["bird"], maxSelectableTimes: "1" },
			{ pokemon: "rattata", labels: ["filler"], npcLevels: "1-5", levelVariation: "2-2" },
			{ pokemon: "gyarados", labels: ["ace"], npcAspects: ["boss"], required: ["ace"] },
		],
	});
	registerPartyComposition("ianpc_comp", { slot1: ["ace", "starter"], slot2: ["bird"], slot3: ["bird", "filler"], slot4: ["water_banned", "starter"] });
	const provider = parsePartyProvider({ type: "composed_pool", pool: "ianpc_pool", composition: "ianpc_comp", minPokemon: "6", maxPokemon: "6" })!;
	const entries = formulateParty(provider, { level: 5, random: seededRandom(1) });
	// slot1: "ace" exige aspect boss → starter; slot2: pidgey (nível próprio 4); slot3: pidgey já saiu 1× → rattata (5 + 2);
	// slot4: "water_banned" exclui Squirtle e ninguém tem o rótulo → starter (Squirtle excluído pela lista) → Charmander.
	assert.equal(entries.length, 4);
	assert.ok(["charmander", "squirtle"].includes(entries[0].properties));
	assert.deepEqual(entries.slice(1).map(x => [x.properties, x.level]), [["pidgey level=4", 4], ["rattata", 7], ["charmander", 5]]);
	const boss = formulateParty(provider, { level: 5, random: seededRandom(1), aspects: ["boss"] });
	assert.equal(boss[0].properties, "gyarados", "npcAspects + required");
	const high = formulateParty(provider, { level: 50, random: seededRandom(1) });
	assert.ok(!high.some(x => x.properties === "rattata"), "npcLevels 1-5");
	const fixedA = formulateParty({ ...provider, useFixedRandom: true } as never, { level: 5, npcUuid: "abc" });
	const fixedB = formulateParty({ ...provider, useFixedRandom: true } as never, { level: 5, npcUuid: "abc" });
	assert.deepEqual(fixedA, fixedB, "useFixedRandom pelo UUID do NPC");
});

scenario("tarefas: volta para casa, máquina de cura, olhar quem fala", () => {
	const dimension = new FakeDimension();
	const { entity, npc } = makeNPC("standard", 10, dimension);
	allEntities.push(entity);
	npc.setConfigValue("home_x", 10);
	npc.setConfigValue("home_y", 64);
	npc.setConfigValue("home_z", 10);
	npc.setBehaviours(["cobblemon:stationary", "cobblemon:uses_healing_machine", "cobblemon:chats"]);
	tickNPCTasks(100);
	assert.deepEqual(entity.location, { x: 10.5, y: 64, z: 10.5 }, "longe de casa → volta");

	// Time ferido: liga o objetivo de ir até a máquina; perto de uma máquina livre, usa e cura.
	const party = npc.getParty()!;
	party[0].currentHealth = 1;
	npc.setParty(party);
	entity.events.length = 0;
	tickNPCTasks(120);
	assert.ok(entity.events.includes("cobblemon:npc_b_goes_to_healer_on"));
	const healer = new FakeBlock("cobblemon:healing_machine", { x: 11, y: 64, z: 10 }, dimension);
	dimension.blocks.push(healer);
	assert.equal(findFreeHealer(entity as never), healer as never);
	tickNPCTasks(140);
	assert.equal(npc.getParty()![0].currentHealth, npc.getParty()![0].maxHealth, "time curado");
	assert.equal(healer.states.get("cobblemon:busy"), false, "máquina liberada");
	assert.ok(entity.animations.includes("animation.cobblemon_npc.command"));
	tickNPCTasks(160);
	assert.ok(entity.events.includes("cobblemon:npc_b_goes_to_healer_off"));

	// Conversa: olha para o jogador do diálogo.
	const player = new FakePlayer("p-speak", "Misty", dimension);
	player.location = { x: 3, y: 64, z: 3 };
	allEntities.push(player);
	formHooks.show = () => new Promise(() => { });
	openNPCDialogue(npc, player as never, "cobblemon:npc-example");
	npc.setActivity("cobblemon:npc_chatting");
	tickNPCTasks(180);
	assert.deepEqual(entity.looks.at(-1), { x: 3, y: 64 + 1.62, z: 3 });
});

scenario("pedido A (jogabilidade): drops do selvagem com doPokemonLoot, método de entrega e dropAfterDeathAnimation", () => {
	const dimension = new FakeDimension() as FakeDimension & { spawned: unknown[]; spawnItem(item: unknown, location: unknown): void };
	dimension.spawned = [];
	dimension.spawnItem = (item: unknown, location: unknown) => { dimension.spawned.push(location); };
	const wild = new FakeEntity("wild-1", "cobblemon:rattata", dimension);
	wild.location = { x: 5, y: 70, z: 5 };
	const data = PokemonData.generateNewWildPokemon("rattata", { level: 5 });
	data.minecraftItem = "cobblemon:oran_berry";
	const player = new FakePlayer("killer", "Brock", dimension);
	const playerActor = { type: ActorType.PLAYER, actor: player };
	const wildActor = { type: ActorType.WILD, getSide: () => ({ getOppositeSide: () => ({ actors: [playerActor] }) }) };
	const active = { actor: wildActor, entity: wild, data } as never;
	setGameRule("doPokemonLoot", false);
	dropWildLoot(active);
	assert.equal(dimension.spawned.length, 0, "gamerule desligada: nada cai");
	setGameRule("doPokemonLoot", true);
	dropWildLoot(active);
	assert.ok(dimension.spawned.length >= 1, "item segurado cai no Pokémon (on_entity)");
	assert.deepEqual(dimension.spawned[0], { x: 5, y: 70, z: 5 });
	// Depois da animação: entrega agendada (30 ticks) no local onde a entidade estava.
	const config = getConfig() as { dropAfterDeathAnimation: boolean };
	const delays: number[] = [];
	const runTimeout = (system as unknown as Record<string, unknown>).runTimeout;
	(system as unknown as Record<string, unknown>).runTimeout = (fn: () => void, ticks: number) => { delays.push(ticks); wild.isValid = false; fn(); return 0; };
	config.dropAfterDeathAnimation = true;
	dimension.spawned.length = 0;
	dropWildLoot(active);
	config.dropAfterDeathAnimation = false;
	(system as unknown as Record<string, unknown>).runTimeout = runTimeout;
	assert.deepEqual(delays, [30]);
	assert.ok(dimension.spawned.length >= 1, "entregue mesmo com a entidade já removida");
});

scenario("diálogo: gibber da Sacchi (sons de fala por página) e /npcdelete <alvo> pelo console", () => {
	const dialogue = getDialogue("cobblemon:sacchi_interaction")!;
	assert.ok(Object.values(dialogue.speakers).some(x => x.gibber?.sounds[0] === "cobblemon:entity.npc.gibber.generic"));
	const played: { sound: string; pitch: number }[] = [];
	const player = new FakePlayer("p-gib", "Gary") as FakePlayer & { playSound(sound: string, options: { pitch: number }): void };
	player.playSound = (sound, options) => { played.push({ sound, pitch: options.pitch }); };
	const page = { gibber: dialogue.speakers.npc?.gibber ?? Object.values(dialogue.speakers).find(x => x.gibber)!.gibber, textLength: 18 } as never;
	assert.equal(playGibber(player as never, page, () => 0.5), 5, "18 caracteres / passo 4");
	assert.equal(played.length, 5);
	assert.ok(played.every(x => x.sound === "cobblemon.entity.npc.gibber.generic" && Math.abs(x.pitch - 1) < 1e-9));
	assert.equal(playGibber(player as never, { textLength: 50 } as never), 0, "sem gibber, sem som");

	const { entity } = makeNPC("standard");
	let removed = false;
	(entity as unknown as { remove(): void }).remove = () => { removed = true; };
	const out = npcDeleteEntitiesCommand([entity as never]);
	assert.ok(out.ok && removed);
	assert.equal(npcDeleteEntitiesCommand([player as never]).ok, false);
});

console.warn = originalWarn;
console.log = originalLog;
console.info(`ia-npc: ${aiScenarios} cenários de IA e ${results.length - aiScenarios} de NPC OK`);
