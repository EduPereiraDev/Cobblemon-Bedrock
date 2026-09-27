// Frente "telas": layouts do Cobblemon (batalha, resumo, PC, inicial, Pokédex), estúdio de câmera e scanner.
// Confere o contrato script ↔ JSON UI (sub-marcadores e índices das células), a validade dos layouts gerados,
// as texturas referenciadas e as partes puras (montagem dos forms, enquadramento, zoom).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PokemonData } from "../scripts/Pokemon";
import { SCREEN, ROUTED_SCREENS } from "../scripts/ui/screens";
import {
  BATTLE_ACTION, BATTLE_MOVES, BATTLE_SWITCH, BATTLE_TARGET, BLANK, CellForm, PC, POKEDEX_ENTRY, POKEDEX_LIST, STARTER, SUB,
  SUMMARY, TYPE_HUES, barTexture, battleMenuTexture, layoutTitle, typeKeyTexture,
} from "../scripts/GUI/layout";
import { buildSummaryForm } from "../scripts/GUI/Summary";
import { buildStarterForm, getStarterCategories } from "../scripts/GUI/StarterGUI";
import { renderMoveButton } from "../scripts/GUI/Battle";
import { generate } from "../tools/ui/gen-telas";
import { cameraFor, findStage, FRAMING, scanOverlayMessage, zoomStepAfterSlotChange, ZOOM_FOVS } from "../scripts/ui/studio";

const ROOT = process.cwd();
const UI = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");
const RP = join(ROOT, "resource_packs", "CobblemonBedrock");
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const readJsonc = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
type Json = Record<string, any>;

// ---------------------------------------------------------------------------------------------
// 1. Sub-marcadores: invisíveis, únicos e sem conter um marcador de tela

{
  const subs = Object.values(SUB);
  assert.equal(new Set(subs).size, subs.length, "sub-marcadores únicos");
  for (const sub of subs) assert.match(sub, /^(§[0-9a-f]){2}§r$/, `só códigos de cor: ${sub}`);
  // Qualquer título "tela + sub + sub" só contém o próprio marcador de tela, e só no início.
  for (const screen of Object.values(SCREEN)) {
    for (const a of subs) for (const b of subs) {
      const title = screen + a + b;
      for (const other of Object.values(SCREEN)) {
        const at = title.indexOf(other);
        assert.ok(other === screen ? at === 0 && title.indexOf(other, 1) < 0 : at < 0, `${JSON.stringify(title)} x ${other}`);
      }
    }
  }
  const title = layoutTitle(SCREEN.SUMMARY, [SUB.SUMMARY_STATS, SUB.STUDIO], { translate: "x" });
  assert.deepEqual(title, { rawtext: [{ text: SCREEN.SUMMARY }, { rawtext: [{ text: SUB.SUMMARY_STATS + SUB.STUDIO }, { translate: "x" }] }] });
  for (const screen of [SCREEN.SUMMARY, SCREEN.STARTER, SCREEN.POKEDEX]) assert.ok(ROUTED_SCREENS.includes(screen), `${screen} roteado`);
}

// ---------------------------------------------------------------------------------------------
// 2. Layouts gerados: em dia, JSON válido, células com os índices do contrato

const layouts: Record<string, Json> = {};
{
  const generated = generate();
  for (const [name, content] of Object.entries(generated)) {
    assert.equal(readFileSync(join(UI, name), "utf8"), content, `${name} em dia com tools/ui/gen-telas.ts`);
    layouts[name] = readJsonc(join(UI, name));
    assert.equal(typeof layouts[name].namespace, "string");
  }
  const defs = readJsonc(join(UI, "_ui_defs.json")).ui_defs as string[];
  for (const name of Object.keys(generated)) assert.ok(defs.includes(`ui/${name}`), `_ui_defs lista ${name}`);
  const router = JSON.stringify(readJsonc(join(UI, "cobblemon_forms.json")));
  for (const ref of ["summary.summary_form", "starter.starter_form", "pokedex.pokedex_form", "battle.battle_form", "pc.pc_form"]) assert.ok(router.includes(ref), `roteador usa ${ref}`);
  const hud = readJsonc(join(UI, "hud_screen.json"));
  assert.ok(JSON.stringify(hud.root_panel).includes("cobblemon_scanner.scan_overlay"), "fábrica do overlay do scanner no HUD");
  assert.ok(String(hud.hud_actionbar_text.visible).includes("'cbS'"), "actionbar vanilla esconde o payload do scanner");
}

