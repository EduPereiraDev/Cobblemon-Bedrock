// Item segurado só nos dados do Pokémon (docs/pendencias/item-segurado.md): sem inventário na entidade, montado o E
// não abre nada do Pokémon, e os caminhos oficiais (agachar + usar, menu "Mudar item segurado") não perdem nem
// duplicam itens. Fora da suíte normal:
//   COBBLEMON_BDS=cobblemon-bds-held COBBLEMON_BDS_PORT=19197 COBBLEMON_DIST=dist-e2e-held COBBLEMON_BDS_TRANSPORT=raknet \
//     COBBLEMON_BDS_ONLINE_MODE=false COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy --rm --verbose \
//     --scenario tests/e2e/experimental/item-segurado.e2e.mjs
//
// Estado do Pokémon: sonda `scriptevent cobblemon:md_pokemon` (log do servidor: segurado = dados, espaço0 = inventário
// legado, mostrado = item na mão secundária). Item no modelo: mob_equipment da mão secundária recebido pelo bot.
// Abrir o inventário montado: o cliente manda `interact` com action_id open_inventory (tecla E); um inventário de
// entidade (cavalo, baú do Pokémon até o beta 7) chega como container_open com o unique id da entidade.
import { arena, dismissForms, giveItem, holdItem, openParty, setupWithPokemon } from "../lib/flows.mjs";
import * as server from "../lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = () => new Date(Date.now() - 500).toISOString();

const SPECIES = "charizard";
const ITEM_A = "cobblemon:leftovers";
const ITEM_B = "cobblemon:black_belt";
const SNEAK_PRESS = ["sneak_down", "sneaking", "start_sneaking", "want_down", "sneak_pressed_raw", "sneak_current_raw"];
const SNEAK_HOLD = ["sneak_down", "sneaking", "want_down", "sneak_current_raw"];
const SNEAK_RELEASE = ["stop_sneaking", "sneak_released_raw"];

const big = (v) => { try { return BigInt(v); } catch { return undefined; } };
const same = (a, b) => a !== undefined && b !== undefined && big(a) === big(b);

