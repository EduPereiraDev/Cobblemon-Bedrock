/**
 * Blocos de construção/decoração da frente: lajes, escadas (formato de canto), portões entre muros,
 * itens empilháveis (StackableItemBlock) e decoração ativável (metronome).
 */
import {
	Block, BlockComponentOnPlaceEvent, BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent, BlockComponentRandomTickEvent,
	BlockCustomComponent,
} from "@minecraft/server";
import { ITEMS } from "../../../generated/scripts/items";
import { axisOf, CLOCKWISE, consumeHeld, COUNTER_CLOCKWISE, Dir4, faceName, heldItem, HORIZONTAL, neighbor, OPPOSITE, playSound, setStates } from "./common";

const CARDINAL = "minecraft:cardinal_direction";
const VERTICAL_HALF = "minecraft:vertical_half";

// ---------------------------------------------------------------------------------------------
// Lajes

export const DOUBLE_STATE = "cobblemon:double";

/** Clicar na metade livre de uma laje com a mesma laje completa o bloco (SlabBlock.canBeReplaced). */
export function slabMerges(half: string, face: string | undefined, hitY: number | undefined): boolean {
	if (half === "top") return face === "down" || (face !== "up" && hitY !== undefined && hitY < 0.5);
	return face === "up" || (face !== "down" && hitY !== undefined && hitY > 0.5);
}

export class GenericSlabComponent implements BlockCustomComponent {
	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		const player = arg.player;
		const block = arg.block;
		if (!player || block.permutation.getState(DOUBLE_STATE as never) === true) return;
		if (heldItem(player)?.typeId !== block.typeId) return;
		const half = String(block.permutation.getState(VERTICAL_HALF as never) ?? "bottom");
		// faceLocation pode vir relativa ao bloco ou absoluta, conforme a versão; normaliza para 0..1.
		const y = arg.faceLocation?.y;
		const hitY = y === undefined ? undefined : y >= 0 && y <= 1 ? y : y - block.location.y;
		if (!slabMerges(half, faceName(arg.face), hitY)) return;
		setStates(block, { [DOUBLE_STATE]: true });
		consumeHeld(player);
		playSound(block, block.typeId.includes("saccharine") ? "dig.wood" : "dig.stone");
	}
}

// ---------------------------------------------------------------------------------------------
// Escadas (StairBlock.getStairsShape)

export const SHAPE_STATE = "cobblemon:shape";
export type StairShape = "straight" | "inner_left" | "inner_right" | "outer_left" | "outer_right";
export interface StairInfo { facing: Dir4; half: "top" | "bottom" }

/** weirdo_direction das escadas vanilla → facing do Java. */
const WEIRDO_TO_FACING: Dir4[] = ["east", "west", "south", "north"];

/** Lê uma escada (nossa ou vanilla) num bloco; undefined se não for escada. */
export function stairInfo(block: Block | undefined): StairInfo | undefined {
	if (!block) return undefined;
	const permutation = block.permutation;
	if (permutation.getState(SHAPE_STATE as never) !== undefined) {
		const facing = permutation.getState(CARDINAL as never);
		const half = permutation.getState(VERTICAL_HALF as never);
		if (!(HORIZONTAL as readonly unknown[]).includes(facing)) return undefined;
		return { facing: facing as Dir4, half: half === "top" ? "top" : "bottom" };
	}
	if (!block.typeId.endsWith("_stairs")) return undefined;
	const weirdo = permutation.getState("weirdo_direction" as never);
	if (typeof weirdo !== "number" || !WEIRDO_TO_FACING[weirdo]) return undefined;
	return { facing: WEIRDO_TO_FACING[weirdo], half: permutation.getState("upside_down_bit" as never) === true ? "top" : "bottom" };
}

/**
 * StairBlock.getStairsShape do Java. `at(dir)` devolve a escada vizinha nessa direção (ou undefined).
 */
export function computeStairShape(self: StairInfo, at: (dir: Dir4) => StairInfo | undefined): StairShape {
	const facing = self.facing;
	const canTakeShape = (face: Dir4) => {
		const other = at(face);
		return !other || other.facing !== facing || other.half !== self.half;
	};
	const front = at(facing);
	if (front && front.half === self.half) {
		const d1 = front.facing;
		if (axisOf(d1) !== axisOf(facing) && canTakeShape(OPPOSITE[d1] as Dir4))
			return d1 === COUNTER_CLOCKWISE[facing] ? "outer_left" : "outer_right";
	}
	const back = at(OPPOSITE[facing] as Dir4);
	if (back && back.half === self.half) {
		const d2 = back.facing;
		if (axisOf(d2) !== axisOf(facing) && canTakeShape(d2))
			return d2 === COUNTER_CLOCKWISE[facing] ? "inner_left" : "inner_right";
	}
	return "straight";
}

