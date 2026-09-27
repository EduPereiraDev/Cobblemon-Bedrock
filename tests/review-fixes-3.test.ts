// Frente "review-fixes-3": regressões dos achados da 3ª revisão independente — enfermeira só para adultos e
// profissão mantida na zumbificação/cura, pinturas (parede no chunk vizinho, sobreposição com a vanilla), vaso
// decorado (entidade órfã, custo do laço, bloco destruído por comando), Mental Herb com vários jogadores, redstone da
// panela filtrada, validador com JSON mesclado e cache negativo de estruturas limitado. API do Minecraft mockada.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { system, world } from "@minecraft/server";
import { adultsOnly, noteNurseRemoved, nursePass, nurseStats, onTransformedSpawn } from "../scripts/limitesB/nurse";
import { BECOME_NURSE } from "../scripts/limitesB/nurseLogic";
import {
	occupancyNear, PAINTING_ENTITY, paintingRng, paintingSurvives, startPaintings, vanillaPaintingBlocks, vanillaWouldOverlapOurs,
} from "../scripts/limitesB/paintings";
import { COBBLEMON_PAINTINGS } from "../generated/scripts/limitesB";
import {
	hasHopperOrComparatorNear, INTERACT_RETRIES, interactWithPot, onPotDestroyed, POT_INTERVAL, potBucket, potStore, removeOrphanDisplay,
	tickDecoratedPot, tickDecoratedPotSlice,
} from "../scripts/adaptacoes/decoratedPot";
import { DECORATED_POT, DECORATED_POT_DISPLAY } from "../scripts/adaptacoes/sherds";
import { setStorageBackend, blockKey } from "../scripts/machines/store";
import { keepProbabilityFor, newRestState, onPhantomSpawned, restRng, setRest } from "../scripts/adaptacoes/mentalRestoration";
import { dimensionReader, hasNeighborSignal, tickPotRedstone, viewOf } from "../scripts/adaptacoes/potRedstone";
import { cookingStore } from "../scripts/machines/cooking";
import { mergedDocs } from "../tools/importer/commandVisibility";
import { negativeCacheKeys, rememberNegative } from "../scripts/limitesB/vanillaStructures";

const ROOT = process.cwd();
console.info = () => { };
console.log = () => { };
const W = world as any;
const S = system as any;
let passed = 0;
const test = (name: string, fn: () => void) => {
	try { fn(); passed++; }
	catch (e) { console.error(`✗ ${name}`); throw e; }
};

type Vec = { x: number; y: number; z: number };
const k3 = (v: Vec) => `${v.x},${v.y},${v.z}`;

// Backend de dynamic properties do mundo em memória (MachineStore).
const worldProps = new Map<string, string>();
setStorageBackend({ get: id => worldProps.get(id), set: (id, v) => { if (v === undefined) worldProps.delete(id); else worldProps.set(id, v); }, ids: () => [...worldProps.keys()] });

let timeouts: Array<() => void> = [];
S.runTimeout = (fn: () => void) => { timeouts.push(fn); return 0; };
S.run = (fn: () => void) => { timeouts.push(fn); return 0; };
S.runInterval = () => 0;
S.currentTick = 100;

function entityProps() {
	const props = new Map<string, unknown>();
	return {
		props,
		getDynamicProperty: (k: string) => props.get(k),
		setDynamicProperty: (k: string, v: unknown) => { if (v === undefined) props.delete(k); else props.set(k, v); },
	};
}

// ---------------------------------------------------------------------------------------------
// 1. Enfermeira: filhote não vira enfermeira; profissão sobrevive à zumbificação e à cura

function fakeVillager(opts: { baby?: boolean; families?: string[]; typeId?: string; at?: Vec }) {
	const events: string[] = [];
	const fams = opts.families ?? ["villager", "unskilled", "mob"];
	return {
		...entityProps(),
		events,
		id: `v${Math.random()}`,
		typeId: opts.typeId ?? "minecraft:villager_v2",
		isValid: true,
		nameTag: "",
		location: opts.at ?? { x: 0, y: 64, z: 0 },
		dimension: { id: "minecraft:overworld" },
		getComponent: (name: string) => name === "minecraft:is_baby" ? (opts.baby ? {} : undefined)
			: name === "minecraft:type_family" ? { hasTypeFamily: (f: string) => fams.includes(f) } : undefined,
		triggerEvent: (e: string) => { events.push(e); },
		getProperty: () => false,
		setProperty: () => { },
	};
}

