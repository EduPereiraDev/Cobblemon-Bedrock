/**
 * Tampa da panela por redstone sem `minecraft:redstone_consumer` (CampfireBlock.neighborChanged / Level.hasNeighborSignal
 * do Cobblemon 1.8.2).
 *
 * Por que por script: com o consumer, o bloco ignora o `minecraft:redstone_producer` das permutações (o comparador da
 * panela não acende) e a própria saída entra no `getRedstonePower()` da fogueira e fecha a tampa. Sem o consumer a
 * entrada é lida dos 6 vizinhos, com as regras do Java:
 *
 *   hasNeighborSignal(pos) = algum d com getSignal(pos + d, d) > 0
 *   getSignal(N, d)        = max(sinal fraco que N manda para a panela, N condutor ? getDirectSignalTo(N) : 0)
 *
 * O sinal fraco sai do estado do bloco (fio, repetidor, comparador, tocha, observador, alavanca...) com a regra de
 * direção do Java. O condutor energizado (bloco sólido) é recalculado aqui pelo `getDirectSignal` dos vizinhos dele:
 * no Bedrock o `getRedstonePower()` de uma pedra é a entrada bruta (medido: pedra ao lado de um bloco de redstone dá 15,
 * mas a lâmpada do outro lado dela fica apagada), então ele só serve de filtro barato ("tem alguma redstone perto").
 *
 * A saída do comparador da própria panela nunca entra: ela só vai para comparadores com a entrada virada para a panela
 * (potHoppers.comparatorMask), e um comparador só conta aqui quando a saída dele aponta para a panela. No Java a saída
 * analógica também não é sinal de entrada do próprio bloco.
 *
 * Convenções do Bedrock medidas no BDS (docs/pendencias/adaptacoes.md, "Tampa por redstone"):
 * - repetidor/comparador: `minecraft:cardinal_direction` = lado da ENTRADA; a saída é o oposto;
 * - observador: `minecraft:facing_direction` = lado observado; a saída é a traseira (como o FACING do Java);
 * - alavanca (`lever_direction`) e botão (`facing_direction`): para onde apontam; o apoio é o lado oposto;
 * - tocha de parede: `torch_facing_direction` = lado do APOIO ("top" = no chão).
 *
 * Laço: a cada REDSTONE_INTERVAL ticks, só as panelas registradas e com o chunk carregado. 6 leituras por panela,
 * filtradas pelo id antes de getAllStates/getRedstonePower (só nos blocos em que as regras usam); o
 * condutor só é examinado (5 leituras, mais as do fio) quando o Bedrock diz que há redstone chegando nele; o registro da
 * panela (dynamic property) só é lido quando o sinal muda.
 */
import { Block, Dimension, system, Vector3, world } from "@minecraft/server";
import { CAMPFIRES, cookingStore, setPotPowered } from "../machines/cooking";
import { parseBlockKey } from "../machines/store";

export const REDSTONE_INTERVAL = 2;
/** A cada quantas rodadas o cache em memória é descartado (panela recolocada, registro trocado por outra frente). */
const RESYNC_ROUNDS = 10;

export type Dir6 = "down" | "up" | "north" | "south" | "west" | "east";
export const DIRS6: readonly Dir6[] = ["down", "up", "north", "south", "west", "east"];
export const DIR6_OFFSET: Record<Dir6, Vector3> = {
  down: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 },
  west: { x: -1, y: 0, z: 0 }, east: { x: 1, y: 0, z: 0 },
};
export const OPPOSITE6: Record<Dir6, Dir6> = { down: "up", up: "down", north: "south", south: "north", west: "east", east: "west" };
const PERPENDICULAR: Record<Dir6, readonly Dir6[]> = {
  north: ["west", "east"], south: ["west", "east"], west: ["north", "south"], east: ["north", "south"], up: [], down: [],
};

export function offset(pos: Vector3, d: Dir6): Vector3 {
  const o = DIR6_OFFSET[d];
  return { x: pos.x + o.x, y: pos.y + o.y, z: pos.z + o.z };
}

/** O que o script vê de um bloco. */
export interface BlockView {
  id: string;
  states: Record<string, string | number | boolean>;
  /** `Block.getRedstonePower()` (undefined = bloco sem redstone). */
  power?: number;
}

