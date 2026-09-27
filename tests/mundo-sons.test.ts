// Frente "mundo-sons": sons de bloco/máquina do Cobblemon, laços de som, partículas, redstone (botões, placas,
// Ring Target, panela), barcos e ataque a mobs hostis no pasto. API do Minecraft mockada.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { system } from "@minecraft/server";
import { setStorageBackend } from "../scripts/machines/store";
import { isMachineLoopActive, keepMachineLoop, LOOP_TICKS, machineSoundId, stopMachineLoop } from "../scripts/machines/common";
import { applyRedstoneLid, CookingPotState, potActivity } from "../scripts/machines/cooking";
import { closeTMLidOnFall, openTMMachine, tickTMMachines, tmStore } from "../scripts/machines/tm";
import { diskScreen, dnaInsertSound } from "../scripts/machines/fossils";
import { pastureAttackDamage } from "../scripts/machines/pastureLogic";
import { targetDuration, targetPower } from "../scripts/custom_components/RedstoneEvents";
import { BUTTON_SPECS, buttonSpec, pressButton } from "../scripts/custom_components/ButtonComponent";
import { boatSpawnPoint, rememberRemovedBoat, replacementForDrop } from "../scripts/items/boats";
import { spawnHealingSparkles } from "../scripts/custom_components/HealingMachineComponent";
import { MACHINE_BLOCK_COMPONENTS } from "../scripts/custom_components/machines";
import { LEAVES_LEFTOVERS, rollLeftovers } from "../scripts/custom_components/GiveLeftoversComponent";

console.warn = () => { };
const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
const mem = new Map<string, string>();
setStorageBackend({ get: id => mem.get(id), set: (id, v) => { if (v === undefined) mem.delete(id); else mem.set(id, v); }, ids: () => [...mem.keys()] });

// Agendador controlável (system.runTimeout / currentTick do mock).
const timeouts: { fn: () => void; ticks: number }[] = [];
const sys = system as unknown as Record<string, unknown>;
sys.runTimeout = (fn: () => void, ticks = 1) => { timeouts.push({ fn, ticks }); return timeouts.length; };
sys.runInterval = () => 0;
sys.clearRun = () => { };
const flush = () => { while (timeouts.length) timeouts.shift()!.fn(); };

interface FakeDim { id: string; sounds: string[]; commands: string[]; particles: string[]; playSound: (id: string) => void; runCommand: (c: string) => void; spawnParticle: (id: string) => void }
function fakeDimension(): FakeDim {
	const d: FakeDim = {
		id: "minecraft:overworld", sounds: [], commands: [], particles: [],
		playSound: id => { d.sounds.push(id); }, runCommand: c => { d.commands.push(c); }, spawnParticle: id => { d.particles.push(id); },
	};
	return d;
}
/** Permutação imutável como a do Bedrock (withState devolve outra). */
function fakePermutation(states: Record<string, unknown>): any {
	return {
		states,
		getState: (s: string) => states[s],
		withState: (s: string, v: unknown) => {
			if (!(s in states)) throw new Error(`estado ${s} inexistente`);
			return fakePermutation({ ...states, [s]: v });
		},
		getAllStates: () => states,
	};
}
function fakeBlock(typeId: string, states: Record<string, unknown>, dim = fakeDimension()) {
	const block: any = {
		typeId, isValid: true, location: { x: 1, y: 64, z: 2 }, dimension: dim, states: { ...states },
		get permutation() { return fakePermutation(block.states); },
		setPermutation: (p: any) => { block.states = { ...p.states }; },
		above: () => undefined,
	};
	return block;
}

