// Injeções de loot do Cobblemon 1.8.2 (loot/LootInjector.kt + data/cobblemon/loot_table/injection/**).
//
// No Java, cada tabela vanilla da lista recebe um pool extra (1 roll, bônus 0..1 pela sorte) com a tabela
// `cobblemon:injection/<caminho>` aninhada; as casas de vila usam `injection/chests/village_house`. O Bedrock não
// tem injeção de loot: o importador SOBRESCREVE as tabelas vanilla correspondentes com uma cópia da versão
// vanilla (tools/importer/data/vanilla_loot, de Mojang/bedrock-samples v1.26.50.4) + o mesmo pool extra
// apontando para a tabela convertida em loot_tables/cobblemon/injection/**.
//
// Compatibilidade: outro add-on que também sobrescreva essas tabelas vence ou perde conforme a ordem dos packs; e
// mudanças da Mojang nessas tabelas só chegam aqui atualizando as cópias (ver docs/pendencias/mundo-final.md).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { convertLoot, emitLoot } from "./loot.ts";
import type { ItemIdMapper } from "./loot.ts";
import { DATA, OUT_BP, ROOT, count, readJson, warn, writeJson } from "./util.ts";

export const VANILLA_LOOT_DIR = join(ROOT, "tools", "importer", "data", "vanilla_loot");

/**
 * Tabela do Java (BuiltInLootTables) → tabelas do Bedrock que fazem o mesmo papel (caminho sem .json) e a
 * injeção do Cobblemon que recebem.
 */
export const LOOT_INJECTIONS: Array<{ java: string; bedrock: string[]; injection: string }> = [
	{ java: "chests/abandoned_mineshaft", bedrock: ["chests/abandoned_mineshaft"], injection: "chests/abandoned_mineshaft" },
	{ java: "chests/ancient_city", bedrock: ["chests/ancient_city"], injection: "chests/ancient_city" },
	{ java: "chests/bastion_bridge", bedrock: ["chests/bastion_bridge"], injection: "chests/bastion_bridge" },
	{ java: "chests/bastion_hoglin_stable", bedrock: ["chests/bastion_hoglin_stable"], injection: "chests/bastion_hoglin_stable" },
	{ java: "chests/bastion_other", bedrock: ["chests/bastion_other"], injection: "chests/bastion_other" },
	{ java: "chests/bastion_treasure", bedrock: ["chests/bastion_treasure"], injection: "chests/bastion_treasure" },
	{ java: "chests/end_city_treasure", bedrock: ["chests/end_city_treasure"], injection: "chests/end_city_treasure" },
	{ java: "chests/igloo_chest", bedrock: ["chests/igloo_chest"], injection: "chests/igloo_chest" },
	{ java: "chests/jungle_temple", bedrock: ["chests/jungle_temple"], injection: "chests/jungle_temple" },
	{ java: "chests/nether_bridge", bedrock: ["chests/nether_bridge"], injection: "chests/nether_bridge" },
	{ java: "chests/pillager_outpost", bedrock: ["chests/pillager_outpost"], injection: "chests/pillager_outpost" },
	{ java: "chests/shipwreck_supply", bedrock: ["chests/shipwrecksupply"], injection: "chests/shipwreck_supply" },
	// Masmorra: o Bedrock tem as duas tabelas (monster_room é a das masmorras geradas).
	{ java: "chests/simple_dungeon", bedrock: ["chests/simple_dungeon", "chests/monster_room"], injection: "chests/simple_dungeon" },
	{ java: "chests/spawn_bonus_chest", bedrock: ["chests/spawn_bonus_chest"], injection: "chests/spawn_bonus_chest" },
	{ java: "chests/stronghold_corridor", bedrock: ["chests/stronghold_corridor"], injection: "chests/stronghold_corridor" },
	{ java: "chests/woodland_mansion", bedrock: ["chests/woodland_mansion"], injection: "chests/woodland_mansion" },
	{ java: "chests/village/village_desert_house", bedrock: ["chests/village/village_desert_house"], injection: "chests/village_house" },
	{ java: "chests/village/village_plains_house", bedrock: ["chests/village/village_plains_house"], injection: "chests/village_house" },
	{ java: "chests/village/village_savanna_house", bedrock: ["chests/village/village_savanna_house"], injection: "chests/village_house" },
	{ java: "chests/village/village_snowy_house", bedrock: ["chests/village/village_snowy_house"], injection: "chests/village_house" },
	{ java: "chests/village/village_taiga_house", bedrock: ["chests/village/village_taiga_house"], injection: "chests/village_house" },
	{ java: "gameplay/fishing/treasure", bedrock: ["gameplay/fishing/treasure"], injection: "gameplay/fishing/treasure" },
];

/** Pool extra do LootInjector: 1 roll com a tabela injetada aninhada. */
export function injectionPool(injectionPath: string): Record<string, unknown> {
	return { rolls: 1, entries: [{ type: "loot_table", name: `loot_tables/cobblemon/injection/${injectionPath}.json`, weight: 1 }] };
}

/** Converte as tabelas de injeção e sobrescreve as vanilla correspondentes. Devolve quantas foram sobrescritas. */
export function emitLootInjections(mapId: ItemIdMapper): number {
	const converted = new Set<string>();
	let overridden = 0;
	for (const { bedrock, injection } of LOOT_INJECTIONS) {
		if (!converted.has(injection)) {
			const file = `${DATA}/cobblemon/loot_table/injection/${injection}.json`;
			if (!existsSync(file)) {
				warn("injeção de loot do Cobblemon ausente", injection);
				continue;
			}
			const loot = convertLoot(readJson(file), {}, mapId);
			emitLoot(`cobblemon/injection/${injection}`, loot, true);
			converted.add(injection);
		}
		for (const path of bedrock) {
			const vanillaFile = join(VANILLA_LOOT_DIR, `${path}.json`);
			if (!existsSync(vanillaFile)) {
				warn("cópia da tabela vanilla ausente (injeção pulada)", path);
				continue;
			}
			const vanilla = readJson(vanillaFile);
			vanilla.pools = [...(vanilla.pools ?? []), injectionPool(injection)];
			writeJson(`${OUT_BP}/loot_tables/${path}.json`, vanilla);
			overridden++;
		}
	}
	count("tabelas vanilla com injeção do Cobblemon", overridden);
	return overridden;
}