test("enfermeira: filhote (família unskilled do nascimento) fica de fora do AcquirePoi; adulto vira enfermeira", () => {
	const baby = fakeVillager({ baby: true });
	const adult = fakeVillager({});
	const oldBaby = fakeVillager({ baby: true });
	oldBaby.setDynamicProperty("cobblemon:nurse_site", "minecraft:overworld|9|64|0");
	const dim = {
		id: "minecraft:overworld",
		heightRange: { min: -64, max: 320 },
		getEntities: (q: { families?: string[] }) => q.families?.[0] === "unskilled" ? [baby, oldBaby, adult] : [],
		containsBlock: () => true,
		getBlocks: () => ({ getBlockLocationIterator: () => [{ x: 5, y: 64, z: 0 }, { x: 9, y: 64, z: 0 }][Symbol.iterator]() }),
		isChunkLoaded: () => true,
		getBlock: () => ({ typeId: "cobblemon:healing_machine" }),
	};
	W.getDimension = (id: string) => { if (id === "overworld") return dim; throw new Error("sem dimensão"); };
	nursePass();
	assert.deepEqual(baby.events, [], "filhote não recebe o evento");
	assert.equal(baby.getDynamicProperty("cobblemon:nurse_site"), undefined, "filhote não reserva estação");
	assert.equal(oldBaby.getDynamicProperty("cobblemon:nurse_site"), undefined, "estação guardada por filhote é liberada");
	assert.deepEqual(oldBaby.events, []);
	assert.deepEqual(adult.events, [BECOME_NURSE]);
	assert.equal(typeof adult.getDynamicProperty("cobblemon:nurse_site"), "string");
	assert.deepEqual(adultsOnly([baby, adult] as never).map((v: any) => v.id), [adult.id]);
	// Override: o evento também recusa filhote (defesa se outro caminho disparar o evento).
	const e = JSON.parse(readFileSync(join(ROOT, "behavior_packs/CobblemonBedrock/entities/vanilla_overrides/villager_v2.json"), "utf8"))["minecraft:entity"];
	assert.deepEqual(e.events["cobblemon:become_nurse"].filters, { test: "is_baby", value: false });
	// Pergunta aberta: igual ao bedrock-samples 1.26.50.4 (is_summonable false, sem spawn_category).
	assert.equal(e.description.is_summonable, false);
	assert.equal(e.description.is_spawnable, true);
	assert.equal("spawn_category" in e.description, false);
});

test("enfermeira: zumbificação guarda a profissão no zumbi e a cura devolve (com 'negociou')", () => {
	const nurse = fakeVillager({ families: ["villager", "cobblemon_nurse", "mob"], at: { x: 10.3, y: 64, z: 10.7 } });
	nurse.setDynamicProperty("cobblemon:nurse_traded", true);
	noteNurseRemoved(nurse as never, 100);
	const zombie = fakeVillager({ typeId: "minecraft:zombie_villager_v2", families: ["zombie_villager"], at: { x: 10.3, y: 64, z: 10.7 } });
	assert.equal(onTransformedSpawn(zombie as never, 101), true);
	assert.equal(zombie.getDynamicProperty("cobblemon:was_nurse"), 2);
	// Cura (minutos depois): o aldeão que nasce no lugar do zumbi volta a ser enfermeira.
	noteNurseRemoved(zombie as never, 6000);
	const cured = fakeVillager({ families: ["villager", "mob"], at: { x: 10.4, y: 64, z: 10.6 } });
	assert.equal(onTransformedSpawn(cured as never, 6001), true);
	assert.deepEqual(cured.events, [BECOME_NURSE]);
	assert.equal(cured.getDynamicProperty("cobblemon:nurse_traded"), true);
	assert.equal(nurseStats.zombified, 1);
	assert.equal(nurseStats.cured, 1);
	// Aldeão comum, outro lugar ou tempo demais: nada herdado.
	const plain = fakeVillager({ families: ["villager", "farmer", "mob"] });
	noteNurseRemoved(plain as never, 7000);
	assert.equal(onTransformedSpawn(fakeVillager({ typeId: "minecraft:zombie_villager_v2", families: ["zombie_villager"] }) as never, 7001), false);
	const n2 = fakeVillager({ families: ["villager", "cobblemon_nurse", "mob"], at: { x: 0, y: 64, z: 0 } });
	noteNurseRemoved(n2 as never, 8000);
	assert.equal(onTransformedSpawn(fakeVillager({ typeId: "minecraft:zombie_villager_v2", at: { x: 5, y: 64, z: 0 } }) as never, 8001), false);
	assert.equal(onTransformedSpawn(fakeVillager({ typeId: "minecraft:zombie_villager_v2", at: { x: 0, y: 64, z: 0 } }) as never, 8100), false);
});

