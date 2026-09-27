// Frente fix3 (docs/pendencias/cliente-teste2.md): `armor_offset.default_neck` entre as formas de uma espécie.
//
// O cliente cria sozinho o locator `armor_offset.default_neck` nas geometrias que têm os ossos `head` e `body`, na
// posição do `body` (no humanoide do vanilla o pivô do corpo é o pescoço, [0, 24, 0]). Numa client entity com várias
// geometrias (g0, g1...), os locators vão para uma tabela só, por nome: se o `body` de g1 tem outro pivô que o de g0,
// sai "Locator: Error: model already has a locator armor_offset.default_neck that doesn't exactly match ... in g1(...)".
// Prova, com os dois content logs do cliente:
//  - sem declarar nada (beta 1): 18 entidades; a regra "head + body, pivô do body diferente da primeira" acerta as 18
//    (nuzleaf: só o body muda, 10 → 10,1; aipom: cabeça diferente, body igual → sem erro) e erra 1 (avalugg);
//  - declarando o locator igual em todas (frente cliente-modelos): as 364 geometrias acusadas são exatamente as com
//    `head` e `body` (367 previstas, 0 faltando): o automático entra de qualquer jeito e colide com o declarado.
//
// Correção: nas geometrias com `head` + `body` cujo pivô do `body` difere da primeira da entidade, o osso `head` vira
// `cobblemon_head` (sem `head` o cliente não cria o locator), e toda animação da entidade que mexe em `head` ganha o
// mesmo canal para `cobblemon_head` — a forma continua olhando e animando igual. Animação para um osso que a
// geometria não tem é ignorada pelo cliente.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./util.ts";

export const HEAD_BONE = "head";
export const RENAMED_HEAD_BONE = "cobblemon_head";

const isHead = (b: any) => typeof b?.name === "string" && b.name.toLowerCase() === HEAD_BONE;
const isBody = (b: any) => typeof b?.name === "string" && b.name.toLowerCase() === "body";

/** Locator automático da geometria (pivô do `body`), ou undefined se o cliente não cria (falta `head` ou `body`). */
export function headSignature(geo: any): string | undefined {
	const bones: any[] = geo?.bones ?? [];
	const body = bones.find(isBody);
	if (!body || !bones.some(isHead)) return undefined;
	return JSON.stringify(body.pivot ?? [0, 0, 0]);
}

/** Troca o nome do osso `head` (e o `parent` dos filhos). Devolve false se não havia `head`. */
export function renameHeadBone(geo: any, to = RENAMED_HEAD_BONE): boolean {
	const bones: any[] = geo?.bones ?? [];
	const head = bones.find(isHead);
	if (!head || bones.some((b) => b.name === to)) return false;
	const from = head.name;
	head.name = to;
	for (const b of bones) if (b.parent === from) b.parent = to;
	return true;
}

export const HEAD_LOCATOR_BONE = "cobblemon_head_locators";

/**
 * Locators declarados direto no osso da cabeça passam para um filho sem rotação no mesmo pivô (mesma posição no
 * mundo). A definição do locator inclui o osso: sem isso, renomear `head` → `cobblemon_head` numa forma faria o locator
 * (ex.: `head` do zacian do MSD) divergir do da outra forma. Aplicado a todas as geometrias da entidade afetada.
 */
export function moveHeadLocators(geo: any): boolean {
	const bones: any[] = geo?.bones ?? [];
	const head = bones.find((b) => isHead(b) || b.name === RENAMED_HEAD_BONE);
	if (!head?.locators || !Object.keys(head.locators).length || bones.some((b) => b.name === HEAD_LOCATOR_BONE)) return false;
	bones.splice(bones.indexOf(head) + 1, 0, { name: HEAD_LOCATOR_BONE, parent: head.name, pivot: head.pivot ?? [0, 0, 0], locators: head.locators });
	delete head.locators;
	return true;
}

/** Copia o canal de `head` para `cobblemon_head` (sem sobrescrever). Devolve true se mudou. */
export function mirrorHeadChannel(animation: any): boolean {
	const bones = animation?.bones;
	if (!bones || typeof bones !== "object") return false;
	const key = Object.keys(bones).find((k) => k.toLowerCase() === HEAD_BONE);
	if (!key || bones[RENAMED_HEAD_BONE] !== undefined) return false;
	bones[RENAMED_HEAD_BONE] = structuredClone(bones[key]);
	return true;
}

