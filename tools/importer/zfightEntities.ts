// Frente zfight2 (docs/pendencias/zfight2.md): z-fighting que sobrou nos Pokémon depois da beta 5 (Eternatus,
// Chandelure, Mamoswine, Arbok…). Detector sobre TODAS as client entities que desenham geometrias de Pokémon (base +
// camadas do render controller) e os materiais que o corrigem.
//
// Causas (medidas nas geometrias reais, ver o doc):
//  1. CAMADAS: a base e cada camada (emissiva, translúcida, alpha, padrões do Arbok…) desenham a MESMA geometria. Os
//     materiais de entidade do Bedrock testam a profundidade com `Less` (padrão); a camada empata com a base e cada
//     pixel decide por arredondamento → pisca. O vanilla usa `LessEqual` (iron_golem e villager_v2 — rachaduras e
//     profissão sobre a mesma geometria) ou `Equal` (entity_emissive_layer_alpha_*: warden, breeze, creaking). No Java
//     (PosableModel.render) as camadas usam o mesmo rootPart.render com o LEQUAL padrão do OpenGL.
//  2. MATERIAL DE DOIS LADOS: o Java desenha a base com RenderType.entityCutout (descarta a face de trás); aqui era
//     `entity_alphatest` (sem descarte): planos e cubos com inflate negativo (costas do plano, faces internas) apareciam
//     do lado errado. O vanilla tem o equivalente exato: `entity_alphatest_one_sided` (recorte + descarte; o axolotl o
//     usa nos membros/guelras, que são planos).
//  3. Faces coplanares do mesmo lado entre cubos de OSSOS DIFERENTES (o separador só olhava o mesmo osso) e planos que
//     o passe de espessura igualava (inflate negativo) — corrigidos na geometria (zfight.ts).
import { MIN_ENTITY_FACE_GAP, coplanarConflicts, geometryFaces, isFlatEntityCube } from "./zfight.ts";

type DepthFunc = "Less" | "LessEqual" | "Equal" | "Always" | "Greater" | "GreaterEqual" | "NotEqual" | "Never";
export interface MaterialInfo {
	/** Descarta a face de trás (sem DisableCulling na cadeia). */
	cull: boolean;
	depthFunc: DepthFunc;
}

/**
 * Materiais vanilla de entidade usados/relevantes (vanilla materials/entity.material, 1.21.100+: cadeia de herança e
 * estados). `entity` não tem DisableCulling; `entity_nocull` tem; o padrão de profundidade é Less.
 */
export const VANILLA_ENTITY_MATERIALS: Record<string, MaterialInfo> = {
	entity: { cull: true, depthFunc: "Less" },
	entity_static: { cull: true, depthFunc: "Less" },
	entity_nocull: { cull: false, depthFunc: "Less" },
	entity_change_color: { cull: false, depthFunc: "Less" },
	entity_alphatest: { cull: false, depthFunc: "Less" },
	entity_alphatest_one_sided: { cull: true, depthFunc: "Less" },
	entity_alphatest_glint: { cull: false, depthFunc: "Less" },
	entity_alphatest_change_color: { cull: false, depthFunc: "Less" },
	entity_alphablend: { cull: true, depthFunc: "Less" },
	entity_emissive: { cull: true, depthFunc: "Less" },
	entity_emissive_alpha: { cull: false, depthFunc: "Less" },
	entity_emissive_alpha_one_sided: { cull: true, depthFunc: "Less" },
	entity_emissive_layer_alpha_blend: { cull: false, depthFunc: "Equal" },
	entity_emissive_layer_alpha_test: { cull: false, depthFunc: "Equal" },
	entity_multitexture: { cull: true, depthFunc: "Less" },
	villager_v2: { cull: false, depthFunc: "LessEqual" },
	villager_v2_masked: { cull: false, depthFunc: "LessEqual" },
	iron_golem: { cull: false, depthFunc: "LessEqual" },
};

/**
 * Materiais próprios (resource pack `materials/entity.material`, gerado pelo import): herdam o vanilla e mudam só o
 * teste de profundidade — como o `iron_golem:entity_alphatest { depthFunc: LessEqual }` do vanilla. Nenhum define
 * novo nem shader novo (o RenderDragon usa os shaders do pai).
 */
