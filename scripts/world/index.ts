/**
 * Frente motor: sistemas de mundo (registro de estruturas, vilas, contêineres, música de batalha, dano por Pokémon).
 *
 * Ligação (main.ts, dono: orquestrador) — ver docs/pendencias/motor.md:
 *   import { startWorld } from "./world";
 *   // dentro de world.afterEvents.worldLoad.subscribe(...):
 *   startWorld();
 */
import { Player, system } from "@minecraft/server";
import { setRideCameraMode } from "../entity/Riding";
import { battleMap } from "../battle";
import { startBattleMusicTicker } from "./BattleMusic";
import { bindContainerEvents } from "./Containers";
import { startPokemonDamage } from "./PokemonDamage";
import { startStructureRegistry, structureQuery } from "./StructureRegistry";
import { setSpawnStructureLookup } from "../spawning/SpawnConditions";
import { setEvolutionStructureLookup } from "../evolution/requirements/ExtraRequirements";
import { startVillageDetector } from "./Villages";
import { startLightningAndImmunities } from "./Lightning"; // frente mundo-detalhes
import { startVanillaInteractions } from "./VanillaInteractions"; // frente mundo-detalhes
import { startFortune } from "./Fortune"; // frente mundo-detalhes
import { startDiscShelfSequencer } from "../machines/discShelfSequencer"; // frente mundo-detalhes
import { registerMundoDetalhesProbe } from "./mundoDetalhesProbe"; // frente mundo-detalhes: sonda de console

export { getStructuresAt, isInStructure, expandStructureQuery, structureQuery, structureRegistry } from "./StructureRegistry";
export { startBattleMusic, stopBattleMusic, battleMusicKind } from "./BattleMusic";
export type { BattleMusicKind } from "./BattleMusic";

/** Batalha ativa do jogador (dynamic property "in_battle" → battleMap). */
function battleOf(player: Player) {
  try {
    const id = player.getDynamicProperty("in_battle");
    return typeof id === "string" ? battleMap.get(id) : undefined;
  }
  catch { return undefined; }
}

let started = false;

export function startWorld() {
  if (started) return;
  started = true;
  const safe = (name: string, fn: () => void) => {
    try { fn(); }
    catch (e) { console.warn(`[mundo] ${name}: ${e}`); }
  };
  safe("estruturas", startStructureRegistry);
  // Pedido D da frente jogabilidade: condição `structures` do spawn e requisito `structure` da evolução.
  safe("consulta de estruturas", () => {
    setSpawnStructureLookup((dimension, location, structures) => structureQuery(dimension, location, structures));
    setEvolutionStructureLookup((pokemon, structure) => {
      const where = pokemon.tryGetPokemonOut() ?? pokemon.tryGetOwner();
      return where ? structureQuery(where.dimension, where.location, [structure]) : undefined;
    });
  });
  safe("vilas", startVillageDetector);
  safe("contêineres", bindContainerEvents);
  safe("dano", startPokemonDamage);
  // Frente mundo-detalhes: raio/imunidades, vasos/composteira/apricorn/pérola, Fortuna, sequenciador da estante.
  safe("raio e imunidades", startLightningAndImmunities);
  safe("interações vanilla", startVanillaInteractions);
  safe("fortuna", startFortune);
  safe("sequenciador de note block", startDiscShelfSequencer);
  safe("sonda mundo-detalhes", registerMundoDetalhesProbe);
  safe("música", () => startBattleMusicTicker(battleOf));
  safe("câmera de montaria", () => system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
    if (id === "cobblemon:ride_camera" && sourceEntity instanceof Player) setRideCameraMode(sourceEntity, message.trim().toLowerCase());
  }));
}
