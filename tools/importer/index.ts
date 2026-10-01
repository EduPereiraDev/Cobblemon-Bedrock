// Importador: upstream/cobblemon → generated/ (RP/BP de Pokémon + dados para os scripts).
//   npm run import                              todas as espécies implementadas com modelo+textura
//   npm run import -- --species pikachu,eevee   só essas espécies
//   npm run import -- --gens 1,2                só essas gerações
import { existsSync, renameSync, rmSync } from "node:fs";
import { AnimationIndex } from "./animations.ts";
import { emitClientEntity, emitEntityDataModule, emitServerEntity } from "./entities.ts";
import type { Channel, ComboOut, SpeciesRender } from "./entities.ts";
import { emitLang } from "./lang.ts";
import { ModelIndex } from "./models.ts";
import { PoserFactory } from "./posers.ts";
import type { PoserOutput } from "./posers.ts";
import { emitBiomeTagsModule, emitSpawnsModule, emitSpeciesModule, emitVariantsModule } from "./scriptsOut.ts";
import { emitStudioFramingModule } from "./studioFraming.ts"; // frente fix3
import { fixArmorNeckCollisions } from "./headLocator.ts"; // frente fix3
import { fixBlockZFighting, fixEntityFlatPlanes } from "./zfight.ts"; // frente fix3; cliente-teste3-log (planos de entidade)
import { entityMaterialFile } from "./zfightEntities.ts"; // frente zfight2: materiais das camadas (depthFunc LessEqual)
import { ensureEntityVariables } from "./molangVars.ts"; // frente cliente-teste3-log
import type { VariantsEntry } from "./scriptsOut.ts";
import { SoundIndex } from "./sounds.ts";
import { SpawnBuilder } from "./spawns.ts";
import { gameplaySubset, loadSpecies, movementOf } from "./species.ts";
import { ASSETS, HAND_BP, HAND_RP, OUT, OUT_FINAL, OUT_RP, UPSTREAM, copyFile, count, rel, report, splitId, warn, writeJson, writeStats } from "./util.ts";
import { enumerateCombos, layerKey, loadFeatureDefs, loadResolvers, supplementFormCombos } from "./variants.ts";
import type { Combo } from "./variants.ts";
import { BiomeResolver, BlockResolver } from "./worldgen.ts";
import { BlockBuilder, emitBlockBehaviours } from "./blocks.ts";
import { FeatureBuilder } from "./features.ts";
import { buildItems, pokeballEntities } from "./items.ts";
import { emitEmptyLoot, lootCount } from "./loot.ts";
import { buildRecipes } from "./recipes.ts";
import { emitDex } from "./dex.ts";
import { emitAncientBalls, emitPokeBallSounds } from "./pokeballs.ts";
import { bedrockVanillaItem } from "./vanilla.ts";
import { emitNpcs } from "./npcs.ts";
import { buildHabitatPools, emitHabitatsModule } from "./habitats.ts";
import { emitLootInjections } from "./lootInjection.ts";
import { emitWallpapers } from "./wallpapers.ts";
import { BlockMapper, buildStructures, HABITAT_ANCHOR_MIMICS, StructureLoot } from "./structures.ts";
import { buildJigsawStructures } from "./jigsaw.ts";
import { emitRequestedParticles, emitScriptParticles, particleIndex } from "./particles.ts";
import { flipbookOf } from "./animatedTextures.ts"; // frente animacao: texturas animadas (flipbook)
import { emitActionEffects } from "./actionEffects.ts"; // frente animacao: action_effects de batalha
import { startPortraits } from "./portraits.ts";
import { emitGuiTextures } from "./guiTextures.ts"; // frente ui-base
import { emitAdvancements } from "./advancements.ts"; // frente ui-base
import { appendCatalogLang, emitCreativeCatalog, emitDiscShelfDisplay, emitFossilFetus, emitVanillaFoodTags, emitMundoDetalhesModule, emitWearables, fortuneData, patchBlocks } from "./mundoDetalhes.ts"; // frente mundo-detalhes
import type { WearableOut } from "./mundoDetalhes.ts";
import { COMPOST_BLOCK_ITEMS } from "./items.ts";
import { emitDadosIaModule, recordAspectBits, speciesAspectBits } from "./dadosIa.ts"; // frente dados-ia
import { emitAdaptacoes } from "./adaptacoes.ts"; // frente adaptacoes: comparador da panela e vaso decorado do Cobblemon
import { emitComparadores } from "./comparadores.ts"; // frente comparadores: comparador da Healing Machine e do Metronome
import { emitLimitesB } from "./limitesB.ts"; // frente limites-b: livro de receitas agrupado, pinturas, enfermeira
// Frentes msd-*: ganchos do Mega Showdown (privado, fora do repositório público). optionalExtensions.ts reexporta os
// módulos megaShowdown.ts, msdScripts.ts, msdEffects.ts e msdAlphaEyes.ts quando existem e troca por no-op quando não.
// Gancho novo do MSD: acrescente lá, nunca um import estático de ./msd*.ts aqui.
import {
	emitMsdScriptsModule, isMsdChild, msdModulesPresent, msdOrderAspectBits, msdOrderCombos, msdRecordSpecies, msdWriteChildResult,
	preserveBaseAlphaEyes, removeMsdOutput, requestMsdEffectParticles, runMegaShowdownImport,
} from "./optionalExtensions.ts";
import { runPrivateContentPacks } from "./optionalExtensions.ts"; // extensões privadas de conteúdo (packs próprios)
import type { PrivateContentContext } from "./optionalExtensions.ts";

