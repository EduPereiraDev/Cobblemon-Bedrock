// Frente "telas": gera os layouts JSON UI das telas do Cobblemon (batalha, resumo, PC, inicial, Pokédex) e o overlay
// do scanner da Pokédex.
//
//   node --experimental-strip-types tools/ui/gen-telas.ts           escreve os arquivos em resource_packs/.../ui/
//   node --experimental-strip-types tools/ui/gen-telas.ts --check   falha se algum arquivo versionado estiver desatualizado
//
// Contrato com os scripts: scripts/GUI/layoutSpec.ts (sub-marcadores e índices das células). Cada célula é um painel
// com `collection_index` fixo dentro de um painel com `collection_name: form_buttons` (padrão da vanilla em
// realms_slots_screen.json): o botão N do form é sempre a mesma célula. Texto vazio esconde a célula.
//
// Regras (docs/pesquisa/1-interface.md §1.3/§2.2): expressões LITERAIS (nenhuma $variável em source_property_name),
// todo binding view lê alguma #propriedade, cliques com `collection_details`, nada de fatiar strings aqui.
// Coordenadas = as do Cobblemon (Summary.kt, PCGUI.kt, StarterSelectionScreen.kt, PokedexGUI.kt, BattleGUI.kt).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BATTLE_ACTION, BATTLE_MOVES, BATTLE_SWITCH, BATTLE_TARGET, CATEGORY_MARKERS, EXP_STEPS, GIMMICK_ON_MARKER, GUI, PC, PC_DIM_MARKER, POKEDEX_ENTRY,
	POKEDEX_LIST, SELECTED_MARKER, STARTER, SUB, SUMMARY, SUMMARY_INFO, SUMMARY_INFO_LABELS, SUMMARY_MARKS, SUMMARY_MOVES, TYPE_DOUBLE, TYPE_HUES,
	MOVE_NAME, MOVE_TILE_LINES, TYPE_SINGLE, expStepText, typeKeyTexture,
	RADAR_COLORS, RADAR_HEXAGON, RADAR_PENTAGON, STAT_BAR_LINES, STAT_FILL_COLORS, STAT_FILL_MARKERS, radarSectorBox,
	BATTLE_FORFEIT, DIALOGUE, DIALOGUE_DISABLED_MARKER, DIALOGUE_MAX_HORIZONTAL,
} from "../../scripts/GUI/layoutSpec.ts";
import type { RadarShape } from "../../scripts/GUI/layoutSpec.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const UI_DIR = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");

type Json = Record<string, unknown>;
type Vec = [number | string, number | string];

const HIGHLIGHT = `${GUI}/battle/battle_log_row_selected_color`;
const WHITE: [number, number, number] = [1, 1, 1];
const DARK: [number, number, number] = [0.25, 0.25, 0.25];

// ---------------------------------------------------------------------------------------------------------------
// Blocos básicos

const collection = (name: string, override?: string): Json => ({
	binding_name: name,
	...(override ? { binding_name_override: override } : {}),
	binding_type: "collection",
	binding_collection_name: "form_buttons",
});
const view = (source: string, target: string): Json => ({ binding_type: "view", source_property_name: source, target_property_name: target });
const hasMarker = (marker: string) => `(not ((#title_text - '${marker}') = #title_text))`;
const lacksMarker = (marker: string) => `((#title_text - '${marker}') = #title_text)`;
/** Visível só quando o título tem (ou não tem) o marcador. */
const titleVisibility = (source: string): Json[] => [{ binding_name: "#title_text" }, view(source, "#visible")];

const at = (offset: Vec, size: Vec): Json => ({ anchor_from: "top_left", anchor_to: "top_left", offset, size });

/** Imagem estática. */
function img(texture: string, offset: Vec, size: Vec, extra: Json = {}): Json {
	return { type: "image", texture, layer: 1, ...at(offset, size), ...extra };
}

/** Imagem com a textura do botão (ícone). */
function icon(offset: Vec, size: Vec, extra: Json = {}): Json {
	return {
		type: "image",
		layer: CONTENT_LAYER,
		...at(offset, size),
		...extra,
		bindings: [
			collection("#form_button_texture", "#texture"),
			collection("#form_button_texture_file_system", "#texture_file_system"),
			view("(not ((#texture = '') or (#texture = 'loading')))", "#visible"),
		],
	};
}

interface TextOptions { scale?: number; color?: [number, number, number]; align?: "left" | "center" | "right"; shadow?: boolean }

/** Rótulo com o texto do botão. */
function text(offset: Vec, size: Vec, o: TextOptions = {}): Json {
	return {
		type: "label",
		text: "#form_button_text",
		layer: 6,
		...at(offset, size),
		color: o.color ?? WHITE,
		shadow: o.shadow ?? true,
		font_scale_factor: o.scale ?? 1,
		text_alignment: o.align ?? "left",
		bindings: [collection("#form_button_text")],
	};
}

/** Rótulo com um texto global (#title_text / #form_text). */
function globalLabel(binding: "#title_text" | "#form_text", offset: Vec, size: Vec, o: TextOptions = {}): Json {
	return {
		type: "label",
		text: binding,
		layer: 6,
		...at(offset, size),
		color: o.color ?? WHITE,
		shadow: o.shadow ?? true,
		font_scale_factor: o.scale ?? 1,
		text_alignment: o.align ?? "left",
		bindings: [{ binding_name: binding }],
	};
}

/**
 * Frente ui-polish (4º teste em cliente real): camadas dentro de uma célula clicável.
 *  - fundo (textura do tile, realce de escolhido): camadas 1 e 2;
 *  - o botão (`hit`) na camada HIT_LAYER, com os controles de estado (hover/pressed) na camada 0 dele;
 *  - conteúdo (rótulos, ícones, retratos): CONTENT_LAYER ou acima.
 * Antes o botão ficava na camada 20: a imagem do hover (quadro opaco do `battle_menu_*`/`party_select`) era desenhada
 * POR CIMA do nome, do retrato e da barra, e o rótulo só existia num estado do botão. Agora o estado só troca o fundo.
 */
const HIT_LAYER = 3;
const CONTENT_LAYER = 4;

/**
 * Área clicável da célula (herda `common.button`). `hover`/`pressed`: controles do estado (trocam o FUNDO, sob o
 * conteúdo); padrão = realce branco.
 */
function hit(hover?: Json, pressed?: Json): Json {
	const highlight = img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.28 });
	const state = (control: Json): Json => ({ ...control, layer: 0 });
	return {
		"hit@common.button": {
			$pressed_button_name: "button.form_button_click",
			...at([0, 0], ["100%", "100%"]),
			layer: HIT_LAYER,
			bindings: [{ binding_type: "collection_details", binding_collection_name: "form_buttons" }],
			controls: [
				{ default: { type: "panel" } },
				{ hover: state(hover ?? highlight) },
				{ pressed: state(pressed ?? hover ?? highlight) },
			],
		},
	};
}

/** Célula: painel na posição fixa, com o índice do botão; some quando o texto do botão é vazio. */
function cell(index: number, offset: Vec, size: Vec, controls: Json[]): Json {
	return {
		[`cell_${index}`]: {
			type: "panel",
			collection_index: index,
			layer: 5,
			...at(offset, size),
			bindings: [collection("#form_button_text"), view("(not (#form_button_text = ''))", "#visible")],
			controls,
		},
	};
}

/**
 * Contêiner das células. Frente ui-cliente: tem de ser `collection_panel` (padrão vanilla de
 * `store_common.json` `screenshots_grid`: filhos com `collection_index` em posições livres). Num `panel` o cliente
 * acusa "Unknown property [collection_name]" e, nos filhos, "Unknown property [collection_index]": a coleção não
 * existe e toda célula lê o botão 0.
 */
const COLLECTION_PANEL = "collection_panel";
function cellPanel(offset: Vec, size: Vec, controls: Json[], extra: Json = {}): Json {
	return { type: COLLECTION_PANEL, collection_name: "form_buttons", layer: 2, ...at(offset, size), ...extra, controls };
}

/** 18 cópias do tile pintadas com a cor do tipo, cada uma visível quando o ícone do botão é a chave do tipo. */
function typeTintPanel(texture: string, size: Vec, uvSize: [number, number]): Json {
	return { type: "panel", layer: 1, ...at([0, 0], size), controls: typeTints(texture, size, uvSize) };
}

function typeTints(texture: string, size: Vec, uvSize: [number, number]): Json[] {
	return Object.entries(TYPE_HUES).map(([type, hue]) => ({
		[`tint_${type}`]: {
			type: "image",
			texture,
			uv: [0, 0],
			uv_size: uvSize,
			layer: 1,
			...at([0, 0], size),
			color: [((hue >> 16) & 255) / 255, ((hue >> 8) & 255) / 255, (hue & 255) / 255].map(v => Math.round(v * 1000) / 1000),
			bindings: [collection("#form_button_texture"), view(`(#form_button_texture = '${typeKeyTexture(type)}')`, "#visible")],
		},
	}));
}

// ---------------------------------------------------------------------------------------------------------------
// Frente ui-layout: campos separados como no Java (um rótulo por campo, largura máxima, ícones em vez de glifos).
//
// Glifos de página própria (U+E2xx) são desenhados com 32 px × font_scale_factor (medido no print do cliente): no
// meio de um rótulo eles invadem as linhas vizinhas. Tipos, categorias, gênero e bolas viram imagens.

/** Rótulo do texto do botão dentro de um painel que corta (`clips_children`): texto longo não invade o vizinho. */
function clipText(offset: Vec, size: Vec, o: TextOptions = {}): Json {
	return { type: "panel", clips_children: true, layer: 6, ...at(offset, size), controls: [{ label: text([0, 0], [size[0], "default"], o) }] };
}

/**
 * Uma linha (`line`, a partir de 0) do texto do botão numa janela cortada: o rótulo inteiro sobe `line` linhas e só a
 * linha escolhida fica dentro da janela. As linhas antes dela precisam caber na largura (senão quebram e empurram).
 */
function clipLine(line: number, offset: Vec, size: Vec, o: TextOptions = {}): Json {
	const lineHeight = 10 * (o.scale ?? 1);
	return {
		type: "panel", clips_children: true, layer: 6, ...at(offset, size),
		controls: [{ label: text([0, -line * lineHeight], [size[0], "default"], o) }],
	};
}

/** Rótulo fixo (chave de tradução: o cliente traduz), cortado na largura. */
function langLabel(key: string, offset: Vec, size: Vec, o: TextOptions = {}): Json {
	return {
		type: "panel", clips_children: true, layer: 6, ...at(offset, size),
		controls: [{
			label: {
				type: "label", text: key, localize: true, layer: 1, ...at([0, 0], [size[0], "default"]), color: o.color ?? WHITE, shadow: o.shadow ?? true,
				font_scale_factor: o.scale ?? 1, text_alignment: o.align ?? "left",
			},
		}],
	};
}

/** Rótulo global (#title_text/#form_text) cortado na largura/altura. */
function clipGlobal(binding: "#title_text" | "#form_text", offset: Vec, size: Vec, o: TextOptions = {}): Json {
	return { type: "panel", clips_children: true, layer: 6, ...at(offset, size), controls: [{ label: globalLabel(binding, [0, 0], [size[0], "default"], o) }] };
}

/** Tipos na ordem do `types.png` (colunas de 36 px; mesma ordem de GLYPH_TYPES). */
const TYPE_ORDER = Object.keys(TYPE_HUES);

/**
 * Ícone do tipo (TypeIcon do Java: `types.png`, 36 px a 0,5): o ícone do botão é a chave do tipo
 * (`typeKeyTexture`) e só a imagem daquele tipo aparece.
 */
