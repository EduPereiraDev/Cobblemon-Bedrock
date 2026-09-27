/**
 * NPC escondido por jogador (NPCEntity.shouldHideFrom / broadcastToPlayer do Cobblemon 1.8.2). Ligado por padrão.
 *
 * Java: o NPC não é enviado ao jogador cujos dados MoLang têm `<uuid do NPC>.hide == 1` (`q.player.data()` /
 * `get_npc_data(npc).hide`), salvo quem tem a permissão SEE_HIDDEN_NPCS: somem o modelo, o nome, a sombra, a colisão
 * e o clique só para ele.
 *
 * Bedrock (APIs estáveis):
 *  - modelo: `Player.setPropertyOverrideForEntity(npc, "cobblemon:npc_hidden", true)` (override por jogador de
 *    propriedade client_sync) + part_visibility no render controller do NPC (tools/importer/npcs.ts). O NPC com
 *    modelo de Pokémon (PokemonModel.ts) tem a exibição encolhida ao mínimo (`cobblemon:scale_modifier` 0,05) para
 *    esse jogador;
 *  - nome: o nameTag é global, então o NPC escondido de alguém fica com nameTag vazio e o nome vai para um
 *    `TextPrimitive` preso ao NPC com `visibleTo` = quem ainda o vê. O NPC com nome apagado leva a dynamic property
 *    `npc:hide_blanked` (nameTag original): quando ninguém mais precisa da ocultação o nome volta, também depois de
 *    /reload ou de recarregar do disco. Todo refreshNameTag reaplica a ocultação no mesmo tick (gancho do NPCEntity);
 *  - clique e dano de quem não vê: cancelados (o handler de interação do NPC, scripts/npc/index.ts, também sai);
 *  - sombra e empurrão: sem API por jogador (limitação que fica).
 * SEE_HIDDEN_NPCS (permissão, nível de operador no Java): no Bedrock é a tag `cobblemon_see_hidden_npcs` (só quem pode
 * usar /tag concede), porque o dono do mundo é operador e, com a regra do Java, nunca veria o efeito.
 */
import { Entity, Player, TextPrimitive, system, world } from "@minecraft/server";
import { NPC, NPC_ENTITY_ID, isNPCEntity, npcAppearanceHooks, npcNameTagHooks } from "./NPCEntity";
import { getMoLangData, getNpcData, saveMoLangData } from "./PlayerStruct";
import { MoStruct, asNumber } from "./molang/MoLang";
import { NPC_HIDDEN_PROPERTY, POKEMON_SCALE_MODIFIER_RANGE } from "./PokemonModelData";
import { npcModelDisplay, setNpcModelSpawnHook, setNpcModelTouchFilter } from "./PokemonModel";

/** Tag que faz o jogador ver NPCs escondidos (CobblemonPermissions.SEE_HIDDEN_NPCS). */
export const SEE_HIDDEN_NPCS_TAG = "cobblemon_see_hidden_npcs";
const REFRESH_TICKS = 20;
/** Dynamic property do NPC com o nameTag apagado por aqui (valor = nameTag original). */
export const BLANKED_NAME_PROPERTY = "npc:hide_blanked";

/** NPC → rótulo (TextPrimitive) enquanto alguém não o vê. */
const labels = new Map<string, TextPrimitive>();
/** Estado aplicado por jogador/entidade (evita reenviar o override todo segundo). */
const applied = new Map<string, boolean>();
/** Entidades (NPCs e exibições) com estado em `applied`. */
const tracked = new Set<string>();
/** NPCs sendo reaplicados agora (o refreshNameTag chamado daqui volta pelo gancho). */
const refreshing = new Set<string>();
let started = false;

/** Valor `hide` dos dados MoLang do jogador para o NPC, sem criar a entrada (getNpcData cria). */
export function hideValue(player: Player, npcUuid: string): number | undefined {
  const entry = getMoLangData(player).get(npcUuid);
  if (!(entry instanceof MoStruct)) return undefined;
  const value = entry.get("hide");
  return value === undefined ? undefined : asNumber(value);
}

/** NPCEntity.shouldHideFrom: `hide == 1`, salvo quem tem SEE_HIDDEN_NPCS. */
export function shouldHideFrom(npc: Entity, player: Player): boolean {
  try {
    if (!isNPCEntity(npc) || player.hasTag(SEE_HIDDEN_NPCS_TAG)) return false;
    return hideValue(player, new NPC(npc).uuid) === 1;
  }
  catch { return false; }
}

