// Frente "extras-final": variações na Pokédex, scanner, "Progresso Cobblemon" e papéis de parede do PC.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formHooks } from "./mocks/minecraft-server-ui";
import { DEXES, DEX_ENTRIES } from "../generated/scripts/dex";
import { getNationalEntry, getDex, parseVariations, setDexData } from "../scripts/pokedex/DexData";
import { DexProgress, PokedexRecords } from "../scripts/pokedex/PokedexRecords";
import { LearnedInformation, describeEntryVariations, getNewInformation, humanizeAspect } from "../scripts/pokedex/PokedexVariations";
import { DEX_KEYS, variationLines } from "../scripts/pokedex/PokedexUI";
import { SUCCESS_SCAN_TICKS, scanProgressMessage } from "../scripts/pokedex/PokedexItem";
import {
  PROGRESS_GOALS, PROGRESS_PROPERTY, getProgress, goalStatuses, parseProgress, recordCapture, recordCollectedAspects,
  recordEvolution, recordFlag, recordTrade,
} from "../scripts/pokedex/Progress";
import {
  DEFAULT_WALLPAPER, RESOURCE_WALLPAPERS, altTexture, baseTexture, bedrockTexturePath, biomeWallpaperUnlocks,
  boxWallpaperTexturePath, canUseWallpaper, expandTexture, getAvailableWallpapers, getBoxWallpaper, getUnlockableWallpapers,
  getUnseenWallpapers, hasUnlockedWallpaper, markWallpapersSeen, onPokemonCapturedWallpapers, setBoxWallpaper,
  setUnlockableWallpapers, setWallpaperNotifier, shortTexture, unlockWallpaper, wallpaperName,
} from "../scripts/GUI/PCWallpapers";
import { showWallpaperPicker } from "../scripts/GUI/PC";

const originalWarn = console.warn;
console.warn = () => { };

/** Jogador falso: dynamic properties, mensagens e sons. */
class FakePlayer {
  constructor(public id = "player-1") { }
  name = "Ash";
  isValid = true;
  props = new Map<string, string | number | boolean>();
  sounds: string[] = [];
  getDynamicProperty(key: string) { return this.props.get(key); }
  setDynamicProperty(key: string, value?: string | number | boolean) {
    if (value === undefined) this.props.delete(key);
    else this.props.set(key, value);
  }
  getDynamicPropertyIds() { return [...this.props.keys()]; }
  sendMessage() { }
  playSound(sound: string) { this.sounds.push(sound); }
}

const info = (species: string, form = "Normal", aspects: string[] = [], gender = "m", shiny = false) =>
  ({ species, form, aspects, gender, shiny, level: 10 });

// ---------------------------------------------------------------------------------------------
// 1. Variações e aspectos de exibição vindos de dex_entries

setDexData(DEXES, DEX_ENTRIES);
{
  const vivillon = getNationalEntry("vivillon")!;
  assert.ok(vivillon, "vivillon na Pokédex nacional");
  assert.equal(vivillon.variations?.length, 1);
  assert.equal(vivillon.variations![0].displayName, "cobblemon.pokedex.variation.pattern");
  assert.equal(vivillon.variations![0].aspects.length, 22);
  // Slowpoke de Galar (entrada regional) traz displayAspects; a nacional aglutina as variações.
  const galar = getDex("galar")!.getEntries().find(entry => entry.id === "slowpoke-galar")!;
  assert.deepEqual(galar.displayAspects, ["regrown-tail-1", "regrown-tail-2", "regrown-tail-3"]);
  assert.ok(DEX_ENTRIES.filter(entry => (entry.variations ?? []).length > 0).length >= 15, "entradas com variações");
  // Validação do JSON de variação.
  assert.deepEqual(parseVariations([null, { aspects: [] }, { aspects: ["a", 1, "b"] }]),
    [{ displayName: "cobblemon.pokedex.variation.cosmetic", icon: undefined, aspects: ["a", "b"] }]);
}

