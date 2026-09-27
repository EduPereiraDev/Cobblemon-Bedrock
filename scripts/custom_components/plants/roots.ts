/**
 * Raízes penduradas (RootBlock, BigRootBlock, EnergyRootBlock): se espalham pelo teto de terra/pedra
 * no escuro, podem virar energy root, e a tesoura colhe (energy root → big root + item; big root →
 * hanging roots + linha). Valores de CobblemonConfig 1.8.2.
 */
import { Block, BlockComponentPlayerInteractEvent, BlockComponentRandomTickEvent, BlockCustomComponent } from "@minecraft/server";
import { boneMealEffect, consumeHeld, damageHeld, destroyBlock, DIRT, dropItems, HORIZONTAL, heldItem, isAir, lightAt, neighbor, playSound, REPLACEABLE, rng, shuffled } from "./common";

export const BIG_ROOT = "cobblemon:big_root";
export const ENERGY_ROOT = "cobblemon:energy_root";
export const ROOTS = new Set([BIG_ROOT, ENERGY_ROOT]);

/** CobblemonConfig: bigRootPropagationChance, energyRootChance, maxRootsInArea. */
export const ROOT_CONFIG = { propagationChance: 0.5, energyRootChance: 0.25, maxRootsInArea: 9 };
/** RootBlock.MAX_PROPAGATING_LIGHT_LEVEL. */
export const MAX_PROPAGATING_LIGHT = 11;

/** #cobblemon:roots_spreadable (terra + pedras comuns). */
export const ROOTS_SPREADABLE = new Set([
	...DIRT, "minecraft:stone", "minecraft:infested_stone", "minecraft:andesite", "minecraft:diorite", "minecraft:granite", "minecraft:deepslate",
	"minecraft:infested_deepslate", "minecraft:tuff", "minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:infested_cobblestone",
	"minecraft:cobbled_deepslate",
]);

/** Resultado da tesoura: bloco que fica e item que cai. */
export const SHEAR_RESULT: Record<string, { becomes: string; drop: string }> = {
	[ENERGY_ROOT]: { becomes: BIG_ROOT, drop: ENERGY_ROOT },
	[BIG_ROOT]: { becomes: "minecraft:hanging_roots", drop: "minecraft:string" },
};

/** RootBlock.spreadingRoot. */
export function spreadingRoot(): string {
	return rng.next() < ROOT_CONFIG.energyRootChance ? ENERGY_ROOT : BIG_ROOT;
}

/** canSpreadTo: lugar livre com teto espalhável. */
function canSpreadTo(target: Block | undefined): boolean {
	if (!target || !REPLACEABLE.has(target.typeId)) return false;
	const ceiling = neighbor(target, "up");
	return !!ceiling && ROOTS_SPREADABLE.has(ceiling.typeId);
}

/** hasReachedSpreadCap: 9+ raízes na caixa 9x3x9. */
function hasReachedSpreadCap(block: Block): boolean {
	let nearby = 0;
	const { x, y, z } = block.location;
	for (let dx = -4; dx <= 4; dx++)
		for (let dy = -1; dy <= 1; dy++)
			for (let dz = -4; dz <= 4; dz++) {
				let type: string | undefined;
				try { type = block.dimension.getBlock({ x: x + dx, y: y + dy, z: z + dz })?.typeId; } catch { type = undefined; }
				if (type && ROOTS.has(type) && ++nearby >= ROOT_CONFIG.maxRootsInArea) return true;
			}
	return false;
}

function spreadTargets(block: Block): Block[] {
	return shuffled(HORIZONTAL).map((dir) => neighbor(block, dir)).filter((b): b is Block => canSpreadTo(b));
}

export class RootComponent implements BlockCustomComponent {
	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		// canSurvive: precisa de teto sólido (o Bedrock não tem updateShape; conferimos aqui).
		const ceiling = neighbor(block, "up");
		if (ceiling && (isAir(ceiling) || REPLACEABLE.has(ceiling.typeId))) {
			destroyBlock(block);
			return;
		}
		if (rng.next() >= ROOT_CONFIG.propagationChance) return;
		if (lightAt(block.dimension, block.location) >= MAX_PROPAGATING_LIGHT) return;
		const target = spreadTargets(block)[0];
		if (!target || hasReachedSpreadCap(block)) return;
		target.setType(spreadingRoot());
	}

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		const player = arg.player;
		if (!player) return;
		const block = arg.block;
		const item = heldItem(player);
		if (item?.typeId === "minecraft:shears") {
			const result = SHEAR_RESULT[block.typeId];
			if (!result) return;
			playSound(block, "mob.sheep.shear");
			block.setType(result.becomes);
			dropItems(block.dimension, block.location, result.drop, 1);
			damageHeld(player);
			return;
		}
		// Farinha de osso: espalha na hora quando há lugar.
		if (item?.typeId === "minecraft:bone_meal") {
			const target = spreadTargets(block)[0];
			if (!target) return;
			consumeHeld(player);
			target.setType(spreadingRoot());
			boneMealEffect(block);
		}
	}
}
