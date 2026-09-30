// Manifesto do /cobblemon:selftest (scripts/debug/SelfTest.ts).
//
// O script não consegue listar partículas, sons nem os estados dos blocos em tempo de execução. Este módulo lê os packs
// JÁ MESCLADOS em dist/ (generated/ + escritos à mão, a mesma coisa que vai para o mundo) e o plugin do esbuild troca o
// conteúdo de scripts/debug/selfTestManifest.ts (stub vazio, usado pelo tsc e pelos testes) pelos dados reais.
//
// Por padrão, o pack base (CobblemonBedrock). Um módulo `selfTestManifest.ts` de outra pasta (ex.: o de uma extensão
// opcional) pode pedir outro pack com a marca `@selftest-pack <pasta do pack>` no texto; sem esse pack em dist/, o
// módulo fica como está (o stub). O build público não tem os packs das extensões, então nada delas entra no main.js.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PACK = "CobblemonBedrock";

/** Entidades que o selftest não invoca: jogador, vanilla sobrescritas e entidades internas sem modelo próprio. */
const SKIP_ENTITY = /^(minecraft:|cobblemon:(machine_storage|gilded_chest_storage|structure_marker)$)/;
/** Limite de valores por propriedade inteira de entidade (ex.: 48 bolas na boia de pesca). */
const MAX_ENTITY_STEPS = 48;
/** Limite de valores por estado de bloco (faixas grandes, ex.: pools de habitat). */
const MAX_BLOCK_VALUES = 16;

/** Remove comentários fora de strings e vírgulas antes de } ou ] (JSON do Bedrock). */
function stripJsonComments(text) {
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			out += c;
			if (c === "\\") { out += text[++i] ?? ""; continue; }
			if (c === '"') inString = false;
			continue;
		}
		if (c === '"') { inString = true; out += c; continue; }
		if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
		if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
		out += c;
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

function readJson(file) {
	try { return JSON.parse(stripJsonComments(readFileSync(file, "utf8").replace(/^﻿/, ""))); }
	catch { return undefined; }
}

function walk(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".json") ? [join(dir, e.name)] : []))
		.sort();
}

/** Valores de um estado de bloco: lista, ou faixa inteira `{ values: { min, max } }`. */
export function stateValues(def) {
	const raw = Array.isArray(def) ? def : def && typeof def === "object" ? def.values ?? def : undefined;
	if (Array.isArray(raw)) return raw.slice(0, MAX_BLOCK_VALUES);
	if (raw && typeof raw.min === "number" && typeof raw.max === "number") {
		const out = [];
		for (let v = raw.min; v <= raw.max && out.length < MAX_BLOCK_VALUES; v++) out.push(v);
		return out;
	}
	return [];
}

/**
 * Capacidades de locomoção de um Pokémon pelo JSON da entidade (o que o motor executa): `w` anda (random_stroll ou
 * navegação a pé), `s` nada (random_swim, navegação que nada ou movimento subaquático), `f` voa (random_fly ou can_fly).
 */
export function locomotionFlags(entity) {
	const comps = entity?.components ?? {};
	const wild = entity?.component_groups?.["cobblemon:wild_ai"] ?? {};
	const generic = comps["minecraft:navigation.generic"];
	let flags = "";
	if ("minecraft:behavior.random_stroll" in wild || comps["minecraft:navigation.walk"] || generic?.can_walk === true) flags += "w";
	if ("minecraft:behavior.random_swim" in wild || generic?.can_swim === true || "minecraft:underwater_movement" in comps) flags += "s";
	if ("minecraft:behavior.random_fly" in wild || "minecraft:can_fly" in comps || comps["minecraft:navigation.fly"] || comps["minecraft:navigation.hover"]) flags += "f";
	return flags;
}

/** Pack pedido por um módulo de manifesto (`@selftest-pack <pasta>`), ou o base. */
export function manifestPackOf(source) {
	const m = /@selftest-pack\s+([A-Za-z0-9_.-]+)/.exec(source ?? "");
	return m ? m[1] : PACK;
}

/**
 * Lê os packs em `dist` (o `pack`, padrão o base) e devolve o manifesto:
 * - `entities`: entidades que não são Pokémon (NPC, bolas, barcos, exibições) com as propriedades inteiras
 *   (valor máximo) e as animações `animation.*` da entidade cliente;
 * - `blocks`: blocos com os estados próprios (valores em ordem; o primeiro é o padrão);
 * - `particles`: identificadores das partículas;
 * - `sounds`: eventos do sound_definitions.json;
 * - `locomotion`: espécie → capacidades (`w`/`s`/`f`, ver `locomotionFlags`) dos Pokémon do pack;
 * - `items`: identificadores dos itens do BP (o esbuild descarta o export quando ninguém o usa).
 */
