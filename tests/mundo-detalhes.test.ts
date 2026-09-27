// Frente "mundo-detalhes": item segurado visível e vestíveis, luz dinâmica, raio/imunidades, vasos, composteira,
// apricorn, Fortuna, espeleotema, estante de discos (discos + sequenciador), feto no tanque, abelha e o conteúdo
// gerado pelo importador (attachables, catálogo, compostagem, inflamáveis, overrides). API do Minecraft mockada.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPOST_BLOCK_ITEMS, FETUS_NAMES, FORTUNE, HELD_ITEM_LOCATORS, LIGHTING, LIGHTNING_ROTATE, WEARABLES } from "../generated/scripts/mundoDetalhes";
import { locatorFlagsOf, shownHeldItem } from "../scripts/entity/HeldItemDisplay";
import { chunkLights, lightLevelFor, POKEDEX_LIGHT, STORE_MAX_CHARS } from "../scripts/entity/DynamicLight";
import { canPollinate, foxFoodHeal, isPlainStack, nextBeeState } from "../scripts/entity/SpeciesBehaviours";
import { isFreezeImmune, lightningOutcome, rotateFeature } from "../scripts/world/Lightning";
import { apricornFacingForFace, composterNext, POTTABLE, POTTED_ITEM } from "../scripts/world/VanillaInteractions";
import { applyBonus, fortuneExtras } from "../scripts/world/Fortune";
import { columnThickness } from "../scripts/custom_components/DripstoneGrowthComponent";
import { discTextureFor, discTextureIndex, instrumentSound, sequencerNotes } from "../scripts/machines/discShelfSequencer";
import { fetusIndex, fetusProgress } from "../scripts/machines/fossilFetus";
import { Direction } from "@minecraft/server";
import { parseLenient } from "../tools/importer/util.ts";

const ROOT = process.cwd();
const GEN_BP = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock");
const GEN_RP = join(ROOT, "generated", "resource_packs", "CobblemonBedrock");
const HAND_BP = join(ROOT, "behavior_packs", "CobblemonBedrock");
const HAND_RP = join(ROOT, "resource_packs", "CobblemonBedrock");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
/** Sequência fixa para os sorteios. */
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

// ---------------------------------------------------------------------------------------------
// 1. Item segurado visível + vestíveis

