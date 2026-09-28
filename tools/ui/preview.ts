// Frente ui-layout: prévia visual das telas roteadas sem cliente. Monta cada tela com os dados reais
// (tools/ui/previewFixtures.ts), interpreta o JSON UI gerado (tools/ui/layoutScene.mjs) e desenha em PNG com as
// texturas do pack (resource_packs/ e generated/) e a fonte 5×7 abaixo (avanços da fonte do Minecraft).
//
// Rodar: node tools/ui/preview.mjs [--outline] [--no-battle] [nome...]  → docs/ui-preview/<tela>.png
// Os PNGs não são versionados (docs/ui-preview/.gitignore): regenere quando mudar o layout.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodePng } from "../importer/png.ts";
import type { Png } from "../importer/png.ts";
import { GLYPH_CELL, LINE_HEIGHT, buildScene, checkButtonStates, checkScene, indexUi, isPageGlyph, parseUiFile } from "./layoutScene.mjs";
import { buildFixtures, loadLang } from "./previewFixtures";
import { SCREEN_RULES } from "./layoutRules.mjs";

const ROOT = process.env.UI_PREVIEW_ROOT ?? process.cwd();
const OUT = join(ROOT, "docs", "ui-preview");
const VIEWPORT: [number, number] = [480, 270];
const ZOOM = 3;
const TEXTURE_ROOTS = [
	join(ROOT, "resource_packs", "CobblemonBedrock"),
	join(ROOT, "generated", "resource_packs", "CobblemonBedrock"),
	join(ROOT, "generated", "resource_packs", "CobblemonMegaShowdown"),
];

/** Texturas da vanilla usadas pelas telas, trocadas por uma do port com o mesmo recorte (skin 64 px: rosto em 8,8). */
const VANILLA_STAND_INS: Record<string, string> = {
	"textures/entity/steve": "textures/npcs/default",
	"textures/entity/alex": "textures/npcs/default",
};

// Fonte 5×7 (colunas, bit 0 = linha de cima), ASCII 0x20..0x7E.
const FONT5x7 = (
	"0000000000 00005f0000 0007000700 147f147f14 242a7f2a12 2313086462 3649552250 0005030000 001c224100 0041221c00" +
	" 082a1c2a08 08083e0808 0050300000 0808080808 0060600000 2010080402 3e5149453e 00427f4000 4261514946 2141454b31" +
	" 1814127f10 2745454539 3c4a494930 0171090503 3649494936 064949291e 0036360000 0056360000 0008142241 1414141414" +
	" 4122140800 0201510906 324979413e 7e1111117e 7f49494936 3e41414122 7f4141221c 7f49494941 7f09090101 3e41415132" +
	" 7f0808087f 00417f4100 2040413f01 7f08142241 7f40404040 7f0204027f 7f0408107f 3e4141413e 7f09090906 3e4151215e" +
	" 7f09192946 4649494931 01017f0101 3f4040403f 1f2040201f 7f2018207f 6314081463 0304780403 6151494543 00007f4141" +
	" 0204081020 41417f0000 0402010204 4040404040 0001020400 2054545478 7f48444438 3844444420 384444487f 3854545418" +
	" 087e090102 081454543c 7f08040478 00447d4000 2040443d00 007f102844 00417f4000 7c04180478 7c08040478 3844444438" +
	" 7c14141408 081414187c 7c08040408 4854545420 043f444020 3c4040207c 1c2040201c 3c4030403c 4428102844 0c5050503c" +
	" 4464544c44 0008364100 00007f0000 0041360800 0201020402"
).split(" ").map(h => [0, 2, 4, 6, 8].map(i => parseInt(h.slice(i, i + 2), 16)));

function glyphColumns(ch: string): number[] {
	const base = ch.normalize("NFD")[0] ?? ch;
	const code = base.charCodeAt(0);
	if (code >= 0x20 && code <= 0x7e) return FONT5x7[code - 0x20];
	if (ch === "◀") return [0x08, 0x1c, 0x3e, 0x7f, 0x00];
	if (ch === "▶") return [0x7f, 0x3e, 0x1c, 0x08, 0x00];
	return [0x7f, 0x41, 0x41, 0x41, 0x7f];
}

