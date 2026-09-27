/**
 * `cobblemon:mental_restoration` (tempero Mental Herb, 200 ticks, nível 0): MentalRestorationEffect do Cobblemon
 * 1.8.2 baixa a estatística TIME_SINCE_REST do jogador em 31 × (nível + 1) por tick (30 de verdade, porque o jogo soma
 * 1 por tick acordado), sem passar de 0. Menos TIME_SINCE_REST = menos phantoms: o PhantomSpawner do MC 1.21.1 só
 * gera phantoms para o jogador quando `random.nextInt(max(1, T)) >= 72000`, ou seja, com chance (T − 72000) / T.
 *
 * Equivalência no Bedrock: o contador de insônia do Bedrock não é visível a scripts. Guardamos por jogador:
 * - `b`: estimativa do contador do Bedrock (ticks acordado desde o último sono/morte; os dois jogos zeram nesses casos);
 * - `c`: quanto o Mental Herb já descontou desde então (31 × (nível + 1) por tick de efeito, limitado a `b`).
 * O contador do Java seria J = b − c. Quando o Bedrock gera um phantom para o jogador (prova de que o contador dele
 * passou de 72000), o phantom fica com probabilidade p(J) / p(b) — assim a taxa final é a do Java (p(J)) — e some na
 * hora caso contrário. Com J abaixo de 72000 nenhum phantom fica enquanto durar o desconto. O Bedrock não diz para
 * quem o phantom nasceu: com vários jogadores na faixa vale a maior chance de manter entre eles.
 */
import { Entity, ItemStack, Player, RawMessage, system, world } from "@minecraft/server";
import { readFoodData } from "../items/food";
import { seasonedDataFromLore } from "../machines/cookingLogic";

export const INSOMNIA_TICKS = 72000;
export const REDUCTION_PER_TICK = 31;
export const REST_INTERVAL = 20;
const PROPERTY = "cobblemon:adapt_rest";
const EFFECT = "cobblemon:mental_restoration";

export interface RestState {
  /** Estimativa do contador de insônia do Bedrock (ticks). */
  b: number;
  /** Desconto acumulado do Mental Herb desde o último descanso. */
  c: number;
  /** Ticks restantes do efeito e nível. */
  left: number;
  amp: number;
}

export function newRestState(): RestState {
  return { b: 0, c: 0, left: 0, amp: 0 };
}

/** Chance do PhantomSpawner para o contador T: `nextInt(max(1, T)) >= 72000`. */
export function phantomChance(t: number): number {
  const n = Math.max(1, Math.floor(t));
  return n > INSOMNIA_TICKS ? (n - INSOMNIA_TICKS) / n : 0;
}

/** TIME_SINCE_REST do Java equivalente. */
export function javaCounter(s: RestState): number {
  return Math.max(0, s.b - s.c);
}

/** Avança `dt` ticks: dormindo zera; acordado soma e aplica o desconto do efeito. */
export function advanceRest(s: RestState, dt: number, sleeping: boolean): RestState {
  const eff = Math.min(dt, Math.max(0, s.left));
  const left = Math.max(0, s.left - dt);
  if (sleeping) return { b: 0, c: 0, left, amp: left > 0 ? s.amp : 0 };
  const b = s.b + dt;
  // O Java nunca desce de 0: o desconto não passa do que já foi acumulado acordado.
  const c = Math.min(b, s.c + REDUCTION_PER_TICK * (s.amp + 1) * eff);
  return { b, c, left, amp: left > 0 ? s.amp : 0 };
}

/**
 * LivingEntity.addEffect / MobEffectInstance.update: nível maior substitui; mesmo nível fica com a duração maior;
 * nível menor não muda o efeito ativo.
 */
export function addMentalRestoration(s: RestState, duration: number, amplifier: number): RestState {
  const d = Math.max(1, Math.trunc(duration));
  const a = Math.max(0, Math.trunc(amplifier));
  if (s.left <= 0 || a > s.amp) return { ...s, left: d, amp: a };
  if (a === s.amp) return { ...s, left: Math.max(s.left, d) };
  return s;
}

/**
 * Probabilidade de manter um phantom que o Bedrock gerou para o jogador: p(J) / p(B), com B ≥ 72001 (o phantom só
 * nasce com o contador do Bedrock acima do limite).
 */
export function keepPhantomProbability(s: RestState): number {
  const b = Math.max(s.b, INSOMNIA_TICKS + 1);
  if (s.c <= 0) return 1;
  const j = Math.max(0, b - s.c);
  const pb = phantomChance(b);
  return pb > 0 ? Math.min(1, phantomChance(j) / pb) : 1;
}

// ---------------------------------------------------------------------------------------------
// Mundo

const states = new Map<string, RestState>();
const decisions = new Map<string, { tick: number; keep: boolean }>();
export const restRng = { next: (): number => Math.random() };

