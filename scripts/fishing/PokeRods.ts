/**
 * Poké Rods do Cobblemon 1.8.2 (data/cobblemon/pokerods/*.json, api/fishing/PokeRod.kt): cada vara usa uma
 * Poké Ball como boia e tem uma cor de linha. O id da vara (item) é o `rodType` das condições de pesca.
 *
 * A ordem de BOBBER_BALLS é a do array de texturas do render controller da boia
 * (resource_packs/CobblemonBedrock/render_controllers/fishing/poke_bobber.render_controllers.json):
 * não reordene sem atualizar o render controller.
 */

/** Bolas das boias, na ordem da propriedade `cobblemon:ball` (0..47). As 16 últimas usam a geometria ancient. */
export const BOBBER_BALLS = [
  "poke_ball", "great_ball", "ultra_ball", "master_ball", "safari_ball", "fast_ball", "level_ball", "lure_ball",
  "heavy_ball", "love_ball", "friend_ball", "moon_ball", "sport_ball", "park_ball", "net_ball", "dive_ball",
  "nest_ball", "repeat_ball", "timer_ball", "luxury_ball", "premier_ball", "dusk_ball", "heal_ball", "quick_ball",
  "dream_ball", "beast_ball", "cherish_ball", "azure_ball", "citrine_ball", "roseate_ball", "slate_ball", "verdant_ball",
  "ancient_poke_ball", "ancient_great_ball", "ancient_ultra_ball", "ancient_heavy_ball", "ancient_feather_ball",
  "ancient_wing_ball", "ancient_jet_ball", "ancient_leaden_ball", "ancient_gigaton_ball", "ancient_azure_ball",
  "ancient_citrine_ball", "ancient_roseate_ball", "ancient_slate_ball", "ancient_verdant_ball", "ancient_ivory_ball",
  "ancient_origin_ball",
] as const;

/** Índice da primeira bola ancient (geometria geometry.ancient_poke_ball). */
export const FIRST_ANCIENT_BALL = 32;

export interface PokeRodData {
  /** Id da vara (= item), ex.: "cobblemon:poke_rod". */
  id: string;
  /** Poké Ball da boia, ex.: "cobblemon:poke_ball". */
  pokeBallId: string;
  /** Cor da linha (hex "#RRGGBB"). */
  lineColor: string;
}

/** Cores de linha diferentes do padrão #282828 (pokerods/*.json). */
const LINE_COLORS: Record<string, string> = {
  beast_rod: "#72C5FF",
  cherish_rod: "#000000",
  dusk_rod: "#B92929",
  heal_rod: "#569ee6",
  luxury_rod: "#D1CDD1",
  master_rod: "#D1CDD1",
  premier_rod: "#b92929",
};

/** As 48 varas do 1.8.2: `<bola sem _ball>_rod` (poke_ball → poke_rod, ancient_poke_ball → ancient_poke_rod). */
export const POKE_RODS: Record<string, PokeRodData> = Object.fromEntries(BOBBER_BALLS.map(ball => {
  const rod = ball.replace(/_ball$/, "_rod");
  return [`cobblemon:${rod}`, { id: `cobblemon:${rod}`, pokeBallId: `cobblemon:${ball}`, lineColor: LINE_COLORS[rod] ?? "#282828" }];
}));

/** PokeRods.getPokeRod (aceita com ou sem namespace). */
export function getPokeRod(itemId: string | undefined): PokeRodData | undefined {
  if (!itemId) return undefined;
  return POKE_RODS[itemId.includes(":") ? itemId : `cobblemon:${itemId}`];
}

export function isPokeRod(itemId: string | undefined): boolean {
  return getPokeRod(itemId) !== undefined;
}

/** Valor da propriedade `cobblemon:ball` da boia para a vara (0 = Poké Ball). */
export function bobberBallIndex(itemId: string | undefined): number {
  const rod = getPokeRod(itemId);
  if (!rod) return 0;
  const index = (BOBBER_BALLS as readonly string[]).indexOf(rod.pokeBallId.replace(/^cobblemon:/, ""));
  return index < 0 ? 0 : index;
}

/** "#RRGGBB" → RGB 0–1 (v.color_r/g/b da partícula fishing_line). */
export function lineColorRGB(hex: string): { red: number; green: number; blue: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x282828;
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