/** Leitor de blocos por posição (runtime: dimension.getBlock; testes: mapa). */
export type BlockReader = (pos: Vector3) => BlockView | undefined;

/** `facing_direction` numérico antigo (0 baixo, 1 cima, 2 norte, 3 sul, 4 oeste, 5 leste) ou nome. */
const FACING_INDEX: readonly Dir6[] = ["down", "up", "north", "south", "west", "east"];
/** `direction` antigo de 2 bits (gancho de tripwire): 0 sul, 1 oeste, 2 norte, 3 leste. */
const LEGACY_DIRECTION: readonly Dir6[] = ["south", "west", "north", "east"];

function facingOf(value: string | number | boolean | undefined): Dir6 | undefined {
  if (typeof value === "number") return FACING_INDEX[value];
  return typeof value === "string" && value in DIR6_OFFSET ? value as Dir6 : undefined;
}

/** Saída de repetidor/comparador (o oposto de `minecraft:cardinal_direction`, que é o lado da entrada). */
export function diodeOutput(states: BlockView["states"]): Dir6 | undefined {
  const c = facingOf(states["minecraft:cardinal_direction"]);
  return c && OPPOSITE6[c];
}

/** Lado do apoio da tocha. */
export function torchSupport(states: BlockView["states"]): Dir6 {
  const f = states["torch_facing_direction"];
  return (f !== "top" && facingOf(f)) || "down";
}

/** Lado do apoio da alavanca (`lever_direction` aponta para longe do apoio). */
export function leverSupport(states: BlockView["states"]): Dir6 | undefined {
  const v = String(states["lever_direction"] ?? "");
  if (v.startsWith("up_")) return "down";
  if (v.startsWith("down_")) return "up";
  const d = facingOf(v);
  return d && OPPOSITE6[d];
}

/** Lado do apoio de um botão vanilla (`facing_direction`) ou do Cobblemon (`minecraft:block_face`). */
export function buttonSupport(states: BlockView["states"]): Dir6 | undefined {
  const d = facingOf(states["facing_direction"] ?? states["minecraft:block_face"]);
  return d && OPPOSITE6[d];
}

const clamp = (n: number | undefined) => Math.max(0, Math.min(15, Math.floor(n ?? 0)));
const isButton = (id: string) => id.endsWith("_button");
const isPlate = (id: string) => id.endsWith("_pressure_plate");
const isComparator = (id: string) => id === "minecraft:powered_comparator" || id === "minecraft:unpowered_comparator";
const isRepeater = (id: string) => id === "minecraft:powered_repeater" || id === "minecraft:unpowered_repeater";
const pressedCobblemon = (s: BlockView["states"]) => s["cobblemon:pressed"] === true;

function buttonPressed(n: BlockView): boolean {
  return n.states["button_pressed_bit"] === true || pressedCobblemon(n.states);
}

function plateSignal(n: BlockView): number {
  if (n.states["redstone_signal"] !== undefined) return clamp(Number(n.states["redstone_signal"]));
  return pressedCobblemon(n.states) ? 15 : 0;
}

/** Blocos que o Java trata como fonte de sinal (isSignalSource): o fio se liga a eles. */
function isSignalSource(n: BlockView): boolean {
  const id = n.id;
  return id === "minecraft:redstone_block" || id === "minecraft:lever" || id === "minecraft:redstone_torch" || id === "minecraft:unlit_redstone_torch"
    || isButton(id) || isPlate(id) || isComparator(id) || id === "minecraft:target" || id === "minecraft:daylight_detector"
    || id === "minecraft:daylight_detector_inverted" || id === "minecraft:trapped_chest" || id === "minecraft:tripwire_hook"
    || id === "minecraft:lectern" || id === "minecraft:detector_rail" || id === "minecraft:lightning_rod" || id === "minecraft:sculk_sensor"
    || id === "minecraft:calibrated_sculk_sensor" || id === "cobblemon:ring_target" || CAMPFIRES.includes(id);
}

