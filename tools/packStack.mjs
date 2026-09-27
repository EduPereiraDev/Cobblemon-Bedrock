// Pilha de packs do mundo (frente msd-infra, docs/pendencias/msd.md): quais packs de uma pasta de build entram e em
// que ordem. Usado por tools/server.mjs (deploy) e pelos testes (tests/msd.test.ts).
//
// Ordem do world_behavior_packs.json / world_resource_packs.json: índice 0 = TOPO da pilha (vence identificadores e
// caminhos repetidos) — provado no BDS pelo protótipo tools/pesquisa/msd-pack-stack.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Extensões que só entram no mundo quando pedidas: nome da pasta → flag (`--msd` / `COBBLEMON_MSD=1`). */
export const OPTIONAL_PACKS = { CobblemonMegaShowdown: "msd" };

/** Packs de um tipo numa pasta de build: [{ name, dir, manifest }] (só pastas com manifest.json). */
export function distPacks(dist, kind) {
	const base = join(dist, kind);
	if (!existsSync(base)) return [];
	return readdirSync(base, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(base, e.name, "manifest.json")))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((e) => ({ name: e.name, dir: join(base, e.name), manifest: JSON.parse(readFileSync(join(base, e.name, "manifest.json"), "utf8")) }));
}

/**
 * Ordena para o mundo (índice 0 = topo): quem depende de outro pack da lista (por UUID no manifest) fica acima
 * dele; empates em ordem alfabética. Dependências fora da lista (o RP par de um BP) não contam.
 */
export function orderPacks(packs) {
	const byUuid = new Map(packs.map((p) => [p.manifest.header.uuid, p]));
	const depth = new Map();
	const depthOf = (p, seen = new Set()) => {
		if (depth.has(p)) return depth.get(p);
		if (seen.has(p)) return 0; // ciclo: não deveria existir; não trava
		seen.add(p);
		const deps = (p.manifest.dependencies ?? []).map((d) => byUuid.get(d.uuid)).filter((q) => q && q !== p);
		const d = Math.max(0, ...deps.map((q) => depthOf(q, seen) + 1));
		depth.set(p, d);
		return d;
	};
	return [...packs].sort((a, b) => depthOf(b) - depthOf(a) || a.name.localeCompare(b.name));
}

/**
 * Seleção do deploy. `explicit` (COBBLEMON_BDS_PACKS) fixa lista e ordem; senão entram todos os packs, menos as
 * extensões opcionais não pedidas em `enabled` (conjunto de flags, ex.: {"msd"}).
 */
export function selectPacks(dist, { explicit, enabled = new Set() } = {}) {
	const out = {};
	for (const kind of ["behavior_packs", "resource_packs"]) {
		const all = distPacks(dist, kind);
		out[kind] = explicit?.length
			? explicit.map((name) => all.find((p) => p.name === name)).filter(Boolean)
			: orderPacks(all.filter((p) => !(p.name in OPTIONAL_PACKS) || enabled.has(OPTIONAL_PACKS[p.name])));
	}
	return out;
}

/** Referência do world_*_packs.json. */
export function manifestRef(manifest) {
	return { pack_id: manifest.header.uuid, version: manifest.header.version };
}
