// Fluxos reutilizáveis do add-on (sequências de forms) para os cenários.
import { E2EError } from "./bot.mjs";

/** Abre o menu do time e devolve o form. */
export async function openParty(bot) {
	const mark = bot.mark();
	await bot.command("cobblemon:party");
	return bot.waitForForm((f) => f.title.includes("{cobblemon.ui.party}") && bot.forms.indexOf(f) >= mark.form);
}

/**
 * Membros do time a partir do form do /cobblemon:party: a espécie vem da chave
 * {cobblemon.species.<id>.name} do botão (o ícone muda de caminho conforme os retratos gerados).
 */
export function partyMembers(form) {
	const out = [];
	form.buttons.forEach((text, i) => {
		const m = /\{cobblemon\.species\.([a-z0-9_]+)\.name\}/.exec(text ?? "");
		if (m) out.push({ index: i, species: m[1], text });
	});
	return out;
}

/**
 * Espécies nos 30 espaços de uma tela de caixa do PC (botões 6–35: depois dos 6 de navegação).
 * O layout novo acrescenta depois o time e um painel de detalhes, que não contam.
 */
export function boxMembers(form) {
	return partyMembers(form).filter((m) => m.index >= 6 && m.index < 36);
}

/**
 * Escolhe um inicial pelos forms (espera a tela automática ou abre com /cobblemon:starter).
 * Funciona com os dois layouts da tela: categorias → lista → confirmação, e a tela única da frente
 * "telas" (categorias + carrossel + "Eu escolho você!" na mesma tela, depois a confirmação).
 * @returns os forms vistos (para asserts do cenário).
 */
export async function chooseStarter(bot, { category = "{cobblemon.starterselection.category.kanto}", species = "bulbasaur", open = false } = {}) {
	if (open) await bot.command("cobblemon:starter");
	const seen = [];
	const name = `{cobblemon.species.${species}.name}`;
	let pickedCategory = false;
	for (let step = 0; step < 12; step++) {
		const form = await bot.waitForForm((f) => f.title.includes("{cobblemon.ui.starter.title}"), { timeout: step === 0 ? 30_000 : 15_000 });
		seen.push(form);
		if (form.kind === "message") {
			bot.answerForm(form, 1); // button2 = "Eu escolho você!"
			return seen;
		}
		// O botão com o nome da espécie (sem as setas do carrossel) escolhe; senão entra na categoria.
		const choose = form.buttons.findIndex((b) => b.includes(name) && !/[◀▶]/.test(b));
		if (choose >= 0 && pickedCategory) { bot.answerForm(form, choose); continue; }
		const cat = form.buttons.findIndex((b) => b.includes(category));
		if (cat >= 0 && !pickedCategory) { pickedCategory = true; bot.answerForm(form, cat); continue; }
		if (choose >= 0) { bot.answerForm(form, choose); continue; }
		// Carrossel: avança até a espécie aparecer.
		const next = form.buttons.findIndex((b) => b.includes("▶"));
		if (next >= 0) { bot.answerForm(form, next); continue; }
		throw new E2EError(`tela de iniciais sem ${category}/${name}: [${form.buttons.join(" | ")}]`);
	}
	throw new E2EError("a escolha do inicial não chegou à confirmação em 12 telas");
}

/** Fecha qualquer form pendente (ex.: a tela de iniciais automática quando o cenário não a quer). */
export async function dismissForms(bot, ms = 0) {
	if (ms) await new Promise((r) => setTimeout(r, ms));
	for (const f of bot.forms) if (!f.answered) bot.closeForm(f);
}

export function expect(cond, msg) {
	if (!cond) throw new E2EError(`asserção falhou: ${msg}`);
}

/**
 * Deixa o bot pronto para um cenário que não testa o inicial: dá um Pokémon por comando
 * (o que também impede a tela automática de iniciais) e fecha a tela se ela já tiver aberto.
 */
export async function setupWithPokemon(bot, properties = "pikachu level=20") {
	const mark = bot.mark();
	await bot.command(`cobblemon:givepokemon "${properties}"`);
	await bot.waitForText("{cobblemon.command.givepokemon.give}", { since: mark.text, timeout: 30_000 });
	// A tela automática abre 100 ticks após o spawn se o time estiver vazio; com Pokémon ela não abre,
	// mas pode já ter aberto antes do comando.
	await dismissForms(bot);
}

