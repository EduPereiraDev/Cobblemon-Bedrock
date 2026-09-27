// Mundo falso para rodar batalhas completas no Node (frente batalhas): entidades, jogadores, dimensão,
// inventário e relógio (system.runInterval/runTimeout/currentTick) controlados pelo teste.
import * as mc from "@minecraft/server";

const server = mc as unknown as Record<string, any>;
const system = server.system;
const world = server.world;

// ------------------------------------------------------------------------------------------------
// Relógio
// ------------------------------------------------------------------------------------------------

interface Scheduled { fn: () => void; every: number; next: number; repeat: boolean }
const scheduled = new Map<number, Scheduled>();
let nextRunId = 1;
system.currentTick = 0;
system.runInterval = (fn: () => void, ticks = 1) => {
	const id = nextRunId++;
	scheduled.set(id, { fn, every: Math.max(1, ticks), next: system.currentTick + Math.max(1, ticks), repeat: true });
	return id;
};
system.runTimeout = (fn: () => void, ticks = 1) => {
	const id = nextRunId++;
	scheduled.set(id, { fn, every: ticks, next: system.currentTick + Math.max(1, ticks ?? 1), repeat: false });
	return id;
};
system.run = (fn: () => void) => system.runTimeout(fn, 1);
system.clearRun = (id: number) => { scheduled.delete(id); };

export const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** Avança o relógio em passos de `step` ticks, rodando os agendados e esvaziando as promessas. */
export async function advance(ticks: number, step = 5) {
	for (let elapsed = 0; elapsed < ticks; elapsed += step) {
		system.currentTick += step;
		for (const [id, run] of [...scheduled.entries()]) {
			if (!scheduled.has(id) || run.next > system.currentTick) continue;
			if (run.repeat) run.next = system.currentTick + run.every;
			else scheduled.delete(id);
			run.fn();
		}
		await flush();
	}
}

/** Avança até `done()` ou o limite de ticks. */
export async function advanceUntil(done: () => boolean, maxTicks = 200_000) {
	for (let elapsed = 0; elapsed < maxTicks && !done(); elapsed += 50) await advance(50);
	return done();
}

// ------------------------------------------------------------------------------------------------
// Entidades
// ------------------------------------------------------------------------------------------------

export interface FakeItem { typeId: string; amount: number }

export class FakeContainer {
	slots: (FakeItem | undefined)[];
	added: unknown[] = [];
	constructor(public size = 36) { this.slots = new Array(size).fill(undefined); }
	getItem(slot: number) { return this.slots[slot]; }
	setItem(slot: number, item?: FakeItem) { this.slots[slot] = item; }
	getSlot(slot: number) { return { setItem: (item?: FakeItem) => this.setItem(slot, item), getItem: () => this.getItem(slot) }; }
	addItem(item: unknown) { this.added.push(item); return undefined; }
	count(typeId: string) { return this.slots.reduce((sum, item) => sum + (item?.typeId === typeId ? item.amount : 0), 0); }
}

let nextEntityId = 1;

export class FakeEntity {
	id = `${-(nextEntityId++)}`;
	isValid = true;
	nameTag = "";
	tags = new Set<string>();
	dynamic = new Map<string, unknown>();
	properties = new Map<string, unknown>([["cobblemon:in_battle", false], ["cobblemon:wild", false], ["cobblemon:initialized", false], ["cobblemon:busy", false]]);
	animations: string[] = [];
	families: string[];
	container = new FakeContainer(1);
	health = 20;
	constructor(public typeId: string, public location: { x: number; y: number; z: number }, public dimension: FakeDimension, families: string[] = []) {
		this.families = families;
		dimension.entities.push(this);
	}
	getComponent(name: string) {
		switch (name.replace("minecraft:", "")) {
			case "type_family": return { hasTypeFamily: (family: string) => this.families.includes(family) };
			case "inventory": return { container: this.container };
			case "health": return { currentValue: this.health };
			case "tameable": return { tame() { }, tamedToPlayer: undefined };
			default: return undefined;
		}
	}
	getDynamicProperty(key: string) { return this.dynamic.get(key); }
	setDynamicProperty(key: string, value?: unknown) { if (value === undefined) this.dynamic.delete(key); else this.dynamic.set(key, value); }
	getProperty(key: string) { return this.properties.get(key); }
	setProperty(key: string, value: unknown) { this.properties.set(key, value); }
	hasTag(tag: string) { return this.tags.has(tag); }
	addTag(tag: string) { this.tags.add(tag); return true; }
	removeTag(tag: string) { return this.tags.delete(tag); }
	getTags() { return [...this.tags]; }
	playAnimation(animation: string) { this.animations.push(animation); }
	kill() { this.isValid = false; return true; }
	triggerEvent(event: string) { if (event === "cobblemon:instant_kill") this.isValid = false; }
	teleport(location: { x: number; y: number; z: number }) { this.location = { ...location }; }
	tryTeleport(location: { x: number; y: number; z: number }) { this.location = { x: location.x, y: location.y, z: location.z }; return true; }
	addEffect() { } removeEffect() { }
	getBlockFromViewDirection() { return undefined; }
}
Object.setPrototypeOf(FakeEntity.prototype, server.Entity.prototype);

