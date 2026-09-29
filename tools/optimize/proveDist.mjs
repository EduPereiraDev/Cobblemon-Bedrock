// Frente otimizacao: prova independente entre dois builds do MESMO generated/ (sem × com a etapa de otimização).
//   COBBLEMON_OPT=0 COBBLEMON_DIST=dist-a npm run build:public
//   COBBLEMON_DIST=dist-b npm run build:public
//   node tools/optimize/proveDist.mjs dist-a dist-b
// Refaz as provas do index.mjs lendo as duas pastas (não o antes/depois do mesmo processo) e decodifica TODOS os PNG
// dos dois lados (RGBA 16 bits): 0 diferenças para passar. Sai com código 1 se falhar.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkProofs, loadPack, proofSnapshot } from "./index.mjs";
import { geometryDefinitions } from "./dedupe.mjs";
import { decodeRgba16 } from "./png.mjs";
import { forEachString, listFiles, sha256 } from "./common.mjs";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("uso: proveDist.mjs <dist-sem-otimização> <dist-otimizado>"); process.exit(2); }
const PACK = "CobblemonBedrock";
const load = (d) => ({ rp: loadPack(join(d, "resource_packs", PACK)), bp: loadPack(join(d, "behavior_packs", PACK), ["scripts/"]) });
const A = load(a), B = load(b);
// Referência a PNG: hash dos pixels decodificados (os bytes mudam na recompressão; a imagem não pode mudar).
const pixelKey = (rel, buf) => {
	if (!rel.endsWith(".png")) return sha256(buf);
	const { width, height, rgba } = decodeRgba16(buf);
	return `png:${width}x${height}:${sha256(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength))}`;
};
const sa = proofSnapshot(A, pixelKey), sb = proofSnapshot(B, pixelKey);
const defsB = geometryDefinitions(B.rp);
const removed = new Set([...sa.geoDefs.keys()].filter((id) => !defsB.has(id)));
const { errors, counts } = checkProofs(sa, sb, removed);
console.log("provas estruturais:", JSON.stringify(counts));

// PNG: todo PNG que existe nos dois lados decodifica igual; os que sumiram (duplicatas) já estão cobertos pela prova de
// referência (mesmo sha256 do arquivo original).
let pngs = 0, diffs = 0, bytesA = 0, bytesB = 0;
for (const kind of ["resource_packs", "behavior_packs"]) {
	const da = join(a, kind, PACK), db = join(b, kind, PACK);
	for (const rel of listFiles(da)) {
		if (!rel.endsWith(".png") || !existsSync(join(db, rel))) continue;
		const x = readFileSync(join(da, rel)), y = readFileSync(join(db, rel));
		bytesA += x.length; bytesB += y.length;
		pngs++;
		const pa = decodeRgba16(x), pb = decodeRgba16(y);
		let same = pa.width === pb.width && pa.height === pb.height && pa.rgba.length === pb.rgba.length;
		for (let i = 0; same && i < pa.rgba.length; i++) if (pa.rgba[i] !== pb.rgba[i]) same = false;
		if (!same) { diffs++; if (diffs <= 10) errors.push(`PNG diferente: ${kind}/${rel}`); }
	}
}
console.log(`PNG: ${pngs} comparados pixel a pixel (RGBA 16 bits), ${diffs} diferentes; ${(bytesA / 1048576).toFixed(2)} → ${(bytesB / 1048576).toFixed(2)} MB`);
// Pack MSD (build de desenvolvimento/privado): o pack não muda, e tudo o que ele cita do base (caminho de arquivo ou id
// de animação/controller/geometria/render controller) resolve para o mesmo conteúdo no base otimizado.
const MSD = "CobblemonMegaShowdown";
if (existsSync(join(a, "resource_packs", MSD)) && existsSync(join(b, "resource_packs", MSD))) {
	let files = 0, cited = 0;
	for (const kind of ["resource_packs", "behavior_packs"]) {
		const ma = join(a, kind, MSD), mb = join(b, kind, MSD);
		const la = listFiles(ma), lb = listFiles(mb);
		if (la.join("\n") !== lb.join("\n")) errors.push(`pack MSD (${kind}): lista de arquivos mudou`);
		for (const rel of la) {
			files++;
			if (!readFileSync(join(ma, rel)).equals(readFileSync(join(mb, rel)))) errors.push(`pack MSD (${kind}): ${rel} mudou`);
		}
	}
	const msd = { rp: loadPack(join(a, "resource_packs", MSD)), bp: loadPack(join(a, "behavior_packs", MSD)) };
	const strings = new Set();
	for (const pk of Object.values(msd)) for (const doc of pk.docs.values()) forEachString(doc, (s) => strings.add(s));
	// Caminhos de arquivo do base citados pelo MSD.
	for (const [name, pa] of Object.entries(A)) {
		const pb = B[name];
		for (const s of strings) for (const cand of [s, `${s}.png`, `${s}.ogg`, `${s}.json`, `${s}.tga`]) {
			if (!pa.fileSet.has(cand)) continue;
			cited++;
			if (!pb.fileSet.has(cand)) { errors.push(`MSD cita ${name}:${cand}, que sumiu do base`); break; }
			const x = readFileSync(join(pa.dir, cand)), y = readFileSync(join(pb.dir, cand));
			if (pixelKey(cand, x) !== pixelKey(cand, y)) errors.push(`MSD cita ${name}:${cand}, que mudou no base`);
			break;
		}
	}
	// Ids de definição do base citados pelo MSD.
	const defsOf = (snap) => {
		const m = new Map();
		for (const [dir, defs] of Object.entries(snap.defs)) for (const [id, list] of defs) m.set(id, `${dir}|${[...list].sort().join("\n")}`);
		for (const [id, list] of snap.rcDefs) m.set(id, `rc|${list.map((x) => `${x.fv}|${JSON.stringify(x.def)}`).sort().join("\n")}`);
		return m;
	};
	const da = defsOf(sa), db = defsOf(sb);
	for (const s of strings) {
		if (!da.has(s)) continue;
		cited++;
		if (da.get(s) !== db.get(s)) errors.push(`MSD cita a definição ${s}, que mudou ou sumiu no base`);
	}
	console.log(`MSD: ${files} arquivos do pack idênticos; ${cited} arquivos/definições do base citados pelo MSD com o mesmo conteúdo`);
}

if (errors.length) {
	for (const e of errors.slice(0, 40)) console.error(`FALHA ${e}`);
	process.exit(1);
}
console.log("prova do dist: OK (0 diferenças)");