// ---------------------------------------------------------------------------------------------
// 2 e 3. Pinturas: parede no chunk vizinho; sobreposição com a vanilla

const premonition = COBBLEMON_PAINTINGS.find(p => p.name === "premonition")!;

function paintingWorld(opts: { loaded?: (v: Vec) => boolean; unreadable?: (v: Vec) => boolean; vanilla?: any[]; ours?: any[] } = {}) {
	return {
		id: "minecraft:overworld",
		isChunkLoaded: (v: Vec) => opts.loaded ? opts.loaded(v) : true,
		// Parede de pedra no plano z = 0; ar no resto.
		getBlock: (v: Vec) => {
			if (opts.loaded && !opts.loaded(v)) return undefined;
			if (opts.unreadable?.(v)) return undefined;
			return v.z === 0 ? { typeId: "minecraft:stone", isAir: false, isLiquid: false } : { typeId: "minecraft:air", isAir: true, isLiquid: false };
		},
		getEntities: (q: { type: string }) => q.type === PAINTING_ENTITY ? (opts.ours ?? []) : q.type === "minecraft:painting" ? (opts.vanilla ?? []) : [],
	};
}

function ourPainting(dim: any, anchor: Vec, id = "p1") {
	return {
		id, typeId: PAINTING_ENTITY, dimension: dim, isValid: true, location: { x: anchor.x, y: anchor.y, z: anchor.z + 0.97 },
		getDynamicProperty: () => JSON.stringify({ v: premonition.name, f: "north", a: [anchor.x, anchor.y, anchor.z] }),
	};
}

test("pinturas: parede em chunk descarregado ou ilegível = 'não sei' (a pintura não cai)", () => {
	const anchor = { x: 2, y: 64, z: -1 };
	// Blocos da frente (z = -1) carregados; a parede (z = 0) está no chunk vizinho, descarregado.
	const split = paintingWorld({ loaded: v => v.z < 0 });
	assert.equal(paintingSurvives(ourPainting(split, anchor) as never), undefined);
	const unreadable = paintingWorld({ unreadable: v => v.z === 0 && v.x === 1 });
	assert.equal(paintingSurvives(ourPainting(unreadable, anchor) as never), undefined);
	// Carregado: com parede fica; sem parede cai.
	assert.equal(paintingSurvives(ourPainting(paintingWorld(), anchor) as never), true);
	const noWall = { ...paintingWorld(), getBlock: () => ({ typeId: "minecraft:air", isAir: true, isLiquid: false }) };
	assert.equal(paintingSurvives(ourPainting(noWall, anchor) as never), false);
});

test("pinturas: vanilla grande ocupa mais que o bloco da posição (caixa ou estimativa conservadora)", () => {
	const noBox = { location: { x: 0.5, y: 64.5, z: -0.97 }, getAABB: () => { throw new Error("sem caixa"); } };
	const est = vanillaPaintingBlocks(noBox as never);
	assert.equal(est.exact, false);
	const set = new Set(est.blocks.map(k3));
	for (const v of [{ x: 2, y: 66, z: -1 }, { x: -2, y: 62, z: -1 }, { x: 0, y: 64, z: 1 }, { x: 0, y: 64, z: -3 }]) assert.ok(set.has(k3(v)), k3(v));
	const boxed = { location: { x: 1, y: 64, z: -0.97 }, getAABB: () => ({ center: { x: 1, y: 65, z: -0.97 }, extent: { x: 1, y: 1, z: 0.03 } }) };
	const exact = vanillaPaintingBlocks(boxed as never);
	assert.equal(exact.exact, true);
	assert.deepEqual(exact.blocks.map(k3).sort(), ["0,64,-1", "0,65,-1", "1,64,-1", "1,65,-1"]);
	// Uma vanilla 2×2 com a posição num canto bloqueia os 4 blocos (antes só floor(location)).
	const dim = paintingWorld({ vanilla: [boxed] });
	const occ = occupancyNear(dim as never, { x: 0, y: 64, z: -1 });
	assert.ok(occ.vanilla.has("0,65,-1") && occ.vanilla.has("1,64,-1"));
	// Estimativa nunca derruba a nossa (só a caixa medida conta para "sobreviver").
	const nearOurs = paintingWorld({ vanilla: [noBox] });
	assert.equal(paintingSurvives(ourPainting(nearOurs, { x: 2, y: 64, z: -1 }) as never), true);
});

