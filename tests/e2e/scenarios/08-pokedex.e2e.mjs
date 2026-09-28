// Pokédex: usar o item cobblemon:pokedex_red (olhando para cima, sem Pokémon na mira) abre a grade da 1ª região.
// Frente ui-polish: como o PokedexGUI, não há lista de regiões (form da vanilla): a região troca pelas setas do cabeçalho
// (POKEDEX_LIST.REGION_NEXT = 36 em scripts/GUI/layoutSpec.ts).
import { giveItem, holdItem, setupWithPokemon } from "../lib/flows.mjs";

const POKEDEX_SCREEN = "§0§5§r";
const POKEDEX_LIST = "§4§1§r";
const REGION_NEXT = 36;

export default {
	name: "Pokédex: usar o item abre a grade; a seta troca a região",
	timeout: 180_000,
	async run(t) {
		const bot = await t.bot("Dex");
		await setupWithPokemon(bot, "pikachu level=10");
		await giveItem(bot, "cobblemon:pokedex_red");
		await holdItem(bot, "cobblemon:pokedex_red");
		bot.rotation = { pitch: -89, yaw: 0 };
		await t.sleep(500);
		bot.useItem();
		const page = await bot.waitForForm((f) => f.title.includes(POKEDEX_SCREEN) && f.title.includes(POKEDEX_LIST), { timeout: 20_000 });
		t.step(`pokédex: "${page.title}" body="${page.body.slice(0, 60)}" (${page.buttons.length} botões)`);
		t.assert(page.buttons.length > 3, "página da pokédex com entradas");
		t.assert(page.buttons.some((b) => b.includes("{cobblemon.ui.pokedex.search}")), "tem busca");
		t.assert(!!page.buttons[REGION_NEXT], `seta da próxima região (${page.buttons[REGION_NEXT]})`);
		bot.answerForm(page, REGION_NEXT);
		const next = await bot.waitForForm((f) => f.kind === "action" && !f.answered && f.title.includes(POKEDEX_LIST), { timeout: 20_000 });
		t.step(`próxima região: "${next.title}" (${next.buttons.length} botões)`);
		t.assert(next.title !== page.title, `a região mudou (${page.title} → ${next.title})`);
		bot.closeForm(next);
	},
};
