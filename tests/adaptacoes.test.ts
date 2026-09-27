// Frente "adaptacoes": funil/comparador (panela e vaso), abelhas nas plantas do Cobblemon, dispenser (tesoura, mel,
// poção), vaso decorado com sherds do Cobblemon e Mental Herb, com as regras do Java e a API do Minecraft mockada.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { setStorageBackend } from "../scripts/machines/store";
import {
  comparatorStates, containerSignal, facesOfMask, firstAcceptingSlot, pickHopperPull, pickHopperPush, potExtractSlots, potInsertSlots,
  signalFromFraction, StackLike, touchedFace,
} from "../scripts/adaptacoes/containerLogic";
import { applyComparatorStates, comparatorReads, potSignal, potSlots, pullFromPot, pushIntoPot, setPotSlot } from "../scripts/adaptacoes/potHoppers";
import { CAMPFIRES, cookingStore, setPotPowered, type CookingPotState } from "../scripts/machines/cooking";
import { replaceBlock, replacedInPlace, REPLACE_WINDOW } from "../scripts/comparadores/replace";
import { system } from "@minecraft/server";
import { BlockView, directSignalTo, hasNeighborSignal, weakSignal, wirePointsTo } from "../scripts/adaptacoes/potRedstone";
import {
  breakDrops, canInsert, cracksWith, EMPTY_DECORATIONS, faceProperties, facingFromYaw, ingredientCounts, insertPitch, needsCobblemonPot,
  normalizeDecorations, PotDecorations, recipeDecorations, tooltipOrder, worldSides,
} from "../scripts/adaptacoes/decoratedPotLogic";
import { BRICK, COBBLEMON_SHERDS, isCobblemonSherd, isPotIngredient, patternIndex, POT_PATTERNS, VANILLA_SHERDS } from "../scripts/adaptacoes/sherds";
import { BEE_GROW_RULES, BEE_TAG_NO_EFFECT, beeGrowth, CAN_USE_FAIL, goalStep, GROW_ROLL, MAX_CROPS_PER_POLLINATION } from "../scripts/adaptacoes/bees";
import {
  bottleSlot, isDispenserTarget, isEjectPosition, randomSlot, saccharineChange, shearKind, SACCHARINE_LEAVES, SACCHARINE_LOG,
  SACCHARINE_LOG_SLATHERED,
} from "../scripts/adaptacoes/dispenser";
import {
  addMentalRestoration, advanceRest, INSOMNIA_TICKS, javaCounter, keepPhantomProbability, newRestState, phantomChance, RestState,
} from "../scripts/adaptacoes/mentalRestoration";
import { CAMPFIRE_COMPARATOR } from "../scripts/adaptacoes/flags";
import { ADAPTACOES_BLOCK_COMPONENTS } from "../scripts/custom_components/adaptacoes";

console.warn = () => { };
const seq = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const mem = new Map<string, string>();
setStorageBackend({ get: id => mem.get(id), set: (id, v) => { if (v === undefined) mem.delete(id); else mem.set(id, v); }, ids: () => [...mem.keys()] });