// ---------------------------------------------------------------------------------------------
// 1. Sons de bloco: blocks.json/sounds.json do RP apontam para conjuntos e eventos que existem.
const SOUND_DEFS = "generated/resource_packs/CobblemonBedrock/sounds/sound_definitions.json";
const hasGenerated = existsSync(join(ROOT, SOUND_DEFS));
const defs: Record<string, unknown> = hasGenerated ? readJson(SOUND_DEFS).sound_definitions : {};
{
	const blocks = readJson("resource_packs/CobblemonBedrock/blocks.json");
	const sounds = readJson("resource_packs/CobblemonBedrock/sounds.json");
	const generatedBlocks = hasGenerated ? readJson("generated/resource_packs/CobblemonBedrock/blocks.json") : {};
	const sets = new Set<string>();
	assert.ok(!("format_version" in blocks), "o build concatenaria a lista format_version com a do gerado");
	for (const [id, entry] of Object.entries(blocks)) {
		const set = (entry as { sound: string }).sound;
		sets.add(set);
		assert.ok(sounds.block_sounds[set], `${id}: conjunto ${set} em block_sounds`);
		assert.ok(sounds.interactive_sounds.block_sounds[set], `${id}: conjunto ${set} em interactive_sounds`);
		if (hasGenerated) assert.ok(generatedBlocks[id], `${id} existe no blocks.json gerado`);
	}
	assert.ok(sets.size >= 20, "conjuntos custom do Cobblemon");
	assert.equal(blocks["cobblemon:tumblestone_block"].sound, "cobblemon.tumblestone_block");
	assert.equal(blocks["cobblemon:gilded_chest"].sound, "cobblemon.gilded_chest");
	assert.equal(blocks["cobblemon:campfire_pot_red"].sound, "cobblemon.campfire_pot");
	assert.equal(blocks["cobblemon:oran_berry"].sound, "cobblemon.berry_bush");
	assert.equal(blocks["cobblemon:cleanse_tag"].sound, "cobblemon.item_block_paper_small");
	// Todo som "cobblemon.*" citado existe nas definições importadas.
	const referenced = new Set<string>();
	for (const table of [sounds.block_sounds, sounds.interactive_sounds.block_sounds])
		for (const set of Object.values(table) as { events: Record<string, { sound?: string } | string> }[])
			for (const ev of Object.values(set.events)) if (typeof ev === "object" && ev.sound?.startsWith("cobblemon.")) referenced.add(ev.sound);
	assert.ok(referenced.size >= 50);
	if (hasGenerated) for (const s of referenced) assert.ok(defs[s], `som ${s} importado`);
}

// ---------------------------------------------------------------------------------------------
// 2. Sons de máquina: ids do Cobblemon (TM Machine não usa mais o som da panela).
{
	const ids = ["tmOpen", "tmClose", "tmStart", "tmBurn", "tmRetrieve", "tmItemInsert", "tmInsert", "tmCraft", "potSet", "potRetrieve",
		"potTakeItem", "potActive", "potAmbient", "monitorInsert", "monitorLoading", "monitorGlitching", "fossilLoop", "dnaInsertSmall", "healingActive", "pcOff"];
	for (const k of ids) {
		const id = machineSoundId(k);
		assert.ok(id.startsWith("cobblemon."), `${k} → ${id}`);
		if (hasGenerated) assert.ok(defs[id], `${id} importado`);
	}
	assert.equal(machineSoundId("tmOpen"), "cobblemon.block.tm_machine.open");
	for (const extra of ["cobblemon.block.apricorn.harvest", "cobblemon.pc.on", "cobblemon.pc.off", "cobblemon.poke_ball.send_out", "cobblemon.poke_ball.recall"])
		if (hasGenerated) assert.ok(defs[extra], `${extra} importado`);

	// Agachar na TM Machine: abre com tm_machine.open, fecha com tm_machine.close.
	const block = fakeBlock("cobblemon:tm_machine", { "cobblemon:open": false });
	const player: any = { isSneaking: true };
	await openTMMachine(player, block);
	assert.equal(block.states["cobblemon:open"], true);
	assert.deepEqual(block.dimension.sounds, ["cobblemon.block.tm_machine.open"]);
	await openTMMachine(player, block);
	assert.equal(block.dimension.sounds[1], "cobblemon.block.tm_machine.close");
	// Cair em cima da máquina aberta fecha a tampa (TMMachineBlock.fallOn); o componente tem onEntityFallOn.
	block.states["cobblemon:open"] = true;
	closeTMLidOnFall(block);
	assert.equal(block.states["cobblemon:open"], false);
	assert.equal(block.dimension.sounds.at(-1), "cobblemon.block.tm_machine.close");
	assert.ok(MACHINE_BLOCK_COMPONENTS["cobblemon:tm_machine"].onEntityFallOn);

	// Queima: burn_loop enquanto grava, cortado (stopsound) ao passar da queima.
	const tm = fakeBlock("cobblemon:tm_machine", { "cobblemon:active": false, "cobblemon:empty": true, "cobblemon:dispensed": false });
	const key = "minecraft:overworld|1|64|2";
	tmStore.set(key, { move: "tackle", progress: 0 });
	sys.currentTick = 1000;
	tickTMMachines(10, () => tm);
	assert.ok(tm.dimension.sounds.includes("cobblemon.block.tm_machine.burn_loop"));
	assert.ok(isMachineLoopActive(key, "tmBurn"));
	tickTMMachines(100, () => tm);
	assert.ok(!isMachineLoopActive(key, "tmBurn"));
	assert.ok(tm.dimension.commands.some((c: string) => c.startsWith("stopsound") && c.endsWith("cobblemon.block.tm_machine.burn_loop")));
	assert.ok(tm.dimension.sounds.includes("cobblemon.block.tm_machine.craft"));
	tmStore.delete(key);
}

