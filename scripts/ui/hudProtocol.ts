/**
 * Protocolo "CBUI v1" entre o script e o JSON UI do HUD (`ui/cobblemon_hud.json`).
 *
 * O script manda dados pelo TÍTULO (`onScreenDisplay.setTitle`); o resource pack desenha. Cada canal tem um
 * receptor "preservado" no HUD (padrão preserve-title da wiki) que só aceita títulos com o próprio cabeçalho, então
 * títulos de outros canais, da vanilla ou de outros add-ons não apagam o HUD.
 *
 * Formato: `cbH` + canal (1 letra) + sequência (1 caractere que muda a cada envio) + registros de LARGURA FIXA em
 * BYTES UTF-8, completados com `\t` (o JSON UI remove com `- '\t'`). Fatiar por largura fixa é o método robusto:
 * `('%.Ns' * X)` devolve os N primeiros bytes de X. `fixed()` nunca corta um caractere multibyte ao meio.
 *
 * Este arquivo não importa nada: o gerador do JSON UI (`tools/ui/gen-hud.ts`) lê as mesmas tabelas de campos, então
 * script e pack nunca divergem.
 *
 * Frente ui-cliente: nenhum campo pode chegar ao JSON UI como texto só de dígitos. No cliente real, o resultado de uma
 * fatia que parece número vira número: `('§r' + #lvl)` deixou de ser texto (o nível da party ficou vazio, embora o
 * nome, que é texto, aparecesse) e caminhos como `('.../hp_v_' + #hp)` quebram do mesmo jeito. Por isso campos
 * numéricos levam um prefixo fixo (`lead`) que faz parte do valor: `_` nos que o JSON UI compara ou junta num caminho
 * de textura (`'_1'`, `hp_v` + `_18`) e um código de formatação invisível (`§r`/`§l`) nos que são exibidos.
 */

export const HUD_PREFIX = "cbH";
/** Cabeçalho: prefixo (3) + canal (1) + sequência (1). */
export const HEADER_BYTES = 5;

export const CHANNEL = { PARTY: "P", BATTLE: "B", TOAST: "T" } as const;
export type HudChannel = (typeof CHANNEL)[keyof typeof CHANNEL];

export interface FieldSpec {
  name: string;
  /** Largura total em bytes, contando o `lead`. */
  bytes: number;
  /** Prefixo fixo de valores não vazios (nunca removido no JSON UI): evita texto só de dígitos. */
  lead?: string;
}

/** Prefixo dos campos numéricos comparados/concatenados no JSON UI (`(#v = '_1')`, `hp_v` + `_18`). */
export const NUM_LEAD = "_";
/** Literal de comparação de um valor de campo com `NUM_LEAD` (usado pelo gerador do JSON UI). */
export const numLiteral = (value: string | number) => `${NUM_LEAD}${value}`;

/**
 * Slot da party (PartyOverlay.kt). `k`: tipo do slot — `-` escondido, `e` vazio (party_slot_collapsed),
 * `n` normal, `a` selecionado, `f` desmaiado, `x` desmaiado e selecionado.
 */
export const PARTY_FIELDS: FieldSpec[] = [
  { name: "k", bytes: 1 },
  /** Caminho da textura do retrato sem o "textures/" inicial. */
  { name: "tex", bytes: 40 },
  { name: "name", bytes: 24 },
  /** Nível exibido: `§r` + até 3 dígitos. */
  { name: "lvl", bytes: 6, lead: "§r" },
  /** Altura da barra vertical de HP em px (`_00`..`_18`). */
  { name: "hp", bytes: 3, lead: NUM_LEAD },
  /** Altura da barra vertical de EXP em px (`_00`..`_18`). */
  { name: "exp", bytes: 3, lead: NUM_LEAD },
  /** Status persistente ("brn", "par"...) ou vazio. */
  { name: "st", bytes: 3 },
  /** Gênero: m, f ou n. */
  { name: "g", bytes: 1 },
  /** Bola (id sem namespace, "poke_ball"). */
  { name: "ball", bytes: 24 },
  /** Pop-up ao lado do slot: e (evolução disponível), m (golpe novo) ou vazio. */
  { name: "pop", bytes: 1 },
  /** Frente dados-ui: EXP ganha mostrada ao lado do slot ("+N EXP", PartyOverlay) ou vazio. */
  { name: "xp", bytes: 10, lead: "§l" },
  /** Frente dados-ui: `_1` = rolo de level-up sobre o retrato (party_slot_portrait_level_up). */
  { name: "lu", bytes: 2, lead: NUM_LEAD },
];
export const PARTY_SLOTS = 6;

