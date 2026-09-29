// Frente otimizacao (#2): PNG sem perda. Recompressão com oxipng (@napi-rs/image, devDependency) + remoção só de
// metadados (texto, EXIF, data, pHYs). Nada de cinza. Regras (cada PNG, senão fica o original):
//   1. o RGBA decodificado (16 bits por canal, com tRNS/paleta) é IDÊNTICO ao do original, pixel a pixel;
//   2. o formato de saída (tipo de cor, profundidade, tRNS, entrelaçamento) é um dos que o pack JÁ usava
//      (ALLOWED_FORMATS, medido no pack v1.0.6): o decodificador do Bedrock já lê todos eles;
//   3. o arquivo fica menor.
// Cache por conteúdo (sha256 do original) em node_modules/.cache: o 1º build é lento, os seguintes só copiam.
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { createRequire } from "node:module";
import { sha256 } from "./common.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chunks só de metadados (não mudam a imagem decodificada). sRGB/gAMA/iCCP/cHRM/sBIT/bKGD ficam. */
export const METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "pHYs"]);

/** Formatos que o pack já usava (tipo de cor/profundidade/tRNS/entrelaçamento), contados no pack público v1.0.6. */
export const ALLOWED_FORMATS = new Set([
	"ct6/bd8/-/il0", // RGBA 8 bits (15.504)
	"ct3/bd8/trns/il0", // paleta 8 bits com alfa (1.780)
	"ct2/bd8/-/il0", // RGB 8 bits (121)
	"ct3/bd4/-/il0", // paleta 4 bits (75)
	"ct3/bd4/trns/il0", // (9)
	"ct3/bd8/-/il0", // (7)
	"ct3/bd2/trns/il0", // (6)
	"ct3/bd1/trns/il0", // (1)
]);

/** Versão da regra (entra na chave do cache: mudou a regra, refaz tudo). */
export const PNG_RULES_VERSION = `v2|${[...METADATA_CHUNKS].join(",")}|${[...ALLOWED_FORMATS].sort().join(",")}`;

export function parseChunks(buf) {
	if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("não é PNG");
	const chunks = [];
	let o = 8;
	while (o + 12 <= buf.length) {
		const len = buf.readUInt32BE(o);
		const type = buf.toString("latin1", o + 4, o + 8);
		if (o + 12 + len > buf.length) throw new Error(`chunk ${type} truncado`);
		chunks.push({ type, data: buf.subarray(o + 8, o + 8 + len), raw: buf.subarray(o, o + 12 + len) });
		o += 12 + len;
		if (type === "IEND") break;
	}
	return chunks;
}

/** Formato "ctX/bdY/trns|-/ilZ" de um PNG. */
export function pngFormat(buf) {
	const chunks = parseChunks(buf);
	const ihdr = chunks.find((c) => c.type === "IHDR").data;
	const trns = chunks.some((c) => c.type === "tRNS");
	return `ct${ihdr[9]}/bd${ihdr[8]}/${trns ? "trns" : "-"}/il${ihdr[12]}`;
}

/** Mesmo PNG sem os chunks de metadados (os outros chunks são copiados byte a byte, com o CRC original). */
export function stripMetadata(buf) {
	const chunks = parseChunks(buf);
	if (!chunks.some((c) => METADATA_CHUNKS.has(c.type))) return buf;
	return Buffer.concat([SIGNATURE, ...chunks.filter((c) => !METADATA_CHUNKS.has(c.type)).map((c) => c.raw)]);
}

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Desfaz os filtros de `rows` linhas de `rowBytes` bytes (cada uma com o byte de filtro na frente). */
function unfilter(data, offset, rows, rowBytes, bpp) {
	const out = Buffer.alloc(rows * rowBytes);
	let prev = Buffer.alloc(rowBytes);
	let o = offset;
	for (let y = 0; y < rows; y++) {
		const type = data[o++];
		const cur = out.subarray(y * rowBytes, (y + 1) * rowBytes);
		for (let x = 0; x < rowBytes; x++) {
			const raw = data[o + x];
			const a = x >= bpp ? cur[x - bpp] : 0;
			const b = prev[x];
			const c = x >= bpp ? prev[x - bpp] : 0;
			let v;
			switch (type) {
				case 0: v = raw; break;
				case 1: v = raw + a; break;
				case 2: v = raw + b; break;
				case 3: v = raw + ((a + b) >> 1); break;
				case 4: v = raw + paeth(a, b, c); break;
				default: throw new Error(`filtro PNG inválido: ${type}`);
			}
			cur[x] = v & 255;
		}
		o += rowBytes;
		prev = cur;
	}
	return { out, next: o };
}

