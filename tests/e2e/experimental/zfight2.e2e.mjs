// Frente zfight2 (docs/pendencias/zfight2.md): as espécies citadas no teste em cliente (Eternatus, Chandelure, Mamoswine,
// Arbok/Ekans) e mais algumas nascem no BDS sem ERROR/WARN de conteúdo. O BDS não carrega o resource pack (materiais,
// geometrias e render controllers): a prova do z-fighting é o detector (`npm run validate`, zfightReport.ts); aqui
// fica a prova de que o pack com o materials/entity.material novo sobe e as entidades nascem.
//
//   COBBLEMON_BDS=zf2 COBBLEMON_BDS_PORT=19184 COBBLEMON_DIST=dist-zf2 COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/zfight2.e2e.mjs
import { sleep } from "../lib/bot.mjs";
import { arena, dismissForms, setupWithPokemon, spawnWild } from "../lib/flows.mjs";
import { logSince, problemLines } from "../lib/server.mjs";

const SPECIES = ["eternatus", "chandelure", "mamoswine", "arbok", "ekans", "charizard", "venusaur", "hatterene", "litwick", "piloswine"];

export default {
	name: "zfight2: espécies citadas (normal e shiny) nascem sem ERROR/WARN de conteúdo",
	timeout: 600_000,
	async run(t) {
		const bot = await t.bot("Zf2");
		await setupWithPokemon(bot, "pikachu level=20");
		await dismissForms(bot, 1500);
		const since = new Date().toISOString();
		await arena(bot);
		let spawned = 0;
		for (const sp of SPECIES) {
			for (const shiny of [false, true]) {
				const mark = bot.mark();
				const out = await bot.command(`cobblemon:spawnpokemon ${sp} 30 ${shiny} ~3 ~ ~3`);
				void mark;
				if (out && !out.success) { t.step(`${sp}${shiny ? " shiny" : ""}: spawnpokemon falhou ${JSON.stringify(out.output).slice(0, 200)}`); continue; }
				spawned++;
			}
			await sleep(1500);
			await bot.command(`kill @e[type=cobblemon:${sp},r=24]`);
		}
		// Um de cada pelo helper (confere que a entidade chega ao cliente de protocolo).
		const seen = await spawnWild(bot, "arbok", { level: 20 });
		t.step(`arbok visto pelo bot: ${seen?.type}`);
		await sleep(3000);
		const problems = problemLines(logSince(since));
		for (const l of problems.slice(0, 20)) t.step(`log: ${l.slice(0, 300)}`);
		t.step(`${spawned}/${SPECIES.length * 2} spawns; ${problems.length} linha(s) ERROR/WARN desde o início do cenário`);
		if (spawned !== SPECIES.length * 2) throw new Error("spawn falhou");
		if (problems.length) throw new Error(`${problems.length} linha(s) ERROR/WARN`);
	},
};