class Canvas {
	readonly png: Png;
	constructor(readonly width: number, readonly height: number) {
		this.png = { width, height, rgba: Buffer.alloc(width * height * 4) };
	}
	blend(x: number, y: number, r: number, g: number, b: number, a: number, clip?: number[]) {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
		if (clip && (x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3])) return;
		const i = (y * this.width + x) * 4;
		const d = this.png.rgba;
		const inv = 1 - a;
		d[i] = Math.round(r * a + d[i] * inv);
		d[i + 1] = Math.round(g * a + d[i + 1] * inv);
		d[i + 2] = Math.round(b * a + d[i + 2] * inv);
		d[i + 3] = 255;
	}
	fill(x: number, y: number, w: number, h: number, rgb: number[], a = 1, clip?: number[]) {
		for (let yy = Math.floor(y); yy < Math.ceil(y + h); yy++) for (let xx = Math.floor(x); xx < Math.ceil(x + w); xx++) this.blend(xx, yy, rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, a, clip);
	}
	outline(x: number, y: number, w: number, h: number, rgb: number[]) {
		this.fill(x, y, w, 1, rgb); this.fill(x, y + h - 1, w, 1, rgb); this.fill(x, y, 1, h, rgb); this.fill(x + w - 1, y, 1, h, rgb);
	}
}

const textures = new Map<string, Png | null>();
function texture(path: string): Png | null {
	if (textures.has(path)) return textures.get(path)!;
	let png: Png | null = null;
	for (const root of TEXTURE_ROOTS) {
		const file = join(root, `${path}.png`);
		if (existsSync(file)) { png = decodePng(file) ?? null; break; }
	}
	textures.set(path, png);
	return png;
}

function drawImage(c: Canvas, tex: Png, rect: number[], uv: number[] | undefined, uvSize: number[] | undefined, alpha: number, color: number[] | undefined, clip?: number[]) {
	const [u0, v0] = uv ?? [0, 0];
	const [us, vs] = uvSize ?? [tex.width, tex.height];
	const [x, y, w, h] = rect.map(v => v * ZOOM);
	if (w <= 0 || h <= 0) return;
	for (let dy = Math.max(0, Math.floor(y)); dy < Math.min(c.height, Math.ceil(y + h)); dy++) {
		const sy = Math.floor(v0 + ((dy + 0.5 - y) / h) * vs);
		if (sy < 0 || sy >= tex.height) continue;
		for (let dx = Math.max(0, Math.floor(x)); dx < Math.min(c.width, Math.ceil(x + w)); dx++) {
			const sx = Math.floor(u0 + ((dx + 0.5 - x) / w) * us);
			if (sx < 0 || sx >= tex.width) continue;
			const i = (sy * tex.width + sx) * 4;
			const a = (tex.rgba[i + 3] / 255) * alpha;
			const [cr, cg, cb] = color ?? [1, 1, 1];
			c.blend(dx, dy, tex.rgba[i] * cr, tex.rgba[i + 1] * cg, tex.rgba[i + 2] * cb, a, clip);
		}
	}
}

function drawLabel(c: Canvas, node: any, clip?: number[]) {
	const s = node.scale;
	const [x, y, w] = node.rect;
	node.lines.forEach((line: any, li: number) => {
		const lw = line.width * s;
		let cx = node.align === "center" ? x + (w - lw) / 2 : node.align === "right" ? x + w - lw : x;
		const top = y + li * LINE_HEIGHT * s;
		const baseline = top + LINE_HEIGHT * s;
		for (const ch of line.chars) {
			if (isPageGlyph(ch.ch)) {
				const code = ch.ch.codePointAt(0)!;
				const page = texture(`font/glyph_${(code >> 8).toString(16).toUpperCase()}`);
				if (page) {
					const cell = page.width / 16;
					drawImage(c, page, [cx, baseline - GLYPH_CELL * s, GLYPH_CELL * s, GLYPH_CELL * s], [(code & 15) * cell, ((code >> 4) & 15) * cell], [cell, cell], 1, undefined, clip);
				}
				cx += GLYPH_CELL * s;
				continue;
			}
			const base = ch.ch.normalize("NFD")[0] ?? ch.ch;
			const adv = ({ " ": 4, "!": 2, "'": 3, ",": 2, ".": 2, ":": 2, ";": 2, "I": 4, "[": 4, "]": 4, "f": 5, "i": 2, "k": 5, "l": 3, "t": 4, "|": 2 } as Record<string, number>)[base] ?? 6;
			// Caracteres estreitos: só as colunas do meio que cabem no avanço (o "i" do Minecraft tem 1 px).
			let cols = glyphColumns(ch.ch);
			while (cols.length && cols[0] === 0) cols = cols.slice(1);
			while (cols.length && cols[cols.length - 1] === 0) cols = cols.slice(0, -1);
			if (cols.length > adv - 1) { const start = Math.floor((cols.length - (adv - 1)) / 2); cols = cols.slice(start, start + adv - 1); }
			const px = s * ZOOM;
			const passes = node.shadow ? [[s, s, 0.25], [0, 0, 1]] : [[0, 0, 1]];
			for (const [ox, oy, k] of passes) {
				for (let b = 0; b < (ch.bold ? 2 : 1); b++) {
					cols.forEach((bits: number, col: number) => {
						for (let row = 0; row < 8; row++) {
							if (!(bits >> row & 1)) continue;
							const gx = (cx + (col + b) * s + ox) * ZOOM;
							const gy = (top + (row + 1) * s + oy) * ZOOM;
							c.fill(gx, gy, Math.max(1, px), Math.max(1, px), ch.color.map((v: number) => v * k), 1, clip);
						}
					});
				}
			}
			cx += (adv + (ch.bold ? 1 : 0)) * s;
		}
	});
}

