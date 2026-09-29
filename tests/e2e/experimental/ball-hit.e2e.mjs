// Frente ball-hit: taxa de acerto da Poké Ball em Pokémon de tamanhos diferentes, comparada arremesso a arremesso com o
// Java (docs/pendencias/ball-hit.md).
//
// O bot arremessa (sobrevivência) em Pokémon parados (pequeno, médio, grande e um voador no ar, sobre uma barreira) de
// várias distâncias, direções e alturas, mirando pontos NO corpo do Pokémon (centro, alto, baixo, esquerda, direita da
// caixa do Java = hitbox × baseScale) e um tiro de controle que passa longe da região de acerto. O Pokémon tem a tag
// `uncatchable`: um acerto responde "cannot_be_caught" e a bola cai como item (o mesmo fluxo da captura, sem gastar o
// Pokémon); um erro só derruba o item. Para cada arremesso o cenário simula o Java 1.21.1 com a mesma mira e o mesmo
// mundo (PokeBallItem: +5° por cima, 1,25 bloco/tick, nasce 1 bloco à frente; ThrowableProjectile: retenção 0,99,
// gravidade 0,03; ProjectileUtil: blocos primeiro, caixa do alvo + 0,3) e relata onde o port concorda com o Java.
//
//   COBBLEMON_BDS=ball COBBLEMON_BDS_PORT=19189 COBBLEMON_DIST=dist-ball COBBLEMON_BDS_TRANSPORT=raknet \
//   COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/ball-hit.e2e.mjs --deploy --verbose
//
//   BALL_HIT_BASELINE=1   só mede (sem as asserções), para registrar o "antes"
//   BALL_HIT_SPECIES=a,b  restringe as espécies (none = só a sonda de trajetória)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { giveItem, holdItem, setupWithPokemon } from "../lib/flows.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BALL = "cobblemon:poke_ball";
const HIT_TEXT = "{cobblemon.capture.cannot_be_caught}";

/** Pokémon medidos: `air` = altura dos pés acima da plataforma (voador parado sobre uma barreira). */
const TARGETS = [
	{ label: "pequeno", species: "joltik" },
	{ label: "médio", species: "pikachu" },
	{ label: "grande", species: "snorlax" },
	{ label: "voando", species: "zubat", air: 2 },
];

/**
 * Posições do bot em volta do Pokémon: distância horizontal, direção (graus) e altura dos pés acima da plataforma.
 * `interact` = arremesso pela interação com a entidade (caminho do ThrowBall.ts: a mira está no Pokémon, perto).
 */
const PLACEMENTS = [
	{ d: 2.5, yaw: 0, up: 0, interact: true },
	{ d: 4, yaw: 0, up: 0 },
	{ d: 7, yaw: 30, up: 0 },
	{ d: 11, yaw: -40, up: 0 },
	{ d: 15, yaw: 60, up: 0 },
	{ d: 7, yaw: 180, up: 4 },
	{ d: 11, yaw: 120, up: 3 },
];

/** Pontos de mira no corpo (fração da caixa do Java): centro, alto, baixo, esquerda e direita. */
const AIMS = [
	{ name: "centro", h: 0.5, side: 0 },
	{ name: "alto", h: 0.85, side: 0 },
	{ name: "baixo", h: 0.15, side: 0 },
	{ name: "esq", h: 0.5, side: -0.4 },
	{ name: "dir", h: 0.5, side: 0.4 },
];
/**
 * Controle (fora da taxa): mira de lado, num ângulo em que a linha horizontal passa a pelo menos 0,35 bloco da região
 * de acerto do Java em qualquer direção (raio circunscrito da caixa + 0,3 de margem + 0,35).
 */
const CONTROL = { name: "fora", h: 0.5, clearance: 0.3 + 0.35 };

/** Caixa do Java (hitbox × baseScale) pela entidade gerada: collision_box × minecraft:scale do grupo padrão. */
function javaBox(species) {
	const file = join(root, "generated", "behavior_packs", "CobblemonBedrock", "entities", "pokemon", `${species}.json`);
	const c = JSON.parse(readFileSync(file, "utf8"))["minecraft:entity"].components;
	const s = c["minecraft:scale"]?.value ?? 1;
	return { w: c["minecraft:collision_box"].width * s, h: c["minecraft:collision_box"].height * s };
}

