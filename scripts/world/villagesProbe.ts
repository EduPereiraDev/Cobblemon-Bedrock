/**
 * Sonda da frente vilas (depuração no BDS): `/scriptevent cobblemon:vilas_probe <x> <z> [raio]` despeja no log, aos
 * poucos (system.runJob), os blocos não naturais e a altura do chão em volta do ponto, mais as estruturas registradas
 * no chunk. Serve para conferir offline que as peças de vila (`cobblemon:village_pokecenters/*`,
 * `cobblemon:village_habitats/*`) geraram inteiras e no nível do terreno. Não faz nada sem o scriptevent.
 */
import { Dimension, system, world } from "@minecraft/server";
import { getStructuresAt } from "./StructureRegistry";

const PROBE_ID = "cobblemon:vilas_probe";
/** Blocos de terreno natural omitidos do despejo (o resto entra). */
const NATURAL = /^minecraft:(air|water|flowing_water|stone|deepslate|dirt|grass_block|sand|red_sand|gravel|short_grass|tall_grass|fern|large_fern|snow_layer|andesite|diorite|granite|tuff|clay|\w+_leaves|\w+_ore|bedrock|dandelion|poppy|seagrass|kelp|bush|short_dry_grass|tall_dry_grass|leaf_litter|wildflowers|pink_petals|dead_bush|deadbush)$/;
const LINE = 1500;

function emit(tag: string, text: string) {
  for (let i = 0; i < text.length || i === 0; i += LINE) console.log(`[vilas_probe] ${tag}#${i / LINE} ${text.slice(i, i + LINE)}`);
}

/** Altura do chão na coluna (-999 = chunk não carregado; 319 = chunk ainda sem terreno gerado). */
function topY(dimension: Dimension, x: number, z: number): number {
  try { return dimension.getTopmostBlock({ x, z })?.location.y ?? -999; }
  catch { return -999; }
}

function* probeJob(dimension: Dimension, cx: number, cz: number, r: number, attempt: number): Generator<void, void, void> {
  const heights: number[] = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) heights.push(topY(dimension, cx + dx, cz + dz));
    yield;
  }
  const valid = heights.filter(h => h > -999 && h < 319).sort((a, b) => a - b);
  if (valid.length < heights.length * 0.95) {
    // Terreno ainda chegando: tenta de novo em 5 s (até 12 vezes).
    if (attempt < 12) system.runTimeout(() => system.runJob(probeJob(dimension, cx, cz, r, attempt + 1)), 100);
    else emit("done", `terreno não carregado (${valid.length}/${heights.length})`);
    return;
  }
  const groundY = valid[Math.floor(valid.length / 2)];
  const y0 = groundY - 12, y1 = groundY + 24;
  emit("origin", `${cx - r},${y0},${cz - r} size=${2 * r + 1},${y1 - y0 + 1},${2 * r + 1} structures=${getStructuresAt(dimension, { x: cx, y: groundY, z: cz }).join("|")}`);
  const byType = new Map<string, string[]>();
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const x = cx + dx, z = cz + dz;
      for (let y = y0; y <= y1; y++) {
        let id: string | undefined;
        try { id = dimension.getBlock({ x, y, z })?.typeId; }
        catch { id = undefined; }
        if (!id || NATURAL.test(id)) continue;
        const list = byType.get(id) ?? [];
        list.push(`${dx + r},${y - y0},${dz + r}`);
        byType.set(id, list);
      }
    }
    yield;
  }
  emit("heights", heights.join(","));
  for (const [id, list] of byType) emit(`block:${id}`, list.join(";"));
  emit("done", `${byType.size} tipos`);
}

let started = false;

export function startVillagesProbe() {
  if (started) return;
  started = true;
  system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== PROBE_ID) return;
    const [x, z, r] = message.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    system.runJob(probeJob(world.getDimension("overworld"), Math.floor(x), Math.floor(z), Math.min(48, Math.max(4, Number.isFinite(r) ? r : 24)), 0));
  });
}
