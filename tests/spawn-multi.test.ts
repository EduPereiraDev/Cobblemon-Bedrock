// Frente spawn-multi (docs/pendencias/spawn-multi.md):
// 1. A frequência de passes POR JOGADOR não cai com o número de jogadores (PlayerSpawnScheduler), com custo por tick
//    limitado por jogador e a salvaguarda do watchdog.
// 2. A distribuição dos spawns segue as fórmulas do Cobblemon 1.8.2 (Java): buckets, tipo de posição, peso × influências
//    × weightMultipliers, herds/Alfa, nível, shiny e gênero — milhares de seleções com semente fixa comparadas com o
//    esperado (analítico para 1 ação; simulador de referência transcrito do Kotlin para passes de 8 ações).
// 3. Os dados importados batem com os JSON do Cobblemon (bucket, peso, tipo de posição, nível, multiplicadores, herds).
//
// SPAWN_MULTI_TABLE=1 imprime as tabelas esperado × observado em Markdown (usadas no docs/pendencias/spawn-multi.md).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BEST_SPAWNER_CONFIG, SPAWNS, SpawnEntry } from "../generated/scripts/spawns";
import { conditionMatches, entryAllowed, SpawnContext, worldClock } from "../scripts/spawning/SpawnConditions";
import { poolBuckets, rollLevel, selectSpawnActions, spawnSizeOf, SpawnAction } from "../scripts/spawning/SpawnSelector";
import { createPokemonForAction, PassOutcome, PlayerSpawnScheduler, singleQueryNote, SpawnProbe } from "../scripts/spawning/Spawner";
import { setConfigValue } from "../scripts/Config";
import { getSpeciesData } from "../scripts/speciesData";

const TABLE = process.env.SPAWN_MULTI_TABLE === "1";
/** SPAWN_MULTI_PARTS=agenda,uma,passes,criacao,dados (padrão: todas). */
const PARTS = new Set((process.env.SPAWN_MULTI_PARTS ?? "agenda,uma,passes,criacao,dados").split(","));
const table = (line: string) => { if (TABLE) console.log(line); };

/** mulberry32: aleatoriedade com semente fixa. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// =============================================================================================
// 1. Agenda por jogador

interface FakePlayer { id: string }

/** Mesmas opções do spawner (SPAWN_TUNING): orçamento por jogador de 2 a 15 ms, passe em 60% do intervalo, teto de 40 ms. */
const OPTS = { firstDelayTicks: 100, minPlayerBudgetMs: 2, maxPlayerBudgetMs: 15, targetFraction: 0.6, initialPassCostMs: 40, tickCeilingMs: 40, phaseStride: 7 };
const CEILING = OPTS.tickCeilingMs, MAX_BUDGET = OPTS.maxPlayerBudgetMs;

/** Simula `ticks` ticks com N jogadores; cada passe tem `slices` fatias de `sliceMs` (relógio falso). */
function simulate(n: number, ticks: number, slices: number, sliceMs: number, opts: { joinAt?: (i: number) => number; leaveAt?: (i: number) => number } = {}) {
	let clock = 0;
	const sched = new PlayerSpawnScheduler<FakePlayer>({ ...OPTS, now: () => clock });
	const all = Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
	const starts = new Map<string, number[]>();
	const durations: number[] = [];
	let maxTickCost = 0;
	function* pass(): Generator<void, void, void> {
		for (let i = 0; i < slices - 1; i++) { clock += sliceMs; yield; }
		clock += sliceMs;
	}
	for (let t = 0; t < ticks; t++) {
		const players = all.filter((_, i) => t >= (opts.joinAt?.(i) ?? 0) && t < (opts.leaveAt?.(i) ?? Infinity));
		const before = clock;
		sched.tick(players, t, 20, () => true, (p) => {
			let list = starts.get(p.id);
			if (!list) starts.set(p.id, list = []);
			list.push(t);
			return pass();
		}, (_id, d) => durations.push(d));
		maxTickCost = Math.max(maxTickCost, clock - before);
	}
	return { starts, durations, maxTickCost, sched };
}

if (PARTS.has("agenda")) {
	const T = 2100;
	// Java: timer 100 decrementado a cada tick → 1º passe no 100º tick (índice 99), depois a cada 20: 101 passes em 2100.
	const expected = Math.floor((T - 100) / 20) + 1;
	const rows: string[] = [];
	// Demanda abaixo da salvaguarda: passes de 20 e 30 ms (hardware nativo) com até 24/16 jogadores, e passes de 200 ms
	// (BDS emulado, ~15 ms/tick por jogador) com 1 e 2.
	for (const [slices, sliceMs, counts] of [[40, 0.5, [1, 2, 4, 6, 12, 24]], [10, 3, [1, 2, 4, 6, 12, 16]], [50, 4, [1, 2]]] as const) {
		for (const n of counts) {
			const { starts, durations, maxTickCost } = simulate(n, T, slices, sliceMs);
			const counts = [...starts.values()].map((l) => l.length);
			assert.equal(counts.length, n);
			// A fase de quem entra no mesmo tick é deslocada (< 20 ticks): no máximo 1 passe a menos na janela.
			for (const c of counts) assert.ok(c >= expected - 1 && c <= expected, `N=${n}, ${slices}×${sliceMs} ms: ${c} passes (esperado ${expected - 1}–${expected})`);
			// Intervalo entre passes de um jogador = ticksBetweenSpawnAttempts (o 1º passe ainda não tem custo medido e pode
			// passar um pouco do intervalo; a partir do 2º, exato).
			for (const list of starts.values()) for (let i = 2; i < list.length; i++) assert.equal(list[i] - list[i - 1], 20, `N=${n}: intervalo ${list[i] - list[i - 1]}`);
			// O passe termina antes do próximo (orçamento por jogador), fora os primeiros.
			const steady = durations.slice(n);
			assert.ok(Math.max(...steady) < 20, `N=${n}: passe de ${Math.max(...steady)} ticks`);
			// Custo por tick: salvaguarda + o que um jogador gasta por tick (orçamento máximo + uma fatia).
			assert.ok(maxTickCost <= CEILING + MAX_BUDGET + sliceMs + 1e-9, `N=${n}: ${maxTickCost} ms num tick`);
			rows.push(`| ${slices} × ${sliceMs} ms | ${n} | ${Math.min(...counts)}–${Math.max(...counts)} | ${Math.max(...steady)} | ${maxTickCost.toFixed(1)} |`);
		}
	}
	table("\n### Agenda simulada (2100 ticks, ticksBetweenSpawnAttempts 20: esperado 100–101 passes por jogador)\n");
	table("| Passe (fatias × custo) | Jogadores | Passes por jogador | Duração máx (ticks) | Maior custo num tick (ms) |\n|---|---|---|---|---|");
	for (const r of rows) table(r);
}

