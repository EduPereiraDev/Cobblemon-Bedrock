// Frente ui-layout (3º teste em cliente real: textos sobrepostos/cortados e caixas vazias nas telas roteadas).
//
// Monta cada tela roteada com os dados reais (tools/ui/previewFixtures.ts: os mesmos builders do jogo, uma batalha de
// verdade no mundo falso) e interpreta o JSON UI gerado (tools/ui/layoutScene.mjs). Regras:
//  1. nenhum texto/ícone por cima de outro texto/ícone (só os pares de propósito em tools/ui/layoutRules.mjs);
//  2. todo texto cabe no seu rótulo (ou é cortado de propósito, com aviso) e todo rótulo tem largura máxima;
//  3. cada campo do Java tem o seu elemento, visível, na posição do código Kotlin (tools/ui/javaFields.mjs);
//  4. nada de corpo corrido: a aba Info do resumo usa uma célula por campo.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUTTON_STATES, buildScene, checkButtonStates, checkScene, indexUi, parseUiFile, plain } from "../tools/ui/layoutScene.mjs";
import { SCREEN_RULES } from "../tools/ui/layoutRules.mjs";
import { JAVA_FIELDS } from "../tools/ui/javaFields.mjs";
import { buildFixtures, loadLang } from "../tools/ui/previewFixtures";
import { MOVE_TILE_LINES, SUMMARY, SUMMARY_INFO } from "../scripts/GUI/layoutSpec";

const ROOT = process.cwd();
const UI = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");
const index = indexUi(readdirSync(UI).filter(f => f.endsWith(".json") && f !== "_ui_defs.json").map(f => parseUiFile(readFileSync(join(UI, f), "utf8"))));

const hasGenerated = existsSync(join(ROOT, "generated", "resource_packs", "CobblemonBedrock", "texts", "pt_BR.lang"));
const fixtures = await buildFixtures(ROOT, { battle: true });
const lang = loadLang(ROOT);
const byName = new Map(fixtures.map(f => [f.name, f]));
for (const name of ["starter", "summary-info", "summary-moves", "summary-stats", "summary-marks", "pc", "pokedex-list", "pokedex-entry-caught", "pokedex-entry-unknown", "battle-action", "battle-moves", "battle-switch", "battle-target"]) {
	assert.ok(byName.has(name), `tela montada: ${name}`);
}

const scenes = new Map<string, ReturnType<typeof buildScene>>();
let checked = 0;
for (const fx of fixtures) {
	const scene = buildScene(index, fx.root, { ...fx, lang }, [480, 270]);
	scenes.set(fx.name, scene);
	assert.deepEqual(scene.issues, [], `${fx.name}: JSON UI interpretável`);
	// 1 e 2. Sobreposição, texto que não cabe e rótulo sem largura (avisos de corte de propósito não reprovam).
	const errors = checkScene(scene, SCREEN_RULES[fx.name.replace(/-3d$/, "")] ?? {}).filter(e => !e.startsWith("AVISO"));
	assert.deepEqual(errors, [], `${fx.name}: layout`);
	checked++;
}
assert.ok(checked >= 18, `telas checadas (${checked})`);

// 5. Frente ui-polish (4º teste em cliente real): rótulo, ícone, retrato e barra visíveis em TODOS os estados do botão
// (default/hover/pressed/locked), por cima do fundo. Antes: nas ações da batalha o nome só aparecia num estado e nos
// golpes/troca o hover (quadro opaco na camada 20) apagava nome, retrato e barra.
let stateChecked = 0;
for (const fx of fixtures) {
	const issues = checkButtonStates(index, fx.root, { ...fx, lang }, [480, 270], SCREEN_RULES[fx.name.replace(/-3d$/, "")] ?? {});
	assert.deepEqual(issues, [], `${fx.name}: conteúdo em todos os estados do botão`);
	stateChecked++;
}
assert.equal(BUTTON_STATES.length, 4);
// Toda célula clicável de batalha tem conteúdo acima do botão (o botão fica sob o conteúdo).
for (const name of ["battle-action", "battle-moves", "battle-switch", "battle-target", "battle-bag"]) {
	const fx = byName.get(name)!;
	const hover = buildScene(index, fx.root, { ...fx, lang }, [480, 270], { buttonState: "hover" });
	const labels = hover.nodes.filter(n => n.kind === "label" && plain(n.text).trim() && n.cell !== undefined);
	assert.ok(labels.length >= 2, `${name}: rótulos das células no hover`);
}

