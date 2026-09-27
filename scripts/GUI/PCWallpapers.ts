/**
 * Papéis de parede das caixas do PC (frente extras-final), port de `api/storage/pc/{PCBox,PCStore,
 * UnlockablePCWallpaper}.kt`, `CobblemonUnlockableWallpapers.kt`, `client/render/gui/PCBoxWallpaperRepository.kt`,
 * `net/serverhandling/storage/pc/*Wallpaper*Handler.kt`, dos comandos `/changewallpaper` e `/unlockpcboxwallpaper` e
 * dos callbacks `player_tick_pre/wallpaper_unlocks.molang` e `pokemon_captured/wallpaper_unlocks.molang`.
 *
 * - Disponíveis: os papéis de parede do resource pack (`textures/gui/pc/wallpaper/**`, sem `alt/` e `glow/`) menos
 *   os desbloqueáveis ainda trancados, mais os desbloqueáveis que o jogador já liberou (PCBoxWallpapersHandler).
 * - Desbloqueáveis (`data/cobblemon/unlockable_pc_box_wallpapers`, 6): biomas caverna/floresta/oceano/Nether/End
 *   (conferidos 1×/s como no callback) e Alfa (ao capturar um Alfa).
 * - Por caixa guarda-se a textura escolhida (a "alt" com a opção alternativa, como o Shift do Cobblemon).
 *
 * Guardado no jogador: `cobblemon:pcwp:<caixa>` (textura curta) e `cobblemon:pcwp_state` (JSON com desbloqueados e
 * não vistos). A imagem aparece atrás da grade do PC pelo `ui/pc.json` (corpo do formulário = caminho da textura).
 */
import {
  CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, CustomCommandResult, CustomCommandStatus, Player,
  RawMessage, StartupEvent, system, world,
} from "@minecraft/server";
import { BIOME_TAGS } from "../../generated/scripts/biomeTags";
import { getBoxCount } from "../pokemonStorage";

/** Quem guarda os dados (Player no jogo; objeto simples nos testes). */
export interface WallpaperHolder {
  readonly id: string;
  getDynamicProperty(identifier: string): unknown;
  setDynamicProperty(identifier: string, value?: string | number | boolean): void;
}

/** UnlockablePCWallpaper. */
export interface UnlockableWallpaper {
  /** Id do dado ("cobblemon:biome_cave"). */
  id: string;
  /** Textura no formato do Cobblemon ("cobblemon:textures/gui/pc/wallpaper/biome/wallpaper_biome_cave.png"). */
  texture: string;
  /** Chave de tradução do nome (as do Java viram chaves do port). */
  displayName?: string;
  enabled: boolean;
}

const WALLPAPER_ROOT = "cobblemon:textures/gui/pc/wallpaper/";

/** PCBox.wallpaper padrão: a moldura do PC, sem papel de parede. */
export const DEFAULT_WALLPAPER = "cobblemon:textures/gui/pc/pc_screen_overlay.png";

/** Papéis de parede do resource pack do Cobblemon 1.8.2 (todos têm versão `alt/` e `glow/`). */
export const RESOURCE_WALLPAPERS: string[] = [
  ...Array.from({ length: 11 }, (_, i) => `${WALLPAPER_ROOT}basic/wallpaper_basic_${String(i + 1).padStart(2, "0")}.png`),
  ...["cave", "forest", "nether", "ocean", "the_end"].map(biome => `${WALLPAPER_ROOT}biome/wallpaper_biome_${biome}.png`),
  `${WALLPAPER_ROOT}misc/wallpaper_pokemon_alpha.png`,
];

/**
 * `data/cobblemon/unlockable_pc_box_wallpapers` (1.8.2). Os `displayName` do Java (`generator.single_biome_caves`,
 * `biome.minecraft.forest`...) não existem no Bedrock: viram `cobblemon.port.wallpaper.<nome>`.
 */
