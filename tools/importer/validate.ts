// Validador estático do conteúdo gerado (o BDS só valida o lado do BP; erros de RP só aparecem no cliente).
//   node --experimental-strip-types tools/importer/validate.ts
// Verifica: JSON válido; referências da client entity (geometria, textura, animação, controller, render
// controller, sons, partículas); animações usadas pelos controllers; tamanhos dos arrays dos render
// controllers = combos de variants.ts = faixa de cobblemon:variant; ids duplicados; nomes de funções Molang;
// e que resolveVariant (gerado) concorda com a semântica do importador.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { BEDROCK_MATH, BEDROCK_QUERIES, scanMolang } from "./molang.ts";
import { checkParticle, checkSoundDefinitions } from "./clientRules.ts";
import { validateClientModels } from "./validateClientModels.ts"; // frente cliente-modelos
import { validateMolangVariables } from "./validateVariables.ts"; // frente cliente-teste3-log
import { blockZFights, coplanarConflicts, geometryFaces } from "./zfight.ts"; // frente fix3
import { HAND_BP, HAND_RP, OUT, OUT_BP, OUT_FINAL, OUT_RP, OUT_SCRIPTS, parseLenient, rel, walk } from "./util.ts";
import { comboKey, loadResolvers, resolveCombo } from "./variants.ts";
import { validateContent } from "./validateContent.ts";
import { itemsHiddenFromCommands, mergedDocs } from "./commandVisibility.ts";
import { readFileSync } from "node:fs";

const errors: string[] = [];
const warnings: string[] = [];
const err = (m: string) => errors.push(m);
const warnMsg = (m: string) => warnings.push(m);

function load(file: string): any {
	try {
		return parseLenient(readFileSync(file, "utf8"));
	} catch (e) {
		err(`JSON inválido: ${rel(file)}: ${(e as Error).message}`);
		return undefined;
	}
}

if (!existsSync(OUT_RP)) {
	console.error("generated/ não existe: rode `npm run import` antes");
	process.exit(1);
}

// 1. Todos os JSON gerados precisam parsear.
const genJson = [...walk(OUT_RP, (n) => n.endsWith(".json")), ...walk(OUT_BP, (n) => n.endsWith(".json"))];
const docs = new Map<string, any>();
for (const f of genJson) docs.set(f, load(f));
// 1b. O build junta o escrito à mão no mesmo caminho relativo (objetos mesclados, arrays concatenados): as checagens
// abaixo veem o JSON já mesclado, como fica em dist/ (um overlay não pode esconder, por exemplo, um array dobrado).
const handCounterpart = (f: string) => {
	const hand = f.startsWith(OUT_RP) ? HAND_RP + f.slice(OUT_RP.length) : f.startsWith(OUT_BP) ? HAND_BP + f.slice(OUT_BP.length) : undefined;
	return hand && existsSync(hand) ? hand : undefined;
};
for (const [f, j] of mergedDocs(docs, handCounterpart, load)) docs.set(f, j);

