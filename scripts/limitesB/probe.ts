/**
 * Sonda de console da frente "limites-b" (conferência no BDS sem cliente). Só responde a `/scriptevent` do console
 * do servidor, com `scriptevent cobblemon:debug_probes on`. Saída em console.info (`[limites-b] ...`).
 *   limb_status                                  contadores de pinturas, enfermeira, fazendeiro e estruturas
 *   limb_paint <x> <y> <z> <face> [nome|auto] [sorteio]  clique do item Pintura na face do bloco (auto = sorteio do Java)
 *   limb_paint_roll <x> <y> <z> <face> <n>       n sorteios: quantas vezes sai cada tipo
 *   limb_paintings                               pinturas do Cobblemon carregadas (registro, propriedades, posição)
 *   limb_paint_hit [creative]                    aplica um golpe (entityAttack) em todas as pinturas carregadas
 *   limb_paint_survive                           roda a checagem de parede agora
 *   limb_vanilla_paintings                       pinturas vanilla: posição, rotação, getAABB e blocos estimados
 *   limb_paint_rng <0..1|off>                    fixa o sorteio do clique do item Pintura
 *   limb_paint_trace on|off                      registra os cliques com o item Pintura que não foram cancelados
 *   limb_nurse                                   roda o AcquirePoi e lista aldeões (família, variante, estação)
 *   limb_nurse_work                              força o WorkAtPoi (som + reposição) ignorando horário e sorteio
 *   limb_farm                                    força um passe do fazendeiro e lista inventários
 *   limb_farm_give <item> <n>                    põe n itens no inventário de todos os fazendeiros carregados
 *   limb_struct <x> <y> <z> <id|#tag> [dim]      consulta de estrutura (como o spawn) + estruturas do chunk
 *   limb_biome <x> <y> <z> [dim]                 bioma do ponto
 */
import { Dimension, EntityDamageCause, ItemStack, ScriptEventSource, system, world } from "@minecraft/server";
import { debugProbesEnabled } from "../Config";
import { COBBLEMON_PAINTINGS } from "../../generated/scripts/limitesB";
import { getStructuresAt, structureQuery } from "../world/StructureRegistry";
import { breakPainting, PAINTING_ENTITY, paintingFitter, paintingRng, paintingSurvives, placePainting, rollPainting, vanillaPaintingBlocks } from "./paintings";
import { facingOf } from "./paintingLogic";
import { nursePass, nurseStats, nurseWorkPass } from "./nurse";
import { NURSE_FAMILY, NURSE_JOY_PROPERTY } from "./nurseLogic";
import { farmerPass, farmerStats } from "./farmer";
import { clearStructureCache, missingBlockIds, resolvedSignatures, structureStats } from "./vanillaStructures";

function log(msg: string) {
  console.info(`[limites-b] ${msg}`);
}

function dim(id?: string): Dimension {
  return world.getDimension(id ?? "overworld");
}

function loc(args: string[]) {
  const [x, y, z] = args.slice(0, 3).map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : undefined;
}

const DIMENSIONS = ["overworld", "nether", "the_end"];

