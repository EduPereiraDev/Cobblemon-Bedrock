// Frente batalha-minimizavel: tela da batalha minimizável com entradas reais do protocolo (player_auth_input com
// agachar/pular → playerButtonInput; input_mode "touch" → duplo toque em Pular; mob_equipment →
// playerHotbarSelectedSlotChange). O HUD é lido do título do canal B (`cbHB…`, scripts/ui/hudProtocol.ts).
// - padrão (java, sem comando nem scriptevent): a tela abre no começo; fechar minimiza (caixas esmaecidas e aviso do
//   Cobblemon pulsando no HUD, nada no actionbar); não reabre sozinha; agachar + pular reabre; batalha aberta abre o
//   turno seguinte sozinha; no toque, duplo toque em Pular reabre; o overlay do time some durante a batalha e volta;
// - /cobblemon:battleui hud: menu de golpes no HUD, cursor segue a hotbar, vitória sem outra tela;
// - /cobblemon:battleui classic: o antigo (fechar → dica no chat com a tecla).
import { arena, setupWithPokemon, spawnWild, waitForFormOrText } from "../lib/flows.mjs";

const isActionForm = (f) => f.kind === "action" && f.buttons.some((b) => b.includes("{cobblemon.port.battle.ui.bag}"));
const isMoveForm = (f) => f.kind === "action" && f.title.includes("{cobblemon.battle.ui.fight}") && f.buttons.some((b) => b.includes("{cobblemon.move."));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Offsets em bytes do título do canal B (conferidos em tests/batalha-minimizavel.test.ts: fieldOffsets(...)).
const HEAD = { min: 54, pr: 55, cur: 56 };
const MOVES_AT = 5 + 52 + 6 * 84;
const MOVE_BYTES = 40;
const byteSlice = (text, from, len) => Buffer.from(text, "utf8").subarray(from, from + len).toString("utf8").replace(/\t/g, "");
/** Cabeçalho do HUD de batalha (min/pr/cur) e ids dos golpes do menu. */
function battleHud(text) {
	return {
		min: byteSlice(text, HEAD.min, 1), pr: byteSlice(text, HEAD.pr, 1), cur: byteSlice(text, HEAD.cur, 1),
		moves: [0, 1, 2, 3].map((i) => byteSlice(text, MOVES_AT + i * MOVE_BYTES, 24)),
		tail: Buffer.from(text, "utf8").subarray(MOVES_AT + 4 * MOVE_BYTES).toString("utf8"),
	};
}
const isBattleHud = (pred) => (x) => x.startsWith("cbHB") && pred(battleHud(x));
/** Canal P (overlay do time): 1º byte do 1º espaço ('-' = escondido). */
const partyKind = (x) => x.startsWith("cbHP") ? x[5] : undefined;

/** "Tecla R" do port: agachado + pular (flags de entrada do player_auth_input, com os estados "raw" do 1.21.70+). */
async function pressSneakJump(bot) {
	const sneak = ["sneak_down", "sneaking", "sneak_current_raw"];
	bot.inputData = [...sneak, "start_sneaking", "sneak_pressed_raw"];
	await sleep(150);
	bot.inputData = sneak;
	await sleep(200);
	bot.inputData = [...sneak, "jump_down", "jumping", "start_jumping", "jump_pressed_raw", "jump_current_raw"];
	await sleep(100);
	bot.inputData = [...sneak, "jump_released_raw"];
	await sleep(100);
	bot.inputData = ["stop_sneaking", "sneak_released_raw"];
	await sleep(100);
	bot.inputData = [];
	await sleep(100);
}

/** Duplo toque em Pular (dois apertos em ~250 ms, dentro dos 10 ticks). */
async function doubleTapJump(bot) {
	for (let i = 0; i < 2; i++) {
		bot.inputData = ["jump_down", "jumping", "start_jumping", "jump_pressed_raw", "jump_current_raw"];
		await sleep(100);
		bot.inputData = ["jump_released_raw"];
		await sleep(100);
		bot.inputData = [];
		await sleep(50);
	}
	await sleep(200);
}