/**
 * Sinal fraco que o bloco `n` manda para o vizinho na direção `toward` (visto de `n`). É o getSignal do Java com
 * `direction = OPPOSITE(toward)` (a direção de quem pergunta até `n`).
 */
export function weakSignal(n: BlockView | undefined, toward: Dir6): number {
  if (!n) return 0;
  const { id, states } = n;
  const from = OPPOSITE6[toward];
  switch (id) {
    case "minecraft:redstone_block": return 15;
    // RedStoneWireBlock.getSignal: nada para baixo; para o bloco de baixo e para os lados em que está ligado. Para a
    // panela ao lado ele está sempre ligado (CampfireBlock.isSignalSource = true).
    case "minecraft:redstone_wire": return toward === "up" ? 0 : clamp(Number(states["redstone_signal"] ?? 0));
    case "minecraft:powered_repeater": return diodeOutput(states) === toward ? 15 : 0;
    case "minecraft:powered_comparator": return diodeOutput(states) === toward ? clamp(n.power) : 0;
    // RedstoneTorchBlock (DOWN != direction) / RedstoneWallTorchBlock (FACING != direction): 15 para todos os lados menos
    // o bloco que a segura.
    case "minecraft:redstone_torch": return torchSupport(states) === toward ? 0 : 15;
    // ObserverBlock.getSignal: POWERED e FACING == direction (a traseira toca quem pergunta).
    case "minecraft:observer": return states["powered_bit"] === true && facingOf(states["minecraft:facing_direction"]) === from ? 15 : 0;
    case "minecraft:lever": return states["open_bit"] === true ? 15 : 0;
    case "minecraft:tripwire_hook": case "minecraft:lectern": case "minecraft:lightning_rod":
      return states["powered_bit"] === true ? 15 : 0;
    case "minecraft:detector_rail": return states["rail_data_bit"] === true ? 15 : 0;
    case "minecraft:daylight_detector": case "minecraft:daylight_detector_inverted": return clamp(Number(states["redstone_signal"] ?? 0));
    case "minecraft:target": case "minecraft:trapped_chest": case "minecraft:sculk_sensor": case "minecraft:calibrated_sculk_sensor":
      return clamp(n.power);
    case "cobblemon:ring_target": return clamp(Number(states["cobblemon:power"] ?? 0));
  }
  if (isButton(id)) return buttonPressed(n) ? 15 : 0;
  if (isPlate(id)) return plateSignal(n);
  // Qualquer outro bloco (pedra, lâmpada, funil, o vaso e a própria fogueira com o comparador...) não é fonte.
  return 0;
}

/**
 * Sinal direto (forte) que o bloco `m` manda para o vizinho na direção `toward` (visto de `m`): getDirectSignal do Java,
 * o que energiza um bloco condutor.
 */
export function directSignal(m: BlockView | undefined, toward: Dir6, pos: Vector3, read: BlockReader): number {
  if (!m) return 0;
  const { id, states } = m;
  const from = OPPOSITE6[toward];
  switch (id) {
    // O fio energiza o bloco de baixo e o bloco para onde aponta.
    case "minecraft:redstone_wire": {
      const signal = clamp(Number(states["redstone_signal"] ?? 0));
      if (!signal || toward === "up") return 0;
      return toward === "down" || wirePointsTo(pos, toward, read) ? signal : 0;
    }
    case "minecraft:powered_repeater": case "minecraft:powered_comparator": return weakSignal(m, toward);
    // A tocha energiza só o bloco de cima.
    case "minecraft:redstone_torch": return toward === "up" ? 15 : 0;
    case "minecraft:observer": return weakSignal(m, toward);
    case "minecraft:lever": return states["open_bit"] === true && leverSupport(states) === toward ? 15 : 0;
    // Gancho e para-raios: o bloco em que estão presos (FACING aponta para longe dele).
    case "minecraft:tripwire_hook":
      return states["powered_bit"] === true && LEGACY_DIRECTION[Number(states["direction"] ?? -1)] === from ? 15 : 0;
    case "minecraft:lightning_rod": return states["powered_bit"] === true && facingOf(states["facing_direction"]) === from ? 15 : 0;
    // Baú com armadilha, atril e trilho detector: o bloco de baixo.
    case "minecraft:trapped_chest": case "minecraft:lectern": case "minecraft:detector_rail": return toward === "down" ? weakSignal(m, toward) : 0;
  }
  if (isButton(id)) return buttonPressed(m) && buttonSupport(states) === toward ? 15 : 0;
  if (isPlate(id)) return toward === "down" ? plateSignal(m) : 0;
  return 0;
}

