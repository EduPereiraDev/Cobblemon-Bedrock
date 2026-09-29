// Frente montaria-pulo (docs/pendencias/montaria-pulo.md): na terra (onde o jogador pode desmontar sozinho) todo
// grupo de montaria gerado tem uma ação para o Espaço (sem nenhuma, o cliente do Bedrock usa o Espaço para desmontar:
// o jogador "pulava" do Dragonite); no ar/água o desmontar é só do servidor (Dismount desligada). A decolagem só volta
// para LAND depois de sair do chão.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRideInfo } from "../scripts/entity/EntityData";
import { landingCounts, nextRideStyle, sneakDismounts } from "../scripts/entity/Riding";

const originalWarn = console.warn;
console.warn = () => { };
const ROOT = process.cwd();
const DIR = join(ROOT, "generated", "behavior_packs", "CobblemonBedrock", "entities", "pokemon");

/** Ações de Espaço dos mounts vanilla: cavalo can_power_jump, nautilus/camelo dash_action, ghast feliz vertical_movement_action. */
const SPACE_ACTIONS = ["minecraft:can_power_jump", "minecraft:vertical_movement_action", "minecraft:dash_action"];

// 1. Todas as entidades geradas: o grupo da terra tem ação de Espaço; no ar/água o agachar não desmonta pelo motor
// (Riding.applyControls desliga InputPermissionCategory.Dismount e o servidor manda does_server_auth_only_dismount).
{
	let checked = 0;
	const missing: string[] = [];
	for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
		const e = JSON.parse(readFileSync(join(DIR, file), "utf8"))["minecraft:entity"];
		const group = e.component_groups?.["cobblemon:ride_land"];
		if (!group) continue;
		checked++;
		if (!SPACE_ACTIONS.some((c) => group[c])) missing.push(file);
	}
	assert.ok(checked > 80, `grupos ride_land conferidos: ${checked}`);
	// Toda espécie que voa montada: sem navigation.fly na base (senão o ride_air cai).
	const withFlyNav = readdirSync(DIR).filter((f) => f.endsWith(".json")).filter((f) => {
		const e = JSON.parse(readFileSync(join(DIR, f), "utf8"))["minecraft:entity"];
		return e.component_groups?.["cobblemon:ride_air"] && e.components["minecraft:navigation.fly"];
	});
	assert.deepEqual(withFlyNav, [], "navigation.fly na base de quem voa montado");
	assert.deepEqual(missing, [], "ride_land sem ação para o Espaço (o cliente desmonta)");
	assert.equal(sneakDismounts("LAND"), true);
	assert.equal(sneakDismounts("AIR"), false, "no ar o desmontar é só do servidor (agachar 2×)");
	assert.equal(sneakDismounts("LIQUID"), false, "na água o desmontar é só do servidor (agachar 2×)");
}

// 2. Dragonite (canJump=false na terra): pulo de força 0 na terra, sobe com Espaço no ar; Charizard mantém o pulo.
{
	const read = (id: string) => JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"))["minecraft:entity"].component_groups;
	const dragonite = read("dragonite");
	assert.deepEqual(dragonite["cobblemon:ride_land"]["minecraft:can_power_jump"], {});
	assert.equal(dragonite["cobblemon:ride_land"]["minecraft:horse.jump_strength"].value, 0, "canJump=false: Espaço não pula");
	assert.equal(dragonite["cobblemon:ride_air"]["minecraft:vertical_movement_action"].vertical_velocity, 0.5);
	assert.equal(dragonite["cobblemon:ride_air"]["minecraft:physics"].has_gravity, false);
	assert.equal(dragonite["cobblemon:ride_air_tired"]["minecraft:vertical_movement_action"], undefined, "sem fôlego não sobe");
	// navigation.fly religa a gravidade: fora da base e dos grupos de montaria, só no move_ai (solto).
	const base = JSON.parse(readFileSync(join(DIR, "dragonite.json"), "utf8"))["minecraft:entity"].components;
	assert.equal(base["minecraft:navigation.fly"], undefined, "navigation.fly fora da base de quem voa montado");
	assert.ok(dragonite["cobblemon:move_ai"]["minecraft:navigation.fly"], "solto, continua navegando voando");
	for (const g of ["cobblemon:ride_land", "cobblemon:ride_air", "cobblemon:ride_air_tired", "cobblemon:ride_liquid"]) assert.equal(dragonite[g]["minecraft:navigation.fly"], undefined, g);
	const charizard = read("charizard");
	assert.equal(charizard["cobblemon:ride_land"]["minecraft:horse.jump_strength"].value, getRideInfo("charizard")!.styles.LAND!.jump);
	assert.ok(getRideInfo("charizard")!.styles.LAND!.jump > 0);
}

// 3. Decolagem: parada no chão logo depois do pulo duplo, o AIR não volta para LAND (a câmera ia e voltava).
{
	const all = ["LAND", "AIR"] as const;
	const s = { inLiquid: false, eyeInFluid: false, doubleJump: false, hasDriver: true };
	const takeoff = { style: "AIR" as const, airborne: false, lastTransition: 100 };
	assert.equal(landingCounts(takeoff, true, 110), false, "no chão 10 ticks depois do pulo duplo: ainda decolando");
	assert.equal(nextRideStyle("AIR", all, { ...s, onGround: landingCounts(takeoff, true, 110) }), "AIR");
	assert.equal(landingCounts({ ...takeoff, airborne: true }, true, 110), true, "saiu do chão e voltou: pousa");
	assert.equal(nextRideStyle("AIR", all, { ...s, onGround: landingCounts({ ...takeoff, airborne: true }, true, 110) }), "LAND");
	assert.equal(landingCounts(takeoff, true, 140), true, "sem conseguir subir (teto) por 40 ticks: volta para a terra");
	assert.equal(landingCounts(takeoff, false, 110), false);
	assert.equal(landingCounts({ style: "LAND", lastTransition: 100 }, true, 101), true, "fora do AIR o chão vale na hora");
}

console.warn = originalWarn;
console.log("montaria-pulo: ok");
