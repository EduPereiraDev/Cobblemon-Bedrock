/**
 * Frente "telas": contrato entre os scripts das telas e os layouts JSON UI gerados por `tools/ui/gen-telas.ts`.
 *
 * Cada tela do Cobblemon é um `ActionFormData` cujo título começa com o marcador da tela (`scripts/ui/screens.ts`)
 * seguido de um SUB-marcador (qual layout daquela tela). O JSON UI desenha cada botão numa posição FIXA pela ordem
 * (`collection_index`): o botão N é sempre a mesma "célula" do layout. O texto do botão vira o rótulo da célula e o
 * ícone vira a imagem (retrato, textura do bloco, barra de HP...). Célula com texto vazio fica escondida.
 *
 * Não há fatiamento de strings (`'%.Ns'`) nestas telas: dado de apresentação que não é texto vai pelo ÍCONE do botão:
 *  - retratos/perfis (`textures/cobblemon/portraits|profiles/...`);
 *  - barras por passo (`textures/ui/cobblemon/hud/hp_h_NN`, 97×4 px, cor do Cobblemon pela razão);
 *  - cor do tipo nos tiles de golpe: o ícone é a chave `typeKeyTexture(tipo)` e o JSON UI pinta o tile com a cor do
 *    tipo (`ElementalType.hue`) comparando o caminho.
 *
 * Este arquivo não importa nada: o gerador lê as mesmas tabelas, então script e pack nunca divergem.
 */

/**
 * Sub-marcadores (depois do marcador da tela). Só códigos de cor terminados em `§r`; nenhum contém um marcador de
 * tela (`§0§N§r`) como substring, então o roteamento de `ui/cobblemon_forms.json` não se confunde.
 */
export const SUB = {
  BATTLE_ACTION: "§1§1§r",
  BATTLE_MOVES: "§1§2§r",
  BATTLE_TARGET: "§1§3§r",
  BATTLE_SWITCH: "§1§4§r",
  BATTLE_LIST: "§1§5§r",
  SUMMARY_INFO: "§2§1§r",
  SUMMARY_MOVES: "§2§2§r",
  SUMMARY_STATS: "§2§3§r",
  SUMMARY_MARKS: "§2§4§r",
  /**
   * Frente ui-polish: modo da aba Atributos (StatWidget.statOptions). Sem marcador = gráfico hexagonal (STATS/IV/EV);
   * RIDE = pentágono de montaria; OTHER = barras de amizade, saciedade e afins.
   */
  SUMMARY_STATS_RIDE: "§2§7§r",
  SUMMARY_STATS_OTHER: "§2§8§r",
  /** O Pokémon tem montaria: a barra de modos tem 5 (Atributos, IVs, EVs, Montar, Outro) em vez de 4. */
  SUMMARY_STATS_RIDE_TAB: "§2§5§r",
  /** Variante "estúdio" (modelo 3D ao vivo atrás da janela transparente): somado ao sub-marcador da aba. */
  STUDIO: "§2§9§r",
  STARTER: "§3§1§r",
  POKEDEX_LIST: "§4§1§r",
  POKEDEX_ENTRY: "§4§2§r",
  /** Frente ui-polish: batalha, confirmação de desistência (ForfeitConfirmationSelection). */
  BATTLE_FORFEIT: "§1§a§r",
  /**
   * Frente ui-polish: diálogo (DialogueScreen): opções em coluna, só "continuar" (tocar na caixa) ou lado a lado com 1 a
   * 4 opções (H1..H4: o Java centra a fileira pela quantidade; células têm posição fixa, então cada quantidade tem a sua).
   */
  DIALOGUE_VERTICAL: "§7§2§r",
  DIALOGUE_CONTINUE: "§7§3§r",
  DIALOGUE_H1: "§7§4§r",
  DIALOGUE_H2: "§7§5§r",
  DIALOGUE_H3: "§7§6§r",
  DIALOGUE_H4: "§7§7§r",
} as const;

export type SubMarker = (typeof SUB)[keyof typeof SUB];

/** Batalha, menu principal (BattleGeneralActionSelection): 4 tiles 90×26. */
export const BATTLE_ACTION = { TILES: 0, COUNT: 4 } as const;
/**
 * Batalha, golpes (BattleMoveSelection): 4 tiles 92×24 e o botão voltar. Frente msd-fase1: até 3 botões de gimmick
 * (BattleGimmickButton, 18×17 ao lado do voltar) nas células GIMMICKS..; o form só os acrescenta quando o request
 * oferece o gimmick (sem item-chave, o form continua com as 5 células de sempre).
 */
