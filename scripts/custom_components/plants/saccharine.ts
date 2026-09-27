/**
 * Árvore de saccharine: folhas (decaimento + mel), muda (vira a feature cobblemon:saccharine_tree),
 * tora com mel (SaccharineLogSlatheredBlock), descascar tora/madeira e mel na tora (SaccharineLogBlock).
 */
import {
	Block, BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent, BlockComponentPlayerPlaceBeforeEvent, BlockComponentRandomTickEvent,
	BlockComponentTickEvent, BlockCustomComponent, BlockPermutation, CustomComponentParameters,
} from "@minecraft/server";
import {
	boneMealEffect, consumeHeld, damageHeld, destroyBlock, dropItems, exchangeHeld, faceName, giveItem, hasItemTag, heldItem, HORIZONTAL, isAir, isCreative, isWaterBottle,
	lightAt, neighbor, numberState, playSound, randBetween, randInt, rng, setStates,
} from "./common";

// ---------------------------------------------------------------------------------------------
// Decaimento das folhas (LeavesDecayComponent genérico: usa o typeId do próprio bloco)

export const DISTANCE_STATE = "cobblemon:distance_from_log";
export const DECAYABLE_STATE = "cobblemon:decayable";
export const MAX_LOG_DISTANCE = 4;

/** Nova distância até a tora: 0 se vizinho é tora, senão 1 + menor distância das folhas vizinhas. */
export function leafDistance(neighbourDistances: number[]): number {
	return Math.min(MAX_LOG_DISTANCE - 1, ...neighbourDistances) + 1;
}

interface LeavesParams { loot_table?: string }

function isLog(block: Block): boolean {
	return block.hasTag("log") || /_(log|wood)(_slathered)?$/.test(block.typeId);
}

/** Busca em largura pelas folhas do mesmo tipo até `maxDistance` passos procurando uma tora. */
export function hasLogWithin(start: Block, maxDistance: number): boolean {
	const seen = new Set<string>([`${start.location.x},${start.location.y},${start.location.z}`]);
	let frontier: Block[] = [start];
	for (let step = 1; step <= maxDistance && frontier.length; step++) {
		const next: Block[] = [];
		for (const current of frontier) {
			for (const dir of ["up", "down", ...HORIZONTAL] as const) {
				const other = neighbor(current, dir);
				if (!other) continue;
				const key = `${other.location.x},${other.location.y},${other.location.z}`;
				if (seen.has(key)) continue;
				seen.add(key);
				if (isLog(other)) return true;
				if (other.typeId === start.typeId) next.push(other);
			}
		}
		frontier = next;
	}
	return false;
}

export class LeavesDecayComponent implements BlockCustomComponent {
	/** Folhas colocadas pelo jogador não decaem (PERSISTENT do Java). */
	beforeOnPlayerPlace(arg: BlockComponentPlayerPlaceBeforeEvent) {
		try {
			arg.permutationToPlace = arg.permutationToPlace.withState(DECAYABLE_STATE as never, false as never);
		} catch { /* bloco sem o estado */ }
	}

	onTick(arg: BlockComponentTickEvent) {
		this.refresh(arg.block);
	}

	onRandomTick(arg: BlockComponentRandomTickEvent, params?: CustomComponentParameters) {
		const block = arg.block;
		if (block.permutation.getState(DECAYABLE_STATE as never) === false) return;
		if (this.refresh(block) < MAX_LOG_DISTANCE) return;
		// As distâncias dos vizinhos podem ainda não ter propagado (árvore recém-carregada): confirma antes de decair.
		if (hasLogWithin(block, MAX_LOG_DISTANCE - 1)) return;
		// Decaimento: cai a loot natural das folhas (muda, gravetos, maçã), como no Java.
		const lootTable = (params?.params as LeavesParams | undefined)?.loot_table;
		if (lootTable && lootTable !== "empty") {
			const { x, y, z } = block.location;
			block.setType("minecraft:air");
			block.dimension.runCommand(`loot spawn ${x} ${y} ${z} loot "${lootTable}"`);
		} else destroyBlock(block);
	}

	refresh(block: Block): number {
		const distances: number[] = [];
		for (const dir of ["up", "down", ...HORIZONTAL] as const) {
			const other = neighbor(block, dir);
			if (!other) continue;
			if (isLog(other)) distances.push(0);
			else if (other.typeId === block.typeId) distances.push(numberState(other, DISTANCE_STATE, MAX_LOG_DISTANCE));
		}
		const distance = leafDistance(distances);
		try { setStates(block, { [DISTANCE_STATE]: distance }); } catch { /* valor fora do estado */ }
		return distance;
	}

	onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
		// Tesoura devolve as próprias folhas (a loot table gerada não testa a ferramenta).
		if (!arg.player || isCreative(arg.player) || heldItem(arg.player)?.typeId !== "minecraft:shears") return;
		dropItems(arg.dimension, arg.block.location, arg.brokenBlockPermutation.type.id, 1);
		damageHeld(arg.player);
	}
}

// ---------------------------------------------------------------------------------------------
// Mel nas folhas (SaccharineLeafBlock)

export const LEAF_AGE_STATE = "cobblemon:age";
export const LEAF_MAX_AGE = 2;
export const SACCHARINE_LEAVES = "cobblemon:saccharine_leaves";

/** Mel escorre: a folha perde 1 e a primeira folha de saccharine abaixo (até 10, só ar no meio) ganha 1. */
export function honeyDripTarget(age: number, below: Array<{ typeId: string; age: number } | undefined>): number | undefined {
	if (age <= 0) return undefined;
	for (let i = 0; i < below.length; i++) {
		const entry = below[i];
		if (!entry) return undefined;
		if (entry.typeId === "minecraft:air") continue;
		if (entry.typeId === SACCHARINE_LEAVES && entry.age < LEAF_MAX_AGE) return i;
		return undefined;
	}
	return undefined;
}

export class SaccharineLeavesComponent implements BlockCustomComponent {
	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		const age = numberState(block, LEAF_AGE_STATE);
		if (age <= 0 || randInt(2) !== 0) return;
		const below: Block[] = [];
		const summary: Array<{ typeId: string; age: number } | undefined> = [];
		for (let i = 1; i <= 10; i++) {
			const other = neighbor(block, "down", i);
			if (other) below.push(other);
			summary.push(other ? { typeId: isAir(other) ? "minecraft:air" : other.typeId, age: other.typeId === SACCHARINE_LEAVES ? numberState(other, LEAF_AGE_STATE) : 0 } : undefined);
			if (!other || !isAir(other)) break;
		}
		const index = honeyDripTarget(age, summary);
		if (index === undefined) return;
		const target = below[index];
		setStates(block, { [LEAF_AGE_STATE]: age - 1 });
		setStates(target, { [LEAF_AGE_STATE]: Math.min(LEAF_MAX_AGE, numberState(target, LEAF_AGE_STATE) + 1) });
	}

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		const player = arg.player;
		const block = arg.block;
		if (!player || block.isWaterlogged) return;
		const item = heldItem(player);
		const age = numberState(block, LEAF_AGE_STATE);
		if (item?.typeId === "minecraft:glass_bottle" && age === LEAF_MAX_AGE) {
			// Garrafa vazia colhe o mel.
			if (isCreative(player)) giveItem(player, "minecraft:honey_bottle");
			else exchangeHeld(player, "minecraft:honey_bottle");
			playSound(block, "bottle.fill");
			setStates(block, { [LEAF_AGE_STATE]: 0 });
		} else if (item?.typeId === "minecraft:honey_bottle" && age < LEAF_MAX_AGE) {
			// Garrafa de mel enche a folha.
			exchangeHeld(player, "minecraft:glass_bottle");
			playSound(block, "bottle.empty");
			setStates(block, { [LEAF_AGE_STATE]: LEAF_MAX_AGE });
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Muda (SaplingBlock + SaccharineTreeGrower)

export const SAPLING_STATE = "cobblemon:growth_state";
export const SACCHARINE_TREE_FEATURE = "cobblemon:saccharine_tree";
/** SaplingBlock: 1/7 por random tick com luz ≥ 9; farinha de osso 45%. */
export const SAPLING_TICK_CHANCE = 7;
export const SAPLING_BONE_MEAL_CHANCE = 0.45;

export class SaccharineSaplingComponent implements BlockCustomComponent {
	/** SaplingBlock.advanceTree: estágio 0 → 1 → árvore. */
	advance(block: Block): void {
		if (numberState(block, SAPLING_STATE) === 0) {
			setStates(block, { [SAPLING_STATE]: 1 });
			return;
		}
		const permutation = block.permutation;
		const location = { ...block.location };
		const dimension = block.dimension;
		// A feature não substitui a muda: tira a muda, tenta a árvore e devolve se não couber.
		block.setType("minecraft:air");
		let placed = false;
		try {
			placed = dimension.placeFeature(SACCHARINE_TREE_FEATURE, location, false);
		} catch {
			placed = false;
		}
		if (!placed) dimension.getBlock(location)?.setPermutation(permutation);
	}

	onRandomTick(arg: BlockComponentRandomTickEvent) {
		if (lightAt(arg.block.dimension, arg.block.location) < 9 || randInt(SAPLING_TICK_CHANCE) !== 0) return;
		this.advance(arg.block);
	}

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		if (!arg.player || heldItem(arg.player)?.typeId !== "minecraft:bone_meal") return;
		consumeHeld(arg.player);
		boneMealEffect(arg.block);
		if (rng.next() < SAPLING_BONE_MEAL_CHANCE) this.advance(arg.block);
	}
}

