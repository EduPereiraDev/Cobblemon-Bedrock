// Pokédex: usar o item cobblemon:pokedex_red (olhando para cima, sem Pokémon na mira) abre a lista.
import { giveItem, holdItem, setupWithPokemon } from "../lib/flows.mjs";

export default {
	name: "Pokédex: usar o item abre o form da Pokédex",
	timeout: 180_000,
	async run(t) {
		const bot = await t.bot("Dex");
		await setupWithPokemon(bot, "pikachu level=10");
		await giveItem(bot, "cobblemon:pokedex_red");
		await holdItem(bot, "cobblemon:pokedex_red");
		bot.rotation = { pitch: -89, yaw: 0 };
		await t.sleep(500);
		bot.useItem();
		const list = await bot.waitForForm((f) => f.title.includes("{item.cobblemon.pokedex_red}"), { timeout: 20_000 });
		t.step(`pokédex: body="${list.body.slice(0, 80)}" [${list.buttons.slice(0, 5).join(" | ")} …] (${list.buttons.length} botões)`);
		t.assert(list.buttons.length >= 3, "lista de pokédex com botões");
		t.assert(list.buttons.some((b) => b.includes("{cobblemon.ui.pokedex.search}")), "tem busca");
		bot.answerForm(list, 0);
		const page = await bot.waitForForm((f) => f.kind === "action" && !f.answered, { timeout: 20_000 });
		t.step(`página: "${page.title}" (${page.buttons.length} botões)`);
		t.assert(page.buttons.length > 3, "página da pokédex com entradas");
		bot.closeForm(page);
	},
};
