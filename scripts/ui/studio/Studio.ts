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
import { Block, Dimension, EasingType, Entity, EntityScaleComponent, Player, Vector3, system, world } from "@minecraft/server";
import { VARIANTS } from "../../../generated/scripts/variants";
import { PROFILE_FRAMING } from "../../../generated/scripts/studioFraming"; // frente fix3
import { getEntityInfo } from "../../entity/EntityData";

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
  /**
   * Frente ui-polish: plataforma do tipo sob o modelo (StarterSelectionScreen: `starter_platform_base_<tipo>`). No 3D ela
   * é uma entidade plana no mundo, debaixo dos pés: uma imagem do form ficaria por cima do modelo (a UI é desenhada
   * depois do mundo; 4º teste em cliente real, o disco de lava cobria o Charmander).
   */
  platformType?: string;
}

/** Tipos na ordem das texturas da entidade `cobblemon:studio_platform` (propriedade `cobblemon:platform`). */
export const PLATFORM_TYPES = [
  "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark",
  "steel", "fairy",
] as const;
/** Largura da plataforma do Java (113 px da GUI, StarterSelectionScreen) e a da geometria (1 bloco). */
export const PLATFORM_WIDTH_PX = 113;
const PLATFORM_ENTITY = "cobblemon:studio_platform";

/** Escala da plataforma: 113 px da UI na distância do modelo (`perBlock` = px da UI por bloco), no limite da propriedade. */
export function platformScale(perBlock: number): number {
  return Math.max(0.05, Math.min(64, PLATFORM_WIDTH_PX / Math.max(0.01, perBlock)));
}

/** Índice da textura da plataforma (tipo desconhecido = normal). */
export function platformIndex(type: string | undefined): number {
  const i = PLATFORM_TYPES.indexOf(String(type ?? "").toLowerCase() as (typeof PLATFORM_TYPES)[number]);
  return i >= 0 ? i : 0;
}

/**
 * Enquadramento (frente fix3): o do ModelWidget do Java (StarterSelectionScreen/Summary → drawProfilePokemon com o
 * profileScale/profileTranslation de cada poser, generated/scripts/studioFraming.ts). `window` = janela vazada do form
 * em px da UI (largura, altura e topo acima do centro da tela); `baseScale`/`offsetY` = os do ModelWidget; `yaw` = giro
 * do modelo (0 = de frente para a câmera).
 */
export interface StudioFraming {
  window: { width: number; height: number; top: number };
  baseScale: number;
  offsetY: number;
  yaw: number;
}

/**
 * Resumo: janela 66 × 66 (x+6, y+32 no canvas de 161 → topo 48,5 px acima do centro), ModelWidget(baseScale 2,
 * offsetY -10). Inicial: janela 118 × 100 (x+6, y+17 no canvas de 197 → topo 81,5 px acima), baseScale 2,7, offsetY -12.
 */
export const FRAMING = {
  summary: { window: { width: 66, height: 66, top: 48.5 }, baseScale: 2, offsetY: -10, yaw: -25 },
  starter: { window: { width: 118, height: 100, top: 81.5 }, baseScale: 2.7, offsetY: -12, yaw: -15 },
} as const satisfies Record<string, StudioFraming>;

/**
 * Altura da tela em px da UI. O servidor não sabe a escala da interface do jogador; a câmera fica no tamanho do Java
 * para STUDIO_UI_HEIGHT e o modelo nunca passa da janela até STUDIO_UI_HEIGHT_MAX. No 2º teste em cliente (UI ~360 px),
 * a versão anterior (enquadrada para ~252 px, 34% da altura da TELA) deixou o Charmander 1,2× maior que a janela.
 */
export const STUDIO_UI_HEIGHT = 400;
export const STUDIO_UI_HEIGHT_MAX = 480;
/** Folga (px da UI) entre o modelo e a moldura, na maior altura de UI. */
const WINDOW_MARGIN = 3;
/** Inclinação do ModelWidget (rotação X de 13°): a câmera olha o modelo um pouco de cima. */
const STUDIO_PITCH = 13;

/** Medidas do modelo exibido. */
export interface StudioMetrics {
  /** Altura (blocos, no mundo) e largura aproximadas. */
  height: number;
  width?: number;
  /** Escala da entidade no mundo (minecraft:scale × cobblemon:scale_modifier). */
  scale?: number;
  /** [profileScale, tx, ty] do poser (Java). */
  profile?: readonly [number, number, number];
}