export class FakePlayer extends FakeEntity {
	messages: unknown[] = [];
	gameMode = "Survival";
	onScreenDisplay = { setActionBar() { }, setTitle() { } };
	isSneaking = false;
	selectedSlotIndex = 0;
	constructor(public name: string, location: { x: number; y: number; z: number }, dimension: FakeDimension) {
		super("minecraft:player", location, dimension, ["player"]);
		this.container = new FakeContainer(36);
	}
	sendMessage(message: unknown) { this.messages.push(message); }
	getGameMode() { return this.gameMode; }
	playMusic() { } stopMusic() { } playSound() { }
	/** Mensagens com uma chave de tradução (procura em rawtext/with aninhados). */
	hasMessage(key: string) { return this.messages.some(message => JSON.stringify(message).includes(`"${key}"`)); }
}
// FakePlayer → Player → FakeEntity → Entity: `instanceof Player` e `instanceof Entity` funcionam.
Object.setPrototypeOf(server.Player.prototype, FakeEntity.prototype);
Object.setPrototypeOf(FakePlayer.prototype, server.Player.prototype);

export class FakeDimension {
	entities: FakeEntity[] = [];
	drops: { item: unknown; location: unknown }[] = [];
	sounds: string[] = [];
	constructor(public id: string) { }
	getEntities(options: { tags?: string[]; families?: string[] } = {}) {
		return this.entities.filter(entity => entity.isValid
			&& (options.tags ?? []).every(tag => entity.tags.has(tag))
			&& (options.families ?? []).every(family => entity.families.includes(family)));
	}
	getPlayers() { return this.entities.filter(x => x instanceof FakePlayer && x.isValid); }
	spawnEntity(typeId: string, location: { x: number; y: number; z: number }) {
		return new FakeEntity(typeId, { x: location.x, y: location.y, z: location.z }, this, typeId.startsWith("cobblemon:") ? ["pokemon", "mob"] : []);
	}
	spawnItem(item: unknown, location: unknown) { this.drops.push({ item, location }); return new FakeEntity("minecraft:item", { x: 0, y: 0, z: 0 }, this); }
	playSound(sound: string) { this.sounds.push(sound); }
	runCommand() { return { successCount: 0 }; }
}

export const overworld = new FakeDimension("minecraft:overworld");
const otherDimensions = new Map<string, FakeDimension>();
world.getDimension = (id: string) => {
	if (id === "overworld" || id === "minecraft:overworld") return overworld;
	if (!otherDimensions.has(id)) otherDimensions.set(id, new FakeDimension(id));
	return otherDimensions.get(id)!;
};
world.getEntity = (id: string) => [overworld, ...otherDimensions.values()].flatMap(d => d.entities).find(x => x.id === id);
world.getAllPlayers = () => overworld.getPlayers();
world.getPlayers = () => overworld.getPlayers();
world.getDynamicProperty = () => undefined;
world.setDynamicProperty = () => { };

/** Jogador com time salvo como no jogo (dynamic properties "initialized" e "team"). */
export function createPlayer(name: string, team: { uuid: string; trainer?: string }[], location = { x: 0, y: 64, z: 0 }) {
	const player = new FakePlayer(name, location, overworld);
	for (const pokemon of team) pokemon.trainer = player.id;
	player.setDynamicProperty("initialized", true);
	player.setDynamicProperty("team", JSON.stringify([...team, ...new Array(Math.max(0, 6 - team.length)).fill(null)]));
	return player;
}

/** Entidade de Pokémon selvagem com os dados aplicados (applyToCobblemon). */
export function spawnWild(data: { getEntityId(): string; applyToCobblemon(entity: never): void }, location = { x: 4, y: 64, z: 0 }) {
	const entity = overworld.spawnEntity(data.getEntityId(), location);
	data.applyToCobblemon(entity as never);
	entity.setProperty("cobblemon:wild", true);
	return entity;
}
