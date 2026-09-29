/**
 * Sondas da pesquisa 8 (docs/pesquisa/8-limites-bedrock.md). Os protótipos da frente limites-a viraram código de
 * produção, ligado por padrão:
 *  - NPC com modelo de Pokémon: scripts/npc/PokemonModel.ts (resourceIdentifier de espécie);
 *  - NPC escondido por jogador: scripts/npc/NpcHide.ts (dados MoLang `hide`);
 *  - sprint na terra, freelook e roll da câmera: scripts/entity/Riding.ts (+ RideSprint.ts, RideCameraRoll.ts);
 *  - aranhas imunes à teia e Pokédex na estante: gerados pelo importador (entities.ts, items.ts).
 * Aqui sobraram só as sondas de verificação (BDS/E2E), que respondem apenas com as sondas de depuração ligadas
 * (`/scriptevent cobblemon:debug_probes on`, pelo console):
 *
 *   /execute as <npc> run scriptevent cblimits:npc_model_info
 *   /execute as <npc> run scriptevent cblimits:npc_hide <jogador> <on|off>   (grava o `hide` dos dados MoLang)
 *   /execute as <npc> run scriptevent cblimits:npc_hide_info
 *   /scriptevent cblimits:input_probe <on|off>          (entrada e sprint de quem está montado, a cada 5 ticks)
 *   /scriptevent cblimits:ride_probe <on|off>           (montaria: botões, eventos ride_*, veículo, chão e vy por tick)
 *   /execute as <entidade> run scriptevent cblimits:entity_info [rótulo]   (vida, cavaleiros, dono)
 *   /scriptevent cblimits:ride_camera_info              (como jogador: modo de câmera, freelook, esquema)
 *   /scriptevent cblimits:camera_roll_test [graus]      (como jogador: spline parada com roll)
 *   /scriptevent cblimits:web_fall <x> <y> <z> <tipo...> (mede a queda de cada tipo numa coluna de 10 teias)
 *   /scriptevent cblimits:item_tags <item...>           (tags que o motor registrou no item, ex.: minecraft:bookshelf_books)
 */
import {
  Dimension, Entity, EntityHealthComponent, InputButton, ItemStack, Player, ScriptEventCommandMessageAfterEvent, Vector3, system, world,
} from "@minecraft/server";
import { debugProbesEnabled } from "../../Config";
import { getMountedPokemon, getRideStyle, rideCameraSnapshot, rideSprintSnapshot } from "../../entity/Riding";
import { cameraRollTest } from "../../entity/RideCameraRoll";
import { NPC_ENTITY_ID, isNPCEntity } from "../../npc/NPCEntity";
import { describeNpcModel } from "../../npc/PokemonModel";
import { describeNpcHide, setHiddenFor } from "../../npc/NpcHide";

export const LIMITS_NAMESPACE = "cblimits:";
let inputProbe: number | undefined;

function findPlayer(name: string): Player | undefined {
  return world.getAllPlayers().find(p => p.name.toLowerCase() === name.toLowerCase());
}

/** NPC de origem do comando ou o mais próximo (até 8 blocos). */
function nearestNpc(source: Entity | undefined): Entity | undefined {
  if (!source) return undefined;
  if (isNPCEntity(source)) return source;
  try { return source.dimension.getEntities({ type: NPC_ENTITY_ID, location: source.location, maxDistance: 8, closest: 1 })[0]; }
  catch { return undefined; }
}

/**
 * Sonda da montaria (docs/pendencias/montaria-pulo.md): botões (playerButtonInput, os dois estados), eventos
 * cobblemon:ride_* / on_mount / on_dismount, trocas de veículo e, a cada tick, estilo, chão e velocidade y.
 */
let rideProbe: { interval: number; unsubscribe: () => void } | undefined;
const lastVehicle = new Map<string, string>();

