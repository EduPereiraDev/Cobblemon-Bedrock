/**
 * NPC com modelo de Pokémon (#53, §8 "NPC com modelo de Pokémon"). Ligado por padrão, pelos mesmos dados do Java:
 * o `resourceIdentifier` efetivo do NPC (classe/preset, behaviour `cobblemon:npc/resource_identifier` do editor ou
 * MoLang `q.entity.set_resource_identifier('cobblemon:mudkip')`) aponta para uma espécie.
 *
 * Java: o NPCRenderer desenha o poser/textura/camadas da espécie no lugar do NPC; a entidade continua sendo o
 * NPCEntity (IA, nome, diálogo, batalha). No Bedrock cada espécie é uma client entity, então (pesquisa 8 §1):
 *  - o modelo do NPC some (`cobblemon:npc_hidden` + part_visibility, gerado por tools/importer/npcs.ts);
 *  - uma **entidade de exibição** da espécie monta o NPC (grupo `cobblemon:npc_model_seat`, assento na origem). Se o
 *    assento falhar, ela segue o NPC por teleporte a cada tick. Leva a tag do estúdio (`cobblemon_ui_display`): o
 *    main.ts não cria dados de selvagem para ela, e ela é removida ao recarregar do disco (a daqui a recria);
 *  - variante/aspects do NPC (resolveVariant + cobblemon:aspects), escala renderScale × modelScale × hitboxScale
 *    (PokemonModelData.ts), nome vazio (o nome é o nameTag do NPC) e `cobblemon:in_battle` espelhado (pose de batalha);
 *  - cabeça: a exibição gira para onde o NPC olha (direção da cabeça do NPC), a cada tick;
 *  - clique na exibição = clique no NPC (diálogo/batalha); dano na exibição vai para o NPC;
 *  - hitbox do NPC = a da espécie (NPC.defaultHitbox), salvo set_hitbox/editor;
 *  - limpeza: NPC removido/descarregado leva a exibição junto; ao carregar de novo ela é recriada.
 * O NPC escondido por jogador (NpcHide.ts) também encolhe a exibição só para quem não vê o NPC.
 */
import { Entity, EntityDamageCause, EntityRideableComponent, Player, system, world } from "@minecraft/server";
import { resolveVariant } from "../../generated/scripts/variants";
import { syncAspectBits } from "../entity/AspectSync";
import { NPC, NPC_ENTITY_ID, interactWithNPC, isNPCEntity, npcAppearanceHooks, tryPromptNPCBattle } from "./NPCEntity";
import { NPC_HIDDEN_PROPERTY, angleDelta, pokemonModelScaleModifier, rotationFromView } from "./PokemonModelData";

export { NPC_HIDDEN_PROPERTY } from "./PokemonModelData";
/** Tag das entidades de exibição do modelo de Pokémon de NPC. */
export const NPC_MODEL_TAG = "cobblemon_npc_model";
/** Tag do estúdio (scripts/ui/studio/Studio.ts: STUDIO_TAG), repetida para não puxar o estúdio. */
const DISPLAY_TAG = "cobblemon_ui_display";
/** Id da entidade do NPC dono da exibição. */
const MODEL_OF_PROPERTY = "cobblemon:npc_model_of";
const SEAT_ON_EVENT = "cobblemon:npc_model_seat_on";
const SEAT_OFF_EVENT = "cobblemon:npc_model_seat_off";
/** Ticks entre ligar o assento e montar (com 1 tick o grupo ainda não entrou; medido na pesquisa 8). */
const SEAT_DELAY_TICKS = 5;
const SEAT_TRIES = 3;
/** Intervalo mínimo entre recriações da exibição de um mesmo NPC. */
const RESPAWN_COOLDOWN_TICKS = 20;
/** Causas que removem a exibição de verdade (/kill, vazio); ela volta no próximo passe. */
const LETHAL_CAUSES = new Set<string>([EntityDamageCause.override, EntityDamageCause.selfDestruct, EntityDamageCause.void]);

export type NpcModelMode = "ride" | "follow";

interface ModelState {
  species: string;
  displayId?: string;
  mode: NpcModelMode;
  seated: boolean;
  seatTries: number;
  spawnedAt: number;
  lastRotation?: { x: number; y: number };
  inBattle?: boolean;
}

const models = new Map<string, ModelState>();
const pending = new Set<string>();
let flushScheduled = false;
let started = false;

