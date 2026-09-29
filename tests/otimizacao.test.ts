// Frente otimizacao (docs/pendencias/otimizacao.md): provas automáticas das otimizações "garantidas" (nada muda no jogo).
// 1. #6  condição de variante compacta: exaustiva em todos os subconjuntos pequenos, aleatória nos grandes, e em todas
//        as condições do import atual; a regra das camadas (≤ 6 comparações antigas vira filtro) continua a mesma.
// 2. #12 tinta de gimmick: máquina antiga (22 estados) × nova (2 estados) em todas as sequências; controle negativo.
// 3. #8  tabelas por JSON.parse: o literal antigo (cópia tipada) e o JSON.parse do módulo dão o mesmo objeto.
// 4. #2  PNG: decodificador de referência (todos os formatos), oxipng só com saída de pixels idênticos e formato do pack.
// 5. #4/#10/#11/#14/#15 etapa do build num pack pequeno: o que sai, o que fica (guardas) e as provas pegando erro.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { assertSameMembership, comparisonCount, compactVariantCondition, legacyVariantCondition } from "../tools/importer/variantConditions";
import { evaluate } from "../tools/importer/molangEnv";
import { gimmickTintController, legacyGimmickTintController } from "../tools/importer/entities";
import { simulateControllers } from "../tools/optimize/controllerSim";
import { USE_JSON_PARSE, jsonTableExpression, jsonValueExpression, objectLiteral, tableLines } from "../tools/importer/jsonTable";
import { readGeneratedTableText } from "../tools/importer/generatedTable.mjs";
import { ALLOWED_FORMATS, decodeRgba16, optimizePng, pngFormat, samePixels, stripMetadata } from "../tools/optimize/png.mjs";
import { checkProofs, loadPack, optimizeDist, proofSnapshot } from "../tools/optimize/index.mjs";
import { geometryDefinitions } from "../tools/optimize/dedupe.mjs";
import * as variantsModule from "../generated/scripts/variants";
import * as entityDataModule from "../generated/scripts/entityData";
import * as habitatsModule from "../generated/scripts/habitats";
import * as actionEffectsModule from "../generated/scripts/actionEffects";

const ROOT = process.cwd();
const GEN = join(ROOT, "generated");
const GEN_RP = join(GEN, "resource_packs", "CobblemonBedrock");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
	try { await fn(); passed++; }
	catch (e) { console.error(`✗ ${name}`); throw e; }
}

const truth = (expr: string, v: number) => {
	const env = { vars: new Map([["v.cobblemon_variant", v]]), props: new Map<string, number>() };
	return evaluate(expr, env) !== 0;
};

// 1. #6 ---------------------------------------------------------------------------------------
await test("#6: todo subconjunto de até 11 variantes, avaliado para todo inteiro relevante, igual à condição antiga", () => {
	let sets = 0, before = 0, after = 0;
	for (let total = 1; total <= 11; total++) {
		for (let mask = 0; mask < 1 << total; mask++) {
			const indices = [...Array(total).keys()].filter((i) => mask & (1 << i));
			const oldC = legacyVariantCondition(indices, total);
			const newC = compactVariantCondition(indices, total);
			assert.equal(newC === undefined, oldC === undefined);
			if (oldC === "") assert.equal(newC, "", "conjunto vazio: igual à antiga");
			if (!oldC || !newC) continue;
			sets++;
			before += comparisonCount(oldC);
			after += comparisonCount(newC);
			assert.ok(comparisonCount(newC) <= comparisonCount(oldC), newC);
			for (let v = -3; v <= total + 3; v++) assert.equal(truth(newC, v), truth(oldC, v), `${oldC} × ${newC} em v=${v}`);
		}
	}
	assert.ok(sets > 4000 && after < before, `${sets} conjuntos, ${before} → ${after} comparações`);
});