export const COBBLEMON_ENTITY_MATERIALS: Record<string, Record<string, unknown>> = {
	// Camada de recorte (padrões do Arbok, alpha, emissiva sem mistura) sobre a base: passa no empate com a base.
	"cobblemon_layer:entity_alphatest_one_sided": { depthFunc: "LessEqual" },
	// Camada translúcida (emissive/transparency do Eternatus e do Chandelure).
	"cobblemon_layer_translucent:entity_alphablend": { depthFunc: "LessEqual" },
};

/** Materiais das client entities de Pokémon (entities.ts). */
export const POKEMON_MATERIALS = {
	default: "entity_alphatest_one_sided",
	layer: "cobblemon_layer",
	layer_translucent: "cobblemon_layer_translucent",
} as const;

/** Conteúdo de `materials/entity.material` do RP gerado. */
export function entityMaterialFile(): unknown {
	return { materials: { version: "1.0.0", ...COBBLEMON_ENTITY_MATERIALS } };
}

/** Tabela nome → info com os materiais próprios (de arquivos `.material` do RP) resolvidos pela herança. */
export function materialTable(materialFiles: unknown[] = [entityMaterialFile()]): Map<string, MaterialInfo> {
	const table = new Map<string, MaterialInfo>(Object.entries(VANILLA_ENTITY_MATERIALS));
	const defs = new Map<string, { parent?: string; body: any }>();
	for (const file of materialFiles) {
		for (const [key, body] of Object.entries<any>((file as any)?.materials ?? {})) {
			if (key === "version" || !body || typeof body !== "object") continue;
			const [name, parent] = key.split(":");
			defs.set(name, { parent, body });
		}
	}
	const resolve = (name: string, depth = 0): MaterialInfo | undefined => {
		const known = table.get(name);
		if (known) return known;
		const d = defs.get(name);
		if (!d || depth > 16) return undefined;
		const base = d.parent ? resolve(d.parent, depth + 1) : undefined;
		if (!base) return undefined;
		const states: string[] = [...(d.body["+states"] ?? [])];
		const removed: string[] = [...(d.body["-states"] ?? [])];
		const info: MaterialInfo = {
			cull: states.includes("DisableCulling") ? false : removed.includes("DisableCulling") ? true : base.cull,
			depthFunc: d.body.depthFunc ?? base.depthFunc,
		};
		table.set(name, info);
		return info;
	};
	for (const name of defs.keys()) resolve(name);
	return table;
}

// ---------------------------------------------------------------------------------------------------------------
// Detector

export type RiskKind =
	/** Camada sobre a mesma geometria com teste de profundidade que não passa no empate (Less). */
	| "camada"
	/** Camada de dois lados sobre base de um lado numa geometria com plano/cubo invertido (a costa da camada aparece). */
	| "camada-dois-lados"
	/** Material desconhecido (sem como saber culling/profundidade). */
	| "material-desconhecido"
	/** Plano sem espessura desenhado com material de dois lados (as duas faces no mesmo plano). */
	| "plano-dois-lados"
	/** Cubo com inflate negativo maior que a metade do tamanho (virado do avesso) com material de dois lados. */
	| "cubo-invertido"
	/** Faces coplanares sobrepostas do mesmo lado, cubos do mesmo osso. */
	| "coplanar-mesmo-osso"
	/** Faces coplanares sobrepostas do mesmo lado entre ossos diferentes (pose de repouso: pivôs e rotações). */
	| "coplanar-entre-ossos"
	/** Faces visíveis do mesmo lado sobrepostas a menos de MIN_ENTITY_FACE_GAP (0,01 px, o passo do Java). */
	| "quase-coplanar"
	/** Duas geometrias diferentes desenhadas juntas (render controllers da mesma variante) com faces coplanares. */
	| "geometrias-sobrepostas";

export interface EntityRisk {
	entity: string;
	/** Espécie (cobblemon:<id>). */
	species: string;
	risks: Partial<Record<RiskKind, { count: number; examples: string[] }>>;
}

