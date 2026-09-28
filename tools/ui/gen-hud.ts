// Gera resource_packs/CobblemonBedrock/ui/cobblemon_hud.json (HUD do Cobblemon: party, batalha e toasts).
//
//   node --experimental-strip-types tools/ui/gen-hud.ts           escreve o arquivo
//   node --experimental-strip-types tools/ui/gen-hud.ts --check   falha se o arquivo versionado estiver desatualizado
//
// Os campos e larguras vêm de scripts/ui/hudProtocol.ts (o mesmo módulo que o script usa para codificar), então
// pack e script nunca divergem. As expressões são LITERAIS (sem $variáveis dentro de source_property_name: elas
// falham em subárvores inseridas por `modifications`), e cada controle que outros leem tem nome único `cbhud_*`.
//
// Padrões usados (docs/pesquisa/1-interface.md §1.3): receptor "preservado" por canal (property_bag +
// binding_condition visibility_changed), fatias de largura fixa com ('%.Ns' * X) a partir do título INTEIRO (o prefixo
// começa com o cabeçalho único do canal, então a subtração só casa no início) e texturas escolhidas por nome.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BATTLE_HEAD_FIELDS, BATTLE_MOVE_FIELDS, BATTLE_MOVES, BATTLE_TAIL_OFFSET, BATTLE_TILE_FIELDS, BATTLE_TILES_PER_SIDE, CHANNEL,
	HEADER_BYTES, HUD_PREFIX, PARTY_FIELDS, PARTY_SLOTS, TOAST_FIELDS, fieldOffsets, numLiteral, recordBytes,
} from "../../scripts/ui/hudProtocol.ts";
import type { FieldSpec } from "../../scripts/ui/hudProtocol.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HUD_FILE = join(ROOT, "resource_packs", "CobblemonBedrock", "ui", "cobblemon_hud.json");

const NS = "cobblemon_hud";
const GUI = "textures/gui/cobblemon";
const HUD = "textures/ui/cobblemon/hud";
const TAB = "\t";

type Json = Record<string, unknown>;
type Binding = Json;

const view = (source: string, target: string, control?: string): Binding =>
	control ? { binding_type: "view", source_control_name: control, source_property_name: source, target_property_name: target }
		: { binding_type: "view", source_property_name: source, target_property_name: target };

/** Receptor preservado do canal: guarda o último título com o cabeçalho `cbH<canal>`. */
function receptor(channel: string): Json {
	const head = HUD_PREFIX + channel;
	return {
		type: "panel",
		size: [0, 0],
		property_bag: { "#preserved": "" },
		bindings: [
			{ binding_name: "#hud_title_text_string" },
			{ binding_name: "#hud_title_text_string", binding_name_override: "#preserved", binding_condition: "visibility_changed" },
			view(`(not (#hud_title_text_string = #preserved) and not ((#hud_title_text_string - '${head}') = #hud_title_text_string))`, "#visible"),
		],
	};
}

/** Bindings que fatiam um registro: `#p` = título preservado; cada campo em dois passos. */
function recordBindings(rx: string, fields: FieldSpec[], base: number): Binding[] {
	const out: Binding[] = [view("#preserved", "#p", rx)];
	const offsets = fieldOffsets(fields, HEADER_BYTES + base);
	for (const f of fields) {
		out.push(view(`(#p - ('%.${offsets[f.name]}s' * #p))`, `#r_${f.name}`));
		out.push(view(`(('%.${f.bytes}s' * #r_${f.name}) - '${TAB}')`, `#${f.name}`));
	}
	return out;
}

const anchor = { anchor_from: "top_left", anchor_to: "top_left" };

function image(size: [number, number], offset: [number, number], layer: number, extra: Json = {}): Json {
	return { type: "image", size, offset, layer, ...anchor, ...extra };
}

function label(offset: [number, number], layer: number, extra: Json = {}): Json {
	return { type: "label", offset, layer, ...anchor, shadow: true, color: [1, 1, 1], ...extra };
}