function typeIcon(offset: Vec, size: Vec = [18, 18], extra: Json = {}, small = false): Json {
	const px = small ? 18 : 36;
	return {
		type: "panel", layer: 4, ...at(offset, size), ...extra,
		controls: TYPE_ORDER.map((type, i) => ({
			[`icon_${type}`]: {
				type: "image", texture: `${GUI}/${small ? "types_small" : "types"}`, uv: [i * px, 0], uv_size: [px, px], layer: 1, ...at([0, 0], size),
				bindings: [collection("#form_button_texture"), view(`(#form_button_texture = '${typeKeyTexture(type)}')`, "#visible")],
			},
		})),
	};
}

/** Visível só quando o texto do botão é exatamente `value`. */
const whenText = (value: string): Json[] => [collection("#form_button_text"), view(`(#form_button_text = '${value}')`, "#visible")];
/** Visível só quando o texto do botão contém `marker`. */
const whenMarker = (marker: string): Json[] => [collection("#form_button_text"), view(`(not ((#form_button_text - '${marker}') = #form_button_text))`, "#visible")];

/**
 * Tipos no espaçador (Summary/StarterSelection/PCGUI): texto `single` = espaçador simples e o ícone no centro;
 * `double` = espaçador duplo e o 1º ícone à esquerda (o 2º tipo é outra célula, em `x + 15`).
 * @param spacer [textura simples, textura dupla] e o tamanho desenhado
 */
function typeSpacerCell(index: number, offset: [number, number], size: [number, number], spacer: { single: string; double?: string; at: Vec; size: Vec }, iconX: { single: number; double: number }, iconY = 0): Json {
	const controls: Json[] = [
		{ spacer_single: img(spacer.single, spacer.at, spacer.size, { layer: 2, bindings: whenText(TYPE_SINGLE) }) },
		{ single: typeIcon([iconX.single, iconY], [18, 18], { bindings: whenText(TYPE_SINGLE) }) },
		{ double: typeIcon([iconX.double, iconY], [18, 18], { bindings: whenText(TYPE_DOUBLE) }) },
	];
	if (spacer.double) controls.unshift({ spacer_double: img(spacer.double, spacer.at, spacer.size, { layer: 2, bindings: whenText(TYPE_DOUBLE) }) });
	return cell(index, offset, size, controls);
}

/** Ícone de categoria (MoveCategoryIcon: `categories.png` 24×16 por linha) pelo prefixo invisível do texto. */
function categoryIcons(offset: Vec, size: Vec): Json[] {
	return Object.entries(CATEGORY_MARKERS).map(([category, marker], i) => ({
		[`icon_category_${category.toLowerCase()}`]: img(`${GUI}/categories`, offset, size, { uv: [0, i * 16], uv_size: [24, 16], layer: CONTENT_LAYER, bindings: whenMarker(marker) }),
	}));
}

/** Barra de EXP (azul, 0,2/0,65/0,84) em passos: a textura `exp_v_18` (coluna cheia) esticada na largura do passo. */
function expBar(width: number, height: number): Json[] {
	// Passo 0 = barra vazia (nenhuma imagem).
	return Array.from({ length: EXP_STEPS }, (_, i) => i + 1).map(step => ({
		[`step_${step}`]: img("textures/ui/cobblemon/hud/exp_v_18", [0, 0], [Math.round(width * step / EXP_STEPS * 100) / 100, height], {
			layer: 2, bindings: whenText(expStepText(step)),
		}),
	}));
}

/** Realce da célula escolhida (aba ativa, espaço aberto): prefixo SELECTED_MARKER no texto. */
function selectedOverlay(texture: string, offset: Vec, size: Vec, uv?: [number, number], uvSize?: [number, number]): Json {
	return { selected: img(texture, offset, size, { layer: 2, ...(uv ? { uv, uv_size: uvSize } : {}), bindings: whenMarker(SELECTED_MARKER) }) };
}

/** Botão fechar da vanilla (button.menu_exit → form cancelado). */
function closeButton(offset: Vec, anchor: "top_right" | "top_left" = "top_right"): Json {
	return { "close@common.close_button": { anchor_from: anchor, anchor_to: anchor, offset, layer: 30 } };
}

/**
 * Textura em pedaços em volta de uma janela (a janela fica transparente para o modelo 3D do estúdio aparecer).
 * `win` = [x, y, w, h] da janela na textura.
 */
function framedTexture(name: string, texture: string, size: [number, number], win: [number, number, number, number], extra: Json = {}): Json[] {
	const [W, H] = size;
	const [x, y, w, h] = win;
	const piece = (id: string, px: number, py: number, pw: number, ph: number): Json => ({
		[`${name}_${id}`]: img(texture, [px, py], [pw, ph], { uv: [px, py], uv_size: [pw, ph], ...extra }),
	});
	return [
		piece("top", 0, 0, W, y),
		piece("bottom", 0, y + h, W, H - y - h),
		piece("left", 0, y, x, h),
		piece("right", x + w, y, W - x - w, h),
	];
}

// ---------------------------------------------------------------------------------------------------------------
// Batalha (BattleGUI.kt e subscreens)

