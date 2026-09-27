// Frente "visual-final": sons/partículas da captura com ids do Cobblemon (#101), partículas do corte do Furfrou
// (#103), partículas de aspect e olhos do Alfa (#88/#104), dono em itálico no pasto, camada glow dos papéis de parede
// do PC, Healing Machine "natural" (#143) e o quirk do Nosepass (#144). Dados reais de generated/ e API mockada.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ANCIENT_HOP_LAND, BALL_LOCATOR_OFFSET, CAPTURE_SOUNDS, captureBeamRatio, captureSound, captureStepEffects,
} from "../scripts/catching/CaptureSequence";
import { buildCaptureTimeline } from "../scripts/catching/CaptureTimeline";
import { FURFROU_TRIMS, FURFROU_TRIM_PARTICLES, FURFROU_TRIM_PARTICLE_TICKS } from "../scripts/entity/Interactions";
import {
	ASPECT_PARTICLES, aspectParticlesFor, aspectsFromData, randomPointInHitbox, rollAspectParticles,
} from "../scripts/visual/AspectParticles";
import { POINT_TO_SPAWN_SPECIES, shouldPointToSpawn, spawnLookTarget } from "../scripts/visual/PointToSpawn";
import { SPECIES_AI } from "../generated/scripts/dadosIa";
import { pastureOwnerLine } from "../scripts/machines/pasture";
import { RESOURCE_WALLPAPERS, bedrockTexturePath } from "../scripts/GUI/PCWallpapers";
import { ALPHA_EYES_PARTICLE, ALPHA_EYES_SHORT, ALPHA_EYES_TIMES, alphaEyesAnimations, eyeLocatorsOf } from "../tools/importer/visualFinal.ts";

const ROOT = process.cwd();
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const HAND_RP = join(ROOT, "resource_packs", "CobblemonBedrock");
const UPSTREAM = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
/** JSON com comentários (arquivos à mão do RP). */
const lenient = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));

console.warn = () => { };
console.info = () => { };
console.log = () => { };

const soundDefs = new Set(Object.keys(json(join(GEN_RP, "sounds", "sound_definitions.json")).sound_definitions));
const particleIds = new Set<string>();
for (const dir of [join(GEN_RP, "particles", "cobblemon"), join(HAND_RP, "particles", "visual_batalha"), join(HAND_RP, "particles", "visual_final")]) {
	for (const f of readdirSync(dir)) {
		if (!f.endsWith(".json")) continue;
		particleIds.add(lenient(join(dir, f)).particle_effect.description.identifier);
	}
}
const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

// ---------------------------------------------------------------------------------------------
// 1. #101: sons da captura com prefixo cobblemon.* (existem no sound_definitions gerado)

