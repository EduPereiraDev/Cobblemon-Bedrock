// Texturas de GUI do Cobblemon + texturas derivadas do HUD + páginas de glifos (frente ui-base).
//
// 1. assets/cobblemon/textures/gui/** → RP textures/gui/cobblemon/** (mesma árvore; o pc/wallpaper continua no caminho
//    antigo textures/gui/pc/wallpaper, copiado por wallpapers.ts).
// 2. Texturas derivadas (arte própria, cores do Cobblemon): barras de HP/EXP por passo de 1 px (o JSON UI escolhe a
//    textura pelo nome, sem aritmética de ponto flutuante) e molduras de toast, em textures/ui/cobblemon/hud/.
// 3. font/glyph_E2.png e glyph_E3.png (ícones inline) a partir de scripts/ui/glyphs.ts, fora da página E0 da vanilla.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { ASSETS, OUT_RP, copyFile, count, walk, warn } from "./util.ts";
import { decodePng, encodePng } from "./png.ts";
import type { Png } from "./png.ts";
import { GLYPH_PAGE_BALLS, GLYPH_PAGE_ICONS, glyphSources } from "../../scripts/ui/glyphs.ts";
import { BATTLE_BAR_PX, PARTY_BAR_PX, depletableColor } from "../../scripts/ui/hudProtocol.ts";
import { emitRadarTextures } from "../ui/radar.ts"; // frente ui-polish

const GUI = `${ASSETS}/textures/gui`;
const HUD = `${OUT_RP}/textures/ui/cobblemon/hud`;

function writePng(file: string, png: Png) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, encodePng(png));
}

function blank(width: number, height: number): Png {
	return { width, height, rgba: Buffer.alloc(width * height * 4) };
}

function setPixel(png: Png, x: number, y: number, rgba: [number, number, number, number]) {
	const i = (y * png.width + x) * 4;
	png.rgba[i] = rgba[0];
	png.rgba[i + 1] = rgba[1];
	png.rgba[i + 2] = rgba[2];
	png.rgba[i + 3] = rgba[3];
}

const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** 1. Cópia da árvore de GUI. */
function copyGui(): number {
	let n = 0;
	for (const file of walk(GUI, name => name.endsWith(".png"))) {
		const rel = relative(GUI, file).split("\\").join("/");
		if (rel.startsWith("pc/wallpaper/")) continue;
		copyFile(file, `${OUT_RP}/textures/gui/cobblemon/${rel}`);
		n++;
	}
	return n;
}

/** 2. Barras por passo e molduras de toast. */
function derivedTextures(): number {
	let n = 0;
	const pad = (v: number) => String(v).padStart(2, "0");
	// Party: HP vertical 2×18 (cor pela fração), EXP vertical 1×18 (0.2, 0.65, 0.84), preenchidas de baixo para cima.
	for (let px = 0; px <= PARTY_BAR_PX; px++) {
		const hp = blank(2, PARTY_BAR_PX);
		const exp = blank(1, PARTY_BAR_PX);
		const [r, g, b] = depletableColor(px / PARTY_BAR_PX);
		for (let y = PARTY_BAR_PX - px; y < PARTY_BAR_PX; y++) {
			for (let x = 0; x < 2; x++) setPixel(hp, x, y, [to255(r), to255(g), to255(b), 255]);
			setPixel(exp, 0, y, [to255(0.2), to255(0.65), to255(0.84), 255]);
		}
		writePng(`${HUD}/hp_v_${pad(px)}.png`, hp);
		writePng(`${HUD}/exp_v_${pad(px)}.png`, exp);
		n += 2;
	}
	// Batalha: HP horizontal 97×4; "hp_h" cresce da esquerda (aliado), "hp_hr" da direita (oponente).
	for (let px = 0; px <= BATTLE_BAR_PX; px++) {
		const left = blank(BATTLE_BAR_PX, 4);
		const right = blank(BATTLE_BAR_PX, 4);
		const [r, g, b] = depletableColor(px / BATTLE_BAR_PX);
		const color: [number, number, number, number] = [to255(r), to255(g), to255(b), 255];
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < px; x++) {
				setPixel(left, x, y, color);
				setPixel(right, BATTLE_BAR_PX - 1 - x, y, color);
			}
		}
		writePng(`${HUD}/hp_h_${pad(px)}.png`, left);
		writePng(`${HUD}/hp_hr_${pad(px)}.png`, right);
		n += 2;
	}
	// Molduras de toast 160×32 (AdvancementToast): fundo escuro, borda clara e filete de cor por tipo.
	const frames: Record<string, [number, number, number]> = { task: [0.78, 0.66, 0.12], goal: [0.35, 0.78, 0.35], challenge: [0.66, 0.31, 0.82] };
	for (const [name, accent] of Object.entries(frames)) {
		const png = blank(160, 32);
		for (let y = 0; y < 32; y++) {
			for (let x = 0; x < 160; x++) {
				const edge = x === 0 || y === 0 || x === 159 || y === 31;
				const inner = x === 1 || y === 1 || x === 158 || y === 30;
				if ((x === 0 || x === 159) && (y === 0 || y === 31)) continue;
				if (edge) setPixel(png, x, y, [16, 16, 16, 255]);
				else if (inner) setPixel(png, x, y, [to255(accent[0]), to255(accent[1]), to255(accent[2]), 255]);
				else setPixel(png, x, y, [33, 33, 33, 235]);
			}
		}
		writePng(`${HUD}/toast_${name}.png`, png);
		n++;
	}
	return n;
}

