/**
 * Item de mulch (MulchItem): usar num bloco "Mulchable" — arbusto de berry (qualquer mulch, em solo
 * arado, antes de florir) ou revival herb (só surprise mulch, sorteia uma mutação).
 * No Java o mulch não vai direto no solo: só nesses blocos.
 */
import { Block, ItemComponentUseOnEvent, ItemCustomComponent, Player } from "@minecraft/server";
import { ITEMS } from "../../../generated/scripts/items";
import { applyBerryMulch, isBerryBush, MulchVariant, MULCH_VARIANTS } from "./berry";
import { applyRevivalMulch } from "./crops";

export function mulchVariantOf(itemId: string): MulchVariant | undefined {
	const data = itemId.startsWith("cobblemon:") ? ITEMS[itemId.slice(10)] : undefined;
	const variant = data?.category === "mulch" ? String(data.variant) : undefined;
	return variant && (MULCH_VARIANTS as readonly string[]).includes(variant) ? (variant as MulchVariant) : undefined;
}

/** Aplica o mulch no bloco, se ele aceitar; consome o item do jogador. */
export function applyMulch(block: Block, variant: MulchVariant, player?: Player): boolean {
	if (isBerryBush(block.typeId)) return applyBerryMulch(block, variant, player);
	if (block.typeId === "cobblemon:revival_herb") return applyRevivalMulch(block, variant, player);
	return false;
}

export class MulchItemComponent implements ItemCustomComponent {
	onUseOn(arg: ItemComponentUseOnEvent) {
		const variant = mulchVariantOf(arg.itemStack.typeId);
		if (!variant) return;
		const player = arg.source?.typeId === "minecraft:player" ? (arg.source as Player) : undefined;
		applyMulch(arg.block, variant, player);
	}
}

export const PLANT_ITEM_COMPONENTS: Record<string, ItemCustomComponent> = {
	"cobblemon:mulch": new MulchItemComponent(),
};