/** Esconde/mostra o NPC para o jogador (mesmo dado que o MoLang `get_npc_data(npc).hide` usa). */
export function setHiddenFor(npc: Entity, player: Player, hidden: boolean) {
  getNpcData(player, new NPC(npc).uuid).set("hide", hidden ? 1 : 0);
  saveMoLangData(player);
  refreshNpcHide();
}

function allNpcs(): Entity[] {
  const out: Entity[] = [];
  for (const dim of ["overworld", "nether", "the_end"]) {
    try { out.push(...world.getDimension(dim).getEntities({ type: NPC_ENTITY_ID })); } catch { }
  }
  return out;
}

function removeLabel(npcId: string) {
  const label = labels.get(npcId);
  if (!label) return;
  try { label.remove(); } catch { }
  labels.delete(npcId);
}

function blankedName(npcEntity: Entity): string | undefined {
  try {
    const value = npcEntity.getDynamicProperty(BLANKED_NAME_PROPERTY);
    return typeof value === "string" ? value : undefined;
  }
  catch { return undefined; }
}

/** Nome do rótulo: o do NPC, ou o nameTag guardado quando o NPC não tem chave de nome (o nameTag está vazio). */
function labelText(npcEntity: Entity, npc: NPC): string {
  const saved = blankedName(npcEntity);
  return npc.nameKey === undefined && saved ? saved : npc.name;
}

function labelHeight(npc: NPC): number {
  try { return npc.hitbox.height * npc.hitboxScale + 0.5; }
  catch { return 2.3; }
}

/** Devolve o nameTag apagado daqui (ninguém mais precisa da ocultação). */
function restoreName(npcEntity: Entity, npc: NPC) {
  const saved = blankedName(npcEntity);
  if (saved === undefined) {
    // Apagado antes da marca existir (versão anterior do port): com chave de nome dá para refazer.
    let blank = false;
    try { blank = npcEntity.nameTag === ""; } catch { }
    if (blank && npc.nameKey !== undefined && !npc.hideNameTag) npc.refreshNameTag();
    return;
  }
  try { npcEntity.setDynamicProperty(BLANKED_NAME_PROPERTY, undefined); } catch { }
  if (npc.nameKey === undefined && saved) {
    try { npcEntity.nameTag = npc.hideNameTag ? "" : saved; } catch { }
  }
  else npc.refreshNameTag();
}

function updateLabel(npcEntity: Entity, viewers: Player[], hiddenForSomeone: boolean) {
  const npc = new NPC(npcEntity);
  if (!hiddenForSomeone || npc.hideNameTag) {
    removeLabel(npcEntity.id);
    restoreName(npcEntity, npc);
    return;
  }
  // Nome global vazio; o rótulo só para quem vê. visibleTo vazio = todos, então sem ninguém o rótulo sai.
  try {
    if (blankedName(npcEntity) === undefined) npcEntity.setDynamicProperty(BLANKED_NAME_PROPERTY, npcEntity.nameTag);
    if (npcEntity.nameTag !== "") npcEntity.nameTag = "";
  }
  catch { }
  if (!viewers.length) { removeLabel(npcEntity.id); return; }
  const text = labelText(npcEntity, npc);
  const height = labelHeight(npc);
  let label = labels.get(npcEntity.id);
  if (!label) {
    label = new TextPrimitive({ x: 0, y: height, z: 0 }, text);
    label.attachedTo = npcEntity;
    label.depthTest = true;
    try { world.primitiveShapesManager.addText(label, npcEntity.dimension); }
    catch (e) { console.warn(`NPC: rótulo de ${npcEntity.id}: ${e}`); return; }
    labels.set(npcEntity.id, label);
  }
  else {
    // Renomeado (set_name, idioma dos nomes) ou hitbox/escala nova: texto e altura acompanham.
    try { if (label.text !== text) label.setText(text); } catch { }
    try { if (Math.abs(label.location.y - height) > 1e-3) label.setLocation({ x: 0, y: height, z: 0 }); } catch { }
  }
  label.visibleTo = viewers;
}

/** Override por jogador (true = escondido para ele). */
function applyOverride(player: Player, target: Entity, key: string, hidden: boolean, property: string, value: boolean | number) {
  if (applied.get(key) === hidden) return;
  tracked.add(target.id);
  try {
    if (hidden) player.setPropertyOverrideForEntity(target, property, value);
    else player.removePropertyOverrideForEntity(target, property);
    applied.set(key, hidden);
  }
  catch (e) { console.warn(`NPC: override de ${target.id} para ${player.name}: ${e}`); }
}

