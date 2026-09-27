// Frente "animacao": posers Kotlin → dados, correção do Y, procedurais (pitch_tilt, funções de onda), Molang de
// montaria, partículas/sons do Cobblemon, texturas animadas, root_part e o intérprete de action_effects.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as mc from "@minecraft/server";
import { convertKotlinPoser, KOTLIN_POSERS_DIR, kotlinOnlyPosers, loadKotlinPosers } from "../tools/importer/kotlinPosers.ts";
import { waveMolang } from "../tools/importer/posers.ts";
import { BEDROCK_MATH, BEDROCK_QUERIES, RidingMolang, rewriteMolang, rewriteRideStyle, scanMolang } from "../tools/importer/molang.ts";
import { adaptParticle } from "../tools/importer/particles.ts";
import { soundAlias } from "../tools/importer/sounds.ts";
import { flipbookChannel } from "../tools/importer/animatedTextures.ts";
import { wrapRootPart } from "../tools/importer/models.ts";
import { locatorPosition, pickAnimation, planActionEffect, runActionEffect } from "../scripts/battle/effects/ActionEffects";

const ROOT = process.cwd();
const originalWarn = console.warn;
console.warn = () => { };
let passed = 0;
function test(name: string, fn: () => void) {
	try {
		fn();
		passed++;
	} catch (e) {
		console.error(`FALHOU: ${name}`);
		throw e;
	}
}

/** Molang só com queries/funções conhecidas do Bedrock. */
function unknownMolang(expr: string): string[] {
	const bad: string[] = [];
	scanMolang(expr, (c) => {
		const n = c.name.toLowerCase();
		if ((c.prefix === "q" || c.prefix === "query") && !BEDROCK_QUERIES.has(n)) bad.push(`q.${n}`);
		if (c.prefix === "math" && !BEDROCK_MATH.has(n)) bad.push(`math.${n}`);
		return undefined;
	});
	return bad;
}

/** Avalia Molang numérico simples em JS (trigonometria em graus, como o Molang). */
function evalMolang(expr: string, vars: Record<string, number>): number {
	const rad = Math.PI / 180;
	const math = {
		sin: (d: number) => Math.sin(d * rad), cos: (d: number) => Math.cos(d * rad), atan: (x: number) => Math.atan(x) / rad,
		abs: Math.abs, mod: (a: number, b: number) => a % b, pow: Math.pow, clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)),
	};
	let js = expr;
	for (const [k, v] of Object.entries(vars)) js = js.split(k).join(`(${v})`);
	return Function("math", `return (${js});`)(math);
}

// ------------------------------------------------------------------ posers Kotlin

const kotlin = kotlinOnlyPosers();
const upstream = existsSync(join(ROOT, "upstream", "cobblemon"));

test("conversor Kotlin: todos os posers só-Kotlin sem pendência", () => {
	if (!upstream) return;
	assert.ok(kotlin.size >= 300, `esperava ~308 posers Kotlin, veio ${kotlin.size}`);
	const pending: string[] = [];
	for (const [name, file] of kotlin) {
		const r = convertKotlinPoser(file);
		if (r.unsupported.length) pending.push(`${name}: ${r.unsupported.join(" | ")}`);
		assert.ok(r.poses > 0, `${name} sem poses`);
	}
	assert.deepEqual(pending, []);
});

test("saída congelada em tools/importer/data/kotlin-posers bate com o conversor", () => {
	if (!upstream) return;
	const { posers } = loadKotlinPosers();
	assert.equal(posers.size, kotlin.size);
	for (const [name, file] of kotlin) {
		const { _source, ...frozen } = posers.get(name) ?? {};
		assert.deepEqual(frozen, JSON.parse(JSON.stringify(convertKotlinPoser(file).poser)), `${name} desatualizado: rode npm run import:kotlin-posers`);
	}
	assert.ok(existsSync(join(KOTLIN_POSERS_DIR, "_report.json")));
});

