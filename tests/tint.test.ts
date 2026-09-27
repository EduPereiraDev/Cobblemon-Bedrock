// Fechamento da frente visual-final (BDS `tint`): tinta vermelha do feixe de captura/recolha (PokemonRenderer,
// beamMode 3), papel de parede padrão do PC (wallpaper_basic_05) e ícone da strange_ball. Dados reais de generated/.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BEAM_TINT_PROPERTY, setBeamTint } from "../scripts/pokemon/BeamTint";
import { DEFAULT_WALLPAPER, JAVA_DEFAULT_WALLPAPER, boxWallpaperTexturePath, getBoxWallpaper } from "../scripts/GUI/PCWallpapers";
import {
	BEAM_TINT_DELAY_SECONDS, BEAM_TINT_FADE_SECONDS, BEAM_TINT_MAX_ALPHA, BEAM_TINT_MAX_SECONDS, BEAM_TINT_PROPERTY as IMPORTER_PROPERTY,
	beamTintOverlay, beamTintPreAnimation,
} from "../tools/importer/entities.ts";
import { capColor, recolorIcon } from "../tools/importer/legacyBallIcons.ts";
import { decodePng } from "../tools/importer/png.ts";
import { system } from "@minecraft/server";
import { runCaptureSequence } from "../scripts/catching/CaptureSequence";
import type { CaptureAttempt } from "../scripts/catching/CaptureSequence";
import { CAPTURE_TIMINGS } from "../scripts/catching/CaptureTimeline";

console.warn = () => { };
console.info = () => { };
console.log = () => { };

const ROOT = process.cwd();
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const HAND_BP = join(ROOT, "behavior_packs", "CobblemonBedrock");
const ASSETS = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "resources", "assets", "cobblemon");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const lenient = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));

// 1. Tinta do feixe: constantes do Cobblemon 1.8.2 (PokemonClientDelegate / PokemonRenderer.renderTransition).
{
	assert.equal(IMPORTER_PROPERTY, BEAM_TINT_PROPERTY, "script e importador usam a mesma propriedade");
	const kotlin = readFileSync(join(ROOT, "upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/client/entity/PokemonClientDelegate.kt"), "utf8");
	assert.match(kotlin, new RegExp(`BEAM_EXTEND_TIME = ${BEAM_TINT_DELAY_SECONDS}F`));
	assert.match(kotlin, new RegExp(`BEAM_SHRINK_TIME = ${BEAM_TINT_FADE_SECONDS}F`));
	const renderer = readFileSync(join(ROOT, "upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/client/render/pokemon/PokemonRenderer.kt"), "utf8");
	assert.ok(renderer.includes(`val colourValue = 1F - min(${BEAM_TINT_MAX_ALPHA}F, value)`));
	assert.ok(renderer.includes("modelNow.green = colourValue") && renderer.includes("modelNow.blue = colourValue"));

	// O Molang gerado, avaliado aqui, dá o mesmo verde/azul do Java: G' = G × (1 − a).
	const [timer, alpha] = beamTintPreAnimation();
	assert.ok(timer.includes(`q.property('${BEAM_TINT_PROPERTY}')`) && timer.includes("q.delta_time"));
	const molangAlpha = (t: number) => {
		const expr = alpha.replace(/^v\.cobblemon_beam_tint = /, "").replace(/;$/, "")
			.replace(/v\.cobblemon_beam_t/g, String(t)).replace(/math\.min/g, "Math.min");
		return Function(`return (${expr});`)() as number;
	};
	const javaGreen = (s: number) => s > BEAM_TINT_DELAY_SECONDS ? 1 - Math.min(BEAM_TINT_MAX_ALPHA, (s - BEAM_TINT_DELAY_SECONDS) / BEAM_TINT_FADE_SECONDS) : 1;
	for (const s of [0, 0.1, 0.2, 0.25, 0.3, 0.44, 0.6, 1.0, 1.5, 2.2])
		assert.ok(Math.abs((1 - molangAlpha(s)) - javaGreen(s)) < 1e-9, `verde/azul em ${s} s`);
	assert.equal(molangAlpha(BEAM_TINT_MAX_SECONDS + 1), 0, "trava contra propriedade presa");
	// Captura: o feixe visível dura 1,5 s (0,7 → 2,2 s) antes de o Pokémon sumir; a trava não corta nada disso.
	assert.ok(BEAM_TINT_MAX_SECONDS > 1.5);

	const overlay = beamTintOverlay();
	assert.ok(overlay.r.startsWith("v.cobblemon_beam_tint > 0 ? 1.0"));
	assert.ok(overlay.g.includes("? 0.0 : this") && overlay.b.includes("? 0.0 : this"));
	assert.ok(overlay.a.includes("? v.cobblemon_beam_tint : this"), "fora do feixe mantém o overlay do motor (flash de dano)");
}