if (PARTS.has("agenda")) {
	// Mesmo tick de entrada → fases diferentes; entrada isolada → exatamente 100 ticks (Java).
	const { starts } = simulate(3, 400, 1, 0.1, { joinAt: (i) => (i === 2 ? 37 : 0) });
	assert.deepEqual(starts.get("p0")!.slice(0, 2), [99, 119], "1º passe após 100 ticks");
	assert.equal(starts.get("p1")![0], 99 + 7, "2º jogador do mesmo tick: fase +7");
	assert.equal(starts.get("p2")![0], 37 + 99, "jogador que entra sozinho: 100 ticks");
}

if (PARTS.has("agenda")) {
	// Quem sai: passe cancelado e timer apagado; os outros seguem.
	const { starts, sched } = simulate(2, 600, 30, 0.5, { leaveAt: (i) => (i === 1 ? 110 : Infinity) });
	assert.equal(starts.get("p1")!.length, 1);
	assert.equal(sched.timers.has("p1"), false);
	assert.equal(sched.passes.has("p1"), false);
	assert.equal(starts.get("p0")!.length, Math.floor((600 - 100) / 20) + 1);
}

if (PARTS.has("agenda")) {
	// canSpawn falso congela o timer (ServerPlayerMixin só tica o spawner quando pode spawnar).
	let clock = 0;
	const sched = new PlayerSpawnScheduler<FakePlayer>({ ...OPTS, now: () => clock });
	let started = 0;
	for (let t = 0; t < 300; t++) sched.tick([{ id: "a" }], t, 20, () => t < 50 || t >= 250, () => { started++; return (function* () { })(); });
	assert.equal(started, 1, "50 ticks antes + 50 depois = 100 ticks de timer");
}

if (PARTS.has("agenda")) {
	// Orçamento por jogador segue o custo DELE: passes baratos → 2 ms/tick; passes de 200 ms → 15 ms/tick (teto).
	let clock = 0;
	const sched = new PlayerSpawnScheduler<FakePlayer>({ ...OPTS, now: () => clock });
	const cost: Record<string, number> = { cheap: 10, heavy: 200 };
	for (let t = 0; t < 400; t++) sched.tick([{ id: "cheap" }, { id: "heavy" }], t, 20, () => true, (p) => (function* () {
		for (let i = 0; i < 20; i++) { clock += cost[p.id] / 20; yield; }
	})());
	assert.equal(sched.budgetFor("cheap", 20), 2);
	assert.equal(sched.budgetFor("heavy", 20), 15);
}

if (PARTS.has("agenda")) {
	// Carga acima da salvaguarda (a máquina não dá conta): 100 jogadores × 30 ms e 6 jogadores × 200 ms por passe. A
	// frequência cai (o watchdog manda), mas por igual entre os jogadores e sem tick acima de salvaguarda + um jogador.
	for (const [n, slices, sliceMs] of [[100, 10, 3], [6, 50, 4]] as const) {
		const { starts, maxTickCost } = simulate(n, 2100, slices, sliceMs);
		const counts = [...starts.values()].map((l) => l.length);
		assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, `N=${n}: justo ${Math.min(...counts)}–${Math.max(...counts)}`);
		assert.ok(maxTickCost <= CEILING + MAX_BUDGET + sliceMs + 1e-9, `N=${n}: tick de ${maxTickCost} ms`);
		table(`| ${slices} × ${sliceMs} ms (acima da capacidade) | ${n} | ${Math.min(...counts)}–${Math.max(...counts)} | — | ${maxTickCost.toFixed(1)} |`);
	}
}

if (PARTS.has("agenda")) {
	// Sonda: o formato da linha é o que o cenário E2E lê.
	let now = 0;
	const probe = new SpawnProbe(() => now);
	const ok: PassOutcome = { result: "ok", spawned: 3 };
	probe.notePass("a", "Bot1", ok, 5, 20);
	probe.notePass("a", "Bot1", { result: "cap", spawned: 0 }, 25, 20);
	probe.addCost(2.5);
	now = 50;
	probe.flushTick();
	now = 60_000;
	const line = probe.report((id) => (id === "a" ? 7 : undefined));
	const MULTI = /\[spawn\] multi: ticks (\d+) em ([\d.]+) s \(([\d.]+) TPS\), spawner\/tick média ([\d.]+) ms p99 (\d+(?:\.\d+)?) ms máx (\d+(?:\.\d+)?) ms, tick médio ([\d.]+) ms máx (\d+) ms \| (.*)$/;
	assert.match(line, MULTI);
	assert.match(line, /Bot1: passes 2 \(ok 1, zona 0, cap 1, teto 0\), spawns 3, duração máx 25 ticks, atrasados 1, selvagens perto 7/);
	assert.equal(probe.players.size, 0, "report zera");
	// Aviso de passe lento: nota quando a fatia é quase toda UMA consulta ao mundo (chamada nativa indivisível).
	assert.match(singleQueryNote(148, 146), /146 ms numa única consulta ao mundo/);
	assert.equal(singleQueryNote(30, 5), "");
}

