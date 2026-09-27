/**
 * Estruturas vanilla como condição de spawn (pesquisa 8, §11), lógica pura. A Script API estável não diz se um
 * ponto está numa estrutura vanilla (`Dimension.getGeneratedStructures` é beta). Aproximação: cada estrutura tem
 * uma "assinatura" de blocos que só aparecem nela (no bioma/dimensão em que ela nasce). Um chunk referencia a
 * estrutura (como `startsForStructure(ChunkPos)` do Java) se todos os grupos da assinatura aparecem no volume do
 * chunk (+ margem). O teste é feito sob demanda, uma vez por chunk e estrutura, e o resultado positivo vai para o
 * registro de estruturas (scripts/world/StructureRegistry.ts).
 */
export interface StructureSignature {
  /** Id principal do Java (o que as condições usam). */
  id: string;
  /** Outros ids registrados junto (ex.: minecraft:woodland_mansion, variantes do portal em ruínas). */
  aliases?: string[];
  dimension: "minecraft:overworld" | "minecraft:nether" | "minecraft:the_end";
  /** Bioma (id sem namespace) onde a estrutura nasce; ausente = qualquer. */
  biome?: RegExp;
  /** Bioma onde NÃO testar (evita confundir estruturas parecidas). */
  notBiome?: RegExp;
  /**
   * Estrutura de superfície: o bioma é lido no topo da coluna (os biomas do Bedrock são 3D; um ponto dentro do
   * terreno pode cair numa caverna, ex.: dripstone_caves embaixo da mansão).
   */
  surfaceBiome?: boolean;
  /** E de OUs: cada lista precisa de pelo menos um bloco no volume. */
  all: string[][];
  /** Blocos somados ao chunk em x/z. */
  margin: number;
  /** Faixa vertical: absoluta (`absY`) ou relativa ao y consultado (`below`/`above`). */
  absY?: [number, number];
  below?: number;
  above?: number;
  /** Assinatura fraca (documentada), só para constar no relatório da sonda. */
  weak?: boolean;
}

const OCEAN = /ocean/;

export const STRUCTURE_SIGNATURES: readonly StructureSignature[] = [
  {
    // Monumento: prismarinho trabalhado + lanterna do mar; nada disso é natural no oceano.
    id: "minecraft:monument", dimension: "minecraft:overworld", biome: OCEAN,
    all: [["minecraft:prismarine_bricks", "minecraft:dark_prismarine", "minecraft:prismarine"], ["minecraft:sea_lantern"]],
    margin: 0, absY: [30, 64],
  },
  {
    // Cabana da bruxa: caldeirão + vaso + bancada no pântano.
    id: "minecraft:swamp_hut", dimension: "minecraft:overworld", biome: /^swampland/, surfaceBiome: true,
    all: [["minecraft:cauldron"], ["minecraft:flower_pot"], ["minecraft:crafting_table"]],
    margin: 4, below: 12, above: 16,
  },
  {
    // Iglu: bloco de neve + tapete branco em bioma nevado.
    id: "minecraft:igloo", dimension: "minecraft:overworld", biome: /^(ice_plains|cold_taiga|frozen|snowy)/, surfaceBiome: true,
    all: [["minecraft:snow"], ["minecraft:white_carpet"]],
    margin: 4, below: 12, above: 12,
  },
  {
    // Mansão: tábuas de carvalho escuro + pedregulho + vidraças na floresta escura (no Bedrock também no pale garden).
    id: "minecraft:mansion", aliases: ["minecraft:woodland_mansion"], dimension: "minecraft:overworld", biome: /^(roofed_forest|pale_garden)/, surfaceBiome: true,
    all: [["minecraft:dark_oak_planks"], ["minecraft:cobblestone"], ["minecraft:glass_pane"]],
    margin: 0, below: 16, above: 32,
  },
  {
    // Posto avançado: troncos de carvalho escuro + tábuas de bétula + pedregulho (fora dos biomas da mansão).
    id: "minecraft:pillager_outpost", dimension: "minecraft:overworld", notBiome: /^(roofed_forest|pale_garden)/, surfaceBiome: true,
    all: [["minecraft:dark_oak_log"], ["minecraft:birch_planks"], ["minecraft:cobblestone"]],
    margin: 4, below: 8, above: 28,
  },
  {
    // Ruínas de trilha: cascalho suspeito + tijolos de lama.
    id: "minecraft:trail_ruins", dimension: "minecraft:overworld",
    all: [["minecraft:suspicious_gravel"], ["minecraft:mud_bricks"]],
    margin: 4, below: 16, above: 16,
  },
  {
    // Ruína oceânica fria: tijolos de pedra no fundo do oceano.
    id: "minecraft:ocean_ruin_cold", dimension: "minecraft:overworld", biome: OCEAN,
    all: [["minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:cracked_stone_bricks", "minecraft:chiseled_stone_bricks"]],
    margin: 4, absY: [20, 62],
  },
  {
    // Ruína oceânica morna: arenito cortado/lavrado/liso no fundo do oceano (o arenito comum é natural).
    id: "minecraft:ocean_ruin_warm", dimension: "minecraft:overworld", biome: OCEAN,
    all: [["minecraft:cut_sandstone", "minecraft:chiseled_sandstone", "minecraft:smooth_sandstone"]],
    margin: 4, absY: [20, 62],
  },
  {
    // Portal em ruínas: obsidiana + netherrack no mundo normal (netherrack não é natural fora do Nether).
    id: "minecraft:ruined_portal",
    aliases: ["minecraft:ruined_portal_desert", "minecraft:ruined_portal_jungle", "minecraft:ruined_portal_swamp", "minecraft:ruined_portal_mountain", "minecraft:ruined_portal_ocean"],
    dimension: "minecraft:overworld",
    all: [["minecraft:obsidian", "minecraft:crying_obsidian"], ["minecraft:netherrack"]],
    margin: 4, below: 16, above: 16,
  },
  {
    // Cidade ancestral: tijolos/ladrilhos de ardósia no deep dark.
    id: "minecraft:ancient_city", dimension: "minecraft:overworld", biome: /^deep_dark/,
    all: [["minecraft:deepslate_bricks", "minecraft:deepslate_tiles", "minecraft:cracked_deepslate_bricks", "minecraft:cracked_deepslate_tiles", "minecraft:reinforced_deepslate"]],
    margin: 0, absY: [-64, -16],
  },
  {
    // Cidade do End: purpur + tijolos de pedra do End.
    id: "minecraft:end_city", dimension: "minecraft:the_end",
    all: [["minecraft:purpur_block", "minecraft:purpur_pillar"], ["minecraft:end_bricks"]],
    margin: 0, below: 32, above: 48,
  },
  {
    // Fortaleza do Nether: tijolos + cerca de tijolos do Nether.
    id: "minecraft:fortress", dimension: "minecraft:nether",
    all: [["minecraft:nether_brick"], ["minecraft:nether_brick_fence"]],
    margin: 0, below: 24, above: 24,
  },
  {
    // Bastião: tijolos de pedra-negra polida / pedra-negra dourada.
    id: "minecraft:bastion_remnant", dimension: "minecraft:nether",
    all: [["minecraft:polished_blackstone_bricks", "minecraft:cracked_polished_blackstone_bricks", "minecraft:gilded_blackstone", "minecraft:chiseled_polished_blackstone"]],
    margin: 0, below: 24, above: 32,
  },
  {
    // Fóssil do Nether: blocos de osso no vale das almas.
    id: "minecraft:nether_fossil", dimension: "minecraft:nether", biome: /^soulsand_valley|^soul_sand_valley/,
    all: [["minecraft:bone_block"]],
    margin: 4, below: 16, above: 16,
  },
];