// 2. O que a entrada mostra (gêneros, shiny, formas, variações vistas)
{
  const records = new PokedexRecords();
  const vivillon = getNationalEntry("vivillon")!;
  const normal = vivillon.getForms().find(form => form.displayForm === "Normal")!;
  let view = describeEntryVariations(records, vivillon, normal);
  assert.deepEqual(view.genders, []);
  assert.deepEqual(view.variations[0].seen, []);

  records.encounter(info("vivillon", "Normal", ["vivillon-wings-meadow", "female"], "f"));
  records.obtain(info("vivillon", "Normal", ["vivillon-wings-high-plains", "male"], "m", true));
  view = describeEntryVariations(records, vivillon, normal);
  assert.deepEqual(view.genders, ["male", "female"]);
  assert.deepEqual(view.shinyStates, ["normal", "shiny"]);
  assert.deepEqual(view.variations[0].seen, ["vivillon-wings-meadow", "vivillon-wings-high-plains"].sort((a, b) =>
    view.variations[0].aspects.indexOf(a) - view.variations[0].aspects.indexOf(b)));
  assert.equal(view.variations[0].total, 22);
  assert.equal(view.forms.find(form => form.displayForm === "Normal")!.knowledge, DexProgress.OWNED);
  assert.equal(view.forms.find(form => form.displayForm !== "Normal")!.knowledge, DexProgress.UNREGISTERED);

  const lines = JSON.stringify(variationLines(view));
  assert.ok(lines.includes(DEX_KEYS.variations));
  assert.ok(lines.includes(DEX_KEYS.shinySeen));
  assert.ok(lines.includes("cobblemon.gender.female"));
  assert.ok(lines.includes("High Plains") && lines.includes("Meadow"));
  assert.ok(lines.includes("(2/22)"));
  // Espécie sem nada além do padrão: sem seção.
  const zangoose = getNationalEntry("zangoose")!;
  records.encounter(info("zangoose", "Normal", [], ""));
  assert.deepEqual(variationLines(describeEntryVariations(records, zangoose, zangoose.getForms()[0])), []);
  // Sem gênero não aparece como gênero visto se houver macho/fêmea.
  records.encounter(info("vivillon", "Normal", [], ""));
  assert.deepEqual(describeEntryVariations(records, vivillon, normal).genders, ["male", "female"]);
}

// 3. Rótulos legíveis dos aspectos
{
  const wings = ["vivillon-wings-meadow", "vivillon-wings-high-plains", "vivillon-wings-poke-ball"];
  assert.equal(humanizeAspect("vivillon-wings-high-plains", wings), "High Plains");
  assert.equal(humanizeAspect("vivillon-wings-poke-ball", wings), "Poke Ball");
  assert.equal(humanizeAspect("decoration-strawberry", ["decoration-strawberry", "decoration-berry", ""]), "Strawberry");
  assert.equal(humanizeAspect("netherite-coating-full"), "Netherite Coating Full");
  assert.equal(humanizeAspect("snake_pattern_classic", ["snake_pattern_classic", "snake_pattern_angry"]), "Classic");
}

// 4. getNewInformation (o que o scanner acrescenta)
{
  const records = new PokedexRecords();
  const pikachu = info("pikachu", "Normal", ["male"], "m");
  assert.equal(getNewInformation(records, pikachu), LearnedInformation.SPECIES);
  records.encounter(pikachu);
  assert.equal(getNewInformation(records, pikachu), LearnedInformation.NONE);
  assert.equal(getNewInformation(records, info("pikachu", "Normal", ["female"], "f")), LearnedInformation.VARIATION, "gênero novo");
  assert.equal(getNewInformation(records, info("pikachu", "Normal", ["male", "shiny"], "m", true)), LearnedInformation.VARIATION, "shiny novo");
  assert.equal(getNewInformation(records, info("pikachu", "Alola-Bias", ["male"], "m")), LearnedInformation.FORM);
  assert.equal(getNewInformation(records, info("raichu")), LearnedInformation.SPECIES);
}

// 5. Barra do scanner na actionbar
{
  const start = JSON.stringify(scanProgressMessage({ text: "Pikachu" }, LearnedInformation.SPECIES, 1));
  assert.ok(start.includes(DEX_KEYS.scanNewSpecies) && start.includes("7%"));
  const end = JSON.stringify(scanProgressMessage({ text: "Pikachu" }, LearnedInformation.VARIATION, SUCCESS_SCAN_TICKS));
  assert.ok(end.includes(DEX_KEYS.scanNewVariation) && end.includes("100%") && end.includes("§a||||||||||§8 "));
  assert.ok(JSON.stringify(scanProgressMessage({ text: "x" }, LearnedInformation.FORM, 8)).includes(DEX_KEYS.scanNewForm));
}