// =============================================================================================
// 2. Distribuição (Java × port)

const overworld = { id: "minecraft:overworld", containsBlock: () => false } as unknown as SpawnContext["dimension"];

interface Scenario { name: string; positions: SpawnContext[]; clock: { timeOfDay: number; moonPhase: number } }

/** 12 posições numa zona 8×8 (como SPAWN_TUNING.zoneColumns), com os campos do tipo de posição. */
function zone(seed: number, make: (x: number, z: number, i: number) => Partial<SpawnContext> & Pick<SpawnContext, "positionType" | "baseBlock">, base: Partial<SpawnContext>, clock: Scenario["clock"], y: number): SpawnContext[] {
	const r = rng(seed);
	const cells = new Set<number>();
	while (cells.size < 12) cells.add(Math.floor(r() * 64));
	return [...cells].map((c, i) => {
		const x = 1000 + (c % 8), z = 2000 + Math.floor(c / 8);
		const extra = make(x, z, i);
		return {
			dimension: overworld, location: { x: x + 0.5, y: y + 1, z: z + 0.5 }, blockY: y, biome: "plains",
			skyLight: 15, light: 15, canSeeSky: true, isRaining: false, isThundering: false, height: 64, clock,
			nearbyBlocks: new Set(["minecraft:grass_block", "minecraft:short_grass", "minecraft:oak_log", "minecraft:oak_leaves", "minecraft:dandelion", "minecraft:poppy"]),
			...base, ...extra,
		} as SpawnContext;
	});
}

const day = { timeOfDay: 6000, moonPhase: 0 };
const night = { timeOfDay: 18000, moonPhase: 0 };
const scenarios: Scenario[] = [
	{ name: "planície de dia", clock: day, positions: zone(1, () => ({ positionType: "grounded", baseBlock: "minecraft:grass_block" }), { biome: "plains" }, day, 64) },
	{ name: "floresta à noite", clock: night, positions: zone(2, () => ({ positionType: "grounded", baseBlock: "minecraft:grass_block" }), { biome: "forest", light: 4 }, night, 70) },
	{
		name: "oceano", clock: day, positions: zone(3, (_x, _z, i) => i < 6
			? { positionType: "submerged", baseBlock: "minecraft:water", fluid: "water", canSeeSky: false, depth: 6, height: undefined }
			: i < 9 ? { positionType: "surface", baseBlock: "minecraft:water", fluid: "water" }
				: { positionType: "seafloor", baseBlock: "minecraft:sand", fluid: "water", canSeeSky: false, height: undefined },
		{ biome: "ocean", skyLight: 12, light: 12, nearbyBlocks: new Set(["minecraft:water", "minecraft:sand", "minecraft:seagrass", "minecraft:kelp"]) }, day, 55),
	},
	{ name: "caverna", clock: day, positions: zone(4, () => ({ positionType: "grounded", baseBlock: "minecraft:stone" }), { biome: "plains", skyLight: 0, light: 0, canSeeSky: false, nearbyBlocks: new Set(["minecraft:stone", "minecraft:deepslate"]) }, day, 20) },
	{ name: "deserto com chuva", clock: day, positions: zone(5, () => ({ positionType: "grounded", baseBlock: "minecraft:sand" }), { biome: "desert", isRaining: true, nearbyBlocks: new Set(["minecraft:sand", "minecraft:cactus", "minecraft:dead_bush"]) }, day, 64) },
];

// Relógio do mundo também fixo (caso alguma condição não use ctx.clock).
worldClock.timeOfDay = () => 6000;
worldClock.moonPhase = () => 0;

const worldBuckets = BEST_SPAWNER_CONFIG.worldBuckets;
const typeWeights = BEST_SPAWNER_CONFIG.spawnablePositionTypeWeights;

/** SpawnablePosition.getWeight sem influências: peso × weightMultipliers cujas condições valem (WeightMultiplier.kt). */
function javaWeight(e: SpawnEntry, p: SpawnContext): number {
	let w = e.weight;
	for (const m of e.weightMultipliers ?? []) {
		const meets = (!m.condition || conditionMatches(m.condition, p)) && !(m.anticondition && conditionMatches(m.anticondition, p));
		if (meets) w *= m.multiplier;
	}
	return w;
}

/** AreaSpawnablePosition.postFilter (hasSpace pela coluna livre, `height`): herds conferem cada membro depois. */
function fits(e: SpawnEntry, p: SpawnContext): boolean {
	if (e.herd) return true;
	const { width, height } = spawnSizeOf(e.species, e.aspects);
	if (width <= 1 && height <= 1) return true;
	return p.height === undefined || height <= 1 || p.height >= height;
}

type BucketData = Map<string, Map<SpawnEntry, Map<SpawnContext, number>>>;

