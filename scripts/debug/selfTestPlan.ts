/**
 * /cobblemon:selftest — lógica pura (sem API do Minecraft): modos, fases, listas de alvos, lotes, grade, parada,
 * journal de recuperação e diferença de dynamic properties. O runtime está em `SelfTest.ts`; os testes em
 * `tests/selftest.test.ts`.
 */

/** Modos aceitos pelo comando (`status` e `stop` não rodam fases). */
export const SELFTEST_MODES = ["quick", "full", "ui", "entities", "movement", "blocks", "particles", "sounds", "battle", "telas", "stop", "status"] as const;
export type BaseSelfTestMode = (typeof SELFTEST_MODES)[number];
/** Um modo do autoteste ou o de uma extensão registrada (scripts/debug/selfTestExtensions.ts). */
export type SelfTestMode = BaseSelfTestMode | (string & {});
/** Outros nomes aceitos (também vão para o enum do comando). */
export const SELFTEST_MODE_ALIASES: Readonly<Record<string, SelfTestMode>> = { screens: "telas" };

/** Fases automáticas (as do quick/full, nesta ordem). */
export const SELFTEST_PHASES = ["entities", "movement", "blocks", "particles", "sounds", "ui", "battle"] as const;
/**
 * Todas as fases: as automáticas + `screens` (roteiro de telas para prints, só no modo `telas`) + as de extensões
 * (a fase de uma extensão tem o nome do modo dela).
 */
export type SelfTestPhase = (typeof SELFTEST_PHASES)[number] | "screens" | (string & {});

/** `sample` = amostra representativa (quick); `all` = tudo. */
export type Coverage = "sample" | "all";

export interface PhasePlan {
  phase: SelfTestPhase;
  coverage: Coverage;
}

/**
 * Modo digitado (maiúsculas/espaços ignorados; vazio = quick) ou undefined se não existe. `extensionModes`: modos das
 * extensões registradas (valem como os do autoteste).
 */
export function parseSelfTestMode(raw: string | undefined, extensionModes: readonly string[] = []): SelfTestMode | undefined {
  const value = (raw ?? "").trim().toLowerCase() || "quick";
  if (SELFTEST_MODE_ALIASES[value]) return SELFTEST_MODE_ALIASES[value];
  if ((SELFTEST_MODES as readonly string[]).includes(value)) return value as SelfTestMode;
  return extensionModes.includes(value) ? value : undefined;
}

/** O que o plano precisa saber de uma extensão ligada neste mundo. */
export interface ExtensionPlanInfo {
  mode: string;
  inFull: boolean;
}

/**
 * Fases de um modo, na ordem de execução. `extensions`: extensões LIGADAS neste mundo; as com `inFull` entram no fim
 * do `full` (cobertura completa); o modo de uma extensão roda só a fase dela.
 */
export function planFor(mode: SelfTestMode, extensions: readonly ExtensionPlanInfo[] = []): PhasePlan[] {
  switch (mode) {
    case "quick": return SELFTEST_PHASES.map(phase => ({ phase, coverage: "sample" as const }));
    case "full": return [
      ...SELFTEST_PHASES.map(phase => ({ phase, coverage: "all" as const })),
      ...extensions.filter(e => e.inFull).map(e => ({ phase: e.mode, coverage: "all" as const })),
    ];
    case "stop": case "status": return [];
    case "telas": return [{ phase: "screens", coverage: "all" }];
    default: return [{ phase: mode, coverage: "all" }];
  }
}

/**
 * Casos que já apareceram no ContentLog do cliente (sempre entram na amostra, com todas as variantes).
 * `exeggutor_alolan`, `dugtrio_alolan` e `ninetales_alola` são as variantes alolanas das espécies abaixo.
 */
export const KNOWN_PROBLEM_SPECIES = [
  "torchic", "altaria", "zubat", "skarmory", "porygonz", "exeggutor", "dugtrio", "ninetales", "flabebe", "unown",
  "furret", "blaziken", "frillish",
  // Beta 5/6: texturas piscando no cliente (camadas, faces de trás, faces encostadas) e montarias.
  "eternatus", "chandelure", "mamoswine", "arbok", "slowpoke", "slowbro", "slowking", "raichu", "furfrou", "torterra",
  "hatterene", "goldeen", "tyrantrum", "garchomp", "drampa", "lapras", "charizard", "flygon", "joltik",
] as const;

/** Um Pokémon a exibir: espécie e índice da combinação renderizável (`cobblemon:variant`). */
export interface PokemonTarget {
  species: string;
  variant: number;
}

