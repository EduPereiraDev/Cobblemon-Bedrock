// Build público ("limpo"): nada do Mega Showdown no pacote. A licença do MSD (v2.1) permite só uso privado e proíbe
// redistribuir derivados, então o release público não pode levar as tabelas geradas do MSD nem o código da extensão.
//
// - `cleanBuildPlugin` (esbuild): `@private/*` vira o stub público (scripts/extensions/privateStub.ts); qualquer módulo
//   em scripts/extensions/megaShowdown/ vira um stub inerte; os módulos de dados do MSD em generated/ (scripts/msd*.ts,
//   scripts/megaShowdown*.ts, msd/**) viram stubs vazios com os mesmos exports.
// - `forbiddenInBundle`, `leakedInputs` e `checkPublicDist`: a guarda do release público (tools/build.mjs sai com erro).
// Sem import do esbuild aqui: os testes importam este módulo pelo bundle deles.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Código da extensão privada (escrito à mão, fora do repositório público). */
export const EXTENSION_MODULE = /[\\/]scripts[\\/]extensions[\\/]megaShowdown[\\/].*\.[cm]?[jt]s$/;
/** Tabelas geradas a partir do MSD (tools/importer/msdScripts.ts, msdScriptData.ts; generated/msd/). */
export const MSD_DATA_MODULE = /[\\/]generated[\\/](msd[\\/].*|scripts[\\/](msd|megaShowdown)[^\\/]*)\.[cm]?[jt]s$/;
/** Qualquer entrada do bundle com cara de MSD que não foi trocada por stub é vazamento. */
const MSD_INPUT = /(^|[\\/])(scripts[\\/]extensions[\\/]megaShowdown[\\/]|generated[\\/]msd[\\/]|generated[\\/]scripts[\\/](msd|megaShowdown)[^\\/]*$)|mega_?showdown/i;
/** Textos que não podem aparecer no main.js público (namespace do MSD, exports das tabelas, nome do pack). */
export const FORBIDDEN_IN_BUNDLE = /mega_showdown|MSD_[A-Z][A-Z_]*|CobblemonMegaShowdown/g;
/**
 * Arquivos de texto dos packs públicos que a guarda lê. O `.map` (só no build sem --release) fica de fora: ele embute o
 * fonte público inteiro, comentários inclusive, e o que entra no bundle já é conferido pelo metafile (`leakedInputs`).
 */
const TEXT_FILE = /\.(json|lang|js|txt|mcfunction|material|md)$/i;

/** Valor vazio com o mesmo "formato" do inicializador de um export de dados. */
function emptyValue(init) {
	const c = init[0];
	if (c === '"' || c === "'" || c === "`") return '""';
	if (c === "{") return "{}";
	if (c === "[") return "[]";
	if (c === "-" || (c >= "0" && c <= "9")) return "0";
	if (init.startsWith("new Map")) return "new Map()";
	if (init.startsWith("new Set")) return "new Set()";
	if (init.startsWith("true") || init.startsWith("false")) return "false";
	if (init.startsWith("null")) return "null";
	if (c === "(" || init.startsWith("async") || init.startsWith("function")) return "() => undefined";
	return "undefined";
}

/**
 * Stub com os mesmos exports de `source` (TS/JS): funções viram no-op que devolvem undefined, classes ficam vazias e
 * constantes ficam vazias no formato do inicializador ("" / {} / [] / 0). Tipos somem. Export que não dá para listar
 * (`export *`, desestruturação) é erro: melhor o build falhar do que publicar algo pela metade.
 */
