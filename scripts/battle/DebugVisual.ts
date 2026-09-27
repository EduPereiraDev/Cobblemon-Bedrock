import { Dimension, Entity, ScriptEventSource, system, Vector3, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { Dex } from "../showdown";
import { ActorType, BattleActor } from "./BattleActor";
import { BattleFormat } from "./BattleFormat";
import { BattleSide } from "./BattleSide";
import { PokemonBattle } from "./PokemonBattle";
import { getPlatform, PLATFORM_DECK } from "./Platform";
import { MOCK_TAG } from "./effects/Mock";
import { debugProbesEnabled } from "../Config";

/**
 * Conferência da frente visual-batalha pelo console do servidor (só `scriptevent` vindo do console):
 *   scriptevent cobblemon:debug_visual illusion|transform|imposter|sketch|water [x z]
 * Monta uma batalha entre dois "treinadores" (suportes de armadura como atores NPC, então os Pokémon são
 * arremessados com bola e recolhidos com feixe) e escreve no log o que aconteceu (disfarce, entidade de exibição,
 * golpe desenhado, balsa e altura do Pokémon sobre ela).
 */

interface Scenario {
  a: Array<[string, number, string[], Partial<PokemonData>?]>;
  b: Array<[string, number, string[], Partial<PokemonData>?]>;
}

const SCENARIOS: Record<string, Scenario> = {
  illusion: { a: [["zoroark", 50, ["nightdaze"], { ability: "illusion" }], ["pikachu", 50, ["thunderbolt"]]], b: [["machamp", 70, ["closecombat"]], ["rattata", 20, ["tackle"]]] },
  transform: { a: [["mew", 50, ["tackle"]]], b: [["ditto", 50, ["transform"], { ability: "limber" }]] },
  imposter: { a: [["ditto", 50, ["transform"], { ability: "imposter" }]], b: [["pidgey", 50, ["tackle"]]] },
  sketch: { a: [["smeargle", 50, ["sketch"]]], b: [["jolteon", 50, ["tackle"]]] },
  water: { a: [["charmander", 30, ["scratch"]], ["machop", 30, ["karatechop"]]], b: [["bulbasaur", 30, ["tackle"]]] },
};

function pokemonOf([species, level, moves, extra]: [string, number, string[], Partial<PokemonData>?]): PokemonData {
  const data = Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false }), extra ?? {});
  data.moves = moves;
  data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
  return data;
}

function fill(dimension: Dimension, from: Vector3, to: Vector3, block: string) {
  try { dimension.runCommand(`fill ${from.x} ${from.y} ${from.z} ${to.x} ${to.y} ${to.z} ${block}`); } catch (e) { console.warn(`debug_visual fill: ${e}`); }
}

function trainer(dimension: Dimension, at: Vector3, name: string): Entity {
  const entity = dimension.spawnEntity("minecraft:armor_stand", at);
  try { entity.nameTag = name; } catch { }
  return entity;
}

function report(battle: PokemonBattle, label: string) {
  const lines: string[] = [];
  for (const actor of battle.actors) {
    for (const active of actor.activePokemon) {
      if (!active) continue;
      let y = "?";
      try { y = active.entity.location.y.toFixed(2); } catch { }
      const platform = getPlatform(active.data.uuid);
      lines.push(`${actor.showdownId} ${active.data.species} moves=${active.data.moves.join("/")} hp=${active.data.currentHealth} pending=${active.pending}`
        + ` illusion=${active.illusion?.species ?? "-"} mock=${active.mock ? `${active.mock.kind}:${active.mock.entity.typeId}` : "-"} y=${y}`
        + ` platform=${platform ? `${platform.getProperty("cobblemon:size")}@${platform.location.y.toFixed(2)} (convés ${(platform.location.y + PLATFORM_DECK).toFixed(2)})` : "-"}`);
    }
  }
  let mocks = 0;
  try { mocks = world.getDimension("overworld").getEntities({ tags: [MOCK_TAG] }).length; } catch { }
  console.info(`debug_visual ${label} turno=${battle.turn} fim=${battle.ended} mocks=${mocks}\n  ${lines.join("\n  ")}`);
}

