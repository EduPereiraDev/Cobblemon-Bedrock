/**
 * Rastreio das conquistas do Cobblemon por jogador (o Bedrock não tem advancements de add-on).
 *
 * Fontes, todas somente leitura (nada aqui altera o jogo, só o estado das conquistas):
 * - eventos estáveis do mundo: inventário, colocar bloco, interagir com bloco/entidade, usar item;
 * - `CobblemonEvents` ("BATTLE_VICTORY");
 * - leitura periódica do time (nível, evolução, troca, fóssil por diferença), da "Progresso Cobblemon"
 *   (`scripts/pokedex/Progress.ts`: capturas, brilhantes, Alfas, evoluções, trocas, fósseis, aspectos), do inicial
 *   escolhido, da montaria, dos TMs aprendidos (`cobblemon:tms`) e do pasto;
 * - `recordAchievementEvent(player, evento)` para as frentes que tiverem o evento exato (pesca com isca, aprijuice,
 *   uso de item em Pokémon; pedidos em docs/pendencias/ui-base.md).
 *
 * Ao concluir: toast (se `show_toast`) e mensagem no chat para todos (se `announce_to_chat`), como no Java.
 */
import { Entity, ItemStack, Player, RawMessage, system, world } from "@minecraft/server";
import { ADVANCEMENTS, AdvancementDef } from "../../../generated/scripts/advancements";
import type { PokemonData } from "../../Pokemon";
import { getSpeciesData, toSpeciesId } from "../../speciesData";
import { getSafeTeam } from "../../pokemonStorage";
import { PROGRESS_PROPERTY, parseProgress } from "../../pokedex/Progress";
import { hasSelectedStarter } from "../../starter";
import { CobblemonEvents } from "../../events/CobblemonEvents";
import { isPlayerInAnyBattle } from "../../battle/PokemonBattle";
import { getLearnedTMs, getTMMove } from "../../machines/tm";
import { TECHNICAL_MACHINES } from "../../machines/data";
import { pasturedIds } from "../../machines/pasture";
import { advancementToast, showToast } from "../Toast";
import { getStructuresAt } from "../../world/StructureRegistry"; // frente msd-fase6: critério `structure`
import { AchievementEvent, AchievementState, ProgressCounters, applyEvent, parseAchievements } from "./engine";

export const ACHIEVEMENTS_PROPERTY = "cobblemon:advancements";

export const ADVANCEMENT_DEFS: readonly AdvancementDef[] = ADVANCEMENTS;
export const ADVANCEMENTS_BY_ID: ReadonlyMap<string, AdvancementDef> = new Map(ADVANCEMENTS.map(def => [def.id, def]));

const states = new Map<string, AchievementState>();

export function getAchievements(player: Player): AchievementState {
  let state = states.get(player.id);
  if (!state) states.set(player.id, state = parseAchievements(player.getDynamicProperty(ACHIEVEMENTS_PROPERTY)));
  return state;
}

function save(player: Player, state: AchievementState) {
  try { player.setDynamicProperty(ACHIEVEMENTS_PROPERTY, JSON.stringify(state)); }
  catch (e) { console.warn(`Não foi possível gravar as conquistas: ${e}`); }
}

const listeners: ((player: Player, def: AdvancementDef) => void)[] = [];

/** Avisado a cada conquista concluída (ex.: requisito `advancement` de evolução). */
export function onAchievementCompleted(listener: (player: Player, def: AdvancementDef) => void) {
  listeners.push(listener);
}

/** O jogador já concluiu o advancement (`"catching/first_catch"` ou `"cobblemon:catching/first_catch"`)? */
export function hasAchievement(player: Player, id: string): boolean {
  return getAchievements(player).d.includes(id.replace(/^cobblemon:/, ""));
}

function announce(player: Player, def: AdvancementDef) {
  if (def.toast) showToast(player, advancementToast(def.frame, def.title, def.icon));
  if (def.announce) {
    const color = def.frame === "challenge" ? "§5" : "§a";
    const title: RawMessage = { rawtext: [{ text: `${color}[` }, { translate: def.title }, { text: `]§r` }] };
    try { world.sendMessage({ translate: `cobblemon.port.advancement.chat.${def.frame}`, with: { rawtext: [{ text: player.name }, title] } }); }
    catch { }
  }
  for (const listener of listeners) {
    try { listener(player, def); } catch (e) { console.warn(`listener de conquista: ${e}`); }
  }
}