// 2. Índices (gerado + escrito à mão, como o build junta).
const geometryIds = new Map<string, string>();
const animationIds = new Map<string, string>();
const controllerIds = new Map<string, string>();
const renderControllerIds = new Map<string, string>();
const clientEntities = new Map<string, string>();
const dup = (map: Map<string, string>, id: string, file: string, kind: string) => {
	const prev = map.get(id);
	// Mesmo caminho relativo no gerado e no escrito à mão: o build junta os dois (deep-merge), não é duplicata.
	const packPath = (f: string) => f.startsWith(OUT_RP) ? f.slice(OUT_RP.length) : f.startsWith(HAND_RP) ? f.slice(HAND_RP.length) : f;
	if (prev && prev !== file && packPath(prev) !== packPath(file)) err(`${kind} duplicado: ${id} (${rel(prev)} e ${rel(file)})`);
	map.set(id, file);
};
for (const root of [OUT_RP, HAND_RP]) {
	const generated = root === OUT_RP;
	for (const f of walk(`${root}/models`, (n) => n.endsWith(".json"))) {
		const j = generated ? docs.get(f) : load(f);
		for (const g of j?.["minecraft:geometry"] ?? []) dup(geometryIds, g.description?.identifier, f, "geometria");
		for (const k of Object.keys(j ?? {})) if (k.startsWith("geometry.")) dup(geometryIds, k.split(":")[0], f, "geometria");
	}
	for (const f of walk(`${root}/animations`, (n) => n.endsWith(".json"))) {
		const j = generated ? docs.get(f) : load(f);
		for (const id of Object.keys(j?.animations ?? {})) dup(animationIds, id, f, "animação");
	}
	for (const f of walk(`${root}/animation_controllers`, (n) => n.endsWith(".json"))) {
		const j = generated ? docs.get(f) : load(f);
		for (const id of Object.keys(j?.animation_controllers ?? {})) dup(controllerIds, id, f, "animation controller");
	}
	for (const f of walk(`${root}/render_controllers`, (n) => n.endsWith(".json"))) {
		const j = generated ? docs.get(f) : load(f);
		for (const id of Object.keys(j?.render_controllers ?? {})) dup(renderControllerIds, id, f, "render controller");
	}
	for (const f of walk(`${root}/entity`, (n) => n.endsWith(".json"))) {
		const j = generated ? docs.get(f) : load(f);
		const id = j?.["minecraft:client_entity"]?.description?.identifier;
		if (id) dup(clientEntities, id, f, "client entity");
	}
}
// Texturas do pacote vanilla usadas de propósito (skins padrão do NPC com skin de jogador; ícones do jogo).
const VANILLA_TEXTURES = new Set(["textures/entity/steve", "textures/entity/alex", "textures/misc/enchanted_item_glint"]);
const textureExists = (ref: string) => VANILLA_TEXTURES.has(ref) || [OUT_RP, HAND_RP].some((r) => [".png", ".tga", ".jpg"].some((e) => existsSync(`${r}/${ref}${e}`)));
const soundDefs = new Set<string>();
// Frente cliente-log: o cliente acusa "Invalid asset path" para QUALQUER definição (gerada ou escrita à mão) cujo
// arquivo não exista no pack montado. Checa a árvore MESCLADA (gerado + à mão, como em dist/).
const soundFileExists = (name: string) => [OUT_RP, HAND_RP].some((r) => [".ogg", ".wav", ".fsb"].some((e) => existsSync(`${r}/${name}${e}`)));
for (const f of [`${OUT_RP}/sounds/sound_definitions.json`, `${HAND_RP}/sounds/sound_definitions.json`]) {
	if (!existsSync(f)) continue;
	// docs já tem o gerado mesclado com o à mão; o à mão sozinho só entra se não houver gerado.
	if (f.startsWith(HAND_RP) && docs.has(`${OUT_RP}/sounds/sound_definitions.json`)) continue;
	const j = f.startsWith(OUT_RP) ? docs.get(f) : load(f);
	for (const k of Object.keys(j?.sound_definitions ?? {})) soundDefs.add(k);
	for (const p of checkSoundDefinitions(j?.sound_definitions ?? {}, soundFileExists)) err(p);
}
const particleIds = new Set<string>();
for (const f of walk(`${HAND_RP}/particles`, (n) => n.endsWith(".json"))) {
	const j = load(f);
	const id = j?.particle_effect?.description?.identifier;
	if (id) particleIds.add(id);
	// Frente cliente-log: o que o cliente recusa na partícula (componentes, colisão, flipbook, sons de evento).
	for (const p of checkParticle(j)) err(`${rel(f)}: ${p}`);
}
// Partículas geradas (frente animacao: particles.ts): ids, componentes, eventos, texturas e Molang.
let generatedParticles = 0;
const genParticles = [...docs].filter(([f]) => f.startsWith(`${OUT_RP}/particles/`));
for (const [f, j] of genParticles) {
	const id = j?.particle_effect?.description?.identifier;
	if (!id) err(`${rel(f)}: partícula sem identifier`);
	else {
		if (particleIds.has(id)) err(`partícula duplicada: ${id} (${rel(f)})`);
		particleIds.add(id);
	}
	generatedParticles++;
	for (const p of checkParticle(j)) err(`${rel(f)}: ${p}`);
}

