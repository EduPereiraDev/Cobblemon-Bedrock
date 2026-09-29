// Frente otimizacao (#4, #14, #15): duplicatas EXATAS no pack montado (dist/).
//   - arquivos idênticos byte a byte (OGG, PNG, JSON): fica UMA cópia e as referências em JSON passam a apontar para
//     ela. Só entra o arquivo que é referenciado apenas por valores JSON que esta etapa reescreve (sound_definitions
//     para som; JSON do RP fora de ui/ para textura; JSON do BP para loot). Se o nome aparece em código de script, em
//     JSON UI, em arquivo binário (.mcstructure), no pack MSD, ou se algum texto monta o caminho por prefixo, o arquivo
//     fica onde está (não dá para provar que ninguém o usa pelo nome).
//   - geometrias idênticas exceto pelo identifier (bagas): fica a primeira; as outras saem e as referências (se houver)
//     passam a apontar para ela.
// Prova (lança erro, o build falha): toda string JSON do pack que antes resolvia para um arquivo/geometria resolve
// depois para um arquivo com o MESMO sha256 / geometria com o mesmo conteúdo; e todo evento de som resolve para a
// mesma lista de hashes.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { canonical, forEachString, listFiles, readJsonLoose, sha256 } from "./common.mjs";

/** Onde cada tipo pode ser referenciado (e é reescrito). */
const KINDS = {
	".ogg": { pack: "rp", root: "sounds/", stripExt: true, contexts: (rel) => rel === "sounds/sound_definitions.json" },
	".png": { pack: "rp", root: "textures/", stripExt: true, contexts: (rel) => rel.endsWith(".json") && !rel.startsWith("ui/") },
	".json": { pack: "bp", root: "loot_tables/", stripExt: false, contexts: (rel) => rel.endsWith(".json") && !rel.startsWith("scripts/") },
};

/** Valor de referência de um arquivo (sem extensão para som/textura; com .json para loot). */
const refOf = (rel, kind) => (KINDS[kind].stripExt ? rel.slice(0, -extname(rel).length) : rel);

/**
 * Carrega os JSON de um pack (rel → objeto). `skip` = pastas fora (scripts do BP não são JSON do jogo).
 */
export function loadJsonTree(dir, files) {
	const docs = new Map();
	for (const rel of files) if (rel.endsWith(".json") || rel.endsWith(".material")) {
		const j = readJsonLoose(join(dir, rel));
		if (j !== undefined) docs.set(rel, j);
	}
	return docs;
}

/**
 * Referências de arquivo: para cada string de JSON que é o caminho de um arquivo existente no pack (com ou sem
 * extensão), o sha256 desse arquivo (`contentKey`: a prova entre dois dist usa o hash dos pixels dos PNG). Chave:
 * "pack|arquivo|ocorrência".
 */
export function fileReferenceHashes(packs, contentKey = (rel, buf) => sha256(buf)) {
	const out = new Map();
	for (const [name, p] of Object.entries(packs)) {
		const hashOf = new Map();
		const resolve = (s) => {
			for (const cand of [s, `${s}.png`, `${s}.ogg`, `${s}.tga`, `${s}.json`]) {
				if (!p.fileSet.has(cand)) continue;
				let h = hashOf.get(cand);
				if (!h) { h = contentKey(cand, readFileSync(join(p.dir, cand))); hashOf.set(cand, h); }
				return h;
			}
			return undefined;
		};
		for (const [rel, doc] of p.docs) {
			let i = 0;
			forEachString(doc, (s, _o, _k, isKey) => {
				i++;
				if (isKey || s.length > 300 || !s.includes("/")) return;
				const h = resolve(s);
				if (h) out.set(`${name}|${rel}|${i}`, h);
			});
		}
	}
	return out;
}

/** Evento de som → lista de sha256 dos arquivos (na ordem), com os demais campos da entrada. */
export function soundEventHashes(rp) {
	const defs = rp.docs.get("sounds/sound_definitions.json")?.sound_definitions ?? {};
	const out = new Map();
	for (const [event, def] of Object.entries(defs)) {
		const list = (def?.sounds ?? []).map((s) => {
			const name = typeof s === "string" ? s : s?.name;
			const file = [name, `${name}.ogg`, `${name}.wav`, `${name}.fsb`].find((c) => c && rp.fileSet.has(c));
			const rest = typeof s === "string" ? {} : { ...s, name: undefined };
			return `${file ? sha256(readFileSync(join(rp.dir, file))) : `ausente:${name}`}|${canonical(rest)}`;
		});
		out.set(event, `${canonical({ ...def, sounds: undefined })}|${list.join(",")}`);
	}
	return out;
}

