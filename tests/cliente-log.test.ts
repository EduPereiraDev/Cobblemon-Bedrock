// Frente "cliente-log": regras que só o cliente Bedrock confere (o BDS não carrega o RP) e desempenho do spawner.
// Cada teste pega a regressão de uma categoria do content log do cliente sem precisar do jogo
// (docs/pendencias/cliente-log.md). API do Minecraft mockada.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { system } from "@minecraft/server";
import {
	BLOCK_GEO_MAX_LENGTH, checkBlockGeometry, checkParticle, checkScatterFeatureMolang, checkSoundDefinitions, heightDependsOnXz,
	LEVEL_SOUND_EVENTS, particleMolangProblems,
} from "../tools/importer/clientRules.ts";
import { fitBerryGrowthGeometry } from "../tools/importer/blocks.ts";
import { clientSafeParticle, flattenParticleSounds, particleSoundDefinition, repairParticleMolang } from "../tools/importer/particles.ts";
import { BEST_SPAWNER_CONFIG } from "../generated/scripts/spawns";
import { selectSpawnActions, selectSpawnActionsJob, warmSpawnIndex } from "../scripts/spawning/SpawnSelector";
import { CellInfo, makeHasSpace, makeHasSpaceJob, ZoneBlockCache } from "../scripts/spawning/Spawner";
import { PARTICLE_SOUNDS } from "../generated/scripts/particleSounds";
import { playParticleSounds } from "../scripts/visual/ParticleSounds";

console.warn = () => { };
const ROOT = process.cwd();
let failed = 0;
function test(name: string, fn: () => void) {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (e) {
		failed++;
		console.error(`FALHOU - ${name}\n${(e as Error).stack}`);
	}
}
const parseLoose = (text: string) => JSON.parse(text.replace(/^﻿/, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));

