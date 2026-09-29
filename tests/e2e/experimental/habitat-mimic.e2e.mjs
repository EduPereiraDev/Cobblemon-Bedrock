// Frente habitat-mimic (tests/e2e/experimental; rodar com --scenario no servidor da frente):
//   COBBLEMON_BDS=hab COBBLEMON_BDS_PORT=19188 COBBLEMON_DIST=dist-hab COBBLEMON_BDS_TRANSPORT=raknet COBBLEMON_BDS_ONLINE_MODE=false \
//     node tools/e2e/run.mjs --scenario tests/e2e/experimental/habitat-mimic.e2e.mjs --keep
// - migração: bloco de habitat técnico de mundo antigo (pool de estrutura, sem o estado de imitado) vira o bloco imitado
//   + registro por posição;
// - worldgen: um habitat jigsaw gerado de verdade (locate) aparece convertido (bloco imitado) e sem bloco técnico;
// - estrutura de habitat (/structure load de um molde convertido): nenhum bloco técnico sobra; no lugar da âncora fica o
//   bloco imitado (rocky_outcrop → dripstone_block);
// - o habitat continua fazendo spawn (sonda hab_spawn: escolhas vindas das spawns do habitat);
// - quem segura o item de habitat recebe o contorno de partículas (só ele); sem o item, não;
// - op em criativo interagindo no bloco imitado abre o editor; não-op (deop) não abre.
import { readFileSync } from "node:fs";
import { readGeneratedTableText } from "../../../tools/importer/generatedTable.mjs"; // frente otimizacao (#8)
import { join } from "node:path";
import * as server from "../lib/server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HABITAT = "cobblemon:habitat_block";

function poolIndex(pool) {
	const text = readFileSync(join(server.root, "generated", "scripts", "habitats.ts"), "utf8");
	// Frente otimizacao (#8): a tabela pode estar em JSON.parse("…") ou em literal (generatedTable.mjs lê os dois).
	const index = readGeneratedTableText(text, "HABITAT_POOLS")[pool]?.index;
	if (index === undefined) throw new Error(`pool ${pool} sem índice em generated/scripts/habitats.ts`);
	return Number(index);
}

/** Roda uma sonda cobblemon:hab_* e espera a linha do log que casa com `match` (repete a sonda até `timeout`). */
async function probe(t, cmd, match, timeout = 20_000) {
	const end = Date.now() + timeout;
	let last = "";
	while (Date.now() < end) {
		const since = new Date(Date.now() - 1000).toISOString();
		t.console(`scriptevent cobblemon:hab_${cmd}`);
		await sleep(2500);
		const lines = server.logSince(since).split("\n").filter((l) => l.includes("[habitat-mimic]"));
		for (const l of lines) {
			last = l;
			const m = match(l);
			if (m) return { line: l, m };
		}
	}
	throw new Error(`sonda ${cmd}: nada casou em ${timeout / 1000} s (última: ${last || "nenhuma"})`);
}