function refreshOne(npc: Entity, players: Player[]) {
  if (!isNPCEntity(npc) || refreshing.has(npc.id)) return;
  refreshing.add(npc.id);
  try {
    const display = npcModelDisplay(npc.id);
    const viewers: Player[] = [];
    let hiddenForSomeone = false;
    for (const player of players) {
      const hidden = shouldHideFrom(npc, player);
      if (hidden) hiddenForSomeone = true;
      else viewers.push(player);
      applyOverride(player, npc, `${player.id}|${npc.id}`, hidden, NPC_HIDDEN_PROPERTY, true);
      if (display) applyOverride(player, display, `${player.id}|${display.id}`, hidden, "cobblemon:scale_modifier", POKEMON_SCALE_MODIFIER_RANGE[0]);
    }
    updateLabel(npc, viewers, hiddenForSomeone);
  }
  finally { refreshing.delete(npc.id); }
}

/** Reaplica o estado de todos os NPCs para todos os jogadores. */
export function refreshNpcHide() {
  const players = world.getAllPlayers();
  for (const npc of allNpcs()) refreshOne(npc, players);
}

/** Reaplica um NPC (nome refeito, exibição recriada, aparência nova) sem esperar o laço. */
export function refreshNpcHideFor(npc: Entity) {
  refreshOne(npc, world.getAllPlayers());
}

/** Sonda: quem não vê o NPC e o que foi aplicado. */
export function describeNpcHide(npc: Entity): string {
  return world.getAllPlayers().map(p => `${p.name}:esconde=${shouldHideFrom(npc, p)} aplicado=${applied.get(`${p.id}|${npc.id}`)}`).join(" ") +
    ` rótulo=${labels.has(npc.id)} nameTag="${npc.nameTag}"`;
}

function forget(match: (key: string) => boolean) {
  for (const key of [...applied.keys()]) if (match(key)) applied.delete(key);
}

/** Liga o NPC escondido por jogador (chamado uma vez pelo registerSocialEvents). */
export function startNpcHide() {
  if (started) return;
  started = true;
  setNpcModelTouchFilter((npc, player) => !shouldHideFrom(npc, player));
  // Exibição recriada e nameTag refeito (set_name, idioma, onLoad): reaplica no mesmo tick, sem mostrar a ninguém.
  setNpcModelSpawnHook(refreshNpcHideFor);
  npcNameTagHooks.push(npc => refreshNpcHideFor(npc.entity));
  // Hitbox/escala nova: altura do rótulo (o gancho pode vir de contexto restrito).
  npcAppearanceHooks.push(npc => {
    const id = npc.entity.id;
    if (labels.has(id)) system.run(() => { const entity = world.getEntity(id); if (entity) refreshNpcHideFor(entity); });
  });
  // O clique no NPC é tratado em scripts/npc/index.ts (sai sem abrir nada para quem não vê).
  world.beforeEvents.entityHurt.subscribe(event => {
    try {
      if (event.hurtEntity.typeId !== NPC_ENTITY_ID) return;
      const attacker = event.damageSource.damagingEntity;
      if (attacker instanceof Player && shouldHideFrom(event.hurtEntity, attacker)) event.cancel = true;
    }
    catch { }
  });
  // Override some no relog e na recarga da entidade: reaplica.
  world.afterEvents.playerSpawn.subscribe(({ player }) => {
    forget(key => key.startsWith(`${player.id}|`));
    system.runTimeout(refreshNpcHide, 20);
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => forget(key => key.startsWith(`${playerId}|`)));
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    try { if (entity.typeId !== NPC_ENTITY_ID) return; }
    catch { return; }
    forget(key => key.endsWith(`|${entity.id}`));
    system.runTimeout(refreshNpcHide, 2);
  });
  world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
    if (!tracked.delete(removedEntityId) && !labels.has(removedEntityId)) return;
    forget(key => key.endsWith(`|${removedEntityId}`));
    removeLabel(removedEntityId);
  });
  system.runInterval(() => {
    try { refreshNpcHide(); }
    catch (e) { console.warn(`NPC: escondidos: ${e}`); }
  }, REFRESH_TICKS);
}
