// Frente otimizacao (#6): condição "variant ∈ índices" compacta. Antes era sempre `v == a || v == b || …` (Pikachu:
// 1.584 comparações por frame no pior caso). Agora cada trecho do conjunto vira o mais barato de:
//   - um valor:                         v == a                                            (1 comparação)
//   - uma faixa a..b (3+ seguidos):     (v >= a && v <= b)                                (2)
//   - uma progressão a, a+d, …, b (d≥2, 4+ termos, a ≥ 0):
//                                       (v >= a && v <= b && math.mod(v, d) == a % d)     (3 + 1 math.mod)
// Mesma função booleana para TODO inteiro (e a variante é sempre inteira: propriedade int cobblemon:variant):
// - a polaridade é a mesma da versão antiga (negação `!(…)` só quando a antiga usava negação), então fora de
//   [0, total) o valor também é o mesmo;
// - cada termo é limitado a [a, b] ⊂ [0, total), então para v < −1 ou v > total os dois lados são constantes.
// `compactVariantCondition` confere isso no próprio import, avaliando o texto emitido (parser do Bedrock) para todo v
// em [−2, total + 1] contra o conjunto (erro no import se divergir). tests/otimizacao.test.ts repete a prova.
import { evaluate } from "./molangEnv.ts";

export const VARIANT_VAR = "v.cobblemon_variant";

/** A versão antiga, sem mudança (usada para decidir quais camadas viram filtro: a regra das ≤ 6 comparações fica). */
export function legacyVariantCondition(indices: number[], total: number): string | undefined {
	if (indices.length === total) return undefined;
	const others = [...Array(total).keys()].filter((i) => !indices.includes(i));
	if (others.length < indices.length) return `!(${others.map((i) => `${VARIANT_VAR} == ${i}`).join(" || ")})`;
	return indices.map((i) => `${VARIANT_VAR} == ${i}`).join(" || ");
}

interface Term { text: string; cost: number; calls: number }

const eq = (a: number): Term => ({ text: `${VARIANT_VAR} == ${a}`, cost: 1, calls: 0 });
const range = (a: number, b: number): Term => ({ text: `(${VARIANT_VAR} >= ${a} && ${VARIANT_VAR} <= ${b})`, cost: 2, calls: 0 });
const progression = (a: number, b: number, d: number): Term => ({
	text: `(${VARIANT_VAR} >= ${a} && ${VARIANT_VAR} <= ${b} && math.mod(${VARIANT_VAR}, ${d}) == ${a % d})`,
	cost: 3,
	calls: 1,
});

/** Menor lista de termos (programação dinâmica sobre os índices em ordem; trechos contíguos na lista ordenada). */
export function membershipTerms(set: number[]): string[] {
	const xs = [...new Set(set)].sort((a, b) => a - b);
	const n = xs.length;
	const best: Array<{ cost: number; calls: number; terms: Term[] }> = Array(n + 1);
	best[n] = { cost: 0, calls: 0, terms: [] };
	const better = (a: { cost: number; calls: number }, b: { cost: number; calls: number } | undefined) =>
		!b || a.cost < b.cost || (a.cost === b.cost && a.calls < b.calls);
	for (let i = n - 1; i >= 0; i--) {
		const take = (term: Term, next: number) => {
			const rest = best[next];
			const cand = { cost: term.cost + rest.cost, calls: term.calls + rest.calls, terms: [term, ...rest.terms] };
			if (better(cand, best[i])) best[i] = cand;
		};
		take(eq(xs[i]), i + 1);
		if (i + 1 < n) {
			const d = xs[i + 1] - xs[i];
			let j = i + 1;
			while (j + 1 < n && xs[j + 1] - xs[j] === d) j++;
			// Todo prefixo i..k (k ≤ j) do trecho em progressão é candidato.
			for (let k = i + 2; k <= j; k++) {
				const count = k - i + 1;
				if (d === 1) take(range(xs[i], xs[k]), k + 1);
				else if (count >= 4 && xs[i] >= 0) take(progression(xs[i], xs[k], d), k + 1);
			}
		}
	}
	return best[0].terms.map((t) => t.text);
}

/** Comparações (==, >=, <=) de uma condição: a medida do relatório (pior caso por frame). */
export function comparisonCount(expr: string): number {
	return (expr.match(/==|>=|<=/g) ?? []).length;
}

/**
 * Condição compacta com a MESMA polaridade da antiga (undefined = todas as variantes, igual à antiga). Confere o
 * texto emitido contra o conjunto para todo inteiro relevante e lança erro se divergir.
 */
export function compactVariantCondition(indices: number[], total: number): string | undefined {
	if (indices.length === total) return undefined;
	const set = new Set(indices);
	const others = [...Array(total).keys()].filter((i) => !set.has(i));
	const negated = others.length < indices.length;
	// Conjunto vazio: a antiga devolvia "" (o chamador trata como "sem condição"); mantém igual.
	if (!negated && !indices.length) return "";
	const terms = membershipTerms(negated ? others : indices);
	const text = negated ? `!(${terms.join(" || ")})` : terms.join(" || ");
	assertSameMembership(text, (v) => (negated ? !others.includes(v) : set.has(v)), total);
	return text;
}

/** Prova: o texto vale `member(v)` para todo v em [−2, total + 1] (fora disso os dois lados são constantes). */
export function assertSameMembership(text: string, member: (v: number) => boolean, total: number): void {
	const env = { vars: new Map<string, number>(), props: new Map<string, number>() };
	for (let v = -2; v <= total + 1; v++) {
		env.vars.set(VARIANT_VAR, v);
		const got = evaluate(text, env) !== 0;
		if (got !== member(v)) throw new Error(`condição de variante compacta diverge em v=${v} (total ${total}): ${text.slice(0, 200)}`);
	}
}