export default {
	name: "item segurado: só nos dados, E montado não abre o Pokémon, dar/trocar/tirar sem perda nem duplicação",
	timeout: 900_000,
	async run(t) {
		t.console("scriptevent cobblemon:debug_probes on");
		// Mundo reaproveitado: nada de entidades de execuções anteriores.
		t.console("kill @e[type=!player]");
		const bot = await t.bot("Held");
		await setupWithPokemon(bot, `${SPECIES} level=50`);
		await dismissForms(bot, 1500);
		const base = await arena(bot, { height: 170 });
		const bx = Math.floor(base.x), bz = Math.floor(base.z), by = base.y;
		await bot.command(`fill ${bx - 10} ${by - 1} ${bz - 10} ${bx + 10} ${by - 1} ${bz + 10} glass`);
		await bot.command(`fill ${bx - 10} ${by} ${bz - 10} ${bx + 10} ${by + 8} ${bz + 10} air`);
		await bot.command(`kill @e[type=!player,r=40]`);

		// ------------------------------------------------------------------ observadores
		const containers = [];
		bot.client.on("container_open", (p) => {
			containers.push({ at: Date.now(), window: p.window_id, type: p.window_type, entity: String(p.runtime_entity_id), coords: p.coordinates });
			bot._note(`container_open window=${p.window_id} type=${p.window_type} entity=${p.runtime_entity_id}`);
			// Fecha como o cliente faria (senão o próximo pedido pode ser ignorado).
			try { bot.client.queue("container_close", { window_id: p.window_id, window_type: p.window_type, server: false }); } catch { /* ok */ }
		});
		const equipment = [];
		bot.client.on("mob_equipment", (p) => {
			equipment.push({ at: Date.now(), rid: String(p.runtime_entity_id), window: p.window_id, slot: p.slot, item: bot.itemName(p.item?.network_id) ?? (p.item?.network_id ? String(p.item.network_id) : "air") });
		});
		const links = [];
		bot.client.on("set_entity_link", (p) => {
			const l = p.link ?? p;
			const type = l.type === 0 || l.type === "remove" ? "remove" : "ride";
			links.push({ at: Date.now(), type, rider: String(l.rider_entity_id), ridden: String(l.ridden_entity_id) });
		});
		const mine = (l) => same(l.rider, bot.uniqueId) || same(l.rider, bot.runtimeId);
		const riding = () => { const last = [...links].reverse().find(mine); return !!last && last.type !== "remove"; };

		const count = (id) => bot.inventoryItems().filter((x) => x.name === id).reduce((n, x) => n + x.count, 0);
		/** Linha da sonda para o Pokémon (e itens no chão). */
		async function probe(label) {
			const iso = since();
			t.console("scriptevent cobblemon:md_pokemon");
			await sleep(1200);
			const lines = server.logSince(iso).split("\n").filter((l) => l.includes("[mundo-detalhes]")).map((l) => l.replace(/.*\[mundo-detalhes\] /, ""));
			const line = lines.find((l) => l.startsWith(`cobblemon:${SPECIES} `)) ?? "";
			const ground = lines.find((l) => l.startsWith("itens no chão:")) ?? "";
			const held = /segurado=(\S+)/.exec(line)?.[1];
			const slot0 = /espaço0=(\S+)/.exec(line)?.[1];
			const shown = /mostrado=(\S+)/.exec(line)?.[1];
			t.step(`${label}: segurado=${held} espaço0=${slot0} mostrado=${shown} | ${ground} | ${SPECIES}: ${count(ITEM_A)}×A ${count(ITEM_B)}×B`);
			return { held, slot0, shown, ground, line };
		}
		/** Último item da mão secundária que o bot viu na entidade. */
		const offhandOf = (entity) => [...equipment].reverse().find((e) => e.rid === String(entity.runtimeId) && (e.window === "offhand" || e.window === 119 || e.slot === 1))?.item;

		async function partyMenu() {
			const party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes(`{cobblemon.species.${SPECIES}.name}`));
			return bot.waitForForm((f) => !f.answered && f.title.includes(SPECIES));
		}
		async function sendOut() {
			const known = new Set(bot.findEntities((e) => e.type === `cobblemon:${SPECIES}`).map((e) => String(e.runtimeId)));
			const menu = await partyMenu();
			bot.answerForm(menu, 0); // enviar
			const entity = await bot.waitForEntity((e) => e.type === `cobblemon:${SPECIES}` && !known.has(String(e.runtimeId)), { timeout: 20_000 });
			await sleep(3500);
			await bot.command(`effect @e[type=cobblemon:${SPECIES},r=30] slowness 300 255 true`);
			return bot.entities.get(String(entity.runtimeId)) ?? entity;
		}
		async function recall(entity) {
			const menu = await partyMenu();
			bot.answerForm(menu, 0); // recolher
			await bot.waitForEntityGone(entity, { timeout: 20_000 });
			await sleep(1500);
		}
		/** Agachar + usar no Pokémon (PokemonEntity.offerHeldItem). */
		async function sneakUse(entity, textKey) {
			const mark = bot.mark();
			bot.inputData = SNEAK_PRESS; await sleep(100);
			bot.inputData = SNEAK_HOLD; await sleep(250);
			bot.interact(bot.entities.get(String(entity.runtimeId)) ?? entity);
			await sleep(700);
			bot.inputData = SNEAK_RELEASE; await sleep(100);
			bot.inputData = [];
			await bot.waitForText(textKey, { since: mark.text, timeout: 10_000 });
			await sleep(1500);
		}
		/** Menu do time → "Mudar item segurado" → botão que contém `button`. */
		async function heldMenu(button, textKey) {
			const mark = bot.mark();
			const menu = await partyMenu();
			bot.answerForm(menu, (b) => b.includes("{cobblemon.ui.interact.give.item}"));
			const held = await bot.waitForForm((f) => !f.answered && f.title.includes("{cobblemon.ui.interact.give.item}"));
			bot.answerForm(held, (b) => b.includes(button));
			await bot.waitForText(textKey, { since: mark.text, timeout: 10_000 });
			await sleep(1500);
		}
		const emptySlot = () => [...Array(9).keys()].find((s) => !bot.inventory[s]?.network_id) ?? 8;

		const fail = [];
		const check = (cond, msg) => { if (!cond) { fail.push(msg); t.step(`FALHA: ${msg}`); } };

		// ------------------------------------------------------------------ 1. dar pelo caminho oficial
		await giveItem(bot, ITEM_A, 2);
		await giveItem(bot, ITEM_B, 1);
		let entity = await sendOut();
		await holdItem(bot, ITEM_A);
		await sneakUse(entity, "{cobblemon.held_item.give}");
		let s = await probe("deu A agachado");
		check(s.held === ITEM_A, `dados sem o item dado (segurado=${s.held})`);
		check(count(ITEM_A) === 1, `A no inventário depois de dar: ${count(ITEM_A)} (esperado 1)`);
		check(s.shown === ITEM_A, `modelo não mostra o item (mostrado=${s.shown})`);
		await bot.waitUntil(() => offhandOf(entity) === ITEM_A, 10_000, "mob_equipment da mão secundária com o item").catch(() => { });
		check(offhandOf(entity) === ITEM_A, `bot não viu o item na mão secundária do ${SPECIES} (${offhandOf(entity)})`);

		// ------------------------------------------------------------------ 2. recolher e soltar
		await recall(entity);
		entity = await sendOut();
		s = await probe("recolheu e soltou");
		check(s.held === ITEM_A, `item sumiu ao recolher/soltar (segurado=${s.held})`);
		await bot.waitUntil(() => offhandOf(entity) === ITEM_A, 10_000, "item no modelo depois de soltar").catch(() => { });
		check(offhandOf(entity) === ITEM_A, `modelo sem o item depois de soltar (${offhandOf(entity)})`);

		// ------------------------------------------------------------------ 3. montado, E (open_inventory) e usar na montaria
		await bot.selectSlot(emptySlot());
		{
			const at = Date.now();
			const menu = await partyMenu();
			bot.answerForm(menu, (b) => b.includes("{cobblemon.ui.interact.ride}"));
			await bot.waitUntil(() => links.some((l) => l.at >= at && l.type !== "remove" && mine(l)), 15_000, "montar pelo menu");
			await sleep(1500);
		}
		const mountedAt = Date.now();
		const e = bot.entities.get(String(entity.runtimeId)) ?? entity;
		// Tecla E: o cliente manda interact/open_inventory. O alvo varia com a versão; tenta vazio, o jogador e a montaria.
		for (const target of [0n, big(bot.runtimeId), big(e.runtimeId)]) {
			bot.client.queue("interact", { action_id: "open_inventory", target_entity_id: target, has_position: false });
			await sleep(1500);
		}
		// Usar (clique direito) na própria montaria, montado.
		bot.interact(e);
		await sleep(1500);
		await dismissForms(bot, 300);
		const opened = containers.filter((c) => c.at >= mountedAt);
		const fromPokemon = opened.filter((c) => same(c.entity, e.uniqueId) || c.type === "horse" || c.type === 12);
		t.step(`montado=${riding()} container_open: ${opened.map((c) => `${c.type}/${c.window}/ent=${c.entity}`).join(", ") || "nenhum"} (Pokémon uid=${e.uniqueId}, jogador uid=${bot.uniqueId})`);
		check(riding(), "não ficou montado para testar o E");
		check(fromPokemon.length === 0, `montado, o inventário do Pokémon abriu: ${JSON.stringify(fromPokemon)}`);
		s = await probe("montado depois do E");
		check(s.held === ITEM_A, `item mudou montado (segurado=${s.held})`);
		check(s.slot0 === undefined || s.slot0 === "sem-inventario", `a entidade ainda tem inventário (espaço0=${s.slot0})`);
		await bot.command("ride @s stop_riding");
		await sleep(2000);
		check(!riding(), "não desmontou com /ride stop_riding");

		// ------------------------------------------------------------------ 4. tirar/dar pelo menu, trocar/tirar agachado
		await heldMenu("{cobblemon.port.held.take}", "{cobblemon.port.held.taken}");
		s = await probe("tirou pelo menu");
		check(s.held === "-", `menu não tirou (segurado=${s.held})`);
		check(count(ITEM_A) === 2, `A depois de tirar pelo menu: ${count(ITEM_A)} (esperado 2)`);
		await bot.waitUntil(() => offhandOf(entity) === "air" || offhandOf(entity) === undefined, 10_000, "modelo sem item").catch(() => { });

		await holdItem(bot, ITEM_A);
		await heldMenu("{cobblemon.port.held.give}", "{cobblemon.command.held_item}");
		s = await probe("deu A pelo menu");
		check(s.held === ITEM_A, `menu não deu (segurado=${s.held})`);
		check(count(ITEM_A) === 1, `A depois de dar pelo menu: ${count(ITEM_A)} (esperado 1)`);

		await holdItem(bot, ITEM_B);
		await sneakUse(entity, "{cobblemon.held_item.replace}");
		s = await probe("trocou A por B agachado");
		check(s.held === ITEM_B, `troca não gravou B (segurado=${s.held})`);
		check(count(ITEM_A) === 2 && count(ITEM_B) === 0, `troca: ${count(ITEM_A)}×A ${count(ITEM_B)}×B (esperado 2×A 0×B)`);

		await bot.selectSlot(emptySlot());
		await sneakUse(entity, "{cobblemon.held_item.take}");
		s = await probe("tirou B agachado");
		check(s.held === "-", `não tirou (segurado=${s.held})`);
		check(count(ITEM_A) === 2 && count(ITEM_B) === 1, `fim: ${count(ITEM_A)}×A ${count(ITEM_B)}×B (esperado 2×A 1×B)`);
		// Itens soltos perto da arena (o mundo tem os seus longe dali, ex.: apricorn caído perto do spawn).
		const near = [...s.ground.matchAll(/(\S+)x(\d+)@(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/g)]
			.filter((m) => Math.hypot(Number(m[3]) - base.x, Number(m[4]) - by, Number(m[5]) - base.z) < 20).map((m) => m[0]);
		check(near.length === 0, `item solto no chão perto da arena: ${near.join(" ")}`);

		await recall(entity).catch(() => { });
		await bot.command(`kill @e[type=!player,r=40]`);
		t.console("scriptevent cobblemon:debug_probes off");
		t.assert(fail.length === 0, fail.join("; "));
	},
};
