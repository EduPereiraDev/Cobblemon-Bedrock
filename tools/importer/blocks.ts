// Blocos do Cobblemon (CobblemonBlocks.kt + blockstates + modelos + loot) → blocos do Bedrock.
//
// Regras gerais:
//   - propriedades do blockstate viram estados "cobblemon:<prop>" (waterlogged vira minecraft:liquid_detection,
//     ver WATERLOGGABLE_VANILLA/waterloggableClasses); "facing"
//     horizontal vira minecraft:cardinal_direction (trait placement_direction), facing de 6 direções vira
//     minecraft:block_face (placement_position) ou minecraft:facing_direction, "half" top/bottom vira
//     minecraft:vertical_half e "axis" é derivado de minecraft:facing_direction (compatível com StripLog);
//   - o valor do estado de direção é sempre o "facing" do Java; o y_rotation_offset do trait escolhe se
//     ele é o sentido do olhar do jogador (portas, escadas, portões) ou o oposto (máquinas, decoração);
//   - "variants" → permutations (geometria rotacionada no bone raiz + material instances + caixas);
//     "multipart" → uma geometria com um bone por parte e minecraft:geometry.bone_visibility;
//   - comportamento que o Bedrock não tem nativamente vira um custom component "cobblemon:<nome>"
//     listado em generated/scripts/blockBehaviours.ts (os já implementados em scripts/ mantêm o nome).
// Blocos usados pelos scripts atuais mantêm ids/estados/componentes (PC, healing machine, apricorns,
// portas, lajes, botões, placas, alçapões, toras, folhas, minérios).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GeometryEmitter, TerrainTextures } from "./blockModels.ts";
import type { GeometryResult, ModelPart } from "./blockModels.ts";
import { itemIconTexture, resolveModel } from "./javaModels.ts";
import { KOTLIN, loadKotlinBlocks, loadKotlinItems } from "./kotlin.ts";
import type { KtBlock } from "./kotlin.ts";
import { EMPTY_LOOT, convertLoot, emitLoot, javaBlockLoot, lootStateProps } from "./loot.ts";
import type { Assignment, ItemIdMapper } from "./loot.ts";
import { ASSETS, DATA, OUT_BP, OUT_RP, OUT_SCRIPTS, ROOT, count, readJson, splitId, walk, warn, writeJson, writeText } from "./util.ts";
import { BLOCK_GEO_BOUNDS, BLOCK_GEO_MARGIN, BLOCK_GEO_MAX_LENGTH, checkBlockGeometry, geometryBoxes } from "./clientRules.ts";

export const BLOCK_FORMAT = "1.21.90";
/** O trait minecraft:connection só é estável (sem "Upcoming Creator Features") a partir deste formato. */
const CONNECTION_FORMAT = "1.26.0";
/** O componente minecraft:movable só é estável (sem "Upcoming Creator Features") a partir deste formato. */
const MOVABLE_FORMAT = "1.21.100";
/**
 * Máquinas/armazenamento cujos dados ficam presos à posição do bloco (MachineStore, PC em duas partes, carga
 * da healing machine): pistões não podem movê-los (no Java, pushReaction BLOCK / block entity).
 */
const IMMOVABLE_CLASSES = new Set([
	"DisplayCaseBlock", "DiscShelfBlock", "LecternBlock", "TMMachineBlock", "GildedChestBlock", "MonitorBlock", "DamagedMonitorBlock",
	"FossilAnalyzerBlock", "RestorationTankBlock", "PastureBlock", "CampfireBlock",
]);

/**
 * Frente motor — waterlogging. Classes do Java que implementam SimpleWaterloggedBlock sem arquivo próprio no
 * Cobblemon (lajes, escadas, cercas, muros, alçapões e folhas do vanilla).
 */
const WATERLOGGABLE_VANILLA = new Set(["SlabBlock", "StairBlock", "FenceBlock", "WallBlock", "TrapDoorBlock", "LeavesBlock"]);
let waterloggableCache: Set<string> | undefined;

/**
 * Classes de bloco do Cobblemon com `waterlogged` (SimpleWaterloggedBlock ou BlockStateProperties.WATERLOGGED no
 * arquivo) e as subclasses delas — as 23 do 1.8.2 (RingTarget, CoinPouch, DecorativeItem, EjectButton, Plaque, Orb,
 * Tumblestone, SweetIncense, SaccharineLeaf, PC, GalaricaWreath, Pasture, Magnet, HeartyGrains, CampfirePot, TMMachine,
 * Campfire, GildedChest...) + WATERLOGGABLE_VANILLA.
 */
export function waterloggableClasses(): Set<string> {
	if (waterloggableCache) return waterloggableCache;
	const out = new Set(WATERLOGGABLE_VANILLA);
	const parents = new Map<string, string>();
	const files: string[] = [];
	const scan = (dir: string) => {
		if (!existsSync(dir)) return;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) scan(join(dir, e.name));
			else if (e.name.endsWith(".kt")) files.push(join(dir, e.name));
		}
	};
	scan(join(KOTLIN, "block"));
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		const body = text.split("\n").filter((l) => !l.startsWith("import ")).join("\n");
		const classes = [...body.matchAll(/\bclass\s+([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]);
		for (const m of body.matchAll(/\bclass\s+([A-Z][A-Za-z0-9]*)[\s\S]*?\)\s*:\s*([A-Z][A-Za-z0-9]*)\s*\(/g)) parents.set(m[1], m[2]);
		if (/SimpleWaterloggedBlock|\bWATERLOGGED\b/.test(body)) for (const c of classes) out.add(c);
	}
	// Fecho por herança (ex.: PlaqueBlock : WallAttachedDirectionalBlock).
	for (let changed = true; changed;) {
		changed = false;
		for (const [child, parent] of parents) if (out.has(parent) && !out.has(child)) { out.add(child); changed = true; }
	}
	waterloggableCache = out;
	return out;
}

/**
 * minecraft:liquid_detection (estável, formato >= 1.21.60): o bloco aceita água (balde, `setWaterlogged`, camada 2
 * do .mcstructure). Água corrente não entra ("blocking"), como no Java, onde só a fonte alaga o bloco.
 */
export const LIQUID_DETECTION = { detection_rules: [{ liquid_type: "water", can_contain_liquid: true, on_liquid_touches: "blocking" }] };

/** minecraft:movable imóvel, subindo o format_version do bloco só se estiver abaixo do mínimo. */
function makeImmovable(built: Built): void {
	built.components["minecraft:movable"] = { movement_type: "immovable" };
	if (compareFormat(built.format ?? BLOCK_FORMAT, MOVABLE_FORMAT) < 0) built.format = MOVABLE_FORMAT;
}