{
	const base = { alpha: false, wild: false, locatorFlags: 7 };
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:leftovers" }), "cobblemon:leftovers");
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:leftovers", heldItemVisible: false }), "", "heldItemVisible = false esconde");
	assert.equal(shownHeldItem({ ...base, heldItem: "minecraft:barrier" }), "", "tag held/visibility/hidden");
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:leftovers", alpha: true, wild: true }), "", "Alfa selvagem não mostra");
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:leftovers", alpha: true, wild: false }), "cobblemon:leftovers");
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:leftovers", locatorFlags: 0 }), "", "sem locator não desenha");
	// Rosto sem item_face mas com item: cai no locator "item".
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:choice_specs", locatorFlags: 1 }), "cobblemon:choice_specs");
	assert.equal(shownHeldItem({ ...base, heldItem: "cobblemon:choice_band", locatorFlags: 2 }), "cobblemon:choice_band", "chapéu no item_hat");
	assert.equal(HELD_ITEM_LOCATORS.charmander?.[0], "7", "Charmander tem item, item_hat e item_face");
	assert.equal(locatorFlagsOf("charmander", 0), 7);
	assert.equal(locatorFlagsOf("aggron", 0), 0, "modelo sem locators de item");
	assert.equal(locatorFlagsOf("naoexiste", 0), 0);

	// 17 vestíveis (WearableHatItem/WearableBlockItem) com attachables do jogador e do Pokémon.
	assert.equal(Object.keys(WEARABLES).length, 17);
	assert.equal(WEARABLES["cobblemon:choice_specs"], "face");
	assert.equal(WEARABLES["cobblemon:choice_band"], "hat");
	for (const id of Object.keys(WEARABLES)) {
		const name = id.split(":")[1];
		const item = json(join(GEN_BP, "items", "cobblemon", `${name}.json`))["minecraft:item"].components;
		assert.deepEqual(item["minecraft:wearable"], { slot: "slot.armor.head", protection: 0 }, `${name}: wearable`);
		assert.equal(item["minecraft:max_stack_size"], 1, `${name}: pilha 1 em slot de armadura`);
		const player = json(join(GEN_RP, "attachables", "cobblemon", `${name}.player.json`))["minecraft:attachable"].description;
		assert.equal(player.item[id], "q.owner_identifier == 'minecraft:player'");
		assert.equal(player.geometry.default, "geometry.bow_standby", "sprite na mão");
		const poke = json(join(GEN_RP, "attachables", "cobblemon", `${name}.json`))["minecraft:attachable"].description;
		assert.equal(poke.identifier, id);
		const geo = json(join(GEN_RP, "models", "entity", "wearables", `${name}.geo.json`))["minecraft:geometry"];
		assert.equal(geo.length, 2);
		assert.equal(geo[0].bones[0].binding, "'head'");
		assert.equal(geo[1].bones[0].binding, `'cobblemon_anchor_${WEARABLES[id] === "face" ? "face" : "hat"}'`);
		assert.ok(geo[0].bones[1].cubes.length > 0, `${name}: cubos`);
	}
	// Choice Band no jogador: display.head (translação 4,75, escala 1,825) × 0,625 em volta do centro da cabeça (y 28).
	const band = json(join(GEN_RP, "models", "entity", "wearables", "choice_band.geo.json"))["minecraft:geometry"][0].bones[1];
	assert.deepEqual(band.pivot, [0, 30.9688, 0]);
	// Ossos e animação de âncora nas geometrias de Pokémon.
	const geo = readFileSync(join(GEN_RP, "models", "entity", "pokemon", "0004_charmander", "charmander.geo.json"), "utf8");
	for (const bone of ["leftItem", "rightItem", "cobblemon_anchor_item", "cobblemon_anchor_hat", "cobblemon_anchor_face"]) assert.ok(geo.includes(`"${bone}"`), `charmander: osso ${bone}`);
	const anchor = json(join(GEN_RP, "animations", "pokemon", "_generated", "charmander_held.animation.json")).animations["animation.cobblemon_gen.charmander.held_item_anchor"];
	assert.deepEqual(anchor.bones.cobblemon_anchor_hat.position, [0, 20.5, -0.5]);
	const client = json(join(GEN_RP, "entity", "pokemon", "charmander.entity.json"))["minecraft:client_entity"].description;
	assert.ok(client.scripts.animate.includes("cobblemon_held_item_anchor"));
	// Cópia visual na mão secundária nunca cai.
	const bp = json(join(GEN_BP, "entities", "pokemon", "charmander.json"))["minecraft:entity"].components;
	assert.deepEqual(bp["minecraft:equipment"].slot_drop_chance, [{ slot: "slot.weapon.offhand", drop_chance: 0 }]);
}

// ---------------------------------------------------------------------------------------------
// 2. Luz dinâmica (lightingData)

