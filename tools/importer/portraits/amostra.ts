// Folha de contato dos retratos para revisão visual: docs/pesquisa/retratos-amostra.png.
//   node --experimental-strip-types --no-warnings tools/importer/portraits/amostra.ts [saída.png]
// Cada célula é o par retrato 64 px (ampliado 2×) + perfil 128 px de uma espécie/variante escolhida pelos
// aspects (resolveVariant), cobrindo shiny, formas regionais, gênero, camadas emissivas/translúcidas e
// posers só em Kotlin. Lê o generated/ atual (rode `npm run import` antes).
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePng, encodePng } from "../png.ts";
import { ROOT } from "../util.ts";

const out = resolve(process.argv[2] ?? join(ROOT, "docs", "pesquisa", "retratos-amostra.png"));
const RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const { resolveVariant } = await import(join(ROOT, "generated", "scripts", "variants.ts"));
const P = await import(join(ROOT, "generated", "scripts", "portraits.ts"));

/** espécie + aspects. A ordem aparece na folha (linha a linha, 5 pares por linha). */
export const SAMPLE: Array<[string, string[]]> = [
	["bulbasaur", []], ["charizard", []], ["charizard", ["shiny"]], ["pikachu", ["female"]], ["raichu", ["alolan"]],
	["vulpix", ["alolan"]], ["ninetales", ["alolan", "shiny"]], ["meowth", ["galarian"]], ["gengar", []], ["gyarados", []],
	["gyarados", ["shiny"]], ["gyarados", ["female", "shiny"]], ["magmar", []], ["ponyta", ["galarian"]], ["rapidash", []],
	["eevee", ["shiny"]], ["umbreon", []], ["misdreavus", []], ["typhlosion", ["hisuian"]], ["slowpoke", ["galarian"]],
	["tauros", ["paldean", "blaze-breed"]], ["wooper", ["paldean"]], ["zorua", ["hisuian"]], ["chandelure", []], ["lanturn", ["shiny"]],
	["aggron", []], ["ampharos", []], ["turtwig", ["shiny"]], ["donphan", []], ["spinda", []],
	["unown", ["character-q"]], ["vivillon", ["vivillon-wings-fancy"]], ["alcremie", ["cream-matcha", "decoration-star"]], ["gholdengo", []], ["ceruledge", []],
	["armarouge", ["shiny"]], ["crobat", []], ["mismagius", []], ["starmie", []], ["charcadet", []],
];

const cells: Array<{ portrait: string; profile: string; label: string }> = [];
for (const [sp, aspects] of SAMPLE) {
	const v = resolveVariant(sp, aspects);
	cells.push({ portrait: join(RP, `${P.portraitTexture(sp, v)}.png`), profile: join(RP, `${P.profileTexture(sp, v)}.png`), label: `${sp}[${aspects.join("+")}]#${v}` });
}
const COLS = 5;
const CELL = 128;
const PAD = 4;
const W = COLS * (2 * CELL + 3 * PAD);
const rows = Math.ceil(cells.length / COLS);
const H = rows * (CELL + 2 * PAD);
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++)
	for (let x = 0; x < W; x++) {
		const o = (y * W + x) * 4;
		const c = ((x >> 3) + (y >> 3)) & 1 ? 200 : 228;
		rgba[o] = rgba[o + 1] = rgba[o + 2] = c;
		rgba[o + 3] = 255;
	}
function blit(file: string, ox: number, oy: number): void {
	const img = decodePng(file);
	if (!img) throw new Error(`PNG ausente: ${file}`);
	const k = Math.max(1, Math.floor(CELL / img.width));
	for (let y = 0; y < img.height * k; y++)
		for (let x = 0; x < img.width * k; x++) {
			const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
			const d = ((oy + y) * W + ox + x) * 4;
			const a = img.rgba[s + 3] / 255;
			for (let c = 0; c < 3; c++) rgba[d + c] = Math.round(img.rgba[s + c] * a + rgba[d + c] * (1 - a));
		}
}
cells.forEach((c, n) => {
	const ox = (n % COLS) * (2 * CELL + 3 * PAD) + PAD;
	const oy = Math.floor(n / COLS) * (CELL + 2 * PAD) + PAD;
	blit(c.portrait, ox, oy);
	blit(c.profile, ox + CELL + PAD, oy);
});
writeFileSync(out, encodePng({ width: W, height: H, rgba }));
console.log(`${out}: ${cells.length} pares (retrato + perfil)`);
for (const c of cells) console.log(`  ${c.label}`);