/**
 * Alvos de Pokémon. `all`: todas as combinações de todas as espécies (inclui shiny, formas regionais, gênero, Alfa).
 * `sample`: a combinação 0 de cada espécie base (sem pré-evolução = 1 por família) + todas as combinações dos casos
 * conhecidos. Sem repetição; na ordem das espécies.
 */
export function pokemonTargets(
  combos: Record<string, number>, coverage: Coverage, isFamilyBase: (species: string) => boolean,
  known: readonly string[] = KNOWN_PROBLEM_SPECIES,
  /** Combinações a mostrar por espécie (a cobertura de `coverCombos`); sem ela, todas. */
  cover?: (species: string) => readonly number[] | undefined,
): PokemonTarget[] {
  const out: PokemonTarget[] = [];
  const knownSet = new Set(known);
  for (const [species, count] of Object.entries(combos)) {
    const total = Math.max(1, count);
    if (coverage === "all" || knownSet.has(species)) {
      const picked = cover?.(species);
      if (picked?.length) { for (const variant of picked) if (variant >= 0 && variant < total) out.push({ species, variant }); }
      else for (let variant = 0; variant < total; variant++) out.push({ species, variant });
    }
    else if (isFamilyBase(species)) out.push({ species, variant: 0 });
  }
  return out;
}

/** Combinação renderizável (a forma de `VariantCombo` de generated/scripts/variants.ts). */
export interface ComboResources {
  poser?: string;
  model: string;
  texture: string;
  layers: readonly string[];
}

/**
 * Recursos que o cliente carrega para uma combinação: modelo (geometria), textura base, poser (animações), cada camada
 * (`nome=textura`) e o conjunto de nomes de camada (decide o render controller das camadas). Cada recurso distinto
 * precisa aparecer ao menos uma vez para o ContentLog acusá-lo.
 */
export function comboFeatures(combo: ComboResources): string[] {
  const out = [`model:${combo.model}`, `texture:${combo.texture}`, `poser:${combo.poser ?? ""}`];
  for (const layer of combo.layers) out.push(`layer:${layer}`);
  out.push(`layers:${combo.layers.map(layer => layer.split("=")[0]).sort().join(",")}`);
  return out;
}

/**
 * Cobertura mínima (gulosa) das combinações de uma espécie: começa pela 0 (a padrão) e, enquanto sobrar recurso sem
 * aparecer, pega a combinação que mostra mais recursos novos (empate: o menor índice). Devolve os índices em ordem.
 * Todo recurso de `comboFeatures` de todas as combinações fica coberto (ex.: Spinda: 1534 combinações → 50).
 */
export function coverCombos(combos: readonly ComboResources[]): number[] {
  if (combos.length <= 1) return combos.length ? [0] : [];
  // Recursos como inteiros (o laço guloso só compara números).
  const ids = new Map<string, number>();
  const sets = combos.map(combo => [...new Set(comboFeatures(combo).map(f => {
    let id = ids.get(f);
    if (id === undefined) ids.set(f, id = ids.size);
    return id;
  }))]);
  const covered = new Uint8Array(ids.size);
  let left = ids.size;
  const picked: number[] = [];
  const take = (index: number) => {
    picked.push(index);
    for (const id of sets[index]) if (!covered[id]) { covered[id] = 1; left--; }
  };
  take(0);
  while (left > 0) {
    let best = -1;
    let gain = 0;
    for (let i = 0; i < sets.length; i++) {
      let g = 0;
      for (const id of sets[i]) if (!covered[id]) g++;
      if (g > gain) { gain = g; best = i; }
    }
    if (best < 0) break;
    take(best);
  }
  return picked.sort((a, b) => a - b);
}

/** Permutação de bloco: estados que mudam em relação ao padrão (vazio = permutação padrão). */
export interface BlockTarget {
  id: string;
  states: Record<string, string | number | boolean>;
}

/** Estados de crescimento (a amostra mostra todos os estágios de berries, apricorns e mentas). */
export const GROWTH_STATES = ["cobblemon:age", "cobblemon:growth_state", "cobblemon:stage"];

/**
 * Permutações a colocar: a padrão de cada bloco e, para cada estado, cada valor que não é o padrão (um estado por vez;
 * o produto cartesiano explodiria). `sample` só varia os estados de crescimento.
 */
export function blockTargets(blocks: readonly { id: string; states: Record<string, readonly (string | number | boolean)[]> }[], coverage: Coverage): BlockTarget[] {
  const out: BlockTarget[] = [];
  for (const block of blocks) {
    out.push({ id: block.id, states: {} });
    for (const [state, values] of Object.entries(block.states)) {
      if (coverage === "sample" && !GROWTH_STATES.includes(state)) continue;
      for (const value of values.slice(1)) out.push({ id: block.id, states: { [state]: value } });
    }
  }
  return out;
}

