/**
 * Frente controle: lógica pura do item de controle ("Poké Ball do time"), sem API do Minecraft (testada em
 * tests/controle.test.ts). O runtime fica em scripts/controle/index.ts.
 *
 * O item substitui as teclas do Cobblemon Java (R = PartySendBinding, setas do overlay, M = menu do time):
 * - usar (em pé)            → menu do time (o mesmo de /cobblemon:party; sem time, a escolha do inicial);
 * - agachado + usar         → envio rápido (tecla R): solta/recolhe o selecionado, batalha com o selvagem mirado;
 * - agachado + atacar       → próximo Pokémon do time (seta para baixo), dando a volta no fim;
 * - usar num Pokémon seu    → em pé: menu do Pokémon; agachado: montar/ombro (sem montaria possível: menu do Pokémon).
 */

export const CONTROL_ITEM_ID = "cobblemon:party_control";

/** Dynamic properties por jogador (contadores das dicas na actionbar). */
export const HINT_SHOWS_PROPERTY = "cobblemon:controle_hint_shows";
export const USES_PROPERTY = "cobblemon:controle_uses";
/** A dica aparece no máximo estas vezes... */
export const HINT_MAX_SHOWS = 5;
/** ...e some de vez depois destes usos do item. */
export const HINT_MAX_USES = 5;

/**
 * Janela (ticks) em que um novo clique é tratado como "segurando o botão": o Bedrock repete o uso/balanço enquanto o
 * botão fica apertado (~4-5 ticks); só a primeira batida conta.
 */
export const REPEAT_TICKS = 6;
/** Intervalo do laço de garantia do inventário (ticks). */
export const ENSURE_INTERVAL_TICKS = 20;

export function isControlItem(typeId: string | undefined): boolean {
  return typeId === CONTROL_ITEM_ID;
}

// ---------------------------------------------------------------------------------------------
// Entradas

/** Resultado do clique direito com o item (sem entidade na mira de interação). */
export type UseAction = "party_menu" | "quick_send" | "none";

export interface UseContext {
  sneaking: boolean;
  /** Montado: agachar é descer/desmontar, então só o menu vale. */
  riding: boolean;
}

export function resolveUseAction(ctx: UseContext): UseAction {
  if (ctx.sneaking && !ctx.riding) return "quick_send";
  if (ctx.sneaking) return "none";
  return "party_menu";
}

/** Clique direito num bloco com o item. */
export type BlockUseAction = "quick_send" | "party_menu" | "vanilla" | "blocked";

/**
 * Blocos que guardariam o item da mão (moldura, vaso decorado, vitrine do Cobblemon...): com o item de controle,
 * o clique em pé é bloqueado para ele nunca sair do inventário.
 */
const STORES_HELD_ITEM = /^minecraft:(frame|glow_frame|decorated_pot|chiseled_bookshelf|lectern|jukebox|flower_pot|composter)$|display_case/;

export function storesHeldItem(blockTypeId: string): boolean {
  return STORES_HELD_ITEM.test(blockTypeId);
}

/**
 * Agachado: envio rápido (o clique no chão é o "onde o jogador olha"). Em pé: blocos interativos (baú, porta, PC...)
 * seguem o vanilla; os que guardariam o item são bloqueados; os demais abrem o menu do time.
 */
export function resolveBlockUseAction(blockTypeId: string, sneaking: boolean, riding: boolean, interactive: boolean): BlockUseAction {
  if (sneaking) return riding ? "blocked" : "quick_send";
  if (storesHeldItem(blockTypeId)) return "blocked";
  if (interactive) return "vanilla";
  return "party_menu";
}

/** Entidades que tomariam o item da mão (suporte de armadura, allay): a interação é bloqueada com o item. */
const TAKES_HELD_ITEM = new Set(["minecraft:armor_stand", "minecraft:allay"]);

export function takesHeldItem(entityTypeId: string): boolean {
  return TAKES_HELD_ITEM.has(entityTypeId);
}

/** Clique direito num Pokémon com o item. "empty_hand" = segue o fluxo normal como se a mão estivesse vazia. */
export type PokemonUseAction = "wild_battle" | "mount_or_menu" | "empty_hand";

