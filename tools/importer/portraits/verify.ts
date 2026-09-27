// Verificação dos retratos gerados (shiny, formas, gênero, camadas), sem renderizar de novo.
//   node --experimental-strip-types --no-warnings tools/importer/portraits/verify.ts [pasta com textures/ e scripts/]
// Padrão: generated/resource_packs/CobblemonBedrock + generated/scripts. Checa:
//  1. todo variant de toda espécie aponta para PNGs que existem (retrato, ícone, perfil);
//  2. shiny: variante shiny com textura diferente da normal deve ter imagem diferente, e a cor média do perfil
//     deve ficar mais perto da textura usada que da outra (suspeitas listadas para conferir na folha, sem falhar:
//     a cor média é ruidosa quando o shiny só muda detalhes);
//  3. geometria × textura: proporção da textura igual à texture_width/height da geometria (UV fora do lugar).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePng } from "../png.ts";
import type { Png } from "../png.ts";
import { ModelIndex } from "../models.ts";
import { ASSETS, ROOT, splitId } from "../util.ts";

const base = process.argv[2] ? resolve(process.argv[2]) : undefined;
const rpDir = base ?? join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const scriptsDir = base ? join(base, "scripts") : join(ROOT, "generated", "scripts");
const { VARIANTS } = await import(join(ROOT, "generated", "scripts", "variants.ts"));
const P = await import(join(scriptsDir, "portraits.ts"));

const texFile = (id: string) => join(ASSETS, splitId(id).path);
const pngCache = new Map<string, Png | undefined>();
const png = (file: string) => {
	if (!pngCache.has(file)) pngCache.set(file, existsSync(file) ? decodePng(file) : undefined);
	return pngCache.get(file);
};
/** Cromaticidade média (r, g, b normalizados pela soma) dos pixels opacos. */
function chroma(img: Png | undefined): [number, number, number] | undefined {
	if (!img) return undefined;
	let r = 0, g = 0, b = 0, n = 0;
	for (let i = 0; i < img.rgba.length; i += 4) {
		if (img.rgba[i + 3] < 128) continue;
		const s = img.rgba[i] + img.rgba[i + 1] + img.rgba[i + 2] + 1;
		r += img.rgba[i] / s;
		g += img.rgba[i + 1] / s;
		b += img.rgba[i + 2] / s;
		n++;
	}
	return n ? [r / n, g / n, b / n] : undefined;
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const problems: string[] = [];
/** Suspeitas para conferir na folha de contato (não falham): shiny idêntico ao normal e cor média ambígua. */
const suspects: string[] = [];
let variants = 0;
let shinyPairs = 0;
let shinyColorChecked = 0;
const models = new ModelIndex();
const geoSize = new Map<string, [number, number]>();
const ratioIssues = new Set<string>();

for (const [sp, entry] of Object.entries<any>(VARIANTS)) {
	entry.combos.forEach((c: any, i: number) => {
		variants++;
		for (const f of [P.portraitTexture(sp, i), P.portraitIconTexture(sp, i), P.profileTexture(sp, i)])
			if (!existsSync(join(rpDir, `${f}.png`))) problems.push(`${sp}#${i}: falta ${f}.png`);
		// Proporção textura × geometria.
		const m = models.get(c.model);
		if (m && !geoSize.has(m.file)) {
			const d = JSON.parse(readFileSync(m.file, "utf8"))["minecraft:geometry"]?.[0]?.description ?? {};
			geoSize.set(m.file, [d.texture_width ?? 64, d.texture_height ?? 64]);
		}
		const [gw, gh] = (m && geoSize.get(m.file)) || [64, 64];
		for (const t of [c.texture, ...c.layers.map((l: string) => l.slice(l.indexOf("=") + 1))]) {
			const img = png(texFile(t));
			if (img && Math.abs(img.width / img.height - gw / gh) > 1e-6) ratioIssues.add(`${sp}: ${t.split("/").pop()} ${img.width}x${img.height} vs geo ${gw}x${gh}`);
		}
		// Shiny: acha a combinação normal equivalente (mesmo poser/modelo/camadas sem "shiny").
		if (!/shiny/.test(c.texture)) return;
		const strip = (s: string) => s.replace(/_shiny/g, "");
		const j = entry.combos.findIndex((o: any) => !/shiny/.test(o.texture) && o.model === c.model && o.poser === c.poser && strip(o.texture) === strip(c.texture) && strip(o.layers.join()) === strip(c.layers.join()));
		if (j < 0) return;
		const a = readFileSync(texFile(c.texture));
		const b = readFileSync(texFile(entry.combos[j].texture));
		if (a.equals(b)) return;
		shinyPairs++;
		if (P.portraitTexture(sp, i) === P.portraitTexture(sp, j) && P.profileTexture(sp, i) === P.profileTexture(sp, j))
			suspects.push(`${sp}#${i}: shiny com a mesma imagem do normal #${j} (diferença escondida por camada/enquadramento?)`);
		const rendered = chroma(png(join(rpDir, `${P.profileTexture(sp, i)}.png`)));
		const own = chroma(png(texFile(c.texture)));
		const other = chroma(png(texFile(entry.combos[j].texture)));
		if (rendered && own && other && dist(own, other) > 0.03) {
			shinyColorChecked++;
			if (dist(rendered, own) > dist(rendered, other)) suspects.push(`${sp}#${i}: cor média do perfil shiny mais perto da textura normal`);
		}
	});
}
console.log(JSON.stringify({ variants, shinyPairs, shinyColorChecked, problems: problems.length, suspects: suspects.length, textureRatioMismatches: ratioIssues.size }, null, 2));
for (const p of suspects.filter((x) => x.includes("mesma imagem")).slice(0, Number(process.env.VERIFY_MAX ?? 60))) console.log("  suspeita", p);
for (const p of problems.slice(0, Number(process.env.VERIFY_MAX ?? 60))) console.log("  PROBLEMA", p);
for (const r of [...ratioIssues].slice(0, 30)) console.log("  proporção", r);
process.exit(problems.length ? 1 : 0);