test("pinturas: a vanilla não é deixada cair por cima da nossa; uso repetido do item é cancelado", () => {
	const dim = paintingWorld();
	const ours = ourPainting(dim, { x: 2, y: 64, z: -1 });
	(dim as any).getEntities = (q: { type: string }) => q.type === PAINTING_ENTITY ? [ours] : [];
	const near = occupancyNear(dim as never, { x: -1, y: 64, z: -1 });
	assert.ok(near.ours.has("2,64,-1") && near.ours.has("1,64,-1"));
	assert.equal(vanillaWouldOverlapOurs(dim as never, { x: -1, y: 64, z: -1 }, "north", near), true, "4×4 do Bedrock alcançaria a nossa");
	const far = occupancyNear(dim as never, { x: -10, y: 64, z: -1 });
	assert.equal(vanillaWouldOverlapOurs(dim as never, { x: -10, y: 64, z: -1 }, "north", { ...far, ours: new Set(["2,64,-1"]) }), false);
	// Evento: sorteio forçado para vanilla.
	let handler: ((e: any) => void) | undefined;
	W.beforeEvents = { playerInteractWithBlock: { subscribe: (fn: any) => { handler = fn; } }, entityHurt: { subscribe: () => { } } };
	startPaintings();
	assert.ok(handler);
	paintingRng.next = () => 0;
	const player = { getGameMode: () => "Survival", isSneaking: false, isValid: true };
	const click = (x: number, first = true) => {
		const ev: any = { isFirstEvent: first, itemStack: { typeId: "minecraft:painting" }, blockFace: "North", player, block: { typeId: "minecraft:stone", dimension: dim, location: { x, y: 64, z: 0 } }, cancel: false };
		handler!(ev);
		return ev.cancel;
	};
	assert.equal(click(-1), true, "vanilla perto da nossa: cancelado");
	assert.equal(click(-10), false, "longe: o Bedrock põe a dele");
	assert.equal(click(-10, false), true, "botão segurado: cancelado");
});

// ---------------------------------------------------------------------------------------------
// 4, 5 e 8. Vaso decorado

interface FakeItem { typeId: string; amount: number; maxAmount: number; isStackableWith: () => boolean; clone: () => FakeItem }
const item = (typeId = "minecraft:diamond", amount = 1): FakeItem => ({ typeId, amount, maxAmount: 64, isStackableWith: () => true, clone() { return { ...this }; } });

