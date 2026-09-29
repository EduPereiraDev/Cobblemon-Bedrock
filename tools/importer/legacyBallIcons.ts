// Ícones das Poké Balls que só existem no port (itens à mão em behavior_packs/.../items/pokeballs). A strange_ball não
// está no registro do Cobblemon 1.8.2 e não tem sprite 2D (só a textura do modelo), então o `minecraft:icon` dela
// apontava para uma chave fora do item_texture. Aqui o ícone da poke_ball do Cobblemon é recolorido com a cor da tampa
// do modelo da própria bola (metade esquerda da textura 64×32, que é a tampa em todos os modelos de bola).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodePng, encodePng } from "./png.ts";
import type { Png } from "./png.ts";
import { ASSETS, HAND_BP, HAND_RP, OUT_RP, parseLenient, walk, warn } from "./util.ts";

/** Pixel "colorido" (tampa) do ícone/modelo: saturação mínima. */
const MIN_SATURATION = 0.35;

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [r + m, g + m, b + m];
}

/** Matiz (média circular) e saturação média dos pixels coloridos da metade esquerda (tampa) da textura do modelo. */
export function capColor(png: Png): { hue: number; saturation: number } | undefined {
	let sx = 0, sy = 0, ss = 0, n = 0;
	for (let y = 0; y < png.height; y++) {
		for (let x = 0; x < png.width / 2; x++) {
			const o = (y * png.width + x) * 4;
			if (png.rgba[o + 3] < 128) continue;
			const [h, s] = rgbToHsv(png.rgba[o] / 255, png.rgba[o + 1] / 255, png.rgba[o + 2] / 255);
			if (s < MIN_SATURATION) continue;
			sx += Math.cos((h * Math.PI) / 180);
			sy += Math.sin((h * Math.PI) / 180);
			ss += s;
			n++;
		}
	}
	if (!n) return undefined;
	const hue = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
	return { hue, saturation: ss / n };
}

/** Pixel do ícone que pertence à tampa: matiz a até 40° da tampa do modelo base (inclui o reflexo claro) e não cinza. */
const TINT_MIN_SATURATION = 0.08;
const TINT_HUE_RANGE = 40;

/** Troca matiz/saturação dos pixels da tampa do ícone (`from` = tampa do modelo do ícone base, `to` = da bola nova). */
export function recolorIcon(icon: Png, from: { hue: number; saturation: number }, to: { hue: number; saturation: number }): Png {
	const rgba = Buffer.from(icon.rgba);
	for (let i = 0; i < rgba.length; i += 4) {
		if (rgba[i + 3] === 0) continue;
		const [h, s, v] = rgbToHsv(rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255);
		const hueDistance = Math.min(Math.abs(h - from.hue), 360 - Math.abs(h - from.hue));
		if (s < TINT_MIN_SATURATION || hueDistance > TINT_HUE_RANGE) continue;
		const [r, g, b] = hsvToRgb(to.hue, Math.min(1, (s * to.saturation) / from.saturation), v);
		rgba[i] = Math.round(r * 255);
		rgba[i + 1] = Math.round(g * 255);
		rgba[i + 2] = Math.round(b * 255);
	}
	return { width: icon.width, height: icon.height, rgba };
}

/** Chave do `minecraft:icon` (string, `texture` ou `textures.default`). */
function iconOf(components: any): string | undefined {
	const icon = components?.["minecraft:icon"];
	return typeof icon === "string" ? icon : icon?.textures?.default ?? icon?.texture;
}

/**
 * Registra no atlas os ícones dos itens de bola à mão que ainda não estão nele. Devolve quantos gerou.
 * O PNG sai em textures/item/poke_balls/port/<bola>.png do RP gerado.
 */
export function legacyBallIcons(atlas: Record<string, { textures: string }>): number {
	const baseIcon = `${ASSETS}/textures/item/poke_balls/poke_ball.png`;
	const baseModel = `${ASSETS}/textures/item/poke_balls/models/poke_ball.png`;
	const icon = existsSync(baseIcon) ? decodePng(baseIcon) : undefined;
	const refModel = existsSync(baseModel) ? decodePng(baseModel) : undefined;
	const from = refModel && capColor(refModel);
	let made = 0;
	for (const f of walk(`${HAND_BP}/items/pokeballs`, (n) => n.endsWith(".json"))) {
		let item: any;
		try { item = parseLenient(readFileSync(f, "utf8"))?.["minecraft:item"]; }
		catch { continue; }
		const key = iconOf(item?.components);
		const id: string | undefined = item?.description?.identifier;
		if (!key || !id || atlas[key]) continue;
		const name = id.replace(/^[a-z0-9_.-]+:/, "");
		const modelFile = [`${ASSETS}/textures/item/poke_balls/models/${name}.png`, `${HAND_RP}/textures/pokeballs/${name}.png`].find((p) => existsSync(p));
		const model = modelFile ? decodePng(modelFile) : undefined;
		const to = model && capColor(model);
		if (!icon || !from || !to) {
			warn("ícone de Poké Ball à mão sem textura de modelo para gerar", id);
			continue;
		}
		const ref = `textures/item/poke_balls/port/${name}`;
		const out = `${OUT_RP}/${ref}.png`;
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, encodePng(recolorIcon(icon, from, to)));
		atlas[key] = { textures: ref };
		made++;
	}
	return made;
}

/**
 * Ícone pequeno da bola nas telas (HUD do time, resumo, PC, batalha: textures/gui/cobblemon/ball/<bola>.png, 18×44
 * com os dois quadros do Cobblemon) para as bolas à mão que não têm um. Sem ele o HUD mostrava a textura "sem
 * textura" (xadrez rosa e preto) para Pokémon capturados na Strange Ball. Recolore o de poke_ball como o ícone do item.
 */
export function legacyBallGuiIcons(): number {
	const baseGui = `${ASSETS}/textures/gui/ball/poke_ball.png`;
	const baseModel = `${ASSETS}/textures/item/poke_balls/models/poke_ball.png`;
	if (!existsSync(baseGui) || !existsSync(baseModel)) return 0;
	const gui = decodePng(baseGui);
	const from = capColor(decodePng(baseModel));
	if (!from) return 0;
	let made = 0;
	for (const f of walk(`${HAND_BP}/items/pokeballs`, (n) => n.endsWith(".json"))) {
		let item: any;
		try { item = parseLenient(readFileSync(f, "utf8"))?.["minecraft:item"]; }
		catch { continue; }
		const id: string | undefined = item?.description?.identifier;
		if (!id) continue;
		const name = id.replace(/^[a-z0-9_.-]+:/, "");
		const out = `${OUT_RP}/textures/gui/cobblemon/ball/${name}.png`;
		if (existsSync(out) || existsSync(`${HAND_RP}/textures/gui/cobblemon/ball/${name}.png`)) continue;
		const modelFile = [`${ASSETS}/textures/item/poke_balls/models/${name}.png`, `${HAND_RP}/textures/pokeballs/${name}.png`].find((p) => existsSync(p));
		const to = modelFile ? capColor(decodePng(modelFile)) : undefined;
		if (!to) { warn("ícone de tela de Poké Ball à mão sem textura de modelo", id); continue; }
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, encodePng(recolorIcon(gui, from, to)));
		made++;
	}
	return made;
}