{
	assert.ok(Object.keys(LIGHTING).length >= 60, "espécies com lightingData");
	assert.equal(lightLevelFor("charmander", undefined, false), 11);
	assert.equal(lightLevelFor("charmander", undefined, true), 0, "LAND não brilha submerso");
	assert.equal(lightLevelFor("chinchou", undefined, true), 14, "BOTH brilha submerso");
	assert.equal(lightLevelFor("ampharos", "Mega", false), 13, "forma com lightingData próprio");
	assert.equal(lightLevelFor("ampharos", "Normal", false), 12);
	assert.equal(lightLevelFor("marowak", "alola", false), 9, "só a forma tem luz");
	assert.equal(lightLevelFor("marowak", undefined, false), 0);
	assert.equal(lightLevelFor("bulbasaur", undefined, false), 0);
	assert.equal(POKEDEX_LIGHT, 13);
	// Gravação das luzes: cada pedaço cabe na propriedade; o que não cabe é contado.
	const many = Array.from({ length: 3000 }, (_, i) => ["minecraft:overworld", i, 64, -i, false] as [string, number, number, number, boolean]);
	const stored = chunkLights(many);
	assert.ok(stored.chunks.every(c => c.length <= STORE_MAX_CHARS), "pedaço dentro do limite");
	assert.equal(stored.chunks.flatMap(c => JSON.parse(c)).length + stored.dropped, many.length);
	assert.equal(stored.dropped, 0, "3000 luzes cabem nos pedaços");
	const tight = chunkLights(many, 200, 2);
	assert.equal(tight.chunks.length, 2);
	assert.ok(tight.chunks.every(c => c.length <= 200));
	assert.equal(tight.chunks.flatMap(c => JSON.parse(c)).length + tight.dropped, many.length, "o que não cabe é contado");
	assert.deepEqual(chunkLights([]).chunks, []);
}

// ---------------------------------------------------------------------------------------------
// 3. Raio e imunidades

{
	assert.equal(lightningOutcome(["ground"], "sandveil"), "type_immune");
	assert.equal(lightningOutcome(["electric"], "Lightning Rod"), "lightningrod");
	assert.equal(lightningOutcome(["electric"], "motordrive"), "motordrive");
	assert.equal(lightningOutcome(["water"], "voltabsorb"), "voltabsorb");
	assert.equal(lightningOutcome(["water"], "torrent"), "damage");
	assert.deepEqual(LIGHTNING_ROTATE.miltank, [{ key: "mooshtank", chain: ["red", "brown"] }]);
	assert.deepEqual(rotateFeature(["mooshtank-red", "shiny"], "mooshtank", ["red", "brown"]), ["mooshtank-brown", "shiny"]);
	assert.deepEqual(rotateFeature(["mooshtank-brown"], "mooshtank", ["red", "brown"]), ["mooshtank-red"]);
	assert.equal(rotateFeature(["shiny"], "mooshtank", ["red", "brown"]), undefined, "Miltank comum não muda");
	assert.equal(isFreezeImmune("snorunt", ["ice"]), true);
	assert.equal(isFreezeImmune("pikachu", ["electric"]), false);
	assert.equal(isFreezeImmune("pikachu", ["electric"], true), true, "behaviour.freezeImmune");
}

// ---------------------------------------------------------------------------------------------
// 4. Vasos, composteira, apricorn

{
	assert.equal(POTTABLE["cobblemon:red_apricorn_seed"], "cobblemon:potted_red_apricorn_sapling");
	assert.equal(POTTABLE["cobblemon:pep_up_flower"], "cobblemon:potted_pep_up_flower");
	assert.equal(POTTED_ITEM["cobblemon:potted_saccharine_sapling"], "cobblemon:saccharine_sapling");
	for (const pot of Object.values(POTTABLE)) assert.ok(readdirSync(join(GEN_BP, "blocks"), { recursive: true }).length > 0 && pot.startsWith("cobblemon:potted_"));
	// ComposterBlock.addItem: nível 0 sempre sobe; depois só com a chance.
	assert.equal(composterNext(0, 0.3, 0.99), 1);
	assert.equal(composterNext(3, 0.3, 0.2), 4);
	assert.equal(composterNext(3, 0.3, 0.5), 3);
	assert.equal(composterNext(7, 1, 0), 7);
	assert.equal(COMPOST_BLOCK_ITEMS["cobblemon:apricorn_leaves"], 0.3, "folhas de apricorn (item de bloco)");
	assert.equal(COMPOST_BLOCK_ITEMS["cobblemon:hearty_grain_bale"], 0.85);
	const oran = json(join(GEN_BP, "items", "cobblemon", "oran_berry.json"))["minecraft:item"].components;
	assert.deepEqual(oran["minecraft:compostable"], { composting_chance: 65 });
	const mint = json(join(GEN_BP, "items", "cobblemon", "red_mint_leaf.json"))["minecraft:item"].components;
	assert.deepEqual(mint["minecraft:compostable"], { composting_chance: 50 });
	const remedy = json(join(GEN_BP, "items", "cobblemon", "superb_remedy.json"))["minecraft:item"].components;
	assert.deepEqual(remedy["minecraft:compostable"], { composting_chance: 100 });
	// Semente na lateral da folha: o apricorn aponta para a folha.
	assert.equal(apricornFacingForFace(Direction.North as never), "south");
	assert.equal(apricornFacingForFace(Direction.East as never), "west");
	assert.equal(apricornFacingForFace(Direction.Up as never), undefined);
}