// ---------------------------------------------------------------------------------------------
// Toras: descascar, passar mel e lavar o mel

export const SACCHARINE_LOG = "cobblemon:saccharine_log";
export const SACCHARINE_LOG_SLATHERED = "cobblemon:saccharine_log_slathered";
export const HONEY_TYPE_STATE = "cobblemon:honey_type";
export const HONEY_TYPE_MAX = 5;
const FACING_DIRECTION = "minecraft:facing_direction";
const CARDINAL = "minecraft:cardinal_direction";

interface StripParams { stripped?: string }

/** Descascar com machado (StripLogComponent genérico) + mel na tora em pé (SaccharineLogBlock). */
export class SaccharineStripComponent implements BlockCustomComponent {
	constructor(public fallbackStripped: string) { }

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent, params?: CustomComponentParameters) {
		const player = arg.player;
		if (!player) return;
		const block = arg.block;
		const item = heldItem(player);
		if (hasItemTag(item, "minecraft:is_axe")) {
			const stripped = (params?.params as StripParams | undefined)?.stripped ?? this.fallbackStripped;
			const facing = block.permutation.getState(FACING_DIRECTION as never);
			let permutation = BlockPermutation.resolve(stripped);
			if (facing !== undefined) permutation = permutation.withState(FACING_DIRECTION as never, facing as never);
			block.setPermutation(permutation);
			damageHeld(player);
			playSound(block, "hit.wood");
			return;
		}
		// Garrafa de mel numa face lateral da tora em pé → tora com mel virada para essa face.
		if (item?.typeId !== "minecraft:honey_bottle" || block.typeId !== SACCHARINE_LOG) return;
		const facing = block.permutation.getState(FACING_DIRECTION as never);
		if (facing !== "up" && facing !== "down") return;
		const face = faceName(arg.face);
		if (!face || face === "up" || face === "down") return;
		const front = neighbor(block, face);
		if (front && (front.typeId === "minecraft:water" || front.typeId === "minecraft:flowing_water")) return;
		block.setPermutation(BlockPermutation.resolve(SACCHARINE_LOG_SLATHERED)
			.withState(CARDINAL as never, face as never)
			.withState(HONEY_TYPE_STATE as never, randBetween(0, HONEY_TYPE_MAX) as never));
		exchangeHeld(player, "minecraft:glass_bottle");
		playSound(block, "bottle.empty");
	}
}

/** Volta a tora com mel para a tora comum (água do lado do mel ou garrafa de água). */
function washHoney(block: Block): void {
	block.setPermutation(BlockPermutation.resolve(SACCHARINE_LOG).withState(FACING_DIRECTION as never, "up" as never));
	playSound(block, "random.swim");
	// SaccharineLogSlatheredBlock: respingos (SPLASH) na face do mel.
	for (let i = 0; i < 12; i++) {
		try { block.dimension.spawnParticle("minecraft:water_splash_particle", { x: block.location.x + Math.random(), y: block.location.y + Math.random(), z: block.location.z + Math.random() }); }
		catch { break; }
	}
}

export class SaccharineLogSlatheredComponent implements BlockCustomComponent {
	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		const player = arg.player;
		if (!player) return;
		const item = heldItem(player);
		const facing = arg.block.permutation.getState(CARDINAL as never);
		if (!isWaterBottle(item) || faceName(arg.face) !== facing) return;
		washHoney(arg.block);
		exchangeHeld(player, "minecraft:glass_bottle");
	}

	/** neighborChanged: água encostada no lado do mel lava a tora (conferido no random tick). */
	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const facing = arg.block.permutation.getState(CARDINAL as never);
		if (!(HORIZONTAL as readonly unknown[]).includes(facing)) return;
		const front = neighbor(arg.block, facing as typeof HORIZONTAL[number]);
		if (front && (front.typeId === "minecraft:water" || front.typeId === "minecraft:flowing_water")) washHoney(arg.block);
	}
}
