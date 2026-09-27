// Rasterizador de software (JS puro, sem GL) para geometria Bedrock no estilo do Cobblemon.
// Reproduz a conversão do TexturedModel.kt (Bedrock → ModelPart do Java), a montagem dos cubos do
// ModelPart.Cube do Minecraft (box UV), a aplicação de animações (BedrockAnimation.kt, com y invertido
// na posição) e a cadeia de matrizes de drawPosablePortrait / drawProfilePokemon (GuiUtils.kt,
// PokemonGuiUtils.kt), incluindo as duas luzes direcionais do shader de entidade.
import { decodePng, encodePng, type Png } from "../png.ts";
import { compileMolang, type MolangCtx } from "./molang.ts";

// ------------------------------------------------------------------------------------------------
// Matrizes 4x4 (coluna-maior, como JOML)

type Mat = Float64Array;
const ident = (): Mat => {
	const m = new Float64Array(16);
	m[0] = m[5] = m[10] = m[15] = 1;
	return m;
};
function mul(a: Mat, b: Mat): Mat {
	const o = new Float64Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
			o[c * 4 + r] = s;
		}
	return o;
}
const T = (x: number, y: number, z: number): Mat => {
	const m = ident();
	m[12] = x;
	m[13] = y;
	m[14] = z;
	return m;
};
const S = (x: number, y: number, z: number): Mat => {
	const m = ident();
	m[0] = x;
	m[5] = y;
	m[10] = z;
	return m;
};
function RX(a: number): Mat {
	const m = ident(), c = Math.cos(a), s = Math.sin(a);
	m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
	return m;
}
function RY(a: number): Mat {
	const m = ident(), c = Math.cos(a), s = Math.sin(a);
	m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
	return m;
}
function RZ(a: number): Mat {
	const m = ident(), c = Math.cos(a), s = Math.sin(a);
	m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
	return m;
}
const deg = Math.PI / 180;
function xf(m: Mat, x: number, y: number, z: number): [number, number, number] {
	return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
/** Normal pela inversa-transposta do 3x3. */
function xfNormal(m: Mat, n: [number, number, number]): [number, number, number] {
	const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
	const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
	const Dd = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
	const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
	// inv^T = cofator / det; o det só muda o sinal/escala → normalizamos e corrigimos o sinal.
	const det = a * A + b * B + c * C;
	let x = A * n[0] + B * n[1] + C * n[2];
	let y = Dd * n[0] + E * n[1] + F * n[2];
	let z = G * n[0] + H * n[1] + I * n[2];
	const s = Math.sign(det) / (Math.hypot(x, y, z) || 1);
	return [x * s, y * s, z * s];
}

// ------------------------------------------------------------------------------------------------
// Modelo (espaço do ModelPart do Java: x igual ao Bedrock, y invertido, unidades em px)

interface Face {
	v: [number, number, number][];
	uv: [number, number][]; // normalizado 0..1 (pela texture_width/height da geometria)
	n: [number, number, number];
	uvMin: [number, number];
	uvMax: [number, number];
}
export interface Part {
	name: string;
	x: number; y: number; z: number;
	xRot: number; yRot: number; zRot: number;
	xs: number; ys: number; zs: number;
	visible: boolean;
	init: number[];
	faces: Face[];
	children: Part[];
}
export interface Model {
	root: Part;
	parts: Map<string, Part>;
	texW: number;
	texH: number;
	cubes: number;
}

function newPart(name: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Part {
	return { name, x, y, z, xRot: rx, yRot: ry, zRot: rz, xs: 1, ys: 1, zs: 1, visible: true, init: [x, y, z, rx, ry, rz], faces: [], children: [] };
}

/** ModelPart.Cube do Minecraft 1.21 (box UV) + UV por face do Bedrock (mapeamento aproximado). */
function addCube(part: Part, uv: any, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, g: number, mirror: boolean, tw: number, th: number): void {
	let x0 = ox - g, y0 = oy - g, z0 = oz - g, x1 = ox + dx + g, y1 = oy + dy + g, z1 = oz + dz + g;
	if (mirror) [x0, x1] = [x1, x0];
	const v1: [number, number, number] = [x0, y0, z0], v2: [number, number, number] = [x1, y0, z0], v3: [number, number, number] = [x1, y1, z0], v4: [number, number, number] = [x0, y1, z0];
	const v5: [number, number, number] = [x0, y0, z1], v6: [number, number, number] = [x1, y0, z1], v7: [number, number, number] = [x1, y1, z1], v8: [number, number, number] = [x0, y1, z1];
	type Dir = "down" | "up" | "west" | "north" | "east" | "south";
	const quads: [Dir, [number, number, number][], [number, number, number]][] = [
		["down", [v6, v5, v1, v2], [0, -1, 0]],
		["up", [v3, v4, v8, v7], [0, 1, 0]],
		["west", [v1, v5, v8, v4], [-1, 0, 0]],
		["north", [v2, v1, v4, v3], [0, 0, -1]],
		["east", [v6, v2, v3, v7], [1, 0, 0]],
		["south", [v5, v6, v7, v8], [0, 0, 1]],
	];
	let rects: Record<Dir, [number, number, number, number] | undefined>;
	if (Array.isArray(uv) || uv === undefined) {
		const u0 = uv?.[0] ?? 0, w0 = uv?.[1] ?? 0;
		const j = u0, k = u0 + dz, l = u0 + dz + dx, m = u0 + dz + dx + dx, n = u0 + dz + dx + dz, o = u0 + dz + dx + dz + dx;
		const p = w0, q = w0 + dz, r = w0 + dz + dy;
		rects = { down: [k, p, l, q], up: [l, q, m, p], west: [j, q, k, r], north: [k, q, l, r], east: [l, q, n, r], south: [n, q, o, r] };
	} else {
		// UV por face (Bedrock): o "up" do Bedrock é o DOWN do Java (y invertido) e east/west trocam.
		const pf = (name: string): [number, number, number, number] | undefined => {
			const f = uv[name];
			if (!f?.uv) return undefined;
			const [u, v] = f.uv, [w, h] = f.uv_size ?? [0, 0];
			return [u, v, u + w, v + h];
		};
		rects = { down: pf("up"), up: pf("down"), west: pf("east"), north: pf("north"), east: pf("west"), south: pf("south") };
	}
	for (const [dir, verts, n] of quads) {
		const rc = rects[dir];
		if (!rc) continue;
		const [u1, vv1, u2, vv2] = rc;
		const uvs: [number, number][] = [[u2 / tw, vv1 / th], [u1 / tw, vv1 / th], [u1 / tw, vv2 / th], [u2 / tw, vv2 / th]];
		part.faces.push({
			v: verts.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
			uv: uvs,
			n: mirror ? [-n[0], n[1], n[2]] : n,
			uvMin: [Math.min(u1, u2) / tw, Math.min(vv1, vv2) / th],
			uvMax: [Math.max(u1, u2) / tw, Math.max(vv1, vv2) / th],
		});
	}
}

/** TexturedModel.createWithUvOverride do Cobblemon. */
export function buildModel(geoJson: any): Model {
	const geo = geoJson["minecraft:geometry"][0];
	const tw = geo.description.texture_width ?? 64, th = geo.description.texture_height ?? 64;
	const bones: any[] = geo.bones ?? [];
	const byName = new Map<string, any>(bones.map((b) => [b.name, b]));
	const parts = new Map<string, Part>();
	let root: Part | undefined;
	const top = newPart("__root__");
	let cubes = 0;
	for (const b of bones) {
		const parent = b.parent ? byName.get(b.parent) : undefined;
		const pv = b.pivot ?? [0, 0, 0];
		let part: Part;
		if (!parent) part = newPart(b.name);
		else {
			const pp = parent.pivot ?? [0, 0, 0];
			const r = b.rotation ?? [0, 0, 0];
			part = newPart(b.name, pv[0] - pp[0], pp[1] - pv[1], pv[2] - pp[2], r[0] * deg, r[1] * deg, r[2] * deg);
		}
		for (const c of b.cubes ?? []) {
			if (!c.size || !c.origin) continue;
			cubes++;
			const cp = c.pivot ?? pv;
			let target = part;
			if (c.rotation) {
				target = newPart(`%${b.name}%`, cp[0] - pv[0], pv[1] - cp[1], cp[2] - pv[2], c.rotation[0] * deg, c.rotation[1] * deg, c.rotation[2] * deg);
				part.children.push(target);
			}
			addCube(target, c.uv, c.origin[0] - cp[0], -(c.origin[1] - cp[1] + c.size[1]), c.origin[2] - cp[2], c.size[0], c.size[1], c.size[2], c.inflate ?? 0, !!c.mirror, tw, th);
		}
		parts.set(b.name, part);
	}
	for (const b of bones) {
		const part = parts.get(b.name)!;
		const parent = b.parent ? parts.get(b.parent) : undefined;
		if (parent) parent.children.push(part);
		else {
			top.children.push(part);
			root ??= part;
		}
	}
	return { root: top, parts, texW: tw, texH: th, cubes };
}

export function resetPose(model: Model): void {
	for (const p of model.parts.values()) {
		[p.x, p.y, p.z, p.xRot, p.yRot, p.zRot] = p.init;
		p.xs = p.ys = p.zs = 1;
		p.visible = true;
	}
}

// ------------------------------------------------------------------------------------------------
// Animações (BedrockAnimation.kt: posição com y invertido; rotação em graus somada; escala multiplica)

function evalVec(v: any, ctx: MolangCtx, fallback: number): [number, number, number] {
	if (v === undefined || v === null) return [fallback, fallback, fallback];
	if (!Array.isArray(v)) {
		const f = compileMolang(v);
		const x = f ? f(ctx) : fallback;
		return [x, x, x];
	}
	return [0, 1, 2].map((i) => {
		const f = compileMolang(v[i]);
		return f ? f(ctx) : fallback;
	}) as [number, number, number];
}

function sampleChannel(ch: any, t: number, ctx: MolangCtx, fallback: number): [number, number, number] | undefined {
	if (ch === undefined) return undefined;
	if (Array.isArray(ch) || typeof ch !== "object") return evalVec(ch, ctx, fallback);
	const keys = Object.keys(ch).map(Number).sort((a, b) => a - b);
	if (!keys.length) return undefined;
	const at = (k: number, side: "pre" | "post") => {
		const v = ch[String(k)] ?? ch[Object.keys(ch).find((s) => Number(s) === k)!];
		if (Array.isArray(v) || typeof v !== "object") return evalVec(v, ctx, fallback);
		return evalVec(v[side] ?? v.post ?? v.pre, ctx, fallback);
	};
	if (t <= keys[0]) return at(keys[0], "pre");
	if (t >= keys[keys.length - 1]) return at(keys[keys.length - 1], "post");
	let i = 0;
	while (keys[i + 1] < t) i++;
	const a = at(keys[i], "post"), b = at(keys[i + 1], "pre");
	const f = (t - keys[i]) / (keys[i + 1] - keys[i]);
	return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function applyAnimation(model: Model, anim: any, t: number, aspects: Set<string>): { bones: number; dynamic: number } {
	const ctx: MolangCtx = { q: { anim_time: t, life_time: t, delta_time: 0 }, aspects };
	let bones = 0, dynamic = 0;
	for (const [name, ch] of Object.entries<any>(anim.bones ?? {})) {
		const part = model.parts.get(name);
		if (!part) continue;
		bones++;
		if (JSON.stringify(ch).includes("q")) dynamic++;
		const pos = sampleChannel(ch.position, t, ctx, 0);
		if (pos) {
			part.x += pos[0];
			part.y -= pos[1];
			part.z += pos[2];
		}
		const rot = sampleChannel(ch.rotation, t, ctx, 0);
		if (rot) {
			part.xRot += rot[0] * deg;
			part.yRot += rot[1] * deg;
			part.zRot += rot[2] * deg;
		}
		const sc = sampleChannel(ch.scale, t, ctx, 1);
		if (sc) {
			part.xs *= sc[0];
			part.ys *= sc[1];
			part.zs *= sc[2];
		}
	}
	return { bones, dynamic };
}

/** transformedParts do poser (ModelPartTransformation.apply: posição crua, rotação em graus, visibilidade). */
export function applyTransformedParts(model: Model, list: any[], aspects: Set<string>): void {
	const ctx: MolangCtx = { q: {}, aspects };
	for (const tp of list ?? []) {
		const part = model.parts.get(tp.part);
		if (!part) continue;
		if (tp.position) {
			part.x += tp.position[0];
			part.y += tp.position[1];
			part.z += tp.position[2];
		}
		if (tp.rotation) {
			part.xRot += tp.rotation[0] * deg;
			part.yRot += tp.rotation[1] * deg;
			part.zRot += tp.rotation[2] * deg;
		}
		if (tp.scale) {
			part.xs *= tp.scale[0];
			part.ys *= tp.scale[1];
			part.zs *= tp.scale[2];
		}
		const vis = tp.isVisible ?? tp.visible;
		if (vis !== undefined) {
			const f = compileMolang(vis);
			part.visible = f ? f(ctx) !== 0 : true;
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Enquadramento (cadeias de matriz da GUI do Cobblemon)

export interface PoserFraming {
	portraitScale: number;
	portraitTranslation: [number, number, number];
	profileScale: number;
	profileTranslation: [number, number, number];
}

export interface Frame {
	/** Matriz GUI → modelo (antes das partes). */
	matrix: Mat;
	/** Retângulo do scissor em unidades da GUI; undefined = enquadrar pela caixa do modelo. */
	box?: [number, number, number, number];
	lights: [[number, number, number], [number, number, number]];
}

export type FrameMode = "portrait" | "portrait_party" | "profile" | "icon";

export function makeFrame(mode: FrameMode, p: PoserFraming): Frame {
	const portraitChain = (originX: number, originY: number, scale: number): Mat => {
		const PD = 28; // BattleOverlay.PORTRAIT_DIAMETER, importado por GuiUtils.kt
		let m = T(originX, originY, 0);
		m = mul(m, T(0, PD + 2, 0));
		m = mul(m, S(scale, scale, -scale));
		m = mul(m, T(0, -PD / 18, 0));
		const [tx, ty, tz] = p.portraitTranslation;
		m = mul(m, T(tx, ty + 1.5 * p.portraitScale, tz - 4));
		m = mul(m, S(p.portraitScale, p.portraitScale, 1 / p.portraitScale));
		m = mul(m, RY(-32 * deg));
		m = mul(m, RX(5 * deg));
		return m;
	};
	const portraitLights: Frame["lights"] = [[0.2, 1.0, -1.0], [0.1, 0.0, 8.0]];
	const profileLights: Frame["lights"] = [[-1, 1, 1], [1.3, -1, 1]];
	if (mode === "portrait") {
		// Tile de batalha (BattleOverlay, não compacto): scissor 28x28, origem (14, -5), escala 18.
		return { matrix: portraitChain(14, -5, 18), box: [0, 0, 28, 28], lights: portraitLights };
	}
	if (mode === "portrait_party") {
		// PartyOverlay: scissor 21x21, origem (21/2 - 1, -12), escala 13.
		return { matrix: portraitChain(9.5, -12, 13), box: [0, 0, 21, 21], lights: portraitLights };
	}
	// Summary.kt: ModelWidget 66x66, translate(33, -10), scale(2), drawProfilePokemon(scale=20, SUMMARY),
	// rotação XYZ(13°, 325°, 0°).
	let m = T(33, -10, 0);
	m = mul(m, S(2, 2, 2));
	m = mul(m, S(20, 20, -20));
	const [tx, ty, tz] = p.profileTranslation;
	m = mul(m, T(tx, ty + 1.5 * p.profileScale, tz - 4));
	m = mul(m, S(p.profileScale, p.profileScale, 1 / p.profileScale));
	m = mul(m, mul(RX(13 * deg), RY(325 * deg)));
	return { matrix: m, box: mode === "profile" ? [0, 0, 66, 66] : undefined, lights: profileLights };
}

// ------------------------------------------------------------------------------------------------
// Rasterização

/**
 * Camada de textura, como o PosableModel.getLayer/makeLayer do Cobblemon:
 *  - base e camadas sem `translucent`: entityCutout (descarta alfa < 0,1, escreve opaco);
 *  - `translucent`: mistura por alfa;
 *  - `emissive`: sem luz (lightmap desligado), com ou sem mistura.
 * O chamador passa a base primeiro; as demais já ordenadas por `translucent` (sortedBy estável).
 */
export interface Layer {
	tex: Png;
	blend: boolean;
	emissive: boolean;
}

interface Tri {
	p: [number, number, number][]; // espaço GUI
	uv: [number, number][];
	uvMin: [number, number];
	uvMax: [number, number];
	shade: number;
}

function collect(model: Model, frame: Frame): Tri[] {
	const tris: Tri[] = [];
	const [l0, l1] = frame.lights.map((l) => {
		const n = Math.hypot(l[0], l[1], l[2]);
		return [l[0] / n, l[1] / n, l[2] / n];
	});
	const visit = (part: Part, parent: Mat) => {
		if (!part.visible) return;
		let m = mul(parent, T(part.x / 16, part.y / 16, part.z / 16));
		if (part.xRot || part.yRot || part.zRot) m = mul(m, mul(RZ(part.zRot), mul(RY(part.yRot), RX(part.xRot))));
		if (part.xs !== 1 || part.ys !== 1 || part.zs !== 1) m = mul(m, S(part.xs, part.ys, part.zs));
		for (const f of part.faces) {
			const p = f.v.map((v) => xf(m, v[0] / 16, v[1] / 16, v[2] / 16));
			const n = xfNormal(m, f.n);
			const lit = Math.max(0, n[0] * l0[0] + n[1] * l0[1] + n[2] * l0[2]) + Math.max(0, n[0] * l1[0] + n[1] * l1[1] + n[2] * l1[2]);
			const shade = Math.min(1, lit * 0.6 + 0.4);
			tris.push({ p: [p[0], p[1], p[2]], uv: [f.uv[0], f.uv[1], f.uv[2]], uvMin: f.uvMin, uvMax: f.uvMax, shade });
			tris.push({ p: [p[0], p[2], p[3]], uv: [f.uv[0], f.uv[2], f.uv[3]], uvMin: f.uvMin, uvMax: f.uvMax, shade });
		}
		for (const c of part.children) visit(c, m);
	};
	visit(model.root, frame.matrix);
	return tris;
}

export interface RenderResult {
	/** RGBA float pré-multiplicado, tamanho size*ss. */
	buf: Float32Array;
	w: number;
	tris: number;
	coverage: number;
}

export function rasterize(model: Model, frame: Frame, layers: Layer[], size: number, ss: number, margin = 0.06): RenderResult {
	const tris = collect(model, frame);
	const W = size * ss;
	let [bx0, by0, bx1, by1] = frame.box ?? [0, 0, 0, 0];
	if (!frame.box) {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const t of tris) for (const p of t.p) {
			minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
			minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
		}
		const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
		const half = (Math.max(maxX - minX, maxY - minY) / 2) * (1 + margin * 2);
		[bx0, by0, bx1, by1] = [cx - half, cy - half, cx + half, cy + half];
	}
	const sx = W / (bx1 - bx0), sy = W / (by1 - by0);
	const color = new Float32Array(W * W * 4);
	const depth = new Float32Array(W * W).fill(-Infinity);
	for (let li = 0; li < layers.length; li++) {
		const layer = layers[li];
		const tex = layer.tex;
		const tw = tex.width, th = tex.height, px = tex.rgba;
		for (const t of tris) {
			const X = t.p.map((p) => (p[0] - bx0) * sx), Y = t.p.map((p) => (p[1] - by0) * sy), Z = t.p.map((p) => p[2]);
			const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
			if (Math.abs(area) < 1e-9) continue;
			const minx = Math.max(0, Math.floor(Math.min(X[0], X[1], X[2]))), maxx = Math.min(W - 1, Math.ceil(Math.max(X[0], X[1], X[2])));
			const miny = Math.max(0, Math.floor(Math.min(Y[0], Y[1], Y[2]))), maxy = Math.min(W - 1, Math.ceil(Math.max(Y[0], Y[1], Y[2])));
			if (minx > maxx || miny > maxy) continue;
			const umin = Math.floor(t.uvMin[0] * tw + 1e-4), umax = Math.ceil(t.uvMax[0] * tw - 1e-4) - 1;
			const vmin = Math.floor(t.uvMin[1] * th + 1e-4), vmax = Math.ceil(t.uvMax[1] * th - 1e-4) - 1;
			const inv = 1 / area;
			const shade = layer.emissive ? 1 : t.shade;
			for (let y = miny; y <= maxy; y++) {
				const py = y + 0.5;
				for (let x = minx; x <= maxx; x++) {
					const pxx = x + 0.5;
					const w0 = ((X[1] - pxx) * (Y[2] - py) - (X[2] - pxx) * (Y[1] - py)) * inv;
					const w1 = ((X[2] - pxx) * (Y[0] - py) - (X[0] - pxx) * (Y[2] - py)) * inv;
					const w2 = 1 - w0 - w1;
					if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
					const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2];
					const di = y * W + x;
					if (z < depth[di] - (li ? 1e-4 : 0)) continue;
					const u = w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0];
					const v = w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1];
					let tu = Math.floor(u * tw), tv = Math.floor(v * th);
					tu = Math.min(Math.max(tu, umin, 0), umax, tw - 1);
					tv = Math.min(Math.max(tv, vmin, 0), vmax, th - 1);
					const o = (tv * tw + tu) * 4;
					const a = px[o + 3] / 255;
					const ci = di * 4;
					if (!layer.blend) {
						if (a < 0.1) continue; // entityCutout
						depth[di] = z;
						color[ci] = (px[o] / 255) * shade;
						color[ci + 1] = (px[o + 1] / 255) * shade;
						color[ci + 2] = (px[o + 2] / 255) * shade;
						color[ci + 3] = 1;
					} else {
						if (a <= 0.004) continue;
						const r = (px[o] / 255) * shade, g = (px[o + 1] / 255) * shade, b = (px[o + 2] / 255) * shade;
						color[ci] = r * a + color[ci] * (1 - a);
						color[ci + 1] = g * a + color[ci + 1] * (1 - a);
						color[ci + 2] = b * a + color[ci + 2] * (1 - a);
						color[ci + 3] = a + color[ci + 3] * (1 - a);
					}
				}
			}
		}
	}
	let cov = 0;
	for (let i = 3; i < color.length; i += 4) if (color[i] > 0) cov++;
	return { buf: color, w: W, tris: tris.length, coverage: cov / (W * W) };
}

/** Reduz por média de caixa (alfa pré-multiplicado) para `size` e codifica PNG RGBA. */
export function downsample(r: RenderResult, size: number): Png {
	const f = r.w / size;
	const out = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			let R = 0, G = 0, B = 0, A = 0;
			for (let j = 0; j < f; j++)
				for (let i = 0; i < f; i++) {
					const o = ((y * f + j) * r.w + (x * f + i)) * 4;
					R += r.buf[o]; G += r.buf[o + 1]; B += r.buf[o + 2]; A += r.buf[o + 3];
				}
			const o = (y * size + x) * 4;
			if (A > 0) {
				out[o] = Math.round(Math.min(1, R / A) * 255);
				out[o + 1] = Math.round(Math.min(1, G / A) * 255);
				out[o + 2] = Math.round(Math.min(1, B / A) * 255);
				out[o + 3] = Math.round((A / (f * f)) * 255);
			}
		}
	return { width: size, height: size, rgba: out };
}

export { decodePng, encodePng };