function setRideProbe(on: boolean) {
  if (rideProbe) { system.clearRun(rideProbe.interval); rideProbe.unsubscribe(); }
  rideProbe = undefined;
  lastVehicle.clear();
  if (!on) return;
  const vehicleOf = (player: Player) => {
    try { return player.getComponent("minecraft:riding")?.entityRidingOn; } catch { return undefined; }
  };
  const buttons = world.afterEvents.playerButtonInput.subscribe(({ player, button, newButtonState }) => {
    const v = vehicleOf(player);
    console.info(`[limites] botao tick=${system.currentTick} ${player.name} ${button} ${newButtonState} veiculo=${v?.typeId ?? "-"} estilo=${getRideStyle(player) ?? "-"}`);
  });
  const triggers = world.afterEvents.dataDrivenEntityTrigger.subscribe(({ entity, eventId }) => {
    if (!/^cobblemon:(ride_|on_mount|on_dismount)/.test(eventId)) return;
    let riders = -1;
    try { riders = entity.getComponent("minecraft:rideable")?.getRiders().length ?? -1; } catch { }
    console.info(`[limites] evento tick=${system.currentTick} ${entity.typeId} ${eventId} cavaleiros=${riders}`);
  });
  const interval = system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      const v = vehicleOf(player);
      const now = v ? `${v.typeId}#${v.id}` : "-";
      const before = lastVehicle.get(player.id) ?? "-";
      if (now !== before) console.info(`[limites] veiculo tick=${system.currentTick} ${player.name} ${before} -> ${now}`);
      lastVehicle.set(player.id, now);
      if (!v) continue;
      try {
        const vel = v.getVelocity();
        let jump = "-";
        try { jump = String(player.inputInfo.getButtonState(InputButton.Jump)); } catch { }
        console.info(`[limites] ride tick=${system.currentTick} ${player.name} estilo=${getRideStyle(player) ?? "-"} chao=${v.isOnGround} ` +
          `x=${v.location.x.toFixed(2)} y=${v.location.y.toFixed(3)} z=${v.location.z.toFixed(2)} vy=${vel.y.toFixed(3)} agua=${v.isInWater} pulo=${jump} ` +
          `power_jump=${v.hasComponent("minecraft:can_power_jump")}`);
      }
      catch (e) { console.warn(`[limites] ride: ${e}`); }
    }
  }, 1);
  rideProbe = {
    interval,
    unsubscribe: () => {
      world.afterEvents.playerButtonInput.unsubscribe(buttons);
      world.afterEvents.dataDrivenEntityTrigger.unsubscribe(triggers);
    },
  };
}

/** Vida e cavaleiros da entidade de origem (`execute as <entidade> run scriptevent cblimits:entity_info <rótulo>`). */
function entityInfo(entity: Entity, label: string) {
  let health = "-";
  try {
    const h = entity.getComponent("minecraft:health") as EntityHealthComponent | undefined;
    if (h) health = `${h.currentValue}/${h.effectiveMax}`;
  }
  catch { }
  let riders = "-";
  try { riders = String(entity.getComponent("minecraft:rideable")?.getRiders().map(r => r.typeId).join(",") ?? "-"); } catch { }
  console.info(`[limites] entity_info ${label} ${entity.typeId} vida=${health} cavaleiros=[${riders}] dono=${String(entity.getDynamicProperty("owner_name") ?? "-")} ` +
    `selvagem=${String(entity.getProperty("cobblemon:wild"))}`);
}

function setInputProbe(on: boolean) {
  if (inputProbe !== undefined) system.clearRun(inputProbe);
  inputProbe = undefined;
  if (!on) return;
  inputProbe = system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
      try {
        const mount = getMountedPokemon(player);
        if (!mount) continue;
        const v = player.inputInfo.getMovementVector();
        const snap = rideSprintSnapshot(player);
        let movement = "-";
        try { movement = String((mount.getComponent("minecraft:movement") as { currentValue?: number } | undefined)?.currentValue?.toFixed(3)); } catch { }
        const at = mount.location;
        console.info(`[limites] input ${player.name} montado=${mount.typeId} estilo=${getRideStyle(player) ?? "-"} pos=(${at.x.toFixed(2)},${at.z.toFixed(2)}) ` +
          `move=(${v.x.toFixed(2)},${v.y.toFixed(2)}) isSprinting=${player.isSprinting} modo=${player.inputInfo.lastInputModeUsed} movement=${movement}` +
          (snap ? ` sprint=${snap.sprinting} folego=${snap.stamina.toFixed(3)} vel=${snap.speed.toFixed(3)} andar=${snap.walk} topo=${snap.top}` : " sem_sprint"));
      }
      catch (e) { console.warn(`[limites] input: ${e}`); }
    }
  }, 5);
}