/** Índices de célula por painel com `collection_name` (as células precisam ser filhas diretas). */
function cellIndices(node: unknown, out = new Set<number>(), path = ""): Set<number> {
  if (Array.isArray(node)) { node.forEach(n => cellIndices(n, out, path)); return out; }
  if (!node || typeof node !== "object") return out;
  const obj = node as Json;
  if (Array.isArray(obj.controls)) {
    for (const child of obj.controls) {
      for (const [key, value] of Object.entries(child as Json)) {
        if (value && typeof value === "object" && "collection_index" in value) {
          assert.equal(obj.collection_name, "form_buttons", `${path}/${key}: pai sem collection_name`);
          out.add((value as Json).collection_index);
          const bindings = JSON.stringify((value as Json).bindings);
          assert.ok(bindings.includes("#form_button_text"), `${key}: some quando o texto é vazio`);
        }
      }
    }
  }
  for (const [key, value] of Object.entries(obj)) if (key !== "bindings") cellIndices(value, out, `${path}/${key}`);
  return out;
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
function expectCells(node: unknown, expected: number[], what: string) {
  const got = cellIndices(node);
  for (const i of expected) assert.ok(got.has(i), `${what}: célula ${i}`);
}

{
  const battle = layouts["battle.json"];
  expectCells(battle.action_layout, range(BATTLE_ACTION.TILES, BATTLE_ACTION.COUNT), "batalha/menu");
  expectCells(battle.moves_layout, range(0, BATTLE_MOVES.COUNT), "batalha/golpes");
  expectCells(battle.target_layout, range(0, BATTLE_TARGET.COUNT), "batalha/alvo");
  expectCells(battle.switch_layout, range(0, BATTLE_SWITCH.COUNT), "batalha/troca");
  assert.equal(battle.bag_grid.collection_name, "form_buttons");
  const summary = layouts["summary.json"];
  expectCells(summary.canvas, range(0, SUMMARY.COUNT), "resumo");
  expectCells(summary.canvas_studio, range(0, SUMMARY.PARTY), "resumo/estúdio");
  expectCells(layouts["starter.json"].canvas, range(0, STARTER.COUNT), "inicial");
  expectCells(layouts["starter.json"].canvas_studio, range(0, STARTER.COUNT), "inicial/estúdio");
  const dex = layouts["pokedex.json"].pokedex_form;
  expectCells(dex, range(0, POKEDEX_LIST.COUNT), "pokédex/lista");
  expectCells(dex, range(0, POKEDEX_ENTRY.COUNT), "pokédex/entrada");
  const pc = layouts["pc.json"];
  expectCells(pc.pc_form, [PC.PREV, PC.BOX, PC.NEXT, ...range(PC.PARTY, 6), PC.PREVIEW, PC.PREVIEW_TEXT], "pc");
  expectCells(pc.pc_content, range(PC.SLOTS, 30), "pc/caixa");
  // Contrato da frente extras-final no pc.json.
  assert.equal(pc["scrolling_panel@common.scrolling_panel"]["$scrolling_content"], "pc.pc_content");
  assert.equal(pc.pc_content.controls[0].wallpaper.bindings[0].binding_name, "#form_text");
}

// ---------------------------------------------------------------------------------------------
// 3. Bindings e texturas

{
  const all = JSON.stringify(layouts);
  // Todo binding view lê uma #propriedade; nenhuma $variável dentro de expressão de binding.
  for (const m of all.matchAll(/"source_property_name":"([^"]*)"/g)) {
    assert.ok(m[1].includes("#"), `binding sem #propriedade: ${m[1]}`);
    assert.ok(!m[1].includes("$"), `variável em binding: ${m[1]}`);
  }
  // Toda célula clicável reporta o índice (collection_details).
  const hits = all.match(/"hit@common\.button"/g)?.length ?? 0;
  const details = all.match(/"binding_type":"collection_details"/g)?.length ?? 0;
  assert.ok(hits > 0 && details >= hits, `cliques com collection_details (${details}/${hits})`);
  // Tints: um por tipo, com a chave do tipo.
  assert.equal(Object.keys(TYPE_HUES).length, 18);
  for (const type of Object.keys(TYPE_HUES)) assert.ok(all.includes(`(#form_button_texture = '${typeKeyTexture(type)}')`), `tint ${type}`);
  // Texturas estáticas existem (quando o import já rodou).
  const exists = (path: string) => [RP, GEN_RP].some(base => existsSync(join(base, `${path}.png`)));
  if (existsSync(join(GEN_RP, "textures", "gui", "cobblemon"))) {
    const textures = new Set([...all.matchAll(/"texture":"(textures\/[^"]+)"/g)].map(m => m[1]));
    assert.ok(textures.size > 30);
    for (const texture of textures) assert.ok(exists(texture), `textura ${texture}`);
    for (const type of Object.keys(TYPE_HUES)) assert.ok(exists(typeKeyTexture(type)), `chave do tipo ${type} é textura real`);
    for (const kind of ["fight", "bag", "switch", "run", "forfeit"] as const) assert.ok(exists(battleMenuTexture(kind)));
    for (let px = 0; px <= 97; px += 13) assert.ok(exists(`textures/ui/cobblemon/hud/hp_h_${String(px).padStart(2, "0")}`));
    for (const tab of ["info", "moves", "stats", "marks"]) assert.ok(exists(`textures/gui/cobblemon/summary/summary_tab_icon_${tab}`));
    for (const color of ["red", "yellow", "green", "blue", "pink", "black", "white"]) assert.ok(exists(`textures/gui/cobblemon/pokedex/pokedex_base_${color}`));
  }
  assert.equal(barTexture(0, 10), "textures/ui/cobblemon/hud/hp_h_00");
  assert.equal(barTexture(1, 1000), "textures/ui/cobblemon/hud/hp_h_01", "HP > 0 nunca some da barra");
  assert.equal(barTexture(10, 10), "textures/ui/cobblemon/hud/hp_h_97");
  assert.equal(typeKeyTexture("nope"), typeKeyTexture("normal"));
}

// ---------------------------------------------------------------------------------------------
// 4. Montagem dos forms

{
  const form = new CellForm<string>(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_MOVES, "x"), 5).cell(0, "a", "tex", "A").cell(3, "d");
  assert.deepEqual(form.texts(), ["a", "", "", "d", ""], "buracos viram botões vazios (escondidos)");
  assert.deepEqual(form.icons(), ["tex", undefined, undefined, undefined, undefined]);
  assert.equal(form.actionAt(0), "A");
  assert.equal(form.actionAt(1), undefined);

  const pikachu = PokemonData.generateNewWildPokemon("pikachu", { level: 20, shiny: true });
  const info = buildSummaryForm(pikachu, { tab: "info", studio: false, studioToggle: true, party: [pikachu, null] });
  const texts = info.texts().map(t => JSON.stringify(t));
  assert.equal(info.texts().length, SUMMARY.COUNT);
  assert.ok(JSON.stringify(info.title).includes(SUB.SUMMARY_INFO) && !JSON.stringify(info.title).includes(SUB.STUDIO));
  assert.ok(info.icons()[SUMMARY.PORTRAIT]?.startsWith("textures/"), "perfil na janela do retrato");
  assert.ok(info.icons()[SUMMARY.TABS]?.endsWith("summary_tab_icon_info"));
  assert.ok(texts[SUMMARY.NAME].includes("cobblemon.species.pikachu.name"));
  assert.ok(info.icons()[SUMMARY.LEVEL]?.includes("/ball/"), "Poké Ball no cabeçalho");
  assert.deepEqual(info.actionAt(SUMMARY.TABS + 2), { kind: "tab", tab: "stats" });
  assert.deepEqual(info.actionAt(SUMMARY.PARTY), { kind: "party", slot: 0 });
  assert.equal(info.texts()[SUMMARY.PARTY + 1], "", "espaço vazio do time escondido");

  const stats = buildSummaryForm(pikachu, { tab: "stats", studio: true, studioToggle: true });
  assert.ok(JSON.stringify(stats.title).includes(SUB.STUDIO));
  assert.equal(stats.icons()[SUMMARY.PORTRAIT], undefined, "estúdio: janela vazada (sem perfil 2D)");
  for (let i = 0; i < 6; i++) assert.match(stats.icons()[SUMMARY.STAT_BARS + i] ?? "", /hp_h_\d\d$/);
  assert.ok(stats.icons().filter(x => x?.endsWith("hp_h_97")).length >= 1, "o maior atributo enche a barra");
  assert.deepEqual(stats.actionAt(SUMMARY.STUDIO), { kind: "studio" });

  const moves = buildSummaryForm(pikachu, { tab: "moves", studio: false, studioToggle: false });
  assert.equal(moves.texts()[SUMMARY.STUDIO], "", "sem espaço para o estúdio: sem botão 3D");
  pikachu.moves.slice(0, 4).forEach((_, i) => assert.ok(moves.icons()[SUMMARY.MOVES + i]?.includes("platform_base_"), "tile de golpe com a chave do tipo"));

  const categories = getStarterCategories();
  const starter = buildStarterForm(categories, { category: 0, position: 0, page: 0, studio: false, studioToggle: true });
  const starterTexts = starter.texts().map(t => JSON.stringify(t));
  assert.ok(starterTexts[STARTER.NAME].includes("cobblemon.species.bulbasaur.name"), "o nome do atual (e2e escolhe por ele)");
  assert.deepEqual(starter.actionAt(STARTER.NAME), { kind: "choose" });
  assert.ok(starterTexts[STARTER.CATEGORIES].includes("cobblemon.starterselection.category.kanto"));
  assert.ok(starter.icons()[STARTER.PLATFORM]?.endsWith("starter_platform_base_grass"));
  assert.ok(starter.icons()[STARTER.MODEL]?.startsWith("textures/"));
  assert.ok(starterTexts[STARTER.PREVIOUS].includes("squirtle") && starterTexts[STARTER.NEXT].includes("charmander"), "setas mostram os vizinhos");
  assert.equal(starter.texts()[STARTER.RANDOM], "", "Kanto não tem aleatório");
  // 11 categorias cabem sem "mais"; com 13, a 12ª linha vira "..." e a página anda.
  assert.equal(starter.texts()[STARTER.MORE], categories.length > STARTER.CATEGORY_SLOTS + 1 ? "§7..." : starter.texts()[STARTER.MORE]);
  const many = [...categories, ...categories.slice(0, 2)];
  const paged = buildStarterForm(many, { category: 12, position: 1, page: 11, studio: true, studioToggle: true });
  assert.deepEqual(paged.actionAt(STARTER.MORE), { kind: "more" });
  assert.deepEqual(paged.actionAt(STARTER.CATEGORIES), { kind: "category", index: 11 });
  assert.equal(paged.icons()[STARTER.MODEL], undefined, "estúdio: centro vazado");

  const disabled = JSON.stringify(renderMoveButton("thunderbolt", 0, 24, false, undefined, []));
  assert.ok(disabled.startsWith('{"rawtext":[{"text":"§8'), "golpe sem PP começa com §8 (e2e pula)");
  assert.ok(JSON.stringify(renderMoveButton("thunderbolt", 12, 24, false, undefined, [])).includes("§6"), "PP na metade em dourado");
}

