// Recursos de cliente das poké balls que o RP escrito à mão não tem: as 16 bolas ancient (client entity do
// projétil e do "_dummy", geometria, animações e texturas do Cobblemon) e os sons de poké ball que faltam.
// As bolas comuns continuam com os client entities escritos à mão (resource_packs/.../entity/pokeballs).
import { existsSync, readFileSync } from "node:fs";
import { ASSETS, HAND_RP, OUT_RP, copyFile, count, parseLenient, readJson, splitId, walk, warn, writeJson } from "./util.ts";

const ANCIENT_ANIMATIONS = [
	"open", "open_idle", "shut", "shut_idle", "bounce", "bob1", "bob2", "bob3", "bob4", "bob5", "bob6", "critical", "throw",
	"throw_horizontal", "throw_beast", "throw_ace", "break", "capture", "smallhop1", "smallhop2", "midhop1", "midhop2", "bighop", "weirdhop",
];

/** Client entities das bolas ancient; devolve quantas foram geradas. */
export function emitAncientBalls(): number {
	const base = `${ASSETS}/bedrock/poke_balls`;
	const geoFile = `${base}/models/ancient_poke_ball.geo.json`;
	const animFile = `${base}/animations/ancient_poke_ball.animation.json`;
	if (!existsSync(geoFile) || !existsSync(animFile)) {
		warn("modelo/animação da ancient poké ball ausente", base);
		return 0;
	}
	const geo = readJson(geoFile);
	for (const g of geo["minecraft:geometry"] ?? []) g.description.identifier = "geometry.ancient_poke_ball";
	writeJson(`${OUT_RP}/models/entity/pokeballs/ancient_poke_ball.geo.json`, geo);
	const anims = readJson(animFile);
	writeJson(`${OUT_RP}/animations/pokeballs/ancient_poke_ball.animation.json`, anims);
	const available = new Set(Object.keys(anims.animations ?? {}));
	const animations = Object.fromEntries(ANCIENT_ANIMATIONS.filter((a) => available.has(`animation.ancient_poke_ball.${a}`)).map((a) => [a, `animation.ancient_poke_ball.${a}`]));
	let n = 0;
	for (const f of walk(`${base}/variations`, (x) => /^\d+_ancient_.*_base\.json$/.test(x))) {
		const v = readJson(f);
		const ball = splitId(v.pokeball).path;
		const texture = v.variations?.[0]?.texture;
		if (!texture) continue;
		const texPath = splitId(texture).path.replace(/\.png$/, "");
		const src = `${ASSETS}/${texPath}.png`;
		if (!existsSync(src)) {
			warn("textura de poké ball ausente", texture);
			continue;
		}
		copyFile(src, `${OUT_RP}/${texPath}.png`);
		for (const suffix of ["", "_dummy"]) {
			writeJson(`${OUT_RP}/entity/pokeballs/${ball}${suffix}.json`, {
				format_version: "1.20.40",
				"minecraft:client_entity": {
					description: {
						identifier: `cobblemon:${ball}${suffix}`,
						materials: { default: "entity_alphatest" },
						textures: { default: texPath },
						geometry: { default: "geometry.ancient_poke_ball" },
						animations,
						render_controllers: ["controller.render.cow"],
					},
				},
			});
			n++;
		}
	}
	count("client entities de bolas ancient", n);
	return n;
}

/**
 * Sons "poke_ball.*" do Cobblemon que o sound_definitions.json escrito à mão não tem (shut, bounce, break,
 * shake.critical e as variantes .ancient), com o mesmo nome sem prefixo usado pelos scripts de captura.
 * Acrescenta ao sound_definitions.json já gravado pelo SoundIndex.
 */
export function emitPokeBallSounds(): number {
	const cobblemon: Record<string, any> = readJson(`${ASSETS}/sounds.json`);
	const handFile = `${HAND_RP}/sounds/sound_definitions.json`;
	const hand = existsSync(handFile) ? parseLenient(readFileSync(handFile, "utf8"))?.sound_definitions ?? {} : {};
	const outFile = `${OUT_RP}/sounds/sound_definitions.json`;
	const out = existsSync(outFile) ? readJson(outFile) : { format_version: "1.20.20", sound_definitions: {} };
	let n = 0;
	for (const [event, def] of Object.entries(cobblemon)) {
		if (!event.startsWith("poke_ball.") || event in hand) continue;
		const sounds: any[] = [];
		for (const s of def.sounds ?? []) {
			const entry = typeof s === "string" ? { name: s } : s;
			const { ns, path } = splitId(entry.name, "minecraft");
			const src = `${ASSETS}/sounds/${path}.ogg`;
			if (ns !== "cobblemon" || entry.type === "event" || !existsSync(src)) continue;
			copyFile(src, `${OUT_RP}/sounds/cobblemon/${path}.ogg`);
			sounds.push({ name: `sounds/cobblemon/${path}`, ...(typeof entry.volume === "number" ? { volume: entry.volume } : {}), ...(typeof entry.pitch === "number" ? { pitch: entry.pitch } : {}) });
		}
		if (!sounds.length) continue;
		out.sound_definitions[event] = { category: "neutral", sounds };
		n++;
	}
	writeJson(outFile, out);
	count("sons de poké ball acrescentados", n);
	return n;
}
