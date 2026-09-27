// Gera os sons de bloco do Cobblemon para o RP (frente mundo-sons):
//   resource_packs/CobblemonBedrock/sounds.json  → block_sounds / interactive_sounds "cobblemon.<set>"
//   resource_packs/CobblemonBedrock/blocks.json  → "sound": "cobblemon.<set>" por bloco (mesclado por cima do
//                                                  blocks.json gerado pelo importador em tools/build.mjs)
// Os SoundType do Kotlin (CobblemonSounds.kt: TUMBLESTONE_SOUNDS, GILDED_CHEST_SOUNDS...) viram conjuntos
// quebrar/colocar/bater/pisar. Rodar depois de `npm run import`:
//   node --experimental-strip-types --no-warnings scripts/custom_components/gen-block-sounds.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKotlinBlocks } from "../../tools/importer/kotlin.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RP = join(root, "resource_packs", "CobblemonBedrock");
const GENERATED_BLOCKS = join(root, "generated", "resource_packs", "CobblemonBedrock", "blocks.json");

/**
 * SoundType do Cobblemon → eventos (break, step, place, hit, fall). Eventos "cobblemon.*" vêm do sounds.json do
 * Cobblemon (importados em sound_definitions); os vanilla (SoundEvents.GRASS_STEP...) usam os nomes do Bedrock.
 */
const SETS = {
	TUMBLESTONE_SOUNDS: ["block.tumblestone.break", "block.tumblestone.step", "block.tumblestone.place", "block.tumblestone.hit", "block.tumblestone.step"],
	TUMBLESTONE_BLOCK_SOUNDS: ["block.tumblestone.block_break", "block.tumblestone.step", "block.tumblestone.place", "block.tumblestone.hit", "block.tumblestone.step"],
	TYPE_GEM_CLUSTER_SOUNDS: ["block.type_gem_cluster.break", "block.type_gem_block.step", "block.type_gem_block.place", "block.type_gem_block.hit", "block.type_gem_block.step"],
	TYPE_GEM_BLOCK_SOUNDS: ["block.type_gem_block.break", "block.type_gem_block.step", "block.type_gem_block.place", "block.type_gem_block.hit", "block.type_gem_block.step"],
	EVOLUTION_STONE_BLOCK_SOUNDS: ["block.evolution_stone_block.break", "block.evolution_stone_block.step", "block.evolution_stone_block.place", "block.evolution_stone_block.hit", "block.evolution_stone_block.step"],
	TATAMI_BLOCK_SOUNDS: ["block.tatami.break", "block.tatami.step", "block.tatami.place", "block.tatami.hit", "block.tatami.step"],
	TATAMI_MAT_SOUNDS: ["block.tatami_mat.break", "block.tatami.step", "block.tatami_mat.place", "block.tatami.hit", "block.tatami.step"],
	BERRY_BUSH_SOUNDS: ["block.berry_bush.break", "@step.grass", "block.berry_bush.place", "@hit.grass", "@step.grass"],
	// ROOTS_STEP/HIT/FALL do Java: no Bedrock ficam os de grama (nomes garantidos no sound_definitions vanilla).
	BIG_ROOT_SOUNDS: ["block.big_root.break", "@step.grass", "block.energy_root.place", "@hit.grass", "@fall.grass"],
	ENERGY_ROOT_SOUNDS: ["block.big_root.break", "@step.grass", "block.energy_root.place", "@hit.grass", "@fall.grass"],
	MEDICINAL_LEEK_SOUNDS: ["block.medicinal_leek.break", "@step.grass", "block.medicinal_leek.plant", "@hit.grass", "@fall.grass"],
	VIVICHOKE_SOUNDS: ["block.vivichoke.break", "@step.grass", "block.vivichoke.place", "@hit.grass", "@fall.grass"],
	HEARTY_GRAIN_BALE_SOUNDS: ["block.hearty_grain_bale.break", "block.hearty_grain_bale.step", "block.hearty_grain_bale.place", "block.hearty_grain_bale.hit", "block.hearty_grain_bale.step"],
	HEARTY_GRAINS_SOUNDS: ["block.hearty_grains.break", "block.hearty_grain_bale.step", "block.hearty_grains.place", "block.hearty_grain_bale.hit", "block.hearty_grain_bale.step"],
	MINT_SOUNDS: ["block.mint.break", "@step.grass", "block.mint.place", "@hit.grass", "@fall.grass"],
	REVIVAL_HERB_SOUNDS: ["block.revival_herb.break", "@step.grass", "block.revival_herb.place", "@hit.grass", "@fall.grass"],
	GILDED_CHEST_SOUNDS: ["block.gilded_chest.break", "block.gilded_chest.step", "block.gilded_chest.place", "block.gilded_chest.hit", "block.gilded_chest.step"],
	DISPLAY_CASE_SOUNDS: ["block.display_case.break", "block.display_case.step", "block.display_case.place", "block.display_case.hit", "block.display_case.step"],
	CAMPFIRE_POT_SOUNDS: ["block.campfire_pot.break", "block.campfire_pot.step", "block.campfire_pot.place", "block.campfire_pot.hit", "block.campfire_pot.step"],
	RELIC_COIN_SACK_SOUNDS: ["block.relic_coin_sack.break", "block.relic_coin_sack.step", "block.relic_coin_sack.place", "block.relic_coin_sack.hit", "block.relic_coin_sack.step"],
	RELIC_COIN_POUCH_SOUNDS: ["block.relic_coin_pouch.break", "block.relic_coin_sack.step", "block.relic_coin_pouch.place", "block.relic_coin_sack.hit", "block.relic_coin_sack.step"],
	ITEM_BLOCK_PAPER_SMALL_SOUNDS: ["block.item_block.paper_small.break", "@step.cloth", "block.item_block.paper_small.place", "@hit.cloth", "@fall.cloth"],
	ITEM_BLOCK_PAPER_LARGE_SOUNDS: ["block.item_block.paper_large.break", "@step.cloth", "block.item_block.paper_large.place", "@hit.cloth", "@fall.cloth"],
};

