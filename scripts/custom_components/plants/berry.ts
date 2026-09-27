/**
 * Arbusto de berry (BerryBlock + BerryBlockEntity + Berry do Cobblemon 1.8.2).
 *
 * O Bedrock não tem block entity para blocos custom: timers, pontos de crescimento (berries que o
 * arbusto vai dar) e duração do mulch ficam num registro JSON por posição (world dynamic property).
 * O tipo de mulch fica no próprio estado cobblemon:mulch, que o modelo gerado já desenha.
 *
 * Crescimento: igual ao Java, com compensação de tempo — cada random tick desconta do stageTimer os
 * ticks passados desde o anterior (world.getAbsoluteTime), então a velocidade independe da taxa de
 * random tick. Idades: 0..3 brotando, 3→4 gera a colheita (rendimento + mutação), 5 = frutos maduros.
 */
import { Block, BlockComponentOnPlaceEvent, BlockComponentPlayerBreakEvent, BlockComponentPlayerInteractEvent, BlockComponentRandomTickEvent, BlockCustomComponent, Player } from "@minecraft/server";
import { ITEMS } from "../../../generated/scripts/items";
import { BIOME_TAGS } from "../../../generated/scripts/biomeTags";
import {
	boneMealEffect, clock, consumeHeld, dropItems, hasItemTag, heldItem, HORIZONTAL, isCreative, keyOf, neighbor, numberState, pickRandom,
	playSound, randBetween, randInt, readJson, rng, setStates, writeJson,
} from "./common";

export const MATURE_AGE = 3;
export const FLOWER_AGE = 4;
export const FRUIT_AGE = 5;
const TICKS_PER_MINUTE = 1200;
const GROWTH_MULTIPLIER = 14;
export const RICH_MULCH_MIN = 1;
export const RICH_MULCH_MAX = 2;
/** Chance de mutação em ‰ (x4 com surprise mulch). */
export const MUTATION_CHANCE = 125;

export const AGE_STATE = "cobblemon:age";
export const MULCH_STATE = "cobblemon:mulch";
export const ROOTED_STATE = "cobblemon:rooted";

export type MulchVariant = "none" | "coarse" | "growth" | "humid" | "loamy" | "peat" | "rich" | "sandy" | "surprise";
export const MULCH_VARIANTS: readonly MulchVariant[] = ["coarse", "growth", "humid", "loamy", "peat", "rich", "sandy", "surprise"];
/** MulchVariant.duration (-1 = permanente). */
export const MULCH_DURATION: Record<MulchVariant, number> = { none: -1, coarse: -1, growth: 5, humid: -1, loamy: -1, peat: -1, rich: 5, sandy: -1, surprise: 3 };
export const GROWTH_TIME_MULTIPLIER = 0.5;

/** Sons de bloco do Cobblemon (sounds.json `block.*`, importados como `cobblemon.block.*`). */
export const BERRY_SOUNDS = {
	harvest: "cobblemon.block.berry_bush.harvest",
	mulchPlace: "cobblemon.block.mulch.place",
	mulchRemove: "cobblemon.block.mulch.remove",
	shear: "mob.sheep.shear",
};

export interface IntRange { min: number; max: number }

export interface BerryData {
	/** Id do bloco/item (ex.: cobblemon:oran_berry). */
	id: string;
	baseYield: IntRange;
	growthTime: IntRange;
	refreshRate: IntRange;
	favoriteMulches: string[];
	growthFactors: Array<{ variant: string; bonusYield: IntRange }>;
	mutations: Record<string, string>;
	preferredBiomeTags: string[];
	boneMealChance: number;
	/** Quantidade de pontos de crescimento do modelo (teto do rendimento). */
	growthPoints: number;
}

/**
 * Número de growthPoints de cada berry (data/cobblemon/berries/*.json, 1.8.2). O importador ainda não
 * leva esse campo para ITEMS[id].berry; quando levar (growthPointCount), ele tem prioridade.
 */
