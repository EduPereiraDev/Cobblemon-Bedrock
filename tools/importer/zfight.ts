// Frente fix3 (docs/pendencias/cliente-teste2.md): faces coplanares sobrepostas (z-fighting) em geometrias.
//
// Duas faces no mesmo plano, sobrepostas, com aparências diferentes (outra textura/material, outra região da textura
// ou a mesma região espelhada) piscam no cliente: a profundidade das duas é igual e cada pixel escolhe uma. Casos:
//  - duas faces viradas para o mesmo lado (cubos encostados/duplicados, `inflate` 0 em cubos sobrepostos);
//  - as duas faces de um cubo de espessura zero (plano de folha/flor): no material de bloco `alpha_test` (sem descarte
//    de face de trás) as duas aparecem dos dois lados, uma espelhada em relação à outra — a folha "treme". No Java o
//    modelo de bloco descarta a face de trás (cada lado mostra a sua); o equivalente no Bedrock é
//    `alpha_test_single_sided`.
//
// Espaço do Bedrock (px): origem/tamanho absolutos, rotação do cubo em volta do pivô dele e a cadeia de ossos em volta
// dos pivôs (mesma conversão de rotação de headLocator/retratos: R = Rz(-z)·Ry(y)·Rx(-x)).

import { HAND_RP, OUT_BP, OUT_RP, readJson, tryReadJson, walk, writeJson } from "./util.ts";

type V3 = [number, number, number];
type M3 = number[];
const deg = Math.PI / 180;

function mul3(a: M3, b: M3): M3 {
	const o = new Array(9).fill(0);
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
	return o;
}
const rx = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a: number): M3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a: number): M3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
function rotation(r: number[] | undefined): M3 | undefined {
	if (!r || !r.some((v) => v)) return undefined;
	return mul3(rz(-(r[2] ?? 0) * deg), mul3(ry((r[1] ?? 0) * deg), rx(-(r[0] ?? 0) * deg)));
}
interface Affine { m: M3; t: V3 }
const ID: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const apply = (a: Affine, p: number[]): V3 => [
	a.m[0] * p[0] + a.m[1] * p[1] + a.m[2] * p[2] + a.t[0],
	a.m[3] * p[0] + a.m[4] * p[1] + a.m[5] * p[2] + a.t[1],
	a.m[6] * p[0] + a.m[7] * p[1] + a.m[8] * p[2] + a.t[2],
];
function rotateAbout(a: Affine, r: M3 | undefined, pivot: number[]): Affine {
	if (!r) return a;
	const shifted = apply({ m: r, t: [0, 0, 0] }, pivot.map((v) => -v)).map((v, i) => v + pivot[i]);
	return { m: mul3(a.m, r), t: apply(a, shifted) };
}

export interface Face {
	bone: string;
	cube: number;
	dir: string;
	/** Vértices no espaço da geometria (px). */
	v: V3[];
	n: V3;
	/** Aparência: material + região da textura (com orientação). */
	look: string;
	/** A face é de um cubo com espessura zero neste eixo. */
	flat: boolean;
}

const DIRS: Array<[string, V3, number]> = [
	// nome, normal (espaço do cubo), eixo
	["west", [1, 0, 0], 0], ["east", [-1, 0, 0], 0], // no Bedrock "east" fica no x mínimo (x espelhado do Java/Blockbench)
	["up", [0, 1, 0], 1], ["down", [0, -1, 0], 1],
	["south", [0, 0, 1], 2], ["north", [0, 0, -1], 2],
];

