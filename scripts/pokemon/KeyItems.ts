/**
 * Itens-chave do jogador (Cobblemon 1.8.2: `GeneralPlayerData.keyItems`, `ServerPlayer.hasKeyItem`, config
 * `defaultKeyItems`). No Cobblemon eles liberam os gimmicks de batalha do Showdown (Mega, Z, Dynamax, Tera:
 * `ShowdownActionRequest` bloqueia o gimmick sem o item-chave). Frente msd-fase1: o port faz o mesmo em
 * `battle/Gimmicks.ts` (sanitize do request do jogador); com a lista vazia, nenhum gimmick aparece.
 *
 * Como `GeneralPlayerData.initialize`: todo jogador (novo ou existente) recebe os itens de `defaultKeyItems` que ainda
 * não tem, a cada entrada no mundo.
 */
import type { Player } from "@minecraft/server";
import { getConfig } from "../Config";

export const KEY_ITEMS_PROPERTY = "cobblemon:key_items";

type Holder = Pick<Player, "getDynamicProperty" | "setDynamicProperty">;

export function getKeyItems(player: Holder): string[] {
  try {
    const raw = player.getDynamicProperty(KEY_ITEMS_PROPERTY);
    const list = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  }
  catch { return []; }
}

export function hasKeyItem(player: Holder, key: string): boolean {
  return getKeyItems(player).includes(key);
}

/** Acrescenta os itens-chave padrão que faltam. Retorna quantos entraram. */
export function grantDefaultKeyItems(player: Holder, defaults: readonly string[] = getConfig().defaultKeyItems): number {
  const current = getKeyItems(player);
  const missing = defaults.filter(key => key && !current.includes(key));
  if (missing.length === 0) return 0;
  player.setDynamicProperty(KEY_ITEMS_PROPERTY, JSON.stringify([...current, ...missing]));
  return missing.length;
}