// 3. Molang: só queries/funções conhecidas do Bedrock.
const molangIssues = new Map<string, number>();
function checkMolang(expr: unknown, where: string): void {
	if (typeof expr !== "string") return;
	scanMolang(expr, (call) => {
		const name = call.name.toLowerCase();
		if ((call.prefix === "q" || call.prefix === "query") && !BEDROCK_QUERIES.has(name)) molangIssues.set(`q.${name} (${where})`, (molangIssues.get(`q.${name} (${where})`) ?? 0) + 1);
		if (call.prefix === "math" && !BEDROCK_MATH.has(name)) molangIssues.set(`math.${name} (${where})`, (molangIssues.get(`math.${name} (${where})`) ?? 0) + 1);
		return undefined;
	});
}
function checkDeep(v: any, where: string): void {
	if (typeof v === "string") checkMolang(v, where);
	else if (Array.isArray(v)) v.forEach((x) => checkDeep(x, where));
	else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "lerp_mode" && k !== "effect" && k !== "locator") checkDeep(x, where);
}
for (const [f, j] of docs) {
	if (f.includes("/animations/")) for (const [id, a] of Object.entries<any>(j?.animations ?? {})) {
		checkDeep(a.bones, id);
		checkDeep(a.timeline, id);
		for (const k of ["anim_time_update", "blend_weight", "start_delay", "loop_delay"]) checkMolang(a[k], id);
	}
}

// 3b. Partículas geradas: Molang, componentes só do Bedrock, eventos que disparam partículas/sons existentes, textura.
for (const [f, j] of genParticles) {
	const pe = j?.particle_effect ?? {};
	const id = pe.description?.identifier ?? rel(f);
	for (const k of Object.keys(pe.components ?? {})) if (!k.startsWith("minecraft:")) err(`${id}: componente não-Bedrock ${k}`);
	const tex = pe.description?.basic_render_parameters?.texture;
	if (typeof tex === "string" && tex.startsWith("textures/") && !tex.startsWith("textures/blocks/") && !textureExists(tex)) err(`${id}: textura ${tex} não existe`);
	for (const [name, ev] of Object.entries<any>(pe.events ?? {})) {
		const dep = ev?.particle_effect?.effect;
		if (dep && !particleIds.has(dep)) err(`${id}: evento ${name} dispara partícula inexistente ${dep}`);
		const snd = ev?.sound_effect?.event_name;
		if (snd && String(snd).startsWith("cobblemon.") && !soundDefs.has(snd)) err(`${id}: evento ${name} toca som sem definição ${snd}`);
	}
	const visit = (v: any, key = ""): void => {
		if (typeof v === "string") {
			if (!["texture", "material", "effect", "identifier", "type", "event_name", "event", "mode", "facing_camera_mode", "direction"].includes(key)) checkMolang(v, id);
		} else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
		else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, k);
	};
	visit(pe.components);
	visit(pe.events);
	visit(pe.curves);
}

// 4. Controllers: coletar as chaves curtas usadas por estado.
const controllerAnims = new Map<string, Set<string>>();
for (const [f, j] of docs) {
	if (!f.includes("/animation_controllers/")) continue;
	for (const [id, c] of Object.entries<any>(j?.animation_controllers ?? {})) {
		const used = new Set<string>();
		const states = c.states ?? {};
		if (c.initial_state && !states[c.initial_state]) err(`${id}: initial_state inexistente ${c.initial_state}`);
		for (const [sn, s] of Object.entries<any>(states)) {
			for (const a of s.animations ?? []) {
				if (typeof a === "string") used.add(a);
				else for (const [k, cond] of Object.entries(a)) {
					used.add(k);
					checkMolang(cond, id);
				}
			}
			for (const t of s.transitions ?? []) for (const [to, cond] of Object.entries(t)) {
				if (!states[to]) err(`${id}/${sn}: transição para estado inexistente ${to}`);
				checkMolang(cond, id);
			}
			for (const e of [...(s.on_entry ?? []), ...(s.on_exit ?? [])]) checkMolang(e, id);
		}
		controllerAnims.set(id, used);
	}
}

// 5. Variants gerados (para tamanhos de arrays e resolveVariant).
const variantsMod: any = await import(pathToFileURL(`${OUT_SCRIPTS}/variants.ts`).href);
const VARIANTS: Record<string, any> = variantsMod.VARIANTS;