function battleFile(): Json {
	const tileOffsets: Vec[] = [[0, 0], [93, 0], [0, 29], [93, 29]];
	const actionTiles = tileOffsets.map((o, i) => cell(BATTLE_ACTION.TILES + i, o, [90, 26], [
		// BattleOptionTile: quadro de cima (cinza com o filete da cor) parado, o de baixo (colorido) no hover; o nome
		// é desenhado nos dois (texto por cima do fundo, em qualquer estado).
		{ bg: icon([0, 0], [90, 26], { uv: [0, 0], uv_size: [90, 26], layer: 2 }) },
		text([6, 8], [80, 10], {}),
		hit(icon([0, 0], [90, 26], { uv: [0, 26], uv_size: [90, 26] })),
	]));
	// BattleMoveSelection (x 20, y = altura − 84): tiles 92×24 com 13 px entre colunas e 5 entre linhas. MoveTile: ícone do
	// tipo em x − 9, nome em x 17, categoria em x 48 / y 14,5, PP centrado em x 75 / y 14.
	const moveOffsets: [number, number][] = [[0, 0], [105, 0], [0, 29], [105, 29]];
	const moveTiles = moveOffsets.map(([x, y], i) => cell(BATTLE_MOVES.MOVES + i, [x, y], [92, 24], [
		{ "tints@battle.move_tints": {} },
		img(`${GUI}/battle/battle_move_overlay`, [0, 0], [92, 24], { layer: 2 }),
		typeIcon([-9, 2]),
		clipLine(MOVE_TILE_LINES.NAME, [17, 3], [MOVE_NAME.WIDTH, 7.5], { scale: MOVE_NAME.SCALE }),
		...categoryIcons([48, 14.5], [12, 8]),
		clipLine(MOVE_TILE_LINES.PP, [64, 14.5], [22, 6.5], { scale: 0.65, align: "center" }),
		clipLine(MOVE_TILE_LINES.HINT, [16, 15.5], [31, 4.5], { scale: 0.45 }),
		// Frente msd-beta: nome longo (o script o põe na linha NAME_LONG) em até 2 linhas, menor, no alto do tile (depois
		// dos outros painéis: os índices deles são os do mapa de campos do Java, tools/ui/javaFields.mjs).
		clipLine(MOVE_TILE_LINES.NAME_LONG, [17, 1.5], [MOVE_NAME.WIDTH, 2 * 10 * MOVE_NAME.LONG_SCALE], { scale: MOVE_NAME.LONG_SCALE }),
		hit(),
	]));
	// BattleBackButton: 58×34 a 0,5 (x − 11, y = altura − 22), 2 quadros na vertical.
	const back = (index: number, offset: Vec) => cell(index, offset, [29, 17], [
		img(`${GUI}/battle/battle_back`, [0, 0], [29, 17], { uv: [0, 0], uv_size: [58, 34] }),
		hit(img(`${GUI}/battle/battle_back`, [0, 0], [29, 17], { uv: [0, 34], uv_size: [58, 34], layer: 1 })),
	]);
	// Frente msd-fase1: botões de gimmick (BattleGimmickButton: 36×34 a 0,5 = 18×17; x = voltar + 58×0,65 + 26×i, na
	// linha do voltar). A textura (ícone do botão) tem 2 quadros: em cima o normal, embaixo o ligado/realçado.
	const gimmickFrame = (uvY: number, visible: string | undefined, layer: number): Json => ({
		type: "image",
		layer,
		...at([0, 0], [18, 17]),
		uv: [0, uvY],
		uv_size: [36, 34],
		bindings: [
			collection("#form_button_texture", "#texture"),
			collection("#form_button_texture_file_system", "#texture_file_system"),
			...(visible ? [collection("#form_button_text"), view(visible, "#visible")] : []),
		],
	});
	const toggledOn = `(not ((#form_button_text - '${GIMMICK_ON_MARKER}') = #form_button_text))`;
	const gimmickButtons = Array.from({ length: BATTLE_MOVES.GIMMICK_SLOTS }, (_, i) => cell(BATTLE_MOVES.GIMMICKS + i, [-11 + 58 * 0.65 + 26 * i, 62], [18, 17], [
		{ bg: gimmickFrame(0, undefined, 2) },
		{ toggled: gimmickFrame(34, toggledOn, CONTENT_LAYER) },
		hit(gimmickFrame(34, undefined, 0)),
	]));
	const targetOffsets: Vec[] = [[0, 0], [98, 0], [196, 0], [0, 37], [98, 37], [196, 37]];
	const targets = targetOffsets.map((o, i) => cell(BATTLE_TARGET.FOES + i, o, [93, 33], [
		img(`${GUI}/battle/target_select`, [0, 0], [93, 33], { uv: [0, 0], uv_size: [93, 33] }),
		icon([66, 5], [23, 23]),
		text([5, 5], [62, 24], { scale: 0.6 }),
		hit(img(`${GUI}/battle/target_select`, [0, 0], [93, 33], { uv: [0, 33], uv_size: [93, 33] })),
	]));
	const slotOffset = (i: number): [number, number] => [(i % 2) * 98, Math.floor(i / 2) * 31];
	const switchSlots = [0, 1, 2, 3, 4, 5].map(i => cell(BATTLE_SWITCH.SLOTS + i, slotOffset(i), [94, 29], [
		img(`${GUI}/battle/party_select`, [0, 0], [94, 29], { uv: [0, 0], uv_size: [94, 29] }),
		icon([68, 2], [24, 24]),
		text([5, 4], [62, 16], { scale: 0.6 }),
		hit(img(`${GUI}/battle/party_select`, [0, 0], [94, 29], { uv: [0, 29], uv_size: [94, 29] })),
	]));
	const switchBars = [0, 1, 2, 3, 4, 5].map(i => {
		const [x, y] = slotOffset(i);
		return cell(BATTLE_SWITCH.BARS + i, [x + 5, y + 22], [58, 3], [icon([0, 0], [58, 3])]);
	});
	const bagItem = {
		type: "panel",
		size: [96, 31],
		controls: [
			img(`${GUI}/battle/party_select`, [1, 1], [94, 29], { uv: [0, 0], uv_size: [94, 29] }),
			// Frente ui-polish: ícone do item (textura do item no ícone do botão) à esquerda; sem ícone, o texto começa em x 6.
			icon([5, 6], [16, 16]),
			{ text_icon: { ...text([24, 6], [68, 20], { scale: 0.7 }), bindings: [collection("#form_button_text"), collection("#form_button_texture"), view("(not (#form_button_texture = ''))", "#visible")] } },
			{ text_plain: { ...text([6, 6], [84, 20], { scale: 0.7 }), bindings: [collection("#form_button_text"), collection("#form_button_texture"), view("(#form_button_texture = '')", "#visible")] } },
			hit(img(`${GUI}/battle/party_select`, [1, 1], [94, 29], { uv: [0, 29], uv_size: [94, 29] })),
		],
		bindings: [collection("#form_button_text"), view("(not (#form_button_text = ''))", "#visible")],
	};
	const prompt = globalLabel("#title_text", [0, -12], [220, 10], {});
	// Frente ui-polish: ForfeitConfirmationSelection (113×45 no centro): "Desistir" centrado em x 42, y 2 e os botões
	// BattleResponseButton (34×19, 2 quadros) em x 22 e 57, y 18, com o ícone (21×26 a 0,5) em x + 12, y + 3,5.
	const REQUEST = `${GUI}/interact/request`;
	const response = (index: number, x: number, kind: "accept" | "decline") => cell(index, [x, 18], [34, 19], [
		img(`${REQUEST}/button_request_${kind}`, [0, 0], [34, 19], { uv: [0, 0], uv_size: [34, 19] }),
		{ icon_response: img(`${REQUEST}/icon_${kind}`, [12, 3.5], [10.5, 13], { layer: CONTENT_LAYER }) },
		hit(img(`${REQUEST}/button_request_${kind}`, [0, 0], [34, 19], { uv: [0, 19], uv_size: [34, 19] })),
	]);
	return {
		namespace: "battle",
		// Roteado por ui/cobblemon_forms.json (marcador §0§2§r). Tela inteira transparente: o mundo e as caixas de
		// info do HUD (ui-base) aparecem por trás; cada sub-layout ocupa o canto do Cobblemon.
		"battle_form": {
			type: "panel",
			size: ["100%", "100%"],
			layer: 2,
			controls: [
				{ "action@battle.action_layout": {} },
				{ "moves@battle.moves_layout": {} },
				{ "target@battle.target_layout": {} },
				{ "switch@battle.switch_layout": {} },
				{ "list@battle.list_layout": {} },
				{ "forfeit@battle.forfeit_layout": {} },
			],
		},
		"forfeit_layout": {
			type: "panel",
			size: ["100%", "100%"],
			bindings: titleVisibility(hasMarker(SUB.BATTLE_FORFEIT)),
			controls: [
				{
					box: cellPanel([0, 0], [113, 45], [
						{ background: img(`${REQUEST}/confirmation_request`, [0, 0], [113, 45], { layer: 1 }) },
						{ title: clipGlobal("#title_text", [2, 2], [80, 10], { align: "center" }) },
						response(BATTLE_FORFEIT.ACCEPT, 22, "accept"),
						response(BATTLE_FORFEIT.DECLINE, 57, "decline"),
					], { anchor_from: "center", anchor_to: "center" }),
				},
			],
		},
		"action_layout": {
			type: "panel",
			size: ["100%", "100%"],
			bindings: titleVisibility(hasMarker(SUB.BATTLE_ACTION)),
			controls: [
				{ tiles: cellPanel([12, -30], [183, 55], [{ prompt }, ...actionTiles], { anchor_from: "bottom_left", anchor_to: "bottom_left" }) },
				{
					log: {
						type: "image",
						texture: `${GUI}/battle/battle_log`,
						size: [169, 55],
						anchor_from: "bottom_right",
						anchor_to: "bottom_right",
						offset: [-8, -30],
						layer: 2,
						controls: [{ body: globalLabel("#form_text", [6, 5], [157, "default"], { scale: 0.55 }) }],
					},
				},
			],
		},
		"moves_layout": {
			type: "panel",
			size: ["100%", "100%"],
			bindings: titleVisibility(hasMarker(SUB.BATTLE_MOVES)),
			controls: [
				{ tiles: cellPanel([20, -31], [197, 53], [{ prompt }, ...moveTiles, back(BATTLE_MOVES.BACK, [-11, 62]), ...gimmickButtons], { anchor_from: "bottom_left", anchor_to: "bottom_left" }) },
			],
		},
		"target_layout": {
			type: "panel",
			size: ["100%", "100%"],
			bindings: titleVisibility(hasMarker(SUB.BATTLE_TARGET)),
			controls: [
				{ tiles: cellPanel([20, -20], [289, 90], [{ prompt }, ...targets, back(BATTLE_TARGET.BACK, [0, 75])], { anchor_from: "bottom_left", anchor_to: "bottom_left" }) },
			],
		},
		"switch_layout": {
			type: "panel",
			size: ["100%", "100%"],
			bindings: titleVisibility(hasMarker(SUB.BATTLE_SWITCH)),
			controls: [
				{
					tiles: cellPanel([0, 0], [192, 108], [
						{ prompt: globalLabel("#title_text", [0, -14], [192, 10], { align: "center" }) },
						...switchSlots, ...switchBars, back(BATTLE_SWITCH.BACK, [0, 95]),
					], { anchor_from: "center", anchor_to: "center" }),
				},
			],
		},
		"list_layout": {
			type: "panel",
			size: ["100%", "100%"],
			bindings: titleVisibility(hasMarker(SUB.BATTLE_LIST)),
			controls: [
				{
					frame: {
						type: "panel",
						size: [202, 150],
						anchor_from: "center",
						anchor_to: "center",
						layer: 2,
						controls: [
							{ title: globalLabel("#title_text", [0, 0], [202, 10], { align: "center" }) },
							{
								"scroll@common.scrolling_panel": {
									...at([0, 14], [202, 136]),
									$show_background: false,
									$scrolling_content: "battle.bag_grid",
									$scroll_size: [5, "100% - 4px"],
									$scrolling_pane_size: ["100% - 4px", "100% - 2px"],
									$scrolling_pane_offset: [2, 0],
									$scroll_bar_right_padding_size: [0, 0],
								},
							},
						],
					},
				},
			],
		},
		"bag_grid": {
			type: "grid",
			size: [192, "100%c"],
			grid_dimensions: [2, 1],
			grid_item_template: "battle.bag_item",
			grid_fill_direction: "horizontal",
			grid_rescaling_type: "horizontal",
			anchor_from: "top_left",
			anchor_to: "top_left",
			factory: { name: "buttons", control_name: "battle.bag_item" },
			collection_name: "form_buttons",
			bindings: [{ binding_name: "#form_button_length", binding_name_override: "#maximum_grid_items" }],
		},
		"bag_item": bagItem,
		"move_tints": typeTintPanel(`${GUI}/battle/battle_move`, [92, 24], [92, 24]),
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Frente ui-polish: diálogo (DialogueScreen.kt): caixa 196×74 com a borda de cima 67 px acima do centro da tela, o nome
// (196×17) colado em cima, o retrato (38×36) à esquerda ou à direita do nome e as opções 7 px abaixo da caixa. A tela
// aqui é um painel de 272 px (retrato + caixa + retrato) com a origem no topo do nome (83 px acima do centro).

function dialogueFile(): Json {
	const D = `${GUI}/dialogue`;
	const TEXT = [0x4c / 255, 0x4c / 255, 0x4c / 255].map(v => Math.round(v * 1000) / 1000) as [number, number, number];
	const BOX_X = 38;
	const BOX_Y = 16;
	const OPTIONS_Y = BOX_Y + 74 + 7;
	const disabled = `(not ((#form_button_text - '${DIALOGUE_DISABLED_MARKER}') = #form_button_text))`;
	/** DialogueOptionWidget: botão com 3 quadros (normal, hover, apagado) e o texto centrado. */
	const option = (index: number, offset: Vec, width: number, texture: string) => cell(index, offset, [width, 21], [
		{ bg: img(texture, [0, 0], [width, 21], { uv: [0, 0], uv_size: [width, 21], bindings: [collection("#form_button_text"), view(`(not ${disabled})`, "#visible")] }) },
		{ bg_disabled: img(texture, [0, 0], [width, 21], { uv: [0, 42], uv_size: [width, 21], bindings: [collection("#form_button_text"), view(disabled, "#visible")] }) },
		clipText([3, 6.5], [width - 6, 9], { scale: 0.9, align: "center" }),
		hit(img(texture, [0, 0], [width, 21], { uv: [0, 21], uv_size: [width, 21] })),
	]);
	const panel = (marker: string, controls: Json[]) => cellPanel([0, 0], [272, 200], controls, { layer: 3, bindings: titleVisibility(hasMarker(marker)) });
	const vertical = Array.from({ length: DIALOGUE.OPTION_SLOTS }, (_, i) => option(DIALOGUE.OPTIONS + i, [BOX_X, OPTIONS_Y + 25 * i], 196, `${D}/dialogue_button_full`));
	const rows = [SUB.DIALOGUE_H1, SUB.DIALOGUE_H2, SUB.DIALOGUE_H3, SUB.DIALOGUE_H4].slice(0, DIALOGUE_MAX_HORIZONTAL).map((marker, n) => {
		const count = n + 1;
		return { [`row_${count}`]: panel(marker, Array.from({ length: count }, (_, i) => option(DIALOGUE.OPTIONS + i, [136 - (count - 1) * 50 + 100 * i - 48, OPTIONS_Y], 96, `${D}/dialogue_button`))) };
	});
	// Retrato (DialoguePortraitWidget): fundo, rosto (retrato da espécie ou o rosto 8×8 da skin + chapéu), moldura e a
	// setinha que aponta para a caixa (quadro do dialogue_box em u 196).
	const face = (side: "left" | "right"): Json[] => {
		const x = side === "left" ? 1 : BOX_X + 196 - 1;
		const when = (kind: string) => [collection("#form_button_text"), view(`(#form_button_text = '${side}_${kind}')`, "#visible")];
		const whenSide = [collection("#form_button_text"), view(`(not ((#form_button_text - '${side}_') = #form_button_text))`, "#visible")];
		const bound = (extra: Json, kind: string): Json => ({
			type: "image", ...extra,
			bindings: [collection("#form_button_texture", "#texture"), collection("#form_button_texture_file_system", "#texture_file_system"), ...when(kind)],
		});
		return [
			{ [`${side}_background`]: img(`${D}/dialogue_portrait_background`, [x, 0], [38, 36], { layer: 1, bindings: whenSide }) },
			{ [`icon_${side}_pokemon`]: bound({ layer: 2, ...at([x + 4, 3], [30, 30]) }, "pokemon") },
			{ [`icon_${side}_skin`]: bound({ layer: 2, ...at([x + 5, 4], [28, 28]), uv: [8, 8], uv_size: [8, 8] }, "skin") },
			{ [`bg_${side}_hat`]: bound({ layer: 3, ...at([x + 5, 4], [28, 28]), uv: [40, 8], uv_size: [8, 8] }, "skin") },
			{ [`${side}_frame`]: img(`${D}/dialogue_portrait_${side}`, [x, 0], [38, 36], { layer: 4, bindings: whenSide }) },
			{ [`${side}_arrow`]: img(`${D}/dialogue_box`, [side === "left" ? x + 32 : x, 30], [6, 11], { layer: 4, uv: [196, side === "left" ? 11 : 0], uv_size: [6, 11], bindings: whenSide }) },
		];
	};
	return {
		namespace: "dialogue",
		"dialogue_form": {
			type: "panel",
			size: [272, 200],
			anchor_from: "center",
			anchor_to: "center",
			offset: [0, 17],
			layer: 2,
			controls: [
				{ name_bar: img(`${D}/dialogue_name`, [BOX_X, 0], [196, 17], { layer: 1 }) },
				{ name: clipGlobal("#title_text", [BOX_X + 2, 4.5], [192, 9], { align: "center" }) },
				{ box: img(`${D}/dialogue_box`, [BOX_X, BOX_Y], [196, 74], { layer: 1, uv: [0, 0], uv_size: [196, 74] }) },
				{ text: clipGlobal("#form_text", [BOX_X + 9, BOX_Y + 7], [178, 62], { color: TEXT, shadow: false }) },
				{ portrait: cellPanel([0, 0], [272, 200], [cell(DIALOGUE.PORTRAIT, [0, 0], [272, 41], [...face("left"), ...face("right")])], { layer: 3 }) },
				// Sem opções: tocar na caixa continua (DialogueBox.mouseClicked → "skip!"); o texto do botão vira a dica.
				{
					continue: panel(SUB.DIALOGUE_CONTINUE, [cell(DIALOGUE.OPTIONS, [BOX_X, BOX_Y], [196, 74], [
						clipText([96, 63], [94, 7], { scale: 0.6, align: "right", color: TEXT, shadow: false }),
						hit(img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.06 })),
					])]),
				},
				{ vertical: panel(SUB.DIALOGUE_VERTICAL, vertical) },
				...rows,
			],
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Resumo (Summary.kt, 331×161)

const SUMMARY_TAB_MARKERS = [SUB.SUMMARY_INFO, SUB.SUMMARY_MOVES, SUB.SUMMARY_STATS, SUB.SUMMARY_MARKS];
const SUMMARY_TAB_BASES = ["summary_info_base", "summary_moves_base", "summary_stats_other_base", "summary_marks_base"];
const SUMMARY_TAB_ICONS = ["info", "moves", "stats", "marks"];

function summaryCanvas(studio: boolean): Json {
	const controls: Json[] = [];
	const base = `${GUI}/summary/summary_base`;
	// Estúdio: a janela do retrato fica vazada (o modelo ao vivo está atrás) e o painel do time some.
	if (studio) controls.push(...framedTexture("base", base, [211, 161], [6, 32, 66, 66]));
	else {
		controls.push({ base: img(base, [0, 0], [331, 161]) });
		controls.push({ portrait_bg: img(`${GUI}/summary/portrait_background`, [6, 32], [66, 66], { layer: 2 }) });
	}
	SUMMARY_TAB_MARKERS.forEach((marker, i) => {
		// Frente ui-polish: Atributos usa o fundo do gráfico (summary_stats_chart_base) e o de barras só no modo OTHER.
		if (marker === SUB.SUMMARY_STATS) {
			controls.push({ tab_base_chart: img(`${GUI}/summary/summary_stats_chart_base`, [77, 12], [134, 148], { layer: 2, bindings: titleVisibility(`(${hasMarker(marker)} and ${lacksMarker(SUB.SUMMARY_STATS_OTHER)})`) }) });
			controls.push({ tab_base_other: img(`${GUI}/summary/summary_stats_other_base`, [77, 12], [134, 148], { layer: 2, bindings: titleVisibility(`(${hasMarker(marker)} and ${hasMarker(SUB.SUMMARY_STATS_OTHER)})`) }) });
		}
		else controls.push({ [`tab_base_${i}`]: img(`${GUI}/summary/${SUMMARY_TAB_BASES[i]}`, [77, 12], [134, 148], { layer: 2, bindings: titleVisibility(hasMarker(marker)) }) });
		controls.push({ [`tab_active_${i}`]: img(`${GUI}/summary/summary_tab`, [78 + 31 * i - 5, -1], [39, 13], { layer: 2, bindings: titleVisibility(hasMarker(marker)) }) });
	});
	const cells: Json[] = [];
	SUMMARY_TAB_ICONS.forEach((_, i) => cells.push(cell(SUMMARY.TABS + i, [78 + 31 * i, -1], [29, 13], [icon([9, 1], [11, 11]), hit()])));
	// Tocar no retrato/modelo toca o grito (ModelWidget.playCryOnClick; frente dados-ui).
	cells.push(cell(SUMMARY.PORTRAIT, [6, 32], [66, 66], [icon([0, 0], [66, 66]), hit(img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.08, layer: 1 }))]));
	// Markings (MarkingsWidget em x 29, y 102 + MarkingButton: textura 24×36, 3 estados na vertical); o texto é o estado.
	for (let i = 0; i < SUMMARY.MARKING_SLOTS; i++) {
		cells.push(cell(SUMMARY.MARKINGS + i, [29 + i * 7, 102], [6, 6], [0, 1, 2].map(state => ({
			[`state_${state}`]: {
				type: "image", layer: 7, ...at([0, 0], [6, 6]), uv: [0, state * 12], uv_size: [12, 12],
				bindings: [
					collection("#form_button_texture", "#texture"),
					collection("#form_button_texture_file_system", "#texture_file_system"),
					collection("#form_button_text"),
					view(`(#form_button_text = 'm${state}')`, "#visible"),
				],
			},
		})).concat([hit(img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.3, layer: 1 }))])));
	}
	// Frente ui-layout: cabeçalho como o Summary.kt: "Nv." (x 6, y 4,5) com a bola embaixo (x 3,5, y 15), status (x 34),
	// apelido (x 12, y 14,5) com o gênero (x 69), brilhante (x 62,5, y 33,5).
	cells.push(cell(SUMMARY.LEVEL, [3, 3], [30, 21], [
		clipText([3, 1.5], [27, 7], { scale: 0.65 }),
		icon([0.5, 12], [8, 9.8], { uv: [0, 0], uv_size: [18, 22] }),
	]));
	cells.push(cell(SUMMARY.STATUS, [34, 4], [39, 7], [icon([0, 0], [39, 7], { layer: 2 }), clipText([4, 1], [34, 6], { scale: 0.55 })]));
	cells.push(cell(SUMMARY.NAME, [12, 14], [64, 10], [clipText([0, 1], [55, 8], { scale: 0.75 }), icon([57, 1.5], [5, 7])]));
	cells.push(cell(SUMMARY.SHINY, [62.5, 33.5], [8, 8], [icon([0, 0], [8, 8], { layer: 5 })]));
	// Item segurado: ícone do espaço (x 3, y 104) e o nome no lugar do rótulo "Item segurado" (x 24, y 114,5).
	cells.push(cell(SUMMARY.ITEM, [3, 104], [70, 16], [
		img(`${GUI}/summary/icon_item_held`, [2, 2], [12, 12], { uv: [0, 0], uv_size: [12, 12] }),
		clipText([21, 10.5], [48, 5.5], { scale: 0.5 }),
	]));
	// Tipos: espaçador (x 5,5, y 126) + TypeIcon centrado em x 39, y 123.
	cells.push(typeSpacerCell(SUMMARY.TYPES, [5.5, 123], [67, 18], { single: `${GUI}/summary/type_spacer`, double: `${GUI}/summary/type_spacer_double`, at: [0, 3], size: [66, 12] }, { single: 24.5, double: 17 }));
	cells.push(cell(SUMMARY.TYPE2, [37.5, 123], [18, 18], [typeIcon([0, 0])]));
	cells.push(cell(SUMMARY.STUDIO, [6, 146], [24, 12], [
		img(`${GUI}/common/back_button`, [0, 0], [24, 12], { uv: [0, 0], uv_size: [26, 13] }),
		text([0, 2], [24, 10], { scale: 0.6, align: "center" }),
		hit(),
	]));
	if (!studio) {
		// PartyWidget (x 216, y 24): rótulo "Time" centrado em x 248,5; espaços em zigue-zague (x + 51 e y + 8 nos ímpares).
		controls.push({ party_bg: img(`${GUI}/summary/summary_party_background`, [216, 24], [114, 113], { layer: 2 }) });
		controls.push({ party_label: langLabel("cobblemon.ui.party", [216, 9.5], [65, 8], { scale: 0.8, align: "center" }) });
		for (let i = 0; i < 6; i++) {
			const x = 222 + (i % 2) * 51;
			const y = 31 + 32 * Math.floor(i / 2) + (i % 2) * 8;
			const slot = `${GUI}/summary/summary_party_slot`;
			cells.push(cell(SUMMARY.PARTY + i, [x, y], [46, 27], [
				img(slot, [0, 0], [46, 27], { uv: [0, 0], uv_size: [46, 27] }),
				selectedOverlay(slot, [0, 0], [46, 27], [0, 27], [46, 27]),
				icon([2, -2], [21, 21]),
				clipText([22, 13], [18, 5], { scale: 0.5, align: "center" }),
				hit(img(slot, [0, 0], [46, 27], { uv: [0, 27], uv_size: [46, 27] })),
			]));
			cells.push(cell(SUMMARY.PARTY_NAMES + i, [x + 4, y + 20], [39, 5], [clipText([0, 0], [35, 5], { scale: 0.5 }), icon([36, 0.5], [2.5, 3.5])]));
			cells.push(cell(SUMMARY.PARTY_BARS + i, [x + 4, y + 25], [37, 1], [icon([0, 0], [37, 1])]));
		}
	}
	controls.push({ cells: cellPanel([0, 0], [331, 161], cells) });
	// Conteúdo de cada aba (mesmos índices a partir de CONTENT, painéis diferentes).
	const tabPanel = (marker: string, content: Json[]) => cellPanel([77, 12], [134, 148], content, { layer: 3, bindings: titleVisibility(hasMarker(marker)) });
	controls.push({ info: tabPanel(SUB.SUMMARY_INFO, summaryInfo()) });
	controls.push({ stats: tabPanel(SUB.SUMMARY_STATS, summaryStats()) });
	controls.push({ moves: tabPanel(SUB.SUMMARY_MOVES, summaryMoves()) });
	controls.push({ marks: tabPanel(SUB.SUMMARY_MARKS, summaryMarks()) });
	// ExitButton do Java: x 302, y 145 (embaixo à direita). No estúdio (sem o painel do time), logo à direita do painel.
	controls.push(studio ? closeButton([213, 0], "top_left") : closeButton([306, 139], "top_left"));
	return {
		type: "panel",
		size: [studio ? 211 : 331, 161],
		anchor_from: "center",
		anchor_to: "center",
		// Estúdio: a janela do retrato (centro x = 39) no centro da tela, onde a câmera põe o modelo.
		offset: studio ? [105.5 - 39, 0] : [0, 0],
		layer: 2,
		bindings: titleVisibility(studio ? hasMarker(SUB.STUDIO) : lacksMarker(SUB.STUDIO)),
		controls,
	};
}

