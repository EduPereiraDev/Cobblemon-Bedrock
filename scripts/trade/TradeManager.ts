/**
 * Troca entre jogadores (trade/TradeManager.kt, ActiveTrade.kt, api/interaction/RequestManager.kt do Cobblemon 1.8.2).
 *
 * Fluxo: pedido (expira em 20 s) → aceite → cada um escolhe um Pokémon do time → cada um aceita a oferta do
 * outro (trocar a oferta desfaz os dois aceites) → com os dois aceites a troca acontece na hora.
 *
 * A troca é atômica: relê os dois times do armazenamento, confere que os UUIDs oferecidos ainda estão nos
 * mesmos espaços (ou em outro espaço do time), recolhe as entidades em campo e grava os dois times no mesmo
 * tick; se a segunda gravação falhar, a primeira é desfeita. Depois testa as evoluções por troca
 * (TradeEvolution, com o Pokémon recebido em troca como contexto).
 */
import type { Player, RawMessage } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { PCPlace, getSafeTeam, setPokemonToPCLocation } from "../pokemonStorage";
import { getConfig } from "../Config";
import { TradeEvolution } from "../evolution/variants/TradeEvolution";
import { message } from "../language";
import { tryGetBattleFromEntity } from "../battle";
import { markCaught } from "../pokedex/PokedexStorage";
import { recordTrade } from "../pokedex/Progress";
import { toSpeciesId } from "../speciesData";
import { isPastured } from "../machines/pasture";

/** Tempo de vida do pedido (TradeRequest.expiryTime = 20 s), em ticks. */
export const TRADE_REQUEST_TICKS = 20 * 20;

/** O que a troca precisa de um jogador (Player do jogo, ou falso nos testes). */
export type TradePlayer = Player;

export interface TradeRequest {
  id: number;
  sender: TradePlayer;
  receiver: TradePlayer;
  /** Nomes guardados na criação: depois que o jogador sai, ler `player.name` lança exceção. */
  senderName: string;
  receiverName: string;
  expiresAt: number;
}

export interface TradeOffer {
  /** Espaço do time (0–5) e UUID oferecidos; undefined = ainda escolhendo. */
  slot?: number;
  pokemonUuid?: string;
  /** Este participante aceitou a oferta do outro. */
  accepted: boolean;
}

export interface TradeParticipant {
  player: TradePlayer;
  /** Nome guardado na criação (o Player fica inválido ao sair). */
  name: string;
  offer: TradeOffer;
}

export class ActiveTrade {
  readonly id: number;
  readonly participants: [TradeParticipant, TradeParticipant];
  finished = false;

  constructor(id: number, player1: TradePlayer, player2: TradePlayer) {
    this.id = id;
    this.participants = [
      { player: player1, name: safeName(player1), offer: { accepted: false } },
      { player: player2, name: safeName(player2), offer: { accepted: false } },
    ];
  }

  participant(playerId: string): TradeParticipant | undefined {
    return this.participants.find(p => p.player.id === playerId);
  }

  other(playerId: string): TradeParticipant | undefined {
    return this.participants.find(p => p.player.id !== playerId);
  }
}

/** Nome do jogador sem lançar exceção (Player inválido depois de sair). */
export function safeName(player: TradePlayer): string {
  try { return player.name; }
  catch { return "?"; }
}

export type TradeCancelReason = "cancelled" | "left" | "invalid" | "too_far" | "busy";

/** Telas e avisos (implementação real em TradeUI.ts; nos testes, um registro das chamadas). */
export interface TradeListener {
  onRequest?(request: TradeRequest): void;
  onTradeStarted?(trade: ActiveTrade): void;
  /** Oferta/aceite mudou: redesenhar para os dois. */
  onTradeUpdated?(trade: ActiveTrade): void;
  /** `byName`: nome de quem cancelou/saiu (guardado; o Player pode estar inválido). */
  onTradeCancelled?(trade: ActiveTrade, reason: TradeCancelReason, byName?: string): void;
  onTradeCompleted?(trade: ActiveTrade, result: TradeResult): void;
}

