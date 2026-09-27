/**
 * Minerais que crescem: tumblestone (TumblestoneBlock/GrowableStoneBlock) e gemas de tipo
 * (TypeGemClusterBlock + TypeGemCoreBlock, "deepslate_crystal_core").
 *
 * A direção dos brotos/clusters é o estado minecraft:block_face (= FACING do Java: o lado para onde o
 * broto aponta; o suporte fica do lado oposto).
 *
 * Os clusters de gema do Bedrock só têm cobblemon:stage; SHOULD_GROW/STUNTED do Java ficam num
 * registro por posição: "g" = cresce, "s" = atrofiado (o núcleo pode liberar de novo), ausente =
 * decorativo/não cresce (clusters decorativos em volta de uma gema pronta, ou colocados fora do núcleo).
 */
import { Block, BlockComponentPlayerBreakEvent, BlockComponentPlayerPlaceBeforeEvent, BlockComponentRandomTickEvent, BlockCustomComponent, BlockPermutation, Vector3 } from "@minecraft/server";
import { ALL_DIRS, Dir6, isAir, keyOf, neighbor, numberState, OPPOSITE, randInt, readRaw, shuffled, writeRaw } from "./common";

export const FACE_STATE = "minecraft:block_face";
export const STAGE_STATE = "cobblemon:stage";

function faceOf(permutation: BlockPermutation): Dir6 {
	const value = permutation.getState(FACE_STATE as never);
	return (ALL_DIRS as readonly unknown[]).includes(value) ? (value as Dir6) : "up";
}

/** Troca o bloco por outro tipo mantendo a direção. */
function replaceKeepingFace(block: Block, typeId: string, face: Dir6): void {
	block.setPermutation(BlockPermutation.resolve(typeId).withState(FACE_STATE as never, face as never));
}

// ---------------------------------------------------------------------------------------------
// Tumblestone

/** Próximo estágio de cada broto (CobblemonBlocks: small → medium → large → cluster). */
export const TUMBLESTONE_NEXT: Record<string, string> = {};
for (const color of ["", "sky_", "black_"]) {
	TUMBLESTONE_NEXT[`cobblemon:small_budding_${color}tumblestone`] = `cobblemon:medium_budding_${color}tumblestone`;
	TUMBLESTONE_NEXT[`cobblemon:medium_budding_${color}tumblestone`] = `cobblemon:large_budding_${color}tumblestone`;
	TUMBLESTONE_NEXT[`cobblemon:large_budding_${color}tumblestone`] = `cobblemon:${color}tumblestone_cluster`;
}

/** #cobblemon:tumblestone_heat_source (lava e magma). */
export const TUMBLESTONE_HEAT = new Set(["minecraft:lava", "minecraft:flowing_lava", "minecraft:magma"]);
/** TumblestoneBlock.growthChance: 1 em 5 por random tick. */
export const TUMBLESTONE_GROWTH_CHANCE = 5;

/** TumblestoneBlock.canGrow: fonte de calor no cubo 3x3x3 em volta. */
export function hasHeatSource(getType: (location: Vector3) => string | undefined, location: Vector3): boolean {
	for (let dx = -1; dx <= 1; dx++)
		for (let dy = -1; dy <= 1; dy++)
			for (let dz = -1; dz <= 1; dz++) {
				const type = getType({ x: location.x + dx, y: location.y + dy, z: location.z + dz });
				if (type && TUMBLESTONE_HEAT.has(type)) return true;
			}
	return false;
}

export class TumblestoneComponent implements BlockCustomComponent {
	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		const next = TUMBLESTONE_NEXT[block.typeId];
		if (!next || randInt(TUMBLESTONE_GROWTH_CHANCE) !== 0) return;
		const getType = (loc: Vector3) => {
			try { return block.dimension.getBlock(loc)?.typeId; } catch { return undefined; }
		};
		if (!hasHeatSource(getType, block.location)) return;
		replaceKeepingFace(block, next, faceOf(block.permutation));
	}
}

// ---------------------------------------------------------------------------------------------
// Gemas de tipo

export const GEM_TYPES = [
	"normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon",
	"dark", "steel", "fairy",
] as const;
export const GEM_CORE = "cobblemon:deepslate_crystal_core";
export const MAX_CONNECTED_GEMS = 7;
export const MAX_GEM_STAGE = 3;

export function gemBlockOfCluster(clusterId: string): string | undefined {
	const match = /^cobblemon:([a-z]+)_gem_cluster$/.exec(clusterId);
	return match && (GEM_TYPES as readonly string[]).includes(match[1]) ? `cobblemon:${match[1]}_gem_block` : undefined;
}

export function clusterOfGemBlock(blockId: string): string | undefined {
	const match = /^cobblemon:([a-z]+)_gem_block$/.exec(blockId);
	return match && (GEM_TYPES as readonly string[]).includes(match[1]) ? `cobblemon:${match[1]}_gem_cluster` : undefined;
}

/** #cobblemon:type_gem_blocks. */
export function isGemBlock(typeId: string | undefined): boolean {
	return !!typeId && !!clusterOfGemBlock(typeId);
}

export type GemGrowth = "g" | "s" | undefined;

function growthKey(block: Block): string {
	return keyOf("gem", block);
}

export function getGemGrowth(block: Block): GemGrowth {
	const value = readRaw(growthKey(block));
	return value === "g" || value === "s" ? value : undefined;
}

export function setGemGrowth(block: Block, value: GemGrowth): void {
	writeRaw(growthKey(block), value);
}

/** Resultado de um passo de TypeGemClusterBlock.advanceGrowth. */
export type ClusterStep =
	| { kind: "none" }
	| { kind: "stage"; stage: number }
	| { kind: "stop" }
	| { kind: "stunt" }
	| { kind: "gem" };