export const BATTLE_MOVES = { MOVES: 0, BACK: 4, COUNT: 5, GIMMICKS: 5, GIMMICK_SLOTS: 3 } as const;
/**
 * Frente ui-layout: o texto do tile de golpe tem 3 linhas — PP (com o prefixo da categoria), dica de efetividade e nome —
 * e o layout mostra cada linha no lugar do MoveTile (nome em x 17, PP centrado em x 75, categoria em x 48) com um rótulo
 * cortado por linha. Sem células extras: o form continua com 5 células + gimmicks (contrato da frente msd-fase1).
 */
export const MOVE_TILE_LINES = { PP: 0, HINT: 1, NAME: 2, NAME_LONG: 3 } as const;
/**
 * Frente msd-beta (prints do 1º teste no cliente: "Dança das", "Devastação de", "Z-Dança das"): o nome ocupa uma linha
 * de 73 px na escala 0,75 (97 px de texto) e o rótulo quebra na palavra, então a linha de baixo (a última palavra)
 * sumia. Nome mais largo que isso (medido nos .lang dos packs no build: scripts/GUI/moveNameWidths.ts) vai para a linha
 * NAME_LONG (a NAME fica vazia), que o layout mostra na escala 0,6 em até duas linhas (121 px cada; o maior nome, 156 px,
 * quebra em duas), no alto do tile, acima do PP e da dica.
 */
export const MOVE_NAME = { WIDTH: 73, SCALE: 0.75, LONG_SCALE: 0.6 } as const;
/**
 * Frente msd-fase1: prefixo invisível no texto do botão de gimmick LIGADO (o JSON UI mostra o quadro de baixo da
 * textura, como o `toggled` do BattleGimmickButton).
 */
export const GIMMICK_ON_MARKER = "§1§9§r";
/** Frente ui-polish: batalha, desistir (ForfeitConfirmationSelection: aceitar e recusar, 34×19). */
export const BATTLE_FORFEIT = { ACCEPT: 0, DECLINE: 1, COUNT: 2 } as const;

/**
 * Frente ui-polish: diálogo (DialogueScreen). As opções vêm primeiro (ordem do form = ordem das opções; os bots E2E
 * respondem pelo índice) e o retrato vai sempre na célula PORTRAIT, depois das vazias. O texto do retrato diz o lado e o
 * tipo (`left_skin`, `right_pokemon`...): o layout escolhe a moldura e o recorte (rosto de skin 8×8 ou retrato).
 */
export const DIALOGUE = { OPTIONS: 0, OPTION_SLOTS: 8, PORTRAIT: 8, COUNT: 9 } as const;
/** Prefixo invisível da opção que não pode ser escolhida (o layout usa o 3º quadro do botão e o texto cinza). */
export const DIALOGUE_DISABLED_MARKER = "§7§9§r";
export const DIALOGUE_FACES = ["left_skin", "right_skin", "left_pokemon", "right_pokemon"] as const;
/** Opções lado a lado que cabem (96 px + 4 cada, na largura do DialogueScreen); mais que isso vai em coluna. */
export const DIALOGUE_MAX_HORIZONTAL = 4;

/** Batalha, alvo (BattleTargetSelection): inimigos em cima, aliados embaixo. */
export const BATTLE_TARGET = { FOES: 0, ALLIES: 3, BACK: 6, COUNT: 7 } as const;
/** Batalha, troca (BattleSwitchPokemonSelection): 6 tiles, voltar, 6 barras de HP. Também a escolha do alvo de item. */
export const BATTLE_SWITCH = { SLOTS: 0, BACK: 6, BARS: 7, COUNT: 13 } as const;

/**
 * Resumo (Summary.kt, 331×161): abas na ordem do Cobblemon (Info, Golpes, Atributos, Marcas), retrato/perfil,
 * cabeçalho, time à direita e o conteúdo da aba a partir de CONTENT.
 */