/** Amostra espaçada de no máximo `max` itens (mantém o primeiro e o último). */
export function sampleEvenly<T>(items: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return [...items];
  if (max === 1) return [items[0]];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/**
 * Amostra de sons: a primeira variante de cada grupo (tudo menos o último segmento do nome, ex. todos os gritos
 * `cobblemon.pokemon.<espécie>.cry` contam como um grupo) mais uma amostra espaçada, até `max`.
 */
export function sampleSounds(sounds: readonly string[], max: number): string[] {
  const groups = new Map<string, string>();
  for (const sound of sounds) {
    const key = sound.includes(".") ? sound.slice(0, sound.lastIndexOf(".")).replace(/\.[^.]+$/, "") : sound;
    if (!groups.has(key)) groups.set(key, sound);
  }
  const picked = new Set(sampleEvenly([...groups.values()], max));
  for (const sound of sampleEvenly(sounds, max)) {
    if (picked.size >= max) break;
    picked.add(sound);
  }
  return [...picked];
}

/** Divide em lotes de `size` (último lote menor). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Deslocamentos (x, z) de uma grade de `count` células com `columns` colunas, centrada em x = 0, a partir de z = 0. */
export function gridOffsets(count: number, columns: number, spacing: number): { dx: number; dz: number }[] {
  const cols = Math.max(1, Math.min(columns, count));
  const out: { dx: number; dz: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ dx: (col - (cols - 1) / 2) * spacing, dz: row * spacing });
  }
  return out;
}

/** Duração legível: "45 s", "3 min 05 s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, "0")} s` : `${seconds} s`;
}

// ---------------------------------------------------------------------------------------------
// Lotes com parada

/** Controle de parada: `stop()` pede; os laços conferem `stopped` entre um passo e outro. */
export class StopSignal {
  private reason?: string;
  get stopped(): boolean { return this.reason !== undefined; }
  get why(): string | undefined { return this.reason; }
  stop(reason = "stop") {
    if (this.reason === undefined) this.reason = reason;
  }
}

export interface BatchRunResult {
  /** Itens entregues ao `handler` (lotes inteiros). */
  processed: number;
  batches: number;
  stopped: boolean;
}

/**
 * Processa `items` em lotes: `handler(lote, índice)` para cada lote e `pause()` entre um lote e outro (o runtime espera
 * ticks ali). Confere a parada antes de cada lote e depois de cada pausa; `onProgress(feitos, total)` a cada lote.
 */
