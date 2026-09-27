// Ferramenta de manutenção (não roda no `npm run import`): gera tools/importer/data/java_bedrock_blocks.json, o
// subconjunto da tabela Java → Bedrock de estados de bloco que as estruturas do Cobblemon usam.
//
// Fonte: PrismarineJS/minecraft-data (MIT), data/bedrock/1.26.30/blocksJ2B.json (Java "nome[props]" →
// Bedrock "nome[estados]"). Uso:
//   curl -o /tmp/j2b.json https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/bedrock/1.26.30/blocksJ2B.json
//   node --experimental-strip-types tools/importer/data/buildBlockMap.ts /tmp/j2b.json
// Chaves parciais (MimicId, final_state de jigsaw, output_state de processadores, que no Java recebem o estado
// padrão) são resolvidas aqui para um estado completo pelas preferências abaixo; nomes renomeados no Java recente
// (grass → short_grass, chain → iron_chain) também.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJavaNbt } from "../nbt.ts";
import { DATA, ROOT, walk } from "../util.ts";

const RENAMES: Record<string, string> = { "minecraft:grass": "minecraft:short_grass", "minecraft:chain": "minecraft:iron_chain" };
/** Valores preferidos para propriedades omitidas (≈ estado padrão do Java). */
const PREFERRED: Record<string, string[]> = {
	waterlogged: ["false"], axis: ["y"], facing: ["north", "up"], half: ["bottom", "lower"], shape: ["straight", "north_south"],
	type: ["single", "bottom"], powered: ["false"], open: ["false"], lit: ["false"], snowy: ["false"], persistent: ["true"],
	distance: ["7"], rotation: ["0"], candles: ["1"], signal_fire: ["false"], hanging: ["false"], attached: ["false"],
	up: ["true"], north: ["none", "false"], east: ["none", "false"], south: ["none", "false"], west: ["none", "false"],
	age: ["0"], level: ["0"], cracked: ["false"], face: ["floor", "wall"], in_wall: ["false"], occupied: ["false"], part: ["foot"],
	dusted: ["0"], bottom: ["false"], stage: ["0"], moisture: ["0"], layers: ["1"], pickles: ["1"], eggs: ["1"], hatch: ["0"],
};

export function javaKey(name: string, props: Record<string, string> = {}): string {
	return `${name}[${Object.keys(props).sort().map((k) => `${k}=${props[k]}`).join(",")}]`;
}

function parseKey(key: string): { name: string; props: Record<string, string> } {
	const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(key)!;
	const props: Record<string, string> = {};
	for (const kv of (m[2] ?? "").split(",").filter(Boolean)) {
		const [k, v] = kv.split("=");
		props[k] = v;
	}
	return { name: m[1], props };
}

function main(j2bFile: string) {
	const j2b: Record<string, string> = JSON.parse(readFileSync(j2bFile, "utf8"));
	const byName = new Map<string, string[]>();
	for (const k of Object.keys(j2b)) {
		const name = k.slice(0, k.indexOf("["));
		let list = byName.get(name);
		if (!list) byName.set(name, list = []);
		list.push(k);
	}
	const wanted = new Set<string>();
	const add = (name: string, props?: Record<string, string>) => {
		if (!name.startsWith("minecraft:")) return;
		wanted.add(javaKey(name, props ?? {}));
	};
	for (const f of walk(join(DATA, "cobblemon", "structure"), (n) => n.endsWith(".nbt"))) {
		const n: any = readJavaNbt(readFileSync(f));
		for (const p of n.palette ?? []) add(p.Name, p.Properties);
		for (const b of n.blocks ?? []) {
			if (b.nbt?.final_state) {
				const { name, props } = parseKey(String(b.nbt.final_state));
				add(name, props);
			}
			if (b.nbt?.MimicId) add(String(b.nbt.MimicId), {});
		}
	}
	const scan = (v: any) => {
		if (Array.isArray(v)) v.forEach(scan);
		else if (v && typeof v === "object") {
			if (v.output_state?.Name) add(v.output_state.Name, v.output_state.Properties);
			if (v.block_state?.Name) add(v.block_state.Name, v.block_state.Properties);
			Object.values(v).forEach(scan);
		}
	};
	for (const f of walk(join(DATA, "cobblemon", "worldgen", "processor_list"), (n) => n.endsWith(".json"))) scan(JSON.parse(readFileSync(f, "utf8")));
	add("minecraft:water", { level: "0" });

	const out: Record<string, string> = {};
	const missing: string[] = [];
	for (const key of [...wanted].sort()) {
		if (j2b[key]) {
			out[key] = j2b[key];
			continue;
		}
		const { name, props } = parseKey(key);
		const candidates = byName.get(RENAMES[name] ?? name) ?? [];
		let best: string | undefined;
		let bestScore = -Infinity;
		for (const c of candidates) {
			const cp = parseKey(c).props;
			if (Object.entries(props).some(([k, v]) => cp[k] !== undefined && cp[k] !== v)) continue;
			let score = 0;
			for (const [k, v] of Object.entries(cp)) {
				if (props[k] !== undefined) continue;
				const pref = PREFERRED[k];
				if (pref) score += pref.includes(v) ? 10 - pref.indexOf(v) : 0;
			}
			if (score > bestScore) { bestScore = score; best = c; }
		}
		if (best) out[key] = j2b[best];
		else missing.push(key);
	}
	const file = join(ROOT, "tools", "importer", "data", "java_bedrock_blocks.json");
	writeFileSync(file, JSON.stringify({ _source: "PrismarineJS/minecraft-data (MIT) data/bedrock/1.26.30/blocksJ2B.json; subconjunto usado pelas estruturas do Cobblemon 1.8.2 (tools/importer/data/buildBlockMap.ts)", blocks: out }));
	console.log(`${Object.keys(out).length} estados mapeados, ${missing.length} sem equivalente`);
	if (missing.length) console.log(missing.join("\n"));
}

if (process.argv[2]) main(process.argv[2]);