// ---------------------------------------------------------------------------------------------
// 3. Laços de som: repetem ao fim da duração do .ogg e param com stopsound.
{
	const dim: any = fakeDimension();
	const at = { x: 0, y: 0, z: 0 };
	keepMachineLoop(dim, at, "k", "potActive", 0);
	keepMachineLoop(dim, at, "k", "potActive", 100);
	assert.equal(dim.sounds.length, 1, "não repete antes do fim");
	keepMachineLoop(dim, at, "k", "potActive", LOOP_TICKS.potActive);
	assert.equal(dim.sounds.length, 2);
	stopMachineLoop(dim, at, "k", "potActive");
	assert.equal(dim.commands.length, 1);
	stopMachineLoop(dim, at, "k", "potActive");
	assert.equal(dim.commands.length, 1, "parar de novo não repete o stopsound");
}

// ---------------------------------------------------------------------------------------------
// 4. Panela: redstone fecha/abre a tampa só na mudança do sinal; estado para os laços de som.
{
	const pot: CookingPotState = { pot: "cobblemon:campfire_pot_red", grid: new Array(9).fill(null), seasonings: [null, null, null], result: null, progress: 0, lid: false };
	assert.equal(potActivity(pot), "empty");
	pot.grid[0] = { id: "minecraft:carrot", n: 1 };
	assert.equal(potActivity(pot), "idle");
	assert.equal(applyRedstoneLid(pot, 15), "close");
	assert.equal(pot.lid, true);
	assert.equal(applyRedstoneLid(pot, 15), undefined, "sinal constante não mexe");
	pot.lid = false; // aberta pela tela com o sinal ligado: fica aberta
	assert.equal(applyRedstoneLid(pot, 9), undefined);
	assert.equal(pot.lid, false);
	assert.equal(applyRedstoneLid(pot, 0), undefined, "já aberta");
	assert.equal(applyRedstoneLid(pot, 3), "close");
	assert.equal(applyRedstoneLid(pot, 0), "open");
	assert.equal(pot.lid, false);
}

// ---------------------------------------------------------------------------------------------
// 5. Fósseis: inserções seguidas usam o som curto; monitor mostra TM de todos os tipos.
{
	assert.equal(dnaInsertSound("m", 100), "dnaInsert");
	assert.equal(dnaInsertSound("m", 105), "dnaInsertSmall");
	assert.equal(dnaInsertSound("m", 200), "dnaInsert");
	assert.equal(diskScreen(undefined), "off");
	assert.equal(diskScreen({ id: "minecraft:music_disc_cat", n: 1 }), "music");
}