export async function runInBatches<T>(
  items: readonly T[], size: number, signal: StopSignal,
  handler: (batch: T[], index: number) => void | Promise<void>,
  pause: () => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchRunResult> {
  const batches = chunk(items, size);
  let processed = 0;
  let count = 0;
  for (const [index, batch] of batches.entries()) {
    if (signal.stopped) return { processed, batches: count, stopped: true };
    await handler(batch, index);
    processed += batch.length;
    count++;
    onProgress?.(processed, items.length);
    await pause();
  }
  return { processed, batches: count, stopped: signal.stopped };
}

// ---------------------------------------------------------------------------------------------
// Restauração

/** Coordenada inteira de bloco. */
export interface BlockPos { x: number; y: number; z: number }

const posKey = (p: BlockPos) => `${p.x},${p.y},${p.z}`;

/**
 * Registro das mudanças de bloco: guarda o estado ORIGINAL da primeira vez que cada posição muda (as seguintes não
 * sobrescrevem) e devolve a ordem de restauração (inversa: o que foi mudado por último volta primeiro).
 */
export class BlockChangeLog<T> {
  private readonly originals = new Map<string, { pos: BlockPos; original: T }>();
  record(pos: BlockPos, original: T): boolean {
    const key = posKey(pos);
    if (this.originals.has(key)) return false;
    this.originals.set(key, { pos: { x: pos.x, y: pos.y, z: pos.z }, original });
    return true;
  }
  has(pos: BlockPos): boolean { return this.originals.has(posKey(pos)); }
  get size(): number { return this.originals.size; }
  /** Ordem de restauração (última mudança primeiro). */
  restoreOrder(): { pos: BlockPos; original: T }[] { return [...this.originals.values()].reverse(); }
  forget(pos: BlockPos) { this.originals.delete(posKey(pos)); }
}

/** Caixa de blocos (inclusiva). */
export interface Region { min: BlockPos; max: BlockPos }

export function regionContains(region: Region, p: { x: number; y: number; z: number }): boolean {
  return p.x >= region.min.x && p.x < region.max.x + 1 && p.y >= region.min.y && p.y < region.max.y + 1 && p.z >= region.min.z && p.z < region.max.z + 1;
}

/** Posições da caixa, camada por camada (y, depois z, depois x). */
export function* regionCells(region: Region): Generator<BlockPos> {
  for (let y = region.min.y; y <= region.max.y; y++)
    for (let z = region.min.z; z <= region.max.z; z++)
      for (let x = region.min.x; x <= region.max.x; x++) yield { x, y, z };
}

export type DynamicValue = string | number | boolean | { x: number; y: number; z: number };

/**
 * O que restaurar nas dynamic properties do jogador: chaves que mudaram voltam ao valor antigo e chaves criadas
 * durante o teste somem. Compara por valor (Vector3 por coordenadas).
 */
export function diffDynamicProperties(before: ReadonlyMap<string, DynamicValue>, after: ReadonlyMap<string, DynamicValue>): { restore: [string, DynamicValue][]; remove: string[] } {
  const same = (a: DynamicValue | undefined, b: DynamicValue | undefined) =>
    typeof a === "object" && typeof b === "object" ? a.x === b.x && a.y === b.y && a.z === b.z : a === b;
  const restore: [string, DynamicValue][] = [];
  const remove: string[] = [];
  for (const [key, value] of before) if (!same(value, after.get(key))) restore.push([key, value]);
  for (const key of after.keys()) if (!before.has(key)) remove.push(key);
  return { restore, remove };
}

/** Divide um texto em pedaços de no máximo `size` caracteres (dynamic property de string tem limite). */
export function splitChunks(text: string, size = 30000): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

/** Snapshot serializado (lista de pares) ↔ Map. */
export function encodeSnapshot(snapshot: ReadonlyMap<string, DynamicValue>): string {
  return JSON.stringify([...snapshot]);
}

export function decodeSnapshot(text: string): Map<string, DynamicValue> | undefined {
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return undefined;
    const out = new Map<string, DynamicValue>();
    for (const entry of list) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return undefined;
      const value = entry[1];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out.set(entry[0], value);
      else if (value && typeof value === "object" && ["x", "y", "z"].every(k => typeof value[k] === "number")) out.set(entry[0], { x: value.x, y: value.y, z: value.z });
    }
    return out;
  }
  catch { return undefined; }
}

/**
 * Journal gravado no mundo ANTES de mexer em qualquer coisa: se o servidor cair ou o jogador sair no meio, o que foi
 * mudado é desfeito no próximo carregamento (área) e na próxima entrada do jogador (posição, modo de jogo, dados).
 */
export interface SelfTestJournal {
  v: 1;
  playerId: string;
  playerName: string;
  dimension: string;
  origin: { x: number; y: number; z: number };
  rotation: { x: number; y: number };
  gameMode: string;
  region: Region;
  /** Pedaços do snapshot das dynamic properties do jogador. */
  snapshotChunks: number;
  /** A área já foi limpa. */
  regionClean?: boolean;
  /** O jogador já voltou ao lugar e aos dados de antes. */
  playerRestored?: boolean;
  started: number;
}

const isPos = (p: unknown): p is BlockPos => !!p && typeof p === "object" && ["x", "y", "z"].every(k => typeof (p as Record<string, unknown>)[k] === "number");

export function encodeJournal(journal: SelfTestJournal): string {
  return JSON.stringify(journal);
}

export function decodeJournal(raw: unknown): SelfTestJournal | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const j = JSON.parse(raw);
    if (j?.v !== 1 || typeof j.playerId !== "string" || typeof j.dimension !== "string" || !isPos(j.origin)) return undefined;
    if (!j.region || !isPos(j.region.min) || !isPos(j.region.max)) return undefined;
    return {
      v: 1, playerId: j.playerId, playerName: String(j.playerName ?? ""), dimension: j.dimension, origin: j.origin,
      rotation: { x: Number(j.rotation?.x) || 0, y: Number(j.rotation?.y) || 0 }, gameMode: String(j.gameMode ?? ""),
      region: { min: j.region.min, max: j.region.max }, snapshotChunks: Math.max(0, Math.floor(Number(j.snapshotChunks) || 0)),
      regionClean: j.regionClean === true, playerRestored: j.playerRestored === true, started: Number(j.started) || 0,
    };
  }
  catch { return undefined; }
}

/**
 * Registros por posição que os blocos deixam nas dynamic properties do MUNDO (ex.: `cobblemon:berry|minecraft:overworld|x,y,z`,
 * gravado no onPlace e só apagado quando um JOGADOR quebra o bloco). Chave do Cobblemon com a dimensão e uma posição
 * dentro da área (que começou só com ar) = sobra do teste.
 */
