// Frente otimizacao (#8): tabelas grandes dos módulos gerados como `JSON.parse("…")` em vez de literal de objeto. O
// QuickJS do Bedrock compila um literal de objeto nó a nó (bytecode de cada chave e valor); uma string é um único
// token e o JSON.parse é nativo (VARIANTS no QuickJS: 148 → 65 ms). O valor é o mesmo: o texto é o JSON.stringify
// de cada entrada, na mesma ordem. Custo: a string fica no bytecode do módulo (memória, ver docs/pendencias/otimizacao.md).
// Uma linha só: quem lê o módulo como texto usa tools/importer/generatedTable.mjs (aceita os dois formatos).
//
// Guardas (erro no import, nunca um valor diferente):
// - `"__proto__"` num literal troca o protótipo; no JSON.parse vira chave própria. Nenhuma chave pode se chamar assim.
// - O tsc deixa de ver o literal (JSON.parse devolve any): `typeCheckModule` emite uma cópia com o literal tipado só
//   para o `npm run check` (generated/scripts/_tipos, fora do bundle), mantendo a checagem de tipo dos dados.

/** #8 ligado? Desligado na beta 7 (memória em console); religar é só trocar para true. */
export const USE_JSON_PARSE = false;

/** Chave que muda de sentido entre literal e JSON.parse. */
const PROTO_KEY = "__proto__";

function assertNoProtoKey(value: unknown, where: string): void {
	if (Array.isArray(value)) {
		for (const v of value) assertNoProtoKey(v, where);
		return;
	}
	if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			if (k === PROTO_KEY) throw new Error(`${where}: chave "__proto__" não pode ir para JSON.parse`);
			assertNoProtoKey(v, where);
		}
	}
}

/** Linhas `\t"id": valor` (sem vírgula) de uma tabela. */
export function tableLines(entries: Iterable<[string, unknown]>, where: string): string[] {
	const lines: string[] = [];
	for (const [id, value] of entries) {
		if (id === PROTO_KEY) throw new Error(`${where}: chave "__proto__" não pode ir para JSON.parse`);
		assertNoProtoKey(value, `${where}.${id}`);
		lines.push(`\t${JSON.stringify(id)}: ${JSON.stringify(value)}`);
	}
	return lines;
}

/** `JSON.parse("{…}")` com as entradas de `tableLines`, na mesma ordem (uma linha). */
export function jsonTableExpression(lines: string[], where: string): string {
	const text = `{${lines.map((l) => l.slice(1)).join(",")}}`;
	try { JSON.parse(text); } catch (e) { throw new Error(`${where}: JSON inválido (${(e as Error).message})`); }
	// #8 desligado (beta 7): o JSON.parse custa ~4 MB de memória fixa do script, arriscado em console. Literal de volta.
	if (!USE_JSON_PARSE) return objectLiteral(lines);
	return `JSON.parse(${JSON.stringify(text)})`;
}

/** Valor qualquer: `JSON.parse("…")`. */
export function jsonValueExpression(value: unknown, where: string): string {
	assertNoProtoKey(value, where);
	if (!USE_JSON_PARSE) return JSON.stringify(value);
	return `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
}

/** Literal de objeto equivalente (o formato antigo): usado pela cópia só de tipos e pela prova do teste. */
export function objectLiteral(lines: string[]): string {
	return lines.length ? `{\n${lines.map((l) => `${l},`).join("\n")}\n}` : "{}";
}

/**
 * Cópia só para o tsc: `export const NOME_TYPECHECK: Tipo = <literal>;` importando os tipos do módulo real.
 * `imports` = nomes de tipo exportados pelo módulo `module` (ex.: "./variants").
 */
export function typeCheckModule(module: string, imports: string[], tables: Array<{ name: string; type: string; literal: string }>): string {
	return [
		"// Arquivo gerado por tools/importer (npm run import). Não edite à mão.",
		"// Frente otimizacao (#8): o módulo real carrega estas tabelas por JSON.parse; esta cópia com o literal tipado existe",
		"// só para o `npm run check` continuar conferindo os dados contra os tipos. Nada importa este arquivo (fora do bundle).",
		"/* eslint-disable */",
		`import type { ${imports.join(", ")} } from "${module}";`,
		"",
		...tables.map((t) => `export const ${t.name}_TYPECHECK: ${t.type} = ${t.literal};\n`),
	].join("\n");
}