{
	for (const [key, sound] of Object.entries(CAPTURE_SOUNDS)) {
		assert.ok(sound.startsWith("cobblemon.poke_ball."), `${key} com prefixo`);
		assert.ok(soundDefs.has(sound), `${sound} definido`);
	}
	for (const sound of [CAPTURE_SOUNDS.open, CAPTURE_SOUNDS.shut, CAPTURE_SOUNDS.bounceOnBlock, CAPTURE_SOUNDS.breakFree, CAPTURE_SOUNDS.captured, CAPTURE_SOUNDS.shake]) {
		assert.equal(captureSound(sound, true), `${sound}.ancient`);
		assert.ok(soundDefs.has(`${sound}.ancient`), `${sound}.ancient definido`);
		assert.equal(captureSound(sound, false), sound);
	}
	// shake.critical não tem variante ancient (a animação critical da ancient usa o comum).
	assert.equal(captureSound(CAPTURE_SOUNDS.critical, true), CAPTURE_SOUNDS.critical);

	// Nenhum id sem prefixo nem partícula vanilla na sequência.
	const source = readFileSync(join(ROOT, "scripts", "catching", "CaptureSequence.ts"), "utf8");
	assert.ok(!/"poke_ball\./.test(source), "sem ids sem prefixo");
	for (const vanilla of ["minecraft:endrod", "minecraft:villager_happy", "minecraft:white_smoke_particle", "minecraft:critical_hit_emitter"])
		assert.ok(!source.includes(vanilla), `sem ${vanilla}`);
	assert.ok(!/"poke_ball\./.test(readFileSync(join(ROOT, "scripts", "catching", "index.ts"), "utf8")), "index.ts sem ids sem prefixo");
}

// ---------------------------------------------------------------------------------------------
// 2. #101: efeitos das animações da bola (tempos do Cobblemon) com partículas importadas

{
	const ticks = (seconds: number) => Math.round(seconds * 20);
	const success = captureStepEffects("success", false);
	assert.deepEqual(success.map(e => [e.tick, e.sound ?? e.particle, e.locator]), [
		[ticks(0.034), CAPTURE_SOUNDS.captured, undefined],
		[ticks(0.0417), "cobblemon:capturesparks", "center"],
		[ticks(0.0417), "cobblemon:capturestar", "center"],
		[ticks(0.125), "cobblemon:afterspark", "center"],
	]);
	const ancient = captureStepEffects("success", true);
	assert.deepEqual(ancient.filter(e => e.particle).map(e => e.particle), [
		"cobblemon:hisuisendspark", "cobblemon:hisuipuff", "cobblemon:hisuitrail", "cobblemon:hisuispark", "cobblemon:hisuicapturestar", "cobblemon:hisuiafterspark",
	]);
	assert.equal(ancient[0].sound, "cobblemon.poke_ball.capture_succeeded.ancient");
	assert.ok(ancient.every(e => !e.particle || e.locator === "top"));

	// Pulos da ancient: shake.ancient + fumaça no início e land.ancient no pouso de cada pulo.
	for (const [hop, seconds] of Object.entries(ANCIENT_HOP_LAND)) {
		const effects = captureStepEffects("shake", true, `animation.ancient_poke_ball.${hop}`);
		assert.deepEqual(effects.map(e => e.sound ?? e.particle), ["cobblemon.poke_ball.shake.ancient", "cobblemon:ancient_pokeball_smoke", CAPTURE_SOUNDS.landAncient]);
		assert.equal(effects[2].tick, ticks(seconds), hop);
	}
	assert.deepEqual(captureStepEffects("shake", false, "animation.poke_ball.bob3").map(e => e.sound), [CAPTURE_SOUNDS.shake]);
	assert.deepEqual(captureStepEffects("critical", true).map(e => e.sound), [CAPTURE_SOUNDS.critical]);
	assert.deepEqual(captureStepEffects("bounce", true).map(e => e.sound), ["cobblemon.poke_ball.bounce.ancient"]);
	assert.deepEqual(captureStepEffects("break_free", false).map(e => e.sound), [CAPTURE_SOUNDS.breakFree]);

	// Todas as partículas e sons usados existem (partículas importadas pelo importador).
	const all = [
		...(["critical", "bounce", "shake", "success", "break_free"] as const).flatMap(k => [
			...captureStepEffects(k, false, "animation.poke_ball.bob1"), ...captureStepEffects(k, true, "animation.ancient_poke_ball.bighop"),
		]),
	];
	for (const e of all) {
		if (e.particle) assert.ok(particleIds.has(e.particle), `partícula ${e.particle} no RP`);
		if (e.sound) assert.ok(soundDefs.has(e.sound), `som ${e.sound}`);
	}
	assert.ok(particleIds.has("cobblemon:recall_beam"), "feixe vermelho (recall_beam)");
	assert.ok(particleIds.has("cobblemon:pokeball_casual_sendflash") && particleIds.has("cobblemon:ancientpokeball_casual_sendflash"), "sendflash casual ao escapar");
	assert.equal(BALL_LOCATOR_OFFSET.center, 4 / 16);
	assert.equal(BALL_LOCATOR_OFFSET.top, 8 / 16);

	// Crítica: a timeline continua batendo com o Java (critical no pouso, sem bounce).
	const steps = buildCaptureTimeline({ numberOfShakes: 1, isSucessfulCapture: true, isCriticalCapture: true } as never, false);
	assert.deepEqual(steps.map(s => s.kind), ["critical", "shake", "success"]);

	// Feixe (renderBeam): cresce em 0,2 s, fica, recolhe depois de 0,6 s em 0,2 s.
	assert.deepEqual([0, 2, 4, 8, 12, 14, 16, 20].map(captureBeamRatio), [0, 0.5, 1, 1, 1, 0.5, 0, 0]);
}

// ---------------------------------------------------------------------------------------------
// 3. #103: corte do Furfrou com poodle_hair_* (timeline do action effect furfrou_trim)

{
	assert.deepEqual(Object.keys(FURFROU_TRIM_PARTICLES).sort(), Object.keys(FURFROU_TRIMS).sort());
	assert.equal(FURFROU_TRIM_PARTICLES["minecraft:lime_dye"], "cobblemon:poodle_hair_green", "lime usa a verde, como no Cobblemon");
	for (const particle of Object.values(FURFROU_TRIM_PARTICLES)) assert.ok(particleIds.has(particle), particle);
	assert.deepEqual(FURFROU_TRIM_PARTICLE_TICKS, [0, 4, 14]);
	// Confere contra o action effect do Cobblemon.
	const timeline = json(join(UPSTREAM, "data", "cobblemon", "action_effects", "misc", "furfrou_trim.json")).timeline as { expressions?: string }[];
	for (const step of timeline) {
		const m = /is_of\('([\w:]+)'\).*spawn_bedrock_particles\('([\w:]+)'/.exec(step.expressions ?? "");
		if (m) assert.equal(FURFROU_TRIM_PARTICLES[m[1]], m[2], m[1]);
	}
	const interactions = readFileSync(join(ROOT, "scripts", "entity", "Interactions.ts"), "utf8");
	assert.ok(!interactions.includes("minecraft:villager_happy"), "sem partícula vanilla no corte");
}

// ---------------------------------------------------------------------------------------------
// 4. #88: partículas de aspect (AspectParticleMap)

{
	const raw = JSON.stringify({ species: "cobblemon:combee", nickname: "honey_drenched", aspects: ["male", "honey_drenched", "poke_snack_crumbed"] });
	assert.deepEqual(aspectsFromData(raw), ["male", "honey_drenched", "poke_snack_crumbed"]);
	assert.deepEqual(aspectsFromData(undefined), []);
	assert.deepEqual(aspectsFromData(JSON.stringify({ aspects: [] })), []);
	assert.deepEqual(aspectParticlesFor(["honey_drenched"]).map(p => p.particle), ["minecraft:honey_drip_particle"]);
	assert.deepEqual(aspectParticlesFor(["poke_snack_crumbed", "honey_drenched"]).map(p => p.particle), ["minecraft:honey_drip_particle", "cobblemon:poke_snack_crumbs"]);
	assert.deepEqual(aspectParticlesFor(["alpha_eyes", "has_nectar"]), []);
	// Chances e quantidades do Java.
	assert.deepEqual(ASPECT_PARTICLES.honey_drenched, { particle: "minecraft:honey_drip_particle", chance: 0.075, amount: 1 });
	assert.deepEqual(ASPECT_PARTICLES.poke_snack_crumbed, { particle: "cobblemon:poke_snack_crumbs", chance: 0.05, amount: 3 });
	assert.equal(rollAspectParticles(ASPECT_PARTICLES.poke_snack_crumbed, 2, seq([0.01, 0.9])), 3);
	assert.equal(rollAspectParticles(ASPECT_PARTICLES.honey_drenched, 2, seq([0.01, 0.07])), 2);
	assert.equal(rollAspectParticles(ASPECT_PARTICLES.honey_drenched, 2, seq([0.5])), 0);
	const p = randomPointInHitbox({ x: 10, y: 64, z: -5 }, 2, 3, seq([0, 1, 0.5]));
	assert.deepEqual(p, { x: 9, y: 67, z: -5 });
	// Partícula das migalhas: textura do Poké Snack do Cobblemon.
	assert.ok(particleIds.has("cobblemon:poke_snack_crumbs"));
	const crumbs = json(join(HAND_RP, "particles", "visual_final", "poke_snack_crumbs.particle.json"));
	assert.ok(existsSync(join(HAND_RP, `${crumbs.particle_effect.description.basic_render_parameters.texture}.png`)));
	// No Cobblemon os aspects saem na captura (remove_aspects) e o port faz o mesmo.
	const removeAspects = readFileSync(join(UPSTREAM, "data", "cobblemon", "callbacks", "pokemon_captured", "remove_aspects.molang"), "utf8");
	for (const aspect of Object.keys(ASPECT_PARTICLES)) assert.ok(removeAspects.includes(`'${aspect}'`), aspect);
	// alphaboost_* e heal_* não são acionados fora de batalha no 1.8.2: nenhuma referência fora das partículas.
	const kotlin = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "kotlin");
	const refs: string[] = [];
	const walk = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const f = join(dir, e.name);
			if (e.isDirectory()) walk(f);
			else if (/\.(kt|java|json|molang)$/.test(e.name) && !f.includes(join("bedrock", "particles"))) {
				const text = readFileSync(f, "utf8");
				if (/heal_circles|heal_sparkles|alphaboost/.test(text)) refs.push(f.replace(ROOT, ""));
			}
		}
	};
	walk(kotlin);
	walk(join(UPSTREAM, "data"));
	assert.deepEqual(refs.map(f => f.split("/").pop()), ["start_alphaboost.json"], "só a batalha usa alphaboost; heal_* não são usadas");
}