// 6. Client entities.
let entities = 0;
for (const [f, j] of docs) {
	if (!f.startsWith(`${OUT_RP}/entity/`) || f.startsWith(`${OUT_RP}/entity/pokeballs/`)) continue;
	entities++;
	const d = j?.["minecraft:client_entity"]?.description;
	if (!d) {
		err(`${rel(f)}: sem minecraft:client_entity.description`);
		continue;
	}
	const id: string = d.identifier;
	const speciesId = id.split(":")[1];
	for (const [k, g] of Object.entries<string>(d.geometry ?? {})) if (!geometryIds.has(g)) err(`${id}: geometria ${k}=${g} não existe`);
	// textures/blocks/* = textura do RP vanilla (mesma regra das partículas; frente adaptacoes: padrões do vaso decorado).
	for (const [k, t] of Object.entries<string>(d.textures ?? {})) if (!textureExists(t) && !t.startsWith("textures/blocks/")) err(`${id}: textura ${k}=${t} não existe`);
	const animMap: Record<string, string> = d.animations ?? {};
	for (const [k, a] of Object.entries(animMap)) {
		if (a.startsWith("controller.animation.")) {
			if (!controllerIds.has(a)) err(`${id}: controller ${a} não existe`);
			for (const used of controllerAnims.get(a) ?? []) if (!(used in animMap)) err(`${id}: controller ${a} usa '${used}' ausente do mapa animations`);
		} else if (!animationIds.has(a)) err(`${id}: animação ${k}=${a} não existe`);
	}
	for (const a of d.scripts?.animate ?? []) {
		const keys = typeof a === "string" ? [a] : Object.keys(a);
		for (const k of keys) if (!(k in animMap)) err(`${id}: scripts.animate usa '${k}' fora do mapa animations`);
		if (typeof a === "object") for (const c of Object.values(a)) checkMolang(c, id);
	}
	for (const s of [...(d.scripts?.pre_animation ?? []), ...(d.scripts?.initialize ?? [])]) checkMolang(s, id);
	for (const [k, s] of Object.entries<string>(d.sound_effects ?? {})) if (!soundDefs.has(s)) err(`${id}: sound_effect ${k}=${s} sem definição`);
	for (const [k, p] of Object.entries<string>(d.particle_effects ?? {})) if (!particleIds.has(p)) err(`${id}: particle_effect ${k}=${p} não existe`);
	const combos: number | undefined = VARIANTS[speciesId]?.combos.length;
	// NPC (frente social) não é espécie: sem variants.ts; o resto das checagens vale igual.
	// Entidades de exibição (frente mundo-detalhes: estante de discos, feto do tanque) também não são espécie.
	if (combos === undefined && !f.startsWith(`${OUT_RP}/entity/npc/`) && !f.startsWith(`${OUT_RP}/entity/display/`)) err(`${id}: espécie ausente de variants.ts`);
	for (const rc of d.render_controllers ?? []) {
		const rcId = typeof rc === "string" ? rc : Object.keys(rc)[0];
		if (typeof rc === "object") checkMolang(Object.values(rc)[0], id);
		const rcFile = renderControllerIds.get(rcId);
		if (!rcFile) {
			err(`${id}: render controller ${rcId} não existe`);
			continue;
		}
		const def = docs.get(rcFile)?.render_controllers?.[rcId];
		if (!def) continue;
		for (const kind of ["geometries", "textures", "materials"]) {
			for (const [arr, list] of Object.entries<string[]>(def.arrays?.[kind] ?? {})) {
				// Texturas animadas (flipbook): combos × quadros; o índice multiplica a variante pelo nº de quadros.
				const frames = kind === "textures" && combos ? list.length / combos : 1;
				const flipbook = frames > 1 && Number.isInteger(frames) && (def.textures ?? []).some((t: string) => t.includes(`* ${frames} +`));
				if (combos !== undefined && list.length !== combos && !flipbook) err(`${rcId}: ${arr} tem ${list.length} itens, variants.ts tem ${combos} combos`);
				for (const ref of list) {
					const [ns, key] = ref.split(".");
					const table = ns.toLowerCase() === "geometry" ? d.geometry : ns.toLowerCase() === "texture" ? d.textures : ns.toLowerCase() === "material" ? d.materials : undefined;
					if (!table || !(key in table)) err(`${rcId}: ${ref} não está na client entity`);
				}
			}
		}
		checkMolang(def.geometry, rcId);
		for (const t of def.textures ?? []) checkMolang(t, rcId);
		for (const m of def.materials ?? []) for (const [, v] of Object.entries<string>(m)) {
			const key = v.split(".")[1];
			if (v.toLowerCase().startsWith("material.") && !(key in (d.materials ?? {}))) err(`${rcId}: ${v} não está na client entity`);
		}
	}
}