await test("#6: conjuntos grandes (aleatórios, faixas e progressões) iguais à antiga", () => {
	let seed = 7;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	for (let k = 0; k < 150; k++) {
		const total = 20 + Math.floor(rnd() * 380);
		const mode = k % 3;
		const step = 2 + Math.floor(rnd() * 5);
		const off = Math.floor(rnd() * step);
		const indices = [...Array(total).keys()].filter((i) => (mode === 0 ? rnd() < 0.4 : mode === 1 ? i % step === off : (i >= total / 3 && i < total / 2) || i % 7 === 3));
		const oldC = legacyVariantCondition(indices, total);
		const newC = compactVariantCondition(indices, total);
		if (!oldC || !newC) continue;
		for (let v = -2; v <= total + 2; v++) assert.equal(truth(newC, v), truth(oldC, v), `total ${total} v=${v}`);
	}
});

await test("#6: a prova do import pega uma condição errada (controle negativo)", () => {
	assert.throws(() => assertSameMembership("v.cobblemon_variant >= 0 && v.cobblemon_variant <= 4", (v) => v >= 0 && v <= 3, 6), /diverge/);
	assert.throws(() => assertSameMembership("(v.cobblemon_variant >= 0 && v.cobblemon_variant <= 6 && math.mod(v.cobblemon_variant, 2) == 0)", (v) => [0, 2, 4].includes(v), 7), /diverge/);
});

if (existsSync(join(GEN_RP, "entity", "pokemon"))) {
	const { VARIANTS } = variantsModule;
	await test("#6 gerado: toda condição do import atual é a mesma função da antiga, e as camadas longas continuam sem filtro", () => {
		let conditions = 0, layersFiltered = 0, layersUnconditional = 0, before = 0, after = 0;
		for (const f of readdirSync(join(GEN_RP, "entity", "pokemon"))) {
			const species = f.replace(/\.entity\.json$/, "");
			const total = VARIANTS[species]?.combos.length;
			if (!total) continue;
			const d = JSON.parse(readFileSync(join(GEN_RP, "entity", "pokemon", f), "utf8"))["minecraft:client_entity"].description;
			const conds = [...(d.scripts.animate ?? []), ...(d.render_controllers ?? [])].filter((x: any) => typeof x === "object").map((x: any) => Object.values(x)[0] as string);
			for (const c of conds) {
				conditions++;
				// O conjunto que a condição nova descreve, e a antiga para esse conjunto: iguais em todo inteiro.
				const inside = [...Array(total).keys()].filter((v) => truth(c, v));
				const oldC = legacyVariantCondition(inside, total)!;
				before += comparisonCount(oldC);
				after += comparisonCount(c);
				for (let v = -2; v <= total + 1; v++) assert.equal(truth(c, v), truth(oldC, v), `${species}: ${c.slice(0, 80)} v=${v}`);
			}
			// Camadas (#7 NÃO feito): o filtro só existe onde a lista antiga tinha ≤ 6 comparações.
			const rcFile = join(GEN_RP, "render_controllers", "pokemon", `${species}.render_controllers.json`);
			const rcs = JSON.parse(readFileSync(rcFile, "utf8")).render_controllers;
			for (const entry of d.render_controllers) {
				const id = typeof entry === "string" ? entry : Object.keys(entry)[0];
				if (!/\.layer\d+$/.test(id)) continue;
				const list: string[] = Object.values<string[]>(rcs[id].arrays.textures)[0];
				if (list.length !== total) continue; // textura animada (combinações × quadros)
				const present = list.flatMap((t, i) => (t === "Texture.blank" ? [] : [i]));
				const legacy = legacyVariantCondition(present, total);
				const filtered = !!legacy && legacy.split("||").length <= 6;
				assert.equal(typeof entry === "object", filtered, `${species} ${id}: decisão de filtro da camada mudou`);
				if (filtered) layersFiltered++; else layersUnconditional++;
			}
		}
		assert.ok(conditions > 2000, `condições: ${conditions}`);
		assert.ok(layersUnconditional >= 40, `camadas sem filtro (lista longa): ${layersUnconditional}`);
		console.log(`  #6 gerado: ${conditions} condições, comparações ${before} → ${after}; camadas com filtro ${layersFiltered}, sem filtro ${layersUnconditional}`);
	});
}

