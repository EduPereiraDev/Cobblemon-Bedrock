// Retratos pré-renderizados dos Pokémon (frente "retratos"; pesquisa em docs/pesquisa/2-retratos.md).
// Rasteriza offline a geometria + texturas + camadas de cada variante com a pose e o enquadramento de UI
// do próprio Cobblemon e gera:
//  - textures/cobblemon/portraits/<espécie>_<n>.png       rosto (drawPosablePortrait, tile de batalha), 64 px
//  - textures/cobblemon/portrait_icons/<espécie>_<n>.png  o mesmo rosto em 32 px (ícones pequenos)
//  - textures/cobblemon/profiles/<espécie>_<n>.png        corpo inteiro (drawProfilePokemon, Summary), 128 px
//  - generated/scripts/portraits.ts                       (espécie, variant) → caminho
// `n` é o índice da imagem DISTINTA (dedupe pelo hash do PNG) na ordem dos variants; a tabela gerada faz
// variant → n. O cache (por hash das entradas) fica em node_modules/.cache/cobblemon-portraits.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { AnimationIndex } from "./animations.ts";
import type { ModelIndex } from "./models.ts";
import { renderSpecs } from "./portraits/job.ts";
import type { PortraitMode, RenderOutput, RenderSpec } from "./portraits/job.ts";
import { PortraitPoserIndex } from "./portraits/posers.ts";
import type { VariantsEntry } from "./scriptsOut.ts";
import { ASSETS, OUT_RP, OUT_SCRIPTS, ROOT, count, report, splitId, warn, writeText } from "./util.ts";
import { comboKey, resolveCombo } from "./variants.ts";
import type { Layer as VariantLayer, Variation } from "./variants.ts";

/**
 * Tamanhos e conjuntos (medidos em docs/pendencias/retratos.md):
 *  - retrato 64 + ícone 32 para TODAS as imagens distintas (formas, shiny, fêmea, cosméticos);
 *  - perfil 128 só para o recorte "base + shiny + formas" (sem fêmea nem cosmético): as demais variantes
 *    caem no perfil mais parecido, pelo mesmo placar do resolveVariant.
 */
export const PORTRAIT_CONFIG = {
	portrait: { sizes: [64, 32], ss: 4, maxPerSpecies: 80 },
	profile: { sizes: [128], ss: 2, set: "core" as "core" | "all", maxPerSpecies: 64 },
};

export const PORTRAIT_DIRS = { portrait: "textures/cobblemon/portraits", icon: "textures/cobblemon/portrait_icons", profile: "textures/cobblemon/profiles" };

const CACHE_DIR = process.env.COBBLEMON_PORTRAIT_CACHE ?? join(ROOT, "node_modules", ".cache", "cobblemon-portraits");

export interface PortraitInputs {
	variants: Map<string, VariantsEntry>;
	models: ModelIndex;
	anims: AnimationIndex;
	/** Número de workers (padrão: núcleos − 1, no máximo 8; 0 = no processo principal). */
	workers?: number;
	/** Desliga o cache em disco (testes). */
	noCache?: boolean;
}

interface VariantPlan {
	specId: string;
	/** Variante do recorte "core" (sem fêmea/cosmético). */
	core: boolean;
	/** Spec usada para o perfil (a própria ou a do variant core mais parecido). */
	profileSpecId: string;
}

interface SpeciesPlan {
	species: string;
	specs: RenderSpec[];
	variants: VariantPlan[];
}

const textureFile = (id: string) => join(ASSETS, splitId(id).path);
const isAlphaLayer = (name: string) => name.startsWith("alpha");
const isNonCoreAspect = (a: string) => a === "female" || a.startsWith("cosmetic_item") || a.startsWith("alpha");

/**
 * Menor conjunto de aspects que produz cada combinação (para q.has_aspect e para separar o recorte "core").
 * Testa [], cada lista de aspects das variações e uniões de 2 e 3 listas, com a mesma resolução do importador.
 */
