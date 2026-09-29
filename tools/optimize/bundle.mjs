// Frente otimizacao (#11): menos arquivos, as MESMAS definições. O Bedrock aceita várias definições por arquivo em
// animações (`animations: {…}`), animation controllers (`animation_controllers: {…}`) e geometrias
// (`minecraft:geometry: […]`, formato 1.12+), como o vanilla faz (bedrock-samples: animations/*.animation.json com
// dezenas de ids, models/entity/*.geo.json com várias geometrias). Arquivos pequenos do mesmo tipo, da mesma pasta
// de 2º nível e do mesmo format_version viram lotes de até ~1 MB em `<pasta>/_opt/`.
// Fica de fora: arquivo com outras chaves no topo, arquivo sobrescrito pelo pack MSD, arquivo com algum id definido em
// mais de um arquivo (a ordem de carga decidiria qual vale), arquivo grande (> 256 KB, não ganha nada).
// Prova (index.mjs): o conjunto (id → format_version + conteúdo) de cada tipo é idêntico antes e depois.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonical } from "./common.mjs";

export const BUNDLE_TYPES = [
	{ dir: "animations/", key: "animations", suffix: ".animation.json", kind: "object" },
	{ dir: "animation_controllers/", key: "animation_controllers", suffix: ".animation_controllers.json", kind: "object" },
	{ dir: "models/", key: "minecraft:geometry", suffix: ".geo.json", kind: "geometry" },
];
const TARGET_BYTES = 1024 * 1024;
const MAX_MEMBER_BYTES = 256 * 1024;

/** (id, conteúdo) das definições de um doc do tipo. */
function definitionsOf(type, doc) {
	const v = doc?.[type.key];
	if (type.kind === "object") return v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v) : [];
	return Array.isArray(v) ? v.map((g) => [g?.description?.identifier, g]) : [];
}

/** Para cada tipo: id → [format_version|conteúdo canônico] (lista: um id pode aparecer mais de uma vez). */
export function definitionSets(rp) {
	const out = {};
	for (const type of BUNDLE_TYPES) {
		const m = new Map();
		for (const [rel, doc] of rp.docs) {
			if (!rel.startsWith(type.dir)) continue;
			for (const [id, def] of definitionsOf(type, doc)) (m.get(id) ?? m.set(id, []).get(id)).push(`${doc.format_version}|${canonical(def)}`);
		}
		out[type.dir] = m;
	}
	return out;
}

export function bundleSmallFiles(rp, guard, sizeOf) {
	const report = {};
	for (const type of BUNDLE_TYPES) {
		const r = (report[type.dir] = { filesBefore: 0, bundled: 0, bundles: 0, skipped: {} });
		const skip = (why) => { r.skipped[why] = (r.skipped[why] ?? 0) + 1; };
		const files = [...rp.docs.keys()].filter((rel) => rel.startsWith(type.dir)).sort();
		r.filesBefore = files.length;
		// Ids definidos em mais de um arquivo: todos esses arquivos ficam como estão.
		const where = new Map();
		for (const rel of files) for (const [id] of definitionsOf(type, rp.docs.get(rel))) (where.get(id) ?? where.set(id, new Set()).get(id)).add(rel);
		const multi = new Set();
		for (const rels of where.values()) if (rels.size > 1) for (const rel of rels) multi.add(rel);
		const areas = new Map(); // "pasta/2º nível|fv" → [rel]
		for (const rel of files) {
			const doc = rp.docs.get(rel);
			const keys = Object.keys(doc ?? {}).sort().join(",");
			let why;
			if (keys !== ["format_version", type.key].sort().join(",")) why = "chaves extras no topo";
			else if (typeof doc.format_version !== "string") why = "sem format_version";
			else if (type.kind === "geometry" && !/^1\.(1[2-9]|[2-9][0-9])\./.test(doc.format_version)) why = "geometria em formato antigo";
			else if (guard.protectedPaths.has(`rp:${rel}`)) why = "arquivo sobrescrito pelo pack MSD";
			else if (multi.has(rel)) why = "id definido em mais de um arquivo";
			else if (sizeOf(rel) > MAX_MEMBER_BYTES) why = "arquivo grande";
			else if (definitionsOf(type, doc).some(([id]) => !id)) why = "definição sem id";
			if (why) { skip(why); continue; }
			const parts = rel.split("/");
			const area = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
			const k = `${area}|${doc.format_version}`;
			(areas.get(k) ?? areas.set(k, []).get(k)).push(rel);
		}
		for (const [k, rels] of areas) {
			const [area, fv] = k.split("|");
			let batch = [];
			let bytes = 0;
			let n = 0;
			const flush = () => {
				if (batch.length >= 2) {
					const out = `${area}/_opt/${fv.replace(/[^0-9]/g, "_")}_${String(n++).padStart(3, "0")}${type.suffix}`;
					if (rp.fileSet.has(out)) throw new Error(`${out} já existe`);
					const merged = type.kind === "object" ? {} : [];
					for (const rel of batch) {
						const defs = rp.docs.get(rel)[type.key];
						if (type.kind === "object") Object.assign(merged, defs);
						else merged.push(...defs);
					}
					const doc = { format_version: fv, [type.key]: merged };
					mkdirSync(dirname(join(rp.dir, out)), { recursive: true });
					writeFileSync(join(rp.dir, out), JSON.stringify(doc));
					for (const rel of batch) {
						rmSync(join(rp.dir, rel));
						rp.docs.delete(rel);
						rp.fileSet.delete(rel);
					}
					rp.docs.set(out, doc);
					rp.fileSet.add(out);
					r.bundled += batch.length;
					r.bundles++;
				}
				batch = [];
				bytes = 0;
			};
			for (const rel of rels) {
				const size = sizeOf(rel);
				if (bytes + size > TARGET_BYTES && batch.length) flush();
				batch.push(rel);
				bytes += size;
			}
			flush();
		}
	}
	rp.files = [...rp.fileSet].sort();
	return report;
}
