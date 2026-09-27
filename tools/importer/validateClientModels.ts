// Frente cliente-modelos: regras que só o cliente Bedrock confere em modelos, animações, controllers e client
// entities (o BDS não carrega o resource pack). Cada regra corresponde a uma categoria do content log do cliente
// (docs/pendencias/cliente-modelos.md):
//  1. catmullrom com Molang no canal → "Precomputed cubic interpolation requires keyframes have constant data";
//  2. todo Molang (animações, controllers, render controllers, client entities) passa no parser estrito do Bedrock
//     (molangSyntax.ts) → "[Molang][error] unrecognized token / binary Add at end / multiple operations / stack depth";
//  3. locators com o mesmo nome e definição diferente entre as geometrias de uma client entity → "Locator: Error: model
//     already has a locator X that doesn't exactly match";
//  4. identificador de geometria fora de [A-Za-z0-9_.-] → "Required child identifier not found" / "geometry not found?";
//     referência de render controller a geometry.X que a client entity não declara → "friendly name ... not found";
//  5. "animations": [] num estado de controller → "Required child not found"; chave de osso inválida / canal que não é
//     position/rotation/scale → "child 'X' not valid here".
import { checkBedrockMolang } from "./molangSyntax.ts";
import { BONE_NAME } from "./animationBake.ts";
import { GEOMETRY_ID } from "./locators.ts";

export interface ClientModelsStats {
	molang: number;
	animations: number;
	controllers: number;
	renderControllers: number;
	entities: number;
	geometries: number;
}

const CHANNELS = new Set(["position", "rotation", "scale", "relative_to"]);
const hasString = (v: any): boolean => typeof v === "string" || (Array.isArray(v) && v.some(hasString));

/**
 * @param docs arquivo → JSON (a árvore mesclada do validate.ts: gerado + escrito à mão).
 * @param rel caminho curto para as mensagens.
 */