// 2. #12 --------------------------------------------------------------------------------------
await test("#12: tinta de gimmick de 2 estados igual à de 22 estados em todo frame (os dois modelos de transição)", () => {
	const sim = simulateControllers(legacyGimmickTintController(), gimmickTintController());
	assert.deepEqual(sim.differences, []);
	assert.ok(sim.checks >= 15625 && sim.frames > 300000);
	const states = Object.values<any>((gimmickTintController() as any).animation_controllers)[0].states;
	assert.equal(states.default.transitions.length, 1, "1 transição por frame no estado parado (eram 21)");
});

await test("#12: a simulação pega uma cor trocada e uma transição errada (controle negativo)", () => {
	const wrongColor: any = gimmickTintController();
	const on = Object.values<any>(wrongColor.animation_controllers)[0].states.on;
	on.on_entry[0] = on.on_entry[0].replace("0.30", "0.31");
	assert.ok(simulateControllers(legacyGimmickTintController(), wrongColor).differences.length > 0);
	const wrongRange: any = gimmickTintController();
	const def = Object.values<any>(wrongRange.animation_controllers)[0].states.default;
	def.transitions[0].on = def.transitions[0].on.replace("<= 21", "<= 20");
	assert.ok(simulateControllers(legacyGimmickTintController(), wrongRange).differences.length > 0);
});

if (existsSync(join(GEN_RP, "animation_controllers", "pokemon", "cobblemon_gimmick_tint.animation_controllers.json"))) {
	await test("#12 gerado: o controller do pack é o novo", () => {
		const file = JSON.parse(readFileSync(join(GEN_RP, "animation_controllers", "pokemon", "cobblemon_gimmick_tint.animation_controllers.json"), "utf8"));
		assert.deepEqual(file, gimmickTintController());
	});
}

// 3. #8 ---------------------------------------------------------------------------------------
await test("#8: JSON.parse do texto dá o mesmo objeto que o literal (inclusive chaves numéricas, unicode e escapes)", () => {
	const entries: [string, unknown][] = [["b", { x: "a\"b\\c", y: [1, -0, 1e21, 0.1] }], ["10", "dez"], ["a", "é ü"], ["2", null]];
	const lines = tableLines(entries, "t");
	const fromJson = Function(`return ${jsonTableExpression(lines, "t")}`)();
	const fromLiteral = Function(`return (${objectLiteral(lines)})`)();
	assert.deepStrictEqual(fromJson, fromLiteral);
	assert.deepEqual(Object.keys(fromJson), Object.keys(fromLiteral), "mesma ordem de chaves");
	assert.deepStrictEqual(Function(`return ${jsonValueExpression([{ t: "x" }], "v")}`)(), [{ t: "x" }]);
	assert.throws(() => tableLines([["__proto__", 1]], "t"), /__proto__/);
	assert.throws(() => tableLines([["a", { __proto__: null, ["__proto__"]: 1 }]], "t"), /__proto__/);
});

