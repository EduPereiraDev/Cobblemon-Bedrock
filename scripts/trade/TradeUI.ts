/**
 * Telas da troca (client/gui/trade do Cobblemon) com server-ui. Não há tela ao vivo compartilhada: cada
 * mudança (oferta/aceite do outro) fecha e reabre o menu dos dois com o estado novo.
 *
 * - Pedido recebido: MessageFormData Aceitar/Recusar (se o jogador estiver ocupado, fica só a mensagem no
 *   chat; aceitar = interagir/pedir troca de volta, como no Cobblemon).
 * - Menu da troca: as duas ofertas (espécie, nível, gênero, shiny, natureza, habilidade, item) e botões
 *   Escolher Pokémon / Aceitar ou Retirar aceite / Cancelar. Fechar a tela cancela a troca (como fechar a GUI).
 */
import { Player, RawMessage, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, MessageFormData, uiManager } from "@minecraft/server-ui";
import { ActiveTrade, TradeCancelReason, TradeListener, TradeManager, TradeRequest, TradeResult } from "./TradeManager";
import { PokemonData } from "../Pokemon";
import { getSafeTeam } from "../pokemonStorage";
import { message } from "../language";
import { abilityName, itemName, natureName } from "../GUI/common";
import { toID } from "../utils";

const K = {
  title: "cobblemon.ui.trade",
  accept: "cobblemon.ui.interact.accept",
  decline: "cobblemon.ui.interact.decline",
  yourOffer: "cobblemon.port.trade.your_offer",
  theirOffer: "cobblemon.port.trade.their_offer",
  nothing: "cobblemon.port.trade.nothing_offered",
  choose: "cobblemon.port.trade.choose",
  withdraw: "cobblemon.port.trade.withdraw_offer",
  acceptTrade: "cobblemon.port.trade.accept",
  unaccept: "cobblemon.port.trade.unaccept",
  cancel: "cobblemon.port.trade.cancel",
  accepted: "cobblemon.port.trade.accepted",
  waiting: "cobblemon.port.trade.waiting",
  cancelled: "cobblemon.port.trade.cancelled",
  completed: "cobblemon.port.trade.completed",
  invalid: "cobblemon.port.trade.invalid",
  requestBody: "cobblemon.trade.received",
  back: "gui.back",
} as const;

function tr(key: string, ...args: (string | RawMessage)[]): RawMessage {
  return args.length ? message.With(key, args) : { translate: key };
}

function lines(...parts: RawMessage[]): RawMessage {
  const rawtext: RawMessage[] = [];
  parts.forEach((p, i) => {
    if (i) rawtext.push({ text: "\n" });
    rawtext.push(p);
  });
  return { rawtext };
}

/** Resumo de uma oferta (TradeablePokemon: o que o outro vê antes de aceitar). */
export function describePokemon(pokemon: PokemonData): RawMessage {
  const parts: RawMessage[] = [
    pokemon.shiny ? { text: "§6★ " } : { text: "" },
    pokemon.getTranslatedName(),
    { text: ` §7Lv. ${pokemon.level}` },
    { text: pokemon.gender === "m" ? " §b♂" : pokemon.gender === "f" ? " §d♀" : "" },
  ];
  if (pokemon.name) parts.push({ text: " §8(" }, { translate: `cobblemon.species.${toID(pokemon.species)}.name` }, { text: ")" });
  const detail: RawMessage[] = [{ text: "\n§7" }, natureName(pokemon.getEffectiveNature())];
  if (pokemon.ability) detail.push({ text: " §8| §7" }, abilityName(pokemon.ability));
  if (pokemon.minecraftItem) detail.push({ text: " §8| §7" }, itemName(pokemon.minecraftItem));
  return { rawtext: [...parts, ...detail] };
}

function offeredPokemon(player: Player, uuid: string | undefined): PokemonData | undefined {
  if (!uuid) return undefined;
  return getSafeTeam(player).find(p => p?.uuid === uuid) ?? undefined;
}

