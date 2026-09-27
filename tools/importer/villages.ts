// Frente vilas: as peças que o Cobblemon 1.8.2 injeta nas vilas vanilla viram ESTRUTURAS PRÓPRIAS do mod.
//
// No Java, `data/minecraft/worldgen/template_pool/village/<bioma>/houses.json` (sobrescrito pelo Cobblemon) traz o
// Pokécenter (2 × peso 150) e 6 mini-habitats (`cobblemon:habitats/village_<bioma>1..6`, peso 1 cada) junto das casas
// vanilla, e CobblemonStructures.registerJigsaws ainda injeta por código mais um Pokécenter (peso 35) e 2 fazendas de
// berries (peso 1 cada). O mixin StructurePoolGeneratorMixin limita o grupo "pokecenter" a 1 e "berry_farm" a 2 por vila.
// No Bedrock as vilas são jigsaw legado (sem injeção), então cada peça vira uma estrutura jigsaw data-driven sozinha:
// - `cobblemon:village_pokecenters/<bioma>`: o Pokécenter do bioma;
// - `cobblemon:village_habitats/<bioma>`: um dos 6 mini-habitats do bioma (pool com os 6, peso 1 cada, como no Java);
// - `cobblemon:village_berry_farms/<bioma>_<small|large>`: cada fazenda de berries do Kotlin (addBerryFarms), com o
//   processador crop_to_berry (`cobblemon:random_pooled_states`) traduzido em 15 variantes (uma por par de berries);
// cada uma nos biomas da variante de vila (`#minecraft:has_structure/village_<bioma>`) e com um structure_set cujo
// espaçamento reproduz a densidade do Java: densidade(peça) = densidade(vila do tipo) × peças por vila.
//
// Conta (documentada em docs/pendencias/vilas.md):
// - vilas no Java: structure_set `minecraft:villages` random_spread spacing 34 / separation 8 → 1 tentativa por região de
//   34 × 34 chunks; a vila do tipo T nasce se o bioma do ponto sorteado é de T (fração f_T do mundo) →
//   densidade f_T / 34² por chunk. O structure_set do Bedrock faz o mesmo com o filtro de bioma da estrutura, então
//   basta escolher o espaçamento S com f_T / S² = f_T × q / 34², isto é S = 34 / √q, onde q = peças por vila;
// - q vem dos sorteios do pool de casas: N peças por vila (HOUSE_PIECES_PER_VILLAGE, estimativa), cada sorteio pega um
//   elemento não vazio com probabilidade peso / soma, e os grupos limitados saem da lista quando chegam ao máximo
//   (villagePieceOdds faz a conta exata por programação dinâmica).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJavaNbt } from "./nbt.ts";
import { DATA, UPSTREAM, readJson, splitId } from "./util.ts";

export const VILLAGE_BIOMES = ["desert", "plains", "savanna", "snowy", "taiga"] as const;
export type VillageBiome = (typeof VILLAGE_BIOMES)[number];

/** structure_set `minecraft:villages` do Java 1.21.1 (random_spread linear). */
export const JAVA_VILLAGE_SPACING = 34;
export const JAVA_VILLAGE_SEPARATION = 8;

/**
 * Peças do pool de casas por vila (estimativa). Uma vila vanilla (jigsaw size 6, max_distance 80) tem tipicamente de
 * 6 a 14 peças de casa (casas, fazendas, currais, pontos de encontro); 10 é o meio da faixa. A sensibilidade a N está
 * em docs/pendencias/vilas.md.
 */
export const HOUSE_PIECES_PER_VILLAGE = 10;

const KOTLIN_STRUCTURES = join(UPSTREAM, "..", "kotlin", "com", "cobblemon", "mod", "common", "world", "CobblemonStructures.kt");
const KOTLIN_STRUCTURE_IDS = join(UPSTREAM, "..", "kotlin", "com", "cobblemon", "mod", "common", "world", "CobblemonStructureIDs.kt");

interface PoolElement { element_type: string; location?: string; processors?: unknown; projection?: string }
interface PoolEntry { weight: number; element: PoolElement }

