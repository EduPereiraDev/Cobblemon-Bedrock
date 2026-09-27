/**
 * Cultivos do Cobblemon: mints (MintBlock), vivichoke (VivichokeBlock), revival herb (RevivalHerbBlock),
 * medicinal leek (MedicinalLeekBlock), galarica (NutBushBlock) e hearty grains (HeartyGrainsBlock).
 *
 * Os drops ao quebrar vêm das loot tables por idade geradas pelo importador; aqui ficam o crescimento
 * por random tick, a farinha de osso, a colheita por interação (galarica) e o mulch da revival herb.
 */
import { Block, BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent, BlockComponentRandomTickEvent, BlockCustomComponent, Player } from "@minecraft/server";
import { ITEMS } from "../../../generated/scripts/items";
import {
	boneMealEffect, consumeHeld, dropItems, heldItem, isAir, lightAt, neighbor, numberState, offset, pickRandom, playSound, randBetween,
	randInt, setStates,
} from "./common";
import type { MulchVariant } from "./berry";

export const AGE_STATE = "cobblemon:age";
export const HALF_STATE = "cobblemon:half";
export const MUTATION_STATE = "cobblemon:mutation";

// ---------------------------------------------------------------------------------------------
// Regras puras

/** Informação de um bloco de solo para o cálculo de umidade do CropBlock. */
export interface SoilInfo { farmland: boolean; moist: boolean }

/**
 * CropBlock.getGrowthSpeed do vanilla (cópia do RevivalHerbBlock.getMoistureAmount):
 * `soil[dx+1][dz+1]` é o bloco abaixo de (x+dx, z+dz); `sameX`/`sameZ` = mesma planta a oeste/leste e
 * a norte/sul; `sameDiagonal` = mesma planta numa diagonal.
 */
export function growthSpeed(soil: SoilInfo[][], sameX: boolean, sameZ: boolean, sameDiagonal: boolean): number {
	let speed = 1;
	for (let dx = -1; dx <= 1; dx++) {
		for (let dz = -1; dz <= 1; dz++) {
			const info = soil[dx + 1]?.[dz + 1];
			let boost = 0;
			if (info?.farmland) boost = info.moist ? 3 : 1;
			if (dx !== 0 || dz !== 0) boost /= 4;
			speed += boost;
		}
	}
	if ((sameX && sameZ) || sameDiagonal) speed /= 2;
	return speed;
}

/** Chance por random tick do CropBlock vanilla: 1 em (int)(25/velocidade)+1. */
export function vanillaCropRoll(speed: number): boolean {
	return randInt(Math.trunc(25 / speed) + 1) === 0;
}

export interface CropRules {
	maxAge: number;
	/** Luz mínima para crescer (undefined = ignora a luz). */
	minLight?: number;
	/** Bloco onde a luz é medida (galarica mede acima). */
	lightAbove?: boolean;
	/** Sorteio do random tick. */
	roll(block: Block): boolean;
	/** Quanto a farinha de osso avança (0 = não aceita). */
	boneMeal(): number;
}

export const CROP_RULES: Record<string, CropRules> = {
	// MintBlock: luz ≥ 9 e 1/8 por random tick; farinha de osso +1.
	mint: { maxAge: 7, minLight: 9, roll: () => randInt(8) === 0, boneMeal: () => 1 },
	// VivichokeBlock: CropBlock vanilla (umidade); farinha de osso +1 ("design choice").
	vivichoke: { maxAge: 7, minLight: 9, roll: (block) => vanillaCropRoll(blockGrowthSpeed(block)), boneMeal: () => 1 },
	// RevivalHerbBlock: CropBlock vanilla até 8; farinha de osso padrão do CropBlock (2..5).
	revival_herb: { maxAge: 8, minLight: 9, roll: (block) => vanillaCropRoll(blockGrowthSpeed(block)), boneMeal: () => randBetween(2, 5) },
	// MedicinalLeekBlock: rápido como cana, 1/4 por random tick, sem luz.
	medicinal_leek: { maxAge: 3, roll: () => randInt(4) === 0, boneMeal: () => 1 },
	// NutBushBlock: luz acima ≥ 9 e 1/8; farinha de osso +1 sempre.
	galarica: { maxAge: 3, minLight: 9, lightAbove: true, roll: () => randInt(8) === 0, boneMeal: () => 1 },
};

/** Próxima idade de um cultivo simples por random tick (undefined = não cresce). */
export function cropRandomTick(rules: CropRules, age: number, light: number, block: Block): number | undefined {
	if (age >= rules.maxAge) return undefined;
	if (rules.minLight !== undefined && light < rules.minLight) return undefined;
	return rules.roll(block) ? age + 1 : undefined;
}

