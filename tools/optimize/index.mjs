// Frente otimizacao: etapa do build que deixa o pack montado (dist/) menor e com menos arquivos, SEM mudar nada no jogo.
// Roda no tools/build.mjs depois de juntar generated/ + packs escritos à mão (+ pack MSD, se houver) e antes do bundle
// dos scripts. `COBBLEMON_OPT=0` desliga (depuração). `COBBLEMON_OPT_VERIFY=1` reconfere todo PNG do cache.
//   #4/#15 arquivos idênticos (OGG/PNG/JSON)   dedupe.mjs
//   #14    geometrias idênticas                dedupe.mjs
//   #10    render controllers idênticos         renderControllers.mjs
//   #11    arquivos pequenos em lotes           bundle.mjs
//   #2     PNG sem perda                        png.mjs
// Por que no build e não no import: os testes, validadores e o diff do pack MSD (megaShowdown.ts) leem generated/
// arquivo a arquivo; o dist/ é o que vai para o jogo e já tem tudo junto (escrito à mão incluído), então as
// referências são todas visíveis aqui.
// PROVAS (lançam erro e o build falha), comparando o pack antes e depois desta etapa (relidos do disco):
//   - toda string JSON que resolvia para um arquivo resolve para um arquivo com o mesmo sha256;
//   - todo evento de som resolve para a mesma lista de sha256 (e os mesmos campos);
//   - toda referência a geometria resolve para o mesmo conteúdo; cada geometria removida tem uma idêntica que ficou;
//   - animações e animation controllers: o conjunto (id → format_version + conteúdo) é idêntico;
//   - cada client entity/attachable resolve a mesma lista (render controller, condição);
//   - todo PNG decodifica para o mesmo RGBA de 16 bits (png.mjs, na criação da entrada do cache).
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TokenIndex, canonical, forEachString, listFiles } from "./common.mjs";
import { dedupeFiles, dedupeGeometries, fileReferenceHashes, geometryBody, geometryDefinitions, geometryReferenceBodies, loadJsonTree, soundEventHashes } from "./dedupe.mjs";
import { renderControllerDefinitions, renderControllerResolution, shareRenderControllers } from "./renderControllers.mjs";
import { BUNDLE_TYPES, bundleSmallFiles, definitionSets } from "./bundle.mjs";
import { optimizePngFiles } from "./png.mjs";

/** Pastas cujos JSON mudam de arquivo (lotes, controllers compartilhados): a prova de referência é por multiconjunto. */
const MOVED = ["animations/", "animation_controllers/", "models/", "render_controllers/"];
const isMoved = (key) => MOVED.some((d) => key.split("|")[1].startsWith(d));

export function loadPack(dir, skip = []) {
	const files = listFiles(dir).filter((rel) => !skip.some((d) => rel.startsWith(d)));
	return { dir, files, fileSet: new Set(files), docs: loadJsonTree(dir, files) };
}