// ---------------------------------------------------------------------------------------------
// 1. Contêiner (HopperBlockEntity / getRedstoneSignalFromContainer / CampfireBlockEntity)
{
	// canPlaceItemThroughFace: tempero pela face de cima → temperos; o resto → grade (qualquer item pelos lados).
	assert.deepEqual(potInsertSlots("up", true), [10, 11, 12]);
	assert.deepEqual(potInsertSlots("up", false), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
	assert.deepEqual(potInsertSlots("west", true), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
	assert.deepEqual(potExtractSlots(), [0], "canTakeItemThroughFace: só o resultado");
	assert.equal(touchedFace("down"), "up", "funil em cima apontando para baixo toca a face de cima");
	assert.equal(touchedFace("east"), "west");

	const s = (id: string, n: number, max = 64): StackLike => ({ id, n, max });
	// tryMoveInItem: o primeiro espaço (em ordem) vazio OU com a mesma pilha abaixo do máximo.
	assert.equal(firstAcceptingSlot([null, s("a", 1), null], [1, 2], s("a", 1)), 1);
	assert.equal(firstAcceptingSlot([null, s("b", 1), null], [1, 2], s("a", 1)), 2);
	assert.equal(firstAcceptingSlot([null, s("a", 64), null], [1], s("a", 1)), -1, "cheio não recebe");
	assert.equal(firstAcceptingSlot([null, s("a", 1)], [1], { id: "a", n: 1, max: 64, key: "outra lore" }), -1, "componentes diferentes não empilham");

	// Mth.lerpDiscrete(f, 0, 15) = floor(f·14) + (f > 0).
	assert.equal(signalFromFraction(0), 0);
	assert.equal(signalFromFraction(1), 15);
	assert.equal(containerSignal([{ n: 1, max: 64 }], 13), 1, "1 item em 13 espaços já dá 1");
	assert.equal(containerSignal(new Array(13).fill({ n: 64, max: 64 })), 15);
	assert.equal(containerSignal([{ n: 10, max: 64 }], 1), 3, "vaso com 10 diamantes (conferido no BDS: fio = 3)");
	assert.equal(containerSignal([{ n: 1, max: 1 }], 1), 15, "item que não empilha enche o vaso");
	assert.equal(containerSignal([null], 1), 0);

	// ejectItems: tenta os espaços do funil em ordem até um entrar.
	const hopper = [s("x", 2), s("carrot", 1)];
	const target: (StackLike | null)[] = [s("x", 64), null];
	assert.equal(pickHopperPush(hopper, target, () => [0]), undefined, "nenhum espaço do funil cabe");
	assert.deepEqual(pickHopperPush(hopper, target, () => [0, 1]), { from: 0, to: 1 });
	assert.equal(pickHopperPush([s("x", 1)], [s("y", 1)], () => [0]), undefined);
	// suckInItems: só o espaço extraível, e só se couber no funil.
	assert.deepEqual(pickHopperPull([s("r", 3), s("g", 1)], [0], [null, null]), { from: 0, to: 0 });
	assert.equal(pickHopperPull([null, s("g", 1)], [0], [null]), undefined, "a grade não sai pelo funil");
	assert.equal(pickHopperPull([s("r", 3)], [0], [s("z", 64)]), undefined, "funil cheio");

	assert.deepEqual(comparatorStates(0, 15), { power: 0, mask: 0 });
	assert.deepEqual(comparatorStates(7, 0), { power: 0, mask: 0 }, "sem comparador não emite");
	assert.deepEqual(comparatorStates(7, 6), { power: 7, mask: 6 });
	assert.deepEqual(facesOfMask(6), ["east", "south"]);
	assert.equal(CAMPFIRE_COMPARATOR, true, "comparador da fogueira ligado (a fogueira não tem mais redstone_consumer)");
	// Só o comparador com a entrada virada para o bloco lê a saída (Java: o comparador lê o bloco atrás dele).
	// No Bedrock `minecraft:cardinal_direction` do comparador é o lado da entrada (medido no BDS).
	assert.equal(comparatorReads({ typeId: "minecraft:unpowered_comparator", cardinal: "south" }, "north"), true, "ao norte, entrada ao sul = virada para o bloco");
	assert.equal(comparatorReads({ typeId: "minecraft:powered_comparator", cardinal: "north" }, "north"), false, "ao norte apontando para o bloco");
	assert.equal(comparatorReads({ typeId: "minecraft:unpowered_comparator", cardinal: "north" }, "east"), false, "de lado");
	assert.equal(comparatorReads({ typeId: "minecraft:hopper", cardinal: "south" }, "north"), false);
}

// ---------------------------------------------------------------------------------------------
// 1b. Tampa por redstone (CampfireBlock.neighborChanged / Level.hasNeighborSignal), panela em (0,0,0)
{
	const world = new Map<string, BlockView>();
	const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
	const put = (x: number, y: number, z: number, id: string, states: BlockView["states"] = {}, power?: number) =>
		world.set(k(x, y, z), { id: `minecraft:${id}`.replace("minecraft:cobblemon:", "cobblemon:"), states, power });
	const read = (p: { x: number; y: number; z: number }) => world.get(k(p.x, p.y, p.z)) ?? { id: "minecraft:air", states: {} };
	const powered = () => hasNeighborSignal({ x: 0, y: 0, z: 0 }, read);
	const reset = () => { world.clear(); put(0, 0, 0, "cobblemon:campfire", { "cobblemon:comparator": 7, "cobblemon:comparator_faces": 1 }, 7); };

	reset();
	assert.equal(powered(), false, "sem vizinhos; a saída do comparador da própria panela (7) não conta");
	// Fontes diretas (sinal fraco basta para a panela).
	put(1, 0, 0, "lever", { lever_direction: "up_north_south", open_bit: true }, 15);
	assert.equal(powered(), true, "alavanca ligada ao lado");
	put(1, 0, 0, "lever", { lever_direction: "up_north_south", open_bit: false }, 0);
	assert.equal(powered(), false, "alavanca desligada");
	reset(); put(-1, 0, 0, "redstone_block", {}, 15);
	assert.equal(powered(), true, "bloco de redstone ao lado");
	reset(); put(0, 0, 1, "redstone_wire", { redstone_signal: 5 }, 5);
	assert.equal(powered(), true, "fio ao lado (liga na panela: isSignalSource)");
	reset(); put(0, -1, 0, "redstone_wire", { redstone_signal: 15 }, 15);
	assert.equal(powered(), false, "fio embaixo não alimenta o bloco de cima");
	reset(); put(1, 0, 0, "powered_repeater", { "minecraft:cardinal_direction": "east" }, 15);
	assert.equal(powered(), true, "repetidor com a saída para a panela (entrada a leste)");
	put(1, 0, 0, "powered_repeater", { "minecraft:cardinal_direction": "west" }, 15);
	assert.equal(powered(), false, "repetidor virado para fora");
	reset(); put(0, 0, -1, "powered_comparator", { "minecraft:cardinal_direction": "south" }, 7);
	assert.equal(powered(), false, "comparador lendo a panela (saída para o norte) não fecha a tampa");
	put(0, 0, -1, "powered_comparator", { "minecraft:cardinal_direction": "north" }, 7);
	assert.equal(powered(), true, "comparador apontando para a panela");
	assert.equal(weakSignal({ id: "minecraft:powered_comparator", states: { "minecraft:cardinal_direction": "north" }, power: 7 }, "south"), 7);
	reset(); put(1, 0, 0, "redstone_torch", { torch_facing_direction: "top" }, 15);
	assert.equal(powered(), true, "tocha no chão ao lado");
	reset(); put(0, 1, 0, "redstone_torch", { torch_facing_direction: "top" }, 15);
	assert.equal(powered(), false, "tocha em cima (a panela é o apoio)");
	reset(); put(1, 0, 0, "redstone_torch", { torch_facing_direction: "west" }, 15);
	assert.equal(powered(), false, "tocha de parede presa na panela (Bedrock: valor = lado do apoio)");
	reset(); put(1, 0, 0, "observer", { "minecraft:facing_direction": "east", powered_bit: true }, 15);
	assert.equal(powered(), true, "observador com a traseira na panela");
	put(1, 0, 0, "observer", { "minecraft:facing_direction": "west", powered_bit: true }, 15);
	assert.equal(powered(), false, "observador olhando para a panela");
	reset(); put(1, 0, 0, "stone_pressure_plate", { redstone_signal: 15 }, 15);
	assert.equal(powered(), true, "placa de pressão");
	reset(); put(1, 0, 0, "stone_button", { facing_direction: 1, button_pressed_bit: true }, 15);
	assert.equal(powered(), true, "botão apertado");

	// Bloco condutor (pedra) ao lado: só energizado por sinal direto (Level.getDirectSignalTo). O Bedrock dá 15 à
	// pedra em todos estes casos (medido), então a força dela é só o filtro.
	reset(); put(1, 0, 0, "stone", {}, 15); put(2, 0, 0, "lever", { lever_direction: "east", open_bit: true }, 15);
	assert.equal(powered(), true, "alavanca presa na pedra (aponta para leste, apoio a oeste)");
	put(2, 0, 0, "lever", { lever_direction: "up_north_south", open_bit: true }, 15);
	assert.equal(powered(), false, "alavanca no chão ao lado da pedra não a energiza");
	reset(); put(1, 0, 0, "stone", {}, 15); put(2, 0, 0, "redstone_block", {}, 15);
	assert.equal(powered(), false, "bloco de redstone não energiza a pedra (medido: a lâmpada do outro lado fica apagada)");
	reset(); put(1, 0, 0, "stone", {}, 15); put(1, -1, 0, "redstone_torch", { torch_facing_direction: "top" }, 15);
	assert.equal(powered(), true, "tocha embaixo da pedra");
	reset(); put(1, 0, 0, "stone", {}, 0); put(2, 0, 0, "redstone_torch", { torch_facing_direction: "top" }, 15);
	assert.equal(powered(), false, "tocha ao lado da pedra");
	reset(); put(1, 0, 0, "stone", {}, 15); put(1, 1, 0, "redstone_wire", { redstone_signal: 15 }, 15);
	assert.equal(powered(), true, "pó em cima da pedra");
	reset(); put(1, 0, 0, "stone", {}, 15); put(2, 0, 0, "redstone_wire", { redstone_signal: 15 }, 15);
	assert.equal(powered(), true, "pó solto (em cruz) ao lado da pedra aponta para ela");
	put(2, 0, -1, "redstone_wire", { redstone_signal: 15 }, 15); put(2, 0, 1, "redstone_wire", { redstone_signal: 15 }, 15);
	assert.equal(wirePointsTo({ x: 2, y: 0, z: 0 }, "west", read), false);
	assert.equal(powered(), false, "pó em linha norte-sul passa pela pedra sem apontar para ela");
	reset(); put(1, 0, 0, "stone", {}, 15); put(2, 0, 0, "redstone_wire", { redstone_signal: 15 }, 15); put(3, 0, 0, "redstone_block", {}, 15);
	put(2, 0, -1, "redstone_wire", { redstone_signal: 14 }, 14);
	assert.equal(powered(), false, "pó em curva (norte + leste) não aponta para oeste");
	world.delete(k(2, 0, -1));
	assert.equal(powered(), true, "pó ligado só a leste se estende para oeste (linha)");
	reset(); put(1, 0, 0, "stone", {}, 15); put(2, 0, 0, "powered_repeater", { "minecraft:cardinal_direction": "east" }, 15);
	assert.equal(directSignalTo({ x: 1, y: 0, z: 0 }, read), 15);
	assert.equal(powered(), true, "repetidor apontando para a pedra");
	reset(); put(1, 0, 0, "redstone_lamp", {}, 15); put(1, 1, 0, "lever", { lever_direction: "up_east_west", open_bit: true }, 15);
	assert.equal(powered(), true, "lâmpada é condutor (alavanca presa em cima)");
	reset(); put(1, 0, 0, "hopper", { toggle_bit: true }, 15); put(1, 1, 0, "lever", { lever_direction: "up_east_west", open_bit: true }, 15);
	assert.equal(powered(), false, "funil não é condutor");
	reset(); put(1, 0, 0, "stone", {}, undefined); put(2, 0, 0, "lever", { lever_direction: "east", open_bit: true }, 15);
	assert.equal(powered(), false, "sem força no Bedrock a pedra nem é examinada (filtro barato)");

	// Blocos do Cobblemon: produtores pelo estado; o vaso e outra fogueira (saída de comparador) não são fonte.
	reset(); put(1, 0, 0, "cobblemon:ring_target", { "cobblemon:power": 12 });
	assert.equal(powered(), true, "Ring Target");
	reset(); put(1, 0, 0, "cobblemon:apricorn_button", { "minecraft:block_face": "up", "cobblemon:pressed": true });
	assert.equal(powered(), true, "botão do Cobblemon apertado");
	reset(); put(1, 0, 0, "stone", {}, 15); put(1, 1, 0, "cobblemon:apricorn_button", { "minecraft:block_face": "up", "cobblemon:pressed": true });
	assert.equal(powered(), true, "botão do Cobblemon preso em cima da pedra");
	reset(); put(1, 0, 0, "cobblemon:decorated_pot", { "cobblemon:comparator": 3, "cobblemon:comparator_faces": 2 }, 3);
	put(-1, 0, 0, "cobblemon:campfire", { "cobblemon:comparator": 9, "cobblemon:comparator_faces": 8 }, 9);
	assert.equal(powered(), false, "vaso e fogueira com comparador ao lado");

	// setPotPowered: grava `powered` e abre/fecha a tampa só na mudança (CampfireBlock.neighborChanged).
	const key = "minecraft:overworld|0|0|0";
	const sounds: string[] = [];
	const dim = { playSound: (id: string) => sounds.push(id) } as never;
	cookingStore.set(key, { pot: "cobblemon:campfire_pot_red", grid: new Array(9).fill(null), seasonings: [null, null, null], result: null, progress: 0, lid: false });
	assert.equal(setPotPowered(dim, key, true), "close");
	assert.deepEqual([cookingStore.get(key)!.lid, cookingStore.get(key)!.powered], [true, true]);
	assert.equal(setPotPowered(dim, key, true), undefined, "sinal constante não mexe");
	const st = cookingStore.get(key)!; st.lid = false; cookingStore.set(key, st);
	assert.equal(setPotPowered(dim, key, true), undefined, "aberta pela tela com o sinal ligado continua aberta");
	assert.equal(setPotPowered(dim, key, false), undefined, "sinal sumiu com a tampa já aberta");
	assert.equal(cookingStore.get(key)!.powered, false);
	assert.equal(setPotPowered(dim, key, true), "close");
	assert.equal(setPotPowered(dim, key, false), "open");
	assert.deepEqual(sounds, ["cobblemon.block.campfire_pot.close", "cobblemon.block.campfire_pot.close", "cobblemon.block.campfire_pot.open"]);
	assert.equal(setPotPowered(dim, "minecraft:overworld|9|9|9", true), undefined, "sem panela");
	cookingStore.delete(key);
}

// ---------------------------------------------------------------------------------------------
// 2. Funil na panela (runtime com contêineres falsos)
{
	class FakeItem {
		constructor(public typeId: string, public amount: number, public maxAmount = 64) { }
		clone() { return new FakeItem(this.typeId, this.amount, this.maxAmount); }
		// A reconstrução do SlotItem (isPlainStack) vem do ItemStack mockado: conta como a mesma pilha.
		isStackableWith(other: unknown) { return !(other instanceof FakeItem) || other.typeId === this.typeId; }
		getRawLore() { return []; }
		getDynamicPropertyIds() { return []; }
		getComponent() { return undefined; }
		nameTag: string | undefined = undefined;
	}
	class FakeContainer {
		items: (FakeItem | undefined)[];
		constructor(items: (FakeItem | undefined)[]) { this.items = items; }
		get size() { return this.items.length; }
		getItem(i: number) { return this.items[i]; }
		setItem(i: number, it?: FakeItem) { this.items[i] = it; }
	}
	const pot = (): CookingPotState => ({ pot: "cobblemon:campfire_pot_red", grid: new Array(9).fill(null), seasonings: [null, null, null], result: null, progress: 0, lid: false });
	const state = pot();
	const top = new FakeContainer([new FakeItem("cobblemon:oran_berry", 2), new FakeItem("minecraft:stick", 2), undefined, undefined, undefined]);
	// Com o mock, maxStackOf devolve 64 (ItemStack falso): o que importa é a ordem dos espaços.
	assert.ok(pushIntoPot(state, top as never, "up"));
	assert.equal(state.seasonings[0]?.id, "cobblemon:oran_berry", "tempero por cima vai para os temperos");
	assert.ok(pushIntoPot(state, top as never, "up"));
	assert.equal(state.seasonings[0]?.n, 2, "a mesma pilha junta");
	assert.ok(pushIntoPot(state, top as never, "up"));
	assert.equal(state.grid[0]?.id, "minecraft:stick", "o resto vai para a grade");
	const side = new FakeContainer([new FakeItem("minecraft:apple", 1)]);
	assert.ok(pushIntoPot(state, side as never, "west"));
	assert.equal(state.grid[1]?.id, "minecraft:apple", "tempero pelo lado vai para a grade");
	assert.equal(side.getItem(0), undefined, "tirou do funil");
	state.result = { id: "cobblemon:ponigiri", n: 2 };
	// Funil de baixo com a mesma pilha: junta 1 por vez.
	const below = new FakeContainer([new FakeItem("cobblemon:ponigiri", 1), undefined]);
	assert.ok(pullFromPot(state, below as never));
	assert.equal(below.getItem(0)?.amount, 2);
	assert.equal(state.result?.n, 1);
	assert.ok(pullFromPot(state, below as never));
	assert.equal(below.getItem(0)?.amount, 3);
	assert.equal(state.result, null);
	assert.ok(!pullFromPot(state, below as never), "grade não sai por baixo");
	assert.equal(potSlots(state).length, 13);
	setPotSlot(state, 12, { id: "minecraft:sugar", n: 1 });
	assert.equal(state.seasonings[2]?.id, "minecraft:sugar");
	assert.equal(potSignal(pot()), 0);
	assert.equal(potSignal(state, () => 64), 1);
}

// ---------------------------------------------------------------------------------------------
// 3. Sherds e vaso decorado
{
	assert.equal(VANILLA_SHERDS.length, 23, "sherds do MC 1.21.1");
	assert.deepEqual([...COBBLEMON_SHERDS], ["bygone", "capture", "dome", "helix", "nostalgic", "suspicious"]);
	assert.equal(POT_PATTERNS.length, 30);
	assert.equal(patternIndex(BRICK), 0);
	assert.equal(patternIndex("minecraft:angler_pottery_sherd"), 1);
	assert.equal(patternIndex("cobblemon:dome_sherd"), 26);
	assert.equal(patternIndex("cobblemon:helix_sherd"), 27, "conferido no BDS (propriedade face_south = 27)");
	assert.ok(isCobblemonSherd("cobblemon:nostalgic_sherd") && !isCobblemonSherd("minecraft:skull_pottery_sherd") && !isCobblemonSherd(BRICK));
	assert.ok(isPotIngredient(BRICK) && !isPotIngredient("minecraft:stick"));
	assert.equal(POT_PATTERNS[26].texture, "textures/entity/decorated_pot/dome_pottery_pattern");
	assert.equal(POT_PATTERNS[1].texture, "textures/blocks/angler_pottery_pattern");

	const d: PotDecorations = [BRICK, "cobblemon:dome_sherd", "minecraft:angler_pottery_sherd", "cobblemon:helix_sherd"];
	// Olhando para o norte: frente para o sul (virada para o jogador), esquerda a oeste, direita a leste.
	assert.deepEqual(worldSides("north", d), { north: BRICK, south: "cobblemon:helix_sherd", west: "cobblemon:dome_sherd", east: "minecraft:angler_pottery_sherd" });
	assert.deepEqual(worldSides("east", d), { east: BRICK, west: "cobblemon:helix_sherd", north: "cobblemon:dome_sherd", south: "minecraft:angler_pottery_sherd" });
	assert.deepEqual(faceProperties("north", d), { north: 0, east: 1, south: 27, west: 26 });
	assert.equal(facingFromYaw(180), "north");
	assert.equal(facingFromYaw(-180), "north");
	assert.equal(facingFromYaw(0), "south");
	assert.equal(facingFromYaw(90), "west");
	assert.equal(facingFromYaw(-90), "east");

	// DecoratedPotRecipe: cima/esquerda/direita/baixo = fundo/esquerda/direita/frente; cantos e centro vazios.
	const grid = [null, "cobblemon:dome_sherd", null, BRICK, null, "minecraft:angler_pottery_sherd", null, "cobblemon:helix_sherd", null];
	assert.deepEqual(recipeDecorations(grid), ["cobblemon:dome_sherd", BRICK, "minecraft:angler_pottery_sherd", "cobblemon:helix_sherd"]);
	assert.equal(recipeDecorations([BRICK, ...grid.slice(1)]), undefined, "canto ocupado");
	assert.equal(recipeDecorations([null, "minecraft:stick", null, BRICK, null, BRICK, null, BRICK, null]), undefined);
	assert.ok(needsCobblemonPot(d));
	assert.ok(!needsCobblemonPot([BRICK, "minecraft:angler_pottery_sherd", BRICK, BRICK]), "só vanilla fica no vaso vanilla");
	assert.deepEqual([...ingredientCounts(["cobblemon:dome_sherd", "cobblemon:dome_sherd", BRICK, BRICK])], [["cobblemon:dome_sherd", 2], [BRICK, 2]]);
	assert.deepEqual(tooltipOrder(d), ["cobblemon:helix_sherd", "cobblemon:dome_sherd", "minecraft:angler_pottery_sherd", BRICK], "dica: frente, esquerda, direita, fundo");
	assert.deepEqual(normalizeDecorations(["cobblemon:dome_sherd", "minecraft:stick"]), ["cobblemon:dome_sherd", BRICK, BRICK, BRICK]);
	assert.deepEqual(normalizeDecorations(undefined), EMPTY_DECORATIONS);

	// playerWillDestroy + loot table.
	assert.ok(cracksWith("minecraft:iron_pickaxe", ["minecraft:is_pickaxe"], false));
	assert.ok(!cracksWith("minecraft:iron_pickaxe", ["minecraft:is_pickaxe"], true), "Toque Suave não racha");
	assert.ok(cracksWith("minecraft:trident", [], false) && cracksWith("minecraft:mace", [], false));
	assert.ok(!cracksWith(undefined, [], false), "mão vazia solta o vaso");
	assert.ok(!cracksWith("minecraft:shears", [], false));
	assert.deepEqual(breakDrops(d, true), { items: d, pot: false });
	assert.deepEqual(breakDrops(d, false), { items: [], pot: true });

	// useItemOn: vazio aceita; mesma pilha até o máximo.
	assert.ok(canInsert(undefined, false));
	assert.ok(canInsert({ n: 3, max: 64 }, true));
	assert.ok(!canInsert({ n: 3, max: 64 }, false));
	assert.ok(!canInsert({ n: 64, max: 64 }, true));
	assert.equal(insertPitch({ n: 64, max: 64 }), 1.2);
	assert.equal(insertPitch({ n: 32, max: 64 }), 0.95);

	assert.ok(ADAPTACOES_BLOCK_COMPONENTS["cobblemon:decorated_pot"], "componente do vaso registrado");
}

// ---------------------------------------------------------------------------------------------
// 4. Abelhas (BeeGrowCropGoal + BeeEntityMixin)
{
	assert.equal(GROW_ROLL, 15, "adjustedTickDelay(30) com metas a cada 2 ticks");
	assert.equal(CAN_USE_FAIL, 0.3);
	assert.equal(MAX_CROPS_PER_POLLINATION, 10);
	// Parada: sem néctar/limite a meta não roda.
	assert.deepEqual(goalStep(true, false, seq(0)), { running: false, grow: false });
	// Parada: 0,1 < 0,3 para; 0,5 recomeça no mesmo tick; 0 sorteia o crescimento.
	assert.deepEqual(goalStep(true, true, seq(0.1, 0.5, 0)), { running: true, grow: true });
	// Parada sem recomeço: 0,1 para, 0,2 não recomeça.
	assert.deepEqual(goalStep(true, true, seq(0.1, 0.2)), { running: false, grow: false });
	// Rodando e ficou: 0,9 mantém; 0,5 → floor(7,5) ≠ 0.
	assert.deepEqual(goalStep(true, true, seq(0.9, 0.5)), { running: true, grow: false });
	// Taxa média ≈ P(rodando) / 15 com P(rodando) = 0,7 / 0,79 (estacionário).
	let running = false, grows = 0;
	const N = 200000;
	for (let i = 0; i < N; i++) { const r = goalStep(running, true, Math.random); running = r.running; if (r.grow) grows++; }
	const expected = (0.7 / 0.79) / 15;
	assert.ok(Math.abs(grows / N - expected) < 0.004, `taxa ${grows / N} ≈ ${expected}`);

	assert.equal(beeGrowth("cobblemon:red_mint", 0, false), 1);
	assert.equal(beeGrowth("cobblemon:red_mint", 7, false), undefined, "madura não cresce");
	assert.equal(beeGrowth("cobblemon:vivichoke_seeds", 6, false), 7);
	assert.equal(beeGrowth("cobblemon:medicinal_leek", 3, false), undefined);
	assert.equal(beeGrowth("cobblemon:revival_herb", 7, false), 8);
	assert.deepEqual(BEE_GROW_RULES["cobblemon:revival_herb"].reset, { "cobblemon:mutation": "none" }, "getStateForAge volta ao estado padrão (conferido no BDS)");
	assert.equal(beeGrowth("cobblemon:saccharine_leaves", 1, false), 2);
	assert.equal(beeGrowth("cobblemon:saccharine_leaves", 1, true), undefined, "folha com água não cresce (mixin)");
	for (const id of BEE_TAG_NO_EFFECT) assert.equal(beeGrowth(id, 0, false), undefined, `${id}: na tag, mas o Java não faz crescer`);
	assert.equal(beeGrowth("cobblemon:oran_berry", 0, false), undefined, "berries fora da tag");
	assert.equal(Object.keys(BEE_GROW_RULES).length, 10, "6 mints + vivichoke + revival herb + leek + folha");
}

// ---------------------------------------------------------------------------------------------
// 5. Dispenser (ShearsDispenserBehaviorMixin + DispenserBehaviorRegistry)
{
	assert.equal(shearKind("cobblemon:oran_berry"), "berry");
	assert.equal(shearKind("cobblemon:red_apricorn_block"), "apricorn");
	assert.equal(shearKind("cobblemon:white_apricorn_block_generated"), "apricorn");
	assert.equal(shearKind("cobblemon:big_root"), "root");
	assert.equal(shearKind("cobblemon:energy_root"), "root");
	assert.equal(shearKind("cobblemon:saccharine_leaves"), undefined);
	assert.ok(isDispenserTarget(SACCHARINE_LEAVES) && isDispenserTarget(SACCHARINE_LOG) && !isDispenserTarget("minecraft:dirt"));

	// getRandomSlot: sorteio uniforme entre os espaços com item.
	assert.equal(randomSlot([false, false]), -1);
	assert.equal(randomSlot([false, true, false], seq(0.99)), 1);
	const hits = [0, 0, 0, 0];
	for (let i = 0; i < 40000; i++) hits[randomSlot([true, false, true, true])]++;
	assert.equal(hits[1], 0);
	for (const i of [0, 2, 3]) assert.ok(Math.abs(hits[i] / 40000 - 1 / 3) < 0.02, `espaço ${i}: ${hits[i]}`);

	// Mel/poção na saccharine.
	assert.deepEqual(saccharineChange("honey", SACCHARINE_LOG, 0, true), { kind: "slather" });
	assert.equal(saccharineChange("honey", SACCHARINE_LOG, 0, false), undefined, "tora deitada: a tora com mel do port só existe em pé");
	assert.deepEqual(saccharineChange("potion", SACCHARINE_LOG_SLATHERED, 0, true), { kind: "wash" });
	assert.equal(saccharineChange("honey", SACCHARINE_LOG_SLATHERED, 0, true), undefined);
	assert.deepEqual(saccharineChange("honey", SACCHARINE_LEAVES, 0, true), { kind: "leaf", age: 2 }, "idade + 2 (máx. 2)");
	assert.deepEqual(saccharineChange("honey", SACCHARINE_LEAVES, 1, true), { kind: "leaf", age: 2 });
	assert.equal(saccharineChange("honey", SACCHARINE_LEAVES, 2, true), undefined, "cheia: o mel sai como item");
	assert.deepEqual(saccharineChange("potion", SACCHARINE_LEAVES, 2, true), { kind: "leaf", age: 0 });
	assert.deepEqual(saccharineChange("potion", SACCHARINE_LEAVES, 1, true), { kind: "leaf", age: 0 });
	assert.equal(saccharineChange("potion", SACCHARINE_LEAVES, 0, true), undefined);
	// changeLogTypeDispenser: primeiro espaço vazio ou com garrafa vazia < 16.
	assert.equal(bottleSlot([{ id: "minecraft:honey_bottle", n: 2 }, null]), 1);
	assert.equal(bottleSlot([{ id: "minecraft:glass_bottle", n: 15 }, null]), 0);
	assert.equal(bottleSlot([{ id: "minecraft:glass_bottle", n: 16 }, null]), 1);
	assert.equal(bottleSlot([{ id: "minecraft:dirt", n: 1 }]), -1, "sem lugar: cai no chão");

	// Posições de ejeção medidas no BDS (dispenser virado para leste).
	assert.ok(isEjectPosition({ x: 2.88, y: 100.1, z: 5.25 }, { x: 2, y: 100, z: 5 }, "east"), "mel ejetado");
	assert.ok(isEjectPosition({ x: 3.44, y: 100.28, z: 2.57 }, { x: 2, y: 100, z: 2 }, "east"), "terra ejetada");
	assert.ok(!isEjectPosition({ x: 2.1, y: 100.5, z: 2.5 }, { x: 2, y: 100, z: 2 }, "east"), "atrás da boca");
	assert.ok(!isEjectPosition({ x: 3.44, y: 100.28, z: 2.57 }, { x: 2, y: 100, z: 2 }, "west"), "outro lado");
}

// ---------------------------------------------------------------------------------------------
// 6. Mental Herb (MentalRestorationEffect + PhantomSpawner)
{
	assert.equal(phantomChance(0), 0);
	assert.equal(phantomChance(INSOMNIA_TICKS), 0);
	assert.equal(phantomChance(144000), 0.5);
	// Tempero Mental Herb: 200 ticks, nível 0 → desconta 31 × 200 = 6200 (conferido no BDS).
	let s: RestState = { b: 75000, c: 0, left: 0, amp: 0 };
	s = addMentalRestoration(s, 200, 0);
	for (let i = 0; i < 10; i++) s = advanceRest(s, 20, false);
	assert.deepEqual(s, { b: 75200, c: 6200, left: 0, amp: 0 });
	assert.equal(javaCounter(s), 69000);
	assert.equal(keepPhantomProbability(s), 0, "abaixo de 72000 nenhum phantom fica");
	// Sem desconto o Bedrock decide sozinho.
	assert.equal(keepPhantomProbability({ b: 100000, c: 0, left: 0, amp: 0 }), 1);
	// Taxa do Java: p(J)/p(B).
	const r = keepPhantomProbability({ b: 100000, c: 6200, left: 0, amp: 0 });
	assert.ok(Math.abs(r - phantomChance(93800) / phantomChance(100000)) < 1e-9);
	// Contador do Bedrock abaixo do limite (instalado com insônia antiga): conta como 72001.
	assert.equal(keepPhantomProbability({ b: 0, c: 10, left: 0, amp: 0 }), 0);
	// Nunca abaixo de 0 (o laço real anda de 20 em 20 ticks): fica em 0 durante o efeito e volta a subir 1 por tick.
	let low: RestState = addMentalRestoration({ b: 100, c: 0, left: 0, amp: 0 }, 200, 1);
	low = advanceRest(low, 20, false);
	assert.equal(low.c, 120);
	assert.equal(javaCounter(low), 0);
	for (let i = 0; i < 9; i++) low = advanceRest(low, 20, false);
	assert.equal(javaCounter(low), 0);
	for (let i = 0; i < 100; i++) low = advanceRest(low, 20, false);
	assert.equal(javaCounter(low), 2000);
	// Dormir zera.
	assert.deepEqual(advanceRest({ b: 90000, c: 100, left: 0, amp: 0 }, 20, true), newRestState());
	// MobEffectInstance.update: nível maior substitui, mesmo nível estica, menor não muda.
	assert.deepEqual(addMentalRestoration({ b: 0, c: 0, left: 50, amp: 0 }, 200, 0), { b: 0, c: 0, left: 200, amp: 0 });
	assert.deepEqual(addMentalRestoration({ b: 0, c: 0, left: 300, amp: 0 }, 200, 0), { b: 0, c: 0, left: 300, amp: 0 });
	assert.deepEqual(addMentalRestoration({ b: 0, c: 0, left: 300, amp: 0 }, 100, 2), { b: 0, c: 0, left: 100, amp: 2 });
	assert.deepEqual(addMentalRestoration({ b: 0, c: 0, left: 300, amp: 2 }, 900, 0), { b: 0, c: 0, left: 300, amp: 2 });
}

// ---------------------------------------------------------------------------------------------
// 7. Conteúdo gerado e textos
{
	const root = `${process.cwd()}/`;
	const gen = `${root}generated`;
	if (existsSync(`${gen}/behavior_packs/CobblemonBedrock/blocks/adaptacoes/decorated_pot.json`)) {
		const block = JSON.parse(readFileSync(`${gen}/behavior_packs/CobblemonBedrock/blocks/adaptacoes/decorated_pot.json`, "utf8"))["minecraft:block"];
		assert.equal(block.permutations.length, 225, "força 1..15 × máscara 1..15");
		const p = block.permutations.find((x: any) => x.condition.includes("== 3 &&") && x.condition.endsWith("== 2"));
		assert.deepEqual(p.components["minecraft:redstone_producer"], { power: 3, connected_faces: ["east"] });
		assert.ok(block.components["cobblemon:decorated_pot"]);
		const entity = JSON.parse(readFileSync(`${gen}/resource_packs/CobblemonBedrock/entity/display/decorated_pot_display.entity.json`, "utf8"));
		assert.equal(Object.keys(entity["minecraft:client_entity"].description.textures).length, 30);
		for (const n of COBBLEMON_SHERDS) assert.ok(existsSync(`${gen}/resource_packs/CobblemonBedrock/textures/entity/decorated_pot/${n}_pottery_pattern.png`), n);
		for (const name of ["campfire", "soul_campfire"]) {
			const j = JSON.parse(readFileSync(`${gen}/behavior_packs/CobblemonBedrock/blocks/cobblemon/${name}.json`, "utf8"));
			const campfire = j["minecraft:block"];
			assert.deepEqual(campfire.description.states?.["cobblemon:comparator"], Array.from({ length: 16 }, (_, i) => i), `${name}: estados do comparador`);
			assert.equal(campfire.permutations.filter((x: any) => x.components["minecraft:redstone_producer"]).length, 225, `${name}: força × máscara`);
			assert.equal(campfire.components["minecraft:redstone_consumer"], undefined, `${name}: sem consumer`);
			assert.ok(j.format_version >= "1.21.120", `${name}: formato do redstone_producer`);
		}
	}
	// O complemento manual da mundo-sons com o consumer não pode voltar (o build mescla por cima do gerado).
	for (const name of ["campfire", "soul_campfire"]) {
		assert.ok(!existsSync(`${root}behavior_packs/CobblemonBedrock/blocks/cobblemon/${name}.json`), `${name}: sem complemento com redstone_consumer`);
	}
	for (const lang of ["en_US", "pt_BR"]) {
		const text = readFileSync(`${root}resource_packs/CobblemonBedrock/texts/${lang}.lang`, "utf8");
		const section = text.slice(text.indexOf("## adaptacoes"));
		for (const key of ["item.cobblemon.decorated_pot", "cobblemon.adaptacoes.pot.title", "cobblemon.adaptacoes.pot.back", "cobblemon.adaptacoes.pot.left",
			"cobblemon.adaptacoes.pot.right", "cobblemon.adaptacoes.pot.front", "cobblemon.adaptacoes.pot.craft", "cobblemon.adaptacoes.pot.need_cobblemon",
			"cobblemon.adaptacoes.pot.missing"]) assert.ok(section.includes(`${key}=`), `${lang}: ${key}`);
	}
}

// ---------------------------------------------------------------------------------------------
// 8. Comparador da panela/vaso com as duas limitações do redstone_producer do Bedrock (medidas no BDS, ver
//    docs/pendencias/comparadores.md, "Panela e vaso"): produtor base de força 0 (esvaziar não deixa o sinal preso) e
//    bloco recolocado no mesmo tick quando as faces mudam (norte → oeste religa), sem perder a panela.
{
	type States = Record<string, unknown>;
	class FakePerm {
		constructor(readonly states: States, readonly type: string) { }
		getState(k: string) { return this.states[k]; }
		withState(k: string, v: unknown) { return new FakePerm({ ...this.states, [k]: v }, this.type); }
	}
	class FakeBlock {
		replaced = 0;
		writes = 0;
		isWaterlogged = false;
		readonly dimension = { id: "minecraft:overworld" };
		constructor(public typeId: string, public permutation: FakePerm, readonly location = { x: 4, y: 64, z: -2 }) { }
		setType(t: string) { this.typeId = t; this.permutation = new FakePerm({}, t); this.replaced++; this.isWaterlogged = false; }
		setPermutation(p: FakePerm) { this.permutation = p; this.typeId = p.type; this.writes++; }
		setWaterlogged(w: boolean) { this.isWaterlogged = w; }
	}
	const sys = system as unknown as { currentTick: number };
	Object.assign(system, { currentTick: 1000 });
	for (const type of ["cobblemon:campfire", "cobblemon:decorated_pot"]) {
		const block = new FakeBlock(type, new FakePerm({ "cobblemon:comparator": 7, "cobblemon:comparator_faces": 1, "minecraft:cardinal_direction": "east" }, type));
		block.isWaterlogged = true;
		// Só a força muda: a permutação basta (a queda entre produtores propaga).
		assert.equal(applyComparatorStates(block as never, 4, 1), true);
		assert.equal(block.replaced, 0, `${type}: mudança só de força não recoloca`);
		assert.equal(block.permutation.getState("cobblemon:comparator"), 4);
		// Comparador trocado de norte para oeste: faces mudam → recolocado, com os outros estados e a água.
		assert.equal(applyComparatorStates(block as never, 4, 8), true);
		assert.equal(block.replaced, 1, `${type}: faces mudaram, bloco recolocado`);
		assert.equal(block.typeId, type);
		assert.deepEqual(block.permutation.states, { "cobblemon:comparator": 4, "cobblemon:comparator_faces": 8, "minecraft:cardinal_direction": "east" });
		assert.equal(block.isWaterlogged, true, `${type}: água mantida`);
		assert.equal(applyComparatorStates(block as never, 4, 8), false, "sem mudança não grava");
		// Esvaziar: estados zerados (força 0, máscara 0) → faces mudam → recolocado.
		assert.equal(applyComparatorStates(block as never, 0, 8), true);
		assert.deepEqual([block.permutation.getState("cobblemon:comparator"), block.permutation.getState("cobblemon:comparator_faces")], [0, 0]);
		assert.equal(block.replaced, 2);
	}
	// O onBreak que a recolocação dispara (chega alguns ticks depois, com o bloco de volta) não conta como quebra.
	const campfire = new FakeBlock("cobblemon:campfire", new FakePerm({ "cobblemon:comparator": 3, "cobblemon:comparator_faces": 1 }, "cobblemon:campfire"), { x: 9, y: 70, z: 9 });
	assert.equal(replacedInPlace("minecraft:overworld", campfire.location, "cobblemon:campfire", CAMPFIRES), false, "sem recolocação: quebra de verdade");
	replaceBlock(campfire as never, campfire.permutation as never);
	sys.currentTick += 5;
	assert.equal(replacedInPlace("minecraft:overworld", campfire.location, "cobblemon:campfire", CAMPFIRES), true, "recolocada e ainda fogueira: panela fica");
	assert.equal(replacedInPlace("minecraft:overworld", campfire.location, "minecraft:air", CAMPFIRES), false, "quebrada logo depois: solta");
	assert.equal(replacedInPlace("minecraft:nether", campfire.location, "cobblemon:campfire", CAMPFIRES), false, "outra dimensão");
	sys.currentTick += REPLACE_WINDOW + 1;
	assert.equal(replacedInPlace("minecraft:overworld", campfire.location, "cobblemon:campfire", CAMPFIRES), false, "janela vencida");

	// Conteúdo gerado: produtor base de força 0 sem faces na panela e no vaso.
	const gen = `${process.cwd()}/generated/behavior_packs/CobblemonBedrock/blocks`;
	for (const file of [`${gen}/cobblemon/campfire.json`, `${gen}/cobblemon/soul_campfire.json`, `${gen}/adaptacoes/decorated_pot.json`]) {
		if (!existsSync(file)) continue;
		const b = JSON.parse(readFileSync(file, "utf8"))["minecraft:block"];
		assert.deepEqual(b.components["minecraft:redstone_producer"], { power: 0, connected_faces: [] }, `${file}: produtor base`);
	}
}

console.log("adaptacoes: ok");
