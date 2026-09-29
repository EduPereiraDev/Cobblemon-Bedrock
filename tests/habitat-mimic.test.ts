// Frente habitat-mimic: o bloco de habitat vira o PRÓPRIO bloco imitado (HabitatBlockRenderer do Java desenha o
// `mimickedState` para quem não segura o item) e o habitat passa a viver num registro por posição.
// Cobre: estado/tabela gerados, âncora no importador (índice do imitado, sem âncora de areia no ar), conversão do
// bloco técnico (estrutura, item de op, mundo antigo), vida do registro (imitado, derivado, trocado), quebra
// (criativo sem drop, sobrevivência com o item do imitado), editor só para op em criativo e contorno para quem segura.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setStorageBackend } from "../scripts/machines/store";
import { HABITAT_ANCHOR_MIMICS, HABITAT_ANCHOR_RANGES, HABITAT_POOLS } from "../generated/scripts/habitats";
import {
	anchorMimic, clearHabitats, defaultSettings, detectHabitats, expandSettings, habitatAt, habitatByKey, habitatClock, habitatStore, habitatWorld,
	HabitatSettings, isHabitatBlockType, registerHabitat, settingsForBlock, structureSettings,
} from "../scripts/spawning/Habitats";
import {
	breakMimicHabitat, breakSoundFor, canEdit, convertHabitatBlock, holdsHabitatItem, markerPoints, habitatsNear, onMimicHabitatBreak,
	onMimicHabitatInteract, saveHabitatSettings, storedSettings,
} from "../scripts/machines/habitat";
import { BlockMapper, convertBlocks, structureIndex, HABITAT_ANCHOR_MIMICS as IMPORT_MIMICS } from "../tools/importer/structures.ts";
import type { PlacedBlock } from "../tools/importer/structures.ts";

console.warn = () => { };
const ROOT = process.cwd();
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// Dynamic properties em memória.
const mem = new Map<string, string>();
setStorageBackend({ get: id => mem.get(id), set: (id, v) => { if (v === undefined) mem.delete(id); else mem.set(id, v); }, ids: () => [...mem.keys()] });
let tick = 1000;
habitatClock.tick = () => tick;
habitatClock.gameTime = () => 0;

const OW = "minecraft:overworld";

/** Bloco mock: tipo, estados e setPermutation/setType que trocam o tipo. */
function mockBlock(typeId: string, loc: { x: number; y: number; z: number }, states: Record<string, number> = {}) {
	const block: any = {
		typeId, location: loc, isValid: true, dimension: { id: OW },
		set: [] as string[],
		permutation: { getState: (k: string) => states[k], withState() { return this; } },
		setPermutation(p: unknown) { block.set.push("perm"); block.typeId = "mimic:set"; void p; },
		setType(t: string) { block.set.push(t); block.typeId = t; },
	};
	return block;
}

// ---------------------------------------------------------------------------------------------
// 1. Gerado: estado cobblemon:habitat_mimic e tabela de imitados das âncoras

{
	const def = json(join(ROOT, "generated", "behavior_packs", "CobblemonBedrock", "blocks", "cobblemon", "habitat_block.json"))["minecraft:block"];
	assert.deepEqual(def.description.states["cobblemon:habitat_mimic"], [0, 1, 2, 3], "índice do bloco imitado da âncora");
	assert.ok(def.components["minecraft:tick"], "a âncora ainda tem tick (é ele que converte)");
	for (const pool of Object.keys(HABITAT_ANCHOR_RANGES)) {
		assert.ok(HABITAT_ANCHOR_MIMICS[pool]?.length, `imitado da âncora de ${pool}`);
		assert.ok(HABITAT_ANCHOR_MIMICS[pool].length <= 4, `${pool}: cabe no estado`);
		assert.ok(HABITAT_POOLS[pool], `${pool} é um pool real`);
	}
	// Torre de "Afloramento Rochoso" do relato: imita dripstone_block (MimicId dos moldes rocky_outcrop).
	assert.equal(HABITAT_ANCHOR_MIMICS["cobblemon:rocky_outcrop"][0].name, "minecraft:dripstone_block");
	// Folhas imitadas não podem decair (no Java o bloco de habitat nunca decai).
	assert.equal(HABITAT_ANCHOR_MIMICS["cobblemon:berry_patch"][0].states.persistent_bit, true);
	// snow_block do Java é minecraft:snow no Bedrock.
	assert.equal(HABITAT_ANCHOR_MIMICS["cobblemon:snowy_burrow"][0].name, "minecraft:snow");
	assert.equal(anchorMimic("cobblemon:rocky_outcrop", 3).name, "minecraft:dripstone_block", "índice fora da lista → 1º do pool");
	assert.equal(anchorMimic("cobblemon:nao_existe", 0).name, "minecraft:stone", "sem tabela → padrão do HabitatBlockEntity");
}