function compareFormat(a: string, b: string): number {
	const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

/**
 * Componentes já registrados pelos scripts. Cada frente registra os seus num arquivo próprio
 * (scripts/custom_components/**, scripts/items/components.ts, scripts/fishing/components.ts); as chaves
 * `"cobblemon:..."` declaradas nesses arquivos contam como registradas.
 */
export function registeredComponents(): Set<string> {
	const files = [
		...listTs(join(ROOT, "scripts", "custom_components")),
		join(ROOT, "scripts", "items", "components.ts"),
		join(ROOT, "scripts", "fishing", "components.ts"),
	];
	const out = new Set<string>();
	for (const file of files) {
		if (!existsSync(file)) continue;
		for (const m of readFileSync(file, "utf8").matchAll(/["'](cobblemon:[a-z0-9_]+)["']\s*:/g)) out.add(m[1]);
	}
	return out;
}

function listTs(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
		entry.isDirectory() ? listTs(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []);
}

export interface BehaviourDef {
	blocks: string[];
	description: string;
	states: Record<string, unknown[]>;
	/** Parâmetros do componente por bloco (quando houver). */
	params?: Record<string, unknown>;
}

/** Componentes novos (não implementados) que os scripts precisam registrar. */
export const BLOCK_BEHAVIOURS = new Map<string, BehaviourDef>();

function behaviour(name: string, blockId: string, description: string, states: Record<string, unknown[]> = {}): void {
	const def = BLOCK_BEHAVIOURS.get(name) ?? { blocks: [], description, states: {} };
	if (!def.blocks.includes(blockId)) def.blocks.push(blockId);
	for (const [k, v] of Object.entries(states)) def.states[k] ??= v;
	BLOCK_BEHAVIOURS.set(name, def);
}

/** Resultado por bloco do Java, usado por itens, receitas e worldgen. */
export interface BlockOut {
	javaId: string;
	/** Bloco do Bedrock que o item do Java coloca (pode diferir do id do Java: compat). */
	placeBlock: string;
	/** Todos os blocos Bedrock gerados para este bloco do Java. */
	bedrockIds: string[];
	/** Item de bloco "natural": true quando o bloco aparece como item próprio (sem item custom). */
	hasOwnItem: boolean;
	cls: string;
	/**
	 * Bloco de duas metades (porta, PC): a metade de cima é outro bloco no Bedrock. Nas estruturas, o estado Java
	 * `prop=value` escolhe `block` em vez de `placeBlock` (bedrockStateFor).
	 */
	upper?: { prop: string; value: string; block: string };
}

type StateValue = string | number | boolean;
interface StateDef {
	/** Nome do estado no Bedrock (ou trait). */
	name: string;
	values: StateValue[];
	/** Converte o valor Java → condição Molang. */
	cond: (javaValue: string) => string | undefined;
	/** Valor Java → valor do estado no Bedrock quando a escala muda (ex.: carga 0..5 do Java → 0..15). */
	toBedrock?: (javaValue: string) => StateValue | undefined;
}

/** Nome seguro para arquivo/identificador de geometria. */
function safeGeoName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * Box UV do Bedrock → UV por face (necessário para material_instance por face). Layout padrão: linha de cima
 * up/down, linha de baixo east/north/west/south. `su`/`sv` reescalam para a geometria de 16×16.
 */
function boxUvFaces(size: number[], uv: number[], su: number, sv: number, instance: string): Record<string, unknown> {
	const [sx, sy, sz] = size;
	const [u, v] = uv;
	const r = (n: number) => Math.round(n * 10000) / 10000;
	const face = (fu: number, fv: number, w: number, h: number) => ({ uv: [r(fu * su), r(fv * sv)], uv_size: [r(w * su), r(h * sv)], material_instance: instance });
	return {
		east: face(u, v + sz, sz, sy),
		north: face(u + sz, v + sz, sx, sy),
		west: face(u + sz + sx, v + sz, sz, sy),
		south: face(u + 2 * sz + sx, v + sz, sx, sy),
		up: face(u + sz + sx, v + sz, -sx, -sz),
		down: face(u + 2 * sx + sz, v, -sx, sz),
	};
}

/**
 * Frente cliente-log: põe a geometria do arbusto de berry (arbusto + flores/frutos nos growthPoints + muda) dentro
 * dos limites de geometria de bloco do cliente (clientRules.ts: 30 px por eixo, caixas entre -14 e 30 px em y e
 * -22..22 em x/z). Fora deles o cliente recusa a geometria inteira e o bloco some. Em ordem, do mais fiel ao menos:
 *  1. Pontos de crescimento cujas flores/frutos saem dos limites mesmo com a escala mínima do passo 3 (pinap/yache/
 *     iapapa empilham 10 pontos até 3 blocos de altura) saem da geometria. Com growthPoints fixos (randomizedGrowthPoints false) o Java enche os pontos na
 *     ordem, então os últimos (mais altos) só aparecem com colheitas acima do normal (baseYield 2–3).
 *  2. A muda (idade 0) sobe o necessário: a parte abaixo de y=0 fica enterrada no solo; ela só aparece sozinha.
 *  3. Se ainda sobrar (arbusto com planos rotacionados passando de 30 px: occa/pamtre/lum), escala uniforme em
 *     torno do centro do chão do bloco (UV por face não muda; no máximo 8%).
 */
export function fitBerryGrowthGeometry(id: string, bones: Array<Record<string, any>>, randomized: boolean): void {
	const M = BLOCK_GEO_MARGIN;
	if (!checkBlockGeometry(bones as any, M).problems.length) return;
	// Um ponto só sai se nem a escala mínima aceita (passo 3) o trouxer para dentro dos limites.
	const MIN_SCALE = 0.92;
	const inside = (b: { min: number[]; max: number[] }) => [0, 1, 2].every((i) => b.min[i] >= (BLOCK_GEO_BOUNDS.min[i] + M) / MIN_SCALE && b.max[i] <= (BLOCK_GEO_BOUNDS.max[i] - M) / MIN_SCALE);
	const subtree = (root: string) => (b: Record<string, any>) => b.name === root || String(b.name).startsWith(`${root}_`);
	const actions: string[] = [];
	// 1. Pontos fora dos limites (flor e fruto do mesmo ponto saem juntos).
	const boxes = geometryBoxes(bones as any);
	const points = new Set<number>();
	for (const b of bones) {
		const m = /^berry_(?:flower|fruit)_(\d+)$/.exec(b.name);
		if (m) points.add(Number(m[1]));
	}
	const dropped: number[] = [];
	for (const i of [...points].sort((a, b) => a - b)) {
		const inUnit = [subtree(`berry_flower_${i}`), subtree(`berry_fruit_${i}`)];
		const names = new Set(bones.filter((b) => inUnit.some((f) => f(b))).map((b) => b.name));
		if (boxes.some((bx) => names.has(bx.bone) && !inside(bx))) dropped.push(i);
	}
	if (dropped.length) {
		const gone = new Set(bones.filter((b) => dropped.some((i) => subtree(`berry_flower_${i}`)(b) || subtree(`berry_fruit_${i}`)(b))).map((b) => b.name));
		for (let k = bones.length - 1; k >= 0; k--) if (gone.has(bones[k].name)) bones.splice(k, 1);
		actions.push(`${dropped.length} de ${points.size} pontos de crescimento fora dos limites removidos (${randomized ? "pontos sorteados" : "os mais altos"})`);
		count("berries: pontos de crescimento fora do limite de geometria de bloco removidos", dropped.length);
	}
	// 2. Muda sobe o necessário para a extensão em y caber (limitada ao que estava enterrado).
	let check = checkBlockGeometry(bones as any, M);
	const sproutBones = bones.filter(subtree("berry_sprout"));
	if (check.length[1] > BLOCK_GEO_MAX_LENGTH - M && sproutBones.length) {
		const sproutMin = Math.min(...geometryBoxes(bones as any).filter((b) => sproutBones.some((s) => s.name === b.bone)).map((b) => b.min[1]));
		const others = geometryBoxes(bones as any).filter((b) => !sproutBones.some((s) => s.name === b.bone));
		const otherMin = others.length ? Math.min(...others.map((b) => b.min[1])) : Infinity;
		// Só adianta se a muda for a parte mais baixa; sobe até igualar o resto ou até o que falta, o que for menor.
		const need = check.length[1] - (BLOCK_GEO_MAX_LENGTH - M) + 0.01;
		const lift = Math.min(need, Math.max(0, Math.min(otherMin, 0) - sproutMin));
		if (lift > 0) {
			const r4 = (n: number) => Math.round(n * 10000) / 10000;
			for (const b of sproutBones) {
				if (b.pivot) b.pivot = [b.pivot[0], r4(b.pivot[1] + lift), b.pivot[2]];
				for (const c of b.cubes ?? []) {
					c.origin = [c.origin[0], r4(c.origin[1] + lift), c.origin[2]];
					if (c.pivot) c.pivot = [c.pivot[0], r4(c.pivot[1] + lift), c.pivot[2]];
				}
			}
			actions.push(`muda erguida ${lift.toFixed(2)} px`);
			count("berries: muda erguida para caber no limite de geometria de bloco");
		}
		check = checkBlockGeometry(bones as any, M);
	}
	// 3. Escala uniforme em torno de (0, 0, 0) (centro do chão do bloco).
	if (check.problems.length) {
		let s = 1;
		for (let i = 0; i < 3; i++) {
			if (check.length[i] > 0) s = Math.min(s, (BLOCK_GEO_MAX_LENGTH - M) / check.length[i]);
			if (check.max[i] > 0) s = Math.min(s, (BLOCK_GEO_BOUNDS.max[i] - M) / check.max[i]);
			if (check.min[i] < 0) s = Math.min(s, (BLOCK_GEO_BOUNDS.min[i] + M) / check.min[i]);
		}
		const r4 = (n: number) => Math.round(n * s * 10000) / 10000;
		const scaleVec = (v?: number[]) => v?.map(r4);
		for (const b of bones) {
			if (b.pivot) b.pivot = scaleVec(b.pivot);
			for (const c of b.cubes ?? []) {
				c.origin = scaleVec(c.origin);
				c.size = scaleVec(c.size);
				if (c.pivot) c.pivot = scaleVec(c.pivot);
				if (c.inflate) c.inflate = r4(c.inflate);
			}
		}
		actions.push(`escala ${(s * 100).toFixed(1)}%`);
		count("berries: geometria escalada para caber no limite de geometria de bloco");
		check = checkBlockGeometry(bones as any, 0);
	}
	if (check.problems.length) warn("geometria de berry ainda fora dos limites do cliente", `${id}: ${check.problems.join("; ")}`);
	BERRY_GEOMETRY_FITS.set(id, actions);
}

/** Ajustes feitos por fitBerryGrowthGeometry (id do bloco → ações), para o relatório do import e os testes. */
export const BERRY_GEOMETRY_FITS = new Map<string, string[]>();

const HORIZONTAL = ["north", "south", "east", "west"];
const SIX =["down", "up", "north", "south", "east", "west"];

const q = (state: string) => `q.block_state('${state}')`;
const eqS = (state: string, v: StateValue) => (typeof v === "boolean" ? (v ? q(state) : `!${q(state)}`) : typeof v === "number" ? `${q(state)} == ${v}` : `${q(state)} == '${v}'`);
/** `facing` horizontal do Java → minecraft:cardinal_direction (as permutações usam a variante facing=f do Java). */
const FACING_DEF: StateDef = { name: "minecraft:cardinal_direction", values: ["north", "south", "east", "west"], cond: (v) => eqS("minecraft:cardinal_direction", v) };

interface BlockstateJson {
	variants?: Record<string, VariantJson | VariantJson[]>;
	multipart?: Array<{ when?: any; apply: VariantJson | VariantJson[] }>;
}
interface VariantJson {
	model: string;
	x?: number;
	y?: number;
	uvlock?: boolean;
}

function loadBlockstate(id: string): BlockstateJson | undefined {
	const file = `${ASSETS}/blockstates/${id}.json`;
	return existsSync(file) ? readJson(file) : undefined;
}

/** Propriedades e valores (texto) do blockstate. */
function blockstateProps(bs: BlockstateJson): Map<string, Set<string>> {
	const props = new Map<string, Set<string>>();
	const add = (p: string, v: string) => {
		const set = props.get(p) ?? new Set<string>();
		for (const x of String(v).toLowerCase().split("|")) set.add(x);
		props.set(p, set);
	};
	for (const key of Object.keys(bs.variants ?? {})) {
		if (!key) continue;
		for (const kv of key.split(",")) {
			const [p, v] = kv.split("=");
			add(p, v);
		}
	}
	const walkWhen = (w: any) => {
		if (!w || typeof w !== "object") return;
		if (Array.isArray(w.OR)) w.OR.forEach(walkWhen);
		else if (Array.isArray(w.AND)) w.AND.forEach(walkWhen);
		else for (const [p, v] of Object.entries(w)) add(p, String(v));
	};
	for (const part of bs.multipart ?? []) walkWhen(part.when);
	return props;
}

const firstVariant = (v: VariantJson | VariantJson[]): VariantJson => (Array.isArray(v) ? v[0] : v);

/** Configuração por bloco: como mapear cada propriedade do Java. */
interface Mapping {
	/** Nome do estado Bedrock por propriedade Java (default "cobblemon:<prop>"). */
	rename: Record<string, string>;
	/** Propriedades descartadas. */
	drop: Set<string>;
	/** "look" = facing do Java é o sentido do olhar; "front" = oposto (padrão). */
	facingSemantics: "look" | "front";
	/** Facing de 6 direções: "face" (face clicada, minecraft:block_face) ou "look" (facing_direction). */
	facing6: "face" | "look";
	extraStates: Record<string, StateValue[]>;
	/** Cercas/muros: lados pelo trait minecraft:connection. */
	connections?: boolean;
}

function defaultMapping(): Mapping {
	return { rename: {}, drop: new Set(["waterlogged"]), facingSemantics: "front", facing6: "face", extraStates: {} };
}

interface Built {
	description: Record<string, unknown>;
	components: Record<string, unknown>;
	permutations: Array<{ condition: string; components: Record<string, unknown> }>;
	stateDefs: Map<string, StateDef>;
	/** format_version do bloco (padrão BLOCK_FORMAT). */
	format?: string;
}

const SOUND_MAP: Record<string, string> = {
	WOOD: "wood", STONE: "stone", GRASS: "grass", METAL: "metal", GLASS: "glass", WOOL: "cloth", DEEPSLATE: "deepslate",
	CANDLE: "candle", CROP: "grass", NETHER_ORE: "nether_gold_ore", DRIPSTONE_BLOCK: "dripstone_block", AMETHYST: "amethyst_block",
	AMETHYST_CLUSTER: "amethyst_cluster", COPPER: "copper", DECORATED_POT: "decorated_pot", MOSS: "moss_block", AZALEA_LEAVES: "azalea_leaves",
	SWEET_BERRY_BUSH: "sweet_berry_bush", BERRY_BUSH_SOUNDS: "sweet_berry_bush", TUMBLESTONE_SOUNDS: "amethyst_cluster", TUMBLESTONE_BLOCK_SOUNDS: "stone",
	TYPE_GEM_BLOCK_SOUNDS: "amethyst_block", TYPE_GEM_CLUSTER_SOUNDS: "amethyst_cluster", HANGING_SIGN: "wood", VINE: "vines",
};

const PLANT_SOIL = ["minecraft:grass_block", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:podzol", "minecraft:dirt_with_roots", "minecraft:moss_block", "minecraft:mycelium", "minecraft:farmland", "minecraft:mud", "minecraft:muddy_mangrove_roots"];

export class BlockBuilder {
	textures = new TerrainTextures();
	geometries = new GeometryEmitter();
	registered = registeredComponents();
	out = new Map<string, BlockOut>();
	private soundEntries: Record<string, { sound: string }> = {};
	private blockTags = new Map<string, Set<string>>();
	private lang = new Set<string>();
	emittedBlocks: string[] = [];

	private mapItem: ItemIdMapper;

	constructor(mapItem: ItemIdMapper) {
		this.mapItem = mapItem;
		this.loadBlockTags();
		const en = readJson(`${ASSETS}/lang/en_us.json`);
		for (const k of Object.keys(en)) this.lang.add(k);
	}

	/** Tags de bloco do Cobblemon (data/cobblemon/tags/block) viram "tag:cobblemon:<tag>". */
	private loadBlockTags(): void {
		const base = `${DATA}/cobblemon/tags/block/`;
		const files = walk(base, (n) => n.endsWith(".json"));
		const resolve = (tag: string, stack: string[] = []): string[] => {
			const file = `${DATA}/${splitId(tag).ns}/tags/block/${splitId(tag).path}.json`;
			if (!existsSync(file) || stack.includes(tag)) return [];
			return (readJson(file).values ?? []).flatMap((v: any) => {
				const id = typeof v === "string" ? v : v?.id;
				if (typeof id !== "string") return [];
				return id.startsWith("#") ? resolve(id.slice(1), [...stack, tag]) : [id];
			});
		};
		for (const f of files) {
			const tag = `cobblemon:${f.slice(base.length, -5)}`;
			for (const id of resolve(tag)) {
				if (!id.startsWith("cobblemon:")) continue;
				const set = this.blockTags.get(id) ?? new Set<string>();
				set.add(tag);
				this.blockTags.set(id, set);
			}
		}
	}

	private ktItems = new Set(loadKotlinItems().map((i) => i.id));

	private ownItem(id: string): boolean {
		return this.ktItems.has(id) && !itemIconTexture(id).texture;
	}

	private displayName(id: string, fallbackItem?: string): string {
		const { path } = splitId(id);
		for (const k of [`block.cobblemon.${path}`, fallbackItem ? `item.cobblemon.${fallbackItem}` : "", `item.cobblemon.${path}`]) if (k && this.lang.has(k)) return k;
		return `block.cobblemon.${path}`;
	}

	/** Todos os blocos. */
	buildAll(): void {
		const { blocks } = loadKotlinBlocks();
		for (const kt of blocks) {
			try {
				this.buildOne(kt);
			} catch (e) {
				warn("bloco não gerado (erro)", `${kt.id}: ${(e as Error).message}`);
			}
		}
		writeJson(`${OUT_RP}/blocks.json`, { format_version: [1, 1, 0], ...this.soundEntries });
		count("blocos (Bedrock)", this.emittedBlocks.length);
		count("blocos do Cobblemon cobertos", this.out.size);
	}

	private buildOne(kt: KtBlock): void {
		const id = kt.id;
		const cls = kt.cls;
		const bs = loadBlockstate(id);
		if (/Sign/.test(cls)) {
			// Placas custom (texto editável) não existem no Bedrock: só o item.
			warn("bloco sem equivalente no Bedrock (pulado)", `${id} (${cls})`);
			return;
		}
		if (!bs) {
			warn("bloco sem blockstate (pulado)", id);
			return;
		}
		// Casos de compatibilidade com scripts/ e estruturas existentes.
		if (id === "pc") return this.buildPC(kt, bs);
		if (id === "healing_machine") return this.buildHealingMachine(kt, bs);
		if (cls === "DoorBlock") return this.buildDoor(kt, bs);
		if (cls === "ApricornBlock") return this.buildApricorn(kt, bs);

		const m = defaultMapping();
		const components: Record<string, unknown> = {};
		const bid = `cobblemon:${id}`;
		let hasOwnItem: boolean;
		const wood = id.startsWith("apricorn") ? "apricorn" : id.startsWith("saccharine") ? "saccharine" : undefined;
		switch (cls) {
			case "SlabBlock":
				m.rename.type = "@slab";
				components[id === "apricorn_slab" ? "cobblemon:apricorn_slab_component" : "cobblemon:slab_component"] = {};
				if (id !== "apricorn_slab") behaviour("cobblemon:slab_component", bid, "Laje: clicar com a mesma laje vira laje dupla (cobblemon:double) e quebrar dropa 1 ou 2; igual a SlabComponent usando o typeId do próprio bloco.", { "cobblemon:double": [false, true] });
				break;
			case "StairBlock":
				m.facingSemantics = "look";
				behaviour("cobblemon:stairs_shape", bid, "Escada: recalcular cobblemon:shape (straight/inner_*/outer_*) conforme as escadas vizinhas, como StairBlock do Java.", { "cobblemon:shape": ["straight", "inner_left", "inner_right", "outer_left", "outer_right"] });
				components["cobblemon:stairs_shape"] = {};
				break;
			case "TrapDoorBlock":
				m.rename.open = "cobblemon:opened";
				m.drop.add("powered");
				m.extraStates["cobblemon:activated_by_redstone"] = [false, true];
				components["cobblemon:door_component"] = {};
				break;
			case "FenceGateBlock":
				m.facingSemantics = "look";
				m.rename.open = "cobblemon:opened";
				m.drop.add("powered");
				m.extraStates["cobblemon:activated_by_redstone"] = [false, true];
				components["cobblemon:door_component"] = {};
				behaviour("cobblemon:fence_gate_in_wall", bid, "Portão: ligar cobblemon:in_wall quando estiver entre muros (modelo mais baixo), como FenceGateBlock do Java.", { "cobblemon:in_wall": [false, true] });
				components["cobblemon:fence_gate_in_wall"] = {};
				break;
			case "FenceBlock":
			case "WallBlock":
				// Conexões nativas (trait minecraft:connection, estável a partir do formato 1.26.0): os lados
				// north/east/south/west viram minecraft:connection_<lado>; o poste do muro fica sempre visível e
				// o lado "tall" do muro (sobre outro muro) usa o modelo baixo.
				m.connections = true;
				components["minecraft:connection_rule"] = { accepts_connections_from: cls === "FenceBlock" ? "only_fences" : "all", enabled_directions: ["north", "east", "south", "west"] };
				break;
			case "ButtonBlock":
			case "EjectButtonBlock":
				m.facingSemantics = "look";
				m.rename.powered = "cobblemon:pressed";
				components["cobblemon:button_component"] = {};
				break;
			case "PressurePlateBlock":
				m.rename.powered = "cobblemon:pressed";
				components["cobblemon:pressure_plate_component"] = {};
				components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["up"] }] };
				break;
			case "RotatedPillarBlock":
			case "SaccharineLogBlock":
			case "BaleBlock":
				m.rename.axis = "@axis";
				if (id === "apricorn_log") components["cobblemon:strip_apricorn_log"] = {};
				if (id === "apricorn_wood") components["cobblemon:strip_apricorn_wood"] = {};
				if (id === "saccharine_log" || id === "saccharine_wood") {
					const comp = `cobblemon:strip_${id}`;
					components[comp] = { stripped: `cobblemon:stripped_${id}` };
					behaviour(comp, bid, `Tora: machado transforma em cobblemon:stripped_${id} mantendo minecraft:facing_direction (como StripLogComponent).`);
				}
				break;
			case "LeavesBlock":
			case "SaccharineLeafBlock":
				m.extraStates["cobblemon:distance_from_log"] = [4, 3, 2, 1, 0];
				m.extraStates["cobblemon:decayable"] = [true, false];
				m.extraStates["cobblemon:opaque"] = [false, true];
				if (id === "apricorn_leaves") components["cobblemon:apricorn_leaves_component"] = {};
				else {
					components["cobblemon:leaves_decay"] = { loot_table: "empty" };
					behaviour("cobblemon:leaves_decay", bid, "Folhas: decaimento longe de toras (como LeavesDecayComponent, usando o typeId do bloco).", { "cobblemon:distance_from_log": [4, 3, 2, 1, 0], "cobblemon:decayable": [true, false] });
					if (cls === "SaccharineLeafBlock") {
						components["cobblemon:saccharine_leaves"] = {};
						behaviour("cobblemon:saccharine_leaves", bid, "Folhas de saccharine: cobblemon:age 0→2 (grudenta → pingando mel) por random tick; colher mel com garrafa volta a 0.", { "cobblemon:age": [0, 1, 2] });
					}
				}
				components["minecraft:tick"] = { interval_range: [10, 10], looping: true };
				components["tag:leaves"] = {};
				break;
			case "DropExperienceBlock":
				components["cobblemon:give_xp_reward_component"] = {};
				break;
			case "ApricornSaplingBlock": {
				const color = id.replace("_apricorn_sapling", "");
				m.extraStates["cobblemon:growth_state"] = [0, 1, 2, 3];
				components[`cobblemon:${color}_apricorn_seed_component`] = {};
				components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["up"], block_filter: PLANT_SOIL }] };
				break;
			}
			case "SaplingBlock":
				m.extraStates["cobblemon:growth_state"] = [0, 1];
				components["cobblemon:saccharine_sapling"] = {};
				behaviour("cobblemon:saccharine_sapling", bid, "Muda de saccharine: cresce (random tick/farinha de osso) e vira a árvore de saccharine (feature cobblemon:saccharine_tree).", { "cobblemon:growth_state": [0, 1] });
				components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["up"], block_filter: PLANT_SOIL }] };
				break;
			case "BerryBlock":
				behaviour("cobblemon:berry_bush", bid, "Arbusto de berry: crescimento cobblemon:age 0..5 por random tick (growthTime/refreshRate de ITEMS[berry].berry), colheita com quantidade baseYield, mutação com berries vizinhas (mutations), mulch (cobblemon:mulch) e raiz presa (cobblemon:rooted).");
				components["cobblemon:berry_bush"] = {};
				components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["up"], block_filter: PLANT_SOIL }] };
				m.extraStates["cobblemon:mulch"] = ["none"];
				break;
			case "PCBlock":
				break;
			case "FlowerPotBlock":
			case "FlowerBlock":
				if (cls === "FlowerBlock") components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["up"], block_filter: PLANT_SOIL }] };
				break;
			default:
				this.genericBehaviour(kt, bid, components, m);
		}
		// O bloco aparece como item próprio só quando o Java registra um item 3D com o mesmo id; ícones 2D
		// viram item custom com replace_block_item (items.ts) e os demais ficam escondidos.
		hasOwnItem = this.ownItem(id);
		if (wood && /^(FenceBlock|FenceGateBlock|SlabBlock|StairBlock|RotatedPillarBlock|Block|ButtonBlock|PressurePlateBlock|TrapDoorBlock)$/.test(cls)) components["minecraft:flammable"] = { catch_chance_modifier: 5, destroy_chance_modifier: 20 };
		const built = this.fromBlockstate(bid, kt, bs, m);
		if (cls === "BerryBlock") this.addBerryGrowthBones(id, built);
		Object.assign(built.components, components);
		if (m.connections) built.format = CONNECTION_FORMAT;
		if (IMMOVABLE_CLASSES.has(cls)) makeImmovable(built);
		this.finish(bid, kt, built, { hidden: !hasOwnItem });
		this.out.set(id, { javaId: id, placeBlock: bid, bedrockIds: [bid], hasOwnItem, cls });
	}

	/**
	 * BerryBlockRenderer: flores (idade 4) e frutos (idade 5) nos `growthPoints` da berry. No Java são desenhados por
	 * block entity renderer; aqui viram bones da geometria do arbusto (um por growth point, posições fixas) com
	 * `bone_visibility` pela idade e as texturas `flowerTexture`/`fruitTexture` como material instances.
	 * Idade 0 (muda): o modelo do fruto em `stageOnePositioning` (renderBabyToBuffer).
	 * Transformação exata do renderer: o modelo (hierarquia de bones do .geo, com as rotações próprias) é copiado
	 * sob um bone por ponto, com pivô no ponto e rotação [-x, -y, z] — equivale, no espaço do bloco do Bedrock (x
	 * espelhado), ao `setRotation(180 - x, 180 + y, z)` do ModelPart com o Y invertido do TexturedModel.
	 * Aproximação: todos os pontos aparecem (no Java só os que têm fruto sorteado).
	 */
	private addBerryGrowthBones(id: string, built: Built): void {
		const path = splitId(id).path;
		const berryFile = `${DATA}/cobblemon/berries/${path}.json`;
		const geometry = built.components["minecraft:geometry"] as { identifier: string; bone_visibility?: Record<string, string | boolean> } | undefined;
		if (!existsSync(berryFile) || !geometry || typeof geometry !== "object") return;
		const berry = readJson(berryFile);
		const points: Array<{ position: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } }> = berry.growthPoints ?? [];
		const ageCond = (age: number) => built.stateDefs.get("age")?.cond(String(age));
		const geoFile = (geoId: string) => `${OUT_RP}/models/blocks/cobblemon/${geoId.replace(/^geometry\.cobblemon\./, "")}.geo.json`;
		if (!points.length || !existsSync(geoFile(geometry.identifier))) return;
		type Point = { position: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number } };
		const stages: Array<{ kind: "flower" | "fruit" | "sprout"; model?: string; texture?: string; age: number; points: Point[] }> = [
			{ kind: "flower", model: berry.flowerModel, texture: berry.flowerTexture, age: 4, points },
			{ kind: "fruit", model: berry.fruitModel, texture: berry.fruitTexture, age: 5, points },
			{ kind: "sprout", model: berry.fruitModel, texture: berry.fruitTexture, age: 0, points: berry.stageOnePositioning ? [berry.stageOnePositioning] : [] },
		];
		const geo = readJson(geoFile(geometry.identifier));
		const bones: Array<Record<string, unknown>> = geo["minecraft:geometry"][0].bones;
		const materials = (built.components["minecraft:material_instances"] ?? {}) as Record<string, unknown>;
		const r4 = (n: number) => Math.round(n * 10000) / 10000;
		let added = 0;
		type Cube = { origin: number[]; size: number[]; uv: number[] | Record<string, { uv: number[]; uv_size: number[] }>; pivot?: number[]; rotation?: number[]; inflate?: number; mirror?: boolean };
		type Bone = { name: string; parent?: string; pivot?: number[]; rotation?: number[]; cubes?: Cube[]; mirror?: boolean };
		for (const stage of stages) {
			const cond = ageCond(stage.age);
			if (!stage.model || !stage.texture || !cond || !stage.points.length) continue;
			const modelFile = `${ASSETS}/bedrock/berries/${splitId(stage.model).path.replace(/\.geo$/, "")}.geo.json`;
			const tex = this.textures.get(`cobblemon:berries/${splitId(stage.texture).path}`);
			if (!existsSync(modelFile) || !tex) {
				warn("berry sem modelo/textura de flor ou fruto", `${id}: ${stage.model} ${stage.texture}`);
				continue;
			}
			const model = readJson(modelFile)["minecraft:geometry"]?.[0];
			const texW = model?.description?.texture_width ?? 16, texH = model?.description?.texture_height ?? 16;
			const su = 16 / texW, sv = 16 / texH;
			const instance = `berry_${stage.kind === "flower" ? "flower" : "fruit"}`;
			materials[instance] = { texture: tex.key, render_method: "alpha_test" };
			const cubeUv = (c: Cube) => Array.isArray(c.uv)
				? boxUvFaces(c.size, c.uv, su, sv, instance)
				: Object.fromEntries(Object.entries(c.uv).map(([f, x]) => [f, { uv: [r4(x.uv[0] * su), r4(x.uv[1] * sv)], uv_size: [r4(x.uv_size[0] * su), r4(x.uv_size[1] * sv)], material_instance: instance }]));
			const modelBones: Bone[] = model?.bones ?? [];
			// Um bone de grupo por estágio: o Bedrock limita o número de entradas de bone_visibility, então a
			// visibilidade pela idade fica só no grupo (e não em cada ponto de crescimento).
			const group = `berry_${stage.kind}`;
			bones.push({ name: group, pivot: [0, 0, 0] });
			(geometry.bone_visibility ??= {})[group] = cond;
			stage.points.forEach((point, i) => {
				// Espaço do bloco do Bedrock: x espelhado (8 - x), y igual, z - 8 (como GeometryEmitter.cube).
				const pivot = [r4(8 - point.position.x), r4(point.position.y), r4(point.position.z - 8)];
				const shift = (v: number[]) => [r4(pivot[0] + v[0]), r4(pivot[1] + v[1]), r4(pivot[2] + v[2])];
				const root: Record<string, unknown> = { name: `berry_${stage.kind}_${i}`, parent: group, pivot };
				const rot = point.rotation;
				if (rot && (rot.x || rot.y || rot.z)) root.rotation = [r4(-rot.x), r4(-rot.y), r4(rot.z)];
				bones.push(root);
				// Hierarquia do modelo copiada sob o bone do ponto (pivôs absolutos deslocados pelo ponto).
				for (const b of modelBones) {
					const name = `berry_${stage.kind}_${i}_${b.name}`;
					const copy: Record<string, unknown> = {
						name,
						parent: b.parent ? `berry_${stage.kind}_${i}_${b.parent}` : root.name,
						pivot: shift(b.pivot ?? [0, 0, 0]),
					};
					if (b.rotation && b.rotation.some((v) => v)) copy.rotation = b.rotation;
					if (b.cubes?.length) {
						copy.cubes = b.cubes.map((c) => {
							const cube: Record<string, unknown> = { origin: shift(c.origin), size: c.size, uv: cubeUv(c) };
							if (c.pivot) cube.pivot = shift(c.pivot);
							if (c.rotation && c.rotation.some((v) => v)) cube.rotation = c.rotation;
							if (c.inflate) cube.inflate = c.inflate;
							return cube;
						});
					}
					bones.push(copy); // visível/oculto junto com o bone de grupo do estágio
				}
				added++;
			});
		}
		if (!added) return;
		fitBerryGrowthGeometry(id, bones, berry.randomizedGrowthPoints === true);
		const newId = `geometry.cobblemon.${safeGeoName(path)}_growth`;
		geo["minecraft:geometry"][0].description.identifier = newId;
		writeJson(geoFile(newId), geo);
		geometry.identifier = newId;
		built.components["minecraft:material_instances"] = materials;
		count("berries com flor/fruto");
	}

	/** Comportamento por classe do Java (componentes novos para os scripts). */
	private genericBehaviour(kt: KtBlock, bid: string, components: Record<string, unknown>, m: Mapping): void {
		const map: Record<string, [string, string]> = {
			MintBlock: ["cobblemon:mint_crop", "Menta: cresce cobblemon:age 0..7 por random tick; madura dropa folhas de menta da cor; farinha de osso acelera."],
			VivichokeBlock: ["cobblemon:vivichoke_crop", "Vivichoke: cultivo cobblemon:age 0..7; maduro dropa vivichoke."],
			RevivalHerbBlock: ["cobblemon:revival_herb", "Revival herb: cultivo cobblemon:age 0..8 com chance de pep-up flower/mutação (cobblemon:mutation) por ervas vizinhas."],
			HeartyGrainsBlock: ["cobblemon:hearty_grains", "Hearty grains: cultivo de 2 blocos (cobblemon:half lower/upper) cobblemon:age 0..6; perto de água."],
			NutBushBlock: ["cobblemon:galarica_nut_bush", "Arbusto de galarica: cobblemon:age 0..3; maduro dá galarica nuts ao interagir."],
			MedicinalLeekBlock: ["cobblemon:medicinal_leek", "Medicinal leek: planta sobre a água, cobblemon:age 0..3; madura dropa medicinal leek."],
			EnergyRootBlock: ["cobblemon:energy_root", "Energy root: raiz pendurada sob terra; espalha para baixo e dropa energy root."],
			BigRootBlock: ["cobblemon:big_root", "Big root: raiz pendurada sob terra; com random tick pode virar energy root (como no Java)."],
			TumblestoneBlock: ["cobblemon:tumblestone", "Tumblestone: brotos crescem (small → medium → large → cluster) por random tick, como ametista."],
			TypeGemClusterBlock: ["cobblemon:type_gem_cluster", "Cluster de gema de tipo: cobblemon:stage 0..3 cresce por random tick; maduro dropa a gema."],
			TypeGemCoreBlock: ["cobblemon:type_gem_core", "Núcleo de cristal: gera clusters de gemas de tipo nos lados livres por random tick."],
			StackableItemBlock: ["cobblemon:stackable_item_block", "Item colocável empilhável: clicar com o mesmo item soma cobblemon:amount (até o máximo) e quebrar devolve todos."],
			WallAttachedStackableItemBlock: ["cobblemon:stackable_item_block", "Item colocável empilhável: clicar com o mesmo item soma cobblemon:amount (até o máximo) e quebrar devolve todos."],
			ActivatableDecorationBlock: ["cobblemon:activatable_decoration", "Decoração ativável (metronome): interagir alterna cobblemon:active."],
			CampfirePotBlock: ["cobblemon:campfire_pot", "Panela de fogueira: interface de cozinha (receitas de generated/scripts/recipes.ts COOKING_POT_RECIPES), cobblemon:open/cobblemon:occupied."],
			CampfireBlock: ["cobblemon:campfire", "Fogueira do Cobblemon: recebe a panela (item campfire_pot_*) e vira o bloco campfire_pot_<cor>."],
			PokeSnackBlock: ["cobblemon:poke_snack", "Poké Snack/Poké Cake: mordidas (cobblemon:bites) e atração de spawns (isca) enquanto existir."],
			GildedChestBlock: ["cobblemon:gilded_chest", "Baú dourado: inventário (Bedrock não tem container custom em bloco) e gimmighoul_chest vira Gimmighoul ao abrir."],
			MonitorBlock: ["cobblemon:fossil_monitor", "Monitor da máquina de fósseis: mostra o progresso (cobblemon:screen) do restoration tank abaixo."],
			DamagedMonitorBlock: ["cobblemon:fossil_monitor", "Monitor da máquina de fósseis: mostra o progresso (cobblemon:screen) do restoration tank abaixo."],
			FossilAnalyzerBlock: ["cobblemon:fossil_analyzer", "Analisador de fósseis: recebe fósseis (ITEMS[*].fossil) e forma a máquina com monitor + restoration tank."],
			RestorationTankBlock: ["cobblemon:restoration_tank", "Restoration tank (2 blocos, cobblemon:part): revive o fóssil analisado e libera o Pokémon (data/cobblemon/fossils)."],
			TMMachineBlock: ["cobblemon:tm_machine", "Máquina de TMs: grava TMs a partir de blank_tm + materiais."],
			DiscShelfBlock: ["cobblemon:disc_shelf", "Estante de discos (TMs)."],
			DisplayCaseBlock: ["cobblemon:display_case", "Vitrine: guarda e exibe um item (entidade/renderização por script)."],
			LecternBlock: ["cobblemon:lectern", "Atril do Cobblemon: recebe a Pokédex e abre a interface."],
			PastureBlock: ["cobblemon:pasture", "Pasto (2 blocos, cobblemon:part): soltar Pokémon do PC para passear em volta do bloco."],
			SaccharineLogSlatheredBlock: ["cobblemon:saccharine_log_slathered", "Tora de saccharine com mel: cobblemon:honey_type; colher mel/atrair Combee."],
			CoinPouchBlock: ["", ""],
			HabitatBlock: ["cobblemon:habitat_block", "Bloco de habitat (ferramenta de criativo do Cobblemon 1.8.2: habitat_pools, fases e tela de configuração)."],
		};
		const [name, desc] = map[kt.cls] ?? ["", ""];
		if (!name) return;
		components[name] = {};
		behaviour(name, bid, desc);
		if (["MintBlock", "VivichokeBlock", "RevivalHerbBlock", "HeartyGrainsBlock", "NutBushBlock"].includes(kt.cls)) components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["up"], block_filter: PLANT_SOIL }] };
		if (kt.cls === "EnergyRootBlock" || kt.cls === "BigRootBlock") components["minecraft:placement_filter"] = { conditions: [{ allowed_faces: ["down"] }] };
		if (kt.cls === "PastureBlock" || kt.cls === "RestorationTankBlock") behaviour(name, bid, desc, { "cobblemon:part": ["bottom", "top"] });
		if (kt.cls === "HabitatBlock") {
			// Pool do bloco colocado por estrutura (índice 1..63 de HABITAT_POOLS = hi × 16 + lo; 0 = config por
			// script) e o ticker do HabitatBlockEntity (fases, gatilhos) por scripts/spawning/Habitats.ts.
			m.extraStates["cobblemon:habitat_pool"] = Array.from({ length: 16 }, (_, i) => i);
			m.extraStates["cobblemon:habitat_pool_hi"] = [0, 1, 2, 3];
			// Frente habitat-mimic: bloco que a âncora imita (índice em HABITAT_ANCHOR_MIMICS[pool]); o script troca a
			// âncora por ele no 1º tick (scripts/machines/habitat.ts).
			m.extraStates["cobblemon:habitat_mimic"] = [0, 1, 2, 3];
			components["minecraft:tick"] = { interval_range: [10, 10], looping: true };
		}
	}

	/** Estados Bedrock a partir das propriedades do Java. */
	private stateDefs(bs: BlockstateJson, m: Mapping, traits: Record<string, unknown>, states: Record<string, unknown>): Map<string, StateDef> {
		const props = blockstateProps(bs);
		const defs = new Map<string, StateDef>();
		if (m.connections) {
			traits["minecraft:connection"] = { enabled_states: ["minecraft:cardinal_connections"] };
			for (const dir of ["north", "east", "south", "west"]) {
				const name = `minecraft:connection_${dir}`;
				defs.set(dir, { name, values: [false, true], cond: (v) => (v === "true" || v === "low" ? q(name) : v === "tall" ? "false" : `!${q(name)}`) });
			}
		}
		for (const [prop, rawValues] of props) {
			if (m.drop.has(prop) || defs.has(prop) || (m.connections && prop === "up")) continue;
			const values = [...rawValues];
			const rename = m.rename[prop];
			if (prop === "facing" && values.every((v) => HORIZONTAL.includes(v))) {
				const pd = (traits["minecraft:placement_direction"] ??= { enabled_states: [] }) as { enabled_states: string[]; y_rotation_offset?: number };
				if (!pd.enabled_states.includes("minecraft:cardinal_direction")) pd.enabled_states.push("minecraft:cardinal_direction");
				if (m.facingSemantics === "front") pd.y_rotation_offset = 180;
				defs.set(prop, { name: "minecraft:cardinal_direction", values: HORIZONTAL, cond: (v) => eqS("minecraft:cardinal_direction", v) });
				continue;
			}
			if (prop === "facing") {
				if (m.facing6 === "face") {
					const pp = (traits["minecraft:placement_position"] ??= { enabled_states: [] }) as { enabled_states: string[] };
					if (!pp.enabled_states.includes("minecraft:block_face")) pp.enabled_states.push("minecraft:block_face");
					defs.set(prop, { name: "minecraft:block_face", values: SIX, cond: (v) => eqS("minecraft:block_face", v) });
				} else {
					const pd = (traits["minecraft:placement_direction"] ??= { enabled_states: [] }) as { enabled_states: string[] };
					if (!pd.enabled_states.includes("minecraft:facing_direction")) pd.enabled_states.push("minecraft:facing_direction");
					defs.set(prop, { name: "minecraft:facing_direction", values: SIX, cond: (v) => eqS("minecraft:facing_direction", v) });
				}
				continue;
			}
			if (prop === "face" && props.has("facing")) {
				// Botões/placas: face (floor/wall/ceiling) + facing → block_face + cardinal_direction.
				const pp = (traits["minecraft:placement_position"] ??= { enabled_states: [] }) as { enabled_states: string[] };
				if (!pp.enabled_states.includes("minecraft:block_face")) pp.enabled_states.push("minecraft:block_face");
				defs.set(prop, { name: "minecraft:block_face", values: SIX, cond: (v) => (v === "floor" ? eqS("minecraft:block_face", "up") : v === "ceiling" ? eqS("minecraft:block_face", "down") : `(${["north", "south", "east", "west"].map((d) => eqS("minecraft:block_face", d)).join(" || ")})`) });
				continue;
			}
			if ((prop === "half" && values.every((v) => v === "top" || v === "bottom")) || rename === "@slab") {
				const pp = (traits["minecraft:placement_position"] ??= { enabled_states: [] }) as { enabled_states: string[] };
				if (!pp.enabled_states.includes("minecraft:vertical_half")) pp.enabled_states.push("minecraft:vertical_half");
				if (rename === "@slab") {
					states["cobblemon:double"] = [false, true];
					defs.set(prop, { name: "minecraft:vertical_half", values: ["bottom", "top"], cond: (v) => (v === "double" ? q("cobblemon:double") : `${eqS("minecraft:vertical_half", v)} && !${q("cobblemon:double")}`) });
				} else defs.set(prop, { name: "minecraft:vertical_half", values: ["bottom", "top"], cond: (v) => eqS("minecraft:vertical_half", v) });
				continue;
			}
			if (rename === "@axis") {
				const pd = (traits["minecraft:placement_direction"] ??= { enabled_states: [] }) as { enabled_states: string[] };
				if (!pd.enabled_states.includes("minecraft:facing_direction")) pd.enabled_states.push("minecraft:facing_direction");
				const byAxis: Record<string, string[]> = { y: ["up", "down"], x: ["east", "west"], z: ["north", "south"] };
				defs.set(prop, { name: "minecraft:facing_direction", values: SIX, cond: (v) => `(${byAxis[v].map((d) => eqS("minecraft:facing_direction", d)).join(" || ")})` });
				continue;
			}
			const name = rename ?? `cobblemon:${prop}`;
			let typed: StateValue[];
			if (values.every((v) => v === "true" || v === "false")) typed = [false, true];
			else if (values.every((v) => /^-?\d+$/.test(v))) typed = [...new Set(values.map(Number))].sort((a, b) => a - b);
			else typed = sortEnum(prop, values);
			// Muros: poste visível e lados "none" por padrão (sem script de conexão ainda).
			if (prop === "up") typed = [true, false];
			if (prop === "mulch") typed = ["none", ...typed.filter((v) => v !== "none")];
			if (["north", "east", "south", "west"].includes(prop) && !typed.every((v) => typeof v === "boolean")) typed = ["none", ...typed.filter((v) => v !== "none")];
			// O Bedrock aceita no máximo 16 valores por estado. Enum de texto maior (telas do monitor: 32) é dividido:
			// os 16 primeiros ficam em `name` e o resto em `name_2`, `name_3`... ("none" + até 15 cada). O valor vale
			// no estado de estouro; os do estado principal exigem os de estouro em "none". Scripts gravam pelo
			// mesmo esquema (scripts/machines/common.ts setState).
			const overflow: string[][] = [];
			if (typed.length > 16 && typeof typed[0] === "string") {
				const rest = typed.slice(16) as string[];
				for (let i = 0; i < rest.length; i += 15) overflow.push(rest.slice(i, i + 15));
				typed = typed.slice(0, 16);
				overflow.forEach((chunk, i) => { states[`${name}_${i + 2}`] = ["none", ...chunk]; });
			} else if (typed.length > 16) {
				warn("estado com mais de 16 valores (truncado)", `${name}: ${typed.length}`);
				typed = typed.slice(0, 16);
			}
			states[name] = typed;
			const isBool = typeof typed[0] === "boolean";
			const isNum = typeof typed[0] === "number";
			const noOverflow = overflow.map((_, i) => eqS(`${name}_${i + 2}`, "none"));
			defs.set(prop, {
				name,
				values: typed,
				cond: (v) => {
					if (isBool) return eqS(name, v === "true");
					if (isNum) return typed.includes(Number(v)) ? eqS(name, Number(v)) : "false";
					const chunk = overflow.findIndex((c) => c.includes(v));
					if (chunk >= 0) return eqS(`${name}_${chunk + 2}`, v);
					return typed.includes(v) ? [eqS(name, v), ...noOverflow].join(" && ") : "false";
				},
			});
		}
		for (const [name, values] of Object.entries(m.extraStates)) states[name] ??= values;
		return defs;
	}

	/** Blockstate → descrição + componentes + permutations. */
	private fromBlockstate(bid: string, kt: KtBlock, bs: BlockstateJson, m: Mapping): Built {
		const traits: Record<string, unknown> = {};
		const states: Record<string, unknown> = {};
		const defs = this.stateDefs(bs, m, traits, states);
		const components: Record<string, unknown> = {};
		const permutations: Built["permutations"] = [];
		const condOf = (key: Record<string, string>): string | undefined => {
			const parts: string[] = [];
			// Botões/placas na parede: a direção vem da face clicada (block_face), não do olhar do jogador.
			if (key.face === "wall" && key.facing && defs.get("face")?.name === "minecraft:block_face") {
				const rest = Object.fromEntries(Object.entries(key).filter(([p]) => p !== "face" && p !== "facing"));
				const other = condOf(rest);
				if (other === undefined) return undefined;
				return [eqS("minecraft:block_face", key.facing), ...(other === "true" ? [] : [other])].join(" && ");
			}
			for (const [p, v] of Object.entries(key)) {
				const d = defs.get(p);
				if (!d) continue;
				const c = d.cond(v);
				if (c === "false") return undefined;
				if (c) parts.push(c.includes("||") && !c.startsWith("(") ? `(${c})` : c);
			}
			return parts.length ? parts.join(" && ") : "true";
		};
		const shortName = splitId(bid).path;
		if (bs.variants) {
			const entries = Object.entries(bs.variants).map(([key, v]) => ({ key: parseKey(key), v: firstVariant(v) }));
			// Variante padrão: a que casa com os primeiros valores dos estados (padrão do Bedrock).
			const isDefault = (key: Record<string, string>) => Object.entries(key).every(([p, v]) => {
				const d = defs.get(p);
				if (!d) return true;
				const first = d.values[0];
				if (d.name === "minecraft:cardinal_direction" || d.name === "minecraft:block_face" || d.name === "minecraft:facing_direction" || d.name === "minecraft:vertical_half") return true;
				return String(first) === v;
			});
			const base = entries.find((e) => isDefault(e.key)) ?? entries[0];
			const groups = new Map<string, { comps: Record<string, unknown>; conds: string[] }>();
			let baseComps: Record<string, unknown> | undefined;
			for (const e of entries) {
				const comps = this.variantComponents(e.v, kt, shortName);
				if (!comps) continue;
				if (e === base) baseComps = comps;
				const cond = condOf(e.key);
				if (!cond) continue;
				const k = JSON.stringify(comps);
				const g = groups.get(k) ?? { comps, conds: [] };
				g.conds.push(cond);
				groups.set(k, g);
			}
			if (!baseComps) throw new Error("nenhuma variante com modelo");
			Object.assign(components, baseComps);
			if (groups.size > 1 || (groups.size === 1 && JSON.stringify([...groups.values()][0].comps) !== JSON.stringify(baseComps))) {
				for (const g of groups.values()) {
					const condition = g.conds.includes("true") ? "true" : g.conds.map((c) => (g.conds.length > 1 && c.includes("&&") ? `(${c})` : c)).join(" || ");
					permutations.push({ condition, components: g.comps });
				}
			}
		} else if (bs.multipart) {
			const parts: ModelPart[] = [];
			const visibility: Record<string, string | boolean> = {};
			const prefixes = new Map<string, string>();
			bs.multipart.forEach((p, i) => {
				const v = firstVariant(p.apply);
				const model = resolveModel(v.model);
				if (!model) {
					warn("modelo de bloco ausente", `${bid}: ${v.model}`);
					return;
				}
				let prefix = prefixes.get(model.id);
				if (!prefix) {
					prefix = `p${prefixes.size}_`;
					prefixes.set(model.id, prefix);
				}
				const bone = `part_${i}`;
				parts.push({ model, x: v.x, y: v.y, bone, prefix });
				const cond = p.when ? this.whenCond(p.when, defs) : "true";
				visibility[bone] = cond === "true" ? true : cond === "false" ? false : cond;
			});
			if (!parts.length) throw new Error("multipart sem modelos");
			const geo = this.geometries.convert(parts, shortName);
			components["minecraft:geometry"] = { identifier: geo.id, bone_visibility: visibility };
			components["minecraft:material_instances"] = this.materials(geo, kt);
			Object.assign(components, this.boxes(geo, kt));
		}
		const description: Record<string, unknown> = { identifier: bid };
		if (Object.keys(states).length) description.states = states;
		if (Object.keys(traits).length) description.traits = traits;
		return { description, components, permutations, stateDefs: defs };
	}

	private whenCond(when: any, defs: Map<string, StateDef>): string {
		if (Array.isArray(when.OR)) return when.OR.map((w: any) => `(${this.whenCond(w, defs)})`).join(" || ");
		if (Array.isArray(when.AND)) return when.AND.map((w: any) => `(${this.whenCond(w, defs)})`).join(" && ");
		const parts: string[] = [];
		for (const [p, v] of Object.entries(when)) {
			const d = defs.get(p);
			if (!d) continue;
			const alts = String(v).toLowerCase().split("|").map((x) => d.cond(x) ?? "true");
			parts.push(alts.length > 1 ? `(${alts.join(" || ")})` : alts[0]);
		}
		return parts.length ? parts.join(" && ") : "true";
	}

	/** Componentes visuais de uma variante (geometria, materiais, caixas). */
	private variantComponents(v: VariantJson, kt: KtBlock, name: string): Record<string, unknown> | undefined {
		const model = resolveModel(v.model);
		if (!model) {
			warn("modelo de bloco ausente", `${kt.id}: ${v.model}`);
			return undefined;
		}
		const geo = this.geometries.convert([{ model, x: v.x, y: v.y }]);
		void name;
		return { "minecraft:geometry": geo.id, "minecraft:material_instances": this.materials(geo, kt), ...this.boxes(geo, kt) };
	}

	private materials(geo: GeometryResult, kt: KtBlock): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		let first: Record<string, unknown> | undefined;
		const leaves = /Leave|Leaf/.test(kt.cls);
		for (const [inst, info] of Object.entries(geo.instances).sort()) {
			const tex = this.textures.get(info.texture);
			if (!tex) continue;
			const mat: Record<string, unknown> = { texture: tex.key, render_method: leaves || tex.alpha === "cutout" ? "alpha_test" : tex.alpha === "translucent" ? "blend" : "opaque" };
			if (!info.shade) mat.face_dimming = false;
			if (!info.ao) mat.ambient_occlusion = false;
			out[inst] = mat;
			first ??= mat;
		}
		if (!first) {
			// Sem textura resolvida: pedra vanilla como marcador visível.
			warn("bloco sem textura resolvida", kt.id);
			return { "*": { texture: this.textures.get("minecraft:block/stone")!.key, render_method: "opaque" } };
		}
		out["*"] = geo.full && out["north"] ? out["north"] : first;
		return out;
	}

	private boxes(geo: GeometryResult, kt: KtBlock): Record<string, unknown> {
		const comps: Record<string, unknown> = {};
		const b = geo.bounds;
		if (!b) {
			if (kt.noCollision) comps["minecraft:collision_box"] = false;
			return comps;
		}
		const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
		const from = [clamp(b.from[0], 0, 16), clamp(b.from[1], 0, 16), clamp(b.from[2], 0, 16)];
		const to = [clamp(b.to[0], 0, 16), clamp(b.to[1], 0, 16), clamp(b.to[2], 0, 16)];
		for (let i = 0; i < 3; i++) {
			if (to[i] - from[i] < 1) {
				const mid = (to[i] + from[i]) / 2;
				from[i] = clamp(mid - 0.5, 0, 15);
				to[i] = from[i] + 1;
			}
		}
		const r = (n: number) => Math.round(n * 100) / 100;
		const box = { origin: [r(from[0] - 8), r(from[1]), r(from[2] - 8)], size: [r(to[0] - from[0]), r(to[1] - from[1]), r(to[2] - from[2])] };
		comps["minecraft:selection_box"] = box;
		comps["minecraft:collision_box"] = kt.noCollision ? false : box;
		return comps;
	}

	/** Componentes comuns + tags + loot + gravação. */
	private finish(bid: string, kt: KtBlock, built: Built, opts: { hidden?: boolean; displayName?: string; lootPath?: string; noLoot?: boolean; category?: string }): void {
		const c = built.components;
		c["minecraft:display_name"] = opts.displayName ?? this.displayName(bid);
		const hardness = kt.instabreak ? 0 : kt.hardness ?? 1;
		c["minecraft:destructible_by_mining"] = { seconds_to_destroy: Math.round(hardness * 1.5 * 100) / 100 };
		c["minecraft:destructible_by_explosion"] = { explosion_resistance: kt.resistance ?? hardness };
		const light = kt.light ?? 0;
		if (light > 0) c["minecraft:light_emission"] = Math.min(15, light);
		const full = c["minecraft:geometry"] === "minecraft:geometry.full_block";
		const opaque = Object.values((c["minecraft:material_instances"] ?? {}) as Record<string, { render_method?: string }>).every((mi) => mi.render_method === "opaque");
		if (!full || kt.noOcclusion || !opaque) c["minecraft:light_dampening"] = 0;
		for (const tag of this.blockTags.get(bid) ?? []) c[`tag:${tag.replace(/\//g, "_")}`] = {};
		if (/Log|Pillar/.test(kt.cls) && /log|wood/.test(bid)) {
			c["tag:log"] = {};
			c["tag:wood"] = {};
			c["tag:minecraft:logs"] = {};
		}
		if (/DropExperienceBlock|TumblestoneBlock|TypeGem/.test(kt.cls) || /tumblestone|stone_block|gem_block/.test(bid)) c["tag:stone"] = {};
		// Loot.
		if (!opts.noLoot) this.applyLoot(bid, kt, built, opts);
		// Categoria no inventário criativo.
		const desc = built.description;
		desc.menu_category = opts.hidden ? { category: "none", is_hidden_in_commands: false } : { category: opts.category ?? categoryOf(kt) };
		this.stateMaps.set(bid, { defs: built.stateDefs, states: (desc.states ?? {}) as Record<string, unknown>, traits: (desc.traits ?? {}) as Record<string, { enabled_states?: string[] }> });
		this.emit(bid, built, kt);
	}

	/** Estados Java → Bedrock de cada bloco gerado (usado pelas estruturas convertidas). */
	readonly stateMaps = new Map<string, { defs: Map<string, StateDef>; states: Record<string, unknown>; traits?: Record<string, { enabled_states?: string[] }> }>();

	/**
	 * Bloco Bedrock + estados para um estado de bloco do Cobblemon no Java (paleta de um molde .nbt). Estados não
	 * informados ficam no padrão (1º valor). Undefined se o bloco não foi gerado.
	 */
	bedrockStateFor(javaId: string, props: Record<string, string> = {}): { name: string; states: Record<string, StateValue> } | undefined {
		const out = this.out.get(splitId(javaId).path);
		if (!out) return undefined;
		// Duas metades (porta: half=upper; PC: part=top): a de cima é outro bloco. Antes as portas saíam com duas metades
		// de baixo empilhadas e o componente que exige a de cima removia a porta (docs/pendencias/vilas.md).
		const name = out.upper && props[out.upper.prop] === out.upper.value ? out.upper.block : out.placeBlock;
		if (!this.emittedBlocks.includes(name)) return undefined;
		const info = this.stateMaps.get(name);
		const states: Record<string, StateValue> = {};
		for (const [k, v] of Object.entries(info?.states ?? {})) {
			if (Array.isArray(v) && v.length) states[k] = v[0] as StateValue;
			else if (v && typeof v === "object" && "values" in (v as object)) states[k] = Number((v as { values: { min: number } }).values.min);
		}
		// Estados dos traits (a paleta do .mcstructure precisa de todos os estados do bloco).
		const TRAIT_DEFAULTS: Record<string, Record<string, StateValue>> = {
			"minecraft:cardinal_direction": { "minecraft:cardinal_direction": "south" },
			"minecraft:facing_direction": { "minecraft:facing_direction": "down" },
			"minecraft:block_face": { "minecraft:block_face": "down" },
			"minecraft:vertical_half": { "minecraft:vertical_half": "bottom" },
			"minecraft:cardinal_connections": { "minecraft:connection_north": false, "minecraft:connection_east": false, "minecraft:connection_south": false, "minecraft:connection_west": false },
		};
		for (const trait of Object.values(info?.traits ?? {})) for (const enabled of trait.enabled_states ?? []) Object.assign(states, TRAIT_DEFAULTS[enabled] ?? {});
		for (const [prop, value] of Object.entries(props)) {
			const d = info?.defs.get(prop);
			if (!d || prop === "waterlogged") continue;
			if (d.toBedrock) {
				const v = d.toBedrock(value);
				if (v !== undefined) states[d.name] = v;
			} else if (d.name === "minecraft:cardinal_direction") {
				if (HORIZONTAL.includes(value)) states[d.name] = value;
			} else if (d.name === "minecraft:facing_direction") {
				states[d.name] = ({ x: "east", y: "up", z: "north" } as Record<string, string>)[value] ?? value;
			} else if (d.name === "minecraft:block_face") {
				states[d.name] = prop === "face" ? (value === "floor" ? "up" : value === "ceiling" ? "down" : props.facing ?? "north") : value;
			} else if (d.name === "minecraft:vertical_half") {
				if (value === "double") {
					states["cobblemon:double"] = true;
					states[d.name] = "bottom";
				} else states[d.name] = value;
			} else if (d.name.startsWith("minecraft:connection_")) {
				continue;
			} else if (typeof d.values[0] === "boolean") {
				states[d.name] = value === "true";
			} else if (typeof d.values[0] === "number") {
				if (d.values.includes(Number(value))) states[d.name] = Number(value);
			} else if (d.values.includes(value)) {
				states[d.name] = value;
			} else {
				// Enum dividido em estados de estouro (<nome>_2, _3...): o valor fica no estado que o contém.
				for (const [k, list] of Object.entries(info?.states ?? {})) {
					if (k.startsWith(`${d.name}_`) && Array.isArray(list) && list.includes(value)) states[k] = value;
				}
			}
		}
		return { name, states };
	}

	private applyLoot(bid: string, kt: KtBlock, built: Built, opts: { lootPath?: string }): void {
		const table = javaBlockLoot(kt.id);
		const c = built.components;
		if (!table) {
			c["minecraft:loot"] = EMPTY_LOOT;
			return;
		}
		const props = lootStateProps(table);
		const shortId = splitId(bid).path;
		if (!props.length) {
			c["minecraft:loot"] = emitLoot(opts.lootPath ?? `blocks/${shortId}`, convertLoot(table, {}, this.mapItem), !!opts.lootPath);
			return;
		}
		// Uma tabela por combinação dos estados usados nas condições.
		const bs = loadBlockstate(kt.id);
		const values = new Map<string, string[]>();
		const bsProps = bs ? blockstateProps(bs) : new Map<string, Set<string>>();
		for (const p of props) values.set(p, [...(bsProps.get(p) ?? LOOT_PROP_VALUES[p] ?? [])]);
		const combos: Assignment[] = [{}];
		for (const [p, vs] of values) {
			const next: Assignment[] = [];
			for (const cmb of combos) for (const v of vs.length ? vs : ["?"]) next.push({ ...cmb, [p]: v });
			combos.splice(0, combos.length, ...next);
		}
		const byPath = new Map<string, Assignment[]>();
		for (const a of combos) {
			const loot = convertLoot(table, a, this.mapItem);
			const suffix = Object.entries(a).map(([k, v]) => `${k}_${v}`).join("_");
			const path = emitLoot(`blocks/${shortId}__${suffix}`, loot);
			const list = byPath.get(path) ?? [];
			list.push(a);
			byPath.set(path, list);
		}
		if (byPath.size === 1) {
			c["minecraft:loot"] = [...byPath.keys()][0];
			return;
		}
		// Padrão = combinação do estado padrão; demais por permutation.
		const condFor = (a: Assignment): string | undefined => {
			const parts: string[] = [];
			for (const [p, v] of Object.entries(a)) {
				const d = built.stateDefs.get(p);
				if (!d) return undefined;
				const cc = d.cond(v);
				if (!cc || cc === "false") return undefined;
				parts.push(cc.includes("||") && !cc.startsWith("(") ? `(${cc})` : cc);
			}
			return parts.join(" && ");
		};
		let first = true;
		for (const [path, list] of byPath) {
			if (first) {
				c["minecraft:loot"] = path;
				first = false;
				continue;
			}
			const conds = list.map(condFor).filter((x): x is string => !!x);
			if (!conds.length) continue;
			built.permutations.push({ condition: conds.map((x) => (conds.length > 1 ? `(${x})` : x)).join(" || "), components: { "minecraft:loot": path } });
		}
	}

	private emit(bid: string, built: Built, kt: KtBlock): void {
		// Custom components V2 não registrados fazem o Bedrock rejeitar o bloco inteiro ("child not valid
		// here"): só entram no JSON os já registrados em scripts/custom_components/index.ts; os demais ficam
		// listados em blockBehaviours.ts e passam a ser anexados no próximo import depois de registrados.
		const strip = (comps: Record<string, unknown>) => {
			for (const k of Object.keys(comps)) {
				if (!k.startsWith("cobblemon:") || this.registered.has(k)) continue;
				const params = comps[k];
				const def = BLOCK_BEHAVIOURS.get(k);
				if (def && params && typeof params === "object" && Object.keys(params).length) (def.params ??= {})[bid] = params;
				delete comps[k];
			}
		};
		strip(built.components);
		for (const p of built.permutations) strip(p.components);
		// Frente motor: waterlogging das classes que o Java deixa alagar.
		if (waterloggableClasses().has(kt.cls)) built.components["minecraft:liquid_detection"] = LIQUID_DETECTION;
		built.permutations = built.permutations.filter((p) => Object.keys(p.components).length);
		// Todas as material instances de um bloco precisam do mesmo render_method.
		const mats = [built.components, ...built.permutations.map((p) => p.components)].flatMap((c) => Object.values((c["minecraft:material_instances"] ?? {}) as Record<string, { render_method?: string }>));
		const rank = ["opaque", "alpha_test", "blend"];
		const method = mats.reduce((m, x) => (rank.indexOf(x.render_method ?? "opaque") > rank.indexOf(m) ? x.render_method! : m), "opaque");
		for (const m of mats) m.render_method = method;
		const block: Record<string, unknown> = { description: built.description, components: built.components };
		if (built.permutations.length) block.permutations = built.permutations;
		const { path } = splitId(bid);
		writeJson(`${OUT_BP}/blocks/cobblemon/${path}.json`, { format_version: built.format ?? BLOCK_FORMAT, "minecraft:block": block });
		this.soundEntries[bid] = { sound: SOUND_MAP[kt.sound ?? ""] ?? (kt.sound ? "stone" : "stone") };
		this.emittedBlocks.push(bid);
		// Estados: limite de permutações do Bedrock (produto dos valores).
		let product = 1;
		for (const v of Object.values((built.description.states ?? {}) as Record<string, unknown[]>)) product *= Array.isArray(v) ? v.length : 16;
		if (product > 65536) warn("bloco com combinações de estados demais", `${bid}: ${product}`);
	}

	// -----------------------------------------------------------------------------------------
	// Compatibilidade com scripts/ e estruturas existentes

	private buildPC(kt: KtBlock, bs: BlockstateJson): void {
		const variants = bs.variants ?? {};
		const pick = (part: string, on: string, facing: string) => firstVariant(variants[`facing=${facing},part=${part},on=${on}`]);
		const rotPerms = (part: string, on: string, extra = "") => HORIZONTAL.map((f) => {
			const comps = this.variantComponents(pick(part, on, f), kt, "pc")!;
			return { condition: `${eqS("minecraft:cardinal_direction", f)}${extra}`, components: comps };
		});
		const traits = { "minecraft:placement_direction": { enabled_states: ["minecraft:cardinal_direction"], y_rotation_offset: 180 } };
		// Base (parte de baixo): cobblemon:pc.
		const bottom: Built = { description: { identifier: "cobblemon:pc", traits }, components: {}, permutations: rotPerms("bottom", "false"), stateDefs: new Map([["facing", FACING_DEF]]) };
		Object.assign(bottom.components, bottom.permutations[0].components, {
			"minecraft:tick": { interval_range: [10, 10], looping: true },
			"cobblemon:pc_bottom_component": {},
			"cobblemon:enforce_pc_top_half_component": {},
		});
		makeImmovable(bottom);
		this.finish("cobblemon:pc", kt, bottom, { displayName: "block.cobblemon.pc", noLoot: true });
		bottom.components["minecraft:loot"] = emitLoot("blocks/pc", convertLoot(javaBlockLoot("pc"), { part: "bottom" }, this.mapItem));
		this.rewrite("cobblemon:pc", bottom, kt);
		// Topo: cobblemon:pc_top (cobblemon:user_count > 0 = ligado).
		const top: Built = {
			description: { identifier: "cobblemon:pc_top", states: { "cobblemon:user_count": { values: { min: 0, max: 15 } } }, traits },
			components: {},
			permutations: [...rotPerms("top", "false", ` && ${q("cobblemon:user_count")} == 0`), ...rotPerms("top", "true", ` && ${q("cobblemon:user_count")} > 0`)],
			stateDefs: new Map([["facing", FACING_DEF]]),
		};
		top.permutations.push({ condition: `${q("cobblemon:user_count")} > 0`, components: { "minecraft:light_emission": 13 } });
		Object.assign(top.components, top.permutations[0].components, {
			"minecraft:tick": { interval_range: [10, 10], looping: true },
			"cobblemon:pc_top_component": {},
			"cobblemon:enforce_pc_bottom_half_component": {},
		});
		makeImmovable(top);
		this.finish("cobblemon:pc_top", kt, top, { displayName: "block.cobblemon.pc", hidden: true, noLoot: true });
		top.components["minecraft:loot"] = EMPTY_LOOT;
		this.rewrite("cobblemon:pc_top", top, kt);
		this.out.set("pc", { javaId: "pc", placeBlock: "cobblemon:pc", bedrockIds: ["cobblemon:pc", "cobblemon:pc_top"], hasOwnItem: true, cls: kt.cls, upper: { prop: "part", value: "top", block: "cobblemon:pc_top" } });
	}

	/** Regrava um bloco depois de ajustes pós-finish. */
	private rewrite(bid: string, built: Built, kt: KtBlock): void {
		this.emittedBlocks.splice(this.emittedBlocks.indexOf(bid), 1);
		this.emit(bid, built, kt);
	}

	private buildHealingMachine(kt: KtBlock, bs: BlockstateJson): void {
		const variants = bs.variants ?? {};
		const model = (charge: number, facing: string, natural = false) => firstVariant(variants[`facing=${facing},natural=${natural},charge=${charge}`]);
		// cobblemon:charge vai de 0 a 15 nos scripts; os 6 modelos do Java cobrem as faixas abaixo.
		const ranges: Array<[string, number]> = [
			[`${q("cobblemon:charge")} <= 1`, 0],
			[`${q("cobblemon:charge")} > 1 && ${q("cobblemon:charge")} <= 4`, 1],
			[`${q("cobblemon:charge")} > 4 && ${q("cobblemon:charge")} <= 7`, 2],
			[`${q("cobblemon:charge")} > 7 && ${q("cobblemon:charge")} <= 10`, 3],
			[`${q("cobblemon:charge")} > 10 && ${q("cobblemon:charge")} <= 13`, 4],
			[`${q("cobblemon:charge")} > 13`, 5],
		];
		const perms: Built["permutations"] = [];
		// Frente visual-final (#143): estado `natural` do Java (máquinas de estruturas: modelos healing_machine_limited_1..5
		// e drop de 1–4 barras de ferro pela loot natural=true).
		const natural = q("cobblemon:natural");
		for (const f of HORIZONTAL) {
			for (const [cond, charge] of ranges) {
				const v = model(charge, f);
				if (!v) continue;
				const lim = model(charge, f, true);
				const differs = !!lim && lim.model !== v.model;
				perms.push({ condition: `${eqS("minecraft:cardinal_direction", f)} && ${cond} && !${q("cobblemon:active")}${differs ? ` && !${natural}` : ""}`, components: this.variantComponents(v, kt, "healing_machine")! });
				if (differs) perms.push({ condition: `${eqS("minecraft:cardinal_direction", f)} && ${cond} && !${q("cobblemon:active")} && ${natural}`, components: this.variantComponents(lim!, kt, "healing_machine")! });
			}
			const active = resolveModel("cobblemon:block/healing_machine_active") ? { model: "cobblemon:block/healing_machine_active", y: model(0, f)?.y } : undefined;
			if (active) perms.push({ condition: `${eqS("minecraft:cardinal_direction", f)} && ${q("cobblemon:active")}`, components: this.variantComponents(active, kt, "healing_machine")! });
		}
		perms.push({ condition: `${q("cobblemon:charge")} > 13`, components: { "minecraft:light_emission": 12 } });
		const built: Built = {
			description: {
				identifier: "cobblemon:healing_machine",
				states: { "cobblemon:charge": { values: { min: 0, max: 15 } }, "cobblemon:active": [false, true], "cobblemon:busy": [false, true], "cobblemon:natural": [false, true] },
				traits: { "minecraft:placement_direction": { enabled_states: ["minecraft:cardinal_direction"], y_rotation_offset: 180 } },
			},
			components: { ...perms[0].components, "minecraft:light_emission": 5, "cobblemon:healing_machine_component": {} },
			permutations: perms,
			// `natural` liga a loot por estado (applyLoot) e o bedrockStateFor das estruturas.
			stateDefs: new Map<string, StateDef>([
				["natural", { name: "cobblemon:natural", values: [false, true], cond: (v: string) => (v === "true" ? natural : `!${natural}`) }],
				// Estruturas: a direção do molde (antes ficava sempre "south") e o medidor (Java 0..5 → 0..15, 6 = infinita).
				["facing", FACING_DEF],
				["charge", { name: "cobblemon:charge", values: [0, 15], cond: () => undefined, toBedrock: (v) => (/^\d+$/.test(v) ? Math.min(15, Number(v) * 3) : undefined) }],
			]),
		};
		makeImmovable(built);
		this.finish("cobblemon:healing_machine", { ...kt, light: 5 }, built, { displayName: "block.cobblemon.healing_machine" });
		this.out.set("healing_machine", { javaId: "healing_machine", placeBlock: "cobblemon:healing_machine", bedrockIds: ["cobblemon:healing_machine"], hasOwnItem: true, cls: kt.cls });
	}

	private buildDoor(kt: KtBlock, bs: BlockstateJson): void {
		const wood = kt.id.replace("_door", "");
		const variants = bs.variants ?? {};
		const ids = { bottom: `cobblemon:${wood}_door_bottom_left`, top: `cobblemon:${wood}_door_top_left` };
		const comps = {
			bottom: wood === "apricorn" ? "cobblemon:apricorn_door_enforce_top_component" : `cobblemon:${wood}_door_enforce_top_component`,
			top: wood === "apricorn" ? "cobblemon:apricorn_door_enforce_bottom_component" : `cobblemon:${wood}_door_enforce_bottom_component`,
		};
		if (wood !== "apricorn") {
			behaviour(comps.bottom, ids.bottom, `Porta (metade de baixo): igual a EnforceTopHalfComponent("${ids.top}", "minecraft:cardinal_direction", "cobblemon:opened").`);
			behaviour(comps.top, ids.top, `Porta (metade de cima): igual a EnforceBottomHalfComponent("${ids.bottom}", "minecraft:cardinal_direction", "cobblemon:opened").`);
		}
		for (const half of ["lower", "upper"] as const) {
			const bid = half === "lower" ? ids.bottom : ids.top;
			const perms: Built["permutations"] = [];
			for (const f of HORIZONTAL) for (const open of [false, true]) {
				const v = firstVariant(variants[`facing=${f},half=${half},hinge=left,open=${open}`]);
				if (!v) continue;
				perms.push({ condition: `${eqS("minecraft:cardinal_direction", f)} && ${eqS("cobblemon:opened", open)}`, components: this.variantComponents(v, kt, `${wood}_door`)! });
			}
			const built: Built = {
				description: {
					identifier: bid,
					states: { "cobblemon:opened": [false, true], "cobblemon:activated_by_redstone": [false, true] },
					traits: { "minecraft:placement_direction": { enabled_states: ["minecraft:cardinal_direction"] } },
				},
				components: {
					...perms[0].components,
					"minecraft:tick": { interval_range: [10, 10], looping: true },
					"cobblemon:door_component": {},
					[half === "lower" ? comps.bottom : comps.top]: {},
					...(half === "lower" ? { "cobblemon:cannot_float_component": {}, "minecraft:placement_filter": { conditions: [{ allowed_faces: ["up"] }] } } : {}),
				},
				permutations: perms,
				// Estados das estruturas (bedrockStateFor). `hinge` não existe no Bedrock (só a porta _left): a porta de
				// dobradiça direita sai com a da esquerda (fechada ocupa o mesmo lugar; muda o lado da maçaneta).
				stateDefs: new Map<string, StateDef>([
					["facing", FACING_DEF],
					["open", { name: "cobblemon:opened", values: [false, true], cond: (v) => eqS("cobblemon:opened", v === "true") }],
				]),
			};
			this.finish(bid, kt, built, { displayName: `block.cobblemon.${kt.id}`, hidden: true, noLoot: true });
			built.components["minecraft:loot"] = half === "lower" ? emitLoot(`blocks/${wood}_door`, convertLoot(javaBlockLoot(kt.id), { half: "lower" }, this.mapItem), wood === "apricorn") : EMPTY_LOOT;
			this.rewrite(bid, built, kt);
		}
		this.out.set(kt.id, { javaId: kt.id, placeBlock: ids.bottom, bedrockIds: [ids.bottom, ids.top], hasOwnItem: false, cls: kt.cls, upper: { prop: "half", value: "upper", block: ids.top } });
	}

	/** Apricorn na árvore: ids "<cor>_apricorn_block" (+ "_generated" das estruturas), estado growth_state. */
	private buildApricorn(kt: KtBlock, bs: BlockstateJson): void {
		const color = kt.id.replace("_apricorn", "");
		const variants = bs.variants ?? {};
		const table = javaBlockLoot(kt.id);
		const ripe = emitLoot(`blocks/apricorns/${kt.id}`, convertLoot(table, { age: "3" }, this.mapItem), true);
		for (const generated of [false, true]) {
			const bid = `cobblemon:${color}_apricorn_block${generated ? "_generated" : ""}`;
			const perms: Built["permutations"] = [];
			for (const f of HORIZONTAL) for (let age = 0; age <= 3; age++) {
				const v = firstVariant(variants[`age=${age},facing=${f}`]);
				if (!v) continue;
				perms.push({ condition: `${eqS("minecraft:cardinal_direction", f)} && ${eqS("cobblemon:growth_state", age)}`, components: this.variantComponents(v, kt, "apricorn")! });
			}
			perms.push({ condition: eqS("cobblemon:growth_state", 3), components: { "minecraft:loot": ripe } });
			const states: Record<string, unknown> = { "cobblemon:growth_state": [0, 1, 2, 3] };
			if (generated) states["cobblemon:needs_generation"] = [true, false];
			const built: Built = {
				description: { identifier: bid, states, traits: { "minecraft:placement_direction": { enabled_states: ["minecraft:cardinal_direction"] } } },
				components: {
					...perms[0].components,
					"minecraft:placement_filter": { conditions: [{ allowed_faces: ["side"], block_filter: ["cobblemon:apricorn_leaves"] }] },
					[`cobblemon:${color}_apricorn_growth_component`]: {},
					...(generated ? { "cobblemon:apricorn_generated_component": {} } : {}),
				},
				permutations: perms,
				stateDefs: new Map<string, StateDef>([
					["facing", FACING_DEF],
					["age", { name: "cobblemon:growth_state", values: [0, 1, 2, 3], cond: (v) => eqS("cobblemon:growth_state", Number(v)) }],
				]),
			};
			this.finish(bid, kt, built, { displayName: `item.cobblemon.${kt.id}`, hidden: true, noLoot: true });
			built.components["minecraft:loot"] = EMPTY_LOOT;
			this.rewrite(bid, built, kt);
		}
		this.out.set(kt.id, { javaId: kt.id, placeBlock: `cobblemon:${color}_apricorn_block`, bedrockIds: [`cobblemon:${color}_apricorn_block`, `cobblemon:${color}_apricorn_block_generated`], hasOwnItem: false, cls: kt.cls });
	}
}

