// Leitura dos registros CobblemonItems.kt e CobblemonBlocks.kt: id, classe, helper e propriedades
// relevantes (dureza, luz, som, colisão, pilha, raridade, comida). É um parser por regex das declarações
// `val X = ...`; o corpo bruto fica disponível para os classificadores de items.ts/blocks.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./util.ts";

export const KOTLIN = join(ROOT, "upstream", "cobblemon", "common", "src", "main", "kotlin", "com", "cobblemon", "mod", "common");

export interface KtBlock {
	id: string;
	/** Nome da constante (ex.: RED_APRICORN). */
	name: string;
	/** Classe do bloco (ex.: BerryBlock, SlabBlock, DropExperienceBlock). */
	cls: string;
	/** Helper usado no registro (ex.: evolutionStoneOre, log, leaves, berryBlock), se houver. */
	helper?: string;
	body: string;
	light?: number;
	hardness?: number;
	resistance?: number;
	sound?: string;
	noCollision: boolean;
	noOcclusion: boolean;
	randomTicks: boolean;
	instabreak: boolean;
	/** Blocks.X de ofFullCopy(Blocks.X) (propriedades copiadas de um bloco vanilla). */
	copyOf?: string;
}

export interface KtFood {
	nutrition: number;
	saturation: number;
	alwaysEdible?: boolean;
	fast?: boolean;
	convertsTo?: string;
}

export interface KtItem {
	id: string;
	name: string;
	cls: string;
	helper?: string;
	body: string;
	stack?: number;
	rarity?: string;
	durability?: number;
	food?: KtFood;
	/** Id do bloco colocado (BlockItem/ItemNameBlockItem e afins). */
	block?: string;
	/** Nome remapeado do held item para o Showdown (ex.: charcoal_stick → charcoal). */
	remap?: string;
}

const STAT_PATH: Record<string, string> = {
	HP: "hp",
	ATTACK: "attack",
	DEFENCE: "defence",
	SPECIAL_ATTACK: "special_attack",
	SPECIAL_DEFENCE: "special_defence",
	SPEED: "speed",
	ACCURACY: "accuracy",
	EVASION: "evasion",
};

export function statPath(constant: string): string {
	return STAT_PATH[constant] ?? constant.toLowerCase();
}

