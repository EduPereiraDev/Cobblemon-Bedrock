/**
 * Frente "adaptacoes": comportamentos do Cobblemon 1.8.2 que o Bedrock não tem de fábrica, simulados por script
 * com APIs estáveis (`@minecraft/server` 2.10.0) e laços baratos.
 *
 * - potHoppers.ts: funil e comparador da panela na fogueira (8 ticks, só panelas registradas e carregadas);
 * - potRedstone.ts: tampa da panela por redstone lida dos 6 vizinhos (2 ticks; a fogueira não tem redstone_consumer);
 * - bees.ts: abelhas com néctar fazem crescer as plantas da tag bee_growables (10 ticks, só abelhas carregadas);
 * - dispenser.ts: tesoura em berry/apricorn/raízes, mel/poção na saccharine (dispensers registrados, 1 tick);
 * - decoratedPot.ts: vaso decorado com os sherds do Cobblemon (bloco + entidade de exibição/armazenamento);
 * - mentalRestoration.ts: Mental Herb (desconta a insônia; phantoms somem enquanto o desconto vale).
 *
 * Ligação (main.ts, dentro de world.afterEvents.worldLoad): `startAdaptacoes();` — ver docs/pendencias/adaptacoes.md.
 * O custom component do vaso é registrado aqui no startup (a importação deste módulo pelo main.ts basta).
 */
import { BlockTypes, BlockVolume, EnchantmentType, ItemStack, Player, system, world } from "@minecraft/server";
import { addProbeCommand, describeBlock, log, overworld, parseLoc, registerAdaptacoesProbe } from "./probe";
import { ADAPTACOES_BLOCK_COMPONENTS } from "../custom_components/adaptacoes";
import { potSignal, startPotHoppers, tickPot } from "./potHoppers";
import { dimensionReader, directSignalTo, DIRS6, hasNeighborSignal, offset, OPPOSITE6, potNeighborSignal, startPotRedstone, weakSignal } from "./potRedstone";
import { beeRng, BEE_GROW_RULES, startBees, tickBees } from "./bees";
import { dispenserStore, registerIfRelevant, startDispensers } from "./dispenser";
import {
  craftPot, createPotItem, findDisplay, interactWithPot, onPotBrokenByPlayer, potStore, potTickStats, registerPot, startDecoratedPots, tickAllDecoratedPots,
  tickDecoratedPot, tickDecoratedPotSlice,
} from "./decoratedPot";
import { applyMentalRestoration, getRest, javaCounter, keepPhantomProbability, setRest, startMentalRestoration } from "./mentalRestoration";
import { cookingStore } from "../machines/cooking";
import { GRID_SIZE, SEASONING_SLOTS } from "../machines/cookingLogic";
import { replaceBlock } from "../comparadores/replace";
import { blockKey, parseBlockKey as parseBlockKeyLocal } from "../machines/store";
import { Dir4, normalizeDecorations, PotDecorations } from "./decoratedPotLogic";
import { DECORATED_POT } from "./sherds";

system.beforeEvents.startup.subscribe(event => {
  for (const [key, component] of Object.entries(ADAPTACOES_BLOCK_COMPONENTS)) {
    try { event.blockComponentRegistry.registerCustomComponent(key, component); }
    catch (e) { console.warn(`[adaptacoes] componente ${key}: ${e}`); }
  }
});

let started = false;

function safe(name: string, fn: () => void) {
  try { fn(); }
  catch (e) { console.warn(`[adaptacoes] ${name}: ${e}`); }
}

function playerNamed(name: string | undefined): Player | undefined {
  return world.getPlayers().find(p => p.name === name) ?? (name === "@first" ? world.getPlayers()[0] : undefined);
}

