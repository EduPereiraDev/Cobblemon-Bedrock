/**
 * Verificação no servidor (sem jogador): `/scriptevent cobblemon:ianpc_battle <classe> <espécie> [nível] [x y z]`
 * cria um NPC da classe e um Pokémon selvagem lado a lado e começa uma batalha NPC (StrongBattleAI com a skill do
 * NPC) contra selvagem (RandomBattleAI). Pelo console do BDS não há entidade de origem: usa (0, topo, 0) com uma
 * tickingarea para o chunk carregar. O resultado sai no log ("ia-npc: batalha ... terminou").
 */
import { Dimension, Entity, Vector3, system, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { healPokemon } from "../pokemonStorage";
import { ActorType, BattleActor, BattleFormat, PokemonBattle, StrongBattleAI, battleMap, startBattle } from "../battle";
import { NPC, spawnNPC } from "./NPCEntity";
import { getSpeciesData } from "../speciesData";

const TICKING_AREA = "ianpc_test";

export function handleDebugBattleEvent(message: string, source: Entity | undefined) {
  const parts = message.trim().split(/\s+/).filter(Boolean);
  const [npcClass = "standard", species = "rattata"] = parts;
  const level = Number(parts[2] ?? 10);
  const coords = parts.length >= 6 ? { x: Number(parts[3]), y: Number(parts[4]), z: Number(parts[5]) } : undefined;
  const dimension = source?.dimension ?? world.getDimension("overworld");
  const origin = coords ?? (source ? source.location : { x: 0, y: 0, z: 0 });
  if (!getSpeciesData(species)) {
    console.info(`ia-npc: espécie inválida ${species}`);
    return;
  }
  if (!source && !coords) {
    try { dimension.runCommand(`tickingarea add circle ${Math.floor(origin.x)} 0 ${Math.floor(origin.z)} 2 ${TICKING_AREA} true`); } catch { }
  }
  // Primeira tentativa um segundo depois: a tickingarea precisa carregar o chunk.
  system.runTimeout(() => waitForChunk(dimension, origin, !source && !coords, 0, location => start(dimension, location, npcClass, species, level)), 20);
}

function waitForChunk(dimension: Dimension, origin: Vector3, findTop: boolean, attempt: number, then: (location: Vector3) => void) {
  let location: Vector3 | undefined;
  try {
    if (findTop) {
      const top = dimension.getTopmostBlock({ x: origin.x, z: origin.z });
      if (top) location = { x: origin.x + 0.5, y: top.location.y + 1, z: origin.z + 0.5 };
    }
    else if (dimension.getBlock(origin)) location = origin;
  }
  catch { location = undefined; }
  if (location) {
    // Chunk carregado mas ainda sem tick: a criação das entidades falha; tenta de novo.
    try { then(location); return; }
    catch (e) { if (attempt > 60) console.info(`ia-npc: batalha de teste não começou: ${e}`); }
  }
  if (attempt > 60) {
    console.info("ia-npc: chunk não carregou para a batalha de teste");
    return;
  }
  system.runTimeout(() => waitForChunk(dimension, origin, findTop, attempt + 1, then), 20);
}

function start(dimension: Dimension, location: Vector3, npcClass: string, species: string, level: number) {
  const npc = spawnNPC(dimension, location, npcClass, { level: Math.max(1, level) });
  if (!npc) {
    console.info(`ia-npc: classe de NPC inválida ${npcClass}`);
    return;
  }
  const team = npc.getPartyForChallenge([]) ?? [];
  team.forEach(healPokemon);
  const wildData = PokemonData.generateNewWildPokemon(species, { level: Math.max(1, level) });
  const wildEntity = dimension.spawnEntity(wildData.getEntityId() as never, { x: location.x + 4, y: location.y, z: location.z });
  wildData.applyToCobblemon(wildEntity);
  try { wildEntity.setProperty("cobblemon:wild", true); } catch { }
  const npcActor = new BattleActor(npc.entity, team, { type: ActorType.NPC, ai: new StrongBattleAI(npc.skill), name: npc.displayName });
  const wildActor = new BattleActor(wildEntity, [wildData], { type: ActorType.WILD });
  const battle = startBattle(BattleFormat.GEN_9_SINGLES, [npcActor], [wildActor]);
  if (!(battle instanceof PokemonBattle)) {
    console.info(`ia-npc: batalha não começou (${JSON.stringify(battle)})`);
    return;
  }
  console.info(`ia-npc: batalha ${battle.battleId} começou: ${npc.name} (${team.length} Pokémon, skill ${npc.skill}) × ${species} nv. ${level}`);
  const started = system.currentTick;
  const watch = system.runInterval(() => {
    if (battleMap.has(battle.battleId) && system.currentTick - started < 20 * 600) return;
    system.clearRun(watch);
    let npcValid = false, wildValid = false;
    try { npcValid = npc.entity.isValid; } catch { }
    try { wildValid = wildEntity.isValid; } catch { }
    const tail = battle.showdownMessages.join("\n").split("\n").filter(x => /^\|(win|tie|faint|switch)\|/.test(x)).slice(-3).join(" ");
    console.info(`ia-npc: batalha ${battle.battleId} terminou (${battle.endReason ?? "tempo esgotado"}; ${battle.showdownMessages.filter(x => x.includes("|turn|")).length} turnos; NPC ${npcValid ? "ok" : "sumiu"}, selvagem ${wildValid ? "ok" : "sumiu"} com ${wildData.currentHealth} HP; ${tail})`);
    try { dimension.runCommand(`tickingarea remove ${TICKING_AREA}`); } catch { }
  }, 20);
}

/**
 * `/scriptevent cobblemon:ianpc_behaviours <behaviour...>`: aplica os behaviours (ids sem namespace aceitos) e uma
 * escala de caixa 1,5 a todos os NPCs carregados no Overworld e relata os grupos ligados (verificação no servidor).
 */
export function handleDebugBehavioursEvent(message: string) {
  const ids = message.trim().split(/\s+/).filter(Boolean);
  for (const entity of world.getDimension("overworld").getEntities({ type: "cobblemon:npc" })) {
    const npc = new NPC(entity);
    npc.setBehaviours(ids);
    npc.setHitboxScale(1.5);
    console.info(`ia-npc: ${npc.name} behaviours=${npc.behaviourIds.join(",")} grupos=${String(entity.getDynamicProperty("npc:behaviour_groups") ?? "[]")} tarefas=${[...npc.behaviourTasks].join(",")}`);
  }
}