/** Pesos do pool de casas do bioma, já com o que o Kotlin injeta. */
export interface HousePoolWeights {
	/** Casas vanilla (legacy_single_pool_element). */
	vanilla: number;
	/** Elemento vazio (encerra o conector: não vira peça). */
	empty: number;
	/** Entradas do grupo "pokecenter" (JSON + Kotlin), limitado a 1 por vila. */
	pokecenter: number;
	/** Entradas do grupo "berry_farm" (Kotlin), limitado a 2 por vila. */
	berry: number;
	/** Soma dos pesos dos mini-habitats (um por molde). */
	habitats: number;
	/** Elementos dos mini-habitats (location + processors do JSON). */
	habitatElements: PoolElement[];
	/** Elemento do Pokécenter do JSON. */
	pokecenterElement: PoolElement;
}

/** Constantes de CobblemonStructures.kt (peso do Pokécenter e das fazendas de berries). */
export function kotlinVillageWeights(): { pokecenterWeight: number; berryFarmWeight: number } {
	const src = existsSync(KOTLIN_STRUCTURES) ? readFileSync(KOTLIN_STRUCTURES, "utf8") : "";
	const num = (name: string, fallback: number) => Number(new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(src)?.[1] ?? fallback);
	return { pokecenterWeight: num("pokecenterWeight", 35), berryFarmWeight: num("berryFarmWeight", 1) };
}

/** Quantas fazendas de berries o Kotlin injeta no pool de casas do bioma (addBerryFarms). */
function kotlinBerryFarms(biome: VillageBiome): number {
	return berryFarmLocations(biome).length;
}

/**
 * Moldes das fazendas de berries que addBerryFarms injeta no pool de casas do bioma (`CobblemonStructureIDs.
 * <BIOMA>_BERRY_<TAMANHO>` citados em CobblemonStructures.kt, com o caminho de CobblemonStructureIDs.kt).
 */
export function berryFarmLocations(biome: VillageBiome): Array<{ size: string; location: string }> {
	const src = existsSync(KOTLIN_STRUCTURES) ? readFileSync(KOTLIN_STRUCTURES, "utf8") : "";
	const ids = existsSync(KOTLIN_STRUCTURE_IDS) ? readFileSync(KOTLIN_STRUCTURE_IDS, "utf8") : "";
	const names = [...new Set(src.match(new RegExp(`CobblemonStructureIDs\\.${biome.toUpperCase()}_BERRY_\\w+`, "g")) ?? [])].map((m) => m.split(".")[1]);
	const out = names.map((name) => {
		const size = name.slice(name.lastIndexOf("_BERRY_") + 7).toLowerCase();
		const path = new RegExp(`${name}\\s*=\\s*cobblemonResource\\("([^"]+)"\\)`).exec(ids)?.[1] ?? `village_${biome}/${biome}_berry_${size}`;
		return { size, location: `cobblemon:${path}` };
	});
	// Sem o Kotlin: os 2 moldes do Cobblemon 1.8.2.
	return out.length ? out : ["small", "large"].map((size) => ({ size, location: `cobblemon:village_${biome}/${biome}_berry_${size}` }));
}

export function housePoolWeights(biome: VillageBiome): HousePoolWeights {
	const pool = readJson(`${DATA}/minecraft/worldgen/template_pool/village/${biome}/houses.json`) as { elements: PoolEntry[] };
	const { pokecenterWeight, berryFarmWeight } = kotlinVillageWeights();
	const out: HousePoolWeights = { vanilla: 0, empty: 0, pokecenter: 0, berry: 0, habitats: 0, habitatElements: [], pokecenterElement: { element_type: "minecraft:single_pool_element" } };
	for (const { weight, element } of pool.elements) {
		const w = Number(weight ?? 1);
		const location = String(element.location ?? "");
		if (element.element_type === "minecraft:empty_pool_element") out.empty += w;
		else if (/^cobblemon:habitats\/village_/.test(location)) {
			out.habitats += w;
			out.habitatElements.push(element);
		}
		else if (/_pokecenter$/.test(location)) {
			out.pokecenter += w;
			out.pokecenterElement = element;
		}
		else out.vanilla += w;
	}
	// addBuildingToPool repete a peça `weight` vezes e ainda a adiciona mais uma: weight + 1 entradas na lista sorteada.
	out.pokecenter += pokecenterWeight + 1;
	out.berry = kotlinBerryFarms(biome) * (berryFarmWeight + 1);
	return out;
}

