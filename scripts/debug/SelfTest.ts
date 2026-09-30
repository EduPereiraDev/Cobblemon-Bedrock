/**
 * `/cobblemon:selftest [quick|full|ui|entities|movement|blocks|particles|sounds|battle|telas|stop|status] [segundos]` (também
 * `scriptevent cobblemon:selftest <modo> [segundos]`): exercita o add-on de ponta a ponta DENTRO do mundo, no cliente real, para o
 * ContentLog registrar os erros de recursos. O cliente só acusa um recurso (modelo, animação, render controller,
 * partícula, som, bloco, tela JSON UI) quando ele é usado, então o teste força o uso de cada um. `telas` (alias `screens`)
 * é o roteiro para prints: cada tela custom com dados de exemplo, `[segundos]` cada (3..60, padrão 10) ou até fechar.
 * Extensões opcionais podem registrar um modo próprio (scripts/debug/selfTestExtensions.ts): a fase delas roda na mesma
 * área, com o mesmo journal e a mesma limpeza, entra no `full` se pedir e acrescenta paradas ao `telas`.
 *
 * Segurança (nada roda sem o comando; ao terminar não sobra nada):
 *  - área temporária no céu, acima do jogador, que precisa estar TODA vazia (só ar): nenhuma construção é tocada; o
 *    chão é de barreira e cada bloco colocado é anotado para voltar a ser ar;
 *  - movimento (andar, nadar, voar e montaria): caixas seladas de barreira dentro da área (cercado, piscina, volume
 *    aéreo); a água vira barreira antes de virar ar na limpeza (nunca escorre para fora), também depois de uma queda;
 *  - antes de mexer em qualquer coisa, um journal vai para uma dynamic property do mundo (posição, dimensão, rotação,
 *    modo de jogo, área e o snapshot das dynamic properties do jogador) e para "âncoras" (entidades invisíveis salvas
 *    com os chunks da área, caso o servidor caia antes de gravar o mundo): se o servidor cair ou o jogador sair no
 *    meio, a área é limpa quando o chunk carregar e o jogador é restaurado quando entrar de novo;
 *  - time temporário (cópias `battleClone`, nunca gravadas no time do jogador) e modo criativo durante o teste (a
 *    mochila da batalha não gasta itens); inventário comparado e restaurado no fim;
 *  - Pokédex, estatísticas, progresso e conquistas: dynamic properties do jogador voltam ao snapshot (o cache da
 *    Pokédex é descartado e o estado em memória das conquistas é reescrito com a property restaurada); montar não
 *    conclui "started_riding" (a conquista conta como feita só na memória durante a fase de movimento).
 *
 * Trabalho fatiado entre ticks (watchdog ~100 ms): `system.runJob` com um passo por unidade, lotes com pausas.
 */
import {
  Block, BlockPermutation, CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, CustomCommandResult,
  CustomCommandSource, CustomCommandStatus, Dimension, Entity, GameMode, InputPermissionCategory, ItemStack, Player, RawMessage,
  StartupEvent, Vector3, system, world,
} from "@minecraft/server";
import { ActionFormData, MessageFormData, uiManager } from "@minecraft/server-ui";
import { VARIANTS, POSER_ANIMATIONS } from "../../generated/scripts/variants";
import { getSpeciesData } from "../speciesData";
import { BATTLE_CLONE_TAG, PokemonData } from "../Pokemon";
import { FRAMING, STUDIO_TAG, closeStudio, openStudio } from "../ui/studio";
import { openPartyMenu, openPCGui, showSummary } from "../GUI";
import { buildStarterForm, getStarterCategories, starterSpecies, starterStudioSubject } from "../GUI/StarterGUI";
import {
  BATTLE_ACTION, BATTLE_MOVES, BATTLE_SWITCH, BATTLE_TARGET, BLANK, CellForm, GIMMICK_ON_MARKER, PC, SCREEN, SUB, barTexture,
  battleMenuTexture, layoutTitle, typeKeyTexture,
} from "../GUI/layout";
import { getPokemonIconTexture, getPokemonProfileTexture, getPokemonSpriteTexture } from "../GUI/common";
import { forfeitForm, handleMoveRequest, moveTileText } from "../GUI/Battle";
import { boxWallpaperTexturePath } from "../GUI/PCWallpapers";
import { appendPreviewButtons } from "../GUI/PC";
import { renderPokemonName } from "../language";
import { openDexPage, openPokedex } from "../pokedex/PokedexUI";
import { getDexes } from "../pokedex/DexData";
import { forgetPokedex } from "../pokedex/PokedexStorage";
import { openDialogueCommand } from "../npc";
import { getActiveDialogue, stopDialogue } from "../npc/dialogue/DialogueManager";
import { describePokemon } from "../trade/TradeUI";
import { advancementToast, captureToast, openAchievements, showToast } from "../ui";
import { openStatsScreen } from "../ui/StatsScreen";
import { getHudChannel, setHudChannel } from "../ui/HudBus";
import { BATTLE_PROMPT, BattleHudView, BattleTileView, CHANNEL, battleHpText, encodeBattleBody } from "../ui/hudProtocol";
import { partyButtonText } from "../GUI/Party";
import { GIMMICK_ORDER, gimmickLabelKey, gimmickTexture } from "../battle/Gimmicks";
import { displayName, pushParty } from "../ui/PartyOverlay";
import { portraitPath } from "../ui/portraits";
import { ActorType, BAG_ITEMS, BattleActor, BattleFormat, PokemonBattle, isPlayerInAnyBattle, startBattle } from "../battle";
import { ActionResponse, BagItemActionResponse, MoveActionResponse, SwitchActionResponse } from "../battle/ActionResponse";
import { RequestData, requestPokemonUUID } from "../battle/Request";
import { Dex, toID } from "../showdown";
import { forgetMount, getRideStyle, onJumpPressed, trackMountIfRidden } from "../entity/Riding";
import { getEntityInfo, getRideInfo } from "../entity/EntityData";
import { flushRidingDistance } from "../events/PlayerStats";
import { ACHIEVEMENTS_PROPERTY, ADVANCEMENT_DEFS, getAchievements } from "../ui/achievements/tracker";
import { parseAchievements } from "../ui/achievements/engine";
import {
  SELFTEST_BLOCKS, SELFTEST_ENTITIES, SELFTEST_LOCOMOTION, SELFTEST_MANIFEST_BUILT, SELFTEST_PARTICLES, SELFTEST_SOUNDS, SelfTestEntityInfo,
} from "./selfTestManifest";
import {
  anchorPositions, rememberDone, BlockChangeLog, BlockPos, BlockTarget, Coverage, DynamicValue, KNOWN_PROBLEM_SPECIES, LOCOMOTION_ZONES, LocomotionZone, MOVEMENT_ZONES,
  MountRide, MovementTarget, PhasePlan, PokemonTarget, Region, RideStyleName, SCREEN_ANNOUNCE_TICKS, SELFTEST_AREA, SELFTEST_MODES,
  SELFTEST_MODE_ALIASES, ScreenOutcome, ScreenStep, SelfTestJournal, SelfTestMode, SelfTestPhase, StopSignal, WATER_TOP, blockTargets, chunk,
  coverCombos, decodeJournal, decodeSnapshot, diffDynamicProperties, distinctPoserVariants, encodeJournal, encodeSnapshot, formatDuration,
  gridOffsets, holdScreen, isLeftoverWorldKey, isSelfTestLeftoverBlock, isWaterBlock, mountRides, movementLayout, movementRounds,
  movementTargets, nudgeVector, parseScreenSeconds, parseSelfTestMode, planFor, pokemonTargets, regionCells, rideZone, runInBatches,
  sampleEvenly, sampleSounds, screenTour, splitChunks, zoneSlots,
} from "./selfTestPlan";
import type { SelfTestBlockInfo } from "./selfTestManifest";
import {
  SelfTestContext, SelfTestExtension, findSelfTestExtension, isExtensionLeftoverBlock, selfTestExtensions,
} from "./selfTestExtensions";

/** Tag das entidades criadas pelo teste (sem ":" para funcionar em seletores). */
export const SELFTEST_TAG = "cobblemon_selftest";
/** Journal por jogador (`cobblemon:selftest:<id>`) e o snapshot dele em pedaços (`cobblemon:selftest_snap:<id>:<n>`). */
const JOURNAL_PREFIX = "cobblemon:selftest:";
const SNAPSHOT_PREFIX = "cobblemon:selftest_snap:";
/**
 * Âncoras do journal: `cobblemon:machine_storage` (entidade invisível, sem lógica ao carregar) em cada chunk da área, com
 * o journal (e, na primeira, o snapshot) em dynamic properties. Salvam junto com o chunk: se o servidor cair antes de o
 * mundo gravar o journal, os chunks com sobras do teste trazem o journal de volta ao carregar.
 */
const ANCHOR_TYPE = "cobblemon:machine_storage";
const ANCHOR_TAG = "cobblemon_selftest_anchor";
const ANCHOR_JOURNAL = "cobblemon:selftest_journal";
/** Testes já resolvidos (instante de início): âncora velha de um deles só é removida. */
const DONE_PROPERTY = "cobblemon:selftest_done";
const COMMAND_NAME = "cobblemon:selftest";
const MODE_ENUM = "cobblemon:selftestmode";
const SCRIPT_EVENT_ID = "cobblemon:selftest";

/** Área relativa à origem O (canto do bloco sob o jogador, na altura escolhida). */
const AREA = SELFTEST_AREA;
/** Chão de barreira (y = O.y - 1). */
const FLOOR = { minX: -8, maxX: 8, minZ: -7, maxZ: 17 } as const;
/** Onde o jogador fica e para onde a câmera olha. */
const STAND = { x: 0.5, y: 0, z: -4.5 };
const CAMERA = { x: 0.5, y: 5, z: -7.5 };
const CAMERA_TARGET = { x: 0.5, y: 1, z: 8.5 };

/** Pokémon por lote (grade 4×4, espaço 4) e ticks de cada pose (parado, batalha, dormindo). */
const POKEMON_BATCH = 16;
const POSE_TICKS = 15;
/** Outras entidades por lote e ticks por valor de propriedade / por animação. */
const OTHER_BATCH = 12;
const PROPERTY_STEP_TICKS = 4;
const ANIMATION_STEP_TICKS = 8;
/** Blocos por página (grade 8×8, espaço 2) e ticks à vista. */
const BLOCK_PAGE = 64;
const BLOCK_HOLD_TICKS = 30;
/** Partículas e sons por tick. */
const PARTICLES_PER_TICK = 6;
const SOUNDS_PER_TICK = 3;
const SOUND_VOLUME = 0.12;
/** Amostras do quick. */
const SAMPLE_PARTICLES = 160;
const SAMPLE_SOUNDS = 160;
const SAMPLE_OTHER_BALLS = 4;
/** Ticks com cada tela aberta. */
const UI_HOLD_TICKS = 50;
/** Batalha: turnos roteirizados e limite de tempo. */
const BATTLE_TURNS: TurnKind[] = ["move", "switch", "bag", "move"];
const BATTLE_MENU_TICKS = 40;
const BATTLE_TIMEOUT_TICKS = 20 * 120;
/**
 * Movimento: ticks de cada rodada (as três zonas juntas), conferência/empurrão a cada N ticks; passeios de montaria
 * (ticks montado, decolagem no chão antes do pulo duplo, planeio no fim do voo).
 */
const MOVE_TICKS = 80;
const MOVE_STEP_TICKS = 8;
const RIDE_TICKS = 40;
const RIDE_TAKEOFF_TICKS = 14;
const RIDE_GLIDE_TICKS = 12;
/** Resistência V: imune a dano (sufocar numa parede de barreira, briga), então nada morre nem solta item. */
const RESISTANCE_AMPLIFIER = 4;
/** Câmera livre da fase de movimento (atrás das zonas, de cima, olhando as três). */
const MOVE_CAMERA = { x: 0.5, y: 11.5, z: -7.5 };
const MOVE_CAMERA_TARGET = { x: 0.5, y: 0, z: 11 };
/** Presets de câmera da montaria (BP cameras/presets); o boom só entra no modo "boom", então o teste o liga à mão. */
const RIDE_BOOM_PRESET = "cobblemon:ride_boom";

type TurnKind = "move" | "switch" | "bag";

interface PhaseReport {
  done: number;
  total: number;
  extra: Record<string, number>;
}

interface Session {
  player: Player;
  playerId: string;
  playerName: string;
  mode: SelfTestMode;
  plan: PhasePlan[];
  signal: StopSignal;
  startedAt: number;
  dimension: Dimension;
  origin: BlockPos;
  journal: SelfTestJournal;
  changes: BlockChangeLog<BlockPermutation>;
  entityIds: Set<string>;
  snapshot: Map<string, DynamicValue>;
  inventory?: (ItemStack | undefined)[];
  phase?: SelfTestPhase;
  progress: { done: number; total: number };
  reports: Partial<Record<SelfTestPhase, PhaseReport>>;
  failures: string[];
  battle?: PokemonBattle;
  progressRun?: number;
  /** Dynamic properties do mundo antes do teste (a verificação final lista o que apareceu, sumiu ou mudou). */
  worldIds: Set<string>;
  worldValues: Map<string, unknown>;
  /** Modo `telas`: segundos com cada tela aberta e as telas mostradas, na ordem (chaves de SCREEN_TOUR). */
  screenSeconds: number;
  screensShown: string[];
  /** Nomes das paradas de extensões no roteiro `telas` (as do base usam `cobblemon.selftest.screen.<key>`). */
  screenNames: Map<string, RawMessage>;
  /** Linhas do resumo pedidas pelas fases de extensões. */
  extensionSummary: RawMessage[];
}

/** Um teste por vez no mundo. */
let active: Session | undefined;
/**
 * Testes interrompidos ainda não resolvidos, por jogador: quem saiu no meio (servidor de pé, com o inventário em
 * memória) ou um journal achado no carregamento do mundo (queda do servidor). A área é limpa quando o chunk carrega; o
 * jogador é restaurado quando entra.
 */
const pending = new Map<string, { journal: SelfTestJournal; snapshot?: Map<string, DynamicValue>; inventory?: (ItemStack | undefined)[] }>();

// ---------------------------------------------------------------------------------------------
// Utilidades

const waitTicks = (ticks: number) => system.waitTicks(Math.max(1, Math.floor(ticks)));

/** Roda um gerador com `system.runJob` e resolve quando ele termina (um passo por `yield`). */
function job(generator: Generator<void, void, void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    system.runJob((function* () {
      try { yield* generator; resolve(); }
      catch (e) { reject(e); }
    })());
  });
}

const add = (o: BlockPos, d: { x: number; y: number; z: number }): Vector3 => ({ x: o.x + d.x, y: o.y + d.y, z: o.z + d.z });
const blockAt = (o: BlockPos, dx: number, dy: number, dz: number): BlockPos => ({ x: o.x + dx, y: o.y + dy, z: o.z + dz });

function regionOf(origin: BlockPos): Region {
  return { min: blockAt(origin, AREA.minX, AREA.minY, AREA.minZ), max: blockAt(origin, AREA.maxX, AREA.maxY, AREA.maxZ) };
}

function stopped(s: Session): boolean {
  if (!s.player.isValid) s.signal.stop("left");
  return s.signal.stopped;
}