// ---------------------------------------------------------------------------------------------
// 5. Fortuna e espeleotema

{
	const ore = FORTUNE["cobblemon:moon_stone_ore"];
	assert.ok(ore?.length === 1 && ore[0].item === "cobblemon:moon_stone" && ore[0].formula === "ore_drops");
	// ore_drops: rand(nível + 2) − 1 (mínimo 0) + 1 vezes a base.
	assert.equal(applyBonus(ore[0], 1, 3, seq(0.99)), 4);
	assert.equal(applyBonus(ore[0], 1, 3, seq(0.0)), 1);
	assert.equal(applyBonus(ore[0], 1, 0, seq(0.99)), 1, "sem Fortuna");
	const gem = FORTUNE["cobblemon:fire_gem_block"][0];
	assert.equal(gem.formula, "uniform_bonus_count");
	assert.equal(gem.limitMax, 4);
	assert.equal(applyBonus(gem, 2, 3, seq(0.99)), 4, "limit_count");
	const leek = FORTUNE["cobblemon:medicinal_leek"][0];
	assert.deepEqual(leek.states, { "cobblemon:age": 3 });
	assert.equal(applyBonus(leek, 1, 1, seq(0.1)), 5, "binomial: nível 1 + 3 tentativas");
	assert.deepEqual(fortuneExtras("cobblemon:medicinal_leek", { "cobblemon:age": 2 }, 3, seq(0.1)), [], "estado errado não ganha bônus");
	assert.deepEqual(fortuneExtras("cobblemon:moon_stone_ore", {}, 2, seq(0.0, 0.99)), [{ item: "cobblemon:moon_stone", amount: 2 }]);
	assert.deepEqual(columnThickness(1), ["tip"]);
	assert.deepEqual(columnThickness(2), ["frustum", "tip"]);
	assert.deepEqual(columnThickness(4), ["base", "middle", "frustum", "tip"]);
	const dripOre = readFileSync(join(GEN_BP, "blocks", ...findBlock("cobblemon:dripstone_moon_stone_ore")), "utf8");
	assert.ok(dripOre.includes("cobblemon:dripstone_growable"), "minério do espeleotema com o componente de crescimento");
}

function findBlock(id: string): string[] {
	for (const f of readdirSync(join(GEN_BP, "blocks"), { recursive: true }) as string[]) {
		if (!f.endsWith(".json")) continue;
		const j = json(join(GEN_BP, "blocks", f));
		if (j["minecraft:block"]?.description?.identifier === id) return [f];
	}
	throw new Error(`bloco ${id} não gerado`);
}

// ---------------------------------------------------------------------------------------------
// 6. Estante de discos e feto no tanque