export function aspectsByCombo(variations: Variation[]): Map<string, string[]> {
	const lists = [...new Map(variations.map((v) => [v.aspects.slice().sort().join("+"), v.aspects])).values()].filter((l) => l.length);
	const candidates: string[][] = [[]];
	for (const a of lists) candidates.push(a);
	for (let i = 0; i < lists.length; i++) for (let j = i + 1; j < lists.length; j++) candidates.push([...lists[i], ...lists[j]]);
	if (lists.length <= 40)
		for (let i = 0; i < lists.length; i++)
			for (let j = i + 1; j < lists.length; j++) for (let k = j + 1; k < lists.length; k++) candidates.push([...lists[i], ...lists[j], ...lists[k]]);
	const out = new Map<string, string[]>();
	for (const c of candidates) {
		const set = [...new Set(c)];
		const r = resolveCombo(variations, set);
		if (!r.poser || !r.model || !r.texture) continue;
		const key = comboKey(r);
		const prev = out.get(key);
		if (!prev || set.length < prev.length) out.set(key, set);
	}
	return out;
}

function unionAspects(variations: Variation[], c: VariantsEntry["combos"][number]): string[] {
	const out = new Set<string>();
	for (const v of variations) {
		const hit = (v.model && v.model === c.model) || (v.texture && v.texture === c.texture) || (v.layers ?? []).some((l) => c.layers.includes(`${l.name}=${l.texture}`));
		if (hit) for (const a of v.aspects) out.add(a);
	}
	return [...out];
}

type Combo = VariantsEntry["combos"][number];

/** Parecença entre combinações (modelo 4, textura 2, poser 1, camadas em comum 0,1 cada), como o resolveVariant. */
function similarity(a: Combo, b: Combo): number {
	const shared = a.layers.filter((l) => b.layers.includes(l)).length;
	return (a.model === b.model ? 4 : 0) + (a.texture === b.texture ? 2 : 0) + (a.poser === b.poser ? 1 : 0) + shared * 0.1;
}

/** Monta as specs de uma espécie (uma por imagem potencialmente distinta, até o limite por espécie). */
export function planSpecies(species: string, entry: VariantsEntry, inputs: PortraitInputs, posers: PortraitPoserIndex): SpeciesPlan {
	const byKey = aspectsByCombo(entry.variations);
	// Flags de camada: a última definição com o mesmo nome e textura.
	const layerDefs = new Map<string, VariantLayer>();
	for (const v of entry.variations) for (const l of v.layers ?? []) if (l.texture) layerDefs.set(`${l.name}=${l.texture}`, l);
	const specs = new Map<string, RenderSpec>();
	/** spec → índice do primeiro variant e quantidade de aspects (prioridade no limite). */
	const rank = new Map<RenderSpec, { first: number; aspects: number; core: boolean }>();
	const specOf: RenderSpec[] = [];
	const coreOf: boolean[] = [];
	entry.combos.forEach((c, index) => {
		const found = byKey.get(`${c.poser}|${c.model}|${c.texture}|${c.layers.join(",")}`);
		// Não achou (precisa de 4+ listas de aspects): une os aspects das variações que contribuem com algo
		// idêntico à combinação e trata como fora do recorte "core".
		const aspects = found ?? unionAspects(entry.variations, c);
		const core = !!found && !aspects.some(isNonCoreAspect);
		const poser = posers.get(c.poser);
		const usesAspects = JSON.stringify([poser.portrait, poser.profile]).includes("has_aspect");
		const layers = c.layers
			.map((k) => ({ key: k, name: k.slice(0, k.indexOf("=")), texture: k.slice(k.indexOf("=") + 1) }))
			.filter((l) => !isAlphaLayer(l.name))
			.map((l) => ({ file: textureFile(l.texture), blend: !!layerDefs.get(l.key)?.translucent, emissive: !!layerDefs.get(l.key)?.emissive }))
			// PosableModel.setLayerContext: layers.sortedBy { translucent } (estável).
			.sort((a, b) => Number(a.blend) - Number(b.blend));
		const modelFile = inputs.models.get(c.model)?.file ?? "";
		const specKey = JSON.stringify([c.poser, modelFile, c.texture, layers, usesAspects ? aspects.slice().sort() : []]);
		let spec = specs.get(specKey);
		if (!spec) {
			const animFiles: Record<string, string> = {};
			for (const a of [...poser.portrait.anims, ...poser.profile.anims]) {
				const g = inputs.anims.groups.get(a.group);
				if (g) animFiles[`${a.group}|${a.name}`] = g.file;
			}
			spec = {
				id: `${species}#${specs.size}`,
				model: modelFile,
				layers: [{ file: textureFile(c.texture), blend: false, emissive: false }, ...layers],
				aspects,
				poser,
				animFiles,
				modes: [],
			};
			specs.set(specKey, spec);
			rank.set(spec, { first: index, aspects: aspects.length, core });
		} else if (core) rank.get(spec)!.core = true;
		specOf.push(spec);
		coreOf.push(core);
	});
	// Limite por espécie (Spinda/Gholdengo enumeram centenas de padrões): ficam as specs com menos aspects
	// (base, shiny, formas, uma camada...) e as demais variantes usam a mais parecida que ficou.
	const byPriority = [...rank].sort((a, b) => a[1].aspects - b[1].aspects || a[1].first - b[1].first).map(([s]) => s);
	const portraitKept = new Set(byPriority.slice(0, PORTRAIT_CONFIG.portrait.maxPerSpecies));
	const profilePool = byPriority.filter((s) => PORTRAIT_CONFIG.profile.set === "all" || rank.get(s)!.core);
	const profileKept = new Set((profilePool.length ? profilePool : byPriority).slice(0, PORTRAIT_CONFIG.profile.maxPerSpecies));
	for (const s of portraitKept) s.modes.push({ mode: "portrait", sizes: PORTRAIT_CONFIG.portrait.sizes, ss: PORTRAIT_CONFIG.portrait.ss });
	for (const s of profileKept) s.modes.push({ mode: "profile", sizes: PORTRAIT_CONFIG.profile.sizes, ss: PORTRAIT_CONFIG.profile.ss });
	const nearest = (i: number, kept: Set<RenderSpec>): RenderSpec => {
		if (kept.has(specOf[i])) return specOf[i];
		let best = specOf[0];
		let bestScore = -1;
		entry.combos.forEach((c, j) => {
			if (!kept.has(specOf[j])) return;
			const score = similarity(c, entry.combos[i]);
			if (score > bestScore) [best, bestScore] = [specOf[j], score];
		});
		return best;
	};
	const variants: VariantPlan[] = entry.combos.map((_, i) => ({ specId: nearest(i, portraitKept).id, core: coreOf[i], profileSpecId: nearest(i, profileKept).id }));
	return { species, specs: [...specs.values()].filter((s) => s.modes.length), variants };
}