function valid(entity: Entity | undefined): entity is Entity {
  try { return !!entity?.isValid; } catch { return false; }
}

/** Entidade de exibição do NPC (se existir). */
export function npcModelDisplay(npcId: string): Entity | undefined {
  const state = models.get(npcId);
  const entity = state?.displayId ? world.getEntity(state.displayId) : undefined;
  return valid(entity) ? entity : undefined;
}

/** NPCs com modelo de Pokémon agora (id da entidade do NPC → espécie). */
export function npcModels(): ReadonlyMap<string, { species: string; displayId?: string; mode: NpcModelMode; seated: boolean }> {
  return models;
}

function removeDisplay(state: ModelState | undefined) {
  if (!state?.displayId) return;
  const entity = world.getEntity(state.displayId);
  state.displayId = undefined;
  state.seated = false;
  if (!valid(entity)) return;
  try { entity.remove(); }
  catch { try { entity.triggerEvent("cobblemon:instant_kill"); } catch { } }
}

function setPropertyIfChanged(entity: Entity, id: string, value: boolean | number) {
  try { if (entity.getProperty(id) !== value) entity.setProperty(id, value); }
  catch { /* espécie sem a propriedade */ }
}

/** Variante, aspects e escala da exibição a partir do NPC. */
function applyAppearance(display: Entity, npc: NPC, species: string) {
  const aspects = npc.aspects;
  setPropertyIfChanged(display, "cobblemon:variant", resolveVariant(species, aspects));
  syncAspectBits(display, aspects);
  setPropertyIfChanged(display, "cobblemon:scale_modifier", pokemonModelScaleModifier(species, npc.renderScale, npc.hitboxScale));
  setPropertyIfChanged(display, "cobblemon:initialized", true);
}

function spawnDisplay(npcEntity: Entity, state: ModelState): Entity | undefined {
  const npc = new NPC(npcEntity);
  let display: Entity;
  try {
    display = npcEntity.dimension.spawnEntity(`cobblemon:${state.species}`, npcEntity.location, {
      // Evento vazio: sem os grupos de selvagem/IA do entity_spawned.
      spawnEvent: "cobblemon:interacted",
      initialPersistence: false,
      initialRotation: npcEntity.getRotation().y,
    });
  }
  catch (e) {
    console.warn(`NPC: modelo ${state.species} de ${npcEntity.id}: ${e}`);
    state.spawnedAt = system.currentTick;
    return undefined;
  }
  display.addTag(DISPLAY_TAG);
  display.addTag(NPC_MODEL_TAG);
  try { display.setDynamicProperty(MODEL_OF_PROPERTY, npcEntity.id); } catch { }
  try { display.nameTag = ""; } catch { }
  applyAppearance(display, npc, state.species);
  state.displayId = display.id;
  state.seated = false;
  state.seatTries = 0;
  state.spawnedAt = system.currentTick;
  state.lastRotation = undefined;
  state.inBattle = undefined;
  if (state.mode === "ride") {
    try { npcEntity.triggerEvent(SEAT_ON_EVENT); }
    catch { state.mode = "follow"; }
  }
  // Exibição nova já nasce escondida para quem não vê o NPC (sem esperar o próximo refresh do NpcHide.ts).
  try { onDisplaySpawned(npcEntity); }
  catch (e) { console.warn(`NPC: exibição nova de ${npcEntity.id}: ${e}`); }
  return display;
}

/** Liga, troca ou desliga o modelo conforme o resourceIdentifier efetivo do NPC. */
export function syncNpcPokemonModel(npcEntity: Entity): void {
  if (!isNPCEntity(npcEntity)) return;
  const npc = new NPC(npcEntity);
  const species = npc.pokemonModelSpecies;
  const id = npcEntity.id;
  const state = models.get(id);
  setPropertyIfChanged(npcEntity, NPC_HIDDEN_PROPERTY, !!species);
  if (!species) {
    if (state) {
      removeDisplay(state);
      models.delete(id);
      try { npcEntity.triggerEvent(SEAT_OFF_EVENT); } catch { }
    }
    return;
  }
  if (state && state.species === species) {
    const display = npcModelDisplay(id);
    if (display) applyAppearance(display, npc, species);
    else if (system.currentTick - state.spawnedAt >= RESPAWN_COOLDOWN_TICKS) spawnDisplay(npcEntity, state);
    return;
  }
  removeDisplay(state);
  const next: ModelState = { species, mode: "ride", seated: false, seatTries: 0, spawnedAt: -Infinity };
  models.set(id, next);
  spawnDisplay(npcEntity, next);
}