const MODULES: Record<string, Record<string, unknown>> = { variants: variantsModule, entityData: entityDataModule, habitats: habitatsModule, actionEffects: actionEffectsModule };
for (const [mod, name] of [["variants", "VARIANTS"], ["entityData", "ENTITY_INFO"], ["habitats", "HABITAT_POOLS"], ["actionEffects", "ACTION_EFFECTS"]] as const) {
	const file = join(GEN, "scripts", `${mod}.ts`);
	const check = join(GEN, "scripts", "_tipos", `${mod}.check.ts`);
	if (!existsSync(file) || !existsSync(check)) continue;
	await test(`#8 gerado: ${name} por JSON.parse é igual ao literal antigo (cópia tipada)`, async () => {
		const text = readFileSync(file, "utf8");
		// #8 desligado na beta 7 (memória em console): a tabela volta a ser literal.
		if (USE_JSON_PARSE) assert.match(text, new RegExp(`export const ${name}: [^\\n]*= JSON\\.parse\\("`), "tabela em JSON.parse");
		else assert.doesNotMatch(text, new RegExp(`export const ${name}: [^\\n]*= JSON\\.parse\\(`), "tabela em literal (#8 desligado)");
		const value = MODULES[mod][name];
		const checkText = readFileSync(check, "utf8");
		const start = checkText.indexOf(`export const ${name}_TYPECHECK`);
		const literal = checkText.slice(checkText.indexOf("= ", start) + 2, checkText.lastIndexOf(";"));
		assert.deepStrictEqual(value, Function(`return (${literal})`)());
		assert.deepStrictEqual(readGeneratedTableText(text, name), JSON.parse(JSON.stringify(value)), "leitor textual (MSD/E2E)");
	});
}

// 4. #2 ---------------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
	return Buffer.concat([len, td, c]);
}
/** PNG com amostras cruas `samples[y][x][canal]` (no nº de bits dado), com ou sem Adam7. */
function encodePng(w: number, h: number, ct: number, bd: number, samples: number[][][], opts: { plte?: number[][]; trns?: Buffer; interlace?: boolean; extra?: Buffer[] } = {}): Buffer {
	const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]!;
	const packRow = (px: number[][]) => {
		const bits = px.length * ch * bd;
		const row = Buffer.alloc(Math.ceil(bits / 8));
		let bit = 0;
		for (const p of px) for (let k = 0; k < ch; k++) {
			const v = p[k];
			if (bd === 16) { row.writeUInt16BE(v, bit / 8); bit += 16; continue; }
			if (bd === 8) { row[bit / 8] = v; bit += 8; continue; }
			row[bit >> 3] |= v << (8 - bd - (bit & 7));
			bit += bd;
		}
		return Buffer.concat([Buffer.from([0]), row]);
	};
	const rows: Buffer[] = [];
	if (!opts.interlace) for (let y = 0; y < h; y++) rows.push(packRow(samples[y]));
	else for (const [xs, ys, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
		for (let y = ys; y < h; y += dy) {
			const px: number[][] = [];
			for (let x = xs; x < w; x += dx) px.push(samples[y][x]);
			if (px.length) rows.push(packRow(px));
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bd; ihdr[9] = ct; ihdr[12] = opts.interlace ? 1 : 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...(opts.extra ?? []),
		...(opts.plte ? [chunk("PLTE", Buffer.from(opts.plte.flat()))] : []), ...(opts.trns ? [chunk("tRNS", opts.trns)] : []),
		chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0)),
	]);
}
const grid = (w: number, h: number, f: (x: number, y: number) => number[]) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(x, y)));

await test("#2: decodificador de referência lê todos os formatos (cinza/RGB/paleta/alfa, 1–16 bits, tRNS, Adam7)", () => {
	const W = 11, H = 9;
	for (const interlace of [false, true]) {
		for (const bd of [1, 2, 4, 8, 16]) {
			const max = (1 << bd) - 1;
			const s = grid(W, H, (x, y) => [(x * 3 + y) % (max + 1)]);
			const trnsV = 1 % (max + 1);
			const trns = Buffer.alloc(2); trns.writeUInt16BE(trnsV);
			const d = decodeRgba16(encodePng(W, H, 0, bd, s, { interlace, trns }));
			for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
				const o = (y * W + x) * 4, g = Math.round((s[y][x][0] * 65535) / max);
				assert.deepEqual([...d.rgba.subarray(o, o + 4)], [g, g, g, s[y][x][0] === trnsV ? 0 : 65535], `cinza ${bd} bits (${x},${y})`);
			}
			if (bd <= 8) {
				const plte = Array.from({ length: max + 1 }, (_, i) => [i * 7 % 256, i * 13 % 256, i * 29 % 256]);
				const alpha = Buffer.from(plte.map((_, i) => (i * 37) % 256).slice(0, Math.max(1, max)));
				const dp = decodeRgba16(encodePng(W, H, 3, bd, s, { interlace, plte, trns: alpha }));
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					const i = s[y][x][0], o = (y * W + x) * 4;
					assert.deepEqual([...dp.rgba.subarray(o, o + 4)], [...plte[i].map((c) => c * 257), i < alpha.length ? alpha[i] * 257 : 65535], `paleta ${bd} bits`);
				}
			}
			if (bd >= 8) {
				const s6 = grid(W, H, (x, y) => [x * 5 % (max + 1), y * 11 % (max + 1), (x * y) % (max + 1), (x + y) % (max + 1)]);
				const d6 = decodeRgba16(encodePng(W, H, 6, bd, s6, { interlace }));
				const sc = (v: number) => (bd === 16 ? v : v * 257);
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.deepEqual([...d6.rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)], s6[y][x].map(sc), `RGBA ${bd} bits`);
			}
		}
	}
});

