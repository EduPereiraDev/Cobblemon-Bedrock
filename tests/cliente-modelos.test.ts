// Frente "cliente-modelos": o que o cliente Bedrock recusava em modelos/animações (content log de 27/09) e as regras
// do `npm run validate` que pegam cada categoria sem cliente. Unidades + dados reais de generated/.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkBedrockMolang, evalMolang, javaMolangToBedrock, parseJavaMolang, MOLANG_MAX_DEPTH } from "../tools/importer/molangSyntax.ts";
import { bedrockLinearAt, fixBones, fixCatmullrom, javaChannelAt } from "../tools/importer/animationBake.ts";
import { GEOMETRY_ID, dedupeLocators, pinArmorNeckLocator } from "../tools/importer/locators.ts";
import { perVariant } from "../tools/importer/mundoDetalhes.ts";
import { validateClientModels } from "../tools/importer/validateClientModels.ts";

console.warn = () => { };
console.info = () => { };
console.log = () => { };

const ROOT = process.cwd();
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const UPSTREAM_ANIMS = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "assets", "cobblemon", "bedrock", "pokemon", "animations");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

// ---------------------------------------------------------------------------------------------
// 1. Parser estrito do Bedrock: recusa exatamente as formas do content log.
{
	const refused = [
		"NaN-math.sin(q.anim_time*90*1-45)*0.05", // unrecognized token: nan-...
		"-0.0125*math.sin(q.anim_time*90*sf2*2-120)+1", // variável sem prefixo
		"1*math.sin(q.anim_time*90*speed)",
		"-math.sin((q.anim_time-0.25)*90*3)*+16.7008", // binary Add '+' at end
		"+math.sin(q.anim_time*90*1.5-160)*-4",
		"--22.5",
		"-6.32++math.sin(q.anim_time*90*1)*3",
		"2.5+math.cos(q.anim_time*90*3/2)1", // multiple operations without combining
		"0.532.5-v.cr_o_velocity_y*-0.75",
		"Math.cos(query.anim_time*90*4)*-0.0.5",
		"-2.4985+math.sin(q.anim_time*90*5-150)*2-1)+6*(math.sin(q.anim_time*90*5/2-90)*10", // parênteses
		"math.clamp((v.a*0.7)-(v.b*0.2),0.55,1.05)-(v.c*0.3),0.75,1.35)", // Unexpected Comma
		"(v.a != 2): 1.0 ? 0.0", // Conditional Else
		"s.sound('pokemon.torterra.cry', 1.0, 0.6);",
		"o",
	];
	for (const e of refused) assert.ok(checkBedrockMolang(e), `recusa: ${e}`);
	const accepted = [
		"math.sin(q.anim_time * 90) * -4",
		"v.cobblemon_variant == 0 ? 1.5 : (v.x ?? 2)",
		"v.a = 1; v.b = v.a + 1;",
		"Array.geo[q.property('cobblemon:variant')]",
		"q.has_rider ? {v.x = 1;} : {v.x = 0;};",
		"-(q.anim_time * 0.7)",
		"Math.cos(query.anim_time*90*4)*-0.05",
		"!q.is_on_ground && (v.cobblemon_ride_style == 2)",
	];
	for (const e of accepted) assert.equal(checkBedrockMolang(e), undefined, `aceita: ${e}`);
	// Profundidade: a cadeia de 264 ternários do raichu passa do limite; 111 (unown, aceito pelo cliente) não.
	const chain = (n: number) => { let s = "0"; for (let i = n; i > 0; i--) s = `v.cobblemon_variant == ${i} ? ${i} : (${s})`; return s; };
	assert.ok(checkBedrockMolang(chain(263))?.includes("aninhamento"));
	assert.equal(checkBedrockMolang(chain(111)), undefined);
	assert.ok(MOLANG_MAX_DEPTH >= 222);
}