export interface VillagePieceOdds {
	/** P(a vila tem Pokécenter). */
	pokecenter: number;
	/** P(0), P(1), P(2 ou mais) mini-habitats na vila. */
	habitats: [number, number, number];
	/** Número esperado de mini-habitats por vila. */
	expectedHabitats: number;
	/** P(0), P(1), P(2) fazendas de berries na vila (no máximo 2). */
	berryFarms: [number, number, number];
	/** Número esperado de fazendas de berries por vila. */
	expectedBerryFarms: number;
	/** Chance de um sorteio ser mini-habitat antes e depois do Pokécenter sair da lista. */
	perDraw: [number, number];
}

/**
 * Distribuição exata das peças do Cobblemon numa vila com `n` peças de casa: cada sorteio escolhe um elemento não
 * vazio pelo peso; o grupo "pokecenter" sai da lista depois de 1 peça e "berry_farm" depois de 2 (mixin do Java).
 */
export function villagePieceOdds(w: Pick<HousePoolWeights, "vanilla" | "pokecenter" | "berry" | "habitats">, n = HOUSE_PIECES_PER_VILLAGE): VillagePieceOdds {
	// estado: pokécenter colocado (0/1), fazendas (0..2), mini-habitats (0..n) → probabilidade
	let states = new Map<string, number>([["0,0,0", 1]]);
	for (let i = 0; i < n; i++) {
		const next = new Map<string, number>();
		const add = (k: string, p: number) => next.set(k, (next.get(k) ?? 0) + p);
		for (const [key, p] of states) {
			const [pc, bf, h] = key.split(",").map(Number);
			const pcW = pc ? 0 : w.pokecenter, bfW = bf < 2 ? w.berry : 0;
			const total = w.vanilla + w.habitats + pcW + bfW;
			add(`${pc},${bf},${h}`, (p * w.vanilla) / total);
			add(`${pc},${bf},${h + 1}`, (p * w.habitats) / total);
			if (pcW) add(`1,${bf},${h}`, (p * pcW) / total);
			if (bfW) add(`${pc},${bf + 1},${h}`, (p * bfW) / total);
		}
		states = next;
	}
	let pokecenter = 0, expected = 0, expectedBerry = 0;
	const habitats: [number, number, number] = [0, 0, 0];
	const berryFarms: [number, number, number] = [0, 0, 0];
	for (const [key, p] of states) {
		const [pc, bf, h] = key.split(",").map(Number);
		if (pc) pokecenter += p;
		habitats[Math.min(h, 2)] += p;
		berryFarms[bf] += p;
		expected += h * p;
		expectedBerry += bf * p;
	}
	const base = w.vanilla + w.habitats + w.berry;
	return { pokecenter, habitats, expectedHabitats: expected, berryFarms, expectedBerryFarms: expectedBerry, perDraw: [w.habitats / (base + w.pokecenter), w.habitats / base] };
}

/**
 * random_spread do Bedrock com a densidade `share` × a das vilas do Java: S = 34 / √share; a separação mantém a
 * proporção 8/34 do Java e respeita a regra do Bedrock (separation < spacing / 2).
 */
export function spreadFor(share: number): { spacing: number; separation: number } {
	const spacing = Math.max(JAVA_VILLAGE_SPACING, Math.round(JAVA_VILLAGE_SPACING / Math.sqrt(Math.max(share, 1e-6))));
	const separation = Math.min(Math.round((spacing * JAVA_VILLAGE_SEPARATION) / JAVA_VILLAGE_SPACING), Math.ceil(spacing / 2) - 1);
	return { spacing, separation };
}

/** Sal estável (32 bits, positivo) por id: conjuntos independentes entre si e do das vilas (10387312). */
export function saltOf(id: string): number {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	return (h >>> 0) % 2147483647;
}

export interface VillageStructure {
	/** Id no estilo Java (vira `cobblemon:<caminho com _>` no Bedrock). */
	id: string;
	/** worldgen/structure no formato do Java (entra em buildJigsawStructures como as do Cobblemon). */
	def: Record<string, unknown>;
	poolId: string;
	pool: { elements: PoolEntry[]; fallback: string };
	setId: string;
	/** structure_set no formato do Java. */
	set: { placement: Record<string, unknown>; structures: Array<{ structure: string; weight: number }> };
	/** Peças por vila no Java (q) usadas no espaçamento. */
	share: number;
	/** Listas de processadores sintéticas (id → processadores) usadas pelas peças do pool. */
	processorLists?: Record<string, unknown[]>;
	/**
	 * Entrou depois das 10 primeiras: vai para o fim de STRUCTURE_IDS (os índices dos marcadores já gravados em mundos
	 * existentes continuam valendo).
	 */
	late?: boolean;
}

