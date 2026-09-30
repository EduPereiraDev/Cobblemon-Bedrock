// Frente msd-fase6 (paridade do base com o Cobblemon 1.8.2, neutra para extensões):
// 1. Regra "Wild Alpha" (showdown.zip do Cobblemon: rulesets.js `wildalpha`, conditions.js `alphaboost`, pokemon.js
//    `alphaBoosts` no getStat): o Alfa selvagem recebe floor(nível / 10) + 1 estágios de alphaBoost, que multiplicam o
//    atributo sem virar estágio comum. Sem Alfa, nada muda.
// 2. HP depois da batalha cortado no máximo dos dados (Pokemon.currentHealth do Cobblemon).
// 3. Gancho "lista de golpes mostrada" sem ouvinte: nada acontece.
import assert from "node:assert/strict";
import { Battle } from "@pkmn/sim";
import { advance, advanceUntil, createPlayer, spawnWild } from "./batalhas-harness";
import { formHooks } from "./mocks/minecraft-server-ui";
import { Dex, WILD_ALPHA_RULE } from "../scripts/showdown";
import { PokemonData } from "../scripts/Pokemon";
import { startWildBattle } from "../scripts/battle";
import type { PokemonBattle } from "../scripts/battle/PokemonBattle";
import { getSimPokemon } from "../scripts/battle/SimQueries";
import { addMovesShownListener, clearMovesShownListeners, notifyMovesShown } from "../scripts/GUI/summaryExtras";

console.log = () => { };
console.info = () => { };
const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
let passed = 0;

function pokemon(species: string, level: number, moves: string[], extra: Partial<PokemonData> = {}, aspects: string[] = []) {
	const data = Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false, aspects }), extra);
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}
async function runToEnd(battle: PokemonBattle) {
	assert.ok(await advanceUntil(() => battle.ended, 600_000), `a batalha ${battle.battleId} não terminou`);
	await advance(40);
}
formHooks.show = () => ({ selection: 0, canceled: false });
type AlphaSim = { alphaBoosts?: Record<string, number>; storedStats: Record<string, number>; getStat(s: string, u?: boolean, m?: boolean): number };

// ------------------------------------------------------------------------------------------------
// 1a. Wild Alpha numa batalha selvagem do port (o BattleBuilder põe a regra; o sim a recebe no formato).
// ------------------------------------------------------------------------------------------------
{
	const lead = pokemon("machamp", 100, ["splash"], { aspects: [] });
	const player = createPlayer("Alfa", [lead]);
	const wild = pokemon("rattata", 37, ["splash"], {}, ["alpha"]);
	assert.ok(wild.aspects.includes("alpha"), "selvagem Alfa");
	const battle = startWildBattle(player as never, spawnWild(wild) as never)!;
	assert.ok(battle, "batalha criada");
	let boosts: Record<string, number> | undefined;
	let stats: { raw: number; shown: number } | undefined;
	await advanceUntil(() => {
		const sim = getSimPokemon(battle, wild.uuid) as unknown as AlphaSim & { isActive: boolean } | undefined;
		if (sim?.isActive && sim.alphaBoosts) {
			boosts = { ...sim.alphaBoosts };
			const best = (["atk", "def", "spa", "spd", "spe"] as const).find(s => (sim.alphaBoosts![s] ?? 0) > 0)!;
			stats = { raw: sim.storedStats[best], shown: sim.getStat(best, true, true) };
			const table = [1, 1.5, 2, 2.5, 3, 3.5, 4];
			assert.equal(stats.shown, Math.floor(stats.raw * table[sim.alphaBoosts[best]]), `getStat multiplica ${best} pelo alphaBoost`);
			return true;
		}
		return battle.ended;
	}, 40_000);
	await runToEnd(battle);
	// O intérprete registra as linhas no ritmo das animações: o protocolo completo só no fim.
	const log = battle.showdownMessages.join("\n");
	assert.match(log, /\|rule\|Wild Alpha: /, "mensagem da regra no início (rulesets.js)");
	assert.match(log, /\|-start\|p2a: [^|]+\|alphaboost/, "-start alphaboost no Alfa (lado 2)");
	assert.ok(boosts, "alphaBoosts no Pokémon do sim");
	const total = ["atk", "def", "spa", "spd", "spe"].reduce((sum, s) => sum + (boosts![s] ?? 0), 0);
	assert.equal(total, Math.floor(37 / 10) + 1, "floor(nível / 10) + 1 estágios");
	assert.ok(Object.values(boosts!).every(v => v >= 0 && v <= 6), "no máximo 6 por atributo");
	assert.ok(!/\|-boost\|p2a/.test(log), "o alphaBoost não é estágio comum (-boost)");
	passed++;
}