// ---------------------------------------------------------------------------------------------
// 2. Java → Bedrock: mesmo valor que o parser do Cobblemon (conferido no jar bedrockk 1.1.20).
{
	const at = (expr: string, t: number) => {
		const p = parseJavaMolang(expr, true)!;
		return evalMolang(p.stmts[0], t);
	};
	const cases: Array<[string, string]> = [
		["NaN-math.sin(q.anim_time*90*1-45)*0.05", "0-math.sin(q.anim_time*90*1-45)*0.05"],
		["2.5+math.cos(q.anim_time*90*3/2)1", "2.5+math.cos(q.anim_time*90*3/2)"],
		["-2.4985+math.sin(q.anim_time*90*5-150)*2-1)+6*(math.sin(q.anim_time*90*5/2-90)*10", "-2.4985+math.sin(q.anim_time*90*5-150)*2-1"],
		["--22.5", "22.5"],
		["-6.32++math.sin(q.anim_time*90*1)*3", "-6.32+math.sin(q.anim_time*90*1)*3"],
		["math.sin(q.anim_time*90*2)*+1", "math.sin(q.anim_time*90*2)"],
		["-q.anim_time*90*walk", "0"],
		["22.1877+(math.sin((q.anim_time - 0.4) * 360 ) * 1) +NaN", "22.1877+math.sin((q.anim_time - 0.4) * 360)"],
		["0.532.5-q.anim_time*-0.75", "0.532"],
	];
	for (const [broken, meaning] of cases) {
		const fixed = javaMolangToBedrock(broken, true);
		assert.ok(fixed.reason, `mudou: ${broken}`);
		assert.equal(checkBedrockMolang(fixed.expr), undefined, `válido: ${fixed.expr}`);
		for (const t of [0, 0.3, 1.7]) assert.ok(Math.abs(at(fixed.expr, t) - at(meaning, t)) < 1e-9, `${broken} em t=${t}`);
	}
	// Precedência do Java: || liga mais forte que && (medido: "1 && 0 || 1" = 1, "0 || 1 && 0" = 0).
	assert.equal(javaMolangToBedrock("0 || 1 && 0").expr, "(0 || 1) && 0");
	assert.equal(javaMolangToBedrock("v.a && v.b || v.c").expr, "v.a && (v.b || v.c)");
	// Expressão que o Bedrock já lê igual fica com o texto original.
	const same = "math.sin(q.anim_time*90*2-40)*3 + v.x";
	assert.deepEqual(javaMolangToBedrock(same, true), { expr: same });
	// Condição de pose do metagross: o Java para no ':'.
	assert.equal(javaMolangToBedrock("!q.in_air && q.riding_style != 'AIR': 1.0 ? 0.0", true).expr, "(!q.in_air) && (q.riding_style != 'AIR')");
	// Instrução da timeline: s.sound(...) vale 0 no Java.
	assert.equal(javaMolangToBedrock("s.sound('pokemon.torterra.cry', 1.0, 0.6);", false, "").expr, "0;");
}