export function isLeftoverWorldKey(key: string, dimensionId: string, region: Region): boolean {
  if (!key.startsWith("cobblemon:") || !key.includes(dimensionId)) return false;
  // A última trinca "x,y,z" da chave (a posição do bloco).
  const match = [...key.matchAll(/(-?\d+),(-?\d+),(-?\d+)/g)].pop();
  if (!match) return false;
  return regionContains(region, { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) });
}

/**
 * Blocos que o selftest pode ter deixado na área (a área começa só com ar): do Cobblemon, os de apoio ou os que uma
 * extensão declara (`extension`, ex.: os blocos do pacote dela).
 */
export function isSelfTestLeftoverBlock(typeId: string, extension?: (typeId: string) => boolean): boolean {
  return typeId.startsWith("cobblemon:") || typeId === "minecraft:barrier" || typeId === "minecraft:grass_block" || isWaterBlock(typeId)
    || extension?.(typeId) === true;
}

/** Água (piscina da fase de movimento). Na limpeza vira barreira antes de virar ar: assim nunca escorre para fora. */
export function isWaterBlock(typeId: string): boolean {
  return typeId === "minecraft:water" || typeId === "minecraft:flowing_water";
}

/** Orçamento de tempo por tick (watchdog): `expired()` depois de `ms` desde o `reset()`. */
export class TickBudget {
  private start: number;
  constructor(private readonly ms: number, private readonly now: () => number = Date.now) { this.start = now(); }
  reset() { this.start = this.now(); }
  expired(): boolean { return this.now() - this.start >= this.ms; }
}

/**
 * Posições das "âncoras" do journal: uma por coluna de chunk que a área cobre (no alto da área). A âncora é uma
 * entidade salva junto com o chunk, então, se o servidor cair antes de o mundo gravar a dynamic property do journal, os
 * chunks com sobras do teste também trazem o journal de volta.
 */
export function anchorPositions(region: Region): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  for (let cx = Math.floor(region.min.x / 16); cx <= Math.floor(region.max.x / 16); cx++) {
    for (let cz = Math.floor(region.min.z / 16); cz <= Math.floor(region.max.z / 16); cz++) {
      out.push({
        x: clamp(cx * 16 + 8, Math.max(region.min.x, cx * 16), Math.min(region.max.x, cx * 16 + 15)) + 0.5,
        y: region.max.y - 1,
        z: clamp(cz * 16 + 8, Math.max(region.min.z, cz * 16), Math.min(region.max.z, cz * 16 + 15)) + 0.5,
      });
    }
  }
  return out;
}

/** Lista curta (as últimas `max`) dos testes já resolvidos, pelo instante de início. */
export function rememberDone(list: readonly number[], started: number, max = 30): number[] {
  return [...list.filter(x => x !== started), started].slice(-max);
}

// ---------------------------------------------------------------------------------------------
// Fase de movimento: cercado (andar/correr), piscina (nadar/flutuar) e volume aéreo (voar/planar), com montaria

/** Área do teste relativa à origem O (canto do bloco sob o jogador, na altura escolhida). Tem de estar toda só com ar. */
export const SELFTEST_AREA = { minX: -12, maxX: 12, minY: -2, maxY: 12, minZ: -8, maxZ: 22 } as const;

export type LocomotionZone = "ground" | "water" | "air";
export const LOCOMOTION_ZONES: readonly LocomotionZone[] = ["ground", "water", "air"];

