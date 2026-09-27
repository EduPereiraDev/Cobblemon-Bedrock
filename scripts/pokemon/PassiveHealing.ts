/**
 * Rotina de 1 s do time fora de batalha (Cobblemon 1.8.2: PlayerPartyStore.onSecondPassed, Pokemon.currentHealth,
 * Pokemon.healTimer/faintedTimer, PersistentStatus e PoisonStatus/PoisonBadlyStatus):
 *
 * - desmaiado: `faintedTimer` começa em `defaultFaintTimer` ao desmaiar e desce 1/s; em −1 volta com
 *   `ceil(HP máx × faintAwakenHealthPercent)` e a mensagem `cobblemon.party.faintRecover` (0 desliga);
 * - ferido: `healTimer` volta a `healTimer` da config a cada mudança de HP e desce 1/s; em −1 cura
 *   `round(max(1, HP máx × healPercent))` e recomeça (0 desliga);
 * - status persistente: dura `passiveStatuses[id]` segundos (sorteado); não conta com o jogador dormindo; ao
 *   acabar, some com a mensagem de cura; veneno (1/15 por segundo, 5 %) e veneno grave (10 %) tiram HP
 *   (Poison Heal cura e, com HP cheio, o status some); desmaiar pelo veneno tira 1 de amizade.
 * Tudo só com o jogador fora de batalha. A marca de parceiro (partner_mark.molang) usa o mesmo passe.
 *
 * A lógica pura fica em `passiveSecond` (testada no Node); `startPassivePartyTick` roda um jogador por tick
 * (system.runJob) a cada segundo.
 */