export const SUMMARY = {
  TABS: 0,
  PORTRAIT: 4,
  NAME: 5,
  LEVEL: 6,
  ITEM: 7,
  /**
   * Frente ui-layout: tipos como no Summary.kt (espaçador + TypeIcon centrado em x 39): o ícone é a chave do 1º tipo
   * (`typeKeyTexture`) e o texto diz o espaçador (`TYPE_SINGLE`/`TYPE_DOUBLE`); o 2º tipo vai em TYPE2.
   */
  TYPES: 8,
  STUDIO: 9,
  PARTY: 10,
  /** Conteúdo da aba (índices reaproveitados por aba; ver INFO/MOVE_TAB/MARK_TAB). */
  CONTENT: 16,
  STAT_ROWS: 16,
  STAT_BARS: 22,
  MOVES: 16,
  MARKS: 16,
  MARK_SLOTS: 12,
  /** Frente dados-ui: 6 markings (MarkingsWidget, x+29 y+102) editáveis por toque. */
  MARKINGS: 28,
  MARKING_SLOTS: 6,
  /** Frente ui-layout: 2º tipo, ícone de brilhante, status, nome e barra de HP de cada espaço do time. */
  TYPE2: 34,
  SHINY: 35,
  STATUS: 36,
  PARTY_NAMES: 37,
  PARTY_BARS: 43,
  /** Duas células extras por aba (Marcas: título e ícone da marca escolhida). */
  EXTRA: 49,
  /**
   * Frente ui-polish: aba Atributos como o StatWidget. STAT_ROWS = rótulo + valor em cada vértice; STAT_BARS = setor do
   * gráfico (triângulo centro → vértice k → vértice k+1, textura pré-renderizada por passo); STAT_TABS = barra de baixo
   * (Atributos, IVs, EVs, [Montar], Outro). No modo OTHER, STAT_ROWS/STAT_BARS são as barras e as sobreposições.
   */
  STAT_TABS: 51,
  STAT_TAB_COUNT: 5,
  COUNT: 56,
} as const;

/** Modos da aba Atributos na ordem do StatWidget.statOptions (RIDE só para quem tem montaria). */
export const STAT_MODES = ["stats", "ivs", "evs", "ride", "other"] as const;
export type StatMode = (typeof STAT_MODES)[number];

/**
 * Gráfico de atributos (StatWidget.drawStatPolygon): polígono de 6 (atributos) ou 5 lados (montaria) em volta do centro,
 * cada vértice na razão do atributo (mínimo 5/raio, como o `coerceIn` do Java). Coordenadas na aba (134×148).
 */
export interface RadarShape {
  key: "h" | "p";
  sides: number;
  centerX: number;
  centerY: number;
  radius: number;
  /** hexagonVerticesOffset/pentagonVerticesOffset: centro dos rótulos (o valor vai 5,5 px abaixo). */
  labels: readonly (readonly [number, number])[];
}
export const RADAR_HEXAGON: RadarShape = {
  key: "h", sides: 6, centerX: 67, centerY: 22 + 48, radius: 48,
  labels: [[67, 10.5], [122, 42.5], [122, 93.5], [67, 124.5], [12, 93.5], [12, 42.5]],
};
export const RADAR_PENTAGON: RadarShape = {
  key: "p", sides: 5, centerX: 67, centerY: 22 + 49, radius: 49,
  labels: [[67, 10.5], [123, 47.5], [103, 112.5], [31, 112.5], [11, 47.5]],
};
/** Passos por raio das texturas dos setores (1..RADAR_STEPS): 10 = 4,8 px no hexágono. */
export const RADAR_STEPS = 10;
/** Cor de cada modo (o texto da célula do setor escolhe; a textura é branca com 60% de opacidade, como o Java). */
export const RADAR_COLORS: Record<string, readonly [number, number, number]> = {
  stats: [50, 215, 255], ivs: [216, 100, 255], evs: [255, 255, 100],
  land: [255, 165, 0], liquid: [65, 135, 255], air: [40, 205, 165],
};

/**
 * Modo OTHER (BarSummarySpeciesFeatureRenderer): barra de 110 px em passos de 1 px (`summary/radar/fill_<px>`, branca) e a cor
 * pelo prefixo invisível do texto da linha (FriendshipFeatureRenderer: rosa, mais forte a partir de 160; Fullness:
 * verde/amarelo/vermelho pela razão; os demais: branco).
 */
