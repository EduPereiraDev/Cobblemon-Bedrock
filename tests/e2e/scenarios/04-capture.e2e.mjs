// Captura: jogar uma Master Ball (usar item no ar mirando) num Pokémon selvagem → capturado e no time.
//
// Bug conhecido E2E-3 (docs/pendencias/e2e.md): em algumas posições a entidade da bola leva dano depois de
// pousar (hurt_animation a cada ~0,5 s), morre após a 1ª sacudida e a captura aborta sem mensagem.
//   E2E_KNOWN_BUGS=1   repete a captura mais 3 vezes (o bug é intermitente; falha enquanto não for corrigido)
//   E2E_WORKAROUNDS=1  dá resistência à bola logo após o acerto (contorna o bug)
import { arena, giveItem, holdItem, killAround, openParty, partyMembers, setupWithPokemon, spawnWild } from "../lib/flows.mjs";

/** Uma tentativa completa de captura na plataforma `where`. Devolve o texto do resultado (ou undefined). */
async function captureAt(t, bot, where) {
	await arena(bot, where);
	// Pokémon grande (hitbox fácil de acertar), parado a 3 blocos na frente (+Z).
	const wild = await spawnWild(bot, "snorlax", { level: 5, offset: "~ ~ ~3" });
	t.step(`snorlax selvagem rid=${wild.runtimeId} @${JSON.stringify(wild.position)} (plataforma ${JSON.stringify(where)})`);
	await t.sleep(1000);

	// Dano na bola durante a sequência (diagnóstico do E2E-3).
	let ballHurts = 0;
	const onEvent = (p) => {
		const e = bot.entities.get(String(p.runtime_entity_id));
		if (e?.type === "cobblemon:master_ball" && p.event_id === "hurt_animation") ballHurts++;
	};
	bot.client.on("entity_event", onEvent);
	// Linha do tempo da sequência pelos sons da bola (hit, open, recall, shut, bounce, shake, capture...).
	const sounds = [];
	const t0 = Date.now();
	const onSound = (p) => { if (/poke_ball|ball/.test(p.name)) sounds.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${p.name.replace(/^.*\./, "")}`); };
	bot.client.on("play_sound", onSound);
	const mark = bot.mark();
	let result;
	try {
		for (let attempt = 1; attempt <= 4 && !result; attempt++) {
			bot.lookAt({ x: wild.position.x, y: wild.position.y + 1, z: wild.position.z });
			await t.sleep(300); // a rotação nova chega no próximo player_auth_input
			const before = new Set(bot.findEntities((e) => e.type === "cobblemon:master_ball").map((e) => String(e.runtimeId)));
			bot.useItem();
			const thrown = await bot.waitForEntity((e) => e.type === "cobblemon:master_ball" && !before.has(String(e.runtimeId)), { timeout: 3000 }).catch(() => undefined);
			t.step(`arremesso ${attempt}: ${thrown ? "bola lançada" : "nenhuma bola apareceu"}`);
			if (!thrown) continue;
			if (process.env.E2E_WORKAROUNDS === "1") {
				await t.sleep(800);
				await bot.command("effect @e[type=cobblemon:master_ball,r=10] resistance 30 255 true");
			}
			result = await bot.waitForText(/\{cobblemon\.capture\.(succeeded|broke_free|not_wild|cannot_be_caught|busy|you_in_battle)\}/, { since: mark.text, timeout: 20_000 }).catch(() => undefined);
		}
	} finally {
		bot.client.off("entity_event", onEvent);
		bot.client.off("play_sound", onSound);
		await killAround(bot, "cobblemon:snorlax");
	}
	t.step(`resultado: ${result?.text ?? "nenhuma mensagem"}; dano na bola: ${ballHurts} hurt_animation; sons: ${sounds.join(", ")}`);
	return result;
}

export default {
	name: "captura: Poké Ball (Master Ball) num selvagem → vai para o time",
	timeout: 300_000,
	async run(t) {
		const bot = await t.bot("Capture");
		await setupWithPokemon(bot, "pikachu level=20");
		const slot = await giveItem(bot, "cobblemon:master_ball", 16);
		t.step(`master ball no espaço ${slot}`);
		await holdItem(bot, "cobblemon:master_ball");

		const result = await captureAt(t, bot, { dx: 40, dz: -24 });
		t.assert(result, "a captura terminou com mensagem (sucesso ou escapou) em até 4 arremessos — veja E2E-3 em docs/pendencias/e2e.md");
		t.assert(result.text.includes("{cobblemon.capture.succeeded}"), `Master Ball captura sempre (${result.text})`);

		let party = await openParty(bot);
		let members = partyMembers(party).map((m) => m.species);
		t.step(`time: ${members.join(", ")}`);
		t.assert(members.includes("snorlax"), "snorlax entrou no time");
		bot.closeForm(party);

		if (process.env.E2E_KNOWN_BUGS === "1") {
			// E2E-3 é intermitente: repete a captura mais 3 vezes e exige sucesso em todas.
			for (let i = 1; i <= 3; i++) {
				const again = await captureAt(t, bot, { dx: 40, dz: -24 });
				t.assert(again?.text.includes("{cobblemon.capture.succeeded}"), `E2E-3: captura ${i + 1}/4 também completa (${again?.text ?? "nenhuma mensagem"})`);
			}
		}
	},
};
