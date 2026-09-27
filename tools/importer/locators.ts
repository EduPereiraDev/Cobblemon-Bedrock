// Frente cliente-modelos: locators de uma client entity com várias geometrias.
//
// O cliente junta os locators de TODAS as geometrias da client entity (g0, g1, ...) numa tabela só, por nome. Se g1
// declara um locator com o mesmo nome de um de g0 mas outro osso/posição, ele loga "model already has a locator X that
// doesn't exactly match the one wanting to be added - skipping new definition in g1(...)" e g1 passa a usar a posição
// de g0 (partícula/olho do Alfa no lugar errado na forma regional). Aqui o locator repetido e diferente ganha um nome
// próprio da geometria (`<nome>_<geometria>`); quem consome locator por geometria (olhos do Alfa, visualFinal.ts) lê os
// nomes já renomeados. Os locators de item (item/item_hat/item_face) já viraram ossos âncora antes da troca
// (mundoDetalhes.patchHeldItemBones), então o item segurado não muda.
//
// `armor_offset.default_neck` não existe nos .geo: o cliente cria sozinho para geometrias com osso `head` e ele também
// colide entre formas. Declarado igual (osso root_part, origem) em todas as geometrias da entidade, não há o que colidir.

/**
 * Identificador de geometria que o cliente aceita. "geometry.flabébé" (acento) reprova o arquivo inteiro ("Required child
 * identifier not found", "geometry not found?") e a espécie fica invisível.
 */
export const GEOMETRY_ID = /^geometry\.[A-Za-z0-9_.\-]+$/;

/** Nome → definição (osso + valor) já registrada na client entity. */
export type LocatorRegistry = Map<string, string>;

export const ARMOR_NECK_LOCATOR = "armor_offset.default_neck";

function definition(bone: any, value: unknown): string {
	return JSON.stringify([String(bone?.name ?? ""), value]);
}

/** Locators (nome → definição) de uma geometria. */
export function locatorsOf(geo: any): Map<string, string> {
	const out = new Map<string, string>();
	for (const bone of geo?.bones ?? []) for (const [name, value] of Object.entries(bone?.locators ?? {})) out.set(name, definition(bone, value));
	return out;
}

/**
 * Renomeia na geometria os locators que colidem com a tabela da entidade e registra os demais. Devolve os nomes
 * trocados (antigo → novo).
 */
export function dedupeLocators(geo: any, registry: LocatorRegistry, geometryId: string): Map<string, string> {
	const renamed = new Map<string, string>();
	const suffix = geometryId.replace(/^geometry\./, "").replace(/[^A-Za-z0-9_]/g, "_");
	const taken = new Set<string>([...registry.keys()]);
	for (const bone of geo?.bones ?? []) for (const n of Object.keys(bone?.locators ?? {})) taken.add(n);
	for (const bone of geo?.bones ?? []) {
		const locs = bone?.locators;
		if (!locs || typeof locs !== "object") continue;
		const next: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(locs)) {
			const def = definition(bone, value);
			const prev = registry.get(name);
			if (prev === undefined || prev === def) {
				registry.set(name, def);
				next[name] = value;
				continue;
			}
			let fresh = `${name}_${suffix}`;
			for (let i = 2; taken.has(fresh); i++) fresh = `${name}_${suffix}_${i}`;
			taken.add(fresh);
			registry.set(fresh, def);
			renamed.set(name, fresh);
			next[fresh] = value;
		}
		bone.locators = next;
	}
	return renamed;
}

/** Declara `armor_offset.default_neck` igual em todas as geometrias (ver cabeçalho). */
export function pinArmorNeckLocator(geo: any): boolean {
	const bones: any[] = geo?.bones ?? [];
	if (!bones.some((b) => String(b?.name).toLowerCase() === "head")) return false;
	const root = bones.find((b) => b?.name === "root_part");
	if (!root) return false;
	for (const b of bones) if (b !== root && b?.locators?.[ARMOR_NECK_LOCATOR] !== undefined) delete b.locators[ARMOR_NECK_LOCATOR];
	root.locators = { ...(root.locators ?? {}), [ARMOR_NECK_LOCATOR]: [0, 0, 0] };
	return true;
}
