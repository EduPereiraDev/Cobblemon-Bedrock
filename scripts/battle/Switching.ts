import { Dimension, Entity, RawMessage, system, Vector3 } from "@minecraft/server";
import { ActivePokemon } from "./ActivePokemon";
import { ActorType, BattleActor } from "./BattleActor";
import type { BattleSide } from "./BattleSide";
import type { PokemonBattle } from "./PokemonBattle";
import type { PokemonData } from "../Pokemon";
import { BattleDispatch, DispatchResult, GoDispatch, WaitDispatch } from "./Dispatcher";
import {
  animatedRecall, animatedSendOut, SEND_OUT_DURATION, SEND_OUT_STAGGER_BASE_DURATION, SEND_OUT_STAGGER_RANDOM_MAX_DURATION, yawTowards
} from "./SendOut";
import { endMock, followMock, removeBattleMocks, startMock } from "./effects/Mock";
import { hitboxWidth, removePlatform, updatePlatform, waterSurfaceAt } from "./Platform";
import { playCry } from "./Animations";
import { battleMsg } from "../language/MessageHelperFunctions";
import { toDimensionLocation } from "../utils";

/**
 * Trocas e envios em batalha com a sequência do Cobblemon (SwitchInstruction/DragInstruction.createEntitySwitch,
 * ActiveBattlePokemon.getSendOutPosition):
 *  - começo da batalha: cada Pokémon é arremessado com atraso escalonado (0,35 s × posição + até 0,15 s) e a
 *    batalha espera todos chegarem (`stillSendingOutCount`);
 *  - troca no meio: mensagens de "volte" (withdraw), recolha com feixe (1,5 s), mensagem "Vai! X!" / "Fulano
 *    mandou X!" (switch.self/other, com o nome do disfarce de Illusion) e envio com a bola (1,5 s) no ponto de
 *    envio, virado para o oponente; grito ao chegar (menos quando o Imposter vai transformar logo depois);
 *  - Illusion: o Pokémon entra já com o visual do disfarce; Pokédex vê o disfarce.
 *
 * O Pokémon que entra ocupa a posição assim que a linha do protocolo é lida (as linhas seguintes — dano de
 * Stealth Rock, Intimidate, desmaio — já o acham); quem sai continua achável em `retiringPokemon` até sumir.
 */

function valid(entity: Entity | undefined): entity is Entity {
  try { return !!entity?.isValid; } catch { return false; }
}

// ------------------------------------------------------------------------------------------------ posições

function locationOf(entity: Entity): Vector3 | undefined {
  try { return { ...entity.location }; } catch { return undefined; }
}

/** Posição inicial do ator (initialPos); sem ela, a posição atual. */
function actorPos(actor: BattleActor): Vector3 | undefined {
  return actor.initialPos ?? (valid(actor.actor) ? locationOf(actor.actor) : undefined);
}

function average(points: Vector3[]): Vector3 | undefined {
  if (points.length === 0) return undefined;
  const sum = points.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

function sideCenter(side: BattleSide): Vector3 | undefined {
  return average(side.actors.map(actorPos).filter((x): x is Vector3 => !!x));
}

const add = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vector3, k: number): Vector3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const length = (a: Vector3) => Math.hypot(a.x, a.y, a.z);

/** Pokémon por lado no formato (BattleType.pokemonPerSide). */
function pokemonPerSide(battle: PokemonBattle): number {
  const type = battle.format.battleType as { actorsPerSide?: number; slotsPerActor: number };
  return (type.actorsPerSide ?? 1) * type.slotsPerActor;
}

/** Oponente do outro lado na mesma coluna (MoveTarget.getOppositeOpponent). */
function oppositeOpponent(actor: BattleActor, pnx: string): ActivePokemon | undefined {
  const sideSize = pokemonPerSide(actor.battle);
  const own = actor.getSide().getActivePokemon();
  const letterIndex = pnx.charCodeAt(2) - 97;
  const digit = (own.length ? letterIndex : 0) + 1;
  const other = actor.getSide().getOppositeSide().getActivePokemon();
  return other.find((x, i) => x && (sideSize - (i + 1) + 1) - digit === 0) ?? other.find(x => !!x) ?? undefined;
}

/** Bloco que ocupa espaço (não é ar, líquido nem passável como grama/flores). */
function solidOf(block: { isAir: boolean; isLiquid: boolean; typeId: string }): boolean {
  if (block.isAir || block.isLiquid) return false;
  return !/(grass|fern|flower|sapling|snow_layer|vine|torch|button|carpet|rail|tallgrass|bush|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily|rose|kelp|seagrass|dead_bush|sweet_berry)/.test(block.typeId);
}