/** getDataForBucket (FlatSpawnablePositionWeightedSelector), calculado uma vez por contexto e bucket e copiado. */
const bucketDataCache = new WeakMap<SpawnContext[], Map<string, BucketData>>();
function javaBucketData(positions: SpawnContext[], bucket: string): BucketData {
	let byBucket = bucketDataCache.get(positions);
	if (!byBucket) bucketDataCache.set(positions, byBucket = new Map());
	let base = byBucket.get(bucket);
	if (!base) byBucket.set(bucket, base = buildBucketData(positions, bucket));
	const copy: BucketData = new Map();
	for (const [t, byType] of base) {
		const m = new Map<SpawnEntry, Map<SpawnContext, number>>();
		for (const [e, info] of byType) m.set(e, new Map(info));
		copy.set(t, m);
	}
	return copy;
}
function buildBucketData(positions: SpawnContext[], bucket: string): BucketData {
	const data: BucketData = new Map();
	for (const p of positions) {
		for (const e of SPAWNS) {
			if (e.bucket !== bucket || !entryAllowed(e, p) || !fits(e, p)) continue;
			let byType = data.get(p.positionType);
			if (!byType) data.set(p.positionType, byType = new Map());
			let info = byType.get(e);
			if (!info) byType.set(e, info = new Map());
			info.set(p, javaWeight(e, p));
		}
	}
	return data;
}

const highest = (info: Map<SpawnContext, number>) => Math.max(0, ...info.values());

/** Membros válidos de um herd no nível (getValidHerdMembers) e os do papel (líder se houver líder possível). */
function herdRoleMembers(e: SpawnEntry, level: number, counts: Map<object, number>) {
	const valid = e.herd!.members.filter((m) => (counts.get(m) ?? 0) < m.maxTimes && !(m.herdLevelRange && (level < m.herdLevelRange[0] || level > m.herdLevelRange[1])));
	const leaderSelected = [...counts].some(([m, c]) => (m as { isLeader?: boolean }).isLeader === true && c > 0);
	const lacksLeader = valid.some((m) => m.isLeader === true) && !leaderSelected;
	return { valid, lacksLeader, role: valid.filter((m) => (lacksLeader && m.isLeader === true) || (!lacksLeader && m.isFollower !== false)) };
}

/**
 * Probabilidades exatas de UMA ação (maxSpawns 1) pelo Java: P(bucket) = peso / soma dos buckets do pool; P(tipo) ∝
 * peso do tipo × nº de entradas; P(entrada) ∝ maior peso dela entre as posições. Herd: nível uniforme, membro pelo peso
 * entre os do papel (Alfa = membro com alpha=true).
 */
function expectedSingle(positions: SpawnContext[]) {
	const pool = poolBuckets();
	const keys = Object.keys(worldBuckets).filter((k) => pool.has(k));
	const total = keys.reduce((a, k) => a + worldBuckets[k], 0);
	const byEntry = new Map<string, number>();
	const byBucket = new Map<string, number>();
	let none = 0, alpha = 0;
	for (const b of keys) {
		const pb = worldBuckets[b] / total;
		const data = javaBucketData(positions, b);
		const typeTotal = [...data].reduce((a, [t, m]) => a + (typeWeights[t] ?? 1) * m.size, 0);
		let bucketMass = 0;
		for (const [t, byType] of data) {
			const pt = ((typeWeights[t] ?? 1) * byType.size) / typeTotal;
			const sumHighest = [...byType.values()].reduce((a, info) => a + highest(info), 0);
			if (sumHighest <= 0) continue;
			for (const [e, info] of byType) {
				const p = pb * pt * (highest(info) / sumHighest);
				if (p <= 0) continue;
				byEntry.set(e.id, (byEntry.get(e.id) ?? 0) + p);
				bucketMass += p;
				if (e.herd) {
					const levels = e.maxLevel - e.minLevel + 1;
					for (let level = e.minLevel; level <= e.maxLevel; level++) {
						const { role } = herdRoleMembers(e, level, new Map());
						const sum = role.reduce((a, m) => a + m.weight, 0);
						const pa = sum > 0 ? role.filter((m) => m.alpha).reduce((a, m) => a + m.weight, 0) / sum : (e.herd.members[0].alpha ? 1 : 0);
						alpha += (p / levels) * pa;
					}
				}
				else if (e.alpha) alpha += p;
			}
		}
		byBucket.set(b, bucketMass);
		none += pb - bucketMass;
	}
	return { byEntry, byBucket, none: Math.max(0, none), alpha };
}

/** z de uma proporção observada contra a esperada. */
function zScore(observed: number, n: number, p: number): number {
	const sd = Math.sqrt(n * p * (1 - p));
	return sd > 0 ? (observed - n * p) / sd : observed === 0 ? 0 : Infinity;
}

const Z_MAX = 4.5;

/**
 * Contagem compatível com o esperado: z ≤ Z_MAX quando o esperado é ≥ 10; abaixo disso (aproximação normal ruim), cauda
 * exata de Poisson nos dois lados ≥ 1e-6 (com centenas de entradas por contexto, alguma rara sai 1 vez em 5000).
 */