{
	assert.equal(discTextureFor("minecraft:music_disc_cat"), "music_disc_cat");
	assert.equal(discTextureFor("minecraft:music_disc_futuro"), "music_disc_unknown");
	assert.equal(discTextureFor("cobblemon:technical_machine", "Fire"), "fire_tm");
	assert.equal(discTextureFor("cobblemon:blank_tm"), "blank_tm");
	assert.equal(discTextureFor("cobblemon:upgrade"), "upgrade");
	assert.equal(discTextureIndex(undefined), 0);
	assert.ok(discTextureIndex("cobblemon:dubious_disc") > 0);
	// C (espaço 10) = 1; espaço 1 sobe uma oitava; 1 e 12 juntos se anulam.
	const filled = (...slots: number[]) => Array.from({ length: 14 }, (_, i) => slots.includes(i));
	assert.deepEqual(sequencerNotes(filled(10)), [1]);
	assert.deepEqual(sequencerNotes(filled(10, 1)), [2]);
	assert.deepEqual(sequencerNotes(filled(10, 12)), [0.5]);
	assert.deepEqual(sequencerNotes(filled(10, 1, 12)), [1]);
	assert.equal(sequencerNotes(filled(0)).length, 1);
	assert.equal(instrumentSound("minecraft:air"), "note.bit");
	assert.equal(instrumentSound("minecraft:oak_planks"), "note.bass");
	assert.equal(instrumentSound("minecraft:stone"), "note.bd");
	assert.equal(instrumentSound("minecraft:sand"), "note.snare");
	assert.equal(instrumentSound("minecraft:gold_block"), "note.bell");
	assert.equal(instrumentSound("minecraft:dirt"), "note.harp");
	const display = json(join(GEN_BP, "entities", "display", "disc_shelf_display.json"))["minecraft:entity"].description.properties;
	assert.equal(Object.keys(display).length, 14);
	assert.ok(existsSync(join(GEN_RP, "textures", "block", "disc_shelf", "fire_tm.png")));
	assert.equal(FETUS_NAMES[0], "substitute");
	assert.equal(fetusIndex("cobblemon:kabuto"), FETUS_NAMES.indexOf("kabuto"));
	assert.equal(fetusIndex("inexistente"), 0);
	assert.equal(fetusProgress(-1, 100, false), 0);
	assert.equal(fetusProgress(25, 100, false), 0.75);
	assert.equal(fetusProgress(0, 100, false), 1);
	assert.equal(fetusProgress(50, 100, true), 1);
	const fetus = json(join(GEN_RP, "entity", "display", "fossil_fetus.entity.json"))["minecraft:client_entity"].description;
	assert.equal(Object.keys(fetus.geometry).length, 19, "3 embriões + 16 fetos");
	const fetusBp = json(join(GEN_BP, "entities", "display", "fossil_fetus.json"))["minecraft:entity"].description.properties;
	assert.ok(fetusBp["cobblemon:progress"].range.every((v: number) => !Number.isInteger(v)), "faixa float");
}

// ---------------------------------------------------------------------------------------------
// 7. Comportamentos de espécie (Combee, Vulpix)

