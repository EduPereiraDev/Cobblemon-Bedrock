// Frente ui-polish (4º teste em cliente real, beta 5): estados de botão, HUD do time, prévia do PC, gráfico de atributos,
// plataforma do inicial em 3D e as telas custom do Java (desistir, diálogo, Pokédex sem lista de regiões, ícones da
// mochila). A regra de "rótulo em todos os estados" das telas roteadas fica em tests/ui-layout.test.ts.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formHooks, formRecording } from "./mocks/minecraft-server-ui";
import { createPlayer } from "./batalhas-harness";
import { PokemonData } from "../scripts/Pokemon";
import { parseUiFile } from "../tools/ui/layoutScene.mjs";
import {
  BATTLE_FORFEIT, DIALOGUE, DIALOGUE_DISABLED_MARKER, PC, POKEDEX_LIST, RADAR_HEXAGON, RADAR_PENTAGON, RADAR_STEPS, STAT_FILL_MARKERS, SUB, SUMMARY,
  STARTER, radarSectorBox, radarStep, radarTextures,
} from "../scripts/GUI/layoutSpec";
import { SCREEN, ROUTED_SCREENS } from "../scripts/ui/screens";
import { buildSummaryForm, statModesOf } from "../scripts/GUI/Summary";
import { buildStarterForm, getStarterCategories, starterStudioSubject } from "../scripts/GUI/StarterGUI";
import { appendPreviewButtons } from "../scripts/GUI/PC";
import { bagItemIcon, forfeitForm } from "../scripts/GUI/Battle";
import { BAG_ITEMS } from "../scripts/battle/BagItems";
import { buildDialogueForm, dialogueFaceCell } from "../scripts/npc/dialogue/DialogueManager";
import { parseFace } from "../scripts/npc/dialogue/ActiveDialogue";
import type { RenderedPage } from "../scripts/npc/dialogue/ActiveDialogue";
import { FRAMING, PLATFORM_TYPES, PLATFORM_WIDTH_PX, cameraFor, platformIndex, platformScale } from "../scripts/ui/studio/Studio";
import { neighbourDex, openPokedex } from "../scripts/pokedex/PokedexUI";
import { getDexes } from "../scripts/pokedex/DexData";
import { ActionFormData } from "@minecraft/server-ui";