// ---------------------------------------------------------------------------------------------
// 3. catmullrom com Molang → curva do Java em keyframes numéricos lineares.
{
	// Pontos colineares: a spline do Java é a própria reta.
	const line = { "0.0": { post: [0, "q.anim_time*10", 0], lerp_mode: "catmullrom" }, "1.0": { post: [10, "q.anim_time*10", 0], lerp_mode: "catmullrom" }, "2.0": { post: [20, "q.anim_time*10", 0], lerp_mode: "catmullrom" }, "3.0": { post: [30, "q.anim_time*10", 0], lerp_mode: "catmullrom" } };
	assert.deepEqual(javaChannelAt(line, 1.5)!.map((v) => +v.toFixed(6)), [15, 15, 0]);
	const baked = fixCatmullrom(line, "rotation", 3, "teste");
	for (const k of Object.values<any>(baked)) {
		assert.ok(Array.isArray(k) || (Array.isArray(k.pre) && Array.isArray(k.post)), "sem lerp_mode");
		assert.ok(JSON.stringify(k).match(/^[\[\]{}"prepost:,\d.\-e]*$/), `só números: ${JSON.stringify(k)}`);
	}
	for (let t = 0; t <= 3; t += 0.05) {
		const a = bedrockLinearAt(baked, t), b = javaChannelAt(line, t)!;
		for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.11, `t=${t}`);
	}
	// Depende de v.* (não dá para pré-calcular): fica linear com o Molang intacto.
	const vary = { "0.0": { post: ["v.x", 0, 0], lerp_mode: "catmullrom" }, "1.0": { post: [5, 0, 0], lerp_mode: "catmullrom" } };
	const lin = fixCatmullrom(vary, "rotation", 1, "teste");
	assert.deepEqual(lin, { "0.0": { post: ["v.x", 0, 0] }, "1.0": { post: [5, 0, 0] } });
	// Constante: continua catmullrom (o cliente aceita).
	const constant = { "0.0": { post: [0, 1, 0], lerp_mode: "catmullrom" }, "1.0": { post: [5, 0, 0], lerp_mode: "catmullrom" } };
	assert.equal(fixCatmullrom(constant, "rotation", 1, "teste"), constant);

	// Dado real: goldeen ground_walk (900 erros no log). A curva gerada segue a do Java dentro da tolerância.
	const src = json(join(UPSTREAM_ANIMS, "0118_goldeen", "goldeen.animation.json")).animations["animation.goldeen.ground_walk"];
	const bones = fixBones(JSON.parse(JSON.stringify(src.bones)), src.animation_length, "goldeen");
	for (const bone of ["tail_right1", "fin_left3"]) {
		const out = bones[bone].rotation;
		assert.ok(!JSON.stringify(out).includes("catmullrom") && !JSON.stringify(out).includes("q."), `${bone} sem Molang/catmullrom`);
		for (let t = 0; t <= src.animation_length; t += 0.01) {
			const a = bedrockLinearAt(out, t), b = javaChannelAt(src.bones[bone].rotation, t)!;
			for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.15, `${bone} t=${t.toFixed(2)} eixo ${i}: ${a[i]} vs ${b[i]}`);
		}
	}
	// Chaves que o cliente recusa dentro de bones: o Java as ignora.
	const cleaned = fixBones({ "_&/3%6-7A": { position: [0, 0, -0.1] }, torso: { rotation: [0, 1, 0], sound_effects: { "0.0": { effect: "x" } } } }, 1, "teste");
	assert.deepEqual(cleaned, { torso: { rotation: [0, 1, 0] } });
}

// ---------------------------------------------------------------------------------------------
// 4. Locators entre geometrias, armor_offset e identificador da geometria.
{
	const g0 = { bones: [{ name: "root_part" }, { name: "head", locators: { eye1: [1, 2, 3], item_hat: [0, 10, 0] } }] };
	const g1 = { bones: [{ name: "root_part" }, { name: "head", locators: { eye1: [1, 2, 3], item_hat: [0, 12, 0] } }, { name: "tail", locators: { tail_tip: [0, 1, 9], tail_tip2: [0, 0, 0] } }, { name: "tail2", locators: { tail_tip: [0, 2, 9] } }] };
	const reg = new Map<string, string>();
	assert.equal(dedupeLocators(g0, reg, "geometry.zorua").size, 0);
	const renamed = dedupeLocators(g1, reg, "geometry.zorua_hisuian");
	assert.deepEqual([...renamed], [["item_hat", "item_hat_zorua_hisuian"], ["tail_tip", "tail_tip_zorua_hisuian"]]);
	assert.deepEqual(Object.keys(g1.bones[1].locators!), ["eye1", "item_hat_zorua_hisuian"]); // igual fica
	assert.ok(pinArmorNeckLocator(g0) && pinArmorNeckLocator(g1));
	assert.deepEqual((g0.bones[0] as any).locators, (g1.bones[0] as any).locators);
	assert.ok(!GEOMETRY_ID.test("geometry.flabébé") && GEOMETRY_ID.test("geometry.flabebe") && GEOMETRY_ID.test("geometry.mr_mime-galar.v2"));
}

// ---------------------------------------------------------------------------------------------
// 5. Âncora do item segurado: busca binária (raichu tinha 263 ternários encadeados).
{
	const values = Array.from({ length: 264 }, (_, i) => (i % 3) + 0.5);
	const expr = String(perVariant(values));
	assert.equal(checkBedrockMolang(expr), undefined);
	for (const v of [0, 1, 2, 131, 262, 263]) {
		const p = parseJavaMolang(expr.replace(/v\.cobblemon_variant/g, String(v)))!;
		assert.equal(evalMolang(p.stmts[0], 0), values[v], `variante ${v}`);
	}
	assert.equal(perVariant([2, 2, 2]), 2);
}

// ---------------------------------------------------------------------------------------------
// 6. Validador: cada regra acusa o caso do log (docs sintéticos).
{
	const errs: string[] = [];
	const docs = new Map<string, any>([
		["/rp/models/a.geo.json", { "minecraft:geometry": [{ description: { identifier: "geometry.flabébé" }, bones: [{ name: "b", locators: { x: [0, 0, 0] } }] }] }],
		["/rp/models/b.geo.json", { "minecraft:geometry": [{ description: { identifier: "geometry.b" }, bones: [{ name: "b", locators: { x: [1, 0, 0] } }, { name: "c", locators: { y: [0, 0, 0] } }, { name: "d", locators: { y: [0, 1, 0] } }] }] }],
		["/rp/animations/a.json", { animations: { "animation.a": { bones: { bad: { rotation: { "0.0": { post: ["q.anim_time", 0, 0], lerp_mode: "catmullrom" }, "1.0": [0, 0, 0] }, position: ["NaN-1", 0, 0], sound_effects: {} }, "_&/3%6-7A": { position: [0, 0, 0] } } } } }],
		["/rp/animation_controllers/a.json", { animation_controllers: { "controller.animation.a": { states: { s: { animations: [], transitions: [{ s: "v.x: 1 ? 0" }] } } } } }],
		["/rp/render_controllers/a.json", { render_controllers: { "controller.render.a": { geometry: "Geometry.default", textures: ["Texture.default"] } } }],
		["/rp/entity/a.json", { "minecraft:client_entity": { description: { identifier: "x:a", geometry: { g0: "geometry.flabébé", g1: "geometry.b" }, render_controllers: ["controller.render.a"], scripts: { pre_animation: ["v.a = speed*2;"] } } } }],
	]);
	validateClientModels(docs, (m) => errs.push(m), (f) => f);
	const has = (re: RegExp) => assert.ok(errs.some((e) => re.test(e)), `acusa ${re}: ${errs.join("\n")}`);
	has(/identificador de geometria inválido.*flabébé/);
	has(/catmullrom com Molang/);
	has(/Molang recusado.*NaN-1/);
	has(/Molang recusado.*speed\*2/);
	has(/Molang recusado.*v\.x: 1 \? 0/);
	has(/'bad\.sound_effects' não é canal/);
	has(/osso '_&\/3%6-7A' inválido/);
	has(/"animations": \[\]/);
	has(/locator 'x' de g1/);
	has(/locator 'y' repetido/);
	has(/usa geometry\.default, que a client entity não declara/);
}

// ---------------------------------------------------------------------------------------------
// 7. generated/: zero violações e os casos do log corrigidos.
if (existsSync(GEN_RP)) {
	const flabebe = json(join(GEN_RP, "models", "entity", "pokemon", "0669_flabebe", "flabebe.geo.json"))["minecraft:geometry"][0].description.identifier;
	assert.ok(GEOMETRY_ID.test(flabebe), flabebe);
	assert.equal(json(join(GEN_RP, "entity", "pokemon", "flabebe.entity.json"))["minecraft:client_entity"].description.geometry.g0, flabebe);
	const weezing = json(join(GEN_RP, "animation_controllers", "pokemon", "weezing.animation_controllers.json")).animation_controllers["controller.animation.cobblemon.weezing"].states.battle_sleep;
	assert.ok(!("animations" in weezing) || weezing.animations.length > 0);
	const goldeen = json(join(GEN_RP, "animations", "pokemon", "goldeen.animation.json")).animations["animation.goldeen.ground_walk"];
	assert.ok(!JSON.stringify(goldeen.bones.tail_right1).includes("catmullrom"));
	const anchor = JSON.stringify(json(join(GEN_RP, "animations", "pokemon", "_generated", "raichu_held.animation.json")));
	assert.ok(anchor.includes("v.cobblemon_variant <") && !anchor.includes("v.cobblemon_variant =="));
}

process.stdout.write("cliente-modelos: ok\n");
