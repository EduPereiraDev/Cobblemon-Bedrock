/**
 * Equipes para Batalha Multi (battles/TeamManager.kt, api/interaction/RequestManager.kt e a parte "multi" de
 * battles/ChallengeManager.kt do Cobblemon 1.8.2).
 *
 * - Pedido de equipe jogador → jogador (TeamRequest, expira em 60 s). Aceitar cria a equipe (no máximo 2 jogadores)
 *   e cancela os outros pedidos recebidos por quem entrou.
 * - Desafio Multi equipe → equipe (MultiBattleChallenge, expira em 20 s). Qualquer membro da equipe desafiada aceita.
 *   Antes de começar confere tamanho das equipes, Pokémon, dimensão e proximidade (raio de 15 blocos do centro do
 *   grupo) e inicia a batalha 2×2 (BattleBuilder.pvp2v2: equipe desafiada contra a desafiante).
 * - Sair da equipe (`/abandonmultiteam` ou o menu): com um membro só, a equipe é desfeita e os pedidos e desafios
 *   dela caem (TeamManager.disbandTeam).
 *
 * A lógica não depende do jogo: tempo, agendamento, distâncias, "ocupado", "tem Pokémon" e o início da batalha
 * vêm das opções (a instância do jogo está em `Teams.ts`; os testes usam jogadores falsos).
 */
import type { Player, RawMessage } from "@minecraft/server";
import { message } from "../language";

/** TeamManager.MAX_TEAM_MEMBER_COUNT. */
export const MAX_TEAM_MEMBER_COUNT = 2;
/** TeamRequest.expiryTime = 60 s, em ticks. */
export const TEAM_REQUEST_TICKS = 60 * 20;
/** MultiBattleChallenge.expiryTime = 20 s, em ticks. */
export const MULTI_CHALLENGE_TICKS = 20 * 20;
/** ChallengeManager.MAX_BATTLE_RADIUS: distância máxima (no plano XZ) de cada jogador ao centro do grupo. */
export const MAX_BATTLE_RADIUS = 15;

/**
 * Regras de nível do desafio (BattleConfigureGUI.levelRulesetOption = -1, 50, 100, 5). Aqui 0 = "Anything Goes"
 * (o -1 do Cobblemon); os outros viram BattleFormat.adjustLevel.
 */
export const LEVEL_RULES: readonly number[] = [0, 50, 100, 5];

/**
 * Regra de nível digitada (`/pokebattle ... <nível>`): vazio, 0 ou negativo = livre (0); 5, 50 ou 100 = o nível;
 * qualquer outro valor = undefined (inválido).
 */
export function parseLevelRule(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return undefined;
  if (n <= 0) return 0;
  return LEVEL_RULES.includes(n) ? n : undefined;
}

/** Texto da regra (challenge.rule.level / challenge.rule.anything_goes). */
export function levelRuleText(level: number): RawMessage {
  return level > 0 ? message.With("cobblemon.challenge.rule.level", [String(level)]) : { translate: "cobblemon.challenge.rule.anything_goes" };
}

/** Nome do jogador sem lançar exceção (o Player fica inválido depois de sair). */
function safeName(player: Player): string {
  try { return player.name; }
  catch { return "?"; }
}

function tell(player: Player, error: boolean, key: string, args: (string | RawMessage)[] = []) {
  try {
    if (!player.isValid) return;
    const text = message.With(key, args);
    player.sendMessage(error ? message.error(text) : text);
  }
  catch { }
}

function sendRaw(player: Player, text: RawMessage) {
  try { if (player.isValid) player.sendMessage(text); }
  catch { }
}

/** TeamManager.MultiBattleTeam. */
export class MultiBattleTeam {
  readonly players: Player[];
  /** Nomes guardados ao entrar (ler `player.name` de quem saiu lança exceção). */
  readonly names = new Map<string, string>();

  constructor(readonly id: number, players: Player[]) {
    this.players = [...players];
    players.forEach(p => this.names.set(p.id, safeName(p)));
  }

  has(playerId: string): boolean {
    return this.players.some(p => p.id === playerId);
  }
}

/** TeamManager.TeamRequest (jogador → jogador). */
export interface TeamRequest {
  id: number;
  sender: Player;
  receiver: Player;
  senderName: string;
  receiverName: string;
  expiresAt: number;
}