/** Chão firme perto de `at` (procura de 2 acima a 4 abaixo); água vale como chão (a balsa cuida do resto). */
function snapToGround(dimension: Dimension, at: Vector3): Vector3 {
  const x = Math.floor(at.x), z = Math.floor(at.z);
  const startY = Math.floor(at.y);
  for (let y = startY + 2; y >= startY - 4; y--) {
    try {
      const block = dimension.getBlock({ x, y, z });
      const above = dimension.getBlock({ x, y: y + 1, z });
      if (!block || !above) return at;
      const solid = solidOf(block);
      const water = block.isLiquid;
      if ((solid || water) && (above.isAir || above.isLiquid === false && !solidOf(above))) return { x: at.x, y: y + 1, z: at.z };
    }
    catch {
      return at;
    }
  }
  return at;
}

/**
 * ActiveBattlePokemon.getSendOutPosition do 1.8.2: a partir das posições iniciais dos dois lados, afastados no
 * mínimo 4 + meia largura dos dois Pokémon; singles 0,4 (selvagem) ou 0,3 do caminho e um passo para o lado;
 * duplas/multi 0,33 e ±2,5 para o lado; triplas 0,15/0,3/0,15 e −3,5/0/+3,5. Um raio evita jogar dentro da parede.
 */
export function getSendOutPosition(actor: BattleActor, pnx: string, pokemon: PokemonData): Vector3 | undefined {
  const battle = actor.battle;
  const own = sideCenter(actor.getSide());
  const other = sideCenter(actor.getSide().getOppositeSide());
  if (!own) return undefined;
  if (!other) return own;
  let offset = sub(other, own);
  let result = own;
  const perSide = pokemonPerSide(battle);
  const width = hitboxWidth(pokemon);
  let widthSum = 4.0;
  if (perSide === 1) {
    const opposing = oppositeOpponent(actor, pnx);
    const opposingWidth = opposing ? hitboxWidth(opposing.data) : width;
    widthSum = (width + opposingWidth) / 2;
  }
  const minDistance = 4 + widthSum;
  const distance = length(offset);
  if (distance > 0 && distance < minDistance) {
    const temp = scale(offset, minDistance / distance);
    result = sub(own, sub(temp, offset));
    offset = temp;
  }
  // Vetor lateral: (offset.x, 0, offset.z) normalizado × (0, 1, 0).
  const flat = Math.hypot(offset.x, offset.z) || 1;
  const n = { x: offset.x / flat, y: 0, z: offset.z / flat };
  let orthogonal: Vector3 = { x: -n.z, y: 0, z: n.x };
  if (perSide === 1) {
    result = add(result, scale(offset, battle.isPvW ? 0.4 : 0.3));
    orthogonal = scale(orthogonal, -0.3 - width);
  }
  else if (perSide === 2) {
    const side = pnx[2] === "a" ? scale(orthogonal, -1) : orthogonal;
    result = add(result, scale(offset, 0.33));
    orthogonal = scale(side, 2.5);
  }
  else if (perSide === 3) {
    if (pnx[2] === "a") { orthogonal = scale(orthogonal, -3.5); result = add(result, scale(offset, 0.15)); }
    else if (pnx[2] === "b") { orthogonal = { x: 0, y: 0, z: 0 }; result = add(result, scale(offset, 0.3)); }
    else { orthogonal = scale(orthogonal, 3.5); result = add(result, scale(offset, 0.15)); }
  }
  const fallback = result;
  result = add(result, orthogonal);
  // Raio da altura dos olhos do ator até o ponto: parede no caminho puxa o ponto para antes dela.
  if (valid(actor.actor)) {
    try {
      const eye = 1.62;
      const from = { x: own.x, y: own.y + eye, z: own.z };
      const to = { x: result.x, y: own.y + eye, z: result.z };
      const dir = sub(to, from);
      const dist = length(dir);
      if (dist > 0.01) {
        const hit = actor.actor.dimension.getBlockFromRay(from, scale(dir, 1 / dist), { maxDistance: dist, includeLiquidBlocks: false, includePassableBlocks: false });
        if (hit) {
          const hitPos = add(hit.block.location, hit.faceLocation);
          const d2 = (hitPos.x - own.x) ** 2 + (hitPos.z - own.z) ** 2;
          result = d2 < width ? fallback : { x: hitPos.x, y: result.y, z: hitPos.z };
        }
      }
    }
    catch { }
  }
  return result;
}