/** Clique direito num bloco (inventory_transaction item_use/click_block): dispara playerInteractWithBlock. */
function clickBlock(bot, pos, face = 1) {
	bot.lookAt({ x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
	bot._sendTransaction({
		transaction: {
			legacy: { legacy_request_id: 0 },
			transaction_type: "item_use",
			actions: [],
			transaction_data: {
				action_type: "click_block",
				trigger_type: "player_input",
				block_position: pos,
				face,
				hotbar_slot: bot.selectedSlot,
				hand: "main_hand",
				held_item: bot.heldItem(),
				player_pos: { x: bot.position.x, y: bot.position.y, z: bot.position.z },
				click_pos: { x: 0.5, y: 1, z: 0.5 },
				block_runtime_id: 0,
				client_prediction: "success",
				client_cooldown_state: "off",
			},
		},
	});
}

export default {
	name: "habitat-mimic: bloco de habitat vira o bloco imitado (migração, estrutura, spawn, editor só op, contorno)",
	timeout: 480_000,
	async run(t) {
		const bot = await t.bot("Hab");
		t.console("scriptevent cobblemon:debug_probes on");
		await sleep(1000);
		const a = bot.anchor;

		// 1. Migração: bloco técnico antigo (pool rocky_outcrop, sem cobblemon:habitat_mimic) → dripstone + registro.
		const idx = poolIndex("cobblemon:rocky_outcrop");
		const old = { x: a.x + 2, y: a.y, z: a.z };
		t.console(`setblock ${old.x} ${old.y} ${old.z} ${HABITAT} ["cobblemon:habitat_pool"=${idx % 16},"cobblemon:habitat_pool_hi"=${Math.floor(idx / 16)}]`);
		const mig = await probe(t, `scan ${old.x} ${old.y} ${old.z} 1`, (l) => /técnicos=0 habitats=1 .*=minecraft:dripstone_block/.test(l), 60_000);
		t.step(`migração: ${mig.line.split("[habitat-mimic]")[1].trim()}`);

		// 2. Estrutura de habitat convertida (molde rocky_outcrop1): a âncora vira o bloco imitado.
		const st = { x: a.x + 24, y: a.y, z: a.z + 4 };
		t.console(`structure load cobblemon:habitats_rocky_outcrop1 ${st.x} ${st.y} ${st.z}`);
		const center = { x: st.x + 8, y: st.y + 8, z: st.z + 8 };
		const conv = await probe(t, `scan ${center.x} ${center.y} ${center.z} 16`, (l) => {
			const m = /técnicos=(\d+) habitats=(\d+) (.*)$/.exec(l);
			return m && m[1] === "0" && Number(m[2]) >= 1 && /=minecraft:dripstone_block/.test(m[3]) ? m : undefined;
		}, 180_000);
		t.step(`estrutura: ${conv.line.split("[habitat-mimic]")[1].trim()}`);
		const [hx, hy, hz] = conv.m[3].split("=")[0].trim().split(/\s+/).map(Number);

		// 3. O habitat ainda faz spawn: spawns escolhidas perto dele vêm do pool do habitat (replaceSpawns).
		t.console("cobblemon:cobblemonconfig set enableSpawning true");
		const sp = await probe(t, `spawn ${hx} ${hy + 1} ${hz} 1`, (l) => {
			const m = /do habitat=(\d+)/.exec(l);
			return m && Number(m[1]) > 0 ? m : undefined;
		}, 60_000);
		t.step(`spawn: ${sp.line.split("[habitat-mimic]")[1].trim()}`);
		t.console("cobblemon:cobblemonconfig set enableSpawning false");

		// 4. Contorno: só quem segura o item de habitat recebe as partículas.
		let flames = 0;
		bot.client.on("spawn_particle_effect", (p) => { if (String(p.particle_name).includes("basic_flame_particle")) flames++; });
		await bot.teleport(a.x, a.y, a.z);
		t.console(`clear ${bot.name}`);
		t.console(`gamemode creative ${bot.name}`);
		t.console(`give ${bot.name} ${HABITAT} 4`);
		const id = bot.itemNetworkId(HABITAT);
		await bot.waitUntil(() => (bot.findSlot(id) >= 0 ? bot.findSlot(id) + 1 : undefined), 10_000, "item de habitat no inventário");
		const slot = bot.findSlot(id);
		await bot.selectSlot(slot === 0 ? 1 : 0); // mão vazia
		flames = 0;
		await sleep(3000);
		const emptyHand = flames;
		await bot.selectSlot(slot);
		flames = 0;
		await sleep(3000);
		const holding = flames;
		t.step(`contorno: mão vazia=${emptyHand} partículas, segurando o item=${holding}`);
		t.assert(emptyHand === 0, "sem o item de habitat, nenhum contorno");
		t.assert(holding > 0, "segurando o item de habitat, contorno dos habitats próximos");

		// 5. Editor: op em criativo abre; não-op não abre.
		const mark = bot.forms.length;
		clickBlock(bot, old);
		const form = await bot.waitForForm((f) => /cobblemon\.ui\.edit\.habitat/.test(f.title), { timeout: 15_000 });
		t.step(`op em criativo: editor aberto ("${form.title}")`);
		bot.closeForm(form);
		t.assert(bot.forms.length > mark, "form recebido");
		await sleep(1000);

		t.console(`deop ${bot.name}`);
		await sleep(2000);
		const before = bot.forms.length;
		clickBlock(bot, old);
		await sleep(6000);
		const opened = bot.forms.slice(before).filter((f) => /cobblemon\.ui\.edit\.habitat/.test(f.title)).length;
		t.step(`não-op: editores abertos=${opened}`);
		t.assert(opened === 0, "não-op não abre o editor de habitat");
		t.console(`op ${bot.name}`);
		t.console(`gamemode survival ${bot.name}`);
		const after = await probe(t, `scan ${old.x} ${old.y} ${old.z} 1`, (l) => /habitats=\d+/.test(l), 20_000);
		t.step(`depois: ${after.line.split("[habitat-mimic]")[1].trim()}`);

		// 6. Worldgen: habitat jigsaw gerado de verdade (locate + ir até lá): âncora já convertida, nenhum técnico.
		const since = new Date(Date.now() - 1000).toISOString();
		t.console("locate structure cobblemon:habitats_berry_patch");
		const loc = await bot.waitUntil(() => /nearest cobblemon:habitats_berry_patch is at block (-?\d+), \(y\?\), (-?\d+)/.exec(server.logSince(since)) ?? undefined, 60_000, "locate");
		const [gx, gz] = [Number(loc[1]), Number(loc[2])];
		t.console(`gamemode creative ${bot.name}`);
		await bot.teleport(gx, 110, gz);
		const found = await probe(t, `list ${gx} 72 ${gz} 96`, (l) => /pool=cobblemon:berry_patch .*bloco=minecraft:oak_leaves/.exec(l), 240_000);
		t.step(`worldgen: ${found.line.split("[habitat-mimic]")[1].trim()}`);
		const [wx, wy, wz] = found.line.split("[habitat-mimic]")[1].trim().split(/\s+/).slice(0, 3).map(Number);
		const scan = await probe(t, `scan ${wx} ${wy} ${wz} 24`, (l) => /técnicos=0 habitats=\d+/.test(l), 30_000);
		t.step(`worldgen scan: ${scan.line.split("[habitat-mimic]")[1].trim()}`);
		t.console(`gamemode survival ${bot.name}`);
	},
};
