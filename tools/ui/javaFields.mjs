// Frente ui-layout: cada campo das telas do Cobblemon Java e onde ele fica no port (tests/ui-layout.test.ts).
//
// Posições em px da tela do Java (x/y relativos ao canto da textura base, como no código Kotlin). `at` é o elemento do
// JSON UI (trecho do caminho na cena montada) que desenha o campo; o teste confere que ele existe, está visível com
// conteúdo (texto ou imagem) e começa na posição do Java (tolerância `tol`, padrão 1,5 px).
//
// Fonte de cada número: comentário ao lado (arquivo Kotlin em upstream/cobblemon/common/src/main/kotlin/.../client/gui/).

const S = "/router/summary_form/normal";
const ST = "/router/starter_form/normal";
const DEX = "/router/pokedex_form";
const PC = "/router/pc_form";
const B = "/router/battle_form";

export const JAVA_FIELDS = {
	starter: {
		origin: ST,
		fields: [
			["nome (StarterSelectionScreen: x 14, y 2)", `${ST}/cells/cell_14/panel_0`, [14, 2.5]],
			["número da Pokédex (x 79, y 1)", `${ST}/cells/cell_23/panel_0`, [79, 1.5]],
			["título (centrado em x 172, y 11)", `${ST}/title`, [128, 10.5], { content: false }],
			["tipo (TypeIcon centrado em x 65, y 120)", `${ST}/cells/cell_15/single`, [56, 120]],
			["plataforma do tipo (x 8,5, y 82)", `${ST}/cells/cell_13`, [8.5, 82]],
			["descrição (x 8, y 143, 114 px)", `${ST}/cells/cell_16/panel_0`, [8, 143]],
			["lista de categorias (x 134, y 27)", `${ST}/cells/cell_0`, [134, 27]],
			["escolher (SelectionButton x 13, y 180)", `${ST}/cells/cell_19`, [13, 180]],
		],
	},
	"summary-info": {
		origin: S,
		fields: [
			["aba Info (SummaryTab x 78, y -1)", `${S}/cells/cell_0`, [78, -1]],
			["nível (\"Nv.\" x 6, y 4,5)", `${S}/cells/cell_6/panel_0`, [6, 4.5]],
			["Poké Ball (x 3,5, y 15)", `${S}/cells/cell_6/image_1`, [3.5, 15]],
			["apelido (NicknameEntryWidget x 12, y 14,5)", `${S}/cells/cell_5/panel_0`, [12, 15], { tol: 1 }],
			["gênero (x 69, y 14,5)", `${S}/cells/cell_5/image_1`, [69, 15.5], { tol: 1.5 }],
			["retrato (ModelWidget x 6, y 32)", `${S}/cells/cell_4`, [6, 32]],
			["markings (MarkingsWidget x 29, y 102)", `${S}/cells/cell_28`, [29, 102]],
			["item segurado (rótulo x 24, y 114,5)", `${S}/cells/cell_7/panel_1`, [24, 114.5]],
			["tipo (TypeIcon centrado em x 39, y 123)", `${S}/cells/cell_8/single`, [30, 123]],
			["time: 1º espaço (PartyWidget x 216 + 6, y 24 + 7)", `${S}/cells/cell_10`, [222, 31]],
			["time: 2º espaço (x + 51, y + 8)", `${S}/cells/cell_11`, [273, 39]],
			["time: nome no espaço (x + 4, y + 20)", `${S}/cells/cell_37/panel_0`, [226, 51]],
			["time: barra de HP (x + 4, y + 25, 37 px)", `${S}/cells/cell_43`, [226, 56]],
			// InfoWidget em x 77, y 12; InfoOneLineWidget: linhas de 15 px, rótulo em x 8, valor em x 53, texto em y + 6.
			...["Nº Dex", "Espécie", "Tipo", "TO", "Natureza", "Habilidade"].map((name, r) => [`Info: ${name} (valor em x 53, y ${15 * r + 6})`, `${S}/info/cell_${16 + r}`, [77 + 53, 12 + 15 * r + 6], { content: r !== 3 }]),
			["Info: tamanho (x 107,5, y 6,5)", `${S}/info/cell_22`, [77 + 107.5, 12 + 6.5]],
			["Info: descrição da habilidade (x 8, y 94,5)", `${S}/info/ability_description`, [77 + 8, 12 + 94.5]],
			["Info: pontos de exp. (x 72,5, y 125; valor à direita em x 127)", `${S}/info/exp_label`, [77 + 72.5, 12 + 125.75], { content: false }],
			["Info: exp. p/ próximo nível (x 72,5, y 137)", `${S}/info/next_label`, [77 + 72.5, 12 + 137.75], { content: false }],
			["Info: valor da exp. (alinhado em x 127)", `${S}/info/cell_24`, [77 + 104, 12 + 125]],
		],
	},
	"summary-moves": {
		origin: S,
		fields: [
			// MovesWidget: MoveSlotWidget em x 13, y 6 + 25·i; tipo x 2, nome x 28, PP centrado x 93 / y 13; categoria x 66.
			...[0, 1, 2, 3].map((i) => [`golpe ${i + 1} (x 13, y ${6 + 25 * i})`, `${S}/moves/cell_${16 + i}`, [77 + 13, 12 + 6 + 25 * i]]),
			["golpe 1: nome (x 28, y 2)", `${S}/moves/cell_16/panel_3`, [77 + 13 + 28, 12 + 6 + 3]],
			["golpe 1: PP (barra x 60, y 13)", `${S}/moves/cell_20`, [77 + 13 + 60, 12 + 6 + 13]],
			["poder (x 14, y 115; valor à direita em x 62,5)", `${S}/moves/cell_24`, [77 + 40, 12 + 115]],
			["precisão (y 126)", `${S}/moves/cell_25`, [77 + 40, 12 + 126]],
			["efeito (y 137)", `${S}/moves/cell_26`, [77 + 40, 12 + 137]],
			["descrição (MoveDescriptionScrollList x 69, y 113)", `${S}/moves/description`, [77 + 69, 12 + 113], { content: false }],
		],
	},
	"summary-marks": {
		origin: S,
		fields: [
			["marca escolhida (MarkIcon x 12, y 12)", `${S}/marks/cell_50`, [77 + 12, 12 + 12]],
			["descrição (x 38, y 11, 85 px)", `${S}/marks/description`, [77 + 38, 12 + 11]],
			["título (centrado, y 38)", `${S}/marks/cell_49`, [77 + 6, 12 + 38]],
			["1ª marca (MarksScrollingWidget x 9, y 45 + 3)", `${S}/marks/cell_16`, [77 + 9, 12 + 48]],
			["2ª marca (+ 20 px)", `${S}/marks/cell_17`, [77 + 29, 12 + 48]],
		],
	},
	"summary-pc": {
		origin: S,
		fields: [
			["status (x 34, y 4)", `${S}/cells/cell_36`, [34, 4]],
			["brilhante (x 62,5, y 33,5)", `${S}/cells/cell_35`, [62.5, 33.5]],
			["2º tipo (x 39 − 16,5 + 15)", `${S}/cells/cell_34`, [37.5, 123]],
			["time fora do time: só o próprio (Summary.open(listOf(pokemon)))", `${S}/cells/cell_10`, [222, 31]],
		],
	},
	"pokedex-list": {
		origin: DEX,
		fields: [
			["região (x 36, y 14)", `${DEX}/list/cell_32/panel_0`, [36, 14.5]],
			["vistos (x 262, y 14)", `${DEX}/list/cell_33/panel_0`, [262, 14.5]],
			["capturados (x 300, y 14)", `${DEX}/list/cell_34/panel_0`, [300, 14.5]],
			["busca (SearchWidget x 26, y 28)", `${DEX}/list/cell_28`, [26, 28]],
			["1º espaço (EntriesScrollingWidget x 26, y 39)", `${DEX}/list/cell_0`, [26, 39]],
			["2º espaço (+ 25 + 2)", `${DEX}/list/cell_1`, [53, 39]],
			["filtro (x 26, y 180)", `${DEX}/list/cell_27`, [26, 180]],
		],
	},
	"pokedex-entry-caught": {
		origin: DEX,
		fields: [
			["grade à esquerda (x 26, y 39)", `${DEX}/entry/cell_18`, [26, 39]],
			["número e nome (PokemonInfoWidget x 180 + 3, y 28 + 1)", `${DEX}/entry/cell_2/panel_0`, [183, 29.5]],
			["capturado (x 309, y 30)", `${DEX}/entry/cell_9`, [309, 30]],
			["barra de tipos (y 42) e o ícone (x 183, y 45)", `${DEX}/entry/cell_3`, [180, 42]],
			["plataforma do tipo (x 193, y 94)", `${DEX}/entry/cell_1`, [193, 94]],
			["texto da aba (x 180 + 9, y 135 + 3)", `${DEX}/entry/body_scroll`, [188, 136], { content: false }],
			["aba Descrição (x 190,5, y 181,5)", `${DEX}/entry/cell_12/image_0`, [190.5, 181.5]],
			["aba Golpes (x 190,5 + 22·5)", `${DEX}/entry/cell_17/image_0`, [300.5, 181.5]],
		],
	},
	"pokedex-entry-unknown": {
		origin: DEX,
		fields: [
			["\"?\" (platform_unknown x 230,5, y 67)", `${DEX}/entry/cell_8`, [230.5, 67]],
			["número e ??? (x 183, y 29)", `${DEX}/entry/cell_2/panel_0`, [183, 29.5]],
		],
	},
	pc: {
		origin: PC,
		fields: [
			["nível (PCGUI x 6, y 1,5)", `${PC}/cell_44/panel_0`, [6, 1.5]],
			["nome (x 12, y 11,5)", `${PC}/cell_45/panel_0`, [12, 12]],
			["retrato (x 6, y 27)", `${PC}/cell_42`, [6, 27]],
			["item (rótulo x 24, y 108,5)", `${PC}/cell_48/panel_1`, [24, 108.5]],
			["tipo (TypeIcon pequeno centrado em x 40,5, y 117)", `${PC}/cell_46/single`, [36, 117]],
			["natureza (rótulo y 129,5, valor y 137)", `${PC}/cell_50/panel_1`, [11, 137]],
			["habilidade (valor y 154)", `${PC}/cell_51/panel_1`, [11, 154]],
			["golpes (y 170,5)", `${PC}/cell_52/panel_1`, [11, 170.5]],
			["nome da caixa", `${PC}/cell_1`, [133, 13]],
			["1º espaço da caixa", `${PC}/box/cell_6`, [85 + 7, 27 + 11]],
		],
	},
	"battle-moves": {
		// BattleMoveSelection: x 20, y = altura − 84 (a cena usa 270 de altura).
		origin: `${B}/moves/tiles`,
		fields: [
			["golpe 1 (x 20)", `${B}/moves/tiles/cell_0`, [0, 0]],
			["golpe 2 (x + 92 + 13)", `${B}/moves/tiles/cell_1`, [105, 0]],
			["golpe 3 (y + 24 + 5)", `${B}/moves/tiles/cell_2`, [0, 29]],
			["nome (x 17, y 2)", `${B}/moves/tiles/cell_0/panel_3`, [17, 3]],
			["PP (centrado em x 75, y 14)", `${B}/moves/tiles/cell_0/panel_7`, [64, 14.5]],
			["voltar (BattleBackButton x − 11, altura − 22)", `${B}/moves/tiles/cell_4`, [-11, 62], { content: false }],
		],
	},
};