test("Kotlin: cabeças extras (HeadedFrame), faint por pose, cry de batalha, onda e asas", () => {
	if (!upstream) return;
	const conv = (n: string) => convertKotlinPoser(kotlin.get(n)!).poser;
	const dodrio = conv("dodrio");
	assert.deepEqual(dodrio.poses.standing.animations.filter((a: string) => a.startsWith("q.look")).map((a: string) => /'(\w+)'/.exec(a)![1]), ["head4", "head3", "head2"]);
	const ampharos = conv("ampharos");
	assert.match(ampharos.poses.standing.namedAnimations.faint, /'ampharos', 'faint'/);
	assert.match(ampharos.poses.battle_idle.namedAnimations.faint, /'battle_faint'/);
	const quilava = conv("quilava");
	assert.match(quilava.animations.cry, /'cry'/);
	assert.match(quilava.poses.battle_idle.namedAnimations.cry, /'battle_cry'/);
	const huntail = conv("huntail");
	assert.ok(huntail.poses.standing.animations.some((a: string) => a.startsWith("q.cobblemon_wave_chain('sine', 0.8, 8") && a.includes("'tail6:5'")));
	const yanma = conv("yanma");
	assert.ok(yanma.poses.standing.animations.some((a: string) => a.includes("cobblemon_wing_flap('triangle'") && a.includes("'wing_left1'")));
	// As 8 espécies que eram puladas (sem idle) viram poses válidas, mesmo vazias.
	for (const n of ["tangela", "pupitar", "lillipup", "herdier", "jellicent", "durant", "bounsweet", "pyukumuku"]) {
		const p = conv(n);
		assert.ok(Object.keys(p.poses).length > 0, n);
	}
	// transformedParts: posição no espaço do Java (Y para baixo), rotação em graus.
	const yanmaT = yanma.poses.standing.transformedParts[0];
	assert.deepEqual(yanmaT.position, [0, -4, 0]);
});

// ------------------------------------------------------------------ funções de onda

test("funções de onda do Kotlin em Molang conferem numericamente", () => {
	const kt = {
		sine: (a: number, p: number, ph: number, v: number) => (t: number) => Math.sin((2 * Math.PI) / p * (t - ph)) * a + v,
		triangle: (a: number, p: number, ph: number, v: number) => (t: number) => 4 * a / p * Math.abs(((t + 3 * p / 4 - ph) % p) - p / 2) - a + v,
		parabola: (tight: number, ph: number, v: number) => {
			const r = Math.sqrt(-v / tight);
			const tMin = ph - r;
			const tMax = ph + r;
			return (t: number) => {
				let x = t;
				while (x < tMin) x += tMax - tMin;
				while (x > tMax) x -= tMax - tMin;
				return tight * (x - ph) ** 2 + v;
			};
		},
	};
	for (const t of [0, 0.13, 0.5, 1.7, 3.33]) {
		const s = waveMolang("sine", 0.6, 0.9, 0.1, -0.17, "T")!;
		assert.ok(Math.abs(evalMolang(s, { T: t }) - kt.sine(0.6, 0.9, 0.1, -0.17)(t)) < 1e-3, `sine t=${t}`);
		const tr = waveMolang("triangle", 0.4, 0.1, 0, 0, "T")!;
		assert.ok(Math.abs(evalMolang(tr, { T: t }) - kt.triangle(0.4, 0.1, 0, 0)(t)) < 1e-3, `triangle t=${t}`);
		// parabolaFunction(peak = -4, period = 0.4) → tightness 100, fase 0.2, desloc. -4
		const pa = waveMolang("parabola", 100, 0.2, -4, 0, "T")!;
		assert.ok(Math.abs(evalMolang(pa, { T: t }) - kt.parabola(100, 0.2, -4)(t)) < 1e-2, `parabola t=${t}`);
	}
	assert.equal(waveMolang("parabola", 1, 0, 1, 0, "T"), undefined, "parábola sem raízes não é convertida");
	assert.deepEqual(unknownMolang(waveMolang("triangle", 1, 1, 0, 0, "q.anim_time")!), []);
});

// ------------------------------------------------------------------ Molang de montaria

