// Frente fix3 (docs/pendencias/cliente-teste2.md): enquadramento do Java para o estúdio 3D das telas.
//
// No Java o modelo das telas do inicial e do resumo é desenhado pelo ModelWidget (StarterSelectionScreen/Summary) com
// drawProfilePokemon(profileTransformType = SUMMARY): escala `baseScale × 20 × profileScale` px da GUI por bloco do
// modelo e a origem (pés) em `topo + offsetY + baseScale × 20 × (ty + 1,5 × profileScale)`, com `profileScale` e
// `profileTranslation` (ou as versões `profileSummary*`) de cada poser — valores ajustados à mão pelo Cobblemon para
// cada espécie caber na janela. O estúdio (scripts/ui/studio/Studio.ts) usa os mesmos números para a câmera.
import type { VariantsEntry } from "./scriptsOut.ts";
import { PortraitPoserIndex } from "./portraits/posers.ts";
import { OUT_SCRIPTS, splitId, writeText } from "./util.ts";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** generated/scripts/studioFraming.ts: poser → [profileScale, tx, ty] (só os diferentes de [1, 0, 0]). */
export function emitStudioFramingModule(variants: Map<string, VariantsEntry>): number {
	const posers = new PortraitPoserIndex();
	const out = new Map<string, [number, number, number]>();
	for (const entry of variants.values()) {
		for (const combo of entry.combos) {
			const name = splitId(combo.poser ?? "").path;
			if (!name || out.has(name)) continue;
			const p = posers.get(combo.poser);
			out.set(name, [r3(p.profileScale), r3(p.profileTranslation[0]), r3(p.profileTranslation[1])]);
		}
	}
	const lines = [...out]
		.filter(([, v]) => v[0] !== 1 || v[1] !== 0 || v[2] !== 0)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)},`);
	writeText(
		`${OUT_SCRIPTS}/studioFraming.ts`,
		`// Arquivo gerado por tools/importer/studioFraming.ts (npm run import). Não edite à mão.
/* eslint-disable */

/** Poser → [profileScale, profileTranslation.x, profileTranslation.y] do Java (profileSummary* quando existem). Ausente = [1, 0, 0]. */
export const PROFILE_FRAMING: Record<string, [number, number, number]> = {
${lines.join("\n")}
};
`,
	);
	return out.size;
}
