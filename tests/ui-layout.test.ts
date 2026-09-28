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
import { buildScene, checkScene, indexUi, parseUiFile, plain } from "../tools/ui/layoutScene.mjs";
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

console.log(`ui-layout: ok (${checked} telas, ${Object.values(JAVA_FIELDS).reduce((n, s) => n + s.fields.length, 0)} campos do Java)`);
process.exit(0);
