// Poké Ball que não captura volta a ser item (EmptyPokeBallEntity.onHitBlock/drop do Java; docs/pendencias/cliente-teste3.md):
//  1. sobrevivência, arremesso nativo no chão → aparece o item da MESMA bola (Great Ball) e o bot o pega de volta;
//  2. sobrevivência, arremesso mirando um Pokémon que não pode ser capturado (caminho do ThrowBall) → item + mensagem;
//  3. criativo, no chão → só some (nem item, nem gasta).
//
//   COBBLEMON_BDS=scr COBBLEMON_BDS_PORT=19179 COBBLEMON_DIST=dist-scr COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/bola-erra.e2e.mjs --deploy
import { arena, giveItem, holdItem, killAround, setupWithPokemon, spawnWild } from "../lib/flows.mjs";

const BALL = "cobblemon:great_ball";

/** Quantas bolas o jogador tem, pelo servidor (`clear` com máximo 0 só conta). */
async function ballCount(bot) {
	const out = await bot.command(`clear @s ${BALL} -1 0`);
	const hit = out?.output.find((o) => o.message_id === "commands.clear.testing");
	return hit ? Number(hit.parameters.at(-1)) : 0;
}

/** Repete `check` (assíncrono) até dar verdadeiro ou o tempo acabar. */
async function eventually(check, timeout) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await check()) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

/** Itens da bola vistos pelo bot perto de `p`. */
function ballItems(bot, p, radius = 8) {
	return bot.findEntities((e) => e.type === "minecraft:item" && bot.itemName(e.item?.network_id) === BALL
		&& Math.abs(e.position.x - p.x) < radius && Math.abs(e.position.z - p.z) < radius && Math.abs(e.position.y - p.y) < 4);
}

export default {
	name: "bola que erra: vira item (sobrevivência), pode ser coletada; no criativo só some",
	timeout: 300_000,
	async run(t) {
		const bot = await t.bot("Bola");
		await setupWithPokemon(bot, "pikachu level=20");
		await bot.commandOk("gamemode s @s");
		await giveItem(bot, BALL, 8);
		await holdItem(bot, BALL);
		await bot.command("kill @e[type=item,r=64]");

		// 1. Chão, arremesso nativo.
		let p = await arena(bot, { dx: 30, dz: 20 });
		const start = await ballCount(bot);
		bot.lookAt({ x: p.x, y: p.y - 1, z: p.z + 4 });
		await t.sleep(400);
		bot.useItem();
		const item = await bot.waitUntil(() => ballItems(bot, p)[0], 8000, "item da Great Ball no chão").catch(() => undefined);
		const afterThrow = await ballCount(bot);
		t.step(`chão: ${start} → ${afterThrow} bolas; item ${item ? `@${item.position.x.toFixed(1)},${item.position.y.toFixed(1)},${item.position.z.toFixed(1)}` : "NENHUM"}`);
		t.assert(item, "a bola que bateu no chão virou item da mesma bola");
		t.assert(afterThrow === start - 1 || afterThrow === start, "gastou 1 (ou o item já voltou para o inventário)");
		// Pegar de volta: anda até o item.
		await bot.teleport(item.position.x, p.y, item.position.z);
		const back = await eventually(async () => (await ballCount(bot)) === start, 10_000);
		t.step(`coleta: ${await ballCount(bot)} bolas (antes do arremesso ${start})`);
		t.assert(back, "o bot pegou a bola de volta");

		// 2. Mirando um Pokémon que não pode ser capturado (interação com a entidade → ThrowBall).
		p = await arena(bot, { dx: 30, dz: 20 });
		const wild = await spawnWild(bot, "snorlax", { level: 5, offset: "~ ~ ~3" });
		await bot.command("tag @e[type=cobblemon:snorlax,r=10] add uncatchable");
		await t.sleep(800);
		const mark2 = bot.mark();
		bot.interact(wild);
		const refused = await bot.waitForText("{cobblemon.capture.cannot_be_caught}", { since: mark2.text, timeout: 8000 }).catch(() => undefined);
		const dropped = await bot.waitUntil(() => ballItems(bot, p)[0], 8000, "item da bola recusada").catch(() => undefined);
		await t.sleep(2500);
		const afterRefused = await ballCount(bot);
		t.step(`recusada: mensagem ${refused ? "sim" : "não"}; item ${dropped ? "sim" : "não"}; ${afterRefused} bolas`);
		t.assert(refused, "mensagem de captura recusada");
		t.assert(dropped || afterRefused === start, "a bola recusada virou item (ou já foi coletada: o total voltou)");
		await killAround(bot, "cobblemon:snorlax");
		await bot.command("kill @e[type=item,r=64]");

		// 3. Criativo: só some.
		await bot.commandOk("gamemode c @s");
		p = await arena(bot, { dx: 30, dz: 20 });
		const creativeStart = await ballCount(bot);
		bot.lookAt({ x: p.x, y: p.y - 1, z: p.z + 4 });
		await t.sleep(400);
		const ballsBefore = new Set(bot.findEntities((e) => e.type === BALL).map((e) => String(e.runtimeId)));
		bot.useItem();
		const thrown = await bot.waitForEntity((e) => e.type === BALL && !ballsBefore.has(String(e.runtimeId)), { timeout: 4000 }).catch(() => undefined);
		await t.sleep(3000);
		const creativeItems = ballItems(bot, p).length;
		const creativeEnd = await ballCount(bot);
		t.step(`criativo: arremesso ${thrown ? "sim" : "não"}; ${creativeItems} item(ns); ${creativeStart} → ${creativeEnd} bolas`);
		t.assert(thrown, "a bola foi arremessada no criativo");
		t.assert(creativeItems === 0, "no criativo não cai item");
		t.assert(creativeEnd === creativeStart, "no criativo a bola não é gasta");
		await bot.commandOk("gamemode s @s");
	},
};
