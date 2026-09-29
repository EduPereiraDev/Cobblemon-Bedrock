// Frente otimizacao: prova de equivalência entre dois imports (antes × depois) das mudanças feitas no importador.
//   node --experimental-strip-types --no-warnings tools/optimize/proveImport.ts <generated-antes> <generated-depois>
// #8  tabelas por JSON.parse: todos os exports de variants/entityData/habitats/actionEffects deep-equal.
// #6  condições de variante: cada client entity de Pokémon igual campo a campo, exceto as condições (animate e
//     render_controllers), que são avaliadas para TODO inteiro em [−2, faixa + 2] de cobblemon:variant (0 diferenças),
//     e a linha de inicialização da variável nova do #12 no pre_animation.
// #12 tinta de gimmick: controller antigo × novo simulados lado a lado (todos os estados × todos os valores da
//     propriedade e sequências), mesmas variáveis em todo frame.
// Sai com código 1 se qualquer prova falhar.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluate } from "../importer/molangEnv.ts";
import { comparisonCount } from "../importer/variantConditions.ts";
import { simulateControllers } from "./controllerSim.ts";

const [before, after] = process.argv.slice(2);
if (!before || !after) {
	console.error("uso: proveImport.ts <generated-antes> <generated-depois>");
	process.exit(2);
}
const failures: string[] = [];
const PACK = "CobblemonBedrock";

// #8 ------------------------------------------------------------------------------------------
for (const mod of ["variants", "entityData", "habitats", "actionEffects"]) {
	const a = await import(pathToFileURL(join(before, "scripts", `${mod}.ts`)).href);
	const b = await import(pathToFileURL(join(after, "scripts", `${mod}.ts`)).href);
	for (const k of Object.keys(a)) {
		if (typeof a[k] === "function") continue;
		try { assert.deepStrictEqual(b[k], a[k]); } catch { failures.push(`#8 ${mod}.${k} diferente`); }
	}
	console.log(`#8 ${mod}: ${Object.keys(a).filter((k) => typeof a[k] !== "function").join(", ")} deep-equal`);
}

// #6 ------------------------------------------------------------------------------------------
const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
let conditions = 0, evaluations = 0, cmpBefore = 0, cmpAfter = 0, entities = 0;
const INIT_E = "v.cobblemon_gimmick_e = v.cobblemon_gimmick_e ?? 0;";
for (const pack of [PACK, "CobblemonMegaShowdown"]) {
	const dirA = join(before, "resource_packs", pack, "entity", "pokemon");
	if (!existsSync(dirA)) continue;
	for (const f of readdirSync(dirA)) {
		const da = json(join(dirA, f))["minecraft:client_entity"].description;
		const fb = join(after, "resource_packs", pack, "entity", "pokemon", f);
		if (!existsSync(fb)) { failures.push(`#6 ${pack}/${f} sumiu`); continue; }
		const db = json(fb)["minecraft:client_entity"].description;
		entities++;
		const species = f.replace(/\.entity\.json$/, "");
		const bpFile = [join(after, "behavior_packs", pack, "entities", "pokemon", `${species}.json`), join(after, "behavior_packs", PACK, "entities", "pokemon", `${species}.json`)].find(existsSync);
		const range = bpFile ? json(bpFile)["minecraft:entity"].description.properties["cobblemon:variant"].range[1] : 0;
		const pairs: Array<[string, string]> = [];
		const strip = (d: any) => {
			const copy = JSON.parse(JSON.stringify(d));
			copy.scripts.animate = (copy.scripts.animate ?? []).map((x: any) => (typeof x === "string" ? x : Object.keys(x)[0]));
			copy.render_controllers = (copy.render_controllers ?? []).map((x: any) => (typeof x === "string" ? x : Object.keys(x)[0]));
			// #12: a única linha nova do pre_animation (inicialização da variável do estado `on`).
			// (sozinha numa linha, ou junto das outras inicializações da mesma linha).
			copy.scripts.pre_animation = (copy.scripts.pre_animation ?? []).filter((l: string) => l !== INIT_E).map((l: string) => l.replace(`${INIT_E} `, "").replace(` ${INIT_E}`, ""));
			return copy;
		};
		try { assert.deepStrictEqual(strip(db), strip(da)); } catch { failures.push(`#6 ${pack}/${f}: algo além das condições mudou`); continue; }
		const condOf = (x: any) => (typeof x === "string" ? undefined : Object.values(x)[0] as string);
		(da.scripts.animate ?? []).forEach((x: any, i: number) => { const c = condOf(x); if (c !== undefined) pairs.push([c, condOf(db.scripts.animate[i])!]); });
		(da.render_controllers ?? []).forEach((x: any, i: number) => { const c = condOf(x); if (c !== undefined) pairs.push([c, condOf(db.render_controllers[i])!]); });
		for (const [ca, cb] of pairs) {
			if (cb === undefined) { failures.push(`#6 ${f}: condição virou incondicional`); continue; }
			conditions++;
			cmpBefore += comparisonCount(ca);
			cmpAfter += comparisonCount(cb);
			const env = { vars: new Map<string, number>(), props: new Map<string, number>() };
			for (let v = -2; v <= range + 2; v++) {
				env.vars.set("v.cobblemon_variant", v);
				evaluations++;
				if ((evaluate(ca, env) !== 0) !== (evaluate(cb, env) !== 0)) { failures.push(`#6 ${f}: v=${v} diverge (${cb.slice(0, 80)})`); break; }
			}
		}
	}
}
console.log(`#6 ${entities} client entities, ${conditions} condições, ${evaluations} avaliações; comparações (pior caso, soma) ${cmpBefore} → ${cmpAfter}`);

// #12 -----------------------------------------------------------------------------------------
const CTRL = join("resource_packs", PACK, "animation_controllers", "pokemon", "cobblemon_gimmick_tint.animation_controllers.json");
const sim = simulateControllers(json(join(before, CTRL)), json(join(after, CTRL)));
console.log(`#12 ${sim.checks} comparações de estado×valor e ${sim.frames} frames em sequência; diferenças: ${sim.differences.length}`);
for (const d of sim.differences.slice(0, 10)) failures.push(`#12 ${d}`);

if (failures.length) {
	for (const f of failures.slice(0, 40)) console.error(`FALHA ${f}`);
	console.error(`${failures.length} falha(s)`);
	process.exit(1);
}
console.log("prova do import: OK (0 diferenças)");