/** Cabeçalho do HUD de batalha: posições por lado e nomes dos treinadores (lado do jogador e oponente). */
export const BATTLE_HEAD_FIELDS: FieldSpec[] = [
  /** Pokémon em campo por ator (1..3), para o recuo horizontal das caixas (BattleOverlay.HORIZONTAL_SPACING). */
  { name: "n", bytes: 2, lead: NUM_LEAD },
  { name: "la", bytes: 24 },
  { name: "ra", bytes: 24 },
  /** Frente batalha-minimizavel: 1 = batalha minimizada (caixas com opacidade 0,5, BattleOverlay.MIN_OPACITY). */
  { name: "min", bytes: 2, lead: NUM_LEAD },
  /**
   * Aviso no HUD (texto na cauda do título, ver `BATTLE_TAIL_OFFSET`): 0 nada; 1 `cobblemon.battle.ui.actions_label`
   * pulsando (BattleOverlay.kt:143-153); 2 `cobblemon.battle.ui.hide_label` (BattleGUI.kt:123-132); 3 menu de golpes
   * do modo `hud` (título na cauda + registros de golpe).
   */
  { name: "pr", bytes: 2, lead: NUM_LEAD },
  /** Cursor do menu do modo `hud` (espaço da hotbar 0..8). */
  { name: "cur", bytes: 2, lead: NUM_LEAD },
];

/** Golpe do menu do modo `hud` (BattleMoveSelection.MoveTile: cor do tipo, nome, PP). */
export const BATTLE_MOVE_FIELDS: FieldSpec[] = [
  /** Id do golpe no Showdown (o nome vem de `cobblemon.move.<id>`); vazio = sem golpe nessa posição. */
  { name: "id", bytes: 24 },
  /** Tipo mostrado (id minúsculo: "electric"). */
  { name: "type", bytes: 10 },
  /** "pp/max" ou vazio (Struggle). */
  { name: "pp", bytes: 5 },
  /** 1 = pode usar; 0 = sem PP ou desabilitado (tile com opacidade 0,5). */
  { name: "use", bytes: 2, lead: NUM_LEAD },
];
export const BATTLE_MOVES = 4;

/** Caixa de info de um Pokémon em campo (BattleOverlay.drawBattleTile). */
export const BATTLE_TILE_FIELDS: FieldSpec[] = [
  /** 1 = visível. */
  { name: "v", bytes: 2, lead: NUM_LEAD },
  { name: "tex", bytes: 40 },
  { name: "name", bytes: 24 },
  /** Nível exibido em negrito: `§l` + até 3 dígitos. */
  { name: "lvl", bytes: 6, lead: "§l" },
  /** Largura da barra de HP em px (`_00`..`_97`). */
  { name: "hpw", bytes: 3, lead: NUM_LEAD },
  /** Texto do HP: "atual/máx" do lado do jogador, "NN%" do oponente. */
  { name: "hpt", bytes: 9 },
  { name: "st", bytes: 3 },
  { name: "g", bytes: 1 },
  /** 1 = espécie já capturada pelo jogador (battle_owned_indicator). */
  { name: "own", bytes: 2, lead: NUM_LEAD },
];
/** Caixas por lado (até triplas). Ordem no payload: esquerda 0..2, direita 0..2. */
export const BATTLE_TILES_PER_SIDE = 3;