// 2. Tinta: todas as entidades de Pokémon geradas (BP e RP) e o limite de 32 propriedades por entidade.
{
	let entities = 0, maxProps = 0;
	for (const f of readdirSync(join(GEN_BP, "entities", "pokemon"))) {
		const d = json(join(GEN_BP, "entities", "pokemon", f))["minecraft:entity"].description;
		assert.deepEqual(d.properties[BEAM_TINT_PROPERTY], { type: "bool", default: false, client_sync: true }, f);
		maxProps = Math.max(maxProps, Object.keys(d.properties).length);
		entities++;
		const id = d.identifier.replace("cobblemon:", "");
		const client = json(join(GEN_RP, "entity", "pokemon", `${id}.entity.json`))["minecraft:client_entity"].description;
		for (const line of beamTintPreAnimation()) assert.ok(client.scripts.pre_animation.includes(line), `${id}: pre_animation`);
		const rcs = json(join(GEN_RP, "render_controllers", "pokemon", `${id}.render_controllers.json`)).render_controllers;
		for (const [rcId, rc] of Object.entries<any>(rcs)) assert.deepEqual(rc.overlay_color, beamTintOverlay(), rcId);
	}
	assert.ok(entities > 850, `entidades: ${entities}`);
	assert.ok(maxProps <= 32, `propriedades por entidade: ${maxProps}`);
}

// 3. Tinta: liga/desliga pelo script (só em entidade com a propriedade).
{
	const props = new Map<string, unknown>([[BEAM_TINT_PROPERTY, false]]);
	const entity: any = { isValid: true, getProperty: (k: string) => props.get(k), setProperty: (k: string, v: unknown) => props.set(k, v) };
	assert.ok(setBeamTint(entity, true));
	assert.equal(props.get(BEAM_TINT_PROPERTY), true);
	assert.ok(setBeamTint(entity, false));
	assert.equal(props.get(BEAM_TINT_PROPERTY), false);
	// Bedrock: setProperty vale no fim do tick (getProperty do mesmo tick devolve o antigo; visto no BDS). Ligar e
	// desligar no mesmo tick tem de terminar desligado.
	const committed = new Map<string, unknown>([[BEAM_TINT_PROPERTY, false]]);
	const pending = new Map<string, unknown>();
	const deferred: any = { isValid: true, getProperty: (k: string) => committed.get(k), setProperty: (k: string, v: unknown) => pending.set(k, v) };
	setBeamTint(deferred, true);
	setBeamTint(deferred, false);
	for (const [k, v] of pending) committed.set(k, v);
	assert.equal(committed.get(BEAM_TINT_PROPERTY), false, "liga+desliga no mesmo tick");
	const npc: any ={ isValid: true, getProperty: () => undefined, setProperty: () => { throw new Error("sem propriedade"); } };
	assert.equal(setBeamTint(npc, true), false);
	assert.equal(setBeamTint({ isValid: false } as any, true), false);
	assert.equal(setBeamTint(undefined, true), false);

	// Pontos de uso: início do feixe da captura, escape (beamMode 2) e fim da sequência; recolha fora de batalha.
	const capture = readFileSync(join(ROOT, "scripts", "catching", "CaptureSequence.ts"), "utf8");
	const beamUp = capture.slice(capture.indexOf("async function beamUp"), capture.indexOf("function groundBelow"));
	assert.ok(beamUp.includes("setBeamTint(shown, true)"));
	const breakFree = capture.slice(capture.indexOf("function breakFree"), capture.indexOf("function breakFree") + 600);
	assert.ok(breakFree.includes("clearBeamTint(attempt)"));
	const finallyBlock = capture.slice(capture.lastIndexOf("finally {"));
	assert.ok(finallyBlock.includes("clearBeamTint(attempt)"));
	const recall = readFileSync(join(ROOT, "scripts", "pokemon", "SendOutAnimation.ts"), "utf8");
	assert.ok(recall.indexOf("setBeamTint(entity, true)") < recall.indexOf("animatedRecall(entity"), "liga antes do feixe");
}

