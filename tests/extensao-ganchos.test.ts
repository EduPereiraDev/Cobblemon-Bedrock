// Frente msd-fase6: ganchos neutros do base para extensões (sem extensão registrada, nada muda).
// 1. getShowdownSpecies: formas do Cobblemon que o dex do Showdown não tem (Zygarde 10%-C/50%-C).
// 2. Gancho de interação com Pokémon (antes do menu/batalha selvagem) e veto do início de batalha.
// 3. Evento ABILITY_REVEALED (linha `-ability`).
// 4. Provedor de nome de item por namespace (telas).
// 5. Conquistas: concessão direta (`grant`), critério `structure` e itens de conquistas acrescentadas depois do load.
import assert from "node:assert/strict";
import { advance, advanceUntil, createPlayer, spawnWild } from "./batalhas-harness";
import type { FakeEntity } from "./batalhas-harness";
import { formHooks } from "./mocks/minecraft-server-ui";
import { Dex } from "../scripts/showdown";
import { PokemonData, SHOWDOWN_FORM_ALIASES, showdownSpeciesName } from "../scripts/Pokemon";
import { addBattleStartVeto, clearBattleStartVetoesForTests, startWildBattle } from "../scripts/battle";
import { battleMap } from "../scripts/battle/PokemonBattle";
import type { PokemonBattle } from "../scripts/battle/PokemonBattle";
import { addPokemonInteractHook, clearPokemonInteractHooksForTests, handlePokemonInteract } from "../scripts/events/ScriptEvents";
import { CobblemonEvents } from "../scripts/events/CobblemonEvents";
import { itemName } from "../scripts/GUI/common";
import { itemNameOf } from "../scripts/machines/itemUtil";
import { clearItemNameProvidersForTests, registerItemNameProvider } from "../scripts/items/itemNames";
import { applyEvent, emptyAchievements } from "../scripts/ui/achievements/engine";
import { ADVANCEMENT_DEFS, isTrackedInventoryItem } from "../scripts/ui/achievements/tracker";
import { ADVANCEMENTS } from "../generated/scripts/advancements";
import type { AdvancementDef } from "../generated/scripts/advancements";

const originalLog = console.log;
console.log = () => { };
console.info = () => { };
const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
let passed = 0;

function pokemon(species: string, level: number, moves: string[], extra: Partial<PokemonData> = {}) {
	const data = Object.assign(PokemonData.generateNewWildPokemon(species, { level, shiny: false }), extra);
	data.moves = moves;
	data.movesInfo = moves.map(move => ({ pp: Dex.moves.get(move).pp, maxPp: Dex.moves.get(move).pp, extraPp: 0 }));
	return data;
}
async function runToEnd(battle: PokemonBattle) {
	assert.ok(await advanceUntil(() => battle.ended, 600_000), `a batalha ${battle.battleId} não terminou`);
	await advance(40);
}
formHooks.show = () => ({ selection: 0, canceled: false });

// ------------------------------------------------------------------------------------------------
// 1. getShowdownSpecies
// ------------------------------------------------------------------------------------------------
{
	// O Zygarde não tem modelo no Cobblemon 1.8.2 (o base não gera a espécie); aqui, a regra.
	assert.equal(showdownSpeciesName("Zygarde", "10%-C"), "Zygarde-10%", "10%-C → Zygarde-10% (antes: Zygarde, status do 50%)");
	assert.equal(showdownSpeciesName("Zygarde", "50%-C"), "Zygarde", "50%-C → Zygarde");
	assert.equal(showdownSpeciesName("Zygarde", "10%"), "Zygarde-10%", "10% sem Power Construct: igual a antes");
	assert.equal(showdownSpeciesName("Zygarde", "Complete"), "Zygarde-Complete");
	assert.equal(showdownSpeciesName("Raichu", "Alola"), "Raichu-Alola");
	assert.equal(showdownSpeciesName("Pikachu", "Alola-Bias"), "Pikachu", "Pikachu-Alola-Bias continua Pikachu (sem corte genérico)");
	assert.equal(showdownSpeciesName("Eiscue", "Noice-Face"), "Eiscue", "Eiscue Noice-Face continua como antes");
	assert.equal(Dex.species.get("Zygarde-10%").baseStats.hp, 54, "o Zygarde-10% do dex tem os status do 10%");
	for (const [from, to] of Object.entries(SHOWDOWN_FORM_ALIASES)) {
		assert.ok(!Dex.species.get(from).exists, `${from} não existe no dex (senão o alias é desnecessário)`);
		assert.ok(Dex.species.get(to).exists, `${to} existe no dex`);
	}
	passed++;
}