/** Manda a interação com a entidade SEM mexer na mira (o Bot.interact olha para os pés). */
function interactKeepingAim(bot, entity) {
	bot._sendTransaction({
		transaction: {
			legacy: { legacy_request_id: 0 },
			transaction_type: "item_use_on_entity",
			actions: [],
			transaction_data: {
				entity_runtime_id: entity.runtimeId, action_type: "interact", hotbar_slot: bot.selectedSlot,
				held_item: bot.heldItem(), player_pos: bot.position, click_pos: { x: 0, y: 0, z: 0 },
			},
		},
	});
}

// ------------------------------------------------------------------------------------------------ simulação do Java

/** AABB.clip do Minecraft: fração em que o segmento ENTRA na caixa pela face (começando dentro não conta). */
function clip(a, b, box) {
	let tMin = -Infinity, tMax = Infinity;
	for (const k of ["x", "y", "z"]) {
		const d = b[k] - a[k];
		if (Math.abs(d) < 1e-9) { if (a[k] < box.min[k] || a[k] > box.max[k]) return undefined; continue; }
		let t1 = (box.min[k] - a[k]) / d, t2 = (box.max[k] - a[k]) / d;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
	}
	return tMin <= tMax && tMin >= 0 && tMin <= 1 ? tMin : undefined;
}

/**
 * O Java acertaria? PokeBallItem.throwPokeBall + ThrowableProjectile.tick (MC 1.21.1): nasce em (olho − 0,1) e anda
 * 1 bloco na direção do arremesso; a cada tick, o segmento `pos → pos + v` é cortado no 1º bloco e testado contra a
 * caixa do alvo inflada em 0,3; depois `v *= 0,99` e `v.y -= 0,03`.
 */
function javaWouldHit(eye, rotation, target, solids) {
	const xRot = rotation.pitch, overhand = xRot < 0 ? 5 * Math.cos(xRot * Math.PI / 180) : 5;
	const p = (xRot - overhand) * Math.PI / 180, y = rotation.yaw * Math.PI / 180;
	const dir = { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) };
	let v = { x: dir.x * 1.25, y: dir.y * 1.25, z: dir.z * 1.25 };
	let pos = { x: eye.x + dir.x, y: eye.y - 0.1 + dir.y, z: eye.z + dir.z };
	const hitBox = { min: { x: target.min.x - 0.3, y: target.min.y - 0.3, z: target.min.z - 0.3 }, max: { x: target.max.x + 0.3, y: target.max.y + 0.3, z: target.max.z + 0.3 } };
	for (let tick = 0; tick < 200; tick++) {
		const end = { x: pos.x + v.x, y: pos.y + v.y, z: pos.z + v.z };
		const block = Math.min(...solids.map((s) => clip(pos, end, s) ?? Infinity));
		const entity = clip(pos, end, hitBox);
		if (entity !== undefined && entity <= block) return true;
		if (block !== Infinity) return false;
		pos = end;
		v = { x: v.x * 0.99, y: v.y * 0.99 - 0.03, z: v.z * 0.99 };
	}
	return false;
}