// ---------------------------------------------------------------------------------------------
// 2. Importador: âncora guarda o índice do imitado; imitado que cai não vira âncora sem apoio

{
	const table = { "minecraft:stone[]": "minecraft:stone[]", "minecraft:sand[]": "minecraft:sand[]", "minecraft:gravel[]": "minecraft:gravel[]" };
	const mapper = new BlockMapper(() => ({ name: "cobblemon:habitat_block", states: { "cobblemon:habitat_pool": 0, "cobblemon:habitat_pool_hi": 0 } }), table);
	IMPORT_MIMICS.clear();
	const hab = (pos: [number, number, number], mimic: string): PlacedBlock => ({ pos, name: "cobblemon:habitat_block", props: {}, nbt: { PoolId: "cobblemon:freshwater_pond", RangeOfInfluence: 16, MimicId: mimic } });
	// (1,2,1) é areia no ar, mas com mais vizinhos de habitat; (1,0,1) é cascalho apoiado em pedra.
	const blocks: PlacedBlock[] = [
		{ pos: [1, 0, 0], name: "minecraft:stone", props: {} }, { pos: [0, 0, 1], name: "minecraft:stone", props: {} },
		{ pos: [2, 0, 1], name: "minecraft:stone", props: {} }, { pos: [1, 0, 2], name: "minecraft:stone", props: {} },
		hab([1, 1, 1], "minecraft:gravel"), hab([1, 2, 1], "minecraft:sand"),
		{ pos: [0, 2, 1], name: "minecraft:stone", props: {} }, { pos: [2, 2, 1], name: "minecraft:stone", props: {} },
		{ pos: [1, 2, 0], name: "minecraft:stone", props: {} }, { pos: [1, 2, 2], name: "minecraft:stone", props: {} },
		{ pos: [1, 3, 1], name: "minecraft:stone", props: {} },
	];
	// Sem nada embaixo da areia em (1,1,1)? Não: embaixo da areia está o cascalho (habitat) → apoiada. Tira o apoio.
	blocks.splice(4, 1);
	blocks.push({ pos: [1, 1, 1], name: "minecraft:air", props: {} });
	blocks.push(hab([2, 1, 2], "minecraft:gravel"), { pos: [2, 0, 2], name: "minecraft:stone", props: {} });
	const s = convertBlocks([4, 4, 4], blocks, { mapper, poolIndex: new Map([["cobblemon:freshwater_pond", 17]]) });
	const at = (x: number, y: number, z: number) => s.palette[s.layer0[structureIndex(s.size, x, y, z)]];
	assert.equal(at(1, 2, 1).name, "minecraft:sand", "areia sem apoio não é a âncora (cairia ao virar o imitado)");
	assert.equal(at(2, 1, 2).name, "cobblemon:habitat_block", "âncora apoiada");
	assert.equal(at(2, 1, 2).states["cobblemon:habitat_mimic"], 0);
	assert.equal(s.habitat?.mimic.name, "minecraft:gravel");
	assert.deepEqual(IMPORT_MIMICS.get("cobblemon:freshwater_pond")?.map(b => b.name), ["minecraft:gravel"]);
	// Outro molde do mesmo pool com outro imitado → índice 1.
	const s2 = convertBlocks([1, 2, 1], [{ pos: [0, 0, 0], name: "minecraft:stone", props: {} }, hab([0, 1, 0], "minecraft:stone")], { mapper, poolIndex: new Map([["cobblemon:freshwater_pond", 17]]) });
	assert.equal(s2.palette[s2.layer0[structureIndex(s2.size, 0, 1, 0)]].states["cobblemon:habitat_mimic"], 1);
	IMPORT_MIMICS.clear();
}

// ---------------------------------------------------------------------------------------------
// 3. Conversão: bloco técnico → bloco imitado + registro