function run(kind: string, where?: { x: number; z: number }, attempts = 0) {
  const scenario = SCENARIOS[kind];
  if (!scenario) {
    console.warn(`debug_visual: cenário desconhecido '${kind}' (${Object.keys(SCENARIOS).join(", ")})`);
    return;
  }
  const dimension = world.getDimension("overworld");
  const spawn = where ? { x: where.x, y: 64, z: where.z } : world.getDefaultSpawnLocation();
  if (!dimension.isChunkLoaded({ x: spawn.x, y: 64, z: spawn.z })) {
    // Sem jogador o chunk pode não carregar: use `tickingarea` e passe x z (ex.: "illusion 8 8").
    if (attempts === 0) console.warn(`debug_visual: esperando o chunk de ${Math.floor(spawn.x)} ${Math.floor(spawn.z)} carregar`);
    if (attempts < 30) system.runTimeout(() => run(kind, where, attempts + 1), 20);
    return;
  }
  const top = dimension.getTopmostBlock({ x: spawn.x, z: spawn.z });
  const base = { x: Math.floor(spawn.x) + 0.5, y: (top?.y ?? 64) + 1, z: Math.floor(spawn.z) + 0.5 };
  if (kind === "water") {
    // Piscina de 3 de fundo entre os treinadores, com chão de pedra embaixo.
    const x0 = Math.floor(base.x) - 4, z0 = Math.floor(base.z) - 4;
    fill(dimension, { x: x0 - 2, y: base.y - 4, z: z0 - 2 }, { x: x0 + 14, y: base.y + 4, z: z0 + 10 }, "air");
    fill(dimension, { x: x0 - 2, y: base.y - 4, z: z0 - 2 }, { x: x0 + 14, y: base.y - 4, z: z0 + 10 }, "stone");
    fill(dimension, { x: x0, y: base.y - 3, z: z0 }, { x: x0 + 12, y: base.y - 1, z: z0 + 8 }, "water");
    fill(dimension, { x: x0 - 2, y: base.y - 3, z: z0 - 2 }, { x: x0 - 1, y: base.y - 1, z: z0 + 10 }, "stone");
    fill(dimension, { x: x0 + 13, y: base.y - 3, z: z0 - 2 }, { x: x0 + 14, y: base.y - 1, z: z0 + 10 }, "stone");
  }
  const a = trainer(dimension, { x: base.x - (kind === "water" ? 5 : 3), y: base.y, z: base.z }, "Treinador A");
  const b = trainer(dimension, { x: base.x + (kind === "water" ? 10 : 5), y: base.y, z: base.z }, "Treinador B");
  const actorA = new BattleActor(a, scenario.a.map(pokemonOf), { type: ActorType.NPC, name: { text: "Treinador A" } });
  const actorB = new BattleActor(b, scenario.b.map(pokemonOf), { type: ActorType.NPC, name: { text: "Treinador B" } });
  const battle = new PokemonBattle(BattleFormat.GEN_9_SINGLES, new BattleSide([actorA]), new BattleSide([actorB]));
  battle.mute = false;
  console.info(`debug_visual ${kind}: batalha ${battle.battleId}`);
  let checks = 0;
  const interval = system.runInterval(() => {
    checks++;
    report(battle, `${kind} t=${checks * 2}s`);
    if (battle.ended || checks >= 40) {
      system.clearRun(interval);
      if (!battle.ended) battle.stop();
      system.runTimeout(() => {
        report(battle, `${kind} depois do fim`);
        for (const e of [a, b]) { try { e.remove(); } catch { } }
      }, 60);
    }
  }, 40);
}

let registered = false;

/** Liga o `scriptevent cobblemon:debug_visual` (idempotente; sem efeito fora do jogo). */
export function registerVisualBattleDebug() {
  if (registered) return;
  registered = true;
  try {
    system.afterEvents.scriptEventReceive.subscribe(event => {
      // Só com as sondas de depuração ligadas (config `enableDebugProbes`).
      if (event.id !== "cobblemon:debug_visual" || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
      const [kind = "illusion", x, z] = event.message.trim().split(/\s+/);
      const where = x !== undefined && z !== undefined && !Number.isNaN(Number(x)) && !Number.isNaN(Number(z)) ? { x: Number(x), z: Number(z) } : undefined;
      try { run(kind || "illusion", where); }
      catch (e) { console.warn(`debug_visual: ${e}`); }
    });
  }
  catch { }
}
