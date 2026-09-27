/**
 * Sonda de console da frente mundo-sons (conferência no servidor sem cliente): só responde a `/scriptevent` vindo do
 * console do servidor (sem entidade de origem). Saída em console.warn (aparece no log do BDS).
 *   scriptevent cobblemon:ms_state <x> <y> <z>          tipo, estados, redstone e estado de máquina do bloco
 *   scriptevent cobblemon:ms_pot <x> <y> <z> <item...>   põe panela com os itens na fogueira do Cobblemon em x y z
 *   scriptevent cobblemon:ms_tm <x> <y> <z> <golpe>      começa a gravar um TM na máquina em x y z
 *   scriptevent cobblemon:ms_hit <x> <y> <z> <força>     acerta o Ring Target (como um projétil)
 *   scriptevent cobblemon:ms_press <x> <y> <z>           aperta um botão do Cobblemon
 *   scriptevent cobblemon:ms_boat <x> <y> <z> <entidade> coloca um barco
 *   scriptevent cobblemon:ms_boats                       lista os barcos do Cobblemon (posição)
 *   scriptevent cobblemon:ms_items                       lista os itens soltos no chão (tipo × quantidade)
 *   scriptevent cobblemon:ms_hurt <dano>                 causa dano aos barcos do Cobblemon (quebrar)
 */
import { ScriptEventSource, system, Vector3, world } from "@minecraft/server";
import { debugProbesEnabled } from "../Config";
import { blockKey } from "./store";
import { cookingStore, potActivity } from "./cooking";
import { tmStore } from "./tm";
import { hitRingTarget } from "../custom_components/RedstoneEvents";
import { pressButton } from "../custom_components/ButtonComponent";
import { GRID_SIZE, SEASONING_SLOTS } from "./cookingLogic";

function parseLoc(parts: string[]): Vector3 | undefined {
  const [x, y, z] = parts.slice(0, 3).map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
}

function log(msg: string) {
  console.warn(`[mundo-sons] ${msg}`);
}

export function registerMundoSonsProbe() {
  system.afterEvents.scriptEventReceive.subscribe(event => {
    // Só com as sondas de depuração ligadas (config `enableDebugProbes`) e pelo console.
    if (!event.id.startsWith("cobblemon:ms_") || event.sourceEntity || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    try { run(event.id.slice("cobblemon:ms_".length), event.message.trim().split(/\s+/)); }
    catch (e) { log(`erro: ${e}`); }
  });
}

function run(cmd: string, args: string[]) {
  const dim = world.getDimension("overworld");
  if (cmd === "boats") {
    const boats = dim.getEntities({ families: ["cobblemon_boat"] });
    log(`barcos: ${boats.map(b => `${b.typeId}@${b.location.x.toFixed(2)},${b.location.y.toFixed(2)},${b.location.z.toFixed(2)}`).join(" ") || "nenhum"}`);
    return;
  }
  if (cmd === "hurt") {
    for (const boat of dim.getEntities({ families: ["cobblemon_boat"] })) {
      try { log(`${boat.typeId}: dano aplicado=${boat.applyDamage(Number(args[0]) || 40)}`); }
      catch (e) { log(`${boat.typeId}: ${e}`); }
    }
    return;
  }
  if (cmd === "items") {
    const items = dim.getEntities({ type: "minecraft:item" }).map(e => {
      const stack = e.getComponent("minecraft:item")?.itemStack;
      return `${stack?.typeId}×${stack?.amount}`;
    });
    log(`itens: ${items.join(" ") || "nenhum"}`);
    return;
  }
  const loc = parseLoc(args);
  if (!loc) { log("uso: <x> <y> <z> ..."); return; }
  const block = dim.getBlock(loc);
  if (!block) { log("bloco fora do mundo/descarregado"); return; }
  const key = blockKey(dim.id, block.location);
  switch (cmd) {
    case "state": {
      let power: number | undefined;
      try { power = block.getRedstonePower(); } catch { power = undefined; }
      const pot = cookingStore.get(key);
      log(`${block.typeId} ${JSON.stringify(block.permutation.getAllStates())} redstone=${power} tm=${JSON.stringify(tmStore.get(key) ?? null)} pot=${pot ? JSON.stringify({ lid: pot.lid, powered: pot.powered, progress: pot.progress, activity: potActivity(pot) }) : "null"}`);
      return;
    }
    case "pot": {
      const items = args.slice(3);
      const grid = new Array(GRID_SIZE).fill(null).map((_, i) => (items[i] ? { id: items[i], n: 1 } : null));
      cookingStore.set(key, { pot: "cobblemon:campfire_pot_red", grid, seasonings: new Array(SEASONING_SLOTS).fill(null), result: null, progress: 0, lid: false });
      log(`panela em ${key}`);
      return;
    }
    case "tm":
      tmStore.set(key, { move: args[3] ?? "tackle", progress: 0 });
      log(`TM em ${key}`);
      return;
    case "hit":
      hitRingTarget(block, Math.max(1, Math.min(15, Number(args[3]) || 15)), 20);
      log(`alvo ${key} → ${block.permutation.getState("cobblemon:power" as never)}`);
      return;
    case "press":
      log(`botão ${key}: ${pressButton(block)}`);
      return;
    case "boat": {
      const entity = dim.spawnEntity((args[3] ?? "cobblemon:apricorn_boat") as never, { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 });
      log(`barco ${entity.typeId} em ${entity.location.x},${entity.location.y},${entity.location.z}`);
      return;
    }
    default:
      log(`comando desconhecido: ${cmd}`);
  }
}