// 6. "Progresso Cobblemon"
{
  const player = new FakePlayer();
  assert.deepEqual(getProgress(player).c, 0);
  assert.equal(goalStatuses(getProgress(player)).filter(x => x.done).length, 0);

  recordCapture(player, { species: "pikachu", aspects: ["male"] });
  recordCapture(player, { species: "wailord", aspects: ["alpha", "female"], shiny: true });
  recordCapture(player, { species: "vivillon", aspects: ["vivillon-wings-meadow", "female", "shiny"] });
  let state = getProgress(player);
  assert.equal(state.c, 3);
  assert.equal(state.s, 2, "shiny pela flag ou pelo aspecto");
  assert.equal(state.a, 1);
  assert.deepEqual(state.asp.wailord, ["alpha"], "só aspectos acompanhados");
  assert.deepEqual(state.asp.vivillon, ["vivillon-wings-meadow"]);
  assert.equal(state.asp.pikachu, undefined);

  recordCollectedAspects(player, { species: "vivillon", aspects: ["vivillon-wings-garden", "vivillon-wings-meadow"] });
  recordEvolution(player, "nincada", { species: "shedinja", aspects: [] });
  recordEvolution(player, "gimmighoul", { species: "gholdengo", aspects: ["netherite-coating-full"] });
  recordTrade(player, { species: "pikachu", aspects: [] });
  assert.ok(recordFlag(player, "full_party"));
  assert.ok(!recordFlag(player, "full_party"), "marca já alcançada");

  const statuses = new Map(goalStatuses(getProgress(player)).map(x => [x.goal.id, x]));
  for (const id of ["first_catch", "first_shiny_catch", "first_alpha_catch", "catch_alpha_wailord", "first_evolution",
    "evolve_shedinja", "evolve_gholdengo_netherite", "trade_pokemon", "full_party"])
    assert.ok(statuses.get(id)!.done, `${id} feito`);
  assert.equal(statuses.get("collect_all_vivillon")!.value, 2);
  assert.equal(statuses.get("collect_all_vivillon")!.goal.target, 19);
  assert.equal(statuses.get("collect_all_vivillon_full")!.goal.target, 23);
  assert.ok(!statuses.get("craft_pokedex")!.done);
  assert.ok(!statuses.get("resurrect_pokemon")!.done);
  // Evolução não acompanhada só conta.
  recordEvolution(player, "pichu", { species: "pikachu", aspects: [] });
  state = getProgress(player);
  assert.equal(state.e, 3);
  assert.deepEqual(state.ev, ["nincada>shedinja"]);

  // Estado corrompido → zerado; tipos errados ignorados.
  assert.equal(parseProgress("{nope").c, 0);
  assert.equal(parseProgress('{"c":-3,"s":"x","f":[1,"a"],"asp":{"vivillon":"x","wailord":["alpha"]}}').c, 0);
  assert.deepEqual(parseProgress('{"f":[1,"a"],"asp":{"vivillon":"x","wailord":["alpha"]}}').asp, { wailord: ["alpha"] });
  player.setDynamicProperty(PROGRESS_PROPERTY, "[]");
  assert.equal(getProgress(player).c, 0);
  // Todos os objetivos têm texto de conquista no lang gerado (en_US e pt_BR).
  const genEn = readFileSync("generated/resource_packs/CobblemonBedrock/texts/en_US.lang", "utf8");
  for (const goal of PROGRESS_GOALS) {
    assert.ok(genEn.includes(`advancements.cobblemon.${goal.id}=`), `título de ${goal.id}`);
    assert.ok(genEn.includes(`advancements.cobblemon.${goal.id}.description=`), `descrição de ${goal.id}`);
  }
}