/** Interior de cada zona (relativo a O, inclusivo). */
export interface ZoneBox { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/**
 * Três caixas seladas lado a lado na frente do jogador (que fica em z < 0): chão em y = -1, teto em y = 10, paredes em
 * x = -12/-4/4/12 e z = 0/21, tudo de barreira. Nada sai de uma zona (nem pula de uma para outra). As âncoras do journal
 * (y = 11) ficam acima do teto.
 */
export const MOVEMENT_ZONES: Record<LocomotionZone, ZoneBox> = {
  ground: { minX: -11, maxX: -5, minY: 0, maxY: 9, minZ: 1, maxZ: 20 },
  water: { minX: -3, maxX: 3, minY: 0, maxY: 9, minZ: 1, maxZ: 20 },
  air: { minX: 5, maxX: 11, minY: 0, maxY: 9, minZ: 1, maxZ: 20 },
};
/** Casca de barreira em volta das três zonas. */
export const MOVEMENT_SHELL = { minX: -12, maxX: 12, minY: -1, maxY: 10, minZ: 0, maxZ: 21 } as const;
/** Paredes internas (entre as zonas). */
export const MOVEMENT_DIVIDERS = [-4, 4] as const;
/** Última camada de água da piscina (y = 0..WATER_TOP). */
export const WATER_TOP = 3;

export interface LayoutCell { dx: number; dy: number; dz: number; type: "minecraft:barrier" | "minecraft:water" }

/**
 * Blocos da fase de movimento, na ordem de colocação: chão, paredes, teto e, por último, a água (com a piscina já
 * fechada). A restauração desfaz na ordem inversa, depois de a água virar barreira.
 */
export function movementLayout(): LayoutCell[] {
  const out: LayoutCell[] = [];
  const shell = MOVEMENT_SHELL;
  const barrier = (dx: number, dy: number, dz: number) => out.push({ dx, dy, dz, type: "minecraft:barrier" });
  for (let dz = shell.minZ; dz <= shell.maxZ; dz++) for (let dx = shell.minX; dx <= shell.maxX; dx++) barrier(dx, shell.minY, dz);
  const walls = new Set<number>([shell.minX, ...MOVEMENT_DIVIDERS, shell.maxX]);
  for (let dy = shell.minY + 1; dy < shell.maxY; dy++) {
    for (let dz = shell.minZ; dz <= shell.maxZ; dz++) {
      for (let dx = shell.minX; dx <= shell.maxX; dx++) {
        if (walls.has(dx) || dz === shell.minZ || dz === shell.maxZ) barrier(dx, dy, dz);
      }
    }
  }
  for (let dz = shell.minZ; dz <= shell.maxZ; dz++) for (let dx = shell.minX; dx <= shell.maxX; dx++) barrier(dx, shell.maxY, dz);
  const pool = MOVEMENT_ZONES.water;
  for (let dy = pool.minY; dy <= WATER_TOP; dy++)
    for (let dz = pool.minZ; dz <= pool.maxZ; dz++)
      for (let dx = pool.minX; dx <= pool.maxX; dx++) out.push({ dx, dy, dz, type: "minecraft:water" });
  return out;
}

/**
 * Zonas de uma espécie pelas capacidades lidas do pack (`w` anda, `s` nada, `f` voa): quem voa vai para o volume aéreo
 * (que tem chão: anda e decola) e, se também nada, para a piscina; quem não voa vai para o cercado (anda) e/ou a
 * piscina (nada); sem nada, o cercado.
 */
export function locomotionZones(flags: string | undefined): LocomotionZone[] {
  const f = flags ?? "";
  const out: LocomotionZone[] = [];
  if (f.includes("w") && !f.includes("f")) out.push("ground");
  if (f.includes("s")) out.push("water");
  if (f.includes("f")) out.push("air");
  return out.length ? out : ["ground"];
}

/** Índices das combinações com um poser diferente (formas regionais etc. têm animações próprias); sempre inclui o 0. */
export function distinctPoserVariants(combos: readonly { poser?: string }[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  combos.forEach((combo, i) => {
    const key = combo.poser ?? "";
    if (seen.has(key)) return;
    seen.add(key);
    out.push(i);
  });
  return out.length ? out : [0];
}

export interface MovementTarget { species: string; variant: number; zone: LocomotionZone }

/** Amostra do quick por zona (duas rodadas). */
export const MOVEMENT_SAMPLE: Record<LocomotionZone, number> = { ground: 40, water: 20, air: 24 };
/** Pokémon por rodada em cada zona. */
export const MOVEMENT_BATCH: Record<LocomotionZone, number> = { ground: 20, water: 10, air: 12 };

/**
 * Alvos por zona. `all`: cada poser diferente de cada espécie, em cada zona da espécie. `sample`: os casos conhecidos
 * (com todos os posers) e uma amostra espaçada das outras espécies (poser padrão), até `sampleSizes` por zona.
 */
export function movementTargets(
  posers: Record<string, readonly number[]>, flags: Record<string, string>, coverage: Coverage,
  known: readonly string[] = KNOWN_PROBLEM_SPECIES, sampleSizes: Record<LocomotionZone, number> = MOVEMENT_SAMPLE,
): Record<LocomotionZone, MovementTarget[]> {
  const out: Record<LocomotionZone, MovementTarget[]> = { ground: [], water: [], air: [] };
  const knownSet = new Set(known);
  const rest: Record<LocomotionZone, MovementTarget[]> = { ground: [], water: [], air: [] };
  for (const [species, variants] of Object.entries(posers)) {
    for (const zone of locomotionZones(flags[species])) {
      if (coverage === "all") { for (const variant of variants) out[zone].push({ species, variant, zone }); continue; }
      if (knownSet.has(species)) for (const variant of variants) out[zone].push({ species, variant, zone });
      else rest[zone].push({ species, variant: variants[0] ?? 0, zone });
    }
  }
  if (coverage === "sample") {
    for (const zone of LOCOMOTION_ZONES) {
      const room = Math.max(0, sampleSizes[zone] - out[zone].length);
      out[zone] = [...out[zone].slice(0, sampleSizes[zone]), ...sampleEvenly(rest[zone], room)];
    }
  }
  return out;
}

/** Rodadas: cada uma leva até `sizes[zona]` de cada zona ao mesmo tempo (as zonas rodam juntas). */
export function movementRounds<T>(byZone: Record<LocomotionZone, readonly T[]>, sizes: Record<LocomotionZone, number> = MOVEMENT_BATCH): Record<LocomotionZone, T[]>[] {
  const count = Math.max(0, ...LOCOMOTION_ZONES.map(z => Math.ceil(byZone[z].length / Math.max(1, sizes[z]))));
  const out: Record<LocomotionZone, T[]>[] = [];
  for (let i = 0; i < count; i++) {
    const round = {} as Record<LocomotionZone, T[]>;
    for (const zone of LOCOMOTION_ZONES) {
      const size = Math.max(1, sizes[zone]);
      round[zone] = byZone[zone].slice(i * size, (i + 1) * size);
    }
    out.push(round);
  }
  return out;
}

/** Posições de nascimento numa zona: 2 colunas, linhas espalhadas no comprimento (centro do bloco). */
export function zoneSlots(zone: ZoneBox, count: number, y = zone.minY): { x: number; y: number; z: number }[] {
  const cols = count > 1 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = zone.maxX - zone.minX + 1;
  const depth = zone.maxZ - zone.minZ + 1;
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      x: zone.minX + (cols === 1 ? width / 2 : width * (col === 0 ? 0.25 : 0.75)),
      y,
      z: zone.minZ + depth * ((row + 0.5) / rows),
    });
  }
  return out;
}