/** generated/scripts/blockBehaviours.ts: componentes de bloco que os scripts precisam implementar. */
export function emitBlockBehaviours(registered: Set<string>): number {
	const entries = [...BLOCK_BEHAVIOURS].filter(([k]) => !registered.has(k)).sort(([a], [b]) => a.localeCompare(b));
	const lines = entries.map(([k, v]) => `\t${JSON.stringify(k)}: ${JSON.stringify({ blocks: [...v.blocks].sort(), description: v.description, states: v.states, ...(v.params ? { params: v.params } : {}) })},`);
	writeText(
		`${OUT_SCRIPTS}/blockBehaviours.ts`,
		`// Arquivo gerado por tools/importer (npm run import). Não edite à mão.
/* eslint-disable */

export interface BlockBehaviour {
	/** Blocos (Bedrock) que usam o componente. */
	blocks: string[];
	description: string;
	/** Estados do bloco que o comportamento lê/escreve (além dos já declarados nos blocos). */
	states: Record<string, unknown[]>;
	/** Parâmetros por bloco que o componente deve receber quando for anexado ao JSON. */
	params?: Record<string, unknown>;
}

/**
 * Custom components de bloco (V2) que os blocos gerados precisam e que ainda não estão registrados em
 * scripts/custom_components/index.ts. O Bedrock rejeita o bloco inteiro quando o JSON usa um componente
 * não registrado, então o importador só anexa cada um depois que ele for registrado (rodar
 * \`npm run import\` de novo); "params" traz os parâmetros que irão no JSON de cada bloco.
 */
export const BLOCK_COMPONENTS: Record<string, BlockBehaviour> = {
${lines.join("\n")}
};
`,
	);
	return entries.length;
}