const GROWTH_POINTS: Record<string, number> = {
	aguav: 6, apicot: 8, aspear: 10, babiri: 8, belue: 5, bluk: 10, charti: 8, cheri: 8, chesto: 10, chilan: 8, chople: 8, coba: 6, colbur: 6,
	cornn: 8, custap: 4, durin: 8, eggant: 7, enigma: 6, figy: 6, ganlon: 5, grepa: 10, haban: 8, hondew: 5, hopo: 8, iapapa: 10, jaboca: 8,
	kasib: 5, kebia: 7, kee: 8, kelpsy: 10, lansat: 10, leppa: 4, liechi: 4, lum: 4, mago: 9, magost: 7, maranga: 5, micle: 9, nanab: 10,
	nomel: 6, occa: 8, oran: 10, pamtre: 8, passho: 5, payapa: 5, pecha: 10, persim: 8, petaya: 8, pinap: 10, pomeg: 6, qualot: 10, rabuta: 6,
	rawst: 9, razz: 10, rindo: 8, roseli: 8, rowap: 4, salac: 6, shuca: 8, sitrus: 10, spelon: 8, starf: 6, tamato: 10, tanga: 8, touga: 10,
	wacan: 9, watmel: 4, wepear: 10, wiki: 6, yache: 10,
};

const berryCache = new Map<string, BerryData | null>();

/** Dados da berry a partir do id do bloco (ou item). */
export function getBerry(id: string): BerryData | undefined {
	const cached = berryCache.get(id);
	if (cached !== undefined) return cached ?? undefined;
	const path = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
	const raw = ITEMS[path]?.berry as Record<string, any> | undefined;
	let data: BerryData | null = null;
	if (raw) {
		const range = (r: any, fallback: IntRange): IntRange => (r && typeof r.min === "number" ? { min: r.min, max: r.max ?? r.min } : fallback);
		data = {
			id: `cobblemon:${path}`,
			baseYield: range(raw.baseYield, { min: 1, max: 1 }),
			growthTime: range(raw.growthTime, { min: 36, max: 44 }),
			refreshRate: range(raw.refreshRate, { min: 18, max: 22 }),
			favoriteMulches: (raw.favoriteMulches ?? []).map((m: string) => m.toLowerCase()),
			growthFactors: (raw.growthFactors ?? []).map((f: any) => ({ variant: String(f.variant), bonusYield: range(f.bonusYield, { min: 0, max: 0 }) })),
			mutations: raw.mutations ?? {},
			preferredBiomeTags: raw.preferredBiomeTags ?? [],
			boneMealChance: typeof raw.boneMealChance === "number" ? raw.boneMealChance : 1,
			growthPoints: typeof raw.growthPointCount === "number" ? raw.growthPointCount : GROWTH_POINTS[path.replace(/_berry$/, "")] ?? 8,
		};
	}
	berryCache.set(id, data);
	return data ?? undefined;
}

export function isBerryBush(typeId: string): boolean {
	return typeId.startsWith("cobblemon:") && typeId.endsWith("_berry") && !!getBerry(typeId);
}

// ---------------------------------------------------------------------------------------------
// Lógica pura (testável): registro + contexto

/** Estado persistente por arbusto (equivalente ao NBT do BerryBlockEntity). */
export interface BerryRecord {
	berry: string;
	/** Idade quando o registro foi salvo (detecta registro velho numa posição reaproveitada). */
	age: number;
	growthTimer: number;
	stageTimer: number;
	lastTick: number;
	mulchDuration: number;
	/** Berries que a colheita vai dar (ids completos); mutações trocam entradas. */
	points: string[];
}

export interface BushContext {
	berry: BerryData;
	age: number;
	mulch: MulchVariant;
	rooted: boolean;
	rec: BerryRecord;
}

export interface BerryEnvironment {
	/** O bioma está numa das preferredBiomeTags da berry (fator cobblemon:preferred_biome). */
	inPreferredBiome: boolean;
	/** Berries (ids completos) nos 4 vizinhos horizontais. */
	neighbourBerries: string[];
}

/** decrementMulchDuration: mulch com duração acaba depois de N usos. */
export function decrementMulch(ctx: BushContext): void {
	if (ctx.mulch === "none" || MULCH_DURATION[ctx.mulch] === -1) return;
	const next = ctx.rec.mulchDuration - 1;
	if (next <= 0) {
		ctx.mulch = "none";
		ctx.rec.mulchDuration = 0;
	} else ctx.rec.mulchDuration = next;
}

/** applyMulchModifier: growth mulch corta o tempo pela metade (e gasta uma carga quando pedido). */
function applyMulchModifier(ctx: BushContext, timer: number, decrement: boolean): number {
	if (ctx.age === FRUIT_AGE || ctx.mulch !== "growth") return timer;
	if (decrement) decrementMulch(ctx);
	return Math.trunc(timer * GROWTH_TIME_MULTIPLIER);
}