await test("#2: oxipng só com pixels idênticos, formato do pack e sem cinza; metadados saem, cor fica", async () => {
	const meta = [chunk("tEXt", Buffer.from("Comment\0x")), chunk("tIME", Buffer.alloc(7)), chunk("pHYs", Buffer.alloc(9)), chunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f]))];
	const images = [
		// RGBA com alfa variado e pixels transparentes com cor (a cor escondida tem de ficar).
		encodePng(16, 16, 6, 8, grid(16, 16, (x, y) => [x * 16, y * 16, (x * y) & 255, x < 4 ? 0 : 255]), { extra: meta }),
		// Poucas cores: vira paleta. Cinza puro (r=g=b): NÃO pode virar tipo cinza.
		encodePng(16, 16, 6, 8, grid(16, 16, (x) => [x < 8 ? 40 : 200, x < 8 ? 40 : 200, x < 8 ? 40 : 200, 255])),
		encodePng(8, 8, 2, 8, grid(8, 8, (x, y) => [(x + y) * 9, 0, 0])),
	];
	for (const img of images) {
		const r = await optimizePng(img);
		assert.ok(samePixels(img, r.out), "pixels iguais");
		assert.ok(r.out.length <= img.length);
		const fmt = pngFormat(r.out);
		assert.ok(r.out === img || ALLOWED_FORMATS.has(fmt), `formato ${fmt}`);
		assert.ok(!/^ct(0|4)\//.test(fmt), "sem cinza");
		const types = new Set<string>();
		let o = 8;
		while (o < r.out.length) { const len = r.out.readUInt32BE(o); types.add(r.out.toString("latin1", o + 4, o + 8)); o += 12 + len; }
		for (const t of ["tEXt", "tIME", "pHYs"]) assert.ok(!types.has(t), `${t} sai`);
		if (img === images[0]) assert.ok(types.has("gAMA"), "gAMA fica");
	}
	assert.ok(stripMetadata(images[0]).length < images[0].length);
});

await test("#2: a comparação de pixels pega 1 valor diferente (controle negativo)", () => {
	const a = encodePng(4, 4, 6, 8, grid(4, 4, (x, y) => [1, 2, 3, x === 0 && y === 0 ? 0 : 255]));
	const b = encodePng(4, 4, 6, 8, grid(4, 4, (x, y) => [1, 2, x === 3 && y === 3 ? 4 : 3, x === 0 && y === 0 ? 0 : 255]));
	const c = encodePng(4, 4, 6, 8, grid(4, 4, (x, y) => [x === 0 && y === 0 ? 9 : 1, 2, 3, x === 0 && y === 0 ? 0 : 255]));
	assert.ok(samePixels(a, encodePng(4, 4, 6, 8, grid(4, 4, (x, y) => [1, 2, 3, x === 0 && y === 0 ? 0 : 255]))));
	assert.ok(!samePixels(a, b));
	assert.ok(!samePixels(a, c), "cor escondida em pixel transparente também conta");
});

