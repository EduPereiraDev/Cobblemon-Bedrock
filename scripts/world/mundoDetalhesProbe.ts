/**
 * Sonda de console da frente mundo-detalhes (conferência no BDS sem cliente). Só responde a `/scriptevent` do
 * console (sem entidade de origem); saída em console.warn no log do servidor.
 *   scriptevent cobblemon:md_spawn <x> <y> <z> <espécie> [item]  Pokémon selvagem com item segurado
 *   scriptevent cobblemon:md_pokemon                              Pokémon do Overworld: item na mão secundária, luz, aspects, vida
 *   scriptevent cobblemon:md_state <x> <y> <z>                    tipo e estados do bloco
 *   scriptevent cobblemon:md_pot <x> <y> <z> <item|take>         planta/tira do vaso
 *   scriptevent cobblemon:md_compost <x> <y> <z> <item> [roll]   põe item de bloco na composteira
 *   scriptevent cobblemon:md_seed <x> <y> <z> <face> <semente>   semente de apricorn na lateral da folha
 *   scriptevent cobblemon:md_harvest <x> <y> <z>                 colhe o apricorn maduro (soco)
 *   scriptevent cobblemon:md_drip <x> <y> <z>                    random tick do minério do espeleotema (chance 1)
 *   scriptevent cobblemon:md_disc <x> <y> <z> <espaço> <item>    guarda na estante e atualiza a exibição
 *   scriptevent cobblemon:md_note <x> <y> <z>                    pulso do note block acima da estante
 *   scriptevent cobblemon:md_fetus <x> <y> <z> <fóssil> <progresso|off>  feto no tanque
 *   scriptevent cobblemon:md_fortune <bloco> <nível>             bônus de Fortuna sorteado
 *   scriptevent cobblemon:md_lightning <x> <y> <z>               raio no ponto (vida/efeitos dos Pokémon perto)
 */
