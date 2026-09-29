// Frente ball-hit, "afundando no chão (beta 7)": a bola da sequência de captura não pode ficar dentro do chão
// (docs/pendencias/ball-hit.md). Relato do cliente real: com a beta 7 a bola, ao acertar o Pokémon, entra no chão na
// animação de captura (qualquer bola).
//
// O bot arremessa (sobrevivência) numa plataforma de vidro e acompanha pelos pacotes a entidade que faz a animação:
//  1. Master Ball num Snorlax → captura; a animação é da `cobblemon:master_ball_dummy` (add_entity depois do acerto);
//     a posição dela durante as sacudidas fica em cima do bloco (y ≥ topo); nenhum item de bola no chão; gastou 1;
//  2. Poké Ball num Mewtwo nível 100 (taxa 3) → escapa (repete se capturar); mesma checagem da dummy e do chão; depois
//     do escape a bola some sem item (igual à beta 6/7: breakFree + discard), o Mewtwo volta e gastou 1.
// Também registra os `set_entity_motion` da entidade da animação (o cliente só simula física de quem tem velocidade).
//
//   COBBLEMON_BDS=bola COBBLEMON_BDS_PORT=19196 COBBLEMON_DIST=dist-e2e-bola COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false COBBLEMON_MSD=0 node tools/e2e/run.mjs --scenario tests/e2e/experimental/bola-chao.e2e.mjs --deploy --verbose
//
//   BOLA_CHAO_BASELINE=1   só mede (sem as asserções da dummy), para registrar o "antes"
import { arena, giveItem, holdItem, killAround, setupWithPokemon, spawnWild } from "../lib/flows.mjs";

const BALL_TYPE = /^cobblemon:[a-z_]*ball(_dummy)?$/;
const baseline = process.env.BOLA_CHAO_BASELINE === "1";

/** Quantas bolas `item` o jogador tem, pelo servidor (`clear` com máximo 0 só conta). */
async function itemCount(bot, item) {
	const out = await bot.command(`clear @s ${item} -1 0`);
	const hit = out?.output.find((o) => o.message_id === "commands.clear.testing");
	return hit ? Number(hit.parameters.at(-1)) : 0;
}

/** Itens de bola (qualquer uma) vistos pelo bot perto de `p`. */
function ballItems(bot, p, radius = 10) {
	return bot.findEntities((e) => e.type === "minecraft:item" && /ball$/.test(bot.itemName(e.item?.network_id) ?? "")
		&& Math.abs(e.position.x - p.x) < radius && Math.abs(e.position.z - p.z) < radius && Math.abs(e.position.y - p.y) < 6);
}

const fmt = (v) => `${v.x.toFixed(2)},${v.y.toFixed(3)},${v.z.toFixed(2)}`;

/** Limpa o que sobrou de rodadas anteriores (o mundo do BDS de teste é reaproveitado). */
async function cleanup(bot) {
	await bot.command("kill @e[type=item,r=96]");
	await bot.command("kill @e[family=pokeball,r=96]");
	await bot.command("kill @e[family=pokeball_dummy,r=96]");
	await killAround(bot, "cobblemon:snorlax", 96);
	await killAround(bot, "cobblemon:mewtwo", 96);
}

/**
 * Acompanha pelos pacotes as entidades de bola (add/move/motion/remove) e os sons da bola.
 * @returns { stop(), balls: Map<rid, info>, sounds: [{t, name, pos}] }
 */
function watchBalls(bot) {
	const t0 = Date.now();
	const balls = new Map();
	const sounds = [];
	const now = () => Date.now() - t0;
	const onAdd = (p) => {
		if (!BALL_TYPE.test(p.entity_type)) return;
		balls.set(String(p.runtime_id), { type: p.entity_type, added: now(), addPos: { ...p.position }, positions: [{ t: now(), ...p.position }], motions: [], removed: undefined, scale: scaleOf(p.metadata) });
	};
	const onData = (p) => {
		const b = balls.get(String(p.runtime_entity_id));
		const scale = scaleOf(p.metadata);
		if (b && scale !== undefined) b.scale = scale;
	};
	const onMove = (p) => {
		const b = balls.get(String(p.runtime_entity_id));
		if (!b) return;
		const last = b.positions.at(-1);
		b.positions.push({ t: now(), x: p.position?.x ?? p.x ?? last.x, y: p.position?.y ?? p.y ?? last.y, z: p.position?.z ?? p.z ?? last.z });
	};
	const onMotion = (p) => {
		const b = balls.get(String(p.runtime_entity_id));
		if (b) b.motions.push({ t: now(), ...p.velocity });
	};
	const onRemove = (p) => {
		for (const [rid, b] of balls) {
			const e = bot.entities.get(rid);
			if (!e && b.removed === undefined) b.removed = now();
		}
		void p;
	};
	const onSound = (p) => { if (/poke_ball/.test(p.name)) sounds.push({ t: now(), name: p.name.replace(/^cobblemon\.poke_ball\.?/, ""), pos: p.coordinates }); };
	bot.client.on("add_entity", onAdd);
	bot.client.on("move_entity", onMove);
	bot.client.on("move_entity_delta", onMove);
	bot.client.on("set_entity_motion", onMotion);
	bot.client.on("remove_entity", onRemove);
	bot.client.on("play_sound", onSound);
	bot.client.on("set_entity_data", onData);
	return {
		balls, sounds, now,
		stop() {
			bot.client.off("add_entity", onAdd);
			bot.client.off("move_entity", onMove);
			bot.client.off("move_entity_delta", onMove);
			bot.client.off("set_entity_motion", onMotion);
			bot.client.off("remove_entity", onRemove);
			bot.client.off("play_sound", onSound);
			bot.client.off("set_entity_data", onData);
		},
	};
}

