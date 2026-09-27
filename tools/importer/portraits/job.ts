// Renderização de um lote de retratos (roda em worker_threads, mas também pode ser chamada direto).
// Cada spec gera, por modo, um PNG por tamanho. O cache fica em disco por hash das entradas: se a chave não
// mudou, o PNG é lido do cache e nada é rasterizado.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { firstFrame } from "../png.ts";
import { readJson } from "../util.ts";
import { compileMolang } from "./molang.ts";
import { applyAnimation, applyTransformedParts, buildModel, decodePng, downsample, encodePng, makeFrame, rasterize, resetPose } from "./render.ts";
import type { Layer, Model } from "./render.ts";
import type { PortraitPoser, UiPose } from "./posers.ts";

/** Muda quando o renderizador muda de resultado (invalida o cache). */
export const RENDERER_VERSION = "retratos-1";

export type PortraitMode = "portrait" | "profile";

export interface RenderSpec {
	/** Identificador da spec no lote. */
	id: string;
	/** Arquivo .geo.json (upstream). */
	model: string;
	/** Base primeiro; camadas já ordenadas como o Cobblemon (sortedBy translucent). */
	layers: Array<{ file: string; blend: boolean; emissive: boolean }>;
	/** Aspects da combinação (só importam para q.has_aspect em transformedParts/condições). */
	aspects: string[];
	poser: PortraitPoser;
	/** "grupo|nome" → arquivo de animação (upstream). */
	animFiles: Record<string, string>;
	modes: Array<{ mode: PortraitMode; sizes: number[]; ss: number }>;
}

export interface RenderOutput {
	id: string;
	/** "modo/tamanho" → PNG. */
	png: Record<string, Uint8Array>;
	/** Fração do quadro coberta (modo → 0..1), para detectar retrato vazio. */
	coverage: Record<string, number>;
	cached: number;
	rendered: number;
	error?: string;
}

const fileHash = new Map<string, string>();
function hashFile(file: string): string {
	let h = fileHash.get(file);
	if (!h) {
		h = createHash("sha1").update(readFileSync(file)).digest("hex");
		fileHash.set(file, h);
	}
	return h;
}

const animFiles = new Map<string, any>();
function animation(file: string, group: string, name: string): any {
	let json = animFiles.get(file);
	if (json === undefined) {
		try {
			json = readJson(file)?.animations ?? null;
		} catch {
			json = null;
		}
		animFiles.set(file, json);
	}
	return json?.[`animation.${group}.${name}`];
}

const models = new Map<string, Model | null>();
function model(file: string): Model | null {
	let m = models.get(file);
	if (m === undefined) {
		try {
			m = buildModel(readJson(file));
		} catch {
			m = null;
		}
		models.set(file, m);
	}
	return m;
}

const textures = new Map<string, Layer["tex"] | null>();
function texture(file: string): Layer["tex"] | null {
	let t = textures.get(file);
	if (t === undefined) {
		const png = existsSync(file) ? decodePng(file) : undefined;
		t = png ? firstFrame(png) : null;
		textures.set(file, t);
	}
	return t;
}

/** Aplica a pose de UI (transformedParts + animações em t=0, com condições). */
function applyPose(m: Model, pose: UiPose, spec: RenderSpec, aspects: Set<string>): void {
	resetPose(m);
	applyTransformedParts(m, pose.transformed, aspects);
	for (const a of pose.anims) {
		if (a.condition) {
			const f = compileMolang(a.condition);
			if (f && !f({ q: {}, aspects })) continue;
		}
		const file = spec.animFiles[`${a.group}|${a.name}`];
		const anim = file ? animation(file, a.group, a.name) : undefined;
		if (anim) applyAnimation(m, anim, 0, aspects);
	}
}

function cacheKey(spec: RenderSpec, mode: PortraitMode, pose: UiPose, ss: number): string {
	const h = createHash("sha1");
	h.update(RENDERER_VERSION).update(mode).update(String(ss)).update(hashFile(spec.model));
	for (const l of spec.layers) h.update(`${hashFile(l.file)}:${l.blend}:${l.emissive}`);
	const p = spec.poser;
	h.update(JSON.stringify([mode === "portrait" ? [p.portraitScale, p.portraitTranslation] : [p.profileScale, p.profileTranslation], pose.transformed, spec.aspects]));
	for (const a of pose.anims) {
		const file = spec.animFiles[`${a.group}|${a.name}`];
		h.update(`${a.group}|${a.name}|${a.condition ?? ""}|${file ? JSON.stringify(animation(file, a.group, a.name) ?? null) : ""}`);
	}
	return h.digest("hex");
}

export function renderSpecs(specs: RenderSpec[], cacheDir: string | undefined): RenderOutput[] {
	if (cacheDir) mkdirSync(cacheDir, { recursive: true });
	const out: RenderOutput[] = [];
	for (const spec of specs) {
		const res: RenderOutput = { id: spec.id, png: {}, coverage: {}, cached: 0, rendered: 0 };
		try {
			const aspects = new Set(spec.aspects);
			let m: Model | null | undefined;
			let layers: Layer[] | undefined;
			for (const { mode, sizes, ss } of spec.modes) {
				const pose = mode === "portrait" ? spec.poser.portrait : spec.poser.profile;
				const key = cacheDir ? cacheKey(spec, mode, pose, ss) : "";
				const files = sizes.map((s) => (cacheDir ? join(cacheDir, `${key}_${s}.png`) : ""));
				const covFile = cacheDir ? join(cacheDir, `${key}.cov`) : "";
				if (cacheDir && files.every((f) => existsSync(f)) && existsSync(covFile)) {
					sizes.forEach((s, i) => (res.png[`${mode}/${s}`] = readFileSync(files[i])));
					res.coverage[mode] = Number(readFileSync(covFile, "utf8"));
					res.cached++;
					continue;
				}
				m ??= model(spec.model);
				if (!m) throw new Error(`modelo inválido: ${spec.model}`);
				if (!layers) {
					layers = [];
					for (const l of spec.layers) {
						const tex = texture(l.file);
						if (!tex) {
							if (!layers.length) throw new Error(`textura ausente: ${l.file}`);
							continue;
						}
						layers.push({ tex, blend: l.blend, emissive: l.emissive });
					}
				}
				applyPose(m, pose, spec, aspects);
				const frame = makeFrame(mode, spec.poser);
				const big = Math.max(...sizes);
				const r = rasterize(m, frame, layers, big, ss);
				res.coverage[mode] = r.coverage;
				res.rendered++;
				sizes.forEach((s, i) => {
					const png = encodePng(downsample(r, s));
					res.png[`${mode}/${s}`] = png;
					if (cacheDir) writeAtomic(files[i], png);
				});
				if (cacheDir) writeAtomic(covFile, String(r.coverage));
			}
		} catch (e) {
			res.error = (e as Error).message;
		}
		out.push(res);
	}
	return out;
}

/** Libera modelos, texturas e animações (chamado entre espécies para manter a memória baixa). */
export function clearCaches(): void {
	animFiles.clear();
	models.clear();
	textures.clear();
}

/** Escrita atômica (vários imports podem rodar ao mesmo tempo). */
function writeAtomic(file: string, data: Uint8Array | string): void {
	const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmp, data);
	renameSync(tmp, file);
}