/**
 * advanceGrowth puro: `supportOk` = suporte é gema/núcleo; `gemNeighbour` = alguma gema encostada
 * (fora o suporte) — nesse caso o cluster maduro atrofia em vez de virar bloco.
 */
export function clusterStep(growth: GemGrowth, stage: number, supportOk: boolean, gemNeighbour: boolean): ClusterStep {
	if (growth !== "g" || !supportOk) return { kind: "none" };
	if (stage < MAX_GEM_STAGE) return { kind: "stage", stage: stage + 1 };
	return gemNeighbour ? { kind: "stunt" } : { kind: "gem" };
}

export class TypeGemClusterComponent implements BlockCustomComponent {
	/** getStateForPlacement: colocado encostado no núcleo, o cluster cresce. */
	beforeOnPlayerPlace(arg: BlockComponentPlayerPlaceBeforeEvent) {
		const permutation = arg.permutationToPlace;
		const support = neighbor(arg.block, OPPOSITE[faceOf(permutation)]);
		setGemGrowth(arg.block, support?.typeId === GEM_CORE ? "g" : undefined);
	}

	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		const growth = getGemGrowth(block);
		if (growth !== "g") return;
		const facing = faceOf(block.permutation);
		const support = neighbor(block, OPPOSITE[facing]);
		const supportOk = !!support && (isGemBlock(support.typeId) || support.typeId === GEM_CORE);
		const stage = numberState(block, STAGE_STATE);
		const gemNeighbour = stage >= MAX_GEM_STAGE && ALL_DIRS.some((dir) => dir !== OPPOSITE[facing] && isGemBlock(neighbor(block, dir)?.typeId));
		const step = clusterStep(growth, stage, supportOk, gemNeighbour);
		switch (step.kind) {
			case "stage":
				block.setPermutation(block.permutation.withState(STAGE_STATE as never, step.stage as never));
				break;
			case "stunt":
				setGemGrowth(block, "s");
				break;
			case "gem": {
				const clusterId = block.typeId;
				const gem = gemBlockOfCluster(clusterId);
				if (!gem) return;
				setGemGrowth(block, undefined);
				block.setType(gem);
				attachDecorativeClusters(block, clusterId);
				break;
			}
		}
	}

	onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
		setGemGrowth(arg.block, undefined);
	}
}

/** Coloca um cluster com direção e estágio; `growth` decide se ele cresce. */
function placeCluster(target: Block, clusterId: string, face: Dir6, stage: number, growth: GemGrowth): void {
	target.setPermutation(BlockPermutation.resolve(clusterId).withState(FACE_STATE as never, face as never).withState(STAGE_STATE as never, stage as never));
	setGemGrowth(target, growth);
}

/** attachDecorativeClusters: 75%..100% dos lados livres ganham clusters decorativos de estágio aleatório. */
function attachDecorativeClusters(gem: Block, clusterId: string): void {
	if (!clusterId) return;
	const open = ALL_DIRS.filter((dir) => isAir(neighbor(gem, dir)));
	if (!open.length) return;
	const min = Math.max(1, Math.trunc(open.length * 0.75));
	const count = min + randInt(open.length + 1 - min);
	for (const dir of shuffled(open).slice(0, count)) {
		const target = neighbor(gem, dir);
		if (target) placeCluster(target, clusterId, dir, randInt(4), undefined);
	}
}

/** getConnectedGemBlocks: o núcleo e as gemas ligadas a ele (busca em largura). */
function connectedGems(core: Block, limit = 64): Block[] {
	const out: Block[] = [core];
	const seen = new Set<string>([`${core.location.x},${core.location.y},${core.location.z}`]);
	const queue: Block[] = [core];
	while (queue.length && out.length < limit) {
		const current = queue.shift()!;
		for (const dir of ALL_DIRS) {
			const next = neighbor(current, dir);
			if (!next) continue;
			const key = `${next.location.x},${next.location.y},${next.location.z}`;
			if (seen.has(key)) continue;
			seen.add(key);
			if (isGemBlock(next.typeId)) {
				out.push(next);
				queue.push(next);
			}
		}
	}
	return out;
}

/** setStuntState: atrofia (ou libera) os clusters encostados nas gemas. */
function setStuntState(gems: Block[], stunted: boolean): void {
	for (const gem of gems) {
		for (const dir of ALL_DIRS) {
			const cluster = neighbor(gem, dir);
			if (!cluster || !gemBlockOfCluster(cluster.typeId)) continue;
			const growth = getGemGrowth(cluster);
			if (stunted && growth === "g") setGemGrowth(cluster, "s");
			else if (!stunted && growth === "s") setGemGrowth(cluster, "g");
		}
	}
}

export class TypeGemCoreComponent implements BlockCustomComponent {
	/** TypeGemCoreBlock.grow: brota um cluster novo num lado livre de alguma gema ligada ao núcleo. */
	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const gems = connectedGems(arg.block);
		if (gems.length >= MAX_CONNECTED_GEMS) {
			if (!gems.some((gem) => ALL_DIRS.some((dir) => isAir(neighbor(gem, dir))))) return;
			setStuntState(gems, true);
		} else setStuntState(gems, false);
		for (const gem of shuffled(gems)) {
			const clusterId = clusterOfGemBlock(gem.typeId);
			if (!clusterId) continue;
			for (const dir of shuffled(ALL_DIRS)) {
				const target = neighbor(gem, dir);
				if (!target || !isAir(target)) continue;
				placeCluster(target, clusterId, dir, 0, "g");
				return;
			}
		}
	}
}