/**
 * Entrega um evento ao motor das conquistas (API para as outras frentes). Seguro chamar em qualquer contexto
 * de escrita; em before-events, chame dentro de `system.run`.
 */
export function recordAchievementEvent(player: Player, event: AchievementEvent) {
  if (!player.isValid) return;
  const state = getAchievements(player);
  const { completed, changed } = applyEvent(state, ADVANCEMENT_DEFS, event);
  if (changed) save(player, state);
  for (const def of completed) announce(player, def);
}

/**
 * Concede um advancement direto (todos os critérios restantes), como o `award` do Java: `"catching/first_catch"` ou
 * com `cobblemon:`. Id desconhecido não faz nada (o AdvancementHelper do Java só registra no log). Frente msd-fase6.
 */
export function grantAchievement(player: Player, id: string) {
  recordAchievementEvent(player, { type: "grant", id });
}

/** Algum advancement ainda aberto usa este tipo de critério? (evita trabalho quando tudo já foi feito) */
function pending(player: Player, type: string): boolean {
  const done = getAchievements(player).d;
  return ADVANCEMENT_DEFS.some(def => !done.includes(def.id) && Object.values(def.criteria).some(c => c.t === type));
}

// ---------------------------------------------------------------------------------------------------------------
// Conjuntos derivados das definições

const criteriaOf = (type: string) => ADVANCEMENT_DEFS.flatMap(def => Object.values(def.criteria).filter(c => c.t === type));
/**
 * Conjuntos derivados das definições. Frente msd-fase6: recalculados quando a lista cresce (uma extensão acrescenta
 * conquistas no worldLoad, depois deste módulo carregar); antes, os itens das conquistas acrescentadas nunca contavam.
 */
let derivedFor = -1;
let INVENTORY_ITEMS = new Set<string>();
let INTERACT_ITEMS = new Set<string>();
function refreshDerived() {
  if (derivedFor === ADVANCEMENT_DEFS.length) return;
  derivedFor = ADVANCEMENT_DEFS.length;
  // Conquistas acrescentadas depois do load (extensões): o índice por id também as enxerga.
  for (const def of ADVANCEMENT_DEFS) if (!ADVANCEMENTS_BY_ID.has(def.id)) (ADVANCEMENTS_BY_ID as Map<string, AdvancementDef>).set(def.id, def);
  INVENTORY_ITEMS = new Set(criteriaOf("inventory").flatMap(c => (c.items as string[]) ?? []));
  INTERACT_ITEMS = new Set(criteriaOf("pokemon_interact").map(c => String(c.item)));
}
refreshDerived();

/** Algum critério `inventory` pede este item? (conjunto recalculado se a lista de conquistas cresceu) */
export function isTrackedInventoryItem(typeId: string): boolean {
  refreshDerived();
  return INVENTORY_ITEMS.has(typeId);
}
const TUMBLESTONE_ITEMS = new Set(["cobblemon:tumblestone", "cobblemon:black_tumblestone", "cobblemon:sky_tumblestone"]);

// ---------------------------------------------------------------------------------------------------------------
// Eventos do mundo

/** Itens "armados" para contar como uso em Pokémon quando saírem do inventário (tick de expiração). */
const armed = new Map<string, Map<string, number>>();
const ARM_TICKS = 600;

function arm(player: Player, item: string) {
  refreshDerived();
  if (!INTERACT_ITEMS.has(item)) return;
  let map = armed.get(player.id);
  if (!map) armed.set(player.id, map = new Map());
  map.set(item, system.currentTick + ARM_TICKS);
}

function isArmed(player: Player, item: string): boolean {
  if (isPlayerInAnyBattle(player)) return true;
  const until = armed.get(player.id)?.get(item);
  return until !== undefined && until >= system.currentTick;
}

function inventoryEvent(player: Player, stack: ItemStack | undefined) {
  if (!stack || !isTrackedInventoryItem(stack.typeId)) return;
  let tm: string | undefined;
  if (stack.typeId === "cobblemon:technical_machine") {
    try { tm = getTMMove(stack)?.move; } catch { }
  }
  recordAchievementEvent(player, { type: "inventory", item: stack.typeId, tm });
}