/** [profileScale, tx, ty] do poser da variante (sem dado: [1, 0, 0]). */
export function profileFramingOf(species: string, variant = 0): readonly [number, number, number] {
  const id = speciesId(species);
  const combos = VARIANTS[id]?.combos;
  const poser = (combos?.[variant] ?? combos?.[0])?.poser ?? id;
  const name = poser.includes(":") ? poser.slice(poser.indexOf(":") + 1) : poser;
  return PROFILE_FRAMING[name] ?? PROFILE_FRAMING[id] ?? [1, 0, 0];
}

interface Session {
  playerId: string;
  dimension: Dimension;
  stage: Vector3;
  floor?: Vector3;
  entityId?: string;
  /** Frente ui-polish: plataforma do tipo sob o modelo. */
  platformId?: string;
  subjectKey?: string;
  /** Frente fix3: o que está sendo exibido (poser do Java para o enquadramento). */
  subject?: StudioSubject;
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
    // Frente fix3: a câmera fica até STUDIO_MAX_DISTANCE ao sul (e até ~9 acima, pela inclinação de 13°): Pokémon
    // grandes no tamanho do Java pedem 20–35 blocos (Onix no inicial ~22, no resumo ~34).
    for (let dy = 0; dy < 11 && clear; dy++)
      for (const dz of STAGE_CHECK_DZ) if (!isAir(blockAt({ x, y: y + dy, z: z + dz }))) { clear = false; break; }
    if (clear && isAir(blockAt({ x, y: y - 1, z }))) return { x, y, z };
  }
  return undefined;
}

/** Maior distância da câmera ao modelo (blocos) e as posições conferidas ao sul do palco. */
export const STUDIO_MAX_DISTANCE = 40;
const STAGE_CHECK_DZ = [0, 3, 6, 9, 12, 16, 20, 24, 28, 32, 36, 40];

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

/**
 * Posição da câmera e ponto de mira (frente fix3). No Java: `px da GUI por bloco do modelo = baseScale × 20 × profileScale`
 * e os pés em `topo da janela + offsetY + baseScale × 20 × (ty + 1,5 × profileScale)`. Aqui a mesma conta em px da UI
 * na altura de referência (STUDIO_UI_HEIGHT), corrigida pela escala da entidade no mundo, e depois limitada para o
 * modelo (altura/largura medidas) caber na janela até STUDIO_UI_HEIGHT_MAX. `metrics` como número = só a altura.
 */