// ---------------------------------------------------------------------------------------------
// 6. Ring Target (TargetBlock): força pela distância do centro da face; duração por projétil.
{
	assert.equal(targetPower("North", { x: 0.5, y: 0.5, z: 0 }), 15);
	assert.equal(targetPower("north", { x: 0.99, y: 0.5, z: 0 }), 1);
	assert.equal(targetPower("Up", { x: 0.75, y: 1, z: 0.5 }), 8);
	assert.equal(targetPower("East", { x: 1, y: 0.1, z: 0.5 }), 3);
	assert.equal(targetDuration("minecraft:arrow"), 20);
	assert.equal(targetDuration("minecraft:snowball"), 8);
}

// ---------------------------------------------------------------------------------------------
// 7. Botões: madeira 30 ticks e flechas; Eject Button 40 ticks (ferro), sem flechas.
{
	assert.equal(buttonSpec("cobblemon:apricorn_button").ticks, 30);
	assert.equal(BUTTON_SPECS["cobblemon:eject_button"].ticks, 40);
	assert.equal(BUTTON_SPECS["cobblemon:eject_button"].arrows, false);
	assert.ok(BUTTON_SPECS["cobblemon:saccharine_button"].arrows);
	const button = fakeBlock("cobblemon:eject_button", { "cobblemon:pressed": false });
	assert.ok(pressButton(button));
	assert.equal(button.states["cobblemon:pressed"], true);
	assert.ok(!pressButton(button), "já apertado");
	assert.equal(timeouts.at(-1)!.ticks, 40);
	flush();
	assert.equal(button.states["cobblemon:pressed"], false);
}

// ---------------------------------------------------------------------------------------------
// 8. JSON: redstone por permutação (formato 1.21.120); fogueira sem redstone_consumer.
{
	const dir = "behavior_packs/CobblemonBedrock/blocks/cobblemon";
	for (const b of ["apricorn_button", "saccharine_button", "eject_button"]) {
		const j = readJson(`${dir}/${b}.json`);
		assert.equal(j.format_version, "1.21.120");
		const perms = j["minecraft:block"].permutations;
		assert.equal(perms.length, 6, "uma por face de apoio");
		const up = perms.find((p: any) => p.condition.includes("'up'"));
		assert.equal(up.components["minecraft:redstone_producer"].strongly_powered_face, "down");
	}
	for (const b of ["apricorn_pressure_plate", "saccharine_pressure_plate"])
		assert.equal(readJson(`${dir}/${b}.json`)["minecraft:block"].permutations[0].components["minecraft:redstone_producer"].power, 15);
	const target = readJson(`${dir}/ring_target.json`)["minecraft:block"];
	assert.deepEqual(target.description.states["cobblemon:power"], { values: { min: 0, max: 15 } });
	assert.equal(target.permutations.length, 15);
	// Fogueira: sem complemento de redstone_consumer (com ele o comparador da panela não funciona e a própria saída
	// fecha a tampa); a tampa lê os vizinhos por script (scripts/adaptacoes/potRedstone.ts, testado em adaptacoes.test.ts).
	for (const b of ["campfire", "soul_campfire"]) assert.ok(!existsSync(`${dir}/${b}.json`), `${b}: sem complemento de redstone_consumer`);
	assert.ok(readJson(`${dir}/tm_machine.json`)["minecraft:block"].components["minecraft:entity_fall_on"]);
}