// ------------------------------------------------------------------------------------------------
// 2. Interação com Pokémon e veto de batalha
// ------------------------------------------------------------------------------------------------
{
	const mine = pokemon("charmander", 50, ["ember"]);
	const player = createPlayer("Ganchos", [mine]);
	const wild = spawnWild(pokemon("rattata", 2, ["tackle"]));
	const calls: unknown[][] = [];
	addPokemonInteractHook((p, entity, held) => { calls.push([p, entity, held]); return true; });
	handlePokemonInteract(player as never, wild as never, { typeId: "teste:item", amount: 1 } as never);
	await advance(10);
	assert.equal(calls.length, 1, "o gancho roda na interação");
	assert.equal(calls[0][1], wild, "com a entidade");
	assert.equal((calls[0][2] as { typeId: string }).typeId, "teste:item", "e o item da mão");
	assert.equal(battleMap.size, 0, "gancho que consome: sem batalha selvagem");
	clearPokemonInteractHooksForTests();
	addPokemonInteractHook(() => { throw new Error("gancho quebrado"); });
	addPokemonInteractHook(() => false);

	// Veto: motivo próprio, padrão do Cobblemon, e sem veto a batalha começa como sempre.
	addBattleStartVeto(actors => actors.some(a => a.pokemon.some(p => p.species === "rattata")) ? { translate: "teste.motivo" } : undefined);
	assert.equal(startWildBattle(player as never, wild as never), undefined, "vetada");
	assert.ok(player.hasMessage("teste.motivo"), "mensagem do veto");
	clearBattleStartVetoesForTests();
	addBattleStartVeto(() => true);
	assert.equal(startWildBattle(player as never, wild as never), undefined, "vetada (true)");
	assert.ok(player.hasMessage("cobblemon.battle.error.canceled"), "mensagem padrão do CanceledError");
	assert.equal(battleMap.size, 0, "nenhuma batalha registrada");
	clearBattleStartVetoesForTests();

	// Sem veto e com ganchos que não consomem (um deles quebrado): a interação segue até a batalha selvagem.
	const abilities: string[] = [];
	const onAbility = (_b: PokemonBattle, _a: unknown, ability: string) => { abilities.push(ability); };
	CobblemonEvents.on("ABILITY_REVEALED", onAbility as never);
	const pressure = spawnWild(pokemon("aerodactyl", 3, ["splash"], { ability: "pressure" }));
	handlePokemonInteract(player as never, pressure as never);
	await advance(10);
	assert.ok(warnings.some(w => w.includes("gancho quebrado")), "gancho com erro só avisa");
	const battle = [...battleMap.values()][0];
	assert.ok(battle, "sem consumir, a interação abre a batalha selvagem");
	await runToEnd(battle);
	clearPokemonInteractHooksForTests();

	// 3. ABILITY_REVEALED: Pressure anuncia `-ability` ao entrar.
	assert.ok(battle.showdownMessages.some(l => /\|-ability\|[^|]+\|Pressure/.test(l)), "o sim anunciou a Pressure");
	assert.ok(abilities.includes("pressure"), `ABILITY_REVEALED com o id (${abilities})`);
	CobblemonEvents.off("ABILITY_REVEALED", onAbility as never);
	void (pressure as FakeEntity);
	passed++;
}