// 4. PC: caixa sem escolha mostra o padrão do Java (PCBoxWallpaperRepository.defaultWallpaper), com a glow.
{
	const kotlin = readFileSync(join(ROOT, "upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/client/render/gui/PCBoxWallpaperRepository.kt"), "utf8");
	assert.ok(kotlin.includes('val defaultWallpaper = cobblemonResource("textures/gui/pc/wallpaper/basic/wallpaper_basic_05.png")'));
	assert.equal(JAVA_DEFAULT_WALLPAPER, "cobblemon:textures/gui/pc/wallpaper/basic/wallpaper_basic_05.png");
	const props = new Map<string, unknown>();
	const holder: any = { getDynamicProperty: (k: string) => props.get(k), setDynamicProperty: (k: string, v: unknown) => props.set(k, v) };
	assert.equal(getBoxWallpaper(holder, 0), DEFAULT_WALLPAPER, "o dado guardado continua o do PCBox (pc_screen_overlay)");
	const path = boxWallpaperTexturePath(holder, 0);
	assert.equal(path, "textures/gui/pc/wallpaper/basic/wallpaper_basic_05");
	assert.ok(existsSync(join(GEN_RP, `${path}.png`)));
	assert.ok(existsSync(join(GEN_RP, "textures/gui/pc/wallpaper/basic/glow/wallpaper_basic_05.png")), "glow do papel padrão");
}

// 5. strange_ball: ícone no item_texture (o 1.8.2 não tem sprite; sai do ícone da poke_ball com a cor do modelo).
{
	const atlas = json(join(GEN_RP, "textures", "item_texture.json")).texture_data;
	for (const f of readdirSync(join(HAND_BP, "items", "pokeballs"))) {
		const item = lenient(join(HAND_BP, "items", "pokeballs", f))["minecraft:item"];
		const icon = item.components["minecraft:icon"];
		const key = typeof icon === "string" ? icon : icon?.texture ?? icon?.textures?.default;
		assert.ok(atlas[key], `${item.description.identifier}: ícone ${key} no item_texture`);
		assert.ok(existsSync(join(GEN_RP, `${atlas[key].textures}.png`)));
	}
	const pokeModel = decodePng(join(ASSETS, "textures/item/poke_balls/models/poke_ball.png"))!;
	const strangeModel = decodePng(join(ASSETS, "textures/item/poke_balls/models/strange_ball.png"))!;
	const red = capColor(pokeModel)!, teal = capColor(strangeModel)!;
	assert.ok(red.hue < 20 || red.hue > 340, `tampa da poke_ball vermelha (${red.hue})`);
	assert.ok(teal.hue > 150 && teal.hue < 190, `tampa da strange_ball verde-água (${teal.hue})`);
	const icon = decodePng(join(ASSETS, "textures/item/poke_balls/poke_ball.png"))!;
	const out = recolorIcon(icon, red, teal);
	let recolored = 0, kept = 0;
	for (let i = 0; i < icon.rgba.length; i += 4) {
		if (icon.rgba[i + 3] === 0) continue;
		const same = icon.rgba[i] === out.rgba[i] && icon.rgba[i + 1] === out.rgba[i + 1] && icon.rgba[i + 2] === out.rgba[i + 2];
		if (same) kept++; else recolored++;
		assert.equal(out.rgba[i + 3], icon.rgba[i + 3], "alfa preservado");
	}
	assert.ok(recolored > 30 && kept > 30, `tampa recolorida (${recolored}), base cinza/branca mantida (${kept})`);
}