// ------------------------------------------------------------------------------------------------
// 1b. Sem Alfa: sem regra, sem alphaboost. 1c. A regra direto no sim (pool de atributos saturado: nível 100 = 11).
// ------------------------------------------------------------------------------------------------
{
	const lead = pokemon("machamp", 100, ["splash"], { aspects: [] });
	const player = createPlayer("SemAlfa", [lead]);
	const wild = pokemon("rattata", 37, ["splash"]);
	const battle = startWildBattle(player as never, spawnWild(wild) as never)!;
	await runToEnd(battle);
	const log = battle.showdownMessages.join("\n");
	assert.ok(!log.includes("Wild Alpha") && !log.includes("alphaboost"), "selvagem comum: nada de Alfa");
	const b = new Battle({ formatid: "gen9customgame" as never, seed: [1, 2, 3, 4] });
	b.setPlayer("p1", { name: "A", team: [{ species: "Snorlax", moves: ["splash"], level: 50 } as never] });
	b.setPlayer("p2", { name: "B", team: [{ species: "Snorlax", moves: ["splash"], level: 50 } as never] });
	if (b.p1.activeRequest?.teamPreview) { b.choose("p1", "team 1"); b.choose("p2", "team 1"); }
	const sim = b.p2.active[0] as unknown as AlphaSim & { addVolatile(id: string): unknown; level: number };
	(sim as { level: number }).level = 100;
	sim.addVolatile("alphaboost");
	const sum = Object.values(sim.alphaBoosts ?? {}).reduce((a, v) => a + v, 0);
	assert.equal(sum, 11, "nível 100: 11 estágios");
	assert.equal(WILD_ALPHA_RULE, "Wild Alpha");
	passed++;
}

// ------------------------------------------------------------------------------------------------
// 2. HP cortado no máximo dos dados ao sincronizar (forma de batalha com mais HP).
// ------------------------------------------------------------------------------------------------
{
	const lead = pokemon("machamp", 50, ["splash"], { aspects: [] });
	const player = createPlayer("Hp", [lead]);
	const battle = startWildBattle(player as never, spawnWild(pokemon("rattata", 5, ["splash"])) as never)!;
	let sim: { hp: number; maxhp: number } | undefined;
	await advanceUntil(() => { sim = getSimPokemon(battle, lead.uuid) as never; return !!sim || battle.ended; }, 40_000);
	assert.ok(sim, "Pokémon do jogador no sim");
	sim!.maxhp += 100;
	sim!.hp = sim!.maxhp;
	battle.syncFromSimulator();
	assert.equal(lead.currentHealth, lead.maxHealth, `HP ${lead.currentHealth} cortado no máximo ${lead.maxHealth}`);
	await runToEnd(battle);
	passed++;
}

// ------------------------------------------------------------------------------------------------
// 3. Gancho da lista de golpes.
// ------------------------------------------------------------------------------------------------
{
	const player = createPlayer("Golpes", []);
	const data = pokemon("pikachu", 50, ["tackle"]);
	assert.equal(notifyMovesShown(player as never, data), false, "sem ouvinte: nada");
	const seen: string[] = [];
	addMovesShownListener((_p, p) => { seen.push(p.species); return true; });
	addMovesShownListener(() => { throw new Error("falha do ouvinte"); });
	assert.equal(notifyMovesShown(player as never, data), true, "ouvinte que mudou");
	assert.deepEqual(seen, ["pikachu"]);
	assert.ok(warnings.some(w => w.includes("falha do ouvinte")), "erro do ouvinte vira aviso");
	clearMovesShownListeners();
	passed++;
}

formHooks.show = undefined;
process.stdout.write(`regra-alfa: ${passed} grupos de testes ok\n`);
