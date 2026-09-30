// Telas empilhadas (docs/pendencias/telas-empilhadas.md): no cliente real, o menu do Infernape (Monferno que evoluiu
// segurando o Cabo de Ligação) apareceu desenhado por todos os layouts do roteador ao mesmo tempo (PC, resumo, inicial,
// Pokédex, diálogo, batalha). Este cenário separa as duas explicações possíveis:
//   (a) vários forms abertos de uma vez: conta, a cada modal_form_request, quantos forms ainda estão sem resposta;
//   (c) um form só, com título que o JSON UI lê como número: resolve o título pelo .lang do dist e aplica a regra do
//       parser numérico do JSON UI (prefixo "inf"/"nan"/dígito vira número; o `-`/`=` de string do roteador quebra).
// Fluxo: Monferno nv. 35 com Cabo de Ligação → batalha selvagem até subir para 36 (aviso de evolução) → menu do time
// → Evoluir → Infernape → mandar para fora → interagir de mão vazia, com a Poké Ball do time, clique repetido rápido
// e agachado. Fora da suíte normal:
//   COBBLEMON_BDS=msd2 COBBLEMON_BDS_PORT=19212 COBBLEMON_DIST=dist-e2e-ui-stack COBBLEMON_BDS_TRANSPORT=raknet \
//     COBBLEMON_BDS_ONLINE_MODE=false COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy --rm \
//     --scenario tests/e2e/experimental/telas-empilhadas.e2e.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arena, dismissForms, openParty, setupWithPokemon, spawnWild, waitForFormOrText } from "../lib/flows.mjs";
import * as server from "../lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONTROL = "cobblemon:party_control";
const SNEAK_PRESS = ["sneak_down", "sneaking", "start_sneaking", "want_down", "sneak_pressed_raw", "sneak_current_raw"];
const SNEAK_HOLD = ["sneak_down", "sneaking", "want_down", "sneak_current_raw"];
const SNEAK_RELEASE = ["stop_sneaking", "sneak_released_raw"];
const isActionForm = (f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.battle.ui.bag}"));
const isMoveForm = (f) => f.kind === "action" && f.title.includes("{cobblemon.battle.ui.fight}") && f.buttons.some((b) => b.includes("{cobblemon.move."));

