// Frente "ui-base": protocolo do HUD (codificação + decodificação simulando as expressões do JSON UI gerado),
// HudBus, marcadores de tela, glifos, seleção da party e motor das conquistas.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  BATTLE_HEAD_FIELDS, BATTLE_MOVE_FIELDS, BATTLE_MOVES, BATTLE_TILE_FIELDS, CHANNEL, HEADER_BYTES, PARTY_FIELDS, PARTY_SLOTS, TOAST_FIELDS, battleHpText, barPixels,
  depletableColor, encodeBattleBody, encodePartyBody, encodeToastBody, fixed, header, padNumber, recordBytes, utf8Length,
} from "../scripts/ui/hudProtocol";
import { HudState } from "../scripts/ui/HudBus";
import { ROUTED_SCREENS, SCREEN, screenOf, withScreen } from "../scripts/ui/screens";
import {
  CATEGORY_GLYPHS, GLYPH_BALLS, GLYPH_TYPES, TYPE_GLYPHS, ballGlyph, categoryGlyph, glyphSources, typeGlyph,
} from "../scripts/ui/glyphs";
import { checkSelection, shiftSelection } from "../scripts/ui/PartySelection";
import { advancementToast } from "../scripts/ui/Toast";
import {
  AchievementEvent, applyEvent, criterionMatches, emptyAchievements, isVisible, parseAchievements, progressOf,
} from "../scripts/ui/achievements/engine";
import { ADVANCEMENTS } from "../generated/scripts/advancements";
import { typeSymbols } from "../scripts/language";
import { portraitPath, setPortraitResolver } from "../scripts/ui/portraits";

const ROOT = process.cwd();
const UI = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");
/** JSON com comentários (como o Bedrock aceita). */
const readJsonc = (file: string) => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));

// ---------------------------------------------------------------------------------------------
// 1. Larguras em bytes

{
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length(""), 3, "glifo = 3 bytes");
  assert.equal(utf8Length("😀"), 4);
  assert.equal(fixed("Pikachu", 10), "Pikachu\t\t\t");
  assert.equal(utf8Length(fixed("Flabébé", 7)), 7);
  assert.equal(fixed("Flabébé", 8), "Flabéb\t", "não corta o último é ao meio: 'Flabéb' = 7 bytes, sobra 1 tab");
  assert.equal(fixed("a\tb\nc", 5), "abc\t\t", "remove caracteres de controle");
  assert.equal(fixed("", 5), "\t\t");
  assert.equal(fixed(undefined, 2), "\t\t");
  assert.equal(padNumber(7, 2), "07");
  assert.equal(padNumber(123, 2), "99");
  assert.equal(padNumber(-3, 2), "00");
  assert.equal(barPixels(0, 18), 0);
  assert.equal(barPixels(0.001, 18), 1, "HP > 0 mostra pelo menos 1 px");
  assert.equal(barPixels(1, 97), 97);
  assert.equal(battleHpText(35, 40, true), "35/40");
  assert.equal(battleHpText(35, 40, false), "88%", "percentual arredondado para cima (ceil)");
  const [r, g] = depletableColor(1);
  assert.ok(r < 0.01 && g > 0.79, "HP cheio = verde");
  assert.deepEqual(depletableColor(0.1).slice(0, 2), [0.8, 0], "HP baixo = vermelho");
}

// ---------------------------------------------------------------------------------------------
// 2. Decodificação: interpreta as expressões do cobblemon_hud.json gerado sobre o título codificado

/** Primeiros N bytes UTF-8 (o '%.Ns' do JSON UI). */
function prefixBytes(s: string, n: number): string {
  return Buffer.from(s, "utf8").subarray(0, n).toString("utf8");
}

