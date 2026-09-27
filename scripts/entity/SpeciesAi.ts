/**
 * Frente dados-ia: tarefas de IA de espécie sem componente vanilla equivalente (o resto dos presets de behaviour vira
 * grupos de componentes no importador, tools/importer/pokemonBehaviours.ts).
 *
 * - `point_to_spawn` (Nosepass, `ai` da espécie; PointToSpawnTaskConfig): só a consulta ao dado gerado fica aqui. O
 *   giro é feito por um único mecanismo, scripts/visual/PointToSpawn.ts (`lookAt` a cada 10 ticks); o antigo
 *   `setRotation` desta frente, chamado pela passada de entidades, brigava com ele perto do spawn e foi removido
 *   (review-fixes).
 */
import { SPECIES_AI } from "../../generated/scripts/dadosIa";

export function pointsToSpawn(speciesId: string): boolean {
  return SPECIES_AI[speciesId.replace(/^cobblemon:/, "").toLowerCase()]?.pointToSpawn === true;
}