/** Condição "campo = um destes valores". */
const oneOf = (field: string, values: string[]) => values.length === 1 ? `(#${field} = '${values[0]}')` : `(${values.map(v => `(#${field} = '${v}')`).join(" or ")})`;
/** Frente ui-cliente: campos numéricos chegam com o prefixo `NUM_LEAD` (hudProtocol.ts), nunca só dígitos. */
const isNum = (field: string, value: string | number) => `(#${field} = '${numLiteral(value)}')`;
const oneOfNum = (field: string, values: string[]) => oneOf(field, values.map(v => numLiteral(v)));

// ---------------------------------------------------------------------------------------------------------------
// Party (PartyOverlay.kt): slot 62×30, espaçamento 4, selecionado desloca 6 px.

function partyContent(slot: string, dx: number): Json[] {
	// dx fica para layouts sem o espaçador (sempre 0 aqui).
	const x = (v: number) => v + dx;
	const src = (s: string, t: string) => view(s, t, slot);
	return [
		{ portrait_bg: image([21, 21], [x(22), 2], 2, { texture: `${GUI}/party/party_slot_portrait_background` }) },
		{ portrait: image([21, 21], [x(22), 2], 3, { bindings: [src(`('textures/' + #tex)`, "#texture"), src("(not (#tex = ''))", "#visible")] }) },
		{ lv_label: label([x(0), 13], 4, { size: [13, 5], text: "cobblemon.ui.lv", localize: true, font_scale_factor: 0.5, text_alignment: "center" }) },
		{ lv: label([x(0), 17], 4, { size: [13, 5], text: "#text", localize: false, font_scale_factor: 0.5, text_alignment: "center", bindings: [src("('§r' + #lvl)", "#text")] }) },
		{ name: label([x(2), 24], 4, { size: [44, 5], text: "#text", localize: false, font_scale_factor: 0.5, bindings: [src("('§r' + #name)", "#text")] }) },
		{ gender_m: image([2.5, 3.5], [x(40), 25], 4, { texture: `${GUI}/party/party_gender_male`, bindings: [src("(#g = 'm')", "#visible")] }) },
		{ gender_f: image([2.5, 3.5], [x(40), 25], 4, { texture: `${GUI}/party/party_gender_female`, bindings: [src("(#g = 'f')", "#visible")] }) },
		{ hp: image([2, 18], [x(46), 5], 4, { bindings: [src(`('${HUD}/hp_v' + #hp)`, "#texture"), src("(not (#hp = ''))", "#visible")] }) },
		{ exp: image([1, 18], [x(49), 5], 4, { bindings: [src(`('${HUD}/exp_v' + #exp)`, "#texture"), src("(not (#exp = ''))", "#visible")] }) },
		{ ball: image([9, 11], [x(43.5), 22], 5, { uv: [0, 0], uv_size: [18, 22], bindings: [src(`('${GUI}/ball/' + #ball)`, "#texture"), src("(not (#ball = ''))", "#visible")] }) },
		{ status: image([4, 14], [x(51), 8], 4, { bindings: [src(`('${GUI}/party/status_' + #st)`, "#texture"), src("(not (#st = ''))", "#visible")] }) },
		{ popup_evo: image([18.5, 10], [x(56.5), 4], 6, { texture: `${GUI}/party/party_slot_notification_evolution`, bindings: [src("(#pop = 'e')", "#visible")] }) },
		{ popup_move: image([18.5, 10], [x(56.5), 17], 6, { texture: `${GUI}/party/party_slot_notification_new_move`, bindings: [src("(#pop = 'm')", "#visible")] }) },
		// Frente dados-ui: rolo de level-up sobre o retrato e "+N EXP" ao lado do slot (PartyOverlay).
		{ level_up: image([17, 17], [x(24), 4], 5, { texture: `${GUI}/party/party_slot_portrait_level_up`, uv: [0, 13], uv_size: [17, 17], bindings: [src(isNum("lu", 1), "#visible")] }) },
		{ exp_gain: label([x(57), 17], 7, { size: [40, 5], text: "#text", localize: false, font_scale_factor: 0.5, bindings: [src("('§l+' + #xp + ' §oEXP')", "#text"), src("(not (#xp = ''))", "#visible")] }) },
	];
}

function partySlot(i: number): Json {
	const name = `cbhud_ps${i}`;
	const rec = recordBytes(PARTY_FIELDS);
	const bg = (id: string, suffix: string, kinds: string[]) => ({
		[id]: image([62, 30], [0, 0], 1, { texture: `${GUI}/party/party_slot${suffix}`, bindings: [view(oneOf("k", kinds), "#visible", name)] }),
	});
	return {
		type: "panel",
		size: [62, 30],
		offset: [0, i * 34],
		...anchor,
		bindings: [...recordBindings("cbhud_party_rx", PARTY_FIELDS, i * rec), view("(not ((#k = '') or (#k = '-')))", "#visible")],
		controls: [
			bg("bg_normal", "", ["n"]),
			bg("bg_active", "_active", ["a"]),
			bg("bg_fainted", "_fainted", ["f"]),
			bg("bg_fainted_active", "_fainted_active", ["x"]),
			bg("bg_collapsed", "_collapsed", ["e"]),
			// Selecionado: um espaçador de 6 px (visível só no selecionado) empurra o conteúdo; stack_panel ignora filhos invisíveis.
			{
				content_row: {
					type: "stack_panel", orientation: "horizontal", size: [68, 30], ...anchor,
					controls: [
						{ select_spacer: { type: "panel", size: [6, 30], bindings: [view(oneOf("k", ["a", "x"]), "#visible", name)] } },
						// Frente ui-polish: espaço vazio (k = 'e') só mostra o party_slot_collapsed, como o PartyOverlay (o fundo do
						// retrato e o "Nv." viravam quadrados pretos no HUD do 4º teste em cliente).
						{ content: { type: "panel", size: [62, 30], bindings: [view("(not (#k = 'e'))", "#visible", name)], controls: partyContent(name, 0) } },
					],
				},
			},
		],
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Batalha (BattleOverlay.kt): caixa 140×40, x = 12 + (posições - rank - 1) × 4, y = 10 + rank × 40.

function battleTileContent(tile: string, right: boolean): Json[] {
	const src = (s: string, t: string) => view(s, t, tile);
	const info = right ? 7 : 40; // infoBoxX
	const portraitX = right ? 140 - 28 - 5 : 5;
	return [
		{ underlay: image([28, 28], [portraitX, 8], 1, { texture: `${GUI}/battle/battle_info_underlay` }) },
		{ portrait: image([28, 28], [portraitX, 8], 2, { bindings: [src(`('textures/' + #tex)`, "#texture"), src("(not (#tex = ''))", "#visible")] }) },
		{ base: image([140, 40], [0, 0], 3, { texture: `${GUI}/battle/battle_info_base${right ? "_flipped" : ""}` }) },
		{ status_bar: image([37, 7], [right ? 65 : 38, 28], 4, { uv: [right ? 0 : 37, 0], uv_size: [37, 7], bindings: [src(`('${GUI}/battle/battle_status_' + #st)`, "#texture"), src("(not (#st = ''))", "#visible")] }) },
		{ status_text: label([right ? 86 : 41, 27], 5, { size: [40, 8], text: "#text", localize: true, font_scale_factor: 0.8, bindings: [src("('cobblemon.ui.status.' + #st)", "#text"), src("(not (#st = ''))", "#visible")] }) },
		{ owned: image([5, 5], [7, 9], 5, { texture: `${GUI}/battle/battle_owned_indicator`, bindings: [src(isNum("own", 1), "#visible")] }) },
		{ name: label([info, 7], 5, { size: [70, 10], text: "#text", localize: false, bindings: [src("('§l' + #name)", "#text"), src(`(not ${isNum("own", 1)})`, "#visible")] }) },
		{ name_owned: label([info + 7, 7], 5, { size: [63, 10], text: "#text", localize: false, bindings: [src("('§l' + #name)", "#text"), src(isNum("own", 1), "#visible")] }) },
		{ gender_m: image([5, 7], [info + 63, 7], 5, { texture: `${GUI}/party/party_gender_male`, bindings: [src("(#g = 'm')", "#visible")] }) },
		{ gender_f: image([5, 7], [info + 63, 7], 5, { texture: `${GUI}/party/party_gender_female`, bindings: [src("(#g = 'f')", "#visible")] }) },
		{ lv_label: label([info + 69, 7], 5, { size: [14, 10], text: "cobblemon.ui.lv", localize: true }) },
		{ lv: label([info + 82, 7], 5, { size: [18, 10], text: "#text", localize: false, bindings: [src("('§l' + #lvl)", "#text")] }) },
		{ hp: image([97, 4], [info - 2, 22], 5, { bindings: [src(`('${HUD}/hp_h${right ? "r" : ""}' + #hpw)`, "#texture"), src("(not (#hpw = ''))", "#visible")] }) },
		{ hp_text: label([info + (right ? 44.5 : 39.5) - 30, 22], 6, { size: [60, 5], text: "#text", localize: false, font_scale_factor: 0.5, text_alignment: "center", bindings: [src("('§r' + #hpt)", "#text")] }) },
	];
}

function battleTile(side: "l" | "r", rank: number): Json {
	const right = side === "r";
	const name = `cbhud_bt${side}${rank}`;
	const rec = recordBytes(BATTLE_TILE_FIELDS);
	const index = (right ? BATTLE_TILES_PER_SIDE : 0) + rank;
	const base = recordBytes(BATTLE_HEAD_FIELDS) + index * rec;
	// Recuo de 4 px por posição à frente desta (visível conforme #n do cabeçalho).
	const spacer = (id: string, minN: number) => ({
		[id]: { type: "panel", size: [4, 1], bindings: [view(oneOfNum("n", Array.from({ length: 4 - minN }, (_, k) => String(minN + k))), "#visible", "cbhud_battle_head")] },
	});
	const spacers = [2, 3].filter(minN => minN - rank - 1 >= 1).map((minN, k) => spacer(`spacer${k}`, minN));
	// Painel com os dados da caixa (os filhos leem os campos pelo nome único). Frente batalha-minimizavel: o conteúdo
	// existe em duas cópias, opaca e esmaecida (alpha 0,5 propagado aos filhos, BattleOverlay.MIN_OPACITY), escolhidas
	// pelo campo `min` do cabeçalho. O fade de ~5 ticks do Java não é reproduzido (troca direta).
	const opacity = (id: string, alpha: number, minimised: boolean) => ({
		[id]: {
			type: "panel", size: [140, 40], ...anchor, alpha, propagate_alpha: true,
			bindings: [view(minimised ? isNum("min", 1) : `(not ${isNum("min", 1)})`, "#visible", "cbhud_battle_head")],
			controls: battleTileContent(name, right),
		},
	});
	const inner = {
		[name]: {
			type: "panel",
			size: [140, 40],
			bindings: [...recordBindings("cbhud_battle_rx", BATTLE_TILE_FIELDS, base), view(isNum("v", 1), "#visible")],
			controls: [opacity("bright", 1, false), opacity("dim", 0.5, true)],
		},
	};
	return {
		type: "stack_panel",
		orientation: "horizontal",
		size: ["100%c", 40],
		anchor_from: right ? "top_right" : "top_left",
		anchor_to: right ? "top_right" : "top_left",
		offset: [right ? -12 : 12, 10 + rank * 40],
		controls: right ? [inner, ...spacers] : [...spacers, inner],
	};
}

function battleActorName(side: "l" | "r"): Json {
	const right = side === "r";
	const field = right ? "ra" : "la";
	return {
		type: "label",
		anchor_from: right ? "top_right" : "top_left",
		anchor_to: right ? "top_right" : "top_left",
		offset: [right ? -21 : 21, 5],
		size: [120, 5],
		layer: 6,
		shadow: true,
		color: [1, 1, 1],
		font_scale_factor: 0.5,
		text_alignment: right ? "right" : "left",
		text: "#text",
		localize: false,
		bindings: [view(`('§r' + #${field})`, "#text", "cbhud_battle_head"), view(`(not (#${field} = ''))`, "#visible", "cbhud_battle_head")],
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Frente batalha-minimizavel: aviso da batalha e menu de golpes do modo `hud`.
//
// O texto do aviso é a CAUDA do título (depois do corpo de largura fixa, a partir de BATTLE_TAIL_OFFSET): o script manda
// `{ rawtext: [cabeçalho + corpo, { translate: "cobblemon.battle.ui.actions_label", with: [tecla] }] }` e o cliente
// entrega ao HUD o texto já traduzido, com a tecla no %1$s.

/** Pulso do aviso: sineFunction(period = 4 s, verticalShift = 0,5, amplitude = 0,5) do BattleOverlay → 1 ↔ 0 em 2 s. */
function promptAnimations(): Json {
	return {
		prompt_fade_out: { anim_type: "alpha", easing: "in_out_sine", duration: 2, from: 1, to: 0, next: `@${NS}.prompt_fade_in` },
		prompt_fade_in: { anim_type: "alpha", easing: "in_out_sine", duration: 2, from: 0, to: 1, next: `@${NS}.prompt_fade_out` },
	};
}

/** Label centralizado do aviso (BattleOverlay: x = largura / 2, y = altura / 5). */
function promptLabel(prompt: string, extra: Json): Json {
	return {
		type: "label",
		anchor_from: "top_middle",
		anchor_to: "top_middle",
		offset: [0, "20%"],
		// Largura relativa e altura do texto: frases longas (pt_BR + gesto do toque) quebram em 2 linhas sem cortar.
		size: ["90%", "default"],
		layer: 8,
		shadow: true,
		color: [1, 1, 1],
		text_alignment: "center",
		text: "#text",
		localize: false,
		bindings: [view("('§r' + #tail)", "#text", "cbhud_battle_prompt"), view(isNum("pr", prompt), "#visible", "cbhud_battle_head")],
		...extra,
	};
}

/** Tile de golpe do menu do modo `hud` (BattleMoveSelection.MoveTile: fundo da cor do tipo, nome e PP). */
function moveTile(i: number): Json {
	const name = `cbhud_bm${i}`;
	const src = (s: string, t: string) => view(s, t, name);
	const base = recordBytes(BATTLE_HEAD_FIELDS) + BATTLE_TILES_PER_SIDE * 2 * recordBytes(BATTLE_TILE_FIELDS) + i * recordBytes(BATTLE_MOVE_FIELDS);
	const content = (id: string, alpha: number, usable: boolean): Json => ({
		[id]: {
			type: "panel", size: [90, 26], ...anchor, alpha, propagate_alpha: true,
			bindings: [src(usable ? isNum("use", 1) : `(not ${isNum("use", 1)})`, "#visible")],
			controls: [
				{ bg: image([90, 26], [0, 0], 1, { bindings: [src(`('${GUI}/pokedex/platform_base_' + #type)`, "#texture"), src("(not (#type = ''))", "#visible")] }) },
				{ move: label([6, 5], 3, { size: [80, 10], text: "#text", localize: true, bindings: [src("('cobblemon.move.' + #id)", "#text")] }) },
				{ pp: label([6, 16], 3, { size: [80, 6], text: "#text", localize: false, font_scale_factor: 0.6, bindings: [src("('§fPP ' + #pp)", "#text"), src("(not (#pp = ''))", "#visible")] }) },
			],
		},
	});
	return {
		type: "panel",
		size: [90, 26],
		offset: [(i % 2) * 94, Math.floor(i / 2) * 28],
		...anchor,
		controls: [{
			[name]: {
				type: "panel",
				size: [90, 26],
				...anchor,
				bindings: [...recordBindings("cbhud_battle_rx", BATTLE_MOVE_FIELDS, base), view("(not (#id = ''))", "#visible")],
				controls: [
					content("usable", 1, true),
					content("unusable", 0.5, false),
					// Cursor: seta amarela no espaço selecionado da hotbar (o Java usa o hover do mouse).
					{ cursor: label([-8, 8], 4, { size: [8, 10], text: "▶", localize: false, color: [1, 0.85, 0.2], bindings: [view(isNum("cur", i), "#visible", "cbhud_battle_head")] }) },
				],
			},
		}],
	};
}

/** Menu do modo `hud` acima da hotbar: título (cauda), 2×2 golpes e "[5-9] menu completo". */
function moveMenu(): Json {
	const full = ["4", "5", "6", "7", "8"];
	return {
		type: "panel",
		size: [184, 80],
		anchor_from: "bottom_middle",
		anchor_to: "bottom_middle",
		offset: [0, -56],
		layer: 8,
		bindings: [view(isNum("pr", 3), "#visible", "cbhud_battle_head")],
		controls: [
			{ title: label([0, -10], 3, { size: [184, "default"], text: "#text", localize: false, text_alignment: "center", bindings: [view("('§r' + #tail)", "#text", "cbhud_battle_prompt")] }) },
			{
				grid: {
					type: "panel", size: [184, 54], offset: [0, 12], ...anchor,
					controls: Array.from({ length: BATTLE_MOVES }, (_, i) => ({ [`move_${i}@${NS}.battle_move_${i}`]: {} })),
				},
			},
			{ full_menu: label([0, 68], 3, { size: [184, 10], text: "cobblemon.port.battle_ui.full_menu_hint", localize: true, text_alignment: "center", color: [0.7, 0.7, 0.7], bindings: [view(`(not ${oneOfNum("cur", full)})`, "#visible", "cbhud_battle_head")] }) },
			{ full_menu_on: label([0, 68], 3, { size: [184, 10], text: "cobblemon.port.battle_ui.full_menu_hint", localize: true, text_alignment: "center", color: [1, 0.85, 0.2], bindings: [view(oneOfNum("cur", full), "#visible", "cbhud_battle_head")] }) },
		],
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Toast (AdvancementToast 160×32 no canto superior direito).

function toast(): Json {
	const name = "cbhud_toast";
	const src = (s: string, t: string) => view(s, t, name);
	const frame = (id: string, file: string, code: string) => ({ [id]: image([160, 32], [0, 0], 1, { texture: `${HUD}/${file}`, bindings: [src(`(#frame = '${code}')`, "#visible")] }) });
	const line1 = (id: string, code: string, color: number[]) => ({
		[id]: label([30, 7], 3, { size: [125, 10], text: "#text", localize: true, shadow: false, color, bindings: [src("#l1", "#text"), src(`(#color = '${code}')`, "#visible")] }),
	});
	return {
		type: "panel",
		size: [160, 32],
		anchor_from: "top_right",
		anchor_to: "top_right",
		offset: [0, 0],
		layer: 50,
		bindings: [...recordBindings("cbhud_toast_rx", TOAST_FIELDS, 0), view(isNum("v", 1), "#visible")],
		controls: [
			frame("frame_task", "toast_task", "t"),
			frame("frame_goal", "toast_goal", "g"),
			frame("frame_challenge", "toast_challenge", "c"),
			{ icon: image([16, 16], [8, 8], 2, { bindings: [src("('textures/' + #icon)", "#texture"), src("(not (#icon = ''))", "#visible")] }) },
			line1("line1_yellow", "y", [1, 1, 0]),
			line1("line1_purple", "p", [1, 0.53, 1]),
			line1("line1_white", "w", [1, 1, 1]),
			{ line2: label([30, 18], 3, { size: [125, 10], text: "#text", localize: true, shadow: false, bindings: [src("#l2", "#text")] }) },
		],
	};
}

// ---------------------------------------------------------------------------------------------------------------

export function buildHud(): Json {
	const out: Json = { namespace: NS };
	const partySlots = Array.from({ length: PARTY_SLOTS }, (_, i) => ({ [`cbhud_ps${i}@${NS}.party_slot_${i}`]: {} }));
	for (let i = 0; i < PARTY_SLOTS; i++) out[`party_slot_${i}`] = partySlot(i);
	out.party_overlay = {
		type: "panel",
		size: [80, PARTY_SLOTS * 30 + (PARTY_SLOTS - 1) * 4],
		anchor_from: "left_middle",
		anchor_to: "left_middle",
		offset: [0, 0],
		controls: partySlots,
	};
	for (const side of ["l", "r"] as const)
		for (let r = 0; r < BATTLE_TILES_PER_SIDE; r++) out[`battle_tile_${side}${r}`] = battleTile(side, r);
	Object.assign(out, promptAnimations());
	for (let i = 0; i < BATTLE_MOVES; i++) out[`battle_move_${i}`] = moveTile(i);
	out.battle_move_menu = moveMenu();
	out.battle_overlay = {
		type: "panel",
		size: ["100%", "100%"],
		controls: [
			{
				cbhud_battle_head: {
					type: "panel",
					size: [0, 0],
					bindings: recordBindings("cbhud_battle_rx", BATTLE_HEAD_FIELDS, 0),
				},
			},
			// Frente batalha-minimizavel: cauda do título (texto do aviso já traduzido no cliente).
			{
				cbhud_battle_prompt: {
					type: "panel",
					size: [0, 0],
					bindings: [view("#preserved", "#p", "cbhud_battle_rx"), view(`(#p - ('%.${BATTLE_TAIL_OFFSET}s' * #p))`, "#tail")],
				},
			},
			{ actor_left: battleActorName("l") },
			{ actor_right: battleActorName("r") },
			...(["l", "r"] as const).flatMap(side => Array.from({ length: BATTLE_TILES_PER_SIDE }, (_, r) => ({ [`tile_${side}${r}@${NS}.battle_tile_${side}${r}`]: {} }))),
			// Aviso pulsando (1) e "Pressione %1$s para se mover." com opacidade 0,75 (2).
			{ prompt_actions: promptLabel("1", { alpha: `@${NS}.prompt_fade_out` }) },
			{ prompt_hide: promptLabel("2", { alpha: 0.75 }) },
			{ [`move_menu@${NS}.battle_move_menu`]: {} },
		],
	};
	out.toast = toast();
	out.root = {
		type: "panel",
		size: ["100%", "100%"],
		layer: 1,
		controls: [
			{ cbhud_party_rx: receptor(CHANNEL.PARTY) },
			{ cbhud_battle_rx: receptor(CHANNEL.BATTLE) },
			{ cbhud_toast_rx: receptor(CHANNEL.TOAST) },
			{ [`party@${NS}.party_overlay`]: {} },
			{ [`battle@${NS}.battle_overlay`]: {} },
			{ [`cbhud_toast@${NS}.toast`]: {} },
		],
	};
	return out;
}

export function renderHud(): string {
	return `// Arquivo gerado por tools/ui/gen-hud.ts a partir de scripts/ui/hudProtocol.ts. Não edite à mão.\n${JSON.stringify(buildHud(), null, 1)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const text = renderHud();
	if (process.argv.includes("--check")) {
		let current = "";
		try { current = readFileSync(HUD_FILE, "utf8"); } catch { }
		if (current !== text) {
			console.error(`${HUD_FILE} está desatualizado: rode node --experimental-strip-types tools/ui/gen-hud.ts`);
			process.exit(1);
		}
		console.log("cobblemon_hud.json em dia");
	}
	else {
		writeFileSync(HUD_FILE, text);
		console.log(`escrito ${HUD_FILE}`);
	}
}
