// Módulos TypeScript gerados para os scripts (generated/scripts/*.ts).
import { RUNTIME_RESOLVER_SOURCE } from "./variants.ts";
import type { Variation } from "./variants.ts";
import { OUT_SCRIPTS, writeText } from "./util.ts";
import { jsonTableExpression, objectLiteral, tableLines, typeCheckModule } from "./jsonTable.ts"; // frente otimizacao (#8)

const HEADER = "// Arquivo gerado por tools/importer (npm run import). Não edite à mão.\n/* eslint-disable */\n";

export function emitSpeciesModule(species: Map<string, Record<string, unknown>>): void {
	const lines = [...species].map(([id, data]) => `\t${JSON.stringify(id)}: ${JSON.stringify(JSON.stringify(data))},`);
	writeText(
		`${OUT_SCRIPTS}/species.ts`,
		`${HEADER}
/** JSON (string) de cada espécie, só com os campos usados em jogo. Parse sob demanda. */
export const SPECIES: Record<string, string> = {
${lines.join("\n")}
};
`,
	);
}

export interface VariantsEntry {
	variations: Variation[];
	combos: Array<{ poser: string; model: string; texture: string; layers: string[] }>;
}

export function emitVariantsModule(variants: Map<string, VariantsEntry>, poserAnimations: Map<string, Record<string, string>>): void {
	// Frente otimizacao (#8): VARIANTS por JSON.parse("…"); cópia tipada em _tipos/ para o tsc.
	const lines = tableLines(variants, "VARIANTS");
	writeText(`${OUT_SCRIPTS}/_tipos/variants.check.ts`, typeCheckModule("../variants", ["SpeciesVariants"], [{ name: "VARIANTS", type: "Record<string, SpeciesVariants>", literal: objectLiteral(lines) }]));
	const posers = [...poserAnimations].map(([id, v]) => `\t${JSON.stringify(id)}: ${JSON.stringify(v)},`);
	writeText(
		`${OUT_SCRIPTS}/variants.ts`,
		`${HEADER}
export interface VariantLayer {
	name: string;
	texture?: string;
	emissive?: boolean;
	translucent?: boolean;
}

export interface VariantVariation {
	aspects: string[];
	poser?: string;
	model?: string;
	texture?: string;
	layers?: VariantLayer[];
}

/** Combinação renderizável; o índice no array é o valor de \`cobblemon:variant\`. \`layers\` = "nome=textura". */
export interface VariantCombo {
	poser?: string;
	model: string;
	texture: string;
	layers: string[];
}

export interface SpeciesVariants {
	variations: VariantVariation[];
	combos: VariantCombo[];
}

/** Variações (na ordem dos resolvers do Cobblemon) e combinações por espécie. */
export const VARIANTS: Record<string, SpeciesVariants> = ${jsonTableExpression(lines, "VARIANTS")};

/**
 * Animações nomeadas por poser (cry, recoil, physical, special, status, faint, battle_cry...) → id completo,
 * para \`entity.playAnimation(id)\`. O poser de um Pokémon é \`VARIANTS[id].combos[variant].poser\`.
 */
export const POSER_ANIMATIONS: Record<string, Record<string, string>> = {
${posers.join("\n")}
};
${RUNTIME_RESOLVER_SOURCE}`,
	);
}

// O módulo de spawns (generated/scripts/spawns.ts) é gerado pela frente "spawn" em spawns.ts.
export { emitSpawnsModule } from "./spawns.ts";

export function emitBiomeTagsModule(tags: Record<string, string[]>): void {
	writeText(
		`${OUT_SCRIPTS}/biomeTags.ts`,
		`${HEADER}
/** Tags de bioma do Cobblemon (sem "#") → ids de bioma do Bedrock (sem namespace). */
export const BIOME_TAGS: Record<string, string[]> = {
${Object.entries(tags)
	.map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify(v)},`)
	.join("\n")}
};
`,
	);
}