// 7. Papéis de parede do PC
{
  const notified: string[] = [];
  setWallpaperNotifier((_holder, wallpaper) => notified.push(wallpaper.id));
  const player = new FakePlayer("wp");
  assert.equal(RESOURCE_WALLPAPERS.length, 17);
  assert.equal(getUnlockableWallpapers().length, 6);
  // Início: só os 11 básicos (os 6 desbloqueáveis estão trancados).
  assert.equal(getAvailableWallpapers(player).length, 11);
  assert.ok(getAvailableWallpapers(player).every(texture => texture.includes("/basic/")));
  assert.equal(getBoxWallpaper(player, 0), DEFAULT_WALLPAPER);
  // Caixa sem escolha: o PCBox guarda pc_screen_overlay, mas o cliente do Java desenha o
  // PCBoxWallpaperRepository.defaultWallpaper (wallpaper_basic_05); ver docs/pendencias/visual-final.md, "Fechamento".
  assert.equal(boxWallpaperTexturePath(player, 0), "textures/gui/pc/wallpaper/basic/wallpaper_basic_05");

  // Texturas
  const basic = RESOURCE_WALLPAPERS[0];
  assert.equal(basic, "cobblemon:textures/gui/pc/wallpaper/basic/wallpaper_basic_01.png");
  assert.equal(altTexture(basic), "cobblemon:textures/gui/pc/wallpaper/basic/alt/wallpaper_basic_01.png");
  assert.equal(altTexture(altTexture(basic)!), undefined);
  assert.equal(baseTexture(altTexture(basic)!), basic);
  assert.equal(bedrockTexturePath(basic), "textures/gui/pc/wallpaper/basic/wallpaper_basic_01");
  assert.equal(shortTexture(basic), "basic/wallpaper_basic_01");
  assert.equal(expandTexture(shortTexture(basic)), basic);
  assert.equal(expandTexture("textures/gui/pc/wallpaper/misc/wallpaper_pokemon_alpha"), "cobblemon:textures/gui/pc/wallpaper/misc/wallpaper_pokemon_alpha.png");
  assert.deepEqual(wallpaperName(basic), { text: "Basic 01" });
  assert.deepEqual(wallpaperName("cobblemon:textures/gui/pc/wallpaper/biome/alt/wallpaper_biome_cave.png"), { translate: "cobblemon.port.wallpaper.biome_cave" });

  // Escolha por caixa (só o que está disponível).
  assert.ok(setBoxWallpaper(player, 2, basic));
  assert.equal(getBoxWallpaper(player, 2), basic);
  assert.equal(boxWallpaperTexturePath(player, 2), "textures/gui/pc/wallpaper/basic/wallpaper_basic_01");
  assert.ok(setBoxWallpaper(player, 3, RESOURCE_WALLPAPERS[4], true), "versão alternativa");
  assert.equal(getBoxWallpaper(player, 3), altTexture(RESOURCE_WALLPAPERS[4]));
  const cave = "cobblemon:textures/gui/pc/wallpaper/biome/wallpaper_biome_cave.png";
  assert.ok(!canUseWallpaper(player, cave));
  assert.ok(!setBoxWallpaper(player, 0, cave), "trancado");
  assert.ok(!setBoxWallpaper(player, -1, basic));
  assert.ok(!setBoxWallpaper(player, 0, "cobblemon:textures/gui/pc/wallpaper/basic/nope.png"));
  assert.ok(setBoxWallpaper(player, 2, DEFAULT_WALLPAPER));
  assert.equal(getBoxWallpaper(player, 2), DEFAULT_WALLPAPER);
  assert.ok(!player.props.has("cobblemon:pcwp:2"), "padrão não é guardado");

  // Desbloqueio (PCStore.unlockWallpaper): uma vez só, com aviso, e fica "não visto".
  assert.ok(unlockWallpaper(player, "biome_cave"));
  assert.ok(!unlockWallpaper(player, "cobblemon:biome_cave"));
  assert.ok(!unlockWallpaper(player, "cobblemon:nope"));
  assert.deepEqual(notified, ["cobblemon:biome_cave"]);
  assert.ok(hasUnlockedWallpaper(player, "cobblemon:biome_cave"));
  assert.deepEqual(getUnseenWallpapers(player), [cave]);
  assert.ok(getAvailableWallpapers(player).includes(cave));
  assert.equal(getAvailableWallpapers(player).length, 12);
  assert.ok(setBoxWallpaper(player, 0, cave));
  assert.deepEqual(getUnseenWallpapers(player), [], "usar marca como visto");
  assert.ok(unlockWallpaper(player, "cobblemon:biome_forest", false));
  assert.deepEqual(notified, ["cobblemon:biome_cave"], "sem aviso quando playSound=false");
  markWallpapersSeen(player, ["cobblemon:textures/gui/pc/wallpaper/biome/wallpaper_biome_forest.png"]);
  assert.deepEqual(getUnseenWallpapers(player), []);

  // Callbacks: bioma/dimensão e captura de Alfa.
  assert.deepEqual(biomeWallpaperUnlocks("minecraft:lush_caves", "minecraft:overworld"), ["cobblemon:biome_cave"]);
  assert.deepEqual(biomeWallpaperUnlocks("forest", "minecraft:overworld"), ["cobblemon:biome_forest"]);
  assert.deepEqual(biomeWallpaperUnlocks("deep_ocean", "minecraft:overworld"), ["cobblemon:biome_ocean"]);
  assert.deepEqual(biomeWallpaperUnlocks("crimson_forest", "minecraft:nether"), ["cobblemon:biome_nether"]);
  assert.deepEqual(biomeWallpaperUnlocks("the_end", "minecraft:the_end"), ["cobblemon:biome_the_end"]);
  assert.deepEqual(biomeWallpaperUnlocks("plains", "minecraft:overworld"), []);
  onPokemonCapturedWallpapers(player, ["male"]);
  assert.ok(!hasUnlockedWallpaper(player, "cobblemon:pokemon_alpha"));
  onPokemonCapturedWallpapers(player, ["alpha"]);
  assert.ok(hasUnlockedWallpaper(player, "cobblemon:pokemon_alpha"));

  // Desbloqueável desativado pelo dado: some da lista mesmo liberado e não pode ser liberado.
  const original = getUnlockableWallpapers();
  setUnlockableWallpapers(original.map(x => x.id === "cobblemon:biome_cave" ? { ...x, enabled: false } : x));
  assert.ok(!getAvailableWallpapers(player).includes(cave));
  assert.ok(!unlockWallpaper(new FakePlayer("other"), "cobblemon:biome_cave"));
  setUnlockableWallpapers(original);

  // Tela: escolhe o 1º disponível e a versão alternativa.
  const picks = [1, 1];
  formHooks.show = () => ({ selection: picks.shift(), canceled: false });
  await showWallpaperPicker(player as any, 5);
  assert.equal(getBoxWallpaper(player, 5), altTexture(basic));
  assert.ok(player.sounds.includes("cobblemon.pc.click"));
  formHooks.show = () => ({ selection: 0, canceled: false });
  await showWallpaperPicker(player as any, 5);
  assert.equal(getBoxWallpaper(player, 5), DEFAULT_WALLPAPER, "botão Padrão");
  formHooks.show = () => ({ selection: undefined, canceled: true });
  await showWallpaperPicker(player as any, 5);
  assert.equal(getBoxWallpaper(player, 5), DEFAULT_WALLPAPER);
  formHooks.show = undefined;
  setWallpaperNotifier(undefined);
}

