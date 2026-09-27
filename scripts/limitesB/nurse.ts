/**
 * Enfermeira (#99/#113) no mundo. O grupo, as trocas e a textura estão no override do `minecraft:villager_v2`
 * (BP/RP, frente limites-b); aqui ficam as partes do Java que dependem do POI (Healing Machine):
 * - AcquirePoi: a cada 100 ticks, aldeão adulto desempregado (família `unskilled`) a até 48 blocos de uma Healing
 *   Machine livre vira enfermeira (evento `cobblemon:become_nurse`) e guarda a estação. Enfermeira sem estação
 *   procura outra do mesmo jeito.
 * - WorkAtPoi: a cada 300 ticks, no horário de trabalho, com 50% de chance e a até 1,73 bloco da estação, toca
 *   `entity.villager.work_nurse` e repõe as trocas (restock), como `useWorkstation`.
 * - ResetProfession: estação quebrada → a enfermeira perde a estação; se nunca negociou, volta a desempregada.
 *   O Bedrock não expõe a XP de troca ao script: "negociou" = um jogador já abriu a tela de trocas dela.
 * - Enfermeira Joy: nome terminado num dos nomes do Java → propriedade `cobblemon:nurse_joy` (textura nurse_joy).
 * - Filhotes (nascem com a família `unskilled`) ficam de fora: AcquirePoi do Java é `onlyIfAdult`. O evento
 *   `cobblemon:become_nurse` também filtra `is_baby` no override.
 * - Zumbificação e cura: o Java guarda a profissão (VillagerData) nas duas conversões. O Bedrock não carrega dynamic
 *   properties na transformação, então a enfermeira removida é casada com a entidade `Transformed` que nasce no
 *   mesmo lugar e tick: o aldeão zumbi guarda `cobblemon:was_nurse` e, curado, volta a ser enfermeira.
 */
import { BlockVolume, Dimension, Entity, EntityInitializationCause, system, world } from "@minecraft/server";
import { NURSE_JOY_NAMES } from "../../generated/scripts/limitesB";
import {
  ACQUIRE_HEIGHT, ACQUIRE_RADIUS, BECOME_NURSE, distanceToBlockCenter, HEALING_MACHINE, isNurseJoyName, isWorkTime, nearestFreeSite,
  NURSE_FAMILY, NURSE_JOY_PROPERTY, parseSiteKey, siteKey, UNBECOME_NURSE, WORK_CHANCE, WORK_DISTANCE, WORK_INTERVAL, WORK_SOUND,
} from "./nurseLogic";

const VILLAGER = "minecraft:villager_v2";
const ZOMBIE_VILLAGER = "minecraft:zombie_villager_v2";
const SITE = "cobblemon:nurse_site";
const TRADED = "cobblemon:nurse_traded";
/** No aldeão zumbi: 1 = era enfermeira, 2 = era enfermeira e já negociou. */
const WAS_NURSE = "cobblemon:was_nurse";
const ACQUIRE_INTERVAL = 100;
const DIMENSIONS = ["overworld", "nether", "the_end"];

export const nurseRng = { next: () => Math.random() };
export const nurseStats = { acquired: 0, reset: 0, workSounds: 0, restocks: 0, zombified: 0, cured: 0 };

function dims(): Dimension[] {
  const out: Dimension[] = [];
  for (const id of DIMENSIONS) {
    try { out.push(world.getDimension(id)); }
    catch { /* dimensão indisponível */ }
  }
  return out;
}

/** Healing Machines num raio de 48 blocos (±16 na vertical) do ponto; um containsBlock antes do getBlocks. */
function machinesNear(dimension: Dimension, at: { x: number; y: number; z: number }): Array<{ x: number; y: number; z: number }> {
  const min = { x: Math.floor(at.x) - ACQUIRE_RADIUS, y: Math.max(dimension.heightRange.min, Math.floor(at.y) - ACQUIRE_HEIGHT), z: Math.floor(at.z) - ACQUIRE_RADIUS };
  const max = { x: Math.floor(at.x) + ACQUIRE_RADIUS, y: Math.min(dimension.heightRange.max - 1, Math.floor(at.y) + ACQUIRE_HEIGHT), z: Math.floor(at.z) + ACQUIRE_RADIUS };
  const filter = { includeTypes: [HEALING_MACHINE] };
  const volume = new BlockVolume(min, max);
  try {
    if (!dimension.containsBlock(volume, filter, true)) return [];
  }
  catch {
    return [];
  }
  const out: Array<{ x: number; y: number; z: number }> = [];
  try {
    for (const loc of dimension.getBlocks(volume, filter, true).getBlockLocationIterator()) out.push({ x: loc.x, y: loc.y, z: loc.z });
  }
  catch { /* descarregou */ }
  return out;
}

