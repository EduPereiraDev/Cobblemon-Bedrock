/**
 * Sonda da frente visual-final (só pelo console, com `scriptevent cobblemon:debug_probes on`):
 *
 *   scriptevent cobblemon:debug_visual_final <nosepass|aspects|healing> [x z]
 *   scriptevent cobblemon:debug_visual_final loot <x> <z> <bloco [estados]>   (controle de loot por permutação)
 *   scriptevent cobblemon:debug_visual_final tint [x z]   (fechamento: tinta do feixe, cobblemon:beam_tint)
 *
 * - nosepass: cria um Nosepass e, 3 s depois, mostra o yaw dele e o yaw até o spawn do mundo.
 * - aspects: cria um Combee com `honey_drenched` + `poke_snack_crumbed` e roda 50 passes (100 ticks) de partículas.
 * - healing: coloca uma Healing Machine natural e uma comum, quebra as duas e conta os drops.
 * - tint: cria Pokémon (um com 11 propriedades: roll + aspects), liga e desliga a tinta do feixe por setBeamTint e
 *   lê a propriedade de volta (a cor em si é do cliente; o BDS não carrega o RP).
 *
 * Sem jogador o chunk pode não carregar: crie antes um `tickingarea` no ponto.
 */
import { Dimension, Entity, ScriptEventSource, Vector3, system, world } from "@minecraft/server";
import { debugProbesEnabled } from "../Config";
import { PokemonData } from "../Pokemon";
import { aspectParticlePass } from "./AspectParticles";
import { spawnLookTarget } from "./PointToSpawn";
import { BEAM_TINT_PROPERTY, setBeamTint } from "../pokemon/BeamTint";

function groundAt(dimension: Dimension, x: number, z: number): Vector3 {
  let y = 80;
  try { y = (dimension.getTopmostBlock({ x, z })?.location.y ?? 79) + 1; } catch { }
  return { x: x + 0.5, y, z: z + 0.5 };
}

