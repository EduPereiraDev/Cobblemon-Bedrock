// Onde o Pokémon aparece ao ser mandado para fora (raycastSafeSendout do Java, scripts/pokemon/SendOutTarget.ts):
// - mirando o chão a ~5 blocos: aparece lá (com a bola voando: entidade _dummy), nunca no pé do jogador;
// - olhando o horizonte: aparece no chão à frente, sob a linha da mira;
// - grama baixa em cima do bloco mirado não atrapalha (antes caía no pé do jogador);
// - mirando o céu: não sai e avisa na actionbar;
// - mirando um selvagem para batalhar: o Pokémon sai com a bola, à frente, e a batalha começa.
import { arena, dismissForms, givePokemon, setupWithPokemon, spawnWild } from "../lib/flows.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

async function sendOutAndWhere(t, bot, species, what) {
	const t0 = Date.now();
	let dummy = false;
	const onAdd = (p) => { if (String(p.entity_type ?? "").endsWith("_dummy")) dummy = true; };
	bot.client.on("add_entity", onAdd);
	await bot.command("cobblemon:sendout 1");
	const entity = await bot.waitForEntity((e) => e.type === `cobblemon:${species}` && e.at >= t0, { timeout: 10_000 }).catch(() => undefined);
	bot.client.off("add_entity", onAdd);
	return { entity, dummy };
}

async function recall(bot, species) {
	await bot.command("cobblemon:sendout 1");
	await bot.waitUntil(() => ([...bot.entities.values()].some((e) => e.type === `cobblemon:${species}`) ? undefined : true), 8000, `${species} recolhido`).catch(() => undefined);
	await sleep(1500);
}

export default {
	name: "envio: o Pokémon aparece onde a mira aponta, nunca no pé do jogador",
	timeout: 360_000,
	async run(t) {
		t.console("kill @e[type=item]");
		const bot = await t.bot("Envio");
		await setupWithPokemon(bot, "pikachu level=20");
		await dismissForms(bot, 500);
		const feet = await arena(bot);
		const species = "pikachu";

		// 1. Mirando o chão a ~5 blocos à frente (z+).
		bot.rotation = { pitch: Math.atan2(1.62, 5) * 180 / Math.PI, yaw: 0 };
		await sleep(600);
		let r = await sendOutAndWhere(t, bot, species, "chão");
		t.assert(r.entity, "saiu mirando o chão");
		t.assert(dist2(r.entity.position, feet) > 3, `longe do pé (${dist2(r.entity.position, feet).toFixed(2)} blocos)`);
		t.assert(Math.abs(r.entity.position.y - feet.y) < 0.6, `no chão da arena (y ${r.entity.position.y.toFixed(2)})`);
		t.assert(r.dummy, "a bola voou (entidade _dummy)");
		t.step(`mirando o chão: a ${dist2(r.entity.position, feet).toFixed(1)} blocos, com a bola`);
		await recall(bot, species);

		// 2. Olhando o horizonte: chão à frente, sob a linha da mira.
		bot.rotation = { pitch: 0, yaw: 0 };
		await sleep(600);
		r = await sendOutAndWhere(t, bot, species, "horizonte");
		t.assert(r.entity, "saiu olhando o horizonte");
		t.assert(dist2(r.entity.position, feet) >= 2.5, `à frente (${dist2(r.entity.position, feet).toFixed(2)} blocos)`);
		t.step(`olhando o horizonte: a ${dist2(r.entity.position, feet).toFixed(1)} blocos`);
		await recall(bot, species);

		// 3. Grama baixa em cima do bloco mirado (terra com grama a 5 blocos).
		const gx = Math.floor(feet.x), gz = Math.floor(feet.z) + 5, gy = feet.y - 1;
		await bot.command(`fill ${gx - 1} ${gy} ${gz - 1} ${gx + 1} ${gy} ${gz + 1} grass_block`);
		await bot.command(`fill ${gx - 1} ${gy + 1} ${gz - 1} ${gx + 1} ${gy + 1} ${gz + 1} short_grass`);
		bot.rotation = { pitch: Math.atan2(1.62, 5) * 180 / Math.PI, yaw: 0 };
		await sleep(600);
		r = await sendOutAndWhere(t, bot, species, "grama");
		t.assert(r.entity, "saiu mirando a grama");
		t.assert(dist2(r.entity.position, feet) > 3, `na grama, longe do pé (${dist2(r.entity.position, feet).toFixed(2)} blocos)`);
		t.step(`grama baixa: a ${dist2(r.entity.position, feet).toFixed(1)} blocos`);
		await recall(bot, species);
		await bot.command(`fill ${gx - 1} ${gy} ${gz - 1} ${gx + 1} ${gy + 1} ${gz + 1} air`);
		await bot.command(`fill ${gx - 1} ${gy} ${gz - 1} ${gx + 1} ${gy} ${gz + 1} glass`);

		// 4. Mirando o céu: não sai; aviso na actionbar.
		bot.rotation = { pitch: -80, yaw: 0 };
		await sleep(600);
		const since = bot.mark();
		await bot.command("cobblemon:sendout 1");
		await bot.waitForTitle((x) => x.includes("{cobblemon.port.sendout.no_space}"), { actionbar: true, since: since.title, timeout: 8000 });
		await sleep(1500);
		t.assert(![...bot.entities.values()].some((e) => e.type === `cobblemon:${species}`), "mirando o céu não saiu");
		t.step("mirando o céu: não saiu e avisou");

		// 5. Mirando um selvagem com o 2º do time selecionado: ele sai com a bola à frente e a batalha começa com ele.
		await givePokemon(bot, "eevee level=20");
		const wild = await spawnWild(bot, "rattata", { level: 3, offset: "~ ~ ~6" });
		bot.lookAt({ x: wild.position.x, y: wild.position.y + 0.3, z: wild.position.z });
		await sleep(600);
		const t0 = Date.now();
		let dummy = false;
		const onAdd = (p) => { if (String(p.entity_type ?? "").endsWith("_dummy")) dummy = true; };
		bot.client.on("add_entity", onAdd);
		await bot.command("cobblemon:sendout 2");
		const eevee = await bot.waitForEntity((e) => e.type === "cobblemon:eevee" && e.at >= t0, { timeout: 10_000 }).catch(() => undefined);
		bot.client.off("add_entity", onAdd);
		t.assert(eevee, "o selecionado (Eevee, 2º do time) saiu para a batalha");
		t.assert(dist2(eevee.position, feet) > 1.5, `não no pé do jogador (${dist2(eevee.position, feet).toFixed(2)} blocos)`);
		t.assert(dummy, "a bola voou (entidade _dummy)");
		const battleForm = await bot.waitForForm((f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.battle.ui.bag}")), { timeout: 20_000 }).catch(() => undefined);
		t.assert(battleForm, "a batalha começou (tela de ações)");
		t.assert(!bot.findEntities((e) => e.type === `cobblemon:${species}` && e.at >= t0).length, "o 1º do time (Pikachu) não entrou");
		t.step(`selvagem: Eevee (2º do time) saiu a ${dist2(eevee.position, feet).toFixed(1)} blocos com a bola e a batalha começou`);
	},
};