import { Player, RawMessage, system, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { PokemonData, StatusEffect } from "../Pokemon";
import { getSafeTeam } from "../pokemonStorage";
import { message } from "../language";
import { PARTNER_MARK, partnerMarkCheck } from "./Marks";
import { tickMetabolism } from "./Fullness";
import { SLOWPOKE_TAILS, TAIL_FEATURE, tickTailRegrowth } from "./SpeciesFeatures";
import { Evolution, PassiveEvolution } from "../evolution/Evolution";

/** Status do Showdown → id do PersistentStatus do Cobblemon (chave de `passiveStatuses`). */
export const STATUS_IDS: Readonly<Record<string, string>> = {
  psn: "cobblemon:poison",
  tox: "cobblemon:poisonbadly",
  par: "cobblemon:paralysis",
  frz: "cobblemon:frozen",
  slp: "cobblemon:sleep",
  brn: "cobblemon:burn",
};

/** removeMessage de cada status (o veneno grave usa o do veneno). */
export const STATUS_CURE_KEYS: Readonly<Record<string, string>> = {
  psn: "cobblemon.status.poison.cure",
  tox: "cobblemon.status.poison.cure",
  par: "cobblemon.status.paralysis.cure",
  frz: "cobblemon.status.frozen.cure",
  slp: "cobblemon.status.sleep.cure",
  brn: "cobblemon.status.burn.cure",
};

/** defaultDuration dos PersistentStatus (180..300 s). */
const DEFAULT_STATUS_DURATION: [number, number] = [180, 300];

export interface PassiveSettings {
  healPercent: number;
  healTimer: number;
  defaultFaintTimer: number;
  faintAwakenHealthPercent: number;
  passiveStatuses: Record<string, [number, number]>;
}

/** O que a rotina lê e altera no Pokémon (subconjunto de PokemonData). */
export interface PassiveSubject {
  currentHealth: number;
  maxHealth: number;
  status?: string;
  ability?: string;
  friendship: number;
  faintedTimer?: number;
  healTimer?: number;
  statusTimer?: { status: string; secondsLeft: number };
}

export interface PassiveContext {
  /** Jogador dormindo: os status não contam (`!player.isSleeping`). */
  playerSleeping?: boolean;
  /** HP visto no segundo anterior; diferente do atual = o HP mudou (o setter reinicia o healTimer). */
  lastHealth?: number;
  random?: () => number;
}

export interface PassiveResult {
  /** HP, status ou amizade mudaram (grava e atualiza a entidade). */
  changed: boolean;
  /** Só os timers mudaram (grava de vez em quando). */
  timersChanged: boolean;
  /** Mensagens para o dono (chave + o Pokémon como primeiro argumento). */
  messages: string[];
}

function isFainted(p: PassiveSubject) {
  return p.currentHealth <= 0;
}

/** IntRange.random(): inteiro entre min e max inclusive. */
export function rollStatusDuration(status: string, settings: Pick<PassiveSettings, "passiveStatuses">, random: () => number = Math.random): number {
  const id = STATUS_IDS[status];
  const range = (id && settings.passiveStatuses?.[id]) || DEFAULT_STATUS_DURATION;
  const min = Math.min(range[0], range[1]);
  const max = Math.max(range[0], range[1]);
  return min + Math.floor(random() * (max - min + 1));
}

/** Setter do currentHealth: limita a 0..máx; desmaiar limpa o status, inicia o faintedTimer e tira 1 de amizade. */
function setHealth(p: PassiveSubject, value: number, settings: PassiveSettings) {
  const bounded = Math.max(0, Math.min(p.maxHealth, value));
  if (bounded === p.currentHealth) return;
  p.currentHealth = bounded;
  if (bounded <= 0) {
    p.status = StatusEffect.Faint;
    p.statusTimer = undefined;
    p.faintedTimer = settings.defaultFaintTimer;
    p.friendship = Math.max(0, p.friendship - 1);
  }
  p.healTimer = settings.healTimer;
}

/**
 * Um segundo de PlayerPartyStore.onSecondPassed para um Pokémon (fora de batalha). Muda `p` no lugar.
 */
export function passiveSecond(p: PassiveSubject, settings: PassiveSettings, ctx: PassiveContext = {}): PassiveResult {
  const random = ctx.random ?? Math.random;
  const messages: string[] = [];
  const before = JSON.stringify([p.currentHealth, p.status, p.friendship]);
  const timersBefore = JSON.stringify([p.faintedTimer, p.healTimer, p.statusTimer]);

  // O HP mudou por fora desde o último segundo (batalha, item, máquina de cura): o setter reinicia o healTimer.
  if (ctx.lastHealth !== undefined && ctx.lastHealth !== p.currentHealth) {
    p.healTimer = settings.healTimer;
    if (isFainted(p) && ctx.lastHealth > 0) p.faintedTimer = settings.defaultFaintTimer;
  }

  if (isFainted(p)) {
    // Desmaio sem timer (desmaiou em batalha ou save antigo): começa agora, como no setter.
    if (p.faintedTimer === undefined || p.faintedTimer < -1) p.faintedTimer = settings.defaultFaintTimer;
    if (settings.faintAwakenHealthPercent > 0) {
      p.faintedTimer -= 1;
      if (p.faintedTimer <= -1) {
        p.status = undefined;
        setHealth(p, Math.ceil(p.maxHealth * settings.faintAwakenHealthPercent), settings);
        p.faintedTimer = -1;
        messages.push("cobblemon.party.faintRecover");
      }
    }
  }
  else {
    p.faintedTimer = undefined;
    if (p.currentHealth < p.maxHealth && settings.healPercent > 0) {
      p.healTimer = (p.healTimer ?? -1) - 1;
      if (p.healTimer <= -1) {
        const amount = Math.round(Math.max(1, p.maxHealth * settings.healPercent));
        setHealth(p, p.currentHealth + amount, settings);
        p.healTimer = settings.healTimer;
      }
    }
  }

  // Status persistente (o desmaio não é status aqui: o setter o limpa).
  const status = p.status;
  if (status && status !== StatusEffect.Faint && STATUS_IDS[status]) {
    if (!p.statusTimer || p.statusTimer.status !== status)
      p.statusTimer = { status, secondsLeft: rollStatusDuration(status, settings, random) };
    if (!ctx.playerSleeping) {
      if (p.statusTimer.secondsLeft <= 0) {
        p.status = undefined;
        p.statusTimer = undefined;
        messages.push(STATUS_CURE_KEYS[status]);
      }
      else {
        if ((status === "psn" || status === "tox") && !isFainted(p) && Math.floor(random() * 15) === 0) {
          const damage = Math.max(1, Math.round(p.maxHealth * (status === "tox" ? 0.1 : 0.05)));
          const poisonHeal = (p.ability ?? "").replace(/[^a-z0-9]/g, "") === "poisonheal";
          setHealth(p, p.currentHealth - damage * (poisonHeal ? -1 : 1), settings);
          if (p.currentHealth === p.maxHealth && p.status === status) {
            p.status = undefined;
            p.statusTimer = undefined;
          }
        }
        if (p.statusTimer) p.statusTimer.secondsLeft -= 1;
      }
    }
  }
  else if (p.statusTimer) p.statusTimer = undefined;

  const changed = JSON.stringify([p.currentHealth, p.status, p.friendship]) !== before;
  const timersChanged = JSON.stringify([p.faintedTimer, p.healTimer, p.statusTimer]) !== timersBefore;
  return { changed, timersChanged, messages };
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** Dynamic properties do jogador para a marca de parceiro (total percorrido e última checagem, em blocos). */
export const PARTNER_DISTANCE_PROPERTY = "cobblemon:partner_distance";
export const PARTNER_LAST_CHECK_PROPERTY = "cobblemon:last_partner_mark_check";
/** Deslocamento maior que isto em 1 s é teleporte (não conta como caminhada). */
const MAX_BLOCKS_PER_SECOND = 100;

interface PlayerMemory {
  /** uuid → HP visto no último segundo. */
  lastHealth: Map<string, number>;
  /** uuid → timers ainda não gravados (inclui ciclo de metabolismo e segundos da cauda do Slowpoke). */
  timers: Map<string, PendingTimers>;
  secondsSinceSave: number;
  secondsSincePartnerCheck: number;
  lastLocation?: { x: number; y: number; z: number; dimension: string };
  distance?: number;
}

interface PendingTimers extends Pick<PassiveSubject, "faintedTimer" | "healTimer" | "statusTimer"> {
  metabolismCycle?: number;
  tailSeconds?: number;
}

const memory = new Map<string, PlayerMemory>();

/** Pokémon com a sequência de evolução em andamento não são mexidos (scripts/evolution/EvolutionEffect.ts). */
let isBusy: (uuid: string) => boolean = () => false;
export function setPassiveBusyCheck(check: (uuid: string) => boolean) {
  isBusy = check;
}

/** Jogador em batalha (injeção evita import circular com scripts/battle). */
let inBattle: (player: Player) => boolean = () => false;
export function setPassiveBattleCheck(check: (player: Player) => boolean) {
  inBattle = check;
}

function settingsFromConfig(): PassiveSettings {
  const config = getConfig();
  return {
    healPercent: config.healPercent,
    healTimer: config.healTimer,
    defaultFaintTimer: config.defaultFaintTimer,
    faintAwakenHealthPercent: config.faintAwakenHealthPercent,
    passiveStatuses: config.passiveStatuses,
  };
}

function memoryOf(player: Player): PlayerMemory {
  let entry = memory.get(player.id);
  if (!entry) memory.set(player.id, entry = { lastHealth: new Map(), timers: new Map(), secondsSinceSave: 0, secondsSincePartnerCheck: 0 });
  return entry;
}

/** Distância percorrida no último segundo (sem teleportes nem troca de dimensão). */
function trackDistance(player: Player, mem: PlayerMemory): number {
  const { x, y, z } = player.location;
  const dimension = player.dimension.id;
  const last = mem.lastLocation;
  mem.lastLocation = { x, y, z, dimension };
  if (!last || last.dimension !== dimension) return 0;
  const moved = Math.hypot(x - last.x, y - last.y, z - last.z);
  return moved > MAX_BLOCKS_PER_SECOND ? 0 : moved;
}

function numberProperty(player: Player, id: string): number {
  const value = player.getDynamicProperty(id);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Um segundo de um jogador. Exportado para depuração. */
export function tickPlayerParty(player: Player) {
  if (!player.isValid) return;
  const mem = memoryOf(player);
  const moved = trackDistance(player, mem);
  mem.distance = (mem.distance ?? numberProperty(player, PARTNER_DISTANCE_PROPERTY)) + moved;
  // Marca de parceiro: checagem a cada 10 s, como o callback player_tick_pre.
  if (++mem.secondsSincePartnerCheck >= PARTNER_MARK.ticksBetweenChecks / 20) {
    mem.secondsSincePartnerCheck = 0;
    partnerMarkTick(player, mem);
  }
  // Como no Cobblemon, cura/status/amizade só fora de batalha.
  if (inBattle(player)) return;

  const settings = settingsFromConfig();
  const team = getSafeTeam(player);
  const sleeping = (() => { try { return player.isSleeping; } catch { return false; } })();
  const saveInterval = Math.max(1, getConfig().pokemonSaveIntervalSeconds || 30);
  mem.secondsSinceSave++;
  let dirty = false;
  let timersDirty = false;
  const messages: RawMessage[] = [];

  team.forEach((stored, index) => {
    if (!stored || isBusy(stored.uuid)) return;
    const pending = mem.timers.get(stored.uuid);
    if (pending) {
      const { tailSeconds, ...timers } = pending;
      Object.assign(stored, timers);
      if (tailSeconds !== undefined && (stored.features?.[TAIL_FEATURE] ?? 0) > 0)
        stored.features = { ...stored.features, [TAIL_FEATURE]: Math.min(stored.features![TAIL_FEATURE], tailSeconds) };
    }
    const result = passiveSecond(stored, settings, { playerSleeping: sleeping, lastHealth: mem.lastHealth.get(stored.uuid) });
    // Metabolismo (Pokemon.tickMetabolism(20) com barriga > 0) e cauda do Slowpoke (TickingSpeciesFeature).
    const fullnessBefore = stored.fullness ?? 0;
    const cycleBefore = stored.metabolismCycle ?? 0;
    if (tickMetabolism(stored, 20) || (stored.fullness ?? 0) !== fullnessBefore) result.changed = true;
    else if ((stored.metabolismCycle ?? 0) !== cycleBefore) result.timersChanged = true;
    const aspectsBefore = stored.aspects.join(",");
    let sentOut = false;
    if (SLOWPOKE_TAILS.onlyRegrowWhenSentOut) try { sentOut = !!stored.tryGetPokemonOut(); } catch { }
    if (tickTailRegrowth(stored, sentOut)) {
      if (stored.aspects.join(",") !== aspectsBefore || (stored.features?.[TAIL_FEATURE] ?? 0) === 0) result.changed = true;
      else result.timersChanged = true;
    }
    mem.lastHealth.set(stored.uuid, stored.currentHealth);
    mem.timers.set(stored.uuid, {
      faintedTimer: stored.faintedTimer, healTimer: stored.healTimer, statusTimer: stored.statusTimer,
      metabolismCycle: stored.metabolismCycle, tailSeconds: stored.features?.[TAIL_FEATURE],
    });
    for (const key of result.messages) messages.push(message.With(key, [stored]));
    if (result.timersChanged) timersDirty = true;
    if (!result.changed) return;
    // O time é a fonte da verdade; da entidade em campo só vem o item segurado (trocado direto nela).
    const entity = stored.tryGetPokemonOut();
    const live = stored;
    if (entity) {
      const fromEntity = PokemonData.tryGetFromEntity(entity);
      if (fromEntity) { live.minecraftItem = fromEntity.minecraftItem; live.item = fromEntity.item; }
    }
    if (live.status !== StatusEffect.Sleep) live.statusDuration = undefined;
    team[index] = live;
    if (entity) {
      // Desmaiou pelo veneno em campo: volta para a bola (o Cobblemon zera a vida da entidade).
      try { if (live.currentHealth <= 0) live.return(player); else live.applyToCobblemon(entity); }
      catch (e) { console.warn(`Cura passiva: não foi possível atualizar ${live.species}: ${e}`); }
    }
    dirty = true;
  });

  if (dirty || (timersDirty && mem.secondsSinceSave >= saveInterval)) {
    player.setDynamicProperty("team", JSON.stringify(team));
    mem.secondsSinceSave = 0;
  }
  for (const msg of messages) player.sendMessage(msg);
  // Evoluções passivas (lockedEvolutions.filterIsInstance<PassiveEvolution>().forEach { attemptEvolution }): depois de
  // gravar, com o time relido, porque uma evolução forçada grava uma cópia nova do Pokémon.
  attemptPassiveEvolutions(player);
}

/** Evoluções por espécie+forma (os objetos são sem estado; evita reler os dados a cada segundo). */
const evolutionCache = new Map<string, Evolution[]>();

function passiveEvolutionsOf(pokemon: PokemonData): Evolution[] {
  let key = pokemon.species;
  try { key += `|${pokemon.getFormName()}`; } catch { }
  let list = evolutionCache.get(key);
  if (!list) {
    try { list = pokemon.getEvolutions().filter(evolution => evolution instanceof PassiveEvolution); }
    catch { list = []; }
    evolutionCache.set(key, list);
  }
  return list;
}

/** Tenta as evoluções passivas de cada Pokémon do time (um passe por segundo, fora de batalha). */
export function attemptPassiveEvolutions(player: Player) {
  const team = getSafeTeam(player);
  for (const pokemon of team) {
    if (!pokemon || pokemon.currentHealth <= 0 || isBusy(pokemon.uuid)) continue;
    for (const evolution of passiveEvolutionsOf(pokemon)) {
      if (pokemon.readyEvolutions.includes(evolution.id)) continue;
      try {
        if ((evolution as PassiveEvolution).attemptEvolution(pokemon)) break;
      }
      catch (e) { console.warn(`Evolução passiva ${evolution.id}: ${e}`); }
    }
  }
}

function partnerMarkTick(player: Player, mem: PlayerMemory) {
  const total = mem.distance ?? 0;
  // Em batalha o time é gravado pela batalha: a checagem fica para depois (a distância continua somando).
  if (inBattle(player)) return;
  const last = numberProperty(player, PARTNER_LAST_CHECK_PROPERTY);
  const team = getSafeTeam(player);
  const winners = partnerMarkCheck(total, last, team);
  if (winners.length > 0) {
    player.setDynamicProperty("team", JSON.stringify(team));
    winners.forEach(pokemon => { try { pokemon.tryUpdatePokemonOut(); } catch { } });
  }
  player.setDynamicProperty(PARTNER_DISTANCE_PROPERTY, total);
  player.setDynamicProperty(PARTNER_LAST_CHECK_PROPERTY, total);
}

let started = false;

/** Liga a rotina (worldLoad). Um jogador por tick com system.runJob, uma volta por segundo. */
export function startPassivePartyTick() {
  if (started) return;
  started = true;
  world.afterEvents.playerLeave.subscribe(({ playerId }) => memory.delete(playerId));
  system.runInterval(() => {
    const players = world.getPlayers();
    system.runJob((function* () {
      for (const player of players) {
        try { tickPlayerParty(player); }
        catch (e) { console.warn(`Rotina do time falhou: ${e}`); }
        yield;
      }
    })());
  }, 20);
}