function yawTo(from: Vector3, to: Vector3): number {
  return (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
}

function nosepass(dimension: Dimension, at: Vector3) {
  const entity = dimension.spawnEntity("cobblemon:nosepass", at);
  const spawn = world.getDefaultSpawnLocation();
  system.runTimeout(() => {
    if (!entity.isValid) { console.warn("debug_visual_final nosepass: entidade sumiu"); return; }
    const target = spawnLookTarget(spawn, entity.getHeadLocation().y);
    const expected = yawTo(entity.location, target);
    const yaw = entity.getRotation().y;
    const diff = Math.abs(((yaw - expected + 540) % 360) - 180);
    console.warn(`debug_visual_final nosepass: spawn=(${spawn.x},${spawn.z}) yaw=${yaw.toFixed(1)} esperado=${expected.toFixed(1)} diferença=${diff.toFixed(1)}°`);
    try { entity.remove(); } catch { }
  }, 60);
}

function aspects(dimension: Dimension, at: Vector3) {
  const entity: Entity = dimension.spawnEntity("cobblemon:combee", at);
  system.runTimeout(() => {
    if (!entity.isValid) { console.warn("debug_visual_final aspects: entidade sumiu"); return; }
    const data = PokemonData.getFromEntity(entity);
    for (const aspect of ["honey_drenched", "poke_snack_crumbed"]) if (!data.aspects.includes(aspect)) data.aspects.push(aspect);
    data.applyToCobblemon(entity);
    let total = 0;
    let passes = 0;
    const run = system.runInterval(() => {
      total += aspectParticlePass(dimension, entity.location);
      if (++passes >= 50) {
        system.clearRun(run);
        console.warn(`debug_visual_final aspects: ${passes} passes (100 ticks), ${total} partículas (esperado ~22: mel 0,075×1 + migalhas 0,05×3 por tick)`);
        try { entity.remove(); } catch { }
      }
    }, 2);
  }, 20);
}

function healing(dimension: Dimension, at: Vector3, blocks?: string[]) {
  const list = blocks ?? ['cobblemon:healing_machine ["cobblemon:natural"=true]', 'cobblemon:healing_machine ["cobblemon:natural"=false]'];
  const spots = list.map((block, i) => ({ block, natural: block.includes("natural\"=true"), x: Math.floor(at.x) + 4 * i }));
  const y = Math.floor(at.y), z = Math.floor(at.z);
  for (const spot of spots) {
    dimension.runCommand(`setblock ${spot.x} ${y} ${z} ${spot.block}`);
    let state: unknown;
    try { state = dimension.getBlock({ x: spot.x, y, z })?.permutation.getState("cobblemon:natural" as never); } catch (e) { state = `${e}`; }
    dimension.runCommand(`setblock ${spot.x} ${y} ${z} air destroy`);
    system.runTimeout(() => {
      const items = dimension.getEntities({ type: "minecraft:item", location: { x: spot.x + 0.5, y: y + 0.5, z: z + 0.5 }, maxDistance: 2 });
      const drops = items.map(i => { try { const s = i.getComponent("minecraft:item")?.itemStack; return `${s?.typeId}×${s?.amount}`; } catch { return "?"; } });
      console.warn(`debug_visual_final healing: ${spot.block} natural=${String(state)} drops=[${drops.join(", ")}]`);
      for (const i of items) { try { i.remove(); } catch { } }
    }, 10);
  }
}

function tint(dimension: Dimension, at: Vector3) {
  const species = ["bulbasaur", "rattata", "aerodactyl"];
  const entities = species.map((id, i) => dimension.spawnEntity(`cobblemon:${id}`, { x: at.x + 3 * i, y: at.y, z: at.z }));
  system.runTimeout(() => {
    for (const [i, entity] of entities.entries()) {
      if (!entity.isValid) { console.warn(`debug_visual_final tint: ${species[i]} sumiu`); continue; }
      // setProperty vale no fim do tick: cada leitura é no tick seguinte. O último caso liga e desliga no mesmo tick.
      const before = entity.getProperty(BEAM_TINT_PROPERTY);
      const on = setBeamTint(entity, true);
      system.runTimeout(() => {
        const during = entity.getProperty(BEAM_TINT_PROPERTY);
        const off = setBeamTint(entity, false);
        system.runTimeout(() => {
          const after = entity.getProperty(BEAM_TINT_PROPERTY);
          setBeamTint(entity, true);
          setBeamTint(entity, false);
          system.runTimeout(() => {
            const sameTick = entity.getProperty(BEAM_TINT_PROPERTY);
            console.warn(`debug_visual_final tint: ${species[i]} antes=${String(before)} liga=${on}→${String(during)} desliga=${off}→${String(after)} liga+desliga no mesmo tick→${String(sameTick)}`);
            try { entity.remove(); } catch { }
          }, 2);
        }, 2);
      }, 2);
    }
  }, 20);
}

let registered = false;

export function registerVisualFinalDebug() {
  if (registered) return;
  registered = true;
  try {
    system.afterEvents.scriptEventReceive.subscribe(event => {
      if (event.id !== "cobblemon:debug_visual_final" || event.sourceType !== ScriptEventSource.Server || !debugProbesEnabled()) return;
      const [kind = "nosepass", x = "0", z = "0"] = event.message.trim().split(/\s+/);
      const dimension = world.getDimension("overworld");
      try {
        const at = groundAt(dimension, Number(x), Number(z));
        if (kind === "nosepass") nosepass(dimension, at);
        else if (kind === "aspects") aspects(dimension, at);
        else if (kind === "healing") healing(dimension, at);
        else if (kind === "tint") tint(dimension, at);
        // Controle: outro bloco com loot por permutação (`loot <x> <z> <bloco e estados>`).
        else if (kind === "loot") healing(dimension, at, [event.message.trim().split(/\s+/).slice(3).join(" ")]);
        else console.warn(`debug_visual_final: tipo desconhecido ${kind}`);
      }
      catch (e) { console.warn(`debug_visual_final ${kind}: ${e}`); }
    });
  }
  catch { }
}
