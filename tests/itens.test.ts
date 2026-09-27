// Itens usados em Pokémon fora de batalha (frente "itens"), com os dados reais do Cobblemon (generated/):
// poções/remédios, status, reviver, PP, EVs, mints, doces, Hyper Training, habilidades, TMs, evolução por item,
// mapeamento de itens segurados para o Showdown e comidas com efeito.
import assert from "node:assert/strict";
import { PokemonData, StatusEffect } from "../scripts/Pokemon";
import { ITEM_COMPONENTS, ITEMS } from "../generated/scripts/items";
import { getItemBehaviour, useItemOn, resolveFriendshipRaise, findItemEvolutions } from "../scripts/items/effects";
import { parseTMMove, tmLoreLine } from "../scripts/items/tm";
import { HELD_ITEM_REMAPS, showdownItemOf, toShowdownItemId } from "../scripts/items/heldItems";
import { foodKind, saturationFor } from "../scripts/items/food";
import { ITEM_CUSTOM_COMPONENTS } from "../scripts/items/components";
import { getConfig } from "../scripts/Config";

const originalWarn = console.warn;
console.warn = () => { };
const make = (species: string, level = 30, extra: Parameters<typeof PokemonData.generateNewWildPokemon>[1] = {}) =>
	PokemonData.generateNewWildPokemon(species, { level, shiny: false, ...extra });
const C = (id: string) => `cobblemon:${id}`;

// 1. Poções e remédios (PotionItem, RemedyItem, EnergyRootItem, BerryJuiceItem).
{
	const mon = make("pikachu", 50);
	const max = mon.maxHealth;
	mon.currentHealth = 1;
	let r = useItemOn(mon, C("potion"));
	assert.ok(r.success && r.consume);
	assert.equal(mon.currentHealth, 21, "Potion cura 20");
	assert.equal(r.returnItem, "minecraft:glass_bottle");
	useItemOn(mon, C("super_potion"));
	assert.equal(mon.currentHealth, Math.min(max, 81), "Super Potion cura 60");
	mon.currentHealth = 5;
	useItemOn(mon, C("hyper_potion"));
	assert.equal(mon.currentHealth, Math.min(max, 125));
	mon.currentHealth = 1;
	mon.status = StatusEffect.Burn;
	useItemOn(mon, C("max_potion"));
	assert.equal(mon.currentHealth, max, "Max Potion enche o HP");
	assert.equal(mon.status, StatusEffect.Burn, "Max Potion não cura status");
	assert.ok(!useItemOn(mon, C("potion")).success, "HP cheio: sem efeito, não gasta");
	mon.currentHealth = 1;
	useItemOn(mon, C("full_restore"));
	assert.equal(mon.currentHealth, max);
	assert.equal(mon.status, undefined, "Full Restore cura status");
	// Remédios: curam e tiram amizade; Energy Root cura 80 e tira 10.
	mon.setFriendship(100);
	mon.currentHealth = 1;
	r = useItemOn(mon, C("remedy"));
	assert.ok(r.success && r.returnItem === undefined);
	assert.equal(mon.currentHealth, 21);
	assert.equal(mon.friendship, 95);
	mon.currentHealth = 1;
	useItemOn(mon, C("energy_root"));
	assert.equal(mon.currentHealth, Math.min(max, 81));
	assert.equal(mon.friendship, 85);
	mon.currentHealth = 1;
	assert.equal(useItemOn(mon, C("berry_juice")).returnItem, "minecraft:bowl");
	assert.equal(mon.currentHealth, 21);
	// Desmaiado não pode usar poção.
	mon.currentHealth = 0;
	assert.ok(!useItemOn(mon, C("potion")).success);
}