// 6. Regressão (revisor): captura abortada no começo do raio. O encolhimento agendado (+4 a +12 ticks) não pode
// escrever depois do crescimento do breakFree (a escala ficava 0,05), e a tinta termina desligada.
{
	// Relógio falso: runTimeout por tick; setProperty só vale no fim do tick, como no Bedrock.
	let now = 0;
	const timers: Array<{ at: number; fn: () => void }> = [];
	const sys = system as unknown as Record<string, unknown>;
	sys.runTimeout = (fn: () => void, ticks = 1) => { timers.push({ at: now + Math.max(1, Math.round(ticks)), fn }); return timers.length; };
	sys.run = (fn: () => void) => (sys.runTimeout as (f: () => void, t: number) => number)(fn, 1);
	sys.runInterval = () => 0;
	sys.clearRun = () => { };
	const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
	const pendingCommits: Array<() => void> = [];
	const loose = <T extends object>(obj: T): T => new Proxy(obj, { get: (t, p) => (p in t ? (t as any)[p] : p === "then" ? undefined : () => undefined) });
	const dimension = loose({ playSound() { }, spawnParticle() { }, getBlockBelow: () => undefined, id: "minecraft:overworld" });
	function fakeEntity(id: string, props: Record<string, unknown> = {}) {
		const committed = new Map<string, unknown>(Object.entries(props));
		return loose({
			id, isValid: true, typeId: "cobblemon:bulbasaur", location: { x: 0, y: 64, z: 0 }, dimension, committed,
			getProperty: (k: string) => committed.get(k),
			setProperty: (k: string, v: unknown) => { pendingCommits.push(() => committed.set(k, v)); },
			getHeadLocation: () => ({ x: 0, y: 65, z: 0 }),
			getDynamicProperty: () => undefined, hasTag: () => false, getTags: () => [],
			getGameMode: () => "Creative",
		});
	}
	async function advance(ticks: number) {
		for (let i = 0; i < ticks; i++) {
			now++;
			for (const t of timers.filter((x) => x.at === now)) t.fn();
			await flush();
			for (const commit of pendingCommits.splice(0)) commit();
		}
	}

	for (const abortAt of [0, 1, 2, 3, 5, 8]) {
		const base = 1.25;
		const target = fakeEntity(`target-${abortAt}`, { "cobblemon:scale_modifier": base, [BEAM_TINT_PROPERTY]: false, "cobblemon:busy": false });
		const ball = fakeEntity(`ball-${abortAt}`);
		const thrower = fakeEntity(`thrower-${abortAt}`);
		const attempt = { thrower, ballEntity: ball, target, ball: { id: "cobblemon:poke_ball", ancient: false }, calculate: () => { throw new Error("não calcula"); } } as unknown as CaptureAttempt;
		const run = runCaptureSequence(attempt, { x: 0.5, y: 0, z: 0.5 });
		// Até o raio começar (bounceBack), e mais `abortAt` ticks dentro dele.
		await advance(CAPTURE_TIMINGS.beamStart + 1);
		assert.equal(target.committed.get(BEAM_TINT_PROPERTY), true, `tinta ligada no raio (abort em +${abortAt})`);
		await advance(abortAt);
		(ball as { isValid: boolean }).isValid = false; // a bola some → abort("raio") → finally → breakFree
		await advance(60);
		assert.equal(await run, false);
		assert.equal(target.committed.get("cobblemon:scale_modifier"), base, `escala final = original (abort em +${abortAt})`);
		assert.equal(target.committed.get(BEAM_TINT_PROPERTY), false, `tinta desligada (abort em +${abortAt})`);
		assert.equal(target.committed.get("cobblemon:busy"), false);
	}
}

process.stdout.write("tint: ok\n");