/** Dá mais Pokémon (sem mexer nos forms). */
export async function givePokemon(bot, properties) {
	const mark = bot.mark();
	await bot.command(`cobblemon:givepokemon "${properties}"`);
	await bot.waitForText("{cobblemon.command.givepokemon.give}", { since: mark.text, timeout: 30_000 });
}

/**
 * Cria um Pokémon selvagem perto do bot e devolve a entidade (vista pelo bot).
 * `offset` é relativo ao jogador (coordenadas ~). O Pokémon fica parado (lentidão máxima).
 */
export async function spawnWild(bot, species, { level = 5, offset = "~2 ~ ~", freeze = true } = {}) {
	const known = new Set(bot.findEntities((e) => e.type === `cobblemon:${species}`).map((e) => String(e.runtimeId)));
	const mark = bot.mark();
	const out = await bot.command(`cobblemon:spawnpokemon ${species} ${level} false ${offset}`);
	if (out && !out.success) throw new E2EError(`spawnpokemon falhou: ${JSON.stringify(out.output)}`);
	const entity = await bot.waitForEntity((e) => e.type === `cobblemon:${species}` && !known.has(String(e.runtimeId)), { timeout: 15_000 });
	if (freeze) await bot.command(`effect @e[type=cobblemon:${species},r=8] slowness 120 255 true`);
	void mark;
	return entity;
}

/** Remove entidades de um tipo em volta do bot (limpeza entre cenários). */
export async function killAround(bot, type, radius = 32) {
	await bot.command(`kill @e[type=${type},r=${radius}]`);
}

/** Dá um item pelo /give e espera ele chegar no inventário; devolve o espaço. */
export async function giveItem(bot, identifier, count = 1) {
	await bot.commandOk(`give @s ${identifier} ${count}`);
	const id = bot.itemNetworkId(identifier);
	if (id === undefined) throw new E2EError(`item ${identifier} não está no item_registry do servidor`);
	return bot.waitUntil(() => { const s = bot.findSlot(id); return s >= 0 ? { slot: s } : undefined; }, 10_000, `item ${identifier} no inventário`).then((r) => r.slot);
}

/** Segura o item (precisa estar na hotbar, espaços 0–8). */
export async function holdItem(bot, identifier) {
	const id = bot.itemNetworkId(identifier);
	const slot = bot.findSlot(id);
	if (slot < 0 || slot > 8) throw new E2EError(`${identifier} não está na hotbar (espaço ${slot})`);
	await bot.selectSlot(slot);
	return slot;
}

/**
 * Espera o primeiro de vários eventos: { form: matcher de form } e/ou { text: matcher de texto }.
 * Devolve { form } ou { text }.
 */
export function waitForFormOrText(bot, { form, text, since = bot.mark(), timeout = 20_000 }) {
	const textTest = typeof text === "function" ? text : text instanceof RegExp ? (s) => text.test(s) : text ? (s) => s.includes(text) : undefined;
	return bot.waitUntil(() => {
		if (textTest) {
			const t = bot.texts.slice(since.text).find((x) => textTest(x.text));
			if (t) return { text: t };
		}
		if (form) {
			const f = bot.forms.find((x) => !x.answered && form(x));
			if (f) return { form: f };
		}
		return undefined;
	}, timeout, "form ou texto");
}

/**
 * Leva o bot para uma plataforma plana no alto (acima do spawn), longe do relevo e dos Pokémon
 * naturais: arremessos e interações ficam previsíveis. Devolve a posição dos pés.
 */
export async function arena(bot, { height = 170, dx = 40, dz = 0 } = {}) {
	// Relativa ao spawn do mundo (bot.anchor, posta pelo runner) e deslocada dele: uma plataforma em cima do
	// ponto de spawn vira o "chão" onde os próximos jogadores nascem. Dentro da ticking area (±64 blocos),
	// senão o /fill falha com chunk descarregado.
	const p = bot.anchor ?? await bot.queryPosition();
	const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz, y = height;
	await bot.command(`fill ${x - 6} ${y} ${z - 6} ${x + 6} ${y + 5} ${z + 8} air`);
	await bot.command(`fill ${x - 6} ${y - 1} ${z - 6} ${x + 6} ${y - 1} ${z + 8} glass`);
	await bot.teleport(x + 0.5, y, z + 0.5);
	bot.rotation = { pitch: 0, yaw: 0 };
	return { x: x + 0.5, y, z: z + 0.5 };
}