/** Valores de propriedades usadas em loot mas ausentes do blockstate. */
const LOOT_PROP_VALUES: Record<string, string[]> = {
	half: ["lower", "upper"],
	type: ["bottom", "top", "double"],
	part: ["bottom", "top"],
};

function parseKey(key: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!key) return out;
	for (const kv of key.split(",")) {
		const [p, v] = kv.split("=");
		out[p] = v.toLowerCase();
	}
	return out;
}

const ENUM_ORDER: Record<string, string[]> = {
	shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
	half: ["lower", "upper", "bottom", "top"],
	part: ["bottom", "top"],
	screen: ["off"],
	mutation: ["none"],
	face: ["floor", "wall", "ceiling"],
	hinge: ["left", "right"],
};

function sortEnum(prop: string, values: string[]): string[] {
	const pref = ENUM_ORDER[prop] ?? [];
	return [...values].sort((a, b) => {
		const ia = pref.indexOf(a);
		const ib = pref.indexOf(b);
		if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		return a.localeCompare(b);
	});
}

function categoryOf(kt: KtBlock): string {
	if (/Berry|Mint|Sapling|Leaf|Leaves|Crop|Herb|Root|Leek|Grains|NutBush|Flower|Apricorn|DropExperience|Tumblestone|TypeGem|Vivichoke/.test(kt.cls)) return "nature";
	if (/Slab|Stair|Wall|Fence|Door|TrapDoor|Button|PressurePlate|Pillar|Bale|HorizontalRotation/.test(kt.cls) || kt.cls === "Block") return "construction";
	return "items";
}