/** Faces renderizadas de todos os cubos (per-face UV sem a face = sem face). */
export function geometryFaces(geo: any): Face[] {
	const bones: any[] = geo?.bones ?? [];
	const byName = new Map<string, any>(bones.map((b) => [b.name, b]));
	const cache = new Map<string, Affine>();
	const transformOf = (bone: any, depth = 0): Affine => {
		const known = cache.get(bone.name);
		if (known) return known;
		const parent = bone.parent ? byName.get(bone.parent) : undefined;
		const base = parent && depth < 256 ? transformOf(parent, depth + 1) : ID;
		const own = rotateAbout(base, rotation(bone.rotation), bone.pivot ?? [0, 0, 0]);
		cache.set(bone.name, own);
		return own;
	};
	const faces: Face[] = [];
	for (const bone of bones) {
		const cubes: any[] = bone.cubes ?? [];
		if (!cubes.length) continue;
		const bt = transformOf(bone);
		cubes.forEach((c, ci) => {
			if (!Array.isArray(c.origin) || !Array.isArray(c.size)) return;
			const g = c.inflate ?? 0;
			const lo = c.origin.map((v: number) => v - g), hi = c.origin.map((v: number, i: number) => v + c.size[i] + g);
			const t = rotateAbout(bt, rotation(c.rotation), c.pivot ?? bone.pivot ?? [0, 0, 0]);
			const perFace = c.uv && !Array.isArray(c.uv) ? c.uv : undefined;
			for (const [dir, n, axis] of DIRS) {
				let look: string;
				if (perFace) {
					const f = perFace[dir];
					if (!f) continue;
					look = JSON.stringify([f.material_instance ?? "*", f.uv, f.uv_size]);
				}
				else look = JSON.stringify(["box", c.uv ?? [0, 0], dir, c.size, c.mirror ?? bone.mirror ?? false]);
				const other = [0, 1, 2].filter((i) => i !== axis);
				const fixed = n[axis] > 0 ? hi[axis] : lo[axis];
				// Área zero: não desenha nada.
				if (hi[other[0]] - lo[other[0]] <= 1e-6 || hi[other[1]] - lo[other[1]] <= 1e-6) continue;
				const corners: V3[] = [];
				for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
					const p: V3 = [0, 0, 0];
					p[axis] = fixed;
					p[other[0]] = a ? hi[other[0]] : lo[other[0]];
					p[other[1]] = b ? hi[other[1]] : lo[other[1]];
					corners.push(apply(t, p));
				}
				faces.push({ bone: bone.name, cube: ci, dir, v: corners, n: apply({ m: t.m, t: [0, 0, 0] }, n), look, flat: hi[axis] - lo[axis] <= 1e-6 });
			}
		});
	}
	return faces;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Área da interseção de dois polígonos convexos (2D). */
function clipArea(a: Array<[number, number]>, b: Array<[number, number]>): number {
	let out = a;
	const orient = (poly: Array<[number, number]>) => {
		let s = 0;
		for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; }
		return s >= 0 ? poly : [...poly].reverse();
	};
	b = orient(b);
	out = orient(out);
	for (let i = 0; i < b.length && out.length; i++) {
		const p = b[i], q = b[(i + 1) % b.length];
		const side = (r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
		const input = out;
		out = [];
		for (let j = 0; j < input.length; j++) {
			const cur = input[j], prev = input[(j + input.length - 1) % input.length];
			const sc = side(cur), sp = side(prev);
			const ci = sc >= -1e-9, pi = sp >= -1e-9;
			if (ci !== pi) {
				const t = sp / (sp - sc);
				out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
			}
			if (ci) out.push(cur);
		}
	}
	let area = 0;
	for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; area += p[0] * q[1] - q[0] * p[1]; }
	return Math.abs(area) / 2;
}

export interface ZFight {
	a: Face;
	b: Face;
	/** Área sobreposta (px²). */
	area: number;
	/** Faces viradas para lados opostos (só aparece com material sem descarte de face de trás). */
	opposite: boolean;
}

/**
 * Pares de faces coplanares sobrepostas com aparência diferente. Faces opostas com a mesma região da textura também
 * contam (a de trás aparece espelhada) quando `doubleSided`.
 */