/** Avalia os bindings de fatia de um painel (padrões gerados por tools/ui/gen-hud.ts). */
function evalRecord(bindings: any[], preserved: string): Record<string, string> {
  const props: Record<string, string> = { "#preserved": preserved };
  for (const b of bindings) {
    if (b.binding_type !== "view") continue;
    const src: string = b.source_property_name;
    let value: string | undefined;
    let m: RegExpMatchArray | null;
    if (src === "#preserved") value = props["#preserved"];
    else if ((m = src.match(/^\(#p - \('%\.(\d+)s' \* #p\)\)$/))) value = props["#p"].split(prefixBytes(props["#p"], Number(m[1]))).join("");
    else if ((m = src.match(/^\(\('%\.(\d+)s' \* (#r_\w+)\) - '\t'\)$/))) value = prefixBytes(props[m[2]], Number(m[1])).split("\t").join("");
    if (value !== undefined) props[b.target_property_name] = value;
  }
  return props;
}

const hud = readJsonc(join(UI, "cobblemon_hud.json"));
{
  // Party: 2 slots ocupados (um selecionado, com acento no apelido), 1 vazio.
  const body = encodePartyBody([
    { kind: "a", texture: "textures/sprites/flabebe", name: "Flabébé", level: 5, hpRatio: 1, expRatio: 0.5, status: "brn", gender: "f", ball: "poke_ball", popup: "e" },
    { kind: "f", texture: "textures/sprites/mr-mime", name: "Mr. Mime", level: 100, hpRatio: 0, gender: "m", ball: "ultra_ball" },
    { kind: "e" },
  ]);
  assert.equal(utf8Length(body), PARTY_SLOTS * recordBytes(PARTY_FIELDS));
  const title = header(CHANNEL.PARTY, 3) + body;
  assert.equal(title.slice(0, 5), "cbHP3");
  const s0 = evalRecord(hud.party_slot_0.bindings, title);
  assert.equal(s0["#k"], "a");
  assert.equal(s0["#tex"], "sprites/flabebe");
  assert.equal(s0["#name"], "Flabébé");
  assert.equal(s0["#lvl"], "5");
  assert.equal(s0["#hp"], "18");
  assert.equal(s0["#exp"], "09");
  assert.equal(s0["#st"], "brn");
  assert.equal(s0["#g"], "f");
  assert.equal(s0["#ball"], "poke_ball");
  assert.equal(s0["#pop"], "e");
  const s1 = evalRecord(hud.party_slot_1.bindings, title);
  assert.equal(s1["#k"], "f");
  assert.equal(s1["#name"], "Mr. Mime");
  assert.equal(s1["#lvl"], "100");
  assert.equal(s1["#hp"], "00");
  assert.equal(s1["#st"], "");
  assert.equal(evalRecord(hud.party_slot_2.bindings, title)["#k"], "e");
  assert.equal(evalRecord(hud.party_slot_5.bindings, title)["#k"], "-");
  // Receptor aceita só o próprio canal.
  const rx = hud.root.controls.find((c: any) => c.cbhud_party_rx).cbhud_party_rx;
  assert.match(rx.bindings[2].source_property_name, /'cbHP'/);
}
{
  // Batalha: 2 caixas à esquerda (duplas), 1 à direita.
  const tile = (name: string, hp: number) => ({ texture: "textures/sprites/pikachu", name, level: 50, hpRatio: hp, hpText: battleHpText(hp * 100, 100, true), status: "par", gender: "m" as const, owned: true });
  const body = encodeBattleBody({ slotsPerActor: 2, leftActor: "Ash", rightActor: "Gary", left: [tile("Pikachu", 0.5), tile("Eevee", 1)], right: [tile("Onix", 0.1)] });
  // Frente batalha-minimizavel: + 4 registros de golpe (menu do modo `hud`) no fim do corpo.
  assert.equal(utf8Length(body), recordBytes(BATTLE_HEAD_FIELDS) + 6 * recordBytes(BATTLE_TILE_FIELDS) + BATTLE_MOVES * recordBytes(BATTLE_MOVE_FIELDS));
  const title = header(CHANNEL.BATTLE, 1) + body;
  const head = evalRecord(hud.battle_overlay.controls[0].cbhud_battle_head.bindings, title);
  assert.equal(head["#n"], "2");
  assert.equal(head["#la"], "Ash");
  assert.equal(head["#ra"], "Gary");
  const l1 = evalRecord(hud.battle_tile_l1.controls.find((c: any) => c.cbhud_btl1).cbhud_btl1.bindings, title);
  assert.equal(l1["#v"], "1");
  assert.equal(l1["#name"], "Eevee");
  assert.equal(l1["#hpw"], "97");
  assert.equal(l1["#hpt"], "100/100");
  const r0 = evalRecord(hud.battle_tile_r0.controls.find((c: any) => c.cbhud_btr0).cbhud_btr0.bindings, title);
  assert.equal(r0["#name"], "Onix");
  assert.equal(r0["#hpw"], "10");
  assert.equal(r0["#own"], "1");
  assert.equal(evalRecord(hud.battle_tile_r1.controls.find((c: any) => c.cbhud_btr1).cbhud_btr1.bindings, title)["#v"], "0");
  // Recuo por posição: rank 0 tem 2 espaçadores, rank 2 nenhum.
  assert.equal(hud.battle_tile_l0.controls.length, 3);
  assert.equal(hud.battle_tile_l2.controls.length, 1);
}
{
  const body = encodeToastBody(advancementToast("challenge", "advancements.cobblemon.catch_alpha_wailord", "textures/sprites/wailord"));
  assert.equal(utf8Length(body), recordBytes(TOAST_FIELDS));
  const t = evalRecord(hud.toast.bindings, header(CHANNEL.TOAST, 0) + body);
  assert.equal(t["#v"], "1");
  assert.equal(t["#frame"], "c");
  assert.equal(t["#color"], "p");
  assert.equal(t["#l1"], "cobblemon.port.advancement.toast.challenge");
  assert.equal(t["#l2"], "advancements.cobblemon.catch_alpha_wailord");
  assert.equal(t["#icon"], "sprites/wailord");
  assert.equal(evalRecord(hud.toast.bindings, header(CHANNEL.TOAST, 1) + encodeToastBody(undefined))["#v"], "0");
}
{
  // O arquivo versionado bate com o gerador.
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "tools/ui/gen-hud.ts", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, `gen-hud --check: ${run.stderr}`);
  // hud_screen.json esconde o título vanilla quando o payload é nosso e insere o HUD sem redeclarar o root_panel.
  const hudScreen = readJsonc(join(UI, "hud_screen.json"));
  assert.ok(hudScreen.root_panel.modifications, "root_panel só com modifications");
  assert.match(hudScreen.hud_title_text.bindings[1].source_property_name, /'cbH'/);
  assert.equal(HEADER_BYTES, 5);
}

// ---------------------------------------------------------------------------------------------
// 3. HudBus: um título por vez, prioridade batalha > toast > party, só reenvia o que mudou

{
  const state = new HudState();
  state.set(CHANNEL.PARTY, "p");
  state.set(CHANNEL.BATTLE, "b");
  state.set(CHANNEL.TOAST, "t");
  assert.equal(state.next()?.slice(0, 4), "cbHB");
  assert.equal(state.next()?.slice(0, 4), "cbHT");
  assert.equal(state.next()?.slice(0, 4), "cbHP");
  assert.equal(state.next(), undefined, "nada mudou");
  state.set(CHANNEL.PARTY, "p");
  assert.equal(state.next(), undefined, "mesmo corpo não reenvia");
  state.set(CHANNEL.PARTY, "p2");
  assert.equal(state.next(), `${header(CHANNEL.PARTY, 2)}p2`);
  state.invalidate();
  assert.equal(state.next()?.slice(0, 4), "cbHB", "invalidate reenvia tudo, batalha primeiro");
  assert.equal(state.next()?.slice(0, 4), "cbHT");
  assert.equal(state.next(), `${header(CHANNEL.PARTY, 3)}p2`);
  const seqs = new Set<string>();
  const s2 = new HudState();
  for (let i = 0; i < 5; i++) { s2.set(CHANNEL.PARTY, `v${i}`); seqs.add(s2.next()![4]); }
  assert.equal(seqs.size, 5, "a sequência muda a cada envio");
}

// ---------------------------------------------------------------------------------------------
// 4. Marcadores de tela e roteamento do JSON UI

{
  const markers = Object.values(SCREEN);
  assert.equal(new Set(markers).size, markers.length, "marcadores únicos");
  for (const m of markers) assert.match(m, /^(§[0-9a-f]){2}§r$/, `marcador só com códigos de cor: ${m}`);
  assert.deepEqual(withScreen(SCREEN.PC, "PC - Box 1"), { rawtext: [{ text: "§0§1§r" }, { text: "PC - Box 1" }] });
  assert.equal(screenOf("§0§2§rFight"), SCREEN.BATTLE);
  assert.equal(screenOf("PCgamer"), undefined, "nome de jogador com 'PC' não vira tela do PC");
  const serverForm = readJsonc(join(UI, "server_form.json"));
  assert.ok(!("long_form_conditional" in serverForm), "sem redeclarar o long_form vanilla");
  assert.ok(serverForm.main_screen_content.modifications, "main_screen_content só com modifications");
  const hide = serverForm.long_form.modifications[0].value[1].source_property_name as string;
  for (const m of ROUTED_SCREENS) assert.ok(hide.includes(m), `long_form vanilla some para ${m}`);
  for (const m of markers.filter(x => !ROUTED_SCREENS.includes(x))) assert.ok(!hide.includes(m), `sem layout: ${m} usa o long_form vanilla`);
  const router = JSON.stringify(readJsonc(join(UI, "cobblemon_forms.json")).router);
  for (const m of ROUTED_SCREENS) assert.ok(router.includes(m), `roteador tem layout para ${m}`);
  assert.ok(!router.includes("'PC'") && !router.includes("Battle:"), "nada de substring visível no roteamento");
  const defs = readJsonc(join(UI, "_ui_defs.json")).ui_defs as string[];
  for (const f of ["ui/cobblemon_hud.json", "ui/cobblemon_forms.json", "ui/pc.json", "ui/battle.json"]) assert.ok(defs.includes(f), `_ui_defs: ${f}`);
  // Todo JSON da pasta ui é válido (com comentários).
  for (const f of readdirSync(UI).filter(f => f.endsWith(".json"))) readJsonc(join(UI, f));
}

// ---------------------------------------------------------------------------------------------
// 5. Glifos fora da página E0

{
  const sources = glyphSources();
  assert.equal(new Set(sources.map(s => s.code)).size, sources.length, "code points únicos");
  for (const s of sources) assert.ok(s.code >> 8 === 0xe2 || s.code >> 8 === 0xe3, `página própria: ${s.code.toString(16)}`);
  assert.equal(GLYPH_TYPES.length, 18);
  assert.equal(typeGlyph("fire"), "");
  assert.equal(typeGlyph("FAIRY"), "");
  assert.equal(categoryGlyph("Physical"), "");
  assert.equal(categoryGlyph("status"), "");
  assert.equal(ballGlyph("cobblemon:poke_ball"), String.fromCharCode(0xe300 + GLYPH_BALLS.indexOf("poke_ball")));
  assert.equal(ballGlyph("nope"), "");
  assert.equal(TYPE_GLYPHS.water, "");
  assert.equal(CATEGORY_GLYPHS.Special, "");
  assert.equal(typeSymbols.grass, "", "language/typeSymbols usa a página E2");
  for (const file of ["scripts/language/index.ts", "scripts/GUI/Battle.ts"]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    assert.ok(![...text].some(ch => ch.charCodeAt(0) >> 8 === 0xe0), `${file} sem glifos da página E0`);
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Slot selecionado (ClientStorageManager.shiftSelected / checkSelectedPokemon)

{
  const party = ["a", null, "c", null, null, "f"];
  assert.deepEqual(shiftSelection(party, { slot: 0, uuid: "a" }, true), { slot: 2, uuid: "c" });
  assert.deepEqual(shiftSelection(party, { slot: 5, uuid: "f" }, true), { slot: 0, uuid: "a" }, "dá a volta");
  assert.deepEqual(shiftSelection(party, { slot: 0, uuid: "a" }, false), { slot: 5, uuid: "f" });
  assert.deepEqual(shiftSelection([null, null], { slot: 1 }, true), { slot: 0 });
  assert.deepEqual(checkSelection(party, { slot: -1 }), { slot: 0, uuid: "a" });
  assert.deepEqual(checkSelection(["c", "a"], { slot: 0, uuid: "a" }), { slot: 1, uuid: "a" }, "segue o UUID");
  assert.deepEqual(checkSelection(["x", "y"], { slot: 1, uuid: "gone" }), { slot: 0, uuid: "x" });
  assert.deepEqual(checkSelection([null], { slot: 0 }), { slot: -1 });
}

// ---------------------------------------------------------------------------------------------
// 7. Conquistas

{
  assert.equal(ADVANCEMENTS.length, 61, "61 advancements não-receita do Cobblemon 1.8.2");
  const known = new Set(["inventory", "pokemon_interact", "aspects", "catch", "evolve", "party", "trade", "battles_won", "level_up",
    "started_riding", "riding_stat_boost", "placed_block", "item_used_on_block", "block_use", "entity_interact", "learn_tm",
    "learn_all_tm", "resurrect", "pick_starter", "pasture_use", "reel_in", "plant_tumblestone", "plant_type_gem"]);
  for (const def of ADVANCEMENTS) {
    assert.ok(Object.keys(def.criteria).length > 0, `${def.id} tem critérios`);
    for (const c of Object.values(def.criteria)) assert.ok(known.has(c.t), `${def.id}: critério ${c.t}`);
    for (const group of def.requirements) for (const name of group) assert.ok(name in def.criteria, `${def.id}: requisito ${name}`);
    assert.ok(def.icon.startsWith("textures/"), `${def.id}: ícone`);
  }
  const byId = new Map(ADVANCEMENTS.map(d => [d.id, d]));
  const run = (state: ReturnType<typeof emptyAchievements>, event: AchievementEvent) => applyEvent(state, ADVANCEMENTS, event).completed.map(d => d.id);

  const state = emptyAchievements();
  assert.deepEqual(run(state, { type: "pick_starter" }), ["root"]);
  const progress = { c: 1, s: 0, a: 0, e: 0, t: 0, r: 0, ev: [], asp: {} };
  assert.deepEqual(run(state, { type: "progress", progress }), ["catching/first_catch"]);
  assert.deepEqual(run(state, { type: "progress", progress }), [], "não conclui duas vezes");
  assert.ok(run(state, { type: "progress", progress: { ...progress, s: 1, a: 1, e: 1, t: 1 } }).includes("catching/first_shiny_catch"));
  assert.ok(state.d.includes("catching/first_alpha_catch") && state.d.includes("catching/first_evolution") && state.d.includes("catching/trade_pokemon"));
  // Party cheia (6 "any").
  assert.deepEqual(run(state, { type: "party", species: ["a", "b", "c", "d", "e"] }), []);
  assert.deepEqual(run(state, { type: "party", species: ["a", "b", "c", "d", "e", "f"] }), ["catching/full_party"]);
  // Vários critérios em E (todas as Poké Balls básicas) e em OU (qualquer bala de EXP).
  const basic = byId.get("catching/craft_basic_balls")!;
  for (const [name, c] of Object.entries(basic.criteria)) {
    const done = run(state, { type: "inventory", item: (c.items as string[])[0] });
    if (name !== Object.keys(basic.criteria).at(-1)) assert.ok(!done.includes(basic.id));
    else assert.ok(done.includes(basic.id));
  }
  assert.ok(run(state, { type: "pokemon_interact", item: "cobblemon:exp_candy_s", species: "any" }).includes("agriculture/use_exp_candy"));
  // Tag expandida: qualquer berry conta para obtain_berry.
  assert.ok(run(state, { type: "inventory", item: "cobblemon:oran_berry" }).includes("agriculture/obtain_berry"));
  // PvP (battles_won ["pvp"]).
  const wins = { t: 1, p: 0, w: 1, n: 0 };
  assert.deepEqual(run(state, { type: "battle_won", pvp: false, pvw: true, pvn: false, wins }), []);
  assert.ok(run(state, { type: "battle_won", pvp: true, pvw: false, pvn: false, wins: { t: 2, p: 1, w: 1, n: 0 } }).includes("battle/root_battle"));
  // Troca específica (Shelmet ↔ Karrablast) nos dois sentidos.
  assert.ok(run(state, { type: "trade", traded: "karrablast", received: "shelmet" }).includes("catching/trade_shelmet_karrablast"));
  // Nota + estante de discos (bloco de baixo).
  assert.deepEqual(run(state, { type: "placed_block", block: "minecraft:noteblock", below: "minecraft:stone" }), []);
  assert.ok(run(state, { type: "placed_block", block: "minecraft:noteblock", below: "cobblemon:disc_shelf" }).includes("geological/construct_note_block_sequencer"));
  // Máquina de cura cheia (carga 6 no Java).
  assert.deepEqual(run(state, { type: "block_use", block: "cobblemon:healing_machine", state: { charge: 3 } }), []);
  assert.ok(run(state, { type: "block_use", block: "cobblemon:healing_machine", state: { charge: 6 } }).includes("agriculture/use_healing_machine"));
  // TM específico ganho no inventário.
  const ancient = byId.get("geological/obtain_ancient_tm")!;
  assert.ok(criterionMatches(ancient.criteria.gain_tm_blastburn, { type: "inventory", item: "cobblemon:technical_machine", tm: "blastburn" }));
  assert.ok(!criterionMatches(ancient.criteria.gain_tm_blastburn, { type: "inventory", item: "cobblemon:technical_machine", tm: "tackle" }));
  // LevelUpCriterion (has_evolved = false): regra exata do Kotlin — só casa com pré-evolução E evolução.
  const maxBaby = byId.get("catching/max_level_baby")!;
  const lv = (hasPreEvolution: boolean, hasEvolutions: boolean, level = 100) => criterionMatches(maxBaby.criteria.level, { type: "level_up", level, hasPreEvolution, hasEvolutions });
  assert.equal(lv(true, true), true);
  assert.equal(lv(false, true), false);
  assert.equal(lv(false, false), false);
  assert.equal(lv(true, true, 99), false);
  // Aspectos (todos os Vivillon).
  const viv = byId.get("catching/collect_all_vivillon")!;
  const aspects = Object.values(viv.criteria).flatMap(c => c.aspects as string[]);
  assert.ok(run(state, { type: "progress", progress: { ...progress, s: 1, a: 1, e: 1, t: 1, asp: { vivillon: aspects } } }).includes(viv.id));
  // Progresso e visibilidade (oculto só depois de concluído).
  const fresh = emptyAchievements();
  const wailord = byId.get("catching/catch_alpha_wailord")!;
  assert.equal(isVisible(fresh, wailord, byId), false);
  assert.equal(isVisible(fresh, byId.get("root")!, byId), true);
  assert.equal(isVisible(fresh, byId.get("catching/first_catch")!, byId), false, "neto da raiz sem nada concluído");
  assert.equal(isVisible(state, byId.get("catching/craft_rod")!, byId), true);
  assert.deepEqual(progressOf(fresh, basic), { done: false, met: 0, total: basic.requirements.length });
  assert.equal(progressOf(state, basic).done, true);
  // Persistência.
  const round = parseAchievements(JSON.stringify(state));
  assert.deepEqual(round.d, state.d);
  assert.deepEqual(parseAchievements("lixo"), emptyAchievements());
  // Toast: moldura e cor pelo tipo.
  assert.deepEqual(advancementToast("goal", "x"), { icon: undefined, frame: "g", color: "y", line1: "cobblemon.port.advancement.toast.goal", line2: "x" });
}

// ---------------------------------------------------------------------------------------------
// 8. Retratos: gerados pela frente retratos quando existirem, sprite 2D como reserva

{
  assert.match(portraitPath("Pikachu"), /^textures\/cobblemon\/portraits\/pikachu_\d+$/);
  assert.match(portraitPath("cobblemon:mrmime", 0), /^textures\/cobblemon\/portraits\/mrmime_\d+$/);
  assert.equal(portraitPath("naoexiste"), "textures/sprites/naoexiste");
  setPortraitResolver(() => undefined);
  assert.equal(portraitPath("Mr. Mime"), "textures/sprites/mr-mime", "reserva usa o nome do sprite");
  setPortraitResolver((s, v) => `cobblemon/portrait_icons/${s}_${v}`);
  assert.equal(portraitPath("Mr. Mime", 2), "textures/cobblemon/portrait_icons/mrmime_2");
  for (const path of [portraitPath("crabominable", 12)]) assert.ok(utf8Length(path.slice("textures/".length)) <= 40, "caminho cabe no campo de 40 bytes");
}

// ---------------------------------------------------------------------------------------------
// 9. Textos novos nos dois idiomas

{
  const keys = ["cobblemon.port.advancement.toast.task", "cobblemon.port.advancement.chat.challenge", "cobblemon.port.advancements.title", "cobblemon.port.toast.caught"];
  for (const lang of ["en_US", "pt_BR"]) {
    const text = readFileSync(join(ROOT, "resource_packs", "CobblemonBedrock", "texts", `${lang}.lang`), "utf8");
    for (const key of keys) assert.ok(text.includes(`\n${key}=`), `${lang}: ${key}`);
  }
}

console.log("ui-base.test.ts: ok");