/** Para onde o Pokémon que entra olha: o oponente em frente (ou o centro do outro lado). */
function facingFor(actor: BattleActor, pnx: string): Vector3 | undefined {
  const opposite = oppositeOpponent(actor, pnx);
  if (opposite && !opposite.pending && valid(opposite.entity)) return locationOf(opposite.entity);
  return sideCenter(actor.getSide().getOppositeSide());
}

// ------------------------------------------------------------------------------------------------ mensagens

function tell(actor: BattleActor, message: RawMessage) {
  const player = actor.Player;
  try { if (player?.isValid) player.sendMessage(message); } catch { }
}

/** SwitchInstruction.broadcastSwitch: "Vai! X!" para o dono, "Fulano mandou X!" para os outros; Pokédex vê. */
export function broadcastSwitch(battle: PokemonBattle, actor: BattleActor, pokemon: PokemonData, illusion?: PokemonData) {
  const shown = illusion ?? pokemon;
  const name = shown.getTranslatedName();
  tell(actor, battleMsg("switch.self", [name]));
  const publicLang = shown.name
    ? battleMsg("switch.other.nickname", [actor.getName(), shown.name, { translate: `cobblemon.species.${shown.species.toLowerCase().replace(/[^a-z0-9]/g, "")}.name` }])
    : battleMsg("switch.other", [actor.getName(), name]);
  battle.actors.filter(x => x !== actor).forEach(x => tell(x, publicLang));
  battle.chatLog.push(publicLang);
  battle.markSeenByPlayers(shown);
}

/** "X, volte!" para o dono e "Fulano recolheu X!" para os outros (nome do disfarce se houver Illusion). */
export function broadcastWithdraw(battle: PokemonBattle, actor: BattleActor, old: ActivePokemon) {
  const name = old.getName();
  tell(actor, battleMsg("withdraw.self", [name]));
  const lang = battleMsg("withdraw.other", [actor.getName(), name]);
  battle.actors.filter(x => x !== actor).forEach(x => tell(x, lang));
  battle.chatLog.push(lang);
}

// ------------------------------------------------------------------------------------------------ entidade em campo

/** Liga a entidade que chegou à posição: marcas de batalha, "seguidos" do outro lado, Illusion e balsa. */
function attachEntity(active: ActivePokemon, entity: Entity) {
  const actor = active.actor;
  const battle = actor.battle;
  active.entity = entity;
  active.pending = false;
  actor.getSide().getOppositeSide().getActivePokemon().forEach(x => {
    if (x && !x.pending && valid(x.entity) && valid(entity)) {
      try {
        x.entity.addTag(`targetedBy:${entity.typeId}`);
        entity.addTag(`targetedBy:${x.entity.typeId}`);
      }
      catch { }
    }
  });
  try { battle.setupEntity(entity); } catch { }
  if (active.illusion) startMock(active, "illusion", active.illusion, false);
  updatePlatform(active, isOwned(active));
}

/** O Cobblemon só dá balsa para Pokémon com dono (ownerUUID: jogador ou o NPC dono do time); selvagem não. */
function isOwned(active: ActivePokemon): boolean {
  return active.actor.type !== ActorType.WILD;
}

