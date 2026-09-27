// Frente ui-cliente: regras do carregador de JSON UI do CLIENTE Bedrock que o BDS não confere (o servidor não carrega UI).
//
// Reproduz os erros do content log do cliente real (Windows, 26.x) que deixaram as telas roteadas vazias:
//  - `Type not specified (or @-base not found) for control:` — item de `controls` sem nome (`[{ "type": ... }]` em vez de
//    `[{ "nome": { "type": ... } }]`) ou controle sem `type` e sem `@base` resolvível. O cliente descarta o controle.
//  - `Unknown property [collection_name]` — `collection_name` num tipo que não é coleção (ex.: `panel`). A coleção não
//    existe, então os filhos não recebem índice.
//  - `Unknown property [collection_index]` — índice fixo num controle cujo PAI não é um contêiner de coleção.
//  - (com a vanilla) propriedade que nenhum controle do mesmo tipo usa na vanilla (typo/propriedade de outro tipo).
//
// Usado por tools/check-ui-baseline.mjs (com o bedrock-samples) e por tests/ui-cliente.test.ts (sem a vanilla: regras
// estruturais e a tabela de contêineres de coleção abaixo, que é a medida no bedrock-samples v1.26.50.4).

/** Tipos que aceitam `collection_name` na vanilla 26.50 (grid 133×, stack_panel 93×, collection_panel 3×, grid_page_indicator 1×). */
export const COLLECTION_TYPES = ["grid", "stack_panel", "collection_panel", "grid_page_indicator"];

/** Chaves de estrutura que não são propriedades de controle. */
const STRUCTURAL = new Set(["controls", "bindings", "modifications", "variables", "property_bag", "button_mappings", "factory", "anims"]);

/** "nome@ns.base" → { name, base } */
export function splitKey(key) {
	const at = key.indexOf("@");
	return at < 0 ? { name: key, base: undefined } : { name: key.slice(0, at), base: key.slice(at + 1) };
}

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Índice "ns.elemento" → { key, value, ns } de todos os elementos de topo.
 * @param {Array<object>} files JSONs parseados (com `namespace`)
 */
function indexElements(files, into = new Map()) {
	for (const json of files) {
		if (!isObject(json) || typeof json.namespace !== "string") continue;
		for (const [key, value] of Object.entries(json)) {
			if (key === "namespace") continue;
			into.set(`${json.namespace}.${splitKey(key).name}`, { key, value, ns: json.namespace });
		}
	}
	return into;
}

/** Tipo de um controle: `type` próprio ou o da cadeia de `@base`. `null` = base não encontrada; `"$"` = tipo por variável. */
function resolveType(key, value, ns, elements, assumeNamespaces, depth = 0) {
	if (depth > 40) return null;
	if (isObject(value) && typeof value.type === "string") return value.type.startsWith("$") ? "$" : value.type;
	const { base } = splitKey(key);
	if (!base) return null;
	if (base.startsWith("$")) return "$";
	const full = base.includes(".") ? base : `${ns}.${base}`;
	const target = elements.get(full);
	if (!target) return assumeNamespaces && !assumeNamespaces.has(full.split(".")[0]) ? "?" : null;
	return resolveType(target.key, target.value, target.ns, elements, assumeNamespaces, depth + 1);
}

/** Regras aprendidas da vanilla: propriedades por tipo e tipos com `collection_name`. */
export function deriveVanillaRules(vanillaFiles) {
	const elements = indexElements(vanillaFiles);
	const propsByType = new Map();
	const collectionTypes = new Set();
	const visit = (key, value, ns) => {
		if (!isObject(value)) return;
		const type = resolveType(key, value, ns, elements);
		if (type && type !== "$") {
			const props = propsByType.get(type) ?? new Set();
			for (const k of Object.keys(value)) if (!k.startsWith("$")) props.add(k);
			propsByType.set(type, props);
			if ("collection_name" in value) collectionTypes.add(type);
		}
		for (const el of Array.isArray(value.controls) ? value.controls : [])
			if (isObject(el)) for (const [k, v] of Object.entries(el)) visit(k, v, ns);
	};
	for (const json of vanillaFiles) {
		if (!isObject(json) || typeof json.namespace !== "string") continue;
		for (const [k, v] of Object.entries(json)) if (k !== "namespace") visit(k, v, json.namespace);
	}
	// Propriedades gerais de controle (offset, alpha, visible...): usadas em 5 tipos ou mais. As de coleção têm regra própria.
	const typesByProp = new Map();
	for (const [type, props] of propsByType) for (const k of props) typesByProp.set(k, (typesByProp.get(k) ?? 0) + 1);
	const commonProps = new Set([...typesByProp].filter(([k, n]) => n >= 5 && !k.startsWith("collection_")).map(([k]) => k));
	return { elements, propsByType, collectionTypes, commonProps };
}

