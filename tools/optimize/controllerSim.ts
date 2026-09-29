// Frente otimizacao (#12): simulador de controllers de animação do Bedrock para a prova de equivalência do gimmick_tint.
// Modelo: estado inicial com on_entry na criação; a cada frame, as transições do estado atual em ordem, a primeira
// verdadeira troca de estado (on_exit do atual, on_entry do novo). Como a documentação não diz se o motor encadeia
// transições no mesmo frame, a prova roda os DOIS modelos (uma transição por frame; encadeadas até parar) e exige
// igualdade nos dois.
import { evaluate, execute } from "../importer/molangEnv.ts";

interface State { on_entry?: string[]; on_exit?: string[]; transitions?: Record<string, string>[] }
interface Controller { initial_state?: string; states: Record<string, State> }

class Machine {
	state: string;
	env = { vars: new Map<string, number>(), props: new Map<string, number>() };
	private c: Controller;
	private chained: boolean;
	constructor(c: Controller, chained: boolean) {
		this.c = c;
		this.chained = chained;
		this.state = c.initial_state ?? "default";
		for (const e of c.states[this.state].on_entry ?? []) execute(e, this.env);
	}
	frame(props: Record<string, number>): void {
		for (const [k, v] of Object.entries(props)) this.env.props.set(k, v);
		for (let step = 0; step < (this.chained ? 16 : 1); step++) {
			const st = this.c.states[this.state];
			const next = (st.transitions ?? []).map((t) => Object.entries(t)[0]).find(([, cond]) => evaluate(cond, this.env) !== 0)?.[0];
			if (next === undefined) return;
			for (const e of st.on_exit ?? []) execute(e, this.env);
			this.state = next;
			for (const e of this.c.states[next].on_entry ?? []) execute(e, this.env);
		}
	}
	/** Variáveis observáveis (as que os render controllers leem); `hidden` = variáveis internas da versão nova. */
	snapshot(hidden: Set<string>): string {
		return [...this.env.vars].filter(([k]) => !hidden.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(";");
	}
}

const only = (file: any): Controller => Object.values<Controller>(file.animation_controllers)[0];

export interface SimResult { checks: number; frames: number; differences: string[] }

/**
 * Antigo × novo: todas as sequências de 3 valores em [−1, 23] (cada um por 1 e por 3 frames) e 20 mil frames
 * aleatórios (semente fixa), nos dois modelos de transição. Compara as variáveis observáveis a cada frame.
 */
export function simulateControllers(oldFile: any, newFile: any, property = "cobblemon:gimmick", hidden = new Set(["v.cobblemon_gimmick_e"])): SimResult {
	const a = only(oldFile), b = only(newFile);
	const out: SimResult = { checks: 0, frames: 0, differences: [] };
	const domain: number[] = [];
	for (let v = -1; v <= 23; v++) domain.push(v);
	const run = (seq: number[], chained: boolean) => {
		const ma = new Machine(a, chained), mb = new Machine(b, chained);
		if (ma.snapshot(hidden) !== mb.snapshot(hidden)) out.differences.push(`criação: ${ma.snapshot(hidden)} × ${mb.snapshot(hidden)}`);
		for (let i = 0; i < seq.length; i++) {
			ma.frame({ [property]: seq[i] });
			mb.frame({ [property]: seq[i] });
			out.frames++;
			const sa = ma.snapshot(hidden), sb = mb.snapshot(hidden);
			if (sa !== sb && out.differences.length < 20) out.differences.push(`${chained ? "encadeado" : "1 por frame"} [${seq.slice(0, i + 1).join(",")}]: ${sa} × ${sb}`);
		}
	};
	for (const chained of [false, true]) {
		for (const x of domain) for (const y of domain) for (const z of domain) {
			out.checks++;
			run([x, y, z], chained);
			run([x, x, x, y, y, y, z, z, z], chained);
		}
		let seed = 12345;
		const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
		const seq: number[] = [];
		for (let i = 0; i < 20000; i++) seq.push(rnd() < 0.5 ? (seq[i - 1] ?? 0) : domain[Math.floor(rnd() * domain.length)]);
		run(seq, chained);
	}
	return out;
}