// 5. Etapa do build ---------------------------------------------------------------------------
const put = (file: string, data: string | Buffer) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function miniDist(dir: string) {
	const rp = join(dir, "dist", "rp"), bp = join(dir, "dist", "bp");
	put(join(dir, "scripts", "a.ts"), 'const nome = "sons_de_script"; const caminho = `textures/dinamica/${nome}`;');
	const ogg = Buffer.from("OggS silencio");
	for (const f of ["sounds/a/um.ogg", "sounds/b/dois.ogg", "sounds/c/sons_de_script.ogg", "sounds/d/tres.ogg"]) put(join(rp, f), ogg);
	put(join(rp, "sounds/sound_definitions.json"), JSON.stringify({ format_version: "1.14.0", sound_definitions: {
		e1: { category: "neutral", sounds: ["sounds/a/um"] }, e2: { sounds: [{ name: "sounds/b/dois", volume: 0.5 }] },
		e3: { sounds: ["sounds/c/sons_de_script"] }, e4: { sounds: ["sounds/d/tres", "sounds/a/um"] },
	} }));
	const png = encodePng(4, 4, 6, 8, grid(4, 4, (x, y) => [x * 60, y * 60, 9, 255]));
	for (const f of ["textures/entity/xis.png", "textures/entity/ipsilon.png", "textures/dinamica/zeta.png", "textures/ui/dablio.png"]) put(join(rp, f), png);
	put(join(rp, "ui/tela.json"), JSON.stringify({ a: { texture: "textures/ui/dablio" } }));
	const rc = { arrays: { textures: { "Array.t": ["Texture.default"] } }, geometry: "Geometry.default", materials: [{ "*": "Material.default" }], textures: ["Array.t[0]"] };
	put(join(rp, "render_controllers/a.render_controllers.json"), JSON.stringify({ format_version: "1.10.0", render_controllers: { "controller.render.a": rc } }));
	put(join(rp, "render_controllers/b.render_controllers.json"), JSON.stringify({ format_version: "1.10.0", render_controllers: { "controller.render.b": rc, "controller.render.b_unico": { ...rc, geometry: "Geometry.outra" } } }));
	const entity = (id: string, tex: string, geo: string, rcs: any[]) => ({ format_version: "1.10.0", "minecraft:client_entity": { description: { identifier: id, textures: { default: tex }, geometry: { default: geo, outra: geo }, render_controllers: rcs } } });
	put(join(rp, "entity/a.entity.json"), JSON.stringify(entity("t:a", "textures/entity/xis", "geometry.g1", ["controller.render.a"])));
	put(join(rp, "entity/b.entity.json"), JSON.stringify(entity("t:b", "textures/entity/ipsilon", "geometry.g2", [{ "controller.render.b": "q.is_baby" }, "controller.render.b_unico"])));
	put(join(rp, "entity/c.entity.json"), JSON.stringify(entity("t:c", "textures/dinamica/zeta", "geometry.g3", [])));
	const geo = (id: string, w = 16) => ({ description: { identifier: id, texture_width: w, texture_height: 16 }, bones: [{ name: "b", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }] }] });
	put(join(rp, "models/entity/g1.geo.json"), JSON.stringify({ format_version: "1.12.0", "minecraft:geometry": [geo("geometry.g1")] }));
	put(join(rp, "models/entity/g2.geo.json"), JSON.stringify({ format_version: "1.12.0", "minecraft:geometry": [geo("geometry.g2")] }));
	put(join(rp, "models/entity/g3.geo.json"), JSON.stringify({ format_version: "1.12.0", "minecraft:geometry": [geo("geometry.g3", 32)] }));
	put(join(rp, "animations/pokemon/a.animation.json"), JSON.stringify({ format_version: "1.8.0", animations: { "animation.a": { loop: true } } }));
	put(join(rp, "animations/pokemon/b.animation.json"), JSON.stringify({ format_version: "1.8.0", animations: { "animation.b": { loop: false }, "animation.c": { animation_length: 1 } } }));
	put(join(rp, "animations/pokemon/c.animation.json"), JSON.stringify({ format_version: "1.10.0", animations: { "animation.d": {} } }));
	put(join(rp, "animation_controllers/a.animation_controllers.json"), JSON.stringify({ format_version: "1.10.0", animation_controllers: { "controller.animation.a": { states: { default: {} } } } }));
	put(join(rp, "animation_controllers/b.animation_controllers.json"), JSON.stringify({ format_version: "1.10.0", animation_controllers: { "controller.animation.b": { states: { default: {} } } } }));
	const loot = JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: "item", name: "minecraft:stick" }] }] });
	put(join(bp, "loot_tables/x/l1.json"), loot);
	put(join(bp, "loot_tables/x/l2.json"), loot);
	put(join(bp, "loot_tables/chests/baú.json"), JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: "loot_table", name: "loot_tables/x/l1.json" }, { type: "loot_table", name: "loot_tables/x/l2.json" }] }] }));
	return { rp, bp };
}

