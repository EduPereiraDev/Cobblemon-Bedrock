// Frente zfight2 (docs/pendencias/zfight2.md): regra do `npm run validate` com o detector de z-fighting das client
// entities de Pokémon (zfightEntities.ts) — camadas sobre a mesma geometria sem passar no empate de profundidade,
// planos/cubos invertidos com material de dois lados, faces coplanares do mesmo lado (mesmo osso e entre ossos, na
// pose de repouso) e geometrias diferentes desenhadas juntas. Roda no base (validate.ts) e na árvore base + MSD
// (validateMsd.ts chama o validate.ts sobre ela).
import { existsSync, readFileSync } from "node:fs";
import { HAND_RP, OUT_RP, parseLenient, walk } from "./util.ts";
import { entityZFightRisks, riskSummary } from "./zfightEntities.ts";

/**
 * Exceções justificadas (entidade → tipos de risco aceitos, com o porquê). Vazia: o import zera o detector.
 * Uma entrada aqui precisa de prova no docs/pendencias/zfight2.md.
 */
export const ZFIGHT_EXCEPTIONS: Record<string, { kinds: string[]; why: string }> = {};

/** Arquivos `.material` do RP (gerado + escrito à mão). */
export function rpMaterialFiles(): Array<[string, unknown]> {
	const out: Array<[string, unknown]> = [];
	for (const root of [HAND_RP, OUT_RP]) {
		for (const f of walk(`${root}/materials`, (n) => n.endsWith(".material"))) {
			try { out.push([f.slice(root.length), parseLenient(readFileSync(f, "utf8"))]); }
			catch { /* o JSON inválido é acusado pelo validate */ }
		}
	}
	return out;
}

/** Árvore do RP como vai para dist/ (gerado mesclado + só do escrito à mão), só o que o detector lê. */
export function rpTree(docs: Map<string, any>): Map<string, any> {
	const rp = new Map<string, any>();
	for (const [f, j] of docs) if (f.startsWith(OUT_RP)) rp.set(f.slice(OUT_RP.length), j);
	for (const f of walk(HAND_RP, (n) => n.endsWith(".json"))) {
		const key = f.slice(HAND_RP.length);
		if (rp.has(key) || !/^\/(entity|render_controllers|models\/entity)\//.test(key)) continue;
		try { rp.set(key, parseLenient(readFileSync(f, "utf8"))); }
		catch { /* acusado em outra regra */ }
	}
	for (const [key, j] of rpMaterialFiles()) rp.set(key, j);
	return rp;
}

export function validateEntityZFight(docs: Map<string, any>, err: (m: string) => void): { entities: number; summary: Record<string, number> } {
	if (!existsSync(OUT_RP)) return { entities: 0, summary: {} };
	const risks = entityZFightRisks(rpTree(docs));
	let shown = 0;
	for (const r of risks) {
		const accepted = ZFIGHT_EXCEPTIONS[r.entity]?.kinds ?? [];
		const open = Object.entries(r.risks).filter(([k]) => !accepted.includes(k));
		if (!open.length) continue;
		shown++;
		err(`z-fighting em ${r.entity}: ${open.map(([k, v]) => `${k}×${v!.count} (${v!.examples.join("; ")})`).join(" | ")}`);
	}
	return { entities: shown, summary: riskSummary(risks) };
}