/** Traduções do dist testado (o cliente resolve `translate` antes de o JSON UI ler `#title_text`). */
function loadLang() {
	const file = join(server.root, server.env.COBBLEMON_DIST, "resource_packs", "CobblemonBedrock", "texts", "pt_BR.lang");
	const map = new Map();
	if (!existsSync(file)) return map;
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const i = line.indexOf("=");
		if (i > 0 && !line.startsWith("#")) map.set(line.slice(0, i), line.slice(i + 1).replace(/\t#.*$/, ""));
	}
	return map;
}

/** Texto que o cliente mostraria para um título (rawtext/translate/with), sem cores resolvidas. */
function resolveText(value, lang) {
	if (value == null) return "";
	if (typeof value === "string") {
		const s = value.trim();
		if (s.startsWith("{")) { try { return resolveText(JSON.parse(s), lang); } catch { /* texto comum */ } }
		return value;
	}
	if (Array.isArray(value)) return value.map((v) => resolveText(v, lang)).join("");
	if (value.rawtext) return resolveText(value.rawtext, lang);
	let out = value.text ?? "";
	if (value.translate !== undefined) {
		const args = (value.with?.rawtext ?? value.with ?? []).map?.((a) => resolveText(a, lang)) ?? [];
		let n = 0;
		out += (lang.get(value.translate) ?? value.translate)
			.replace(/%(\d+)\$s/g, (_, k) => args[Number(k) - 1] ?? "")
			.replace(/%s/g, () => args[n++] ?? "");
	}
	return out;
}

/** O JSON UI lê como número uma string que um parser tipo strtod aceita no começo (inclui "inf"/"nan"). */
const numericPrefix = (s) => /^\s*[+-]?(inf|nan|\d|\.\d)/i.test(s);

export default {
	name: "telas empilhadas: menu do Infernape (um form só, título não numérico) por todos os caminhos de interação",
	timeout: 900_000,
	async run(t) {
		t.console("kill @e[type=!player]");
		const bot = await t.bot("Stack");
		const lang = loadLang();
		t.step(`traduções carregadas: ${lang.size} (Infernape = "${lang.get("cobblemon.species.infernape.name")}")`);

		// ------------------------------------------------------------------ observadores
		const overlaps = [];
		const titles = [];
		bot.client.on("modal_form_request", () => {
			// O handler do bot já registrou o form novo (registrado antes deste).
			const form = bot.forms[bot.forms.length - 1];
			const open = bot.forms.filter((f) => !f.answered);
			const shown = resolveText(form.raw?.title, lang);
			titles.push({ id: form.id, flat: form.title, shown, raw: JSON.stringify(form.raw?.title) });
			if (open.length >= 2) {
				overlaps.push({ at: Date.now(), ids: open.map((f) => `#${f.id} "${f.title}"`) });
				bot._note(`FORMS ABERTOS AO MESMO TEMPO: ${open.map((f) => `#${f.id} "${f.title}"`).join(" + ")}`);
			}
		});
		const fail = [];
		const check = (cond, msg) => { if (!cond) { fail.push(msg); t.step(`FALHA: ${msg}`); } };
		/**
		 * Fecha tudo e espera a navegação assentar: fechar o menu do Pokémon devolve à lista do time que o abriu
		 * (laço do /cobblemon:party), que também é fechada. Sem isso, o próximo comando do cenário abriria uma tela
		 * enquanto a reaberta pela navegação ainda chega (sobreposição criada pelo teste, não pelo jogo).
		 */
		async function drain() {
			for (let i = 0; i < 6; i++) {
				const pending = bot.forms.filter((f) => !f.answered);
				if (!pending.length) {
					const count = bot.forms.length;
					await sleep(1500);
					if (bot.forms.length === count) return;
					continue;
				}
				for (const f of pending) bot.closeForm(f);
				await sleep(700);
			}
		}

		await setupWithPokemon(bot, "monferno level=35 helditem=cobblemon:link_cable moves=machpunch,flamewheel ot=Outro");
		await dismissForms(bot, 1500);
		const base = await arena(bot, { dx: 40, dz: -24 });
		await bot.command(`kill @e[type=!player,r=40]`);

		// ------------------------------------------------------------------ 1. subir para 36 em batalha
		{
			const wild = await spawnWild(bot, "chansey", { level: 45, offset: "~2 ~ ~" });
			const start = bot.mark();
			bot.interact(wild);
			let form = await bot.waitForForm(isActionForm, { timeout: 30_000 });
			for (let turn = 1; ; turn++) {
				if (turn > 15) throw new Error("a batalha não acabou em 15 turnos");
				bot.answerForm(form, "{cobblemon.battle.ui.fight}");
				const moves = await bot.waitForForm(isMoveForm, { timeout: 20_000 });
				let pick = moves.buttons.findIndex((b) => b.includes("{cobblemon.move.machpunch}") && !b.startsWith("§8"));
				if (pick < 0) pick = moves.buttons.findIndex((b) => !b.includes("{gui.back}") && !b.startsWith("§8"));
				bot.answerForm(moves, pick);
				const next = await waitForFormOrText(bot, {
					form: (f) => isActionForm(f) || (!isMoveForm(f) && f.kind !== undefined),
					text: (s) => s.includes("{cobblemon.battle.win}") || s.includes("{cobblemon.battle.lose}"),
					since: start, timeout: 60_000,
				});
				if (next.text) { t.step(`fim da batalha: ${next.text.text.slice(0, 120)}`); break; }
				if (!isActionForm(next.form)) {
					// Troca forçada, aprender golpe etc.: registra e fecha (conta para a sobreposição do mesmo jeito).
					t.step(`form na batalha: "${next.form.title}" [${next.form.buttons.slice(0, 4).join(" | ")}]`);
					bot.closeForm(next.form);
					form = await bot.waitForForm(isActionForm, { timeout: 30_000 });
					continue;
				}
				form = next.form;
			}
			await sleep(4000);
			const hint = bot.texts.slice(start.text).find((x) => x.text.includes("{cobblemon.ui.evolve.hint}"));
			t.step(`aviso de evolução: ${hint ? hint.text.slice(0, 160) : "não chegou"}`);
			check(!!hint, "o Monferno não ficou pronto para evoluir depois da batalha");
			// Forms que a batalha deixou (ex.: aprender golpe no nível 36).
			for (const f of bot.forms.filter((x) => !x.answered)) t.step(`form pendente depois da batalha: "${f.title}"`);
			await drain();
			await bot.command(`kill @e[type=cobblemon:chansey,r=40]`);
		}

		// ------------------------------------------------------------------ 2. evoluir pelo menu do time
		{
			const mark = bot.mark();
			const party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes("{cobblemon.species.monferno.name}"));
			const menu = await bot.waitForForm((f) => !f.answered && f.buttons.some((b) => b.includes("{cobblemon.ui.evolve}")), { timeout: 15_000 });
			t.step(`menu do Monferno: título ${titles.find((x) => x.id === menu.id)?.raw} → "${titles.find((x) => x.id === menu.id)?.shown}"`);
			bot.answerForm(menu, (b) => b.includes("{cobblemon.ui.evolve}"));
			const evo = await bot.waitForForm((f) => !f.answered && f.title.includes("{cobblemon.ui.evolution}"), { timeout: 15_000 });
			bot.answerForm(evo, (b) => b.includes("{cobblemon.species.infernape.name}"));
			await bot.waitForText("{cobblemon.ui.evolve.into}", { since: mark.text, timeout: 30_000 });
			await sleep(1500);
			// O menu do Pokémon reabre em laço depois da ação (e a lista do time ao fechá-lo): fecha tudo.
			await drain();
			t.step("evoluiu para Infernape pelo menu");
		}

		// ------------------------------------------------------------------ 3. mandar para fora
		// Depois da batalha o Pokémon continua fora (a evolução troca o modelo no lugar): só manda se estiver na bola.
		let entity = bot.findEntities((e) => e.type === "cobblemon:infernape")[0];
		if (!entity) {
			const party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes("{cobblemon.species.infernape.name}"));
			const menu = await bot.waitForForm((f) => !f.answered && f.title.includes("{cobblemon.species.infernape.name}"), { timeout: 15_000 });
			bot.answerForm(menu, (b) => b.includes("{cobblemon.port.party.send_out}"));
			entity = await bot.waitForEntity((e) => e.type === "cobblemon:infernape", { timeout: 20_000 });
			await sleep(3500);
			await drain();
		}
		t.step(`Infernape fora da bola: rid=${entity.runtimeId}`);
		await bot.command("effect @e[type=cobblemon:infernape,r=30] slowness 300 255 true");
		await bot.teleport(Number(entity.position.x) + 2, Number(entity.position.y), Number(entity.position.z));
		await sleep(1000);
		const live = () => bot.entities.get(String(entity.runtimeId)) ?? entity;
		const emptySlot = () => [...Array(9).keys()].find((s) => !bot.inventory[s]?.network_id) ?? 8;

		/** Interage `times` vezes (intervalo `gap` ms), espera e devolve os forms que chegaram. Fecha tudo no fim. */
		async function interactAndCount(label, { times = 1, gap = 0, sneak = false } = {}) {
			const mark = bot.mark();
			const before = overlaps.length;
			if (sneak) { bot.inputData = SNEAK_PRESS; await sleep(100); bot.inputData = SNEAK_HOLD; await sleep(250); }
			for (let i = 0; i < times; i++) { bot.interact(live()); if (gap) await sleep(gap); }
			await sleep(3500);
			if (sneak) { bot.inputData = SNEAK_RELEASE; await sleep(100); bot.inputData = []; }
			const got = bot.forms.slice(mark.form);
			t.step(`${label}: ${got.length} form(s) [${got.map((f) => `${titles.find((x) => x.id === f.id)?.raw ?? f.title} → "${titles.find((x) => x.id === f.id)?.shown}"`).join(", ")}], sobreposições novas: ${overlaps.length - before}`);
			await drain();
			return got;
		}

		// ------------------------------------------------------------------ 4. interações
		await bot.selectSlot(emptySlot());
		const hand = await interactAndCount("mão vazia");
		check(hand.length === 1, `mão vazia abriu ${hand.length} forms (esperado 1)`);
		const control = bot.findSlot(bot.itemNetworkId(CONTROL));
		if (control >= 0 && control <= 8) {
			await bot.selectSlot(control);
			await interactAndCount("Poké Ball do time na mão");
			await bot.selectSlot(emptySlot());
		}
		else t.warn(`Poké Ball do time fora da hotbar (espaço ${control})`);
		await interactAndCount("clique repetido rápido (5× a cada 60 ms)", { times: 5, gap: 60 });
		await interactAndCount("clique repetido (3× a cada 400 ms)", { times: 3, gap: 400 });
		// Por último: agachado com a mão vazia tira o item segurado (troca de item, sem form).
		await interactAndCount("agachado, mão vazia", { sneak: true });

		// ------------------------------------------------------------------ 5. veredito
		const menuTitles = titles.filter((x) => x.flat.includes("{cobblemon.species.infernape.name}") || /infernape/i.test(x.shown));
		for (const x of menuTitles.slice(0, 3)) t.step(`título do menu do Infernape: ${x.raw} → mostrado "${x.shown}"`);
		const numeric = titles.filter((x) => numericPrefix(x.shown));
		check(numeric.length === 0, `títulos que o JSON UI lê como número (todos os layouts do roteador aparecem juntos): ${[...new Set(numeric.map((x) => `${x.raw} → "${x.shown}"`))].join("; ")}`);
		check(overlaps.length === 0, `forms abertos ao mesmo tempo: ${overlaps.map((o) => o.ids.join(" + ")).join("; ")}`);
		t.step(`resumo: ${titles.length} forms, ${overlaps.length} sobreposições, ${numeric.length} títulos numéricos; arena ${Math.round(base.x)},${Math.round(base.z)}`);

		await bot.command("kill @e[type=!player,r=40]");
		t.assert(fail.length === 0, fail.join("; "));
	},
};