function countOk(observed: number, n: number, p: number): boolean {
	const lambda = n * p;
	if (lambda >= 10) return Math.abs(zScore(observed, n, p)) <= Z_MAX;
	let below = 0, term = Math.exp(-lambda);
	for (let i = 0; i < observed; i++) { below += term; term *= lambda / (i + 1); }
	const upper = 1 - below; // P(X ≥ observed)
	const lower = below + term; // P(X ≤ observed)
	return Math.min(upper, lower) >= 1e-6;
}
const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 3 : 2)}%`;

if (PARTS.has("uma")) {
	const N = 5000;
	table("\n### 1 ação por seleção (maxSpawns 1), 5000 seleções por contexto, semente fixa\n");
	table("| Contexto | Categoria | Esperado (Java) | Observado (port) | z |\n|---|---|---|---|---|");
	let s = 0;
	for (const sc of scenarios) {
		const exp = expectedSingle(sc.positions);
		const random = rng(1000 + s++);
		const obsEntry = new Map<string, number>();
		const obsBucket = new Map<string, number>();
		let none = 0, alpha = 0;
		for (let i = 0; i < N; i++) {
			const [a] = selectSpawnActions(sc.positions, { buckets: worldBuckets, positionTypeWeights: typeWeights, maxSpawns: 1, minDistanceBetweenEntities: 8, random });
			if (!a) { none++; continue; }
			obsEntry.set(a.entry.id, (obsEntry.get(a.entry.id) ?? 0) + 1);
			obsBucket.set(a.bucket, (obsBucket.get(a.bucket) ?? 0) + 1);
			if (a.alpha) alpha++;
		}
		// Buckets (e "nenhum": bucket sorteado sem candidatas encerra o passe, sem re-sortear).
		for (const b of Object.keys(worldBuckets)) {
			const p = exp.byBucket.get(b) ?? 0, o = obsBucket.get(b) ?? 0;
			const z = zScore(o, N, p);
			assert.ok(countOk(o, N, p), `${sc.name}, bucket ${b}: esperado ${pct(p)}, observado ${o}/${N} (z ${z.toFixed(2)})`);
			table(`| ${sc.name} | bucket ${b} | ${pct(p)} | ${pct(o / N)} | ${z.toFixed(2)} |`);
		}
		{
			const z = zScore(none, N, exp.none);
			assert.ok(countOk(none, N, exp.none), `${sc.name}: sem spawn esperado ${pct(exp.none)}, observado ${none} (z ${z.toFixed(2)})`);
			table(`| ${sc.name} | sem spawn | ${pct(exp.none)} | ${pct(none / N)} | ${z.toFixed(2)} |`);
		}
		{
			const z = zScore(alpha, N, exp.alpha);
			assert.ok(countOk(alpha, N, exp.alpha), `${sc.name}: Alfa esperado ${pct(exp.alpha)}, observado ${alpha} (z ${z.toFixed(2)})`);
			table(`| ${sc.name} | Alfa | ${pct(exp.alpha)} | ${pct(alpha / N)} | ${z.toFixed(2)} |`);
		}
		// Cada entrada; nenhuma observada fora do esperado.
		for (const id of obsEntry.keys()) assert.ok(exp.byEntry.has(id), `${sc.name}: ${id} saiu mas o Java não o escolheria`);
		let chi = 0, dof = 0, rest = 0, restExp = 0;
		const top = [...exp.byEntry].sort((a, b) => b[1] - a[1]);
		for (const [id, p] of top) {
			const o = obsEntry.get(id) ?? 0;
			assert.ok(countOk(o, N, p), `${sc.name}, ${id}: esperado ${pct(p)}, observado ${o}/${N} (z ${zScore(o, N, p).toFixed(2)})`);
			if (N * p >= 5) { chi += (o - N * p) ** 2 / (N * p); dof++; }
			else { rest += o; restExp += N * p; }
		}
		if (restExp >= 5) { chi += (rest - restExp) ** 2 / restExp; dof++; }
		const zChi = (chi - (dof - 1)) / Math.sqrt(2 * Math.max(1, dof - 1));
		assert.ok(zChi <= Z_MAX, `${sc.name}: χ² ${chi.toFixed(1)} com ${dof - 1} g.l. (z ${zChi.toFixed(2)})`);
		for (const [id, p] of top.slice(0, 5)) {
			const o = obsEntry.get(id) ?? 0;
			table(`| ${sc.name} | ${id} | ${pct(p)} | ${pct(o / N)} | ${zScore(o, N, p).toFixed(2)} |`);
		}
		table(`| ${sc.name} | χ² de todas as ${exp.byEntry.size} entradas | ${dof - 1} g.l. | ${chi.toFixed(1)} | ${zChi.toFixed(2)} |`);
	}
}

// ---------------------------------------------------------------------------------------------
// Passes de 8 ações: simulador de referência transcrito do Kotlin (SpawningSelector.select +
// FlatSpawnablePositionWeightedSelector + PokemonSpawnDetail/PokemonHerdSpawnDetail.onSelection).

interface RefAction { entry: SpawnEntry; species: string; bucket: string; alpha: boolean; levelRange: [number, number]; empty?: boolean; member?: object }

function weighted<T>(items: T[], w: (t: T) => number, random: () => number): T | undefined {
	let sum = 0;
	for (const it of items) sum += Math.max(0, w(it));
	const chosen = random() * sum;
	let acc = 0;
	for (const it of items) {
		const x = w(it);
		if (x > 0) { acc += x; if (acc >= chosen) return it; }
	}
	return undefined;
}

const dist3 = (a: SpawnContext, b: SpawnContext) => Math.hypot(a.location.x - b.location.x, a.location.y - b.location.y, a.location.z - b.location.z);

function javaSelect(positions: SpawnContext[], maxSpawns: number, random: () => number): RefAction[] {
	const pool = poolBuckets();
	const keys = Object.keys(worldBuckets).filter((k) => pool.has(k));
	const built = new Map<string, BucketData>();
	const actions: RefAction[] = [];
	const context = new Map<string, number>();
	let guaranteed: string | undefined;
	const getData = (b: string) => {
		let d = built.get(b);
		if (!d) built.set(b, d = javaBucketData(positions, b));
		return d;
	};
	// removeSpawnablePositions / removeSpawnDetails: só os buckets já montados.
	const removePositions = (pred: (p: SpawnContext) => boolean) => {
		for (const d of built.values()) for (const [t, byType] of d) {
			for (const [e, info] of byType) {
				for (const p of [...info.keys()]) if (pred(p)) info.delete(p);
				if (info.size === 0) byType.delete(e);
			}
			if (byType.size === 0) d.delete(t);
		}
	};
	const removeDetails = (pred: (e: SpawnEntry) => boolean) => {
		for (const d of built.values()) for (const [t, byType] of d) {
			for (const e of [...byType.keys()]) if (pred(e)) byType.delete(e);
			if (byType.size === 0) d.delete(t);
		}
	};
	while (actions.length < maxSpawns) {
		const bucket = guaranteed ?? weighted(keys, (k) => worldBuckets[k], random) ?? keys[0];
		const data = getData(bucket);
		if (data.size === 0) break;
		const type = weighted([...data.keys()], (t) => (typeWeights[t] ?? 1) * data.get(t)!.size, random);
		if (type === undefined) break;
		const byType = data.get(type)!;
		const e = weighted([...byType.keys()], (x) => highest(byType.get(x)!), random);
		if (!e) break;
		const info = byType.get(e)!;
		const pos = weighted([...info.keys()], (p) => info.get(p)!, random)!;
		if (!e.herd) {
			actions.push({ entry: e, species: e.species, bucket, alpha: e.alpha === true, levelRange: [e.minLevel, e.maxLevel] });
			removePositions((p) => dist3(p, pos) < 8);
			continue;
		}
		const key = `${e.id}__LEVEL`;
		if (!context.has(key)) context.set(key, e.minLevel + Math.floor(random() * (e.maxLevel - e.minLevel + 1)));
		const counts = new Map<object, number>();
		for (const a of actions) if (a.entry === e && !a.empty && a.member) counts.set(a.member, (counts.get(a.member) ?? 0) + 1);
		const herdLevel = context.get(key)!;
		const { role } = herdRoleMembers(e, herdLevel, counts);
		const member = weighted(role, (m) => m.weight, random) ?? e.herd.members[0];
		let level = herdLevel;
		if (member.levelRange) level = Math.min(member.levelRange[1], Math.max(member.levelRange[0], level));
		const levelRange: [number, number] = member.levelRangeOffset ? [level + member.levelRangeOffset[0], level + member.levelRangeOffset[1]] : [level, level];
		actions.push({ entry: e, species: member.species, bucket, alpha: member.alpha === true, levelRange, member });
		// onSelection
		removeDetails((x) => x !== e);
		guaranteed = bucket;
		removePositions((p) => dist3(p, pos) < (e.herd.minDistanceBetweenSpawns ?? 1));
		// No Java a ação atual só entra em spawnActions depois de choose(): a contagem e o papel aqui são os de ANTES dela
		// (count + 1 para o tamanho; lacksPossibleLeader/getValidHerdMembersForRole sem ela).
		const count = actions.filter((a) => a.entry === e && !a.empty).length;
		if (count >= e.herd.maxHerdSize || herdRoleMembers(e, herdLevel, counts).role.length === 0) removeDetails((x) => x === e);
	}
	return actions.filter((a) => !a.empty);
}

/** Proporções de PASSES comparadas entre duas amostras independentes (z de duas proporções). */
function twoSampleZ(a: number, na: number, b: number, nb: number): number {
	const p = (a + b) / (na + nb);
	const sd = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
	return sd > 0 ? (a / na - b / nb) / sd : 0;
}

/**
 * Contagens POR PASSE de cada categoria (soma e soma dos quadrados). As ações de um herd saem juntas (até maxHerdSize no
 * mesmo passe), então não são independentes: a comparação é da média por passe (z de Welch), não da proporção por ação.
 */
interface Moments { sum: number; sq: number }
interface PassStats { passes: number; hist: number[]; per: Map<string, Moments>; levelSum: number; actions: number }

function passStats(run: () => (SpawnAction | RefAction)[], passes: number): PassStats {
	const st: PassStats = { passes, hist: Array(9).fill(0), per: new Map(), levelSum: 0, actions: 0 };
	for (let i = 0; i < passes; i++) {
		const actions = run();
		st.hist[actions.length]++;
		const counts = new Map<string, number>();
		const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
		for (const a of actions) {
			st.actions++;
			add("ações");
			add(`ações ${a.bucket}`);
			if (a.alpha) add("ações Alfa");
			if (a.entry.herd) add("ações de herd");
			add(`espécie ${a.species}`);
			st.levelSum += (a.levelRange[0] + a.levelRange[1]) / 2;
		}
		for (const [k, c] of counts) {
			let m = st.per.get(k);
			if (!m) st.per.set(k, m = { sum: 0, sq: 0 });
			m.sum += c;
			m.sq += c * c;
		}
	}
	return st;
}

function welchZ(a: PassStats, b: PassStats, key: string): { ma: number; mb: number; z: number } {
	const ma = (a.per.get(key)?.sum ?? 0) / a.passes, mb = (b.per.get(key)?.sum ?? 0) / b.passes;
	const va = (a.per.get(key)?.sq ?? 0) / a.passes - ma * ma, vb = (b.per.get(key)?.sq ?? 0) / b.passes - mb * mb;
	const sd = Math.sqrt(va / a.passes + vb / b.passes);
	return { ma, mb, z: sd > 0 ? (mb - ma) / sd : 0 };
}

if (PARTS.has("passes")) {
	const PASSES = 2000;
	table("\n### Passes de 8 ações (maximumSpawnsPerPass 8), 2000 passes por lado: port × simulador de referência do Java\n");
	table("Médias por passe (as ações de um herd saem juntas; z de Welch sobre as contagens por passe).\n");
	table("| Contexto | Métrica | Java (referência) | Port | z |\n|---|---|---|---|---|");
	let s = 0;
	for (const sc of scenarios) {
		const javaR = rng(5000 + s), portR = rng(9000 + s++);
		const java = passStats(() => javaSelect(sc.positions, 8, javaR), PASSES);
		const port = passStats(() => selectSpawnActions(sc.positions, { buckets: worldBuckets, positionTypeWeights: typeWeights, maxSpawns: 8, minDistanceBetweenEntities: 8, random: portR }), PASSES);
		const perPass = (key: string, label = key) => {
			const { ma, mb, z } = welchZ(java, port, key);
			assert.ok(Math.abs(z) <= Z_MAX, `${sc.name}, ${label} por passe: Java ${ma.toFixed(4)}, port ${mb.toFixed(4)} (z ${z.toFixed(2)})`);
			table(`| ${sc.name} | ${label} por passe | ${ma.toFixed(4)} | ${mb.toFixed(4)} | ${z.toFixed(2)} |`);
		};
		perPass("ações");
		for (let k = 0; k <= 8; k++) {
			if (java.hist[k] + port.hist[k] < 20) continue;
			const z = twoSampleZ(java.hist[k], PASSES, port.hist[k], PASSES);
			assert.ok(Math.abs(z) <= Z_MAX, `${sc.name}, passes com ${k} ações: Java ${java.hist[k]}, port ${port.hist[k]} (z ${z.toFixed(2)})`);
			table(`| ${sc.name} | passes com ${k} ações | ${pct(java.hist[k] / PASSES)} | ${pct(port.hist[k] / PASSES)} | ${z.toFixed(2)} |`);
		}
		for (const b of Object.keys(worldBuckets)) perPass(`ações ${b}`);
		perPass("ações Alfa");
		perPass("ações de herd");
		const lvJ = java.levelSum / Math.max(1, java.actions), lvP = port.levelSum / Math.max(1, port.actions);
		table(`| ${sc.name} | nível médio (meio da faixa) | ${lvJ.toFixed(2)} | ${lvP.toFixed(2)} | — |`);
		assert.ok(Math.abs(lvJ - lvP) <= Math.max(1.5, lvJ * 0.06), `${sc.name}: nível médio Java ${lvJ.toFixed(2)}, port ${lvP.toFixed(2)}`);
		// Espécies mais comuns do Java.
		const top = [...java.per].filter(([k]) => k.startsWith("espécie ")).sort((a, b) => b[1].sum - a[1].sum).slice(0, 4);
		for (const [k] of top) perPass(k);
	}
}

// ---------------------------------------------------------------------------------------------
// Nível, shiny, gênero e Alfa na criação (PokemonSpawnAction.createEntity + PokemonProperties)

if (PARTS.has("criacao")) {
	// levelRange.random(): uniforme e inclusivo.
	const random = rng(77);
	const counts = new Map<number, number>();
	const N = 16000;
	for (let i = 0; i < N; i++) {
		const l = rollLevel({ levelRange: [5, 12] } as SpawnAction, random);
		counts.set(l, (counts.get(l) ?? 0) + 1);
	}
	assert.deepEqual([...counts.keys()].sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12]);
	for (const [l, c] of counts) assert.ok(Math.abs(zScore(c, N, 1 / 8)) <= Z_MAX, `nível ${l}: ${c}/${N}`);
	table(`\n- Nível: 16000 sorteios em 5–12, cada nível ${[...counts.values()].map((c) => pct(c / N)).join("/")} (esperado 12.50%).`);
}

if (PARTS.has("criacao")) {
	// Shiny: PokemonProperties.checkRate (nextFloat() < 1 / shinyRate) com a config; gênero pela razão da espécie
	// (Random.nextFloat() <= maleRatio); Alfa (alpha=true) → aspects/marca/moveset.
	const original = Math.random;
	const random = rng(4242);
	Math.random = random;
	try {
		setConfigValue("shinyRate", 40);
		const bulbasaur = SPAWNS.find((e) => e.species === "bulbasaur" && !e.herd && !e.alpha)!;
		const ratio = getSpeciesData("bulbasaur")!.maleRatio;
		assert.equal(ratio, 0.875);
		const ctx = scenarios[0].positions[0];
		const N = 2400;
		let shiny = 0, male = 0;
		for (let i = 0; i < N; i++) {
			const p = createPokemonForAction({ entry: bulbasaur, ctx, bucket: "common", species: "bulbasaur", aspects: [], alpha: false, levelRange: [5, 10] });
			if (p.shiny) shiny++;
			if (p.gender === "m") male++;
		}
		const zs = zScore(shiny, N, 1 / 40), zg = zScore(male, N, ratio);
		assert.ok(Math.abs(zs) <= Z_MAX, `shiny 1/40: ${shiny}/${N} (z ${zs.toFixed(2)})`);
		assert.ok(Math.abs(zg) <= Z_MAX, `macho 87,5%: ${male}/${N} (z ${zg.toFixed(2)})`);
		table(`- Shiny (shinyRate 40 no teste; padrão do Java e do port: 8192): esperado ${pct(1 / 40)}, observado ${pct(shiny / N)} (z ${zs.toFixed(2)}).`);
		table(`- Gênero (Bulbasaur, maleRatio 0.875): esperado 87.50% machos, observado ${pct(male / N)} (z ${zg.toFixed(2)}).`);
		setConfigValue("shinyRate", 0);
		const never = createPokemonForAction({ entry: bulbasaur, ctx, bucket: "common", species: "bulbasaur", aspects: [], alpha: false, levelRange: [5, 5] });
		assert.equal(never.shiny, false, "shinyRate 0 = nunca (checkRate: this > 0)");
		const alpha = createPokemonForAction({ entry: bulbasaur, ctx, bucket: "common", species: "bulbasaur", aspects: [], alpha: true, levelRange: [5, 5] });
		assert.ok(alpha.aspects.includes("alpha") && alpha.marks.includes("cobblemon:mark_alpha"), "Alfa: aspect e marca");
	}
	finally {
		Math.random = original;
		setConfigValue("shinyRate", 8192);
	}
}

// =============================================================================================
// 3. Dados importados × JSON do Cobblemon 1.8.2

if (PARTS.has("dados")) {
	const root = join(process.cwd(), "upstream", "cobblemon", "common", "src", "main", "resources", "data", "cobblemon");
	const poolDir = join(root, "spawn_pool_world");
	if (!existsSync(poolDir)) console.log("spawn-multi: upstream/cobblemon ausente; conferência dos dados pulada");
	else {
		const presets = new Map<string, any>();
		for (const f of readdirSync(join(root, "spawn_detail_presets"))) presets.set(f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(root, "spawn_detail_presets", f), "utf8")));
		const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? walk(p) : f.endsWith(".json") ? [p] : [];
		});
		const byId = new Map<string, SpawnEntry[]>();
		for (const e of SPAWNS) { let l = byId.get(e.id); if (!l) byId.set(e.id, l = []); l.push(e); }
		const range = (v: unknown, def: string): [number, number] => {
			const m = /^\s*(-?\d+)\s*(?:-\s*(-?\d+))?\s*$/.exec(String(v ?? def))!;
			return [Number(m[1]), Number(m[2] ?? m[1])];
		};
		let total = 0, compared = 0, missing = 0, droppedMultipliers = 0;
		const problems: string[] = [];
		for (const file of walk(poolDir)) {
			const json = JSON.parse(readFileSync(file, "utf8"));
			if (json.enabled === false) continue;
			for (const s of json.spawns ?? []) {
				if (s.type !== "pokemon" && s.type !== "pokemon-herd") continue;
				total++;
				const list = byId.get(s.id);
				if (!list || list.length !== 1) { missing++; continue; }
				const e = list[0];
				compared++;
				const want = {
					bucket: s.bucket, weight: Number(s.weight), positionType: s.spawnablePositionType ?? s.context,
					levels: s.type === "pokemon" ? range(s.level ?? s.levelRange, "1-100") : range(s.levelRange ?? s.level, "1-100"),
				};
				if (e.bucket !== want.bucket) problems.push(`${s.id}: bucket ${e.bucket} ≠ ${want.bucket}`);
				if (e.weight !== want.weight) problems.push(`${s.id}: peso ${e.weight} ≠ ${want.weight}`);
				if (e.positionType !== want.positionType) problems.push(`${s.id}: tipo ${e.positionType} ≠ ${want.positionType}`);
				if (e.minLevel !== want.levels[0] || e.maxLevel !== want.levels[1]) problems.push(`${s.id}: nível ${e.minLevel}-${e.maxLevel} ≠ ${want.levels.join("-")}`);
				// Multiplicadores: preset + spawn (weightMultipliers e weightMultiplier), mesma lista de valores; só podem
				// faltar os com condição impossível no Bedrock (estruturas ou biomas sem equivalente).
				const rawMult = [...(s.presets ?? []).flatMap((p: string) => presets.get(p)?.weightMultipliers ?? []), ...(s.weightMultipliers ?? []), ...(s.weightMultiplier ? [s.weightMultiplier] : [])];
				const wantValues = rawMult.map((m: any) => Number(m.multiplier ?? 1)).sort();
				const gotValues = (e.weightMultipliers ?? []).map((m) => m.multiplier).sort();
				const pool = [...wantValues];
				for (const v of gotValues) {
					const i = pool.indexOf(v);
					if (i < 0) problems.push(`${s.id}: multiplicador ${v} que o Java não tem`);
					else pool.splice(i, 1);
				}
				droppedMultipliers += pool.length;
				if (s.type === "pokemon-herd") {
					if (e.herd?.maxHerdSize !== Number(s.maxHerdSize ?? 10)) problems.push(`${s.id}: maxHerdSize ${e.herd?.maxHerdSize} ≠ ${s.maxHerdSize ?? 10}`);
					const members = (s.herdablePokemon ?? []) as any[];
					for (const m of e.herd?.members ?? []) {
						const src = members.find((h) => String(h.pokemon).split(/\s+/)[0].replace(/^cobblemon:/, "") === m.species && Number(h.weight ?? 1) === m.weight && Number(h.maxTimes ?? 10) === m.maxTimes && (h.isLeader === true) === (m.isLeader === true) && (h.isFollower !== false) === (m.isFollower !== false));
						if (!src) problems.push(`${s.id}: membro ${m.species} (peso ${m.weight}, maxTimes ${m.maxTimes}) sem igual no JSON`);
						else if (/alpha=true/.test(String(src.pokemon)) !== (m.alpha === true)) problems.push(`${s.id}: Alfa de ${m.species} diferente`);
					}
				}
			}
		}
		assert.deepEqual(problems.slice(0, 20), [], `${problems.length} diferenças entre os dados importados e os JSON do Cobblemon`);
		// Os não conferidos não foram importados (espécie fora do port, bioma/bloco/estrutura sem equivalente no Bedrock).
		assert.ok(compared / total > 0.85, `conferidas ${compared}/${total}`);
		table(`\n- Dados: ${compared}/${total} spawns do Cobblemon conferidos campo a campo (bucket, peso, tipo de posição, nível, multiplicadores, herd); ${missing} não importados (espécie/bioma/bloco sem equivalente); ${droppedMultipliers} multiplicadores com condição impossível no Bedrock descartados; 0 diferenças.`);
	}
}

console.log("spawn-multi: ok (agenda por jogador, sonda, distribuição Java × port, dados)");
