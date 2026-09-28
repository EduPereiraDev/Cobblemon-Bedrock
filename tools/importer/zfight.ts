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
	/** Frente zfight2: o cubo da face (transformação para o espaço da geometria e limites no espaço do cubo). */
	box?: CubeBox;
}

/** Cubo no espaço da geometria: ponto do cubo p → m·p + t; limites (com inflate) no espaço do cubo. */
export interface CubeBox { m: M3; t: V3; lo: number[]; hi: number[] }

/** O ponto (espaço da geometria) está dentro do cubo, a mais de `margin` px de toda face. */
function insideBox(b: CubeBox, p: V3, margin: number): boolean {
	const d = [p[0] - b.t[0], p[1] - b.t[1], p[2] - b.t[2]];
	for (let i = 0; i < 3; i++) {
		// m é ortonormal (só rotações): a inversa é a transposta.
		const local = b.m[i] * d[0] + b.m[3 + i] * d[1] + b.m[6 + i] * d[2];
		if (local <= b.lo[i] + margin || local >= b.hi[i] - margin) return false;
	}
	return true;
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
			const box: CubeBox = { m: t.m, t: t.t, lo, hi };
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
				faces.push({ bone: bone.name, cube: ci, dir, v: corners, n: apply({ m: t.m, t: [0, 0, 0] }, n), look, flat: hi[axis] - lo[axis] <= 1e-6, box });
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
	return polygonArea(clipPolygon(a, b));
}
function polygonArea(out: Array<[number, number]>): number {
	let area = 0;
	for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; area += p[0] * q[1] - q[0] * p[1]; }
	return Math.abs(area) / 2;
}
/** Interseção de dois polígonos convexos (2D). */
function clipPolygon(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
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
	return out;
}

export interface ZFight {
	a: Face;
	b: Face;
	/** Área sobreposta (px²). */
	area: number;
	/** Faces viradas para lados opostos (só aparece com material sem descarte de face de trás). */
	opposite: boolean;
	/** Frente zfight2: distância entre os dois planos (px; 0 = coplanares). */
	gap?: number;
}

/**
 * Pares de faces coplanares sobrepostas com aparência diferente. Faces opostas com a mesma região da textura também
 * contam (a de trás aparece espelhada) quando `doubleSided`.
 */
/** Distância do plano da face ao longo da própria normal (maior = mais para fora, na frente). */
export function faceDistance(f: Face): number {
	const l = Math.hypot(...f.n);
	return (f.n[0] * f.v[0][0] + f.n[1] * f.v[0][1] + f.n[2] * f.v[0][2]) / l;
}

