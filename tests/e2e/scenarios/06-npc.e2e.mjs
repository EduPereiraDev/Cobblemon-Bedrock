// NPC: /cobblemon:npcspawn cobblemon:standard + interagir → diálogo (forms) → Continuar → Cancelar.
// Também /cobblemon:opendialogue.
import { setupWithPokemon } from "../lib/flows.mjs";

export default {
	name: "NPC: npcspawn + interagir → diálogo; opendialogue",
	timeout: 240_000,
	async run(t) {
		const bot = await t.bot("Npc");
		await setupWithPokemon(bot, "pikachu level=10");
		const known = new Set(bot.findEntities((e) => e.type === "cobblemon:npc").map((e) => String(e.runtimeId)));
		const mark = bot.mark();
		await bot.command("cobblemon:npcspawn cobblemon:standard");
		await bot.waitForText("{cobblemon.port.npc.spawned}", { since: mark.text });
		const npc = await bot.waitForEntity((e) => e.type === "cobblemon:npc" && !known.has(String(e.runtimeId)));
		t.step(`npc rid=${npc.runtimeId}`);
		try {
			await t.sleep(500);
			bot.interact(npc);
			let page = await bot.waitForForm((f) => f.kind === "action" && f.id > (bot.forms[mark.form - 1]?.id ?? -1), { timeout: 20_000 });
			t.step(`diálogo: "${page.title}" body="${page.body.slice(0, 80)}" [${page.buttons.join(" | ")}]`);
			let guard = 0;
			// Avança as páginas sem escolha até chegar numa com opções.
			while (page.buttons.length === 1 && page.buttons[0].includes("{cobblemon.port.dialogue.continue}")) {
				if (++guard > 5) throw new Error("diálogo sem opções depois de 5 páginas");
				bot.answerForm(page, 0);
				page = await bot.waitForForm((f) => f.kind === "action" && !f.answered);
				t.step(`página: "${page.title}" [${page.buttons.join(" | ")}]`);
			}
			t.assert(page.buttons.length >= 2, `página de opções (${page.buttons})`);
			t.assert(page.buttons.some((b) => /Battle/.test(b)), `tem a opção de batalha (${page.buttons})`);
			bot.answerForm(page, (b) => /Cancel/.test(b));
			// Depois de cancelar não deve abrir outro form.
			await t.sleep(3000);
			const extra = bot.forms.filter((f) => !f.answered);
			t.assert(extra.length === 0, `nenhum form depois de cancelar (${extra.map((f) => f.title)})`);

			// Diálogo por comando
			await bot.command(`cobblemon:opendialogue cobblemon:example @s`);
			const d = await bot.waitForForm((f) => !f.answered, { timeout: 15_000 });
			t.step(`opendialogue: "${d.title}" [${d.buttons.join(" | ")}]`);
			t.assert(d.buttons.length >= 1, "o diálogo de exemplo tem botões");
			bot.closeForm(d);
		} finally {
			await bot.command("kill @e[type=cobblemon:npc,r=16]");
		}
	},
};
