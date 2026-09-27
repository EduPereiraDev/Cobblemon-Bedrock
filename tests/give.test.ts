// Frente "give": itens do BP invisíveis ao /give. A regra de commandVisibility.ts reproduz o que o BDS 1.26.52
// respondeu (docs/pendencias/give.md); o teste cobre a tabela medida, a fusão gerado + escrito à mão do build e
// os itens escritos à mão reais (a strange_ball era o caso quebrado).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { catalogItemIds, itemCommandProblem, itemsHiddenFromCommands } from "../tools/importer/commandVisibility.ts";
import { HAND_BP, OUT_BP, walk, parseLenient } from "../tools/importer/util.ts";

// 1. Tabela medida no BDS (sonda = cópia da poke_ball com outro id): true = `give` aceitou.
const measured: [string, Parameters<typeof itemCommandProblem>[0], boolean, boolean][] = [
	["sem menu_category, fora do catálogo", undefined, false, false],
	["sem menu_category, no catálogo", undefined, true, true],
	["none, fora do catálogo", { category: "none" }, false, false],
	["none + is_hidden_in_commands false, fora do catálogo", { category: "none", is_hidden_in_commands: false }, false, false],
	["items, fora do catálogo", { category: "items" }, false, true],
	["equipment + grupo, fora do catálogo", { category: "equipment", group: "cobblemon:itemGroup.cobblemon.utility_item" }, false, true],
];
for (const [name, menu, inCatalog, accepted] of measured) {
	assert.equal(itemCommandProblem(menu, inCatalog) === undefined, accepted, name);
}
// Oculto de propósito (is_hidden_in_commands: true) não é acidente.
assert.equal(itemCommandProblem({ category: "items", is_hidden_in_commands: true }, false), undefined);

// 2. Catálogo aceita string e { name }.
assert.deepEqual(
	[...catalogItemIds({ "minecraft:crafting_items_catalog": { categories: [{ category_name: "items", groups: [{ items: ["a:x", { name: "a:y" }] }] }] } })],
	["a:x", "a:y"],
);

// 3. Fusão como o build: arquivo novo escrito à mão, overlay que adiciona menu_category e catálogo gerado.
const tmp = mkdtempSync(join(tmpdir(), "give-test-"));
try {
	const gen = join(tmp, "gen");
	const hand = join(tmp, "hand");
	const put = (file: string, json: unknown) => {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(json));
	};
	const item = (id: string, menu?: object) => ({ format_version: "1.21.90", "minecraft:item": { description: { identifier: id, ...(menu ? { menu_category: menu } : {}) }, components: {} } });
	put(join(gen, "item_catalog/crafting_item_catalog.json"), { "minecraft:crafting_items_catalog": { categories: [{ category_name: "equipment", groups: [{ items: ["cobblemon:poke_ball"] }] }] } });
	put(join(gen, "items/cobblemon/poke_ball.json"), item("cobblemon:poke_ball"));
	put(join(gen, "items/cobblemon/overlay.json"), item("cobblemon:overlay"));
	put(join(hand, "items/cobblemon/overlay.json"), { "minecraft:item": { description: { menu_category: { category: "items" } } } });
	// strange_ball como estava antes da correção (sem menu_category) e uma sonda com "none".
	put(join(hand, "items/pokeballs/strange_ball.json"), item("cobblemon:strange_ball"));
	put(join(hand, "items/probe.json"), item("cobblemon:probe", { category: "none", is_hidden_in_commands: false }));
	const ids = itemsHiddenFromCommands(gen, hand).map((p) => p.id).sort();
	assert.deepEqual(ids, ["cobblemon:probe", "cobblemon:strange_ball"]);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

// 4. Dados reais: nenhum item escrito à mão fica fora do /give.
const problems = new Map(itemsHiddenFromCommands(OUT_BP, HAND_BP).map((p) => [p.id, p]));
const handItems = walk(join(HAND_BP, "items"), (n) => n.endsWith(".json")).map((f) => parseLenient(readFileSync(f, "utf8"))?.["minecraft:item"]?.description?.identifier);
assert.ok(handItems.includes("cobblemon:strange_ball"), "strange_ball escrita à mão existe");
for (const id of handItems) assert.equal(problems.get(id), undefined, `${id} invisível ao /give: ${problems.get(id)?.reason}`);

console.log(`give: ${measured.length} casos medidos, ${handItems.length} itens escritos à mão aceitos pelo /give`);
