// Frente zfight2: relatório do detector de z-fighting nas client entities de Pokémon (zfightEntities.ts).
//   node --experimental-strip-types --no-warnings tools/importer/zfightReport.ts [--all] [--json] [espécie…]
// Lê o RP como vai para dist/: generated/ (base) + resource_packs/ à mão; com o pack do Mega Showdown gerado, também
// base + MSD (o pack de cima substitui o arquivo de mesmo caminho). Lista as espécies com risco e o motivo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HAND_RP, OUT_FINAL, PACK, parseLenient, walk } from "./util.ts";
import { entityZFightRisks, riskSummary } from "./zfightEntities.ts";
import type { EntityRisk } from "./zfightEntities.ts";

const RELEVANT = /^\/(entity|render_controllers|models\/entity|materials)\//;

/** Árvore do RP (caminho relativo → JSON) das pastas dadas, a de depois por cima. */
export function loadRp(dirs: string[]): Map<string, any> {
	const rp = new Map<string, any>();
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const f of walk(dir, (n) => n.endsWith(".json") || n.endsWith(".material"))) {
			const key = f.slice(dir.length).replace(/\\/g, "/");
			if (!RELEVANT.test(key)) continue;
			try { rp.set(key, parseLenient(readFileSync(f, "utf8"))); }
			catch { /* JSON inválido: o validate acusa */ }
		}
	}
	return rp;
}

export function reportSets(): Array<{ name: string; risks: EntityRisk[] }> {
	const base = join(OUT_FINAL, "resource_packs", PACK);
	const msd = join(OUT_FINAL, "resource_packs", "CobblemonMegaShowdown");
	const sets = [{ name: "base", risks: entityZFightRisks(loadRp([HAND_RP, base])) }];
	if (existsSync(msd)) sets.push({ name: "base + MSD", risks: entityZFightRisks(loadRp([HAND_RP, base, msd])) });
	return sets;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const all = args.includes("--all");
	const json = args.includes("--json");
	const only = args.filter((a) => !a.startsWith("--"));
	const sets = reportSets();
	if (json) console.log(JSON.stringify(sets, null, 1));
	else {
		for (const s of sets) {
			const risks = only.length ? s.risks.filter((r) => only.some((o) => r.entity === `cobblemon:${o}`)) : s.risks;
			console.log(`== ${s.name}: ${s.risks.length} client entit${s.risks.length === 1 ? "y" : "ies"} de Pokémon com risco; por tipo: ${JSON.stringify(riskSummary(s.risks))}`);
			for (const r of all || only.length ? risks : risks.slice(0, 40)) {
				console.log(`  ${r.entity}: ${Object.entries(r.risks).map(([k, v]) => `${k}×${v!.count} [${v!.examples.join("; ")}]`).join(" | ")}`);
			}
			if (!all && !only.length && risks.length > 40) console.log(`  … +${risks.length - 40} (--all lista todas)`);
		}
	}
}
