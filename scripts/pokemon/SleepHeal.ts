/**
 * Cura do time ao dormir na cama (Cobblemon 1.3.0+; 1.8.2: `ServerPlayer.didSleep` + `PartyStore.didSleep` +
 * `Pokemon.didSleep`, chamados quando o jogador acorda — `EntitySleepEvents.STOP_SLEEPING` — depois de dormir a noite
 * inteira: `sleepTimer == 100` e hora do dia múltipla de 24000, e só fora de batalha).
 *
 * Cada Pokémon do time: HP + metade do máximo (até o máximo; desmaiados também voltam), status some, timers de
 * desmaio/cura voltam a −1 e cada golpe recupera metade do PP máximo (MoveSet.partialHeal).
 *
 * O Bedrock não tem evento de "acordou" nem expõe o sleepTimer: o port olha a cada 10 ticks quem está dormindo e
 * detecta o pulo da noite (a hora do dia volta para a manhã e o tempo absoluto salta). Quem estava dormindo na
 * amostra anterior e não está em batalha tem o time curado.
 */
import { Player, system, world } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { getSafeTeam } from "../pokemonStorage";

type SleepSubject = Pick<PokemonData, "currentHealth" | "maxHealth" | "status" | "statusDuration" | "faintedTimer" | "healTimer" | "movesInfo" | "statusTimer">;

/** Pokemon.didSleep. Retorna true se algo mudou. */
export function didSleep(pokemon: SleepSubject): boolean {
  const before = JSON.stringify([pokemon.currentHealth, pokemon.status, pokemon.movesInfo]);
  pokemon.currentHealth = Math.min(pokemon.currentHealth + Math.floor(pokemon.maxHealth / 2), pokemon.maxHealth);
  pokemon.status = undefined;
  pokemon.statusDuration = undefined;
  pokemon.statusTimer = undefined;
  pokemon.faintedTimer = -1;
  pokemon.healTimer = -1;
  for (const move of pokemon.movesInfo ?? []) {
    if (!move) continue;
    move.pp = Math.min(move.pp + Math.floor(move.maxPp / 2), move.maxPp);
  }
  return JSON.stringify([pokemon.currentHealth, pokemon.status, pokemon.movesInfo]) !== before;
}

/**
 * A noite foi pulada entre duas amostras? `previous`/`current` = hora do dia (0..23999) e tempo absoluto.
 * Pulo = tempo absoluto andou bem mais que o intervalo e a hora caiu para a manhã (antes do meio-dia) vindo da noite.
 */
export function nightSkipped(previous: { timeOfDay: number; absolute: number }, current: { timeOfDay: number; absolute: number }, intervalTicks: number): boolean {
  const jumped = current.absolute - previous.absolute > intervalTicks + 100;
  const wasNight = previous.timeOfDay >= 12000;
  const isMorning = current.timeOfDay < 6000;
  return jumped && wasNight && isMorning;
}

const SAMPLE_TICKS = 10;
let sleepersLastSample = new Set<string>();
let lastSample: { timeOfDay: number; absolute: number } | undefined;
let inBattle: (player: Player) => boolean = () => false;
let onHealed: (player: Player, team: (PokemonData | null)[]) => void = () => { };

/** Cura o time de um jogador que dormiu (ServerPlayer.didSleep). Retorna true se curou. */
export function healPartyAfterSleep(player: Player): boolean {
  if (!player.isValid || inBattle(player)) return false;
  const team = getSafeTeam(player);
  let changed = false;
  for (const pokemon of team) if (pokemon && didSleep(pokemon)) changed = true;
  if (!changed) return false;
  player.setDynamicProperty("team", JSON.stringify(team));
  onHealed(player, team);
  return true;
}

/** Liga a detecção (worldLoad). `onHealedParty` atualiza as entidades em campo. */
export function startSleepHeal(isInBattle: (player: Player) => boolean, onHealedParty?: (player: Player, team: (PokemonData | null)[]) => void) {
  inBattle = isInBattle;
  if (onHealedParty) onHealed = onHealedParty;
  system.runInterval(() => {
    let current: { timeOfDay: number; absolute: number };
    try { current = { timeOfDay: world.getTimeOfDay() % 24000, absolute: world.getAbsoluteTime() }; }
    catch { return; }
    const sleepers = new Set<string>();
    const players = world.getAllPlayers();
    for (const player of players) {
      try { if (player.isSleeping) sleepers.add(player.id); }
      catch { /* jogador saindo */ }
    }
    if (lastSample && sleepersLastSample.size > 0 && nightSkipped(lastSample, current, SAMPLE_TICKS)) {
      for (const player of players) {
        if (!sleepersLastSample.has(player.id)) continue;
        try { healPartyAfterSleep(player); }
        catch (e) { console.warn(`Cura ao dormir falhou para ${player.name}: ${e}`); }
      }
    }
    sleepersLastSample = sleepers;
    lastSample = current;
  }, SAMPLE_TICKS);
}