/** Roda as specs em workers (um lote por espécie, fila dinâmica). */
async function runWorkers(plans: SpeciesPlan[], workers: number, cacheDir: string | undefined): Promise<Map<string, RenderOutput>> {
	const results = new Map<string, RenderOutput>();
	const collect = (outs: RenderOutput[]) => {
		for (const o of outs) {
			for (const k of Object.keys(o.png)) o.png[k] = Buffer.from(o.png[k].buffer, o.png[k].byteOffset, o.png[k].byteLength);
			results.set(o.id, o);
		}
	};
	if (workers <= 0) {
		for (const p of plans) collect(renderSpecs(p.specs, cacheDir));
		return results;
	}
	// Todos os lotes são distribuídos de uma vez (maior primeiro, para o worker menos carregado): o processo
	// principal segue com o resto do import e os workers não dependem dele para pegar o próximo lote.
	const n = Math.min(workers, plans.length);
	const load = new Array<number>(n).fill(0);
	const assigned: number[][] = Array.from({ length: n }, () => []);
	for (const i of plans.map((_, i) => i).sort((a, b) => plans[b].specs.length - plans[a].specs.length)) {
		const w = load.indexOf(Math.min(...load));
		assigned[w].push(i);
		load[w] += plans[i].specs.length + 1;
	}
	await Promise.all(
		assigned.map(
			(batches) =>
				new Promise<void>((resolve, reject) => {
					const w = new Worker(new URL("./portraits/worker.ts", import.meta.url), { workerData: { cacheDir } });
					let pending = batches.length;
					w.on("message", (msg: { outputs: RenderOutput[] }) => {
						collect(msg.outputs);
						if (--pending === 0) w.postMessage(null);
					});
					w.on("error", reject);
					w.on("exit", (code) => (pending === 0 ? resolve() : reject(new Error(`worker de retratos saiu com código ${code}`))));
					for (const i of batches) w.postMessage({ batch: i, specs: plans[i].specs });
					if (!batches.length) w.postMessage(null);
				}),
		),
	);
	return results;
}

const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * variant → n em forma compacta: "" = todos 0; senão um caractere base-62 por variant, ou "~" + dois caracteres
 * por variant quando algum n passa de 61.
 */
export function encodeIndex(ns: number[]): string {
	if (ns.every((n) => n === 0)) return "";
	if (ns.every((n) => n < 62)) return ns.map((n) => B62[n]).join("");
	return "~" + ns.map((n) => B62[Math.floor(n / 62)] + B62[n % 62]).join("");
}