// 2. Berries de cura (Oran 10, Sitrus e as de porção: 33% do HP máximo).
{
	const mon = make("snorlax", 60);
	const max = mon.maxHealth;
	mon.currentHealth = 1;
	useItemOn(mon, C("oran_berry"));
	assert.equal(mon.currentHealth, 11);
	mon.currentHealth = 1;
	useItemOn(mon, C("sitrus_berry"));
	assert.equal(mon.currentHealth, 1 + Math.floor(max * 0.33));
	mon.currentHealth = 1;
	useItemOn(mon, C("figy_berry"));
	assert.equal(mon.currentHealth, 1 + Math.floor(max * 0.33));
}

// 3. Status (StatusCureItem, StatusCuringBerryItem, HealPowderItem).
{
	const mon = make("pikachu", 30);
	mon.status = StatusEffect.Paralyze;
	assert.ok(!useItemOn(mon, C("antidote")).success, "Antidote não cura paralisia");
	let r = useItemOn(mon, C("paralyze_heal"));
	assert.ok(r.success && r.returnItem === "minecraft:glass_bottle");
	assert.equal(mon.status, undefined);
	mon.status = StatusEffect.Badly_Poison;
	assert.ok(useItemOn(mon, C("pecha_berry")).success, "Pecha cura envenenamento grave");
	mon.status = StatusEffect.Sleep;
	assert.ok(useItemOn(mon, C("lum_berry")).success);
	assert.ok(!useItemOn(mon, C("full_heal")).success, "sem status: sem efeito");
	assert.ok(!getItemBehaviour(C("persim_berry"))!.canUse(mon), "confusão só existe em batalha");
	mon.status = StatusEffect.Freeze;
	mon.setFriendship(50);
	r = useItemOn(mon, C("heal_powder"));
	assert.ok(r.success && r.returnItem === undefined);
	assert.equal(mon.friendship, 45, "Heal Powder tira 5 de amizade");
	mon.status = StatusEffect.Burn;
	mon.currentHealth = 0;
	assert.ok(!useItemOn(mon, C("burn_heal")).success, "desmaiado não recebe cura de status");
}

// 4. Reviver (ReviveItem: metade arredondada para cima; Max Revive: tudo; Revival Herb: 1/4 e -15 de amizade).
{
	const mon = make("machamp", 55);
	const max = mon.maxHealth;
	assert.ok(!useItemOn(mon, C("revive")).success, "só em desmaiado");
	mon.currentHealth = 0;
	assert.ok(useItemOn(mon, C("revive")).success);
	assert.equal(mon.currentHealth, Math.ceil(max / 2));
	mon.currentHealth = 0;
	useItemOn(mon, C("max_revive"));
	assert.equal(mon.currentHealth, max);
	mon.currentHealth = 0;
	mon.setFriendship(100);
	useItemOn(mon, C("revival_herb"));
	assert.equal(mon.currentHealth, Math.ceil(max / 4));
	assert.equal(mon.friendship, 85);
}

// 5. PP: Ether/Max Ether/Leppa (golpe escolhido), Elixir (todos), PP Up/PP Max (estágios).
{
	const mon = make("pikachu", 40);
	assert.ok(mon.moves.length >= 2);
	const ether = getItemBehaviour(C("ether"))!;
	assert.ok(ether.selectsMove && !ether.canUse(mon), "PP cheio: sem efeito");
	mon.movesInfo[0].pp = 0;
	mon.movesInfo[1].pp = 1;
	assert.ok(ether.canUse(mon));
	assert.ok(!ether.canUseOnMove!(mon, 2) || mon.movesInfo[2].pp < mon.movesInfo[2].maxPp);
	assert.ok(!useItemOn(mon, C("ether")).success, "sem golpe escolhido não faz nada");
	useItemOn(mon, C("ether"), { moveSlot: 0 });
	assert.equal(mon.movesInfo[0].pp, Math.min(10, mon.movesInfo[0].maxPp));
	useItemOn(mon, C("max_ether"), { moveSlot: 0 });
	assert.equal(mon.movesInfo[0].pp, mon.movesInfo[0].maxPp);
	mon.movesInfo[0].pp = 0;
	useItemOn(mon, C("leppa_berry"), { moveSlot: 0 });
	assert.equal(mon.movesInfo[0].pp, Math.min(10, mon.movesInfo[0].maxPp));
	useItemOn(mon, C("max_elixir"));
	assert.ok(mon.movesInfo.every(info => info.pp === info.maxPp), "Max Elixir enche todos");
	const before = mon.movesInfo[0].maxPp;
	assert.ok(useItemOn(mon, C("pp_up"), { moveSlot: 0 }).success);
	assert.equal(mon.getPpStages(0), 1);
	assert.ok(mon.movesInfo[0].maxPp > before);
	assert.ok(useItemOn(mon, C("pp_max"), { moveSlot: 0 }).success);
	assert.equal(mon.getPpStages(0), 3);
	assert.ok(!getItemBehaviour(C("pp_up"))!.canUseOnMove!(mon, 0), "3 estágios: não sobe mais");
	assert.ok(!useItemOn(mon, C("pp_max"), { moveSlot: 0 }).success);
}