function potWorld() {
	const w = {
		blocks: new Map<string, string>(),
		displays: [] as any[],
		drops: [] as unknown[],
		spawned: 0,
		getEntitiesCalls: 0,
		getEntityCalls: 0,
		getBlockCalls: 0,
		setRotationCalls: 0,
		near: false,
		dim: undefined as any,
	};
	const dim: any = {
		id: "minecraft:overworld",
		isChunkLoaded: () => true,
		getBlock: (v: Vec) => {
			w.getBlockCalls++;
			const typeId = w.blocks.get(k3(v)) ?? "minecraft:air";
			const perm: any = { getState: () => 0, withState: () => perm };
			return { typeId, location: { ...v }, dimension: dim, isValid: true, permutation: perm, setPermutation: () => { }, getComponent: () => undefined };
		},
		getEntities: (q: { type: string; location: Vec }) => {
			w.getEntitiesCalls++;
			return w.displays.filter(e => e.isValid && q.type === DECORATED_POT_DISPLAY && Math.floor(e.location.x) === Math.floor(q.location.x) && Math.floor(e.location.y) === Math.floor(q.location.y) && Math.floor(e.location.z) === Math.floor(q.location.z));
		},
		spawnItem: (stack: unknown) => { w.drops.push(stack); },
		spawnEntity: (_t: string, at: Vec) => { w.spawned++; return display(at); },
		containsBlock: () => w.near,
		playSound: () => { },
		spawnParticle: () => { },
	};
	w.dim = dim;
	function display(at: Vec, stored?: FakeItem) {
		let slot: FakeItem | undefined = stored;
		let rot = { x: 0, y: 180 };
		const e: any = {
			id: `d${w.displays.length}`, typeId: DECORATED_POT_DISPLAY, isValid: true, location: { x: Math.floor(at.x) + 0.5, y: Math.floor(at.y), z: Math.floor(at.z) + 0.5 }, dimension: dim,
			getRotation: () => rot, setRotation: (r: any) => { w.setRotationCalls++; rot = r; },
			getProperty: () => 0, setProperty: () => { },
			getComponent: (n: string) => n === "minecraft:inventory" ? { container: { size: 1, getItem: () => slot, setItem: (_i: number, v?: FakeItem) => { slot = v; } } } : undefined,
			remove: () => { e.isValid = false; },
			get stored() { return slot; },
		};
		w.displays.push(e);
		return e;
	}
	W.getDimension = () => dim;
	W.getEntity = (id: string) => { w.getEntityCalls++; return w.displays.find(e => e.id === id && e.isValid); };
	return { w, dim, display };
}

const POT = { x: 3, y: 64, z: 3 };
const POT_KEY = blockKey("minecraft:overworld", POT);

test("vaso: dropContents solta o item de TODAS as entidades do bloco (duplicata não fica órfã)", () => {
	const { w, dim, display } = potWorld();
	potStore.set(POT_KEY, { d: ["minecraft:brick", "minecraft:brick", "minecraft:brick", "minecraft:brick"], f: "north" });
	const a = display(POT, item("minecraft:diamond", 3));
	const b = display(POT, item("minecraft:emerald", 2));
	onPotDestroyed(dim, POT, false);
	assert.equal(a.isValid || b.isValid, false, "as duas removidas");
	assert.equal(w.drops.length, 3, "2 conteúdos + o vaso");
	assert.equal(potStore.get(POT_KEY), undefined);
});

test("vaso: interagir antes da entidade carregar adia (não cria uma segunda vazia)", () => {
	const { w, dim, display } = potWorld();
	w.blocks.set(k3(POT), DECORATED_POT);
	potStore.set(POT_KEY, { d: ["minecraft:brick", "minecraft:brick", "minecraft:brick", "minecraft:brick"], f: "north" });
	const block = dim.getBlock(POT);
	const held = item("minecraft:diamond", 4);
	const player: any = { isValid: true, selectedSlotIndex: 0, getGameMode: () => "Survival", getComponent: () => ({ container: { getItem: () => held, setItem: () => { } } }) };
	timeouts = [];
	interactWithPot(player, block);
	assert.equal(w.spawned, 0, "não criou entidade");
	assert.equal(timeouts.length, 1, "tentativa adiada");
	// A entidade (com o item guardado) chega antes da próxima tentativa: o item vai para ela.
	const loaded = display(POT, item("minecraft:diamond", 2));
	const retry = timeouts.shift()!;
	retry();
	assert.equal(w.spawned, 0, "usou a que carregou");
	assert.equal(loaded.stored.amount, 3);
	// Entidade que não existe mesmo: depois das tentativas, cria.
	loaded.isValid = false;
	interactWithPot(player, block, INTERACT_RETRIES);
	assert.equal(w.spawned, 1, "depois das tentativas, cria");
	potStore.delete(POT_KEY);
});

test("vaso: entidade de exibição sem vaso embaixo solta o item e some; com vaso fica", () => {
	const { w, display } = potWorld();
	const orphan = display(POT, item());
	assert.equal(removeOrphanDisplay(orphan), true);
	assert.equal(orphan.isValid, false);
	assert.equal(w.drops.length, 1);
	w.blocks.set(k3(POT), DECORATED_POT);
	const ok = display(POT, item());
	assert.equal(removeOrphanDisplay(ok), false);
	assert.equal(ok.isValid, true);
});