/** goToNextStageTimer: próximo estágio leva 80%..100% da média do tempo restante. */
export function goToNextStageTimer(rec: BerryRecord, stagesLeft: number): void {
	const avg = Math.trunc(rec.growthTimer / Math.max(1, stagesLeft));
	rec.stageTimer = randBetween(Math.trunc((avg * 8) / 10), avg);
	rec.growthTimer = Math.max(0, rec.growthTimer - rec.stageTimer);
}

/** resetGrowTimers: tempo total do ciclo (growthTime na idade 0, refreshRate depois), em ticks. */
export function resetGrowTimers(ctx: BushContext): void {
	if (ctx.age === FRUIT_AGE) return;
	const range = ctx.age === 0 ? ctx.berry.growthTime : ctx.berry.refreshRate;
	const lower = Math.trunc((range.min * GROWTH_MULTIPLIER) / 10);
	const upper = Math.trunc((range.max * GROWTH_MULTIPLIER) / 10);
	ctx.rec.growthTimer = Math.max(0, applyMulchModifier(ctx, randBetween(lower, upper) * TICKS_PER_MINUTE, true));
	const stagesLeft = ctx.age < MATURE_AGE ? MATURE_AGE - ctx.age : FRUIT_AGE - ctx.age;
	goToNextStageTimer(ctx.rec, stagesLeft);
}

/** refreshTimers: aplicar growth mulch corta os timers atuais pela metade. */
export function refreshTimers(ctx: BushContext): void {
	ctx.rec.growthTimer = applyMulchModifier(ctx, ctx.rec.growthTimer, false);
	ctx.rec.stageTimer = applyMulchModifier(ctx, ctx.rec.stageTimer, false);
}

/** Registro novo (BerryBlockEntity recém-criado); arbustos já maduros (worldgen) ganham rendimento simples. */
export function createRecord(berry: BerryData, age: number, mulch: MulchVariant): BushContext {
	const ctx: BushContext = {
		berry, age, mulch, rooted: false,
		rec: { berry: berry.id, age, growthTimer: 0, stageTimer: 0, lastTick: 0, mulchDuration: MULCH_DURATION[mulch], points: [] },
	};
	resetGrowTimers(ctx);
	if (age >= FLOWER_AGE) generateSimpleYields(ctx);
	return ctx;
}

export function generateSimpleYields(ctx: BushContext): void {
	const amount = randBetween(ctx.berry.baseYield.min, ctx.berry.baseYield.max);
	ctx.rec.points = new Array(amount).fill(ctx.berry.id);
}

/** Berry.calculateYield: base + fatores (ou mulch favorito) + rich mulch, limitado aos pontos do modelo. */
export function calculateYield(ctx: BushContext, env: BerryEnvironment): number {
	let total = randBetween(ctx.berry.baseYield.min, ctx.berry.baseYield.max);
	const favourite = ctx.berry.favoriteMulches.includes(ctx.mulch);
	for (const factor of ctx.berry.growthFactors) {
		const valid = factor.variant === "cobblemon:preferred_biome" ? env.inPreferredBiome : false;
		if (valid || favourite) total += randBetween(factor.bonusYield.min, factor.bonusYield.max);
	}
	if (ctx.mulch === "rich") {
		total += randBetween(RICH_MULCH_MIN, RICH_MULCH_MAX);
		decrementMulch(ctx);
	}
	return Math.min(total, ctx.berry.growthPoints);
}

export function generateGrowthPoints(ctx: BushContext, env: BerryEnvironment): void {
	ctx.rec.points = new Array(calculateYield(ctx, env)).fill(ctx.berry.id);
}

/** Mutações possíveis com os vizinhos (Berry.mutationWith), sem repetição. */
export function mutationCandidates(berry: BerryData, neighbourBerries: string[]): string[] {
	const out = new Set<string>();
	for (const partner of neighbourBerries) {
		const result = berry.mutations[partner];
		if (result && getBerry(result)) out.add(result);
	}
	return [...out];
}

/** BerryBlock.determineMutation: 12,5% (50% com surprise mulch) de trocar um ponto pela mutação. */
export function determineMutation(ctx: BushContext, env: BerryEnvironment): string | undefined {
	const candidates = mutationCandidates(ctx.berry, env.neighbourBerries);
	if (!candidates.length) return undefined;
	let chance = MUTATION_CHANCE;
	if (ctx.mulch === "surprise") {
		chance *= 4;
		decrementMulch(ctx);
	}
	if (randInt(1000) >= chance) return undefined;
	const mutation = pickRandom(candidates)!;
	if (ctx.rec.points.length) ctx.rec.points[randInt(ctx.rec.points.length)] = mutation;
	return mutation;
}