function isPokemon(entity: Entity): boolean {
  try { return entity.typeId.startsWith("cobblemon:") && !!entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon"); }
  catch { return false; }
}

/** Estados do bloco sem o namespace; a carga da máquina de cura (0..15 no port) vira 0..6 como no Java. */
function blockStates(typeId: string, states: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(states)) out[k.replace(/^cobblemon:/, "")] = v;
  if (typeId === "cobblemon:healing_machine" && typeof out.charge === "number") out.charge = Math.round((out.charge / 15) * 6);
  return out;
}

function subscribeWorld() {
  world.afterEvents.playerInventoryItemChange.subscribe(({ player, itemStack, beforeItemStack }) => {
    try {
      inventoryEvent(player, itemStack);
      refreshDerived();
      // Item de uso em Pokémon que saiu do inventário depois de ser usado (bala, menta, reviver...).
      if (beforeItemStack && INTERACT_ITEMS.has(beforeItemStack.typeId)
        && (!itemStack || itemStack.typeId !== beforeItemStack.typeId || itemStack.amount < beforeItemStack.amount)
        && isArmed(player, beforeItemStack.typeId)) {
        recordAchievementEvent(player, { type: "pokemon_interact", item: beforeItemStack.typeId, species: "any" });
      }
    }
    catch (e) { console.warn(`conquistas (inventário): ${e}`); }
  });

  world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
    if (source instanceof Player && itemStack) arm(source, itemStack.typeId);
  });

  world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
    try {
      recordAchievementEvent(player, { type: "placed_block", block: block.typeId, below: block.below()?.typeId, above: block.above()?.typeId });
    }
    catch (e) { console.warn(`conquistas (bloco colocado): ${e}`); }
  });

  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    if (!event.isFirstEvent) return;
    const { player, block } = event;
    const item = event.itemStack?.typeId;
    let typeId: string;
    let states: Record<string, string | number | boolean>;
    let location: { x: number; y: number; z: number };
    let adjacent: { x: number; y: number; z: number } | undefined;
    let adjacentBefore: string | undefined;
    try {
      typeId = block.typeId;
      states = block.permutation.getAllStates();
      location = block.location;
      const face = event.blockFace;
      const offsets: Record<string, [number, number, number]> = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
      const [dx, dy, dz] = offsets[String(face)] ?? [0, 1, 0];
      adjacent = { x: location.x + dx, y: location.y + dy, z: location.z + dz };
      adjacentBefore = block.dimension.getBlock(adjacent)?.typeId;
    }
    catch { return; }
    const dimension = block.dimension;
    system.run(() => {
      if (!player.isValid) return;
      recordAchievementEvent(player, { type: "block_use", block: typeId, state: blockStates(typeId, states) });
      if (item && /^cobblemon:[a-z]+_gem(_cluster)?$/.test(item) && typeId.endsWith("crystal_core"))
        recordAchievementEvent(player, { type: "plant_type_gem" });
    });
    if (!item) return;
    // O resultado do uso aparece depois (o bloco muda no mesmo tick ou no seguinte).
    system.runTimeout(() => {
      if (!player.isValid) return;
      try {
        const now = dimension.getBlock(location)?.typeId;
        if (now) recordAchievementEvent(player, { type: "item_used_on_block", item, block: now });
        const after = adjacent ? dimension.getBlock(adjacent)?.typeId : undefined;
        if (after && after !== adjacentBefore) {
          recordAchievementEvent(player, { type: "item_used_on_block", item, block: after });
          if (TUMBLESTONE_ITEMS.has(item) && after.includes("tumblestone")) recordAchievementEvent(player, { type: "plant_tumblestone" });
        }
      }
      catch { /* chunk descarregado */ }
    }, 2);
  });

  world.beforeEvents.playerInteractWithEntity.subscribe(event => {
    const { player, target } = event;
    const item = event.itemStack?.typeId;
    if (!item) return;
    let pokemon = false;
    try { pokemon = isPokemon(target); } catch { }
    system.run(() => {
      if (!player.isValid) return;
      arm(player, item);
      if (pokemon) recordAchievementEvent(player, { type: "entity_interact", item, pokemon: true });
    });
  });

  CobblemonEvents.on("BATTLE_VICTORY", (battle, winners) => {
    for (const actor of winners) {
      const player = actor.actor;
      if (!(player instanceof Player) || !player.isValid) continue;
      try {
        const state = getAchievements(player);
        state.w.t++;
        if (battle.isPvW) state.w.w++;
        if (battle.isPVP) state.w.p++;
        if (battle.isPvN) state.w.n++;
        save(player, state);
        recordAchievementEvent(player, { type: "battle_won", pvp: battle.isPVP, pvw: battle.isPvW, pvn: battle.isPvN, wins: { ...state.w } });
      }
      catch (e) { console.warn(`conquistas (vitória): ${e}`); }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura periódica (diferenças do time e da Progresso)

interface Snapshot {
  teamJson?: string;
  team: Map<string, { species: string; level: number; ready: number; moves: number }>;
  progressRaw?: string;
  progress?: ProgressCounters;
  riding: boolean;
}

const snapshots = new Map<string, Snapshot>();

function speciesId(pokemon: PokemonData): string {
  try { return toSpeciesId(pokemon.species); } catch { return String(pokemon.species).toLowerCase(); }
}

function evolutionInfo(species: string): { hasPreEvolution: boolean; hasEvolutions: boolean } {
  try {
    const data = getSpeciesData(species);
    return { hasPreEvolution: !!data?.preEvolution, hasEvolutions: (data?.evolutions?.length ?? 0) > 0 };
  }
  catch { return { hasPreEvolution: false, hasEvolutions: false }; }
}

/** Avisos do HUD da party (pop-up de evolução disponível / golpe novo), ligados pelo PartyHud. */
let popupSink: ((player: Player, uuid: string, kind: "e" | "m") => void) | undefined;
export function setPartyPopupSink(sink: (player: Player, uuid: string, kind: "e" | "m") => void) {
  popupSink = sink;
}

function pollTeamAndProgress(player: Player) {
  let snap = snapshots.get(player.id);
  const first = !snap;
  if (!snap) snapshots.set(player.id, snap = { team: new Map(), riding: false });
  const teamJson = player.getDynamicProperty("team");
  const progressRaw = player.getDynamicProperty(PROGRESS_PROPERTY);
  const teamChanged = typeof teamJson === "string" && teamJson !== snap.teamJson;
  const progressChanged = progressRaw !== snap.progressRaw;
  if (!teamChanged && !progressChanged && !first) return;

  const prevProgress = snap.progress;
  const progress = parseProgress(progressRaw);
  const counters: ProgressCounters = { c: progress.c, s: progress.s, a: progress.a, e: progress.e, t: progress.t, r: progress.r, ev: progress.ev, asp: progress.asp };

  const prevTeam = snap.team;
  const nextTeam = new Map<string, { species: string; level: number; ready: number; moves: number }>();
  const team = getSafeTeam(player);
  for (const pokemon of team) {
    if (!pokemon) continue;
    nextTeam.set(pokemon.uuid, {
      species: speciesId(pokemon), level: pokemon.level,
      ready: pokemon.readyEvolutions?.length ?? 0, moves: pokemon.moves?.length ?? 0,
    });
  }

  if (!first) {
    for (const [uuid, now] of nextTeam) {
      const before = prevTeam.get(uuid);
      if (!before) continue;
      if (now.species !== before.species)
        recordAchievementEvent(player, { type: "evolve", from: before.species, to: now.species, times: counters.e });
      if (now.level > before.level)
        recordAchievementEvent(player, { type: "level_up", level: now.level, ...evolutionInfo(now.species) });
      if (now.ready > before.ready) popupSink?.(player, uuid, "e");
      else if (now.moves > before.moves) popupSink?.(player, uuid, "m");
    }
    // Troca e fóssil: o contador da Progresso subiu junto com um Pokémon novo no time.
    const added = [...nextTeam.keys()].filter(uuid => !prevTeam.has(uuid));
    const removed = [...prevTeam.keys()].filter(uuid => !nextTeam.has(uuid));
    if (prevProgress && added.length > 0) {
      const received = nextTeam.get(added[0])!.species;
      if (counters.t > prevProgress.t) {
        const traded = removed.length > 0 ? prevTeam.get(removed[0])!.species : "any";
        recordAchievementEvent(player, { type: "trade", traded, received });
      }
      if (counters.r > prevProgress.r) recordAchievementEvent(player, { type: "resurrect", species: received });
    }
  }
  if (teamChanged || first) recordAchievementEvent(player, { type: "party", species: [...nextTeam.values()].map(p => p.species) });
  if (progressChanged || first) recordAchievementEvent(player, { type: "progress", progress: counters });

  snap.team = nextTeam;
  snap.teamJson = typeof teamJson === "string" ? teamJson : snap.teamJson;
  snap.progressRaw = typeof progressRaw === "string" ? progressRaw : undefined;
  snap.progress = counters;
}

function pollSlow(player: Player) {
  const snap = snapshots.get(player.id);
  if (pending(player, "pick_starter")) {
    try { if (hasSelectedStarter(player)) recordAchievementEvent(player, { type: "pick_starter" }); } catch { }
  }
  if (pending(player, "structure")) pollStructures(player);
  if (snap && pending(player, "started_riding")) {
    let riding = false;
    try { riding = !!player.getComponent("minecraft:riding")?.entityRidingOn; } catch { }
    if (riding && !snap.riding) recordAchievementEvent(player, { type: "started_riding" });
    snap.riding = riding;
  }
}

/** Estruturas pedidas pelos critérios `structure` ainda abertos. */
function pendingStructures(player: Player): string[] {
  const done = getAchievements(player).d;
  const out = new Set<string>();
  for (const def of ADVANCEMENT_DEFS) {
    if (done.includes(def.id)) continue;
    for (const c of Object.values(def.criteria)) if (c.t === "structure" && Array.isArray(c.structures)) for (const id of c.structures as string[]) out.add(id);
  }
  return [...out];
}

/** Critério `structure` (minecraft:location): o registro de estruturas do port, com granularidade de chunk. */
function pollStructures(player: Player) {
  try {
    const wanted = pendingStructures(player);
    if (!wanted.length) return;
    const here = getStructuresAt(player.dimension, player.location, wanted).filter(id => wanted.includes(id));
    if (here.length) recordAchievementEvent(player, { type: "structure", structures: here });
  }
  catch { /* chunk descarregado */ }
}

function pollRare(player: Player) {
  if (pending(player, "learn_tm") || pending(player, "learn_all_tm")) {
    try {
      const learned = getLearnedTMs(player);
      for (const tm of learned) recordAchievementEvent(player, { type: "learn_tm", tm });
      const all = Object.keys(TECHNICAL_MACHINES);
      if (all.length > 0 && all.every(tm => learned.has(tm))) recordAchievementEvent(player, { type: "learn_all_tm" });
    }
    catch { }
  }
  if (pending(player, "pasture_use")) {
    try {
      const pastured = pasturedIds();
      if (getSafeTeam(player).some(p => p && pastured.has(p.uuid))) recordAchievementEvent(player, { type: "pasture_use" });
    }
    catch { }
  }
}

function scanInventory(player: Player) {
  if (!pending(player, "inventory")) return;
  try {
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    for (let i = 0; i < container.size; i++) inventoryEvent(player, container.getItem(i));
  }
  catch { }
}

let runId: number | undefined;
let tick = 0;
/** Último tick de cada leitura por jogador: [time/Progresso, inicial/montaria, TMs/pasto]. */
const lastPoll = new Map<string, [number, number, number]>();
const POLL_TICKS: [number, number, number] = [10, 20, 200];

/** Liga o rastreio (uma vez, no worldLoad). */
export function startAchievements() {
  if (runId !== undefined) return;
  subscribeWorld();
  world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (initialSpawn) system.runTimeout(() => { if (player.isValid) scanInventory(player); }, 40);
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    states.delete(playerId);
    snapshots.delete(playerId);
    armed.delete(playerId);
    lastPoll.delete(playerId);
  });
  // Um jogador por tick, em rodízio, para espalhar o custo; cada leitura respeita o próprio intervalo.
  runId = system.runInterval(() => {
    tick++;
    const players = world.getPlayers();
    if (players.length === 0) return;
    const player = players[tick % players.length];
    if (!player.isValid) return;
    let last = lastPoll.get(player.id);
    if (!last) lastPoll.set(player.id, last = [-Infinity, tick, tick]);
    try {
      if (tick - last[0] >= POLL_TICKS[0]) { last[0] = tick; pollTeamAndProgress(player); }
      if (tick - last[1] >= POLL_TICKS[1]) { last[1] = tick; pollSlow(player); }
      if (tick - last[2] >= POLL_TICKS[2]) { last[2] = tick; pollRare(player); }
    }
    catch (e) { console.warn(`conquistas: ${e}`); }
  }, 1);
}