const started = Date.now();

function argList(name: string): string[] | undefined {
	const i = process.argv.indexOf(`--${name}`);
	const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
	const value = inline ? inline.slice(name.length + 3) : i >= 0 ? process.argv[i + 1] : undefined;
	return value ? value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined;
}

const speciesFilter = argList("species");
const gensFilter = argList("gens");
report.filters = { species: speciesFilter, gens: gensFilter };

if (!existsSync(UPSTREAM)) {
	console.error(`fonte do Cobblemon não encontrada: ${rel(UPSTREAM)}`);
	process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });

const t = (label: string, since: number) => console.log(`  ${label}: ${Date.now() - since}ms`);
let phase = Date.now();
const allSpecies = loadSpecies();
const speciesData = new Map(allSpecies.map((s) => [s.id, s.data]));
if (isMsdChild()) preserveBaseAlphaEyes(); // frente msd-fase2: camada alpha_eyes do base nos resolvers do MSD (mesma geometria)
const resolvers = loadResolvers();
const features = loadFeatureDefs();
const models = new ModelIndex();
const sounds = new SoundIndex();
const anims = new AnimationIndex(sounds.names);
// frente animacao: tamanho da espécie do grupo de animação → v.entity_* das partículas.
anims.sizeOf = (group) => {
	const d = speciesData.get(group) ?? speciesData.get(group.split("_")[0]);
	return d ? { width: d.hitbox?.width ?? 1, height: d.hitbox?.height ?? 1, scale: d.baseScale ?? 1 } : undefined;
};
const posers = new PoserFactory(anims);
t("índices carregados", phase);

/** "cobblemon:textures/pokemon/x.png" → caminho do arquivo e referência do Bedrock. */
function textureRef(id: string): { file: string; ref: string } | undefined {
	const { ns, path } = splitId(id);
	if (ns !== "cobblemon") return undefined;
	const file = `${ASSETS}/${path}`;
	if (!existsSync(file)) return undefined;
	return { file, ref: path.replace(/\.png$/i, "") };
}

const selected = allSpecies
	.filter((s) => (speciesFilter ? speciesFilter.includes(s.id) : true))
	.filter((s) => (gensFilter ? gensFilter.includes(s.gen) : true))
	.sort((a, b) => (a.data.nationalPokedexNumber ?? 0) - (b.data.nationalPokedexNumber ?? 0) || a.id.localeCompare(b.id));
if (speciesFilter) for (const id of speciesFilter) if (!speciesData.has(id)) report.skippedSpecies.push({ species: id, reason: "espécie não existe" });

phase = Date.now();
const included = new Map<string, Record<string, unknown>>();
const variantsOut = new Map<string, VariantsEntry>();
const poserAnimations = new Map<string, Record<string, string>>();
const soundEvents = new Set<string>();
const copiedTextures = new Set<string>();
const langSpecies: Array<{ id: string; name: string }> = [];
const speciesModelFiles = new Map<string, string>(); // frente animacao: locators dos action_effects

