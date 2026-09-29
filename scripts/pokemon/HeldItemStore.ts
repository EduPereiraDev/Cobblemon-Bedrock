/**
 * Item segurado de um Pokémon fora da bola: fica só nos dados salvos na entidade (propriedade dinâmica "data",
 * campos `PokemonData.minecraftItem` e `PokemonData.item`), nunca num inventário da entidade.
 *
 * No Cobblemon Java o PokemonEntity não tem inventário acessível (não implementa HasCustomInventoryScreen/
 * ContainerEntity): montado, o E abre o inventário do jogador, e o item segurado só muda pelos caminhos do mod
 * (PokemonEntity.offerHeldItem, menu do Pokémon, batalha...). Até o beta 7 o port guardava o item no espaço 0 de um
 * `minecraft:inventory` de 1 espaço; montado, o Bedrock abria esse inventário com o E (como o do cavalo), o item posto
 * ali não entrava nos dados e sumia na próxima gravação (docs/pendencias/item-segurado.md).
 *
 * Todos os leitores/escritores do item segurado de uma entidade usam estas funções.
 */

/** O que o helper usa da entidade (Entity do @minecraft/server ou um dublê nos testes). */
export interface HeldItemEntity {
  readonly id?: string;
  getDynamicProperty(identifier: string): unknown;
  setDynamicProperty(identifier: string, value?: string): void;
}

/** Propriedade dinâmica com o JSON do PokemonData (Pokemon.applyToCobblemon). */
export const DATA_PROPERTY = "data";

/** `PokemonData.item` a partir do id do Minecraft (como toID(removeNamespace(typeId)) do loadFromCobblemon). */
export function heldItemKey(typeId: string | undefined): string {
  if (!typeId) return "";
  return (typeId.split(":").pop() ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Último JSON lido por entidade: o laço de 1 s (item mostrado) não reinterpreta o mesmo JSON a cada passada. */
const cache = new Map<string, { json: string; item: string | undefined }>();

function readJson(entity: HeldItemEntity): string | undefined {
  try {
    const json = entity.getDynamicProperty(DATA_PROPERTY);
    return typeof json === "string" && json ? json : undefined;
  }
  catch {
    return undefined; // entidade descarregada/inválida
  }
}

function itemOf(raw: unknown): string | undefined {
  const item = (raw as { minecraftItem?: unknown } | null)?.minecraftItem;
  return typeof item === "string" && item ? item : undefined;
}

/** Id do item segurado (com namespace) ou undefined (sem item, sem dados ou dados ilegíveis). */
export function getHeldItemOnEntity(entity: HeldItemEntity): string | undefined {
  const json = readJson(entity);
  if (json === undefined) return undefined;
  const key = entity.id;
  const hit = key !== undefined ? cache.get(key) : undefined;
  if (hit && hit.json === json) return hit.item;
  let item: string | undefined;
  try { item = itemOf(JSON.parse(json)); }
  catch { item = undefined; }
  if (key !== undefined) cache.set(key, { json, item });
  return item;
}

/**
 * Troca o item segurado nos dados da entidade (undefined = sem item). Devolve false se a entidade não tem dados
 * válidos (nada foi gravado: quem chama não deve consumir/devolver itens do jogador).
 */
export function setHeldItemOnEntity(entity: HeldItemEntity, itemId: string | undefined): boolean {
  const json = readJson(entity);
  if (json === undefined) return false;
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    raw = parsed as Record<string, unknown>;
  }
  catch {
    return false;
  }
  const item = itemId || undefined;
  raw.minecraftItem = item;
  raw.item = heldItemKey(item);
  const next = JSON.stringify(raw);
  try { entity.setDynamicProperty(DATA_PROPERTY, next); }
  catch { return false; }
  if (entity.id !== undefined) cache.set(entity.id, { json: next, item });
  return true;
}

/** Dá o item só se o Pokémon não segura nada (item da boca na captura). Devolve true se o item ficou com ele. */
export function giveHeldItemIfEmpty(entity: HeldItemEntity, itemId: string): boolean {
  if (getHeldItemOnEntity(entity) !== undefined) return false;
  return setHeldItemOnEntity(entity, itemId);
}

/** Esquece o cache de uma entidade (saiu do mundo). */
export function forgetHeldItemCache(entityId: string): void {
  cache.delete(entityId);
}