// ---------------------------------------------------------------------------------------------
// 5. #104: olhos do Alfa (animação gerada pelo importador, presa aos locators de olho)

{
	const geo = { bones: [{ name: "head", locators: { eye1: [1, 2, 3], nose: [0, 0, 0] } }, { name: "b", locators: { Eye_Left: { offset: [0, 0, 0] } } }] };
	assert.deepEqual(eyeLocatorsOf(geo), ["eye1", "Eye_Left"]);
	const locators = new Map([["geometry.a", ["eye1", "eye2"]], ["geometry.b", []], ["geometry.c", ["eye"]]]);
	const out = alphaEyesAnimations("test", [
		{ geometryId: "geometry.a", alpha: false },
		{ geometryId: "geometry.a", alpha: true },
		{ geometryId: "geometry.b", alpha: true },
		{ geometryId: "geometry.c", alpha: true },
	], { width: 1, height: 2, scale: 1.5 }, locators)!;
	assert.deepEqual(out.animations.map(a => a.variants), [[1], [3]], "só variantes com a camada e com olhos");
	assert.deepEqual(out.particle, [ALPHA_EYES_SHORT, ALPHA_EYES_PARTICLE]);
	const anim = out.file[out.animations[0].id] as { loop: boolean; particle_effects: Record<string, { effect: string; locator: string; pre_effect_script: string }[]> };
	assert.equal(anim.loop, true);
	assert.deepEqual(Object.keys(anim.particle_effects), ALPHA_EYES_TIMES, "5 por segundo por olho (0,25 × 20 ticks)");
	assert.deepEqual(anim.particle_effects["0.0"].map(e => e.locator), ["eye1", "eye2"]);
	assert.ok(anim.particle_effects["0.0"][0].pre_effect_script.includes("v.entity_size = 3;"));
	assert.equal(alphaEyesAnimations("none", [{ geometryId: "geometry.b", alpha: true }], undefined, locators), undefined);

	// Gerado: partícula importada e a client entity de uma espécie com camada alpha_eyes liga a animação.
	assert.ok(particleIds.has(ALPHA_EYES_PARTICLE) && particleIds.has("cobblemon:alpha_eyes_outer"), "alpha_eyes importada");
	const alphaEyes = json(join(GEN_RP, "particles", "cobblemon", "alpha_eyes.particle.json"));
	assert.ok(!JSON.stringify(alphaEyes).includes("q.entity_size"), "q.entity_size vira v.entity_size");
	const combee = json(join(GEN_RP, "entity", "pokemon", "combee.entity.json"))["minecraft:client_entity"].description;
	assert.equal(combee.particle_effects[ALPHA_EYES_SHORT], ALPHA_EYES_PARTICLE);
	const keys = Object.keys(combee.animations).filter(k => k.startsWith("cobblemon_alpha_eyes_"));
	assert.ok(keys.length >= 1, "combee com animação de olhos");
	const animate = combee.scripts.animate as (string | Record<string, string>)[];
	assert.ok(animate.some(a => typeof a === "object" && keys.includes(Object.keys(a)[0])), "animação condicionada à variante");
	const generated = readdirSync(join(GEN_RP, "animations", "pokemon", "_generated")).filter(f => f.endsWith("_alpha_eyes.animation.json"));
	assert.ok(generated.length > 500, `animações de olhos: ${generated.length}`);
}