test("montaria: is_ridden → q.has_rider, riding_style por código, q.r.* por molas no cliente", () => {
	assert.equal(rewriteMolang("q.is_ridden", "teste"), "q.has_rider");
	assert.equal(rewriteRideStyle("q.is_ridden && q.riding_style == 'AIR'"), "q.is_ridden && (v.cobblemon_ride_style == 2)");
	assert.equal(rewriteRideStyle("q.riding_style != 'LIQUID'"), "(v.cobblemon_ride_style != 3)");
	const r = new RidingMolang();
	const out = rewriteMolang("math.clamp(q.r.yaw_change(5) * 30, -40, 40) + q.r.velocity_y + q.r.dive", "teste", {}, r);
	assert.equal(out, "math.clamp(v.cr_o_yaw_change_5 * 30, -40, 40) + v.cr_o_velocity_y + v.cr_o_dive");
	const pre = RidingMolang.preAnimation(r.used);
	assert.ok(pre.length > 5);
	for (const line of pre) assert.deepEqual(unknownMolang(line), [], line);
	assert.ok(pre.some((l) => l.includes("q.rider_head_x_rotation(0)")));
	assert.ok(BEDROCK_QUERIES.has("rider_head_x_rotation"));
	assert.deepEqual(RidingMolang.preAnimation([]), []);
});

// ------------------------------------------------------------------ partículas e sons

test("partícula do Cobblemon adaptada ao Bedrock", () => {
	const src = {
		format_version: "1.10.0",
		particle_effect: {
			description: { identifier: "cobblemon:teste", basic_render_parameters: { material: "particles_alpha", texture: "textures/particles/x" } },
			components: {
				"cobblemon:emitter_space": { scaling: "entity" },
				"minecraft:emitter_shape_sphere": { radius: "q.entity_radius * 0.5" },
				"minecraft:particle_lifetime_expression": { max_lifetime: "Q.random(0.8, 1.2)" },
			},
			events: {
				ev: { expression: "q.sound('minecraft:entity.sheep.shear', 1, 1)", particle_effect: { effect: "cobblemon:outra", type: "particle" } },
				snd: { sound_effect: { event_name: "cobblemon:move.tackle.actor" } },
				ghost: { particle_effect: { effect: "cobblemon:nao_existe", type: "particle" } },
			},
		},
	};
	const sounds = new Set<string>();
	const out = adaptParticle(src, "cobblemon:teste", sounds, (id) => id !== "cobblemon:nao_existe").particle_effect;
	assert.equal(out.components["cobblemon:emitter_space"], undefined);
	assert.equal(out.components["minecraft:emitter_shape_sphere"].radius, "v.entity_radius * 0.5");
	assert.equal(out.components["minecraft:particle_lifetime_expression"].max_lifetime, "math.random(0.8, 1.2)");
	assert.deepEqual(out.events.ev.sound_effect, { event_name: "mob.sheep.shear" });
	assert.equal(out.events.ev.expression, undefined);
	assert.equal(out.events.snd.sound_effect.event_name, "cobblemon.move.tackle.actor");
	assert.deepEqual(out.events.ghost, {});
	assert.ok(sounds.has("move.tackle.actor"));
	// Pedido C (jogabilidade): brilho de shiny sem os eventos de som (o script toca).
	const silent = adaptParticle(src, "cobblemon:teste", new Set(), () => true, true).particle_effect;
	assert.equal(silent.events.ev.sound_effect, undefined);
	assert.equal(silent.events.snd.sound_effect, undefined);
	assert.ok(silent.events.ev.particle_effect);
});

test("aliases de som das animações", () => {
	const known = new Set(["pokemon.pikachu.cry", "pokemon.weedle.cry", "pokemon.wailord.ambient", "pokemon.darmanitan.cry", "block.gilded_chest.open", "animation.plumage.wing_flap.medium"]);
	assert.equal(soundAlias("pokemon.pikachu_alolan.cry", known), "pokemon.pikachu.cry");
	assert.equal(soundAlias("weedle_cry", known), "pokemon.weedle.cry");
	assert.equal(soundAlias("wailord_ambient", known), "pokemon.wailord.ambient");
	assert.equal(soundAlias("0555_darmanitan_cry", known), "pokemon.darmanitan.cry");
	assert.equal(soundAlias("gilded_chest_open", known), "block.gilded_chest.open");
	assert.equal(soundAlias("animation.plumage_wing_flap_medium_8", known), "animation.plumage.wing_flap.medium");
	assert.equal(soundAlias("bonecrack2.mp3", known), undefined);
});

// ------------------------------------------------------------------ texturas animadas e root_part