const cube = (x0, y0, z0, x1, y1, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

export default {
	name: "ball-hit: taxa de acerto da Poké Ball comparada ao Java (pequeno, médio, grande, voando; distâncias e ângulos)",
	timeout: 1_800_000,
	async run(t) {
		const bot = await t.bot("BallHit");
		await setupWithPokemon(bot, "pikachu level=20");
		await bot.commandOk("gamemode s @s");
		const only = process.env.BALL_HIT_SPECIES?.split(",");
		const targets = TARGETS.filter((x) => !only || only.includes(x.species));

		// Arena grande e plana no alto (dentro da ticking area do spawn), fechada por paredes de vidro: a bola que erra
		// cai dentro dela (fora, cairia num chunk sem simulação e o item não poderia nascer).
		const a = bot.anchor ?? await bot.queryPosition();
		const R = 18, H = 10;
		const cx = Math.floor(a.x) + 30, cz = Math.floor(a.z) - 20, cy = 170;
		await bot.command(`fill ${cx - R} ${cy} ${cz - R} ${cx + R} ${cy + H} ${cz + R} air`);
		await bot.command(`fill ${cx - R} ${cy - 1} ${cz - R} ${cx + R} ${cy - 1} ${cz + R} glass`);
		await bot.command(`fill ${cx - R} ${cy} ${cz - R} ${cx + R} ${cy + H} ${cz - R} glass`);
		await bot.command(`fill ${cx - R} ${cy} ${cz + R} ${cx + R} ${cy + H} ${cz + R} glass`);
		await bot.command(`fill ${cx - R} ${cy} ${cz - R} ${cx - R} ${cy + H} ${cz + R} glass`);
		await bot.command(`fill ${cx + R} ${cy} ${cz - R} ${cx + R} ${cy + H} ${cz + R} glass`);
		const center = { x: cx + 0.5, y: cy, z: cz + 0.5 };
		const arenaSolids = [
			cube(cx - R, cy - 1, cz - R, cx + R + 1, cy, cz + R + 1),
			cube(cx - R, cy, cz - R, cx + R + 1, cy + H + 1, cz - R + 1), cube(cx - R, cy, cz + R, cx + R + 1, cy + H + 1, cz + R + 1),
			cube(cx - R, cy, cz - R, cx - R + 1, cy + H + 1, cz + R + 1), cube(cx + R, cy, cz - R, cx + R + 1, cy + H + 1, cz + R + 1),
		];

		// Sonda de trajetória: arremessos na horizontal e 10° para cima, posição e velocidade da bola (move_entity e
		// set_entity_motion): potência, gravidade e o ângulo de saída reais do projétil.
		await bot.command(`clear @s ${BALL}`);
		await giveItem(bot, BALL, 8);
		await holdItem(bot, BALL);
		for (const pitch of [0, -10]) {
			await bot.teleport(center.x, cy, center.z - 16);
			bot.rotation = { pitch, yaw: 0 };
			await t.sleep(400);
			const eye = { ...bot.position };
			const before = new Set(bot.findEntities((e) => e.type === BALL).map((e) => String(e.runtimeId)));
			const motions = [];
			const onMotion = (p) => motions.push({ id: String(p.runtime_entity_id), v: p.velocity });
			bot.client.on("set_entity_motion", onMotion);
			bot.useItem();
			const ball = await bot.waitForEntity((e) => e.type === BALL && !before.has(String(e.runtimeId)), { timeout: 3000 }).catch(() => undefined);
			const samples = [];
			const t0 = Date.now();
			while (ball && Date.now() - t0 < 1500) {
				const e = bot.entities.get(String(ball.runtimeId));
				if (!e) break;
				const s = `(${(e.position.y - eye.y).toFixed(2)},${(e.position.z - eye.z).toFixed(2)})`;
				if (samples.at(-1) !== s) samples.push(s);
				await t.sleep(50);
			}
			bot.client.off("set_entity_motion", onMotion);
			const mine = ball ? motions.filter((m) => m.id === String(ball.runtimeId)).map((m) => `(${m.v.x.toFixed(3)},${m.v.y.toFixed(3)},${m.v.z.toFixed(3)})`) : [];
			t.step(`sonda pitch ${pitch}°: bola (Δy,Δz) a partir do olho: ${samples.join(" ")}; set_entity_motion: ${mine.join(" ") || "nenhum"}`);
			if (ball) await bot.waitForEntityGone(ball, { timeout: 8000 }).catch(() => undefined);
			await bot.command("kill @e[type=item,r=40]");
		}

		const rows = [];
		const launches = [];
		for (const target of targets) {
			const box = javaBox(target.species);
			const type = `cobblemon:${target.species}`;
			await bot.command(`kill @e[type=${type},r=40]`);
			await bot.command("kill @e[type=item,r=40]");
			// Bolas suficientes para o Pokémon inteiro (os itens das bolas que caem são apagados).
			await bot.command(`clear @s ${BALL}`);
			await giveItem(bot, BALL, 64);
			await holdItem(bot, BALL);
			await bot.teleport(center.x, cy, center.z - 2);
			const py = cy + (target.air ?? 0);
			const solids = [...arenaSolids];
			if (target.air) {
				// Barreira (invisível) sob o voador: ele fica parado no ar, onde o cenário mira.
				await bot.command(`setblock ${cx} ${py - 1} ${cz} barrier`);
				solids.push(cube(cx, py - 1, cz, cx + 1, py, cz + 1));
			}
			const known = new Set(bot.findEntities((e) => e.type === type).map((e) => String(e.runtimeId)));
			// Nível 20: sem a escala de filhote (effectiveScale só com a intrínseca, 0,95–1,05).
			const out = await bot.command(`cobblemon:spawnpokemon ${target.species} 20 false ${center.x} ${py} ${center.z}`);
			if (out && !out.success) throw new Error(`spawnpokemon: ${JSON.stringify(out.output)}`);
			const mon = await bot.waitForEntity((e) => e.type === type && !known.has(String(e.runtimeId)), { timeout: 15_000 });
			await bot.command(`tag @e[type=${type},r=40] add uncatchable`);
			const freeze = async () => {
				await bot.command(`tp @e[type=${type},r=40] ${center.x} ${py} ${center.z}`);
				await bot.command(`effect @e[type=${type},r=40] slowness 600 255 true`);
			};
			// O Pokémon fica onde o tp o põe (o cache do bot pode atrasar): a mira e a simulação usam essa posição.
			const p = { x: center.x, y: py, z: center.z };
			const targetBox = cube(p.x - box.w / 2, p.y, p.z - box.w / 2, p.x + box.w / 2, p.y + box.h, p.z + box.w / 2);
			t.step(`${target.label} (${target.species}): caixa Java ${box.w.toFixed(2)}×${box.h.toFixed(2)} em y=${py}`);

			for (const place of PLACEMENTS) {
				const rad = place.yaw * Math.PI / 180;
				const bx = center.x + Math.sin(rad) * place.d, bz = center.z + Math.cos(rad) * place.d;
				const feetY = cy + place.up;
				const placeSolids = [...solids];
				if (place.up > 0) {
					await bot.command(`fill ${Math.floor(bx) - 1} ${feetY - 1} ${Math.floor(bz) - 1} ${Math.floor(bx) + 1} ${feetY - 1} ${Math.floor(bz) + 1} glass`);
					placeSolids.push(cube(Math.floor(bx) - 1, feetY - 1, Math.floor(bz) - 1, Math.floor(bx) + 2, feetY, Math.floor(bz) + 2));
				}
				await bot.teleport(bx, feetY, bz);
				await freeze();
				await t.sleep(600);
				let hits = 0, javaHits = 0, agree = 0, extra = 0, missing = 0;
				const detail = [];
				let control;
				for (const aim of [...AIMS, CONTROL]) {
					// Lado: perpendicular à linha de visada (horizontal).
					const dx = p.x - bot.position.x, dz = p.z - bot.position.z;
					const len = Math.hypot(dx, dz) || 1;
					const side = { x: -dz / len, z: dx / len };
					let aimAt;
					if (aim === CONTROL) {
						// Ângulo em que a distância horizontal da linha ao centro passa do raio circunscrito + folga.
						const reach = Math.SQRT2 * box.w / 2 + aim.clearance;
						const angle = Math.asin(Math.min(0.99, reach / len)) + 0.05;
						const fwd = { x: dx / len, z: dz / len };
						const dirH = { x: fwd.x * Math.cos(angle) + side.x * Math.sin(angle), z: fwd.z * Math.cos(angle) + side.z * Math.sin(angle) };
						aimAt = { x: bot.position.x + dirH.x * len, y: p.y + aim.h * box.h, z: bot.position.z + dirH.z * len };
					}
					else aimAt = { x: p.x + side.x * aim.side * box.w, y: p.y + aim.h * box.h, z: p.z + side.z * aim.side * box.w };
					bot.lookAt(aimAt);
					await t.sleep(350); // a rotação nova vai no próximo player_auth_input
					const eye = { ...bot.position }, rotation = { ...bot.rotation };
					const java = javaWouldHit(eye, rotation, targetBox, placeSolids);
					const before = new Set(bot.findEntities((e) => e.type === BALL).map((e) => String(e.runtimeId)));
					const mark = bot.mark();
					// Ângulo de saída real (1º set_entity_motion da bola): mira + 5° por cima no Java, nos dois caminhos.
					const motions = [];
					const onMotion = (pk) => motions.push(pk);
					bot.client.on("set_entity_motion", onMotion);
					if (place.interact) interactKeepingAim(bot, mon);
					else bot.useItem();
					const ball = await bot.waitForEntity((e) => e.type === BALL && !before.has(String(e.runtimeId)), { timeout: 3000 }).catch(() => undefined);
					if (ball) await bot.waitForEntityGone(ball, { timeout: 8000 }).catch(() => undefined);
					bot.client.off("set_entity_motion", onMotion);
					const first = ball && motions.find((m) => String(m.runtime_entity_id) === String(ball.runtimeId));
					const launch = first ? -Math.atan2(first.velocity.y, Math.hypot(first.velocity.x, first.velocity.z)) * 180 / Math.PI : undefined;
					if (aim.name === "centro") launches.push(`${place.interact ? "interação" : "nativo"} ${rotation.pitch.toFixed(1)}°→${launch?.toFixed(1) ?? "?"}°`);
					const hit = await bot.waitForText(HIT_TEXT, { since: mark.text, timeout: ball ? 700 : 2500 }).then(() => true, () => false);
					if (aim === CONTROL) control = { hit, java };
					else {
						if (hit) hits++;
						if (java) javaHits++;
						if (hit === java) agree++;
						else if (hit) extra++;
						else missing++;
					}
					detail.push(`${aim.name}:${hit ? "✓" : "✗"}${java ? "" : "(J✗)"}${ball ? "" : "(sem bola)"}`);
					await bot.command("kill @e[type=item,r=40]");
					await freeze();
				}
				rows.push({ species: target.species, d: place.d, up: place.up, interact: !!place.interact, hits, javaHits, agree, extra, missing, total: AIMS.length, control });
				t.step(`${target.species} d=${place.d} dir=${place.yaw}° alt=+${place.up}${place.interact ? " (interação)" : ""}: port ${hits}/${AIMS.length}, Java ${javaHits}/${AIMS.length} | ${detail.join(" ")}`);
				if (place.up > 0) await bot.command(`fill ${Math.floor(bx) - 1} ${feetY - 1} ${Math.floor(bz) - 1} ${Math.floor(bx) + 1} ${feetY - 1} ${Math.floor(bz) + 1} air`);
			}
			await bot.command(`kill @e[type=${type},r=40]`);
			if (target.air) await bot.command(`setblock ${cx} ${py - 1} ${cz} air`);
		}

		// Resumo: taxa bruta (antes/depois) e concordância com o Java, por Pokémon e total.
		const sum = (list) => list.reduce((acc, r) => ({
			hits: acc.hits + r.hits, java: acc.java + r.javaHits, agree: acc.agree + r.agree, extra: acc.extra + r.extra,
			missing: acc.missing + r.missing, total: acc.total + r.total,
		}), { hits: 0, java: 0, agree: 0, extra: 0, missing: 0, total: 0 });
		const pct = (n, d) => `${n}/${d} (${d ? Math.round(100 * n / d) : 0}%)`;
		const line = (s) => `port ${pct(s.hits, s.total)}; Java ${pct(s.java, s.total)}; o port acerta ${pct(s.java - s.missing, s.java)} do que o Java acerta; acertos a mais que o Java ${s.extra}`;
		t.step(`ângulos de saída (pitch → saída; negativo = para cima; após 1 tick de gravidade): ${launches.join("; ")}`);
		for (const target of targets) t.step(`RESUMO ${target.label} (${target.species}): ${line(sum(rows.filter((r) => r.species === target.species)))}`);
		const all = sum(rows);
		const controls = rows.filter((r) => r.control);
		const controlHits = controls.filter((r) => r.control.hit).length, controlJava = controls.filter((r) => r.control.java).length;
		t.step(`RESUMO total: ${line(all)}; controle fora da região de acerto: port ${controlHits}/${controls.length}, Java ${controlJava}/${controls.length}`);
		console.log(`  ball-hit RESUMO: ${targets.map((x) => `${x.species} ${pct(sum(rows.filter((r) => r.species === x.species)).hits, sum(rows.filter((r) => r.species === x.species)).total)}`).join("; ")}; total ${line(all)}; controle ${controlHits}/${controls.length}`);
		if (process.env.BALL_HIT_BASELINE === "1" || !rows.length) return;
		// Tão fácil quanto no Java: acerta ≥ 90% do que o Java acerta (a mira do bot vai em float e a bola nasce 1 bloco
		// antes da do Java) e quase nunca acerta o que o Java erraria (inclusive o controle fora da região de acerto).
		t.assert(all.java > 0 && (all.java - all.missing) / all.java >= 0.9, `o port acerta ≥ 90% do que o Java acerta (${line(all)})`);
		t.assert(all.extra <= Math.max(2, Math.ceil(0.1 * (all.total - all.java))), `acertos a mais que o Java ≤ 10% dos erros do Java (${all.extra})`);
		t.assert(controlHits <= controlJava, `controle fora da região de acerto: o port não acerta mais que o Java (${controlHits}/${controls.length})`);
	},
};
