// Texturas animadas (flipbook) dos resolvers do Cobblemon → arrays de textura no render controller.
//
// Cobblemon (AnimatedModelTextureSupplier): quadro = floor(state.animationSeconds × fps) % quadros (sem loop:
// fica no último). variants.ts continua reduzindo a textura ao 1º quadro (é a chave da combinação); aqui o 1º
// quadro é reconhecido e expandido. No Bedrock cada quadro vira uma Texture.* e o array do canal tem
// combos × F entradas (F = maior nº de quadros do canal), indexado por variant·F + quadro — materiais vanilla,
// sem .material custom. Relógio: v.cobblemon_tex_t acumulado com q.delta_time no pre_animation.
import { BEDROCK_POKEMON, readJson, walk } from "./util.ts";

export interface Flipbook {
	/** ids das texturas ("cobblemon:textures/...png"), na ordem. */
	frames: string[];
	fps: number;
	loop: boolean;
}

let cache: Map<string, Flipbook> | undefined;

/** 1º quadro → flipbook, lido de todos os resolvers (base e camadas). */
export function loadFlipbooks(): Map<string, Flipbook> {
	if (cache) return cache;
	cache = new Map();
	const add = (t: any) => {
		if (!t || typeof t !== "object" || !Array.isArray(t.frames) || t.frames.length < 2) return;
		const frames = t.frames.filter((f: unknown) => typeof f === "string");
		if (frames.length < 2 || cache!.has(frames[0])) return;
		cache!.set(frames[0], { frames, fps: Number(t.fps) > 0 ? Number(t.fps) : 10, loop: t.loop !== false });
	};
	for (const file of walk(`${BEDROCK_POKEMON}/resolvers`, (n) => n.endsWith(".json"))) {
		for (const v of readJson(file)?.variations ?? []) {
			add(v.texture);
			for (const l of v.layers ?? []) add(l?.texture);
		}
	}
	return cache;
}

/** Flipbook cuja textura (1º quadro) é `textureId`, se for animada. */
export function flipbookOf(textureId: string | undefined): Flipbook | undefined {
	return textureId ? loadFlipbooks().get(textureId) : undefined;
}

/** Entrada de um canal (textura base ou camada) numa combinação. */
export interface ChannelFrames {
	/** chaves de textura da client entity (1 = estática; 0 = camada ausente → blank). */
	keys: string[];
	fps: number;
	loop: boolean;
}

export const TEX_CLOCK = "v.cobblemon_tex_t";

/**
 * Array e expressão de índice de um canal. Sem nenhuma combinação animada devolve o formato antigo
 * (um item por combinação). `preAnimation` traz o relógio e, quando fps/nº de quadros variam entre as
 * combinações, a variável do quadro por variante.
 */
export function flipbookChannel(combos: ChannelFrames[], variantExpr: string, channelVar: string): { array: string[]; index: string; preAnimation: string[] } {
	const F = Math.max(1, ...combos.map((c) => c.keys.length));
	if (F === 1) return { array: combos.map((c) => `Texture.${c.keys[0] ?? "blank"}`), index: `Array.tex[${variantExpr}]`, preAnimation: [] };
	const array: string[] = [];
	for (const c of combos) for (let k = 0; k < F; k++) array.push(`Texture.${c.keys.length ? c.keys[Math.min(k, c.keys.length - 1) % c.keys.length] : "blank"}`);
	const frameOf = (c: ChannelFrames) => {
		const n = c.keys.length;
		const raw = `math.floor(${TEX_CLOCK} * ${c.fps})`;
		return c.loop ? `math.mod(${raw}, ${n})` : `math.min(${raw}, ${n - 1})`;
	};
	const animated = combos.filter((c) => c.keys.length > 1);
	const same = animated.every((c) => c.fps === animated[0].fps && c.keys.length === animated[0].keys.length && c.loop === animated[0].loop);
	const pre = [`${TEX_CLOCK} = (${TEX_CLOCK} ?? 0) + q.delta_time;`];
	let frame: string;
	if (same) frame = frameOf(animated[0]);
	else {
		// Cadeia por variante só com as animadas; estáticas repetem a mesma textura nos F quadros.
		let chain = "0";
		combos.forEach((c, i) => {
			if (c.keys.length > 1) chain = `(${variantExpr} == ${i}) ? ${frameOf(c)} : (${chain})`;
		});
		pre.push(`${channelVar} = ${chain};`);
		frame = channelVar;
	}
	return { array, index: `Array.tex[${variantExpr} * ${F} + ${frame}]`, preAnimation: pre };
}