/** Toast (CobblemonToast / AdvancementToast): ícone, moldura, cor da 1ª linha e duas linhas (chave ou texto). */
export const TOAST_FIELDS: FieldSpec[] = [
  /** 1 = visível. */
  { name: "v", bytes: 2, lead: NUM_LEAD },
  /** Caminho da textura do ícone sem o "textures/" inicial. */
  { name: "icon", bytes: 64 },
  /** Moldura: t (task), g (goal), c (challenge). */
  { name: "frame", bytes: 1 },
  /** Cor da 1ª linha: y (amarelo), p (roxo), w (branco). */
  { name: "color", bytes: 1 },
  { name: "l1", bytes: 80 },
  { name: "l2", bytes: 96 },
];

export const recordBytes = (fields: FieldSpec[]) => fields.reduce((sum, f) => sum + f.bytes, 0);

/** Offset (em bytes, contado do início do corpo, depois do cabeçalho) de cada campo. */
export function fieldOffsets(fields: FieldSpec[], base = 0): Record<string, number> {
  const out: Record<string, number> = {};
  let offset = base;
  for (const f of fields) {
    out[f.name] = offset;
    offset += f.bytes;
  }
  return out;
}

/** Tamanho em bytes UTF-8 de um code point. */
function codePointBytes(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Tamanho de uma string em bytes UTF-8 (o runtime do Bedrock não tem TextEncoder). */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (const ch of value) bytes += codePointBytes(ch.codePointAt(0)!);
  return bytes;
}

/**
 * Corta/completa `value` até exatamente `bytes` bytes UTF-8, sem partir caractere multibyte; o resto vira `\t`.
 * Caracteres de controle (incluindo `\t` e `\n`) são removidos do valor.
 */
export function fixed(value: string | number | undefined, bytes: number): string {
  let out = "";
  let used = 0;
  for (const ch of String(value ?? "")) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) continue;
    const size = codePointBytes(cp);
    if (used + size > bytes) break;
    out += ch;
    used += size;
  }
  return out + "\t".repeat(bytes - used);
}

/** Número inteiro com zeros à esquerda, limitado a [0, 10^width - 1]. */
export function padNumber(n: number, width: number): string {
  const max = 10 ** width - 1;
  const v = Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));
  return String(v).padStart(width, "0");
}

/** Monta um registro na ordem das especificações. */
export function encodeRecord(fields: FieldSpec[], values: Record<string, string | number | undefined>): string {
  return fields.map(f => {
    const raw = values[f.name];
    const value = raw === undefined || raw === "" ? "" : `${f.lead ?? ""}${raw}`;
    return fixed(value, f.bytes);
  }).join("");
}

/** Sequência de 1 caractere (muda a cada envio para o receptor preservado aceitar o título mesmo se o corpo repetir). */
export const SEQUENCE = "0123456789abcdefghijklmnopqrstuvwxyz";

export function header(channel: HudChannel, seq: number): string {
  return HUD_PREFIX + channel + SEQUENCE[((seq % SEQUENCE.length) + SEQUENCE.length) % SEQUENCE.length];
}

// ---------------------------------------------------------------------------------------------------------------
// Party

export type PartySlotKind = "-" | "e" | "n" | "a" | "f" | "x";

export interface PartySlotView {
  kind: PartySlotKind;
  texture?: string;
  name?: string;
  level?: number;
  /** 0..1 */
  hpRatio?: number;
  /** 0..1 */
  expRatio?: number;
  status?: string;
  gender?: "m" | "f" | "n";
  ball?: string;
  /** Pop-up: "e" evolução disponível, "m" golpe novo. */
  popup?: "e" | "m";
  /** EXP ganha em exibição (PartyOverlayDataControl.ExpGainedData). */
  expGained?: number;
  /** Rolo de level-up sobre o retrato. */
  levelUp?: boolean;
}

/** Altura máxima das barras verticais da party (PartyOverlay: barHeightMax = 18). */
export const PARTY_BAR_PX = 18;

/** Tira o "textures/" inicial (o JSON UI acrescenta). */
export function stripTextures(path: string | undefined): string {
  if (!path) return "";
  return path.startsWith("textures/") ? path.slice("textures/".length) : path;
}

