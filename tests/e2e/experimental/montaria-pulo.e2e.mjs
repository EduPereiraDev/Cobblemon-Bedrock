// Montaria (docs/pendencias/montaria-pulo.md): matriz por estilo/comportamento do Cobblemon e dano do dono no próprio
// Pokémon (PokemonDamage.isPokemonInvulnerable). Fora da suíte normal:
//   COBBLEMON_BDS=ride COBBLEMON_BDS_PORT=19195 COBBLEMON_DIST=dist-e2e-ride COBBLEMON_BDS_TRANSPORT=raknet \
//     COBBLEMON_BDS_ONLINE_MODE=false COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy --rm --verbose \
//     --scenario tests/e2e/experimental/montaria-pulo.e2e.mjs
// Depuração: E2E_RIDE_SPECIES=dragonite,charizard limita a matriz; E2E_RIDE_DAMAGE=0 pula a parte do dano.
//
// O bot manda o Espaço/agachar como o cliente manda no player_auth_input (jump_down/jumping/start_jumping/want_up + os
// flags *_raw). Desmontar é visto pelo set_entity_link (remove) e pela sonda `cblimits:ride_probe` (log do servidor:
// estilo, chão, posição e velocidade por tick). As flags que o servidor manda para o cliente (wasd_controlled,
// can_power_jump, can_use_vertical_movement_action...) vêm do set_entity_data da montaria.
// Limite do BDS: quem decide desmontar pelo Espaço/agachar é o cliente (interact leave_vehicle); o bot mostra o que o
// servidor faz com cada entrada e quais flags o cliente recebe. Na terra, o desmontar documentado (agachar) é emulado
// como o cliente faz: agachar + interact leave_vehicle. (Medido: o servidor aceita leave_vehicle também no ar/água; lá
// quem impede o cliente de pedir é a trava "dismount" — update_client_input_locks 256 —, conferida por estilo abaixo.)
import { arena, dismissForms, givePokemon, openParty, setupWithPokemon, spawnWild } from "../lib/flows.mjs";
import * as server from "../lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = () => new Date(Date.now() - 300).toISOString();
const short = (l) => l.replace(/.*\[limites\] /, "");
const ONLY = process.env.E2E_RIDE_SPECIES?.split(",").map((x) => x.trim()).filter(Boolean);
const DAMAGE = process.env.E2E_RIDE_DAMAGE !== "0";

/** Uma espécie por combinação de comportamentos que existe nos dados (generated/scripts/entityData.ts). */
const MATRIX = [
	{ species: "arcanine", key: "land/horse (pulo 0,52)", styles: ["LAND"] },
	{ species: "charizard", key: "land/horse (pulo 0,4) + air/bird", styles: ["LAND", "AIR"] },
	{ species: "altaria", key: "land/horse (canJump=false) + air/bird", styles: ["LAND", "AIR"] },
	{ species: "dragonite", key: "land/horse (canJump=false) + air/jet + liquid/dolphin", styles: ["LAND", "AIR", "LIQUID"] },
	{ species: "latias", key: "land/horse (canJump=false) + air/jet", styles: ["LAND", "AIR"] },
	{ species: "metagross", key: "land/horse (pulo 0,4) + air/hover", styles: ["LAND", "AIR"] },
	{ species: "golurk", key: "land/horse (pulo 0,475) + air/rocket", styles: ["LAND", "AIR"] },
	{ species: "bronzong", key: "air/hover (só ar)", styles: ["AIR"] },
	{ species: "lapras", key: "land/horse (canJump=false) + liquid/boat", styles: ["LAND", "LIQUID"] },
	{ species: "milotic", key: "land/horse (canJump=false) + liquid/dolphin", styles: ["LAND", "LIQUID"] },
	{ species: "wailmer", key: "land/horse (canJump=false) + liquid/submarine", styles: ["LAND", "LIQUID"] },
	{ species: "sharpedo", key: "liquid/dolphin (só água)", styles: ["LIQUID"] },
	{ species: "seaking", key: "liquid/submarine (só água)", styles: ["LIQUID"] },
].filter((m) => !ONLY || ONLY.includes(m.species));

