/**
 * Pasto (PastureBlock / PokemonPastureBlockEntity do Cobblemon 1.8.2) no Bedrock.
 *
 * - Bloco de 2 partes (`cobblemon:part` bottom/top); o registro fica na parte de baixo (MachineStore "pasture").
 * - Como no Cobblemon, o Pokémon continua no PC; a entidade passeia em volta do bloco (até
 *   pastureMaxWanderDistance) e volta se sair da área. Pokémon do time vão primeiro para o PC.
 * - A entidade é "selvagem" em comportamento (wild_ai: passeio) mas com `cobblemon:wild = false`, sem
 *   `owner_name` (que faria o main.ts removê-la ao recarregar o chunk) e com `cobblemon:persistent`.
 * - Persistência: a entidade é salva com o chunk; um instantâneo dos dados fica em MachineStore
 *   "pasture_mon" para recriá-la se sumir com o dono offline.
 */
import { Block, Dimension, Entity, Player, RawMessage, system, Vector3, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";
import {
  depositToPC, findPokemonLocation, getBoxCount, getPokemonFromPCLocation, getSafeBoxTeam, getSafeTeam, PCPlace, StorageResult,
} from "../pokemonStorage";
import { generate as newUUID } from "../utils/UUID";
import { getPokemonSpriteTexture } from "../GUI/common";
import { partyButtonText, storageError } from "../GUI/Party";
import { blockKey, MachineStore, parseBlockKey } from "./store";
import {
  addTether, AddResult, canAddPokemon, findTether, insideRoam, nearbyPokemonCap, pastureAttackDamage, PastureRecord, removeAllTethers, removeTether, Tether,
} from "./pastureLogic";
import { add, dimensionById, directionVector, fromTuple, getState, loadedBlock, MK, playMachineSound, setState, tr, tuple } from "./common";
import { hasPastureConflictAi, setPastureConflict, updatePastureConflict } from "./pastureConflict"; // frente dados-ia

export const PASTURE = "cobblemon:pasture";
export const pastureStore = new MachineStore<PastureRecord>("pasture");
const snapshotStore = new MachineStore<string>("pasture_mon");

export const TETHER_PROPERTY = "cobblemon:tethering";
export const PASTURE_PROPERTY = "cobblemon:pasture";
export const PASTURED_TAG = "cobblemon_pastured";
const PERSISTENT_PROPERTY = "cobblemon:persistent";
/** Jogadores com a tela do pasto aberta (liga `cobblemon:on`). */
const viewers = new Map<string, string>();

function limits() {
  const cfg = getConfig();
  return { maxTethered: cfg.defaultPasturedPokemonLimit, maxPerPlayer: cfg.defaultPasturedPokemonLimit };
}

/** Parte de baixo de um bloco de pasto. */
export function pastureBase(block: Block): Block | undefined {
  if (block.typeId !== PASTURE) return undefined;
  return getState<string>(block, "cobblemon:part") === "top" ? block.below() : block;
}

function recordFor(base: Block): PastureRecord {
  const key = blockKey(base.dimension.id, base.location);
  return pastureStore.get(key) ?? { dimension: base.dimension.id, pos: tuple(base.location), tethers: [] };
}

function allRecords(): PastureRecord[] {
  return pastureStore.keys().map(k => pastureStore.get(k)).filter((r): r is PastureRecord => !!r);
}

/** O Pokémon está em algum pasto? (para a frente interface marcar no PC). */
export function isPastured(pokemonUuid: string): boolean {
  return !!findTether(allRecords(), pokemonUuid);
}

/** Uuids de todos os Pokémon no pasto (uma leitura por registro). */
export function pasturedIds(): Set<string> {
  return new Set(allRecords().flatMap(r => r.tethers.map(t => t.pokemonId)));
}

// ---------------------------------------------------------------------------------------------
// Colocação / quebra

export function onPasturePlaced(block: Block, player?: Player) {
  if (getState<string>(block, "cobblemon:part") !== "bottom") return;
  const above = block.above();
  if (above && (above.isAir || above.isLiquid) && above.typeId !== PASTURE) {
    above.setPermutation(block.permutation.withState("cobblemon:part" as never, "top" as never));
  }
  const key = blockKey(block.dimension.id, block.location);
  const record = pastureStore.get(key) ?? { dimension: block.dimension.id, pos: tuple(block.location), tethers: [] };
  if (player) {
    record.ownerId = player.id;
    record.ownerName = player.name;
  }
  pastureStore.set(key, record);
}

/** Uma parte sumiu: remove a outra e solta todos os Pokémon (onBroken). */
export function onPastureRemoved(dimension: Dimension, location: Vector3, part: string | undefined) {
  const baseLoc = part === "top" ? add(location, { x: 0, y: -1, z: 0 }) : location;
  const other = loadedBlock(dimension, part === "top" ? baseLoc : add(location, { x: 0, y: 1, z: 0 }));
  if (other?.typeId === PASTURE) {
    // A parte de baixo tem o loot: se a de cima foi quebrada, a de baixo cai com drop.
    if (part === "top") dimension.runCommand(`setblock ${other.location.x} ${other.location.y} ${other.location.z} air destroy`);
    else other.setType("minecraft:air");
  }
  const key = blockKey(dimension.id, baseLoc);
  const record = pastureStore.get(key);
  pastureStore.delete(key);
  if (!record) return;
  for (const t of record.tethers) recallEntity(t, dimension);
}

// ---------------------------------------------------------------------------------------------
// Entidades

/** Entidade do vínculo (ignorando `exceptId`). */
function entityOf(t: Tether, dimension: Dimension, exceptId?: string): Entity | undefined {
  try {
    return dimension.getEntities({ tags: [t.pokemonId], families: ["pokemon"] })
      .find(e => e.id !== exceptId && e.getDynamicProperty(TETHER_PROPERTY) === t.tetheringId);
  }
  catch { return undefined; }
}

function recallEntity(t: Tether, dimension: Dimension) {
  snapshotStore.delete(t.tetheringId);
  const entity = entityOf(t, dimension);
  if (!entity) return;
  try {
    dimension.playSound("cobblemon.poke_ball.recall", entity.location);
    entity.triggerEvent("cobblemon:instant_kill");
  }
  catch { /* já removida */ }
}

/** Posição de soltura atrás do pasto (tether: ideal = bloco + direção × (largura + 1)). */
function releasePosition(base: Block, width: number): Vector3 {
  const dim = base.dimension;
  const dir = directionVector(getState<string>(base, "minecraft:cardinal_direction"));
  for (let i = 0; i <= 5; i++) {
    const p = add(base.location, dir, Math.ceil(width) + 1 + i);
    for (let dy = 0; dy <= 6; dy++) for (const y of [p.y + dy, p.y - dy]) {
      const at = loadedBlock(dim, { x: p.x, y, z: p.z });
      const below = loadedBlock(dim, { x: p.x, y: y - 1, z: p.z });
      const head = loadedBlock(dim, { x: p.x, y: y + 1, z: p.z });
      if (at?.isAir && head?.isAir && below && !below.isAir && !below.isLiquid) return { x: p.x + 0.5, y, z: p.z + 0.5 };
    }
  }
  return { x: base.location.x + 0.5, y: base.location.y + 2, z: base.location.z + 0.5 };
}

function spawnPastured(base: Block, t: Tether, data: PokemonData): Entity | undefined {
  const dim = base.dimension;
  let entity: Entity | undefined;
  try {
    const width = (() => { try { return data.getHitbox().width * data.getBaseScale(); } catch { return 1; } })();
    entity = dim.spawnEntity(data.getEntityId() as never, releasePosition(base, width));
    data.applyToCobblemon(entity);
    entity.setProperty("cobblemon:wild", false);
    entity.addTag(PASTURED_TAG);
    entity.setDynamicProperty(TETHER_PROPERTY, t.tetheringId);
    entity.setDynamicProperty(PASTURE_PROPERTY, blockKey(dim.id, base.location));
    entity.setDynamicProperty(PERSISTENT_PROPERTY, true);
    entity.setDynamicProperty("cobblemon:pasture_owner", t.playerId);
    dim.playSound("cobblemon.poke_ball.send_out", entity.location);
    return entity;
  }
  catch (e) {
    console.warn(`[pasto] falha ao soltar ${data.species}: ${e}`);
    try { if (entity?.isValid) entity.remove(); }
    catch { /* já removida */ }
    return undefined;
  }
}

function saveSnapshot(t: Tether, data: PokemonData) {
  const json = JSON.stringify(data);
  if (json.length > 30000) return;
  if (snapshotStore.get(t.tetheringId) !== json) snapshotStore.set(t.tetheringId, json);
}

/** Dados do Pokémon no PC do dono (com dica de caixa/espaço). */
function pcPokemon(owner: Player, t: Tether): PokemonData | undefined {
  if (t.box !== undefined && t.space !== undefined) {
    const hinted = getPokemonFromPCLocation(owner, { location: PCPlace.Box, boxID: t.box, space: t.space });
    if (hinted?.uuid === t.pokemonId) return hinted;
  }
  const loc = findPokemonLocation(owner, t.pokemonId);
  if (!loc || loc.location !== PCPlace.Box) return undefined;
  t.box = loc.boxID;
  t.space = loc.space;
  return getPokemonFromPCLocation(owner, loc) ?? undefined;
}

// ---------------------------------------------------------------------------------------------
// Tela

function pokemonsNearby(base: Block, radius: number): number {
  try {
    return base.dimension.getEntities({
      families: ["pokemon"],
      location: { x: base.location.x - radius / 2, y: -1e5, z: base.location.z - radius / 2 },
      volume: { x: radius, y: 2e5, z: radius },
    }).length;
  }
  catch { return 0; }
}

/**
 * Nome do dono como no PasturePokemonScrollList: só o nome, em itálico (`ownerName.text().italicise()`). No
 * Cobblemon ele troca o nome do Pokémon ao passar o mouse; sem hover no formulário, vai numa segunda linha.
 */
export function pastureOwnerLine(ownerName: string): RawMessage {
  return { text: `\n§7§o${ownerName}§r` };
}

function tetherLabel(t: Tether, player: Player) {
  const name: RawMessage = t.name ? { text: t.name } : { translate: `cobblemon.species.${t.species}.name` };
  const lines: RawMessage[] = [name, { text: `  Lv. ${t.level}${t.shiny ? " §6★" : ""}` }];
  // Frente visual-final: dono em itálico em todos os Pokémon do pasto (o Java mostra para qualquer um no hover).
  if (t.playerName) lines.push(pastureOwnerLine(t.playerName));
  return { rawtext: lines };
}

export async function openPasture(player: Player, block: Block) {
  const base = pastureBase(block);
  if (!base) return;
  const key = blockKey(base.dimension.id, base.location);
  viewers.set(player.id, key);
  setOn(base, true);
  playMachineSound(base.dimension, base.location, "pcOn", 0.5);
  try {
    while (true) {
      if (!base.isValid || base.typeId !== PASTURE) return;
      const record = recordFor(base);
      const lim = limits();
      const form = new ActionFormData().title({ translate: "cobblemon.ui.pasture" })
        .body({ rawtext: [{ text: `${record.tethers.length}/${lim.maxTethered}` }, ...(record.tethers.length ? [] : [{ text: "\n" }, tr(MK.pastureEmpty)])] });
      form.button(tr(MK.pastureAdd), "textures/block/pasture");
      form.button({ translate: "cobblemon.ui.pasture.recall_all" });
      for (const t of record.tethers) form.button(tetherLabel(t, player), getPokemonSpriteTexture(t.species, t.variant));
      const res = await form.show(player);
      if (res.selection === undefined) return;
      if (res.selection === 0) { await choosePokemonToPasture(player, base); continue; }
      if (res.selection === 1) {
        const fresh = recordFor(base);
        for (const t of removeAllTethers(fresh, player.id)) recallEntity(t, base.dimension);
        pastureStore.set(key, fresh);
        continue;
      }
      const t = record.tethers[res.selection - 2];
      if (!t) continue;
      if (t.playerId !== player.id) { player.sendMessage(tr(MK.pastureOwner, t.playerName)); continue; }
      // PasturePokemonScrollList: recolher ou alternar "ataca mobs hostis" (SetPastureConflictPacket).
      const action = await new ActionFormData().title(tetherLabel(t, player))
        .button(tr(MK.pastureRecall))
        .button(tr(t.conflict ? MK.pastureConflictOn : MK.pastureConflictOff))
        .show(player);
      if (action.selection === undefined) continue;
      const fresh = recordFor(base);
      if (action.selection === 1) {
        const target = fresh.tethers.find(x => x.pokemonId === t.pokemonId);
        if (target) target.conflict = !target.conflict;
        // Frente dados-ia: desligado, a IA de ataque sai na hora.
        if (target && !target.conflict) setPastureConflict(entityOf(target, base.dimension), false);
        pastureStore.set(key, fresh);
        continue;
      }
      const removed = removeTether(fresh, t.pokemonId);
      if (removed) recallEntity(removed, base.dimension);
      pastureStore.set(key, fresh);
    }
  }
  finally {
    if (viewers.get(player.id) === key) viewers.delete(player.id);
    if (![...viewers.values()].includes(key)) setOn(base, false);
  }
}

function setOn(base: Block, on: boolean) {
  if (!base.isValid || base.typeId !== PASTURE) return;
  setState(base, "cobblemon:on", on);
  const top = base.above();
  if (top?.typeId === PASTURE) setState(top, "cobblemon:on", on);
}

async function choosePokemonToPasture(player: Player, base: Block) {
  // Origem: time ou uma caixa com Pokémon.
  const boxes: number[] = [];
  for (let b = 0; b < getBoxCount(player); b++) if (getSafeBoxTeam(player, b).some(p => p)) boxes.push(b);
  const pick = new ActionFormData().title(tr(MK.pastureChoose)).button({ translate: "cobblemon.ui.party" });
  for (const b of boxes) pick.button({ translate: "cobblemon.ui.pc.box.title", with: [`${b + 1}`] });
  const src = await pick.show(player);
  if (src.selection === undefined) return;
  const fromParty = src.selection === 0;
  const list = fromParty ? getSafeTeam(player) : getSafeBoxTeam(player, boxes[src.selection - 1]);
  const pastured = pasturedIds();
  const candidates = list.map((p, i) => ({ p, i })).filter((x): x is { p: PokemonData; i: number } => !!x.p && !pastured.has(x.p.uuid));
  if (!candidates.length) { player.sendMessage(tr(MK.pastureNone)); return; }
  const form = new ActionFormData().title(tr(MK.pastureChoose));
  for (const { p } of candidates) form.button(partyButtonText(p), getPokemonSpriteTexture(p));
  const res = await form.show(player);
  if (res.selection === undefined) return;
  const chosen = candidates[res.selection];
  let data = chosen.p;
  if (fromParty) {
    if (data.tryGetPokemonOut()) data.return(player);
    const result = depositToPC(player, chosen.i);
    if (result !== StorageResult.Ok) { const err = storageError(result); if (err) player.sendMessage(err); return; }
  }
  tetherPokemon(player, base, data);
}

/** PasturePokemonHandler + tether. */
export function tetherPokemon(player: Player, base: Block, data: PokemonData): AddResult {
  const key = blockKey(base.dimension.id, base.location);
  const record = recordFor(base);
  const cfg = getConfig();
  const result = canAddPokemon(record, player.id, { uuid: data.uuid, currentHealth: data.currentHealth }, limits());
  if (result !== "ok") {
    player.sendMessage(tr(result === "fainted" ? MK.pastureFainted : MK.pastureFull));
    return result;
  }
  if (pokemonsNearby(base, cfg.pastureMaxWanderDistance) >= nearbyPokemonCap(cfg.pastureMaxPerChunk, cfg.pastureMaxWanderDistance)) {
    player.sendMessage({ rawtext: [{ text: "§c" }, { translate: "cobblemon.pasture.too_many_nearby" }] });
    return "full";
  }
  const loc = findPokemonLocation(player, data.uuid);
  const t: Tether = {
    tetheringId: newUUID(), playerId: player.id, playerName: player.name, pokemonId: data.uuid,
    species: data.species, level: data.level, name: data.name || undefined, shiny: !!data.shiny, variant: data.variant,
    box: loc?.boxID, space: loc?.space,
  };
  const entity = spawnPastured(base, t, data);
  if (!entity) return "full";
  addTether(record, t);
  pastureStore.set(key, record);
  saveSnapshot(t, data);
  return "ok";
}

// ---------------------------------------------------------------------------------------------
// Checagem periódica (checkPokemon + checkPastureTether)

function onlinePlayer(id: string): Player | undefined {
  return world.getAllPlayers().find(p => p.id === id);
}

/** Uma passada por um pasto carregado. */
function checkPasture(key: string) {
  const record = pastureStore.get(key);
  if (!record) return;
  const { dimension, location } = parseBlockKey(key);
  const dim = dimensionById(dimension);
  const base = dim && loadedBlock(dim, location);
  if (!base) return;
  if (base.typeId !== PASTURE) { onPastureRemoved(dim!, location, "bottom"); return; }
  const radius = getConfig().pastureMaxWanderDistance;
  let changed = false;
  for (const t of [...record.tethers]) {
    const owner = onlinePlayer(t.playerId);
    let data: PokemonData | undefined;
    if (owner) {
      data = pcPokemon(owner, t);
      if (!data) {
        // Saiu do PC (foi para o time, solto ou trocado): desfaz o vínculo.
        removeTether(record, t.pokemonId);
        recallEntity(t, dim!);
        changed = true;
        continue;
      }
      saveSnapshot(t, data);
      if (t.level !== data.level || t.species !== data.species || (t.name ?? "") !== (data.name ?? "") || t.variant !== data.variant) {
        t.level = data.level; t.species = data.species; t.name = data.name || undefined;
        t.variant = data.variant;
        changed = true;
      }
    }
    let entity = entityOf(t, dim!);
    if (!entity) {
      const snap = snapshotStore.get(t.tetheringId);
      data ??= snap ? PokemonData.getFromJson(snap) : undefined;
      if (data && data.currentHealth > 0) entity = spawnPastured(base, t, data);
      continue;
    }
    if (!insideRoam(record.pos, radius, entity.location)) {
      // Fora da área: volta para trás do pasto.
      try { entity.teleport(releasePosition(base, 1)); }
      catch { recallEntity(t, dim!); }
    }
  }
  if (changed) pastureStore.set(key, record);
}

/** Todas as checagens (chamado a cada pastureBlockUpdateTicks). */
export function checkPastures() {
  for (const key of pastureStore.keys()) {
    try { checkPasture(key); }
    catch (e) { console.warn(`[pasto] ${key}: ${e}`); }
  }
}

/** Entidade de pasto carregada: some se o vínculo não existe mais. */
export function onPasturedEntityLoaded(entity: Entity) {
  // A entidade pode ter sido removida no mesmo tick em que carregou (ex.: `kill @e` com chunks carregando).
  if (!entity.isValid) return;
  const tetheringId = entity.getDynamicProperty(TETHER_PROPERTY);
  if (typeof tetheringId !== "string") return;
  const key = entity.getDynamicProperty(PASTURE_PROPERTY);
  const record = typeof key === "string" ? pastureStore.get(key) : undefined;
  const tether = record?.tethers.find(t => t.tetheringId === tetheringId);
  // Válida e única: fica. (Se o pasto recriou a entidade enquanto esta estava num chunk descarregado, some a cópia.)
  if (tether && entityOf(tether, entity.dimension, entity.id) === undefined) return;
  system.run(() => { try { if (entity.isValid) entity.triggerEvent("cobblemon:instant_kill"); } catch { /* removida */ } });
}

export { fromTuple };

// ---------------------------------------------------------------------------------------------
// Ataque a mobs hostis (PASTURE_CONFLICT / behaviours/attack_hostile_mobs.json)

const HOSTILE_RANGE = 8;
const ATTACK_REACH = 2.5;

/**
 * Pokémon com "ataca mobs hostis" ligado vão até o monstro mais próximo (dentro da área do pasto) e batem nele.
 * O Bedrock não deixa o script dar um alvo à IA da entidade (o JSON do Pokémon não tem comportamento de ataque):
 * aproximação por impulso na direção do alvo e dano corpo a corpo por script, a cada chamada (20 ticks).
 */
export function tickPastureConflicts() {
  const radius = getConfig().pastureMaxWanderDistance;
  for (const key of pastureStore.keys()) {
    const record = pastureStore.get(key);
    if (!record?.tethers.some(t => t.conflict)) continue;
    const dim = dimensionById(record.dimension);
    if (!dim || !loadedBlock(dim, fromTuple(record.pos))) continue;
    for (const t of record.tethers) {
      if (!t.conflict) continue;
      const entity = entityOf(t, dim);
      if (!entity) continue;
      try {
        // Frente dados-ia: IA de ataque do Pokémon (grupo cobblemon:pasture_conflict); o script antigo fica para
        // entidades sem o grupo.
        if (hasPastureConflictAi(entity)) updatePastureConflict(entity, loc => insideRoam(record.pos, radius, loc));
        else attackNearestHostile(entity, record, radius, t.level);
      }
      catch { /* entidade saiu */ }
    }
  }
}

function attackNearestHostile(entity: Entity, record: PastureRecord, radius: number, level: number) {
  const target = entity.dimension.getEntities({ location: entity.location, maxDistance: HOSTILE_RANGE, families: ["monster"], closest: 1 })
    .find(e => e.isValid && insideRoam(record.pos, radius, e.location));
  if (!target) return;
  const from = entity.location;
  const to = target.location;
  const dx = to.x - from.x, dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > ATTACK_REACH) {
    entity.applyImpulse({ x: dx / dist * 0.45, y: 0.1, z: dz / dist * 0.45 });
    return;
  }
  target.applyDamage(pastureAttackDamage(level), { cause: "entityAttack" as never, damagingEntity: entity });
}