test("vaso: laço com id guardado (getEntity), sem setRotation repetido, vizinhos só com funil/comparador perto", () => {
	const { w, display } = potWorld();
	w.blocks.set(k3(POT), DECORATED_POT);
	potStore.set(POT_KEY, { d: ["minecraft:brick", "minecraft:brick", "minecraft:brick", "minecraft:brick"], f: "north" });
	display(POT);
	tickDecoratedPot(POT_KEY);
	assert.equal(w.getEntitiesCalls, 1, "1ª visita: busca por posição");
	const blocksFirst = w.getBlockCalls;
	assert.equal(blocksFirst, 1, "sem funil/comparador: só o bloco do vaso");
	tickDecoratedPot(POT_KEY);
	tickDecoratedPot(POT_KEY);
	assert.equal(w.getEntitiesCalls, 1, "visitas seguintes: world.getEntity");
	assert.ok(w.getEntityCalls >= 2);
	assert.equal(w.setRotationCalls, 0, "rotação já em 180: não regrava");
	w.near = true;
	const before = w.getBlockCalls;
	tickDecoratedPot(POT_KEY);
	assert.equal(w.getBlockCalls - before, 11, "com funil/comparador perto: 6 vizinhos + 4 do comparador");
	potStore.delete(POT_KEY);
});

test("vaso: laço repartido — cada vaso 1 vez a cada POT_INTERVAL ticks, ~1/8 por tick", () => {
	const { w } = potWorld();
	const keys: string[] = [];
	for (let i = 0; i < 200; i++) {
		const at = { x: (i % 20) * 2, y: 64, z: Math.floor(i / 20) * 2 };
		const key = blockKey("minecraft:overworld", at);
		keys.push(key);
		w.blocks.set(k3(at), DECORATED_POT);
		potStore.set(key, { d: ["minecraft:brick", "minecraft:brick", "minecraft:brick", "minecraft:brick"], f: "north" });
	}
	let calls = 0;
	const dim = W.getDimension();
	W.getDimension = () => { calls++; return dim; };
	const perTick: number[] = [];
	for (let t = 0; t < POT_INTERVAL; t++) {
		const c0 = calls;
		tickDecoratedPotSlice(1000 + t);
		perTick.push(calls - c0);
	}
	assert.equal(perTick.reduce((a, b) => a + b, 0), 200, "cada vaso visitado uma vez no ciclo");
	assert.ok(Math.max(...perTick) <= 45, `fatias equilibradas: ${perTick.join(",")}`);
	assert.ok(keys.every(k => potBucket(k) === potBucket(k)));
	for (const k of keys) potStore.delete(k);
});

test("vaso: bloco trocado por comando/Wither solta o vaso com as decorações e o conteúdo (confirmado em 2 visitas)", () => {
	const { w, display } = potWorld();
	w.blocks.set(k3(POT), "minecraft:air");
	potStore.set(POT_KEY, { d: ["minecraft:brick", "cobblemon:dome_sherd", "minecraft:brick", "minecraft:brick"], f: "north" });
	const d = display(POT, item("minecraft:diamond", 5));
	tickDecoratedPot(POT_KEY);
	assert.equal(w.drops.length, 0, "1ª visita só marca (a quebra por jogador chega por after-event)");
	assert.ok(potStore.get(POT_KEY));
	tickDecoratedPot(POT_KEY);
	assert.equal(w.drops.length, 2, "conteúdo + vaso");
	assert.equal(d.isValid, false);
	assert.equal(potStore.get(POT_KEY), undefined);
	// Registro apagado pelo evento de quebra entre as visitas: nada cai de novo.
	potStore.set(POT_KEY, { d: ["minecraft:brick", "minecraft:brick", "minecraft:brick", "minecraft:brick"], f: "north" });
	tickDecoratedPot(POT_KEY);
	potStore.delete(POT_KEY);
	tickDecoratedPot(POT_KEY);
	assert.equal(w.drops.length, 2);
});

test("vaso: hasHopperOrComparatorNear falha para 'talvez' (lê os vizinhos)", () => {
	const block: any = { location: POT, dimension: { containsBlock: () => { throw new Error("x"); } } };
	assert.equal(hasHopperOrComparatorNear(block), true);
});

