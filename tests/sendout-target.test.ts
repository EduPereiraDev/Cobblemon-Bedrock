// Envio do Pokémon (raycastSafeSendout do Java): nunca no pé do jogador; grama não bloqueia; bloco perigoso não serve.
import assert from "node:assert/strict";
import { Direction } from "@minecraft/server";
import { groundInFront, isPositionSafe, safeSendOutPosition, SendOutWorld } from "../scripts/pokemon/SendOutTarget";

type V = { x: number; y: number; z: number };
const key = (p: V) => `${p.x},${p.y},${p.z}`;

/** Chão plano de terra em y=63 (topo em 64), com blocos extras; `aim` fixo. */
function flatWorld(extra: Record<string, string> = {}, aim?: ReturnType<SendOutWorld["aim"]>): SendOutWorld {
	const PASSABLE = new Set(["minecraft:short_grass", "minecraft:poppy", "minecraft:fire", "minecraft:sweet_berry_bush", "minecraft:wither_rose"]);
	const idAt = (p: V) => extra[key(p)] ?? (p.y <= 63 ? "minecraft:dirt" : undefined);
	return {
		aim: () => aim,
		solid: (p) => { const id = idAt(p); return !!id && !PASSABLE.has(id) && id !== "minecraft:water" && id !== "minecraft:lava"; },
		nonAir: (p) => !!idAt(p),
		typeId: (p) => idAt(p) ?? "minecraft:air",
	};
}
const hitbox = { width: 1, height: 1, scale: 1 };
const eye = { x: 0.5, y: 65.62, z: 0.5 };
const norm = (v: V) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };

// 1. Mira no topo da terra a 5 blocos: nasce ali, em cima (y 64), não no jogador.
{
	const w = flatWorld({}, { block: { x: 0, y: 63, z: 5 }, face: Direction.Up as Direction, point: { x: 0.5, y: 64, z: 5.4 } });
	assert.deepEqual(safeSendOutPosition(w, eye, norm({ x: 0, y: -0.3, z: 1 }), hitbox), { x: 0.5, y: 64, z: 5.4 });
}
// 2. Grama baixa em cima do bloco mirado não impede (no port antigo, caía no pé do jogador).
{
	const w = flatWorld({ "0,64,5": "minecraft:short_grass" }, { block: { x: 0, y: 63, z: 5 }, face: Direction.Up as Direction, point: { x: 0.5, y: 64, z: 5.5 } });
	assert.deepEqual(safeSendOutPosition(w, eye, norm({ x: 0, y: -0.3, z: 1 }), hitbox), { x: 0.5, y: 64, z: 5.5 });
}
// 3. Bloco sólido em cima do mirado: não serve (o Java devolve null).
{
	const w = flatWorld({ "0,64,5": "minecraft:stone" }, { block: { x: 0, y: 63, z: 5 }, face: Direction.Up as Direction, point: { x: 0.5, y: 64, z: 5.5 } });
	assert.equal(safeSendOutPosition(w, eye, norm({ x: 0, y: -0.3, z: 1 }), hitbox), undefined);
}
// 4. Mira no ar (olhando reto para o horizonte): acha o chão embaixo da linha, à frente, nunca no jogador.
{
	const at = safeSendOutPosition(flatWorld(), eye, { x: 0, y: 0, z: 1 }, hitbox);
	assert.ok(at, "achou chão embaixo da mira");
	assert.equal(at!.y, 64);
	assert.ok(at!.z >= 2.5, `à frente do jogador (z ${at!.z})`);
}
// 5. Mira no céu: nenhum chão ao alcance da queda → não manda.
assert.equal(safeSendOutPosition(flatWorld(), eye, norm({ x: 0, y: 1, z: 0.2 }), hitbox), undefined);
// 6. Lateral de uma parede a 4 blocos: fica na frente da face, no chão.
{
	const wall = { "0,64,4": "minecraft:stone", "0,65,4": "minecraft:stone", "0,66,4": "minecraft:stone" };
	const w = flatWorld(wall, { block: { x: 0, y: 65, z: 4 }, face: Direction.North as Direction, point: { x: 0.5, y: 65.6, z: 4 } });
	const at = safeSendOutPosition(w, eye, { x: 0, y: 0, z: 1 }, hitbox);
	assert.ok(at);
	assert.equal(at!.y, 64);
	assert.ok(Math.abs(at!.z - (4 - 0.625)) < 1e-9, `na frente da parede (z ${at!.z})`);
}
// 7. Posição perigosa: cacto, arbusto de berry, lava; seguro: terra, grama.
{
	const w = flatWorld({ "0,63,5": "minecraft:cactus", "1,64,5": "minecraft:sweet_berry_bush", "2,63,5": "minecraft:lava" });
	assert.equal(isPositionSafe(w, { x: 0, y: 63, z: 5 }), false);
	assert.equal(isPositionSafe(w, { x: 1, y: 63, z: 5 }), false, "arbusto em cima do bloco de apoio");
	assert.equal(isPositionSafe(w, { x: 2, y: 63, z: 5 }), false);
	assert.equal(isPositionSafe(w, { x: 3, y: 63, z: 5 }), true);
	const onCactus = flatWorld({ "0,63,5": "minecraft:cactus" }, { block: { x: 0, y: 63, z: 5 }, face: Direction.Up as Direction, point: { x: 0.5, y: 64, z: 5.5 } });
	assert.equal(safeSendOutPosition(onCactus, eye, norm({ x: 0, y: -0.3, z: 1 }), hitbox), undefined);
}
// 8. Plano B do menu (sem mira): mesmo olhando o céu, o chão à frente (2,5 blocos), não o pé do jogador.
{
	const at = groundInFront(flatWorld(), eye, norm({ x: 0, y: 1, z: 0.2 }));
	assert.ok(at, "chão à frente");
	assert.equal(at!.y, 64);
	assert.ok(Math.abs(at!.z - (0.5 + 2.5)) < 1e-9, `2,5 blocos à frente (z ${at!.z})`);
	// Em cima de um vazio sem chão em 8 blocos: nada.
	const voidWorld: SendOutWorld = { aim: () => undefined, solid: () => false, nonAir: () => false, typeId: () => "minecraft:air" };
	assert.equal(groundInFront(voidWorld, eye, { x: 0, y: 0, z: 1 }), undefined);
}
console.log("sendout-target: 8 testes ok");