/** RedStoneWireBlock.shouldConnectTo: o fio em `wire` se liga ao bloco `n` do lado `side`? */
function wireConnectsTo(n: BlockView | undefined, side: Dir6): boolean {
  if (!n) return false;
  if (n.id === "minecraft:redstone_wire") return true;
  if (isRepeater(n.id)) {
    const out = diodeOutput(n.states);
    return out === side || out === OPPOSITE6[side];
  }
  if (n.id === "minecraft:observer") return facingOf(n.states["minecraft:facing_direction"]) === side;
  return isSignalSource(n);
}

const isAir = (n: BlockView | undefined) => !n || n.id === "minecraft:air";

/** O fio está ligado ao lado `side` (no mesmo nível, subindo ou descendo um bloco)? */
function wireConnected(pos: Vector3, side: Dir6, read: BlockReader, airAbove: boolean): boolean {
  const next = offset(pos, side);
  const n = read(next);
  if (wireConnectsTo(n, side)) return true;
  if (airAbove && read(offset(next, "up"))?.id === "minecraft:redstone_wire") return true;
  return isAir(n) && read(offset(next, "down"))?.id === "minecraft:redstone_wire";
}

/**
 * O fio em `pos` aponta para o lado `side`? (getConnectionState + getMissingConnections do Java: ligado desse lado, ou sem
 * ligação nos dois lados perpendiculares — fio solto em cruz ou em linha reta passando por ali.)
 */
export function wirePointsTo(pos: Vector3, side: Dir6, read: BlockReader): boolean {
  const airAbove = isAir(read(offset(pos, "up")));
  if (wireConnected(pos, side, read, airAbove)) return true;
  return PERPENDICULAR[side].every(p => !wireConnected(pos, p, read, airAbove));
}

/** Blocos que no Java não são condutores (isRedstoneConductor = false) ou que já foram tratados como fonte. */
function isConductorCandidate(n: BlockView): boolean {
  const id = n.id;
  if ((n.power ?? 0) <= 0 || id.startsWith("cobblemon:") || isSignalSource(n) && id !== "minecraft:target") return false;
  if (id === "minecraft:redstone_wire" || isRepeater(id) || id === "minecraft:observer" || id === "minecraft:hopper") return false;
  if (id === "minecraft:piston" || id === "minecraft:sticky_piston" || id === "minecraft:bell" || id === "minecraft:chest") return false;
  return !(id.endsWith("_door") || id.endsWith("trapdoor") || id.endsWith("fence_gate") || id.endsWith("rail"));
}

/** Level.getDirectSignalTo(pos): o maior sinal direto que os vizinhos mandam para `pos`. */
export function directSignalTo(pos: Vector3, read: BlockReader, skip?: Dir6): number {
  let best = 0;
  for (const d of DIRS6) {
    if (d === skip) continue;
    const at = offset(pos, d);
    best = Math.max(best, directSignal(read(at), OPPOSITE6[d], at, read));
    if (best >= 15) break;
  }
  return best;
}

