/**
 * Sons de montaria do Cobblemon 1.8.2 (`species.riding.behaviours.<estilo>.rideSounds`, RideSoundSettings e o
 * RideSoundManager do cliente): loops `cobblemon.ride.loop.*` com volume e tom por expressão MoLang
 * (`q.ride_velocity()`, `q.driver_input()`), a versão "stereo" para quem está montado e a "mono" (posicional) para
 * quem está perto.
 *
 * No Bedrock o volume de um som tocando não muda: o loop é reiniciado quando o volume/tom calculado muda de faixa
 * (passos de 0,1), quando o arquivo termina e, para os de fora, a cada segundo (a posição acompanha a montaria).
 * `SoundInstance.stop()` (API estável 2.10) corta o anterior.
 */
import { Entity, Player, SoundInstance, system } from "@minecraft/server";
import { MoEnvironment, asNumber } from "../npc/molang/MoLang";
import type { RideSoundData } from "./RideStats";

/** Duração (ticks) dos arquivos `sounds/ride/loop/*.ogg` do 1.8.2 (22,1 s; disco 7 s; submerso 14 s; superfície 18,3 s). */
const LOOP_TICKS: Record<string, number> = {
  wind: 442, leather: 442, plumage: 442, rocket: 442, saucer: 140, underwater: 280, water_surface: 366,
};
/** Distância de atenuação dos "mono" (sounds.json do 1.8.2). */
const MONO_DISTANCE: Record<string, number> = {
  wind: 48, leather: 48, plumage: 48, rocket: 48, saucer: 48, underwater: 16, water_surface: 32,
};
const STEP = 0.1;

interface Playing { instance?: SoundInstance; bucket: string; started: number; until: number }
interface MountSounds { passengers: Map<string, Playing>; others: Map<string, Playing>; style?: string }

const active = new Map<string, MountSounds>();
let env: MoEnvironment | undefined;

/** "cobblemon.ride.loop.wind.stereo" → "wind". */
export function loopKind(sound: string): string {
  return sound.replace(/^cobblemon\.ride\.loop\./, "").replace(/\.(mono|stereo)$/, "");
}

/** Sons sem sufixo ("cobblemon.ride.loop.wind", 14 espécies no 1.8.2) não existem no sounds.json: usa o stereo. */
export function resolveRideSound(sound: string, forPassenger: boolean): string {
  if (/\.(mono|stereo)$/.test(sound)) return sound;
  return `${sound}.${forPassenger ? "stereo" : "mono"}`;
}

/** Volume e tom pelas expressões (ride_velocity em blocos/tick; driver_input 0..1). */
export function evaluateRideSound(settings: Pick<RideSoundData, "volume" | "pitch">, rideVelocity: number, driverInput: number): { volume: number; pitch: number } {
  env ??= new MoEnvironment();
  env.query.fn("ride_velocity", () => rideVelocity);
  env.query.fn("driver_input", () => driverInput);
  let volume = 0;
  let pitch = 1;
  try { volume = asNumber(env.eval(settings.volume)); } catch { volume = 0; }
  try { pitch = asNumber(env.eval(settings.pitch)); } catch { pitch = 1; }
  return { volume: Math.max(0, Math.min(1, volume)), pitch: Math.max(0.1, Math.min(4, pitch)) };
}

function stop(playing: Playing | undefined) {
  try { playing?.instance?.stop(); } catch { }
}

function play(player: Player, sound: string, volume: number, pitch: number, location?: { x: number; y: number; z: number }): SoundInstance | undefined {
  try { return player.playSound(sound, location ? { volume, pitch, location } : { volume, pitch }); }
  catch { return undefined; }
}

/**
 * Um passo dos sons de uma montaria (chame a cada 2 ticks). `sounds` = rideSounds do estilo atual.
 */
export function tickRideSounds(entity: Entity, style: string | undefined, sounds: readonly RideSoundData[] | undefined, riders: readonly Player[], driverInput: number) {
  let state = active.get(entity.id);
  if (!sounds?.length || !style) {
    if (state) stopRideSounds(entity.id);
    return;
  }
  if (!state) active.set(entity.id, state = { passengers: new Map(), others: new Map() });
  if (state.style !== style) {
    for (const p of state.passengers.values()) stop(p);
    for (const p of state.others.values()) stop(p);
    state.passengers.clear();
    state.others.clear();
    state.style = style;
  }
  let velocity = 0;
  try { const v = entity.getVelocity(); velocity = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); } catch { }
  const now = system.currentTick;
  const riderIds = new Set(riders.map(r => r.id));
  const seen = new Set<string>();
  sounds.forEach((settings, index) => {
    const { volume, pitch } = evaluateRideSound(settings, velocity, driverInput);
    const bucket = `${Math.round(volume / STEP)}:${Math.round(pitch / STEP)}`;
    const kind = loopKind(settings.sound);
    const length = LOOP_TICKS[kind] ?? 200;
    if (settings.passengers) {
      const sound = resolveRideSound(settings.sound, true);
      for (const rider of riders) {
        const key = `${index}:${rider.id}`;
        seen.add(key);
        const playing = state!.passengers.get(key);
        if (playing && playing.bucket === bucket && now < playing.until) continue;
        stop(playing);
        state!.passengers.set(key, { instance: volume > 0.01 ? play(rider, sound, volume, pitch) : undefined, bucket, started: now, until: now + length });
      }
    }
    if (settings.others) {
      const sound = resolveRideSound(settings.sound, false);
      const range = MONO_DISTANCE[kind] ?? 32;
      let nearby: Player[] = [];
      try { nearby = entity.dimension.getPlayers({ location: entity.location, maxDistance: range }); } catch { }
      for (const player of nearby) {
        if (riderIds.has(player.id)) continue;
        const key = `${index}:${player.id}`;
        seen.add(`o${key}`);
        const playing = state!.others.get(key);
        // Posicional: reinicia a cada segundo para acompanhar a montaria.
        if (playing && playing.bucket === bucket && now < playing.until && now - playing.started < 20) continue;
        stop(playing);
        state!.others.set(key, {
          instance: volume > 0.01 ? play(player, sound, volume, pitch, entity.location) : undefined, bucket, started: now, until: now + length,
        });
      }
    }
  });
  for (const [key, playing] of state.passengers) if (!seen.has(key)) { stop(playing); state.passengers.delete(key); }
  for (const [key, playing] of state.others) if (!seen.has(`o${key}`)) { stop(playing); state.others.delete(key); }
}

/** Para todos os loops da montaria (desmontou, sumiu). */
export function stopRideSounds(entityId: string) {
  const state = active.get(entityId);
  if (!state) return;
  for (const p of state.passengers.values()) stop(p);
  for (const p of state.others.values()) stop(p);
  active.delete(entityId);
}