export function validateClientModels(docs: Map<string, any>, err: (m: string) => void, rel: (f: string) => string): ClientModelsStats {
	const stats: ClientModelsStats = { molang: 0, animations: 0, controllers: 0, renderControllers: 0, entities: 0, geometries: 0 };
	const molangErrors = new Map<string, number>();
	const molang = (expr: unknown, where: string) => {
		if (typeof expr !== "string") return;
		stats.molang++;
		const problem = checkBedrockMolang(expr);
		if (!problem) return;
		const key = `Molang recusado pelo cliente (${problem}): ${where} | ${expr.length > 160 ? `${expr.slice(0, 160)}…` : expr}`;
		molangErrors.set(key, (molangErrors.get(key) ?? 0) + 1);
	};
	const deep = (v: any, where: string, skip: Set<string> = new Set()) => {
		if (typeof v === "string") molang(v, where);
		else if (Array.isArray(v)) v.forEach((x) => deep(x, where, skip));
		else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!skip.has(k)) deep(x, where, skip);
	};

	const geometryLocators = new Map<string, Map<string, string>>();
	for (const [f, j] of docs) {
		const file = rel(f);
		// Geometrias.
		if (f.includes("/models/")) {
			for (const g of j?.["minecraft:geometry"] ?? []) {
				stats.geometries++;
				const id = String(g?.description?.identifier ?? "");
				if (!GEOMETRY_ID.test(id)) err(`${file}: identificador de geometria inválido para o cliente: '${id}'`);
				const locs = new Map<string, string>();
				for (const b of g?.bones ?? []) {
					for (const [n, v] of Object.entries(b?.locators ?? {})) {
						const def = JSON.stringify([String(b.name), v]);
						const prev = locs.get(n);
						// Mesmo nome em dois ossos da MESMA geometria (ho_oh: tail_feathers; magnezone: seat_1).
						if (prev !== undefined && prev !== def) err(`${file}: locator '${n}' repetido com outra definição em ${id} (o cliente descarta: "model already has a locator")`);
						if (prev === undefined) locs.set(n, def);
					}
				}
				geometryLocators.set(id, locs);
			}
		}
		// Animações.
		if (f.includes("/animations/")) {
			for (const [id, a] of Object.entries<any>(j?.animations ?? {})) {
				stats.animations++;
				const where = `${file} | ${id}`;
				for (const [bone, value] of Object.entries<any>(a?.bones ?? {})) {
					if (!BONE_NAME.test(bone)) err(`${where}: osso '${bone}' inválido em bones (child not valid here)`);
					if (!value || typeof value !== "object" || Array.isArray(value)) {
						err(`${where}: osso '${bone}' sem objeto de canais`);
						continue;
					}
					for (const [ch, data] of Object.entries<any>(value)) {
						if (!CHANNELS.has(ch)) {
							err(`${where}: '${bone}.${ch}' não é canal de osso (child not valid here)`);
							continue;
						}
						if (ch === "relative_to") continue;
						deep(data, `${where} | ${bone}.${ch}`, new Set(["lerp_mode"]));
						if (data && typeof data === "object" && !Array.isArray(data)) {
							const frames = Object.values<any>(data);
							const smooth = frames.some((k) => k && typeof k === "object" && !Array.isArray(k) && k.lerp_mode === "catmullrom");
							const hasExpr = frames.some((k) => hasString(k && typeof k === "object" && !Array.isArray(k) ? [k.pre, k.post] : k));
							if (smooth && hasExpr && frames.length > 1) err(`${where} | ${bone}.${ch}: catmullrom com Molang (Precomputed cubic interpolation requires keyframes have constant data)`);
						}
					}
				}
				for (const [t, list] of Object.entries<any>(a?.timeline ?? {})) deep(list, `${where} | timeline ${t}`);
				for (const [t, list] of Object.entries<any>(a?.particle_effects ?? {})) {
					for (const e of Array.isArray(list) ? list : [list]) molang(e?.pre_effect_script, `${where} | particle_effects ${t}`);
				}
				for (const k of ["anim_time_update", "blend_weight", "start_delay", "loop_delay"]) molang(a?.[k], `${where} | ${k}`);
			}
		}
		// Animation controllers.
		if (f.includes("/animation_controllers/")) {
			for (const [id, c] of Object.entries<any>(j?.animation_controllers ?? {})) {
				stats.controllers++;
				for (const [sn, s] of Object.entries<any>(c?.states ?? {})) {
					const where = `${file} | ${id} | ${sn}`;
					if (Array.isArray(s?.animations) && !s.animations.length) err(`${where}: "animations": [] (Required child not found)`);
					for (const a of s?.animations ?? []) if (a && typeof a === "object") for (const [k, cond] of Object.entries(a)) molang(cond, `${where} | animations.${k}`);
					for (const t of s?.transitions ?? []) for (const [to, cond] of Object.entries(t ?? {})) molang(cond, `${where} | transição ${to}`);
					for (const k of ["on_entry", "on_exit"]) deep(s?.[k], `${where} | ${k}`);
					for (const p of s?.particle_effects ?? []) molang(p?.pre_effect_script, `${where} | particle_effects`);
				}
			}
		}
		// Render controllers.
		if (f.includes("/render_controllers/")) {
			for (const [id, rc] of Object.entries<any>(j?.render_controllers ?? {})) {
				stats.renderControllers++;
				const where = `${file} | ${id}`;
				molang(rc?.geometry, `${where} | geometry`);
				deep(rc?.textures, `${where} | textures`);
				for (const m of rc?.materials ?? []) deep(m, `${where} | materials`);
				for (const p of rc?.part_visibility ?? []) for (const [k, v] of Object.entries(p ?? {})) if (typeof v === "string") molang(v, `${where} | part_visibility.${k}`);
				for (const k of ["color", "overlay_color", "on_fire_color", "is_hurt_color", "light_color_multiplier", "uv_anim"]) deep(rc?.[k], `${where} | ${k}`);
			}
		}
		// Client entities (scripts e condições).
		const ce = j?.["minecraft:client_entity"]?.description;
		if (ce) {
			stats.entities++;
			const where = `${file} | ${ce.identifier}`;
			const sc = ce.scripts ?? {};
			deep(sc.initialize, `${where} | initialize`);
			deep(sc.pre_animation, `${where} | pre_animation`);
			for (const k of ["scale", "scaleX", "scaleY", "scaleZ", "should_update_bones_and_effects_offscreen", "should_update_effects_offscreen", "parent_setup"]) molang(sc[k], `${where} | ${k}`);
			for (const a of sc.animate ?? []) if (a && typeof a === "object") for (const [k, cond] of Object.entries(a)) molang(cond, `${where} | animate.${k}`);
			for (const rc of ce.render_controllers ?? []) if (rc && typeof rc === "object") for (const [k, cond] of Object.entries(rc)) molang(cond, `${where} | render_controllers.${k}`);
		}
	}

	// Por client entity: locators entre geometrias e nomes geometry.X citados pelos render controllers.
	const renderControllers = new Map<string, any>();
	for (const [, j] of docs) for (const [id, rc] of Object.entries<any>(j?.render_controllers ?? {})) renderControllers.set(id, rc);
	for (const [f, j] of docs) {
		const ce = j?.["minecraft:client_entity"]?.description;
		if (!ce) continue;
		const where = `${rel(f)} | ${ce.identifier}`;
		const registry = new Map<string, { def: string; key: string }>();
		for (const [key, gid] of Object.entries<string>(ce.geometry ?? {})) {
			for (const [name, def] of geometryLocators.get(gid) ?? []) {
				const prev = registry.get(name);
				if (!prev) registry.set(name, { def, key });
				else if (prev.def !== def) err(`${where}: locator '${name}' de ${key}(${gid}) difere do de ${prev.key} (o cliente descarta: "model already has a locator")`);
			}
		}
		const declared = new Set(Object.keys(ce.geometry ?? {}).map((k) => k.toLowerCase()));
		for (const rc of ce.render_controllers ?? []) {
			const id = typeof rc === "string" ? rc : Object.keys(rc ?? {})[0];
			const def = renderControllers.get(id);
			if (!def) continue;
			const refs = [...String(def.geometry ?? "").matchAll(/\bgeometry\.([A-Za-z0-9_]+)/gi)].map((m) => m[1]);
			for (const list of Object.values<string[]>(def.arrays?.geometries ?? {})) for (const r of list) if (/^geometry\./i.test(r)) refs.push(r.split(".")[1]);
			for (const r of refs) if (!declared.has(r.toLowerCase())) err(`${where}: ${id} usa geometry.${r}, que a client entity não declara (friendly name not found)`);
		}
	}

	for (const [k, n] of molangErrors) err(`${k}${n > 1 ? ` ×${n}` : ""}`);
	return stats;
}