// 6a. Frente cliente-log: client entities escritas à mão (barcos, pesca, máquinas) também precisam de geometria que
// exista no pack ou no vanilla como JSON ("geometry.boat" é do renderer nativo do barco: o cliente acusa "geometry not
// found?" e a entidade fica invisível). Vanilla aceita: só as que existem em models/ do bedrock-samples.
const VANILLA_ENTITY_GEOMETRIES = new Set(["geometry.villager_v2", "geometry.villager.baby"]);
for (const f of walk(`${HAND_RP}/entity`, (n) => n.endsWith(".json"))) {
	if (docs.has(OUT_RP + f.slice(HAND_RP.length))) continue; // overlay de uma gerada: já conferida acima
	const d = load(f)?.["minecraft:client_entity"]?.description;
	if (!d) continue;
	for (const [k, g] of Object.entries<string>(d.geometry ?? {})) if (!geometryIds.has(g) && !VANILLA_ENTITY_GEOMETRIES.has(g)) err(`${rel(f)}: geometria ${k}=${g} não existe (o cliente acusa "geometry not found?")`);
	// Texturas não: as escritas à mão podem citar as do RP vanilla (aldeão v2), que o cliente resolve.
}

// 6b. Attachables (frente mundo-detalhes: vestíveis): geometria, textura e render controller existem.
const VANILLA_GEOMETRIES = new Set(["geometry.bow_standby"]);
const VANILLA_RENDER_CONTROLLERS = new Set(["controller.render.item_default"]);
const VANILLA_ANIMATIONS = new Set(["animation.bow.wield"]);
let attachables = 0;
for (const [f, j] of docs) {
	if (!f.startsWith(`${OUT_RP}/attachables/`)) continue;
	attachables++;
	const d = j?.["minecraft:attachable"]?.description;
	const id = d?.identifier ?? rel(f);
	if (!d) { err(`${rel(f)}: sem minecraft:attachable.description`); continue; }
	for (const [k, g] of Object.entries<string>(d.geometry ?? {})) if (!geometryIds.has(g) && !VANILLA_GEOMETRIES.has(g)) err(`${id}: geometria ${k}=${g} não existe`);
	for (const [k, t] of Object.entries<string>(d.textures ?? {})) if (!textureExists(t)) err(`${id}: textura ${k}=${t} não existe`);
	for (const [k, a] of Object.entries<string>(d.animations ?? {})) if (!animationIds.has(a) && !VANILLA_ANIMATIONS.has(a)) err(`${id}: animação ${k}=${a} não existe`);
	for (const rc of d.render_controllers ?? []) {
		const rcId = typeof rc === "string" ? rc : Object.keys(rc)[0];
		if (!renderControllerIds.has(rcId) && !VANILLA_RENDER_CONTROLLERS.has(rcId)) err(`${id}: render controller ${rcId} não existe`);
	}
}

// 7. Entidades do BP: faixa de cobblemon:variant e eventos exigidos pelos scripts.
let serverEntities = 0;
for (const [f, j] of docs) {
	if (!f.startsWith(`${OUT_BP}/entities/`)) continue;
	serverEntities++;
	const e = j?.["minecraft:entity"];
	const id: string = e?.description?.identifier;
	// Overrides vanilla (frente mundo-detalhes: tags de comida) não são Pokémon.
	if (f.startsWith(`${OUT_BP}/entities/vanilla_overrides/`)) continue;
	if (f.startsWith(`${OUT_BP}/entities/npc/`) || f.startsWith(`${OUT_BP}/entities/display/`)) {
		// NPC (frente social): só precisa da client entity; faixa de variant/eventos são de Pokémon.
		if (!clientEntities.has(id)) err(`${id}: sem client entity`);
		continue;
	}
	const speciesId = id?.split(":")[1];
	if (!clientEntities.has(id)) err(`${id}: sem client entity`);
	const range = e?.description?.properties?.["cobblemon:variant"]?.range;
	const combos = VARIANTS[speciesId]?.combos.length;
	if (!range || (combos !== undefined && range[1] < combos - 1)) err(`${id}: faixa de cobblemon:variant ${JSON.stringify(range)} não cobre ${combos} combos`);
	for (const ev of ["cobblemon:set_wild", "cobblemon:set_owned", "cobblemon:instant_kill", "cobblemon:interacted"]) {
		if (!e?.events?.[ev]) err(`${id}: evento ${ev} ausente`);
	}
	if (JSON.stringify(e).includes("queue_command")) err(`${id}: usa queue_command`);
}
for (const f of walk(`${HAND_BP}/entities`, (n) => n.endsWith(".json"))) {
	const id = load(f)?.["minecraft:entity"]?.description?.identifier;
	if (id && existsSync(`${OUT_BP}/entities/pokemon/${String(id).split(":")[1]}.json`)) err(`id de entidade repetido no BP escrito à mão: ${id}`);
}

