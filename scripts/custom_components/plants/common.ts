/**
 * Utilitários da frente "mundo-plantas": aleatoriedade injetável (testes), direções, item na mão,
 * farinha de osso, luz, drops e armazenamento por posição de bloco (substitui os block entities do Java).
 *
 * Atenção: o importador (tools/importer/blocks.ts) considera registrado todo `"cobblemon:<nome>":` que
 * aparece nos arquivos desta pasta. Por isso aqui (e nos demais arquivos que não são index.ts/mulch.ts)
 * nunca se escreve um estado "cobblemon:..." como chave de objeto literal.
 */
import { Block, Dimension, GameMode, ItemStack, Player, Vector3, world } from "@minecraft/server";

// ---------------------------------------------------------------------------------------------
// Aleatoriedade (substituível nos testes)

export const rng = {
	/** Número em [0, 1). */
	next: (): number => Math.random(),
};

/** Equivalente a `random.nextInt(bound)` do Java: inteiro em [0, bound). */
export function randInt(bound: number): number {
	return Math.floor(rng.next() * bound);
}

/** Inteiro em [min, max] (inclusivo), como `IntRange.random()` / `nextIntBetweenInclusive`. */
export function randBetween(min: number, max: number): number {
	if (max <= min) return min;
	return min + Math.floor(rng.next() * (max - min + 1));
}

export function pickRandom<T>(list: readonly T[]): T | undefined {
	return list.length ? list[randInt(list.length)] : undefined;
}