for (const sp of selected) {
	const skip = (reason: string) => report.skippedSpecies.push({ species: sp.id, reason });
	if (sp.data.implemented !== true) {
		skip("implemented != true");
		continue;
	}
	const variations = resolvers.get(sp.id);
	if (!variations?.length) {
		skip("sem resolver");
		continue;
	}
	const enumerated = enumerateCombos(variations, sp.data, features);
	const incomplete = enumerated.incomplete;
	// Frente msd-infra: no import do Mega Showdown, as combinações do base vêm primeiro (índices de variante iguais).
	// Frente msd-fase6: o filho do MSD pode acrescentar no fim as combinações de aspects compartilhados por formas.
	const rawCombos = msdOrderCombos(sp.id, enumerated.combos, () => supplementFormCombos(variations, sp.data, features, enumerated.combos));
	for (const msg of incomplete) warn("enumeração de variantes incompleta", `${sp.id}: ${msg}`);

	// Descarta combinações com modelo/textura/poser ausentes (a 0 precisa sobreviver).
	const poserCache = new Map<string, PoserOutput | null>();
	const combos: Combo[] = [];
	for (const c of rawCombos) {
		const model = models.get(c.model);
		if (!model) {
			warn("modelo ausente", `${sp.id}: ${c.model}`);
			continue;
		}
		if (!textureRef(c.texture)) {
			warn("textura ausente", `${sp.id}: ${c.texture}`);
			continue;
		}
		if (!poserCache.has(c.poser)) {
			const bones = new Set<string>();
			for (const rc of rawCombos) if (rc.poser === c.poser) for (const b of models.get(rc.model)?.bones ?? []) bones.add(b);
			poserCache.set(c.poser, posers.get(c.poser, bones, sp.id));
		}
		if (!poserCache.get(c.poser)) {
			warn("poser sem animações utilizáveis (combinação descartada)", `${sp.id}: ${c.poser}`);
			continue;
		}
		combos.push({ ...c, layers: c.layers.filter((l) => textureRef(l.texture!) || (warn("textura de camada ausente", `${sp.id}: ${l.texture}`), false)) });
	}
	if (!rawCombos.length) {
		skip("sem combinação de modelo+textura+poser nos resolvers");
		continue;
	}
	if (!combos.length || combos[0] !== combos.find((c) => c.poser === rawCombos[0].poser && c.model === rawCombos[0].model && c.texture === rawCombos[0].texture)) {
		if (!combos.length) {
			skip(!models.get(rawCombos[0].model) ? "modelo ausente" : !textureRef(rawCombos[0].texture) ? "textura ausente" : "sem animação idle (poser sem JSON e sem convenção)");
			continue;
		}
		warn("combinação padrão descartada; usando a primeira válida", sp.id);
	}

	// Chaves curtas de geometria/textura e canais de camada.
	const geometries = new Map<string, string>();
	const geoKeyOf = new Map<string, string>();
	const textures = new Map<string, string>();
	const texKeyOf = new Map<string, string>();
	const texKey = (id: string) => {
		let k = texKeyOf.get(id);
		if (!k) {
			const ref = textureRef(id)!;
			k = `t${texKeyOf.size}`;
			texKeyOf.set(id, k);
			textures.set(k, ref.ref);
			if (!copiedTextures.has(ref.ref)) {
				copyFile(ref.file, `${OUT_RP}/${ref.ref}.png`);
				copiedTextures.add(ref.ref);
			}
		}
		return k;
	};
	const channels: Channel[] = [];
	// frente animacao: quadros de textura animada (o 1º quadro é a chave; os demais viram texturas extras).
	const framesOf = (id: string) => {
		const fb = flipbookOf(id);
		if (!fb) return undefined;
		count("texturas animadas (flipbook)");
		return { keys: fb.frames.map((f) => texKey(textureRef(f) ? f : fb.frames[0])), fps: fb.fps, loop: fb.loop };
	};
	const combosOut: ComboOut[] = combos.map((c) => {
		const model = models.get(c.model)!;
		let g = geoKeyOf.get(model.key);
		if (!g) {
			g = `g${geoKeyOf.size}`;
			geoKeyOf.set(model.key, g);
			geometries.set(g, model.geometryId);
		}
		return {
			poser: splitId(c.poser).path,
			geometryKey: g,
			textureKey: texKey(c.texture),
			textureFrames: framesOf(c.texture),
			// Canal = tipo de material + posição entre as camadas desse tipo (reaproveita o render controller).
			layers: c.layers.map((l, li) => {
				const flags = `${l.emissive ? "e" : ""}${l.translucent ? "t" : ""}`;
				const slot = c.layers.slice(0, li).filter((o) => !!o.emissive === !!l.emissive && !!o.translucent === !!l.translucent).length;
				const key = `${flags || "n"}#${slot}`;
				if (!channels.some((ch) => ch.key === key)) channels.push({ key, name: l.name, emissive: !!l.emissive, translucent: !!l.translucent });
				return { channel: key, textureKey: texKey(l.texture!), frames: framesOf(l.texture!), name: l.name, scrolling: l.scrolling }; // scrolling: frente dados-ia
			}),
		};
	});

	// Frente cliente-modelos: grava as geometrias na ordem g0, g1... com a tabela de locators da entidade (locators.ts).
	const locatorRegistry = new Map<string, string>();
	for (const key of geoKeyOf.keys()) models.emit(models.models.get(key)!, locatorRegistry, geoKeyOf.size > 1);

	const speciesPosers = [...new Set(combos.map((c) => c.poser))].map((p) => poserCache.get(p)!);
	const soundEffects = new Map<string, string>();
	const particleEffects = new Map<string, string>();
	for (const p of speciesPosers) {
		for (const e of p.effects) {
			for (const [k, v] of e.sounds) {
				soundEffects.set(k, v);
				soundEvents.add(v.replace(/^cobblemon\./, ""));
			}
			for (const [k, v] of e.particles) particleEffects.set(k, v);
		}
		poserAnimations.set(p.name, p.named);
		if (!p.fromJson) count("posers de reserva (convenção)");
	}
	for (const ev of sounds.speciesEvents(sp.id)) soundEvents.add(ev);

	const movement = movementOf(sp.data);
	// Frente dados-ia: aspects de q.has_aspect dos posers (propriedade cobblemon:aspects).
	const aspectBits = msdOrderAspectBits(sp.id, speciesAspectBits(speciesPosers)); // msd-infra: bits do base na mesma posição
	recordAspectBits(sp.id, aspectBits);
	msdRecordSpecies(sp.id, combos, aspectBits); // msd-infra: baseline (base) ou conferência (import do MSD)
	const render: SpeciesRender = { id: sp.id, geometries, textures, combos: combosOut, channels, posers: speciesPosers, movement, soundEffects, particleEffects, aspectBits };
	emitServerEntity({
		id: sp.id,
		variants: combos.length,
		hitbox: { width: sp.data.hitbox?.width ?? 1, height: sp.data.hitbox?.height ?? 1 },
		baseScale: sp.data.baseScale ?? 1,
		movement,
		data: sp.data,
		modelFile: models.get(combos[0].model)?.file,
		aspectBits,
	});
	// Depois da entidade do BP: a client entity consulta a montaria (estilos, cobblemon:roll) em entityInfoFor.
	emitClientEntity(render);

	included.set(sp.id, gameplaySubset(sp.data));
	variantsOut.set(sp.id, {
		variations,
		combos: combos.map((c) => ({ poser: c.poser, model: c.model, texture: c.texture, layers: c.layers.map(layerKey) })),
	});
	langSpecies.push({ id: sp.id, name: sp.data.name ?? sp.id });
	const defaultModel = models.get(combos[0].model)?.file;
	if (defaultModel) speciesModelFiles.set(sp.id, defaultModel);
	count("espécies geradas");
	count("combinações (variants)", combos.length);
	if (channels.length) count("espécies com camadas", 1);
}
t("espécies", phase);

