/**
 * Frente msd-fase1: núcleo de gimmicks de batalha com paridade ao Cobblemon 1.8.2 (docs/pesquisa/9-extensao-mega-showdown.md
 * §3.1, §4.2 e §5.2 Fase 1).
 *
 * - `getGimmicks`/`hasActiveGimmick`/`blockGimmick`: ShowdownMoveset (battles/ShowdownActionRequest.kt:347-376).
 * - `sanitizeRequest`: ShowdownActionRequest.sanitize (:72-85): cada gimmick oferecido pelo Showdown só fica se o
 *   jogador tiver o item-chave (`cobblemon:key_stone`, `dynamax_band`, `tera_orb` ou `z_ring`). Com o
 *   `defaultKeyItems` vazio (padrão) ninguém tem as chaves: sem o Mega Showdown nenhum botão aparece, como no Java.
 * - `moveTileInfo`: o que cada tile do menu de golpes mostra (BattleMoveSelection.MoveTile, BattleGimmickButton
 *   GimmickTile/ZPowerTile/DynamaxTile): o golpe Z/Max no lugar do golpe, com o alvo dele.
 *
 * Os ids dos gimmicks são os do Cobblemon (`mega`, `ultra`, `zmove`, `max`, `terastal`: textura
 * `battle_gimmick_<id>`); o sufixo mandado ao Showdown é o canônico do @pkmn/sim (`GIMMICK_CHOICE`), que aceita os
 * dois.
 */
import type { Player } from "@minecraft/server";
import { Dex, toID } from "../showdown";
import type { MoveTarget } from "../showdown";
import { hasKeyItem } from "../pokemon/KeyItems";
import type { ActiveMoveset, RequestData } from "./Request";
import type { gimmickMove } from "./BattleMoveset";

export const Gimmick = {
  MEGA_EVOLUTION: "mega",
  ULTRA_BURST: "ultra",
  Z_POWER: "zmove",
  DYNAMAX: "max",
  TERASTALLIZATION: "terastal",
} as const;
export type Gimmick = (typeof Gimmick)[keyof typeof Gimmick];

/** Ordem do ShowdownMoveset.getGimmicks (ordem dos botões). */
export const GIMMICK_ORDER: readonly Gimmick[] = ["mega", "ultra", "zmove", "max", "terastal"];

/** Sufixo da escolha `move N [alvo] <sufixo>` no Showdown. */
export const GIMMICK_CHOICE: Readonly<Record<Gimmick, string>> = {
  mega: "mega",
  ultra: "ultra",
  zmove: "zmove",
  max: "dynamax",
  terastal: "terastallize",
};

/** Itens-chave do Cobblemon 1.8.2 (o `triggerItem` do sanitize). */
export const KEY_ITEMS = {
  KEY_STONE: "cobblemon:key_stone",
  Z_RING: "cobblemon:z_ring",
  DYNAMAX_BAND: "cobblemon:dynamax_band",
  TERA_ORB: "cobblemon:tera_orb",
} as const;
export const KEY_ITEM_IDS: readonly string[] = Object.values(KEY_ITEMS);

/** Item-chave que libera o gimmick (Ultra Burst e Z usam o Z-Ring, como no `else` do Cobblemon). */
export function keyItemFor(gimmick: Gimmick): string {
  switch (gimmick) {
    case "mega": return KEY_ITEMS.KEY_STONE;
    case "max": return KEY_ITEMS.DYNAMAX_BAND;
    case "terastal": return KEY_ITEMS.TERA_ORB;
    default: return KEY_ITEMS.Z_RING;
  }
}

/** Gimmick a partir do sufixo da escolha ou do id do Cobblemon (aceita os apelidos do Showdown). */
export function gimmickFromChoice(value: string | undefined): Gimmick | undefined {
  switch (toID(value ?? "")) {
    case "mega": return "mega";
    case "ultra": return "ultra";
    case "zmove": return "zmove";
    case "max": case "dynamax": case "gigantamax": return "max";
    case "terastal": case "terastallize": return "terastal";
    default: return undefined;
  }
}