// 6. EVs: Vitamina +10, Pena +1, Mochi +4 (MochiItem.kt), limite 252/510; Fresh Start Mochi; berries redutoras.
{
	const mon = make("bulbasaur", 20);
	mon.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
	let r = useItemOn(mon, C("protein"));
	assert.ok(r.success && r.returnItem === "minecraft:glass_bottle");
	assert.equal(mon.evs.atk, 10);
	useItemOn(mon, C("muscle_feather"));
	assert.equal(mon.evs.atk, 11);
	useItemOn(mon, C("muscle_mochi"));
	assert.equal(mon.evs.atk, 15, "Mochi dá 4 EVs");
	mon.evs.atk = 250;
	useItemOn(mon, C("protein"));
	assert.equal(mon.evs.atk, 252, "limite de 252 por atributo");
	assert.ok(!getItemBehaviour(C("protein"))!.canUse(mon));
	assert.ok(!useItemOn(mon, C("protein")).success, "no limite: não gasta");
	// Total 510: sobra só 6.
	mon.evs = { hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 };
	useItemOn(mon, C("carbos"));
	assert.equal(mon.evs.spe, 6, "total limitado a 510");
	assert.ok(getItemBehaviour(C("zinc"))!.canUse(mon), "canUse só olha o atributo (como EVIncreaseItem)");
	assert.ok(!useItemOn(mon, C("zinc")).success, "mas sem espaço no total não gasta");
	// Pomeg: -10 EV de HP e +10 de amizade (amizade < 100).
	mon.setFriendship(50);
	r = useItemOn(mon, C("pomeg_berry"));
	assert.ok(r.success);
	assert.equal(mon.evs.hp, 242);
	assert.equal(mon.friendship, 60);
	assert.equal(resolveFriendshipRaise(ITEMS.pomeg_berry.friendship, 150), 5);
	assert.equal(resolveFriendshipRaise(ITEMS.pomeg_berry.friendship, 220), 1);
	assert.ok(useItemOn(mon, C("fresh_start_mochi")).success);
	assert.equal(mon.getEvTotal(), 0);
	assert.ok(!useItemOn(mon, C("fresh_start_mochi")).success, "sem EVs: sem efeito");
	// Berry redutora com EV zerado e amizade máxima: sem efeito.
	mon.setFriendship(mon.getMaxFriendship());
	assert.ok(!getItemBehaviour(C("kelpsy_berry"))!.canUse(mon));
}

// 7. Mints: natureza efetiva muda, a original fica; mesma natureza = mensagem mint.same_nature.
{
	const mon = make("pikachu", 30);
	mon.nature = "Hardy";
	mon.mintedNature = undefined;
	const r = useItemOn(mon, C("adamant_mint"));
	assert.ok(r.success);
	assert.equal(mon.getEffectiveNature(), "Adamant");
	assert.equal(mon.nature, "Hardy");
	assert.equal((r.messages[0] as any).translate, "cobblemon.mint.interact");
	const again = useItemOn(mon, C("adamant_mint"));
	assert.ok(!again.success);
	assert.equal((again.messages[0] as any).translate, "cobblemon.mint.same_nature");
}