/** Divide o arquivo em declarações `val NOME = corpo`. */
function statements(src: string): Array<{ name: string; body: string }> {
	const out: Array<{ name: string; body: string }> = [];
	// Remove comentários de linha para não pegar registros comentados.
	const clean = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
	const parts = clean.split(/\n\s*(?:@JvmField\s+)?(?:private\s+)?val\s+/);
	for (const p of parts.slice(1)) {
		const m = /^([A-Za-z0-9_]+)\s*(?::[^=\n]+)?=\s*([\s\S]*)$/.exec(p);
		// Só constantes do registro (MAIÚSCULAS); vals locais das funções auxiliares ficam de fora.
		if (!m || !/^[A-Z][A-Z0-9_]*$/.test(m[1])) continue;
		// Corta no início da próxima função/objeto (o último statement pode arrastar o resto do arquivo).
		const body = m[2].split(/\n\s*(?:private\s+)?fun\s+|\n\s*init\s*\{/)[0];
		out.push({ name: m[1], body });
	}
	return out;
}

function derivedId(body: string): { id?: string; helper?: string } {
	const b = body.trim();
	let m: RegExpExecArray | null;
	if ((m = /^pokeBallItem\(PokeBalls\.([A-Z_]+)\)/.exec(b))) return { id: m[1].toLowerCase(), helper: "pokeBallItem" };
	if ((m = /^pokedexItem\(PokedexType\.([A-Z_]+)\)/.exec(b))) return { id: `pokedex_${m[1].toLowerCase()}`, helper: "pokedexItem" };
	if ((m = /^campfirePotItem\([^,]+,\s*CampfirePotColor\.([A-Z_]+)\)/.exec(b))) return { id: `campfire_pot_${m[1].toLowerCase()}`, helper: "campfirePotItem" };
	if ((m = /^aprijuiceItem\(Apricorn\.([A-Z_]+)\)/.exec(b))) return { id: `aprijuice_${m[1].toLowerCase()}`, helper: "aprijuiceItem" };
	if ((m = /^apricornItem\("([a-z_]+)"/.exec(b))) return { id: `${m[1]}_apricorn`, helper: "apricornItem" };
	if ((m = /^apricornSeedItem\("([a-z_]+)"/.exec(b))) return { id: `${m[1]}_apricorn_seed`, helper: "apricornSeedItem" };
	if ((m = /^berryItem\("([a-z_]+)"/.exec(b))) return { id: `${m[1]}_berry`, helper: "berryItem" };
	if ((m = /^this\.berryBlock\("([a-z_]+)"/.exec(b))) return { id: `${m[1]}_berry`, helper: "berryBlock" };
	if ((m = /^mintSeed\("([a-z_]+)"/.exec(b))) return { id: `${m[1]}_mint_seeds`, helper: "mintSeed" };
	if ((m = /^mintLeaf\("([a-z_]+)"/.exec(b))) return { id: `${m[1]}_mint_leaf`, helper: "mintLeaf" };
	if ((m = /^pokerodItem\(cobblemonResource\("([a-z_]+)"\)/.exec(b))) return { id: m[1], helper: "pokerodItem" };
	if ((m = /^create\("x_\$\{Stats\.([A-Z_]+)\.identifier\.path\}"/.exec(b))) return { id: `x_${statPath(m[1])}`, helper: "create" };
	if ((m = /^(?:this\.)?([a-zA-Z]+)\(\s*(?:name\s*=\s*)?"([a-z0-9_]+)"/.exec(b))) return { id: m[2], helper: m[1] };
	return {};
}

function num(s: string | undefined): number | undefined {
	if (s === undefined) return undefined;
	const n = Number.parseFloat(s.replace(/[fF]$/, ""));
	return Number.isFinite(n) ? n : undefined;
}

let blockCache: { blocks: KtBlock[]; byName: Map<string, string> } | undefined;

export function loadKotlinBlocks(): { blocks: KtBlock[]; byName: Map<string, string> } {
	if (blockCache) return blockCache;
	const file = join(KOTLIN, "CobblemonBlocks.kt");
	const blocks: KtBlock[] = [];
	const byName = new Map<string, string>();
	if (!existsSync(file)) return (blockCache = { blocks, byName });
	for (const { name, body } of statements(readFileSync(file, "utf8"))) {
		const { id, helper } = derivedId(body);
		if (!id || !helper || /^(BlockSetType|WoodType|BlockBehaviour|mutableMapOf|arrayListOf)$/.test(helper)) continue;
		if (helper === "WoodType" || name.endsWith("_TYPE") || name === "PLANT_PROPERTIES") continue;
		// Argumentos nomeados (`create(name = "habitat_block", entry = HabitatBlock(...))`) também valem.
		let cls = /"[a-z0-9_]+"\s*,\s*(?:entry\s*=\s*)?([A-Z][A-Za-z]+(?:\.[`$a-zA-Z]+)?)/.exec(body)?.[1] ?? helper;
		if (helper === "evolutionStoneOre" || helper === "deepslateEvolutionStoneOre") cls = "DropExperienceBlock";
		else if (helper === "log") cls = "RotatedPillarBlock";
		else if (helper === "leaves") cls = "LeavesBlock";
		else if (helper === "berryBlock") cls = "BerryBlock";
		else if (helper === "apricornBlock") cls = "ApricornBlock";
		else if (helper === "tumblestoneBlock") cls = "TumblestoneBlock";
		else if (helper === "typeGemBlock") cls = "Block";
		else if (helper === "typeGemCluster") cls = "TypeGemClusterBlock";
		const light = /lightLevel\s*\{\s*(\d+)\s*\}/.exec(body)?.[1] ?? (helper.includes("EvolutionStoneOre") || helper === "evolutionStoneOre" ? /"[a-z_]+"\s*,\s*(\d+)\)/.exec(body)?.[1] : undefined);
		const strength = /strength\(\s*([\d.]+)[fF]?\s*(?:,\s*([\d.]+)[fF]?)?\s*\)/.exec(body);
		const copyOf = /ofFullCopy\((?:Blocks\.)?([A-Z_]+)\)/.exec(body)?.[1];
		const block: KtBlock = {
			id,
			name,
			cls,
			helper,
			body,
			light: num(light),
			hardness: num(strength?.[1]),
			resistance: num(strength?.[2] ?? strength?.[1]),
			sound: /sound\((?:SoundType|CobblemonSounds)\.([A-Z_]+)\)/.exec(body)?.[1],
			noCollision: /noCollission\(\)/.test(body),
			noOcclusion: /noOcclusion\(\)/.test(body),
			randomTicks: /randomTicks\(\)/.test(body),
			instabreak: /instabreak\(\)/.test(body),
			copyOf,
		};
		// Propriedades implícitas dos helpers.
		if (helper === "evolutionStoneOre") Object.assign(block, { hardness: 3, resistance: 3, sound: "STONE" });
		if (helper === "deepslateEvolutionStoneOre") Object.assign(block, { hardness: 4.5, resistance: 3, sound: "DEEPSLATE" });
		if (helper === "log") Object.assign(block, { hardness: 2, resistance: 2, sound: "WOOD" });
		if (helper === "leaves") Object.assign(block, { hardness: 0.2, resistance: 0.2, sound: "GRASS", noOcclusion: true, randomTicks: true });
		if (helper === "berryBlock") Object.assign(block, { hardness: 0.2, resistance: 0.2, sound: "BERRY_BUSH_SOUNDS", noCollision: true, randomTicks: true });
		if (helper === "apricornBlock") Object.assign(block, { hardness: 2, resistance: 2, sound: "WOOD", randomTicks: true, noOcclusion: true });
		if (helper === "typeGemBlock") Object.assign(block, { hardness: 3, resistance: 6, sound: "AMETHYST" });
		if (helper === "typeGemCluster") Object.assign(block, { hardness: 2, resistance: 3, sound: "AMETHYST_CLUSTER", noOcclusion: true });
		if (helper === "tumblestoneBlock") Object.assign(block, { hardness: 1.5, resistance: 1.5, sound: "AMETHYST_CLUSTER", noOcclusion: true });
		if (/PLANT_PROPERTIES/.test(body)) Object.assign(block, { noCollision: true, randomTicks: true, instabreak: true, sound: "GRASS" });
		if (/createWoodenButtonBlock/.test(body)) Object.assign(block, { cls: "ButtonBlock", hardness: 0.5, resistance: 0.5, sound: "WOOD", noCollision: true });
		if (/createFlowerPotBlock/.test(body)) Object.assign(block, { cls: "FlowerPotBlock", hardness: 0, resistance: 0, instabreak: true, noOcclusion: true });
		if (/PressurePlateBlockInvoker/.test(body)) block.cls = "PressurePlateBlock";
		if (/StairsBlockInvoker/.test(body)) block.cls = "StairBlock";
		if (/DoorBlockInvoker/.test(body)) block.cls = "DoorBlock";
		if (/TrapdoorBlockInvoker/.test(body)) block.cls = "TrapDoorBlock";
		if (copyOf && block.hardness === undefined) Object.assign(block, VANILLA_PROPS[copyOf] ?? {});
		blocks.push(block);
		byName.set(name, id);
	}
	// Cópias de outro bloco Cobblemon (ofFullCopy(APRICORN_PLANKS)).
	for (const b of blocks) {
		if (b.copyOf && byName.has(b.copyOf) && b.hardness === undefined) {
			const src = blocks.find((x) => x.name === b.copyOf);
			if (src) Object.assign(b, { hardness: src.hardness, resistance: src.resistance, sound: b.sound ?? src.sound });
		}
	}
	return (blockCache = { blocks, byName });
}

/** Propriedades de blocos vanilla copiados por ofFullCopy. */
const VANILLA_PROPS: Record<string, Partial<KtBlock>> = {
	OAK_SIGN: { hardness: 1, resistance: 1, sound: "WOOD", noCollision: true },
	OAK_HANGING_SIGN: { hardness: 1, resistance: 1, sound: "HANGING_SIGN", noCollision: true },
	CHEST: { hardness: 2.5, resistance: 2.5, sound: "WOOD" },
	WHEAT: { hardness: 0, resistance: 0, sound: "CROP", noCollision: true, randomTicks: true, instabreak: true },
	IRON_ORE: { hardness: 3, resistance: 3, sound: "STONE" },
	DEEPSLATE_IRON_ORE: { hardness: 4.5, resistance: 3, sound: "DEEPSLATE" },
};

let itemCache: KtItem[] | undefined;

export function loadKotlinItems(): KtItem[] {
	if (itemCache) return itemCache;
	const file = join(KOTLIN, "CobblemonItems.kt");
	const items: KtItem[] = [];
	if (!existsSync(file)) return (itemCache = items);
	const { byName } = loadKotlinBlocks();
	const seen = new Set<string>();
	for (const { name, body } of statements(readFileSync(file, "utf8"))) {
		const { id, helper } = derivedId(body);
		if (!id || !helper || /^(mutableListOf|mutableMapOf|arrayListOf)$/.test(helper) || seen.has(id)) continue;
		seen.add(id);
		const cls = /"[a-z0-9_]+"\s*,\s*(?:entry\s*=\s*)?([A-Z][A-Za-z]+)/.exec(body)?.[1]
			?? /^\s*[a-zA-Z]+\(\s*[^,(]+(?:\([^)]*\))?\s*,\s*([A-Z][A-Za-z]+)\(/.exec(body)?.[1]
			?? helper;
		const blockName = /CobblemonBlocks\.([A-Z0-9_]+)/.exec(body)?.[1] ?? (/^\s*mintSeed\("([a-z]+)"/.exec(body) ? `${/^\s*mintSeed\("([a-z]+)"/.exec(body)![1].toUpperCase()}_MINT` : undefined);
		const foodM = /nutrition\(\s*(\d+)\s*\)[\s\S]*?saturationModifier\(\s*([\d.]+)[fF]?\s*\)/.exec(body) ?? /foodItem\(\s*(\d+)\s*,\s*([\d.]+)[fF]?\s*\)/.exec(body);
		const regional = /regionalFoodItem\(\s*"[a-z_]+"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)[fF]?\s*,\s*(true|false)/.exec(body);
		let food: KtFood | undefined;
		if (regional) food = { nutrition: Number(regional[2]), saturation: Number(regional[3]), alwaysEdible: regional[4] === "true" };
		else if (foodM) food = { nutrition: Number(foodM[1]), saturation: Number(foodM[2]) };
		if (food) {
			if (/alwaysEdible\(\)/.test(body)) food.alwaysEdible = true;
			if (/\.fast\(\)/.test(body)) food.fast = true;
			const conv = /usingConvertsTo\(Items\.([A-Z_]+)\)/.exec(body)?.[1];
			if (conv) food.convertsTo = `minecraft:${conv.toLowerCase()}`;
		}
		const item: KtItem = {
			id,
			name,
			cls,
			helper,
			body,
			stack: num(/stacksTo\(\s*\(?(\d+)\)?\s*\)/.exec(body)?.[1] ?? regional?.[1]),
			rarity: /Rarity\.([A-Z]+)/.exec(body)?.[1]?.toLowerCase(),
			durability: num(/durability\((\d+)\)/.exec(body)?.[1]),
			food,
			block: blockName ? byName.get(blockName) : undefined,
			// Nome no Showdown: `remappedName = "x"`, `heldItem("id", "x")` ou o último argumento de
			// `heldItem("id", Item(...), "x")` (medicinal_leek → leek).
			remap: /remappedName\s*=\s*"([a-z_]+)"/.exec(body)?.[1] ?? /heldItem\("[a-z_]+"\s*,\s*"([a-z_]+)"\)/.exec(body)?.[1]
				?? /^\s*heldItem\("[a-z_]+"[\s\S]*,\s*"([a-z_]+)"\s*\)\s*$/.exec(body)?.[1],
		};
		if (helper === "pokerodItem") Object.assign(item, { stack: 1, durability: 256 });
		items.push(item);
	}
	return (itemCache = items);
}