/**
 * Geometrias (por identificador) de cada client entity: quais precisam do osso renomeado. A primeira geometria com o
 * locator automático define o valor; as outras com valor diferente entram na lista. Repete até estabilizar
 * (uma geometria usada por duas entidades pode mudar quem é a "primeira" da outra).
 */
export function planHeadRenames(entities: Array<{ id: string; geometries: string[] }>, signatureOf: (geometryId: string) => string | undefined): Set<string> {
	const renamed = new Set<string>();
	for (let round = 0; round < 8; round++) {
		let changed = false;
		for (const e of entities) {
			let first: string | undefined;
			for (const g of e.geometries) {
				if (renamed.has(g)) continue;
				const sig = signatureOf(g);
				if (sig === undefined) continue;
				if (first === undefined) first = sig;
				else if (sig !== first) {
					renamed.add(g);
					changed = true;
				}
			}
		}
		if (!changed) break;
	}
	return renamed;
}

function walkJson(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walkJson(p, out);
		else if (f.endsWith(".json")) out.push(p);
	}
	return out;
}

/** Aplica a correção no RP gerado. Devolve [geometrias renomeadas, entidades afetadas, animações com canal copiado]. */
export function fixArmorNeckCollisions(rp: string): { geometries: number; entities: number; animations: number } {
	// Geometrias dos Pokémon: identificador → arquivo.
	const geoFiles = new Map<string, string>();
	const geoCache = new Map<string, any>();
	for (const file of walkJson(join(rp, "models", "entity", "pokemon"))) {
		const json = readJson(file);
		for (const g of json?.["minecraft:geometry"] ?? []) {
			const id = g?.description?.identifier;
			if (typeof id === "string") {
				geoFiles.set(id, file);
				geoCache.set(file, json);
			}
		}
	}
	const geoOf = (id: string) => {
		const file = geoFiles.get(id);
		return file ? (geoCache.get(file)["minecraft:geometry"] as any[]).find((g) => g.description?.identifier === id) : undefined;
	};
	const entities: Array<{ id: string; geometries: string[]; animations: string[] }> = [];
	for (const file of walkJson(join(rp, "entity", "pokemon"))) {
		const d = readJson(file)?.["minecraft:client_entity"]?.description;
		if (!d?.geometry) continue;
		const geometries = Object.values<string>(d.geometry).filter((g) => typeof g === "string");
		if (geometries.length < 2) continue;
		const animations = Object.values<string>(d.animations ?? {}).filter((a) => typeof a === "string" && a.startsWith("animation."));
		entities.push({ id: d.identifier, geometries, animations });
	}
	const renamed = planHeadRenames(entities, (g) => headSignature(geoOf(g)));
	const touchedFiles = new Set<string>();
	for (const id of renamed) {
		const geo = geoOf(id);
		if (geo && renameHeadBone(geo)) touchedFiles.add(geoFiles.get(id)!);
	}
	// Animações das entidades afetadas.
	const affected = entities.filter((e) => e.geometries.some((g) => renamed.has(g)));
	for (const e of affected) {
		for (const id of e.geometries) {
			const geo = geoOf(id);
			if (geo && moveHeadLocators(geo)) touchedFiles.add(geoFiles.get(id)!);
		}
	}
	for (const file of touchedFiles) writeJson(file, geoCache.get(file));
	const wanted = new Set(affected.flatMap((e) => e.animations));
	let animations = 0;
	if (wanted.size) {
		for (const file of walkJson(join(rp, "animations"))) {
			const json = readJson(file);
			let changed = false;
			for (const [id, anim] of Object.entries<any>(json?.animations ?? {})) {
				if (wanted.has(id) && mirrorHeadChannel(anim)) {
					changed = true;
					animations++;
				}
			}
			if (changed) writeJson(file, json);
		}
	}
	return { geometries: touchedFiles.size ? renamed.size : 0, entities: affected.length, animations };
}