/**
 * Frente ui-polish: aba Atributos como o StatWidget (antes: linhas de texto + barras). Três painéis pelo modo no título:
 *  - gráfico hexagonal (STATS/IV/EV): summary_stats_chart (x 25,5, y 22, 83×96), os 6 setores do polígono (textura
 *    por passo, pintada com a cor do modo) e o rótulo + valor em cada vértice (hexagonVerticesOffset, escala 0,5), com a
 *    seta da natureza (x − 2, y − 4,5) e o rótulo em vermelho/azul;
 *  - pentágono de montaria (RIDE): summary_stats_chart_pentagon (x 20,5, y 22, 93×88), 5 setores com a cor do estilo e o
 *    ícone do estilo no centro (x 59, y 62,5; tocar troca o estilo);
 *  - OTHER: barras de 116×24 em x 9, y 15 + 29·i (underlay, preenchimento pintado, sobreposição, nome centrado em x 58,
 *    valor em x 9 e % em x 107);
 * e a barra de modos embaixo (y 143; x 31 + 24·i com 4 modos, x 23 + 22·i com 5), com o marcador em y 140.
 */
function summaryStats(): Json[] {
	const chart = (shape: RadarShape, modes: string[], extra: Json[]): Json[] => {
		const out: Json[] = [...extra];
		for (let k = 0; k < shape.sides; k++) {
			const [x, y, w, h] = radarSectorBox(shape, k);
			out.push(cell(SUMMARY.STAT_BARS + k, [x, y], [w, h], modes.map(mode => ({
				[`bg_radar_${mode}`]: {
					type: "image", layer: 2, ...at([0, 0], [w, h]), color: RADAR_COLORS[mode].map(v => Math.round(v / 255 * 1000) / 1000),
					bindings: [
						collection("#form_button_texture", "#texture"),
						collection("#form_button_texture_file_system", "#texture_file_system"),
						collection("#form_button_text"),
						view(`((#form_button_text = '${mode}') and not ((#texture = '') or (#texture = 'loading')))`, "#visible"),
					],
				},
			}))));
		}
		shape.labels.forEach(([lx, ly], k) => {
			const width = lx < 20 || lx > 114 ? 30 : 40;
			out.push(cell(SUMMARY.STAT_ROWS + k, [lx - width / 2, ly - 4.5], [width, 16], [
				icon([width / 2 - 2, 0], [4, 3]),
				clipText([0, 4.5], [width, 11], { scale: 0.5, align: "center" }),
			]));
		});
		return out;
	};
	const hex = chart(RADAR_HEXAGON, ["stats", "ivs", "evs"], [
		{ chart_image: img(`${GUI}/summary/summary_stats_chart`, [25.5, 22], [83, 96], { layer: 1 }) },
	]);
	const pent = chart(RADAR_PENTAGON, ["land", "liquid", "air"], [
		{ chart_image: img(`${GUI}/summary/summary_stats_chart_pentagon`, [20.5, 22], [93, 88], { layer: 1 }) },
	]);
	// Ícone do estilo de montaria no centro (a 6ª célula de rótulo, que o pentágono não usa).
	pent.push(cell(SUMMARY.STAT_ROWS + 5, [59, 62.5], [16, 16], [icon([0, 0], [16, 16]), hit()]));
	const other: Json[] = [];
	for (let i = 0; i < 4; i++) {
		const y = 15 + 29 * i;
		other.push(cell(SUMMARY.STAT_ROWS + i, [9, y], [116, 24], [
			img(`${GUI}/summary/summary_stats_other_bar`, [0, 0], [116, 24], { layer: 1 }),
			...Object.entries(STAT_FILL_MARKERS).map(([color, marker]) => ({
				[`fill_${color}`]: {
					type: "image", layer: 2, ...at([3, 13], [110, 10]), color: STAT_FILL_COLORS[color].map(v => Math.round(v / 255 * 1000) / 1000),
					bindings: [
						collection("#form_button_texture", "#texture"),
						collection("#form_button_texture_file_system", "#texture_file_system"),
						...whenMarker(marker),
					],
				},
			})),
			clipLine(STAT_BAR_LINES.NAME, [0, 2.5], [116, 8], { scale: 0.75, align: "center" }),
			clipLine(STAT_BAR_LINES.VALUE, [1, 6], [16, 5], { scale: 0.5, align: "center" }),
			clipLine(STAT_BAR_LINES.PERCENT, [97, 6], [20, 5], { scale: 0.5, align: "center" }),
		]));
		other.push(cell(SUMMARY.STAT_BARS + i, [12, y + 13], [110, 10], [icon([0, 0], [110, 10])]));
	}
	const mode = (panel: Json[], visible: string) => cellPanel([0, 0], [134, 148], panel, { layer: 1, bindings: titleVisibility(visible) });
	// Barra de modos: 4 (sem montaria) ou 5 (com); o título diz qual (SUMMARY_STATS_RIDE_TAB).
	const tabs = (count: number, start: number, width: number): Json[] => Array.from({ length: count }, (_, i) => cell(SUMMARY.STAT_TABS + i, [start + width * i - width / 2, 139], [width, 9], [
		{ marker: img(`${GUI}/summary/summary_stats_tab_marker`, [width / 2 - 2, 1], [4, 2], { layer: CONTENT_LAYER, bindings: whenMarker(SELECTED_MARKER) }) },
		// "Atributos" (pt_BR) é mais largo que o "Stats" do Java: 0,45 cabe nos 22 px da barra de 5.
		clipText([0, 4], [width, 5], { scale: count > 4 ? 0.45 : 0.5, align: "center" }),
		hit(),
	]));
	return [
		{ hexagon: mode(hex, `(${lacksMarker(SUB.SUMMARY_STATS_RIDE)} and ${lacksMarker(SUB.SUMMARY_STATS_OTHER)})`) },
		{ pentagon: mode(pent, hasMarker(SUB.SUMMARY_STATS_RIDE)) },
		{ other: mode(other, hasMarker(SUB.SUMMARY_STATS_OTHER)) },
		{ tabs4: mode(tabs(4, 31, 24), lacksMarker(SUB.SUMMARY_STATS_RIDE_TAB)) },
		{ tabs5: mode(tabs(5, 23, 22), hasMarker(SUB.SUMMARY_STATS_RIDE_TAB)) },
	];
}