// ---------------------------------------------------------------------------------------------
// 6. Pasto: dono em itálico

{
	assert.deepEqual(pastureOwnerLine("Steve"), { text: "\n§7§oSteve§r" });
}

// ---------------------------------------------------------------------------------------------
// 7. Papéis de parede do PC: camada glow (StorageWidget)

{
	const pc = lenient(join(HAND_RP, "ui", "pc.json"));
	const controls = pc.pc_content.controls as Record<string, any>[];
	const wallpaper = controls.find(c => c.wallpaper)!.wallpaper;
	assert.deepEqual([wallpaper.offset, wallpaper.size], [[0, 0], [174, 155]], "papel de parede na tela inteira");
	const glows = controls.filter(c => Object.keys(c)[0].startsWith("wallpaper_glow_")).map(c => Object.values(c)[0] as any);
	assert.equal(glows.length, 3);
	for (const glow of glows) {
		assert.deepEqual([glow.offset, glow.size], [[-17, -17], [208, 189]]);
		assert.ok(glow.layer > wallpaper.layer);
	}
	const grid = controls.find(c => c.grid)!.grid;
	assert.ok(grid.layer > glows[0].layer, "glow entre o papel e a grade");
	// Cada papel de parede (e o alt) cai numa das pastas e tem a glow no RP.
	for (const texture of RESOURCE_WALLPAPERS) {
		const path = bedrockTexturePath(texture);
		const folder = /wallpaper\/(\w+)\//.exec(path)![1];
		const expected = `textures/gui/pc/wallpaper/${folder}/glow/${path.split("/").pop()}`;
		assert.ok(existsSync(join(GEN_RP, `${expected}.png`)), expected);
		assert.ok(glows.some(g => g.bindings.some((b: any) => b.source_property_name?.includes(`'textures/gui/pc/wallpaper/${folder}/glow/'`))), folder);
	}
}

