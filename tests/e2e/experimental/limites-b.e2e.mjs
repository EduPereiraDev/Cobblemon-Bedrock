// Frente limites-b: evidência no BDS com jogador (bot de protocolo) do que a sonda de console não cobre:
// - pintura do Cobblemon quebrada por um jogador em sobrevivência (solta o item) e no criativo (não solta);
// - Enfermeira: a tela de trocas abre com as ofertas do Java (pacote update_trade), o clique marca "negociou" e a
//   enfermeira que negociou não perde a profissão quando a Healing Machine quebra;
// - aldeão vanilla (fazendeiro) continua abrindo as trocas vanilla com o override do villager_v2.
// Fora da suíte normal:
//   COBBLEMON_DIST=dist-limb COBBLEMON_BDS=limb COBBLEMON_BDS_PORT=19155 COBBLEMON_BDS_TRANSPORT=raknet \
//     COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/limites-b.e2e.mjs --keep --verbose
import { arena, dismissForms } from "../lib/flows.mjs";
import * as server from "../lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = () => new Date(Date.now() - 1000).toISOString();
const lines = (iso, match) => server.logSince(iso).split("\n").filter((l) => l.includes(match));
const short = (l) => l.replace(/.*\[Scripting\] /, "").replace(/.*INFO\] /, "");
const json = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? String(x) : x));

/** Nomes de item (NBT "Name") das ofertas de um update_trade. */
function offerItems(packet) {
	const out = [];
	const walk = (v) => {
		if (!v || typeof v !== "object") return;
		if (Array.isArray(v)) { v.forEach(walk); return; }
		if (v.Name && typeof v.Name === "object" && typeof v.Name.value === "string") out.push(v.Name.value);
		for (const x of Object.values(v)) walk(x);
	};
	walk(packet.offers);
	return out;
}

export default {
	name: "Limites B: pintura quebrada pelo jogador, trocas da Enfermeira e do aldeão vanilla",
	timeout: 600_000,
	async run(t) {
		t.console("scriptevent cobblemon:debug_probes on");
		const bot = await t.bot("LimB");
		await dismissForms(bot, 1500);
		const base = await arena(bot);
		const x = Math.floor(base.x), y = base.y, z = Math.floor(base.z);
		const results = {};
		const trades = [];
		bot.client.on("update_trade", (p) => trades.push(p));

		// ---------------------------------------------------------------- pintura (#30)
		await bot.command(`fill ${x - 1} ${y} ${z + 6} ${x + 1} ${y + 1} ${z + 6} stone`);
		const paintAndHit = async (mode) => {
			await bot.command(`gamemode ${mode}`);
			await bot.command(`kill @e[type=item]`);
			let iso = since();
			t.console(`scriptevent cobblemon:limb_paint ${x} ${y} ${z + 6} north slumber`);
			const painting = await bot.waitForEntity("cobblemon:painting", { timeout: 15_000 });
			t.step(`pintura (${mode}): ${lines(iso, "limb").concat(lines(iso, "paint slumber")).map(short).slice(-1).join("")}`);
			await bot.teleport(x + 0.5, y, z + 3.5);
			await sleep(600);
			bot.attack(painting);
			await bot.waitForEntityGone(painting, { timeout: 10_000 });
			await sleep(1500);
			iso = since();
			t.console(`testfor @e[type=item,x=${x - 4},y=${y - 60},z=${z},dx=8,dy=70,dz=10]`);
			await sleep(800);
			const found = lines(iso, "Found").concat(lines(iso, "No targets")).map(short);
			t.step(`pintura (${mode}) depois do golpe: ${found.join(" | ")}`);
			return found.join(" ");
		};
		results.survivalDrop = /Found Painting/.test(await paintAndHit("survival"));
		results.creativeNoDrop = /No targets/.test(await paintAndHit("creative"));
		await bot.command("gamemode creative");

		// ---------------------------------------------------------------- Enfermeira (#99/#113)
		await bot.command(`setblock ${x + 4} ${y} ${z} cobblemon:healing_machine`);
		await bot.command(`kill @e[type=villager_v2]`);
		await bot.command(`summon villager ${x + 4} ${y} ${z + 2} 0 0 minecraft:spawn_from_village`);
		await sleep(1000);
		await bot.command(`event entity @e[type=villager_v2,r=12] minecraft:become_unskilled`);
		await sleep(6000);
		let iso = since();
		t.console("scriptevent cobblemon:limb_nurse");
		await sleep(1500);
		const nurseLine = lines(iso, "aldeão").map(short);
		t.step(`enfermeira: ${nurseLine.join(" || ")}`);
		results.becameNurse = nurseLine.some((l) => l.includes("enfermeira=true") && l.includes("variant=15"));
		const villager = await bot.waitForEntity("minecraft:villager_v2", { timeout: 15_000 });
		await bot.teleport(villager.position.x, y, villager.position.z - 2);
		await sleep(800);
		trades.length = 0;
		bot.interact(villager);
		await bot.waitUntil(() => trades[0], 10_000, "update_trade da enfermeira");
		const nurseTrade = trades[0];
		const nurseItems = offerItems(nurseTrade);
		t.step(`enfermeira update_trade: display=${nurseTrade.display_name} tier=${nurseTrade.trade_tier} itens=${json(nurseItems)}`);
		results.nurseTradeTitle = nurseTrade.display_name;
		results.nurseOffersCobblemon = nurseItems.some((n) => n.startsWith("cobblemon:"));
		bot.client.queue("container_close", { window_id: nurseTrade.window_id, window_type: "trading", server: false });
		await sleep(1000);
		// Negociou (abriu as trocas) → quebrar a máquina não tira a profissão.
		await bot.command(`setblock ${x + 4} ${y} ${z} air`);
		await sleep(7000);
		iso = since();
		t.console("scriptevent cobblemon:limb_nurse");
		await sleep(1500);
		const after = lines(iso, "aldeão").map(short);
		t.step(`enfermeira sem máquina (negociou): ${after.join(" || ")}`);
		results.tradedKeepsJob = after.some((l) => l.includes("enfermeira=true") && l.includes("negociou=true") && l.includes("estação=-"));

		// ---------------------------------------------------------------- aldeão vanilla
		await bot.command(`kill @e[type=villager_v2]`);
		await bot.command(`summon villager ${x - 4} ${y} ${z + 2}`);
		await sleep(1000);
		await bot.command(`event entity @e[type=villager_v2,r=12] minecraft:become_farmer`);
		await sleep(1500);
		const farmer = await bot.waitForEntity("minecraft:villager_v2", { timeout: 15_000 });
		await bot.teleport(farmer.position.x, y, farmer.position.z - 2);
		await sleep(800);
		trades.length = 0;
		bot.interact(farmer);
		await bot.waitUntil(() => trades[0], 10_000, "update_trade do fazendeiro");
		const farmerItems = offerItems(trades[0]);
		t.step(`fazendeiro vanilla update_trade: display=${trades[0].display_name} itens=${json(farmerItems)}`);
		results.vanillaFarmerTrades = trades[0].display_name === "entity.villager.farmer" && farmerItems.some((n) => n.startsWith("minecraft:"));
		bot.client.queue("container_close", { window_id: trades[0].window_id, window_type: "trading", server: false });

		t.step(`resultado: ${json(results)}`);
		for (const [k, v] of Object.entries(results)) if (typeof v === "boolean") t.assert(v, k);
	},
};