// ------------------------------------------------------------------------------------------------
// 4. Nome de item por namespace
// ------------------------------------------------------------------------------------------------
{
	assert.deepEqual(itemName("teste:flor"), { translate: "item.flor.name" }, "sem provedor: regra vanilla");
	assert.deepEqual(itemNameOf("teste:flor"), { translate: "item.flor.name" });
	registerItemNameProvider("teste", id => id === "flor" ? { translate: `block.teste.${id}` } : id === "quebrado" ? (() => { throw new Error("x"); })() : undefined);
	assert.deepEqual(itemName("teste:flor"), { translate: "block.teste.flor" }, "provedor do namespace");
	assert.deepEqual(itemNameOf("teste:flor"), { translate: "block.teste.flor" }, "máquinas usam o mesmo provedor");
	assert.deepEqual(itemName("teste:outro"), { translate: "item.outro.name" }, "provedor sem resposta: regra vanilla");
	assert.deepEqual(itemName("teste:quebrado"), { translate: "item.quebrado.name" }, "provedor com erro: regra vanilla");
	assert.deepEqual(itemName("cobblemon:leftovers"), { translate: "item.cobblemon.leftovers" }, "cobblemon não muda");
	assert.deepEqual(itemName("minecraft:apple"), { translate: "item.apple.name" }, "vanilla não muda");
	clearItemNameProvidersForTests();
	passed++;
}

// ------------------------------------------------------------------------------------------------
// 5. Conquistas
// ------------------------------------------------------------------------------------------------
{
	const code: AdvancementDef = { id: "teste/por_codigo", tab: "teste", frame: "task", hidden: false, toast: true, announce: true, title: "t", description: "d", icon: "i", criteria: { a: { t: "impossible" }, b: { t: "impossible" } }, requirements: [["a"], ["b"]] } as unknown as AdvancementDef;
	const place: AdvancementDef = { ...code, id: "teste/estrutura", criteria: { dentro: { t: "structure", structures: ["teste:ruina", "teste:torre"] } }, requirements: [["dentro"]] } as unknown as AdvancementDef;
	const defs = [code, place];
	const state = emptyAchievements();
	assert.deepEqual(applyEvent(state, defs, { type: "grant", id: "teste/desconhecida" }), { completed: [], changed: false }, "id desconhecido: nada");
	assert.deepEqual(applyEvent(state, defs, { type: "pick_starter" }).completed, [], "`impossible` não casa com evento nenhum");
	const granted = applyEvent(state, defs, { type: "grant", id: "cobblemon:teste/por_codigo" });
	assert.deepEqual(granted.completed.map(d => d.id), ["teste/por_codigo"], "grant conclui todos os critérios (com ou sem cobblemon:)");
	assert.ok(granted.changed && state.d.includes("teste/por_codigo"));
	assert.deepEqual(applyEvent(state, defs, { type: "grant", id: "teste/por_codigo" }), { completed: [], changed: false }, "de novo: nada");
	assert.deepEqual(applyEvent(state, defs, { type: "structure", structures: ["minecraft:village"] }).completed, [], "outra estrutura");
	assert.deepEqual(applyEvent(state, defs, { type: "structure", structures: ["teste:torre"] }).completed.map(d => d.id), ["teste/estrutura"], "dentro de uma das estruturas");

	// Itens de conquistas acrescentadas depois do carregamento do módulo (extensão no worldLoad) passam a contar.
	assert.equal(ADVANCEMENT_DEFS, ADVANCEMENTS, "o tracker lê a mesma lista que as extensões acrescentam");
	assert.equal(isTrackedInventoryItem("teste:item_novo"), false);
	const extra = { ...code, id: "teste/inventario", criteria: { ter: { t: "inventory", items: ["teste:item_novo"] } }, requirements: [["ter"]] } as unknown as AdvancementDef;
	ADVANCEMENTS.push(extra);
	try { assert.equal(isTrackedInventoryItem("teste:item_novo"), true, "item de conquista acrescentada depois é rastreado"); }
	finally { ADVANCEMENTS.splice(ADVANCEMENTS.indexOf(extra), 1); }
	assert.equal(isTrackedInventoryItem("teste:item_novo"), false, "e deixa de ser quando sai");
	assert.ok(ADVANCEMENTS.every(def => Object.values(def.criteria).every(c => c.t !== "structure")), "o base não tem critério structure (sem custo sem extensão)");
	passed++;
}

formHooks.show = undefined;
console.log = originalLog;
console.log(`extensao-ganchos: ${passed} grupos de testes ok`);
process.exit(0);
