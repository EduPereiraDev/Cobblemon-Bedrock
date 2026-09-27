// Leitura/escrita mínima de PNG (sem dependências): tamanho, classificação da transparência e recorte
// do primeiro quadro de texturas animadas (tira vertical do .mcmeta do Java).
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

export interface Png {
	width: number;
	height: number;
	/** RGBA 8 bits por canal, linha a linha. */
	rgba: Buffer;
}

/** "opaque" = sem pixel transparente; "cutout" = só 0/255 no alfa; "translucent" = alfa intermediário. */
export type AlphaKind = "opaque" | "cutout" | "translucent";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Só lê o cabeçalho (rápido). */
export function pngSize(file: string): { width: number; height: number } | undefined {
	const buf = readFileSync(file);
	if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return undefined;
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function decodePng(file: string): Png | undefined {
	const buf = readFileSync(file);
	if (!buf.subarray(0, 8).equals(SIGNATURE)) return undefined;
	let pos = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 8;
	let colorType = 6;
	let interlace = 0;
	let palette: Buffer | undefined;
	let trns: Buffer | undefined;
	const idat: Buffer[] = [];
	while (pos + 8 <= buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString("latin1", pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		pos += 12 + len;
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === "PLTE") palette = data;
		else if (type === "tRNS") trns = data;
		else if (type === "IDAT") idat.push(data);
		else if (type === "IEND") break;
	}
	if (interlace !== 0 || !width || !height) return undefined;
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
	if (!channels) return undefined;
	const raw = inflateSync(Buffer.concat(idat));
	const bitsPerPixel = channels * bitDepth;
	const bpp = Math.max(1, bitsPerPixel >> 3);
	const stride = Math.ceil((width * bitsPerPixel) / 8);
	const out = Buffer.alloc(stride * height);
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const cur = out.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? cur[x - bpp] : 0;
			const b = prev[x];
			const c = x >= bpp ? prev[x - bpp] : 0;
			let v = line[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			cur[x] = v & 255;
		}
		prev = cur;
	}
	const rgba = Buffer.alloc(width * height * 4);
	const sample = (row: Buffer, i: number): number => {
		if (bitDepth === 8) return row[i];
		if (bitDepth === 16) return row[i * 2];
		const perByte = 8 / bitDepth;
		const byte = row[Math.floor(i / perByte)];
		const shift = 8 - bitDepth * ((i % perByte) + 1);
		const v = (byte >> shift) & ((1 << bitDepth) - 1);
		return colorType === 3 ? v : Math.round((v * 255) / ((1 << bitDepth) - 1));
	};
	for (let y = 0; y < height; y++) {
		const row = out.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (colorType === 6) for (let k = 0; k < 4; k++) rgba[o + k] = sample(row, x * 4 + k);
			else if (colorType === 2) {
				for (let k = 0; k < 3; k++) rgba[o + k] = sample(row, x * 3 + k);
				rgba[o + 3] = 255;
			} else if (colorType === 0) {
				rgba[o] = rgba[o + 1] = rgba[o + 2] = sample(row, x);
				rgba[o + 3] = 255;
			} else if (colorType === 4) {
				rgba[o] = rgba[o + 1] = rgba[o + 2] = sample(row, x * 2);
				rgba[o + 3] = sample(row, x * 2 + 1);
			} else {
				const idx = sample(row, x);
				rgba[o] = palette?.[idx * 3] ?? 0;
				rgba[o + 1] = palette?.[idx * 3 + 1] ?? 0;
				rgba[o + 2] = palette?.[idx * 3 + 2] ?? 0;
				rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
			}
		}
	}
	return { width, height, rgba };
}

export function alphaKind(png: Png): AlphaKind {
	let kind: AlphaKind = "opaque";
	for (let i = 3; i < png.rgba.length; i += 4) {
		const a = png.rgba[i];
		if (a === 255) continue;
		if (a === 0) kind = "cutout";
		else return "translucent";
	}
	return kind;
}

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "latin1");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

export function encodePng(png: Png): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(png.width, 0);
	ihdr.writeUInt32BE(png.height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const stride = png.width * 4;
	const raw = Buffer.alloc((stride + 1) * png.height);
	for (let y = 0; y < png.height; y++) png.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Primeiro quadro quadrado de uma tira vertical (textura animada do Java). */
export function firstFrame(png: Png): Png {
	const size = png.width;
	if (png.height <= size) return png;
	return { width: size, height: size, rgba: Buffer.from(png.rgba.subarray(0, size * size * 4)) };
}