function fail(s: Session, what: string, e?: unknown) {
  s.failures.push(e === undefined ? what : `${what}: ${e}`);
  // Info (não warn): o ContentLog do cliente com "Inform." mostra a lista; o log do servidor não vira alerta.
  try { console.info(`[selftest] ${what}${e === undefined ? "" : `: ${e}`}`); } catch { }
}

function tr(key: string, ...args: (string | number | RawMessage)[]): RawMessage {
  if (!args.length) return { translate: key };
  return { translate: key, with: { rawtext: args.map(a => typeof a === "object" ? a : { text: String(a) }) } };
}

function tell(player: Player | undefined, msg: RawMessage) {
  try { if (player?.isValid) player.sendMessage(msg); else console.info(`[selftest] ${JSON.stringify(msg)}`); } catch { }
}

function closeForms(player: Player) {
  try { if (player.isValid) uiManager.closeAllForms(player); } catch { }
}

function phaseName(phase: SelfTestPhase): RawMessage {
  return findSelfTestExtension(phase)?.name ?? { translate: `cobblemon.selftest.phase.${phase}` };
}

/** Extensões ligadas neste mundo (as que não respondem são tratadas como desligadas). */
function availableExtensions(): SelfTestExtension[] {
  return selfTestExtensions().filter(e => { try { return e.available(); } catch { return false; } });
}

function report(s: Session, phase: SelfTestPhase): PhaseReport {
  return s.reports[phase] ?? (s.reports[phase] = { done: 0, total: 0, extra: {} });
}

function setProgress(s: Session, done: number, total: number) {
  s.progress.done = done;
  s.progress.total = total;
}

function showProgress(s: Session) {
  // No roteiro de telas a actionbar é do aviso "Tela N/total" e da contagem regressiva.
  if (!s.player.isValid || !s.phase || s.phase === "screens") return;
  const { done, total } = s.progress;
  const percent = total > 0 ? `${Math.floor((done / total) * 100)}%` : "…";
  try { s.player.onScreenDisplay.setActionBar(tr("cobblemon.selftest.progress", phaseName(s.phase), done, total, percent)); } catch { }
}

// ---------------------------------------------------------------------------------------------
// Journal e snapshot (sobrevivem a queda do servidor)

function readSnapshotFromWorld(playerId: string, chunks: number): Map<string, DynamicValue> | undefined {
  let text = "";
  for (let i = 0; i < chunks; i++) {
    const part = world.getDynamicProperty(`${SNAPSHOT_PREFIX}${playerId}:${i}`);
    if (typeof part !== "string") return undefined;
    text += part;
  }
  return decodeSnapshot(text);
}

function writeJournal(journal: SelfTestJournal) {
  world.setDynamicProperty(`${JOURNAL_PREFIX}${journal.playerId}`, encodeJournal(journal));
}

function clearJournal(journal: SelfTestJournal) {
  try { world.setDynamicProperty(`${JOURNAL_PREFIX}${journal.playerId}`, undefined); } catch { }
  for (let i = 0; i < journal.snapshotChunks; i++) {
    try { world.setDynamicProperty(`${SNAPSHOT_PREFIX}${journal.playerId}:${i}`, undefined); } catch { }
  }
}

function doneList(): number[] {
  try {
    const raw = world.getDynamicProperty(DONE_PROPERTY);
    const list = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is number => typeof x === "number") : [];
  } catch { return []; }
}

function markDone(journal: SelfTestJournal) {
  try { world.setDynamicProperty(DONE_PROPERTY, JSON.stringify(rememberDone(doneList(), journal.started))); } catch { }
}

/** Uma âncora por chunk da área (antes de mexer em qualquer bloco). */
function spawnAnchors(s: Session, snapshotText: string[]) {
  anchorPositions(s.journal.region).forEach((location, i) => {
    try {
      const anchor = s.dimension.spawnEntity(ANCHOR_TYPE, location);
      anchor.addTag(ANCHOR_TAG);
      anchor.addTag(SELFTEST_TAG);
      anchor.setDynamicProperty(ANCHOR_JOURNAL, encodeJournal(s.journal));
      if (i === 0) snapshotText.forEach((part, n) => anchor.setDynamicProperty(`${SNAPSHOT_PREFIX}${n}`, part));
      s.entityIds.add(anchor.id);
    } catch (e) { fail(s, "âncora do journal", e); }
  });
}

/** Âncora carregada do disco: journal de um teste que caiu (ou já resolvido: só remove). */
function onAnchorLoaded(entity: Entity) {
  if (!entity.isValid || !entity.hasTag(ANCHOR_TAG)) return;
  const journal = decodeJournal(entity.getDynamicProperty(ANCHOR_JOURNAL));
  if (!journal) { try { entity.remove(); } catch { } return; }
  if (active && active.journal.started === journal.started) return;
  const known = [...pending.values()].find(p => p.journal.started === journal.started);
  if (known) {
    // Área já limpa (esta âncora estava num chunk descarregado): sobra, sai. Senão o limpador da área a remove.
    if (known.journal.regionClean) { try { entity.remove(); } catch { } }
    return;
  }
  if (doneList().includes(journal.started)) { try { entity.remove(); } catch { } return; }
  let snapshot: Map<string, DynamicValue> | undefined;
  if (journal.snapshotChunks > 0) {
    let text = "";
    for (let i = 0; i < journal.snapshotChunks; i++) {
      const part = entity.getDynamicProperty(`${SNAPSHOT_PREFIX}${i}`);
      if (typeof part !== "string") { text = ""; break; }
      text += part;
    }
    snapshot = text ? decodeSnapshot(text) : undefined;
  }
  // O journal do mundo (se sobreviveu) tem o snapshot; senão vale o da âncora principal (e as outras só limpam a área).
  const fromWorld = readSnapshotFromWorld(journal.playerId, journal.snapshotChunks);
  journal.regionClean = false;
  pending.set(journal.playerId, { journal, snapshot: fromWorld ?? snapshot });
  try {
    if (!fromWorld && snapshot) splitChunks(encodeSnapshot(snapshot)).forEach((part, i) => world.setDynamicProperty(`${SNAPSHOT_PREFIX}${journal.playerId}:${i}`, part));
    writeJournal(journal);
  } catch { }
  console.info(`[selftest] âncora de um teste interrompido carregada (${journal.playerName}); restaurando`);
  for (const player of world.getPlayers()) if (pendingOf(player)) restoreReturningPlayer(player);
}

function snapshotPlayer(player: Player): Map<string, DynamicValue> {
  const out = new Map<string, DynamicValue>();
  for (const id of player.getDynamicPropertyIds()) {
    const value = player.getDynamicProperty(id);
    if (value !== undefined) out.set(id, value as DynamicValue);
  }
  return out;
}

function snapshotInventory(player: Player): (ItemStack | undefined)[] | undefined {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return undefined;
  const out: (ItemStack | undefined)[] = [];
  for (let i = 0; i < container.size; i++) out.push(container.getItem(i)?.clone());
  return out;
}

function sameStack(a: ItemStack | undefined, b: ItemStack | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.typeId === b.typeId && a.amount === b.amount && a.nameTag === b.nameTag;
}

/** Volta dynamic properties (e o cache da Pokédex) e o inventário ao que eram antes do teste. */
function restorePlayerData(player: Player, snapshot: Map<string, DynamicValue> | undefined, inventory: (ItemStack | undefined)[] | undefined): string[] {
  const changed: string[] = [];
  if (snapshot) {
    const { restore, remove } = diffDynamicProperties(snapshot, snapshotPlayer(player));
    for (const [id, value] of restore) { try { player.setDynamicProperty(id, value); changed.push(id); } catch { } }
    for (const id of remove) { try { player.setDynamicProperty(id, undefined); changed.push(`-${id}`); } catch { } }
    try { forgetPokedex(player.id); } catch { }
  }
  if (inventory) {
    const container = player.getComponent("minecraft:inventory")?.container;
    if (container) {
      for (let i = 0; i < Math.min(container.size, inventory.length); i++) {
        if (sameStack(container.getItem(i), inventory[i])) continue;
        try { container.setItem(i, inventory[i]?.clone()); changed.push(`slot${i}`); } catch { }
      }
    }
  }
  return changed;
}

/**
 * Desce da montaria do teste (a montaria some logo depois) e devolve a permissão de desmontar, que a montaria no ar/água
 * desliga. O teste não começa com o jogador montado, então "não montado" é o estado original.
 */
function leaveMount(player: Player) {
  try {
    const vehicle = player.getComponent("minecraft:riding")?.entityRidingOn;
    if (vehicle?.isValid && vehicle.hasTag(SELFTEST_TAG)) {
      try { forgetMount(vehicle.id); } catch { }
      vehicle.getComponent("minecraft:rideable")?.ejectRider(player);
    }
  } catch { }
  try { player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, true); } catch { }
}

/**
 * Conquistas: o rastreador (scripts/ui/achievements/tracker.ts) lê a dynamic property só na primeira vez e depois usa o
 * estado em memória. Depois de a property voltar ao snapshot, o MESMO objeto que o rastreador usa é reescrito no lugar
 * com ela (não há API de descarte), então nada do teste fica no cache.
 */
function syncAchievementsCache(player: Player) {
  try {
    const live = getAchievements(player);
    const fresh = parseAchievements(player.getDynamicProperty(ACHIEVEMENTS_PROPERTY));
    live.d = fresh.d;
    live.c = fresh.c;
    live.w = fresh.w;
  } catch { }
}

/**
 * Montar conclui o critério "started_riding" (o rastreador confere se o jogador está montado, com toast e anúncio no
 * chat). Na fase de movimento, as conquistas com esse critério contam como feitas SÓ na memória (sem gravar nem
 * anunciar); `syncAchievementsCache` desfaz no fim.
 */
function holdRideAchievements(player: Player) {
  try {
    const live = getAchievements(player);
    for (const def of ADVANCEMENT_DEFS) {
      if (!live.d.includes(def.id) && Object.values(def.criteria).some(c => c.t === "started_riding")) live.d.push(def.id);
    }
  } catch { }
}

/** Posição, dimensão, rotação, modo de jogo, câmera, montaria e sons do jogador. */
function restorePlayerPlace(player: Player, journal: SelfTestJournal) {
  leaveMount(player);
  try { player.camera.clear(); } catch { }
  try { player.runCommand("stopsound @s"); } catch { }
  try { player.stopMusic(); } catch { }
  try { closeStudio(player); } catch { }
  try { stopDialogue(player); } catch { }
  closeForms(player);
  try {
    const mode = Object.values(GameMode).find(m => String(m) === journal.gameMode);
    if (mode !== undefined) player.setGameMode(mode as GameMode);
  } catch { }
  try {
    player.teleport(journal.origin, { dimension: world.getDimension(journal.dimension), rotation: journal.rotation });
  } catch (e) { console.info(`[selftest] não foi possível devolver ${player.name}: ${e}`); }
}

// ---------------------------------------------------------------------------------------------
// Área

/** Procura uma área só de ar acima do jogador (fatiado). */
async function findArea(player: Player): Promise<BlockPos | undefined> {
  const dimension = player.dimension;
  const px = Math.floor(player.location.x);
  const py = Math.floor(player.location.y);
  const pz = Math.floor(player.location.z);
  const top = dimension.heightRange.max - AREA.maxY - 2;
  const candidates = [...new Set([48, 64, 32, 80, 24].map(rise => Math.min(py + rise, top)))].filter(y => y - py >= 16);
  let found: BlockPos | undefined;
  await job((function* () {
    for (const y of candidates) {
      const origin = { x: px, y, z: pz };
      let clear = true;
      for (const cell of regionCells(regionOf(origin))) {
        let block: Block | undefined;
        try { block = dimension.getBlock(cell); } catch { block = undefined; }
        if (!block || !block.isAir) { clear = false; break; }
        yield;
      }
      if (clear) { found = origin; return; }
      yield;
    }
  })());
  return found;
}

/** Troca um bloco anotando o original (só a primeira vez). */
function setBlock(s: Session, pos: BlockPos, permutation: BlockPermutation | string): boolean {
  const block = s.dimension.getBlock(pos);
  if (!block) return false;
  s.changes.record(pos, block.permutation);
  if (typeof permutation === "string") block.setType(permutation);
  else block.setPermutation(permutation);
  return true;
}

async function placeFloor(s: Session) {
  await job((function* () {
    for (let dz = FLOOR.minZ; dz <= FLOOR.maxZ; dz++) {
      for (let dx = FLOOR.minX; dx <= FLOOR.maxX; dx++) {
        try { setBlock(s, blockAt(s.origin, dx, -1, dz), "minecraft:barrier"); } catch { }
        yield;
      }
    }
  })());
}

/** Remove da área o que o teste deixou: itens, e entidades do Cobblemon sem dono (ou marcadas pelo teste). */
function sweepEntities(dimension: Dimension, region: Region, extraIds?: Set<string>): number {
  let removed = 0;
  if (extraIds) {
    for (const id of extraIds) {
      try { const e = world.getEntity(id); if (e?.isValid) { e.remove(); removed++; } } catch { }
    }
    extraIds.clear();
  }
  let found: Entity[] = [];
  try {
    found = dimension.getEntities({
      location: region.min,
      volume: { x: region.max.x - region.min.x + 1, y: region.max.y - region.min.y + 1, z: region.max.z - region.min.z + 1 },
    });
  } catch { return removed; }
  for (const entity of found) {
    try {
      if (!entity.isValid || entity instanceof Player) continue;
      const type = entity.typeId;
      const ours = entity.hasTag(SELFTEST_TAG) || entity.hasTag(STUDIO_TAG) || entity.hasTag(BATTLE_CLONE_TAG);
      const loose = type === "minecraft:item" || type === "minecraft:xp_orb";
      const unowned = type.startsWith("cobblemon:") && entity.getDynamicProperty("owner_name") === undefined;
      if (ours || loose || unowned) { entity.remove(); removed++; }
    } catch { }
  }
  return removed;
}

/** Apaga os registros por posição (dynamic properties do mundo) que os blocos colocados deixaram dentro da área. */
function clearWorldKeys(dimensionId: string, region: Region): string[] {
  const removed: string[] = [];
  for (const id of world.getDynamicPropertyIds()) {
    if (id.startsWith(JOURNAL_PREFIX) || id.startsWith(SNAPSHOT_PREFIX) || !isLeftoverWorldKey(id, dimensionId, region)) continue;
    try { world.setDynamicProperty(id, undefined); removed.push(id); } catch { }
  }
  return removed;
}

/** Posições da caixa de cima para baixo (a água sai por cima primeiro). */
function* cellsTopDown(region: Region): Generator<BlockPos> {
  for (let y = region.max.y; y >= region.min.y; y--)
    for (let z = region.min.z; z <= region.max.z; z++)
      for (let x = region.min.x; x <= region.max.x; x++) yield { x, y, z };
}

/**
 * Seca a água (fonte e corrente) de uma caixa com as paredes AINDA de pé: tira de cima para baixo e repete até não sobrar
 * nada; a corrente que se forma entre uma passada e outra fica presa na caixa e seca sozinha. Não coloca bloco nenhum
 * na água (a barreira aceita água no Bedrock e a soltaria depois). Devolve false se ainda havia água no fim.
 */
async function drainWater(dimension: Dimension, box: Region): Promise<boolean> {
  for (let pass = 0; pass < 12; pass++) {
    let found = 0;
    await job((function* () {
      for (const cell of cellsTopDown(box)) {
        try {
          const block = dimension.getBlock(cell);
          if (block && (isWaterBlock(block.typeId) || block.isWaterlogged)) {
            if (isWaterBlock(block.typeId)) block.setType("minecraft:air");
            else block.setWaterlogged(false);
            found++;
          }
        } catch { }
        yield;
      }
    })());
    if (!found) return true;
    await waitTicks(10);
  }
  return false;
}