// ---------------------------------------------------------------------------------------------
// 6. Mental Herb: maior chance de manter entre os jogadores na faixa

test("mental_restoration: phantom fica se QUALQUER jogador na faixa ainda o 'merece' (maior probabilidade)", () => {
	const mk = (id: string, x: number) => ({ id, name: id, dimension: { id: "minecraft:overworld" }, location: { x, y: 64, z: 0 }, ...entityProps() });
	const rested = mk("a", 0);
	const tired = mk("b", 3);
	setRest(rested as never, { b: 100000, c: 100000, left: 0, amp: 0 });
	setRest(tired as never, { ...newRestState(), b: 100000 });
	assert.equal(keepProbabilityFor([rested] as never), 0);
	assert.equal(keepProbabilityFor([rested, tired] as never), 1);
	restRng.next = () => 0.5;
	W.getPlayers = () => [rested, tired];
	S.currentTick = 200;
	const phantom = (x: number) => ({ location: { x, y: 90, z: 0 }, dimension: { id: "minecraft:overworld" }, removed: false, remove() { this.removed = true; } });
	const p1 = phantom(0.5);
	// O mais perto é o descansado; antes o phantom sumia mesmo com o cansado na faixa.
	assert.equal(onPhantomSpawned(p1 as never), true);
	assert.equal(p1.removed, false);
	W.getPlayers = () => [rested];
	S.currentTick = 201;
	const p2 = phantom(0.5);
	assert.equal(onPhantomSpawned(p2 as never), false);
	assert.equal(p2.removed, true);
	// Longe de todos (ex.: /summon no chão): não mexe.
	const p3 = { ...phantom(0.5), location: { x: 0.5, y: 65, z: 0 } };
	assert.equal(onPhantomSpawned(p3 as never), true);
	// Só phantom com causa "Spawned" passa pelo filtro (o /summon medido no BDS está em docs/pendencias/review-fixes.md).
	assert.ok(readFileSync(join(ROOT, "scripts/adaptacoes/mentalRestoration.ts"), "utf8").includes(`cause !== "Spawned"`));
});

// ---------------------------------------------------------------------------------------------
// 7. Redstone da panela: filtro por id antes das leituras caras; panela sem redstone perto não lê vizinhos

test("panela/redstone: getAllStates/getRedstonePower só onde as regras usam", () => {
	const probe = (typeId: string) => {
		const c = { states: 0, power: 0 };
		viewOf({ isAir: false, typeId, permutation: { getAllStates: () => { c.states++; return {}; } }, getRedstonePower: () => { c.power++; return 0; } } as never);
		return c;
	};
	assert.deepEqual(probe("minecraft:stone"), { states: 0, power: 1 });
	assert.deepEqual(probe("minecraft:redstone_wire"), { states: 1, power: 0 });
	assert.deepEqual(probe("minecraft:stone_button"), { states: 1, power: 0 });
	assert.deepEqual(probe("minecraft:powered_comparator"), { states: 1, power: 1 });
	assert.deepEqual(probe("minecraft:target"), { states: 0, power: 1 });
	assert.deepEqual(probe("minecraft:oak_door"), { states: 0, power: 0 });
	assert.deepEqual(probe("minecraft:hopper"), { states: 0, power: 0 });
	assert.deepEqual(probe("cobblemon:healing_machine"), { states: 0, power: 0 });
	assert.deepEqual(probe("cobblemon:campfire"), { states: 0, power: 0 });
	assert.deepEqual(viewOf({ isAir: true } as never), { id: "minecraft:air", states: {} });
});