interface PlayerUIState {
  token: number;
  busyRetries: number;
}

export class TradeForms implements TradeListener {
  private states = new Map<string, PlayerUIState>();
  manager!: TradeManager;

  private state(player: Player): PlayerUIState {
    let s = this.states.get(player.id);
    if (!s) this.states.set(player.id, s = { token: 0, busyRetries: 0 });
    return s;
  }

  /** Invalida a tela aberta (a resposta dela será ignorada) e fecha. */
  private closeFor(player: Player) {
    this.state(player).token++;
    try { if (player.isValid) uiManager.closeAllForms(player); } catch { }
  }

  onRequest(request: TradeRequest) {
    const { receiver, sender } = request;
    const form = new MessageFormData()
      .title({ translate: K.title })
      .body(tr(K.requestBody, sender.name))
      .button1({ translate: K.accept })
      .button2({ translate: K.decline });
    form.show(receiver).then(response => {
      if (response.canceled) return; // ocupado/fechou: o pedido continua valendo até expirar
      if (response.selection === 0) this.manager.acceptRequest(receiver, request.id);
      else this.manager.declineRequest(receiver, request.id);
    }).catch(() => { });
  }

  onTradeStarted(trade: ActiveTrade) {
    for (const p of trade.participants) this.openMenu(trade, p.player);
  }

  onTradeUpdated(trade: ActiveTrade) {
    for (const p of trade.participants) {
      this.closeFor(p.player);
      system.run(() => { if (!trade.finished) this.openMenu(trade, p.player); });
    }
  }

  onTradeCancelled(trade: ActiveTrade, reason: TradeCancelReason, byName?: string) {
    for (const p of trade.participants) {
      if (!p.player.isValid) continue;
      this.closeFor(p.player);
      p.player.sendMessage(message.error(reason === "invalid" ? { translate: K.invalid } : tr(K.cancelled, byName ?? "?")));
    }
  }

  onTradeCompleted(trade: ActiveTrade, result: TradeResult) {
    for (const p of trade.participants) {
      if (!p.player.isValid) continue;
      this.closeFor(p.player);
      const received = result.received.get(p.player.id);
      const other = trade.other(p.player.id);
      const given = other ? result.received.get(other.player.id) : undefined;
      if (received && given) p.player.sendMessage(message.With(K.completed, [given, received]));
      // Som da troca do Cobblemon (TradeGUI: CobblemonSounds.TRADE).
      try { p.player.playSound("cobblemon.gui.trade"); } catch { }
    }
  }

  /** Abre (ou reabre) o menu da troca. */
  openMenu(trade: ActiveTrade, player: Player) {
    if (trade.finished || !player.isValid) return;
    const me = trade.participant(player.id);
    const them = trade.other(player.id);
    if (!me || !them) return;
    const state = this.state(player);
    const token = ++state.token;
    // Ofertas desenhadas pelo UUID (o mesmo que a troca vai usar), não pelo espaço do time.
    const myPokemon = offeredPokemon(player, me.offer.pokemonUuid);
    const theirPokemon = offeredPokemon(them.player, them.offer.pokemonUuid);
    // Aceite preso ao Pokémon que esta tela mostrou: se a oferta mudar antes do clique, o aceite é recusado.
    const shownTheirUuid = theirPokemon?.uuid;
    const body = lines(
      { rawtext: [{ text: "§e" }, { translate: K.yourOffer }, { text: "§r " }, me.offer.accepted ? { text: "§a✔" } : { text: "" }] },
      myPokemon ? describePokemon(myPokemon) : { translate: K.nothing },
      { text: "" },
      { rawtext: [{ text: "§e" }, tr(K.theirOffer, them.player.name), { text: "§r " }, them.offer.accepted ? { text: "§a✔" } : { text: "" }] },
      theirPokemon ? describePokemon(theirPokemon) : { translate: K.nothing },
      { text: "" },
      { translate: me.offer.accepted ? K.accepted : K.waiting },
    );
    const form = new ActionFormData().title(tr(K.title)).body(body);
    const actions: (() => void)[] = [];
    form.button({ translate: K.choose });
    actions.push(() => this.openPartySelect(trade, player));
    if (myPokemon && theirPokemon) {
      form.button({ translate: me.offer.accepted ? K.unaccept : K.acceptTrade });
      actions.push(() => {
        if (!this.manager.setAcceptance(player, !me.offer.accepted, shownTheirUuid)) this.openMenu(trade, player);
      });
    }
    form.button({ translate: K.cancel });
    actions.push(() => this.manager.cancelTrade(trade, "cancelled", player));
    form.show(player).then(response => {
      if (state.token !== token || trade.finished) return;
      if (response.canceled || response.selection === undefined) return this.handleCancel(trade, player, response.cancelationReason);
      state.busyRetries = 0;
      actions[response.selection]?.();
    }).catch(e => console.warn(`Troca: ${e}`));
  }

