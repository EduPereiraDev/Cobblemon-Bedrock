/**
 * Nome traduzível de itens de outro namespace (frente msd-fase6). O Bedrock não expõe a tradução de um item e o port
 * monta a chave pela regra de cada namespace: `cobblemon` → `item.cobblemon.<id>`, vanilla → `item.<id>.name`. Um pack
 * que registra itens com outra regra (ex.: `minecraft:display_name` = `item.<ns>.<id>` / `block.<ns>.<id>`) registra
 * aqui um provedor para o namespace dele. Sem provedor, as telas usam a regra de sempre.
 */
import type { RawMessage } from "@minecraft/server";

/** Devolve o nome do item `id` (sem namespace) ou undefined para cair na regra padrão. */
export type ItemNameProvider = (id: string) => RawMessage | undefined;

const providers = new Map<string, ItemNameProvider>();

export function registerItemNameProvider(namespace: string, provider: ItemNameProvider): void {
  providers.set(namespace, provider);
}

/** Só para os testes. */
export function clearItemNameProvidersForTests(): void {
  providers.clear();
}

/** Nome pelo provedor do namespace, ou undefined (sem provedor, ou o provedor não conhece o item). */
export function providedItemName(namespace: string, id: string): RawMessage | undefined {
  const provider = providers.get(namespace);
  if (!provider) return undefined;
  try { return provider(id); }
  catch { return undefined; }
}