/** Agenda a sincronização (o gancho pode vir de contexto restrito: spawnEntity só roda no system.run). */
function requestSync(npcId: string) {
  pending.add(npcId);
  if (flushScheduled) return;
  flushScheduled = true;
  system.run(() => {
    flushScheduled = false;
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      const entity = world.getEntity(id);
      if (!valid(entity)) continue;
      try { syncNpcPokemonModel(entity); }
      catch (e) { console.warn(`NPC: modelo de Pokémon de ${id}: ${e}`); }
    }
  });
}

function ridingOn(entity: Entity): string | undefined {
  try { return entity.getComponent("minecraft:riding")?.entityRidingOn?.id; }
  catch { return undefined; }
}

function tickModel(npcId: string, state: ModelState, tick: number) {
  const npcEntity = world.getEntity(npcId);
  if (!valid(npcEntity)) {
    removeDisplay(state);
    models.delete(npcId);
    return;
  }
  let display = npcModelDisplay(npcId);
  if (!display) {
    // Exibição sumiu (/kill, chunk recarregado): recria.
    if (tick - state.spawnedAt >= RESPAWN_COOLDOWN_TICKS) display = spawnDisplay(npcEntity, state);
    if (!display) return;
  }
  if (display.dimension.id !== npcEntity.dimension.id) {
    removeDisplay(state);
    return;
  }
  if (state.mode === "ride" && !state.seated && tick - state.spawnedAt >= SEAT_DELAY_TICKS) {
    let ok = false;
    try { ok = (npcEntity.getComponent("minecraft:rideable") as EntityRideableComponent | undefined)?.addRider(display) ?? false; }
    catch { ok = false; }
    if (ok) state.seated = true;
    else if (++state.seatTries >= SEAT_TRIES) {
      state.mode = "follow";
      try { npcEntity.triggerEvent(SEAT_OFF_EVENT); } catch { }
    }
    else state.spawnedAt = tick;
  }
  else if (state.mode === "ride" && state.seated && ridingOn(display) !== npcId) {
    // Desmontou (teleporte do NPC, /ride): monta de novo.
    state.seated = false;
    state.spawnedAt = tick;
  }
  // Cabeça: a exibição olha para onde o NPC olha.
  let rotation: { x: number; y: number };
  try { rotation = rotationFromView(npcEntity.getViewDirection()); }
  catch { rotation = npcEntity.getRotation(); }
  const turned = !state.lastRotation || angleDelta(state.lastRotation.y, rotation.y) > 1.5 || Math.abs(state.lastRotation.x - rotation.x) > 1.5;
  try {
    if (state.mode === "follow" || !state.seated) {
      display.teleport(npcEntity.location, { dimension: npcEntity.dimension, rotation });
      state.lastRotation = rotation;
    }
    else if (turned) {
      display.setRotation(rotation);
      state.lastRotation = rotation;
    }
  }
  catch { }
  // Compara com o valor da exibição (não só com o último aplicado): algo de fora pode ter mudado a propriedade dela.
  const inBattle = npcEntity.getProperty("cobblemon:in_battle") === true;
  state.inBattle = inBattle;
  setPropertyIfChanged(display, "cobblemon:in_battle", inBattle);
}

/** NPC dono de uma entidade de exibição (ou undefined). */
export function npcOfModelDisplay(entity: Entity): Entity | undefined {
  try {
    if (!entity.hasTag(NPC_MODEL_TAG)) return undefined;
    const id = entity.getDynamicProperty(MODEL_OF_PROPERTY);
    const npc = typeof id === "string" ? world.getEntity(id) : undefined;
    return valid(npc) ? npc : undefined;
  }
  catch { return undefined; }
}

/** Filtro de quem pode interagir/ferir o NPC (NpcHide.ts registra: quem não vê o NPC não clica nele). */
let canTouch: (npc: Entity, player: Player) => boolean = () => true;
export function setNpcModelTouchFilter(filter: (npc: Entity, player: Player) => boolean) { canTouch = filter; }
/** Chamado logo depois de criar a exibição (NpcHide.ts registra: reaplica o NPC escondido na exibição nova). */
let onDisplaySpawned: (npc: Entity) => void = () => { };
export function setNpcModelSpawnHook(hook: (npc: Entity) => void) { onDisplaySpawned = hook; }