export function readSelfTestManifest(dist, pack = PACK) {
	const bp = join(dist, "behavior_packs", pack);
	const rp = join(dist, "resource_packs", pack);
	const animationsById = new Map();
	for (const file of walk(join(rp, "entity"))) {
		const desc = readJson(file)?.["minecraft:client_entity"]?.description;
		if (!desc?.identifier) continue;
		const list = Object.values(desc.animations ?? {}).filter((a) => typeof a === "string" && a.startsWith("animation."));
		animationsById.set(desc.identifier, [...new Set(list)]);
	}
	const entities = [];
	const locomotion = {};
	for (const file of walk(join(bp, "entities"))) {
		if (/[\\/]entities[\\/]pokemon[\\/]/.test(file)) {
			const entity = readJson(file)?.["minecraft:entity"];
			const id = entity?.description?.identifier;
			if (typeof id === "string" && id.startsWith("cobblemon:")) locomotion[id.slice("cobblemon:".length)] = locomotionFlags(entity);
			continue;
		}
		if (/[\\/]entities[\\/]vanilla_overrides[\\/]/.test(file)) continue;
		const desc = readJson(file)?.["minecraft:entity"]?.description;
		const id = desc?.identifier;
		if (!id || SKIP_ENTITY.test(id)) continue;
		const ints = {};
		for (const [name, prop] of Object.entries(desc.properties ?? {})) {
			if (prop?.type === "int" && Array.isArray(prop.range)) ints[name] = Math.min(MAX_ENTITY_STEPS - 1, Number(prop.range[1]) || 0);
		}
		const group = file.split(/[\\/]entities[\\/]/)[1]?.split(/[\\/]/)[0] ?? "";
		entities.push({ id, group: group.endsWith(".json") ? "" : group, ints, animations: animationsById.get(id) ?? [] });
	}
	entities.sort((a, b) => a.id.localeCompare(b.id));
	const blocks = [];
	for (const file of walk(join(bp, "blocks"))) {
		const desc = readJson(file)?.["minecraft:block"]?.description;
		if (!desc?.identifier) continue;
		const states = {};
		for (const [name, def] of Object.entries(desc.states ?? {})) {
			const values = stateValues(def);
			if (values.length) states[name] = values;
		}
		blocks.push({ id: desc.identifier, states });
	}
	blocks.sort((a, b) => a.id.localeCompare(b.id));
	const particles = new Set();
	for (const file of walk(join(rp, "particles"))) {
		const id = readJson(file)?.particle_effect?.description?.identifier;
		if (typeof id === "string") particles.add(id);
	}
	const soundFile = readJson(join(rp, "sounds", "sound_definitions.json")) ?? {};
	const sounds = Object.keys(soundFile.sound_definitions ?? soundFile).filter((k) => k !== "format_version");
	const items = new Set();
	for (const file of walk(join(bp, "items"))) {
		const id = readJson(file)?.["minecraft:item"]?.description?.identifier;
		if (typeof id === "string") items.add(id);
	}
	return { entities, blocks, particles: [...particles].sort(), sounds: sounds.sort(), locomotion, items: [...items].sort() };
}

/** Conteúdo TS do módulo do manifesto (mesmos exports do stub). */
export function manifestModuleSource(manifest) {
	const json = (v) => JSON.stringify(v);
	return [
		"// Gerado no build por tools/selftest/manifest.mjs a partir dos packs mesclados em dist/.",
		`export const SELFTEST_MANIFEST_BUILT = true;`,
		`export const SELFTEST_ENTITIES = ${json(manifest.entities)};`,
		`export const SELFTEST_BLOCKS = ${json(manifest.blocks)};`,
		`export const SELFTEST_PARTICLES = ${json(manifest.particles)};`,
		`export const SELFTEST_SOUNDS = ${json(manifest.sounds)};`,
		`export const SELFTEST_LOCOMOTION = ${json(manifest.locomotion ?? {})};`,
		`export const SELFTEST_ITEMS = ${json(manifest.items ?? [])};`,
		"",
	].join("\n");
}

/**
 * Plugin do esbuild: troca cada `selfTestManifest.ts` de scripts/ (qualquer pasta) pelos dados de `dist` (o pack da marca
 * `@selftest-pack`, ou o base). Sem o pack em dist/, fica o stub.
 */
export function selfTestManifestPlugin({ dist }) {
	return {
		name: "selftest-manifest",
		setup(b) {
			b.onLoad({ filter: /[\\/]scripts[\\/](.+[\\/])?selfTestManifest\.ts$/ }, (args) => {
				let source = "";
				try { source = readFileSync(args.path, "utf8"); } catch { }
				const pack = manifestPackOf(source);
				if (!existsSync(join(dist, "resource_packs", pack))) return undefined;
				return { contents: manifestModuleSource(readSelfTestManifest(dist, pack)), loader: "ts" };
			});
		},
	};
}