/** Idade depois da farinha de osso (undefined = não aceita/maduro). */
export function cropBoneMeal(rules: CropRules, age: number): number | undefined {
	if (age >= rules.maxAge) return undefined;
	const increase = rules.boneMeal();
	return increase > 0 ? Math.min(rules.maxAge, age + increase) : undefined;
}

function farmlandInfo(block: Block | undefined): SoilInfo {
	if (block?.typeId !== "minecraft:farmland") return { farmland: false, moist: false };
	const moisture = block.permutation.getState("moisturized_amount" as never);
	return { farmland: true, moist: typeof moisture === "number" && moisture > 0 };
}

/** Velocidade de crescimento lida do mundo (3x3 de solo + vizinhos iguais). */
export function blockGrowthSpeed(block: Block): number {
	const soil: SoilInfo[][] = [];
	for (let dx = -1; dx <= 1; dx++) {
		const column: SoilInfo[] = [];
		for (let dz = -1; dz <= 1; dz++) {
			const loc = { x: block.location.x + dx, y: block.location.y - 1, z: block.location.z + dz };
			let below: Block | undefined;
			try { below = block.dimension.getBlock(loc); } catch { below = undefined; }
			column.push(farmlandInfo(below));
		}
		soil.push(column);
	}
	const same = (b: Block | undefined) => b?.typeId === block.typeId;
	const at = (dx: number, dz: number) => {
		try { return block.dimension.getBlock({ x: block.location.x + dx, y: block.location.y, z: block.location.z + dz }); } catch { return undefined; }
	};
	const sameX = same(at(-1, 0)) || same(at(1, 0));
	const sameZ = same(at(0, -1)) || same(at(0, 1));
	const sameDiagonal = same(at(-1, -1)) || same(at(1, -1)) || same(at(1, 1)) || same(at(-1, 1));
	return growthSpeed(soil, sameX, sameZ, sameDiagonal);
}

// ---------------------------------------------------------------------------------------------
// Componentes

/** Cultivo simples de uma idade (mint, vivichoke, revival herb, medicinal leek, galarica). */
export class CropComponent implements BlockCustomComponent {
	constructor(public rules: CropRules) { }

	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		const age = numberState(block, AGE_STATE);
		if (age >= this.rules.maxAge) return;
		const light = this.rules.minLight === undefined ? 15 : lightAt(block.dimension, this.rules.lightAbove ? offset(block.location, "up") : block.location);
		const next = cropRandomTick(this.rules, age, light, block);
		if (next !== undefined) setStates(block, { [AGE_STATE]: next });
	}

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		if (!arg.player) return;
		const item = heldItem(arg.player);
		if (item?.typeId !== "minecraft:bone_meal") return;
		this.boneMeal(arg.block, arg.player);
	}

	/** Devolve se a farinha de osso foi usada. */
	boneMeal(block: Block, player: Player): boolean {
		const next = cropBoneMeal(this.rules, numberState(block, AGE_STATE));
		if (next === undefined) return false;
		consumeHeld(player);
		setStates(block, { [AGE_STATE]: next });
		boneMealEffect(block);
		return true;
	}
}

// Revival herb ---------------------------------------------------------------------------------

export const REVIVAL_MUTATIONS = ["mental", "power", "white", "mirror"] as const;
/** Até esta idade a revival herb ainda aceita mulch/mutação (MUTABLE_MAX_AGE). */
export const REVIVAL_MUTABLE_MAX_AGE = 6;

export function canMutateRevivalHerb(age: number, mutation: string, variant: MulchVariant): boolean {
	return variant === "surprise" && age <= REVIVAL_MUTABLE_MAX_AGE && mutation === "none";
}

/** RevivalHerbBlock.applyMulch: surprise mulch sorteia uma mutação (pep-up flower etc. na loot). */
export function applyRevivalMulch(block: Block, variant: MulchVariant, player?: Player): boolean {
	const mutation = block.permutation.getState(MUTATION_STATE as never);
	if (!canMutateRevivalHerb(numberState(block, AGE_STATE), typeof mutation === "string" ? mutation : "none", variant)) return false;
	setStates(block, { [MUTATION_STATE]: pickRandom(REVIVAL_MUTATIONS)! });
	if (player) consumeHeld(player);
	boneMealEffect(block);
	return true;
}

export class RevivalHerbComponent extends CropComponent {
	constructor() { super(CROP_RULES.revival_herb); }

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		if (!arg.player) return;
		const item = heldItem(arg.player);
		const data = item?.typeId.startsWith("cobblemon:") ? ITEMS[item.typeId.slice(10)] : undefined;
		if (data?.category === "mulch") {
			applyRevivalMulch(arg.block, String(data.variant) as MulchVariant, arg.player);
			return;
		}
		super.onPlayerInteract(arg);
	}
}

// Galarica -------------------------------------------------------------------------------------