function listTs(dir) {
	return listFiles(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs")).map((f) => join(dir, f));
}

/**
 * Tokens dos textos que esta etapa NÃO reescreve: fontes dos scripts (scripts/, generated/scripts/) e JSON UI do RP.
 * Cada token entra também sem o namespace ("cobblemon:"), sem a extensão e em pedaços por "/" e ":".
 */
export function buildTokenIndex(texts) {
	const idx = new TokenIndex();
	const extra = [];
	for (const text of texts) {
		idx.addText(text);
	}
	for (const t of idx.tokens) {
		const noNs = t.replace(/^[a-z0-9_.-]+:/, "");
		const noExt = noNs.replace(/\.(png|ogg|json|tga|wav|fsb)$/i, "");
		extra.push(noNs, noExt);
		for (const seg of noNs.split(/[/:]/)) extra.push(seg, seg.replace(/\.(png|ogg|json|tga|wav|fsb)$/i, ""));
	}
	for (const e of extra) if (e) idx.tokens.add(e);
	idx.byRoot.clear();
	return idx;
}

/** Strings (valores e chaves) de todos os JSON de um pack: o que o pack MSD cita do base. */
function packStrings(pack) {
	const out = new Set();
	for (const doc of pack.docs.values()) forEachString(doc, (s) => { out.add(s); out.add(s.replace(/\.(png|ogg|json|tga)$/i, "")); });
	return out;
}

export function proofSnapshot(packs, contentKey) {
	const refs = fileReferenceHashes(packs, contentKey);
	const fixed = new Map();
	const moved = [];
	for (const [k, h] of refs) (isMoved(k) ? moved.push(h) : fixed.set(k, h));
	return {
		fixedRefs: fixed,
		movedRefs: moved.sort().join(","),
		sounds: soundEventHashes(packs.rp),
		geoRefs: geometryReferenceBodies(packs),
		geoDefs: geometryDefinitions(packs.rp),
		rc: renderControllerResolution(packs.rp),
		rcDefs: renderControllerDefinitions(packs.rp),
		defs: definitionSets(packs.rp),
		files: { rp: packs.rp.files.length, bp: packs.bp.files.length },
	};
}

function compareMaps(label, a, b, errors, filter = () => true) {
	let n = 0;
	for (const [k, v] of a) {
		if (!filter(k)) continue;
		n++;
		if (!b.has(k)) errors.push(`${label}: ${k} sumiu`);
		else if (b.get(k) !== v) errors.push(`${label}: ${k} mudou`);
		if (errors.length > 30) return n;
	}
	for (const k of b.keys()) if (filter(k) && !a.has(k)) errors.push(`${label}: ${k} apareceu`);
	return n;
}

/** Confere as provas; devolve a lista de erros (vazia = equivalente). `removedGeometries` = ids tirados pelo #14. */
export function checkProofs(before, after, removedGeometries) {
	const errors = [];
	const counts = {};
	counts.referencias = compareMaps("referência a arquivo", before.fixedRefs, after.fixedRefs, errors);
	if (before.movedRefs !== after.movedRefs) errors.push("referência a arquivo dentro de animações/controllers/geometrias mudou");
	counts.eventosDeSom = compareMaps("evento de som", before.sounds, after.sounds, errors);
	counts.referenciasAGeometria = compareMaps("referência a geometria", before.geoRefs, after.geoRefs, errors);
	counts.entidadesComRenderControllers = compareMaps("render controllers da entidade", before.rc, after.rc, errors);
	for (const type of BUNDLE_TYPES) {
		const a = before.defs[type.dir], b = after.defs[type.dir];
		const skip = type.dir === "models/" ? removedGeometries : new Set();
		const flat = (m) => new Map([...m].filter(([id]) => !skip.has(id)).map(([id, list]) => [id, list.join("\n")]));
		counts[`definicoes ${type.dir}`] = compareMaps(`definição em ${type.dir}`, flat(a), flat(b), errors);
	}
	// Cada geometria removida tem uma idêntica (menos o identifier) que ficou.
	const bodiesAfter = new Set([...after.geoDefs.values()].map((l) => geometryBody(l[0])));
	for (const id of removedGeometries) {
		const def = before.geoDefs.get(id)?.[0];
		if (!def || !bodiesAfter.has(geometryBody(def))) errors.push(`geometria removida ${id} sem cópia idêntica`);
	}
	// Render controllers que não foram compartilhados continuam iguais (inclusive os que nenhuma entidade usa).
	for (const [id, list] of before.rcDefs) {
		const now = after.rcDefs.get(id);
		if (!now) continue;
		if (now.length !== list.length || canonical(now.map((x) => [x.fv, x.def])) !== canonical(list.map((x) => [x.fv, x.def]))) errors.push(`render controller ${id} mudou`);
	}
	return { errors, counts };
}

/**
 * Otimiza os packs base em `rp`/`bp` (dist/). `msdRp`/`msdBp` = packs MSD no mesmo dist (protegem o que eles citam ou
 * sobrescrevem). Lança erro se alguma prova falhar.
 */
export async function optimizeDist({ root, rp: rpDir, bp: bpDir, msdRp, msdBp, log = console.log, cacheDir, verifyPngs = process.env.COBBLEMON_OPT_VERIFY === "1" }) {
	const started = Date.now();
	const t = (label, since) => log(`  otimização: ${label} em ${Date.now() - since}ms`);
	let phase = Date.now();
	const packs = { rp: loadPack(rpDir), bp: loadPack(bpDir, ["scripts/"]) };
	const sizeBefore = { rp: packs.rp.files.reduce((n, f) => n + statSync(join(rpDir, f)).size, 0), bp: packs.bp.files.reduce((n, f) => n + statSync(join(bpDir, f)).size, 0) };
	// Guardas.
	const texts = [...listTs(join(root, "scripts")), ...listTs(join(root, "generated", "scripts"))].map((f) => readFileSync(f, "utf8"));
	for (const rel of packs.rp.files) if (rel.startsWith("ui/")) texts.push(readFileSync(join(rpDir, rel), "utf8"));
	const tokens = buildTokenIndex(texts);
	const protectedPaths = new Set();
	const protectedStrings = new Set();
	for (const [kind, dir] of [["rp", msdRp], ["bp", msdBp]]) {
		if (!dir || !existsSync(dir)) continue;
		const pack = loadPack(dir);
		for (const rel of pack.files) protectedPaths.add(`${kind}:${rel}`);
		for (const s of packStrings(pack)) protectedStrings.add(s);
	}
	const binaries = packs.bp.files.filter((f) => f.endsWith(".mcstructure")).map((f) => readFileSync(join(bpDir, f)));
	const guard = { tokens, protectedPaths, protectedStrings, binaries };
	const before = proofSnapshot(packs);
	t(`leitura e prova "antes" (${packs.rp.files.length} + ${packs.bp.files.length} arquivos${protectedPaths.size ? `, ${protectedPaths.size} protegidos pelo MSD` : ""})`, phase);

	const dirty = new Set();
	phase = Date.now();
	const files = dedupeFiles(packs, guard, dirty);
	const geometries = dedupeGeometries(packs, guard, dirty);
	const renderControllers = shareRenderControllers(packs, guard);
	for (const rel of renderControllers.dirty) dirty.add(`rp:${rel}`);
	for (const key of dirty) {
		const [kind, rel] = [key.slice(0, 2), key.slice(3)];
		const pack = packs[kind];
		if (pack.docs.has(rel) && pack.fileSet.has(rel)) writeFileSync(join(pack.dir, rel), JSON.stringify(pack.docs.get(rel)));
	}
	const bundles = bundleSmallFiles(packs.rp, guard, (rel) => statSync(join(rpDir, rel)).size);
	t("duplicatas, render controllers e lotes", phase);

	// Provas (relendo do disco).
	phase = Date.now();
	const removedGeometries = new Set([...before.geoDefs.keys()].filter((id) => !geometryDefinitions(packs.rp).has(id)));
	const fresh = { rp: loadPack(rpDir), bp: loadPack(bpDir, ["scripts/"]) };
	const after = proofSnapshot(fresh);
	const proof = checkProofs(before, after, removedGeometries);
	t("prova \"depois\"", phase);
	if (proof.errors.length) throw new Error(`otimização: prova de equivalência falhou (${proof.errors.length}):\n  ${proof.errors.slice(0, 30).join("\n  ")}`);

	phase = Date.now();
	const pngFiles = [...fresh.rp.files.filter((f) => f.endsWith(".png")).map((f) => join(rpDir, f)), ...fresh.bp.files.filter((f) => f.endsWith(".png")).map((f) => join(bpDir, f))];
	const png = await optimizePngFiles(pngFiles, cacheDir ?? join(root, "node_modules", ".cache", "cobblemon-opt", "png"), { verifyAll: verifyPngs, log });
	t(`PNG (${png.cacheHits} do cache)`, phase);

	const sizeAfter = { rp: listFiles(rpDir).reduce((n, f) => n + statSync(join(rpDir, f)).size, 0), bp: listFiles(bpDir).filter((f) => !f.startsWith("scripts/")).reduce((n, f) => n + statSync(join(bpDir, f)).size, 0) };
	const report = {
		durationMs: Date.now() - started,
		files: { before: before.files, after: { rp: listFiles(rpDir).length, bp: listFiles(bpDir).filter((f) => !f.startsWith("scripts/")).length } },
		bytes: { before: sizeBefore, after: sizeAfter },
		dedupeFiles: files,
		dedupeGeometries: geometries,
		renderControllers: { ...renderControllers, dirty: renderControllers.dirty.size },
		bundles,
		png,
		proof: proof.counts,
		protectedByMsd: protectedPaths.size,
	};
	const mb = (n) => (n / 1048576).toFixed(1);
	log(`otimização: RP ${report.files.before.rp} → ${report.files.after.rp} arquivos (${mb(sizeBefore.rp)} → ${mb(sizeAfter.rp)} MB), BP ${report.files.before.bp} → ${report.files.after.bp} (${mb(sizeBefore.bp)} → ${mb(sizeAfter.bp)} MB) em ${(report.durationMs / 1000).toFixed(1)}s; provas OK`);
	return report;
}