/** Barra de altura proporcional; qualquer HP > 0 mostra pelo menos 1 px (como o arredondamento do Cobblemon). */
export function barPixels(ratio: number | undefined, max: number): number {
  const r = Math.max(0, Math.min(1, ratio ?? 0));
  if (r <= 0) return 0;
  return Math.max(1, Math.round(r * max));
}

export function encodePartyBody(slots: (PartySlotView | undefined)[]): string {
  let body = "";
  for (let i = 0; i < PARTY_SLOTS; i++) {
    const slot = slots[i] ?? { kind: "-" as const };
    if (slot.kind === "-" || slot.kind === "e") {
      body += encodeRecord(PARTY_FIELDS, { k: slot.kind });
      continue;
    }
    body += encodeRecord(PARTY_FIELDS, {
      k: slot.kind,
      tex: stripTextures(slot.texture),
      name: slot.name,
      lvl: slot.level,
      hp: padNumber(barPixels(slot.hpRatio, PARTY_BAR_PX), 2),
      exp: padNumber(Math.round(Math.max(0, Math.min(1, slot.expRatio ?? 0)) * PARTY_BAR_PX), 2),
      st: slot.status ?? "",
      g: slot.gender ?? "n",
      ball: slot.ball ?? "",
      pop: slot.popup ?? "",
      xp: slot.expGained && slot.expGained > 0 ? String(Math.min(9999999, Math.trunc(slot.expGained))) : "",
      lu: slot.levelUp ? "1" : "",
    });
  }
  return body;
}

// ---------------------------------------------------------------------------------------------------------------
// Batalha

export interface BattleTileView {
  texture?: string;
  name: string;
  level: number;
  hpRatio: number;
  /** Texto do HP já formatado. */
  hpText: string;
  status?: string;
  gender?: "m" | "f" | "n";
  owned?: boolean;
}

/** Aviso do HUD da batalha minimizável (campo `pr`). */
export const BATTLE_PROMPT = { NONE: 0, ACTIONS: 1, HIDE: 2, MENU: 3 } as const;
export type BattlePrompt = (typeof BATTLE_PROMPT)[keyof typeof BATTLE_PROMPT];

export interface BattleMoveView {
  id: string;
  type: string;
  /** "pp/max" (vazio para Struggle). */
  pp: string;
  usable: boolean;
}

/** Estado da tela da batalha para o jogador (frente batalha-minimizavel). */
export interface BattleUiHead {
  minimised: boolean;
  prompt: BattlePrompt;
  /** Espaço da hotbar sob o cursor (0..8), só no menu do modo `hud`. */
  cursor?: number;
  moves?: BattleMoveView[];
}

export interface BattleHudView {
  /** Pokémon em campo por ator (1..3). */
  slotsPerActor: number;
  leftActor?: string;
  rightActor?: string;
  left: (BattleTileView | undefined)[];
  right: (BattleTileView | undefined)[];
  /** Frente batalha-minimizavel: minimizado/aviso/menu (espectadores: nada). */
  ui?: BattleUiHead;
}

/** Largura cheia da barra de HP da caixa de batalha (BattleOverlay: fullWidth = 97). */
export const BATTLE_BAR_PX = 97;

function encodeTile(tile: BattleTileView | undefined): string {
  if (!tile) return encodeRecord(BATTLE_TILE_FIELDS, { v: "0" });
  return encodeRecord(BATTLE_TILE_FIELDS, {
    v: "1",
    tex: stripTextures(tile.texture),
    name: tile.name,
    lvl: tile.level,
    hpw: padNumber(barPixels(tile.hpRatio, BATTLE_BAR_PX), 2),
    hpt: tile.hpText,
    st: tile.status ?? "",
    g: tile.gender ?? "n",
    own: tile.owned ? "1" : "0",
  });
}

function encodeMove(move: BattleMoveView | undefined): string {
  if (!move) return encodeRecord(BATTLE_MOVE_FIELDS, {});
  return encodeRecord(BATTLE_MOVE_FIELDS, { id: move.id, type: move.type, pp: move.pp, use: move.usable ? "1" : "0" });
}