export interface PortraitStats {
	species: number;
	combos: number;
	specs: number;
	rendered: number;
	cached: number;
	files: Record<string, number>;
	bytes: Record<string, number>;
	failures: number;
	lowCoverage: number;
	ms: number;
}

export async function emitPortraits(inputs: PortraitInputs): Promise<PortraitStats> {
	const started = Date.now();
	const posers = new PortraitPoserIndex();
	const plans = [...inputs.variants].map(([sp, entry]) => planSpecies(sp, entry, inputs, posers));
	const workers = inputs.workers ?? Math.min(8, Math.max(1, availableParallelism() - 1));
	const results = await runWorkers(plans, workers, inputs.noCache ? undefined : CACHE_DIR);

	const stats: PortraitStats = { species: plans.length, combos: 0, specs: 0, rendered: 0, cached: 0, files: {}, bytes: {}, failures: 0, lowCoverage: 0, ms: 0 };
	const write = (kind: keyof typeof PORTRAIT_DIRS, name: string, png: Buffer) => {
		const file = `${OUT_RP}/${PORTRAIT_DIRS[kind]}/${name}.png`;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, png);
		stats.files[kind] = (stats.files[kind] ?? 0) + 1;
		stats.bytes[kind] = (stats.bytes[kind] ?? 0) + png.length;
	};
	const table: Record<string, [string, string]> = {};
	const [pBig, pSmall] = PORTRAIT_CONFIG.portrait.sizes;
	const fBig = PORTRAIT_CONFIG.profile.sizes[0];
	for (const plan of plans) {
		stats.combos += plan.variants.length;
		stats.specs += plan.specs.length;
		for (const s of plan.specs) {
			const r = results.get(s.id);
			if (!r || r.error) {
				stats.failures++;
				warn("retrato não renderizado", `${plan.species}: ${r?.error ?? "sem resultado"}`);
				continue;
			}
			stats.rendered += r.rendered;
			stats.cached += r.cached;
			if ((r.coverage.portrait ?? 1) < 0.15) {
				stats.lowCoverage++;
				warn("retrato com pouca cobertura (<15%)", `${plan.species} ${s.id}: ${(r.coverage.portrait * 100).toFixed(1)}%`);
			}
		}
		const assign = (mode: PortraitMode, size: number, pick: (v: VariantPlan) => string, emit: (n: number, out: RenderOutput) => void): number[] => {
			const nByHash = new Map<string, number>();
			const ns: number[] = [];
			let fallback = -1;
			for (const v of plan.variants) {
				const out = results.get(pick(v));
				const png = out?.png[`${mode}/${size}`];
				if (!out || !png) {
					ns.push(fallback);
					continue;
				}
				const h = createHash("sha1").update(png).digest("hex");
				let n = nByHash.get(h);
				if (n === undefined) {
					n = nByHash.size;
					nByHash.set(h, n);
					emit(n, out);
				}
				if (fallback < 0) fallback = n;
				ns.push(n);
			}
			// Variantes sem imagem (falha) usam a primeira que existir.
			return ns.map((n) => (n < 0 ? Math.max(0, fallback) : n));
		};
		const pn = assign("portrait", pBig, (v) => v.specId, (n, out) => {
			write("portrait", `${plan.species}_${n}`, out.png[`portrait/${pBig}`] as Buffer);
			if (pSmall) write("icon", `${plan.species}_${n}`, out.png[`portrait/${pSmall}`] as Buffer);
		});
		const fn = assign("profile", fBig, (v) => v.profileSpecId, (n, out) => write("profile", `${plan.species}_${n}`, out.png[`profile/${fBig}`] as Buffer));
		table[plan.species] = [encodeIndex(pn), encodeIndex(fn)];
	}
	emitPortraitsModule(table);
	emitCredits();
	stats.ms = Date.now() - started;
	for (const [k, v] of Object.entries(stats.files)) count(`retratos: arquivos ${k}`, v);
	for (const [k, v] of Object.entries(stats.bytes)) count(`retratos: KB ${k}`, Math.round(v / 1024));
	count("retratos: renderizados", stats.rendered);
	count("retratos: do cache", stats.cached);
	(report as unknown as Record<string, unknown>).portraits = stats;
	return stats;
}