const berryIdx = HABITAT_POOLS["cobblemon:berry_patch"].index;
const rockyIdx = HABITAT_POOLS["cobblemon:rocky_outcrop"].index;
clearHabitats();
{
	// Âncora de estrutura (pool + imitado no estado).
	const anchor = mockBlock("cobblemon:habitat_block", { x: 10, y: 80, z: 10 }, { "cobblemon:habitat_pool": rockyIdx % 16, "cobblemon:habitat_pool_hi": Math.floor(rockyIdx / 16), "cobblemon:habitat_mimic": 0 });
	const settings = settingsForBlock(anchor);
	assert.equal(settings.style, "natural");
	assert.equal(settings.poolId, "cobblemon:rocky_outcrop");
	assert.equal(settings.mimicId, "minecraft:dripstone_block");
	const state = convertHabitatBlock(anchor)!;
	assert.ok(state, "convertido");
	assert.deepEqual(anchor.set, ["perm"], "trocou pelo bloco imitado");
	const key = `${OW}|10|80|10`;
	assert.deepEqual(habitatStore.get(key), { preset: "structure", poolId: "cobblemon:rocky_outcrop", mimicId: "minecraft:dripstone_block" }, "registro compacto");
	assert.equal(habitatByKey(key)?.settings.rangeOfInfluence, HABITAT_ANCHOR_RANGES["cobblemon:rocky_outcrop"], "alcance da âncora mantido");
	assert.equal(convertHabitatBlock(anchor), undefined, "bloco já convertido não converte de novo");

	// Item de habitat colocado por op: padrão do HabitatBlockEntity (ativado, pool vazio, imita pedra).
	const placed = mockBlock("cobblemon:habitat_block", { x: 0, y: 64, z: 0 });
	const s2 = convertHabitatBlock(placed)!;
	assert.equal(s2.settings.style, "activated");
	assert.equal(s2.settings.mimicId, "minecraft:stone");
	assert.equal(habitatStore.get(`${OW}|0|64|0`)?.preset, undefined, "configuração completa salva");

	// Mundo antigo: âncora sem o estado cobblemon:habitat_mimic (getState undefined) → 1º imitado do pool.
	const legacy = mockBlock("cobblemon:habitat_block", { x: 5, y: 70, z: 5 }, { "cobblemon:habitat_pool": berryIdx % 16, "cobblemon:habitat_pool_hi": Math.floor(berryIdx / 16) });
	assert.equal(convertHabitatBlock(legacy)?.settings.mimicId, "minecraft:oak_leaves");
	assert.deepEqual(habitatStore.get(`${OW}|5|70|5`)?.mimicStates, { persistent_bit: true, update_bit: false });
}

// Registro salvo compacto (estrutura) expande para a configuração da estrutura; o completo fica como está.
{
	const s = expandSettings({ preset: "structure", poolId: "cobblemon:rocky_outcrop", mimicId: "minecraft:dripstone_block" });
	assert.equal(s.style, "natural");
	assert.equal(s.replaceSpawns, true);
	assert.equal(s.phaseOrder, "FULL_RANDOM");
	assert.equal(s.mimicId, "minecraft:dripstone_block");
	assert.deepEqual(storedSettings({ ...structureSettings("cobblemon:berry_patch"), preset: "structure", mimicId: "minecraft:oak_leaves" }), { preset: "structure", poolId: "cobblemon:berry_patch", mimicId: "minecraft:oak_leaves" });
	const full = storedSettings({ ...defaultSettings(), preset: undefined });
	assert.equal(full.style, "activated");
	assert.ok(!("preset" in full));
}

// ---------------------------------------------------------------------------------------------
// 4. Vida do registro: bloco imitado vale; forma derivada vale; trocado sai (e o salvo também)

{
	const grass: HabitatSettings = { ...structureSettings("cobblemon:flowerbed_clearing"), mimicId: "minecraft:grass_block" };
	assert.ok(isHabitatBlockType(grass, "minecraft:grass_block"));
	assert.ok(isHabitatBlockType(grass, "minecraft:dirt"), "grama coberta vira terra: continua o habitat");
	assert.ok(isHabitatBlockType(grass, "cobblemon:habitat_block"), "técnico ainda não convertido");
	assert.ok(!isHabitatBlockType(grass, "minecraft:air"));
	assert.ok(isHabitatBlockType({ mimicId: "stone" }, "minecraft:stone"), "id sem namespace");

	clearHabitats();
	mem.clear();
	const key = `${OW}|0|64|0`;
	habitatStore.set(key, storedSettings({ ...grass, preset: "structure" }));
	const state = registerHabitat(OW, { x: 0, y: 64, z: 0 }, grass);
	state.lastSeen = -Infinity;
	habitatWorld.lookup = () => "minecraft:grass_block";
	assert.equal(detectHabitats(OW, { x: 0, y: 64, z: 0 }, 8, 8, "world").length, 1, "bloco imitado no mundo = habitat vivo");
	tick += 1000;
	habitatWorld.lookup = () => null;
	assert.equal(detectHabitats(OW, { x: 0, y: 64, z: 0 }, 8, 8, "world").length, 0, "chunk descarregado: não vale");
	assert.ok(habitatByKey(key), "…mas continua no registro");
	habitatWorld.lookup = () => "minecraft:air";
	assert.equal(detectHabitats(OW, { x: 0, y: 64, z: 0 }, 8, 8, "world").length, 0);
	assert.equal(habitatByKey(key), undefined, "bloco trocado sai do registro");
	assert.equal(habitatStore.get(key), undefined, "…e do registro salvo");
}