/**
 * Deduplica arquivos idênticos. `packs` = { rp: {dir, files, fileSet, docs}, bp: {...} }; `guard` = { tokens
 * (TokenIndex de scripts/JSON UI), protectedStrings (Set do pack MSD), protectedPaths (Set rp|bp:rel do MSD), binaries
 * (Buffer[] dos .mcstructure) }. Muda os arquivos e os docs no lugar; devolve o relatório por extensão.
 */
export function dedupeFiles(packs, guard, dirty) {
	const report = {};
	for (const [ext, kind] of Object.entries(KINDS)) {
		const p = packs[kind.pack];
		const r = (report[ext] = { groups: 0, removed: 0, bytes: 0, kept: [], skipped: {} });
		const skip = (why) => { r.skipped[why] = (r.skipped[why] ?? 0) + 1; };
		// Grupos por hash.
		const byHash = new Map();
		for (const rel of p.files) {
			if (!rel.endsWith(ext) || !rel.startsWith(kind.root)) continue;
			const h = sha256(readFileSync(join(p.dir, rel)));
			(byHash.get(h) ?? byHash.set(h, []).get(h)).push(rel);
		}
		const groups = [...byHash.values()].filter((g) => g.length > 1);
		if (!groups.length) continue;
		// Onde cada referência aparece: string JSON == ref do arquivo, dentro dos contextos reescrevíveis ou não.
		const candidates = new Set(groups.flat().map((rel) => refOf(rel, ext)));
		const where = new Map(); // ref → { ok: [{doc, owner, key}], bad: [motivo] }
		const note = (ref) => where.get(ref) ?? where.set(ref, { ok: [], bad: [] }).get(ref);
		for (const [name, pk] of Object.entries(packs)) {
			for (const [rel, doc] of pk.docs) {
				forEachString(doc, (s, owner, key, isKey) => {
					const bare = kind.stripExt ? s.replace(/\.(png|ogg|tga)$/i, "") : s;
					if (!candidates.has(bare)) return;
					const rewritable = !isKey && name === kind.pack && kind.contexts(rel);
					if (rewritable) note(bare).ok.push({ owner, key, withExt: bare !== s ? s.slice(bare.length) : "", doc: `${name}:${rel}` });
					else note(bare).bad.push(`${name}:${rel}`);
				});
			}
		}
		for (const group of groups) {
			r.groups++;
			const safe = [];
			const unsafe = [];
			for (const rel of group) {
				const ref = refOf(rel, ext);
				const w = where.get(ref);
				const base = rel.slice(rel.lastIndexOf("/") + 1, rel.length - ext.length);
				const noRoot = ref.slice(kind.root.length);
				let why;
				if (guard.protectedPaths.has(`${kind.pack}:${rel}`)) why = "arquivo sobrescrito pelo pack MSD";
				else if (guard.protectedStrings.has(ref) || guard.protectedStrings.has(rel)) why = "referenciado pelo pack MSD";
				else if (w?.bad.length) why = "referência fora dos JSON reescritos";
				else if (!w?.ok.length) why = "sem referência estática em JSON";
				else if (guard.tokens.has(ref) || guard.tokens.has(rel) || guard.tokens.has(noRoot) || guard.tokens.has(base)) why = "nome usado em script/JSON UI";
				else if (guard.tokens.prefixOf(ref, kind.root)) why = "caminho montado por prefixo em script/JSON UI";
				else if (ext === ".json" && guard.binaries.some((b) => b.includes(base))) why = "nome em arquivo binário (.mcstructure)";
				if (why) { unsafe.push(rel); skip(why); } else safe.push(rel);
			}
			// Fica a primeira cópia que precisa ficar (ou a primeira do grupo); as seguras apontam para ela.
			const keep = unsafe[0] ?? safe[0];
			const keepRef = refOf(keep, ext);
			for (const rel of safe) {
				if (rel === keep) continue;
				for (const site of where.get(refOf(rel, ext)).ok) {
					site.owner[site.key] = `${keepRef}${site.withExt}`;
					dirty.add(site.doc);
				}
				r.bytes += readFileSync(join(p.dir, rel)).length;
				rmSync(join(p.dir, rel));
				p.fileSet.delete(rel);
				r.removed++;
			}
			if (unsafe.length && safe.length) r.kept.push(keep);
		}
		p.files = p.files.filter((rel) => p.fileSet.has(rel));
	}
	return report;
}