// ---------------------------------------------------------------------------------------------
// 8. #143: Healing Machine "natural" (modelos limited e drop de ferro)

{
	const block = json(join(GEN_BP, "blocks", "cobblemon", "healing_machine.json"))["minecraft:block"];
	assert.deepEqual(block.description.states["cobblemon:natural"], [false, true]);
	const perms = block.permutations as { condition: string; components: Record<string, any> }[];
	// healing_machine_limited_1..5 = mesma forma com a textura `healing_machine_limited`.
	const limited = perms.filter(p => JSON.stringify(p.components["minecraft:material_instances"] ?? {}).includes("cobblemon_block_functional_healing_machine_limited"));
	assert.equal(limited.length, 4 * 5, "5 modelos limited × 4 direções");
	const terrain = json(join(GEN_RP, "textures", "terrain_texture.json")).texture_data;
	assert.ok(existsSync(join(GEN_RP, `${terrain.cobblemon_block_functional_healing_machine_limited.textures}.png`)), "textura limited");
	assert.ok(limited.every(p => p.condition.includes("q.block_state('cobblemon:natural')") && !p.condition.includes("!q.block_state('cobblemon:natural')")));
	const loot = perms.find(p => p.components["minecraft:loot"]);
	assert.equal(loot?.components["minecraft:loot"], "loot_tables/blocks/healing_machine__natural_true.json");
	assert.ok(loot!.condition.includes("q.block_state('cobblemon:natural')"));
	assert.equal(block.components["minecraft:loot"], "loot_tables/blocks/healing_machine__natural_false.json");
	const natural = json(join(GEN_BP, "loot_tables", "blocks", "healing_machine__natural_true.json"));
	assert.equal(natural.pools[0].entries[0].name, "minecraft:iron_ingot");
}

// ---------------------------------------------------------------------------------------------
// 9. #144: Nosepass aponta para o spawn

{
	// Lista vinda do SPECIES_AI gerado (só o Nosepass tem point_to_spawn no 1.8.2).
	assert.deepEqual(POINT_TO_SPAWN_SPECIES, Object.keys(SPECIES_AI).filter(id => SPECIES_AI[id].pointToSpawn).map(id => `cobblemon:${id}`));
	assert.deepEqual(POINT_TO_SPAWN_SPECIES, ["cobblemon:nosepass"]);
	const nosepass = json(join(UPSTREAM, "data", "cobblemon", "species", "generation3", "nosepass.json"));
	assert.ok(JSON.stringify(nosepass.ai).includes("point_to_spawn"));
	const idle = { inBattle: false, sleeping: false, busy: false, riding: false, onShoulder: false, speed: 0 };
	assert.equal(shouldPointToSpawn(idle), true);
	for (const change of [{ inBattle: true }, { sleeping: true }, { busy: true }, { riding: true }, { onShoulder: true }, { speed: 0.2 }])
		assert.equal(shouldPointToSpawn({ ...idle, ...change }), false, JSON.stringify(change));
	assert.deepEqual(spawnLookTarget({ x: -3.7, y: 32767, z: 10.2 }, 71.4), { x: -3.5, y: 71.4, z: 10.5 });
}

process.stdout.write("visual-final: ok\n");
