// Livro de boas-vindas (scripts/welcomeBook.ts) com um cliente de protocolo:
// - na 1ª entrada o livro escrito chega no espaço da mão e a Poké Ball do time fica em outro espaço;
// - o livro assinado leva título/autor (NBT) e as páginas com as chaves cobblemon.livro.*;
// - soltar com Q tira o livro do inventário (item comum, sem trava) e ele não volta;
// - entrar de novo com o mesmo jogador não entrega outro livro.
import { Bot } from "../lib/bot.mjs";

const BOOK = "minecraft:written_book";
const CONTROL = "cobblemon:party_control";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slotsOf(bot, identifier) {
	const id = bot.itemNetworkId(identifier);
	return bot.inventory.map((it, slot) => (it?.network_id === id ? slot : -1)).filter((s) => s >= 0);
}

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

export default {
	name: "livro de boas-vindas: na mão na 1ª entrada, dropável, uma vez só",
	timeout: 300_000,
	async run(t) {
		// O mundo do BDS de teste é reaproveitado: livros soltos de rodadas anteriores seriam recolhidos no spawn.
		try { t.console("kill @e[type=item]"); } catch { /* servidor ainda subindo: sem itens */ }
		const bot = await t.bot("Livro");
		t.console("kill @e[type=item]");
		const bookId = bot.itemNetworkId(BOOK);
		t.assert(bookId !== undefined, `${BOOK} no item_registry`);

		// 1. Livro no espaço da mão; Poké Ball do time em outro espaço.
		const bookSlot = await bot.waitUntil(() => { const s = slotsOf(bot, BOOK); return s.length ? s[0] + 1 : undefined; }, 20_000, "livro no inventário").then((s) => s - 1);
		await bot.waitUntil(() => (slotsOf(bot, CONTROL).length === 1 ? true : undefined), 20_000, "item de controle");
		t.assert(slotsOf(bot, BOOK).length === 1, `exatamente 1 livro (${slotsOf(bot, BOOK)})`);
		t.assert(bookSlot === bot.selectedSlot, `livro no espaço da mão (livro ${bookSlot}, mão ${bot.selectedSlot})`);
		t.assert(slotsOf(bot, CONTROL)[0] !== bookSlot, "Poké Ball do time em outro espaço");
		t.step(`livro na mão (espaço ${bookSlot}); Poké Ball do time no espaço ${slotsOf(bot, CONTROL)[0]}`);

		// 2. NBT do livro assinado.
		const nbt = JSON.stringify(bot.heldItem(bookSlot).extra ?? {});
		for (const needle of ["Cobblemon BE", "EduPereiraDev", "cobblemon.livro.autor", "cobblemon.livro.memoria", "cobblemon.livro.repo"]) {
			t.assert(nbt.includes(needle), `NBT do livro contém "${needle}" (${nbt.slice(0, 400)})`);
		}
		t.step("livro assinado: título, autor e as 2 páginas traduzíveis");

		// 3. Soltar com Q: o livro sai (item comum, sem a trava do item de controle) e vira entidade no chão. Parado em
		// cima dele, o jogador o recolhe de volta em ~1 s (comportamento vanilla): apagamos a entidade logo que ela
		// aparece. A prova de que saiu mesmo (e não é entregue de novo) é o inventário do servidor ao entrar de novo.
		let bookEntity;
		bot.client.on("add_item_entity", (p) => { if (p.item?.network_id === bookId) bookEntity = p.entity_id_self; });
		await bot.selectSlot(bookSlot);
		dropWithQ(bot);
		bot.inventory[bookSlot] = undefined;
		await bot.waitUntil(() => (bookEntity !== undefined ? true : undefined), 8000, "livro no chão");
		t.console(`kill @e[type=item]`);
		t.step("Q: o livro caiu no chão");
		await sleep(2000);

		// 4. Entrar de novo: sem livro novo. Marcador: 5 terras. Se elas somem, o BDS não guardou os dados do jogador
		// (bot offline sem xuid): é um jogador novo e receber o livro de novo é o esperado.
		await bot.commandOk("give @s dirt 5");
		await sleep(1000);
		const name = bot.name;
		await bot.close();
		await sleep(3000);
		const again = await Bot.connect(name, { spawnTimeout: 120_000 });
		t.bots.push(again);
		await again.queryPosition({ timeout: 45_000 });
		const persisted = slotsOf(again, "minecraft:dirt").length > 0;
		const atLogin = slotsOf(again, BOOK).length > 0;
		await again.waitUntil(() => (slotsOf(again, CONTROL).length === 1 ? true : undefined), 20_000, "item de controle na volta");
		await sleep(4000);
		if (!persisted) {
			t.warn(`o BDS não guardou os dados do jogador entre conexões (terra sumiu; livro de novo: ${slotsOf(again, BOOK).length > 0}): "uma vez só" não verificável neste ambiente`);
			t.step("entrar de novo: ambiente sem persistência do jogador (ver aviso)");
			return;
		}
		t.assert(!atLogin && slotsOf(again, BOOK).length === 0, `nenhum livro ao entrar de novo: nem devolvido nem repetido (no inventário do login: ${atLogin}; espaços ${slotsOf(again, BOOK)}; inventário ${again.inventory.map((it, i) => it?.network_id ? `${i}:${again.itemName(it.network_id)}` : "").filter(Boolean).join(" ")})`);
		t.step("entrar de novo: sem livro (o dropado não voltou e não veio outro)");
	},
};
