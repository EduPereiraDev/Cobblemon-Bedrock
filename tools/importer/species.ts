// Carrega as espécies do Cobblemon (data/cobblemon/species/**) e extrai o subconjunto usado em jogo.
import { basename, dirname } from "node:path";
import { DATA, count, readJson, walk, warn } from "./util.ts";

export interface SpeciesFile {
	id: string;
	/** "1", "2", ..., "7b", "8a" (a partir da pasta generationN). */
	gen: string;
	data: any;
}

/** Campos de jogo copiados para `generated/scripts/species.ts`. */
export const GAMEPLAY_FIELDS = [
	"name", "nationalPokedexNumber", "primaryType", "secondaryType", "maleRatio", "height", "weight", "abilities",
	"baseStats", "evYield", "baseExperienceYield", "experienceGroup", "catchRate", "eggGroups", "eggCycles",
	"baseFriendship", "baseScale", "hitbox", "behaviour", "drops", "moves", "preEvolution", "evolutions", "forms",
	"labels", "aspects", "features", "implemented", "shoulderMountable", "pokedex",
];

export function loadSpecies(): SpeciesFile[] {
	const dir = `${DATA}/cobblemon/species`;
	const species = walk(dir, (n) => n.endsWith(".json")).map((file) => ({
		id: basename(file, ".json"),
		gen: basename(dirname(file)).replace(/^generation/, ""),
		data: readJson(file),
	}));
	// Frente msd-infra: data/cobblemon/species_additions (o Cobblemon 1.8.2 não traz nenhum; o Mega Showdown traz 114).
	applySpeciesAdditions(species, walk(`${DATA}/cobblemon/species_additions`, (n) => n.endsWith(".json")).map((file) => ({ file, json: readJson(file) })));
	return species;
}

/**
 * Propriedades `var` de `Species` (Species.kt, 1.8.2): as únicas chaves que o SpeciesAdditions aplica (as outras são
 * ignoradas, como `aspects` ou `target`).
 */
export const SPECIES_ADDITION_PROPERTIES = new Set([
	"name", "nationalPokedexNumber", "baseStats", "maleRatio", "catchRate", "baseScale", "baseExperienceYield", "baseFriendship",
	"evYield", "experienceGroup", "hitbox", "primaryType", "secondaryType", "abilities", "shoulderMountable", "shoulderEffects",
	"moves", "features", "standingEyeHeight", "swimmingEyeHeight", "flyingEyeHeight", "behaviour", "pokedex", "drops", "eggCycles",
	"eggGroups", "dynamaxBlocked", "implemented", "baseAI", "ai", "signatureMoves", "defaultWildMovesetBuilder", "height", "weight",
	"forms", "riding", "labels", "evolutions", "preEvolution", "battleTheme", "lightingData",
]);

/**
 * Semântica do `SpeciesAdditions.reload` do Cobblemon 1.8.2: para cada arquivo, a espécie `target` recebe cada
 * propriedade conhecida por SUBSTITUIÇÃO, exceto `forms` e `evolutions`, que são ACRESCENTADAS ao que já existe.
 * Alvo inexistente é pulado (o Cobblemon só avisa). Ordem: caminho do arquivo (o Java usa um mapa sem ordem; aqui a
 * ordem é fixa para o import ser determinístico). Devolve o nº de adições aplicadas.
 */
export function applySpeciesAdditions(species: SpeciesFile[], additions: Array<{ file: string; json: any }>): number {
	const byId = new Map(species.map((s) => [s.id, s]));
	let applied = 0;
	for (const { file, json } of [...additions].sort((a, b) => a.file.localeCompare(b.file))) {
		const target = String(json?.target ?? "");
		const id = (target.includes(":") ? target.slice(target.indexOf(":") + 1) : target).toLowerCase();
		const sp = byId.get(id);
		if (!sp) {
			warn("species_addition com espécie inexistente (pulada)", `${basename(file)}: ${target}`);
			continue;
		}
		for (const [key, value] of Object.entries<any>(json)) {
			if (key === "target" || !SPECIES_ADDITION_PROPERTIES.has(key)) continue;
			if ((key === "forms" || key === "evolutions") && Array.isArray(value)) {
				sp.data[key] = [...(Array.isArray(sp.data[key]) ? sp.data[key] : []), ...value.filter((v) => v != null)];
			} else sp.data[key] = value;
		}
		applied++;
	}
	if (applied) count("species_additions aplicadas", applied);
	return applied;
}

export function gameplaySubset(data: any): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of GAMEPLAY_FIELDS) {
		if (data[key] === undefined) continue;
		out[key] = key === "forms" ? (data.forms as any[]).map(gameplaySubset) : data[key];
	}
	return out;
}

/** Comportamento de movimento com os padrões do Cobblemon (MoveBehaviour/WalkBehaviour/SwimBehaviour/FlyBehaviour). */
export interface Movement {
	canWalk: boolean;
	avoidsLand: boolean;
	walkSpeed: number;
	canSwimInWater: boolean;
	avoidsWater: boolean;
	swimSpeed: number;
	canBreatheUnderwater: boolean;
	canWalkOnWater: boolean;
	canFly: boolean;
	flySpeed: number;
	fireImmune: boolean;
	canLook: boolean;
}

export function movementOf(data: any): Movement {
	const b = data.behaviour ?? {};
	const m = b.moving ?? {};
	const walk = { ...(m.walking ?? {}), ...(m.walk ?? {}) };
	const swim = m.swim ?? {};
	const fly = m.fly ?? {};
	return {
		canWalk: walk.canWalk ?? m.canWalk ?? true,
		avoidsLand: walk.avoidsLand ?? false,
		walkSpeed: walk.walkSpeed ?? m.walkSpeed ?? 0.35,
		canSwimInWater: swim.canSwimInWater ?? swim.canSwim ?? true,
		avoidsWater: swim.avoidsWater ?? false,
		swimSpeed: swim.swimSpeed ?? 0.3,
		canBreatheUnderwater: swim.canBreatheUnderwater ?? false,
		canWalkOnWater: swim.canWalkOnWater ?? false,
		canFly: fly.canFly ?? false,
		flySpeed: fly.flySpeedHorizontal ?? 0.3,
		fireImmune: b.fireImmune ?? false,
		canLook: m.canLook ?? true,
	};
}