const JUMP_PRESS = ["jump_down", "jumping", "start_jumping", "want_up", "jump_pressed_raw", "jump_current_raw"];
const JUMP_HOLD = ["jump_down", "jumping", "want_up", "jump_current_raw"];
const JUMP_RELEASE = ["jump_released_raw"];
const SNEAK_PRESS = ["sneak_down", "sneaking", "start_sneaking", "want_down", "sneak_pressed_raw", "sneak_current_raw"];
const SNEAK_HOLD = ["sneak_down", "sneaking", "want_down", "sneak_current_raw"];
const SNEAK_RELEASE = ["stop_sneaking", "sneak_released_raw"];

/** Segura um conjunto de flags por `ms` (o bot manda o player_auth_input a cada 50 ms). */
async function frames(bot, sequence) {
	for (const [flags, ms] of sequence) {
		bot.inputData = flags;
		await sleep(ms);
	}
	bot.inputData = [];
}

const tapJump = (bot, holdMs = 50) => frames(bot, [[JUMP_PRESS, 50], ...(holdMs > 50 ? [[JUMP_HOLD, holdMs - 50]] : []), [JUMP_RELEASE, 50]]);
const doubleJump = (bot, holdSecondMs = 50) => frames(bot, [[JUMP_PRESS, 50], [JUMP_HOLD, 50], [JUMP_RELEASE, 50], [[], 50], [JUMP_PRESS, 50], ...(holdSecondMs > 50 ? [[JUMP_HOLD, holdSecondMs - 50]] : []), [JUMP_RELEASE, 50]]);
const tapSneak = (bot) => frames(bot, [[SNEAK_PRESS, 50], [SNEAK_HOLD, 50], [SNEAK_RELEASE, 50]]);
const doubleSneak = (bot) => frames(bot, [[SNEAK_PRESS, 50], [SNEAK_RELEASE, 50], [[], 50], [SNEAK_PRESS, 50], [SNEAK_RELEASE, 50]]);

/** Flags de controle que o servidor manda ao cliente no set_entity_data da montaria (o cliente real se guia por elas). */
const RIDE_FLAGS = ["wasd_controlled", "can_power_jump", "affected_by_gravity", "wasd_air_controlled", "can_use_vertical_movement_action", "does_server_auth_only_dismount"];
function rideFlags(entity) {
	const out = [];
	for (const m of entity?.metadata ?? []) {
		if (m.key !== "flags" && m.key !== "flags_extended") continue;
		for (const f of RIDE_FLAGS) if (m.value?.[f]) out.push(f);
	}
	return out.join("+") || "-";
}
/** Tem ação para o Espaço (o que os mounts vanilla têm; sem nenhuma, o cliente usa o Espaço para desmontar). */
const hasSpaceAction = (flags) => /can_power_jump|can_use_vertical_movement_action/.test(flags);

function probeLines(iso, match = "[limites]") {
	return server.logSince(iso).split("\n").filter((l) => l.includes(match)).map(short);
}

/** Resumo das linhas `ride` da sonda: estilos vistos, deslocamento horizontal, y mínimo/máximo e o último estado. */
function rideSummary(lines) {
	const ride = lines.filter((l) => l.startsWith("ride "));
	const num = (l, k) => Number(new RegExp(` ${k}=(-?[0-9.]+)`).exec(l)?.[1]);
	const ys = ride.map((l) => num(l, "y")).filter(Number.isFinite);
	const styles = [];
	for (const l of ride) {
		const s = /estilo=(\S+)/.exec(l)?.[1];
		if (s && styles.at(-1) !== s) styles.push(s);
	}
	const first = ride[0], last = ride.at(-1);
	const moved = first && last ? Math.hypot(num(last, "x") - num(first, "x"), num(last, "z") - num(first, "z")) : 0;
	return {
		n: ride.length, styles, moved: +moved.toFixed(2),
		yMin: ys.length ? Math.min(...ys) : NaN, yMax: ys.length ? Math.max(...ys) : NaN, yEnd: ys.at(-1) ?? NaN,
		lastStyle: /estilo=(\S+)/.exec(last ?? "")?.[1], ground: /chao=(\S+)/.exec(last ?? "")?.[1], water: /agua=(\S+)/.exec(last ?? "")?.[1],
	};
}

