// Frente "comparadores": saída de comparador da Healing Machine (#143) e do Metronome (#74), como a panela (#40).
//
// Acrescenta aos blocos já gerados (tools/importer/blocks.ts) os estados `cobblemon:comparator_faces` (máscara das faces
// com comparador, 0..15) e, na Healing Machine, `cobblemon:comparator_high` (o sinal vem do medidor `cobblemon:charge`
// mais esse bit; ver scripts/comparadores/logic.ts), com uma permutação `minecraft:redstone_producer` por (força,
// máscara) ligada só nas faces com comparador. Os blocos não podem ter `minecraft:redstone_consumer` (com ele o
// produtor das permutações é ignorado; medido na panela). O script (scripts/comparadores/index.ts) grava os estados.
import { OUT_BP, count, tryReadJson, warn, writeJson } from "./util.ts";
import {
	COMPARATOR_FACES_STATE, facesOf, HEALER_HIGH_STATE, healerPermutations, metronomePermutations, PRODUCER_FORMAT,
} from "../../scripts/comparadores/logic.ts";
import type { ProducerPermutation } from "../../scripts/comparadores/logic.ts";

function versionAtLeast(v: string | undefined, min: string): boolean {
	const a = String(v ?? "0").split(".").map(Number);
	const b = min.split(".").map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d !== 0) return d > 0;
	}
	return true;
}

/** Produtor das permutações sem sinal (ver patch). */
export const BASE_PRODUCER = { power: 0, connected_faces: [] as string[] };

function range(n: number): number[] {
	return Array.from({ length: n }, (_, i) => i);
}

function patch(name: string, states: Record<string, unknown>, perms: ProducerPermutation[]): void {
	const file = `${OUT_BP}/blocks/cobblemon/${name}.json`;
	const j = tryReadJson(file);
	const b = j?.["minecraft:block"];
	if (!b?.description) {
		warn("comparadores: bloco não gerado", name);
		return;
	}
	const all = [b.components ?? {}, ...(b.permutations ?? []).map((p: { components?: unknown }) => p.components ?? {})];
	if (all.some((c: Record<string, unknown>) => "minecraft:redstone_consumer" in c)) {
		warn("comparadores: bloco com redstone_consumer (o produtor das permutações seria ignorado)", name);
		return;
	}
	if (b.description.states?.[COMPARATOR_FACES_STATE]) return;
	b.description.states = { ...(b.description.states ?? {}), ...states };
	// Produtor base de força 0: sem ele, a troca para uma permutação sem produtor deixa o último sinal preso no circuito
	// (medido no BDS: 10 → estados zerados, comparador e fio continuam em 10); entre produtores a queda propaga (10 → 1).
	b.components = { ...(b.components ?? {}), "minecraft:redstone_producer": { ...BASE_PRODUCER } };
	b.permutations = [
		...(b.permutations ?? []),
		...perms.map((p) => ({ condition: p.condition, components: { "minecraft:redstone_producer": { power: p.power, connected_faces: facesOf(p.mask) } } })),
	];
	if (!versionAtLeast(j.format_version, PRODUCER_FORMAT)) j.format_version = PRODUCER_FORMAT;
	writeJson(file, j);
	count("blocos com comparador (comparadores)");
}

/** Chamado pelo index.ts depois dos blocos gerados. */
export function emitComparadores(): void {
	patch("healing_machine", { [COMPARATOR_FACES_STATE]: range(16), [HEALER_HIGH_STATE]: [false, true] }, healerPermutations());
	patch("metronome", { [COMPARATOR_FACES_STATE]: range(16) }, metronomePermutations());
}
