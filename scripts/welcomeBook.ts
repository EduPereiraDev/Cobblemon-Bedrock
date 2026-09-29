// Livro de boas-vindas: um livro assinado entregue na mão na primeira entrada do jogador no mundo.
// Item comum (pode ser dropado, guardado, perdido); só é entregue uma vez por jogador. Texto por chave de tradução
// (RawMessage), então cada cliente lê no próprio idioma. API estável: ItemBookComponent (@minecraft/server 2.10.0).
import { ItemStack, Player, RawMessage, world } from "@minecraft/server";
import { isControlItem } from "./controle/logic";

export const WELCOME_BOOK_PROPERTY = "cobblemon:livro_recebido";
export const WELCOME_BOOK_TITLE = "Cobblemon BE"; // máx. 16 caracteres (signBook)
export const WELCOME_BOOK_AUTHOR = "EduPereiraDev";

// Chaves curtas: a página tem limite de 256 caracteres no JSON da RawMessage (a página 1 fica em ~210).
const line = (key: string): RawMessage => ({ translate: `cobblemon.livro.${key}` });
const BREAK: RawMessage = { text: "\n\n" };

/** Páginas (cada uma bem abaixo do limite de 256 caracteres do JSON da RawMessage). */
export const WELCOME_BOOK_PAGES: RawMessage[] = [
  { rawtext: [line("titulo"), BREAK, line("autor"), BREAK, line("frase"), BREAK, line("memoria")] },
  { rawtext: [line("creditos"), BREAK, line("repo")] },
];

export function createWelcomeBook(): ItemStack {
  const stack = new ItemStack("minecraft:writable_book", 1);
  const book = stack.getComponent("minecraft:book");
  if (!book) throw new Error("livro sem componente minecraft:book");
  book.setContents(WELCOME_BOOK_PAGES);
  // Assinar troca o livro e pena por livro escrito (título + autor na dica do item).
  book.signBook(WELCOME_BOOK_TITLE, WELCOME_BOOK_AUTHOR);
  return stack;
}

/** Entrega o livro uma única vez: na mão se o espaço selecionado estiver vazio, senão no primeiro espaço livre. */
export function giveWelcomeBook(player: Player): boolean {
  if (!player.isValid || player.getDynamicProperty(WELCOME_BOOK_PROPERTY) === true) return false;
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return false;
  const selected = player.selectedSlotIndex;
  const held = container.getItem(selected);
  let slot = selected;
  if (held !== undefined) {
    const empty = container.firstEmptySlot();
    // Inventário cheio: não marca como recebido; tenta de novo na próxima entrada.
    if (empty === undefined) return false;
    // Mundo novo: o laço do item de controle pode ter chegado antes; ele cede a mão ao livro (a trava vai junto).
    if (isControlItem(held.typeId)) container.swapItems(selected, empty, container);
    else slot = empty;
  }
  container.setItem(slot, createWelcomeBook());
  player.setDynamicProperty(WELCOME_BOOK_PROPERTY, true);
  console.info(`Cobblemon Bedrock: livro de boas-vindas entregue a ${player.name} (espaço ${slot})`);
  return true;
}

export function startWelcomeBook(): void {
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return;
    try { giveWelcomeBook(player); }
    catch (e) { console.warn(`Livro de boas-vindas: ${e}`); }
  });
}