/** Redimensiona para caber em `cell`: aumenta por fator inteiro (pixel art nítido) ou reduz por média de área. */
function fitInto(src: Png, cell: number): Png {
	const scale = Math.min(cell / src.width, cell / src.height);
	if (scale >= 1) {
		const k = Math.max(1, Math.floor(scale));
		const out = blank(src.width * k, src.height * k);
		for (let y = 0; y < out.height; y++)
			for (let x = 0; x < out.width; x++) {
				const i = (Math.floor(y / k) * src.width + Math.floor(x / k)) * 4;
				setPixel(out, x, y, [src.rgba[i], src.rgba[i + 1], src.rgba[i + 2], src.rgba[i + 3]]);
			}
		return out;
	}
	const w = Math.max(1, Math.round(src.width * scale));
	const h = Math.max(1, Math.round(src.height * scale));
	const out = blank(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const x0 = (x * src.width) / w, x1 = ((x + 1) * src.width) / w;
			const y0 = (y * src.height) / h, y1 = ((y + 1) * src.height) / h;
			let r = 0, g = 0, b = 0, a = 0, area = 0;
			for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
				for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
					const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
					const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
					const weight = Math.max(0, wx) * Math.max(0, wy);
					const i = (sy * src.width + sx) * 4;
					const alpha = src.rgba[i + 3] / 255;
					r += src.rgba[i] * alpha * weight;
					g += src.rgba[i + 1] * alpha * weight;
					b += src.rgba[i + 2] * alpha * weight;
					a += alpha * weight;
					area += weight;
				}
			}
			const alpha = area > 0 ? a / area : 0;
			setPixel(out, x, y, a > 0 ? [Math.round(r / a), Math.round(g / a), Math.round(b / a), to255(alpha)] : [0, 0, 0, 0]);
		}
	}
	return out;
}

function crop(src: Png, [cx, cy, cw, ch]: [number, number, number, number]): Png {
	const out = blank(cw, ch);
	for (let y = 0; y < ch; y++)
		for (let x = 0; x < cw; x++) {
			if (cx + x >= src.width || cy + y >= src.height) continue;
			const i = ((cy + y) * src.width + cx + x) * 4;
			setPixel(out, x, y, [src.rgba[i], src.rgba[i + 1], src.rgba[i + 2], src.rgba[i + 3]]);
		}
	return out;
}

/** 3. Páginas de glifos (512×512, células de 32 px), imagem centrada na célula. */
function glyphPages(): number {
	const CELL = 32;
	const pages = new Map<number, Png>();
	const cache = new Map<string, Png | undefined>();
	let n = 0;
	for (const source of glyphSources()) {
		if (!cache.has(source.file)) cache.set(source.file, decodePng(`${GUI}/${source.file}`));
		const src = cache.get(source.file);
		if (!src) {
			warn("textura de glifo não encontrada", source.file);
			continue;
		}
		const image = fitInto(source.crop ? crop(src, source.crop) : src, CELL);
		const page = source.code >> 8;
		let png = pages.get(page);
		if (!png) pages.set(page, png = blank(512, 512));
		const cell = source.code & 0xff;
		const ox = (cell & 0xf) * CELL + Math.floor((CELL - image.width) / 2);
		const oy = (cell >> 4) * CELL + Math.floor((CELL - image.height) / 2);
		for (let y = 0; y < image.height; y++)
			for (let x = 0; x < image.width; x++) {
				const i = (y * image.width + x) * 4;
				setPixel(png, ox + x, oy + y, [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2], image.rgba[i + 3]]);
			}
		n++;
	}
	for (const page of [GLYPH_PAGE_ICONS, GLYPH_PAGE_BALLS]) {
		const png = pages.get(page);
		if (png) writePng(`${OUT_RP}/font/glyph_${page.toString(16).toUpperCase()}.png`, png);
	}
	return n;
}

export function emitGuiTextures() {
	count("texturas de GUI do Cobblemon", copyGui());
	count("texturas derivadas do HUD", derivedTextures());
	count("setores do gráfico de atributos do resumo", emitRadarTextures(OUT_RP));
	count("glifos (E2/E3)", glyphPages());
}
