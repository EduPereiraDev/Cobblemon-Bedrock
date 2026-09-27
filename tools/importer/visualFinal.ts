// Frente visual-final: partícula `alpha_eyes` nos olhos dos Pokémon com o aspect `alpha_eyes`.
//
// No Cobblemon (AspectParticleMap + PokemonClientDelegate.spawnAspectParticle), a cada tick do cliente, para cada
// Pokémon a até 16 blocos com o aspect `alpha_eyes`: 25 % de chance de `q.particle('cobblemon:alpha_eyes', <locator>)`
// em cada locator visível cujo nome contém "eye" (LocatorResolvers.containing("eye")). A partícula é presa ao
// locator (emitter_local_space) e acompanha o olho.
//
// No Bedrock o cliente só sabe o `cobblemon:variant`; quase todas as espécies têm a camada emissiva `alpha_eyes`
// (resolvers), então "a variante tem a camada alpha_eyes" = "o Pokémon tem o aspect". Cada geometria com locators
// de olho ganha uma animação em loop de 1 s com a partícula em cada olho a cada 0,2 s (5 por segundo por olho, a
// média do Java: 0,25 × 20 ticks), ligada só nas variantes com a camada e aquela geometria.
import { OUT_RP, count, writeJson } from "./util.ts";
import { particleIndex } from "./particles.ts";
import type { SizeEntry } from "./entities.ts";

/** Partícula do Cobblemon (AspectParticleMap). */
export const ALPHA_EYES_PARTICLE = "cobblemon:alpha_eyes";
/** Nome curto na client entity. */
export const ALPHA_EYES_SHORT = "cobblemon_alpha_eyes";
/** Instantes (s) do loop de 1 s em que cada olho solta a partícula. */
export const ALPHA_EYES_TIMES = ["0.0", "0.2", "0.4", "0.6", "0.8"];

/** Locators de olho por identificador de geometria (preenchido em models.emit). */
const EYE_LOCATORS = new Map<string, string[]>();

/** Nomes dos locators cujo nome contém "eye" (sem diferenciar maiúsculas), na ordem dos ossos. */
export function eyeLocatorsOf(geo: any): string[] {
	const out: string[] = [];
	for (const bone of geo?.bones ?? []) {
		for (const name of Object.keys(bone?.locators ?? {})) {
			if (name.toLowerCase().includes("eye") && !out.includes(name)) out.push(name);
		}
	}
	return out;
}

/** Guarda os locators de olho da geometria (chamado por ModelIndex.emit). */
export function recordEyeLocators(geo: any, geometryId: string): void {
	EYE_LOCATORS.set(geometryId, eyeLocatorsOf(geo));
}

export interface AlphaEyesCombo {
	/** Identificador da geometria da variante. */
	geometryId: string;
	/** A variante tem a camada `alpha_eyes`. */
	alpha: boolean;
}

export interface AlphaEyesOut {
	/** Chave curta da animação → id, e condição de variante (undefined = sempre). */
	animations: Array<{ key: string; id: string; variants: number[] }>;
	/** Partícula para `particle_effects` da client entity. */
	particle: [string, string];
	/** Conteúdo de `animations` do arquivo de animação. */
	file: Record<string, unknown>;
}

/** Variáveis v.entity_* que a partícula lê (q.entity_size do ParticleStorm), com o tamanho do Alfa. */
function entityVars(size: SizeEntry | undefined): string {
	const s = size ?? { width: 1, height: 1, scale: 1 };
	const w = +(s.width * s.scale).toFixed(3);
	const h = +(s.height * s.scale).toFixed(3);
	const big = Math.max(w, h);
	return `v.entity_width = ${w}; v.entity_height = ${h}; v.entity_size = ${big}; v.entity_radius = ${+(big / 2).toFixed(3)}; v.entity_scale = ${s.scale};`;
}

/**
 * Gera as animações de `alpha_eyes` da espécie (uma por geometria com olhos). Devolve undefined quando nenhuma
 * variante com a camada tem locator de olho.
 * @param locators para testes: locators por geometria (padrão: os registrados por recordEyeLocators).
 */
export function alphaEyesAnimations(species: string, combos: AlphaEyesCombo[], alphaSize?: SizeEntry, locators: Map<string, string[]> = EYE_LOCATORS): AlphaEyesOut | undefined {
	const byGeometry = new Map<string, number[]>();
	combos.forEach((c, i) => {
		if (!c.alpha || !(locators.get(c.geometryId)?.length)) return;
		const list = byGeometry.get(c.geometryId) ?? [];
		list.push(i);
		byGeometry.set(c.geometryId, list);
	});
	if (!byGeometry.size) return undefined;
	const vars = entityVars(alphaSize);
	const animations: AlphaEyesOut["animations"] = [];
	const file: Record<string, unknown> = {};
	let n = 0;
	for (const [geometryId, variants] of byGeometry) {
		const eyes = locators.get(geometryId)!;
		const id = `animation.cobblemon_gen.${species}.alpha_eyes_${n}`;
		const particle_effects: Record<string, unknown> = {};
		for (const t of ALPHA_EYES_TIMES) particle_effects[t] = eyes.map((locator) => ({ effect: ALPHA_EYES_SHORT, locator, pre_effect_script: vars }));
		file[id] = { loop: true, animation_length: 1, particle_effects };
		animations.push({ key: `cobblemon_alpha_eyes_${n}`, id, variants });
		n++;
	}
	return { animations, particle: [ALPHA_EYES_SHORT, ALPHA_EYES_PARTICLE], file };
}

/** Grava o arquivo de animação e pede a partícula (e a `alpha_eyes_outer` que ela dispara). */
export function emitAlphaEyes(species: string, out: AlphaEyesOut): void {
	writeJson(`${OUT_RP}/animations/pokemon/_generated/${species}_alpha_eyes.animation.json`, { format_version: "1.8.0", animations: out.file });
	particleIndex().request(ALPHA_EYES_PARTICLE, { silent: true });
	count("animações de olhos do Alfa (alpha_eyes)");
}