/** Escala (metadado `scale` do ator) num add_entity/set_entity_data. */
function scaleOf(metadata) {
	const entry = Array.isArray(metadata) ? metadata.find((m) => m.key === "scale") : undefined;
	return typeof entry?.value === "number" ? entry.value : undefined;
}

/** Posição conhecida da bola no instante `t` (último pacote até ali). */
function positionAt(ball, t) {
	let pos;
	for (const p of ball.positions) { if (p.t <= t) pos = p; else break; }
	return pos;
}

/**
 * Uma tentativa: arremessa `item` no Pokémon, espera o resultado e devolve a análise dos pacotes.
 */
async function throwAt(t, bot, { item, species, level, where }) {
	const p = await arena(bot, where);
	const wild = await spawnWild(bot, species, { level, offset: "~ ~ ~3" });
	await t.sleep(1000);
	const itemId = item;
	const before = await itemCount(bot, itemId);
	const watch = watchBalls(bot);
	const mark = bot.mark();
	let result;
	try {
		for (let attempt = 1; attempt <= 3 && !result; attempt++) {
			bot.lookAt({ x: wild.position.x, y: wild.position.y + 1, z: wild.position.z });
			await t.sleep(300);
			bot.useItem();
			result = await bot.waitForText(/\{cobblemon\.capture\.(succeeded|broke_free|not_wild|cannot_be_caught|busy|you_in_battle)\}/, { since: mark.text, timeout: 25_000 }).catch(() => undefined);
		}
		// O fim da sequência (bola some; no escape, 0,5 s depois do break).
		await t.sleep(3000);
	} finally {
		watch.stop();
	}
	const tEnd = watch.now();
	const after = await itemCount(bot, itemId);
	const items = ballItems(bot, p);
	const thrown = [...watch.balls.values()].filter((b) => !b.type.endsWith("_dummy"));
	const dummies = [...watch.balls.values()].filter((b) => b.type.endsWith("_dummy"));
	// Quem faz a animação: a entidade de bola mais perto de cada som de sacudida/quique.
	const groundSounds = watch.sounds.filter((s) => /^(shake|bounce|shake\.critical|break|capture_succeeded)/.test(s.name));
	const animators = new Set();
	const samples = [];
	for (const s of groundSounds) {
		let best;
		for (const b of watch.balls.values()) {
			const pos = positionAt(b, s.t);
			if (!pos || (b.removed !== undefined && b.removed < s.t)) continue;
			const d = Math.hypot(pos.x - s.pos.x, pos.y - s.pos.y, pos.z - s.pos.z);
			if (!best || d < best.d) best = { b, d, pos };
		}
		if (best) { animators.add(best.b.type); samples.push({ sound: s.name, t: s.t, type: best.b.type, y: best.pos.y }); }
	}
	// Todas as posições das bolas no chão: do 1º som de chão até o fim.
	const firstGround = groundSounds[0]?.t ?? tEnd;
	let minGroundY = Infinity;
	for (const b of watch.balls.values()) {
		for (const q of b.positions) if (q.t >= firstGround) minGroundY = Math.min(minGroundY, q.y);
		const last = positionAt(b, firstGround);
		if (last && (b.removed === undefined || b.removed > firstGround)) minGroundY = Math.min(minGroundY, last.y);
	}
	const describe = (b) => `${b.type} escala ${b.scale ?? "?"} add@${b.added}ms ${fmt(b.addPos)} (${b.positions.length} pos, ${b.motions.length} motion${b.motions.length ? ` ${b.motions.slice(0, 4).map((m) => `${m.t}ms ${fmt(m)}`).join(" | ")}` : ""}, y mín ${Math.min(...b.positions.map((q) => q.y)).toFixed(3)}, removida ${b.removed ?? "não"})`;
	t.step(`${species}: resultado ${result?.text ?? "nenhum"}`);
	for (const b of watch.balls.values()) t.step(`  entidade: ${describe(b)}`);
	t.step(`  sons: ${watch.sounds.map((s) => `${s.t}ms ${s.name}`).join(", ")}`);
	t.step(`  animação no chão: ${samples.map((s) => `${s.sound}→${s.type} y=${s.y.toFixed(3)}`).join(", ") || "nenhuma"}`);
	t.step(`  topo do bloco y=${p.y}; y mín no chão ${Number.isFinite(minGroundY) ? minGroundY.toFixed(3) : "—"}; itens de bola no chão ${items.length}; ${itemId}: ${before} → ${after}`);
	const pokemonBack = bot.findEntities((e) => e.type === `cobblemon:${species}`).length > 0;
	return { p, result, thrown, dummies, animators, samples, minGroundY, items, before, after, wild, pokemonBack };
}