/** generated/scripts/portraits.ts: tabela compacta variant → n e as funções de caminho. */
function emitPortraitsModule(table: Record<string, [string, string]>): void {
	const rows = Object.entries(table).map(([k, [p, f]]) => `\t${JSON.stringify(k)}: ${p || f ? JSON.stringify([p, f]) : 0},`);
	writeText(
		`${OUT_SCRIPTS}/portraits.ts`,
		`// Arquivo gerado por tools/importer/portraits.ts (npm run import). Não edite à mão.
/* eslint-disable */

/**
 * espécie → [retrato, perfil]: variant → índice da imagem distinta (0 = todos os variants usam a imagem 0).
 * Um caractere base-62 por variant, ou "~" + dois caracteres por variant.
 */
export const PORTRAIT_INDEX: Record<string, 0 | [string, string]> = {
${rows.join("\n")}
};
const INDEX = PORTRAIT_INDEX;

const B62 = ${JSON.stringify(B62)};

function imageIndex(species: string, variant: number, profile: 0 | 1): number {
	const entry = INDEX[species];
	if (!entry || !entry[profile]) return 0;
	const e = entry[profile];
	const wide = e[0] === "~";
	const len = wide ? (e.length - 1) / 2 : e.length;
	const i = variant >= 0 && variant < len ? Math.floor(variant) : 0;
	const n = wide ? B62.indexOf(e[1 + i * 2]) * 62 + B62.indexOf(e[2 + i * 2]) : B62.indexOf(e[i]);
	return n > 0 ? n : 0;
}

/** True se a espécie (id sem namespace, ex.: "mrmime") tem retratos gerados. */
export function hasPortrait(species: string): boolean {
	return INDEX[species] !== undefined;
}

/** Rosto 64 px (enquadramento de retrato do Cobblemon) para \`PokemonData.variant\`. */
export function portraitTexture(species: string, variant = 0): string {
	return \`${PORTRAIT_DIRS.portrait}/\${species}_\${imageIndex(species, variant, 0)}\`;
}

/** O mesmo rosto em 32 px (ícones pequenos). */
export function portraitIconTexture(species: string, variant = 0): string {
	return \`${PORTRAIT_DIRS.icon}/\${species}_\${imageIndex(species, variant, 0)}\`;
}

/** Corpo inteiro 128 px (enquadramento do Summary do Cobblemon). */
export function profileTexture(species: string, variant = 0): string {
	return \`${PORTRAIT_DIRS.profile}/\${species}_\${imageIndex(species, variant, 1)}\`;
}

/**
 * Frente msd-beta: acrescenta ou troca entradas do índice (pacote de extensão com espécies/variantes próprias, cujas
 * imagens vêm no resource pack dela). Devolve quantas entradas mudaram.
 */
export function addPortraitIndex(entries: Record<string, 0 | [string, string]>): number {
	let changed = 0;
	for (const [species, entry] of Object.entries(entries)) {
		if (JSON.stringify(INDEX[species]) === JSON.stringify(entry)) continue;
		INDEX[species] = entry;
		changed++;
	}
	return changed;
}
`,
	);
}

/** Atribuição CC BY-NC dos assets do Cobblemon (modelos, texturas e os retratos derivados deles). */
function emitCredits(): void {
	writeText(
		`${OUT_RP}/credits.txt`,
		`Cobblemon Bedrock (port não oficial) — créditos dos assets

Modelos, texturas, animações e sons dos Pokémon: Cobblemon Contributors (https://cobblemon.com,
https://gitlab.com/cable-mc/cobblemon), licenciados sob Creative Commons Atribuição-NãoComercial 3.0
(CC BY-NC 3.0, https://creativecommons.org/licenses/by-nc/3.0/).

Modificações: as geometrias e texturas foram convertidas para o formato do Minecraft Bedrock, e os retratos em
textures/cobblemon/portraits, portrait_icons e profiles são imagens renderizadas a partir desses modelos e
texturas (obra derivada). Este pack não é afiliado ao Cobblemon, à Mojang nem a The Pokémon Company.
Uso não comercial.

Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc.
`,
	);
}

/**
 * Ponto de entrada do index.ts: dispara os workers (que rodam em paralelo com o resto do import) e nunca
 * rejeita — falha vira aviso no import-report, sem derrubar o import.
 */
export function startPortraits(inputs: PortraitInputs): Promise<void> {
	return emitPortraits(inputs).then(
		(s) => console.log(`  retratos: ${s.rendered} renderizados, ${s.cached} do cache, ${Object.values(s.files).reduce((a, b) => a + b, 0)} PNGs em ${s.ms}ms`),
		(e) => {
			warn("retratos falharam", String((e as Error)?.stack ?? e));
			console.error("retratos falharam:", e);
		},
	);
}