interface GeoAnalysis {
	flat: string[];
	inverted: string[];
	sameBone: string[];
	crossBone: string[];
	near: string[];
}

function invertedCubes(geo: any): string[] {
	const out: string[] = [];
	for (const b of geo?.bones ?? []) (b.cubes ?? []).forEach((c: any, i: number) => {
		const g = c.inflate ?? 0;
		if (Array.isArray(c.size) && g < 0 && c.size.some((s: number) => s + 2 * g < -1e-6)) out.push(`${b.name}#${i}`);
	});
	return out;
}

const faceName = (f: { bone: string; cube: number; dir: string }) => `${f.bone}#${f.cube}.${f.dir}`;

function analyse(geo: any): GeoAnalysis {
	// Pose de repouso; pares guardados dentro de outros cubos (expressões alternativas) não aparecem.
	const pairs = coplanarConflicts(geometryFaces(geo), { doubleSided: false, minArea: 0.05, skipHidden: true, eps: Math.max(1e-3, MIN_ENTITY_FACE_GAP - 1e-4) });
	const sameBone: string[] = [], crossBone: string[] = [], near: string[] = [];
	for (const z of pairs) {
		if (z.a.bone === z.b.bone && z.a.cube === z.b.cube) continue;
		const label = `${faceName(z.a)}~${faceName(z.b)} (${z.area.toFixed(2)} px²${(z.gap ?? 0) >= 1e-3 ? `, vão ${z.gap!.toFixed(4)} px` : ""})`;
		(((z.gap ?? 0) >= 1e-3) ? near : z.a.bone === z.b.bone ? sameBone : crossBone).push(label);
	}
	const flat: string[] = [];
	for (const b of geo?.bones ?? []) (b.cubes ?? []).forEach((c: any, i: number) => { if (isFlatEntityCube(c)) flat.push(`${b.name}#${i}`); });
	return { flat, inverted: invertedCubes(geo), sameBone, crossBone, near };
}

const rcId = (rc: any): string => (typeof rc === "string" ? rc : Object.keys(rc ?? {})[0]);

/** Chaves de geometria (g0, g1…) que um render controller pode desenhar. */
function controllerGeometries(def: any): Set<string> {
	const out = new Set<string>();
	const add = (r: string) => { const m = /^geometry\.([A-Za-z0-9_]+)$/i.exec(r.trim()); if (m) out.add(m[1].toLowerCase()); };
	for (const list of Object.values<string[]>(def?.arrays?.geometries ?? {})) for (const r of list ?? []) add(String(r));
	for (const m of String(def?.geometry ?? "").matchAll(/\bgeometry\.([A-Za-z0-9_]+)/gi)) out.add(m[1].toLowerCase());
	return out;
}

function controllerMaterials(def: any, entityMaterials: Record<string, string>): string[] {
	const out: string[] = [];
	for (const entry of def?.materials ?? []) {
		for (const ref of Object.values<string>(entry ?? {})) {
			const key = String(ref).replace(/^material\./i, "");
			const arrays = def?.arrays?.materials ?? {};
			const refs = arrays[ref] ?? arrays[`Array.${key}`] ?? [ref];
			for (const r of refs) {
				const k = String(r).replace(/^material\./i, "");
				const name = entityMaterials[k] ?? entityMaterials[Object.keys(entityMaterials).find((x) => x.toLowerCase() === k.toLowerCase()) ?? ""];
				out.push((name ?? `?${k}`).split(".")[0]);
			}
		}
	}
	return out;
}

/** Pares (geometria da base, geometria do controller) desenhados ao mesmo tempo. */
function drawnTogether(baseDef: any, def: any): Array<[string, string]> {
	const arr = (d: any) => {
		const m = /^\s*(Array\.[A-Za-z0-9_]+)\[(.+)\]\s*$/.exec(String(d?.geometry ?? ""));
		const list = m ? d?.arrays?.geometries?.[m[1]] : undefined;
		return m && Array.isArray(list) ? { expr: m[2].replace(/\s+/g, ""), list: list.map((r: string) => String(r).replace(/^geometry\./i, "").toLowerCase()) } : undefined;
	};
	const a = arr(baseDef), b = arr(def);
	if (a && b && a.expr === b.expr) return a.list.map((g: string, i: number) => [g, b.list[i] ?? g] as [string, string]).filter(([x, y]) => x !== y);
	const out: Array<[string, string]> = [];
	for (const x of controllerGeometries(baseDef)) for (const y of controllerGeometries(def)) if (x !== y) out.push([x, y]);
	return out;
}