const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/**
 * Decodificador PNG completo (todos os tipos de cor, 1/2/4/8/16 bits, paleta, tRNS, Adam7) → RGBA com 16 bits por
 * canal (valor de 8 bits × 257; n bits escalado exato para 0..65535). É a régua da prova: independe do oxipng.
 */
export function decodeRgba16(buf) {
	const chunks = parseChunks(buf);
	const ihdr = chunks.find((c) => c.type === "IHDR")?.data;
	if (!ihdr) throw new Error("PNG sem IHDR");
	const width = ihdr.readUInt32BE(0);
	const height = ihdr.readUInt32BE(4);
	const bitDepth = ihdr[8];
	const colorType = ihdr[9];
	const interlace = ihdr[12];
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
	if (!channels) throw new Error(`tipo de cor inválido: ${colorType}`);
	const plte = chunks.find((c) => c.type === "PLTE")?.data;
	const trns = chunks.find((c) => c.type === "tRNS")?.data;
	const data = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
	const bitsPerPixel = channels * bitDepth;
	const bpp = Math.max(1, bitsPerPixel >> 3);
	const maxv = (1 << bitDepth) - 1;
	const scale = (v) => (bitDepth === 16 ? v : bitDepth === 8 ? v * 257 : (v * 65535) / maxv);
	const out = new Uint16Array(width * height * 4);
	const sample = (row, i) => {
		if (bitDepth === 8) return row[i];
		if (bitDepth === 16) return (row[i * 2] << 8) | row[i * 2 + 1];
		const perByte = 8 / bitDepth;
		const byte = row[Math.floor(i / perByte)];
		const shift = 8 - bitDepth * ((i % perByte) + 1);
		return (byte >> shift) & maxv;
	};
	const trnsGray = trns && colorType === 0 ? trns.readUInt16BE(0) : undefined;
	const trnsRgb = trns && colorType === 2 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : undefined;
	const put = (row, x, px, py) => {
		const o = (py * width + px) * 4;
		const s = (k) => sample(row, x * channels + k);
		switch (colorType) {
			case 0: {
				const g = s(0);
				out[o] = out[o + 1] = out[o + 2] = scale(g);
				out[o + 3] = trnsGray !== undefined && g === trnsGray ? 0 : 65535;
				break;
			}
			case 2: {
				const r = s(0), g = s(1), b = s(2);
				out[o] = scale(r); out[o + 1] = scale(g); out[o + 2] = scale(b);
				out[o + 3] = trnsRgb && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2] ? 0 : 65535;
				break;
			}
			case 3: {
				const idx = s(0);
				if (!plte || idx * 3 + 2 >= plte.length) throw new Error(`índice de paleta fora: ${idx}`);
				out[o] = plte[idx * 3] * 257; out[o + 1] = plte[idx * 3 + 1] * 257; out[o + 2] = plte[idx * 3 + 2] * 257;
				out[o + 3] = trns && idx < trns.length ? trns[idx] * 257 : 65535;
				break;
			}
			case 4:
				out[o] = out[o + 1] = out[o + 2] = scale(s(0));
				out[o + 3] = scale(s(1));
				break;
			case 6:
				out[o] = scale(s(0)); out[o + 1] = scale(s(1)); out[o + 2] = scale(s(2)); out[o + 3] = scale(s(3));
				break;
		}
	};
	if (interlace === 0) {
		const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
		const { out: pixels } = unfilter(data, 0, height, rowBytes, bpp);
		for (let y = 0; y < height; y++) {
			const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
			for (let x = 0; x < width; x++) put(row, x, x, y);
		}
	} else if (interlace === 1) {
		let offset = 0;
		for (const [xs, ys, dx, dy] of ADAM7) {
			const pw = Math.ceil((width - xs) / dx);
			const ph = Math.ceil((height - ys) / dy);
			if (pw <= 0 || ph <= 0) continue;
			const rowBytes = Math.ceil((pw * bitsPerPixel) / 8);
			const { out: pixels, next } = unfilter(data, offset, ph, rowBytes, bpp);
			offset = next;
			for (let y = 0; y < ph; y++) {
				const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
				for (let x = 0; x < pw; x++) put(row, x, xs + x * dx, ys + y * dy);
			}
		}
	} else throw new Error(`entrelaçamento inválido: ${interlace}`);
	return { width, height, rgba: out };
}

