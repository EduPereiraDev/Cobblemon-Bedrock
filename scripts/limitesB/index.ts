/**
 * Frente "limites-b": aproximações aprovadas da pesquisa 8 (docs/pesquisa/8-limites-bedrock.md), o mais perto
 * possível do Cobblemon 1.8.2, só com APIs estáveis:
 * - paintings.ts: pinturas do Cobblemon (#30) no sorteio do item Pintura vanilla;
 * - nurse.ts: Enfermeira (#99/#113) — Healing Machine como estação, som work_nurse, trocas do Java;
 * - farmer.ts: fazendeiro colhe/planta mints, revival herb, vivichoke e hearty grains (#136);
 * - vanillaStructures.ts: estruturas vanilla como condição `structures` do spawn (assinatura de blocos por chunk).
 * O livro de receitas agrupado (#146) é só de dados (tools/importer/limitesB.ts).
 *
 * Ligação (main.ts, dentro de world.afterEvents.worldLoad): `startLimitesB();`.
 */
import { startFarmers } from "./farmer";
import { startNurses } from "./nurse";
import { startPaintings } from "./paintings";
import { registerLimitesBProbe } from "./probe";
import { startVanillaStructures } from "./vanillaStructures";

let started = false;

export function startLimitesB() {
  if (started) return;
  started = true;
  const safe = (name: string, fn: () => void) => {
    try { fn(); }
    catch (e) { console.warn(`[limites-b] ${name}: ${e}`); }
  };
  safe("estruturas vanilla", startVanillaStructures);
  safe("pinturas", startPaintings);
  safe("enfermeira", startNurses);
  safe("fazendeiro", startFarmers);
  safe("sonda", registerLimitesBProbe);
}
