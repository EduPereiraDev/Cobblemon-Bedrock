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
	BATTLE_ACTION, BATTLE_MOVES, BATTLE_SWITCH, BATTLE_TARGET, GIMMICK_ON_MARKER, GUI, PC, PC_DIM_MARKER, POKEDEX_ENTRY, POKEDEX_LIST, STARTER, SUB,
	SUMMARY, TYPE_HUES, typeKeyTexture,
} from "../../scripts/GUI/layoutSpec.ts";

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
		layer: 3,
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
 * Área clicável da célula (herda `common.button`). `hover`/`pressed`: controles do estado; padrão = realce branco.
 */
function hit(hover?: Json, pressed?: Json): Json {
	const highlight = img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.28, layer: 1 });
	return {
		"hit@common.button": {
			$pressed_button_name: "button.form_button_click",
			...at([0, 0], ["100%", "100%"]),
			layer: 20,
			bindings: [{ binding_type: "collection_details", binding_collection_name: "form_buttons" }],
			controls: [
				{ default: { type: "panel" } },
				{ hover: hover ?? highlight },
				{ pressed: pressed ?? hover ?? highlight },
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

/** Painel que contém células (precisa do `collection_name` do form). */
function cellPanel(offset: Vec, size: Vec, controls: Json[], extra: Json = {}): Json {
	return { type: "panel", collection_name: "form_buttons", layer: 2, ...at(offset, size), ...extra, controls };
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

/** Botão fechar da vanilla (button.menu_exit → form cancelado). */
function closeButton(offset: Vec): Json {
	return { "close@common.close_button": { anchor_from: "top_right", anchor_to: "top_right", offset, layer: 30 } };
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
		icon([0, 0], [90, 26], { uv: [0, 0], uv_size: [90, 26], layer: 2 }),
		text([6, 8], [80, 10], {}),
		hit(icon([0, 0], [90, 26], { uv: [0, 26], uv_size: [90, 26], layer: 2 })),
	]));
	const moveOffsets: Vec[] = [[0, 0], [97, 0], [0, 29], [97, 29]];
	const moveTiles = moveOffsets.map((o, i) => cell(BATTLE_MOVES.MOVES + i, o, [92, 24], [
		{ "tints@battle.move_tints": {} },
		img(`${GUI}/battle/battle_move_overlay`, [0, 0], [92, 24], { layer: 2 }),
		text([5, 2], [85, 20], { scale: 0.75 }),
		hit(),
	]));
	const back = (index: number, offset: Vec) => cell(index, offset, [26, 13], [
		img(`${GUI}/common/back_button`, [0, 0], [26, 13], { uv: [0, 0], uv_size: [26, 13] }),
		hit(img(`${GUI}/common/back_button`, [0, 0], [26, 13], { uv: [0, 13], uv_size: [26, 13], layer: 1 })),
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
	const gimmickButtons = Array.from({ length: BATTLE_MOVES.GIMMICK_SLOTS }, (_, i) => cell(BATTLE_MOVES.GIMMICKS + i, [20 + 26 * i, 58], [18, 17], [
		gimmickFrame(0, undefined, 2),
		gimmickFrame(34, toggledOn, 3),
		hit(gimmickFrame(34, undefined, 2)),
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
			text([6, 6], [84, 20], { scale: 0.7 }),
			hit(img(`${GUI}/battle/party_select`, [1, 1], [94, 29], { uv: [0, 29], uv_size: [94, 29] })),
		],
		bindings: [collection("#form_button_text"), view("(not (#form_button_text = ''))", "#visible")],
	};
	const prompt = globalLabel("#title_text", [0, -12], [220, 10], {});
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
				{ tiles: cellPanel([20, -31], [189, 53], [{ prompt }, ...moveTiles, back(BATTLE_MOVES.BACK, [-18, 58]), ...gimmickButtons], { anchor_from: "bottom_left", anchor_to: "bottom_left" }) },
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
		controls.push({ [`tab_base_${i}`]: img(`${GUI}/summary/${SUMMARY_TAB_BASES[i]}`, [77, 12], [134, 148], { layer: 2, bindings: titleVisibility(hasMarker(marker)) }) });
		controls.push({ [`tab_active_${i}`]: img(`${GUI}/summary/summary_tab`, [78 + 31 * i - 5, -1], [39, 13], { layer: 2, bindings: titleVisibility(hasMarker(marker)) }) });
	});
	const cells: Json[] = [];
	SUMMARY_TAB_ICONS.forEach((_, i) => cells.push(cell(SUMMARY.TABS + i, [78 + 31 * i, -1], [29, 13], [icon([9, 1], [11, 11]), hit()])));
	// Tocar no retrato/modelo toca o grito (ModelWidget.playCryOnClick; frente dados-ui).
	cells.push(cell(SUMMARY.PORTRAIT, [6, 32], [66, 66], [icon([0, 0], [66, 66]), hit(img(HIGHLIGHT, [0, 0], ["100%", "100%"], { alpha: 0.08, layer: 1 }))]));
	// Markings (MarkingsWidget + MarkingButton: textura 24×36, 3 estados na vertical); o texto do botão é o estado.
	for (let i = 0; i < SUMMARY.MARKING_SLOTS; i++) {
		cells.push(cell(SUMMARY.MARKINGS + i, [29 + i * 7, 99], [6, 6], [0, 1, 2].map(state => ({
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
	cells.push(cell(SUMMARY.NAME, [6, 18], [66, 10], [text([0, 0], [66, 10], { scale: 0.75 })]));
	cells.push(cell(SUMMARY.LEVEL, [6, 3], [66, 11], [
		text([0, 2], [52, 9], { scale: 0.6 }),
		icon([56, 0], [9, 11], { uv: [0, 0], uv_size: [18, 22] }),
	]));
	cells.push(cell(SUMMARY.ITEM, [6, 104], [66, 20], [
		img(`${GUI}/summary/icon_item_held`, [0, 0], [12, 12], { uv: [0, 0], uv_size: [12, 12] }),
		text([14, 2], [52, 18], { scale: 0.5 }),
	]));
	cells.push(cell(SUMMARY.TYPES, [6, 124], [66, 20], [text([0, 0], [66, 20], { scale: 0.6 })]));
	cells.push(cell(SUMMARY.STUDIO, [6, 146], [24, 12], [
		img(`${GUI}/common/back_button`, [0, 0], [24, 12], { uv: [0, 0], uv_size: [26, 13] }),
		text([0, 2], [24, 10], { scale: 0.6, align: "center" }),
		hit(),
	]));
	if (!studio) {
		controls.push({ party_bg: img(`${GUI}/summary/summary_party_background`, [213, 24], [114, 113], { layer: 2 }) });
		const party: [number, number][] = [[218, 32], [269, 35], [218, 64], [269, 67], [218, 96], [269, 99]];
		party.forEach(([x, y], i) => cells.push(cell(SUMMARY.PARTY + i, [x, y], [46, 27], [
			img(`${GUI}/summary/summary_party_slot`, [0, 0], [46, 27], { uv: [0, 0], uv_size: [46, 27] }),
			icon([2, 2], [23, 23]),
			text([26, 9], [20, 10], { scale: 0.5 }),
			hit(img(`${GUI}/summary/summary_party_slot`, [0, 0], [46, 27], { uv: [0, 27], uv_size: [46, 27] })),
		])));
	}
	controls.push({ cells: cellPanel([0, 0], [331, 161], cells) });
	// Conteúdo de cada aba (mesmos índices a partir de CONTENT, painéis diferentes).
	const tabPanel = (marker: string, content: Json[]) => cellPanel([77, 12], [134, 148], content, { layer: 3, bindings: titleVisibility(hasMarker(marker)) });
	controls.push({ info: tabPanel(SUB.SUMMARY_INFO, [{ body: globalLabel("#form_text", [6, 12], [122, "default"], { scale: 0.55 }) }]) });
	const statRows: Json[] = [];
	for (let i = 0; i < 6; i++) {
		statRows.push(cell(SUMMARY.STAT_ROWS + i, [6, 12 + i * 17], [122, 9], [text([0, 0], [122, 9], { scale: 0.55 })]));
		statRows.push(cell(SUMMARY.STAT_BARS + i, [6, 21 + i * 17], [97, 3], [icon([0, 0], [97, 3])]));
	}
	controls.push({ stats: tabPanel(SUB.SUMMARY_STATS, [...statRows, { body: globalLabel("#form_text", [6, 116], [122, "default"], { scale: 0.5 }) }]) });
	const moves = [0, 1, 2, 3].map(i => cell(SUMMARY.MOVES + i, [13, 12 + i * 25], [108, 22], [
		{ "tints@summary.move_tints": {} },
		img(`${GUI}/summary/summary_move_overlay`, [0, 0], [108, 22], { layer: 2 }),
		text([6, 3], [98, 18], { scale: 0.6 }),
		hit(),
	]));
	controls.push({ moves: tabPanel(SUB.SUMMARY_MOVES, [...moves, { body: globalLabel("#form_text", [6, 114], [122, "default"], { scale: 0.5 }) }]) });
	const marks: Json[] = [];
	for (let i = 0; i < SUMMARY.MARK_SLOTS; i++) {
		marks.push(cell(SUMMARY.MARKS + i, [9 + (i % 4) * 30, 12 + Math.floor(i / 4) * 30], [26, 26], [
			img(`${GUI}/summary/summary_mark_slot`, [5, 0], [16, 16], { uv: [0, 0], uv_size: [16, 16] }),
			icon([0, 0], [26, 26]),
			hit(),
		]));
	}
	controls.push({ marks: tabPanel(SUB.SUMMARY_MARKS, [...marks, { body: globalLabel("#form_text", [6, 104], [122, "default"], { scale: 0.5 }) }]) });
	controls.push(closeButton([-2, 2]));
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
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Inicial (StarterSelectionScreen.kt, 239×197)

function starterCanvas(studio: boolean): Json {
	const controls: Json[] = [];
	const base = `${GUI}/starterselection/base`;
	if (studio) controls.push(...framedTexture("base", base, [239, 197], [6, 17, 118, 100]));
	else {
		controls.push({ base: img(base, [0, 0], [239, 197]) });
		controls.push({ window: img(`${GUI}/starterselection/background`, [6, 17], [118, 100], { layer: 2 }) });
	}
	controls.push({ title: globalLabel("#title_text", [8, 4], [220, 10], { scale: 0.75 }) });
	const cells: Json[] = [];
	for (let i = 0; i < STARTER.CATEGORY_SLOTS + 1; i++) {
		cells.push(cell(STARTER.CATEGORIES + i, [134, 27 + i * 12], [89, 11], [
			img(`${GUI}/starterselection/selection_container`, [0, 0], [89, 11], { alpha: 0.9 }),
			text([4, 2], [83, 9], { scale: 0.6 }),
			hit(),
		]));
	}
	cells.push(cell(STARTER.MODEL, [15, 18], [100, 100], [icon([0, 0], [100, 100], { layer: 4 })]));
	cells.push(cell(STARTER.PLATFORM, [8, 88], [113, 30], [icon([0, 0], [113, 30], { layer: 3 })]));
	cells.push(cell(STARTER.NAME, [6, 119], [118, 10], [text([0, 0], [118, 10], { scale: 0.8, align: "center" }), hit()]));
	cells.push(cell(STARTER.TYPES, [6, 130], [118, 9], [text([0, 0], [118, 9], { scale: 0.7, align: "center" })]));
	cells.push(cell(STARTER.DESCRIPTION, [9, 143], [112, 32], [text([0, 0], [112, 32], { scale: 0.5 })]));
	const arrow = (index: number, x: number, side: "left" | "right") => cell(index, [x, 52], [12, 24], [
		img(`${GUI}/pokedex/forms_arrow_${side}`, [1, 4], [10, 16], { uv: [0, 0], uv_size: [10, 16] }),
		hit(img(`${GUI}/pokedex/forms_arrow_${side}`, [1, 4], [10, 16], { uv: [0, 16], uv_size: [10, 16] })),
	]);
	cells.push(arrow(STARTER.PREVIOUS, 8, "left"));
	cells.push(arrow(STARTER.NEXT, 110, "right"));
	cells.push(cell(STARTER.CHOOSE, [13, 180], [106, 14], [
		img(`${GUI}/starterselection/choose_button`, [0, 0], [106, 14], { uv: [0, 0], uv_size: [106, 14] }),
		text([0, 3], [106, 10], { scale: 0.8, align: "center" }),
		hit(img(`${GUI}/starterselection/choose_button`, [0, 0], [106, 14], { uv: [0, 14], uv_size: [106, 14] })),
	]));
	cells.push(cell(STARTER.RANDOM, [134, 172], [89, 11], [
		img(`${GUI}/starterselection/selection_container`, [0, 0], [89, 11]),
		text([4, 2], [83, 9], { scale: 0.6 }),
		hit(),
	]));
	cells.push(cell(STARTER.STUDIO, [125, 182], [24, 12], [
		img(`${GUI}/common/back_button`, [0, 0], [24, 12], { uv: [0, 0], uv_size: [26, 13] }),
		text([0, 2], [24, 10], { scale: 0.6, align: "center" }),
		hit(),
	]));
	controls.push({ cells: cellPanel([0, 0], [239, 197], cells) });
	controls.push(closeButton([-4, 2]));
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
	const button = (index: number, offset: Vec, size: Vec) => cell(index, offset, size, [
		img(`${GUI}/pokedex/move_slot`, [0, 0], size, { uv: [0, 0], uv_size: [134, 13] }),
		text([0, 3], [size[0], 10], { scale: 0.6, align: "center" }),
		hit(),
	]);
	const frame = (index: number) => cell(index, [0, 0], [345, 207], [icon([0, 0], [345, 207], { layer: 1 })]);
	const slots: Json[] = [];
	for (let i = 0; i < POKEDEX_LIST.SLOT_COUNT; i++) {
		slots.push(cell(POKEDEX_LIST.SLOTS + i, [26 + (i % 5) * 27, 39 + Math.floor(i / 5) * 27], [25, 25], [
			img(`${GUI}/pokedex/pokedex_slot`, [0, 0], [25, 25]),
			icon([2, 1], [21, 21]),
			text([1, 18], [23, 6], { scale: 0.45, align: "right" }),
			hit(img(`${GUI}/pokedex/slot_select`, [0, 0], [25, 25], { uv: [0, 0], uv_size: [25, 25] })),
		]));
	}
	const list = cellPanel([0, 0], [345, 207], [
		frame(POKEDEX_LIST.FRAME),
		...slots,
		button(POKEDEX_LIST.PREVIOUS, [180, 116], [67, 13]),
		button(POKEDEX_LIST.NEXT, [252, 116], [67, 13]),
		button(POKEDEX_LIST.FILTER, [180, 133], [67, 13]),
		button(POKEDEX_LIST.SEARCH, [252, 133], [67, 13]),
		button(POKEDEX_LIST.PROGRESS, [180, 150], [67, 13]),
		button(POKEDEX_LIST.BACK, [252, 150], [67, 13]),
		{ title: globalLabel("#title_text", [180, 30], [139, 10], { scale: 0.8, color: DARK, shadow: false }) },
		{ body: globalLabel("#form_text", [180, 44], [139, "default"], { scale: 0.6, color: DARK, shadow: false }) },
	], { bindings: titleVisibility(hasMarker(SUB.POKEDEX_LIST)) });
	const forms: Json[] = [];
	for (let i = 0; i < POKEDEX_ENTRY.FORM_SLOTS; i++) forms.push(button(POKEDEX_ENTRY.FORMS + i, [180 + (i % 4) * 35, 150 + Math.floor(i / 4) * 15], [33, 13]));
	const entry = cellPanel([0, 0], [345, 207], [
		frame(POKEDEX_ENTRY.FRAME),
		img(`${GUI}/pokedex/pokedex_screen_info_viewport`, [180, 28], [139, 70], { layer: 3 }),
		cell(POKEDEX_ENTRY.PLATFORM, [193, 66], [113, 30], [icon([0, 0], [113, 30], { layer: 4 })]),
		cell(POKEDEX_ENTRY.PROFILE, [218, 28], [64, 64], [icon([0, 0], [64, 64], { layer: 5 })]),
		cell(POKEDEX_ENTRY.CAUGHT, [183, 31], [14, 14], [icon([0, 0], [14, 14], { layer: 6 })]),
		cell(POKEDEX_ENTRY.NAME, [180, 102], [139, 10], [text([0, 0], [139, 10], { scale: 0.8, align: "center", color: DARK, shadow: false })]),
		cell(POKEDEX_ENTRY.TYPES, [180, 114], [139, 10], [text([0, 0], [139, 10], { scale: 0.8, align: "center" })]),
		...forms,
		button(POKEDEX_ENTRY.BACK, [180, 182], [67, 13]),
		button(POKEDEX_ENTRY.MOVES, [252, 182], [67, 13]),
		{
			"body_scroll@common.scrolling_panel": {
				...at([26, 28], [139, 163]),
				layer: 4,
				$show_background: false,
				$scrolling_content: "pokedex.entry_body",
				$scroll_size: [4, "100% - 4px"],
				$scrolling_pane_size: ["100% - 5px", "100% - 2px"],
				$scrolling_pane_offset: [2, 0],
				$scroll_bar_right_padding_size: [0, 0],
			},
		},
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
				{ screen: img(`${GUI}/pokedex/pokedex_screen`, [0, 0], [345, 207], { layer: 2 }) },
				{ list },
				{ entry },
				closeButton([-6, 4]),
			],
		},
		"entry_body": {
			type: "panel",
			size: ["100%", "100%c"],
			controls: [{ body: { ...globalLabel("#form_text", [0, 0], ["100%", "default"], { scale: 0.55, color: DARK, shadow: false }) } }],
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
			type: "panel",
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
				cell(PC.PREVIEW_TEXT, [6, 96], [66, 60], [text([2, 0], [62, 60], { scale: 0.55 })]),
				closeButton([-3, 3]),
			],
		},
		// Caixa: papel de parede (corpo do form = caminho da textura; vazio = sem papel) atrás dos 30 espaços 6×5
		// (frente extras-final: o 1º controle continua sendo o papel de parede ligado a #form_text).
		"pc_content": {
			type: "panel",
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
		"cobblemon_scanner.json": scannerFile(),
	};
	// Um elemento por linha (compacto; o cliente lê ~5× menos texto que com indentação).
	const serialize = (json: Json) => "{\n" + Object.entries(json).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n}\n";
	return Object.fromEntries(Object.entries(files).map(([name, json]) => [name, HEADER + serialize(json)]));
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