/** Helpers do CobblemonBlocks.kt que fixam o SoundType (o parser do importador lê só `.sound(...)` explícito). */
const HELPER_SETS = {
	typeGemBlock: "TYPE_GEM_BLOCK_SOUNDS",
	typeGemCluster: "TYPE_GEM_CLUSTER_SOUNDS",
	tumblestoneBlock: "TUMBLESTONE_SOUNDS",
	berryBlock: "BERRY_BUSH_SOUNDS",
};

const setName = (kt) => `cobblemon.${kt.replace(/_SOUNDS$/, "").toLowerCase()}`;
const sound = (ev) => (ev.startsWith("@") ? ev.slice(1) : `cobblemon.${ev}`);

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
}

/** Bloco do Java → nome do SoundType custom (ou undefined se for um tipo vanilla). */
export function blockSoundSets() {
	const { blocks } = loadKotlinBlocks();
	const byName = new Map(blocks.map((b) => [b.name, b]));
	const out = new Map();
	for (const b of blocks) {
		let set = /sound\(CobblemonSounds\.([A-Z_]+)\)/.exec(b.body)?.[1] ?? HELPER_SETS[b.helper];
		// ofFullCopy(OUTRO_BLOCO_DO_COBBLEMON) / escadas copiam o SoundType do bloco base.
		if (!set) {
			const base = /ofFullCopy\(([A-Z_]+)\)/.exec(b.body)?.[1];
			const src = base && byName.get(base);
			if (src) set = /sound\(CobblemonSounds\.([A-Z_]+)\)/.exec(src.body)?.[1] ?? HELPER_SETS[src.helper];
		}
		// HeartyGrainsBlock.getSoundType: HEARTY_GRAINS_SOUNDS (ou a versão "water" quando alagado; o blocks.json
		// não varia por estado, fica a seca).
		if (!set && b.cls === "HeartyGrainsBlock") set = "HEARTY_GRAINS_SOUNDS";
		if (set && SETS[set]) out.set(b.id, set);
	}
	return out;
}

function main() {
	const generated = readJson(GENERATED_BLOCKS);
	const ids = new Set(Object.keys(generated).filter((k) => k.startsWith("cobblemon:")));
	const sets = blockSoundSets();
	// Sem format_version: o build mescla este arquivo por cima do blocks.json gerado (listas são concatenadas).
	const blocks = {};
	const used = new Set();
	const missing = [];
	for (const [javaId, set] of [...sets].sort()) {
		const bid = `cobblemon:${javaId}`;
		if (!ids.has(bid)) { missing.push(bid); continue; }
		blocks[bid] = { sound: setName(set) };
		used.add(set);
	}
	// Berries: o helper berryBlock recebe o id por parâmetro (o parser não o vê); todos usam BERRY_BUSH_SOUNDS.
	for (const bid of ids) if (/_berry$/.test(bid) && !blocks[bid]) { blocks[bid] = { sound: setName("BERRY_BUSH_SOUNDS") }; used.add("BERRY_BUSH_SOUNDS"); }

	const blockSounds = {};
	const interactive = {};
	for (const set of [...used].sort()) {
		const [brk, step, place, hit, fall] = SETS[set];
		blockSounds[setName(set)] = {
			volume: 1, pitch: 1,
			events: {
				default: "",
				break: { sound: sound(brk), pitch: 0.9 },
				place: { sound: sound(place), pitch: 0.9 },
				"item.use.on": { sound: sound(place), pitch: 0.9 },
				hit: { sound: sound(hit), volume: 0.35, pitch: 0.55 },
			},
		};
		interactive[setName(set)] = {
			volume: 0.3, pitch: 1,
			events: {
				default: "",
				step: { sound: sound(step), volume: 0.5 },
				jump: { sound: sound(step), volume: 0.4 },
				land: { sound: sound(fall), volume: 0.5 },
				fall: { sound: sound(fall), volume: 0.5 },
			},
		};
	}
	writeFileSync(join(RP, "blocks.json"), JSON.stringify(blocks, null, "\t") + "\n");
	writeFileSync(join(RP, "sounds.json"), JSON.stringify({ block_sounds: blockSounds, interactive_sounds: { block_sounds: interactive } }, null, "\t") + "\n");
	console.log(`${Object.keys(blocks).length} blocos, ${used.size} conjuntos`);
	if (missing.length) console.log(`sem bloco no blocks.json gerado: ${missing.join(" ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
