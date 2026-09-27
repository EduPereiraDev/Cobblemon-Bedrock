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
  /** Variante "estúdio" (modelo 3D ao vivo atrás da janela transparente): somado ao sub-marcador da aba. */
  STUDIO: "§2§9§r",
  STARTER: "§3§1§r",
  POKEDEX_LIST: "§4§1§r",
  POKEDEX_ENTRY: "§4§2§r",
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
 * Frente msd-fase1: prefixo invisível no texto do botão de gimmick LIGADO (o JSON UI mostra o quadro de baixo da
 * textura, como o `toggled` do BattleGimmickButton).
 */
export const GIMMICK_ON_MARKER = "§1§9§r";
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
  TYPES: 8,
  STUDIO: 9,
  PARTY: 10,
  /** Conteúdo: atributos = 6 linhas (texto) + 6 barras; golpes = 4 tiles; marcas = até 12 ícones. */
  CONTENT: 16,
  STAT_ROWS: 16,
  STAT_BARS: 22,
  MOVES: 16,
  MARKS: 16,
  MARK_SLOTS: 12,
  /** Frente dados-ui: 6 markings (MarkingsWidget, x+29 y+102) editáveis por toque. */
  MARKINGS: 28,
  MARKING_SLOTS: 6,
  COUNT: 34,
} as const;
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
  NAME: 14,
  TYPES: 15,
  DESCRIPTION: 16,
  PREVIOUS: 17,
  NEXT: 18,
  CHOOSE: 19,
  RANDOM: 20,
  STUDIO: 21,
  COUNT: 22,
} as const;

/**
 * PC (PCGUI, 349×205): [<<] [caixa] [>>] + 3 reservados (o `pcTitle` de sempre), 30 espaços da caixa, 6 do time,
 * a prévia (retrato + texto) do Pokémon selecionado do time.
 */
export const PC = { PREV: 0, BOX: 1, NEXT: 2, SLOTS: 6, PARTY: 36, PREVIEW: 42, PREVIEW_TEXT: 43, COUNT: 44 } as const;
/**
 * Frente dados-ui: prefixo invisível no texto de um espaço do PC que não passa no filtro da caixa (Search): o JSON UI
 * escurece o espaço (o PCGUI desenha o Pokémon com transparência).
 */
export const PC_DIM_MARKER = "§1§8§r";

/** Pokédex, lista (PokedexGUI + EntriesScrollingWidget): 5×5 espaços e os botões de navegação. */
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
  COUNT: 32,
} as const;

/** Pokédex, entrada (PokemonInfoWidget + DescriptionWidget): perfil na plataforma, nome, tipos, formas, voltar. */
export const POKEDEX_ENTRY = {
  PROFILE: 0,
  PLATFORM: 1,
  NAME: 2,
  TYPES: 3,
  FORMS: 4,
  FORM_SLOTS: 8,
  BACK: 12,
  FRAME: 13,
  CAUGHT: 14,
  /** Frente dados-ui: botão do Move Dex (aba TAB_MOVES do PokedexGUI) ao lado do voltar. */
  MOVES: 15,
  COUNT: 16,
} as const;

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