// ---------------------------------------------------------------------------------------------
// 9. Barcos: entidades com runtime do barco vanilla; ponto de colocação; troca do drop vanilla.
{
	for (const name of ["apricorn_boat", "saccharine_boat", "apricorn_chest_boat", "saccharine_chest_boat"]) {
		const bp = readJson(`behavior_packs/CobblemonBedrock/entities/boats/${name}.json`)["minecraft:entity"];
		assert.equal(bp.description.identifier, `cobblemon:${name}`);
		assert.equal(bp.description.runtime_identifier, name.includes("chest") ? "minecraft:chest_boat" : "minecraft:boat");
		assert.ok(bp.components["minecraft:buoyant"] && bp.components["minecraft:rideable"]);
		const rp = readJson(`resource_packs/CobblemonBedrock/entity/boats/${name}.entity.json`)["minecraft:client_entity"].description;
		assert.ok(existsSync(join(ROOT, "resource_packs/CobblemonBedrock", `${rp.textures.default}.png`)), `textura de ${name}`);
	}
	assert.deepEqual(boatSpawnPoint({ location: { x: 3, y: 62, z: -4 }, isLiquid: true, typeId: "minecraft:water" }), { x: 3.5, y: 63, z: -3.5 });
	assert.deepEqual(boatSpawnPoint({ location: { x: 3, y: 62, z: -4 }, isLiquid: false, typeId: "minecraft:stone" }, { x: 0.25, y: 1, z: 0.75 }), { x: 3.25, y: 63, z: -3.25 });
	const dim: any = { id: "minecraft:overworld" };
	rememberRemovedBoat(dim, { x: 10, y: 63, z: 10 }, "cobblemon:saccharine_boat", 50);
	assert.equal(replacementForDrop("minecraft:overworld", { x: 10.3, y: 63.2, z: 9.8 }, "minecraft:dirt", 51), undefined);
	assert.equal(replacementForDrop("minecraft:overworld", { x: 40, y: 63, z: 10 }, "minecraft:oak_boat", 51), undefined, "longe demais");
	assert.equal(replacementForDrop("minecraft:overworld", { x: 10.3, y: 63.2, z: 9.8 }, "minecraft:oak_boat", 51), "cobblemon:saccharine_boat");
	assert.equal(replacementForDrop("minecraft:overworld", { x: 10.3, y: 63.2, z: 9.8 }, "minecraft:oak_boat", 52), undefined, "uma troca por barco");
	rememberRemovedBoat(dim, { x: 0, y: 63, z: 0 }, "cobblemon:apricorn_chest_boat", 60);
	assert.equal(replacementForDrop("minecraft:overworld", { x: 0, y: 63, z: 0 }, "minecraft:oak_chest_boat", 90), undefined, "tarde demais");
	rememberRemovedBoat(dim, { x: 0, y: 63, z: 0 }, "cobblemon:apricorn_chest_boat", 100);
	assert.equal(replacementForDrop("minecraft:overworld", { x: 0, y: 63, z: 0 }, "minecraft:oak_chest_boat", 101), "cobblemon:apricorn_chest_boat");
}

// ---------------------------------------------------------------------------------------------
// 10. Healing Machine: brilhos (villager_happy) metade das vezes; pasto: dano do ataque a hostis.
{
	const block = fakeBlock("cobblemon:healing_machine", { "cobblemon:charge": 0 });
	spawnHealingSparkles(block, () => 0.9);
	spawnHealingSparkles(block, () => 0.1);
	assert.deepEqual(block.dimension.particles, ["minecraft:villager_happy"]);
	assert.equal(pastureAttackDamage(1), 2);
	assert.equal(pastureAttackDamage(50), 7);
	assert.equal(pastureAttackDamage(100), 12);
}

// ---------------------------------------------------------------------------------------------
// 11. Leftovers: chance appleLeftoversChance (0,025) nas 5 maçãs da tag held/leaves_leftovers.
{
	assert.equal(LEAVES_LEFTOVERS.size, 5);
	assert.ok(LEAVES_LEFTOVERS.has("cobblemon:candied_apple"));
	assert.ok(rollLeftovers(() => 0.02));
	assert.ok(!rollLeftovers(() => 0.03));
}

console.log("mundo-sons: ok");