/** Definições de geometria (id → {rel, index, def}) de um RP. */
export function geometryDefinitions(rp) {
	const out = new Map();
	for (const [rel, doc] of rp.docs) {
		if (!rel.startsWith("models/")) continue;
		(doc?.["minecraft:geometry"] ?? []).forEach((def, index) => {
			const id = def?.description?.identifier;
			if (!id) return;
			(out.get(id) ?? out.set(id, []).get(id)).push({ rel, index, def, fv: doc.format_version });
		});
	}
	return out;
}

/** Conteúdo de uma geometria sem o identifier (+ format_version do arquivo). */
export const geometryBody = (g) => `${g.fv}|${canonical({ ...g.def, description: { ...g.def.description, identifier: undefined } })}`;

/**
 * #14: geometrias com o mesmo conteúdo (exceto o identifier) → fica a primeira (ordem do id); as referências às outras
 * (strings JSON iguais ao id, no RP e no BP, fora de ui/) passam a apontar para ela e as definições saem.
 */
export function dedupeGeometries(packs, guard, dirty) {
	const { rp } = packs;
	const defs = geometryDefinitions(rp);
	const byBody = new Map();
	for (const [id, list] of defs) {
		if (list.length !== 1) continue; // id definido mais de uma vez: a ordem de carga decide; não mexe
		const body = geometryBody(list[0]);
		(byBody.get(body) ?? byBody.set(body, []).get(body)).push(id);
	}
	const report = { groups: 0, removed: 0, rewritten: 0, skipped: {} };
	const sites = new Map(); // id → [{owner, key}] | "bad"
	const candidates = new Set([...byBody.values()].filter((g) => g.length > 1).flat());
	for (const [name, pk] of Object.entries(packs)) {
		for (const [rel, doc] of pk.docs) {
			const rewritable = !rel.startsWith("ui/") && !(name === "rp" && rel.startsWith("models/"));
			forEachString(doc, (s, owner, key, isKey) => {
				// A própria definição (description.identifier) não é referência.
				if (!candidates.has(s) || (name === "rp" && rel.startsWith("models/") && key === "identifier")) return;
				const cur = sites.get(s) ?? [];
				if (cur === "bad") return;
				if (isKey || !rewritable) sites.set(s, "bad");
				else { cur.push({ owner, key, doc: `${name}:${rel}` }); sites.set(s, cur); }
			});
		}
	}
	const removeFrom = new Map(); // rel → Set(index)
	for (const ids of byBody.values()) {
		if (ids.length < 2) continue;
		report.groups++;
		ids.sort();
		const safe = [];
		const unsafe = [];
		for (const id of ids) {
			const rel = defs.get(id)[0].rel;
			let why;
			if (guard.protectedPaths.has(`rp:${rel}`)) why = "arquivo sobrescrito pelo pack MSD";
			else if (guard.protectedStrings.has(id)) why = "referenciada pelo pack MSD";
			else if (sites.get(id) === "bad") why = "referência fora dos JSON reescritos";
			else if (guard.tokens.has(id)) why = "id usado em script/JSON UI";
			if (why) { unsafe.push(id); report.skipped[why] = (report.skipped[why] ?? 0) + 1; } else safe.push(id);
		}
		const keep = unsafe[0] ?? safe[0];
		for (const id of safe) {
			if (id === keep) continue;
			for (const site of sites.get(id) ?? []) { site.owner[site.key] = keep; dirty.add(site.doc); report.rewritten++; }
			const { rel, index } = defs.get(id)[0];
			(removeFrom.get(rel) ?? removeFrom.set(rel, new Set()).get(rel)).add(index);
			report.removed++;
		}
	}
	for (const [rel, indices] of removeFrom) {
		const doc = rp.docs.get(rel);
		doc["minecraft:geometry"] = doc["minecraft:geometry"].filter((_, i) => !indices.has(i));
		if (doc["minecraft:geometry"].length) {
			writeFileSync(join(rp.dir, rel), JSON.stringify(doc));
		} else {
			rmSync(join(rp.dir, rel));
			rp.docs.delete(rel);
			rp.fileSet.delete(rel);
		}
	}
	rp.files = rp.files.filter((rel) => rp.fileSet.has(rel));
	return report;
}

/** Referências a geometria: string JSON (fora de models/ e ui/) que é id de geometria → conteúdo da geometria. */
export function geometryReferenceBodies(packs) {
	const defs = geometryDefinitions(packs.rp);
	const out = new Map();
	for (const [name, pk] of Object.entries(packs)) {
		for (const [rel, doc] of pk.docs) {
			if (name === "rp" && rel.startsWith("models/")) continue;
			let i = 0;
			forEachString(doc, (s) => {
				i++;
				const list = defs.get(s);
				if (list?.length === 1) out.set(`${name}|${rel}|${i}`, geometryBody(list[0]));
			});
		}
	}
	return out;
}