phase = Date.now();
// Sons de jogo que não são de espécie (pesca, PC, máquinas, itens, bolas...): os scripts tocam por nome.
for (const ev of sounds.names) if (!ev.startsWith("pokemon.")) soundEvents.add(ev);
emitScriptParticles(); // frente jogabilidade-final: partículas evo_* e poodle_hair_*
requestMsdEffectParticles(); // frente msd-fase2: partículas dos efeitos Mega/Z/Ultra/Primal (só no import filho do MSD)
emitGuiTextures(); // frente ui-base: texturas de GUI do Cobblemon, barras do HUD e glifos E2/E3
emitActionEffects(anims, speciesModelFiles); // frente animacao: generated/scripts/actionEffects.ts (+ partículas e animações de golpe)
emitRequestedParticles(); // frente animacao: partículas do Cobblemon pedidas (animações, golpes, scripts)
for (const ev of particleIndex().soundEvents) soundEvents.add(ev);
report.counts["sons (sound_definitions)"] = sounds.emit(soundEvents);
const langCounts = emitLang(langSpecies);
emitWallpapers(); // frente extras-final: texturas do PC + generated/scripts/wallpapers.ts
for (const [k, v] of Object.entries(langCounts)) report.counts[`linhas ${k}.lang`] = v;
t("sons e textos", phase);