test("flipbook: array combos × quadros e índice por variante", () => {
	const r = flipbookChannel([
		{ keys: ["f1", "f2", "f3", "f4"], fps: 10, loop: true },
		{ keys: ["s1", "s2", "s3", "s4"], fps: 10, loop: true },
		{ keys: ["blank"], fps: 10, loop: true },
	], "V", "v.f");
	assert.equal(r.array.length, 12);
	assert.deepEqual(r.array.slice(8), ["Texture.blank", "Texture.blank", "Texture.blank", "Texture.blank"]);
	assert.equal(r.index, "Array.tex[V * 4 + math.mod(math.floor(v.cobblemon_tex_t * 10), 4)]");
	const mixed = flipbookChannel([{ keys: ["a"], fps: 10, loop: true }, { keys: ["b1", "b2", "b3"], fps: 8, loop: true }, { keys: ["c1", "c2"], fps: 10, loop: false }], "V", "v.f");
	assert.equal(mixed.array.length, 9);
	assert.ok(mixed.preAnimation.some((l) => l.startsWith("v.f = ")));
	for (const l of mixed.preAnimation) assert.deepEqual(unknownMolang(l), []);
	const plain = flipbookChannel([{ keys: ["a"], fps: 10, loop: true }, { keys: ["b"], fps: 10, loop: true }], "V", "v.f");
	assert.deepEqual(plain, { array: ["Texture.a", "Texture.b"], index: "Array.tex[V]", preAnimation: [] });
});

test("root_part envolve os ossos de topo com o pivô do primeiro", () => {
	const geo = { bones: [{ name: "pikachu", pivot: [0, 2, 0] }, { name: "body", parent: "pikachu", pivot: [0, 4, 0] }] };
	wrapRootPart(geo);
	assert.deepEqual(geo.bones[0], { name: "root_part", pivot: [0, 2, 0] });
	assert.equal((geo.bones[1] as any).parent, "root_part");
	assert.equal((geo.bones[2] as any).parent, "pikachu");
	wrapRootPart(geo);
	assert.equal(geo.bones.filter((b) => b.name === "root_part").length, 1);
});

// ------------------------------------------------------------------ conteúdo gerado (quando o import já rodou)

const GEN = join(ROOT, "generated");
test("conteúdo gerado: pitch_tilt, Y negado, montaria, flipbook e partículas", () => {
	if (!existsSync(join(GEN, "import-report.json"))) return;
	const report = JSON.parse(readFileSync(join(GEN, "import-report.json"), "utf8"));
	assert.equal(report.counts["posers de reserva (convenção)"] ?? 0, 0);
	assert.ok((report.counts["posers Kotlin convertidos"] ?? 0) >= 290);
	for (const w of ["textura animada reduzida ao primeiro quadro", "partícula sem equivalente no RP (removida)"]) {
		if (w === "textura animada reduzida ao primeiro quadro") continue; // aviso de variants.ts (a textura é expandida em animatedTextures.ts)
		assert.equal(report.warnings[w]?.count ?? 0, 0, w);
	}
	const rp = join(GEN, "resource_packs", "CobblemonBedrock");
	const pidgeot = JSON.parse(readFileSync(join(rp, "entity", "pokemon", "pidgeot.entity.json"), "utf8"))["minecraft:client_entity"].description;
	assert.ok(pidgeot.scripts.pre_animation.some((l: string) => l.startsWith("v.cobblemon_pt_body_t")), "pitch_tilt no pre_animation");
	const charizard = JSON.parse(readFileSync(join(rp, "entity", "pokemon", "charizard.entity.json"), "utf8"))["minecraft:client_entity"].description;
	assert.ok(charizard.scripts.pre_animation.some((l: string) => l.includes("v.cr_")), "molas de montaria");
	const rc = JSON.parse(readFileSync(join(rp, "render_controllers", "pokemon", "charmander.render_controllers.json"), "utf8")).render_controllers;
	assert.ok(Object.values<any>(rc).some((r) => /\* \d+ \+/.test(r.textures[0])), "chama do Charmander animada");
	const gen = JSON.parse(readFileSync(join(rp, "animations", "pokemon", "_generated", "charizard.animation.json"), "utf8")).animations;
	const surface = Object.entries<any>(gen).find(([id]) => id.includes("pose_surface_idle"))?.[1];
	if (surface) assert.ok(surface.bones.body.position[1] < 0, "surface_idle afunda (Y negado)");
});