export function cameraFor(stage: Vector3, metrics: StudioMetrics | number, framing: StudioFraming, fov = STUDIO_FOV): { location: Vector3; facing: Vector3; distance: number; perBlock: number } {
  const m: StudioMetrics = typeof metrics === "number" ? { height: metrics } : metrics;
  const [ps, tx, ty] = m.profile ?? [1, 0, 0];
  const scale = m.scale && m.scale > 0 ? m.scale : 1;
  const k = framing.baseScale * 20;
  const win = framing.window;
  // px da UI por bloco do mundo e os pés (px acima do centro da tela), na altura de referência.
  let perBlock = (k * Math.max(0.05, ps)) / scale;
  let feetUp = win.top - (framing.offsetY + k * (ty + 1.5 * ps));
  const xOff = k * tx;
  // Limites da janela na maior altura de UI (tudo escala em volta do centro da tela).
  const grow = STUDIO_UI_HEIGHT_MAX / STUDIO_UI_HEIGHT;
  const top = (win.top - WINDOW_MARGIN) / grow;
  const bottom = (win.top - win.height + WINDOW_MARGIN) / grow;
  const halfWidth = (win.width / 2 - WINDOW_MARGIN) / grow;
  const h = Math.max(0.2, m.height);
  const pitch = (STUDIO_PITCH * Math.PI) / 180;
  // Visto de cima (pitch), a aresta de baixo da frente desce e a de cima de trás sobe; +6% pela perspectiva.
  const half = (m.width && m.width > 0 ? m.width : h * 0.8) / 2;
  const below = 1.06 * half * Math.sin(pitch);
  const above = 1.06 * (h * Math.cos(pitch) + half * Math.sin(pitch));
  if (feetUp - below * perBlock < bottom) feetUp = bottom + below * perBlock;
  if (feetUp + above * perBlock > top) perBlock = Math.max(1, (top - feetUp) / above);
  if (1.06 * half * perBlock + Math.abs(xOff) > halfWidth) perBlock = Math.max(1, (halfWidth - Math.abs(xOff)) / (1.06 * half));
  if (feetUp - below * perBlock < bottom) feetUp = bottom + below * perBlock;
  const tan = Math.tan((fov * Math.PI) / 360);
  // Um bloco a `distance` ocupa STUDIO_UI_HEIGHT / (2·distance·tan) px da UI.
  const distance = Math.min(STUDIO_MAX_DISTANCE, Math.max(1.2, STUDIO_UI_HEIGHT / (2 * tan * perBlock)));
  const unit = (2 * distance * tan) / STUDIO_UI_HEIGHT; // blocos por px da UI na distância do modelo
  // Ponto que cai no centro da tela: os pés ficam `feetUp` px acima dele (câmera inclinada `pitch` para baixo).
  const target = { x: stage.x - xOff * unit, y: stage.y - (feetUp * unit) / Math.cos(pitch), z: stage.z };
  return {
    location: { x: target.x, y: target.y + distance * Math.sin(pitch), z: target.z + distance * Math.cos(pitch) },
    facing: target,
    distance,
    // px da UI por bloco que a câmera usa (a distância pode ter sido limitada: vale o efetivo).
    perBlock: STUDIO_UI_HEIGHT / (2 * distance * tan),
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

function removePlatform(session: Session) {
  if (!session.platformId) return;
  try { world.getEntity(session.platformId)?.remove(); } catch { }
  session.platformId = undefined;
}

/** Põe/atualiza/tira a plataforma do tipo debaixo do modelo (ver StudioSubject.platformType). */
function syncPlatform(session: Session, perBlock: number) {
  const type = session.subject?.platformType;
  if (!type) { removePlatform(session); return; }
  let platform = session.platformId ? world.getEntity(session.platformId) : undefined;
  if (!platform?.isValid) {
    try {
      // 1/100 de bloco acima do chão de barreira (os pés do modelo): a plataforma fica por baixo dele no mundo.
      platform = session.dimension.spawnEntity(PLATFORM_ENTITY, { x: session.stage.x, y: session.stage.y + 0.01, z: session.stage.z }, { initialPersistence: false });
    } catch (e) {
      console.warn(`Estúdio: plataforma: ${e}`);
      return;
    }
    platform.addTag(STUDIO_TAG);
    session.platformId = platform.id;
  }
  try { platform.setProperty("cobblemon:platform", platformIndex(type)); } catch { }
  try { platform.setProperty("cobblemon:platform_scale", platformScale(perBlock)); } catch { }
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
  session.subject = subject;
  return entity;
}

/** Medidas do modelo exibido: altura pela cabeça (+20%), largura pela caixa de colisão, escala e o poser do Java. */
function metricsOf(entity: Entity | undefined, subject: StudioSubject | undefined): StudioMetrics {
  const metrics: StudioMetrics = { height: 1 };
  try {
    if (entity?.isValid) {
      metrics.height = Math.max(0.3, (entity.getHeadLocation().y - entity.location.y) * 1.2);
      const base = (entity.getComponent("minecraft:scale") as EntityScaleComponent | undefined)?.value ?? 1;
      const modifier = entity.getProperty("cobblemon:scale_modifier");
      metrics.scale = base * (typeof modifier === "number" && modifier > 0 ? modifier : 1);
      const size = getEntityInfo(entity.typeId)?.sizes[0];
      if (size) metrics.width = size.width * size.scale * 1.3;
    }
  } catch { }
  if (subject) metrics.profile = profileFramingOf(subject.species, subject.variant ?? 0);
  return metrics;
}

function aimCamera(player: Player, session: Session, entity: Entity | undefined, ease: boolean) {
  const { location, facing, perBlock } = cameraFor(session.stage, metricsOf(entity, session.subject), session.framing);
  syncPlatform(session, perBlock);
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
  removePlatform(session);
  if (session.floor) restoreFloor(session.dimension, session.floor);
  session.floor = undefined;
}

/** Remove o que uma queda do servidor deixou: entidades de exibição e chãos anotados. */
export function sweepStudioLeftovers() {
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      const dimension = world.getDimension(id);
      for (const entity of dimension.getEntities({ tags: [STUDIO_TAG] })) {
        if ([...sessions.values()].some(s => s.entityId === entity.id || s.platformId === entity.id)) continue;
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
    return ![...sessions.values()].some(s => s.entityId === entity.id || s.platformId === entity.id);
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