/** Impulso de `from` na direção de `to` com módulo `strength` (sem vertical se `vertical` = false). */
export function nudgeVector(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, strength: number, vertical: boolean): { x: number; y: number; z: number } {
  const dx = to.x - from.x;
  const dy = vertical ? to.y - from.y : 0;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-6)) return { x: 0, y: 0, z: 0 };
  return { x: (dx / length) * strength, y: (dy / length) * strength, z: (dz / length) * strength };
}

export type RideStyleName = "LAND" | "AIR" | "LIQUID";

export interface MountRide { species: string; style: RideStyleName }

/** Montarias preferidas da amostra (a primeira que existir de cada estilo). */
export const PREFERRED_MOUNTS: Record<RideStyleName, readonly string[]> = {
  LAND: ["mudsdale", "arcanine", "rhyhorn"],
  LIQUID: ["lapras", "wailmer", "dewgong"],
  AIR: ["altaria", "charizard", "pidgeot"],
};

/**
 * Passeios de montaria. `all`: cada espécie montável em cada estilo (o voo começa no chão, então quem tem AIR e LAND faz
 * os dois no mesmo passeio). `sample`: um de cada estilo (terra, água, ar), pelas preferidas.
 */
export function mountRides(rideable: Record<string, readonly RideStyleName[]>, coverage: Coverage, preferred = PREFERRED_MOUNTS): MountRide[] {
  const species = Object.keys(rideable).filter(id => rideable[id].length > 0);
  if (coverage === "all") {
    const out: MountRide[] = [];
    for (const id of species) {
      const styles = rideable[id];
      if (styles.includes("LAND") && !styles.includes("AIR")) out.push({ species: id, style: "LAND" });
      if (styles.includes("LIQUID")) out.push({ species: id, style: "LIQUID" });
      if (styles.includes("AIR")) out.push({ species: id, style: "AIR" });
    }
    return out;
  }
  const out: MountRide[] = [];
  for (const style of ["LAND", "LIQUID", "AIR"] as const) {
    const pick = preferred[style].find(id => rideable[id]?.includes(style)) ?? species.find(id => rideable[id].includes(style));
    if (pick) out.push({ species: pick, style });
  }
  return out;
}

/** Zona onde cada estilo de montaria acontece. */
export function rideZone(style: RideStyleName): LocomotionZone {
  return style === "LIQUID" ? "water" : style === "AIR" ? "air" : "ground";
}

// ---------------------------------------------------------------------------------------------
// Modo `telas`: cada tela custom com dados de exemplo, uma por vez, para o jogador tirar print

/** Segundos com cada tela aberta (`/cobblemon:selftest telas <segundos>`): padrão, mínimo e máximo. */
export const SCREEN_SECONDS = { fallback: 10, min: 3, max: 60 } as const;
/** Aviso "Tela N/total: <nome>" antes de abrir cada tela (ticks). */
export const SCREEN_ANNOUNCE_TICKS = 40;