function registerProbeCommands() {
  addProbeCommand("pot", args => {
    const loc = parseLoc(args);
    if (!loc) return log("uso: pot <x> <y> <z> [tick | new [panela] | result <item> <n> | fill <item> <n> <espaços>]");
    const key = blockKey("minecraft:overworld", loc);
    if (args[3] === "tick") log(`movidos: ${tickPot(key)}`);
    if (args[3] === "new") {
      // new [panela]: registra uma panela vazia numa fogueira do Cobblemon já posta (/setblock), sem jogador.
      cookingStore.set(key, { pot: args[4] ?? "cobblemon:campfire_pot_red", grid: new Array(GRID_SIZE).fill(null), seasonings: new Array(SEASONING_SLOTS).fill(null), result: null, progress: 0, lid: false });
    }
    if (args[3] === "fill") {
      // fill <item> <quantidade> <espaços da grade>: grade 1..k com a pilha, o resto vazio.
      const st = cookingStore.get(key);
      const k = Math.max(0, Math.min(9, Number(args[6]) || 0));
      if (st) { st.grid = st.grid.map((_, i) => (i < k ? { id: args[4], n: Number(args[5]) || 1 } : null)); cookingStore.set(key, st); }
    }
    if (args[3] === "result") {
      const st = cookingStore.get(key);
      if (st) { st.result = args[4] ? { id: args[4], n: Number(args[5]) || 1 } : null; cookingStore.set(key, st); }
    }
    const s = cookingStore.get(key);
    const block = overworld().getBlock(loc);
    log(`panela ${key}: ${s ? JSON.stringify({ grid: s.grid, seasonings: s.seasonings, result: s.result, lid: s.lid, progress: s.progress, sinal: potSignal(s) }) : "sem panela"} bloco=${block ? describeBlock(block) : "-"}`);
  });
  addProbeCommand("replace", args => {
    // replace <x> <y> <z>: recoloca o bloco no mesmo tick (como o comparador faz quando as faces mudam) e mostra se a
    // panela/vaso perdeu registro, conteúdo ou entidade (onBreak/onPlace do componente) no mesmo tick e no seguinte.
    const loc = parseLoc(args);
    const block = loc && overworld().getBlock(loc);
    if (!block) return log("uso: replace <x> <y> <z>");
    const key = blockKey("minecraft:overworld", loc);
    const snap = (when: string) => {
      const pot = cookingStore.get(key);
      const display = findDisplay(overworld(), loc);
      const item = display?.getComponent("minecraft:inventory")?.container?.getItem(0);
      const drops = overworld().getEntities({ type: "minecraft:item", location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: 3 }).length;
      log(`replace ${when}: ${overworld().getBlock(loc)?.typeId} panela=${pot ? JSON.stringify({ grid: pot.grid.filter(Boolean).length, lid: pot.lid, powered: pot.powered }) : "-"} vaso=${JSON.stringify(potStore.get(key) ?? null)} entidade=${display ? `${display.id}:${item ? `${item.typeId}×${item.amount}` : "vazio"}` : "-"} itens_soltos=${drops}`);
    };
    snap("antes");
    replaceBlock(block, block.permutation);
    snap("mesmo tick");
    system.run(() => snap("tick seguinte"));
    system.runTimeout(() => snap("+10 ticks"), 10);
  });
  addProbeCommand("pot_rs", args => {
    const loc = parseLoc(args);
    const block = loc && overworld().getBlock(loc);
    if (!block) return log("uso: pot_rs <x> <y> <z>");
    const read = dimensionReader(overworld());
    const parts = DIRS6.map(d => {
      const at = offset(loc, d);
      const v = read(at);
      const direct = v && v.id !== "minecraft:air" ? directSignalTo(at, read, OPPOSITE6[d]) : 0;
      return `${d}=${v ? `${v.id.replace("minecraft:", "")}${JSON.stringify(v.states)} p=${v.power} fraco=${weakSignal(v, OPPOSITE6[d])} direto=${direct}` : "-"}`;
    });
    let own: number | undefined;
    try { own = block.getRedstonePower(); }
    catch { own = undefined; }
    const st = cookingStore.get(blockKey("minecraft:overworld", loc));
    log(`pot_rs ${block.typeId} própria=${own} vizinhança=${potNeighborSignal(block)} lid=${st?.lid} powered=${st?.powered} | ${parts.join(" | ")}`);
  });
  addProbeCommand("bees", () => {
    for (const bee of overworld().getEntities({ type: "minecraft:bee" })) {
      const l = bee.location;
      log(`abelha ${bee.id} néctar=${bee.getProperty("minecraft:has_nectar")} plantas=${bee.getDynamicProperty("cobblemon:bee_crops") ?? 0} @${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)}`);
    }
  });
  addProbeCommand("bee_tick", args => {
    // Sorteios forçados (0,5 mantém/começa a meta, 0 cresce): cada amostragem cresce em todos os ticks da meta.
    const saved = beeRng.next;
    let flip = false;
    beeRng.next = () => (flip = !flip) ? 0.5 : 0;
    try { for (let i = 0; i < Math.max(1, Number(args[0]) || 1); i++) tickBees(); }
    finally { beeRng.next = saved; }
    log(`bee_tick ok (regras: ${Object.keys(BEE_GROW_RULES).length} blocos)`);
  });
  addProbeCommand("rest", args => {
    const p = playerNamed(args[0] ?? "@first");
    if (!p) return log("jogador não encontrado");
    if (args[1] === "set") setRest(p, { b: Number(args[2]) || 0, c: Number(args[3]) || 0, left: 0, amp: 0 });
    const s = getRest(p);
    log(`descanso ${p.name}: ${JSON.stringify(s)} java=${javaCounter(s)} manter_phantom=${keepPhantomProbability(s).toFixed(3)} dormindo=${p.isSleeping}`);
  });
  addProbeCommand("mental", args => {
    const p = playerNamed(args[0] ?? "@first");
    if (!p) return log("jogador não encontrado");
    applyMentalRestoration(p, Number(args[1]) || 200, Number(args[2]) || 0);
    log(`mental_restoration em ${p.name}: ${JSON.stringify(getRest(p))}`);
  });
  addProbeCommand("vase", args => {
    const loc = parseLoc(args);
    if (!loc) return log("uso: vase <x> <y> <z> [fundo esquerda direita frente] [direção]");
    const dim = overworld();
    const block = dim.getBlock(loc);
    if (!block) return log("fora do mundo");
    if (args.length >= 7) {
      const d = normalizeDecorations(args.slice(3, 7)) as PotDecorations;
      const f = (args[7] ?? "north") as Dir4;
      potStore.delete(blockKey(dim.id, loc));
      block.setType(DECORATED_POT);
      potStore.set(blockKey(dim.id, loc), { d, f });
      registerPot(block, { d, f });
    }
    tickDecoratedPot(blockKey(dim.id, loc));
    const display = findDisplay(dim, loc);
    const item = display?.getComponent("minecraft:inventory")?.container?.getItem(0);
    const props = display ? ["north", "east", "south", "west"].map(s => `${s}=${display.getProperty(`cobblemon:face_${s}`)}`).join(" ") : "-";
    log(`vaso ${JSON.stringify(potStore.get(blockKey(dim.id, loc)) ?? null)} entidade=${display ? `${display.typeId} rot=${display.getRotation().y} ${props}` : "nenhuma"} conteúdo=${item ? `${item.typeId}×${item.amount}` : "vazio"} bloco=${describeBlock(block)}`);
  });
  addProbeCommand("vase_use", args => {
    const loc = parseLoc(args);
    const p = playerNamed(args[3] ?? "@first");
    const block = loc && overworld().getBlock(loc);
    if (!block || !p) return log("uso: vase_use <x> <y> <z> [jogador]");
    interactWithPot(p, block);
    const held = p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex);
    log(`vase_use: mão=${held ? `${held.typeId}×${held.amount}` : "vazia"}`);
  });
  addProbeCommand("vase_break", args => {
    const loc = parseLoc(args);
    if (!loc) return log("uso: vase_break <x> <y> <z> <ferramenta|none> [silk] [creative]");
    const dim = overworld();
    let tool: ItemStack | undefined;
    if (args[3] && args[3] !== "none") {
      tool = new ItemStack(args[3], 1);
      if (args.includes("silk")) {
        try { tool.getComponent("minecraft:enchantable")?.addEnchantment({ type: new EnchantmentType("silk_touch"), level: 1 }); }
        catch (e) { log(`sem Toque Suave: ${e}`); }
      }
    }
    dim.getBlock(loc)?.setType("minecraft:air");
    const cracked = onPotBrokenByPlayer(args.includes("creative"), dim, loc, tool);
    log(`vase_break: rachou=${cracked}`);
  });
  addProbeCommand("vase_item", args => {
    const p = playerNamed(args[4] ?? "@first");
    if (!p || args.length < 4) return log("uso: vase_item <fundo> <esquerda> <direita> <frente> [jogador]");
    const d = normalizeDecorations(args.slice(0, 4)) as PotDecorations;
    p.getComponent("minecraft:inventory")?.container?.setItem(p.selectedSlotIndex, createPotItem(d));
    log(`vase_item: ${JSON.stringify(d)} na mão de ${p.name}`);
  });
  addProbeCommand("craft", args => {
    const p = playerNamed(args[4] ?? "@first");
    if (!p || args.length < 4) return log("uso: craft <fundo> <esquerda> <direita> <frente> [jogador]");
    const ok = craftPot(p, normalizeDecorations(args.slice(0, 4)) as PotDecorations);
    const inv = p.getComponent("minecraft:inventory")?.container;
    const items: string[] = [];
    if (inv) for (let i = 0; i < inv.size; i++) {
      const it = inv.getItem(i);
      if (it) items.push(`${it.typeId}×${it.amount}${it.typeId === DECORATED_POT ? `${it.getDynamicProperty("cobblemon:pot_decorations") ?? ""} lore=${JSON.stringify(it.getRawLore())}` : ""}`);
    }
    log(`craft: criou=${ok} inventário: ${items.join(" ")}`);
  });
  addProbeCommand("disp_reg", args => {
    const loc = parseLoc(args);
    const block = loc && overworld().getBlock(loc);
    log(`disp_reg: ${block ? registerIfRelevant(block) : "fora do mundo"}`);
  });
  addProbeCommand("pow", args => {
    const loc = parseLoc(args);
    const block = loc && overworld().getBlock(loc);
    if (!block) return log("uso: pow <x> <y> <z> <força> <máscara>");
    const before = block.getRedstonePower();
    block.setPermutation(block.permutation.withState("cobblemon:comparator" as never, (Number(args[3]) || 0) as never).withState("cobblemon:comparator_faces" as never, (Number(args[4]) || 0) as never));
    const same = block.getRedstonePower();
    system.run(() => log(`pow: antes=${before} mesmo_tick=${same} tick_seguinte=${block.getRedstonePower()}`));
  });
  addProbeCommand("displays", args => {
    const loc = parseLoc(args);
    if (!loc) return log("uso: displays <x> <y> <z>");
    const list = overworld().getEntities({ type: "cobblemon:decorated_pot_display", location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, maxDistance: 2 });
    log(`displays: ${list.map(e => { const it = e.getComponent("minecraft:inventory")?.container?.getItem(0); return `${e.id}@${e.location.y.toFixed(2)}:${it ? `${it.typeId}×${it.amount}` : "vazio"}`; }).join(" ") || "nenhuma"}`);
  });
  // Rodada 3 da revisão: conteúdo do vaso, banco de desempenho do laço do vaso e da redstone da panela.
  addProbeCommand("vase_fill", args => {
    const loc = parseLoc(args);
    const display = loc && findDisplay(overworld(), loc);
    if (!display || !args[3]) return log("uso: vase_fill <x> <y> <z> <item> <n>");
    display.getComponent("minecraft:inventory")?.container?.setItem(0, new ItemStack(args[3], Math.max(1, Number(args[4]) || 1)));
    log(`vase_fill: ${args[3]}×${Number(args[4]) || 1} em ${display.id}`);
  });
  addProbeCommand("vase_bench", args => {
    const n = Math.max(1, Math.min(1000, Number(args[0]) || 200));
    const x0 = Number(args[1]) || 0, y = Number(args[2]) || 100, z0 = Number(args[3]) || 0;
    const dim = overworld();
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      const loc = { x: x0 + (i % 20) * 2, y, z: z0 + Math.floor(i / 20) * 2 };
      const key = blockKey(dim.id, loc);
      keys.push(key);
      if (args.includes("place")) {
        const block = dim.getBlock(loc);
        if (!block) continue;
        block.setType(DECORATED_POT);
        const rec = { d: normalizeDecorations(["minecraft:brick", "cobblemon:dome_sherd", "minecraft:brick", "minecraft:brick"]) as PotDecorations, f: "north" as Dir4 };
        potStore.set(key, rec);
        registerPot(block, rec);
      }
    }
    if (args.includes("place")) return log(`vase_bench: ${n} vasos colocados (y=${y})`);
    // Antes (emulado): por vaso, 2 getEntities por posição + setRotation + 10 getBlock de vizinhos.
    const legacy = () => {
      for (const key of keys) {
        const { location } = parseBlockKeyLocal(key);
        const c = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
        dim.getEntities({ type: "cobblemon:decorated_pot_display", location: c, maxDistance: 0.9 });
        const list = dim.getEntities({ type: "cobblemon:decorated_pot_display", location: c, maxDistance: 0.9 });
        list[0]?.setRotation({ x: 0, y: 180 });
        for (const o of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) dim.getBlock({ x: location.x + o[0], y: location.y + o[1], z: location.z + o[2] });
      }
    };
    const time = (fn: () => void, reps: number) => { const t0 = Date.now(); for (let r = 0; r < reps; r++) fn(); return (Date.now() - t0) / reps; };
    const reps = Math.max(1, Number(args[4]) || 10);
    const legacyMs = time(legacy, reps);
    const before = { ...potTickStats };
    const fullMs = time(() => tickAllDecoratedPots(), reps);
    const slices: number[] = [];
    for (let t = 0; t < 8 * reps; t++) { const t0 = Date.now(); tickDecoratedPotSlice(t); slices.push(Date.now() - t0); }
    const avgSlice = slices.reduce((a, b) => a + b, 0) / slices.length;
    log(`vase_bench ${n} vasos (${reps} rep.): antes(emulado)=${legacyMs.toFixed(2)} ms/passe; agora passe completo=${fullMs.toFixed(2)} ms; ` +
      `fatia por tick média=${avgSlice.toFixed(2)} ms máx=${Math.max(...slices)} ms; stats Δ visitados=${potTickStats.visited - before.visited} ` +
      `vizinhos=${potTickStats.neighborReads - before.neighborReads} buscas_por_posição=${potTickStats.entityQueries - before.entityQueries}`);
  });
  addProbeCommand("vase_bench_clear", args => {
    const n = Math.max(1, Math.min(1000, Number(args[0]) || 200));
    const x0 = Number(args[1]) || 0, y = Number(args[2]) || 100, z0 = Number(args[3]) || 0;
    const dim = overworld();
    for (let i = 0; i < n; i++) {
      const loc = { x: x0 + (i % 20) * 2, y, z: z0 + Math.floor(i / 20) * 2 };
      onPotBrokenByPlayer(true, dim, loc, undefined);
      dim.getBlock(loc)?.setType("minecraft:air");
    }
    log(`vase_bench_clear: ${n}`);
  });
  addProbeCommand("rs_bench", args => {
    const loc = parseLoc(args);
    const block = loc && overworld().getBlock(loc);
    if (!block) return log("uso: rs_bench <x> <y> <z> [repetições]");
    const reps = Math.max(1, Number(args[3]) || 1000);
    const dim = overworld();
    // Leitor de antes: getAllStates + getRedstonePower em todo bloco lido.
    const legacyReader = (pos: { x: number; y: number; z: number }) => {
      try {
        const b = dim.getBlock(pos);
        if (!b) return undefined;
        if (b.isAir) return { id: "minecraft:air", states: {} };
        let power: number | undefined;
        try { power = b.getRedstonePower(); } catch { power = undefined; }
        return { id: b.typeId, states: b.permutation.getAllStates(), power };
      }
      catch { return undefined; }
    };
    const time = (fn: () => void) => { const t0 = Date.now(); for (let r = 0; r < reps; r++) fn(); return (Date.now() - t0) * 1000 / reps; };
    const l = block.location;
    const vol = (r: number) => new BlockVolume({ x: l.x - r, y: l.y - r, z: l.z - r }, { x: l.x + r, y: l.y + r, z: l.z + r });
    const few = ["minecraft:redstone_wire", "minecraft:redstone_block", "minecraft:lever"];
    // Ids de redstone (fixos + todos os botões e placas): o pré-filtro medido e descartado.
    const many = [...few, "minecraft:powered_repeater", "minecraft:powered_comparator", "minecraft:redstone_torch", "minecraft:observer",
      "minecraft:tripwire_hook", "minecraft:lectern", "minecraft:lightning_rod", "minecraft:detector_rail", "minecraft:daylight_detector",
      "minecraft:daylight_detector_inverted", "minecraft:target", "minecraft:trapped_chest", "minecraft:sculk_sensor", "minecraft:calibrated_sculk_sensor"];
    for (const t of BlockTypes.getAll()) if (t.id.endsWith("_button") || t.id.endsWith("_pressure_plate")) many.push(t.id);
    const legacyUs = time(() => hasNeighborSignal(l, legacyReader));
    const nowUs = time(() => hasNeighborSignal(l, dimensionReader(dim)));
    const near5 = time(() => dim.containsBlock(vol(2), { includeTypes: many }, true));
    const near3 = time(() => dim.containsBlock(vol(1), { includeTypes: many }, true));
    const near5few = time(() => dim.containsBlock(vol(2), { includeTypes: few }, true));
    log(`rs_bench ${reps}×: hasNeighborSignal antes=${legacyUs.toFixed(1)} µs agora=${nowUs.toFixed(1)} µs | containsBlock 5³×${many.length} tipos=${near5.toFixed(1)} µs ` +
      `3³×${many.length}=${near3.toFixed(1)} µs 5³×3=${near5few.toFixed(1)} µs (sinal=${potNeighborSignal(block)})`);
  });
  addProbeCommand("api_bench", args => {
    const loc = parseLoc(args);
    const dim = overworld();
    const block = loc && dim.getBlock(loc);
    if (!block) return log("uso: api_bench <x> <y> <z> [repetições]");
    const reps = Math.max(1, Number(args[3]) || 3000);
    const time = (fn: () => void) => { const t0 = Date.now(); for (let r = 0; r < reps; r++) fn(); return (Date.now() - t0) * 1000 / reps; };
    const at = DIRS6.map(d => offset(loc, d));
    const blocks = at.map(p => dim.getBlock(p)!);
    const getBlock = time(() => { for (const p of at) dim.getBlock(p); });
    const rel = time(() => { block.north(); block.south(); block.east(); block.west(); block.above(); block.below(); });
    const states = time(() => { for (const b of blocks) b.permutation.getAllStates(); });
    const power = time(() => { for (const b of blocks) { try { b.getRedstonePower(); } catch { /* sem */ } } });
    const typeId = time(() => { for (const b of blocks) void b.typeId; });
    log(`api_bench ${reps}× (6 vizinhos): getBlock=${getBlock.toFixed(1)} µs, north()/...=${rel.toFixed(1)} µs, typeId=${typeId.toFixed(1)} µs, getAllStates=${states.toFixed(1)} µs, getRedstonePower=${power.toFixed(1)} µs`);
  });
  addProbeCommand("dispensers", () => {
    log(`dispensers registrados: ${dispenserStore.keys().join(" ") || "nenhum"}`);
  });
}

export function startAdaptacoes() {
  if (started) return;
  started = true;
  safe("sonda", () => { registerAdaptacoesProbe(); registerProbeCommands(); });
  safe("panela (funil/comparador)", startPotHoppers);
  safe("panela (tampa por redstone)", startPotRedstone);
  safe("abelhas", startBees);
  safe("dispenser", startDispensers);
  safe("vaso decorado", startDecoratedPots);
  safe("mental_restoration", startMentalRestoration);
}