/** Os dois PNGs decodificam para o mesmo RGBA (16 bits por canal)? */
export function samePixels(a, b) {
	const da = decodeRgba16(a);
	const db = decodeRgba16(b);
	if (da.width !== db.width || da.height !== db.height) return false;
	const x = da.rgba, y = db.rgba;
	if (x.length !== y.length) return false;
	for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
	return true;
}

let napi;
function oxipng() {
	napi ??= createRequire(import.meta.url)("@napi-rs/image");
	return napi;
}

/** Tentativas do oxipng, da mais agressiva à mais conservadora (sempre sem cinza e sem strip do oxipng). */
const ATTEMPTS = [
	{ grayscaleReduction: false, strip: false },
	{ grayscaleReduction: false, strip: false, bitDepthReduction: false },
	{ grayscaleReduction: false, strip: false, bitDepthReduction: false, colorTypeReduction: false, paletteReduction: false },
];

/**
 * PNG otimizado (ou o original, se nada passar nas regras). As tentativas vão da mais agressiva à mais conservadora e
 * param na primeira que passa (menor que o original, formato do pack, pixels idênticos); por último, só sem os
 * metadados. Devolve { out, reason }: reason diz por que ficou o original ("sem ganho", "formato fora do pack"...).
 */
export async function optimizePng(original) {
	const stripped = stripMetadata(original);
	let reason = "sem ganho";
	const accept = (c) => {
		if (c.length >= original.length) return false;
		const format = pngFormat(c);
		if (!ALLOWED_FORMATS.has(format)) { reason = `formato fora do pack (${format})`; return false; }
		if (!samePixels(original, c)) { reason = "pixels diferentes"; return false; }
		return true;
	};
	for (const options of ATTEMPTS) {
		let out;
		try { out = Buffer.from(await oxipng().losslessCompressPng(stripped, options)); } catch { continue; }
		// Sem `force`, o oxipng devolve a entrada quando não melhora: a saída nunca é maior que `stripped`.
		if (accept(out)) return { out, reason: "otimizado" };
	}
	if (accept(stripped)) return { out: stripped, reason: "otimizado" };
	return { out: original, reason };
}

/** Pool com limite de concorrência. */
export async function mapLimit(items, limit, fn) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Otimiza os PNG `files` (caminhos absolutos) no lugar, com cache em `cacheDir`. Concorrência: metade dos núcleos
 * (o oxipng roda no pool de threads do libuv; nunca mais processos). Devolve estatísticas.
 */
export async function optimizePngFiles(files, cacheDir, { verifyAll = false, log = () => {} } = {}) {
	const dir = join(cacheDir, sha256(PNG_RULES_VERSION).slice(0, 12));
	mkdirSync(dir, { recursive: true });
	// Até metade dos núcleos em voo; o oxipng roda no pool de threads do libuv (4 por padrão), então o teto real é 4.
	const limit = Math.max(1, Math.floor(availableParallelism() / 2));
	const stats = { files: files.length, optimized: 0, kept: 0, cacheHits: 0, bytesBefore: 0, bytesAfter: 0, reasons: {} };
	let done = 0;
	await mapLimit(files, limit, async (file) => {
		const original = readFileSync(file);
		stats.bytesBefore += original.length;
		const key = sha256(original);
		const hit = join(dir, `${key}.png`);
		const keep = join(dir, `${key}.keep`);
		let out;
		if (existsSync(hit)) {
			out = readFileSync(hit);
			stats.cacheHits++;
			// A entrada do cache foi conferida quando foi criada; `verifyAll` confere de novo (prova completa).
			if (verifyAll && (!samePixels(original, out) || !ALLOWED_FORMATS.has(pngFormat(out)))) throw new Error(`cache de PNG inválido para ${file}`);
		} else if (existsSync(keep)) {
			out = original;
			stats.cacheHits++;
		} else {
			const r = await optimizePng(original);
			out = r.out;
			stats.reasons[r.reason] = (stats.reasons[r.reason] ?? 0) + 1;
			const target = out === original ? keep : hit;
			const tmp = `${target}.${process.pid}.tmp`;
			writeFileSync(tmp, out === original ? "" : out);
			renameSync(tmp, target);
		}
		if (out !== original && out.length < original.length) {
			writeFileSync(file, out);
			stats.optimized++;
		} else stats.kept++;
		stats.bytesAfter += out.length < original.length ? out.length : original.length;
		if (++done % 2000 === 0) log(`  PNG: ${done}/${files.length}`);
	});
	return stats;
}