/**
 * Devolve cada bloco anotado e limpa sobras do Cobblemon na área (que começou só com ar). Com `drain`, a água da área seca
 * antes de qualquer parede sair (nada escorre para fora).
 */
async function restoreBlocks(dimension: Dimension, region: Region, changes?: BlockChangeLog<BlockPermutation>, drain = false) {
  if (drain && !await drainWater(dimension, region)) console.info(`[selftest] ainda havia água na área depois de secar (${JSON.stringify(region)})`);
  await job((function* () {
    if (changes) {
      for (const { pos, original } of changes.restoreOrder()) {
        try { dimension.getBlock(pos)?.setPermutation(original); } catch { }
        yield;
      }
    }
    for (const cell of regionCells(region)) {
      try {
        const block = dimension.getBlock(cell);
        if (block && !block.isAir && isSelfTestLeftoverBlock(block.typeId, isExtensionLeftoverBlock)) block.setType("minecraft:air");
      } catch { }
      yield;
    }
  })());
}

// ---------------------------------------------------------------------------------------------
// Fase: entidades

function comboCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [species, data] of Object.entries(VARIANTS)) out[species] = data.combos.length;
  return out;
}

/** Espécies base (sem pré-evolução): 1 por família. Fatiado (os dados da espécie são lidos sob demanda). */
async function familyBases(species: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  await job((function* () {
    for (const id of species) {
      try { if (!getSpeciesData(id)?.preEvolution) out.add(id); } catch { out.add(id); }
      yield;
    }
  })());
  return out;
}

/**
 * Cobertura mínima das combinações de cada espécie (coverCombos: toda geometria, textura, camada e poser aparece ao
 * menos uma vez). Fatiado: uma espécie por passo do job (o Spinda sozinho tem 1534 combinações).
 */
async function comboCover(species: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  await job((function* () {
    for (const id of species) {
      const combos = VARIANTS[id]?.combos;
      if (combos && combos.length > 1) out.set(id, coverCombos(combos));
      yield;
    }
  })());
  return out;
}

function poserKey(target: PokemonTarget): string {
  const poser = VARIANTS[target.species]?.combos[target.variant]?.poser ?? target.species;
  return poser.replace(/^[a-z0-9_]+:/, "");
}

function playPoser(entity: Entity, target: PokemonTarget, keys: string[]) {
  const table = POSER_ANIMATIONS[poserKey(target)] ?? POSER_ANIMATIONS[target.species];
  if (!table) return;
  for (const key of keys) {
    const animation = table[key];
    if (!animation) continue;
    try { entity.playAnimation(animation); } catch { }
    return;
  }
}

function spawnDisplayPokemon(s: Session, target: PokemonTarget, location: Vector3): Entity | undefined {
  let entity: Entity;
  try {
    // Evento vazio no lugar do minecraft:entity_spawned (sem IA de selvagem), como o estúdio das telas.
    entity = s.dimension.spawnEntity(`cobblemon:${target.species}`, location, { spawnEvent: "cobblemon:interacted", initialPersistence: false, initialRotation: 180 });
  } catch (e) {
    fail(s, `pokemon ${target.species}#${target.variant}`, e);
    return undefined;
  }
  // As tags vêm antes do afterEvents.entitySpawn (fim do tick): scripts/main.ts não cria dados de selvagem.
  try { entity.addTag(STUDIO_TAG); entity.addTag(SELFTEST_TAG); } catch { }
  s.entityIds.add(entity.id);
  try { entity.nameTag = ""; } catch { }
  try { entity.setProperty("cobblemon:variant", target.variant); } catch (e) { fail(s, `pokemon ${target.species}#${target.variant} variant`, e); }
  try { entity.setProperty("cobblemon:initialized", true); } catch { }
  return entity;
}

async function pokemonBatch(s: Session, batch: PokemonTarget[]) {
  const offsets = gridOffsets(batch.length, 4, 4);
  const spawned: { entity: Entity; target: PokemonTarget }[] = [];
  await job((function* () {
    for (const [i, target] of batch.entries()) {
      const location = add(s.origin, { x: offsets[i].dx + 0.5, y: 0, z: offsets[i].dz + 2.5 });
      const entity = spawnDisplayPokemon(s, target, location);
      if (entity) spawned.push({ entity, target });
      yield;
    }
  })());
  const live = () => spawned.filter(x => x.entity.isValid);
  await waitTicks(POSE_TICKS);
  // Pose de batalha + grito; depois dormindo + golpe (animações nomeadas do poser).
  for (const { entity, target } of live()) {
    try { entity.setProperty("cobblemon:in_battle", true); } catch { }
    playPoser(entity, target, ["cry"]);
  }
  await waitTicks(POSE_TICKS);
  for (const { entity, target } of live()) {
    try { entity.setProperty("cobblemon:in_battle", false); entity.setProperty("cobblemon:sleeping", true); } catch { }
    playPoser(entity, target, ["physical", "special", "status", "recoil"]);
  }
  await waitTicks(POSE_TICKS);
  for (const { entity } of spawned) {
    try { if (entity.isValid) entity.remove(); } catch { }
    s.entityIds.delete(entity.id);
  }
}

function spawnOtherEntity(s: Session, info: SelfTestEntityInfo, location: Vector3): Entity | undefined {
  let entity: Entity;
  try {
    entity = s.dimension.spawnEntity(info.id, location, { initialPersistence: false, initialRotation: 180 });
  } catch (e) {
    fail(s, `entity ${info.id}`, e);
    return undefined;
  }
  try { entity.addTag(SELFTEST_TAG); } catch { }
  s.entityIds.add(entity.id);
  // Bola: sem física (parada no ar) e sem captura; NPC e o resto: parados.
  if (info.group === "pokeballs") {
    try { entity.setDynamicProperty("activated", true); } catch { }
    try { entity.triggerEvent("cobblemon:disable"); } catch { }
  }
  try { entity.addEffect("slowness", 20 * 60, { amplifier: 255, showParticles: false }); } catch { }
  return entity;
}

async function otherEntityBatch(s: Session, batch: SelfTestEntityInfo[], coverage: Coverage) {
  const offsets = gridOffsets(batch.length, 4, 4);
  const spawned: { entity: Entity; info: SelfTestEntityInfo }[] = [];
  await job((function* () {
    for (const [i, info] of batch.entries()) {
      const location = add(s.origin, { x: offsets[i].dx + 0.5, y: 0.5, z: offsets[i].dz + 2.5 });
      const entity = spawnOtherEntity(s, info, location);
      if (entity) spawned.push({ entity, info });
      yield;
    }
  })());
  const maxSteps = coverage === "all" ? 48 : 6;
  const steps = Math.min(maxSteps, Math.max(1, ...batch.map(info => Math.max(0, ...Object.values(info.ints)) + 1)));
  const animations = coverage === "all" ? Math.max(0, ...batch.map(info => info.animations.length)) : Math.min(4, Math.max(0, ...batch.map(info => info.animations.length)));
  const total = Math.max(steps * PROPERTY_STEP_TICKS, animations * ANIMATION_STEP_TICKS, 30);
  for (let t = 0; t <= total; t += PROPERTY_STEP_TICKS) {
    if (stopped(s)) break;
    const step = Math.floor(t / PROPERTY_STEP_TICKS);
    const animStep = t % ANIMATION_STEP_TICKS === 0 ? t / ANIMATION_STEP_TICKS : -1;
    for (const { entity, info } of spawned) {
      if (!entity.isValid) continue;
      if (step < steps) {
        for (const [name, max] of Object.entries(info.ints)) {
          try { entity.setProperty(name, Math.min(step, max)); } catch { }
        }
      }
      if (animStep >= 0 && animStep < info.animations.length && animStep < animations) {
        try { entity.playAnimation(info.animations[animStep]); } catch { }
      }
    }
    await waitTicks(PROPERTY_STEP_TICKS);
  }
  for (const { entity } of spawned) {
    try { if (entity.isValid) entity.remove(); } catch { }
    s.entityIds.delete(entity.id);
  }
}

/** Arremesso de verdade (projétil com física), sem captura e sem virar item (marcada como "activated"). */
async function throwBalls(s: Session, balls: SelfTestEntityInfo[]) {
  for (const group of chunk(balls, 6)) {
    if (stopped(s)) return;
    const thrown: Entity[] = [];
    for (const [i, info] of group.entries()) {
      try {
        const from = add(s.origin, { x: STAND.x + (i - 2.5) * 0.8, y: 1.6, z: STAND.z + 1 });
        const ball = s.dimension.spawnEntity(info.id, from, { initialPersistence: false });
        try { ball.addTag(SELFTEST_TAG); } catch { }
        s.entityIds.add(ball.id);
        try { ball.setDynamicProperty("activated", true); } catch { }
        ball.getComponent("minecraft:projectile")?.shoot({ x: (i - 2.5) * 0.05, y: 0.35, z: 0.9 });
        thrown.push(ball);
      } catch (e) { fail(s, `throw ${info.id}`, e); }
    }
    report(s, "entities").extra.thrown = (report(s, "entities").extra.thrown ?? 0) + thrown.length;
    await waitTicks(30);
    for (const ball of thrown) {
      try { if (ball.isValid) ball.remove(); } catch { }
      s.entityIds.delete(ball.id);
    }
  }
}

/** Pokémon de exibição em lotes (grade 4×4, poses): a fase `entities` e as fases de extensões. */
async function showPokemonTargets(s: Session, targets: readonly PokemonTarget[], onProgress: (processed: number) => void) {
  return runInBatches(targets, POKEMON_BATCH, s.signal, async batch => {
    if (stopped(s)) return;
    await pokemonBatch(s, batch);
  }, async () => { }, processed => onProgress(processed));
}

async function entitiesPhase(s: Session, coverage: Coverage) {
  const counts = comboCounts();
  const species = Object.keys(counts);
  const bases = coverage === "sample" ? await familyBases(species) : new Set(species);
  // Em vez de todas as combinações (8485, o Spinda sozinho 1534), o mínimo que mostra cada recurso distinto.
  const cover = await comboCover(coverage === "all" ? species : species.filter(id => (KNOWN_PROBLEM_SPECIES as readonly string[]).includes(id)));
  const everything = pokemonTargets(counts, coverage, id => bases.has(id));
  const targets = pokemonTargets(counts, coverage, id => bases.has(id), undefined, id => cover.get(id));
  // Amostra: NPC, barcos, exibições e as bolas comuns (+ a antiga); completo: todas, inclusive as bolas "dummy" da captura.
  const sampleBall = /^cobblemon:(poke|great|ultra|master|ancient_poke)_ball$/;
  const others = SELFTEST_ENTITIES.filter(e => coverage === "all" || e.group !== "pokeballs" || sampleBall.test(e.id));
  const balls = SELFTEST_ENTITIES.filter(e => e.group === "pokeballs" && !e.id.endsWith("_dummy"));
  const thrown = coverage === "all" ? balls : balls.filter(e => sampleBall.test(e.id)).slice(0, SAMPLE_OTHER_BALLS);
  const rep = report(s, "entities");
  rep.total = targets.length + others.length;
  rep.extra.species = new Set(targets.map(t => t.species)).size;
  rep.extra.combos = everything.length;
  rep.extra.covered = targets.length;
  console.info(`[selftest] entidades: ${targets.length} de ${everything.length} combinações de Pokémon (cobertura de modelos, texturas, camadas e posers)`);
  const total = targets.length + others.length + thrown.length;
  let done = 0;
  const pokemon = await showPokemonTargets(s, targets, processed => { done = processed; rep.done = processed; setProgress(s, done, total); });
  rep.extra.pokemon = pokemon.processed;
  if (stopped(s)) return;
  const base = done;
  const other = await runInBatches(others, OTHER_BATCH, s.signal, async batch => {
    if (stopped(s)) return;
    await otherEntityBatch(s, batch, coverage);
  }, async () => { }, processed => { rep.done = base + processed; setProgress(s, base + processed, total); });
  rep.extra.other = other.processed;
  if (stopped(s)) return;
  await throwBalls(s, thrown);
  setProgress(s, total, total);
}

// ---------------------------------------------------------------------------------------------
// Fase: movimento (andar/correr, nadar/flutuar, voar/planar e montaria)

/** Um Pokémon solto numa zona e o que ele fez (evidência no log: andou, esteve na água, saiu do chão). */
interface Mover {
  entity: Entity;
  target: MovementTarget;
  start: Vector3;
  moved: boolean;
  swam: boolean;
  flew: boolean;
}

/** Ponto ao acaso no interior da zona, na altura do meio dela (chão, dentro da água, no ar). */
function randomPointIn(s: Session, zone: LocomotionZone): Vector3 {
  const box = MOVEMENT_ZONES[zone];
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  const y = zone === "air" ? rand(2, box.maxY - 1) : zone === "water" ? rand(0.3, WATER_TOP + 0.5) : 0;
  return add(s.origin, { x: rand(box.minX + 0.5, box.maxX + 0.5), y, z: rand(box.minZ + 0.5, box.maxZ + 0.5) });
}

/** Empurrão na direção de um ponto da zona (o motor anima andar/nadar/voar pelo deslocamento). */
function nudge(s: Session, entity: Entity, zone: LocomotionZone, strength: number) {
  try {
    const v = nudgeVector(entity.location, randomPointIn(s, zone), strength, zone !== "ground");
    // Voador decola do chão; no cercado, só na horizontal.
    if (zone === "air") v.y = Math.max(v.y, strength * 0.6);
    entity.applyImpulse(v);
  } catch { }
}

function observe(m: Mover) {
  const e = m.entity;
  try {
    if (!e.isValid) return;
    const p = e.location;
    if (Math.hypot(p.x - m.start.x, p.z - m.start.z) > 0.75 || Math.abs(p.y - m.start.y) > 0.75) m.moved = true;
    if (e.isInWater) m.swam = true;
    if (!e.isOnGround && !e.isInWater) m.flew = true;
  } catch { }
}

/** Blocos da fase: anota o original de TODAS as posições antes de colocar (água que escorre não vira "original"). */
async function buildMovementArea(s: Session, local: BlockChangeLog<BlockPermutation>) {
  const cells = movementLayout();
  await job((function* () {
    for (const cell of cells) {
      const pos = blockAt(s.origin, cell.dx, cell.dy, cell.dz);
      try {
        const block = s.dimension.getBlock(pos);
        if (block) { s.changes.record(pos, block.permutation); local.record(pos, block.permutation); }
      } catch { }
      yield;
    }
    for (const cell of cells) {
      try { s.dimension.getBlock(blockAt(s.origin, cell.dx, cell.dy, cell.dz))?.setType(cell.type); }
      catch (e) { fail(s, `movement: bloco ${cell.type} ${cell.dx},${cell.dy},${cell.dz}`, e); }
      yield;
    }
  })());
}

/** Desfaz a fase: seca a piscina com as paredes de pé, depois cada posição volta ao que era antes da fase (ordem inversa). */
async function teardownMovementArea(s: Session, local: BlockChangeLog<BlockPermutation>) {
  const pool = MOVEMENT_ZONES.water;
  // A piscina e a casca em volta dela (parede/chão de barreira com água dentro também secam).
  const box: Region = { min: blockAt(s.origin, pool.minX - 1, pool.minY - 1, pool.minZ - 1), max: blockAt(s.origin, pool.maxX + 1, pool.maxY + 1, pool.maxZ + 1) };
  if (!await drainWater(s.dimension, box)) fail(s, "movement: a piscina não secou");
  await job((function* () {
    for (const { pos, original } of local.restoreOrder()) {
      try { s.dimension.getBlock(pos)?.setPermutation(original); } catch { }
      yield;
    }
  })());
}

