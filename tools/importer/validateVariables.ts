// Frente cliente-teste3-log (docs/pendencias/cliente-teste3-log.md): regras do `npm run validate` para o que o 3º
// teste em cliente acusou e o BDS não vê (ele não carrega o resource pack). Cada regra corresponde a uma linha da
// tabela "Frente cliente-teste3-log" de tools/client-log-summary.mjs, que deve dar 0 no próximo teste:
//  1. partícula lê variável sem definir ("unknown variable" em particles/) ou usa struct (variable.color.r);
//  2. client entity lê variável (render controller, animação, animation controller) sem inicializar no
//     initialize/pre_animation ("unknown variable" em render_controllers/, animations/, animation_controllers/);
//  3. cubo de espessura zero (plano) em geometria de entidade: as duas faces no mesmo plano com o material de dois
//     lados das entidades (entity_alphatest etc.) brigam pela profundidade (z-fighting; zfight.ts).
// Os itens sem ícone (regra 4: "Missing icon for data-driven item") ficam em validateContent.ts.
import { existsSync, readFileSync } from "node:fs";
import { entityUndefinedVars, entityVarDocs, particleVariableProblems } from "./molangVars.ts";
import { flatEntityCubes } from "./zfight.ts";
import { oneSidedGeometries } from "./zfightEntities.ts"; // frente zfight2
import { rpMaterialFiles } from "./validateZFight.ts"; // frente zfight2
import { HAND_RP, OUT_RP, parseLenient, walk } from "./util.ts";

export interface VariableStats {
	particles: number;
	entities: number;
	geometries: number;
}

function load(file: string, err: (m: string) => void, rel: (f: string) => string): any {
	try { return parseLenient(readFileSync(file, "utf8")); }
	catch (e) { err(`JSON inválido: ${rel(file)}: ${(e as Error).message}`); return undefined; }
}

/**
 * @param docs arquivo → JSON (gerado, já mesclado com o escrito à mão no mesmo caminho, como o validate.ts monta).
 */
export function validateMolangVariables(docs: Map<string, any>, err: (m: string) => void, rel: (f: string) => string): VariableStats {
	const stats: VariableStats = { particles: 0, entities: 0, geometries: 0 };
	// Árvore do RP como vai para dist/: gerado (mesclado) + arquivos só do escrito à mão.
	const rp = new Map<string, any>();
	for (const [f, j] of docs) if (f.startsWith(OUT_RP)) rp.set(f.slice(OUT_RP.length), j);
	for (const f of walk(HAND_RP, (n) => n.endsWith(".json"))) {
		const key = f.slice(HAND_RP.length);
		if (!rp.has(key) && /^\/(particles|entity|animations|animation_controllers|render_controllers|models)\//.test(key)) rp.set(key, load(f, err, rel));
	}
	const where = (key: string) => (existsSync(OUT_RP + key) ? rel(OUT_RP + key) : rel(HAND_RP + key));

	// 1. Partículas.
	for (const [key, j] of rp) {
		if (!key.startsWith("/particles/") || !j?.particle_effect) continue;
		stats.particles++;
		for (const p of particleVariableProblems(j)) err(`${where(key)}: ${p}`);
	}

	// 2. Client entities.
	const index = entityVarDocs(rp);
	for (const [key, j] of rp) {
		const desc = j?.["minecraft:client_entity"]?.description;
		if (!desc) continue;
		stats.entities++;
		const missing = entityUndefinedVars(desc, index);
		if (missing.size) {
			const list = [...missing].slice(0, 6).map(([n, w]) => `v.${n} (${w})`).join(", ");
			err(`${where(key)}: ${desc.identifier} lê variável sem inicializar no initialize/pre_animation (o cliente acusa "unknown variable"): ${list}${missing.size > 6 ? ` … +${missing.size - 6}` : ""}`);
		}
	}

	// 3. Planos de espessura zero em geometrias de entidade (material de dois lados). Frente zfight2: geometria
	// desenhada só com material de um lado (Pokémon: entity_alphatest_one_sided/cobblemon_layer*) aceita o plano com
	// inflate negativo do Java (plano "de fundo"; com descarte de face de trás ele não briga).
	for (const [key, j] of rpMaterialFiles()) rp.set(key, j);
	const oneSided = oneSidedGeometries(rp);
	for (const [key, j] of rp) {
		if (!key.startsWith("/models/entity/")) continue;
		for (const g of j?.["minecraft:geometry"] ?? []) {
			stats.geometries++;
			const flat = flatEntityCubes(g, oneSided.has(g?.description?.identifier));
			if (flat.length) err(`${where(key)}: ${g?.description?.identifier} tem ${flat.length} cubo(s) de espessura zero (as duas faces no mesmo plano piscam com o material de entidade de dois lados): ${flat.slice(0, 3).join(", ")}`);
		}
	}
	return stats;
}
