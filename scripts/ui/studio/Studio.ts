/**
 * Frente "telas": estúdio de câmera (docs/pesquisa/1-interface.md §3.2) — modelo 3D ao vivo atrás de um form.
 *
 * Nenhum renderer de JSON UI desenha uma entidade arbitrária num form. Então a tela vai por cima da CÂMERA: a espécie
 * é spawnada num "estúdio" acima do jogador (mesma coluna de chunks, carregada), em cima de um bloco de barreira
 * temporário, sem IA (evento de spawn vazio, então os grupos de IA do `minecraft:entity_spawned` não entram), e a
 * câmera `minecraft:free` olha para ela. O layout "estúdio" do form deixa a janela do retrato vazada exatamente onde a
 * câmera põe o modelo (centro horizontal da tela; a altura vem de `ny`). Modelo, textura, variante, shiny e
 * animações de idle são os mesmos do mundo.
 *
 * Limpeza (a entidade e o bloco nunca podem ficar para trás):
 *  - `closeStudio` ao fechar a tela (as telas chamam em `finally`);
 *  - jogador saiu, morreu/renasceu ou trocou de dimensão;
 *  - vigia a cada segundo (entidade sumiu, jogador inválido, sessão velha);
 *  - no worldLoad: entidades com a tag `cobblemon_ui_display` são removidas e os blocos anotados na dynamic property
 *    do mundo voltam a ser ar (queda do servidor com a tela aberta);
 *  - `entityLoad` de uma entidade com a tag fora de sessão (chunk recarregado) → removida (scripts/main.ts).
 */
import { Block, Dimension, EasingType, Entity, Player, Vector3, system, world } from "@minecraft/server";

/** Tag das entidades de exibição (sem ":" para funcionar em seletores de comando). */
export const STUDIO_TAG = "cobblemon_ui_display";
const FLOORS_PROPERTY = "cobblemon:studio_floors";
const BARRIER = "minecraft:barrier";
/** FOV fixo durante o estúdio (o enquadramento não depende da configuração do jogador). */
export const STUDIO_FOV = 60;
/** Sessão mais velha que isto é encerrada pelo vigia (tela esquecida aberta, bug). */
const MAX_SESSION_TICKS = 20 * 60 * 15;

/** O que exibir: espécie e aparência (PokemonData serve). */
export interface StudioSubject {
  species: string;
  variant?: number;
  aspects?: string[];
  entityStates?: Record<string, string | number | boolean>;
}

/**
 * Enquadramento: `fraction` = altura do modelo em fração da altura da tela; `ny` = centro do modelo acima do centro
 * da tela (fração da meia-altura); `yaw` = giro do modelo (0 = de frente para a câmera).
 */
export interface StudioFraming {
  fraction: number;
  ny: number;
  yaw: number;
}

/** Resumo: janela de 66 px (centro 15,5 px acima do centro do canvas de 161). Inicial: janela de 100 px, 31,5 acima. */
export const FRAMING = {
  summary: { fraction: 0.22, ny: 0.12, yaw: -25 },
  starter: { fraction: 0.34, ny: 0.25, yaw: -15 },
} as const satisfies Record<string, StudioFraming>;

interface Session {
  playerId: string;
  dimension: Dimension;
  stage: Vector3;
  floor?: Vector3;
  entityId?: string;
  subjectKey?: string;
  framing: StudioFraming;
  addedNightVision: boolean;
  started: number;
}

const sessions = new Map<string, Session>();

