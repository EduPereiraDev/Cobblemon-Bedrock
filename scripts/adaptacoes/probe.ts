/**
 * Sonda de console da frente "adaptacoes" (conferência no BDS sem cliente). Só responde a `/scriptevent` vindo do
 * console do servidor (sem entidade de origem) e com `scriptevent cobblemon:debug_probes on`. Saída em console.warn.
 *   scriptevent cobblemon:adapt_state <x> <y> <z>          tipo, estados, redstone e inventário do bloco
 *   scriptevent cobblemon:adapt_watch <x> <y> <z> <ticks>  estados/inventário do bloco a cada tick (mudanças)
 *   scriptevent cobblemon:adapt_items <x> <y> <z> <raio>   itens soltos perto (tipo × quantidade @ posição)
 *   scriptevent cobblemon:adapt_trace on|off               registra entitySpawn de itens/abelhas/phantoms
 *   scriptevent cobblemon:adapt_pot <x> <y> <z>            estado da panela (grade, temperos, resultado, sinal)
 *   scriptevent cobblemon:adapt_bees                        abelhas carregadas (néctar, posição, contador)
 *   scriptevent cobblemon:adapt_bee_tick <n>                força n rodadas da amostragem das abelhas (chance 1)
 *   scriptevent cobblemon:adapt_rest <jogador|@all>         contadores de descanso (Bedrock estimado e Java)
 *   scriptevent cobblemon:adapt_mental <jogador> <ticks> <nível>  aplica mental_restoration como o tempero
 *   scriptevent cobblemon:adapt_vase <x> <y> <z> [faces] [item n]  vaso decorado: coloca/mostra
 *   scriptevent cobblemon:adapt_vase_break <x> <y> <z> <ferramenta|none> [seda]  quebra o vaso como um jogador
 */
import { Block, BlockInventoryComponent, Dimension, ScriptEventSource, system, Vector3, world } from "@minecraft/server";
import { debugProbesEnabled } from "../Config";

type Handler = (args: string[]) => void;
const extra = new Map<string, Handler>();

/** Os outros módulos da frente acrescentam comandos à sonda. */
export function addProbeCommand(name: string, handler: Handler) {
  extra.set(name, handler);
}

export function log(msg: string) {
  console.warn(`[adaptacoes] ${msg}`);
}

export function parseLoc(parts: string[]): Vector3 | undefined {
  const [x, y, z] = parts.slice(0, 3).map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
}

export function overworld(): Dimension {
  return world.getDimension("overworld");
}

function containerOf(block: Block): string {
  let inv: BlockInventoryComponent | undefined;
  try { inv = block.getComponent("minecraft:inventory"); }
  catch { return "-"; }
  const c = inv?.container;
  if (!c) return "-";
  const out: string[] = [];
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (!it) continue;
    let dmg = "";
    try { const d = it.getComponent("minecraft:durability"); if (d) dmg = `(dano ${d.damage}/${d.maxDurability})`; }
    catch { dmg = ""; }
    out.push(`${i}:${it.typeId}×${it.amount}${dmg}`);
  }
  return `[${out.join(" ")}]`;
}

export function describeBlock(block: Block): string {
  let power: number | undefined;
  try { power = block.getRedstonePower(); }
  catch { power = undefined; }
  return `${block.typeId} ${JSON.stringify(block.permutation.getAllStates())} redstone=${power} inv=${containerOf(block)}`;
}

let tracing = false;

export function registerAdaptacoesProbe() {
  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (!event.id.startsWith("cobblemon:adapt_") || event.sourceEntity || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    try { run(event.id.slice("cobblemon:adapt_".length), event.message.trim().split(/\s+/).filter(Boolean)); }
    catch (e) { log(`erro: ${e}`); }
  });
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (!tracing || !entity.isValid) return;
    const t = entity.typeId;
    if (t !== "minecraft:item" && t !== "minecraft:phantom" && t !== "minecraft:bee") return;
    const stack = t === "minecraft:item" ? entity.getComponent("minecraft:item")?.itemStack : undefined;
    const l = entity.location;
    log(`spawn ${t}${stack ? ` ${stack.typeId}×${stack.amount}` : ""} causa=${cause} @${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)} tick=${system.currentTick}`);
  });
}

function run(cmd: string, args: string[]) {
  const handler = extra.get(cmd);
  if (handler) { handler(args); return; }
  const dim = overworld();
  if (cmd === "trace") {
    tracing = args[0] !== "off";
    log(`trace ${tracing ? "ligado" : "desligado"}`);
    return;
  }
  if (cmd === "players") {
    log(`jogadores: ${world.getPlayers().map(p => `${p.name}@${p.dimension.id}:${p.location.x.toFixed(1)},${p.location.y.toFixed(1)},${p.location.z.toFixed(1)}`).join(" ") || "nenhum"}`);
    return;
  }
  const loc = parseLoc(args);
  if (!loc) { log(`uso: ${cmd} <x> <y> <z> ...`); return; }
  const block = dim.getBlock(loc);
  if (!block) { log("bloco fora do mundo/descarregado"); return; }
  switch (cmd) {
    case "state":
      log(describeBlock(block));
      return;
    case "watch": {
      const total = Math.max(1, Math.min(200, Number(args[3]) || 20));
      let last = "";
      let n = 0;
      const id = system.runInterval(() => {
        n++;
        if (!block.isValid) { system.clearRun(id); return; }
        const now = describeBlock(block);
        if (now !== last) log(`t+${n} (tick ${system.currentTick}) ${now}`);
        last = now;
        if (n >= total) system.clearRun(id);
      }, 1);
      return;
    }
    case "items": {
      const r = Number(args[3]) || 4;
      const items = dim.getEntities({ type: "minecraft:item", location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: r }).map(e => {
        const stack = e.getComponent("minecraft:item")?.itemStack;
        const l = e.location;
        return `${stack?.typeId}×${stack?.amount}@${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)}`;
      });
      log(`itens: ${items.join(" ") || "nenhum"}`);
      return;
    }
    default:
      log(`comando desconhecido: ${cmd}`);
  }
}
