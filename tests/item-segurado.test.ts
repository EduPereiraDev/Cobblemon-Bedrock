// Item segurado só nos dados do Pokémon (docs/pendencias/item-segurado.md): helper único (pokemon/HeldItemStore),
// entidade de Pokémon sem "minecraft:inventory" no importador e nenhum script lendo/escrevendo o espaço 0 de um
// Pokémon. A API do Minecraft é mockada.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DATA_PROPERTY, forgetHeldItemCache, getHeldItemOnEntity, giveHeldItemIfEmpty, heldItemKey, setHeldItemOnEntity,
} from "../scripts/pokemon/HeldItemStore";
import { buildServerEntity } from "../tools/importer/entities.ts";
import { movementOf } from "../tools/importer/species.ts";

const ROOT = process.cwd();
const originalWarn = console.warn;
console.warn = () => { };

let nextId = 1;
class FakeEntity {
	id = `e${nextId++}`;
	props = new Map<string, unknown>();
	writes = 0;
	reads = 0;
	getDynamicProperty(key: string) { this.reads++; return this.props.get(key); }
	setDynamicProperty(key: string, value?: string) { this.writes++; if (value === undefined) this.props.delete(key); else this.props.set(key, value); }
}
const withData = (data: Record<string, unknown>) => {
	const e = new FakeEntity();
	e.props.set(DATA_PROPERTY, JSON.stringify(data));
	return e;
};
const raw = (e: FakeEntity) => JSON.parse(String(e.props.get(DATA_PROPERTY)));

// ---------------------------------------------------------------------------------------------
// 1. heldItemKey = toID(removeNamespace(typeId)) do loadFromCobblemon

assert.equal(heldItemKey("cobblemon:oran_berry"), "oranberry");
assert.equal(heldItemKey("minecraft:Diamond"), "diamond");
assert.equal(heldItemKey("cobblemon:kings_rock"), "kingsrock");
assert.equal(heldItemKey(undefined), "");
assert.equal(heldItemKey(""), "");

// ---------------------------------------------------------------------------------------------
// 2. Leitura e escrita nos dados

{
	const e = withData({ species: "charizard", level: 50, minecraftItem: "cobblemon:leftovers", item: "leftovers", moves: ["ember"] });
	assert.equal(getHeldItemOnEntity(e), "cobblemon:leftovers");
	assert.equal(setHeldItemOnEntity(e, "cobblemon:black_belt"), true);
	assert.equal(getHeldItemOnEntity(e), "cobblemon:black_belt");
	const after = raw(e);
	assert.equal(after.minecraftItem, "cobblemon:black_belt");
	assert.equal(after.item, "blackbelt");
	assert.equal(after.species, "charizard", "os outros campos ficam");
	assert.equal(after.level, 50);
	assert.deepEqual(after.moves, ["ember"]);
	// Tirar: sem minecraftItem no JSON e item "" (como o applyToCobblemon grava um Pokémon sem item).
	assert.equal(setHeldItemOnEntity(e, undefined), true);
	assert.equal(getHeldItemOnEntity(e), undefined);
	assert.equal("minecraftItem" in raw(e), false);
	assert.equal(raw(e).item, "");
	assert.equal(setHeldItemOnEntity(e, ""), true, "string vazia = sem item");
	assert.equal(getHeldItemOnEntity(e), undefined);
}

// Sem dados, dados inválidos ou JSON que não é objeto: nada é gravado e quem chama não mexe no inventário do jogador.
{
	const none = new FakeEntity();
	assert.equal(getHeldItemOnEntity(none), undefined);
	assert.equal(setHeldItemOnEntity(none, "minecraft:diamond"), false);
	assert.equal(none.writes, 0);
	const broken = new FakeEntity();
	broken.props.set(DATA_PROPERTY, "{não é json");
	assert.equal(getHeldItemOnEntity(broken), undefined);
	assert.equal(setHeldItemOnEntity(broken, "minecraft:diamond"), false);
	assert.equal(broken.props.get(DATA_PROPERTY), "{não é json", "dados ilegíveis não são sobrescritos");
	const arr = new FakeEntity();
	arr.props.set(DATA_PROPERTY, "[1,2]");
	assert.equal(setHeldItemOnEntity(arr, "minecraft:diamond"), false);
	const nonString = withData({ minecraftItem: 42 });
	assert.equal(getHeldItemOnEntity(nonString), undefined, "minecraftItem não-string = sem item");
	// Entidade que lança ao ler (descarregada).
	const gone = { id: "gone", getDynamicProperty() { throw new Error("invalid"); }, setDynamicProperty() { throw new Error("invalid"); } };
	assert.equal(getHeldItemOnEntity(gone), undefined);
	assert.equal(setHeldItemOnEntity(gone, "minecraft:diamond"), false);
	// Escrita que lança: devolve false.
	const readOnly = withData({ species: "pikachu" });
	readOnly.setDynamicProperty = () => { throw new Error("read-only"); };
	assert.equal(setHeldItemOnEntity(readOnly, "minecraft:diamond"), false);
}

// ---------------------------------------------------------------------------------------------
// 3. Cache: o mesmo JSON não é reinterpretado; JSON novo (applyToCobblemon) é lido de novo, nunca fica velho.

