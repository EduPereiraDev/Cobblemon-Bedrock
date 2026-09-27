// Folha de contato (fundo xadrez) para inspeção visual dos retratos.
//   node --experimental-strip-types --no-warnings tools/importer/portraits/sheet.ts <saída.png> <colunas> <png...>
// PNGs menores que o maior da lista são ampliados por vizinho mais próximo (fator inteiro).
import { writeFileSync } from "node:fs";
import { decodePng, encodePng } from "../png.ts";

const [out, colsArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg);
const imgs = files.map((f) => decodePng(f)!);
const cell = Math.max(...imgs.map((i) => Math.max(i.width, i.height)));
const rows = Math.ceil(imgs.length / cols);
const W = cols * (cell + 4);
const H = rows * (cell + 4);
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++)
	for (let x = 0; x < W; x++) {
		const o = (y * W + x) * 4;
		const c = ((x >> 3) + (y >> 3)) & 1 ? 200 : 230;
		rgba[o] = rgba[o + 1] = rgba[o + 2] = c;
		rgba[o + 3] = 255;
	}
imgs.forEach((img, n) => {
	const k = Math.max(1, Math.floor(cell / Math.max(img.width, img.height)));
	const ox = (n % cols) * (cell + 4) + 2;
	const oy = Math.floor(n / cols) * (cell + 4) + 2;
	for (let y = 0; y < img.height * k; y++)
		for (let x = 0; x < img.width * k; x++) {
			const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
			const d = ((oy + y) * W + ox + x) * 4;
			const a = img.rgba[s + 3] / 255;
			for (let c = 0; c < 3; c++) rgba[d + c] = Math.round(img.rgba[s + c] * a + rgba[d + c] * (1 - a));
		}
});
writeFileSync(out, encodePng({ width: W, height: H, rgba }));