  private openPartySelect(trade: ActiveTrade, player: Player) {
    if (trade.finished) return;
    const state = this.state(player);
    const token = ++state.token;
    const team = getSafeTeam(player);
    const form = new ActionFormData().title(tr(K.title)).body({ translate: K.choose });
    const slots: (number | undefined | "back")[] = [];
    team.forEach((pokemon, slot) => {
      if (!pokemon) return;
      form.button({ rawtext: [pokemon.getTranslatedName(), { text: ` §7Lv. ${pokemon.level}` }] });
      slots.push(slot);
    });
    if (trade.participant(player.id)?.offer.slot !== undefined) {
      form.button({ translate: K.withdraw });
      slots.push(undefined);
    }
    form.button({ translate: K.back });
    slots.push("back");
    form.show(player).then(response => {
      if (state.token !== token || trade.finished) return;
      if (response.canceled || response.selection === undefined) return this.handleCancel(trade, player, response.cancelationReason, true);
      const choice = slots[response.selection];
      if (choice === "back") return this.openMenu(trade, player);
      const slot = choice;
      const ok = this.manager.updateOffer(player, slot, slot !== undefined ? team[slot]?.uuid : undefined);
      if (!ok) this.openMenu(trade, player);
    }).catch(e => console.warn(`Troca: ${e}`));
  }

  private handleCancel(trade: ActiveTrade, player: Player, reason: FormCancelationReason | undefined, submenu = false) {
    const state = this.state(player);
    if (reason === FormCancelationReason.UserBusy) {
      if (++state.busyRetries > 40) return this.manager.cancelTrade(trade, "busy", player);
      // Só reabre se nenhuma outra tela foi aberta nesse meio-tempo (ex.: atualização da troca).
      const token = state.token;
      system.runTimeout(() => { if (state.token === token) this.openMenu(trade, player); }, 10);
      return;
    }
    state.busyRetries = 0;
    // Fechar o submenu volta ao menu; fechar o menu cancela a troca.
    if (submenu) return this.openMenu(trade, player);
    this.manager.cancelTrade(trade, "cancelled", player);
  }
}

// ---------------------------------------------------------------------------------------------
// Instância do jogo

export const tradeForms = new TradeForms();
export const tradeManager = new TradeManager({
  now: () => system.currentTick,
  schedule: (fn, ticks) => { system.runTimeout(fn, ticks); },
  listener: tradeForms,
});
tradeForms.manager = tradeManager;

/** Menu de interação → "Trocar" / comando: pede (ou aceita) troca com o alvo. */
export function requestTradeWith(sender: Player, target: Player) {
  const trade = tradeManager.getActiveTrade(sender.id);
  if (trade) {
    // Já trocando com este jogador: reabre o menu (tela fechada por engano não existe: fechar cancela).
    if (trade.other(sender.id)?.player.id === target.id) return tradeForms.openMenu(trade, sender);
  }
  tradeManager.requestTrade(sender, target);
}

/** world.afterEvents.playerLeave. */
export function onTradePlayerLeave(playerId: string) {
  tradeManager.onPlayerLeave(playerId);
}