export const STAT_FILL_PX = 110;
export const STAT_FILL_MARKERS: Record<string, string> = {
  friendship: "§4§1§r", friendship_high: "§4§2§r", green: "§4§3§r", yellow: "§4§4§r", red: "§4§5§r", white: "§4§6§r",
};
export const STAT_FILL_COLORS: Record<string, readonly [number, number, number]> = {
  friendship: [255, 143, 163], friendship_high: [255, 71, 102], green: [120, 200, 80], yellow: [240, 200, 65], red: [230, 80, 65], white: [255, 255, 255],
};
export function statFillTexture(ratio: number): string {
  const px = Math.max(0, Math.min(STAT_FILL_PX, Math.ceil(Math.max(0, Math.min(1, ratio)) * STAT_FILL_PX)));
  return `${GUI}/summary/radar/fill_${px}`;
}
/** Linhas do texto de uma barra do modo OTHER (valor e % curtos antes: não quebram nas janelas estreitas). */
export const STAT_BAR_LINES = { VALUE: 0, PERCENT: 1, NAME: 2 } as const;

/** Vértice k no raio cheio (ângulo -90° + k·360°/lados, horário a partir do topo). */
export function radarVertex(shape: RadarShape, k: number): [number, number] {
  const angle = ((-90 + (k % shape.sides) * 360 / shape.sides) * Math.PI) / 180;
  return [shape.centerX + shape.radius * Math.cos(angle), shape.centerY + shape.radius * Math.sin(angle)];
}