/** Liga o modelo de Pokémon dos NPCs (chamado uma vez pelo registerSocialEvents). */
export function startNpcPokemonModels() {
  if (started) return;
  started = true;
  npcAppearanceHooks.push(npc => requestSync(npc.entity.id));

  // Clique na exibição = clique no NPC (diálogo/batalha). O main.ts também cancela e repassa ao handlePokemonInteract,
  // que não faz nada numa entidade sem dados de Pokémon.
  world.beforeEvents.playerInteractWithEntity.subscribe(event => {
    const npc = npcOfModelDisplay(event.target);
    if (!npc) return;
    event.cancel = true;
    const player = event.player;
    if (!canTouch(npc, player)) return;
    system.run(() => {
      if (!player.isValid || !valid(npc)) return;
      if (tryPromptNPCBattle(player, npc)) return;
      interactWithNPC(player, npc);
    });
  });
  // A exibição não toma dano: o golpe vai para o NPC (quem conta), como no Java (a hitbox é a do NPC).
  world.beforeEvents.entityHurt.subscribe(event => {
    let hurt: Entity;
    try { hurt = event.hurtEntity; if (!hurt.hasTag(NPC_MODEL_TAG)) return; }
    catch { return; }
    if (LETHAL_CAUSES.has(event.damageSource.cause)) return;
    event.cancel = true;
    const npc = npcOfModelDisplay(hurt);
    const attacker = event.damageSource.damagingEntity;
    if (!npc || !attacker || (attacker instanceof Player && !canTouch(npc, attacker))) return;
    const damage = event.damage;
    const cause = event.damageSource.cause;
    system.run(() => {
      if (!valid(npc) || !valid(attacker)) return;
      try { npc.applyDamage(damage, { cause, damagingEntity: attacker }); } catch { }
    });
  });
  world.afterEvents.entityRemove.subscribe(({ removedEntityId, typeId }) => {
    if (typeId !== NPC_ENTITY_ID) return;
    const state = models.get(removedEntityId);
    if (!state) return;
    // NPC removido ou descarregado: a exibição sai junto (volta no entityLoad do NPC, pelo onLoad).
    removeDisplay(state);
    models.delete(removedEntityId);
  });
  system.runInterval(() => {
    if (!models.size) return;
    const tick = system.currentTick;
    for (const [npcId, state] of [...models]) {
      try { tickModel(npcId, state, tick); }
      catch (e) { console.warn(`NPC: modelo de Pokémon de ${npcId}: ${e}`); }
    }
  }, 1);
  // NPCs já carregados quando o script sobe (/reload): o entityLoad não dispara para eles.
  system.runTimeout(() => {
    for (const dim of ["overworld", "nether", "the_end"]) {
      try {
        for (const entity of world.getDimension(dim).getEntities({ type: NPC_ENTITY_ID }))
          if (entity.getDynamicProperty("npc:class") !== undefined) requestSync(entity.id);
      }
      catch { }
    }
  }, 40);
}

/** Resumo para a sonda de depuração/E2E. */
export function describeNpcModel(npcEntity: Entity): string {
  const state = models.get(npcEntity.id);
  const display = npcModelDisplay(npcEntity.id);
  const npc = new NPC(npcEntity);
  const hitbox = npc.hitbox;
  const base = `npc=${npcEntity.id} rid=${npc.resourceIdentifier} espécie=${npc.pokemonModelSpecies ?? "-"} ` +
    `oculto=${String(npcEntity.getProperty(NPC_HIDDEN_PROPERTY))} hitbox=${hitbox.width}x${hitbox.height}`;
  if (!state || !display) return `${base} sem exibição`;
  const a = npcEntity.location, b = display.location;
  const view = rotationFromView(npcEntity.getViewDirection());
  const rot = display.getRotation();
  return `${base} exibição=${display.typeId}#${display.id} modo=${state.mode} montada=${state.seated} montada_em=${ridingOn(display) ?? "-"} ` +
    `dist=${Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(3)} cabeça_npc=(${view.x.toFixed(1)},${view.y.toFixed(1)}) ` +
    `rot_exib=(${rot.x.toFixed(1)},${rot.y.toFixed(1)}) variante=${String(display.getProperty("cobblemon:variant"))} ` +
    `escala=${String(display.getProperty("cobblemon:scale_modifier"))} nameTag="${display.nameTag}"`;
}