export function getRest(player: Player): RestState {
  let s = states.get(player.id);
  if (s) return s;
  try {
    const raw = player.getDynamicProperty(PROPERTY);
    if (typeof raw === "string") {
      const p = JSON.parse(raw);
      s = { b: Number(p.b) || 0, c: Number(p.c) || 0, left: Number(p.left) || 0, amp: Number(p.amp) || 0 };
    }
  }
  catch { s = undefined; }
  s ??= newRestState();
  states.set(player.id, s);
  return s;
}

export function setRest(player: Player, s: RestState) {
  states.set(player.id, s);
  try { player.setDynamicProperty(PROPERTY, JSON.stringify(s)); }
  catch { /* jogador saindo */ }
}

/** Aplica o efeito (tempero consumido ou sonda). */
export function applyMentalRestoration(player: Player, duration: number, amplifier: number) {
  setRest(player, addMentalRestoration(getRest(player), duration, amplifier));
}

/** Efeitos `mental_restoration` do item consumido (dados do Campfire Pot, na dynamic property ou na lore). */
export function mentalEffectsOf(stack: ItemStack): { duration: number; amplifier: number }[] {
  let effects = readFoodData(stack)?.mobEffects;
  if (!effects) {
    let lore: RawMessage[] = [];
    try { lore = stack.getRawLore(); }
    catch { lore = []; }
    effects = seasonedDataFromLore(stack.typeId, lore)?.mobEffects;
  }
  return (effects ?? [])
    .filter(e => e.effect === EFFECT)
    .map(e => ({ duration: Number(e.duration) || 1, amplifier: Number((e as { amplifier?: number }).amplifier ?? 0) || 0 }));
}

function tickRest() {
  for (const player of world.getPlayers()) {
    try {
      setRest(player, advanceRest(getRest(player), REST_INTERVAL, player.isSleeping));
    }
    catch { /* jogador saindo */ }
  }
}

/**
 * Jogadores para quem o phantom pode ter nascido (20–34 blocos acima e até 10 para o lado no PhantomSpawner, com
 * margem). O Bedrock não diz o alvo: todos os que estão na faixa contam.
 */
export function phantomCandidates(phantom: Entity): Player[] {
  const out: Player[] = [];
  const p = phantom.location;
  for (const player of world.getPlayers()) {
    if (player.dimension.id !== phantom.dimension.id) continue;
    const l = player.location;
    const dy = p.y - l.y;
    const dh = Math.hypot(p.x - l.x, p.z - l.z);
    if (dy < 10 || dy > 48 || dh > 16) continue;
    out.push(player);
  }
  return out;
}

/**
 * Chance de manter um phantom com esses candidatos: a MAIOR entre eles. Se um jogador sem o desconto está na faixa, o
 * phantom pode ser dele e fica; some só quando todos os candidatos teriam, no Java, chance menor.
 */
export function keepProbabilityFor(players: readonly Player[]): number {
  let best = 0;
  for (const player of players) best = Math.max(best, keepPhantomProbability(getRest(player)));
  return best;
}

/** Phantom natural: decide (uma vez por grupo de candidatos e tick, o grupo de phantoms inteiro junto) se fica. */
export function onPhantomSpawned(phantom: Entity): boolean {
  const players = phantomCandidates(phantom);
  if (!players.length) return true;
  const now = system.currentTick;
  const key = players.map(p => p.id).sort().join(",");
  let d = decisions.get(key);
  if (!d || d.tick !== now) {
    if (decisions.size > 64) for (const [k, v] of decisions) if (v.tick !== now) decisions.delete(k);
    d = { tick: now, keep: restRng.next() < keepProbabilityFor(players) };
    decisions.set(key, d);
  }
  if (!d.keep) {
    try { phantom.remove(); }
    catch { /* já saiu */ }
  }
  return d.keep;
}

export function startMentalRestoration() {
  system.runInterval(tickRest, REST_INTERVAL);
  world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source }) => {
    if (!itemStack || !(source instanceof Player)) return;
    try { for (const e of mentalEffectsOf(itemStack)) applyMentalRestoration(source, e.duration, e.amplifier); }
    catch (e) { console.warn(`[adaptacoes] mental_restoration: ${e}`); }
  });
  world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
    if (!(deadEntity instanceof Player)) return;
    // ServerPlayer.die zera TIME_SINCE_REST (o Bedrock também zera a insônia).
    try { setRest(deadEntity, newRestState()); }
    catch { /* jogador saindo */ }
  }, { entityTypes: ["minecraft:player"] });
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (cause !== "Spawned" || !entity.isValid || entity.typeId !== "minecraft:phantom") return;
    try { onPhantomSpawned(entity); }
    catch (e) { console.warn(`[adaptacoes] phantom: ${e}`); }
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    states.delete(playerId);
    for (const k of [...decisions.keys()]) if (k.split(",").includes(playerId)) decisions.delete(k);
  });
}