const ROOT = process.cwd();
const UI = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const hasGenerated = existsSync(join(GEN_RP, "textures", "gui", "cobblemon"));
let checks = 0;
const test = (name: string, fn: () => void | Promise<void>) => ({ name, fn });
const tests = [
  // 1/2. Estados de botão: todo `hit` fica ABAIXO do conteúdo (camada 3) e os controles de estado na camada 0 dele.
  test("botões sob o conteúdo em todas as telas geradas", () => {
    let hits = 0;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key.startsWith("hit@common.button")) {
          const hit = value as { layer: number; controls: Record<string, { layer?: number }>[] };
          hits++;
          assert.equal(hit.layer, 3, `${key}: camada do botão`);
          for (const control of hit.controls) {
            const [state, def] = Object.entries(control)[0];
            if (state !== "default") assert.equal(def.layer, 0, `${key}/${state}: estado na camada 0 (sob o rótulo)`);
          }
        }
        walk(value);
      }
    };
    for (const file of ["battle.json", "summary.json", "starter.json", "pokedex.json", "pc.json", "dialogue.json"]) walk(parseUiFile(readFileSync(join(UI, file), "utf8")));
    assert.ok(hits > 100, `botões conferidos (${hits})`);
  }),

  // 3. HUD: espaço vazio (k = 'e') só mostra o party_slot_collapsed (sem o fundo do retrato nem o "Nv.").
  test("HUD do time: conteúdo do espaço vazio escondido", () => {
    const hud = JSON.parse(readFileSync(join(UI, "cobblemon_hud.json"), "utf8").split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n"));
    for (let i = 0; i < 6; i++) {
      const slot = hud[`party_slot_${i}`];
      const row = slot.controls.find((c: Record<string, unknown>) => c.content_row).content_row;
      const content = row.controls.find((c: Record<string, unknown>) => c.content).content;
      assert.ok(content.bindings.some((b: { source_property_name: string }) => b.source_property_name === "(not (#k = 'e'))"), `espaço ${i}`);
      assert.ok(slot.controls.some((c: Record<string, unknown>) => c.bg_collapsed), "moldura recolhida continua");
    }
  }),

  // 4. PC: a prévia do painel da esquerda tem todas as células (o selftest usa a mesma função).
  test("PC: prévia completa", () => {
    const pikachu = PokemonData.generateNewWildPokemon("pikachu", { level: 12 });
    formRecording.enabled = true;
    formRecording.forms.length = 0;
    const form = new ActionFormData();
    for (let i = 0; i < PC.PREVIEW; i++) form.button("");
    appendPreviewButtons(form, pikachu, 0);
    const buttons = formRecording.forms.at(-1)!.calls.filter(([n]) => n === "button");
    formRecording.enabled = false;
    assert.equal(buttons.length, PC.COUNT, "até PREVIEW_PAGE");
    const text = (i: number) => JSON.stringify(buttons[i][1][0]);
    assert.ok(text(PC.PREVIEW_NAME).includes("pikachu"), "nome");
    assert.ok(text(PC.PREVIEW_LEVEL).includes("cobblemon.label.lv"), "nível");
    assert.ok(text(PC.PREVIEW_NATURE).includes("nature") || text(PC.PREVIEW_NATURE).length > 4, "natureza");
    assert.ok(text(PC.PREVIEW_MOVES).includes("cobblemon.move."), "golpes");
    assert.equal(buttons[PC.PREVIEW_TYPES][1][1], "textures/gui/cobblemon/pokedex/platform_base_electric", "tipo");
    const selftest = readFileSync(join(ROOT, "scripts", "debug", "SelfTest.ts"), "utf8");
    assert.ok(selftest.includes("appendPreviewButtons(form, team[0], 0)"), "o selftest monta a mesma prévia");
  }),

  // 5. Gráfico de atributos (StatWidget).
  test("gráfico hexagonal/pentágono: passos, caixas e texturas", () => {
    assert.equal(radarStep(RADAR_HEXAGON, 1), RADAR_STEPS);
    assert.equal(radarStep(RADAR_HEXAGON, 0), 1, "mínimo 5/raio como o coerceIn do Java");
    assert.deepEqual(radarTextures(RADAR_HEXAGON, [1, 1, 1, 1, 1, 1]).map(t => t.split("/").pop()), ["h0_10_10", "h1_10_10", "h2_10_10", "h3_10_10", "h4_10_10", "h5_10_10"]);
    assert.equal(radarTextures(RADAR_PENTAGON, [0.5, 0.5, 0.5, 0.5, 0.5]).length, 5);
    for (let k = 0; k < 6; k++) {
      const [x, y, w, h] = radarSectorBox(RADAR_HEXAGON, k);
      assert.ok(x >= 20 && y >= 20 && x + w <= 114 && y + h <= 120 && w <= 42 && h <= 48, `caixa do setor ${k}`);
    }
    if (hasGenerated) {
      const dir = join(GEN_RP, "textures", "gui", "cobblemon", "summary", "radar");
      const files = readdirSync(dir);
      assert.equal(files.filter(f => /^h\d_/.test(f)).length, 6 * RADAR_STEPS * RADAR_STEPS, "hexágono");
      assert.equal(files.filter(f => /^p\d_/.test(f)).length, 5 * RADAR_STEPS * RADAR_STEPS, "pentágono");
      assert.ok(files.includes("fill_0.png") && files.includes("fill_110.png"), "barras do modo Outro");
    }
    const pikachu = PokemonData.generateNewWildPokemon("pikachu", { level: 30 });
    assert.deepEqual(statModesOf(pikachu), ["stats", "ivs", "evs", "other"], "sem montaria: 4 modos");
    const stats = buildSummaryForm(pikachu, { tab: "stats", studio: false, studioToggle: false, statsMode: "ivs" });
    assert.equal(stats.texts()[SUMMARY.STAT_BARS], "ivs", "setor com a cor dos IVs");
    assert.ok(JSON.stringify(stats.texts()[SUMMARY.STAT_TABS + 1]).includes("§1§7§r"), "IVs realçado na barra de modos");
    const other = buildSummaryForm(pikachu, { tab: "stats", studio: false, studioToggle: false, statsMode: "other" });
    assert.ok(JSON.stringify(other.title).includes(SUB.SUMMARY_STATS_OTHER), "título com o modo Outro");
    assert.ok(JSON.stringify(other.texts()[SUMMARY.STAT_ROWS]).includes(STAT_FILL_MARKERS.friendship.slice(0, 4)), "amizade pintada de rosa");
    assert.match(other.icons()[SUMMARY.STAT_ROWS] ?? "", /radar\/fill_\d+$/);
    const aero = PokemonData.generateNewWildPokemon("aerodactyl", { level: 40 });
    assert.equal(statModesOf(aero).length, 5, "com montaria: 5 modos");
    const ride = buildSummaryForm(aero, { tab: "stats", studio: false, studioToggle: false, statsMode: "ride", statsPage: "AIR" });
    const title = JSON.stringify(ride.title);
    assert.ok(title.includes(SUB.SUMMARY_STATS_RIDE) && title.includes(SUB.SUMMARY_STATS_RIDE_TAB), "pentágono e barra de 5");
    assert.equal(ride.texts()[SUMMARY.STAT_BARS], "air", "cor do estilo aéreo");
    assert.deepEqual(ride.actionAt(SUMMARY.STAT_ROWS + 5), { kind: "rideStyle" }, "ícone do centro troca o estilo");
  }),

  // Plataforma do inicial em 3D: entidade no mundo sob o modelo, nada no form.
  test("inicial 3D: plataforma no mundo, não na UI", () => {
    const categories = getStarterCategories();
    const studio = buildStarterForm(categories, { category: 0, position: 1, page: 0, studio: true, studioToggle: true });
    assert.equal(studio.icons()[STARTER.PLATFORM], undefined, "3D: sem a imagem da plataforma por cima do modelo");
    const flat = buildStarterForm(categories, { category: 0, position: 1, page: 0, studio: false, studioToggle: true });
    assert.ok(flat.icons()[STARTER.PLATFORM]?.endsWith("starter_platform_base_fire"), "2D: plataforma atrás do retrato");
    assert.deepEqual(starterStudioSubject(categories[0].pokemon[1]), { species: "charmander", platformType: "fire" });
    assert.equal(platformIndex("fire"), PLATFORM_TYPES.indexOf("fire"));
    assert.equal(platformIndex("???"), 0);
    const camera = cameraFor({ x: 0.5, y: 100, z: 0.5 }, { height: 1.2 }, FRAMING.starter);
    assert.ok(camera.perBlock > 0);
    assert.ok(Math.abs(platformScale(camera.perBlock) * camera.perBlock - PLATFORM_WIDTH_PX) < 1e-6, "113 px da UI na distância do modelo");
    const bp = JSON.parse(readFileSync(join(ROOT, "behavior_packs", "CobblemonBedrock", "entities", "studio", "studio_platform.json"), "utf8"));
    assert.equal(bp["minecraft:entity"].description.identifier, "cobblemon:studio_platform");
    assert.equal(bp["minecraft:entity"].description.properties["cobblemon:platform"].range[1], PLATFORM_TYPES.length - 1);
    assert.equal(bp["minecraft:entity"].components["minecraft:physics"].has_collision, false);
    const rp = JSON.parse(readFileSync(join(ROOT, "resource_packs", "CobblemonBedrock", "entity", "studio", "studio_platform.entity.json"), "utf8"));
    assert.deepEqual(Object.keys(rp["minecraft:client_entity"].description.textures), [...PLATFORM_TYPES], "uma textura por tipo, na ordem");
    const geo = JSON.parse(readFileSync(join(ROOT, "resource_packs", "CobblemonBedrock", "models", "entity", "studio", "studio_platform.geo.json"), "utf8"));
    assert.deepEqual(Object.keys(geo["minecraft:geometry"][0].bones[0].cubes[0].uv), ["up"], "só a face de cima (sem z-fighting)");
    if (hasGenerated) for (const type of PLATFORM_TYPES) assert.ok(existsSync(join(GEN_RP, "textures", "gui", "cobblemon", "starterselection", `starter_platform_base_${type}.png`)), type);
  }),

  // 6. Desistir dentro da batalha.
  test("batalha: desistir no layout da batalha", () => {
    const form = forfeitForm();
    assert.ok(JSON.stringify(form.title).includes(SCREEN.BATTLE) && JSON.stringify(form.title).includes(SUB.BATTLE_FORFEIT));
    assert.equal(form.actionAt(BATTLE_FORFEIT.ACCEPT), true);
    assert.equal(form.actionAt(BATTLE_FORFEIT.DECLINE), false);
    assert.equal(form.texts().length, BATTLE_FORFEIT.COUNT);
    const battle = parseUiFile(readFileSync(join(UI, "battle.json"), "utf8"));
    assert.ok(battle.forfeit_layout, "layout da desistência");
  }),

  // 6. Mochila: ícone de cada item de batalha existe no RP.
  test("mochila: ícones dos itens", () => {
    const defs = [...BAG_ITEMS.values()];
    assert.ok(defs.length >= 20, `itens (${defs.length})`);
    for (const def of defs) {
      const icon = bagItemIcon(def.typeId);
      assert.match(icon, /^textures\/item\//);
      if (hasGenerated) assert.ok(existsSync(join(GEN_RP, `${icon}.png`)), `${def.typeId} → ${icon}`);
    }
  }),

  // 6. Diálogo (DialogueScreen).
  test("diálogo: roteado, opções na ordem e retrato", () => {
    assert.ok(ROUTED_SCREENS.includes(SCREEN.DIALOGUE));
    assert.deepEqual(parseFace("q.player.face(true);"), { kind: "player", left: true });
    assert.deepEqual(parseFace("q.npc.face(false)"), { kind: "npc", left: false });
    assert.deepEqual(parseFace({ type: "artificial", modelType: "pokemon", identifier: "cobblemon:pikachu", isLeftSide: false }), { kind: "pokemon", species: "pikachu", left: false });
    assert.equal(dialogueFaceCell({ kind: "npc", left: true }), undefined, "NPC sem skin conhecida: sem retrato");
    const page = (extra: Partial<RenderedPage>): RenderedPage => ({ pageId: "p", inputId: 1, lines: [{ text: "Oi" }], input: "none", options: [], vertical: false, allowSkip: true, textLength: 2, ...extra });
    const record = (build: () => ActionFormData) => {
      formRecording.enabled = true;
      formRecording.forms.length = 0;
      build();
      const form = formRecording.forms.at(-1)!;
      formRecording.enabled = false;
      return { title: JSON.stringify(form.calls.find(([n]) => n === "title")![1][0]), buttons: form.calls.filter(([n]) => n === "button").map(([, a]) => a) };
    };
    const cont = record(() => buildDialogueForm(page({ face: { kind: "player", left: true } })).form);
    assert.ok(cont.title.includes(SCREEN.DIALOGUE) && cont.title.includes(SUB.DIALOGUE_CONTINUE));
    assert.ok(JSON.stringify(cont.buttons[0][0]).includes("cobblemon.port.dialogue.continue"), "Continuar é o botão 0");
    assert.equal(cont.buttons.length, DIALOGUE.COUNT, "vazias até o retrato");
    assert.deepEqual(cont.buttons[DIALOGUE.PORTRAIT], ["left_skin", "textures/entity/steve"]);
    const options = [{ text: { text: "Yes" }, value: "yes", selectable: true }, { text: { text: "No" }, value: "no", selectable: false }];
    let values: string[] = [];
    const rec = record(() => {
      const built = buildDialogueForm(page({ input: "option", options, face: { kind: "pokemon", species: "pikachu", left: false } }));
      values = built.values;
      return built.form;
    });
    assert.deepEqual(values, ["yes", "no"], "opções na ordem (os bots respondem pelo índice)");
    assert.ok(rec.title.includes(SUB.DIALOGUE_H2), "2 opções lado a lado");
    assert.ok(JSON.stringify(rec.buttons[1][0]).includes(DIALOGUE_DISABLED_MARKER), "opção apagada");
    assert.equal(rec.buttons[DIALOGUE.PORTRAIT][0], "right_pokemon");
    const vertical = record(() => buildDialogueForm(page({ input: "option", options, vertical: true })).form);
    assert.ok(vertical.title.includes(SUB.DIALOGUE_VERTICAL));
    assert.equal(vertical.buttons.length, 2, "sem rosto: só as opções");
    const five = record(() => buildDialogueForm(page({ input: "option", options: [...options, ...options, options[0]] })).form);
    assert.ok(five.title.includes(SUB.DIALOGUE_VERTICAL), "mais de 4: em coluna");
    const npc = readFileSync(join(ROOT, "scripts", "npc", "NPCEntity.ts"), "utf8");
    assert.ok(npc.includes("npcSkin: npcSkinTexture(npc.entity)"), "o NPC manda a skin para o retrato");
  }),

  // 6. Pokédex: abre na grade (sem a lista de regiões) e as setas trocam a região.
  test("Pokédex: grade direto e setas de região", async () => {
    const dexes = getDexes();
    assert.ok(dexes.length > 1);
    assert.equal(neighbourDex(dexes[0].id, 1), dexes[1].id);
    assert.equal(neighbourDex(dexes[0].id, -1), dexes[dexes.length - 1].id, "dá a volta");
    const player = createPlayer("DexPolish", [PokemonData.generateNewWildPokemon("pikachu", { level: 5 })] as never);
    let shown: { calls: [string, unknown[]][] } | undefined;
    formRecording.enabled = true;
    formHooks.show = (_kind, form) => { shown ??= form as never; return { canceled: true, selection: undefined, cancelationReason: "UserClosed" }; };
    try { await openPokedex(player as never); } finally { formHooks.show = undefined; formRecording.enabled = false; }
    assert.ok(shown, "abriu um form");
    const title = JSON.stringify(shown!.calls.find(([n]) => n === "title")![1][0]);
    assert.ok(title.includes(SCREEN.POKEDEX) && title.includes(SUB.POKEDEX_LIST), `grade da Pokédex (${title})`);
    const buttons = shown!.calls.filter(([n]) => n === "button");
    assert.equal(buttons.length, POKEDEX_LIST.COUNT);
    assert.ok(JSON.stringify(buttons[POKEDEX_LIST.REGION_NEXT][1][0]).includes(`cobblemon.ui.pokedex.region.`), "seta da próxima região");
    assert.equal(JSON.stringify(buttons[POKEDEX_LIST.BACK][1][0]), '""', "sem 'Voltar' para a lista de regiões");
  }),
];

for (const t of tests) {
  try { await t.fn(); checks++; }
  catch (e) { console.error(`✗ ${t.name}`); throw e; }
}
console.log(`ui-polish: ${checks} testes ok`);
process.exit(0);