// Casos negativos do estado do botão, nas duas direções vistas no cliente + o hover opaco por cima.
{
	const button = (controls: object[], layer = 20) => ({ "hit@common.button": { size: ["100%", "100%"], anchor_from: "top_left", anchor_to: "top_left", layer, controls } });
	const tile = (label: object | undefined, controls: object[]) => ({
		type: "collection_panel", collection_name: "form_buttons", size: [100, 30], anchor_from: "top_left", anchor_to: "top_left",
		controls: [{ cell_0: { type: "panel", collection_index: 0, size: [90, 26], anchor_from: "top_left", anchor_to: "top_left", layer: 5, controls: [...(label ? [{ label }] : []), button(controls)] } }],
	});
	const nameLabel = { type: "label", text: "#form_button_text", size: [80, 10], layer: 6, anchor_from: "top_left", anchor_to: "top_left", bindings: [{ binding_name: "#form_button_text", binding_type: "collection", binding_collection_name: "form_buttons" }] };
	const frame = (y: number) => ({ type: "image", texture: "textures/gui/cobblemon/battle/battle_menu_fight", uv: [0, y], uv_size: [90, 26], size: ["100%", "100%"], layer: 2 });
	const data = { title: "", body: "", buttons: [{ text: "Atacar" }] };
	const run = (root: object) => checkButtonStates(indexUi([{ namespace: "neg", root }]), "neg.root", data, [200, 100]);
	// Golpes/troca: o nome aparece parado e o quadro opaco do hover (camada 20) o apaga.
	const covered = run(tile(nameLabel, [{ default: { type: "panel" } }, { hover: frame(26) }, { pressed: frame(26) }]));
	assert.ok(covered.some(e => e.startsWith("estado hover:") && e.includes("cobre")), "acusa o hover por cima do nome");
	assert.ok(covered.some(e => e.startsWith("estado pressed:") && e.includes("cobre")), "acusa o pressed por cima do nome");
	// Nome só no estado parado (some no hover).
	const onlyDefault = run(tile(undefined, [{ default: { type: "panel", controls: [{ label: nameLabel }] } }, { hover: frame(26) }, { pressed: frame(26) }]));
	assert.ok(onlyDefault.some(e => e.startsWith("estado hover: some")), "acusa o nome que some no hover");
	assert.ok(onlyDefault.some(e => e.startsWith("estado locked: some")), "acusa o nome que some no locked");
	// Ações da batalha: nome só no hover (parado, sem nome).
	const onlyHover = run(tile(undefined, [{ default: frame(0) }, { hover: { type: "panel", controls: [{ label: nameLabel }] } }]));
	assert.ok(onlyHover.some(e => e.startsWith("estado hover: só neste estado")), "acusa o nome que só aparece no hover");
	// Correto: o estado só troca o fundo, sob o conteúdo.
	const ok = run({
		type: "collection_panel", collection_name: "form_buttons", size: [100, 30], anchor_from: "top_left", anchor_to: "top_left",
		controls: [{
			cell_0: {
				type: "panel", collection_index: 0, size: [90, 26], anchor_from: "top_left", anchor_to: "top_left", layer: 5,
				controls: [{ bg: frame(0) }, { label: nameLabel }, button([{ default: { type: "panel" } }, { hover: { ...frame(26), layer: 0 } }, { pressed: { ...frame(26), layer: 0 } }], 3)],
			},
		}],
	});
	assert.deepEqual(ok, [], "estado sob o conteúdo: nada a acusar");
}

// 3. Campos do Java.
const content = (scene: ReturnType<typeof buildScene>, path: string) => scene.nodes.some(n => (n.path === path || n.path.startsWith(`${path}/`))
	&& ((n.kind === "label" && plain(n.text).trim()) || (n.kind === "image" && (n.bound || /^icon/.test(n.name)))));
for (const [screen, spec] of Object.entries(JAVA_FIELDS)) {
	const scene = scenes.get(screen);
	assert.ok(scene, `cena ${screen}`);
	const origin = scene!.nodes.find(n => n.path === spec.origin);
	assert.ok(origin, `${screen}: origem ${spec.origin}`);
	for (const [what, path, [x, y], opts = {}] of spec.fields as [string, string, [number, number], { content?: boolean; tol?: number }?][]) {
		const node = scene!.nodes.find(n => n.path === path);
		assert.ok(node, `${screen}: ${what} → ${path} existe e está visível`);
		const tol = opts.tol ?? 1.5;
		const dx = node!.rect[0] - origin!.rect[0] - x;
		const dy = node!.rect[1] - origin!.rect[1] - y;
		assert.ok(Math.abs(dx) <= tol && Math.abs(dy) <= tol, `${screen}: ${what} na posição do Java (desvio ${dx.toFixed(1)}, ${dy.toFixed(1)})`);
		if (opts.content !== false) assert.ok(content(scene!, path), `${screen}: ${what} com conteúdo`);
	}
}