function speciesId(species: string): string {
  const id = species.includes(":") ? species.slice(species.indexOf(":") + 1) : species;
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function subjectKey(subject: StudioSubject): string {
  return `${speciesId(subject.species)}#${subject.variant ?? 0}#${(subject.aspects ?? []).join(",")}`;
}

function isAir(block: Block | undefined): boolean {
  try { return !!block && (block.isAir || block.typeId === BARRIER); } catch { return false; }
}

/**
 * Posição do estúdio para o jogador (acima dele, com ar para o modelo e a câmera) ou undefined (sem espaço:
 * Nether com teto, construções altas, chunk não carregado). Pura o suficiente para testes com um `blockAt` falso.
 */
export function findStage(origin: Vector3, maxY: number, blockAt: (loc: Vector3) => Block | undefined): Vector3 | undefined {
  const x = Math.floor(origin.x) + 0.5;
  const z = Math.floor(origin.z) + 0.5;
  for (const rise of [48, 32, 64, 24]) {
    const y = Math.min(Math.floor(origin.y) + rise, maxY - 10);
    if (y - origin.y < 16) continue;
    let clear = true;
    for (let dy = 0; dy < 6 && clear; dy++)
      for (const dz of [0, 3, 6, 9]) if (!isAir(blockAt({ x, y: y + dy, z: z + dz }))) { clear = false; break; }
    if (clear && isAir(blockAt({ x, y: y - 1, z }))) return { x, y, z };
  }
  return undefined;
}

/** Distância horizontal mínima entre estúdios abertos: um não aparece na câmera do outro nem divide o chão. */
export const STAGE_SPACING = 24;

/**
 * Estúdio livre para o jogador: acima dele ou deslocado em X (±24, ±48) quando outro jogador já tem um estúdio
 * na mesma coluna (vários jogadores novos na tela de iniciais no spawn). Sem isso os dois dividiam o chão de
 * barreira e o modelo, e fechar uma tela derrubava o Pokémon da outra.
 */
export function pickStage(player: Player, dimension: Dimension, others: Vector3[] = otherStages(player.id, dimension.id)): Vector3 | undefined {
  for (const shift of [0, STAGE_SPACING, -STAGE_SPACING, 2 * STAGE_SPACING, -2 * STAGE_SPACING]) {
    const origin = { x: player.location.x + shift, y: player.location.y, z: player.location.z };
    let stage: Vector3 | undefined;
    try { stage = findStage(origin, dimension.heightRange.max, loc => dimension.getBlock(loc)); } catch { }
    if (!stage) continue;
    if (others.some(o => Math.hypot(o.x - stage!.x, o.z - stage!.z) < STAGE_SPACING)) continue;
    return stage;
  }
  return undefined;
}

function otherStages(playerId: string, dimensionId: string): Vector3[] {
  return [...sessions.values()].filter(s => s.playerId !== playerId && s.dimension.id === dimensionId).map(s => s.stage);
}

/** Posição da câmera e ponto de mira para o modelo de altura `height` com o enquadramento dado. */
export function cameraFor(stage: Vector3, height: number, framing: StudioFraming, fov = STUDIO_FOV): { location: Vector3; facing: Vector3; distance: number } {
  const tan = Math.tan((fov * Math.PI) / 360);
  const h = Math.max(0.3, height);
  const distance = Math.min(9, Math.max(1.2, h / (2 * framing.fraction * tan)));
  const center = { x: stage.x, y: stage.y + h / 2, z: stage.z };
  // Modelo acima do centro da tela: a câmera mira abaixo do centro do modelo.
  const drop = framing.ny * distance * tan;
  return {
    location: { x: center.x, y: center.y, z: center.z + distance },
    facing: { x: center.x, y: center.y - drop, z: center.z },
    distance,
  };
}

function readFloors(): { d: string; x: number; y: number; z: number }[] {
  try {
    const raw = world.getDynamicProperty(FLOORS_PROPERTY);
    return typeof raw === "string" ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeFloors(list: { d: string; x: number; y: number; z: number }[]) {
  try { world.setDynamicProperty(FLOORS_PROPERTY, list.length ? JSON.stringify(list) : undefined); } catch { }
}

function restoreFloor(dimension: Dimension, loc: Vector3) {
  try {
    const block = dimension.getBlock(loc);
    if (block?.typeId === BARRIER) block.setType("minecraft:air");
  } catch { }
  writeFloors(readFloors().filter(f => !(f.d === dimension.id && f.x === loc.x && f.y === loc.y && f.z === loc.z)));
}

function removeEntity(session: Session) {
  if (!session.entityId) return;
  try { world.getEntity(session.entityId)?.remove(); } catch { }
  session.entityId = undefined;
  session.subjectKey = undefined;
}

function spawnSubject(session: Session, subject: StudioSubject): Entity | undefined {
  removeEntity(session);
  let entity: Entity;
  try {
    entity = session.dimension.spawnEntity(`cobblemon:${speciesId(subject.species)}`, session.stage, {
      // Evento vazio no lugar do minecraft:entity_spawned: sem IA de selvagem nem "olhar em volta".
      spawnEvent: "cobblemon:interacted",
      initialPersistence: false,
      initialRotation: session.framing.yaw,
    });
  } catch (e) {
    console.warn(`Estúdio: não foi possível exibir ${subject.species}: ${e}`);
    return undefined;
  }
  // A tag vem antes do afterEvents.entitySpawn (fim do tick): scripts/main.ts não inicia dados de selvagem nela.
  entity.addTag(STUDIO_TAG);
  try { entity.nameTag = ""; } catch { }
  try { entity.setProperty("cobblemon:variant", subject.variant ?? 0); } catch { }
  for (const [key, value] of Object.entries(subject.entityStates ?? {})) {
    try { if (entity.getProperty(key) !== undefined) entity.setProperty(key, value); } catch { }
  }
  try { if ((subject.aspects ?? []).includes("alpha")) entity.triggerEvent("cobblemon:set_alpha"); } catch { }
  try { entity.setProperty("cobblemon:initialized", true); } catch { }
  session.entityId = entity.id;
  session.subjectKey = subjectKey(subject);
  return entity;
}

function aimCamera(player: Player, session: Session, entity: Entity | undefined, ease: boolean) {
  let height = 1;
  try { if (entity?.isValid) height = Math.max(0.3, (entity.getHeadLocation().y - entity.location.y) * 1.2); } catch { }
  const { location, facing } = cameraFor(session.stage, height, session.framing);
  try {
    player.camera.setCamera("minecraft:free", {
      location,
      facingLocation: facing,
      ...(ease ? { easeOptions: { easeTime: 0.35, easeType: EasingType.InOutSine } } : {}),
    });
  } catch (e) { console.warn(`Estúdio: câmera: ${e}`); }
}

/** O estúdio pode abrir para este jogador agora (espaço livre acima dele)? */
export function studioAvailable(player: Player): boolean {
  if (sessions.has(player.id)) return true;
  try {
    const dimension = player.dimension;
    return findStage(player.location, dimension.heightRange.max, loc => dimension.getBlock(loc)) !== undefined;
  } catch { return false; }
}

export function hasStudio(player: Player): boolean {
  return sessions.has(player.id);
}

/** Entidade exibida no estúdio do jogador (grito ao tocar no modelo do resumo; frente dados-ui). */
export function studioEntityOf(player: Player): Entity | undefined {
  const id = sessions.get(player.id)?.entityId;
  if (!id) return undefined;
  try { const entity = world.getEntity(id); return entity?.isValid ? entity : undefined; } catch { return undefined; }
}

/**
 * Abre (ou reaproveita) o estúdio com o `subject`. false = sem espaço/erro: a tela usa o retrato 2D.
 */
export function openStudio(player: Player, subject: StudioSubject, framing: StudioFraming): boolean {
  let session = sessions.get(player.id);
  if (session) {
    session.framing = framing;
    setStudioSubject(player, subject);
    return true;
  }
  const dimension = player.dimension;
  const stage = pickStage(player, dimension);
  if (!stage) return false;
  session = { playerId: player.id, dimension, stage, framing, addedNightVision: false, started: system.currentTick };
  // Chão invisível temporário (anotado no mundo antes de colocar, para a limpeza pós-queda).
  const floor = { x: Math.floor(stage.x), y: stage.y - 1, z: Math.floor(stage.z) };
  try {
    const block = dimension.getBlock(floor);
    if (block?.isAir) {
      writeFloors([...readFloors(), { d: dimension.id, ...floor }]);
      block.setType(BARRIER);
      session.floor = floor;
    }
  } catch { }
  sessions.set(player.id, session);
  const entity = spawnSubject(session, subject);
  if (!entity) {
    closeStudio(player);
    return false;
  }
  try { player.camera.fade({ fadeTime: { fadeInTime: 0.1, holdTime: 0.15, fadeOutTime: 0.25 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch { }
  try { player.camera.setFov({ fov: STUDIO_FOV }); } catch { }
  try { player.onScreenDisplay.hideAllExcept([]); } catch { }
  // Noite/caverna: visão noturna sem partículas enquanto a tela está aberta (só se o jogador não tinha).
  try {
    if (!player.getEffect("night_vision")) {
      player.addEffect("night_vision", MAX_SESSION_TICKS, { showParticles: false });
      session.addedNightVision = true;
    }
  } catch { }
  aimCamera(player, session, entity, false);
  // A altura da cabeça só é confiável depois do primeiro tick da entidade.
  system.runTimeout(() => {
    const current = sessions.get(player.id);
    if (current !== session || !player.isValid) return;
    aimCamera(player, session, entity.isValid ? entity : undefined, false);
  }, 2);
  return true;
}

/** Troca o Pokémon exibido (carrossel do inicial, outro membro do time no resumo). */
export function setStudioSubject(player: Player, subject: StudioSubject) {
  const session = sessions.get(player.id);
  if (!session) return;
  if (session.subjectKey === subjectKey(subject) && session.entityId && world.getEntity(session.entityId)?.isValid) return;
  const entity = spawnSubject(session, subject);
  aimCamera(player, session, entity, true);
  system.runTimeout(() => {
    if (sessions.get(player.id) !== session || !player.isValid || !entity?.isValid) return;
    aimCamera(player, session, entity, true);
  }, 2);
}

/** Fecha o estúdio: câmera, FOV, HUD, efeito, entidade e chão. Idempotente. */
export function closeStudio(player: Player) {
  const session = sessions.get(player.id);
  if (!session) return;
  sessions.delete(player.id);
  cleanupSession(session);
  if (!player.isValid) return;
  try { player.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.25 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch { }
  try { player.camera.clear(); } catch { }
  try { player.runCommand("camera @s fov_clear"); } catch { }
  try { player.onScreenDisplay.resetHudElementsVisibility(); } catch { }
  if (session.addedNightVision) {
    try { player.removeEffect("night_vision"); } catch { }
  }
}

function cleanupSession(session: Session) {
  removeEntity(session);
  if (session.floor) restoreFloor(session.dimension, session.floor);
  session.floor = undefined;
}

/** Remove o que uma queda do servidor deixou: entidades de exibição e chãos anotados. */
export function sweepStudioLeftovers() {
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      const dimension = world.getDimension(id);
      for (const entity of dimension.getEntities({ tags: [STUDIO_TAG] })) {
        if ([...sessions.values()].some(s => s.entityId === entity.id)) continue;
        entity.remove();
      }
    } catch { }
  }
  for (const floor of readFloors()) {
    if ([...sessions.values()].some(s => s.floor && s.dimension.id === floor.d && s.floor.x === floor.x && s.floor.y === floor.y && s.floor.z === floor.z)) continue;
    try { restoreFloor(world.getDimension(floor.d), floor); } catch { }
  }
}

/**
 * O spawn do mundo põe o jogador no bloco mais alto da coluna. Com a tela de outro jogador aberta no spawn, esse
 * bloco é o chão de barreira do estúdio (48 blocos acima): o jogador nasce nele e cai quando o estúdio fecha.
 * Quem nasce em cima de um chão de estúdio anotado desce para o primeiro bloco sólido abaixo dele.
 */
function dropFromStudioFloor(player: Player) {
  const dimension = player.dimension;
  const { x, y, z } = player.location;
  const under = { x: Math.floor(x), y: Math.floor(y) - 1, z: Math.floor(z) };
  const onFloor = readFloors().some(f => f.d === dimension.id && f.x === under.x && f.y === under.y && f.z === under.z);
  if (!onFloor || dimension.getBlock(under)?.typeId !== BARRIER) return;
  // A busca inclui o bloco de partida: começa logo abaixo da barreira.
  const ground = dimension.getBlockBelow({ x: under.x, y: under.y - 1, z: under.z }, { includeLiquidBlocks: true });
  if (!ground) return;
  player.teleport({ x, y: ground.location.y + 1, z });
}

/** Entidade de exibição carregada sem sessão (chunk recarregado): remover. */
export function isOrphanStudioEntity(entity: Entity): boolean {
  try {
    // Entidade de exibição da batalha (Illusion/Transform, frente visual-batalha): sempre sai ao carregar do disco.
    // A propriedade `cobblemon:in_battle` do Pokémon real pode ter ficado de uma queda (disfarce eterno); numa batalha
    // viva o followMock percebe a entidade inválida e mostra o Pokémon real.
    if (entity.hasTag(BATTLE_MOCK_TAG)) return true;
    if (!entity.hasTag(STUDIO_TAG)) return false;
    return ![...sessions.values()].some(s => s.entityId === entity.id);
  } catch { return false; }
}

/** Tag das entidades de exibição da batalha (scripts/battle/effects/Mock.ts: MOCK_TAG), sem importar a batalha. */
const BATTLE_MOCK_TAG = "cobblemon_battle_mock";

let started = false;

/** Liga a limpeza automática (uma vez, no worldLoad). */
export function startStudio() {
  if (started) return;
  started = true;
  sweepStudioLeftovers();
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    const session = sessions.get(playerId);
    if (!session) return;
    sessions.delete(playerId);
    cleanupSession(session);
  });
  world.afterEvents.playerDimensionChange.subscribe(({ player }) => closeStudio(player));
  world.afterEvents.playerSpawn.subscribe(({ player }) => {
    closeStudio(player);
    try { dropFromStudioFloor(player); } catch { }
  });
  system.runInterval(() => {
    for (const [playerId, session] of [...sessions]) {
      const player = world.getEntity(playerId) as Player | undefined;
      const stale = system.currentTick - session.started > MAX_SESSION_TICKS;
      const entity = session.entityId ? world.getEntity(session.entityId) : undefined;
      if (!player?.isValid || stale) {
        sessions.delete(playerId);
        cleanupSession(session);
        if (player?.isValid) { try { player.camera.clear(); } catch { } }
        continue;
      }
      // A entidade sumiu (morta, removida por outro sistema): põe de novo não; só libera a câmera.
      if (session.entityId && !entity?.isValid) closeStudio(player);
    }
  }, 20);
}