/** Recalcula o formato de uma escada nossa; devolve se mudou. */
export function refreshStairShape(block: Block): boolean {
	if (block.permutation.getState(SHAPE_STATE as never) === undefined) return false;
	const self = stairInfo(block);
	if (!self) return false;
	const shape = computeStairShape(self, (dir) => stairInfo(neighbor(block, dir)));
	if (block.permutation.getState(SHAPE_STATE as never) === shape) return false;
	setStates(block, { [SHAPE_STATE]: shape });
	return true;
}

/** Atualiza escadas e portões nos 4 vizinhos de uma posição (o Bedrock não avisa vizinhos). */
export function refreshNeighbours(block: Block): void {
	for (const dir of HORIZONTAL) {
		const other = neighbor(block, dir);
		if (!other) continue;
		try {
			if (other.permutation.getState(SHAPE_STATE as never) !== undefined) refreshStairShape(other);
			else if (other.permutation.getState(IN_WALL_STATE as never) !== undefined) refreshFenceGate(other);
		} catch { /* chunk descarregado */ }
	}
}

export class StairsShapeComponent implements BlockCustomComponent {
	onPlace(arg: BlockComponentOnPlaceEvent) {
		refreshStairShape(arg.block);
		refreshNeighbours(arg.block);
	}

	onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
		refreshNeighbours(arg.block);
	}

	/** Autocorreção barata para vizinhos trocados sem aviso (pistões, explosões, comandos). */
	onRandomTick(arg: BlockComponentRandomTickEvent) {
		refreshStairShape(arg.block);
	}
}

// ---------------------------------------------------------------------------------------------
// Portão entre muros (FenceGateBlock.IN_WALL)

export const IN_WALL_STATE = "cobblemon:in_wall";

export function isWall(typeId: string | undefined): boolean {
	return !!typeId && typeId.endsWith("_wall") && !typeId.endsWith("_sign_wall");
}

/** Portão fica mais baixo quando há muro num dos lados do seu eixo. */
export function gateInWall(facing: Dir4, wallAt: (dir: Dir4) => boolean): boolean {
	return wallAt(CLOCKWISE[facing]) || wallAt(COUNTER_CLOCKWISE[facing]);
}

export function refreshFenceGate(block: Block): void {
	const facing = block.permutation.getState(CARDINAL as never);
	if (!(HORIZONTAL as readonly unknown[]).includes(facing)) return;
	const inWall = gateInWall(facing as Dir4, (dir) => isWall(neighbor(block, dir)?.typeId));
	setStates(block, { [IN_WALL_STATE]: inWall });
}

export class FenceGateInWallComponent implements BlockCustomComponent {
	onPlace(arg: BlockComponentOnPlaceEvent) {
		refreshFenceGate(arg.block);
	}

	onRandomTick(arg: BlockComponentRandomTickEvent) {
		refreshFenceGate(arg.block);
	}
}

// ---------------------------------------------------------------------------------------------
// Itens empilháveis (StackableItemBlock) e decoração ativável

export const AMOUNT_STATE = "cobblemon:amount";
export const MAX_STACK_AMOUNT = 4;

/** Item na mão coloca este bloco? (mesmo id ou ITEMS[id].placesBlock). */
export function itemPlacesBlock(itemId: string, blockId: string): boolean {
	if (itemId === blockId) return true;
	const data = itemId.startsWith("cobblemon:") ? ITEMS[itemId.slice(10)] : undefined;
	return data?.placesBlock === blockId;
}

export class StackableItemBlockComponent implements BlockCustomComponent {
	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		const player = arg.player;
		const block = arg.block;
		if (!player || player.isSneaking) return;
		const item = heldItem(player);
		if (!item || !itemPlacesBlock(item.typeId, block.typeId)) return;
		const amount = block.permutation.getState(AMOUNT_STATE as never);
		if (typeof amount !== "number" || amount >= MAX_STACK_AMOUNT) return;
		setStates(block, { [AMOUNT_STATE]: amount + 1 });
		consumeHeld(player);
		playSound(block, "random.pop", 0.4);
	}
}

export const ACTIVE_STATE = "cobblemon:active";

export class ActivatableDecorationComponent implements BlockCustomComponent {
	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		if (!arg.player) return;
		setStates(arg.block, { [ACTIVE_STATE]: arg.block.permutation.getState(ACTIVE_STATE as never) !== true });
		playSound(arg.block, "random.click", 0.3);
	}
}