/** O que os helpers leem de um moveset (serve para o ActiveMoveset do request e para o BattleMoveset). */
export type GimmickMoveset = Pick<ActiveMoveset, "canMegaEvo" | "canMegaEvoX" | "canMegaEvoY" | "canUltraBurst" | "canZMove" | "canDynamax" | "maxMoves" | "canTerastallize"> & {
  moves: { id: string; target?: string; pp?: number; maxpp?: number; disabled?: boolean | string }[];
};

/** Dynamax/Gigantamax já ativo (ShowdownMoveset.hasActiveGimmick): os tiles normais já são os golpes Max. */
export function hasActiveGimmick(moveset: GimmickMoveset): boolean {
  return !moveset.canDynamax && !!moveset.maxMoves;
}

/** Gimmicks que o Showdown oferece neste moveset (ShowdownMoveset.getGimmicks). */
export function getGimmicks(moveset: GimmickMoveset | undefined): Gimmick[] {
  if (!moveset || hasActiveGimmick(moveset)) return [];
  const out: Gimmick[] = [];
  if (moveset.canMegaEvo || moveset.canMegaEvoX || moveset.canMegaEvoY) out.push("mega");
  if (moveset.canUltraBurst) out.push("ultra");
  if (moveset.canZMove != null) out.push("zmove");
  if (moveset.canDynamax) out.push("max");
  if (moveset.canTerastallize != null) out.push("terastal");
  return out;
}

/** Tira o gimmick do moveset (ShowdownMoveset.blockGimmick). */
export function blockGimmick(moveset: GimmickMoveset, gimmick: Gimmick): void {
  switch (gimmick) {
    case "mega":
      moveset.canMegaEvo = false;
      delete moveset.canMegaEvoX;
      delete moveset.canMegaEvoY;
      break;
    case "ultra":
      moveset.canUltraBurst = false;
      break;
    case "zmove":
      delete moveset.canZMove;
      break;
    case "max":
      moveset.canDynamax = false;
      // Sem isto, `hasActiveGimmick` acharia que o Pokémon já está Dynamax (o MSD zera o mesmo campo no TAIL do
      // sanitize: ShowdownActionRequestMixin.java:30-48).
      delete moveset.maxMoves;
      break;
    case "terastal":
      delete moveset.canTerastallize;
      break;
  }
}

/** Bloqueia os gimmicks sem item-chave. Devolve os bloqueados (por posição, na ordem). */
export function sanitizeRequest(request: RequestData, hasKey: (key: string) => boolean): Gimmick[][] {
  return (request.active ?? []).map(moveset => {
    const blocked: Gimmick[] = [];
    if (!moveset) return blocked;
    for (const gimmick of getGimmicks(moveset)) {
      if (hasKey(keyItemFor(gimmick))) continue;
      blockGimmick(moveset, gimmick);
      blocked.push(gimmick);
    }
    return blocked;
  });
}

// ---------------------------------------------------------------------------------------------
// Itens-chave do jogador

/** Fonte extra de itens-chave (Fase 2: Key Stone/pulseiras no inventário ou na mão secundária, GimmickTurnCheck). */
export type KeyItemSource = (player: Player, key: string) => boolean;
const keyItemSources: KeyItemSource[] = [];

/** Registra uma fonte de itens-chave (idempotente). */
export function addKeyItemSource(source: KeyItemSource): void {
  if (!keyItemSources.includes(source)) keyItemSources.push(source);
}

/** Só para os testes. */
export function clearKeyItemSources(): void {
  keyItemSources.length = 0;
}

/** O jogador tem o item-chave? (`GeneralPlayerData.keyItems` + as fontes extras). Nunca lança. */
export function playerHasKeyItem(player: Player | undefined, key: string): boolean {
  if (!player) return false;
  try {
    if (!player.isValid) return false;
    if (hasKeyItem(player, key)) return true;
    return keyItemSources.some(source => {
      try { return source(player, key); }
      catch { return false; }
    });
  }
  catch {
    return false;
  }
}

/** Sanitize do request de um jogador (BattleActor.receiveRequest). */
export function sanitizePlayerRequest(request: RequestData, player: Player | undefined): Gimmick[][] {
  return sanitizeRequest(request, key => playerHasKeyItem(player, key));
}

// ---------------------------------------------------------------------------------------------
// Tiles de golpe