{
	const e = withData({ species: "pikachu", minecraftItem: "cobblemon:light_ball", item: "lightball" });
	const parse = JSON.parse;
	let parses = 0;
	JSON.parse = ((text: string, reviver?: any) => { parses++; return parse(text, reviver); }) as typeof JSON.parse;
	try {
		assert.equal(getHeldItemOnEntity(e), "cobblemon:light_ball");
		assert.equal(getHeldItemOnEntity(e), "cobblemon:light_ball");
		assert.equal(getHeldItemOnEntity(e), "cobblemon:light_ball");
		assert.equal(parses, 1, "mesmo JSON: um parse só");
		// Outro código grava o JSON inteiro (applyToCobblemon): o cache percebe.
		e.props.set(DATA_PROPERTY, JSON.stringify({ species: "pikachu", item: "" }));
		assert.equal(getHeldItemOnEntity(e), undefined);
		assert.equal(parses, 2);
		// Depois de gravar pelo helper, a leitura seguinte não precisa de parse.
		setHeldItemOnEntity(e, "cobblemon:oran_berry");
		const before = parses;
		assert.equal(getHeldItemOnEntity(e), "cobblemon:oran_berry");
		assert.equal(parses, before);
		forgetHeldItemCache(e.id);
		assert.equal(getHeldItemOnEntity(e), "cobblemon:oran_berry");
		assert.equal(parses, before + 1, "esquecido: lê de novo");
	}
	finally {
		JSON.parse = parse;
	}
}

// ---------------------------------------------------------------------------------------------
// 4. giveHeldItemIfEmpty (item da boca na captura)

{
	const empty = withData({ species: "vulpix", item: "" });
	assert.equal(giveHeldItemIfEmpty(empty, "minecraft:sweet_berries"), true);
	assert.equal(getHeldItemOnEntity(empty), "minecraft:sweet_berries");
	assert.equal(raw(empty).item, "sweetberries");
	assert.equal(giveHeldItemIfEmpty(empty, "minecraft:apple"), false, "já segura: o item da boca cai no chão");
	assert.equal(getHeldItemOnEntity(empty), "minecraft:sweet_berries", "não troca o que já segurava");
	assert.equal(giveHeldItemIfEmpty(new FakeEntity(), "minecraft:apple"), false, "sem dados: cai no chão");
}

// ---------------------------------------------------------------------------------------------
// 5. Importador: entidade de Pokémon sem inventário (nem na base, nem em grupos), inclusive montável.

{
	type Json = Record<string, any>;
	const dir = mkdtempSync(join(tmpdir(), "cobblemon-item-segurado-"));
	const model = join(dir, "ridemon.geo.json");
	writeFileSync(model, JSON.stringify({ "minecraft:geometry": [{ description: { identifier: "geometry.ridemon" }, bones: [{ name: "body", locators: { seat_1: [0, 16, 8] } }] }] }));
	const build = (data: Json, id: string, modelFile?: string) => buildServerEntity({
		id, variants: 1, hitbox: { width: 1, height: 1 }, baseScale: 1, movement: movementOf(data), data, ...(modelFile ? { modelFile } : {}),
	})["minecraft:entity"];
	const riding = {
		seats: [{ locator: "seat_1" }],
		behaviours: {
			LAND: { key: "cobblemon:land/horse", stats: { SPEED: "50-70", JUMP: "40-60", STAMINA: "30-40", ACCELERATION: "10-20", SKILL: "10-20" } },
			AIR: { key: "cobblemon:air/bird", stats: { SPEED: "60-80", STAMINA: "25-40" } },
		},
	};
	const samples: [string, Json, string?][] = [
		["testmon", { baseStats: { attack: 55 }, hitbox: { width: 1, height: 1 } }],
		["ridemon", { baseStats: { attack: 84 }, hitbox: { width: 1, height: 1 }, riding }, model],
	];
	for (const [id, data, modelFile] of samples) {
		const e = build(data, id, modelFile);
		const all = [e.components, ...Object.values<Json>(e.component_groups ?? {})];
		for (const group of all) assert.equal(group["minecraft:inventory"], undefined, `${id}: minecraft:inventory no JSON da entidade`);
		assert.ok(!JSON.stringify(e).includes("minecraft:inventory"), `${id}: nenhum inventário`);
	}
	assert.ok(build(samples[1][1], "ridemon", model).component_groups["cobblemon:rideable"]?.["minecraft:rideable"], "a amostra montável é mesmo montável");
}

// ---------------------------------------------------------------------------------------------
// 6. Guarda: os leitores/escritores do item segurado não usam o espaço 0 de um inventário de entidade.

{
	const files = [
		"scripts/Pokemon.ts",
		"scripts/events/ExchangeHeldItem.ts",
		"scripts/entity/HeldItemDisplay.ts",
		"scripts/entity/index.ts",
		"scripts/spawning/Despawner.ts",
		"scripts/GUI/Party.ts",
		"scripts/catching/CaptureSequence.ts",
	];
	const slotZero = /\.(getItem|getSlot)\(0\)|\.setItem\(0\s*,/;
	for (const file of files) {
		const text = readFileSync(join(ROOT, file), "utf8");
		const bad = text.split("\n").map((line, i) => [i + 1, line] as const).filter(([, line]) => slotZero.test(line));
		assert.deepEqual(bad, [], `${file} usa o espaço 0 de um inventário: ${bad.map(([n, l]) => `${n}: ${l.trim()}`).join(" | ")}`);
	}
	// Entidades de Pokémon já geradas (se o import já rodou): sem inventário.
	for (const pack of ["generated/behavior_packs/CobblemonBedrock/entities/pokemon"]) {
		let names: string[] = [];
		try { names = readdirSync(join(ROOT, pack)).filter(n => n.endsWith(".json")); }
		catch { continue; }
		const withInventory = names.filter(n => readFileSync(join(ROOT, pack, n), "utf8").includes("\"minecraft:inventory\""));
		assert.deepEqual(withInventory.slice(0, 5), [], `${pack}: ${withInventory.length} entidades com minecraft:inventory (rode npm run import)`);
	}
}

console.warn = originalWarn;
console.log("item-segurado: ok");