function isNurse(e: Entity): boolean {
  try { return e.getComponent("minecraft:type_family")?.hasTypeFamily(NURSE_FAMILY) === true; }
  catch { return false; }
}

function isBaby(e: Entity): boolean {
  try { return e.getComponent("minecraft:is_baby") !== undefined; }
  catch { return false; }
}

/** Só adultos (AcquirePoi.onlyIfAdult). Filhote com estação guardada (antes da correção) libera a estação. */
export function adultsOnly(list: Entity[]): Entity[] {
  const out: Entity[] = [];
  for (const v of list) {
    if (!isBaby(v)) { out.push(v); continue; }
    try { if (v.getDynamicProperty(SITE) !== undefined) v.setDynamicProperty(SITE, undefined); }
    catch { /* removido */ }
  }
  return out;
}

/** AcquirePoi + ResetProfession + Joy (um passe a cada 100 ticks). */
export function nursePass() {
  for (const dimension of dims()) {
    let nurses: Entity[] = [];
    let jobless: Entity[] = [];
    try {
      nurses = dimension.getEntities({ type: VILLAGER, families: [NURSE_FAMILY] });
      jobless = adultsOnly(dimension.getEntities({ type: VILLAGER, families: ["unskilled"] }));
    }
    catch { continue; }
    if (!nurses.length && !jobless.length) continue;
    // Estações ocupadas: de enfermeiras e de desempregados já escolhidos (o evento aplica no tick seguinte).
    const taken = new Set<string>();
    for (const n of [...nurses, ...jobless]) {
      const site = n.getDynamicProperty(SITE);
      if (typeof site === "string") taken.add(site);
    }
    // Estação quebrada (ResetProfession) e nome da Joy.
    for (const n of nurses) {
      if (!n.isValid) continue;
      try {
        const joy = isNurseJoyName(n.nameTag, NURSE_JOY_NAMES);
        if (n.getProperty(NURSE_JOY_PROPERTY) !== joy) n.setProperty(NURSE_JOY_PROPERTY, joy);
      }
      catch { /* sem a propriedade (override ausente) */ }
      const site = parseSiteKey(n.getDynamicProperty(SITE));
      if (!site || site.dimension !== dimension.id) continue;
      let typeId: string | undefined;
      try {
        if (!dimension.isChunkLoaded(site)) continue;
        typeId = dimension.getBlock(site)?.typeId;
      }
      catch { continue; }
      if (typeId === undefined || typeId === HEALING_MACHINE) continue;
      n.setDynamicProperty(SITE, undefined);
      taken.delete(siteKey(dimension.id, site.x, site.y, site.z));
      if (n.getDynamicProperty(TRADED) !== true) {
        n.triggerEvent(UNBECOME_NURSE);
        nurseStats.reset++;
      }
    }
    // AcquirePoi: desempregados e enfermeiras sem estação. Uma busca por célula de 32 blocos por passe.
    const cellCache = new Map<string, Array<{ x: number; y: number; z: number }>>();
    // Desempregado com estação: o evento ainda não pegou (ou o jogo desfez); repete se a máquina continua lá.
    for (const v of jobless) {
      const site = parseSiteKey(v.getDynamicProperty(SITE));
      if (!site || !v.isValid) continue;
      let typeId: string | undefined;
      try { typeId = dimension.isChunkLoaded(site) ? dimension.getBlock(site)?.typeId : HEALING_MACHINE; }
      catch { typeId = HEALING_MACHINE; }
      if (site.dimension === dimension.id && typeId === HEALING_MACHINE) v.triggerEvent(BECOME_NURSE);
      else {
        v.setDynamicProperty(SITE, undefined);
        taken.delete(siteKey(site.dimension, site.x, site.y, site.z));
      }
    }
    const seekers = [...jobless, ...nurses].filter(v => v.isValid && v.getDynamicProperty(SITE) === undefined);
    for (const v of seekers) {
      if (!v.isValid) continue;
      const at = v.location;
      const cell = `${Math.floor(at.x / 32)},${Math.floor(at.y / 32)},${Math.floor(at.z / 32)}`;
      let machines = cellCache.get(cell);
      if (!machines) cellCache.set(cell, machines = machinesNear(dimension, at));
      const site = nearestFreeSite(at, machines, m => taken.has(siteKey(dimension.id, m.x, m.y, m.z)));
      if (!site) continue;
      const key = siteKey(dimension.id, site.x, site.y, site.z);
      taken.add(key);
      v.setDynamicProperty(SITE, key);
      if (!isNurse(v)) {
        v.triggerEvent(BECOME_NURSE);
        nurseStats.acquired++;
      }
    }
  }
}