phase = Date.now();
emitSpeciesModule(included);
emitEntityDataModule();
emitDadosIaModule(speciesData); // frente dados-ia: aspects no cliente, species features, IA por script
emitVariantsModule(variantsOut, poserAnimations);
report.counts["posers com enquadramento do Java (estúdio 3D)"] = emitStudioFramingModule(variantsOut); // frente fix3
// Frente retratos: rasteriza os retratos em workers, em paralelo com o resto do import (esperado no fim).
const portraitsDone = startPortraits({ variants: variantsOut, models, anims });
const biomes = new BiomeResolver();
const blocks = new BlockResolver();
const spawnBuilder = new SpawnBuilder(biomes, blocks, features);
const spawns = spawnBuilder.build(new Set(included.keys()), speciesData);
emitSpawnsModule(spawns);
// Habitats (data/cobblemon/habitat_pools): emitidos no fim, com o alcance das âncoras das estruturas convertidas.
const habitatPools = buildHabitatPools(spawnBuilder, new Set(included.keys()), speciesData);
const habitatAnchorRanges = new Map<string, number>();
const biomeTags: Record<string, string[]> = {};
for (const tag of biomes.allCobblemonTags()) biomeTags[tag] = biomes.resolve(`#${tag}`);
emitBiomeTagsModule(biomeTags);
emitNpcs(); // frente social: entidade cobblemon:npc + generated/scripts/npcs.ts
report.counts["spawns"] = spawns.length;
report.counts["tags de bioma"] = Object.keys(biomeTags).length;
for (const b of biomes.unmapped) warn("bioma/tag sem mapeamento para o Bedrock", b);
for (const b of blocks.unmapped) warn("tag de bloco sem mapeamento", b);
t("dados de scripts", phase);

// Itens, blocos, receitas, loot e worldgen do Cobblemon (só quando não há filtro de espécies).
const contentOnlyPokemon = !!(speciesFilter || gensFilter) && process.argv.includes("--only-pokemon");
let wearablesOut: WearableOut[] = []; // frente mundo-detalhes
let discTextures: string[] = []; // frente mundo-detalhes
let fetusOut: { names: string[]; yTranslation: Record<string, number> } = { names: [], yTranslation: {} }; // frente mundo-detalhes
let privateContent: Omit<PrivateContentContext, "out"> | undefined; // extensões privadas de conteúdo (fim do import)
if (!contentOnlyPokemon) {
	phase = Date.now();
	const blockBuilder = new BlockBuilder((id) => (id.startsWith("cobblemon:") ? id : bedrockVanillaItem(id)));
	blockBuilder.buildAll();
	report.counts["texturas de terreno"] = blockBuilder.textures.emit();
	emitEmptyLoot();
	const itemsOut = buildItems(blockBuilder.out, pokeballEntities(HAND_BP), blockBuilder.registered);
	const recipeStats = buildRecipes({ items: itemsOut.ids, taggable: itemsOut.withJson });
	// Frente mundo-detalhes: vestíveis (attachables), catálogo do criativo, inflamáveis/atrito.
	wearablesOut = emitWearables();
	appendCatalogLang(emitCreativeCatalog(itemsOut.ids));
	patchBlocks();
	emitAdaptacoes(); // frente adaptacoes (depois dos blocos gerados e do patchBlocks)
	emitComparadores(); // frente comparadores (depois dos blocos gerados)
	discTextures = emitDiscShelfDisplay();
	fetusOut = emitFossilFetus();
	emitVanillaFoodTags();
	report.counts["receitas de panela (scripts)"] = recipeStats.scriptCooking;
	report.counts["receitas de poção (scripts)"] = recipeStats.scriptBrewing;
	report.counts["receitas puladas"] = recipeStats.skipped.length;
	const featureStats = new FeatureBuilder(biomes, blocks, new Set(blockBuilder.emittedBlocks)).buildAll();
	for (const s of featureStats.skipped) warn("feature sem bioma no Bedrock", s);
	emitLootInjections((id) => (id.startsWith("cobblemon:") ? id : bedrockVanillaItem(id)));
	// Estruturas de molde único (fósseis, habitats, ruínas): .mcstructure + features; a âncora de habitat de cada
	// molde define o alcance do pool (HABITAT_ANCHOR_RANGES).
	const structureMapper = new BlockMapper((id, props) => blockBuilder.bedrockStateFor(id, props));
	privateContent = { cobblemonState: (id, props) => blockBuilder.bedrockStateFor(id, props), biomes };
	const structureLoot = new StructureLoot();
	const poolIndex = new Map(habitatPools.map((p) => [p.id, p.index]));
	const structureStats = buildStructures({ mapper: structureMapper, biomes, poolIndex, loot: structureLoot });
	// Estruturas jigsaw (habitats, ruínas, barcos, enseadas): montadas na conversão (jigsaw.ts).
	const jigsawStats = buildJigsawStructures({ mapper: structureMapper, biomes, poolIndex, lootPath: structureLoot.path });
	for (const stats of [structureStats, jigsawStats]) {
		for (const [pool, range] of stats.anchorRanges) habitatAnchorRanges.set(pool, Math.max(habitatAnchorRanges.get(pool) ?? 0, range));
		for (const s of stats.skipped) warn("estrutura pulada", s);
	}
	structureLoot.emit((id) => (id.startsWith("cobblemon:") ? id : bedrockVanillaItem(id)));
	for (const m of structureMapper.missing) warn("estado de bloco de estrutura sem equivalente no Bedrock", m);
	report.counts["loot tables"] = lootCount();
	report.counts["componentes de bloco para os scripts"] = emitBlockBehaviours(blockBuilder.registered);
	emitAncientBalls();
	emitPokeBallSounds();
	emitDex();
	// Máquinas: generated/scripts/machines.ts (fósseis, temperos, TMs, tags); lê o recipes.ts gerado acima.
	process.env.COBBLEMON_IMPORT_OUT = OUT;
	await import("./machinesData.mjs");
	writeJson(`${OUT}/content-report.json`, { recipesSkipped: recipeStats.skipped, featuresSkipped: featureStats.skipped, blocks: [...blockBuilder.out.values()] });
	t("itens, blocos, receitas e worldgen", phase);
}