// 8. Doces: Rare Candy sobe exatamente um nível; doces de EXP somam EXP fixa; nível máximo não gasta.
{
	const mon = make("rattata", 10);
	mon.trainer = undefined;
	const r = useItemOn(mon, C("rare_candy"));
	assert.ok(r.success && r.experience);
	assert.equal(mon.level, 11);
	assert.equal(r.experience!.newLevel, 11);
	const exp = mon.experience;
	useItemOn(mon, C("exp_candy_xs"));
	assert.equal(mon.experience, exp + 100);
	const maxed = make("rattata", getConfig().maxPokemonLevel);
	assert.ok(!getItemBehaviour(C("exp_candy_l"))!.canUse(maxed));
	assert.ok(!useItemOn(maxed, C("rare_candy")).success);
}

// 9. Hyper Training (doces ±1 no IV efetivo; 0..31).
{
	const mon = make("pikachu", 30);
	mon.ivs.hp = 20;
	mon.hyperTrainedIvs = {};
	assert.ok(useItemOn(mon, C("health_candy")).success);
	assert.equal(mon.getEffectiveIv("hp"), 21);
	assert.equal(mon.ivs.hp, 20, "IV natural não muda");
	assert.ok(useItemOn(mon, C("sickly_candy")).success);
	assert.equal(mon.getEffectiveIv("hp"), 20);
	assert.ok(!mon.isHyperTrained("hp"), "voltar ao IV natural desfaz o Hyper Training");
	mon.ivs.spe = 31;
	assert.ok(!useItemOn(mon, C("quick_candy")).success, "31 não sobe");
	mon.ivs.atk = 0;
	assert.ok(!useItemOn(mon, C("weak_candy")).success, "0 não desce");
}

// 10. Ability Capsule troca entre as comuns (mantém "comum"); Ability Patch comum → oculta.
{
	const mon = make("pidgey", 20);
	mon.setAbility("keeneye");
	assert.equal(mon.getAbilityType(), "common");
	const r = useItemOn(mon, C("ability_capsule"));
	assert.ok(r.success);
	assert.equal(mon.ability, "tangledfeet");
	assert.equal(mon.getAbilityType(), "common");
	assert.equal(r.returnItem, "minecraft:glass_bottle");
	assert.ok(useItemOn(mon, C("ability_patch")).success);
	assert.ok(mon.hasHiddenAbility());
	assert.ok(!getItemBehaviour(C("ability_capsule"))!.canUse(mon), "Capsule não mexe em habilidade oculta");
	const single = make("pikachu", 20);
	single.setAbility("static");
	assert.ok(!useItemOn(single, C("ability_capsule")).success, "uma só habilidade comum: sem troca");
}