const DEFAULT_UNLOCKABLES: UnlockableWallpaper[] = [
  { id: "cobblemon:biome_cave", texture: `${WALLPAPER_ROOT}biome/wallpaper_biome_cave.png`, displayName: "cobblemon.port.wallpaper.biome_cave", enabled: true },
  { id: "cobblemon:biome_forest", texture: `${WALLPAPER_ROOT}biome/wallpaper_biome_forest.png`, displayName: "cobblemon.port.wallpaper.biome_forest", enabled: true },
  { id: "cobblemon:biome_nether", texture: `${WALLPAPER_ROOT}biome/wallpaper_biome_nether.png`, displayName: "cobblemon.port.wallpaper.biome_nether", enabled: true },
  { id: "cobblemon:biome_ocean", texture: `${WALLPAPER_ROOT}biome/wallpaper_biome_ocean.png`, displayName: "cobblemon.port.wallpaper.biome_ocean", enabled: true },
  { id: "cobblemon:biome_the_end", texture: `${WALLPAPER_ROOT}biome/wallpaper_biome_the_end.png`, displayName: "cobblemon.port.wallpaper.biome_the_end", enabled: true },
  { id: "cobblemon:pokemon_alpha", texture: `${WALLPAPER_ROOT}misc/wallpaper_pokemon_alpha.png`, displayName: "cobblemon.ui.pokemon.alpha", enabled: true },
];

let unlockables = new Map<string, UnlockableWallpaper>(DEFAULT_UNLOCKABLES.map(x => [x.id, x]));

/** CobblemonUnlockableWallpapers.reload: troca a lista (dados gerados pelo importador, se um dia existirem). */
export function setUnlockableWallpapers(list: UnlockableWallpaper[]) {
  unlockables = new Map(list.map(x => [withNamespace(x.id), { ...x, id: withNamespace(x.id), texture: withNamespace(x.texture) }]));
}

export function getUnlockableWallpapers(): UnlockableWallpaper[] {
  return [...unlockables.values()];
}

function withNamespace(id: string): string {
  return id.includes(":") ? id : `cobblemon:${id}`;
}

// ---------------------------------------------------------------------------------------------
// Texturas

/** Versão alternativa (`.../alt/<arquivo>`) de um papel de parede do pack; undefined se já for alt ou não for do pack. */
export function altTexture(texture: string): string | undefined {
  if (!texture.startsWith(WALLPAPER_ROOT) || /\/(alt|glow)\/[^/]+$/.test(texture)) return undefined;
  const slash = texture.lastIndexOf("/");
  return `${texture.slice(0, slash)}/alt${texture.slice(slash)}`;
}

/** Textura base (sem `alt/`). */
export function baseTexture(texture: string): string {
  return texture.replace(/\/alt\/([^/]+)$/, "/$1");
}

/** Caminho da textura no resource pack do Bedrock ("textures/gui/pc/wallpaper/basic/wallpaper_basic_01"). */
export function bedrockTexturePath(texture: string): string {
  return texture.replace(/^[a-z0-9_.-]+:/, "").replace(/\.png$/, "");
}

/** Forma curta guardada ("basic/wallpaper_basic_01"); o que não for do pack fica inteiro. */
export function shortTexture(texture: string): string {
  return texture.startsWith(WALLPAPER_ROOT) && texture.endsWith(".png") ? texture.slice(WALLPAPER_ROOT.length, -4) : texture;
}

export function expandTexture(value: string): string {
  if (value.includes(":")) return value;
  if (value.startsWith("textures/")) return `cobblemon:${value.endsWith(".png") ? value : `${value}.png`}`;
  return `${WALLPAPER_ROOT}${value}.png`;
}

