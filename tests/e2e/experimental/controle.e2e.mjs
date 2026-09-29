// Frente controle: item "Poké Ball do time" (cobblemon:party_control) com entradas reais do protocolo.
// - o item chega ao entrar (sem time) e a dica aparece na actionbar; usar sem time abre a escolha do inicial;
// - depois do inicial continua exatamente 1; /clear devolve; /give de outra cópia é removida;
// - soltar (Q na hotbar e drop com o inventário aberto) não tira o item do inventário e não deixa item no chão;
// - usar (em pé) → menu do time; agachado + usar → o selecionado sai e volta;
// - agachado + esquerdo no ar (player_auth_input missed_swing + animate) → a seleção cicla 1→2→3→1;
// - agachado + atacar uma vaca → próximo do time, sem dano;
// - agachado + usar mirando um selvagem → batalha com o selecionado; agachado + atacar um selvagem → batalha também.
import { arena, chooseStarter, dismissForms, givePokemon, spawnWild } from "../lib/flows.mjs";

const CONTROL = "cobblemon:party_control";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SNEAK = ["sneak_down", "sneaking", "sneak_current_raw"];
const isActionForm = (f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.battle.ui.bag}"));

async function startSneaking(bot) {
	bot.inputData = [...SNEAK, "start_sneaking", "sneak_pressed_raw"];
	await sleep(150);
	bot.inputData = SNEAK;
	await sleep(250);
}

async function stopSneaking(bot) {
	bot.inputData = ["stop_sneaking", "sneak_released_raw"];
	await sleep(150);
	bot.inputData = [];
	await sleep(250);
}

/**
 * Botão esquerdo no ar: o cliente marca missed_swing no player_auth_input e manda o animate do braço com a fonte
 * ("attack"; o BDS 1.26 converte em playerSwingStart com swingSource Attack). `legacy`: animate sem fonte (None).
 */
async function swingAir(bot, { legacy = false } = {}) {
	const base = bot.inputData ?? [];
	bot.inputData = [...base, "missed_swing"];
	bot.client.queue("animate", legacy
		? { action_id: "swing_arm", runtime_entity_id: bot.runtimeId, data: 0, has_swing_source: false }
		: { action_id: "swing_arm", runtime_entity_id: bot.runtimeId, data: 0, has_swing_source: true, swing_source: "attack" });
	await sleep(60);
	bot.inputData = base;
	await sleep(700);
}

function controlSlots(bot) {
	const id = bot.itemNetworkId(CONTROL);
	return bot.inventory.map((it, slot) => (it?.network_id === id ? slot : -1)).filter((s) => s >= 0);
}

/** Espera o inventário ter exatamente 1 item de controle (o servidor manda inventory_slot/content). */
function waitExactlyOne(bot, what, timeout = 10_000) {
	return bot.waitUntil(() => (controlSlots(bot).length === 1 ? controlSlots(bot)[0] + 1 : undefined), timeout, what).then((s) => s - 1);
}

async function holdControl(bot) {
	const slot = await waitExactlyOne(bot, "item de controle no inventário");
	if (slot > 8) throw new Error(`item de controle fora da hotbar (espaço ${slot})`);
	await bot.selectSlot(slot);
	return slot;
}

/** Q na hotbar: inventory_transaction "normal" (mão → mundo). */
function dropWithQ(bot) {
	const item = bot.heldItem();
	const empty = bot.heldItem(99);
	bot._sendTransaction({
		transaction: {
			legacy: { legacy_request_id: 0 },
			transaction_type: "normal",
			actions: [
				{ source_type: "world_interaction", flags: 0, slot: 0, old_item: empty, new_item: item },
				{ source_type: "container", window_id: "inventory", slot: bot.selectedSlot, old_item: item, new_item: empty },
			],
		},
	});
}

function selectionLine(n) {
	return (text) => text.includes(`▶ [${n}]`);
}