export default {
	name: "bola da captura não afunda no chão: animação na _dummy, em cima do bloco",
	timeout: 480_000,
	async run(t) {
		const bot = await t.bot("Chao");
		await setupWithPokemon(bot, "pikachu level=20");
		await bot.commandOk("gamemode s @s");
		await cleanup(bot);
		await giveItem(bot, "cobblemon:master_ball", 4);
		await giveItem(bot, "cobblemon:poke_ball", 16);

		// 1. Captura com sucesso.
		await holdItem(bot, "cobblemon:master_ball");
		const ok = await throwAt(t, bot, { item: "cobblemon:master_ball", species: "snorlax", level: 5, where: { dx: 34, dz: -20 } });
		t.assert(ok.result?.text.includes("{cobblemon.capture.succeeded}"), `Master Ball captura (${ok.result?.text ?? "nenhuma mensagem"})`);
		t.assert(ok.items.length === 0, `nenhum item de bola no chão depois da captura (${ok.items.length})`);
		t.assert(ok.after === ok.before - 1, `gastou 1 Master Ball (${ok.before} → ${ok.after})`);
		if (!baseline) t.assert(Number.isFinite(ok.minGroundY) && ok.minGroundY >= ok.p.y - 1e-3, `a bola ficou em cima do bloco no chão (y mín ${ok.minGroundY}, topo ${ok.p.y})`);
		if (!baseline) {
			t.assert(ok.dummies.some((d) => d.type === "cobblemon:master_ball_dummy"), "a animação usa a cobblemon:master_ball_dummy (add_entity)");
			t.assert([...ok.animators].every((a) => a === "cobblemon:master_ball_dummy") && ok.animators.size > 0, `quem faz a animação no chão é a dummy (${[...ok.animators].join(", ")})`);
			t.assert(ok.dummies.every((d) => d.motions.length === 0), "a dummy não recebe velocidade (nada para o cliente simular)");
			const thrownScale = ok.thrown[0]?.scale ?? 1;
			t.assert(ok.dummies.every((d) => Math.abs((d.scale ?? 0) - thrownScale) < 1e-3), `a dummy tem a escala do projétil (${ok.dummies.map((d) => d.scale).join(", ")} × ${thrownScale})`);
			t.assert(ok.thrown.every((b) => b.removed !== undefined), "a bola arremessada sumiu");
		}
		await cleanup(bot);

		// 2. Escape (Mewtwo nível 100, taxa 3, vida cheia; repete se por acaso capturar).
		await holdItem(bot, "cobblemon:poke_ball");
		let esc;
		for (let i = 0; i < 4; i++) {
			esc = await throwAt(t, bot, { item: "cobblemon:poke_ball", species: "mewtwo", level: 100, where: { dx: 34, dz: -20 } });
			if (esc.result?.text.includes("{cobblemon.capture.broke_free}")) break;
			await cleanup(bot);
		}
		t.assert(esc.result?.text.includes("{cobblemon.capture.broke_free}"), `o Mewtwo escapou (${esc.result?.text ?? "nenhuma mensagem"})`);
		t.assert(esc.pokemonBack, "o Mewtwo continua no mundo depois do escape");
		t.assert(esc.items.length === 0, `sem item de bola no chão depois do escape, como antes (${esc.items.length})`);
		t.assert(esc.after === esc.before - 1, `gastou 1 Poké Ball (${esc.before} → ${esc.after})`);
		if (!baseline) t.assert(Number.isFinite(esc.minGroundY) && esc.minGroundY >= esc.p.y - 1e-3, `a bola ficou em cima do bloco no chão (y mín ${esc.minGroundY}, topo ${esc.p.y})`);
		t.assert([...esc.dummies, ...esc.thrown].every((b) => b.removed !== undefined), "nenhuma entidade de bola sobrou depois do escape");
		if (!baseline) {
			t.assert([...esc.animators].every((a) => a === "cobblemon:poke_ball_dummy") && esc.animators.size > 0, `quem faz a animação no chão é a dummy (${[...esc.animators].join(", ")})`);
			t.assert(esc.dummies.every((d) => d.motions.length === 0), "a dummy não recebe velocidade");
		}
		await cleanup(bot);
	},
};