export function stubModule(source, file = "?") {
	const out = new Map();
	for (const match of source.matchAll(/^export\b[^\n]*/gm)) {
		const line = match[0];
		let m;
		if (/^export\s+(declare\s+)?(type|interface)\b/.test(line) || /^export\s+type\s*\{/.test(line)) continue;
		if ((m = /^export\s+(?:declare\s+)?(?:async\s+)?function\*?\s+([\w$]+)/.exec(line))) out.set(m[1], `export function ${m[1]}() { return undefined; }`);
		else if ((m = /^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([\w$]+)/.exec(line))) out.set(m[1], `export class ${m[1]} {}`);
		else if ((m = /^export\s+(?:declare\s+)?(?:const\s+)?enum\s+([\w$]+)/.exec(line))) out.set(m[1], `export const ${m[1]} = {};`);
		else if ((m = /^export\s+(?:declare\s+)?(?:const|let|var)\s+([\w$]+)[^=]*?=\s*(.*)$/.exec(line))) {
			// O inicializador pode começar na linha seguinte (`= \n{`): olha o texto logo depois do `=`.
			const init = m[2].trim() || source.slice(match.index + line.length).trimStart();
			out.set(m[1], `export const ${m[1]} = ${emptyValue(init)};`);
		} else if (/^export\s+default\b/.test(line)) out.set("default", "export default undefined;");
		else if ((m = /^export\s*\{([^}]*)\}/.exec(line))) {
			for (const part of m[1].split(",")) {
				const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
				if (!name || /^type\s/.test(part.trim())) continue;
				out.set(name, name === "default" ? "export default undefined;" : `export const ${name} = undefined;`);
			}
		} else throw new Error(`build público: export que o stub não entende em ${file}: ${line.slice(0, 120)}`);
	}
	return `// Stub do build público (tools/cleanBuild.mjs): nada do Mega Showdown aqui.\n${[...out.values()].join("\n")}\n`;
}

/**
 * Plugin do build público. `stubbed` recebe o caminho absoluto de cada módulo trocado. `extensions: false` mantém o
 * código da extensão e troca só os dados (usado nos testes: o módulo dormente sem dados fica inativo).
 */
export function cleanBuildPlugin({ root, stubbed = new Set(), extensions = true }) {
	const stubFile = join(root, "scripts", "extensions", "privateStub.ts");
	return {
		name: "cobblemon-clean-build",
		setup(b) {
			if (extensions) {
				b.onResolve({ filter: /^@private\// }, () => {
					stubbed.add(stubFile);
					return { path: stubFile };
				});
				b.onLoad({ filter: EXTENSION_MODULE }, (args) => {
					stubbed.add(args.path);
					return { contents: stubModule(readFileSync(args.path, "utf8"), args.path), loader: "js" };
				});
			}
			b.onLoad({ filter: MSD_DATA_MODULE }, (args) => {
				stubbed.add(args.path);
				return { contents: stubModule(readFileSync(args.path, "utf8"), args.path), loader: "js" };
			});
		},
	};
}

/** Ocorrências proibidas no main.js público: [texto, quantidade]. Vazio = ok. */
export function forbiddenInBundle(text) {
	const hits = new Map();
	for (const m of text.matchAll(FORBIDDEN_IN_BUNDLE)) hits.set(m[0], (hits.get(m[0]) ?? 0) + 1);
	return [...hits];
}

/** Entradas do metafile com cara de MSD que NÃO foram trocadas por stub (caminhos relativos a `cwd`). */
export function leakedInputs(metafile, stubbed, cwd = process.cwd()) {
	return Object.keys(metafile.inputs).filter((p) => MSD_INPUT.test(p) && !stubbed.has(resolve(cwd, p)));
}

/**
 * Guarda dos packs do release público: nenhum arquivo/pasta com "mega_showdown"/"MegaShowdown" no nome em `dist` e
 * nenhum "mega_showdown" dentro dos arquivos de texto dos packs. Devolve a lista de problemas (vazia = ok).
 */
export function checkPublicDist(dist) {
	const problems = [];
	const walk = (dir) => {
		if (!existsSync(dir)) return;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			const rel = relative(dist, p);
			if (/mega_?showdown/i.test(e.name)) problems.push(`arquivo do MSD: ${rel}`);
			if (e.isDirectory()) walk(p);
			else if (TEXT_FILE.test(e.name) && readFileSync(p, "utf8").includes("mega_showdown")) problems.push(`"mega_showdown" dentro de ${rel}`);
		}
	};
	walk(dist);
	return problems;
}