/**
 * Aba Info (InfoWidget, 134×148): 6 linhas de 15 px com o rótulo em x 8 e o valor em x 53 (InfoOneLineWidget), o
 * ícone do tamanho (x 107,5, y 6,5), a descrição da habilidade (x 8, y 94,5, 3 linhas a 0,5), pontos de exp. e exp.
 * para o próximo nível (x 72,5, y 125/137; valores alinhados à direita em x 127) e a barra de EXP (x 72, y 131, 55 px).
 */
function summaryInfo(): Json[] {
	const out: Json[] = [];
	SUMMARY_INFO_LABELS.forEach((key, r) => {
		const y = 15 * r + 6;
		out.push({ [`label_${r}`]: langLabel(key, [8, y], [44, 8], { scale: 0.75 }) });
		const width = r === 0 ? 35 : 72;
		out.push(cell(SUMMARY_INFO.ROWS + r, [53, y], [width, 8], [clipText([0, 0], [width, 8], { scale: 0.75 })]));
	});
	out.push(cell(SUMMARY_INFO.SIZE, [107.5, 6.5], [18.5, 8], [icon([0, 0], [18.5, 8])]));
	out.push({ ability_description: clipGlobal("#form_text", [8, 94.5], [117, 16], { scale: 0.5 }) });
	// Rótulos a 0,35 (o "uniform" do Java é mais estreito que a fonte do Bedrock): cabem "Exp. p/ próximo nv." e 7 dígitos.
	out.push({ exp_label: langLabel("cobblemon.ui.info.experience_points", [72.5, 125.75], [31, 4], { scale: 0.35 }) });
	out.push({ next_label: langLabel("cobblemon.ui.info.to_next_level", [72.5, 137.75], [36, 4], { scale: 0.35 }) });
	out.push(cell(SUMMARY_INFO.EXP, [104, 125], [23, 5], [clipText([0, 0], [23, 5], { scale: 0.5, align: "right" })]));
	out.push(cell(SUMMARY_INFO.TO_NEXT, [109, 137], [18, 5], [clipText([0, 0], [18, 5], { scale: 0.5, align: "right" })]));
	out.push(cell(SUMMARY_INFO.EXP_BAR, [72, 131], [55, 1], expBar(55, 1)));
	// Caixa de baixo à esquerda (x 5..66, y 123..142): linhas do port (forma, Tera...).
	out.push(cell(SUMMARY_INFO.EXTRA, [8, 124.5], [56, 16], [clipText([0, 0], [56, 16], { scale: 0.5 })]));
	return out;
}

/**
 * Aba Golpes (MovesWidget): tiles 108×22 em x 13, y 6 + 25·i (MoveSlotWidget: tipo em x 2, nome em x 28, barra do PP
 * em x 60/y 13 com a categoria em x 66 e o PP centrado em x 93); embaixo poder/precisão/efeito (x 14, y 115/126/137,
 * valores alinhados em x 62,5) e a descrição rolável (x 69, y 113).
 */
function summaryMoves(): Json[] {
	const out: Json[] = [];
	for (let i = 0; i < 4; i++) {
		const y = 6 + 25 * i;
		out.push(cell(SUMMARY_MOVES.TILES + i, [13, y], [108, 22], [
			{ "tints@summary.move_tints": {} },
			img(`${GUI}/summary/summary_move_overlay`, [0, 0], [108, 22], { layer: 2 }),
			typeIcon([2, 2]),
			clipText([28, 3], [78, 8], { scale: 0.75 }),
			hit(),
		]));
		out.push(cell(SUMMARY_MOVES.PP + i, [73, y + 13], [47, 8], [
			img(`${GUI}/summary/summary_move_overlay_bar`, [0, 0], [47, 8], { layer: 2 }),
			...categoryIcons([6, 0.5], [12, 8]),
			clipText([19, 1.5], [28, 6], { scale: 0.6, align: "center" }),
		]));
	}
	(["power", "accuracy", "effect"] as const).forEach((stat, i) => {
		const y = 115 + 11 * i;
		out.push({ [`${stat}_icon`]: img(`${GUI}/summary/summary_moves_icon_${stat}`, [7, y - 0.5], [5, 5], { layer: 3 }) });
		out.push({ [`${stat}_label`]: langLabel(`cobblemon.ui.${stat}`, [14, y], [26, 5], { scale: 0.5 }) });
		out.push(cell([SUMMARY_MOVES.POWER, SUMMARY_MOVES.ACCURACY, SUMMARY_MOVES.EFFECT][i], [40, y], [22.5, 5], [clipText([0, 0], [22.5, 5], { scale: 0.5, align: "right" })]));
	});
	out.push({
		"description@common.scrolling_panel": {
			...at([69, 113], [59, 31]),
			layer: 4,
			$show_background: false,
			$scrolling_content: "summary.move_description",
			$scroll_size: [3, "100% - 2px"],
			$scrolling_pane_size: ["100% - 4px", "100%"],
			$scrolling_pane_offset: [0, 0],
			$scroll_bar_right_padding_size: [0, 0],
		},
	});
	return out;
}

/**
 * Aba Marcas (MarksWidget): ícone da marca escolhida (x 12, y 12), descrição (x 38, y 11, 85 px, 4 linhas a 0,5),
 * título centrado (y 38) e a grade de espaços 16 px (MarksScrollingWidget em x 9, y 45: 6 por linha, 20 px, 5 linhas).
 */
function summaryMarks(): Json[] {
	const out: Json[] = [];
	const slot = `${GUI}/summary/summary_mark_slot`;
	const pos = (i: number): [number, number] => [9 + 20 * (i % 6), 48 + 19 * Math.floor(i / 6)];
	for (let i = 0; i < 30; i++) out.push({ [`slot_${i}`]: img(slot, pos(i), [16, 16], { uv: [0, 0], uv_size: [16, 16], layer: 2 }) });
	for (let i = 0; i < SUMMARY.MARK_SLOTS; i++) {
		out.push(cell(SUMMARY_MARKS.SLOTS + i, pos(i), [16, 16], [
			selectedOverlay(slot, [0, 0], [16, 16], [0, 16], [16, 16]),
			icon([0, 0], [16, 16]),
			hit(img(slot, [0, 0], [16, 16], { uv: [0, 16], uv_size: [16, 16] })),
		]));
	}
	out.push(cell(SUMMARY_MARKS.SELECTED, [12, 12], [16, 16], [icon([0, 0], [16, 16])]));
	out.push({ description: clipGlobal("#form_text", [38, 11], [85, 20], { scale: 0.5 }) });
	out.push(cell(SUMMARY_MARKS.TITLE, [6, 38], [122, 5], [clipText([0, 0], [122, 5], { scale: 0.5, align: "center" })]));
	return out;
}

