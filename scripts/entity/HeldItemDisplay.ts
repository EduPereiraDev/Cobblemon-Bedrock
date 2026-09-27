/**
 * Item segurado visível no modelo (PokemonServerDelegate.updateShownItem + HeldItemRenderer do Cobblemon 1.8.2).
 *
 * O item segurado mora no slot 0 do inventário da entidade (PokemonData.applyToCobblemon). Uma cópia visual vai
 * para a mão secundária (`slot.weapon.offhand`, chance de drop 0 no BP): o Bedrock desenha itens comuns no osso
 * `leftItem` (posto no locator `item` pelo importador) e os vestíveis pelo attachable, preso à âncora
 * `cobblemon_anchor_hat`/`face`. A mão principal fica livre para o que a raposa pega do chão.
 *
 * Regras do Java: nada com `heldItemVisible == false`, itens da tag held/visibility/hidden e Alfas selvagens;
 * sem locator no modelo, nada aparece (o HeldItemRenderer só desenha em locator existente).
 */
import { Entity } from "@minecraft/server";
import { HELD_ITEM_LOCATORS, HIDDEN_HELD_ITEMS, VISIBILITY_FACE, VISIBILITY_HAT } from "../../generated/scripts/mundoDetalhes";
import { speciesIdOfType } from "./EntityData";

const HIDDEN = new Set(HIDDEN_HELD_ITEMS);
const HAT = new Set(VISIBILITY_HAT.filter(i => !i.startsWith("#")));
const FACE = new Set(VISIBILITY_FACE.filter(i => !i.startsWith("#")));
/** Propriedade dinâmica com o item mostrado (sobrevive ao recarregar o chunk; o slot de mão também). */
const SHOWN_PROPERTY = "cobblemon:shown_item";

export interface ShownItemInput {
  /** Item no slot 0 (id com namespace) ou undefined. */
  heldItem?: string;
  /** PokemonData.heldItemVisible (undefined = visível). */
  heldItemVisible?: boolean;
  alpha: boolean;
  wild: boolean;
  /** Bits de locators da variante (1 item, 2 item_hat, 4 item_face). */
  locatorFlags: number;
}

/** Id mostrado no modelo ("" = nada), como updateShownItem + a escolha de locator do HeldItemRenderer. */
export function shownHeldItem(input: ShownItemInput): string {
  const item = input.heldItem;
  if (!item || input.heldItemVisible === false) return "";
  if (HIDDEN.has(item) || (input.alpha && input.wild)) return "";
  const flags = input.locatorFlags;
  // renderAtLocator: rosto/chapéu se o locator existir, senão o locator "item".
  if (FACE.has(item) && (flags & 4)) return item;
  if (HAT.has(item) && (flags & 2)) return item;
  if (/_banner$/.test(item) && (flags & 2)) return item;
  return flags & 1 ? item : "";
}

/** Bits de locator da variante atual da entidade (0 se a espécie não tem locators de item). */
export function locatorFlagsOf(speciesId: string, variant: number): number {
  const flags = HELD_ITEM_LOCATORS[speciesId];
  if (!flags) return 0;
  return Number(flags[Math.max(0, Math.min(flags.length - 1, variant))] ?? 0) || 0;
}

const lastShown = new Map<string, string>();

export function forgetHeldItemDisplay(entityId: string) {
  lastShown.delete(entityId);
}

/**
 * Sincroniza a cópia visual na mão secundária. Barato: só roda comando quando o item mostrado muda.
 * `data` = campos do PokemonData usados (heldItemVisible).
 */
export function syncHeldItemDisplay(entity: Entity, data: { heldItemVisible?: boolean }) {
  const held = entity.getComponent("minecraft:inventory")?.container?.getItem(0)?.typeId;
  const variant = Number(entity.getProperty("cobblemon:variant") ?? 0);
  const shown = shownHeldItem({
    heldItem: held,
    heldItemVisible: data.heldItemVisible,
    alpha: entity.getProperty("cobblemon:alpha") === true,
    wild: entity.getProperty("cobblemon:wild") === true,
    locatorFlags: locatorFlagsOf(speciesIdOfType(entity.typeId), variant),
  });
  let previous = lastShown.get(entity.id);
  if (previous === undefined) {
    const stored = entity.getDynamicProperty(SHOWN_PROPERTY);
    previous = typeof stored === "string" ? stored : "";
  }
  if (previous === shown) {
    lastShown.set(entity.id, shown);
    return;
  }
  try {
    entity.runCommand(shown ? `replaceitem entity @s slot.weapon.offhand 0 ${shown} 1` : "replaceitem entity @s slot.weapon.offhand 0 air");
    entity.setDynamicProperty(SHOWN_PROPERTY, shown || undefined);
    lastShown.set(entity.id, shown);
  }
  catch {
    // Item sem id de comando (ou entidade saindo): tenta de novo na próxima passada.
  }
}