/** Tags vanilla de estrutura que as condições do Cobblemon usam (#minecraft:...). */
export const VANILLA_STRUCTURE_TAGS: Readonly<Record<string, readonly string[]>> = {
  "minecraft:ocean_ruin": ["minecraft:ocean_ruin_cold", "minecraft:ocean_ruin_warm"],
  "minecraft:ruined_portal": ["minecraft:ruined_portal", "minecraft:ruined_portal_desert", "minecraft:ruined_portal_jungle", "minecraft:ruined_portal_swamp", "minecraft:ruined_portal_mountain", "minecraft:ruined_portal_ocean", "minecraft:ruined_portal_nether"],
  "minecraft:shipwreck": ["minecraft:shipwreck", "minecraft:shipwreck_beached"],
};

/** Assinatura de um id (principal ou apelido). */
export function signatureFor(id: string): StructureSignature | undefined {
  return STRUCTURE_SIGNATURES.find(s => s.id === id || s.aliases?.includes(id));
}

/** Todos os ids detectáveis (principais + apelidos). */
export function signatureIds(): string[] {
  return STRUCTURE_SIGNATURES.flatMap(s => [s.id, ...(s.aliases ?? [])]);
}

/** A assinatura vale neste bioma (id com ou sem namespace)? */
export function biomeAllows(sig: StructureSignature, biomeId: string | undefined): boolean {
  const b = (biomeId ?? "").replace(/^minecraft:/, "");
  if (sig.biome && !sig.biome.test(b)) return false;
  if (sig.notBiome && sig.notBiome.test(b)) return false;
  return true;
}

export interface Box3 { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }

/** Volume testado para o chunk (cx, cz) e o y consultado, dentro dos limites da dimensão. */
export function signatureVolume(sig: StructureSignature, cx: number, cz: number, y: number, minY = -64, maxY = 319): Box3 {
  const [y0, y1] = sig.absY ?? [Math.floor(y) - (sig.below ?? 16), Math.floor(y) + (sig.above ?? 16)];
  return {
    min: { x: cx * 16 - sig.margin, y: Math.max(minY, Math.min(y0, y1)), z: cz * 16 - sig.margin },
    max: { x: cx * 16 + 15 + sig.margin, y: Math.min(maxY, Math.max(y0, y1)), z: cz * 16 + 15 + sig.margin },
  };
}

/** Todos os grupos presentes? `has(list)` = algum bloco da lista existe no volume. */
export function signatureMatches(sig: StructureSignature, has: (blocks: string[]) => boolean): boolean {
  return sig.all.every(list => list.length > 0 && has(list));
}