// ---------------------------------------------------------------------------------------------
// 5. Quebra: criativo sem drop; sobrevivência cancela o vanilla e solta o item do bloco imitado

const creative = { getGameMode: () => "Creative", commandPermissionLevel: 1, playerPermissionLevel: 2, isSneaking: false, isValid: true } as any;
const creativeNonOp = { getGameMode: () => "Creative", commandPermissionLevel: 0, playerPermissionLevel: 1, isSneaking: false, isValid: true } as any;
const survivalOp = { getGameMode: () => "Survival", commandPermissionLevel: 4, playerPermissionLevel: 2, isSneaking: false, isValid: true } as any;
const survival = { getGameMode: () => "Survival", commandPermissionLevel: 0, playerPermissionLevel: 1, isSneaking: false, isValid: true } as any;

clearHabitats();
mem.clear();
{
	const settings: HabitatSettings = { ...structureSettings("cobblemon:rocky_outcrop"), mimicId: "minecraft:dripstone_block" };
	const pos = { x: 3, y: 90, z: 3 };
	const key = `${OW}|3|90|3`;
	habitatStore.set(key, settings);
	registerHabitat(OW, pos, settings);
	const world = mockBlock("minecraft:dripstone_block", pos);
	const drops: unknown[] = [];
	const sounds: string[] = [];
	const dim = { id: OW, getBlock: () => world, spawnItem: (item: unknown) => { drops.push(item); }, playSound: (id: string) => { sounds.push(id); } } as any;
	world.dimension = dim;

	// Criativo: a quebra vanilla segue (sem drop).
	const ev1 = { block: world, player: creative, cancel: false };
	onMimicHabitatBreak(ev1);
	assert.equal(ev1.cancel, false, "criativo: quebra vanilla (não solta nada)");

	// Sobrevivência: cancela o vanilla (o drop vanilla não é o do Java) e solta o item do bloco imitado.
	const ev2 = { block: world, player: survival, cancel: false };
	onMimicHabitatBreak(ev2);
	assert.equal(ev2.cancel, true, "sobrevivência: drop vanilla cancelado");
	const state = habitatByKey(key)!;
	assert.equal(breakMimicHabitat(dim, pos, state), true);
	assert.equal(drops.length, 1, "um drop (o item do bloco imitado)");
	assert.deepEqual(world.set, ["minecraft:air"], "bloco removido");
	assert.deepEqual(sounds, ["dig.stone"]);
	assert.equal(habitatByKey(key), undefined, "registro removido");
	assert.equal(habitatStore.get(key), undefined, "registro salvo removido");
	assert.equal(breakMimicHabitat(dim, pos, state), false, "uma vez só");

	// Bloco comum (sem habitat na posição): nada muda.
	const plain = mockBlock("minecraft:stone", { x: 50, y: 50, z: 50 });
	plain.dimension = dim;
	const ev3 = { block: plain, player: survival, cancel: false };
	onMimicHabitatBreak(ev3);
	assert.equal(ev3.cancel, false);
	assert.equal(breakSoundFor("minecraft:oak_log"), "dig.wood");
	assert.equal(breakSoundFor("minecraft:sandstone"), "dig.stone");
	assert.equal(breakSoundFor("minecraft:red_sand"), "dig.sand");
	assert.equal(breakSoundFor("minecraft:oak_leaves"), "dig.grass");
}

// ---------------------------------------------------------------------------------------------
// 6. Editor: só operador em criativo (canUseGameMasterBlocks + isCreative do onUse)