export function coplanarConflicts(faces: Face[], options: { doubleSided: boolean; minArea?: number; eps?: number } = { doubleSided: true }): ZFight[] {
	const eps = options.eps ?? 1e-3;
	const minArea = options.minArea ?? 0.05;
	// Agrupa por plano: normal (com sinal normalizado) + distância.
	const groups = new Map<string, Face[]>();
	for (const f of faces) {
		let n = f.n;
		const len = Math.hypot(...n);
		n = [n[0] / len, n[1] / len, n[2] / len];
		const k = Math.abs(n[0]) > eps ? 0 : Math.abs(n[1]) > eps ? 1 : 2;
		const s = n[k] < 0 ? -1 : 1;
		const nn: V3 = [n[0] * s, n[1] * s, n[2] * s];
		const d = dot(nn, f.v[0]);
		const key = `${nn.map((x) => Math.round(x / eps)).join(",")}|${Math.round(d / (eps * 10))}`;
		let g = groups.get(key);
		if (!g) groups.set(key, g = []);
		g.push(f);
	}
	const out: ZFight[] = [];
	for (const g of groups.values()) {
		if (g.length < 2) continue;
		// Base 2D do plano.
		const n = g[0].n;
		const u = Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
		const w = cross(n, u);
		const to2 = (p: V3): [number, number] => [dot(p, u), dot(p, w)];
		for (let i = 0; i < g.length; i++) {
			for (let j = i + 1; j < g.length; j++) {
				const a = g[i], b = g[j];
				const opposite = dot(a.n, b.n) < 0;
				if (opposite && !options.doubleSided) continue;
				// Mesma aparência virada para o mesmo lado: não pisca.
				if (!opposite && a.look === b.look) continue;
				const area = clipArea(a.v.map(to2), b.v.map(to2));
				if (area >= minArea) out.push({ a, b, area, opposite });
			}
		}
	}
	return out;
}