// 11. TMs: só golpes da lista de TMs da forma; já conhecido/guardado não gasta; sem espaço vai para os guardados.
{
	const mon = make("pikachu", 5);
	const learnset = mon.getLearnset();
	const tmMove = learnset.tmMoves.find(move => !mon.getAccessibleMoves().includes(move))!;
	assert.ok(tmMove, "Pikachu tem TMs");
	const notTm = "spore";
	assert.ok(!getItemBehaviour(C("technical_machine"))!.canUse(mon, { tmMove: notTm }));
	const denied = useItemOn(mon, C("technical_machine"), { tmMove: notTm });
	assert.ok(!denied.success);
	assert.equal((denied.messages[0] as any).translate, "cobblemon.tms.cannot_learn");
	assert.equal((useItemOn(mon, C("technical_machine")).messages[0] as any).translate, "cobblemon.tms.unknown_move");
	const hadSpace = mon.moves.length < 4;
	const r = useItemOn(mon, C("technical_machine"), { tmMove });
	assert.ok(r.success && r.consume, "TM é gasto (infiniteTmUses = false)");
	assert.ok(mon.moves.includes(tmMove) || mon.learnedMoves.includes(tmMove));
	assert.equal(r.benchedMove === undefined, hadSpace);
	const again = useItemOn(mon, C("technical_machine"), { tmMove });
	assert.ok(!again.success);
	assert.equal((again.messages[0] as any).translate, "cobblemon.tms.already_known");
	// Moveset cheio: o golpe fica guardado e a interface oferece a troca.
	const full = make("mewtwo", 100);
	while (full.moves.length < 4) full.teachMove(full.getLearnset().tmMoves.find(m => !full.moves.includes(m))!);
	const fullTm = full.getLearnset().tmMoves.find(move => !full.getAccessibleMoves().includes(move))!;
	const benched = useItemOn(full, C("technical_machine"), { tmMove: fullTm });
	assert.ok(benched.success);
	assert.equal(benched.benchedMove, fullTm);
	assert.ok(full.learnedMoves.includes(fullTm) && !full.moves.includes(fullTm));
	// infiniteTmUses: não gasta.
	getConfig().infiniteTmUses = true;
	const other = make("pikachu", 5);
	assert.ok(!useItemOn(other, C("technical_machine"), { tmMove }).consume);
	getConfig().infiniteTmUses = false;
	// Lore do TM.
	assert.equal(parseTMMove([tmLoreLine("Thunderbolt")]), "thunderbolt");
	// Formato da Máquina de TM (scripts/machines/tm.ts) e o antigo com rawtext.
	assert.equal(parseTMMove([{ translate: "cobblemon.port.tm.move", with: { rawtext: [{ translate: "cobblemon.move.surf" }, { text: "surf" }] } }]), "surf");
	assert.equal(parseTMMove([{ rawtext: [{ text: "§7" }, { translate: "cobblemon.move.tackle" }] }]), "tackle");
	assert.equal(parseTMMove(["§7Thunder Wave"]), "thunderwave");
	assert.equal(parseTMMove(["cobblemon.move.surf"]), "surf");
	assert.equal(parseTMMove(["§7Not a move"]), undefined);
}

// 12. Evolução por item: só "gasta" quando a evolução começa (ItemInteractionEvolution / Link Cable).
{
	const eevee = make("eevee", 20);
	assert.ok(!getItemBehaviour(C("water_stone"))!.entityOnly, "pedras abrem a seleção do time");
	assert.ok(getItemBehaviour(C("sweet_apple"))!.entityOnly, "maçãs (comida) só apontando para o Pokémon");
	assert.ok(getItemBehaviour(C("kings_rock"))!.passIfUnusable);
	const r = useItemOn(eevee, C("water_stone"));
	assert.ok(r.success && r.consume, "evolução começou: gasta a pedra");
	assert.ok(eevee.readyEvolutions.includes("eevee_vaporeon"));
	assert.ok(!useItemOn(eevee, C("water_stone")).success, "já na fila: não gasta de novo");
	const bulbasaur = make("bulbasaur", 20);
	assert.ok(!useItemOn(bulbasaur, C("water_stone")).success, "sem evolução: não gasta");
	assert.ok(!useItemOn(eevee, C("moon_stone")).success, "pedra errada: não gasta");
	// Link Cable: evolução por troca sem parceiro, respeitando o item segurado exigido.
	const poliwhirl = make("poliwhirl", 30);
	assert.equal(findItemEvolutions(poliwhirl, C("link_cable")).length, 0, "sem King's Rock não evolui");
	assert.ok(!useItemOn(poliwhirl, C("link_cable")).success);
	poliwhirl.minecraftItem = "cobblemon:kings_rock";
	poliwhirl.item = "kingsrock";
	assert.ok(useItemOn(poliwhirl, C("link_cable")).success);
	assert.ok(poliwhirl.readyEvolutions.includes("poliwhirl_politoed"));
	assert.equal(poliwhirl.minecraftItem, undefined, "consumeHeldItem tira o King's Rock");
	// Karrablast precisa de parceiro (Shelmet): Link Cable não serve; Shell Helmet sim.
	const karrablast = make("karrablast", 30);
	assert.ok(!useItemOn(karrablast, C("link_cable")).success);
	assert.ok(useItemOn(karrablast, C("shell_helmet")).success);
}