async function setMode(t, bot, mode) {
	const mark = bot.mark();
	await bot.command(`cobblemon:battleui ${mode}`);
	await bot.waitForText("{cobblemon.port.battle_ui.mode_set}", { since: mark.text, timeout: 10_000 });
	t.step(`/cobblemon:battleui ${mode}`);
}

/** Termina a batalha pelo menu (Lutar → 1º golpe usável) a partir de uma tela de ação aberta. */
async function finishByMenu(t, bot, form, start) {
	for (let i = 0; i < 16; i++) {
		bot.answerForm(form, "{cobblemon.battle.ui.fight}");
		const m = await bot.waitForForm(isMoveForm, { timeout: 20_000 });
		bot.answerForm(m, m.buttons.findIndex((b) => !b.includes("{gui.back}") && !b.startsWith("§8")));
		const n = await waitForFormOrText(bot, { form: isActionForm, text: "{cobblemon.battle.win}", since: start, timeout: 60_000 });
		if (n.text) {
			if (n.text.text.includes("{cobblemon.species.rattata.name}")) throw new Error("o selvagem venceu a batalha");
			return i + 1;
		}
		form = n.form;
	}
	throw new Error("a batalha não acabou em 16 turnos pelo menu");
}

export default {
	name: "batalha minimizável: padrão java (HUD integrado, tecla R, toque) + preferências hud e classic",
	timeout: 420_000,
	async run(t) {
		const bot = await t.bot("Bmin");
		await setupWithPokemon(bot, "pikachu level=30");
		await arena(bot, { dx: -40, dz: 24 });
		// Garante o padrão (sem preferência gravada de execuções anteriores).
		await setMode(t, bot, "default");

		// ---------------------------------------------------------------- PADRÃO (java)
		// Time curado antes de cada batalha: uma derrota por sorte (crítico/paralisia) não contamina a fase seguinte.
		await bot.command("kill @e[type=cobblemon:rattata,r=32]");
		await bot.command("cobblemon:healpokemon");
		await sleep(300);
		// Rattata Lv10 (Bite/Quick Attack): com Lv20 ele tem Hyper Fang e, paralisado pelo Static, Guts; crítico + Guts
		// derrubava o Pikachu Lv30 nos 2 turnos de golpe de status da fase hud (vitória legítima do selvagem, sem bug).
		let wild = await spawnWild(bot, "rattata", { level: 10, offset: "~2 ~ ~" });
		let start = bot.mark();
		bot.interact(wild);
		let form = await bot.waitForForm(isActionForm, { timeout: 30_000 });
		t.step("padrão: a tela abre sozinha no começo (sem scriptevent)");
		const hidden = await bot.waitForTitle((x) => partyKind(x) === "-", { since: start.title, timeout: 10_000 }).catch(() => undefined);
		t.assert(!!hidden, "overlay do time escondido durante a batalha (canal P vazio)");
		bot.closeForm(form);
		const minimised = await bot.waitForTitle(isBattleHud((h) => h.min === "1" && h.pr === "1"), { since: start.title, timeout: 10_000 });
		const hudMin = battleHud(minimised.text);
		t.step(`minimizado no HUD: min=${hudMin.min} pr=${hudMin.pr} aviso=${hudMin.tail}`);
		t.assert(hudMin.tail.includes("{cobblemon.battle.ui.actions_label}") && hudMin.tail.includes("{cobblemon.port.battle_ui.key.keyboard}"), "aviso do Cobblemon com a tecla na cauda do título");
		t.assert(!bot.titles.slice(start.title).some((x) => x.type.startsWith("action_bar") && x.text.includes("actions_label")), "nada no actionbar");
		t.assert(!bot.texts.slice(start.text).some((x) => x.text.includes("reopen_hint")), "sem dica no chat");
		await sleep(4000);
		t.assert(bot.forms.slice(start.form).filter(isActionForm).length === 1, "minimizado: a tela não reabre sozinha");
		let before = bot.mark();
		await pressSneakJump(bot);
		form = await bot.waitForForm(isActionForm, { since: before.form, timeout: 10_000 });
		t.step("agachar + pular reabriu a tela");
		// Aberta: escolhe um golpe; o turno seguinte abre sozinho.
		bot.answerForm(form, "{cobblemon.battle.ui.fight}");
		let moves = await bot.waitForForm(isMoveForm, { timeout: 20_000 });
		// Golpe de status para o Rattata sobreviver ao turno (Pikachu Lv30 tem Agility no espaço 2).
		const STATUS = ["agility", "growl", "tailwhip", "playnice", "thunderwave", "doubleteam", "nastyplot", "charm", "sweetkiss"];
		const weakest = moves.buttons.findIndex((b) => STATUS.some((m) => b.includes(`{cobblemon.move.${m}}`)));
		bot.answerForm(moves, weakest >= 0 ? weakest : moves.buttons.findIndex((b) => !b.includes("{gui.back}") && !b.startsWith("§8")));
		let next = await waitForFormOrText(bot, { form: isActionForm, text: "{cobblemon.battle.win}", since: start, timeout: 60_000 });
		if (next.form) {
			t.step("batalha aberta: o turno seguinte abriu sozinho");
			// Celular: minimiza de novo e reabre com duplo toque em Pular.
			bot.inputMode = "touch";
			await sleep(300);
			bot.closeForm(next.form);
			const touchPrompt = await bot.waitForTitle(isBattleHud((h) => h.min === "1" && h.pr === "1" && h.tail.includes("{cobblemon.port.battle_ui.key.touch}")), { since: before.title, timeout: 10_000 }).catch(() => undefined);
			t.assert(!!touchPrompt, "no toque o aviso cita o duplo toque em Pular");
			before = bot.mark();
			await doubleTapJump(bot);
			form = await bot.waitForForm(isActionForm, { since: before.form, timeout: 10_000 });
			t.step("toque: duplo toque em Pular reabriu a tela");
			bot.inputMode = undefined;
			const turns = await finishByMenu(t, bot, form, start);
			t.step(`vitória pelo menu (${turns} turno(s))`);
		}
		else t.warn("o Rattata caiu no 1º golpe: passos de turno seguinte/toque não rodaram");
		await bot.waitForText("{cobblemon.battle.win}", { since: start.text, timeout: 30_000 });
		const back = await bot.waitForTitle((x) => partyKind(x) && partyKind(x) !== "-", { since: start.title, timeout: 15_000 }).catch(() => undefined);
		t.assert(!!back, "overlay do time volta depois da batalha");
		t.step("padrão: vitória; overlay do time de volta");
		await bot.waitForEntityGone(wild, { timeout: 20_000 }).catch(() => t.warn("o Rattata derrotado não sumiu em 20 s"));

		// ---------------------------------------------------------------- HUD (preferência)
		await setMode(t, bot, "hud");
		// Time curado antes de cada batalha: uma derrota por sorte (crítico/paralisia) não contamina a fase seguinte.
		await bot.command("kill @e[type=cobblemon:rattata,r=32]");
		await bot.command("cobblemon:healpokemon");
		await sleep(300);
		wild = await spawnWild(bot, "rattata", { level: 10, offset: "~2 ~ ~" });
		start = bot.mark();
		bot.interact(wild);
		const first = await bot.waitForForm(isActionForm, { timeout: 30_000 });
		t.step("hud: 1º turno abre a tela (como no Java)");
		bot.closeForm(first);
		const menu = await bot.waitForTitle(isBattleHud((h) => h.pr === "3"), { since: start.title, timeout: 10_000 });
		const hudMenu = battleHud(menu.text);
		t.step(`menu no HUD: golpes=[${hudMenu.moves.join(", ")}] cursor=${hudMenu.cur} título=${hudMenu.tail}`);
		t.assert(hudMenu.moves[0] !== "" && hudMenu.tail.includes("{cobblemon.port.battle_ui.hud_title}"), "o menu do HUD lista golpes");
		let turns = 0;
		let won = false;
		while (turns < 16) {
			// Espaço 2 (golpe de status do Pikachu Lv30: Agility/Play Nice) nos 2 primeiros turnos; depois 1.
			const slot = turns < 2 ? 1 : 0;
			const moved = bot.mark();
			await bot.selectSlot(slot);
			if (turns === 0) {
				const cursor = await bot.waitForTitle(isBattleHud((h) => h.pr === "3" && h.cur === String(slot)), { since: moved.title, timeout: 5_000 }).catch(() => undefined);
				t.assert(!!cursor, "trocar o espaço da hotbar move o cursor do menu no HUD");
				t.step(`cursor no espaço ${slot + 1}`);
			}
			before = bot.mark();
			await pressSneakJump(bot);
			turns++;
			const r = await Promise.race([
				bot.waitForText("{cobblemon.battle.win}", { since: start.text, timeout: 45_000 }).then((x) => ({ win: x })),
				bot.waitForTitle(isBattleHud((h) => h.pr === "3"), { since: before.title + 1, timeout: 45_000 }).then((x) => ({ hud: x })),
			]).catch(() => ({}));
			// "{cobblemon.battle.win}(<vencedor>)": vitória do selvagem não conta.
			if (r.win) { won = !r.win.text.includes("{cobblemon.species.rattata.name}"); break; }
			if (!r.hud) throw new Error(`turno ${turns}: nem vitória nem menu do HUD depois de agachar + pular (espaço ${slot + 1})`);
			t.step(`turno ${turns}: espaço ${slot + 1} + agachar/pular → próximo menu no HUD`);
		}
		t.assert(won, "venceu escolhendo só pelo HUD");
		t.assert(turns >= 3, `vários turnos pelo HUD (foram ${turns})`);
		t.assert(bot.forms.slice(start.form).filter(isActionForm).length === 1, "nenhuma tela de ação além da 1ª");
		await bot.waitForEntityGone(wild, { timeout: 20_000 }).catch(() => t.warn("o Rattata derrotado não sumiu em 20 s"));

		// ---------------------------------------------------------------- CLASSIC (preferência)
		await setMode(t, bot, "classic");
		// Time curado antes de cada batalha: uma derrota por sorte (crítico/paralisia) não contamina a fase seguinte.
		await bot.command("kill @e[type=cobblemon:rattata,r=32]");
		await bot.command("cobblemon:healpokemon");
		await sleep(300);
		wild = await spawnWild(bot, "rattata", { level: 5, offset: "~2 ~ ~" });
		start = bot.mark();
		bot.interact(wild);
		form = await bot.waitForForm(isActionForm, { timeout: 30_000 });
		bot.closeForm(form);
		const hint = await bot.waitForText("{cobblemon.port.battle_ui.reopen_hint}", { since: start.text, timeout: 10_000 });
		t.step(`classic: fechar → dica no chat: ${hint.text.slice(0, 120)}`);
		t.assert(!bot.titles.slice(start.title).some(isBattleHudTitle((h) => h.pr !== "0" && h.pr !== "")), "classic: sem aviso no HUD");
		before = bot.mark();
		await pressSneakJump(bot);
		form = await bot.waitForForm(isActionForm, { since: before.form, timeout: 10_000 });
		await finishByMenu(t, bot, form, start);
		t.step("classic: vitória");
		await setMode(t, bot, "default");
	},
};

/** Versão para a lista de títulos (objetos { text }). */
function isBattleHudTitle(pred) {
	const test = isBattleHud(pred);
	return (x) => test(x.text);
}