/**
 * Riscos de z-fighting por client entity que desenha geometria de Pokémon.
 * @param rp caminho relativo do RP ("/entity/…", "/render_controllers/…", "/models/entity/pokemon/…", "/materials/…") → JSON.
 */
export function entityZFightRisks(rp: Map<string, any>, options: { materialFiles?: unknown[] } = {}): EntityRisk[] {
	const materialFiles = options.materialFiles ?? [...rp].filter(([k]) => /^\/materials\/.*\.material$/.test(k)).map(([, j]) => j);
	const materials = materialTable(materialFiles);
	const geometries = new Map<string, any>();
	for (const [key, j] of rp) {
		if (!/^\/models\/entity\/pokemon\//.test(key)) continue;
		for (const g of j?.["minecraft:geometry"] ?? []) if (g?.description?.identifier) geometries.set(g.description.identifier, g);
	}
	const controllers = new Map<string, any>();
	for (const [, j] of rp) for (const [id, rc] of Object.entries<any>(j?.render_controllers ?? {})) controllers.set(id, rc);
	const cache = new Map<string, GeoAnalysis>();
	const analysis = (id: string) => {
		let a = cache.get(id);
		if (!a) cache.set(id, a = analyse(geometries.get(id)));
		return a;
	};
	const out: EntityRisk[] = [];
	for (const [, j] of rp) {
		const desc = j?.["minecraft:client_entity"]?.description;
		if (!desc) continue;
		const geoMap: Record<string, string> = Object.fromEntries(Object.entries<string>(desc.geometry ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
		if (!Object.values(geoMap).some((g) => geometries.has(g))) continue;
		const risk: EntityRisk = { entity: desc.identifier, species: desc.identifier, risks: {} };
		const add = (kind: RiskKind, examples: string[]) => {
			if (!examples.length) return;
			const r = risk.risks[kind] ??= { count: 0, examples: [] };
			r.count += examples.length;
			for (const e of examples) if (r.examples.length < 3 && !r.examples.includes(e)) r.examples.push(e);
		};
		const rcs = (desc.render_controllers ?? []).map((rc: any) => ({ id: rcId(rc), def: controllers.get(rcId(rc)) })).filter((x: any) => x.def);
		if (!rcs.length) continue;
		const base = rcs[0];
		const baseGeos = controllerGeometries(base.def);
		const baseMats = controllerMaterials(base.def, desc.materials ?? {});
		const info = (m: string) => materials.get(m);
		const baseCull = baseMats.every((m) => info(m)?.cull);
		// Por geometria: se algum material que a desenha é de dois lados.
		const doubleSided = new Map<string, boolean>();
		rcs.forEach((rc: any, index: number) => {
			const mats = controllerMaterials(rc.def, desc.materials ?? {});
			for (const m of mats) if (!info(m)) add("material-desconhecido", [`${rc.id}: ${m}`]);
			const geos = controllerGeometries(rc.def);
			for (const g of geos) {
				const gid = geoMap[g];
				if (!gid || !geometries.has(gid)) continue;
				if (mats.some((m) => !info(m)?.cull)) doubleSided.set(gid, true);
				else if (!doubleSided.has(gid)) doubleSided.set(gid, false);
			}
			if (index === 0) return;
			const shared = [...geos].filter((g) => baseGeos.has(g));
			if (shared.length) {
				// Camada sobre a MESMA geometria: tem de passar no empate de profundidade com a base.
				for (const m of mats) {
					const i = info(m);
					if (i && i.depthFunc !== "LessEqual" && i.depthFunc !== "Equal") add("camada", [`${rc.id.split(".").pop()}: ${m} (depthFunc ${i.depthFunc})`]);
				}
				// Camada de dois lados sobre base de um lado: nos planos/cubos invertidos a costa da camada empata com a frente.
				if (baseCull && mats.some((m) => info(m) && !info(m)!.cull)) {
					for (const g of shared) {
						const a = geoMap[g] && geometries.has(geoMap[g]) ? analysis(geoMap[g]) : undefined;
						if (a && (a.inverted.length || a.flat.length)) add("camada-dois-lados", [`${rc.id.split(".").pop()} em ${geoMap[g]}`]);
					}
				}
			}
			// Geometrias diferentes desenhadas juntas (base e este controller na MESMA variante): mesmo índice quando os
			// dois escolhem pelo mesmo Array.geo[expr]; senão, toda combinação.
			for (const [bg, g] of drawnTogether(base.def, rc.def)) {
				const bid = geoMap[bg], gid = geoMap[g];
				if (!bid || !gid || bid === gid || !geometries.has(bid) || !geometries.has(gid)) continue;
				const faces = [...geometryFaces(geometries.get(bid)).map((f) => ({ ...f, bone: `${bid}:${f.bone}` })), ...geometryFaces(geometries.get(gid)).map((f) => ({ ...f, bone: `${gid}:${f.bone}` }))];
				const cross = coplanarConflicts(faces, { doubleSided: false, minArea: 0.05, skipHidden: true }).filter((z) => z.a.bone.split(":")[0] !== z.b.bone.split(":")[0]);
				add("geometrias-sobrepostas", cross.slice(0, 50).map((z) => `${faceName(z.a)}~${faceName(z.b)}`));
			}
		});
		for (const [gid, ds] of doubleSided) {
			const a = analysis(gid);
			if (ds) {
				// a.flat inclui os planos com inflate negativo (faces trocadas de lado).
				add("plano-dois-lados", a.flat.map((c) => `${gid} ${c}`));
				add("cubo-invertido", a.inverted.map((c) => `${gid} ${c}`));
			}
			add("coplanar-mesmo-osso", a.sameBone.map((c) => `${gid} ${c}`));
			add("coplanar-entre-ossos", a.crossBone.map((c) => `${gid} ${c}`));
			add("quase-coplanar", a.near.map((c) => `${gid} ${c}`));
		}
		if (Object.keys(risk.risks).length) out.push(risk);
	}
	return out.sort((a, b) => a.entity.localeCompare(b.entity));
}

/**
 * Geometrias de entidade desenhadas SÓ com materiais de um lado (descarte de face de trás) por todas as client
 * entities que as usam. Nelas o plano sem espessura e o inflate negativo ficam como no Java.
 */
export function oneSidedGeometries(rp: Map<string, any>): Set<string> {
	const materials = materialTable([...rp].filter(([k]) => /^\/materials\/.*\.material$/.test(k)).map(([, j]) => j));
	const controllers = new Map<string, any>();
	for (const [, j] of rp) for (const [id, rc] of Object.entries<any>(j?.render_controllers ?? {})) controllers.set(id, rc);
	const verdict = new Map<string, boolean>();
	for (const [, j] of rp) {
		const desc = j?.["minecraft:client_entity"]?.description;
		if (!desc) continue;
		const geoMap: Record<string, string> = Object.fromEntries(Object.entries<string>(desc.geometry ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
		const drawn = new Set<string>();
		for (const rc of desc.render_controllers ?? []) {
			const def = controllers.get(rcId(rc));
			if (!def) continue;
			const cull = controllerMaterials(def, desc.materials ?? {}).every((m) => materials.get(m)?.cull);
			for (const g of controllerGeometries(def)) {
				const gid = geoMap[g];
				if (!gid) continue;
				drawn.add(gid);
				verdict.set(gid, (verdict.get(gid) ?? true) && cull);
			}
		}
		// Geometria declarada e não desenhada por render controller conhecido: não dá para saber (fica de dois lados).
		for (const gid of Object.values(geoMap)) if (!drawn.has(gid)) verdict.set(gid, false);
	}
	return new Set([...verdict].filter(([, v]) => v).map(([k]) => k));
}

/** Resumo por tipo de risco (quantas entidades). */
export function riskSummary(risks: EntityRisk[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of risks) for (const k of Object.keys(r.risks)) out[k] = (out[k] ?? 0) + 1;
	return out;
}