// 13. Itens segurados → ids do Showdown (CobblemonHeldItemManager).
{
	assert.equal(toShowdownItemId("cobblemon:charcoal_stick"), "charcoal");
	assert.equal(toShowdownItemId("cobblemon:medicinal_leek"), "leek");
	assert.equal(toShowdownItemId("cobblemon:choice_scarf"), "choicescarf");
	assert.equal(toShowdownItemId("cobblemon:leftovers"), "leftovers");
	assert.equal(toShowdownItemId("cobblemon:sitrus_berry"), "sitrusberry");
	assert.equal(toShowdownItemId("cobblemon:kings_rock"), "kingsrock");
	assert.equal(toShowdownItemId("cobblemon:everstone"), "", "item sem efeito em batalha");
	assert.equal(toShowdownItemId("minecraft:bone"), "thickclub");
	assert.equal(toShowdownItemId("minecraft:diamond"), "");
	assert.equal(toShowdownItemId(undefined), "");
	assert.equal(showdownItemOf({ item: "charcoalstick", minecraftItem: "cobblemon:charcoal_stick" }), "charcoal");
	assert.equal(showdownItemOf({ item: "leftovers" }), "leftovers");
	assert.ok(Object.keys(HELD_ITEM_REMAPS).length >= 5);
	// Todo item segurado dos dados que o Showdown conhece mapeia para um id válido.
	for (const [id, data] of Object.entries(ITEMS)) {
		if (data.category !== "held_item") continue;
		const showdown = toShowdownItemId(`cobblemon:${id}`);
		assert.ok(showdown === "" || /^[a-z0-9]+$/.test(showdown), id);
	}
}

// 14. Comidas com efeito.
{
	assert.equal(foodKind("cobblemon:aprijuice_red"), "aprijuice");
	assert.equal(foodKind("cobblemon:sinister_tea"), "sinister_tea");
	assert.equal(foodKind("cobblemon:vivichoke_dip"), "vivichoke_dip");
	assert.equal(foodKind("cobblemon:potion"), undefined);
	assert.ok(Math.abs(saturationFor(4, 1.2) - 9.6) < 1e-9, "FoodData.eat(4, 1.2)");
}

// 15. Todo item marcado com um componente desta frente tem implementação.
{
	for (const key of ["cobblemon:use_on_pokemon", "cobblemon:technical_machine", "cobblemon:food_effect"])
		assert.ok(ITEM_CUSTOM_COMPONENTS[key], `componente ${key} registrado`);
	// Moomoo Milk é só de batalha (SimpleBagItemLike): fora dela não faz nada.
	const battleOnly = ["cobblemon:moomoo_milk"];
	const missing = (ITEM_COMPONENTS["cobblemon:use_on_pokemon"]?.items ?? []).filter(id => !getItemBehaviour(id) && !battleOnly.includes(id));
	assert.deepEqual(missing, [], "itens use_on_pokemon sem comportamento");
	const food = (ITEM_COMPONENTS["cobblemon:food_effect"]?.items ?? []).filter(id => !foodKind(id));
	assert.deepEqual(food, [], "comidas sem efeito");
}

console.warn = originalWarn;
console.log("ok: itens (cura, status, reviver, PP, EVs, mints, doces, Hyper Training, habilidades, TMs, evolução, itens segurados, comidas)");