/** Segundos pedidos (texto do comando/scriptevent ou inteiro do parâmetro), limitados a 3..60; inválido = 10. */
export function parseScreenSeconds(raw: unknown): number {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(value)) return SCREEN_SECONDS.fallback;
  return Math.min(SCREEN_SECONDS.max, Math.max(SCREEN_SECONDS.min, Math.round(value)));
}

/**
 * Uma parada do roteiro. `form`: tela (fechar avança na hora); `hud`: só HUD/actionbar (avança pelo tempo).
 * `actionbar`: a própria tela usa a actionbar (sem contagem regressiva por cima). `needs`: só entra se houver o dado.
 */
export interface ScreenStep {
  key: string;
  kind: "form" | "hud";
  actionbar?: boolean;
  needs?: "starter" | "dex";
}

/** Roteiro, na ordem mostrada (o nome de cada tela é `cobblemon.selftest.screen.<key>`). */
export const SCREEN_TOUR: readonly ScreenStep[] = [
  { key: "starter", kind: "form", needs: "starter" },
  { key: "starter_3d", kind: "form", needs: "starter" },
  { key: "starter_confirm", kind: "form", needs: "starter" },
  { key: "starter_reminder", kind: "hud", actionbar: true },
  { key: "party", kind: "form" },
  { key: "party_hud", kind: "hud" },
  { key: "summary_info", kind: "form" },
  { key: "summary_moves", kind: "form" },
  { key: "summary_stats", kind: "form" },
  { key: "summary_marks", kind: "form" },
  { key: "summary_info_3d", kind: "form" },
  { key: "summary_moves_3d", kind: "form" },
  { key: "summary_stats_3d", kind: "form" },
  { key: "summary_marks_3d", kind: "form" },
  { key: "pc", kind: "form" },
  { key: "pc_empty", kind: "form" },
  { key: "pokedex_list", kind: "form" },
  { key: "pokedex_page", kind: "form", needs: "dex" },
  { key: "pokedex_entry", kind: "form" },
  { key: "dialogue", kind: "form" },
  { key: "trade", kind: "form" },
  { key: "battle_action", kind: "form" },
  { key: "battle_moves", kind: "form" },
  { key: "battle_gimmick", kind: "form" },
  { key: "battle_switch", kind: "form" },
  { key: "battle_bag", kind: "form" },
  { key: "battle_target", kind: "form" },
  { key: "battle_forfeit", kind: "form" },
  { key: "battle_hud", kind: "hud" },
  { key: "battle_hud_doubles", kind: "hud" },
  { key: "battle_minimised", kind: "hud" },
  { key: "battle_minimised_moves", kind: "hud" },
  { key: "achievements", kind: "form" },
  { key: "stats", kind: "form" },
  { key: "toast_capture", kind: "hud" },
  { key: "toast_advancement", kind: "hud" },
];

/** Roteiro sem as telas que dependem de um dado ausente (categorias de inicial, Pokédex regionais). */
export function screenTour(available: { starter: boolean; dex: boolean }): ScreenStep[] {
  return SCREEN_TOUR.filter(step => !step.needs || available[step.needs]);
}

export type ScreenOutcome = "closed" | "timeout" | "stopped";

/**
 * Espera uma tela aberta: termina quando o jogador fecha (`closed`), quando o tempo acaba ou quando o teste para
 * (`stopped`, conferido antes de tudo). `onSecond(restantes)` roda a cada segundo novo (contagem regressiva).
 * `wait(ticks)` é o `system.waitTicks` no jogo; nos testes, um relógio falso.
 */
export async function holdScreen(options: {
  ticks: number;
  wait: (ticks: number) => Promise<void>;
  closed: () => boolean;
  stopped: () => boolean;
  onSecond?: (remaining: number) => void;
  /** Ticks entre uma conferência e outra. */
  step?: number;
}): Promise<ScreenOutcome> {
  const step = Math.max(1, Math.floor(options.step ?? 2));
  const total = Math.max(0, Math.floor(options.ticks));
  let elapsed = 0;
  let lastSecond = -1;
  while (true) {
    if (options.stopped()) return "stopped";
    if (options.closed()) return "closed";
    if (elapsed >= total) return "timeout";
    const remaining = Math.ceil((total - elapsed) / 20);
    if (remaining !== lastSecond) {
      lastSecond = remaining;
      options.onSecond?.(remaining);
    }
    const dt = Math.min(step, total - elapsed);
    await options.wait(dt);
    elapsed += dt;
  }
}