/** Cubos de espessura zero (com as duas faces desenhadas) numa geometria. */
export function flatCubeCount(geo: any): number {
	let n = 0;
	for (const b of geo?.bones ?? []) for (const c of b.cubes ?? []) if (Array.isArray(c.size) && c.size.some((v: number) => v === 0) && c.size.filter((v: number) => v !== 0).length === 2) n++;
	return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Blocos: combina estados (bone_visibility, permutações) e materiais (render_method por material instance).

/** Condição de bloco (q.block_state('x') == v, !, &&, ||) avaliada com os estados dados; inválida = verdadeira. */
export function blockCondition(expr: unknown, states: Record<string, unknown>): boolean {
	if (expr === undefined || expr === true) return true;
	if (expr === false) return false;
	if (typeof expr !== "string") return true;
	const js = expr.replace(/\b(?:q|query)\.block_state\(\s*'([^']+)'\s*\)/g, (_, s) => `S[${JSON.stringify(s)}]`);
	if (/[a-z_]+\.[a-z_]+/i.test(js.replace(/S\["[^"]+"\]/g, ""))) return true;
	try { return !!new Function("S", `return (${js});`)(states); }
	catch { return true; }
}

/** Todas as combinações de estados (até `limit`). */
export function statePermutations(states: Record<string, unknown[]> | undefined, limit = 512): Record<string, unknown>[] {
	let out: Record<string, unknown>[] = [{}];
	for (const [name, values] of Object.entries(states ?? {})) {
		const list = Array.isArray(values) ? values : (values && typeof values === "object" && "values" in (values as any)) ? rangeValues((values as any).values) : [];
		if (!list.length) continue;
		const next: Record<string, unknown>[] = [];
		for (const s of out) for (const v of list) { next.push({ ...s, [name]: v }); if (next.length >= limit) break; }
		out = next;
		if (out.length >= limit) break;
	}
	return out;
}
function rangeValues(r: { min: number; max: number }): number[] {
	const out: number[] = [];
	for (let i = r.min; i <= r.max && out.length < 64; i++) out.push(i);
	return out;
}

export interface BlockZFight {
	block: string;
	geometry: string;
	pairs: ZFight[];
	/** Pares entre faces opostas de cubos de espessura zero (as duas faces do mesmo plano). */
	flatPairs: number;
	/** Algum material com render_method sem descarte de face de trás (alpha_test/double_sided). */
	doubleSided: boolean;
}

const DOUBLE_SIDED = new Set(["alpha_test", "double_sided", "alpha_test_to_opaque"]);

/**
 * Z-fighting de um bloco: para cada combinação de estados, os ossos visíveis (bone_visibility) da geometria efetiva
 * e o render_method de cada material instance. `geometryById` devolve o JSON da geometria.
 */
export function blockZFights(block: any, geometryById: (id: string) => any): BlockZFight[] {
	const b = block?.["minecraft:block"];
	if (!b) return [];
	const id = b.description?.identifier ?? "?";
	const results = new Map<string, BlockZFight>();
	const seen = new Set<string>();
	for (const states of statePermutations(b.description?.states)) {
		const comps: Record<string, any> = { ...(b.components ?? {}) };
		for (const p of b.permutations ?? []) if (blockCondition(p.condition, states)) Object.assign(comps, p.components ?? {});
		const g = comps["minecraft:geometry"];
		const gid = typeof g === "string" ? g : g?.identifier;
		if (!gid || gid.startsWith("minecraft:")) continue;
		const geo = geometryById(gid);
		if (!geo) continue;
		const vis: Record<string, unknown> = (typeof g === "object" ? g.bone_visibility : undefined) ?? {};
		const bones: any[] = geo.bones ?? [];
		const byName = new Map<string, any>(bones.map((x) => [x.name, x]));
		const visible = (name: string, depth = 0): boolean => {
			if (depth > 64) return true;
			if (name in vis && !blockCondition(vis[name], states)) return false;
			const parent = byName.get(name)?.parent;
			return parent ? visible(parent, depth + 1) : true;
		};
		const shown = bones.filter((x) => visible(x.name)).map((x) => x.name);
		const key = `${gid}|${shown.join(",")}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const mats: Record<string, any> = comps["minecraft:material_instances"] ?? {};
		const methodOf = (inst: string) => (mats[inst] ?? mats["*"])?.render_method ?? "opaque";
		const faces = geometryFaces({ bones: bones.filter((x) => shown.includes(x.name)) }).map((f) => ({ ...f, method: methodOf(JSON.parse(f.look)[0] === "box" ? "*" : JSON.parse(f.look)[0]) }));
		const doubleSided = faces.some((f) => DOUBLE_SIDED.has(f.method));
		const pairs = coplanarConflicts(faces, { doubleSided: true }).filter((z) => !z.opposite || (DOUBLE_SIDED.has((z.a as any).method) || DOUBLE_SIDED.has((z.b as any).method)));
		if (!pairs.length) continue;
		const r = results.get(gid) ?? { block: id, geometry: gid, pairs: [], flatPairs: 0, doubleSided };
		const known = new Set(r.pairs.map(pairKey));
		for (const z of pairs) if (!known.has(pairKey(z))) { r.pairs.push(z); if (z.opposite && z.a.flat && z.b.flat && z.a.bone === z.b.bone && z.a.cube === z.b.cube) r.flatPairs++; }
		results.set(gid, r);
	}
	return [...results.values()];
}
const pairKey = (z: ZFight) => `${z.a.bone}#${z.a.cube}${z.a.dir}|${z.b.bone}#${z.b.cube}${z.b.dir}`;

/**
 * Corrige no BP gerado as faces opostas coplanares (planos de espessura zero, cubos encostados) dos blocos com material
 * `alpha_test`: o bloco passa a `alpha_test_single_sided` (sem a face de trás, como o modelo de bloco do Java) — todas
 * as material instances juntas, porque o motor exige um render_method só por bloco. Devolve os blocos e instâncias trocados e os blocos que ainda têm faces do mesmo lado sobrepostas.
 */
export function fixBlockDoubleSidedPlanes(blockFiles: string[], geometryById: (id: string) => any, read: (f: string) => any, write: (f: string, j: any) => void): { blocks: number; instances: number; sameSide: Array<{ block: string; geometry: string; pairs: number }> } {
	let blocks = 0, instances = 0;
	const sameSide: Array<{ block: string; geometry: string; pairs: number }> = [];
	for (const file of blockFiles) {
		const json = read(file);
		const b = json?.["minecraft:block"];
		if (!b) continue;
		const results = blockZFights(json, geometryById);
		if (!results.length) continue;
		const wanted = new Set<string>();
		for (const r of results) {
			for (const z of r.pairs) {
				if (!z.opposite) continue;
				for (const f of [z.a, z.b]) {
					const look = JSON.parse(f.look);
					wanted.add(look[0] === "box" ? "*" : look[0]);
				}
			}
			const same = r.pairs.filter((z) => !z.opposite).length;
			if (same) sameSide.push({ block: r.block, geometry: r.geometry, pairs: same });
		}
		if (!wanted.size) continue;
		// O BDS exige o mesmo render_method em todas as material instances do bloco ("All MaterialInstances must use the
		// same render_method for a given block"): o bloco inteiro passa de alpha_test para alpha_test_single_sided.
		let changed = 0;
		const patch = (mats: Record<string, any> | undefined) => {
			if (!mats) return;
			for (const m of Object.values(mats)) {
				if (m && typeof m === "object" && (m.render_method ?? "opaque") === "alpha_test") {
					m.render_method = "alpha_test_single_sided";
					changed++;
				}
			}
		};
		patch(b.components?.["minecraft:material_instances"]);
		for (const p of b.permutations ?? []) patch(p.components?.["minecraft:material_instances"]);
		if (changed) {
			write(file, json);
			blocks++;
			instances += changed;
		}
	}
	return { blocks, instances, sameSide };
}

// ---------------------------------------------------------------------------------------------------------------
// Entidades: cubos do MESMO osso com faces coplanares sobrepostas (movem juntos em qualquer pose).

/** Separação usada entre faces que brigavam (px): 0,01 px, a mesma folga que os modelos do Cobblemon usam no `inflate`. */
export const COPLANAR_SEPARATION = 0.01;

/**
 * No Java o ModelPart desenha os cubos na ordem e o teste de profundidade LEQUAL deixa o último por cima quando a
 * profundidade empata; na prática a profundidade de dois triângulos diferentes no mesmo plano só empata em parte dos
 * pixels e a face "treme" (pior no Bedrock, com o plano de corte mais perto). Aqui, para cada par de faces coplanares
 * sobrepostas do mesmo lado entre dois cubos do mesmo osso, o cubo que vem depois ganha `inflate` 0,01 px acima do
 * outro — fica por cima sempre, como o Java pretende. Repete até não sobrar par (no máximo 4 passadas).
 * Devolve quantos cubos mudaram.
 */
export function separateCoplanarCubes(geo: any): number {
	const changed = new Set<string>();
	for (let pass = 0; pass < 4; pass++) {
		const pairs = coplanarConflicts(geometryFaces(geo), { doubleSided: false, minArea: 0.05 }).filter((z) => z.a.bone === z.b.bone && z.a.cube !== z.b.cube);
		if (!pairs.length) break;
		const byName = new Map<string, any>((geo.bones ?? []).map((b: any) => [b.name, b]));
		let moved = false;
		const bumped = new Set<string>();
		for (const z of pairs) {
			const bone = byName.get(z.a.bone);
			const later = Math.max(z.a.cube, z.b.cube);
			const cl = bone?.cubes?.[later];
			const key = `${z.a.bone}#${later}`;
			if (!cl || bumped.has(key)) continue;
			// As faces estão no mesmo plano agora: o cubo de depois sai 0,01 px (qualquer que seja o inflate que já tinha).
			cl.inflate = Math.round(((cl.inflate ?? 0) + COPLANAR_SEPARATION) * 10000) / 10000;
			bumped.add(key);
			changed.add(key);
			moved = true;
		}
		if (!moved) break;
	}
	return changed.size;
}

/**
 * Pós-passe dos blocos gerados (frente fix3; chamado no index.ts e, no import do Mega Showdown, depois do conteúdo do
 * MSD): cubos do mesmo osso separados por `inflate` e planos de espessura zero em `alpha_test_single_sided`.
 */
export function fixBlockZFighting(): { separated: number; blocks: number; instances: number; sameSide: Array<{ block: string; geometry: string; pairs: number }> } {
	let separated = 0;
	for (const f of walk(`${OUT_RP}/models/blocks`, (n) => n.endsWith(".json"))) {
		const json = tryReadJson(f);
		let changed = 0;
		for (const g of json?.["minecraft:geometry"] ?? []) changed += separateCoplanarCubes(g);
		if (changed) { writeJson(f, json); separated += changed; }
	}
	const geos = new Map<string, any>();
	for (const dir of [`${OUT_RP}/models/blocks`, `${HAND_RP}/models/blocks`]) {
		for (const f of walk(dir, (n) => n.endsWith(".json"))) for (const g of tryReadJson(f)?.["minecraft:geometry"] ?? []) if (g?.description?.identifier) geos.set(g.description.identifier, g);
	}
	const z = fixBlockDoubleSidedPlanes(walk(`${OUT_BP}/blocks`, (n) => n.endsWith(".json")), (id) => geos.get(id), readJson, writeJson);
	return { separated, ...z };
}