/** BerryBlockEntity.processTick: desconta o tempo passado e diz se é hora de crescer. */
export function processTick(ctx: BushContext, now: number): boolean {
	if (ctx.rooted) return false;
	const elapsed = ctx.rec.lastTick > 0 ? Math.max(1, now - ctx.rec.lastTick) : 1;
	ctx.rec.lastTick = now;
	if (ctx.rec.stageTimer > 0) ctx.rec.stageTimer = Math.max(0, ctx.rec.stageTimer - elapsed);
	return ctx.rec.stageTimer <= 0;
}

/** BerryBlock.growHelper: avança uma idade; em 3→4 gera a colheita e tenta mutar. */
export function growHelper(ctx: BushContext, env: BerryEnvironment, boneMealed = false): boolean {
	if (boneMealed && rng.next() > ctx.berry.boneMealChance) return false;
	const current = ctx.age;
	if (current + 1 > FRUIT_AGE) return false;
	if (current === MATURE_AGE) {
		generateGrowthPoints(ctx, env);
		determineMutation(ctx, env);
	}
	ctx.age = current + 1;
	goToNextStageTimer(ctx.rec, FRUIT_AGE - current);
	return true;
}

/** BerryBlockEntity.harvest (sem o refresh): quantidade por berry. */
export function harvestCounts(ctx: BushContext): Map<string, number> {
	const counts = new Map<string, number>();
	for (const id of ctx.rec.points) if (getBerry(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
	return counts;
}

/** Colheita por interação: devolve os drops e volta à idade 3 com timers de refreshRate. */
export function harvest(ctx: BushContext): Map<string, number> {
	const counts = harvestCounts(ctx);
	ctx.age = MATURE_AGE;
	resetGrowTimers(ctx);
	return counts;
}

/** Mulchable.canHaveMulchApplied do BerryBlock. */
export function canApplyMulch(ctx: BushContext, soilIsFarmland: boolean): boolean {
	return (ctx.rooted || soilIsFarmland) && ctx.mulch === "none" && ctx.age < FLOWER_AGE;
}

/** BerryBlockEntity.setMulch. */
export function setMulch(ctx: BushContext, variant: MulchVariant): void {
	ctx.mulch = variant;
	ctx.rec.mulchDuration = MULCH_DURATION[variant];
	refreshTimers(ctx);
}

// ---------------------------------------------------------------------------------------------
// Ponte com o mundo

function recordKey(block: Block): string {
	return keyOf("berry", block);
}

function mulchOf(block: Block): MulchVariant {
	const value = block.permutation.getState(MULCH_STATE as never);
	return typeof value === "string" && (MULCH_VARIANTS as readonly string[]).includes(value) ? (value as MulchVariant) : "none";
}

/** Contexto do arbusto (cria o registro na hora para blocos de worldgen/comandos). */
export function loadBush(block: Block): BushContext | undefined {
	const berry = getBerry(block.typeId);
	if (!berry) return undefined;
	const age = numberState(block, AGE_STATE);
	const mulch = mulchOf(block);
	const rooted = block.permutation.getState(ROOTED_STATE as never) === true;
	const rec = readJson<BerryRecord>(recordKey(block));
	if (rec && rec.berry === berry.id && Array.isArray(rec.points)) return { berry, age, mulch, rooted, rec };
	const ctx = createRecord(berry, age, mulch);
	ctx.rooted = rooted;
	return ctx;
}

/** Salva o registro antes de mexer no bloco (onPlace pode disparar na troca de permutação). */
export function saveBush(block: Block, ctx: BushContext): void {
	ctx.rec.age = ctx.age;
	writeJson(recordKey(block), ctx.rec);
	setStates(block, { [AGE_STATE]: ctx.age, [MULCH_STATE]: ctx.mulch });
}

function biomeMatches(block: Block, tags: string[]): boolean {
	if (!tags.length) return false;
	try {
		const biome = block.dimension.getBiome(block.location).id.replace(/^minecraft:/, "");
		return tags.some((tag) => BIOME_TAGS[tag]?.includes(biome));
	} catch {
		return false;
	}
}

export function environmentOf(block: Block, berry: BerryData): BerryEnvironment {
	const neighbourBerries: string[] = [];
	for (const dir of HORIZONTAL) {
		const other = neighbor(block, dir);
		if (other && isBerryBush(other.typeId)) neighbourBerries.push(other.typeId);
	}
	return { inPreferredBiome: biomeMatches(block, berry.preferredBiomeTags), neighbourBerries };
}

/** Aplica mulch num arbusto (item de mulch ou interação). Devolve se aplicou. */
export function applyBerryMulch(block: Block, variant: MulchVariant, player?: Player): boolean {
	const ctx = loadBush(block);
	if (!ctx) return false;
	const below = neighbor(block, "down");
	if (!canApplyMulch(ctx, below?.typeId === "minecraft:farmland")) return false;
	setMulch(ctx, variant);
	saveBush(block, ctx);
	if (player) consumeHeld(player);
	boneMealEffect(block);
	playSound(block, BERRY_SOUNDS.mulchPlace, 0.6);
	return true;
}

function dropHarvest(block: Block, counts: Map<string, number>): void {
	for (const [id, amount] of counts) dropItems(block.dimension, block.location, id, amount);
}

export class BerryBushComponent implements BlockCustomComponent {
	onPlace(arg: BlockComponentOnPlaceEvent) {
		const berry = getBerry(arg.block.typeId);
		if (!berry) return;
		const age = numberState(arg.block, AGE_STATE);
		const rec = readJson<BerryRecord>(recordKey(arg.block));
		// Troca de permutação feita por nós mesmos: o registro já está salvo com a idade atual.
		if (rec && rec.berry === berry.id && rec.age === age) return;
		const ctx = createRecord(berry, age, mulchOf(arg.block));
		ctx.rec.age = age;
		writeJson(recordKey(arg.block), ctx.rec);
	}

	onRandomTick(arg: BlockComponentRandomTickEvent) {
		const block = arg.block;
		if (numberState(block, AGE_STATE) >= FRUIT_AGE || block.permutation.getState(ROOTED_STATE as never) === true) return;
		const ctx = loadBush(block);
		if (!ctx) return;
		if (processTick(ctx, clock.now())) growHelper(ctx, environmentOf(block, ctx.berry));
		saveBush(block, ctx);
	}

	onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
		const player = arg.player;
		const block = arg.block;
		if (!player) return;
		const item = heldItem(player);
		const ctx = loadBush(block);
		if (!ctx) return;
		// Pá tira o mulch.
		if (item && hasItemTag(item, "minecraft:is_shovel") && ctx.mulch !== "none") {
			setMulch(ctx, "none");
			saveBush(block, ctx);
			playSound(block, BERRY_SOUNDS.mulchRemove, 0.6);
			return;
		}
		// Mulch também pela interação (caso o onUseOn do item não dispare num bloco interativo).
		const itemData = item ? ITEMS[item.typeId.replace(/^cobblemon:/, "")] : undefined;
		if (item?.typeId.startsWith("cobblemon:") && itemData?.category === "mulch") {
			applyBerryMulch(block, String(itemData.variant) as MulchVariant, player);
			return;
		}
		// Farinha de osso: gasta sempre, cresce com chance boneMealChance (maduro cai na colheita, como no Java).
		if (item?.typeId === "minecraft:bone_meal" && ctx.age < FRUIT_AGE) {
			consumeHeld(player);
			boneMealEffect(block);
			if (growHelper(ctx, environmentOf(block, ctx.berry), true)) saveBush(block, ctx);
			return;
		}
		if (ctx.age === FRUIT_AGE) {
			const counts = harvest(ctx);
			saveBush(block, ctx);
			dropHarvest(block, counts);
			playSound(block, BERRY_SOUNDS.harvest);
		}
	}

	onPlayerBreak(arg: BlockComponentPlayerBreakEvent) {
		const key = recordKey(arg.block);
		const permutation = arg.brokenBlockPermutation;
		if (!isCreative(arg.player) && permutation.getState(AGE_STATE as never) === FRUIT_AGE) {
			const berry = getBerry(permutation.type.id);
			const rec = readJson<BerryRecord>(key);
			if (berry) {
				const ctx: BushContext = rec && rec.berry === berry.id
					? { berry, age: FRUIT_AGE, mulch: "none", rooted: false, rec }
					: createRecord(berry, FRUIT_AGE, "none");
				dropHarvest(arg.block, harvestCounts(ctx));
			}
		}
		writeJson(key, undefined);
	}
}