{
	assert.equal(canPollinate("minecraft:overworld", 6000, false), true);
	assert.equal(canPollinate("minecraft:overworld", 18000, false), false, "noite");
	assert.equal(canPollinate("minecraft:overworld", 6000, true), false, "chuva");
	assert.equal(canPollinate("minecraft:nether", 18000, true), true);
	assert.equal(nextBeeState({ state: "idle" }, true, 0), "seek");
	assert.equal(nextBeeState({ state: "cooldown", until: 100 }, true, 50), "cooldown");
	assert.equal(nextBeeState({ state: "cooldown", until: 100 }, true, 150), "seek");
	assert.equal(nextBeeState({ state: "seek" }, false, 0), "idle");
	assert.equal(nextBeeState({ state: "nectar" }, false, 0), "nectar", "néctar não se perde à noite");
	const combee = json(join(GEN_BP, "entities", "pokemon", "combee.json"))["minecraft:entity"];
	assert.ok(combee.component_groups["cobblemon:bee_look_for_flower"]["minecraft:behavior.move_to_block"].target_blocks.includes("minecraft:dandelion"));
	assert.deepEqual(combee.component_groups["cobblemon:bee_return"]["minecraft:behavior.move_to_block"].target_blocks, ["cobblemon:saccharine_leaves", "minecraft:beehive", "minecraft:bee_nest"]);
	assert.ok(combee.events["cobblemon:bee_seek"] && combee.events["cobblemon:bee_idle"] && combee.events["cobblemon:bee_deposit"]);
	assert.ok(combee.events["cobblemon:battle_start"].remove.component_groups.includes("cobblemon:bee_return"), "batalha tira a IA da abelha");
	const vulpix = json(join(GEN_BP, "entities", "pokemon", "vulpix.json"))["minecraft:entity"];
	assert.ok(vulpix.components["minecraft:type_family"].family.includes("lightweight"), "neve fofa");
	const wild = vulpix.component_groups["cobblemon:wild_ai"];
	assert.equal(wild["minecraft:behavior.pickup_items"].can_pickup_any_item, true);
	assert.equal(wild["minecraft:behavior.eat_carried_item"], undefined, "comer é do script (inventário = item segurado)");
	assert.ok(vulpix.components["minecraft:equipment"].slot_drop_chance.some((d: any) => d.slot === "slot.weapon.mainhand" && d.drop_chance === 1));
	assert.equal(foxFoodHeal("cobblemon:oran_berry"), 2);
	assert.equal(foxFoodHeal("minecraft:sweet_berries"), 2);
	assert.equal(foxFoodHeal("minecraft:bread"), 1);
	assert.equal(foxFoodHeal("minecraft:stick"), 0, "item comum fica na boca");
	// Só pilhas comuns vão para a boca (a boca guarda só o id).
	assert.equal(isPlainStack({ typeId: "minecraft:stick", getLore: () => [], getDynamicPropertyIds: () => [], getComponent: () => undefined }), true);
	assert.equal(isPlainStack({ typeId: "minecraft:stick", nameTag: "Varinha" }), false, "com nome");
	assert.equal(isPlainStack({ typeId: "minecraft:stick", getLore: () => ["x"] }), false, "com lore");
	assert.equal(isPlainStack({ typeId: "minecraft:stick", getDynamicPropertyIds: () => ["a"] }), false, "com propriedade dinâmica");
	assert.equal(isPlainStack({ typeId: "minecraft:iron_sword", getComponent: (id: string) => id === "minecraft:enchantable" ? { getEnchantments: () => [{}] } : undefined }), false, "encantado");
	assert.equal(isPlainStack({ typeId: "minecraft:iron_sword", getComponent: (id: string) => id === "minecraft:durability" ? { damage: 3 } : undefined }), false, "gasto");
	for (const id of ["minecraft:shulker_box", "minecraft:red_shulker_box", "minecraft:bundle", "minecraft:potion", "minecraft:tipped_arrow", "minecraft:written_book", "minecraft:filled_map", "minecraft:firework_rocket"])
		assert.equal(isPlainStack({ typeId: id }), false, id);
	assert.deepEqual(wild["minecraft:behavior.raid_garden"].blocks, ["minecraft:sweet_berry_bush"]);
	const triggers = vulpix.components["minecraft:damage_sensor"].triggers;
	assert.ok(triggers.some((t: any) => t.on_damage?.filters?.value === "minecraft:sweet_berry_bush" && t.deals_damage === "no"));
}

// ---------------------------------------------------------------------------------------------
// 8. Conteúdo: catálogo, inflamáveis, atrito, piglin, restos do Braised Vivichoke, atril