export const GALARICA_NUTS = "cobblemon:galarica_nuts";

export class GalaricaNutBushComponent extends CropComponent {
	constructor() { super(CROP_RULES.galarica); }

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		if (!arg.player) return;
		const item = heldItem(arg.player);
		if (item?.typeId === "minecraft:bone_meal" && this.boneMeal(arg.block, arg.player)) return;
		// Madura: 1..2 nozes e volta para a idade 1.
		if (numberState(arg.block, AGE_STATE) !== this.rules.maxAge) return;
		dropItems(arg.block.dimension, arg.block.location, GALARICA_NUTS, 1 + randInt(2));
		playSound(arg.block, "block.sweet_berry_bush.pick", 1, 0.8 + Math.random() * 0.4);
		setStates(arg.block, { [AGE_STATE]: 1 });
	}
}

// Hearty grains --------------------------------------------------------------------------------

export const HEARTY_GRAINS = "cobblemon:hearty_grains";
export const HEARTY_MATURE_AGE = 6;
/** Último estágio de um bloco só (volta para ele quando a metade de cima some). */
export const HEARTY_AGE_AFTER_HARVEST = 3;

function isHeartyHalf(block: Block | undefined, half: "lower" | "upper"): boolean {
	return block?.typeId === HEARTY_GRAINS && block.permutation.getState(HALF_STATE as never) === half;
}

/** HeartyGrainsBlock.canGrow (sem canSurvive: o Bedrock não tem updateShape). */
export function heartyCanGrow(age: number, aboveIsFree: boolean): boolean {
	return age < HEARTY_MATURE_AGE && !(!aboveIsFree && age >= HEARTY_AGE_AFTER_HARVEST);
}

export class HeartyGrainsComponent implements BlockCustomComponent {
	private lowerOf(block: Block): Block | undefined {
		if (isHeartyHalf(block, "lower")) return block;
		const below = neighbor(block, "down");
		return isHeartyHalf(below, "lower") ? below : undefined;
	}

	private canGrow(lower: Block): boolean {
		const above = neighbor(lower, "up");
		const free = !!above && (isAir(above) || above.typeId === HEARTY_GRAINS);
		return heartyCanGrow(numberState(lower, AGE_STATE), free);
	}

	/** HeartyGrainsBlock.grow: a partir da idade 4 existe a metade de cima com a mesma idade. */
	grow(lower: Block, increment: number): void {
		if (!this.canGrow(lower)) return;
		const age = Math.min(HEARTY_MATURE_AGE, numberState(lower, AGE_STATE) + increment);
		setStates(lower, { [AGE_STATE]: age });
		if (age < HEARTY_AGE_AFTER_HARVEST + 1) return;
		const above = neighbor(lower, "up");
		if (!above) return;
		if (isAir(above)) {
			above.setType(HEARTY_GRAINS);
			setStates(above, { [AGE_STATE]: age, [HALF_STATE]: "upper" });
		} else if (isHeartyHalf(above, "upper")) setStates(above, { [AGE_STATE]: age });
	}

	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		if (isHeartyHalf(block, "upper")) {
			// Metade de cima sem a de baixo não sobrevive.
			if (!isHeartyHalf(neighbor(block, "down"), "lower")) block.setType("minecraft:air");
			return;
		}
		// Metade de cima sumiu (quebrada por outra coisa): volta ao último estágio de um bloco.
		const age = numberState(block, AGE_STATE);
		if (age > HEARTY_AGE_AFTER_HARVEST && neighbor(block, "up")?.typeId !== HEARTY_GRAINS) {
			setStates(block, { [AGE_STATE]: HEARTY_AGE_AFTER_HARVEST });
			return;
		}
		// hasSufficientLight (≥ 8) e 1/16 por random tick.
		if (lightAt(block.dimension, block.location) >= 8 && randInt(16) === 0) this.grow(block, 1);
	}

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		if (!arg.player || heldItem(arg.player)?.typeId !== "minecraft:bone_meal") return;
		const lower = this.lowerOf(arg.block);
		if (!lower || !this.canGrow(lower)) return;
		consumeHeld(arg.player);
		this.grow(lower, randBetween(1, 3));
		boneMealEffect(arg.block);
	}

	onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
		const half = arg.brokenBlockPermutation.getState(HALF_STATE as never);
		if (half === "upper") {
			const below = neighbor(arg.block, "down");
			if (below && isHeartyHalf(below, "lower") && numberState(below, AGE_STATE) > HEARTY_AGE_AFTER_HARVEST)
				setStates(below, { [AGE_STATE]: HEARTY_AGE_AFTER_HARVEST });
		} else {
			const above = neighbor(arg.block, "up");
			if (above && isHeartyHalf(above, "upper")) above.setType("minecraft:air");
		}
	}
}
