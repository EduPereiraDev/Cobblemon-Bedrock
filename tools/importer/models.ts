// Índice e cópia das geometrias (bedrock/pokemon/models). O Cobblemon identifica o modelo pelo nome do
// arquivo ("cobblemon:pikachu_male.geo" → pikachu_male.geo.json); o Bedrock usa o identificador interno.
// Mantemos o identificador original quando ele é único; senão, renomeamos para geometry.<arquivo>.
import { basename, relative } from "node:path";
import { BEDROCK_POKEMON, HAND_RP, OUT_RP, count, readJson, splitId, tryReadJson, walk, warn, writeJson } from "./util.ts";
import { patchHeldItemBones } from "./mundoDetalhes.ts"; // frente mundo-detalhes: ossos do item segurado
import { recordEyeLocators } from "./visualFinal.ts"; // frente visual-final: locators de olho (alpha_eyes)
import { GEOMETRY_ID, dedupeLocators, locatorsOf, pinArmorNeckLocator } from "./locators.ts"; // frente cliente-modelos
import type { LocatorRegistry } from "./locators.ts";

export interface ModelInfo {
	/** Chave do Cobblemon, ex.: "pikachu_male.geo". */
	key: string;
	file: string;
	/** Identificador final no Bedrock. */
	geometryId: string;
	bones: Set<string>;
	outPath: string;
}

export class ModelIndex {
	models = new Map<string, ModelInfo>();

	constructor() {
		const files = walk(`${BEDROCK_POKEMON}/models`, (n) => n.endsWith(".json"));
		const idCount = new Map<string, number>();
		const raw = new Map<string, any>();
		for (const file of files) {
			const json = tryReadJson(file);
			if (!json) {
				warn("modelo com JSON inválido", basename(file));
				continue;
			}
			raw.set(file, json);
			for (const g of json["minecraft:geometry"] ?? []) {
				const id = g.description?.identifier;
				if (id) idCount.set(id, (idCount.get(id) ?? 0) + 1);
			}
		}
		// Identificadores já usados pelo RP escrito à mão não podem ser reaproveitados.
		for (const file of walk(`${HAND_RP}/models`, (n) => n.endsWith(".json"))) {
			for (const g of tryReadJson(file)?.["minecraft:geometry"] ?? []) {
				const id = g.description?.identifier;
				if (id) idCount.set(id, (idCount.get(id) ?? 0) + 100);
			}
		}
		const used = new Set<string>();
		for (const [file, json] of raw) {
			const key = basename(file, ".json");
			const geos: any[] = json["minecraft:geometry"] ?? [];
			if (!geos.length) {
				warn("modelo sem minecraft:geometry", key);
				continue;
			}
			const original: string = geos[0].description?.identifier ?? "";
			const base = `geometry.${key.replace(/\.geo$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_.\-]/g, "_")}`;
			let id = original && idCount.get(original) === 1 && GEOMETRY_ID.test(original) ? original : base;
			let n = 2;
			while (used.has(id)) id = `${base}_${n++}`;
			used.add(id);
			const bones = new Set<string>();
			for (const b of geos[0].bones ?? []) if (b.name) bones.add(b.name);
			const sub = relative(`${BEDROCK_POKEMON}/models`, file);
			this.models.set(key, { key, file, geometryId: id, bones, outPath: `${OUT_RP}/models/entity/pokemon/${sub}` });
		}
	}

	/** Resolve "cobblemon:pikachu_male.geo" → modelo. */
	get(modelId: string): ModelInfo | undefined {
		return this.models.get(splitId(modelId).path);
	}

	private written = new Set<string>();
	/** Locators finais de cada geometria gravada (frente cliente-modelos). */
	private finalLocators = new Map<string, Map<string, string>>();

	/**
	 * Copia a geometria (minificada, com o identificador final). Frente cliente-modelos: `registry` = locators já
	 * declarados pelas geometrias anteriores da mesma client entity (ver locators.ts); `multi` = a entidade tem mais de
	 * uma geometria.
	 */
	emit(info: ModelInfo, registry?: LocatorRegistry, multi = false): void {
		if (this.written.has(info.key)) {
			// Já gravada por outra entidade: só entra na tabela desta (o validador acusa se colidir).
			if (registry) for (const [name, def] of this.finalLocators.get(info.key) ?? []) if (!registry.has(name)) registry.set(name, def);
			return;
		}
		this.written.add(info.key);
		const json = readJson(info.file);
		const geo = json["minecraft:geometry"][0];
		geo.description.identifier = info.geometryId;
		wrapRootPart(geo);
		patchHeldItemBones(geo, info.geometryId);
		if (registry) {
			if (multi && pinArmorNeckLocator(geo)) count("geometrias com armor_offset.default_neck fixo (várias formas)");
			const renamed = dedupeLocators(geo, registry, info.geometryId);
			if (renamed.size) count("locators renomeados (colidiam com outra geometria da entidade)", renamed.size);
		}
		this.finalLocators.set(info.key, locatorsOf(geo));
		recordEyeLocators(geo, info.geometryId);
		writeJson(info.outPath, { format_version: json.format_version ?? "1.12.0", "minecraft:geometry": [geo] });
	}

	get emittedCount(): number {
		return this.written.size;
	}
}

/**
 * Envolve os ossos de topo num osso "root_part" sem cubos. No Cobblemon, animações que citam "root_part" mexem no
 * rootPart do poser (BedrockAnimation.kt); as animações genéricas de golpe (bedrock/generic/animations) usam só
 * esse osso. O pivô é o do (primeiro) osso de topo, que quase sempre é o rootPart do poser.
 */
export function wrapRootPart(geo: any): void {
	const bones: any[] = geo?.bones ?? [];
	if (!bones.length || bones.some((b) => b.name === "root_part")) return;
	const tops = bones.filter((b) => !b.parent);
	if (!tops.length) return;
	const pivot = Array.isArray(tops[0].pivot) ? [...tops[0].pivot] : [0, 0, 0];
	for (const b of tops) b.parent = "root_part";
	geo.bones = [{ name: "root_part", pivot }, ...bones];
}