// 8. resolveVariant gerado ≡ semântica do importador (para os aspects de cada variação e pares).
const resolvers = loadResolvers();
let checks = 0;
for (const [speciesId, entry] of Object.entries(VARIANTS)) {
	const variations = resolvers.get(speciesId) ?? [];
	const sets: string[][] = [[], ...variations.map((v) => v.aspects)];
	for (let i = 0; i < variations.length && i < 30; i++) for (let k = i + 1; k < variations.length && k < 30; k++) sets.push([...variations[i].aspects, ...variations[k].aspects]);
	for (const set of sets) {
		const idx = variantsMod.resolveVariant(speciesId, set);
		checks++;
		if (!Number.isInteger(idx) || idx < 0 || idx >= entry.combos.length) {
			err(`${speciesId}: resolveVariant(${set}) = ${idx} fora da faixa`);
			continue;
		}
		const expected = resolveCombo(variations, set);
		const c = entry.combos[idx];
		const got = comboKey({ poser: c.poser, model: c.model, texture: c.texture, layers: c.layers.map((l: string) => ({ name: l.slice(0, l.indexOf("=")), texture: l.slice(l.indexOf("=") + 1) })) });
		// Só é erro se a combinação exata existia (combos descartados por falta de assets caem na mais parecida).
		if (got !== comboKey(expected) && entry.combos.some((x: any) => comboKey({ ...x, layers: x.layers.map((l: string) => ({ name: l.slice(0, l.indexOf("=")), texture: l.slice(l.indexOf("=") + 1) })) }) === comboKey(expected))) {
			err(`${speciesId}: resolveVariant(${set}) não bate com o resolver (${got} ≠ ${comboKey(expected)})`);
		}
	}
}

for (const [k, n] of molangIssues) err(`Molang desconhecido: ${k}${n > 1 ? ` ×${n}` : ""}`);

// 8b. Spawns: toda espécie citada (entrada e membros de herd) existe em species.ts.
{
	const speciesMod: any = await import(pathToFileURL(`${OUT_SCRIPTS}/species.ts`).href);
	const spawnsMod: any = await import(pathToFileURL(`${OUT_SCRIPTS}/spawns.ts`).href);
	const known = new Set(Object.keys(speciesMod.SPECIES ?? {}));
	const missing = new Set<string>();
	for (const entry of spawnsMod.SPAWNS ?? []) {
		for (const s of [entry.species, ...(entry.herd?.members ?? []).map((m: any) => m.species)]) if (s && !known.has(s)) missing.add(s);
	}
	for (const s of missing) err(`spawn de espécie inexistente em species.ts: ${s}`);
}

// 8c. Frente cliente-modelos: o que o cliente recusa em modelos, animações, controllers e client entities.
const clientModels = validateClientModels(docs, err, rel);
// Frente cliente-teste3-log: variáveis lidas sem definição (partículas, client entities) e planos de espessura zero nas
// geometrias de entidade (z-fighting).
const molangVariables = validateMolangVariables(docs, err, rel);