await test("etapa do build: duplicatas, geometrias, render controllers e lotes, com as guardas", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cobblemon-otimizacao-"));
	try {
		const { rp, bp } = miniDist(dir);
		const report = await optimizeDist({ root: dir, rp, bp, cacheDir: join(dir, "cache"), log: () => {} });
		// #4/#15 OGG: uma cópia; a usada por nome no script fica; eventos apontam para a cópia.
		const defs = json(join(rp, "sounds/sound_definitions.json")).sound_definitions;
		assert.equal(report.dedupeFiles[".ogg"].removed, 3);
		assert.ok(existsSync(join(rp, "sounds/c/sons_de_script.ogg")), "nome usado no script: fica");
		assert.equal(defs.e3.sounds[0], "sounds/c/sons_de_script");
		assert.deepEqual(defs.e2.sounds[0], { name: "sounds/c/sons_de_script", volume: 0.5 }, "campos da entrada ficam");
		assert.equal(defs.e1.sounds[0], "sounds/c/sons_de_script");
		// #15 PNG: o da UI e o montado por prefixo no script ficam; as duas cópias das entidades apontam para a que ficou.
		assert.ok(!existsSync(join(rp, "textures/entity/xis.png")) && !existsSync(join(rp, "textures/entity/ipsilon.png")));
		assert.equal(json(join(rp, "entity/b.entity.json"))["minecraft:client_entity"].description.textures.default, "textures/dinamica/zeta");
		assert.ok(existsSync(join(rp, "textures/ui/dablio.png")) && existsSync(join(rp, "textures/dinamica/zeta.png")));
		// #15 JSON (loot): l2 vira l1.
		assert.ok(!existsSync(join(bp, "loot_tables/x/l2.json")));
		assert.deepEqual(json(join(bp, "loot_tables/chests/baú.json")).pools[0].entries.map((e: any) => e.name), ["loot_tables/x/l1.json", "loot_tables/x/l1.json"]);
		// #14: g2 sai, b aponta para g1; g3 (texture_width diferente) fica.
		const bDesc = json(join(rp, "entity/b.entity.json"))["minecraft:client_entity"].description;
		assert.deepEqual(bDesc.geometry, { default: "geometry.g1", outra: "geometry.g1" });
		// #10: a e b compartilham; b_unico fica; condição preservada.
		const aDesc = json(join(rp, "entity/a.entity.json"))["minecraft:client_entity"].description;
		assert.match(aDesc.render_controllers[0], /^controller\.render\.cobblemon\.shared\./);
		assert.deepEqual(bDesc.render_controllers, [{ [aDesc.render_controllers[0]]: "q.is_baby" }, "controller.render.b_unico"]);
		assert.ok(!existsSync(join(rp, "render_controllers/a.render_controllers.json")));
		// #11: animações 1.8.0 juntas; a 1.10.0 fica sozinha; controllers juntos; geometrias juntas.
		const anims = readdirSync(join(rp, "animations/pokemon/_opt"));
		assert.equal(anims.length, 1);
		assert.deepEqual(Object.keys(json(join(rp, "animations/pokemon/_opt", anims[0])).animations).sort(), ["animation.a", "animation.b", "animation.c"]);
		assert.ok(existsSync(join(rp, "animations/pokemon/c.animation.json")));
		assert.equal(report.bundles["animation_controllers/"].bundled, 2);
		const geos = geometryDefinitions(loadPack(rp));
		assert.deepEqual([...geos.keys()].sort(), ["geometry.g1", "geometry.g3"]);
		assert.ok(report.proof.eventosDeSom === 4 && report.proof.entidadesComRenderControllers >= 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test("etapa do build: o que o pack MSD cita ou sobrescreve fica como está", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cobblemon-otimizacao-"));
	try {
		const { rp, bp } = miniDist(dir);
		const msdRp = join(dir, "dist", "msd_rp");
		put(join(msdRp, "entity/novo.entity.json"), JSON.stringify({ "minecraft:client_entity": { description: { identifier: "t:novo", render_controllers: ["controller.render.b"], geometry: { default: "geometry.g2" } } } }));
		put(join(msdRp, "animations/pokemon/a.animation.json"), JSON.stringify({ format_version: "1.8.0", animations: { "animation.a": { loop: false } } }));
		put(join(msdRp, "sounds/sound_definitions.json"), JSON.stringify({ sound_definitions: { e9: { sounds: ["sounds/b/dois"] } } }));
		await optimizeDist({ root: dir, rp, bp, msdRp, cacheDir: join(dir, "cache"), log: () => {} });
		assert.ok(existsSync(join(rp, "render_controllers/b.render_controllers.json")) && json(join(rp, "render_controllers/b.render_controllers.json")).render_controllers["controller.render.b"], "controller citado pelo MSD");
		assert.ok(geometryDefinitions(loadPack(rp)).has("geometry.g2"), "geometria citada pelo MSD");
		assert.ok(existsSync(join(rp, "animations/pokemon/a.animation.json")), "arquivo sobrescrito pelo MSD não entra em lote");
		assert.ok(existsSync(join(rp, "sounds/b/dois.ogg")), "som citado pelo MSD");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test("etapa do build: as provas pegam referência, som, geometria, controller e definição mudados (controle negativo)", () => {
	const dir = mkdtempSync(join(tmpdir(), "cobblemon-otimizacao-"));
	try {
		const { rp, bp } = miniDist(dir);
		const snap = () => proofSnapshot({ rp: loadPack(rp), bp: loadPack(bp, ["scripts/"]) });
		const before = snap();
		assert.deepEqual(checkProofs(before, snap(), new Set()).errors, []);
		const mutate = (file: string, fn: (j: any) => void) => { const j = json(file); fn(j); writeFileSync(file, JSON.stringify(j)); };
		mutate(join(rp, "entity/a.entity.json"), (j) => { j["minecraft:client_entity"].description.textures.default = "textures/dinamica/nao_existe"; });
		put(join(rp, "sounds/d/tres.ogg"), Buffer.from("OggS outro"));
		mutate(join(rp, "entity/b.entity.json"), (j) => { const d = j["minecraft:client_entity"].description; d.geometry.default = "geometry.g3"; d.render_controllers[1] = "controller.render.a"; });
		mutate(join(rp, "animations/pokemon/b.animation.json"), (j) => { j.animations["animation.c"].animation_length = 2; });
		const errors = checkProofs(before, snap(), new Set()).errors.join("\n");
		for (const expected of ["referência a arquivo", "evento de som: e4", "referência a geometria", "render controllers da entidade", "definição em animations/: animation.c"]) assert.ok(errors.includes(expected), `${expected} em:\n${errors}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

console.log(`otimizacao: ${passed} grupos de testes ok`);