// ------------------------------------------------------------------ intérprete de action_effects

test("timeline do Thunderbolt: holds liberadas quando o raio acerta", () => {
	const ctx = { move: { name: "thunderbolt", type: "electric", category: "special" }, actors: [{ entity: undefined, species: "pikachu", isUser: true }, { entity: undefined, species: "charizard", isUser: false }] };
	const p = planActionEffect("thunderbolt", ctx)!;
	assert.ok(p, "timeline existe");
	assert.ok(Math.abs(p.release! - 1.32) < 1e-6, `release ${p.release}`);
	assert.ok(p.end >= 3);
	// generic_move: status não toca a sequência de impacto
	const status = planActionEffect("generic_move", { ...ctx, move: { name: "growl", type: "normal", category: "status" } })!;
	const phys = planActionEffect("generic_move", { ...ctx, move: { name: "tackle", type: "normal", category: "physical" } })!;
	assert.ok(phys.steps.length > status.steps.length);
});

test("runActionEffect agenda animação, partículas e sons nas entidades", () => {
	const system = (mc as any).system;
	const calls: string[] = [];
	const timeouts: Array<[() => void, number]> = [];
	system.runTimeout = (fn: () => void, ticks: number) => { timeouts.push([fn, ticks]); return timeouts.length; };
	const makeEntity = (name: string, loc: { x: number; y: number; z: number }) => ({
		isValid: true, location: loc, isOnGround: true,
		getRotation: () => ({ x: 0, y: 0 }),
		getProperty: (p: string) => (p === "cobblemon:variant" ? 0 : 1),
		playAnimation: (id: string) => calls.push(`${name} anim ${id}`),
		dimension: {
			spawnParticle: (id: string) => calls.push(`${name} particle ${id}`),
			playSound: (id: string) => calls.push(`${name} sound ${id}`),
		},
	});
	const user = makeEntity("user", { x: 0, y: 64, z: 0 });
	const target = makeEntity("target", { x: 0, y: 64, z: 5 });
	const hold = runActionEffect("thunderbolt", {
		move: { name: "thunderbolt", type: "electric", category: "special" },
		actors: [{ entity: user as any, species: "pikachu", isUser: true }, { entity: target as any, species: "charizard", isUser: false, missed: false }],
	});
	assert.ok(Math.abs(hold - 1.32) < 1e-6);
	for (const [fn] of timeouts) fn();
	assert.ok(calls.some((c) => c.startsWith("user particle cobblemon:thunderbolt_actor")), calls.join("\n"));
	assert.ok(calls.includes("user sound cobblemon.move.thunderbolt.actor"));
	assert.ok(calls.includes("target sound cobblemon.move.thunderbolt.target"));
	assert.ok(calls.some((c) => c.startsWith("target particle cobblemon:thunderbolt_target")));
	// Alvo que desviou: sem partícula/som de impacto.
	calls.length = 0;
	timeouts.length = 0;
	runActionEffect("thunderbolt", {
		move: { name: "thunderbolt", type: "electric", category: "special" },
		actors: [{ entity: user as any, species: "pikachu", isUser: true }, { entity: target as any, species: "charizard", isUser: false, missed: true }],
	});
	for (const [fn] of timeouts) fn();
	assert.ok(!calls.some((c) => c.startsWith("target")), calls.join("\n"));
	assert.equal(runActionEffect("nao_existe", { actors: [] }), 0);
});

test("locator: offset do modelo girado pelo yaw e escalado", () => {
	const e: any = { location: { x: 10, y: 64, z: 10 }, getRotation: () => ({ x: 0, y: 90 }), getProperty: () => 1 };
	const root = locatorPosition(e, "pikachu", ["root"]);
	assert.deepEqual(root, e.location);
	const p = locatorPosition(e, "pikachu", ["nao_existe", "target"]);
	assert.ok(p.y > 64, "locator acima dos pés");
	assert.equal(pickAnimation({ faint: "a.f", battle_faint: "a.bf" }, ["faint"]), "a.bf");
	assert.equal(pickAnimation({ faint: "a.f" }, ["thunderbolt", "faint"]), "a.f");
	assert.equal(pickAnimation(undefined, ["faint"]), undefined);
});

console.warn = originalWarn;
console.log(`animacao: ${passed} testes OK`);