// 8d. Frente fix3: z-fighting em blocos (faces coplanares sobrepostas). Faces opostas com material que desenha as duas
// (alpha_test) são erro (piscam dos dois lados); faces do mesmo lado entre cubos só entram no resumo (vêm dos modelos do
// Java — ex. escadas, baús — e piscam só de perto). Pokémon: cubos do mesmo osso ainda coplanares (zfight.ts).
{
	const blockGeos = new Map<string, any>();
	const blockFiles: string[] = [];
	for (const [f, j] of docs) {
		if (f.includes("/models/")) for (const g of j?.["minecraft:geometry"] ?? []) if (g?.description?.identifier) blockGeos.set(g.description.identifier, g);
		if (j?.["minecraft:block"]) blockFiles.push(f);
	}
	let opposite = 0, sameSide = 0, sameSideBlocks = 0;
	for (const f of blockFiles) {
		// O BDS avisa "All MaterialInstances must use the same render_method for a given block" (medido no BDS fix3).
		const b = docs.get(f)?.["minecraft:block"];
		const methods = new Set<string>();
		for (const c of [b?.components, ...(b?.permutations ?? []).map((p: any) => p?.components)]) {
			for (const m of Object.values<any>(c?.["minecraft:material_instances"] ?? {})) if (m && typeof m === "object") methods.add(m.render_method ?? "opaque");
		}
		if (methods.size > 1) err(`${rel(f)}: material instances com render_method diferentes (${[...methods].join(", ")}); o motor exige um só por bloco`);
		for (const r of blockZFights(docs.get(f), (id) => blockGeos.get(id))) {
			const opp = r.pairs.filter((z) => z.opposite);
			const same = r.pairs.filter((z) => !z.opposite);
			if (opp.length) {
				opposite += opp.length;
				err(`${rel(f)}: ${r.geometry} tem ${opp.length} par(es) de faces opostas no mesmo plano com material de dois lados (z-fighting; use alpha_test_single_sided): ${opp.slice(0, 2).map((z) => `${z.a.bone}#${z.a.cube}.${z.a.dir}~${z.b.bone}#${z.b.cube}.${z.b.dir}`).join(", ")}`);
			}
			if (same.length) { sameSide += same.length; sameSideBlocks++; }
		}
	}
	let pokemonPairs = 0;
	for (const [f, j] of docs) {
		if (!f.includes("/models/entity/pokemon/")) continue;
		for (const g of j?.["minecraft:geometry"] ?? []) pokemonPairs += coplanarConflicts(geometryFaces(g), { doubleSided: false, minArea: 0.05 }).filter((z) => z.a.bone === z.b.bone).length;
	}
	console.log(`Z-fighting: blocos com faces opostas coplanares ${opposite}; faces do mesmo lado em ${sameSideBlocks} bloco(s) (${sameSide} pares, dos modelos do Java); Pokémon: ${pokemonPairs} par(es) no mesmo osso`);
}

// 9. Itens, blocos, receitas, loot e worldgen.
const contentSummary = await validateContent(err, warnMsg);

// 9b. Frente give: todo item precisa ser aceito pelo /give (regra medida no BDS em commandVisibility.ts).
const hiddenFromCommands = itemsHiddenFromCommands(OUT_BP, HAND_BP);
for (const h of hiddenFromCommands) err(`${h.id}: /give não aceita o item (${h.reason}): ${rel(h.file)}`);

console.log(`Partículas geradas: ${generatedParticles}`);
console.log(`Validação: ${docs.size} JSON, ${entities} client entities, ${serverEntities} entidades BP, ${geometryIds.size} geometrias, ${animationIds.size} animações, ${controllerIds.size} animation controllers, ${renderControllerIds.size} render controllers, ${attachables} attachables, ${checks} checagens de resolveVariant`);
console.log(`Conteúdo: ${contentSummary}`);
console.log(`Cliente (modelos): ${Object.entries(clientModels).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`Cliente (variáveis e planos): ${molangVariables.particles} partículas, ${molangVariables.entities} client entities e ${molangVariables.geometries} geometrias de entidade conferidas`);
for (const w of warnings.slice(0, 50)) console.log(`  aviso: ${w}`);
if (errors.length) {
	// COBBLEMON_VALIDATE_ALL=1 lista todos (frente cliente-teste3-log).
	const shown = process.env.COBBLEMON_VALIDATE_ALL ? errors.length : 80;
	for (const e of errors.slice(0, shown)) console.log(`  ERRO: ${e}`);
	if (errors.length > shown) console.log(`  ... +${errors.length - shown} erros`);
	console.log(`${errors.length} erro(s)`);
	// exitCode (não process.exit): com a saída num pipe, process.exit cortava a lista longa (frente cliente-teste3-log).
	process.exitCode = 1;
}
else console.log("OK: nenhum erro");
void warnMsg;
