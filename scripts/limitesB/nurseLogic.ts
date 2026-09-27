/**
 * Enfermeira (#99/#113), lógica pura. No Java a profissão NURSE tem como POI a Healing Machine
 * (CobblemonPoiTypes.NURSE_KEY) e o som de trabalho `entity.villager.work_nurse` (CobblemonVillagerProfessions).
 * O Bedrock estável não deixa criar POI; o override do aldeão (entities/vanilla_overrides/villager_v2.json) ganha o
 * grupo "enfermeira" e o script faz o papel do AcquirePoi/WorkAtPoi/ResetProfession do Java.
 */
export const NURSE_FAMILY = "cobblemon_nurse";
export const HEALING_MACHINE = "cobblemon:healing_machine";
export const BECOME_NURSE = "cobblemon:become_nurse";
export const UNBECOME_NURSE = "cobblemon:unbecome_nurse";
export const WORK_SOUND = "cobblemon.entity.villager.work_nurse";
export const NURSE_JOY_PROPERTY = "cobblemon:nurse_joy";

/** AcquirePoi.SCAN_RANGE (48 blocos); na vertical o port limita a ±16 para caber num containsBlock barato. */
export const ACQUIRE_RADIUS = 48;
export const ACQUIRE_HEIGHT = 16;
/** WorkAtPoi: no mínimo 300 ticks entre usos da estação, 50% de chance, a até 1,73 bloco do centro dela. */
export const WORK_INTERVAL = 300;
export const WORK_CHANCE = 0.5;
export const WORK_DISTANCE = 1.73;

/**
 * Horário de trabalho do aldeão com profissão no Bedrock (grupo `work_schedule` do villager_v2: 0–8000 e
 * 10000–11000 do relógio do dia). O Java usa 2000–9000 (Schedule.VILLAGER_DEFAULT); o port segue o horário das
 * outras profissões do Bedrock para a enfermeira não destoar dos vizinhos.
 */
export function isWorkTime(timeOfDay: number): boolean {
  const t = ((timeOfDay % 24000) + 24000) % 24000;
  return (t >= 0 && t < 8000) || (t >= 10000 && t < 11000);
}

/** Chave de uma estação (dimensão + bloco). */
export function siteKey(dimensionId: string, x: number, y: number, z: number): string {
  return `${dimensionId}|${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
}

export function parseSiteKey(key: unknown): { dimension: string; x: number; y: number; z: number } | undefined {
  if (typeof key !== "string") return undefined;
  const m = /^([^|]+)\|(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
  return m ? { dimension: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) } : undefined;
}

/** Distância do aldeão ao centro do bloco (closerToCenterThan do Java). */
export function distanceToBlockCenter(p: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(p.x - (b.x + 0.5), p.y - (b.y + 0.5), p.z - (b.z + 0.5));
}

/** Nome com códigos de formatação (§x) removidos termina com um nome da Joy (VillagerProfessionLayerMixin)? */
export function isNurseJoyName(name: string | undefined, names: readonly string[]): boolean {
  if (!name) return false;
  const clean = name.replace(/§./g, "");
  return names.some(n => clean.endsWith(n));
}

/** Estação livre mais próxima (as ocupadas por outra enfermeira ficam de fora). */
export function nearestFreeSite<T extends { x: number; y: number; z: number }>(from: { x: number; y: number; z: number }, sites: readonly T[], taken: (site: T) => boolean): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const s of sites) {
    if (taken(s)) continue;
    const d = distanceToBlockCenter(from, s);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