export interface TradeResult {
  /** O que cada jogador recebeu (já com evolução aplicada/pendente). */
  received: Map<string, PokemonData>;
  /** Ids das evoluções por troca que dispararam, por UUID do Pokémon. */
  evolutions: Map<string, string>;
}

export interface TradeManagerOptions {
  /** Tick atual (system.currentTick). */
  now?: () => number;
  /** Agenda uma chamada (system.runTimeout). */
  schedule?: (fn: () => void, ticks: number) => void;
  listener?: TradeListener;
  /** Distância máxima (padrão: getConfig().tradeMaxDistance). */
  maxDistance?: () => number;
}

function distance(a: TradePlayer, b: TradePlayer): number {
  const dx = a.location.x - b.location.x, dy = a.location.y - b.location.y, dz = a.location.z - b.location.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function tell(player: TradePlayer, error: boolean, key: string, args: (string | RawMessage)[] = []) {
  try {
    if (!player.isValid) return;
    const text = message.With(key, args);
    player.sendMessage(error ? message.error(text) : text);
  }
  catch { }
}

export class TradeManager {
  private requests: TradeRequest[] = [];
  private trades: ActiveTrade[] = [];
  private nextId = 1;
  listener: TradeListener;
  private now: () => number;
  private schedule: (fn: () => void, ticks: number) => void;
  private maxDistance: () => number;

  constructor(options: TradeManagerOptions = {}) {
    this.now = options.now ?? (() => 0);
    this.schedule = options.schedule ?? (() => { });
    this.listener = options.listener ?? {};
    this.maxDistance = options.maxDistance ?? (() => {
      const value = (getConfig() as unknown as Record<string, unknown>).tradeMaxDistance;
      return typeof value === "number" ? value : 12;
    });
  }

  // ------------------------------------------------------------------ consultas

  getActiveTrade(playerId: string): ActiveTrade | undefined {
    return this.trades.find(t => !t.finished && t.participants.some(p => p.player.id === playerId));
  }

  getOutboundRequest(senderId: string): TradeRequest | undefined {
    this.expireOld();
    return this.requests.find(r => r.sender.id === senderId);
  }

  getInboundRequests(receiverId: string): TradeRequest[] {
    this.expireOld();
    return this.requests.filter(r => r.receiver.id === receiverId);
  }

  /** player.canInteractWith(target, tradeMaxDistance). */
  isValidInteraction(player: TradePlayer, target: TradePlayer): boolean {
    try {
      return player.isValid && target.isValid && player.id !== target.id && player.dimension.id === target.dimension.id
        && distance(player, target) <= this.maxDistance();
    }
    catch { return false; }
  }

  /** RequestManager.isBusy: em batalha ou trocando. */
  isBusy(player: TradePlayer): boolean {
    if (this.getActiveTrade(player.id)) return true;
    try { return !!tryGetBattleFromEntity(player); }
    catch { return false; }
  }

  // ------------------------------------------------------------------ pedidos

  /**
   * Envia (ou, se o outro já pediu, aceita) um pedido de troca. @returns o pedido novo, a troca iniciada
   * (quando aceitou um pedido pendente) ou undefined se recusado (o jogador já foi avisado).
   */
  requestTrade(sender: TradePlayer, receiver: TradePlayer): TradeRequest | ActiveTrade | undefined {
    this.expireOld();
    const pending = this.requests.find(r => r.sender.id === receiver.id && r.receiver.id === sender.id);
    if (pending) return this.acceptRequest(sender, pending.id);
    const existing = this.requests.find(r => r.sender.id === sender.id);
    if (existing && existing.receiver.id !== receiver.id) this.cancelRequest(existing, false);
    if (existing && existing.receiver.id === receiver.id) {
      tell(sender, true, "cobblemon.trade.error.duplicate", [safeName(receiver)]);
      return undefined;
    }
    if (!this.isValidInteraction(sender, receiver)) {
      tell(sender, true, "cobblemon.ui.interact.failed");
      return undefined;
    }
    if (this.isBusy(receiver) || this.isBusy(sender)) {
      tell(sender, true, "cobblemon.ui.interact.unavailable");
      return undefined;
    }
    const request: TradeRequest = {
      id: this.nextId++, sender, receiver, senderName: safeName(sender), receiverName: safeName(receiver), expiresAt: this.now() + TRADE_REQUEST_TICKS,
    };
    this.requests.push(request);
    this.schedule(() => {
      if (this.requests.includes(request)) this.cancelRequest(request, true);
    }, TRADE_REQUEST_TICKS);
    tell(sender, false, "cobblemon.trade.sent", [request.receiverName]);
    tell(receiver, false, "cobblemon.trade.received", [request.senderName]);
    this.listener.onRequest?.(request);
    return request;
  }

  private removeRequest(request: TradeRequest): boolean {
    const index = this.requests.indexOf(request);
    if (index < 0) return false;
    this.requests.splice(index, 1);
    return true;
  }

  /** Pedido cancelado pelo remetente ou expirado. */
  cancelRequest(request: TradeRequest, expired: boolean) {
    if (!this.removeRequest(request)) return;
    const kind = expired ? "expired" : "canceled";
    tell(request.sender, true, `cobblemon.trade.${kind}.sender`, [request.receiverName]);
    tell(request.receiver, true, `cobblemon.trade.${kind}.receiver`, [request.senderName]);
  }

  private expireOld() {
    const now = this.now();
    for (const request of this.requests.filter(r => r.expiresAt <= now)) this.cancelRequest(request, true);
  }

  declineRequest(receiver: TradePlayer, requestId: number) {
    const request = this.requests.find(r => r.id === requestId && r.receiver.id === receiver.id);
    if (!request || !this.removeRequest(request)) return;
    tell(request.sender, true, "cobblemon.trade.decline.sender", [request.receiverName]);
    tell(receiver, false, "cobblemon.trade.decline.receiver", [request.senderName]);
  }

  /** Aceita um pedido recebido (RequestManager.acceptRequest + TradeManager.canAccept/onAccept). */
  acceptRequest(receiver: TradePlayer, requestId: number): ActiveTrade | undefined {
    this.expireOld();
    const request = this.requests.find(r => r.id === requestId && r.receiver.id === receiver.id);
    if (!request) {
      tell(receiver, true, "cobblemon.ui.interact.request_already_expired");
      return undefined;
    }
    let accepted = false;
    if (!this.isValidInteraction(receiver, request.sender)) tell(receiver, true, "cobblemon.ui.interact.failed");
    else if (this.isBusy(request.sender) || this.isBusy(receiver)) tell(receiver, true, "cobblemon.ui.interact.unavailable");
    else if (!getSafeTeam(request.sender).some(x => x != null)) {
      tell(request.sender, true, "cobblemon.trade.error.insufficient_pokemon.self");
      tell(receiver, true, "cobblemon.trade.error.insufficient_pokemon.other", [request.senderName]);
    }
    else if (!getSafeTeam(receiver).some(x => x != null)) {
      tell(request.sender, true, "cobblemon.trade.error.insufficient_pokemon.other", [request.receiverName]);
      tell(receiver, true, "cobblemon.trade.error.insufficient_pokemon.self");
    }
    else accepted = true;
    this.removeRequest(request);
    if (!accepted) return undefined;
    tell(request.sender, false, "cobblemon.trade.accept.sender", [request.receiverName]);
    tell(receiver, false, "cobblemon.trade.accept.receiver", [request.senderName]);
    // ActiveTrade(receiver, sender), como no Cobblemon.
    const trade = new ActiveTrade(this.nextId++, receiver, request.sender);
    this.trades.push(trade);
    this.listener.onTradeStarted?.(trade);
    return trade;
  }

  // ------------------------------------------------------------------ troca em andamento

  /**
   * Muda a oferta (UpdateTradeOfferHandler): `slot` do time com o UUID esperado, ou undefined para retirar.
   * Desfaz os aceites dos dois. @returns false se a oferta não vale (espaço vazio, UUID diferente, não trocável).
   */
  updateOffer(player: TradePlayer, slot: number | undefined, pokemonUuid?: string): boolean {
    const trade = this.getActiveTrade(player.id);
    const me = trade?.participant(player.id);
    if (!trade || !me) return false;
    if (slot === undefined) me.offer = { accepted: false };
    else {
      const pokemon = getSafeTeam(player)[slot];
      if (!pokemon || (pokemonUuid !== undefined && pokemon.uuid !== pokemonUuid)) return false;
      if (pokemon.tradeable === false || inPasture(pokemon)) return false;
      me.offer = { slot, pokemonUuid: pokemon.uuid, accepted: false };
    }
    for (const p of trade.participants) p.offer.accepted = false;
    this.listener.onTradeUpdated?.(trade);
    return true;
  }

  /**
   * Aceita (ou retira o aceite) da oferta do outro (ChangeTradeAcceptanceHandler). `theirPokemonUuid` tem de
   * ser a oferta atual do outro (evita aceitar uma oferta que acabou de mudar). Com os dois aceites, troca.
   */
  setAcceptance(player: TradePlayer, accepted: boolean, theirPokemonUuid?: string): boolean {
    const trade = this.getActiveTrade(player.id);
    const me = trade?.participant(player.id);
    const them = trade?.other(player.id);
    if (!trade || !me || !them) return false;
    if (!them.offer.pokemonUuid || !me.offer.pokemonUuid) return false;
    if (theirPokemonUuid !== undefined && them.offer.pokemonUuid !== theirPokemonUuid) return false;
    me.offer.accepted = accepted;
    this.listener.onTradeUpdated?.(trade);
    if (me.offer.accepted && them.offer.accepted) this.performTrade(trade);
    return true;
  }

  /** Cancela a troca (botão cancelar, tela fechada, alguém saiu). */
  cancelTrade(trade: ActiveTrade, reason: TradeCancelReason = "cancelled", by?: TradePlayer) {
    if (trade.finished) return;
    trade.finished = true;
    this.trades = this.trades.filter(t => t !== trade);
    const byName = by ? trade.participant(by.id)?.name ?? safeName(by) : undefined;
    this.listener.onTradeCancelled?.(trade, reason, byName);
  }

  cancelTradeOf(player: TradePlayer, reason: TradeCancelReason = "cancelled") {
    const trade = this.getActiveTrade(player.id);
    if (trade) this.cancelTrade(trade, reason, player);
  }

  /** Jogador saiu do mundo (onLogoff): cancela a troca e os pedidos dele. */
  onPlayerLeave(playerId: string) {
    const trade = this.getActiveTrade(playerId);
    if (trade) this.cancelTrade(trade, "left", trade.participant(playerId)?.player);
    for (const request of this.requests.filter(r => r.sender.id === playerId || r.receiver.id === playerId)) {
      this.removeRequest(request);
      // Quem saiu era o remetente: o destinatário vê "cancelou o pedido"; era o destinatário: o remetente vê "expirou".
      if (request.sender.id === playerId) tell(request.receiver, true, "cobblemon.trade.canceled.receiver", [request.senderName]);
      else tell(request.sender, true, "cobblemon.trade.expired.sender", [request.receiverName]);
    }
  }

  /**
   * TradeManager.performTrade: troca atômica. @returns o resultado, ou undefined se a troca foi cancelada
   * (Pokémon sumiu do time, alguém saiu/entrou em batalha).
   */
  performTrade(trade: ActiveTrade): TradeResult | undefined {
    if (trade.finished) return undefined;
    const [a, b] = trade.participants;
    for (const p of trade.participants) {
      if (!p.player.isValid) {
        this.cancelTrade(trade, "left", p.player);
        return undefined;
      }
    }
    if ([a, b].some(p => { try { return !!tryGetBattleFromEntity(p.player); } catch { return false; } })) {
      this.cancelTrade(trade, "busy");
      return undefined;
    }
    // Relê os times: a oferta só vale se o UUID ainda estiver no time.
    const teamA = getSafeTeam(a.player);
    const teamB = getSafeTeam(b.player);
    const slotA = locate(teamA, a.offer);
    const slotB = locate(teamB, b.offer);
    if (slotA === undefined || slotB === undefined || a.offer.pokemonUuid === b.offer.pokemonUuid) {
      console.warn(`Troca: Pokémon ofertados não estão mais no time de ${a.name}/${b.name}; possível tentativa de duplicação. Troca cancelada.`);
      this.cancelTrade(trade, "invalid");
      return undefined;
    }
    const givenByA = teamA[slotA]!;
    const givenByB = teamB[slotB]!;
    // Foi para um pasto depois da oferta (o vínculo só some na próxima checagem do pasto): não troca.
    if (inPasture(givenByA) || inPasture(givenByB)) {
      this.cancelTrade(trade, "invalid");
      return undefined;
    }

    // Pokémon em campo voltam para a bola antes de mudar de dono (em qualquer dimensão: a entidade velha
    // ainda teria o dono antigo e seria reaproveitada pelo sendOut/amizade passiva).
    for (const [pokemon, owner] of [[givenByA, a.player], [givenByB, b.player]] as const) {
      try { pokemon.return(owner); } catch { }
      for (let i = 0; i < 4; i++) {
        let entity;
        try { entity = pokemon.tryGetPokemonOut(); } catch { break; }
        if (!entity) break;
        try {
          entity.removeTag(pokemon.uuid);
          entity.triggerEvent("cobblemon:instant_kill");
        }
        catch { break; }
      }
    }

    const receivedByA = transferOwnership(givenByB, b.player, a.player);
    const receivedByB = transferOwnership(givenByA, a.player, b.player);

    // Gravação atômica: os dois times no mesmo tick; se a segunda falhar, desfaz a primeira.
    const locA = { location: PCPlace.Team, space: slotA };
    const locB = { location: PCPlace.Team, space: slotB };
    try { setPokemonToPCLocation(a.player, locA, receivedByA); }
    catch (e) {
      console.warn(`Troca: falha ao gravar o time de ${a.name}: ${e}`);
      this.cancelTrade(trade, "invalid");
      return undefined;
    }
    try { setPokemonToPCLocation(b.player, locB, receivedByB); }
    catch (e) {
      console.warn(`Troca: falha ao gravar o time de ${b.name}: ${e}; desfazendo`);
      try { setPokemonToPCLocation(a.player, locA, givenByA); } catch { }
      this.cancelTrade(trade, "invalid");
      return undefined;
    }

    // Pokédex: Pokémon recebido conta como obtido (POKEMON_GAINED).
    markCaught(a.player, receivedByA);
    markCaught(b.player, receivedByB);
    // "Progresso Cobblemon" (AdvancementHandler.onTradeCompleted): conta para quem recebeu.
    for (const [player, received] of [[a.player, receivedByA], [b.player, receivedByB]] as const) {
      try { recordTrade(player, { species: toSpeciesId(received.species), aspects: received.aspects, shiny: received.shiny }); }
      catch { }
    }

    const result: TradeResult = { received: new Map(), evolutions: new Map() };
    result.received.set(a.player.id, receivedByA);
    result.received.set(b.player.id, receivedByB);
    // Evoluções por troca (lockedEvolutions.filterIsInstance<TradeEvolution>().firstOrNull { attemptEvolution }).
    for (const [pokemon, owner, slot, other] of [[receivedByA, a.player, slotA, receivedByB], [receivedByB, b.player, slotB, receivedByA]] as const) {
      const evolved = attemptTradeEvolution(pokemon, other);
      if (!evolved) continue;
      result.evolutions.set(pokemon.uuid, evolved.evolutionId);
      result.received.set(owner.id, evolved.pokemon);
      try { setPokemonToPCLocation(owner, { location: PCPlace.Team, space: slot }, evolved.pokemon); }
      catch (e) { console.warn(`Troca: falha ao gravar a evolução de ${pokemon.species}: ${e}`); }
    }

    trade.finished = true;
    this.trades = this.trades.filter(t => t !== trade);
    this.listener.onTradeCompleted?.(trade, result);
    return result;
  }
}

/** O Pokémon está preso a um pasto (não pode ser trocado). */
function inPasture(pokemon: PokemonData): boolean {
  try { return isPastured(pokemon.uuid); }
  catch { return false; }
}

/** Espaço do time com o Pokémon ofertado (mesmo espaço, ou procurado pelo UUID se o time foi reorganizado). */
function locate(team: (PokemonData | null)[], offer: TradeOffer): number | undefined {
  if (!offer.pokemonUuid) return undefined;
  if (offer.slot !== undefined && team[offer.slot]?.uuid === offer.pokemonUuid) return offer.slot;
  const index = team.findIndex(p => p?.uuid === offer.pokemonUuid);
  return index >= 0 ? index : undefined;
}

type FriendshipCache = { tradeFriendship?: Record<string, number> };

/**
 * Cópia do Pokémon com o novo dono. Amizade: guarda a do dono antigo (cacheFriendship) e volta a ela se o
 * Pokémon retornar a ele (restoreFriendship); senão, amizade base da forma.
 */
export function transferOwnership(pokemon: PokemonData, from: TradePlayer, to: TradePlayer): PokemonData {
  const copy = PokemonData.getFromJson(JSON.stringify(pokemon)) as PokemonData & FriendshipCache;
  const cache = { ...(copy.tradeFriendship ?? {}) };
  cache[from.id] = pokemon.friendship;
  const restored = cache[to.id];
  if (restored !== undefined) {
    copy.friendship = restored;
    delete cache[to.id];
  }
  else {
    try { copy.friendship = copy.getBaseFriendship(); } catch { }
  }
  copy.tradeFriendship = cache;
  copy.ogTrainer ??= safeName(from);
  copy.trainer = to.id;
  // Evolução pendente do dono antigo não passa adiante.
  copy.readyEvolutions = [];
  return copy;
}

/**
 * Testa as evoluções por troca do Pokémon recebido, com o outro Pokémon da troca como contexto
 * (Karrablast ↔ Shelmet). Everstone bloqueia. Evolução opcional fica pronta (readyEvolutions, o jogador
 * confirma); obrigatória acontece na hora. @returns o Pokémon resultante e o id da evolução, se disparou.
 */
export function attemptTradeEvolution(pokemon: PokemonData, other: PokemonData): { pokemon: PokemonData; evolutionId: string } | undefined {
  if (pokemon.isEvolutionBlocked()) return undefined;
  let evolutions;
  try { evolutions = pokemon.getEvolutions(); }
  catch { return undefined; }
  for (const evolution of evolutions) {
    if (!(evolution instanceof TradeEvolution)) continue;
    if (!evolution.test(pokemon) || !evolution.testContext(pokemon, other)) continue;
    if (evolution.optional) {
      evolution.evolve(pokemon);
      return { pokemon, evolutionId: evolution.id };
    }
    return { pokemon: evolution.forceEvolve(pokemon), evolutionId: evolution.id };
  }
  return undefined;
}