export default {
	name: "controle: Poké Ball do time (item de controle)",
	timeout: 420_000,
	async run(t) {
		const bot = await t.bot("Ctl");
		const id = bot.itemNetworkId(CONTROL);
		t.assert(id !== undefined, `${CONTROL} no item_registry`);

		// 1. Ao entrar, sem time: recebe o item; a dica aparece na actionbar (o item cai no espaço 1, o da mão).
		const joinSlot = await waitExactlyOne(bot, "item de controle ao entrar", 20_000);
		t.step(`item de controle ao entrar (sem time), espaço ${joinSlot}`);
		await bot.selectSlot(joinSlot);
		await bot.waitForTitle((x) => x.includes("{cobblemon.port.controle.hint."), { actionbar: true, timeout: 10_000 });
		t.step("dica dos controles na actionbar");

		// 2. Usar sem time → a escolha do inicial (fecha antes a tela automática do 1º login).
		try {
			const auto = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.starter.title}"), { timeout: 15_000 });
			bot.closeForm(auto);
		} catch { t.warn("a tela automática do inicial não abriu"); }
		await dismissForms(bot, 500);
		let mark = bot.mark();
		bot.useItem();
		const starterForm = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.starter.title}") && bot.forms.indexOf(f) >= mark.form, { timeout: 15_000 });
		t.step("usar sem time abriu a escolha do inicial");
		bot.closeForm(starterForm);
		await sleep(500);

		// 3. Inicial pelo comando → continua exatamente 1 item.
		await chooseStarter(bot, { category: "{cobblemon.starterselection.category.kanto}", species: "charmander", open: true });
		await sleep(3000);
		await waitExactlyOne(bot, "exatamente 1 item depois do inicial");
		t.step("com o inicial: exatamente 1 item de controle");
		await givePokemon(bot, "eevee level=10");
		await givePokemon(bot, "pikachu level=10");

		// 4. Rede de segurança: /clear devolve; cópia extra some.
		await bot.command(`clear @s ${CONTROL}`);
		await bot.waitUntil(() => controlSlots(bot).length === 0 ? true : undefined, 5000, "item limpo pelo /clear").catch(() => t.warn("o /clear não chegou a esvaziar antes do laço devolver"));
		await waitExactlyOne(bot, "item devolvido depois do /clear", 8000);
		t.step("/clear: o item voltou");
		await bot.command(`give @s ${CONTROL} 1`);
		await sleep(3000);
		await waitExactlyOne(bot, "cópia extra removida", 8000);
		t.assert(controlSlots(bot).length === 1, `exatamente 1 depois do /give (${controlSlots(bot)})`);
		t.step("/give de outra cópia: a extra foi removida");

		// 5. Arena plana; segurar o item.
		const feet = await arena(bot);
		await holdControl(bot);

		// 6. Soltar com Q: o item fica (ou volta na hora) e nada fica no chão.
		let dropped = 0, droppedGone = 0;
		const onAdd = (p) => { if (p.item?.network_id === id) dropped++; };
		const onRemove = () => { droppedGone++; };
		bot.client.on("add_item_entity", onAdd);
		bot.client.on("remove_entity", onRemove);
		const before = Date.now();
		dropWithQ(bot);
		await sleep(2500);
		bot.client.removeListener("add_item_entity", onAdd);
		bot.client.removeListener("remove_entity", onRemove);
		const onGround = bot.findEntities((e) => e.type === "minecraft:item" && e.item?.network_id === id);
		t.assert(onGround.length === 0, `Q: nenhum item de controle no chão (${onGround.length})`);
		await waitExactlyOne(bot, "Q: item continua no inventário", 8000);
		t.step(`Q: o item não saiu do inventário (entidade de item criada pelo BDS: ${dropped}, removidas: ${droppedGone}, ${Date.now() - before} ms)`);
		await holdControl(bot);

		// 7. Usar em pé → menu do time.
		mark = bot.mark();
		bot.lookAt({ x: feet.x, y: feet.y + 6, z: feet.z + 3 });
		await sleep(200);
		bot.useItem();
		const party = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.party}") && bot.forms.indexOf(f) >= mark.form, { timeout: 10_000 });
		t.step(`usar → menu do time (${party.buttons.length} botões)`);
		bot.closeForm(party);
		await sleep(800);

		// 8. Agachado + usar olhando o chão → o selecionado (charmander) sai; de novo → volta.
		bot.lookAt({ x: feet.x, y: feet.y - 1, z: feet.z + 3 });
		await startSneaking(bot);
		bot.useItem();
		const out = await bot.waitForEntity("cobblemon:charmander", { timeout: 15_000 });
		t.step(`agachado + usar → charmander fora (rid=${out.runtimeId})`);
		await sleep(2500);
		bot.useItem();
		await bot.waitForEntityGone(out, { timeout: 15_000 });
		t.step("agachado + usar de novo → charmander recolhido");
		await sleep(1500);

		// 9. Agachado + esquerdo no ar → 2, 3 e volta ao 1.
		bot.lookAt({ x: feet.x, y: feet.y + 6, z: feet.z + 3 });
		for (const [expected, legacy] of [[2, false], [3, false], [1, false], [2, true]]) {
			const since = bot.titles.length;
			await swingAir(bot, { legacy });
			await bot.waitForTitle(selectionLine(expected), { actionbar: true, since, timeout: 8000 });
			t.step(`agachado + esquerdo no ar${legacy ? " (animate sem fonte)" : ""} → selecionado [${expected}]`);
		}
		// Em pé, o esquerdo não troca.
		await stopSneaking(bot);
		{
			const since = bot.titles.length;
			await swingAir(bot);
			await sleep(800);
			t.assert(!bot.titles.slice(since).some((x) => x.text.includes("▶ [")), "em pé o esquerdo não troca a seleção");
			t.step("em pé + esquerdo no ar: sem troca");
		}
		await bot.command("cobblemon:selectslot 1");
		await startSneaking(bot);

		// 10. Agachado + atacar uma vaca → próximo (2), sem dano.
		await bot.command(`summon cow ${feet.x} ${feet.y} ${feet.z + 2}`);
		const cow = await bot.waitForEntity("minecraft:cow", { timeout: 10_000 });
		await bot.command(`effect @e[type=cow,r=8] slowness 60 255 true`);
		let since = bot.titles.length;
		// Sem dano: nenhum entity_event de dano (hurt) na vaca depois do golpe.
		const hurts = [];
		const onEvent = (p) => { if (String(p.runtime_entity_id) === String(cow.runtimeId) && /hurt/i.test(String(p.event_id))) hurts.push(p.event_id); };
		bot.client.on("entity_event", onEvent);
		bot.attack(cow);
		await bot.waitForTitle(selectionLine(2), { actionbar: true, since, timeout: 8000 });
		t.step("agachado + atacar a vaca → selecionado [2]");
		await sleep(1000);
		bot.client.removeListener("entity_event", onEvent);
		t.assert(hurts.length === 0, `a vaca não levou dano (${hurts.join(",")})`);
		t.step("a vaca não levou dano");
		await bot.command(`kill @e[type=cow,r=16]`);
		await sleep(800);

		// Volta a seleção para o 1 (charmander) com o comando e larga o agachar.
		await bot.command("cobblemon:selectslot 1");
		await stopSneaking(bot);

		// 11. Agachado + usar mirando um selvagem → batalha com o selecionado.
		const wild = await spawnWild(bot, "rattata", { level: 2, offset: "~ ~ ~3" });
		await startSneaking(bot);
		mark = bot.mark();
		bot.interact(wild);
		const battleForm = await bot.waitForForm((f) => isActionForm(f) && bot.forms.indexOf(f) >= mark.form, { timeout: 20_000 });
		t.step("agachado + usar no selvagem → batalha (tela de ação)");
		const lead = bot.findEntities((e) => e.type === "cobblemon:charmander");
		t.assert(lead.length > 0, "o selecionado (charmander) entrou em campo");
		bot.closeForm(battleForm);
		await sleep(500);
		await bot.command("cobblemon:stopbattle");
		await sleep(2000);
		await bot.command("kill @e[type=cobblemon:rattata,r=16]");
		await sleep(1000);

		// 12. Agachado + atacar um selvagem → batalha também (sem dano).
		const wild2 = await spawnWild(bot, "rattata", { level: 2, offset: "~ ~ ~3" });
		mark = bot.mark();
		since = bot.titles.length;
		bot.attack(wild2);
		const second = await bot.waitForForm((f) => isActionForm(f) && bot.forms.indexOf(f) >= mark.form, { timeout: 20_000 });
		t.step("agachado + atacar o selvagem → batalha");
		const cycled = bot.titles.slice(since).some((x) => x.text.includes("▶ [2]"));
		t.assert(!cycled, "atacar o selvagem não trocou a seleção");
		bot.closeForm(second);
		await sleep(500);
		await bot.command("cobblemon:stopbattle");
		await stopSneaking(bot);
		await waitExactlyOne(bot, "exatamente 1 item no fim");
		// Limpeza: nada do cenário fica no mundo (selvagens, drops da vaca, Pokémon fora).
		await sleep(1500);
		await bot.command("kill @e[type=cobblemon:rattata,r=32]");
		await bot.command("kill @e[type=item,r=32]");
		await bot.command("kill @e[type=cobblemon:charmander,r=32]");
	},
};
