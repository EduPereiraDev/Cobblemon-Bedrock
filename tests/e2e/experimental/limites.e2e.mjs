// Frente limites-a (pesquisa 8 promovida a produção): evidência no BDS de teia, sprint, freelook/roll, NPC com modelo
// de Pokémon (pelo editor, behaviour `resource_identifier`) e NPC escondido por jogador. Fora da suíte normal:
//   COBBLEMON_DIST=dist-lima COBBLEMON_BDS=lima COBBLEMON_BDS_PORT=19154 COBBLEMON_BDS_TRANSPORT=raknet \
//     COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/limites.e2e.mjs --keep --verbose
// As sondas `cblimits:*` só respondem com `cobblemon:debug_probes on` (ligado pelo console no início).
import { openParty, arena, dismissForms, setupWithPokemon } from "../lib/flows.mjs";
import * as server from "../lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = () => new Date(Date.now() - 1000).toISOString();
const json = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? String(x) : x));
function logLines(iso, match) {
	return server.logSince(iso).split("\n").filter((l) => l.includes(match));
}
const short = (l) => l.replace(/.*\[limites\] /, "").replace(/.*\[Scripting\] /, "");

/** Respostas padrão de um ModalForm (custom_form) a partir dos defaults dos elementos. */
function modalDefaults(form) {
	return form.elements.map((e) => {
		if (e.type === "toggle") return !!e.default;
		if (e.type === "slider" || e.type === "step_slider" || e.type === "dropdown") return Number(e.default ?? 0);
		if (e.type === "input") return String(e.default ?? "");
		return null;
	});
}

/**
 * camera_instruction com fov (o bedrock-protocol 3.60 não decodifica): varint id 300 (AC 02) + opcionais set, clear,
 * fade, target, remove_target (1 byte cada, 0 = ausente) + fov presente (01) + f32 fov + f32 ease + string do easing
 * (varint tamanho + bytes) + bool clear.
 */
function decodeFov(buf) {
	const raw = buf.toString("hex").slice(0, 64);
	if (buf.length < 18 || buf[0] !== 0xac || buf[1] !== 0x02) return undefined;
	for (let i = 2; i < 7; i++) if (buf[i] !== 0) return { raw };
	if (buf[7] !== 1) return { raw };
	const len = buf[16];
	return { fov: +buf.readFloatLE(8).toFixed(2), ease: +buf.readFloatLE(12).toFixed(2), easing: buf.toString("utf8", 17, 17 + len), clear: buf[17 + len] === 1, raw };
}

/** Captura pacotes que o bedrock-protocol não decodifica (buffer cru) enquanto `fn` roda. */
async function captureRaw(bot, fn) {
	const raw = [];
	const orig = bot.client.readPacket.bind(bot.client);
	bot.client.readPacket = (packet) => {
		try { bot.client.deserializer.parsePacketBuffer(packet); }
		catch { raw.push(Buffer.from(packet)); }
		return orig(packet);
	};
	try { await fn(); }
	finally { bot.client.readPacket = orig; }
	return raw;
}