/** Queda de cada tipo numa coluna 3×3 de 10 teias fechada por vidro (a entidade não sai andando). */
function webFall(dimension: Dimension, origin: Vector3, types: string[]) {
  const HEIGHT = 10;
  const spawned: { entity: Entity; type: string; startY: number }[] = [];
  types.forEach((type, i) => {
    const x = Math.floor(origin.x) + i * 6, z = Math.floor(origin.z), y0 = Math.floor(origin.y);
    try {
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        dimension.setBlockType({ x: x + dx, y: y0 - 1, z: z + dz }, "minecraft:stone");
        for (let dy = 0; dy < HEIGHT + 3; dy++) {
          const inner = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
          dimension.setBlockType({ x: x + dx, y: y0 + dy, z: z + dz }, inner ? (dy < HEIGHT ? "minecraft:web" : "minecraft:air") : "minecraft:glass");
        }
      }
      const entity = dimension.spawnEntity(type, { x: x + 0.5, y: y0 + HEIGHT + 0.2, z: z + 0.5 });
      spawned.push({ entity, type, startY: entity.location.y });
    }
    catch (e) { console.warn(`[limites] web_fall ${type}: ${e}`); }
  });
  for (const t of [20, 60]) {
    system.runTimeout(() => {
      const parts = spawned.map(s => {
        try { return `${s.type}: caiu ${(s.startY - s.entity.location.y).toFixed(2)}`; } catch { return `${s.type}: inválida`; }
      });
      console.info(`[limites] web_fall t=${t} ticks: ${parts.join(" | ")}`);
      if (t === 60) for (const s of spawned) try { s.entity.remove(); } catch { }
    }, t);
  }
}

export function handleLimitsEvent(id: string, message: string, source: Entity | undefined) {
  if (!debugProbesEnabled()) return;
  const args = message.trim().split(/\s+/).filter(Boolean);
  const cmd = id.slice(LIMITS_NAMESPACE.length);
  switch (cmd) {
    case "npc_model_info": {
      const npc = nearestNpc(source);
      console.info(`[limites] npc_model_info ${npc ? describeNpcModel(npc) : "sem NPC"}`);
      return;
    }
    case "npc_hide": {
      const npc = nearestNpc(source);
      const player = args[0] ? findPlayer(args[0]) : undefined;
      if (!npc || !player) { console.warn("[limites] npc_hide: use execute as <npc> ... <jogador> on|off"); return; }
      setHiddenFor(npc, player, args[1] !== "off");
      console.info(`[limites] npc_hide ${player.name} ${args[1] !== "off" ? "on" : "off"} npc=${npc.id}`);
      return;
    }
    case "npc_hide_info": {
      const npc = nearestNpc(source);
      console.info(`[limites] npc_hide_info ${npc ? describeNpcHide(npc) : "sem NPC"}`);
      return;
    }
    case "input_probe":
      setInputProbe(args[0] !== "off");
      return;
    case "ride_probe":
      setRideProbe(args[0] !== "off");
      console.info(`[limites] ride_probe ${args[0] !== "off" ? "on" : "off"}`);
      return;
    case "entity_info":
      if (source) entityInfo(source, args[0] ?? "-");
      return;
    case "ride_camera_info":
      if (source instanceof Player) {
        let scheme = "-";
        try { scheme = String(source.getControlScheme()); } catch { }
        console.info(`[limites] ride_camera_info ${source.name} ${JSON.stringify(rideCameraSnapshot(source) ?? null)} esquema=${scheme} ` +
          `preferência=${String(source.getDynamicProperty("cobblemon:ride_camera"))}`);
      }
      return;
    case "camera_roll_test":
      if (source instanceof Player) {
        cameraRollTest(source, Number(args[0] ?? 30) || 30);
        console.info(`[limites] camera_roll_test ${source.name}: spline enviada (roll ±${Number(args[0] ?? 30) || 30}°)`);
      }
      return;
    case "web_fall": {
      const [x, y, z] = args.slice(0, 3).map(Number);
      const types = args.slice(3);
      if ([x, y, z].some(v => !Number.isFinite(v)) || !types.length) { console.warn("[limites] web_fall <x> <y> <z> <tipo...>"); return; }
      webFall(source?.dimension ?? world.getDimension("overworld"), { x, y, z }, types);
      return;
    }
    case "item_tags":
      for (const item of args) {
        try { console.info(`[limites] item_tags ${item}: ${new ItemStack(item).getTags().join(", ") || "-"}`); }
        catch (e) { console.warn(`[limites] item_tags ${item}: ${e}`); }
      }
      return;
    default:
      console.warn(`[limites] sonda desconhecida ${id}`);
  }
}

let registered = false;

/** Chamar uma vez no carregamento (main.ts). Só escuta `cblimits:*`; nada responde sem as sondas de depuração. */
export function registerLimitPrototypes() {
  if (registered) return;
  registered = true;
  system.afterEvents.scriptEventReceive.subscribe((event: ScriptEventCommandMessageAfterEvent) => {
    if (!event.id.startsWith(LIMITS_NAMESPACE)) return;
    try { handleLimitsEvent(event.id, event.message, event.sourceEntity); }
    catch (e) { console.warn(`[limites] ${event.id}: ${e}`); }
  });
}
