/**
 * Sonda de console da frente dados-ia (conferência no BDS sem cliente). Só com `scriptevent cobblemon:debug_probes on`
 * e só do console do servidor; saída em console.info.
 *   scriptevent cobblemon:dadosia_spawn <espécie> [aspect,aspect...] [alpha]
 *       Pokémon selvagem no spawn: aspects (com os padrões das species features), cobblemon:aspects, variante.
 *   scriptevent cobblemon:dadosia_events
 *       No último Pokémon da sonda: Alfa (alpha_ai), pasto (pasture_conflict), batalha (in_battle) e volta.
 *   scriptevent cobblemon:dadosia_attack [espécie]
 *       "Ataca mobs hostis" pela IA: Pokémon com o grupo cobblemon:pasture_conflict ligado e um husk a 4 blocos;
 *       vida do husk depois de 10 s.
 *   scriptevent cobblemon:dadosia_npc
 *       NPC novo: isMovable/isLeashable/allowProjectileHits desligados e religados (guia e propriedade).
 *   scriptevent cobblemon:dadosia_leash
 *       review-fixes: NPC preso a uma vaca pela guia; dispara cobblemon:npc_set_leashable cru (readiciona
 *       minecraft:leashable) e depois applyNpcFlags repetido; mostra se a guia continua (isLeashed), com um par de
 *       controle sem evento.
 *   scriptevent cobblemon:dadosia_nosepass [dx dz] [lento]
 *       review-fixes: Nosepass selvagem perto do spawn; yaw, diferença para o spawn e se anda, a cada 10 ticks.
 */
import { Entity, ScriptEventSource, system, world } from "@minecraft/server";
import { debugProbesEnabled } from "../Config";
import { PokemonData } from "../Pokemon";
import { spawnWildPokemon } from "../machines/common";
import { applyNpcFlags } from "../npc/NpcFlags";
import { ASPECTS_PROPERTY } from "../../generated/scripts/dadosIa";

function log(msg: string) {
  console.info(`[dados-ia] ${msg}`);
}

let last: Entity | undefined;

function spawnPoint() {
  const spawn = world.getDefaultSpawnLocation();
  const dim = world.getDimension("overworld");
  const top = dim.getTopmostBlock({ x: spawn.x, z: spawn.z });
  return { dim, loc: { x: spawn.x + 3.5, y: (top?.y ?? 64) + 1, z: spawn.z + 0.5 } };
}

function probeSpawn(args: string[]) {
  const [species = "mareep", aspectsText = "", alpha] = args;
  const extra = aspectsText ? aspectsText.split(",").filter(Boolean) : [];
  const data = PokemonData.generateNewWildPokemon(species, { level: 20, aspects: alpha === "alpha" ? [...extra, "alpha"] : extra });
  const { dim, loc } = spawnPoint();
  const entity = spawnWildPokemon(dim, loc, data);
  if (!entity) return log(`spawn ${species}: falhou`);
  last = entity;
  system.runTimeout(() => {
    if (!entity.isValid) return;
    log(`spawn ${entity.typeId} aspects=[${data.aspects.join(",")}] ${ASPECTS_PROPERTY}=${entity.getProperty(ASPECTS_PROPERTY)} variant=${entity.getProperty("cobblemon:variant")} alpha=${entity.getProperty("cobblemon:alpha")} wild=${entity.getProperty("cobblemon:wild")}`);
  }, 5);
}

function probeEvents() {
  const e = last;
  if (!e?.isValid) return log("events: sem Pokémon da sonda (use dadosia_spawn)");
  const state = () => `alpha=${e.getProperty("cobblemon:alpha")} pasture_conflict=${e.getProperty("cobblemon:pasture_conflict")} in_battle=${e.getProperty("cobblemon:in_battle")}`;
  const steps: Array<[string, string]> = [
    ["cobblemon:set_alpha", "Alfa"],
    ["cobblemon:enable_pasture_conflict", "pasto liga"],
    ["cobblemon:battle_start", "batalha começa (tira IA e zera o pasto)"],
    ["cobblemon:battle_end", "batalha termina (IA e Alfa de volta)"],
    ["cobblemon:disable_pasture_conflict", "pasto desliga"],
    ["cobblemon:unset_alpha", "tira Alfa"],
  ];
  steps.forEach(([ev, label], i) => system.runTimeout(() => {
    if (!e.isValid) return;
    e.triggerEvent(ev);
    system.runTimeout(() => { if (e.isValid) log(`events ${label}: ${state()}`); }, 2);
  }, 5 * (i + 1)));
}

