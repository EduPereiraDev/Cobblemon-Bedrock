/**
 * Glifos do port (ícones inline em chat, actionbar, títulos e texto de forms/botões).
 *
 * O Bedrock desenha o code point U+XXYY a partir de `font/glyph_XX.png` (grade 16×16). A página E0 é da Mojang
 * (ícones de controle); o port usava uma cópia dela com os tipos acrescentados, o que escondia atualizações da vanilla.
 * Agora os ícones ficam em páginas só nossas (E2 e E3, livres na vanilla), geradas pelo importador
 * (`tools/importer/guiTextures.ts`) a partir das texturas de GUI do Cobblemon.
 *
 * Este arquivo não importa nada: o importador lê `GLYPH_SOURCES` daqui para montar as páginas, então código e PNG
 * nunca divergem. Glifos não aparecem em telas Ore UI (DDUI `CustomForm`/`MessageBox`).
 */

/** Tipos na ordem do `types.png` do Cobblemon (colunas de 36 px). */
export const GLYPH_TYPES = [
  "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
] as const;

/** Categorias na ordem do `categories.png` (linhas de 16 px). */
export const GLYPH_CATEGORIES = ["Physical", "Special", "Status"] as const;

/** Poké Balls com ícone em `gui/ball/` (48; ordem alfabética, estável). */
export const GLYPH_BALLS = [
  "ancient_azure_ball", "ancient_citrine_ball", "ancient_feather_ball", "ancient_gigaton_ball", "ancient_great_ball",
  "ancient_heavy_ball", "ancient_ivory_ball", "ancient_jet_ball", "ancient_leaden_ball", "ancient_origin_ball",
  "ancient_poke_ball", "ancient_roseate_ball", "ancient_slate_ball", "ancient_ultra_ball", "ancient_verdant_ball",
  "ancient_wing_ball", "azure_ball", "beast_ball", "cherish_ball", "citrine_ball", "dive_ball", "dream_ball", "dusk_ball",
  "fast_ball", "friend_ball", "great_ball", "heal_ball", "heavy_ball", "level_ball", "love_ball", "lure_ball",
  "luxury_ball", "master_ball", "moon_ball", "nest_ball", "net_ball", "park_ball", "poke_ball", "premier_ball",
  "quick_ball", "repeat_ball", "roseate_ball", "safari_ball", "slate_ball", "sport_ball", "timer_ball", "ultra_ball",
  "verdant_ball",
] as const;

/** Página E2: tipos (E200–E211), categorias (E212–E214), gênero, brilhante e "capturado". */
export const GLYPH_PAGE_ICONS = 0xe2;
/** Página E3: Poké Balls (E300–E32F). */
export const GLYPH_PAGE_BALLS = 0xe3;

const TYPE_BASE = 0xe200;
const CATEGORY_BASE = 0xe212;
export const GLYPH_MALE = String.fromCharCode(0xe215);
export const GLYPH_FEMALE = String.fromCharCode(0xe216);
export const GLYPH_SHINY = String.fromCharCode(0xe217);
export const GLYPH_OWNED = String.fromCharCode(0xe218);
const BALL_BASE = 0xe300;

/** Origem de cada glifo, para o importador: arquivo em `assets/cobblemon/textures/gui/` e recorte opcional. */
export interface GlyphSource {
  code: number;
  file: string;
  /** [x, y, largura, altura] em px da textura original. */
  crop?: [number, number, number, number];
}

export function glyphSources(): GlyphSource[] {
  const out: GlyphSource[] = [];
  GLYPH_TYPES.forEach((_, i) => out.push({ code: TYPE_BASE + i, file: "types.png", crop: [i * 36, 0, 36, 36] }));
  GLYPH_CATEGORIES.forEach((_, i) => out.push({ code: CATEGORY_BASE + i, file: "categories.png", crop: [0, i * 16, 24, 16] }));
  out.push({ code: 0xe215, file: "party/party_gender_male.png" });
  out.push({ code: 0xe216, file: "party/party_gender_female.png" });
  out.push({ code: 0xe217, file: "summary/icon_shiny.png" });
  out.push({ code: 0xe218, file: "battle/battle_owned_indicator.png" });
  // Ícone da bola: 18×44, a metade de cima (22 px) é o estado normal.
  GLYPH_BALLS.forEach((ball, i) => out.push({ code: BALL_BASE + i, file: `ball/${ball}.png`, crop: [0, 0, 18, 22] }));
  return out;
}

/** Glifo do tipo (id em minúsculas, "fire"); "" se desconhecido. */
export function typeGlyph(type: string): string {
  const i = (GLYPH_TYPES as readonly string[]).indexOf(type.toLowerCase());
  return i < 0 ? "" : String.fromCharCode(TYPE_BASE + i);
}

/** Glifo da categoria do golpe ("Physical" | "Special" | "Status"); "" se desconhecida. */
export function categoryGlyph(category: string): string {
  const i = (GLYPH_CATEGORIES as readonly string[]).findIndex(x => x.toLowerCase() === category.toLowerCase());
  return i < 0 ? "" : String.fromCharCode(CATEGORY_BASE + i);
}

/** Glifo da Poké Ball ("cobblemon:poke_ball" ou "poke_ball"); "" se não houver ícone. */
export function ballGlyph(ball: string): string {
  const id = ball.includes(":") ? ball.slice(ball.indexOf(":") + 1) : ball;
  const i = (GLYPH_BALLS as readonly string[]).indexOf(id);
  return i < 0 ? "" : String.fromCharCode(BALL_BASE + i);
}

/** Mapa tipo → glifo (compatível com a antiga tabela `typeSymbols`). */
export const TYPE_GLYPHS: Record<string, string> = Object.fromEntries(GLYPH_TYPES.map(type => [type, typeGlyph(type)]));

/** Mapa categoria → glifo (compatível com as antigas `moveCategorySymbols`/`categorySymbols`). */
export const CATEGORY_GLYPHS: Record<string, string> = Object.fromEntries(GLYPH_CATEGORIES.map(c => [c, categoryGlyph(c)]));