/** Pokémon da fase: o de exibição + a IA de selvagem (passear/nadar/voar) e imune a dano. */
function spawnMover(s: Session, target: MovementTarget, location: Vector3): Entity | undefined {
  const entity = spawnDisplayPokemon(s, target, location);
  if (!entity) return undefined;
  try { entity.triggerEvent("cobblemon:set_wild"); } catch (e) { fail(s, `movement ${target.species}#${target.variant} IA`, e); }
  try { entity.addEffect("resistance", 20 * 60, { amplifier: RESISTANCE_AMPLIFIER, showParticles: false }); } catch { }
  return entity;
}

/**
 * `cobblemon:set_wild` marca `cobblemon:wild`; no tick seguinte a propriedade volta a false (os grupos de IA ficam):
 * despawner, spawner e o brilho de shiny não tratam a exibição como selvagem.
 */
function unmarkWild(entity: Entity) {
  try { if (entity.isValid) entity.setProperty("cobblemon:wild", false); } catch { }
}

type MovementCounts = Record<"ground" | "water" | "air" | "walked" | "swam" | "flew", number>;

/** Uma rodada: até N Pokémon em cada zona, soltos por MOVE_TICKS com empurrões; depois somem. */
async function movementRound(s: Session, round: Record<LocomotionZone, MovementTarget[]>, index: number, counts: MovementCounts, still: string[]) {
  const movers: Mover[] = [];
  try {
    await job((function* () {
      for (const zone of LOCOMOTION_ZONES) {
        const list = round[zone];
        const slots = zoneSlots(MOVEMENT_ZONES[zone], list.length, zone === "water" ? 1 : 0);
        for (const [i, target] of list.entries()) {
          const location = add(s.origin, slots[i]);
          const entity = spawnMover(s, target, location);
          if (entity) movers.push({ entity, target, start: location, moved: false, swam: false, flew: false });
          yield;
        }
      }
    })());
    await waitTicks(2);
    for (const m of movers) unmarkWild(m.entity);
    for (let t = 0, step = 0; t < MOVE_TICKS; t += MOVE_STEP_TICKS, step++) {
      if (stopped(s)) break;
      // Andar e correr (empurrão mais forte a cada 3º passo), nadar e voar.
      for (const m of movers) {
        if (!m.entity.isValid) continue;
        const zone = m.target.zone;
        const run = (step + index) % 3 === 2;
        nudge(s, m.entity, zone, zone === "air" ? 0.45 : zone === "water" ? 0.3 : run ? 0.65 : 0.35);
      }
      await waitTicks(MOVE_STEP_TICKS);
      for (const m of movers) observe(m);
    }
    for (const m of movers) {
      const zone = m.target.zone;
      counts[zone]++;
      const ok = zone === "ground" ? m.moved : zone === "water" ? m.swam && m.moved : m.flew;
      if (zone === "ground" && ok) counts.walked++;
      if (zone === "water" && ok) counts.swam++;
      if (zone === "air" && ok) counts.flew++;
      if (!ok && still.length < 40) still.push(`${m.target.species}#${m.target.variant}@${zone}`);
    }
  }
  finally {
    for (const m of movers) {
      try { if (m.entity.isValid) m.entity.remove(); } catch { }
      s.entityIds.delete(m.entity.id);
    }
  }
}

/** Jogador no lugar de sempre, com a câmera livre olhando as três zonas. */
function viewMovement(s: Session) {
  if (!s.player.isValid) return;
  try { s.player.teleport(add(s.origin, STAND), { dimension: s.dimension, facingLocation: add(s.origin, MOVE_CAMERA_TARGET) }); } catch { }
  try { s.player.camera.setCamera("minecraft:free", { location: add(s.origin, MOVE_CAMERA), facingLocation: add(s.origin, MOVE_CAMERA_TARGET) }); } catch { }
}

/**
 * Resultado de um passeio: montou (addRider aceitou), o motor tirou o jogador da montaria no meio (ex.: montaria que não
 * respira na água afundando) e os estilos vistos no módulo de montaria, em ordem.
 */
interface RideResult { mounted: boolean; ejected: boolean; styles: string[] }

/**
 * Um passeio: a montaria nasce na zona do estilo, o jogador sobe (rideable.addRider) e o módulo de montaria de verdade
 * (scripts/entity/Riding.ts) assume: grupos ride_land/ride_liquid/ride_air, câmera de órbita no ar/água, sons e
 * controles. Terra: anda (e a câmera boom por um tempo); água: vira LIQUID ao entrar; ar: começa no chão, pulo duplo
 * (o mesmo caminho do botão de pulo) → AIR, voa e plana (ride_air_tired) no fim.
 */
async function rideOnce(s: Session, ride: MountRide): Promise<RideResult> {
  const result: RideResult = { mounted: false, ejected: false, styles: [] };
  const zone = rideZone(ride.style);
  const box = MOVEMENT_ZONES[zone];
  const at = add(s.origin, { x: (box.minX + box.maxX + 1) / 2, y: zone === "water" ? 1 : 0, z: box.minZ + 4.5 });
  const entity = spawnDisplayPokemon(s, { species: ride.species, variant: 0 }, at);
  if (!entity) return result;
  const player = s.player;
  const seen = (style: string | undefined) => { if (style && result.styles[result.styles.length - 1] !== style) result.styles.push(style); };
  try {
    // set_owned liga o grupo cobblemon:rideable (assentos); sem dono de verdade nem dados no mundo.
    try { entity.triggerEvent("cobblemon:set_owned"); } catch (e) { fail(s, `movement: montaria ${ride.species}`, e); }
    try { entity.addEffect("resistance", 20 * 60, { amplifier: RESISTANCE_AMPLIFIER, showParticles: false }); } catch { }
    await waitTicks(2);
    if (stopped(s)) return result;
    try { player.camera.clear(); } catch { }
    try { player.teleport({ x: at.x + 1.5, y: at.y, z: at.z }, { dimension: s.dimension, facingLocation: { x: at.x, y: at.y, z: at.z + 5 } }); } catch { }
    await waitTicks(1);
    if (stopped(s) || !entity.isValid) return result;
    let ok = false;
    try { ok = entity.getComponent("minecraft:rideable")?.addRider(player) ?? false; } catch (e) { fail(s, `movement: montar ${ride.species}`, e); }
    if (!ok) { fail(s, `movement: montar ${ride.species} (${ride.style}) recusado`); return result; }
    result.mounted = true;
    const riding = () => { try { return player.getComponent("minecraft:riding")?.entityRidingOn?.id === entity.id; } catch { return false; } };
    await waitTicks(1);
    const data = samplePokemon(ride.species, { level: 50 });
    if (data) { try { trackMountIfRidden(entity, data); } catch (e) { fail(s, `movement: módulo de montaria ${ride.species}`, e); } }
    if (!riding()) { result.ejected = true; return result; }
    seen(getRideStyle(player));
    const push = (strength: number, vertical: boolean, up = 0) => {
      try {
        const v = nudgeVector(entity.location, randomPointIn(s, zone), strength, vertical);
        entity.applyImpulse({ x: v.x, y: Math.max(v.y, up), z: v.z });
      } catch { }
    };
    const hold = async (ticks: number, each: () => void) => {
      for (let t = 0; t < ticks; t += 5) {
        if (stopped(s) || !entity.isValid) return false;
        each();
        await waitTicks(5);
        seen(getRideStyle(player));
        if (!riding()) { result.ejected = true; return false; }
      }
      return true;
    };
    if (ride.style === "AIR") {
      // No chão primeiro (se a forma anda), depois o pulo duplo leva ao voo.
      if (getRideStyle(player) !== "AIR") {
        if (!await hold(RIDE_TAKEOFF_TICKS, () => push(0.3, false))) return result;
        onJumpPressed(player);
        onJumpPressed(player);
        for (let i = 0; i < 8 && getRideStyle(player) !== "AIR" && !stopped(s); i++) await waitTicks(2);
        seen(getRideStyle(player));
      }
      if (!await hold(RIDE_TICKS, () => push(0.4, true, 0.12))) return result;
      // Planeio: o grupo de fôlego esgotado (ride_air_tired), como no fim do STAMINA.
      try { entity.triggerEvent("cobblemon:ride_air_tired"); } catch { }
      await hold(RIDE_GLIDE_TICKS, () => push(0.25, false));
    }
    else if (ride.style === "LIQUID") {
      await hold(RIDE_TICKS, () => push(0.3, true));
    }
    else {
      // Terra: anda/corre; no meio, a câmera boom (cobblemon:ride_boom) por um tempo.
      let t = 0;
      await hold(RIDE_TICKS, () => {
        push(t % 15 === 10 ? 0.6 : 0.35, false);
        if (t === 10) { try { player.camera.setCamera(RIDE_BOOM_PRESET, { entityOffset: { x: 0, y: 1.5, z: 0 }, viewOffset: { x: 0, y: 0 } }); } catch (e) { fail(s, "movement: câmera boom", e); } }
        if (t === 30) { try { player.camera.clear(); } catch { } }
        t += 5;
      });
    }
    return result;
  }
  finally {
    try { forgetMount(entity.id); } catch { }
    try { if (entity.isValid) entity.getComponent("minecraft:rideable")?.ejectRiders(); } catch { }
    try { if (entity.isValid) entity.remove(); } catch { }
    s.entityIds.delete(entity.id);
    if (player.isValid) {
      try { player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount, true); } catch { }
      viewMovement(s);
    }
  }
}