/**
 * Confere os arquivos de UI do pack.
 * @param {Map<string, object>} portFiles nome do arquivo → JSON parseado
 * @param {{ vanilla?: ReturnType<typeof deriveVanillaRules>, vanillaFileNames?: Set<string> }} options
 *   `vanilla` ausente: bases em namespaces que não são do pack são aceitas (sem conferir propriedades por tipo).
 * @returns {string[]} erros
 */
export function checkUiRules(portFiles, options = {}) {
	const errors = [];
	const vanilla = options.vanilla;
	const vanillaNames = options.vanillaFileNames ?? new Set(["hud_screen.json", "server_form.json"]);
	const portNamespaces = new Set([...portFiles.values()].map((j) => j?.namespace).filter((ns) => typeof ns === "string"));
	const elements = indexElements([...portFiles.values()], new Map(vanilla?.elements ?? []));
	// Sem a vanilla, só os namespaces do pack precisam resolver.
	const assume = vanilla ? undefined : portNamespaces;
	const collectionTypes = vanilla?.collectionTypes?.size ? vanilla.collectionTypes : new Set(COLLECTION_TYPES);

	const checkControl = (file, path, key, value, ns, parent) => {
		if (!isObject(value)) { errors.push(`${file}: ${path}: controle "${key}" não é objeto`); return; }
		const type = resolveType(key, value, ns, elements, assume);
		if (type === null && !key.startsWith("$")) errors.push(`${file}: ${path}: Type not specified (or @-base not found) — "${key}" sem "type" e sem @base resolvível`);
		if ("collection_name" in value && type && type !== "$" && type !== "?" && !collectionTypes.has(type))
			errors.push(`${file}: ${path}: Unknown property [collection_name] em "${type}" (use ${[...collectionTypes].join("/")})`);
		if ("collection_index" in value) {
			const ok = parent && "collection_name" in parent.value && (parent.type === "$" || parent.type === "?" || collectionTypes.has(parent.type));
			if (!ok) errors.push(`${file}: ${path}: Unknown property [collection_index] (o pai precisa ser ${[...collectionTypes].join("/")} com collection_name)`);
		}
		if (vanilla && type && type !== "$" && type !== "?") {
			const known = vanilla.propsByType.get(type);
			if (known) for (const k of Object.keys(value)) {
				if (k.startsWith("$") || STRUCTURAL.has(k) || k === "type" || known.has(k) || vanilla.commonProps?.has(k)) continue;
				if (k === "collection_name" || k === "collection_index") continue; // regra própria acima
				errors.push(`${file}: ${path}: propriedade "${k}" nunca usada em controles "${type}" na vanilla`);
			}
		}
		checkControls(file, path, value.controls, ns, { value, type });
	};

	const checkControls = (file, path, controls, ns, parent) => {
		if (controls === undefined || (typeof controls === "string" && controls.startsWith("$"))) return;
		if (!Array.isArray(controls)) { errors.push(`${file}: ${path}: "controls" não é lista`); return; }
		controls.forEach((el, i) => {
			const where = `${path}.controls[${i}]`;
			if (!isObject(el)) { errors.push(`${file}: ${where}: item de controls não é objeto`); return; }
			const keys = Object.keys(el);
			const unnamed = keys.length !== 1 || !isObject(el[keys[0]]);
			if (unnamed) {
				errors.push(`${file}: ${where}: item de controls sem nome — precisa ser { "nome[@base]": { ... } } com uma chave (tem: ${keys.slice(0, 5).join(", ")})`);
				return;
			}
			checkControl(file, `${where}.${keys[0]}`, keys[0], el[keys[0]], ns, parent);
		});
	};

	for (const [file, json] of portFiles) {
		if (!isObject(json) || typeof json.namespace !== "string") continue;
		const ns = json.namespace;
		const mergesVanilla = vanillaNames.has(file);
		for (const [key, value] of Object.entries(json)) {
			if (key === "namespace" || !isObject(value)) continue;
			// Arquivo no caminho da vanilla: os elementos de topo são mesclados com os da vanilla; confira só o que entra.
			if (mergesVanilla || "modifications" in value) {
				for (const mod of Array.isArray(value.modifications) ? value.modifications : [])
					if (mod?.array_name === "controls" && Array.isArray(mod.value)) checkControls(file, `${key}.modifications`, mod.value, ns, undefined);
				if (Array.isArray(value.controls)) checkControls(file, key, value.controls, ns, undefined);
				continue;
			}
			// Animações.
			if ("anim_type" in value) continue;
			checkControl(file, key, key, value, ns, undefined);
		}
	}
	return errors;
}