// ---------------------------------------------------------------------------------------------
// 5. Estúdio e scanner (partes puras)

{
  const air = { isAir: true, typeId: "minecraft:air" } as any;
  const stone = { isAir: false, typeId: "minecraft:stone" } as any;
  const stage = findStage({ x: 10.3, y: 64, z: -3.7 }, 320, () => air);
  assert.deepEqual(stage, { x: 10.5, y: 112, z: -3.5 }, "48 blocos acima, centro do bloco");
  // Teto logo acima (Nether): sem estúdio.
  assert.equal(findStage({ x: 0, y: 110, z: 0 }, 128, () => air), undefined);
  assert.equal(findStage({ x: 0, y: 64, z: 0 }, 320, () => stone), undefined);
  // Pedra no primeiro andar tentado: tenta outro.
  const other = findStage({ x: 0, y: 64, z: 0 }, 320, loc => (loc.y >= 110 && loc.y < 118 ? stone : air));
  assert.ok(other && other.y !== 112);
  const small = cameraFor({ x: 0, y: 100, z: 0 }, 0.6, FRAMING.summary);
  const big = cameraFor({ x: 0, y: 100, z: 0 }, 3, FRAMING.summary);
  assert.ok(big.distance > small.distance, "modelo maior, câmera mais longe");
  assert.ok(small.location.z > 0 && small.facing.y < small.location.y, "câmera ao sul mirando abaixo do centro (modelo acima do centro)");
  assert.ok(cameraFor({ x: 0, y: 100, z: 0 }, 50, FRAMING.starter).distance <= 9, "distância limitada à área conferida");

  assert.equal(zoomStepAfterSlotChange(1, 3, 4), 2);
  assert.equal(zoomStepAfterSlotChange(1, 0, 8), 0, "8 → 0 com volta conta como -1");
  assert.equal(zoomStepAfterSlotChange(ZOOM_FOVS.length - 1, 2, 3), ZOOM_FOVS.length - 1);
  assert.deepEqual(scanOverlayMessage("x"), { rawtext: [{ text: "cbS" }, { text: "x" }] });
  assert.ok(ZOOM_FOVS.every((fov, i) => i === 0 || fov < ZOOM_FOVS[i - 1]));
  assert.ok(BLANK.length > 0);
}

// ---------------------------------------------------------------------------------------------
// 6. Textos novos nas duas línguas

{
  const en = readFileSync(join(RP, "texts", "en_US.lang"), "utf8");
  const pt = readFileSync(join(RP, "texts", "pt_BR.lang"), "utf8");
  for (const lang of [en, pt]) {
    assert.ok(lang.includes("\n## telas"), "seção da frente");
    assert.ok(lang.includes("\ncobblemon.port.pokedex.scan_aim="));
  }
}

console.log("telas: ok");