/**
 * Corpo do canal `B`: cabeçalho + 6 caixas + 4 golpes, todos de largura fixa. O texto do aviso NÃO entra aqui: vai
 * como cauda rawtext do título (traduzido no cliente, com o `%1$s` da tecla), a partir de `BATTLE_TAIL_OFFSET`.
 */
export function encodeBattleBody(view: BattleHudView | undefined): string {
  if (!view) {
    return encodeRecord(BATTLE_HEAD_FIELDS, { n: "0", min: "0", pr: "0" })
      + Array.from({ length: BATTLE_TILES_PER_SIDE * 2 }, () => encodeTile(undefined)).join("")
      + Array.from({ length: BATTLE_MOVES }, () => encodeMove(undefined)).join("");
  }
  const ui = view.ui;
  const menu = ui?.prompt === BATTLE_PROMPT.MENU;
  let body = encodeRecord(BATTLE_HEAD_FIELDS, {
    n: Math.max(1, Math.min(3, view.slotsPerActor)), la: view.leftActor, ra: view.rightActor,
    min: ui?.minimised ? "1" : "0", pr: String(ui?.prompt ?? 0), cur: menu ? String(Math.max(0, Math.min(8, ui?.cursor ?? 0))) : "",
  });
  for (let i = 0; i < BATTLE_TILES_PER_SIDE; i++) body += encodeTile(view.left[i]);
  for (let i = 0; i < BATTLE_TILES_PER_SIDE; i++) body += encodeTile(view.right[i]);
  for (let i = 0; i < BATTLE_MOVES; i++) body += encodeMove(menu ? ui?.moves?.[i] : undefined);
  return body;
}

/** Bytes do corpo do canal `B` (sem a cauda). */
export const BATTLE_BODY_BYTES = recordBytes(BATTLE_HEAD_FIELDS) + BATTLE_TILES_PER_SIDE * 2 * recordBytes(BATTLE_TILE_FIELDS)
  + BATTLE_MOVES * recordBytes(BATTLE_MOVE_FIELDS);
/** Onde começa a cauda (texto do aviso) no título inteiro, em bytes. */
export const BATTLE_TAIL_OFFSET = HEADER_BYTES + BATTLE_BODY_BYTES;

/** Texto do HP da caixa (BattleOverlay: flat "hp/max" para o aliado, "NN%" arredondado para cima para o oponente). */
export function battleHpText(hp: number, maxHp: number, flat: boolean): string {
  const max = Math.max(1, Math.round(maxHp));
  const cur = Math.max(0, Math.round(hp));
  if (flat) return `${cur}/${max}`;
  return `${Math.ceil((cur / max) * 100)}%`;
}

// ---------------------------------------------------------------------------------------------------------------
// Toast

export type ToastFrame = "t" | "g" | "c";
export type ToastColor = "y" | "p" | "w";

export interface ToastView {
  icon?: string;
  frame: ToastFrame;
  color: ToastColor;
  /** Chave de tradução ou texto literal (o label tenta traduzir). */
  line1: string;
  line2: string;
}

export function encodeToastBody(toast: ToastView | undefined): string {
  if (!toast) return encodeRecord(TOAST_FIELDS, { v: "0" });
  return encodeRecord(TOAST_FIELDS, {
    v: "1", icon: stripTextures(toast.icon), frame: toast.frame, color: toast.color, l1: toast.line1, l2: toast.line2,
  });
}

/** Cor da barra (getDepletableRedGreen do Cobblemon): r e g em 0..1, b fixo. Usada pelo importador nas texturas. */
export function depletableColor(ratio: number): [number, number, number] {
  const r = ratio > 0.2 ? -2 * ratio + 2 : 1;
  const g = ratio > 0.5 ? 1 : ratio > 0.2 ? ratio / 0.5 : 0;
  return [Math.min(1, r) * 0.8, g * 0.8, 0.27];
}