// 4. Aba Info: cada valor na sua célula; o corpo é só a descrição da habilidade (antes: 13 linhas corridas).
{
	const info = byName.get("summary-info")!;
	for (let r = 0; r < SUMMARY_INFO.ROW_COUNT; r++) if (r !== 3) assert.ok(plain(info.buttons[SUMMARY_INFO.ROWS + r].text).trim(), `linha ${r} da aba Info preenchida`);
	assert.ok(!info.body.includes("\n"), "corpo da aba Info não é mais um bloco de linhas");
	if (hasGenerated) {
		assert.ok(!info.body.includes(lang["cobblemon.ui.info.species"]), "Espécie não vai no corpo");
		assert.ok(plain(info.buttons[SUMMARY_INFO.ROWS + 1].text).includes("Pikachu"), "valor da Espécie");
	}
	assert.match(info.buttons[SUMMARY_INFO.EXP_BAR].text, /^exp\d+$/, "barra de EXP por passo");
	// Time: os 6 espaços vêm do time (4 Pokémon) e, fora do time, o próprio Pokémon (o print do usuário não tinha nenhum).
	assert.equal(info.buttons.slice(SUMMARY.PARTY, SUMMARY.PARTY + 6).filter(b => b.text).length, 4);
	const pcSummary = byName.get("summary-pc")!;
	assert.equal(pcSummary.buttons.slice(SUMMARY.PARTY, SUMMARY.PARTY + 6).filter(b => b.text).length, 1, "fora do time: só o próprio no painel");
}

// Nenhum glifo de página (U+E2xx/E3xx: 32 px × escala) nas telas roteadas.
for (const fx of fixtures) {
	const all = [fx.title, fx.body, ...fx.buttons.map(b => b.text)].join("");
	assert.ok(![...all].some(ch => { const c = ch.codePointAt(0)!; return c >= 0xe200 && c <= 0xe3ff; }), `${fx.name}: sem glifo de página no texto`);
}

// Tile de golpe: 3 linhas (PP, dica, nome) — as antes do nome não podem quebrar (a janela mostraria outra linha).
{
	const moves = byName.get("battle-moves")!;
	const tile = moves.buttons[0].text.split("\n");
	assert.equal(tile.length, 3, "PP, dica e nome");
	assert.ok(plain(tile[MOVE_TILE_LINES.NAME]).trim().length > 0, "nome na 3ª linha");
	assert.match(plain(tile[MOVE_TILE_LINES.PP]), /^\d+\/\d+$/, "PP na 1ª linha");
}

// Caso negativo: o layout antigo da aba Info (corpo corrido de 13 linhas por cima das caixas + ícone de tipo como glifo
// no rótulo do nome) tem de ser acusado.
{
	const bad = indexUi([{
		namespace: "bad",
		root: {
			type: "collection_panel", collection_name: "form_buttons", size: [134, 148], anchor_from: "top_left", anchor_to: "top_left",
			controls: [
				{ body: { type: "label", text: "#form_text", size: [122, "default"], font_scale_factor: 0.55, anchor_from: "top_left", anchor_to: "top_left", offset: [6, 12] } },
				{ cell_0: { type: "panel", collection_index: 0, size: [118, 10], anchor_from: "top_left", anchor_to: "top_left", offset: [6, 20], controls: [{ label: { type: "label", text: "#form_button_text", size: [118, 10], font_scale_factor: 0.8, bindings: [{ binding_name: "#form_button_text", binding_type: "collection", binding_collection_name: "form_buttons" }] } }] } },
				{ loose: { type: "label", text: "#title_text", size: ["default", "default"], anchor_from: "top_left", anchor_to: "top_left" } },
			],
		},
	}]);
	const body = Array.from({ length: 13 }, (_, i) => `Linha ${i}: valor`).join("\n");
	const scene = buildScene(bad, "bad.root", { title: "Titulo", body, buttons: [{ text: " Charmander" }] }, [200, 200]);
	const issues = checkScene(scene);
	assert.ok(issues.some(e => e.includes("sobreposição")), "acusa texto por cima de texto");
	assert.ok(issues.some(e => e.includes("sem largura máxima")), "acusa rótulo sem largura máxima");
	assert.ok(issues.some(e => e.includes("não cabe")), "acusa glifo mais alto que a linha");
}

console.log(`ui-layout: ok (${checked} telas, ${stateChecked} nos 4 estados de botão, ${Object.values(JAVA_FIELDS).reduce((n, s) => n + s.fields.length, 0)} campos do Java)`);
process.exit(0);
