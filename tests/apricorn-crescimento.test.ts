// Apricorn no ritmo do Java: o Bedrock sorteia 1 tick aleatório onde o Java sorteia 3 (randomTickSpeed 1 × 3).
import assert from "node:assert/strict";
import { JAVA_RANDOM_TICKS_PER_BEDROCK, perBedrockRandomTick, SAPLING_BONEMEAL_CHANCE, SAPLING_GROW_CHANCE, SAPLING_MIN_LIGHT } from "../scripts/custom_components/SaplingComponent";
import SaplingComponent from "../scripts/custom_components/SaplingComponent";

assert.equal(JAVA_RANDOM_TICKS_PER_BEDROCK, 3);
// Paridade de ritmo: avanços esperados por tick do Bedrock = 3 × chance do Java por tick do Java.
// SaplingBlock: nextInt(7) == 0 → 3/7 por tick aleatório do Bedrock.
assert.ok(Math.abs(SAPLING_GROW_CHANCE - 3 / 7) < 1e-12);
// ApricornBlock: nextInt(5) == 0 → 0,6.
assert.ok(Math.abs(perBedrockRandomTick(1 / 5) - 0.6) < 1e-12);
assert.equal(perBedrockRandomTick(0.5), 1, "nunca passa de 1");
assert.equal(SAPLING_MIN_LIGHT, 9);
assert.equal(SAPLING_BONEMEAL_CHANCE, 0.45);

// Muda: 2 passos (0 → 1 → árvore); estágios antigos 2 e 3 viram árvore no próximo passo; luz < 9 não cresce.
function block(state: number, light = 15) {
	const b = {
		state, trees: 0,
		permutation: { getState: () => b.state, withState: (_k: string, v: number) => ({ v }) },
		setPermutation(p: { v: number }) { b.state = p.v; },
		above: () => ({ getLightLevel: () => light }),
		dimension: { runCommand: () => { b.trees++; } },
		location: { x: 0, y: 64, z: 0 },
	};
	return b;
}
const sapling = new SaplingComponent("cobblemon:red_apricorn_tree");
const realRandom = Math.random;
try {
	Math.random = () => 0;
	const b = block(0);
	sapling.onRandomTick({ block: b } as never);
	assert.equal(b.state, 1, "0 → 1");
	sapling.onRandomTick({ block: b } as never);
	assert.equal(b.trees, 1, "1 → árvore");
	for (const old of [2, 3]) {
		const o = block(old);
		sapling.onRandomTick({ block: o } as never);
		assert.equal(o.trees, 1, `estágio antigo ${old} vira árvore`);
	}
	// Farinha de osso em muda de estágio antigo: vale (Java: sempre alvo válido) e vira árvore (Math.random = 0 < 45%).
	const stale = block(3);
	const player = {
		selectedSlotIndex: 0,
		getGameMode: () => "Creative",
		getComponent: () => ({ container: { getSlot: () => ({ getItem: () => ({ typeId: "minecraft:bone_meal", amount: 1 }) }) } }),
	};
	sapling.onPlayerInteract({ player, block: stale, dimension: { spawnParticle() {}, playSound() {} } } as never);
	assert.equal(stale.trees, 1, "farinha na muda de estágio antigo vira árvore");
	const dark = block(0, 8);
	sapling.onRandomTick({ block: dark } as never);
	assert.equal(dark.state, 0, "sem luz não cresce");
}
finally { Math.random = realRandom; }
console.log("apricorn-crescimento: ok");