export default {
	name: "Limites A: teia, sprint, freelook, NPC com modelo de Pokémon e NPC escondido (produção)",
	timeout: 900_000,
	async run(t) {
		const results = {};
		t.console("scriptevent cobblemon:debug_probes on");
		const bot = await t.bot("Lim");
		await setupWithPokemon(bot, "arcanine level=40");
		await dismissForms(bot, 1500);
		const base = await arena(bot);
		await bot.command("gamemode creative");

		// ---------------------------------------------------------------- teia (#79)
		try {
			const iso = since();
			t.console(`scriptevent cblimits:web_fall ${Math.floor(base.x) - 20} ${base.y + 1} ${Math.floor(base.z) + 14} cobblemon:spinarak cobblemon:galvantula cobblemon:caterpie cobblemon:ariados`);
			await sleep(5000);
			const lines = logLines(iso, "web_fall t=");
			for (const l of lines) t.step(`teia: ${short(l)}`);
			const last = lines.at(-1) ?? "";
			const fall = (id) => Number(new RegExp(`${id}: caiu (-?[0-9.]+)`).exec(last)?.[1] ?? NaN);
			results.web = { spinarak: fall("cobblemon:spinarak"), galvantula: fall("cobblemon:galvantula"), ariados: fall("cobblemon:ariados"), caterpie: fall("cobblemon:caterpie") };
		} catch (e) { t.warn(`teia: ${e.message}`); }

		// ---------------------------------------------------------------- sprint (#33) e freelook (#38)
		try {
			// Chão comprido: correndo, a montaria sai da arena (numa rodada o Arcanine caiu 170 blocos).
			await bot.command(`fill ${Math.floor(base.x) - 8} ${base.y - 1} ${Math.floor(base.z) - 30} ${Math.floor(base.x) + 8} ${base.y - 1} ${Math.floor(base.z) + 30} glass`);
			await bot.command(`fill ${Math.floor(base.x) - 8} ${base.y} ${Math.floor(base.z) - 30} ${Math.floor(base.x) + 8} ${base.y + 4} ${Math.floor(base.z) + 30} air`);
			await bot.teleport(base.x, base.y, base.z - 24);
			bot.rotation = { pitch: 0, yaw: 0 };
			let party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes("arcanine"));
			let menu = await bot.waitForForm((f) => !f.answered && f.title.includes("arcanine"));
			bot.answerForm(menu, 0); // mandar para fora
			await bot.waitForEntity("cobblemon:arcanine", { timeout: 20_000 });
			await sleep(3000);
			party = await openParty(bot);
			bot.answerForm(party, (b) => b.includes("arcanine"));
			menu = await bot.waitForForm((f) => !f.answered && f.title.includes("arcanine"));
			const rideIdx = menu.buttons.findIndex((b) => b.includes("{cobblemon.ui.interact.ride}"));
			if (rideIdx < 0) throw new Error(`sem botão de montar: [${menu.buttons.join(" | ")}]`);
			bot.answerForm(menu, rideIdx);
			await sleep(2500);
			t.console("scriptevent cblimits:input_probe on");

			// Andar (um toque segurado): sem sprint, velocidade de andar.
			let iso = since();
			bot.moveVector = { x: 0, z: 1 }; bot.inputData = ["up"];
			await sleep(1500);
			const walk = logLines(iso, "[limites] input");
			t.step(`sprint/andar: ${walk.slice(-2).map(short).join(" || ")}`);
			results.walkNoSprint = walk.length > 0 && walk.slice(-3).every((l) => l.includes("sprint=false"));
			bot.moveVector = { x: 0, z: 0 }; bot.inputData = [];
			await sleep(800);

			// Duplo toque (teclado): 100 ms, solta 150 ms, segura. FOV: pacote cru decodificado à mão.
			iso = since();
			const raw = await captureRaw(bot, async () => {
				bot.moveVector = { x: 0, z: 1 }; bot.inputData = ["up"];
				await sleep(100);
				bot.moveVector = { x: 0, z: 0 }; bot.inputData = [];
				await sleep(150);
				bot.moveVector = { x: 0, z: 1 }; bot.inputData = ["up"];
				await sleep(2500);
				bot.moveVector = { x: 0, z: 0 }; bot.inputData = [];
				await sleep(1200);
			});
			const tap = logLines(iso, "[limites] input");
			const on = tap.filter((l) => l.includes("sprint=true"));
			t.step(`sprint/duplo toque: ${on.length} amostras correndo; ${tap.filter((_, i) => i % 3 === 0).slice(0, 8).map(short).join(" || ")}`);
			results.sprintTap = on.length > 0;
			const speeds = on.map((l) => Number(/vel=([0-9.]+)/.exec(l)?.[1] ?? NaN));
			// Velocidade real da montaria (blocos/s) entre amostras seguidas (5 ticks = 0,25 s).
			const pos = (l) => { const m = /pos=\(([-0-9.]+),([-0-9.]+)\)/.exec(l); return m ? { x: Number(m[1]), z: Number(m[2]) } : undefined; };
			const bps = (lines) => lines.slice(1).map((l, i) => { const a = pos(lines[i]), b = pos(l); return a && b ? +(Math.hypot(b.x - a.x, b.z - a.z) / 0.25).toFixed(2) : NaN; });
			results.walkBps = bps(walk.slice(-4));
			results.sprintBps = bps(on);
			t.step(`sprint/velocidade real (b/s): andando ${json(results.walkBps)} | correndo ${json(results.sprintBps)}`);
			results.sprintAccelerates = speeds.length > 2 && speeds.at(-1) > speeds[0];
			results.sprintDrains = on.length > 1 && Number(/folego=([0-9.]+)/.exec(on.at(-1))?.[1]) < 1;
			results.sprintStops = tap.slice(-2).every((l) => l.includes("sprint=false"));
			const fovs = raw.map(decodeFov).filter(Boolean);
			t.step(`sprint/FOV (camera_instruction cru): ${json(fovs)}`);
			results.fov = fovs;

			// Controle (analógico 0,8) e toque: mesmo gatilho.
			for (const mode of ["game_pad", "touch"]) {
				bot.inputMode = mode;
				bot.rotation = { pitch: 0, yaw: mode === "game_pad" ? 180 : 0 };
				await sleep(600);
				iso = since();
				bot.moveVector = { x: 0, z: 0.8 }; bot.inputData = ["up"];
				await sleep(100);
				bot.moveVector = { x: 0, z: 0 }; bot.inputData = [];
				await sleep(150);
				bot.moveVector = { x: 0, z: 0.8 }; bot.inputData = ["up"];
				await sleep(1500);
				bot.moveVector = { x: 0, z: 0 }; bot.inputData = [];
				await sleep(800);
				const lines = logLines(iso, "[limites] input");
				results[`sprint_${mode}`] = lines.some((l) => l.includes("sprint=true"));
				t.step(`sprint/${mode}: ${lines.filter((l) => l.includes("sprint=true")).slice(0, 2).map(short).join(" || ") || "não correu"}`);
			}
			bot.inputMode = "mouse";

			// Freelook: modo de câmera por jogador.
			const seen = [];
			const onPacket = (d) => { const n = d.data?.name; if (n === "clientbound_controls_scheme" || n === "camera_instruction") seen.push({ n, p: d.data.params }); };
			bot.client.on("packet", onPacket);
			iso = since();
			await bot.command("scriptevent cobblemon:ride_camera freelook");
			await sleep(1200);
			await bot.command("scriptevent cblimits:ride_camera_info");
			await sleep(500);
			await bot.command("scriptevent cobblemon:ride_camera auto");
			await sleep(1200);
			await bot.command("scriptevent cblimits:ride_camera_info");
			await sleep(500);
			bot.client.removeListener("packet", onPacket);
			for (const l of logLines(iso, "ride_camera_info")) t.step(`freelook: ${short(l)}`);
			t.step(`freelook: pacotes ${json(seen.map((s) => ({ n: s.n, p: s.n === "clientbound_controls_scheme" ? s.p : Object.keys(s.p).filter((k) => s.p[k]) })))}`);
			results.freelookSchemes = seen.filter((s) => s.n === "clientbound_controls_scheme").map((s) => s.p.scheme);

			// Roll (desligado por padrão): a sonda manda a spline com z; o efeito é do cliente.
			iso = since();
			await bot.command("scriptevent cblimits:camera_roll_test 30");
			await sleep(1000);
			t.step(`roll: ${logLines(iso, "camera_roll_test").map(short).join(" || ")}`);

			t.console("scriptevent cblimits:input_probe off");
			await bot.command("ride @s stop_riding");
			await sleep(800);
			await bot.command("kill @e[type=cobblemon:arcanine,r=30]");
		} catch (e) { t.warn(`sprint: ${e.message}`); bot.moveVector = { x: 0, z: 0 }; bot.inputData = []; }

		// ---------------------------------------------------------------- NPC com modelo de Pokémon (#53)
		let npc;
		try {
			await bot.teleport(base.x, base.y, base.z);
			await bot.command("kill @e[type=cobblemon:npc,r=40]");
			await sleep(800);
			const known = new Set(bot.findEntities((e) => e.type === "cobblemon:npc").map((e) => String(e.runtimeId)));
			await bot.command(`cobblemon:npcspawnat ${Math.floor(base.x)} ${base.y} ${Math.floor(base.z) + 4} cobblemon:standard`);
			npc = await bot.waitForEntity((e) => e.type === "cobblemon:npc" && !known.has(String(e.runtimeId)));
			await sleep(1500);

			// Editor (/npcedit), como o jogador faz: liga o behaviour "Identificador de recurso configurável"
			// (padrão cobblemon:pikachu, o mesmo do Java).
			const edit = async (change) => {
				bot.lookAt({ x: npc.position.x, y: npc.position.y + 1, z: npc.position.z });
				await sleep(400);
				const mark = bot.mark();
				await bot.command("cobblemon:npcedit");
				const form = await bot.waitForForm((f) => bot.forms.indexOf(f) >= mark.form && f.kind === "modal", { timeout: 15_000 });
				const values = modalDefaults(form);
				change(form, values);
				bot.answerForm(form, values);
				await sleep(2500);
				return form;
			};
			const pre = new Set(bot.findEntities((e) => e.type === "cobblemon:pikachu").map((e) => String(e.runtimeId)));
			await edit((form, values) => {
				const i = form.elements.findIndex((e) => /configurable_resource_identifier/.test(e.text));
				if (i < 0) throw new Error(`editor sem o behaviour: ${form.elements.map((e) => e.text).join(" | ")}`);
				values[i] = true;
			});
			const display = await bot.waitForEntity((e) => e.type === "cobblemon:pikachu" && !pre.has(String(e.runtimeId)), { timeout: 15_000 });
			await sleep(1500);
			let iso = since();
			t.console(`execute as @e[type=cobblemon:npc,x=${base.x},y=${base.y},z=${base.z},r=10,c=1] run scriptevent cblimits:npc_model_info`);
			await sleep(800);
			const info = logLines(iso, "npc_model_info");
			t.step(`npc_model (editor → pikachu): ${info.map((l) => l.replace(/.*npc_model_info /, "")).join(" || ")}`);
			results.npcModel = info.join("\n");
			results.npcModelSeated = /montada=true/.test(results.npcModel);
			t.step(`npc_model: propriedades do NPC vistas pelo bot = ${json(bot.entities.get(String(npc.runtimeId))?.properties ?? npc.properties)}`);

			// Cabeça: vira o NPC para o bot e confere a exibição.
			t.console(`execute as @e[type=cobblemon:npc,x=${base.x},y=${base.y},z=${base.z},r=10,c=1] at @s run tp @s ~ ~ ~ facing ${base.x + 3} ${base.y + 1} ${base.z + 4}`);
			await sleep(1000);
			iso = since();
			t.console(`execute as @e[type=cobblemon:npc,x=${base.x},y=${base.y},z=${base.z},r=10,c=1] run scriptevent cblimits:npc_model_info`);
			await sleep(800);
			const head = logLines(iso, "npc_model_info").map((l) => l.replace(/.*npc_model_info /, "")).join(" ");
			t.step(`npc_model (cabeça): ${head}`);
			const cab = /cabeça_npc=\(([-0-9.]+),([-0-9.]+)\)/.exec(head), rot = /rot_exib=\(([-0-9.]+),([-0-9.]+)\)/.exec(head);
			results.npcHeadFollows = !!cab && !!rot && Math.abs(((Number(cab[2]) - Number(rot[2]) + 540) % 360) - 180) < 5;

			// Clique na exibição e no NPC → diálogo do NPC.
			for (const [label, target] of [["exibição", display], ["NPC", npc]]) {
				const mark = bot.mark();
				bot.interact(bot.entities.get(String(target.runtimeId)) ?? target);
				try {
					const form = await bot.waitForForm((f) => bot.forms.indexOf(f) >= mark.form, { timeout: 12_000 });
					t.step(`npc_model: clique no ${label} abriu "${form.title}" [${form.buttons.join(" | ")}]`);
					results[`npcModelClick_${label}`] = true;
					bot.closeForm(form);
				} catch { results[`npcModelClick_${label}`] = false; t.warn(`npc_model: clique no ${label} não abriu diálogo`); }
				await dismissForms(bot, 1200);
			}

			// Troca a espécie pela variável do behaviour (como no Java): bulbasaur.
			const preB = new Set(bot.findEntities((e) => e.type === "cobblemon:bulbasaur").map((e) => String(e.runtimeId)));
			await edit((form, values) => {
				const i = form.elements.findIndex((e) => /variable\.resource_identifier\.name/.test(e.text));
				if (i < 0) throw new Error(`editor sem a variável: ${form.elements.map((e) => e.text).join(" | ")}`);
				values[i] = "cobblemon:bulbasaur";
			});
			try {
				await bot.waitForEntity((e) => e.type === "cobblemon:bulbasaur" && !preB.has(String(e.runtimeId)), { timeout: 15_000 });
				await sleep(800);
				results.npcModelSwap = !bot.entities.has(String(display.runtimeId));
				t.step(`npc_model: trocou para bulbasaur; pikachu removido=${results.npcModelSwap}`);
			} catch { results.npcModelSwap = false; t.warn("npc_model: troca de espécie não apareceu"); }
		} catch (e) { t.warn(`npc_model: ${e.message}`); }

		// ---------------------------------------------------------------- NPC escondido por jogador
		try {
			const viz = await t.bot("Viz");
			await dismissForms(viz, 800);
			await viz.teleport(base.x + 2, base.y, base.z);
			await bot.teleport(base.x, base.y, base.z);
			await sleep(2000);
			const overrides = [];
			bot.client.on("player_update_entity_overrides", (p) => overrides.push(json(p)));
			const vizOverrides = [];
			viz.client.on("player_update_entity_overrides", (p) => vizOverrides.push(json(p)));
			const sel = `@e[type=cobblemon:npc,x=${base.x},y=${base.y},z=${base.z},r=10,c=1]`;
			let iso = since();
			t.console(`execute as ${sel} run scriptevent cblimits:npc_hide ${bot.name} on`);
			await sleep(3000);
			t.console(`execute as ${sel} run scriptevent cblimits:npc_hide_info`);
			await sleep(600);
			t.step(`npc_hide: ${logLines(iso, "npc_hide_info").map((l) => l.replace(/.*npc_hide_info /, "")).join(" || ")}`);
			t.step(`npc_hide: overrides recebidos por Lim = ${overrides.join(" ; ")}`);
			t.step(`npc_hide: overrides recebidos por Viz = ${vizOverrides.join(" ; ") || "nenhum"}`);
			results.hideOverridesLim = overrides.length;
			results.hideOverridesViz = vizOverrides.length;
			// Clique: Lim (escondido) não abre nada, nem no NPC nem na exibição; Viz abre.
			const lnpc = bot.findEntities((e) => e.type === "cobblemon:npc")[0];
			const ldisp = bot.findEntities((e) => e.type === "cobblemon:bulbasaur")[0];
			let mark = bot.mark();
			if (lnpc) bot.interact(lnpc);
			await sleep(1500);
			if (ldisp) bot.interact(ldisp);
			await sleep(2500);
			results.hideLimForms = bot.forms.slice(mark.form).length;
			const vnpc = viz.findEntities((e) => e.type === "cobblemon:npc")[0];
			mark = viz.mark();
			if (vnpc) viz.interact(vnpc);
			try { const f = await viz.waitForForm((x) => viz.forms.indexOf(x) >= mark.form, { timeout: 10_000 }); results.hideVizForm = 1; viz.closeForm(f); }
			catch { results.hideVizForm = 0; }
			t.step(`npc_hide: forms ao clicar → Lim=${results.hideLimForms} Viz=${results.hideVizForm}`);
			iso = since();
			t.console(`execute as ${sel} run scriptevent cblimits:npc_hide ${bot.name} off`);
			await sleep(2500);
			t.console(`execute as ${sel} run scriptevent cblimits:npc_hide_info`);
			await sleep(600);
			t.step(`npc_hide off: ${logLines(iso, "npc_hide_info").map((l) => l.replace(/.*npc_hide_info /, "")).join(" || ")}; overrides Lim = ${overrides.length}`);
			viz.disconnect?.();
		} catch (e) { t.warn(`npc_hide: ${e.message}`); }

		t.step(`RESULTADOS ${json(results)}`);
		t.assert(results.web && results.web.spinarak > 5 && results.web.galvantula > 5 && results.web.ariados > 5 && results.web.caterpie < 2, "aranhas caem livres na teia; outra espécie fica presa");
		t.assert(results.sprintTap, "duplo toque liga o sprint montado");
		t.assert(results.npcModelSeated, "exibição montada no NPC");
		t.assert(results["npcModelClick_exibição"], "clique na exibição abre o diálogo do NPC");
		t.assert(results.hideLimForms === 0 && results.hideVizForm === 1, "NPC escondido: só quem vê interage");
	},
};
