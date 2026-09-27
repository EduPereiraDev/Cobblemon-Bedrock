// sounds.json do Cobblemon → sounds/sound_definitions.json do Bedrock (chaves com prefixo "cobblemon.").
import { existsSync } from "node:fs";
import { ASSETS, OUT_RP, copyFile, readJson, splitId, warn, writeJson } from "./util.ts";

/**
 * Eventos citados por animações do Cobblemon que não existem no sounds.json (no Cobblemon eles também ficam
 * mudos: SoundEvent.createVariableRangeEvent não acha arquivo). Os que têm um evento ou arquivo equivalente
 * viram alias (melhoria, não paridade); piadas/WIP sem arquivo continuam mudos.
 */
const SOUND_ALIASES: Record<string, string> = {
	gilded_chest_open: "block.gilded_chest.open",
	"animation.plumage_wing_flap_medium_2": "animation.plumage.wing_flap.medium",
	"animation.plumage_wing_flap_medium_8": "animation.plumage.wing_flap.medium",
	"0555_darmanitan_cry": "pokemon.darmanitan.cry",
};

/** Eventos sintéticos apontando direto para um .ogg existente (nome do evento → arquivo sem extensão). */
const SYNTHETIC_EVENTS: Record<string, string> = {
	steel_wing_flap_large_2: "animation/wings/steel_wing_flap_large_2",
};

/** Evento existente para um nome citado por animação/partícula (alias por tabela ou por padrão de nome). */
export function soundAlias(event: string, known: Set<string>): string | undefined {
	if (known.has(event)) return event;
	const direct = SOUND_ALIASES[event];
	if (direct && known.has(direct)) return direct;
	// Forma regional sem evento próprio: pokemon.pikachu_alolan.cry → pokemon.pikachu.cry
	const regional = /^pokemon\.([a-z0-9]+)_(?:alolan|galarian|hisuian|paldean)\.(\w+)$/.exec(event);
	if (regional && known.has(`pokemon.${regional[1]}.${regional[2]}`)) return `pokemon.${regional[1]}.${regional[2]}`;
	// Nome "de arquivo": weedle_cry → pokemon.weedle.cry, wailord_ambient → pokemon.wailord.ambient
	const file = /^(?:\d+_)?([a-z0-9]+)_(cry|ambient)$/.exec(event);
	if (file && known.has(`pokemon.${file[1]}.${file[2]}`)) return `pokemon.${file[1]}.${file[2]}`;
	return undefined;
}

export class SoundIndex {
	events: Map<string, any>;

	constructor() {
		this.events = new Map(Object.entries(readJson(`${ASSETS}/sounds.json`)));
		for (const [event, file] of Object.entries(SYNTHETIC_EVENTS)) {
			if (!this.events.has(event) && existsSync(`${ASSETS}/sounds/${file}.ogg`)) this.events.set(event, { sounds: [`cobblemon:${file}`] });
		}
	}

	get names(): Set<string> {
		return new Set(this.events.keys());
	}

	/** Eventos de Pokémon de uma espécie (pokemon.<id>.cry, pokemon.<id>.ambient...). */
	speciesEvents(id: string): string[] {
		return [...this.events.keys()].filter((k) => k.startsWith(`pokemon.${id}.`));
	}

	/** Grava as definições dos eventos pedidos e copia os .ogg usados. */
	emit(events: Set<string>): number {
		const defs: Record<string, any> = {};
		const copied = new Set<string>();
		const expand = (event: string, depth = 0): any[] => {
			const def = this.events.get(event);
			if (!def || depth > 4) return [];
			const out: any[] = [];
			for (const s of def.sounds ?? []) {
				const entry = typeof s === "string" ? { name: s } : { ...s };
				if (entry.type === "event") {
					out.push(...expand(splitId(entry.name, "minecraft").path, depth + 1));
					continue;
				}
				const { ns, path } = splitId(entry.name, "minecraft");
				if (ns !== "cobblemon") {
					warn("som de outro namespace ignorado", entry.name);
					continue;
				}
				const src = `${ASSETS}/sounds/${path}.ogg`;
				if (!existsSync(src)) {
					warn("arquivo de som ausente", `${path}.ogg`);
					continue;
				}
				if (!copied.has(path)) {
					copyFile(src, `${OUT_RP}/sounds/cobblemon/${path}.ogg`);
					copied.add(path);
				}
				const sound: any = { name: `sounds/cobblemon/${path}` };
				if (typeof entry.volume === "number") sound.volume = entry.volume;
				if (typeof entry.pitch === "number") sound.pitch = entry.pitch;
				if (typeof entry.weight === "number") sound.weight = entry.weight;
				if (entry.stream) sound.stream = true;
				out.push(sound);
			}
			return out;
		};
		for (const event of [...events].sort()) {
			const sounds = expand(event);
			if (!sounds.length) continue;
			defs[`cobblemon.${event}`] = { category: "neutral", sounds };
		}
		writeJson(`${OUT_RP}/sounds/sound_definitions.json`, { format_version: "1.20.20", sound_definitions: defs });
		return Object.keys(defs).length;
	}
}