// ---------------------------------------------------------------------------------------------------------------
// 1. Sons (224 × "Invalid asset path sounds/pokemon/<x>/<x>_cry")
test("sound_definitions escrito à mão: toda definição tem arquivo no pack", () => {
	const hand = parseLoose(readFileSync(join(ROOT, "resource_packs/CobblemonBedrock/sounds/sound_definitions.json"), "utf8")).sound_definitions;
	const exists = (n: string) => ["resource_packs/CobblemonBedrock", "generated/resource_packs/CobblemonBedrock"].some((r) => [".ogg", ".wav", ".fsb"].some((e) => existsSync(join(ROOT, r, `${n}${e}`))));
	assert.deepEqual(checkSoundDefinitions(hand, exists), []);
	// Os usados por script continuam (BagItems, BattleInterpreter, pokeballs.ts).
	for (const k of ["medicine_spray.use", "medicine_pills.use", "berry.eat", "poke_ball.shake"]) assert.ok(hand[k], k);
	// Regressão: os gritos legados do CobbleBuild (arquivo inexistente) saíram.
	assert.equal(hand["pokemon.bulbasaur.cry"], undefined);
});
test("checkSoundDefinitions acusa arquivo inexistente (regra do validate na árvore mesclada)", () => {
	const p = checkSoundDefinitions({ "pokemon.absol.cry": { sounds: [{ name: "sounds/pokemon/absol/absol_cry" }] }, ok: { sounds: ["sounds/x"] } }, (n) => n === "sounds/x");
	assert.equal(p.length, 1);
	assert.match(p[0], /Invalid asset path.*absol_cry/);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Geometria de bloco (16 berries: "Total length of parts ... greater than 1 + 14/16ths" / "boxes outside the error bounds")
const box = (origin: number[], size: number[], extra: Record<string, unknown> = {}) => ({ origin, size, uv: {}, ...extra });
test("checkBlockGeometry: limites do cliente (30 px por eixo; -14..30 em y, -22..22 em x/z) com rotação", () => {
	assert.deepEqual(checkBlockGeometry([{ name: "a", cubes: [box([-8, 0, -8], [16, 30, 16])] }]).problems, []);
	assert.equal(checkBlockGeometry([{ name: "a", cubes: [box([-8, 0, -8], [16, 30.5, 16])] }]).problems.length, 2); // extensão e caixa
	// Extensão sem caixa fora: -2..29 (31 px) — o caso de mago/nanab (muda abaixo do chão + arbusto alto).
	const len = checkBlockGeometry([{ name: "a", cubes: [box([-1, -2, -1], [2, 4, 2]), box([-8, 0, -8], [16, 29, 16])] }]);
	assert.equal(len.outside, 0);
	assert.ok(len.length[1] > BLOCK_GEO_MAX_LENGTH);
	// Wacan: 28 px sem rotação, recusado pelo cliente — a rotação conta.
	const rotated = checkBlockGeometry([{ name: "a", pivot: [0, 28, 0], rotation: [22.5, 0, 0], cubes: [box([-7, 28, 0], [14, 0, 7])] }, { name: "b", cubes: [box([-8, 0, -8], [16, 28, 16])] }]);
	assert.ok(rotated.max[1] > 30, `máx y ${rotated.max[1]}`);
});
test("geometrias de berry geradas cabem nos limites do cliente", () => {
	const dir = join(ROOT, "generated/resource_packs/CobblemonBedrock/models/blocks/cobblemon");
	let n = 0;
	for (const b of ["mago", "grepa", "chople", "tamato", "yache", "chilan", "kebia", "lum", "apicot", "wacan", "pamtre", "occa", "nanab", "pinap", "rindo", "iapapa"]) {
		const f = join(dir, `${b}_berry_growth.geo.json`);
		assert.ok(existsSync(f), f);
		const g = JSON.parse(readFileSync(f, "utf8"))["minecraft:geometry"][0];
		assert.deepEqual(checkBlockGeometry(g.bones).problems, [], b);
		n++;
	}
	assert.equal(n, 16);
});
test("fitBerryGrowthGeometry: tira pontos altos demais, ergue a muda e escala o resto", () => {
	const bones: any[] = [{ name: "bush", pivot: [0, 0, 0], cubes: [box([-8, 0, -8], [16, 8, 16])] }, { name: "berry_fruit", pivot: [0, 0, 0] }, { name: "berry_flower", pivot: [0, 0, 0] }, { name: "berry_sprout", pivot: [0, 0, 0] }];
	for (let i = 0; i < 10; i++) {
		const y = 12 + i * 4; // pinap: coluna de 10 pontos até 48 px
		bones.push({ name: `berry_fruit_${i}`, parent: "berry_fruit", pivot: [0, y, 0] }, { name: `berry_fruit_${i}_x`, parent: `berry_fruit_${i}`, pivot: [0, y, 0], cubes: [box([-1, y - 2, -1], [2, 3.5, 2])] });
		bones.push({ name: `berry_flower_${i}`, parent: "berry_flower", pivot: [0, y, 0] }, { name: `berry_flower_${i}_x`, parent: `berry_flower_${i}`, pivot: [0, y, 0], cubes: [box([-1, y - 1, -1], [2, 2, 2])] });
	}
	bones.push({ name: "berry_sprout_0", parent: "berry_sprout", pivot: [0, 2, 0], cubes: [box([-1, -2, -1], [2, 4, 2])] });
	fitBerryGrowthGeometry("cobblemon:teste_berry", bones, false);
	assert.deepEqual(checkBlockGeometry(bones).problems, []);
	const kept = bones.filter((b) => /^berry_fruit_\d+$/.test(b.name)).length;
	assert.ok(kept >= 4 && kept < 10, `pontos mantidos: ${kept}`);
	// Os mais baixos ficam (growthPoints fixos: o Java enche na ordem).
	assert.ok(bones.some((b) => b.name === "berry_fruit_0"));
	assert.ok(!bones.some((b) => b.name === "berry_fruit_9"));
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Features ("q.heightmap(v.worldx, v.worldz) | unknown variable 'variable.worldx'", 14.579 linhas)
test("scatter/feature rule: v.worldx só depois de avaliado (coordinate_eval_order)", () => {
	const y = "q.heightmap(v.worldx, v.worldz)";
	assert.ok(heightDependsOnXz(y));
	assert.ok(!heightDependsOnXz({ distribution: "uniform", extent: [-64, 0] }));
	assert.equal(checkScatterFeatureMolang({ coordinate_eval_order: "zyx", x: 0, y, z: 0 }).length, 1); // só worldx falta (z já foi)
	assert.deepEqual(checkScatterFeatureMolang({ coordinate_eval_order: "xzy", x: 0, y, z: 0 }), []);
	assert.deepEqual(checkScatterFeatureMolang({ x: 0, y, z: 0 }), []); // padrão "xzy"
	assert.equal(checkScatterFeatureMolang({ iterations: "v.worldx > 0 ? 1 : 2", x: 0, y: 0, z: 0 }).length, 1);
});
test("feature rules geradas não usam v.worldx/v.worldz antes da hora", () => {
	const dir = join(ROOT, "generated/behavior_packs/CobblemonBedrock/feature_rules/cobblemon");
	for (const name of ["medicinal_leek", "apricorn_trees_dense", "apricorn_trees_normal", "berry_grove_oran_berry", "structure_fossils_prehistoric_lush_den"]) {
		const f = join(dir, `${name}.json`);
		assert.ok(existsSync(f), f);
		const r = JSON.parse(readFileSync(f, "utf8"))["minecraft:feature_rules"];
		assert.deepEqual(checkScatterFeatureMolang(r.distribution), [], name);
	}
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Partículas (72 × "is not a valid LevelSoundEvent", colisão, flipbook, Molang, componentes cobblemon:*)
test("LevelSoundEvents: lista vanilla (sounds.json) e nomes de sound_definitions fora dela", () => {
	for (const ok of ["block.beehive.drip", "drip.lava.pointed_dripstone", "shear", "explode"]) assert.ok(LEVEL_SOUND_EVENTS.has(ok), ok);
	for (const bad of ["mob.sheep.shear", "cobblemon.move.bite.target", "status.up.actor", "random.explode"]) assert.ok(!LEVEL_SOUND_EVENTS.has(bad), bad);
});
test("Molang de partícula: o que o Bedrock recusa e o conserto", () => {
	const cases: Array<[string, string]> = [
		["(v.entity_height*(0.7-(v.particle_random_4*0.15)))*math.clamp(v.entity_scale,0.5,1))", "(v.entity_height*(0.7-(v.particle_random_4*0.15)))*math.clamp(v.entity_scale,0.5,1)"],
		["-(v.entity_radius*0.7))", "-(v.entity_radius*0.7)"],
		["math.clamp((v.entity_radius*0.7)-(v.emitter_age*0.2),0.55,1.05)-(v.emitter_age*0.3),0.75,1.35)", "math.clamp((v.entity_radius*0.7)-(v.emitter_age*0.2),0.55,1.05)-(v.emitter_age*0.3)"],
	];
	for (const [bad, fixed] of cases) {
		assert.ok(particleMolangProblems(bad).length > 0, bad);
		assert.equal(repairParticleMolang(bad), fixed);
		assert.deepEqual(particleMolangProblems(fixed), []);
	}
	const max = repairParticleMolang("v.clampradius = math.max(1.65,v.entity_height,v.entity_width,v.entity_radius));");
	assert.equal(max, "v.clampradius = math.max(1.65, math.max(v.entity_height, math.max(v.entity_width, v.entity_radius)));");
	assert.deepEqual(particleMolangProblems(max), []);
	assert.ok(particleMolangProblems("math.clamp(q.entity_radius,1.5,999)").length > 0);
});
test("clientSafeParticle: som vira cue do script, colisão/flipbook aceitos, filha com padrão das variáveis", () => {
	const p: any = {
		format_version: "1.10.0",
		particle_effect: {
			description: { identifier: "cobblemon:teste", basic_render_parameters: { material: "particles_alpha", texture: "textures/particle/x" } },
			components: {
				"cobblemon:emitter_space": { scaling: "entity" },
				"minecraft:emitter_lifetime_events": { creation_event: "snd", timeline: { "0.5": ["tesoura", "filha"] } },
				"minecraft:emitter_lifetime_once": { active_time: 1 },
				"minecraft:emitter_shape_sphere": { radius: "60*math.clamp(v.entity_width,1,3))" },
				"minecraft:particle_motion_collision": { expire_on_contact: true },
				"minecraft:particle_appearance_billboard": { size: [0.1, 0.1], uv: { texture_width: 16, texture_height: 128, flipbook: { base_UV: [0, "math.round(v.particle_random_2)*112"], size_UV: [16, 16], step_UV: [0, "-16 * (math.round(v.particle_random_2)*2-1)"], frames_per_second: 22, max_frame: 8, loop: "true" } } },
			},
			events: {
				snd: { sound_effect: { event_name: "cobblemon.move.bite.target" } },
				tesoura: { sound_effect: { event_name: "mob.sheep.shear" } },
				filha: { particle_effect: { effect: "cobblemon:outra", type: "emitter" } },
			},
		},
	};
	const { sounds, children } = clientSafeParticle(p, { child: true, knownSounds: new Set(["move.bite.target"]) });
	assert.deepEqual(checkParticle(p), []);
	assert.deepEqual(sounds, [{ t: 0, sounds: ["cobblemon.move.bite.target"] }, { t: 0.5, sounds: ["mob.sheep.shear"] }]);
	assert.deepEqual(children, [{ t: 0.5, effect: "cobblemon:outra" }]);
	const c = p.particle_effect.components;
	assert.equal(c["minecraft:particle_motion_collision"], undefined); // sem raio: o Cobblemon desliga a colisão
	assert.equal(c["cobblemon:emitter_space"], undefined);
	assert.ok(Array.isArray(c["minecraft:particle_appearance_billboard"].uv.uv)); // step_UV em Molang → UV por expressão
	assert.match(c["minecraft:emitter_initialization"].creation_expression, /v\.entity_width = v\.entity_width \?\? 1;/);
	// Cues das filhas somam o tempo do disparo.
	const flat = flattenParticleSounds(new Map([["cobblemon:teste", { sounds, children }], ["cobblemon:outra", { sounds: [{ t: 0.25, sounds: ["x"] }], children: [] }]]));
	assert.deepEqual(flat["cobblemon:teste"].map((s) => s.t), [0, 0.5, 0.75]);
	// Raio acima de 0.5 bloco e max_frame ausente.
	const q: any = { particle_effect: { components: { "minecraft:particle_motion_collision": { collision_radius: 5 }, "minecraft:particle_appearance_billboard": { uv: { texture_width: 99, texture_height: 9, flipbook: { base_UV: [0, 0], size_UV: [9, 9], step_UV: [9, 0], frames_per_second: 18 } } } } } };
	clientSafeParticle(q);
	assert.deepEqual(checkParticle(q), []);
	assert.equal(q.particle_effect.components["minecraft:particle_appearance_billboard"].uv.flipbook.max_frame, 11);
});
test("som de partícula: alias do Cobblemon, vanilla e mudo", () => {
	const known = new Set(["status.up.actor"]);
	assert.equal(particleSoundDefinition("status.up.actor", undefined, known), "cobblemon.status.up.actor");
	assert.equal(particleSoundDefinition("cobblemon.status.up.actor", undefined, known), "cobblemon.status.up.actor");
	assert.equal(particleSoundDefinition("mob.sheep.shear", undefined, known), "mob.sheep.shear");
	assert.equal(particleSoundDefinition("entity.generic.explode", undefined, known), "random.explode");
	assert.equal(particleSoundDefinition("nada.disso", undefined, known), undefined);
});
test("partículas geradas e à mão: nada que o cliente recuse", () => {
	const roots = ["generated/resource_packs/CobblemonBedrock/particles", "resource_packs/CobblemonBedrock/particles"];
	const bad: string[] = [];
	let n = 0;
	const walk = (d: string): string[] => readdirSync(d).flatMap((x) => (statSync(join(d, x)).isDirectory() ? walk(join(d, x)) : x.endsWith(".json") ? [join(d, x)] : []));
	for (const r of roots) for (const f of walk(join(ROOT, r))) {
		n++;
		for (const p of checkParticle(parseLoose(readFileSync(f, "utf8")))) bad.push(`${f.slice(ROOT.length + 1)}: ${p}`);
	}
	assert.ok(n > 900, `partículas: ${n}`);
	assert.deepEqual(bad.slice(0, 10), []);
});
test("sons de partícula tocados pelo script (tabela gerada + playParticleSounds)", () => {
	assert.deepEqual(PARTICLE_SOUNDS["cobblemon:bite_target"], [[0, ["cobblemon.move.bite.target"]]]);
	assert.ok(PARTICLE_SOUNDS["cobblemon:poodle_hair_red"]?.every(([, s]) => s.includes("mob.sheep.shear")));
	const played: Array<[string, number]> = [];
	const timeouts: Array<[() => void, number]> = [];
	(system as any).runTimeout = (fn: () => void, ticks: number) => { timeouts.push([fn, ticks]); return 1; };
	const dim: any = { playSound: (s: string) => played.push([s, -1]) };
	playParticleSounds(dim, "cobblemon:absorb_actorhealtimer", { x: 0, y: 0, z: 0 });
	assert.equal(played.length + timeouts.length, 1);
	assert.equal(timeouts[0]?.[1], Math.round(0.91 * 20));
	timeouts[0][0]();
	assert.deepEqual(played.map((p) => p[0]), ["cobblemon.move.absorb.actor"]);
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Barcos ("cobblemon:apricorn_boat | geometry not found?")
test("client entities dos barcos apontam para geometria do pack", () => {
	const geos = new Set<string>();
	for (const f of ["boat", "chest_boat"]) {
		const j = JSON.parse(readFileSync(join(ROOT, `resource_packs/CobblemonBedrock/models/entity/boats/${f}.geo.json`), "utf8"));
		for (const g of j["minecraft:geometry"]) geos.add(g.description.identifier);
	}
	for (const b of ["apricorn_boat", "apricorn_chest_boat", "saccharine_boat", "saccharine_chest_boat"]) {
		const d = parseLoose(readFileSync(join(ROOT, `resource_packs/CobblemonBedrock/entity/boats/${b}.entity.json`), "utf8"))["minecraft:client_entity"].description;
		for (const g of Object.values<string>(d.geometry)) assert.ok(geos.has(g), `${b}: ${g}`);
	}
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Desempenho do spawner (19 × "[spawn] passe lento: 26–148 ms" no mundo hospedado pelo cliente)
test("seleção fatiada (runJob) = seleção síncrona, com fatias curtas", () => {
	const w = warmSpawnIndex();
	for (let r = w.next(); !r.done; r = w.next()) { }
	const dim: any = { id: "minecraft:overworld", containsBlock: () => false };
	const ctx = (i: number, biome: string): any => ({
		dimension: dim, location: { x: 100 + (i % 4) * 3 + 0.5, y: 70, z: 200 + Math.floor(i / 4) * 3 + 0.5 }, blockY: 69, positionType: i % 5 === 4 ? "surface" : "grounded", biome,
		baseBlock: i % 5 === 4 ? "minecraft:water" : "minecraft:grass_block", skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false,
		height: 8, depth: 3, fluid: i % 5 === 4 ? "water" : undefined, zoneHasAny: () => true, hasSpace: () => true,
	});
	const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	let spawned = 0;
	for (let run = 0; run < 12; run++) {
		const biome = ["cherry_grove", "plains", "forest", "river"][run % 4];
		const opts = (random: () => number) => ({ buckets: BEST_SPAWNER_CONFIG.worldBuckets, positionTypeWeights: BEST_SPAWNER_CONFIG.spawnablePositionTypeWeights, maxSpawns: 3, minDistanceBetweenEntities: 8, influences: [], random });
		const p1 = Array.from({ length: 12 }, (_, i) => ctx(i, biome));
		const p2 = Array.from({ length: 12 }, (_, i) => ctx(i, biome));
		const a = selectSpawnActions(p1, opts(seeded(run + 1)));
		const job = selectSpawnActionsJob(p2, opts(seeded(run + 1)));
		let slices = 0;
		let r = job.next();
		while (!r.done) { slices++; r = job.next(); }
		assert.ok(slices >= 12, `fatias: ${slices}`); // ao menos uma por posição
		assert.deepEqual(r.value.map((x) => [x.entry.id, p2.indexOf(x.ctx)]), a.map((x) => [x.entry.id, p1.indexOf(x.ctx)]));
		spawned += a.length;
	}
	assert.ok(spawned > 0);
});

test("hasSpace fatiado (entre leituras de bloco) = hasSpace síncrono", () => {
	// Leitura lenta de propósito (~0,2 ms): o gerador precisa ceder no meio da caixa.
	const solid = new Set(["12,65,21"]);
	const read = (x: number, y: number, z: number): CellInfo => {
		const until = Date.now() + 0.2;
		while (Date.now() < until) { /* custo de leitura */ }
		return y <= 64 || solid.has(`${x},${y},${z}`) ? { kind: "solid", typeId: "minecraft:stone" } : { kind: "air", typeId: "minecraft:air" };
	};
	for (const [x, z, w, h] of [[10, 20, 3, 3], [5, 5, 4, 5], [0, 0, 2, 2]]) {
		const sync = makeHasSpace(new ZoneBlockCache(read, 10000), x, 64, z, "grounded", undefined, 10)(w, h);
		const job = makeHasSpaceJob(new ZoneBlockCache(read, 10000), x, 64, z, "grounded", undefined, 10)(w, h, 0);
		let yields = 0;
		let step = job.next();
		while (!step.done) { yields++; step = job.next(); }
		assert.equal(step.value, sync, `${x},${z} ${w}x${h}`);
		if (w >= 3) assert.ok(yields > 0, "cede entre leituras");
	}
});

// ---------------------------------------------------------------------------------------------------------------
// Ferramenta: tools/client-log-summary.mjs
test("client-log-summary agrupa o content log por categoria e mensagem", () => {
	const dir = mkdtempSync(join(tmpdir(), "clog-"));
	const f = join(dir, "ContentLog.txt");
	const pre = "%APPDATA%/Minecraft Bedrock/Users/1/games/com.mojang/minecraftWorlds/abc=/resource_packs/CobblemonB/";
	writeFileSync(f, [
		`05:39:58[Json][error]-sounds/sound_definitions.json Invalid asset path sounds/pokemon/absol/absol_cry`, "",
		`05:39:58[Json][error]-sounds/sound_definitions.json Invalid asset path sounds/pokemon/aipom/aipom_cry`, "",
		`05:39:58[Sound][error]-particles/cobblemon/bite_target.particle.json | events | event_sound | Event name 'cobblemon.move.bite.target' is not a valid LevelSoundEvent`, "",
		`05:39:58[Animation][error]-${pre}animations/pokemon/zubat.animation.json | animations | animation.zubat.physical | Precomputed cubic interpolation requires keyframes have constant data`, "",
		`05:39:58[Sound][verbose]-ignorado`, "",
		`05:39:58[UI][error]-ui/x.json | Unknown properties found`, "",
	].join("\n"));
	const out = spawnSync(process.execPath, [join(ROOT, "tools/client-log-summary.mjs"), f, "--json", "--no-ui"], { encoding: "utf8" });
	assert.equal(out.status, 0, out.stderr);
	const j = JSON.parse(out.stdout);
	assert.deepEqual(j.totals, { "[Json][error]": 2, "[Sound][error]": 1, "[Animation][error]": 1 });
	const json = j.groups.find((g: any) => g.key.startsWith("[Json][error]"));
	assert.equal(json.count, 2);
	assert.deepEqual(json.subjects, ["sounds/pokemon/absol/absol_cry", "sounds/pokemon/aipom/aipom_cry"]);
	const anim = j.groups.find((g: any) => g.key.startsWith("[Animation]"));
	assert.match(anim.subjects[0], /^animations\/pokemon\/zubat\.animation\.json/); // caminho do pack tirado
});

if (failed) {
	console.error(`${failed} teste(s) falharam`);
	process.exit(1);
}
