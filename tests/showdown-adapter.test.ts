// Teste do adaptador de batalha (scripts/showdown.ts) rodando no Node, sem Minecraft.
// Uso: npm test
import assert from "node:assert/strict";
import { BattleStream, getPlayerStreams } from "../scripts/showdown";

const mon = (uuid: string, species: string, extra: Record<string, unknown> = {}) => ({
	name: "", uuid, species, level: 20, ability: "static", item: "", nature: "hardy", gender: "",
	moves: ["tackle", "thundershock"], movesInfo: [{ pp: 3, maxPp: 35 }, { pp: 30, maxPp: 30 }],
	evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
	...extra,
});

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "66666666-7777-8888-9999-000000000000";

async function run(gameType: string, team1?: object[], team2?: object[]) {
	const stream = new BattleStream();
	const streams = getPlayerStreams(stream);
	const log: string[] = [];
	const done = (async () => { for await (const chunk of streams.omniscient) log.push(chunk); })();
	for (const side of [streams.p1, streams.p2]) {
		(async () => { for await (const c of side) if (c.startsWith("|request|") && !c.includes('"wait":true')) side.write("default"); })();
	}
	streams.omniscient.write(`>start {"format":{"gameType":"${gameType}","gen":9}}`);
	let requests = 0;
	streams.omniscient.write(`>player p1 ${JSON.stringify({ name: "A", team: team1 ?? [mon(UUID_A, "pikachu", { currentHealth: 7, status: "par" }), mon("aaaaaaaa-0000-0000-0000-000000000000", "eevee")] })}`);
	streams.omniscient.write(`>player p2 ${JSON.stringify({ name: "B", team: team2 ?? [mon(UUID_B, "eevee"), mon("bbbbbbbb-0000-0000-0000-000000000000", "pikachu")] })}`);
	await done;
	return { log: log.join("\n"), battle: stream.battle! };
}

const singles = await run("singles");
assert.match(singles.log, new RegExp(`\\|switch\\|p1a: ${UUID_A}\\|Pikachu, L20(, [MF])?\\|7\\/\\d+ par`), "switch-in deve usar o UUID completo e HP/status persistentes");
assert.match(singles.log, /\|win\|/, "a batalha deve terminar");
assert.doesNotMatch(singles.log, /\|teampreview/, "sem Team Preview, como no Cobblemon");
const pika = singles.battle.sides[0].pokemon.find((p) => (p.set as any).uuid === UUID_A)!;
assert.equal(pika.baseMoveSlots[0].maxpp, 35);
assert.ok(pika.moveSlots[0].pp <= 3, "PP persistente aplicado");

const doubles = await run("doubles");
assert.equal(doubles.battle.gameType, "doubles");
assert.match(doubles.log, /\|gametype\|doubles/);
// Time com Pokémon desmaiado (em qualquer posição): a batalha tem que terminar e o desmaiado não entra.
for (const order of ["first", "second"]) {
	const fainted = mon("dddddddd-0000-0000-0000-000000000000", "pikachu", { currentHealth: 0 });
	const alive = mon("eeeeeeee-0000-0000-0000-000000000000", "eevee", { level: 5 });
	const team1 = order === "first" ? [fainted, alive] : [alive, fainted];
	const result = await run("singles", team1, [mon("ffffffff-0000-0000-0000-000000000000", "mewtwo", { level: 100, moves: ["psychic"], movesInfo: [{ pp: 10, maxPp: 10 }] })]);
	assert.match(result.log, /\|win\|B/, `time com desmaiado (${order}) deve perder e encerrar`);
	assert.doesNotMatch(result.log, /\|switch\|p1a: dddddddd/, "desmaiado não pode entrar em campo");
}

// Itens da mochila (`useitem`, formato do fork do Cobblemon) e `skip` (vez perdida ao arremessar Poké Bola).
{
	const stream = new BattleStream();
	const log: string[] = [];
	(async () => { for await (const chunk of stream) log.push(chunk); })();
	const weak = (uuid: string, species: string) => mon(uuid, species, { level: 2, moves: ["growl"], movesInfo: [{ pp: 40, maxPp: 40 }] });
	stream.write(`>start {"format":{"gameType":"doubles","gen":9}}`);
	stream.write(`>player p1 ${JSON.stringify({ name: "A", team: [mon("a1", "pikachu", { currentHealth: 10, status: "par" }), mon("a2", "eevee"), mon("a3", "eevee", { currentHealth: 0 })] })}`);
	stream.write(`>player p2 ${JSON.stringify({ name: "B", team: [weak("b1", "eevee"), weak("b2", "pikachu")] })}`);
	const turn = async (p1: string) => { stream.write(`>p1 ${p1}`); stream.write(`>p2 move 1, move 1`); await new Promise(r => setTimeout(r, 5)); };
	await new Promise(r => setTimeout(r, 5));
	await turn("useitem a1 item.cobblemon.potion potion 20, useitem a3 item.cobblemon.revive revive 0.5");
	await turn("useitem a1 item.cobblemon.full_heal cure_status par, useitem a2 item.cobblemon.x_attack x_stat atk 2");
	await turn("skip, useitem a2 item.cobblemon.max_ether ether tackle");
	const text = log.join("\n");
	assert.match(text, /\|bagitem\|a1\|item\.cobblemon\.potion/);
	assert.match(text, /\|-heal\|p1a: a1\|30\/\d+ par\|\[from\] bagitempotion/, "Poção cura 20 PS");
	assert.match(text, /\|-heal\|p1: a3\|\d+\/\d+\|\[from\] bagitemrevive/, "Reviver funciona no banco");
	assert.match(text, /\|-curestatus\|p1a: a1\|par/);
	assert.match(text, /\|-boost\|p1b: a2\|atk\|2/);
	assert.doesNotMatch(text, /\|error\|/, "escolhas com useitem/skip aceitas");
	const battle = stream.battle!;
	assert.equal(battle.sides[0].pokemon.find(p => p.name === "a3")!.fainted, false);
	assert.equal(battle.turn, 4, "três turnos jogados");
}
console.log("ok: adaptador de batalha (singles, doubles, time com desmaiado, itens da mochila e skip)");
