/**
 * Frente msd-fase1: propriedade `cobblemon:gimmick` de todas as entidades de Pokémon (docs/pesquisa/9-extensao-mega-showdown.md
 * §5.1 item 3). Lógica pura, sem API do Minecraft: o importador (tools/importer/entities.ts) lê as mesmas tabelas para
 * gerar a propriedade e o Molang (tinta e escala), então script e pack nunca divergem.
 *
 * Valores: 0 = nenhum; 1..19 = Terastal pelo tipo (ordem de TERA_GIMMICK_TYPES; 19 = Stellar); 20 = Dynamax;
 * 21 = Gigantamax.
 */

export const GIMMICK_PROPERTY = "cobblemon:gimmick";
export const GIMMICK_NONE = 0;
/** Tipos Tera na ordem dos valores 1..19 (os 18 do ElementalType do Cobblemon + Stellar). */
export const TERA_GIMMICK_TYPES = [
	"normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug",
	"rock", "ghost", "dragon", "dark", "steel", "fairy", "stellar",
] as const;
export const GIMMICK_DYNAMAX = 20;
export const GIMMICK_GIGANTAMAX = 21;
/** Maior valor da propriedade (faixa [0, GIMMICK_MAX]). */
export const GIMMICK_MAX = GIMMICK_GIGANTAMAX;

/** Escala visual do Dynamax (MegaShowdownConfig.dynamaxScaleFactor = 4, em 60 ticks: MaxGimmick.java). */
export const DYNAMAX_SCALE_FACTOR = 4;
export const DYNAMAX_GROW_SECONDS = 3;

/** Valor da propriedade para um tipo Tera (0 se o tipo não existe). */
export function teraGimmickValue(type: string | undefined): number {
	const index = TERA_GIMMICK_TYPES.indexOf(String(type ?? "").toLowerCase() as (typeof TERA_GIMMICK_TYPES)[number]);
	return index < 0 ? GIMMICK_NONE : index + 1;
}

/** Valor da propriedade para o estado de batalha do Pokémon. Dynamax vence Tera (o MSD não deixa os dois juntos). */
export function gimmickValue(state: { tera?: string; dynamax?: boolean; gigantamax?: boolean }): number {
	if (state.dynamax) return state.gigantamax ? GIMMICK_GIGANTAMAX : GIMMICK_DYNAMAX;
	return teraGimmickValue(state.tera);
}

/** Tinta aproximada (overlay_color): cor 0xRRGGBB e alfa. Sem shader no Bedrock (pesquisa 9 §4.4). */
export interface GimmickTint { rgb: number; alpha: number }

/** Stellar não tem cor de tipo no Cobblemon: branco azulado do cristal. */
export const STELLAR_TINT = 0xc8f0ff;
/** Brilho vermelho do Dynamax (GlowHandler do MSD, time de scoreboard vermelho). */
export const DYNAMAX_TINT = 0xff2040;
export const TERA_TINT_ALPHA = 0.35;
export const DYNAMAX_TINT_ALPHA = 0.3;

/**
 * Tinta de cada valor 1..21. `hues` = ElementalType.hue por tipo (scripts/GUI/layoutSpec.ts TYPE_HUES), passado por
 * quem chama para este arquivo não importar nada.
 */
export function gimmickTints(hues: Record<string, number>): Map<number, GimmickTint> {
	const out = new Map<number, GimmickTint>();
	TERA_GIMMICK_TYPES.forEach((type, i) => out.set(i + 1, { rgb: hues[type] ?? STELLAR_TINT, alpha: TERA_TINT_ALPHA }));
	out.set(GIMMICK_DYNAMAX, { rgb: DYNAMAX_TINT, alpha: DYNAMAX_TINT_ALPHA });
	out.set(GIMMICK_GIGANTAMAX, { rgb: DYNAMAX_TINT, alpha: DYNAMAX_TINT_ALPHA });
	return out;
}