export function shuffled<T>(list: readonly T[]): T[] {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = randInt(i + 1);
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

// ---------------------------------------------------------------------------------------------
// Relógio do mundo (ticks absolutos, continuam correndo com o chunk descarregado)

export const clock = {
	now: (): number => world.getAbsoluteTime(),
};

// ---------------------------------------------------------------------------------------------
// Direções

export type Dir6 = "down" | "up" | "north" | "south" | "east" | "west";
export type Dir4 = "north" | "south" | "east" | "west";

export const HORIZONTAL: readonly Dir4[] = ["north", "east", "south", "west"];
export const ALL_DIRS: readonly Dir6[] = ["down", "up", "north", "south", "east", "west"];

export const OFFSETS: Record<Dir6, Vector3> = {
	down: { x: 0, y: -1, z: 0 },
	up: { x: 0, y: 1, z: 0 },
	north: { x: 0, y: 0, z: -1 },
	south: { x: 0, y: 0, z: 1 },
	east: { x: 1, y: 0, z: 0 },
	west: { x: -1, y: 0, z: 0 },
};

export const OPPOSITE: Record<Dir6, Dir6> = { down: "up", up: "down", north: "south", south: "north", east: "west", west: "east" };

/** Direction.getCounterClockWise() do Java (visto de cima). */
export const COUNTER_CLOCKWISE: Record<Dir4, Dir4> = { north: "west", west: "south", south: "east", east: "north" };
export const CLOCKWISE: Record<Dir4, Dir4> = { north: "east", east: "south", south: "west", west: "north" };

export function axisOf(dir: Dir6): "x" | "y" | "z" {
	return dir === "east" || dir === "west" ? "x" : dir === "up" || dir === "down" ? "y" : "z";
}

export function offset(location: Vector3, dir: Dir6, distance = 1): Vector3 {
	const o = OFFSETS[dir];
	return { x: location.x + o.x * distance, y: location.y + o.y * distance, z: location.z + o.z * distance };
}

/** Bloco vizinho (undefined fora do mundo carregado). */
export function neighbor(block: Block, dir: Dir6, distance = 1): Block | undefined {
	try {
		return block.dimension.getBlock(offset(block.location, dir, distance));
	} catch {
		return undefined;
	}
}

/** Direction do evento (ex.: "North") → nome minúsculo. */
export function faceName(face: unknown): Dir6 | undefined {
	const name = String(face ?? "").toLowerCase();
	return (ALL_DIRS as readonly string[]).includes(name) ? (name as Dir6) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Estados

export function numberState(block: Block, state: string, fallback = 0): number {
	const value = block.permutation.getState(state as never);
	return typeof value === "number" ? value : fallback;
}

/** Troca estados do bloco; não faz nada quando já estão iguais. */
export function setStates(block: Block, states: Record<string, string | number | boolean>): void {
	let permutation = block.permutation;
	let changed = false;
	for (const [key, value] of Object.entries(states)) {
		if (permutation.getState(key as never) === value) continue;
		permutation = permutation.withState(key as never, value as never);
		changed = true;
	}
	if (changed) block.setPermutation(permutation);
}

// ---------------------------------------------------------------------------------------------
// Jogador e itens

export function heldItem(player: Player | undefined): ItemStack | undefined {
	if (!player) return undefined;
	try {
		return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
	} catch {
		return undefined;
	}
}

export function isCreative(player: Player | undefined): boolean {
	try {
		return player?.getGameMode() === GameMode.Creative;
	} catch {
		return false;
	}
}

/** Consome 1 item da mão (fora do criativo). */
export function consumeHeld(player: Player): void {
	if (isCreative(player)) return;
	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return;
	const item = container.getItem(player.selectedSlotIndex);
	if (!item) return;
	if (item.amount <= 1) container.setItem(player.selectedSlotIndex, undefined);
	else {
		item.amount--;
		container.setItem(player.selectedSlotIndex, item);
	}
}

/** Consome 1 item da mão e devolve outro (ex.: garrafa de mel → garrafa vazia), fora do criativo. */
export function exchangeHeld(player: Player, resultId: string): void {
	if (isCreative(player)) return;
	const container = player.getComponent("minecraft:inventory")?.container;
	if (!container) return;
	const item = container.getItem(player.selectedSlotIndex);
	if (!item) return;
	const result = new ItemStack(resultId, 1);
	if (item.amount <= 1) {
		container.setItem(player.selectedSlotIndex, result);
		return;
	}
	item.amount--;
	container.setItem(player.selectedSlotIndex, item);
	const leftover = container.addItem(result);
	if (leftover) player.dimension.spawnItem(leftover, player.location);
}

/** Dá um item ao jogador (ou solta no chão se o inventário estiver cheio). */
export function giveItem(player: Player, typeId: string, amount = 1): void {
	const leftover = player.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(typeId, amount));
	if (leftover) player.dimension.spawnItem(leftover, player.location);
}

/** Tira 1 de durabilidade da ferramenta na mão (fora do criativo), respeitando Unbreaking. */
export function damageHeld(player: Player): void {
	if (isCreative(player)) return;
	const container = player.getComponent("minecraft:inventory")?.container;
	const item = container?.getItem(player.selectedSlotIndex);
	const durability = item?.getComponent("minecraft:durability");
	if (!container || !item || !durability) return;
	const unbreaking = item.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0;
	if (rng.next() > durability.getDamageChance(unbreaking)) return;
	if (durability.damage + 1 >= durability.maxDurability) {
		container.setItem(player.selectedSlotIndex, undefined);
		player.dimension.playSound("random.break", player.location);
		return;
	}
	durability.damage++;
	container.setItem(player.selectedSlotIndex, item);
}

export function hasItemTag(item: ItemStack | undefined, tag: string): boolean {
	try {
		return !!item?.hasTag(tag);
	} catch {
		return false;
	}
}

export function isWaterBottle(item: ItemStack | undefined): boolean {
	if (item?.typeId !== "minecraft:potion") return false;
	try {
		const potion = item.getComponent("minecraft:potion");
		return !potion || potion.potionEffectType.id.toLowerCase().replace(/^minecraft:/, "") === "water";
	} catch {
		return false;
	}
}

/** Centro do bloco (onde os drops aparecem). */
export function center(location: Vector3): Vector3 {
	return { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
}

/** Fábrica de drops (os testes trocam para registrar o que caiu). */
export const drops = {
	spawn: (dimension: Dimension, location: Vector3, typeId: string, count: number): void => {
		dimension.spawnItem(new ItemStack(typeId, count), location);
	},
};

/** Solta itens no centro do bloco, em pilhas de até `maxStack`. */
export function dropItems(dimension: Dimension, location: Vector3, typeId: string, amount: number, maxStack = 64): void {
	let remaining = amount;
	while (remaining > 0) {
		const count = Math.min(remaining, maxStack);
		drops.spawn(dimension, center(location), typeId, count);
		remaining -= count;
	}
}

/** Efeito da farinha de osso (partícula + som), como LevelEvent.PARTICLES_AND_SOUND_PLANT_GROWTH. */
export function boneMealEffect(block: Block): void {
	try {
		block.dimension.spawnParticle("minecraft:crop_growth_emitter", center(block.location));
		block.dimension.playSound("item.bone_meal.use", block.location);
	} catch { /* partícula/som são cosméticos */ }
}

export function playSound(block: Block, sound: string, volume = 1, pitch = 1): void {
	try {
		block.dimension.playSound(sound, center(block.location), { volume, pitch });
	} catch { /* som é cosmético */ }
}

/** Destrói o bloco com drops e partículas (como quebrar à mão). */
export function destroyBlock(block: Block): void {
	const { x, y, z } = block.location;
	block.dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`);
}

// ---------------------------------------------------------------------------------------------
// Luz e ambiente

/** Brilho bruto (máximo entre luz do céu e de blocos), como getRawBrightness do Java. */
export function lightAt(dimension: Dimension, location: Vector3): number {
	try {
		return dimension.getLightLevel(location);
	} catch {
		return 15;
	}
}

export const AIR_LIKE = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
/** Blocos que o crescimento pode substituir (canBeReplaced / replaceable_by_trees). */
export const REPLACEABLE = new Set([
	...AIR_LIKE, "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:deadbush",
	"minecraft:snow_layer", "minecraft:vine", "minecraft:glow_lichen", "minecraft:hanging_roots", "minecraft:water", "minecraft:flowing_water",
]);

export function isAir(block: Block | undefined): boolean {
	return !!block && AIR_LIKE.has(block.typeId);
}

/** Blocos da tag #minecraft:dirt no Bedrock. */
export const DIRT = new Set([
	"minecraft:dirt", "minecraft:grass_block", "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:mycelium", "minecraft:dirt_with_roots",
	"minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:rooted_dirt",
]);

// ---------------------------------------------------------------------------------------------
// Armazenamento por posição de bloco (world dynamic properties; em memória nos testes)

export interface KeyValueBackend {
	get(key: string): string | undefined;
	set(key: string, value: string | undefined): void;
}

const worldBackend: KeyValueBackend = {
	get: (key) => {
		const value = world.getDynamicProperty(key);
		return typeof value === "string" ? value : undefined;
	},
	set: (key, value) => world.setDynamicProperty(key, value),
};

let backend: KeyValueBackend = worldBackend;

/** Troca o armazenamento (testes). Sem argumento, volta para as dynamic properties do mundo. */
export function setStoreBackend(custom?: KeyValueBackend): void {
	backend = custom ?? worldBackend;
}

export function memoryBackend(): KeyValueBackend & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return { data, get: (k) => data.get(k), set: (k, v) => (v === undefined ? data.delete(k) : data.set(k, v)) };
}

export function blockKey(prefix: string, dimensionId: string, location: Vector3): string {
	return `cobblemon:${prefix}|${dimensionId}|${location.x},${location.y},${location.z}`;
}

export function keyOf(prefix: string, block: Block): string {
	return blockKey(prefix, block.dimension.id, block.location);
}

export function readJson<T>(key: string): T | undefined {
	try {
		const raw = backend.get(key);
		return raw ? (JSON.parse(raw) as T) : undefined;
	} catch {
		return undefined;
	}
}

export function writeJson(key: string, value: unknown): void {
	try {
		backend.set(key, value === undefined ? undefined : JSON.stringify(value));
	} catch { /* sem mundo (ex.: early execution) */ }
}

export function readRaw(key: string): string | undefined {
	try {
		return backend.get(key);
	} catch {
		return undefined;
	}
}

export function writeRaw(key: string, value: string | undefined): void {
	try {
		backend.set(key, value);
	} catch { /* sem mundo */ }
}