export default {
	name: "montaria: matriz por estilo (andar, pular sem cair, decolar, água, pousar, desmontar) + dano do dono",
	timeout: 2_400_000,
	async run(t) {
		const table = [];
		const fail = [];
		const results = {};
		t.console("scriptevent cobblemon:debug_probes on");
		t.console("kill @e[type=!player]");
		const bot = await t.bot("Ride");
		await setupWithPokemon(bot, "pikachu level=5");
		await dismissForms(bot, 1500);
		const base = await arena(bot, { height: 170 });
		const bx = Math.floor(base.x), bz = Math.floor(base.z), by = base.y;
		// Terra (z ≤ bz+2, vidro em by-1) e piscina (z bz+3..bz+16, água de by-6 a by-1), céu livre até by+30.
		await bot.command(`fill ${bx - 12} ${by - 8} ${bz - 16} ${bx + 12} ${by + 30} ${bz + 18} air`);
		await bot.command(`fill ${bx - 11} ${by - 1} ${bz - 15} ${bx + 11} ${by - 1} ${bz + 2} glass`);
		await bot.command(`fill ${bx - 11} ${by - 7} ${bz + 3} ${bx + 11} ${by - 1} ${bz + 17} glass`);
		await bot.command(`fill ${bx - 10} ${by - 6} ${bz + 3} ${bx + 10} ${by - 1} ${bz + 16} water`);
		// Rampa de meia em meia laje (margem de rio) para sair da água: z bz+3 (169,5) … bz+8 (167).
		for (const [dz, y, block] of [[3, by - 1, "smooth_stone_slab"], [4, by - 2, "glass"], [5, by - 2, "smooth_stone_slab"], [6, by - 3, "glass"], [7, by - 3, "smooth_stone_slab"], [8, by - 4, "glass"]]) {
			await bot.command(`fill ${bx - 10} ${by - 6} ${bz + dz} ${bx + 10} ${y - 1} ${bz + dz} glass`);
			await bot.command(`fill ${bx - 10} ${y} ${bz + dz} ${bx + 10} ${y} ${bz + dz} ${block}`);
		}
		await bot.command(`kill @e[type=!player,r=60]`);
		await bot.command("effect @s slow_falling 9999 0 true");
		await bot.command("effect @s resistance 9999 4 true");
		const empty = [...Array(9).keys()].find((s) => !bot.inventory[s]?.network_id) ?? 8;
		await bot.selectSlot(empty);

		// set_entity_link do próprio bot (unique id do jogador). type: 0 = remove, 1 = rider, 2 = passenger.
		const links = [];
		bot.client.on("set_entity_link", (p) => {
			const l = p.link ?? p;
			const type = l.type === 0 || l.type === "remove" ? "remove" : l.type === 1 || l.type === "rider" ? "rider" : "passenger";
			links.push({ at: Date.now(), type, rider: String(l.rider_entity_id), ridden: String(l.ridden_entity_id) });
			bot._note(`set_entity_link ${type} rider=${l.rider_entity_id} ridden=${l.ridden_entity_id}`);
		});
		const mine = (l) => l.rider === String(bot.uniqueId) || l.rider === String(bot.runtimeId);
		const removedSince = (at) => links.filter((l) => l.at >= at && l.type === "remove" && mine(l)).length > 0;
		const riding = () => { const last = [...links].reverse().find(mine); return !!last && last.type !== "remove"; };

		// Timeline das flags da montaria atual (para ver o que o cliente recebe em cada estilo).
		let current;
		const flagLog = [];
		bot.client.on("set_entity_data", (p) => {
			if (!current || String(p.runtime_entity_id) !== String(current.runtimeId)) return;
			const f = rideFlags({ metadata: p.metadata });
			if (f !== "-" && flagLog.at(-1) !== f) flagLog.push(f);
		});
		const flagsNow = () => rideFlags(bot.entities.get(String(current?.runtimeId)));
		// Travas de entrada do cliente (update_client_input_locks): InputPermissionCategory.Dismount desligada = "dismount".
		let locks = {};
		bot.client.on("update_client_input_locks", (p) => {
			locks = p.lock ?? p.locks ?? {};
			bot._note(`input_locks ${JSON.stringify(locks)}`);
		});
		// O bedrock-protocol 3.60 decodifica os bits antigos; no 1.26 o bit é 1 << InputPermissionCategory (Dismount = 8 → 256).
		const lockBits = () => (typeof locks === "number" ? locks : Number(locks._value ?? 0));
		const dismountLocked = () => (lockBits() & 256) !== 0;

		t.console("scriptevent cblimits:ride_probe on");

		async function mount(entity) {
			const at = Date.now();
			for (let attempt = 0; attempt < 3 && !riding(); attempt++) {
				const e = bot.entities.get(String(entity.runtimeId)) ?? entity;
				// Na água o Pokémon nada para longe: chega perto antes de interagir (alcance da interação).
				if (Math.hypot(e.position.x - bot.position.x, e.position.z - bot.position.z) > 3) await bot.teleport(e.position.x, e.position.y, e.position.z - 1.5);
				await frames(bot, [[SNEAK_PRESS, 100]]);
				bot.inputData = SNEAK_HOLD;
				await sleep(200);
				bot.interact(bot.entities.get(String(entity.runtimeId)) ?? entity);
				await sleep(600);
				await frames(bot, [[SNEAK_RELEASE, 100]]);
				try { await bot.waitUntil(() => links.some((l) => l.at >= at && l.type !== "remove" && mine(l)), 4000, `montar ${entity.type}`); } catch { /* tenta de novo */ }
			}
			if (!riding()) throw new Error(`não montou em ${entity.type}`);
			await sleep(1200);
		}

		let lastStyle;
		/** Uma ação da matriz: roda, espera e resume (desmontou? estilos, deslocamento, y). */
		async function act(row, label, fn, wait = 1200) {
			const iso = since();
			const at = Date.now();
			flagLog.length = 0;
			await fn();
			await sleep(wait);
			const lines = probeLines(iso);
			const r = { removed: removedSince(at), sum: rideSummary(lines), flags: [...flagLog], lines };
			const buttons = lines.filter((l) => l.startsWith("botao ")).length;
			const s = r.sum;
			r.text = `desmontou=${r.removed} estilos=${s.styles.join(">") || "-"} anda=${s.moved} y=${s.yMin.toFixed?.(2)}..${s.yMax.toFixed?.(2)}` +
				` fim(${s.lastStyle},chão=${s.ground},água=${s.water}) botões=${buttons}${r.flags.length ? ` flags=${r.flags.join(" → ")}` : ""}`;
			t.step(`${row.species} | ${label}: ${r.text}`);
			lastStyle = s.lastStyle ?? lastStyle;
			return r;
		}

		function record(row, action, ok, evidence) {
			table.push({ species: row.species, key: row.key, action, ok, evidence });
			if (ok === false) fail.push(`${row.species}: ${action} (${evidence})`);
		}

		async function walk(ms, yaw) {
			if (yaw !== undefined) bot.rotation = { pitch: 0, yaw };
			bot.moveVector = { x: 0, z: 1 };
			bot.inputData = ["up"];
			await sleep(ms);
			bot.moveVector = { x: 0, z: 0 };
			bot.inputData = [];
		}

		/** Anda até o estilo virar `style` (ou o tempo acabar). */
		async function walkUntil(row, label, style, yaw, timeout = 15_000, pitch = 0) {
			return act(row, label, async () => {
				bot.rotation = { pitch, yaw };
				bot.moveVector = { x: 0, z: 1 };
				bot.inputData = ["up"];
				const end = Date.now() + timeout;
				while (Date.now() < end) {
					await sleep(500);
					const l = probeLines(new Date(Date.now() - 600).toISOString(), "] ride tick=").at(-1) ?? "";
					if (l.includes(`estilo=${style}`)) { await sleep(1200); break; }
				}
				bot.moveVector = { x: 0, z: 0 };
				bot.inputData = [];
			}, 800);
		}

		/** Desmontar como o cliente faz na terra: agachar + interact leave_vehicle. */
		async function clientDismount(entity) {
			bot.inputData = SNEAK_PRESS;
			await sleep(50);
			bot.client.queue("interact", { action_id: "leave_vehicle", target_entity_id: BigInt(entity.runtimeId), has_position: false });
			await sleep(100);
			await frames(bot, [[SNEAK_RELEASE, 50]]);
		}

		for (const row of MATRIX) {
			const { species } = row;
			const res = results[species] = {};
			try {
				if (riding()) { await bot.command("ride @s stop_riding"); await sleep(800); }
				await bot.command(`kill @e[type=!player,r=60]`);
				await bot.command("cobblemon:clearparty");
				await givePokemon(bot, `${species} level=50`);
				const liquidOnly = row.styles[0] === "LIQUID";
				const shore = row.styles[0] === "LAND" && row.styles.includes("LIQUID") && !row.styles.includes("AIR");
				// Posição e direção de cada tipo: na plataforma, longe da borda; quem tem terra e água começa perto da margem.
				const start = liquidOnly ? { x: bx - 5.5, z: bz + 11.5, y: by - 1, walkYaw: -90, walkMs: 800 }
					: shore ? { z: bz - 2.5, y: by, walkYaw: 180, walkMs: 1500 }
					: row.styles[0] === "AIR" ? { z: bz - 8.5, y: by, walkYaw: 90, walkMs: 500 }
					: { z: bz - 11.5, y: by, walkYaw: 0, walkMs: 1500 };
				await bot.teleport(start.x ?? bx + 0.5, start.y, start.z);
				// Só-água: manda para fora olhando para o meio da piscina (+x), longe das bordas.
				bot.rotation = { pitch: 20, yaw: shore ? 180 : liquidOnly ? -90 : 0 };
				await sleep(500);
				const party = await openParty(bot);
				bot.answerForm(party, (b) => b.includes(`{cobblemon.species.${species}.name}`));
				const menu = await bot.waitForForm((f) => !f.answered && f.title.includes(species));
				bot.answerForm(menu, 0);
				const entity = await bot.waitForEntity(`cobblemon:${species}`, { timeout: 20_000 });
				current = entity;
				await sleep(3000);
				await mount(entity);
				const mountedFlags = flagsNow();
				t.step(`${species} | montado; flags ${mountedFlags}`);
				record(row, "montar", true, `flags ${mountedFlags}`);
				// Andar para frente.
				res.walk = await act(row, `andar ${start.walkMs / 1000} s`, () => walk(start.walkMs, start.walkYaw), 600);
				// Na terra o cliente pode desmontar sozinho: o Espaço precisa de ação (flag can_power_jump). No ar/água o
				// cliente recebe a trava "dismount" (InputPermissionCategory.Dismount desligada).
				const landFlags = [...res.walk.flags, flagsNow()].join(" ");
				if (row.styles[0] === "LAND") record(row, "Espaço tem ação na terra (flag can_power_jump)", hasSpaceAction(landFlags), landFlags);
				else record(row, "trava de desmontar do cliente no ar/água (input lock dismount)", dismountLocked(), JSON.stringify(locks));
				record(row, "andar", res.walk.sum.moved >= 0.8 && !res.walk.removed, `deslocou ${res.walk.sum.moved} blocos`);

				// Pulo simples: não desmonta.
				res.jump = await act(row, "pulo simples", () => tapJump(bot));
				record(row, "pulo simples não desmonta", !res.jump.removed && riding(), res.jump.text);

				if (row.styles.includes("LAND") && row.styles.length === 1) {
					res.charge = await act(row, "pulo segurado 0,6 s", () => tapJump(bot, 600));
					record(row, "pulo segurado (carga) não desmonta", !res.charge.removed && riding(), res.charge.text);
					res.double = await act(row, "pulo duplo (só terra)", () => doubleJump(bot));
					record(row, "pulo duplo não desmonta nem troca de estilo", !res.double.removed && riding() && !res.double.sum.styles.includes("AIR"), res.double.text);
				}

				if (row.styles.includes("AIR")) {
					const landStart = row.styles[0] === "LAND";
					if (landStart) {
						res.takeoff = await act(row, "pulo duplo + segura 1 s (decolar)", () => doubleJump(bot, 1000), 2500);
						const s = res.takeoff.sum;
						record(row, "decolar (pulo duplo)", !res.takeoff.removed && s.styles.includes("AIR") && s.lastStyle === "AIR" && s.yMax - s.yMin > 1,
							`estilos ${s.styles.join(">")}, subiu ${(s.yMax - s.yMin).toFixed(2)}, fim ${s.lastStyle} chão=${s.ground}`);
					}
					record(row, "trava de desmontar do cliente no ar (input lock dismount)", dismountLocked(), JSON.stringify(locks));
					res.rise = await act(row, "pulo segurado no ar 1 s (subir)", () => tapJump(bot, 1000), 600);
					record(row, "pulo segurado no ar não desmonta", !res.rise.removed && riding(), res.rise.text);
					row.riseMeasured = +(res.rise.sum.yEnd - res.rise.sum.yMin).toFixed(2);
					res.airWalk = await act(row, "andar no ar 0,5 s", () => walk(500, 90), 400);
					record(row, "andar no ar", res.airWalk.sum.moved >= 0.8, `deslocou ${res.airWalk.sum.moved}`);
					res.sneak1 = await act(row, "agachar 1× no ar", () => tapSneak(bot), 800);
					record(row, "agachar 1× no ar não desmonta", !res.sneak1.removed && riding(), res.sneak1.text);
					if (landStart) {
						// Pousar: agachar segurado desce até o chão → LAND.
						res.land = await act(row, "agachar segurado até pousar", async () => {
							bot.inputData = SNEAK_PRESS;
							await sleep(50);
							const end = Date.now() + 12_000;
							bot.inputData = SNEAK_HOLD;
							while (Date.now() < end) {
								await sleep(500);
								const l = probeLines(new Date(Date.now() - 600).toISOString(), "] ride tick=").at(-1) ?? "";
								if (l.includes("estilo=LAND")) break;
							}
							await frames(bot, [[SNEAK_RELEASE, 50]]);
						}, 800);
						record(row, "pousar (AIR → LAND)", !res.land.removed && res.land.sum.lastStyle === "LAND", res.land.text);
						// Pulo duplo rápido, sem segurar: só o impulso da decolagem tira do chão.
						res.takeoff2 = await act(row, "decolar de novo (pulo duplo rápido, sem segurar)", () => doubleJump(bot), 2500);
						// Sem fôlego (ride_air_tired, como o STAMINA do Java) a montaria plana e desce: esperado.
						const tired = res.takeoff2.lines.some((l) => l.includes("cobblemon:ride_air_tired"));
						if (tired) record(row, "decolar de novo (sem fôlego: planou e pousou, esperado)", null, res.takeoff2.text);
						else record(row, "decolar com pulo duplo rápido (sem segurar)", res.takeoff2.sum.lastStyle === "AIR" && !res.takeoff2.removed && res.takeoff2.sum.yMax - res.takeoff2.sum.yMin > 1,
							`subiu ${(res.takeoff2.sum.yMax - res.takeoff2.sum.yMin).toFixed(2)}; ${res.takeoff2.text}`);
					}
					// Sem fôlego a montaria já pousou (LAND): aí o desmontar é o agachar da terra (passo final).
					if (lastStyle === "AIR") {
						res.sneak2 = await act(row, "agachar 2× no ar (desmontar)", () => doubleSneak(bot), 1500);
						record(row, "agachar 2× no ar desmonta", res.sneak2.removed && !riding(), res.sneak2.text);
					}
				}
				else if (row.styles.includes("LIQUID")) {
					if (!liquidOnly) {
						res.enter = await walkUntil(row, "andar até a água", "LIQUID", 0);
						record(row, "entrar na água (LAND → LIQUID)", !res.enter.removed && res.enter.sum.lastStyle === "LIQUID", res.enter.text);
					}
					record(row, "trava de desmontar do cliente na água (input lock dismount)", dismountLocked(), JSON.stringify(locks));
					res.wjump = await act(row, "pulo segurado na água 0,6 s", () => tapJump(bot, 600));
					record(row, "pulo na água não desmonta", !res.wjump.removed && riding(), res.wjump.text);
					res.wsneak1 = await act(row, "agachar 1× na água", () => tapSneak(bot), 800);
					record(row, "agachar 1× na água não desmonta", !res.wsneak1.removed && riding(), res.wsneak1.text);
					if (!liquidOnly) {
						// Na água a montaria vai para onde a câmera aponta (free_camera_controlled): olhando um pouco para cima,
						// como o jogador faz para subir na margem.
						res.exit = await walkUntil(row, "sair da água (olhando 25° para cima)", "LAND", 180, 12_000, -25);
						record(row, "sair da água (LIQUID → LAND)", !res.exit.removed && res.exit.sum.lastStyle === "LAND", res.exit.text);
						if (res.exit.sum.lastStyle === "LAND" && riding()) {
							res.reenter = await walkUntil(row, "voltar para a água", "LIQUID", 0);
						}
					}
					const styleBefore = lastStyle;
					res.wsneak2 = await act(row, `agachar 2× na água (desmontar; estilo antes ${styleBefore})`, () => doubleSneak(bot), 1500);
					if (styleBefore === "LIQUID") record(row, "agachar 2× na água desmonta", res.wsneak2.removed && !riding(), res.wsneak2.text);
				}

				// Terra: o desmontar do cliente (agachar → interact leave_vehicle) é aceito e o script limpa o estado.
				if (riding()) {
					const before = lastStyle;
					const lockBefore = lockBits();
					res.leave = await act(row, `agachar (cliente: leave_vehicle) em ${before}`, () => clientDismount(entity), 1200);
					if (before === "LAND") record(row, "desmontar na terra (agachar)", res.leave.removed && !riding(), `trava do cliente antes=${lockBefore} (0 = pode desmontar); ${res.leave.text}`);
					else record(row, `ainda montado no fim (${before})`, false, res.leave.text);
				}
			} catch (err) {
				t.warn(`${species}: ${err.message}`);
				record(row, "roteiro", false, err.message);
				bot.inputData = [];
				bot.moveVector = { x: 0, z: 0 };
			}
			current = undefined;
		}
		t.console("scriptevent cblimits:ride_probe off");
		if (riding()) await bot.command("ride @s stop_riding");

		// ------------------------------------------------------------------ dano: dono, outro jogador, selvagem
		if (DAMAGE) {
			const hurts = new Map();
			const onEvent = (p) => {
				if (!/hurt/i.test(String(p.event_id))) return;
				const k = String(p.runtime_entity_id);
				hurts.set(k, (hurts.get(k) ?? 0) + 1);
			};
			bot.client.on("entity_event", onEvent);
			async function health(selector, label) {
				const iso = since();
				t.console(`execute as ${selector} run scriptevent cblimits:entity_info ${label}`);
				await sleep(800);
				const line = probeLines(iso, `entity_info ${label}`).at(-1) ?? "";
				return { line, hp: Number(/vida=([0-9.]+)/.exec(line)?.[1] ?? NaN) };
			}
			try {
				await bot.command(`kill @e[type=!player,r=60]`);
				await bot.command("cobblemon:clearparty");
				await givePokemon(bot, "arcanine level=50");
				await bot.teleport(bx + 0.5, by, bz - 8.5);
				bot.rotation = { pitch: 20, yaw: 0 };
				const party = await openParty(bot);
				bot.answerForm(party, (b) => b.includes("{cobblemon.species.arcanine.name}"));
				const menu = await bot.waitForForm((f) => !f.answered && f.title.includes("arcanine"));
				bot.answerForm(menu, 0);
				const arc = await bot.waitForEntity("cobblemon:arcanine", { timeout: 20_000 });
				await sleep(3000);
				await bot.command("effect @e[type=cobblemon:arcanine,r=20] slowness 120 255 true");
				const sel = `@e[type=cobblemon:arcanine,x=${bx},y=${by},z=${bz},r=40,c=1]`;
				const h0 = await health(sel, "dono_antes");
				for (const sneaking of [false, true]) {
					if (sneaking) { bot.inputData = SNEAK_PRESS; await sleep(100); bot.inputData = SNEAK_HOLD; await sleep(200); }
					bot.attack(bot.entities.get(String(arc.runtimeId)) ?? arc);
					await sleep(900);
					if (sneaking) await frames(bot, [[SNEAK_RELEASE, 100]]);
					await dismissForms(bot, 300);
				}
				const h1 = await health(sel, "dono_depois");
				results.ownerHit = { before: h0.hp, after: h1.hp, hurt: hurts.get(String(arc.runtimeId)) ?? 0 };
				t.step(`dano | dono bate (em pé e agachado, mão vazia) no próprio Arcanine: vida ${h0.hp} → ${h1.hp}, hurt=${results.ownerHit.hurt}`);

				const other = await t.bot("Oth");
				await dismissForms(other, 1500);
				await other.teleport(bx + 2.5, by, bz - 8.5);
				await sleep(1500);
				const arcOther = await other.waitForEntity("cobblemon:arcanine", { timeout: 15_000 });
				const otherHurts = [];
				other.client.on("entity_event", (p) => { if (String(p.runtime_entity_id) === String(arcOther.runtimeId) && /hurt/i.test(String(p.event_id))) otherHurts.push(p.event_id); });
				other.attack(arcOther);
				await sleep(900);
				other.attack(arcOther);
				await sleep(900);
				await dismissForms(other, 300);
				const h2 = await health(sel, "outro_depois");
				results.otherHit = { before: h1.hp, after: h2.hp, hurt: otherHurts.length };
				t.step(`dano | outro jogador bate no Arcanine do dono: vida ${h1.hp} → ${h2.hp}, hurt=${otherHurts.length}`);

				const wild = await spawnWild(bot, "rattata", { level: 30, offset: "~ ~ ~3" });
				await sleep(1000);
				const wsel = `@e[type=cobblemon:rattata,x=${bx},y=${by},z=${bz},r=40,c=1]`;
				const w0 = await health(wsel, "selvagem_antes");
				const formsBefore = bot.forms.length;
				bot.attack(wild);
				await sleep(1200);
				const w1 = await health(wsel, "selvagem_depois");
				results.wildHit = { before: w0.hp, after: w1.hp, hurt: hurts.get(String(wild.runtimeId)) ?? 0, forms: bot.forms.length - formsBefore };
				t.step(`dano | dono bate num selvagem: vida ${w0.hp} → ${w1.hp}, hurt=${results.wildHit.hurt}, forms novos=${results.wildHit.forms}`);
				await dismissForms(bot, 300);
				await bot.command("cobblemon:stopbattle");
			} catch (err) {
				t.warn(`dano: ${err.message}`);
			}
			bot.client.removeListener("entity_event", onEvent);
			const o = results.ownerHit, x = results.otherHit, w = results.wildHit;
			if (!o || o.after !== o.before || o.hurt) fail.push(`dono causou dano no próprio Pokémon: ${JSON.stringify(o)}`);
			if (!x || x.after !== x.before || x.hurt) fail.push(`outro jogador causou dano: ${JSON.stringify(x)}`);
			if (!w || !(w.after < w.before)) fail.push(`selvagem não levou dano de jogador: ${JSON.stringify(w)}`);
		}
		await bot.command(`kill @e[type=!player,r=60]`);
		await bot.command("cobblemon:clearparty");
		t.console("scriptevent cobblemon:debug_probes off");

		// Tabela espécie × ação.
		for (const r of table) t.step(`TABELA | ${r.species} | ${r.key} | ${r.action} | ${r.ok === true ? "OK" : r.ok === false ? "FALHA" : "-"} | ${r.evidence}`);
		for (const row of MATRIX) if (row.riseMeasured !== undefined) t.step(`TABELA | ${row.species} | subida com pulo segurado no ar (servidor): ${row.riseMeasured} blocos`);
		for (const f of fail) t.step(`FALHA: ${f}`);
		t.assert(fail.length === 0, fail.join("; "));
	},
};