// 8. JSON UI do PC e textos
{
  const pc = JSON.parse(readFileSync("resource_packs/CobblemonBedrock/ui/pc.json", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(pc["scrolling_panel@common.scrolling_panel"]["$scrolling_content"], "pc.pc_content");
  const wallpaper = pc.pc_content.controls[0].wallpaper;
  assert.equal(wallpaper.type, "image");
  assert.equal(wallpaper.bindings[0].binding_name, "#form_text");
  // Os textos do port usados pela frente existem nas duas línguas.
  const en = readFileSync("resource_packs/CobblemonBedrock/texts/en_US.lang", "utf8");
  const pt = readFileSync("resource_packs/CobblemonBedrock/texts/pt_BR.lang", "utf8");
  const sources = ["scripts/pokedex/PokedexUI.ts", "scripts/pokedex/PokedexItem.ts", "scripts/GUI/PCWallpapers.ts", "scripts/GUI/PC.ts"]
    .map(file => readFileSync(file, "utf8")).join("\n");
  const keys = new Set(sources.match(/cobblemon\.port\.(pokedex|wallpaper)\.[a-z_]+/g) ?? []);
  assert.ok(keys.size >= 20);
  for (const key of keys) {
    assert.ok(en.includes(`\n${key}=`), `${key} em en_US`);
    assert.ok(pt.includes(`\n${key}=`), `${key} em pt_BR`);
  }
}

console.warn = originalWarn;
console.log("extras-final: ok");