{
	assert.equal(canEdit(creative), true);
	assert.equal(canEdit(creativeNonOp), false, "não-op em criativo não abre");
	assert.equal(canEdit(survivalOp), false, "op fora do criativo não abre");
	assert.equal(canEdit(survival), false);
	assert.equal(canEdit({ getGameMode: () => "Creative", commandPermissionLevel: 0, playerPermissionLevel: 2 } as any), true, "permissão de jogador Operator");

	const settings: HabitatSettings = { ...defaultSettings(), mimicId: "minecraft:stone" };
	const pos = { x: 7, y: 64, z: 7 };
	habitatStore.set(`${OW}|7|64|7`, settings);
	registerHabitat(OW, pos, settings);
	const block = mockBlock("minecraft:stone", pos);
	const habitatItem = { typeId: "cobblemon:habitat_block" };
	const ev = (player: any, itemStack?: unknown) => ({ block, player, itemStack, isFirstEvent: true, cancel: false }) as any;

	const e1 = ev(creativeNonOp, habitatItem);
	assert.equal(onMimicHabitatInteract(e1), false);
	assert.equal(e1.cancel, false, "não-op: interação normal (coloca o bloco)");
	const e2 = ev(survival);
	assert.equal(onMimicHabitatInteract(e2), false);
	assert.equal(e2.cancel, false);
	const e3 = ev(creative, habitatItem);
	assert.equal(onMimicHabitatInteract(e3), true, "op em criativo com o item abre o editor");
	assert.equal(e3.cancel, true, "…sem colocar outro bloco de habitat");
	const e4 = ev(creative);
	assert.equal(onMimicHabitatInteract(e4), true, "op em criativo de mão vazia também (useWithoutItem)");
	const e5 = ev({ ...creative, isSneaking: true }, habitatItem);
	assert.equal(onMimicHabitatInteract(e5), false, "agachado com item: usa o item, como no Java");
	const other = mockBlock("minecraft:stone", { x: 8, y: 64, z: 7 });
	const e6 = { block: other, player: creative, isFirstEvent: true, cancel: false } as any;
	assert.equal(onMimicHabitatInteract(e6), false, "pedra comum não é habitat");
	assert.equal(habitatAt(OW, { x: 8, y: 64, z: 7 }), undefined);

	// Editor trocando o "Mimic Block ID": grava completo e troca o bloco no mundo.
	const b2 = mockBlock("minecraft:stone", pos);
	saveHabitatSettings(b2, { ...settings, preset: "structure", mimicId: "minecraft:mossy_cobblestone" });
	assert.equal(habitatStore.get(`${OW}|7|64|7`)?.mimicId, "minecraft:mossy_cobblestone");
	assert.equal(habitatStore.get(`${OW}|7|64|7`)?.preset, undefined, "editado: não volta ao compacto da estrutura");
	assert.deepEqual(b2.set, ["perm"], "bloco trocado pelo novo imitado");
}

// ---------------------------------------------------------------------------------------------
// 7. Quem segura o item de habitat: contorno dos habitats próximos

{
	const equip = (main?: string, off?: string) => ({ getComponent: () => ({ getEquipment: (slot: string) => (slot === "Mainhand" ? main && { typeId: main } : off && { typeId: off }) }) }) as any;
	assert.equal(holdsHabitatItem(equip("cobblemon:habitat_block")), true);
	assert.equal(holdsHabitatItem(equip(undefined, "cobblemon:habitat_block")), true, "mão secundária também (HabitatBlockRenderer)");
	assert.equal(holdsHabitatItem(equip("minecraft:stone")), false);
	assert.equal(holdsHabitatItem({ getComponent: () => { throw new Error("x"); } } as any), false);
	const pts = markerPoints({ x: 0, y: 0, z: 0 });
	assert.equal(pts.length, 20, "8 cantos + 12 arestas");
	assert.ok(pts.every(p => [p.x, p.y, p.z].some(v => v < 0 || v > 1)), "fora das faces (o bloco imitado é opaco)");
	clearHabitats();
	for (let i = 0; i < 30; i++) registerHabitat(OW, { x: i * 2, y: 64, z: 0 }, defaultSettings());
	registerHabitat("minecraft:nether", { x: 0, y: 64, z: 0 }, defaultSettings());
	registerHabitat(OW, { x: 500, y: 64, z: 0 }, defaultSettings());
	const near = habitatsNear(OW, { x: 0, y: 64, z: 0 });
	assert.equal(near.length, 24, "limite por jogador");
	assert.ok(near.every(s => s.dimensionId === OW && s.pos.x <= 48));
	assert.equal(near[0].pos.x, 0, "mais perto primeiro");
}

console.log("ok: habitat-mimic (tabela de imitados, âncora, conversão, registro, quebra, editor só op em criativo, contorno)");