/** Tira de campo a entidade de quem saiu (recolhe o do jogador; o do NPC some). */
function removeFromField(actor: BattleActor, old: ActivePokemon) {
  endMock(old, false);
  removePlatform(old.data.uuid);
  const entity = old.entity;
  if (!valid(entity)) return;
  if (actor.Player) old.data.return(actor.Player);
  else if (actor.type !== ActorType.WILD && entity.id !== actor.actor.id) {
    try {
      if (entity.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon")) entity.triggerEvent("cobblemon:instant_kill");
    }
    catch { }
  }
}

function retire(actor: BattleActor, old: ActivePokemon | null) {
  if (old && !actor.retiringPokemon.includes(old)) actor.retiringPokemon.push(old);
}

function unretire(actor: BattleActor, old: ActivePokemon | null) {
  if (old) actor.retiringPokemon = actor.retiringPokemon.filter(x => x !== old);
}

function playNPCAnimation(actor: BattleActor, animation: string) {
  if (actor.type !== ActorType.NPC) return;
  try { if (actor.actor.isValid) actor.actor.playAnimation(animation); } catch { }
}

/** Ponto de envio (e chão) para a posição; sem referência, à frente do ator. */
function sendOutLocation(actor: BattleActor, pnx: string, pokemon: PokemonData, previous?: Vector3) {
  const dimension = actor.actor.dimension;
  const perSide = pokemonPerSide(actor.battle);
  // Duplas/triplas/multi: onde o anterior estava (activePokemon.position); singles: getSendOutPosition.
  let target = perSide > 1 && previous ? previous : getSendOutPosition(actor, pnx, pokemon) ?? previous;
  if (!target) {
    const view = actor.actor.getViewDirection();
    target = add(actor.actor.location, { x: view.x * 2, y: 0, z: view.z * 2 });
  }
  const surface = waterSurfaceAt(dimension, target);
  const ground = surface !== undefined ? { ...target, y: surface } : snapToGround(dimension, target);
  return toDimensionLocation(ground, dimension);
}

/**
 * Arremessa e liga a entidade à posição. `done` fica verdadeiro em SEND_OUT_DURATION (ou na hora, se o
 * Pokémon já estava no mundo). Sem quem arremesse (ator inválido) o Pokémon aparece direto.
 */
function sendIn(active: ActivePokemon, pnx: string, options: { delay?: number; cry: boolean; previous?: Vector3 }, finished: () => void) {
  const actor = active.actor;
  const battle = actor.battle;
  const pokemon = active.data;
  const existing = pokemon.tryGetPokemonOut();
  if (existing) {
    // Já estava fora (Pokémon do jogador solto antes da batalha, selvagem): sem arremesso.
    attachEntity(active, existing);
    if (options.cry) system.runTimeout(() => playCry(active.visual, active.illusion ?? pokemon), 1);
    finished();
    return;
  }
  if (!valid(actor.actor)) {
    finished();
    return;
  }
  const location = sendOutLocation(actor, pnx, pokemon, options.previous);
  const facing = facingFor(actor, pnx);
  playNPCAnimation(actor, "animation.cobblemon_npc.send_out");
  animatedSendOut({
    thrower: actor.actor,
    owner: actor.Player,
    pokemon,
    location,
    facing,
    mode: "battle",
    delay: options.delay,
    stillValid: () => !battle.ended && valid(actor.actor),
    onSpawn: entity => {
      attachEntity(active, entity);
      if (facing) {
        try { active.visual?.setRotation({ x: 0, y: yawTowards(entity.location, facing) }); } catch { }
      }
      return active.visual;
    },
    // Escala final pelos dados de quem aparece (o disfarce de Illusion/Transform, se houver).
    targetScale: () => (active.mock?.data ?? pokemon).getEffectiveScale(),
    onDone: entity => {
      // Cancelado (entity undefined): só libera a fila, sem grito.
      if (entity && options.cry && !battle.ended) playCry(active.visual, active.illusion ?? pokemon);
      finished();
    },
  });
}

/** Começo da batalha: envio escalonado; a fila da batalha espera todos (stillSendingOut). */
export function startOfBattleSwitch(battle: PokemonBattle, actor: BattleActor, pnx: string, pokemon: PokemonData, illusion?: PokemonData) {
  if (!valid(actor.actor)) return;
  const index = actor.slotFromLetter(pnx[2]);
  const active = new ActivePokemon(pokemon, actor, actor.actor);
  active.pending = true;
  active.illusion = illusion;
  actor.activePokemon[index] = active;
  const existing = pokemon.tryGetPokemonOut();
  // Selvagem (PokemonBattleActor) começa em campo sem mensagem nem Illusion.
  if (actor.type === ActorType.WILD) {
    if (existing) attachEntity(active, existing);
    else sendIn(active, pnx, { cry: false }, () => { });
    return;
  }
  broadcastSwitch(battle, actor, pokemon, illusion);
  if (existing) {
    attachEntity(active, existing);
    return;
  }
  const count = (pnx.charCodeAt(2) - 97) + actor.stillSendingOutCount;
  const delay = count * SEND_OUT_STAGGER_BASE_DURATION + (count > 0 ? Math.random() * SEND_OUT_STAGGER_RANDOM_MAX_DURATION : 0);
  actor.stillSendingOutCount++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    actor.stillSendingOutCount = Math.max(0, actor.stillSendingOutCount - 1);
  };
  sendIn(active, pnx, { delay, cry: false }, release);
  // Segurança: nunca prende a batalha se algo der errado no envio.
  system.runTimeout(release, Math.round((delay + SEND_OUT_DURATION) * 20) + 40);
  // As linhas seguintes (habilidades de entrada, clima) esperam o envio, como no Cobblemon.
  battle.dispatcher.dispatch(() => ({ canProceed: () => !battle.side1.stillSendingOut() && !battle.side2.stillSendingOut() }));
}

