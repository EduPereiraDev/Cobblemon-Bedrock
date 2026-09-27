// Papéis de parede do PC (pedido da frente extras-final): texturas de assets/cobblemon/textures/gui/pc/wallpaper/**
// copiadas para o RP (mantendo basic/, biome/, misc/ e as subpastas alt/ e glow/) e a lista de desbloqueáveis de
// data/cobblemon/unlockable_pc_box_wallpapers → generated/scripts/wallpapers.ts.
import { basename, relative } from "node:path";
import { ASSETS, DATA, OUT_RP, OUT_SCRIPTS, copyFile, count, readJson, walk, writeText } from "./util.ts";

export interface UnlockableWallpaper {
	id: string;
	texture: string;
	displayName?: string;
	enabled: boolean;
}

export function emitWallpapers(): { textures: number; unlockables: UnlockableWallpaper[] } {
	const base = `${ASSETS}/textures/gui/pc/wallpaper`;
	let textures = 0;
	for (const file of walk(base, (n) => n.endsWith(".png"))) {
		copyFile(file, `${OUT_RP}/textures/gui/pc/wallpaper/${relative(base, file).split("\\").join("/")}`);
		textures++;
	}
	const unlockables: UnlockableWallpaper[] = walk(`${DATA}/cobblemon/unlockable_pc_box_wallpapers`, (n) => n.endsWith(".json"))
		.sort()
		.map((file) => {
			const raw = readJson(file);
			const id = `cobblemon:${basename(file, ".json")}`;
			// displayName do Java (ex.: generator.single_biome_caves) não existe no Bedrock: chave do port.
			return { id, texture: String(raw.texture ?? ""), displayName: `cobblemon.port.wallpaper.${basename(file, ".json")}`, enabled: raw.enabled !== false };
		});
	writeText(
		`${OUT_SCRIPTS}/wallpapers.ts`,
		`// Arquivo gerado por tools/importer (npm run import). Não edite à mão.
/* eslint-disable */

/** data/cobblemon/unlockable_pc_box_wallpapers do Cobblemon 1.8.2. */
export const UNLOCKABLE_WALLPAPERS: { id: string; texture: string; displayName?: string; enabled: boolean }[] = ${JSON.stringify(unlockables, null, "\t")};
`,
	);
	count("papéis de parede do PC (texturas)", textures);
	count("papéis de parede desbloqueáveis", unlockables.length);
	return { textures, unlockables };
}