/** Caixa (inteira, na aba) do setor k no raio cheio: onde a textura do setor é desenhada. */
export function radarSectorBox(shape: RadarShape, k: number): [number, number, number, number] {
  const points = [[shape.centerX, shape.centerY], radarVertex(shape, k), radarVertex(shape, k + 1)];
  const x0 = Math.floor(Math.min(...points.map(p => p[0])) + 1e-6);
  const y0 = Math.floor(Math.min(...points.map(p => p[1])) + 1e-6);
  const x1 = Math.ceil(Math.max(...points.map(p => p[0])) - 1e-6);
  const y1 = Math.ceil(Math.max(...points.map(p => p[1])) - 1e-6);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Passo (1..RADAR_STEPS) da razão de um vértice. */
export function radarStep(shape: RadarShape, ratio: number): number {
  const r = Math.max(5 / shape.radius, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return Math.max(1, Math.min(RADAR_STEPS, Math.round(r * RADAR_STEPS)));
}

/** Textura do setor k com os vértices nos passos a (vértice k) e b (vértice k+1). */
export function radarSectorTexture(shape: RadarShape, k: number, a: number, b: number): string {
  return `${GUI}/summary/radar/${shape.key}${k}_${a}_${b}`;
}

/** Texturas dos setores para as razões (uma por vértice, a partir do topo, no sentido horário). */
export function radarTextures(shape: RadarShape, ratios: readonly number[]): string[] {
  const steps = Array.from({ length: shape.sides }, (_, k) => radarStep(shape, ratios[k] ?? 0));
  return steps.map((a, k) => radarSectorTexture(shape, k, a, steps[(k + 1) % shape.sides]));
}

/** Aba Info (InfoWidget + InfoOneLineWidget): uma célula por campo, na caixa do `summary_info_base`. */
export const SUMMARY_INFO = {
  /** Valores das 6 linhas (Nº Dex, Espécie, Tipo, TO, Natureza, Habilidade); os rótulos são fixos no layout. */
  ROWS: 16,
  ROW_COUNT: 6,
  SIZE: 22,
  /** Pontos de exp. e exp. para o próximo nível (alinhados à direita em x 127, como o Java). */
  EXP: 24,
  TO_NEXT: 25,
  EXP_BAR: 26,
  /** Caixa de baixo à esquerda: linhas do port sem lugar no Java (forma, Tera, Gigantamax...). */
  EXTRA: 27,
} as const;
/** Chaves de tradução dos rótulos das linhas da aba Info (ordem de SUMMARY_INFO.ROWS). */
export const SUMMARY_INFO_LABELS = [
  "cobblemon.ui.info.pokedex_number", "cobblemon.ui.info.species", "cobblemon.ui.info.type", "cobblemon.ui.info.original_trainer",
  "cobblemon.ui.info.nature", "cobblemon.ui.info.ability",
] as const;

/** Aba Golpes (MovesWidget/MoveSlotWidget): tiles, PP + categoria de cada tile, poder/precisão/efeito. */
export const SUMMARY_MOVES = { TILES: 16, PP: 20, POWER: 24, ACCURACY: 25, EFFECT: 26 } as const;

/** Aba Marcas (MarksWidget): até 12 ícones na grade 6×5, o título e o ícone da marca escolhida. */
export const SUMMARY_MARKS = { SLOTS: 16, TITLE: 49, SELECTED: 50 } as const;

/** Barra de EXP da aba Info (55×1 no Java) em passos: o texto da célula diz o passo (nunca só dígitos). */
export const EXP_STEPS = 11;
export function expStepText(step: number): string {
  return `exp${Math.max(0, Math.min(EXP_STEPS, Math.round(step)))}`;
}
/** Passo da barra para a razão 0..1 (qualquer progresso > 0 mostra ao menos 1 passo). */
export function expStepFor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  return expStepText(r > 0 ? Math.max(1, Math.round(r * EXP_STEPS)) : 0);
}

/** Texto das células de tipo (o layout escolhe o espaçador simples/duplo e a posição do ícone). */
export const TYPE_SINGLE = "single";
export const TYPE_DOUBLE = "double";

/**
 * Prefixo invisível no texto do PP do golpe: a categoria (o layout mostra o ícone de `categories.png`, como o
 * MoveCategoryIcon do Java).
 */
export const CATEGORY_MARKERS: Record<string, string> = { Physical: "§1§6§r", Special: "§2§6§r", Status: "§3§6§r" };

/** Ordem das abas no Cobblemon (Summary.INFO/MOVES/STATS/MARKS). */
export const SUMMARY_TABS = ["info", "moves", "stats", "marks"] as const;
export type SummaryTab = (typeof SUMMARY_TABS)[number];

/** Escolha do inicial (StarterSelectionScreen, 239×197). */
export const STARTER = {
  CATEGORIES: 0,
  CATEGORY_SLOTS: 11,
  /** 12º espaço da lista: "mais categorias" quando há mais de 11. */
  MORE: 11,
  MODEL: 12,
  PLATFORM: 13,
  /** Nome no alto (x 14, y 2) como o StarterSelectionScreen; tocar também escolhe. */
  NAME: 14,
  /** Tipos como SUMMARY.TYPES (TypeIcon centrado em x 65, y 120); o 2º tipo em TYPE2. */
  TYPES: 15,
  DESCRIPTION: 16,
  PREVIOUS: 17,
  NEXT: 18,
  CHOOSE: 19,
  RANDOM: 20,
  STUDIO: 21,
  /** Frente ui-layout: 2º tipo e o número da Pokédex (x 79, y 1). */
  TYPE2: 22,
  DEX_NUMBER: 23,
  COUNT: 24,
} as const;

/**
 * PC (PCGUI, 349×205): [<<] [caixa] [>>] + 3 reservados (o `pcTitle` de sempre), 30 espaços da caixa, 6 do time,
 * a prévia (retrato + texto) do Pokémon selecionado do time.
 */
export const PC = {
  PREV: 0, BOX: 1, NEXT: 2, SLOTS: 6, PARTY: 36, PREVIEW: 42, PREVIEW_TEXT: 43,
  /** Frente ui-layout: painel da esquerda do PCGUI campo a campo (nível + bola, nome + gênero, tipos, item, brilhante). */
  PREVIEW_LEVEL: 44, PREVIEW_NAME: 45, PREVIEW_TYPES: 46, PREVIEW_TYPE2: 47, PREVIEW_ITEM: 48, PREVIEW_SHINY: 49,
  /**
   * Caixa de informação (info_box, x 9, y 128): página 0 = Natureza/Habilidade/Golpes (rótulo fixo + valor, nas linhas do
   * PCGUI); páginas 1 e 2 = IVs e EVs em PREVIEW_TEXT. Tocar na caixa (PREVIEW_PAGE) troca a página.
   */
  PREVIEW_NATURE: 50, PREVIEW_ABILITY: 51, PREVIEW_MOVES: 52, PREVIEW_PAGE: 53,
  COUNT: 54,
} as const;
/**
 * Frente dados-ui: prefixo invisível no texto de um espaço do PC que não passa no filtro da caixa (Search): o JSON UI
 * escurece o espaço (o PCGUI desenha o Pokémon com transparência).
 */
export const PC_DIM_MARKER = "§1§8§r";

/**
 * Pokédex, lista (PokedexGUI + EntriesScrollingWidget): grade 5×5 à esquerda (x 26, y 39), barra de busca em cima e de
 * filtro embaixo, região e contadores no cabeçalho; à direita o painel de informação (vazio até escolher).
 */
export const POKEDEX_LIST = {
  SLOTS: 0,
  SLOT_COUNT: 25,
  PREVIOUS: 25,
  NEXT: 26,
  FILTER: 27,
  SEARCH: 28,
  BACK: 29,
  FRAME: 30,
  PROGRESS: 31,
  /** Frente ui-layout: cabeçalho (região, vistos, capturados). */
  REGION: 32,
  SEEN: 33,
  CAUGHT: 34,
  /** Frente ui-polish: setas da região (PokedexGUI.regionSelectWidgetUp/Down, x 95, y 14,5/19,5). */
  REGION_PREV: 35,
  REGION_NEXT: 36,
  COUNT: 37,
} as const;

/**
 * Pokédex, entrada: a MESMA grade à esquerda (a página da entrada, com ela realçada) e, à direita, o PokemonInfoWidget
 * (número e nome, barra de tipos, forma com setas, retrato na plataforma) e as abas de informação (descrição,
 * habilidades, tamanho, atributos, drops, golpes) com o texto da aba embaixo (x 180, y 135).
 */
export const POKEDEX_ENTRY = {
  PROFILE: 0,
  PLATFORM: 1,
  NAME: 2,
  TYPES: 3,
  TYPE2: 4,
  FORM_PREV: 5,
  FORM_NEXT: 6,
  FORM_NAME: 7,
  UNKNOWN: 8,
  CAUGHT: 9,
  FRAME: 10,
  BACK: 11,
  /** Abas (PokedexGUI.tabIcons): descrição, habilidades, tamanho, atributos, drops; golpes = MOVES. */
  TABS: 12,
  TAB_COUNT: 5,
  /** Frente dados-ui: aba do Move Dex (TAB_MOVES do PokedexGUI). */
  MOVES: 17,
  SLOTS: 18,
  PREVIOUS: 43,
  NEXT: 44,
  REGION: 45,
  SEEN: 46,
  CAUGHT_COUNT: 47,
  REGION_PREV: 48,
  REGION_NEXT: 49,
  COUNT: 50,
} as const;
/** Abas da entrada na ordem do PokedexGUI (TAB_DESCRIPTION..TAB_DROPS). */
export const POKEDEX_TABS = ["info", "abilities", "size", "stats", "drops"] as const;
export type PokedexTab = (typeof POKEDEX_TABS)[number];
/** Prefixo invisível no texto de uma célula escolhida (aba ativa, espaço da entrada aberta): o layout realça. */
export const SELECTED_MARKER = "§1§7§r";

/** Tipos na ordem do ElementalTypes.kt, com o `hue` de cada um (cor dos tiles de golpe e das barras de tipo). */
export const TYPE_HUES: Record<string, number> = {
  normal: 0xe8e8da, fire: 0xff6e21, water: 0x3fa5ff, grass: 0x62d14f, electric: 0xffd314, ice: 0x54f2f2,
  fighting: 0xef565d, poison: 0xd651ff, ground: 0xf4a453, flying: 0xb8b2ff, psychic: 0xff5e9e, bug: 0xd3d319,
  rock: 0xb7a16e, ghost: 0x9c80f7, dragon: 0x7580ff, dark: 0x587da0, steel: 0xabd1f4, fairy: 0xff7fe5,
};

export const GUI = "textures/gui/cobblemon";

/**
 * Chave de tipo no ícone de um botão (tile de golpe): a textura existe (plataforma do tipo da Pokédex), então
 * nenhum controle que a desenhe por engano mostra "textura ausente"; o layout só compara o caminho.
 */
export function typeKeyTexture(type: string | undefined): string {
  const id = (type ?? "").toLowerCase();
  return `${GUI}/pokedex/platform_base_${id in TYPE_HUES ? id : "normal"}`;
}

/** Largura das barras horizontais do HUD (hp_h_00..97). */
export const BAR_PX = 97;

/** Textura da barra horizontal com a fração `value/max` (cor do Cobblemon pela razão). */
export function barTexture(value: number, max: number): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  let px = Math.round(ratio * BAR_PX);
  if (px === 0 && value > 0) px = 1;
  return `textures/ui/cobblemon/hud/hp_h_${String(px).padStart(2, "0")}`;
}

/** Textura do menu da batalha (battle_menu_*.png, 90×52 com 2 quadros). */
export function battleMenuTexture(kind: "fight" | "bag" | "switch" | "run" | "forfeit"): string {
  return `${GUI}/battle/battle_menu_${kind}`;
}