/**
 * Troca no meio da batalha (switch/drag): posição ocupada na leitura; na fila, "volte", recolha (1,5 s),
 * mensagem de envio e arremesso (1,5 s). `announce` = mensagem própria do drag (Roar/Whirlwind).
 */
export function midBattleSwitch(battle: PokemonBattle, actor: BattleActor, pnx: string, pokemon: PokemonData, options: { illusion?: PokemonData; imposter?: boolean; drag?: boolean; announce?: () => void } = {}) {
  const index = actor.slotFromLetter(pnx[2]);
  const old = actor.activePokemon[index] ?? null;
  if (old?.data.uuid === pokemon.uuid) return; // Showdown repete o switch se o Pokémon vai desmaiar antes de entrar
  const placeholder = old && valid(old.entity) ? old.entity : actor.actor;
  const active = new ActivePokemon(pokemon, actor, placeholder);
  active.pending = true;
  active.illusion = options.illusion;
  retire(actor, old);
  actor.activePokemon[index] = active;
  const previous = old && !old.pending && valid(old.entity) ? locationOf(old.entity) : undefined;

  battle.dispatcher.dispatchInsert(() => {
    const state = { done: false };
    const dispatches: BattleDispatch[] = [];
    // Withdraw (dispatchInsert do SwitchInstruction), antes do resto.
    dispatches.push(() => {
      // Drag (Roar/Whirlwind) não tem "volte": só "X foi arrastado para a batalha!".
      if (!options.drag && old && !old.pending && old.data.currentHealth > 0 && actor.type !== ActorType.WILD) broadcastWithdraw(battle, actor, old);
      options.announce?.();
      const begin = () => {
        if (battle.ended) { state.done = true; return; }
        broadcastSwitch(battle, actor, pokemon, options.illusion);
        sendIn(active, pnx, { cry: !options.imposter, previous }, () => { state.done = true; });
        // Segurança (como no startOfBattleSwitch): nunca prende a fila se o envio não terminar.
        system.runTimeout(() => { state.done = true; }, Math.round(SEND_OUT_DURATION * 20) + 40);
      };
      const canRecall = old && !old.pending && old.data.currentHealth > 0 && valid(old.entity) && old.entity.id !== actor.actor.id;
      if (canRecall) {
        const job = animatedRecall(old!.entity, old!.visual, actor.actor, () => removeFromField(actor, old!));
        const wait = system.runInterval(() => {
          if (!job.done) return;
          system.clearRun(wait);
          unretire(actor, old);
          begin();
        }, 1);
      }
      else {
        if (old) {
          removeFromField(actor, old);
          unretire(actor, old);
        }
        begin();
      }
      return { canProceed: () => state.done } as DispatchResult;
    });
    return dispatches;
  });
}

/** `replace` (fim da Illusion): tira o disfarce (grito 1 s depois, anel de shiny, Pokédex vê o real). */
export function endIllusion(battle: PokemonBattle, active: ActivePokemon): DispatchResult {
  active.illusion = undefined;
  const wait = endMock(active, true, x => battle.markSeenByPlayers(x.data));
  return wait > 0 ? new WaitDispatch(wait) : GoDispatch;
}

// ------------------------------------------------------------------------------------------------ manutenção

/** A cada poucos ticks: entidade de exibição no lugar e balsa na água. */
export function tickBattleVisuals(battle: PokemonBattle) {
  for (const actor of battle.actors) {
    for (const active of actor.activePokemon) {
      if (!active || active.pending) continue;
      try {
        followMock(active);
        updatePlatform(active, isOwned(active));
      }
      catch { }
    }
  }
}

/**
 * Fim da batalha: tira balsas e efeitos de exibição. Pokémon de jogador volta ao normal com o grito
 * (BattlePokemon.playerOwned → effects.wipe()); o resto volta sem grito (desvio: no Cobblemon o selvagem
 * transformado continua transformado até sair do mundo).
 */
export function cleanupBattleVisuals(battle: PokemonBattle) {
  for (const actor of battle.actors) {
    const all = [...actor.activePokemon, ...actor.retiringPokemon];
    for (const active of all) {
      if (!active) continue;
      removePlatform(active.data.uuid);
      if (active.mock) endMock(active, actor.type === ActorType.PLAYER && !active.pending);
    }
    actor.retiringPokemon = [];
  }
  // Sobras sem ActivePokemon (ex.: slot anulado pela captura): varre pelas marcas da batalha.
  try { removeBattleMocks(battle.battleId); } catch { }
}