function probeNpc() {
  const { dim, loc } = spawnPoint();
  const npc = dim.spawnEntity("cobblemon:npc" as never, { ...loc, x: loc.x + 3 });
  const leash = () => !!npc.getComponent("minecraft:leashable");
  system.runTimeout(() => {
    if (!npc.isValid) return;
    const before = `leashable=${leash()} projectile_hits=${npc.getProperty("cobblemon:projectile_hits")}`;
    applyNpcFlags(npc, { movable: false, leashable: false, projectileHits: false });
    system.runTimeout(() => {
      if (!npc.isValid) return;
      const off = `leashable=${leash()} projectile_hits=${npc.getProperty("cobblemon:projectile_hits")}`;
      applyNpcFlags(npc, { movable: true, leashable: true, projectileHits: true });
      system.runTimeout(() => {
        if (!npc.isValid) return;
        log(`npc: nasce ${before}; desligado ${off}; religado leashable=${leash()} projectile_hits=${npc.getProperty("cobblemon:projectile_hits")}`);
        npc.remove();
      }, 2);
    }, 2);
  }, 5);
}

function probeLeash() {
  const { dim, loc } = spawnPoint();
  // Dois pares NPC + vaca presos pela guia: controle (nada) e teste (applyNpcFlags x2 e o evento cru).
  const pair = (dz: number) => ({
    npc: dim.spawnEntity("cobblemon:npc" as never, { ...loc, x: loc.x + 6, z: loc.z + dz }),
    holder: dim.spawnEntity("minecraft:cow" as never, { ...loc, x: loc.x + 8, z: loc.z + dz }),
  });
  const control = pair(-3), probe = pair(3);
  const leashed = ({ npc, holder }: { npc: Entity; holder: Entity }) => {
    try {
      const c = npc.getComponent("minecraft:leashable");
      return c ? `${c.isLeashed}${c.leashHolder?.id === holder.id ? "(vaca)" : ""}` : "sem-componente";
    }
    catch (e) { return `erro ${e}`; }
  };
  const steps: string[] = [];
  const state = (label: string) => steps.push(`${label} controle=${leashed(control)} teste=${leashed(probe)}`);
  const done = () => {
    log(`leash: ${steps.join(" | ")}`);
    for (const e of [control.npc, control.holder, probe.npc, probe.holder]) {
      try { if (e.isValid) e.remove(); } catch { }
    }
  };
  system.runTimeout(() => {
    for (const p of [control, probe]) {
      try { p.npc.getComponent("minecraft:leashable")?.leashTo(p.holder); }
      catch (e) { steps.push(`leashTo falhou ${e}`); }
    }
    system.runTimeout(() => {
      state("preso");
      // 1) applyNpcFlags repetido (idempotente: não deve disparar o evento de novo).
      applyNpcFlags(probe.npc, { movable: true, leashable: true, projectileHits: true });
      applyNpcFlags(probe.npc, { movable: true, leashable: true, projectileHits: true });
      system.runTimeout(() => {
        state("após applyNpcFlags x2");
        // 2) evento cru (o comportamento antigo a cada onLoad): readiciona o grupo com minecraft:leashable.
        try { probe.npc.triggerEvent("cobblemon:npc_set_leashable"); } catch (e) { steps.push(`evento falhou ${e}`); }
        system.runTimeout(() => {
          state("após npc_set_leashable cru");
          system.runTimeout(() => {
            state("2 s depois");
            done();
          }, 40);
        }, 5);
      }, 5);
    }, 5);
  }, 5);
}

/**
 * review-fixes: Nosepass selvagem perto do spawn; yaw a cada 10 ticks por 6 s, a diferença para o yaw até o centro do
 * bloco do spawn e se está andando. Parado, com um só mecanismo, o yaw fica no alvo (sem tremer).
 */