/** Blocos da tag vanilla `minecraft:crops` (1.21.1), alvo da regra `tag_match` do crop_to_berry. */
export const VANILLA_CROPS = ["minecraft:wheat", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroots", "minecraft:melon_stem", "minecraft:pumpkin_stem", "minecraft:torchflower_crop", "minecraft:pitcher_crop"];

export interface BerryPairVariant {
	/** Id da lista de processadores sintética (vira sufixo do nome da peça). */
	id: string;
	pair: [string, string];
	processors: unknown[];
}

/**
 * crop_to_berry (`cobblemon:random_pooled_states`, RandomizedStructureMappedBlockStatePairProcessor + BERRY_TRANSFORM)
 * em listas "rule" que o conversor de moldes já aplica. No Java, cada peça sorteia 1 par de `targetBlockPairs`; cada
 * cultivo (`#minecraft:crops`) vira uma das 2 berries do par, com idade uniforme em minAge..maxAge e `generated` =
 * isWild. Como o .mcstructure é fixo, cada par vira uma variante da peça (o pool sorteia a variante com o mesmo peso);
 * dentro da variante, as regras encadeadas `random_block_match` com probabilidade 1/(k − j) dão chance 1/k a cada uma
 * das k combinações (berry × idade), sorteadas com semente fixa na conversão.
 */
export function cropToBerryVariants(): BerryPairVariant[] {
	const file = `${DATA}/cobblemon/worldgen/processor_list/crop_to_berry.json`;
	const list = existsSync(file) ? ((readJson(file).processors ?? []) as any[]) : [];
	const proc = list.find((p) => String(p?.processor_type ?? "").endsWith("random_pooled_states"));
	if (!proc) return [];
	const t = proc.transformer ?? {};
	const minAge = Number(t.minAge ?? 0), maxAge = Number(t.maxAge ?? minAge);
	const wild = t.isWild === true;
	const crops = [...new Set((proc.rules ?? []).flatMap((r: any) => {
		const type = String(r?.predicate_type ?? "").replace(/^minecraft:/, "");
		if (type === "tag_match" && String(r.tag).replace(/^minecraft:/, "") === "crops") return VANILLA_CROPS;
		if (type === "block_match") return [String(r.block)];
		return [];
	}))] as string[];
	return (proc.targetBlockPairs ?? []).map((pair: { first: string; second: string }, i: number) => {
		const berries = [...new Set([String(pair.first), String(pair.second)])];
		const options = berries.flatMap((berry) => Array.from({ length: maxAge - minAge + 1 }, (_, a) => ({ berry, age: minAge + a })));
		const rules = crops.flatMap((crop) => options.map((o, j) => ({
			input_predicate: j < options.length - 1
				? { predicate_type: "minecraft:random_block_match", block: crop, probability: 1 / (options.length - j) }
				: { predicate_type: "minecraft:block_match", block: crop },
			location_predicate: { predicate_type: "minecraft:always_true" },
			output_state: { Name: o.berry, Properties: { age: String(o.age), generated: String(wild) } },
		})));
		return { id: `cobblemon:crop_to_berry_pair${i + 1}`, pair: [String(pair.first), String(pair.second)] as [string, string], processors: [{ processor_type: "minecraft:rule", rules }] };
	});
}

/**
 * start_height (em relação ao chão do heightmap) que põe a peça como na vila: o jigsaw `building_entrance` fica na
 * altura do jigsaw da rua (1 acima do caminho, que está no nível do chão), então a camada 0 fica em chão + 1 − y.
 * Com a projeção WORLD_SURFACE (1º bloco de ar), isso é −y. Pokécenters e mini-habitats têm y = 1 (−1).
 */
export function entranceStartHeight(location: string): number {
	const { ns, path } = splitId(location, "minecraft");
	const file = `${DATA}/${ns}/structure/${path}.nbt`;
	if (!existsSync(file)) return -1;
	const t = readJavaNbt(readFileSync(file)) as unknown as { palette: Array<{ Name: string }>; blocks: Array<{ pos: [number, number, number]; state: number; nbt?: Record<string, unknown> }> };
	const entrance = t.blocks.find((b) => t.palette[b.state]?.Name === "minecraft:jigsaw" && String(b.nbt?.name ?? "").endsWith("building_entrance"));
	return entrance ? 0 - entrance.pos[1] : -1; // 0 − y: sem −0
}

function villageStructure(opts: { id: string; biome: VillageBiome; setId: string; share: number; startHeight: number; elements: PoolEntry[]; processorLists?: Record<string, unknown[]>; late?: boolean }): VillageStructure {
	const { id, biome, setId, share } = opts;
	const poolId = `${id}_start`;
	const { spacing, separation } = spreadFor(share);
	return {
		id,
		def: {
			type: "minecraft:jigsaw",
			biomes: `#minecraft:has_structure/village_${biome}`,
			start_pool: poolId,
			size: 1,
			step: "surface_structures",
			// y = altura do chão: a camada 0 dos moldes é a fundação/caminho no nível da rua (como nas vilas).
			start_height: { absolute: opts.startHeight },
			project_start_to_heightmap: "WORLD_SURFACE_WG",
			max_distance_from_center: 80,
			// Mesma adaptação de terreno das vilas vanilla.
			terrain_adaptation: "beard_thin",
		},
		poolId,
		pool: { fallback: "minecraft:empty", elements: opts.elements },
		setId,
		set: {
			placement: { type: "minecraft:random_spread", spacing, separation, salt: saltOf(id), spread_type: "linear" },
			structures: [{ structure: id, weight: 1 }],
		},
		share,
		...(opts.processorLists ? { processorLists: opts.processorLists } : {}),
		...(opts.late ? { late: true } : {}),
	};
}

const rigid = (location: string | undefined, processors: unknown): PoolEntry => ({ weight: 1, element: { element_type: "minecraft:single_pool_element", location, processors: processors ?? "minecraft:empty", projection: "rigid" } });

/**
 * As estruturas novas: Pokécenter e mini-habitats de cada um dos 5 biomas de vila (as 10 primeiras) e as fazendas de
 * berries (uma estrutura por molde: pequena e grande, com alturas de entrada diferentes).
 */
export function villageStructures(n = HOUSE_PIECES_PER_VILLAGE): VillageStructure[] {
	const out: VillageStructure[] = [];
	const berryVariants = cropToBerryVariants();
	const berryLists = Object.fromEntries(berryVariants.map((v) => [v.id, v.processors]));
	const farms: VillageStructure[] = [];
	for (const biome of VILLAGE_BIOMES) {
		const w = housePoolWeights(biome);
		const odds = villagePieceOdds(w, n);
		const kinds: Array<{ kind: "pokecenters" | "habitats"; share: number; elements: PoolElement[] }> = [
			{ kind: "pokecenters", share: odds.pokecenter, elements: [w.pokecenterElement] },
			{ kind: "habitats", share: odds.expectedHabitats, elements: w.habitatElements },
		];
		for (const { kind, share, elements } of kinds) {
			if (!elements.length || !elements[0].location) continue;
			const id = `cobblemon:village_${kind}/${biome}`;
			out.push(villageStructure({ id, biome, setId: `cobblemon:village_pieces/${biome}_${kind}`, share, startHeight: -1, elements: elements.map((e) => rigid(e.location, e.processors)) }));
		}
		// Fazendas: cada molde tem o mesmo peso no pool (berryFarmWeight + 1), então cada um fica com metade de E[fazendas].
		const locations = berryFarmLocations(biome);
		for (const { size, location } of locations) {
			const id = `cobblemon:village_berry_farms/${biome}_${size}`;
			const elements = berryVariants.length ? berryVariants.map((v) => rigid(location, v.id)) : [rigid(location, undefined)];
			farms.push(villageStructure({
				id, biome, setId: `cobblemon:village_pieces/${biome}_berry_farms_${size}`, share: odds.expectedBerryFarms / locations.length,
				startHeight: entranceStartHeight(location), elements, processorLists: berryLists, late: true,
			}));
		}
	}
	return [...out, ...farms];
}