function run(cmd: string, args: string[]) {
  switch (cmd) {
    case "status": {
      let paintings = 0;
      for (const id of DIMENSIONS) paintings += dim(id).getEntities({ type: PAINTING_ENTITY }).length;
      log(`status: pinturas=${paintings} variantes=${COBBLEMON_PAINTINGS.map(p => `${p.name}(${p.width}x${p.height})`).join(",")} ` +
        `enfermeira=${JSON.stringify(nurseStats)} fazendeiro=${JSON.stringify(farmerStats)} estruturas=${JSON.stringify(structureStats)} ` +
        `assinaturas=${resolvedSignatures().length} blocos_inexistentes=[${missingBlockIds.join(",")}]`);
      return;
    }
    case "paint":
    case "paint_roll": {
      const at = loc(args);
      const facing = facingOf(args[3] ?? "");
      if (!at || !facing) return log(`uso: ${cmd} <x> <y> <z> <north|south|east|west> ...`);
      const f = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[facing];
      const anchor = { x: at.x + f[0], y: at.y, z: at.z + f[1] };
      const d = dim();
      if (cmd === "paint_roll") {
        const n = Math.max(1, Math.min(10000, Number(args[4]) || 1000));
        const tally: Record<string, number> = {};
        const started = Date.now();
        const fits = paintingFitter(d, anchor, facing);
        for (let i = 0; i < n; i++) {
          const c = rollPainting(d, anchor, facing, (i + 0.5) / n, fits);
          const k = !c ? "nada" : c.kind === "vanilla" ? `vanilla(área ${c.area})` : c.variant.name;
          tally[k] = (tally[k] ?? 0) + 1;
        }
        const t0 = Date.now();
        rollPainting(d, anchor, facing, 0.5);
        return log(`paint_roll ${facing} @${anchor.x},${anchor.y},${anchor.z}: ${JSON.stringify(tally)} (${n} sorteios em ${t0 - started} ms; 1 clique completo: ${Date.now() - t0} ms)`);
      }
      const want = args[4] ?? "auto";
      if (want !== "auto") {
        const v = COBBLEMON_PAINTINGS.find(p => p.name === want);
        if (!v) return log(`variante desconhecida: ${want}`);
        const e = placePainting(d, anchor, facing, v);
        return log(`paint ${want} ${facing}: ${e ? `colocada ${e.id} @${e.location.x.toFixed(3)},${e.location.y.toFixed(3)},${e.location.z.toFixed(3)}` : "não cabe"}`);
      }
      const roll = args[5] !== undefined ? Number(args[5]) : paintingRng.next();
      const c = rollPainting(d, anchor, facing, roll);
      if (c?.kind === "cobblemon") {
        const e = placePainting(d, anchor, facing, c.variant);
        return log(`paint auto (sorteio ${roll.toFixed(3)}): ${c.variant.name} área ${c.area} → ${e ? `colocada ${e.id}` : "não cabe"}`);
      }
      return log(`paint auto (sorteio ${roll.toFixed(3)}): ${c ? `vanilla área ${c.area} (o Bedrock coloca a dele)` : "nada cabe"}`);
    }
    case "paintings": {
      for (const id of DIMENSIONS) for (const e of dim(id).getEntities({ type: PAINTING_ENTITY })) {
        const l = e.location;
        const r = e.getRotation();
        log(`pintura ${e.id} ${id} @${l.x.toFixed(3)},${l.y.toFixed(3)},${l.z.toFixed(3)} rot=${r.y.toFixed(1)} variant=${e.getProperty("cobblemon:variant")} ` +
          `axis=${e.getProperty("cobblemon:axis")} registro=${e.getDynamicProperty("cobblemon:painting")} sobrevive=${paintingSurvives(e)}`);
      }
      return;
    }
    case "paint_rng": {
      // Rodada 3: fixa o sorteio do clique do item (0 = vanilla quando houver; "off" = aleatório de novo).
      const v = Number(args[0]);
      paintingRng.next = args[0] === "off" || !Number.isFinite(v) ? () => Math.random() : () => v;
      return log(`paint_rng: ${args[0] ?? "off"}`);
    }
    case "paint_trace": {
      // Rodada 3: registra os cliques com o item Pintura que NÃO foram cancelados (o after-event só vem nesses).
      paintTrace = args[0] !== "off";
      return log(`paint_trace: ${paintTrace}`);
    }
    case "vanilla_paintings": {
      // Rodada 3: caixa de colisão e posição das pinturas vanilla (estimativa de blocos ocupados).
      for (const id of DIMENSIONS) for (const e of dim(id).getEntities({ type: "minecraft:painting" })) {
        const l = e.location;
        let box = "-";
        try { const b = e.getAABB(); box = `centro=${b.center.x.toFixed(3)},${b.center.y.toFixed(3)},${b.center.z.toFixed(3)} meia=${b.extent.x.toFixed(3)},${b.extent.y.toFixed(3)},${b.extent.z.toFixed(3)}`; }
        catch (err) { box = `erro ${err}`; }
        const est = vanillaPaintingBlocks(e);
        log(`vanilla ${e.id} @${l.x.toFixed(3)},${l.y.toFixed(3)},${l.z.toFixed(3)} rot=${e.getRotation().y.toFixed(1)} aabb ${box} blocos(${est.exact ? "caixa" : "estimativa"})=${est.blocks.length}`);
      }
      return;
    }
    case "paint_hit": {
      const creative = args[0] === "creative";
      for (const id of DIMENSIONS) for (const e of dim(id).getEntities({ type: PAINTING_ENTITY })) {
        if (creative) { breakPainting(e, false); continue; }
        const ok = e.applyDamage(1, { cause: EntityDamageCause.entityAttack });
        log(`paint_hit ${e.id}: applyDamage=${ok}`);
      }
      return;
    }
    case "paint_survive": {
      for (const id of DIMENSIONS) for (const e of dim(id).getEntities({ type: PAINTING_ENTITY })) {
        const s = paintingSurvives(e);
        log(`paint_survive ${e.id}: ${s}`);
        if (s === false) breakPainting(e, true);
      }
      return;
    }
    case "nurse": {
      const t0 = Date.now();
      nursePass();
      log(`nurse: passe em ${Date.now() - t0} ms`);
      for (const id of DIMENSIONS) for (const v of dim(id).getEntities({ type: "minecraft:villager_v2" })) {
        const fam = v.getComponent("minecraft:type_family")?.getTypeFamilies() ?? [];
        let variant: unknown;
        try { variant = v.getComponent("minecraft:variant")?.value; }
        catch { variant = "?"; }
        let joy: unknown;
        try { joy = v.getProperty(NURSE_JOY_PROPERTY); }
        catch { joy = "?"; }
        const trade = v.getComponent("minecraft:inventory") ? "inv" : "-";
        log(`aldeão ${v.id} nome="${v.nameTag}" filhote=${!!v.getComponent("minecraft:is_baby")} famílias=${fam.join(",")} variant=${variant} enfermeira=${fam.includes(NURSE_FAMILY)} ` +
          `estação=${v.getDynamicProperty("cobblemon:nurse_site") ?? "-"} negociou=${v.getDynamicProperty("cobblemon:nurse_traded") ?? false} joy=${joy} ${trade}`);
      }
      for (const id of DIMENSIONS) for (const z of dim(id).getEntities({ type: "minecraft:zombie_villager_v2" })) {
        const fam = z.getComponent("minecraft:type_family")?.getTypeFamilies() ?? [];
        log(`aldeão zumbi ${z.id} famílias=${fam.join(",")} era_enfermeira=${z.getDynamicProperty("cobblemon:was_nurse") ?? "-"} filhote=${!!z.getComponent("minecraft:is_baby")}`);
      }
      log(`nurse: ${JSON.stringify(nurseStats)}`);
      return;
    }
    case "nurse_work":
      nurseWorkPass(true);
      return log(`nurse_work: ${JSON.stringify(nurseStats)}`);
    case "farm": {
      const t0 = Date.now();
      farmerPass(true);
      log(`farm: passe em ${Date.now() - t0} ms`);
      for (const v of dim().getEntities({ type: "minecraft:villager_v2", families: ["farmer"] })) {
        const c = v.getComponent("minecraft:inventory")?.container;
        const items: string[] = [];
        if (c) for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it) items.push(`${i}:${it.typeId}×${it.amount}`); }
        const l = v.location;
        log(`fazendeiro ${v.id} @${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)} inventário=[${items.join(" ")}]`);
      }
      return log(`farm: ${JSON.stringify(farmerStats)}`);
    }
    case "farm_give": {
      const item = args[0];
      const n = Math.max(1, Number(args[1]) || 1);
      if (!item) return log("uso: farm_give <item> <n>");
      for (const v of dim().getEntities({ type: "minecraft:villager_v2", families: ["farmer"] })) {
        const left = v.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(item, n));
        log(`farm_give ${v.id}: ${item}×${n} sobra=${left ? left.amount : 0}`);
      }
      return;
    }
    case "struct": {
      const at = loc(args);
      const q = args[3];
      if (!at || !q) return log("uso: struct <x> <y> <z> <id|#tag> [dim]");
      const d = dim(args[4]);
      if (args.includes("fresh")) clearStructureCache();
      const r = structureQuery(d, at, [q]);
      log(`struct ${q} @${d.id}:${at.x},${at.y},${at.z}: ${r} | no chunk: [${getStructuresAt(d, at, []).join(",")}] | ${JSON.stringify(structureStats)}`);
      return;
    }
    case "biome": {
      const at = loc(args);
      if (!at) return log("uso: biome <x> <y> <z> [dim]");
      return log(`biome @${at.x},${at.y},${at.z}: ${dim(args[3]).getBiome(at).id}`);
    }
    default:
      log(`comando desconhecido: ${cmd}`);
  }
}

let paintTrace = false;

export function registerLimitesBProbe() {
  world.beforeEvents.playerInteractWithBlock.subscribe(event => {
    if (!paintTrace || event.itemStack?.typeId !== "minecraft:painting") return;
    const { block, blockFace, isFirstEvent } = event;
    const where = `${block.location.x},${block.location.y},${block.location.z} face=${blockFace} primeiro=${isFirstEvent}`;
    system.run(() => log(`paint_trace: antes @${where} cancel=${event.cancel}`));
  });
  world.afterEvents.playerInteractWithBlock.subscribe(({ block, blockFace, itemStack, isFirstEvent }) => {
    if (!paintTrace || itemStack?.typeId !== "minecraft:painting") return;
    log(`paint_trace: NÃO cancelado ${block.typeId} @${block.location.x},${block.location.y},${block.location.z} face=${blockFace} primeiro=${isFirstEvent}`);
  });
  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (!event.id.startsWith("cobblemon:limb_") || event.sourceEntity || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    try { run(event.id.slice("cobblemon:limb_".length), event.message.trim().split(/\s+/).filter(Boolean)); }
    catch (e) { log(`erro: ${e}`); }
  });
}