// Frente limites-b: grupos de receita no catálogo (depois do catálogo), pinturas, enfermeira e generated/scripts/limitesB.ts.
emitLimitesB(!contentOnlyPokemon);
emitHabitatsModule(habitatPools, habitatAnchorRanges, HABITAT_ANCHOR_MIMICS);
// Frente mundo-detalhes: generated/scripts/mundoDetalhes.ts (luz, locators de item, vestíveis, compostagem, Fortuna).
emitMundoDetalhesModule({ speciesData, included: new Set(included.keys()), wearables: wearablesOut, compostBlockItems: COMPOST_BLOCK_ITEMS, fortune: contentOnlyPokemon ? {} : fortuneData(), discTextures, fetus: fetusOut });
emitAdvancements(); // frente ui-base: generated/scripts/advancements.ts (lê os itens gerados acima)

// Frente fix3: cabeças diferentes entre as formas (armor_offset.default_neck automático do cliente).
{
	const neck = fixArmorNeckCollisions(OUT_RP);
	report.counts["armor_offset.default_neck: geometrias com o osso head renomeado"] = neck.geometries;
	report.counts["armor_offset.default_neck: entidades afetadas"] = neck.entities;
	report.counts["armor_offset.default_neck: animações com o canal de head copiado"] = neck.animations;
}
// Frente fix3: z-fighting nos blocos (cubos coplanares; planos de espessura zero com material alpha_test).
{
	const z = fixBlockZFighting();
	report.counts["z-fighting: cubos de bloco com inflate para separar faces coplanares"] = z.separated;
	report.counts["z-fighting: blocos com planos em alpha_test_single_sided"] = z.blocks;
	report.counts["z-fighting: material instances trocadas"] = z.instances;
	for (const s of z.sameSide) warn("bloco com faces coplanares sobrepostas do mesmo lado (z-fighting)", `${s.block} ${s.geometry}: ${s.pairs} par(es)`);
}
report.counts["geometrias"] = models.emittedCount;
report.counts["grupos de animação"] = anims.emittedCount;
report.counts["texturas"] = copiedTextures.size;
await portraitsDone;
// Frente cliente-teste3-log (depois dos retratos, que leem as geometrias em paralelo): planos de espessura zero das
// entidades ganham espessura (z-fighting com o material de dois lados) e toda variável lida por uma client entity é
// inicializada no pre_animation (render controllers/animações/controllers: "unknown variable" no cliente).
{
	const flat = fixEntityFlatPlanes();
	report.counts["z-fighting: cubos planos de entidade com espessura (inflate)"] = flat.cubes;
	report.counts["z-fighting: geometrias de entidade com planos"] = flat.geometries;
	// Frente zfight2: cubos que a espessura deixou coplanares (inclusive entre ossos) e os materiais das camadas.
	report.counts["z-fighting: cubos separados depois da espessura (Pokémon, entre ossos)"] = flat.separated;
	writeJson(`${OUT_RP}/materials/entity.material`, entityMaterialFile());
	const vars = ensureEntityVariables(OUT_RP, HAND_RP);
	report.counts["client entities com variáveis inicializadas no pre_animation"] = vars.entities;
	report.counts["variáveis inicializadas no pre_animation (v.x ?? 0)"] = vars.variables;
	if (vars.names.size) console.log(`  variáveis sem inicialização (entidades): ${[...vars.names].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}×${c}`).join(", ")}`);
}
report.durationMs = Date.now() - started;
report.output = writeStats();
writeJson(`${OUT}/import-report.json`, report);

// Resumo no console.
console.log(`\nImportação concluída em ${(report.durationMs / 1000).toFixed(1)}s → ${rel(OUT)}`);
for (const [k, v] of Object.entries(report.counts)) console.log(`  ${k}: ${v}`);
const reasons = new Map<string, number>();
for (const s of report.skippedSpecies) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
console.log(`  espécies puladas: ${report.skippedSpecies.length}`);
for (const [r, n] of reasons) console.log(`    - ${r}: ${n}`);
const molang = Object.entries(report.unconvertedMolang).sort((a, b) => b[1].count - a[1].count);
if (molang.length) console.log(`  Molang não convertido: ${molang.map(([k, v]) => `${k}×${v.count}`).join(", ")}`);
if (report.animationParseFailures.length) console.log(`  animações que falharam: ${report.animationParseFailures.length}`);
console.log(`  avisos: ${Object.entries(report.warnings).map(([k, v]) => `${k}×${v.count}`).join("; ")}`);
console.log(`  arquivos: ${report.output.files}, ${(report.output.bytes / 1048576).toFixed(1)} MB (detalhes em generated/import-report.json)`);

// Frente msd-infra: pack Mega Showdown (processo filho sobre o overlay do MSD + diferença para o base), antes da
// troca. Uma falha não derruba o base: o MSD sai de generated/ e o import termina com código 1.
if (isMsdChild()) msdWriteChildResult(OUT, variantsOut);
else if (!msdModulesPresent) console.log("MSD: módulos privados ausentes (repositório público): import só do base");
else {
	const msd = runMegaShowdownImport(OUT, process.argv.slice(2));
	console.log(msd.message);
	if (!msd.ok) {
		removeMsdOutput(OUT);
		process.exitCode = 1;
	}
	// Frente msd-fase1: tabelas do MSD para o módulo dormente do bundle base (vazio sem o MSD ou com falha).
	const tables = await emitMsdScriptsModule(OUT, msd.ok); // frente msd-fase2: assíncrono (lê os módulos do filho)
	console.log(`MSD: tabelas do módulo dormente → ${rel(tables.file)} (${tables.species} espécies com variantes estendidas)`);
}

// Extensões privadas de conteúdo (packs próprios em tools/private/<nome>/; nada num clone público). Fora do filho do
// MSD: o pack do MSD é a diferença base → filho e não pode levar o pack de outra extensão.
if (privateContent && !isMsdChild()) {
	const extras = await runPrivateContentPacks({ out: OUT, ...privateContent });
	for (const m of extras.messages) console.log(m);
	if (!extras.ok) process.exitCode = 1;
}

// Troca atômica: generated/ nunca fica pela metade para quem está lendo (tsc, testes, build).
if (OUT !== OUT_FINAL) {
	const old = `${OUT_FINAL}.old-${process.pid}`;
	if (existsSync(OUT_FINAL)) renameSync(OUT_FINAL, old);
	renameSync(OUT, OUT_FINAL);
	rmSync(old, { recursive: true, force: true });
}