{
	const catalog = json(join(GEN_BP, "item_catalog", "crafting_item_catalog.json"))["minecraft:crafting_items_catalog"].categories;
	const groups = catalog.flatMap((c: any) => c.groups.map((g: any) => g.group_identifier.name));
	for (const tab of ["blocks", "utility_item", "agriculture", "archaeology", "consumables", "held_item", "evolution_item"])
		assert.ok(groups.includes(`cobblemon:itemGroup.cobblemon.${tab}`), `aba ${tab}`);
	const lang = readFileSync(join(GEN_RP, "texts", "pt_BR.lang"), "utf8");
	assert.ok(lang.includes("cobblemon:itemGroup.cobblemon.blocks=Cobblemon: Blocos"));
	const pc = json(join(GEN_BP, "blocks", ...findBlock("cobblemon:pc")))["minecraft:block"].description.menu_category;
	assert.deepEqual(pc, { category: "construction", group: "cobblemon:itemGroup.cobblemon.blocks" }, "bloco com a categoria/grupo do catálogo");
	const leaves = json(join(GEN_BP, "blocks", ...findBlock("cobblemon:apricorn_leaves")))["minecraft:block"].components["minecraft:flammable"];
	assert.deepEqual(leaves, { catch_chance_modifier: 30, destroy_chance_modifier: 60 });
	const button = json(join(GEN_BP, "blocks", ...findBlock("cobblemon:apricorn_button")))["minecraft:block"].components["minecraft:flammable"];
	assert.equal(button, undefined, "botão não é inflamável no Java");
	const ice = json(join(GEN_BP, "blocks", ...findBlock("cobblemon:never_melt_ice")))["minecraft:block"].components["minecraft:friction"];
	assert.equal(ice, 0.011);
	const lectern = json(join(GEN_BP, "blocks", ...findBlock("cobblemon:lectern")))["minecraft:block"];
	assert.deepEqual(lectern.description.states["cobblemon:emit_light"], [false, true]);
	assert.ok(lectern.permutations.some((p: any) => p.components["minecraft:light_emission"] === 13));
	const piglin = parseLenient(readFileSync(join(HAND_BP, "entities", "vanilla_overrides", "piglin.json"), "utf8"))["minecraft:entity"];
	assert.ok(piglin.components["minecraft:shareables"].items.some((i: any) => i.item === "cobblemon:relic_coin_pouch" && i.barter));
	assert.ok(piglin.component_groups.interactable_piglin["minecraft:interact"].interactions.some((i: any) => JSON.stringify(i).includes("cobblemon:relic_coin_pouch") && i.barter));
	// Tags de comida vanilla: galinha/papagaio (sementes), cavalo/burro/mula (maçãs), raposa (berries), piglin (moedas).
	const chicken = JSON.stringify(json(join(GEN_BP, "entities", "vanilla_overrides", "chicken.json")));
	assert.ok(chicken.includes("cobblemon:vivichoke_seeds") && chicken.includes("cobblemon:red_mint_seeds"));
	const parrot = json(join(GEN_BP, "entities", "vanilla_overrides", "parrot.json"));
	assert.ok(JSON.stringify(parrot).includes("cobblemon:blue_mint_seeds"));
	for (const horse of ["horse", "donkey", "mule"]) {
		const h = json(join(GEN_BP, "entities", "vanilla_overrides", `${horse}.json`))["minecraft:entity"];
		assert.ok(h.components["minecraft:healable"].items.some((i: any) => i.item === "cobblemon:sweet_apple" && i.heal_amount === 3), `${horse}: maçã do Cobblemon cura como a maçã`);
	}
	const fox = JSON.stringify(parseLenient(readFileSync(join(HAND_BP, "entities", "vanilla_overrides", "fox.json"), "utf8")));
	assert.ok(fox.includes("cobblemon:oran_berry"), "raposa come/reproduz com berries");
	assert.ok(piglin.components["minecraft:shareables"].items.some((i: any) => i.item === "cobblemon:relic_coin" && i.admire && !i.barter), "piglin_loved");
	assert.ok(!existsSync(join(HAND_BP, "items", "generic", "braised_vivichoke.json")), "Braised Vivichoke (removido no 1.7.0)");
	// A pasta pode não existir num clone (o git não versiona pasta vazia): sem ela, também não há a receita.
	assert.ok(!existsSync(join(HAND_BP, "recipes")) || !readdirSync(join(HAND_BP, "recipes")).some(f => f.includes("braised_vivichoke")));
	assert.ok(!existsSync(join(HAND_RP, "textures", "item", "braised_vivichoke.png")));
}

console.log("ok: item segurado/vestíveis, luz dinâmica, raio/imunidades, vasos/composteira/apricorn, Fortuna/espeleotema, estante/feto, abelha/raposa, catálogo e conteúdo");