test("panela/redstone: resultado igual com o filtro (condutor por alavanca presa; bloco de redstone ao lado da pedra)", () => {
	const layout = (blocks: Record<string, { typeId: string; states?: Record<string, unknown>; power?: number }>) => ({
		getBlock: (v: Vec) => {
			const b = blocks[k3(v)];
			if (!b) return { isAir: true, typeId: "minecraft:air" };
			return { isAir: false, typeId: b.typeId, permutation: { getAllStates: () => b.states ?? {} }, getRedstonePower: () => b.power ?? 0 };
		},
	});
	const lever = layout({ "1,0,0": { typeId: "minecraft:stone", power: 15 }, "2,0,0": { typeId: "minecraft:lever", states: { open_bit: true, lever_direction: "east" } } });
	assert.equal(hasNeighborSignal({ x: 0, y: 0, z: 0 }, dimensionReader(lever as never)), true);
	const block = layout({ "1,0,0": { typeId: "minecraft:stone", power: 15 }, "2,0,0": { typeId: "minecraft:redstone_block" } });
	assert.equal(hasNeighborSignal({ x: 0, y: 0, z: 0 }, dimensionReader(block as never)), false);
	const wire = layout({ "1,0,0": { typeId: "minecraft:redstone_wire", states: { redstone_signal: 7 } } });
	assert.equal(hasNeighborSignal({ x: 0, y: 0, z: 0 }, dimensionReader(wire as never)), true);
});

test("panela/redstone: laço com vizinhos sem redstone não lê estados (só a força dos possíveis condutores)", () => {
	const at = { x: 20, y: 64, z: 20 };
	const key = blockKey("minecraft:overworld", at);
	cookingStore.set(key, { powered: false } as never);
	const c = { states: 0, power: 0 };
	const dim = {
		id: "minecraft:overworld",
		isChunkLoaded: () => true,
		getBlock: (v: Vec) => {
			const self = v.x === at.x && v.y === at.y && v.z === at.z;
			return {
				isAir: false, typeId: self ? "cobblemon:campfire" : v.y < at.y ? "minecraft:stone" : "cobblemon:healing_machine", location: v, dimension: dim,
				permutation: { getAllStates: () => { c.states++; return {}; } }, getRedstonePower: () => { c.power++; return undefined; },
			};
		},
	};
	W.getDimension = () => dim;
	tickPotRedstone();
	assert.equal(c.states, 0, "nenhum getAllStates");
	assert.equal(c.power, 1, "só a pedra de baixo (possível condutor)");
	assert.ok(!readFileSync(join(ROOT, "scripts/adaptacoes/potRedstone.ts"), "utf8").includes(".containsBlock("), "pré-filtro medido como mais caro: fora");
	cookingStore.delete(key);
});

// ---------------------------------------------------------------------------------------------
// 9. Validador: JSON mesclado como o build

test("validador: checa o JSON já mesclado (overlay no mesmo caminho dobra o array e é pego)", () => {
	const gen = new Map<string, any>([
		["gen/rp/render_controllers/x.json", { render_controllers: { "controller.render.x": { arrays: { textures: { "Array.t": ["Texture.a", "Texture.b"] } } } } }],
		["gen/rp/entity/y.json", { a: 1 }],
	]);
	const hand = (f: string) => f.includes("render_controllers") ? "hand/rp/render_controllers/x.json" : undefined;
	const merged = mergedDocs(gen, hand, () => ({ render_controllers: { "controller.render.x": { arrays: { textures: { "Array.t": ["Texture.a", "Texture.b"] } } } } }));
	assert.equal(merged.get("gen/rp/render_controllers/x.json").render_controllers["controller.render.x"].arrays.textures["Array.t"].length, 4);
	assert.deepEqual(merged.get("gen/rp/entity/y.json"), { a: 1 });
	const src = readFileSync(join(ROOT, "tools/importer/validate.ts"), "utf8");
	assert.ok(src.includes("mergedDocs(docs, handCounterpart, load)"), "validate.ts usa o JSON mesclado");
});

// ---------------------------------------------------------------------------------------------
// 10. Cache negativo de estruturas: limite descarta as mais antigas

test("estruturas: cache negativo acima do limite descarta as mais antigas (ordem de inserção)", () => {
	for (const k of ["a", "b", "c", "d"]) rememberNegative(k, 10, 3);
	assert.deepEqual(negativeCacheKeys(), ["b", "c", "d"]);
	rememberNegative("b", 11, 3);
	assert.deepEqual(negativeCacheKeys(), ["c", "d", "b"], "regravada vai para o fim");
	rememberNegative("e", 12, 3);
	assert.deepEqual(negativeCacheKeys(), ["d", "b", "e"]);
	// Vencidas saem primeiro.
	rememberNegative("f", 20000, 3);
	assert.deepEqual(negativeCacheKeys(), ["f"]);
});

console.warn(`review-fixes-3: ${passed} testes OK`);
