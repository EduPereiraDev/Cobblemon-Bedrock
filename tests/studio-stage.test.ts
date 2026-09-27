// Estúdio de câmera: dois jogadores com a tela aberta na mesma coluna não dividem o palco nem o chão de barreira.
import assert from "node:assert/strict";
import { pickStage, STAGE_SPACING } from "../scripts/ui/studio/Studio";

const air = { isAir: true, typeId: "minecraft:air" } as any;
const dimension = { id: "minecraft:overworld", heightRange: { min: -64, max: 320 }, getBlock: () => air } as any;
const player = (id: string, x: number) => ({ id, location: { x, y: 68, z: 14.5 } }) as any;

const first = pickStage(player("a", 29.5), dimension, []);
assert.ok(first, "primeiro estúdio acima do jogador");
assert.equal(first!.x, 29.5);

// Segundo jogador na mesma coluna: palco deslocado pelo menos STAGE_SPACING na horizontal.
const second = pickStage(player("b", 29.5), dimension, [first!]);
assert.ok(second, "segundo estúdio encontrado");
assert.ok(Math.hypot(second!.x - first!.x, second!.z - first!.z) >= STAGE_SPACING, "palcos separados");

// Terceiro: longe dos dois.
const third = pickStage(player("c", 29.5), dimension, [first!, second!]);
assert.ok(third);
for (const other of [first!, second!]) assert.ok(Math.hypot(third!.x - other.x, third!.z - other.z) >= STAGE_SPACING);

// Sem espaço em nenhum deslocamento: sem estúdio (a tela cai no retrato 2D).
const full = [0, 24, -24, 48, -48].map(dx => ({ x: 29.5 + dx, y: 116, z: 14.5 }));
assert.equal(pickStage(player("d", 29.5), dimension, full), undefined);

console.log("studio-stage: ok");
