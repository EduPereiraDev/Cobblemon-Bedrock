// Frente ui-polish: texturas dos setores do gráfico de atributos do resumo (StatWidget.drawStatPolygon do Java).
//
// O JSON UI não desenha polígonos. O gráfico é a soma de um triângulo por lado (centro → vértice k → vértice k+1, como
// o Java desenha), e cada triângulo depende só das razões dos seus dois vértices. Com as razões em RADAR_STEPS passos,
// cada setor k tem RADAR_STEPS² texturas `summary/radar/<h|p><k>_<a>_<b>` (h = hexágono dos atributos, p = pentágono
// da montaria), brancas com 60% de opacidade (a cor do modo vem do `color` do layout). O script manda a textura de cada
// setor no ícone da célula (layoutSpec.radarTextures) e o layout desenha na caixa do setor (radarSectorBox).
//
//   node --experimental-strip-types tools/ui/radar.ts [pasta do RP]   (padrão: generated/resource_packs/CobblemonBedrock)
// O importador chama `emitRadarTextures` (tools/importer/guiTextures.ts), então `npm run import` também gera.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../importer/png.ts";
import { RADAR_HEXAGON, RADAR_PENTAGON, RADAR_STEPS, STAT_FILL_PX, radarSectorBox, radarVertex } from "../../scripts/GUI/layoutSpec.ts";
import type { RadarShape } from "../../scripts/GUI/layoutSpec.ts";

/** Pixels da textura por px da GUI (o setor tem até ~42×48 px da GUI). */
export const RADAR_TEXEL = 2;
/** Opacidade do Java (drawTriangle, opacity 0.6). */
const ALPHA = 0.6;
/** Amostras por pixel em cada eixo (borda suave). */
const SUPER = 4;

/** Triângulo (centro, a/RADAR_STEPS de V_k, b/RADAR_STEPS de V_k+1) rasterizado na caixa do setor. */
export function sectorPng(shape: RadarShape, k: number, a: number, b: number): { width: number; height: number; rgba: Buffer } {
	const [bx, by, bw, bh] = radarSectorBox(shape, k);
	const width = bw * RADAR_TEXEL;
	const height = bh * RADAR_TEXEL;
	const rgba = Buffer.alloc(width * height * 4);
	const c = [shape.centerX, shape.centerY];
	const lerp = (v: [number, number], t: number) => [c[0] + (v[0] - c[0]) * t, c[1] + (v[1] - c[1]) * t];
	const p1 = lerp(radarVertex(shape, k), a / RADAR_STEPS);
	const p2 = lerp(radarVertex(shape, k + 1), b / RADAR_STEPS);
	const edge = (p: number[], q: number[], x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
	const area = edge(c, p1, p2[0], p2[1]);
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			let hits = 0;
			for (let sy = 0; sy < SUPER; sy++) {
				for (let sx = 0; sx < SUPER; sx++) {
					const x = bx + (px + (sx + 0.5) / SUPER) / RADAR_TEXEL;
					const y = by + (py + (sy + 0.5) / SUPER) / RADAR_TEXEL;
					const w0 = edge(p1, p2, x, y) * Math.sign(area);
					const w1 = edge(p2, c, x, y) * Math.sign(area);
					const w2 = edge(c, p1, x, y) * Math.sign(area);
					if (w0 >= 0 && w1 >= 0 && w2 >= 0) hits++;
				}
			}
			if (!hits) continue;
			const i = (py * width + px) * 4;
			rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
			rgba[i + 3] = Math.round(255 * ALPHA * hits / (SUPER * SUPER));
		}
	}
	return { width, height, rgba };
}

/** Escreve todas as texturas em `<rp>/textures/gui/cobblemon/summary/radar/`. Devolve quantas. */
export function emitRadarTextures(rp: string): number {
	let n = 0;
	const dir = join(rp, "textures", "gui", "cobblemon", "summary", "radar");
	mkdirSync(dir, { recursive: true });
	for (const shape of [RADAR_HEXAGON, RADAR_PENTAGON]) {
		for (let k = 0; k < shape.sides; k++) {
			for (let a = 1; a <= RADAR_STEPS; a++) {
				for (let b = 1; b <= RADAR_STEPS; b++) {
					const file = join(dir, `${shape.key}${k}_${a}_${b}.png`);
					mkdirSync(dirname(file), { recursive: true });
					writeFileSync(file, encodePng(sectorPng(shape, k, a, b) as never));
					n++;
				}
			}
		}
	}
	// Barras do modo OTHER: 110×1 com os primeiros `px` brancos (o layout estica para 110×10 e pinta).
	for (let px = 0; px <= STAT_FILL_PX; px++) {
		const rgba = Buffer.alloc(STAT_FILL_PX * 4);
		for (let x = 0; x < px; x++) rgba.fill(255, x * 4, x * 4 + 4);
		writeFileSync(join(dir, `fill_${px}.png`), encodePng({ width: STAT_FILL_PX, height: 1, rgba } as never));
		n++;
	}
	return n;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const rp = process.argv[2] ?? join(root, "generated", "resource_packs", "CobblemonBedrock");
	console.log(`radar: ${emitRadarTextures(rp)} texturas em ${rp}`);
}
