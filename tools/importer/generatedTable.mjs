// Frente otimizacao (#8): leitura TEXTUAL de uma tabela de um módulo gerado (sem executar TS), para quem lê
// generated/scripts/*.ts como texto (readGeneratedTable do MSD, E2E). Aceita os dois formatos:
//   export const NOME: Tipo = JSON.parse("{…}");     (desde a frente otimizacao: variants, entityData, habitats, actionEffects)
//   export const NOME: Tipo = {                       (literal, uma entrada `\t"id": {...},` por linha)
//   export const NOME: Tipo = {…};                    (literal JSON numa linha, #8 desligado)
// Devolve o objeto (id → valor); {} se a tabela não existir.

/** @param {string} text @param {string} name @returns {Record<string, any>} */
export function readGeneratedTableText(text, name) {
	const lines = text.split("\n");
	const start = lines.findIndex((l) => l.startsWith(`export const ${name}:`) || l.startsWith(`export const ${name} `));
	if (start < 0) return {};
	const parsed = /=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\);\s*$/.exec(lines[start]);
	if (parsed) return JSON.parse(JSON.parse(parsed[1]));
	// Literal JSON numa linha só (jsonValueExpression com o #8 desligado).
	const inline = /=\s*(\{.*\});\s*$/.exec(lines[start]);
	if (inline) return JSON.parse(inline[1]);
	const out = {};
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("}")) break;
		const m = /^\t("(?:[^"\\]|\\.)*"): (.*?),?$/.exec(line);
		if (m) out[JSON.parse(m[1])] = JSON.parse(m[2]);
	}
	return out;
}