/** WorkAtPoi (a cada 300 ticks): som de trabalho + reposição das trocas perto da estação. */
export function nurseWorkPass(force = false) {
  if (!force && !isWorkTime(world.getTimeOfDay())) return;
  for (const dimension of dims()) {
    let nurses: Entity[];
    try { nurses = dimension.getEntities({ type: VILLAGER, families: [NURSE_FAMILY] }); }
    catch { continue; }
    for (const n of nurses) {
      const site = parseSiteKey(n.getDynamicProperty(SITE));
      if (!site || site.dimension !== dimension.id) continue;
      if (!force && nurseRng.next() >= WORK_CHANCE) continue;
      if (distanceToBlockCenter(n.location, site) > WORK_DISTANCE) continue;
      try {
        dimension.playSound(WORK_SOUND, n.location);
        nurseStats.workSounds++;
        n.triggerEvent("minecraft:resupply_trades");
        nurseStats.restocks++;
      }
      catch { /* descarregou */ }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Zumbificação e cura (a profissão sobrevive às duas transformações, como no Java)

interface Removed { dimension: string; x: number; y: number; z: number; tick: number; traded: boolean; zombie: boolean }
const removed: Removed[] = [];
/** Ticks de tolerância entre a remoção da entidade antiga e o spawn da nova. */
const TRANSFORM_WINDOW = 5;

/** Registra a enfermeira (ou o zumbi que era enfermeira) saindo do mundo (before-event: só leitura). */
export function noteNurseRemoved(entity: Entity, tick: number) {
  let zombie: boolean;
  let traded: boolean;
  if (entity.typeId === VILLAGER) {
    if (!isNurse(entity)) return;
    zombie = false;
    traded = entity.getDynamicProperty(TRADED) === true;
  }
  else if (entity.typeId === ZOMBIE_VILLAGER) {
    const was = entity.getDynamicProperty(WAS_NURSE);
    if (was !== 1 && was !== 2) return;
    zombie = true;
    traded = was === 2;
  }
  else return;
  const l = entity.location;
  while (removed.length && tick - removed[0].tick > TRANSFORM_WINDOW) removed.shift();
  removed.push({ dimension: entity.dimension.id, x: l.x, y: l.y, z: l.z, tick, traded, zombie });
}

/** Entidade nascida por transformação: herda a profissão de enfermeira da que saiu no mesmo lugar. */
export function onTransformedSpawn(entity: Entity, tick: number): boolean {
  const wantZombie = entity.typeId === VILLAGER;
  if (!wantZombie && entity.typeId !== ZOMBIE_VILLAGER) return false;
  const l = entity.location;
  const dimension = entity.dimension.id;
  const i = removed.findIndex(r => r.zombie === wantZombie && r.dimension === dimension && Math.abs(tick - r.tick) <= TRANSFORM_WINDOW
    && (r.x - l.x) ** 2 + (r.y - l.y) ** 2 + (r.z - l.z) ** 2 <= 2.25);
  if (i < 0) return false;
  const [r] = removed.splice(i, 1);
  if (entity.typeId === ZOMBIE_VILLAGER) {
    entity.setDynamicProperty(WAS_NURSE, r.traded ? 2 : 1);
    nurseStats.zombified++;
    return true;
  }
  // Cura: volta a ser enfermeira (o evento ignora filhote). A estação é procurada de novo no próximo passe.
  entity.triggerEvent(BECOME_NURSE);
  if (r.traded) entity.setDynamicProperty(TRADED, true);
  nurseStats.cured++;
  return true;
}

let started = false;

export function startNurses() {
  if (started) return;
  started = true;
  system.runInterval(() => {
    try { nursePass(); }
    catch (e) { console.warn(`[limites-b] enfermeira: ${e}`); }
  }, ACQUIRE_INTERVAL);
  system.runInterval(() => {
    try { nurseWorkPass(); }
    catch (e) { console.warn(`[limites-b] enfermeira (trabalho): ${e}`); }
  }, WORK_INTERVAL);
  // "Negociou": abriu a tela de trocas (aproximação da XP de troca, que o script não lê).
  world.afterEvents.playerInteractWithEntity.subscribe(({ target }) => {
    try { if (target.typeId === VILLAGER && isNurse(target)) target.setDynamicProperty(TRADED, true); }
    catch { /* removido */ }
  });
  world.beforeEvents.entityRemove.subscribe(({ removedEntity }) => {
    try {
      const t = removedEntity.typeId;
      if (t === VILLAGER || t === ZOMBIE_VILLAGER) noteNurseRemoved(removedEntity, system.currentTick);
    }
    catch { /* entidade já inválida */ }
  });
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (cause !== EntityInitializationCause.Transformed || !removed.length) return;
    try { if (entity.isValid) onTransformedSpawn(entity, system.currentTick); }
    catch (e) { console.warn(`[limites-b] enfermeira (transformação): ${e}`); }
  });
}