/** Level.hasNeighborSignal(pos) para a panela em `pos`. */
export function hasNeighborSignal(pos: Vector3, read: BlockReader): boolean {
  for (const d of DIRS6) {
    const at = offset(pos, d);
    const n = read(at);
    if (!n || n.id === "minecraft:air") continue;
    if (weakSignal(n, OPPOSITE6[d]) > 0) return true;
    // A panela não manda sinal direto (só o do comparador, que não é lido): pula o lado de volta.
    if (isConductorCandidate(n) && directSignalTo(at, read, OPPOSITE6[d]) > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Runtime

/** Blocos cujo estado entra nas regras acima (fontes, fio, diodos, observador, alavanca...). */
const STATEFUL = new Set([
  "minecraft:redstone_wire", "minecraft:powered_repeater", "minecraft:unpowered_repeater", "minecraft:powered_comparator",
  "minecraft:unpowered_comparator", "minecraft:redstone_torch", "minecraft:unlit_redstone_torch", "minecraft:observer", "minecraft:lever",
  "minecraft:tripwire_hook", "minecraft:lectern", "minecraft:lightning_rod", "minecraft:detector_rail", "minecraft:daylight_detector",
  "minecraft:daylight_detector_inverted", "cobblemon:ring_target",
]);
/** Fontes cujo sinal é o `getRedstonePower()` (e não o estado). */
const POWER_SOURCES = new Set(["minecraft:powered_comparator", "minecraft:target", "minecraft:trapped_chest", "minecraft:sculk_sensor", "minecraft:calibrated_sculk_sensor"]);

export function needsStates(id: string): boolean {
  return STATEFUL.has(id) || isButton(id) || isPlate(id);
}

/** Pode ser um condutor energizado (isConductorCandidate sem a força)? Só esses precisam do `getRedstonePower()`. */
export function mayConduct(id: string): boolean {
  if (id.startsWith("cobblemon:") || needsStates(id) || id === "minecraft:hopper") return false;
  if (id === "minecraft:redstone_block" || id === "minecraft:trapped_chest" || id === "minecraft:sculk_sensor" || id === "minecraft:calibrated_sculk_sensor") return false;
  if (id === "minecraft:piston" || id === "minecraft:sticky_piston" || id === "minecraft:bell" || id === "minecraft:chest") return false;
  return !(id.endsWith("_door") || id.endsWith("trapdoor") || id.endsWith("fence_gate") || id.endsWith("rail"));
}

/**
 * O que as regras precisam do bloco. Filtra pelo id antes das leituras caras: `getAllStates()` só nos blocos com estado
 * de redstone e `getRedstonePower()` só nas fontes por força e nos possíveis condutores (pedra etc.).
 */
export function viewOf(block: Block | undefined): BlockView | undefined {
  if (!block) return undefined;
  try {
    if (block.isAir) return { id: "minecraft:air", states: {} };
    const id = block.typeId;
    const states = needsStates(id) ? block.permutation.getAllStates() : {};
    let power: number | undefined;
    if (POWER_SOURCES.has(id) || mayConduct(id)) {
      try { power = block.getRedstonePower(); }
      catch { power = undefined; }
    }
    return { id, states, power };
  }
  catch { return undefined; }
}

export function dimensionReader(dim: Dimension): BlockReader {
  return pos => {
    try { return viewOf(dim.getBlock(pos)); }
    catch { return undefined; }
  };
}

/** Sinal de vizinhança da panela no bloco `block` (a fogueira). */
export function potNeighborSignal(block: Block): boolean {
  return hasNeighborSignal(block.location, dimensionReader(block.dimension));
}

const lastSignal = new Map<string, boolean>();
let rounds = 0;

export function tickPotRedstone() {
  if (++rounds % RESYNC_ROUNDS === 0) lastSignal.clear();
  for (const key of cookingStore.keys()) {
    const { dimension, location } = parseBlockKey(key);
    let dim: Dimension;
    try { dim = world.getDimension(dimension); }
    catch { continue; }
    let block: Block | undefined;
    try { block = dim.isChunkLoaded(location) ? dim.getBlock(location) : undefined; }
    catch { block = undefined; }
    if (!block || !CAMPFIRES.includes(block.typeId)) { lastSignal.delete(key); continue; }
    // Pré-filtro "há redstone por perto?" com containsBlock NÃO compensa: medido no BDS, 1 containsBlock com os ~55 ids
    // de redstone (5×5×5 ou 3×3×3) custa ~270 µs, mais que os 6 vizinhos lidos aqui (~140–260 µs, quase tudo getBlock).
    const powered = potNeighborSignal(block);
    if (lastSignal.get(key) === powered) continue;
    lastSignal.set(key, powered);
    setPotPowered(dim, key, powered);
  }
}

export function startPotRedstone() {
  system.runInterval(() => {
    try { tickPotRedstone(); }
    catch (e) { console.warn(`[adaptacoes] tampa por redstone: ${e}`); }
  }, REDSTONE_INTERVAL);
}