export function coplanarConflicts(faces: Face[], options: { doubleSided: boolean; minArea?: number; eps?: number; skipHidden?: boolean } = { doubleSided: true }): ZFight[] {
	const eps = options.eps ?? 1e-3;
	const minArea = options.minArea ?? 0.05;
	// Frente zfight2 (`skipHidden`): par cuja região sobreposta fica inteira DENTRO do volume de outros cubos não aparece
	// na pose de repouso — as pálpebras/bocas de expressão do Cobblemon ficam guardadas dentro da cabeça e a animação traz
	// a ativa para fora (Mamoswine, Zebstrika, Graveler). Separar essas pilhas não muda nada na tela e empurraria a face
	// para fora da cabeça.
	const boxes = options.skipHidden ? [...new Map(faces.filter((f) => f.box).map((f) => [`${f.bone}#${f.cube}`, { key: `${f.bone}#${f.cube}`, box: f.box! }])).values()] : [];
	const hidden = (a: Face, b: Face, poly: Array<[number, number]>, from2: (p: [number, number]) => V3) => {
		if (!poly.length) return false;
		const c: [number, number] = [poly.reduce((x, p) => x + p[0], 0) / poly.length, poly.reduce((x, p) => x + p[1], 0) / poly.length];
		const samples = [c, ...poly.map((p): [number, number] => [p[0] + (c[0] - p[0]) * 0.05, p[1] + (c[1] - p[1]) * 0.05])];
		const own = new Set([`${a.bone}#${a.cube}`, `${b.bone}#${b.cube}`]);
		return samples.every((s) => { const p = from2(s); return boxes.some((o) => !own.has(o.key) && insideBox(o.box, p, 1e-3)); });
	};
	// Agrupa por normal (com sinal normalizado); dentro do grupo, ordena pela distância do plano e compara só as faces a
	// até `eps` (px) uma da outra. Frente zfight2: antes a distância era arredondada em baldes de 0,01 px — faces a
	// 0,01 px caíam às vezes no mesmo balde (falso empate) e faces a 0,001 px às vezes em baldes vizinhos (par perdido).
	const groups = new Map<string, Array<{ f: Face; d: number }>>();
	for (const f of faces) {
		let n = f.n;
		const len = Math.hypot(...n);
		n = [n[0] / len, n[1] / len, n[2] / len];
		// Normal com resolução fixa de 0,001 (independente do `eps` da distância).
		const k = Math.abs(n[0]) > 1e-3 ? 0 : Math.abs(n[1]) > 1e-3 ? 1 : 2;
		const s = n[k] < 0 ? -1 : 1;
		const nn: V3 = [n[0] * s, n[1] * s, n[2] * s];
		const key = nn.map((x) => Math.round(x / 1e-3)).join(",");
		let g = groups.get(key);
		if (!g) groups.set(key, g = []);
		g.push({ f, d: dot(nn, f.v[0]) });
	}
	const out: ZFight[] = [];
	for (const g of groups.values()) {
		if (g.length < 2) continue;
		g.sort((x, y) => x.d - y.d);
		// Base 2D ortonormal do plano (área em px² de verdade, e volta para 3D).
		const len = Math.hypot(...g[0].f.n);
		const n: V3 = [g[0].f.n[0] / len, g[0].f.n[1] / len, g[0].f.n[2] / len];
		const unit = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
		const u = unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
		const w = cross(n, u);
		const to2 = (p: V3): [number, number] => [dot(p, u), dot(p, w)];
		for (let i = 0; i < g.length; i++) {
			for (let j = i + 1; j < g.length && g[j].d - g[i].d <= eps; j++) {
				const a = g[i].f, b = g[j].f;
				const opposite = dot(a.n, b.n) < 0;
				if (opposite && !options.doubleSided) continue;
				// Mesma aparência virada para o mesmo lado: não pisca.
				if (!opposite && a.look === b.look) continue;
				const poly = clipPolygon(a.v.map(to2), b.v.map(to2));
				const area = polygonArea(poly);
				if (area < minArea) continue;
				if (options.skipHidden) {
					// A região vista é a da face da frente (a outra fica atrás dela): se ela está dentro de outros cubos,
					// as duas estão escondidas.
					const front = opposite ? a : faceDistance(a) >= faceDistance(b) ? a : b;
					const dn = dot(n, front.v[0]);
					if (hidden(a, b, poly, (p) => [u[0] * p[0] + w[0] * p[1] + n[0] * dn, u[1] * p[0] + w[1] * p[1] + n[1] * dn, u[2] * p[0] + w[2] * p[1] + n[2] * dn])) continue;
				}
				out.push({ a, b, area, opposite, gap: g[j].d - g[i].d });
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
 * Frente zfight2: vão mínimo entre faces visíveis do mesmo lado nas entidades (px) = o passo do Java (0,01). Havia 2.431
 * pares visíveis entre 0,001 e 0,01 px em 437 geometrias (ex. 0,005 nas sobrancelhas do Charizard, na boca do
 * Wartortle) — mais apertados que a convenção do próprio Cobblemon. Medido nas 1.439 geometrias (base + MSD): com 0,01
 * o maior deslocamento de face é 0,11 px (48 cubos acima de 0,06); exigir 0,02/0,03/0,05 faz cascatas (cadeias de
 * caudas, coroas, expressões que se sobrepõem em repouso com passos de 0,01) que movem faces até 0,22/0,37/0,70 px em
 * 947/3.793/20.501 cubos — muda a forma dos modelos (ver docs/pendencias/zfight2.md, "Hipótese não provada").
 */
export const MIN_ENTITY_FACE_GAP = 0.01;

/**
 * Ordem de desenho do Java (ModelPart: o osso desenha os cubos dele e depois os filhos, na ordem do JSON): índice de
 * cada osso numa busca em profundidade a partir das raízes. Frente zfight2 (cubos coplanares entre ossos diferentes).
 */
export function boneDrawOrder(geo: any): Map<string, number> {
	const bones: any[] = geo?.bones ?? [];
	const children = new Map<string, any[]>();
	const names = new Set(bones.map((b) => b.name));
	const roots: any[] = [];
	for (const b of bones) {
		if (b.parent && names.has(b.parent)) {
			let list = children.get(b.parent);
			if (!list) children.set(b.parent, list = []);
			list.push(b);
		}
		else roots.push(b);
	}
	const order = new Map<string, number>();
	const visit = (b: any) => {
		if (order.has(b.name)) return;
		order.set(b.name, order.size);
		for (const c of children.get(b.name) ?? []) visit(c);
	};
	for (const r of roots) visit(r);
	for (const b of bones) visit(b); // ciclos/pais inexistentes: no fim
	return order;
}

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
 * Frente zfight2: faces VISÍVEIS do mesmo lado sobrepostas a menos de `minGap` (MIN_ENTITY_FACE_GAP) uma da outra, na
 * pose de repouso (pivôs e rotações aplicados), no mesmo osso ou entre OSSOS DIFERENTES (o separador antigo só olhava o
 * mesmo osso) — ex. as velas da frente/de trás do Chandelure, os olhos 0,01 px sobre os óculos do Mamoswine, as faces
 * que a espessura dos planos deixou empatadas. Fica por cima quem já estava na frente; no mesmo plano, o cubo que o
 * Java desenha depois (boneDrawOrder; mesmo osso: índice maior). Só a face de cima anda para fora, no espaço do cubo
 * (com rotação do cubo ela anda no eixo girado): `size` do eixo cresce o que falta para o vão e a origem recua quando a
 * face é a do lado mínimo; as outras cinco faces ficam onde estão. (Com inflate as seis andavam e pilhas chegavam a
 * +0,3 px no tamanho; transladando, a face oposta entrava e empatava do outro lado — a "pattern" do Bulbasaur, as
 * membranas das asas do Charizard iam e voltavam.) Um plano vira uma lâmina fina (continua com a espessura do
 * inflate). A face só anda para fora: o processo termina. A UV por face não muda; na UV de caixa a faixa cresce o mesmo
 * tanto em texels (≤ 0,15). Pares guardados dentro de outros cubos (expressões alternativas) ficam como no Java
 * (coplanarConflicts `skipHidden`). Devolve quantos cubos mudaram.
 */
export function shiftCoplanarCubes(geo: any, maxPasses = 40, minGap = MIN_ENTITY_FACE_GAP): number {
	const changed = new Set<string>();
	const order = boneDrawOrder(geo);
	const byName = new Map<string, any>((geo?.bones ?? []).map((b: any) => [b.name, b]));
	const normalOf = new Map(DIRS.map(([name, n, axis]) => [name, { axis, sign: n[axis] }]));
	const round = (v: number) => Math.round(v * 10000) / 10000;
	for (let pass = 0; pass < maxPasses; pass++) {
		// eps um pouco abaixo do vão: faces já a minGap não entram.
		const pairs = coplanarConflicts(geometryFaces(geo), { doubleSided: false, minArea: 0.05, eps: Math.max(1e-3, minGap - 1e-4), skipHidden: true }).filter((z) => z.a.bone !== z.b.bone || z.a.cube !== z.b.cube);
		if (!pairs.length) break;
		const moved = new Set<string>();
		for (const z of pairs) {
			const da = faceDistance(z.a), db = faceDistance(z.b);
			// No mesmo plano decide a ordem de desenho do Java; com vão, fica por cima quem já estava na frente.
			const aTop = Math.abs(da - db) < 1e-3
				? (z.a.bone === z.b.bone ? z.a.cube > z.b.cube : (order.get(z.a.bone) ?? 0) > (order.get(z.b.bone) ?? 0))
				: da > db;
			const top = aTop ? z.a : z.b, low = aTop ? z.b : z.a;
			const key = `${top.bone}#${top.cube}`;
			// Um passo por cubo e por passada; se o de baixo já andou nesta passada, o par é revisto na próxima.
			if (moved.has(key) || moved.has(`${low.bone}#${low.cube}`)) continue;
			const cube = byName.get(top.bone)?.cubes?.[top.cube];
			const n = normalOf.get(top.dir);
			if (!cube || !n || !Array.isArray(cube.origin) || !Array.isArray(cube.size)) continue;
			// Quanto falta para o vão mínimo (ao menos 0,01 px por passo).
			const step = round(Math.max(COPLANAR_SEPARATION, minGap - Math.abs(da - db)));
			cube.origin = [...cube.origin];
			cube.size = [...cube.size];
			cube.size[n.axis] = round(cube.size[n.axis] + step);
			if (n.sign < 0) cube.origin[n.axis] = round(cube.origin[n.axis] - step);
			moved.add(key);
			changed.add(key);
		}
		if (!moved.size) break;
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

// ---------------------------------------------------------------------------------------------------------------
// Frente cliente-teste3-log: planos de espessura zero nas geometrias de ENTIDADE (Pokémon, NPC, bolas, exibições).
//
// No Java os modelos das entidades são desenhados com RenderType.entityCutout/entityTranslucent, que descartam a face
// de trás: de cada lado de um plano (cubo com uma dimensão 0: folhas, penas, franjas, o "cachecol" do Slowking de
// Galar) aparece só a face virada para quem olha. Os materiais de entidade do Bedrock usados aqui (entity_alphatest,
// entity_alphablend, entity_emissive_alpha) desenham as duas faces, no MESMO plano e com texturas diferentes (outra
// região da textura, espelhada) → z-fighting (~40–50% dos Pokémon no 3º teste em cliente).
// O Bedrock não tem material de entidade vanilla com recorte e descarte de face de trás (a lista da bedrock.dev só tem
// entity_emissive_alpha_one_sided, que usa o alfa como brilho, não como recorte), e material próprio em resource
// pack não é suportado de forma confiável com o RenderDragon. Correção na geometria: o plano ganha espessura
// (`inflate` +FLAT_ENTITY_INFLATE px): as duas faces se separam, cada lado mostra a sua face na frente (a outra fica
// atrás, escondida pela profundidade), como no Java. A UV não muda (inflate não mexe na UV); o plano cresce
// 2 × 0,025 px (1/40 de texel) e as bordas viram faixas de 0,05 px, invisíveis. A diferença de inflate entre planos
// empilhados (separateCoplanarCubes) é mantida, porque todos sobem o mesmo tanto.

/** Inflate acrescentado aos cubos de espessura zero das entidades (px). */
export const FLAT_ENTITY_INFLATE = 0.025;

/**
 * Cubo plano de entidade ainda sem espessura bastante: uma dimensão 0 (as outras duas não) e espessura
 * (2 × inflate) abaixo de 2 × FLAT_ENTITY_INFLATE. Os que só tinham o inflate de 0,01 do separateCoplanarCubes
 * (0,02 px entre as faces) também entram: de longe a profundidade não separa 0,02 px.
 */
export function isFlatEntityCube(c: any, oneSided = false): boolean {
	if (!Array.isArray(c?.size) || c.size.length !== 3) return false;
	const zero = c.size.filter((s: number) => Math.abs(s) < 1e-6).length;
	if (zero !== 1) return false;
	// Frente zfight2: plano com inflate negativo = plano "de fundo" do Java (as faces ficam |inflate| para dentro, atrás
	// do plano vizinho dos DOIS lados — ex. costelas do Eternatus). Com material de um lado (descarte de face de trás,
	// como o entityCutout do Java) ele já não briga: fica como no Java.
	if (oneSided && (c.inflate ?? 0) < 0) return false;
	return 2 * (c.inflate ?? 0) < 2 * FLAT_ENTITY_INFLATE - 1e-9;
}

/** Cubos planos de uma geometria de entidade ("osso#índice"). */
export function flatEntityCubes(geo: any, oneSided = false): string[] {
	const out: string[] = [];
	for (const b of geo?.bones ?? []) (b.cubes ?? []).forEach((c: any, i: number) => { if (isFlatEntityCube(c, oneSided)) out.push(`${b.name}#${i}`); });
	return out;
}

const isPlane = (c: any) => Array.isArray(c?.size) && c.size.length === 3 && c.size.filter((s: number) => Math.abs(s) < 1e-6).length === 1;

/**
 * Dá espessura aos cubos planos. Frente zfight2: TODOS os planos com inflate ≥ 0 da geometria sobem o mesmo
 * FLAT_ENTITY_INFLATE (antes só os finos subiam e o inflate negativo virava FLAT_ENTITY_INFLATE: um plano de 0 e um de
 * 0,025, ou um de 0 e um de -0,01, ficavam no MESMO plano — o z-fighting das costelas do Eternatus). Assim a ordem
 * entre os planos empilhados continua a do Java. Inflate negativo: `oneSided` (material com descarte de face de trás)
 * mantém o do Java; sem isso todos os planos sobem FLAT − (inflate mais negativo), o mesmo tanto (mantém a ordem).
 * Nada muda se a geometria já não tem plano fino (idempotente).
 */
export function thickenFlatEntityCubes(geo: any, oneSided = false): number {
	const cubes: any[] = [];
	for (const b of geo?.bones ?? []) for (const c of b.cubes ?? []) if (isPlane(c)) cubes.push(c);
	if (!cubes.some((c) => isFlatEntityCube(c, oneSided))) return 0;
	const minNeg = oneSided ? 0 : Math.min(0, ...cubes.map((c) => c.inflate ?? 0));
	let n = 0;
	for (const c of cubes) {
		const g = c.inflate ?? 0;
		if (g < 0 && oneSided) continue;
		c.inflate = Math.round((g + FLAT_ENTITY_INFLATE - minNeg) * 10000) / 10000;
		n++;
	}
	return n;
}

/**
 * Pós-passe do import: todas as geometrias em models/entity do RP gerado. Frente zfight2: as de Pokémon
 * (models/entity/pokemon; só as client entities de Pokémon as desenham, com material de um lado —
 * zfightEntities.POKEMON_MATERIALS) mantêm os planos negativos do Java e, depois da espessura, as faces coplanares que
 * aparecem na pose de repouso (mesmo osso ou entre ossos) são separadas movendo só a face em conflito
 * (shiftCoplanarCubes).
 */
export function fixEntityFlatPlanes(root = `${OUT_RP}/models/entity`): { cubes: number; geometries: number; separated: number } {
	let cubes = 0, geometries = 0, separated = 0;
	for (const f of walk(root, (n) => n.endsWith(".json"))) {
		const json = tryReadJson(f);
		const pokemon = /[\\/]models[\\/]entity[\\/]pokemon[\\/]/.test(f);
		let changed = 0;
		for (const g of json?.["minecraft:geometry"] ?? []) {
			const k = thickenFlatEntityCubes(g, pokemon);
			if (k) { changed += k; cubes += k; geometries++; }
			if (pokemon) {
				const s = shiftCoplanarCubes(g);
				if (s) { separated += s; changed += s; }
			}
		}
		if (changed) writeJson(f, json);
	}
	return { cubes, geometries, separated };
}