function probeNosepass(args: string[]) {
  const spawn = world.getDefaultSpawnLocation();
  const dim = world.getDimension("overworld");
  const dx = Number(args[0] ?? 2), dz = Number(args[1] ?? 1);
  const top = dim.getTopmostBlock({ x: spawn.x + dx, z: spawn.z + dz });
  const data = PokemonData.generateNewWildPokemon("nosepass", { level: 20 });
  const entity = spawnWildPokemon(dim, { x: spawn.x + dx + 0.5, y: (top?.y ?? 64) + 1, z: spawn.z + dz + 0.5 }, data);
  if (!entity) return log("nosepass: falhou");
  // "lento": lentidão máxima (a navegação do random_stroll ainda gira o corpo para o nó do caminho).
  if (args[2] === "lento") {
    try { entity.addEffect("slowness", 400, { amplifier: 255, showParticles: false }); } catch { }
  }
  const samples: string[] = [];
  for (let i = 1; i <= 12; i++) {
    system.runTimeout(() => {
      if (!entity.isValid) return;
      const l = entity.location;
      const tx = Math.floor(spawn.x) + 0.5, tz = Math.floor(spawn.z) + 0.5;
      const expected = (Math.atan2(-(tx - l.x), tz - l.z) * 180) / Math.PI;
      const yaw = entity.getRotation().y;
      const diff = Math.abs(((yaw - expected + 540) % 360) - 180);
      const v = entity.getVelocity();
      samples.push(`${yaw.toFixed(1)}/${diff.toFixed(1)}°${Math.hypot(v.x, v.z) >= 0.02 ? "(andando)" : ""}`);
      if (i === 12) {
        log(`nosepass perto do spawn (${dx},${dz}) init=${entity.getProperty("cobblemon:initialized")} yaw/diferença: ${samples.join(" ")}`);
        try { entity.remove(); } catch { }
      }
    }, 40 + i * 10);
  }
}

let attackRun = 0;
function probeAttack(args: string[]) {
  const [species = "machop", mode = "on"] = args;
  const data = PokemonData.generateNewWildPokemon(species, { level: 30 });
  const { dim, loc } = spawnPoint();
  // Cada rodada em outro ponto (sem o Pokémon de uma rodada atacar o husk da outra).
  const base = { ...loc, x: loc.x - 12 + 8 * (attackRun++ % 4), z: loc.z + 6 };
  const pokemon = spawnWildPokemon(dim, base, data);
  if (!pokemon) return log(`attack ${species}: falhou`);
  const husk = dim.spawnEntity("minecraft:husk" as never, { ...base, x: base.x + 4 });
  const hp = (e: Entity) => (e.isValid ? Math.round(e.getComponent("minecraft:health")?.currentValue ?? -1) : "x");
  const trace: string[] = [];
  system.runTimeout(() => {
    if (!pokemon.isValid) return;
    // "off" = controle: mesmo cenário sem o grupo de ataque.
    if (mode !== "off") pokemon.triggerEvent("cobblemon:enable_pasture_conflict");
  }, 5);
  for (let t = 1; t <= 5; t++) {
    system.runTimeout(() => {
      trace.push(`${t * 2}s husk=${hp(husk)} pk=${hp(pokemon)} conflito=${pokemon.isValid && pokemon.getProperty("cobblemon:pasture_conflict")}`);
      if (t === 5) {
        log(`attack ${species} ${mode}: ${trace.join(" | ")}`);
        try { if (husk.isValid) husk.remove(); } catch { }
        try { if (pokemon.isValid) pokemon.remove(); } catch { }
      }
    }, 5 + t * 40);
  }
}

export function registerDadosIaProbe() {
  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (!event.id.startsWith("cobblemon:dadosia_") || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
    const args = event.message.trim().split(/\s+/).filter(Boolean);
    try {
      if (event.id === "cobblemon:dadosia_spawn") probeSpawn(args);
      else if (event.id === "cobblemon:dadosia_events") probeEvents();
      else if (event.id === "cobblemon:dadosia_npc") probeNpc();
      else if (event.id === "cobblemon:dadosia_leash") probeLeash();
      else if (event.id === "cobblemon:dadosia_nosepass") probeNosepass(args);
      else if (event.id === "cobblemon:dadosia_attack") probeAttack(args);
    }
    catch (e) {
      log(`${event.id} falhou: ${e}`);
    }
  });
}