export function renderScene(scene: { nodes: any[] }, problems: string[], outline: boolean): Buffer {
	const c = new Canvas(VIEWPORT[0] * ZOOM, VIEWPORT[1] * ZOOM);
	c.fill(0, 0, c.width, c.height, [0.53, 0.69, 0.93]);
	for (const node of scene.nodes) {
		const clip = node.clip ? [node.clip[0] * ZOOM, node.clip[1] * ZOOM, (node.clip[0] + node.clip[2]) * ZOOM, (node.clip[1] + node.clip[3]) * ZOOM] : undefined;
		if (node.kind === "image") {
			// Frente ui-polish: textura da vanilla (fora dos packs do port) desenhada com um substituto do mesmo formato.
			const tex = texture(VANILLA_STAND_INS[node.texture] ?? node.texture);
			if (!tex) {
				c.fill(node.rect[0] * ZOOM, node.rect[1] * ZOOM, node.rect[2] * ZOOM, node.rect[3] * ZOOM, [1, 0, 1], 0.35, clip);
				problems.push(`textura ausente: ${node.texture} (${node.path})`);
				continue;
			}
			drawImage(c, tex, node.rect, node.uv, node.uvSize, node.alpha, node.color, clip);
		}
		else if (node.kind === "label") drawLabel(c, node, clip);
		else if (node.kind === "close") {
			const [x, y, w, h] = node.rect.map((v: number) => v * ZOOM);
			c.fill(x, y, w, h, [0.2, 0.2, 0.2], 0.9);
			for (let i = 2 * ZOOM; i < w - 2 * ZOOM; i++) { c.fill(x + i, y + i, ZOOM, ZOOM, [0.9, 0.9, 0.9]); c.fill(x + w - i - ZOOM, y + i, ZOOM, ZOOM, [0.9, 0.9, 0.9]); }
		}
		if (outline && node.kind === "label" && node.text.trim()) c.outline(node.rect[0] * ZOOM, node.rect[1] * ZOOM, node.rect[2] * ZOOM, node.rect[3] * ZOOM, [1, 1, 0]);
	}
	return encodePng(c.png);
}

function loadUi() {
	const dir = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");
	return indexUi(readdirSync(dir).filter(f => f.endsWith(".json") && f !== "_ui_defs.json").map(f => parseUiFile(readFileSync(join(dir, f), "utf8"))));
}

async function main() {
	const args = process.argv.slice(2);
	const outline = args.includes("--outline");
	// Frente ui-polish: `--state hover|pressed|locked` desenha TODOS os botões naquele estado (<tela>-<estado>.png) e
	// soma as regras de estado (checkButtonStates) aos problemas.
	const stateArg = args.indexOf("--state");
	const state = stateArg >= 0 ? args[stateArg + 1] : undefined;
	const only = args.filter((a, i) => !a.startsWith("--") && i !== stateArg + 1);
	const index = loadUi();
	const fixtures = await buildFixtures(ROOT, { battle: !args.includes("--no-battle") });
	const lang = loadLang(ROOT);
	mkdirSync(OUT, { recursive: true });
	let total = 0;
	for (const fx of fixtures) {
		if (only.length && !only.some(o => fx.name.includes(o))) continue;
		const rules = SCREEN_RULES[fx.name.replace(/-3d$/, "")] ?? {};
		const scene = buildScene(index, fx.root, { ...fx, lang }, VIEWPORT, { buttonState: state ?? "default" });
		const problems = [...scene.issues, ...checkScene(scene, rules), ...checkButtonStates(index, fx.root, { ...fx, lang }, VIEWPORT, rules)];
		writeFileSync(join(OUT, `${fx.name}${state ? `-${state}` : ""}.png`), renderScene(scene, problems, outline));
		writeFileSync(join(OUT, `${fx.name}.json`), JSON.stringify({ title: fx.title, body: fx.body, buttons: fx.buttons }, null, 1));
		total += problems.length;
		console.log(`${fx.name}: ${problems.length ? `${problems.length} problema(s)` : "ok"}`);
		for (const p of problems) console.log(`  - ${p}`);
	}
	console.log(`prévias em ${OUT} (${total} problema(s))`);
	process.exit(0);
}

await main();