/** Nome exibido: o do desbloqueável ou "Basic 01"/"Biome Forest" a partir do arquivo. */
export function wallpaperName(texture: string): RawMessage {
  const base = baseTexture(texture);
  const unlockable = [...unlockables.values()].find(x => x.texture === base);
  if (unlockable?.displayName) return { translate: unlockable.displayName };
  const file = base.slice(base.lastIndexOf("/") + 1).replace(/\.png$/, "").replace(/^wallpaper_/, "");
  return { text: file.split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") };
}

// ---------------------------------------------------------------------------------------------
// Estado por jogador

export const WALLPAPER_STATE_PROPERTY = "cobblemon:pcwp_state";
export const BOX_WALLPAPER_PREFIX = "cobblemon:pcwp:";

interface WallpaperState {
  /** unlockedWallpapers (ids) */
  u: string[];
  /** unseenWallpapers (texturas) */
  n: string[];
}

function readState(holder: WallpaperHolder): WallpaperState {
  const raw = holder.getDynamicProperty(WALLPAPER_STATE_PROPERTY);
  if (typeof raw === "string") {
    try {
      const json = JSON.parse(raw);
      const list = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
      return { u: list(json?.u), n: list(json?.n) };
    }
    catch { }
  }
  return { u: [], n: [] };
}

function writeState(holder: WallpaperHolder, state: WallpaperState) {
  holder.setDynamicProperty(WALLPAPER_STATE_PROPERTY, JSON.stringify(state));
}

export function getUnlockedWallpapers(holder: WallpaperHolder): string[] {
  return readState(holder).u;
}

export function hasUnlockedWallpaper(holder: WallpaperHolder, id: string): boolean {
  return readState(holder).u.includes(withNamespace(id));
}

/** Texturas desbloqueadas e ainda não vistas na lista ("NOVO"). */
export function getUnseenWallpapers(holder: WallpaperHolder): string[] {
  return readState(holder).n;
}

/** PCStore.markWallpapersSeen. */
export function markWallpapersSeen(holder: WallpaperHolder, textures: readonly string[]) {
  const state = readState(holder);
  const remaining = state.n.filter(texture => !textures.includes(texture));
  if (remaining.length === state.n.length) return;
  state.n = remaining;
  writeState(holder, state);
}

/**
 * PCBoxWallpapersHandler: papéis de parede do pack menos os desbloqueáveis trancados (ou desativados), mais os
 * desbloqueáveis liberados. Ordem do pack.
 */
export function getAvailableWallpapers(holder: WallpaperHolder): string[] {
  const unlocked = new Set(readState(holder).u);
  const open: string[] = [], locked: string[] = [];
  for (const wallpaper of unlockables.values())
    (wallpaper.enabled && unlocked.has(wallpaper.id) ? open : locked).push(wallpaper.texture);
  const result = RESOURCE_WALLPAPERS.filter(texture => !locked.includes(texture));
  for (const texture of open) if (!result.includes(texture)) result.push(texture);
  return result;
}

/** A textura (ou a alt dela) pode ser usada pelo jogador. */
export function canUseWallpaper(holder: WallpaperHolder, texture: string): boolean {
  if (texture === DEFAULT_WALLPAPER) return true;
  return getAvailableWallpapers(holder).includes(baseTexture(texture));
}

/** PCBox.wallpaper. */
export function getBoxWallpaper(holder: WallpaperHolder, boxID: number): string {
  const raw = holder.getDynamicProperty(`${BOX_WALLPAPER_PREFIX}${boxID}`);
  return typeof raw === "string" && raw ? expandTexture(raw) : DEFAULT_WALLPAPER;
}

/**
 * RequestChangePCBoxWallpaperHandler: troca o papel de parede da caixa se o jogador puder usar a textura.
 * @param alt usa a versão alternativa (Shift no Cobblemon), se existir.
 * @returns verdadeiro se mudou.
 */
export function setBoxWallpaper(holder: WallpaperHolder, boxID: number, texture: string, alt = false): boolean {
  if (!Number.isInteger(boxID) || boxID < 0) return false;
  if (!canUseWallpaper(holder, texture)) return false;
  const applied = alt ? altTexture(texture) ?? texture : texture;
  holder.setDynamicProperty(`${BOX_WALLPAPER_PREFIX}${boxID}`, applied === DEFAULT_WALLPAPER ? undefined : shortTexture(applied));
  markWallpapersSeen(holder, [baseTexture(texture)]);
  return true;
}

/**
 * Papel de parede que o cliente do Java desenha na caixa sem escolha (PCBoxWallpaperRepository.defaultWallpaper): o
 * PCBox guarda `pc_screen_overlay.png`, que não está na lista, e o StorageWidget cai no `wallpaper_basic_05` (com a glow).
 */
export const JAVA_DEFAULT_WALLPAPER = `${WALLPAPER_ROOT}basic/wallpaper_basic_05.png`;

/** Caminho do resource pack para o corpo do formulário do PC (a caixa sem escolha mostra o padrão do Java). */
export function boxWallpaperTexturePath(holder: WallpaperHolder, boxID: number): string {
  const texture = getBoxWallpaper(holder, boxID);
  return bedrockTexturePath(texture === DEFAULT_WALLPAPER ? JAVA_DEFAULT_WALLPAPER : texture);
}

/** Aviso de desbloqueio (o toast do Cobblemon vira título na actionbar + chat). */
export type WallpaperNotifier = (holder: WallpaperHolder, wallpaper: UnlockableWallpaper) => void;

const defaultNotifier: WallpaperNotifier = (holder, wallpaper) => {
  if (!(holder instanceof Player) || !holder.isValid) return;
  const name: RawMessage = wallpaper.displayName
    ? { rawtext: [{ text: "\"" }, { translate: wallpaper.displayName }, { text: "\"" }] }
    : { translate: "cobblemon.unknown_wallpaper" };
  const message: RawMessage = { rawtext: [{ text: "§e" }, { translate: "cobblemon.wallpaper_unlocked" }, { text: "§r: " }, name] };
  try {
    holder.sendMessage(message);
    holder.onScreenDisplay.setActionBar(message);
    holder.playSound("cobblemon.pc.wallpaper.unlock");
  }
  catch { }
};

let notifier: WallpaperNotifier = defaultNotifier;

/** Troca o aviso (testes). */
export function setWallpaperNotifier(value: WallpaperNotifier | undefined) {
  notifier = value ?? defaultNotifier;
}

/**
 * PCStore.unlockWallpaper: libera um desbloqueável ativo; na primeira vez marca como não visto e avisa
 * (toast + som `cobblemon.pc.wallpaper.unlock`) se `notify`.
 * @returns verdadeiro se foi liberado agora.
 */
export function unlockWallpaper(holder: WallpaperHolder, id: string, notify = true): boolean {
  const wallpaper = unlockables.get(withNamespace(id));
  if (!wallpaper || !wallpaper.enabled) return false;
  const state = readState(holder);
  if (state.u.includes(wallpaper.id)) return false;
  state.u.push(wallpaper.id);
  if (!state.n.includes(wallpaper.texture)) state.n.push(wallpaper.texture);
  writeState(holder, state);
  if (notify) notifier(holder, wallpaper);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Callbacks (wallpaper_unlocks.molang)

/** Tags de bioma do callback de tick (as do Nether/End também valem pela dimensão). */
const BIOME_UNLOCKS: { id: string; tag: string; dimension?: string }[] = [
  { id: "cobblemon:biome_cave", tag: "cobblemon:is_cave" },
  { id: "cobblemon:biome_forest", tag: "cobblemon:is_forest" },
  { id: "cobblemon:biome_ocean", tag: "cobblemon:is_ocean" },
  { id: "cobblemon:biome_nether", tag: "minecraft:is_nether", dimension: "minecraft:nether" },
  { id: "cobblemon:biome_the_end", tag: "cobblemon:is_end", dimension: "minecraft:the_end" },
];

/** Biomas do Bedrock da tag vanilla `minecraft:is_nether` (o importador não gera tags vanilla). */
const NETHER_BIOMES = ["hell", "nether_wastes", "crimson_forest", "warped_forest", "soulsand_valley", "soul_sand_valley", "basalt_deltas"];

function biomesOf(tag: string): string[] {
  if (tag === "minecraft:is_nether") return NETHER_BIOMES;
  return BIOME_TAGS[tag] ?? [];
}

/** Desbloqueáveis que um jogador neste bioma/dimensão liberaria (player_tick_pre/wallpaper_unlocks.molang). */
export function biomeWallpaperUnlocks(biomeId: string, dimensionId: string): string[] {
  const plain = biomeId.replace(/^minecraft:/, "");
  return BIOME_UNLOCKS
    .filter(rule => biomesOf(rule.tag).includes(plain) || (rule.dimension !== undefined && rule.dimension === dimensionId))
    .map(rule => rule.id);
}

/** pokemon_captured/wallpaper_unlocks.molang: capturar um Alfa libera o papel de parede Alfa. */
export function onPokemonCapturedWallpapers(holder: WallpaperHolder, aspects: readonly string[]) {
  if (aspects.includes("alpha")) unlockWallpaper(holder, "cobblemon:pokemon_alpha", true);
}

/** Um jogador por tick, 1×/s cada (o callback do Cobblemon só roda quando game_time % 20 == 0). */
function* biomeCheckJob(): Generator<void, void, void> {
  for (const player of world.getAllPlayers()) {
    try {
      if (!player.isValid) continue;
      const unlocked = new Set(getUnlockedWallpapers(player));
      if (BIOME_UNLOCKS.every(rule => unlocked.has(rule.id))) continue;
      const biome = player.dimension.getBiome(player.location).id;
      for (const id of biomeWallpaperUnlocks(biome, player.dimension.id))
        if (!unlocked.has(id)) unlockWallpaper(player, id, true);
    }
    catch { }
    yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Comandos

export const ENUM_WALLPAPER = "cobblemon:unlockablewallpaper";

function reply(origin: CustomCommandOrigin, text: string) {
  const source = origin.sourceEntity;
  if (source instanceof Player) source.sendMessage(text);
  else console.info(text);
}

/** `/cobblemon:unlockpcboxwallpaper <jogador> <papel> [tocarSom]` (UnlockPCBoxWallpaperCommand). */
function runUnlock(origin: CustomCommandOrigin, players: Player[] | undefined, wallpaper: string, playsSound?: boolean): CustomCommandResult {
  const targets = (players ?? []).filter(p => p.isValid);
  if (targets.length === 0) return { status: CustomCommandStatus.Failure, message: "No players found" };
  const id = withNamespace(wallpaper);
  if (!unlockables.has(id)) return { status: CustomCommandStatus.Failure, message: `Invalid wallpaper identifier ${wallpaper}` };
  system.run(() => {
    for (const player of targets) {
      if (unlockWallpaper(player, id, playsSound ?? true)) reply(origin, `${player.name} can now use the ${id} wallpaper.`);
      else reply(origin, `${player.name} already has the ${id} wallpaper.`);
    }
  });
  return { status: CustomCommandStatus.Success };
}

/** `/cobblemon:changewallpaper <jogador> <caixa> <textura>` (ChangeBoxWallpaperCommand; caixa começa em 1). */
function runChange(players: Player[] | undefined, box: number, wallpaper: string): CustomCommandResult {
  const targets = (players ?? []).filter(p => p.isValid);
  if (targets.length === 0) return { status: CustomCommandStatus.Failure, message: "No players found" };
  const texture = expandTexture(wallpaper.trim());
  system.run(() => {
    for (const player of targets) {
      if (box < 1 || box > getBoxCount(player)) { player.sendMessage(`§cBox ${box} does not exist.`); continue; }
      if (!setBoxWallpaper(player, box - 1, texture)) player.sendMessage(`§cWallpaper ${wallpaper} does not exist.`);
    }
  });
  return { status: CustomCommandStatus.Success };
}

export function registerWallpaperCommands(event: StartupEvent) {
  try {
    event.customCommandRegistry.registerEnum(ENUM_WALLPAPER, [...unlockables.keys()].flatMap(id => [id, id.replace(/^cobblemon:/, "")]));
    event.customCommandRegistry.registerCommand({
      name: "cobblemon:unlockpcboxwallpaper",
      description: "Unlocks a PC box wallpaper / Libera um papel de parede do PC.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: ENUM_WALLPAPER, type: CustomCommandParamType.Enum },
      ],
      optionalParameters: [{ name: "playsSound", type: CustomCommandParamType.Boolean }],
    }, (origin, players: Player[], wallpaper: string, playsSound?: boolean) => runUnlock(origin, players, wallpaper, playsSound));
    event.customCommandRegistry.registerCommand({
      name: "cobblemon:changewallpaper",
      description: "Changes a PC box wallpaper / Troca o papel de parede de uma caixa do PC.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: "player", type: CustomCommandParamType.PlayerSelector },
        { name: "box", type: CustomCommandParamType.Integer },
        { name: "wallpaper", type: CustomCommandParamType.String },
      ],
    }, (_origin, players: Player[], box: number, wallpaper: string) => runChange(players, box, wallpaper));
  }
  catch (e) {
    console.warn(`Não foi possível registrar os comandos de papel de parede: ${e}`);
  }
}

let bound = false;

/** Liga os comandos e a verificação de bioma. Idempotente (chamado por bindCatchEvents). */
export function bindPCWallpapers() {
  if (bound) return;
  bound = true;
  try { system.beforeEvents.startup.subscribe(event => registerWallpaperCommands(event)); }
  catch (e) { console.warn(`Não foi possível agendar os comandos de papel de parede: ${e}`); }
  try { system.runInterval(() => { system.runJob(biomeCheckJob()); }, 20); }
  catch (e) { console.warn(`Não foi possível ligar os desbloqueios de papel de parede por bioma: ${e}`); }
}