/** Golpe Z/Max da posição `index` (canZMove[i] ou maxMoves.maxMoves[i]). */
export function gimmickMoveAt(moveset: GimmickMoveset, index: number, gimmick: Gimmick | undefined): gimmickMove | undefined {
  if (gimmick === "zmove") return moveset.canZMove?.[index] ?? undefined;
  if (gimmick === "max" || (gimmick === undefined && hasActiveGimmick(moveset))) return moveset.maxMoves?.maxMoves?.[index] ?? undefined;
  return undefined;
}

/** O que o tile de um golpe mostra e escolhe, com ou sem gimmick ligado. */
export interface MoveTileInfo {
  index: number;
  /** Id do golpe no request (é ele que vai na escolha: o Showdown troca pela versão Z/Max). */
  baseId: string;
  /** Golpe mostrado: o Z/Max quando há, senão o próprio. */
  displayId: string;
  /** Golpe Z de status ("Z-Swords Dance"): não tem registro próprio, mostra "Z-" + o golpe base. */
  zStatus: boolean;
  /** Tipo do Showdown ("Fire"). */
  type: string;
  /** Categoria do golpe BASE (o Cobblemon mostra a do golpe base também no Z/Max). */
  category: string;
  target: MoveTarget;
  pp?: number;
  maxpp?: number;
  /** Aparece esmaecido. */
  disabled: boolean;
  /** Pode ser escolhido (ZPowerTile/DynamaxTile: só com golpe Z/Max válido). */
  selectable: boolean;
  gimmickMove?: gimmickMove;
}

/** Golpe usável (a regra de sempre do menu de golpes: PP > 0 e não desabilitado; Struggle sempre). */
function baseUsable(move: GimmickMoveset["moves"][number]): boolean {
  if (move.id === "struggle") return true;
  return !move.disabled && (move.pp === undefined || move.maxpp === undefined || move.pp > 0);
}

export function moveTileInfo(moveset: GimmickMoveset, index: number, gimmick?: Gimmick): MoveTileInfo {
  const move = moveset.moves[index];
  const base = Dex.moves.get(move.id);
  const info: MoveTileInfo = {
    index,
    baseId: move.id,
    displayId: move.id,
    zStatus: false,
    type: base.type,
    category: base.category,
    target: (move.target ?? base.target) as MoveTarget,
    pp: move.pp,
    maxpp: move.maxpp,
    disabled: !baseUsable(move),
    selectable: baseUsable(move),
  };
  const dynamaxed = hasActiveGimmick(moveset);
  const wantsGimmickMove = gimmick === "zmove" || gimmick === "max" || (gimmick === undefined && dynamaxed);
  if (!wantsGimmickMove) return info;
  const gm = gimmickMoveAt(moveset, index, gimmick);
  if (!gm) {
    // Sem versão Z/Max: o tile mostra o golpe base, mas não pode ser escolhido com o gimmick ligado.
    if (gimmick === "zmove" || gimmick === "max") {
      info.selectable = false;
      info.disabled = true;
    }
    return info;
  }
  const id = toID(gm.move);
  const data = Dex.moves.get(id);
  info.gimmickMove = gm;
  if (data.exists) {
    info.displayId = data.id;
    info.type = data.type;
  }
  else info.zStatus = gimmick === "zmove";
  info.target = (gm.target ?? (data.exists ? data.target : info.target)) as MoveTarget;
  info.disabled = !!gm.disabled;
  info.selectable = !gm.disabled;
  return info;
}

/** Gimmicks do moveset que ainda não foram escolhidos por outra posição neste turno (pendingGimmickUsedThisTurn). */
export function availableGimmicks(moveset: GimmickMoveset | undefined, usedThisTurn: ReadonlySet<Gimmick> = new Set()): Gimmick[] {
  return getGimmicks(moveset).filter(gimmick => !usedThisTurn.has(gimmick));
}

/** Chave de tradução do botão do gimmick. */
export function gimmickLabelKey(gimmick: Gimmick): string {
  return `cobblemon.port.battle.ui.gimmick.${gimmick}`;
}

/** Textura do botão (BattleGimmickButton: `textures/gui/battle/battle_gimmick_<id>.png`, 36×68, 2 quadros). */
export function gimmickTexture(gimmick: Gimmick): string {
  return `textures/gui/cobblemon/battle/battle_gimmick_${gimmick}`;
}
