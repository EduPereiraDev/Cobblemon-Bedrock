/**
 * Tarefas de behaviour sem objetivo vanilla, rodadas pelo script a cada segundo (NPCs com a tarefa só):
 *
 *  - home (stationary → cobblemon:home_walk_task): longe de home_x/y/z além de home_radius, parado e sem batalha,
 *    volta para casa. O Cobblemon anda até lá; o Bedrock estável não tem "andar até" por script, então teleporta.
 *  - heal (uses_healing_machine → go_to_healing_machine + heal_using_healing_machine): com o time ferido e fora de
 *    batalha, liga o objetivo vanilla de ir até a máquina de cura (move_to_block) e, a até 3 × 2 blocos de uma máquina
 *    livre, usa: a máquina fica ocupada/ativa, o NPC anima e, 37 ticks depois, o time estático é curado.
 *  - look_at_speaker (chats): olha para o jogador com quem conversa.
 *  - look_at_battling (battler): em batalha, olha para um Pokémon em campo (troca a cada 3–5 s).
 *
 * Tudo protegido por try/catch e limitado por NPC (sem varredura grande por tick).
 */
import { Block, Entity, system, world } from "@minecraft/server";
import { NPC, forgetNPCTasks, npcsWithTasks } from "./NPCEntity";
import { canBeHealed } from "./PlayerStruct";
import { healPokemon } from "../pokemonStorage";
import { tryGetBattleFromEntity } from "../battle";

const HEALER = "cobblemon:healing_machine";
/** HealUsingHealingMachineTask: alcance de uso (horizontal 3, vertical 2, como caixa centrada). */
const USE_HORIZONTAL = 3;
const USE_VERTICAL = 2;
const HEAL_TICKS = 37;

/** Próximo instante (tick) em que o NPC troca o Pokémon que olha na batalha. */
const nextBattleLook = new Map<string, number>();
/** NPCs usando uma máquina (não repetem). */
const healing = new Set<string>();

export function tickNPCTasks(now = system.currentTick) {
  for (const id of npcsWithTasks()) {
    let entity: Entity | undefined;
    try { entity = world.getEntity(id); } catch { entity = undefined; }
    if (!entity || !entity.isValid) {
      forgetNPCTasks(id);
      continue;
    }
    const npc = new NPC(entity);
    const tasks = npc.behaviourTasks;
    try {
      const battling = !!tryGetBattleFromEntity(entity);
      if (tasks.has("look_at_battling") && battling) lookAtBattlingPokemon(npc, now);
      if (tasks.has("look_at_speaker") && npc.activity === "cobblemon:npc_chatting") lookAtSpeaker(npc);
      if (tasks.has("home") && !battling && npc.activity === "minecraft:idle") walkHome(npc);
      if (tasks.has("heal")) tickHealing(npc, battling);
    }
    catch (e) { console.warn(`NPC: tarefa de behaviour falhou (${id}): ${e}`); }
  }
}

function lookAtSpeaker(npc: NPC) {
  const speaker = npc.speaker;
  const player = speaker ? world.getAllPlayers().find(x => x.id === speaker) : undefined;
  if (player) npc.entity.lookAt({ x: player.location.x, y: player.location.y + 1.62, z: player.location.z });
}

function lookAtBattlingPokemon(npc: NPC, now: number) {
  if ((nextBattleLook.get(npc.entity.id) ?? 0) > now) return;
  const battle = tryGetBattleFromEntity(npc.entity);
  const targets = (battle?.activePokemon ?? []).filter(x => x?.entity?.isValid).map(x => x!.entity);
  if (!targets.length) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  npc.entity.lookAt(target.location);
  // LookAtBattlingPokemonTask: 60–100 ticks (o battler usa 90–120 no look_at_target).
  nextBattleLook.set(npc.entity.id, now + 60 + Math.floor(Math.random() * 41));
}

/** home_walk_task: fora do raio de casa (e casa ≠ 0,0,0) → volta. */
export function walkHome(npc: NPC): boolean {
  const config = npc.getConfig();
  const home = { x: Number(config.home_x ?? 0), y: Number(config.home_y ?? 0), z: Number(config.home_z ?? 0) };
  const radius = Number(config.home_radius ?? 2);
  if (home.x === 0 && home.y === 0 && home.z === 0) return false;
  const { x, y, z } = npc.entity.location;
  const distance = Math.sqrt((x - home.x) ** 2 + (y - home.y) ** 2 + (z - home.z) ** 2);
  if (distance <= radius) return false;
  npc.entity.teleport({ x: home.x + 0.5, y: home.y, z: home.z + 0.5 });
  return true;
}

function partyNeedsHealing(npc: NPC): boolean {
  return (npc.getParty() ?? []).some(canBeHealed);
}

function tickHealing(npc: NPC, battling: boolean) {
  if (healing.has(npc.entity.id)) return;
  const needs = !battling && partyNeedsHealing(npc);
  npc.setGoingToHealer(needs);
  if (!needs) return;
  const healer = findFreeHealer(npc.entity);
  if (healer) useHealer(npc, healer);
}

/** Máquina de cura livre mais próxima dentro do alcance de uso. */
export function findFreeHealer(entity: Entity): Block | undefined {
  const base = { x: Math.floor(entity.location.x), y: Math.floor(entity.location.y), z: Math.floor(entity.location.z) };
  let best: Block | undefined;
  let bestDistance = Infinity;
  const h = Math.floor(USE_HORIZONTAL / 2) + 1;
  const v = Math.floor(USE_VERTICAL / 2) + 1;
  for (let dx = -h; dx <= h; dx++) for (let dy = -v; dy <= v; dy++) for (let dz = -h; dz <= h; dz++) {
    let block: Block | undefined;
    try { block = entity.dimension.getBlock({ x: base.x + dx, y: base.y + dy, z: base.z + dz }); } catch { continue; }
    if (!block || block.typeId !== HEALER) continue;
    try { if (block.permutation.getState("cobblemon:busy" as never)) continue; } catch { }
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) { bestDistance = distance; best = block; }
  }
  return best;
}

/** HealUsingHealingMachineTask.start + HealingMachineBlockEntity.activate (sem as bolas na máquina). */
function useHealer(npc: NPC, block: Block) {
  const id = npc.entity.id;
  healing.add(id);
  npc.setGoingToHealer(false);
  const location = block.location;
  try { npc.entity.lookAt({ x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }); } catch { }
  npc.playAnimation("command");
  try { block.setPermutation(block.permutation.withState("cobblemon:busy" as never, true as never).withState("cobblemon:active" as never, true as never)); } catch { }
  try { block.dimension.playSound("cobblemon.block.healing_machine.active", { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 }, { volume: 0.7 }); } catch { }
  system.runTimeout(() => {
    healing.delete(id);
    try {
      const current = block.dimension.getBlock(location);
      if (current?.typeId === HEALER)
        current.setPermutation(current.permutation.withState("cobblemon:busy" as never, false as never).withState("cobblemon:active" as never, false as never));
    }
    catch { }
    if (!npc.entity.isValid) return;
    const party = npc.getParty();
    if (!party) return;
    party.forEach(healPokemon);
    npc.setParty(party);
  }, HEAL_TICKS);
}