function summaryFile(): Json {
	return {
		namespace: "summary",
		"summary_form": {
			type: "panel",
			size: ["100%", "100%"],
			layer: 2,
			controls: [{ "normal@summary.canvas": {} }, { "studio@summary.canvas_studio": {} }],
		},
		"canvas": summaryCanvas(false),
		"canvas_studio": summaryCanvas(true),
		"move_tints": typeTintPanel(`${GUI}/summary/summary_move`, [108, 22], [108, 22]),
		"move_description": {
			type: "panel",
			size: ["100%", "100%c"],
			controls: [{ body: globalLabel("#form_text", [0, 0], ["100%", "default"], { scale: 0.5 }) }],
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Inicial (StarterSelectionScreen.kt, 239×197)

function starterCanvas(studio: boolean): Json {
	const controls: Json[] = [];
	const base = `${GUI}/starterselection/base`;
	if (studio) controls.push(...framedTexture("base", base, [239, 197], [6, 17, 118, 100]));
	else {
		controls.push({ window: img(`${GUI}/starterselection/background`, [6, 17], [118, 100], { layer: 1 }) });
		// Poké Ball de fundo (quadro 0 da animação de 16 quadros) e a base da plataforma (x 8,5, y 88).
		controls.push({ ball: img(`${GUI}/starterselection/background_poke_ball`, [10.5, 12.5], [109, 109], { uv: [0, 0], uv_size: [109, 109], layer: 1 }) });
		controls.push({ platform_base: img(`${GUI}/starterselection/platform_base`, [8.5, 88], [113, 32], { layer: 1 }) });
		controls.push({ base: img(base, [0, 0], [239, 197], { layer: 2 }) });
	}
	// Frente ui-layout: como o StarterSelectionScreen: o título vai centrado em x 172, y 11; a aba de cima à esquerda é
	// do Pokémon (bola em x 4, nome em x 14, número em x 79).
	controls.push({ title: clipGlobal("#title_text", [128, 10.5], [88, 8], { scale: 0.75, align: "center" }) });
	controls.push({ name_ball: img(`${GUI}/ball/poke_ball`, [4, 3], [8, 9.8], { uv: [0, 0], uv_size: [18, 22], layer: 3 }) });
	const cells: Json[] = [];
	for (let i = 0; i < STARTER.CATEGORY_SLOTS + 1; i++) {
		cells.push(cell(STARTER.CATEGORIES + i, [134, 27 + i * 12], [89, 11], [
			img(`${GUI}/starterselection/selection_container`, [0, 0], [89, 11], { alpha: 0.9 }),
			clipText([4, 2.5], [83, 7], { scale: 0.6 }),
			hit(),
		]));
	}
	cells.push(cell(STARTER.MODEL, [15, 17], [100, 100], [icon([0, 0], [100, 100], { layer: 4 })]));
	cells.push(cell(STARTER.PLATFORM, [8.5, 82], [113, 30], [icon([0, 0], [113, 30], { layer: 3 })]));
	cells.push(cell(STARTER.NAME, [14, 2], [63, 9], [clipText([0, 0.5], [63, 8], { scale: 0.8 }), hit()]));
	cells.push(cell(STARTER.DEX_NUMBER, [79, 1.5], [34, 8], [clipText([0, 0], [34, 8], { scale: 0.8 })]));
	// TypeIcon centrado em x 65, y 120; com um tipo, o espaçador simples em x 47, y 123.
	cells.push(typeSpacerCell(STARTER.TYPES, [47, 120], [36, 18], { single: `${GUI}/starterselection/type_spacer_single`, at: [0, 3], size: [36, 12] }, { single: 9, double: 1.5 }));
	cells.push(cell(STARTER.TYPE2, [63.5, 120], [18, 18], [typeIcon([0, 0])]));
	// Descrição da Pokédex: x 8, y 143, 114 px, até 5 linhas a 0,5.
	cells.push(cell(STARTER.DESCRIPTION, [8, 143], [114, 27], [clipText([0, 0], [114, 27], { scale: 0.5 })]));
	const arrow = (index: number, x: number, side: "left" | "right") => cell(index, [x, 52], [12, 24], [
		img(`${GUI}/pokedex/forms_arrow_${side}`, [1, 4], [10, 16], { uv: [0, 0], uv_size: [10, 16] }),
		hit(img(`${GUI}/pokedex/forms_arrow_${side}`, [1, 4], [10, 16], { uv: [0, 16], uv_size: [10, 16] })),
	]);
	cells.push(arrow(STARTER.PREVIOUS, 8, "left"));
	cells.push(arrow(STARTER.NEXT, 110, "right"));
	cells.push(cell(STARTER.CHOOSE, [13, 180], [106, 14], [
		img(`${GUI}/starterselection/choose_button`, [0, 0], [106, 14], { uv: [0, 0], uv_size: [106, 14] }),
		clipText([2, 3.5], [102, 8], { scale: 0.8, align: "center" }),
		hit(img(`${GUI}/starterselection/choose_button`, [0, 0], [106, 14], { uv: [0, 14], uv_size: [106, 14] })),
	]));
	cells.push(cell(STARTER.RANDOM, [134, 172], [75, 11], [
		img(`${GUI}/starterselection/selection_container`, [0, 0], [75, 11]),
		clipText([4, 2.5], [69, 7], { scale: 0.6 }),
		hit(),
	]));
	cells.push(cell(STARTER.STUDIO, [125, 182], [24, 12], [
		img(`${GUI}/common/back_button`, [0, 0], [24, 12], { uv: [0, 0], uv_size: [26, 13] }),
		text([0, 2], [24, 10], { scale: 0.6, align: "center" }),
		hit(),
	]));
	controls.push({ cells: cellPanel([0, 0], [239, 197], cells) });
	// ExitButton do Java: x 210, y 181.
	controls.push(closeButton([212, 175], "top_left"));
	return {
		type: "panel",
		size: [239, 197],
		anchor_from: "center",
		anchor_to: "center",
		// Estúdio: centro da janela (x = 65) no centro da tela.
		offset: studio ? [119.5 - 65, 0] : [0, 0],
		layer: 2,
		bindings: titleVisibility(studio ? hasMarker(SUB.STUDIO) : lacksMarker(SUB.STUDIO)),
		controls,
	};
}

function starterFile(): Json {
	return {
		namespace: "starter",
		"starter_form": {
			type: "panel",
			size: ["100%", "100%"],
			layer: 2,
			controls: [{ "normal@starter.canvas": {} }, { "studio@starter.canvas_studio": {} }],
		},
		"canvas": starterCanvas(false),
		"canvas_studio": starterCanvas(true),
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Pokédex (PokedexGUI.kt, 345×207)

function pokedexFile(): Json {
	const DEX = `${GUI}/pokedex`;
	const DARK_TEXT: TextOptions = { color: DARK, shadow: false };
	const button = (index: number, offset: Vec, size: [number, number]) => cell(index, offset, size, [
		img(`${DEX}/move_slot`, [0, 0], size, { uv: [0, 0], uv_size: [134, 13] }),
		clipText([2, 3.5], [size[0] - 4, 7], { scale: 0.55, align: "center" }),
		hit(),
	]);
	const frame = (index: number) => cell(index, [0, 0], [345, 207], [{ bg: icon([0, 0], [345, 207], { layer: 1 }) }]);
	// Cabeçalho (PokedexGUI.render): globo + região em x 36, y 14; vistos/capturados em x 262/300 com o ícone (x 252/290).
	const header = (region: number, seen: number, caught: number, prev: number, next: number): Json[] => [
		{ globe: img(`${DEX}/globe_icon`, [26, 15], [7, 7], { layer: 3 }) },
		cell(region, [36, 14], [57, 9], [clipText([0, 0.5], [57, 8], { scale: 0.8 })]),
		// Frente ui-polish: setas da região (PokedexGUI: ScaledButton 8×6 a 0,5 em x 95, y 14,5 e 19,5; a área de toque
		// tem 8×5 em volta da seta).
		cell(prev, [93, 13.5], [8, 5], [img(`${DEX}/arrow_up`, [2, 1], [4, 3], { uv: [0, 0], uv_size: [8, 6] }), hit(img(`${DEX}/arrow_up`, [2, 1], [4, 3], { uv: [0, 6], uv_size: [8, 6] }))]),
		cell(next, [93, 18.5], [8, 5], [img(`${DEX}/arrow_down`, [2, 1], [4, 3], { uv: [0, 0], uv_size: [8, 6] }), hit(img(`${DEX}/arrow_down`, [2, 1], [4, 3], { uv: [0, 6], uv_size: [8, 6] }))]),
		{ seen_icon: img(`${DEX}/caught_seen_icon`, [252, 15], [7, 7], { uv: [0, 0], uv_size: [14, 14], layer: 3 }) },
		cell(seen, [262, 14], [26, 9], [clipText([0, 0.5], [26, 8], { scale: 0.8 })]),
		{ caught_icon: img(`${DEX}/caught_seen_icon`, [290, 15], [7, 7], { uv: [0, 14], uv_size: [14, 14], layer: 3 }) },
		cell(caught, [300, 14], [26, 9], [clipText([0, 0.5], [26, 8], { scale: 0.8 })]),
	];
	// EntriesScrollingWidget (x 26, y 39): 5 colunas de 25 px + 2; rosto 21 px, número embaixo à direita, "?" para
	// espécie não registrada e a moldura de seleção na entrada aberta.
	const unknownSlot = `${DEX}/pokedex_slot_unknown`;
	const grid = (base: number): Json[] => Array.from({ length: POKEDEX_LIST.SLOT_COUNT }, (_, i) => cell(base + i, [26 + (i % 5) * 27, 39 + Math.floor(i / 5) * 27], [25, 25], [
		img(`${DEX}/pokedex_slot`, [0, 0], [25, 25]),
		selectedOverlay(`${DEX}/slot_select`, [0, 0], [25, 25], [0, 25], [25, 25]),
		{
			portrait: {
				type: "image", layer: CONTENT_LAYER, ...at([2, 1], [21, 17]),
				bindings: [
					collection("#form_button_texture", "#texture"),
					collection("#form_button_texture_file_system", "#texture_file_system"),
					view(`(not ((#texture = '') or (#texture = 'loading') or (#texture = '${unknownSlot}')))`, "#visible"),
				],
			},
		},
		{ icon_unknown: img(unknownSlot, [8.5, 4], [8, 10], { layer: CONTENT_LAYER, bindings: [collection("#form_button_texture"), view(`(#form_button_texture = '${unknownSlot}')`, "#visible")] }) },
		clipText([1, 19], [23, 5], { scale: 0.45, align: "right" }),
		hit(img(`${DEX}/slot_select`, [0, 0], [25, 25], { uv: [0, 0], uv_size: [25, 25] })),
	]));
	// Página anterior/próxima: setas na coluna da barra de rolagem (x 162).
	const arrows = (prev: number, next: number): Json[] => [
		cell(prev, [160, 40], [8, 6], [img(`${DEX}/arrow_up`, [0, 0], [8, 6], { uv: [0, 0], uv_size: [8, 6] }), hit(img(`${DEX}/arrow_up`, [0, 0], [8, 6], { uv: [0, 6], uv_size: [8, 6] }))]),
		cell(next, [160, 166], [8, 6], [img(`${DEX}/arrow_down`, [0, 0], [8, 6], { uv: [0, 0], uv_size: [8, 6] }), hit(img(`${DEX}/arrow_down`, [0, 0], [8, 6], { uv: [0, 6], uv_size: [8, 6] }))]),
	];
	const list = cellPanel([0, 0], [345, 207], [
		frame(POKEDEX_LIST.FRAME),
		...header(POKEDEX_LIST.REGION, POKEDEX_LIST.SEEN, POKEDEX_LIST.CAUGHT, POKEDEX_LIST.REGION_PREV, POKEDEX_LIST.REGION_NEXT),
		// Barra de busca (x 26, y 28) e de filtro (x 26, y 180), como o SearchWidget e o filtro de categoria.
		cell(POKEDEX_LIST.SEARCH, [26, 28], [139, 11], [
			img(`${DEX}/pokedex_screen_bar_search`, [0, 0], [139, 11]),
			img(`${DEX}/search_icon`, [3, 2], [7, 7], { layer: CONTENT_LAYER }),
			clipText([13, 2.5], [120, 7], { scale: 0.65 }),
			hit(),
		]),
		...grid(POKEDEX_LIST.SLOTS),
		...arrows(POKEDEX_LIST.PREVIOUS, POKEDEX_LIST.NEXT),
		cell(POKEDEX_LIST.FILTER, [26, 180], [139, 11], [
			img(`${DEX}/pokedex_screen_bar_category`, [0, 0], [139, 11]),
			img(`${DEX}/filter_icon`, [3, 2], [7, 7], { layer: CONTENT_LAYER }),
			clipText([13, 2.5], [122, 7], { scale: 0.65 }),
			hit(),
		]),
		// Direita: nada escolhido ainda (o Java abre com uma entrada escolhida; aqui, a página e os botões do port).
		{ info_overlay: img(`${DEX}/pokedex_screen_info_overlay`, [180, 28], [139, 163], { layer: 2 }) },
		{ unknown_platform: img(`${DEX}/platform_unknown`, [230.5, 60], [39, 45], { layer: 3 }) },
		{ body: clipGlobal("#form_text", [189, 120], [121, 50], { scale: 0.6, ...DARK_TEXT }) },
		button(POKEDEX_LIST.PROGRESS, [180, 179], [67, 13]),
		button(POKEDEX_LIST.BACK, [252, 179], [67, 13]),
	], { bindings: titleVisibility(hasMarker(SUB.POKEDEX_LIST)) });

	const tabIcons = ["info", "abilities", "size", "stats", "drops"];
	const tab = (index: number, i: number) => cell(index, [186.5 + 22 * i, 177.5], [16, 16], [
		icon([4, 4], [8, 8], { uv: [0, 0], uv_size: [16, 16] }),
		{ active: { ...icon([4, 4], [8, 8], { uv: [0, 16], uv_size: [16, 16], layer: CONTENT_LAYER + 1 }), bindings: [...whenMarker(SELECTED_MARKER), collection("#form_button_texture", "#texture")] } },
		{ arrow: img(`${DEX}/select_arrow`, [5, 0], [6, 3], { layer: CONTENT_LAYER + 1, bindings: whenMarker(SELECTED_MARKER) }) },
		hit(),
	]);
	const entry = cellPanel([0, 0], [345, 207], [
		frame(POKEDEX_ENTRY.FRAME),
		...header(POKEDEX_ENTRY.REGION, POKEDEX_ENTRY.SEEN, POKEDEX_ENTRY.CAUGHT_COUNT, POKEDEX_ENTRY.REGION_PREV, POKEDEX_ENTRY.REGION_NEXT),
		{ search_bar: img(`${DEX}/pokedex_screen_bar_search`, [26, 28], [139, 11], { layer: 2 }) },
		...grid(POKEDEX_ENTRY.SLOTS),
		...arrows(POKEDEX_ENTRY.PREVIOUS, POKEDEX_ENTRY.NEXT),
		cell(POKEDEX_ENTRY.BACK, [26, 180], [139, 11], [
			img(`${DEX}/pokedex_screen_bar_category`, [0, 0], [139, 11]),
			clipText([4, 2.5], [131, 7], { scale: 0.65 }),
			hit(),
		]),
		// PokemonInfoWidget (x 180, y 28): número + nome (y 29), capturado (x 309), barra de tipos (y 42, ícones em x 183),
		// forma alinhada à direita (x 316, y 43), janela do retrato (y 52), plataforma (y 94/97).
		{ info_overlay: img(`${DEX}/pokedex_screen_info_overlay`, [180, 28], [139, 163], { layer: 2 }) },
		cell(POKEDEX_ENTRY.NAME, [183, 29], [124, 9], [clipText([0, 0.5], [124, 8], { scale: 0.8 })]),
		cell(POKEDEX_ENTRY.CAUGHT, [309, 30], [7, 7], [icon([0, 0], [7, 7], { layer: 6 })]),
		cell(POKEDEX_ENTRY.TYPES, [180, 42], [139, 25], [
			{ bar: img(`${DEX}/type_bar`, [0, 0], [139, 25], { layer: 2, bindings: [collection("#form_button_text"), view(`(not (#form_button_text = '${TYPE_DOUBLE}'))`, "#visible")] }) },
			{ bar_double: img(`${DEX}/type_bar_double`, [0, 0], [139, 25], { layer: 2, bindings: whenText(TYPE_DOUBLE) }) },
			typeIcon([3, 3]),
		]),
		cell(POKEDEX_ENTRY.TYPE2, [198, 45], [18, 18], [typeIcon([0, 0])]),
		cell(POKEDEX_ENTRY.FORM_NAME, [236, 43.5], [80, 8], [clipText([0, 0], [80, 8], { scale: 0.75, align: "right" })]),
		{ viewport: img(`${DEX}/pokedex_screen_info_viewport`, [180, 52], [139, 70], { layer: 3 }) },
		{ ball: img(`${DEX}/pokedex_screen_poke_ball`, [195, 53], [109, 68], { uv: [0, 0], uv_size: [109, 68], layer: 3 }) },
		{ platform_base: img(`${DEX}/platform_base`, [193, 97], [113, 24], { layer: 3 }) },
		cell(POKEDEX_ENTRY.PLATFORM, [193, 94], [113, 27], [icon([0, 0], [113, 27], { layer: 4 })]),
		cell(POKEDEX_ENTRY.PROFILE, [222, 56], [56, 56], [icon([0, 0], [56, 56], { layer: 5 })]),
		cell(POKEDEX_ENTRY.UNKNOWN, [230.5, 67], [39, 45], [icon([0, 0], [39, 45], { layer: 5 })]),
		cell(POKEDEX_ENTRY.FORM_PREV, [183, 76], [8, 16], [img(`${DEX}/forms_arrow_left_compact`, [0, 0], [8, 16], { uv: [0, 0], uv_size: [8, 16] }), hit(img(`${DEX}/forms_arrow_left_compact`, [0, 0], [8, 16], { uv: [0, 16], uv_size: [8, 16] }))]),
		cell(POKEDEX_ENTRY.FORM_NEXT, [308, 76], [8, 16], [img(`${DEX}/forms_arrow_right_compact`, [0, 0], [8, 16], { uv: [0, 0], uv_size: [8, 16] }), hit(img(`${DEX}/forms_arrow_right_compact`, [0, 0], [8, 16], { uv: [0, 16], uv_size: [8, 16] }))]),
		// Texto da aba (InfoTextScrollWidget: x 180 + 9, y 135 + 3, 118 px a 0,5) e os ícones das abas (x 190,5 + 22·i, y 181,5).
		{
			"body_scroll@common.scrolling_panel": {
				...at([188, 136], [124, 40]),
				layer: 4,
				$show_background: false,
				$scrolling_content: "pokedex.entry_body",
				$scroll_size: [3, "100% - 2px"],
				$scrolling_pane_size: ["100% - 5px", "100%"],
				$scrolling_pane_offset: [1, 0],
				$scroll_bar_right_padding_size: [0, 0],
			},
		},
		...tabIcons.map((_, i) => tab(POKEDEX_ENTRY.TABS + i, i)),
		tab(POKEDEX_ENTRY.MOVES, tabIcons.length),
	], { bindings: titleVisibility(hasMarker(SUB.POKEDEX_ENTRY)) });
	return {
		namespace: "pokedex",
		"pokedex_form": {
			type: "panel",
			size: [345, 207],
			anchor_from: "center",
			anchor_to: "center",
			layer: 2,
			controls: [
				{ screen: img(`${DEX}/pokedex_screen`, [0, 0], [345, 207], { layer: 2 }) },
				{ list },
				{ entry },
				closeButton([-6, 4]),
			],
		},
		"entry_body": {
			type: "panel",
			size: ["100%", "100%c"],
			controls: [{ body: { ...globalLabel("#form_text", [0, 0], ["100%", "default"], { scale: 0.5, color: DARK, shadow: false }) } }],
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// PC (PCGUI.kt, 349×205)

/** Pastas dos papéis de parede no RP (scripts/GUI/PCWallpapers.ts: `textures/gui/pc/wallpaper/<pasta>/...`). */
const WALLPAPER_ROOT = "textures/gui/pc/wallpaper/";
const WALLPAPER_FOLDERS = ["basic", "biome", "misc"];

function pcFile(): Json {
	const slot = (index: number, offset: Vec) => cell(index, offset, [25, 25], [
		icon([1, 0], [23, 23]),
		// Filtro da caixa (frente dados-ui): quem não passa fica escurecido.
		{
			dim: {
				...img(HIGHLIGHT, [0, 0], [25, 25], { layer: 8, alpha: 0.7, color: [0, 0, 0] }),
				bindings: [collection("#form_button_text"), view(`(not ((#form_button_text - '${PC_DIM_MARKER}') = #form_button_text))`, "#visible")],
			},
		},
		hit(img(`${GUI}/pc/pc_slot_overlay`, [0, 0], [25, 25])),
	]);
	const boxSlots: Json[] = [];
	for (let i = 0; i < 30; i++) boxSlots.push(slot(PC.SLOTS + i, [7 + (i % 6) * 27, 11 + Math.floor(i / 6) * 27]));
	const partyPos: [number, number][] = [[276, 51], [308, 59], [276, 83], [308, 91], [276, 115], [308, 123]];
	return {
		namespace: "pc",
		// Roteado por ui/cobblemon_forms.json (marcador §0§1§r).
		"pc_form": {
			type: COLLECTION_PANEL,
			size: [349, 205],
			anchor_from: "center",
			anchor_to: "center",
			layer: 2,
			collection_name: "form_buttons",
			controls: [
				{ base: img(`${GUI}/pc/pc_base`, [0, 0], [349, 205]) },
				{ portrait_bg: img(`${GUI}/pc/portrait_background`, [6, 27], [66, 66], { layer: 2 }) },
				{ party_panel: img(`${GUI}/pc/party_panel`, [267, 27], [82, 169], { layer: 2 }) },
				{ "box@pc.pc_content": {} },
				{ screen_overlay: img(`${GUI}/pc/pc_screen_overlay`, [85, 27], [174, 155], { layer: 4 }) },
				cell(PC.PREV, [117, 12], [14, 14], [
					img(`${GUI}/pc/pc_arrow_previous`, [0, 0], [14, 14], { uv: [0, 0], uv_size: [14, 14] }),
					hit(img(`${GUI}/pc/pc_arrow_previous`, [0, 0], [14, 14], { uv: [0, 14], uv_size: [14, 14] })),
				]),
				cell(PC.BOX, [133, 13], [85, 12], [text([0, 1], [85, 10], { scale: 0.75, align: "center" }), hit()]),
				cell(PC.NEXT, [220, 12], [14, 14], [
					img(`${GUI}/pc/pc_arrow_next`, [0, 0], [14, 14], { uv: [0, 0], uv_size: [14, 14] }),
					hit(img(`${GUI}/pc/pc_arrow_next`, [0, 0], [14, 14], { uv: [0, 14], uv_size: [14, 14] })),
				]),
				...partyPos.map(([x, y], i) => slot(PC.PARTY + i, [x, y])),
				cell(PC.PREVIEW, [6, 27], [66, 66], [icon([0, 0], [66, 66], { layer: 4 })]),
				// Frente ui-layout: painel da esquerda do PCGUI: "Nv." (x 6, y 1,5) + bola (x 3,5, y 12), nome (x 12, y 11,5) +
				// gênero (x 69), brilhante (x 62,5, y 28,5), item (x 3, y 98; rótulo em x 24, y 108,5), tipos pequenos no
				// espaçador (x 9, y 118,5; TypeIcon centrado em x 40,5, y 117) e a caixa de informação (x 9, y 128, 63×69).
				cell(PC.PREVIEW_LEVEL, [3, 1], [30, 21], [clipText([3, 0.5], [27, 7], { scale: 0.65 }), icon([0.5, 11], [8, 9.8], { uv: [0, 0], uv_size: [18, 22] })]),
				cell(PC.PREVIEW_NAME, [12, 11.5], [64, 9], [clipText([0, 0.5], [55, 8], { scale: 0.75 }), icon([57, 0.5], [5, 7])]),
				cell(PC.PREVIEW_SHINY, [62.5, 28.5], [8, 8], [icon([0, 0], [8, 8], { layer: 5 })]),
				cell(PC.PREVIEW_ITEM, [3, 98], [70, 16], [
					img(`${GUI}/summary/icon_item_held`, [2, 2], [12, 12], { uv: [0, 0], uv_size: [12, 12] }),
					clipText([21, 10.5], [48, 5.5], { scale: 0.5 }),
				]),
				cell(PC.PREVIEW_TYPES, [9, 117], [63, 9], [
					{ spacer_single: img(`${GUI}/pc/type_spacer_single`, [0, 1.5], [63, 6], { layer: 2, bindings: whenText(TYPE_SINGLE) }) },
					{ spacer_double: img(`${GUI}/pc/type_spacer_double`, [0, 1.5], [63, 6], { layer: 2, bindings: whenText(TYPE_DOUBLE) }) },
					{ single: typeIcon([27, 0], [9, 9], { bindings: whenText(TYPE_SINGLE) }, true) },
					{ double: typeIcon([22, 0], [9, 9], { bindings: whenText(TYPE_DOUBLE) }, true) },
				]),
				cell(PC.PREVIEW_TYPE2, [41, 117], [9, 9], [typeIcon([0, 0], [9, 9], {}, true)]),
				{ info_box: img(`${GUI}/pc/info_box`, [9, 128], [63, 69], { layer: 2 }) },
				// Página 0 (rótulos centrados em x 40,5: y 129,5 / 146,5 / 163,5; valores em y 137 / 154 / 170,5 + 7·i).
				cell(PC.PREVIEW_NATURE, [9, 128], [63, 15], [
					langLabel("cobblemon.ui.info.nature", [2, 1.5], [59, 5], { scale: 0.5, align: "center" }),
					clipText([2, 9], [59, 5], { scale: 0.5, align: "center" }),
				]),
				cell(PC.PREVIEW_ABILITY, [9, 145], [63, 15], [
					langLabel("cobblemon.ui.info.ability", [2, 1.5], [59, 5], { scale: 0.5, align: "center" }),
					clipText([2, 9], [59, 5], { scale: 0.5, align: "center" }),
				]),
				cell(PC.PREVIEW_MOVES, [9, 162], [63, 35], [
					langLabel("cobblemon.ui.moves", [2, 1.5], [59, 5], { scale: 0.5, align: "center" }),
					clipText([2, 8.5], [59, 25], { scale: 0.5, align: "center" }),
				]),
				// Páginas 1 e 2: IVs e EVs.
				cell(PC.PREVIEW_TEXT, [9, 128], [63, 69], [clipText([2, 1.5], [59, 66], { scale: 0.5, align: "center" })]),
				cell(PC.PREVIEW_PAGE, [9, 128], [63, 69], [hit(img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.08, layer: 1 }))]),
				closeButton([-3, 3]),
			],
		},
		// Caixa: papel de parede (corpo do form = caminho da textura; vazio = sem papel) atrás dos 30 espaços 6×5
		// (frente extras-final: o 1º controle continua sendo o papel de parede ligado a #form_text).
		"pc_content": {
			type: COLLECTION_PANEL,
			collection_name: "form_buttons",
			layer: 3,
			...at([85, 27], [174, 155]),
			controls: [
				{
					// StorageWidget: o papel de parede ocupa a tela inteira (174×155) na origem da tela.
					wallpaper: {
						type: "image",
						layer: 0,
						...at([0, 0], [174, 155]),
						bindings: [
							{ binding_name: "#form_text", binding_name_override: "#texture" },
							view("(not (#texture = ''))", "#visible"),
						],
					},
				},
				// Frente visual-final: camada `glow/` do papel de parede (StorageWidget: 208×189 em x − 17, y − 17, entre o
				// papel e a grade). O caminho sai do corpo: <pasta>/[alt/]<nome> → <pasta>/glow/<nome>; uma imagem por pasta.
				...WALLPAPER_FOLDERS.map((folder) => ({
					[`wallpaper_glow_${folder}`]: {
						type: "image",
						layer: 1,
						...at([-17, -17], [208, 189]),
						bindings: [
							{ binding_name: "#form_text" },
							view(`('${WALLPAPER_ROOT}${folder}/glow/' + ((#form_text - '${WALLPAPER_ROOT}${folder}/') - 'alt/'))`, "#texture"),
							view(`(not ((#form_text - '${WALLPAPER_ROOT}${folder}/') = #form_text))`, "#visible"),
						],
					},
				})),
				{ grid: img(`${GUI}/pc/pc_screen_grid`, [7, 11], [160, 133], { layer: 2, alpha: 0.6 }) },
				...boxSlots,
			],
		},
		// Mantido para compatibilidade (layout antigo em lista rolável; não é mais roteado).
		"scrolling_panel@common.scrolling_panel": {
			anchor_to: "top_left",
			anchor_from: "top_left",
			$show_background: false,
			layer: 1,
			size: ["100%", "100%"],
			$scrolling_content: "pc.pc_content",
			$scroll_size: [5, "100% - 4px"],
			$scrolling_pane_size: ["100% - 4px", "100% - 2px"],
			$scrolling_pane_offset: [2, 0],
			$scroll_bar_right_padding_size: [0, 0],
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Scanner da Pokédex (PokedexScannerRenderer): overlay pelo actionbar com prefixo `cbS`.

function scannerFile(): Json {
	const S = `${GUI}/pokedex/scan`;
	return {
		namespace: "cobblemon_scanner",
		// Criado pela 2ª fábrica hud_actionbar_text_factory (ui/hud_screen.json) a cada mensagem de actionbar; só
		// aparece quando a mensagem começa com "cbS". Some sozinho em 1,5 s (o script reenvia enquanto escaneia).
		"scan_overlay": {
			type: "panel",
			size: ["100%", "100%"],
			layer: 1,
			$atext: "$actionbar_text",
			$scan_text: "($actionbar_text - 'cbS')",
			visible: "(not (($atext - 'cbS') = $atext))",
			alpha: "@cobblemon_scanner.scan_life",
			propagate_alpha: true,
			controls: [
				{ scanlines: { type: "image", texture: `${S}/overlay_scanlines`, size: ["100%", "100%"], tiled: true, alpha: 0.35, layer: 1 } },
				{ border_top: { type: "image", texture: `${S}/overlay_border_top`, size: ["100%", 16], anchor_from: "top_middle", anchor_to: "top_middle", layer: 2 } },
				{ border_bottom: { type: "image", texture: `${S}/overlay_border_bottom`, size: ["100%", 16], anchor_from: "bottom_middle", anchor_to: "bottom_middle", layer: 2 } },
				{ border_left: { type: "image", texture: `${S}/overlay_border_left`, size: [16, "100%"], anchor_from: "left_middle", anchor_to: "left_middle", layer: 2 } },
				{ border_right: { type: "image", texture: `${S}/overlay_border_right`, size: [16, "100%"], anchor_from: "right_middle", anchor_to: "right_middle", layer: 2 } },
				{ ring_outer: { type: "image", texture: `${S}/scan_ring_outer`, size: [120, 120], anchor_from: "center", anchor_to: "center", layer: 3, alpha: 0.8 } },
				{ ring_middle: { type: "image", texture: `${S}/scan_ring_middle`, size: [90, 90], anchor_from: "center", anchor_to: "center", layer: 3, alpha: 0.8 } },
				{ ring_inner: { type: "image", texture: `${S}/scan_ring_inner`, size: [60, 60], anchor_from: "center", anchor_to: "center", layer: 3, alpha: 0.8 } },
				{ pointer: { type: "image", texture: `${S}/pointer`, size: [9, 9], anchor_from: "center", anchor_to: "center", layer: 4 } },
				{
					info: {
						type: "image",
						texture: `${S}/scan_info_frame`,
						size: ["100%c + 12px", 22],
						anchor_from: "bottom_middle",
						anchor_to: "bottom_middle",
						offset: [0, -40],
						layer: 4,
						controls: [{ text: { type: "label", text: "$scan_text", color: [1, 1, 1], shadow: true, anchor_from: "center", anchor_to: "center", layer: 5, localize: false } }],
					},
				},
			],
		},
		"scan_life": {
			anim_type: "alpha",
			easing: "in_expo",
			duration: 1.5,
			from: 1,
			to: 1,
			destroy_at_end: "hud_actionbar_text",
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------

const HEADER = "// GERADO por tools/ui/gen-telas.ts (frente telas). Não edite à mão: mude o gerador e rode-o de novo.\n";

export function generate(): Record<string, string> {
	const files: Record<string, Json> = {
		"battle.json": battleFile(),
		"summary.json": summaryFile(),
		"starter.json": starterFile(),
		"pokedex.json": pokedexFile(),
		"pc.json": pcFile(),
		"dialogue.json": dialogueFile(),
		"cobblemon_scanner.json": scannerFile(),
	};
	// Um elemento por linha (compacto; o cliente lê ~5× menos texto que com indentação).
	const serialize = (json: Json) => "{\n" + Object.entries(json).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n}\n";
	return Object.fromEntries(Object.entries(files).map(([name, json]) => [name, HEADER + serialize(nameControls(json) as Json)]));
}

/**
 * Frente ui-cliente: todo item de `controls` precisa ser `{ "nome[@base]": { ... } }`. Os ajudantes `img`/`icon`/`text`
 * devolvem a definição crua, e dentro das células ela entrava sem nome: o cliente registra "Type not specified (or
 * @-base not found)" e descarta o controle (ícones, textos e fundos das células sumiam; o BDS não carrega UI e não vê).
 * Aqui cada item sem nome ganha um nome estável pelo tipo e pela posição (`image_0`, `label_1`...).
 */
function nameControls(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(nameControls);
	if (!node || typeof node !== "object") return node;
	const out: Json = {};
	for (const [key, value] of Object.entries(node as Json)) {
		if (key === "controls" && Array.isArray(value)) {
			out[key] = value.map((el: Json, i: number) => {
				const keys = Object.keys(el);
				const named = keys.length === 1 && el[keys[0]] && typeof el[keys[0]] === "object" && !Array.isArray(el[keys[0]]);
				return named ? { [keys[0]]: nameControls(el[keys[0]]) } : { [`${typeof el.type === "string" ? el.type : "control"}_${i}`]: nameControls(el) };
			});
		}
		else if (key === "bindings" || key === "property_bag") out[key] = value;
		else out[key] = nameControls(value);
	}
	return out;
}

// Só como CLI (não quando empacotado nos testes, onde import.meta.url é o bundle).
if (import.meta.url.endsWith("/gen-telas.ts") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const check = process.argv.includes("--check");
	const stale: string[] = [];
	for (const [name, content] of Object.entries(generate())) {
		const path = join(UI_DIR, name);
		if (check) {
			let current = "";
			try { current = readFileSync(path, "utf8"); } catch { }
			if (current !== content) stale.push(name);
		}
		else writeFileSync(path, content);
	}
	if (stale.length) {
		console.error(`desatualizado(s): ${stale.join(", ")} (rode node --experimental-strip-types tools/ui/gen-telas.ts)`);
		process.exit(1);
	}
	console.log(check ? "gen-telas: em dia" : "gen-telas: arquivos escritos");
}