import { Direction, Entity, EquipmentSlot, ItemStack, ScriptEventSource, system, Vector3, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { createPokemonData, spawnWildPokemon } from "../machines/common";
import { compostIntoBlock, harvestApricorn, plantApricornBlock, potPlantBlock, takeFromPotBlock } from "./VanillaInteractions";
import { fortuneExtras } from "./Fortune";
import DripstoneGrowthComponent from "../custom_components/DripstoneGrowthComponent";
import { pulseNoteBlock, refreshDiscShelfDisplay } from "../machines/discShelfSequencer";
import { syncFossilFetus } from "../machines/fossilFetus";
import { containerOf, ensureStorage, MACHINE_STORAGE } from "./Containers";
import { debugProbesEnabled } from "../Config";
import { getHeldItemOnEntity, setHeldItemOnEntity } from "../pokemon/HeldItemStore";

function log(msg: string) {
  console.warn(`[mundo-detalhes] ${msg}`);
}

function parseLoc(parts: string[]): Vector3 | undefined {
  const [x, y, z] = parts.slice(0, 3).map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
}

function offhand(entity: Entity, item: string): boolean {
  try { return entity.runCommand(`testfor @s[hasitem={item=${item},location=slot.weapon.offhand}]`).successCount > 0; }
  catch { return false; }
}

function describePokemon(entity: Entity): string {
  const data = PokemonData.tryGetFromEntity(entity);
  const held = getHeldItemOnEntity(entity) ?? "-";
  // Item segurado fica só nos dados (pokemon/HeldItemStore); "espaço0" mostra o inventário legado (até o beta 7).
  let slot0 = "sem-inventario";
  try {
    const legacy = entity.getComponent("minecraft:inventory")?.container;
    if (legacy) slot0 = legacy.getItem(0)?.typeId ?? "vazio";
  }
  catch { /* sem componente */ }
  const shown = entity.getDynamicProperty("cobblemon:shown_item") ?? "-";
  const head = entity.getHeadLocation();
  let light = "-";
  try { light = entity.dimension.getBlock({ x: Math.floor(head.x), y: Math.floor(head.y), z: Math.floor(head.z) })?.typeId ?? "-"; }
  catch { /* descarregado */ }
  const health = entity.getComponent("minecraft:health")?.currentValue;
  const effects = entity.getEffects().map(e => `${e.typeId}:${e.amplifier}`).join(",") || "-";
  return `${entity.typeId} segurado=${held} espaço0=${slot0} mostrado=${shown} mão2=${held !== "-" && offhand(entity, held)} luz=${light} aspects=${data?.aspects.join(",") ?? "-"} vida=${health} efeitos=${effects} variante=${entity.getProperty("cobblemon:variant")}`;
}

function run(cmd: string, args: string[]) {
  const dim = world.getDimension("overworld");
  if (cmd === "pokemon") {
    const list = dim.getEntities({ families: ["pokemon"] });
    log(`pokémon: ${list.length}`);
    for (const e of list) log(describePokemon(e));
    // Itens soltos no chão (migração do item segurado: o motor derruba o conteúdo do inventário legado?).
    const drops = dim.getEntities({ type: "minecraft:item" }).map(e => {
      const stack = e.getComponent("minecraft:item")?.itemStack;
      return `${stack?.typeId ?? "?"}x${stack?.amount ?? 0}@${e.location.x.toFixed(1)},${e.location.y.toFixed(1)},${e.location.z.toFixed(1)}`;
    });
    log(`itens no chão: ${drops.length} ${drops.join(" ")}`);
    return;
  }
  if (cmd === "mark") {
    log(`--- ${args.join(" ")}`);
    return;
  }
  if (cmd === "playerlight") {
    for (const player of world.getAllPlayers()) {
      const head = player.getHeadLocation();
      const eq = player.getComponent("minecraft:equippable");
      let block = "-";
      try { block = dim.getBlock({ x: Math.floor(head.x), y: Math.floor(head.y), z: Math.floor(head.z) })?.typeId ?? "-"; }
      catch { /* descarregado */ }
      log(`${player.name}: cabeça=${block} mão=${eq?.getEquipment(EquipmentSlot.Mainhand)?.typeId} capacete=${eq?.getEquipment(EquipmentSlot.Head)?.typeId}`);
    }
    return;
  }
  if (cmd === "aspect") {
    // md_aspect <espécie> <aspect...>: troca os aspects do Pokémon da espécie (ex.: miltank mooshtank-red).
    for (const e of dim.getEntities({ type: `cobblemon:${args[0]}` })) {
      const data = PokemonData.tryGetFromEntity(e);
      if (!data) continue;
      data.aspects = args.slice(1);
      data.applyToCobblemon(e);
      log(`aspects de ${e.typeId}: ${data.aspects.join(",")} variante=${e.getProperty("cobblemon:variant")}`);
    }
    return;
  }
  if (cmd === "bees") {
    for (const e of dim.getEntities({ families: ["pokemon"] })) {
      if (!/combee|vespiquen/.test(e.typeId)) continue;
      log(`${e.typeId} @${e.location.x.toFixed(1)},${e.location.y.toFixed(1)},${e.location.z.toFixed(1)} néctar=${e.getDynamicProperty("cobblemon:bee_nectar") === true}`);
    }
    return;
  }
  if (cmd === "list") {
    for (const type of ["cobblemon:disc_shelf_display", "cobblemon:fossil_fetus", "cobblemon:machine_storage"]) {
      const list = dim.getEntities({ type });
      log(`${type}: ${list.map(e => {
        const props = type === "cobblemon:machine_storage"
          ? `itens=${(() => { const c = containerOf(e); const out: string[] = []; for (let i = 0; c && i < 14; i++) { const it = c.getItem(i); if (it) out.push(`${i}:${it.typeId}`); } return out.join("|"); })()}`
          : Object.entries(type === "cobblemon:fossil_fetus" ? { f: "cobblemon:fetus", p: "cobblemon:progress" } : { s0: "cobblemon:slot_0", s3: "cobblemon:slot_3", s10: "cobblemon:slot_10" }).map(([k, v]) => `${k}=${e.getProperty(v)}`).join(" ");
        return `@${e.location.x.toFixed(1)},${e.location.y.toFixed(1)},${e.location.z.toFixed(1)} ${props}`;
      }).join(" ; ") || "nenhuma"}`);
    }
    return;
  }
  if (cmd === "fortune") {
    const out = fortuneExtras(args[0], {}, Number(args[1]) || 3);
    log(`fortuna ${args[0]}: ${JSON.stringify(out)}`);
    return;
  }
  const loc = parseLoc(args);
  if (!loc) { log("uso: <x> <y> <z> ..."); return; }
  const block = dim.getBlock(loc);
  if (!block) { log("bloco fora do mundo/descarregado"); return; }
  switch (cmd) {
    case "spawn": {
      const data = createPokemonData(args[3] ?? "charmander", { level: 10 });
      if (!data) { log(`espécie ${args[3]} inexistente`); return; }
      const entity = spawnWildPokemon(dim, { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }, data);
      if (entity && args[4]) setHeldItemOnEntity(entity, args[4]);
      log(`spawn ${entity?.typeId ?? "falhou"} id=${entity?.id}`);
      return;
    }
    case "item":
      dim.spawnItem(new ItemStack(args[3] ?? "minecraft:sweet_berries", Number(args[4]) || 1), { x: loc.x + 0.5, y: loc.y + 0.2, z: loc.z + 0.5 });
      log(`item ${args[3]} solto`);
      return;
    case "mainhand": {
      // md_mainhand <x> <y> <z> <espécie> <item>: o Pokémon da espécie carrega o item na boca (mão principal)?
      for (const e of dim.getEntities({ type: `cobblemon:${args[3]}` })) {
        let ok = false;
        try { ok = e.runCommand(`testfor @s[hasitem={item=${args[4]},location=slot.weapon.mainhand}]`).successCount > 0; }
        catch { ok = false; }
        log(`${e.typeId} mão principal ${args[4]}=${ok} @${e.location.x.toFixed(1)},${e.location.z.toFixed(1)}`);
      }
      return;
    }
    case "state":
      log(`${block.typeId} ${JSON.stringify(block.permutation.getAllStates())}`);
      return;
    case "pot":
      if (args[3] === "take") log(`vaso: tirou ${takeFromPotBlock(block)} → ${block.typeId}`);
      else log(`vaso: plantou=${potPlantBlock(block, args[3])} → ${block.typeId}`);
      return;
    case "compost":
      log(`composteira: nível=${compostIntoBlock(block, args[3], args[4] !== undefined ? Number(args[4]) : undefined)}`);
      return;
    case "seed": {
      const faces: Record<string, Direction> = { north: Direction.North, south: Direction.South, east: Direction.East, west: Direction.West, up: Direction.Up };
      const ok = plantApricornBlock(block, faces[args[3]] ?? Direction.North, args[4] ?? "cobblemon:red_apricorn_seed");
      log(`semente na folha: ${ok}`);
      return;
    }
    case "harvest":
      log(`colheita: ${harvestApricorn(block)} → ${JSON.stringify(block.permutation.getAllStates())}`);
      return;
    case "drip":
      new DripstoneGrowthComponent(1).onRandomTick({ block, dimension: dim } as never);
      log(`espeleotema: embaixo=${block.below()?.typeId} ${JSON.stringify(block.below()?.permutation.getAllStates())} 2 abaixo=${block.below(2)?.typeId} ${JSON.stringify(block.below(2)?.permutation.getAllStates())}`);
      return;
    case "disc": {
      const storage = ensureStorage(dim, block.location, MACHINE_STORAGE, 0.4);
      const container = containerOf(storage);
      container?.setItem(Number(args[3]) || 0, new ItemStack(args[4] ?? "minecraft:music_disc_cat", 1));
      refreshDiscShelfDisplay(block);
      system.runTimeout(() => {
        const display = dim.getEntities({ type: "cobblemon:disc_shelf_display", location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: 1 })[0];
        const values = display ? Array.from({ length: 14 }, (_, i) => display.getProperty(`cobblemon:slot_${i}`)).join(",") : "sem exibição";
        log(`estante: ${values} yaw=${display?.getRotation().y}`);
      }, 2);
      return;
    }
    case "note":
      pulseNoteBlock(block);
      log(`note block pulsado em ${block.typeId}`);
      return;
    case "fetus": {
      const off = args[4] === "off";
      syncFossilFetus(dim, loc, !off, args[3], off ? 0 : Number(args[4]) || 0.5, "north");
      system.runTimeout(() => {
        const fetus = dim.getEntities({ type: "cobblemon:fossil_fetus" });
        log(`fetos: ${fetus.map(f => `${f.getProperty("cobblemon:fetus")}@${f.getProperty("cobblemon:progress")} y=${f.location.y.toFixed(2)}`).join(" ") || "nenhum"}`);
      }, 2);
      return;
    }
    case "lightning":
      dim.spawnEntity("minecraft:lightning_bolt" as never, loc);
      system.runTimeout(() => { for (const e of dim.getEntities({ families: ["pokemon"], location: loc, maxDistance: 6 })) log(describePokemon(e)); }, 10);
      return;
    default:
      log(`comando desconhecido: ${cmd}`);
  }
}

let started = false;

export function registerMundoDetalhesProbe() {
  if (started) return;
  started = true;
  system.afterEvents.scriptEventReceive.subscribe(event => {
    // Só com as sondas de depuração ligadas (config `enableDebugProbes`) e pelo console.
    if (!event.id.startsWith("cobblemon:md_") || event.sourceEntity || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    try { run(event.id.slice("cobblemon:md_".length), event.message.trim().split(/\s+/)); }
    catch (e) { log(`erro: ${e}`); }
  });
}