async function movementPhase(s: Session, coverage: Coverage) {
  const rep = report(s, "movement");
  const posers: Record<string, number[]> = {};
  for (const [species, data] of Object.entries(VARIANTS)) posers[species] = distinctPoserVariants(data.combos);
  const byZone = movementTargets(posers, SELFTEST_LOCOMOTION, coverage);
  const rounds = movementRounds(byZone);
  // Estilos da forma padrão que a entidade tem (como o módulo de montaria: ex. o LIQUID do Tauros é só da forma Aqua).
  const rideable: Record<string, RideStyleName[]> = {};
  for (const species of Object.keys(VARIANTS)) {
    const groups = getEntityInfo(species)?.rideGroups ?? [];
    const info = getRideInfo(species);
    const styles = info ? groups.filter(style => style in info.styles) : [];
    if (styles.length) rideable[species] = styles;
  }
  const rides = mountRides(rideable, coverage);
  const pokemonTotal = LOCOMOTION_ZONES.reduce((n, z) => n + byZone[z].length, 0);
  rep.total = pokemonTotal + rides.length;
  rep.extra.rides = rides.length;
  rep.extra.ridden = 0;
  rep.extra.ejected = 0;
  const ejected: string[] = [];
  const counts: MovementCounts = { ground: 0, water: 0, air: 0, walked: 0, swam: 0, flew: 0 };
  const still: string[] = [];
  const rideLog: string[] = [];
  const local = new BlockChangeLog<BlockPermutation>();
  let done = 0;
  if (s.player.isValid) holdRideAchievements(s.player);
  try {
    await buildMovementArea(s, local);
    viewMovement(s);
    // A água assenta e os chunks mandam os blocos ao cliente.
    await waitTicks(10);
    // Montarias primeiro (terra, água, ar), depois as rodadas com as três zonas cheias.
    for (const ride of rides) {
      if (stopped(s)) break;
      const r = await rideOnce(s, ride);
      const expected = ride.style;
      const reached = r.styles.includes(expected);
      // Montou e chegou ao estilo = passeio completo; o motor derrubar o jogador é achado de conteúdo (log e docs).
      if (reached && !r.ejected) rep.extra.ridden++;
      else if (r.mounted && r.ejected && !stopped(s)) { rep.extra.ejected++; ejected.push(`${ride.species} ${expected} (${r.styles.join(">") || "-"})`); }
      else if (!stopped(s)) rideLog.push(`${ride.species} ${expected}: ${r.styles.join(">") || "-"}`);
      if (reached && coverage === "sample") rideLog.push(`${ride.species} ${r.styles.join(">")}`);
      done++;
      rep.done = done;
      setProgress(s, done, rep.total);
    }
    for (const [index, round] of rounds.entries()) {
      if (stopped(s)) break;
      await movementRound(s, round, index, counts, still);
      done += LOCOMOTION_ZONES.reduce((n, z) => n + round[z].length, 0);
      rep.done = done;
      setProgress(s, done, rep.total);
    }
  }
  finally {
    for (const [key, value] of Object.entries(counts)) rep.extra[key] = value;
    await teardownMovementArea(s, local);
    await waitTicks(2);
    sweepLoose(s);
    if (s.player.isValid) {
      try { s.player.teleport(add(s.origin, STAND), { dimension: s.dimension, facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
      try { s.player.camera.setCamera("minecraft:free", { location: add(s.origin, CAMERA), facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
    }
    console.info(`[selftest] movimento: cercado ${counts.walked}/${counts.ground} andaram, piscina ${counts.swam}/${counts.water} nadaram, ar ${counts.flew}/${counts.air} voaram; montarias ${rep.extra.ridden}/${rides.length}, ${rep.extra.ejected} derrubada(s) pelo motor${rideLog.length ? ` (${rideLog.slice(0, 12).join(", ")}${rideLog.length > 12 ? ", ..." : ""})` : ""}${ejected.length ? `; o motor tirou o jogador da montaria: ${ejected.join(", ")}` : ""}${still.length ? `; sem o movimento esperado: ${still.slice(0, 20).join(", ")}${still.length > 20 ? ", ..." : ""}` : ""}${s.signal.stopped ? `; fase interrompida (${s.signal.why}) depois de ${done} de ${rep.total} itens: as caixas só contam os Pokémon soltos antes da parada` : ""}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Fase: blocos

function resolvePermutation(target: BlockTarget): BlockPermutation {
  return BlockPermutation.resolve(target.id, target.states as Record<string, string | number | boolean>);
}

async function blocksPhase(s: Session, coverage: Coverage) {
  const targets = blockTargets(SELFTEST_BLOCKS, coverage);
  const rep = report(s, "blocks");
  rep.total = targets.length;
  rep.extra.blocks = SELFTEST_BLOCKS.length;
  rep.extra.placed = await placeBlockPages(s, targets, processed => { rep.done = processed; setProgress(s, processed, targets.length); });
}

/** Blocos em páginas (grade 8×8, espaço 2), cada um sobre terra; a página seguinte ocupa o mesmo lugar. */
async function placeBlockPages(s: Session, targets: readonly BlockTarget[], onProgress: (processed: number) => void): Promise<number> {
  const offsets = gridOffsets(BLOCK_PAGE, 8, 2);
  let placed = 0;
  await runInBatches(targets, BLOCK_PAGE, s.signal, async page => {
    if (stopped(s)) return;
    const cells: BlockPos[] = [];
    await job((function* () {
      for (const [i, target] of page.entries()) {
        const pos = blockAt(s.origin, offsets[i].dx, 0, offsets[i].dz + 1);
        cells.push(pos);
        try {
          // Terra embaixo: plantas com filtro de colocação não caem na hora.
          setBlock(s, { x: pos.x, y: pos.y - 1, z: pos.z }, "minecraft:grass_block");
          setBlock(s, pos, resolvePermutation(target));
          placed++;
        } catch (e) { fail(s, `block ${target.id} ${JSON.stringify(target.states)}`, e); }
        yield;
      }
    })());
    await waitTicks(BLOCK_HOLD_TICKS);
    // Página seguinte no mesmo lugar: tira os blocos (e metades de cima) desta página.
    await job((function* () {
      for (const pos of cells) {
        for (let dy = 2; dy >= 0; dy--) {
          try {
            const block = s.dimension.getBlock({ x: pos.x, y: pos.y + dy, z: pos.z });
            if (block && !block.isAir) { s.changes.record({ x: pos.x, y: pos.y + dy, z: pos.z }, BlockPermutation.resolve("minecraft:air")); block.setType("minecraft:air"); }
          } catch { }
        }
        yield;
      }
    })());
    // Itens que caíram (planta sem apoio, onBreak) somem.
    await waitTicks(2);
    sweepLoose(s);
  }, async () => { }, onProgress);
  return placed;
}

/** Só itens/xp soltos na área. */
function sweepLoose(s: Session) {
  try {
    const region = s.journal.region;
    for (const entity of s.dimension.getEntities({
      location: region.min,
      volume: { x: region.max.x - region.min.x + 1, y: region.max.y - region.min.y + 1, z: region.max.z - region.min.z + 1 },
    })) {
      if (entity.typeId === "minecraft:item" || entity.typeId === "minecraft:xp_orb") { try { entity.remove(); } catch { } }
    }
  } catch { }
}

// ---------------------------------------------------------------------------------------------
// Fases: partículas e sons (só para o jogador do teste)

async function particlesPhase(s: Session, coverage: Coverage) {
  const list = coverage === "all" ? SELFTEST_PARTICLES : sampleEvenly(SELFTEST_PARTICLES, SAMPLE_PARTICLES);
  const rep = report(s, "particles");
  rep.total = list.length;
  rep.extra.of = SELFTEST_PARTICLES.length;
  await spawnParticleList(s, list, processed => { rep.done = processed; setProgress(s, processed, list.length); });
}

/** Partículas só para o jogador, `PARTICLES_PER_TICK` por tick numa grade de 16 pontos. */
async function spawnParticleList(s: Session, list: readonly string[], onProgress: (processed: number) => void) {
  const spots = gridOffsets(16, 4, 3).map(o => add(s.origin, { x: o.dx + 0.5, y: 1.5, z: o.dz + 3.5 }));
  await runInBatches(list, PARTICLES_PER_TICK, s.signal, (batch, index) => {
    for (const [i, id] of batch.entries()) {
      try { s.player.spawnParticle(id, spots[(index * PARTICLES_PER_TICK + i) % spots.length]); }
      catch (e) { fail(s, `particle ${id}`, e); }
    }
  }, () => waitTicks(1), onProgress);
  if (!stopped(s)) await waitTicks(40);
}

async function soundsPhase(s: Session, coverage: Coverage) {
  const list = coverage === "all" ? SELFTEST_SOUNDS : sampleSounds(SELFTEST_SOUNDS, SAMPLE_SOUNDS);
  const rep = report(s, "sounds");
  rep.total = list.length;
  rep.extra.of = SELFTEST_SOUNDS.length;
  await playSoundList(s, list, processed => { rep.done = processed; setProgress(s, processed, list.length); });
}

/** Sons só para o jogador, `SOUNDS_PER_TICK` por tick, em volume baixo; corta tudo a cada ~5 s e no fim. */
async function playSoundList(s: Session, list: readonly string[], onProgress: (processed: number) => void) {
  const where = add(s.origin, { x: 0.5, y: 1, z: 2.5 });
  await runInBatches(list, SOUNDS_PER_TICK, s.signal, batch => {
    for (const id of batch) {
      try { s.player.playSound(id, { volume: SOUND_VOLUME, location: where }); }
      catch (e) { fail(s, `sound ${id}`, e); }
    }
  }, async () => {
    await waitTicks(1);
  }, processed => {
    onProgress(processed);
    // Músicas longas não se acumulam: corta tudo a cada ~5 s.
    if (processed % (SOUNDS_PER_TICK * 100) === 0) { try { s.player.runCommand("stopsound @s"); } catch { } }
  });
  await waitTicks(10);
  try { s.player.runCommand("stopsound @s"); } catch { }
}

// ---------------------------------------------------------------------------------------------
// Fase: telas

function samplePokemon(species: string, options: { level?: number; shiny?: boolean; aspects?: string[] } = {}): PokemonData | undefined {
  try { return PokemonData.generateNewWildPokemon(species, { level: options.level ?? 30, shiny: options.shiny ?? false, aspects: options.aspects }); }
  catch { return undefined; }
}

/**
 * Abre uma tela e fecha depois de `ticks` (uiManager.closeAllForms, estável na server-ui 2.2.0). Espera a função
 * terminar (as telas resolvem ao fechar); insiste no fechamento se a tela reabrir sozinha.
 */
async function showFor(s: Session, label: string, open: () => unknown, onClose?: () => void, ticks = UI_HOLD_TICKS, phase: SelfTestPhase = "ui") {
  if (stopped(s)) return;
  const rep = report(s, phase);
  let settled = false;
  Promise.resolve().then(open).catch(e => {
    // Jogador saiu com a tela aberta (FormRejectError), ou o teste já acabou: não é falha da tela.
    if (!s.player.isValid || active !== s || String(e).includes("FormRejectError")) return;
    fail(s, `ui ${label}`, e);
  }).finally(() => { settled = true; });
  await waitTicks(ticks);
  // Fecha sempre (também as telas que não devolvem promessa, como o diálogo). O cliente responde ao fechamento com
  // "cancelado" e a função da tela termina; um cliente que não responde (bot de protocolo) só deixa a promessa pendente,
  // sem efeito: a tela já saiu da frente e a próxima abre normalmente.
  try { onClose?.(); } catch { }
  closeForms(s.player);
  for (let i = 0; i < 10 && !settled; i++) await waitTicks(1);
  if (!settled) {
    rep.extra.unanswered = (rep.extra.unanswered ?? 0) + 1;
    closeForms(s.player);
  }
  if (phase !== "ui") return;
  rep.done++;
  setProgress(s, rep.done, rep.total);
}

function sampleTeam(): PokemonData[] {
  return [
    samplePokemon("bulbasaur", { level: 12 }), samplePokemon("charmander", { level: 15, shiny: true }), samplePokemon("squirtle", { level: 9 }),
    samplePokemon("pikachu", { level: 30 }), samplePokemon("ninetales", { level: 40, aspects: ["alolan"] }), samplePokemon("unown", { level: 5 }),
  ].filter((p): p is PokemonData => !!p);
}

function sampleTile(p: PokemonData, hp: number, flat: boolean): BattleTileView {
  const max = Math.max(1, p.maxHealth);
  const cur = Math.round(max * hp);
  return {
    texture: portraitPath(toID(p.species), p.variant ?? 0), name: displayName(p), level: p.level, hpRatio: cur / max,
    hpText: battleHpText(cur, max, flat), status: hp < 0.3 ? "par" : "", gender: p.gender === "f" ? "f" : p.gender === "m" ? "m" : "n", owned: true,
  };
}

async function uiPhase(s: Session) {
  const player = s.player;
  const team = sampleTeam();
  const rep = report(s, "ui");
  rep.total = 24;
  try { player.camera.clear(); } catch { }
  // Escolha do inicial (2D e 3D), sem escolher nada: a tela é montada com os dados da config, sem showStarterGUI.
  const categories = getStarterCategories();
  if (categories.length) {
    await showFor(s, "starter", () => buildStarterForm(categories, { category: 0, position: 0, page: 0, studio: false, studioToggle: true }).show(player));
    await showFor(s, "starter-3d", () => {
      const studio = openStudio(player, starterStudioSubject(categories[0].pokemon[0]), FRAMING.starter);
      return buildStarterForm(categories, { category: 0, position: 0, page: 0, studio, studioToggle: true }).show(player);
    }, () => closeStudio(player));
    try { closeStudio(player); } catch { }
  }
  // Time (dados reais do jogador; só leitura).
  await showFor(s, "party", () => openPartyMenu(player));
  // Resumo: as 4 abas e a vista 3D, com um Pokémon de exemplo (fora do time: nada é gravado).
  const sample = team[3] ?? team[0];
  if (sample) {
    for (const tab of ["info", "moves", "stats", "marks"] as const) await showFor(s, `summary-${tab}`, () => showSummary(player, sample, { tab, studio: false }));
    await showFor(s, "summary-3d", () => showSummary(player, sample, { tab: "info", studio: true }), () => closeStudio(player));
  }
  // PC real (se o jogador tiver Pokémon) e uma caixa de exemplo cheia (30 espécies).
  await showFor(s, "pc", () => openPCGui(player, 0));
  await showFor(s, "pc-sample", () => samplePcForm(player, team).show(player));
  // Pokédex: lista de Pokédex, página de entradas e uma entrada.
  // Frente ui-polish: a Pokédex abre na grade (sem a lista de regiões da vanilla).
  await showFor(s, "pokedex-list", () => openPokedex(player));
  const dex = getDexes()[0];
  if (dex) await showFor(s, "pokedex-page", () => openDexPage(player, dex.id, 0, "all"));
  await showFor(s, "pokedex-entry", () => openPokedex(player, "pikachu"));
  // Diálogo de NPC (exemplo do Cobblemon) e troca (tela de exemplo, sem outro jogador).
  await showFor(s, "dialogue", () => { openDialogueCommand("cobblemon:example", player); }, () => stopDialogue(player));
  await showFor(s, "trade", () => sampleTradeForm(team).show(player));
  // Batalha: menu, golpes, troca, mochila e alvo (layouts de ui/battle.json com dados de exemplo).
  for (const [label, form] of sampleBattleForms(team)) await showFor(s, label, () => form.show(player));
  // Conquistas e estatísticas.
  await showFor(s, "achievements", () => openAchievements(player));
  await showFor(s, "stats", () => openStatsScreen(player));
  // HUD: time de exemplo, caixas da batalha (singles, duplas, minimizada) e toasts. Os canais voltam ao que eram.
  const savedParty = getHudChannel(player, CHANNEL.PARTY);
  const savedBattle = getHudChannel(player, CHANNEL.BATTLE);
  try {
    pushParty(player, team, 1, true);
    await waitTicks(30);
    const views: BattleHudView[] = [
      { slotsPerActor: 1, left: [team[0] && sampleTile(team[0], 0.8, true)], right: [team[4] && sampleTile(team[4], 0.25, false)] },
      { slotsPerActor: 2, leftActor: player.name, rightActor: "Selftest", left: team.slice(0, 2).map(p => sampleTile(p, 0.6, true)), right: team.slice(2, 4).map(p => sampleTile(p, 0.1, false)) },
      { slotsPerActor: 1, left: [team[1] && sampleTile(team[1], 1, true)], right: [team[5] && sampleTile(team[5], 0.5, false)], ui: { minimised: true, prompt: 1 } },
    ];
    for (const view of views) {
      if (stopped(s)) break;
      setHudChannel(player, CHANNEL.BATTLE, encodeBattleBody(view));
      await waitTicks(30);
    }
    if (team[3]) showToast(player, captureToast(String(toID(team[3].species)), getPokemonIconTexture(team[3])));
    showToast(player, advancementToast("task", "cobblemon.selftest.phase.ui"));
    await waitTicks(40);
  }
  finally {
    setHudChannel(player, CHANNEL.BATTLE, savedBattle ?? encodeBattleBody(undefined));
    if (savedParty !== undefined) setHudChannel(player, CHANNEL.PARTY, savedParty);
  }
  rep.done += 1;
  rep.extra.hud = 1;
  try { player.camera.setCamera("minecraft:free", { location: add(s.origin, CAMERA), facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
}

/** PC com uma caixa de exemplo (mesma ordem de botões do PC real: 6 de navegação, 30 espaços, time, prévia). */
function samplePcForm(player: Player, team: PokemonData[]): ActionFormData {
  const species = sampleEvenly(Object.keys(VARIANTS), 30);
  let wallpaper = "";
  try { wallpaper = boxWallpaperTexturePath(player, 0); } catch { }
  const form = new ActionFormData()
    .title({ rawtext: [{ text: SCREEN.PC }, { text: "PC - Selftest" }] })
    .body(wallpaper)
    .button("<<").button({ translate: "cobblemon.ui.pc.box.title", with: ["1"] }).button(">>").button("").button("").button("");
  for (let i = 0; i < PC.PARTY - PC.SLOTS; i++) {
    const p = species[i] ? samplePokemon(species[i], { level: 5 + i, shiny: i % 7 === 0 }) : undefined;
    if (p) form.button(renderPokemonName(p), getPokemonIconTexture(p));
    else form.button({ translate: "cobblemon.ui.empty" });
  }
  for (let i = 0; i < 6; i++) {
    const p = team[i];
    if (p) form.button(renderPokemonName(p), getPokemonIconTexture(p));
    else form.button({ translate: "cobblemon.ui.empty" });
  }
  // Frente ui-polish: a mesma prévia do PC real (nível, nome, tipos, item, natureza, habilidade, golpes).
  if (team[0]) appendPreviewButtons(form, team[0], 0);
  return form;
}

function sampleTradeForm(team: PokemonData[]): ActionFormData {
  const lines: RawMessage[] = [{ text: "§e" }, { translate: "cobblemon.port.trade.your_offer" }, { text: "\n" }];
  if (team[0]) lines.push(describePokemon(team[0]));
  lines.push({ text: "\n\n§e" }, { translate: "cobblemon.port.trade.their_offer", with: ["Selftest"] }, { text: "\n" });
  if (team[4]) lines.push(describePokemon(team[4]));
  return new ActionFormData().title({ translate: "cobblemon.ui.trade" }).body({ rawtext: lines })
    .button({ translate: "cobblemon.port.trade.choose" }).button({ translate: "cobblemon.port.trade.accept" }).button({ translate: "cobblemon.port.trade.cancel" });
}

function sampleBattleForms(team: PokemonData[]): [string, { show(player: Player): Promise<unknown> }][] {
  const lead = team[3] ?? team[0];
  const out: [string, { show(player: Player): Promise<unknown> }][] = [];
  const action = new CellForm(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_ACTION, { translate: "cobblemon.battle.choose_actions" }), BATTLE_ACTION.COUNT)
    .body(lead ? describePokemon(lead) : "");
  (["fight", "bag", "switch", "run"] as const).forEach((kind, i) =>
    action.cell(BATTLE_ACTION.TILES + i, { translate: kind === "bag" ? "cobblemon.port.battle.ui.bag" : `cobblemon.battle.ui.${kind}` }, battleMenuTexture(kind)));
  out.push(["battle-action", action]);
  const moves = new CellForm(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_MOVES, { translate: "cobblemon.battle.ui.fight" }), BATTLE_MOVES.COUNT)
    .body(lead ? lead.getTranslatedName() : "");
  (["thunderbolt", "quickattack", "irontail", "thunderwave"]).forEach((id, i) => {
    const move = Dex.moves.get(id);
    moves.cell(BATTLE_MOVES.MOVES + i, moveTileText(id, i === 3 ? 0 : move.pp, move.pp, i === 3, undefined, []), typeKeyTexture(toID(move.type)));
  });
  moves.cell(BATTLE_MOVES.BACK, { translate: "gui.back" });
  out.push(["battle-moves", moves]);
  const swap = new CellForm(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_SWITCH, { translate: "cobblemon.battle.ui.switch" }), BATTLE_SWITCH.COUNT).body("");
  team.slice(0, 6).forEach((p, i) => {
    const ratio = [1, 0.7, 0.4, 0.15, 0, 0.9][i];
    swap.cell(BATTLE_SWITCH.SLOTS + i, renderPokemonName(p), getPokemonSpriteTexture(p)).cell(BATTLE_SWITCH.BARS + i, BLANK, barTexture(ratio * 100, 100));
  });
  swap.cell(BATTLE_SWITCH.BACK, { translate: "gui.back" });
  out.push(["battle-switch", swap]);
  const bag = new ActionFormData().title(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_LIST, { translate: "cobblemon.port.battle.ui.bag" }));
  for (const id of ["cobblemon:potion", "cobblemon:super_potion", "cobblemon:full_heal", "cobblemon:x_attack", "cobblemon:revive"]) {
    const def = BAG_ITEMS.get(id);
    if (def) bag.button({ rawtext: [{ translate: def.itemName }, { text: " §7x3" }] });
  }
  bag.button({ translate: "cobblemon.port.battle.ui.throw_ball" }).button({ translate: "gui.back" });
  out.push(["battle-bag", bag]);
  const target = new CellForm(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_TARGET, { translate: "cobblemon.battle.select_target" }), BATTLE_TARGET.COUNT)
    .body({ translate: "cobblemon.move.thunderbolt" });
  team.slice(3, 6).forEach((p, i) => target.cell(BATTLE_TARGET.FOES + i, renderPokemonName(p), getPokemonSpriteTexture(p)));
  team.slice(0, 2).forEach((p, i) => target.cell(BATTLE_TARGET.ALLIES + i, renderPokemonName(p), getPokemonSpriteTexture(p)));
  target.cell(BATTLE_TARGET.BACK, { translate: "gui.back" });
  out.push(["battle-target", target]);
  // Frente ui-polish: a mesma confirmação da batalha real (ForfeitConfirmationSelection no layout da batalha).
  out.push(["battle-forfeit", forfeitForm().build()]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fase: roteiro de telas para print (modo `telas`)

/** Como abrir, renovar e fechar uma parada do roteiro. */
interface ScreenRun {
  /** Abre a tela. Uma promessa termina quando o jogador fecha (fechar = próxima); sem promessa, só o tempo conta. */
  open: () => unknown;
  /** A cada segundo com a tela aberta (HUD que precisa ser renovado, como a actionbar do lembrete). */
  refresh?: () => void;
  /** Ao sair da tela (fecha o estúdio/diálogo, devolve o HUD). */
  close?: () => void;
}

function screenName(key: string, names?: ReadonlyMap<string, RawMessage>): RawMessage {
  return names?.get(key) ?? { translate: `cobblemon.selftest.screen.${key}` };
}

/** Time como no /cobblemon:party (Party.openPartyMenu), com o time de exemplo. */
function samplePartyForm(team: PokemonData[]): ActionFormData {
  const form = new ActionFormData().title({ translate: "cobblemon.ui.party" });
  for (const pokemon of team) form.button(partyButtonText(pokemon, false), getPokemonSpriteTexture(pokemon.species));
  for (let i = team.length; i < 6; i++) form.button({ translate: "cobblemon.ui.empty" });
  return form.button("PC", "textures/block/pc");
}

/** Confirmação do inicial (StarterGUI.showStarterGUI), sem escolher nada. */
function sampleStarterConfirm(species: string): MessageFormData {
  return new MessageFormData()
    .title({ translate: "cobblemon.ui.starter.title" })
    .body({ translate: "cobblemon.port.starter.confirm", with: { rawtext: [{ translate: `cobblemon.species.${species}.name` }] } })
    .button1({ translate: "gui.back" })
    .button2({ translate: "cobblemon.ui.starter.choosebutton" });
}

/** Golpes com os botões de gimmick (Battle.showMoveMenu com Mega/Z/Tera disponíveis; o primeiro ligado). */
function sampleGimmickMovesForm(team: PokemonData[]): CellForm {
  const lead = team[3] ?? team[0];
  const form = new CellForm(layoutTitle(SCREEN.BATTLE, SUB.BATTLE_MOVES, { translate: "cobblemon.battle.ui.fight" }), BATTLE_MOVES.COUNT)
    .body(lead ? lead.getTranslatedName() : "");
  (["thunderbolt", "quickattack", "irontail", "thunderwave"]).forEach((id, i) => {
    const move = Dex.moves.get(id);
    form.cell(BATTLE_MOVES.MOVES + i, moveTileText(id, move.pp, move.pp, false, undefined, []), typeKeyTexture(toID(move.type)));
  });
  form.cell(BATTLE_MOVES.BACK, { translate: "gui.back" });
  const gimmicks = GIMMICK_ORDER.filter(g => g === "mega" || g === "zmove" || g === "terastal").slice(0, BATTLE_MOVES.GIMMICK_SLOTS);
  gimmicks.forEach((gimmick, i) => form.cell(BATTLE_MOVES.GIMMICKS + i,
    { rawtext: [{ text: i === 0 ? GIMMICK_ON_MARKER : "" }, { translate: gimmickLabelKey(gimmick) }] }, gimmickTexture(gimmick)));
  return form;
}

/** PC de exemplo com a caixa vazia (mesma ordem de botões do PC real). */
function sampleEmptyPcForm(player: Player, team: PokemonData[]): ActionFormData {
  let wallpaper = "";
  try { wallpaper = boxWallpaperTexturePath(player, 1); } catch { }
  const form = new ActionFormData()
    .title({ rawtext: [{ text: SCREEN.PC }, { text: "PC - Selftest" }] })
    .body(wallpaper)
    .button("<<").button({ translate: "cobblemon.ui.pc.box.title", with: ["2"] }).button(">>").button("").button("").button("");
  for (let i = 0; i < PC.PARTY - PC.SLOTS; i++) form.button({ translate: "cobblemon.ui.empty" });
  for (let i = 0; i < 6; i++) {
    const p = team[i];
    if (p) form.button(renderPokemonName(p), getPokemonIconTexture(p));
    else form.button({ translate: "cobblemon.ui.empty" });
  }
  return form;
}

/** Resolve quando o diálogo do jogador acaba (o diálogo não devolve promessa: confere o estado a cada 5 ticks). */
function dialogueEnded(player: Player): Promise<void> {
  return new Promise(resolve => {
    const id = system.runInterval(() => {
      let open = false;
      try { open = player.isValid && getActiveDialogue(player) !== undefined; } catch { }
      if (open) return;
      system.clearRun(id);
      resolve();
    }, 5);
  });
}

/** Como mostrar cada parada do roteiro (dados de exemplo; nada é gravado no jogador). */
function screenRuns(s: Session, team: PokemonData[], hud: { party?: string; battle?: string }): Record<string, ScreenRun> {
  const player = s.player;
  const categories = getStarterCategories();
  const starter = categories.length ? starterSpecies(categories[0].pokemon[0]) ?? "bulbasaur" : "bulbasaur";
  const sample = team[3] ?? team[0];
  const battleForms = new Map(sampleBattleForms(team));
  const showBattle = (label: string) => () => battleForms.get(label)?.show(player);
  const battleHud = (view: BattleHudView): ScreenRun => ({
    open: () => setHudChannel(player, CHANNEL.BATTLE, encodeBattleBody(view)),
    close: () => setHudChannel(player, CHANNEL.BATTLE, hud.battle ?? encodeBattleBody(undefined)),
  });
  const summary = (tab: "info" | "moves" | "stats" | "marks", studio: boolean): ScreenRun => ({
    open: () => sample && showSummary(player, sample, { tab, studio }),
    close: studio ? () => closeStudio(player) : undefined,
  });
  const reminder = () => player.onScreenDisplay.setActionBar({ translate: "cobblemon.ui.starter.chooseyourstarter", with: ["/cobblemon:starter"] });
  const dex = getDexes()[0];
  const moves = (["thunderbolt", "quickattack", "irontail", "thunderwave"]).map((id, i) => {
    const move = Dex.moves.get(id);
    return { id, type: toID(move.type), pp: `${i === 3 ? 0 : move.pp}/${move.pp}`, usable: i !== 3 };
  });
  return {
    starter: { open: () => buildStarterForm(categories, { category: 0, position: 0, page: 0, studio: false, studioToggle: true }).show(player) },
    starter_3d: {
      open: () => {
        const studio = openStudio(player, { species: starter }, FRAMING.starter);
        return buildStarterForm(categories, { category: 0, position: 0, page: 0, studio, studioToggle: true }).show(player);
      },
      close: () => closeStudio(player),
    },
    starter_confirm: { open: () => sampleStarterConfirm(starter).show(player) },
    starter_reminder: { open: reminder, refresh: reminder, close: () => player.onScreenDisplay.setActionBar(" ") },
    party: { open: () => samplePartyForm(team).show(player) },
    party_hud: {
      open: () => pushParty(player, team, 1, true),
      close: () => { if (hud.party !== undefined) setHudChannel(player, CHANNEL.PARTY, hud.party); },
    },
    summary_info: summary("info", false),
    summary_moves: summary("moves", false),
    summary_stats: summary("stats", false),
    summary_marks: summary("marks", false),
    summary_info_3d: summary("info", true),
    summary_moves_3d: summary("moves", true),
    summary_stats_3d: summary("stats", true),
    summary_marks_3d: summary("marks", true),
    pc: { open: () => samplePcForm(player, team).show(player) },
    pc_empty: { open: () => sampleEmptyPcForm(player, team).show(player) },
    pokedex_list: { open: () => openPokedex(player) },
    pokedex_page: { open: () => dex && openDexPage(player, dex.id, 0, "all") },
    pokedex_entry: { open: () => openPokedex(player, "pikachu") },
    dialogue: {
      open: () => {
        openDialogueCommand("cobblemon:example", player);
        return dialogueEnded(player);
      },
      close: () => stopDialogue(player),
    },
    trade: { open: () => sampleTradeForm(team).show(player) },
    battle_action: { open: showBattle("battle-action") },
    battle_moves: { open: showBattle("battle-moves") },
    battle_gimmick: { open: () => sampleGimmickMovesForm(team).show(player) },
    battle_switch: { open: showBattle("battle-switch") },
    battle_bag: { open: showBattle("battle-bag") },
    battle_target: { open: showBattle("battle-target") },
    battle_forfeit: { open: showBattle("battle-forfeit") },
    battle_hud: battleHud({ slotsPerActor: 1, left: [team[0] && sampleTile(team[0], 0.8, true)], right: [team[4] && sampleTile(team[4], 0.25, false)] }),
    battle_hud_doubles: battleHud({
      slotsPerActor: 2, leftActor: player.name, rightActor: "Selftest",
      left: team.slice(0, 2).map(p => sampleTile(p, 0.6, true)), right: team.slice(2, 4).map(p => sampleTile(p, 0.1, false)),
    }),
    battle_minimised: battleHud({
      slotsPerActor: 1, left: [team[1] && sampleTile(team[1], 1, true)], right: [team[5] && sampleTile(team[5], 0.5, false)],
      ui: { minimised: true, prompt: BATTLE_PROMPT.ACTIONS },
    }),
    battle_minimised_moves: battleHud({
      slotsPerActor: 1, left: [team[3] && sampleTile(team[3], 0.7, true)], right: [team[4] && sampleTile(team[4], 0.4, false)],
      ui: { minimised: true, prompt: BATTLE_PROMPT.MENU, cursor: 0, moves },
    }),
    achievements: { open: () => openAchievements(player) },
    stats: { open: () => openStatsScreen(player) },
    toast_capture: { open: () => { if (team[3]) showToast(player, captureToast(String(toID(team[3].species)), getPokemonIconTexture(team[3]))); } },
    toast_advancement: { open: () => showToast(player, advancementToast("task", "cobblemon.selftest.phase.screens")) },
  };
}

/** Mostra uma parada: aviso, abre, espera (fechar, tempo ou stop) e fecha. */
async function showScreen(s: Session, step: ScreenStep, run: ScreenRun, index: number, total: number): Promise<ScreenOutcome> {
  const player = s.player;
  const name = screenName(step.key, s.screenNames);
  const n = index + 1;
  try { player.onScreenDisplay.setActionBar(tr("cobblemon.selftest.screens.announce", n, total, name)); } catch { }
  tell(player, tr("cobblemon.selftest.screens.now", n, total, name));
  await waitTicks(SCREEN_ANNOUNCE_TICKS);
  if (stopped(s)) {
    console.info(`[selftest] tela ${n}/${total} ${step.key}: stopped em 0.0 s`);
    return "stopped";
  }
  let settled = false;
  let promise = false;
  const started = system.currentTick;
  try {
    const result = run.open();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      promise = true;
      (result as Promise<unknown>).catch(e => {
        // Jogador saiu com a tela aberta (FormRejectError), ou o teste já acabou: não é falha da tela.
        if (!s.player.isValid || active !== s || String(e).includes("FormRejectError")) return;
        fail(s, `tela ${step.key}`, e);
      }).finally(() => { settled = true; });
    }
  }
  catch (e) { fail(s, `tela ${step.key}`, e); settled = true; promise = true; }
  const outcome = await holdScreen({
    ticks: s.screenSeconds * 20,
    wait: waitTicks,
    stopped: () => stopped(s),
    closed: () => promise && settled,
    onSecond: remaining => {
      try { run.refresh?.(); } catch { }
      if (step.actionbar) return;
      try { player.onScreenDisplay.setActionBar(tr("cobblemon.selftest.screens.countdown", n, total, name, remaining)); } catch { }
    },
  });
  try { run.close?.(); } catch { }
  closeForms(player);
  for (let i = 0; i < 10 && promise && !settled; i++) await waitTicks(1);
  console.info(`[selftest] tela ${n}/${total} ${step.key}: ${outcome} em ${((system.currentTick - started) / 20).toFixed(1)} s`);
  return outcome;
}

async function screensPhase(s: Session) {
  const player = s.player;
  const team = sampleTeam();
  const rep = report(s, "screens");
  const steps: ScreenStep[] = screenTour({ starter: getStarterCategories().length > 0, dex: getDexes().length > 0 });
  try { player.camera.clear(); } catch { }
  const hud = { party: getHudChannel(player, CHANNEL.PARTY), battle: getHudChannel(player, CHANNEL.BATTLE) };
  const runs = screenRuns(s, team, hud);
  // Paradas das extensões ligadas, depois das do base (chave com o modo da extensão na frente: sem colisão).
  for (const extension of availableExtensions()) {
    let extra: ReturnType<NonNullable<SelfTestExtension["screens"]>> = [];
    try { extra = extension.screens?.(player) ?? []; } catch (e) { fail(s, `telas ${extension.mode}`, e); }
    for (const screen of extra) {
      const key = `${extension.mode}.${screen.key}`;
      steps.push({ key, kind: screen.kind, actionbar: screen.actionbar });
      runs[key] = { open: screen.open, refresh: screen.refresh, close: screen.close };
      s.screenNames.set(key, screen.name);
    }
  }
  rep.total = steps.length;
  tell(player, tr("cobblemon.selftest.screens.intro", steps.length, s.screenSeconds, "Win+Alt+PrtScn", "Videos\\Captures"));
  const outcomes: Record<ScreenOutcome, number> = { closed: 0, timeout: 0, stopped: 0 };
  try {
    for (const [index, step] of steps.entries()) {
      if (stopped(s)) break;
      setProgress(s, index, steps.length);
      const outcome = await showScreen(s, step, runs[step.key] ?? { open: () => undefined }, index, steps.length);
      outcomes[outcome]++;
      if (outcome === "stopped") break;
      s.screensShown.push(step.key);
      rep.done = s.screensShown.length;
    }
  }
  finally {
    setHudChannel(player, CHANNEL.BATTLE, hud.battle ?? encodeBattleBody(undefined));
    if (hud.party !== undefined) setHudChannel(player, CHANNEL.PARTY, hud.party);
    try { closeStudio(player); } catch { }
    try { player.onScreenDisplay.setActionBar(" "); } catch { }
  }
  rep.extra.closed = outcomes.closed;
  rep.extra.timeout = outcomes.timeout;
  setProgress(s, rep.done, rep.total);
  console.info(`[selftest] telas: ${rep.done}/${rep.total} (${outcomes.closed} fechada(s) pelo jogador, ${outcomes.timeout} pelo tempo de ${s.screenSeconds} s); ordem: ${s.screensShown.join(", ")}`);
  try { player.camera.setCamera("minecraft:free", { location: add(s.origin, CAMERA), facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
}

// ---------------------------------------------------------------------------------------------
// Fase: batalha (time temporário contra um selvagem de teste)

function tempPokemon(species: string, level: number, moves: string[]): PokemonData | undefined {
  const p = samplePokemon(species, { level });
  if (!p) return undefined;
  p.moves = moves;
  p.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
  // Cópia de batalha: não é salva, não é capturável e some no fim (BattlePokemon.safeCopyOf).
  p.battleClone = true;
  return p;
}

function scriptedResponse(kind: TurnKind, request: RequestData): ActionResponse | undefined {
  const moveset = request.active?.[0];
  const firstMove = () => {
    const move = moveset?.moves.find(m => !m.disabled && (m.pp === undefined || m.pp > 0)) ?? moveset?.moves[0];
    return move ? new MoveActionResponse(move.id) : undefined;
  };
  const bench = request.side.pokemon.find(p => !p.active && !(p.condition.endsWith(" fnt") || p.condition.startsWith("0")));
  if (request.forceSwitch) return bench ? new SwitchActionResponse(requestPokemonUUID(bench)) : undefined;
  if (kind === "switch" && bench && !moveset?.trapped) return new SwitchActionResponse(requestPokemonUUID(bench));
  if (kind === "bag") {
    const def = BAG_ITEMS.get("cobblemon:x_attack");
    const self = request.side.pokemon.find(p => p.active);
    if (def && self) return new BagItemActionResponse(def, requestPokemonUUID(self));
  }
  return firstMove();
}

async function battlePhase(s: Session) {
  const player = s.player;
  const rep = report(s, "battle");
  rep.total = BATTLE_TURNS.length;
  const team = [
    tempPokemon("pikachu", 5, ["thundershock", "growl", "quickattack"]),
    tempPokemon("charmander", 5, ["ember", "scratch", "smokescreen"]),
    tempPokemon("squirtle", 5, ["watergun", "tailwhip", "tackle"]),
  ].filter((p): p is PokemonData => !!p);
  const wildData = tempPokemon("magikarp", 80, ["splash"]);
  if (!wildData || team.length < 2) { fail(s, "battle: não foi possível montar os times"); return; }
  try { player.camera.clear(); } catch { }
  try { player.teleport(add(s.origin, { x: 0.5, y: 0, z: 1.5 }), { facingLocation: add(s.origin, { x: 0.5, y: 1, z: 8.5 }) }); } catch { }
  let wild: Entity;
  try {
    wild = s.dimension.spawnEntity(wildData.getEntityId(), add(s.origin, { x: 0.5, y: 0, z: 8.5 }), { initialPersistence: false, initialRotation: 180 });
    wild.addTag(SELFTEST_TAG);
    s.entityIds.add(wild.id);
    wildData.applyToCobblemon(wild);
    wild.setProperty("cobblemon:wild", true);
    wild.triggerEvent("cobblemon:set_wild");
  } catch (e) { fail(s, "battle: selvagem", e); return; }
  const playerActor = new BattleActor(player, team, { type: ActorType.PLAYER });
  let turn = 0;
  let finishAt = -1;
  playerActor.decider = async (actor, request) => {
    // A tela de verdade (menu da batalha) fica aberta um pouco; se o jogador escolher, vale a escolha dele.
    let chosen: ActionResponse[] | undefined;
    let settled = false;
    handleMoveRequest(request, actor, actor.battle).then(r => { chosen = r; }).catch(() => { }).finally(() => { settled = true; });
    await waitTicks(BATTLE_MENU_TICKS);
    closeForms(player);
    for (let i = 0; i < 10 && !settled; i++) await waitTicks(1);
    if (actor.battle.ended || stopped(s)) return undefined;
    if (chosen?.length) return chosen;
    const kind = request.forceSwitch ? "switch" : BATTLE_TURNS[Math.min(turn, BATTLE_TURNS.length - 1)];
    if (!request.forceSwitch) turn++;
    rep.done = Math.min(turn, rep.total);
    setProgress(s, rep.done, rep.total);
    if (turn >= BATTLE_TURNS.length && finishAt < 0) finishAt = system.currentTick + 100;
    const response = scriptedResponse(kind, request);
    return response ? [response] : undefined;
  };
  const wildActor = new BattleActor(wild, [wildData], { type: ActorType.WILD });
  const result = startBattle(BattleFormat.GEN_9_SINGLES, [playerActor], [wildActor], { fleeDistance: -1, notify: false });
  if (!(result instanceof PokemonBattle)) { fail(s, `battle: não iniciou ${JSON.stringify((result as { text?: unknown }).text ?? result)}`); return; }
  s.battle = result;
  const deadline = system.currentTick + BATTLE_TIMEOUT_TICKS;
  while (!result.ended && !stopped(s) && system.currentTick < deadline) {
    if (finishAt > 0 && system.currentTick >= finishAt) break;
    await waitTicks(10);
  }
  rep.extra.turns = turn;
  if (!result.ended) { try { result.stop(); } catch (e) { fail(s, "battle: stop", e); } }
  s.battle = undefined;
  // Recolhimento/animações de fim.
  await waitTicks(40);
  try { if (wild.isValid) wild.remove(); } catch { }
  s.entityIds.delete(wild.id);
  try { player.camera.setCamera("minecraft:free", { location: add(s.origin, CAMERA), facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
}

// ---------------------------------------------------------------------------------------------
// Fases de extensões (scripts/debug/selfTestExtensions.ts)

/** Vista padrão da área (a mesma do início do teste). */
function defaultCamera(s: Session) {
  if (!s.player.isValid) return;
  try { s.player.camera.setCamera("minecraft:free", { location: add(s.origin, CAMERA), facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
}

function extensionContext(s: Session, extension: SelfTestExtension, coverage: Coverage): SelfTestContext {
  const phase = extension.mode;
  const rep = report(s, phase);
  return {
    player: s.player,
    dimension: s.dimension,
    origin: s.origin,
    coverage,
    plan: s.plan.map(p => p.phase),
    stopped: () => stopped(s),
    waitTicks,
    job,
    fail: (what, e) => fail(s, `${phase} ${what}`, e),
    log: line => { try { console.info(`[selftest] ${phase} ${line}`); } catch { } },
    progress: (done, total) => { rep.done = done; rep.total = total; setProgress(s, done, total); },
    count: (key, n = 1) => { rep.extra[key] = (rep.extra[key] ?? 0) + n; },
    summary: line => { s.extensionSummary.push(line); },
    spawnPokemon: (species, variant, location) => spawnDisplayPokemon(s, { species, variant }, location),
    despawn: entity => {
      const id = entity.id;
      try { if (entity.isValid) entity.remove(); } catch { }
      s.entityIds.delete(id);
    },
    track: entity => {
      try { entity.addTag(SELFTEST_TAG); } catch { }
      s.entityIds.add(entity.id);
    },
    setBlock: (pos, permutation) => {
      try { return setBlock(s, pos, permutation); }
      catch (e) { fail(s, `${phase} bloco ${typeof permutation === "string" ? permutation : permutation.type.id}`, e); return false; }
    },
    sweepLoose: () => sweepLoose(s),
    showPokemon: async targets => {
      const before = s.failures.length;
      await showPokemonTargets(s, targets, processed => setProgress(s, processed, targets.length));
      return s.failures.length - before;
    },
    showBlocks: (blocks: readonly SelfTestBlockInfo[]) => {
      const targets = blockTargets(blocks, "all");
      return placeBlockPages(s, targets, processed => setProgress(s, processed, targets.length));
    },
    showParticles: ids => spawnParticleList(s, ids, processed => setProgress(s, processed, ids.length)),
    playSounds: ids => playSoundList(s, ids, processed => setProgress(s, processed, ids.length)),
    showScreen: (label, open, onClose, ticks) => showFor(s, `${phase} ${label}`, open, onClose, ticks ?? UI_HOLD_TICKS, phase),
    resetCamera: () => defaultCamera(s),
  };
}

async function extensionPhase(s: Session, extension: SelfTestExtension, coverage: Coverage) {
  try { s.player.teleport(add(s.origin, STAND), { dimension: s.dimension, facingLocation: add(s.origin, CAMERA_TARGET) }); } catch { }
  defaultCamera(s);
  try { await extension.run(extensionContext(s, extension, coverage)); }
  finally {
    // O que a fase deixou para trás (entidades marcadas continuam na lista da limpeza do fim).
    sweepLoose(s);
    if (s.player.isValid) {
      closeForms(s.player);
      try { s.player.onScreenDisplay.setActionBar(" "); } catch { }
      defaultCamera(s);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Sessão

async function runPhase(s: Session, plan: PhasePlan) {
  s.phase = plan.phase;
  setProgress(s, 0, 0);
  const started = Date.now();
  try {
    switch (plan.phase) {
      case "entities": await entitiesPhase(s, plan.coverage); break;
      case "movement": await movementPhase(s, plan.coverage); break;
      case "blocks": await blocksPhase(s, plan.coverage); break;
      case "particles": await particlesPhase(s, plan.coverage); break;
      case "sounds": await soundsPhase(s, plan.coverage); break;
      case "ui": await uiPhase(s); break;
      case "battle": await battlePhase(s); break;
      case "screens": await screensPhase(s); break;
      default: {
        const extension = findSelfTestExtension(plan.phase);
        if (extension) await extensionPhase(s, extension, plan.coverage);
        else fail(s, `fase ${plan.phase}: desconhecida`);
      }
    }
  }
  catch (e) { fail(s, `fase ${plan.phase}`, e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : e); }
  report(s, plan.phase).extra.ms = Date.now() - started;
  console.info(`[selftest] fase ${plan.phase} (${plan.coverage}) em ${formatDuration(Date.now() - started)}`);
}

async function startSession(player: Player, mode: SelfTestMode, screenSeconds: number) {
  if (active) { tell(player, tr("cobblemon.selftest.already_running", active.playerName)); return; }
  // Área de um teste interrompido ainda por limpar, ou este jogador ainda não restaurado: espera.
  if ([...pending.values()].some(p => !p.journal.regionClean) || pendingOf(player)) { tell(player, tr("cobblemon.selftest.recovering")); return; }
  if (isPlayerInAnyBattle(player)) { tell(player, tr("cobblemon.selftest.in_battle")); return; }
  try { if (player.getComponent("minecraft:riding")?.entityRidingOn) { tell(player, tr("cobblemon.selftest.riding")); return; } } catch { }
  const plan = planFor(mode, availableExtensions());
  const origin = await findArea(player);
  if (!player.isValid) return;
  if (!origin) { tell(player, tr("cobblemon.selftest.no_space")); return; }
  if (active) { tell(player, tr("cobblemon.selftest.already_running", (active as Session).playerName)); return; }
  const worldIds = new Set(world.getDynamicPropertyIds());
  const worldValues = new Map<string, unknown>();
  for (const id of worldIds) { try { worldValues.set(id, JSON.stringify(world.getDynamicProperty(id))); } catch { } }
  const snapshot = snapshotPlayer(player);
  const snapshotText = splitChunks(encodeSnapshot(snapshot));
  const rotation = player.getRotation();
  const journal: SelfTestJournal = {
    v: 1, playerId: player.id, playerName: player.name, dimension: player.dimension.id,
    origin: { x: player.location.x, y: player.location.y, z: player.location.z }, rotation: { x: rotation.x, y: rotation.y },
    gameMode: String(player.getGameMode()), region: regionOf(origin), snapshotChunks: snapshotText.length, started: Date.now(),
  };
  try {
    snapshotText.forEach((part, i) => world.setDynamicProperty(`${SNAPSHOT_PREFIX}${player.id}:${i}`, part));
    writeJournal(journal);
  } catch (e) {
    clearJournal(journal);
    tell(player, tr("cobblemon.selftest.error", String(e)));
    return;
  }
  const s: Session = {
    player, playerId: player.id, playerName: player.name, mode, plan, signal: new StopSignal(), startedAt: Date.now(),
    dimension: player.dimension, origin, journal, changes: new BlockChangeLog<BlockPermutation>(), entityIds: new Set(), snapshot,
    inventory: snapshotInventory(player), progress: { done: 0, total: 0 }, reports: {}, failures: [],
    worldIds, worldValues, screenSeconds, screensShown: [], screenNames: new Map(), extensionSummary: [],
  };
  active = s;
  console.info(`[selftest] ${player.name}: modo ${mode}, área ${JSON.stringify(journal.region)}`);
  tell(player, tr("cobblemon.selftest.started", mode));
  if (!SELFTEST_MANIFEST_BUILT) tell(player, tr("cobblemon.selftest.no_manifest"));
  s.progressRun = system.runInterval(() => showProgress(s), 10);
  try {
    spawnAnchors(s, snapshotText);
    try { player.setGameMode(GameMode.Creative); } catch { }
    await placeFloor(s);
    player.teleport(add(origin, STAND), { dimension: s.dimension, facingLocation: add(origin, CAMERA_TARGET) });
    try { player.camera.setCamera("minecraft:free", { location: add(origin, CAMERA), facingLocation: add(origin, CAMERA_TARGET) }); } catch { }
    await waitTicks(20);
    for (const phase of plan) {
      if (stopped(s)) break;
      await runPhase(s, phase);
    }
  }
  catch (e) { fail(s, "sessão", e); }
  finally {
    await finishSession(s);
  }
}

/** Limpa a área e devolve o jogador (ou deixa para quando ele voltar). Sempre roda, com ou sem parada. */
async function finishSession(s: Session) {
  if (s.progressRun !== undefined) { try { system.clearRun(s.progressRun); } catch { } }
  const left = !s.player.isValid;
  if (s.battle && !s.battle.ended) { try { s.battle.stop(); } catch { } }
  if (!left) {
    // Desce da montaria antes de ela sumir (câmera, permissões e sons da montaria voltam agora).
    leaveMount(s.player);
    try { closeStudio(s.player); } catch { }
    try { stopDialogue(s.player); } catch { }
    closeForms(s.player);
  }
  // Entidades, blocos e sobras (itens de onBreak aparecem no tick seguinte). Com a fase de movimento, drena a água antes.
  sweepEntities(s.dimension, s.journal.region, s.entityIds);
  await restoreBlocks(s.dimension, s.journal.region, s.changes, s.plan.some(p => p.phase === "movement"));
  await waitTicks(3);
  sweepEntities(s.dimension, s.journal.region);
  const keys = clearWorldKeys(s.dimension.id, s.journal.region);
  if (keys.length) console.info(`[selftest] ${keys.length} registro(s) de bloco no mundo apagado(s) (${[...new Set(keys.map(k => k.split("|")[0]))].join(", ")})`);
  s.journal.regionClean = true;
  try { writeJournal(s.journal); } catch { }
  const elapsed = formatDuration(Date.now() - s.startedAt);
  if (left) {
    pending.set(s.playerId, { journal: s.journal, snapshot: s.snapshot, inventory: s.inventory });
    console.info(`[selftest] ${s.playerName} saiu no meio (${elapsed}); área limpa, jogador restaurado ao voltar`);
    active = undefined;
    await verifyCleanup(s);
    return;
  }
  const player = s.player;
  restorePlayerPlace(player, s.journal);
  // Distância montada fica em memória (grava a cada 5 s): grava agora, antes de as estatísticas voltarem ao snapshot.
  try { flushRidingDistance(player); } catch { }
  const changed = restorePlayerData(player, s.snapshot, s.inventory);
  syncAchievementsCache(player);
  clearJournal(s.journal);
  markDone(s.journal);
  active = undefined;
  const unanswered = Object.values(s.reports).reduce((n, r) => n + (r?.extra.unanswered ?? 0), 0);
  console.info(`[selftest] fim (${s.signal.why ?? "ok"}) em ${elapsed}; restaurado(s) no jogador: ${changed.length ? changed.join(", ") : "nada"}; ${s.failures.length} falha(s)${unanswered ? `; ${unanswered} tela(s) fechada(s) sem resposta do cliente` : ""}`);
  sendReport(s, elapsed);
  await verifyCleanup(s);
}

/** Conta o que sobrou na área (blocos que não são ar e entidades que não são jogadores). */
async function inspectRegion(dimension: Dimension, region: Region): Promise<{ solid: number; kinds: Set<string>; entities: string[] }> {
  let solid = 0;
  const kinds = new Set<string>();
  await job((function* () {
    for (const cell of regionCells(region)) {
      try {
        const block = dimension.getBlock(cell);
        if (block && !block.isAir) { solid++; kinds.add(block.typeId); }
      } catch { }
      yield;
    }
  })());
  let entities: string[] = [];
  try {
    entities = dimension.getEntities({
      location: region.min,
      volume: { x: region.max.x - region.min.x + 1, y: region.max.y - region.min.y + 1, z: region.max.z - region.min.z + 1 },
    }).filter(e => !(e instanceof Player)).map(e => e.typeId);
  } catch { }
  return { solid, kinds, entities };
}

/** Confere (e registra no log) que a área voltou a ser só ar, sem entidades, e o que mudou nas dynamic properties do mundo. */
async function verifyCleanup(s: Session) {
  const { solid, kinds, entities } = await inspectRegion(s.dimension, s.journal.region);
  const now = new Set(world.getDynamicPropertyIds());
  const added = [...now].filter(id => !s.worldIds.has(id));
  const removed = [...s.worldIds].filter(id => !now.has(id));
  const changed = [...now].filter(id => {
    if (!s.worldValues.has(id)) return false;
    try { return JSON.stringify(world.getDynamicProperty(id)) !== s.worldValues.get(id); } catch { return false; }
  });
  const list = (ids: string[]) => ids.length ? ` [${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", ..." : ""}]` : "";
  console.info(`[selftest] verificação: área ${solid} bloco(s) não-ar${kinds.size ? ` (${[...kinds].join(", ")})` : ""}, ${entities.length} entidade(s)${entities.length ? ` (${entities.join(", ")})` : ""}; dynamic properties do mundo +${added.length}${list(added)} -${removed.length}${list(removed)} ~${changed.length}${list(changed)}`);
}

function sendReport(s: Session, elapsed: string) {
  const player = s.player;
  tell(player, tr(s.signal.stopped ? "cobblemon.selftest.interrupted" : "cobblemon.selftest.finished", elapsed, s.mode));
  const r = s.reports;
  if (r.entities) {
    tell(player, tr("cobblemon.selftest.summary.entities", r.entities.extra.pokemon ?? 0, r.entities.extra.species ?? 0, r.entities.extra.other ?? 0, r.entities.extra.thrown ?? 0));
    tell(player, tr("cobblemon.selftest.summary.entities_cover", r.entities.extra.covered ?? 0, r.entities.extra.combos ?? 0));
  }
  if (r.movement) {
    const m = r.movement.extra;
    tell(player, tr("cobblemon.selftest.summary.movement", m.ground ?? 0, m.walked ?? 0, m.water ?? 0, m.swam ?? 0, m.air ?? 0, m.flew ?? 0, m.ridden ?? 0, m.rides ?? 0));
  }
  if (r.blocks) tell(player, tr("cobblemon.selftest.summary.blocks", r.blocks.extra.placed ?? 0, r.blocks.extra.blocks ?? 0));
  if (r.particles) tell(player, tr("cobblemon.selftest.summary.particles", r.particles.done, r.particles.extra.of ?? 0));
  if (r.sounds) tell(player, tr("cobblemon.selftest.summary.sounds", r.sounds.done, r.sounds.extra.of ?? 0));
  if (r.ui) tell(player, tr("cobblemon.selftest.summary.ui", r.ui.done));
  if (r.battle) tell(player, tr("cobblemon.selftest.summary.battle", r.battle.extra.turns ?? 0));
  if (r.screens) {
    tell(player, tr("cobblemon.selftest.summary.screens", r.screens.done, r.screens.total, r.screens.extra.closed ?? 0, r.screens.extra.timeout ?? 0));
    // Ordem das telas, para casar com os prints (Win+Alt+PrtScn numera os arquivos na mesma ordem).
    tell(player, tr("cobblemon.selftest.screens.order"));
    s.screensShown.forEach((key, i) => tell(player, { rawtext: [{ text: `§7${i + 1}. ` }, screenName(key, s.screenNames)] }));
  }
  for (const line of s.extensionSummary) tell(player, line);
  const times = s.plan.map(p => `${p.phase} ${formatDuration(r[p.phase]?.extra.ms ?? 0)}`).join(", ");
  tell(player, { text: `§7${times}` });
  if (s.failures.length) tell(player, tr("cobblemon.selftest.summary.failures", s.failures.length));
  tell(player, tr("cobblemon.selftest.summary.restored"));
  tell(player, tr("cobblemon.selftest.log.header"));
  tell(player, tr("cobblemon.selftest.log.enable"));
  tell(player, tr("cobblemon.selftest.log.windows", "%APPDATA%\\Minecraft Bedrock\\logs", "%LOCALAPPDATA%\\Packages\\Microsoft.MinecraftUWP_8wekyb3d8bbwe\\LocalState\\logs"));
  tell(player, tr("cobblemon.selftest.log.mobile", "games/com.mojang/logs"));
}

// ---------------------------------------------------------------------------------------------
// Recuperação (saída no meio, queda do servidor)

/**
 * Teste pendente do jogador: pelo id e, se não achar, pelo nome (o id do jogador pode mudar de uma sessão para outra,
 * como nos jogadores offline do servidor de teste; o nome é único no servidor).
 */
function pendingOf(player: Player) {
  return pending.get(player.id) ?? [...pending.values()].find(p => p.journal.playerName === player.name);
}

/** Jogador de volta: posição, modo de jogo e dados. */
function restoreReturningPlayer(player: Player) {
  const entry = pendingOf(player);
  if (!entry) return;
  restorePlayerPlace(player, entry.journal);
  try { flushRidingDistance(player); } catch { }
  restorePlayerData(player, entry.snapshot, entry.inventory);
  syncAchievementsCache(player);
  entry.journal.playerRestored = true;
  tell(player, tr("cobblemon.selftest.restored_after_crash"));
  console.info(`[selftest] ${player.name} restaurado depois de um teste interrompido`);
  settle(entry.journal);
}

/** Área limpa e jogador restaurado: apaga o journal; senão grava o progresso. */
function settle(journal: SelfTestJournal) {
  if (journal.regionClean && journal.playerRestored) {
    clearJournal(journal);
    markDone(journal);
    pending.delete(journal.playerId);
  }
  else {
    try { writeJournal(journal); } catch { }
  }
}

let cleaning = false;

/** Áreas de testes interrompidos: limpa quando o chunk estiver carregado. */
async function cleanPendingRegions() {
  if (cleaning || active) return;
  cleaning = true;
  try {
    for (const entry of [...pending.values()]) {
      const journal = entry.journal;
      if (journal.regionClean) continue;
      let dimension: Dimension;
      try { dimension = world.getDimension(journal.dimension); } catch { continue; }
      const { min, max } = journal.region;
      try { if (!dimension.isChunkLoaded(min) || !dimension.isChunkLoaded(max) || !dimension.isChunkLoaded({ x: min.x, y: min.y, z: max.z }) || !dimension.isChunkLoaded({ x: max.x, y: min.y, z: min.z })) continue; }
      catch { continue; }
      sweepEntities(dimension, journal.region);
      await restoreBlocks(dimension, journal.region, undefined, true);
      await waitTicks(3);
      sweepEntities(dimension, journal.region);
      clearWorldKeys(journal.dimension, journal.region);
      journal.regionClean = true;
      const left = await inspectRegion(dimension, journal.region);
      console.info(`[selftest] área de um teste interrompido limpa (${JSON.stringify(journal.region)}); verificação: área ${left.solid} bloco(s) não-ar, ${left.entities.length} entidade(s)`);
      settle(journal);
    }
  }
  finally { cleaning = false; }
}

let started = false;

function startRecovery() {
  if (started) return;
  started = true;
  for (const id of world.getDynamicPropertyIds()) {
    if (!id.startsWith(JOURNAL_PREFIX)) continue;
    const journal = decodeJournal(world.getDynamicProperty(id));
    if (!journal) { try { world.setDynamicProperty(id, undefined); } catch { } continue; }
    pending.set(journal.playerId, { journal, snapshot: readSnapshotFromWorld(journal.playerId, journal.snapshotChunks) });
    console.info(`[selftest] teste interrompido encontrado (${journal.playerName}); restaurando`);
  }
  for (const player of world.getPlayers()) if (pendingOf(player)) restoreReturningPlayer(player);
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try { for (const anchor of world.getDimension(id).getEntities({ type: ANCHOR_TYPE, tags: [ANCHOR_TAG] })) onAnchorLoaded(anchor); } catch { }
  }
  system.runInterval(() => {
    if ([...pending.values()].some(p => !p.journal.regionClean)) void cleanPendingRegions();
  }, 40);
}

// ---------------------------------------------------------------------------------------------
// Comando

function stopSession(player: Player | undefined) {
  if (!active) { tell(player, tr("cobblemon.selftest.not_running")); return; }
  active.signal.stop("stop");
  tell(player, tr("cobblemon.selftest.stopping"));
}

function statusOf(player: Player | undefined) {
  if (!active) { tell(player, tr("cobblemon.selftest.not_running")); return; }
  const s = active;
  tell(player, tr("cobblemon.selftest.status", s.playerName, s.mode, s.phase ? phaseName(s.phase) : "-", s.progress.done, s.progress.total, formatDuration(Date.now() - s.startedAt)));
}

/**
 * Executa um modo para o jogador (comando ou scriptevent).
 * @param seconds Modo `telas`: segundos com cada tela aberta (3..60, padrão 10).
 */
export function runSelfTestCommand(player: Player | undefined, raw: string | undefined, seconds?: number | string) {
  const extensionModes = selfTestExtensions().map(e => e.mode);
  const mode = parseSelfTestMode(raw, extensionModes);
  if (!mode) { tell(player, tr("cobblemon.selftest.usage", [...SELFTEST_MODES, ...extensionModes].join("|"))); return; }
  if (mode === "stop") return stopSession(player);
  if (mode === "status") return statusOf(player);
  if (!player) { console.info("[selftest] só jogadores podem rodar o teste (use o comando no jogo)"); return; }
  const extension = findSelfTestExtension(mode);
  if (extension && !availableExtensions().includes(extension)) {
    tell(player, extension.unavailable ?? tr("cobblemon.selftest.usage", SELFTEST_MODES.join("|")));
    return;
  }
  startSession(player, mode, parseScreenSeconds(seconds)).catch(e => {
    console.info(`[selftest] erro: ${e}`);
    if (active?.player === player) active = undefined;
  });
}

/** Registra `/cobblemon:selftest` (operador + cheats), o `scriptevent cobblemon:selftest` e a recuperação. */
export function registerSelfTestCommand(event: StartupEvent) {
  const registry = event.customCommandRegistry;
  try {
    // Modos das extensões registradas no carregamento do script (antes do startup).
    registry.registerEnum(MODE_ENUM, [...SELFTEST_MODES, ...Object.keys(SELFTEST_MODE_ALIASES), ...selfTestExtensions().map(e => e.mode)]);
    registry.registerCommand({
      name: COMMAND_NAME,
      description: "Exercises the add-on in-world to fill the client ContentLog / Testa o add-on no mundo para gerar o ContentLog (admin).",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
      // `telas <segundos>`: tempo de cada tela (3..60).
      optionalParameters: [{ name: MODE_ENUM, type: CustomCommandParamType.Enum }, { name: "seconds", type: CustomCommandParamType.Integer }],
    }, (origin: CustomCommandOrigin, value?: string, seconds?: number): CustomCommandResult => {
      const source = origin.initiator ?? origin.sourceEntity;
      const player = source instanceof Player ? source : undefined;
      const mode = parseSelfTestMode(value, selfTestExtensions().map(e => e.mode));
      if (!player && origin.sourceType !== CustomCommandSource.Server)
        return { status: CustomCommandStatus.Failure, message: "Only players / Só jogadores" };
      if (!player && mode !== "stop" && mode !== "status")
        return { status: CustomCommandStatus.Failure, message: "Run it in-game: /cobblemon:selftest quick / Rode no jogo" };
      system.run(() => runSelfTestCommand(player, value, seconds));
      return { status: CustomCommandStatus.Success };
    });
  }
  catch (e) { console.warn(`Não foi possível registrar ${COMMAND_NAME}: ${e}`); }
  // scriptevent cobblemon:selftest <modo> [segundos] [jogador]
  system.afterEvents.scriptEventReceive.subscribe(event => {
    if (event.id !== SCRIPT_EVENT_ID) return;
    const [modeText, ...rest] = event.message.trim().split(/\s+/);
    const seconds = rest.length && /^\d+$/.test(rest[0]) ? rest.shift() : undefined;
    let player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    const name = rest.join(" ");
    if (name) player = world.getPlayers({ name })[0] ?? player;
    runSelfTestCommand(player, modeText, seconds);
  });
  world.afterEvents.worldLoad.subscribe(() => startRecovery());
  world.afterEvents.entityLoad.subscribe(({ entity }) => {
    if (entity.typeId !== ANCHOR_TYPE) return;
    system.run(() => { try { if (entity.isValid && entity.hasTag(ANCHOR_TAG)) onAnchorLoaded(entity); } catch { } });
  });
  world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    if (active?.playerId === playerId) active.signal.stop("left");
  });
  world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (!pendingOf(player)) return;
    // Espera o jogador terminar de carregar (tp/câmera logo no spawn podem ser ignorados).
    system.runTimeout(() => { if (player.isValid) restoreReturningPlayer(player); }, 20);
  });
}
