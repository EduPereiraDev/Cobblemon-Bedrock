// Frente otimizacao (#10): render controllers IDÊNTICOS compartilhados. Os controllers por espécie diferem só no nome
// (os aliases Geometry.gN/Texture.tN/Material.x são resolvidos na client entity que usa o controller), então um grupo
// de definições com o mesmo JSON (mesma ordem de chaves, mesmo format_version) vira UMA definição
// `controller.render.cobblemon.shared.<hash>` e as client entities/attachables apontam para ela.
// Fica de fora: id definido mais de uma vez, id que aparece em script/JSON UI/pack MSD, arquivo sobrescrito pelo MSD,
// e controller referenciado por algum arquivo que esta etapa não reescreve.
// Prova (index.mjs): para cada client entity e attachable, a lista (definição resolvida, condição) é a mesma.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forEachString, sha256 } from "./common.mjs";

export const SHARED_RC_PREFIX = "controller.render.cobblemon.shared.";

/** id → [{rel, def, fv}] de todos os render controllers do RP. */
export function renderControllerDefinitions(rp) {
	const out = new Map();
	for (const [rel, doc] of rp.docs) {
		if (!rel.startsWith("render_controllers/")) continue;
		for (const [id, def] of Object.entries(doc?.render_controllers ?? {})) {
			(out.get(id) ?? out.set(id, []).get(id)).push({ rel, def, fv: doc.format_version });
		}
	}
	return out;
}

/** Arquivos que usam render controllers pelo id (lista description.render_controllers). */
const isUser = (rel) => rel.startsWith("entity/") || rel.startsWith("attachables/");

const rcEntryId = (e) => (typeof e === "string" ? e : e && typeof e === "object" ? Object.keys(e)[0] : undefined);

/** Para cada client entity/attachable: [(conteúdo resolvido, condição)] dos render controllers, em ordem. */
export function renderControllerResolution(rp) {
	const defs = renderControllerDefinitions(rp);
	const out = new Map();
	for (const [rel, doc] of rp.docs) {
		if (!isUser(rel)) continue;
		const desc = (doc?.["minecraft:client_entity"] ?? doc?.["minecraft:attachable"])?.description;
		if (!desc?.render_controllers) continue;
		out.set(rel, desc.render_controllers.map((e) => {
			const id = rcEntryId(e);
			const list = defs.get(id) ?? [];
			const cond = typeof e === "string" ? "" : Object.values(e)[0];
			return `${list.length === 1 ? `${list[0].fv}|${JSON.stringify(list[0].def)}` : `?${list.length}:${id}`}|${cond}`;
		}).join("\n"));
	}
	return out;
}

export function shareRenderControllers(packs, guard) {
	const { rp } = packs;
	const defs = renderControllerDefinitions(rp);
	const report = { groups: 0, shared: 0, removed: 0, filesRemoved: 0, skipped: {}, dirty: new Set() };
	const skip = (why, n = 1) => { report.skipped[why] = (report.skipped[why] ?? 0) + n; };
	// Quem referencia cada id (strings iguais ao id em qualquer JSON).
	const refs = new Map(); // id → { users: [{rel, list, index}], other: boolean }
	for (const [name, pk] of Object.entries(packs)) {
		for (const [rel, doc] of pk.docs) {
			if (name === "rp" && isUser(rel)) {
				const desc = (doc?.["minecraft:client_entity"] ?? doc?.["minecraft:attachable"])?.description;
				(desc?.render_controllers ?? []).forEach((e, index, list) => {
					const id = rcEntryId(e);
					if (!defs.has(id)) return;
					const r = refs.get(id) ?? refs.set(id, { users: [], other: false }).get(id);
					r.users.push({ rel, list, index, protectedFile: guard.protectedPaths.has(`rp:${rel}`) });
				});
				continue;
			}
			if (name === "rp" && rel.startsWith("render_controllers/")) continue;
			forEachString(doc, (s) => {
				if (!defs.has(s)) return;
				(refs.get(s) ?? refs.set(s, { users: [], other: false }).get(s)).other = true;
			});
		}
	}
	// Grupos por conteúdo exato.
	const groups = new Map();
	for (const [id, list] of defs) {
		if (list.length !== 1) { skip("id definido mais de uma vez"); continue; }
		const r = refs.get(id);
		let why;
		if (guard.protectedPaths.has(`rp:${list[0].rel}`)) why = "arquivo sobrescrito pelo pack MSD";
		else if (guard.protectedStrings.has(id)) why = "referenciado pelo pack MSD";
		else if (guard.tokens.has(id)) why = "id usado em script/JSON UI";
		else if (!r || !r.users.length) why = "sem client entity que o use";
		else if (r.other) why = "referência fora das client entities";
		else if (r.users.some((u) => u.protectedFile)) why = "client entity sobrescrita pelo pack MSD";
		if (why) { skip(why); continue; }
		const key = `${list[0].fv}|${JSON.stringify(list[0].def)}`;
		(groups.get(key) ?? groups.set(key, []).get(key)).push(id);
	}
	const sharedByFv = new Map(); // fv → { id: def }
	const removeFrom = new Map(); // rel → Set(id)
	for (const [key, ids] of groups) {
		if (ids.length < 2) continue;
		report.groups++;
		const { def, fv } = defs.get(ids[0])[0];
		const sharedId = `${SHARED_RC_PREFIX}${sha256(key).slice(0, 12)}`;
		if (defs.has(sharedId)) throw new Error(`render controller compartilhado já existe: ${sharedId}`);
		(sharedByFv.get(fv) ?? sharedByFv.set(fv, {}).get(fv))[sharedId] = def;
		report.shared++;
		for (const id of ids) {
			for (const u of refs.get(id).users) {
				const e = u.list[u.index];
				u.list[u.index] = typeof e === "string" ? sharedId : { [sharedId]: Object.values(e)[0] };
				report.dirty.add(u.rel);
			}
			const { rel } = defs.get(id)[0];
			(removeFrom.get(rel) ?? removeFrom.set(rel, new Set()).get(rel)).add(id);
			report.removed++;
		}
	}
	for (const [rel, ids] of removeFrom) {
		const doc = rp.docs.get(rel);
		for (const id of ids) delete doc.render_controllers[id];
		if (Object.keys(doc.render_controllers).length) report.dirty.add(rel);
		else {
			rmSync(join(rp.dir, rel));
			rp.docs.delete(rel);
			rp.fileSet.delete(rel);
			report.filesRemoved++;
		}
	}
	for (const [fv, rcs] of sharedByFv) {
		const rel = `render_controllers/cobblemon_shared_${fv.replace(/[^0-9]/g, "_")}.render_controllers.json`;
		if (rp.fileSet.has(rel)) throw new Error(`${rel} já existe`);
		const doc = { format_version: fv, render_controllers: rcs };
		writeFileSync(join(rp.dir, rel), JSON.stringify(doc));
		rp.docs.set(rel, doc);
		rp.fileSet.add(rel);
	}
	rp.files = [...rp.fileSet].sort();
	return report;
}
