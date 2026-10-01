// Pilha de packs do mundo (frente msd-infra, docs/pendencias/msd.md): quais packs de uma pasta de build entram e em
// que ordem. Usado por tools/server.mjs (deploy) e pelos testes (tests/msd.test.ts).
//
// Ordem do world_behavior_packs.json / world_resource_packs.json: índice 0 = TOPO da pilha (vence identificadores e
// caminhos repetidos) — provado no BDS pelo protótipo tools/pesquisa/msd-pack-stack.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Extensões que só entram no mundo quando pedidas: nome da pasta → flag (`--msd` / `COBBLEMON_MSD=1`). */
export const OPTIONAL_PACKS = { CobblemonMegaShowdown: "msd" };

/**
 * Ordem canônica da pilha (decisão do orquestrador; menor = mais alto no mundo): o Mega Showdown no TOPO (as entidades
 * dele substituem as do base e precisam vencer), as extensões privadas no meio e o base embaixo de todas. Dependência
 * entre packs e nome só desempatam dentro da mesma prioridade.
 */
export const TOP_PACKS = { CobblemonMegaShowdown: 0 };
/** Prioridade de uma extensão privada que declarou só a flag em optional-packs.json. */
export const EXTENSION_PRIORITY = 100;
/** Prioridade do resto (o base e packs sem declaração). */
export const REST_PRIORITY = 1000;

/**
 * Extensões privadas declaradas pelo build em `<dist>/optional-packs.json` (pasta → flag, ou `{ flag, priority }`; ex.:
 * um pack de tools/private/<nome>/build.mjs). Sem o arquivo, nenhuma.
 */
function declaredPacks(dist) {
	try { return JSON.parse(readFileSync(join(dist, "optional-packs.json"), "utf8")); } catch { return {}; }
}

/** OPTIONAL_PACKS + as extensões privadas declaradas (pasta → flag). */
export function optionalPacks(dist) {
	const out = { ...OPTIONAL_PACKS };
	for (const [name, v] of Object.entries(declaredPacks(dist))) {
		const flag = typeof v === "string" ? v : v?.flag;
		if (typeof flag === "string" && flag) out[name] = flag;
	}
	return out;
}

/** Prioridade de cada pack de `dist` na pilha (pasta → número; menor = mais alto). */
export function packPriorities(dist) {
	const out = {};
	for (const [name, v] of Object.entries(declaredPacks(dist))) out[name] = Number.isFinite(v?.priority) ? Number(v.priority) : EXTENSION_PRIORITY;
	return { ...out, ...TOP_PACKS };
}

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
 * Ordena para o mundo (índice 0 = topo): primeiro a prioridade (`priorities`, pasta → número, menor = mais alto; sem
 * entrada = REST_PRIORITY), depois quem depende de outro pack da lista (por UUID no manifest) fica acima dele, depois
 * ordem alfabética. Dependências fora da lista (o RP par de um BP) não contam.
 */
export function orderPacks(packs, priorities = TOP_PACKS) {
	const prio = (p) => priorities[p.name] ?? REST_PRIORITY;
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
	return [...packs].sort((a, b) => prio(a) - prio(b) || depthOf(b) - depthOf(a) || a.name.localeCompare(b.name));
}

/**
 * Seleção do deploy. `explicit` (COBBLEMON_BDS_PACKS) fixa lista e ordem; senão entram todos os packs, menos as
 * extensões opcionais não pedidas em `enabled` (conjunto de flags, ex.: {"msd"}).
 */
export function selectPacks(dist, { explicit, enabled = new Set() } = {}) {
	const out = {};
	const optional = optionalPacks(dist);
	const priorities = packPriorities(dist);
	for (const kind of ["behavior_packs", "resource_packs"]) {
		const all = distPacks(dist, kind);
		out[kind] = explicit?.length
			? explicit.map((name) => all.find((p) => p.name === name)).filter(Boolean)
			: orderPacks(all.filter((p) => !(p.name in optional) || enabled.has(optional[p.name])), priorities);
	}
	return out;
}

/** Referência do world_*_packs.json. */
export function manifestRef(manifest) {
	return { pack_id: manifest.header.uuid, version: manifest.header.version };
}