/** ChallengeManager.MultiBattleChallenge (equipe → equipe). */
export interface MultiChallenge {
  id: number;
  /** Quem desafiou e o jogador da outra equipe que ele escolheu (os nomes das mensagens). */
  sender: Player;
  receiver: Player;
  senderName: string;
  receiverName: string;
  senderTeam: MultiBattleTeam;
  receiverTeam: MultiBattleTeam;
  /** BattleFormat.adjustLevel; 0 = livre. */
  level: number;
  expiresAt: number;
}

export interface TeamManagerOptions {
  /** Tick atual (system.currentTick). */
  now?: () => number;
  /** Agenda uma chamada (system.runTimeout). */
  schedule?: (fn: () => void, ticks: number) => void;
  /** Distância do pedido de equipe (TeamManager.isValidInteraction usa tradeMaxDistance, 12). */
  teamDistance?: () => number;
  /** Distância do desafio (ChallengeManager.isValidInteraction usa battlePvPMaxDistance, 32). */
  challengeDistance?: () => number;
  /** RequestManager.isBusy: em batalha ou trocando. */
  isBusy?: (player: Player) => boolean;
  /** O jogador tem pelo menos um Pokémon que pode lutar. */
  hasPokemon?: (player: Player) => boolean;
  /** BattleBuilder.pvp2v2 (equipe desafiada, equipe desafiante, nível ajustado); true se a batalha começou. */
  startBattle?: (team1: [Player, Player], team2: [Player, Player], level: number) => boolean;
}

const MULTI_FORMAT: RawMessage = { translate: "cobblemon.battle.types.multi" };

function horizontalDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export class TeamManager {
  private teamRequests: TeamRequest[] = [];
  private challenges: MultiChallenge[] = [];
  private teams = new Map<number, MultiBattleTeam>();
  private playerToTeam = new Map<string, MultiBattleTeam>();
  private nextId = 1;
  private now: () => number;
  private schedule: (fn: () => void, ticks: number) => void;
  private teamDistance: () => number;
  private challengeDistance: () => number;
  private busy: (player: Player) => boolean;
  private hasPokemon: (player: Player) => boolean;
  private startBattle: (team1: [Player, Player], team2: [Player, Player], level: number) => boolean;

  constructor(options: TeamManagerOptions = {}) {
    this.now = options.now ?? (() => 0);
    this.schedule = options.schedule ?? (() => { });
    this.teamDistance = options.teamDistance ?? (() => 12);
    this.challengeDistance = options.challengeDistance ?? (() => 32);
    this.busy = options.isBusy ?? (() => false);
    this.hasPokemon = options.hasPokemon ?? (() => true);
    this.startBattle = options.startBattle ?? (() => false);
  }

  // ------------------------------------------------------------------ consultas

  getTeam(playerId: string): MultiBattleTeam | undefined {
    return this.playerToTeam.get(playerId);
  }

  getTeams(): MultiBattleTeam[] {
    return [...this.teams.values()];
  }

  sameTeam(a: string, b: string): boolean {
    const team = this.getTeam(a);
    return !!team && team === this.getTeam(b);
  }

  getOutboundTeamRequest(senderId: string): TeamRequest | undefined {
    this.expireOld();
    return this.teamRequests.find(r => r.sender.id === senderId);
  }

  getInboundTeamRequests(receiverId: string): TeamRequest[] {
    this.expireOld();
    return this.teamRequests.filter(r => r.receiver.id === receiverId);
  }

  /** Pedido de equipe de `senderId` para `receiverId`, se houver. */
  getTeamRequest(senderId: string, receiverId: string): TeamRequest | undefined {
    return this.getInboundTeamRequests(receiverId).find(r => r.sender.id === senderId);
  }

  /** Desafio Multi pendente que a equipe de `fromId` mandou para a equipe de `toId`. */
  getChallenge(fromId: string, toId: string): MultiChallenge | undefined {
    this.expireOld();
    const from = this.getTeam(fromId), to = this.getTeam(toId);
    if (!from || !to) return undefined;
    return this.challenges.find(c => c.senderTeam === from && c.receiverTeam === to);
  }

  /** player.canInteractWith(target, distância). */
  private isValidInteraction(player: Player, target: Player, max: number): boolean {
    try {
      if (!player.isValid || !target.isValid || player.id === target.id || player.dimension.id !== target.dimension.id) return false;
      const a = player.location, b = target.location;
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= max;
    }
    catch { return false; }
  }

  private isBusy(player: Player): boolean {
    try { return this.busy(player); }
    catch { return false; }
  }

  private expireOld() {
    const now = this.now();
    for (const request of this.teamRequests.filter(r => r.expiresAt <= now)) this.cancelTeamRequest(request, true);
    for (const challenge of this.challenges.filter(c => c.expiresAt <= now)) this.cancelChallenge(challenge, true);
  }

  // ------------------------------------------------------------------ pedidos de equipe

  /**
   * RequestManager.sendRequest(TeamRequest). Se o outro já tinha pedido, aceita (no menu do Bedrock o botão
   * "Formar grupo" também responde ao pedido recebido). @returns o pedido novo, a equipe formada ou undefined.
   */
  requestTeam(sender: Player, receiver: Player): TeamRequest | MultiBattleTeam | undefined {
    this.expireOld();
    const pending = this.teamRequests.find(r => r.sender.id === receiver.id && r.receiver.id === sender.id);
    if (pending) return this.acceptTeamRequest(sender, pending.id);
    const receiverName = safeName(receiver);
    const existing = this.teamRequests.find(r => r.sender.id === sender.id);
    if (existing && existing.receiver.id !== receiver.id) this.cancelTeamRequest(existing, false);
    if (existing && existing.receiver.id === receiver.id) {
      tell(sender, true, "cobblemon.port.multi.team_duplicate", [receiverName]);
      return undefined;
    }
    if (!this.isValidInteraction(sender, receiver, this.teamDistance())) {
      tell(sender, true, "cobblemon.ui.interact.failed");
      return undefined;
    }
    if (this.isBusy(receiver)) {
      tell(sender, true, "cobblemon.ui.interact.unavailable");
      return undefined;
    }
    if (this.getTeam(receiver.id)) {
      tell(sender, true, "cobblemon.team.error.existing_team.other", [receiverName]);
      return undefined;
    }
    const senderTeam = this.getTeam(sender.id);
    if (senderTeam && senderTeam.players.length >= MAX_TEAM_MEMBER_COUNT) {
      tell(sender, true, "cobblemon.team.error.max_team_size.other", [receiverName]);
      return undefined;
    }
    const request: TeamRequest = {
      id: this.nextId++, sender, receiver, senderName: safeName(sender), receiverName, expiresAt: this.now() + TEAM_REQUEST_TICKS,
    };
    this.teamRequests.push(request);
    this.schedule(() => { if (this.teamRequests.includes(request)) this.cancelTeamRequest(request, true); }, TEAM_REQUEST_TICKS);
    tell(sender, false, "cobblemon.team.sent", [request.receiverName]);
    tell(receiver, false, "cobblemon.team.received", [request.senderName]);
    return request;
  }

  private removeTeamRequest(request: TeamRequest): boolean {
    const index = this.teamRequests.indexOf(request);
    if (index < 0) return false;
    this.teamRequests.splice(index, 1);
    return true;
  }

  /** Pedido cancelado pelo remetente (ou por ele entrar em outra equipe) ou expirado. */
  cancelTeamRequest(request: TeamRequest, expired: boolean) {
    if (!this.removeTeamRequest(request)) return;
    if (expired) {
      tell(request.sender, true, "cobblemon.team.expired.sender", [request.receiverName]);
      tell(request.receiver, true, "cobblemon.team.expired.receiver", [request.senderName]);
    }
    else {
      tell(request.sender, true, "cobblemon.team.canceled.self", [request.receiverName]);
      tell(request.receiver, true, "cobblemon.team.canceled.other", [request.senderName]);
    }
  }

  declineTeamRequest(receiver: Player, requestId: number) {
    const request = this.teamRequests.find(r => r.id === requestId && r.receiver.id === receiver.id);
    if (!request || !this.removeTeamRequest(request)) return;
    tell(request.sender, true, "cobblemon.team.decline.sender", [request.receiverName]);
    tell(receiver, false, "cobblemon.team.decline.receiver", [request.senderName]);
  }

  /** RequestManager.acceptRequest + TeamManager.canAccept/onAccept. @returns a equipe (nova ou a do remetente). */
  acceptTeamRequest(receiver: Player, requestId: number): MultiBattleTeam | undefined {
    this.expireOld();
    const request = this.teamRequests.find(r => r.id === requestId && r.receiver.id === receiver.id);
    if (!request) {
      tell(receiver, true, "cobblemon.ui.interact.request_already_expired");
      return undefined;
    }
    let accepted = false;
    if (!this.isValidInteraction(receiver, request.sender, this.teamDistance())) tell(receiver, true, "cobblemon.ui.interact.failed");
    else if (this.isBusy(request.sender) || this.isBusy(receiver)) tell(receiver, true, "cobblemon.ui.interact.unavailable");
    else if (this.canAcceptTeam(request)) accepted = true;
    this.removeTeamRequest(request);
    if (!accepted) return undefined;
    tell(request.sender, false, "cobblemon.team.accept.sender", [request.receiverName]);
    tell(receiver, false, "cobblemon.team.accept.receiver", [request.senderName]);
    const existing = this.getTeam(request.sender.id);
    if (existing) {
      this.joinTeam(receiver, existing);
      return existing;
    }
    return this.createTeam(receiver, request.sender);
  }

  private canAcceptTeam(request: TeamRequest): boolean {
    const senderTeam = this.getTeam(request.sender.id);
    if (!this.hasPokemon(request.sender)) {
      tell(request.sender, true, "cobblemon.challenge.error.insufficient_pokemon.self");
      tell(request.receiver, true, "cobblemon.challenge.error.insufficient_pokemon.other", [request.senderName]);
    }
    else if (!this.hasPokemon(request.receiver)) {
      tell(request.sender, true, "cobblemon.challenge.error.insufficient_pokemon.other", [request.receiverName]);
      tell(request.receiver, true, "cobblemon.challenge.error.insufficient_pokemon.self");
    }
    else if (this.getTeam(request.receiver.id)) {
      tell(request.sender, true, "cobblemon.team.error.existing_team.other", [request.receiverName]);
      tell(request.receiver, true, "cobblemon.team.error.existing_team.self");
    }
    else if (senderTeam && senderTeam.players.length >= MAX_TEAM_MEMBER_COUNT) {
      tell(request.sender, true, "cobblemon.team.error.max_team_size.other", [request.receiverName]);
      tell(request.receiver, true, "cobblemon.team.error.max_team_size.self");
    }
    else return true;
    return false;
  }

  /** Recusa os outros pedidos de equipe recebidos por quem acabou de entrar numa equipe. */
  private dropInboundTeamRequests(playerId: string) {
    for (const request of this.teamRequests.filter(r => r.receiver.id === playerId)) this.cancelTeamRequest(request, false);
  }

  /** TeamManager.createTeam. */
  private createTeam(...players: Player[]): MultiBattleTeam {
    players.forEach(p => this.dropInboundTeamRequests(p.id));
    const team = new MultiBattleTeam(this.nextId++, players);
    this.teams.set(team.id, team);
    players.forEach(p => this.playerToTeam.set(p.id, team));
    return team;
  }

  /** TeamManager.joinTeam. */
  private joinTeam(player: Player, team: MultiBattleTeam) {
    this.dropInboundTeamRequests(player.id);
    const name = safeName(player);
    team.players.forEach(member => tell(member, false, "cobblemon.team.join.other", [name]));
    team.players.push(player);
    team.names.set(player.id, name);
    this.playerToTeam.set(player.id, team);
  }

  /**
   * TeamManager.removeTeamMember (`/abandonmultiteam`, "Abandonar grupo" e saída do servidor). Com um membro só,
   * a equipe é desfeita. @returns false se o jogador não estava em equipe.
   */
  removeTeamMember(playerId: string): boolean {
    const team = this.playerToTeam.get(playerId);
    if (!team) return false;
    const index = team.players.findIndex(p => p.id === playerId);
    const [player] = index >= 0 ? team.players.splice(index, 1) : [];
    this.playerToTeam.delete(playerId);
    const name = team.names.get(playerId) ?? (player ? safeName(player) : "?");
    team.names.delete(playerId);
    if (player) tell(player, false, "cobblemon.team.left.self");
    team.players.forEach(member => tell(member, false, "cobblemon.team.left.other", [name]));
    if (team.players.length <= 1) this.disbandTeam(team);
    return true;
  }

  /** TeamManager.disbandTeam: cancela pedidos e desafios da equipe e avisa quem sobrou. */
  disbandTeam(team: MultiBattleTeam) {
    for (const member of team.players) {
      const outbound = this.teamRequests.find(r => r.sender.id === member.id);
      if (outbound) this.cancelTeamRequest(outbound, false);
    }
    for (const challenge of this.challenges.filter(c => c.receiverTeam === team)) this.declineChallenge(challenge);
    for (const challenge of this.challenges.filter(c => c.senderTeam === team)) this.cancelChallenge(challenge, false);
    for (const member of team.players) {
      this.playerToTeam.delete(member.id);
      tell(member, false, "cobblemon.team.disband");
    }
    team.players.length = 0;
    this.teams.delete(team.id);
  }

  /** RequestManager.onLogoff + TeamManager.onLogoff. */
  onPlayerLeave(playerId: string) {
    const outbound = this.teamRequests.find(r => r.sender.id === playerId);
    if (outbound) this.cancelTeamRequest(outbound, false);
    for (const request of this.teamRequests.filter(r => r.receiver.id === playerId)) {
      if (!this.removeTeamRequest(request)) continue;
      tell(request.sender, true, "cobblemon.team.decline.sender", [request.receiverName]);
    }
    this.removeTeamMember(playerId);
  }

  // ------------------------------------------------------------------ desafios Multi

  private notifyTeam(team: MultiBattleTeam, error: boolean, key: string, args: (string | RawMessage)[] = []) {
    team.players.forEach(player => tell(player, error, key, args));
  }

  /**
   * ChallengeManager.sendRequest(MultiBattleChallenge): a equipe de `sender` desafia a equipe de `receiver`.
   * Se a outra equipe já tinha desafiado a de `sender`, aceita. @returns o desafio novo, true se aceitou e a
   * batalha começou, ou undefined/false.
   */
  challengeTeam(sender: Player, receiver: Player, level = 0): MultiChallenge | boolean | undefined {
    this.expireOld();
    const senderTeam = this.getTeam(sender.id), receiverTeam = this.getTeam(receiver.id);
    if (!senderTeam || !receiverTeam || senderTeam === receiverTeam) {
      tell(sender, true, "cobblemon.challenge.multi.error.missing_team");
      return undefined;
    }
    const pending = this.challenges.find(c => c.senderTeam === receiverTeam && c.receiverTeam === senderTeam);
    if (pending) return this.acceptChallenge(sender, pending.id);
    const receiverName = safeName(receiver);
    const existing = this.challenges.find(c => c.senderTeam === senderTeam);
    if (existing && existing.receiverTeam !== receiverTeam) this.cancelChallenge(existing, false);
    if (existing && existing.receiverTeam === receiverTeam) {
      tell(sender, true, "cobblemon.challenge.error.duplicate", [receiverName]);
      return undefined;
    }
    if (!this.isValidInteraction(sender, receiver, this.challengeDistance())) {
      tell(sender, true, "cobblemon.ui.interact.failed");
      return undefined;
    }
    if (receiverTeam.players.some(p => this.isBusy(p))) {
      tell(sender, true, "cobblemon.ui.interact.unavailable");
      return undefined;
    }
    const challenge: MultiChallenge = {
      id: this.nextId++, sender, receiver, senderName: safeName(sender), receiverName, senderTeam, receiverTeam,
      level: level > 0 ? level : 0, expiresAt: this.now() + MULTI_CHALLENGE_TICKS,
    };
    this.challenges.push(challenge);
    this.schedule(() => { if (this.challenges.includes(challenge)) this.cancelChallenge(challenge, true); }, MULTI_CHALLENGE_TICKS);
    this.notifyTeam(senderTeam, false, "cobblemon.challenge.multi.sent", [receiverName, MULTI_FORMAT]);
    this.notifyTeam(receiverTeam, false, "cobblemon.challenge.multi.received", [challenge.senderName, MULTI_FORMAT]);
    // A tela do Cobblemon mostra a regra de nível do desafio; aqui ela vai no chat dos quatro.
    if (challenge.level > 0) [...senderTeam.players, ...receiverTeam.players].forEach(p => sendRaw(p, levelRuleText(challenge.level)));
    return challenge;
  }

  private removeChallenge(challenge: MultiChallenge): boolean {
    const index = this.challenges.indexOf(challenge);
    if (index < 0) return false;
    this.challenges.splice(index, 1);
    return true;
  }

  cancelChallenge(challenge: MultiChallenge, expired: boolean) {
    if (!this.removeChallenge(challenge)) return;
    const kind = expired ? "expired" : "canceled";
    this.notifyTeam(challenge.senderTeam, true, `cobblemon.challenge.multi.${kind}.sender`, [challenge.receiverName]);
    this.notifyTeam(challenge.receiverTeam, true, `cobblemon.challenge.multi.${kind}.receiver`, [challenge.senderName]);
  }

  declineChallenge(challenge: MultiChallenge) {
    if (!this.removeChallenge(challenge)) return;
    this.notifyTeam(challenge.senderTeam, true, "cobblemon.challenge.multi.decline.sender", [challenge.receiverName]);
    this.notifyTeam(challenge.receiverTeam, false, "cobblemon.challenge.multi.decline.receiver", [challenge.senderName]);
  }

  /** RequestManager.acceptRequest + ChallengeManager.canAccept/onAccept (multi). @returns true se a batalha começou. */
  acceptChallenge(player: Player, challengeId: number): boolean {
    this.expireOld();
    const challenge = this.challenges.find(c => c.id === challengeId && c.receiverTeam.has(player.id));
    if (!challenge) {
      tell(player, true, "cobblemon.ui.interact.request_already_expired");
      return false;
    }
    let accepted = false;
    const everyone = [...challenge.receiverTeam.players, ...challenge.senderTeam.players];
    if (!this.isValidInteraction(player, challenge.sender, this.challengeDistance())) tell(player, true, "cobblemon.ui.interact.failed");
    else if (everyone.some(p => this.isBusy(p))) tell(player, true, "cobblemon.ui.interact.unavailable");
    else if (this.canAcceptChallenge(challenge)) accepted = true;
    this.removeChallenge(challenge);
    if (!accepted) return false;
    this.notifyTeam(challenge.senderTeam, false, "cobblemon.challenge.multi.accept.sender", [challenge.receiverName]);
    this.notifyTeam(challenge.receiverTeam, false, "cobblemon.challenge.multi.accept.receiver", [challenge.senderName]);
    const [r1, r2] = challenge.receiverTeam.players, [s1, s2] = challenge.senderTeam.players;
    return this.startBattle([r1, r2], [s1, s2], challenge.level);
  }

  private canAcceptChallenge(challenge: MultiChallenge): boolean {
    const notify = (key: string, args: (string | RawMessage)[] = []) => {
      this.notifyTeam(challenge.senderTeam, true, key, args);
      this.notifyTeam(challenge.receiverTeam, true, key, args);
    };
    if (!this.teams.has(challenge.senderTeam.id) || !this.teams.has(challenge.receiverTeam.id)) {
      notify("cobblemon.challenge.multi.error.missing_team");
      return false;
    }
    const players = [...challenge.receiverTeam.players, ...challenge.senderTeam.players];
    const far = this.farAwayPlayer(players);
    if (challenge.receiverTeam.players.length !== MAX_TEAM_MEMBER_COUNT || challenge.senderTeam.players.length !== MAX_TEAM_MEMBER_COUNT)
      notify("cobblemon.challenge.multi.error.invalid_team_size", [String(MAX_TEAM_MEMBER_COUNT)]);
    else if (!players.every(p => this.hasPokemon(p)))
      notify("cobblemon.challenge.multi.error.insufficient_pokemon");
    else if (!this.sameDimension(players))
      notify("cobblemon.challenge.multi.error.player_different_dimension");
    else if (far)
      notify("cobblemon.challenge.multi.error.player_distance", [safeName(far)]);
    else return true;
    return false;
  }

  private sameDimension(players: Player[]): boolean {
    try {
      const dimension = players[0].dimension.id;
      return players.every(p => p.dimension.id === dimension);
    }
    catch { return false; }
  }

  /** ChallengeManager.validateProximity: o primeiro jogador a mais de 15 blocos (XZ) do centro do grupo. */
  private farAwayPlayer(players: Player[]): Player | undefined {
    try {
      const center = { x: 0, z: 0 };
      players.forEach(p => { center.x += p.location.x / players.length; center.z += p.location.z / players.length; });
      return players.find(p => horizontalDistance(p.location, center) > MAX_BATTLE_RADIUS);
    }
    catch { return players[0]; }
  }
}