export interface PokemonUseContext {
  sneaking: boolean;
  own: boolean;
  wild: boolean;
}

export function resolvePokemonUseAction(ctx: PokemonUseContext): PokemonUseAction {
  if (!ctx.sneaking) return "empty_hand";
  if (ctx.own) return "mount_or_menu";
  if (ctx.wild) return "wild_battle";
  return "empty_hand";
}

/**
 * Fontes de balanço do braço que contam como "botão esquerdo": no ar/entidade = Attack, em bloco = Mine (o cliente
 * manda a fonte no pacote animate). None = cliente que não manda a fonte: conta, e o runtime descarta o balanço que
 * coincide com um uso/interação (o balanço do botão direito).
 */
export function isLeftClickSwing(source: string | undefined): boolean {
  return source === "Attack" || source === "Mine" || source === "None";
}

/** Janela (ticks) em que um uso/interação do mesmo jogador faz o balanço ser do botão direito. */
export const USE_SWING_WINDOW_TICKS = 2;

/** Algum desses ticks de uso/interação está a até `window` ticks do balanço? */
export function swingFromUse(swingTick: number, useTicks: readonly (number | undefined)[], window = USE_SWING_WINDOW_TICKS): boolean {
  return useTicks.some(t => t !== undefined && Math.abs(t - swingTick) <= window);
}

/**
 * Registro de "segurando o botão": devolve true se este evento é repetição (houve outro há ≤ REPEAT_TICKS) e
 * sempre atualiza o último tick.
 */
export function isRepeat(last: Map<string, number>, id: string, tick: number, window = REPEAT_TICKS): boolean {
  const previous = last.get(id);
  last.set(id, tick);
  return previous !== undefined && tick - previous >= 0 && tick - previous <= window;
}

// ---------------------------------------------------------------------------------------------
// Inventário: exatamente 1 item por jogador

export interface SlotInfo {
  slot: number;
  typeId?: string;
  /** lockMode === inventory (ou slot). */
  locked: boolean;
  keepOnDeath: boolean;
}

export interface InventoryPlan {
  /** Nenhum no jogador: entregar um. */
  give: boolean;
  /** Espaço do item que fica (undefined = o do cursor, ou nenhum). */
  keep?: number;
  /** Espaços com cópias a remover. */
  remove: number[];
  /** O item que fica perdeu a trava ou o keepOnDeath: regravar. */
  fix: boolean;
}

/**
 * Plano para ter exatamente 1 item: o do cursor (o jogador está arrastando) tem prioridade; senão o primeiro espaço
 * (a hotbar vem antes). Cópias são removidas; faltando, entrega um.
 */
export function planInventory(slots: readonly SlotInfo[], cursorHasItem: boolean): InventoryPlan {
  const copies = slots.filter(s => isControlItem(s.typeId));
  if (cursorHasItem) return { give: false, remove: copies.map(s => s.slot), fix: false };
  if (!copies.length) return { give: true, remove: [], fix: false };
  const [kept, ...rest] = [...copies].sort((a, b) => a.slot - b.slot);
  return { give: false, keep: kept.slot, remove: rest.map(s => s.slot), fix: !kept.locked || !kept.keepOnDeath };
}

// ---------------------------------------------------------------------------------------------
// Dicas na actionbar

export interface HintCounters {
  shows: number;
  uses: number;
}

export function shouldShowHint(counters: HintCounters): boolean {
  return counters.shows < HINT_MAX_SHOWS && counters.uses < HINT_MAX_USES;
}

/** Chave da dica pelo modo de entrada (teclado/mouse, controle, toque). */
export function hintKey(inputMode: string | undefined): string {
  if (inputMode === "Gamepad") return "cobblemon.port.controle.hint.gamepad";
  if (inputMode === "Touch") return "cobblemon.port.controle.hint.touch";
  return "cobblemon.port.controle.hint.mouse";
}

/** Lê um contador numérico de dynamic property (0 se ausente/inválido). */
export function counterValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
